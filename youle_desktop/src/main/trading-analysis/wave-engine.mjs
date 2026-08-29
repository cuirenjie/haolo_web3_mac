import crypto from "node:crypto";
import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";

export const WAVE_ENGINE_ID = "elliott_wave";
export const WAVE_ENGINE_VERSION = "0.3.0";

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function averageTrueRange(candles, period = 14) {
  if (!candles.length) return 0;
  const ranges = candles.map((candle, index) => trueRange(
    candle,
    index ? candles[index - 1].close : candle.close,
  ));
  return average(ranges.slice(-Math.min(period, ranges.length)));
}

function fibonacciCloseness(value, targets, tolerance = 0.35) {
  if (!Number.isFinite(value) || value < 0) return 0;
  const distance = Math.min(...targets.map((target) => Math.abs(value - target) / Math.max(target, 0.001)));
  return clamp(1 - distance / tolerance, 0, 1);
}

function relativeWaveDegree(snapshot, points) {
  const span = Math.max(0, points.at(-1).index - points[0].index);
  const ratio = span / Math.max(1, snapshot.candles.length - 1);
  if (ratio >= 0.58) return "当前画布主级别";
  if (ratio >= 0.28) return "当前画布次级别";
  return "当前画布局部级别";
}

function rawLocalSwings(snapshot, radius, atr) {
  const candles = snapshot.candles;
  const swings = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const neighbours = candles.slice(index - radius, index + radius + 1);
    const neighbourHigh = Math.max(...neighbours.filter((_, offset) => offset !== radius).map((item) => item.high));
    const neighbourLow = Math.min(...neighbours.filter((_, offset) => offset !== radius).map((item) => item.low));
    const highProminence = candle.high - neighbourHigh;
    const lowProminence = neighbourLow - candle.low;
    const high = candle.high > neighbourHigh;
    const low = candle.low < neighbourLow;
    if (!high && !low) continue;
    const type = high && low
      ? highProminence >= lowProminence ? "high" : "low"
      : high ? "high" : "low";
    const price = type === "high" ? candle.high : candle.low;
    swings.push({
      id: idFor("wave-swing", snapshot.snapshotId, index, type, price),
      index,
      time: candle.time,
      price,
      type,
      status: "confirmed",
      prominenceAtr: atr ? Math.max(highProminence, lowProminence, 0) / atr : 0,
    });
  }
  return swings;
}

function compactSwings(snapshot, rawSwings, atr) {
  const candles = snapshot.candles;
  // Parent-degree anchors must stay materially larger than the radius-1 pivots
  // later used to prove each leg's lower-degree subdivision.
  const threshold = Math.max(atr * 3.5, candles.at(-1).close * 0.0045);
  const compacted = [];
  for (const swing of rawSwings) {
    const previous = compacted.at(-1);
    if (!previous) {
      compacted.push(swing);
      continue;
    }
    if (previous.type === swing.type) {
      const moreExtreme = swing.type === "high"
        ? swing.price >= previous.price
        : swing.price <= previous.price;
      if (moreExtreme) compacted[compacted.length - 1] = swing;
      continue;
    }
    if (Math.abs(swing.price - previous.price) < threshold) continue;
    compacted.push(swing);
  }

  const latest = candles.at(-1);
  const previous = compacted.at(-1);
  if (latest && previous) {
    const nextType = previous.type === "high" ? "low" : "high";
    const nextPrice = nextType === "high" ? latest.high : latest.low;
    if (Math.abs(nextPrice - previous.price) >= threshold) {
      compacted.push({
        id: idFor("wave-swing", snapshot.snapshotId, candles.length - 1, nextType, nextPrice, "tentative"),
        index: candles.length - 1,
        time: latest.time,
        price: nextPrice,
        type: nextType,
        status: "tentative",
        prominenceAtr: atr ? Math.abs(nextPrice - previous.price) / atr : 0,
      });
    }
  }
  return compacted;
}

function directionMovesBeyond(direction, price, reference) {
  return direction === "bullish" ? price > reference : price < reference;
}

function expectedPointTypes(direction, count) {
  const first = direction === "bullish" ? "low" : "high";
  return Array.from({ length: count }, (_, index) => (
    index % 2 === 0 ? first : first === "low" ? "high" : "low"
  ));
}

function subdivisionCount(value) {
  return Number(typeof value === "number" ? value : value?.segmentCount);
}

