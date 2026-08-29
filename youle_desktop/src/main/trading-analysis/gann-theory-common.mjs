export const GANN_THEORY_ENGINE_ID = "gann-theory-deterministic-v1";

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function gannIntervalSeconds(interval, candles = []) {
  const source = String(interval || "").trim().toUpperCase();
  if (source === "1D") return 86_400;
  if (source === "1W") return 604_800;
  const minutes = Number(source);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
  const gaps = candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((gap) => gap > 0);
  return median(gaps) || 3_600;
}

function snapshotSeconds(snapshotTime) {
  const value = Number(snapshotTime);
  return value > 100_000_000_000 ? value / 1_000 : value;
}

export function gannClosedCandles(snapshot) {
  const intervalSeconds = gannIntervalSeconds(snapshot.interval, snapshot.candles);
  const boundary = snapshotSeconds(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + intervalSeconds <= boundary + 1e-6);
  return Object.freeze({
    candles: Object.freeze(candles),
    intervalSeconds,
    excludedLiveCandles: snapshot.candles.length - candles.length,
  });
}

function medianRange(candles) {
  const ranges = candles.slice(-160).map((candle) => Math.max(0, candle.high - candle.low));
  return Math.max(median(ranges), candles.at(-1)?.close * 0.0001 || Number.EPSILON);
}

function localPivots(candles, unit, radius = 3) {
  const pivots = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const window = candles.slice(index - radius, index + radius + 1);
    const otherHighs = window.filter((_, offset) => offset !== radius).map((item) => item.high);
    const otherLows = window.filter((_, offset) => offset !== radius).map((item) => item.low);
    const high = candle.high >= Math.max(...otherHighs)
      && candle.high - Math.min(...window.map((item) => item.low)) >= unit * 1.15;
    const low = candle.low <= Math.min(...otherLows)
      && Math.max(...window.map((item) => item.high)) - candle.low >= unit * 1.15;
    if (!high && !low) continue;
    const highProminence = candle.high - median(window.map((item) => item.close));
    const lowProminence = median(window.map((item) => item.close)) - candle.low;
    const type = high && low ? (highProminence >= lowProminence ? "high" : "low") : high ? "high" : "low";
    pivots.push({
      id: `gann-pivot-${type}-${candle.time}`,
      type,
      index,
      time: candle.time,
      price: type === "high" ? candle.high : candle.low,
      source: "confirmed-local-extreme",
    });
  }
  const alternating = [];
  for (const pivot of pivots) {
    const previous = alternating.at(-1);
    if (!previous) {
      alternating.push(pivot);
      continue;
    }
    if (previous.type === pivot.type) {
      const isMoreExtreme = pivot.type === "high" ? pivot.price >= previous.price : pivot.price <= previous.price;
      if (isMoreExtreme) alternating[alternating.length - 1] = pivot;
      continue;
    }
    if (Math.abs(pivot.price - previous.price) >= unit * 1.1) alternating.push(pivot);
  }
  return alternating;
}

function fallbackPivots(candles, radius) {
  const eligible = candles.slice(0, Math.max(2, candles.length - radius));
  const start = Math.max(0, eligible.length - 120);
  const sample = eligible.slice(start);
  const segments = 4;
  const candidates = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const from = Math.floor(sample.length * segment / segments);
    const to = Math.floor(sample.length * (segment + 1) / segments);
    const chunk = sample.slice(from, to);
    if (!chunk.length) continue;
    const high = chunk.reduce((best, candle, index) => candle.high > best.candle.high ? { candle, index } : best, { candle: chunk[0], index: 0 });
    const low = chunk.reduce((best, candle, index) => candle.low < best.candle.low ? { candle, index } : best, { candle: chunk[0], index: 0 });
    for (const [type, item] of [["high", high], ["low", low]]) {
      const index = start + from + item.index;
      candidates.push({
        id: `gann-fallback-${type}-${item.candle.time}`,
        type,
        index,
        time: item.candle.time,
        price: type === "high" ? item.candle.high : item.candle.low,
        source: "confirmed-segment-extreme",
      });
    }
  }
  candidates.sort((first, second) => first.index - second.index || (first.type === "low" ? -1 : 1));
  const alternating = [];
  for (const pivot of candidates) {
    const previous = alternating.at(-1);
    if (previous?.index === pivot.index) {
      const previousMove = alternating.length > 1 ? Math.abs(previous.price - alternating.at(-2).price) : 0;
      const currentMove = alternating.length > 1 ? Math.abs(pivot.price - alternating.at(-2).price) : 0;
      if (currentMove > previousMove) alternating[alternating.length - 1] = pivot;
      continue;
    }
    if (previous?.type === pivot.type) {
      const isMoreExtreme = pivot.type === "high" ? pivot.price > previous.price : pivot.price < previous.price;
      if (isMoreExtreme) alternating[alternating.length - 1] = pivot;
      continue;
    }
    alternating.push(pivot);
  }
  return alternating;
}

