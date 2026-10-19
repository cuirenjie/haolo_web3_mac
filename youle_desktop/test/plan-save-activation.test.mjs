import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import * as plans from '../src/renderer/execution-plans.ts';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {cloudPlanCardFixture,legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';

const owner={ownerId:'owner',accountId:'account',baseUrl:'https://haolo.example'};
function remoteFixture(right=false) {
  const report=right?legacyCloudPlanCardFixture('rsi-analysis'):cloudPlanCardFixture();
  const plan={...report.planRecords[0],executionPlan:report.executionPlan,saved:false,linkedAlertId:null};
  const reference={planId:plan.id,runId:plan.runId,version:plan.version,confirmationHash:plan.confirmationHash,conditionHash:plan.scenario.conditionHash};
  return {report,plan,reference};
}
function cloudHarness({right=false,capability=true,saveFailure=null}={}) {
  let {plan,reference}=remoteFixture(right);const calls=[];
  const api={async tradingCloudRequest(op,payload,options) {
    calls.push({op,payload,options});
    if(op==='plan')return structuredClone(plan);
    if(op==='capabilities')return capability?{planSaveActivation:'separate-v1'}:{};
    if(op==='savePlan') {
      if(saveFailure)throw Object.assign(new Error(saveFailure),{code:saveFailure});
      plan={...plan,saved:true,version:plan.version+1,status:'pending',reminderActivation:'manual'};
      return {plan:structuredClone(plan)};
    }
    if(op==='activatePlan')throw Object.assign(new Error('LEFT_ZONE_ATTEMPT_LIMIT'),{code:'LEFT_ZONE_ATTEMPT_LIMIT'});
    throw Error(op);
  }};
  return {service:createCloudPlans({owner:async()=>owner,api:()=>api}),reference,calls,get plan(){return plan;}};
}

for(const right of [false,true])test(`save independently and keep plan after activation refusal: ${right?'right':'left'}`,async()=>{
  const h=cloudHarness({right});
  const saved=await h.service.perform('save',h.reference);
  assert.equal(saved.plan.saved,true);assert.equal(saved.plan.linkedAlertId,null);assert.equal(saved.alert,undefined);
  assert.deepEqual(h.calls.map(c=>c.op),['plan','capabilities','savePlan','plan']);
  const write=h.calls.find(c=>c.op==='savePlan');assert.equal(write.options.idempotencyKey,`save:${saved.plan.id}:${saved.plan.confirmationHash}`);
  assert.equal((await h.service.perform('save',h.reference)).alreadySaved,true);
  const frozen=structuredClone(h.plan);
  await assert.rejects(h.service.perform('activate',{...h.reference,version:saved.plan.version}),{code:'LEFT_ZONE_ATTEMPT_LIMIT'});
  assert.deepEqual((await h.service.perform('read',h.reference)).plan,frozen);
});

test('an old server or a failed save never falls back to activation',async()=>{
  for(const options of [{capability:false},{saveFailure:'PLAN_VERSION_CONFLICT'}]) {
    const h=cloudHarness(options);
    await assert.rejects(h.service.perform('save',h.reference));
    assert.equal(h.plan.saved,false);assert.equal(h.calls.some(c=>c.op==='activatePlan'),false);
  }
});

test('expired or activation-ineligible formal reports still expose Save',()=>{
  const report=cloudPlanCardFixture();
  report.executionPlan.expiresAt=Date.now()-1000;
  report.executionPlan.scenarios[0].eligible=false;
  report.planRecords[0].scenario.eligible=false;
  const rendered=renderCurrentReports([report]);
  assert.match(rendered.actions,/data-message-action="add-to-plan"/);
  assert.doesNotMatch(rendered.actions,/disabled|计划已过期/);
});

test('save uses the separate authenticated idempotent HTTP endpoint',async()=>{
  const calls=[];
  const api=new YouleApiClient({serviceFetch:async(url,init)=>{calls.push({url,init});return new Response('{}',{status:200});}});
  api.loaded=true;api.baseUrl=owner.baseUrl;api.profile={id:owner.accountId};api.token='test-only';
  const planId='00000000-0000-4000-8000-000000000001';
  await api.tradingCloudRequest('savePlan',{planId,version:1,confirmationHash:'hash'},{idempotencyKey:'save-once'});
  assert.equal(String(calls[0].url),`https://haolo.example/api/mobile/v1/plans/${planId}/save`);
  assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['Idempotency-Key'],'save-once');
  assert.equal(calls[0].init.headers.Authorization,'Bearer test-only');
});

