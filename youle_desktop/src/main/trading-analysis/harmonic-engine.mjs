import crypto from "node:crypto";
import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";
import {
  HARMONIC_CYPHER_SUBENGINE_ID,
  HARMONIC_CYPHER_SUBENGINE_VERSION,
  evaluateCypherDevelopingCandidate,
  runCypherPatternSubengine,
} from "./harmonic-cypher-engine.mjs";
import {
  HARMONIC_SHARK_SUBENGINE_ID,
  HARMONIC_SHARK_SUBENGINE_VERSION,
  evaluateSharkDevelopingCandidate,
  runSharkPatternSubengine,
} from "./harmonic-shark-engine.mjs";

export const HARMONIC_ENGINE_ID = "harmonic-xabcd";
export const HARMONIC_ENGINE_VERSION = "3.0.0";
export const HARMONIC_CLASSIC_SUBENGINE_ID = "harmonic-classic-xabcd";
export const HARMONIC_CLASSIC_SUBENGINE_VERSION = "1.1.0";

export const HARMONIC_SCAN_PROFILES = Object.freeze([
  Object.freeze({ id: "fine", radius: 2, thresholdAtr: 0.35, minimumCandles: 40 }),
  Object.freeze({ id: "standard", radius: 3, thresholdAtr: 0.5, minimumCandles: 40 }),
  Object.freeze({ id: "structural", radius: 5, thresholdAtr: 0.75, minimumCandles: 40 }),
  Object.freeze({ id: "macro", radius: 8, thresholdAtr: 1, minimumCandles: 160 }),
]);

const MAX_SKIPPED_SWING_PAIRS = 2;
const MAX_SEQUENCES_PER_PROFILE = 2_000;

const EXACT_TOLERANCE = 0.03;

function exactRange(target, tolerance = EXACT_TOLERANCE) {
  return Object.freeze({
    minimum: target * (1 - tolerance),
    maximum: target * (1 + tolerance),
    ideal: target,
  });
}

function range(minimum, maximum, ideal = (minimum + maximum) / 2) {
  return Object.freeze({ minimum, maximum, ideal });
}

export const HARMONIC_PATTERN_SPECS = Object.freeze([
  Object.freeze({
    id: "gartley",
    name: "Gartley",
    completion: "retracement",
    bXa: exactRange(0.618),
    cAb: range(0.382, 0.886, 0.618),
    dXa: exactRange(0.786),
    dXaTarget: 0.786,
    dBc: range(1.13, 1.618, 1.414),
    dBcLevels: Object.freeze([1.13, 1.27, 1.414, 1.618]),
    cdAb: range(0.97, 1.3081, 1),
    cdAbLevels: Object.freeze([1, 1.27]),
    maxPrzWidthXa: 0.1,
    ruleIds: Object.freeze(["HARMONIC-GARTLEY-B", "HARMONIC-GARTLEY-PRZ", "HARMONIC-ABCD"]),
  }),
  Object.freeze({
    id: "bat",
    name: "Bat",
    completion: "retracement",
    bXa: range(0.37054, 0.63654, 0.5),
    cAb: range(0.382, 0.886, 0.618),
    dXa: exactRange(0.886),
    dXaTarget: 0.886,
    dBc: range(1.618, 2.618, 2),
    dBcLevels: Object.freeze([1.618, 2, 2.24, 2.618]),
    cdAb: range(0.97, 1.3081, 1.27),
    cdAbLevels: Object.freeze([1, 1.27]),
    maxPrzWidthXa: 0.1,
    ruleIds: Object.freeze(["HARMONIC-BAT-B", "HARMONIC-BAT-PRZ", "HARMONIC-ABCD"]),
  }),
  Object.freeze({
    id: "butterfly",
    name: "Butterfly",
    completion: "extension",
    bXa: exactRange(0.786),
    cAb: range(0.382, 0.886, 0.618),
    dXa: exactRange(1.27),
    dXaTarget: 1.27,
    dBc: range(1.618, 2.618, 2),
    dBcLevels: Object.freeze([1.618, 2, 2.24, 2.618]),
    cdAb: range(0.97, 1.66654, 1.27),
    cdAbLevels: Object.freeze([1, 1.27, 1.618]),
    maxPrzWidthXa: 0.1,
    ruleIds: Object.freeze(["HARMONIC-BUTTERFLY-B", "HARMONIC-BUTTERFLY-PRZ", "HARMONIC-ABCD"]),
  }),
  Object.freeze({
    id: "crab",
    name: "Crab",
    completion: "extension",
    bXa: range(0.37054, 0.63654, 0.5),
    cAb: range(0.382, 0.886, 0.618),
    dXa: exactRange(1.618),
    dXaTarget: 1.618,
    dBc: range(2.618, 3.618, 3.14),
    dBcLevels: Object.freeze([2.618, 3.14, 3.618]),
    cdAb: range(0.97, Number.POSITIVE_INFINITY, 1.618),
    cdAbLevels: Object.freeze([1, 1.27, 1.618]),
    abcdSoft: true,
    maxPrzWidthXa: 0.12,
    ruleIds: Object.freeze(["HARMONIC-CRAB-B", "HARMONIC-CRAB-PRZ", "HARMONIC-ABCD-MINIMUM"]),
  }),
  Object.freeze({
    id: "deep-crab",
    name: "Deep Crab",
    completion: "extension",
    bXa: range(0.86, 0.99, 0.886),
    cAb: range(0.382, 0.886, 0.618),
    dXa: exactRange(1.618),
    dXaTarget: 1.618,
    dBc: range(2.24, 3.618, 2.618),
    dBcLevels: Object.freeze([2.24, 2.618, 3.14, 3.618]),
    cdAb: range(0.97, 1.66654, 1.27),
    cdAbLevels: Object.freeze([1, 1.27, 1.618]),
    maxPrzWidthXa: 0.1,
    ruleIds: Object.freeze(["HARMONIC-DEEP-CRAB-B", "HARMONIC-DEEP-CRAB-PRZ", "HARMONIC-ABCD"]),
  }),
]);

