import { computeAtr, indicatorSma } from "../trading-alerts/indicator-registry.mjs";

export const MOVING_AVERAGE_ANALYSIS_ENGINE_ID = "moving-average-analysis-deterministic-v1";
export const MOVING_AVERAGE_PERIODS = Object.freeze([5, 20, 60]);

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

export function movingAverageClosedCandles(snapshot) {
  const seconds = intervalSeconds(snapshot.interval, snapshot.candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + seconds <= now + 1);
  return Object.freeze({ candles: Object.freeze(candles), excludedLiveCandles: snapshot.candles.length - candles.length });
}

function percentileRank(values, index, lookback = 120) {
  if (!Number.isFinite(values[index])) return Number.NaN;
  const window = values.slice(Math.max(0, index - lookback + 1), index + 1).filter(Number.isFinite);
  if (window.length < 20) return Number.NaN;
  return window.filter((value) => value <= values[index]).length / window.length;
}

function normalizedSlope(values, index, lookback = 5, reference = 1) {
  const start = index - lookback;
  if (start < 0 || !Number.isFinite(values[index]) || !Number.isFinite(values[start])) return Number.NaN;
  return (values[index] - values[start]) / Math.max(Math.abs(reference), Number.EPSILON);
}

export function movingAverageCrossoverPoint(candles, series, priorIndex, crossIndex) {
  const priorTime = Number(candles[priorIndex]?.time);
  const crossTime = Number(candles[crossIndex]?.time);
  const priorShort = Number(series.short[priorIndex]);
  const priorMedium = Number(series.medium[priorIndex]);
  const crossShort = Number(series.short[crossIndex]);
  const crossMedium = Number(series.medium[crossIndex]);
  if (![priorTime, crossTime, priorShort, priorMedium, crossShort, crossMedium].every(Number.isFinite) || crossTime <= priorTime) {
    throw new TypeError("Moving average crossover endpoints are invalid");
  }
  const priorDifference = priorShort - priorMedium;
  const crossDifference = crossShort - crossMedium;
  const differenceSpan = priorDifference - crossDifference;
  const ratio = Math.min(1, Math.max(0, Math.abs(differenceSpan) > Number.EPSILON
    ? priorDifference / differenceSpan
    : 1));
  const shortValue = priorShort + (crossShort - priorShort) * ratio;
  const mediumValue = priorMedium + (crossMedium - priorMedium) * ratio;
  return Object.freeze({
    time: priorTime + (crossTime - priorTime) * ratio,
    price: (shortValue + mediumValue) / 2,
  });
}

export function calculateMovingAverageSeries(candles, periods = MOVING_AVERAGE_PERIODS) {
  const [shortPeriod, mediumPeriod, longPeriod] = periods;
  const closes = candles.map((candle) => candle.close);
  const short = indicatorSma(closes, shortPeriod);
  const medium = indicatorSma(closes, mediumPeriod);
  const long = indicatorSma(closes, longPeriod);
  const atr = computeAtr(candles, 14);
  const ribbonSpread = closes.map((close, index) => {
    const values = [short[index], medium[index], long[index]];
    return values.every(Number.isFinite) && close > Number.EPSILON
      ? (Math.max(...values) - Math.min(...values)) / close
      : Number.NaN;
  });
  const spreadPercentile = ribbonSpread.map((_, index) => percentileRank(ribbonSpread, index));
  return Object.freeze({
    short: Object.freeze(short),
    medium: Object.freeze(medium),
    long: Object.freeze(long),
    atr: Object.freeze(atr),
    ribbonSpread: Object.freeze(ribbonSpread),
    spreadPercentile: Object.freeze(spreadPercentile),
    periods: Object.freeze([...periods]),
  });
}

function orderingAt(series, index) {
  const short = series.short[index];
  const medium = series.medium[index];
  const long = series.long[index];
  if (![short, medium, long].every(Number.isFinite)) return "unavailable";
  if (short > medium && medium > long) return "bullish";
  if (short < medium && medium < long) return "bearish";
  return "mixed";
}

function orderingPersists(series, index, direction, bars = 3) {
  if (index - bars + 1 < 0) return false;
  return Array.from({ length: bars }, (_, offset) => orderingAt(series, index - offset)).every((value) => value === direction);
}

function slopeState(candles, series, index) {
  const reference = candles[index]?.close || 1;
  return Object.freeze({
    short: normalizedSlope(series.short, index, 5, reference),
    medium: normalizedSlope(series.medium, index, 5, reference),
    long: normalizedSlope(series.long, index, 5, reference),
  });
}

