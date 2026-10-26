import { koreanText, localizedChoice } from '../shared/korean.mjs';
// Public presentation contract shared with the renderer and durable history.
// Contains no strategy decisions. The main process validates the server receipt;
// activation always re-reads the account-owned plan on the server.
import {executionPlanCandidatesFromText,executionPlanCandidateWithSourceText,executionPlanDisplayLines,
  executionPlanHasStructuredTradingFields,executionPlanHasConcreteTradingPlan} from './legacy-execution-plan-presentation.mjs';
import {executionPlanCardHeading,executionPlanCardBody,executionPlanStructuredCardBody,executionPlanCardAction} from './execution-plan-card-view.mjs';
import {cloudPlanAccountView,cloudPlanEntryBasisMismatch} from './cloud-plan-account-view.mjs';
import {validLeftObservation,leftRouteView} from './price-action-left-card.mjs';
import {validConditionalWatch,conditionalWatchCard} from './conditional-watch-card.mjs';
import {normalizePlanProbability} from './plan-probability-view.mjs';
import {validAnalysisRequestPlan} from '../shared/analysis-request-contract.mjs';
import {validPlanPresentation,validPresentationDrawing,validPresentationReminder} from '../shared/plan-presentation.mjs';
import {planPresentationCard} from './plan-presentation-card.mjs';
import {expandWyckoffReport, validWyckoffRetest} from '../shared/wyckoff-plan-set.mjs';
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const predicate=value=>value&&['at_or_above','at_or_below','cross_up','cross_down','in_zone'].includes(value.operator)&&positive(value.lower)
  &&(value.operator==='in_zone'?positive(value.upper)&&value.upper>=value.lower:value.upper==null);
