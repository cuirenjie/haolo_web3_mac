import {
  priceActionBuffer,
  priceActionClamp,
  priceActionId,
  priceActionMedian,
  priceActionRound,
} from "./price-action-structure-engine.mjs";

const PATTERN_DEFINITIONS = Object.freeze([
  ["top-fractal", "顶分型", "bearish", "structure", 3],
  ["bottom-fractal", "底分型", "bullish", "structure", 3],
  ["hammer", "锤子线", "bullish", "reversal", 1],
  ["hanging-man", "上吊线", "bearish", "reversal", 1],
  ["inverted-hammer", "倒锤子线", "bullish", "reversal", 1],
  ["shooting-star", "流星线", "bearish", "reversal", 1],
  ["dragonfly-doji", "蜻蜓十字", "bullish", "reversal", 1],
  ["gravestone-doji", "墓碑十字", "bearish", "reversal", 1],
  ["long-legged-doji", "长脚十字", "neutral", "indecision", 1],
  ["doji", "十字星", "neutral", "indecision", 1],
  ["spinning-top", "纺锤线", "neutral", "indecision", 1],
  ["high-wave", "高浪线", "neutral", "indecision", 1],
  ["bullish-marubozu", "看涨光头光脚", "bullish", "strength", 1],
  ["bearish-marubozu", "看跌光头光脚", "bearish", "strength", 1],
  ["bullish-engulfing", "看涨吞没", "bullish", "reversal", 2],
  ["bearish-engulfing", "看跌吞没", "bearish", "reversal", 2],
  ["bullish-harami", "看涨孕线", "bullish", "reversal", 2],
  ["bearish-harami", "看跌孕线", "bearish", "reversal", 2],
  ["bullish-harami-cross", "看涨十字孕线", "bullish", "reversal", 2],
  ["bearish-harami-cross", "看跌十字孕线", "bearish", "reversal", 2],
  ["piercing-line", "刺透形态", "bullish", "reversal", 2],
  ["dark-cloud-cover", "乌云盖顶", "bearish", "reversal", 2],
  ["tweezer-bottom", "镊子底", "bullish", "reversal", 2],
  ["tweezer-top", "镊子顶", "bearish", "reversal", 2],
  ["bullish-kicker", "看涨反冲形态", "bullish", "reversal", 2],
  ["bearish-kicker", "看跌反冲形态", "bearish", "reversal", 2],
  ["bullish-counterattack", "看涨反击线", "bullish", "reversal", 2],
  ["bearish-counterattack", "看跌反击线", "bearish", "reversal", 2],
  ["matching-low", "相同低价", "bullish", "reversal", 2],
  ["bullish-separating-lines", "看涨分手线", "bullish", "continuation", 2],
  ["bearish-separating-lines", "看跌分手线", "bearish", "continuation", 2],
  ["on-neck", "颈上线", "bearish", "continuation", 2],
  ["in-neck", "颈内线", "bearish", "continuation", 2],
  ["thrusting", "插入线", "bearish", "continuation", 2],
  ["morning-star", "晨星", "bullish", "reversal", 3],
  ["evening-star", "黄昏星", "bearish", "reversal", 3],
  ["morning-doji-star", "十字晨星", "bullish", "reversal", 3],
  ["evening-doji-star", "十字黄昏星", "bearish", "reversal", 3],
  ["three-white-soldiers", "三白兵", "bullish", "reversal", 3],
  ["three-black-crows", "三乌鸦", "bearish", "reversal", 3],
  ["three-inside-up", "三内升", "bullish", "reversal", 3],
  ["three-inside-down", "三内降", "bearish", "reversal", 3],
  ["three-outside-up", "三外升", "bullish", "reversal", 3],
  ["three-outside-down", "三外降", "bearish", "reversal", 3],
  ["bullish-abandoned-baby", "看涨弃婴", "bullish", "reversal", 3],
  ["bearish-abandoned-baby", "看跌弃婴", "bearish", "reversal", 3],
  ["stick-sandwich", "藏婴吞没/夹心底", "bullish", "reversal", 3],
  ["upside-gap-two-crows", "向上跳空两只乌鸦", "bearish", "reversal", 3],
  ["advance-block", "前进受阻", "bearish", "warning", 3],
  ["stalled-pattern", "停顿形态", "bearish", "warning", 3],
  ["bullish-three-line-strike", "看涨三线反击", "bullish", "reversal", 4],
  ["bearish-three-line-strike", "看跌三线反击", "bearish", "reversal", 4],
  ["rising-three-methods", "上升三法", "bullish", "continuation", 5],
  ["falling-three-methods", "下降三法", "bearish", "continuation", 5],
]);

