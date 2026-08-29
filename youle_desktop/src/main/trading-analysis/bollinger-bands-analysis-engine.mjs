import { computeBollingerBands } from "../trading-alerts/indicator-registry.mjs";

export const BOLLINGER_BANDS_ANALYSIS_ENGINE_ID = "bollinger-bands-analysis-deterministic-v1";

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

export function bollingerClosedCandles(snapshot) {
  const seconds = intervalSeconds(snapshot.interval, snapshot.candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + seconds <= now + 1);
  return Object.freeze({ candles: Object.freeze(candles), excludedLiveCandles: snapshot.candles.length - candles.length });
}

function percentileRank(values, index, lookback = 125) {
  if (!Number.isFinite(values[index])) return Number.NaN;
  const window = values.slice(Math.max(0, index - lookback + 1), index + 1).filter(Number.isFinite);
  if (window.length < 20) return Number.NaN;
  return window.filter((value) => value <= values[index]).length / window.length;
}

export function calculateBollingerSeries(candles, period = 20, multiplier = 2) {
  const closes = candles.map((candle) => candle.close);
  const { middle, upper, lower } = computeBollingerBands(closes, period, multiplier);
  const bandwidth = closes.map((_, index) => (
    Number.isFinite(upper[index]) && Number.isFinite(lower[index]) && Number.isFinite(middle[index]) && Math.abs(middle[index]) > Number.EPSILON
      ? (upper[index] - lower[index]) / middle[index]
      : Number.NaN
  ));
  const percentB = closes.map((value, index) => {
    const width = upper[index] - lower[index];
    return Number.isFinite(width) && width > Number.EPSILON ? (value - lower[index]) / width : Number.NaN;
  });
  const bandwidthPercentile = bandwidth.map((_, index) => percentileRank(bandwidth, index));
  return Object.freeze({
    middle: Object.freeze(middle),
    upper: Object.freeze(upper),
    lower: Object.freeze(lower),
    bandwidth: Object.freeze(bandwidth),
    percentB: Object.freeze(percentB),
    bandwidthPercentile: Object.freeze(bandwidthPercentile),
  });
}

function confirmedPivots(candles, radius = 2) {
  const highs = [];
  const lows = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const window = candles.slice(index - radius, index + radius + 1);
    const others = window.filter((_, offset) => offset !== radius);
    if (candles[index].high > Math.max(...others.map((candle) => candle.high))) highs.push({ index, value: candles[index].high });
    if (candles[index].low < Math.min(...others.map((candle) => candle.low))) lows.push({ index, value: candles[index].low });
  }
  return { highs, lows };
}

function squeezeAt(series, index) {
  return Number.isFinite(series.bandwidthPercentile[index]) && series.bandwidthPercentile[index] <= 0.2;
}

function recentSqueezeIndex(series, beforeIndex, maxDistance = 12) {
  for (let index = beforeIndex; index >= Math.max(19, beforeIndex - maxDistance); index -= 1) {
    if (squeezeAt(series, index)) return index;
  }
  return -1;
}

function detectSqueezeBreakouts(candles, series) {
  const patterns = [];
  const latest = candles.length - 1;
  for (let index = Math.max(20, latest - 16); index <= latest; index += 1) {
    if (index < 1) continue;
    const up = candles[index - 1].close > series.upper[index - 1] && candles[index].close > series.upper[index];
    const down = candles[index - 1].close < series.lower[index - 1] && candles[index].close < series.lower[index];
    if (!up && !down) continue;
    const squeezeIndex = recentSqueezeIndex(series, index - 1, 12);
    if (squeezeIndex < 0 || !Number.isFinite(series.bandwidth[index]) || series.bandwidth[index] <= series.bandwidth[squeezeIndex]) continue;
    const bias = up ? "bullish" : "bearish";
    patterns.push(Object.freeze({
      id: `boll-squeeze-breakout-${bias}-${candles[index].time}`,
      kind: "squeeze-breakout",
      name: up ? "缩口向上突破" : "缩口向下突破",
      bias,
      startIndex: squeezeIndex,
      endIndex: index,
      confirmationIndex: index,
      status: "confirmed",
      detail: "低带宽后连续两根已收盘 K 线越过同侧外轨，且带宽扩张",
    }));
  }
  return patterns;
}

