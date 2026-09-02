import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import { TradingChartExtremaOverlay } from "./trading-chart-extrema.ts";
import {
  TRADING_INDICATORS,
  calculateTradingIndicator,
  indicatorEma,
  indicatorSma,
  type TradingIndicatorId,
  type TradingIndicatorResult,
} from "./trading-expert-indicators.ts";
import {
  cloneTradingChartSettings,
  heikinAshiCandles,
  hlcCandles,
  type TradingChartCandle,
  type TradingChartSettings,
  type TradingChartThemeName,
} from "./trading-expert-chart-settings.ts";
import {
  renderTradingMarketAssetLogo,
} from "./trading-expert-market-identity.ts";
import {
  TradingDrawingController,
  renderTradingDrawingLayer,
  type TradingDrawingSharedToolState,
} from "./trading-expert-drawing.ts";
import type { TradingAiDrawingPatch, TradingAiPlaybackPhase } from "./trading-expert-ai-playback.ts";
import {
  TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES,
  calculateTradingVolumeProfile,
  clearTradingVolumeProfileLayer,
  renderTradingVolumeProfileLayer,
  type TradingVolumeProfile,
} from "./trading-volume-profile.ts";
import {
  tradingAnalysisDrawingFocusRange,
  waitForTradingAnalysisViewportPaint,
} from "./trading-analysis-viewport.mjs";

const CHINA_TIME_OFFSET_SECONDS = 8 * 60 * 60;
const SPLIT_PANE_REFRESH_INTERVAL_MS = 30_000;
const SPLIT_PANE_MARKET_RESULT_LIMIT = 120;
const HIDDEN_SPLIT_PANE_INDICATORS: ReadonlySet<TradingIndicatorId> = new Set([
  "momentum",
  "roc",
  "obv",
  "mfi",
  "willr",
]);

export interface TradingSplitPaneMarket {
  id: string;
  provider: "binance" | "finnhub" | "ifind";
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  displaySymbol: string;
  venue: string;
  assetClass: "crypto" | "commodity" | "etf" | "stock" | "preipo" | "index" | "forex" | "a-share";
  marketType: "perpetual" | "spot" | "global";
  tag: string;
  description: string;
  markPrice: number;
  changePercent: number;
  quoteAvailable: boolean;
}

export interface TradingSplitPanePeriod {
  resolution: string;
  label: string;
}

export interface TradingSplitPaneOptions {
  host: HTMLElement;
  paneIndex: number;
  market: TradingSplitPaneMarket;
  interval: string;
  mainIndicators: readonly TradingSplitPaneMainIndicatorDefinition[];
  indicatorSettings: TradingSplitPaneIndicatorSettings;
  indicatorSelection: TradingSplitPaneIndicatorSelection;
  markets: readonly TradingSplitPaneMarket[];
  periods: readonly TradingSplitPanePeriod[];
  settings: TradingChartSettings;
  themeName: TradingChartThemeName;
  loadCandles: (market: TradingSplitPaneMarket, interval: string) => Promise<TradingChartCandle[]>;
  drawing: {
    controlsHost: HTMLElement;
    storageSessionId: string;
    resolveControlTarget: () => TradingDrawingController | null;
    onSharedToolStateChanged: (
      state: TradingDrawingSharedToolState,
      source: TradingDrawingController,
    ) => void;
    onSurfaceFocus: (source: TradingDrawingController) => void;
    onDrawingStateChanged: (source: TradingDrawingController) => void;
  };
  onSelectionChange?: (selection: TradingSplitPaneSelection) => void;
  onIndicatorSelectionChange?: (selection: TradingSplitPaneIndicatorSelection) => void;
  onOpenIndicatorEditor?: () => void;
  onOpenGlobalSettings?: (anchor: HTMLElement) => void;
  onOpenSplitLayouts?: (anchor: HTMLElement) => void;
}

export type TradingSplitPaneMainIndicatorId = "ma" | "ema" | "boll" | "td" | "bbi" | "vpvr";

export interface TradingSplitPaneMainIndicatorDefinition {
  id: TradingSplitPaneMainIndicatorId;
  label: string;
  name: string;
  parameters: string;
}

export interface TradingSplitPaneIndicatorSeriesSetting {
  visible: boolean;
  color: string;
  lineWidth: 1 | 2 | 3;
}

export interface TradingSplitPaneIndicatorSetting {
  enabled: boolean;
  parameters: number[];
  series: Record<string, TradingSplitPaneIndicatorSeriesSetting>;
}

export type TradingSplitPaneIndicatorSettings = Record<string, TradingSplitPaneIndicatorSetting>;

export interface TradingSplitPaneIndicatorSelection {
  main: TradingSplitPaneMainIndicatorId[];
  sub: TradingIndicatorId[];
}

export interface TradingSplitPaneSelection {
  marketId: string;
  interval: string;
  market: TradingSplitPaneMarket;
}

export interface TradingSplitPaneAnalysisSnapshot {
  paneIndex: number;
  market: TradingSplitPaneMarket;
  interval: string;
  candles: TradingChartCandle[];
}

interface SplitPaneIndicatorSeriesRuntime {
  key: string;
  api: any;
  label: string;
  latestValue: number;
}

interface SplitPaneIndicatorRuntime {
  id: TradingIndicatorId;
  pane: any;
  legend: HTMLElement | null;
  series: SplitPaneIndicatorSeriesRuntime[];
}