function recentCompressionIndex(series, beforeIndex, maxDistance = 14) {
  for (let index = beforeIndex; index >= Math.max(59, beforeIndex - maxDistance); index -= 1) {
    const percentile = series.spreadPercentile[index];
    if ((Number.isFinite(percentile) && percentile <= 0.2) || series.ribbonSpread[index] <= 0.006) return index;
  }
  return -1;
}

function detectPersistedCrossovers(candles, series) {
  const patterns = [];
  const latest = candles.length - 1;
  for (let confirmationIndex = Math.max(2, latest - 30); confirmationIndex <= latest; confirmationIndex += 1) {
    const crossIndex = confirmationIndex - 1;
    const priorIndex = crossIndex - 1;
    if (![series.short[priorIndex], series.medium[priorIndex], series.short[crossIndex], series.medium[crossIndex], series.short[confirmationIndex], series.medium[confirmationIndex]].every(Number.isFinite)) continue;
    const golden = series.short[priorIndex] <= series.medium[priorIndex]
      && series.short[crossIndex] > series.medium[crossIndex]
      && series.short[confirmationIndex] > series.medium[confirmationIndex];
    const death = series.short[priorIndex] >= series.medium[priorIndex]
      && series.short[crossIndex] < series.medium[crossIndex]
      && series.short[confirmationIndex] < series.medium[confirmationIndex];
    if (!golden && !death) continue;
    const slopes = slopeState(candles, series, confirmationIndex);
    const bullish = golden;
    const contextAligned = bullish
      ? candles[confirmationIndex].close > series.long[confirmationIndex] && slopes.long >= -0.001
      : candles[confirmationIndex].close < series.long[confirmationIndex] && slopes.long <= 0.001;
    const crossPoint = movingAverageCrossoverPoint(candles, series, priorIndex, crossIndex);
    patterns.push(Object.freeze({
      id: `ma-${bullish ? "golden" : "death"}-cross-${candles[confirmationIndex].time}`,
      kind: bullish ? "golden-cross" : "death-cross",
      name: bullish ? "均线金叉" : "均线死叉",
      bias: bullish ? "bullish" : "bearish",
      startIndex: priorIndex,
      crossIndex,
      crossPoint,
      confirmationIndex,
      endIndex: confirmationIndex,
      status: "confirmed",
      eligible: contextAligned,
      detail: contextAligned
        ? `MA5 ${bullish ? "上穿" : "下穿"} MA20，并由下一根已收盘 K 线保持；MA60 与价格背景同向`
        : `MA5 ${bullish ? "上穿" : "下穿"} MA20 并保持，但与 MA60 或价格背景冲突，仅作观察`,
    }));
  }
  return patterns;
}

function detectOrderedExpansions(candles, series) {
  const patterns = [];
  const latest = candles.length - 1;
  for (let confirmationIndex = Math.max(61, latest - 18); confirmationIndex <= latest; confirmationIndex += 1) {
    const direction = orderingAt(series, confirmationIndex);
    if (!orderingPersists(series, confirmationIndex, direction, 3) || !["bullish", "bearish"].includes(direction)) continue;
    const compressionIndex = recentCompressionIndex(series, confirmationIndex - 2, 14);
    if (compressionIndex < 0) continue;
    const spread = series.ribbonSpread[confirmationIndex];
    const compressed = series.ribbonSpread[compressionIndex];
    if (!Number.isFinite(spread) || !Number.isFinite(compressed) || spread < Math.max(compressed * 1.5, 0.004)) continue;
    if (spread <= series.ribbonSpread[confirmationIndex - 1]) continue;
    const slopes = slopeState(candles, series, confirmationIndex);
    const bullish = direction === "bullish";
    const slopesAgree = bullish
      ? slopes.medium > 0 && slopes.long >= -0.0003
      : slopes.medium < 0 && slopes.long <= 0.0003;
    if (!slopesAgree) continue;
    patterns.push(Object.freeze({
      id: `ma-${direction}-expansion-${candles[confirmationIndex].time}`,
      kind: `${direction}-expansion`,
      name: bullish ? "多头排列向上发散" : "空头排列向下发散",
      bias: direction,
      startIndex: compressionIndex,
      confirmationIndex,
      endIndex: confirmationIndex,
      status: "confirmed",
      eligible: true,
      detail: `均线低宽度粘合后形成持续${bullish ? "多头" : "空头"}排列，带宽扩张且中长期斜率同向`,
    }));
  }
  return patterns;
}

