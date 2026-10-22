import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCloudEntryResult} from '../src/main/trading-strategy-runtime/cloud-entry-result.mjs';
import {cloudReportFromResponse,normalizeCloudReports,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports} from './support/right-renderer-parity.mjs';

// Backend-generated public receipts are shared with Flutter, including failures.
const fixture=process.env.HAOLO_SMT_PUBLIC_FIXTURE||new URL('./fixtures/smt-pairing-public.json',import.meta.url);
const {cases}=JSON.parse(fs.readFileSync(fixture,'utf8'));
for(const sample of cases)test(`${sample.name}: SMT reasons survive validation, rendering and restoration`,()=>{
  const {result,record}=structuredClone(sample);
  validateCloudEntryResult(result,record);
  const [report]=cloudReportFromResponse(result);
  const [restored]=normalizeCloudReports(JSON.parse(JSON.stringify([report])));
  const d=result.executionPlan.smtDiagnostics;
  assert.deepEqual(restored,report);
  assert.deepEqual(restored.executionPlan.smtDiagnostics,d);
  const {rendered}=renderCurrentReports([restored]);
  assert.ok(rendered.bubbleContent.includes(d.summary));
  for(const check of d.checks)assert.ok(rendered.bubbleContent.includes(check.marketId));
  if(!result.executionPlan.scenarios.length){
    assert.equal(cloudPlanCard(restored),null);
    assert.equal(rendered.cards,'');
  }
  const corrupt=structuredClone(result);
  corrupt.executionPlan.smtDiagnostics.code='SMT_UNKNOWN';
  assert.throws(()=>validateCloudEntryResult(corrupt,record));
});
