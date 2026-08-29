import {
  boundaryFromPoints,
  chartPatternId,
  chartPatternRound,
  clamp,
  findClosedBreakout,
  geometryScore,
  linePrice,
  pointRecords,
  priorTrend,
  projectedActionLevels,
  rankAndDeduplicateCandidates,
  resolvePatternLifecycle,
} from "./chart-pattern-common.mjs";

export const CHART_PATTERN_REVERSAL_SUBENGINE_ID = "chart-pattern-reversal";
export const CHART_PATTERN_REVERSAL_SUBENGINE_VERSION = "1.1.0";
export const CHART_PATTERN_REVERSAL_IDS = Object.freeze([
  "head-and-shoulders-top",
  "inverse-head-and-shoulders",
  "double-top",
  "double-bottom",
  "triple-top",
  "triple-bottom",
  "rising-wedge",
  "falling-wedge",
]);

const NAMES = Object.freeze({
  "head-and-shoulders-top": "头肩顶",
  "inverse-head-and-shoulders": "头肩底",
  "double-top": "双顶",
  "double-bottom": "双底",
  "triple-top": "三重顶",
  "triple-bottom": "三重底",
  "rising-wedge": "上升楔形",
  "falling-wedge": "下降楔形",
});

function recency(snapshot, index) {
  return clamp(1 - (snapshot.candles.length - 1 - index) / 80, 0, 1);
}

function breakoutWindow(points) {
  const duration = Math.max(1, points.at(-1).index - points[0].index);
  return Math.max(4, Math.min(12, Math.round(duration * 0.35)));
}

function reversalCandidate(snapshot, {
  patternId,
  direction,
  points,
  labels,
  neckline,
  oppositeBoundary,
  height,
  atr,
  breakout,
  score,
  profileId,
  boundaries = null,
  metrics = {},
}) {
  const trigger = breakout.state === "confirmed" ? breakout.boundary : neckline;
  const actionLevels = projectedActionLevels({ direction, trigger, oppositeBoundary, height, atr });
  const duration = Math.max(1, points.at(-1).index - points[0].index);
  const ageLimitBars = breakoutWindow(points);
  const lifecycleState = resolvePatternLifecycle(snapshot, {
    breakout,
    actionLevels,
    direction,
    lastStructureIndex: points.at(-1).index,
    structureDuration: duration,
    maxDevelopingAgeBars: ageLimitBars,
    maxConfirmedAgeBars: ageLimitBars,
  });
  const { lifecycle, tradeState } = lifecycleState;
  const records = pointRecords(points, labels);
  const id = chartPatternId("chart-pattern", snapshot.snapshotId, patternId, records.map((point) => point.index).join("-"));
  return Object.freeze({
    id,
    patternId,
    patternName: NAMES[patternId],
    category: "reversal",
    direction,
    lifecycle,
    status: lifecycle === "confirmed" ? "confirmed" : "tentative",
    tradeState,
    points: records,
    neckline: chartPatternRound(neckline),
    boundaries,
    height: chartPatternRound(height),
    breakout,
    actionLevels,
    lifecycleState,
    score: chartPatternRound(score),
    metrics: Object.freeze({
      ...metrics,
      signalAgeBars: lifecycleState.ageBars,
      terminalReason: lifecycleState.terminalReason,
    }),
    scan: Object.freeze({ profileId }),
    ruleIds: Object.freeze([
      `CHART-${patternId.toUpperCase()}-GEOMETRY`,
      "CHART-PRIOR-TREND",
      "CHART-CLOSED-BREAKOUT",
      "CHART-FALSE-BREAKOUT",
      "CHART-HEIGHT-TARGET",
    ]),
    evidenceIds: Object.freeze([id, ...records.map((point) => point.id)]),
  });
}

