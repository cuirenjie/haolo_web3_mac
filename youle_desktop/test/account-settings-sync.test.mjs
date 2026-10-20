import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SettingsReplica, DesktopSettingsSync, LEGACY_SETTINGS_TIME, flattenSettings, applySettingValues } from '../src/renderer/account-settings-sync.ts';
import { clientSettingsRequest } from '../src/main/client-settings-sync.mjs';
import { YouleApiClient, isYouleAuthExpiredError } from '../src/main/youle-api-client.mjs';

const mainSource = readFileSync(new URL('../src/main/main.mjs', import.meta.url), 'utf8');
const wrapperSource = mainSource.slice(mainSource.indexOf('function wrapYouleApiClient('), mainSource.indexOf('\nfunction getAutomationStore('));
const wrapApi = new Function('isYouleAuthExpiredError', 'expireYouleSession', `${wrapperSource}; return wrapYouleApiClient;`)(
  isYouleAuthExpiredError, async () => {},
);

const receipt = (entries = [], version = 1) => ({ schemaVersion: 1, version, serverTime: Date.now(), entries });
class Storage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

test('separate fields merge both ways, reads cannot generate writes, and newer color wins', () => {
  const desktop = new SettingsReplica(), phone = new SettingsReplica();
  desktop.merge(receipt()); phone.merge(receipt());
  desktop.edit({}, { 'indicator.main:ma.parameters.0': 21, 'indicator.main:ma.series.short.color': '#123456' });
  phone.edit({}, { 'app.theme': 'dark' });
  const server = [...Object.values(desktop.pending), ...Object.values(phone.pending)];
  desktop.begin(); desktop.acknowledge(); phone.begin(); phone.acknowledge();
  desktop.merge(receipt(server, 2)); phone.merge(receipt(server, 2));
  assert.deepEqual(desktop.values(), phone.values()); assert.equal(desktop.dirty, false);
  phone.edit(phone.values(), { ...phone.values(), 'indicator.main:ma.series.short.color': '#abcdef' });
  desktop.merge(receipt([...server.filter(e => e.key !== 'indicator.main:ma.series.short.color'), ...Object.values(phone.pending)], 3));
  assert.equal(desktop.values()['indicator.main:ma.series.short.color'], '#abcdef');
  desktop.merge(receipt(server, 2)); assert.equal(desktop.values()['indicator.main:ma.series.short.color'], '#abcdef');
});

test('legacy migration cannot overwrite cloud edits, false and null resets are retained', () => {
  const replica = new SettingsReplica();
  replica.edit({}, { 'app.theme': 'light' }, true);
  replica.merge(receipt([{ key: 'app.theme', value: 'dark', changeId: 'cloud', changedAt: Date.now() }]));
  assert.equal(replica.values()['app.theme'], 'dark');
  replica.edit({}, { 'indicator.main:ma.enabled': false, 'indicator.main:ma.series.short.color': null });
  assert.equal(replica.values()['indicator.main:ma.enabled'], false);
  assert.equal(replica.values()['indicator.main:ma.series.short.color'], null);
});

test('unknown write result survives restart with the exact mutation and preserves a newer edit', () => {
  let replica = new SettingsReplica(); replica.merge(receipt());
  replica.edit({}, { 'app.theme': 'dark' });
  const original = JSON.stringify(replica.begin());
  replica = new SettingsReplica(replica.serialize());
  replica.edit(replica.values(), { 'app.theme': 'light' });
  replica.merge(receipt()); assert.equal(JSON.stringify(replica.begin()), original);
  replica.acknowledge(); assert.equal(replica.dirty, true);
  assert.equal(replica.begin().operations[0].value, 'light');
});

test('uncalibrated clocks adjust once; explicit rejected clocks can be repaired without changing ordinary retries', () => {
  const replica = new SettingsReplica(); replica.edit({}, { 'app.theme': 'dark' });
  replica.merge({ ...receipt(), serverTime: Date.now() - 600000 });
  assert.ok(replica.entries['app.theme'].changedAt < Date.now() - 590000);
  replica.offset = 1000000; replica.edit(replica.values(), { 'app.theme': 'light' });
  replica.begin(); replica.merge(receipt([], 2)); replica.correctClock();
  assert.ok(replica.begin().operations[0].changedAt < Date.now() + 100);
});

test('flatten/apply preserve arrays and only local-schema keys, including explicit resets', () => {
  const source = { parameters: [5, 10], series: { short: { visible: true, color: '#123456' } } };
  const values = flattenSettings(source, 'indicator.main:ma');
  values['indicator.main:ma.parameters.0'] = 42;
  values['indicator.main:ma.series.short.visible'] = false;
  values['indicator.main:ma.unknown'] = 'ignored';
  const restored = applySettingValues(source, values, 'indicator.main:ma');
  assert.deepEqual(restored.parameters, [42, 10]);
  assert.equal(restored.series.short.visible, false); assert.equal('unknown' in restored, false);
});

