import { vietnameseText } from '../shared/vietnamese.mjs';
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

// The original read-only observation layout, restored from b1ae599's parent.
// Current receipts no longer carry conditionalWatch. Use their completed
// no-candidate outcome; never infer signals or prices from report prose.
const noSignalCopy = {
  'zh-CN': ['暂无交易信号', '当前尚未形成有效入场条件。', '等待新的确认信号后重新分析；具体原因见分析正文。'],
  'zh-TW': ['暫無交易訊號', '目前尚未形成有效入場條件。', '等待新的確認訊號後重新分析；具體原因見分析正文。'],
  en: ['No trading signal', 'No valid entry conditions have formed yet.', 'Reanalyse after a new confirmation signal. See the analysis for details.'],
  ko: ['현재 거래 신호 없음', '유효한 진입 조건이 아직 형성되지 않았습니다.', '새로운 확인 신호가 나타나면 다시 분석하세요. 자세한 이유는 분석 본문을 확인하세요.'],
  ja: ['現在、取引シグナルなし', '有効なエントリー条件はまだ成立していません。', '新たな確認シグナルが出たら再分析してください。詳しい理由は分析本文をご確認ください。'], vi: [vietnameseText("現在、取引シグナルなし"), vietnameseText("有効なエントリー条件はまだ成立していません。"), vietnameseText("新たな確認シグナルが出たら再分析してください。詳しい理由は分析本文をご確認ください。")],
};
const historicalCopy = {
  ko: {
    left:'좌측 조건부 계획 · 트리거 대기', right:'우측 조건부 계획 · 확인 대기', long:'롱 조건', short:'숏 조건',
    at_or_below:'가격이 다음 수준 이하로 복귀', at_or_above:'가격이 다음 수준 이상으로 복귀',
    cross_up:'캔들이 다음 수준 위에서 마감', cross_down:'캔들이 다음 수준 아래에서 마감',
    reclaim_follow:'영역 접촉 후 회복과 후속 캔들의 같은 방향 마감을 확인한 뒤, 진입·손절·목표가를 다시 분석하세요.',
    closed_breakout_retest:'종가 돌파 후 해당 가격 재시험과 지지를 확인한 뒤, 진입·손절·목표가를 다시 분석하세요.',
    closed_range:'최근 마감된 캔들 20개의 범위 참고값이며, 전략 신호는 아직 확인되지 않았습니다.',
    native_structure:'전략 구조의 참고 가격이며 확인을 기다리는 중입니다.', reason:'현재 미충족 조건',
    recheck:'트리거 후 선택한 전략, 계좌 위험, 비용 및 순손익비를 재검토한 뒤 진입 알림을 활성화할 수 있습니다.',
    missing:'충분하고 연속적인 최신 시장 데이터를 복구하고 전략 평가를 완료한 뒤 트리거 가격을 정하세요.',
    invalidate:'회복·재시험 실패, 구조 무효화 또는 계획 만료 시 해당 방향을 취소하고 다시 분석하세요.',
    notice:'현재는 조건부 예비 계획이며 즉시 진입 신호가 아닙니다.', expiry:'계획 유효 기한', expired:'계획이 만료되었습니다. 다시 분석하세요.',
  },
  ja: {
    left:'左側の条件付き計画 · 発動待ち', right:'右側の条件付き計画 · 確認待ち', long:'ロング条件', short:'ショート条件',
    at_or_below:'価格が次の水準以下に戻る', at_or_above:'価格が次の水準以上に戻る',
    cross_up:'ローソク足の終値が次の水準を上抜ける', cross_down:'ローソク足の終値が次の水準を下抜ける',
    reclaim_follow:'ゾーン到達後の回復と、その後の確定足による同方向の追随を確認し、エントリー・損切り・利確を再分析してください。',
    closed_breakout_retest:'終値でのブレイク後に、その価格の再テストと維持を確認し、エントリー・損切り・利確を再分析してください。',
    closed_range:'直近20本の確定足のレンジを参考にしたもので、戦略シグナルは未確認です。',
    native_structure:'戦略の構造に基づく参考価格です。確認を待っています。', reason:'現在満たされていない条件',
    recheck:'発動後に選択した戦略、口座リスク、コスト、純リスクリワード比を再確認してからエントリー通知を有効にできます。',
    missing:'十分かつ連続した最新の市場データを復旧し、戦略評価を完了してから発動価格を決めてください。',
    invalidate:'回復・再テストの失敗、構造の無効化、計画の期限切れの場合は、その方向を取り消して再分析してください。',
    notice:'これは条件付きの予備計画であり、即時エントリーのシグナルではありません。', expiry:'計画の有効期限', expired:'計画の有効期限が切れています。再分析してください。',
  }, vi: {
    left:vietnameseText("左側の条件付き計画 · 発動待ち"), right:vietnameseText("右側の条件付き計画 · 確認待ち"), long:vietnameseText("ロング条件"), short:vietnameseText("ショート条件"),
    at_or_below:vietnameseText("価格が次の水準以下に戻る"), at_or_above:vietnameseText("価格が次の水準以上に戻る"),
    cross_up:vietnameseText("ローソク足の終値が次の水準を上抜ける"), cross_down:vietnameseText("ローソク足の終値が次の水準を下抜ける"),
    reclaim_follow:vietnameseText("ゾーン到達後の回復と、その後の確定足による同方向の追随を確認し、エントリー・損切り・利確を再分析してください。"),
    closed_breakout_retest:vietnameseText("終値でのブレイク後に、その価格の再テストと維持を確認し、エントリー・損切り・利確を再分析してください。"),
    closed_range:vietnameseText("直近20本の確定足のレンジを参考にしたもので、戦略シグナルは未確認です。"),
    native_structure:vietnameseText("戦略の構造に基づく参考価格です。確認を待っています。"), reason:vietnameseText("現在満たされていない条件"),
    recheck:vietnameseText("発動後に選択した戦略、口座リスク、コスト、純リスクリワード比を再確認してからエントリー通知を有効にできます。"),
    missing:vietnameseText("十分かつ連続した最新の市場データを復旧し、戦略評価を完了してから発動価格を決めてください。"),
    invalidate:vietnameseText("回復・再テストの失敗、構造の無効化、計画の期限切れの場合は、その方向を取り消して再分析してください。"),
    notice:vietnameseText("これは条件付きの予備計画であり、即時エントリーのシグナルではありません。"), expiry:vietnameseText("計画の有効期限"), expired:vietnameseText("計画の有効期限が切れています。再分析してください。"),
  },
};