interface SplitPaneTdSignal {
  index: number;
  direction: "buy" | "sell";
  count: number;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function priceScaleMode(settings: TradingChartSettings) {
  if (settings.priceScaleMode === "logarithmic") return PriceScaleMode.Logarithmic;
  if (settings.priceScaleMode === "percentage") return PriceScaleMode.Percentage;
  return PriceScaleMode.Normal;
}

function formatPrice(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function formatTickerPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const absolute = Math.abs(value);
  const integerDigits = absolute >= 1
    ? Math.floor(Math.log10(Math.floor(absolute))) + 1
    : 1;
  const precision = absolute < 1 ? Math.max(2, 6 - integerDigits) : 2;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function normalizedMarketSearchText(value: string) {
  return value.trim().toLocaleUpperCase();
}

function compactMarketSearchText(value: string) {
  return normalizedMarketSearchText(value).replace(/[\s/._:-]+/g, "");
}

export function tradingSplitPaneMarketMatchesQuery(market: TradingSplitPaneMarket, query: string) {
  const normalizedQuery = normalizedMarketSearchText(query);
  if (!normalizedQuery) return true;
  const searchable = [
    market.displaySymbol,
    market.symbol,
    market.baseAsset,
    market.quoteAsset,
    market.description,
    market.venue,
    market.tag,
  ].join(" ");
  return normalizedMarketSearchText(searchable).includes(normalizedQuery)
    || compactMarketSearchText(searchable).includes(compactMarketSearchText(normalizedQuery));
}

export function tradingSplitPaneMarketSearchResults(
  markets: readonly TradingSplitPaneMarket[],
  query: string,
  selectedMarketId: string,
  limit = SPLIT_PANE_MARKET_RESULT_LIMIT,
) {
  const selected = markets.find((market) => market.id === selectedMarketId);
  const matches = markets.filter((market) => tradingSplitPaneMarketMatchesQuery(market, query));
  const ordered = selected && tradingSplitPaneMarketMatchesQuery(selected, query)
    ? [selected, ...matches.filter((market) => market.id !== selected.id)]
    : matches;
  return ordered.slice(0, Math.max(0, Math.trunc(limit)));
}

function formatDateTime(time: number) {
  const date = new Date(time * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function primarySeriesKind(settings: TradingChartSettings) {
  if (settings.chartStyle === "bars") return "bars";
  if (settings.chartStyle === "close-line") return "line";
  return "candles";
}

function transformedCandles(candles: readonly TradingChartCandle[], settings: TradingChartSettings) {
  if (settings.chartStyle === "heikin-ashi") return heikinAshiCandles(candles);
  if (settings.chartStyle === "hlc") return hlcCandles(candles);
  return candles;
}

function seriesData(candles: readonly TradingChartCandle[], settings: TradingChartSettings) {
  const transformed = transformedCandles(candles, settings);
  if (settings.chartStyle === "close-line") {
    return transformed.map((candle) => ({
      time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any,
      value: candle.close,
    }));
  }
  return transformed.map((candle) => ({
    time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function sameSeriesDatum(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key]);
}

function cloneIndicatorSettings(settings: TradingSplitPaneIndicatorSettings) {
  return Object.fromEntries(Object.entries(settings).map(([key, setting]) => [key, {
    enabled: setting.enabled,
    parameters: [...setting.parameters],
    series: Object.fromEntries(Object.entries(setting.series).map(([seriesKey, series]) => [
      seriesKey,
      { ...series },
    ])),
  }]));
}

function indicatorSettingKey(scope: "main" | "sub", id: string) {
  return `${scope}:${id}`;
}

function computeBollingerBands(values: number[], period: number, multiplier: number) {
  const middle = indicatorSma(values, period);
  const upper = new Array<number>(values.length).fill(Number.NaN);
  const lower = new Array<number>(values.length).fill(Number.NaN);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const mean = middle[index];
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    upper[index] = mean + deviation;
    lower[index] = mean - deviation;
  }
  return { upper, middle, lower };
}

function computeBbi(values: number[], periods: number[]) {
  const averages = periods.map((period) => indicatorSma(values, period));
  return values.map((_, index) => {
    const items = averages.map((average) => average[index]);
    return items.every(Number.isFinite)
      ? items.reduce((sum, value) => sum + value, 0) / items.length
      : Number.NaN;
  });
}

function computeTdSequential(
  candles: readonly TradingChartCandle[],
  targetCount: number,
): SplitPaneTdSignal[] {
  const signals: SplitPaneTdSignal[] = [];
  const normalizedTargetCount = Math.max(2, Math.round(targetCount));
  let buyCount = 0;
  let sellCount = 0;
  for (let index = 4; index < candles.length; index += 1) {
    const close = candles[index].close;
    const comparisonClose = candles[index - 4].close;
    if (close < comparisonClose) {
      buyCount = buyCount >= normalizedTargetCount ? 1 : buyCount + 1;
      sellCount = 0;
      signals.push({ index, direction: "buy", count: buyCount });
    } else if (close > comparisonClose) {
      sellCount = sellCount >= normalizedTargetCount ? 1 : sellCount + 1;
      buyCount = 0;
      signals.push({ index, direction: "sell", count: sellCount });
    } else {
      buyCount = 0;
      sellCount = 0;
    }
  }
  return signals;
}

function formatIndicatorValue(value: number, id: TradingIndicatorId) {
  if (!Number.isFinite(value)) return "--";
  if (id === "volume" || id === "obv" || Math.abs(value) >= 1_000) {
    return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

export class TradingExpertSplitPane {
  private readonly host: HTMLElement;
  private readonly paneIndex: number;
  private readonly loadCandles: TradingSplitPaneOptions["loadCandles"];
  private readonly mainIndicators: readonly TradingSplitPaneMainIndicatorDefinition[];
  private chartElement: HTMLElement;
  private viewportElement: HTMLElement;
  private ohlcElement: HTMLElement;
  private indicatorLegendLayer: HTMLElement;
  private mainIndicatorLegendElement: HTMLElement;
  private volumeProfileLayer: SVGSVGElement;
  private loadingElement: HTMLElement;
  private errorElement: HTMLButtonElement;
  private symbolTrigger: HTMLButtonElement;
  private symbolMenu: HTMLElement;
  private symbolSearch: HTMLInputElement;
  private symbolList: HTMLElement;
  private periodTrigger: HTMLButtonElement;
  private periodMenu: HTMLElement;
  private chart: ReturnType<typeof createChart> | null = null;
  private series: any = null;
  private extremaOverlay: TradingChartExtremaOverlay | null = null;
  private tdMarkers: any = null;
  private mainIndicatorSeries = new Map<TradingSplitPaneMainIndicatorId, any[]>();
  private mainIndicatorValues = new Map<TradingSplitPaneMainIndicatorId, number[][]>();
  private tdIndicatorDirections: Array<SplitPaneTdSignal["direction"] | null> = [];
  private indicatorPanes = new Map<TradingIndicatorId, SplitPaneIndicatorRuntime>();
  private rebuildingIndicatorPanes = false;
  private drawingController: TradingDrawingController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private refreshTimer: number | null = null;
  private volumeProfileWheelAnimationFrame: number | null = null;
  private volumeProfileWheelFramesRemaining = 0;
  private volumeProfileSnapshot: TradingVolumeProfile | null | undefined;
  private volumeProfileSnapshotCandleCount = 0;
  private loadGeneration = 0;
  private destroyed = false;
  private candles: TradingChartCandle[] = [];
  private market: TradingSplitPaneMarket;
  private interval: string;
  private markets: readonly TradingSplitPaneMarket[];
  private periods: readonly TradingSplitPanePeriod[];
  private settings: TradingChartSettings;
  private themeName: TradingChartThemeName;
  private indicatorSettings: TradingSplitPaneIndicatorSettings;
  private activeMainIndicators: TradingSplitPaneMainIndicatorId[];
  private activeIndicators: TradingIndicatorId[];
  private readonly onSelectionChange?: TradingSplitPaneOptions["onSelectionChange"];
  private readonly onIndicatorSelectionChange?: TradingSplitPaneOptions["onIndicatorSelectionChange"];
  private readonly onOpenIndicatorEditor?: TradingSplitPaneOptions["onOpenIndicatorEditor"];
  private readonly onOpenGlobalSettings?: TradingSplitPaneOptions["onOpenGlobalSettings"];
  private readonly onOpenSplitLayouts?: TradingSplitPaneOptions["onOpenSplitLayouts"];

  constructor(options: TradingSplitPaneOptions) {
    this.host = options.host;
    this.paneIndex = options.paneIndex;
    this.market = options.market;
    this.interval = options.interval;
    this.mainIndicators = options.mainIndicators;
    this.indicatorSettings = cloneIndicatorSettings(options.indicatorSettings);
    this.activeMainIndicators = [...options.indicatorSelection.main];
    this.activeIndicators = [...options.indicatorSelection.sub];
    this.markets = options.markets;
    this.periods = options.periods;
    this.settings = cloneTradingChartSettings(options.settings);
    this.themeName = options.themeName;
    this.loadCandles = options.loadCandles;
    this.onSelectionChange = options.onSelectionChange;
    this.onIndicatorSelectionChange = options.onIndicatorSelectionChange;
    this.onOpenIndicatorEditor = options.onOpenIndicatorEditor;
    this.onOpenGlobalSettings = options.onOpenGlobalSettings;
    this.onOpenSplitLayouts = options.onOpenSplitLayouts;
    this.host.innerHTML = this.render();
    this.chartElement = this.requireElement("[data-split-chart]");
    this.viewportElement = this.requireElement("[data-split-viewport]");
    this.ohlcElement = this.requireElement("[data-split-ohlc]");
    this.indicatorLegendLayer = this.requireElement("[data-split-indicator-legends]");
    this.mainIndicatorLegendElement = this.requireElement("[data-split-main-indicator-legends]");
    this.volumeProfileLayer = this.requireElement<SVGSVGElement>("[data-split-volume-profile-layer]");
    this.loadingElement = this.requireElement("[data-split-loading]");
    this.errorElement = this.requireElement<HTMLButtonElement>("[data-split-error]");
    this.symbolTrigger = this.requireElement<HTMLButtonElement>("[data-split-symbol-trigger]");
    this.symbolMenu = this.requireElement("[data-split-symbol-menu]");
    this.symbolSearch = this.requireElement<HTMLInputElement>("[data-split-symbol-search]");
    this.symbolList = this.requireElement("[data-split-symbol-list]");
    this.periodTrigger = this.requireElement<HTMLButtonElement>("[data-split-period-trigger]");
    this.periodMenu = this.requireElement("[data-split-period-menu]");
    this.bindEvents();
    this.createChart();
    const drawingLayer = this.requireElement<SVGSVGElement>("[data-drawing-layer]");
    this.drawingController = new TradingDrawingController({
      host: this.host,
      controlsHost: options.drawing.controlsHost,
      chartElement: this.chartElement,
      overlay: drawingLayer,
      getChart: () => this.chart,
      getCandleSeries: () => this.series,
      getSymbol: () => this.market.id,
      getInterval: () => this.interval,
      getCandles: () => this.candles,
      timeOffsetSeconds: CHINA_TIME_OFFSET_SECONDS,
      storageSessionId: options.drawing.storageSessionId,
      bindControlEvents: false,
      controlActive: false,
      clearScopeLabel: `分屏 ${this.paneIndex + 1}`,
      resolveControlTarget: options.drawing.resolveControlTarget,
      onSharedToolStateChanged: options.drawing.onSharedToolStateChanged,
      onSurfaceFocus: options.drawing.onSurfaceFocus,
      onDrawingStateChanged: options.drawing.onDrawingStateChanged,
    });
    this.drawingController.setUserDrawingEnabled(this.settings.drawingToolsEnabled);
    void this.reload(true);
  }

  private requireElement<T extends Element = HTMLElement>(selector: string) {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Trading split pane element missing: ${selector}`);
    return element;
  }

  private render() {
    const periodButtons = this.periods.map((period) => `
      <button
        type="button"
        data-split-action="interval"
        data-split-interval="${escapeHtml(period.resolution)}"
        data-i18n-trading-period-label
        class="${period.resolution === this.interval ? "active" : ""}"
        aria-pressed="${period.resolution === this.interval}"
      >${escapeHtml(period.label)}</button>
    `).join("");
    const mainIndicatorButtons = this.mainIndicators.map((indicator) => {
      const active = this.activeMainIndicators.includes(indicator.id);
      return `
        <button
          type="button"
          data-split-action="main-indicator"
          data-split-main-indicator="${indicator.id}"
          class="${active ? "active" : ""}"
          aria-pressed="${active}"
          title="${escapeHtml(indicator.name)} (${escapeHtml(indicator.parameters)})"
        >${escapeHtml(indicator.label)}</button>
      `;
    }).join("");
    const indicatorButtons = TRADING_INDICATORS
      .filter((indicator) => !HIDDEN_SPLIT_PANE_INDICATORS.has(indicator.id))
      .map((indicator) => {
        const active = this.activeIndicators.includes(indicator.id);
        return `
          <button
            type="button"
            data-split-action="indicator"
            data-split-indicator="${indicator.id}"
            class="${active ? "active" : ""}"
            aria-pressed="${active}"
            title="${escapeHtml(indicator.name)}${indicator.parameters ? ` (${escapeHtml(indicator.parameters)})` : ""}"
          >${escapeHtml(indicator.label)}</button>
        `;
      }).join("");
    return `
      <section class="trading-market-split-pane-inner" aria-label="分屏图表 ${this.paneIndex + 1}">
        <header class="trading-market-overview trading-market-split-toolbar">
          <div class="trading-market-symbol-wrap trading-market-split-symbol-wrap">
            <button
              type="button"
              class="trading-market-symbol trading-market-split-symbol-trigger"
              data-split-action="toggle-symbols"
              data-split-symbol-trigger
              aria-label="图表 ${this.paneIndex + 1} 交易品种"
              aria-haspopup="dialog"
              aria-expanded="false"
            >
              <span data-split-symbol-logo>${renderTradingMarketAssetLogo(this.market.baseAsset, this.market.provider, true, this.market.assetClass, this.market.displaySymbol)}</span>
              <strong data-split-symbol-label><span data-split-symbol-base>${escapeHtml(this.market.baseAsset)}</span><span data-split-symbol-quote>${this.market.quoteAsset ? `/${escapeHtml(this.market.quoteAsset)}` : ""}</span></strong>
              <span class="trading-market-venue" data-split-symbol-venue>${escapeHtml(this.market.venue)}</span>
              <span class="trading-market-contract-tag" data-split-symbol-tag>${this.marketTag(this.market)}</span>
              <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
            </button>
            <div class="trading-market-picker trading-market-split-symbol-menu" data-split-symbol-menu role="dialog" aria-label="选择交易品种" hidden>
              <label class="trading-market-picker-search">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.7 12.7 4.1 4.1"/></svg>
                <input
                  type="search"
                  data-split-symbol-search
                  aria-label="搜索交易对"
                  aria-controls="trading-market-split-list-${this.paneIndex}"
                  placeholder="搜索交易对"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
              <div class="trading-market-picker-head" aria-hidden="true">
                <span>名称</span><span>平台</span><span>最新价</span><span>24H涨幅</span>
              </div>
              <div
                class="trading-market-list"
                id="trading-market-split-list-${this.paneIndex}"
                data-split-symbol-list
                role="listbox"
                aria-label="交易品种搜索结果"
              ></div>
            </div>
          </div>
          <div class="trading-market-chart-actions trading-market-split-chart-actions" role="group" aria-label="图表 ${this.paneIndex + 1} 操作">
            <button
              type="button"
              class="trading-market-chart-action"
              data-split-action="open-chart-settings"
              aria-label="图表 ${this.paneIndex + 1} 设置"
              aria-haspopup="dialog"
              aria-expanded="false"
              title="设置"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4"/></svg>
            </button>
            <button
              type="button"
              class="trading-market-chart-action"
              data-split-action="open-split-layouts"
              aria-label="图表 ${this.paneIndex + 1} 选择分屏布局"
              aria-haspopup="dialog"
              aria-expanded="false"
              title="分屏"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="1.5"/><path d="M10 3v14"/></svg>
            </button>
          </div>
          <div class="trading-market-period-controls trading-market-split-period-controls">
            <button
              type="button"
              class="trading-market-period-trigger trading-market-split-period-trigger"
              data-split-action="toggle-periods"
              data-split-period-trigger
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              自定义周期
              <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
            </button>
            <div class="trading-market-split-period-menu" data-split-period-menu role="listbox" aria-label="图表 ${this.paneIndex + 1} 自定义周期" hidden>${periodButtons}</div>
            <div class="trading-market-times trading-market-split-times" aria-label="图表 ${this.paneIndex + 1} K线周期">${periodButtons}</div>
          </div>
        </header>
        <div class="trading-market-split-viewport" data-split-viewport>
          <div class="trading-market-split-chart" data-split-chart></div>
          <svg
            class="trading-market-volume-profile-layer"
            data-split-volume-profile-layer
            role="img"
            aria-label="分屏 ${this.paneIndex + 1} 可见范围成交量分布"
            hidden
          ></svg>
          ${renderTradingDrawingLayer()}
          <div class="trading-market-indicator-legends-layer" data-split-indicator-legends aria-hidden="true"></div>
          <div
            class="trading-market-main-indicator-legends"
            data-split-main-indicator-legends
            aria-label="分屏 ${this.paneIndex + 1} 主图指标数据"
          ></div>
          <div class="trading-market-ohlc trading-market-split-ohlc" data-split-ohlc></div>
          <div class="trading-market-split-loading" data-split-loading><span></span><em>加载行情</em></div>
          <button type="button" class="trading-market-split-error" data-split-error hidden>重试</button>
        </div>
        <footer class="trading-market-indicator-bar" aria-label="分屏 ${this.paneIndex + 1} 技术指标">
          <button
            type="button"
            class="trading-market-indicator-heading"
            data-split-action="open-indicator-editor"
            data-split-indicator-editor-trigger
            aria-haspopup="dialog"
            aria-expanded="false"
          >
            自定义指标
            <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
          </button>
          <div class="trading-market-main-indicators" aria-label="分屏 ${this.paneIndex + 1} 主图指标">
            ${mainIndicatorButtons}
          </div>
          <div class="trading-market-indicators" aria-label="分屏 ${this.paneIndex + 1} 副图指标">
            ${indicatorButtons}
          </div>
        </footer>
      </section>
    `;
  }

  private marketTag(market: TradingSplitPaneMarket) {
    return escapeHtml(market.tag);
  }

  private bindEvents() {
    this.host.addEventListener("click", this.handleToolbarClick);
    this.symbolSearch.addEventListener("input", this.handleSymbolSearchInput);
    this.errorElement.addEventListener("click", this.handleRetry);
    this.chartElement.addEventListener("wheel", this.handleWheel, { passive: true, capture: true });
    document.addEventListener("pointerdown", this.handleOutsidePointerDown);
    document.addEventListener("keydown", this.handleKeyDown);
  }

  private readonly handleToolbarClick = (event: Event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-split-action]")
      : null;
    if (!target || !this.host.contains(target)) return;
    event.stopPropagation();
    const action = target.dataset.splitAction;
    if (action === "toggle-symbols") {
      this.setSymbolMenuOpen(this.symbolMenu.hidden);
      return;
    }
    if (action === "toggle-periods") {
      this.setPeriodMenuOpen(this.periodMenu.hidden);
      return;
    }
    if (action === "open-chart-settings") {
      this.closeMenus();
      this.onOpenGlobalSettings?.(target);
      return;
    }
    if (action === "open-split-layouts") {
      this.closeMenus();
      this.onOpenSplitLayouts?.(target);
      return;
    }
    if (action === "open-indicator-editor") {
      this.closeMenus();
      this.onOpenIndicatorEditor?.();
      return;
    }
    if (action === "main-indicator") {
      const indicator = target.dataset.splitMainIndicator as TradingSplitPaneMainIndicatorId | undefined;
      if (!indicator || !this.mainIndicators.some((item) => item.id === indicator)) return;
      this.activeMainIndicators = this.activeMainIndicators.includes(indicator)
        ? this.activeMainIndicators.filter((item) => item !== indicator)
        : [...this.activeMainIndicators, indicator];
      this.updateIndicatorButtons();
      this.updateMainIndicatorData();
      this.notifyIndicatorSelectionChange();
      return;
    }
    if (action === "indicator") {
      const indicator = target.dataset.splitIndicator as TradingIndicatorId | undefined;
      if (!indicator || !TRADING_INDICATORS.some((item) => item.id === indicator)) return;
      this.activeIndicators = this.activeIndicators.includes(indicator)
        ? this.activeIndicators.filter((item) => item !== indicator)
        : [...this.activeIndicators, indicator];
      this.updateIndicatorButtons();
      this.rebuildIndicatorPanes();
      this.updateIndicatorData();
      this.notifyIndicatorSelectionChange();
      return;
    }
    if (action === "symbol") {
      const marketId = String(target.dataset.splitMarketId || "");
      const market = this.markets.find((candidate) => candidate.id === marketId);
      this.setSymbolMenuOpen(false);
      if (!market || market.id === this.market.id) return;
      this.invalidateVolumeProfileSnapshot();
      this.market = market;
      this.updateToolbarState();
      this.drawingController?.redraw();
      this.notifySelectionChange();
      void this.reload(true);
      return;
    }
    if (action === "interval") {
      const interval = String(target.dataset.splitInterval || "");
      this.setPeriodMenuOpen(false);
      if (!this.periods.some((period) => period.resolution === interval) || interval === this.interval) return;
      this.invalidateVolumeProfileSnapshot();
      this.interval = interval;
      this.updateToolbarState();
      this.drawingController?.redraw();
      this.notifySelectionChange();
      void this.reload(true);
    }
  };

  private readonly handleOutsidePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && this.host.contains(event.target)) return;
    this.closeMenus();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    this.closeMenus();
  };

  private readonly handleSymbolSearchInput = () => {
    this.renderSymbolResults();
  };

  private setSymbolMenuOpen(open: boolean) {
    this.symbolMenu.hidden = !open;
    this.symbolTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      this.setPeriodMenuOpen(false);
      this.symbolSearch.value = "";
      this.renderSymbolResults();
      this.positionSymbolMenu();
      window.requestAnimationFrame(() => {
        if (!this.destroyed && !this.symbolMenu.hidden) this.symbolSearch.focus();
      });
    } else {
      this.symbolList.replaceChildren();
    }
  }

  private positionSymbolMenu() {
    if (this.symbolMenu.hidden) return;
    const paneRect = this.host.getBoundingClientRect();
    const triggerRect = this.symbolTrigger.getBoundingClientRect();
    const availableHeight = Math.max(96, Math.floor(paneRect.bottom - triggerRect.bottom - 3));
    this.symbolMenu.style.maxHeight = `${availableHeight}px`;
  }

  private renderSymbolResults() {
    const markets = tradingSplitPaneMarketSearchResults(
      this.markets,
      this.symbolSearch.value,
      this.market.id,
    );
    if (!markets.length) {
      this.symbolList.innerHTML = '<p class="trading-market-list-empty">未找到匹配品种</p>';
      return;
    }
    this.symbolList.innerHTML = markets.map((market) => {
      const selected = market.id === this.market.id;
      const quoteAvailable = market.quoteAvailable && market.markPrice > 0;
      const changeClass = quoteAvailable
        ? market.changePercent >= 0 ? "positive" : "negative"
        : "";
      const priceText = quoteAvailable ? formatTickerPrice(market.markPrice) : "--";
      const changeText = quoteAvailable
        ? `${market.changePercent >= 0 ? "+" : ""}${market.changePercent.toFixed(2)}%`
        : "--";
      return `
        <div class="trading-market-row${selected ? " selected" : ""}" role="option" aria-selected="${selected}">
          <button
            type="button"
            class="trading-market-row-select"
            data-split-action="symbol"
            data-split-market-id="${escapeHtml(market.id)}"
            aria-label="选择 ${escapeHtml(market.displaySymbol)} ${escapeHtml(market.tag)}"
          ></button>
          <span class="trading-market-row-pair">
            ${renderTradingMarketAssetLogo(market.baseAsset, market.provider, false, market.assetClass, market.displaySymbol)}
            <strong title="${escapeHtml(market.displaySymbol)}">${escapeHtml(market.displaySymbol)}</strong>
            ${market.assetClass === "a-share"
              ? `<small class="trading-market-row-code" title="股票代码">${escapeHtml(market.symbol.split(".", 1)[0])}</small>`
              : ""}
            <span class="trading-market-contract-tag">${this.marketTag(market)}</span>
          </span>
          <span class="trading-market-row-venue" title="${escapeHtml(market.venue)}">${escapeHtml(market.venue)}</span>
          <b>${priceText}</b>
          <em class="${changeClass}">${changeText}</em>
        </div>
      `;
    }).join("");
  }

  private setPeriodMenuOpen(open: boolean) {
    this.periodMenu.hidden = !open;
    this.periodTrigger.classList.toggle("active", open);
    this.periodTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      this.setSymbolMenuOpen(false);
    }
  }

  private closeMenus() {
    this.setSymbolMenuOpen(false);
    this.setPeriodMenuOpen(false);
  }

  private updateToolbarState() {
    const base = this.host.querySelector<HTMLElement>("[data-split-symbol-base]");
    const quote = this.host.querySelector<HTMLElement>("[data-split-symbol-quote]");
    const venue = this.host.querySelector<HTMLElement>("[data-split-symbol-venue]");
    const tag = this.host.querySelector<HTMLElement>("[data-split-symbol-tag]");
    const logo = this.host.querySelector<HTMLElement>("[data-split-symbol-logo]");
    if (base) base.textContent = this.market.baseAsset;
    if (quote) quote.textContent = this.market.quoteAsset ? `/${this.market.quoteAsset}` : "";
    if (venue) venue.textContent = this.market.venue;
    if (tag) tag.textContent = this.market.tag;
    if (logo) logo.innerHTML = renderTradingMarketAssetLogo(this.market.baseAsset, this.market.provider, true, this.market.assetClass, this.market.displaySymbol);
    if (!this.symbolMenu.hidden) this.renderSymbolResults();
    this.host.querySelectorAll<HTMLButtonElement>("[data-split-interval]").forEach((button) => {
      const selected = button.dataset.splitInterval === this.interval;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  private notifySelectionChange() {
    this.onSelectionChange?.({
      marketId: this.market.id,
      interval: this.interval,
      market: { ...this.market },
    });
  }

  private notifyIndicatorSelectionChange() {
    this.onIndicatorSelectionChange?.({
      main: [...this.activeMainIndicators],
      sub: [...this.activeIndicators],
    });
  }

  private updateIndicatorButtons() {
    this.host.querySelectorAll<HTMLButtonElement>("[data-split-main-indicator]").forEach((button) => {
      const active = this.activeMainIndicators.includes(
        button.dataset.splitMainIndicator as TradingSplitPaneMainIndicatorId,
      );
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.host.querySelectorAll<HTMLButtonElement>("[data-split-indicator]").forEach((button) => {
      const active = this.activeIndicators.includes(button.dataset.splitIndicator as TradingIndicatorId);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private readonly handleRetry = () => void this.reload(true);

  private readonly handleWheel = (event: WheelEvent) => {
    const cursorAnchoredByDefault = this.settings.scaleAnchor === "cursor";
    this.chart?.timeScale().applyOptions({
      rightBarStaysOnScroll: event.ctrlKey ? !cursorAnchoredByDefault : cursorAnchoredByDefault,
    });
    this.trackVolumeProfileThroughWheelScale();
  };

  private createChart() {
    const theme = this.settings.themes[this.themeName];
    this.chart = createChart(this.chartElement, {
      width: Math.max(this.chartElement.clientWidth, 1),
      height: Math.max(this.chartElement.clientHeight, 1),
      layout: {
        background: { type: ColorType.Solid, color: theme.backgroundColor },
        textColor: this.themeName === "dark" ? "#dfe1e3" : "#172033",
        fontSize: 11,
        fontFamily: '"Segoe UI", "Microsoft YaHei", Arial, sans-serif',
        panes: {
          enableResize: true,
          separatorColor: this.themeName === "dark" ? "#1a2437" : "#e3e8ef",
          separatorHoverColor: this.themeName === "dark" ? "#30486d" : "#b9cbea",
        },
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: theme.verticalGridVisible, color: theme.verticalGridColor },
        horzLines: { visible: theme.horizontalGridVisible, color: theme.horizontalGridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme.crosshairColor, style: LineStyle.Dashed, labelBackgroundColor: theme.crosshairColor },
        horzLine: { color: theme.crosshairColor, style: LineStyle.Dashed, labelBackgroundColor: theme.crosshairColor },
      },
      rightPriceScale: {
        mode: priceScaleMode(this.settings),
        autoScale: true,
        borderColor: this.themeName === "dark" ? "#1a2437" : "#e3e8ef",
        textColor: this.themeName === "dark" ? "#dfe1e3" : "#172033",
        scaleMargins: {
          top: this.settings.verticalPaddingPercent / 100,
          bottom: this.settings.verticalPaddingPercent / 100,
        },
      },
      timeScale: {
        visible: false,
        borderColor: this.themeName === "dark" ? "#1a2437" : "#e3e8ef",
        timeVisible: true,
        secondsVisible: false,
        rightBarStaysOnScroll: this.settings.scaleAnchor === "cursor",
      },
      handleScroll: true,
      handleScale: true,
    });
    this.addSeries();
    this.extremaOverlay?.destroy();
    this.extremaOverlay = new TradingChartExtremaOverlay({
      root: this.viewportElement,
      chartElement: this.chartElement,
      getChart: () => this.chart,
      getSeries: () => this.series,
      getCandles: () => this.candles,
      formatPrice,
      timeOffsetSeconds: CHINA_TIME_OFFSET_SECONDS,
    });
    this.createMainIndicatorSeries();
    this.rebuildIndicatorPanes();
    this.chart.subscribeCrosshairMove((parameter: any) => {
      if (typeof parameter?.time === "number") {
        const rawTime = parameter.time - CHINA_TIME_OFFSET_SECONDS;
        const candle = this.candles.find((candidate) => candidate.time === rawTime);
        if (candle) this.renderOhlc(candle, parameter.time);
      }
      this.updateMainIndicatorLegends(parameter?.time);
      this.updateIndicatorLegends(parameter?.seriesData);
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (this.rebuildingIndicatorPanes) return;
      this.renderVolumeProfile(false);
      this.drawingController?.redraw();
      this.extremaOverlay?.schedule();
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.applyOptions({
        width: Math.max(this.chartElement.clientWidth, 1),
        height: Math.max(this.chartElement.clientHeight, 1),
      });
      this.positionSymbolMenu();
      window.requestAnimationFrame(() => {
        this.positionIndicatorLegends();
        this.renderVolumeProfile(false);
        this.drawingController?.redraw();
        this.extremaOverlay?.update();
      });
    });
    this.resizeObserver.observe(this.chartElement);
  }

  private addSeries() {
    if (!this.chart) return;
    const common = {
      priceLineVisible: this.settings.showPriceLine,
      lastValueVisible: this.settings.showPriceLabel,
    };
    const kind = primarySeriesKind(this.settings);
    if (kind === "bars") {
      this.series = this.chart.addSeries(BarSeries, {
        ...common,
        upColor: this.settings.risingColor,
        downColor: this.settings.fallingColor,
        openVisible: true,
        thinBars: true,
      });
    } else if (kind === "line") {
      this.series = this.chart.addSeries(LineSeries, {
        ...common,
        color: this.settings.risingColor,
        lineWidth: 2,
        crosshairMarkerVisible: true,
      });
    } else {
      this.series = this.chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: this.settings.hollowRising ? "rgba(0,0,0,0)" : this.settings.risingColor,
        downColor: this.settings.fallingColor,
        borderVisible: this.settings.showCandleBorder,
        borderUpColor: this.settings.risingColor,
        borderDownColor: this.settings.fallingColor,
        wickVisible: this.settings.showWicks,
        wickUpColor: this.settings.risingColor,
        wickDownColor: this.settings.fallingColor,
      });
    }
    this.tdMarkers = createSeriesMarkers(this.series, [], {
      autoScale: true,
      zOrder: "aboveSeries",
    });
  }

  private rebuildSeries() {
    if (!this.chart) return;
    if (this.series) this.chart.removeSeries(this.series);
    this.series = null;
    this.tdMarkers = null;
    this.addSeries();
    this.updateData();
  }

  private createMainIndicatorSeries() {
    if (!this.chart) return;
    const addLine = (color: string, lineWidth: 1 | 2 | 3 = 2) => this.chart?.addSeries(LineSeries, {
      color,
      lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "",
    });
    const createLines = (id: TradingSplitPaneMainIndicatorId, keys: string[]) => {
      const setting = this.indicatorSettings[indicatorSettingKey("main", id)];
      return keys.map((key, index) => addLine(
        setting?.series[key]?.color ?? ["#d1ab2e", "#2dccac", "#c935cc"][index] ?? "#5b95e5",
        setting?.series[key]?.lineWidth ?? (index === 1 ? 2 : 1),
      )).filter(Boolean);
    };
    this.mainIndicatorSeries.set("ma", createLines("ma", ["short", "medium", "long"]));
    this.mainIndicatorSeries.set("ema", createLines("ema", ["short", "medium", "long"]));
    this.mainIndicatorSeries.set("boll", createLines("boll", ["upper", "middle", "lower"]));
    this.mainIndicatorSeries.set("bbi", createLines("bbi", ["bbi"]));
  }

  private applyMainIndicatorSeriesOptions() {
    const keys: Partial<Record<TradingSplitPaneMainIndicatorId, string[]>> = {
      ma: ["short", "medium", "long"],
      ema: ["short", "medium", "long"],
      boll: ["upper", "middle", "lower"],
      bbi: ["bbi"],
    };
    Object.entries(keys).forEach(([rawId, seriesKeys]) => {
      const id = rawId as TradingSplitPaneMainIndicatorId;
      const setting = this.indicatorSettings[indicatorSettingKey("main", id)];
      this.mainIndicatorSeries.get(id)?.forEach((series, index) => {
        const style = setting?.series[seriesKeys[index]];
        if (style) series.applyOptions({ color: style.color, lineWidth: style.lineWidth });
      });
    });
  }

  private renderVolumeProfile(recalculate = false) {
    if (!this.chart || !this.series || !this.activeMainIndicators.includes("vpvr")) {
      this.invalidateVolumeProfileSnapshot();
      clearTradingVolumeProfileLayer(this.volumeProfileLayer);
      return;
    }
    const setting = this.indicatorSettings[indicatorSettingKey("main", "vpvr")];
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
    const from = logicalRange ? Math.max(0, Math.floor(Number(logicalRange.from))) : 0;
    const to = logicalRange
      ? Math.min(this.candles.length - 1, Math.ceil(Number(logicalRange.to)))
      : this.candles.length - 1;
    const visibleCandles = to >= from ? this.candles.slice(from, to + 1) : [];
    if (recalculate || this.volumeProfileSnapshot === undefined) {
      this.volumeProfileSnapshot = calculateTradingVolumeProfile(
        visibleCandles,
        setting?.parameters[0] ?? 96,
      );
      this.volumeProfileSnapshotCandleCount = visibleCandles.length;
    }
    const priceScaleWidth = Number(this.chart.priceScale("right", 0).width() || 0);
    const plotWidth = Math.max(this.chartElement.clientWidth - priceScaleWidth, 1);
    const paneElement = this.chart.panes()[0]?.getHTMLElement?.() as HTMLElement | null;
    const paneHeight = Math.max(
      paneElement?.clientHeight || paneElement?.getBoundingClientRect().height || this.chartElement.clientHeight,
      1,
    );
    renderTradingVolumeProfileLayer(this.volumeProfileLayer, {
      candles: visibleCandles,
      profile: this.volumeProfileSnapshot,
      sourceCandleCount: this.volumeProfileSnapshotCandleCount,
      rowCount: setting?.parameters[0] ?? 96,
      plotWidth,
      paneHeight,
      priceToCoordinate: (price) => {
        const coordinate = Number(this.series?.priceToCoordinate(price));
        return Number.isFinite(coordinate) ? coordinate : null;
      },
      barColor: setting?.series.volume?.color ?? "#5b95e5",
      pocColor: setting?.series.poc?.color ?? "#5b95e5",
      showBars: setting?.series.volume?.visible !== false,
      showPoc: setting?.series.poc?.visible !== false,
    });
  }

  private invalidateVolumeProfileSnapshot() {
    this.volumeProfileSnapshot = undefined;
    this.volumeProfileSnapshotCandleCount = 0;
  }

  private trackVolumeProfileThroughWheelScale() {
    if (!this.chart || !this.activeMainIndicators.includes("vpvr")) return;
    this.volumeProfileWheelFramesRemaining = TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES;
    if (this.volumeProfileWheelAnimationFrame !== null) return;
    const redraw = () => {
      this.volumeProfileWheelAnimationFrame = null;
      if (this.destroyed) {
        this.volumeProfileWheelFramesRemaining = 0;
        return;
      }
      if (!this.rebuildingIndicatorPanes) this.renderVolumeProfile(false);
      this.volumeProfileWheelFramesRemaining -= 1;
      if (this.volumeProfileWheelFramesRemaining > 0) {
        this.volumeProfileWheelAnimationFrame = window.requestAnimationFrame(redraw);
      }
    };
    this.volumeProfileWheelAnimationFrame = window.requestAnimationFrame(redraw);
  }

  private cancelVolumeProfileWheelTracking() {
    this.volumeProfileWheelFramesRemaining = 0;
    if (this.volumeProfileWheelAnimationFrame === null) return;
    window.cancelAnimationFrame(this.volumeProfileWheelAnimationFrame);
    this.volumeProfileWheelAnimationFrame = null;
  }

  private setMainIndicatorSeriesData(
    id: TradingSplitPaneMainIndicatorId,
    values: number[][],
  ) {
    const keys: Partial<Record<TradingSplitPaneMainIndicatorId, string[]>> = {
      ma: ["short", "medium", "long"],
      ema: ["short", "medium", "long"],
      boll: ["upper", "middle", "lower"],
      bbi: ["bbi"],
    };
    const setting = this.indicatorSettings[indicatorSettingKey("main", id)];
    this.mainIndicatorSeries.get(id)?.forEach((series, seriesIndex) => {
      const key = keys[id]?.[seriesIndex];
      if (!this.activeMainIndicators.includes(id) || (key && setting?.series[key]?.visible === false)) {
        series.setData([]);
        return;
      }
      series.setData((values[seriesIndex] ?? []).flatMap((value, index) => {
        const candle = this.candles[index];
        return Number.isFinite(value) && candle
          ? [{ time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any, value }]
          : [];
      }));
    });
  }

  private updateMainIndicatorData(refreshVolumeProfile = false) {
    const closes = this.candles.map((candle) => candle.close);
    const setting = (id: TradingSplitPaneMainIndicatorId) =>
      this.indicatorSettings[indicatorSettingKey("main", id)];
    const updateLines = (id: TradingSplitPaneMainIndicatorId, values: number[][]) => {
      this.mainIndicatorValues.set(id, values);
      this.setMainIndicatorSeriesData(id, values);
    };
    const maSetting = setting("ma");
    updateLines("ma", this.activeMainIndicators.includes("ma")
      ? maSetting.parameters.map((period) => indicatorSma(closes, period))
      : []);
    const emaSetting = setting("ema");
    updateLines("ema", this.activeMainIndicators.includes("ema")
      ? emaSetting.parameters.map((period) => indicatorEma(closes, period))
      : []);
    const bollSetting = setting("boll");
    const boll = this.activeMainIndicators.includes("boll")
      ? computeBollingerBands(closes, bollSetting.parameters[0], bollSetting.parameters[1])
      : null;
    updateLines("boll", boll ? [boll.upper, boll.middle, boll.lower] : []);
    const bbiSetting = setting("bbi");
    updateLines("bbi", this.activeMainIndicators.includes("bbi")
      ? [computeBbi(closes, bbiSetting.parameters)]
      : []);

    const tdSetting = setting("td");
    const tdSignals = this.activeMainIndicators.includes("td")
      ? computeTdSequential(this.candles, tdSetting.parameters[0])
      : [];
    const tdValues = new Array<number>(this.candles.length).fill(Number.NaN);
    this.tdIndicatorDirections = new Array(this.candles.length).fill(null);
    tdSignals.forEach((signal) => {
      tdValues[signal.index] = signal.count;
      this.tdIndicatorDirections[signal.index] = signal.direction;
    });
    this.mainIndicatorValues.set("td", tdSignals.length ? [tdValues] : []);
    this.tdMarkers?.setMarkers(tdSignals.flatMap((signal) => {
      const style = tdSetting.series[signal.direction];
      if (style?.visible === false || !this.candles[signal.index]) return [];
      return [{
        time: (this.candles[signal.index].time + CHINA_TIME_OFFSET_SECONDS) as any,
        position: signal.direction === "buy" ? "belowBar" : "aboveBar",
        color: style?.color ?? (signal.direction === "buy" ? "#16a873" : "#ef5350"),
        shape: "circle" as const,
        text: String(signal.count),
        size: 0.7,
      }];
    }));
    this.updateMainIndicatorLegends();
    this.renderVolumeProfile(refreshVolumeProfile);
  }

  private updateMainIndicatorLegends(timeValue?: number) {
    this.mainIndicatorLegendElement.replaceChildren();
    if (!this.activeMainIndicators.length || !this.candles.length) return;
    let candleIndex = this.candles.length - 1;
    if (typeof timeValue === "number" && Number.isFinite(timeValue)) {
      const hoveredIndex = this.candles.findIndex(
        (candle) => candle.time + CHINA_TIME_OFFSET_SECONDS === timeValue,
      );
      if (hoveredIndex >= 0) candleIndex = hoveredIndex;
    }
    const valueAt = (id: TradingSplitPaneMainIndicatorId, index: number) =>
      this.mainIndicatorValues.get(id)?.[index]?.[candleIndex] ?? Number.NaN;
    const appendRow = (
      id: TradingSplitPaneMainIndicatorId,
      title: string,
      items: Array<{ label: string; value: number; color: string }>,
    ) => {
      if (!items.length) return;
      const row = document.createElement("div");
      row.className = "trading-market-main-indicator-legend";
      row.dataset.splitMainIndicatorLegend = id;
      const heading = document.createElement("strong");
      heading.textContent = title;
      row.append(heading);
      items.forEach((item) => {
        const value = document.createElement("span");
        value.style.setProperty("--main-indicator-series-color", item.color);
        value.textContent = `${item.label}:${Number.isFinite(item.value) ? formatPrice(item.value) : "--"}`;
        row.append(value);
      });
      this.mainIndicatorLegendElement.append(row);
    };
    this.activeMainIndicators.forEach((id) => {
      const current = this.indicatorSettings[indicatorSettingKey("main", id)];
      if (id === "ma" || id === "ema") {
        const prefix = id.toUpperCase();
        appendRow(id, prefix, ["short", "medium", "long"].flatMap((key, index) =>
          current.series[key]?.visible === false ? [] : [{
            label: `${prefix}(${current.parameters[index]})`,
            value: valueAt(id, index),
            color: current.series[key]?.color ?? "#5b95e5",
          }]));
      } else if (id === "boll") {
        appendRow(id, `BOLL(${current.parameters.join(",")})`, [
          ["middle", "BOLL", 1],
          ["upper", "UB", 0],
          ["lower", "LB", 2],
        ].flatMap(([key, label, index]) => current.series[String(key)]?.visible === false ? [] : [{
          label: String(label),
          value: valueAt(id, Number(index)),
          color: current.series[String(key)]?.color ?? "#5b95e5",
        }]));
      } else if (id === "bbi") {
        if (current.series.bbi?.visible !== false) appendRow(id, "BBI", [{
          label: `BBI(${current.parameters.join(",")})`,
          value: valueAt(id, 0),
          color: current.series.bbi?.color ?? "#5b95e5",
        }]);
      } else if (id === "vpvr") {
        return;
      } else {
        const direction = this.tdIndicatorDirections[candleIndex];
        const style = direction ? current.series[direction] : null;
        if (style?.visible !== false) appendRow(id, `TD(${current.parameters[0]})`, [{
          label: "TD",
          value: valueAt(id, 0),
          color: style?.color ?? "#5b95e5",
        }]);
      }
    });
  }

  private rebuildIndicatorPanes() {
    if (!this.chart) return;
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    this.rebuildingIndicatorPanes = true;
    try {
      this.indicatorPanes.forEach((runtime) => {
        runtime.series.forEach((series) => this.chart?.removeSeries(series.api));
      });
      const panes = this.chart.panes();
      for (let index = panes.length - 1; index >= 1; index -= 1) this.chart.removePane(index);
      this.indicatorPanes.clear();
      this.indicatorLegendLayer.replaceChildren();
      const visibleIndicators = this.activeIndicators.filter((id) => {
        const current = this.indicatorSettings[indicatorSettingKey("sub", id)];
        return current && Object.values(current.series).some((series) => series.visible);
      });
      this.chart.panes()[0]?.setStretchFactor(visibleIndicators.length ? 3 : 1);
      visibleIndicators.forEach((id) => this.createIndicatorPane(id));
      if (visibleRange) this.chart.timeScale().setVisibleLogicalRange(visibleRange);
    } finally {
      this.rebuildingIndicatorPanes = false;
    }
    window.requestAnimationFrame(() => {
      this.positionIndicatorLegends();
      this.renderVolumeProfile(false);
      this.drawingController?.redraw();
    });
  }

  private createIndicatorPane(id: TradingIndicatorId) {
    if (!this.chart) return;
    const current = this.indicatorSettings[indicatorSettingKey("sub", id)];
    if (!current) return;
    const result = calculateTradingIndicator(id, this.candles, current.parameters);
    const visibleSeries = result.series.filter((descriptor) => current.series[descriptor.key]?.visible !== false);
    if (!visibleSeries.length) return;
    const pane = this.chart.addPane(false);
    pane.setStretchFactor(1);
    const runtime: SplitPaneIndicatorRuntime = { id, pane, legend: null, series: [] };
    visibleSeries.forEach((descriptor) => {
      const style = current.series[descriptor.key];
      const common = {
        priceLineVisible: false,
        lastValueVisible: false,
        title: "",
        priceFormat: descriptor.priceFormat === "volume"
          ? { type: "volume" as const }
          : { type: "price" as const, precision: 2, minMove: 0.01 },
      };
      const api = descriptor.type === "histogram"
        ? pane.addSeries(HistogramSeries, {
            ...common,
            color: style?.color ?? descriptor.color,
            base: descriptor.baseValue ?? 0,
          })
        : pane.addSeries(LineSeries, {
            ...common,
            color: style?.color ?? descriptor.color,
            lineWidth: style?.lineWidth ?? 2,
            crosshairMarkerVisible: false,
          });
      runtime.series.push({
        key: descriptor.key,
        api,
        label: descriptor.label,
        latestValue: Number.NaN,
      });
    });
    runtime.series[0]?.api?.priceScale()?.applyOptions({
      autoScale: true,
      borderColor: this.themeName === "dark" ? "#1a2437" : "#e3e8ef",
      textColor: this.themeName === "dark" ? "#dfe1e3" : "#172033",
      scaleMargins: { top: 0.22, bottom: 0.12 },
    });
    result.referenceLines?.forEach((reference) => {
      runtime.series[0]?.api?.createPriceLine({
        price: reference.value,
        color: reference.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
    });
    runtime.legend = this.createIndicatorLegend(result, current);
    this.indicatorPanes.set(id, runtime);
  }

  private createIndicatorLegend(
    result: TradingIndicatorResult,
    current: TradingSplitPaneIndicatorSetting,
  ) {
    const legend = document.createElement("div");
    legend.className = "trading-market-indicator-legend";
    const title = document.createElement("strong");
    title.textContent = `${result.definition.label}${current.parameters.length ? ` (${current.parameters.join(",")})` : ""}`;
    legend.append(title);
    result.series.filter((descriptor) => current.series[descriptor.key]?.visible !== false).forEach((descriptor) => {
      const value = document.createElement("span");
      value.style.setProperty("--indicator-series-color", current.series[descriptor.key]?.color ?? descriptor.color);
      value.textContent = `${descriptor.label}: --`;
      legend.append(value);
    });
    this.indicatorLegendLayer.append(legend);
    return legend;
  }

  private positionIndicatorLegends() {
    const viewportRect = this.viewportElement.getBoundingClientRect();
    this.indicatorPanes.forEach((runtime) => {
      const paneElement = runtime.pane?.getHTMLElement?.() as HTMLElement | null;
      if (!paneElement || !runtime.legend) return;
      const paneRect = paneElement.getBoundingClientRect();
      runtime.legend.style.top = `${Math.max(paneRect.top - viewportRect.top + 7, 0)}px`;
    });
  }

  private updateIndicatorData() {
    this.activeIndicators.forEach((id) => {
      const runtime = this.indicatorPanes.get(id);
      const current = this.indicatorSettings[indicatorSettingKey("sub", id)];
      if (!runtime || !current) return;
      const result = calculateTradingIndicator(id, this.candles, current.parameters);
      result.series.forEach((descriptor) => {
        const seriesRuntime = runtime.series.find((series) => series.key === descriptor.key);
        if (!seriesRuntime) return;
        seriesRuntime.api.setData(descriptor.values.flatMap((value, index) => {
          const candle = this.candles[index];
          if (!Number.isFinite(value) || !candle) return [];
          return [{
            time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any,
            value,
            ...(descriptor.colors?.[index] ? { color: descriptor.colors[index] } : {}),
          }];
        }));
        seriesRuntime.latestValue = Number.NaN;
        for (let index = descriptor.values.length - 1; index >= 0; index -= 1) {
          if (Number.isFinite(descriptor.values[index])) {
            seriesRuntime.latestValue = descriptor.values[index];
            break;
          }
        }
      });
      runtime.series[0]?.api?.priceScale()?.setAutoScale(true);
    });
    this.updateIndicatorLegends();
  }

  private updateIndicatorLegends(seriesData?: Map<any, any>) {
    this.indicatorPanes.forEach((runtime) => {
      runtime.series.forEach((seriesRuntime, index) => {
        const current = seriesData?.get(seriesRuntime.api);
        const value = Number(current?.value ?? current?.high ?? seriesRuntime.latestValue);
        const target = runtime.legend?.querySelectorAll<HTMLElement>("span")[index];
        if (target) target.textContent = `${seriesRuntime.label}: ${formatIndicatorValue(value, runtime.id)}`;
      });
    });
  }

  updateIndicatorSettings(settings: TradingSplitPaneIndicatorSettings) {
    this.indicatorSettings = cloneIndicatorSettings(settings);
    this.applyMainIndicatorSeriesOptions();
    this.rebuildIndicatorPanes();
    this.updateMainIndicatorData(true);
    this.updateIndicatorData();
  }

  activateIndicator(scope: "main" | "sub", id: string) {
    if (scope === "main") {
      const indicator = id as TradingSplitPaneMainIndicatorId;
      if (!this.mainIndicators.some((item) => item.id === indicator)) return;
      if (!this.activeMainIndicators.includes(indicator)) this.activeMainIndicators.push(indicator);
      this.updateMainIndicatorData();
    } else {
      const indicator = id as TradingIndicatorId;
      if (!TRADING_INDICATORS.some((item) => item.id === indicator)) return;
      if (!this.activeIndicators.includes(indicator)) this.activeIndicators.push(indicator);
      this.rebuildIndicatorPanes();
      this.updateIndicatorData();
    }
    this.updateIndicatorButtons();
    this.notifyIndicatorSelectionChange();
  }

  setIndicatorEditorActive(active: boolean) {
    const trigger = this.host.querySelector<HTMLElement>("[data-split-indicator-editor-trigger]");
    trigger?.classList.toggle("active", active);
    trigger?.setAttribute("aria-expanded", String(active));
  }

  updateSettings(settings: TradingChartSettings, themeName: TradingChartThemeName) {
    const styleChanged = settings.chartStyle !== this.settings.chartStyle;
    this.settings = cloneTradingChartSettings(settings);
    this.themeName = themeName;
    const theme = settings.themes[themeName];
    this.chart?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.backgroundColor },
        textColor: themeName === "dark" ? "#dfe1e3" : "#172033",
        panes: {
          enableResize: true,
          separatorColor: themeName === "dark" ? "#1a2437" : "#e3e8ef",
          separatorHoverColor: themeName === "dark" ? "#30486d" : "#b9cbea",
        },
      },
      grid: {
        vertLines: { visible: theme.verticalGridVisible, color: theme.verticalGridColor },
        horzLines: { visible: theme.horizontalGridVisible, color: theme.horizontalGridColor },
      },
      crosshair: {
        vertLine: { color: theme.crosshairColor, labelBackgroundColor: theme.crosshairColor },
        horzLine: { color: theme.crosshairColor, labelBackgroundColor: theme.crosshairColor },
      },
      rightPriceScale: {
        mode: priceScaleMode(settings),
        autoScale: true,
        borderColor: themeName === "dark" ? "#1a2437" : "#e3e8ef",
        textColor: themeName === "dark" ? "#dfe1e3" : "#172033",
        scaleMargins: {
          top: settings.verticalPaddingPercent / 100,
          bottom: settings.verticalPaddingPercent / 100,
        },
      },
      timeScale: {
        visible: false,
        borderColor: themeName === "dark" ? "#1a2437" : "#e3e8ef",
        rightBarStaysOnScroll: settings.scaleAnchor === "cursor",
      },
    });
    this.indicatorPanes.forEach((runtime) => {
      runtime.series[0]?.api?.priceScale()?.applyOptions({
        borderColor: themeName === "dark" ? "#1a2437" : "#e3e8ef",
        textColor: themeName === "dark" ? "#dfe1e3" : "#172033",
      });
    });
    this.applyMainIndicatorSeriesOptions();
    if (styleChanged) this.rebuildSeries();
    else {
      const kind = primarySeriesKind(settings);
      if (kind === "candles") {
        this.series?.applyOptions({
          upColor: settings.hollowRising ? "rgba(0,0,0,0)" : settings.risingColor,
          downColor: settings.fallingColor,
          borderVisible: settings.showCandleBorder,
          borderUpColor: settings.risingColor,
          borderDownColor: settings.fallingColor,
          wickVisible: settings.showWicks,
          wickUpColor: settings.risingColor,
          wickDownColor: settings.fallingColor,
          priceLineVisible: settings.showPriceLine,
          lastValueVisible: settings.showPriceLabel,
        });
      } else if (kind === "bars") {
        this.series?.applyOptions({
          upColor: settings.risingColor,
          downColor: settings.fallingColor,
          priceLineVisible: settings.showPriceLine,
          lastValueVisible: settings.showPriceLabel,
        });
      } else {
        this.series?.applyOptions({
          color: settings.risingColor,
          priceLineVisible: settings.showPriceLine,
          lastValueVisible: settings.showPriceLabel,
        });
      }
      this.updateData();
    }
    this.drawingController?.setUserDrawingEnabled(settings.drawingToolsEnabled);
    this.drawingController?.redraw();
  }

  getDrawingController() {
    return this.drawingController;
  }

  analysisContextMatches(marketId: string, interval: string) {
    return this.market.id === marketId && this.interval === interval;
  }

  async analysisSnapshot(lookbackMs: number | null): Promise<TradingSplitPaneAnalysisSnapshot>;
  async analysisSnapshot(
    lookbackMs: number | null,
    preferredCandles: number | null,
  ): Promise<TradingSplitPaneAnalysisSnapshot>;
  async analysisSnapshot(
    lookbackMs: number | null,
    preferredCandles: number | null = null,
  ): Promise<TradingSplitPaneAnalysisSnapshot> {
    if (!this.candles.length) await this.reload(true);
    if (this.destroyed || !this.candles.length) {
      throw new Error(`分屏 ${this.paneIndex + 1} 行情尚未就绪`);
    }
    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const logicalRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const visibleFrom = logicalRange ? Math.max(0, Math.floor(Number(logicalRange.from))) : 0;
    const visibleTo = logicalRange
      ? Math.min(this.candles.length - 1, Math.ceil(Number(logicalRange.to)))
      : -1;
    const visibleCandles = visibleTo >= visibleFrom
      ? this.candles.slice(visibleFrom, visibleTo + 1)
      : [];
    const normalizedPreferredCandles = Math.max(
      0,
      Math.min(600, Math.floor(Number(preferredCandles) || 0)),
    );
    const defaultCandles = normalizedPreferredCandles > 0
      ? this.candles.slice(-Math.min(600, Math.max(visibleCandles.length, normalizedPreferredCandles)))
      : visibleCandles.length
        ? visibleCandles
        : this.candles.slice(-100);
    const lookbackCandles = lookbackMs && latestTimeMs > 0
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - lookbackMs)
      : [];
    const minimumSnapshotCandles = normalizedPreferredCandles > 0 ? normalizedPreferredCandles : 8;
    const candles = lookbackCandles.length >= minimumSnapshotCandles
      ? lookbackCandles
      : defaultCandles;
    return {
      paneIndex: this.paneIndex,
      market: { ...this.market },
      interval: this.interval,
      candles: candles.map((candle) => ({ ...candle })),
    };
  }

  cancelAiPlayback(options: { clear?: boolean } = {}) {
    this.drawingController?.cancelAiPlayback(options);
  }

  async playAiDrawingPatch(
    patch: TradingAiDrawingPatch,
    options: { onPhase?: (phase: TradingAiPlaybackPhase) => void } = {},
  ) {
    await (this.drawingController?.playAiDrawingPatch(patch, {
      ...options,
      beforePlayback: () => this.focusAnalysisDrawingPatch(patch),
    }) ?? Promise.resolve());
  }

  private async focusAnalysisDrawingPatch(patch: TradingAiDrawingPatch) {
    if (!this.chart || !this.candles.length) return;
    const priceScaleWidth = Number(this.chart.priceScale("right", 0).width() || 0);
    const plotWidth = Math.max(this.chartElement.clientWidth - priceScaleWidth, 1);
    const logicalRange = tradingAnalysisDrawingFocusRange(patch, this.candles, plotWidth);
    if (!logicalRange) return;
    this.invalidateVolumeProfileSnapshot();
    this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.renderVolumeProfile(true);
    this.drawingController?.redraw();
    await waitForTradingAnalysisViewportPaint(window);
    if (this.destroyed) return;
    this.drawingController?.redraw();
  }

  updateDrawingStorageSession(storageSessionId: string, migrateFromSessionId = "") {
    this.drawingController?.switchStorageSession(storageSessionId, {
      migrateFromSessionId: migrateFromSessionId || undefined,
    });
  }

  updateMarkets(markets: readonly TradingSplitPaneMarket[]) {
    this.markets = markets;
    const current = markets.find((market) => market.id === this.market.id);
    if (current) this.market = current;
    if (!this.symbolMenu.hidden) this.renderSymbolResults();
  }

  private async reload(resetViewport: boolean) {
    if (resetViewport) this.invalidateVolumeProfileSnapshot();
    const generation = ++this.loadGeneration;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const showLoading = resetViewport || this.candles.length === 0;
    this.loadingElement.hidden = !showLoading;
    this.errorElement.hidden = true;
    try {
      const candles = await this.loadCandles(this.market, this.interval);
      if (this.destroyed || generation !== this.loadGeneration) return;
      if (!candles.length) throw new Error("暂无行情");
      const previousCandles = this.candles;
      this.candles = candles;
      this.updateData(previousCandles);
      if (resetViewport) this.chart?.timeScale().fitContent();
      this.renderOhlc(candles[candles.length - 1], candles[candles.length - 1].time + CHINA_TIME_OFFSET_SECONDS);
      window.requestAnimationFrame(() => {
        this.drawingController?.redraw();
        this.extremaOverlay?.update();
      });
    } catch {
      if (this.destroyed || generation !== this.loadGeneration) return;
      if (showLoading || this.candles.length === 0) this.errorElement.hidden = false;
    } finally {
      if (!this.destroyed && generation === this.loadGeneration) {
        this.loadingElement.hidden = true;
        this.scheduleRefresh();
      }
    }
  }

  private updateData(previousCandles: readonly TradingChartCandle[] = []) {
    if (!this.series || !this.candles.length) return;
    const nextData = seriesData(this.candles, this.settings);
    const previousData = previousCandles.length
      ? seriesData(previousCandles, this.settings)
      : [];
    let unchangedPrefix = 0;
    while (
      unchangedPrefix < previousData.length
      && unchangedPrefix < nextData.length
      && sameSeriesDatum(previousData[unchangedPrefix], nextData[unchangedPrefix])
    ) {
      unchangedPrefix += 1;
    }
    if (unchangedPrefix === previousData.length && unchangedPrefix === nextData.length) return;
    const canUpdateTail = previousData.length > 0
      && unchangedPrefix >= previousData.length - 1
      && nextData.length >= previousData.length;
    if (canUpdateTail) {
      nextData.slice(unchangedPrefix).forEach((datum) => this.series?.update(datum));
    } else {
      this.series.setData(nextData);
    }
    this.updateMainIndicatorData();
    this.updateIndicatorData();
    this.extremaOverlay?.schedule();
  }

  private renderOhlc(candle: TradingChartCandle, displayTime: number) {
    const change = candle.close - candle.open;
    const changePercent = candle.open ? (change / candle.open) * 100 : 0;
    const amplitudePercent = candle.open ? ((candle.high - candle.low) / candle.open) * 100 : 0;
    const tone = change >= 0 ? "positive" : "negative";
    const item = (label: string, value: string) => `
      <span class="trading-market-ohlc-item"><span>${label}</span><b class="${tone}">${value}</b></span>
    `;
    this.ohlcElement.innerHTML = `
      <time>${formatDateTime(displayTime)}</time>
      ${item("开", formatPrice(candle.open))}
      ${item("高", formatPrice(candle.high))}
      ${item("低", formatPrice(candle.low))}
      ${item("收", formatPrice(candle.close))}
      ${item("涨幅", `${changePercent.toFixed(2)}%(${formatPrice(change)})`)}
      ${item("振幅", `${amplitudePercent.toFixed(2)}%`)}
    `;
  }

  private scheduleRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.reload(false), SPLIT_PANE_REFRESH_INTERVAL_MS);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadGeneration += 1;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.cancelVolumeProfileWheelTracking();
    this.resizeObserver?.disconnect();
    this.host.removeEventListener("click", this.handleToolbarClick);
    this.symbolSearch.removeEventListener("input", this.handleSymbolSearchInput);
    this.errorElement.removeEventListener("click", this.handleRetry);
    this.chartElement.removeEventListener("wheel", this.handleWheel, { capture: true });
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.drawingController?.destroy();
    this.drawingController = null;
    this.extremaOverlay?.destroy();
    this.extremaOverlay = null;
    this.chart?.remove();
    this.chart = null;
    this.host.replaceChildren();
  }
}
