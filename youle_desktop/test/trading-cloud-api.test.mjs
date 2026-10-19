import assert from 'node:assert/strict';
import test from 'node:test';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';

function client(fetch) {
  const api = new YouleApiClient({ serviceFetch: fetch });
  api.loaded = true;
  api.baseUrl = 'https://haolo.example';
  api.token = 'test-account-token';
  return api;
}

test('cloud preferences bind account auth and preserve the same idempotency key on explicit retry', async () => {
  const requests = [];
  const api = client(async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ revision: 3 }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const payload = { expectedRevision: 2, changes: { risk: { selected: ['1'], custom: '' } } };
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await api.tradingCloudRequest('savePreferences', payload, { idempotencyKey: 'same-save' }), { revision: 3 });
  }
  assert.equal(requests.length, 2);
  for (const { url, init } of requests) {
    assert.equal(String(url), 'https://haolo.example/api/mobile/v1/trading-preferences');
    assert.equal(init.method, 'PATCH');
    assert.equal(init.headers.Authorization, 'Bearer test-account-token');
    assert.equal(init.headers['Idempotency-Key'], 'same-save');
    assert.deepEqual(JSON.parse(init.body), payload);
  }
});

test('unknown operations and unkeyed mutations never leave the host', async () => {
  let requests = 0;
  const api = client(async () => { requests++; throw Error('must not request'); });
  await assert.rejects(api.tradingCloudRequest('https://untrusted.example'), /Unsupported/);
  await assert.rejects(api.tradingCloudRequest('savePreferences', {}), /idempotency/);
  api.profile = { id: 'new-account' };
  await assert.rejects(api.tradingCloudRequest('savePreferences', {}, {
    idempotencyKey: 'once', expectedAccountId: 'original-account',
  }), error => error.code === 'TRADING_PREFERENCE_OWNER_CHANGED');
  assert.equal(requests, 0);
});

test('version conflict and upstream failures are not retried or converted to local success', async () => {
  for (const status of [409, 503]) {
    let requests = 0;
    const api = client(async () => {
      requests++;
      return new Response(JSON.stringify({ detail: { code: 'PREFERENCE_VERSION_CONFLICT' } }),
        { status, headers: { 'content-type': 'application/json' } });
    });
    await assert.rejects(api.tradingCloudRequest('savePreferences', {}, { idempotencyKey: 'once' }), error => error.status === status);
    assert.equal(requests, 1);
  }
});
