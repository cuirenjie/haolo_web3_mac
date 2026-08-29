export type TradingIndicatorId =
  | "volume"
  | "macd"
  | "rsi"
  | "kdj"
  | "stoch"
  | "cci"
  | "atr"
  | "adx"
  | "momentum"
  | "roc"
  | "obv"
  | "mfi"
  | "willr";

export interface TradingIndicatorCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TradingIndicatorDefinition {
  id: TradingIndicatorId;
  label: string;
  name: string;
  parameters: string;
}

export interface TradingIndicatorSeries {
  key: string;
  label: string;
  color: string;
  type: "line" | "histogram";
  values: number[];
  colors?: string[];
  priceFormat?: "volume" | "price";
  baseValue?: number;
}

export interface TradingIndicatorResult {
  definition: TradingIndicatorDefinition;
  series: TradingIndicatorSeries[];
  referenceLines?: Array<{ value: number; color: string }>;
}

export const TRADING_INDICATORS: readonly TradingIndicatorDefinition[] = [
  { id: "volume", label: "VOLUME", name: "成交量", parameters: "MA(5,10)" },
  { id: "macd", label: "MACD", name: "指数平滑异同移动平均线", parameters: "12,26,9" },
  { id: "rsi", label: "RSI", name: "相对强弱指标", parameters: "14" },
  { id: "kdj", label: "KDJ", name: "随机指标", parameters: "9,3,3" },
  { id: "stoch", label: "STOCH", name: "随机震荡指标", parameters: "14,3,3" },
  { id: "cci", label: "CCI", name: "顺势指标", parameters: "20" },
  { id: "atr", label: "ATR", name: "平均真实波幅", parameters: "14" },
  { id: "adx", label: "ADX", name: "平均趋向指标", parameters: "14" },
  { id: "momentum", label: "MOM", name: "动量指标", parameters: "10" },
  { id: "roc", label: "ROC", name: "变动率指标", parameters: "12" },
  { id: "obv", label: "OBV", name: "能量潮", parameters: "" },
  { id: "mfi", label: "MFI", name: "资金流量指标", parameters: "14" },
  { id: "willr", label: "W%R", name: "威廉指标", parameters: "14" },
] as const;

export const TRADING_RISING_BAR_COLOR = "#2EBD85";
export const TRADING_FALLING_BAR_COLOR = "#F6465D";

const LINE_COLORS = {
  cyan: "#22b8cf",
  amber: "#e5ad25",
  purple: "#8b5cf6",
  blue: "#3b82f6",
  pink: "#ec4899",
  green: TRADING_RISING_BAR_COLOR,
  red: TRADING_FALLING_BAR_COLOR,
};

const nanValues = (length: number) => new Array<number>(length).fill(Number.NaN);
const finite = (value: number) => Number.isFinite(value);
const volumes = (candles: TradingIndicatorCandle[]) => candles.map((item) => Number(item.volume || 0));
const closes = (candles: TradingIndicatorCandle[]) => candles.map((item) => item.close);

export function indicatorSma(values: number[], period: number) {
  const result = nanValues(values.length);
  if (period <= 0) return result;
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.every(finite)) result[index] = window.reduce((sum, value) => sum + value, 0) / period;
  }
  return result;
}

export function indicatorEma(values: number[], period: number) {
  const result = nanValues(values.length);
  if (period <= 0) return result;
  const firstFinite = values.findIndex(finite);
  if (firstFinite < 0 || values.length - firstFinite < period) return result;
  const seed = values.slice(firstFinite, firstFinite + period);
  if (!seed.every(finite)) return result;
  const seedIndex = firstFinite + period - 1;
  result[seedIndex] = seed.reduce((sum, value) => sum + value, 0) / period;
  const factor = 2 / (period + 1);
  for (let index = seedIndex + 1; index < values.length; index += 1) {
    if (!finite(values[index])) continue;
    result[index] = values[index] * factor + result[index - 1] * (1 - factor);
  }
  return result;
}

function wilders(values: number[], period: number) {
  const result = nanValues(values.length);
  const firstFinite = values.findIndex(finite);
  if (firstFinite < 0 || values.length - firstFinite < period) return result;
  const seed = values.slice(firstFinite, firstFinite + period);
  if (!seed.every(finite)) return result;
  const seedIndex = firstFinite + period - 1;
  result[seedIndex] = seed.reduce((sum, value) => sum + value, 0) / period;
  for (let index = seedIndex + 1; index < values.length; index += 1) {
    if (!finite(values[index])) continue;
    result[index] = (result[index - 1] * (period - 1) + values[index]) / period;
  }
  return result;
}

