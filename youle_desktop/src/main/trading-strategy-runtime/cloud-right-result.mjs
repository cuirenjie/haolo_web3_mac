import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {normalizeCloudReports,cloudReportFromResponse} from '../cloud-plan-contract.mjs';
import {parseExecutionPlanAlertInput} from '../trading-alerts/execution-plan-alert.mjs';

const fail=()=>{throw Object.assign(new Error('CLOUD_RESULT_CONTEXT_INVALID'),{code:'CLOUD_RESULT_CONTEXT_INVALID',retryable:false});};

// Legacy receipts contain TP1 only in the monitor, while newer plan records
// retain the complete native ladder. Additional levels must match exactly one
// frozen scenario; accepting any array that merely starts with TP1 is unsafe.
function validScenarioTargets(scenario, spec, executionPlan) {
  if (equal(scenario.targets, [spec.takeProfit])) return true;
  const targets = scenario.targets;
  if (!Array.isArray(targets) || targets.length < 2 || targets.length > 8
    || targets[0] !== spec.takeProfit || !targets.every(price => typeof price === 'number' && Number.isFinite(price) && price > 0)) return false;
  const direction = spec.direction === 'long' ? 1 : -1;
  if (direction * (spec.entry - spec.stopLoss) <= 0
    || targets.some((price, index) => direction * (price - (index ? targets[index - 1] : spec.entry)) <= 0)) return false;
  if (!Array.isArray(executionPlan?.scenarios)) return false;
  const matches = executionPlan.scenarios.filter(source => source?.side === spec.direction
    && source.trigger?.price === spec.entry && source.stop?.price === spec.stopLoss);
  return matches.length === 1 && Array.isArray(matches[0].targets)
    && equal(targets, matches[0].targets.map(target => target?.price));
}
export function validateCloudRightResult(result,record) {
  const cloud=result.cloud,receipt=cloud?.nativeReceipt;
  if(cloud?.executionPolicy!=='right-legacy-v1'||cloud.appliedPreferences?.policyVersion!=='right-legacy-v1'
    ||record.requestedEntryMode!=='right'||typeof receipt?.canonicalJson!=='string'||receipt.canonicalJson.length>2000000
    ||createHash('sha256').update(receipt.canonicalJson).digest('hex')!==receipt.hash)fail();
  const {cloud:ignored,...native}=result;
  let frozen;
  try {frozen=JSON.parse(receipt.canonicalJson);} catch {fail();}
  if(!equal(frozen,native))fail();
  let report;
  try {report=normalizeCloudReports(cloudReportFromResponse(result))[0];}catch {fail();}
  if(!report||!equal(cloud.planIds,report.planRecords.map(plan=>plan.id)))fail();
  for(const plan of report.planRecords) {
    if(!equal(plan.executionPlan,result.executionPlan)||!equal(plan.context,record.body.context)
      ||!equal(plan.appliedPreferences,cloud.appliedPreferences)
      ||plan.expiresAt!==result.executionPlan.expiresAt||plan.alertPreview?.expiresAt!==plan.expiresAt)fail();
    let spec;
    try {spec=parseExecutionPlanAlertInput({...plan.card,planId:'legacy-card',status:'pending'});}
    catch(error){if(error.code!=='TRADING_ALERT_EXECUTION_PLAN_INVALID')throw error;}
    if(!spec){
      if(!equal(plan.scenario,{side:'neutral',entry:null,stop:null,targets:[],eligible:false})
        ||plan.alertPreview?.side!=='neutral'||plan.alertPreview.entry!==null||plan.alertPreview.stop!==null
        ||!equal(plan.alertPreview.targets,[]))fail();
      continue;
    }
    const rule=plan.alertPreview,scenario=plan.scenario;
    if(spec.marketId!==record.marketId||spec.interval!==record.body.context.interval
      ||scenario?.eligible!==true||scenario.side!==spec.direction||scenario.entry!==spec.entry
      ||scenario.stop!==spec.stopLoss||!validScenarioTargets(scenario,spec,result.executionPlan)
      ||rule?.side!==spec.direction||rule.entry!==spec.entry||rule.stop!==spec.stopLoss
      ||!equal(rule.targets,[spec.takeProfit])||rule.monitoringPolicy!=='windows_v1'
      ||rule.confirmation!=='intrabar'||rule.exitConfirmation!=='intrabar'
      ||rule.marketKey!==record.body.context.marketKey||rule.interval!==record.body.context.interval)fail();
  }
}
