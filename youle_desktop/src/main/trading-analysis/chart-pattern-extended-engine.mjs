import {
  average, boundaryFromPoints, boundaryContainment, chartPatternId, chartPatternRound,
  clamp, findClosedBreakout, geometryScore, linePrice, patternBreakoutWindow,
  patternFormationAtr, pointRecords, priorTrend, projectedActionLevels,
  resolvePatternLifecycle,
} from "./chart-pattern-common.mjs";
import { evaluateCupAndHandle } from "./chart-pattern-continuation-engine.mjs";

export const EXTENDED_PATTERN_NAMES = Object.freeze({
  "ascending-channel": "上升通道", "descending-channel": "下降通道",
  "broadening-formation": "扩散三角形", "ascending-broadening-wedge": "上升扩散楔形",
  "descending-broadening-wedge": "下降扩散楔形",
  "rounding-bottom": "圆弧底", "rounding-top": "圆弧顶",
  "inverse-cup-and-handle": "倒杯柄形态", "old-duck-head": "老鸭头",
  "diamond-top": "菱形顶", "diamond-bottom": "菱形底",
});
export const EXTENDED_PATTERN_IDS = Object.freeze(Object.keys(EXTENDED_PATTERN_NAMES));

function candidate(snapshot, { patternId, points, atr, boundaries = {}, direction = "neutral",
  height, upperAt, lowerAt, category = "bilateral", metrics = {}, profileId = "direct" }) {
  const end = points.at(-1).index, duration = end - points[0].index;
  const searchBars = Number.isFinite(metrics.apexIndex)
    ? Math.max(0, Math.min(patternBreakoutWindow(duration), Math.floor(metrics.apexIndex - end))) : patternBreakoutWindow(duration);
  const breakout = findClosedBreakout(snapshot, end, upperAt, lowerAt, atr, {
    allowedDirection: direction === "neutral" ? "both" : direction === "bullish" ? "up" : "down",
    maxSearchBars: searchBars,
  });
  const actualDirection = breakout.direction === "up" ? "bullish" : breakout.direction === "down" ? "bearish" : direction;
  const triggerIndex = breakout.index ?? end + 1;
  const value = (level) => typeof level === "function" ? level(triggerIndex) : level;
  const longLevels = projectedActionLevels({ direction: "bullish", trigger: value(upperAt), oppositeBoundary: value(lowerAt), height, atr });
  const shortLevels = projectedActionLevels({ direction: "bearish", trigger: value(lowerAt), oppositeBoundary: value(upperAt), height, atr });
  const actionLevels = actualDirection === "bullish" ? longLevels : actualDirection === "bearish" ? shortLevels : null;
  // A valid geometry at tiny prices must not produce negative target/stop coordinates.
  const relevant = actualDirection === "neutral" ? [longLevels, shortLevels] : [actionLevels];
  if (relevant.some(levels => [levels.trigger, levels.stop, ...levels.targets].some(p => !Number.isFinite(p) || p <= 0))) return null;
  const lifecycleState = resolvePatternLifecycle(snapshot, { breakout, actionLevels, direction: actualDirection,
    lastStructureIndex: end, structureDuration: duration, maxDevelopingAgeBars: searchBars });
  const records = pointRecords(points);
  const id = chartPatternId("chart-pattern", snapshot.marketId, snapshot.interval, patternId, records.map(p => `${p.time}:${p.price}`).join("-"));
  return Object.freeze({ id, patternId, patternName: EXTENDED_PATTERN_NAMES[patternId], category,
    direction: actualDirection, ...lifecycleState, lifecycleState,
    status: lifecycleState.lifecycle === "confirmed" ? "confirmed" : "tentative",
    points: records, boundaries, height: chartPatternRound(height), breakout, actionLevels, longLevels, shortLevels,
    score: geometryScore({ symmetry: metrics.symmetry ?? 0.75, touches: points.length,
      fit: metrics.fit ?? 0.8, recency: clamp(1 - (snapshot.candles.length - 1 - end) / 120, 0, 1),
      confirmed: lifecycleState.lifecycle === "confirmed" }),
    metrics: Object.freeze(metrics), scan: Object.freeze({ profileId }),
    ruleIds: Object.freeze([`CHART-${patternId.toUpperCase()}-GEOMETRY`, "CHART-CLOSED-BREAKOUT", "CHART-HEIGHT-TARGET"]),
    evidenceIds: Object.freeze([id, ...records.map(p => p.id)]),
  });
}