function detectTrendRetests(candles, series) {
  const patterns = [];
  const latest = candles.length - 1;
  for (let confirmationIndex = Math.max(61, latest - 20); confirmationIndex <= latest; confirmationIndex += 1) {
    const retestIndex = confirmationIndex - 1;
    if (retestIndex < 60 || !Number.isFinite(series.medium[retestIndex])) continue;
    const atr = Number.isFinite(series.atr[retestIndex]) ? series.atr[retestIndex] : candles[retestIndex].close * 0.01;
    const tolerance = Math.max(atr * 0.25, candles[retestIndex].close * 0.001);
    const bullishContext = orderingPersists(series, retestIndex, "bullish", 3);
    const bearishContext = orderingPersists(series, retestIndex, "bearish", 3);
    const bullish = bullishContext
      && candles[retestIndex].low <= series.medium[retestIndex] + tolerance
      && candles[retestIndex].close >= series.medium[retestIndex]
      && candles[confirmationIndex].close > candles[retestIndex].high
      && candles[confirmationIndex].close > series.medium[confirmationIndex];
    const bearish = bearishContext
      && candles[retestIndex].high >= series.medium[retestIndex] - tolerance
      && candles[retestIndex].close <= series.medium[retestIndex]
      && candles[confirmationIndex].close < candles[retestIndex].low
      && candles[confirmationIndex].close < series.medium[confirmationIndex];
    if (!bullish && !bearish) continue;
    patterns.push(Object.freeze({
      id: `ma-${bullish ? "bullish-retest" : "bearish-rejection"}-${candles[confirmationIndex].time}`,
      kind: bullish ? "bullish-retest" : "bearish-rejection",
      name: bullish ? "回踩 MA20 企稳" : "反抽 MA20 受阻",
      bias: bullish ? "bullish" : "bearish",
      startIndex: retestIndex,
      retestIndex,
      confirmationIndex,
      endIndex: confirmationIndex,
      status: "confirmed",
      eligible: true,
      zone: Object.freeze({ lower: series.medium[retestIndex] - tolerance, upper: series.medium[retestIndex] + tolerance }),
      detail: bullish
        ? "多头排列内回踩 MA20 动态区域后收回，并由下一根已收盘 K 线突破回踩 K 线高点"
        : "空头排列内反抽 MA20 动态区域后受阻，并由下一根已收盘 K 线跌破反抽 K 线低点",
    }));
  }
  return patterns;
}

export function detectMovingAveragePatterns(candles, series) {
  const unique = new Map();
  for (const item of [
    ...detectPersistedCrossovers(candles, series),
    ...detectOrderedExpansions(candles, series),
    ...detectTrendRetests(candles, series),
  ]) unique.set(`${item.kind}:${item.confirmationIndex}`, item);
  return Object.freeze([...unique.values()]
    .sort((first, second) => first.confirmationIndex - second.confirmationIndex)
    .slice(-12));
}

function currentState(candles, series) {
  const latest = candles.length - 1;
  const slopes = slopeState(candles, series, latest);
  const ordering = orderingAt(series, latest);
  const stableBullish = orderingPersists(series, latest, "bullish", 3) && slopes.medium > 0 && slopes.long >= -0.0003;
  const stableBearish = orderingPersists(series, latest, "bearish", 3) && slopes.medium < 0 && slopes.long <= 0.0003;
  const percentile = series.spreadPercentile[latest];
  const close = candles[latest].close;
  const values = [series.short[latest], series.medium[latest], series.long[latest]];
  const priceLocation = close > Math.max(...values)
    ? "above-all"
    : close < Math.min(...values)
      ? "below-all"
      : "inside-ribbon";
  return Object.freeze({
    close,
    ma5: series.short[latest],
    ma20: series.medium[latest],
    ma60: series.long[latest],
    slopes,
    ordering,
    priceLocation,
    ribbonSpread: series.ribbonSpread[latest],
    spreadPercentile: percentile,
    trendRegime: stableBullish ? "bullish-alignment" : stableBearish ? "bearish-alignment" : percentile <= 0.2 ? "compression" : "mixed",
  });
}

