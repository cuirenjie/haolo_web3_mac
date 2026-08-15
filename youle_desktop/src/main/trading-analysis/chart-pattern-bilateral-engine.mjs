import {
  boundaryFromPoints,
  chartPatternId,
  chartPatternRound,
  clamp,
  findClosedBreakout,
  geometryScore,
  linePrice,
  pointRecords,
  projectedActionLevels,
  rankAndDeduplicateCandidates,
  resolvePatternLifecycle,
} from "./chart-pattern-common.mjs";

export const CHART_PATTERN_BILATERAL_SUBENGINE_ID = "chart-pattern-bilateral";
export const CHART_PATTERN_BILATERAL_SUBENGINE_VERSION = "1.1.0";
export const CHART_PATTERN_BILATERAL_IDS = Object.freeze([
  "symmetrical-triangle",
  "ascending-triangle",
  "descending-triangle",
  "rectangle",
]);

const NAMES = Object.freeze({
  "symmetrical-triangle": "对称三角形",
  "ascending-triangle": "上升三角形",
  "descending-triangle": "下降三角形",
  rectangle: "矩形整理",
});

function normalizedSlope(line, duration, height) {
  return line.slope * Math.max(1, duration) / Math.max(height, Number.EPSILON);
}

function maximumLineErrorAtr(points, line, atr) {
  return Math.max(...points.map((point) => Math.abs(point.price - linePrice(line, point.index))))
    / Math.max(Number(atr) || 0, Number.EPSILON);
}

function priceSpread(points) {
  return Math.max(...points.map((point) => point.price)) - Math.min(...points.map((point) => point.price));
}

function followsDirection(points, direction, tolerance) {
  return points.every((point, index) => {
    if (!index) return true;
    return direction === "down"
      ? point.price <= points[index - 1].price + tolerance
      : point.price >= points[index - 1].price - tolerance;
  });
}

function triangleApexIndex(upper, lower) {
  const slopeDifference = upper.slope - lower.slope;
  if (Math.abs(slopeDifference) <= Number.EPSILON) return null;
  const index = (lower.intercept - upper.intercept) / slopeDifference;
  return Number.isFinite(index) ? index : null;
}

