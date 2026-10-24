import test from 'node:test';
import assert from 'node:assert/strict';
import { createConditionalPollFetch } from '../src/main/conditional-poll-fetch.mjs';

const url = 'https://test/api/mobile/v1/client-settings';
const initial = () => new Response(JSON.stringify({ entries: [{ value: '001.000' }], version: 1, serverTime: 1000 }), { headers: { etag: 'W/"1"' } });
test('each poll hits network, 304 restores immutable receipt and refreshes clock', async () => {
  const requests = [];
  const fetch = createConditionalPollFetch(async (_url, init) => {
    requests.push(init);
    return requests.length === 1 ? initial() : new Response(null, { status: 304, headers: { etag: 'W/"1"', 'x-haolo-server-time': '2000' } });
  }, () => 'one');
  const first = await (await fetch(url)).json();
  first.entries[0].value = 'mutated';
  const second = await (await fetch(url)).json();
  assert.equal(second.entries[0].value, '001.000');
  assert.equal(second.serverTime, 2000);
  assert.equal(new Headers(requests[1].headers).get('if-none-match'), 'W/"1"');
  assert.equal(requests.length, 2);
});

test('write, changed account, different market and failures never reuse stale receipts', async () => {
  let owner = 'one', error = false;
  const requests = [];
  const fetch = createConditionalPollFetch(async (_url, init) => { requests.push(init); return error ? new Response('{}', { status: 401 }) : initial(); }, () => owner);
  await fetch(url);
  await fetch(url, { method: 'PUT', body: '{}' });
  await fetch(url);
  assert.equal(new Headers(requests.at(-1).headers).get('if-none-match'), null);
  owner = 'two'; await fetch(url);
  assert.equal(new Headers(requests.at(-1).headers).get('if-none-match'), null);
  await fetch(url + '?market=other');
  assert.equal(new Headers(requests.at(-1).headers).get('if-none-match'), null);
  error = true;
  assert.equal((await fetch(url)).status, 401);
  error = false; await fetch(url);
  assert.equal(new Headers(requests.at(-1).headers).get('if-none-match'), null);
});

test('in-flight 304 across a write rechecks and abort/network errors propagate', async () => {
  let release, count = 0;
  const fetch = createConditionalPollFetch(async (_url, init) => {
    count++;
    if (count === 2) return new Promise(resolve => { release = resolve; });
    if (init.signal?.aborted) throw init.signal.reason;
    return initial();
  }, () => 'one');
  await fetch(url);
  const reading = fetch(url);
  await fetch(url, { method: 'PUT' });
  release(new Response(null, { status: 304 }));
  assert.equal((await reading).status, 200);
  assert.equal(count, 4);
  await assert.rejects(fetch(url, { signal: AbortSignal.abort(new Error('offline')) }), /offline/);
});

test('concurrent large reads of one URL do not double count cache memory or lose its validator', async () => {
  let lastHeaders;
  const fetch = createConditionalPollFetch(async (_url, init) => {
    lastHeaders = init.headers;
    return new Response(JSON.stringify({ entries: ['x'.repeat(1_100_000)] }), { headers: { etag: 'W/"large"' } });
  }, () => 'one');
  await Promise.all(Array.from({ length: 10 }, () => fetch(url)));
  await fetch(url);
  assert.equal(new Headers(lastHeaders).get('if-none-match'), 'W/"large"');
});