function subdivisionConfirmed(value) {
  return typeof value === "number" ? true : value?.confirmed === true;
}

function subdivisionMatches(value, expected) {
  const count = subdivisionCount(value);
  // Extensions and complex corrections can expose 7/9/... radius-1 segments
  // while still reducing to a 5- or 3-wave parent form. Require the correct odd
  // direction parity and a real lower-degree minimum; endpoints alone never pass.
  return Number.isInteger(count) && count >= expected && count % 2 === 1;
}

function lowerDegreeSubdivision(snapshot, fineSwings, start, end, atr) {
  const minimumMove = Math.max(atr * 0.08, snapshot.candles.at(-1).close * 0.0002);
  const source = [
    start,
    ...fineSwings.filter((point) => point.index > start.index && point.index < end.index),
    end,
  ].sort((first, second) => first.index - second.index || first.time - second.time);
  const points = [];
  for (const point of source) {
    const previous = points.at(-1);
    if (!previous) {
      points.push(point);
      continue;
    }
    if (previous.index === point.index) {
      points[points.length - 1] = point;
      continue;
    }
    if (previous.type === point.type) {
      const moreExtreme = point.type === "high"
        ? point.price >= previous.price
        : point.price <= previous.price;
      if (moreExtreme || point === end) points[points.length - 1] = point;
      continue;
    }
    if (point !== end && Math.abs(point.price - previous.price) < minimumMove) continue;
    points.push(point);
  }
  if (points.at(-1)?.index !== end.index) points.push(end);
  return {
    segmentCount: Math.max(0, points.length - 1),
    confirmed: points.every((point) => point.status === "confirmed"),
    pointIds: points.map((point) => point.id),
    method: "lower_degree_local_swings",
  };
}

function subdivisionEvidence(snapshot, fineSwings, points, atr) {
  return points.slice(0, -1).map((point, index) => (
    lowerDegreeSubdivision(snapshot, fineSwings, point, points[index + 1], atr)
  ));
}

function diagonalGeometry(points, direction, lengths, atr) {
  const contractingLengths = lengths[2] < lengths[0] * 0.98
    && lengths[4] < lengths[2] * 0.98
    && lengths[3] < lengths[1] * 0.98;
  const expandingLengths = lengths[2] > lengths[0] * 1.02
    && lengths[4] > lengths[2] * 1.02
    && lengths[3] > lengths[1] * 1.02;
  const sign = direction === "bullish" ? 1 : -1;
  const progress = points.map((point) => sign * (point.price - points[0].price));
  const x = points.map((point, index) => Number.isFinite(Number(point.index)) ? Number(point.index) : index);
  const actionSpan = Math.max(Number.EPSILON, x[3] - x[1]);
  const actionSlope = (progress[3] - progress[1]) / actionSpan;
  const actionAt = (index) => progress[1] + actionSlope * (x[index] - x[1]);
  const boundaryGapAtWave2 = actionAt(2) - progress[2];
  const boundaryGapAtWave4 = actionAt(4) - progress[4];
  const gapsPositive = boundaryGapAtWave2 > 0 && boundaryGapAtWave4 > 0;
  const contractingBoundary = gapsPositive && boundaryGapAtWave4 < boundaryGapAtWave2 * 0.98;
  const expandingBoundary = gapsPositive && boundaryGapAtWave4 > boundaryGapAtWave2 * 1.02;
  const expectedWave5 = actionAt(5);
  const wave5BoundaryDeviation = Math.abs(progress[5] - expectedWave5);
  const wave5BoundaryTolerance = Math.max(
    Math.max(0, atr) * 0.5,
    boundaryGapAtWave4 * 0.4,
    lengths[4] * 0.25,
  );
  const wave5NearActionBoundary = wave5BoundaryDeviation <= wave5BoundaryTolerance;
  const contracting = contractingLengths && contractingBoundary && wave5NearActionBoundary;
  const expanding = expandingLengths && expandingBoundary && wave5NearActionBoundary;
  return {
    variant: contracting ? "contracting" : expanding ? "expanding" : null,
    wedgeVerified: contracting || expanding,
    boundaryGapAtWave2,
    boundaryGapAtWave4,
    wave5BoundaryDeviation,
    wave5BoundaryTolerance,
    wave5NearActionBoundary,
  };
}