function detectHeadFakes(candles, series) {
  const patterns = [];
  const latest = candles.length - 1;
  for (let breakout = Math.max(20, latest - 14); breakout < latest; breakout += 1) {
    const squeezeIndex = recentSqueezeIndex(series, breakout - 1, 10);
    if (squeezeIndex < 0) continue;
    const brokeUpper = candles[breakout].close > series.upper[breakout];
    const brokeLower = candles[breakout].close < series.lower[breakout];
    if (!brokeUpper && !brokeLower) continue;
    for (let confirmation = breakout + 1; confirmation <= Math.min(latest, breakout + 3); confirmation += 1) {
      const reversed = brokeUpper
        ? candles[confirmation].close < series.middle[confirmation]
        : candles[confirmation].close > series.middle[confirmation];
      if (!reversed) continue;
      const bias = brokeUpper ? "bearish" : "bullish";
      patterns.push(Object.freeze({
        id: `boll-head-fake-${bias}-${candles[confirmation].time}`,
        kind: "head-fake",
        name: brokeUpper ? "上轨假突破" : "下轨假突破",
        bias,
        startIndex: squeezeIndex,
        breakoutIndex: breakout,
        endIndex: confirmation,
        confirmationIndex: confirmation,
        status: "confirmed",
        detail: "缩口后越轨，但三根 K 线内收回带内并穿越中轨",
      }));
      break;
    }
  }
  return patterns;
}

function detectMTopAndWBottom(candles, series) {
  const patterns = [];
  const pivots = confirmedPivots(candles, 2);
  const latest = candles.length - 1;
  for (let offset = Math.max(1, pivots.highs.length - 8); offset < pivots.highs.length; offset += 1) {
    const first = pivots.highs[offset - 1];
    const second = pivots.highs[offset];
    if (second.index - first.index < 5 || second.index - first.index > 60) continue;
    const middleLow = pivots.lows.filter((item) => item.index > first.index && item.index < second.index).sort((a, b) => a.value - b.value)[0];
    if (!middleLow || !Number.isFinite(series.upper[first.index]) || !Number.isFinite(series.upper[second.index])) continue;
    const firstTagsUpper = first.value >= series.upper[first.index] * 0.999;
    const secondComparable = second.value >= first.value * 0.98;
    const secondInside = second.value < series.upper[second.index] * 0.999;
    if (!firstTagsUpper || !secondComparable || !secondInside) continue;
    const confirmationIndex = candles.findIndex((candle, index) => index > second.index && index <= latest && candle.close < middleLow.value);
    if (confirmationIndex < 0 || latest - confirmationIndex > 24) continue;
    patterns.push(Object.freeze({
      id: `boll-m-top-${candles[confirmationIndex].time}`,
      kind: "m-top",
      name: "布林 M 顶",
      bias: "bearish",
      startIndex: first.index,
      endIndex: confirmationIndex,
      confirmationIndex,
      pivotIndices: Object.freeze([first.index, middleLow.index, second.index]),
      neckline: middleLow.value,
      secondExtreme: second.value,
      status: "confirmed",
      detail: "第一高点触及上轨，第二高点未获上轨确认，收盘跌破颈线",
    }));
  }
  for (let offset = Math.max(1, pivots.lows.length - 8); offset < pivots.lows.length; offset += 1) {
    const first = pivots.lows[offset - 1];
    const second = pivots.lows[offset];
    if (second.index - first.index < 5 || second.index - first.index > 60) continue;
    const middleHigh = pivots.highs.filter((item) => item.index > first.index && item.index < second.index).sort((a, b) => b.value - a.value)[0];
    if (!middleHigh || !Number.isFinite(series.lower[first.index]) || !Number.isFinite(series.lower[second.index])) continue;
    const firstTagsLower = first.value <= series.lower[first.index] * 1.001;
    const secondComparable = second.value <= first.value * 1.02;
    const secondInside = second.value > series.lower[second.index] * 1.001;
    if (!firstTagsLower || !secondComparable || !secondInside) continue;
    const confirmationIndex = candles.findIndex((candle, index) => index > second.index && index <= latest && candle.close > middleHigh.value);
    if (confirmationIndex < 0 || latest - confirmationIndex > 24) continue;
    patterns.push(Object.freeze({
      id: `boll-w-bottom-${candles[confirmationIndex].time}`,
      kind: "w-bottom",
      name: "布林 W 底",
      bias: "bullish",
      startIndex: first.index,
      endIndex: confirmationIndex,
      confirmationIndex,
      pivotIndices: Object.freeze([first.index, middleHigh.index, second.index]),
      neckline: middleHigh.value,
      secondExtreme: second.value,
      status: "confirmed",
      detail: "第一低点触及下轨，第二低点未获下轨确认，收盘突破颈线",
    }));
  }
  return patterns;
}

