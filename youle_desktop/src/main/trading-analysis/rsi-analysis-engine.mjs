import { computeRsi } from "../trading-alerts/indicator-registry.mjs";

export const RSI_ANALYSIS_ENGINE_ID = "rsi-analysis-deterministic-v1";

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function intervalSeconds(interval, candles) {
  const source = String(interval || "").toUpperCase();
  if (source === "1D") return 86_400;
  if (source === "1W") return 604_800;
  if (/^\d+$/.test(source)) return Number(source) * 60;
  return median(candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((value) => value > 0)) || 3_600;
}

export function rsiClosedCandles(snapshot) {
  const seconds = intervalSeconds(snapshot.interval, snapshot.candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + seconds <= now + 1);
  return Object.freeze({ candles: Object.freeze(candles), excludedLiveCandles: snapshot.candles.length - candles.length });
}

export function calculateRsiSeries(candles, period = 14) {
  return Object.freeze(computeRsi(candles.map((candle) => candle.close), period));
}

function valuePivots(values, radius = 2) {
  const highs = [];
  const lows = [];
  for (let index = radius; index < values.length - radius; index += 1) {
    const window = values.slice(index - radius, index + radius + 1);
    if (!window.every(Number.isFinite)) continue;
    const others = window.filter((_, offset) => offset !== radius);
    if (values[index] > Math.max(...others)) highs.push(Object.freeze({ index, value: values[index] }));
    if (values[index] < Math.min(...others)) lows.push(Object.freeze({ index, value: values[index] }));
  }
  return Object.freeze({ highs: Object.freeze(highs), lows: Object.freeze(lows) });
}

function pricePivots(candles, radius = 2) {
  const highs = [];
  const lows = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const others = candles.slice(index - radius, index + radius + 1).filter((_, offset) => offset !== radius);
    if (candles[index].high > Math.max(...others.map((candle) => candle.high))) highs.push({ index, value: candles[index].high });
    if (candles[index].low < Math.min(...others.map((candle) => candle.low))) lows.push({ index, value: candles[index].low });
  }
  return { highs, lows };
}

export function detectRsiDivergences(candles, rsi) {
  const result = [];
  const pivots = pricePivots(candles);
  const inspect = (items, side) => {
    for (let offset = Math.max(1, items.length - 6); offset < items.length; offset += 1) {
      const first = items[offset - 1];
      const second = items[offset];
      if (!first || !second || second.index - first.index < 4 || second.index - first.index > 90) continue;
      if (![rsi[first.index], rsi[second.index]].every(Number.isFinite)) continue;
      const priceDelta = second.value - first.value;
      const rsiDelta = rsi[second.index] - rsi[first.index];
      const priceThreshold = Math.max(Math.abs(first.value) * 0.0005, median(candles.slice(first.index, second.index + 1).map((candle) => candle.high - candle.low)) * 0.3);
      if (Math.abs(rsiDelta) < 2.5) continue;
      let kind = null;
      if (side === "high" && priceDelta > priceThreshold && rsiDelta < 0) kind = "regular-bearish";
      if (side === "low" && priceDelta < -priceThreshold && rsiDelta > 0) kind = "regular-bullish";
      if (side === "low" && priceDelta > priceThreshold && rsiDelta < 0) kind = "hidden-bullish";
      if (side === "high" && priceDelta < -priceThreshold && rsiDelta > 0) kind = "hidden-bearish";
      if (!kind) continue;
      result.push(Object.freeze({
        id: `rsi-divergence-${kind}-${candles[second.index].time}`,
        kind,
        firstIndex: first.index,
        secondIndex: second.index,
        priceFirst: first.value,
        priceSecond: second.value,
        rsiFirst: rsi[first.index],
        rsiSecond: rsi[second.index],
        status: "confirmed",
      }));
    }
  };
  inspect(pivots.highs, "high");
  inspect(pivots.lows, "low");
  return Object.freeze(result.slice(-6));
}