export const HARMONIC_SUPPORTED_PATTERN_IDS = Object.freeze([
  ...HARMONIC_PATTERN_SPECS.map((spec) => spec.id),
  "shark",
  "cypher",
]);

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function round(value) {
  return Number(Number(value).toPrecision(12));
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function averageTrueRange(candles, period = 14) {
  const ranges = candles.map((candle, index) => trueRange(
    candle,
    index ? candles[index - 1].close : candle.close,
  ));
  return average(ranges.slice(-Math.min(period, ranges.length)));
}

function rangeMatches(value, definition) {
  return Number.isFinite(value)
    && value >= definition.minimum - 1e-9
    && value <= definition.maximum + 1e-9;
}

function rangeScore(value, definition) {
  if (!rangeMatches(value, definition)) return 0;
  if (!Number.isFinite(definition.maximum)) {
    return clamp(1 - Math.abs(value - definition.ideal) / Math.max(definition.ideal, 0.001), 0.35, 1);
  }
  const span = Math.max(definition.maximum - definition.minimum, 0.001);
  return clamp(1 - Math.abs(value - definition.ideal) / span, 0.35, 1);
}

function nearest(values, target) {
  return values.reduce((best, value) => (
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  ), values[0]);
}

function expectedTypes(direction) {
  return direction === "bullish"
    ? ["low", "high", "low", "high", "low"]
    : ["high", "low", "high", "low", "high"];
}

function geometryMatches(points, direction, completion) {
  if (!Array.isArray(points) || points.length !== 5) return false;
  if (points.some((point, index) => point.type !== expectedTypes(direction)[index])) return false;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return false;
  const [x, a, b, c, d] = points;
  const bullish = direction === "bullish";
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(b.price, x.price, a.price) || !between(c.price, b.price, a.price)) return false;
  if (bullish && !(d.price < c.price && d.price < b.price)) return false;
  if (!bullish && !(d.price > c.price && d.price > b.price)) return false;
  if (completion === "retracement") return between(d.price, x.price, a.price);
  return bullish ? d.price < x.price : d.price > x.price;
}

function calculateRatios(points) {
  const [x, a, b, c, d] = points;
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  const cd = Math.abs(d.price - c.price);
  if ([xa, ab, bc, cd].some((value) => value <= Number.EPSILON)) return null;
  return Object.freeze({
    bXa: round(ab / xa),
    cAb: round(bc / ab),
    dXa: round(Math.abs(d.price - a.price) / xa),
    dBc: round(cd / bc),
    cdAb: round(cd / ab),
  });
}

function projectedLevel(origin, direction, length, ratio) {
  return origin + direction * length * ratio;
}

