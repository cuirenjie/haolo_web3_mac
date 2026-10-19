import assert from 'node:assert/strict';
import test from 'node:test';
import { YouleApiClient } from '../src/main/youle-api-client.mjs';

test('index history uses authenticated neutral routes and an exclusive server cursor',async()=>{
  const client=new YouleApiClient();client.loaded=true;client.baseUrl='https://haolo.example';
  let request;client.requestJson=async(url,options)=>{request={url,options};return {};};
  await assert.rejects(client.getIndexChart({indexId:'index:gold'}));
  assert.equal(request,undefined);client.token='test-session';
  await client.getIndexChart({indexId:'index:gold'});
  assert.equal(request.url,'https://haolo.example/api/market-data/indices/index%3Agold/chart');
  assert.equal(request.options.headers.Authorization,'Bearer test-session');
  assert.equal(request.options.method,'GET');
  await client.getIndexChart({indexId:'index:gold',period:'1d',before:1790000000});
  const url=new URL(request.url);
  assert.equal(url.pathname,'/api/market-data/indices/index%3Agold/candles');
  assert.equal(url.searchParams.get('period'),'1d');assert.equal(url.searchParams.get('before'),'1790000000');
  assert.equal(url.searchParams.get('limit'),'300');
  assert.doesNotMatch(request.url,/aicoin|signature|accesskey/i);
});

test('renderer input cannot select hosts, raw source symbols, unsupported periods or bad cursors',async()=>{
  const client=new YouleApiClient();client.loaded=true;client.token='test-session';
  let requests=0;client.requestJson=async()=>{requests++;return {};};
  for(const params of [{indexId:'https://example.com'},{indexId:'i:ixic:nasdaq'},
    {indexId:'index:gold',period:'1s'},{indexId:'index:gold',before:NaN},
    {indexId:'index:gold',before:'1234'},{indexId:'index:gold',before:0}]){
    await assert.rejects(client.getIndexChart(params));
  }
  assert.equal(requests,0);
});
