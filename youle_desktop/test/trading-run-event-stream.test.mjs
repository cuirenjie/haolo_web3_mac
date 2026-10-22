import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForRunEvent} from '../src/main/trading-strategy-runtime/run-event-stream.mjs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';

const runId = '11111111-2222-4333-8444-555555555555';
function stream(chunks, {close=true}={}) {
  let cancelled=false, controller;
  const response=new Response(new ReadableStream({start(c){controller=c;for(const chunk of chunks)c.enqueue(new TextEncoder().encode(chunk));if(close)c.close();},cancel(){cancelled=true;}}),
    {headers:{'content-type':'text/event-stream'}});
  return {response,controller,cancelled:()=>cancelled};
}
const wait = (response,options={}) => waitForRunEvent({open:async()=>response,assertOwner:()=>{},...options});

test('SSE handles split CRLF/UTF-8, comments, duplicate cursors and multiline data; text never becomes a report',async()=>{
  const s=stream([': heartbeat\r\n\r','\nid: 5\r\nevent: message\r\ndata: {"sequence":5,\r\ndata: "text":"报告"}\r\n\r\n',
    'data: {"sequence":4}\n\nevent: complete\ndata: {}\n\n'],{close:false});
  assert.deepEqual(await wait(s.response,{after:3}),{cursor:5,completed:true,expired:false});
  assert.equal(s.cancelled(),true);
});

test('EOF and stream deadlines are bounded notifications, never successful results',async()=>{
  assert.deepEqual(await wait(stream(['data: {"sequence":8}\n\n']).response),{cursor:8,completed:false,expired:false});
  const s=stream([],{close:false});
  assert.deepEqual(await wait(s.response,{timeoutMs:15}),{cursor:0,completed:false,expired:true});
  assert.equal(s.cancelled(),true);
});

test('stop cancels an idle stream promptly and removes the reader',async()=>{
  const s=stream([],{close:false}), controller=new AbortController();
  const pending=wait(s.response,{signal:controller.signal});
  await new Promise(r=>setImmediate(r));controller.abort();
  await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(s.cancelled(),true);
});

test('bad content, malformed JSON and oversized events release the connection and fail to polling',async()=>{
  await assert.rejects(wait(new Response('{}',{headers:{'content-type':'application/json'}})),/UNAVAILABLE/);
  for(const data of ['data: {oops}\n\n','data: '+ 'x'.repeat(256*1024)]) {
    const s=stream([data],{close:false});await assert.rejects(wait(s.response));assert.equal(s.cancelled(),true);
  }
});

function api(fetch) {
  const client=new YouleApiClient({serviceFetch:fetch});
  client.loaded=true;client.baseUrl='https://haolo.example';client.token='test-account-token';client.profile={id:'account'};
  client.refreshAccessToken=async()=>client.token;
  return client;
}

test('stream uses the same authenticated account and exact run/cursor; a 401 refresh retries only the GET',async()=>{
  const requests=[];let refreshed=0;
  const client=api(async(url,init)=>{requests.push({url,init});return requests.length===1?new Response('',{status:401}):stream(['event: complete\n\n']).response;});
  client.refreshAccessToken=async({force})=>{if(force){refreshed++;client.token='refreshed-token';}return client.token;};
  const result=await client.waitForTradingCloudRunEvent(runId,{after:12,expectedAccountId:'account',expectedBaseUrl:client.baseUrl});
  assert.equal(result.completed,true);assert.equal(refreshed,1);assert.equal(requests.length,2);
  for(const request of requests){assert.equal(request.url,`https://haolo.example/api/mobile/v1/agent-runs/${runId}/stream?after=12`);assert.equal(request.init.method,'GET');assert.equal(request.init.body,undefined);}
  assert.equal(requests[1].init.headers.Authorization,'Bearer refreshed-token');
});

test('invalid identifiers, switched owner and switched base URL never open a stream',async()=>{
  let calls=0;const client=api(async()=>{calls++;throw Error('unexpected');});
  for(const [id,options] of [['../escape',{}],[runId,{after:-1}],[runId,{expectedAccountId:'other'}],[runId,{expectedBaseUrl:'https://other.example'}]])
    await assert.rejects(client.waitForTradingCloudRunEvent(id,options));
  assert.equal(calls,0);
});

test('account changes during token refresh cannot reconnect using the next account',async()=>{
  let calls=0;const client=api(async()=>{calls++;return new Response('',{status:401});});
  client.refreshAccessToken=async({force})=>{if(force)client.profile={id:'other'};return client.token;};
  await assert.rejects(client.waitForTradingCloudRunEvent(runId),e=>e.code==='TRADING_PREFERENCE_OWNER_CHANGED');assert.equal(calls,1);
});

test('account changes while reading a live stream discard its completion',async()=>{
  const s=stream([],{close:false});const client=api(async()=>s.response);
  const pending=client.waitForTradingCloudRunEvent(runId);await new Promise(r=>setImmediate(r));
  client.profile={id:'other'};s.controller.enqueue(new TextEncoder().encode('event: complete\n\n'));
  await assert.rejects(pending,e=>e.code==='TRADING_PREFERENCE_OWNER_CHANGED');assert.equal(s.cancelled(),true);
});
