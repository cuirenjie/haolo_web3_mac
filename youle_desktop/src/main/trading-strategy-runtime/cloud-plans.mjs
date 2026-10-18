import {isDeepStrictEqual as equal} from 'node:util';
import {validateCloudResult} from './cloud-runtime.mjs';
import {cloudReportFromResponse} from '../cloud-plan-contract.mjs';

const fail = code => {throw Object.assign(new Error(code),{code});};
export function createCloudPlans({owner,api}) {
  const active=new Set();
  async function request(captured,operation,payload={},key) {
    const assert=async()=>{const current=await owner();if(current.ownerId!==captured.ownerId||current.baseUrl!==captured.baseUrl)fail('TRADING_PREFERENCE_OWNER_CHANGED');};
    await assert();
    const response=await api().tradingCloudRequest(operation,payload,{expectedAccountId:captured.accountId,expectedBaseUrl:captured.baseUrl,...(key?{idempotencyKey:key}:{})});
    await assert();return response;
  }
  return {async perform(action,input={}) {
    const captured=await owner();
    if(action==='list') {
      const reports=[],items=[],seen=new Set(),cursors=new Set();let after;
      do {
        const response=await request(captured,'plans',after?{after}:{});
        if(!Array.isArray(response.items)||response.items.length>50)fail('CLOUD_RESULT_CONTEXT_INVALID');
        for(const plan of response.items) {
        if(plan.monitoringPolicy!=='entry_v2'||!plan.saved||plan.deleted||seen.has(plan.id))fail('CLOUD_RESULT_CONTEXT_INVALID');
        seen.add(plan.id);items.push(plan);
        const run=response.receipts?.[plan.id]||await request(captured,'run',{runId:plan.runId});
        const result=validateCloudResult(run,{runId:run.id,body:{...run,preferencesRevision:plan.appliedPreferences.revision},
          preferencesHash:plan.appliedPreferences.configHash,requestedEntryMode:plan.executionPlan.requestedMode,
          marketId:run.desktopResult?.snapshot?.marketId,interval:run.desktopResult?.snapshot?.interval});
        if(!equal(result.executionPlan,plan.executionPlan))fail('CLOUD_RESULT_CONTEXT_INVALID');
        reports.push({...cloudReportFromResponse(result)[0],planRecords:[plan]});
        }
        after=response.nextCursor;
        if(after&&(cursors.has(after)||items.length>=5000))fail('CLOUD_PLAN_LIMIT');
        cursors.add(after);
      }while(after);
      return {items,reports};
    }
    if(!['read','activate','lifecycle','delete'].includes(action))fail('CLOUD_PLAN_ACTION_INVALID');
    const planId=String(input.planId||'');
    const lock=`${captured.ownerId}:${planId}`;
    if(active.has(lock))fail('CLOUD_PLAN_BUSY');
    active.add(lock);
    try {
      let plan;
      try {plan=await request(captured,'plan',{planId});} catch(error) {
        // A committed delete can lose its response. Reuse the original version
        // and key to retrieve its receipt, even though the public GET is gone.
        if(action!=='delete'||error.code!=='RESOURCE_NOT_FOUND')throw error;
        if(!Number.isSafeInteger(input.version)||input.version<1)fail('PLAN_VERSION_CONFLICT');
        return request(captured,'deletePlan',{planId,version:input.version},`delete:${planId}:${input.version}::`);
      }
      if(plan.id!==planId||plan.monitoringPolicy!=='entry_v2')fail('ENTRY_POLICY_UNAVAILABLE');
      if(action==='read')return {plan};
      if(plan.confirmationHash!==input.confirmationHash||plan.scenario?.conditionHash!==input.conditionHash||plan.runId!==input.runId)fail('CLOUD_RESULT_CONTEXT_INVALID');
      let result;
      if(action==='activate') {
        if(plan.saved && plan.linkedAlertId)return {plan,alreadyActive:true};
        if(!Number.isSafeInteger(input.version)||input.version<1)fail('PLAN_VERSION_CONFLICT');
        result=await request(captured,'activatePlan',{planId,version:input.version,confirmationHash:plan.confirmationHash,monitoringPolicy:'entry_v2'},`activate:${planId}:${plan.confirmationHash}`);
      } else {
        if(!Number.isSafeInteger(input.version)||input.version<1)fail('PLAN_VERSION_CONFLICT');
        // Use the caller's frozen version for an uncertain retry. Never replay
        // an old action against a newer version by silently adopting it.
        const payload={planId,version:input.version};
        if(action==='lifecycle') {
          if(!['pending','executing','ended'].includes(input.status)|| (input.status==='ended')!==['take_profit','stop_loss','cancelled','expired'].includes(input.endReason))fail('PLAN_STATUS_INVALID');
          Object.assign(payload,{status:input.status,endReason:input.status==='ended'?input.endReason:null,monitoringPolicy:'entry_v2'});
        }
        result=await request(captured,action==='delete'?'deletePlan':'planLifecycle',payload,
          `${action}:${planId}:${input.version}:${input.status||''}:${input.endReason||''}`);
        if(action==='delete')return result;
      }
      if(result.plan?.id!==planId||!equal(result.plan.executionPlan,plan.executionPlan)||result.plan.confirmationHash!==plan.confirmationHash
        ||result.alert?.planId!==planId||result.alert?.rule?.monitoringPolicy!=='entry_v2'
        ||!equal(result.alert.rule.entryCondition,plan.scenario.entryCondition)||result.alert.rule.conditionHash!==input.conditionHash)fail('CLOUD_RESULT_CONTEXT_INVALID');
      const latest=await request(captured,'plan',{planId});
      if(latest.id!==planId||latest.confirmationHash!==plan.confirmationHash||!equal(latest.executionPlan,plan.executionPlan))fail('CLOUD_RESULT_CONTEXT_INVALID');
      return {...result,plan:latest};
    } finally {active.delete(lock);}
  }};
}