export function evaluateMotiveWaveRules(points, options = {}) {
  if (!Array.isArray(points) || points.length !== 6) {
    return { valid: false, impulseValid: false, diagonalValid: false, rejectionReasons: ["point_count"] };
  }
  const bullish = points[0].type === "low";
  const direction = bullish ? "bullish" : "bearish";
  const expectedTypes = expectedPointTypes(direction, 6);
  const directionAlternates = points.every((point, index) => point.type === expectedTypes[index]);
  const lengths = [
    Math.abs(points[1].price - points[0].price),
    Math.abs(points[2].price - points[1].price),
    Math.abs(points[3].price - points[2].price),
    Math.abs(points[4].price - points[3].price),
    Math.abs(points[5].price - points[4].price),
  ];
  const nonZeroWaves = lengths.every((length) => Number.isFinite(length) && length > 0);
  const wave2HoldsOrigin = bullish
    ? points[2].price > points[0].price
    : points[2].price < points[0].price;
  const wave3MakesProgress = directionMovesBeyond(direction, points[3].price, points[1].price);
  const wave4HoldsWave3Origin = bullish
    ? points[4].price > points[2].price
    : points[4].price < points[2].price;
  const wave3NotShortest = lengths[2] >= Math.min(lengths[0], lengths[4]);
  const wave4AvoidsWave1 = bullish
    ? points[4].price > points[1].price
    : points[4].price < points[1].price;
  const wave5MakesProgress = directionMovesBeyond(direction, points[5].price, points[3].price);
  const atr = Math.max(0, Number(options.atr) || 0);
  const wave5Shortfall = wave5MakesProgress
    ? 0
    : Math.abs(points[5].price - points[3].price);
  const truncationTolerance = Math.max(atr * 0.25, lengths[2] * 0.1);
  const truncationSlight = !wave5MakesProgress
    && wave5Shortfall > 0
    && wave5Shortfall <= truncationTolerance;
  const subdivisions = Array.isArray(options.subdivisions) ? options.subdivisions : [];
  const impulseInternalStructureVerified = subdivisions.length === 5
    && [5, 3, 5, 3, 5].every((minimum, index) => subdivisionMatches(subdivisions[index], minimum));
  const allSubdivisionsConfirmed = subdivisions.length === 5
    && subdivisions.every(subdivisionConfirmed);
  const truncatedFifthVerified = truncationSlight && subdivisionMatches(subdivisions[4], 5);
  const sharedRulesPass = directionAlternates
    && nonZeroWaves
    && wave2HoldsOrigin
    && wave3MakesProgress
    && wave4HoldsWave3Origin
    && wave3NotShortest
    && (wave5MakesProgress || truncatedFifthVerified);
  const impulseValid = sharedRulesPass
    && wave4AvoidsWave1
    && impulseInternalStructureVerified;
  const geometry = diagonalGeometry(points, direction, lengths, atr);
  const diagonalPosition = ["leading", "ending"].includes(options.diagonalPosition)
    ? options.diagonalPosition
    : null;
  const diagonalInternalStructureVerified = diagonalPosition === "ending"
    ? subdivisions.length === 5 && subdivisions.every((value) => subdivisionMatches(value, 3))
    : diagonalPosition === "leading"
      ? subdivisions.length === 5 && (
        subdivisions.every((value) => subdivisionMatches(value, 3))
        || [5, 3, 5, 3, 5].every((minimum, index) => subdivisionMatches(subdivisions[index], minimum))
      )
      : false;
  const diagonalValid = sharedRulesPass
    && !wave4AvoidsWave1
    && geometry.wedgeVerified
    && Boolean(diagonalPosition)
    && diagonalInternalStructureVerified
    && (!truncatedFifthVerified || diagonalPosition === "ending");
  const ratios = {
    wave2Retracement: lengths[1] / Math.max(lengths[0], Number.EPSILON),
    wave3Extension: lengths[2] / Math.max(lengths[0], Number.EPSILON),
    wave4Retracement: lengths[3] / Math.max(lengths[2], Number.EPSILON),
    wave5ToWave1: lengths[4] / Math.max(lengths[0], Number.EPSILON),
  };
  const commonRejectionReasons = [];
  if (!directionAlternates) commonRejectionReasons.push("direction_alternation");
  if (!nonZeroWaves) commonRejectionReasons.push("non_zero_waves");
  if (!wave2HoldsOrigin) commonRejectionReasons.push("wave2_origin");
  if (!wave3MakesProgress) commonRejectionReasons.push("wave3_progress");
  if (!wave4HoldsWave3Origin) commonRejectionReasons.push("wave4_full_retrace");
  if (!wave3NotShortest) commonRejectionReasons.push("wave3_shortest");
  if (!wave5MakesProgress && !truncatedFifthVerified) commonRejectionReasons.push("wave5_progress_or_verified_truncation");
  const impulseRejectionReasons = [...commonRejectionReasons];
  if (!wave4AvoidsWave1) impulseRejectionReasons.push("wave4_wave1_overlap");
  if (!impulseInternalStructureVerified) impulseRejectionReasons.push("impulse_internal_structure");
  const diagonalRejectionReasons = [...commonRejectionReasons];
  if (wave4AvoidsWave1) diagonalRejectionReasons.push("diagonal_wave1_wave4_overlap_missing");
  if (!geometry.wedgeVerified) diagonalRejectionReasons.push("diagonal_wedge_geometry");
  if (!diagonalPosition) diagonalRejectionReasons.push("diagonal_position");
  if (!diagonalInternalStructureVerified) diagonalRejectionReasons.push("diagonal_internal_structure");
  if (truncatedFifthVerified && diagonalPosition !== "ending") diagonalRejectionReasons.push("diagonal_truncation_position");
  const rejectionReasons = impulseValid || diagonalValid
    ? []
    : [...new Set([...impulseRejectionReasons, ...diagonalRejectionReasons])];
  return {
    valid: impulseValid || diagonalValid,
    impulseValid,
    diagonalValid,
    direction,
    lengths,
    ratios,
    rules: {
      directionAlternates,
      nonZeroWaves,
      wave2HoldsOrigin,
      wave3MakesProgress,
      wave4HoldsWave3Origin,
      wave3NotShortest,
      wave4AvoidsWave1,
      wave5MakesProgress,
      truncationSlight,
      truncatedFifthVerified,
      impulseInternalStructureVerified,
      diagonalPosition,
      diagonalPositionVerified: Boolean(diagonalPosition),
      diagonalVariant: geometry.variant,
      diagonalWedgeVerified: geometry.wedgeVerified,
      diagonalBoundaryGapAtWave2: geometry.boundaryGapAtWave2,
      diagonalBoundaryGapAtWave4: geometry.boundaryGapAtWave4,
      wave5NearDiagonalBoundary: geometry.wave5NearActionBoundary,
      diagonalInternalStructureVerified,
      allSubdivisionsConfirmed,
    },
    impulseRejectionReasons,
    diagonalRejectionReasons,
    rejectionReasons,
  };
}