export function conditionalWatchCard(report, language, now = Date.now()) {
  const plan = report.executionPlan;
  if (!plan || plan.scenarios?.length || plan.entryCondition || report.planRecords?.length) return null;
  language = language === 'zh-Hant' ? 'zh-TW' : language;
  const historical = historicalConditionalWatchCard(report, language, now);
  if (historical) return historical;
  const presentation = plan.planPresentation, outcome = plan.outcome;
  if (presentation?.version !== 'always-card-v1' || presentation.status !== 'unavailable' || presentation.scenario != null
    || !['wait', 'unavailable'].includes(outcome?.action) || outcome.evaluationStatus !== 'completed'
    || outcome.candidateStatus !== 'none') return null;
  const lines = noSignalCopy[language] || noSignalCopy['zh-CN'];
  const title = `${report.marketId} · ${plan.context?.interval || report.interval} · ${lines[0]}`;
  const heading = executionPlanCardHeading(title, [{label:'Strategy',text:report.strategyId}], language);
  return {title, content:[title,...lines].join('\n'), readOnly:true,
    html:heading+`<div class="execution-plan-details" data-no-trading-signal>${lines.map(line => `<p class="execution-plan-card-line"><span class="execution-plan-card-value">${escape(line)}</span></p>`).join('')}</div>`};
}

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

function historicalConditionalWatchCard(report, language, now = Date.now()) {
  const watch = report.executionPlan?.conditionalWatch;
  if (!watch || !validConditionalWatch(watch, report.executionPlan, report.strategyId)) return null;
  // Historical reasonText has three frozen languages; keep its English text
  // for newer locales instead of translating or rewriting the saved reason.
  const index = ['en','ko','ja', 'vi'].includes(language) ? 1 : ['zh-TW','zh-Hant'].includes(language) ? 2 : 0;
  const t = key => historicalCopy[language]?.[key] || words[key][index];
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
