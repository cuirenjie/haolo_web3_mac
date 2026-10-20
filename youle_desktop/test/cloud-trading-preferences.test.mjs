import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudTradingPreferences } from '../src/main/personal-context/cloud-trading-preferences.mjs';
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from '../src/main/personal-context/trading-preference-defaults.mjs';
import { TRADING_PREFERENCE_CHOICE_FIELDS } from '../src/shared/trading-preference-fields.mjs';

const fields = Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat();
function config(revision = 0) {
  return { schemaVersion: 1, revision, configHash: 'a'.repeat(64),
    fields: { entryMode: {choice:{selected:['right'],custom:''},source:'product_default'}, ...Object.fromEntries(fields.map(f => [f.id, { choice: { selected: [f.defaultValue], custom: '' }, source: 'product_default' }])) },
    entries: DEFAULT_TRADING_PREFERENCE_ENTRIES, extraNotes: { value: '' },
  };
}
function applyPatch(base, payload) {
  const saved = structuredClone(base);
  saved.revision++;
  for (const [id, choice] of Object.entries(payload.changes)) {
    saved.fields[id] = { choice: structuredClone(choice), source: 'user_saved' };
  }
  if (Object.hasOwn(payload, 'extraNotes')) saved.extraNotes = { value: payload.extraNotes, source: 'user_saved' };
  return saved;
}
function setup(handler, entries = []) {
  let active = { ownerId: 'https://haolo.example::account-a', accountId: 'account-a', baseUrl: 'https://haolo.example' };
  const writes = [];
  const calls = [];
  const adapter = createCloudTradingPreferences({
    owner: async () => active,
    store: () => ({ list: async () => ({ entries }), upsert: async (...args) => writes.push(args) }),
    api: () => ({ tradingCloudRequest: async (...args) => { calls.push(args); return handler(...args); } }),
  });
  return { adapter, writes, calls, switchAccount: () => { active = { ...active, ownerId: 'account-b', accountId: 'account-b' }; } };
}

test('new users read server defaults without saving or importing synthetic defaults', async () => {
  const { adapter, writes, calls } = setup(() => config(), DEFAULT_TRADING_PREFERENCE_ENTRIES);
  const loaded = await adapter.load();
  assert.equal(loaded.profile.maxLossPerTradePercent, 2);
  assert.equal(loaded.profile.preferenceForm.entryMode, 'right');
  assert.equal(loaded.fieldSources.risk, 'product_default');
  assert.equal(loaded.completed, false);
  assert.equal(loaded.profile.onboardingCompleted, false);
  assert.deepEqual(calls.map(c => c[0]), ['preferences']);
  assert.equal(writes.length, 0);
  assert.equal(calls[0][2].expectedAccountId, 'account-a');
  assert.equal(calls[0][2].expectedBaseUrl, 'https://haolo.example');
});

test('failed save retries the same operation and never compiles or writes local answers', async () => {
  let saves = 0;
  let current = config();
  const { adapter, calls, writes } = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    if (++saves === 1) throw Object.assign(Error('timeout'), { code: 'REQUEST_TIMEOUT' });
    return current = applyPatch(current, payload);
  });
  const loaded = await adapter.load();
  const draft = loaded.profile.preferenceForm;
  draft.choices.risk.selected = ['1'];
  await assert.rejects(adapter.save(draft), { code: 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' });
  const saved = await adapter.save(draft);
  assert.equal(saved.revision, 1);
  const mutations = calls.filter(c => c[0] === 'savePreferences');
  assert.equal(mutations[0][2].idempotencyKey, mutations[1][2].idempotencyKey);
  assert.equal(mutations[0][1].expectedRevision, 0);
  assert.equal(writes.length, 0);
});

test('legacy answers never import or block analysis, and users can still save settings', async () => {
  const entries = [{ scope: 'trading.risk', key: 'max_loss_per_trade_percent', value: 1, source: 'user_explicit' }];
  let current = config(2);
  const { adapter, calls, writes } = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    if (operation === 'importPreferences') throw Error('Legacy import must not run');
    return current = applyPatch(current, payload);
  }, entries);
  const loaded = await adapter.load();
  assert.equal(loaded.migration, null);
  assert.equal(loaded.profile.maxLossPerTradePercent, 2);
  assert.equal((await adapter.effective()).revision, 2);
  assert.equal((await adapter.save(loaded.profile.preferenceForm)).revision, 3);
  assert.deepEqual(calls.map(c => c[0]), ['preferences', 'preferences', 'savePreferences', 'preferences']);
  assert.equal(writes.length, 0);
  assert.equal(entries[0].value, 1);
});

