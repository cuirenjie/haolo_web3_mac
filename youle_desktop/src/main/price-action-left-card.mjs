// Public presentation only. Prices and permissions come from the frozen server receipt.
const version='price-action-left-dual-v1';
const words={
  conditional:['左侧条件交易计划 · 待条件触发','Left-side conditional trading plan · Awaiting conditions','左側條件交易計畫 · 待條件觸發'],
  conditionalSteps:['激活后等待触区收回、后续收盘跟进，再次进入入场区域；触发前重新核验费用与风险。','After activation, wait for a zone reclaim, later closed follow-through and an entry-zone retest; costs and risk are rechecked before a reminder.','啟用後等待觸區收回、後續收盤跟進，再次進入入場區域；觸發前重新核驗費用與風險。'],
  conditionalSource:['依据真实结构区域或已收盘区间生成；所选策略原生信号尚未确认。','Based on structural zones or a closed-candle range; the selected strategy’s native signal is not confirmed.','依據真實結構區域或已收盤區間產生；所選策略原生訊號尚未確認。'],
  protectWatch:['4小时左侧条件预案 · 待到价／待确认','4h left-side watch plan · Awaiting price/confirmation','4小時左側條件預案 · 待到價／待確認'],
  retained:['保留已通过结构与风控校验的4小时条件单；到价后重验收回和收盘跟进。','A validated 4h condition is retained; reclaim and closed follow-through are rechecked at entry.','保留已通過結構與風控校驗的4小時條件單；到價後重驗收回和收盤跟進。'],
  watch:['左侧观察预案 · 待触发／待确认','Left-side watch · Awaiting price/confirmation','左側觀察預案 · 待觸發／待確認'],
  protect:['4小时收回跟进方案','4h reclaim and follow-through','4小時收回跟進方案'],
  touch:['1小时触区方案','1h zone-touch setup','1小時觸區方案'],
  long:['低位支撑区观察做多','Watch support for a long','低位支撐區觀察做多'],
  short:['高位阻力区观察做空','Watch resistance for a short','高位阻力區觀察做空'],
  await_zone:['等待进入区域，再核验入场条件','Wait for the zone, then recheck entry conditions','等待進入區域，再核驗入場條件'],
  await_reaction:['已接近区域，等待收盘确认','Near the zone; awaiting closed-candle confirmation','已接近區域，等待收盤確認'],
  await_primary_zone:['仅作结构参考，尚无合格入场区域','Structural reference only; no qualified entry zone yet','僅作結構參考，尚無合格入場區域'],
  protectConfirm:['需收回区域并出现15分钟收盘跟进，反应极值未被破坏','Requires a reclaim and 15m closed follow-through, without breaking the reaction extreme','需收回區域並出現15分鐘收盤跟進，反應極值未被破壞'],
  touchConfirm:['顺势／震荡需区域与目标空间合格；逆势还需拒绝或收回，强逆势需跟进','Trend/range setups require a valid zone and target space; countertrend needs rejection/reclaim and follow-through against a strong trend','順勢／震盪需區域與目標空間合格；逆勢還需拒絕或收回，強逆勢需跟進'],
  noZone:['该方向暂无有效区域','No valid zone for this direction','該方向暫無有效區域'],
  blocked:['观察预案不能激活入场提醒；触区后须重新分析，不能直接下单。','Watch plans cannot activate entry alerts. Reanalyse at the zone before any entry.','觀察預案不能啟用入場提醒；觸區後須重新分析，不能直接下單。'],
  invalidation:['区域失效或确认失败即取消；入场前重验费用、净盈亏比和风险。','Cancel if the zone or confirmation fails; recheck costs, net reward:risk and risk before entry.','區域失效或確認失敗即取消；入場前重驗費用、淨盈虧比和風險。'],
  expiry:['观察有效至','Watch valid until','觀察有效至'],
  expired:['已过期，请重新分析','Expired; reanalyse','已到期，請重新分析'],
  route:['方案来源','Setup source','方案來源'],
  ready:['报价时入场条件已满足，执行前重新核价','Entry conditions met at the quoted price; recheck before execution','報價時入場條件已滿足，執行前重新核價'],
  await_price:['待到价触发／重新核价','Awaiting entry price / a fresh quote','待到價觸發／重新核價'],
  quote:['行情参考价／时间','Reference quote / time','行情參考價／時間'],
  costs:['双边成本／资金费预留','Round-trip cost / funding reserve','雙邊成本／資金費預留'],
  holding:['最长持有小时数（到时提醒退出）','Maximum holding hours (exit reminder at the limit)','最長持有小時數（屆時提醒退出）'],
  protection:['15分钟收盘净浮盈达0.25R后，保护参考净盈利0.05R；两根收盘接受区域失效侧时提醒退出。按计划入场价估算，不保证实际保本或成交。','A 15m close at +0.25R arms a +0.05R protection reference. Two closes accepting the invalid side prompt an exit reminder. Based on the planned entry; actual breakeven or fills are not guaranteed.','15分鐘收盤淨浮盈達0.25R後，保護參考淨盈利0.05R；兩根收盤接受區域失效側時提醒退出。按計畫入場價估算，不保證實際保本或成交。'],
};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const stamp=v=>Number.isSafeInteger(v)&&v>0&&v<=8640000000000000;
const translator=language=>key=>words[key]?.[language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0]||key;
const linesHtml=lines=>`<div class="execution-plan-details">${lines.map(line=>`<p class="execution-plan-card-line"><span class="execution-plan-card-value">${escape(line)}</span></p>`).join('')}</div>`;

