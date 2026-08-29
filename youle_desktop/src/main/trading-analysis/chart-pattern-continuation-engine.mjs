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

export const CHART_PATTERN_CONTINUATION_SUBENGINE_ID = "chart-pattern-continuation";
export const CHART_PATTERN_CONTINUATION_SUBENGINE_VERSION = "1.1.0";
export const CHART_PATTERN_CONTINUATION_IDS = Object.freeze([
  "bull-flag",
  "bear-flag",
  "bull-pennant",
  "bear-pennant",
  "cup-and-handle",
]);

const NAMES = Object.freeze({
  "bull-flag": "看涨旗形",
  "bear-flag": "看跌旗形",
  "bull-pennant": "看涨三角旗",
  "bear-pennant": "看跌三角旗",
  "cup-and-handle": "杯柄形态",
});

function breakoutWindow(duration) {
  return Math.max(4, Math.min(12, Math.round(Math.max(1, duration) * 0.35)));
}

function continuationCandidate(snapshot, {
  patternId,
  direction,
  points,
  labels,
  boundaries,
  breakout,
  actionLevels,
  height,
  score,
  profileId,
  metrics,
  lastStructureIndex = points.at(-1).index,
  structureDuration = points.at(-1).index - points[0].index,
}) {
  const ageLimitBars = breakoutWindow(structureDuration);
  const lifecycleState = resolvePatternLifecycle(snapshot, {
    breakout,
    actionLevels,
    direction,
    lastStructureIndex,
    structureDuration,
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
    category: "continuation",
    direction,
    lifecycle,
    status: lifecycle === "confirmed" ? "confirmed" : "tentative",
    tradeState,
    points: records,
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
      "CHART-CONTINUATION-PRIOR-MOVE",
      "CHART-CLOSED-BREAKOUT",
      "CHART-FALSE-BREAKOUT",
      patternId.includes("flag") || patternId.includes("pennant") ? "CHART-FLAGPOLE-TARGET" : "CHART-HEIGHT-TARGET",
    ]),
    evidenceIds: Object.freeze([id, ...records.map((point) => point.id)]),
  });
}

export function evaluateFlagOrPennant(snapshot, poleStart, consolidationPoints, { atr, profileId = "direct" } = {}) {
  if (!poleStart || !Array.isArray(consolidationPoints) || consolidationPoints.length < 4 || consolidationPoints.length > 7) return null;
  if (consolidationPoints.some((point, index) => index && point.type === consolidationPoints[index - 1].type)) return null;
  const poleEnd = consolidationPoints[0];
  const poleMove = poleEnd.price - poleStart.price;
  const poleLength = Math.abs(poleMove);
  if (poleLength < atr * 4 || poleEnd.index - poleStart.index < 3 || poleEnd.index - poleStart.index > 45) return null;
  const bullish = poleMove > 0;
  if ((bullish && poleEnd.type !== "high") || (!bullish && poleEnd.type !== "low")) return null;
  const highs = consolidationPoints.filter((point) => point.type === "high");
  const lows = consolidationPoints.filter((point) => point.type === "low");
  if (highs.length < 2 || lows.length < 2) return null;
  const upper = boundaryFromPoints(highs);
  const lower = boundaryFromPoints(lows);
  if (!upper || !lower) return null;
  const startIndex = consolidationPoints[0].index;
  const endIndex = consolidationPoints.at(-1).index;
  const duration = endIndex - startIndex;
  if (duration < 4 || duration > 35) return null;
  const adverse = bullish
    ? poleEnd.price - Math.min(...consolidationPoints.map((point) => point.price))
    : Math.max(...consolidationPoints.map((point) => point.price)) - poleEnd.price;
  if (adverse > poleLength * 0.52) return null;
  const startGap = linePrice(upper, startIndex) - linePrice(lower, startIndex);
  const endGap = linePrice(upper, endIndex) - linePrice(lower, endIndex);
  if (startGap <= atr * 0.6 || endGap <= 0) return null;
  const slopeScale = poleLength / Math.max(1, duration);
  const upperNormalized = upper.slope / slopeScale;
  const lowerNormalized = lower.slope / slopeScale;
  const parallel = Math.abs(upperNormalized - lowerNormalized) <= 0.22;
  const againstPole = bullish
    ? upperNormalized < 0.08 && lowerNormalized < 0.08
    : upperNormalized > -0.08 && lowerNormalized > -0.08;
  const converging = endGap <= startGap * 0.72 && upper.slope < lower.slope;
  const patternKind = parallel && againstPole ? "flag" : converging ? "pennant" : null;
  if (!patternKind) return null;
  const patternId = `${bullish ? "bull" : "bear"}-${patternKind}`;
  const breakout = findClosedBreakout(
    snapshot,
    endIndex,
    (index) => linePrice(upper, index),
    (index) => linePrice(lower, index),
    atr,
    { allowedDirection: bullish ? "up" : "down", maxSearchBars: breakoutWindow(duration) },
  );
  const triggerIndex = breakout.index || endIndex + 1;
  const trigger = bullish ? linePrice(upper, triggerIndex) : linePrice(lower, triggerIndex);
  const opposite = bullish ? linePrice(lower, triggerIndex) : linePrice(upper, triggerIndex);
  const actionLevels = projectedActionLevels({
    direction: bullish ? "bullish" : "bearish",
    trigger,
    oppositeBoundary: opposite,
    height: poleLength,
    atr,
  });
  const convergence = clamp(1 - endGap / startGap, 0, 1);
  return continuationCandidate(snapshot, {
    patternId,
    direction: bullish ? "bullish" : "bearish",
    points: [poleStart, ...consolidationPoints],
    labels: ["P0", "P1", ...consolidationPoints.slice(1).map((_, index) => `C${index + 1}`)],
    boundaries: Object.freeze({ upper, lower, pole: Object.freeze({ from: poleStart, to: poleEnd }) }),
    breakout,
    actionLevels,
    height: poleLength,
    score: geometryScore({
      symmetry: patternKind === "flag" ? clamp(1 - Math.abs(upperNormalized - lowerNormalized), 0, 1) : convergence,
      touches: consolidationPoints.length,
      fit: Math.max(0.45, (upper.r2 + lower.r2) / 2),
      recency: clamp(1 - (snapshot.candles.length - 1 - endIndex) / 60, 0, 1),
      confirmed: breakout.state === "confirmed",
    }),
    profileId,
    lastStructureIndex: endIndex,
    structureDuration: duration,
    metrics: {
      poleLengthAtr: chartPatternRound(poleLength / atr),
      retracement: chartPatternRound(adverse / poleLength),
      convergence: chartPatternRound(convergence),
    },
  });
}