function potentialReversalZone(points, ratios, spec, atr) {
  const [x, a, b, c, d] = points;
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  const completionDirection = Math.sign(d.price - c.price) || Math.sign(x.price - a.price);
  const xaDirection = Math.sign(x.price - a.price);
  const abDirection = Math.sign(b.price - a.price);
  const bcRatio = nearest(spec.dBcLevels, ratios.dBc);
  const abcdRatio = nearest(spec.cdAbLevels, ratios.cdAb);
  const xaLevel = projectedLevel(a.price, xaDirection, xa, spec.dXaTarget);
  const bcLevel = projectedLevel(c.price, completionDirection, bc, bcRatio);
  const abcdLevel = projectedLevel(c.price, abDirection, ab, abcdRatio);
  const requiredLevels = spec.abcdSoft ? [xaLevel, bcLevel] : [xaLevel, bcLevel, abcdLevel];
  const convergenceWidthXa = (Math.max(...requiredLevels) - Math.min(...requiredLevels)) / xa;
  if (convergenceWidthXa > spec.maxPrzWidthXa) return null;
  const padding = Math.max(atr * 0.1, xa * 0.005);
  return Object.freeze({
    low: round(Math.min(...requiredLevels) - padding),
    high: round(Math.max(...requiredLevels) + padding),
    convergenceWidthXa: round(convergenceWidthXa),
    levels: Object.freeze({
      xa: round(xaLevel),
      bc: round(bcLevel),
      abcd: round(abcdLevel),
      bcRatio,
      abcdRatio,
      abcdRole: spec.abcdSoft ? "supporting" : "required",
    }),
  });
}

function confirmationState(snapshot, points, prz, atr) {
  const d = points[4];
  const bullish = points[0].type === "low";
  const terminal = snapshot.candles[d.index];
  const xa = Math.abs(points[1].price - points[0].price);
  const buffer = Math.max(atr * 0.25, xa * 0.015);
  const stop = bullish
    ? Math.min(prz.low, d.price) - buffer
    : Math.max(prz.high, d.price) + buffer;
  let confirmation = null;
  let invalidated = false;
  for (let index = d.index + 1; index < snapshot.candles.length; index += 1) {
    const candle = snapshot.candles[index];
    if (bullish ? candle.close < stop : candle.close > stop) {
      invalidated = true;
      break;
    }
    if (!confirmation && (bullish
      ? candle.close > terminal.high && candle.close > candle.open
      : candle.close < terminal.low && candle.close < candle.open)) {
      confirmation = Object.freeze({
        index,
        time: candle.time,
        price: round(candle.close),
        trigger: round(bullish ? terminal.high : terminal.low),
      });
    }
  }
  const target1 = d.price + (points[1].price - d.price) * 0.382;
  const target2 = d.price + (points[1].price - d.price) * 0.618;
  const postTerminal = snapshot.candles.slice(d.index + 1);
  const firstTargetReached = postTerminal.some((candle) => (
    bullish ? candle.high >= target1 : candle.low <= target1
  ));
  const secondTargetReached = postTerminal.some((candle) => (
    bullish ? candle.high >= target2 : candle.low <= target2
  ));
  return Object.freeze({
    invalidated,
    status: confirmation ? "confirmed" : "tentative",
    tradeState: invalidated
      ? "invalidated"
      : secondTargetReached
        ? "completed"
        : firstTargetReached
          ? "partial-target-reached"
          : confirmation
            ? "active"
            : "awaiting-confirmation",
    terminalBar: Object.freeze({
      index: d.index,
      time: terminal.time,
      high: terminal.high,
      low: terminal.low,
      close: terminal.close,
    }),
    confirmation,
    stop: round(stop),
    targets: Object.freeze([round(target1), round(target2)]),
  });
}

function pointRecord(point, label) {
  return Object.freeze({
    id: point.id,
    label,
    index: point.index,
    time: point.time,
    price: round(point.price),
    type: point.type,
    status: point.status,
  });
}

