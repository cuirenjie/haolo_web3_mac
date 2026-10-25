import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';
import {validateCloudResult} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudPlanListResponse} from '../src/main/cloud-plan-sync-response.mjs';
import {createCloudPlanRefresher} from '../src/renderer/cloud-plan-sync.ts';

// Synthetic server-generated plans shared with the existing transport tests.
// Real prompts, account details and production plans must never be fixtures.
const samples=JSON.parse(fs.readFileSync(new URL('./fixtures/wyckoff-retest-public.json',import.meta.url),'utf8')).cases;
const owner={ownerId:'fixture-owner',accountId:'fixture-account',baseUrl:'https://fixture.invalid'};
function fixture(locale='zh-CN',side='long',{legacy=false}={}) {
  const {result,record}=structuredClone(samples.find(s=>s.locale===locale&&s.kind===side));
  const prompt=`Synthetic ${side} request`,p=result.executionPlan;
  if(!legacy)p.requestRequirements={version:'analysis-request-v1',
    promptHash:createHash('sha256').update(JSON.stringify(prompt)).digest('hex'),direction:side,entryMode:'left',
    overrides:[],removedPreferences:[],savedRevision:result.cloud.appliedPreferences.revision};
  result.ok=true;
  Object.assign(result.analysisPlan,{marketId:result.snapshot.marketId,interval:result.snapshot.interval,
    analysisId:result.analysisPlan.drawingPatch?.analysisId});
  result.analysisPlan.executionPlan=structuredClone(p);
  result.cloud.planRecords[0].executionPlan=structuredClone(p);
  const plan={...structuredClone(result.cloud.planRecords[0]),saved:true,status:'pending',version:2};
  const receipt={id:result.cloud.runId,clientContract:'windows-v1',strategy:result.strategy.id,
    context:record.body.context,locale,executionPolicy:'entry-v2',desktopResult:result};
  const liveRecord={...record,runId:receipt.id,marketId:result.snapshot.marketId,interval:result.snapshot.interval,
    preferencesHash:plan.appliedPreferences.configHash,body:{...receipt,prompt,preferencesRevision:plan.appliedPreferences.revision}};
  return {plan,receipt,liveRecord,prompt};
}
function service(f,{fallback=false}={}) {
  const calls=[];
  const plans=createCloudPlans({owner:async()=>owner,api:()=>({tradingCloudRequest:async(action)=>{
    calls.push(action);
    if(action==='plans')return {items:[f.plan],receipts:fallback?{}:{[f.plan.id]:f.receipt},nextCursor:null};
    if(action==='run'&&fallback)return {...f.receipt,prompt:f.prompt};
    assert.fail(`Unexpected operation: ${action}`);
  }})});
  return {plans,calls};
}

