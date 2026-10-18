// Invoked by the backend integration gate against its isolated loopback server.
import assert from 'node:assert/strict';
import {YouleApiClient} from '../../src/main/youle-api-client.mjs';
import {createCloudStrategyRuntime,validateCloudResult} from '../../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {createCloudPlans} from '../../src/main/trading-strategy-runtime/cloud-plans.mjs';
import {cloudReportFromResponse,cloudPlanCard} from '../../src/main/cloud-plan-contract.mjs';
import {tradingTranscriptInjectionItems,parseTradingTranscriptMarkerText} from '../../src/main/trading-expert-transcript.mjs';
import {executionPlanStickyHtml} from '../../src/main/execution-plan-sticky-view.mjs';
import {normalizeTradingAiDrawingPatch,persistTradingAiDrawingPatch,tradingDrawingSessionStorageKey} from '../../src/renderer/trading-expert-drawing.ts';
import {restoreRecoveredTradingDrawings,normalizeTradingIndicatorAiDrawingPatch} from '../../src/renderer/trading-expert-market.ts';

const [baseUrl,accountId,strategyId,analysisKind='strategy',entryMode='auto',language='en',windowJson='{}']=process.argv.slice(2);
const url=new URL(baseUrl);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
const api=new YouleApiClient({serviceFetch:(url,init)=>fetch(url,{...init,headers:{...init.headers,'X-Test-User':accountId}})});
api.loaded=true;api.baseUrl=baseUrl;api.profile={id:accountId};api.token='isolated-fixture-token';
const account={ownerId:`${baseUrl}::${accountId}`,accountId,baseUrl};
const prefs=await api.tradingCloudRequest('preferences',{}, {expectedAccountId:accountId,expectedBaseUrl:baseUrl});
const records=new Map();
const journal={async get(owner,key){return structuredClone(records.get(`${owner}:${key}`)??null);},async put(owner,key,value){records.set(`${owner}:${key}`,structuredClone(value));},async list(){return [...records.values()];}};
const runtime=createCloudStrategyRuntime({owner:async()=>account,api:()=>api,journal,pollMs:50});
const result=await runtime.run(strategyId,{analysisJobId:'http-chain-fixture',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
  ...JSON.parse(windowJson),
  analysisKind,positionManagementRequested:analysisKind==='general',
  analysisContext:analysisKind==='general'?{intent:'position-management',position:{side:'long',entries:[{price:130,quantity:1}],requestedActions:['reduce']}}:null,
  entryMode,sourceThreadId:'original-sdk-thread',storageSessionId:'original-sdk-pane',
  language,instruction:'Analyze this chart and provide the validated strategy report.',preferencesRevision:prefs.revision,preferencesHash:prefs.configHash});