export function evaluateDoubleReversal(snapshot, inputPoints, { atr, profileId = "direct" } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length !== 3) return null;
  const points = inputPoints;
  if (points.some((point, index) => index && point.index <= points[index - 1].index)) return null;
  const top = points[0].type === "high" && points[1].type === "low" && points[2].type === "high";
  const bottom = points[0].type === "low" && points[1].type === "high" && points[2].type === "low";
  if (!top && !bottom) return null;
  const extremeAverage = (points[0].price + points[2].price) / 2;
  const depth = top ? extremeAverage - points[1].price : points[1].price - extremeAverage;
  const tolerance = Math.max(atr * 0.8, depth * 0.2);
  if (depth < atr * 1.5 || Math.abs(points[0].price - points[2].price) > tolerance) return null;
  if (points[2].index - points[0].index < 6 || points[2].index - points[0].index > 120) return null;
  const trend = priorTrend(snapshot, points[0].index, top ? "up" : "down", atr);
  if (!trend.matches) return null;
  const neckline = points[1].price;
  const breakout = findClosedBreakout(
    snapshot,
    points[2].index,
    top ? null : neckline,
    top ? neckline : null,
    atr,
    {
      allowedDirection: top ? "down" : "up",
      maxSearchBars: breakoutWindow(points),
    },
  );
  const symmetry = clamp(1 - Math.abs(points[0].price - points[2].price) / tolerance, 0, 1);
  return reversalCandidate(snapshot, {
    patternId: top ? "double-top" : "double-bottom",
    direction: top ? "bearish" : "bullish",
    points,
    labels: top ? ["T1", "N", "T2"] : ["B1", "N", "B2"],
    neckline,
    oppositeBoundary: top ? Math.max(points[0].price, points[2].price) : Math.min(points[0].price, points[2].price),
    height: depth,
    atr,
    breakout,
    score: geometryScore({ symmetry, touches: 3, fit: 0.8, recency: recency(snapshot, points[2].index), confirmed: breakout.state === "confirmed" }),
    profileId,
    metrics: { priorTrend: trend, symmetry: chartPatternRound(symmetry) },
  });
}

export function evaluateFivePointReversal(snapshot, inputPoints, { atr, profileId = "direct" } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length !== 5) return Object.freeze([]);
  const points = inputPoints;
  const top = points.every((point, index) => point.type === (index % 2 === 0 ? "high" : "low"));
  const bottom = points.every((point, index) => point.type === (index % 2 === 0 ? "low" : "high"));
  if (!top && !bottom) return Object.freeze([]);
  const trend = priorTrend(snapshot, points[0].index, top ? "up" : "down", atr);
  if (!trend.matches) return Object.freeze([]);
  const extrema = [points[0], points[2], points[4]];
  const reactions = [points[1], points[3]];
  const averageExtreme = extrema.reduce((sum, point) => sum + point.price, 0) / 3;
  const neckline = (reactions[0].price + reactions[1].price) / 2;
  const height = Math.abs(averageExtreme - neckline);
  if (height < atr * 1.75 || points[4].index - points[0].index < 10 || points[4].index - points[0].index > 180) {
    return Object.freeze([]);
  }
  const necklineLine = boundaryFromPoints(reactions);
  if (!necklineLine) return Object.freeze([]);
  const lowerAt = (index) => linePrice(necklineLine, index);
  const upperAt = (index) => linePrice(necklineLine, index);
  const breakout = findClosedBreakout(snapshot, points[4].index, upperAt, lowerAt, atr, {
    allowedDirection: top ? "down" : "up",
    maxSearchBars: breakoutWindow(points),
  });
  const tolerance = Math.max(atr, height * 0.18);
  const results = [];
  const allEqual = Math.max(...extrema.map((point) => point.price)) - Math.min(...extrema.map((point) => point.price)) <= tolerance;
  if (allEqual) {
    const symmetry = clamp(1 - (Math.max(...extrema.map((point) => point.price)) - Math.min(...extrema.map((point) => point.price))) / tolerance, 0, 1);
    results.push(reversalCandidate(snapshot, {
      patternId: top ? "triple-top" : "triple-bottom",
      direction: top ? "bearish" : "bullish",
      points,
      labels: top ? ["T1", "N1", "T2", "N2", "T3"] : ["B1", "N1", "B2", "N2", "B3"],
      neckline: linePrice(necklineLine, points[4].index + 1),
      oppositeBoundary: top ? Math.max(...extrema.map((point) => point.price)) : Math.min(...extrema.map((point) => point.price)),
      height,
      atr,
      breakout,
      score: geometryScore({ symmetry, touches: 5, fit: necklineLine.r2, recency: recency(snapshot, points[4].index), confirmed: breakout.state === "confirmed" }),
      profileId,
      boundaries: Object.freeze({ neckline: necklineLine }),
      metrics: { priorTrend: trend, symmetry: chartPatternRound(symmetry) },
    }));
  }
  const shouldersEqual = Math.abs(points[0].price - points[4].price) <= tolerance;
  const headExcess = top
    ? points[2].price - Math.max(points[0].price, points[4].price)
    : Math.min(points[0].price, points[4].price) - points[2].price;
  if (shouldersEqual && headExcess >= Math.max(atr * 0.45, height * 0.08)) {
    const symmetry = clamp(1 - Math.abs(points[0].price - points[4].price) / tolerance, 0, 1);
    const headHeight = Math.abs(points[2].price - linePrice(necklineLine, points[2].index));
    results.push(reversalCandidate(snapshot, {
      patternId: top ? "head-and-shoulders-top" : "inverse-head-and-shoulders",
      direction: top ? "bearish" : "bullish",
      points,
      labels: ["LS", "N1", "H", "N2", "RS"],
      neckline: linePrice(necklineLine, points[4].index + 1),
      oppositeBoundary: top ? Math.max(points[0].price, points[4].price) : Math.min(points[0].price, points[4].price),
      height: headHeight,
      atr,
      breakout,
      score: geometryScore({ symmetry, touches: 5, fit: necklineLine.r2, recency: recency(snapshot, points[4].index), confirmed: breakout.state === "confirmed" }) + 0.03,
      profileId,
      boundaries: Object.freeze({ neckline: necklineLine }),
      metrics: { priorTrend: trend, shoulderSymmetry: chartPatternRound(symmetry), headExcess: chartPatternRound(headExcess) },
    }));
  }
  return Object.freeze(results);
}

