import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createConditionalPollFetch } from '../src/main/conditional-poll-fetch.mjs';

const url = 'https://fixture/api/mobile/v1/client-settings';
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('100 same-account simultaneous reads use one transport; cancellation is per subscriber', async () => {
  let calls = 0, finish, signal;
  const read = createConditionalPollFetch(async (_url, init) => {
    calls++; signal = init.signal;
    await new Promise(resolve => finish = resolve);
    return json({ entries: [], serverTime: 1000 });
  }, () => 'alice', { background: true });
  const abort = new AbortController();
  const cancelled = assert.rejects(read(url, { signal: abort.signal }), /cancelled/);
  const requests = Array.from({ length: 100 }, () => read(url));
  abort.abort(new Error('cancelled'));
  assert.equal(signal.aborted, false);
  finish();
  const responses = await Promise.all(requests);
  await cancelled;
  const values = await Promise.all(responses.map(response => response.json()));
  values[0].entries.push('caller-local');
  assert.deepEqual(values[1].entries, []);
  assert.equal(calls, 1);
});

test('last subscriber cancellation aborts body transfer and a new read starts cleanly', async () => {
  let calls = 0, cancelled = 0;
  const read = createConditionalPollFetch(async (_url, init) => {
    calls++;
    if (calls > 1) return json({ entries: [] });
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => { cancelled++; controller.error(init.signal.reason); });
    } }));
  }, () => 'alice');
  const abort = new AbortController();
  const request = assert.rejects(read(url, { signal: abort.signal }), /cancelled/);
  await turn(); abort.abort(new Error('cancelled')); await request;
  assert.equal(cancelled, 1);
  assert.equal((await read(url)).status, 200);
  assert.equal(calls, 2);
});

test('quiet fallback is bounded; explicit refresh, write and account switch fetch fresh state', async () => {
  let now = 0, owner = 'alice', calls = 0, version = 1;
  const read = createConditionalPollFetch(async () => { calls++; return json({ version, entries: [], serverTime: now + 1000 }); },
    () => owner, { background: true, now: () => now });
  for (now = 0; now <= 100000; now += 5000) await read(url);
  assert.ok(calls <= 7, `expected <=7 requests instead of 21; got ${calls}`);
  version = 2;
  assert.equal((await (await read(url, { cache: 'reload' })).json()).version, 2);
  const before = calls;
  await read(url, { method: 'PUT', body: '{}' }); await read(url);
  assert.equal(calls, before + 2);
  owner = 'bob'; version = 3;
  assert.equal((await (await read(url)).json()).version, 3);
});

test('429 polls share Retry-After cooldown and exponential recovery; preference PATCH is never replayed', async () => {
  let now = 10000, calls = 0;
  const read = createConditionalPollFetch(async () => {
    calls++;
    return new Response('{"detail":{"code":"MOBILE_BUSY"}}', { status: 429, headers: { 'Retry-After': '10' } });
  }, () => 'alice', { background: true, now: () => now, random: () => 0 });
  for (let i = 0; i < 100; i++) assert.equal((await read(url)).status, 429);
  assert.equal(calls, 1);
  now += 9999; assert.equal((await read(url)).status, 429); assert.equal(calls, 1);
  now++; await read(url); assert.equal(calls, 2);
  await read('https://fixture/api/mobile/v1/trading-preferences', { method: 'PATCH', body: '{}' });
  assert.equal(calls, 3);
});

test('in-flight reads are partitioned by credentials, language and cache mode', async () => {
  let calls = 0;
  const read = createConditionalPollFetch(async (_url, init) => {
    calls++; await turn(); return json({ language: new Headers(init.headers).get('accept-language') });
  }, () => 'alice');
  const responses = await Promise.all([
    read(url, { headers: { Authorization: 'one', 'Accept-Language': 'en' } }),
    read(url, { headers: { Authorization: 'two', 'Accept-Language': 'en' } }),
    read(url, { headers: { Authorization: 'one', 'Accept-Language': 'ja' } }),
    read(url, { headers: { Authorization: 'one', 'Accept-Language': 'en' }, cache: 'reload' }),
  ]);
  assert.equal(calls, 4);
  assert.equal((await responses[2].json()).language, 'ja');
});

test('market data, active runs and sequential plan queries retain live cadence', async () => {
  let calls = 0;
  const read = createConditionalPollFetch(async () => { calls++; return json({ version: calls }); }, () => 'alice', { background: true });
  for (const path of ['/api/mobile/v1/trading-plans', '/api/mobile/v1/agent-runs/r', '/api/market-data/indices']) {
    await read('https://fixture' + path); await read('https://fixture' + path);
  }
  assert.equal(calls, 6);
});

test('simulated 100 clients with four chart surfaces cut quiet reads without cross-account sharing', async () => {
  let now = 0, network = 0;
  const clients = Array.from({ length: 100 }, (_, i) => createConditionalPollFetch(async () => {
    network++; return json({ serverTime: now + 1000, version: 1, entries: [] });
  }, () => `account-${i}`, { background: true, now: () => now }));
  for (now = 0; now < 120000; now += 5000)
    await Promise.all(clients.flatMap(read => Array.from({ length: 4 }, () => read(url))));
  const baseline = 100 * 4 * 24;
  assert.ok(network <= 800, `${network} of ${baseline}`);
  console.log(`isolated quiet-read simulation: baseline=${baseline}, optimized=${network}, reduction=${((1-network/baseline)*100).toFixed(1)}%`);
});
