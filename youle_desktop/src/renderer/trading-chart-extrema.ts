export interface TradingExtremaCandle {
  time: number;
  high: number;
  low: number;
}

export interface TradingLogicalRange {
  from: number;
  to: number;
}

export interface TradingVisibleExtrema {
  high: TradingExtremaCandle;
  low: TradingExtremaCandle;
}

export type TradingExtremaLabelSide = "left" | "right";

type TradingChartLike = {
  timeScale(): {
    getVisibleLogicalRange(): TradingLogicalRange | null;
    timeToCoordinate(time: any): number | null;
  };
  priceScale(id: string, paneIndex?: number): { width(): number };
};

type TradingSeriesLike = {
  priceToCoordinate(price: number): number | null;
};

interface TradingChartExtremaOverlayOptions {
  root: HTMLElement;
  chartElement: HTMLElement;
  getChart: () => TradingChartLike | null;
  getSeries: () => TradingSeriesLike | null;
  getCandles: () => readonly TradingExtremaCandle[];
  formatPrice: (price: number) => string;
  timeOffsetSeconds?: number;
}

function finiteCandle(candle: TradingExtremaCandle | undefined): candle is TradingExtremaCandle {
  return Boolean(
    candle
    && Number.isFinite(candle.time)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low),
  );
}

export function tradingVisibleExtrema(
  candles: readonly TradingExtremaCandle[],
  range: TradingLogicalRange | null,
): TradingVisibleExtrema | null {
  if (
    !candles.length
    || !range
    || !Number.isFinite(range.from)
    || !Number.isFinite(range.to)
  ) return null;
  const rangeStart = Math.min(range.from, range.to);
  const rangeEnd = Math.max(range.from, range.to);
  // Logical coordinates address bar centres. A candle remains partially
  // visible until its half-bar footprint leaves either viewport edge.
  const from = Math.max(0, Math.ceil(rangeStart - 0.5));
  const to = Math.min(candles.length - 1, Math.floor(rangeEnd + 0.5));
  if (from > to) return null;
  let high: TradingExtremaCandle | null = null;
  let low: TradingExtremaCandle | null = null;
  for (let index = from; index <= to; index += 1) {
    const candle = candles[index];
    if (!finiteCandle(candle)) continue;
    if (!high || candle.high > high.high) high = candle;
    if (!low || candle.low < low.low) low = candle;
  }
  return high && low ? { high, low } : null;
}

export function tradingExtremaLabelSide(
  anchorX: number,
  plotWidth: number,
  labelWidth: number,
): TradingExtremaLabelSide {
  const gap = 4;
  const fitsRight = anchorX + gap + labelWidth <= plotWidth;
  const fitsLeft = anchorX - gap - labelWidth >= 0;
  if (anchorX <= plotWidth / 2) {
    if (fitsRight) return "right";
    if (fitsLeft) return "left";
  } else {
    if (fitsLeft) return "left";
    if (fitsRight) return "right";
  }
  return anchorX <= plotWidth / 2 ? "right" : "left";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export class TradingChartExtremaOverlay {
  private readonly options: TradingChartExtremaOverlayOptions;
  private readonly layer: HTMLDivElement;
  private readonly highLabel: HTMLSpanElement;
  private readonly lowLabel: HTMLSpanElement;
  private animationFrame: number | null = null;
  private destroyed = false;

  constructor(options: TradingChartExtremaOverlayOptions) {
    this.options = options;
    const document = options.root.ownerDocument;
    this.layer = document.createElement("div");
    this.layer.className = "trading-market-extrema-layer";
    this.layer.dataset.marketExtremaLayer = "";
    this.layer.setAttribute("aria-hidden", "true");
    this.highLabel = document.createElement("span");
    this.highLabel.className = "trading-market-extrema-label high";
    this.highLabel.dataset.marketExtrema = "high";
    this.highLabel.hidden = true;
    this.lowLabel = document.createElement("span");
    this.lowLabel.className = "trading-market-extrema-label low";
    this.lowLabel.dataset.marketExtrema = "low";
    this.lowLabel.hidden = true;
    this.layer.append(this.highLabel, this.lowLabel);
    options.root.append(this.layer);
  }

  schedule() {
    if (this.destroyed || this.animationFrame !== null) return;
    const view = this.options.root.ownerDocument.defaultView;
    if (!view) return;
    this.animationFrame = view.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.update();
    });
  }

  update() {
    if (this.destroyed) return;
    const chart = this.options.getChart();
    const series = this.options.getSeries();
    if (!chart || !series) {
      this.clear();
      return;
    }
    const extrema = tradingVisibleExtrema(
      this.options.getCandles(),
      chart.timeScale().getVisibleLogicalRange(),
    );
    if (!extrema) {
      this.clear();
      return;
    }
    const priceScaleWidth = Math.max(Number(chart.priceScale("right", 0).width() || 0), 0);
    const plotWidth = Math.max(this.options.chartElement.clientWidth - priceScaleWidth, 1);
    const plotHeight = Math.max(this.options.chartElement.clientHeight, 1);
    this.paintLabel(this.highLabel, extrema.high, "high", plotWidth, plotHeight, chart, series);
    this.paintLabel(this.lowLabel, extrema.low, "low", plotWidth, plotHeight, chart, series);
  }

  clear() {
    this.highLabel.hidden = true;
    this.lowLabel.hidden = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const view = this.options.root.ownerDocument.defaultView;
    if (this.animationFrame !== null && view) view.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.layer.remove();
  }

  private paintLabel(
    element: HTMLSpanElement,
    candle: TradingExtremaCandle,
    kind: "high" | "low",
    plotWidth: number,
    plotHeight: number,
    chart: TradingChartLike,
    series: TradingSeriesLike,
  ) {
    const price = kind === "high" ? candle.high : candle.low;
    const x = Number(chart.timeScale().timeToCoordinate(
      candle.time + (this.options.timeOffsetSeconds ?? 0),
    ));
    const y = Number(series.priceToCoordinate(price));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > plotWidth) {
      element.hidden = true;
      return;
    }
    const priceText = this.options.formatPrice(price);
    element.textContent = priceText;
    element.hidden = false;
    const estimatedWidth = Math.max(46, priceText.length * 7 + 22);
    const labelWidth = Math.max(element.offsetWidth, estimatedWidth);
    const side = tradingExtremaLabelSide(x, plotWidth, labelWidth);
    element.dataset.side = side;
    element.textContent = side === "right" ? `← ${priceText}` : `${priceText} →`;
    const left = side === "right" ? x + 4 : x - labelWidth - 4;
    const labelHeight = Math.max(element.offsetHeight, 16);
    // The reference annotation is a horizontal pointer whose text baseline is
    // centred on the wick tip. Keep the first legend row clear when an extreme
    // sits very close to the pane's upper edge.
    const top = y - labelHeight / 2;
    element.style.left = `${clamp(left, 2, plotWidth - labelWidth - 2)}px`;
    element.style.top = `${clamp(top, 30, plotHeight - labelHeight - 2)}px`;
  }
}
