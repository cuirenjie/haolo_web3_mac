export const MACD_ANALYSIS_ENGINE_ID = "macd-analysis-deterministic-v1";

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function intervalSeconds(interval, candles) {
  const source = String(interval || "").toUpperCase();
  if (source === "1D") return 86_400;
  if (source === "1W") return 604_800;
  if (/^\d+$/.test(source)) return Number(source) * 60;
  return median(candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((item) => item > 0)) || 3_600;
}

export function macdClosedCandles(snapshot) {
  const seconds = intervalSeconds(snapshot.interval, snapshot.candles);
  const now = Number(snapshot.snapshotTime) > 100_000_000_000 ? Number(snapshot.snapshotTime) / 1_000 : Number(snapshot.snapshotTime);
  const candles = snapshot.candles.filter((candle) => candle.time + seconds <= now + 1);
  return Object.freeze({ candles: Object.freeze(candles), excludedLiveCandles: snapshot.candles.length - candles.length });
}

export function macdEma(values, period) {
  const result = new Array(values.length).fill(Number.NaN);
  if (!Number.isInteger(period) || period <= 0) return result;
  const firstFinite = values.findIndex(Number.isFinite);
  if (firstFinite < 0 || values.length - firstFinite < period) return result;
  const seed = values.slice(firstFinite, firstFinite + period);
  if (!seed.every(Number.isFinite)) return result;
  const seedIndex = firstFinite + period - 1;
  result[seedIndex] = seed.reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  for (let index = seedIndex + 1; index < values.length; index += 1) {
    if (Number.isFinite(values[index]) && Number.isFinite(result[index - 1])) result[index] = values[index] * alpha + result[index - 1] * (1 - alpha);
  }
  return result;
}

export function calculateMacdSeries(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const closes = candles.map((candle) => candle.close);
  const fast = macdEma(closes, fastPeriod);
  const slow = macdEma(closes, slowPeriod);
  const dif = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index]) ? fast[index] - slow[index] : Number.NaN);
  const dea = macdEma(dif, signalPeriod);
  const histogram = dif.map((value, index) => Number.isFinite(value) && Number.isFinite(dea[index]) ? value - dea[index] : Number.NaN);
  return Object.freeze({ dif: Object.freeze(dif), dea: Object.freeze(dea), histogram: Object.freeze(histogram) });
}

function crosses(series, signal) {
  const events = [];
  for (let index = 1; index < series.length; index += 1) {
    if (![series[index - 1], signal[index - 1], series[index], signal[index]].every(Number.isFinite)) continue;
    const previous = series[index - 1] - signal[index - 1];
    const current = series[index] - signal[index];
    if (previous <= 0 && current > 0) events.push({ type: "bull", index });
    if (previous >= 0 && current < 0) events.push({ type: "bear", index });
  }
  return events;
}

function pivots(values, radius = 2) {
  const result = [];
  for (let index = radius; index < values.length - radius; index += 1) {
    const window = values.slice(index - radius, index + radius + 1);
    if (!window.every(Number.isFinite)) continue;
    const others = window.filter((_, offset) => offset !== radius);
    if (values[index] > Math.max(...others)) result.push({ type: "high", index, value: values[index] });
    if (values[index] < Math.min(...others)) result.push({ type: "low", index, value: values[index] });
  }
  return result;
}

function pricePivots(candles, radius = 2) {
  const highs = pivots(candles.map((candle) => candle.high), radius).filter((item) => item.type === "high");
  const lows = pivots(candles.map((candle) => candle.low), radius).filter((item) => item.type === "low");
  return { highs, lows };
}

export function detectMacdDivergences(candles, series) {
  const result = [];
  const price = pricePivots(candles);
  const finiteDif = series.dif.slice(-120).filter(Number.isFinite);
  const macdRange = Math.max(...finiteDif) - Math.min(...finiteDif);
  const indicatorThreshold = Math.max(macdRange * 0.025, Number.EPSILON);
  const inspect = (items, side) => {
    for (let offset = Math.max(1, items.length - 5); offset < items.length; offset += 1) {
      const first = items[offset - 1];
      const second = items[offset];
      if (!first || !second || second.index - first.index < 4 || second.index - first.index > 90) continue;
      const priceDelta = second.value - first.value;
      const difDelta = series.dif[second.index] - series.dif[first.index];
      const priceThreshold = Math.max(Math.abs(first.value) * 0.0005, median(candles.slice(first.index, second.index + 1).map((c) => c.high - c.low)) * 0.3);
      let kind = null;
      if (side === "high" && priceDelta > priceThreshold && difDelta < -indicatorThreshold) kind = "regular-bearish";
      if (side === "low" && priceDelta < -priceThreshold && difDelta > indicatorThreshold) kind = "regular-bullish";
      if (side === "low" && priceDelta > priceThreshold && difDelta < -indicatorThreshold) kind = "hidden-bullish";
      if (side === "high" && priceDelta < -priceThreshold && difDelta > indicatorThreshold) kind = "hidden-bearish";
      if (!kind) continue;
      const histogramAgrees = kind.includes("bearish")
        ? series.histogram[second.index] < series.histogram[first.index]
        : series.histogram[second.index] > series.histogram[first.index];
      result.push(Object.freeze({
        id: `macd-divergence-${kind}-${candles[second.index].time}`,
        kind,
        firstIndex: first.index,
        secondIndex: second.index,
        priceFirst: first.value,
        priceSecond: second.value,
        difFirst: series.dif[first.index],
        difSecond: series.dif[second.index],
        histogramAgrees,
        status: "confirmed",
      }));
    }
  };
  inspect(price.highs, "high");
  inspect(price.lows, "low");
  return Object.freeze(result.slice(-6));
}

