import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCloudResult,validateSavedCloudResult} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudReportFromResponse,normalizeCloudReports,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';

const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/wyckoff-dual-cross-platform.json',import.meta.url))).cases;
for(const c of cases)test(`${c.run.locale}/${c.bullish}/${c.blocked}: independent Wyckoff cards, history and saved receipts`,()=>{
  const result=validateCloudResult(c.run,c.record), reports=cloudReportFromResponse(result);
  assert.equal(reports.length,2);
  assert.deepEqual(normalizeCloudReports(reports),reports);
  assert.equal(new Set(reports.map(r=>r.executionPlan.planId)).size,2);
  assert.deepEqual(new Set(reports.map(r=>r.executionPlan.wyckoffScenario.side)),new Set(['long','short']));
  assert.throws(()=>normalizeCloudReports([...reports,reports[0]]));
  const pending=structuredClone(reports.filter(r=>r.planRecords.length));
  for(const r of pending)r.planRecords[0].status='pending';
  const saved=mergeCloudExecutionPlans(pending,[]);
  assert.equal(saved.length,c.blocked?0:2);
  const chat=renderCurrentReports(reports);
  for(const report of reports) {
    const card=cloudPlanCard(report), language=report.locale==='zh-Hant'?'zh-TW':report.locale;
    assert.ok(chat.rendered.cards.includes(card.html));
    assert.ok(executionPlanStickyHtml({cloudReport:report,language}).includes(card.html));
    if(!c.blocked) {
      const remote={...report.planRecords[0],saved:true};
      const receipt=validateSavedCloudResult(c.run,remote);
      assert.deepEqual(receipt.executionPlan,report.executionPlan);
      assert.equal(receipt.cloud.planRecords.length,1);
      const p=saved.find(p=>p.cloudReport.executionPlan.planId===remote.id);
      assert.ok(renderCurrentSavedPlan(p,language).includes(card.html));
      assert.equal(report.drawingPatch.entryConditionRef.conditionHash,report.executionPlan.conditionHash);
    } else assert.equal(card.readOnly,true);
    if(report.locale==='en')assert.doesNotMatch(card.content,/[\u4e00-\u9fff]/);
  }
});

for(const mutation of ['strategy','condition','missing','duplicate','metadata','swap','context'])test(`reject malformed Wyckoff group: ${mutation}`,()=>{
  const c=structuredClone(cases[0]), result=c.run.desktopResult, group=result.executionPlan.wyckoffPlanSet;
  if(mutation==='strategy')c.run.strategy=result.strategy.id=c.record.body.strategy='vegas';
  if(mutation==='condition')group.plans[0].entryCondition.wyckoffRetest.requiresReclaim=true;
  if(mutation==='missing')result.cloud.planRecords.pop();
  if(mutation==='duplicate')group.plans[1]=structuredClone(group.plans[0]);
  if(mutation==='metadata')delete group.plans[0].wyckoffScenario;
  if(mutation==='swap')result.cloud.planRecords[0].executionPlan=group.plans[1];
  if(mutation==='context')group.plans[1].context.snapshotId='another-snapshot';
  assert.throws(()=>validateCloudResult(c.run,c.record));
});