const fail = () => {throw new Error('CLOUD_REPORT_INVALID');};
export function cloudPlanControls(language) {
  const rows={
    'zh-CN':['卡片文字与便利贴操作','放大','缩小','便利贴'],
    'zh-TW':['卡片文字與便利貼操作','放大','縮小','便利貼'],
    en:['Card text and sticky note controls','Larger','Smaller','Sticky note'],
    ko:['카드 글자 및 메모 제어','확대','축소','메모'],
    ja:['カードの文字サイズと付箋の操作','拡大','縮小','付箋'],
  };
  const [label,increase,decrease,sticky]=rows[language]||rows['zh-CN'];
  return {label,increase,decrease,sticky};
}
export function normalizeCloudReports(value) {
  if(value==null) return [];
  if(!Array.isArray(value)||value.length>16||new Set(value.map(row=>row?.runId)).size>8) fail();
  value=value.flatMap(expandWyckoffReport);
  if(value.length>16)fail();
  const json=JSON.stringify(value);
  if(new TextEncoder().encode(json).length>2*1024*1024) fail();
  const rows=JSON.parse(json), seen=new Set(), seenPlans=new Set();
  return rows.map(row=>{
    const identity=row.executionPlan?.wyckoffScenario ? `${row.runId}:${row.executionPlan.planId}` : row.runId;
    if(row?.schemaVersion!==1||!uuid(row.runId)||seen.has(identity)||!hash(row.resultHash)
      ||!['zh-CN','en','zh-Hant','ko','ja'].includes(row.locale)||typeof row.marketId!=='string'||typeof row.interval!=='string'
      ||typeof row.strategyId!=='string'||typeof row.report!=='string'||row.report.length>500000
      ||!Array.isArray(row.planRecords)) fail();
    seen.add(identity);
    const profitProbability = normalizePlanProbability(row.profitProbability,row);
    if(row.executionPolicy==='right-legacy-v1') {
      const candidates=legacyReportCandidates(row.report);
      if(row.executionPlan?.schemaVersion!==1||!Array.isArray(row.executionPlan.scenarios)
        ||row.executionPlan.scenarios.length>8||candidates.length>8)fail();
      const selected=row.selectedCardIndex;
      if(selected!==undefined&&(!Number.isSafeInteger(selected)||selected<0||selected>=candidates.length))fail();
      if(row.planRecords.length!==(selected===undefined?candidates.length:1))fail();
      for(const [index,remote] of row.planRecords.entries()) {
        const expectedIndex=selected??index,candidate=candidates[expectedIndex];
        if(!uuid(remote.id)||seenPlans.has(remote.id)||remote.runId!==row.runId||!hash(remote.confirmationHash)
          ||remote.executionPolicy!=='right-legacy-v1'||remote.monitoringPolicy!=='windows_v1'
          ||remote.cardIndex!==expectedIndex||!Number.isSafeInteger(remote.version)||remote.version<1
          ||remote.card?.title!==candidate.title||remote.card?.content!==candidate.content)fail();
        seenPlans.add(remote.id);
      }
      return {schemaVersion:1,executionPolicy:'right-legacy-v1',...(selected===undefined?{}:{selectedCardIndex:selected}),
        runId:row.runId,resultHash:row.resultHash,locale:row.locale,marketId:row.marketId,interval:row.interval,
        strategyId:row.strategyId,report:row.report,executionPlan:row.executionPlan,planRecords:row.planRecords,
        ...(profitProbability?{profitProbability}:{}),
        origin:row.origin||null,drawingPatch:row.drawingPatch||null,indicatorDrawingPatch:row.indicatorDrawingPatch||null};
    }
    if(row.executionPlan?.schemaVersion!==2||!Array.isArray(row.executionPlan.scenarios)||row.executionPlan.scenarios.length>1
      ||row.planRecords.length!==row.executionPlan.scenarios.length)fail();
    const plan=row.executionPlan;
    if(!validWyckoffRetest(plan,row.strategyId))fail();
    if(!validAnalysisRequestPlan(plan)||!validPlanPresentation(plan)
      ||(plan.planPresentation&&!validPresentationDrawing(plan,row.drawingPatch)))fail();
    for(const remote of row.planRecords) {
      if(!validPresentationReminder(plan,remote))fail();
      if(plan.requestRequirements && (remote.scenario?.side!==plan.scenarios[0]?.side
        ||!validAnalysisRequestPlan(remote.executionPlan)))fail();
    }
    if(plan.conditionalWatch!==undefined && (plan.scenarios.length || !validConditionalWatch(plan.conditionalWatch,plan,row.strategyId)))fail();
    if(plan.leftObservation!==undefined&&(!validLeftObservation(plan.leftObservation)||row.strategyId!=='price-action'
      ||!['left',null].includes(plan.selectedMode)))fail();
    if(plan.scenarios.length) {
      const condition=plan.entryCondition,scenario=plan.scenarios[0];
      if(plan.outcome?.action!=='plan'||!uuid(condition?.conditionId)||condition.revision!==1||!hash(plan.conditionHash)
        ||!['left','right','auto'].includes(plan.requestedMode)||!['left','right'].includes(plan.selectedMode)
        ||!['long','short'].includes(condition.direction)||!['touch','bar_close','breakout_retest'].includes(condition.confirmation)
        ||!predicate(condition.trigger)||!Number.isSafeInteger(condition.expiresAt)||condition.expiresAt<=0||condition.expiresAt>8640000000000000
        ||!positive(scenario.stop)||!Array.isArray(scenario.targets)||!scenario.targets.length||!scenario.targets.every(positive)
        ||(condition.confirmation==='breakout_retest'&&(!predicate(condition.retest)||condition.retest.operator!=='in_zone'))
        ||(condition.invalidation&&!predicate(condition.invalidation)))fail();
    }
    for(const remote of row.planRecords) {
      if(!uuid(remote.id)||remote.id!==row.executionPlan.planId||remote.runId!==row.runId||!hash(remote.confirmationHash)
        ||remote.monitoringPolicy!=='entry_v2'||!Number.isSafeInteger(remote.version)||remote.version<1
        ||remote.scenario?.conditionHash!==row.executionPlan.conditionHash||!hash(remote.scenario?.conditionHash)) fail();
    }
    return {schemaVersion:1,runId:row.runId,resultHash:row.resultHash,locale:row.locale,marketId:row.marketId,interval:row.interval,
      strategyId:row.strategyId,report:row.report,executionPlan:row.executionPlan,planRecords:row.planRecords,
      ...(profitProbability?{profitProbability}:{}),
      origin:row.origin||null,drawingPatch:row.drawingPatch||null,indicatorDrawingPatch:row.indicatorDrawingPatch||null};
  });
}
export function cloudReportFromResponse(response) {
  if(!['entry-v2','right-legacy-v1'].includes(response?.cloud?.executionPolicy)) return [];
  return normalizeCloudReports([{schemaVersion:1,executionPolicy:response.cloud.executionPolicy,runId:response.cloud.runId,resultHash:response.cloud.resultHash,locale:response.cloud.locale,
    marketId:response.snapshot?.marketId,interval:response.snapshot?.interval,strategyId:response.strategy?.id,
    report:response.analysisPlan?.report,executionPlan:response.executionPlan,planRecords:response.cloud.planRecords,
    profitProbability:response.analysisPlan?.profitProbability,
    origin:response.cloud.origin,drawingPatch:response.analysisPlan?.drawingPatch,indicatorDrawingPatch:response.analysisPlan?.indicatorDrawingPatch}]);
}

