import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {cloudPlanCard,selectCloudPlan,legacyReportCandidates} from '../../src/main/cloud-plan-contract.mjs';
import {createSavedExecutionPlan,loadExecutionPlans,saveExecutionPlans,executionPlanDisplayLines} from '../../src/renderer/execution-plans.ts';
import {mergeCloudExecutionPlans} from '../../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../../src/main/execution-plan-sticky-view.mjs';
import {validateCloudResult} from '../../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {verifyRendererParity} from './right-renderer-parity.mjs';

export async function verifyRightChain({result,reports,plans,record}) {
  const full=reports[0];
  verifyRendererParity(full);
  assert.equal(result.cloud.executionPolicy,'right-legacy-v1');
  assert.equal(result.executionPlan.schemaVersion,1);
  const baseline=process.env.HAOLO_RIGHT_BASELINE_ROOT;
  let old,view,alert;
  if(baseline) {
    old=await import(pathToFileURL(resolve(baseline,'youle_desktop/src/renderer/execution-plans.ts')));
    view=await import(pathToFileURL(resolve(baseline,'youle_desktop/src/main/execution-plan-card-view.mjs')));
    alert=await import(pathToFileURL(resolve(baseline,'youle_desktop/src/main/trading-alerts/execution-plan-alert.mjs')));
    const expected=old.executionPlanCandidatesFromText(full.report).filter(c=>old.executionPlanHasConcreteTradingPlan(c))
      .map(c=>old.executionPlanCandidateWithSourceText(c,full.report));
    assert.deepEqual(legacyReportCandidates(full.report),expected,'independent original card extraction');
  }
  const runEnvelope={...record.body,id:record.runId,desktopResult:result};
  for(const tamper of [r=>{r.analysisPlan.report+='changed';},r=>{r.cloud.nativeReceipt.canonicalJson+=' ';},
    r=>{r.executionPlan.scenarios=[];r.executionPlan.modified=true;},r=>{r.analysisPlan.analysisId='wrong';},
    ...(result.cloud.planRecords.length?[r=>{r.cloud.planRecords[0].card.content+='changed';},r=>{r.cloud.planRecords[0].scenario.entry=1;},r=>{r.cloud.planIds=[];}]:[])]) {
    const changed=structuredClone(result);tamper(changed);
    assert.throws(()=>validateCloudResult({...runEnvelope,desktopResult:changed},record),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  }
  const activated=[];
  for(const remote of full.planRecords) {
    const report=selectCloudPlan(full,remote),card=cloudPlanCard(report);
    assert.ok(card);
    if(old) {
      const language=report.locale==='zh-Hant'?'zh-TW':report.locale;
      const lines=old.executionPlanDisplayLines(remote.card.content);
      assert.equal(card.html,view.executionPlanCardHeading(remote.card.title,lines,language)+view.executionPlanCardBody(lines,language),'original card HTML');
      for(const theme of ['light','dark']) {
        const payload={theme,language,title:card.title,lines:executionPlanDisplayLines(card.content)};
        assert.equal(executionPlanStickyHtml({...payload,cloudReport:report}),executionPlanStickyHtml(payload),'sticky retains original layout');
      }
      if(remote.scenario.eligible) {
        const spec=alert.parseExecutionPlanAlertInput({...remote.card,planId:'legacy-card',status:'pending'});
        assert.equal(remote.alertPreview.entry,spec.entry);assert.equal(remote.alertPreview.stop,spec.stopLoss);
        assert.deepEqual(remote.alertPreview.targets,[spec.takeProfit]);
      }
    }
    const reference={planId:remote.id,runId:remote.runId,version:remote.version,confirmationHash:remote.confirmationHash};
    if(!remote.scenario.eligible){await assert.rejects(plans.perform('activate',reference));continue;}
    const first=await plans.perform('activate',reference),again=await plans.perform('activate',reference);
    assert.equal(again.plan.version,first.plan.version);assert.equal(first.alert.rule.monitoringPolicy,'windows_v1');
    assert.equal(first.alert.rule.confirmation,'intrabar');
    const saved=createSavedExecutionPlan({candidate:{...card,cloudReport:selectCloudPlan(full,first.plan)},sourceThreadId:'original-sdk-thread',sourceMessageId:'report'});
    assert.equal(saved.id,remote.id);
    const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
    assert.equal(saveExecutionPlans('owner',[saved],storage),true);
    assert.deepEqual(loadExecutionPlans('owner',storage),[saved]);
    activated.push({reference,first});
  }
  const listed=await plans.perform('list');
  assert.equal(listed.reports.length,activated.length);
  const merged=mergeCloudExecutionPlans(listed.reports,[]);
  assert.equal(new Set(merged.map(p=>p.id)).size,activated.length,'alternatives have independent identities');
  for(const {reference,first} of activated) {
    const ended=await plans.perform('lifecycle',{...reference,version:first.plan.version,status:'ended',endReason:'cancelled'});
    assert.equal(ended.alert.enabled,false);
    const retry=await plans.perform('lifecycle',{...reference,version:first.plan.version,status:'ended',endReason:'cancelled'});
    assert.equal(retry.plan.version,ended.plan.version);
    assert.equal((await plans.perform('delete',{...reference,version:ended.plan.version})).status,'deleted');
    assert.equal((await plans.perform('delete',{...reference,version:ended.plan.version})).status,'deleted');
  }
  assert.deepEqual((await plans.perform('list')).reports,[]);
}