export function detectRsiFailureSwings(candles, rsi) {
  const latest = candles.length - 1;
  const pivots = valuePivots(rsi, 1);
  const result = [];
  for (const first of pivots.lows.filter((item) => item.value <= 30 && latest - item.index <= 60)) {
    const peak = pivots.highs.find((item) => item.index > first.index && item.index - first.index <= 14);
    const second = peak && pivots.lows.find((item) => item.index > peak.index && item.index - peak.index <= 14 && item.value >= first.value + 1);
    if (!peak || !second) continue;
    const confirmationIndex = rsi.findIndex((value, index) => index > second.index && index - second.index <= 14 && value > peak.value);
    if (confirmationIndex < 0 || latest - confirmationIndex > 16) continue;
    result.push(Object.freeze({ id: `rsi-failure-swing-bullish-${candles[confirmationIndex].time}`, name: "看涨失败摆动", bias: "bullish", firstIndex: first.index, middleIndex: peak.index, secondIndex: second.index, confirmationIndex, breakoutValue: peak.value, status: "confirmed" }));
  }
  for (const first of pivots.highs.filter((item) => item.value >= 70 && latest - item.index <= 60)) {
    const trough = pivots.lows.find((item) => item.index > first.index && item.index - first.index <= 14);
    const second = trough && pivots.highs.find((item) => item.index > trough.index && item.index - trough.index <= 14 && item.value <= first.value - 1);
    if (!trough || !second) continue;
    const confirmationIndex = rsi.findIndex((value, index) => index > second.index && index - second.index <= 14 && value < trough.value);
    if (confirmationIndex < 0 || latest - confirmationIndex > 16) continue;
    result.push(Object.freeze({ id: `rsi-failure-swing-bearish-${candles[confirmationIndex].time}`, name: "看跌失败摆动", bias: "bearish", firstIndex: first.index, middleIndex: trough.index, secondIndex: second.index, confirmationIndex, breakoutValue: trough.value, status: "confirmed" }));
  }
  const unique = new Map(result.sort((first, second) => first.confirmationIndex - second.confirmationIndex).map((item) => [item.id, item]));
  return Object.freeze([...unique.values()].slice(-4));
}

export function detectRsiThresholdEvents(candles, rsi) {
  const events = [];
  const add = (type, name, index, bias) => events.push(Object.freeze({ id: `rsi-${type}-${candles[index].time}`, type, name, index, value: rsi[index], bias, status: "confirmed" }));
  for (let index = 1; index < rsi.length; index += 1) {
    if (![rsi[index - 1], rsi[index]].every(Number.isFinite)) continue;
    if (rsi[index - 1] > 30 && rsi[index] <= 30) add("oversold-enter", "进入超卖区", index, "bearish");
    if (rsi[index - 1] <= 30 && rsi[index] > 30) add("oversold-exit", "离开超卖区", index, "bullish");
    if (rsi[index - 1] < 70 && rsi[index] >= 70) add("overbought-enter", "进入超买区", index, "bullish");
    if (rsi[index - 1] >= 70 && rsi[index] < 70) add("overbought-exit", "离开超买区", index, "bearish");
    if (rsi[index - 1] <= 50 && rsi[index] > 50) add("center-bull", "上穿 50 中轴", index, "bullish");
    if (rsi[index - 1] >= 50 && rsi[index] < 50) add("center-bear", "下穿 50 中轴", index, "bearish");
  }
  const latest = candles.length - 1;
  return Object.freeze(events.filter((item) => latest - item.index <= 24).slice(-8));
}

function currentRsiState(rsi) {
  const finite = rsi.filter(Number.isFinite);
  const value = finite.at(-1);
  const previous = finite.at(-2);
  const recent = finite.slice(-40);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const rangeRegime = recent.length >= 20 && low >= 38 && high >= 70
    ? "bullish-range"
    : recent.length >= 20 && high <= 62 && low <= 30
      ? "bearish-range"
      : "neutral-range";
  return Object.freeze({
    value,
    zone: value >= 70 ? "overbought" : value <= 30 ? "oversold" : "neutral",
    centerRelation: value >= 50 ? "above-50" : "below-50",
    momentum: value > previous ? "rising" : value < previous ? "falling" : "flat",
    rangeRegime,
    recentLow: low,
    recentHigh: high,
  });
}