export function detectBollingerPatterns(candles, series) {
  const unique = new Map();
  for (const item of [
    ...detectSqueezeBreakouts(candles, series),
    ...detectHeadFakes(candles, series),
    ...detectMTopAndWBottom(candles, series),
  ]) unique.set(`${item.kind}:${item.confirmationIndex}`, item);
  return Object.freeze([...unique.values()].sort((first, second) => first.confirmationIndex - second.confirmationIndex).slice(-8));
}

function detectBandWalk(candles, series) {
  const latest = candles.length - 1;
  const start = Math.max(19, latest - 7);
  const indices = Array.from({ length: latest - start + 1 }, (_, offset) => start + offset);
  if (indices.length < 6) return null;
  const upperHalf = indices.filter((index) => candles[index].close >= series.middle[index]).length;
  const lowerHalf = indices.filter((index) => candles[index].close <= series.middle[index]).length;
  const upperTouches = indices.filter((index) => candles[index].high >= series.upper[index] - (series.upper[index] - series.lower[index]) * 0.08).length;
  const lowerTouches = indices.filter((index) => candles[index].low <= series.lower[index] + (series.upper[index] - series.lower[index]) * 0.08).length;
  const slope = (series.middle[latest] - series.middle[start]) / Math.max(Math.abs(series.middle[start]), Number.EPSILON);
  if (upperHalf >= 6 && upperTouches >= 3 && slope > 0.001) return Object.freeze({ id: `boll-upper-walk-${candles[latest].time}`, kind: "upper-band-walk", name: "沿上轨运行", bias: "bullish", startIndex: start, endIndex: latest, status: "confirmed", detail: "多数收盘位于中轨上方，多次接近上轨且中轨上行" });
  if (lowerHalf >= 6 && lowerTouches >= 3 && slope < -0.001) return Object.freeze({ id: `boll-lower-walk-${candles[latest].time}`, kind: "lower-band-walk", name: "沿下轨运行", bias: "bearish", startIndex: start, endIndex: latest, status: "confirmed", detail: "多数收盘位于中轨下方，多次接近下轨且中轨下行" });
  return null;
}

function currentState(candles, series, bandWalk) {
  const latest = candles.length - 1;
  const previous = Math.max(19, latest - 5);
  const slope = (series.middle[latest] - series.middle[previous]) / Math.max(Math.abs(series.middle[previous]), Number.EPSILON);
  const percentile = series.bandwidthPercentile[latest];
  const bandwidthChange = series.bandwidth[latest] / Math.max(series.bandwidth[Math.max(19, latest - 3)], Number.EPSILON) - 1;
  const close = candles[latest].close;
  const location = close > series.upper[latest]
    ? "above-upper"
    : close < series.lower[latest]
      ? "below-lower"
      : close >= series.middle[latest]
        ? "upper-half"
        : "lower-half";
  return Object.freeze({
    close,
    middle: series.middle[latest],
    upper: series.upper[latest],
    lower: series.lower[latest],
    bandwidth: series.bandwidth[latest],
    bandwidthPercentile: percentile,
    percentB: series.percentB[latest],
    middleSlope: slope,
    location,
    volatilityRegime: percentile <= 0.2 ? "squeeze" : bandwidthChange > 0.08 ? "expanding" : "normal",
    bandWalk: bandWalk?.kind || "none",
  });
}