export function legacyReportCandidates(report) {
  return executionPlanCandidatesFromText(report)
    .filter(candidate=>executionPlanHasConcreteTradingPlan(candidate))
    .map(candidate=>executionPlanCandidateWithSourceText(candidate,report));
}

// A selected card keeps the entire original report/plan and binds only its own
// account-owned lifecycle. Two alternative cards must never share a plan ID.
export function selectCloudPlan(report,remote) {
  return normalizeCloudReports([{...report,planRecords:[remote],
    ...(report.executionPolicy==='right-legacy-v1'?{selectedCardIndex:remote.cardIndex}:{})}])[0];
}
export function bindLegacyCloudCandidate(reports,candidate,usedPlanIds) {
  const matches=reports.filter(report=>report.executionPolicy==='right-legacy-v1').flatMap(report=>
    report.planRecords.filter(remote=>!usedPlanIds?.has(remote.id)&&remote.card?.title===candidate.title&&remote.card?.content===candidate.content)
      .map(remote=>selectCloudPlan(report,remote)));
  // Identical reports can appear in separate chart panes. Bind each occurrence
  // in report order to its own run, never collapse two cards to the same plan.
  if(!matches.length||(!usedPlanIds&&matches.length!==1))fail();
  usedPlanIds?.add(matches[0].planRecords[0].id);
  return {...candidate,cloudReport:matches[0]};
}

const words={
  title:['条件交易计划','Conditional trading plan','條件交易計畫'],
  mode:['入场方式','Entry mode','入場方式'],left:['左侧','Left-side','左側'],right:['右侧','Right-side','右側'],auto:['自动判断','Automatic','自動判斷'],
  long:['做多','Long','做多'],short:['做空','Short','做空'],
  timeframe:['执行周期','Execution timeframe','執行週期'],entry:['入场条件','Entry condition','入場條件'],stop:['止损 / 结构失效','Stop / structural invalidation','止損 / 結構失效'],
  targets:['止盈参考','Profit-target references','止盈參考'],expiry:['有效至（UTC）','Valid until (UTC)','有效至（UTC）'],
  touch:['等待实时成交价格满足条件','Wait for a live trade price to satisfy the condition','等待即時成交價格滿足條件'],
  bar_close:['等待已收盘 K 线满足条件','Wait for a closed candle to satisfy the condition','等待已收盤 K 線滿足條件'],
  breakout_retest:['先突破，再在后续行情中回踩区域','Break out first, then retest the zone in a later observation','先突破，再在後續行情中回踩區域'],
  confirmed:['突破已由报告快照中的收盘证据确认','Breakout confirmed by closed-candle evidence in the report snapshot','突破已由報告快照中的收盤證據確認'],
  live:['提醒前须重新核验成交与盘口压力方向','Fresh trades and depth must confirm pressure before a reminder','提醒前須重新核驗成交與盤口壓力方向'],
  at_or_above:['价格达到或高于','Price at or above','價格達到或高於'],at_or_below:['价格达到或低于','Price at or below','價格達到或低於'],
  cross_up:['价格从下方向上穿越','Price crosses upward through','價格從下方向上穿越'],cross_down:['价格从上方向下穿越','Price crosses downward through','價格從上方向下穿越'],in_zone:['价格进入闭区间','Price enters the inclusive zone','價格進入閉區間'],
  invalidation:['条件失效','Condition invalidation','條件失效'],notice:['条件满足仅提醒，不表示成交，不会自动下单。','A satisfied condition only sends a reminder; it is not a fill and does not place an order.','條件滿足僅提醒，不表示成交，不會自動下單。'],
};
// The snapshot/context is the analysis timeframe. The entry condition can use
// a lower confirmation timeframe and must never replace that report identity.
function cardInterval(value) {
  const text=String(value??'').trim();
  if (/^[1-9]\d*[mhdwM]$/.test(text)) return text;
  if (/^[1-9]\d*[HDW]$/.test(text)) return text.toLowerCase();
  if (/^[1-9]\d{0,4}$/.test(text)) {
    const minutes=Number(text);
    return minutes%1440===0?`${minutes/1440}d`:minutes%60===0?`${minutes/60}h`:`${minutes}m`;
  }
  return '';
}

