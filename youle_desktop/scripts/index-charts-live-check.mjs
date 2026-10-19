// Read-only, existing user session; never write or print authentication material.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {PRIORITY_INDICES} from '../src/shared/market-index-catalog.mjs';
const output=path.resolve('youle_desktop/output/index-charts-20261019');
const saved=JSON.parse(await readFile(path.join(process.env.APPDATA,'haolo_desktop','haolo-session.json'),'utf8'));
assert.ok(saved.token);let requests=0;const commits=new Set();
const client=new YouleApiClient({serviceFetch:async(url,options)=>{assert.equal(options.method,'GET');assert.match(String(url),/^https:\/\/haolo.com\/api\/market-data\/indices(?:\/|$)/);requests++;const r=await fetch(url,options);commits.add(r.headers.get('x-haolo-backend'));return r;}});
client.loaded=true;client.baseUrl='https://haolo.com';client.token=saved.token;client.deviceId=saved.deviceId;
const fixtures={snapshot:await client.getMarketIndices(),charts:{}};
for(const item of PRIORITY_INDICES){
 const capabilities=await client.getIndexChart({indexId:item.id});assert.equal(capabilities.status,'ready');assert.ok(capabilities.periods.length);
 const periods={};for(const period of capabilities.periods){await new Promise(r=>setTimeout(r,750));const value=await client.getIndexChart({indexId:item.id,period});assert.equal(value.status,'ready',item.id+' '+period);assert.ok(value.candles.length);for(let i=1;i<value.candles.length;i++)assert.ok(value.candles[i].time>value.candles[i-1].time);periods[period]=value;}
 fixtures.charts[item.id]={capabilities,periods};console.log(JSON.stringify({index:item.id,periods:capabilities.periods}));
}
const before=fixtures.charts['index:gold'].periods['1d'].candles[0].time;
fixtures.olderGold=await client.getIndexChart({indexId:'index:gold',period:'1d',before});assert.ok(fixtures.olderGold.candles.every(row=>row.time<before));
assert.equal((await client.getIndexChart({indexId:'index:btc-ahr999',period:'1h'})).status,'unsupported');
for(const language of ['zh-CN','en','zh-TW']){const response=await fetch('https://haolo.com/api/market-data/indices/index%3Agold/chart',{headers:{'Accept-Language':language}});assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/aicoin|accesskey|signature/i);}
assert.doesNotMatch(JSON.stringify(fixtures),/aicoin|accesskey|accesssecret|signature|sourceurl|i:ixic:/i);
assert.deepEqual([...commits],['4c4c5b0756bff283778988b98b47321b29e4eb08']);
await mkdir(output,{recursive:true});await writeFile(path.join(output,'fixtures-production.json'),JSON.stringify(fixtures));
const report={status:'passed',checkedAt:new Date().toISOString(),sourceCommit:[...commits][0],indices:9,periods:Object.values(fixtures.charts).reduce((n,c)=>n+c.capabilities.periods.length,0),requests,neutralDTO:true,anonymous401:true,exclusivePaging:true};
await writeFile(path.join(output,'production-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