function actionPlan(candles, divergences, failureSwings) {
  const latestIndex = candles.length - 1;
  const candidates = [
    ...divergences.map((item) => ({ ...item, bias: item.kind.includes("bullish") ? "bullish" : "bearish", completionIndex: item.secondIndex, source: "divergence" })),
    ...failureSwings.map((item) => ({ ...item, completionIndex: item.confirmationIndex, source: "failure-swing" })),
  ].filter((item) => latestIndex - item.completionIndex <= 20).sort((first, second) => first.completionIndex - second.completionIndex);
  const evidence = candidates.at(-1);
  if (!evidence) return Object.freeze({ primaryBias: "neutral", disposition: "wait", validityBars: 4, confirmation: "RSI 只提供动量证据；等待确认背离或完整失败摆动后，再由已收盘 K 线突破价格结构", observeTrigger: "观察 RSI 70/30、50 中轴和价格摆动是否形成可验证共振，不把单次超买超卖作为入场" });
  const bullish = evidence.bias === "bullish";
  const startIndex = Math.max(0, evidence.secondIndex ?? evidence.completionIndex - 8);
  const window = candles.slice(startIndex, latestIndex + 1);
  const trigger = bullish ? Math.max(...window.map((candle) => candle.high)) : Math.min(...window.map((candle) => candle.low));
  const stop = bullish ? Math.min(...window.map((candle) => candle.low)) : Math.max(...window.map((candle) => candle.high));
  const risk = Math.max(Math.abs(trigger - stop), candles.at(-1).close * 0.001);
  const targets = bullish ? [trigger + risk, trigger + risk * 2] : [trigger - risk, trigger - risk * 2];
  return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    currentPrice: candles.at(-1).close,
    disposition: "wait",
    validityBars: 4,
    evidenceId: evidence.id,
    ...(bullish
      ? { longTrigger: trigger, longInvalidation: stop, longTarget: targets[0], longTargets: Object.freeze(targets) }
      : { shortTrigger: trigger, shortInvalidation: stop, shortTarget: targets[0], shortTargets: Object.freeze(targets) }),
    confirmation: `等待已收盘 K 线${bullish ? "站上" : "跌破"} RSI 证据对应的价格结构；RSI 信号不得单独触发`,
    observeTrigger: `触发时重新确认 RSI 没有出现反向失败摆动，且${evidence.source === "failure-swing" ? "失败摆动突破仍成立" : "背离摆动点未被反向改写"}`,
  });
}

export function runRsiAnalysisEngine(snapshot) {
  const closed = rsiClosedCandles(snapshot);
  if (closed.candles.length < 80) throw new TypeError("RSI analysis requires at least 80 closed candles");
  const series = calculateRsiSeries(closed.candles, 14);
  const divergences = detectRsiDivergences(closed.candles, series);
  const failureSwings = detectRsiFailureSwings(closed.candles, series);
  const thresholdEvents = detectRsiThresholdEvents(closed.candles, series);
  const currentState = currentRsiState(series);
  const evidence = [
    ...failureSwings.map((item) => ({ id: item.id, summary: `${item.name}：RSI 突破 ${item.breakoutValue}` })),
    ...divergences.map((item) => ({ id: item.id, summary: `${item.kind} price ${item.priceFirst}→${item.priceSecond}; RSI ${item.rsiFirst}→${item.rsiSecond}` })),
    ...thresholdEvents.slice(-4).map((item) => ({ id: item.id, summary: `${item.name}：RSI ${item.value}` })),
    { id: `rsi-state-${closed.candles.at(-1).time}`, summary: `RSI(14) ${currentState.value}; ${currentState.zone}; ${currentState.rangeRegime}` },
  ];
  return Object.freeze({
    engineId: RSI_ANALYSIS_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    parameters: Object.freeze([14]),
    closedCandleCount: closed.candles.length,
    excludedLiveCandles: closed.excludedLiveCandles,
    lastClosedCandle: closed.candles.at(-1),
    currentState,
    thresholdEvents,
    failureSwings,
    divergences,
    series,
    coverage: Object.freeze({ candles: "available", rsi: "available", volume: "unavailable" }),
    actionPlan: actionPlan(closed.candles, divergences, failureSwings),
    evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