function impulseCandidate(snapshot, points, fineSwings, atr) {
  const subdivisions = subdivisionEvidence(snapshot, fineSwings, points, atr);
  const evaluation = evaluateMotiveWaveRules(points, { atr, subdivisions });
  if (!evaluation.impulseValid) return null;
  const { direction, ratios, rules } = evaluation;
  const fibonacciScore = average([
    fibonacciCloseness(ratios.wave2Retracement, [0.382, 0.5, 0.618, 0.786]),
    fibonacciCloseness(ratios.wave3Extension, [1, 1.272, 1.618, 2.618], 0.45),
    fibonacciCloseness(ratios.wave4Retracement, [0.236, 0.382, 0.5]),
    fibonacciCloseness(ratios.wave5ToWave1, [0.618, 1, 1.618], 0.45),
  ]);
  const recency = clamp((points.at(-1).index + 1) / snapshot.candles.length, 0, 1);
  const score = clamp(
    0.48
      + fibonacciScore * 0.29
      + recency * 0.1,
    0,
    1,
  );
  const status = rules.allSubdivisionsConfirmed
    && points.at(-1).status === "confirmed"
    ? "confirmed"
    : "tentative";
  const totalMove = Math.abs(points[5].price - points[0].price);
  const correctionPrices = direction === "bullish"
    ? [points[5].price - totalMove * 0.382, points[5].price - totalMove * 0.618]
    : [points[5].price + totalMove * 0.382, points[5].price + totalMove * 0.618];
  const projectionLow = Math.min(...correctionPrices);
  const projectionHigh = Math.max(...correctionPrices);
  return {
    id: idFor("wave-count", snapshot.snapshotId, "impulse", ...points.map((point) => point.id)),
    kind: "impulse",
    pattern: "motive_impulse",
    degree: relativeWaveDegree(snapshot, points),
    direction,
    status,
    score,
    labels: ["0", "1", "2", "3", "4", "5"],
    points: points.map((point, index) => ({ ...point, label: String(index) })),
    ratios,
    subdivisions,
    rules,
    validation: "hard_rules_and_lower_degree_structure",
    invalidationPrice: points[0].price,
    confirmationPrice: points[4].price,
    projection: {
      kind: "post_impulse_correction",
      direction: direction === "bullish" ? "bearish" : "bullish",
      low: projectionLow,
      high: projectionHigh,
      basis: "completed_move_0.382_0.618",
    },
  };
}

