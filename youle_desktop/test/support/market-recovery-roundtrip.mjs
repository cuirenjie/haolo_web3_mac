// Called only by market-recovery-http.py against its isolated loopback service.
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {YouleApiClient} from '../../src/main/youle-api-client.mjs';
import {CloudRunJournal} from '../../src/main/trading-strategy-runtime/cloud-run-journal.mjs';
import {createCloudStrategyRuntime} from '../../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudReportFromResponse,cloudPlanCard} from '../../src/main/cloud-plan-contract.mjs';
import {marketRecoveryProgressMessage} from '../../src/shared/market-recovery-progress.mjs';
import {normalizeTradingAiDrawingPatch} from '../../src/renderer/trading-expert-drawing.ts';

const [baseUrl,accountId,strategy,storagePath,mode='run',language='en',connectionId='']=process.argv.slice(2);
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
// Test-only encryption adapter: exercise the actual atomic journal on disk,
// without accessing or pretending to test the user's Windows DPAPI material.
const key=createHash('sha256').update('isolated market recovery fixture').digest();
const safeStorage={isEncryptionAvailable:()=>true,encryptString(value){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]);
},decryptString(value){
  const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));
  return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8');
}};
const journal=new CloudRunJournal({storagePath,safeStorage});
const api=new YouleApiClient({serviceFetch:(url,init)=>fetch(url,{...init,headers:{...init.headers,'X-Test-User':accountId}})});
Object.assign(api,{loaded:true,baseUrl,profile:{id:accountId},token:'isolated-fixture-token'});
const account={ownerId:`${baseUrl}::${accountId}`,accountId,baseUrl};
const calls=[],stages=[];let virtualWait=0,waiting=false;
const original=api.tradingCloudRequest.bind(api);
api.tradingCloudRequest=async(operation,...args)=>{calls.push(operation);return original(operation,...args);};
const runtime=createCloudStrategyRuntime({owner:async()=>account,api:()=>api,journal,pollMs:30,timeoutMs:60000,
  connection:async()=>connectionId?{id:connectionId}:null,
  now:()=>Date.now()+virtualWait,random:()=>0,wait:async(ms,_value,{signal}={})=>{
    if(waiting)virtualWait+=900000;
    await delay(Math.min(ms,20),undefined,{signal});
  }});
const controller=new AbortController();
const options={signal:controller.signal,onProgress:p=>{
  stages.push(p.stage);waiting=['market_waiting','market_quota_wait'].includes(p.stage);
  if(waiting)assert.ok(marketRecoveryProgressMessage(p.stage,language));
  if(p.stage==='market_waiting'&&mode==='cancel')controller.abort();
  if(p.stage==='market_waiting'&&mode==='restart-first')throw Object.assign(Error('simulated process restart'),{code:'FIXTURE_RESTART'});
}};
let result;
try {
  if(mode==='resume')result=await runtime.resume('durable-http-recovery',options);
  else {
    const prefs=await api.tradingCloudRequest('preferences');
    result=await runtime.run(strategy,{analysisJobId:'durable-http-recovery',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
      preferencesRevision:prefs.revision,preferencesHash:prefs.configHash,entryMode:'right',language,
      responseMode:'direct',instruction:'Analyze the frozen market evidence.',sourceThreadId:'recovery-fixture',storageSessionId:'recovery-fixture'},options);
  }
} catch(error) {
  const record=await journal.get(account.ownerId,'durable-http-recovery');
  if(mode==='cancel'&&error.code==='TRADING_ANALYSIS_CANCELLED') {
    assert.equal(record.state,'cancelled');console.log(JSON.stringify({ok:true,cancelled:true,runId:record.runId,calls,stages}));
  } else if(mode==='restart-first'&&error.code==='FIXTURE_RESTART') {
    assert.ok(record.runId);assert.equal(record.cancelRequested,undefined);
    console.log(JSON.stringify({ok:true,restart:true,runId:record.runId,calls,stages}));
  } else if(mode==='revoke'&&error.code==='CONSENT_REVOKED') {
    assert.equal(record.state,'failed');
    console.log(JSON.stringify({ok:true,revoked:true,runId:record.runId,calls,stages}));
  } else throw error;
}
if(result) {
  assert.equal(result.ok,true);assert.equal(result.strategy.id,strategy);
  assert.equal(result.executionPlan.schemaVersion,2);
  assert.ok(result.analysisPlan.report.trim());
  const reports=cloudReportFromResponse(result);assert.equal(reports.length,1);
  const card=cloudPlanCard(reports[0]);
  if(result.executionPlan.scenarios.length)assert.ok(card?.html);
  const drawings=normalizeTradingAiDrawingPatch(result.analysisPlan.drawingPatch);
  const recovered=await runtime.resume('durable-http-recovery');assert.deepEqual(recovered,result);
  assert.equal(calls.filter(c=>c==='createRun').length,mode==='resume'?0:1);
  await runtime.acknowledge('durable-http-recovery');assert.deepEqual(await runtime.pending(),[]);
  console.log(JSON.stringify({ok:true,runId:result.cloud.runId,calls,stages,virtualWait,drawings:drawings.length,hasPlan:!!card}));
}
