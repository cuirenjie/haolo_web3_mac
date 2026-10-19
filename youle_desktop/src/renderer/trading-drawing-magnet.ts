// TradingView's public behavior contracts:
// https://www.tradingview.com/support/solutions/43000472715-drawing-points-don-t-snap-to-ohlc-values-correctly/
// https://www.tradingview.com/support/solutions/43000722509-magnet-mode/
// https://www.tradingview.com/blog/en/magnet-snaps-to-indicators-instantly-50979/
export type TradingMagnetMode = 'weak' | 'strong';

export interface TradingMagnetPreferences {
  enabled: boolean;
  mode: TradingMagnetMode;
  snapToIndicators: boolean;
}

export const TRADING_MAGNET_STORAGE_KEY = 'haolo.drawing-magnet.v1';
// CSS pixels: zooming or changing the price scale must not change sensitivity.
export const TRADING_WEAK_MAGNET_DISTANCE = 18;

export function normalizeTradingMagnetPreferences(value: unknown): TradingMagnetPreferences {
  const saved = value && typeof value === 'object' ? value as Partial<TradingMagnetPreferences> : {};
  return { enabled: saved.enabled === true, mode: saved.mode === 'strong' ? 'strong' : 'weak', snapToIndicators: saved.snapToIndicators === true };
}

export function readTradingMagnetPreferences(): TradingMagnetPreferences {
  try { return normalizeTradingMagnetPreferences(JSON.parse(window.localStorage.getItem(TRADING_MAGNET_STORAGE_KEY) ?? 'null')); }
  catch { return normalizeTradingMagnetPreferences(null); }
}

export function writeTradingMagnetPreferences(preferences: TradingMagnetPreferences) {
  try { window.localStorage.setItem(TRADING_MAGNET_STORAGE_KEY, JSON.stringify(preferences)); }
  catch { /* Keep drawing usable when storage is unavailable. */ }
}

type Point = { time: number; price: number };
type ScreenPoint = { x: number; y: number };
type MagnetBar = { time: number; open: number; high: number; low: number; close: number };
type SeriesValue = { time: unknown; value?: number; open?: number; high?: number; low?: number; close?: number };
export interface TradingMagnetSeries {
  options?: () => { visible?: boolean };
  priceToCoordinate: (price: number) => number | null;
  coordinateToPrice: (coordinate: number) => number | null;
  dataByIndex?: (index: number) => SeriesValue | null;
}

export function snapTradingDrawingMagnet(options: {
  point: Point;
  screen: ScreenPoint;
  mode: TradingMagnetMode;
  candle: MagnetBar;
  candleX: number;
  chartTime: number;
  dataIndex: number | null;
  priceSeries: TradingMagnetSeries;
  includeCandle: boolean;
  indicatorSeries: readonly TradingMagnetSeries[];
}): Point {
  const { point, screen, candle, priceSeries, candleX } = options;
  if (!Number.isFinite(candleX)) return point;
  if (options.mode === 'weak' && Math.abs(candleX - screen.x) > TRADING_WEAK_MAGNET_DISTANCE) return point;
  let closest: { price: number; distance: number } | null = null;
  const consider = (value: unknown, series: TradingMagnetSeries, isPrice: boolean) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const y = series.priceToCoordinate(value);
    if (y === null || !Number.isFinite(y)) return;
    // Indicator plots may have their own scale. Persist in the drawing pane's
    // scale, so the anchor stays exactly on the visible indicator coordinate.
    const price = isPrice ? value : priceSeries.coordinateToPrice(y);
    if (price === null || !Number.isFinite(price)) return;
    const distance = Math.abs(y - screen.y);
    if (!closest || distance < closest.distance) closest = { price, distance };
  };
  if (options.includeCandle && priceSeries.options?.().visible !== false) {
    for (const value of [candle.open, candle.high, candle.low, candle.close]) consider(value, priceSeries, true);
  }
  if (options.dataIndex !== null) for (const series of options.indicatorSeries) {
    if (series.options?.().visible === false) continue;
    const row = series.dataByIndex?.(options.dataIndex);
    // No nearest-left lookup: whitespace/warm-up gaps are not data points.
    if (!row || row.time !== options.chartTime) continue;
    for (const value of [row.value, row.open, row.high, row.low, row.close]) consider(value, series, series === priceSeries);
  }
  const match = closest as { price: number; distance: number } | null;
  return match && (options.mode === 'strong' || match.distance <= TRADING_WEAK_MAGNET_DISTANCE)
    ? { time: candle.time, price: match.price } : point;
}
