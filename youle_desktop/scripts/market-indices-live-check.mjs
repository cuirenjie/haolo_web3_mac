// Read-only verification using the existing desktop session. Never prints it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';
import { MarketIndicesService } from '../src/main/market-indices.mjs';
import { PRIORITY_INDICES } from '../src/shared/market-index-catalog.mjs';

const output = path.resolve('output/aicoin-indices-20261019');
const saved = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'haolo_desktop', 'haolo-session.json'), 'utf8'));
assert.ok(saved.token, 'An existing desktop login is required');
let requests = 0, sourceCommit;
const client = new YouleApiClient({ serviceFetch: async (url, options) => {
  assert.equal(String(url), 'https://haolo.com/api/market-data/indices');
  assert.equal(options.method, 'GET');
  requests++;
  const response = await fetch(url, options);
  sourceCommit = response.headers.get('x-haolo-backend');
  return response;
} });
client.loaded = true;
client.baseUrl = 'https://haolo.com';
client.token = saved.token;
client.deviceId = saved.deviceId;
const snapshot = await client.getMarketIndices();
assert.doesNotMatch(JSON.stringify(snapshot), /aicoin|AccessKeyId|Signature|sourceUrl|"key":/i);
assert.ok(snapshot.indices.length >= 9);
assert.deepEqual(snapshot.indices.slice(0, 9).map(item => item.id), PRIORITY_INDICES.map(item => item.id));
assert.ok(snapshot.indices.slice(0, 9).every(item => item.status === 'ready' && Number.isFinite(item.value)));
const service = new MarketIndicesService({ indicesRequest: () => client.getMarketIndices() });
const catalogue = await service.loadCatalogue();
assert.equal(catalogue.length, snapshot.indices.length);
await service.loadCatalogue();
assert.equal(requests, 2);
assert.match(sourceCommit, /^[0-9a-f]{40}$/);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'snapshot-live.json'), JSON.stringify(snapshot));
const report = { checkedAt: new Date().toISOString(), sourceCommit, endpoint: '/api/market-data/indices',
  count: catalogue.length, validQuotes: catalogue.filter(item => item.value !== null).length,
  priorityReady: 9, desktopAdapter: true, catalogueCache: true, neutralFields: true, requests };

const auth = { Authorization: `Bearer ${saved.token}`, 'Content-Type': 'application/json' };
const statusResponse = await fetch('https://haolo.com/api/market-data/ifind/status', { headers: auth });
assert.equal(statusResponse.status, 200);
const status = (await statusResponse.json()).status;
assert.equal(status.enabled, false);
assert.equal(status.available, false);
report.retiredBusiness = {};
for (const route of ['search', 'quotes', 'snapshot', 'candles']) {
  const response = await fetch(`https://haolo.com/api/market-data/ifind/${route}${route === 'search' ? '?q=600000' : ''}`, {
    method: route === 'search' ? 'GET' : 'POST', headers: auth,
    ...(route === 'search' ? {} : { body: JSON.stringify(route === 'quotes' ? { symbols: ['600000.SH'] } : { symbol: '600000.SH', resolution: '1d', count: 1 }) }),
  });
  assert.equal(response.status, 410);
  const payload = await response.json();
  assert.equal(payload.error.code, 'IFIND_DISABLED');
  assert.equal(payload.error.retryable, false);
  report.retiredBusiness[route] = 410;
}
await fs.writeFile(path.join(output, 'production-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