export function evaluateCorrectionWaveRules(points, options = {}) {
  if (!Array.isArray(points) || points.length !== 4) {
    return { valid: false, pattern: null, rejectionReasons: ["point_count"] };
  }
  const bullish = points[0].type === "low";
  const direction = bullish ? "bullish" : "bearish";
  const expectedTypes = expectedPointTypes(direction, 4);
  const directionAlternates = points.every((point, index) => point.type === expectedTypes[index]);
  const waveA = Math.abs(points[1].price - points[0].price);
  const waveB = Math.abs(points[2].price - points[1].price);
  const waveC = Math.abs(points[3].price - points[2].price);
  const nonZeroWaves = [waveA, waveB, waveC].every((length) => Number.isFinite(length) && length > 0);
  const waveBHoldsOrigin = bullish
    ? points[2].price > points[0].price
    : points[2].price < points[0].price;
  const waveCExtendsA = bullish
    ? points[3].price > points[1].price
    : points[3].price < points[1].price;
  const ratios = {
    waveBRetracement: waveB / Math.max(waveA, Number.EPSILON),
    waveCToWaveA: waveC / Math.max(waveA, Number.EPSILON),
  };
  const subdivisions = Array.isArray(options.subdivisions) ? options.subdivisions : [];
  const motiveA = subdivisionMatches(subdivisions[0], 5);
  const correctiveA = subdivisionMatches(subdivisions[0], 3);
  const correctiveB = subdivisionMatches(subdivisions[1], 3);
  const motiveC = subdivisionMatches(subdivisions[2], 5);
  const allSubdivisionsConfirmed = subdivisions.length === 3 && subdivisions.every(subdivisionConfirmed);
  const zigzag = directionAlternates && nonZeroWaves && waveBHoldsOrigin
    && ratios.waveBRetracement < 0.9
    && waveCExtendsA && motiveA && correctiveB && motiveC;
  const flatBase = directionAlternates && nonZeroWaves
    && ratios.waveBRetracement >= 0.9
    && correctiveA && correctiveB && motiveC;
  const cMakesNetProgress = directionMovesBeyond(direction, points[3].price, points[0].price);
  let pattern = null;
  if (zigzag) pattern = "zigzag";
  else if (flatBase && ratios.waveBRetracement > 1.05 && waveCExtendsA) pattern = "expanded_flat";
  else if (flatBase && ratios.waveBRetracement > 1 && !waveCExtendsA && cMakesNetProgress) pattern = "running_flat";
  else if (flatBase && ratios.waveBRetracement <= 1.05 && waveCExtendsA) pattern = "flat";
  const internalStructureVerified = Boolean(pattern);
  const rejectionReasons = [];
  if (!directionAlternates) rejectionReasons.push("direction_alternation");
  if (!nonZeroWaves) rejectionReasons.push("non_zero_waves");
  if (!correctiveB || !motiveC) rejectionReasons.push("correction_internal_structure");
  if (!pattern) rejectionReasons.push("correction_pattern_rules");
  return {
    valid: Boolean(pattern),
    pattern,
    direction,
    ratios,
    rules: {
      directionAlternates,
      nonZeroWaves,
      waveBHoldsOrigin,
      waveCExtendsA,
      cMakesNetProgress,
      motiveA,
      correctiveA,
      correctiveB,
      motiveC,
      internalStructureVerified,
      allSubdivisionsConfirmed,
    },
    rejectionReasons,
  };
}

