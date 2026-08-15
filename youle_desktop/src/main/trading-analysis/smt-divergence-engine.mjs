import crypto from "node:crypto";

export const SMT_DIVERGENCE_ENGINE_ID = "smt-divergence";
export const SMT_DIVERGENCE_ENGINE_VERSION = "1.0.0";

function idFor(...parts) {
  return `smt-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 18)}`;
}

function intervalSeconds(interval) {
  const value = String(interval || "").toUpperCase();
  if (value === "1D") return 86_400;
  if (value === "1W") return 604_800;
  return Math.max(60, Number(value) * 60 || 3_600);
}

function closedCandles(candles, interval, snapshotTime) {
  const stepMs = intervalSeconds(interval) * 1_000;
  return candles.filter((item) => Number(item.time) * 1_000 + stepMs <= snapshotTime);
}

function returns(candles) {
  return candles.slice(1).map((item, index) => Math.log(item.close / candles[index].close));
}

function correlation(first, second) {
  const count = Math.min(first.length, second.length);
  if (count < 30) return null;
  const a = first.slice(-count);
  const b = second.slice(-count);
  const meanA = a.reduce((sum, value) => sum + value, 0) / count;
  const meanB = b.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let index = 0; index < count; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }
  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator > Number.EPSILON ? numerator / denominator : null;
}

function pivots(candles, radius = 2) {
  const items = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const window = candles.slice(index - radius, index + radius + 1);
    const current = candles[index];
    if (current.high === Math.max(...window.map((item) => item.high)) && window.filter((item) => item.high === current.high).length === 1) {
      items.push({ type: "high", index, time: current.time, price: current.high });
    }
    if (current.low === Math.min(...window.map((item) => item.low)) && window.filter((item) => item.low === current.low).length === 1) {
      items.push({ type: "low", index, time: current.time, price: current.low });
    }
  }
  return items;
}

function nearest(pivotItems, type, targetIndex, maximumDistance = 5) {
  return pivotItems
    .filter((item) => item.type === type && Math.abs(item.index - targetIndex) <= maximumDistance)
    .sort((first, second) => Math.abs(first.index - targetIndex) - Math.abs(second.index - targetIndex))[0] || null;
}

function divergenceCandidate(type, primaryPivots, comparisonPivots, primaryCandles, comparisonCandles, tolerance = 0.00025) {
  const primaryType = primaryPivots.filter((item) => item.type === type);
  for (let index = primaryType.length - 1; index >= 1; index -= 1) {
    const currentPrimary = primaryType[index];
    const previousPrimary = primaryType[index - 1];
    const currentComparison = nearest(comparisonPivots, type, currentPrimary.index);
    const previousComparison = nearest(comparisonPivots, type, previousPrimary.index);
    if (!currentComparison || !previousComparison) continue;
    const primaryRatio = currentPrimary.price / previousPrimary.price;
    const comparisonRatio = currentComparison.price / previousComparison.price;
    const higher = type === "high";
    const primaryTakes = higher ? primaryRatio > 1 + tolerance : primaryRatio < 1 - tolerance;
    const comparisonTakes = higher ? comparisonRatio > 1 + tolerance : comparisonRatio < 1 - tolerance;
    if (primaryTakes === comparisonTakes) continue;
    const direction = higher ? "bearish" : "bullish";
    const leader = primaryTakes ? "primary" : "comparison";
    return {
      id: idFor(type, currentPrimary.time, currentComparison.time, direction, leader),
      type: direction,
      extreme: type,
      leader,
      primary: { previous: previousPrimary, current: currentPrimary, ratio: primaryRatio },
      comparison: { previous: previousComparison, current: currentComparison, ratio: comparisonRatio },
      ageBars: primaryCandles.length - 1 - currentPrimary.index,
      status: "confirmed",
      explanation: `${leader === "primary" ? "主市场" : "对照市场"}${higher ? "创出更高高点" : "创出更低低点"}，另一市场未同步确认`,
      evidenceTime: Math.max(primaryCandles[currentPrimary.index]?.time || 0, comparisonCandles[currentComparison.index]?.time || 0),
    };
  }
  return null;
}

function alignedCandles(primary, comparison) {
  const byTime = new Map(comparison.map((item) => [item.time, item]));
  const pairs = primary.flatMap((item) => byTime.has(item.time) ? [[item, byTime.get(item.time)]] : []);
  return { primary: pairs.map((item) => item[0]), comparison: pairs.map((item) => item[1]) };
}

