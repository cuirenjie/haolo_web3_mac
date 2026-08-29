import { computeKdj } from "../trading-alerts/indicator-registry.mjs";

export const KDJ_ANALYSIS_ENGINE_ID = "kdj-analysis-deterministic-v1";
export const KDJ_PARAMETERS = Object.freeze([9, 3, 3]);

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

export function kdjClosedCandles(snapshot) {
  const seconds = intervalSeconds(snapshot.interval, snapshot.candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + seconds <= now + 1);
  return Object.freeze({ candles: Object.freeze(candles), excludedLiveCandles: snapshot.candles.length - candles.length });
}

export function calculateKdjSeries(candles, period = 9, smoothK = 3, smoothD = 3) {
  const result = computeKdj(candles, period, smoothK, smoothD);
  return Object.freeze({
    k: Object.freeze(result.k),
    d: Object.freeze(result.d),
    j: Object.freeze(result.j),
    parameters: Object.freeze([period, smoothK, smoothD]),
  });
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

export function detectKdjDivergences(candles, series) {
  const result = [];
  const pivots = pricePivots(candles);
  const inspect = (items, side) => {
    for (let offset = Math.max(1, items.length - 6); offset < items.length; offset += 1) {
      const first = items[offset - 1];
      const second = items[offset];
      if (!first || !second || second.index - first.index < 4 || second.index - first.index > 90) continue;
      const firstD = series.d[first.index];
      const secondD = series.d[second.index];
      if (![firstD, secondD].every(Number.isFinite) || Math.abs(secondD - firstD) < 3) continue;
      const priceDelta = second.value - first.value;
      const dDelta = secondD - firstD;
      const priceThreshold = Math.max(
        Math.abs(first.value) * 0.0005,
        median(candles.slice(first.index, second.index + 1).map((candle) => candle.high - candle.low)) * 0.3,
      );
      let kind = null;
      if (side === "high" && priceDelta > priceThreshold && dDelta < 0) kind = "regular-bearish";
      if (side === "low" && priceDelta < -priceThreshold && dDelta > 0) kind = "regular-bullish";
      if (side === "low" && priceDelta > priceThreshold && dDelta < 0) kind = "hidden-bullish";
      if (side === "high" && priceDelta < -priceThreshold && dDelta > 0) kind = "hidden-bearish";
      if (!kind) continue;
      result.push(Object.freeze({
        id: `kdj-divergence-${kind}-${candles[second.index].time}`,
        kind,
        firstIndex: first.index,
        secondIndex: second.index,
        priceFirst: first.value,
        priceSecond: second.value,
        dFirst: firstD,
        dSecond: secondD,
        status: "confirmed",
      }));
    }
  };
  inspect(pivots.highs, "high");
  inspect(pivots.lows, "low");
  return Object.freeze(result.sort((first, second) => first.secondIndex - second.secondIndex).slice(-6));
}

export function kdjCrossoverPoint(candles, series, priorIndex, crossIndex) {
  const priorTime = Number(candles[priorIndex]?.time);
  const crossTime = Number(candles[crossIndex]?.time);
  const priorK = Number(series.k[priorIndex]);
  const priorD = Number(series.d[priorIndex]);
  const crossK = Number(series.k[crossIndex]);
  const crossD = Number(series.d[crossIndex]);
  if (![priorTime, crossTime, priorK, priorD, crossK, crossD].every(Number.isFinite) || crossTime <= priorTime) {
    throw new TypeError("KDJ crossover endpoints are invalid");
  }
  const priorDifference = priorK - priorD;
  const crossDifference = crossK - crossD;
  const span = priorDifference - crossDifference;
  const ratio = Math.min(1, Math.max(0, Math.abs(span) > Number.EPSILON ? priorDifference / span : 1));
  const kValue = priorK + (crossK - priorK) * ratio;
  const dValue = priorD + (crossD - priorD) * ratio;
  return Object.freeze({ time: Math.round(priorTime + (crossTime - priorTime) * ratio), value: (kValue + dValue) / 2 });
}

export function detectKdjCrossovers(candles, series) {
  const result = [];
  const latest = candles.length - 1;
  for (let index = Math.max(9, latest - 36); index <= latest; index += 1) {
    const previous = index - 1;
    const values = [series.k[previous], series.d[previous], series.k[index], series.d[index]];
    if (!values.every(Number.isFinite)) continue;
    const golden = series.k[previous] <= series.d[previous] && series.k[index] > series.d[index];
    const death = series.k[previous] >= series.d[previous] && series.k[index] < series.d[index];
    if (!golden && !death) continue;
    const lowZone = Math.min(...values) <= 25;
    const highZone = Math.max(...values) >= 75;
    const eligible = golden ? lowZone : highZone;
    const zone = lowZone ? "low" : highZone ? "high" : "middle";
    result.push(Object.freeze({
      id: `kdj-${golden ? "golden" : "death"}-cross-${candles[index].time}`,
      kind: golden ? "golden-cross" : "death-cross",
      name: `${zone === "low" ? "低位" : zone === "high" ? "高位" : "中位"}${golden ? "金叉" : "死叉"}`,
      bias: golden ? "bullish" : "bearish",
      priorIndex: previous,
      confirmationIndex: index,
      crossPoint: kdjCrossoverPoint(candles, series, previous, index),
      zone,
      eligible,
      status: "confirmed",
    }));
  }
  return Object.freeze(result.slice(-10));
}

export function detectKdjExtremeEvents(candles, series) {
  const result = [];
  const add = (type, name, index, value, bias) => result.push(Object.freeze({
    id: `kdj-${type}-${candles[index].time}`,
    type,
    name,
    index,
    value,
    bias,
    status: "confirmed",
  }));
  for (let index = 9; index < candles.length; index += 1) {
    const previousD = series.d[index - 1];
    const currentD = series.d[index];
    const previousJ = series.j[index - 1];
    const currentJ = series.j[index];
    if ([previousD, currentD].every(Number.isFinite)) {
      if (previousD <= 20 && currentD > 20) add("oversold-exit", "D线离开超卖区", index, currentD, "bullish");
      if (previousD >= 80 && currentD < 80) add("overbought-exit", "D线离开超买区", index, currentD, "bearish");
    }
    if ([previousJ, currentJ].every(Number.isFinite)) {
      if (previousJ >= 0 && currentJ < 0) add("j-below-zero", "J线跌破0", index, currentJ, "bearish");
      if (previousJ <= 100 && currentJ > 100) add("j-above-hundred", "J线上穿100", index, currentJ, "bullish");
    }
  }
  const latest = candles.length - 1;
  return Object.freeze(result.filter((item) => latest - item.index <= 24).slice(-8));
}

function extremePersistence(series, latest, side) {
  let bars = 0;
  for (let index = latest; index >= 0; index -= 1) {
    const inZone = side === "high"
      ? series.k[index] >= 80 && series.d[index] >= 80
      : series.k[index] <= 20 && series.d[index] <= 20;
    if (!inZone) break;
    bars += 1;
  }
  return bars;
}

function currentKdjState(series) {
  const latest = series.k.length - 1;
  const k = series.k[latest];
  const d = series.d[latest];
  const j = series.j[latest];
  const highBars = extremePersistence(series, latest, "high");
  const lowBars = extremePersistence(series, latest, "low");
  return Object.freeze({
    k,
    d,
    j,
    zone: k >= 80 && d >= 80 ? "overbought" : k <= 20 && d <= 20 ? "oversold" : "neutral",
    alignment: j > k && k > d ? "bullish" : j < k && k < d ? "bearish" : "mixed",
    dMomentum: d > series.d[latest - 1] ? "rising" : d < series.d[latest - 1] ? "falling" : "flat",
    saturation: highBars >= 3 ? "high-persistence" : lowBars >= 3 ? "low-persistence" : "none",
    saturationBars: Math.max(highBars, lowBars),
  });
}

function buildActionPlan(candles, crossovers, divergences) {
  const latestIndex = candles.length - 1;
  const candidates = [
    ...crossovers.filter((item) => item.eligible).map((item) => ({ ...item, completionIndex: item.confirmationIndex, startIndex: item.priorIndex, source: "crossover" })),
    ...divergences.map((item) => ({ ...item, bias: item.kind.includes("bullish") ? "bullish" : "bearish", completionIndex: item.secondIndex, startIndex: item.firstIndex, source: "divergence" })),
  ].filter((item) => latestIndex - item.completionIndex <= 20)
    .sort((first, second) => first.completionIndex - second.completionIndex);
  const evidence = candidates.at(-1);
  if (!evidence) return Object.freeze({
    primaryBias: "neutral",
    disposition: "wait",
    validityBars: 4,
    confirmation: "KDJ 只提供动量证据；等待低位金叉/高位死叉或确认背离，再由已收盘 K 线突破价格结构",
    observeTrigger: "观察 K/D 在 80/20 区域的出区与交叉、D 线背离和 J 线极值；不把单次超买超卖作为入场",
  });
  const bullish = evidence.bias === "bullish";
  const window = candles.slice(Math.max(0, evidence.startIndex), latestIndex + 1);
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
    confirmation: `等待已收盘 K 线${bullish ? "站上" : "跌破"} KDJ 证据对应的价格结构；KDJ 信号不得单独触发`,
    observeTrigger: `触发时重新核对 K/D 方向、D 线背离与 J 线是否反向加速，且${evidence.source === "crossover" ? "交叉未反向失效" : "背离摆动点未被改写"}`,
  });
}