export const PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG = Object.freeze(PATTERN_DEFINITIONS.map((definition) => Object.freeze({
  id: definition[0],
  name: definition[1],
  direction: definition[2],
  category: definition[3],
  candleCount: definition[4],
})));

const PATTERN_BY_ID = new Map(PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG.map((item) => [item.id, item]));
const SPECIFICITY = Object.freeze({
  "morning-doji-star": 1,
  "evening-doji-star": 1,
  "bullish-harami-cross": 0.9,
  "bearish-harami-cross": 0.9,
  "dragonfly-doji": 0.8,
  "gravestone-doji": 0.8,
  "long-legged-doji": 0.7,
  "high-wave": 0.6,
  "three-white-soldiers": 0.8,
  "three-black-crows": 0.8,
});

function snapshotTimeSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 100_000_000_000 ? numeric / 1_000 : numeric;
}

export function priceActionIntervalSeconds(interval) {
  const match = /^(\d+)([SHDW]?)$/.exec(String(interval || "").trim().toUpperCase());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (match[2] === "S") return amount;
  if (match[2] === "H") return amount * 3_600;
  if (match[2] === "D") return amount * 86_400;
  if (match[2] === "W") return amount * 604_800;
  return amount * 60;
}

function inferredIntervalSeconds(candles) {
  const intervals = [];
  for (let index = 1; index < candles.length; index += 1) {
    const interval = Number(candles[index].time) - Number(candles[index - 1].time);
    if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
  }
  return intervals.length ? priceActionMedian(intervals) : null;
}

export function priceActionLastClosedCandleIndex(snapshot) {
  const candles = Array.isArray(snapshot?.candles) ? snapshot.candles : [];
  if (!candles.length) return -1;
  const asOf = snapshotTimeSeconds(snapshot?.snapshotTime);
  const interval = priceActionIntervalSeconds(snapshot?.interval) || inferredIntervalSeconds(candles);
  if (!Number.isFinite(asOf) || !Number.isFinite(interval) || interval <= 0) return candles.length - 1;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (Number(candles[index].time) + interval <= asOf + 0.001) return index;
  }
  return -1;
}

function candleShape(candles, index) {
  const candle = candles[index];
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const body = Math.abs(candle.close - candle.open);
  const bodyHigh = Math.max(candle.open, candle.close);
  const bodyLow = Math.min(candle.open, candle.close);
  const upperWick = candle.high - bodyHigh;
  const lowerWick = bodyLow - candle.low;
  const history = candles.slice(Math.max(0, index - 20), index);
  const medianBody = Math.max(priceActionMedian(history.map((item) => Math.abs(item.close - item.open))), range * 0.08, Number.EPSILON);
  const medianRange = Math.max(priceActionMedian(history.map((item) => item.high - item.low)), range * 0.2, Number.EPSILON);
  return Object.freeze({
    ...candle,
    index,
    range,
    body,
    bodyHigh,
    bodyLow,
    upperWick,
    lowerWick,
    bodyRatio: body / range,
    closeLocation: (candle.close - candle.low) / range,
    direction: candle.close > candle.open ? "bullish" : candle.close < candle.open ? "bearish" : "neutral",
    medianBody,
    medianRange,
    longBody: body >= medianBody * 1.15 && body / range >= 0.55,
    shortBody: body <= medianBody * 0.68 || body / range <= 0.28,
    doji: body / range <= 0.1,
  });
}

function trendBefore(shapes, startIndex, rangeUnit) {
  const sample = shapes.slice(Math.max(0, startIndex - 8), startIndex);
  if (sample.length < 5) return "neutral";
  const delta = sample.at(-1).close - sample[0].close;
  let rising = 0;
  let falling = 0;
  for (let index = 1; index < sample.length; index += 1) {
    if (sample[index].close > sample[index - 1].close) rising += 1;
    if (sample[index].close < sample[index - 1].close) falling += 1;
  }
  if (delta >= rangeUnit * 1.15 && rising >= falling) return "bullish";
  if (delta <= -rangeUnit * 1.15 && falling >= rising) return "bearish";
  return "neutral";
}

