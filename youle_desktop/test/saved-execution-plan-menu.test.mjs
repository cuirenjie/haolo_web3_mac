import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {createSavedExecutionPlan} from '../src/renderer/execution-plans.ts';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {savedPlanMenuOptions, savedPlanMenuRevision, savedPlanMenuText, savedPlanSourceThreadId, navigateSavedPlan} from '../src/renderer/saved-execution-plan-menu.ts';
import {cloudAccountPlanCardFixture, legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';

const saved = (report = cloudAccountPlanCardFixture()) => createSavedExecutionPlan({
  candidate: {...cloudPlanCard(report), cloudReport: report}, sourceThreadId: 'original-thread', sourceMessageId: 'original-message',
});
const context = () => ({scope:'account:1',plan:saved(),busy:false,chartBusy:false,sourceAvailable:true});

test('saved card menus keep end/reopen/delete alongside both source navigation actions', () => {
  const c = context();
  for (const status of ['pending','executing','ended']) {
    c.plan.status = status;
    assert.deepEqual(savedPlanMenuOptions(c), [status === 'ended' ? 'reopen' : 'end','chart','conversation','delete'].map(action => ({action,enabled:true})));
  }
  c.chartBusy = true;
  assert.deepEqual(savedPlanMenuOptions(c).map(item=>item.enabled),[true,false,true,true]);
  c.sourceAvailable = false;
  assert.deepEqual(savedPlanMenuOptions(c).map(item=>item.enabled),[true,false,false,true]);
  c.busy = true;
  assert.ok(savedPlanMenuOptions(c).every(item=>!item.enabled));
});

test('source IDs use explicit local or cloud origin and never the synthetic cloud run as a thread', () => {
  const p = saved();
  p.cloudReport.origin = {sourceThreadId:'remote-origin'};
  assert.equal(savedPlanSourceThreadId(p),'original-thread');
  p.sourceThreadId = `cloud-run:${p.cloudReport.runId}`;
  assert.equal(savedPlanSourceThreadId(p),'remote-origin');
  delete p.cloudReport.origin;
  assert.equal(savedPlanSourceThreadId(p),'');
});

test('open menu snapshots reject changed account, lifecycle, source, content and cloud version', () => {
  const c = context(), stamp = savedPlanMenuRevision(c);
  assert.equal(savedPlanMenuRevision(structuredClone(c)),stamp);
  for (const mutate of [c=>c.scope='account:2',c=>c.plan.status='ended',c=>c.plan.sourceThreadId='other',
    c=>c.plan.content+='changed',c=>c.plan.cloudReport.planRecords[0].version++]) {
    const next = structuredClone(c); mutate(next); assert.notEqual(savedPlanMenuRevision(next),stamp);
  }
});

function navigation() {
  const calls=[],state={valid:true,current:'unrelated'};
  const deps={language:()=> 'zh-CN',valid:()=>state.valid,sourceAvailable:()=>true,
    initializeChart:id=>calls.push(['initialize',id]),selectThread:async id=>{calls.push(['select',id]);state.current=id;},
    isCurrentThread:id=>state.current===id,
    showChart:async(report,chart,id,valid)=>{assert.equal(valid(),true);calls.push(['chart',report,chart,id]);}};
  return {calls,state,deps};
}
test('chart navigation restores the saved report and original analysis timeframe after selecting its source', async () => {
  const p=saved(),{calls,deps}=navigation(); p.cloudReport.executionPlan.entryCondition.interval='15m';
  await navigateSavedPlan(p,'chart',deps);
  assert.deepEqual(calls.map(c=>c[0]),['initialize','select','chart']);
  assert.equal(calls[0][1],'original-thread');assert.equal(calls[2][1],p.cloudReport);
  assert.deepEqual(calls[2].slice(2),[{marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60'},'original-thread']);
});
test('related history opens the exact original thread without initializing or changing charts', async () => {
  const {calls,deps}=navigation();
  await navigateSavedPlan(saved(),'conversation',deps);
  assert.deepEqual(calls,[['select','original-thread']]);
});
test('legacy saved plans restore their original market and period without a cloud report', async () => {
  const p=saved(legacyCloudPlanCardFixture('wyckoff')),{calls,deps}=navigation();delete p.cloudReport;
  await navigateSavedPlan(p,'chart',deps);
  assert.deepEqual(calls[2].slice(1),[null,{marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1h'},'original-thread']);
});
test('missing or deleted source threads fail before navigation; history still works without market context', async () => {
  const p=saved(),{calls,deps}=navigation();p.sourceThreadId='cloud-run:missing';
  await assert.rejects(navigateSavedPlan(p,'chart',deps),/来源会话不可用/);
  p.sourceThreadId='deleted';deps.sourceAvailable=()=>false;
  await assert.rejects(navigateSavedPlan(p,'conversation',deps),/来源会话不可用/);
  assert.deepEqual(calls,[]);
  deps.sourceAvailable=()=>true;delete p.cloudReport;p.title='generic';p.content='';
  await assert.rejects(navigateSavedPlan(p,'chart',deps),/原始市场或周期/);assert.deepEqual(calls,[]);
  await navigateSavedPlan(p,'conversation',deps);assert.deepEqual(calls,[['select','deleted']]);
});
test('account switches or intervening thread selection cancel delayed drawing restoration', async () => {
  for (const change of [s=>s.valid=false,s=>s.current='another-thread']) {
    const {calls,state,deps}=navigation();deps.selectThread=async id=>{state.current=id;change(state);};
    await navigateSavedPlan(saved(),'chart',deps);assert.deepEqual(calls.map(c=>c[0]),['initialize']);
  }
  const {calls,state,deps}=navigation();state.valid=false;
  await navigateSavedPlan(saved(),'chart',deps);assert.deepEqual(calls,[]);
});
test('saved menu and end reasons are translated in all supported locales', () => {
  for (const language of ['zh-CN','zh-TW','en']) for (const key of ['end','reopen','delete','conversation','reasons','take_profit','stop_loss','cancelled','expired','back','cancel','unavailable']) {
    assert.ok(savedPlanMenuText(key,language));
  }
  assert.equal(savedPlanMenuText('conversation','zh-CN'),'跳转相关会话');
});

const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const deletion=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='deleteExecutionPlan').getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function deletionHarness(confirm, remote) {
  const plan=saved(),calls=[],state={executionPlans:[plan],executionPlansScope:'owner',tradingAlerts:{alerts:[]}};
  const deps={state,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),
    confirmInApp:async options=>{calls.push(['confirm',options]);return confirm();},
    api:{tradingCloudPlans:async()=>{calls.push(['delete']);return remote();}},
    render:()=>{},saveExecutionPlans:(...args)=>{calls.push(['save',...args]);return true;},
    showToast:()=>{},errorMessage:String,refreshTradingAlerts:async()=>{}};
  return {plan,calls,state,run:Function(...Object.keys(deps),deletion+';return deleteExecutionPlan;')(...Object.values(deps))};
}
test('delete keeps the existing confirmation; cancelling or switching account during confirmation sends no deletion', async () => {
  const cancel=deletionHarness(()=>false,()=>({ok:true}));await cancel.run(cancel.plan.id);
  assert.equal(cancel.calls.length,1);assert.equal(cancel.state.executionPlans.length,1);
  let valid=true;const changed=deletionHarness(()=>{valid=false;return true;},()=>({ok:true}));
  await changed.run(changed.plan.id,()=>valid);assert.equal(changed.calls.length,1);
});
test('confirmed cloud deletion removes only the target and does not overwrite a changed account on late completion', async () => {
  const done=deletionHarness(()=>true,()=>({ok:true}));await done.run(done.plan.id);
  assert.deepEqual(done.calls.map(c=>c[0]),['confirm','delete','save']);assert.deepEqual(done.state.executionPlans,[]);
  let valid=true;const late=deletionHarness(()=>true,()=>{valid=false;late.state.executionPlans=[{id:'another-account-plan'}];return {ok:true};});
  await late.run(late.plan.id,()=>valid);assert.deepEqual(late.calls.map(c=>c[0]),['confirm','delete']);
  assert.equal(late.state.executionPlans[0].id,'another-account-plan');
});
