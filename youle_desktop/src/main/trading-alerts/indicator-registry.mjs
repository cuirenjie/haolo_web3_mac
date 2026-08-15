const nan = (length) => new Array(length).fill(Number.NaN);
const finite = Number.isFinite;

export function indicatorSma(values, period) {
  const result = nan(values.length);
  if (!Number.isInteger(period) || period <= 0) return result;
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.every(finite)) result[index] = window.reduce((sum, value) => sum + value, 0) / period;
  }
  return result;
}

export function indicatorEma(values, period) {
  const result = nan(values.length);
  if (!Number.isInteger(period) || period <= 0) return result;
  const firstFinite = values.findIndex(finite);
  if (firstFinite < 0 || values.length - firstFinite < period) return result;
  const seed = values.slice(firstFinite, firstFinite + period);
  if (!seed.every(finite)) return result;
  const seedIndex = firstFinite + period - 1;
  result[seedIndex] = seed.reduce((sum, value) => sum + value, 0) / period;
  const factor = 2 / (period + 1);
  for (let index = seedIndex + 1; index < values.length; index += 1) {
    if (!finite(values[index]) || !finite(result[index - 1])) continue;
    result[index] = values[index] * factor + result[index - 1] * (1 - factor);
  }
  return result;
}

function wilders(values, period) {
  const result = nan(values.length);
  const firstFinite = values.findIndex(finite);
  if (firstFinite < 0 || values.length - firstFinite < period) return result;
  const seed = values.slice(firstFinite, firstFinite + period);
  if (!seed.every(finite)) return result;
  const seedIndex = firstFinite + period - 1;
  result[seedIndex] = seed.reduce((sum, value) => sum + value, 0) / period;
  for (let index = seedIndex + 1; index < values.length; index += 1) {
    if (finite(values[index]) && finite(result[index - 1])) result[index] = (result[index - 1] * (period - 1) + values[index]) / period;
  }
  return result;
}

export function computeMacd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastValues = indicatorEma(values, fast);
  const slowValues = indicatorEma(values, slow);
  const dif = values.map((_, index) => finite(fastValues[index]) && finite(slowValues[index]) ? fastValues[index] - slowValues[index] : Number.NaN);
  const dea = indicatorEma(dif, signalPeriod);
  const histogram = dif.map((value, index) => finite(value) && finite(dea[index]) ? value - dea[index] : Number.NaN);
  return { dif, dea, histogram };
}

export function computeBollingerBands(values, period = 20, multiplier = 2) {
  const middle = indicatorSma(values, period);
  const upper = nan(values.length);
  const lower = nan(values.length);
  if (!Number.isInteger(period) || period <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) {
    return { middle, upper, lower };
  }
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (!window.every(finite) || !finite(middle[index])) continue;
    const variance = window.reduce((sum, value) => sum + (value - middle[index]) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    upper[index] = middle[index] + deviation;
    lower[index] = middle[index] - deviation;
  }
  return { middle, upper, lower };
}

export function computeRsi(values, period = 14) {
  const result = nan(values.length);
  if (values.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const value = () => averageGain === 0 && averageLoss === 0 ? 50 : averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  result[period] = value();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = value();
  }
  return result;
}

function rollingExtremes(candles, period) {
  const highest = nan(candles.length);
  const lowest = nan(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    highest[index] = Math.max(...window.map((item) => item.high));
    lowest[index] = Math.min(...window.map((item) => item.low));
  }
  return { highest, lowest };
}

export function computeKdj(candles, period = 9, smoothK = 3, smoothD = 3) {
  const { highest, lowest } = rollingExtremes(candles, period);
  const k = nan(candles.length), d = nan(candles.length), j = nan(candles.length);
  let previousK = 50, previousD = 50;
  for (let index = period - 1; index < candles.length; index += 1) {
    const range = highest[index] - lowest[index];
    const rsv = range === 0 ? 50 : ((candles[index].close - lowest[index]) / range) * 100;
    previousK = ((smoothK - 1) * previousK + rsv) / smoothK;
    previousD = ((smoothD - 1) * previousD + previousK) / smoothD;
    k[index] = previousK; d[index] = previousD; j[index] = 3 * previousK - 2 * previousD;
  }
  return { k, d, j };
}

export function computeAtr(candles, period = 14) {
  return wilders(candles.map((item, index) => index === 0 ? item.high - item.low : Math.max(item.high - item.low, Math.abs(item.high - candles[index - 1].close), Math.abs(item.low - candles[index - 1].close))), period);
}

export function computeCci(candles, period = 20) {
  const typical = candles.map((item) => (item.high + item.low + item.close) / 3);
  const average = indicatorSma(typical, period);
  return typical.map((value, index) => {
    if (!finite(average[index])) return Number.NaN;
    const window = typical.slice(index - period + 1, index + 1);
    const deviation = window.reduce((sum, item) => sum + Math.abs(item - average[index]), 0) / period;
    return deviation === 0 ? 0 : (value - average[index]) / (0.015 * deviation);
  });
}

