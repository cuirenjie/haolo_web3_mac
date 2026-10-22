import { createHash, randomUUID } from 'node:crypto';
import { tradingRiskProfileFromEntries } from './memory-store.mjs';

const choiceFields = ['entryMode', 'risk', 'breakEven', 'ratio', 'style', 'sections', 'discipline'];
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, detail = {}) => Object.assign(new Error(code), { code, detail });

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
  // Entry-mode-only saves do not compile memory entries. Field provenance is
  // authoritative even when the retired questionnaire completion flag is absent.
  const completed = profile.onboardingCompleted
    || Object.values(config.fields).some(field => field.source === 'user_saved')
    || config.extraNotes?.source === 'user_saved';
  return { ok: true, completed,
    profile: { ...profile, onboardingCompleted: completed, entryMode: config.fields.entryMode.choice.selected[0],
      fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
      preferenceForm: {
      entryMode: config.fields.entryMode.choice.selected[0],
      choices: Object.fromEntries(choiceFields.filter(id => id !== 'entryMode').map(id => [id, structuredClone(config.fields[id].choice)])),
      extraNotes: config.extraNotes?.value || '',
    } }, revision: config.revision, configHash: config.configHash,
    fieldSources: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [id, field.source])),
    migration: null,
  };
}

// Main-process only. No renderer token, upstream key, local compilation or
// implicit write-back into saved legacy answers is part of this adapter.
export function createCloudTradingPreferences({ owner, api }) {
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
    // Product defaults are immediately usable. Legacy local answers are no
    // longer imported; only deliberate settings saves can change this config.
    const config = await request(captured, 'preferences');
    if (remember) {
      if ((states.get(captured.ownerId)?.config.revision ?? -1) > config.revision) {
        throw failure('PREFERENCE_VERSION_CONFLICT');
      }
      states.set(captured.ownerId, { config, retry: null });
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
      const choices = { ...params.choices, ...(params.entryMode !== undefined ? { entryMode: { selected: [params.entryMode], custom: '' } } : {}) };
      const edited = Array.isArray(params.changedFields) ? params.changedFields : null;
      if (edited && (new Set(edited).size !== edited.length || edited.some(id => ![...choiceFields, 'extraNotes'].includes(id)))) {
        throw failure('TRADING_PREFERENCE_INVALID');
      }
      const payload = { expectedRevision: state.config.revision,
            changes: edited ? Object.fromEntries(edited.filter(id => id !== 'extraNotes').map(id => [id, choices[id]])) : choices,
            ...(!edited || edited.includes('extraNotes') ? { extraNotes: params.extraNotes ?? '' } : {}) };
      const hash = fingerprint(payload);
      if (state.retry?.hash !== hash) state.retry = { hash, key: `pref-save:${randomUUID()}` };
      const config = await request(captured, 'savePreferences', payload, { idempotencyKey: state.retry.key });
      state.config = config;
      state.retry = null;
      return result(config);
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
    async effective() {
      // Always obtain the current server revision before a new run. A cached
      // settings page is not authority after another device changes preferences.
      return load({ remember: false });
    },
    reset() { states.clear(); },
  };
}
