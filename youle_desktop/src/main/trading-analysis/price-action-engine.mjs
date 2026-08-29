function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function ema(values, period) {
  if (!values.length) return 0;
  const multiplier = 2 / (Math.max(2, period) + 1);
  let result = values[0];
  for (let index = 1; index < values.length; index += 1) {
    result = values[index] * multiplier + result * (1 - multiplier);
  }
  return result;
}

function averageTrueRange(candles, period = 14) {
  const sample = candles.slice(-Math.max(2, period + 1));
  if (sample.length < 2) return 0;
  const ranges = [];
  for (let index = 1; index < sample.length; index += 1) {
    const candle = sample[index];
    const previousClose = sample[index - 1].close;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ));
  }
  return average(ranges);
}

function rawPivots(candles, radius = 2) {
  const pivots = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const neighbors = candles.slice(index - radius, index + radius + 1);
    const isHigh = neighbors.every((item, neighborIndex) => neighborIndex === radius || candle.high > item.high);
    const isLow = neighbors.every((item, neighborIndex) => neighborIndex === radius || candle.low < item.low);
    if (isHigh) pivots.push({ index, time: candle.time, price: candle.high, type: "high" });
    if (isLow) pivots.push({ index, time: candle.time, price: candle.low, type: "low" });
  }
  return pivots.sort((first, second) => first.index - second.index);
}

function filterAlternatingPivots(pivots, minimumMove) {
  const result = [];
  for (const pivot of pivots) {
    const previous = result.at(-1);
    if (!previous) {
      result.push(pivot);
      continue;
    }
    if (previous.type === pivot.type) {
      const moreExtreme = pivot.type === "high" ? pivot.price > previous.price : pivot.price < previous.price;
      if (moreExtreme) result[result.length - 1] = pivot;
      continue;
    }
    if (Math.abs(pivot.price - previous.price) >= minimumMove) result.push(pivot);
  }
  return result.map((pivot, index) => ({ ...pivot, id: `price-pivot-${index}-${pivot.time}` }));
}

function nearestAbove(values, reference, minimumGap) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= reference + minimumGap)
    .sort((first, second) => first - second)[0] ?? null;
}

function nearestBelow(values, reference, minimumGap) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value <= reference - minimumGap)
    .sort((first, second) => second - first)[0] ?? null;
}

export function runPriceActionEngine(snapshot) {
  const candles = snapshot.candles;
  const latest = candles.at(-1);
  const closed = candles.length > 31 ? candles.slice(0, -1) : candles;
  const recent = closed.slice(-Math.min(48, closed.length));
  const closes = closed.map((candle) => candle.close);
  const atr = Math.max(averageTrueRange(closed), latest.close * 0.001);
  const pivots = filterAlternatingPivots(rawPivots(closed), atr * 0.55);
  const recentPivots = pivots.slice(-10);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const highPivots = recentPivots.filter((pivot) => pivot.type === "high");
  const lowPivots = recentPivots.filter((pivot) => pivot.type === "low");
  const minimumGap = Math.max(atr * 0.35, latest.close * 0.0015);
  const resistance = nearestAbove([...highPivots.map((pivot) => pivot.price), recentHigh], latest.close, minimumGap)
    ?? latest.close + Math.max(atr, minimumGap);
  const support = nearestBelow([...lowPivots.map((pivot) => pivot.price), recentLow], latest.close, minimumGap)
    ?? Math.max(Number.EPSILON, latest.close - Math.max(atr, minimumGap));

  const ema20 = ema(closes.slice(-80), 20);
  const ema50 = ema(closes.slice(-120), 50);
  const ema20Previous = ema(closes.slice(-86, -6), 20);
  const momentumBase = recent.at(-Math.min(20, recent.length))?.close || recent[0]?.close || latest.close;
  const recentReturn = momentumBase ? (latest.close - momentumBase) / momentumBase : 0;
  const volumeAverage = average(recent.slice(0, -1).map((candle) => candle.volume));
  const volumeRatio = volumeAverage > 0 ? latest.volume / volumeAverage : 1;
  let score = clamp(recentReturn / 0.04, -1, 1) * 0.35;
  score += latest.close > ema20 ? 0.16 : -0.16;
  score += ema20 > ema50 ? 0.18 : -0.18;
  score += ema20 > ema20Previous ? 0.12 : -0.12;
  const lastTwoHighs = highPivots.slice(-2);
  const lastTwoLows = lowPivots.slice(-2);
  if (lastTwoHighs.length === 2) score += lastTwoHighs[1].price > lastTwoHighs[0].price ? 0.09 : -0.09;
  if (lastTwoLows.length === 2) score += lastTwoLows[1].price > lastTwoLows[0].price ? 0.09 : -0.09;
  score = clamp(score, -1, 1);
  const trend = score >= 0.2 ? "bullish" : score <= -0.2 ? "bearish" : "neutral";
  const riseWeight = Math.round(clamp(0.5 + score * 0.22, 0.3, 0.7) * 100);

  const longTrigger = resistance;
  const shortTrigger = support;
  const longInvalidation = Math.max(support, longTrigger - Math.max(atr * 1.25, longTrigger - support));
  const shortInvalidation = Math.min(resistance, shortTrigger + Math.max(atr * 1.25, resistance - shortTrigger));
  const longRisk = Math.max(longTrigger - longInvalidation, atr * 0.75);
  const shortRisk = Math.max(shortInvalidation - shortTrigger, atr * 0.75);
  const levels = Object.freeze({
    currentPrice: latest.close,
    support,
    resistance,
    longTrigger,
    longTarget: longTrigger + longRisk * 1.5,
    longInvalidation,
    shortTrigger,
    shortTarget: Math.max(Number.EPSILON, shortTrigger - shortRisk * 1.5),
    shortInvalidation,
    waitZone: Object.freeze({ lower: shortTrigger, upper: longTrigger }),
    confirmation: "等待当前周期 K 线收盘确认，盘中瞬时刺破不算有效突破",
  });
  return Object.freeze({
    schemaVersion: 1,
    engineId: "price-action",
    engineVersion: "1.0.0",
    status: "succeeded",
    trend,
    score,
    riseWeight,
    fallWeight: 100 - riseWeight,
    indicators: Object.freeze({ atr, ema20, ema50, recentReturn, volumeRatio }),
    pivots: Object.freeze(recentPivots.map((pivot) => Object.freeze(pivot))),
    levels,
    evidence: Object.freeze([
      `最新价 ${latest.close}`,
      `EMA20 ${ema20}`,
      `EMA50 ${ema50}`,
      `最近动量 ${(recentReturn * 100).toFixed(2)}%`,
      `量能比 ${volumeRatio.toFixed(2)}`,
    ]),
    statistics: Object.freeze({
      candleCount: candles.length,
      pivotCount: pivots.length,
      recentWindow: recent.length,
    }),
  });
}