function overlapZone(zones, low, high, rangeUnit) {
  const tolerance = rangeUnit * 0.45;
  return zones
    .filter((zone) => high >= zone.lower - tolerance && low <= zone.upper + tolerance)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function samePrice(first, second, tolerance) {
  return Math.abs(first - second) <= tolerance;
}

function bodyInside(inner, outer, tolerance) {
  return inner.bodyHigh <= outer.bodyHigh + tolerance && inner.bodyLow >= outer.bodyLow - tolerance;
}

function bodyEngulfs(outer, inner, tolerance) {
  return outer.bodyHigh >= inner.bodyHigh - tolerance && outer.bodyLow <= inner.bodyLow + tolerance;
}

function fullGapUp(first, second, tolerance) {
  return second.low > first.high + tolerance;
}

function fullGapDown(first, second, tolerance) {
  return second.high < first.low - tolerance;
}

function bodyGapUp(first, second, tolerance) {
  return second.bodyLow > first.bodyHigh + tolerance;
}

function bodyGapDown(first, second, tolerance) {
  return second.bodyHigh < first.bodyLow - tolerance;
}

function contextMatches(meta, priorTrend) {
  if (meta.category === "structure" || meta.category === "indecision" || meta.category === "strength") return true;
  if (meta.category === "continuation") return meta.direction === priorTrend;
  if (meta.category === "warning") return priorTrend === "bullish";
  if (meta.direction === "bullish") return priorTrend === "bearish";
  if (meta.direction === "bearish") return priorTrend === "bullish";
  return true;
}

function addPattern(target, snapshot, structure, shapes, patternId, startIndex, endIndex, geometryScore, explanation, options = {}) {
  const meta = PATTERN_BY_ID.get(patternId);
  if (!meta || startIndex < 0 || endIndex >= shapes.length) return;
  const selected = shapes.slice(startIndex, endIndex + 1);
  const low = Math.min(...selected.map((item) => item.low));
  const high = Math.max(...selected.map((item) => item.high));
  const priorTrend = trendBefore(shapes, startIndex, structure.rangeUnit);
  if (!options.ignoreTrend && !contextMatches(meta, priorTrend)) return;
  const zone = overlapZone(structure.zones, low, high, structure.rangeUnit);
  const lastClosedCandleIndex = Number.isInteger(structure.lastClosedCandleIndex)
    ? structure.lastClosedCandleIndex
    : priceActionLastClosedCandleIndex(snapshot);
  const formationStatus = endIndex <= lastClosedCandleIndex ? "confirmed" : "forming";
  const next = endIndex + 1 <= lastClosedCandleIndex ? shapes[endIndex + 1] : null;
  const confirmationBuffer = priceActionBuffer(snapshot.candles, structure.rangeUnit, 0.08);
  const confirmation = formationStatus !== "confirmed"
    ? "unconfirmed"
    : meta.direction === "neutral"
    ? "not-required"
    : options.intrinsicallyConfirmed
      ? "confirmed"
      : !next
        ? "unconfirmed"
        : meta.direction === "bullish" && next.close > high + confirmationBuffer
          ? "confirmed"
          : meta.direction === "bearish" && next.close < low - confirmationBuffer
            ? "confirmed"
            : "unconfirmed";
  const directional = meta.direction !== "neutral";
  const locationQualified = Boolean(zone) || meta.category === "continuation" || meta.category === "structure";
  const quality = priceActionRound(priceActionClamp(
    geometryScore
      + (priorTrend !== "neutral" ? 0.08 : 0)
      + (zone ? 0.09 : 0)
      + (confirmation === "confirmed" ? 0.08 : 0)
      + (SPECIFICITY[patternId] || 0) * 0.03,
    0,
    1,
  ));
  const evidenceIds = selected.map((item) => priceActionId("pa-pattern-candle", snapshot.snapshotId, item.index, item.time));
  target.push(Object.freeze({
    id: priceActionId("pa-candlestick", snapshot.snapshotId, patternId, startIndex, endIndex),
    patternId,
    name: meta.name,
    direction: meta.direction,
    category: meta.category,
    candleCount: endIndex - startIndex + 1,
    startIndex,
    endIndex,
    startTime: selected[0].time,
    endTime: selected.at(-1).time,
    low: priceActionRound(low),
    high: priceActionRound(high),
    priorTrend,
    zone: zone || null,
    formationStatus,
    confirmation,
    complete: formationStatus === "confirmed",
    actionable: directional && formationStatus === "confirmed" && locationQualified && confirmation === "confirmed",
    quality,
    explanation,
    evidenceIds: Object.freeze(evidenceIds),
  }));
}

function scanSingleAndFractals(target, snapshot, structure, shapes, index) {
  const current = shapes[index];
  const bodyFloor = Math.max(current.body, current.range * 0.04);
  const lowerShape = current.lowerWick >= bodyFloor * 2.2 && current.lowerWick >= current.range * 0.55 && current.upperWick <= current.range * 0.16;
  const upperShape = current.upperWick >= bodyFloor * 2.2 && current.upperWick >= current.range * 0.55 && current.lowerWick <= current.range * 0.16;
  const prior = trendBefore(shapes, index, structure.rangeUnit);
  if (lowerShape && prior === "bearish") addPattern(target, snapshot, structure, shapes, "hammer", index, index, 0.7, "下跌背景中长下影、实体靠近高位");
  if (lowerShape && prior === "bullish") addPattern(target, snapshot, structure, shapes, "hanging-man", index, index, 0.68, "上涨背景中长下影、实体靠近高位");
  if (upperShape && prior === "bearish") addPattern(target, snapshot, structure, shapes, "inverted-hammer", index, index, 0.68, "下跌背景中长上影、实体靠近低位");
  if (upperShape && prior === "bullish") addPattern(target, snapshot, structure, shapes, "shooting-star", index, index, 0.7, "上涨背景中长上影、实体靠近低位");

  if (current.doji) {
    if (current.lowerWick >= current.range * 0.62 && current.upperWick <= current.range * 0.1 && prior === "bearish") {
      addPattern(target, snapshot, structure, shapes, "dragonfly-doji", index, index, 0.74, "开收接近高位且长下影", { ignoreTrend: false });
    } else if (current.upperWick >= current.range * 0.62 && current.lowerWick <= current.range * 0.1 && prior === "bullish") {
      addPattern(target, snapshot, structure, shapes, "gravestone-doji", index, index, 0.74, "开收接近低位且长上影", { ignoreTrend: false });
    } else if (current.upperWick >= current.range * 0.32 && current.lowerWick >= current.range * 0.32) {
      addPattern(target, snapshot, structure, shapes, "long-legged-doji", index, index, 0.62, "实体极小且上下影均长", { ignoreTrend: true });
    } else addPattern(target, snapshot, structure, shapes, "doji", index, index, 0.56, "开盘与收盘高度接近", { ignoreTrend: true });
  } else if (current.bodyRatio <= 0.3 && current.upperWick >= current.body * 0.7 && current.lowerWick >= current.body * 0.7) {
    const highWave = current.upperWick >= current.range * 0.3 && current.lowerWick >= current.range * 0.3;
    addPattern(target, snapshot, structure, shapes, highWave ? "high-wave" : "spinning-top", index, index, highWave ? 0.62 : 0.54, highWave ? "小实体配合长上下影" : "小实体配合双侧影线", { ignoreTrend: true });
  }
  if (current.bodyRatio >= 0.86 && current.upperWick <= current.range * 0.08 && current.lowerWick <= current.range * 0.08) {
    addPattern(target, snapshot, structure, shapes, current.direction === "bullish" ? "bullish-marubozu" : "bearish-marubozu", index, index, 0.66, "长实体且两侧影线极短", { ignoreTrend: true });
  }

  if (index >= 2) {
    const left = shapes[index - 2];
    const middle = shapes[index - 1];
    const right = shapes[index];
    if (middle.high > left.high && middle.high > right.high && middle.low > left.low && middle.low > right.low) {
      addPattern(target, snapshot, structure, shapes, "top-fractal", index - 2, index, 0.72, "中间K线高点与低点均高于左右K线", { ignoreTrend: true, intrinsicallyConfirmed: true });
    }
    if (middle.low < left.low && middle.low < right.low && middle.high < left.high && middle.high < right.high) {
      addPattern(target, snapshot, structure, shapes, "bottom-fractal", index - 2, index, 0.72, "中间K线高点与低点均低于左右K线", { ignoreTrend: true, intrinsicallyConfirmed: true });
    }
  }
}

function scanTwo(target, snapshot, structure, shapes, index) {
  if (index < 1) return;
  const first = shapes[index - 1];
  const second = shapes[index];
  const tolerance = Math.max(structure.rangeUnit * 0.09, second.close * 0.0002);
  const prior = trendBefore(shapes, index - 1, structure.rangeUnit);
  const bullishEngulf = first.direction === "bearish" && second.direction === "bullish" && bodyEngulfs(second, first, tolerance) && second.body >= first.body * 0.95;
  const bearishEngulf = first.direction === "bullish" && second.direction === "bearish" && bodyEngulfs(second, first, tolerance) && second.body >= first.body * 0.95;
  if (bullishEngulf && prior === "bearish") addPattern(target, snapshot, structure, shapes, "bullish-engulfing", index - 1, index, 0.76, "第二根阳线实体吞没前一根阴线实体");
  if (bearishEngulf && prior === "bullish") addPattern(target, snapshot, structure, shapes, "bearish-engulfing", index - 1, index, 0.76, "第二根阴线实体吞没前一根阳线实体");

  const harami = first.longBody && second.shortBody && bodyInside(second, first, tolerance);
  if (harami && prior === "bearish" && first.direction === "bearish") {
    addPattern(target, snapshot, structure, shapes, second.doji ? "bullish-harami-cross" : "bullish-harami", index - 1, index, second.doji ? 0.77 : 0.69, "长阴实体内部出现小实体/十字");
  }
  if (harami && prior === "bullish" && first.direction === "bullish") {
    addPattern(target, snapshot, structure, shapes, second.doji ? "bearish-harami-cross" : "bearish-harami", index - 1, index, second.doji ? 0.77 : 0.69, "长阳实体内部出现小实体/十字");
  }

  if (prior === "bearish" && first.direction === "bearish" && first.longBody && second.direction === "bullish"
    && second.open <= first.close + tolerance && second.close > (first.open + first.close) / 2 && second.close < first.open) {
    addPattern(target, snapshot, structure, shapes, "piercing-line", index - 1, index, 0.74, "阳线由前阴线下部反攻并收于其实体中点之上");
  }
  if (prior === "bullish" && first.direction === "bullish" && first.longBody && second.direction === "bearish"
    && second.open >= first.close - tolerance && second.close < (first.open + first.close) / 2 && second.close > first.open) {
    addPattern(target, snapshot, structure, shapes, "dark-cloud-cover", index - 1, index, 0.74, "阴线由前阳线上部回落并收于其实体中点之下");
  }
  if (prior === "bearish" && samePrice(first.low, second.low, tolerance) && first.direction === "bearish" && second.direction === "bullish") {
    addPattern(target, snapshot, structure, shapes, "tweezer-bottom", index - 1, index, 0.68, "相邻K线形成近似相同低点");
  }
  if (prior === "bullish" && samePrice(first.high, second.high, tolerance) && first.direction === "bullish" && second.direction === "bearish") {
    addPattern(target, snapshot, structure, shapes, "tweezer-top", index - 1, index, 0.68, "相邻K线形成近似相同高点");
  }
  if (first.bodyRatio >= 0.78 && second.bodyRatio >= 0.78 && first.direction !== second.direction) {
    if (prior === "bearish" && first.direction === "bearish" && second.direction === "bullish" && fullGapUp(first, second, tolerance)) {
      addPattern(target, snapshot, structure, shapes, "bullish-kicker", index - 1, index, 0.86, "两根近光头光脚K线反向且存在真实向上跳空");
    }
    if (prior === "bullish" && first.direction === "bullish" && second.direction === "bearish" && fullGapDown(first, second, tolerance)) {
      addPattern(target, snapshot, structure, shapes, "bearish-kicker", index - 1, index, 0.86, "两根近光头光脚K线反向且存在真实向下跳空");
    }
  }
  if (first.longBody && second.longBody && first.direction !== second.direction && samePrice(first.close, second.close, tolerance)) {
    if (prior === "bearish" && second.direction === "bullish") addPattern(target, snapshot, structure, shapes, "bullish-counterattack", index - 1, index, 0.7, "反向长实体收于近似相同价位");
    if (prior === "bullish" && second.direction === "bearish") addPattern(target, snapshot, structure, shapes, "bearish-counterattack", index - 1, index, 0.7, "反向长实体收于近似相同价位");
  }
  if (prior === "bearish" && first.direction === "bearish" && second.direction === "bearish" && samePrice(first.close, second.close, tolerance)) {
    addPattern(target, snapshot, structure, shapes, "matching-low", index - 1, index, 0.66, "连续阴线收盘价近似相同");
  }
  if (samePrice(first.open, second.open, tolerance) && first.direction !== second.direction) {
    if (prior === "bullish" && second.direction === "bullish" && second.longBody) addPattern(target, snapshot, structure, shapes, "bullish-separating-lines", index - 1, index, 0.65, "同开盘价后以长阳延续上涨");
    if (prior === "bearish" && second.direction === "bearish" && second.longBody) addPattern(target, snapshot, structure, shapes, "bearish-separating-lines", index - 1, index, 0.65, "同开盘价后以长阴延续下跌");
  }
  if (prior === "bearish" && first.direction === "bearish" && first.longBody && second.direction === "bullish" && second.open < first.low) {
    if (samePrice(second.close, first.low, tolerance)) addPattern(target, snapshot, structure, shapes, "on-neck", index - 1, index, 0.65, "反弹阳线收于前阴线低点附近");
    else if (second.close > first.low && second.close <= first.close + first.body * 0.25) addPattern(target, snapshot, structure, shapes, "in-neck", index - 1, index, 0.63, "反弹阳线仅进入前阴线实体下部");
    else if (second.close > first.close + first.body * 0.25 && second.close < (first.open + first.close) / 2) addPattern(target, snapshot, structure, shapes, "thrusting", index - 1, index, 0.64, "反弹阳线刺入前阴线但未越过中点");
  }
}

function scanThree(target, snapshot, structure, shapes, index) {
  if (index < 2) return;
  const first = shapes[index - 2];
  const middle = shapes[index - 1];
  const third = shapes[index];
  const tolerance = Math.max(structure.rangeUnit * 0.08, third.close * 0.0002);
  const prior = trendBefore(shapes, index - 2, structure.rangeUnit);
  const morning = prior === "bearish" && first.direction === "bearish" && first.longBody && middle.shortBody
    && third.direction === "bullish" && third.longBody && third.close > (first.open + first.close) / 2
    && middle.bodyHigh <= first.bodyLow + tolerance;
  const evening = prior === "bullish" && first.direction === "bullish" && first.longBody && middle.shortBody
    && third.direction === "bearish" && third.longBody && third.close < (first.open + first.close) / 2
    && middle.bodyLow >= first.bodyHigh - tolerance;
  if (morning) addPattern(target, snapshot, structure, shapes, middle.doji ? "morning-doji-star" : "morning-star", index - 2, index, middle.doji ? 0.86 : 0.81, "长阴、下方星线与强阳回收前阴实体中点");
  if (evening) addPattern(target, snapshot, structure, shapes, middle.doji ? "evening-doji-star" : "evening-star", index - 2, index, middle.doji ? 0.86 : 0.81, "长阳、上方星线与强阴跌破前阳实体中点");

  const soldiers = [first, middle, third].every((item) => item.direction === "bullish" && item.bodyRatio >= 0.52)
    && first.close < middle.close && middle.close < third.close
    && middle.open >= first.bodyLow && middle.open <= first.bodyHigh
    && third.open >= middle.bodyLow && third.open <= middle.bodyHigh
    && [first, middle, third].every((item) => item.closeLocation >= 0.72 && item.upperWick <= item.range * 0.28);
  const crows = [first, middle, third].every((item) => item.direction === "bearish" && item.bodyRatio >= 0.52)
    && first.close > middle.close && middle.close > third.close
    && middle.open >= first.bodyLow && middle.open <= first.bodyHigh
    && third.open >= middle.bodyLow && third.open <= middle.bodyHigh
    && [first, middle, third].every((item) => item.closeLocation <= 0.28 && item.lowerWick <= item.range * 0.28);
  if (soldiers && prior === "bearish") addPattern(target, snapshot, structure, shapes, "three-white-soldiers", index - 2, index, 0.84, "三根连续长阳逐级收高、开盘位于前实体内且收近高位");
  if (crows && prior === "bullish") addPattern(target, snapshot, structure, shapes, "three-black-crows", index - 2, index, 0.84, "三根连续长阴逐级收低、开盘位于前实体内且收近低位");

  const harami = first.longBody && middle.shortBody && bodyInside(middle, first, tolerance);
  if (prior === "bearish" && first.direction === "bearish" && harami && third.direction === "bullish" && third.close > first.open) {
    addPattern(target, snapshot, structure, shapes, "three-inside-up", index - 2, index, 0.78, "看涨孕线后第三根阳线收盘越过母K开盘");
  }
  if (prior === "bullish" && first.direction === "bullish" && harami && third.direction === "bearish" && third.close < first.open) {
    addPattern(target, snapshot, structure, shapes, "three-inside-down", index - 2, index, 0.78, "看跌孕线后第三根阴线收盘跌破母K开盘");
  }
  const bullEngulf = first.direction === "bearish" && middle.direction === "bullish" && bodyEngulfs(middle, first, tolerance);
  const bearEngulf = first.direction === "bullish" && middle.direction === "bearish" && bodyEngulfs(middle, first, tolerance);
  if (prior === "bearish" && bullEngulf && third.direction === "bullish" && third.close > middle.close) addPattern(target, snapshot, structure, shapes, "three-outside-up", index - 2, index, 0.8, "看涨吞没后第三根继续收高");
  if (prior === "bullish" && bearEngulf && third.direction === "bearish" && third.close < middle.close) addPattern(target, snapshot, structure, shapes, "three-outside-down", index - 2, index, 0.8, "看跌吞没后第三根继续收低");

  if (middle.doji && prior === "bearish" && first.direction === "bearish" && fullGapDown(first, middle, tolerance) && fullGapUp(middle, third, tolerance) && third.direction === "bullish") {
    addPattern(target, snapshot, structure, shapes, "bullish-abandoned-baby", index - 2, index, 0.94, "十字星与前后K线均存在真实价格跳空");
  }
  if (middle.doji && prior === "bullish" && first.direction === "bullish" && fullGapUp(first, middle, tolerance) && fullGapDown(middle, third, tolerance) && third.direction === "bearish") {
    addPattern(target, snapshot, structure, shapes, "bearish-abandoned-baby", index - 2, index, 0.94, "十字星与前后K线均存在真实价格跳空");
  }
  if (prior === "bearish" && first.direction === "bearish" && middle.direction === "bullish" && third.direction === "bearish" && samePrice(first.close, third.close, tolerance)) {
    addPattern(target, snapshot, structure, shapes, "stick-sandwich", index - 2, index, 0.72, "两根阴线收盘近似相同，中间由阳线夹住");
  }
  if (prior === "bullish" && first.direction === "bullish" && middle.direction === "bearish" && third.direction === "bearish"
    && bodyGapUp(first, middle, tolerance) && third.bodyHigh >= middle.bodyHigh && third.bodyLow <= middle.bodyLow && third.close > first.bodyHigh) {
    addPattern(target, snapshot, structure, shapes, "upside-gap-two-crows", index - 2, index, 0.82, "长阳后两根阴线位于真实向上实体跳空中");
  }
  if (prior === "bullish" && [first, middle, third].every((item) => item.direction === "bullish") && first.close < middle.close && middle.close < third.close) {
    if (first.body > middle.body * 1.08 && middle.body > third.body * 1.08 && third.upperWick > first.upperWick) {
      addPattern(target, snapshot, structure, shapes, "advance-block", index - 2, index, 0.69, "连续阳线仍收高但实体递减且上影增强");
    } else if (third.shortBody && third.open >= middle.bodyHigh - tolerance) {
      addPattern(target, snapshot, structure, shapes, "stalled-pattern", index - 2, index, 0.67, "上涨后第三根小阳在前一长阳顶部停顿");
    }
  }
}

function scanFourAndFive(target, snapshot, structure, shapes, index) {
  const tolerance = Math.max(structure.rangeUnit * 0.08, shapes[index].close * 0.0002);
  if (index >= 3) {
    const bars = shapes.slice(index - 3, index + 1);
    const prior = trendBefore(shapes, index - 3, structure.rangeUnit);
    const firstThreeBull = bars.slice(0, 3).every((item, offset, values) => item.direction === "bullish" && (!offset || item.close > values[offset - 1].close));
    const firstThreeBear = bars.slice(0, 3).every((item, offset, values) => item.direction === "bearish" && (!offset || item.close < values[offset - 1].close));
    if (prior === "bearish" && firstThreeBear && bars[3].direction === "bullish" && bars[3].bodyLow <= bars[2].bodyLow + tolerance && bars[3].bodyHigh >= bars[0].bodyHigh - tolerance) {
      addPattern(target, snapshot, structure, shapes, "bullish-three-line-strike", index - 3, index, 0.79, "三根递降阴线后长阳实体反向包住前三根实体");
    }
    if (prior === "bullish" && firstThreeBull && bars[3].direction === "bearish" && bars[3].bodyHigh >= bars[2].bodyHigh - tolerance && bars[3].bodyLow <= bars[0].bodyLow + tolerance) {
      addPattern(target, snapshot, structure, shapes, "bearish-three-line-strike", index - 3, index, 0.79, "三根递升阳线后长阴实体反向包住前三根实体");
    }
  }
  if (index < 4) return;
  const bars = shapes.slice(index - 4, index + 1);
  const first = bars[0];
  const last = bars[4];
  const middle = bars.slice(1, 4);
  const prior = trendBefore(shapes, index - 4, structure.rangeUnit);
  const middleInside = middle.every((item) => item.high <= first.high + tolerance && item.low >= first.low - tolerance && item.shortBody);
  if (prior === "bullish" && first.direction === "bullish" && first.longBody && middleInside && last.direction === "bullish" && last.longBody && last.close > first.close) {
    addPattern(target, snapshot, structure, shapes, "rising-three-methods", index - 4, index, 0.82, "长阳后数根小K在其范围内整理，末根长阳创收盘新高");
  }
  if (prior === "bearish" && first.direction === "bearish" && first.longBody && middleInside && last.direction === "bearish" && last.longBody && last.close < first.close) {
    addPattern(target, snapshot, structure, shapes, "falling-three-methods", index - 4, index, 0.82, "长阴后数根小K在其范围内整理，末根长阴创收盘新低");
  }
}

function deduplicatePatterns(patterns) {
  const sorted = [...patterns].sort((first, second) => (
    second.endIndex - first.endIndex
    || second.quality - first.quality
    || (SPECIFICITY[second.patternId] || 0) - (SPECIFICITY[first.patternId] || 0)
    || second.candleCount - first.candleCount
  ));
  const selected = [];
  for (const pattern of sorted) {
    const overlapsEquivalent = selected.some((item) => item.startIndex === pattern.startIndex
      && item.endIndex === pattern.endIndex
      && item.direction === pattern.direction);
    if (!overlapsEquivalent) selected.push(pattern);
  }
  return selected;
}

export function runPriceActionCandlestickPatternEngine(snapshot, structure) {
  const shapes = snapshot.candles.map((_, index) => candleShape(snapshot.candles, index));
  const lastClosedCandleIndex = priceActionLastClosedCandleIndex(snapshot);
  const scanStructure = Object.freeze({ ...structure, lastClosedCandleIndex });
  const raw = [];
  for (let index = 0; index < shapes.length; index += 1) {
    scanSingleAndFractals(raw, snapshot, scanStructure, shapes, index);
    scanTwo(raw, snapshot, scanStructure, shapes, index);
    scanThree(raw, snapshot, scanStructure, shapes, index);
    scanFourAndFive(raw, snapshot, scanStructure, shapes, index);
  }
  const patterns = deduplicatePatterns(raw);
  const latestIndex = shapes.length - 1;
  const recentPatterns = patterns.filter((pattern) => pattern.endIndex >= latestIndex - 24);
  const drawablePatterns = [];
  for (const pattern of recentPatterns) {
    if (drawablePatterns.length >= 4) break;
    const conflicts = drawablePatterns.some((item) => Math.max(item.startIndex, pattern.startIndex) <= Math.min(item.endIndex, pattern.endIndex));
    if (!conflicts || pattern.quality >= 0.82) drawablePatterns.push(pattern);
  }
  return Object.freeze({
    engineId: "price-action-candlestick-pattern",
    engineVersion: "1.1.0",
    lastClosedCandleIndex,
    catalog: PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG,
    patterns: Object.freeze(patterns),
    recentPatterns: Object.freeze(recentPatterns),
    drawablePatterns: Object.freeze(drawablePatterns),
    actionablePatterns: Object.freeze(recentPatterns.filter((pattern) => pattern.actionable)),
    latestPattern: recentPatterns[0] || null,
  });
}
