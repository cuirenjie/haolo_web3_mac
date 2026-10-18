import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {normalizeCloudReports,cloudReportFromResponse} from '../cloud-plan-contract.mjs';
import {parseExecutionPlanAlertInput} from '../trading-alerts/execution-plan-alert.mjs';

const fail=()=>{throw Object.assign(new Error('CLOUD_RESULT_CONTEXT_INVALID'),{code:'CLOUD_RESULT_CONTEXT_INVALID'});};
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
      ||scenario.stop!==spec.stopLoss||!equal(scenario.targets,[spec.takeProfit])
      ||rule?.side!==spec.direction||rule.entry!==spec.entry||rule.stop!==spec.stopLoss
      ||!equal(rule.targets,[spec.takeProfit])||rule.monitoringPolicy!=='windows_v1'
      ||rule.confirmation!=='intrabar'||rule.exitConfirmation!=='intrabar'
      ||rule.marketKey!==record.body.context.marketKey||rule.interval!==record.body.context.interval)fail();
  }
}
