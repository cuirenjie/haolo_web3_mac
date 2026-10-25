// Display-only plans have no activation authority. Never synthesize a condition.
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function validPresentationReminder(plan, remote) {
  if(!plan?.planPresentation)return true;
  const scenario=plan.scenarios?.[0], rule=remote?.alertPreview;
  const exits=scenario?.positionSizing?.preferenceExitPolicy;
  return exits?.version==='preference-exits-v1' && equal(exits,rule?.preferenceExitPolicy)
    && rule?.entry===scenario.entry && rule?.stop===scenario.stop && equal(rule?.targets,scenario.targets);
}
export function validPlanPresentation(plan) {
  const p=plan?.planPresentation;
  if(p===undefined)return true; // frozen historical reports
  if(!p||p.version!=='always-card-v1'||!['actionable','not_recommended','unavailable'].includes(p.status)
    ||!Array.isArray(p.reasons)||!p.reasons.every(r=>typeof r==='string'&&/^[A-Z0-9_]{1,120}$/.test(r))
    ||!p.effectivePreferences||!Array.isArray(p.effects))return false;
  if(plan.outcome?.action==='plan')return p.status==='actionable'&&p.scenario===null&&p.reasons.length===0;
  if(p.status==='actionable'||!p.reasons.length||plan.scenarios?.length||plan.entryCondition!=null
    ||!/^[a-f0-9]{64}$/.test(p.presentationHash??''))return false;
  const s=p.scenario;
  if(p.status==='unavailable')return s===null;
  if(!s||s.eligible!==false||!['long','short'].includes(s.side)||!['left','right'].includes(s.mode)
    ||(plan.requestedMode!=='auto'&&s.mode!==plan.requestedMode)
    ||!positive(s.entry)||!positive(s.stop)||!Array.isArray(s.targets)||s.targets.length!==3||!s.targets.every(positive)
    ||s.entryCondition!=null||s.conditionHash!=null)return false;
  const r=plan.requestRequirements;
  if(r&&(![null,'both',s.side].includes(r.direction)||![null,s.mode].includes(r.entryMode)))return false;
  const z=s.positionSizing,sign=s.side==='long'?1:-1;
  if(!z||z.executionBlocked!==true||z.entry!==s.entry||z.stop!==s.stop||!equal(z.targets,s.targets)
    ||!equal(z.netRiskReward,s.riskReward)||!Array.isArray(s.riskReward)||s.riskReward.length!==3
    ||!positive(z.estimatedRoundTripCostRate)||sign*(s.entry-s.stop)<=0
    ||s.targets.some((t,i)=>sign*(t-(i?s.targets[i-1]:s.entry))<=0))return false;
  const cost=s.entry*z.estimatedRoundTripCostRate,risk=Math.abs(s.entry-s.stop)+cost;
  if(s.riskReward.some((r,i)=>!Number.isFinite(r)||Math.abs(r-(sign*(s.targets[i]-s.entry)-cost)/risk)>1e-8))return false;
  const t=s.trigger;
  if(!t||!['at_or_above','at_or_below','cross_up','cross_down','in_zone'].includes(t.operator)||!positive(t.lower)
    ||(t.operator==='in_zone'&&(!positive(t.upper)||t.upper<t.lower))
    ||s.entry!==(s.side==='short'?t.upper??t.lower:t.lower))return false;
  return true;
}

export function validPresentationDrawing(plan, patch) {
  const p=plan.planPresentation;
  if(!p||p.status==='actionable')return true;
  if(patch?.entryConditionRef)return false;
  const ink=(patch?.operations||[]).filter(o=>['strategy-entry','strategy-stop','strategy-target'].includes(o.drawing?.colorToken));
  if(!p.scenario)return ink.length===0;
  const levels=[['strategy-entry',p.scenario.entry],['strategy-stop',p.scenario.stop],...p.scenario.targets.map(t=>['strategy-target',t])];
  return ink.length===levels.length&&levels.every(([role,price],i)=>{
    const d=ink[i].drawing;
    return d.colorToken===role&&d.status==='tentative'&&d.points?.length===2&&d.points.every(point=>point.price===price)
      &&equal(d.evidenceIds,[`presentation:${p.presentationHash}`]);
  });
}
