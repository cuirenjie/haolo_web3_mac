import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {validConditionalWatch} from '../conditional-watch-card.mjs';
import {validSmtDiagnostics} from '../../shared/smt-diagnostics.mjs';
import {validAnalysisRequestPlan} from '../../shared/analysis-request-contract.mjs';
import {validPlanPresentation,validPresentationDrawing,validPresentationReminder} from '../../shared/plan-presentation.mjs';
import {wyckoffPlans,wyckoffPlanPatch,validWyckoffRetest} from '../../shared/wyckoff-plan-set.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const modes = new Set(['left','right','auto']);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const require = value => {if (!value) throw Object.assign(new Error('CLOUD_RESULT_CONTEXT_INVALID'), {code:'CLOUD_RESULT_CONTEXT_INVALID'});};
function predicate(value, zoneOnly=false) {
  require(value && ['at_or_above','at_or_below','cross_up','cross_down','in_zone'].includes(value.operator) && positive(value.lower));
  require(value.operator === 'in_zone' ? positive(value.upper) && value.upper >= value.lower : value.upper == null);
  if (zoneOnly) require(value.operator === 'in_zone');
}

// Transport validation only. Selection, risk evaluation and reminder execution
// remain on the server. No strategy or natural-language parser is included.
export function validateCloudEntryResult(result, record, {savedPlan}={}) {
  const plan=result.executionPlan, cloud=result.cloud, expected=record.body;
  if(plan?.wyckoffPlanSet) {
    const plans=wyckoffPlans(plan,result.strategy?.id);
    const active=plans.filter(p=>p.scenarios.length);
    require(Array.isArray(cloud.planIds)&&Array.isArray(cloud.planRecords)&&Array.isArray(cloud.conditionReceipts)
      &&cloud.planIds.length===active.length&&cloud.planRecords.length===active.length&&cloud.conditionReceipts.length===active.length
      &&new Set(cloud.planIds).size===active.length);
    for(const child of plans) {
      const remote=cloud.planRecords.filter(p=>p.id===child.planId);
      require(remote.length===child.scenarios.length);
      validateCloudEntryResult({...result,executionPlan:child,
        analysisPlan:{...result.analysisPlan,executionPlan:child,drawingPatch:wyckoffPlanPatch(result.analysisPlan.drawingPatch,child)},
        cloud:{...cloud,planIds:remote.map(p=>p.id),planRecords:remote,
          conditionReceipts:cloud.conditionReceipts.filter(r=>r.conditionHash===child.conditionHash)}},record);
    }
    return;
  }
  require(validWyckoffRetest(plan,result.strategy?.id));
  require(cloud.executionPolicy==='entry-v2' && cloud.locale===expected.locale && hash(cloud.resultHash));
  require(plan?.schemaVersion===2 && uuid(plan.planId) && plan.revision===1 && plan.policyVersion==='entry-v2.1');
  require(equal(plan.context,expected.context) && equal(plan.appliedPreferences,cloud.appliedPreferences));
  require(validAnalysisRequestPlan(plan));
  require(validPlanPresentation(plan)&&validPresentationDrawing(plan,result.analysisPlan?.drawingPatch));
  const request=plan.requestRequirements;
  if(request) {
    require(request.savedRevision===cloud.appliedPreferences?.revision);
    if(savedPlan)require(savedPlan.saved===true&&!savedPlan.deleted&&savedPlan.id===plan.planId
      &&savedPlan.runId===cloud.runId&&equal(savedPlan.executionPlan,plan)
      &&equal(savedPlan.appliedPreferences,cloud.appliedPreferences));
    // A list receipt has no raw prompt. Validate its frozen request contract;
    // if a full run supplies a prompt, still check it. Missing live prompts and
    // malformed values are protocol errors, never crypto TypeErrors.
    if(!savedPlan||Object.hasOwn(expected,'prompt'))require(typeof expected.prompt==='string'
      &&request.promptHash===createHash('sha256').update(JSON.stringify(expected.prompt),'utf8').digest('hex'));
  }
  require(modes.has(plan.requestedMode) && plan.requestedMode===(request?.entryMode??record.requestedEntryMode));
  require(['left','right',null].includes(plan.selectedMode) && (plan.requestedMode==='auto'||plan.selectedMode===null||plan.selectedMode===plan.requestedMode));
  require(Array.isArray(plan.scenarios) && plan.scenarios.length<=1 && Array.isArray(cloud.planIds) && Array.isArray(cloud.planRecords) && Array.isArray(cloud.conditionReceipts));
  require(cloud.planIds.length===plan.scenarios.length && cloud.planRecords.length===plan.scenarios.length && cloud.conditionReceipts.length===plan.scenarios.length);
  if (plan.kind==='position_assessment') {
    require(expected.positionManagementRequested===true && plan.scenarios.length===0 && plan.selectedMode===null && plan.entryCondition==null);
    return;
  }
  const outcome=plan.outcome;
  if(plan.smtDiagnostics!==undefined) {
    require(result.strategy?.id==='smt-divergence'&&validSmtDiagnostics(plan.smtDiagnostics)
      &&equal(plan.smtDiagnostics,result.analysisPlan?.smtDiagnostics)
      &&plan.smtDiagnostics.primaryMarketId===result.snapshot?.marketId
      &&plan.smtDiagnostics.interval===result.snapshot?.interval
      &&plan.smtDiagnostics.snapshotTime===result.snapshot?.snapshotTime);
  }
  require(outcome && ['supported','unsupported'].includes(outcome.capability) && ['qualified','none','not_evaluated'].includes(outcome.candidateStatus)
    && ['completed','data_unavailable','model_failed','not_evaluated'].includes(outcome.evaluationStatus) && ['plan','wait','unavailable'].includes(outcome.action)
    && /^[A-Z0-9_]{1,120}$/.test(outcome.reason));
  if (outcome.action!=='unavailable') require(outcome.capability==='supported' && outcome.evaluationStatus==='completed');
  if (outcome.action!=='plan') {
    require(plan.scenarios.length===0 && plan.entryCondition==null && plan.selectedMode===null);
    require(!result.analysisPlan.drawingPatch?.entryConditionRef);
    if(plan.conditionalWatch!==undefined) require(validConditionalWatch(plan.conditionalWatch,plan,result.strategy.id));
    return;
  }
  require(outcome.candidateStatus==='qualified' && plan.scenarios.length===1);
  const scenario=plan.scenarios[0], condition=plan.entryCondition, remote=cloud.planRecords[0], receipt=cloud.conditionReceipts[0];
  require(validPresentationReminder(plan,remote));
  require(condition?.schemaVersion===2 && uuid(condition.conditionId) && condition.revision===1 && hash(plan.conditionHash));
  require(condition.snapshotId===expected.context.snapshotId && condition.marketKey===expected.context.marketKey && condition.interval===plan.executionInterval);
  require(condition.mode===plan.selectedMode && condition.direction===scenario.side && ['long','short'].includes(scenario.side));
  require(Number.isSafeInteger(condition.createdAt) && condition.createdAt>=0 && Number.isSafeInteger(condition.expiresAt) && condition.expiresAt>condition.createdAt && condition.expiresAt===plan.expiresAt);
  require(['touch','bar_close','breakout_retest'].includes(condition.confirmation));
  predicate(condition.trigger);
  if(condition.confirmation==='breakout_retest') {predicate(condition.retest,true);require(['cross_up','cross_down'].includes(condition.trigger.operator));}
  else require(condition.retest==null && condition.confirmedBreakout==null && condition.breakoutConfirmation==='trade');
  if(condition.invalidation) {predicate(condition.invalidation);require(['at_or_above','at_or_below'].includes(condition.invalidation.operator));}
  require(receipt?.conditionHash===plan.conditionHash && typeof receipt.canonicalJson==='string' && receipt.canonicalJson.length<=16000);
  require(createHash('sha256').update(receipt.canonicalJson,'utf8').digest('hex')===plan.conditionHash);
  let parsed;try {parsed=JSON.parse(receipt.canonicalJson);} catch {require(false);}
  require(equal(parsed,condition) && equal(scenario.entryCondition,condition) && scenario.conditionHash===plan.conditionHash && scenario.confirmation===condition.confirmation);
  require(scenario.eligible===true && positive(scenario.entry) && positive(scenario.stop) && Array.isArray(scenario.targets) && scenario.targets.length>0 && scenario.targets.every(positive));
  require(cloud.planIds[0]===plan.planId && remote?.id===plan.planId && remote.runId===cloud.runId && remote.monitoringPolicy==='entry_v2' && hash(remote.confirmationHash));
  require(Number.isSafeInteger(remote.version) && remote.version>=1 && equal(remote.context,expected.context) && equal(remote.executionPlan,plan) && equal(remote.scenario,scenario));
  require(equal(remote.appliedPreferences,cloud.appliedPreferences) && equal(remote.alertPreview?.entryCondition,condition) && remote.alertPreview?.conditionHash===plan.conditionHash);
  require(remote.alertPreview?.monitoringPolicy==='entry_v2' && remote.alertPreview?.confirmation===condition.confirmation && remote.alertPreview?.interval===condition.interval);
  require(remote.alertPreview?.side===scenario.side && remote.alertPreview?.entry===scenario.entry && remote.alertPreview?.stop===scenario.stop && equal(remote.alertPreview?.targets,scenario.targets));
  const ref={conditionId:condition.conditionId,revision:condition.revision,conditionHash:plan.conditionHash};
  require(equal(result.analysisPlan.drawingPatch?.entryConditionRef,ref));
  if(result.analysisPlan.indicatorDrawingPatch)require(equal(result.analysisPlan.indicatorDrawingPatch.entryConditionRef,ref));
  for(const op of result.analysisPlan.drawingPatch.operations) {
    if(['strategy-entry','strategy-stop','strategy-target'].includes(op.drawing?.colorToken))
      require(op.drawing.evidenceIds?.includes(`condition:${condition.conditionId}:${condition.revision}:${plan.conditionHash}`));
  }
}