export function evaluateHarmonicCandidate(snapshot, inputPoints, specOrId, {
  atr = null,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  const spec = typeof specOrId === "string"
    ? HARMONIC_PATTERN_SPECS.find((item) => item.id === specOrId)
    : specOrId;
  if (!spec) throw new TypeError("Unknown harmonic pattern specification");
  const points = inputPoints.map((point, index) => ({
    ...point,
    id: point.id || idFor("harmonic-point", snapshot.snapshotId, point.index, point.type, point.price),
    status: point.status === "tentative" ? "tentative" : "confirmed",
    time: Number(point.time ?? snapshot.candles[point.index]?.time),
  }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  if (!geometryMatches(points, direction, spec.completion)) return null;
  const ratios = calculateRatios(points);
  if (!ratios) return null;
  const hardChecks = [
    ["bXa", ratios.bXa, spec.bXa],
    ["cAb", ratios.cAb, spec.cAb],
    ["dXa", ratios.dXa, spec.dXa],
    ["dBc", ratios.dBc, spec.dBc],
    ["cdAb", ratios.cdAb, spec.cdAb],
  ];
  if (hardChecks.some(([, value, definition]) => !rangeMatches(value, definition))) return null;
  const resolvedAtr = Number.isFinite(atr) ? atr : averageTrueRange(snapshot.candles);
  const prz = potentialReversalZone(points, ratios, spec, resolvedAtr);
  if (!prz || points[4].price < prz.low - Math.abs(points[1].price - points[0].price) * 0.04
    || points[4].price > prz.high + Math.abs(points[1].price - points[0].price) * 0.04) return null;
  const confirmation = confirmationState(snapshot, points, prz, resolvedAtr);
  if (confirmation.invalidated) return null;
  const ratioScores = hardChecks.map(([, value, definition]) => rangeScore(value, definition));
  const convergenceScore = clamp(1 - prz.convergenceWidthXa / spec.maxPrzWidthXa, 0, 1);
  const recency = clamp(1 - (snapshot.candles.length - 1 - points[4].index) / 50, 0, 1);
  const score = round(average(ratioScores) * 0.72 + convergenceScore * 0.18 + recency * 0.1);
  const labelledPoints = Object.freeze(points.map((point, index) => pointRecord(point, "XABCD"[index])));
  const evidenceIds = Object.freeze([
    ...spec.ruleIds,
    ...labelledPoints.map((point) => point.id),
  ]);
  return Object.freeze({
    id: idFor("harmonic", snapshot.snapshotId, spec.id, direction, ...points.map((point) => point.index)),
    patternId: spec.id,
    patternName: spec.name,
    topologyId: "classic-xabcd",
    stage: "completed-pattern",
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    terminalLabel: "D",
    direction,
    status: confirmation.status,
    tradeState: confirmation.tradeState,
    score,
    points: labelledPoints,
    ratios,
    measurements: Object.freeze([
      Object.freeze({ label: "B/XA", value: ratios.bXa }),
      Object.freeze({ label: "C/AB", value: ratios.cAb }),
      Object.freeze({ label: "D/XA", value: ratios.dXa }),
      Object.freeze({ label: "CD/BC", value: ratios.dBc }),
      Object.freeze({ label: "CD/AB", value: ratios.cdAb }),
    ]),
    prz: Object.freeze({
      ...prz,
      components: Object.freeze(["XA completion", "BC projection", "AB=CD projection"]),
    }),
    terminalBar: confirmation.terminalBar,
    confirmation: confirmation.confirmation,
    actionLevels: Object.freeze({
      trigger: confirmation.confirmation?.trigger ?? round(direction === "bullish"
        ? confirmation.terminalBar.high
        : confirmation.terminalBar.low),
      stop: confirmation.stop,
      targets: confirmation.targets,
      targetBasis: "D→A 38.2%/61.8% retracement",
    }),
    ruleIds: spec.ruleIds,
    evidenceIds,
  });
}

function rawLocalSwings(snapshot, radius, atr) {
  const swings = [];
  const candles = snapshot.candles;
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const left = candles.slice(index - radius, index);
    const right = candles.slice(index + 1, index + radius + 1);
    const neighbourHigh = Math.max(...left.map((item) => item.high), ...right.map((item) => item.high));
    const neighbourLow = Math.min(...left.map((item) => item.low), ...right.map((item) => item.low));
    const highProminence = candle.high - neighbourHigh;
    const lowProminence = neighbourLow - candle.low;
    const high = candle.high > neighbourHigh;
    const low = candle.low < neighbourLow;
    if (!high && !low) continue;
    const type = high && low ? (highProminence >= lowProminence ? "high" : "low") : high ? "high" : "low";
    const price = type === "high" ? candle.high : candle.low;
    swings.push(Object.freeze({
      id: idFor("harmonic-swing", snapshot.snapshotId, index, type, price),
      index,
      time: candle.time,
      price,
      type,
      status: "confirmed",
      prominenceAtr: atr > 0 ? round(Math.max(highProminence, lowProminence, 0) / atr) : 0,
    }));
  }
  return swings;
}

function compactSwings(snapshot, rawSwings, atr, thresholdAtr = 0.5) {
  const threshold = Math.max(atr * thresholdAtr, snapshot.candles.at(-1).close * 0.001);
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
  const latest = snapshot.candles.at(-1);
  const previous = compacted.at(-1);
  if (latest && previous) {
    const type = previous.type === "high" ? "low" : "high";
    const price = type === "high" ? latest.high : latest.low;
    if (Math.abs(price - previous.price) >= threshold) {
      compacted.push(Object.freeze({
        id: idFor("harmonic-swing", snapshot.snapshotId, snapshot.candles.length - 1, type, price, "tentative"),
        index: snapshot.candles.length - 1,
        time: latest.time,
        price,
        type,
        status: "tentative",
        prominenceAtr: atr > 0 ? round(Math.abs(price - previous.price) / atr) : 0,
      }));
    }
  }
  return compacted;
}

function selectedEndpointDominates(swings, fromPosition, toPosition) {
  const selected = swings[toPosition];
  for (let position = fromPosition + 1; position < toPosition; position += 1) {
    const skipped = swings[position];
    if (skipped.type !== selected.type) continue;
    if (selected.type === "high" && skipped.price > selected.price) return false;
    if (selected.type === "low" && skipped.price < selected.price) return false;
  }
  return true;
}

function buildSwingSequences(swings, length) {
  const sequences = [];
  const visit = (positions, skippedPairs) => {
    if (sequences.length >= MAX_SEQUENCES_PER_PROFILE) return;
    if (positions.length === length) {
      sequences.push(Object.freeze({
        points: Object.freeze(positions.map((position) => swings[position])),
        selectionMode: skippedPairs ? `skip-${skippedPairs}-minor-pair${skippedPairs > 1 ? "s" : ""}` : "consecutive",
      }));
      return;
    }
    const previousPosition = positions.at(-1);
    for (const step of [1, 3]) {
      const nextPosition = previousPosition + step;
      const nextSkippedPairs = skippedPairs + (step === 3 ? 1 : 0);
      if (nextPosition >= swings.length || nextSkippedPairs > MAX_SKIPPED_SWING_PAIRS) continue;
      if (swings[nextPosition].type === swings[previousPosition].type) continue;
      if (!selectedEndpointDominates(swings, previousPosition, nextPosition)) continue;
      visit([...positions, nextPosition], nextSkippedPairs);
    }
  };
  for (let start = 0; start < swings.length; start += 1) visit([start], 0);
  return Object.freeze(sequences);
}

function createScanProfiles(snapshot, atr) {
  return Object.freeze(HARMONIC_SCAN_PROFILES
    .filter((profile) => snapshot.candles.length >= profile.minimumCandles)
    .map((profile) => {
      const rawSwings = rawLocalSwings(snapshot, profile.radius, atr);
      const swings = compactSwings(snapshot, rawSwings, atr, profile.thresholdAtr);
      return Object.freeze({
        ...profile,
        rawSwings: Object.freeze(rawSwings),
        swings: Object.freeze(swings),
        completedSequences: buildSwingSequences(swings, 5),
        developingSequences: buildSwingSequences(swings, 4),
      });
    }));
}

function projectedClassicPrz(points, spec, atr) {
  const [x, a, b, c] = points;
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  if ([xa, ab, bc].some((value) => value <= Number.EPSILON)) return null;
  const xaLevel = projectedLevel(a.price, Math.sign(x.price - a.price), xa, spec.dXaTarget);
  let best = null;
  for (const bcRatio of spec.dBcLevels) {
    const bcLevel = projectedLevel(c.price, Math.sign(b.price - c.price), bc, bcRatio);
    for (const abcdRatio of spec.cdAbLevels) {
      const abcdLevel = projectedLevel(c.price, Math.sign(b.price - a.price), ab, abcdRatio);
      const requiredLevels = spec.abcdSoft ? [xaLevel, bcLevel] : [xaLevel, bcLevel, abcdLevel];
      const convergenceWidthXa = (Math.max(...requiredLevels) - Math.min(...requiredLevels)) / xa;
      if (convergenceWidthXa > spec.maxPrzWidthXa) continue;
      if (!best || convergenceWidthXa < best.convergenceWidthXa) {
        best = { convergenceWidthXa, requiredLevels, xaLevel, bcLevel, abcdLevel, bcRatio, abcdRatio };
      }
    }
  }
  if (!best) return null;
  const padding = Math.max(atr * 0.1, xa * 0.005);
  return Object.freeze({
    low: round(Math.min(...best.requiredLevels) - padding),
    high: round(Math.max(...best.requiredLevels) + padding),
    convergenceWidthXa: round(best.convergenceWidthXa),
    levels: Object.freeze({
      xa: round(best.xaLevel),
      bc: round(best.bcLevel),
      abcd: round(best.abcdLevel),
      bcRatio: best.bcRatio,
      abcdRatio: best.abcdRatio,
      abcdRole: spec.abcdSoft ? "supporting" : "required",
    }),
  });
}

function projectedProgress(snapshot, fromPoint, targetPrice) {
  const direction = Math.sign(targetPrice - fromPoint.price);
  const distance = Math.abs(targetPrice - fromPoint.price);
  if (!direction || distance <= Number.EPSILON || fromPoint.index >= snapshot.candles.length - 1) return null;
  const candles = snapshot.candles.slice(fromPoint.index + 1);
  const observedPrice = direction > 0
    ? Math.max(...candles.map((candle) => candle.high))
    : Math.min(...candles.map((candle) => candle.low));
  const progress = (observedPrice - fromPoint.price) / (targetPrice - fromPoint.price);
  if (progress < 0.08 || progress > 1.2) return null;
  return Object.freeze({
    ratio: round(progress),
    observedPrice: round(observedPrice),
    currentPrice: round(snapshot.candles.at(-1).close),
  });
}

export function evaluateClassicDevelopingCandidate(snapshot, inputPoints, specOrId, {
  atr = null,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  const spec = typeof specOrId === "string"
    ? HARMONIC_PATTERN_SPECS.find((item) => item.id === specOrId)
    : specOrId;
  if (!spec) throw new TypeError("Unknown harmonic pattern specification");
  if (!Array.isArray(inputPoints) || inputPoints.length !== 4) return null;
  const points = inputPoints.map((point) => ({ ...point }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  const expected = expectedTypes(direction).slice(0, 4);
  if (points.some((point, index) => point.type !== expected[index])) return null;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return null;
  const [x, a, b, c] = points;
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(b.price, x.price, a.price) || !between(c.price, b.price, a.price)) return null;
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  if ([xa, ab, bc].some((value) => value <= Number.EPSILON)) return null;
  const ratios = Object.freeze({ bXa: round(ab / xa), cAb: round(bc / ab) });
  if (!rangeMatches(ratios.bXa, spec.bXa) || !rangeMatches(ratios.cAb, spec.cAb)) return null;
  const resolvedAtr = Number.isFinite(atr) ? atr : averageTrueRange(snapshot.candles);
  const prz = projectedClassicPrz(points, spec, resolvedAtr);
  if (!prz) return null;
  const projectedPrice = (prz.low + prz.high) / 2;
  if (spec.completion === "retracement" && !between(projectedPrice, x.price, a.price)) return null;
  if (spec.completion === "extension" && (direction === "bullish" ? projectedPrice >= x.price : projectedPrice <= x.price)) return null;
  const progress = projectedProgress(snapshot, c, projectedPrice);
  if (!progress) return null;
  const labelledPoints = Object.freeze(points.map((point, index) => pointRecord(point, "XABC"[index])));
  const ruleIds = Object.freeze([...spec.ruleIds, "HARMONIC-DEVELOPING-PROJECTION"]);
  const evidenceIds = Object.freeze([...ruleIds, ...labelledPoints.map((point) => point.id)]);
  const convergenceScore = clamp(1 - prz.convergenceWidthXa / spec.maxPrzWidthXa, 0, 1);
  const score = round(average([
    rangeScore(ratios.bXa, spec.bXa),
    rangeScore(ratios.cAb, spec.cAb),
    convergenceScore,
    clamp(1 - Math.abs(0.65 - progress.ratio), 0.2, 1),
  ]));
  return Object.freeze({
    id: idFor("harmonic-developing", snapshot.snapshotId, spec.id, direction, ...points.map((point) => point.index)),
    patternId: spec.id,
    patternName: spec.name,
    topologyId: "classic-xabcd",
    terminalLabel: "D",
    stage: "developing",
    status: "projected",
    tradeState: "developing",
    direction,
    score,
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    points: labelledPoints,
    ratios,
    measurements: Object.freeze([
      Object.freeze({ label: "B/XA", value: ratios.bXa }),
      Object.freeze({ label: "C/AB", value: ratios.cAb }),
    ]),
    prz: Object.freeze({
      ...prz,
      components: Object.freeze(["XA completion", "BC projection", "AB=CD projection"]),
    }),
    projectedTerminal: Object.freeze({ label: "D", price: round(projectedPrice) }),
    progress,
    ruleIds,
    evidenceIds,
  });
}

function compareCandidates(first, second) {
  const stateRank = (candidate) => candidate.tradeState === "active"
    ? 3
    : candidate.tradeState === "awaiting-confirmation"
      ? 2
      : candidate.tradeState === "partial-target-reached"
        ? 1
        : 0;
  return stateRank(second) - stateRank(first)
    || second.points.at(-1).index - first.points.at(-1).index
    || second.score - first.score
    || first.id.localeCompare(second.id);
}

function candidateKey(candidate) {
  return `${candidate.patternId}:${candidate.points.map((point) => point.index).join(":")}`;
}

function runClassicPatternSubengine(snapshot, scanProfiles, atr) {
  const candidates = [];
  const recentLimit = Math.max(20, Math.min(60, Math.floor(snapshot.candles.length * 0.25)));
  for (const profile of scanProfiles) {
    for (const sequence of profile.completedSequences) {
      const points = sequence.points;
      if (snapshot.candles.length - 1 - points[4].index > recentLimit) continue;
      for (const spec of HARMONIC_PATTERN_SPECS) {
        const candidate = evaluateHarmonicCandidate(snapshot, points, spec, {
          atr,
          scanProfileId: profile.id,
          selectionMode: sequence.selectionMode,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const deduplicated = new Map();
  for (const candidate of candidates.sort(compareCandidates)) {
    const pointKey = candidateKey(candidate);
    if (!deduplicated.has(pointKey)) deduplicated.set(pointKey, candidate);
  }
  const ranked = Object.freeze([...deduplicated.values()].sort(compareCandidates).slice(0, 12));
  const primaryCandidate = ranked.find((candidate) => candidate.tradeState !== "completed") || ranked[0] || null;
  const evidence = Object.freeze(ranked.flatMap((candidate) => [
    Object.freeze({
      id: candidate.id,
      summary: `${candidate.patternName} ${candidate.direction}，D/XA=${candidate.ratios.dXa}，PRZ ${candidate.prz.low}-${candidate.prz.high}`,
    }),
    ...candidate.ruleIds.map((ruleId) => Object.freeze({ id: ruleId, summary: `${candidate.patternName} 比例与 PRZ 规则` })),
  ]));
  return Object.freeze({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    engine: Object.freeze({ id: HARMONIC_ENGINE_ID, version: HARMONIC_ENGINE_VERSION }),
    status: ranked.length ? "succeeded" : "insufficient_data",
    direction: primaryCandidate?.direction || "neutral",
    bias: primaryCandidate?.direction || "neutral",
    coverage: Object.freeze({ candles: "available" }),
    pivots: Object.freeze({
      radius: scanProfiles.find((profile) => profile.id === "standard")?.radius || scanProfiles[0]?.radius || 2,
      atr: round(atr),
      rawCount: scanProfiles.reduce((total, profile) => total + profile.rawSwings.length, 0),
      compactCount: scanProfiles.reduce((total, profile) => total + profile.swings.length, 0),
      swings: Object.freeze((scanProfiles.find((profile) => profile.id === "standard")?.swings
        || scanProfiles[0]?.swings
        || []).slice(-80)),
      scanProfiles: Object.freeze(scanProfiles.map((profile) => Object.freeze({
        id: profile.id,
        radius: profile.radius,
        thresholdAtr: profile.thresholdAtr,
        rawCount: profile.rawSwings.length,
        compactCount: profile.swings.length,
        completedSequenceCount: profile.completedSequences.length,
        developingSequenceCount: profile.developingSequences.length,
      }))),
    }),
    structures: Object.freeze({ candidates: ranked, primaryCandidate, developingCandidates: Object.freeze([]), primaryDevelopingCandidate: null }),
    evidence,
  });
}

function runDevelopingPatternScan(snapshot, scanProfiles, atr) {
  const developing = [];
  const recentLimit = Math.max(30, Math.min(100, Math.floor(snapshot.candles.length * 0.4)));
  for (const profile of scanProfiles) {
    for (const sequence of profile.developingSequences) {
      const points = sequence.points;
      if (snapshot.candles.length - 1 - points[3].index > recentLimit) continue;
      const options = {
        atr,
        scanProfileId: profile.id,
        selectionMode: sequence.selectionMode,
      };
      for (const spec of HARMONIC_PATTERN_SPECS) {
        const candidate = evaluateClassicDevelopingCandidate(snapshot, points, spec, options);
        if (candidate) developing.push(candidate);
      }
      const shark = evaluateSharkDevelopingCandidate(snapshot, points, options);
      if (shark) developing.push(shark);
      const cypher = evaluateCypherDevelopingCandidate(snapshot, points, options);
      if (cypher) developing.push(cypher);
    }
  }
  const deduplicated = new Map();
  for (const candidate of developing.sort(compareCandidates)) {
    const pointKey = candidateKey(candidate);
    if (!deduplicated.has(pointKey)) deduplicated.set(pointKey, candidate);
  }
  return Object.freeze([...deduplicated.values()].sort(compareCandidates).slice(0, 12));
}

function combinedEvidence(candidates) {
  return Object.freeze(candidates.flatMap((candidate) => [
    Object.freeze({
      id: candidate.id,
      summary: `${candidate.patternName} ${candidate.direction}，${candidate.measurements
        .map((measurement) => `${measurement.label}=${measurement.value}`)
        .join("，")}，PRZ ${candidate.prz.low}-${candidate.prz.high}`,
    }),
    ...candidate.ruleIds.map((ruleId) => Object.freeze({
      id: ruleId,
      summary: `${candidate.patternName} 比例、结构与 PRZ 规则`,
    })),
  ]));
}

export function runHarmonicPatternEngine(snapshot) {
  const atr = averageTrueRange(snapshot.candles);
  const scanProfiles = createScanProfiles(snapshot, atr);
  const classic = runClassicPatternSubengine(snapshot, scanProfiles, atr);
  const completedSequences = Object.freeze(scanProfiles.flatMap((profile) => profile.completedSequences.map((sequence) => Object.freeze({
    ...sequence,
    profileId: profile.id,
  }))));
  const context = Object.freeze({
    sequences: completedSequences,
    atr: classic.pivots.atr,
  });
  const shark = runSharkPatternSubengine(snapshot, context);
  const cypher = runCypherPatternSubengine(snapshot, context);
  const candidates = [
    ...classic.structures.candidates,
    ...shark.candidates,
    ...cypher.candidates,
  ];
  const deduplicated = new Map();
  for (const candidate of candidates.sort(compareCandidates)) {
    const pointKey = candidateKey(candidate);
    if (!deduplicated.has(pointKey)) deduplicated.set(pointKey, candidate);
  }
  const ranked = Object.freeze([...deduplicated.values()].sort(compareCandidates).slice(0, 12));
  const primaryCandidate = ranked.find((candidate) => candidate.tradeState !== "completed") || ranked[0] || null;
  const developingCandidates = ranked.length ? Object.freeze([]) : runDevelopingPatternScan(snapshot, scanProfiles, atr);
  const primaryDevelopingCandidate = developingCandidates[0] || null;
  const subengines = Object.freeze([
    Object.freeze({
      id: HARMONIC_CLASSIC_SUBENGINE_ID,
      version: HARMONIC_CLASSIC_SUBENGINE_VERSION,
      status: classic.status,
      supportedPatternIds: Object.freeze(HARMONIC_PATTERN_SPECS.map((spec) => spec.id)),
    }),
    Object.freeze({
      id: HARMONIC_SHARK_SUBENGINE_ID,
      version: HARMONIC_SHARK_SUBENGINE_VERSION,
      status: shark.status,
      supportedPatternIds: Object.freeze(["shark"]),
    }),
    Object.freeze({
      id: HARMONIC_CYPHER_SUBENGINE_ID,
      version: HARMONIC_CYPHER_SUBENGINE_VERSION,
      status: cypher.status,
      supportedPatternIds: Object.freeze(["cypher"]),
    }),
  ]);
  return Object.freeze({
    ...classic,
    engine: Object.freeze({
      id: HARMONIC_ENGINE_ID,
      version: HARMONIC_ENGINE_VERSION,
      subengines,
    }),
    status: ranked.length ? "succeeded" : developingCandidates.length ? "developing" : "insufficient_data",
    direction: primaryCandidate?.direction || primaryDevelopingCandidate?.direction || "neutral",
    bias: primaryCandidate?.direction || primaryDevelopingCandidate?.direction || "neutral",
    structures: Object.freeze({ candidates: ranked, primaryCandidate, developingCandidates, primaryDevelopingCandidate }),
    evidence: combinedEvidence(ranked.length ? ranked : developingCandidates),
  });
}