export function computeMacd(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = indicatorEma(values, fastPeriod);
  const slow = indicatorEma(values, slowPeriod);
  const macd = values.map((_, index) => finite(fast[index]) && finite(slow[index])
    ? fast[index] - slow[index]
    : Number.NaN);
  const signal = indicatorEma(macd, signalPeriod);
  const histogram = macd.map((value, index) => finite(value) && finite(signal[index])
    ? value - signal[index]
    : Number.NaN);
  return { macd, signal, histogram };
}

export function computeRsi(values: number[], period = 14) {
  const result = nanValues(values.length);
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
  const toRsi = () => averageGain === 0 && averageLoss === 0
    ? 50
    : averageLoss === 0
      ? 100
      : 100 - 100 / (1 + averageGain / averageLoss);
  result[period] = toRsi();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = toRsi();
  }
  return result;
}

function rollingExtremes(candles: TradingIndicatorCandle[], period: number) {
  const highest = nanValues(candles.length);
  const lowest = nanValues(candles.length);
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    highest[index] = Math.max(...window.map((item) => item.high));
    lowest[index] = Math.min(...window.map((item) => item.low));
  }
  return { highest, lowest };
}

export function computeKdj(
  candles: TradingIndicatorCandle[],
  period = 9,
  smoothK = 3,
  smoothD = 3,
) {
  const { highest, lowest } = rollingExtremes(candles, period);
  const k = nanValues(candles.length);
  const d = nanValues(candles.length);
  const j = nanValues(candles.length);
  let previousK = 50;
  let previousD = 50;
  for (let index = period - 1; index < candles.length; index += 1) {
    const range = highest[index] - lowest[index];
    const rsv = range === 0 ? 50 : ((candles[index].close - lowest[index]) / range) * 100;
    previousK = ((smoothK - 1) * previousK + rsv) / smoothK;
    previousD = ((smoothD - 1) * previousD + previousK) / smoothD;
    k[index] = previousK;
    d[index] = previousD;
    j[index] = 3 * previousK - 2 * previousD;
  }
  return { k, d, j };
}

export function computeStochastic(candles: TradingIndicatorCandle[], period = 14, smoothK = 3, smoothD = 3) {
  const { highest, lowest } = rollingExtremes(candles, period);
  const rawK = candles.map((item, index) => {
    if (!finite(highest[index]) || !finite(lowest[index])) return Number.NaN;
    const range = highest[index] - lowest[index];
    return range === 0 ? 50 : ((item.close - lowest[index]) / range) * 100;
  });
  const k = indicatorSma(rawK, smoothK);
  const d = indicatorSma(k, smoothD);
  return { k, d };
}

export function computeAtr(candles: TradingIndicatorCandle[], period = 14) {
  const trueRanges = candles.map((item, index) => index === 0
    ? item.high - item.low
    : Math.max(
        item.high - item.low,
        Math.abs(item.high - candles[index - 1].close),
        Math.abs(item.low - candles[index - 1].close),
      ));
  return wilders(trueRanges, period);
}

export function computeAdx(candles: TradingIndicatorCandle[], period = 14) {
  const trueRanges = candles.map((item, index) => index === 0
    ? item.high - item.low
    : Math.max(
        item.high - item.low,
        Math.abs(item.high - candles[index - 1].close),
        Math.abs(item.low - candles[index - 1].close),
      ));
  const positiveDm = candles.map((item, index) => {
    if (index === 0) return 0;
    const up = item.high - candles[index - 1].high;
    const down = candles[index - 1].low - item.low;
    return up > down && up > 0 ? up : 0;
  });
  const negativeDm = candles.map((item, index) => {
    if (index === 0) return 0;
    const up = item.high - candles[index - 1].high;
    const down = candles[index - 1].low - item.low;
    return down > up && down > 0 ? down : 0;
  });
  const atr = wilders(trueRanges, period);
  const positiveAverage = wilders(positiveDm, period);
  const negativeAverage = wilders(negativeDm, period);
  const positiveDi = atr.map((value, index) => finite(value) && value !== 0
    ? (positiveAverage[index] / value) * 100
    : Number.NaN);
  const negativeDi = atr.map((value, index) => finite(value) && value !== 0
    ? (negativeAverage[index] / value) * 100
    : Number.NaN);
  const dx = positiveDi.map((value, index) => {
    const negative = negativeDi[index];
    const total = value + negative;
    return finite(value) && finite(negative) && total !== 0
      ? (Math.abs(value - negative) / total) * 100
      : Number.NaN;
  });
  return { adx: wilders(dx, period), positiveDi, negativeDi };
}

