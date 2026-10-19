import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as plans from '../src/renderer/execution-plans.ts';
import * as cloud from '../src/main/cloud-plan-contract.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {createExecutionPlanAutoActivator} from '../src/renderer/execution-plan-auto-activation.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {cloudPlanCardFixture,legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';

for(const locale of ['zh-CN','zh-Hant','en'])test(`cards show only the 1h analysis timeframe while preserving the 15m condition: ${locale}`,()=>{
  const report=cloudPlanCardFixture(locale),p=report.executionPlan;
  p.context={interval:'1h'};p.executionInterval='15m';p.entryCondition.interval='15m';
  p.positionSizing={leftPolicy:{primaryInterval:'4h',executionInterval:'15m'}};
  const before=structuredClone(report),language=locale==='zh-Hant'?'zh-TW':locale;
  const card=cloud.cloudPlanCard(report),saved=mergeCloudExecutionPlans([report],[])[0];
  for(const html of [card.html,renderCurrentReports([report]).rendered.cards,renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:report,language})]){
    assert.match(html,/>BTC · 1h<\/h2>/);
    assert.doesNotMatch(html,/execution-plan-timeframes|入场监控|入場監控|Entry monitoring/);
    assert.doesNotMatch(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),/>[^<]*15m[^<]*</);
    assert.doesNotMatch(html,/BTC · (15m|4h)/);
  }
  assert.match(card.title,/ · 1h · /);
  assert.match(card.content,/15m/);
  assert.deepEqual(report,before,'display repair cannot alter the signed condition or receipt');
  assert.deepEqual(saved.cloudReport.executionPlan,before.executionPlan);
});

test('historical reports normalize the captured chart interval without borrowing background or current chart state',()=>{
  for(const [interval,expected] of [['60','1h'],['240','4h'],['15','15m'],['1D','1d'],['1W','1w'],['1M','1M']]){
    const report=cloudPlanCardFixture();report.interval=interval;
    assert.ok(cloud.cloudPlanCard(report).title.includes(` · ${expected} · `));
  }
  const report=cloudPlanCardFixture();report.interval='';
  assert.match(cloud.cloudPlanCard(report).title,/ · 1h · /);
  assert.doesNotMatch(cloud.cloudPlanCard(report).html,/execution-plan-timeframes/);
  report.executionPlan.context={interval:'4h'};report.interval='60';
  assert.match(cloud.cloudPlanCard(report).title,/ · 4h · /);
  report.executionPlan.entryCondition.interval='<img src=x onerror=alert(1)>';
  assert.doesNotMatch(cloud.cloudPlanCard(report).html,/<img/);
});

const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
function runtime(deps){
  const names=['executionPlanCandidateKey','renderAddToPlanAction','addExecutionPlanFromMessageAction','activateExecutionPlanReminder','syncExecutionPlanLinkedAlert'];
  const code=names.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n');
  return Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+`;return {${names.join(',')}}`)(...Object.values(deps));
}

for(const right of [false,true])for(const language of ['zh-CN','zh-TW','en'])test(`old saved plans activate automatically with no manual button: ${right}/${language}`,async()=>{
  const report=right?legacyCloudPlanCardFixture('rsi-analysis'):cloudPlanCardFixture();
  Object.assign(report.planRecords[0],{saved:true,linkedAlertId:null,status:'pending',version:2});
  // Cloud refresh may reconstruct origin IDs. Match the durable plan identity.
  const saved=mergeCloudExecutionPlans([report],[])[0],state={settings:{language},executionPlans:[saved],executionPlansScope:'A'};
  const busy=new Set(),calls=[],cached=[],toasts=[];
  let reject=true,release,now=0;
  const deps={...plans,...cloud,state,executionPlanAlertSyncBusyIds:busy,executionPlanCandidatesBySource:new Map(),
    executionPlanDeleteBusyIds:new Set(),escapeAttr:String,escapeHtml:String,syncExecutionPlansForCurrentAccount:()=>{},
    render:()=>{},openExecutionPlansPage:()=>{},showToast:message=>toasts.push(message),errorMessage:e=>e.message,refreshCloudExecutionPlans:()=>{},
    saveExecutionPlans:(_scope,value)=>{cached.push(value);return true;},api:{tradingCloudPlans:async(action,ref)=>{
      calls.push({action,ref});if(reject)throw Error('ENTRY_WORKER_UNAVAILABLE');
      await new Promise(resolve=>{release=resolve;});
      return {ok:true,plan:{...report.planRecords[0],linkedAlertId:'recovered',version:3}};
    }}};
  const h=runtime(deps),message={id:'original-message',conversation_id:'original-thread',cloudReports:[report],executionPlanPresentation:'execution-plan'};
  const auto=createExecutionPlanAutoActivator({scope:()=>state.executionPlansScope,read:()=>state.executionPlans,busy:id=>busy.has(id),
    activate:id=>h.activateExecutionPlanReminder(id,true),failure:()=>{},now:()=>now,schedule:()=>1,cancel:()=>{}});
  const button={dataset:{executionPlanThreadId:message.conversation_id,executionPlanMessageId:message.id,executionPlanIndex:'0'},setAttribute(){},removeAttribute(){}};
  const action=()=>h.renderAddToPlanAction(message,report.report);
  assert.ok(!action().includes(plans.executionPlanActivationText('activate',language)));
  assert.match(action(),/disabled/);
  await auto.reconcile();
  assert.equal(state.executionPlans.length,1);assert.equal(state.executionPlans[0].linkedAlertId,null);
  assert.match(action(),/disabled/,'no manual activation is required after failure');
  await auto.reconcile();assert.equal(calls.length,1,'refresh respects automatic backoff');
  reject=false;now=30_000;
  const pending=auto.reconcile();
  await new Promise(setImmediate);
  assert.match(action(),/disabled aria-disabled="true"/);
  await h.addExecutionPlanFromMessageAction(button);
  assert.equal(calls.length,2,'duplicate Add cannot start concurrent activation');
  release();await pending;
  assert.equal(state.executionPlans[0].linkedAlertId,'recovered');assert.equal(state.executionPlans.length,1);
  assert.ok(calls.every(call=>call.action==='activate'&&call.ref.version===2));
  assert.equal(cached.length,1);
  assert.match(action(),/disabled aria-disabled="true"/);
  await h.addExecutionPlanFromMessageAction(button);assert.equal(calls.length,2);
  state.executionPlans[0]={...saved,status:'ended'};
  assert.match(action(),/disabled aria-disabled="true"/);
  await h.addExecutionPlanFromMessageAction(button);assert.equal(calls.length,2,'ended plans cannot reactivate through Add');
});
