import type { DrawingCandle } from './trading-drawing-extra-tools.ts';
import type { ScreenPoint, TradingDrawingModel, TradingDrawingPoint, TradingDrawingLineStyle } from './trading-expert-drawing.ts';

export const REGRESSION_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] as const;
export interface RegressionTrendOptions {
  source: typeof REGRESSION_SOURCES[number];
  upperDeviation: number;
  lowerDeviation: number;
  useUpperDeviation: boolean;
  useLowerDeviation: boolean;
  showBase: boolean;
  showUpper: boolean;
  showLower: boolean;
  extendRight: boolean;
  showPearson: boolean;
  fillOpacity: number;
  baseColor: string;
  upperColor: string;
  lowerColor: string;
  baseWidth: number;
  upperWidth: number;
  lowerWidth: number;
  baseStyle: TradingDrawingLineStyle;
  upperStyle: TradingDrawingLineStyle;
  lowerStyle: TradingDrawingLineStyle;
}
export const REGRESSION_DEFAULTS: Readonly<RegressionTrendOptions> = Object.freeze({
  source: 'close', upperDeviation: 2, lowerDeviation: -2,
  useUpperDeviation: true, useLowerDeviation: true,
  showBase: true, showUpper: true, showLower: true, extendRight: false, showPearson: true,
  fillOpacity: .3, baseColor: '#f23645', upperColor: '#2962ff', lowerColor: '#2962ff',
  baseWidth: 1, upperWidth: 2, lowerWidth: 2, baseStyle: 'dashed', upperStyle: 'solid', lowerStyle: 'solid',
});

export function normalizeRegressionTrendOptions(value: unknown): RegressionTrendOptions {
  const result = { ...REGRESSION_DEFAULTS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(result) as (keyof RegressionTrendOptions)[]) {
    const v = candidate[key];
    if (typeof result[key] === 'boolean' && typeof v === 'boolean') Object.assign(result, { [key]: v });
    else if (key === 'source' && REGRESSION_SOURCES.includes(v as any)) result.source = v as RegressionTrendOptions['source'];
    else if (key.endsWith('Color') && typeof v === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v)) Object.assign(result, { [key]: v });
    else if (key.endsWith('Style') && ['solid', 'dashed', 'dotted'].includes(v as string)) Object.assign(result, { [key]: v });
    else if (typeof v === 'number' && Number.isFinite(v)) {
      if (key.endsWith('Deviation') && Math.abs(v) <= 100) Object.assign(result, { [key]: v });
      else if (key.endsWith('Width') && v >= .5 && v <= 40) Object.assign(result, { [key]: v });
      else if (key === 'fillOpacity' && v >= 0 && v <= 1) result.fillOpacity = v;
    }
  }
  return result;
}

export function regressionBarIndex(candles: readonly DrawingCandle[], time: number): number {
  if (!candles.length || !Number.isFinite(time)) return -1;
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo > 0 && time - candles[lo - 1].time < candles[lo].time - time ? lo - 1 : lo;
}

function sourcePrice(candle: DrawingCandle, source: RegressionTrendOptions['source']) {
  if (source === 'hl2') return (candle.high + candle.low) / 2;
  if (source === 'hlc3') return (candle.high + candle.low + candle.close) / 3;
  if (source === 'ohlc4') return (candle.open + candle.high + candle.low + candle.close) / 4;
  return candle[source];
}

