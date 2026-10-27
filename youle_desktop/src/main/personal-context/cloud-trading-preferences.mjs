import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tradingRiskProfileFromEntries } from './memory-store.mjs';
import { isAnalysisAdmissionBusy, waitForAnalysisAdmission } from '../trading-strategy-runtime/admission-recovery.mjs';

const choiceFields = ['entryMode', 'risk', 'breakEven', 'ratio', 'style', 'sections', 'discipline'];
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, detail = {}) => Object.assign(new Error(code), { code, detail });
const databasePoolBusy = error => {
  const detail = error?.payload?.detail || error?.detail;
  return Number(error?.status) === 503 && detail?.code === 'MOBILE_BUSY' && detail.scope === 'db_pool'
    && detail.pool === 'database' && detail.retryable === true && error.retryable !== false;
};
// Only this adapter's GETs and frozen, idempotent preference PATCH may opt in.
// A DB rejection can follow an earlier committed transaction in the handler.
const preferenceBusy = error => isAnalysisAdmissionBusy(error) || databasePoolBusy(error);

export function cloudTradingPreferenceFailure(error) {
  const detail = error?.payload?.detail || error?.detail || {};
  const code = String(detail.code || error?.code || "TRADING_PREFERENCE_SAVE_FAILED");
  const messages = {
    PREFERENCE_VERSION_CONFLICT: "其他设备已修改交易偏好，请重新加载后核对；本次修改尚未保存。",
    PREFERENCE_UPDATED_AFTER_SAVE: "本次交易偏好已保存，但随后有其他更新。请重新打开交易偏好，核对最新配置。",
    TRADING_PREFERENCE_CONFIRMATION_PENDING: "服务器已接受保存，但暂时无法确认最新配置。你的修改已保留，请重试确认。",
    TRADING_PREFERENCE_SAVE_UNCONFIRMED: "未收到完整的保存回执，暂时无法确认是否保存成功。你的修改已保留，请重试确认。",
    PREFERENCE_IMPORT_RESOLUTION_REQUIRED: "请先核对本地与云端的交易偏好。",
    PREFERENCE_SAVE_PENDING: "交易偏好正在保存，请稍候。",
    TRADING_PREFERENCE_SAVE_PENDING: "交易偏好正在保存，请稍候。",
    TRADING_PREFERENCE_OWNER_CHANGED: "登录账号已变化，请重新打开交易偏好。",
    TRADING_PREFERENCE_NOT_UNDERSTOOD: "自定义内容无法明确理解或与其他设置冲突，请修改。",
    TRADING_PREFERENCE_MODEL_UNAVAILABLE: "大模型理解服务暂不可用或请求超时，请稍后重试。",
    MOBILE_BUSY: "保存服务持续繁忙，本次修改尚未保存。已保留你的修改，请稍后重试。",
  };
  return { ok: false, error: { code, fieldId: String(detail.fieldId || ""),
    message: messages[code] || "交易偏好保存失败，已保留你的修改，请重试。" } };
}

function validateConfig(config) {
  if (!config || config.schemaVersion !== 1 || !Number.isSafeInteger(config.revision) || config.revision < 0
    || !/^[a-f0-9]{64}$/.test(config.configHash || '') || !Array.isArray(config.entries)
    || !choiceFields.every(id => Array.isArray(config.fields?.[id]?.choice?.selected))
    || config.fields.entryMode.choice.selected.length !== 1
    || !['left', 'right', 'auto'].includes(config.fields.entryMode.choice.selected[0])
    || config.fields.entryMode.choice.custom !== '') {
    throw failure('TRADING_PREFERENCE_CLOUD_INVALID');
  }
  return structuredClone(config);
}

function result(config) {
  const profile = tradingRiskProfileFromEntries(config.entries);
  const entryMode = config.fields.entryMode.choice.selected[0] === 'left' ? 'left' : 'right';
  // Entry-mode-only saves do not compile memory entries. Field provenance is
  // authoritative even when the retired questionnaire completion flag is absent.
  const completed = profile.onboardingCompleted
    || Object.values(config.fields).some(field => field.source === 'user_saved')
    || config.extraNotes?.source === 'user_saved';
  return { ok: true, completed,
    profile: { ...profile, onboardingCompleted: completed, entryMode,
      fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
      preferenceForm: {
      entryMode,
      choices: Object.fromEntries(choiceFields.filter(id => id !== 'entryMode').map(id => [id, structuredClone(config.fields[id].choice)])),
      extraNotes: config.extraNotes?.value || '',
    } }, revision: config.revision, configHash: config.configHash,
    fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
    migration: null,
  };
}

