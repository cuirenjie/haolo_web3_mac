import test from 'node:test';
import assert from 'node:assert/strict';
import {createProbabilitySupplementWatcher} from '../src/renderer/probability-supplement.ts';
import {probabilityReport} from './plan-probability-reply.test.mjs';
import {cloudTaskHistory} from '../src/main/trading-strategy-runtime/cloud-task-history.mjs';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const report=probabilityReport();
  const estimate=report.profitProbability;delete report.profitProbability;
  report.probabilitySupplement={schemaVersion:1,state:'pending',baseResultHash:report.resultHash,deadlineAt:Date.now()+90000};
  const item={id:'reply',text:'Completed analysis',status:'completed',drawingPlayback:{done:true},__youleCloudReports:[report]};
  const items={reply:item};const pauses=[];const applied=[];let scope='owner:1';let calls=0;
  let response={runId:report.runId,resultHash:report.resultHash,supplement:{...report.probabilitySupplement,state:'ready',estimate}};
  const observe=createProbabilitySupplementWatcher({scope:()=>scope,items:()=>items,
    wait:()=>new Promise(resolve=>pauses.push(resolve)),read:async()=>{calls++;return response;},
    apply:(_,value)=>{items[value.id]=value;applied.push(value);}});
  return {report,item,items,applied,observe,pauses,get calls(){return calls;},
    setScope:value=>{scope=value;},setResponse:value=>{response=value;},response};
}

test('late probability supplements the completed message once, preserving all primary interaction data',async()=>{
  const f=fixture(),before=structuredClone(f.item);
  f.observe('thread',f.item);f.observe('thread',f.item);
  assert.equal(f.pauses.length,1);assert.equal(f.calls,0);assert.deepEqual(f.items.reply,before);
  f.pauses.shift()();await tick();
  assert.equal(f.applied.length,1);const after=f.items.reply;
  assert.equal(after.text,before.text);assert.equal(after.status,'completed');
  assert.strictEqual(after.drawingPlayback,f.item.drawingPlayback);
  assert.deepEqual(after.__youleCloudReports[0].executionPlan,before.__youleCloudReports[0].executionPlan);
  assert.deepEqual(after.__youleCloudReports[0].planRecords,before.__youleCloudReports[0].planRecords);
  assert.equal(after.__youleCloudReports[0].profitProbability.assessments[0].profitProbabilityPercent,62.75);
  f.observe('thread',after);assert.equal(f.pauses.length,0);
});

test('account switch, removed message and mismatched immutable receipt discard late cards',async()=>{
  for(const change of ['owner','removed','hash','geometry']) {
    const f=fixture();f.observe('thread',f.item);
    if(change==='owner')f.setScope('owner:2');
    if(change==='removed')delete f.items.reply;
    if(change==='hash')f.response.supplement.baseResultHash='0'.repeat(64);
    if(change==='geometry')f.response.supplement.estimate.assessments[0].entry+=1;
    f.pauses.shift()();await tick();
    if(change==='geometry'||change==='hash')assert.equal(f.items.reply.__youleCloudReports[0].profitProbability,undefined);
    else assert.equal(f.applied.length,0);
  }
});

test('optional polling is bounded and transport failure cannot fail the main message',async()=>{
  const f=fixture();let reads=0;
  const observe=createProbabilitySupplementWatcher({scope:()=> 'owner',items:()=>f.items,wait:async()=>{},
    read:async()=>{reads++;throw Error('offline');},apply:(_,item)=>{
      assert.equal(item.__youleCloudReports[0].probabilitySupplement.state,'omitted');
      assert.equal(item.__youleCloudReports[0].profitProbability,undefined);
    }});
  observe('thread',f.item);await tick();
  assert.equal(reads,45);assert.equal(f.item.status,'completed');
});

test('history restores ready optional commentary while its original result hash stays frozen',()=>{
  const f=fixture(),r=f.report,taskId='00000000-0000-4000-8000-000000000099';
  const response={strategy:{id:r.strategyId},snapshot:{marketId:r.marketId,interval:r.interval},
    executionPlan:r.executionPlan,analysisPlan:{report:r.report},
    cloud:{executionPolicy:'entry-v2',runId:r.runId,resultHash:r.resultHash,locale:r.locale,planRecords:r.planRecords}};
  const history=cloudTaskHistory({id:taskId,context:{taskId},runs:[{id:r.runId,context:{taskId},state:'succeeded',
    text:r.report,desktopResult:response,probabilitySupplement:f.response.supplement}]},r.runId);
  assert.equal(history.items[0].__youleCloudReports[0].profitProbability.assessments[0].profitProbabilityPercent,62.75);
  assert.equal(response.analysisPlan.profitProbability,undefined);
  assert.equal(response.cloud.resultHash,r.resultHash);
});

test('optional IPC read enforces account and receipt identity',async()=>{
  const f=fixture();let ownerId='owner';
  const plans=createCloudPlans({owner:async()=>({ownerId,accountId:ownerId,baseUrl:'https://example.test'}),
    api:()=>({tradingCloudRequest:async()=>({id:f.report.runId,state:'succeeded',
      desktopResult:{cloud:{resultHash:f.report.resultHash}},probabilitySupplement:f.response.supplement})})});
  const result=await plans.perform('probability',{runId:f.report.runId,resultHash:f.report.resultHash});
  assert.deepEqual(result,f.response);
  await assert.rejects(plans.perform('probability',{runId:f.report.runId,resultHash:'0'.repeat(64)}));
});
