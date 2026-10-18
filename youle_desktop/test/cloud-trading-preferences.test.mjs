import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudTradingPreferences } from '../src/main/personal-context/cloud-trading-preferences.mjs';
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from '../src/main/personal-context/trading-preference-defaults.mjs';
import { TRADING_PREFERENCE_CHOICE_FIELDS } from '../src/shared/trading-preference-fields.mjs';

const fields = Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat();
function config(revision = 0) {
  return { schemaVersion: 1, revision, configHash: 'a'.repeat(64),
    fields: { entryMode: {choice:{selected:['auto'],custom:''},source:'product_default'}, ...Object.fromEntries(fields.map(f => [f.id, { choice: { selected: [f.defaultValue], custom: '' }, source: 'product_default' }])) },
    entries: DEFAULT_TRADING_PREFERENCE_ENTRIES, extraNotes: { value: '' },
  };
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
  assert.equal(loaded.profile.preferenceForm.entryMode, 'auto');
  assert.equal(loaded.fieldSources.risk, 'product_default');
  assert.deepEqual(calls.map(c => c[0]), ['preferences']);
  assert.equal(writes.length, 0);
  assert.equal(calls[0][2].expectedAccountId, 'account-a');
  assert.equal(calls[0][2].expectedBaseUrl, 'https://haolo.example');
});

test('failed save retries the same operation and never compiles or writes local answers', async () => {
  let saves = 0;
  const { adapter, calls, writes } = setup(operation => {
    if (operation === 'preferences') return config();
    if (++saves === 1) throw Object.assign(Error('timeout'), { code: 'REQUEST_TIMEOUT' });
    return config(1);
  });
  const loaded = await adapter.load();
  const draft = loaded.profile.preferenceForm;
  draft.choices.risk.selected = ['1'];
  await assert.rejects(adapter.save(draft), /timeout/);
  const saved = await adapter.save(draft);
  assert.equal(saved.revision, 1);
  const mutations = calls.filter(c => c[0] === 'savePreferences');
  assert.equal(mutations[0][2].idempotencyKey, mutations[1][2].idempotencyKey);
  assert.equal(mutations[0][1].expectedRevision, 0);
  assert.equal(writes.length, 0);
});

test('migration conflicts block execution and save until explicit per-field resolution', async () => {
  const entries = [{ scope: 'trading.risk', key: 'max_loss_per_trade_percent', value: 1, source: 'user_explicit' }];
  const { adapter, calls, writes } = setup((operation, payload) => {
    if (operation === 'preferences') return config(2);
    if (operation === 'importPreferences' && !payload.resolutions) {
      throw { payload: { detail: { code: 'PREFERENCE_IMPORT_CONFLICT', fields: [{ fieldId: 'risk', local: '1', cloud: '2' }] } } };
    }
    return config(3);
  }, entries);
  const loaded = await adapter.load();
  assert.equal(loaded.migration.code, 'PREFERENCE_IMPORT_CONFLICT');
  await assert.rejects(adapter.save(loaded.profile.preferenceForm), error => error.code === 'PREFERENCE_IMPORT_RESOLUTION_REQUIRED');
  await assert.rejects(adapter.effective(), error => error.code === 'PREFERENCE_IMPORT_RESOLUTION_REQUIRED');
  assert.equal((await adapter.resolveImport({ risk: 'local' })).revision, 3);
  assert.deepEqual(calls.at(-1)[1].resolutions, { risk: 'local' });
  assert.equal(writes.length, 0);
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
  const fixture = setup(operation => operation === 'preferences' ? config(revision) : config(3));
  const editing = await fixture.adapter.load();
  revision = 2;
  assert.equal((await fixture.adapter.effective()).revision, 2);
  await fixture.adapter.save(editing.profile.preferenceForm);
  // The server will detect the stale page at revision 1. Using revision 2 here
  // would turn a background read into permission to overwrite remote changes.
  assert.equal(fixture.calls.at(-1)[1].expectedRevision, 1);
});

test('saving the entry mode patches only the edited field and preserves default provenance', async () => {
  const fixture = setup((operation, payload) => {
    if (operation === 'preferences') return config();
    assert.deepEqual(payload, {expectedRevision:0, changes:{entryMode:{selected:['left'],custom:''}}});
    const saved = config(1);
    saved.fields.entryMode = { choice:{selected:['left'],custom:''},source:'user_saved' };
    return saved;
  });
  const loaded = await fixture.adapter.load();
  const saved = await fixture.adapter.save({...loaded.profile.preferenceForm,entryMode:'left',changedFields:['entryMode']});
  assert.equal(saved.profile.entryMode, 'left');
  assert.equal(saved.profile.fieldSources.entryMode, 'user_saved');
  assert.equal(saved.profile.fieldSources.risk, 'product_default');
  assert.equal(fixture.writes.length, 0);
});

test('an explicitly saved automatic default remains user-saved and invalid cloud modes fail closed', async () => {
  const saved = config(5);
  saved.fields.entryMode.source = 'user_saved';
  const fixture = setup(() => saved);
  const loaded = await fixture.adapter.load();
  assert.equal(loaded.profile.preferenceForm.entryMode, 'auto');
  assert.equal(loaded.profile.fieldSources.entryMode, 'user_saved');
  saved.fields.entryMode.choice.selected = ['unknown'];
  await assert.rejects(fixture.adapter.effective(), error => error.code === 'TRADING_PREFERENCE_CLOUD_INVALID');
});