// Main-process only. No renderer token, upstream key, local compilation or
// implicit write-back into saved legacy answers is part of this adapter.
export function createCloudTradingPreferences({ owner, api, wait, now, random, busyTimeoutMs,
  preferenceBusyTimeoutMs = 30_000, onDiagnostic }) {
  const states = new Map();
  const pending = new Set();
  const currentOwner = async captured => {
    const current = await owner();
    if (current.ownerId !== captured.ownerId || current.baseUrl !== captured.baseUrl
      || current.accountId !== captured.accountId) throw failure('TRADING_PREFERENCE_OWNER_CHANGED');
  };
  const request = async (captured, operation, payload, options) => {
    await currentOwner(captured);
    const response = await api().tradingCloudRequest(operation, payload, {
      ...options, expectedAccountId: captured.accountId, expectedBaseUrl: captured.baseUrl,
    });
    await currentOwner(captured);
    return validateConfig(response);
  };
  const diagnostic = (stage, event, error) => {
    // Fixed fields only: never log preferences, account IDs, tokens or raw
    // server messages. A logging failure must not change a save's outcome.
    const code = String(error?.payload?.detail?.code || error?.code || 'UNKNOWN');
    try { onDiagnostic?.({ stage, event,
      ...(error ? { code: /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'UNKNOWN',
        status: Number(error?.status) || null } : {}) }); } catch { /* best effort */ }
  };
  const interactiveRequest = async (captured, stage, operation, payload, options = {}) => {
    try {
      return await waitForAnalysisAdmission({
        request: async () => {
          try { return await request(captured, operation, payload, options); }
          catch (error) {
            const retry = states.get(captured.ownerId)?.retry;
            if (retry && stage === 'save' && databasePoolBusy(error)) retry.outcome ||= 'uncertain';
            throw error;
          }
        },
        assertOwner: () => currentOwner(captured), signal: options.signal,
        wait, now, random, timeoutMs: preferenceBusyTimeoutMs,
        isBusy: preferenceBusy,
        onProgress: progress => diagnostic(stage, progress.stage),
      });
    } catch (error) { diagnostic(stage, 'failed', error); throw error; }
  };
  async function load({ remember = true, recoverBusy = false, signal, onProgress } = {}) {
    const captured = await owner();
    // Product defaults are immediately usable. Legacy local answers are no
    // longer imported; only deliberate settings saves can change this config.
    const read = () => request(captured, 'preferences', undefined, {signal});
    const config = recoverBusy ? await waitForAnalysisAdmission({request:read,isBusy:preferenceBusy,
      assertOwner:()=>currentOwner(captured),signal,onProgress,wait,now,random,timeoutMs:busyTimeoutMs})
      : await interactiveRequest(captured, 'load', 'preferences', undefined, { signal });
    if (remember) {
      const state = states.get(captured.ownerId);
      if ((state?.config.revision ?? -1) > config.revision) {
        throw failure('PREFERENCE_VERSION_CONFLICT');
      }
      // Keep an uncertain save's idempotency receipt across background reads.
      // A new edit/revision creates its own key when save() builds its payload.
      if (state) state.config = config;
      else states.set(captured.ownerId, { config, retry: null });
    }
    return result(config);
  }
  async function save(params) {
    const captured = await owner();
    const state = states.get(captured.ownerId);
    if (!state) throw failure('TRADING_PREFERENCE_LOAD_REQUIRED');
    if (pending.has(captured.ownerId)) throw failure('TRADING_PREFERENCE_SAVE_PENDING');
    pending.add(captured.ownerId);
    try {
      // Retired questionnaire callers send only memory entries. Do not turn
      // ignored answers into an empty-note PATCH and claim they were saved.
      if (!params.choices && params.entryMode === undefined && !Object.hasOwn(params, 'extraNotes')) {
        throw failure('TRADING_PREFERENCE_INVALID');
      }
      const choices = { ...params.choices, ...(params.entryMode !== undefined ? { entryMode: { selected: [params.entryMode], custom: '' } } : {}) };
      if (choices.entryMode && (choices.entryMode.selected?.length !== 1
        || !['left', 'right'].includes(choices.entryMode.selected[0]) || choices.entryMode.custom)) {
        throw failure('ENTRY_MODE_INVALID');
      }
      const edited = Array.isArray(params.changedFields) ? params.changedFields : null;
      if (edited && (new Set(edited).size !== edited.length || edited.some(id => ![...choiceFields, 'extraNotes'].includes(id)))) {
        throw failure('TRADING_PREFERENCE_INVALID');
      }
      // Bind the write to the revision the user actually edited. Background
      // profile reads may have refreshed the adapter's state in the meantime.
      const expectedRevision = params.expectedRevision ?? state.config.revision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw failure('TRADING_PREFERENCE_INVALID');
      const payload = structuredClone({ expectedRevision,
            changes: edited ? Object.fromEntries(edited.filter(id => id !== 'extraNotes').map(id => [id, choices[id]])) : choices,
            ...(!edited || edited.includes('extraNotes') ? { extraNotes: params.extraNotes ?? '' } : {}) });
      const hash = fingerprint(payload);
      if (state.retry?.hash !== hash) state.retry = { hash, key: `pref-save:${randomUUID()}` };
      let config;
      try {
        config = await interactiveRequest(captured, 'save', 'savePreferences', payload, { idempotencyKey: state.retry.key });
      } catch (error) {
        // A network failure can occur after commit. Retrying must use the same
        // operation key, and the UI must not claim the server rejected it.
        if (['transport', 'timeout'].includes(error?.category)
          || ['REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(error?.code)) {
          state.retry.outcome ||= 'uncertain';
          throw failure('TRADING_PREFERENCE_SAVE_UNCONFIRMED');
        }
        // A later admission rejection cannot disprove an earlier commit for
        // the same operation whose response/confirmation was interrupted.
        if (preferenceBusy(error) && state.retry.outcome) {
          throw failure(state.retry.outcome === 'accepted'
            ? 'TRADING_PREFERENCE_CONFIRMATION_PENDING' : 'TRADING_PREFERENCE_SAVE_UNCONFIRMED');
        }
        throw error;
      }
      if (config.revision !== expectedRevision + 1
        || Object.entries(payload.changes).some(([id, choice]) =>
          !isDeepStrictEqual(config.fields[id]?.choice, choice) || config.fields[id]?.source !== 'user_saved')
        || (Object.hasOwn(payload, 'extraNotes')
          && (config.extraNotes?.value !== payload.extraNotes || config.extraNotes?.source !== 'user_saved'))) {
        throw failure('TRADING_PREFERENCE_CLOUD_INVALID');
      }
      // A successful PATCH receipt alone is insufficient: a new client/device
      // must be able to GET the same persisted configuration. Keep the original
      // revision and idempotency key until this readback succeeds, so retrying
      // an interrupted confirmation cannot issue a second write.
      state.retry.outcome = 'accepted';
      let persisted;
      try {
        persisted = await interactiveRequest(captured, 'confirmation', 'preferences');
      } catch (error) {
        if (error?.code === 'TRADING_PREFERENCE_OWNER_CHANGED') throw error;
        // The write was acknowledged. An interrupted confirmation must not be
        // described as a rejected write; retain the original retry identity.
        throw failure('TRADING_PREFERENCE_CONFIRMATION_PENDING');
      }
      if (persisted.revision > config.revision) throw failure('PREFERENCE_UPDATED_AFTER_SAVE');
      if (persisted.revision !== config.revision || persisted.configHash !== config.configHash
        || !isDeepStrictEqual(persisted.fields, config.fields)
        || !isDeepStrictEqual(persisted.extraNotes, config.extraNotes)) {
        throw failure('TRADING_PREFERENCE_CLOUD_INVALID');
      }
      state.config = persisted;
      state.retry = null;
      diagnostic('save', 'confirmed');
      return result(persisted);
    } finally {
      pending.delete(captured.ownerId);
    }
  }
  return {
    load,
    save,
    // A stale settings view may still request resolution. Refresh the current
    // config without importing, deleting or rewriting its legacy records.
    resolveImport: () => load(),
    async effective(options = {}) {
      // Always obtain the current server revision before a new run. A cached
      // settings page is not authority after another device changes preferences.
      return load({ ...options, remember: false, recoverBusy: true });
    },
    reset() { states.clear(); },
  };
}
