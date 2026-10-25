// Existing session only. The temporary vote is restored, and authentication is never logged.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
const output=path.resolve('youle_desktop/output/flash-news-20261025');
const saved=JSON.parse(await readFile(path.join(process.env.APPDATA,'haolo_desktop','haolo-session.json'),'utf8'));
assert.ok(saved.token);const commits=new Set();let requests=0;
const client=new YouleApiClient({serviceFetch:async(url,options)=>{
  assert.match(String(url),/^https:\/\/haolo.com\/api\/market-data\/news(?:[/?]|$)/);
  assert.ok(['GET','PUT'].includes(options.method));requests++;
  const result=await fetch(url,options);commits.add(result.headers.get('x-haolo-backend'));return result;
}});
client.loaded=true;client.baseUrl='https://haolo.com';client.token=saved.token;client.deviceId=saved.deviceId;
const latest=await client.marketNewsRequest({});assert.equal(latest.status,'ready');assert.equal(latest.items.length,30);
const older=await client.marketNewsRequest({cursor:latest.nextCursor});assert.equal(older.status,'ready');assert.equal(older.items.length,30);
assert.ok(older.items.every(row=>!latest.items.some(first=>first.id===row.id)));
const day=new Date(Date.now()+8*3600_000-86400_000).toISOString().slice(0,10);
const history=await client.marketNewsRequest({day});assert.equal(history.status,'ready');assert.ok(history.items.length);
assert.ok(history.items.every(row=>new Date(row.timestamp*1000+8*3600_000).toISOString().slice(0,10)===day));
const english=await client.marketNewsRequest({language:'en'});assert.equal(english.status,'ready');assert.ok(english.items.length);
const id=latest.items[0].id;const initial=(await client.marketNewsRequest({id},'detail')).item;assert.ok(initial);
const baseUp=initial.bullish-(initial.vote===1?1:0),baseDown=initial.bearish-(initial.vote===-1?1:0);
try{
  const up=await client.marketNewsRequest({id,direction:1},'vote');assert.deepEqual([up.vote,up.bullish,up.bearish],[1,baseUp+1,baseDown]);
  const same=await client.marketNewsRequest({id,direction:1},'vote');assert.deepEqual(same,up);
  const down=await client.marketNewsRequest({id,direction:-1},'vote');assert.deepEqual([down.vote,down.bullish,down.bearish],[-1,baseUp,baseDown+1]);
  const detail=(await client.marketNewsRequest({id},'detail')).item;assert.equal(detail.vote,-1);
  const none=await client.marketNewsRequest({id,direction:0},'vote');assert.deepEqual([none.vote,none.bullish,none.bearish],[0,baseUp,baseDown]);
}finally{
  await client.marketNewsRequest({id,direction:initial.vote},'vote');
}
const restored=(await client.marketNewsRequest({id},'detail')).item;assert.equal(restored.vote,initial.vote);
const fixtures={latest,older,history,english};assert.doesNotMatch(JSON.stringify(fixtures),/aicoin|accesskey|accesssecret|signature/i);
assert.match(initial.url,/^https:\/\/haolo.com\/api\/market-data\/news\/share\/\d+$/);
const shared=await fetch(initial.url);assert.equal(shared.status,200);const html=await shared.text();assert.match(html,/Haolo/);assert.doesNotMatch(html,/aicoin|<script|upstreamBullish/i);assert.ok(shared.headers.get('content-security-policy'));
for(const locale of ['zh-CN','zh-TW','en','ko']){
  const r=await fetch('https://haolo.com/api/market-data/news',{headers:{'Accept-Language':locale}});assert.equal(r.status,401);
}
const auth={Authorization:`Bearer ${saved.token}`,'X-Device-Id':saved.deviceId||''};
const retired=await fetch('https://haolo.com/api/market-data/ifind/status',{headers:auth});assert.equal(retired.status,200);const status=(await retired.json()).status;assert.equal(status.enabled,false);assert.equal(status.available,false);
for(const route of ['search','quotes','snapshot','candles']){
  const r=await fetch(`https://haolo.com/api/market-data/ifind/${route}${route==='search'?'?q=600000':''}`,{method:route==='search'?'GET':'POST',headers:{...auth,'Content-Type':'application/json'},...(route==='search'?{}:{body:JSON.stringify(route==='quotes'?{symbols:['600000.SH']}:{symbol:'600000.SH',resolution:'1d',count:1})})});assert.equal(r.status,410);assert.match(await r.text(),/IFIND_DISABLED/);
}
assert.equal(commits.size,1);const sourceCommit=[...commits][0];assert.ok(sourceCommit.startsWith('9d55ef34'));
await writeFile(path.join(output,'fixtures-production.json'),JSON.stringify(fixtures));
const report={status:'passed',checkedAt:new Date().toISOString(),sourceCommit,requests,current:latest.items.length,older:older.items.length,history:history.items.length,english:english.items.length,day,exclusivePaging:true,accountVoteRestore:true,idempotentVote:true,switchVote:true,cancelVote:true,publicShareUrl:initial.url,haoloOnly:true,anonymous401:true,ifindRetired:true};
await writeFile(path.join(output,'production-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
