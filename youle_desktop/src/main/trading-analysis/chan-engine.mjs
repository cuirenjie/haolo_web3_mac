import crypto from "node:crypto";
import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";

export const CHAN_ENGINE_ID = "chan";
export const CHAN_ENGINE_VERSION = "0.1.0";

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}
function contains(first, second) {
  return (first.high >= second.high && first.low <= second.low)
    || (second.high >= first.high && second.low <= first.low);
}

function inferDirection(previous, current, fallback = "up") {
  if (current.high > previous.high && current.low > previous.low) return "up";
  if (current.high < previous.high && current.low < previous.low) return "down";
  return fallback;
}

export function mergeChanInclusions(candles) {
  const merged = [];
  let direction = "up";
  for (const [sourceIndex, candle] of candles.entries()) {
    const current = {
      ...candle,
      sourceStartIndex: sourceIndex,
      sourceEndIndex: sourceIndex,
    };
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(current);
      continue;
    }
    if (!contains(previous, current)) {
      direction = inferDirection(previous, current, direction);
      merged.push(current);
      continue;
    }
    const high = direction === "up"
      ? Math.max(previous.high, current.high)
      : Math.min(previous.high, current.high);
    const low = direction === "up"
      ? Math.max(previous.low, current.low)
      : Math.min(previous.low, current.low);
    merged[merged.length - 1] = {
      ...current,
      open: Math.min(Math.max(previous.open, low), high),
      close: Math.min(Math.max(current.close, low), high),
      high,
      low,
      volume: previous.volume + current.volume,
      sourceStartIndex: previous.sourceStartIndex,
    };
  }
  return merged;
}

export function detectChanFractals(mergedCandles) {
  const fractals = [];
  for (let index = 1; index < mergedCandles.length - 1; index += 1) {
    const previous = mergedCandles[index - 1];
    const current = mergedCandles[index];
    const next = mergedCandles[index + 1];
    const top = current.high > previous.high
      && current.high > next.high
      && current.low > previous.low
      && current.low > next.low;
    const bottom = current.low < previous.low
      && current.low < next.low
      && current.high < previous.high
      && current.high < next.high;
    if (!top && !bottom) continue;
    const type = top ? "top" : "bottom";
    const price = top ? current.high : current.low;
    fractals.push({
      id: idFor("chan-fractal", current.time, type, price),
      type,
      mergedIndex: index,
      time: current.time,
      price,
      sourceStartIndex: current.sourceStartIndex,
      sourceEndIndex: current.sourceEndIndex,
      confirmedAt: next.time,
    });
  }
  return fractals;
}

function isMoreExtreme(candidate, previous) {
  return candidate.type === "top"
    ? candidate.price >= previous.price
    : candidate.price <= previous.price;
}

export function buildChanPens(fractals, minimumMergedBarSeparation = 4) {
  const selected = [];
  for (const fractal of fractals) {
    const previous = selected.at(-1);
    if (!previous) {
      selected.push(fractal);
      continue;
    }
    if (previous.type === fractal.type) {
      if (isMoreExtreme(fractal, previous)) selected[selected.length - 1] = fractal;
      continue;
    }
    if (fractal.mergedIndex - previous.mergedIndex < minimumMergedBarSeparation) continue;
    selected.push(fractal);
  }
  return selected.map((fractal, index) => ({
    ...fractal,
    penPointId: idFor("chan-pen-point", index, fractal.id),
  }));
}

export function buildChanCenters(penPoints) {
  const centers = [];
  for (let index = 0; index <= penPoints.length - 4; index += 1) {
    const window = penPoints.slice(index, index + 4);
    const segments = [
      [window[0].price, window[1].price],
      [window[1].price, window[2].price],
      [window[2].price, window[3].price],
    ];
    const lower = Math.max(...segments.map(([first, second]) => Math.min(first, second)));
    const upper = Math.min(...segments.map(([first, second]) => Math.max(first, second)));
    if (!(upper > lower)) continue;
    const previous = centers.at(-1);
    const center = {
      id: idFor("chan-center", window[0].time, window[3].time, lower, upper),
      startTime: window[0].time,
      endTime: window[3].time,
      lower,
      upper,
      penPointIds: window.map((point) => point.penPointId),
    };
    if (
      previous
      && previous.endTime >= center.startTime
      && Math.min(previous.upper, center.upper) > Math.max(previous.lower, center.lower)
    ) {
      previous.endTime = center.endTime;
      previous.lower = Math.max(previous.lower, center.lower);
      previous.upper = Math.min(previous.upper, center.upper);
      previous.penPointIds = [...new Set([...previous.penPointIds, ...center.penPointIds])];
      continue;
    }
    centers.push(center);
  }
  return centers;
}

export function runChanTheoryEngine(snapshot, options = {}) {
  const mergedCandles = mergeChanInclusions(snapshot.candles);
  const fractals = detectChanFractals(mergedCandles);
  const allPenPoints = buildChanPens(fractals, options.minimumMergedBarSeparation ?? 4);
  const allCenters = buildChanCenters(allPenPoints);
  const penPoints = allPenPoints.slice(-24);
  const visiblePenIds = new Set(penPoints.map((point) => point.penPointId));
  const centers = allCenters
    .filter((center) => center.penPointIds.some((id) => visiblePenIds.has(id)))
    .slice(-8);
  const visibleFractalIds = new Set(penPoints.map((point) => point.id));
  const visibleFractals = fractals.filter((fractal) => visibleFractalIds.has(fractal.id));
  const status = penPoints.length >= 2 ? "succeeded" : "insufficient_data";
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    resultId: idFor("chan-result", snapshot.snapshotId, CHAN_ENGINE_VERSION),
    engineId: CHAN_ENGINE_ID,
    engineVersion: CHAN_ENGINE_VERSION,
    snapshotId: snapshot.snapshotId,
    status,
    parameters: {
      minimumMergedBarSeparation: options.minimumMergedBarSeparation ?? 4,
      inclusionPolicy: "directional-merge-v1",
    },
    statistics: {
      sourceCandleCount: snapshot.candles.length,
      mergedCandleCount: mergedCandles.length,
      fractalCount: fractals.length,
      penPointCount: allPenPoints.length,
      centerCount: allCenters.length,
    },
    structures: {
      penPoints,
      centers,
      fractals: visibleFractals,
    },
    evidence: penPoints.map((point) => ({
      evidenceId: point.penPointId,
      kind: "confirmed_fractal",
      sourceFractalId: point.id,
      confirmedAt: point.confirmedAt,
    })),
  };
}
