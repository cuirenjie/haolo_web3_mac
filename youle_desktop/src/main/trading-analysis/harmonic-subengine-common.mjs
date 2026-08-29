import crypto from "node:crypto";

export function harmonicId(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

export function harmonicRound(value) {
  return Number(Number(value).toPrecision(12));
}

export function harmonicClamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function harmonicRangeMatches(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum - 1e-9 && value <= maximum + 1e-9;
}

export function harmonicExactMatches(value, target, tolerance = 0.03) {
  return harmonicRangeMatches(value, target * (1 - tolerance), target * (1 + tolerance));
}

export function harmonicNearest(values, target) {
  return values.reduce((best, value) => (
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  ), values[0]);
}

export function harmonicRangeScore(value, minimum, maximum, ideal = (minimum + maximum) / 2) {
  if (!harmonicRangeMatches(value, minimum, maximum)) return 0;
  const span = Math.max(maximum - minimum, 0.001);
  return harmonicClamp(1 - Math.abs(value - ideal) / span, 0.35, 1);
}

export function harmonicExactScore(value, target, tolerance = 0.03) {
  if (!harmonicExactMatches(value, target, tolerance)) return 0;
  return harmonicClamp(1 - Math.abs(value - target) / Math.max(target * tolerance, 0.001), 0.35, 1);
}

export function harmonicPointRecords(points, labels) {
  return Object.freeze(points.map((point, index) => Object.freeze({
    id: point.id,
    label: labels[index],
    index: point.index,
    time: point.time,
    price: harmonicRound(point.price),
    type: point.type,
    status: point.status,
  })));
}

export function harmonicPrz(levels, { atr, scale, maxWidthScale = 0.1 } = {}) {
  const finiteLevels = levels.filter((level) => Number.isFinite(level));
  if (finiteLevels.length < 1 || !(scale > 0)) return null;
  const widthScale = finiteLevels.length > 1
    ? (Math.max(...finiteLevels) - Math.min(...finiteLevels)) / scale
    : 0;
  if (widthScale > maxWidthScale) return null;
  const padding = Math.max(Number(atr || 0) * 0.1, scale * 0.005);
  return Object.freeze({
    low: harmonicRound(Math.min(...finiteLevels) - padding),
    high: harmonicRound(Math.max(...finiteLevels) + padding),
    convergenceWidthXa: harmonicRound(widthScale),
  });
}

export function harmonicProjectedProgress(snapshot, fromPoint, targetPrice) {
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
    ratio: harmonicRound(progress),
    observedPrice: harmonicRound(observedPrice),
    currentPrice: harmonicRound(snapshot.candles.at(-1).close),
  });
}

export function harmonicDevelopingScore(scores, convergenceWidth, maximumWidth, progress) {
  const ratioScore = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;
  const convergence = harmonicClamp(1 - convergenceWidth / Math.max(maximumWidth, 0.001), 0, 1);
  const progressScore = harmonicClamp(1 - Math.abs(0.65 - progress), 0.2, 1);
  return harmonicRound(ratioScore * 0.55 + convergence * 0.3 + progressScore * 0.15);
}

export function harmonicConfirmation(snapshot, terminalPoint, prz, {
  atr,
  scale,
  direction,
  stopBoundary,
  targets,
} = {}) {
  const bullish = direction === "bullish";
  const terminal = snapshot.candles[terminalPoint.index];
  const buffer = Math.max(Number(atr || 0) * 0.25, Number(scale || 0) * 0.015);
  const structuralBoundary = Number.isFinite(stopBoundary) ? stopBoundary : terminalPoint.price;
  const stop = bullish
    ? Math.min(prz.low, terminalPoint.price, structuralBoundary) - buffer
    : Math.max(prz.high, terminalPoint.price, structuralBoundary) + buffer;
  let confirmation = null;
  let invalidated = false;
  for (let index = terminalPoint.index + 1; index < snapshot.candles.length; index += 1) {
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
        price: harmonicRound(candle.close),
        trigger: harmonicRound(bullish ? terminal.high : terminal.low),
      });
    }
  }
  const normalizedTargets = Object.freeze(targets.map(harmonicRound));
  const postTerminal = snapshot.candles.slice(terminalPoint.index + 1);
  const reached = normalizedTargets.map((target) => postTerminal.some((candle) => (
    bullish ? candle.high >= target : candle.low <= target
  )));
  return Object.freeze({
    invalidated,
    status: confirmation ? "confirmed" : "tentative",
    tradeState: invalidated
      ? "invalidated"
      : reached[1]
        ? "completed"
        : reached[0]
          ? "partial-target-reached"
          : confirmation
            ? "active"
            : "awaiting-confirmation",
    terminalBar: Object.freeze({
      index: terminalPoint.index,
      time: terminal.time,
      high: terminal.high,
      low: terminal.low,
      close: terminal.close,
    }),
    confirmation,
    stop: harmonicRound(stop),
    targets: normalizedTargets,
  });
}

export function harmonicCandidateScore(scores, convergenceWidth, maximumWidth, recency) {
  const ratioScore = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;
  const convergence = harmonicClamp(1 - convergenceWidth / Math.max(maximumWidth, 0.001), 0, 1);
  return harmonicRound(ratioScore * 0.72 + convergence * 0.18 + recency * 0.1);
}

export function harmonicRecency(snapshot, terminalIndex) {
  return harmonicClamp(1 - (snapshot.candles.length - 1 - terminalIndex) / 50, 0, 1);
}

export function harmonicSubengineResult(id, version, candidates) {
  return Object.freeze({
    id,
    version,
    status: candidates.length ? "succeeded" : "insufficient_data",
    candidates: Object.freeze(candidates),
  });
}