export function computeCci(candles: TradingIndicatorCandle[], period = 20) {
  const typical = candles.map((item) => (item.high + item.low + item.close) / 3);
  const average = indicatorSma(typical, period);
  return typical.map((value, index) => {
    if (!finite(average[index])) return Number.NaN;
    const window = typical.slice(index - period + 1, index + 1);
    const deviation = window.reduce((sum, item) => sum + Math.abs(item - average[index]), 0) / period;
    return deviation === 0 ? 0 : (value - average[index]) / (0.015 * deviation);
  });
}

export function computeObv(candles: TradingIndicatorCandle[]) {
  let total = 0;
  return candles.map((item, index) => {
    if (index > 0) {
      if (item.close > candles[index - 1].close) total += Number(item.volume || 0);
      else if (item.close < candles[index - 1].close) total -= Number(item.volume || 0);
    }
    return total;
  });
}

export function computeMfi(candles: TradingIndicatorCandle[], period = 14) {
  const typical = candles.map((item) => (item.high + item.low + item.close) / 3);
  const rawFlow = candles.map((item, index) => typical[index] * Number(item.volume || 0));
  const result = nanValues(candles.length);
  for (let index = period; index < candles.length; index += 1) {
    let positive = 0;
    let negative = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      if (typical[cursor] > typical[cursor - 1]) positive += rawFlow[cursor];
      else if (typical[cursor] < typical[cursor - 1]) negative += rawFlow[cursor];
    }
    result[index] = positive === 0 && negative === 0
      ? 50
      : negative === 0
        ? 100
        : 100 - 100 / (1 + positive / negative);
  }
  return result;
}

export function computeWilliamsR(candles: TradingIndicatorCandle[], period = 14) {
  const { highest, lowest } = rollingExtremes(candles, period);
  return candles.map((item, index) => {
    if (!finite(highest[index]) || !finite(lowest[index])) return Number.NaN;
    const range = highest[index] - lowest[index];
    return range === 0 ? -50 : ((highest[index] - item.close) / range) * -100;
  });
}

function difference(values: number[], period: number) {
  return values.map((value, index) => index >= period ? value - values[index - period] : Number.NaN);
}

function rateOfChange(values: number[], period: number) {
  return values.map((value, index) => index >= period && values[index - period] !== 0
    ? ((value / values[index - period]) - 1) * 100
    : Number.NaN);
}