export function runKdjAnalysisEngine(snapshot) {
  const closed = kdjClosedCandles(snapshot);
  if (closed.candles.length < 80) throw new TypeError("KDJ analysis requires at least 80 closed candles");
  const series = calculateKdjSeries(closed.candles, ...KDJ_PARAMETERS);
  const crossovers = detectKdjCrossovers(closed.candles, series);
  const divergences = detectKdjDivergences(closed.candles, series);
  const extremeEvents = detectKdjExtremeEvents(closed.candles, series);
  const currentState = currentKdjState(series);
  const evidence = [
    ...crossovers.slice(-4).map((item) => ({ id: item.id, summary: `${item.name}：K/D 在 ${item.crossPoint.value} 交叉${item.eligible ? "，极值区有效" : "，仅观察"}` })),
    ...divergences.map((item) => ({ id: item.id, summary: `${item.kind} price ${item.priceFirst}→${item.priceSecond}; D ${item.dFirst}→${item.dSecond}` })),
    ...extremeEvents.slice(-4).map((item) => ({ id: item.id, summary: `${item.name}：${item.value}` })),
    { id: `kdj-state-${closed.candles.at(-1).time}`, summary: `KDJ(9,3,3) K ${currentState.k}; D ${currentState.d}; J ${currentState.j}; ${currentState.zone}; ${currentState.saturation}` },
  ];
  return Object.freeze({
    engineId: KDJ_ANALYSIS_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    parameters: KDJ_PARAMETERS,
    closedCandleCount: closed.candles.length,
    excludedLiveCandles: closed.excludedLiveCandles,
    lastClosedCandle: closed.candles.at(-1),
    currentState,
    crossovers,
    divergences,
    extremeEvents,
    series,
    coverage: Object.freeze({ candles: "available", kdj: "available", volume: "unavailable" }),
    actionPlan: buildActionPlan(closed.candles, crossovers, divergences),
    evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