export function evaluateCupAndHandle(snapshot, inputPoints, { atr, profileId = "direct" } = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length !== 4) return null;
  const [leftLip, bottom, rightLip, handleLow] = inputPoints;
  if (!(leftLip.type === "high" && bottom.type === "low" && rightLip.type === "high" && handleLow.type === "low")) return null;
  const trend = priorTrend(snapshot, leftLip.index, "up", atr, { minimumBars: 10, maximumBars: 60 });
  if (!trend.matches) return null;
  const lip = (leftLip.price + rightLip.price) / 2;
  const depth = lip - bottom.price;
  if (depth < atr * 3 || rightLip.index - leftLip.index < 14 || rightLip.index - leftLip.index > 180) return null;
  if (Math.abs(leftLip.price - rightLip.price) > Math.max(atr, depth * 0.16)) return null;
  const handleDepth = rightLip.price - handleLow.price;
  if (handleDepth <= atr * 0.35 || handleDepth > depth * 0.5 || handleLow.price <= bottom.price + depth * 0.5) return null;
  const cupCandles = snapshot.candles.slice(leftLip.index, rightLip.index + 1);
  const bottomZoneIndexes = cupCandles.flatMap((candle, offset) => (
    candle.low <= bottom.price + depth * 0.12 ? [leftLip.index + offset] : []
  ));
  const roundedSpan = bottomZoneIndexes.length
    ? bottomZoneIndexes.at(-1) - bottomZoneIndexes[0]
    : 0;
  if (bottomZoneIndexes.length < 4 || roundedSpan < Math.max(6, (rightLip.index - leftLip.index) * 0.16)) return null;
  const breakoutLevel = Math.max(leftLip.price, rightLip.price);
  const structureDuration = handleLow.index - leftLip.index;
  const breakout = findClosedBreakout(snapshot, handleLow.index, breakoutLevel, null, atr, {
    allowedDirection: "up",
    maxSearchBars: breakoutWindow(structureDuration),
  });
  const actionLevels = projectedActionLevels({
    direction: "bullish",
    trigger: breakout.state === "confirmed" ? breakout.boundary : breakoutLevel,
    oppositeBoundary: handleLow.price,
    height: depth,
    atr,
  });
  const lipSymmetry = clamp(1 - Math.abs(leftLip.price - rightLip.price) / Math.max(atr, depth * 0.16), 0, 1);
  return continuationCandidate(snapshot, {
    patternId: "cup-and-handle",
    direction: "bullish",
    points: inputPoints,
    labels: ["L", "B", "R", "H"],
    boundaries: Object.freeze({
      breakout: Object.freeze({ price: chartPatternRound(breakoutLevel), startIndex: leftLip.index, endIndex: handleLow.index }),
    }),
    breakout,
    actionLevels,
    height: depth,
    score: geometryScore({
      symmetry: lipSymmetry,
      touches: 4,
      fit: clamp(bottomZoneIndexes.length / 8, 0.45, 1),
      recency: clamp(1 - (snapshot.candles.length - 1 - handleLow.index) / 80, 0, 1),
      confirmed: breakout.state === "confirmed",
    }),
    profileId,
    lastStructureIndex: handleLow.index,
    structureDuration,
    metrics: {
      priorTrend: trend,
      lipSymmetry: chartPatternRound(lipSymmetry),
      handleRetracement: chartPatternRound(handleDepth / depth),
      roundedBottomBars: bottomZoneIndexes.length,
      roundedBottomSpan: roundedSpan,
    },
  });
}

export function runContinuationPatternSubengine(snapshot, scanContext) {
  const candidates = [];
  for (const profile of scanContext.profiles) {
    const { swings } = profile;
    for (let length = 4; length <= 7; length += 1) {
      for (let index = 1; index <= swings.length - length; index += 1) {
        const candidate = evaluateFlagOrPennant(snapshot, swings[index - 1], swings.slice(index, index + length), {
          atr: scanContext.atr,
          profileId: profile.id,
        });
        if (candidate) candidates.push(candidate);
      }
    }
    for (let index = 0; index <= swings.length - 4; index += 1) {
      const candidate = evaluateCupAndHandle(snapshot, swings.slice(index, index + 4), {
        atr: scanContext.atr,
        profileId: profile.id,
      });
      if (candidate) candidates.push(candidate);
    }
  }
  const ranked = rankAndDeduplicateCandidates(candidates);
  return Object.freeze({
    id: CHART_PATTERN_CONTINUATION_SUBENGINE_ID,
    version: CHART_PATTERN_CONTINUATION_SUBENGINE_VERSION,
    status: ranked.length ? "succeeded" : "insufficient_data",
    supportedPatternIds: CHART_PATTERN_CONTINUATION_IDS,
    candidates: ranked,
  });
}