const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
function functionSource(name) {const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(ast);}
function rendererFunction(name,deps) {
  return Function(...Object.keys(deps),ts.transpileModule(functionSource(name),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`;return ${name};`)(...Object.values(deps));
}
function savedFixture(locale='zh-CN',right=false) {
  const report=right?legacyCloudPlanCardFixture('rsi-analysis',locale):cloudPlanCardFixture(locale);
  Object.assign(report.planRecords[0],{saved:true,linkedAlertId:null,status:'pending',reminderActivation:'manual'});
  return mergeCloudExecutionPlans([report],[])[0];
}

for(const language of ['zh-CN','en','zh-TW'])for(const right of [false,true])test(`saved cards retain activation state without manual controls after refresh: ${language}/${right}`,()=>{
  const saved=savedFixture(language==='zh-TW'?'zh-Hant':language,right),data=new Map();
  const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  assert.equal(plans.saveExecutionPlans('owner',[saved],storage),true);
  const restored=plans.loadExecutionPlans('owner',storage)[0];
  assert.equal(plans.executionPlanNeedsActivation(restored),true);
  const html=renderCurrentSavedPlan(restored,language);
  assert.ok(!html.includes(plans.executionPlanActivationText('inactive',language)));
  assert.doesNotMatch(html,/data-execution-plan-action=|execution-plan-card-status/);
  const deps={...plans,state:{settings:{language},executionPlanEndMenuId:null},escapeAttr:String,escapeHtml:String,
    executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),renderExecutionPlanEndMenu:()=>''};
  const actions=rendererFunction('renderExecutionPlanActions',deps);
  assert.doesNotMatch(actions(restored),/data-execution-plan-action="activate"/);
  assert.ok(!actions(restored).includes(plans.executionPlanActivationText('activate',language)));
  deps.executionPlanAlertSyncBusyIds.add(saved.id);assert.match(actions(restored),/disabled aria-disabled="true"/);
  assert.doesNotMatch(actions({...restored,linkedAlertId:'alert'}),/data-execution-plan-action="activate"/);
  assert.doesNotMatch(actions({...restored,status:'ended'}),/data-execution-plan-action="activate"/);
});

test('legacy save stays independent and old manual markers are handled by automatic reconciliation',async()=>{
  const card=cloudPlanCard(cloudPlanCardFixture()),local=plans.createSavedExecutionPlan({candidate:card,sourceThreadId:'thread',sourceMessageId:'message'});
  let calls=0;
  const sync=rendererFunction('syncExecutionPlanLinkedAlert',{...plans,api:{tradingAlertsSyncExecutionPlan:()=>{calls++;throw Error('unexpected activation');}}});
  assert.equal((await sync(local,'save')).alertId,null);
  assert.equal((await sync(local,'lifecycle')).alertId,null);assert.equal(calls,0);
  assert.equal(plans.executionPlanNeedsActivation(local),true);
  assert.match(functionSource('reconcileMissingExecutionPlanAlerts'),/executionPlanAutoActivation\.reconcile\(\)/);
  assert.match(functionSource('executionPlanBinanceMonitoringNeeded'),/executionPlanNeedsActivation\(plan\)/);
  assert.match(functionSource('addExecutionPlanFromMessageAction'),/syncExecutionPlanLinkedAlert\(plan,'save'\)/);
});

test('cloud save handler accepts an unlinked saved plan without creating an alert',async()=>{
  const saved=savedFixture(),calls=[];
  const sync=rendererFunction('syncExecutionPlanLinkedAlert',{...plans,normalizeCloudReports,api:{tradingCloudPlans:async(action)=>{calls.push(action);return {ok:true,plan:saved.cloudReport.planRecords[0]};}}});
  assert.equal((await sync(saved,'save')).alertId,null);assert.deepEqual(calls,['save']);
});

test('activation failure leaves the saved card in state and starts a cloud reconciliation',async()=>{
  const saved=savedFixture(),state={executionPlans:[saved],settings:{language:'en'}};let refreshed=0;const toasts=[],busy=new Set();
  const activate=rendererFunction('activateExecutionPlanReminder',{...plans,state,executionPlanAlertSyncBusyIds:busy,executionPlanDeleteBusyIds:new Set(),render:()=>{},
    syncExecutionPlanLinkedAlert:async()=>{throw Error('LEFT_ZONE_ATTEMPT_LIMIT');},showToast:text=>toasts.push(text),errorMessage:e=>e.message,refreshCloudExecutionPlans:()=>{refreshed++;}});
  await activate(saved.id);assert.equal(state.executionPlans[0],saved);assert.equal(refreshed,1);assert.equal(busy.size,0);
  assert.deepEqual(toasts,[], 'activation refusal is silent while the saved card is retained');
});