export function evaluateWedgeReversal(snapshot, inputPoints, { atr, profileId = "direct" } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length < 5 || inputPoints.length > 8) return null;
  if (inputPoints.some((point, index) => index && point.type === inputPoints[index - 1].type)) return null;
  const highs = inputPoints.filter((point) => point.type === "high");
  const lows = inputPoints.filter((point) => point.type === "low");
  if (highs.length < 2 || lows.length < 2) return null;
  const upper = boundaryFromPoints(highs);
  const lower = boundaryFromPoints(lows);
  if (!upper || !lower) return null;
  const startIndex = inputPoints[0].index;
  const endIndex = inputPoints.at(-1).index;
  const startGap = linePrice(upper, startIndex) - linePrice(lower, startIndex);
  const endGap = linePrice(upper, endIndex) - linePrice(lower, endIndex);
  if (startGap <= atr || endGap <= 0 || endGap >= startGap * 0.78) return null;
  const rising = upper.slope > 0 && lower.slope > 0 && lower.slope > upper.slope;
  const falling = upper.slope < 0 && lower.slope < 0 && upper.slope < lower.slope;
  if (!rising && !falling) return null;
  const trend = priorTrend(snapshot, startIndex, rising ? "up" : "down", atr);
  if (!trend.matches) return null;
  const breakout = findClosedBreakout(
    snapshot,
    endIndex,
    (index) => linePrice(upper, index),
    (index) => linePrice(lower, index),
    atr,
    { allowedDirection: rising ? "down" : "up", maxSearchBars: breakoutWindow(inputPoints) },
  );
  const direction = rising ? "bearish" : "bullish";
  const trigger = rising ? linePrice(lower, endIndex + 1) : linePrice(upper, endIndex + 1);
  const opposite = rising ? linePrice(upper, endIndex + 1) : linePrice(lower, endIndex + 1);
  const convergence = clamp(1 - endGap / startGap, 0, 1);
  return reversalCandidate(snapshot, {
    patternId: rising ? "rising-wedge" : "falling-wedge",
    direction,
    points: inputPoints,
    labels: inputPoints.map((_, index) => `P${index + 1}`),
    neckline: trigger,
    oppositeBoundary: opposite,
    height: startGap,
    atr,
    breakout,
    score: geometryScore({ symmetry: convergence, touches: inputPoints.length, fit: (upper.r2 + lower.r2) / 2, recency: recency(snapshot, endIndex), confirmed: breakout.state === "confirmed" }),
    profileId,
    boundaries: Object.freeze({ upper, lower }),
    metrics: { priorTrend: trend, convergence: chartPatternRound(convergence) },
  });
}

export function runReversalPatternSubengine(snapshot, scanContext) {
  const candidates = [];
  for (const profile of scanContext.profiles) {
    const { swings } = profile;
    for (let index = 0; index <= swings.length - 3; index += 1) {
      const candidate = evaluateDoubleReversal(snapshot, swings.slice(index, index + 3), { atr: scanContext.atr, profileId: profile.id });
      if (candidate) candidates.push(candidate);
    }
    for (let index = 0; index <= swings.length - 5; index += 1) {
      candidates.push(...evaluateFivePointReversal(snapshot, swings.slice(index, index + 5), { atr: scanContext.atr, profileId: profile.id }));
    }
    for (let length = 5; length <= 8; length += 1) {
      for (let index = 0; index <= swings.length - length; index += 1) {
        const candidate = evaluateWedgeReversal(snapshot, swings.slice(index, index + length), { atr: scanContext.atr, profileId: profile.id });
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const ranked = rankAndDeduplicateCandidates(candidates);
  return Object.freeze({
    id: CHART_PATTERN_REVERSAL_SUBENGINE_ID,
    version: CHART_PATTERN_REVERSAL_SUBENGINE_VERSION,
    status: ranked.length ? "succeeded" : "insufficient_data",
    supportedPatternIds: CHART_PATTERN_REVERSAL_IDS,
    candidates: ranked,
  });
}