test('coordinator saves, pulls phone changes, isolates accounts and never reuploads a received change', async () => {
  const storage = new Storage(), requests = [], server = new Map();
  let version = 0, value = 'dark';
  const sync = new DesktopSettingsSync(storage, async p => {
    requests.push(p);
    if (p.action === 'write') { for (const op of p.body.operations) server.set(op.key, op); version++; }
    return receipt([...server.values()], version);
  });
  try {
    sync.register('app', { snapshot: () => ({ 'app.theme': value }), defaults: () => ({ 'app.theme': 'light' }), apply: v => { value = v['app.theme']; } });
    sync.activate('one', 'https://haolo.test'); await sync.sync();
    assert.equal(server.get('app.theme').value, 'dark');
    assert.equal(server.get('app.theme').changedAt, LEGACY_SETTINGS_TIME);
    server.set('app.theme', { key: 'app.theme', value: 'system', changeId: 'phone', changedAt: Date.now() }); version++;
    const writes = requests.filter(p => p.action === 'write').length;
    await sync.sync(true); assert.equal(value, 'system');
    assert.equal(requests.filter(p => p.action === 'write').length, writes);
    server.clear(); version = 0;
    sync.activate('two', 'https://haolo.test'); await sync.sync();
    assert.equal(value, 'light'); assert.equal(server.size, 0);
  } finally { sync.dispose(); }
});

test('a stale response after switching accounts cannot change the new account or send its outbox', async () => {
  let release, value = 'light';
  const sync = new DesktopSettingsSync(new Storage(), p => p.owner === 'one'
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve(receipt([], 0)));
  try {
    sync.register('app', { snapshot: () => ({ 'app.theme': value }), defaults: () => ({ 'app.theme': 'light' }), apply: v => { value = v['app.theme']; } });
    sync.activate('one', 'https://haolo.test'); const old = sync.sync();
    sync.activate('two', 'https://haolo.test'); await sync.sync();
    release(receipt([{ key: 'app.theme', value: 'dark', changeId: 'old', changedAt: Date.now() }]));
    await old; assert.equal(value, 'light');
  } finally { sync.dispose(); }
});

test('IPC bridge restricts route and identity, keeps credentials private, rejects late account/base changes', async () => {
  const api = { token: 'secret', profile: { id: 'one' }, baseUrl: 'https://haolo.test', load: async () => {}, requireAuth() {}, authHeaders: () => ({ Authorization: 'Bearer secret' }), requestJson: async (url, options) => {
    assert.equal(url, 'https://haolo.test/api/mobile/v1/client-settings'); assert.equal(options.method, 'GET'); return receipt();
  } };
  await clientSettingsRequest(api, { action: 'read', owner: 'one', baseUrl: api.baseUrl });
  await assert.rejects(clientSettingsRequest(api, { action: 'read', owner: 'two', baseUrl: api.baseUrl }), /ACCOUNT_CHANGED/);
  await assert.rejects(clientSettingsRequest(api, { action: 'delete', owner: 'one', baseUrl: api.baseUrl }), /ACTION_INVALID/);
  api.requestJson = async () => { api.baseUrl = 'https://other.test'; return receipt(); };
  await assert.rejects(clientSettingsRequest(api, { action: 'read', owner: 'one', baseUrl: api.baseUrl }), /ACCOUNT_CHANGED/);
});

test('production API wrapper sends authenticated settings reads and writes with token refresh intact', async () => {
  const requests = [], refreshes = [];
  const raw = new YouleApiClient({ serviceFetch: async (url, init) => {
    requests.push({ url, init });
    if (init.headers.Authorization !== 'Bearer refreshed-settings-token') {
      return new Response(JSON.stringify({ detail: { code: 'AUTH_HEADER_MISSING', message: 'Authorization header is required' } }), { status: 401 });
    }
    return new Response(JSON.stringify(receipt()), { status: 200 });
  } });
  raw.loaded = true;
  raw.baseUrl = 'https://haolo.test';
  raw.token = 'initial-settings-token';
  raw.profile = { id: 'one' };
  raw.refreshAccessToken = async options => { refreshes.push(options); raw.token = 'refreshed-settings-token'; };
  const api = wrapApi(raw);
  const identity = { owner: 'one', baseUrl: raw.baseUrl };
  await clientSettingsRequest(api, { ...identity, action: 'read' });
  const body = { schemaVersion: 1, mutationId: 'settings-write', operations: [] };
  await clientSettingsRequest(api, { ...identity, action: 'write', body });
  assert.deepEqual(requests.map(r => r.init.method), ['GET', 'PUT']);
  assert.ok(requests.every(r => r.url === 'https://haolo.test/api/mobile/v1/client-settings'));
  assert.equal(requests[1].init.body, JSON.stringify(body));
  assert.equal(requests[1].init.headers['content-type'], 'application/json');
  assert.equal(refreshes.length, 2);
});

