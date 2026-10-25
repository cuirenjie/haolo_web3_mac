import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { applyJsonDelta } from '../src/main/json-delta.mjs';
import { createConditionalPollFetch } from '../src/main/conditional-poll-fetch.mjs';
import { createResourceChangeFeed } from '../src/main/resource-change-feed.mjs';

test('real Python producer fixtures reconstruct exactly in the JavaScript consumer', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/json_delta_contract.json', import.meta.url)));
  for (const value of cases) assert.deepEqual(applyJsonDelta(value.old, value.patch), value.new);
});

test('delta preserves reorder, deletion, null, boolean/numeric differences and literal prototype keys', () => {
  const base = { items:[{id:'a',text:'full'},{id:'b',flag:1}], removed:true };
  const delta = ['o',['removed'],{items:['r',['b','c'],{b:['o',[],{flag:['v',true]}],c:['v',{id:'c',text:null}]}]}];
  assert.deepEqual(applyJsonDelta(base,delta),{items:[{id:'b',flag:true},{id:'c',text:null}]});
  assert.equal(base.items[1].flag,1);
  const pollution = applyJsonDelta({}, JSON.parse('["o",[],{"__proto__":["v",{"polluted":true}]}]'));
  assert.equal(Object.getPrototypeOf(pollution),Object.prototype);
  assert.equal(pollution.__proto__.polluted,true);
  assert.equal({}.polluted,undefined);
  for (const bad of [['r',['missing'],{}],['r',['a','a'],{}],['s',-1,1,[]],['s',0,100,[]]]) {
    assert.throws(()=>applyJsonDelta(base.items,bad));
  }
});

test('real fetch wrapper reconstructs deltas and retries corrupt/missing baselines once as full', async () => {
  let calls=0, bad=false;
  const initial = {history:'full history '.repeat(100),state:'running'};
  const read = createConditionalPollFetch(async (_url, init) => {
    calls++;
    if (!init.headers['If-None-Match']) return new Response(JSON.stringify(initial),{headers:{etag:'"a"'}});
    return new Response(JSON.stringify({base:bad?'"wrong"':'"a"',patch:['o',[],{state:['v','done']}]}),
      {headers:{etag:'"b"','x-haolo-json-delta':'1'}});
  },()=> 'owner');
  const path='https://example.test/api/mobile/v1/tasks/one';
  assert.deepEqual(await (await read(path)).json(),initial);
  assert.deepEqual(await (await read(path)).json(),{...initial,state:'done'});
  bad=true;
  assert.deepEqual(await (await read(path)).json(),initial);
  assert.equal(calls,4);
});

function harness() {
  let time=10000, owner='alice', pipe, requests=0, streams=0;
  let revision=1;
  const fetch = async (url, init) => {
    if (url.endsWith('/sync/changes')) {
      streams++;
      return new Response(new ReadableStream({start(c){pipe=c;init.signal.addEventListener('abort',()=>{try{c.close();}catch{}},{once:true});}}),
        {headers:{'content-type':'text/event-stream'}});
    }
    requests++;
    return new Response(JSON.stringify({serverTime:time,version:revision,entries:[]}),{headers:{etag:`"${revision}"`}});
  };
  const state = (stamp='a') => ({version:1,at:time,topics:Object.fromEntries(['settings','drawings','history','plans'].map(k=>[k,stamp.repeat(32)]))});
  return {fetch,scope:()=>owner,now:()=>time,advance(ms){time+=ms;},owner(value){owner=value;},revision(value){revision=value;},
    counts:()=>({requests,streams}),async event(type='state',stamp='a'){
      pipe.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(type==='state'?state(stamp):{at:time})}\n\n`));await turn();},
  };
}

test('healthy notifications suppress empty polls; changed version, expired lease and writes fetch current state', async () => {
  const h=harness(), read=createConditionalPollFetch(h.fetch,h.scope,{changes:true,now:h.now});
  const url='https://example.test/api/mobile/v1/client-settings', init={headers:{Authorization:'Bearer fixture'}};
  try {
    await read(url,init); await turn(); await h.event();
    h.advance(1000); await h.event('check');
    await read(url,init); // First data baseline under a verified stream.
    const before=h.counts().requests;
    for(let i=0;i<5;i++) await read(url,init);
    assert.equal(h.counts().requests,before);
    h.revision(2); h.advance(1000); await h.event('state','b');
    assert.equal((await (await read(url,init)).json()).version,2);
    assert.equal(h.counts().requests,before+1);
    h.advance(1900); await read(url,init);
    assert.equal(h.counts().requests,before+2);
    await read(url,{...init,method:'PUT'}); await read(url,init);
    assert.equal(h.counts().streams,1);
  } finally {read.close();}
});

test('buffered SSE, account switch and explicit reset never authorize snapshot reuse', async () => {
  const h=harness(), feed=createResourceChangeFeed(h.fetch,h.scope,{now:h.now});
  const init={headers:{Authorization:'Bearer fixture'}};
  try {
    feed.touch('https://example.test/',init);await turn();await h.event();
    await h.event('check');assert.equal(feed.state().healthy,false);
    h.advance(1000);await h.event('check');assert.equal(feed.state().healthy,true);
    h.owner('bob');assert.equal(feed.state().healthy,false);
    feed.touch('https://example.test/',init);await turn();await h.event('state','b');
    assert.equal(feed.state().healthy,false);
    h.advance(1000);await h.event('check');assert.equal(feed.state().healthy,true);
    await h.event('reset');assert.equal(feed.state().healthy,false);
  } finally {feed.close();}
});

test('run progress, events, plans and prices always perform a current network read', async () => {
  const h=harness(), read=createConditionalPollFetch(h.fetch,h.scope,{changes:true,now:h.now});
  try {
    for(const path of ['/api/mobile/v1/agent-runs/r','/api/mobile/v1/agent-runs/r/events',
      '/api/mobile/v1/plans','/api/mobile/v1/trading-plans','/api/market-data/indices']) {
      await read('https://example.test'+path);await read('https://example.test'+path);
    }
    assert.deepEqual(h.counts(),{requests:10,streams:0});
  } finally {read.close();}
});

test('closed stream cannot refresh a replacement lease even when transport ignores abort', async () => {
  let time = 10000;
  const pipes = [];
  const feed = createResourceChangeFeed(async () => new Response(new ReadableStream({ start(c) { pipes.push(c); } }),
    { headers: { 'content-type': 'text/event-stream' } }), () => 'same-account', { now: () => time });
  const emit = (pipe, stamp) => pipe.enqueue(new TextEncoder().encode(`event: state\ndata: ${JSON.stringify({version:1,at:time,
    topics:Object.fromEntries(['settings','drawings','history','plans'].map(k=>[k,stamp.repeat(32)]))})}\n\n`));
  try {
    feed.touch('https://example.test/', {headers:{Authorization:'Bearer fixture'}}); await turn();
    feed.close();
    feed.touch('https://example.test/', {headers:{Authorization:'Bearer fixture'}}); await turn();
    assert.equal(pipes.length, 2);
    emit(pipes[1], 'b'); await turn(); time += 1000;
    emit(pipes[1], 'b'); await turn(); assert.equal(feed.state().healthy, true);
    emit(pipes[0], 'a'); await turn();
    assert.equal(feed.state().topics.settings, 'b'.repeat(32));
  } finally { feed.close(); for (const pipe of pipes) { try {pipe.close();} catch {} } }
});