function correctionCandidate(snapshot, points, fineSwings, atr) {
  const subdivisions = subdivisionEvidence(snapshot, fineSwings, points, atr);
  const evaluation = evaluateCorrectionWaveRules(points, { subdivisions });
  if (!evaluation.valid) return null;
  const { direction, pattern, ratios, rules } = evaluation;
  const fibonacciScore = average([
    fibonacciCloseness(ratios.waveBRetracement, [0.382, 0.5, 0.618, 0.786, 1], 0.45),
    fibonacciCloseness(ratios.waveCToWaveA, [0.618, 1, 1.272, 1.618], 0.45),
  ]);
  const recency = clamp((points.at(-1).index + 1) / snapshot.candles.length, 0, 1);
  const score = clamp(
    0.48
      + fibonacciScore * 0.22
      + recency * 0.1,
    0,
    1,
  );
  return {
    id: idFor("wave-count", snapshot.snapshotId, "correction", pattern, ...points.map((point) => point.id)),
    kind: "correction",
    pattern,
    degree: relativeWaveDegree(snapshot, points),
    direction,
    status: rules.allSubdivisionsConfirmed && points.at(-1).status === "confirmed"
      ? "confirmed"
      : "tentative",
    score,
    labels: ["起点", "A", "B", "C"],
    points: points.map((point, index) => ({ ...point, label: ["起点", "A", "B", "C"][index] })),
    ratios,
    subdivisions,
    rules,
    validation: "hard_rules_and_lower_degree_structure",
    invalidationPrice: points[3].price,
    confirmationPrice: points[2].price,
    projection: {
      kind: "post_correction_reversal",
      direction: direction === "bullish" ? "bearish" : "bullish",
      low: Math.min(points[2].price, points[3].price),
      high: Math.max(points[2].price, points[3].price),
      basis: "wave_b_break_and_wave_c_invalidation",
    },
  };
}

function doubleThreeCandidate(snapshot, points, fineSwings, atr) {
  if (points.length !== 8) return null;
  const bullish = points[0].type === "low";
  const direction = bullish ? "bullish" : "bearish";
  const expectedTypes = bullish
    ? ["low", "high", "low", "high", "low", "high", "low", "high"]
    : ["high", "low", "high", "low", "high", "low", "high", "low"];
  if (!points.every((point, index) => point.type === expectedTypes[index])) return null;
  const waveW = Math.abs(points[3].price - points[0].price);
  const waveX = Math.abs(points[4].price - points[3].price);
  const waveY = Math.abs(points[7].price - points[4].price);
  if (!waveW || !waveX || !waveY) return null;
  const xHoldsOrigin = bullish ? points[4].price > points[0].price : points[4].price < points[0].price;
  if (!xHoldsOrigin) return null;
  const subdivisions = subdivisionEvidence(snapshot, fineSwings, points, atr);
  const wEvaluation = evaluateCorrectionWaveRules(points.slice(0, 4), { subdivisions: subdivisions.slice(0, 3) });
  const yEvaluation = evaluateCorrectionWaveRules(points.slice(4, 8), { subdivisions: subdivisions.slice(4, 7) });
  const xInternalStructureVerified = subdivisionMatches(subdivisions[3], 3);
  if (!wEvaluation.valid || !yEvaluation.valid || !xInternalStructureVerified) return null;
  const yMakesProgress = directionMovesBeyond(direction, points[7].price, points[3].price);
  const ratios = {
    waveXRetracement: waveX / waveW,
    waveYToWaveW: waveY / waveW,
    waveWInternalB: Math.abs(points[2].price - points[1].price) / Math.max(Math.abs(points[1].price - points[0].price), Number.EPSILON),
    waveYInternalB: Math.abs(points[6].price - points[5].price) / Math.max(Math.abs(points[5].price - points[4].price), Number.EPSILON),
  };
  const fibonacciScore = average([
    fibonacciCloseness(ratios.waveXRetracement, [0.382, 0.5, 0.618, 0.786], 0.45),
    fibonacciCloseness(ratios.waveYToWaveW, [0.618, 1, 1.272, 1.618], 0.5),
  ]);
  const recency = clamp((points.at(-1).index + 1) / snapshot.candles.length, 0, 1);
  const score = clamp(
    0.5 + (yMakesProgress ? 0.08 : 0.03) + fibonacciScore * 0.25 + recency * 0.12,
    0,
    1,
  );
  return {
    id: idFor("wave-count", snapshot.snapshotId, "double-three", ...points.map((point) => point.id)),
    kind: "correction",
    pattern: "double_three",
    degree: relativeWaveDegree(snapshot, points),
    direction,
    status: subdivisions.every(subdivisionConfirmed) && points.at(-1).status === "confirmed" ? "confirmed" : "tentative",
    score,
    labels: ["起点", "a", "b", "W", "X", "a", "b", "Y"],
    points: points.map((point, index) => ({
      ...point,
      label: ["起点", "a", "b", "W", "X", "a", "b", "Y"][index],
      component: index <= 3 ? "W" : index === 4 ? "X" : "Y",
    })),
    ratios,
    subdivisions,
    rules: {
      directionAlternates: true,
      xHoldsOrigin,
      yMakesProgress,
      internalThreeWaveSegments: true,
      xInternalStructureVerified,
      wPattern: wEvaluation.pattern,
      yPattern: yEvaluation.pattern,
      structureVerified: true,
    },
    validation: "hard_rules_and_lower_degree_structure",
    invalidationPrice: points[7].price,
    confirmationPrice: points[6].price,
    projection: {
      kind: "post_double_three_reversal",
      direction: bullish ? "bearish" : "bullish",
      low: Math.min(points[6].price, points[7].price),
      high: Math.max(points[6].price, points[7].price),
      basis: "wxy_completion_and_x_break",
    },
  };
}

