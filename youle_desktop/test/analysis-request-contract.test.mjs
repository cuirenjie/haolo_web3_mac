import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validAnalysisRequestPlan} from '../src/shared/analysis-request-contract.mjs';
import {normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {validateCloudEntryResult} from '../src/main/trading-strategy-runtime/cloud-entry-result.mjs';
import {cloudAccountPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';

const receipt=(prompt,direction,entryMode)=>({version:'analysis-request-v1',
  promptHash:createHash('sha256').update(JSON.stringify(prompt)).digest('hex'),direction,entryMode,
  overrides:[],removedPreferences:[],savedRevision:3});
for(const locale of ['zh-CN','en','zh-Hant','ko'])for(const side of ['long','short'])for(const mode of ['left','right']) {
  test(`history keeps only requested ${side}/${mode}/${locale}`,()=>{
    const row=cloudAccountPlanCardFixture(locale,side),p=row.executionPlan;
    p.requestedMode=mode;p.selectedMode=mode;p.entryCondition.mode=mode;
    p.scenarios[0].entryCondition.mode=mode;
    p.requestRequirements=receipt('current input',side,mode);
    p.requestRequirements.savedRevision=0;
    row.planRecords[0].executionPlan=structuredClone(p);
    assert.equal(validAnalysisRequestPlan(p),true);
    assert.equal(normalizeCloudReports([row]).length,1);
    p.requestRequirements.direction=side==='long'?'short':'long';
    assert.equal(validAnalysisRequestPlan(p),false);
    assert.throws(()=>normalizeCloudReports([row]),/CLOUD_REPORT_INVALID/);
  });
}
test('live receipt allows current mode override and binds it to original request and saved revision',()=>{
  const prompt='@策略:裸K分析 本次左侧做多',context={snapshotId:'snapshot'};
  const p={schemaVersion:2,planId:'00000000-0000-4000-8000-000000000001',revision:1,policyVersion:'entry-v2.1',
    context,appliedPreferences:{revision:3},requestedMode:'left',selectedMode:null,scenarios:[],
    outcome:{capability:'supported',candidateStatus:'none',evaluationStatus:'completed',action:'wait',reason:'NO_CANDIDATE'},
    requestRequirements:receipt(prompt,'long','left')};
  const result={executionPlan:p,cloud:{executionPolicy:'entry-v2',locale:'zh-CN',resultHash:'a'.repeat(64),
    appliedPreferences:{revision:3},planIds:[],planRecords:[],conditionReceipts:[]},analysisPlan:{}};
  const record={requestedEntryMode:'right',body:{prompt,context,locale:'zh-CN'}};
  validateCloudEntryResult(result,record);
  for(const mutation of [r=>r.body.prompt+='做空',r=>r.body.prompt=undefined]) {
    const r=structuredClone(record);mutation(r);
    assert.throws(()=>validateCloudEntryResult(result,r));
  }
  p.requestRequirements.savedRevision=4;
  assert.throws(()=>validateCloudEntryResult(result,record),/CLOUD_RESULT_CONTEXT_INVALID/);
});