function priceCalibration(pivots, anchor, unit) {
  const earlier = pivots.filter((pivot) => pivot.index < anchor.index);
  const priorSame = [...earlier].reverse().find((pivot) => pivot.type === anchor.type) || null;
  const priorOpposite = [...earlier].reverse().find((pivot) => pivot.type !== anchor.type) || null;
  const sameBars = priorSame ? anchor.index - priorSame.index : 0;
  const sameRange = priorSame ? Math.abs(anchor.price - priorSame.price) : 0;
  if (priorSame && sameBars >= 6 && sameRange >= unit * 1.5) {
    return { method: "same-type-pivot", control: priorSame, opposite: priorOpposite, bars: sameBars, priceRange: sameRange };
  }
  const oppositeBars = priorOpposite ? anchor.index - priorOpposite.index : 0;
  const oppositeRange = priorOpposite ? Math.abs(anchor.price - priorOpposite.price) : 0;
  if (priorOpposite && oppositeBars >= 4 && oppositeRange >= unit * 1.5) {
    return { method: "opposite-pivot-fallback", control: priorOpposite, opposite: priorOpposite, bars: oppositeBars, priceRange: oppositeRange };
  }
  return {
    method: "range-unit-fallback",
    control: priorSame || priorOpposite,
    opposite: priorOpposite,
    bars: 24,
    priceRange: unit * 6,
  };
}

export function prepareGannContext(snapshot) {
  const closed = gannClosedCandles(snapshot);
  if (closed.candles.length < 40) throw new TypeError("Gann Theory requires at least 40 closed candles");
  const unit = medianRange(closed.candles);
  let pivots = localPivots(closed.candles, unit);
  let anchorQuality = "confirmed-local-extreme";
  if (pivots.length < 3) {
    pivots = fallbackPivots(closed.candles, 3);
    anchorQuality = "confirmed-segment-extreme";
  }
  const anchor = pivots.at(-1);
  if (!anchor) throw new TypeError("Gann Theory could not establish a confirmed anchor");
  const calibration = priceCalibration(pivots, anchor, unit);
  const cycleBars = clamp(Math.round(calibration.bars), 8, 96);
  const projectedRange = Math.max(calibration.priceRange, unit * 2.5);
  const pricePerBar = projectedRange / cycleBars;
  const direction = anchor.type === "low" ? "bullish" : "bearish";
  const directionSign = direction === "bullish" ? 1 : -1;
  const latest = closed.candles.at(-1);
  const latestIndex = closed.candles.length - 1;
  const elapsedBars = Math.max(0, latestIndex - anchor.index);
  const projectionTurns = clamp(Math.ceil((elapsedBars + 8) / cycleBars), 1, 3);
  const projectionSpanBars = cycleBars * projectionTurns;
  const projectionPriceRange = pricePerBar * projectionSpanBars;
  const projectionEndIndex = anchor.index + projectionSpanBars;
  const projectionEndTime = anchor.time + projectionSpanBars * closed.intervalSeconds;
  const oneByOneNow = anchor.price + directionSign * pricePerBar * Math.max(0, latestIndex - anchor.index);
  const previousOpposite = calibration.opposite || [...pivots].reverse().find((pivot) => pivot.type !== anchor.type) || null;
  return Object.freeze({
    candles: closed.candles,
    intervalSeconds: closed.intervalSeconds,
    excludedLiveCandles: closed.excludedLiveCandles,
    latest,
    latestIndex,
    rangeUnit: unit,
    pivots: Object.freeze(pivots.map(Object.freeze)),
    anchor: Object.freeze(anchor),
    anchorQuality,
    previousOpposite: previousOpposite ? Object.freeze(previousOpposite) : null,
    direction,
    directionSign,
    calibration: Object.freeze({
      method: calibration.method,
      controlPivotId: calibration.control?.id || null,
      cycleBars,
      priceRange: projectedRange,
      pricePerBar,
    }),
    projection: Object.freeze({
      endIndex: projectionEndIndex,
      endTime: projectionEndTime,
      spanBars: projectionSpanBars,
      turns: projectionTurns,
      priceRange: projectionPriceRange,
      endPrice: Math.max(Number.EPSILON, anchor.price + directionSign * projectionPriceRange),
      oneByOneNow: Math.max(Number.EPSILON, oneByOneNow),
    }),
  });
}

export function gannPoint(context, index, price) {
  return Object.freeze({
    time: context.anchor.time + (index - context.anchor.index) * context.intervalSeconds,
    price: Math.max(Number.EPSILON, price),
  });
}
