// Public presentation contract shared with the renderer and durable history.
// Contains no strategy decisions. The main process validates the server receipt;
// activation always re-reads the account-owned plan on the server.
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const predicate=value=>value&&['at_or_above','at_or_below','cross_up','cross_down','in_zone'].includes(value.operator)&&positive(value.lower)
  &&(value.operator==='in_zone'?positive(value.upper)&&value.upper>=value.lower:value.upper==null);
const fail = () => {throw new Error('CLOUD_REPORT_INVALID');};
export function normalizeCloudReports(value) {
  if(value==null) return [];
  if(!Array.isArray(value)||value.length>8) fail();
  const json=JSON.stringify(value);
  if(new TextEncoder().encode(json).length>2*1024*1024) fail();
  const rows=JSON.parse(json), seen=new Set();
  return rows.map(row=>{
    if(row?.schemaVersion!==1||!uuid(row.runId)||seen.has(row.runId)||!hash(row.resultHash)
      ||!['zh-CN','en','zh-Hant'].includes(row.locale)||typeof row.marketId!=='string'||typeof row.interval!=='string'
      ||typeof row.strategyId!=='string'||typeof row.report!=='string'||row.report.length>500000
      ||row.executionPlan?.schemaVersion!==2||!Array.isArray(row.executionPlan.scenarios)||row.executionPlan.scenarios.length>1
      ||!Array.isArray(row.planRecords)||row.planRecords.length!==row.executionPlan.scenarios.length) fail();
    seen.add(row.runId);
    const plan=row.executionPlan;
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
      origin:row.origin||null,drawingPatch:row.drawingPatch||null,indicatorDrawingPatch:row.indicatorDrawingPatch||null};
  });
}
export function cloudReportFromResponse(response) {
  if(response?.cloud?.executionPolicy!=='entry-v2') return [];
  return normalizeCloudReports([{schemaVersion:1,runId:response.cloud.runId,resultHash:response.cloud.resultHash,locale:response.cloud.locale,
    marketId:response.snapshot?.marketId,interval:response.snapshot?.interval,strategyId:response.strategy?.id,
    report:response.analysisPlan?.report,executionPlan:response.executionPlan,planRecords:response.cloud.planRecords,
    origin:response.cloud.origin,drawingPatch:response.analysisPlan?.drawingPatch,indicatorDrawingPatch:response.analysisPlan?.indicatorDrawingPatch}]);
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
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cloudPlanCard(report) {
  const index=report.locale==='en'?1:report.locale==='zh-Hant'?2:0,t=key=>words[key]?.[index]||key;
  const plan=report.executionPlan,condition=plan.entryCondition,scenario=plan.scenarios[0];
  if(plan.outcome?.action!=='plan'||!condition||!scenario) return null;
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
  const title=`${report.marketId} · ${condition.interval} · ${t('title')}`;
  return {title,content:[title,...fields.map(([label,value])=>`${label}: ${value}`),t('notice')].join('\n'),
    html:`<div class="execution-plan-heading"><h2>${escape(title)}</h2></div>${fields.map(([label,value])=>`<p class="execution-plan-card-line"><span class="execution-plan-card-label">${escape(label)}: </span><span class="execution-plan-card-value">${escape(value)}</span></p>`).join('')}<p>${escape(t('notice'))}</p>`};
}