export function evaluateChannelOrBroadening(snapshot, points, { atr, profileId } = {}) {
  if (points.length < 5 || points.some((p, i) => i && (p.index <= points[i - 1].index || p.type === points[i - 1].type))) return null;
  const upper = boundaryFromPoints(points.filter(p => p.type === "high"));
  const lower = boundaryFromPoints(points.filter(p => p.type === "low"));
  if (!upper || !lower) return null;
  const start = points[0].index, end = points.at(-1).index, duration = end - start;
  if (duration < 12 || duration > 240) return null;
  const startGap = linePrice(upper, start) - linePrice(lower, start);
  const endGap = linePrice(upper, end) - linePrice(lower, end);
  if (Math.min(startGap, endGap) < atr * 1.5) return null;
  const height = Math.max(startGap, endGap);
  const residual = Math.max(...points.map(p => Math.abs(p.price - linePrice(p.type === "high" ? upper : lower, p.index))));
  if (residual > Math.max(atr * 0.8, height * 0.08)) return null;
  const containment = boundaryContainment(snapshot, start, end, upper, lower, atr);
  if (containment < 0.9) return null;
  const u = upper.slope * duration / height, l = lower.slope * duration / height;
  let patternId;
  if (u * l > 0 && Math.abs(u - l) < 0.18 && Math.min(Math.abs(u), Math.abs(l)) > 0.25) {
    patternId = u > 0 ? "ascending-channel" : "descending-channel";
  } else if (endGap > startGap * 1.3 && u > l) {
    if (u > 0.15 && l < -0.15) patternId = "broadening-formation";
    else if (u > l && l > 0.1) patternId = "ascending-broadening-wedge";
    else if (l < u && u < -0.1) patternId = "descending-broadening-wedge";
  }
  if (!patternId) return null;
  return candidate(snapshot, { patternId, points, atr, boundaries: { upper, lower }, height,
    upperAt: i => linePrice(upper, i), lowerAt: i => linePrice(lower, i), profileId,
    metrics: { containment, fit: Math.max(upper.r2, lower.r2), upperSlope: u, lowerSlope: l } });
}

export function evaluateRounding(snapshot, points, { atr, profileId } = {}) {
  if (points.length !== 3) return null;
  const [left, middle, right] = points;
  const bottom = left.type === "high" && middle.type === "low" && right.type === "high";
  const top = left.type === "low" && middle.type === "high" && right.type === "low";
  if (!bottom && !top) return null;
  const sign = bottom ? 1 : -1, duration = right.index - left.index;
  const depth = sign * ((left.price + right.price) / 2 - middle.price);
  if (duration < 30 || duration > 240 || depth < atr * 3 || Math.abs(left.price - right.price) > depth * 0.2) return null;
  const position = (middle.index - left.index) / duration;
  if (position < 0.25 || position > 0.75) return null;
  const bars = snapshot.candles.slice(left.index, right.index + 1);
  const nearMiddle = bars.filter(b => sign * ((bottom ? b.low : b.high) - middle.price) < depth * 0.15);
  if (nearMiddle.length < duration * 0.18) return null; // Reject sharp V structures.
  const thirds = [0, 1, 2].map(n => average(bars.slice(Math.floor(n * bars.length / 3), Math.floor((n + 1) * bars.length / 3)).map(b => b.close)));
  if (sign * (thirds[0] - thirds[1]) < depth * 0.2 || sign * (thirds[2] - thirds[1]) < depth * 0.2) return null;
  const trend = priorTrend(snapshot, left.index, bottom ? "down" : "up", atr);
  if (!trend.matches) return null;
  const rim = bottom ? Math.max(left.price, right.price) : Math.min(left.price, right.price);
  return candidate(snapshot, { patternId: bottom ? "rounding-bottom" : "rounding-top", points, atr, profileId,
    category: "reversal", direction: bottom ? "bullish" : "bearish", height: depth,
    upperAt: bottom ? rim : middle.price, lowerAt: bottom ? middle.price : rim,
    boundaries: { breakout: { price: rim, startIndex: left.index, endIndex: right.index } },
    metrics: { priorTrend: trend, roundedBars: nearMiddle.length, symmetry: 1 - Math.abs(position - 0.5) * 2 } });
}

export function evaluateInverseCup(snapshot, points, options) {
  // An affine reflection preserves price distances and OHLC ordering exactly.
  const base = Math.max(...snapshot.candles.slice(0, points.at(-1).index + 1).map(c => c.high)) * 2;
  const mirrored = { ...snapshot, candles: snapshot.candles.map(c => ({ ...c,
    open: base - c.open, close: base - c.close, high: base - c.low, low: base - c.high })) };
  const reflected = points.map(p => ({ ...p, price: base - p.price, type: p.type === "high" ? "low" : "high" }));
  const cup = evaluateCupAndHandle(mirrored, reflected, options);
  if (!cup) return null;
  const rim = base - cup.boundaries.breakout.price;
  return candidate(snapshot, { patternId: "inverse-cup-and-handle", points, ...options,
    category: "continuation", direction: "bearish", height: cup.height,
    upperAt: points.at(-1).price, lowerAt: rim,
    boundaries: { breakout: { ...cup.boundaries.breakout, price: rim } }, metrics: cup.metrics });
}

function sma(candles, index, period) {
  return index + 1 < period ? null : average(candles.slice(index + 1 - period, index + 1).map(c => c.close));
}