export function evaluateBilateralPattern(snapshot, inputPoints, { atr, profileId = "direct" } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length < 4 || inputPoints.length > 8) return null;
  if (inputPoints.some((point, index) => index && point.type === inputPoints[index - 1].type)) return null;
  const highs = inputPoints.filter((point) => point.type === "high");
  const lows = inputPoints.filter((point) => point.type === "low");
  if (highs.length < 2 || lows.length < 2) return null;
  const upper = boundaryFromPoints(highs);
  const lower = boundaryFromPoints(lows);
  if (!upper || !lower) return null;
  const startIndex = inputPoints[0].index;
  const endIndex = inputPoints.at(-1).index;
  const duration = endIndex - startIndex;
  if (duration < 8 || duration > 180) return null;
  const startGap = linePrice(upper, startIndex) - linePrice(lower, startIndex);
  const endGap = linePrice(upper, endIndex) - linePrice(lower, endIndex);
  const height = Math.max(startGap, endGap);
  if (height < atr * 1.5 || startGap <= 0 || endGap <= 0) return null;
  const upperSlope = normalizedSlope(upper, duration, height);
  const lowerSlope = normalizedSlope(lower, duration, height);
  const upperErrorAtr = maximumLineErrorAtr(highs, upper, atr);
  const lowerErrorAtr = maximumLineErrorAtr(lows, lower, atr);
  const upperSpread = priceSpread(highs);
  const lowerSpread = priceSpread(lows);
  const directionTolerance = Math.max(atr * 0.15, height * 0.012);
  const flatSpreadLimit = Math.max(atr * 0.65, height * 0.065);
  const fallingHighs = followsDirection(highs, "down", directionTolerance);
  const risingLows = followsDirection(lows, "up", directionTolerance);
  const flat = 0.12;
  let patternId = null;
  if (
    Math.abs(upperSlope) <= flat
    && Math.abs(lowerSlope) <= flat
    && upperSpread <= flatSpreadLimit
    && lowerSpread <= flatSpreadLimit
    && upperErrorAtr <= 0.7
    && lowerErrorAtr <= 0.7
    && endGap >= startGap * 0.78
  ) {
    patternId = "rectangle";
  } else if (
    upperSlope < -0.18
    && lowerSlope > 0.18
    && fallingHighs
    && risingLows
    && upperErrorAtr <= 0.7
    && lowerErrorAtr <= 0.7
    && endGap <= startGap * 0.82
  ) {
    patternId = "symmetrical-triangle";
  } else if (
    Math.abs(upperSlope) <= flat
    && upperSpread <= flatSpreadLimit
    && lowerSlope > 0.22
    && risingLows
    && upperErrorAtr <= 0.7
    && lowerErrorAtr <= 0.7
    && endGap <= startGap * 0.85
  ) {
    patternId = "ascending-triangle";
  } else if (
    upperSlope < -0.22
    && fallingHighs
    && upperErrorAtr <= 0.7
    && Math.abs(lowerSlope) <= flat
    && lowerSpread <= flatSpreadLimit
    && lowerErrorAtr <= 0.7
    && endGap <= startGap * 0.85
  ) {
    patternId = "descending-triangle";
  }
  if (!patternId) return null;
  const triangle = patternId !== "rectangle";
  const apexIndex = triangle ? triangleApexIndex(upper, lower) : null;
  if (triangle && (
    !Number.isFinite(apexIndex)
    || apexIndex <= endIndex
    || apexIndex > startIndex + duration * 2.25
  )) return null;
  const upperAt = (index) => linePrice(upper, index);
  const lowerAt = (index) => linePrice(lower, index);
  const ageLimitBars = Math.max(4, Math.min(12, Math.round(duration * 0.35)));
  const breakoutSearchBars = triangle
    ? Math.max(1, Math.min(ageLimitBars, Math.floor(apexIndex - endIndex + 1)))
    : ageLimitBars;
  const breakout = findClosedBreakout(snapshot, endIndex, upperAt, lowerAt, atr, {
    allowedDirection: "both",
    maxSearchBars: breakoutSearchBars,
  });
  const direction = breakout.direction === "up" ? "bullish" : breakout.direction === "down" ? "bearish" : "neutral";
  const triggerIndex = breakout.index || endIndex + 1;
  const upperTrigger = upperAt(triggerIndex);
  const lowerTrigger = lowerAt(triggerIndex);
  const longLevels = projectedActionLevels({
    direction: "bullish",
    trigger: upperTrigger,
    oppositeBoundary: lowerTrigger,
    height,
    atr,
  });
  const shortLevels = projectedActionLevels({
    direction: "bearish",
    trigger: lowerTrigger,
    oppositeBoundary: upperTrigger,
    height,
    atr,
  });
  const actionLevels = direction === "bullish" ? longLevels : direction === "bearish" ? shortLevels : null;
  const lifecycleState = resolvePatternLifecycle(snapshot, {
    breakout,
    actionLevels,
    direction,
    lastStructureIndex: endIndex,
    structureDuration: duration,
    maxDevelopingAgeBars: ageLimitBars,
    maxConfirmedAgeBars: ageLimitBars,
  });
  const { lifecycle, tradeState } = lifecycleState;
  const records = pointRecords(inputPoints, inputPoints.map((point, index) => `${point.type === "high" ? "R" : "S"}${Math.floor(index / 2) + 1}`));
  const id = chartPatternId("chart-pattern", snapshot.snapshotId, patternId, records.map((point) => point.index).join("-"));
  const convergence = clamp(1 - endGap / startGap, 0, 1);
  const flatness = clamp(1 - Math.min(Math.abs(upperSlope), Math.abs(lowerSlope)) / flat, 0, 1);
  return Object.freeze({
    id,
    patternId,
    patternName: NAMES[patternId],
    category: "bilateral",
    direction,
    lifecycle,
    status: lifecycle === "confirmed" ? "confirmed" : "tentative",
    tradeState,
    points: records,
    boundaries: Object.freeze({ upper, lower }),
    height: chartPatternRound(height),
    breakout,
    longLevels,
    shortLevels,
    actionLevels,
    lifecycleState,
    score: geometryScore({
      symmetry: patternId === "rectangle" ? flatness : convergence,
      touches: records.length,
      fit: Math.max(0.45, (upper.r2 + lower.r2) / 2),
      recency: clamp(1 - (snapshot.candles.length - 1 - endIndex) / 80, 0, 1),
      confirmed: lifecycle === "confirmed",
    }),
    metrics: Object.freeze({
      upperSlope: chartPatternRound(upperSlope),
      lowerSlope: chartPatternRound(lowerSlope),
      convergence: chartPatternRound(convergence),
      upperTouches: highs.length,
      lowerTouches: lows.length,
      upperErrorAtr: chartPatternRound(upperErrorAtr),
      lowerErrorAtr: chartPatternRound(lowerErrorAtr),
      upperSpreadAtr: chartPatternRound(upperSpread / Math.max(atr, Number.EPSILON)),
      lowerSpreadAtr: chartPatternRound(lowerSpread / Math.max(atr, Number.EPSILON)),
      apexIndex: Number.isFinite(apexIndex) ? chartPatternRound(apexIndex) : null,
      breakoutSearchBars,
      signalAgeBars: lifecycleState.ageBars,
      terminalReason: lifecycleState.terminalReason,
    }),
    scan: Object.freeze({ profileId }),
    ruleIds: Object.freeze([
      `CHART-${patternId.toUpperCase()}-GEOMETRY`,
      "CHART-BILATERAL-NEUTRAL-BEFORE-BREAKOUT",
      "CHART-CLOSED-BREAKOUT",
      "CHART-FALSE-BREAKOUT",
      "CHART-HEIGHT-TARGET",
    ]),
    evidenceIds: Object.freeze([id, ...records.map((point) => point.id)]),
  });
}

export function runBilateralPatternSubengine(snapshot, scanContext) {
  const candidates = [];
  for (const profile of scanContext.profiles) {
    for (let length = 4; length <= 8; length += 1) {
      for (let index = 0; index <= profile.swings.length - length; index += 1) {
        const candidate = evaluateBilateralPattern(snapshot, profile.swings.slice(index, index + length), {
          atr: scanContext.atr,
          profileId: profile.id,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const ranked = rankAndDeduplicateCandidates(candidates);
  return Object.freeze({
    id: CHART_PATTERN_BILATERAL_SUBENGINE_ID,
    version: CHART_PATTERN_BILATERAL_SUBENGINE_VERSION,
    status: ranked.length ? "succeeded" : "insufficient_data",
    supportedPatternIds: CHART_PATTERN_BILATERAL_IDS,
    candidates: ranked,
  });
}