function buildActionPlan(candles, series, patterns, state) {
  const latest = candles.at(-1);
  const primary = [...patterns].reverse().find((item) => item.eligible && candles.length - 1 - item.confirmationIndex <= 12);
  const ribbonValues = [state.ma5, state.ma20, state.ma60].filter(Number.isFinite);
  const waitZone = ribbonValues.length === 3
    ? Object.freeze({ lower: Math.min(...ribbonValues), upper: Math.max(...ribbonValues) })
    : undefined;
  if (!primary) return Object.freeze({
    primaryBias: state.trendRegime === "bullish-alignment" ? "bullish" : state.trendRegime === "bearish-alignment" ? "bearish" : "neutral",
    disposition: "wait",
    validityBars: 4,
    ...(waitZone ? { waitZone } : {}),
    confirmation: "等待顺应 MA60 背景的持续交叉、粘合后有序发散，或 MA20 回踩/反抽后的收盘确认；单次触线不执行",
    observeTrigger: "观察 MA5/MA20/MA60 排列与斜率、均线带宽是否扩张，以及价格能否在 MA20 动态区域外收盘",
  });
  const bullish = primary.bias === "bullish";
  const confirmationCandle = candles[primary.confirmationIndex];
  const structure = candles.slice(Math.max(0, primary.startIndex - 1), primary.confirmationIndex + 1);
  const rawStop = bullish
    ? Math.min(...structure.map((candle) => candle.low), series.medium[primary.confirmationIndex])
    : Math.max(...structure.map((candle) => candle.high), series.medium[primary.confirmationIndex]);
  const trigger = bullish
    ? Math.max(confirmationCandle.high, latest.close * 1.0005)
    : Math.min(confirmationCandle.low, latest.close * 0.9995);
  const fallbackStop = bullish
    ? Math.min(...candles.slice(-12).map((candle) => candle.low))
    : Math.max(...candles.slice(-12).map((candle) => candle.high));
  const stop = ((bullish && rawStop < trigger) || (!bullish && rawStop > trigger))
    ? rawStop
    : fallbackStop;
  const risk = Math.abs(trigger - stop);
  const targets = risk > Number.EPSILON
    ? (bullish ? [trigger + risk, trigger + risk * 2] : [trigger - risk, trigger - risk * 2]).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (!Number.isFinite(stop) || stop <= 0 || targets.length < 2) return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    disposition: "wait",
    validityBars: 4,
    ...(waitZone ? { waitZone } : {}),
    confirmation: "均线结构已确认，但当前价格尺度无法形成有效的正价格风险边界，暂不执行",
    observeTrigger: "等待后续已收盘 K 线形成可计算的触发、失效和目标后重新分析",
  });
  return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    currentPrice: latest.close,
    disposition: "wait",
    validityBars: 4,
    ...(waitZone ? { waitZone } : {}),
    ...(bullish
      ? { longTrigger: trigger, longInvalidation: stop, longTarget: targets[0], longTargets: Object.freeze(targets) }
      : { shortTrigger: trigger, shortInvalidation: stop, shortTarget: targets[0], shortTargets: Object.freeze(targets) }),
    confirmation: `等待已收盘 K 线${bullish ? "站上" : "跌破"} ${primary.name} 的再确认价，并保持在 MA20 动态区域${bullish ? "上方" : "下方"}`,
    observeTrigger: "触发前重新核对三线排列、MA60 斜率和结构失效位；均线重新粘合或形成反向排列时取消",
    sourcePatternId: primary.id,
  });
}

export function runMovingAverageAnalysisEngine(snapshot) {
  const closed = movingAverageClosedCandles(snapshot);
  if (closed.candles.length < 90) throw new TypeError("Moving average analysis requires at least 90 closed candles");
  const series = calculateMovingAverageSeries(closed.candles);
  const patterns = detectMovingAveragePatterns(closed.candles, series);
  const state = currentState(closed.candles, series);
  const compressionIndex = recentCompressionIndex(series, closed.candles.length - 1, 14);
  const recentCompression = compressionIndex >= 0 ? Object.freeze({
    id: `ma-compression-${closed.candles[compressionIndex].time}`,
    index: compressionIndex,
    time: closed.candles[compressionIndex].time,
    spread: series.ribbonSpread[compressionIndex],
    percentile: series.spreadPercentile[compressionIndex],
  }) : null;
  const evidence = [
    ...patterns.map((item) => ({ id: item.id, summary: `${item.name}：${item.detail}` })),
    ...(recentCompression ? [{ id: recentCompression.id, summary: `均线带宽低位：${recentCompression.spread}，百分位 ${recentCompression.percentile}` }] : []),
    { id: `ma-state-${closed.candles.at(-1).time}`, summary: `MA5 ${state.ma5}; MA20 ${state.ma20}; MA60 ${state.ma60}; ordering ${state.ordering}; spread ${state.ribbonSpread}` },
  ];
  return Object.freeze({
    engineId: MOVING_AVERAGE_ANALYSIS_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    parameters: MOVING_AVERAGE_PERIODS,
    closedCandleCount: closed.candles.length,
    excludedLiveCandles: closed.excludedLiveCandles,
    lastClosedCandle: closed.candles.at(-1),
    currentState: state,
    recentCompression,
    patterns,
    series,
    signals: Object.freeze(patterns.map((item) => Object.freeze({ direction: item.bias, strength: item.eligible ? 0.75 : 0.35, patternId: item.id }))),
    coverage: Object.freeze({ candles: "available", movingAverages: "available", volume: "unavailable" }),
    actionPlan: buildActionPlan(closed.candles, series, patterns, state),
    evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
