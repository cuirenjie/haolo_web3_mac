import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavedPlanSourceResolver,resolveSavedPlanSource,linkSavedPlanSource,isObsoletePlanRecoveryNotice} from '../src/renderer/saved-plan-source.ts';
import {createSavedExecutionPlan} from '../src/renderer/execution-plans.ts';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {cloudAccountPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
const plan=()=>{const report=cloudAccountPlanCardFixture();return createSavedExecutionPlan({candidate:{...cloudPlanCard(report),cloudReport:report},sourceThreadId:`cloud-run:${report.runId}`,sourceMessageId:'missing'});};
function harness(){let scope='a',reads=[],restored=0,saved=[];const deps={scope:()=>scope,lookup:p=>resolveSavedPlanSource(p,id=>id,id=>id==='hidden'),
  read:async id=>{reads.push(id);},findOriginal:async p=>{restored++;return {threadId:'original-cloud-task',messageId:p.id};},save:async(p,s)=>{saved.push(linkSavedPlanSource(p,s));}};
  return {deps,reads,saved,switch:()=>scope='b',get restored(){return restored;}};}
test('cloud placeholder is repaired by exact origin on list refresh; canonical local links survive stale server origin',()=>{
  const p=plan(),r=structuredClone(p.cloudReport);r.origin={sourceThreadId:'found',storageSessionId:'found',analysisJobId:'job'};
  assert.equal(mergeCloudExecutionPlans([r],[p])[0].sourceThreadId,'found');
  const linked=linkSavedPlanSource(p,{threadId:'canonical',messageId:'message'});
  assert.equal(mergeCloudExecutionPlans([r],[linked])[0].sourceThreadId,'canonical');
});
test('draft aliases resolve before hidden filtering and fall back to canonical cloud origin',()=>{
  const p=plan();p.sourceThreadId='draft';p.cloudReport.origin={sourceThreadId:'cloud'};
  assert.equal(resolveSavedPlanSource(p,id=>id==='draft'?'real':id,id=>id==='draft'),'real');
  assert.equal(resolveSavedPlanSource(p,id=>id,id=>id==='draft'),'cloud');
});
test('existing source is read and saved without reconstructing any conversation',async()=>{
  const p=plan();p.sourceThreadId='original';const h=harness();
  assert.equal(await createSavedPlanSourceResolver(h.deps)(p,()=>true),'original');
  assert.deepEqual(h.reads,['original']);assert.equal(h.restored,0);assert.equal(h.saved[0].sourceThreadId,'original');
});
test('missing cloud source finds the original historical task only once and persists the binding',async()=>{
  const p=plan(),h=harness(),resolve=createSavedPlanSourceResolver(h.deps);
  const [a,b]=await Promise.all([resolve(p,()=>true),resolve(p,()=>true)]);
  assert.equal(a,'original-cloud-task');assert.equal(b,a);assert.equal(h.restored,1);assert.equal(h.saved.length,1);
  assert.equal(isObsoletePlanRecoveryNotice(`saved-plan-report-${p.cloudReport.runId}-notice`),true);
  assert.equal(isObsoletePlanRecoveryNotice(p.cloudReport.runId),false);
});
test('permanent missing thread permits lookup; transient history failure never duplicates history',async()=>{
  for(const message of ['thread not found','no rollout found for thread id','network timeout']){
    const p=plan();p.sourceThreadId='original';const h=harness();h.deps.read=async()=>{throw Error(message);};
    if(message==='network timeout'){await assert.rejects(createSavedPlanSourceResolver(h.deps)(p,()=>true),/network timeout/);assert.equal(h.restored,0);}
    else {assert.equal(await createSavedPlanSourceResolver(h.deps)(p,()=>true),'original-cloud-task');assert.equal(h.restored,1);}
  }
});
test('account switch and selection changes abandon asynchronous lookup before saving or navigation',async()=>{
  for(const stage of ['read','findOriginal']){
    const p=plan(),h=harness();if(stage==='read')p.sourceThreadId='original';
    h.deps[stage]=async()=>{h.switch();return {threadId:'old-account'};};
    assert.equal(await createSavedPlanSourceResolver(h.deps)(p,()=>true),'');assert.equal(h.saved.length,0);
  }
  const h=harness();let valid=true;h.deps.findOriginal=async()=>{valid=false;return {threadId:'stale'};};
  assert.equal(await createSavedPlanSourceResolver(h.deps)(plan(),()=>valid),'');assert.equal(h.saved.length,0);
});
test('legacy plans without a source never fabricate a conversation or analysis',async()=>{
  const p=plan();delete p.cloudReport;const h=harness();
  await assert.rejects(createSavedPlanSourceResolver(h.deps)(p,()=>true),/unavailable/);assert.equal(h.restored,0);
});

test('synthetic recovered record is never accepted as original provenance',async()=>{
  const p=plan();p.sourceThreadId='wrong-restored';p.sourceMessageId=`saved-plan-report-${p.cloudReport.runId}`;
  p.cloudReport.origin={sourceThreadId:'wrong-restored'};
  assert.equal(resolveSavedPlanSource(p,id=>id,()=>false),'');
  const h=harness();h.deps.findOriginal=async()=>null;
  await assert.rejects(createSavedPlanSourceResolver(h.deps)(p,()=>true),/unavailable/);
  assert.equal(h.saved.length,0);
});
