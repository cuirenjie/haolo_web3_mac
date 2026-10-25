// Optional public model commentary. Invalid/missing commentary never hides a plan.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const samePrices = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n,i) => finite(n) && n === b[i]);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function normalizePlanProbability(value, report) {
  if (value?.schemaVersion !== 1 || value.kind !== 'model_estimate' || value.basis !== 'first_target_before_stop_conditional'
    || !Array.isArray(value.assessments) || value.assessments.length > 8) return null;
  const history = value.history;
  if (!history || !Number.isSafeInteger(history.candleCount) || history.candleCount < 60 || history.candleCount > 120
    || ![history.from,history.to,history.asOf].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000)
    || history.from >= history.to || history.to > history.asOf || typeof history.interval !== 'string'
    || !/^[1-9]\d*[mhdw]$/.test(history.interval)) return null;
  const seen = new Set();
  const assessments = value.assessments.filter(item => {
    if (!item || seen.has(item.planId)) return false;
    const remote = report.planRecords?.find(plan => plan.id === item.planId);
    const scenario = remote?.scenario;
    const stop = item.stopLossProbabilityPercent, profit = item.profitProbabilityPercent;
    if (!scenario || !['long','short'].includes(item.side) || item.side !== scenario.side
      || !finite(item.entry) || item.entry <= 0 || item.entry !== scenario.entry
      || !finite(item.stop) || item.stop <= 0 || item.stop !== scenario.stop || !samePrices(item.targets,scenario.targets)
      || (item.conditionHash ?? null) !== (scenario.conditionHash ?? null)
      || !finite(stop) || stop < 0 || stop > 100 || !finite(profit) || profit <= 50 || profit > 100
      || Math.abs(stop + profit - 100) > 1e-9 || Math.round(profit * 100) <= 5000
      || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 800
      || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 16 || !item.evidenceIds.includes('history-window')
      || !item.evidenceIds.every(id => typeof id === 'string' && id.length <= 240)) return false;
    seen.add(item.planId);
    return true;
  }).map(item => ({planId:item.planId,side:item.side,entry:item.entry,stop:item.stop,targets:[...item.targets],
    conditionHash:item.conditionHash??null,stopLossProbabilityPercent:item.stopLossProbabilityPercent,
    profitProbabilityPercent:item.profitProbabilityPercent,evidenceIds:[...item.evidenceIds],summary:item.summary.trim()}));
  return assessments.length ? {schemaVersion:1,kind:'model_estimate',basis:value.basis,
    history:{candleCount:history.candleCount,from:history.from,to:history.to,asOf:history.asOf,interval:history.interval},assessments} : null;
}

const copy = {
  'zh-CN': ['模型概率评估','盈利概率（模型估算）','止损概率','依据 {count} 根已收盘 K 线 · {interval}',
    '口径：入场后，在有效期内第1止盈或止损至少触达一个的条件下，估算第1止盈先于止损的概率。未触发、未退出及分批退出的最终净盈亏不在此口径内。',
    '未经历史回测校准，不代表实际交易胜率。','数据截至'],
  'zh-TW': ['模型機率評估','獲利機率（模型估算）','止損機率','依據 {count} 根已收盤 K 線 · {interval}',
    '口徑：入場後，在有效期內第1止盈或止損至少觸達一個的條件下，估算第1止盈先於止損的機率。未觸發、未退出及分批退出的最終淨盈虧不在此口徑內。',
    '未經歷史回測校準，不代表實際交易勝率。','資料截至'],
  en: ['Model probability assessment','Profit probability (model estimate)','Stop-loss probability','Based on {count} closed candles · {interval}',
    'Conditional on entry triggering and either the first target or stop being reached before expiry, this estimates the first target being reached first. Untriggered or unresolved plans and final net P&L from staged exits are excluded.',
    'Not calibrated by historical backtesting; this is not a measured trading win rate.','Data through'],
  ko: ['모델 확률 평가','수익 확률 (모델 추정)','손절 확률','마감된 캔들 {count}개 기준 · {interval}',
    '진입 후 유효기간 안에 1차 목표 또는 손절 중 하나에 도달한다는 조건에서, 1차 목표에 먼저 도달할 확률을 추정합니다. 미진입, 미청산 및 분할 청산의 최종 순손익은 제외합니다.',
    '과거 백테스트로 보정되지 않은 추정치이며 실제 거래 승률이 아닙니다.','데이터 기준'],
};

export function renderPlanProbabilityReply(report, language = 'zh-CN') {
  if (!report) return '';
  const value = normalizePlanProbability(report.profitProbability,report);
  if (!value) return '';
  const remote = report.planRecords.find(plan => report.executionPolicy !== 'right-legacy-v1'
    || plan.cardIndex === (report.selectedCardIndex ?? 0));
  const item = value.assessments.find(row => row.planId === remote?.id);
  if (!item) return '';
  const t = copy[language === 'zh-Hant' ? 'zh-TW' : language] || copy.en;
  const percent = value => `${Number(value.toFixed(2))}%`;
  const history = t[3].replace('{count}',String(value.history.candleCount)).replace('{interval}',value.history.interval);
  const date = new Date(value.history.to).toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC');
  return `<section class="plan-probability-reply" aria-label="${escape(t[0])}" data-plan-probability-id="${escape(item.planId)}">
    <div class="plan-probability-heading">${escape(t[0])}</div>
    <p class="plan-probability-value">${escape(t[1])} <strong>${percent(item.profitProbabilityPercent)}</strong></p>
    <p class="plan-probability-formula">100% − ${escape(t[2])} ${percent(item.stopLossProbabilityPercent)} = ${percent(item.profitProbabilityPercent)}</p>
    <p class="plan-probability-summary">${escape(item.summary)}</p>
    <p class="plan-probability-history">${escape(history)}<br>${escape(t[6])} ${escape(date)}</p>
    <details class="plan-probability-basis"><summary>${escape(t[5])}</summary><p>${escape(t[4])}</p></details>
  </section>`;
}
