// Public transport requirements for /agent-runs admission, not strategy rules.
// Include room for the current unclosed bar where admission counts closed bars.
// Keep explicit lookback ranges and VPVR's exact viewport unchanged.
const minimumCounts = Object.freeze({
  chan: 31,
  wave: 31,
  wyckoff: 61,
  'order-flow': 120,
  'dow-theory': 120,
  'gann-theory': 80,
  'price-action': 81,
  'ict-smc': 81,
  'smt-divergence': 81,
  harmonic: 81,
  'chart-patterns': 81,
  'moving-average-analysis': 91,
  'macd-analysis': 81,
  'bollinger-bands-analysis': 81,
  'rsi-analysis': 81,
  'kdj-analysis': 81,
  'trend-band': 60,
  'vpvr-analysis': 20,
});

export function cloudStrategyMinimumHistory(strategyId, history) {
  const fallback = Object.hasOwn(minimumCounts, strategyId) ? minimumCounts[strategyId] : 31;
  if (history == null) return fallback; // Backward compatible with existing API releases.
  const {minimumCandles, minimumClosedCandles, windowCount} = history;
  if (![minimumCandles, minimumClosedCandles, windowCount].every(Number.isSafeInteger)
    || minimumCandles < 20 || minimumClosedCandles < 0 || minimumClosedCandles > minimumCandles || windowCount > 600
    || windowCount < minimumCandles || (strategyId !== 'vpvr-analysis' && windowCount <= minimumClosedCandles)) {
    throw Object.assign(new Error('CLOUD_HISTORY_REQUIREMENTS_INVALID'),{code:'CLOUD_HISTORY_REQUIREMENTS_INVALID'});
  }
  return Math.max(fallback, windowCount);
}
