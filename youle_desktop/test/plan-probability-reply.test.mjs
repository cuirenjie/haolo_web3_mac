import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPlanProbabilityReply,normalizePlanProbability} from '../src/main/plan-probability-view.mjs';
import {normalizeCloudReports,cloudReportFromResponse,selectCloudPlan} from '../src/main/cloud-plan-contract.mjs';
import {cloudAccountPlanCardFixture,legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports} from './support/right-renderer-parity.mjs';
import {cloudTaskHistory} from '../src/main/trading-strategy-runtime/cloud-task-history.mjs';

export function probabilityReport(locale='zh-CN',mode='right',legacy=false) {
  const report=legacy?legacyCloudPlanCardFixture('price-action',locale):cloudAccountPlanCardFixture(locale);
  if (legacy) report.planRecords[0].scenario=structuredClone(report.executionPlan.scenarios[0]);
  else report.executionPlan.selectedMode=report.executionPlan.requestedMode=mode;
  const scenario=report.planRecords[0].scenario;
  report.profitProbability={schemaVersion:1,kind:'model_estimate',basis:'first_target_before_stop_conditional',
    history:{candleCount:120,from:1792310400000,to:1792326740000,asOf:1792326741009,interval:'1h'},
    assessments:[{planId:report.planRecords[0].id,side:scenario.side,entry:scenario.entry,stop:scenario.stop,targets:[...scenario.targets],
      conditionHash:scenario.conditionHash??null,stopLossProbabilityPercent:37.25,profitProbabilityPercent:62.75,
      evidenceIds:['history-window'],summary:'The closed candles support the conditional setup; a reversal remains possible.'}]};
  return report;
}

test('left, right and legacy replies appear after the unchanged plan and controls, only when complete',()=>{
  for(const legacy of [false,true])for(const mode of ['left','right']) {
    const report=probabilityReport('zh-CN',mode,legacy);
    const {rendered}=renderCurrentReports([report],{allowPlanAction:true});
    const replyIndex=rendered.cards.indexOf('plan-probability-reply');
    const controlsIndex=rendered.cards.indexOf('message-execution-plan-controls');
    assert.ok(controlsIndex>=0 && replyIndex>controlsIndex);
    assert.match(rendered.cards,/62\.75%/);
    const before=structuredClone(report);delete before.profitProbability;
    assert.equal(rendered.cards.replace(renderPlanProbabilityReply(report),''),renderCurrentReports([before],{allowPlanAction:true}).rendered.cards);
    assert.doesNotMatch(renderCurrentReports([report],{allowPlanAction:false}).rendered.cards,/plan-probability-reply/);
  }
});

test('50 percent, lower, missing, invalid or unrelated estimates leave the plan intact',()=>{
  const bad=[row=>{row.profitProbabilityPercent=50;row.stopLossProbabilityPercent=50;},
    row=>{row.profitProbabilityPercent=49;row.stopLossProbabilityPercent=51;},
    row=>{row.profitProbabilityPercent=50.001;row.stopLossProbabilityPercent=49.999;},
    row=>{row.profitProbabilityPercent=70;},row=>{row.stopLossProbabilityPercent=null;},
    row=>{row.entry+=1;},row=>{row.side='short';},row=>{row.targets[0]+=1;},
    row=>{row.conditionHash='wrong';},row=>{row.planId='wrong';},row=>{row.summary='';},row=>{row.evidenceIds=[];}];
  for(const mutate of bad) {
    const report=probabilityReport();mutate(report.profitProbability.assessments[0]);
    const normalized=normalizeCloudReports([report])[0];
    assert.equal(normalized.profitProbability,undefined);
    const html=renderCurrentReports([normalized],{allowPlanAction:true}).rendered.cards;
    assert.match(html,/message-execution-plan-controls/);assert.doesNotMatch(html,/plan-probability-reply/);
  }
});

test('escapes model text and provides four localized descriptions without rendering raw HTML',()=>{
  for(const locale of ['zh-CN','en','zh-Hant','ko']) {
    const report=probabilityReport(locale);
    report.profitProbability.assessments[0].summary='<img src=x onerror=alert(1)> & evidence';
    const frozen = structuredClone(report.profitProbability);
    const html=renderPlanProbabilityReply(report,locale);
    assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
    assert.doesNotMatch(html,/plan-probability-formula|100% −|37\.25%/);
    assert.doesNotMatch(html,/plan-probability-heading|plan-probability-history|Data through|数据截至|資料截至|데이터 기준| UTC/);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; evidence'));
    assert.deepEqual(report.profitProbability,frozen);
    assert.match(html,/<strong>62\.75%<\/strong>/);
    assert.ok(html.includes(locale==='en'?'Not calibrated':locale==='ko'?'백테스트':locale==='zh-Hant'?'回測':'回测'));
  }
});