function definitionFor(id: TradingIndicatorId) {
  const definition = TRADING_INDICATORS.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown trading indicator: ${id}`);
  return definition;
}

export function calculateTradingIndicator(
  id: TradingIndicatorId,
  candles: TradingIndicatorCandle[],
  parameters: readonly number[] = [],
): TradingIndicatorResult {
  const definition = definitionFor(id);
  const parameterAt = (
    index: number,
    fallback: number,
    options: { min?: number; max?: number; integer?: boolean } = {},
  ) => {
    const raw = Number(parameters[index]);
    const minimum = options.min ?? 1;
    const maximum = options.max ?? 10_000;
    const normalized = Number.isFinite(raw) ? Math.min(Math.max(raw, minimum), maximum) : fallback;
    return options.integer === false ? normalized : Math.round(normalized);
  };
  const line = (key: string, label: string, color: string, values: number[]): TradingIndicatorSeries => ({
    key,
    label,
    color,
    type: "line",
    values,
    priceFormat: "price",
  });
  const priceCloses = closes(candles);
  if (id === "volume") {
    const values = volumes(candles);
    const fastPeriod = parameterAt(0, 5);
    const slowPeriod = parameterAt(1, 10);
    return {
      definition,
      series: [
        {
          key: "volume",
          label: "VOL",
          color: LINE_COLORS.green,
          type: "histogram",
          values,
          colors: candles.map((item) => item.close >= item.open
            ? TRADING_RISING_BAR_COLOR
            : TRADING_FALLING_BAR_COLOR),
          priceFormat: "volume",
        },
        line("ma5", `MA${fastPeriod}`, LINE_COLORS.cyan, indicatorSma(values, fastPeriod)),
        line("ma10", `MA${slowPeriod}`, LINE_COLORS.amber, indicatorSma(values, slowPeriod)),
      ],
    };
  }
  if (id === "macd") {
    const fastPeriod = parameterAt(0, 12);
    const slowPeriod = parameterAt(1, 26);
    const signalPeriod = parameterAt(2, 9);
    const result = computeMacd(priceCloses, fastPeriod, slowPeriod, signalPeriod);
    return {
      definition,
      series: [
        line("dif", "DIF", LINE_COLORS.cyan, result.macd),
        line("dea", "DEA", LINE_COLORS.amber, result.signal),
        {
          key: "histogram",
          label: "MACD",
          color: LINE_COLORS.green,
          type: "histogram",
          values: result.histogram,
          colors: result.histogram.map((value) => value >= 0
            ? TRADING_RISING_BAR_COLOR
            : TRADING_FALLING_BAR_COLOR),
          priceFormat: "price",
        },
      ],
      referenceLines: [{ value: 0, color: "rgba(123, 135, 151, 0.45)" }],
    };
  }
  if (id === "rsi") {
    const period = parameterAt(0, 14);
    return {
      definition,
      series: [line("rsi", "RSI", LINE_COLORS.purple, computeRsi(priceCloses, period))],
      referenceLines: [
        { value: 70, color: "rgba(239, 83, 80, 0.5)" },
        { value: 50, color: "rgba(123, 135, 151, 0.45)" },
        { value: 30, color: "rgba(22, 168, 115, 0.5)" },
      ],
    };
  }
  if (id === "kdj") {
    const result = computeKdj(
      candles,
      parameterAt(0, 9),
      parameterAt(1, 3),
      parameterAt(2, 3),
    );
    return {
      definition,
      series: [
        line("k", "K", LINE_COLORS.cyan, result.k),
        line("d", "D", LINE_COLORS.amber, result.d),
        line("j", "J", LINE_COLORS.purple, result.j),
      ],
      referenceLines: [
        { value: 80, color: "rgba(239, 83, 80, 0.5)" },
        { value: 50, color: "rgba(123, 135, 151, 0.45)" },
        { value: 20, color: "rgba(22, 168, 115, 0.5)" },
      ],
    };
  }
  if (id === "stoch") {
    const result = computeStochastic(
      candles,
      parameterAt(0, 14),
      parameterAt(1, 3),
      parameterAt(2, 3),
    );
    return {
      definition,
      series: [
        line("k", "%K", LINE_COLORS.cyan, result.k),
        line("d", "%D", LINE_COLORS.amber, result.d),
      ],
      referenceLines: [
        { value: 80, color: "rgba(239, 83, 80, 0.5)" },
        { value: 20, color: "rgba(22, 168, 115, 0.5)" },
      ],
    };
  }
  if (id === "cci") {
    const period = parameterAt(0, 20);
    return {
      definition,
      series: [line("cci", "CCI", LINE_COLORS.purple, computeCci(candles, period))],
      referenceLines: [
        { value: 100, color: "rgba(239, 83, 80, 0.5)" },
        { value: -100, color: "rgba(22, 168, 115, 0.5)" },
      ],
    };
  }
  if (id === "atr") {
    const period = parameterAt(0, 14);
    return { definition, series: [line("atr", "ATR", LINE_COLORS.amber, computeAtr(candles, period))] };
  }
  if (id === "adx") {
    const result = computeAdx(candles, parameterAt(0, 14));
    return {
      definition,
      series: [
        line("adx", "ADX", LINE_COLORS.amber, result.adx),
        line("positiveDi", "+DI", LINE_COLORS.green, result.positiveDi),
        line("negativeDi", "-DI", LINE_COLORS.red, result.negativeDi),
      ],
      referenceLines: [{ value: 25, color: "rgba(123, 135, 151, 0.5)" }],
    };
  }
  if (id === "momentum") {
    const period = parameterAt(0, 10);
    return {
      definition,
      series: [line("momentum", "MOM", LINE_COLORS.blue, difference(priceCloses, period))],
      referenceLines: [{ value: 0, color: "rgba(123, 135, 151, 0.45)" }],
    };
  }
  if (id === "roc") {
    const period = parameterAt(0, 12);
    return {
      definition,
      series: [line("roc", "ROC", LINE_COLORS.pink, rateOfChange(priceCloses, period))],
      referenceLines: [{ value: 0, color: "rgba(123, 135, 151, 0.45)" }],
    };
  }
  if (id === "obv") {
    return { definition, series: [line("obv", "OBV", LINE_COLORS.blue, computeObv(candles))] };
  }
  if (id === "mfi") {
    const period = parameterAt(0, 14);
    return {
      definition,
      series: [line("mfi", "MFI", LINE_COLORS.green, computeMfi(candles, period))],
      referenceLines: [
        { value: 80, color: "rgba(239, 83, 80, 0.5)" },
        { value: 20, color: "rgba(22, 168, 115, 0.5)" },
      ],
    };
  }
  const period = parameterAt(0, 14);
  return {
    definition,
    series: [line("willr", "W%R", LINE_COLORS.cyan, computeWilliamsR(candles, period))],
    referenceLines: [
      { value: -20, color: "rgba(239, 83, 80, 0.5)" },
      { value: -80, color: "rgba(22, 168, 115, 0.5)" },
    ],
  };
}
