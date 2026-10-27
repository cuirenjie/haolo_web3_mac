import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCloudEntryResult} from '../src/main/trading-strategy-runtime/cloud-entry-result.mjs';
import {cloudReportFromResponse,normalizeCloudReports,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';

// Same synthetic backend-generated fixture is consumed by Flutter. No local
// trading algorithm is reintroduced into the cloud-only Windows runtime.
const fixture = process.env.HAOLO_WYCKOFF_RETEST_FIXTURE || new URL('./fixtures/wyckoff-retest-public.json',import.meta.url);
const {cases}=JSON.parse(fs.readFileSync(fixture,'utf8'));
for(const sample of cases)test(`${sample.name}: backend retest receipt survives client validation, report and restoration`,()=>{
  const {result,record,kind,locale}=structuredClone(sample),before=structuredClone(result);
  validateCloudEntryResult(result,record);
  const [report]=cloudReportFromResponse(result),[restored]=normalizeCloudReports(JSON.parse(JSON.stringify([report])));
  assert.deepEqual(restored,report);
  assert.deepEqual(restored.executionPlan.entryDiagnostics,result.executionPlan.entryDiagnostics);
  const {rendered,actions}=renderCurrentReports([restored]);
  // Renderer harness escapes markdown instead of formatting it; all original
  // diagnostic text must still reach the bubble unchanged.
  assert.ok(rendered.bubbleContent.includes(locale==='en'?'range':locale==='zh-Hant'?'箱':'箱'));
  if(kind==='wait'){
    assert.ok(rendered.bubbleContent.includes('ST'));
    assert.equal(cloudPlanCard(restored),null);
    assert.equal(rendered.cards,'');assert.equal(actions,'');
    assert.match(rendered.bubbleContent,/LPS/);assert.match(rendered.bubbleContent,/5/);assert.match(rendered.bubbleContent,/4/);
    assert.equal(restored.executionPlan.scenarios.length,0);
  }else{
    const plan=restored.executionPlan,scenario=plan.scenarios[0];
    assert.equal(plan.selectedMode,'left');assert.equal(scenario.side,kind);
    assert.equal(plan.entryCondition.confirmation,'touch');
    assert.equal(scenario.entry,kind==='long'?99.5:100.5);
    const card=cloudPlanCard(restored),language=locale==='zh-Hant'?'zh-TW':locale;
    // Pure projection of a later saved receipt; no plan is saved/activated.
    const savedReceipt=structuredClone(restored);
    Object.assign(savedReceipt.planRecords[0],{saved:true,status:'pending',version:2});
    const saved=mergeCloudExecutionPlans([savedReceipt],[])[0];
    for(const markup of [rendered.cards,renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:restored,language,title:card.title})]){
      assert.ok(markup.includes(cloudPlanCard(restored,{separateAction:true}).html));
      assert.ok(markup.includes(scenario.entry.toFixed(2)));
      assert.equal((card.html.match(/class="execution-plan-target"/g)||[]).length,3);
    }
    assert.equal(plan.conditionHash,scenario.conditionHash);
  }
  assert.deepEqual(result,before);
});
