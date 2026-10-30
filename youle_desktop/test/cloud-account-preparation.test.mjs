import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';
import { cloudAccountConnection } from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';

const main = ts.createSourceFile('main.mjs', readFileSync(new URL('../src/main/main.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const functions = ['activeSharedBinanceConnection', 'readSharedBinanceAccountConnections', 'getCloudStrategyRuntime'].map(name => {
  const node = main.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return node.getText(main);
}).join('\n');
const owner = { ownerId: 'account-a', accountId: 'account-a', baseUrl: 'https://offline.invalid' };
const target = { marketKey: 'binance:usdm:BTCUSDT' };
const binding = id => ({ id, venue: 'binance', marketType: 'usdm', analysisConsent: true, credentialsBound: true });
function fixture() {
  const client = new YouleApiClient();
  client.loaded = true; client.baseUrl = owner.baseUrl; client.profile = { id: owner.accountId }; client.token = 'fixture-session';
  const get = new Function('getYouleApiClient', 'createCloudStrategyRuntime', 'cloudAccountConnection',
    'requireHaoloAccountOwner', 'getCloudRunJournal', `let cloudStrategyRuntime;${functions};return getCloudStrategyRuntime;`)(
      () => client, options => options, cloudAccountConnection, async () => owner, () => ({}));
  return { client, read: signal => get().connection(owner, target, { signal }) };
}

test('actual analysis account bridge bypasses the account-page connection cache', async () => {
  const { client, read } = fixture(); let calls = 0;
  client.serviceFetch = async () => Response.json({ items: [binding(++calls === 1 ? 'previous-binding' : 'fresh-binding')] });
  assert.equal((await client.listAccountConnections()).items[0].id, 'previous-binding');
  assert.equal((await read(new AbortController().signal)).id, 'fresh-binding');
  assert.equal(calls, 2, 'analysis must obtain its own current consent read');
});

test('actual analysis account bridge propagates cancellation into its HTTP read', async () => {
  const { client, read } = fixture(); const controller = new AbortController();
  let entered, release, transportSignal;
  const started = new Promise(resolve => { entered = resolve; });
  client.serviceFetch = async (_url, init) => {
    transportSignal = init.signal; entered();
    return new Promise((resolve, reject) => {
      release = () => resolve(Response.json({ items: [binding('late-binding')] }));
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  const result = read(controller.signal).then(value => ({ value }), error => ({ error }));
  await started; controller.abort();
  const cancelled = transportSignal.aborted;
  release(); const outcome = await result;
  assert.equal(cancelled, true, 'cancellation must reach the real transport, not only a runtime stub');
  assert.ok(outcome.error); assert.equal(outcome.value, undefined);
});

test('actual analysis account bridge rejects owner changes before and after HTTP', async () => {
  for (const timing of ['before', 'after']) {
    const { client, read } = fixture(); let calls = 0;
    client.serviceFetch = async () => { calls++; client.profile = { id: 'account-b' }; return Response.json({ items: [binding('wrong-owner')] }); };
    if (timing === 'before') client.profile = { id: 'account-b' };
    await assert.rejects(read(new AbortController().signal), { code: 'TRADING_PREFERENCE_OWNER_CHANGED' });
    assert.equal(calls, timing === 'before' ? 0 : 1);
  }
});

test('actual analysis account bridge filters revoked, unrelated venue and spot bindings', async () => {
  const { client, read } = fixture();
  client.serviceFetch = async () => Response.json({ items: [
    { ...binding('revoked'), revoked: true }, { ...binding('other'), venue: 'other' },
    { ...binding('spot'), marketType: 'spot' }, binding('allowed'),
  ] });
  assert.deepEqual(await read(new AbortController().signal), { id: 'allowed', unavailable: false });
});