function completeCycleCandidate(snapshot, impulse, correction) {
  if (!impulse || !correction || impulse.points.at(-1).id !== correction.points[0].id) return null;
  if (impulse.direction === correction.direction) return null;
  if (impulse.kind !== "impulse" || impulse.rules?.impulseInternalStructureVerified !== true) return null;
  if (correction.pattern === "double_three") {
    if (correction.rules?.structureVerified !== true) return null;
  } else if (correction.rules?.internalStructureVerified !== true) return null;
  const points = [
    ...impulse.points,
    ...correction.points.slice(1),
  ];
  const labels = [
    "0", "1", "2", "3", "4", "5",
    ...correction.labels.slice(1),
  ];
  const score = clamp((impulse.score * 0.55 + correction.score * 0.45) + 0.08, 0, 1);
  return {
    id: idFor("wave-cycle", snapshot.snapshotId, impulse.id, correction.id),
    kind: "cycle",
    pattern: correction.pattern === "double_three" ? `${impulse.kind}_plus_wxy` : `${impulse.kind}_plus_abc`,
    degree: relativeWaveDegree(snapshot, points),
    direction: impulse.direction,
    correctionDirection: correction.direction,
    status: impulse.status === "confirmed" && correction.status === "confirmed" ? "confirmed" : "tentative",
    score,
    labels,
    points: points.map((point, index) => ({ ...point, label: labels[index] })),
    ratios: {
      impulse: impulse.ratios,
      correction: correction.ratios,
      correctionToImpulse: Math.abs(correction.points.at(-1).price - correction.points[0].price)
        / Math.max(Math.abs(impulse.points.at(-1).price - impulse.points[0].price), Number.EPSILON),
    },
    rules: {
      impulse: impulse.rules,
      correction: correction.rules,
      sharedWaveFiveOrigin: true,
    },
    components: {
      impulseCandidateId: impulse.id,
      correctionCandidateId: correction.id,
      impulsePointCount: impulse.points.length,
      motiveKind: impulse.kind,
      motivePattern: impulse.pattern,
      correctionPattern: correction.pattern,
      structureVerified: true,
    },
    invalidationPrice: correction.invalidationPrice,
    confirmationPrice: correction.confirmationPrice,
    projection: correction.projection,
  };
}