function buildActionPlan(candles, series, patterns, bandWalk) {
  const latest = candles.at(-1);
  const primary = [...patterns].reverse().find((item) => candles.length - 1 - item.confirmationIndex <= 12) || bandWalk;
  if (!primary) return Object.freeze({
    primaryBias: "neutral",
    disposition: "wait",
    validityBars: 4,
    confirmation: "等待缩口后的方向突破、M/W 颈线确认或有效沿带结构；单次触轨不执行",
    observeTrigger: "观察 BandWidth 是否从低位扩张、%B 是否随收盘突破同向确认，以及中轨斜率",
  });
  const bullish = primary.bias === "bullish";
  const confirmationIndex = primary.confirmationIndex ?? primary.endIndex;
  const confirmationCandle = candles[confirmationIndex] || latest;
  const recent = candles.slice(Math.max(0, confirmationIndex - 16), confirmationIndex + 1);
  const squeezeWindow = primary.kind.includes("squeeze") || primary.kind === "head-fake"
    ? candles.slice(primary.startIndex, confirmationIndex + 1)
    : recent;
  const structuralStop = primary.kind === "w-bottom" || primary.kind === "m-top"
    ? primary.secondExtreme
    : bullish
      ? Math.min(...squeezeWindow.map((candle) => candle.low))
      : Math.max(...squeezeWindow.map((candle) => candle.high));
  const trigger = bullish
    ? Math.max(confirmationCandle.high, latest.close * 1.0005)
    : Math.min(confirmationCandle.low, latest.close * 0.9995);
  const stop = structuralStop;
  const risk = Math.max(Math.abs(trigger - stop), latest.close * 0.001);
  const targets = (bullish ? [trigger + risk, trigger + risk * 2] : [trigger - risk, trigger - risk * 2])
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!targets.length || !Number.isFinite(stop) || stop <= 0) return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    disposition: "wait",
    validityBars: 4,
    confirmation: "形态方向已识别，但当前波动尺度无法形成有效的正价格风险边界，暂不执行",
    observeTrigger: "等待后续已收盘 K 线形成可计算的触发、失效和目标后重新分析",
  });
  return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    currentPrice: latest.close,
    disposition: "wait",
    validityBars: 4,
    ...(bullish
      ? { longTrigger: trigger, longInvalidation: stop, longTarget: targets[0], longTargets: Object.freeze(targets) }
      : { shortTrigger: trigger, shortInvalidation: stop, shortTarget: targets[0], shortTargets: Object.freeze(targets) }),
    confirmation: `等待已收盘 K 线${bullish ? "站上" : "跌破"} ${primary.name} 的再确认价；不得用盘中影线或单次触轨代替确认`,
    observeTrigger: "触发前重新核对 BandWidth、%B、中轨斜率和形态失效位，若收回结构内部则取消",
    sourcePatternId: primary.id,
  });
}

export function runBollingerBandsAnalysisEngine(snapshot) {
  const closed = bollingerClosedCandles(snapshot);
  if (closed.candles.length < 80) throw new TypeError("Bollinger Bands analysis requires at least 80 closed candles");
  const series = calculateBollingerSeries(closed.candles, 20, 2);
  const patterns = detectBollingerPatterns(closed.candles, series);
  const bandWalk = detectBandWalk(closed.candles, series);
  const state = currentState(closed.candles, series, bandWalk);
  const recentSqueeze = (() => {
    const index = recentSqueezeIndex(series, closed.candles.length - 1, 12);
    if (index < 0) return null;
    return Object.freeze({ id: `boll-squeeze-${closed.candles[index].time}`, index, time: closed.candles[index].time, bandwidth: series.bandwidth[index], percentile: series.bandwidthPercentile[index] });
  })();
  const evidence = [
    ...patterns.map((item) => ({ id: item.id, summary: `${item.name}：${item.detail}` })),
    ...(bandWalk ? [{ id: bandWalk.id, summary: `${bandWalk.name}：${bandWalk.detail}` }] : []),
    ...(recentSqueeze ? [{ id: recentSqueeze.id, summary: `带宽低位：${recentSqueeze.bandwidth}，百分位 ${recentSqueeze.percentile}` }] : []),
    { id: `boll-state-${closed.candles.at(-1).time}`, summary: `BOLL(20,2) middle ${state.middle}; upper ${state.upper}; lower ${state.lower}; %B ${state.percentB}; BandWidth ${state.bandwidth}` },
  ];
  return Object.freeze({
    engineId: BOLLINGER_BANDS_ANALYSIS_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    parameters: Object.freeze([20, 2]),
    closedCandleCount: closed.candles.length,
    excludedLiveCandles: closed.excludedLiveCandles,
    lastClosedCandle: closed.candles.at(-1),
    currentState: state,
    recentSqueeze,
    bandWalk,
    patterns,
    series,
    coverage: Object.freeze({ candles: "available", bollingerBands: "available", volume: "unavailable" }),
    actionPlan: buildActionPlan(closed.candles, series, patterns, bandWalk),
    evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
