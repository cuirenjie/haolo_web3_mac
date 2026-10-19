import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cloudReportFromResponse,cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {leftRouteView,leftWatchView,validLeftObservation} from '../src/main/price-action-left-card.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/price-action-left-protect-receipts.json',import.meta.url)));
for(const locale of ['zh-CN','en','zh-Hant'])for(const side of ['','-short'])test(`${locale}${side}: retained 4h condition survives chat, save and sticky without claiming immediate entry`,()=>{
 const report=cloudReportFromResponse(fixtures[locale+side])[0],p=report.executionPlan,language=locale==='zh-Hant'?'zh-TW':locale;
 assert.equal(p.outcome.reason,'LEFT_QUALIFIED_CONDITION');assert.equal(p.positionSizing.leftPolicy.routeProfile,'protect-only-v1');
 assert.equal(leftRouteView(p,language,p.createdAt+1).action,'wait');
 const card=cloudPlanCard(report);assert.ok(!card.readOnly);assert.ok(card.html.includes(locale==='en'?'condition is retained':'保留已通'));
 const savedReport=structuredClone(report);savedReport.planRecords[0].status='pending';
 const saved=mergeCloudExecutionPlans([savedReport],[])[0];
 for(const html of [renderCurrentReports([report]).rendered.cards,renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:report,language})])assert.ok(html.includes(card.html));
 assert.deepEqual(normalizeCloudReports([report]),[report]);
 assert.equal(p.entryCondition.direction,side?'short':'long');
 if(locale==='en')assert.doesNotMatch(card.content,/[\u4e00-\u9fff]/);
});
test('unconfirmed 4h watch is distinct, nonexecutable and fails closed for malformed profiles',()=>{
 const report=cloudReportFromResponse(fixtures.watch)[0],watch=report.executionPlan.leftObservation;
 assert.ok(watch.plans.every(p=>p.routeId==='protect'));
 assert.match(leftWatchView(report,'en',watch.asOf).content,/4h left-side watch plan/);
 assert.equal(cloudPlanCard(report).readOnly,true);assert.equal(renderCurrentReports([report]).actions,'');
 for(const change of [v=>v.routeProfile='unknown',v=>v.plans={},v=>v.plans=[null],v=>v.plans[0].routeId='touch',v=>v.canCreateAlert=true]){
  const tampered=structuredClone(watch);change(tampered);assert.equal(validLeftObservation(tampered),false);
 }
});
