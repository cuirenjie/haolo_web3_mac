export interface TradingVolumeProfileCandle {
  high: number;
  low: number;
  volume?: number;
}

export interface TradingVolumeProfileRow {
  priceLow: number;
  priceHigh: number;
  volume: number;
  valueArea: boolean;
  poc: boolean;
}

export interface TradingVolumeProfile {
  rows: TradingVolumeProfileRow[];
  totalVolume: number;
  maxVolume: number;
  pocIndex: number;
  valueAreaFrom: number;
  valueAreaTo: number;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// Lightweight Charts applies wheel-driven price-scale geometry over multiple paint frames.
export const TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES = 12;

function normalizedRowCount(value: number) {
  const numeric = Number(value);
  return Math.min(96, Math.max(8, Number.isFinite(numeric) ? Math.round(numeric) : 96));
}

export function calculateTradingVolumeProfile(
  candles: readonly TradingVolumeProfileCandle[],
  requestedRowCount = 96,
  requestedValueAreaRatio = 0.7,
): TradingVolumeProfile | null {
  const usableCandles = candles.flatMap((candle) => {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const volume = Number(candle.volume || 0);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(volume) || volume <= 0) return [];
    return [{ high: Math.max(high, low), low: Math.min(high, low), volume }];
  });
  if (!usableCandles.length) return null;

  const lowest = Math.min(...usableCandles.map((candle) => candle.low));
  const highest = Math.max(...usableCandles.map((candle) => candle.high));
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) return null;
  const fallbackSpan = Math.max(Math.abs(highest) * 1e-6, 1e-8);
  const priceSpan = highest > lowest ? highest - lowest : fallbackSpan;
  const rowCount = normalizedRowCount(requestedRowCount);
  const rowSize = priceSpan / rowCount;
  const volumes = new Array<number>(rowCount).fill(0);

  usableCandles.forEach((candle) => {
    const candleSpan = candle.high - candle.low;
    if (candleSpan <= 0) {
      const rowIndex = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.low - lowest) / rowSize)));
      volumes[rowIndex] += candle.volume;
      return;
    }
    const firstRow = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.low - lowest) / rowSize)));
    const lastRow = Math.min(rowCount - 1, Math.max(0, Math.floor((candle.high - lowest) / rowSize)));
    const overlaps: Array<{ index: number; amount: number }> = [];
    for (let index = firstRow; index <= lastRow; index += 1) {
      const rowLow = lowest + index * rowSize;
      const rowHigh = index === rowCount - 1 ? lowest + priceSpan : rowLow + rowSize;
      const overlap = Math.max(0, Math.min(candle.high, rowHigh) - Math.max(candle.low, rowLow));
      if (overlap > 0) overlaps.push({ index, amount: overlap });
    }
    const overlapTotal = overlaps.reduce((sum, overlap) => sum + overlap.amount, 0);
    if (overlapTotal <= 0) return;
    overlaps.forEach((overlap) => {
      volumes[overlap.index] += candle.volume * (overlap.amount / overlapTotal);
    });
  });

  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
  const maxVolume = Math.max(...volumes);
  if (!Number.isFinite(totalVolume) || totalVolume <= 0 || !Number.isFinite(maxVolume) || maxVolume <= 0) return null;
  const pocIndex = volumes.indexOf(maxVolume);
  const valueAreaRatio = Math.min(1, Math.max(0, Number(requestedValueAreaRatio) || 0.7));
  const valueAreaTarget = totalVolume * valueAreaRatio;
  let valueAreaFrom = pocIndex;
  let valueAreaTo = pocIndex;
  let valueAreaVolume = volumes[pocIndex];
  while (valueAreaVolume < valueAreaTarget && (valueAreaFrom > 0 || valueAreaTo < rowCount - 1)) {
    const lowerVolume = valueAreaFrom > 0 ? volumes[valueAreaFrom - 1] : -1;
    const upperVolume = valueAreaTo < rowCount - 1 ? volumes[valueAreaTo + 1] : -1;
    if (upperVolume >= lowerVolume && valueAreaTo < rowCount - 1) {
      valueAreaTo += 1;
      valueAreaVolume += volumes[valueAreaTo];
    } else if (valueAreaFrom > 0) {
      valueAreaFrom -= 1;
      valueAreaVolume += volumes[valueAreaFrom];
    }
  }

  return {
    rows: volumes.map((volume, index) => ({
      priceLow: lowest + index * rowSize,
      priceHigh: index === rowCount - 1 ? lowest + priceSpan : lowest + (index + 1) * rowSize,
      volume,
      valueArea: index >= valueAreaFrom && index <= valueAreaTo,
      poc: index === pocIndex,
    })),
    totalVolume,
    maxVolume,
    pocIndex,
    valueAreaFrom,
    valueAreaTo,
  };
}