function buildWaveCandidates(snapshot, swings, fineSwings, atr) {
  const motiveCandidates = [];
  const correctionCandidates = [];
  for (let index = 0; index <= swings.length - 6; index += 1) {
    const candidate = impulseCandidate(snapshot, swings.slice(index, index + 6), fineSwings, atr);
    if (candidate) motiveCandidates.push(candidate);
  }
  for (let index = 0; index <= swings.length - 4; index += 1) {
    const candidate = correctionCandidate(snapshot, swings.slice(index, index + 4), fineSwings, atr);
    if (candidate) correctionCandidates.push(candidate);
  }
  for (let index = 0; index <= swings.length - 8; index += 1) {
    const candidate = doubleThreeCandidate(snapshot, swings.slice(index, index + 8), fineSwings, atr);
    if (candidate) correctionCandidates.push(candidate);
  }
  const cycles = motiveCandidates.flatMap((impulse) => correctionCandidates.flatMap((correction) => {
    const candidate = completeCycleCandidate(snapshot, impulse, correction);
    return candidate ? [candidate] : [];
  }));
  const sortCandidates = (candidates) => [...candidates].sort((first, second) => (
      (second.status === "confirmed" ? 1 : 0) - (first.status === "confirmed" ? 1 : 0)
      || (second.kind === "cycle" ? 1 : 0) - (first.kind === "cycle" ? 1 : 0)
      || second.score - first.score
      || second.points.at(-1).time - first.points.at(-1).time
      || first.id.localeCompare(second.id)
    ));
  const completeAbc = sortCandidates(cycles.filter((candidate) => candidate.pattern === "impulse_plus_abc"));
  const completeWxy = sortCandidates(cycles.filter((candidate) => candidate.pattern === "impulse_plus_wxy"));
  const motives = sortCandidates(motiveCandidates);
  const abcCorrections = sortCandidates(correctionCandidates.filter((candidate) => candidate.pattern !== "double_three"));
  const doubleThrees = sortCandidates(correctionCandidates.filter((candidate) => candidate.pattern === "double_three"));
  const selected = [
    ...completeAbc.slice(0, 4),
    ...completeWxy.slice(0, 2),
    ...motives.slice(0, 2),
    ...abcCorrections.slice(0, 2),
    ...doubleThrees.slice(0, 2),
  ];
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  for (const candidate of sortCandidates([...cycles, ...motiveCandidates, ...correctionCandidates])) {
    if (selected.length >= 12) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  return sortCandidates(selected).slice(0, 12);
}

export function runWaveTheoryEngine(snapshot) {
  const atr = averageTrueRange(snapshot.candles);
  const radius = snapshot.candles.length >= 160 ? 3 : 2;
  const rawSwings = rawLocalSwings(snapshot, radius, atr);
  const fineSwings = rawLocalSwings(snapshot, 1, atr);
  const swings = compactSwings(snapshot, rawSwings, atr);
  const candidates = buildWaveCandidates(snapshot, swings, fineSwings, atr);
  const primaryCandidate = candidates[0] || null;
  const alternatives = primaryCandidate
    ? candidates.filter((candidate) => candidate.id !== primaryCandidate.id).slice(0, 3)
    : [];
  const status = primaryCandidate ? "succeeded" : "insufficient_data";
  const evidence = swings.map((swing) => ({
    evidenceId: swing.id,
    kind: swing.type === "high" ? "confirmed_swing_high" : "confirmed_swing_low",
    source: "ohlcv",
    status: swing.status,
  }));
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    resultId: idFor("wave-result", snapshot.snapshotId, WAVE_ENGINE_VERSION),
    engineId: WAVE_ENGINE_ID,
    engineVersion: WAVE_ENGINE_VERSION,
    snapshotId: snapshot.snapshotId,
    status,
    confidence: {
      structure: primaryCandidate?.score || 0,
      coverage: clamp(snapshot.candles.length / 160, 0, 1),
    },
    statistics: {
      candleCount: snapshot.candles.length,
      atr,
      pivotRadius: radius,
      rawSwingCount: rawSwings.length,
      lowerDegreeSwingCount: fineSwings.length,
      swingCount: swings.length,
      candidateCount: candidates.length,
      completeCycleCount: candidates.filter((candidate) => candidate.kind === "cycle").length,
      motiveCount: candidates.filter((candidate) => candidate.kind === "impulse" || candidate.kind === "diagonal").length,
      abcCorrectionCount: candidates.filter((candidate) => candidate.kind === "correction" && candidate.pattern !== "double_three").length,
      doubleThreeCount: candidates.filter((candidate) => candidate.pattern === "double_three").length,
    },
    structures: {
      swings,
      candidates,
      primaryCandidate,
      alternatives,
    },
    signals: primaryCandidate ? [{
      signalId: idFor("wave-signal", snapshot.snapshotId, primaryCandidate.id),
      kind: primaryCandidate.projection.direction === "bullish"
        ? "bullish_scenario"
        : "bearish_scenario",
      strength: primaryCandidate.score,
      status: primaryCandidate.status,
      evidenceIds: primaryCandidate.points.map((point) => point.id),
    }] : [],
    evidence,
    missingData: [],
  };
}
