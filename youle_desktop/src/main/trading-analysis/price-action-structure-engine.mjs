import crypto from "node:crypto";

export const PRICE_ACTION_SCAN_PROFILES = Object.freeze([
  Object.freeze({ id: "trigger", radius: 2, minimumMoveUnits: 0.32, minimumCandles: 50 }),
  Object.freeze({ id: "structure", radius: 4, minimumMoveUnits: 0.58, minimumCandles: 80 }),
  Object.freeze({ id: "context", radius: 7, minimumMoveUnits: 0.9, minimumCandles: 140 }),
]);

export function priceActionRound(value) {
  return Number(Number(value).toPrecision(12));
}

export function priceActionClamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function priceActionMedian(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function priceActionId(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

export function priceActionRangeUnit(candles, period = 60) {
  const sample = candles.slice(-Math.max(12, period));
  const ranges = sample.map((candle, index) => {
    const previousClose = index ? sample[index - 1].close : candle.open;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  const latest = candles.at(-1);
  return priceActionRound(Math.max(priceActionMedian(ranges), Number(latest?.close || 0) * 0.0005, Number.EPSILON));
}

export function priceActionBuffer(candles, rangeUnit, multiplier = 0.12) {
  const latest = candles.at(-1);
  return priceActionRound(Math.max(rangeUnit * multiplier, Number(latest?.close || 0) * 0.00025));
}

function rawSwings(snapshot, radius) {
  const swings = [];
  for (let index = radius; index < snapshot.candles.length - radius; index += 1) {
    const candle = snapshot.candles[index];
    const neighbours = snapshot.candles.slice(index - radius, index + radius + 1);
    const others = neighbours.filter((_, offset) => offset !== radius);
    const high = others.every((item) => candle.high >= item.high)
      && others.some((item) => candle.high > item.high);
    const low = others.every((item) => candle.low <= item.low)
      && others.some((item) => candle.low < item.low);
    if (!high && !low) continue;
    const highDistance = high ? candle.high - Math.max(...others.map((item) => item.high)) : -Infinity;
    const lowDistance = low ? Math.min(...others.map((item) => item.low)) - candle.low : -Infinity;
    const type = highDistance >= lowDistance ? "high" : "low";
    swings.push({
      id: priceActionId("pa-swing", snapshot.snapshotId, radius, index, type),
      index,
      time: candle.time,
      price: priceActionRound(type === "high" ? candle.high : candle.low),
      type,
      status: "confirmed",
    });
  }
  return swings;
}

function compactSwings(swings, minimumMove) {
  const result = [];
  for (const swing of swings) {
    const previous = result.at(-1);
    if (!previous) {
      result.push(swing);
      continue;
    }
    if (previous.type === swing.type) {
      const isMoreExtreme = swing.type === "high" ? swing.price >= previous.price : swing.price <= previous.price;
      if (isMoreExtreme) result[result.length - 1] = swing;
      continue;
    }
    if (Math.abs(swing.price - previous.price) >= minimumMove) result.push(swing);
  }
  return result;
}

function labelStructureSwings(swings, equalityTolerance) {
  let previousHigh = null;
  let previousLow = null;
  return Object.freeze(swings.map((swing) => {
    const previous = swing.type === "high" ? previousHigh : previousLow;
    let label = swing.type === "high" ? "H" : "L";
    if (previous) {
      const delta = swing.price - previous.price;
      if (Math.abs(delta) <= equalityTolerance) label = swing.type === "high" ? "EQH" : "EQL";
      else if (swing.type === "high") label = delta > 0 ? "HH" : "LH";
      else label = delta > 0 ? "HL" : "LL";
    }
    if (swing.type === "high") previousHigh = swing;
    else previousLow = swing;
    return Object.freeze({ ...swing, label });
  }));
}

function classifyMarketStructure(snapshot, swings, rangeUnit) {
  const highs = swings.filter((swing) => swing.type === "high").slice(-3);
  const lows = swings.filter((swing) => swing.type === "low").slice(-3);
  const latest = snapshot.candles.at(-1);
  const tolerance = Math.max(rangeUnit * 0.18, latest.close * 0.00035);
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const higherHigh = lastHighs.length === 2 && lastHighs[1].price > lastHighs[0].price + tolerance;
  const lowerHigh = lastHighs.length === 2 && lastHighs[1].price < lastHighs[0].price - tolerance;
  const higherLow = lastLows.length === 2 && lastLows[1].price > lastLows[0].price + tolerance;
  const lowerLow = lastLows.length === 2 && lastLows[1].price < lastLows[0].price - tolerance;
  const lastConfirmedHigh = highs.at(-1) || null;
  const lastConfirmedLow = lows.at(-1) || null;
  const breakBuffer = priceActionBuffer(snapshot.candles, rangeUnit, 0.16);
  const bullishBreak = lastConfirmedHigh && latest.close > lastConfirmedHigh.price + breakBuffer;
  const bearishBreak = lastConfirmedLow && latest.close < lastConfirmedLow.price - breakBuffer;
  let regime = "range";
  if ((higherHigh && higherLow) || bullishBreak) regime = "uptrend";
  else if ((lowerHigh && lowerLow) || bearishBreak) regime = "downtrend";
  else if ((higherHigh && lowerLow) || (lowerHigh && higherLow)) regime = "transition";
  const direction = regime === "uptrend" ? "bullish" : regime === "downtrend" ? "bearish" : "neutral";
  const event = bullishBreak ? "bullish-structure-break" : bearishBreak ? "bearish-structure-break" : "none";
  return Object.freeze({
    regime,
    direction,
    event,
    tolerance: priceActionRound(tolerance),
    lastHigh: lastConfirmedHigh,
    lastLow: lastConfirmedLow,
    facts: Object.freeze({ higherHigh, lowerHigh, higherLow, lowerLow }),
  });
}

function clusterZones(snapshot, swings, rangeUnit) {
  const latestIndex = snapshot.candles.length - 1;
  const latestPrice = snapshot.candles.at(-1).close;
  const tolerance = Math.max(rangeUnit * 0.55, latestPrice * 0.00055);
  const clusters = [];
  const unique = [...new Map(swings.map((swing) => [`${swing.index}:${swing.type}`, swing])).values()]
    .filter((swing) => latestIndex - swing.index <= 220)
    .sort((a, b) => a.price - b.price);
  for (const swing of unique) {
    let cluster = clusters.find((item) => Math.abs(swing.price - item.center) <= tolerance);
    if (!cluster) {
      cluster = { points: [], center: swing.price };
      clusters.push(cluster);
    }
    cluster.points.push(swing);
    cluster.center = cluster.points.reduce((sum, point) => sum + point.price, 0) / cluster.points.length;
  }
  const zones = clusters.map((cluster) => {
    const prices = cluster.points.map((point) => point.price);
    const mostRecentIndex = Math.max(...cluster.points.map((point) => point.index));
    const highTouches = cluster.points.filter((point) => point.type === "high").length;
    const lowTouches = cluster.points.length - highTouches;
    const pad = Math.max(rangeUnit * 0.18, (Math.max(...prices) - Math.min(...prices)) * 0.3, latestPrice * 0.00018);
    const lower = priceActionRound(Math.max(Number.EPSILON, Math.min(...prices) - pad));
    const upper = priceActionRound(Math.max(...prices) + pad);
    const center = priceActionRound((lower + upper) / 2);
    const role = latestPrice > upper ? "support" : latestPrice < lower ? "resistance" : "decision";
    const age = latestIndex - mostRecentIndex;
    const recency = priceActionClamp(1 - age / 220, 0, 1);
    const score = priceActionRound(priceActionClamp(cluster.points.length / 4, 0, 1) * 0.65 + recency * 0.35);
    return Object.freeze({
      id: priceActionId("pa-zone", snapshot.snapshotId, center, cluster.points.map((point) => point.index).join("-")),
      lower,
      upper,
      center,
      role,
      touches: cluster.points.length,
      highTouches,
      lowTouches,
      mostRecentIndex,
      score,
      evidenceIds: Object.freeze(cluster.points.map((point) => point.id)),
    });
  }).filter((zone) => zone.touches >= 2 || latestIndex - zone.mostRecentIndex <= 36);

  const recent = snapshot.candles.slice(-48);
  const offset = snapshot.candles.length - recent.length;
  for (const [role, price, index] of [
    ["resistance", Math.max(...recent.map((candle) => candle.high)), recent.findLastIndex((candle) => candle.high === Math.max(...recent.map((item) => item.high))) + offset],
    ["support", Math.min(...recent.map((candle) => candle.low)), recent.findLastIndex((candle) => candle.low === Math.min(...recent.map((item) => item.low))) + offset],
  ]) {
    if (zones.some((zone) => price >= zone.lower - tolerance && price <= zone.upper + tolerance)) continue;
    zones.push(Object.freeze({
      id: priceActionId("pa-zone-fallback", snapshot.snapshotId, role, price, index),
      lower: priceActionRound(Math.max(Number.EPSILON, price - rangeUnit * 0.18)),
      upper: priceActionRound(price + rangeUnit * 0.18),
      center: priceActionRound(price),
      role,
      touches: 1,
      highTouches: role === "resistance" ? 1 : 0,
      lowTouches: role === "support" ? 1 : 0,
      mostRecentIndex: index,
      score: 0.28,
      evidenceIds: Object.freeze([]),
    }));
  }
  return Object.freeze(zones.sort((a, b) => b.score - a.score || b.mostRecentIndex - a.mostRecentIndex));
}

export function runPriceActionStructureEngine(snapshot) {
  const rangeUnit = priceActionRangeUnit(snapshot.candles);
  const equalityTolerance = Math.max(rangeUnit * 0.2, snapshot.candles.at(-1).close * 0.00035);
  const profiles = PRICE_ACTION_SCAN_PROFILES
    .filter((profile) => snapshot.candles.length >= profile.minimumCandles)
    .map((profile) => {
      const raw = rawSwings(snapshot, profile.radius);
      const swings = compactSwings(raw, rangeUnit * profile.minimumMoveUnits);
      return Object.freeze({ ...profile, rawCount: raw.length, swings: labelStructureSwings(swings, equalityTolerance) });
    });
  const primaryProfile = profiles.find((profile) => profile.id === "structure") || profiles[0];
  const swings = primaryProfile?.swings || Object.freeze([]);
  const allSwings = profiles.flatMap((profile) => profile.swings);
  return Object.freeze({
    engineId: "price-action-structure",
    engineVersion: "1.0.0",
    rangeUnit,
    rangeUnitSemantics: "OHLC median true-range normalization only; not a trading indicator",
    profiles: Object.freeze(profiles),
    swings,
    market: classifyMarketStructure(snapshot, swings, rangeUnit),
    zones: clusterZones(snapshot, allSwings, rangeUnit),
  });
}