export function detectMacdClassicPatterns(candles, series) {
  const events = crosses(series.dif, series.dea);
  const latest = candles.length - 1;
  const recent = events.filter((event) => latest - event.index <= 45);
  const scale = Math.max(...series.dif.slice(-100).filter(Number.isFinite).map(Math.abs), ...series.dea.slice(-100).filter(Number.isFinite).map(Math.abs), Number.EPSILON);
  const near = scale * 0.08;
  const patterns = [];
  const add = (id, name, startIndex, endIndex, family, detail) => {
    if (latest - endIndex > 16 || patterns.some((item) => item.id === id)) return;
    patterns.push(Object.freeze({ id, name, startIndex, endIndex, family, detail, status: "confirmed" }));
  };
  for (let index = 2; index < recent.length; index += 1) {
    const first = recent[index - 2], middle = recent[index - 1], last = recent[index];
    if (first.type === "bull" && middle.type === "bear" && last.type === "bull") {
      const firstBelow = series.dif[first.index] < near;
      const secondBelow = series.dif[last.index] < -near;
      if (firstBelow && secondBelow) {
        add(`macd-sea-moon-${candles[last.index].time}`, "海底捞月", first.index, last.index, "bottom-reversal", "零轴下二次金叉");
        if (Math.max(...series.dif.slice(first.index, middle.index + 1)) <= near) add(`macd-duck-${candles[last.index].time}`, "小鸭出水", first.index, last.index, "bottom-reversal", "低位金叉—死叉—再金叉");
      }
      if (series.dif[middle.index] > near && Math.min(...series.dif.slice(middle.index, last.index + 1)) <= near && series.dif[last.index] >= -near) {
        add(`macd-cloud-${candles[last.index].time}`, "漫步青云", middle.index, last.index, "trend-resumption", "零轴上死叉回落后近零轴再金叉");
      }
      if (series.dif[middle.index] > near && Math.min(...series.dif.slice(middle.index, last.index + 1)) > near) {
        add(`macd-cable-car-${candles[last.index].time}`, "空中缆车", middle.index, last.index, "trend-resumption", "零轴上死叉后未破零轴再金叉");
      }
    }
  }
  const lastBull = [...recent].reverse().find((event) => event.type === "bull");
  const bearAfter = lastBull && recent.find((event) => event.index > lastBull.index && event.type === "bear");
  if (lastBull && !bearAfter && latest - lastBull.index >= 4) {
    const segment = series.histogram.slice(lastBull.index, latest + 1);
    let troughOffset = 1;
    for (let i = 2; i < segment.length - 1; i += 1) if (segment[i] < segment[troughOffset]) troughOffset = i;
    const trough = lastBull.index + troughOffset;
    const contractedThenExpanded = trough < latest - 1 && series.histogram[latest] > series.histogram[latest - 1] && series.histogram[latest] > 0;
    const noCross = Math.min(...segment) >= -near * 0.25;
    if (contractedThenExpanded && noCross) {
      if (series.dif[latest] < -near) add(`macd-swan-${candles[latest].time}`, "天鹅展翅", lastBull.index, latest, "bottom-reversal", "零轴下红柱收缩后再扩张且未死叉");
      else add(`macd-buddha-${candles[latest].time}`, "佛手向上", lastBull.index, latest, "trend-resumption", "金叉后回踩DEA未死叉并再次向上");
      if (series.dif[lastBull.index] < near && series.dif[latest] > near && Math.abs(series.histogram[trough]) <= near) add(`macd-air-rope-${candles[latest].time}`, "空中缆绳", lastBull.index, latest, "trend-resumption", "由零轴下金叉上行，零轴上粘合未死叉后再多头发散");
    }
    const belowRun = series.dif.slice(Math.max(0, lastBull.index - 24), lastBull.index + 1).filter((value) => value < 0).length;
    const nearBars = segment.filter((value) => Math.abs(value) <= near).length;
    if (series.dif[lastBull.index] < 0 && belowRun >= 18 && nearBars >= 3 && series.histogram[latest] > series.histogram[latest - 1]) {
      add(`macd-sea-cable-${candles[latest].time}`, "海底电缆", Math.max(0, lastBull.index - 18), latest, "bottom-reversal", "零轴下长期运行、金叉粘合后向上发散");
    }
  }
  return Object.freeze(patterns.slice(-5));
}

