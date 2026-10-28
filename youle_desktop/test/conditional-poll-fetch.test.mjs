import test from 'node:test';
import assert from 'node:assert/strict';
import { createConditionalPollFetch } from '../src/main/conditional-poll-fetch.mjs';

const url = 'https://test/api/mobile/v1/client-settings';
const initial = () => new Response(JSON.stringify({ entries: [{ value: '001.000' }], version: 1, serverTime: 1000 }), { headers: { etag: 'W/"1"' } });

test('alert list joins concurrent readers and backs off while single-item readback remains available',async()=>{
  let calls=0,release,now=1000;
  const read=createConditionalPollFetch(async(url)=>{
    calls++;
    if(url.endsWith('/alerts')) {await new Promise(r=>{release=r;});return new Response('{}',{status:429,headers:{'retry-after':'5'}});}
    return new Response('{"id":"saved"}');
  },()=> 'account',{background:true,now:()=>now,random:()=>0});
  const url='https://test/api/mobile/v1/alerts';
  const readers=Array.from({length:12},()=>read(url));
  release();
  assert.ok((await Promise.all(readers)).every(r=>r.status===429));assert.equal(calls,1);
  assert.equal((await read(url)).status,429);assert.equal(calls,1);
  assert.equal((await read(url+'/saved')).status,200);assert.equal(calls,2);
  read.close();
});
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

test('topic hints and writes preserve Retry-After; only account changes reset the budget', async () => {
  let count=0, owner='one', now=1000;
  const fetch=createConditionalPollFetch(async(_url,init)=>{
    count++;return init.method==='PUT'?new Response('{}'):new Response('{}',{status:429,headers:{'retry-after':'60'}});
  },()=>owner,{background:true,now:()=>now,random:()=>0});
  await fetch(url);assert.equal(count,1);
  fetch.invalidateTopics(['settings','plans']);await fetch(url);assert.equal(count,1);
  await fetch(url,{method:'PUT'});await fetch(url);assert.equal(count,2);
  now+=60001;await fetch(url);assert.equal(count,3);
  owner='two';await fetch(url);assert.equal(count,4);
});

test('hint during an active read joins it, fences its cache and requires one fresh followup', async () => {
  let count=0,release;
  const fetch=createConditionalPollFetch(async()=>{
    count++;if(count===1)await new Promise(resolve=>{release=resolve;});return initial();
  },()=> 'one',{background:true});
  const first=fetch(url);fetch.invalidateTopics(['settings']);const joined=fetch(url);
  release();await Promise.all([first,joined]);assert.equal(count,1);
  await fetch(url);assert.equal(count,2);
  fetch.invalidateTopics(['plans']);await fetch(url);assert.equal(count,2);
});
