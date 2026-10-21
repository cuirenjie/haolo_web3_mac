import {executionPlanCardHeading} from './execution-plan-card-view.mjs';

const words = {
  left: ['左侧条件计划 · 待触发', 'Left-side conditional plan · Pending', '左側條件計畫 · 待觸發'],
  right: ['右侧条件计划 · 待确认', 'Right-side conditional plan · Pending confirmation', '右側條件計畫 · 待確認'],
  long: ['做多条件', 'Long conditions', '做多條件'], short: ['做空条件', 'Short conditions', '做空條件'],
  at_or_below: ['价格回到或低于', 'Price returns to or below', '價格回到或低於'],
  at_or_above: ['价格回到或高于', 'Price returns to or above', '價格回到或高於'],
  cross_up: ['K 线收盘向上突破', 'A candle closes above', 'K 線收盤向上突破'],
  cross_down: ['K 线收盘向下跌破', 'A candle closes below', 'K 線收盤向下跌破'],
  reclaim_follow: ['触及区域后收回，后续收盘同向跟进；重新分析确认入场、止损和止盈。', 'After the zone is touched, require a reclaim and subsequent closed-candle follow-through; reanalyse to confirm entry, stop and targets.', '觸及區域後收回，後續收盤同向跟進；重新分析確認入場、止損和止盈。'],
  closed_breakout_retest: ['收盘确认突破后回踩该价位并守住，再重新分析确认入场、止损和止盈。', 'After a confirmed closing breakout, require a retest that holds this level, then reanalyse to confirm entry, stop and targets.', '收盤確認突破後回踩該價位並守住，再重新分析確認入場、止損和止盈。'],
  closed_range: ['最近 20 根已收盘 K 线的区间参考；尚非策略确认信号。', 'Reference from the last 20 closed candles; the strategy signal is unconfirmed.', '最近 20 根已收盤 K 線的區間參考；尚非策略確認訊號。'],
  native_structure: ['本策略结构参考价；尚待确认。', 'Native strategy reference level; confirmation is pending.', '本策略結構參考價；尚待確認。'],
  reason: ['当前未满足', 'Currently unmet', '目前未滿足'],
  recheck: ['触发后复核所选策略、账户风险、费用和净盈亏比；通过后才可启用入场提醒。', 'After the trigger, recheck the selected strategy, account risk, costs and net reward:risk before enabling an entry alert.', '觸發後複核所選策略、帳戶風險、費用和淨盈虧比；通過後才可啟用入場提醒。'],
  missing: ['先恢复足够、连续且有效的行情，并完成策略评估，再确定触发价位。', 'Restore sufficient, continuous, fresh market data and complete the strategy evaluation before setting trigger prices.', '先恢復足夠、連續且有效的行情，並完成策略評估，再確定觸發價位。'],
  invalidate: ['若收回／回踩失败、结构失效或计划到期，取消该方向并重新分析。', 'Cancel that direction and reanalyse if the reclaim/retest fails, the structure fails or the plan expires.', '若收回／回踩失敗、結構失效或計畫到期，取消該方向並重新分析。'],
  notice: ['当前为条件预案，不是立即入场信号。', 'This is a prospective plan, not an immediate entry signal.', '目前為條件預案，不是立即入場訊號。'],
  expiry: ['预案有效至', 'Plan valid until', '預案有效至'],
  expired: ['预案已过期，请重新分析。', 'This plan has expired. Reanalyse.', '預案已到期，請重新分析。'],
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function validConditionalWatch(watch, plan, strategyId) {
  return watch?.version === 'conditional-watch-v1' && watch.actionable === false && watch.canCreateAlert === false
    && watch.mode === (plan.requestedMode === 'left' ? 'left' : 'right') && watch.strategyId === strategyId
    && ['completed','data_unavailable','model_failed','not_evaluated'].includes(watch.evaluationStatus)
    && watch.evaluationStatus === plan.outcome?.evaluationStatus
    && watch.reason === plan.outcome?.reason && /^[A-Z0-9_]{1,120}$/.test(watch.reason)
    && Number.isSafeInteger(watch.createdAt) && Number.isSafeInteger(watch.expiresAt)
    && watch.createdAt === plan.createdAt && watch.expiresAt > watch.createdAt && watch.expiresAt <= 8640000000000000
    && Array.isArray(watch.reasonText) && watch.reasonText.length === 3 && watch.reasonText.every(s => typeof s === 'string' && s.length <= 2000)
    && Array.isArray(watch.conditions) && watch.conditions.length <= 2
    && watch.conditions.every(c => c && typeof c === 'object')
    && (watch.evaluationStatus === 'completed' || watch.conditions.length === 0)
    && new Set(watch.conditions.map(c => c.side)).size === watch.conditions.length
    && watch.conditions.every(c => ['long','short'].includes(c.side) && positive(c.price)
      && ['closed_range','native_structure'].includes(c.source)
      && c.confirmation === (watch.mode === 'left' ? 'reclaim_follow' : 'closed_breakout_retest')
      && c.operator === (watch.mode === 'left' ? (c.side === 'long' ? 'at_or_below' : 'at_or_above') : (c.side === 'long' ? 'cross_up' : 'cross_down')));
}

export function conditionalWatchCard(report, language, now = Date.now()) {
  const watch = report.executionPlan?.conditionalWatch;
  if (!watch || !validConditionalWatch(watch, report.executionPlan, report.strategyId)) return null;
  const index = language === 'en' ? 1 : ['zh-TW','zh-Hant'].includes(language) ? 2 : 0;
  const t = key => words[key][index];
  const title = `${report.marketId} · ${report.interval} · ${t(watch.mode)}`;
  const lines = [t(watch.mode), `${t('reason')}: ${watch.reasonText[index]}`];
  if (now >= watch.expiresAt) lines.push(t('expired'));
  for (const condition of watch.conditions) lines.push(
    `${t(condition.side)}: ${t(condition.operator)} ${condition.price}`,
    t(condition.confirmation), t(condition.source));
  if (!watch.conditions.length) lines.push(t('missing'));
  lines.push(t('recheck'), t('invalidate'), `${t('expiry')}: ${new Date(watch.expiresAt).toLocaleString(language === 'zh-Hant' ? 'zh-TW' : language)}`, t('notice'));
  const heading = executionPlanCardHeading(title, [{label:'Strategy',text:report.strategyId}], language);
  return {title, content:[title,...lines].join('\n'), readOnly:true,
    html:heading+`<div class="execution-plan-details" data-conditional-watch="${watch.mode}">${lines.map(line => `<p class="execution-plan-card-line"><span class="execution-plan-card-value">${escape(line)}</span></p>`).join('')}</div>`};
}
