export const DOW_THEORY_ENGINE_ID = "dow-theory-deterministic-v1";

const SCALE_PROFILES = Object.freeze({
  primary: Object.freeze({ id: "primary", radius: 6, minimumExcursion: 2.2 }),
  secondary: Object.freeze({ id: "secondary", radius: 4, minimumExcursion: 1.35 }),
  minor: Object.freeze({ id: "minor", radius: 2, minimumExcursion: 0.7 }),
});

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function intervalSeconds(interval, candles) {
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

export function dowTheoryClosedCandles(snapshot) {
  const duration = intervalSeconds(snapshot.interval, snapshot.candles);
  const boundary = snapshotSeconds(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + duration <= boundary + 1e-6);
  return Object.freeze({
    candles: Object.freeze(candles),
    intervalSeconds: duration,
    excludedLiveCandles: snapshot.candles.length - candles.length,
  });
}

function rangeUnit(candles) {
  const ranges = candles.slice(-120).map((candle) => Math.max(0, candle.high - candle.low));
  return Math.max(median(ranges), candles.at(-1)?.close * 0.0002 || Number.EPSILON);
}

function rawPivots(candles, profile, unit) {
  const pivots = [];
  for (let index = profile.radius; index < candles.length - profile.radius; index += 1) {
    const candle = candles[index];
    const window = candles.slice(index - profile.radius, index + profile.radius + 1);
    const otherHighs = window.filter((_, offset) => offset !== profile.radius).map((item) => item.high);
    const otherLows = window.filter((_, offset) => offset !== profile.radius).map((item) => item.low);
    const highProminence = candle.high - Math.max(Math.min(...otherHighs), Math.min(...window.map((item) => item.low)));
    const lowProminence = Math.min(Math.max(...otherLows), Math.max(...window.map((item) => item.high))) - candle.low;
    const high = candle.high >= Math.max(...otherHighs) && highProminence >= unit * profile.minimumExcursion;
    const low = candle.low <= Math.min(...otherLows) && lowProminence >= unit * profile.minimumExcursion;
    if (!high && !low) continue;
    const type = high && low ? (highProminence >= lowProminence ? "high" : "low") : high ? "high" : "low";
    const price = type === "high" ? candle.high : candle.low;
    pivots.push({
      id: `dow-${profile.id}-${type}-${candle.time}`,
      scale: profile.id,
      type,
      index,
      time: candle.time,
      price,
      prominence: type === "high" ? highProminence : lowProminence,
    });
  }
  return pivots;
}

function alternatingPivots(items, profile, unit) {
  const minimumMove = unit * profile.minimumExcursion;
  const result = [];
  for (const pivot of items) {
    const previous = result.at(-1);
    if (!previous) {
      result.push(pivot);
      continue;
    }
    if (previous.type === pivot.type) {
      const moreExtreme = pivot.type === "high" ? pivot.price >= previous.price : pivot.price <= previous.price;
      if (moreExtreme) result[result.length - 1] = pivot;
      continue;
    }
    if (Math.abs(pivot.price - previous.price) >= minimumMove) result.push(pivot);
  }
  return result;
}

function labelPivots(pivots, unit) {
  let previousHigh = null;
  let previousLow = null;
  return pivots.map((pivot) => {
    let label = pivot.type === "high" ? "H" : "L";
    const previous = pivot.type === "high" ? previousHigh : previousLow;
    if (previous) {
      const tolerance = unit * 0.2;
      if (Math.abs(pivot.price - previous.price) <= tolerance) label = pivot.type === "high" ? "EH" : "EL";
      else if (pivot.type === "high") label = pivot.price > previous.price ? "HH" : "LH";
      else label = pivot.price > previous.price ? "HL" : "LL";
    }
    if (pivot.type === "high") previousHigh = pivot;
    else previousLow = pivot;
    return Object.freeze({ ...pivot, label });
  });
}

function trendFromPivots(pivots, unit) {
  const highs = pivots.filter((pivot) => pivot.type === "high").slice(-2);
  const lows = pivots.filter((pivot) => pivot.type === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "neutral";
  const tolerance = unit * 0.2;
  const highMove = highs[1].price - highs[0].price;
  const lowMove = lows[1].price - lows[0].price;
  if (highMove > tolerance && lowMove > tolerance) return "bullish";
  if (highMove < -tolerance && lowMove < -tolerance) return "bearish";
  return "transition";
}

function analyzeScale(candles, profile, unit) {
  const pivots = labelPivots(alternatingPivots(rawPivots(candles, profile, unit), profile, unit), unit);
  const highs = pivots.filter((pivot) => pivot.type === "high");
  const lows = pivots.filter((pivot) => pivot.type === "low");
  return Object.freeze({
    id: profile.id,
    radius: profile.radius,
    minimumExcursion: profile.minimumExcursion,
    direction: trendFromPivots(pivots, unit),
    pivots: Object.freeze(pivots),
    lastHigh: highs.at(-1) || null,
    lastLow: lows.at(-1) || null,
  });
}

function closeConfirmation(candles, primary, unit) {
  const latest = candles.at(-1);
  const high = primary.lastHigh;
  const low = primary.lastLow;
  const buffer = Math.max(unit * 0.12, latest.close * 0.00015);
  if (!latest || !high || !low) return Object.freeze({ state: "insufficient-structure", direction: "neutral", level: null, candleTime: latest?.time || null });
  if (latest.close > high.price + buffer) return Object.freeze({ state: "close-breakout", direction: "bullish", level: high.price + buffer, candleTime: latest.time });
  if (latest.close < low.price - buffer) return Object.freeze({ state: "close-breakout", direction: "bearish", level: low.price - buffer, candleTime: latest.time });
  const wickDirection = latest.high > high.price + buffer ? "bullish" : latest.low < low.price - buffer ? "bearish" : "neutral";
  return Object.freeze({
    state: wickDirection === "neutral" ? "inside-structure" : "wick-only-unconfirmed",
    direction: wickDirection,
    level: wickDirection === "bullish" ? high.price + buffer : wickDirection === "bearish" ? low.price - buffer : null,
    candleTime: latest.time,
  });
}

function volumeConfirmation(candles, direction) {
  const sample = candles.slice(-30).filter((candle) => candle.volume > 0);
  if (sample.length < 12 || !["bullish", "bearish"].includes(direction)) {
    return Object.freeze({ status: "unavailable", ratio: null, sampleSize: sample.length, role: "auxiliary-only" });
  }
  const withTrend = sample.filter((candle) => direction === "bullish" ? candle.close > candle.open : candle.close < candle.open);
  const counterTrend = sample.filter((candle) => direction === "bullish" ? candle.close < candle.open : candle.close > candle.open);
  if (withTrend.length < 3 || counterTrend.length < 3) {
    return Object.freeze({ status: "partial", ratio: null, sampleSize: sample.length, role: "auxiliary-only" });
  }
  const average = (items) => items.reduce((sum, candle) => sum + candle.volume, 0) / items.length;
  const ratio = average(withTrend) / Math.max(average(counterTrend), Number.EPSILON);
  return Object.freeze({
    status: ratio >= 1.1 ? "supporting" : ratio <= 0.9 ? "opposing" : "neutral",
    ratio: Number(ratio.toFixed(3)),
    sampleSize: sample.length,
    role: "auxiliary-only",
  });
}

function analyzeContext(context, snapshotTime) {
  const closed = dowTheoryClosedCandles({
    interval: context.interval,
    candles: context.candles,
    snapshotTime,
  });
  if (closed.candles.length < 30) return null;
  const unit = rangeUnit(closed.candles);
  const primary = analyzeScale(closed.candles, SCALE_PROFILES.primary, unit);
  return Object.freeze({ interval: context.interval, direction: primary.direction, pivotCount: primary.pivots.length });
}

function higherTimeframeConfirmation(snapshot, primaryDirection) {
  const contexts = snapshot.contextCandles.map((context) => analyzeContext(context, snapshot.snapshotTime)).filter(Boolean);
  const directional = contexts.filter((context) => ["bullish", "bearish"].includes(context.direction));
  let status = "unavailable";
  if (directional.length && ["bullish", "bearish"].includes(primaryDirection)) {
    const aligned = directional.filter((context) => context.direction === primaryDirection).length;
    status = aligned === directional.length ? "aligned" : aligned === 0 ? "contradicted" : "mixed";
  } else if (contexts.length) status = "partial";
  return Object.freeze({
    status,
    contexts: Object.freeze(contexts),
    interpretation: "product-context-only",
    isClassicAveragesConfirmation: false,
  });
}

function actionPlan(candles, primary, event, unit) {
  const latest = candles.at(-1);
  if (!latest || !primary.lastHigh || !primary.lastLow || !["bullish", "bearish"].includes(primary.direction)) {
    return Object.freeze({
      primaryBias: "neutral",
      disposition: "wait",
      validityBars: 6,
      confirmation: "主趋势尚未形成同时有效的高点与低点序列；等待已收盘 K 线形成明确的道氏结构",
      observeTrigger: "观察主级别是否形成连续 HH/HL 或 LH/LL，并由收盘价确认越过最近反应高点或低点",
    });
  }
  const buffer = Math.max(unit * 0.12, latest.close * 0.00015);
  const bullish = primary.direction === "bullish";
  const trigger = bullish ? primary.lastHigh.price + buffer : primary.lastLow.price - buffer;
  const stop = bullish ? primary.lastLow.price - buffer : primary.lastHigh.price + buffer;
  const risk = Math.abs(trigger - stop);
  const targets = bullish ? [trigger + risk, trigger + risk * 2] : [trigger - risk, trigger - risk * 2];
  return Object.freeze({
    primaryBias: primary.direction,
    currentPrice: latest.close,
    disposition: "wait",
    validityBars: 6,
    ...(bullish ? {
      longTrigger: trigger,
      longInvalidation: stop,
      longTarget: targets[0],
      longTargets: Object.freeze(targets),
    } : {
      shortTrigger: trigger,
      shortInvalidation: stop,
      shortTarget: targets[0],
      shortTargets: Object.freeze(targets),
    }),
    confirmation: event.state === "close-breakout" && event.direction === primary.direction
      ? "当前方向已有收盘突破证据；仍须等待回踩/反抽不重新穿越结构边界，禁止远离触发位追价"
      : `等待已收盘 K 线${bullish ? "站上最近主级别反应高点" : "跌破最近主级别反应低点"}，影线刺破不计确认`,
    observeTrigger: "同时观察主趋势是否延续、次级运动是否结束、高周期是否冲突及成交量是否辅助确认",
  });
}

export function runDowTheoryEngine(snapshot) {
  const closed = dowTheoryClosedCandles(snapshot);
  if (closed.candles.length < 30) throw new TypeError("Dow Theory requires at least 30 closed candles");
  const unit = rangeUnit(closed.candles);
  const scales = Object.freeze(Object.fromEntries(Object.entries(SCALE_PROFILES).map(([id, profile]) => [
    id,
    analyzeScale(closed.candles, profile, unit),
  ])));
  const event = closeConfirmation(closed.candles, scales.primary, unit);
  const volume = volumeConfirmation(closed.candles, scales.primary.direction);
  const higherTimeframes = higherTimeframeConfirmation(snapshot, scales.primary.direction);
  const classicAverages = Object.freeze({
    status: "unavailable",
    reason: "当前快照只包含单一交易标的；未提供可代表不同经济部门的配对市场/指数，因此不能执行经典道氏双指数相互确认",
  });
  const latest = closed.candles.at(-1);
  const evidence = [
    ...scales.primary.pivots.slice(-8).map((pivot) => ({ id: pivot.id, summary: `主级别 ${pivot.label} ${pivot.price}` })),
    { id: `dow-close-${latest.time}`, summary: `最后已收盘 K 线收盘价 ${latest.close}` },
    { id: "dow-classic-confirmation-unavailable", summary: classicAverages.reason },
  ];
  return Object.freeze({
    engineId: DOW_THEORY_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    direction: scales.primary.direction,
    rangeUnit: unit,
    closedCandleCount: closed.candles.length,
    excludedLiveCandles: closed.excludedLiveCandles,
    lastClosedCandle: latest,
    scales,
    closeConfirmation: event,
    confirmations: Object.freeze({ higherTimeframes, volume, classicAverages }),
    phase: Object.freeze({
      status: "indeterminate",
      reason: "仅凭 OHLC 与成交量不能可靠自动判定经典道氏三阶段；不把威科夫吸筹/派发标签冒充道氏阶段",
    }),
    coverage: Object.freeze({
      candles: "available",
      volume: volume.status === "unavailable" ? "unavailable" : "available",
      higherTimeframes: higherTimeframes.status === "unavailable" ? "unavailable" : "available",
      companionMarket: "unavailable",
    }),
    actionPlan: actionPlan(closed.candles, scales.primary, event, unit),
    evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