function state(candles, series, events) {
  const latest = candles.length - 1;
  const whipsawCount = events.filter((event) => latest - event.index <= 20).length;
  return Object.freeze({
    dif: series.dif[latest], dea: series.dea[latest], histogram: series.histogram[latest],
    zone: series.dif[latest] >= 0 && series.dea[latest] >= 0 ? "above-zero" : series.dif[latest] <= 0 && series.dea[latest] <= 0 ? "below-zero" : "crossing-zero",
    relation: series.dif[latest] >= series.dea[latest] ? "bullish" : "bearish",
    momentum: Math.abs(series.histogram[latest]) > Math.abs(series.histogram[latest - 1]) ? "expanding" : "contracting",
    whipsawCount,
    whipsawRisk: whipsawCount >= 4 ? "high" : whipsawCount >= 3 ? "medium" : "low",
  });
}

function actionPlan(candles, divergences, patterns, currentState) {
  const latest = candles.at(-1);
  const evidence = divergences.at(-1);
  const bullish = evidence?.kind.includes("bullish") || (!evidence && patterns.at(-1)?.family === "bottom-reversal");
  const bearish = evidence?.kind.includes("bearish");
  if ((!bullish && !bearish) || currentState.whipsawRisk === "high") return Object.freeze({ primaryBias: bullish ? "bullish" : bearish ? "bearish" : "neutral", disposition: "wait", validityBars: 4, confirmation: "MACD 只提供趋势与动能证据；等待已收盘 K 线突破最近结构边界", observeTrigger: "观察 DIF/DEA、柱体和价格结构是否共同确认，震荡频繁交叉时不执行" });
  const window = candles.slice(-20);
  const trigger = bullish ? Math.max(...window.map((c) => c.high)) : Math.min(...window.map((c) => c.low));
  const stop = bullish ? Math.min(...window.map((c) => c.low)) : Math.max(...window.map((c) => c.high));
  const risk = Math.max(Math.abs(trigger - stop), latest.close * 0.001);
  const targets = bullish ? [trigger + risk, trigger + risk * 2] : [trigger - risk, trigger - risk * 2];
  return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish", currentPrice: latest.close, disposition: "wait", validityBars: 4,
    ...(bullish ? { longTrigger: trigger, longInvalidation: stop, longTarget: targets[0], longTargets: Object.freeze(targets) } : { shortTrigger: trigger, shortInvalidation: stop, shortTarget: targets[0], shortTargets: Object.freeze(targets) }),
    confirmation: `等待已收盘 K 线${bullish ? "站上" : "跌破"}最近 20 根价格结构边界；MACD 信号不得单独触发`,
    observeTrigger: "触发时重新确认 DIF/DEA 方向、柱体没有反向翻转且背离/经典形态尚未失效",
  });
}

export function runMacdAnalysisEngine(snapshot) {
  const closed = macdClosedCandles(snapshot);
  if (closed.candles.length < 80) throw new TypeError("MACD analysis requires at least 80 closed candles");
  const series = calculateMacdSeries(closed.candles);
  const events = Object.freeze(crosses(series.dif, series.dea).map((event) => Object.freeze({ ...event, time: closed.candles[event.index].time })));
  const divergences = detectMacdDivergences(closed.candles, series);
  const patterns = detectMacdClassicPatterns(closed.candles, series);
  const currentState = state(closed.candles, series, events);
  const evidence = [
    ...patterns.map((item) => ({ id: item.id, summary: `${item.name}：${item.detail}` })),
    ...divergences.map((item) => ({ id: item.id, summary: `${item.kind} price ${item.priceFirst}→${item.priceSecond}; DIF ${item.difFirst}→${item.difSecond}` })),
    { id: `macd-state-${closed.candles.at(-1).time}`, summary: `DIF ${currentState.dif}; DEA ${currentState.dea}; histogram ${currentState.histogram}` },
  ];
  return Object.freeze({
    engineId: MACD_ANALYSIS_ENGINE_ID, version: "1.0.0", status: "completed", parameters: Object.freeze([12, 26, 9]),
    closedCandleCount: closed.candles.length, excludedLiveCandles: closed.excludedLiveCandles, lastClosedCandle: closed.candles.at(-1),
    currentState, events, patterns, divergences, series,
    coverage: Object.freeze({ candles: "available", macd: "available", volume: "unavailable" }),
    actionPlan: actionPlan(closed.candles, divergences, patterns, currentState), evidence: Object.freeze(evidence.map(Object.freeze)),
  });
}
