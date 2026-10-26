import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';
import { createCloudTradingPreferences, cloudTradingPreferenceFailure } from '../src/main/personal-context/cloud-trading-preferences.mjs';
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from '../src/main/personal-context/trading-preference-defaults.mjs';
import { TRADING_PREFERENCE_CHOICE_FIELDS } from '../src/shared/trading-preference-fields.mjs';
import { createTradingPreferenceSettings } from '../src/renderer/trading-preference-settings.ts';
import { translateAppText } from '../src/renderer/app-language.mjs';

const busy = () => Object.assign(Error('private server detail'), { status: 429, code: 'MOBILE_BUSY', retryAfterMs: 2000 });
const dbBusy = () => Object.assign(Error('database wait'), { status: 503,
  payload: { detail: { code: 'MOBILE_BUSY', scope: 'db_pool', pool: 'database', retryable: true, retryAfterMs: 2000 } } });
const initial = () => ({ schemaVersion: 1, revision: 0, configHash: 'a'.repeat(64),
  entries: structuredClone(DEFAULT_TRADING_PREFERENCE_ENTRIES), extraNotes: { value: '', source: 'product_default' },
  fields: { entryMode: { choice: { selected: ['right'], custom: '' }, source: 'product_default' },
    ...Object.fromEntries(Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat().map(f => [f.id,
      { choice: { selected: [f.defaultValue], custom: '' }, source: 'product_default' }])) },
});
const patch = (base, body) => ({ ...base, revision: base.revision + 1, configHash: 'b'.repeat(64),
  fields: { ...base.fields, ...Object.fromEntries(Object.entries(body.changes).map(([id, choice]) =>
    [id, { choice: structuredClone(choice), source: 'user_saved' }])) },
});
const draft = () => ({ entryMode: 'left', changedFields: ['entryMode'], expectedRevision: 0 });
function fixture(handler, options = {}) {
  let clock = 0, accountId = 'test-owner';
  const diagnostics = [], waits = [], calls = [];
  const adapter = createCloudTradingPreferences({
    owner: async () => ({ ownerId: accountId, accountId, baseUrl: 'https://test.invalid' }),
    api: () => ({ tradingCloudRequest: async (...args) => { calls.push(structuredClone(args)); return handler(...args); } }),
    wait: async ms => { waits.push(ms); clock += ms; }, now: () => clock, random: () => 0,
    onDiagnostic: row => diagnostics.push(row), ...options,
  });
  return { adapter, diagnostics, waits, calls, switchAccount: () => { accountId = 'other'; } };
}

test('real HTTP busy PATCH and readback recover with one frozen write and a fresh-client read', async t => {
  let current = initial(), writes = 0, patches = 0, readsAfterSave = 0, readsBeforeSave = 0, clock = 0;
  const requests = [], waits = [], diagnostics = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    assert.equal(req.url, '/api/mobile/v1/trading-preferences');
    const reject = () => { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      res.end(JSON.stringify({ detail: { code: 'MOBILE_BUSY' } })); };
    if (req.method === 'PATCH') {
      requests.push({ raw, key: req.headers['idempotency-key'] });
      if (++patches <= 2) return reject();
      current = patch(current, JSON.parse(raw)); writes++;
    } else if (!writes && ++readsBeforeSave === 1 || writes && req.method === 'GET' && ++readsAfterSave === 1) return reject();
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(current));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = new YouleApiClient({ serviceFetch: fetch });
  api.loaded = true; api.baseUrl = baseUrl; api.profile = { id: 'test-owner' }; api.token = 'synthetic-test-only';
  const make = () => createCloudTradingPreferences({
    owner: async () => ({ ownerId: 'test-owner', accountId: 'test-owner', baseUrl }), api: () => api,
    wait: async ms => { waits.push(ms); clock += ms; }, now: () => clock, random: () => 0,
    onDiagnostic: row => diagnostics.push(row),
  });
  const adapter = make(); await adapter.load();
  const saved = await adapter.save(draft());
  assert.equal(saved.profile.entryMode, 'left'); assert.equal(saved.revision, 1);
  assert.equal(writes, 1); assert.equal(requests.length, 3);
  assert.deepEqual(requests, Array(3).fill(requests[0]));
  assert.deepEqual(JSON.parse(requests[0].raw), { expectedRevision: 0, changes: { entryMode: { selected: ['left'], custom: '' } } });
  assert.equal(waits.reduce((a, b) => a + b, 0), 8000);
  assert.deepEqual((await make().load()).profile.preferenceForm, saved.profile.preferenceForm);
  assert.ok(diagnostics.some(row => row.stage === 'confirmation' && row.event === 'service_waiting'));
  assert.deepEqual(diagnostics.at(-1), { stage: 'save', event: 'confirmed' });
});

test('persistent busy is bounded, retains the draft/key, and reports a specific localized error', async () => {
  let blocked = true, current = initial();
  const f = fixture((op, body) => {
    if (op === 'preferences') return current;
    if (blocked) throw busy();
    return current = patch(current, body);
  }, { preferenceBusyTimeoutMs: 2500 });
  await f.adapter.load();
  await assert.rejects(f.adapter.save(draft()), { code: 'MOBILE_BUSY' });
  assert.equal(f.waits.reduce((a, b) => a + b, 0), 2500);
  const envelope = cloudTradingPreferenceFailure(busy());
  for (const language of ['en', 'zh-TW', 'ko', 'ja']) assert.notEqual(translateAppText(envelope.error.message, language), envelope.error.message);
  assert.match(envelope.error.message, /尚未保存/);
  assert.doesNotMatch(JSON.stringify(f.diagnostics), /private|test-owner|selected|custom/);
  blocked = false; assert.equal((await f.adapter.save(draft())).revision, 1);
  const writes = f.calls.filter(call => call[0] === 'savePreferences');
  assert.deepEqual(writes, Array(writes.length).fill(writes[0]));
});