test('late activation response cannot write into another account cache',async()=>{
  const saved=savedFixture(),state={executionPlans:[saved],executionPlansScope:'A',settings:{language:'en'}};
  const activate=rendererFunction('activateExecutionPlanReminder',{...plans,state,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),render:()=>{},
    syncExecutionPlanLinkedAlert:async()=>{state.executionPlansScope='B';state.executionPlans=[];return {cloudPlan:{...saved,linkedAlertId:'alert'}};},
    saveExecutionPlans:()=>assert.fail('must not cache in B'),showToast:()=>assert.fail('must not show A status in B')});
  await activate(saved.id);assert.deepEqual(state.executionPlans,[]);
});

test('automatic activation discards a late response after logout even before the storage scope changes',async()=>{
  const saved=savedFixture(),state={auth:{authenticated:true},executionPlans:[saved],executionPlansScope:'A',settings:{language:'en'}};
  const activate=rendererFunction('activateExecutionPlanReminder',{...plans,state,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),render:()=>{},
    syncExecutionPlanLinkedAlert:async()=>{state.auth.authenticated=false;return {cloudPlan:{...saved,linkedAlertId:'alert'}};},
    saveExecutionPlans:()=>assert.fail('must not write after logout'),showToast:()=>assert.fail('must not show a late result')});
  await activate(saved.id,true);assert.equal(state.executionPlans[0].linkedAlertId,null);
});

for(const failure of [null,'save','activate','switch-account'])test(`Add automatically activates the saved version and preserves failures: ${failure||'success'}`,async()=>{
  const saved=savedFixture(),candidate={...cloudPlanCard(saved.cloudReport),cloudReport:saved.cloudReport};
  const state={executionPlans:[],executionPlansScope:'A',settings:{language:'en'}},calls=[],toasts=[],cached=[];
  const deps={...plans,normalizeCloudReports,state,executionPlanCandidatesBySource:new Map([['candidate',candidate]]),
    executionPlanCandidateKey:()=> 'candidate',syncExecutionPlansForCurrentAccount:()=>{},
    executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),render:()=>{},
    openExecutionPlansPage:()=>{},showToast:text=>toasts.push(text),errorMessage:e=>e.message,
    refreshCloudExecutionPlans:()=>{},saveExecutionPlans:(scope,values)=>{cached.push({scope,values});return true;},
    api:{tradingCloudPlans:async(action,reference)=>{
      calls.push({action,reference});
      if(failure===action)throw Error(action==='save'?'SAVE_FAILED':'LEFT_ZONE_ATTEMPT_LIMIT');
      if(failure==='switch-account'){state.executionPlansScope='B';state.executionPlans=[];}
      return {ok:true,plan:{...saved.cloudReport.planRecords[0],version:action==='save'?2:3,
        linkedAlertId:action==='activate'?'auto-alert':null}};
    }}};
  deps.syncExecutionPlanLinkedAlert=rendererFunction('syncExecutionPlanLinkedAlert',deps);
  deps.activateExecutionPlanReminder=rendererFunction('activateExecutionPlanReminder',deps);
  const add=rendererFunction('addExecutionPlanFromMessageAction',deps);
  const button={dataset:{executionPlanThreadId:'thread',executionPlanMessageId:'message',executionPlanIndex:'0'},setAttribute(){},removeAttribute(){}};
  await add(button);
  if(failure==='save'||failure==='switch-account'){
    assert.deepEqual(calls.map(c=>c.action),['save']);assert.equal(state.executionPlans.length,0);assert.equal(cached.length,0);
  } else {
    assert.deepEqual(calls.map(c=>c.action),['save','activate']);
    assert.equal(calls[1].reference.version,2,'activation must use the saved version');
    assert.equal(state.executionPlans.length,1);
    assert.equal(state.executionPlans[0].linkedAlertId,failure==='activate'?null:'auto-alert');
    assert.ok(cached.every(c=>c.scope==='A'));
    if(failure==='activate')assert.ok(toasts.every(text=>!/plan remains saved|LEFT_ZONE_ATTEMPT_LIMIT/.test(text)));
    await add(button);
    assert.deepEqual(calls.map(c=>c.action),['save','activate'],
      'duplicate Add is disabled; background reconciliation owns recovery');
  }
});
