const words={
  title:['云端计划提醒','Cloud plan reminders','雲端計畫提醒'],empty:['暂无云端计划提醒。','No cloud plan reminders.','暫無雲端計畫提醒。'],
  unavailable:['云端提醒暂时无法同步；请稍后刷新。','Cloud reminders could not be synchronized. Refresh later.','雲端提醒暫時無法同步；請稍後重新整理。'],
  notice:['条件满足只产生提醒，不表示成交，不会自动下单。','Conditions only produce reminders; they do not indicate fills or place orders.','條件滿足只產生提醒，不表示成交，不會自動下單。'],
  recent:['最近触发记录','Recent triggers','最近觸發紀錄'],entry:['入场条件已满足','Entry condition satisfied','入場條件已滿足'],
  stop:['止损条件已满足','Stop condition satisfied','止損條件已滿足'],target:['止盈条件已满足','Target condition satisfied','止盈條件已滿足'],
  arming:['准备监控','Preparing monitoring','準備監控'],monitoring:['监控中','Monitoring','監控中'],completed:['条件监控已停止','Condition monitoring stopped','條件監控已停止'],
  paused:['已暂停','Paused','已暫停'],ended:['已结束','Ended','已結束'],triggered:['已触发','Triggered','已觸發'],expired:['已过期','Expired','已過期'],invalidated:['已失效','Invalidated','已失效'],unknown:['行情连续性待核对','Market continuity needs verification','行情連續性待核對'],
  touch:['实时成交价','Live trade price','即時成交價'],bar_close:['已收盘 K 线','Closed candle','已收盤 K 線'],breakout_retest:['先突破，再由后续行情回踩','Breakout followed by a later retest','先突破，再由後續行情回踩'],
  confirmed:['快照内收盘突破已确认','Closed-candle breakout confirmed in the snapshot','快照內收盤突破已確認'],
  live:['提醒前重新核验成交与盘口压力','Recheck fresh trades and depth pressure before a reminder','提醒前重新核驗成交與盤口壓力'],
  invalidation:['失效条件','Invalidation condition','失效條件'],
  at_or_above:['达到或高于','at or above','達到或高於'],at_or_below:['达到或低于','at or below','達到或低於'],cross_up:['从下方向上穿越','crosses upward through','從下方向上穿越'],cross_down:['从上方向下穿越','crosses downward through','從上方向下穿越'],in_zone:['进入闭区间','enters the inclusive zone','進入閉區間'],
};
const t=(key,language)=>words[key]?.[language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0]||key;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>{const date=new Date(Number(value));return Number(value)>0&&Number.isFinite(date.getTime())?date.toISOString():'';};
const eventLabel=(event,language)=>t(event.data.condition==='entry'?'entry':event.data.condition==='stop'?'stop':'target',language);
export function cloudAlertNotification({alert,event},language='zh-CN') {
  return {title:`${t('title',language)} · ${alert.rule.marketKey}`,
    body:`${eventLabel(event,language)} · ${alert.rule.interval} · ${event.data.price}\n${time(event.data.occurredAt)}\n${t('notice',language)}`};
}
export function renderCloudAlertPanel(feed={},language='zh-CN') {
  const predicate=p=>p?`${t(p.operator,language)} ${p.operator==='in_zone'?`[${p.lower}, ${p.upper}]`:p.lower}`:'';
  const items=(feed.items||[]).map(alert=>{
    const condition=alert.rule.entryCondition;
    const text=[t(condition.confirmation,language),condition.confirmation==='breakout_retest'?t(condition.breakoutConfirmation==='bar_close'?'bar_close':'touch',language):'',
      predicate(condition.trigger),condition.retest?predicate(condition.retest):'',condition.confirmedBreakout?t('confirmed',language):'',
      condition.liveEvidenceGate?t('live',language):'',condition.invalidation?`${t('invalidation',language)}: ${predicate(condition.invalidation)}`:''].filter(Boolean).join('； ');
    return `<article style="padding:12px 0;border-top:1px solid color-mix(in srgb,currentColor 20%,transparent)"><strong>${escape(alert.rule.marketKey)} · ${escape(alert.rule.interval)}</strong>
      <p>${escape(t(alert.entryState?.status||alert.state,language))} · ${escape(time(condition.expiresAt))}</p><p>${escape(text)}</p>
      ${alert.error?`<p role="status">${escape(alert.error)}</p>`:''}</article>`;
  }).join('');
  const events=(feed.recentEvents||[]).map(event=>`<li>${escape(event.alert?.rule?.marketKey||event.data.marketKey)} · ${escape(eventLabel(event,language))} · ${escape(event.data.price)} · ${escape(time(event.data.occurredAt))}</li>`).join('');
  return `<section class="cloud-alert-panel" style="margin:16px;padding:18px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:12px;overflow-wrap:anywhere"><h2>${escape(t('title',language))}</h2>
    <p>${escape(t('notice',language))}</p>${feed.error?`<p role="status">${escape(t('unavailable',language))}</p>`:''}
    ${items||`<p>${escape(t('empty',language))}</p>`}${events?`<details><summary>${escape(t('recent',language))}</summary><ul>${events}</ul></details>`:''}</section>`;
}
