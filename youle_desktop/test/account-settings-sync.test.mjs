import assert from 'node:assert/strict';
import test from 'node:test';
import { SettingsReplica, DesktopSettingsSync, LEGACY_SETTINGS_TIME, flattenSettings, applySettingValues } from '../src/renderer/account-settings-sync.ts';
import { clientSettingsRequest } from '../src/main/client-settings-sync.mjs';

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

test('corrupt account storage cannot retain or upload the previous account outbox', async () => {
  for (const broken of ['invalid-json', 'storage-read-failure']) {
    const storage = new Storage(), requests = [];
    let value = 'light';
    const sync = new DesktopSettingsSync(storage, async p => { requests.push(p); return receipt([], 0); });
    try {
      sync.register('app', { snapshot: () => ({ 'app.theme': value }), defaults: () => ({ 'app.theme': 'light' }), apply: v => { value = v['app.theme']; } });
      sync.activate('one', 'https://haolo.test'); await sync.sync();
      sync.edit({ 'app.theme': 'light' }, { 'app.theme': 'dark' });
      const previous = sync.sync();
      const key = 'haolo.settings-sync.v1:https%3A%2F%2Fhaolo.test:two';
      if (broken === 'invalid-json') storage.setItem(key, '{broken');
      else { const read = storage.getItem.bind(storage); storage.getItem = k => { if (k === key) throw new Error('read failed'); return read(k); }; }
      sync.activate('two', 'https://haolo.test');
      await previous; await sync.sync(true);
      sync.edit({ 'app.theme': 'light' }, { 'app.theme': 'system' });
      await sync.sync(true);
      assert.equal(sync.status, 'error');
      assert.equal(value, 'light');
      assert.equal(requests.some(p => p.owner === 'two'), false);
      if (broken === 'invalid-json') assert.equal(storage.getItem(key), '{broken');
    } finally { sync.dispose(); }
  }
});