test('production API wrapper keeps the login guard synchronous', () => {
  const raw = new YouleApiClient();
  raw.token = null;
  assert.throws(() => wrapApi(raw).requireAuth(), /请先登录/);
});

const histogramKey = 'indicator.sub:macd.series.histogram.histogramStyle';
const unsupportedError = (index = 0) => Object.assign(new Error('HTTP 422'), { status: 422,
  payload: { detail: [{ type: 'value_error', loc: ['body', 'operations', index], msg: 'Value error, Unsupported setting or value' }] } });

test('422 isolates unsupported fields durably, preserves configuration and new edits, and permits later retry', () => {
  let replica = new SettingsReplica(); replica.merge(receipt());
  replica.edit({}, { [histogramKey]: 'solid', 'app.theme': 'dark' });
  const rejected = replica.begin();
  replica.rejectUnsupported([histogramKey]);
  replica = new SettingsReplica(replica.serialize());
  assert.equal(replica.values()[histogramKey], 'solid');
  const supported = replica.begin();
  assert.notEqual(supported.mutationId, rejected.mutationId);
  assert.deepEqual(supported.operations.map(op => op.key), ['app.theme']);
  replica.acknowledge(); replica.merge(receipt(supported.operations));
  assert.equal(replica.values()[histogramKey], 'solid');
  assert.equal(replica.begin(), null); assert.equal(replica.dirty, true);
  replica.deferred[histogramKey] = Date.now() - 1;
  const retry = replica.begin(); assert.equal(retry.operations[0].value, 'solid');
  replica.edit(replica.values(), { [histogramKey]: 'hollow' });
  replica.rejectUnsupported([histogramKey]);
  assert.equal(replica.begin().operations[0].value, 'hollow');
  replica.acknowledge(); assert.equal(replica.dirty, false);
});

test('IPC only exposes verified atomic field rejections, never treats generic or stale 422 as safe to reissue', async () => {
  const api = { token: 'fixture', profile: { id: 'one' }, baseUrl: 'https://haolo.test',
    load: async () => {}, requireAuth() {}, authHeaders: () => ({}), requestJson: async () => { throw unsupportedError(); } };
  const params = { action: 'write', owner: 'one', baseUrl: api.baseUrl,
    body: { schemaVersion: 1, mutationId: 'fixture', operations: [{ key: histogramKey, value: 'solid' }] } };
  assert.deepEqual(await clientSettingsRequest(api, params), { rejected: 'SETTINGS_UNSUPPORTED_FIELDS', keys: [histogramKey] });
  for (const error of [unsupportedError(99), Object.assign(unsupportedError(), { status: 500 }),
    Object.assign(new Error('HTTP 422'), { status: 422, payload: { detail: [{ msg: 'invalid body' }] } })]) {
    api.requestJson = async () => { throw error; };
    await assert.rejects(clientSettingsRequest(api, params));
  }
  api.requestJson = async () => { api.profile.id = 'two'; throw unsupportedError(); };
  await assert.rejects(clientSettingsRequest(api, params), /ACCOUNT_CHANGED/);
});

test('coordinator unblocks supported settings while rejected styles remain local and pending across restart', async () => {
  const storage = new Storage(), requests = [], saved = new Map();
  const request = async p => {
    if (p.action === 'write') {
      requests.push(p.body);
      if (p.body.operations.some(op => op.key === histogramKey))
        return { rejected: 'SETTINGS_UNSUPPORTED_FIELDS', keys: [histogramKey] };
      for (const op of p.body.operations) saved.set(op.key, op);
    }
    return receipt([...saved.values()]);
  };
  let values = { 'app.theme': 'light', [histogramKey]: 'solid' };
  let sync = new DesktopSettingsSync(storage, request);
  const register = () => sync.register('app', { snapshot: () => values, defaults: () => ({ 'app.theme': 'light', [histogramKey]: 'solid' }), apply: v => { values = v; } });
  try {
    register(); sync.activate('one', 'https://haolo.test'); await sync.sync();
    sync.edit(values, { 'app.theme': 'dark', [histogramKey]: 'hollow' }); await sync.sync();
    assert.equal(saved.get('app.theme').value, 'dark');
    assert.equal(values[histogramKey], 'hollow'); assert.equal(sync.status, 'pending');
    assert.equal(requests.length, 2); assert.notEqual(requests[0].mutationId, requests[1].mutationId);
    sync.dispose(); sync = new DesktopSettingsSync(storage, request); register();
    sync.activate('one', 'https://haolo.test'); await sync.sync();
    assert.equal(values[histogramKey], 'hollow'); assert.equal(requests.length, 2);
    sync.activate('two', 'https://haolo.test'); await sync.sync();
    assert.equal(values[histogramKey], 'solid');
  } finally { sync.dispose(); }
});
