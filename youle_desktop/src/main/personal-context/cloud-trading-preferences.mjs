import { createHash, randomUUID } from 'node:crypto';
import { tradingRiskProfileFromEntries } from './memory-store.mjs';

const choiceFields = ['entryMode', 'risk', 'breakEven', 'ratio', 'style', 'sections', 'discipline'];
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, detail = {}) => Object.assign(new Error(code), { code, detail });
const detailOf = error => error?.payload?.detail || error?.detail || { code: error?.code || 'TRADING_PREFERENCE_CLOUD_UNAVAILABLE' };
const relevant = entry => entry.scope === 'trading' || entry.scope?.startsWith('trading.')
  || entry.scope === 'preferences.form' || (entry.scope === 'communication' && entry.key === 'trading_analysis_style');

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

function result(config, migration = null) {
  const profile = tradingRiskProfileFromEntries(config.entries);
  return { ok: true, completed: profile.onboardingCompleted,
    profile: { ...profile, entryMode: config.fields.entryMode.choice.selected[0],
      fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
      preferenceForm: {
      entryMode: config.fields.entryMode.choice.selected[0],
      choices: Object.fromEntries(choiceFields.filter(id => id !== 'entryMode').map(id => [id, structuredClone(config.fields[id].choice)])),
      extraNotes: config.extraNotes?.value || '',
    } }, revision: config.revision, configHash: config.configHash,
    fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
    migration,
  };
}

// Main-process only. No renderer token, upstream key, local compilation or
// implicit write-back into saved legacy answers is part of this adapter.
export function createCloudTradingPreferences({ owner, api, store }) {
  const states = new Map();
  const pending = new Set();
  const currentOwner = async captured => {
    if ((await owner()).ownerId !== captured.ownerId) throw failure('TRADING_PREFERENCE_OWNER_CHANGED');
  };
  const request = async (captured, operation, payload, options) => {
    await currentOwner(captured);
    const response = await api().tradingCloudRequest(operation, payload, {
      ...options, expectedAccountId: captured.accountId, expectedBaseUrl: captured.baseUrl,
    });
    await currentOwner(captured);
    return validateConfig(response);
  };
  async function load({ remember = true } = {}) {
    const captured = await owner();
    let config = await request(captured, 'preferences');
    const local = await store().list(captured.ownerId);
    await currentOwner(captured);
    const entries = local.entries.filter(relevant).filter(e => e.source !== 'product_default');
    let migration = null;
    if (entries.length) {
      const payload = { accountId: captured.accountId, expectedRevision: config.revision, entries };
      try {
        config = await request(captured, 'importPreferences', payload,
          { idempotencyKey: `pref-import:${fingerprint(payload)}` });
      } catch (error) {
        const detail = detailOf(error);
        if (['PREFERENCE_IMPORT_CONFLICT', 'PREFERENCE_IMPORT_REVIEW_REQUIRED', 'TRADING_PREFERENCE_NOT_UNDERSTOOD', 'TRADING_PREFERENCE_INVALID'].includes(detail.code)) {
          migration = { code: detail.code, fields: detail.fields || [], reason: detail.reason, fieldId: detail.fieldId,
            localEntries: entries.filter(e => e.scope !== 'preferences.form').map(({ scope, key, value }) => ({ scope, key, value })) };
        } else throw error;
      }
    }
    await currentOwner(captured);
    if (remember) {
      if ((states.get(captured.ownerId)?.config.revision ?? -1) > config.revision) {
        throw failure('PREFERENCE_VERSION_CONFLICT');
      }
      states.set(captured.ownerId, { config, entries, migration, retry: null });
    }
    return result(config, migration);
  }
  async function mutate(kind, params) {
    const captured = await owner();
    const state = states.get(captured.ownerId);
    if (!state) throw failure('TRADING_PREFERENCE_LOAD_REQUIRED');
    if (pending.has(captured.ownerId)) throw failure('TRADING_PREFERENCE_SAVE_PENDING');
    if (kind === 'savePreferences' && state.migration) throw failure('PREFERENCE_IMPORT_RESOLUTION_REQUIRED');
    pending.add(captured.ownerId);
    try {
      const choices = { ...params.choices, ...(params.entryMode !== undefined ? { entryMode: { selected: [params.entryMode], custom: '' } } : {}) };
      const edited = Array.isArray(params.changedFields) ? params.changedFields : null;
      if (edited && (new Set(edited).size !== edited.length || edited.some(id => ![...choiceFields, 'extraNotes'].includes(id)))) {
        throw failure('TRADING_PREFERENCE_INVALID');
      }
      const payload = kind === 'importPreferences'
        ? { expectedRevision: state.config.revision, accountId: captured.accountId, entries: state.entries,
            ...(params.keepCloud === true ? { keepCloud: true } : { resolutions: params }) }
        : { expectedRevision: state.config.revision,
            changes: edited ? Object.fromEntries(edited.filter(id => id !== 'extraNotes').map(id => [id, choices[id]])) : choices,
            ...(!edited || edited.includes('extraNotes') ? { extraNotes: params.extraNotes ?? '' } : {}) };
      const hash = fingerprint({ kind, payload });
      if (state.retry?.hash !== hash) state.retry = { hash, key: `pref-save:${randomUUID()}` };
      const config = await request(captured, kind, payload, { idempotencyKey: state.retry.key });
      state.config = config;
      state.retry = null;
      state.migration = null;
      return result(config);
    } finally {
      pending.delete(captured.ownerId);
    }
  }
  return {
    load,
    save: params => mutate('savePreferences', params),
    resolveImport: resolutions => mutate('importPreferences', resolutions),
    async effective() {
      // Always obtain the current server revision before a new run. A cached
      // settings page is not authority after another device changes preferences.
      const loaded = await load({ remember: false });
      if (loaded.migration) throw failure('PREFERENCE_IMPORT_RESOLUTION_REQUIRED');
      return loaded;
    },
    reset() { states.clear(); },
  };
}