export function cloudPlanCard(report, { hideExpiry = false, separateAction = false, language: displayLanguage } = {}) {
  if(report.executionPolicy==='right-legacy-v1') {
    const remote=report.planRecords.find(plan=>plan.cardIndex===(report.selectedCardIndex??0));
    if(!remote)return null;
    const {title,content}=remote.card,lines=executionPlanDisplayLines(content);
    const language=displayLanguage||(report.locale==='zh-Hant'?'zh-TW':report.locale);
    const expiresAt=hideExpiry?undefined:(remote.expiresAt??report.executionPlan.expiresAt);
    return {title,content,html:executionPlanCardHeading(title,lines,language)+executionPlanCardBody(lines,language,{expiresAt,hideAction:separateAction}),
      ...(separateAction?{actionHtml:executionPlanCardAction(lines,language)}:{})};
  }
  const t=key=>words[key]?localizedChoice(words[key],displayLanguage||report.locale):key;
  const plan=report.executionPlan,condition=plan.entryCondition,scenario=plan.scenarios[0];
  const language=displayLanguage||(report.locale==='zh-Hant'?'zh-TW':report.locale);
  if(plan.outcome?.action!=='plan'||!condition||!scenario)
    return (plan.planPresentation?.version==='always-card-v1'?planPresentationCard(report,language):null)
      || conditionalWatchCard(report,language);
  const route=leftRouteView(plan,language);
  const predicate=p=>p ? `${t(p.operator)} ${p.operator==='in_zone'?`[${p.lower}, ${p.upper}]`:p.lower}` : '';
  const details=[t(condition.confirmation),predicate(condition.trigger)];
  if(condition.confirmation==='breakout_retest') details.push(condition.breakoutConfirmation==='bar_close'?t('bar_close'):t('touch'),predicate(condition.retest));
  if(condition.confirmedBreakout) details.push(t('confirmed'));
  if(condition.liveEvidenceGate) details.push(t('live'));
  const fields=[
    [t('mode'),`${t(plan.requestedMode)} / ${t(plan.selectedMode)}`],
    [t('timeframe'),`${condition.interval} · ${t(condition.direction)}`],
    [t('entry'),details.join('； ')],[t('stop'),String(scenario.stop)],
    [t('targets'),scenario.targets.join(' / ')],
    ...(condition.invalidation?[[t('invalidation'),predicate(condition.invalidation)]]:[]),
    [t('expiry'),new Date(condition.expiresAt).toISOString()],
  ];
  const analysisInterval=cardInterval(plan.context?.interval)||cardInterval(report.interval)||cardInterval(condition.interval);
  const title=`${report.marketId} · ${analysisInterval} · ${t('title')}`;
  const heading=executionPlanCardHeading(title,[{label:'Direction',text:condition.direction},{label:'Strategy',text:report.strategyId}],language);
  // Mobile's engine-first ratio rule: never derive ratios or account amounts
  // from displayed prices, or borrow the other scenario's account sizing.
  const entryBasisMismatch=cloudPlanEntryBasisMismatch(plan);
  const riskReward=scenario.targets.map((_,index)=>{
    if(entryBasisMismatch)return null;
    const engine=plan.preferredSide===condition.direction&&Array.isArray(plan.riskReward)
      ? plan.riskReward.find(item=>item?.targetIndex===index&&Number.isFinite(item.ratio))?.ratio:undefined;
    return engine??(Array.isArray(scenario.riskReward)&&Number.isFinite(scenario.riskReward[index])?scenario.riskReward[index]:null);
  });
  const account=cloudPlanAccountView(plan,report.marketId,report.planRecords?.[0]);
  const entry=condition.confirmation==='breakout_retest'?condition.retest:condition.trigger;
  const action=plan.executionBlocked===true||(scenario.positionSizing||plan.positionSizing)?.executionBlocked===true||scenario.eligible===false?'blocked':route?.action||'wait';
  const body=executionPlanStructuredCardBody({entry,entryMode:plan.selectedMode,stop:scenario.stop,targets:scenario.targets,direction:condition.direction,
    expiresAt:hideExpiry?undefined:condition.expiresAt,riskReward,account,entryBasisMismatch,
    action,hideAction:separateAction},language);
  return {title,content:[title,...fields.map(([label,value])=>`${label}: ${value}`),t('notice'),...(route?[route.content]:[])].join('\n'),
    html:heading+body,...(separateAction?{actionHtml:executionPlanCardAction(action,language)}:{})};
}