assert.equal(result.strategy.id,strategyId);
assert.ok(result.analysisPlan.drawingPatch.operations.length);
assert.equal(result.cloud.appliedPreferences.configHash,prefs.configHash);
assert.equal(result.executionPlan.schemaVersion,2);
assert.equal(result.executionPlan.requestedMode,entryMode);
assert.equal(result.cloud.origin.sourceThreadId,'original-sdk-thread');
const drawn=normalizeTradingAiDrawingPatch(result.analysisPlan.drawingPatch);
const drawingStorage=new Map();
globalThis.window={localStorage:{getItem:k=>drawingStorage.get(k)??null,setItem:(k,v)=>drawingStorage.set(k,v),removeItem:k=>drawingStorage.delete(k)}};
persistTradingAiDrawingPatch('original-sdk-pane',result.analysisPlan.drawingPatch);
if(analysisKind!=='general') {
  assert.deepEqual(drawn[0].entryConditionRef,result.analysisPlan.drawingPatch.entryConditionRef);
  assert.deepEqual(JSON.parse(drawingStorage.get(tradingDrawingSessionStorageKey('ai','original-sdk-pane')))[0].entryConditionRef,drawn[0].entryConditionRef);
}
const recovered=await runtime.resume('http-chain-fixture');
assert.deepEqual(recovered,result);
const reports=cloudReportFromResponse(result);
if(result.analysisPlan.indicatorDrawingPatch) {
  const indicator=normalizeTradingIndicatorAiDrawingPatch(result.analysisPlan.indicatorDrawingPatch);
  if(result.executionPlan.scenarios.length)assert.deepEqual(indicator.entryConditionRef,result.analysisPlan.drawingPatch.entryConditionRef);
}
restoreRecoveredTradingDrawings(reports[0],'restored-original-pane');
assert.ok(drawingStorage.has(tradingDrawingSessionStorageKey('ai','restored-original-pane')));
restoreRecoveredTradingDrawings({...reports[0],origin:{...reports[0].origin,analysisJobId:'original:pane:2'}},'restored-original-pane');
assert.ok(drawingStorage.has(tradingDrawingSessionStorageKey('ai','restored-original-pane::split-pane:2')));
const history=tradingTranscriptInjectionItems([{id:'report',role:'assistant',text:result.analysisPlan.report,createdAt:new Date().toISOString(),cloudReports:reports}]);
assert.deepEqual(parseTradingTranscriptMarkerText(history[0].content[0].text).cloudReports,reports);
const plans=createCloudPlans({owner:async()=>account,api:()=>api});
if(analysisKind!=='general') {
  const original=result.cloud.planRecords[0];
  const reference={planId:original.id,runId:original.runId,version:original.version,confirmationHash:original.confirmationHash,conditionHash:original.scenario.conditionHash};
  const card=cloudPlanCard(reports[0]);assert.ok(card.html.includes(String(original.scenario.stop)));
  const sticky=executionPlanStickyHtml({cloudReport:reports[0]});assert.ok(sticky.includes(card.html));
  const record=await journal.get(account.ownerId,'http-chain-fixture');
  const runEnvelope={...record.body,id:record.runId,desktopResult:result};
  for(const tamper of [
    r=>{r.executionPlan.requestedMode='invalid';},
    r=>{r.cloud.conditionReceipts[0].canonicalJson+=' ';},
    r=>{r.cloud.planRecords[0].alertPreview.entryCondition.trigger.lower+=1;},
    r=>{r.analysisPlan.drawingPatch.entryConditionRef.conditionHash='f'.repeat(64);},
    r=>{r.executionPlan.conditionHash='f'.repeat(64);},
    r=>{r.cloud.planIds=[];},
  ]) {
    const changed=structuredClone(result);tamper(changed);
    assert.throws(()=>validateCloudResult({...runEnvelope,desktopResult:changed},record),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  }
  const activated=await plans.perform('activate',reference);
  assert.equal(activated.plan.status,'pending');assert.equal(activated.alert.rule.conditionHash,reference.conditionHash);
  const repeated=await plans.perform('activate',reference);
  assert.equal(repeated.plan.linkedAlertId,activated.plan.linkedAlertId);assert.equal(repeated.plan.version,activated.plan.version);
  const listed=await plans.perform('list');assert.equal(listed.reports[0].planRecords[0].id,original.id);
  const ended=await plans.perform('lifecycle',{...reference,version:activated.plan.version,status:'ended',endReason:'cancelled'});
  assert.equal(ended.plan.status,'ended');assert.equal(ended.alert.enabled,false);
  const replay=await plans.perform('lifecycle',{...reference,version:activated.plan.version,status:'ended',endReason:'cancelled'});
  assert.equal(replay.plan.version,ended.plan.version);
  assert.equal((await plans.perform('delete',{...reference,version:ended.plan.version})).status,'deleted');
  assert.equal((await plans.perform('delete',{...reference,version:ended.plan.version})).status,'deleted');
  assert.deepEqual((await plans.perform('list')).reports,[]);
} else {assert.equal(cloudPlanCard(reports[0]),null);assert.deepEqual((await plans.perform('list')).reports,[]);}
await runtime.acknowledge('http-chain-fixture');
assert.deepEqual(await runtime.pending(),[]);
console.log(JSON.stringify({ok:true,runId:result.cloud.runId,strategyId,drawingCount:result.analysisPlan.drawingPatch.operations.length,planIds:result.cloud.planIds}));
