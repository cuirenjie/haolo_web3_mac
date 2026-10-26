import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {createExecutionPlanAutoActivator,executionPlanCanAutoActivate} from '../src/renderer/execution-plan-auto-activation.ts';
import {createCloudPlanRefresher,mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import * as plans from '../src/renderer/execution-plans.ts';
import {normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {cloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
const saved=(id='one',extra={})=>({id,status:'pending',linkedAlertId:null,statusUpdatedAt:'old',reminderActivation:'manual',...extra});
function harness(initial,activate){
  const h={scope:'A',plans:initial,time:0,calls:[],failures:[],timers:new Map(),busy:new Set()};let seq=0;
  h.auto=createExecutionPlanAutoActivator({scope:()=>h.scope,read:()=>h.plans,busy:id=>h.busy.has(id),now:()=>h.time,
    activate:async id=>{h.calls.push(id);await activate?.(h,id);h.plans=h.plans.map(p=>p.id===id?{...p,linkedAlertId:'alert-'+id}:p);},
    failure:(error,plan)=>h.failures.push({error,plan}),schedule:(run,delay)=>{const id=++seq;h.timers.set(id,{run:()=>{h.timers.delete(id);run();},delay});return id;},cancel:id=>h.timers.delete(id)});
  return h;
}

test('only saved pending plans need activation; legacy manual flags do not prevent migration',()=>{
  assert.equal(executionPlanCanAutoActivate(saved()),true);
  assert.equal(executionPlanCanAutoActivate(saved('legacy',{reminderActivation:undefined})),true);
  for(const extra of [{status:'ended'},{status:'executing'},{linkedAlertId:'existing'}])assert.equal(executionPlanCanAutoActivate(saved('p',extra)),false);
  const p=saved('cloud',{cloudReport:{planRecords:[{saved:true,expiresAt:100}]}});
  assert.equal(executionPlanCanAutoActivate(p,0),true);
  assert.equal(executionPlanCanAutoActivate(p,100),false);
  for(const extra of [{saved:false},{deleted:true},{linkedAlertId:'existing'}]){
    assert.equal(executionPlanCanAutoActivate({...p,cloudReport:{planRecords:[{...p.cloudReport.planRecords[0],...extra}]}},0),false);
  }
});

test('concurrent refreshes serialize old plans and do not create duplicate alerts',async()=>{
  let release,active=0,max=0;
  const h=harness([saved('one'),saved('two')],async(_h,id)=>{active++;max=Math.max(max,active);if(id==='one')await new Promise(r=>release=r);active--;});
  const first=h.auto.reconcile();await new Promise(setImmediate);
  assert.equal(h.auto.reconcile(),first);
  h.plans.push(saved('three'));release();await first;
  assert.deepEqual(h.calls,['one','two','three']);assert.equal(max,1);assert.equal(h.timers.size,0);
  await h.auto.reconcile();assert.equal(h.calls.length,3);
});

test('temporary failures retry automatically with backoff without repeated error notices',async()=>{
  let offline=true;
  const h=harness([saved()],()=>{if(offline)throw Object.assign(Error('offline'),{code:'ENTRY_WORKER_UNAVAILABLE'});});
  await h.auto.reconcile();assert.equal([...h.timers.values()][0].delay,30_000);
  for(let i=0;i<5;i++)await h.auto.reconcile();assert.equal(h.calls.length,1);
  h.time=30_000;[...h.timers.values()][0].run();await h.auto.reconcile();
  assert.equal(h.calls.length,2);assert.equal([...h.timers.values()][0].delay,60_000);assert.equal(h.failures.length,1);
  offline=false;h.time=90_000;[...h.timers.values()][0].run();await h.auto.reconcile();
  assert.equal(h.plans[0].linkedAlertId,'alert-one');assert.equal(h.timers.size,0);
});

test('risk refusal is retained without repeated attempts; a changed plan is reconsidered',async()=>{
  const h=harness([saved()],()=>{throw Object.assign(Error('zone limit'),{code:'LEFT_ZONE_ATTEMPT_LIMIT'});});
  await h.auto.reconcile();await h.auto.reconcile();h.time+=600_000;await h.auto.reconcile();
  assert.equal(h.calls.length,1);assert.equal(h.plans[0].linkedAlertId,null);assert.equal(h.timers.size,0);
  h.plans[0].statusUpdatedAt='new-version';await h.auto.reconcile();assert.equal(h.calls.length,2);
});

test('deletion, logout and busy activation cannot be overtaken by the background queue',async()=>{
  let release;
  const h=harness([saved('one'),saved('two')],async()=>{await new Promise(r=>release=r);});
  const run=h.auto.reconcile();await new Promise(setImmediate);
  h.plans=[];h.scope=null;release();await run;assert.deepEqual(h.calls,['one']);assert.equal(h.timers.size,0);
  h.scope='B';h.plans=[saved('three')];h.busy.add('three');await h.auto.reconcile();
  assert.equal([...h.timers.values()][0].delay,1000);
  h.plans[0].linkedAlertId='already-created';h.busy.clear();await h.auto.reconcile();assert.equal(h.calls.length,1);
});

const ast=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const functions=['syncExecutionPlanLinkedAlert','activateExecutionPlanReminder','reconcileMissingExecutionPlanAlerts'];
const declarations=['executionPlanAutoActivation','refreshCloudExecutionPlans'];
const code=[...functions.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)),
  ...declarations.map(name=>ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name)).getText(ast))].join('\n');