export interface TradingVolumeProfileRenderOptions {
  candles: readonly TradingVolumeProfileCandle[];
  profile?: TradingVolumeProfile | null;
  sourceCandleCount?: number;
  rowCount: number;
  plotWidth: number;
  paneHeight: number;
  priceToCoordinate: (price: number) => number | null;
  barColor: string;
  pocColor: string;
  showBars: boolean;
  showPoc: boolean;
}

function compactVolume(value: number) {
  return Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function clearTradingVolumeProfileLayer(layer: SVGSVGElement) {
  layer.replaceChildren();
  layer.setAttribute("hidden", "");
  layer.removeAttribute("viewBox");
  layer.removeAttribute("width");
  layer.removeAttribute("height");
  layer.style.removeProperty("--trading-vpvr-color");
  layer.style.removeProperty("--trading-vpvr-poc-color");
}

export function renderTradingVolumeProfileLayer(
  layer: SVGSVGElement,
  options: TradingVolumeProfileRenderOptions,
) {
  const plotWidth = Math.max(0, Number(options.plotWidth));
  const paneHeight = Math.max(0, Number(options.paneHeight));
  const profile = options.profile === undefined
    ? calculateTradingVolumeProfile(options.candles, options.rowCount)
    : options.profile;
  if (
    !profile
    || plotWidth < 40
    || paneHeight < 40
    || (!options.showBars && !options.showPoc)
  ) {
    clearTradingVolumeProfileLayer(layer);
    return null;
  }

  const documentRef = layer.ownerDocument;
  const profileWidth = Math.min(220, Math.max(72, plotWidth * 0.18));
  const rightPadding = Math.min(7, Math.max(3, plotWidth * 0.006));
  const rightEdge = plotWidth - rightPadding;
  const leftEdge = Math.max(0, rightEdge - profileWidth);
  layer.replaceChildren();
  layer.removeAttribute("hidden");
  layer.setAttribute("viewBox", `0 0 ${plotWidth} ${paneHeight}`);
  layer.setAttribute("width", String(plotWidth));
  layer.setAttribute("height", String(paneHeight));
  layer.style.setProperty("--trading-vpvr-color", options.barColor);
  layer.style.setProperty("--trading-vpvr-poc-color", options.pocColor);

  profile.rows.forEach((row, index) => {
    if (row.volume <= 0 || (!options.showBars && !row.poc)) return;
    const highY = Number(options.priceToCoordinate(row.priceHigh));
    const lowY = Number(options.priceToCoordinate(row.priceLow));
    if (!Number.isFinite(highY) || !Number.isFinite(lowY)) return;
    const unclampedTop = Math.min(highY, lowY);
    const unclampedBottom = Math.max(highY, lowY);
    const top = Math.max(0, Math.min(paneHeight, unclampedTop));
    const bottom = Math.max(0, Math.min(paneHeight, unclampedBottom));
    if (bottom <= top) return;
    const width = Math.max(1, (row.volume / profile.maxVolume) * profileWidth);
    if (options.showBars) {
      const rect = documentRef.createElementNS(SVG_NAMESPACE, "rect");
      rect.classList.add("trading-market-vpvr-bar");
      if (row.valueArea) rect.classList.add("value-area");
      if (row.poc) rect.classList.add("poc");
      rect.dataset.vpvrRow = String(index);
      rect.dataset.vpvrVolume = String(row.volume);
      rect.setAttribute("x", String(rightEdge - width));
      rect.setAttribute("y", String(top));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(Math.max(0.8, bottom - top - Math.min(1, (bottom - top) * 0.14))));
      layer.append(rect);
    }
    if (row.poc && options.showPoc) {
      const line = documentRef.createElementNS(SVG_NAMESPACE, "line");
      line.classList.add("trading-market-vpvr-poc-line");
      line.dataset.vpvrPoc = "true";
      const y = (top + bottom) / 2;
      line.setAttribute("x1", String(leftEdge));
      line.setAttribute("x2", String(rightEdge));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      layer.append(line);
    }
  });

  const poc = profile.rows[profile.pocIndex];
  const pocPrice = (poc.priceLow + poc.priceHigh) / 2;
  layer.setAttribute(
    "aria-label",
    `可见范围成交量分布，共 ${options.sourceCandleCount ?? options.candles.length} 根K线，POC ${pocPrice.toFixed(2)}，成交量 ${compactVolume(profile.maxVolume)}`,
  );
  return profile;
}