export function computeAdx(candles, period = 14) {
  const tr = candles.map((item, i) => i === 0 ? item.high - item.low : Math.max(item.high - item.low, Math.abs(item.high - candles[i - 1].close), Math.abs(item.low - candles[i - 1].close)));
  const plusDm = candles.map((item, i) => i === 0 ? 0 : Math.max(item.high - candles[i - 1].high, 0) > Math.max(candles[i - 1].low - item.low, 0) ? Math.max(item.high - candles[i - 1].high, 0) : 0);
  const minusDm = candles.map((item, i) => i === 0 ? 0 : Math.max(candles[i - 1].low - item.low, 0) > Math.max(item.high - candles[i - 1].high, 0) ? Math.max(candles[i - 1].low - item.low, 0) : 0);
  const atr = wilders(tr, period), plus = wilders(plusDm, period), minus = wilders(minusDm, period);
  const positiveDi = atr.map((value, i) => finite(value) && value !== 0 ? plus[i] / value * 100 : Number.NaN);
  const negativeDi = atr.map((value, i) => finite(value) && value !== 0 ? minus[i] / value * 100 : Number.NaN);
  const dx = positiveDi.map((value, i) => finite(value) && finite(negativeDi[i]) && value + negativeDi[i] !== 0 ? Math.abs(value - negativeDi[i]) / (value + negativeDi[i]) * 100 : Number.NaN);
  return { adx: wilders(dx, period), positiveDi, negativeDi };
}

function params(expr) {
  const integer = (key, fallback) => Math.max(1, Math.min(100_000, Math.round(Number(expr.params?.[key]) || fallback)));
  return { integer };
}

export class TradingIndicatorRegistry {
  constructor() { this.indicators = new Map(); }
  register(name, calculate) {
    const key = String(name).toLowerCase();
    if (this.indicators.has(key)) throw new TypeError(`Duplicate indicator: ${key}`);
    this.indicators.set(key, calculate);
    return this;
  }
  has(name) { return this.indicators.has(String(name).toLowerCase()); }
  evaluate(expr, candles, index = candles.length - 1) {
    const calculate = this.indicators.get(String(expr.name).toLowerCase());
    if (!calculate) return { value: "unknown", reason: `unsupported_indicator:${expr.name}` };
    const series = calculate(candles, expr);
    const output = String(expr.output || Object.keys(series)[0]);
    const values = series[output];
    const value = values?.[index];
    return finite(value) ? { value, series: values, output } : { value: "unknown", reason: "insufficient_history", series: values, output };
  }
}

export function createBuiltinIndicatorRegistry() {
  const registry = new TradingIndicatorRegistry();
  registry.register("sma", (candles, expr) => ({ value: indicatorSma(candles.map((c) => c.close), params(expr).integer("period", 5)) }));
  registry.register("ma", (candles, expr) => ({ value: indicatorSma(candles.map((c) => c.close), params(expr).integer("period", 5)) }));
  registry.register("ema", (candles, expr) => ({ value: indicatorEma(candles.map((c) => c.close), params(expr).integer("period", 5)) }));
  registry.register("macd", (candles, expr) => computeMacd(candles.map((c) => c.close), params(expr).integer("fast", 12), params(expr).integer("slow", 26), params(expr).integer("signal", 9)));
  registry.register("rsi", (candles, expr) => ({ value: computeRsi(candles.map((c) => c.close), params(expr).integer("period", 14)) }));
  registry.register("kdj", (candles, expr) => computeKdj(candles, params(expr).integer("period", 9), params(expr).integer("smoothK", 3), params(expr).integer("smoothD", 3)));
  registry.register("atr", (candles, expr) => ({ value: computeAtr(candles, params(expr).integer("period", 14)) }));
  registry.register("cci", (candles, expr) => ({ value: computeCci(candles, params(expr).integer("period", 20)) }));
  registry.register("adx", (candles, expr) => computeAdx(candles, params(expr).integer("period", 14)));
  registry.register("boll", (candles, expr) => computeBollingerBands(
    candles.map((candle) => candle.close),
    params(expr).integer("period", 20),
    Number(expr.params?.multiplier) || 2,
  ));
  registry.register("momentum", (candles, expr) => ({ value: candles.map((c, i, all) => i >= params(expr).integer("period", 10) ? c.close - all[i - params(expr).integer("period", 10)].close : Number.NaN) }));
  registry.register("roc", (candles, expr) => ({ value: candles.map((c, i, all) => {
    const period = params(expr).integer("period", 12); return i >= period && all[i - period].close !== 0 ? (c.close / all[i - period].close - 1) * 100 : Number.NaN;
  }) }));
  return registry;
}