test('original result persists through cloud parsing, plan selection and task history',()=>{
  const report=probabilityReport();const taskId='00000000-0000-4000-8000-000000000099';
  const response={strategy:{id:report.strategyId},snapshot:{marketId:report.marketId,interval:report.interval},
    executionPlan:report.executionPlan,analysisPlan:{report:report.report,profitProbability:report.profitProbability},
    cloud:{executionPolicy:'entry-v2',runId:report.runId,resultHash:report.resultHash,locale:report.locale,planRecords:report.planRecords}};
  const from=cloudReportFromResponse(response)[0];
  assert.deepEqual(from.profitProbability,report.profitProbability);
  assert.deepEqual(selectCloudPlan(from,from.planRecords[0]).profitProbability,report.profitProbability);
  const history=cloudTaskHistory({id:taskId,context:{taskId},runs:[{id:report.runId,context:{taskId},state:'succeeded',text:report.report,desktopResult:response}]},report.runId);
  assert.deepEqual(history.items[0].__youleCloudReports[0].profitProbability,report.profitProbability);
});

test('selected legacy cards bind to their own estimate and invalid optional history never removes cards',()=>{
  const report=probabilityReport('en','right',true);
  const value=structuredClone(report.profitProbability);
  value.history.to=value.history.asOf+1;
  assert.equal(normalizePlanProbability(value,report),null);
  report.profitProbability.assessments[0].planId='00000000-0000-4000-8000-000000000099';
  assert.equal(renderPlanProbabilityReply(report),'');
  assert.equal(normalizeCloudReports([report])[0].planRecords.length,1);
});

test('rollback preserves completed historical estimates without pending UI or mutating the receipt',()=>{
  for(const legacy of [false,true]) {
    const report=probabilityReport('en','right',legacy), estimate=report.profitProbability;
    delete report.profitProbability;
    const supplement={schemaVersion:1,state:'ready',baseResultHash:report.resultHash,estimate};
    const response={strategy:{id:report.strategyId},snapshot:{marketId:report.marketId,interval:report.interval},
      executionPlan:report.executionPlan,analysisPlan:{report:report.report},
      cloud:{executionPolicy:legacy?'right-legacy-v1':'entry-v2',runId:report.runId,resultHash:report.resultHash,locale:report.locale,planRecords:report.planRecords}};
    const taskId='00000000-0000-4000-8000-000000000099';
    const run={id:report.runId,context:{taskId},state:'succeeded',text:report.report,desktopResult:response,probabilitySupplement:supplement};
    const frozen=structuredClone(run);
    const historical=cloudTaskHistory({id:taskId,context:{taskId},runs:[run]}).items[0].__youleCloudReports[0];
    assert.deepEqual(historical.profitProbability,estimate);
    assert.equal(historical.probabilitySupplement,undefined);
    assert.deepEqual(run,frozen);
    for(const state of ['pending','omitted']) {
      const normalized=normalizeCloudReports([{...report,probabilitySupplement:{...supplement,state}}])[0];
      assert.equal(normalized.profitProbability,undefined);
      assert.equal(renderPlanProbabilityReply(normalized),'');
    }
    for(const invalid of [s=>s.baseResultHash='0'.repeat(64),s=>s.schemaVersion=2,
      s=>s.estimate.assessments[0].entry+=1,s=>{s.estimate.assessments[0].profitProbabilityPercent=50;s.estimate.assessments[0].stopLossProbabilityPercent=50;}]) {
      const value=structuredClone(supplement);invalid(value);
      assert.equal(normalizeCloudReports([{...report,probabilitySupplement:value}])[0].profitProbability,undefined);
    }
  }
});

test('rollback retains Japanese probability labels and never falls back to English',()=>{
  const html=renderPlanProbabilityReply(probabilityReport('ja'),'ja');
  assert.match(html,/利益到達確率（モデル推定）/);
  assert.match(html,/バックテスト/);
  assert.doesNotMatch(html,/Profit probability|Not calibrated|plan-probability-pending/);
});