export function evaluateOldDuckHead(snapshot, points, { atr, profileId } = {}) {
  if (points.length !== 4 || !points.every((p, i) => p.type === (i % 2 ? "low" : "high"))) return null;
  const [head, neck, beak, eye] = points, bars = snapshot.candles;
  if (head.index < 70 || eye.index - head.index < 8 || eye.index - head.index > 60) return null;
  if (head.price - neck.price < atr * 1.5 || beak.price >= head.price || eye.price <= neck.price || eye.price >= beak.price) return null;
  if (head.price - neck.price > (head.price - sma(bars, head.index, 60)) * 1.2) return null;
  let crossed60 = false, fastDipped = false;
  for (let i = Math.max(60, head.index - 60); i <= head.index; i++) {
    const m60 = sma(bars, i, 60), prev60 = sma(bars, i - 1, 60);
    if (sma(bars, i - 1, 10) <= prev60 && sma(bars, i, 10) > m60 && sma(bars, i, 5) > m60) crossed60 = true;
  }
  for (let i = head.index; i <= eye.index; i++) {
    const m60 = sma(bars, i, 60);
    if (sma(bars, i, 5) <= sma(bars, i, 10)) fastDipped = true;
    if (bars[i].close < m60 - atr * 0.4) return null;
  }
  if (!crossed60 || !fastDipped || sma(bars, eye.index, 60) <= sma(bars, head.index, 60)) return null;
  const risingVolume = average(bars.slice(Math.max(0, head.index - 12), head.index + 1).map(c => c.volume));
  const pullbackVolume = average(bars.slice(head.index + 1, eye.index + 1).map(c => c.volume));
  if (!(risingVolume > 0 && pullbackVolume > 0 && pullbackVolume < risingVolume * 0.85)) return null;
  return candidate(snapshot, { patternId: "old-duck-head", points, atr, profileId,
    category: "continuation", direction: "bullish", height: head.price - neck.price,
    upperAt: head.price, lowerAt: neck.price,
    boundaries: { breakout: { price: head.price, startIndex: head.index, endIndex: eye.index } },
    metrics: { maPeriods: [5, 10, 60], crossed60, fastDipped, volumeContraction: pullbackVolume / risingVolume } });
}

export function evaluateDiamond(snapshot, points, { atr, profileId } = {}) {
  if (points.length < 8 || points.some((p, i) => i && p.type === points[i - 1].type)) return null;
  const left = points.slice(0, 5), right = points.slice(4);
  const expandUpper = boundaryFromPoints(left.filter(p => p.type === "high"));
  const expandLower = boundaryFromPoints(left.filter(p => p.type === "low"));
  const upper = boundaryFromPoints(right.filter(p => p.type === "high"));
  const lower = boundaryFromPoints(right.filter(p => p.type === "low"));
  if (![expandUpper, expandLower, upper, lower].every(Boolean)) return null;
  const start = points[0].index, mid = points[4].index, end = points.at(-1).index;
  if (end - start < 24 || end - start > 240) return null;
  const gap = (u, l, i) => linePrice(u, i) - linePrice(l, i);
  const height = gap(expandUpper, expandLower, mid);
  if (!(expandUpper.slope > 0 && expandLower.slope < 0 && upper.slope < 0 && lower.slope > 0)) return null;
  if (height < atr * 3 || height < gap(expandUpper, expandLower, start) * 1.3 || gap(upper, lower, end) > height * 0.75 || gap(upper, lower, end) <= 0) return null;
  if (boundaryContainment(snapshot, start, mid, expandUpper, expandLower, atr) < 0.85
    || boundaryContainment(snapshot, mid, end, upper, lower, atr) < 0.85) return null;
  const trend = priorTrend(snapshot, start, "up", atr);
  if (trend.direction === "neutral") return null;
  const top = trend.direction === "up";
  return candidate(snapshot, { patternId: top ? "diamond-top" : "diamond-bottom", points, atr, profileId,
    category: "reversal", direction: top ? "bearish" : "bullish", height,
    upperAt: i => linePrice(upper, i), lowerAt: i => linePrice(lower, i),
    boundaries: { upper, lower, expandUpper, expandLower }, metrics: { priorTrend: trend,
      apexIndex: (lower.intercept - upper.intercept) / (upper.slope - lower.slope) } });
}

export function runExtendedPatterns(snapshot, scanContext) {
  const candidates = [];
  for (const profile of scanContext.profiles) {
    for (let length = 3; length <= 9; length++) {
      for (let i = 0; i + length <= profile.swings.length; i++) {
        const points = profile.swings.slice(i, i + length);
        const options = { atr: patternFormationAtr(snapshot, points), profileId: profile.id };
        const evaluators = length === 3 ? [evaluateRounding] : length === 4 ? [evaluateInverseCup, evaluateOldDuckHead]
          : length >= 8 ? [evaluateDiamond] : [evaluateChannelOrBroadening];
        for (const evaluate of evaluators) {
          const result = evaluate(snapshot, points, options);
          if (result) candidates.push(result);
        }
      }
    }
  }
  return candidates;
}