test('database queue rejection retries only the frozen preference mutation, including an earlier commit', async () => {
  let current = initial(), receipt, writes = 0;
  const f = fixture((op, body) => {
    if (op === 'preferences') return current;
    if (!receipt) { current = receipt = patch(current, body); writes++; throw dbBusy(); }
    return receipt;
  });
  await f.adapter.load();
  assert.equal((await f.adapter.save(draft())).revision, 1);
  assert.equal(writes, 1);
  const calls = f.calls.filter(call => call[0] === 'savePreferences');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
});

test('database wait exhaustion keeps uncertain save status; unrelated 503 is never automatically replayed', async () => {
  const f = fixture(op => { if (op === 'preferences') return initial(); throw dbBusy(); }, { preferenceBusyTimeoutMs: 2500 });
  await f.adapter.load();
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' });
  const unrelated = fixture(op => { if (op === 'preferences') return initial(); throw Object.assign(Error('other'), { status: 503, code: 'MOBILE_BUSY' }); });
  await unrelated.adapter.load();
  await assert.rejects(unrelated.adapter.save(draft()), { code: 'MOBILE_BUSY' });
  assert.equal(unrelated.calls.filter(call => call[0] === 'savePreferences').length, 1);
});

test('only admission busy retries: no replay for conflicts, quotas, auth or uncertain writes', async () => {
  for (const code of ['PREFERENCE_VERSION_CONFLICT', 'PREFERENCE_SAVE_PENDING', 'MODEL_RATE_LIMITED', 'YOULE_AUTH_EXPIRED', 'REQUEST_TIMEOUT']) {
    const f = fixture(op => {
      if (op === 'preferences') return initial();
      throw Object.assign(Error('fixture'), { code, status: code === 'MODEL_RATE_LIMITED' ? 429 : 409 });
    });
    await f.adapter.load();
    await assert.rejects(f.adapter.save(draft()), { code: code === 'REQUEST_TIMEOUT' ? 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' : code });
    assert.equal(f.calls.filter(call => call[0] === 'savePreferences').length, 1); assert.deepEqual(f.waits, []);
  }
});

test('account changes stop retries before another write', async () => {
  const f = fixture(op => { if (op === 'preferences') return initial(); throw busy(); },
    { wait: async () => f.switchAccount() });
  await f.adapter.load();
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_OWNER_CHANGED' });
  assert.equal(f.calls.filter(call => call[0] === 'savePreferences').length, 1);
});

test('busy replay cannot relabel a previously uncertain commit as an unsaved draft', async () => {
  let current = initial(), receipt;
  const f = fixture((op, body) => {
    if (op === 'preferences') return current;
    if (!receipt) {
      current = receipt = patch(current, body);
      throw Object.assign(Error('response lost'), { category: 'transport' });
    }
    throw busy();
  }, { preferenceBusyTimeoutMs: 2500 });
  await f.adapter.load();
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' });
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_SAVE_UNCONFIRMED' });
  assert.equal(current.revision, 1);
});

test('busy confirmation exhausts into pending confirmation and retries the original receipt', async () => {
  let current = initial(), receipt, blocked = true, mutations = 0;
  const f = fixture((op, body) => {
    if (op === 'preferences') { if (receipt && blocked) throw busy(); return current; }
    if (!receipt) { current = receipt = patch(current, body); mutations++; }
    return receipt;
  }, { preferenceBusyTimeoutMs: 2500 });
  await f.adapter.load();
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_CONFIRMATION_PENDING' });
  blocked = false; assert.equal((await f.adapter.save(draft())).revision, 1); assert.equal(mutations, 1);
  const writes = f.calls.filter(call => call[0] === 'savePreferences'); assert.deepEqual(writes[0], writes[1]);
});

test('settings stays busy during recovery, prevents concurrent saves and only confirms after readback', async () => {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  let current = initial(), attempts = 0;
  const f = fixture((op, body) => {
    if (op === 'preferences') return current;
    if (++attempts === 1) throw busy();
    return current = patch(current, body);
  }, { wait: async () => { reached(); await gate; }, onDiagnostic: () => { throw Error('log unavailable'); } });
  const editor = createTradingPreferenceSettings({ load: () => f.adapter.load(), save: () => f.adapter.save(draft()), render() {}, onSaved() {} });
  await editor.load(); const saving = editor.save(); await waiting;
  assert.match(editor.render(), /aria-busy="true"/);
  assert.doesNotMatch(editor.render(), /role="status">交易偏好已保存/);
  await editor.save(); assert.equal(attempts, 1);
  await assert.rejects(f.adapter.save(draft()), { code: 'TRADING_PREFERENCE_SAVE_PENDING' });
  release(); await saving;
  assert.match(editor.render(), /role="status">交易偏好已保存/);
  assert.match(editor.render(), /aria-busy="false"/);
});