// Match TradingView's published Linear Regression calculation: bar ordinal
// (not elapsed seconds), OLS, residual deviation with n - 1, and correlation
// of source prices with the fitted values (nonnegative, including downtrends).
// https://www.tradingview.com/pine-script-docs/v4/essential/drawings/#linear-regression
export function calculateRegressionTrend(candles: readonly DrawingCandle[], points: readonly TradingDrawingPoint[], value?: unknown) {
  if (points.length < 2) return null;
  const options = normalizeRegressionTrendOptions(value);
  const indices = points.slice(0, 2).map(p => regressionBarIndex(candles, p.time));
  const start = Math.min(...indices), end = Math.max(...indices), count = end - start + 1;
  if (start < 0 || count < 2) return null;
  const prices = candles.slice(start, end + 1).map(c => sourcePrice(c, options.source));
  if (!prices.every(Number.isFinite)) return null;
  // Center before summing to avoid cancellation for high-priced instruments.
  const origin = prices[0], mean = prices.reduce((sum, p) => sum + (p - origin), 0) / count;
  const center = (count - 1) / 2;
  let xx = 0, xy = 0, yy = 0;
  prices.forEach((p, i) => { const x = i - center, y = p - origin - mean; xx += x * x; xy += x * y; yy += y * y; });
  const slope = xy / xx, intercept = origin + mean - slope * center;
  let residual = 0, upperExtreme = 0, lowerExtreme = 0;
  prices.forEach((p, i) => {
    const fitted = intercept + slope * i, candle = candles[start + i];
    residual += (p - fitted) ** 2;
    upperExtreme = Math.max(upperExtreme, candle.high - fitted);
    lowerExtreme = Math.max(lowerExtreme, fitted - candle.low);
  });
  const deviation = Math.sqrt(residual / (count - 1));
  const pearson = yy === 0 ? 0 : Math.min(1, Math.abs(xy / Math.sqrt(xx * yy)));
  const upperOffset = options.useUpperDeviation ? options.upperDeviation * deviation : upperExtreme;
  const lowerOffset = options.useLowerDeviation ? options.lowerDeviation * deviation : -lowerExtreme;
  if (![intercept, slope, deviation, upperOffset, lowerOffset].every(Number.isFinite)) return null;
  const base = [start, end].map((index, i) => ({ time: candles[index].time, price: intercept + slope * (i ? count - 1 : 0) }));
  const upper = base.map(p => ({ ...p, price: p.price + upperOffset }));
  const lower = base.map(p => ({ ...p, price: p.price + lowerOffset }));
  const anchors = indices[0] <= indices[1] ? base : [...base].reverse();
  return { base, upper, lower, anchors, slope, deviation, pearson, count, start, end, options };
}

export function renderRegressionTrend(result: NonNullable<ReturnType<typeof calculateRegressionTrend>>, drawing: TradingDrawingModel,
  project: (p: TradingDrawingPoint) => ScreenPoint | null, width: number) {
  const pairs = [result.base, result.upper, result.lower].map(pair => pair.map(project));
  if (pairs.some(pair => pair.some(p => !p))) return null;
  const [base, upper, lower] = pairs as ScreenPoint[][];
  const o = result.options;
  const extend = (pair: ScreenPoint[]) => {
    const [a, b] = pair;
    if (!o.extendRight || b.x >= width || b.x === a.x) return pair;
    return [a, { x: width, y: b.y + (b.y - a.y) * (width - b.x) / (b.x - a.x) }];
  };
  const [b, u, l] = [base, upper, lower].map(extend);
  const coords = (ps: ScreenPoint[]) => ps.map(p => `${p.x},${p.y}`).join(' ');
  const polygon = (edge: ScreenPoint[], color: string, part: string) => `<polygon data-regression-fill="${part}" points="${coords([b[0], b[1], edge[1], edge[0]])}" fill="${color}" fill-opacity="${o.fillOpacity}"/>`;
  const line = (ps: ScreenPoint[], part: 'base' | 'upper' | 'lower') => {
    const color = drawing.color ?? o[`${part}Color`], size = drawing.lineWidth ?? o[`${part}Width`];
    const style = drawing.lineStyle ?? o[`${part}Style`], dash = style === 'dashed' ? '5 5' : style === 'dotted' ? '1 3' : '';
    return `<line data-regression-line="${part}" x1="${ps[0].x}" y1="${ps[0].y}" x2="${ps[1].x}" y2="${ps[1].y}" stroke="${color}" stroke-width="${size}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"/>`;
  };
  const top = o.showUpper ? u : b, bottom = o.showLower ? l : b;
  const hit = `<polygon class="trading-drawing-hit-target area" points="${coords([top[0], top[1], bottom[1], bottom[0]])}"/>`
    + `<line class="trading-drawing-hit-target" x1="${b[0].x}" y1="${b[0].y}" x2="${b[1].x}" y2="${b[1].y}"/>`;
  const body = (o.showUpper ? polygon(u, drawing.color ?? o.upperColor, 'upper') : '')
    + (o.showLower ? polygon(l, drawing.color ?? o.baseColor, 'lower') : '')
    + (o.showBase ? line(b, 'base') : '') + (o.showUpper ? line(u, 'upper') : '') + (o.showLower ? line(l, 'lower') : '')
    + (o.showPearson ? `<text data-regression-pearson x="${lower[0].x}" y="${lower[0].y + 20}" text-anchor="middle" fill="${drawing.color ?? o.upperColor}" font-size="12">${Number(result.pearson.toPrecision(16))}</text>` : '');
  return { body, hit, base, upper, lower };
}