test('unreadable legacy storage is irrelevant and stale migration actions only refresh', async () => {
  const calls = [];
  const adapter = createCloudTradingPreferences({
    owner: async () => ({ ownerId: 'account-a', accountId: 'account-a', baseUrl: 'https://haolo.example' }),
    store: () => { throw Error('MEMORY_STORE_INVALID'); },
    api: () => ({ tradingCloudRequest: async operation => { calls.push(operation); return config(); } }),
  });
  assert.equal((await adapter.load()).profile.maxLossPerTradePercent, 2);
  assert.equal((await adapter.effective()).migration, null);
  assert.equal((await adapter.resolveImport({ risk: 'local' })).migration, null);
  assert.deepEqual(calls, ['preferences', 'preferences', 'preferences']);
});

test('a deliberate cloud settings save remains effective with legacy local answers present', async () => {
  let current = config();
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    assert.equal(operation, 'savePreferences');
    current = config(1);
    current.fields.risk = { choice: payload.changes.risk, source: 'user_saved' };
    current.entries = current.entries.map(e => e.key === 'max_loss_per_trade_percent'
      ? { ...e, value: 1, source: 'user_saved' } : e);
    return current;
  }, [{ scope: 'trading.risk', key: 'max_loss_per_trade_percent', value: 3 }]);
  const loaded = await fixture.adapter.load();
  loaded.profile.preferenceForm.choices.risk.selected = ['1'];
  await fixture.adapter.save({ ...loaded.profile.preferenceForm, changedFields: ['risk'] });
  const effective = await fixture.adapter.effective();
  assert.equal(effective.profile.maxLossPerTradePercent, 1);
  assert.equal(effective.fieldSources.risk, 'user_saved');
  assert.equal((await fixture.adapter.load()).profile.maxLossPerTradePercent, 1);
});

test('account changes and unavailable cloud cannot become a local fallback', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const fixture = setup(async () => { await waiting; return config(5); });
  const loading = fixture.adapter.load();
  await new Promise(resolve => setImmediate(resolve));
  fixture.switchAccount();
  release();
  await assert.rejects(loading, error => error.code === 'TRADING_PREFERENCE_OWNER_CHANGED');
  await assert.rejects(fixture.adapter.save({}), error => error.code === 'TRADING_PREFERENCE_LOAD_REQUIRED');
  const offline = setup(() => { throw Error('offline'); });
  await assert.rejects(offline.adapter.effective(), /offline/);
  assert.equal(offline.writes.length, 0);
});

test('a new analysis cannot replace the settings page revision and overwrite another device', async () => {
  let revision = 1;
  const fixture = setup(operation => {
    if (operation === 'preferences') return config(revision);
    throw Object.assign(Error('conflict'), { code: 'PREFERENCE_VERSION_CONFLICT' });
  });
  const editing = await fixture.adapter.load();
  revision = 2;
  assert.equal((await fixture.adapter.effective()).revision, 2);
  await assert.rejects(fixture.adapter.save(editing.profile.preferenceForm), { code: 'PREFERENCE_VERSION_CONFLICT' });
  // The server will detect the stale page at revision 1. Using revision 2 here
  // would turn a background read into permission to overwrite remote changes.
  assert.equal(fixture.calls.at(-1)[1].expectedRevision, 1);
});

test('saving the entry mode patches only the edited field and preserves default provenance', async () => {
  let current = config();
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    assert.deepEqual(payload, {expectedRevision:0, changes:{entryMode:{selected:['left'],custom:''}}});
    const saved = config(1);
    saved.fields.entryMode = { choice:{selected:['left'],custom:''},source:'user_saved' };
    return current = saved;
  });
  const loaded = await fixture.adapter.load();
  const saved = await fixture.adapter.save({...loaded.profile.preferenceForm,entryMode:'left',changedFields:['entryMode']});
  assert.equal(saved.profile.entryMode, 'left');
  assert.equal(saved.profile.fieldSources.entryMode, 'user_saved');
  assert.equal(saved.profile.fieldSources.risk, 'product_default');
  assert.equal(saved.completed, true);
  assert.equal(saved.profile.onboardingCompleted, true);
  assert.equal(fixture.writes.length, 0);
});

test('an explicitly saved automatic mode remains user-saved and invalid cloud modes fail closed', async () => {
  const saved = config(5);
  saved.fields.entryMode.choice.selected = ['auto'];
  saved.fields.entryMode.source = 'user_saved';
  const fixture = setup(() => saved);
  const loaded = await fixture.adapter.load();
  assert.equal(loaded.profile.preferenceForm.entryMode, 'auto');
  assert.equal(loaded.profile.fieldSources.entryMode, 'user_saved');
  saved.fields.entryMode.choice.selected = ['unknown'];
  await assert.rejects(fixture.adapter.effective(), error => error.code === 'TRADING_PREFERENCE_CLOUD_INVALID');
});

