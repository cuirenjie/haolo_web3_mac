import crypto from "node:crypto";

export const CHART_PATTERN_SCAN_PROFILES = Object.freeze([
  Object.freeze({ id: "fine", radius: 2, thresholdAtr: 0.3, minimumCandles: 60 }),
  Object.freeze({ id: "standard", radius: 3, thresholdAtr: 0.45, minimumCandles: 60 }),
  Object.freeze({ id: "structural", radius: 5, thresholdAtr: 0.65, minimumCandles: 100 }),
  Object.freeze({ id: "macro", radius: 8, thresholdAtr: 0.9, minimumCandles: 180 }),
]);

export function chartPatternId(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

export function chartPatternRound(value) {
  return Number(Number(value).toPrecision(12));
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

export function averageTrueRange(candles, period = 14) {
  const ranges = candles.map((candle, index) => {
    const previousClose = index ? candles[index - 1].close : candle.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return average(ranges.slice(-Math.min(period, ranges.length)));
}

export function linearRegression(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const xs = points.map((point) => Number(point.index));
  const ys = points.map((point) => Number(point.price));
  const xMean = average(xs);
  const yMean = average(ys);
  const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (denominator <= Number.EPSILON) return null;
  const slope = xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const total = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const residual = ys.reduce((sum, value, index) => sum + (value - (intercept + slope * xs[index])) ** 2, 0);
  return Object.freeze({
    slope: chartPatternRound(slope),
    intercept: chartPatternRound(intercept),
    r2: total <= Number.EPSILON ? 1 : chartPatternRound(clamp(1 - residual / total, 0, 1)),
  });
}

export function linePrice(line, index) {
  return chartPatternRound(line.intercept + line.slope * index);
}

function localSwings(snapshot, radius, atr) {
  const swings = [];
  const candles = snapshot.candles;
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const neighbors = candles.slice(index - radius, index + radius + 1);
    const other = neighbors.filter((_, offset) => offset !== radius);
    const isHigh = other.every((item) => candle.high >= item.high)
      && other.some((item) => candle.high > item.high);
    const isLow = other.every((item) => candle.low <= item.low)
      && other.some((item) => candle.low < item.low);
    if (!isHigh && !isLow) continue;
    const highProminence = isHigh ? candle.high - Math.max(...other.map((item) => item.high)) : -Infinity;
    const lowProminence = isLow ? Math.min(...other.map((item) => item.low)) - candle.low : -Infinity;
    const type = highProminence >= lowProminence ? "high" : "low";
    const price = type === "high" ? candle.high : candle.low;
    swings.push(Object.freeze({
      id: chartPatternId("chart-pattern-pivot", snapshot.snapshotId, radius, index, type, price),
      index,
      time: candle.time,
      price: chartPatternRound(price),
      type,
      status: "confirmed",
      prominenceAtr: atr > 0 ? chartPatternRound(Math.max(highProminence, lowProminence, 0) / atr) : 0,
    }));
  }
  return swings;
}

function compactSwings(snapshot, rawSwings, atr, thresholdAtr) {
  const threshold = Math.max(atr * thresholdAtr, snapshot.candles.at(-1).close * 0.0008);
  const compacted = [];
  for (const swing of rawSwings) {
    const previous = compacted.at(-1);
    if (!previous) {
      compacted.push(swing);
      continue;
    }
    if (previous.type === swing.type) {
      const moreExtreme = swing.type === "high" ? swing.price >= previous.price : swing.price <= previous.price;
      if (moreExtreme) compacted[compacted.length - 1] = swing;
      continue;
    }
    if (Math.abs(swing.price - previous.price) >= threshold) compacted.push(swing);
  }
  return Object.freeze(compacted);
}

export function buildChartPatternScanProfiles(snapshot) {
  const atr = averageTrueRange(snapshot.candles);
  const profiles = CHART_PATTERN_SCAN_PROFILES
    .filter((profile) => snapshot.candles.length >= profile.minimumCandles)
    .map((profile) => {
      const rawSwings = localSwings(snapshot, profile.radius, atr);
      return Object.freeze({
        ...profile,
        rawCount: rawSwings.length,
        swings: compactSwings(snapshot, rawSwings, atr, profile.thresholdAtr),
      });
    });
  return Object.freeze({ atr: chartPatternRound(atr), profiles: Object.freeze(profiles) });
}

export function priorTrend(snapshot, startIndex, direction, atr, { minimumBars = 12, maximumBars = 50 } = {}) {
  const end = Math.max(0, Number(startIndex));
  const start = Math.max(0, end - maximumBars);
  const candles = snapshot.candles.slice(start, end);
  if (candles.length < minimumBars) return Object.freeze({ matches: false, direction: "neutral", strengthAtr: 0, slope: 0 });
  const line = linearRegression(candles.map((candle, offset) => ({ index: start + offset, price: candle.close })));
  const change = line ? line.slope * Math.max(1, candles.length - 1) : 0;
  const normalized = atr > 0 ? change / atr : 0;
  const actual = normalized > 1.5 ? "up" : normalized < -1.5 ? "down" : "neutral";
  return Object.freeze({
    matches: actual === direction,
    direction: actual,
    strengthAtr: chartPatternRound(Math.abs(normalized)),
    slope: line?.slope || 0,
  });
}

export function pointRecords(points, labels = []) {
  return Object.freeze(points.map((point, index) => Object.freeze({
    id: point.id || chartPatternId("chart-pattern-point", point.index, point.type, point.price),
    label: labels[index] || `P${index + 1}`,
    index: point.index,
    time: point.time,
    price: chartPatternRound(point.price),
    type: point.type,
    status: point.status || "confirmed",
  })));
}

export function boundaryFromPoints(points) {
  const line = linearRegression(points);
  if (!line) return null;
  return Object.freeze({
    ...line,
    touches: points.length,
    startIndex: points[0].index,
    endIndex: points.at(-1).index,
    startTime: points[0].time,
    endTime: points.at(-1).time,
  });
}

export function findClosedBreakout(snapshot, afterIndex, upperBoundary, lowerBoundary, atr, {
  allowedDirection = "both",
  falseBreakBars = 3,
  maxSearchBars = Number.POSITIVE_INFINITY,
} = {}) {
  const boundaryValue = (boundary, index) => {
    if (typeof boundary === "function") return Number(boundary(index));
    if (boundary === null || boundary === undefined || boundary === "") return Number.NaN;
    return Number(boundary);
  };
  const buffer = Math.max(Number(atr || 0) * 0.12, snapshot.candles.at(-1).close * 0.0004);
  const lastSearchIndex = Number.isFinite(maxSearchBars)
    ? Math.min(snapshot.candles.length - 1, afterIndex + Math.max(1, Math.floor(maxSearchBars)))
    : snapshot.candles.length - 1;
  for (let index = afterIndex + 1; index <= lastSearchIndex; index += 1) {
    const candle = snapshot.candles[index];
    const upper = boundaryValue(upperBoundary, index);
    const lower = boundaryValue(lowerBoundary, index);
    const direction = allowedDirection !== "down" && Number.isFinite(upper) && candle.close > upper + buffer
      ? "up"
      : allowedDirection !== "up" && Number.isFinite(lower) && candle.close < lower - buffer
        ? "down"
        : null;
    if (!direction) continue;
    const boundaryAt = direction === "up" ? upper : lower;
    const followThrough = snapshot.candles.slice(index + 1, index + 1 + falseBreakBars);
    const failedAt = followThrough.findIndex((item, offset) => {
      const futureIndex = index + 1 + offset;
      const futureBoundary = direction === "up"
        ? boundaryValue(upperBoundary, futureIndex)
        : boundaryValue(lowerBoundary, futureIndex);
      return direction === "up" ? item.close < futureBoundary : item.close > futureBoundary;
    });
    return Object.freeze({
      state: failedAt >= 0 ? "failed" : "confirmed",
      direction,
      index,
      time: candle.time,
      close: chartPatternRound(candle.close),
      boundary: chartPatternRound(boundaryAt),
      buffer: chartPatternRound(buffer),
      failedAtIndex: failedAt >= 0 ? index + 1 + failedAt : null,
    });
  }
  return Object.freeze({ state: "developing", direction: "neutral", buffer: chartPatternRound(buffer) });
}

export function projectedActionLevels({ direction, trigger, oppositeBoundary, height, atr, multiplier = 1 }) {
  const bullish = direction === "bullish";
  const buffer = Math.max(Number(atr || 0) * 0.25, Number(height || 0) * 0.03);
  const stop = bullish ? oppositeBoundary - buffer : oppositeBoundary + buffer;
  const signed = bullish ? 1 : -1;
  return Object.freeze({
    trigger: chartPatternRound(trigger),
    stop: chartPatternRound(stop),
    targets: Object.freeze([
      chartPatternRound(trigger + signed * height * 0.618 * multiplier),
      chartPatternRound(trigger + signed * height * multiplier),
    ]),
  });
}

function firstMatchingIndex(candles, predicate) {
  const offset = candles.findIndex(predicate);
  return offset < 0 ? null : offset;
}

export function resolvePatternLifecycle(snapshot, {
  breakout,
  actionLevels,
  direction,
  lastStructureIndex,
  structureDuration,
  maxDevelopingAgeBars = null,
  maxConfirmedAgeBars = null,
} = {}) {
  const latestIndex = snapshot.candles.length - 1;
  const duration = Math.max(1, Number(structureDuration) || 1);
  const developingLimit = Number.isFinite(maxDevelopingAgeBars)
    ? Math.max(1, Math.floor(maxDevelopingAgeBars))
    : Math.max(4, Math.min(12, Math.round(duration * 0.35)));
  const confirmedLimit = Number.isFinite(maxConfirmedAgeBars)
    ? Math.max(1, Math.floor(maxConfirmedAgeBars))
    : Math.max(4, Math.min(12, Math.round(duration * 0.35)));
  if (!breakout || breakout.state === "developing") {
    const ageBars = Math.max(0, latestIndex - Number(lastStructureIndex || 0));
    return Object.freeze({
      lifecycle: ageBars > developingLimit ? "expired" : "developing",
      tradeState: ageBars > developingLimit ? "expired" : "awaiting-breakout",
      ageBars,
      ageLimitBars: developingLimit,
      terminalIndex: ageBars > developingLimit ? latestIndex : null,
      terminalReason: ageBars > developingLimit ? "structure-stale-before-breakout" : null,
    });
  }
  if (breakout.state === "failed") {
    return Object.freeze({
      lifecycle: "failed",
      tradeState: "invalidated",
      ageBars: Math.max(0, latestIndex - breakout.index),
      ageLimitBars: confirmedLimit,
      terminalIndex: breakout.failedAtIndex,
      terminalReason: "false-breakout",
    });
  }
  const bullish = direction === "bullish";
  const candles = snapshot.candles.slice(breakout.index + 1);
  const buffer = Math.max(Number(breakout.buffer || 0), Number(actionLevels?.trigger || 0) * 0.0002);
  const trigger = Number(actionLevels?.trigger);
  const stop = Number(actionLevels?.stop);
  const [target1, target2] = Array.isArray(actionLevels?.targets) ? actionLevels.targets : [];
  const target2Offset = firstMatchingIndex(candles, (candle) => (
    Number.isFinite(target2) && (bullish ? candle.high >= target2 : candle.low <= target2)
  ));
  const target1Offset = firstMatchingIndex(candles, (candle) => (
    Number.isFinite(target1) && (bullish ? candle.high >= target1 : candle.low <= target1)
  ));
  const stopOffset = firstMatchingIndex(candles, (candle) => (
    Number.isFinite(stop) && (bullish ? candle.close <= stop : candle.close >= stop)
  ));
  const reentryOffset = firstMatchingIndex(candles, (candle) => (
    Number.isFinite(trigger) && (bullish ? candle.close < trigger - buffer : candle.close > trigger + buffer)
  ));
  const terminalOffset = [stopOffset, reentryOffset]
    .filter(Number.isInteger)
    .sort((first, second) => first - second)[0] ?? null;
  if (Number.isInteger(target2Offset) && (!Number.isInteger(terminalOffset) || target2Offset < terminalOffset)) {
    return Object.freeze({
      lifecycle: "completed",
      tradeState: "completed",
      ageBars: latestIndex - breakout.index,
      ageLimitBars: confirmedLimit,
      terminalIndex: breakout.index + 1 + target2Offset,
      terminalReason: "second-target-reached",
    });
  }
  if (Number.isInteger(terminalOffset)) {
    return Object.freeze({
      lifecycle: "invalidated",
      tradeState: "invalidated",
      ageBars: latestIndex - breakout.index,
      ageLimitBars: confirmedLimit,
      terminalIndex: breakout.index + 1 + terminalOffset,
      terminalReason: terminalOffset === stopOffset ? "structural-stop-crossed" : "closed-back-inside-trigger",
    });
  }
  if (Number.isInteger(target1Offset)) {
    return Object.freeze({
      lifecycle: "partial-target-reached",
      tradeState: "partial-target-reached",
      ageBars: latestIndex - breakout.index,
      ageLimitBars: confirmedLimit,
      terminalIndex: breakout.index + 1 + target1Offset,
      terminalReason: "first-target-reached",
    });
  }
  const ageBars = Math.max(0, latestIndex - breakout.index);
  if (ageBars > confirmedLimit) {
    return Object.freeze({
      lifecycle: "expired",
      tradeState: "expired",
      ageBars,
      ageLimitBars: confirmedLimit,
      terminalIndex: latestIndex,
      terminalReason: "confirmed-signal-stale",
    });
  }
  return Object.freeze({
    lifecycle: "confirmed",
    tradeState: "active",
    ageBars,
    ageLimitBars: confirmedLimit,
    terminalIndex: null,
    terminalReason: null,
  });
}

export function geometryScore({ symmetry = 0.7, touches = 4, fit = 0.7, recency = 0.5, confirmed = false } = {}) {
  return chartPatternRound(
    clamp(symmetry, 0, 1) * 0.3
    + clamp(touches / 6, 0, 1) * 0.2
    + clamp(fit, 0, 1) * 0.25
    + clamp(recency, 0, 1) * 0.1
    + (confirmed ? 0.15 : 0),
  );
}

function candidateRank(candidate) {
  const lifecycle = candidate.lifecycle === "confirmed" ? 3 : candidate.lifecycle === "developing" ? 2 : 0;
  return lifecycle * 10 + Number(candidate.score || 0);
}

export function rankAndDeduplicateCandidates(candidates, limit = 16) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.patternId}:${candidate.points.map((point) => point.index).join("-")}`;
    const previous = byKey.get(key);
    if (!previous || candidateRank(candidate) > candidateRank(previous)) byKey.set(key, candidate);
  }
  return Object.freeze([...byKey.values()]
    .sort((first, second) => candidateRank(second) - candidateRank(first)
      || second.points.at(-1).index - first.points.at(-1).index)
    .slice(0, limit));
}

export function candidateEvidence(candidate) {
  return Object.freeze([
    Object.freeze({
      id: candidate.id,
      summary: `${candidate.patternName} ${candidate.category} ${candidate.lifecycle}，触点 ${candidate.points.length}，得分 ${candidate.score}`,
    }),
    ...candidate.ruleIds.map((ruleId) => Object.freeze({ id: ruleId, summary: `${candidate.patternName} 确定性规则` })),
  ]);
}
