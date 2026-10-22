import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {cloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports} from './support/right-renderer-parity.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';

function reportFor(mode,locale,strategyId='price-action') {
  const report=cloudPlanCardFixture(locale),plan=report.executionPlan;
  report.strategyId=strategyId;report.planRecords=[];
  plan.scenarios=[];plan.requestedMode=mode;plan.selectedMode=null;
  delete plan.entryCondition;delete plan.conditionHash;
  plan.outcome={capability:'supported',candidateStatus:'none',evaluationStatus:'completed',action:'wait',reason:'NO_QUALIFIED_CANDIDATE'};
  plan.createdAt=1800000000000;
  plan.conditionalWatch={version:'conditional-watch-v1',mode,strategyId,actionable:false,canCreateAlert:false,
    createdAt:plan.createdAt,expiresAt:plan.createdAt+3600000,reason:plan.outcome.reason,
    reasonText:['尚待策略确认','Strategy confirmation pending','尚待策略確認'],evaluationStatus:'completed',
    conditions:[{side:'long',price:99,source:'closed_range',operator:mode==='left'?'at_or_below':'cross_up',
      confirmation:mode==='left'?'reclaim_follow':'closed_breakout_retest'}]};
  return report;
}

for(const mode of ['left','right']) for(const locale of ['zh-CN','en','zh-Hant']) {
  test(`${mode}/${locale}: historical waiting reports remain readable without an observation card`,()=>{
    const report=reportFor(mode,locale),before=structuredClone(report);
    const normalized=normalizeCloudReports([report])[0],card=cloudPlanCard(normalized);
    const {rendered,actions,bindings}=renderCurrentReports([normalized],{allowPlanAction:true});
    assert.equal(card,null);
    assert.equal(rendered.cards,'');
    assert.equal(actions,'');assert.deepEqual(bindings,[]);
    assert.doesNotMatch(rendered.cards,/data-message-action="add-to-plan"|data-message-execution-plan-action="sticky"/);
    assert.deepEqual(report,before);
  });
}

test('all official entries suppress text-only cards, including failed evaluation history',()=>{
  for(const strategy of OFFICIAL_TRADING_CATALOG) for(const mode of ['left','right']) {
    const report=reportFor(mode,'en',strategy.id);
    assert.equal(cloudPlanCard(normalizeCloudReports([report])[0]),null);
    report.executionPlan.conditionalWatch.conditions=[];
    report.executionPlan.conditionalWatch.evaluationStatus='data_unavailable';
    report.executionPlan.outcome.evaluationStatus='data_unavailable';
    report.executionPlan.outcome.action='unavailable';
    assert.equal(cloudPlanCard(normalizeCloudReports([report])[0]),null);
  }
});

test('malformed, mismatched, executable and HTML-bearing watch data are fenced',()=>{
  for(const alter of [w=>w.mode='right',w=>w.strategyId='other',w=>w.actionable=true,w=>w.canCreateAlert=true,
    w=>w.conditions[0].price=NaN,w=>w.conditions[0].operator='cross_up',w=>w.expiresAt=0,
    w=>w.conditions=[null],w=>{w.evaluationStatus='data_unavailable';w.conditions=[];}]) {
    const report=reportFor('left','en');alter(report.executionPlan.conditionalWatch);
    assert.throws(()=>normalizeCloudReports([report]),/CLOUD_REPORT_INVALID/);
  }
  const report=reportFor('left','en');report.executionPlan.conditionalWatch.reasonText[1]='<img src=x onerror=alert(1)>';
  assert.equal(cloudPlanCard(normalizeCloudReports([report])[0]),null);
});
