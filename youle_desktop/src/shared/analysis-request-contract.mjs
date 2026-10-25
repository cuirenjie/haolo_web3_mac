// Transport guard only: the server interprets language and computes strategies.
// Absence is allowed for historical results created before this protocol.
export function validAnalysisRequestPlan(plan) {
  const r=plan?.requestRequirements;
  if(r===undefined)return true;
  if(!r||r.version!=='analysis-request-v1'||!/^[a-f0-9]{64}$/.test(r.promptHash??'')
    ||![null,'long','short','both','none'].includes(r.direction)||![null,'left','right'].includes(r.entryMode)
    ||!Number.isSafeInteger(r.savedRevision)||r.savedRevision<0||!Array.isArray(r.overrides)||!Array.isArray(r.removedPreferences)
    ||!Array.isArray(plan.scenarios)||(r.entryMode!==null&&plan.requestedMode!==r.entryMode))return false;
  return plan.scenarios.every(s=>['long','short'].includes(s.side)
    &&[null,'both',s.side].includes(r.direction)
    &&plan.entryCondition?.direction===s.side&&s.entryCondition?.direction===s.side
    &&plan.entryCondition?.mode===plan.selectedMode&&s.entryCondition?.mode===plan.selectedMode
    &&(r.entryMode===null||plan.selectedMode===r.entryMode));
}