test('production background activation refusal stays silent and refreshes the saved plan',async()=>{
  const report=cloudPlanCardFixture();report.executionPlan.entryCondition.expiresAt=Date.now()+3600_000;
  Object.assign(report.planRecords[0],{saved:true,linkedAlertId:null,status:'pending',expiresAt:Date.now()+3600_000,version:2});
  const state={auth:{authenticated:true},executionPlansScope:'A',settings:{language:'en'},executionPlans:[],activeView:'plans'};
  const calls=[],notices=[];
  const deps={...plans,normalizeCloudReports,createExecutionPlanAutoActivator,createCloudPlanRefresher,state,
    currentExecutionPlanStorageScope:()=>state.executionPlansScope,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),
    executionPlanCloudLoadedScope:null,render:()=>{},showToast:m=>notices.push(m),errorMessage:e=>e.message,cloudPlanSyncMessage:()=> 'refresh failed',
    saveExecutionPlans:()=>true,api:{tradingCloudPlans:async(action)=>{
      calls.push(action);if(action==='list')return {ok:true,reports:[report]};
      assert.equal(action,'activate');throw Object.assign(Error('LEFT_ZONE_ATTEMPT_LIMIT'),{code:'LEFT_ZONE_ATTEMPT_LIMIT'});
    }}};
  const run=Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return {refreshCloudExecutionPlans,executionPlanAutoActivation};')(...Object.values(deps));
  await run.refreshCloudExecutionPlans();await run.executionPlanAutoActivation.reconcile();await new Promise(setImmediate);
  await run.executionPlanAutoActivation.reconcile();
  assert.deepEqual(calls,['list','activate','list']);
  assert.equal(state.executionPlans.length,1);assert.equal(state.executionPlans[0].linkedAlertId,null);
  assert.deepEqual(notices,[]);
});

test('production account sync refreshes cloud state before migrating old plans without button interaction',async()=>{
  const report=cloudPlanCardFixture();report.executionPlan.entryCondition.expiresAt=Date.now()+3600_000;
  Object.assign(report.planRecords[0],{saved:true,linkedAlertId:null,status:'pending',expiresAt:Date.now()+3600_000,version:2});
  const old=mergeCloudExecutionPlans([report],[])[0];
  const state={auth:{authenticated:true},executionPlansScope:'A',settings:{language:'en'},executionPlans:[old],activeView:'plans'};
  const calls=[],notices=[],cache=[];let listFails=true;
  const deps={...plans,normalizeCloudReports,createExecutionPlanAutoActivator,createCloudPlanRefresher,state,
    currentExecutionPlanStorageScope:()=>state.executionPlansScope,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),
    executionPlanCloudLoadedScope:null,render:()=>{},showToast:m=>notices.push(m),errorMessage:e=>e.message,cloudPlanSyncMessage:()=> 'refresh failed',
    saveExecutionPlans:(scope,values)=>{cache.push(scope);return true;},api:{tradingCloudPlans:async(action,ref)=>{
      calls.push(action);if(action==='list'){if(listFails)throw Error('offline');return {ok:true,reports:[report]};}
      assert.equal(action,'activate');assert.equal(ref.version,2);
      return {ok:true,plan:{...report.planRecords[0],linkedAlertId:'auto-alert',version:3}};
    }}};
  const run=Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return {refreshCloudExecutionPlans,executionPlanAutoActivation};')(...Object.values(deps));
  await run.executionPlanAutoActivation.reconcile();assert.deepEqual(calls,[],'stale cloud cache cannot activate');
  await run.refreshCloudExecutionPlans();assert.deepEqual(calls,['list']);assert.equal(state.executionPlans[0].linkedAlertId,null);
  listFails=false;await run.refreshCloudExecutionPlans();await run.executionPlanAutoActivation.reconcile();
  assert.deepEqual(calls,['list','list','activate']);assert.equal(state.executionPlans[0].linkedAlertId,'auto-alert');
  assert.ok(cache.every(scope=>scope==='A'));assert.deepEqual(notices,[],'event-driven sync and background activation remain silent');
});