export function runSmtDivergenceEngine(snapshot, comparisonMarkets = []) {
  const primaryClosed = closedCandles(snapshot.candles, snapshot.interval, snapshot.snapshotTime);
  const correlated = comparisonMarkets.find((item) => item.kind === "correlated-market") || null;
  const venue = comparisonMarkets.find((item) => item.kind === "venue-confirmation") || null;
  if (!correlated) {
    return { engineId: SMT_DIVERGENCE_ENGINE_ID, engineVersion: SMT_DIVERGENCE_ENGINE_VERSION, status: "insufficient_data", currentSignal: null, signals: [], evidence: [], coverage: { primaryCandles: primaryClosed.length >= 60 ? "available" : "partial", comparisonCandles: "unavailable", venueConfirmation: venue ? "available" : "unavailable" }, reason: "缺少相关市场的同周期已收盘 K 线" };
  }
  const comparisonClosed = closedCandles(correlated.candles, snapshot.interval, snapshot.snapshotTime);
  const aligned = alignedCandles(primaryClosed, comparisonClosed);
  const sample = Math.min(160, aligned.primary.length);
  const corr = correlation(returns(aligned.primary.slice(-sample)), returns(aligned.comparison.slice(-sample)));
  const alignmentRatio = primaryClosed.length ? aligned.primary.length / Math.min(primaryClosed.length, comparisonClosed.length || primaryClosed.length) : 0;
  const validPair = aligned.primary.length >= 60 && alignmentRatio >= 0.85 && corr !== null && corr >= 0.45;
  const primaryPivots = pivots(aligned.primary);
  const comparisonPivots = pivots(aligned.comparison);
  const high = validPair ? divergenceCandidate("high", primaryPivots, comparisonPivots, aligned.primary, aligned.comparison) : null;
  const low = validPair ? divergenceCandidate("low", primaryPivots, comparisonPivots, aligned.primary, aligned.comparison) : null;
  const signals = [high, low].filter(Boolean).sort((first, second) => first.ageBars - second.ageBars);
  const currentSignal = signals.find((item) => item.ageBars <= 18) || null;
  let venueCorrelation = null;
  if (venue) {
    const venueClosed = closedCandles(venue.candles, snapshot.interval, snapshot.snapshotTime);
    const venueAligned = alignedCandles(primaryClosed, venueClosed);
    venueCorrelation = correlation(returns(venueAligned.primary.slice(-160)), returns(venueAligned.comparison.slice(-160)));
  }
  const evidence = [
    { id: idFor("pair", snapshot.marketId, correlated.marketId), summary: `${snapshot.marketId} 与 ${correlated.marketId} 对齐 ${aligned.primary.length} 根，收益相关系数 ${corr === null ? "不可用" : corr.toFixed(3)}` },
    ...(currentSignal ? [{ id: currentSignal.id, summary: `${currentSignal.type} SMT：${currentSignal.explanation}` }] : []),
    ...(venue ? [{ id: idFor("venue", venue.marketId), summary: `Hyperliquid 同品种跨场所相关系数 ${venueCorrelation === null ? "不可用" : venueCorrelation.toFixed(3)}，仅作数据质量校验` }] : []),
  ];
  return {
    engineId: SMT_DIVERGENCE_ENGINE_ID,
    engineVersion: SMT_DIVERGENCE_ENGINE_VERSION,
    status: validPair ? "succeeded" : "insufficient_data",
    pair: { primaryMarketId: snapshot.marketId, comparisonMarketId: correlated.marketId, comparisonSymbol: correlated.symbol, source: correlated.source },
    statistics: { alignedCandleCount: aligned.primary.length, alignmentRatio, correlation: corr, venueCorrelation, pivotRadius: 2, correlationThreshold: 0.45, maximumSignalAgeBars: 18 },
    currentSignal,
    signals,
    evidence,
    coverage: { primaryCandles: primaryClosed.length >= 60 ? "available" : "partial", comparisonCandles: validPair ? "available" : aligned.primary.length ? "partial" : "unavailable", venueConfirmation: venueCorrelation !== null && venueCorrelation >= 0.8 ? "available" : venue ? "partial" : "unavailable" },
    reason: validPair ? currentSignal ? currentSignal.explanation : "相关性与时间对齐合格，但最近 18 根内没有已确认 SMT 背离" : "相关市场样本、时间对齐或收益相关性未达到门槛",
  };
}
