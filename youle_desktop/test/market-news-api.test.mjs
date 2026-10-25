import test from 'node:test';
import assert from 'node:assert/strict';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {saveNewsImage} from '../src/main/market-news-share.mjs';
import {NEWS_CATEGORIES} from '../src/shared/market-news-categories.mjs';

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

test('news categories reach the authenticated API with dates and pagination intact',async()=>{
  const client=new YouleApiClient();client.loaded=true;client.baseUrl='https://haolo.example';client.token='test';
  const requests=[];client.requestJson=async(url,options)=>{requests.push({url:new URL(url),options});return {items:[]};};
  await client.marketNewsRequest();
  assert.equal(requests[0].url.searchParams.get('category'),'featured');
  for(const category of NEWS_CATEGORIES){
    await client.marketNewsRequest({category,day:'2026-10-25',cursor:'3140000',language:'en'});
    const {url,options}=requests.at(-1);
    assert.deepEqual(Object.fromEntries(url.searchParams),{category,day:'2026-10-25',cursor:'3140000',language:'en'});
    assert.equal(options.headers.Authorization,'Bearer test');assert.equal(options.method,'GET');
  }
  for(const category of ['unknown','',15,{},['fed']])await assert.rejects(client.marketNewsRequest({category}),/INVALID_NEWS_CATEGORY/);
  assert.equal(requests.length,NEWS_CATEGORIES.length+1);
});

test('news image save rejects non-images and respects cancellation/session changes',async()=>{
  let calls=0;const dialog={showSaveDialog:async()=>{calls++;return {canceled:true};}};
  await assert.rejects(saveNewsImage({dataUrl:'data:text/plain;base64,AAAA',dialog}));assert.equal(calls,0);
  const dataUrl='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  assert.deepEqual(await saveNewsImage({dataUrl,dialog,language:'en',valid:()=>true}),{saved:false});
  assert.equal(calls,1);
});
