// Transport-only expansion. Existing single-plan cards and actions stay intact.
export const WYCKOFF_PLAN_VERSION = 'wyckoff-dual-v1';
export const sameWyckoffValue = (a,b) => {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameWyckoffValue(a[k],b[k]));
};
const fail=()=>{throw new Error('CLOUD_REPORT_INVALID');};
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function validWyckoffRetest(plan,strategy) {
  const gate=plan?.entryCondition?.wyckoffRetest, meta=plan?.wyckoffScenario;
  if(!gate&&!meta)return true;
  if(strategy!=='wyckoff'||meta?.version!==WYCKOFF_PLAN_VERSION||!['long','short'].includes(meta.side)
    ||!['continuation','reversal'].includes(meta.kind)||typeof meta.rangeId!=='string')return false;
  if(!plan.scenarios?.length)return plan.entryCondition==null;
  const c=plan.entryCondition,s=plan.scenarios[0];
  return gate?.version==='wyckoff-retest-v1'&&gate.rangeId===meta.rangeId
    &&positive(gate.lower)&&positive(gate.upper)&&gate.lower<gate.upper
    &&gate.requiresReclaim===(meta.kind==='reversal')&&c.direction===meta.side&&s.side===meta.side
    &&c.confirmation==='bar_close'&&c.trigger?.operator===(c.direction==='long'?'at_or_above':'at_or_below')
    &&c.trigger.lower===(c.direction==='long'?gate.upper:gate.lower)&&s.entry===c.trigger.lower;
}
export function wyckoffPlans(plan,strategy) {
  if(!plan?.wyckoffPlanSet)return [plan];
  const group=plan.wyckoffPlanSet, plans=group.plans;
  if(strategy!=='wyckoff'||group.version!==WYCKOFF_PLAN_VERSION||!Array.isArray(plans)||plans.length<1||plans.length>2)fail();
  if(plans.some(p=>!p||!p.wyckoffScenario||p.wyckoffPlanSet||!Array.isArray(p.scenarios)||p.scenarios.length>1||!validWyckoffRetest(p,strategy))
    ||new Set(plans.map(p=>p.planId)).size!==plans.length||new Set(plans.map(p=>p.wyckoffScenario.side)).size!==plans.length
    ||plans.some(p=>p.wyckoffScenario.rangeId!==plans[0].wyckoffScenario.rangeId||!sameWyckoffValue(p.context,plan.context)))fail();
  const expected={...plans[0],scenarios:plans.flatMap(p=>p.scenarios),wyckoffPlanSet:group};
  if(!sameWyckoffValue(expected,plan))fail();
  return plans;
}
export function wyckoffPlanPatch(patch,plan) {
  if(!patch||!plan.wyckoffScenario)return patch;
  const c=plan.entryCondition;
  const evidence=c?`condition:${c.conditionId}:${c.revision}:${plan.conditionHash}`:`presentation:${plan.planPresentation?.presentationHash}`;
  const {entryConditionRefs,entryConditionRef,...base}=patch;
  return {...base,operations:patch.operations.filter(op=>{
    const d=op.drawing;
    if(d?.theory==='strategy')return d.evidenceIds?.includes(evidence);
    if(d?.id?.includes('-summary-'))return d.id.endsWith(`-${plan.wyckoffScenario.side}`);
    return true;
  }),...(c?{entryConditionRef:{conditionId:c.conditionId,revision:c.revision,conditionHash:plan.conditionHash}}:{})};
}
export function expandWyckoffReport(row) {
  if(!row?.executionPlan?.wyckoffPlanSet)return [row];
  const plans=wyckoffPlans(row.executionPlan,row.strategyId);
  const active=plans.filter(p=>p.scenarios.length);
  if(!Array.isArray(row.planRecords)||row.planRecords.length!==active.length
    ||new Set(row.planRecords.map(r=>r.id)).size!==active.length
    ||active.some(p=>!row.planRecords.some(r=>r.id===p.planId&&sameWyckoffValue(r.executionPlan,p))))fail();
  return plans.map(plan=>({...row,executionPlan:plan,planRecords:row.planRecords.filter(r=>r.id===plan.planId),
    drawingPatch:wyckoffPlanPatch(row.drawingPatch,plan)}));
}