for(const locale of ['zh-CN','en','zh-Hant'])for(const side of ['long','short']) {
  test(`saved constrained plan synchronizes after original history is gone: ${locale}/${side}`,async()=>{
    const f=fixture(locale,side),before=structuredClone(f),{plans,calls}=service(f);
    const loaded=await plans.perform('list');
    assert.equal(loaded.reports.length,1);
    assert.deepEqual(loaded.reports[0].executionPlan,f.plan.executionPlan);
    assert.deepEqual(calls,['plans'],'a retained receipt must not depend on deleted run history');
    assert.deepEqual(f,before,'read-only validation must not rewrite the frozen receipt');
  });
}
test('legacy receipts and full-run fallback remain readable',async()=>{
  for(const [f,options] of [[fixture('zh-CN','long',{legacy:true}),{}],[fixture(),{fallback:true}]]) {
    const {plans,calls}=service(f,options);
    assert.equal((await plans.perform('list')).reports.length,1);
    assert.deepEqual(calls,options.fallback?['plans','run']:['plans']);
  }
});
test('live analysis still requires the original prompt, with a structured error for invalid types',()=>{
  const f=fixture();
  assert.doesNotThrow(()=>validateCloudResult(f.receipt,f.liveRecord));
  for(const prompt of [undefined,null,42,{},'wrong original prompt']) {
    const record=structuredClone(f.liveRecord);record.body.prompt=prompt;
    assert.throws(()=>validateCloudResult(f.receipt,record),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  }
});
const corruptions={
  'different run':f=>{f.receipt.id='00000000-0000-4000-8000-000000000099';},
  'different saved plan':f=>{f.plan.id='00000000-0000-4000-8000-000000000099';},
  'different request receipt':f=>{f.plan.executionPlan.requestRequirements.promptHash='f'.repeat(64);},
  'different preferences':f=>{f.plan.appliedPreferences.revision++;},
  'different context':f=>{f.plan.context.snapshotId='changed';},
  'changed condition bytes':f=>{f.receipt.desktopResult.cloud.conditionReceipts[0].canonicalJson+=' ';},
  'wrong request direction':f=>{f.receipt.desktopResult.executionPlan.requestRequirements.direction='short';},
  'unsaved plan':f=>{f.plan.saved=false;},
  'deleted plan':f=>{f.plan.deleted=true;},
  'missing policy':f=>{delete f.receipt.executionPolicy;},
  'wrong available prompt':f=>{f.receipt.prompt='a different original prompt';},
  'malformed available prompt':f=>{f.receipt.prompt=null;},
  'missing result':f=>{delete f.receipt.desktopResult;},
  'malformed plan identifiers':f=>{f.receipt.desktopResult.cloud.planIds={};},
};
for(const [name,mutate] of Object.entries(corruptions))test(`saved receipt rejects ${name}`,async()=>{
  const f=fixture();mutate(f);
  await assert.rejects(service(f).plans.perform('list'),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
});
test('actual list boundary and renderer apply/cache a constrained historical plan without a toast',async()=>{
  const f=fixture(),{plans}=service(f),applied=[],cached=[],errors=[];
  const refresh=createCloudPlanRefresher({scope:()=>owner.ownerId,load:()=>cloudPlanListResponse(plans),read:()=>[],
    apply:p=>applied.push(p),save:(scope,p)=>{cached.push({scope,plans:p});return true;},changed:()=>{},
    failure:e=>errors.push(e),cacheFailure:()=>assert.fail('cache write'),schedule:()=>assert.fail('must not retry')});
  await refresh();
  assert.deepEqual(errors,[]);assert.equal(applied.length,1);assert.equal(applied[0][0].id,f.plan.id);
  assert.equal(cached[0].scope,owner.ownerId);assert.equal(cached[0].plans[0].id,f.plan.id);
});

test('mixed new and legacy saved receipts survive pagination and preserve their source mapping',async()=>{
  const fixtures=[fixture('zh-CN','long'),fixture('en','short',{legacy:true})],calls=[];
  assert.notEqual(fixtures[0].plan.id,fixtures[1].plan.id);
  const plans=createCloudPlans({owner:async()=>owner,sources:()=>({origins:async()=>({[fixtures[0].receipt.id]:{sourceThreadId:'original-thread'}})}),
    api:()=>({tradingCloudRequest:async(action,payload)=>{
      calls.push({action,payload});assert.equal(action,'plans');
      const f=fixtures[payload.after?1:0];
      return {items:[f.plan],receipts:{[f.plan.id]:f.receipt},nextCursor:payload.after?null:f.plan.id};
    }})});
  const response=await plans.perform('list');
  assert.equal(response.reports.length,2);assert.equal(response.reports[0].origin.sourceThreadId,'original-thread');
  assert.deepEqual(calls.map(c=>c.payload),[{}, {after:fixtures[0].plan.id}]);
});

test('contract failures keep prior plans and report a localized validation failure without retrying',async()=>{
  const phrases={'zh-CN':/数据校验/,'en':/could not be validated/,'zh-Hant':/資料驗證/,'ko':/검증/};
  for(const [language,pattern] of Object.entries(phrases)) {
    const f=fixture();f.plan.executionPlan.requestRequirements.promptHash='f'.repeat(64);
    const {plans}=service(f),previous=[{id:'keep-existing'}],errors=[];
    const response=await cloudPlanListResponse(plans,{language});
    assert.equal(response.error.code,'CLOUD_RESULT_CONTEXT_INVALID');
    assert.match(response.error.message,pattern);assert.doesNotMatch(response.error.message,/稍后再试|try again later|稍後再試/);
    const refresh=createCloudPlanRefresher({scope:()=>owner.ownerId,load:async()=>response,read:()=>previous,
      apply:()=>assert.fail('must retain prior plans'),save:()=>assert.fail('must not overwrite cache'),changed:()=>assert.fail('must not apply'),
      failure:e=>errors.push(e),cacheFailure:()=>assert.fail('cache'),schedule:()=>assert.fail('must not retry permanent error')});
    await refresh();assert.equal(errors.length,1);assert.deepEqual(previous,[{id:'keep-existing'}]);
  }
});