export function validLeftObservation(value){
  return value?.version===version&&value.actionable===false&&value.canCreateAlert===false&&value.executionBlocked===true
    &&[undefined,'protect-only-v1'].includes(value.routeProfile)
    &&(value.routeProfile!=='protect-only-v1'||(Array.isArray(value.plans)&&value.plans.every(p=>p?.routeId==='protect')))
    &&stamp(value.asOf)&&stamp(value.expiresAt)&&value.expiresAt>value.asOf&&value.expiresAt-value.asOf<=900000
    &&Array.isArray(value.plans)&&value.plans.length<=4&&value.plans.every(p=>
      ['protect','touch'].includes(p.routeId)&&['long','short'].includes(p.direction)
      &&['await_zone','await_reaction','await_primary_zone'].includes(p.stage)
      &&positive(p.zone?.lower)&&positive(p.zone?.upper)&&p.zone.lower<=p.zone.upper
      &&p.actionable===false&&p.canCreateAlert===false&&p.executionBlocked===true);
}

export function leftWatchView(report,language,now=Date.now()){
  const value=report.executionPlan?.leftObservation;
  if(report.strategyId!=='price-action'||!['left',null].includes(report.executionPlan.selectedMode)||!validLeftObservation(value))return null;
  const t=translator(language),title=t(value.routeProfile==='protect-only-v1'?'protectWatch':'watch'),lines=[];
  for(const direction of ['long','short']){
    const plans=value.plans.filter(p=>p.direction===direction);
    if(!plans.length)lines.push(`${t(direction)} · ${t('noZone')}`);
    for(const p of plans)lines.push(`${t(direction)} · ${p.zone.lower}–${p.zone.upper} · ${t(p.routeId)}`,
      t(p.stage),t(p.routeId==='protect'?'protectConfirm':'touchConfirm'));
  }
  lines.push(t('invalidation'),t('blocked'),`${t('expiry')}: ${new Date(value.expiresAt).toISOString()}`);
  if(now>=value.expiresAt)lines.push(t('expired'));
  return {title,content:[title,...lines].join('\n'),html:linesHtml([title,...lines]),readOnly:true};
}

export function leftRouteView(plan,language,now=Date.now()){
  const p=plan.positionSizing?.leftPolicy;
  if(plan.selectedMode==='left'&&p?.version==='left-conditional-fallback-v1'){
    const t=translator(language),expired=now>=plan.entryCondition.expiresAt;
    const lines=[t('conditional'),t(expired?'expired':'conditionalSteps'),t('conditionalSource')];
    if(positive(p.referencePrice)&&stamp(p.referenceAt))lines.push(`${t('quote')}: ${p.referencePrice} · ${new Date(p.referenceAt).toISOString()}`);
    return {action:expired?'blocked':'wait',content:lines.join('\n'),html:linesHtml(lines)};
  }
  if(plan.selectedMode!=='left'||p?.version!==version||!['protect','touch'].includes(p.routeId))return null;
  const t=translator(language),expired=now>=plan.entryCondition.expiresAt;
  const ready=!expired&&p.entryState==='ready'&&stamp(p.quoteAt)&&now>=p.quoteAt&&now-p.quoteAt<=30000;
  const lines=[`${t('route')}: ${t(p.routeId)}`,t(expired?'expired':ready?'ready':'await_price')];
  if(p.selectionBasis==='qualified_condition')lines.push(t('retained'));
  if(positive(p.referencePrice)&&stamp(p.referenceAt))lines.push(`${t('quote')}: ${p.referencePrice} · ${new Date(p.referenceAt).toISOString()}`);
  if(positive(p.roundTripCostRate)&&positive(p.fundingReserveRate))lines.push(`${t('costs')}: ${(p.roundTripCostRate*100).toFixed(2)}% / ${(p.fundingReserveRate*100).toFixed(2)}%`);
  if(positive(p.maximumHoldingMs))lines.push(`${t('holding')}: ${p.maximumHoldingMs/3600000}`);
  if(p.routeId==='protect')lines.push(t('protection'));
  return {action:expired?'blocked':ready?plan.entryCondition.direction:'wait',content:lines.join('\n'),html:linesHtml(lines)};
}