test('a successful receipt without durable readback cannot report saved preferences', async () => {
  const fixture = setup((operation, payload) => operation === 'preferences'
    ? config() : applyPatch(config(), payload));
  const loaded = await fixture.adapter.load();
  await assert.rejects(fixture.adapter.save({
    ...loaded.profile.preferenceForm, entryMode: 'left', changedFields: ['entryMode'],
  }), { code: 'TRADING_PREFERENCE_CLOUD_INVALID' });
});

test('lost confirmation retries the same cloud write, then a fresh client reads the saved answers', async () => {
  let current = config(), receipt, failReadback = true, mutations = 0;
  const handler = (operation, payload) => {
    if (operation === 'preferences') {
      if (receipt && failReadback) { failReadback = false; throw Error('offline'); }
      return current;
    }
    if (!receipt) { mutations++; current = receipt = applyPatch(current, payload); }
    return receipt;
  };
  const fixture = setup(handler);
  const loaded = await fixture.adapter.load();
  const draft = { ...loaded.profile.preferenceForm, entryMode: 'left', changedFields: ['entryMode', 'risk', 'discipline', 'extraNotes'], extraNotes: 'Keep this note' };
  draft.choices.risk = { selected: ['custom'], custom: '每笔最多亏损账户净值的1.5%' };
  draft.choices.discipline = { selected: ['no-add', 'news'], custom: '' };
  await assert.rejects(fixture.adapter.save(draft), { code: 'TRADING_PREFERENCE_CONFIRMATION_PENDING' });
  const saved = await fixture.adapter.save(draft);
  assert.equal(saved.completed, true);
  assert.equal(mutations, 1);
  const writes = fixture.calls.filter(c => c[0] === 'savePreferences');
  assert.deepEqual(writes[0], writes[1]);
  const restarted = await setup(handler).adapter.load();
  assert.deepEqual(restarted, saved);
  assert.deepEqual(restarted.profile.preferenceForm.choices.risk, draft.choices.risk);
  assert.deepEqual(restarted.profile.preferenceForm.choices.discipline, draft.choices.discipline);
  assert.equal(restarted.profile.preferenceForm.extraNotes, draft.extraNotes);
});

test('background profile reads cannot upgrade the revision of an older editing session', async () => {
  let current = config();
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    assert.equal(payload.expectedRevision, 0);
    throw Object.assign(Error('conflict'), { code: 'PREFERENCE_VERSION_CONFLICT' });
  });
  const loaded = await fixture.adapter.load();
  current = config(1);
  await fixture.adapter.load();
  await assert.rejects(fixture.adapter.save({
    ...loaded.profile.preferenceForm, expectedRevision: loaded.revision,
  }), { code: 'PREFERENCE_VERSION_CONFLICT' });
});

test('another device changing preferences during confirmation is surfaced as a conflict', async () => {
  let current = config();
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    const receipt = applyPatch(current, payload);
    current = applyPatch(receipt, { changes: { entryMode: { selected: ['right'], custom: '' } } });
    return receipt;
  });
  const loaded = await fixture.adapter.load();
  await assert.rejects(fixture.adapter.save({
    ...loaded.profile.preferenceForm, entryMode: 'left', changedFields: ['entryMode'],
  }), { code: 'PREFERENCE_UPDATED_AFTER_SAVE' });
  assert.equal((await fixture.adapter.load()).profile.entryMode, 'right');
});

test('a receipt that does not contain the edited answers is rejected', async () => {
  const fixture = setup(operation => config(operation === 'preferences' ? 0 : 1));
  const loaded = await fixture.adapter.load();
  await assert.rejects(fixture.adapter.save({
    ...loaded.profile.preferenceForm, entryMode: 'left', changedFields: ['entryMode'],
  }), { code: 'TRADING_PREFERENCE_CLOUD_INVALID' });
  assert.equal(fixture.calls.length, 2);
});

test('background reload after a lost save response preserves the original retry identity', async () => {
  let current = config(), receipt;
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return current;
    if (!receipt) {
      current = receipt = applyPatch(current, payload);
      throw Error('response lost');
    }
    return receipt;
  });
  const loaded = await fixture.adapter.load();
  const draft = { ...loaded.profile.preferenceForm, expectedRevision: loaded.revision };
  await assert.rejects(fixture.adapter.save(draft), /response lost/);
  await fixture.adapter.load();
  assert.equal((await fixture.adapter.save(draft)).revision, 1);
  const writes = fixture.calls.filter(call => call[0] === 'savePreferences');
  assert.deepEqual(writes[0], writes[1]);
});

test('retired questionnaire payloads cannot silently clear notes and report saved answers', async () => {
  const fixture = setup(() => config());
  await fixture.adapter.load();
  await assert.rejects(fixture.adapter.save({
    entries: [{ scope: 'trading.risk', key: 'max_loss_per_trade_percent', value: 1 }],
    userStatement: 'Save these answers',
  }), { code: 'TRADING_PREFERENCE_INVALID' });
  assert.deepEqual(fixture.calls.map(call => call[0]), ['preferences']);
});
