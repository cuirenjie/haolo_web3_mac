import test from 'node:test';
import assert from 'node:assert/strict';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {saveNewsImage} from '../src/main/market-news-share.mjs';

test('news requests authenticate, validate input and send idempotent vote state',async()=>{
  const client=new YouleApiClient();client.loaded=true;client.baseUrl='https://haolo.example';
  const calls=[];client.requestJson=async(url,options)=>{calls.push({url,options});return {items:[]};};
  await assert.rejects(client.marketNewsRequest());assert.equal(calls.length,0);
  client.token='test';
  await client.marketNewsRequest({day:'2026-10-24',cursor:'123',language:'en'});
  assert.equal(new URL(calls[0].url).searchParams.get('day'),'2026-10-24');
  assert.equal(calls[0].options.headers.Authorization,'Bearer test');
  for(const direction of [1,1,0,-1])await client.marketNewsRequest({id:'123',direction},'vote');
  assert.equal(calls[1].options.method,'PUT');
  assert.equal(calls[1].options.headers['content-type'],'application/json');
  assert.deepEqual(calls.slice(1).map(c=>JSON.parse(c.options.body).direction),[1,1,0,-1]);
  for(const params of [{id:'../123',direction:1},{id:'123',direction:2},{id:'123',direction:'1'}])await assert.rejects(client.marketNewsRequest(params,'vote'));
  assert.equal(calls.length,5);
  client.requestJson=async()=>{client.authRevision++;return {};};
  await assert.rejects(client.marketNewsRequest(),/SESSION_CHANGED/);
});

test('news image save rejects non-images and respects cancellation/session changes',async()=>{
  let calls=0;const dialog={showSaveDialog:async()=>{calls++;return {canceled:true};}};
  await assert.rejects(saveNewsImage({dataUrl:'data:text/plain;base64,AAAA',dialog}));assert.equal(calls,0);
  const dataUrl='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  assert.deepEqual(await saveNewsImage({dataUrl,dialog,language:'en',valid:()=>true}),{saved:false});
  assert.equal(calls,1);
});
