import {
  AreaSeries,
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
  type UTCTimestamp,
} from "lightweight-charts";
import { appLanguageLocale, translateTradingAnnotationText } from "./app-language.mjs";
import { renderTradingChartBrand } from "./trading-chart-brand.ts";
import {
  TRADING_FALLING_BAR_COLOR,
  TRADING_INDICATORS,
  TRADING_RISING_BAR_COLOR,
  calculateTradingIndicator,
  type TradingIndicatorId,
  type TradingIndicatorResult,
} from "./trading-expert-indicators.ts";
import {
  TradingDrawingController,
  persistTradingAiDrawingPatch,
  renderTradingDrawingLayer,
  renderTradingDrawingToolbar,
  tradingDrawingLogicalIndexAtTime,
  tradingDrawingSessionStorageKey,
  type TradingDrawingSharedToolState,
} from "./trading-expert-drawing.ts";
import {
  tradingAnalysisJobs,
  type TradingAnalysisJobContext,
} from "./trading-expert-analysis-jobs.ts";
import type {
  TradingAiDrawingPatch,
  TradingAiDrawingColorToken,
  TradingAiPlaybackPhase,
  TradingIndicatorAiDrawingPatch,
} from "./trading-expert-ai-playback.ts";
import {
  TRADING_CHAN_AUTO_EXPANSION_MAX_CANDLES,
  TRADING_CHAN_HISTORY_BATCH_CANDLES,
  TRADING_CHAN_INSUFFICIENT_DATA_CODE,
  TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES,
  TRADING_CANDLE_WINDOW_HISTORY_BATCH_CANDLES,
  TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE,
  TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES,
  TRADING_WAVE_HISTORY_BATCH_CANDLES,
  TRADING_WYCKOFF_AUTO_EXPANSION_MAX_CANDLES,
  TRADING_WYCKOFF_HISTORY_BATCH_CANDLES,
  TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE,
  runTradingAnalysisWithAutoExpansion,
  runTradingWaveAnalysisWithAutoExpansion,
  type TradingAnalysisExpansionEvent,
  type TradingWaveExpansionEvent,
} from "./trading-expert-wave-expansion.ts";
import {
  DEFAULT_TRADING_CHART_SETTINGS,
  cloneTradingChartSettings,
  filterTradingOrderLinesForDisplay,
  heikinAshiCandles,
  hlcCandles,
  loadTradingChartSettings,
  loadTradingSplitLayoutId,
  normalizeTradingChartSettings,
  renderTradingChartSettingsDialog,
  renderTradingSplitLayoutPicker,
  saveTradingChartSettings,
  saveTradingSplitLayoutId,
  tradingFloatingOverlayPlacement,
  tradingPriceScaleUsesAutoScale,
  tradingSplitLayout,
  type TradingChartSettings,
  type TradingChartSettingsTab,
  type TradingChartThemeName,
} from "./trading-expert-chart-settings.ts";
import {
  TradingExpertSplitPane,
  type TradingSplitPaneAnalysisSnapshot,
  type TradingSplitPaneIndicatorSelection,
  type TradingSplitPaneMarket,
  type TradingSplitPaneSelection,
} from "./trading-expert-split-pane.ts";
import {
  binanceTradingMarketAssetLogoUrl,
  hyperliquidTradingMarketAssetLogoUrl,
  renderTradingMarketAssetLogo,
} from "./trading-expert-market-identity.ts";
import { TradingFavoriteTickerSortController } from "./trading-expert-favorite-ticker-sort.ts";
import {
  buildTradingOrderLines,
  type TradingOrderLine,
  type TradingOrderLineAccountSnapshot,
} from "./trading-expert-order-lines.ts";
import {
  TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES,
  calculateTradingVolumeProfile,
  clearTradingVolumeProfileLayer,
  renderTradingVolumeProfileLayer,
  type TradingVolumeProfile,
} from "./trading-volume-profile.ts";
import {
  createTradingMarketCandleCache,
  mergeTradingCandleBatches,
} from "./trading-market-candle-cache.mjs";
import {
  tradingAnalysisDrawingFocusRange,
  waitForTradingAnalysisViewportPaint,
} from "./trading-analysis-viewport.mjs";

async function subscribeBinanceMarketStreams(
  marketType: Extract<TradingMarketType, "spot" | "perpetual">,
  streams: string[],
  callback: (event: any) => void,
) {
  const request = window.codexDesktop?.subscribeBinanceMarketStreams;
  if (typeof request !== "function") throw new Error("Haolo 行情订阅服务不可用");
  return request({ marketType: marketType === "spot" ? "spot" : "futures", streams }, callback);
}

function unsubscribeBinanceMarketStreams(subscriptionId: string | null | undefined) {
  if (!subscriptionId) return;
  void window.codexDesktop?.unsubscribeBinanceMarketStreams?.({ subscriptionId }).catch(() => {});
}
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_INTERVAL = "1D";
const MARKET_QUOTE = "USDT";
const MARKET_VENUE = "币安";
const MARKET_PRICE_FORMAT = { type: "price", precision: 2, minMove: 0.01 } as const;
const MARKET_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", Arial, sans-serif';
const TRADING_PERIODS_STORAGE_KEY = "haolo.trading-market.periods.v1";
const TRADING_FAVORITES_STORAGE_KEY = "haolo.trading-market.favorites.v1";
const TRADING_FAVORITE_MARKETS_STORAGE_KEY = "haolo.trading-market.favorite-records.v1";
const TRADING_LAST_ANALYSIS_CONTEXT_STORAGE_KEY_PREFIX = "haolo.trading-market.last-analysis-context.v1.";
const TRADING_LAST_DRAWING_WORKSPACE_STORAGE_KEY_PREFIX = "haolo.trading-market.last-drawing-workspace.v1.";
const TRADING_ALERT_SIMULATION_STORAGE_KEY_PREFIX = "haolo.trading-market.alert-simulation.v1.";
const TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v4";
const PREVIOUS_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v3";
const LEGACY_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v2";
const OLDEST_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v1";

export function tradingSplitPaneDrawingStorageSessionId(storageSessionId: string, paneIndex: number) {
  const sessionId = storageSessionId.trim() || "trading-expert-unassigned";
  return `${sessionId}::split-pane:${Math.max(1, Math.trunc(paneIndex))}`;
}
export const TRADING_EXPERT_TREND_BAND_MENTION = "@指标:趋势带";
const LEGACY_TRADING_EXPERT_TREND_BAND_MENTION = "@自定义指标:趋势带";
const ENGLISH_TRADING_EXPERT_TREND_BAND_MENTION = "@Indicator:Trend band";
const TRADITIONAL_TRADING_EXPERT_TREND_BAND_MENTION = "@指標:趨勢帶";
const MAX_TRADING_PERIODS = 10;
const MAX_TRADING_FAVORITES = 500;
export const MAX_TRADING_FAVORITE_TICKERS = 12;
const DEFAULT_TRADING_FAVORITE_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
export const DEFAULT_TRADING_FAVORITE_MARKET_IDS = DEFAULT_TRADING_FAVORITE_SYMBOLS
  .map((symbol) => `BINANCE:FUTURES:${symbol}`);
const MARKET_LIVE_PAINT_INTERVAL_MS = 100;
const MARKET_BACKGROUND_PAINT_INTERVAL_MS = 1_000;
const MARKET_LIVE_FULL_REFRESH_INTERVAL_MS = 1_000;
const MARKET_SOCKET_STALE_MS = 2_500;
const MARKET_SOCKET_FALLBACK_INTERVAL_MS = 5_000;
const FAVORITE_TICKER_FALLBACK_INTERVAL_MS = 5_000;
const FAVORITE_TICKER_FALLBACK_TIMEOUT_MS = 8_000;
const FAVORITE_TICKER_SOCKET_STALE_MS = 2_500;
const BINANCE_MARKET_RATE_LIMIT_DEFAULT_MS = 60_000;
const BINANCE_MARKET_RATE_LIMIT_RETRY_PADDING_MS = 500;
const FINNHUB_SEARCH_DEBOUNCE_MS = 480;
const GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE = "目前版本此交易对数据还未接入";

let binanceMarketRestRetryAt = 0;

export function parseBinanceMarketRetryAfterMs(value: unknown, nowMs = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const dateMs = Date.parse(text);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

export function binanceMarketRestCooldownRemaining(nowMs = Date.now()) {
  return Math.max(0, binanceMarketRestRetryAt - nowMs);
}

function recordBinanceMarketRateLimit(value: unknown) {
  const parsed = Number(value);
  const retryAfterMs = Number.isFinite(parsed) && parsed > 0
    ? Math.ceil(parsed)
    : BINANCE_MARKET_RATE_LIMIT_DEFAULT_MS;
  binanceMarketRestRetryAt = Math.max(binanceMarketRestRetryAt, Date.now() + retryAfterMs);
  return retryAfterMs;
}

function binanceMarketRateLimitMessage(retryAfterMs: number) {
  return `Binance 行情请求频率受限，约 ${Math.max(1, Math.ceil(retryAfterMs / 1_000))} 秒后自动重试`;
}

export function hasTradingExpertTrendBandMention(text: string) {
  const source = String(text || "");
  return (
    source.includes(TRADING_EXPERT_TREND_BAND_MENTION)
    || source.includes(TRADING_EXPERT_TREND_BAND_MENTION.replace(":", "："))
    || source.includes(LEGACY_TRADING_EXPERT_TREND_BAND_MENTION)
    || source.includes(LEGACY_TRADING_EXPERT_TREND_BAND_MENTION.replace(":", "："))
    || source.includes(ENGLISH_TRADING_EXPERT_TREND_BAND_MENTION)
    || source.includes(TRADITIONAL_TRADING_EXPERT_TREND_BAND_MENTION)
  );
}

const TRADING_INDICATOR_AI_TOOLS = new Set(["path", "note", "text"]);
const TRADING_INDICATOR_AI_COLOR_TOKENS = new Set([
  "strategy-primary", "strategy-support", "strategy-resistance", "strategy-entry",
  "strategy-stop", "strategy-target", "strategy-note",
]);
const TRADING_INDICATOR_AI_COLOR_VARIABLES: Record<TradingAiDrawingColorToken, string> = {
  "chan-pen": "--trading-ai-chan-pen",
  "chan-center": "--trading-ai-chan-center",
  "chan-top": "--trading-ai-chan-top",
  "chan-bottom": "--trading-ai-chan-bottom",
  "chan-note": "--trading-ai-chan-note",
  "order-flow-buy": "--trading-ai-order-flow-buy",
  "order-flow-sell": "--trading-ai-order-flow-sell",
  "order-flow-poc": "--trading-ai-order-flow-poc",
  "order-flow-note": "--trading-ai-order-flow-note",
  "order-flow-structure-bull": "--trading-ai-order-flow-structure-bull",
  "order-flow-structure-bear": "--trading-ai-order-flow-structure-bear",
  "order-flow-ob-bull": "--trading-ai-order-flow-ob-bull",
  "order-flow-ob-bear": "--trading-ai-order-flow-ob-bear",
  "order-flow-fvg-bull": "--trading-ai-order-flow-fvg-bull",
  "order-flow-fvg-bear": "--trading-ai-order-flow-fvg-bear",
  "order-flow-liquidity": "--trading-ai-order-flow-liquidity",
  "order-flow-equilibrium": "--trading-ai-order-flow-equilibrium",
  "order-flow-ote": "--trading-ai-order-flow-ote",
  "wave-primary": "--trading-ai-wave-primary",
  "wave-correction": "--trading-ai-wave-correction",
  "wave-alternative": "--trading-ai-wave-alternative",
  "wave-fibonacci": "--trading-ai-wave-fibonacci",
  "wave-note": "--trading-ai-wave-note",
  "wyckoff-range": "--trading-ai-wyckoff-range",
  "wyckoff-demand": "--trading-ai-wyckoff-demand",
  "wyckoff-supply": "--trading-ai-wyckoff-supply",
  "wyckoff-phase": "--trading-ai-wyckoff-phase",
  "wyckoff-event-bull": "--trading-ai-wyckoff-event-bull",
  "wyckoff-event-bear": "--trading-ai-wyckoff-event-bear",
  "wyckoff-projection": "--trading-ai-wyckoff-projection",
  "wyckoff-note": "--trading-ai-wyckoff-note",
  "price-action-trend": "--trading-ai-price-action-trend",
  "price-action-support": "--trading-ai-price-action-support",
  "price-action-resistance": "--trading-ai-price-action-resistance",
  "price-action-note": "--trading-ai-price-action-note",
  "strategy-primary": "--trading-ai-strategy-primary",
  "strategy-support": "--trading-ai-strategy-support",
  "strategy-resistance": "--trading-ai-strategy-resistance",
  "strategy-entry": "--trading-ai-strategy-entry",
  "strategy-stop": "--trading-ai-strategy-stop",
  "strategy-target": "--trading-ai-strategy-target",
  "strategy-note": "--trading-ai-strategy-note",
};

function tradingIndicatorAiLineStyle(style?: string) {
  if (style === "dotted") return LineStyle.Dotted;
  if (style === "dashed") return LineStyle.Dashed;
  return LineStyle.Solid;
}

export function normalizeTradingIndicatorAiDrawingPatch(value: unknown): TradingIndicatorAiDrawingPatch {
  const patch = value as Partial<TradingIndicatorAiDrawingPatch> | null;
  const indicatorId = String(patch?.indicatorId || "").trim().toLowerCase();
  if (
    Number(patch?.schemaVersion) !== 1
    || !String(patch?.analysisId || "").trim()
    || !String(patch?.marketId || "").trim()
    || !String(patch?.interval || "").trim()
    || !/^[a-z][a-z0-9-]{1,63}$/.test(indicatorId)
    || !Array.isArray(patch?.operations)
    || !patch.operations.length
    || patch.operations.length > 64
  ) throw new TypeError("Indicator drawing patch is invalid");
  const operations = patch.operations.map((operation, index) => {
    const drawing = operation?.drawing;
    const strategyId = String(drawing?.strategyId || "");
    const points = Array.isArray(drawing?.points) ? drawing.points : [];
    if (
      operation?.op !== "upsert"
      || !drawing
      || drawing.theory !== "strategy"
      || !/^[a-z][a-z0-9-]{1,63}$/.test(strategyId)
      || drawing.layer !== `ai/strategy/${strategyId}`
      || !TRADING_INDICATOR_AI_TOOLS.has(drawing.tool)
      || !TRADING_INDICATOR_AI_COLOR_TOKENS.has(drawing.colorToken)
      || !points.length
      || points.length > 64
      || !points.every((point) => Number.isFinite(point?.time) && point.time > 0 && Number.isFinite(point?.value))
      || (drawing.tool === "path" && points.length < 2)
      || ((drawing.tool === "note" || drawing.tool === "text") && points.length !== 1)
    ) throw new TypeError(`Indicator drawing operation ${index} is invalid`);
    return {
      op: "upsert" as const,
      drawing: {
        id: String(drawing.id || `indicator-ai-${index}`).slice(0, 160),
        strategyId,
        theory: "strategy" as const,
        layer: `ai/strategy/${strategyId}` as const,
        tool: drawing.tool,
        points: points.map((point) => ({ time: Number(point.time), value: Number(point.value) })),
        text: typeof drawing.text === "string" ? drawing.text.slice(0, 120) : undefined,
        colorToken: drawing.colorToken,
        lineStyle: drawing.lineStyle === "solid" || drawing.lineStyle === "dashed" || drawing.lineStyle === "dotted" ? drawing.lineStyle : undefined,
        lineWidth: Number.isFinite(drawing.lineWidth) && Number(drawing.lineWidth) >= 0.5 && Number(drawing.lineWidth) <= 4 ? Number(drawing.lineWidth) : undefined,
        fontSize: Number.isFinite(drawing.fontSize) ? Number(drawing.fontSize) : undefined,
        bold: drawing.bold === true,
        markerSize: Number.isFinite(drawing.markerSize)
          && Number(drawing.markerSize) >= (drawing.tool === "text" ? 0 : 0.1)
          && Number(drawing.markerSize) <= 2
          ? Number(drawing.markerSize)
          : undefined,
        locked: true as const,
        status: drawing.status === "tentative" ? "tentative" as const : "confirmed" as const,
        evidenceIds: Array.isArray(drawing.evidenceIds) ? drawing.evidenceIds.map(String).slice(0, 32) : [],
      },
    };
  });
  return {
    schemaVersion: 1,
    analysisId: String(patch.analysisId).slice(0, 160),
    baseRevision: Math.max(0, Number(patch.baseRevision) || 0),
    marketId: String(patch.marketId),
    interval: String(patch.interval),
    indicatorId,
    operations,
  };
}

export function strictlyAscendingTradingIndicatorPathPoints(
  points: Array<{ time: number; value: number }>,
) {
  let previousTime = Number.NEGATIVE_INFINITY;
  return points
    .slice()
    .sort((first, second) => first.time - second.time)
    .map((point) => {
      const time = point.time <= previousTime ? previousTime + 1 : point.time;
      previousTime = time;
      return { time, value: point.value };
    });
}

type TradingMarketProvider = "binance" | "finnhub" | "ifind";
export type TradingAssetClass = "crypto" | "commodity" | "etf" | "stock" | "preipo" | "index" | "forex" | "a-share";
type TradingMarketType = "perpetual" | "spot" | "global";

export type TradingMarketCategory = "all" | "crypto" | "commodity" | "stock" | "a-share";

export const TRADING_MARKET_CATEGORY_OPTIONS: ReadonlyArray<{
  id: TradingMarketCategory;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "crypto", label: "加密货币" },
  { id: "commodity", label: "大宗商品" },
  { id: "stock", label: "美股" },
  { id: "a-share", label: "A股" },
];

const TRADING_STOCK_CATEGORY_ASSET_CLASSES: ReadonlySet<TradingAssetClass> = new Set([
  "stock",
  "etf",
  "preipo",
]);
const IFIND_DEFAULT_DIRECTORY_LIMIT = 30;

export function tradingMarketCategoryIncludesAssetClass(
  category: TradingMarketCategory,
  assetClass: TradingAssetClass,
) {
  if (category === "all") return true;
  if (category === "stock") return TRADING_STOCK_CATEGORY_ASSET_CLASSES.has(assetClass);
  return assetClass === category;
}

export function tradingMarketCategoryLabel(category: TradingMarketCategory | TradingAssetClass) {
  const normalizedCategory = category === "etf" || category === "preipo" ? "stock" : category;
  return TRADING_MARKET_CATEGORY_OPTIONS.find((option) => option.id === normalizedCategory)?.label || "其他";
}

function normalizeTradingAssetClass(value: unknown, fallback: TradingAssetClass = "stock"): TradingAssetClass {
  const normalized = String(value || "").trim().toLowerCase();
  return ["crypto", "commodity", "etf", "stock", "preipo", "index", "forex", "a-share"].includes(normalized)
    ? normalized as TradingAssetClass
    : fallback;
}

export function abbreviateIfindVenue(value: unknown) {
  const venue = String(value || "").replace(/[\r\n\0]+/g, " ").trim();
  const key = venue.toUpperCase();
  if (key === "SH" || key === "SSE" || venue.includes("上海")) return "上交所";
  if (key === "SZ" || key === "SZSE" || venue.includes("深圳")) return "深交所";
  if (key === "BJ" || key === "BSE" || venue.includes("北京")) return "北交所";
  return venue.slice(0, 80) || "A股市场";
}

function binanceUnderlyingSubTypes(item: Pick<BinanceExchangeSymbol, "underlyingSubType">) {
  return Array.isArray(item.underlyingSubType)
    ? item.underlyingSubType
    : item.underlyingSubType
      ? [item.underlyingSubType]
      : [];
}

function binanceTradFiAssetClass(item: Pick<BinanceExchangeSymbol, "contractType" | "underlyingType" | "underlyingSubType">): TradingAssetClass {
  const underlyingType = String(item.underlyingType || "").trim().toUpperCase();
  const underlyingSubTypes = binanceUnderlyingSubTypes(item).map((value) => String(value).trim().toUpperCase());
  if (underlyingSubTypes.includes("ETF")) return "etf";
  if (underlyingSubTypes.some((value) => value === "PRE-IPO" || value === "PRE_IPO" || value === "PREMARKET")) return "preipo";
  if (underlyingType === "COMMODITY") return "commodity";
  if (underlyingType === "ETF") return "etf";
  if (underlyingType === "PREMARKET" || underlyingType === "PRE_IPO" || underlyingType === "PRE-IPO") return "preipo";
  if (underlyingType === "INDEX") return "index";
  if (underlyingType === "FOREX" || underlyingType === "FX") return "forex";
  if (String(item.contractType || "").toUpperCase() === "TRADIFI_PERPETUAL") return "stock";
  return "crypto";
}

/**
 * Binance Spot exchangeInfo does not expose the Futures `underlyingType` /
 * `underlyingSubType` fields.  TradFi spot instruments are nevertheless
 * published using the corresponding Futures base asset, with tokenized
 * equity wrappers suffixed by `B` and the gold wrapper published as `XAUT`.
 * Resolve those aliases against the live Futures TradFi catalog instead of
 * maintaining a stale hard-coded symbol list.
 */
export function binanceTradFiSpotAssetClass(
  baseAsset: string,
  tradFiAssetClasses: ReadonlyMap<string, TradingAssetClass>,
) {
  const normalizedBaseAsset = String(baseAsset || "").trim().toUpperCase();
  if (!normalizedBaseAsset) return null;
  const exact = tradFiAssetClasses.get(normalizedBaseAsset);
  if (exact) return exact;
  const aliasRoot = /[BT]$/.test(normalizedBaseAsset)
    ? normalizedBaseAsset.slice(0, -1)
    : "";
  return aliasRoot ? tradFiAssetClasses.get(aliasRoot) || null : null;
}

export function isBinanceTradFiContract(item: Pick<BinanceExchangeSymbol, "contractType" | "underlyingSubType" | "underlyingType">) {
  const underlyingSubTypes = binanceUnderlyingSubTypes(item);
  return String(item.contractType || "").toUpperCase() === "TRADIFI_PERPETUAL"
    || underlyingSubTypes.some((value) => String(value).trim().toLowerCase() === "tradfi");
}
interface TradingChanAnalysisResponse {
  ok?: boolean;
  error?: { code?: string; message?: string; retryable?: boolean };
  analysisPlan?: {
    narrative?: string;
    report?: string;
    drawingPatch?: TradingAiDrawingPatch;
    indicatorDrawingPatch?: TradingIndicatorAiDrawingPatch;
  };
  model?: {
    providerId?: string;
    modelId?: string;
    latencyMs?: number;
  };
}
export type TradingChanConversationPhase = "loading" | "analyzing" | "drawing" | "complete";
export interface TradingChanConversationRequest {
  analysisId?: string | null;
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
  onProgress?: (phase: TradingChanConversationPhase, message: string) => void;
}
export interface TradingChanConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  modelName: string;
}
type TradingOrderFlowAnalysisResponse = TradingChanAnalysisResponse;
export type TradingOrderFlowConversationPhase =
  | "loading"
  | "order-flow-analyzing"
  | "order-flow-drawing"
  | "order-flow-complete";
export interface TradingOrderFlowConversationRequest {
  analysisId?: string | null;
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
  onProgress?: (phase: TradingOrderFlowConversationPhase, message: string) => void;
}
export interface TradingOrderFlowConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  tradeCount: number;
  modelName: string;
}
type TradingWaveAnalysisResponse = TradingChanAnalysisResponse;
export type TradingWaveConversationPhase =
  | "loading"
  | "wave-analyzing"
  | "wave-drawing"
  | "wave-complete";
export interface TradingWaveConversationRequest {
  analysisId?: string | null;
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
  onProgress?: (phase: TradingWaveConversationPhase, message: string) => void;
}
export interface TradingWaveConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  modelName: string;
}
type TradingWyckoffAnalysisResponse = TradingChanAnalysisResponse;
export type TradingWyckoffConversationPhase =
  | "loading"
  | "wyckoff-analyzing"
  | "wyckoff-drawing"
  | "wyckoff-complete";
export interface TradingWyckoffConversationRequest {
  analysisId?: string | null;
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
  onProgress?: (phase: TradingWyckoffConversationPhase, message: string) => void;
}
export interface TradingWyckoffConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  modelName: string;
}
type TradingGeneralAnalysisResponse = TradingChanAnalysisResponse;
export type TradingGeneralConversationPhase = "loading" | "analyzing" | "drawing" | "complete";
export interface TradingGeneralConversationRequest {
  analysisId?: string | null;
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
  strategyDisplayName?: string | null;
  minimumCandles?: number | null;
  preferredCandles?: number | null;
  visibleCandlesOnly?: boolean;
  executionPlanRequested?: boolean;
  contextCandlesRequested?: boolean;
  comparisonCandlesRequested?: boolean;
  onProgress?: (phase: TradingGeneralConversationPhase, message: string) => void;
}
export interface TradingGeneralConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  modelName: string;
}
export type TradingStrategyConversationRequest = Omit<TradingChanConversationRequest, "onProgress"> & {
  strategyDisplayName?: string | null;
  minimumCandles?: number | null;
  preferredCandles?: number | null;
  visibleCandlesOnly?: boolean;
  executionPlanRequested?: boolean;
  contextCandlesRequested?: boolean;
  comparisonCandlesRequested?: boolean;
  onProgress?: (phase: string, message: string) => void;
};
export type TradingStrategyConversationResult = TradingOrderFlowConversationResult;
export type TradingPeriodUnit = "s" | "m" | "h" | "d" | "w";
type AddableTradingPeriodUnit = Extract<TradingPeriodUnit, "m" | "h" | "d">;
export interface TradingPeriod {
  amount: number;
  unit: TradingPeriodUnit;
}
export const DEFAULT_TRADING_PERIODS: ReadonlyArray<TradingPeriod> = [
  { amount: 1, unit: "w" },
  { amount: 1, unit: "d" },
  { amount: 5, unit: "m" },
  { amount: 15, unit: "m" },
  { amount: 1, unit: "h" },
  { amount: 4, unit: "h" },
] as const;
const HIDDEN_TRADING_INDICATORS: ReadonlySet<TradingIndicatorId> = new Set([
  "momentum",
  "roc",
  "obv",
  "mfi",
  "willr",
]);
export type TradingMainIndicatorId = "ma" | "ema" | "boll" | "td" | "bbi" | "vpvr";
export const TRADING_MAIN_INDICATORS: ReadonlyArray<{
  id: TradingMainIndicatorId;
  label: string;
  name: string;
  parameters: string;
}> = [
  { id: "ma", label: "MA", name: "移动平均线", parameters: "5,10,20" },
  { id: "ema", label: "EMA", name: "指数移动平均线", parameters: "5,10,20" },
  { id: "boll", label: "BOLL", name: "布林带", parameters: "20,2" },
  { id: "td", label: "TD", name: "TD序列", parameters: "9" },
  { id: "bbi", label: "BBI", name: "多空指标", parameters: "3,6,12,24" },
  { id: "vpvr", label: "VPVR", name: "可见范围成交量分布", parameters: "96" },
] as const;

type TradingIndicatorScope = "main" | "sub";
type TradingConfigurableIndicatorId = TradingMainIndicatorId | TradingIndicatorId;

export interface TradingIndicatorParameterField {
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface TradingIndicatorDisplayField {
  key: string;
  label: string;
  color: string;
  type?: "line" | "histogram" | "markers";
  defaultLineWidth?: 1 | 2 | 3;
}

export interface TradingMarketIndicatorCatalogItem {
  scope: TradingIndicatorScope;
  id: TradingConfigurableIndicatorId;
  label: string;
  name: string;
  description: string;
  parameters: readonly TradingIndicatorParameterField[];
  display: readonly TradingIndicatorDisplayField[];
}

export interface TradingIndicatorSeriesSetting {
  visible: boolean;
  color: string;
  lineWidth: 1 | 2 | 3;
}

export interface TradingIndicatorSetting {
  enabled: boolean;
  parameters: number[];
  series: Record<string, TradingIndicatorSeriesSetting>;
}

export type TradingIndicatorSettings = Record<string, TradingIndicatorSetting>;

const indicatorParameter = (
  label: string,
  defaultValue: number,
  options: Partial<Pick<TradingIndicatorParameterField, "min" | "max" | "step">> = {},
): TradingIndicatorParameterField => ({
  label,
  defaultValue,
  min: options.min ?? 1,
  max: options.max ?? 500,
  step: options.step ?? 1,
});

export const TRADING_MARKET_INDICATOR_CATALOG: readonly TradingMarketIndicatorCatalogItem[] = [
  {
    scope: "main", id: "ma", label: "MA", name: "移动平均线",
    description: "用三个不同周期的简单移动平均线观察价格趋势、支撑阻力与均线排列。",
    parameters: [indicatorParameter("短周期", 5), indicatorParameter("中周期", 10), indicatorParameter("长周期", 20)],
    display: [
      { key: "short", label: "短周期均线", color: "#d1ab2e", defaultLineWidth: 1 },
      { key: "medium", label: "中周期均线", color: "#2dccac", defaultLineWidth: 2 },
      { key: "long", label: "长周期均线", color: "#c935cc", defaultLineWidth: 1 },
    ],
  },
  {
    scope: "main", id: "ema", label: "EMA", name: "指数移动平均线",
    description: "对近期价格赋予更高权重的移动平均线，用于更灵敏地识别趋势变化。",
    parameters: [indicatorParameter("短周期", 5), indicatorParameter("中周期", 10), indicatorParameter("长周期", 20)],
    display: [
      { key: "short", label: "短周期均线", color: "#d1ab2e", defaultLineWidth: 1 },
      { key: "medium", label: "中周期均线", color: "#2dccac", defaultLineWidth: 2 },
      { key: "long", label: "长周期均线", color: "#c935cc", defaultLineWidth: 1 },
    ],
  },
  {
    scope: "main", id: "boll", label: "BOLL", name: "布林带",
    description: "由中轨移动平均线和上下波动带组成，用于观察波动率、趋势区间与价格突破。",
    parameters: [indicatorParameter("计算周期", 20), indicatorParameter("标准差倍数", 2, { min: 0.1, max: 10, step: 0.1 })],
    display: [
      { key: "upper", label: "上轨", color: "#d1ab2e", defaultLineWidth: 1 },
      { key: "middle", label: "中轨", color: "#2dccac", defaultLineWidth: 2 },
      { key: "lower", label: "下轨", color: "#c935cc", defaultLineWidth: 1 },
    ],
  },
  {
    scope: "main", id: "td", label: "TD", name: "TD序列",
    description: "连续比较当前收盘价与前四根K线收盘价，标记趋势计数并辅助识别潜在衰竭。",
    parameters: [indicatorParameter("计数周期", 9, { min: 2, max: 30 })],
    display: [
      { key: "buy", label: "买入计数", color: "#16a873", type: "markers" },
      { key: "sell", label: "卖出计数", color: "#ef5350", type: "markers" },
    ],
  },
  {
    scope: "main", id: "bbi", label: "BBI", name: "多空指标",
    description: "综合多个周期移动平均线形成一条均衡线，用于判断市场整体多空方向。",
    parameters: [indicatorParameter("周期一", 3), indicatorParameter("周期二", 6), indicatorParameter("周期三", 12), indicatorParameter("周期四", 24)],
    display: [{ key: "bbi", label: "BBI", color: "#5b95e5", defaultLineWidth: 2 }],
  },
  {
    scope: "main", id: "vpvr", label: "VPVR", name: "可见范围成交量分布",
    description: "把当前屏幕内K线的成交量按高低价覆盖范围分配到价格档位，突出70%价值区和最大成交量价位（POC）。OHLCV不含逐笔成交价，因此分档结果为区间估算。",
    parameters: [indicatorParameter("价格区间数", 96, { min: 8, max: 96 })],
    display: [
      { key: "volume", label: "成交量分布", color: "#5b95e5", type: "histogram" },
      { key: "poc", label: "最大成交量价位（POC）", color: "#5b95e5", type: "markers" },
    ],
  },
  {
    scope: "sub", id: "volume", label: "VOLUME", name: "成交量",
    description: "展示每根K线的成交量，并用两条成交量均线观察量能趋势。",
    parameters: [indicatorParameter("均线周期一", 5), indicatorParameter("均线周期二", 10)],
    display: [
      { key: "volume", label: "成交量", color: TRADING_RISING_BAR_COLOR, type: "histogram" },
      { key: "ma5", label: "均线一", color: "#22b8cf", defaultLineWidth: 1 },
      { key: "ma10", label: "均线二", color: "#e5ad25", defaultLineWidth: 1 },
    ],
  },
  {
    scope: "sub", id: "macd", label: "MACD", name: "指数平滑异同移动平均线",
    description: "通过快慢指数均线的差值、信号线和柱状图观察趋势方向与动能变化。",
    parameters: [indicatorParameter("快线周期", 12), indicatorParameter("慢线周期", 26), indicatorParameter("信号周期", 9)],
    display: [
      { key: "dif", label: "DIF", color: "#22b8cf" },
      { key: "dea", label: "DEA", color: "#e5ad25" },
      { key: "histogram", label: "MACD柱", color: TRADING_RISING_BAR_COLOR, type: "histogram" },
    ],
  },
  {
    scope: "sub", id: "rsi", label: "RSI", name: "相对强弱指标",
    description: "衡量一段周期内上涨与下跌动能的相对强弱，常用于观察超买和超卖。",
    parameters: [indicatorParameter("计算周期", 14)],
    display: [{ key: "rsi", label: "RSI", color: "#8b5cf6" }],
  },
  {
    scope: "sub", id: "kdj", label: "KDJ", name: "随机指标",
    description: "根据周期高低价与收盘价计算K、D、J三条曲线，观察短期动能和拐点。",
    parameters: [indicatorParameter("计算周期", 9), indicatorParameter("K平滑", 3), indicatorParameter("D平滑", 3)],
    display: [
      { key: "k", label: "K", color: "#22b8cf" },
      { key: "d", label: "D", color: "#e5ad25" },
      { key: "j", label: "J", color: "#8b5cf6" },
    ],
  },
  {
    scope: "sub", id: "stoch", label: "STOCH", name: "随机震荡指标",
    description: "比较收盘价在近期价格区间中的位置，并通过平滑后的K、D线观察动能。",
    parameters: [indicatorParameter("计算周期", 14), indicatorParameter("K平滑", 3), indicatorParameter("D平滑", 3)],
    display: [
      { key: "k", label: "%K", color: "#22b8cf" },
      { key: "d", label: "%D", color: "#e5ad25" },
    ],
  },
  {
    scope: "sub", id: "cci", label: "CCI", name: "顺势指标",
    description: "衡量典型价格偏离其统计均值的程度，用于识别趋势强弱和极端波动。",
    parameters: [indicatorParameter("计算周期", 20)],
    display: [{ key: "cci", label: "CCI", color: "#8b5cf6" }],
  },
  {
    scope: "sub", id: "atr", label: "ATR", name: "平均真实波幅",
    description: "统计真实波幅的平滑均值，用于衡量市场波动率而非涨跌方向。",
    parameters: [indicatorParameter("计算周期", 14)],
    display: [{ key: "atr", label: "ATR", color: "#e5ad25" }],
  },
  {
    scope: "sub", id: "adx", label: "ADX", name: "平均趋向指标",
    description: "结合ADX与正负方向指标衡量趋势强度，并辅助判断多空方向。",
    parameters: [indicatorParameter("计算周期", 14)],
    display: [
      { key: "adx", label: "ADX", color: "#e5ad25" },
      { key: "positiveDi", label: "+DI", color: "#16a873" },
      { key: "negativeDi", label: "-DI", color: "#ef5350" },
    ],
  },
  {
    scope: "sub", id: "momentum", label: "MOM", name: "动量指标",
    description: "计算当前价格与指定周期前价格的差值，用于观察价格变化速度。",
    parameters: [indicatorParameter("计算周期", 10)],
    display: [{ key: "momentum", label: "MOM", color: "#3b82f6" }],
  },
  {
    scope: "sub", id: "roc", label: "ROC", name: "变动率指标",
    description: "计算当前价格相对指定周期前价格的百分比变化，反映趋势动能。",
    parameters: [indicatorParameter("计算周期", 12)],
    display: [{ key: "roc", label: "ROC", color: "#ec4899" }],
  },
  {
    scope: "sub", id: "obv", label: "OBV", name: "能量潮",
    description: "按价格涨跌累加或扣减成交量，用于观察量价是否同步。",
    parameters: [],
    display: [{ key: "obv", label: "OBV", color: "#3b82f6" }],
  },
  {
    scope: "sub", id: "mfi", label: "MFI", name: "资金流量指标",
    description: "结合典型价格与成交量估算资金流入流出强度，常用于观察超买和超卖。",
    parameters: [indicatorParameter("计算周期", 14)],
    display: [{ key: "mfi", label: "MFI", color: "#16a873" }],
  },
  {
    scope: "sub", id: "willr", label: "W%R", name: "威廉指标",
    description: "衡量收盘价在近期最高价与最低价区间中的相对位置。",
    parameters: [indicatorParameter("计算周期", 14)],
    display: [{ key: "willr", label: "W%R", color: "#22b8cf" }],
  },
] as const;

const tradingIndicatorSettingKey = (scope: TradingIndicatorScope, id: TradingConfigurableIndicatorId) =>
  `${scope}:${id}`;

function defaultTradingIndicatorSettings(): TradingIndicatorSettings {
  return Object.fromEntries(TRADING_MARKET_INDICATOR_CATALOG.map((indicator) => [
    tradingIndicatorSettingKey(indicator.scope, indicator.id),
    {
      enabled: indicator.scope === "sub" && indicator.id === "volume",
      parameters: indicator.parameters.map((parameter) => parameter.defaultValue),
      series: Object.fromEntries(indicator.display.map((series) => [series.key, {
        visible: true,
        color: series.color,
        lineWidth: series.defaultLineWidth ?? 2,
      }])),
    },
  ]));
}

function cloneTradingIndicatorSettings(settings: TradingIndicatorSettings): TradingIndicatorSettings {
  return Object.fromEntries(Object.entries(settings).map(([key, setting]) => [key, {
    enabled: setting.enabled,
    parameters: [...setting.parameters],
    series: Object.fromEntries(Object.entries(setting.series).map(([seriesKey, series]) => [
      seriesKey,
      { ...series },
    ])),
  }]));
}

export function normalizeTradingIndicatorSettings(value: unknown): TradingIndicatorSettings {
  const defaults = defaultTradingIndicatorSettings();
  if (!value || typeof value !== "object") return defaults;
  const saved = value as Record<string, unknown>;
  TRADING_MARKET_INDICATOR_CATALOG.forEach((indicator) => {
    const key = tradingIndicatorSettingKey(indicator.scope, indicator.id);
    const fallback = defaults[key];
    const candidate = saved[key];
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    const rawParameters = Array.isArray(record.parameters) ? record.parameters : [];
    const parameters = indicator.parameters.map((field, index) => {
      const raw = Number(rawParameters[index]);
      if (!Number.isFinite(raw)) return field.defaultValue;
      const bounded = Math.min(Math.max(raw, field.min), field.max);
      return field.step >= 1 ? Math.round(bounded) : Math.round(bounded / field.step) * field.step;
    });
    const rawSeries = record.series && typeof record.series === "object"
      ? record.series as Record<string, unknown>
      : {};
    const series = Object.fromEntries(indicator.display.map((field) => {
      const savedSeries = rawSeries[field.key];
      const savedRecord = savedSeries && typeof savedSeries === "object"
        ? savedSeries as Record<string, unknown>
        : {};
      const color = typeof savedRecord.color === "string" && /^#[0-9a-f]{6}$/i.test(savedRecord.color)
        ? savedRecord.color
        : fallback.series[field.key].color;
      const lineWidth = [1, 2, 3].includes(Number(savedRecord.lineWidth))
        ? Number(savedRecord.lineWidth) as 1 | 2 | 3
        : fallback.series[field.key].lineWidth;
      return [field.key, {
        visible: typeof savedRecord.visible === "boolean" ? savedRecord.visible : true,
        color,
        lineWidth,
      }];
    }));
    defaults[key] = {
      enabled: record.enabled === true,
      parameters,
      series,
    };
  });
  return defaults;
}

export function migrateTradingVolumeReferenceStyle(
  settings: TradingIndicatorSettings,
): TradingIndicatorSettings {
  const migrated = cloneTradingIndicatorSettings(settings);
  const volumeSeries = migrated[tradingIndicatorSettingKey("sub", "volume")]?.series;
  ["ma5", "ma10"].forEach((seriesKey) => {
    const series = volumeSeries?.[seriesKey];
    if (series?.lineWidth === 2) series.lineWidth = 1;
  });
  return migrated;
}

export function migrateTradingBarColors(
  settings: TradingIndicatorSettings,
): TradingIndicatorSettings {
  const migrated = cloneTradingIndicatorSettings(settings);
  [
    ["sub:volume", "volume"],
    ["sub:macd", "histogram"],
  ].forEach(([settingKey, seriesKey]) => {
    const series = migrated[settingKey]?.series[seriesKey];
    if (series?.color.toLowerCase() === "#16a873") series.color = TRADING_RISING_BAR_COLOR;
  });
  return migrated;
}

export function migrateTradingVpvrDefaults(
  settings: TradingIndicatorSettings,
): TradingIndicatorSettings {
  const migrated = cloneTradingIndicatorSettings(settings);
  const vpvr = migrated[tradingIndicatorSettingKey("main", "vpvr")];
  if (vpvr?.parameters[0] === 32) vpvr.parameters[0] = 96;
  if (vpvr?.series.poc?.color.toLowerCase() === "#f59e0b") {
    vpvr.series.poc.color = "#5b95e5";
  }
  return migrated;
}

const BINANCE_INTERVAL_MS: Readonly<Record<string, number>> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};
const TRADING_PERIOD_UNIT_MS: Record<TradingPeriodUnit, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
const TRADING_PERIOD_UNIT_LABEL: Record<TradingPeriodUnit, string> = {
  s: "秒",
  m: "分",
  h: "时",
  d: "日",
  w: "周",
};
const CHINA_TIME_OFFSET_SECONDS = 8 * 60 * 60;

export function tradingViewResolution(period: TradingPeriod) {
  const amount = Math.max(1, Math.trunc(period.amount));
  if (period.unit === "s") return `${amount}S`;
  if (period.unit === "m") return String(amount);
  if (period.unit === "h") return String(amount * 60);
  if (period.unit === "d") return `${amount}D`;
  return `${amount}W`;
}

export function tradingPeriodFromResolution(resolution: string): TradingPeriod | null {
  const normalized = String(resolution || "").trim().toUpperCase();
  const match = /^(\d+)([SDW]?)$/.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) return null;
  if (match[2] === "S") return { amount, unit: "s" };
  if (match[2] === "D") return { amount, unit: "d" };
  if (match[2] === "W") return { amount, unit: "w" };
  return amount % 60 === 0
    ? { amount: amount / 60, unit: "h" }
    : { amount, unit: "m" };
}

export function tradingAlertIntervalFromResolution(resolution: string) {
  const period = tradingPeriodFromResolution(resolution);
  return period ? `${period.amount}${period.unit}` : String(resolution || "").trim().toLowerCase();
}

export function tradingResolutionFromAlertInterval(interval: string) {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(String(interval || "").trim());
  if (!match) return String(interval || "").trim().toUpperCase();
  return tradingViewResolution({ amount: Number(match[1]), unit: match[2].toLowerCase() as TradingPeriodUnit });
}

export function tradingCandleSeriesMatchesResolution(
  candles: ReadonlyArray<{ time: number }>,
  resolution: string,
) {
  const expectedStepSeconds = (tradingViewResolutionDurationMs(resolution) || 0) / 1_000;
  if (!expectedStepSeconds || candles.length < 2) return false;
  const orderedTimes = [...new Set(candles
    .map((candle) => Number(candle.time))
    .filter((time) => Number.isFinite(time) && time > 0))]
    .sort((first, second) => first - second);
  const recentTimes = orderedTimes.slice(-32);
  const steps = recentTimes.slice(1).map((time, index) => time - recentTimes[index]);
  if (!steps.length) return false;
  const exactSteps = steps.filter((step) => step === expectedStepSeconds).length;
  return exactSteps >= Math.ceil(steps.length * 0.8);
}

export function ifindSupportsTradingResolution(resolution: string) {
  // The current Haolo iFinD proxy is backed by cmd_history_quotation, whose
  // desktop contract exposes daily and weekly bars.  iFinD's separate
  // high_frequency endpoint can support minute bars, but enabling those
  // periods here before the proxy advertises that capability would turn a
  // selectable period into a guaranteed upstream error.
  return /^\d+[DW]$/i.test(String(resolution || "").trim());
}

export function tradingPeriodLabel(period: TradingPeriod) {
  return `${Math.max(1, Math.trunc(period.amount))}${TRADING_PERIOD_UNIT_LABEL[period.unit]}`;
}

export function tradingPeriodDurationMs(period: TradingPeriod) {
  return Math.max(1, Math.trunc(period.amount)) * TRADING_PERIOD_UNIT_MS[period.unit];
}

function isTradingPeriod(value: unknown): value is TradingPeriod {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TradingPeriod>;
  return Number.isInteger(candidate.amount)
    && Number(candidate.amount) >= 1
    && Number(candidate.amount) <= 10_000
    && ["s", "m", "h", "d", "w"].includes(String(candidate.unit));
}

export function normalizeTradingPeriods(value: unknown): TradingPeriod[] {
  if (!Array.isArray(value)) return DEFAULT_TRADING_PERIODS.map((period) => ({ ...period }));
  const resolutions = new Set<string>();
  const periods: TradingPeriod[] = [];
  value.forEach((candidate) => {
    if (!isTradingPeriod(candidate) || periods.length >= MAX_TRADING_PERIODS) return;
    const period = { amount: candidate.amount, unit: candidate.unit };
    const resolution = tradingViewResolution(period);
    if (resolutions.has(resolution)) return;
    resolutions.add(resolution);
    periods.push(period);
  });
  return periods.length
    ? periods
    : DEFAULT_TRADING_PERIODS.map((period) => ({ ...period }));
}

export function loadTradingPeriodsFromStorage(storage: Pick<Storage, "getItem">) {
  try {
    const saved = storage.getItem(TRADING_PERIODS_STORAGE_KEY);
    return saved
      ? normalizeTradingPeriods(JSON.parse(saved))
      : cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
  } catch {
    return cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
  }
}

export function normalizeTradingFavoriteSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const symbols = new Set<string>();
  value.forEach((candidate) => {
    if (symbols.size >= MAX_TRADING_FAVORITES || typeof candidate !== "string") return;
    const symbol = candidate.trim().toUpperCase();
    if (
      !/^[A-Z0-9]{2,40}$/.test(symbol)
      && !/^(?:BINANCE|FINNHUB|IFIND):[A-Z0-9^][A-Z0-9^:._/\-=]{0,96}$/.test(symbol)
    ) return;
    symbols.add(symbol);
  });
  return [...symbols];
}

export function reorderTradingFavoriteRecords(
  records: ReadonlyArray<TradingFavoriteMarketRecord>,
  orderedMarketIds: ReadonlyArray<string>,
) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const orderedRecords = orderedMarketIds.flatMap((candidate) => {
    const marketId = String(candidate || "").trim().toUpperCase();
    const record = recordsById.get(marketId);
    if (!record || seen.has(marketId)) return [];
    seen.add(marketId);
    return [record];
  });
  if (orderedRecords.length < 2) return [...records];
  let orderedIndex = 0;
  return records.map((record) => (
    seen.has(record.id) ? orderedRecords[orderedIndex++] : record
  ));
}

type TradingFavoritesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function tradingFavoriteStorageKeys(accountIdentity = "") {
  const normalizedIdentity = String(accountIdentity || "").trim().toLowerCase();
  const accountSuffix = normalizedIdentity
    ? `.account.${encodeURIComponent(normalizedIdentity)}`
    : "";
  return {
    symbols: `${TRADING_FAVORITES_STORAGE_KEY}${accountSuffix}`,
    records: `${TRADING_FAVORITE_MARKETS_STORAGE_KEY}${accountSuffix}`,
    legacySymbols: TRADING_FAVORITES_STORAGE_KEY,
    legacyRecords: TRADING_FAVORITE_MARKETS_STORAGE_KEY,
  };
}

function normalizeTradingFavoriteMarketRecords(value: unknown): TradingFavoriteMarketRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, TradingFavoriteMarketRecord>();
  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || records.size >= MAX_TRADING_FAVORITES) return;
    const item = candidate as Partial<TradingFavoriteMarketRecord>;
    const provider = item.provider === "finnhub"
      ? "finnhub"
      : item.provider === "ifind"
        ? "ifind"
        : item.provider === "binance"
          ? "binance"
          : null;
    const symbol = String(item.symbol || "").trim().toUpperCase();
    const id = String(item.id || "").trim().toUpperCase();
    if (!provider || !symbol || !id || !/^(?:BINANCE|FINNHUB|IFIND):[A-Z0-9^][A-Z0-9^:._/\-=]{0,96}$/.test(id)) return;
    // iFinD is an A-share-only provider.  Treat older persisted records that
    // used the generic `stock` class as A shares so they move into the new
    // category instead of disappearing from the picker.
    const assetClass: TradingAssetClass = provider === "ifind"
      ? "a-share"
      : normalizeTradingAssetClass(item.assetClass, provider === "binance" ? "crypto" : "stock");
    const marketType: TradingMarketType = provider !== "binance"
      ? "global"
      : item.marketType === "spot" || item.tag === "现货"
        ? "spot"
        : "perpetual";
    const displaySymbol = String(item.displaySymbol || symbol).trim().slice(0, 96) || symbol;
    records.set(id, {
      id,
      provider,
      symbol,
      baseAsset: String(item.baseAsset || displaySymbol).trim().slice(0, 96) || displaySymbol,
      quoteAsset: String(item.quoteAsset || "").trim().slice(0, 24),
      displaySymbol,
      description: String(item.description || displaySymbol).replace(/[\r\n\0]+/g, " ").trim().slice(0, 160),
      venue: provider === "ifind"
        ? abbreviateIfindVenue(item.venue || "A股市场")
        : String(item.venue || (provider === "binance" ? MARKET_VENUE : "Finnhub"))
          .replace(/[\r\n\0]+/g, " ").trim().slice(0, 80),
      assetClass,
      marketType,
      tag: String(item.tag || (provider === "binance" ? "永续" : provider === "ifind" ? "A股" : "股票"))
        .replace(/[\r\n\0]+/g, " ").trim().slice(0, 24),
    });
  });
  return [...records.values()];
}

export function loadTradingFavoritesFromStorage(
  storage: Pick<TradingFavoritesStorage, "getItem">,
  accountIdentity = "",
): TradingFavoritesStorageSnapshot {
  const keys = tradingFavoriteStorageKeys(accountIdentity);
  const accountScoped = keys.symbols !== keys.legacySymbols;
  const scopedSymbols = storage.getItem(keys.symbols);
  const scopedRecords = storage.getItem(keys.records);
  const legacySymbols = accountScoped && scopedSymbols === null
    ? storage.getItem(keys.legacySymbols)
    : null;
  const legacyRecords = accountScoped && scopedRecords === null
    ? storage.getItem(keys.legacyRecords)
    : null;
  const rawSymbols = scopedSymbols ?? legacySymbols;
  const rawRecords = scopedRecords ?? legacyRecords;
  if (rawSymbols === null && rawRecords === null) {
    const records = DEFAULT_TRADING_FAVORITE_SYMBOLS
      .map((symbol) => tradingFavoriteRecord(defaultBinancePerpetualMarket(symbol)));
    return {
      symbols: records.map((record) => record.id),
      records,
      migratedFromLegacy: false,
    };
  }
  return {
    symbols: normalizeTradingFavoriteSymbols(rawSymbols ? JSON.parse(rawSymbols) : []),
    records: normalizeTradingFavoriteMarketRecords(rawRecords ? JSON.parse(rawRecords) : []),
    migratedFromLegacy: legacySymbols !== null || legacyRecords !== null,
  };
}

export function saveTradingFavoritesToStorage(
  storage: Pick<TradingFavoritesStorage, "setItem" | "removeItem">,
  accountIdentity: string,
  snapshot: Pick<TradingFavoritesStorageSnapshot, "symbols" | "records">,
  options: { removeLegacy?: boolean } = {},
) {
  const keys = tradingFavoriteStorageKeys(accountIdentity);
  const symbols = normalizeTradingFavoriteSymbols(snapshot.symbols);
  const symbolSet = new Set(symbols);
  const records = normalizeTradingFavoriteMarketRecords(snapshot.records)
    .filter((record) => symbolSet.has(record.id));
  storage.setItem(keys.symbols, JSON.stringify(symbols));
  storage.setItem(keys.records, JSON.stringify(records));
  if (options.removeLegacy && keys.symbols !== keys.legacySymbols) {
    storage.removeItem(keys.legacySymbols);
    storage.removeItem(keys.legacyRecords);
  }
}

function tradingFavoriteRecord(market: TradingMarket): TradingFavoriteMarketRecord {
  return {
    id: market.id,
    provider: market.provider,
    symbol: market.symbol,
    baseAsset: market.baseAsset,
    quoteAsset: market.quoteAsset,
    displaySymbol: market.displaySymbol,
    description: market.description,
    venue: market.venue,
    assetClass: market.assetClass,
    marketType: market.marketType,
    tag: market.tag,
  };
}

function marketFromFavoriteRecord(record: TradingFavoriteMarketRecord): TradingMarket {
  return { ...record, markPrice: 0, changePercent: 0, volume24h: 0, quoteAvailable: false };
}

type TradingLastAnalysisContextStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type TradingLastDrawingWorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type TradingAlertSimulationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeTradingAnalysisStorageSessionId(value: unknown) {
  return String(value ?? "").trim() || "trading-expert-unassigned";
}

export function tradingLastAnalysisContextStorageKey(storageSessionId: string) {
  return `${TRADING_LAST_ANALYSIS_CONTEXT_STORAGE_KEY_PREFIX}${encodeURIComponent(normalizeTradingAnalysisStorageSessionId(storageSessionId))}`;
}

export function tradingLastDrawingWorkspaceStorageKey(storageSessionId: string) {
  return `${TRADING_LAST_DRAWING_WORKSPACE_STORAGE_KEY_PREFIX}${encodeURIComponent(normalizeTradingAnalysisStorageSessionId(storageSessionId))}`;
}

export function tradingAlertSimulationStorageKey(storageSessionId: string) {
  return `${TRADING_ALERT_SIMULATION_STORAGE_KEY_PREFIX}${encodeURIComponent(normalizeTradingAnalysisStorageSessionId(storageSessionId))}`;
}

const TRADING_ALERT_SIMULATION_PANE_INDICATORS = new Set([
  "volume", "macd", "rsi", "kdj", "atr", "cci", "adx", "momentum", "roc",
]);

function positiveSimulationIndicatorParameter(value: unknown, fallback: number, integer = true) {
  const numeric = Number(value);
  const bounded = Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, 100_000) : fallback;
  return integer ? Math.max(1, Math.round(bounded)) : bounded;
}

function simulationIndicatorParameters(expression: any) {
  const name = String(expression?.name || "").toLowerCase();
  const params = expression?.params || {};
  if (["sma", "ma", "ema"].includes(name)) {
    return [positiveSimulationIndicatorParameter(params.period, 5)];
  }
  if (name === "boll") {
    return [
      positiveSimulationIndicatorParameter(params.period, 20),
      positiveSimulationIndicatorParameter(params.multiplier, 2, false),
    ];
  }
  if (name === "macd") {
    return [
      positiveSimulationIndicatorParameter(params.fast, 12),
      positiveSimulationIndicatorParameter(params.slow, 26),
      positiveSimulationIndicatorParameter(params.signal, 9),
    ];
  }
  if (name === "kdj") {
    return [
      positiveSimulationIndicatorParameter(params.period, 9),
      positiveSimulationIndicatorParameter(params.smoothK, 3),
      positiveSimulationIndicatorParameter(params.smoothD, 3),
    ];
  }
  const fallback = name === "cci" ? 20 : name === "momentum" ? 10 : name === "roc" ? 12 : 14;
  return [positiveSimulationIndicatorParameter(params.period, fallback)];
}

function simulationIndicatorExpressionLabel(expression: any): string {
  if (expression?.type === "constant") {
    return Number(expression.value) === 0 ? "0轴" : String(expression.value);
  }
  if (expression?.type === "field") {
    return expression.field === "volume" ? "VOLUME" : String(expression.field || "条件").toUpperCase();
  }
  if (expression?.type === "lag") {
    return `${positiveSimulationIndicatorParameter(expression.bars, 1)}根前${simulationIndicatorExpressionLabel(expression.expr)}`;
  }
  if (expression?.type === "rolling") {
    const period = positiveSimulationIndicatorParameter(expression.period, 1);
    const offset = Math.max(0, Math.round(Number(expression.offset) || 0));
    const source: string = simulationIndicatorExpressionLabel(expression.expr);
    const operation = { min: "最小", max: "最大", avg: "平均", sum: "合计" }[String(expression.op)] || "滚动";
    return `${offset === 1 ? "前" : offset > 1 ? `${offset}根前起` : "最近"}${period}根${operation}${source === "VOLUME" ? "量" : source}`;
  }
  if (expression?.type === "math") {
    const labels = (Array.isArray(expression.args) ? expression.args : []).map(simulationIndicatorExpressionLabel);
    if (expression.op === "mul") return labels.join("×");
    if (expression.op === "div") return labels.join("÷");
    if (expression.op === "add") return labels.join("+");
    if (expression.op === "sub") return labels.join("-");
    if (expression.op === "max") return `最大值(${labels.join("、")})`;
    if (expression.op === "min") return `最小值(${labels.join("、")})`;
    return labels.length ? labels.join("、") : "条件";
  }
  if (expression?.type !== "indicator") return "条件";
  const name = String(expression.name || "").toLowerCase();
  const parameters = simulationIndicatorParameters(expression);
  if (["sma", "ma"].includes(name)) return `MA${parameters[0]}`;
  if (name === "ema") return `EMA${parameters[0]}`;
  if (name === "boll") {
    const output = { upper: "上轨", middle: "中轨", lower: "下轨" }[String(expression.output || "middle")];
    return `BOLL${parameters[0]}${output || ""}`;
  }
  const output = String(expression.output || "").toUpperCase();
  return `${name.toUpperCase()}${output && !["VALUE", name.toUpperCase()].includes(output) ? ` ${output}` : ""}`;
}

function simulationIndicatorTriggerLabel(condition: any) {
  const left = simulationIndicatorExpressionLabel(condition?.left);
  const right = simulationIndicatorExpressionLabel(condition?.right);
  if (
    condition?.operator === "cross_under"
    && /^MA\d+/i.test(left)
    && /^MA\d+/i.test(right)
  ) return `${left}/${right}死叉`;
  if (
    condition?.operator === "cross_over"
    && /^MA\d+/i.test(left)
    && /^MA\d+/i.test(right)
  ) return `${left}/${right}金叉`;
  const operatorLabel: Record<string, string> = {
    cross_under: "下穿",
    cross_over: "上穿",
    break_below: "跌破",
    break_above: "突破",
    lt: "低于",
    lte: "不高于",
    gt: "高于",
    gte: "不低于",
    eq: "等于",
    neq: "不等于",
    touch: "触碰",
  };
  return `${left}${operatorLabel[String(condition?.operator)] || "满足"}${right}`;
}

function tradingAlertExpressionContainsIndicatorOrVolume(expression: any): boolean {
  if (!expression || typeof expression !== "object") return false;
  if (expression.type === "indicator") return true;
  if (expression.type === "field" && expression.field === "volume") return true;
  if (expression.expr && tradingAlertExpressionContainsIndicatorOrVolume(expression.expr)) return true;
  return (Array.isArray(expression.args) ? expression.args : [])
    .some(tradingAlertExpressionContainsIndicatorOrVolume);
}

/**
 * Extracts the exact indicator families and parameters from the normalized
 * alert rule. The chart never guesses these values from conversation text;
 * they are the same expressions that the deterministic Evaluator verified.
 */
function tradingAlertSimulationLeafConditions(node: any, result: any[] = []) {
  if (!node || typeof node !== "object") return result;
  if (node.type === "condition" && node.condition) result.push(node.condition);
  if (node.child) tradingAlertSimulationLeafConditions(node.child, result);
  (Array.isArray(node.children) ? node.children : []).forEach((child: any) => tradingAlertSimulationLeafConditions(child, result));
  (Array.isArray(node.steps) ? node.steps : []).forEach((step: any) => tradingAlertSimulationLeafConditions(step, result));
  return result;
}

function tradingAlertSimulationContextsShareChart(rule: any, firstContextId: string, secondContextId: string) {
  if (firstContextId === secondContextId) return true;
  const contexts = new Map<string, any>((Array.isArray(rule?.contexts) ? rule.contexts : [])
    .map((context: any) => [String(context?.contextId || ""), context]));
  const first = contexts.get(firstContextId);
  const second = contexts.get(secondContextId);
  if (!first || !second) return false;
  const firstInterval = String(first.intervals?.[0] || "").toLowerCase();
  const secondInterval = String(second.intervals?.[0] || "").toLowerCase();
  if (!firstInterval || firstInterval !== secondInterval) return false;
  const marketId = (context: any) => String(
    context?.drawingBinding?.marketId
      || context?.marketSelector?.marketIds?.[0]
      || (context?.marketSelector?.kind === "current" ? "current" : ""),
  ).toUpperCase();
  const firstMarket = marketId(first);
  const secondMarket = marketId(second);
  return firstMarket === secondMarket || firstMarket === "CURRENT" || secondMarket === "CURRENT";
}

function tradingAlertSimulationDrawingLabel(conditions: any[]) {
  const operators = new Set(conditions.map((condition) => String(condition?.operator || "")));
  const priceFields = conditions.flatMap((condition) => [condition?.left, condition?.right])
    .filter((expression) => expression?.type === "field")
    .map((expression) => expression.field);
  if (operators.has("touch") || (
    priceFields.includes("high")
    && priceFields.includes("low")
  )) return "K线触碰趋势线";
  if (operators.has("break_above") || operators.has("cross_over")) return "K线向上突破趋势线";
  if (operators.has("break_below") || operators.has("cross_under")) return "K线向下突破趋势线";
  return "K线趋势线条件满足";
}

function tradingAlertSimulationActiveConditionIds(rule: any, proof: any): string[] {
  const traces = new Map<string, any>((Array.isArray(proof?.trace) ? proof.trace : [])
    .map((entry: any) => [String(entry?.conditionId || ""), entry]));
  const visit = (node: any): string[] | null => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "condition") {
      const conditionId = String(node.condition?.conditionId || "");
      return traces.get(conditionId)?.value === true ? [conditionId] : null;
    }
    if (node.type === "all") {
      const children: Array<string[] | null> = (node.children || []).map(visit);
      return children.every(Boolean) ? children.flatMap((entry) => entry || []) : null;
    }
    if (node.type === "any") {
      const children = (node.children || []).map(visit).filter(Boolean) as string[][];
      return children.length ? children.flat() : null;
    }
    if (node.type === "not") return null;
    if (node.type === "sequence") {
      const steps = (node.steps || []).map(visit).filter(Boolean) as string[][];
      return steps.length ? steps.flat() : null;
    }
    return visit(node.child);
  };
  return [...new Set(visit(rule?.root) || [])];
}

function tradingAlertSimulationLegacyDrawingPoints(rule: any, simulation: any, anchorContextId: string) {
  const conditionMap = new Map<string, any>(tradingAlertSimulationLeafConditions(rule?.root)
    .map((condition: any) => [String(condition?.conditionId || ""), condition]));
  const traceMap = new Map<string, any>((Array.isArray(simulation?.proof?.trace) ? simulation.proof.trace : [])
    .map((entry: any) => [String(entry?.conditionId || ""), entry]));
  const grouped = new Map<string, any>();
  tradingAlertSimulationActiveConditionIds(rule, simulation?.proof).forEach((conditionId) => {
    const condition = conditionMap.get(conditionId);
    const trace = traceMap.get(conditionId);
    const drawing = condition?.left?.type === "drawing"
      ? condition.left
      : condition?.right?.type === "drawing" ? condition.right : null;
    if (!drawing || !trace) return;
    const price = Number(condition.left?.type === "drawing" ? trace.left : trace.right);
    const contextId = String(condition.contextId || anchorContextId);
    const generated = Array.isArray(simulation?.generated?.[contextId])
      ? simulation.generated[contextId]
      : simulation?.generated?.[anchorContextId];
    const candle = generated?.[Math.max(0, Math.trunc(Number(simulation?.triggerBarIndex || 0)))];
    const time = Number(candle?.time);
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) return;
    const key = `${contextId}|${drawing.drawingId}|${time}|${price}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.conditionIds.push(conditionId);
      return;
    }
    grouped.set(key, {
      kind: "drawing",
      contextId,
      drawingId: drawing.drawingId,
      conditionId,
      conditionIds: [conditionId],
      time,
      price,
    });
  });
  return [...grouped.values()];
}

export function collectTradingAlertSimulationConditionAnnotations(rule: any, simulation: any, anchorContextId: string) {
  const conditions = new Map<string, any>(tradingAlertSimulationLeafConditions(rule?.root)
    .map((condition: any) => [String(condition.conditionId || ""), condition]));
  const rawPoints: any[] = Array.isArray(simulation?.triggerPoints) && simulation.triggerPoints.length
    ? simulation.triggerPoints
    : simulation?.triggerPoint
      ? [simulation.triggerPoint]
      : tradingAlertSimulationLegacyDrawingPoints(rule, simulation, anchorContextId);
  const collected: TradingAlertSimulationConditionAnnotationSpec[] = rawPoints.slice(0, 64).flatMap((point: any, index: number): TradingAlertSimulationConditionAnnotationSpec[] => {
    const contextId = String(point?.contextId || anchorContextId);
    if (!tradingAlertSimulationContextsShareChart(rule, contextId, anchorContextId)) return [];
    const conditionIds: string[] = [...new Set<string>((Array.isArray(point?.conditionIds)
      ? point.conditionIds
      : [point?.conditionId])
      .map((entry: unknown) => String(entry || "").trim())
      .filter(Boolean))];
    const groupedConditions = conditionIds.map((conditionId) => conditions.get(conditionId)).filter(Boolean);
    const time = Number(point?.time);
    const price = Number(point?.price);
    if (!conditionIds.length || !Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) return [];
    const isDrawing = point?.kind === "drawing" || groupedConditions.some((condition) => (
      condition?.left?.type === "drawing" || condition?.right?.type === "drawing"
    ));
    const triggerLabel = isDrawing
      ? tradingAlertSimulationDrawingLabel(groupedConditions)
      : simulationIndicatorTriggerLabel(groupedConditions[0]);
    return [{
      annotationId: `condition:${String(point?.drawingId || point?.conditionId || index)}`.slice(0, 180),
      label: `模拟触发 · ${triggerLabel}`.slice(0, 140),
      conditionIds,
      time: time / 1_000 + CHINA_TIME_OFFSET_SECONDS,
      price,
    }];
  });
  const counts = new Map<string, number>();
  collected.forEach((entry) => counts.set(entry.label, (counts.get(entry.label) || 0) + 1));
  const indexes = new Map<string, number>();
  return collected.map((entry) => {
    if ((counts.get(entry.label) || 0) < 2) return entry;
    const next = (indexes.get(entry.label) || 0) + 1;
    indexes.set(entry.label, next);
    return { ...entry, label: `${entry.label} ${next}` };
  });
}

export function collectTradingAlertSimulationIndicators(
  rule: any,
  anchorContextId: string,
  activeConditionIds?: Iterable<string>,
) {
  const collected = new Map<string, TradingAlertSimulationIndicatorSpec>();
  const active = activeConditionIds ? new Set([...activeConditionIds].map(String)) : null;
  const visitExpression = (expression: any, condition: any) => {
    if (!expression || typeof expression !== "object") return;
    if (expression.type === "math") {
      (Array.isArray(expression.args) ? expression.args : []).forEach((argument: any) => visitExpression(argument, condition));
      return;
    }
    if (["lag", "rolling"].includes(expression.type)) {
      visitExpression(expression.expr, condition);
      return;
    }
    const isVolumeField = expression.type === "field" && expression.field === "volume";
    if (expression.type !== "indicator" && !isVolumeField) return;
    const sourceName = isVolumeField ? "volume" : String(expression.name || "").toLowerCase();
    const name = sourceName === "sma" ? "ma" : sourceName;
    const placement: TradingAlertSimulationIndicatorPlacement = ["ma", "ema", "boll"].includes(name)
      ? "main"
      : TRADING_ALERT_SIMULATION_PANE_INDICATORS.has(name) ? "pane" : "main";
    if (!["ma", "ema", "boll"].includes(name) && !TRADING_ALERT_SIMULATION_PANE_INDICATORS.has(name)) return;
    const parameters = name === "volume" ? [5, 10] : simulationIndicatorParameters({ ...expression, name });
    const specId = `${placement}:${name}:${parameters.join(":")}`;
    const conditionId = String(condition?.conditionId || "").trim();
    const trigger = { label: simulationIndicatorTriggerLabel(condition), conditionIds: conditionId ? [conditionId] : [] };
    const existing = collected.get(specId);
    if (existing) {
      if (conditionId && !existing.conditionIds.includes(conditionId)) existing.conditionIds.push(conditionId);
      existing.triggers ||= [{ label: existing.triggerLabel, conditionIds: existing.conditionIds.slice(0, 1) }];
      if (conditionId && !existing.triggers.some((entry) => entry.conditionIds.includes(conditionId))) existing.triggers.push(trigger);
      return;
    }
    const familyLabel = name === "ma" ? "MA" : name === "ema" ? "EMA" : name.toUpperCase();
    collected.set(specId, {
      specId,
      name,
      label: familyLabel,
      placement,
      parameters,
      conditionIds: conditionId ? [conditionId] : [],
      triggerLabel: trigger.label,
      triggers: [trigger],
    });
  };
  const visitNode = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "condition"
      && (!active || active.has(String(node.condition?.conditionId || "")))
      && tradingAlertSimulationContextsShareChart(rule, String(node.condition?.contextId || ""), anchorContextId)
    ) {
      visitExpression(node.condition.left, node.condition);
      visitExpression(node.condition.right, node.condition);
    }
    if (node.child) visitNode(node.child);
    (Array.isArray(node.children) ? node.children : []).forEach(visitNode);
    (Array.isArray(node.steps) ? node.steps : []).forEach(visitNode);
  };
  visitNode(rule?.root);
  return [...collected.values()]
    .sort((first, second) => first.placement.localeCompare(second.placement)
      || first.name.localeCompare(second.name)
      || first.parameters[0] - second.parameters[0]);
}

function normalizeTradingAlertSimulationIndicatorSpecs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap<TradingAlertSimulationIndicatorSpec>((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const candidate = raw as Partial<TradingAlertSimulationIndicatorSpec>;
    const name = String(candidate.name || "").trim().toLowerCase();
    const placement = candidate.placement === "main" || candidate.placement === "pane"
      ? candidate.placement
      : null;
    const parameters = Array.isArray(candidate.parameters)
      ? candidate.parameters.slice(0, 8).map(Number)
      : [];
    if (
      !placement
      || !["ma", "ema", "boll", ...TRADING_ALERT_SIMULATION_PANE_INDICATORS].includes(name)
      || !parameters.length
      || parameters.some((parameter) => !Number.isFinite(parameter) || parameter <= 0)
    ) return [];
    const specId = String(candidate.specId || `${placement}:${name}:${parameters.join(":")}`).slice(0, 180);
    const conditionIds = Array.isArray(candidate.conditionIds)
      ? [...new Set(candidate.conditionIds.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(0, 16)
      : [];
    const triggerLabel = String(candidate.triggerLabel || "指标模拟触发").slice(0, 120);
    const triggers = Array.isArray(candidate.triggers)
      ? candidate.triggers.slice(0, 32).flatMap((rawTrigger) => {
          const label = String(rawTrigger?.label || "").trim().slice(0, 120);
          const ids = Array.isArray(rawTrigger?.conditionIds)
            ? [...new Set(rawTrigger.conditionIds.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(0, 16)
            : [];
          return label && ids.length ? [{ label, conditionIds: ids }] : [];
        })
      : [];
    return [{
      specId,
      name,
      label: String(candidate.label || name.toUpperCase()).slice(0, 40),
      placement,
      parameters,
      conditionIds,
      triggerLabel,
      triggers: triggers.length ? triggers : [{ label: triggerLabel, conditionIds }],
    }];
  });
}

function normalizeTradingAlertSimulationConditionAnnotations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).flatMap<TradingAlertSimulationConditionAnnotationSpec>((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const candidate = raw as Partial<TradingAlertSimulationConditionAnnotationSpec>;
    const annotationId = String(candidate.annotationId || "").trim().slice(0, 180);
    const label = String(candidate.label || "").trim().slice(0, 140);
    const conditionIds = Array.isArray(candidate.conditionIds)
      ? [...new Set(candidate.conditionIds.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(0, 16)
      : [];
    const time = Number(candidate.time);
    const price = Number(candidate.price);
    if (!annotationId || !label || !conditionIds.length || !Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) return [];
    return [{ annotationId, label, conditionIds, time, price }];
  });
}

function normalizeTradingAlertSimulationState(value: unknown): TradingAlertSimulationState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TradingAlertSimulationState>;
  const simulationId = String(candidate.simulationId || "").trim();
  const marketId = String(candidate.marketId || "").trim().toUpperCase();
  const interval = String(candidate.interval || "").trim().toUpperCase();
  const market = normalizeTradingFavoriteMarketRecords(candidate.market ? [candidate.market] : [])[0] || null;
  if (
    Number(candidate.schemaVersion) !== 1
    || !simulationId
    || simulationId.length > 160
    || !/^(?:BINANCE|FINNHUB|IFIND):[A-Z0-9^][A-Z0-9^:._\/\-=]{0,96}$/.test(marketId)
    || !tradingViewResolutionDurationMs(interval)
    || (market && market.id !== marketId)
    || !Array.isArray(candidate.display)
    || candidate.display.length < 1
    || candidate.display.length > 500
  ) return null;
  const display = candidate.display.map((rawCandle) => {
    const candle = rawCandle as Partial<TradingAlertSimulationCandle>;
    return {
      time: Math.trunc(Number(candle?.time)) as UTCTimestamp,
      open: Number(candle?.open),
      high: Number(candle?.high),
      low: Number(candle?.low),
      close: Number(candle?.close),
      ...(Number.isFinite(Number(candle?.volume)) && Number(candle?.volume) >= 0
        ? { volume: Number(candle?.volume) }
        : {}),
    };
  });
  if (display.some((candle, index) => (
    !Number.isFinite(Number(candle.time))
    || Number(candle.time) <= 0
    || [candle.open, candle.high, candle.low, candle.close].some((price) => !Number.isFinite(price) || price <= 0)
    || candle.high < Math.max(candle.open, candle.close)
    || candle.low > Math.min(candle.open, candle.close)
    || (index > 0 && Number(candle.time) <= Number(display[index - 1].time))
  ))) return null;
  const history = Array.isArray(candidate.history)
    ? candidate.history.slice(-500).map((rawCandle) => {
        const candle = rawCandle as Partial<TradingAlertSimulationCandle>;
        return {
          time: Math.trunc(Number(candle?.time)) as UTCTimestamp,
          open: Number(candle?.open),
          high: Number(candle?.high),
          low: Number(candle?.low),
          close: Number(candle?.close),
          ...(Number.isFinite(Number(candle?.volume)) && Number(candle?.volume) >= 0
            ? { volume: Number(candle?.volume) }
            : {}),
        };
      })
    : [];
  if (history.some((candle, index) => (
    !Number.isFinite(Number(candle.time))
    || Number(candle.time) <= 0
    || Number(candle.time) >= Number(display[0].time)
    || [candle.open, candle.high, candle.low, candle.close].some((price) => !Number.isFinite(price) || price <= 0)
    || candle.high < Math.max(candle.open, candle.close)
    || candle.low > Math.min(candle.open, candle.close)
    || (index > 0 && Number(candle.time) <= Number(history[index - 1].time))
  ))) return null;
  const triggerIndex = Number(candidate.triggerIndex);
  const triggerTime = candidate.triggerTime === null ? null : Number(candidate.triggerTime);
  const triggerPrice = candidate.triggerPrice === null ? null : Number(candidate.triggerPrice);
  const stepSeconds = Number(candidate.stepSeconds);
  const updatedAt = Number(candidate.updatedAt);
  if (
    !Number.isInteger(triggerIndex)
    || triggerIndex < 0
    || triggerIndex >= display.length
    || (triggerTime !== null && (!Number.isFinite(triggerTime) || triggerTime <= 0))
    || (triggerPrice !== null && (!Number.isFinite(triggerPrice) || triggerPrice <= 0))
    || !Number.isFinite(stepSeconds)
    || stepSeconds <= 0
  ) return null;
  return {
    schemaVersion: 1,
    simulationId,
    marketId,
    interval,
    display,
    ...(history.length ? { history } : {}),
    triggerIndex,
    triggerTime,
    triggerPrice,
    stepSeconds,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : 0,
    ...(normalizeTradingAlertSimulationIndicatorSpecs(candidate.indicators).length
      ? { indicators: normalizeTradingAlertSimulationIndicatorSpecs(candidate.indicators) }
      : {}),
    ...(normalizeTradingAlertSimulationConditionAnnotations(candidate.conditionAnnotations).length
      ? { conditionAnnotations: normalizeTradingAlertSimulationConditionAnnotations(candidate.conditionAnnotations) }
      : {}),
    ...(market ? { market } : {}),
  };
}

export function loadTradingAlertSimulationState(
  storage: Pick<TradingAlertSimulationStorage, "getItem">,
  storageSessionId: string,
) {
  try {
    const serialized = storage.getItem(tradingAlertSimulationStorageKey(storageSessionId));
    return serialized ? normalizeTradingAlertSimulationState(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function saveTradingAlertSimulationState(
  storage: Pick<TradingAlertSimulationStorage, "setItem">,
  storageSessionId: string,
  state: TradingAlertSimulationState,
) {
  const normalized = normalizeTradingAlertSimulationState(state);
  if (!normalized) return false;
  try {
    storage.setItem(tradingAlertSimulationStorageKey(storageSessionId), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearTradingAlertSimulationState(
  storage: Pick<TradingAlertSimulationStorage, "removeItem">,
  storageSessionId: string,
) {
  try {
    storage.removeItem(tradingAlertSimulationStorageKey(storageSessionId));
  } catch {
    // Clearing the visible layer still succeeds when local persistence is unavailable.
  }
}

function migrateTradingAlertSimulationState(
  storage: TradingAlertSimulationStorage,
  previousStorageSessionId: string,
  nextStorageSessionId: string,
) {
  const previous = loadTradingAlertSimulationState(storage, previousStorageSessionId);
  if (
    previous
    && saveTradingAlertSimulationState(storage, nextStorageSessionId, previous)
  ) clearTradingAlertSimulationState(storage, previousStorageSessionId);
}

function normalizeTradingLastDrawingWorkspace(value: unknown): TradingLastDrawingWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TradingLastDrawingWorkspace>;
  const layout = tradingSplitLayout(String(candidate.layoutId || ""));
  if (!Array.isArray(candidate.panes)) return null;
  const panes = new Map<number, TradingLastDrawingPaneState>();
  candidate.panes.forEach((rawPane) => {
    if (!rawPane || typeof rawPane !== "object") return;
    const pane = rawPane as Partial<TradingLastDrawingPaneState>;
    const paneIndex = Number(pane.paneIndex);
    const interval = String(pane.interval || "").trim().toUpperCase();
    const market = normalizeTradingFavoriteMarketRecords(pane.market ? [pane.market] : [])[0] || null;
    if (
      !Number.isInteger(paneIndex)
      || paneIndex < 0
      || paneIndex > 8
      || !market
      || !tradingViewResolutionDurationMs(interval)
    ) return;
    const rawIndicators = pane.indicators && typeof pane.indicators === "object"
      ? pane.indicators
      : null;
    const indicators: TradingSplitPaneIndicatorSelection | undefined = paneIndex > 0 && rawIndicators
      ? {
          main: [...new Set((Array.isArray(rawIndicators?.main) ? rawIndicators.main : [])
            .filter((id): id is TradingMainIndicatorId =>
              typeof id === "string" && TRADING_MAIN_INDICATORS.some((indicator) => indicator.id === id)))],
          sub: [...new Set((Array.isArray(rawIndicators?.sub) ? rawIndicators.sub : [])
            .filter((id): id is TradingIndicatorId =>
              typeof id === "string" && TRADING_INDICATORS.some((indicator) => indicator.id === id)))],
        }
      : undefined;
    panes.set(paneIndex, {
      paneIndex,
      market,
      interval,
      ...(indicators ? { indicators } : {}),
    });
  });
  if (!panes.has(0)) return null;
  const updatedAt = Number(candidate.updatedAt);
  return {
    schemaVersion: 1,
    layoutId: layout.id,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : 0,
    panes: [...panes.values()]
      .filter((pane) => pane.paneIndex < layout.count)
      .sort((first, second) => first.paneIndex - second.paneIndex),
  };
}
interface TradingSplitPaneAnalysisReport {
  paneIndex: number;
  heading: string;
  report: string;
  narrative: string;
  modelName: string;
}
interface TradingSplitPaneAnalysisFailure {
  paneIndex: number;
  heading: string;
  message: string;
}
interface TradingSplitPaneAnalysisResult {
  completed: number;
  failed: number;
  reports: TradingSplitPaneAnalysisReport[];
  failures: TradingSplitPaneAnalysisFailure[];
}

export function loadTradingLastDrawingWorkspace(
  storage: Pick<TradingLastDrawingWorkspaceStorage, "getItem">,
  storageSessionId: string,
) {
  try {
    const serialized = storage.getItem(tradingLastDrawingWorkspaceStorageKey(storageSessionId));
    return serialized ? normalizeTradingLastDrawingWorkspace(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

function saveTradingLastDrawingWorkspace(
  storage: Pick<TradingLastDrawingWorkspaceStorage, "setItem">,
  storageSessionId: string,
  workspace: TradingLastDrawingWorkspace,
) {
  const normalized = normalizeTradingLastDrawingWorkspace(workspace);
  if (!normalized) return;
  try {
    storage.setItem(tradingLastDrawingWorkspaceStorageKey(storageSessionId), JSON.stringify(normalized));
  } catch {
    // The current workspace remains usable if local persistence is unavailable.
  }
}

function migrateTradingLastDrawingWorkspace(
  storage: TradingLastDrawingWorkspaceStorage,
  previousStorageSessionId: string,
  nextStorageSessionId: string,
) {
  const previous = loadTradingLastDrawingWorkspace(storage, previousStorageSessionId);
  if (previous) saveTradingLastDrawingWorkspace(storage, nextStorageSessionId, previous);
  try {
    storage.removeItem(tradingLastDrawingWorkspaceStorageKey(previousStorageSessionId));
  } catch {
    // Keeping a duplicate temporary-task key is safer than failing task promotion.
  }
}

function normalizeTradingLastAnalysisContext(value: unknown): TradingLastAnalysisContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TradingLastAnalysisContext>;
  const market = normalizeTradingFavoriteMarketRecords(candidate.market ? [candidate.market] : [])[0] || null;
  const marketId = String(candidate.marketId || market?.id || "").trim().toUpperCase();
  const interval = String(candidate.interval || "").trim().toUpperCase();
  if (
    !marketId
    || !/^(?:BINANCE|FINNHUB|IFIND):[A-Z0-9^][A-Z0-9^:._\/\-=]{0,96}$/.test(marketId)
    || !tradingViewResolutionDurationMs(interval)
  ) return null;
  const updatedAt = Number(candidate.updatedAt);
  return {
    schemaVersion: 1,
    marketId,
    interval,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : 0,
    ...(market ? { market } : {}),
  };
}

function inferTradingLastAnalysisContext(
  storage: Pick<TradingLastAnalysisContextStorage, "getItem">,
  storageSessionId: string,
) {
  try {
    const serialized = storage.getItem(tradingDrawingSessionStorageKey("ai", storageSessionId));
    const drawings = JSON.parse(serialized || "[]");
    if (!Array.isArray(drawings)) return null;
    for (let index = drawings.length - 1; index >= 0; index -= 1) {
      const drawing = drawings[index];
      if (!drawing || typeof drawing !== "object" || drawing.source !== "ai") continue;
      const context = normalizeTradingLastAnalysisContext({
        schemaVersion: 1,
        marketId: drawing.symbol,
        interval: drawing.interval,
        updatedAt: 0,
      });
      if (context) return context;
    }
  } catch {
    // Invalid or inaccessible legacy drawing storage simply has no list prefix.
  }
  return null;
}

export function loadTradingLastAnalysisContext(
  storage: TradingLastAnalysisContextStorage,
  storageSessionId: string,
) {
  const storageKey = tradingLastAnalysisContextStorageKey(storageSessionId);
  try {
    const serialized = storage.getItem(storageKey);
    const stored = serialized
      ? normalizeTradingLastAnalysisContext(JSON.parse(serialized))
      : null;
    if (stored) return stored;
    const inferred = inferTradingLastAnalysisContext(storage, storageSessionId);
    if (inferred) storage.setItem(storageKey, JSON.stringify(inferred));
    return inferred;
  } catch {
    return inferTradingLastAnalysisContext(storage, storageSessionId);
  }
}

function saveTradingLastAnalysisContext(
  storage: TradingLastAnalysisContextStorage,
  storageSessionId: string,
  context: TradingLastAnalysisContext | null,
) {
  const storageKey = tradingLastAnalysisContextStorageKey(storageSessionId);
  try {
    if (!context) storage.removeItem(storageKey);
    else storage.setItem(storageKey, JSON.stringify(context));
  } catch {
    // The active chart still works when local persistence is unavailable.
  }
}

function migrateTradingLastAnalysisContext(
  storage: TradingLastAnalysisContextStorage,
  previousStorageSessionId: string,
  nextStorageSessionId: string,
) {
  const previous = loadTradingLastAnalysisContext(storage, previousStorageSessionId);
  if (previous) saveTradingLastAnalysisContext(storage, nextStorageSessionId, previous);
  try {
    storage.removeItem(tradingLastAnalysisContextStorageKey(previousStorageSessionId));
  } catch {
    // Keeping a duplicate legacy key is safer than failing task promotion.
  }
}

function tradingAnalysisBaseAsset(context: TradingLastAnalysisContext) {
  const storedBaseAsset = String(context.market?.baseAsset || "").trim().toUpperCase();
  if (storedBaseAsset) return storedBaseAsset;
  const symbol = String(context.marketId.split(":").at(-1) || "").trim().toUpperCase();
  return baseAssetFromSymbol(symbol).replace(/[^A-Z0-9^._-]/g, "").slice(0, 24);
}

export function tradingAnalysisIntervalLabel(resolution: string) {
  const normalized = String(resolution || "").trim().toUpperCase();
  const match = /^(\d+)([SDW]?)$/.exec(normalized);
  if (!match) return normalized.slice(0, 8);
  const amount = Number(match[1]);
  if (match[2]) return `${amount}${match[2]}`;
  return amount % 60 === 0 ? `${amount / 60}H` : `${amount}M`;
}

export function tradingAnalysisContextLabel(context: TradingLastAnalysisContext | null) {
  if (!context) return "";
  const baseAsset = tradingAnalysisBaseAsset(context);
  const interval = tradingAnalysisIntervalLabel(context.interval);
  return baseAsset && interval ? `${baseAsset}${interval}` : "";
}

export function tradingLastAnalysisLabelForThread(storageSessionId: string) {
  try {
    return tradingAnalysisContextLabel(
      loadTradingLastAnalysisContext(window.localStorage, storageSessionId),
    );
  } catch {
    return "";
  }
}

function tradingMarketHasUsableQuote(market: TradingMarket | undefined) {
  return Boolean(
    market?.quoteAvailable
    && Number.isFinite(market.markPrice)
    && market.markPrice > 0
    && Number.isFinite(market.changePercent),
  );
}

function preferTradingMarketQuote(
  current: TradingMarket | undefined,
  candidate: TradingMarket,
) {
  if (!current || tradingMarketHasUsableQuote(candidate) || !tradingMarketHasUsableQuote(current)) {
    return candidate;
  }
  return current;
}

export function resolveTradingFavoriteMarkets(
  records: ReadonlyArray<TradingFavoriteMarketRecord>,
  liveMarkets: ReadonlyArray<TradingMarket>,
) {
  const liveMarketById = new Map<string, TradingMarket>();
  liveMarkets.forEach((market) => {
    liveMarketById.set(
      market.id,
      preferTradingMarketQuote(liveMarketById.get(market.id), market),
    );
  });
  return records.map((record) => liveMarketById.get(record.id) || marketFromFavoriteRecord(record));
}

export function normalizeFinnhubTradingMarket(value: unknown): TradingMarket | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TradingMarket>;
  const symbol = String(item.symbol || "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9^][A-Z0-9^:._/\-=]{0,95}$/.test(symbol)) return null;
  const displaySymbol = String(item.displaySymbol || symbol).trim().slice(0, 96) || symbol;
  const assetClass = normalizeTradingAssetClass(item.assetClass);
  const markPrice = Number(item.markPrice || 0);
  const changePercent = Number(item.changePercent || 0);
  return {
    id: `FINNHUB:${symbol}`,
    provider: "finnhub",
    symbol,
    baseAsset: displaySymbol,
    quoteAsset: "",
    displaySymbol,
    description: String(item.description || displaySymbol).replace(/[\r\n\0]+/g, " ").trim().slice(0, 160),
    venue: String(item.venue || "Finnhub").replace(/[\r\n\0]+/g, " ").trim().slice(0, 80),
    assetClass,
    marketType: "global",
    tag: String(item.tag || "股票").replace(/[\r\n\0]+/g, " ").trim().slice(0, 24),
    markPrice: Number.isFinite(markPrice) ? markPrice : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    volume24h: 0,
    quoteAvailable: Number.isFinite(markPrice) && markPrice > 0,
  };
}

export function normalizeIfindTradingMarket(value: unknown): TradingMarket | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TradingMarket>;
  const symbol = String(item.symbol || "").trim().toUpperCase();
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(symbol)) return null;
  const ticker = String(item.baseAsset || symbol.split(".", 1)[0]).trim().slice(0, 24) || symbol.split(".", 1)[0];
  const displaySymbol = String(item.description || item.displaySymbol || ticker).trim().slice(0, 96) || ticker;
  const description = String(item.description || displaySymbol).replace(/[\r\n\0]+/g, " ").trim().slice(0, 160);
  const markPrice = Number(item.markPrice || 0);
  const changePercent = Number(item.changePercent || 0);
  return {
    id: `IFIND:${symbol}`,
    provider: "ifind",
    symbol,
    baseAsset: ticker,
    quoteAsset: "",
    displaySymbol,
    description,
    venue: abbreviateIfindVenue(item.venue || "A股市场"),
    assetClass: "a-share",
    marketType: "global",
    tag: String(item.tag || "A股").replace(/[\r\n\0]+/g, " ").trim().slice(0, 24),
    markPrice: Number.isFinite(markPrice) ? markPrice : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    volume24h: Number.isFinite(Number(item.volume24h)) ? Number(item.volume24h) : 0,
    quoteAvailable: Number.isFinite(markPrice) && markPrice > 0,
  };
}

export function tradingMarketVisibleInPicker(
  market: Pick<TradingMarket, "symbol" | "baseAsset"> & Partial<
    Pick<TradingMarket, "id" | "provider" | "displaySymbol" | "description">
  >,
  query: string,
  favoriteSymbols: ReadonlySet<string>,
  favoritesOnly: boolean,
) {
  const normalizedQuery = query.trim().toUpperCase();
  const normalizedSymbol = market.symbol.toUpperCase();
  if (normalizedQuery) {
    return normalizedSymbol.includes(normalizedQuery)
      || market.baseAsset.toUpperCase().includes(normalizedQuery)
      || String(market.displaySymbol || "").toUpperCase().includes(normalizedQuery)
      || String(market.description || "").toUpperCase().includes(normalizedQuery);
  }
  return !favoritesOnly
    || favoriteSymbols.has(String(market.id || "").toUpperCase())
    || ((!market.provider || market.provider === "binance")
      && favoriteSymbols.has(normalizedSymbol));
}

export function tradingMarketCryptoPairKey(
  market: Pick<TradingMarket, "assetClass" | "symbol" | "displaySymbol">,
) {
  if (market.assetClass !== "crypto") return "";
  const symbolTail = market.symbol.toUpperCase().split(":").at(-1) || "";
  const compactSymbol = symbolTail.replace(/[^A-Z0-9]/g, "");
  if (compactSymbol.endsWith(MARKET_QUOTE) && compactSymbol.length > MARKET_QUOTE.length) {
    return compactSymbol;
  }
  const compactDisplay = market.displaySymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compactDisplay.endsWith(MARKET_QUOTE) ? compactDisplay : compactSymbol;
}

export function tradingMarketsPreferBinance(markets: ReadonlyArray<TradingMarket>) {
  const binanceCryptoPairs = new Set(
    markets
      .filter((market) => market.provider === "binance")
      .map(tradingMarketCryptoPairKey)
      .filter(Boolean),
  );
  const marketById = new Map<string, TradingMarket>();
  markets.forEach((market) => {
    const cryptoPair = tradingMarketCryptoPairKey(market);
    if (market.provider === "finnhub" && cryptoPair && binanceCryptoPairs.has(cryptoPair)) return;
    marketById.set(market.id, preferTradingMarketQuote(marketById.get(market.id), market));
  });
  return [...marketById.values()];
}

/**
 * Keep the market directory useful when it opens without a query: a user's
 * saved pairs should be immediately reachable, while the rest of the catalog
 * remains available below them. The legacy symbol form is accepted for
 * Binance favorites so older local storage entries are ordered correctly too.
 */
export function orderTradingMarketPickerResults(
  markets: ReadonlyArray<TradingMarket>,
  favoriteSymbols: ReadonlySet<string>,
) {
  const favorites: TradingMarket[] = [];
  const others: TradingMarket[] = [];
  const seen = new Set<string>();
  markets.forEach((market) => {
    const marketId = String(market.id || "").trim().toUpperCase();
    if (!marketId || seen.has(marketId)) return;
    seen.add(marketId);
    const favorite = favoriteSymbols.has(marketId)
      || (market.provider === "binance" && favoriteSymbols.has(market.symbol.toUpperCase()));
    (favorite ? favorites : others).push(market);
  });
  return [...favorites, ...others];
}

function cloneTradingPeriods(periods: ReadonlyArray<TradingPeriod>) {
  return periods.map((period) => ({ ...period }));
}

export function reorderTradingPeriods(
  periods: ReadonlyArray<TradingPeriod>,
  orderedResolutions: ReadonlyArray<string>,
) {
  const remaining = new Map(
    periods.map((period) => [tradingViewResolution(period), { ...period }]),
  );
  const reordered: TradingPeriod[] = [];
  orderedResolutions.forEach((resolution) => {
    const period = remaining.get(resolution);
    if (!period) return;
    reordered.push(period);
    remaining.delete(resolution);
  });
  remaining.forEach((period) => reordered.push(period));
  return reordered;
}

export function tradingViewResolutionDurationMs(resolution: string) {
  const match = /^(\d+)([SDW]?)$/.exec(resolution.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;
  if (match[2] === "S") return amount * 1_000;
  if (match[2] === "D") return amount * 86_400_000;
  if (match[2] === "W") return amount * 604_800_000;
  return amount * 60_000;
}

export function tradingPeriodLabelForResolution(resolution: string) {
  const normalized = String(resolution || "").trim().toUpperCase();
  const match = /^(\d+)([SDW]?)$/.exec(normalized);
  if (!match) return normalized || "当前周期";
  const amount = Number(match[1]);
  if (match[2] === "S") return `${amount}秒`;
  if (match[2] === "D") return `${amount}日`;
  if (match[2] === "W") return `${amount}周`;
  return amount % 60 === 0 ? `${amount / 60}时` : `${amount}分`;
}

function tradingAnalysisPaneHeading(
  market: Pick<TradingSplitPaneMarket, "displaySymbol" | "baseAsset" | "quoteAsset" | "symbol">,
  interval: string,
) {
  const marketLabel = market.displaySymbol
    || [market.baseAsset, market.quoteAsset].filter(Boolean).join("/")
    || market.symbol;
  return `${marketLabel} · ${tradingPeriodLabelForResolution(interval)} K线`;
}

function combineTradingAnalysisReports(
  primaryHeading: string,
  primaryReport: string,
  splitResult: TradingSplitPaneAnalysisResult,
) {
  if (!splitResult.reports.length && !splitResult.failures.length) return primaryReport;
  const sections = [
    `## ${primaryHeading}`,
    primaryReport.trim(),
    ...splitResult.reports
      .slice()
      .sort((first, second) => first.paneIndex - second.paneIndex)
      .flatMap((report) => [`## ${report.heading}`, report.report.trim()]),
  ];
  if (splitResult.failures.length) {
    sections.push(
      "## 未完成的分屏",
      ...splitResult.failures
        .slice()
        .sort((first, second) => first.paneIndex - second.paneIndex)
        .map((failure) => `- ${failure.heading}：${failure.message}`),
    );
  }
  return sections.filter(Boolean).join("\n\n");
}

function combineTradingAnalysisNarratives(
  primaryHeading: string,
  primaryNarrative: string,
  splitResult: TradingSplitPaneAnalysisResult,
) {
  return combineTradingAnalysisReports(primaryHeading, primaryNarrative, {
    ...splitResult,
    reports: splitResult.reports.map((report) => ({ ...report, report: report.narrative })),
  });
}

export function resolveMarketCrosshairTime(
  parameterTime: unknown,
  logical: unknown,
  candles: ReadonlyArray<{ time: number }>,
  resolution: string,
) {
  if (typeof parameterTime === "number" && Number.isFinite(parameterTime)) {
    return parameterTime;
  }
  if (typeof logical !== "number" || !Number.isFinite(logical) || !candles.length) {
    return null;
  }
  const durationMs = tradingViewResolutionDurationMs(resolution);
  if (!durationMs) return null;
  const boundaryIndex = logical < 0 ? 0 : candles.length - 1;
  const boundaryTime = Number(candles[boundaryIndex]?.time);
  if (!Number.isFinite(boundaryTime)) return null;
  return boundaryTime
    + CHINA_TIME_OFFSET_SECONDS
    + (logical - boundaryIndex) * (durationMs / 1_000);
}

export interface BinanceResolutionSource {
  targetMs: number;
  sourceInterval: string | null;
  sourceMs: number | null;
}

export function binanceResolutionSource(resolution: string): BinanceResolutionSource | null {
  const targetMs = tradingViewResolutionDurationMs(resolution);
  if (!targetMs) return null;
  if (targetMs < 60_000) return { targetMs, sourceInterval: null, sourceMs: null };
  const source = Object.entries(BINANCE_INTERVAL_MS)
    .filter(([, duration]) => duration <= targetMs && targetMs % duration === 0)
    .sort((first, second) => second[1] - first[1])[0];
  if (!source) return null;
  return { targetMs, sourceInterval: source[0], sourceMs: source[1] };
}

type TrendState =
  | "bull_trend"
  | "bear_trend"
  | "close_below_fast_fast_above_slow"
  | "close_above_fast_fast_below_slow"
  | "unclassified";

interface TradingCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface TradingMarketStats {
  symbol: string;
  markPrice: number;
  midPrice: number;
  oraclePrice: number;
  openInterest: number;
  fundingRate: number;
  nextFundingTime: number;
  prevDayPrice: number;
  volume24h: number;
}

export function tradingMarketStatsFromCandles(
  symbol: string,
  candles: ReadonlyArray<{ close: number }>,
) {
  const latestPrice = Number(candles.at(-1)?.close || 0);
  const markPrice = Number.isFinite(latestPrice) && latestPrice > 0 ? latestPrice : 0;
  return {
    symbol,
    markPrice,
    midPrice: markPrice,
    oraclePrice: 0,
    openInterest: 0,
    fundingRate: 0,
    nextFundingTime: 0,
    prevDayPrice: markPrice,
    volume24h: 0,
  };
}

export interface TradingMarket {
  id: string;
  provider: TradingMarketProvider;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  displaySymbol: string;
  description: string;
  venue: string;
  assetClass: TradingAssetClass;
  marketType: TradingMarketType;
  tag: string;
  markPrice: number;
  changePercent: number;
  volume24h: number;
  quoteAvailable: boolean;
}

export interface TradingMarketTickerQuote {
  lastPrice?: string | number;
  openPrice?: string | number;
  changePercent?: string | number;
}

export function applyTradingMarketTickerQuote(
  market: TradingMarket,
  quote: TradingMarketTickerQuote,
  knownOpenPrice?: number,
) {
  const lastPrice = Number(quote.lastPrice);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return { updated: false, openPrice: null } as const;
  }
  const quoteOpenPrice = Number(quote.openPrice);
  const openPrice = Number.isFinite(quoteOpenPrice) && quoteOpenPrice > 0
    ? quoteOpenPrice
    : Number.isFinite(knownOpenPrice) && Number(knownOpenPrice) > 0
      ? Number(knownOpenPrice)
      : null;
  market.markPrice = lastPrice;
  market.quoteAvailable = true;
  if (openPrice !== null) {
    market.changePercent = ((lastPrice - openPrice) / openPrice) * 100;
  } else {
    const changePercent = Number(quote.changePercent);
    if (Number.isFinite(changePercent)) market.changePercent = changePercent;
  }
  return { updated: true, openPrice } as const;
}

export function tradingFavoriteTickerStreams(symbols: Iterable<string>) {
  return [...new Set([...symbols]
    .map((symbol) => String(symbol || "").trim().toLowerCase())
    .filter((symbol) => /^[a-z0-9]+$/.test(symbol)))]
    .map((symbol) => `${symbol}@ticker`);
}

function defaultBinancePerpetualMarket(symbol = DEFAULT_SYMBOL): TradingMarket {
  const normalizedSymbol = String(symbol || DEFAULT_SYMBOL).trim().toUpperCase();
  const baseAsset = normalizedSymbol.endsWith(MARKET_QUOTE)
    ? normalizedSymbol.slice(0, -MARKET_QUOTE.length)
    : normalizedSymbol;
  return {
    id: `BINANCE:FUTURES:${normalizedSymbol}`,
    provider: "binance",
    symbol: normalizedSymbol,
    baseAsset,
    quoteAsset: MARKET_QUOTE,
    displaySymbol: `${baseAsset}/${MARKET_QUOTE}`,
    description: `${baseAsset}/${MARKET_QUOTE} 币安永续合约`,
    venue: MARKET_VENUE,
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
    markPrice: 0,
    changePercent: 0,
    volume24h: 0,
    quoteAvailable: false,
  };
}

export interface TradingFavoriteMarketRecord {
  id: string;
  provider: TradingMarketProvider;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  displaySymbol: string;
  description: string;
  venue: string;
  assetClass: TradingAssetClass;
  marketType: TradingMarketType;
  tag: string;
}

export interface TradingLastAnalysisContext {
  schemaVersion: 1;
  marketId: string;
  interval: string;
  updatedAt: number;
  market?: TradingFavoriteMarketRecord;
}

export interface TradingLastDrawingPaneState {
  paneIndex: number;
  market: TradingFavoriteMarketRecord;
  interval: string;
  indicators?: TradingSplitPaneIndicatorSelection;
}

export interface TradingLastDrawingWorkspace {
  schemaVersion: 1;
  layoutId: string;
  updatedAt: number;
  panes: TradingLastDrawingPaneState[];
}

export interface TradingAlertSimulationCandle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type TradingAlertSimulationIndicatorPlacement = "main" | "pane";

export interface TradingAlertSimulationIndicatorSpec {
  specId: string;
  name: string;
  label: string;
  placement: TradingAlertSimulationIndicatorPlacement;
  parameters: number[];
  conditionIds: string[];
  triggerLabel: string;
  triggers?: Array<{ label: string; conditionIds: string[] }>;
}

export interface TradingAlertSimulationConditionAnnotationSpec {
  annotationId: string;
  label: string;
  conditionIds: string[];
  time: number;
  price: number;
}

export interface TradingAlertSimulationState {
  schemaVersion: 1;
  simulationId: string;
  marketId: string;
  interval: string;
  display: TradingAlertSimulationCandle[];
  history?: TradingAlertSimulationCandle[];
  triggerIndex: number;
  triggerTime: number | null;
  triggerPrice: number | null;
  stepSeconds: number;
  updatedAt: number;
  indicators?: TradingAlertSimulationIndicatorSpec[];
  conditionAnnotations?: TradingAlertSimulationConditionAnnotationSpec[];
  market?: TradingFavoriteMarketRecord;
}

export interface TradingAlertSimulationShowOptions {
  allowHistorical?: boolean;
  animate?: boolean;
  focus?: boolean;
}

export interface TradingFavoritesStorageSnapshot {
  symbols: string[];
  records: TradingFavoriteMarketRecord[];
  migratedFromLegacy: boolean;
}

interface BinanceExchangeSymbol {
  symbol?: string;
  pair?: string;
  contractType?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  underlyingType?: string;
  underlyingSubType?: string[] | string;
  isSpotTradingAllowed?: boolean;
}

interface BinanceExchangeInfo {
  symbols?: BinanceExchangeSymbol[];
}

interface BinanceTicker24h {
  symbol?: string;
  lastPrice?: string;
  openPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
}

interface BinancePremiumIndex {
  s?: string;
  symbol?: string;
  markPrice?: string;
  indexPrice?: string;
  lastFundingRate?: string;
  nextFundingTime?: number;
}

interface BinanceOpenInterest {
  openInterest?: string;
}

interface BinanceKlinePayload {
  t?: number;
  s?: string;
  i?: string;
  o?: string;
  h?: string;
  l?: string;
  c?: string;
  v?: string;
}

interface BinanceWsMessage {
  e?: string;
  s?: string;
  p?: string;
  r?: string;
  c?: string;
  o?: string;
  q?: string;
  P?: string;
  a?: number;
  T?: number;
  m?: boolean;
  k?: BinanceKlinePayload;
}

interface BinanceAggregateTrade {
  a?: number;
  p?: string;
  q?: string;
  T?: number;
  m?: boolean;
}

interface BinanceDepthSnapshot {
  lastUpdateId?: number;
  E?: number;
  T?: number;
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
}

interface BinanceOpenInterestHistoryPoint {
  sumOpenInterest?: string;
  timestamp?: number;
}

interface TradingOrderFlowWindow {
  [key: string]: unknown;
  source: "binance-rest";
  windowStart: number;
  windowEnd: number;
  trades: Array<{
    id: string;
    time: number;
    price: number;
    quantity: number;
    side: "buy" | "sell";
  }>;
  depth: {
    snapshotTime: number;
    lastUpdateId: number;
    bids: Array<{ price: number; quantity: number }>;
    asks: Array<{ price: number; quantity: number }>;
  };
  openInterest: {
    current: number | null;
    history: Array<{ time: number; value: number }>;
  };
  coverage: {
    trades: "available" | "partial" | "unavailable";
    depth: "partial" | "unavailable";
    openInterest: "available" | "partial" | "unavailable";
    liquidations: "unavailable";
  };
}

interface TradingMarketStructureContext {
  interval: string;
  candles: TradingCandle[];
}

interface TradingCandleBatch {
  candles: TradingCandle[];
  sourceCandles: TradingCandle[];
  source: BinanceResolutionSource;
  lastTradeId?: number;
}

interface TradingMarketCandleCacheEntry {
  cachedAt: number;
  stats: TradingMarketStats;
  candleBatch: TradingCandleBatch;
  ageMs?: number;
  isStale?: boolean;
}

function tradingMarketPersistentStorage() {
  try { return window.localStorage; } catch { return null; }
}

const tradingMarketCandleCache = createTradingMarketCandleCache({
  storage: tradingMarketPersistentStorage(),
  maxEntries: 48,
  maxCandles: 500,
  maxSourceCandles: 1_500,
});

export function tradingMarketCandleCacheKey(input: {
  provider: string;
  symbol: string;
  assetClass: string;
  interval: string;
  marketType: string;
}) {
  return [input.provider, input.symbol, input.assetClass, input.interval, input.marketType]
    .map((value) => String(value || "").trim().toUpperCase())
    .join("|");
}

export function getTradingMarketCandleCache(
  key: string,
  now = Date.now(),
) {
  return tradingMarketCandleCache.get(key, now) as TradingMarketCandleCacheEntry | null;
}

export function setTradingMarketCandleCache(
  key: string,
  snapshot: Pick<TradingMarketCandleCacheEntry, "stats" | "candleBatch">,
  cachedAt = Date.now(),
) {
  tradingMarketCandleCache.set(key, snapshot, cachedAt);
}

interface IndicatorSeriesRuntime {
  key: string;
  api: any;
  label: string;
  color: string;
  latestValue: number;
}

interface IndicatorPaneRuntime {
  id: TradingIndicatorId;
  pane: any;
  legend: HTMLElement | null;
  series: IndicatorSeriesRuntime[];
  analysisSeries: any[];
  analysisMarkers: { setMarkers(markers: any[]): void } | null;
  analysisSignature: string;
}

interface TradingAlertSimulationIndicatorSeriesRuntime {
  key: string;
  type: "line" | "histogram";
  api: any;
  label: string;
  color: string;
  data: Array<Record<string, unknown> & { time: UTCTimestamp; value?: number }>;
  annotation: HTMLElement | null;
  additionalAnnotations: HTMLElement[];
  latestValue: number;
}

interface TradingAlertSimulationIndicatorRuntime {
  spec: TradingAlertSimulationIndicatorSpec;
  pane: any | null;
  legend: HTMLElement | null;
  series: TradingAlertSimulationIndicatorSeriesRuntime[];
  historicalDisplayEnd: number;
}

interface TradingAlertEvidenceIndicatorTarget {
  element: HTMLElement;
  pane: any | null;
  series: any;
  time: number;
  value: number;
}

export interface TdSequentialSignal {
  index: number;
  direction: "buy" | "sell";
  count: number;
}

interface Atm1Bar extends TradingCandle {
  emaFast: number;
  emaSlow: number;
  state: TrendState;
}

export interface Atm4Bar {
  time: number;
  bandUpper: number;
  bandLower: number;
}

const ATM1_COLORS: Record<TrendState, string> = {
  bull_trend: TRADING_RISING_BAR_COLOR,
  bear_trend: TRADING_FALLING_BAR_COLOR,
  close_below_fast_fast_above_slow: "#1e90ff",
  close_above_fast_fast_below_slow: "#ffd700",
  unclassified: "#888888",
};

export const TRADING_MAIN_INDICATOR_LINE_COLORS = ["#d1ab2e", "#2dccac", "#c935cc"] as const;

const mainIndicatorPalette = (dark: boolean) => ({
  ma: [...TRADING_MAIN_INDICATOR_LINE_COLORS],
  ema: [...TRADING_MAIN_INDICATOR_LINE_COLORS],
  boll: [...TRADING_MAIN_INDICATOR_LINE_COLORS],
  bbi: [dark ? "#69a8ff" : "#2563eb"],
  tdBuy: dark ? "#41d37c" : "#0d8f60",
  tdSell: dark ? "#ff4f75" : "#d9365d",
});

const alertSimulationIndicatorPalette = (dark: boolean) => dark
  ? ["#f6c453", "#49d3bd", "#df6be4", "#67a8ff", "#ff7a96", "#a78bfa"]
  : ["#916400", "#007f73", "#98279d", "#1d4ed8", "#b42345", "#6d28d9"];

export const marketTheme = (dark: boolean) => dark
  ? {
      background: "#0f1014",
      text: "#dfe1e3",
      grid: "#0e1c2e",
      border: "#182235",
      crosshair: "rgba(150, 165, 184, 0.78)",
      crosshairLabel: "#626b77",
      band: "rgba(135, 206, 250, 0.18)",
      bandLine: "rgba(135, 206, 250, 0.45)",
      paneSeparator: "#1a2437",
      paneSeparatorHover: "rgba(65, 211, 124, 0.28)",
      alertMarker: "#fbbf24",
    }
  : {
      background: "#ffffff",
      text: "#000000",
      grid: "#edf1f6",
      border: "#e1e7ef",
      crosshair: "rgba(112, 134, 160, 0.72)",
      crosshairLabel: "#7d838c",
      band: "rgba(70, 155, 221, 0.13)",
      bandLine: "rgba(70, 155, 221, 0.4)",
      paneSeparator: "#e1e7ef",
      paneSeparatorHover: "rgba(45, 166, 247, 0.2)",
      alertMarker: "#b45309",
    };

const marketCrosshairOptions = (theme: ReturnType<typeof marketTheme>) => ({
  mode: CrosshairMode.Normal,
  vertLine: {
    color: theme.crosshair,
    width: 1 as const,
    style: LineStyle.Dashed,
    labelBackgroundColor: theme.crosshairLabel,
    labelVisible: false,
  },
  horzLine: {
    color: theme.crosshair,
    width: 1 as const,
    style: LineStyle.Dashed,
    labelBackgroundColor: theme.crosshairLabel,
    labelVisible: false,
  },
});

async function fetchBinanceFutures<T>(
  path: string,
  parameters: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const cooldownRemaining = binanceMarketRestCooldownRemaining();
  if (cooldownRemaining > 0) {
    throw new Error(binanceMarketRateLimitMessage(cooldownRemaining));
  }
  return fetchBinancePublicMarketData<T>("futures", path, parameters, signal);
}

async function fetchBinanceSpot<T>(
  path: string,
  parameters: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const cooldownRemaining = binanceMarketRestCooldownRemaining();
  if (cooldownRemaining > 0) {
    throw new Error(binanceMarketRateLimitMessage(cooldownRemaining));
  }
  return fetchBinancePublicMarketData<T>("spot", path, parameters, signal);
}

async function fetchBinancePublicMarketData<T>(
  marketType: "futures" | "spot",
  path: string,
  parameters: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const request = window.codexDesktop?.getBinancePublicMarketData;
  if (typeof request !== "function") throw new Error("Binance market gateway is unavailable");
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const requestId = signal
    ? `renderer-market-rest-${Date.now().toString(36)}-${(++binancePublicMarketRequestSequence).toString(36)}`
    : undefined;
  const pending = request({ marketType, path, parameters, requestId });
  const response = signal
    ? await new Promise<Awaited<ReturnType<typeof request>>>((resolve, reject) => {
      const abort = () => {
        if (requestId) {
          void window.codexDesktop?.cancelBinancePublicMarketData?.({ requestId }).catch(() => {});
        }
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    })
    : await pending;
  if (!response?.ok) {
    if (response?.status === 418 || response?.status === 429) {
      throw new Error(binanceMarketRateLimitMessage(recordBinanceMarketRateLimit(response?.retryAfterMs)));
    }
    throw new Error(String(response?.error || `Binance ${marketType} request failed: ${response?.status || 0}`));
  }
  return response.data as T;
}

let binancePublicMarketRequestSequence = 0;

function fetchBinanceMarket<T>(
  marketType: Extract<TradingMarketType, "perpetual" | "spot">,
  futuresPath: string,
  spotPath: string,
  parameters: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
) {
  return marketType === "spot"
    ? fetchBinanceSpot<T>(spotPath, parameters, signal)
    : fetchBinanceFutures<T>(futuresPath, parameters, signal);
}

export interface TradingAlertAnnotationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TradingAlertAnnotationPlacementInput {
  anchorX: number;
  anchorY: number;
  labelWidth: number;
  labelHeight: number;
  paneLeft: number;
  paneTop: number;
  paneRight: number;
  paneBottom: number;
  dataRightX: number;
  dataTopY: number;
  occupied?: TradingAlertAnnotationRect[];
}

export interface TradingAlertAnnotationPlacement extends TradingAlertAnnotationRect {
  mode: "right-rail" | "top-lane" | "fallback";
  lineEndX: number;
  lineEndY: number;
}

const tradingAlertAnnotationRectsOverlap = (
  first: TradingAlertAnnotationRect,
  second: TradingAlertAnnotationRect,
  gap = 7,
) => !(
  first.left + first.width + gap <= second.left
  || second.left + second.width + gap <= first.left
  || first.top + first.height + gap <= second.top
  || second.top + second.height + gap <= first.top
);

const clampTradingAlertAnnotationCoordinate = (value: number, minimum: number, maximum: number) => (
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
);

/**
 * Keeps alert callouts in either the empty future-time rail or the unused band
 * above the pane data. The returned rectangle never intersects an earlier
 * callout, which lets the renderer apply the same layout to the main chart and
 * every generated indicator pane.
 */
export function resolveTradingAlertAnnotationPlacement(
  input: TradingAlertAnnotationPlacementInput,
): TradingAlertAnnotationPlacement {
  const margin = 9;
  const connectorGap = 18;
  const collisionGap = 7;
  const occupied = input.occupied || [];
  const minimumLeft = input.paneLeft + margin;
  const maximumLeft = input.paneRight - input.labelWidth - margin;
  const minimumTop = input.paneTop + margin;
  const maximumTop = input.paneBottom - input.labelHeight - margin;
  const fits = (rect: TradingAlertAnnotationRect) => (
    rect.left >= minimumLeft
    && rect.left <= maximumLeft
    && rect.top >= minimumTop
    && rect.top <= maximumTop
    && occupied.every((candidate) => !tradingAlertAnnotationRectsOverlap(rect, candidate, collisionGap))
  );
  const placement = (
    left: number,
    top: number,
    mode: TradingAlertAnnotationPlacement["mode"],
  ): TradingAlertAnnotationPlacement => {
    const labelIsRightOfAnchor = left >= input.anchorX;
    const labelIsAboveAnchor = top + input.labelHeight / 2 < input.anchorY;
    return {
      left,
      top,
      width: input.labelWidth,
      height: input.labelHeight,
      mode,
      lineEndX: labelIsRightOfAnchor ? left : left + input.labelWidth,
      lineEndY: labelIsAboveAnchor ? top + input.labelHeight - 2 : top + 2,
    };
  };

  const railLeft = Math.max(input.anchorX + connectorGap, input.dataRightX + 12);
  if (railLeft <= maximumLeft) {
    const preferredTop = clampTradingAlertAnnotationCoordinate(
      input.anchorY - input.labelHeight - 24,
      minimumTop,
      maximumTop,
    );
    const verticalCandidates = [
      preferredTop,
      ...occupied.flatMap((rect) => [rect.top + rect.height + collisionGap, rect.top - input.labelHeight - collisionGap]),
    ].sort((first, second) => Math.abs(first - preferredTop) - Math.abs(second - preferredTop));
    for (const top of verticalCandidates) {
      const rect = { left: railLeft, top, width: input.labelWidth, height: input.labelHeight };
      if (fits(rect)) return placement(railLeft, top, "right-rail");
    }
  }

  const laneTop = Math.min(
    input.dataTopY - input.labelHeight - 12,
    input.anchorY - input.labelHeight - 20,
  );
  if (laneTop >= minimumTop) {
    const preferredLeft = clampTradingAlertAnnotationCoordinate(
      input.anchorX + connectorGap,
      minimumLeft,
      maximumLeft,
    );
    const horizontalCandidates = [
      preferredLeft,
      ...occupied.flatMap((rect) => [rect.left + rect.width + collisionGap, rect.left - input.labelWidth - collisionGap]),
    ].sort((first, second) => Math.abs(first - preferredLeft) - Math.abs(second - preferredLeft));
    for (const left of horizontalCandidates) {
      const rect = { left, top: laneTop, width: input.labelWidth, height: input.labelHeight };
      if (fits(rect)) return placement(left, laneTop, "top-lane");
    }
  }

  // Extremely small panes can have no fully empty lane. Keep the text within
  // the pane and away from existing labels; its opaque themed surface remains
  // legible while the diagonal leader still identifies the exact data point.
  const fallbackLeft = clampTradingAlertAnnotationCoordinate(
    Math.max(input.anchorX + connectorGap, input.dataRightX + 12),
    minimumLeft,
    maximumLeft,
  );
  const fallbackTop = clampTradingAlertAnnotationCoordinate(
    input.anchorY - input.labelHeight - 24,
    minimumTop,
    maximumTop,
  );
  return placement(fallbackLeft, fallbackTop, "fallback");
}

export function tradingAlertAnnotationRightPaddingBars(
  plotWidth: number,
  visibleDataBars: number,
  longestLabelLength: number,
) {
  const safeWidth = Math.max(240, Number(plotWidth) || 0);
  const labelWidth = Math.min(230, Math.max(96, longestLabelLength * 10 + 20));
  const desiredRailWidth = Math.min(safeWidth * 0.42, labelWidth + 34);
  const remainingWidth = Math.max(80, safeWidth - desiredRailWidth);
  return Math.max(8, Math.min(30, Math.ceil(
    Math.max(1, visibleDataBars) * desiredRailWidth / remainingWidth,
  )));
}

function futuresExchangeSymbolsFromTickers(tickers: BinanceTicker24h[]): BinanceExchangeSymbol[] {
  return tickers.flatMap((ticker) => {
    const symbol = String(ticker.symbol || "").trim().toUpperCase();
    if (!symbol.endsWith(MARKET_QUOTE) || symbol.length <= MARKET_QUOTE.length) return [];
    return [{
      symbol,
      baseAsset: symbol.slice(0, -MARKET_QUOTE.length),
      quoteAsset: MARKET_QUOTE,
      contractType: "PERPETUAL",
      status: "TRADING",
    }];
  });
}

function spotExchangeSymbolsFromTickers(tickers: BinanceTicker24h[]): BinanceExchangeSymbol[] {
  return tickers.flatMap((ticker) => {
    const symbol = String(ticker.symbol || "").trim().toUpperCase();
    if (!symbol.endsWith(MARKET_QUOTE) || symbol.length <= MARKET_QUOTE.length) return [];
    return [{
      symbol,
      baseAsset: symbol.slice(0, -MARKET_QUOTE.length),
      quoteAsset: MARKET_QUOTE,
      status: "TRADING",
      isSpotTradingAllowed: true,
    }];
  });
}

export async function fetchTradingMarkets(options: { fast?: boolean } = {}) {
  // These four responses are the largest public-market payloads. Sending them
  // together can saturate a cold domestic-gateway connection and starve the
  // selected chart. Load them deliberately in sequence; ticker snapshots are
  // optional, while either exchange catalog is sufficient to keep search usable.
  let firstCatalogError: unknown = null;
  const optionalCatalogRequest = async <T>(
    request: (signal?: AbortSignal) => Promise<T>,
    fallback: T,
    timeoutMs = 0,
  ) => {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(new DOMException("Catalog request timed out", "TimeoutError")), timeoutMs)
      : null;
    try {
      return await request(controller?.signal);
    } catch (error) {
      firstCatalogError ||= error;
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const futuresTickers = await optionalCatalogRequest(
    () => fetchBinanceFutures<BinanceTicker24h[]>("/fapi/v1/ticker/24hr"),
    [],
  );
  const futuresExchangeInfo = options.fast
    ? { symbols: futuresExchangeSymbolsFromTickers(futuresTickers) }
    : await optionalCatalogRequest(
      (signal) => fetchBinanceFutures<BinanceExchangeInfo>("/fapi/v1/exchangeInfo", {}, signal),
      { symbols: futuresExchangeSymbolsFromTickers(futuresTickers) },
      15_000,
    );
  const spotTickers = options.fast
    ? []
    : await optionalCatalogRequest(
      () => fetchBinanceSpot<BinanceTicker24h[]>("/api/v3/ticker/24hr", { type: "MINI" }),
      [],
    );
  const spotExchangeInfo = options.fast
    ? { symbols: [] }
    : await optionalCatalogRequest(
      (signal) => fetchBinanceSpot<BinanceExchangeInfo>("/api/v3/exchangeInfo", {
        permissions: "SPOT",
        symbolStatus: "TRADING",
      }, signal),
      { symbols: spotExchangeSymbolsFromTickers(spotTickers) },
      15_000,
    );
  if (!(futuresExchangeInfo.symbols?.length || spotExchangeInfo.symbols?.length || futuresTickers.length || spotTickers.length)) {
    throw firstCatalogError || new Error("Binance market catalog is unavailable");
  }
  const futuresTickerBySymbol = new Map(
    futuresTickers.map((ticker) => [String(ticker.symbol || ""), ticker]),
  );
  const tradFiAssetClasses = new Map<string, TradingAssetClass>();
  for (const item of futuresExchangeInfo.symbols ?? []) {
    if (!isBinanceTradFiContract(item) || item.status !== "TRADING") continue;
    const baseAsset = String(item.baseAsset || "").trim().toUpperCase();
    if (!baseAsset || tradFiAssetClasses.has(baseAsset)) continue;
    tradFiAssetClasses.set(baseAsset, binanceTradFiAssetClass(item));
  }
  const futuresMarkets: TradingMarket[] = (futuresExchangeInfo.symbols ?? []).flatMap((item) => {
    const symbol = String(item.symbol || "");
    const baseAsset = String(item.baseAsset || "");
    const quoteAsset = String(item.quoteAsset || "");
    const contractType = String(item.contractType || "").trim().toUpperCase();
    const tradFi = isBinanceTradFiContract(item);
    if (
      !symbol
      || !baseAsset
      || (!tradFi && quoteAsset !== MARKET_QUOTE)
      || (contractType !== "PERPETUAL" && contractType !== "TRADIFI_PERPETUAL")
      || item.status !== "TRADING"
    ) return [];
    const ticker = futuresTickerBySymbol.get(symbol);
    const assetClass = tradFi ? binanceTradFiAssetClass(item) : "crypto";
    const contractLabel = tradFi ? "传统金融永续" : "永续";
    return [{
      id: `BINANCE:FUTURES:${symbol}`,
      provider: "binance",
      symbol,
      baseAsset,
      quoteAsset,
      displaySymbol: `${baseAsset}/${quoteAsset}`,
      description: `${baseAsset}/${quoteAsset} 币安${contractLabel}合约`,
      venue: MARKET_VENUE,
      assetClass,
      marketType: "perpetual",
      tag: "永续",
      markPrice: Number(ticker?.lastPrice || 0),
      changePercent: Number(ticker?.priceChangePercent || 0),
      volume24h: Number(ticker?.quoteVolume || 0),
      quoteAvailable: Number(ticker?.lastPrice || 0) > 0,
    }];
  });
  const spotTickerBySymbol = new Map(
    spotTickers.map((ticker) => [String(ticker.symbol || ""), ticker]),
  );
  const spotMarkets: TradingMarket[] = (spotExchangeInfo.symbols ?? []).flatMap((item) => {
    const symbol = String(item.symbol || "");
    const baseAsset = String(item.baseAsset || "");
    const quoteAsset = String(item.quoteAsset || "");
    const tradFiAssetClass = binanceTradFiSpotAssetClass(baseAsset, tradFiAssetClasses);
    if (
      !symbol
      || !baseAsset
      || (!tradFiAssetClass && quoteAsset !== MARKET_QUOTE)
      || item.status !== "TRADING"
      || item.isSpotTradingAllowed === false
    ) return [];
    const ticker = spotTickerBySymbol.get(symbol);
    const lastPrice = Number(ticker?.lastPrice || 0);
    const openPrice = Number(ticker?.openPrice || 0);
    const changePercent = Number(ticker?.priceChangePercent);
    return [{
      id: `BINANCE:SPOT:${symbol}`,
      provider: "binance",
      symbol,
      baseAsset,
      quoteAsset,
      displaySymbol: `${baseAsset}/${quoteAsset}`,
      description: `${baseAsset}/${quoteAsset} 币安${tradFiAssetClass ? "传统金融" : ""}现货`,
      venue: MARKET_VENUE,
      assetClass: tradFiAssetClass || "crypto",
      marketType: "spot",
      tag: "现货",
      markPrice: lastPrice,
      changePercent: Number.isFinite(changePercent)
        ? changePercent
        : openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0,
      volume24h: Number(ticker?.quoteVolume || 0),
      quoteAvailable: lastPrice > 0,
    }];
  });
  return [...futuresMarkets, ...spotMarkets]
    .sort((first, second) => second.volume24h - first.volume24h);
}

async function fetchTradingMarketStats(
  symbol: string,
  marketType: Extract<TradingMarketType, "perpetual" | "spot"> = "perpetual",
): Promise<TradingMarketStats> {
  if (marketType === "spot") {
    const ticker = await fetchBinanceSpot<BinanceTicker24h>("/api/v3/ticker/24hr", { symbol });
    const markPrice = Number(ticker.lastPrice || 0);
    return {
      symbol,
      markPrice,
      midPrice: markPrice,
      oraclePrice: 0,
      openInterest: 0,
      fundingRate: 0,
      nextFundingTime: 0,
      prevDayPrice: Number(ticker.openPrice || 0),
      volume24h: Number(ticker.quoteVolume || 0),
    };
  }
  const [premium, openInterest, ticker] = await Promise.all([
    fetchBinanceFutures<BinancePremiumIndex>("/fapi/v1/premiumIndex", { symbol }),
    fetchBinanceFutures<BinanceOpenInterest>("/fapi/v1/openInterest", { symbol }),
    fetchBinanceFutures<BinanceTicker24h>("/fapi/v1/ticker/24hr", { symbol }),
  ]);
  const markPrice = Number(premium.markPrice || ticker.lastPrice || 0);
  return {
    symbol,
    markPrice,
    midPrice: Number(ticker.lastPrice || markPrice),
    oraclePrice: Number(premium.indexPrice || 0),
    openInterest: Number(openInterest.openInterest || 0),
    fundingRate: Number(premium.lastFundingRate || 0),
    nextFundingTime: Number(premium.nextFundingTime || 0),
    prevDayPrice: Number(ticker.openPrice || 0),
    volume24h: Number(ticker.quoteVolume || 0),
  };
}

export async function fetchTradingCandles(
  symbol: string,
  resolution: string,
  count = 500,
  endTime = Date.now(),
  marketType: Extract<TradingMarketType, "perpetual" | "spot"> = "perpetual",
  signal?: AbortSignal,
): Promise<TradingCandleBatch> {
  const source = binanceResolutionSource(resolution);
  if (!source) throw new Error(`Unsupported TradingView resolution: ${resolution}`);
  if (!source.sourceInterval || !source.sourceMs) {
    const trades = await fetchBinanceAggregateTrades(symbol, marketType, { endTime }, signal);
    return {
      candles: aggregateBinanceTrades(trades, source.targetMs).slice(-count),
      sourceCandles: [],
      source,
      lastTradeId: Number(trades.at(-1)?.a || 0) || undefined,
    };
  }
  const ratio = Math.max(1, Math.ceil(source.targetMs / source.sourceMs));
  let remaining = Math.min(Math.max(count * ratio + ratio, count), 15_000);
  let cursor = Math.floor(endTime);
  let sourceCandles: TradingCandle[] = [];
  for (let page = 0; page < 10 && remaining > 0; page += 1) {
    const limit = Math.min(remaining, marketType === "spot" ? 1_000 : 1_500);
    const currentMs = Date.now();
    const latestPage = page === 0
      && cursor >= currentMs - 60_000
      && cursor <= currentMs + 5_000;
    const items = await fetchBinanceMarket<unknown[][]>(marketType, "/fapi/v1/klines", "/api/v3/klines", {
      symbol,
      interval: source.sourceInterval,
      // Binance already defaults to the latest closed/forming candles. Omitting
      // a near-now timestamp gives every client the same cache key instead of
      // forcing a unique domestic-gateway miss on every screen load.
      endTime: latestPage ? undefined : cursor,
      limit,
    }, signal);
    const batch = normalizeBinanceCandles(items);
    if (!batch.length) break;
    sourceCandles = mergeCandles(batch, sourceCandles);
    remaining -= batch.length;
    cursor = batch[0].time * 1000 - 1;
    if (batch.length < limit) break;
  }
  const candles = source.sourceMs === source.targetMs
    ? sourceCandles
    : aggregateTradingCandles(sourceCandles, source.targetMs);
  return { candles: candles.slice(-count), sourceCandles, source };
}

export function hyperliquidIntervalForTradingResolution(resolution: string) {
  const normalized = String(resolution || "").trim().toUpperCase();
  if (normalized === "1D") return "1d";
  if (normalized === "1W") return "1w";
  const minutes = Number(normalized);
  return new Map<number, string>([
    [1, "1m"], [3, "3m"], [5, "5m"], [15, "15m"], [30, "30m"],
    [60, "1h"], [120, "2h"], [240, "4h"], [480, "8h"], [720, "12h"], [4_320, "3d"],
  ]).get(minutes) || null;
}

interface TradingSmtComparisonMarket {
  marketId: string;
  symbol: string;
  source: "hyperliquid-public";
  kind: "venue-confirmation" | "correlated-market";
  candles: TradingCandle[];
}

function normalizeHyperliquidCandles(value: unknown): TradingCandle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any): TradingCandle[] => {
    const candle = {
      time: Math.floor(Number(item?.t) / 1_000),
      open: Number(item?.o),
      high: Number(item?.h),
      low: Number(item?.l),
      close: Number(item?.c),
      volume: Math.max(0, Number(item?.v) || 0),
    };
    if (
      !Number.isFinite(candle.time)
      || candle.time <= 0
      || candle.low <= 0
      || candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)
    ) return [];
    return [candle];
  }).sort((first, second) => first.time - second.time);
}

async function fetchHyperliquidComparisonCandles(
  coin: string,
  interval: string,
  count: number,
  endTime: number,
) {
  const request = window.codexDesktop?.getHyperliquidPublicCandles;
  const hyperliquidInterval = hyperliquidIntervalForTradingResolution(interval);
  const durationMs = tradingViewResolutionDurationMs(interval);
  if (typeof request !== "function" || !hyperliquidInterval || !durationMs) return [];
  const response = await request({
    coin,
    interval: hyperliquidInterval,
    startTime: Math.max(1, endTime - durationMs * Math.min(5_000, Math.max(80, count + 8))),
    endTime,
  });
  if (!response?.ok) throw new Error(String(response?.error || "Hyperliquid 行情请求失败"));
  return normalizeHyperliquidCandles(response.data).slice(-Math.min(600, count));
}

export async function fetchTradingSmtComparisonMarkets(
  market: Pick<TradingMarket, "id" | "symbol" | "baseAsset">,
  interval: string,
  count = 500,
  endTime = Date.now(),
): Promise<TradingSmtComparisonMarket[]> {
  const baseAsset = String(market.baseAsset || market.symbol.replace(/(?:USDT|USDC|USD)$/i, "")).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(baseAsset)) return [];
  const correlatedCoin = baseAsset === "BTC" ? "ETH" : "BTC";
  const requests = await Promise.allSettled([
    fetchHyperliquidComparisonCandles(baseAsset, interval, count, endTime),
    fetchHyperliquidComparisonCandles(correlatedCoin, interval, count, endTime),
  ]);
  const sameAsset = requests[0].status === "fulfilled" ? requests[0].value : [];
  const correlated = requests[1].status === "fulfilled" ? requests[1].value : [];
  return [
    ...(sameAsset.length >= 30 ? [{ marketId: `HYPERLIQUID:PERP:${baseAsset}`, symbol: baseAsset, source: "hyperliquid-public" as const, kind: "venue-confirmation" as const, candles: sameAsset }] : []),
    ...(correlated.length >= 30 ? [{ marketId: `HYPERLIQUID:PERP:${correlatedCoin}`, symbol: correlatedCoin, source: "hyperliquid-public" as const, kind: "correlated-market" as const, candles: correlated }] : []),
  ];
}

async function fetchBinanceAggregateTrades(
  symbol: string,
  marketType: Extract<TradingMarketType, "perpetual" | "spot">,
  options: { endTime?: number; fromId?: number } = {},
  signal?: AbortSignal,
) {
  return fetchBinanceMarket<BinanceAggregateTrade[]>(marketType, "/fapi/v1/aggTrades", "/api/v3/aggTrades", {
    symbol,
    endTime: options.endTime === undefined ? undefined : Math.floor(options.endTime),
    fromId: options.fromId,
    limit: 1_000,
  }, signal);
}

function binanceOpenInterestPeriod(resolution: string) {
  const duration = tradingViewResolutionDurationMs(resolution) || 300_000;
  const periods = [
    [5 * 60_000, "5m"],
    [15 * 60_000, "15m"],
    [30 * 60_000, "30m"],
    [60 * 60_000, "1h"],
    [2 * 60 * 60_000, "2h"],
    [4 * 60 * 60_000, "4h"],
    [6 * 60 * 60_000, "6h"],
    [12 * 60 * 60_000, "12h"],
    [24 * 60 * 60_000, "1d"],
  ] as const;
  return periods.find(([periodMs]) => duration <= periodMs)?.[1] || "1d";
}

export async function fetchTradingOrderFlowWindow(
  symbol: string,
  resolution: string,
  currentOpenInterest: number | null = null,
): Promise<TradingOrderFlowWindow> {
  const openInterestPromise = fetchBinanceFutures<BinanceOpenInterestHistoryPoint[]>(
    "/futures/data/openInterestHist",
    {
      symbol,
      period: binanceOpenInterestPeriod(resolution),
      limit: 30,
    },
  ).catch(() => null);
  const [aggregateTrades, depth, openInterestHistoryResponse] = await Promise.all([
    fetchBinanceAggregateTrades(symbol, "perpetual"),
    fetchBinanceFutures<BinanceDepthSnapshot>("/fapi/v1/depth", { symbol, limit: 100 }),
    openInterestPromise,
  ]);
  const trades = aggregateTrades.flatMap((trade) => {
    const id = Number(trade.a);
    const timeMs = Number(trade.T);
    const price = Number(trade.p);
    const quantity = Number(trade.q);
    if (
      !Number.isFinite(id)
      || !Number.isFinite(timeMs)
      || !Number.isFinite(price)
      || !Number.isFinite(quantity)
      || timeMs <= 0
      || price <= 0
      || quantity <= 0
    ) return [];
    return [{
      id: String(id),
      time: timeMs / 1_000,
      price,
      quantity,
      // Binance m=true means the buyer was the maker, so the aggressor sold.
      side: trade.m === true ? "sell" as const : "buy" as const,
    }];
  }).sort((first, second) => first.time - second.time);
  const normalizeDepth = (levels: Array<[string, string]> | undefined) => (levels || []).flatMap((level) => {
    const price = Number(level?.[0]);
    const quantity = Number(level?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity < 0) return [];
    return [{ price, quantity }];
  });
  const bids = normalizeDepth(depth.bids).sort((first, second) => second.price - first.price);
  const asks = normalizeDepth(depth.asks).sort((first, second) => first.price - second.price);
  const openInterestHistory = (openInterestHistoryResponse || []).flatMap((point) => {
    const timeMs = Number(point.timestamp);
    const value = Number(point.sumOpenInterest);
    if (!Number.isFinite(timeMs) || !Number.isFinite(value) || timeMs <= 0 || value < 0) return [];
    return [{ time: timeMs / 1_000, value }];
  }).sort((first, second) => first.time - second.time);
  const normalizedCurrentOpenInterest = Number(currentOpenInterest);
  return {
    source: "binance-rest",
    windowStart: trades[0]?.time || 0,
    windowEnd: trades.at(-1)?.time || 0,
    trades,
    depth: {
      snapshotTime: Number(depth.T || depth.E || Date.now()),
      lastUpdateId: Math.max(0, Number(depth.lastUpdateId) || 0),
      bids,
      asks,
    },
    openInterest: {
      current: Number.isFinite(normalizedCurrentOpenInterest) && normalizedCurrentOpenInterest >= 0
        ? normalizedCurrentOpenInterest
        : null,
      history: openInterestHistory,
    },
    coverage: {
      trades: trades.length >= 50 ? "available" : trades.length ? "partial" : "unavailable",
      // A REST book is real depth, but only a point-in-time snapshot; it does not
      // claim incremental cancel/replace coverage.
      depth: bids.length >= 5 && asks.length >= 5 ? "partial" : "unavailable",
      openInterest: openInterestHistory.length >= 2
        ? "available"
        : Number.isFinite(normalizedCurrentOpenInterest) ? "partial" : "unavailable",
      liquidations: "unavailable",
    },
  };
}

export function tradingMarketStructureContextResolutions(resolution: string) {
  const duration = tradingViewResolutionDurationMs(resolution) || 0;
  if (duration > 0 && duration <= 15 * 60_000) return ["60", "240", "1D"];
  if (duration > 0 && duration <= 60 * 60_000) return ["240", "1D"];
  if (duration > 0 && duration <= 4 * 60 * 60_000) return ["1D", "1W"];
  if (duration > 0 && duration <= 24 * 60 * 60_000) return ["1W"];
  return [];
}

export async function fetchTradingMarketStructureContexts(
  symbol: string,
  resolution: string,
): Promise<TradingMarketStructureContext[]> {
  const results = await Promise.all(tradingMarketStructureContextResolutions(resolution).map(async (interval) => {
    try {
      const batch = await fetchTradingCandles(symbol, interval, 240, Date.now(), "perpetual");
      return batch.candles.length >= 30 ? { interval, candles: batch.candles } : null;
    } catch {
      return null;
    }
  }));
  return results.filter((item): item is TradingMarketStructureContext => Boolean(item));
}

function normalizeBinanceCandles(items: unknown[][]): TradingCandle[] {
  return items
    .map((item) => ({
      time: Math.floor(Number(item[0] || 0) / 1000),
      open: Number(item[1] || 0),
      high: Number(item[2] || 0),
      low: Number(item[3] || 0),
      close: Number(item[4] || 0),
      volume: Number(item[5] || 0),
    }))
    .filter((item) =>
      item.time > 0
      && Number.isFinite(item.open)
      && Number.isFinite(item.high)
      && Number.isFinite(item.low)
      && Number.isFinite(item.close)
    );
}

export function aggregateTradingCandles(items: TradingCandle[], targetMs: number) {
  const buckets = new Map<number, TradingCandle>();
  items.slice().sort((first, second) => first.time - second.time).forEach((item) => {
    const bucketTime = Math.floor((item.time * 1000) / targetMs) * targetMs / 1000;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, { ...item, time: bucketTime });
      return;
    }
    current.high = Math.max(current.high, item.high);
    current.low = Math.min(current.low, item.low);
    current.close = item.close;
    current.volume = Number(current.volume || 0) + Number(item.volume || 0);
  });
  return Array.from(buckets.values()).sort((first, second) => first.time - second.time);
}

function aggregateBinanceTrades(items: BinanceAggregateTrade[], targetMs: number) {
  const candles = items.flatMap((item) => {
    const timeMs = Number(item.T || 0);
    const price = Number(item.p || 0);
    const volume = Number(item.q || 0);
    if (timeMs <= 0 || !Number.isFinite(price) || price <= 0) return [];
    return [{
      time: Math.floor(timeMs / targetMs) * targetMs / 1000,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
    }];
  });
  return aggregateTradingCandles(candles, targetMs);
}

function mergeCandles(current: TradingCandle[], incoming: TradingCandle[]) {
  const map = new Map<number, TradingCandle>();
  current.forEach((item) => map.set(item.time, item));
  incoming.forEach((item) => map.set(item.time, item));
  return Array.from(map.values()).sort((first, second) => first.time - second.time);
}

export function computeEma(values: number[], span: number) {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < span) return result;
  let sum = 0;
  for (let index = 0; index < span; index += 1) sum += values[index];
  result[span - 1] = sum / span;
  const factor = 2 / (span + 1);
  for (let index = span; index < values.length; index += 1) {
    result[index] = values[index] * factor + result[index - 1] * (1 - factor);
  }
  return result;
}

export function computeSma(values: number[], windowSize: number) {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < windowSize) return result;
  let sum = 0;
  for (let index = 0; index < windowSize; index += 1) sum += values[index];
  result[windowSize - 1] = sum / windowSize;
  for (let index = windowSize; index < values.length; index += 1) {
    sum += values[index] - values[index - windowSize];
    result[index] = sum / windowSize;
  }
  return result;
}

export function computeBollingerBands(
  values: number[],
  period = 20,
  multiplier = 2,
) {
  const middle = computeSma(values, period);
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

export function computeBbi(values: number[], periods = [3, 6, 12, 24]) {
  const averages = periods.map((period) => computeSma(values, period));
  return values.map((_, index) => {
    const items = averages.map((average) => average[index]);
    return items.every(Number.isFinite)
      ? items.reduce((sum, value) => sum + value, 0) / items.length
      : Number.NaN;
  });
}

export function computeTdSequential(candles: TradingCandle[], targetCount = 9): TdSequentialSignal[] {
  const signals: TdSequentialSignal[] = [];
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

function nicePriceScaleStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const niceFraction = fraction < 1.5
    ? 1
    : fraction < 2.25
      ? 2
      : fraction < 3.75
        ? 2.5
        : fraction < 7.5
          ? 5
          : 10;
  return niceFraction * magnitude;
}

export function fixedPriceScaleRange(
  candles: TradingCandle[],
  paddingRatio = 0.02,
  targetSteps = 16,
) {
  const highs = candles.map((candle) => candle.high).filter(Number.isFinite);
  const lows = candles.map((candle) => candle.low).filter(Number.isFinite);
  if (!highs.length || !lows.length) return null;
  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);
  const span = highest > lowest
    ? highest - lowest
    : Math.max(Math.abs(highest) * 0.04, 1e-8);
  const padding = span * Math.max(paddingRatio, 0);
  const step = nicePriceScaleStep(span / Math.max(targetSteps, 1));
  const from = Math.floor((lowest - padding) / step) * step;
  const to = Math.ceil((highest + padding) / step) * step;
  return {
    from: Number(from.toPrecision(12)),
    to: Number(to.toPrecision(12)),
  };
}

export function visibleCandlesInLogicalRange(
  candles: TradingCandle[],
  range: { from: number; to: number } | null,
) {
  if (
    !candles.length
    || !range
    || !Number.isFinite(range.from)
    || !Number.isFinite(range.to)
  ) return [];
  const rangeStart = Math.min(range.from, range.to);
  const rangeEnd = Math.max(range.from, range.to);
  const from = Math.max(0, Math.floor(rangeStart));
  const to = Math.min(candles.length - 1, Math.ceil(rangeEnd));
  return from <= to ? candles.slice(from, to + 1) : [];
}

export function initialMarketLogicalRange(candleCount: number, resolution: string) {
  const total = Math.max(0, Math.trunc(candleCount));
  if (!total) return null;
  const visibleBars = Math.min(total, resolution === "1D" ? 180 : 100);
  return {
    from: total - visibleBars,
    to: total + 5,
  };
}

async function fetchLatestTradingCandles(
  symbol: string,
  resolution: string,
  sourceStartTime?: number,
  fromTradeId?: number,
  marketType: Extract<TradingMarketType, "perpetual" | "spot"> = "perpetual",
  signal?: AbortSignal,
): Promise<TradingCandleBatch> {
  const source = binanceResolutionSource(resolution);
  if (!source) throw new Error(`Unsupported TradingView resolution: ${resolution}`);
  if (!source.sourceInterval || !source.sourceMs) {
    let trades: BinanceAggregateTrade[] = [];
    let nextTradeId = fromTradeId;
    for (let page = 0; page < (fromTradeId ? 4 : 1); page += 1) {
      const batch = await fetchBinanceAggregateTrades(symbol, marketType, nextTradeId
        ? { fromId: nextTradeId }
        : { endTime: Date.now() }, signal);
      if (!batch.length) break;
      const byId = new Map(trades.map((trade) => [Number(trade.a), trade]));
      batch.forEach((trade) => byId.set(Number(trade.a), trade));
      trades = [...byId.values()].sort((first, second) => Number(first.a) - Number(second.a));
      if (batch.length < 1_000) break;
      const lastId = Number(batch.at(-1)?.a || 0);
      if (!Number.isFinite(lastId) || lastId < 1) break;
      nextTradeId = lastId + 1;
    }
    return {
      candles: aggregateBinanceTrades(trades, source.targetMs),
      sourceCandles: [],
      source,
      lastTradeId: Number(trades.at(-1)?.a || 0) || undefined,
    };
  }
  const limit = sourceStartTime === undefined ? 2 : marketType === "spot" ? 1_000 : 1_500;
  const maxPages = sourceStartTime === undefined ? 1 : 4;
  let cursor = sourceStartTime;
  let sourceCandles: TradingCandle[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const items = await fetchBinanceMarket<unknown[][]>(marketType, "/fapi/v1/klines", "/api/v3/klines", {
      symbol,
      interval: source.sourceInterval,
      startTime: cursor,
      limit,
    }, signal);
    const batch = normalizeBinanceCandles(items);
    if (!batch.length) break;
    sourceCandles = mergeCandles(sourceCandles, batch);
    if (batch.length < limit || cursor === undefined) break;
    const nextCursor = batch.at(-1)!.time * 1_000 + source.sourceMs;
    if (nextCursor <= cursor || nextCursor > Date.now()) break;
    cursor = nextCursor;
  }
  return {
    candles: source.sourceMs === source.targetMs
      ? sourceCandles
      : aggregateTradingCandles(sourceCandles, source.targetMs),
    sourceCandles,
    source,
  };
}

export function tradingCandleBatchCanRefreshIncrementally(
  batch: TradingCandleBatch,
  now = Date.now(),
  maxMissingSourceCandles = 4_000,
) {
  const source = batch.source;
  const latest = (source.sourceInterval ? batch.sourceCandles.at(-1) : null)
    || batch.candles.at(-1);
  const stepMs = Number(source.sourceMs || source.targetMs || 0);
  if (!latest || stepMs <= 0) return false;
  const missing = Math.max(0, Math.ceil((now - latest.time * 1_000) / stepMs));
  return missing <= Math.max(1, Math.floor(maxMissingSourceCandles));
}

export function atm1TrendCandles(
  candles: TradingCandle[],
  fastPeriod = 20,
  slowPeriod = 60,
): Atm1Bar[] {
  const closes = candles.map((item) => item.close);
  const fast = computeEma(closes, fastPeriod);
  const slow = computeEma(closes, slowPeriod);
  return candles.map((candle, index) => {
    const emaFast = fast[index];
    const emaSlow = slow[index];
    let state: TrendState = "unclassified";
    if (!Number.isNaN(emaFast) && !Number.isNaN(emaSlow)) {
      if (candle.close >= emaFast && emaFast >= emaSlow) state = "bull_trend";
      else if (candle.close <= emaFast && emaFast <= emaSlow) state = "bear_trend";
      else if (candle.close <= emaFast && emaFast >= emaSlow) {
        state = "close_below_fast_fast_above_slow";
      } else if (candle.close >= emaFast && emaFast <= emaSlow) {
        state = "close_above_fast_fast_below_slow";
      }
    }
    return { ...candle, emaFast, emaSlow, state };
  });
}

export function atm4MaBand(
  candles: TradingCandle[],
  firstPeriod = 55,
  secondPeriod = 60,
): Atm4Bar[] {
  const closes = candles.map((item) => item.close);
  const values = [
    computeSma(closes, firstPeriod),
    computeEma(closes, firstPeriod),
    computeSma(closes, secondPeriod),
    computeEma(closes, secondPeriod),
  ];
  return candles.map((candle, index) => {
    const bandValues = values
      .map((series) => series[index])
      .filter((value) => !Number.isNaN(value));
    return {
      time: candle.time,
      bandUpper: bandValues.length ? Math.max(...bandValues) : Number.NaN,
      bandLower: bandValues.length ? Math.min(...bandValues) : Number.NaN,
    };
  });
}

export function atm4BandSeriesData(
  band: ReadonlyArray<Atm4Bar>,
  side: "bandUpper" | "bandLower",
  visible = true,
) {
  return band.map((item) => {
    const time = item.time + CHINA_TIME_OFFSET_SECONDS;
    const value = visible ? item[side] : Number.NaN;
    return Number.isFinite(value) ? { time, value } : { time };
  });
}

function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

function formatPrice(value: number, digits = 1) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function marketPriceFormatFor(value: number) {
  void value;
  return { ...MARKET_PRICE_FORMAT };
}

export function marketFocusedPriceFormatFor(value: number) {
  if (!Number.isFinite(value)) return { ...MARKET_PRICE_FORMAT };
  const absolute = Math.abs(value);
  const integerDigits = absolute >= 1
    ? Math.floor(Math.log10(Math.floor(absolute))) + 1
    : 1;
  const precision = Math.max(MARKET_PRICE_FORMAT.precision, 6 - integerDigits);
  return {
    type: "price" as const,
    precision,
    minMove: 10 ** -precision,
  };
}

function binanceMarketFromAnalysisContext(context: TradingLastAnalysisContext) {
  const match = /^BINANCE:(FUTURES|SPOT):([A-Z0-9]{2,40})$/.exec(context.marketId);
  if (!match) return null;
  const marketType: Extract<TradingMarketType, "perpetual" | "spot"> = match[1] === "SPOT"
    ? "spot"
    : "perpetual";
  const symbol = match[2];
  const baseAsset = baseAssetFromSymbol(symbol);
  return {
    id: context.marketId,
    provider: "binance" as const,
    symbol,
    baseAsset,
    quoteAsset: MARKET_QUOTE,
    displaySymbol: `${baseAsset}/${MARKET_QUOTE}`,
    description: `${baseAsset}/${MARKET_QUOTE} 币安${marketType === "spot" ? "现货" : "永续合约"}`,
    venue: MARKET_VENUE,
    assetClass: "crypto" as const,
    marketType,
    tag: marketType === "spot" ? "现货" : "永续",
    markPrice: 0,
    changePercent: 0,
    volume24h: 0,
    quoteAvailable: false,
  };
}

export function formatTradingMarketTickerPrice(value: number) {
  const precision = Number.isFinite(value) && Math.abs(value) < 1
    ? marketFocusedPriceFormatFor(value).precision
    : MARKET_PRICE_FORMAT.precision;
  return formatPrice(value, precision);
}

function formatOhlcPrice(value: number) {
  return value.toFixed(MARKET_PRICE_FORMAT.precision);
}

function formatFocusedPrice(value: number) {
  return value.toFixed(marketFocusedPriceFormatFor(value).precision);
}

function formatOhlcDateTime(timeValue: number) {
  const date = new Date(timeValue * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatCompactValue(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatFundingCountdown(now: number, nextFundingTime: number) {
  const difference = Math.max(nextFundingTime - now, 0);
  const hours = Math.floor(difference / 3_600_000);
  const minutes = Math.floor((difference % 3_600_000) / 60_000);
  const seconds = Math.floor((difference % 60_000) / 1000);
  return [hours, minutes, seconds]
    .map((item) => item.toString().padStart(2, "0"))
    .join(":");
}

export function binanceAssetLogoUrl(asset: string) {
  return binanceTradingMarketAssetLogoUrl(asset);
}

function hyperliquidAssetLogoUrl(asset: string) {
  return hyperliquidTradingMarketAssetLogoUrl(asset);
}

function renderMarketFavoriteIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2.75 2.85 5.77 6.37.93-4.61 4.49 1.09 6.34L12 18.29l-5.7 2.99 1.09-6.34-4.61-4.49 6.37-.93L12 2.75Z"/>
    </svg>
  `;
}

function baseAssetFromSymbol(symbol: string) {
  return symbol.endsWith(MARKET_QUOTE)
    ? symbol.slice(0, -MARKET_QUOTE.length)
    : symbol;
}

function chartTickLabel(timeValue: number, interval: string) {
  const date = new Date(timeValue * 1000);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(hour)}:${pad(minute)}`;
  const monthDay = `${pad(month)}/${pad(day)}`;
  if (interval === "1" || interval === "5") {
    if (minute !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (interval === "15") {
    if (minute !== 0 || hour % 6 !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (interval === "60") {
    if (minute !== 0 || hour % 12 !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (interval === "240") return minute === 0 && hour === 0 ? monthDay : null;
  if (interval === "1D") {
    return day === 1 ? `${date.getUTCFullYear()}/${pad(month)}` : null;
  }
  return null;
}

function renderTimeButtons(
  periods: ReadonlyArray<TradingPeriod> = DEFAULT_TRADING_PERIODS,
  activeResolution = DEFAULT_INTERVAL,
) {
  return periods.map((period) => {
    const resolution = tradingViewResolution(period);
    return `
    <button
      type="button"
      data-market-action="interval"
      data-market-interval="${resolution}"
      data-i18n-trading-period-label
      aria-pressed="${resolution === activeResolution ? "true" : "false"}"
      class="${resolution === activeResolution ? "active" : ""}"
    >${tradingPeriodLabel(period)}</button>
  `;
  }).join("");
}

function renderPeriodEditorShell() {
  return `
    <section
      class="trading-market-period-editor"
      data-market-period-editor
      role="dialog"
      aria-label="自定义K线周期"
      hidden
    >
      <div class="trading-market-period-editor-head">
        <strong>已添加项</strong>
        <span>拖动可排序</span>
      </div>
      <div class="trading-market-period-items" data-market-period-items></div>
      <div class="trading-market-period-add">
        <strong>新增周期</strong>
        <div class="trading-market-period-add-controls">
          <input
            type="number"
            min="1"
            max="10000"
            step="1"
            value="1"
            inputmode="numeric"
            data-market-period-amount
            aria-label="周期数值"
          />
          <div
            class="video-expert-select trading-market-period-unit-picker"
            data-market-period-unit-picker
          >
            <button
              type="button"
              class="video-expert-select-button"
              data-market-action="toggle-period-unit"
              aria-label="周期单位"
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              <span data-market-period-unit-label>分</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </button>
            <div
              class="video-expert-select-menu trading-market-period-unit-menu"
              data-market-period-unit-menu
              role="listbox"
              aria-label="周期单位"
              hidden
            >
              <button type="button" class="selected" data-market-action="period-unit" data-market-period-unit="m" role="option" aria-selected="true">分</button>
              <button type="button" data-market-action="period-unit" data-market-period-unit="h" role="option" aria-selected="false">时</button>
              <button type="button" data-market-action="period-unit" data-market-period-unit="d" role="option" aria-selected="false">日</button>
            </div>
          </div>
          <button type="button" data-market-action="add-period">添加</button>
        </div>
        <p data-market-period-status aria-live="polite"></p>
      </div>
      <footer class="trading-market-period-editor-actions">
        <span>最多展示 ${MAX_TRADING_PERIODS} 个</span>
        <button type="button" data-market-action="restore-periods">恢复默认</button>
        <button type="button" class="primary" data-market-action="confirm-periods">确定</button>
      </footer>
    </section>
  `;
}

function renderIndicatorButtons() {
  return TRADING_INDICATORS
    .filter((indicator) => !HIDDEN_TRADING_INDICATORS.has(indicator.id))
    .map((indicator) => `
    <button
      type="button"
      data-market-action="indicator"
      data-market-indicator="${indicator.id}"
      aria-pressed="false"
      title="${indicator.name}${indicator.parameters ? ` (${indicator.parameters})` : ""}"
    >${indicator.label}</button>
  `).join("");
}

function renderMainIndicatorButtons() {
  return TRADING_MAIN_INDICATORS.map((indicator) => `
    <button
      type="button"
      data-market-action="main-indicator"
      data-market-main-indicator="${indicator.id}"
      aria-pressed="false"
      title="${indicator.name} (${indicator.parameters})"
    >${indicator.label}</button>
  `).join("");
}

function renderTradingMarketIndicatorBar() {
  return `
    <footer class="trading-market-indicator-bar" aria-label="技术指标">
      <button
        type="button"
        class="trading-market-indicator-heading"
        data-market-action="toggle-indicator-editor"
        aria-haspopup="dialog"
        aria-expanded="false"
      >
        自定义指标
        <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
      </button>
      <div class="trading-market-main-indicators" data-market-main-indicators aria-label="主图指标">
        ${renderMainIndicatorButtons()}
      </div>
      <div class="trading-market-indicators" data-market-indicators aria-label="副图指标">
        ${renderIndicatorButtons()}
      </div>
    </footer>
  `;
}

function renderIndicatorEditorShell() {
  return `
    <div class="trading-market-indicator-editor-backdrop" data-market-indicator-editor hidden>
      <section
        class="trading-market-indicator-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trading-market-indicator-editor-title"
      >
        <header class="trading-market-indicator-editor-header">
          <div>
            <strong id="trading-market-indicator-editor-title">自定义指标</strong>
            <span>选择指标并调整参数与显示</span>
          </div>
          <div class="trading-market-indicator-editor-header-actions">
            <button type="button" data-market-action="restore-indicator-settings">恢复默认</button>
            <button type="button" class="close" data-market-action="close-indicator-editor" aria-label="关闭自定义指标">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg>
            </button>
          </div>
        </header>
        <div class="trading-market-indicator-editor-body">
          <aside class="trading-market-indicator-catalog" data-market-indicator-catalog aria-label="指标列表"></aside>
          <main class="trading-market-indicator-detail" data-market-indicator-detail></main>
        </div>
        <footer class="trading-market-indicator-editor-footer">
          <span data-market-indicator-status aria-live="polite">修改将在保存后应用到图表</span>
          <button type="button" class="primary" data-market-action="save-indicator-settings">保存</button>
        </footer>
      </section>
    </div>
  `;
}

function renderMarketChartActions() {
  return `
    <div class="trading-market-chart-actions" role="group" aria-label="图表操作">
      <button
        type="button"
        class="trading-market-chart-action"
        data-market-action="open-chart-settings"
        aria-label="图表设置"
        aria-haspopup="dialog"
        aria-expanded="false"
        title="设置"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button
        type="button"
        class="trading-market-chart-action"
        data-market-action="open-split-layouts"
        aria-label="选择分屏布局"
        aria-haspopup="dialog"
        aria-expanded="false"
        title="分屏"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="1.5"/><path d="M10 3v14"/></svg>
      </button>
      ${renderTradingSplitLayoutPicker()}
    </div>
  `;
}

export function renderTradingExpertMarketWorkspace() {
  return `
    <section class="trading-expert-market" data-trading-market-workspace aria-label="实时交易行情">
      <div class="trading-market-workspace-body">
        ${renderTradingDrawingToolbar()}
        <div class="trading-market-content">
          <div class="trading-market-overview">
        <div class="trading-market-symbol-wrap">
          <button
            type="button"
            class="trading-market-symbol"
            data-market-action="toggle-symbols"
            aria-haspopup="dialog"
            aria-expanded="false"
          >
            ${renderTradingMarketAssetLogo("BTC", "binance", true)}
            <strong><span data-market-symbol>BTC</span><span data-market-quote>/${MARKET_QUOTE}</span></strong>
            <span class="trading-market-venue" data-market-current-venue>${MARKET_VENUE}</span>
            <span class="trading-market-contract-tag" data-market-current-tag>永续</span>
            <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
          </button>
          <div class="trading-market-picker" data-market-picker role="dialog" aria-label="选择交易品种" hidden>
            <div class="trading-market-picker-search">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
              <input type="search" data-market-search placeholder="搜索交易对" autocomplete="off" />
            </div>
            <div class="trading-market-categories" data-market-categories role="tablist" aria-label="行情分类">
              ${TRADING_MARKET_CATEGORY_OPTIONS.map((option) => `
                <button
                  type="button"
                  data-market-action="market-category"
                  data-market-category="${option.id}"
                  role="tab"
                  aria-selected="${option.id === "all"}"
                  class="${option.id === "all" ? "active" : ""}"
                >${option.label}</button>
              `).join("")}
            </div>
            <div class="trading-market-picker-head">
              <span>名称</span><span>平台</span><span>最新价</span><span>24H涨幅</span><span>收藏</span>
            </div>
            <div class="trading-market-list" data-market-list role="list" aria-label="永续合约币种"></div>
          </div>
        </div>
        ${renderMarketChartActions()}
        <div
          class="trading-market-favorite-tickers"
          data-market-favorite-tickers
          aria-label="收藏币种实时行情"
          hidden
        ></div>
        <div class="trading-market-period-controls" data-market-period-controls>
          <button
            type="button"
            class="trading-market-period-trigger"
            data-market-action="toggle-period-editor"
            aria-haspopup="dialog"
            aria-expanded="false"
          >
            自定义周期
            <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
          </button>
          <div
            class="trading-market-split-period-menu trading-market-primary-period-menu"
            data-market-primary-period-menu
            role="listbox"
            aria-label="图表 1 自定义周期"
            hidden
          >${renderTimeButtons()}</div>
          <div class="trading-market-times" data-market-times aria-label="K线周期">${renderTimeButtons()}</div>
          <button
            type="button"
            class="small-icon-button panel-toggle trading-market-split-panel-restore expanded"
            data-action="toggle-right-panel"
            title="收起K线画布"
            aria-label="收起K线画布"
            aria-expanded="true"
          >
            <svg class="panel-layout-icon panel-layout-icon-right" viewBox="0 0 24 16" preserveAspectRatio="none" aria-hidden="true">
              <rect x="3" y="2" width="18" height="12" rx="2"></rect>
              <path d="M15 2v12"></path>
            </svg>
          </button>
          ${renderPeriodEditorShell()}
        </div>
          </div>
          <div class="trading-market-chart-grid" data-market-chart-grid data-market-layout="1-single">
          <div class="trading-market-chart-panel trading-market-primary-pane" data-market-primary-pane>
          <div class="trading-market-chart-viewport" data-market-chart-viewport>
            <div class="trading-market-chart" data-market-chart></div>
            ${renderTradingChartBrand()}
            <svg
              class="trading-market-volume-profile-layer"
              data-market-volume-profile-layer
              role="img"
              aria-label="可见范围成交量分布"
              hidden
            ></svg>
            ${renderTradingDrawingLayer()}
            <div class="trading-alert-simulation-annotations" data-alert-simulation-annotations>
              <div class="trading-alert-simulation-point" data-alert-simulation-point hidden aria-label="模拟触发"><span>模拟触发</span></div>
            </div>
            <time class="trading-market-crosshair-time" data-market-crosshair-time hidden></time>
            <div class="trading-market-focus-price crosshair" data-market-crosshair-price hidden></div>
            <div class="trading-market-focus-price current" data-market-current-price hidden></div>
            <time class="trading-market-candle-countdown" data-market-candle-countdown hidden></time>
            <div class="trading-market-indicator-legends-layer" data-market-indicator-legends aria-hidden="true"></div>
            <div
              class="trading-market-main-indicator-legends"
              data-market-main-indicator-legends
              aria-label="主图指标数据"
            ></div>
            <div class="trading-market-ohlc" data-market-ohlc aria-label="当前K线数据"></div>
            <div class="trading-market-loading" data-market-loading>
              <span></span>
              <p>正在加载实时行情…</p>
            </div>
            <button type="button" class="trading-market-error" data-market-action="retry" data-market-error hidden>
              行情加载失败，点击重试
            </button>
          </div>
          ${renderTradingMarketIndicatorBar()}
          </div>
          </div>
        </div>
      </div>
      ${renderIndicatorEditorShell()}
      ${renderTradingChartSettingsDialog()}
    </section>
  `;
}

class TradingExpertMarketWorkspace {
  private readonly host: HTMLElement;
  private readonly chartElement: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly drawingLayer: SVGSVGElement;
  private readonly loadingElement: HTMLElement;
  private readonly errorElement: HTMLButtonElement;
  private readonly ohlcElement: HTMLElement;
  private readonly crosshairTimeElement: HTMLTimeElement;
  private readonly crosshairPriceElement: HTMLElement;
  private readonly currentPriceElement: HTMLElement;
  private readonly candleCountdownElement: HTMLTimeElement;
  private readonly picker: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly marketList: HTMLElement;
  private readonly favoriteTickerBar: HTMLElement;
  private readonly favoriteTickerSortController: TradingFavoriteTickerSortController;
  private readonly indicatorLegendLayer: HTMLElement;
  private readonly mainIndicatorLegendElement: HTMLElement;
  private readonly volumeProfileLayer: SVGSVGElement;
  private readonly periodControls: HTMLElement;
  private readonly periodTimes: HTMLElement;
  private readonly primaryPeriodMenu: HTMLElement;
  private readonly periodEditor: HTMLElement;
  private readonly periodItems: HTMLElement;
  private readonly periodAmountInput: HTMLInputElement;
  private readonly periodUnitPicker: HTMLElement;
  private readonly periodUnitMenu: HTMLElement;
  private readonly periodUnitLabel: HTMLElement;
  private readonly periodStatus: HTMLElement;
  private readonly indicatorEditor: HTMLElement;
  private readonly indicatorCatalog: HTMLElement;
  private readonly indicatorDetail: HTMLElement;
  private readonly indicatorStatus: HTMLElement;
  private readonly marketOverview: HTMLElement;
  private readonly chartGrid: HTMLElement;
  private readonly primaryChartPane: HTMLElement;
  private readonly alertSimulationAnnotationLayer: HTMLElement;
  private readonly alertSimulationPointElement: HTMLElement;
  private layoutPicker: HTMLElement;
  private readonly layoutPickerHome: Comment;
  private layoutPickerAnchor: HTMLElement | null = null;
  private chartSettingsBackdrop: HTMLElement;
  private chartSettingsAnchor: HTMLElement | null = null;
  private chart: ReturnType<typeof createChart> | null = null;
  private candleSeries: any = null;
  private alertSimulationHistorySeries: any = null;
  private alertSimulationSeries: any = null;
  private alertEvidenceCandleSeries: any = null;
  private alertEvidenceAnnotation: HTMLElement | null = null;
  private alertEvidencePoint: { time: number; price: number; series?: any } | null = null;
  private alertEvidenceIndicatorTargets: TradingAlertEvidenceIndicatorTarget[] = [];
  private alertSimulationId = "";
  private alertSimulationState: TradingAlertSimulationState | null = null;
  private alertSimulationIndicatorRuntimes: TradingAlertSimulationIndicatorRuntime[] = [];
  private readonly alertSimulationConditionAnnotations = new Map<string, HTMLElement>();
  private alertSimulationTimer: number | null = null;
  private alertSimulationMarkerPaintFrame: number | null = null;
  private alertSimulationMarkerPaintRetries = 0;
  private alertSimulationMarkerVisible = false;
  private alertSimulationViewportFocusFrame: number | null = null;
  private alertSimulationViewportFocusRetries = 0;
  private alertSimulationPreviousLogicalRange: { from: number; to: number } | null = null;
  private bandUpperSeries: any = null;
  private bandLowerSeries: any = null;
  private priceLine: any = null;
  private lockedPriceRange: { from: number; to: number } | null = null;
  private priceLockAnimationFrame: number | null = null;
  private drawingSettleAnimationFrame: number | null = null;
  private volumeProfileWheelAnimationFrame: number | null = null;
  private volumeProfileWheelFramesRemaining = 0;
  private volumeProfileSnapshot: TradingVolumeProfile | null | undefined;
  private volumeProfileSnapshotCandleCount = 0;
  private resettingChartViewport = false;
  private updatingChartData = false;
  private rebuildingIndicatorPanes = false;
  private marketListScrollRestoreFrame: number | null = null;
  private marketListRenderTimer: number | null = null;
  private marketListRenderGeneration = 0;
  private finnhubSearchTimer: number | null = null;
  private finnhubSearchGeneration = 0;
  private ifindSearchTimer: number | null = null;
  private ifindSearchGeneration = 0;
  private marketListScrollTop = 0;
  private indicatorScrollTimers = new Map<HTMLElement, number>();
  private openIndicatorWidthMenuKey: string | null = null;
  private chartPanPointerId: number | null = null;
  private chartPanStartX = 0;
  private chartPanStartRange: { from: number; to: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private marketStreamSubscriptionId: string | null = null;
  private marketSocketLastActivityAt = 0;
  private liveChartPaintTimer: number | null = null;
  private liveChartPaintFrame: number | null = null;
  private lastLiveChartFullRefreshAt = 0;
  private candleCachePersistTimer: number | null = null;
  private lastCandleCachePersistAt = 0;
  private alertDrawingSyncTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private marketRateLimitRetryTimer: number | null = null;
  private favoriteTickerStreamSubscriptionIds: string[] = [];
  private favoriteTickerReconnectTimer: number | null = null;
  private favoriteTickerGeneration = 0;
  private favoriteTickerPaintFrame: number | null = null;
  private favoriteTickerFallbackTimer: number | null = null;
  private favoriteTickerFallbackPending = false;
  private favoriteTickerFallbackAbortController: AbortController | null = null;
  private favoriteTickerSocketUpdatesByMarketId = new Map<string, number>();
  private favoriteTickerOpenPricesById = new Map<string, number>();
  private countdownTimer: number | null = null;
  private pollTimer: number | null = null;
  private candlePollTimer: number | null = null;
  private refreshingSnapshotGeneration: number | null = null;
  private refreshingLiveCandleGeneration: number | null = null;
  private marketDataRequestAbortController: AbortController | null = null;
  private loadGeneration = 0;
  private loadingHistory = false;
  private historyCooldownTimer: number | null = null;
  private disposed = false;
  private marketLoading = true;
  private selectedSymbol = DEFAULT_SYMBOL;
  private selectedMarketId = `BINANCE:FUTURES:${DEFAULT_SYMBOL}`;
  private selectedProvider: TradingMarketProvider = "binance";
  private selectedAssetClass: TradingAssetClass = "crypto";
  private selectedMarketType: TradingMarketType = "perpetual";
  private selectedMarketMeta: TradingMarket | null = null;
  private activeInterval = DEFAULT_INTERVAL;
  private loadedSymbol = DEFAULT_SYMBOL;
  private loadedMarketId = `BINANCE:FUTURES:${DEFAULT_SYMBOL}`;
  private loadedProvider: TradingMarketProvider = "binance";
  private loadedAssetClass: TradingAssetClass = "crypto";
  private loadedMarketType: TradingMarketType = "perpetual";
  private loadedMarketMeta: TradingMarket | null = null;
  private loadedInterval = DEFAULT_INTERVAL;
  private periods: TradingPeriod[] = cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
  private draftPeriods: TradingPeriod[] = cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
  private periodUnit: AddableTradingPeriodUnit = "m";
  private draggedPeriodResolution: string | null = null;
  private draggedPeriodItem: HTMLElement | null = null;
  private draggedPeriodGhost: HTMLElement | null = null;
  private draggedPeriodPointerId: number | null = null;
  private draggedPeriodPointerOffset = { x: 0, y: 0 };
  private periodScrollPointerId: number | null = null;
  private periodScrollStartX = 0;
  private periodScrollStartLeft = 0;
  private periodScrollDragging = false;
  private periodScrollSuppressClick = false;
  private periodRevealAnimationFrame: number | null = null;
  private trendBandEnabled = false;
  private stats: TradingMarketStats | null = null;
  private candles: TradingCandle[] = [];
  private chartCandles: TradingCandle[] = [];
  private sourceCandles: TradingCandle[] = [];
  private lastAggregateTradeId: number | null = null;
  private markets: TradingMarket[] = [];
  private finnhubSearchMarkets: TradingMarket[] = [];
  private finnhubFavoriteMarkets = new Map<string, TradingMarket>();
  private ifindSearchMarkets: TradingMarket[] = [];
  private ifindFavoriteMarkets = new Map<string, TradingMarket>();
  private renderedMarkets = new Map<string, TradingMarket>();
  private favoriteSymbols = new Set<string>();
  private favoriteMarketRecords = new Map<string, TradingFavoriteMarketRecord>();
  private readonly favoriteStorageAccountIdentity: string;
  private drawingStorageSessionId: string;
  private favoriteStorageMigratedFromLegacy = false;
  private favoriteCandlePrefetchStarted = false;
  private favoriteTickerMarketsById = new Map<string, TradingMarket>();
  private showFavoritesOnly = false;
  private finnhubConfigured = false;
  private finnhubSearchPending = false;
  private ifindConfigured = false;
  private ifindSearchPending = false;
  private marketCategory: TradingMarketCategory = "all";
  private activeMainIndicators: TradingMainIndicatorId[] = [];
  private activeIndicators: TradingIndicatorId[] = [];
  private indicatorSettings = defaultTradingIndicatorSettings();
  private draftIndicatorSettings = defaultTradingIndicatorSettings();
  private selectedIndicatorSettingKey = "main:ma";
  private mainIndicatorSeries = new Map<TradingMainIndicatorId, any[]>();
  private mainIndicatorValues = new Map<TradingMainIndicatorId, number[][]>();
  private tdIndicatorDirections: Array<TdSequentialSignal["direction"] | null> = [];
  private tdMarkers: any = null;
  private indicatorPanes = new Map<TradingIndicatorId, IndicatorPaneRuntime>();
  private indicatorAnalysisPatches = new Map<TradingIndicatorId, TradingIndicatorAiDrawingPatch>();
  private drawingController: TradingDrawingController | null = null;
  private activeDrawingController: TradingDrawingController | null = null;
  private orderLines: TradingOrderLine[] = [];
  private chartSettings = cloneTradingChartSettings();
  private chartSettingsTab: TradingChartSettingsTab = "main-style";
  private splitLayoutId = "1-single";
  private splitPanes: TradingExpertSplitPane[] = [];
  private splitPaneSelections = new Map<number, TradingSplitPaneSelection>();
  private splitPaneIndicatorSelections = new Map<number, TradingSplitPaneIndicatorSelection>();
  private indicatorEditorSplitPane: TradingExpertSplitPane | null = null;

  constructor(
    host: HTMLElement,
    favoriteStorageAccountIdentity = "",
    drawingStorageSessionId = "",
  ) {
    this.host = host;
    this.favoriteStorageAccountIdentity = favoriteStorageAccountIdentity;
    this.drawingStorageSessionId = drawingStorageSessionId;
    this.chartElement = this.requireElement("[data-market-chart]");
    this.viewport = this.requireElement("[data-market-chart-viewport]");
    this.drawingLayer = this.requireElement<SVGSVGElement>("[data-drawing-layer]");
    this.loadingElement = this.requireElement("[data-market-loading]");
    this.errorElement = this.requireElement<HTMLButtonElement>("[data-market-error]");
    this.ohlcElement = this.requireElement("[data-market-ohlc]");
    this.crosshairTimeElement = this.requireElement<HTMLTimeElement>("[data-market-crosshair-time]");
    this.crosshairPriceElement = this.requireElement("[data-market-crosshair-price]");
    this.currentPriceElement = this.requireElement("[data-market-current-price]");
    this.candleCountdownElement = this.requireElement<HTMLTimeElement>("[data-market-candle-countdown]");
    this.picker = this.requireElement("[data-market-picker]");
    this.search = this.requireElement<HTMLInputElement>("[data-market-search]");
    this.marketList = this.requireElement("[data-market-list]");
    this.favoriteTickerBar = this.requireElement("[data-market-favorite-tickers]");
    this.favoriteTickerSortController = new TradingFavoriteTickerSortController({
      host: this.favoriteTickerBar,
      onCommit: (orderedMarketIds) => this.commitFavoriteTickerOrder(orderedMarketIds),
    });
    this.syncTitlebarFavoriteTickerHost();
    this.indicatorLegendLayer = this.requireElement("[data-market-indicator-legends]");
    this.mainIndicatorLegendElement = this.requireElement("[data-market-main-indicator-legends]");
    this.volumeProfileLayer = this.requireElement<SVGSVGElement>("[data-market-volume-profile-layer]");
    this.periodControls = this.requireElement("[data-market-period-controls]");
    this.periodTimes = this.requireElement("[data-market-times]");
    this.primaryPeriodMenu = this.requireElement("[data-market-primary-period-menu]");
    this.periodEditor = this.requireElement("[data-market-period-editor]");
    this.periodItems = this.requireElement("[data-market-period-items]");
    this.periodAmountInput = this.requireElement<HTMLInputElement>("[data-market-period-amount]");
    this.periodUnitPicker = this.requireElement("[data-market-period-unit-picker]");
    this.periodUnitMenu = this.requireElement("[data-market-period-unit-menu]");
    this.periodUnitLabel = this.requireElement("[data-market-period-unit-label]");
    this.periodStatus = this.requireElement("[data-market-period-status]");
    this.indicatorEditor = this.requireElement("[data-market-indicator-editor]");
    this.indicatorCatalog = this.requireElement("[data-market-indicator-catalog]");
    this.indicatorDetail = this.requireElement("[data-market-indicator-detail]");
    this.indicatorStatus = this.requireElement("[data-market-indicator-status]");
    this.marketOverview = this.requireElement(".trading-market-overview");
    this.chartGrid = this.requireElement("[data-market-chart-grid]");
    this.primaryChartPane = this.requireElement("[data-market-primary-pane]");
    this.alertSimulationAnnotationLayer = this.requireElement("[data-alert-simulation-annotations]");
    this.alertSimulationPointElement = this.requireElement("[data-alert-simulation-point]");
    this.layoutPicker = this.requireElement("[data-market-layout-picker]");
    this.layoutPickerHome = document.createComment("trading-market-layout-picker-home");
    this.layoutPicker.before(this.layoutPickerHome);
    this.chartSettingsBackdrop = this.requireElement("[data-market-chart-settings]");
    this.chartSettings = loadTradingChartSettings(window.localStorage);
    this.splitLayoutId = loadTradingSplitLayoutId(window.localStorage);
    const lastDrawingWorkspace = loadTradingLastDrawingWorkspace(
      window.localStorage,
      this.drawingStorageSessionId,
    );
    if (lastDrawingWorkspace) this.splitLayoutId = lastDrawingWorkspace.layoutId;
    this.refreshChartSettingsDialog();
    this.refreshSplitLayoutPicker();
    this.periods = this.loadTradingPeriods();
    const storedFavorites = this.loadFavoriteStorage();
    this.favoriteSymbols = new Set(storedFavorites.symbols);
    this.favoriteMarketRecords = new Map(
      storedFavorites.records.map((record) => [record.id, record]),
    );
    if (!lastDrawingWorkspace || !this.restoreLastDrawingWorkspace(lastDrawingWorkspace)) {
      this.restoreLastAnalysisSelection();
    }
    this.loadPersistedAlertSimulation();
    this.restoreAlertSimulationSelection();
    this.favoriteStorageMigratedFromLegacy = storedFavorites.migratedFromLegacy;
    if (this.favoriteStorageMigratedFromLegacy) this.saveFavoriteSymbols();
    this.renderFavoriteTickerBar();
    this.syncFavoriteTickerStreams();
    this.indicatorSettings = this.loadIndicatorSettings();
    this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
    this.syncActiveIndicatorsFromSettings();
    this.draftPeriods = cloneTradingPeriods(this.periods);
    if (!this.periods.some((period) => tradingViewResolution(period) === this.activeInterval)) {
      this.activeInterval = tradingViewResolution(this.periods[0]);
      this.loadedInterval = this.activeInterval;
    }
    this.renderPeriodButtons();
    this.renderPeriodEditor();
    this.updateMainIndicatorButtons();
    this.updateIndicatorButtons();
    this.bindEvents();
    this.createChart();
    this.rebuildIndicatorPanes();
    this.applyDrawingToolsSetting();
    this.applySplitLayout();
    this.updateCountdown();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
    void this.loadFinnhubStatus();
    void this.loadIfindStatus();
    // The selected chart is the critical rendering path. Only start the four
    // large Binance catalogs after it settles so a cold gateway cannot starve
    // the candles the user is waiting to see.
    void this.restartMarketData().finally(() => {
      if (!this.disposed) void this.loadMarkets();
    });
  }

  private requireElement<T extends Element = HTMLElement>(selector: string) {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Trading market element missing: ${selector}`);
    return element;
  }

  private bindEvents() {
    this.host.addEventListener("click", this.handleClick);
    this.favoriteTickerBar.addEventListener("click", this.handleFavoriteTickerClick);
    this.favoriteTickerBar.addEventListener("keydown", this.handleFavoriteTickerKeyDown);
    this.favoriteTickerBar.addEventListener("wheel", this.handleFavoriteTickerScrollWheel, { passive: false });
    this.host.addEventListener("input", this.handleIndicatorEditorInput);
    this.host.addEventListener("change", this.handleIndicatorEditorInput);
    this.host.addEventListener("input", this.handleChartSettingsInput);
    this.host.addEventListener("change", this.handleChartSettingsInput);
    this.host.addEventListener("error", this.handleMarketLogoError, true);
    this.periodItems.addEventListener("pointerdown", this.handlePeriodPointerDown);
    this.periodTimes.addEventListener("pointerdown", this.handlePeriodScrollPointerDown);
    this.periodTimes.addEventListener("pointermove", this.handlePeriodScrollPointerMove);
    this.periodTimes.addEventListener("pointerup", this.handlePeriodScrollPointerUp);
    this.periodTimes.addEventListener("pointercancel", this.handlePeriodScrollPointerCancel);
    this.periodTimes.addEventListener("wheel", this.handlePeriodScrollWheel, { passive: false });
    this.periodTimes.addEventListener("focusin", this.handlePeriodScrollFocusIn);
    this.chartElement.addEventListener("pointerdown", this.handleChartPanPointerDown);
    this.chartElement.addEventListener("pointermove", this.handleChartPanPointerMove);
    this.chartElement.addEventListener("pointerup", this.handleChartPanPointerUp);
    this.chartElement.addEventListener("pointercancel", this.handleChartPanPointerCancel);
    this.chartElement.addEventListener("wheel", this.handleChartWheel, { passive: true, capture: true });
    document.addEventListener("pointermove", this.handlePeriodPointerMove);
    document.addEventListener("pointerup", this.handlePeriodPointerUp);
    document.addEventListener("pointercancel", this.handlePeriodPointerCancel);
    this.search.addEventListener("input", this.handleSearch);
    this.marketList.addEventListener("scroll", this.handleMarketListScroll, { passive: true });
    this.indicatorCatalog.addEventListener("scroll", this.handleIndicatorEditorScroll, { passive: true });
    this.indicatorDetail.addEventListener("scroll", this.handleIndicatorEditorScroll, { passive: true });
    this.viewport.addEventListener("pointerleave", this.handleViewportLeave);
    document.addEventListener("pointerdown", this.handleOutsidePointerDown);
    document.addEventListener("keydown", this.handleKeyDown);
    this.themeObserver = new MutationObserver(() => {
      this.refreshChartSettingsDialog();
      this.applyChartTheme();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  private readonly handleClick = (event: Event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-market-action]")
      : null;
    const action = target?.dataset.marketAction;
    if (!action) return;
    if (action === "interval" && this.periodScrollSuppressClick) {
      event.preventDefault();
      this.periodScrollSuppressClick = false;
      return;
    }
    if (action === "open-chart-settings") {
      this.setLayoutPickerOpen(false);
      this.setChartSettingsOpen(true, target);
      return;
    }
    if (action === "close-chart-settings") {
      this.setChartSettingsOpen(false);
      return;
    }
    if (action === "chart-settings-tab") {
      const tab = target.dataset.marketSettingsTab as TradingChartSettingsTab | undefined;
      if (tab) this.setChartSettingsTab(tab);
      return;
    }
    if (action === "restore-chart-settings") {
      this.chartSettings = cloneTradingChartSettings(DEFAULT_TRADING_CHART_SETTINGS);
      this.persistAndApplyChartSettings({ rebuildSeries: true });
      this.refreshChartSettingsDialog();
      this.setChartSettingsOpen(true);
      return;
    }
    if (action === "open-split-layouts") {
      this.setLayoutPickerOpen(this.layoutPicker.hidden, target);
      return;
    }
    if (action === "select-split-layout") {
      const layoutId = String(target.dataset.marketLayout || "");
      if (layoutId === this.splitLayoutId) {
        this.setLayoutPickerOpen(false);
        return;
      }
      this.splitLayoutId = layoutId;
      try {
        saveTradingSplitLayoutId(window.localStorage, layoutId);
      } catch {
        // The selected layout still applies to this workspace when storage is unavailable.
      }
      this.applySplitLayout();
      this.refreshSplitLayoutPicker();
      this.setLayoutPickerOpen(false);
      return;
    }
    if (action === "toggle-symbols") {
      this.setPickerOpen(this.picker.hidden);
      return;
    }
    if (action === "add-favorite") {
      this.setPickerOpen(true);
      return;
    }
    if (action === "remove-favorite") {
      const marketId = String(target.dataset.marketId || "").toUpperCase();
      const market = this.favoriteTickerMarketsById.get(marketId)
        || this.favoriteMarketFromId(marketId);
      if (!market) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleFavoriteMarket(market);
      return;
    }
    if (action === "market-category") {
      const category = String(target.dataset.marketCategory || "") as TradingMarketCategory;
      if (!TRADING_MARKET_CATEGORY_OPTIONS.some((option) => option.id === category)) return;
      this.marketCategory = category;
      // Category selection is an explicit request to browse the directory,
      // including TradFi contracts that are not in the default favorites.
      this.showFavoritesOnly = false;
      this.syncMarketCategoryButtons();
      this.renderMarkets({ resetScroll: true });
      this.scheduleIfindSearch(true);
      return;
    }
    if (action === "toggle-period-editor") {
      if (this.host.classList.contains("split-layout-active")) {
        this.setPrimaryPeriodMenuOpen(this.primaryPeriodMenu.hidden);
      } else {
        this.setPeriodEditorOpen(this.periodEditor.hidden);
      }
      return;
    }
    if (action === "toggle-indicator-editor") {
      this.indicatorEditorSplitPane = null;
      this.setIndicatorEditorOpen(this.indicatorEditor.hidden);
      return;
    }
    if (action === "close-indicator-editor") {
      this.setIndicatorEditorOpen(false);
      return;
    }
    if (action === "restore-indicator-settings") {
      const defaults = defaultTradingIndicatorSettings();
      const current = this.draftIndicatorSettings[this.selectedIndicatorSettingKey];
      const fallback = defaults[this.selectedIndicatorSettingKey];
      if (!current || !fallback) return;
      this.draftIndicatorSettings[this.selectedIndicatorSettingKey] = {
        ...fallback,
        enabled: current.enabled,
      };
      this.renderIndicatorEditor();
      this.setIndicatorStatus("已恢复当前指标默认设置，点击保存后生效。", "success");
      return;
    }
    if (action === "step-indicator-parameter") {
      const row = target.closest<HTMLElement>(".trading-market-indicator-parameter-row");
      const input = row?.querySelector<HTMLInputElement>("input[type=number]");
      if (!input) return;
      if (target.dataset.marketIndicatorStep === "up") input.stepUp();
      else if (target.dataset.marketIndicatorStep === "down") input.stepDown();
      else return;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
      return;
    }
    if (action === "toggle-indicator-width-menu") {
      const menuKey = String(target.dataset.marketIndicatorWidthMenu || "");
      if (!menuKey) return;
      this.setIndicatorWidthMenuOpen(
        this.openIndicatorWidthMenuKey === menuKey ? null : menuKey,
        true,
      );
      return;
    }
    if (action === "set-indicator-series-width") {
      const key = String(target.dataset.marketIndicatorSetting || "");
      const seriesKey = String(target.dataset.marketIndicatorSeries || "");
      const width = Number(target.dataset.marketIndicatorWidth);
      const series = this.draftIndicatorSettings[key]?.series[seriesKey];
      if (!series || (width !== 1 && width !== 2 && width !== 3)) return;
      series.lineWidth = width;
      const picker = target.closest<HTMLElement>("[data-market-indicator-width-select]");
      const triggerLabel = picker?.querySelector<HTMLElement>(".trading-market-indicator-width-trigger > span");
      if (triggerLabel) triggerLabel.textContent = target.textContent?.trim() || "";
      picker?.querySelectorAll<HTMLButtonElement>('[data-market-action="set-indicator-series-width"]').forEach((button) => {
        const selected = Number(button.dataset.marketIndicatorWidth) === width;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      this.setIndicatorWidthMenuOpen(null);
      this.setIndicatorStatus("有未保存的更改");
      return;
    }
    if (action === "save-indicator-settings") {
      this.saveDraftIndicatorSettings();
      return;
    }
    if (action === "select-indicator-setting") {
      const key = String(target.dataset.marketIndicatorSetting || "");
      if (!this.draftIndicatorSettings[key]) return;
      this.openIndicatorWidthMenuKey = null;
      this.selectedIndicatorSettingKey = key;
      this.renderIndicatorEditor();
      return;
    }
    if (action === "toggle-period-unit") {
      this.setPeriodUnitMenuOpen(this.periodUnitMenu.hidden);
      return;
    }
    if (action === "period-unit") {
      const unit = target.dataset.marketPeriodUnit;
      if (unit !== "m" && unit !== "h" && unit !== "d") return;
      this.periodUnit = unit;
      this.updatePeriodUnitPicker();
      this.setPeriodUnitMenuOpen(false);
      return;
    }
    if (action === "add-period") {
      this.addDraftPeriod();
      return;
    }
    if (action === "remove-period") {
      const resolution = target.dataset.marketPeriodResolution;
      if (!resolution) return;
      this.draftPeriods = this.draftPeriods.filter(
        (period) => tradingViewResolution(period) !== resolution,
      );
      this.setPeriodStatus("");
      this.renderPeriodEditor();
      return;
    }
    if (action === "restore-periods") {
      this.draftPeriods = cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
      this.setPeriodStatus("已恢复默认排序，点击确定后生效。", "success");
      this.renderPeriodEditor(false);
      return;
    }
    if (action === "confirm-periods") {
      this.confirmDraftPeriods();
      return;
    }
    if (action === "retry") {
      void this.restartMarketData();
      return;
    }
    if (action === "open-default-market") {
      this.openDefaultPerpetualMarket();
      return;
    }
    if (action === "interval") {
      const interval = target.dataset.marketInterval;
      this.setPrimaryPeriodMenuOpen(false);
      if (!interval || interval === this.activeInterval) return;
      if (this.selectedProvider === "ifind" && !ifindSupportsTradingResolution(interval)) return;
      this.activeInterval = interval;
      this.updateIntervalPressedButtons(interval);
      this.recordLastDrawingWorkspace();
      void this.restartMarketData({ preserveChart: true });
      return;
    }
    if (action === "main-indicator") {
      const indicator = target.dataset.marketMainIndicator as TradingMainIndicatorId | undefined;
      if (!indicator || !TRADING_MAIN_INDICATORS.some((item) => item.id === indicator)) return;
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("main", indicator)];
      setting.enabled = !setting.enabled;
      this.syncActiveIndicatorsFromSettings();
      this.persistIndicatorSettings();
      this.updateMainIndicatorButtons();
      this.updateChartData();
      return;
    }
    if (action === "indicator") {
      const indicator = target.dataset.marketIndicator as TradingIndicatorId | undefined;
      if (!indicator || !TRADING_INDICATORS.some((item) => item.id === indicator)) return;
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("sub", indicator)];
      setting.enabled = !setting.enabled;
      this.syncActiveIndicatorsFromSettings();
      this.persistIndicatorSettings();
      this.updateIndicatorButtons();
      this.rebuildIndicatorPanes();
      this.updateChartData();
      return;
    }
    if (action === "favorite") {
      const marketId = String(target.dataset.marketId || "").toUpperCase();
      const market = this.renderedMarkets.get(marketId)
        || this.favoriteMarketFromId(marketId);
      if (!market) return;
      this.toggleFavoriteMarket(market);
      return;
    }
    if (action === "symbol" || action === "favorite-symbol") {
      const marketId = String(target.dataset.marketId || "").toUpperCase();
      const market = this.favoriteTickerMarketsById.get(marketId)
        || this.renderedMarkets.get(marketId)
        || this.markets.find((candidate) => candidate.id === marketId)
        || this.favoriteMarketFromId(marketId);
      if (!market || market.id === this.selectedMarketId) {
        this.setPickerOpen(false);
        this.renderFavoriteTickerBar();
        return;
      }
      this.selectMarket(market);
      this.updateSymbolUi();
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      void this.restartMarketData({ preserveChart: true });
    }
  };

  private readonly handleSearch = () => {
    this.renderMarkets({ resetScroll: true });
    this.scheduleFinnhubSearch();
    this.scheduleIfindSearch();
  };
  private readonly handleIndicatorEditorInput = (event: Event) => {
    if (this.indicatorEditor.hidden || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    const target = event.target;
    const key = String(target.dataset.marketIndicatorSetting || this.selectedIndicatorSettingKey);
    const setting = this.draftIndicatorSettings[key];
    if (!setting) return;
    if (target.dataset.marketIndicatorParameter !== undefined) {
      const index = Number(target.dataset.marketIndicatorParameter);
      const catalog = this.indicatorCatalogItem(key);
      const field = catalog?.parameters[index];
      const value = Number(target.value);
      if (!field || !Number.isFinite(value)) return;
      const bounded = Math.min(Math.max(value, field.min), field.max);
      setting.parameters[index] = field.step >= 1
        ? Math.round(bounded)
        : Math.round(bounded / field.step) * field.step;
      target.value = String(setting.parameters[index]);
      this.setIndicatorStatus("有未保存的更改");
      return;
    }
    const seriesKey = target.dataset.marketIndicatorSeries;
    const series = seriesKey ? setting.series[seriesKey] : null;
    if (!series) return;
    if (target.dataset.marketIndicatorSeriesVisible !== undefined && target instanceof HTMLInputElement) {
      series.visible = target.checked;
    } else if (target.dataset.marketIndicatorSeriesColor !== undefined && target instanceof HTMLInputElement) {
      series.color = target.value;
      target.nextElementSibling instanceof HTMLElement
        && target.nextElementSibling.style.setProperty("--indicator-setting-color", target.value);
    } else if (target.dataset.marketIndicatorSeriesWidth !== undefined) {
      const width = Number(target.value);
      if (width === 1 || width === 2 || width === 3) series.lineWidth = width;
    }
    this.setIndicatorStatus("有未保存的更改");
  };
  private readonly handleChartSettingsInput = (event: Event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const key = target?.dataset.chartSetting;
    if (!target || !key || !this.chartSettingsBackdrop.contains(target)) return;
    const continuousInput = target.type === "color" || target.type === "number";
    if ((event.type === "input") !== continuousInput) return;
    const previousStyle = this.chartSettings.chartStyle;
    const themeName: TradingChartThemeName = isDarkTheme() ? "dark" : "light";
    const theme = this.chartSettings.themes[themeName];
    const booleanValue = target.type === "checkbox"
      ? target.checked
      : target.value === "true";
    if (key.startsWith("theme.")) {
      const themeKey = key.slice("theme.".length) as keyof typeof theme;
      if (themeKey === "verticalGridVisible" || themeKey === "horizontalGridVisible") {
        theme[themeKey] = booleanValue;
      } else if (target.type === "color") {
        theme[themeKey] = target.value.toUpperCase() as never;
      }
    } else if (key.startsWith("orderDisplay.")) {
      const orderDisplayKey = key.slice("orderDisplay.".length) as keyof TradingChartSettings["orderDisplay"];
      if (
        orderDisplayKey === "currentOrders"
        || orderDisplayKey === "positions"
        || orderDisplayKey === "liquidation"
        || orderDisplayKey === "takeProfitStopLoss"
      ) {
        this.chartSettings.orderDisplay[orderDisplayKey] = target.checked;
      } else {
        return;
      }
    } else if (key === "riseFallPalette") {
      const redUp = target.value === "red-up";
      this.chartSettings.risingColor = redUp ? "#F6465D" : "#2EBD85";
      this.chartSettings.fallingColor = redUp ? "#2EBD85" : "#F6465D";
    } else if (key === "verticalPaddingPercent") {
      this.chartSettings.verticalPaddingPercent = Math.min(15, Math.max(0, Math.round(Number(target.value) || 0)));
      target.value = String(this.chartSettings.verticalPaddingPercent);
    } else if (key === "hollowRising" || key === "drawingToolsEnabled") {
      this.chartSettings[key] = booleanValue;
    } else if (
      key === "showCandleBorder"
      || key === "showWicks"
      || key === "showPriceLine"
      || key === "showPriceLabel"
      || key === "showCountdown"
    ) {
      this.chartSettings[key] = target.checked;
    } else if (key === "risingColor" || key === "fallingColor") {
      this.chartSettings[key] = target.value.toUpperCase();
    } else if (key === "chartStyle") {
      this.chartSettings.chartStyle = target.value as TradingChartSettings["chartStyle"];
    } else if (key === "priceAdjustment") {
      this.chartSettings.priceAdjustment = target.value as TradingChartSettings["priceAdjustment"];
    } else if (key === "scaleAnchor") {
      this.chartSettings.scaleAnchor = target.value as TradingChartSettings["scaleAnchor"];
    } else if (key === "priceScaleMode") {
      this.chartSettings.priceScaleMode = target.value as TradingChartSettings["priceScaleMode"];
    } else {
      return;
    }
    this.chartSettings = normalizeTradingChartSettings(this.chartSettings);
    this.persistAndApplyChartSettings({ rebuildSeries: previousStyle !== this.chartSettings.chartStyle });
    this.syncChartSettingsControls(key);
  };

  private syncChartSettingsControls(changedKey: string) {
    if (changedKey === "risingColor" || changedKey === "fallingColor" || changedKey === "riseFallPalette") {
      this.chartSettingsBackdrop.querySelectorAll<HTMLInputElement>('[data-chart-setting="risingColor"]').forEach((input) => {
        input.value = this.chartSettings.risingColor;
      });
      this.chartSettingsBackdrop.querySelectorAll<HTMLInputElement>('[data-chart-setting="fallingColor"]').forEach((input) => {
        input.value = this.chartSettings.fallingColor;
      });
      this.chartSettingsBackdrop.querySelectorAll<HTMLInputElement>('[data-chart-setting="riseFallPalette"]').forEach((input) => {
        input.checked = input.value === (this.chartSettings.risingColor.toUpperCase() === "#F6465D" ? "red-up" : "green-up");
      });
    }
  }

  private readonly handleFavoriteTickerClick = (event: Event) => {
    this.handleClick(event);
    event.stopPropagation();
  };

  private readonly handleFavoriteTickerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-market-action="remove-favorite"]')
      : null;
    if (!target || !this.favoriteTickerBar.contains(target)) return;
    event.preventDefault();
    target.click();
  };

  private readonly handleFavoriteTickerScrollWheel = (event: WheelEvent) => {
    const maxScrollLeft = this.favoriteTickerBar.scrollWidth - this.favoriteTickerBar.clientWidth;
    if (maxScrollLeft <= 1) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? this.favoriteTickerBar.clientWidth
        : 1;
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, this.favoriteTickerBar.scrollLeft + rawDelta * deltaScale),
    );
    if (nextScrollLeft === this.favoriteTickerBar.scrollLeft) return;
    event.preventDefault();
    this.favoriteTickerBar.scrollLeft = nextScrollLeft;
  };

  syncTitlebarFavoriteTickerHost() {
    const titlebarHost = document.querySelector<HTMLElement>(
      "[data-titlebar-market-favorites-host]",
    );
    if (!titlebarHost || this.favoriteTickerBar.parentElement === titlebarHost) return;
    titlebarHost.append(this.favoriteTickerBar);
  }

  private persistAndApplyChartSettings(options: { rebuildSeries?: boolean } = {}) {
    try {
      saveTradingChartSettings(window.localStorage, this.chartSettings);
    } catch {
      // The active session still uses the setting when local storage is unavailable.
    }
    if (options.rebuildSeries) this.rebuildPrimarySeries();
    this.applyChartTheme();
    this.applyDrawingToolsSetting();
    this.applyOrderDisplaySettings();
    this.updateCountdown();
  }

  private applyDrawingToolsSetting() {
    const enabled = this.chartSettings.drawingToolsEnabled;
    this.host.classList.toggle("drawing-tools-disabled", !enabled);
    this.host.querySelector<HTMLElement>("[data-drawing-toolbar]")?.setAttribute("aria-hidden", String(!enabled));
    this.drawingController?.setUserDrawingEnabled(enabled);
    this.splitPanes.forEach((pane) => pane.getDrawingController()?.setUserDrawingEnabled(enabled));
  }

  private drawingControllers() {
    return [
      this.drawingController,
      ...this.splitPanes.map((pane) => pane.getDrawingController()),
    ].filter((controller): controller is TradingDrawingController => Boolean(controller));
  }

  private displayedOrderLines() {
    return filterTradingOrderLinesForDisplay(this.orderLines, this.chartSettings.orderDisplay);
  }

  private applyOrderDisplaySettings() {
    const visibleOrderLines = this.displayedOrderLines();
    this.drawingControllers().forEach((controller) => controller.setOrderLines(visibleOrderLines));
  }

  private syncDrawingSharedToolState(
    state: TradingDrawingSharedToolState,
    source: TradingDrawingController,
  ) {
    this.drawingControllers().forEach((controller) => {
      if (controller !== source) controller.applySharedToolState(state);
    });
  }

  private activateDrawingController(controller: TradingDrawingController) {
    if (controller === this.activeDrawingController) {
      controller.setControlActive(true);
      return;
    }
    const sharedState = (this.activeDrawingController ?? this.drawingController)?.sharedToolState();
    this.activeDrawingController?.setControlActive(false);
    if (sharedState) controller.applySharedToolState(sharedState);
    this.activeDrawingController = controller;
    controller.setControlActive(true);
  }

  private refreshChartSettingsDialog() {
    const wasOpen = !this.chartSettingsBackdrop.hidden;
    const template = document.createElement("template");
    template.innerHTML = renderTradingChartSettingsDialog(
      this.chartSettings,
      isDarkTheme() ? "dark" : "light",
    ).trim();
    const next = template.content.firstElementChild as HTMLElement | null;
    if (!next) return;
    this.chartSettingsBackdrop.replaceWith(next);
    this.chartSettingsBackdrop = next;
    this.setChartSettingsTab(this.chartSettingsTab);
    this.chartSettingsBackdrop.hidden = !wasOpen;
  }

  private setChartSettingsTab(tab: TradingChartSettingsTab) {
    const allowed: TradingChartSettingsTab[] = [
      "main-style", "background", "scale", "rise-fall", "coordinate", "live-price", "drawing-tools",
      "order-display",
    ];
    if (!allowed.includes(tab)) return;
    this.chartSettingsTab = tab;
    this.chartSettingsBackdrop.querySelectorAll<HTMLElement>("[data-market-settings-tab]").forEach((button) => {
      const selected = button.dataset.marketSettingsTab === tab;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    this.chartSettingsBackdrop.querySelectorAll<HTMLElement>("[data-chart-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.chartSettingsPanel !== tab;
    });
  }

  private setChartSettingsOpen(open: boolean, anchor: HTMLElement | null = null) {
    this.chartSettingsBackdrop.hidden = !open;
    this.chartSettingsBackdrop.classList.toggle("open", open);
    const primaryTrigger = this.host.querySelector<HTMLElement>('[data-market-action="open-chart-settings"]');
    if (!open) {
      this.chartSettingsAnchor?.setAttribute("aria-expanded", "false");
      this.chartSettingsAnchor?.classList.remove("active");
      primaryTrigger?.setAttribute("aria-expanded", "false");
      primaryTrigger?.classList.remove("active");
      this.chartSettingsAnchor = null;
      return;
    }
    this.chartSettingsAnchor = anchor?.isConnected
      ? anchor
      : this.chartSettingsAnchor?.isConnected
        ? this.chartSettingsAnchor
        : primaryTrigger;
    const primaryOpen = this.chartSettingsAnchor === primaryTrigger;
    primaryTrigger?.setAttribute("aria-expanded", String(primaryOpen));
    primaryTrigger?.classList.toggle("active", primaryOpen);
    this.chartSettingsAnchor?.setAttribute("aria-expanded", "true");
    this.chartSettingsAnchor?.classList.add("active");
    if (open) {
      this.setPrimaryPeriodMenuOpen(false);
      this.setPickerOpen(false);
      this.setPeriodEditorOpen(false);
      this.setIndicatorEditorOpen(false);
      window.requestAnimationFrame(() => {
        this.chartSettingsBackdrop.querySelector<HTMLButtonElement>("[data-market-settings-tab].selected")?.focus();
      });
    }
  }

  private refreshSplitLayoutPicker() {
    const wasOpen = !this.layoutPicker.hidden;
    const anchor = this.layoutPickerAnchor;
    const template = document.createElement("template");
    template.innerHTML = renderTradingSplitLayoutPicker(this.splitLayoutId).trim();
    const next = template.content.firstElementChild as HTMLElement | null;
    if (!next) return;
    this.layoutPicker.replaceWith(next);
    this.layoutPicker = next;
    this.layoutPicker.hidden = true;
    if (wasOpen) this.setLayoutPickerOpen(true, anchor);
  }

  private setLayoutPickerOpen(open: boolean, anchor: HTMLElement | null = null) {
    const primaryTrigger = this.host.querySelector<HTMLElement>('[data-market-action="open-split-layouts"]');
    if (!open) {
      this.layoutPickerAnchor?.setAttribute("aria-expanded", "false");
      this.layoutPickerAnchor?.classList.remove("active");
      primaryTrigger?.setAttribute("aria-expanded", "false");
      primaryTrigger?.classList.remove("active");
      this.layoutPicker.hidden = true;
      this.layoutPicker.classList.remove("open", "floating");
      this.layoutPickerHome.parentNode?.insertBefore(
        this.layoutPicker,
        this.layoutPickerHome.nextSibling,
      );
      this.clearLayoutPickerPosition();
      this.layoutPickerAnchor = null;
      return;
    }
    this.layoutPickerAnchor = anchor?.isConnected
      ? anchor
      : primaryTrigger;
    const primaryOpen = this.layoutPickerAnchor === primaryTrigger;
    primaryTrigger?.setAttribute("aria-expanded", String(primaryOpen));
    primaryTrigger?.classList.toggle("active", primaryOpen);
    this.layoutPickerAnchor?.setAttribute("aria-expanded", "true");
    this.layoutPickerAnchor?.classList.add("active");
    this.setPrimaryPeriodMenuOpen(false);
    this.host.append(this.layoutPicker);
    this.layoutPicker.hidden = false;
    this.layoutPicker.classList.add("open", "floating");
    this.positionLayoutPicker();
    window.requestAnimationFrame(() => {
      this.positionLayoutPicker();
      this.layoutPicker.querySelector<HTMLButtonElement>("button.selected")?.focus();
    });
  }

  private positionLayoutPicker() {
    if (this.layoutPicker.hidden) return;
    const hostRect = this.host.getBoundingClientRect();
    const fallbackAnchor = this.host.querySelector<HTMLElement>('[data-market-action="open-split-layouts"]');
    const anchor = this.layoutPickerAnchor?.isConnected ? this.layoutPickerAnchor : fallbackAnchor;
    const anchorRect = anchor?.getBoundingClientRect() ?? hostRect;
    const placement = tradingFloatingOverlayPlacement({
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      anchorLeft: anchorRect.left - hostRect.left,
      anchorTop: anchorRect.top - hostRect.top,
      anchorBottom: anchorRect.bottom - hostRect.top,
    });
    Object.assign(this.layoutPicker.style, {
      position: "absolute",
      right: "auto",
      left: `${placement.left}px`,
      width: `${placement.width}px`,
      maxHeight: `${placement.maxHeight}px`,
      top: placement.top === null ? "auto" : `${placement.top}px`,
      bottom: placement.bottom === null ? "auto" : `${placement.bottom}px`,
    });
  }

  private clearLayoutPickerPosition() {
    ["position", "right", "left", "width", "max-height", "top", "bottom"].forEach((property) => {
      this.layoutPicker.style.removeProperty(property);
    });
  }

  private splitPaneMarket(market: Pick<TradingMarket, "id" | "provider" | "symbol" | "baseAsset" | "quoteAsset" | "displaySymbol" | "description" | "venue" | "assetClass" | "marketType" | "tag" | "markPrice" | "changePercent" | "quoteAvailable">): TradingSplitPaneMarket {
    return {
      id: market.id,
      provider: market.provider,
      symbol: market.symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      displaySymbol: market.displaySymbol,
      description: market.description,
      venue: market.venue,
      assetClass: market.assetClass,
      marketType: market.marketType,
      tag: market.tag,
      markPrice: market.markPrice,
      changePercent: market.changePercent,
      quoteAvailable: market.quoteAvailable,
    };
  }

  private availableSplitPaneMarkets() {
    const commonSymbols = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
    const common = commonSymbols.map<TradingSplitPaneMarket>((baseAsset) => ({
      id: `BINANCE:FUTURES:${baseAsset}USDT`,
      provider: "binance",
      symbol: `${baseAsset}USDT`,
      baseAsset,
      quoteAsset: "USDT",
      displaySymbol: `${baseAsset}/USDT`,
      description: `${baseAsset}/USDT 币安永续合约`,
      venue: "币安",
      assetClass: "crypto",
      marketType: "perpetual",
      tag: "永续",
      markPrice: 0,
      changePercent: 0,
      quoteAvailable: false,
    }));
    const current = this.selectedMarketMeta
      ? [this.splitPaneMarket(this.selectedMarketMeta)]
      : common.filter((market) => market.id === this.selectedMarketId);
    const favorites = [...this.favoriteMarketRecords.values()]
      .map((market) => this.splitPaneMarket(marketFromFavoriteRecord(market)));
    const restoredSelections = [...this.splitPaneSelections.values()]
      .map((selection) => selection.market);
    const catalog = this.markets.map((market) => this.splitPaneMarket(market));
    const unique = new Map<string, TradingSplitPaneMarket>();
    [...current, ...restoredSelections, ...favorites, ...common, ...catalog]
      .forEach((market) => unique.set(market.id, market));
    return [...unique.values()];
  }

  private syncSplitPaneMarkets() {
    if (!this.splitPanes.length) return;
    const markets = this.availableSplitPaneMarkets();
    this.splitPanes.forEach((pane) => pane.updateMarkets(markets));
  }

  private applySplitLayout() {
    const layout = tradingSplitLayout(this.splitLayoutId);
    this.splitLayoutId = layout.id;
    if (this.indicatorEditorSplitPane) this.setIndicatorEditorOpen(false);
    if (this.drawingController && this.activeDrawingController !== this.drawingController) {
      this.activateDrawingController(this.drawingController);
    }
    this.splitPanes.forEach((pane) => pane.destroy());
    this.splitPanes = [];
    this.chartGrid.querySelectorAll("[data-market-split-pane]").forEach((pane) => pane.remove());
    this.chartGrid.dataset.marketLayout = layout.id;
    this.chartGrid.style.gridTemplateColumns = layout.columns.map((weight) => `${weight}fr`).join(" ");
    this.chartGrid.style.gridTemplateRows = layout.rows.map((weight) => `${weight}fr`).join(" ");
    const applyCell = (element: HTMLElement, index: number) => {
      const cell = layout.cells[index];
      if (!cell) return;
      element.style.gridColumn = `${cell.column} / span ${cell.columnSpan ?? 1}`;
      element.style.gridRow = `${cell.row} / span ${cell.rowSpan ?? 1}`;
    };
    applyCell(this.primaryChartPane, 0);
    const splitActive = layout.count > 1;
    if (splitActive) this.setPeriodEditorOpen(false);
    this.host.classList.toggle("split-layout-active", splitActive);
    this.setPrimaryPeriodMenuOpen(false);
    this.syncPrimaryPaneOverview(splitActive);
    this.renderFavoriteTickerBar();
    const markets = this.availableSplitPaneMarkets();
    const periods = this.periods.map((period) => ({
      resolution: tradingViewResolution(period),
      label: tradingPeriodLabel(period),
    }));
    const intervalSequence = ["60", "240", "15", "1D", "5", "1W", "30", "120"];
    for (let index = 1; index < layout.count; index += 1) {
      const paneHost = document.createElement("div");
      paneHost.className = "trading-market-split-pane";
      paneHost.dataset.marketSplitPane = String(index + 1);
      applyCell(paneHost, index);
      this.chartGrid.append(paneHost);
      const defaultInterval = intervalSequence[index - 1]
        && periods.some((period) => period.resolution === intervalSequence[index - 1])
        ? intervalSequence[index - 1]
        : periods[index % Math.max(periods.length, 1)]?.resolution || this.activeInterval;
      const savedSelection = this.splitPaneSelections.get(index);
      const market = markets.find((candidate) => candidate.id === savedSelection?.marketId)
        ?? savedSelection?.market
        ?? markets[0]
        ?? this.splitPaneMarket(defaultBinancePerpetualMarket());
      const interval = savedSelection
        && periods.some((period) => period.resolution === savedSelection.interval)
        ? savedSelection.interval
        : defaultInterval;
      const indicatorSelection = this.splitPaneIndicatorSelections.get(index) ?? { main: [], sub: [] };
      this.splitPaneSelections.set(index, { marketId: market.id, interval, market: { ...market } });
      this.splitPaneIndicatorSelections.set(index, {
        main: [...indicatorSelection.main],
        sub: [...indicatorSelection.sub],
      });
      const pane = new TradingExpertSplitPane({
        host: paneHost,
        paneIndex: index,
        market,
        interval,
        mainIndicators: TRADING_MAIN_INDICATORS,
        indicatorSettings: this.indicatorSettings,
        indicatorSelection,
        markets,
        periods,
        settings: this.chartSettings,
        themeName: isDarkTheme() ? "dark" : "light",
        loadCandles: (market, targetInterval) => this.loadSplitPaneCandles(market, targetInterval),
        drawing: {
          controlsHost: this.host,
          storageSessionId: tradingSplitPaneDrawingStorageSessionId(this.drawingStorageSessionId, index),
          resolveControlTarget: () => this.activeDrawingController ?? this.drawingController,
          onSharedToolStateChanged: (state, source) => this.syncDrawingSharedToolState(state, source),
          onSurfaceFocus: (source) => this.activateDrawingController(source),
          onDrawingStateChanged: () => this.recordLastDrawingWorkspace(),
        },
        onSelectionChange: (selection) => {
          this.splitPaneSelections.set(index, selection);
          this.recordLastDrawingWorkspace();
        },
        onIndicatorSelectionChange: (selection) => {
          this.splitPaneIndicatorSelections.set(index, selection);
          this.recordLastDrawingWorkspace();
        },
        onOpenIndicatorEditor: () => {
          this.indicatorEditorSplitPane = pane;
          this.setLayoutPickerOpen(false);
          this.setIndicatorEditorOpen(true);
        },
        onOpenGlobalSettings: (anchor) => {
          this.setLayoutPickerOpen(false);
          this.setChartSettingsOpen(true, anchor);
        },
        onOpenSplitLayouts: (anchor) => {
          this.setLayoutPickerOpen(true, anchor);
        },
      });
      this.splitPanes.push(pane);
      const paneDrawingController = pane.getDrawingController();
      paneDrawingController?.setOrderLines(this.displayedOrderLines());
      if (paneDrawingController && this.drawingController) {
        paneDrawingController.applySharedToolState(this.drawingController.sharedToolState());
      }
    }
    window.requestAnimationFrame(() => {
      this.chart?.applyOptions({
        width: Math.max(this.chartElement.clientWidth, 1),
        height: Math.max(this.chartElement.clientHeight, 1),
      });
      this.positionIndicatorLegends();
      this.updateCurrentPriceLabel();
      this.drawingController?.redraw();
      this.splitPanes.forEach((pane) => pane.getDrawingController()?.redraw());
    });
  }

  private syncPrimaryPaneOverview(splitActive: boolean) {
    if (splitActive) {
      if (this.marketOverview.parentElement !== this.primaryChartPane) {
        this.primaryChartPane.insertBefore(this.marketOverview, this.viewport);
      }
      return;
    }
    if (this.marketOverview.nextElementSibling !== this.chartGrid) {
      this.chartGrid.before(this.marketOverview);
    }
  }

  private async loadSplitPaneCandles(market: TradingSplitPaneMarket, interval: string) {
    if (market.provider === "binance") {
      const result = await fetchTradingCandles(
        market.symbol,
        interval,
        500,
        undefined,
        market.marketType === "spot" ? "spot" : "perpetual",
      );
      if (!tradingCandleSeriesMatchesResolution(result.candles, interval)) {
        throw new Error(`分屏行情周期校验失败：${interval}`);
      }
      return result.candles;
    }
    const api = market.provider === "ifind"
      ? window.codexDesktop.getIfindMarketCandles
      : window.codexDesktop.getFinnhubMarketCandles;
    if (!api) throw new Error("当前版本缺少行情桥。");
    const response = await api({
      symbol: market.symbol,
      assetClass: market.assetClass,
      resolution: interval,
      count: 500,
      endTime: Date.now(),
    });
    if (response?.ok !== true) throw new Error(String(response?.message || "分屏行情加载失败"));
    return this.normalizeRemoteCandles(response.candles);
  }
  private readonly handleMarketListScroll = () => {
    this.marketListScrollTop = this.marketList.scrollTop;
  };
  private readonly handleIndicatorEditorScroll = (event: Event) => {
    const scroller = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!scroller) return;
    if (scroller.scrollHeight <= scroller.clientHeight + 2) {
      this.clearIndicatorScrollerState(scroller);
      return;
    }
    scroller.classList.add("scrolling");
    const existingTimer = this.indicatorScrollTimers.get(scroller);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      scroller.classList.remove("scrolling");
      this.indicatorScrollTimers.delete(scroller);
    }, 500);
    this.indicatorScrollTimers.set(scroller, timer);
  };

  private clearIndicatorScrollerState(scroller: HTMLElement) {
    const timer = this.indicatorScrollTimers.get(scroller);
    if (timer !== undefined) window.clearTimeout(timer);
    this.indicatorScrollTimers.delete(scroller);
    scroller.classList.remove("scrolling");
  }
  private readonly handleMarketLogoError = (event: Event) => {
    const image = event.target instanceof HTMLImageElement
      && event.target.matches("[data-market-logo]")
      ? event.target
      : null;
    if (!image) return;
    const asset = String(image.dataset.marketLogoAsset || "").trim().toUpperCase();
    if (asset && image.dataset.marketLogoStage === "binance") {
      image.dataset.marketLogoStage = "hyperliquid";
      image.src = hyperliquidAssetLogoUrl(asset);
      return;
    }
    image.hidden = true;
    image.closest<HTMLElement>("[data-market-logo-shell]")?.classList.add("fallback");
  };
  private readonly handleViewportLeave = () => {
    this.hideCrosshairTimeLabel();
    this.hideCrosshairPriceLabel();
    this.renderLatestOhlc();
    this.updateMainIndicatorLegends();
    this.updateIndicatorLegends();
  };
  private readonly handleOutsidePointerDown = (event: Event) => {
    if (
      !this.chartSettingsBackdrop.hidden
      && event.target === this.chartSettingsBackdrop
    ) {
      this.setChartSettingsOpen(false);
      return;
    }
    if (
      !this.layoutPicker.hidden
      && event.target instanceof Node
      && !this.layoutPicker.contains(event.target)
      && !this.layoutPickerAnchor?.contains(event.target)
    ) {
      this.setLayoutPickerOpen(false);
    }
    if (!this.indicatorEditor.hidden && event.target === this.indicatorEditor) {
      this.setIndicatorEditorOpen(false);
      return;
    }
    if (
      this.openIndicatorWidthMenuKey
      && event.target instanceof Element
      && !event.target.closest("[data-market-indicator-width-select]")
    ) {
      this.setIndicatorWidthMenuOpen(null);
    }
    if (!this.picker.hidden && event.target instanceof Node && !this.picker.parentElement?.contains(event.target)) {
      this.setPickerOpen(false);
    }
    if (
      !this.periodUnitMenu.hidden
      && event.target instanceof Node
      && !this.periodUnitPicker.contains(event.target)
    ) {
      this.setPeriodUnitMenuOpen(false);
    }
    if (
      !this.periodEditor.hidden
      && event.target instanceof Node
      && !this.periodControls.contains(event.target)
    ) {
      this.setPeriodEditorOpen(false);
    }
    if (
      !this.primaryPeriodMenu.hidden
      && event.target instanceof Node
      && !this.periodControls.contains(event.target)
    ) {
      this.setPrimaryPeriodMenuOpen(false);
    }
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !this.chartSettingsBackdrop.hidden) {
      const trigger = this.chartSettingsAnchor;
      this.setChartSettingsOpen(false);
      (trigger?.isConnected
        ? trigger
        : this.host.querySelector<HTMLElement>('[data-market-action="open-chart-settings"]'))?.focus();
      return;
    }
    if (event.key === "Escape" && !this.layoutPicker.hidden) {
      const trigger = this.layoutPickerAnchor;
      this.setLayoutPickerOpen(false);
      (trigger?.isConnected
        ? trigger
        : this.host.querySelector<HTMLElement>('[data-market-action="open-split-layouts"]'))?.focus();
      return;
    }
    if (event.key === "Escape" && this.openIndicatorWidthMenuKey) {
      const menuKey = this.openIndicatorWidthMenuKey;
      this.setIndicatorWidthMenuOpen(null);
      this.indicatorDetail
        .querySelector<HTMLElement>(`[data-market-indicator-width-menu="${menuKey}"] .trading-market-indicator-width-trigger`)
        ?.focus();
      return;
    }
    if (event.key === "Escape" && !this.indicatorEditor.hidden) {
      this.setIndicatorEditorOpen(false);
      this.host.querySelector<HTMLElement>('[data-market-action="toggle-indicator-editor"]')?.focus();
      return;
    }
    if (event.key === "Escape" && !this.periodUnitMenu.hidden) {
      this.setPeriodUnitMenuOpen(false);
      this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-unit"]')?.focus();
      return;
    }
    if (event.key === "Escape" && !this.periodEditor.hidden) {
      this.setPeriodEditorOpen(false);
      this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-editor"]')?.focus();
      return;
    }
    if (event.key === "Escape" && !this.primaryPeriodMenu.hidden) {
      this.setPrimaryPeriodMenuOpen(false);
      this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-editor"]')?.focus();
      return;
    }
    if (event.key === "Escape" && !this.picker.hidden) {
      this.setPickerOpen(false);
      this.host.querySelector<HTMLElement>('[data-market-action="toggle-symbols"]')?.focus();
    }
  };

  private readonly handlePeriodPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.draggedPeriodPointerId !== null) return;
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-market-period-item]")
      : null;
    const resolution = item?.dataset.marketPeriodResolution;
    if (
      !item
      || !resolution
      || this.periodEditor.hidden
      || (event.target instanceof Element && event.target.closest("button"))
    ) return;
    this.draggedPeriodResolution = resolution;
    this.draggedPeriodItem = item;
    this.draggedPeriodPointerId = event.pointerId;
    const rect = item.getBoundingClientRect();
    this.draggedPeriodPointerOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this.draggedPeriodGhost = this.createPeriodDragGhost(item, rect);
    this.positionPeriodDragGhost(event.clientX, event.clientY);
    item.classList.add("dragging");
    item.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePeriodPointerMove = (event: PointerEvent) => {
    if (
      event.pointerId !== this.draggedPeriodPointerId
      || !this.draggedPeriodResolution
      || !this.draggedPeriodItem
    ) return;
    this.positionPeriodDragGhost(event.clientX, event.clientY);
    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const item = hovered instanceof Element
      ? hovered.closest<HTMLElement>("[data-market-period-item]")
      : null;
    if (!item || item === this.draggedPeriodItem || !this.periodItems.contains(item)) return;
    event.preventDefault();
    this.periodItems.querySelectorAll(".drag-over").forEach((element) => {
      element.classList.remove("drag-over");
    });
    item.classList.add("drag-over");
    const rect = item.getBoundingClientRect();
    const sameRow = event.clientY >= rect.top && event.clientY <= rect.bottom;
    const insertAfter = sameRow
      ? event.clientX >= rect.left + rect.width / 2
      : event.clientY >= rect.top + rect.height / 2;
    const itemRects = new Map(
      Array.from(this.periodItems.querySelectorAll<HTMLElement>("[data-market-period-item]"))
        .map((periodItem) => [periodItem, periodItem.getBoundingClientRect()]),
    );
    this.periodItems.insertBefore(
      this.draggedPeriodItem,
      insertAfter ? item.nextElementSibling : item,
    );
    this.animatePeriodItemReorder(itemRects);
  };

  private readonly handlePeriodPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.draggedPeriodPointerId) return;
    this.finishPeriodPointerDrag(true);
  };

  private readonly handlePeriodPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.draggedPeriodPointerId) return;
    this.finishPeriodPointerDrag(false);
  };

  private readonly handleChartPanPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.chartPanPointerId !== null || !this.chart) return;
    const chartBounds = this.chartElement.getBoundingClientRect();
    const priceScaleWidth = this.chart.priceScale("right", 0).width();
    if (event.clientX >= chartBounds.right - priceScaleWidth) {
      this.queueVisiblePriceScaleUpdate();
      return;
    }
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    if (!visibleRange) return;
    this.chartPanPointerId = event.pointerId;
    this.chartPanStartX = event.clientX;
    this.chartPanStartRange = { from: visibleRange.from, to: visibleRange.to };
    this.chartElement.classList.add("horizontal-panning");
    this.chartElement.setPointerCapture?.(event.pointerId);
  };

  private readonly handleChartPanPointerMove = (event: PointerEvent) => {
    if (
      event.pointerId !== this.chartPanPointerId
      || !this.chart
      || !this.chartPanStartRange
    ) return;
    const priceScaleWidth = this.chart.priceScale("right", 0).width();
    const paneWidth = Math.max(this.chartElement.clientWidth - priceScaleWidth, 1);
    const span = this.chartPanStartRange.to - this.chartPanStartRange.from;
    const logicalShift = -((event.clientX - this.chartPanStartX) / paneWidth) * span;
    this.chart.timeScale().setVisibleLogicalRange({
      from: this.chartPanStartRange.from + logicalShift,
      to: this.chartPanStartRange.to + logicalShift,
    });
    this.queueVisiblePriceScaleUpdate();
    event.preventDefault();
  };

  private readonly handleChartPanPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.chartPanPointerId) return;
    this.finishChartPan();
  };

  private readonly handleChartPanPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.chartPanPointerId) return;
    this.finishChartPan();
  };

  private readonly handleChartWheel = (event: WheelEvent) => {
    const cursorAnchoredByDefault = this.chartSettings.scaleAnchor === "cursor";
    this.chart?.timeScale().applyOptions({
      rightBarStaysOnScroll: event.ctrlKey ? !cursorAnchoredByDefault : cursorAnchoredByDefault,
    });
    this.queueVisiblePriceScaleUpdate();
    this.trackVolumeProfileThroughWheelScale();
  };

  private readonly handlePeriodScrollPointerDown = (event: PointerEvent) => {
    if (
      event.pointerType !== "mouse"
      || event.button !== 0
      || this.periodTimes.scrollWidth <= this.periodTimes.clientWidth + 1
    ) return;
    this.periodScrollPointerId = event.pointerId;
    this.periodScrollStartX = event.clientX;
    this.periodScrollStartLeft = this.periodTimes.scrollLeft;
    this.periodScrollDragging = false;
  };

  private readonly handlePeriodScrollPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.periodScrollPointerId) return;
    const distance = event.clientX - this.periodScrollStartX;
    if (!this.periodScrollDragging && Math.abs(distance) < 4) return;
    if (!this.periodScrollDragging) {
      this.periodScrollDragging = true;
      this.periodTimes.classList.add("dragging");
      this.periodTimes.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    this.periodTimes.scrollLeft = this.periodScrollStartLeft - distance;
  };

  private finishPeriodScroll(event: PointerEvent, suppressClick: boolean) {
    if (event.pointerId !== this.periodScrollPointerId) return;
    if (this.periodTimes.hasPointerCapture?.(event.pointerId)) {
      this.periodTimes.releasePointerCapture(event.pointerId);
    }
    this.periodTimes.classList.remove("dragging");
    this.periodScrollPointerId = null;
    this.periodScrollDragging = false;
    if (!suppressClick) return;
    this.periodScrollSuppressClick = true;
    window.setTimeout(() => {
      this.periodScrollSuppressClick = false;
    }, 0);
  }

  private readonly handlePeriodScrollPointerUp = (event: PointerEvent) => {
    this.finishPeriodScroll(event, this.periodScrollDragging);
  };

  private readonly handlePeriodScrollPointerCancel = (event: PointerEvent) => {
    this.finishPeriodScroll(event, false);
  };

  private readonly handlePeriodScrollWheel = (event: WheelEvent) => {
    const maxScrollLeft = this.periodTimes.scrollWidth - this.periodTimes.clientWidth;
    if (maxScrollLeft <= 1) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? this.periodTimes.clientWidth
        : 1;
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, this.periodTimes.scrollLeft + rawDelta * deltaScale),
    );
    if (nextScrollLeft === this.periodTimes.scrollLeft) return;
    event.preventDefault();
    this.periodTimes.scrollLeft = nextScrollLeft;
  };

  private readonly handlePeriodScrollFocusIn = (event: FocusEvent) => {
    const button = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-market-interval]")
      : null;
    const interval = button?.dataset.marketInterval;
    if (interval) this.revealPeriodButton(interval);
  };

  private revealPeriodButton(interval: string, behavior: ScrollBehavior = "smooth") {
    if (this.periodRevealAnimationFrame !== null) {
      window.cancelAnimationFrame(this.periodRevealAnimationFrame);
    }
    this.periodRevealAnimationFrame = window.requestAnimationFrame(() => {
      this.periodRevealAnimationFrame = null;
      if (this.disposed) return;
      const button = this.periodTimes.querySelector<HTMLElement>(
        `[data-market-interval="${CSS.escape(interval)}"]`,
      );
      if (!button) return;
      const stripRect = this.periodTimes.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const edgeInset = 4;
      let nextScrollLeft = this.periodTimes.scrollLeft;
      if (buttonRect.left < stripRect.left + edgeInset) {
        nextScrollLeft += buttonRect.left - stripRect.left - edgeInset;
      } else if (buttonRect.right > stripRect.right - edgeInset) {
        nextScrollLeft += buttonRect.right - stripRect.right + edgeInset;
      } else {
        return;
      }
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      this.periodTimes.scrollTo({
        left: Math.max(0, nextScrollLeft),
        behavior: reduceMotion ? "auto" : behavior,
      });
    });
  }

  private updateIntervalPressedButtons(value: string) {
    this.host.querySelectorAll<HTMLElement>("[data-market-interval]").forEach((button) => {
      const active = button.dataset.marketInterval === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.revealPeriodButton(value);
  }

  private loadTradingPeriods() {
    return loadTradingPeriodsFromStorage(window.localStorage);
  }

  private loadIndicatorSettings() {
    try {
      const current = window.localStorage.getItem(TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const previous = current
        ? null
        : window.localStorage.getItem(PREVIOUS_TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const legacy = current || previous
        ? null
        : window.localStorage.getItem(LEGACY_TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const oldestLegacy = current || previous || legacy
        ? null
        : window.localStorage.getItem(OLDEST_TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const settings = normalizeTradingIndicatorSettings(
        current || previous || legacy || oldestLegacy
          ? JSON.parse(current || previous || legacy || oldestLegacy || "null")
          : null,
      );
      if (!current && (previous || legacy || oldestLegacy)) {
        const referenceMigrated = oldestLegacy
          ? migrateTradingVolumeReferenceStyle(settings)
          : settings;
        const barColorsMigrated = legacy || oldestLegacy
          ? migrateTradingBarColors(referenceMigrated)
          : referenceMigrated;
        const migrated = migrateTradingVpvrDefaults(barColorsMigrated);
        try {
          window.localStorage.setItem(
            TRADING_INDICATOR_SETTINGS_STORAGE_KEY,
            JSON.stringify(migrated),
          );
        } catch {
          // The migrated style still applies to this workspace when storage is unavailable.
        }
        return migrated;
      }
      return settings;
    } catch {
      return defaultTradingIndicatorSettings();
    }
  }

  private persistIndicatorSettings() {
    try {
      window.localStorage.setItem(
        TRADING_INDICATOR_SETTINGS_STORAGE_KEY,
        JSON.stringify(this.indicatorSettings),
      );
    } catch {
      // Indicator changes still apply to the current workspace when storage is unavailable.
    }
  }

  private loadFavoriteStorage(): TradingFavoritesStorageSnapshot {
    try {
      return loadTradingFavoritesFromStorage(
        window.localStorage,
        this.favoriteStorageAccountIdentity,
      );
    } catch {
      return { symbols: [], records: [], migratedFromLegacy: false };
    }
  }

  private saveFavoriteSymbols() {
    try {
      saveTradingFavoritesToStorage(
        window.localStorage,
        this.favoriteStorageAccountIdentity,
        {
          symbols: [...this.favoriteSymbols],
          records: [...this.favoriteMarketRecords.values()],
        },
        { removeLegacy: this.favoriteStorageMigratedFromLegacy },
      );
      this.favoriteStorageMigratedFromLegacy = false;
    } catch {
      // A disabled or full local store should not block market selection.
    }
  }

  private isMarketFavorite(market: TradingMarket) {
    return this.favoriteSymbols.has(market.id)
      || (market.provider === "binance" && this.favoriteSymbols.has(market.symbol));
  }

  private favoriteTickerMarkets() {
    const liveMarkets = new Map(this.markets.map((market) => [market.id, market]));
    return [...this.favoriteMarketRecords.values()]
      .filter((record) => (record.assetClass === "crypto" || record.provider === "binance") && this.favoriteSymbols.has(record.id))
      .map((record) => liveMarkets.get(record.id)
        || this.finnhubFavoriteMarkets.get(record.id)
        || this.favoriteTickerMarketsById.get(record.id)
        || marketFromFavoriteRecord(record))
      .slice(0, MAX_TRADING_FAVORITE_TICKERS);
  }

  private commitFavoriteTickerOrder(orderedMarketIds: string[]) {
    const reordered = reorderTradingFavoriteRecords(
      [...this.favoriteMarketRecords.values()],
      orderedMarketIds,
    );
    this.favoriteMarketRecords = new Map(reordered.map((record) => [record.id, record]));
    this.favoriteTickerMarketsById = new Map(
      orderedMarketIds.flatMap((marketId) => {
        const market = this.favoriteTickerMarketsById.get(marketId);
        return market ? [[marketId, market] as const] : [];
      }),
    );
    this.saveFavoriteSymbols();
  }

  private renderFavoriteTickerBar() {
    this.favoriteTickerSortController.cancel();
    const markets = this.favoriteTickerMarkets();
    this.favoriteTickerMarketsById = new Map(markets.map((market) => [market.id, market]));
    this.syncTitlebarFavoriteTickerHost();
    this.favoriteTickerBar.hidden = false;
    this.favoriteTickerBar.innerHTML = markets.map((market, tickerIndex) => {
      const selected = market.id === this.selectedMarketId;
      const priceText = market.quoteAvailable ? formatMarketPrice(market.markPrice) : "--";
      const changeText = market.quoteAvailable ? `${market.changePercent.toFixed(2)}%` : "--";
      const changeClass = market.quoteAvailable
        ? market.changePercent >= 0 ? "positive" : "negative"
        : "";
      const name = `${market.displaySymbol}${market.tag}`;
      return `
        <button
          type="button"
          class="trading-market-favorite-ticker${selected ? " selected" : ""}"
          data-market-action="favorite-symbol"
          data-market-id="${escapeAttribute(market.id)}"
          data-market-favorite-sort-item
          data-quote-state="${market.quoteAvailable ? "live" : "loading"}"
          aria-current="${selected}"
          aria-busy="${!market.quoteAvailable}"
          aria-posinset="${tickerIndex + 1}"
          aria-setsize="${markets.length}"
          aria-roledescription="可拖动交易对"
          aria-label="切换至 ${escapeAttribute(name)}，价格 ${escapeAttribute(priceText)}，24小时涨幅 ${escapeAttribute(changeText)}；拖动调整顺序，Alt+左右键可移动"
          title="${escapeAttribute(name)}（拖动调整顺序）"
        >
          <strong>${escapeHtml(name)}</strong>
          <span><b data-market-favorite-price>${escapeHtml(priceText)}</b><em class="${changeClass}" data-market-favorite-change>${escapeHtml(changeText)}</em></span>
          <span
            class="trading-market-favorite-remove"
            data-market-action="remove-favorite"
            data-market-id="${escapeAttribute(market.id)}"
            data-market-favorite-sort-ignore
            role="button"
            tabindex="0"
            aria-label="取消收藏 ${escapeAttribute(name)}"
            title="取消收藏"
          ><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5 5 6 6M11 5l-6 6" /></svg></span>
        </button>
      `;
    }).join("") + `
      <button
        type="button"
        class="trading-market-favorite-add"
        data-market-action="add-favorite"
        aria-label="添加收藏交易对"
        aria-haspopup="dialog"
        aria-expanded="false"
        title="添加收藏交易对"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>
      </button>
      <span class="trading-market-favorite-sort-status" data-market-favorite-sort-status aria-live="polite"></span>`;
    this.favoriteTickerBar.querySelector<HTMLElement>('[data-market-action="add-favorite"]')
      ?.setAttribute("aria-expanded", String(!this.picker.hidden));
  }

  private scheduleFavoriteTickerPaint() {
    if (this.favoriteTickerPaintFrame !== null) return;
    this.favoriteTickerPaintFrame = window.requestAnimationFrame(() => {
      this.favoriteTickerPaintFrame = null;
      this.favoriteTickerBar.querySelectorAll<HTMLButtonElement>("[data-market-id]").forEach((button) => {
        const market = this.favoriteTickerMarketsById.get(String(button.dataset.marketId || ""));
        if (!market) return;
        const price = button.querySelector<HTMLElement>("[data-market-favorite-price]");
        const change = button.querySelector<HTMLElement>("[data-market-favorite-change]");
        if (price) price.textContent = market.quoteAvailable ? formatMarketPrice(market.markPrice) : "--";
        if (change) {
          change.textContent = market.quoteAvailable ? `${market.changePercent.toFixed(2)}%` : "--";
          change.classList.toggle("positive", market.quoteAvailable && market.changePercent >= 0);
          change.classList.toggle("negative", market.quoteAvailable && market.changePercent < 0);
        }
        const priceText = market.quoteAvailable ? formatMarketPrice(market.markPrice) : "--";
        const changeText = market.quoteAvailable ? `${market.changePercent.toFixed(2)}%` : "--";
        button.dataset.quoteState = market.quoteAvailable ? "live" : "loading";
        button.setAttribute("aria-busy", String(!market.quoteAvailable));
        button.setAttribute(
          "aria-label",
          `切换至 ${market.displaySymbol}${market.tag}，价格 ${priceText}，24小时涨幅 ${changeText}；拖动调整顺序，Alt+左右键可移动`,
        );
      });
      if (!this.picker.hidden) this.paintVisibleMarketQuotes();
    });
  }

  private paintVisibleMarketQuotes() {
    this.marketList.querySelectorAll<HTMLButtonElement>('[data-market-action="symbol"][data-market-id]')
      .forEach((button) => {
        const market = this.renderedMarkets.get(String(button.dataset.marketId || ""));
        const row = button.closest<HTMLElement>(".trading-market-row");
        if (!market || !row) return;
        const price = row.querySelector<HTMLElement>("[data-market-row-price]");
        const change = row.querySelector<HTMLElement>("[data-market-row-change]");
        if (price) price.textContent = market.quoteAvailable ? formatMarketPrice(market.markPrice) : "--";
        if (change) {
          change.textContent = market.quoteAvailable
            ? `${market.changePercent >= 0 ? "+" : ""}${market.changePercent.toFixed(2)}%`
            : "--";
          change.classList.toggle("positive", market.quoteAvailable && market.changePercent >= 0);
          change.classList.toggle("negative", market.quoteAvailable && market.changePercent < 0);
        }
      });
  }

  private async refreshFavoriteTickerFallback(generation: number) {
    if (
      this.disposed
      || generation !== this.favoriteTickerGeneration
      || this.favoriteTickerFallbackPending
      || binanceMarketRestCooldownRemaining() > 0
    ) return;
    const now = Date.now();
    const staleMarkets = [...this.favoriteTickerMarketsById.values()].filter((market) => (
      market.provider === "binance"
      && now - (this.favoriteTickerSocketUpdatesByMarketId.get(market.id) || 0)
        >= FAVORITE_TICKER_SOCKET_STALE_MS
    ));
    if (!staleMarkets.length) return;
    this.favoriteTickerFallbackPending = true;
    const abortController = new AbortController();
    this.favoriteTickerFallbackAbortController = abortController;
    const timeout = window.setTimeout(
      () => abortController.abort(),
      FAVORITE_TICKER_FALLBACK_TIMEOUT_MS,
    );
    try {
      let updated = false;
      for (const staleMarket of staleMarkets) {
        if (binanceMarketRestCooldownRemaining() > 0 || abortController.signal.aborted) break;
        let ticker: BinanceTicker24h;
        try {
          ticker = await fetchBinanceMarket<BinanceTicker24h>(
            staleMarket.marketType === "spot" ? "spot" : "perpetual",
            "/fapi/v1/ticker/24hr",
            "/api/v3/ticker/24hr",
            { symbol: staleMarket.symbol },
            abortController.signal,
          );
        } catch {
          if (binanceMarketRestCooldownRemaining() > 0 || abortController.signal.aborted) break;
          continue;
        }
        if (this.disposed || generation !== this.favoriteTickerGeneration) return;
        const market = this.favoriteTickerMarketsById.get(staleMarket.id);
        if (!market || market.provider !== "binance" || market.symbol !== staleMarket.symbol) continue;
        const applied = applyTradingMarketTickerQuote(
          market,
          {
            lastPrice: ticker.lastPrice,
            openPrice: ticker.openPrice,
            changePercent: ticker.priceChangePercent,
          },
          this.favoriteTickerOpenPricesById.get(market.id),
        );
        if (!applied.updated) continue;
        if (applied.openPrice !== null) {
          this.favoriteTickerOpenPricesById.set(market.id, applied.openPrice);
        }
        updated = true;
      }
      if (updated) this.scheduleFavoriteTickerPaint();
    } finally {
      window.clearTimeout(timeout);
      if (this.favoriteTickerFallbackAbortController === abortController) {
        this.favoriteTickerFallbackAbortController = null;
      }
      if (generation === this.favoriteTickerGeneration) {
        this.favoriteTickerFallbackPending = false;
      }
    }
  }

  private closeFavoriteTickerStreams() {
    if (this.favoriteTickerReconnectTimer !== null) {
      window.clearTimeout(this.favoriteTickerReconnectTimer);
      this.favoriteTickerReconnectTimer = null;
    }
    if (this.favoriteTickerFallbackTimer !== null) {
      window.clearInterval(this.favoriteTickerFallbackTimer);
      this.favoriteTickerFallbackTimer = null;
    }
    this.favoriteTickerFallbackAbortController?.abort();
    this.favoriteTickerFallbackAbortController = null;
    this.favoriteTickerStreamSubscriptionIds.forEach(unsubscribeBinanceMarketStreams);
    this.favoriteTickerStreamSubscriptionIds = [];
    this.favoriteTickerFallbackPending = false;
  }

  private syncFavoriteTickerStreams() {
    const generation = ++this.favoriteTickerGeneration;
    this.closeFavoriteTickerStreams();
    this.favoriteTickerSocketUpdatesByMarketId.clear();
    const groups = new Map<Extract<TradingMarketType, "spot" | "perpetual">, TradingMarket[]>();
    [...this.favoriteTickerMarketsById.values()]
      .filter((market) => market.provider === "binance")
      .forEach((market) => {
        const marketType = market.marketType === "spot" ? "spot" : "perpetual";
        const group = groups.get(marketType) || [];
        group.push(market);
        groups.set(marketType, group);
      });
    if (!groups.size) return;
    void this.refreshFavoriteTickerFallback(generation);
    this.favoriteTickerFallbackTimer = window.setInterval(
      () => void this.refreshFavoriteTickerFallback(generation),
      FAVORITE_TICKER_FALLBACK_INTERVAL_MS,
    );
    groups.forEach((markets, marketType) => void this.connectFavoriteTickerGroup(markets, marketType, generation));
  }

  private async connectFavoriteTickerGroup(
    markets: TradingMarket[],
    marketType: Extract<TradingMarketType, "spot" | "perpetual">,
    generation: number,
  ) {
    const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
    let result: { subscriptionId: string };
    try {
      result = await subscribeBinanceMarketStreams(
        marketType,
        tradingFavoriteTickerStreams(marketBySymbol.keys()),
        (event) => {
          if (this.disposed || generation !== this.favoriteTickerGeneration || event?.type !== "data") return;
          const payload = event.data as BinanceWsMessage;
          if (payload?.e !== "24hrTicker" || !payload.s) return;
          const market = marketBySymbol.get(payload.s.toUpperCase());
          if (!market) return;
          const applied = applyTradingMarketTickerQuote(
            market,
            { lastPrice: payload.c, openPrice: payload.o, changePercent: payload.P },
            this.favoriteTickerOpenPricesById.get(market.id),
          );
          if (!applied.updated) return;
          if (applied.openPrice !== null) {
            this.favoriteTickerOpenPricesById.set(market.id, applied.openPrice);
          }
          this.favoriteTickerSocketUpdatesByMarketId.set(market.id, Date.now());
          this.scheduleFavoriteTickerPaint();
        },
      );
    } catch {
      if (!this.disposed && generation === this.favoriteTickerGeneration && this.favoriteTickerReconnectTimer === null) {
        this.favoriteTickerReconnectTimer = window.setTimeout(() => this.syncFavoriteTickerStreams(), 1_500);
      }
      return;
    }
    if (this.disposed || generation !== this.favoriteTickerGeneration) {
      unsubscribeBinanceMarketStreams(result.subscriptionId);
      return;
    }
    this.favoriteTickerStreamSubscriptionIds.push(result.subscriptionId);
  }

  private toggleFavoriteMarket(market: TradingMarket) {
    if (this.isMarketFavorite(market)) {
      this.favoriteSymbols.delete(market.id);
      if (market.provider === "binance") this.favoriteSymbols.delete(market.symbol);
      this.favoriteMarketRecords.delete(market.id);
    } else {
      this.favoriteSymbols.add(market.id);
      this.favoriteMarketRecords.set(market.id, tradingFavoriteRecord(market));
    }
    if (!this.favoriteSymbols.size) this.showFavoritesOnly = false;
    this.saveFavoriteSymbols();
    this.renderMarkets();
    this.renderFavoriteTickerBar();
    this.syncFavoriteTickerStreams();
  }

  private favoriteMarketFromId(marketId: string) {
    const refreshed = [
      this.markets.find((market) => market.id === marketId),
      this.favoriteTickerMarketsById.get(marketId),
      this.finnhubFavoriteMarkets.get(marketId),
      this.ifindFavoriteMarkets.get(marketId),
    ].reduce<TradingMarket | undefined>(
      (current, candidate) => candidate
        ? preferTradingMarketQuote(current, candidate)
        : current,
      undefined,
    );
    if (refreshed) return refreshed;
    const record = this.favoriteMarketRecords.get(marketId);
    return record ? marketFromFavoriteRecord(record) : null;
  }

  private selectMarket(market: TradingMarket) {
    this.selectedMarketMeta = { ...market };
    this.selectedMarketId = market.id;
    this.selectedProvider = market.provider;
    this.selectedAssetClass = market.assetClass;
    this.selectedMarketType = market.marketType;
    this.selectedSymbol = market.symbol;
    if (market.provider === "ifind" && !ifindSupportsTradingResolution(this.activeInterval)) {
      this.activeInterval = this.periods
        .map((period) => tradingViewResolution(period))
        .find((resolution) => ifindSupportsTradingResolution(resolution)) || "1D";
      this.updateIntervalPressedButtons(this.activeInterval);
    }
    this.syncIntervalAvailability();
    this.recordLastDrawingWorkspace();
  }

  private syncIntervalAvailability() {
    const ifindSelected = this.selectedProvider === "ifind";
    this.periodControls.querySelectorAll<HTMLButtonElement>("[data-market-interval]").forEach((button) => {
      const resolution = String(button.dataset.marketInterval || "");
      const disabled = ifindSelected && !ifindSupportsTradingResolution(resolution);
      button.disabled = disabled;
      if (disabled) button.title = "同花顺 A 股当前仅支持日线和周线";
      else button.removeAttribute("title");
    });
  }

  private openDefaultPerpetualMarket() {
    const market = this.markets.find(
      (candidate) => candidate.id === `BINANCE:FUTURES:${DEFAULT_SYMBOL}`,
    ) || defaultBinancePerpetualMarket();
    this.selectMarket(market);
    this.updateSymbolUi();
    this.renderMarkets();
    this.drawingController?.redraw();
    this.setPickerOpen(false);
    void this.restartMarketData();
  }

  private renderPeriodButtons() {
    const buttons = renderTimeButtons(this.periods, this.activeInterval);
    this.periodTimes.innerHTML = buttons;
    this.primaryPeriodMenu.innerHTML = buttons;
    this.syncIntervalAvailability();
  }

  private renderPeriodEditor(resetStatus = true) {
    this.periodItems.innerHTML = this.draftPeriods.map((period) => {
      const resolution = tradingViewResolution(period);
      return `
        <div
          class="trading-market-period-item"
          data-market-period-item
          data-market-period-resolution="${resolution}"
        >
          <span class="trading-market-period-grip" aria-hidden="true">⋮⋮</span>
          <span data-i18n-trading-period-label>${tradingPeriodLabel(period)}</span>
          <button
            type="button"
            data-market-action="remove-period"
            data-market-period-resolution="${resolution}"
            aria-label="移除${tradingPeriodLabel(period)}"
          >−</button>
        </div>
      `;
    }).join("");
    const addButton = this.host.querySelector<HTMLButtonElement>('[data-market-action="add-period"]');
    if (addButton) addButton.disabled = this.draftPeriods.length >= MAX_TRADING_PERIODS;
    if (resetStatus) this.setPeriodStatus("");
  }

  private setPeriodStatus(message: string, tone: "error" | "success" | "" = "") {
    this.periodStatus.textContent = message;
    if (tone) this.periodStatus.dataset.tone = tone;
    else delete this.periodStatus.dataset.tone;
  }

  private addDraftPeriod() {
    if (this.draftPeriods.length >= MAX_TRADING_PERIODS) {
      this.setPeriodStatus(`最多只能添加 ${MAX_TRADING_PERIODS} 个周期。`, "error");
      return;
    }
    const amount = Number(this.periodAmountInput.value);
    const unit = this.periodUnit;
    if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) {
      this.setPeriodStatus("请输入 1–10000 之间的整数。", "error");
      this.periodAmountInput.focus();
      return;
    }
    const period: TradingPeriod = { amount, unit };
    const resolution = tradingViewResolution(period);
    if (this.draftPeriods.some((item) => tradingViewResolution(item) === resolution)) {
      this.setPeriodStatus(`${tradingPeriodLabel(period)} 已经添加。`, "error");
      return;
    }
    this.draftPeriods = [...this.draftPeriods, period];
    this.renderPeriodEditor();
    this.setPeriodStatus(`已添加 ${tradingPeriodLabel(period)}。`, "success");
  }

  private confirmDraftPeriods() {
    if (!this.draftPeriods.length) {
      this.setPeriodStatus("请至少保留一个周期。", "error");
      return;
    }
    const previousInterval = this.activeInterval;
    const previousResolutions = new Set(
      this.periods.map((period) => tradingViewResolution(period)),
    );
    this.periods = normalizeTradingPeriods(this.draftPeriods);
    try {
      window.localStorage.setItem(TRADING_PERIODS_STORAGE_KEY, JSON.stringify(this.periods));
    } catch {
      // Storage failure should not prevent applying this session's configuration.
    }
    if (!this.periods.some((period) => tradingViewResolution(period) === this.activeInterval)) {
      this.activeInterval = tradingViewResolution(this.periods[0]);
    }
    this.renderPeriodButtons();
    const addedResolution = this.periods.reduce<string | null>((latest, period) => {
      const resolution = tradingViewResolution(period);
      return previousResolutions.has(resolution) ? latest : resolution;
    }, null);
    this.revealPeriodButton(addedResolution || this.activeInterval);
    this.setPeriodEditorOpen(false);
    if (tradingSplitLayout(this.splitLayoutId).count > 1) this.applySplitLayout();
    if (this.activeInterval !== previousInterval) {
      void this.restartMarketData({ preserveChart: true });
    }
  }

  private clearPeriodDragState() {
    if (
      this.draggedPeriodItem
      && this.draggedPeriodPointerId !== null
      && this.draggedPeriodItem.hasPointerCapture?.(this.draggedPeriodPointerId)
    ) {
      this.draggedPeriodItem.releasePointerCapture(this.draggedPeriodPointerId);
    }
    this.draggedPeriodGhost?.remove();
    this.draggedPeriodResolution = null;
    this.draggedPeriodItem = null;
    this.draggedPeriodGhost = null;
    this.draggedPeriodPointerId = null;
    this.periodItems.querySelectorAll(".dragging, .drag-over").forEach((element) => {
      element.classList.remove("dragging", "drag-over");
    });
  }

  private createPeriodDragGhost(item: HTMLElement, rect: DOMRect) {
    const ghost = item.cloneNode(true) as HTMLElement;
    const computed = window.getComputedStyle(item);
    ghost.removeAttribute("data-market-period-item");
    ghost.removeAttribute("data-market-period-resolution");
    ghost.classList.remove("dragging", "drag-over");
    ghost.classList.add("trading-market-period-drag-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.querySelectorAll<HTMLElement>("button, [tabindex]").forEach((element) => {
      element.setAttribute("tabindex", "-1");
    });
    Object.assign(ghost.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: computed.background,
      borderColor: computed.borderColor,
      borderRadius: computed.borderRadius,
      color: computed.color,
    });
    document.body.appendChild(ghost);
    return ghost;
  }

  private positionPeriodDragGhost(clientX: number, clientY: number) {
    if (!this.draggedPeriodGhost) return;
    this.draggedPeriodGhost.style.left = `${clientX - this.draggedPeriodPointerOffset.x}px`;
    this.draggedPeriodGhost.style.top = `${clientY - this.draggedPeriodPointerOffset.y}px`;
  }

  private animatePeriodItemReorder(previousRects: Map<HTMLElement, DOMRect>) {
    previousRects.forEach((previousRect, item) => {
      if (item === this.draggedPeriodItem) return;
      const currentRect = item.getBoundingClientRect();
      const offsetX = previousRect.left - currentRect.left;
      const offsetY = previousRect.top - currentRect.top;
      if (!offsetX && !offsetY) return;
      item.animate(
        [
          { transform: `translate(${offsetX}px, ${offsetY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 150, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
  }

  private finishPeriodPointerDrag(commit: boolean) {
    if (commit) {
      const orderedResolutions = Array.from(
        this.periodItems.querySelectorAll<HTMLElement>("[data-market-period-item]"),
      ).flatMap((item) => item.dataset.marketPeriodResolution ?? []);
      this.draftPeriods = reorderTradingPeriods(this.draftPeriods, orderedResolutions);
    }
    this.clearPeriodDragState();
    this.renderPeriodEditor(false);
    if (commit) this.setPeriodStatus("排序已更新，点击确定后生效。", "success");
  }

  private updateIndicatorButtons() {
    this.host.querySelectorAll<HTMLButtonElement>("[data-market-indicator]").forEach((button) => {
      const active = this.activeIndicators.includes(button.dataset.marketIndicator as TradingIndicatorId);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private updateMainIndicatorButtons() {
    this.host.querySelectorAll<HTMLButtonElement>("[data-market-main-indicator]").forEach((button) => {
      const active = this.activeMainIndicators.includes(
        button.dataset.marketMainIndicator as TradingMainIndicatorId,
      );
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private async loadFinnhubStatus() {
    const api = window.codexDesktop.getFinnhubMarketDataStatus;
    if (!api) {
      this.finnhubConfigured = false;
      return;
    }
    try {
      const response = await api();
      if (this.disposed) return;
      if (response?.ok !== true) throw new Error(String(response?.message || "读取 Finnhub 状态失败"));
      this.finnhubConfigured = response.status?.available === true;
      if (this.finnhubConfigured) void this.refreshFavoriteFinnhubQuotes();
    } catch {
      if (this.disposed) return;
      this.finnhubConfigured = false;
    }
  }

  private scheduleFinnhubSearch(immediate = false) {
    this.finnhubSearchGeneration += 1;
    const generation = this.finnhubSearchGeneration;
    if (this.finnhubSearchTimer !== null) {
      window.clearTimeout(this.finnhubSearchTimer);
      this.finnhubSearchTimer = null;
    }
    const query = this.search.value.trim();
    this.finnhubSearchMarkets = [];
    this.finnhubSearchPending = false;
    if (query.length < 2) {
      this.renderMarkets({ resetScroll: true });
      return;
    }
    if (!this.finnhubConfigured) {
      this.renderMarkets({ resetScroll: true });
      return;
    }
    if (!window.codexDesktop.searchFinnhubMarkets) {
      this.renderMarkets({ resetScroll: true });
      return;
    }
    this.finnhubSearchPending = true;
    this.renderMarkets({ resetScroll: true });
    this.finnhubSearchTimer = window.setTimeout(() => {
      this.finnhubSearchTimer = null;
      void this.searchFinnhub(query, generation);
    }, immediate ? 0 : FINNHUB_SEARCH_DEBOUNCE_MS);
  }

  private async searchFinnhub(query: string, generation: number) {
    const search = window.codexDesktop.searchFinnhubMarkets;
    if (!search) return;
    try {
      const response = await search({ query, limit: 12 });
      if (this.disposed || generation !== this.finnhubSearchGeneration || this.search.value.trim() !== query) return;
      if (response?.ok !== true) {
        this.finnhubSearchMarkets = [];
      } else {
        this.finnhubSearchMarkets = Array.isArray(response.markets)
          ? response.markets.flatMap((market: unknown) => normalizeFinnhubTradingMarket(market) ?? [])
          : [];
      }
    } catch {
      if (this.disposed || generation !== this.finnhubSearchGeneration) return;
      this.finnhubSearchMarkets = [];
    } finally {
      if (!this.disposed && generation === this.finnhubSearchGeneration) {
        this.finnhubSearchPending = false;
        this.renderMarkets({ resetScroll: true });
      }
    }
  }

  private async refreshFavoriteFinnhubQuotes() {
    const quoteApi = window.codexDesktop.getFinnhubMarketQuotes;
    if (!this.finnhubConfigured || !quoteApi) return;
    const records = [...this.favoriteMarketRecords.values()].filter((record) => record.provider === "finnhub");
    if (!records.length) return;
    const response = await quoteApi({ symbols: records.map((record) => record.symbol) });
    if (this.disposed || response?.ok !== true || !Array.isArray(response.quotes)) return;
    const quoteBySymbol = new Map(
      response.quotes.map((quote: any) => [String(quote?.symbol || "").toUpperCase(), quote]),
    );
    records.forEach((record) => {
      const quote: any = quoteBySymbol.get(record.symbol);
      const market = marketFromFavoriteRecord(record);
      if (quote && quote.unavailable !== true) {
        market.markPrice = Number.isFinite(Number(quote.current)) ? Number(quote.current) : 0;
        market.changePercent = Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : 0;
        market.quoteAvailable = market.markPrice > 0;
      }
      this.finnhubFavoriteMarkets.set(record.id, market);
    });
    this.renderFavoriteTickerBar();
    if (!this.picker.hidden) this.renderMarkets();
  }

  private async loadIfindStatus() {
    const api = window.codexDesktop.getIfindMarketDataStatus;
    if (!api) {
      this.ifindConfigured = false;
      return;
    }
    try {
      const response = await api();
      if (this.disposed) return;
      if (response?.ok !== true) throw new Error(String(response?.message || "读取 iFinD 状态失败"));
      this.ifindConfigured = response.status?.available === true;
      if (this.ifindConfigured) {
        void this.refreshFavoriteIfindQuotes();
        if (this.marketCategory === "a-share") this.scheduleIfindSearch(true);
      }
    } catch {
      if (this.disposed) return;
      this.ifindConfigured = false;
    }
  }

  private scheduleIfindSearch(immediate = false) {
    this.ifindSearchGeneration += 1;
    const generation = this.ifindSearchGeneration;
    if (this.ifindSearchTimer !== null) {
      window.clearTimeout(this.ifindSearchTimer);
      this.ifindSearchTimer = null;
    }
    const query = this.search.value.trim();
    this.ifindSearchMarkets = [];
    this.ifindSearchPending = false;
    const shouldLoadIfindDirectory = this.marketCategory === "a-share";
    if ((!query && !shouldLoadIfindDirectory) || !this.ifindConfigured || !window.codexDesktop.searchIfindMarkets) {
      this.renderMarkets({ resetScroll: true });
      return;
    }
    this.ifindSearchPending = true;
    this.renderMarkets({ resetScroll: true });
    this.ifindSearchTimer = window.setTimeout(() => {
      this.ifindSearchTimer = null;
      void this.searchIfind(query, generation);
    }, immediate ? 0 : FINNHUB_SEARCH_DEBOUNCE_MS);
  }

  private async searchIfind(query: string, generation: number) {
    const search = window.codexDesktop.searchIfindMarkets;
    if (!search) return;
    try {
      const response = await search({
        query,
        limit: query ? 12 : IFIND_DEFAULT_DIRECTORY_LIMIT,
      });
      if (this.disposed || generation !== this.ifindSearchGeneration || this.search.value.trim() !== query) return;
      this.ifindSearchMarkets = response?.ok === true && Array.isArray(response.markets)
        ? response.markets.flatMap((market: unknown) => normalizeIfindTradingMarket(market) ?? [])
        : [];
    } catch {
      if (this.disposed || generation !== this.ifindSearchGeneration) return;
      this.ifindSearchMarkets = [];
    } finally {
      if (!this.disposed && generation === this.ifindSearchGeneration) {
        this.ifindSearchPending = false;
        this.renderMarkets({ resetScroll: true });
      }
    }
  }

  private async refreshFavoriteIfindQuotes() {
    const quoteApi = window.codexDesktop.getIfindMarketQuotes;
    if (!this.ifindConfigured || !quoteApi) return;
    const records = [...this.favoriteMarketRecords.values()].filter((record) => record.provider === "ifind");
    if (!records.length) return;
    const response = await quoteApi({ symbols: records.map((record) => record.symbol) });
    if (this.disposed || response?.ok !== true || !Array.isArray(response.quotes)) return;
    const quoteBySymbol = new Map(
      response.quotes.map((quote: any) => [String(quote?.symbol || "").toUpperCase(), quote]),
    );
    records.forEach((record) => {
      const quote: any = quoteBySymbol.get(record.symbol);
      const market = marketFromFavoriteRecord(record);
      if (quote && quote.unavailable !== true) {
        market.markPrice = Number.isFinite(Number(quote.current)) ? Number(quote.current) : 0;
        market.changePercent = Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : 0;
        market.volume24h = Number.isFinite(Number(quote.volume)) ? Number(quote.volume) : 0;
        market.quoteAvailable = market.markPrice > 0;
      }
      this.ifindFavoriteMarkets.set(record.id, market);
    });
    this.renderFavoriteTickerBar();
    if (!this.picker.hidden) this.renderMarkets();
  }

  private setPickerOpen(open: boolean) {
    if (open) {
      this.setPrimaryPeriodMenuOpen(false);
      this.setPeriodEditorOpen(false);
      this.setIndicatorEditorOpen(false);
    } else {
      // A selection closes the picker immediately; stop any remaining chunk
      // work so the hidden directory does not continue consuming the main
      // thread after the click.
      this.marketListRenderGeneration += 1;
      if (this.marketListRenderTimer !== null) {
        window.clearTimeout(this.marketListRenderTimer);
        this.marketListRenderTimer = null;
      }
      this.marketList.removeAttribute("aria-busy");
    }
    this.picker.hidden = !open;
    this.host.querySelector<HTMLElement>('[data-market-action="toggle-symbols"]')
      ?.setAttribute("aria-expanded", String(open));
    this.favoriteTickerBar.querySelector<HTMLElement>('[data-market-action="add-favorite"]')
      ?.setAttribute("aria-expanded", String(open));
    if (open) {
      this.search.value = "";
      this.finnhubSearchGeneration += 1;
      if (this.finnhubSearchTimer !== null) window.clearTimeout(this.finnhubSearchTimer);
      this.finnhubSearchTimer = null;
      this.finnhubSearchMarkets = [];
      this.finnhubSearchPending = false;
      this.ifindSearchGeneration += 1;
      if (this.ifindSearchTimer !== null) window.clearTimeout(this.ifindSearchTimer);
      this.ifindSearchTimer = null;
      this.ifindSearchMarkets = [];
      this.ifindSearchPending = false;
      // Open on the full directory, with favorites ordered first. Users can
      // still narrow the result with the search field or category tabs.
      this.showFavoritesOnly = false;
      this.syncMarketCategoryButtons();
      this.renderMarkets({ resetScroll: true });
      if (this.finnhubConfigured) void this.refreshFavoriteFinnhubQuotes();
      if (this.ifindConfigured) void this.refreshFavoriteIfindQuotes();
      // Opening the picker clears the previous remote result set. When the
      // A-share tab is already selected (for example after expanding the
      // chart and reopening the picker), reload the default iFinD directory
      // instead of leaving the list empty until the category is clicked again.
      if (this.ifindConfigured && this.marketCategory === "a-share") {
        this.scheduleIfindSearch(true);
      }
      this.search.focus();
      this.search.select();
    }
  }

  private setPeriodEditorOpen(open: boolean) {
    this.setPeriodUnitMenuOpen(false);
    this.periodEditor.hidden = !open;
    const trigger = this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-editor"]');
    trigger?.setAttribute("aria-expanded", String(open));
    trigger?.classList.toggle("active", open);
    if (open) {
      this.setPickerOpen(false);
      this.setIndicatorEditorOpen(false);
      this.draftPeriods = cloneTradingPeriods(this.periods);
      this.renderPeriodEditor();
      window.requestAnimationFrame(() => {
        this.periodAmountInput.focus();
        this.periodAmountInput.select();
      });
    } else {
      this.clearPeriodDragState();
      this.draftPeriods = cloneTradingPeriods(this.periods);
    }
  }

  private setPrimaryPeriodMenuOpen(open: boolean) {
    const splitActive = this.host.classList.contains("split-layout-active");
    const nextOpen = open && splitActive;
    if (nextOpen) {
      this.setPeriodEditorOpen(false);
      this.setPickerOpen(false);
      this.setIndicatorEditorOpen(false);
      this.setLayoutPickerOpen(false);
    }
    this.primaryPeriodMenu.hidden = !nextOpen;
    const trigger = this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-editor"]');
    const expanded = nextOpen || (!splitActive && !this.periodEditor.hidden);
    trigger?.setAttribute("aria-haspopup", splitActive ? "listbox" : "dialog");
    trigger?.setAttribute("aria-expanded", String(expanded));
    trigger?.classList.toggle("active", expanded);
  }

  private indicatorCatalogItem(key: string) {
    return TRADING_MARKET_INDICATOR_CATALOG.find((indicator) =>
      tradingIndicatorSettingKey(indicator.scope, indicator.id) === key
    );
  }

  private syncActiveIndicatorsFromSettings() {
    this.activeMainIndicators = TRADING_MARKET_INDICATOR_CATALOG
      .filter((indicator) => indicator.scope === "main"
        && this.indicatorSettings[tradingIndicatorSettingKey(indicator.scope, indicator.id)]?.enabled)
      .map((indicator) => indicator.id as TradingMainIndicatorId);
    this.activeIndicators = TRADING_MARKET_INDICATOR_CATALOG
      .filter((indicator) => indicator.scope === "sub"
        && this.indicatorSettings[tradingIndicatorSettingKey(indicator.scope, indicator.id)]?.enabled)
      .map((indicator) => indicator.id as TradingIndicatorId);
  }

  private setIndicatorStatus(message: string, tone: "default" | "success" = "default") {
    this.indicatorStatus.textContent = message;
    this.indicatorStatus.dataset.tone = tone;
  }

  private setIndicatorEditorOpen(open: boolean) {
    this.indicatorEditor.hidden = !open;
    this.openIndicatorWidthMenuKey = null;
    const splitTarget = this.indicatorEditorSplitPane;
    this.host
      .querySelectorAll<HTMLElement>('[data-market-action="toggle-indicator-editor"]')
      .forEach((trigger) => {
        const active = open && !splitTarget;
        trigger.setAttribute("aria-expanded", String(active));
        trigger.classList.toggle("active", active);
      });
    this.splitPanes.forEach((pane) => pane.setIndicatorEditorActive(open && pane === splitTarget));
    if (open) {
      this.setPrimaryPeriodMenuOpen(false);
      this.setPickerOpen(false);
      this.setPeriodEditorOpen(false);
      this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
      if (!this.draftIndicatorSettings[this.selectedIndicatorSettingKey]) {
        this.selectedIndicatorSettingKey = "main:ma";
      }
      this.renderIndicatorEditor();
      window.requestAnimationFrame(() => {
        this.indicatorCatalog
          .querySelector<HTMLElement>('[data-market-action="select-indicator-setting"].selected')
          ?.focus();
      });
    } else {
      this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
      this.indicatorScrollTimers.forEach((timer, scroller) => {
        window.clearTimeout(timer);
        scroller.classList.remove("scrolling");
      });
      this.indicatorScrollTimers.clear();
      this.indicatorEditorSplitPane = null;
    }
  }

  private renderIndicatorEditor(resetStatus = true) {
    this.clearIndicatorScrollerState(this.indicatorCatalog);
    this.clearIndicatorScrollerState(this.indicatorDetail);
    const renderSection = (scope: TradingIndicatorScope, title: string) => `
      <section class="trading-market-indicator-catalog-section" aria-label="${title}">
        <h3>${title}</h3>
        ${TRADING_MARKET_INDICATOR_CATALOG.filter((indicator) => indicator.scope === scope).map((indicator) => {
          const key = tradingIndicatorSettingKey(indicator.scope, indicator.id);
          const selected = key === this.selectedIndicatorSettingKey;
          return `
            <div class="trading-market-indicator-catalog-item${selected ? " selected" : ""}">
              <button
                type="button"
                class="${selected ? "selected" : ""}"
                data-market-action="select-indicator-setting"
                data-market-indicator-setting="${key}"
                aria-pressed="${selected}"
              >
                <span><strong>${indicator.label}</strong><small>${indicator.name}</small></span>
              </button>
            </div>
          `;
        }).join("")}
      </section>
    `;
    this.indicatorCatalog.innerHTML = renderSection("main", "主图") + renderSection("sub", "副图");

    const indicator = this.indicatorCatalogItem(this.selectedIndicatorSettingKey)
      ?? TRADING_MARKET_INDICATOR_CATALOG[0];
    const key = tradingIndicatorSettingKey(indicator.scope, indicator.id);
    const setting = this.draftIndicatorSettings[key];
    const parameterRows = indicator.parameters.length
      ? indicator.parameters.map((parameter, index) => {
          const inputId = `trading-indicator-parameter-${indicator.scope}-${indicator.id}-${index}`;
          return `
            <div class="trading-market-indicator-parameter-row">
              <label for="${inputId}">${parameter.label}</label>
              <span class="trading-market-indicator-parameter-input">
                <input
                  id="${inputId}"
                  type="number"
                  min="${parameter.min}"
                  max="${parameter.max}"
                  step="${parameter.step}"
                  value="${setting.parameters[index]}"
                  inputmode="decimal"
                  data-market-indicator-setting="${key}"
                  data-market-indicator-parameter="${index}"
                />
                <span class="trading-market-indicator-parameter-stepper">
                  <button
                    type="button"
                    data-market-action="step-indicator-parameter"
                    data-market-indicator-step="up"
                    aria-label="增加${parameter.label}"
                  ><svg viewBox="0 0 10 6" aria-hidden="true"><path d="m1 5 4-4 4 4"/></svg></button>
                  <button
                    type="button"
                    data-market-action="step-indicator-parameter"
                    data-market-indicator-step="down"
                    aria-label="减少${parameter.label}"
                  ><svg viewBox="0 0 10 6" aria-hidden="true"><path d="m1 1 4 4 4-4"/></svg></button>
                </span>
              </span>
            </div>
          `;
        }).join("")
      : '<p class="trading-market-indicator-empty-parameters">该指标无需设置计算参数</p>';
    const displayRows = indicator.display.map((field) => {
      const series = setting.series[field.key];
      const colorControl = field.type === "histogram" ? '<span class="trading-market-indicator-display-kind">柱状图</span>' : `
        <label class="trading-market-indicator-color" title="${field.label}颜色">
          <input
            type="color"
            value="${series.color}"
            data-market-indicator-setting="${key}"
            data-market-indicator-series="${field.key}"
            data-market-indicator-series-color
            aria-label="${field.label}颜色"
          />
          <span style="--indicator-setting-color: ${series.color}"></span>
        </label>
      `;
      const widthControl = field.type && field.type !== "line" ? "" : (() => {
        const widthMenuKey = `${key}:${field.key}`;
        const widthLabels = { 1: "细线", 2: "标准", 3: "粗线" } as const;
        const menuOpen = this.openIndicatorWidthMenuKey === widthMenuKey;
        return `
          <div
            class="video-expert-select trading-market-indicator-width-select${menuOpen ? " open" : ""}"
            data-market-indicator-width-select
            data-market-indicator-width-menu="${widthMenuKey}"
          >
            <button
              type="button"
              class="video-expert-select-button trading-market-indicator-width-trigger"
              data-market-action="toggle-indicator-width-menu"
              data-market-indicator-width-menu="${widthMenuKey}"
              aria-haspopup="listbox"
              aria-expanded="${menuOpen}"
              aria-label="${field.label}线宽"
            >
              <span>${widthLabels[series.lineWidth]}</span>
              <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
            </button>
            <div
              class="video-expert-select-menu trading-market-indicator-width-menu"
              role="listbox"
              aria-label="${field.label}线宽"
              ${menuOpen ? "" : "hidden"}
            >
              ${([1, 2, 3] as const).map((width) => `
                <button
                  type="button"
                  role="option"
                  class="${series.lineWidth === width ? "selected" : ""}"
                  data-market-action="set-indicator-series-width"
                  data-market-indicator-setting="${key}"
                  data-market-indicator-series="${field.key}"
                  data-market-indicator-width="${width}"
                  aria-selected="${series.lineWidth === width}"
                >${widthLabels[width]}</button>
              `).join("")}
            </div>
          </div>
        `;
      })();
      return `
        <div class="trading-market-indicator-display-row">
          <label>
            <input
              type="checkbox"
              ${series.visible ? "checked" : ""}
              data-market-indicator-setting="${key}"
              data-market-indicator-series="${field.key}"
              data-market-indicator-series-visible
            />
            <span>${field.label}</span>
          </label>
          <div>${widthControl}${colorControl}</div>
        </div>
      `;
    }).join("");
    this.indicatorDetail.innerHTML = `
      <header class="trading-market-indicator-detail-header">
        <span class="trading-market-indicator-detail-icon">${indicator.label}</span>
        <div><strong>${indicator.label}</strong><span>${indicator.name}</span></div>
      </header>
      <section class="trading-market-indicator-settings-section">
        <h3><span></span>参数</h3>
        <div class="trading-market-indicator-parameter-list">${parameterRows}</div>
      </section>
      <section class="trading-market-indicator-settings-section">
        <h3><span></span>显示</h3>
        <div class="trading-market-indicator-display-list">${displayRows}</div>
      </section>
      <section class="trading-market-indicator-description">
        <h3>
          <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"/></svg>
          指标说明
        </h3>
        <p>${indicator.description}</p>
      </section>
    `;
    if (resetStatus) this.setIndicatorStatus("修改将在保存后应用到图表");
  }

  private setIndicatorWidthMenuOpen(menuKey: string | null, focusSelectedOption = false) {
    this.openIndicatorWidthMenuKey = menuKey;
    this.indicatorDetail
      .querySelectorAll<HTMLElement>("[data-market-indicator-width-select]")
      .forEach((picker) => {
        const open = picker.dataset.marketIndicatorWidthMenu === menuKey;
        picker.classList.toggle("open", open);
        const trigger = picker.querySelector<HTMLElement>(".trading-market-indicator-width-trigger");
        const menu = picker.querySelector<HTMLElement>(".trading-market-indicator-width-menu");
        trigger?.setAttribute("aria-expanded", String(open));
        if (menu) menu.hidden = !open;
        if (open && focusSelectedOption) {
          window.requestAnimationFrame(() => {
            menu?.querySelector<HTMLElement>("[role=option].selected")?.focus();
          });
        }
      });
  }

  private saveDraftIndicatorSettings() {
    const splitTarget = this.indicatorEditorSplitPane;
    const selectedIndicator = this.indicatorCatalogItem(this.selectedIndicatorSettingKey);
    const selectedSetting = this.draftIndicatorSettings[this.selectedIndicatorSettingKey];
    if (selectedSetting && !splitTarget) selectedSetting.enabled = true;
    const nextSettings = normalizeTradingIndicatorSettings(this.draftIndicatorSettings);
    if (splitTarget) {
      Object.keys(nextSettings).forEach((key) => {
        nextSettings[key].enabled = this.indicatorSettings[key]?.enabled === true;
      });
    }
    this.indicatorSettings = nextSettings;
    this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
    this.syncActiveIndicatorsFromSettings();
    this.persistIndicatorSettings();
    this.updateMainIndicatorButtons();
    this.updateIndicatorButtons();
    this.applyMainIndicatorSeriesOptions();
    this.rebuildIndicatorPanes();
    this.invalidateVolumeProfileSnapshot();
    this.updateChartData({ preserveViewport: true });
    this.splitPanes.forEach((pane) => pane.updateIndicatorSettings(this.indicatorSettings));
    if (splitTarget && selectedIndicator) {
      splitTarget.activateIndicator(selectedIndicator.scope, selectedIndicator.id);
    }
    this.setIndicatorEditorOpen(false);
  }

  private setPeriodUnitMenuOpen(open: boolean) {
    this.periodUnitMenu.hidden = !open;
    this.periodUnitPicker.classList.toggle("open", open);
    this.host.querySelector<HTMLElement>('[data-market-action="toggle-period-unit"]')
      ?.setAttribute("aria-expanded", String(open));
  }

  private updatePeriodUnitPicker() {
    this.periodUnitLabel.textContent = TRADING_PERIOD_UNIT_LABEL[this.periodUnit];
    this.periodUnitMenu.querySelectorAll<HTMLButtonElement>("[data-market-period-unit]").forEach((button) => {
      const selected = button.dataset.marketPeriodUnit === this.periodUnit;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  }

  private async loadMarkets(options: { complete?: boolean } = {}) {
    try {
      this.markets = await fetchTradingMarkets({ fast: options.complete !== true });
      let migratedFavorites = false;
      const preferredBinanceBySymbol = new Map<string, TradingMarket>();
      this.markets.forEach((market) => {
        const existing = preferredBinanceBySymbol.get(market.symbol);
        if (!existing || market.marketType === "perpetual") {
          preferredBinanceBySymbol.set(market.symbol, market);
        }
      });
      [...this.favoriteSymbols].forEach((favoriteId) => {
        const legacyIdMatch = /^BINANCE:([A-Z0-9]{2,40})$/.exec(favoriteId);
        const legacySymbol = legacyIdMatch?.[1] || (/^[A-Z0-9]{2,40}$/.test(favoriteId) ? favoriteId : "");
        const replacement = preferredBinanceBySymbol.get(legacySymbol);
        if (!replacement || favoriteId === replacement.id) return;
        this.favoriteSymbols.delete(favoriteId);
        this.favoriteSymbols.add(replacement.id);
        this.favoriteMarketRecords.delete(favoriteId);
        this.favoriteMarketRecords.set(replacement.id, tradingFavoriteRecord(replacement));
        migratedFavorites = true;
      });
      const binanceByCryptoPair = new Map<string, TradingMarket>();
      this.markets.forEach((market) => {
        const cryptoPair = tradingMarketCryptoPairKey(market);
        const existing = binanceByCryptoPair.get(cryptoPair);
        if (cryptoPair && (!existing || market.marketType === "perpetual")) {
          binanceByCryptoPair.set(cryptoPair, market);
        }
      });
      [...this.favoriteMarketRecords.values()].forEach((record) => {
        if (record.provider !== "finnhub" || record.assetClass !== "crypto") return;
        const replacement = binanceByCryptoPair.get(tradingMarketCryptoPairKey(record));
        if (!replacement) return;
        this.favoriteSymbols.delete(record.id);
        this.favoriteSymbols.add(replacement.id);
        this.favoriteMarketRecords.delete(record.id);
        this.favoriteMarketRecords.set(replacement.id, tradingFavoriteRecord(replacement));
        this.finnhubFavoriteMarkets.delete(record.id);
        migratedFavorites = true;
      });
      const selected = this.markets.find((market) => market.id === this.selectedMarketId)
        || this.markets.find((market) =>
          market.symbol === this.selectedSymbol
          && market.marketType === this.selectedMarketType
        );
      if (selected && this.selectedProvider === "binance") {
        this.selectedMarketMeta = selected;
        if (this.loadedProvider === "binance") this.loadedMarketMeta = selected;
      }
      if (migratedFavorites) this.saveFavoriteSymbols();
      if (!this.disposed) {
        this.syncSplitPaneMarkets();
        this.renderMarkets();
        this.renderFavoriteTickerBar();
        this.syncFavoriteTickerStreams();
        if (options.complete !== true) {
          window.setTimeout(() => {
            if (!this.disposed) void this.loadMarkets({ complete: true });
          }, 0);
        }
      }
    } catch (error) {
      console.error("加载交易币种失败", error);
    }
  }

  private renderMarkets(options: { resetScroll?: boolean } = {}) {
    const renderGeneration = ++this.marketListRenderGeneration;
    if (this.marketListRenderTimer !== null) {
      window.clearTimeout(this.marketListRenderTimer);
      this.marketListRenderTimer = null;
    }
    const preservedScrollTop = options.resetScroll
      ? 0
      : Math.max(this.marketList.scrollTop, this.marketListScrollTop);
    const query = this.search.value.trim().toUpperCase();
    const favoritesOnly = !query && this.showFavoritesOnly && this.favoriteSymbols.size > 0;
    const favoriteMarkets = resolveTradingFavoriteMarkets(
      [...this.favoriteMarketRecords.values()],
      [
        ...this.markets,
        ...this.favoriteTickerMarketsById.values(),
        ...this.finnhubFavoriteMarkets.values(),
        ...this.ifindFavoriteMarkets.values(),
      ],
    );
    const matchingMarkets = tradingMarketsPreferBinance([
      ...favoriteMarkets,
      ...this.markets,
      ...this.finnhubSearchMarkets,
      ...this.ifindSearchMarkets,
    ])
      .filter((market) => tradingMarketVisibleInPicker(
        market,
        query,
        this.favoriteSymbols,
        favoritesOnly,
      ))
      .filter((market) => tradingMarketCategoryIncludesAssetClass(this.marketCategory, market.assetClass));
    const orderedMarkets = orderTradingMarketPickerResults(matchingMarkets, this.favoriteSymbols);
    // Keep the complete directory in the scrollable picker so pairs that are
    // not among the highest-volume results remain directly selectable.
    const markets = orderedMarkets;
    this.renderedMarkets = new Map(markets.map((market) => [market.id, market]));
    // The picker is frequently refreshed while it is closed (market quotes,
    // favorites, and background catalog updates). Avoid building a large DOM
    // tree that the user cannot see; the next open always renders a fresh list.
    if (this.picker.hidden) return;
    if (!markets.length) {
      const ifindUnavailable = this.marketCategory === "a-share" && !this.ifindConfigured;
      this.marketList.innerHTML = `<p class="trading-market-list-empty">${
        this.finnhubSearchPending || this.ifindSearchPending
          ? "正在搜索行情市场…"
          : ifindUnavailable ? "A股行情服务尚未完成后台配置"
          : favoritesOnly ? "暂无可用的收藏品种" : "未找到匹配品种"
      }</p>`;
      this.marketListScrollTop = 0;
      this.marketList.scrollTop = 0;
      return;
    }
    const renderRow = (market: TradingMarket) => {
      const active = market.id === this.selectedMarketId;
      const favorite = this.isMarketFavorite(market);
      const changeClass = market.changePercent >= 0 ? "positive" : "negative";
      const priceText = market.quoteAvailable ? formatMarketPrice(market.markPrice) : "--";
      const changeText = market.quoteAvailable
        ? `${market.changePercent >= 0 ? "+" : ""}${market.changePercent.toFixed(2)}%`
        : "--";
      const accessibleName = market.description || market.displaySymbol;
      return `
        <div class="trading-market-row${active ? " selected" : ""}" role="listitem">
          <button
            type="button"
            class="trading-market-row-select"
            data-market-action="symbol"
            data-market-id="${escapeAttribute(market.id)}"
            aria-label="切换至 ${escapeAttribute(accessibleName)}"
            aria-current="${active}"
          ></button>
          <span class="trading-market-row-pair">
            ${renderTradingMarketAssetLogo(market.baseAsset, market.provider, false, market.assetClass, market.displaySymbol)}
            <strong title="${escapeAttribute(accessibleName)}">${escapeHtml(market.displaySymbol)}</strong>
            ${market.assetClass === "a-share"
              ? `<small class="trading-market-row-code" title="股票代码">${escapeHtml(market.symbol.split(".", 1)[0])}</small>`
              : ""}
            <span class="trading-market-contract-tag">${escapeHtml(market.tag)}</span>
          </span>
          <span class="trading-market-row-venue" title="${escapeAttribute(market.venue)}">${escapeHtml(market.venue)}</span>
          <b data-market-row-price>${escapeHtml(priceText)}</b>
          <em class="${market.quoteAvailable ? changeClass : ""}" data-market-row-change>${escapeHtml(changeText)}</em>
          <button
            type="button"
            class="trading-market-favorite${favorite ? " active" : ""}"
            data-market-action="favorite"
            data-market-id="${escapeAttribute(market.id)}"
            aria-label="${favorite ? "取消收藏" : "添加收藏"} ${escapeAttribute(accessibleName)}"
            aria-pressed="${favorite}"
            title="${favorite ? "取消收藏" : "添加收藏"}"
          >${renderMarketFavoriteIcon()}</button>
        </div>
      `;
    };
    const chunkSize = 48;
    this.marketList.setAttribute("aria-busy", "true");
    this.marketList.innerHTML = '<p class="trading-market-list-empty">正在加载交易对目录…</p>';
    const appendChunk = (start: number) => {
      if (this.disposed || renderGeneration !== this.marketListRenderGeneration) return;
      this.marketListRenderTimer = null;
      if (start === 0) this.marketList.replaceChildren();
      this.marketList.insertAdjacentHTML(
        "beforeend",
        markets.slice(start, start + chunkSize).map(renderRow).join(""),
      );
      const nextStart = start + chunkSize;
      if (nextStart < markets.length) {
        this.marketListRenderTimer = window.setTimeout(() => appendChunk(nextStart), 0);
        return;
      }
      this.marketList.removeAttribute("aria-busy");
      this.restoreMarketListScroll(preservedScrollTop);
    };
    this.marketListRenderTimer = window.setTimeout(() => appendChunk(0), 0);
  }

  private syncMarketCategoryButtons() {
    this.picker.querySelectorAll<HTMLButtonElement>("[data-market-action=market-category]").forEach((button) => {
      const selected = button.dataset.marketCategory === this.marketCategory;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  }

  private restoreMarketListScroll(scrollTop: number) {
    const target = Math.max(0, scrollTop);
    this.marketListScrollTop = target;
    this.marketList.scrollTop = target;
    if (this.marketListScrollRestoreFrame !== null) {
      window.cancelAnimationFrame(this.marketListScrollRestoreFrame);
    }
    if (this.periodRevealAnimationFrame !== null) {
      window.cancelAnimationFrame(this.periodRevealAnimationFrame);
      this.periodRevealAnimationFrame = null;
    }
    this.marketListScrollRestoreFrame = window.requestAnimationFrame(() => {
      this.marketListScrollRestoreFrame = null;
      if (target > 0 && this.marketList.scrollTop === 0) {
        this.marketList.scrollTop = target;
      }
      this.marketListScrollTop = this.marketList.scrollTop;
    });
  }

  setTrendBandEnabled(enabled: boolean) {
    if (this.trendBandEnabled === enabled) return false;
    this.trendBandEnabled = enabled;
    this.updateChartData({ preserveViewport: true });
    return true;
  }

  restorePreservedViewState() {
    if (!this.picker.hidden) this.restoreMarketListScroll(this.marketListScrollTop);
  }

  syncDrawingStorageSession(
    drawingStorageSessionId: string,
    migrateFromSessionId = "",
  ) {
    const previousStorageSessionId = this.drawingStorageSessionId;
    if (migrateFromSessionId && migrateFromSessionId !== drawingStorageSessionId) {
      tradingAnalysisJobs.migrateStorageSession(migrateFromSessionId, drawingStorageSessionId);
      migrateTradingLastAnalysisContext(
        window.localStorage,
        migrateFromSessionId,
        drawingStorageSessionId,
      );
      migrateTradingLastDrawingWorkspace(
        window.localStorage,
        migrateFromSessionId,
        drawingStorageSessionId,
      );
      migrateTradingAlertSimulationState(
        window.localStorage,
        migrateFromSessionId,
        drawingStorageSessionId,
      );
    }
    this.drawingStorageSessionId = drawingStorageSessionId;
    this.drawingController?.switchStorageSession(drawingStorageSessionId, {
      migrateFromSessionId: migrateFromSessionId || undefined,
    });
    const switchingHistorySession = previousStorageSessionId !== drawingStorageSessionId
      && !migrateFromSessionId;
    if (switchingHistorySession) {
      this.detachAlertSimulation();
      this.loadPersistedAlertSimulation();
      const workspace = loadTradingLastDrawingWorkspace(window.localStorage, drawingStorageSessionId);
      this.splitPaneSelections.clear();
      this.splitPaneIndicatorSelections.clear();
      this.splitLayoutId = workspace?.layoutId || loadTradingSplitLayoutId(window.localStorage);
      if (workspace) this.restoreLastDrawingWorkspace(workspace);
      else this.restoreLastAnalysisSelection();
      this.restoreAlertSimulationSelection();
      this.applySplitLayout();
      this.refreshSplitLayoutPicker();
      void this.restartMarketData({ preserveChart: true });
      return;
    }
    this.splitPanes.forEach((pane, paneOffset) => {
      pane.updateDrawingStorageSession(
        tradingSplitPaneDrawingStorageSessionId(drawingStorageSessionId, paneOffset + 1),
        migrateFromSessionId
          ? tradingSplitPaneDrawingStorageSessionId(migrateFromSessionId, paneOffset + 1)
          : "",
      );
    });
  }

  private restoreLastAnalysisSelection() {
    const context = loadTradingLastAnalysisContext(
      window.localStorage,
      this.drawingStorageSessionId,
    );
    if (!context) return false;
    const market = context.market
      ? marketFromFavoriteRecord(context.market)
      : this.favoriteMarketRecords.has(context.marketId)
        ? marketFromFavoriteRecord(this.favoriteMarketRecords.get(context.marketId) as TradingFavoriteMarketRecord)
        : binanceMarketFromAnalysisContext(context);
    if (!market) return false;
    const missingPeriod = !this.periods.some(
      (period) => tradingViewResolution(period) === context.interval,
    );
    if (missingPeriod) {
      const period = tradingPeriodFromResolution(context.interval);
      if (period && this.periods.length < MAX_TRADING_PERIODS) {
        this.periods = [...this.periods, period];
      }
    }
    this.activeInterval = context.interval;
    this.selectMarket(market);
    this.updateSymbolUi();
    return true;
  }

  private restoreLastDrawingWorkspace(workspace: TradingLastDrawingWorkspace) {
    const primary = workspace.panes.find((pane) => pane.paneIndex === 0);
    if (!primary) return false;
    const ensurePeriod = (interval: string) => {
      if (this.periods.some((period) => tradingViewResolution(period) === interval)) return;
      const period = tradingPeriodFromResolution(interval);
      if (period && this.periods.length < MAX_TRADING_PERIODS) this.periods = [...this.periods, period];
    };
    ensurePeriod(primary.interval);
    this.splitLayoutId = tradingSplitLayout(workspace.layoutId).id;
    this.splitPaneSelections.clear();
    this.splitPaneIndicatorSelections.clear();
    workspace.panes.forEach((pane) => {
      ensurePeriod(pane.interval);
      if (pane.paneIndex === 0) return;
      const market = this.splitPaneMarket(marketFromFavoriteRecord(pane.market));
      this.splitPaneSelections.set(pane.paneIndex, {
        marketId: market.id,
        interval: pane.interval,
        market,
      });
      if (pane.indicators) {
        this.splitPaneIndicatorSelections.set(pane.paneIndex, {
          main: [...pane.indicators.main],
          sub: [...pane.indicators.sub],
        });
      }
    });
    this.activeInterval = primary.interval;
    this.selectMarket(marketFromFavoriteRecord(primary.market));
    this.updateSymbolUi();
    return true;
  }

  private recordLastDrawingWorkspace() {
    const layout = tradingSplitLayout(this.splitLayoutId);
    const primaryMarket = this.selectedMarketMeta
      || this.markets.find((candidate) => candidate.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId)
      || binanceMarketFromAnalysisContext({
        schemaVersion: 1,
        marketId: this.selectedMarketId,
        interval: this.activeInterval,
        updatedAt: Date.now(),
      });
    if (!primaryMarket) return;
    const panes: TradingLastDrawingPaneState[] = [{
      paneIndex: 0,
      market: tradingFavoriteRecord(primaryMarket),
      interval: this.activeInterval,
    }];
    for (let paneIndex = 1; paneIndex < layout.count; paneIndex += 1) {
      const selection = this.splitPaneSelections.get(paneIndex);
      if (!selection) continue;
      panes.push({
        paneIndex,
        market: {
          id: selection.market.id,
          provider: selection.market.provider,
          symbol: selection.market.symbol,
          baseAsset: selection.market.baseAsset,
          quoteAsset: selection.market.quoteAsset,
          displaySymbol: selection.market.displaySymbol,
          description: selection.market.description,
          venue: selection.market.venue,
          assetClass: selection.market.assetClass,
          marketType: selection.market.marketType,
          tag: selection.market.tag,
        },
        interval: selection.interval,
        indicators: this.splitPaneIndicatorSelections.get(paneIndex) ?? { main: [], sub: [] },
      });
    }
    saveTradingLastDrawingWorkspace(
      window.localStorage,
      this.drawingStorageSessionId,
      {
        schemaVersion: 1,
        layoutId: layout.id,
        updatedAt: Date.now(),
        panes,
      },
    );
  }

  private updateSymbolUi() {
    const market = this.selectedMarketMeta
      || this.markets.find((candidate) => candidate.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const baseAsset = market?.baseAsset || baseAssetFromSymbol(this.selectedSymbol);
    const provider = market?.provider || this.selectedProvider;
    const isRemoteMarket = provider !== "binance";
    const displaySymbol = isRemoteMarket ? market?.displaySymbol || baseAsset : baseAsset;
    const symbolElement = this.host.querySelector<HTMLElement>("[data-market-symbol]");
    const quoteElement = this.host.querySelector<HTMLElement>("[data-market-quote]");
    const venueElement = this.host.querySelector<HTMLElement>("[data-market-current-venue]");
    const tagElement = this.host.querySelector<HTMLElement>("[data-market-current-tag]");
    if (symbolElement) symbolElement.textContent = displaySymbol;
    if (quoteElement) quoteElement.textContent = isRemoteMarket ? "" : `/${market?.quoteAsset || MARKET_QUOTE}`;
    if (venueElement) venueElement.textContent = market?.venue || MARKET_VENUE;
    if (tagElement) tagElement.textContent = market?.tag || "永续";
    const logoShell = this.host.querySelector<HTMLElement>(".trading-market-symbol [data-market-logo-shell]");
    if (logoShell) {
      logoShell.outerHTML = renderTradingMarketAssetLogo(
        baseAsset,
        provider,
        true,
        market?.assetClass || this.selectedAssetClass || (provider === "binance" ? "crypto" : undefined),
        displaySymbol,
      );
    }
    this.renderFavoriteTickerBar();
  }

  private async fetchFinnhubSnapshot(
    symbol: string,
    assetClass: TradingAssetClass,
    resolution: string,
    count: number,
  ): Promise<{ stats: TradingMarketStats; candleBatch: TradingCandleBatch }> {
    const api = window.codexDesktop.getFinnhubMarketSnapshot;
    if (!api) throw new Error("当前版本缺少 Finnhub 行情桥。");
    const response = await api({ symbol, assetClass, resolution, count, endTime: Date.now() });
    if (response?.ok !== true) throw new Error(String(response?.message || "Finnhub 行情加载失败"));
    const quote = response.quote || {};
    const candles = this.normalizeRemoteCandles(response.candles);
    if (!candles.length) throw new Error("Finnhub 未返回可用 K 线数据。");
    const markPrice = Number(quote.current || candles.at(-1)?.close || 0);
    const previousClose = Number(quote.previousClose || quote.open || markPrice || 0);
    const targetMs = tradingViewResolutionDurationMs(resolution) || 60_000;
    return {
      stats: {
        symbol,
        markPrice,
        midPrice: markPrice,
        oraclePrice: 0,
        openInterest: 0,
        fundingRate: 0,
        nextFundingTime: 0,
        prevDayPrice: previousClose,
        volume24h: 0,
      },
      candleBatch: {
        candles,
        sourceCandles: [],
        source: { targetMs, sourceInterval: null, sourceMs: null },
      },
    };
  }

  private async fetchIfindSnapshot(
    symbol: string,
    assetClass: TradingAssetClass,
    resolution: string,
    count: number,
  ): Promise<{ stats: TradingMarketStats; candleBatch: TradingCandleBatch }> {
    const api = window.codexDesktop.getIfindMarketSnapshot;
    if (!api) throw new Error("当前版本缺少 iFinD 行情桥。");
    const response = await api({ symbol, assetClass, resolution, count, endTime: Date.now() });
    if (response?.ok !== true) throw new Error(String(response?.message || "A 股行情加载失败"));
    const quote = response.quote || {};
    const candles = this.normalizeRemoteCandles(response.candles);
    if (!candles.length) throw new Error("iFinD 未返回可用 K 线数据。");
    const markPrice = Number(quote.current || candles.at(-1)?.close || 0);
    const previousClose = Number(quote.previousClose || quote.open || markPrice || 0);
    const targetMs = tradingViewResolutionDurationMs(resolution) || 60_000;
    return {
      stats: {
        symbol,
        markPrice,
        midPrice: markPrice,
        oraclePrice: 0,
        openInterest: 0,
        fundingRate: 0,
        nextFundingTime: 0,
        prevDayPrice: previousClose,
        volume24h: Number(quote.volume || 0),
      },
      candleBatch: {
        candles,
        sourceCandles: [],
        source: { targetMs, sourceInterval: null, sourceMs: null },
      },
    };
  }

  private normalizeRemoteCandles(value: unknown): TradingCandle[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Partial<TradingCandle>;
      const time = Number(item.time);
      const open = Number(item.open);
      const high = Number(item.high);
      const low = Number(item.low);
      const close = Number(item.close);
      if (![time, open, high, low, close].every(Number.isFinite) || time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
        return [];
      }
      return [{
        time,
        open,
        high,
        low,
        close,
        volume: Math.max(0, Number(item.volume || 0)),
      }];
    }).sort((first, second) => first.time - second.time);
  }

  private async runSplitPaneAnalyses(options: {
    job: TradingAnalysisJobContext;
    snapshots: readonly TradingSplitPaneAnalysisSnapshot[];
    snapshotFailures: readonly TradingSplitPaneAnalysisFailure[];
    minimumCandles: number;
    analysisLabel: string;
    analysisProgressPhase: string;
    drawingProgressPhase: string;
    drawingsRequested: boolean;
    onProgress?: (phase: any, message: string) => void;
    analyze: (snapshot: TradingSplitPaneAnalysisSnapshot) => Promise<TradingChanAnalysisResponse>;
  }): Promise<TradingSplitPaneAnalysisResult> {
    const snapshots = [...options.snapshots];
    const reports: TradingSplitPaneAnalysisReport[] = [];
    const failures: TradingSplitPaneAnalysisFailure[] = [...options.snapshotFailures];
    if (!snapshots.length) {
      return { completed: 0, failed: failures.length, reports, failures };
    }
    options.onProgress?.(
      options.analysisProgressPhase,
      `首窗已完成，正在为另外 ${snapshots.length} 个提交时可见分屏分别计算${options.analysisLabel}。`,
    );
    let cursor = 0;
    let completed = 0;
    let failed = failures.length;
    const worker = async () => {
      while (cursor < snapshots.length) {
        const snapshot = snapshots[cursor];
        cursor += 1;
        if (!tradingAnalysisJobs.isActive(options.job.analysisId)) return;
        try {
          if (snapshot.candles.length < options.minimumCandles) {
            throw new Error(`仅有 ${snapshot.candles.length} 根 K 线`);
          }
          const response = await options.analyze(snapshot);
          if (!tradingAnalysisJobs.isActive(options.job.analysisId)) return;
          if (
            !response?.ok
            || (!response.analysisPlan?.drawingPatch && !response.analysisPlan?.indicatorDrawingPatch)
          ) {
            throw new Error(response?.error?.message || `${options.analysisLabel}没有返回绘图计划`);
          }
          if (options.drawingsRequested && response.analysisPlan.drawingPatch) {
            options.onProgress?.(
              options.drawingProgressPhase,
              `${tradingAnalysisPaneHeading(snapshot.market, snapshot.interval)} 分析完成，正在逐笔落图。`,
            );
            await commitTradingAnalysisDrawingPatch(
              options.job,
              response.analysisPlan.drawingPatch,
              snapshot.paneIndex,
            );
          }
          if (!tradingAnalysisJobs.isActive(options.job.analysisId)) return;
          reports.push({
            paneIndex: snapshot.paneIndex,
            heading: tradingAnalysisPaneHeading(snapshot.market, snapshot.interval),
            report: String(response.analysisPlan.report || response.analysisPlan.narrative || `${options.analysisLabel}已完成`),
            narrative: String(response.analysisPlan.narrative || response.analysisPlan.report || `${options.analysisLabel}已完成`),
            modelName: response.model?.modelId || response.model?.providerId || "分析模型",
          });
          completed += 1;
        } catch (error) {
          if (!tradingAnalysisJobs.isActive(options.job.analysisId)) return;
          failures.push({
            paneIndex: snapshot.paneIndex,
            heading: tradingAnalysisPaneHeading(snapshot.market, snapshot.interval),
            message: String((error as Error)?.message || error || `${options.analysisLabel}失败`).slice(0, 300),
          });
          failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, snapshots.length) }, () => worker()));
    if (!tradingAnalysisJobs.isActive(options.job.analysisId)) {
      return { completed, failed, reports, failures };
    }
    options.onProgress?.(
      options.drawingsRequested && completed > 0
        ? options.drawingProgressPhase
        : options.analysisProgressPhase,
      failed > 0
        ? `已完成 ${completed} 个辅助分屏，另有 ${failed} 个分屏分析失败；失败原因会写入最终报告。`
        : `另外 ${completed} 个可见分屏已完成独立${options.analysisLabel}${options.drawingsRequested ? "和落图" : ""}。`,
    );
    return { completed, failed, reports, failures };
  }

  private captureSplitPaneAnalysisSnapshots(
    lookbackMs: number | null,
    preferredCandles: number | null = null,
  ) {
    const panes = [...this.splitPanes];
    const snapshotRequests = preferredCandles === null
      ? panes.map((pane) => pane.analysisSnapshot(lookbackMs))
      : panes.map((pane) => pane.analysisSnapshot(lookbackMs, preferredCandles));
    return Promise.allSettled(
      snapshotRequests,
    ).then((results) => {
      const snapshots: TradingSplitPaneAnalysisSnapshot[] = [];
      const snapshotFailures: TradingSplitPaneAnalysisFailure[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          snapshots.push(result.value);
          return;
        }
        const paneIndex = index + 1;
        const selection = this.splitPaneSelections.get(paneIndex);
        snapshotFailures.push({
          paneIndex,
          heading: selection
            ? tradingAnalysisPaneHeading(selection.market, selection.interval)
            : `分屏 ${paneIndex + 1}`,
          message: String(
            (result.reason as Error)?.message || result.reason || "行情快照读取失败",
          ).slice(0, 300),
        });
      });
      return { snapshots, snapshotFailures };
    });
  }

  hasCurrentAnalysis(
    theory?: string,
  ) {
    return this.drawingController?.hasAiAnalysisForCurrentContext(theory) === true;
  }

  personalStrategyCandles() {
    return this.candles.slice(-600).map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));
  }

  /**
   * Normalize the primary chart viewport immediately before an external
   * channel screenshot.  The channel reply should show the same recent-candle
   * framing users get when opening the chart, with automatic price scaling and
   * all persisted AI drawings/overlays repainted after the focus layout resize.
   */
  prepareForExternalCapture() {
    if (this.disposed || !this.chart || !this.chartCandles.length) return false;
    this.applyInitialChartViewport();
    this.updateVisiblePriceScale();
    this.updateCurrentPriceLabel();
    this.positionIndicatorLegends();
    this.renderVolumeProfile(true);
    this.drawingController?.redraw();
    this.splitPanes.forEach((pane) => pane.getDrawingController()?.redraw());
    return true;
  }

  alertContextSnapshot() {
    const market = this.selectedMarketMeta
      || this.markets.find((candidate) => candidate.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    return Object.freeze({
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: tradingAlertIntervalFromResolution(this.activeInterval),
      resolution: this.activeInterval,
      provider: market?.provider || this.selectedProvider,
      venue: market?.venue || MARKET_VENUE,
      marketType: market?.marketType || this.selectedMarketType,
      drawings: this.drawingController?.alertDrawingSnapshots() || [],
    });
  }

  private queueAlertDrawingSync() {
    if (this.alertDrawingSyncTimer !== null) window.clearTimeout(this.alertDrawingSyncTimer);
    this.alertDrawingSyncTimer = window.setTimeout(() => {
      this.alertDrawingSyncTimer = null;
      const context = this.alertContextSnapshot();
      void window.codexDesktop.tradingAlertsSyncDrawings?.({ marketId: context.marketId, interval: context.interval, drawings: context.drawings });
    }, 180);
  }

  async prepareAlertContext(marketId?: string | null, interval?: string | null) {
    if (!this.markets.length) await this.loadMarkets();
    const normalizedMarketId = String(marketId || this.selectedMarketId).trim().toUpperCase();
    const targetMarket = this.markets.find((market) => market.id.toUpperCase() === normalizedMarketId)
      || this.favoriteMarketFromId(normalizedMarketId)
      || this.markets.find((market) => market.symbol.toUpperCase() === normalizedMarketId.replace(/^.*:/, ""));
    if (!targetMarket) throw new Error(`未找到可用的行情：${normalizedMarketId}`);
    const targetInterval = tradingResolutionFromAlertInterval(interval || tradingAlertIntervalFromResolution(this.activeInterval));
    if (!tradingViewResolutionDurationMs(targetInterval)) throw new Error(`暂不支持 ${interval || targetInterval} K 线周期`);
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    if (shouldReload) {
      this.clearAlertSimulation();
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (this.loadedMarketId !== targetMarket.id || this.loadedInterval !== targetInterval || this.candles.length < 2) {
      throw new Error(`${targetMarket.displaySymbol || targetMarket.symbol} ${targetInterval} 行情加载失败`);
    }
    return this.alertContextSnapshot();
  }

  focusAlertEvidence(evidence: any, rule?: any) {
    if (!this.chart || !this.candleSeries || !this.candles.length) throw new Error("触发 K 线尚未加载");
    const evidenceContexts = Array.isArray(evidence?.contexts) ? evidence.contexts : [];
    const matchingContext = evidenceContexts.find((context: any) => (
      String(context?.marketId || "").toUpperCase() === String(this.loadedMarketId || this.selectedMarketId).toUpperCase()
      && tradingResolutionFromAlertInterval(context?.interval) === this.loadedInterval
    )) || evidenceContexts[0] || null;
    const triggeredAt = Number(matchingContext?.eventTime || evidence?.triggeredAt);
    if (!Number.isFinite(triggeredAt) || triggeredAt <= 0) throw new Error("触发时间无效");
    const target = Math.floor(triggeredAt / 1_000);
    const nearest = this.candles.reduce((best, candle) => Math.abs(candle.time - target) < Math.abs(best.time - target) ? candle : best, this.candles[0]);
    const step = Number(tradingViewResolutionDurationMs(this.activeInterval) || 3_600_000) / 1_000;
    const evidenceCandle = matchingContext?.candle;
    const evidenceCandleTime = Math.floor(Number(evidenceCandle?.time) / 1_000);
    const hasEvidenceCandle = Number.isFinite(evidenceCandleTime)
      && evidenceCandleTime > 0
      && [evidenceCandle?.open, evidenceCandle?.high, evidenceCandle?.low, evidenceCandle?.close]
        .every((price) => Number.isFinite(Number(price)) && Number(price) > 0);
    const displayTime = (hasEvidenceCandle ? evidenceCandleTime : nearest.time) + CHINA_TIME_OFFSET_SECONDS;
    this.clearAlertEvidenceCandleSeries();
    if (hasEvidenceCandle) {
      this.alertEvidenceCandleSeries = this.chart.addSeries(CandlestickSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
        upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
        downColor: this.chartSettings.fallingColor,
        borderVisible: this.chartSettings.showCandleBorder,
        borderUpColor: this.chartSettings.risingColor,
        borderDownColor: this.chartSettings.fallingColor,
        wickVisible: this.chartSettings.showWicks,
        wickUpColor: this.chartSettings.risingColor,
        wickDownColor: this.chartSettings.fallingColor,
      });
      this.alertEvidenceCandleSeries.setData([{
        time: displayTime as UTCTimestamp,
        open: Number(evidenceCandle.open),
        high: Number(evidenceCandle.high),
        low: Number(evidenceCandle.low),
        close: Number(evidenceCandle.close),
      }]);
    }
    this.chart.timeScale().setVisibleRange({ from: (displayTime - step * 20) as any, to: (displayTime + step * 8) as any });
    this.alertEvidenceAnnotation ||= this.createAlertSimulationAnnotation("预警已触发", "alert-evidence");
    this.alertEvidencePoint = {
      time: displayTime,
      price: hasEvidenceCandle ? Number(evidenceCandle.high) : nearest.high,
      ...(this.alertEvidenceCandleSeries ? { series: this.alertEvidenceCandleSeries } : {}),
    };
    this.clearAlertEvidenceIndicatorTargets();
    const conditions = new Map<string, any>(tradingAlertSimulationLeafConditions(rule?.root)
      .map((condition: any) => [String(condition?.conditionId || ""), condition]));
    const results = new Map<string, any>((Array.isArray(evidence?.conditionResults) ? evidence.conditionResults : [])
      .filter((result: any) => result?.result === true)
      .map((result: any) => [String(result?.conditionId || ""), result]));
    this.alertSimulationIndicatorRuntimes
      .filter((runtime) => runtime.pane)
      .forEach((runtime) => {
        const conditionId = runtime.spec.conditionIds.find((id) => results.has(String(id)));
        const condition = conditions.get(String(conditionId || ""));
        const result = results.get(String(conditionId || ""));
        if (!condition || !result) return;
        const value = tradingAlertExpressionContainsIndicatorOrVolume(condition.left)
          ? Number(result.currentValues?.left)
          : tradingAlertExpressionContainsIndicatorOrVolume(condition.right)
            ? Number(result.currentValues?.right)
            : Number.NaN;
        if (!Number.isFinite(value)) return;
        let series: any = null;
        try {
          series = runtime.pane.addSeries(LineSeries, {
            color: "rgba(0, 0, 0, 0)",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: "",
          });
          series.setData([{ time: displayTime as UTCTimestamp, value }]);
          this.alertEvidenceIndicatorTargets.push({
            element: this.createAlertSimulationAnnotation(
              `已触发 · ${simulationIndicatorTriggerLabel(condition)}`,
              `alert-evidence:${conditionId}:${runtime.spec.specId}`,
            ),
            pane: runtime.pane,
            series,
            time: displayTime,
            value,
          });
        } catch (error) {
          if (series) {
            try { this.removeAlertSimulationSeries(series); } catch { /* best-effort rollback */ }
          }
          console.error("[trading-alert] evidence indicator marker failed", error);
        }
      });
    window.requestAnimationFrame(() => this.paintAlertSimulationMarker());
    return true;
  }

  async alertSimulationFrames(rule: any) {
    const frames: Record<string, any> = {};
    for (const context of Array.isArray(rule?.contexts) ? rule.contexts : []) {
      const selector = context?.marketSelector || {};
      const marketId = selector.kind === "fixed"
        ? String(selector.marketIds?.[0] || "")
        : selector.kind === "universe"
          ? String(selector.frozenMarketIds?.[0] || this.selectedMarketId)
          : this.selectedMarketId;
      const interval = String(context?.intervals?.[0] || tradingAlertIntervalFromResolution(this.activeInterval)).toLowerCase();
      const resolution = tradingResolutionFromAlertInterval(interval);
      const market = this.markets.find((candidate) => candidate.id.toUpperCase() === marketId.toUpperCase())
        || this.favoriteMarketFromId(marketId)
        || (marketId === this.selectedMarketId ? this.selectedMarketMeta : null);
      if (!market) throw new Error(`模拟所需行情尚未接入：${marketId}`);
      let candles = market.id === this.loadedMarketId && resolution === this.loadedInterval
        ? this.candles.slice(-500)
        : (await this.fetchHistoricalCandleBatch({
            symbol: market.symbol,
            provider: market.provider,
            assetClass: market.assetClass,
            marketType: market.marketType,
            interval: resolution,
            count: 500,
            endTime: Date.now(),
          })).candles;
      const durationMs = tradingViewResolutionDurationMs(resolution) || 60_000;
      frames[String(context.contextId)] = {
        marketId: market.id,
        interval,
        coverage: "available",
        closed: true,
        receivedAt: Date.now(),
        drawings: Object.fromEntries((this.drawingController?.alertDrawingSnapshots() || [])
          .filter((drawing: any) => drawing.marketId === market.id && tradingResolutionFromAlertInterval(drawing.interval) === resolution)
          .map((drawing: any) => [drawing.drawingId, drawing])),
        candles: candles.map((candle) => ({
          time: candle.time * 1_000,
          closeTime: candle.time * 1_000 + durationMs,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: Number(candle.volume || 0),
        })),
      };
    }
    return frames;
  }

  showAlertSimulation(
    simulation: any,
    anchorContextId: string,
    rule?: any,
    options: TradingAlertSimulationShowOptions = {},
  ) {
    if (!this.chart) throw new Error("K 线画布尚未就绪");
    const expectedMarketId = String(simulation?.visualization?.marketId || "").toUpperCase();
    const expectedInterval = String(simulation?.visualization?.interval || "").toLowerCase();
    if (
      (expectedMarketId && expectedMarketId !== String(this.loadedMarketId || "").toUpperCase())
      || (expectedInterval && tradingResolutionFromAlertInterval(expectedInterval) !== this.loadedInterval)
    ) throw new Error("模拟结果与当前 K 线图的交易对或周期不一致，已拒绝显示");
    const generated = Array.isArray(simulation?.generated?.[anchorContextId])
      ? simulation.generated[anchorContextId]
      : [];
    if (!generated.length) throw new Error("模拟结果没有可绘制的 K 线");
    const display = generated.map((candle: any) => ({
      // The primary chart stores market timestamps in UTC seconds and applies
      // the fixed China display offset to every plotted series. Simulation
      // candles use UTC milliseconds, so they must receive the same display
      // transform or they appear eight hours inside the historical range.
      time: (Math.floor(Number(candle.time) / 1_000) + CHINA_TIME_OFFSET_SECONDS) as UTCTimestamp,
      open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close),
      ...(Number.isFinite(Number(candle.volume)) && Number(candle.volume) >= 0
        ? { volume: Number(candle.volume) }
        : {}),
    }));
    const history: TradingAlertSimulationCandle[] = (Array.isArray(simulation?.visualization?.candles)
      ? simulation.visualization.candles
      : []).flatMap((candle: any): TradingAlertSimulationCandle[] => {
      const normalized = {
        time: (Math.floor(Number(candle.time) / 1_000) + CHINA_TIME_OFFSET_SECONDS) as UTCTimestamp,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        ...(Number.isFinite(Number(candle.volume)) && Number(candle.volume) >= 0
          ? { volume: Number(candle.volume) }
          : {}),
      };
      if (
        !Number.isFinite(Number(normalized.time))
        || Number(normalized.time) <= 0
        || Number(normalized.time) >= Number(display[0]?.time || 0)
        || [normalized.open, normalized.high, normalized.low, normalized.close].some((price) => !Number.isFinite(price) || price <= 0)
        || normalized.high < Math.max(normalized.open, normalized.close)
        || normalized.low > Math.min(normalized.open, normalized.close)
      ) return [];
      return [normalized];
    }).slice(-500);
    const latestRealDisplayTime = Number(this.chartCandles.at(-1)?.time || 0) + CHINA_TIME_OFFSET_SECONDS;
    if (options.allowHistorical !== true && Number(display[0]?.time || 0) <= latestRealDisplayTime) {
      throw new Error("模拟 K 线时间锚点已过期，请基于最新行情重新模拟");
    }
    const triggerIndex = Math.max(0, Math.min(display.length - 1, Number(simulation.triggerBarIndex ?? display.length - 1)));
    const triggerTimeValue = Number(simulation?.triggerPoint?.time);
    const triggerTime = Number.isFinite(triggerTimeValue) && triggerTimeValue > 0
      ? triggerTimeValue / 1_000 + CHINA_TIME_OFFSET_SECONDS
      : null;
    const triggerPriceValue = Number(simulation?.triggerPoint?.price);
    const triggerPrice = Number.isFinite(triggerPriceValue) && triggerPriceValue > 0
      ? triggerPriceValue
      : null;
    const generatedStepSeconds = Math.max(
      1,
      Math.floor(Number(generated[0]?.closeTime) / 1_000) - Math.floor(Number(generated[0]?.time) / 1_000),
    );
    const stepSeconds = display.length > 1
      ? Math.max(1, Number(display[1].time) - Number(display[0].time))
      : generatedStepSeconds;
    const normalLogicalRange = this.alertSimulationPreviousLogicalRange
      || this.chart.timeScale().getVisibleLogicalRange();
    this.clearAlertSimulation({ restoreViewport: false });
    this.alertEvidencePoint = null;
    if (this.alertEvidenceAnnotation) this.alertEvidenceAnnotation.hidden = true;
    this.alertSimulationPreviousLogicalRange = normalLogicalRange
      ? { from: Number(normalLogicalRange.from), to: Number(normalLogicalRange.to) }
      : null;
    this.alertSimulationId = String(simulation.simulationId || "simulation");
    const simulationMarket = this.loadedMarketMeta
      || this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.loadedMarketId)
      || this.favoriteMarketFromId(this.loadedMarketId);
    const derivedActiveConditionIds = tradingAlertSimulationActiveConditionIds(rule, simulation?.proof);
    const activeConditionIds = Array.isArray(simulation?.activeConditionIds)
      ? simulation.activeConditionIds.map(String)
      : derivedActiveConditionIds.length ? derivedActiveConditionIds : undefined;
    const indicators = collectTradingAlertSimulationIndicators(rule, anchorContextId, activeConditionIds);
    const conditionAnnotations = collectTradingAlertSimulationConditionAnnotations(rule, simulation, anchorContextId);
    this.alertSimulationState = {
      schemaVersion: 1,
      simulationId: this.alertSimulationId,
      marketId: this.loadedMarketId,
      interval: this.loadedInterval,
      display,
      ...(history.length ? { history } : {}),
      triggerIndex,
      triggerTime,
      triggerPrice,
      stepSeconds,
      updatedAt: Date.now(),
      ...(indicators.length ? { indicators } : {}),
      ...(conditionAnnotations.length ? { conditionAnnotations } : {}),
      ...(simulationMarket ? { market: tradingFavoriteRecord(simulationMarket) } : {}),
    };
    saveTradingAlertSimulationState(
      window.localStorage,
      this.drawingStorageSessionId,
      this.alertSimulationState,
    );
    try {
      this.attachAlertSimulation({
        animate: options.animate ?? true,
        focus: options.focus ?? true,
      });
    } catch (error) {
      // The simulation overlay is transactional: a partially attached series
      // must never replace the real historical candles after a render failure.
      this.clearAlertSimulation();
      throw error;
    }
    return true;
  }

  private alertSimulationMatchesCurrentContext() {
    const state = this.alertSimulationState;
    return Boolean(
      state
      && state.marketId === this.selectedMarketId
      && state.interval === this.activeInterval
      && state.marketId === this.loadedMarketId
      && state.interval === this.loadedInterval
      && this.chartCandles.length,
    );
  }

  private focusAlertSimulationViewport(state: TradingAlertSimulationState) {
    if (!this.chart || !state.display.length) return;
    const lookbackBars = Math.max(36, Math.min(80, state.display.length * 6));
    const longestLabelLength = Math.max(
      "模拟触发".length,
      ...(state.indicators || []).map((indicator) => `模拟触发 · ${indicator.triggerLabel}`.length),
      ...(state.conditionAnnotations || []).map((annotation) => annotation.label.length),
    );
    const mainPaneBounds = this.chart.panes()[0]?.getHTMLElement?.()?.getBoundingClientRect?.();
    const chartWidth = Math.max(1, Number(mainPaneBounds?.width || this.viewport.clientWidth || 1));
    const rightPaddingBars = tradingAlertAnnotationRightPaddingBars(
      chartWidth,
      lookbackBars + Math.max(0, state.display.length - 1),
      longestLabelLength,
    );
    const timeScale = this.chart.timeScale();
    const firstLogical = timeScale.timeToIndex(state.display[0].time, true);
    const lastLogical = timeScale.timeToIndex(state.display.at(-1)?.time as UTCTimestamp, true);
    const before = timeScale.getVisibleLogicalRange();
    if (typeof firstLogical === "number" && typeof lastLogical === "number") {
      const currentRightOffset = Number(timeScale.scrollPosition() || 0);
      // Lightweight-charts keeps its base index anchored to the historical
      // series even when an isolated overlay contributes later timestamps.
      // Account for that index gap explicitly; using only label padding leaves
      // every generated candle after the historical base outside the viewport.
      const baseLogical = before
        ? Number(before.to) - currentRightOffset
        : firstLogical;
      const simulationRightOffset = Math.max(
        rightPaddingBars,
        lastLogical - baseLogical + rightPaddingBars,
      );
      timeScale.applyOptions({ rightBarStaysOnScroll: false });
      timeScale.scrollToPosition(simulationRightOffset, false);
      return;
    }
    timeScale.setVisibleRange({
      from: (Number(state.display[0].time) - state.stepSeconds * lookbackBars) as any,
      to: (Number(state.display.at(-1)?.time) + state.stepSeconds * rightPaddingBars) as any,
    });
  }

  private queueAlertSimulationViewportFocus(
    state: TradingAlertSimulationState,
    series: any,
  ) {
    if (
      !this.chart
      || this.alertSimulationViewportFocusFrame !== null
      || this.alertSimulationViewportFocusRetries >= 12
    ) return;
    this.alertSimulationViewportFocusRetries += 1;
    this.alertSimulationViewportFocusFrame = window.requestAnimationFrame(() => {
      this.alertSimulationViewportFocusFrame = null;
      if (this.alertSimulationSeries !== series || this.alertSimulationState !== state || !this.chart) {
        this.alertSimulationViewportFocusRetries = 0;
        return;
      }
      const geometry = this.alertSimulationPaneGeometry(null);
      const triggerX = state.triggerTime === null
        ? null
        : this.chart.timeScale().timeToCoordinate(state.triggerTime as UTCTimestamp);
      const indicatorPanesReady = this.alertSimulationIndicatorRuntimes.every((runtime) => (
        !runtime.pane || this.alertSimulationPaneGeometry(runtime.pane) !== null
      ));
      if (
        geometry
        && typeof triggerX === "number"
        && Number.isFinite(triggerX)
        && triggerX >= 0
        && triggerX <= geometry.width - 12
        && indicatorPanesReady
      ) {
        this.alertSimulationViewportFocusRetries = 0;
        this.paintAlertSimulationMarker();
        return;
      }
      this.focusAlertSimulationViewport(state);
      this.paintAlertSimulationMarker();
      this.queueAlertSimulationViewportFocus(state, series);
    });
  }

  private attachAlertSimulation(options: { animate?: boolean; focus?: boolean } = {}) {
    const state = this.alertSimulationState;
    if (!this.chart || !state || !this.alertSimulationMatchesCurrentContext()) return false;
    if (this.alertSimulationSeries) return true;
    const simulationColors = isDarkTheme()
      ? { up: "rgba(91, 156, 255, 0.72)", down: "rgba(255, 173, 66, 0.74)", upBorder: "#7eb2ff", downBorder: "#ffc06b" }
      : { up: "rgba(29, 78, 216, 0.62)", down: "rgba(180, 83, 9, 0.66)", upBorder: "#1d4ed8", downBorder: "#b45309" };
    if (state.history?.length) {
      const historySeries = this.chart.addSeries(CandlestickSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
        upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
        downColor: this.chartSettings.fallingColor,
        borderVisible: this.chartSettings.showCandleBorder,
        borderUpColor: this.chartSettings.risingColor,
        borderDownColor: this.chartSettings.fallingColor,
        wickVisible: this.chartSettings.showWicks,
        wickUpColor: this.chartSettings.risingColor,
        wickDownColor: this.chartSettings.fallingColor,
      });
      historySeries.setData(state.history);
      this.alertSimulationHistorySeries = historySeries;
    }
    const series = this.chart.addSeries(CandlestickSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      upColor: simulationColors.up,
      downColor: simulationColors.down,
      borderUpColor: simulationColors.upBorder,
      borderDownColor: simulationColors.downBorder,
      wickUpColor: simulationColors.upBorder,
      wickDownColor: simulationColors.downBorder,
    });
    this.alertSimulationMarkerVisible = false;
    this.alertSimulationMarkerPaintRetries = 0;
    this.alertSimulationViewportFocusRetries = 0;
    this.alertSimulationPointElement.hidden = true;
    this.alertSimulationSeries = series;
    this.attachAlertSimulationConditionAnnotations();
    try {
      this.attachAlertSimulationIndicators();
    } catch (error) {
      // A supplementary indicator pane must never prevent the simulated
      // candles and their trigger annotation from rendering on the main pane.
      console.error("[trading-alert] simulation indicator attach failed", error);
      this.detachAlertSimulationIndicators();
    }
    const stagedDisplay = (visibleCount: number) => state.display.map((candle, index) => (
      index < visibleCount ? candle : { time: candle.time }
    ));
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const animate = options.animate === true && !reducedMotion && state.display.length > 1;
    series.setData(stagedDisplay(animate ? 1 : state.display.length));
    this.updateAlertSimulationIndicatorsSafely(animate ? 1 : state.display.length);
    if (options.focus === true) this.focusAlertSimulationViewport(state);
    const finish = () => {
      if (this.alertSimulationSeries !== series || this.alertSimulationState !== state) return;
      this.alertSimulationMarkerVisible = true;
      // Trailing whitespace is ignored by lightweight-charts, so the initial
      // focus is clamped to the first generated candle during animation. Once
      // every generated candle has real data, re-focus to keep the trigger and
      // its annotation inside the chart instead of just beyond the right edge.
      this.paintAlertSimulationMarker();
      if (options.focus === true) this.queueAlertSimulationViewportFocus(state, series);
      this.queueAlertSimulationMarkerPaint();
    };
    if (!animate) finish();
    else {
      let count = 1;
      const paintNext = () => {
        if (this.alertSimulationSeries !== series || this.alertSimulationState !== state) return;
        count += 1;
        try {
          series.setData(stagedDisplay(count));
        } catch (error) {
          console.error("[trading-alert] simulation animation failed", error);
          this.clearAlertSimulation();
          return;
        }
        this.updateAlertSimulationIndicatorsSafely(count);
        if (count >= state.display.length) { this.alertSimulationTimer = null; finish(); return; }
        this.alertSimulationTimer = window.setTimeout(paintNext, 90);
      };
      this.alertSimulationTimer = window.setTimeout(paintNext, 90);
    }
    return true;
  }

  private alertSimulationCombinedCandles(state: TradingAlertSimulationState) {
    const simulated = state.display.map((candle) => ({
      time: Number(candle.time) - CHINA_TIME_OFFSET_SECONDS,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number(candle.volume || 0),
    }));
    const simulationStart = Number(simulated[0]?.time || Number.POSITIVE_INFINITY);
    const historical = state.history?.length
      ? state.history.map((candle) => ({
          time: Number(candle.time) - CHINA_TIME_OFFSET_SECONDS,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: Number(candle.volume || 0),
        }))
      : this.chartCandles.filter((candle) => candle.time < simulationStart);
    return [
      ...historical,
      ...simulated,
    ];
  }

  private calculateAlertSimulationIndicator(
    spec: TradingAlertSimulationIndicatorSpec,
    candles: TradingCandle[],
    colorOffset: number,
  ): TradingIndicatorResult {
    const palette = alertSimulationIndicatorPalette(isDarkTheme());
    const color = (index = 0) => palette[(colorOffset + index) % palette.length];
    const line = (key: string, label: string, values: number[], index = 0) => ({
      key,
      label,
      color: color(index),
      type: "line" as const,
      values,
      priceFormat: "price" as const,
    });
    const closes = candles.map((candle) => candle.close);
    if (spec.name === "ma") {
      const period = spec.parameters[0];
      return {
        definition: { id: "rsi", label: "MA", name: "MA", parameters: String(period) },
        series: [line(`ma-${period}`, `MA(${period})`, computeSma(closes, period))],
      };
    }
    if (spec.name === "ema") {
      const period = spec.parameters[0];
      return {
        definition: { id: "rsi", label: "EMA", name: "EMA", parameters: String(period) },
        series: [line(`ema-${period}`, `EMA(${period})`, computeEma(closes, period))],
      };
    }
    if (spec.name === "boll") {
      const bands = computeBollingerBands(closes, spec.parameters[0], spec.parameters[1]);
      return {
        definition: { id: "rsi", label: "BOLL", name: "BOLL", parameters: spec.parameters.join(",") },
        series: [
          line("upper", "上轨", bands.upper, 0),
          line("middle", "中轨", bands.middle, 1),
          line("lower", "下轨", bands.lower, 2),
        ],
      };
    }
    const result = calculateTradingIndicator(spec.name as TradingIndicatorId, candles, spec.parameters);
    return {
      ...result,
      series: result.series.map((series, index) => ({
        ...series,
        color: series.type === "histogram" ? series.color : color(index),
      })),
    };
  }

  private attachAlertSimulationIndicators() {
    const state = this.alertSimulationState;
    if (!this.chart || !state?.indicators?.length || this.alertSimulationIndicatorRuntimes.length) return;
    const candles = this.alertSimulationCombinedCandles(state);
    const realCandleCount = Math.max(0, candles.length - state.display.length);
    const historicalDisplayEnd = Number(candles[realCandleCount - 1]?.time || 0) + CHINA_TIME_OFFSET_SECONDS;
    const markerLabels = new Set<string>();
    state.indicators.forEach((spec, specIndex) => {
      const result = this.calculateAlertSimulationIndicator(spec, candles, specIndex * 2);
      const largestPeriod = Math.max(...spec.parameters.filter(Number.isFinite), 20);
      const historyStart = Math.max(0, realCandleCount - Math.min(240, Math.max(48, Math.ceil(largestPeriod * 3))));
      let pane: any | null = null;
      if (spec.placement === "pane") {
        // Keep the pane alive while its series are constructed and removed.
        // With preserveEmptyPane=false lightweight-charts can auto-delete it
        // between lifecycle calls, leaving a stale pane/series handle whose
        // next operation throws the opaque "Value is undefined" error.
        pane = this.chart?.addPane(true) || null;
      }
      const runtime: TradingAlertSimulationIndicatorRuntime = {
        spec,
        pane,
        legend: null,
        series: [],
        historicalDisplayEnd,
      };
      // Register ownership before adding the first series so a partial attach
      // can always be rolled back by detachAlertSimulationIndicators().
      this.alertSimulationIndicatorRuntimes.push(runtime);
      if (pane) {
        pane.setStretchFactor(1);
        this.chart?.panes()[0]?.setStretchFactor(3);
      }
      result.series.forEach((descriptor, seriesIndex) => {
        const commonOptions = {
          priceLineVisible: false,
          lastValueVisible: false,
          title: "",
          priceFormat: descriptor.priceFormat === "volume"
            ? { type: "volume" as const }
            : { type: "price" as const, precision: 2, minMove: 0.01 },
        };
        const api = descriptor.type === "histogram"
          ? (pane || this.chart)?.addSeries(HistogramSeries, {
              ...commonOptions,
              color: descriptor.color,
              base: descriptor.baseValue ?? 0,
            })
          : (pane || this.chart)?.addSeries(LineSeries, {
              ...commonOptions,
              color: descriptor.color,
              lineWidth: spec.placement === "main" ? 2 : 2,
              crosshairMarkerVisible: false,
            });
        if (!api) return;
        const data = descriptor.values.flatMap<Array<Record<string, unknown> & { time: UTCTimestamp; value?: number }>[number]>((value, index) => {
          if (index < historyStart || !Number.isFinite(value) || !candles[index]) return [];
          return [{
            time: (candles[index].time + CHINA_TIME_OFFSET_SECONDS) as UTCTimestamp,
            value,
            ...(descriptor.colors?.[index] ? { color: descriptor.colors[index] } : {}),
          }];
        });
        const triggerSpecs = spec.triggers?.length
          ? spec.triggers
          : [{ label: spec.triggerLabel, conditionIds: spec.conditionIds }];
        const ownedTriggers = seriesIndex === 0
          ? triggerSpecs.filter((trigger) => {
              const key = trigger.conditionIds.length
                ? trigger.conditionIds.slice().sort().join("|")
                : trigger.label;
              if (markerLabels.has(key)) return false;
              markerLabels.add(key);
              return true;
            })
          : [];
        runtime.series.push({
          key: descriptor.key,
          type: descriptor.type,
          api,
          label: descriptor.label,
          color: descriptor.color,
          data,
          annotation: ownedTriggers[0]
            ? this.createAlertSimulationAnnotation(
                `模拟触发 · ${ownedTriggers[0].label}`,
                `${spec.specId}:${ownedTriggers[0].conditionIds.join("+")}`,
              )
            : null,
          additionalAnnotations: ownedTriggers.slice(1).map((trigger) => this.createAlertSimulationAnnotation(
            `模拟触发 · ${trigger.label}`,
            `${spec.specId}:${trigger.conditionIds.join("+")}`,
          )),
          latestValue: Number.NaN,
        });
      });
      if (!runtime.series.length) {
        throw new Error(`模拟指标 ${spec.label} 没有可绘制序列`);
      }
      runtime.series[0]?.api?.priceScale()?.applyOptions({
        autoScale: true,
        borderColor: marketTheme(isDarkTheme()).border,
        textColor: marketTheme(isDarkTheme()).text,
        ...(spec.placement === "pane" ? { scaleMargins: { top: 0.22, bottom: 0.12 } } : {}),
      });
      if (pane) {
        result.referenceLines?.forEach((reference) => runtime.series[0]?.api?.createPriceLine({
          price: reference.value,
          color: reference.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "",
        }));
        runtime.legend = this.createAlertSimulationIndicatorLegend(runtime);
      }
    });
    if (this.alertSimulationIndicatorRuntimes.some((runtime) => runtime.pane)) {
      // addPane() updates the model before lightweight-charts creates the pane
      // widget. Force one synchronized layout now so paneSize/DOM geometry and
      // the first indicator annotation cannot observe a zero-sized ghost pane.
      this.chart.resize(
        Math.max(this.chartElement.clientWidth, 1),
        Math.max(this.chartElement.clientHeight, 1),
        true,
      );
    }
    this.positionIndicatorLegends();
    this.renderAlertSimulationMainIndicatorLegends();
  }

  private createAlertSimulationAnnotation(label: string, id: string) {
    const annotation = document.createElement("div");
    annotation.className = "trading-alert-simulation-point";
    annotation.dataset.alertSimulationAnnotation = id;
    annotation.hidden = true;
    annotation.setAttribute("aria-label", label);
    const text = document.createElement("span");
    text.textContent = label;
    annotation.append(text);
    this.alertSimulationAnnotationLayer.append(annotation);
    return annotation;
  }

  private attachAlertSimulationConditionAnnotations() {
    const specs = this.alertSimulationState?.conditionAnnotations || [];
    if (this.alertSimulationConditionAnnotations.size || !specs.length) return;
    specs.forEach((spec) => {
      this.alertSimulationConditionAnnotations.set(
        spec.annotationId,
        this.createAlertSimulationAnnotation(spec.label, spec.annotationId),
      );
    });
  }

  private detachAlertSimulationConditionAnnotations() {
    this.alertSimulationConditionAnnotations.forEach((element) => element.remove());
    this.alertSimulationConditionAnnotations.clear();
  }

  private createAlertSimulationIndicatorLegend(runtime: TradingAlertSimulationIndicatorRuntime) {
    const legend = document.createElement("div");
    legend.className = "trading-market-indicator-legend is-alert-simulation";
    legend.dataset.alertSimulationIndicator = runtime.spec.specId;
    const title = document.createElement("strong");
    title.textContent = `${runtime.spec.label} (${runtime.spec.parameters.join(",")}) · 模拟`;
    legend.append(title);
    runtime.series.forEach((series) => {
      const value = document.createElement("span");
      value.dataset.indicatorSeries = series.key;
      value.style.setProperty("--indicator-series-color", series.color);
      value.textContent = `${series.label}: --`;
      legend.append(value);
    });
    this.indicatorLegendLayer.append(legend);
    return legend;
  }

  private renderAlertSimulationMainIndicatorLegends() {
    this.mainIndicatorLegendElement.querySelectorAll("[data-alert-simulation-indicator]").forEach((element) => element.remove());
    const mainRuntimes = this.alertSimulationIndicatorRuntimes.filter((runtime) => runtime.spec.placement === "main");
    const groups = new Map<string, TradingAlertSimulationIndicatorRuntime[]>();
    mainRuntimes.forEach((runtime) => groups.set(runtime.spec.label, [...(groups.get(runtime.spec.label) || []), runtime]));
    groups.forEach((runtimes, label) => {
      const row = document.createElement("div");
      row.className = "trading-market-main-indicator-legend is-alert-simulation";
      row.dataset.alertSimulationIndicator = label;
      const title = document.createElement("strong");
      title.textContent = `${label} · 模拟`;
      row.append(title);
      runtimes.flatMap((runtime) => runtime.series).forEach((series) => {
        const value = document.createElement("span");
        value.style.setProperty("--main-indicator-series-color", series.color);
        value.textContent = `${series.label}:${Number.isFinite(series.latestValue) ? formatOhlcPrice(series.latestValue) : "--"}`;
        row.append(value);
      });
      this.mainIndicatorLegendElement.append(row);
    });
  }

  private setAlertSimulationIndicatorVisibleCount(visibleCount: number) {
    const state = this.alertSimulationState;
    if (!state) return;
    const boundedCount = Math.max(0, Math.min(state.display.length, Math.trunc(visibleCount)));
    const futureDisplayEnd = Number(state.display[Math.max(0, boundedCount - 1)]?.time || 0);
    this.alertSimulationIndicatorRuntimes.forEach((runtime) => {
      runtime.series.forEach((series, seriesIndex) => {
        const visibleData = series.data.filter((entry) => (
          Number(entry.time) <= runtime.historicalDisplayEnd
          || (boundedCount > 0 && Number(entry.time) <= futureDisplayEnd)
        ));
        series.api.setData(visibleData);
        const latest = visibleData.at(-1)?.value;
        series.latestValue = Number.isFinite(Number(latest)) ? Number(latest) : Number.NaN;
        const legendValue = runtime.legend?.querySelectorAll<HTMLElement>("span")[seriesIndex];
        if (legendValue) legendValue.textContent = `${series.label}: ${Number.isFinite(series.latestValue)
          ? this.formatIndicatorValue(series.latestValue, runtime.spec.name as TradingIndicatorId)
          : "--"}`;
      });
      runtime.series[0]?.api?.priceScale()?.setAutoScale(true);
    });
    this.renderAlertSimulationMainIndicatorLegends();
    this.paintAlertSimulationMarker();
  }

  private updateAlertSimulationIndicatorsSafely(visibleCount: number) {
    if (!this.alertSimulationIndicatorRuntimes.length) return;
    try {
      this.setAlertSimulationIndicatorVisibleCount(visibleCount);
    } catch (error) {
      console.error("[trading-alert] simulation indicator update failed", error);
      this.detachAlertSimulationIndicators();
    }
  }

  private detachAlertSimulationIndicators() {
    this.clearAlertEvidenceIndicatorTargets();
    if (!this.alertSimulationIndicatorRuntimes.length) return;
    const runtimes = this.alertSimulationIndicatorRuntimes.splice(0);
    const panes = [...new Set(runtimes.flatMap((runtime) => runtime.pane ? [runtime.pane] : []))];
    runtimes.forEach((runtime) => {
      runtime.series.forEach((series) => {
        series.annotation?.remove();
        series.additionalAnnotations.forEach((annotation) => annotation.remove());
        if (this.chart) {
          try {
            this.removeAlertSimulationSeries(series.api);
          } catch (error) {
            console.error("[trading-alert] simulation indicator series cleanup failed", error);
          }
        }
      });
      runtime.legend?.remove();
    });
    // Resolve each live index only after its series have been removed. The
    // preserved panes remain stable, and descending order avoids index shifts.
    panes
      .map((pane) => ({ pane, index: this.chart?.panes().indexOf(pane) ?? -1 }))
      .filter(({ index }) => index > 0)
      .sort((first, second) => second.index - first.index)
      .forEach(({ pane }) => this.removeAlertSimulationPane(pane));
    this.mainIndicatorLegendElement.querySelectorAll("[data-alert-simulation-indicator]").forEach((element) => element.remove());
    const hasVisibleIndicators = this.activeIndicators.some((id) => {
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("sub", id)];
      return Object.values(setting.series).some((series) => series.visible);
    });
    this.chart?.panes()[0]?.setStretchFactor(hasVisibleIndicators ? 3 : 1);
    this.positionIndicatorLegends();
  }

  private clearAlertEvidenceIndicatorTargets() {
    const targets = this.alertEvidenceIndicatorTargets.splice(0);
    targets.forEach((target) => {
      target.element.remove();
      if (!this.chart || !target.series) return;
      try {
        this.removeAlertSimulationSeries(target.series);
      } catch (error) {
        console.error("[trading-alert] evidence indicator cleanup failed", error);
      }
    });
  }

  private clearAlertEvidenceCandleSeries() {
    if (this.chart && this.alertEvidenceCandleSeries) {
      try {
        this.removeAlertSimulationSeries(this.alertEvidenceCandleSeries);
      } catch (error) {
        console.error("[trading-alert] evidence candle cleanup failed", error);
      }
    }
    this.alertEvidenceCandleSeries = null;
  }

  private removeAlertSimulationPane(pane: any) {
    if (!this.chart || !pane) return;
    const paneIndex = this.chart.panes().indexOf(pane);
    if (paneIndex <= 0) return;
    try {
      this.chart.removePane(paneIndex);
    } catch (error) {
      // Pane cleanup is best-effort during chart reload. It must not tear down
      // the real candlestick series or suppress the main simulation marker.
      console.error("[trading-alert] simulation indicator pane cleanup failed", error);
    }
  }

  private applyAlertSimulationIndicatorTheme() {
    const palette = alertSimulationIndicatorPalette(isDarkTheme());
    const theme = marketTheme(isDarkTheme());
    let lineIndex = 0;
    this.alertSimulationIndicatorRuntimes.forEach((runtime) => {
      runtime.series.forEach((series, seriesIndex) => {
        if (series.type === "line") {
          const color = palette[lineIndex % palette.length];
          lineIndex += 1;
          series.color = color;
          series.api.applyOptions({ color });
          runtime.legend?.querySelectorAll<HTMLElement>("span")[seriesIndex]
            ?.style.setProperty("--indicator-series-color", color);
        }
      });
      runtime.series[0]?.api?.priceScale()?.applyOptions({
        borderColor: theme.border,
        textColor: theme.text,
      });
    });
    this.renderAlertSimulationMainIndicatorLegends();
    this.paintAlertSimulationMarker();
  }

  private hideAlertSimulationAnnotations() {
    this.alertSimulationPointElement.hidden = true;
    if (this.alertEvidenceAnnotation) this.alertEvidenceAnnotation.hidden = true;
    this.alertEvidenceIndicatorTargets.forEach((target) => { target.element.hidden = true; });
    this.alertSimulationIndicatorRuntimes.forEach((runtime) => {
      runtime.series.forEach((series) => {
        if (series.annotation) series.annotation.hidden = true;
        series.additionalAnnotations.forEach((annotation) => { annotation.hidden = true; });
      });
    });
    this.alertSimulationConditionAnnotations.forEach((annotation) => { annotation.hidden = true; });
  }

  private alertSimulationPaneGeometry(pane: any | null) {
    if (!this.chart) return null;
    const panes = this.chart.panes();
    const resolvedPane = pane || panes[0];
    const paneIndex = panes.indexOf(resolvedPane);
    if (!resolvedPane || paneIndex < 0) return null;
    const viewportBounds = this.viewport.getBoundingClientRect();
    const paneBounds = resolvedPane.getHTMLElement?.()?.getBoundingClientRect?.();
    const paneLeft = paneBounds ? paneBounds.left - viewportBounds.left : 0;
    const paneTop = paneBounds ? paneBounds.top - viewportBounds.top : 0;
    // During addPane/removePane and setVisibleRange, lightweight-charts can
    // expose a model pane one frame before its pane widget exists. paneSize()
    // throws "Value is undefined" in that transient state, even though the
    // main series and simulation data are valid. Prefer the mounted DOM pane
    // and only use paneSize as a guarded fallback.
    let paneWidth = Number(paneBounds?.width || 0);
    if (paneWidth <= 0) {
      try {
        paneWidth = Number(this.chart.paneSize(paneIndex)?.width || 0);
      } catch {
        paneWidth = pane ? 0 : this.viewport.clientWidth;
      }
    }
    let paneHeight = Number(paneBounds?.height || 0);
    if (paneHeight <= 0) {
      try {
        paneHeight = Number(resolvedPane.getHeight?.() || 0);
      } catch {
        paneHeight = pane ? 0 : this.viewport.clientHeight;
      }
    }
    const width = Math.min(
      paneWidth,
      Math.max(0, this.viewport.clientWidth - paneLeft),
    );
    const height = Math.min(
      paneHeight,
      Math.max(0, this.viewport.clientHeight - paneTop),
    );
    if (width <= 0 || height <= 0) return null;
    return {
      pane: resolvedPane,
      paneIndex,
      left: paneLeft,
      top: paneTop,
      right: paneLeft + width,
      bottom: paneTop + height,
      width,
      height,
    };
  }

  private alertSimulationPaneDataTop(
    pane: any | null,
    geometry: NonNullable<ReturnType<TradingExpertMarketWorkspace["alertSimulationPaneGeometry"]>>,
  ) {
    const state = this.alertSimulationState;
    if (!this.chart) return geometry.bottom;
    let dataTop = Number.POSITIVE_INFINITY;
    const include = (time: number, value: number, series: any) => {
      if (!Number.isFinite(time) || !Number.isFinite(value)) return;
      const x = this.chart?.timeScale().timeToCoordinate(time as UTCTimestamp);
      const paneX = typeof x === "number" ? geometry.left + x : Number.NaN;
      if (!Number.isFinite(paneX) || paneX < geometry.left || paneX > geometry.right) return;
      const y = series?.priceToCoordinate?.(value);
      if (typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > geometry.height) return;
      dataTop = Math.min(dataTop, geometry.top + y);
    };
    if (!pane) {
      this.chartCandles.forEach((candle) => {
        const time = candle.time + CHINA_TIME_OFFSET_SECONDS;
        include(time, candle.high, this.candleSeries);
        include(time, candle.low, this.candleSeries);
      });
      state?.display.forEach((candle) => {
        include(Number(candle.time), candle.high, this.alertSimulationSeries);
        include(Number(candle.time), candle.low, this.alertSimulationSeries);
      });
    }
    this.alertSimulationIndicatorRuntimes
      .filter((runtime) => runtime.pane === pane)
      .forEach((runtime) => runtime.series.forEach((series) => {
        series.data.forEach((entry) => include(Number(entry.time), Number(entry.value), series.api));
      }));
    return Number.isFinite(dataTop) ? dataTop : geometry.bottom;
  }

  private alertSimulationDataRightX(geometry: NonNullable<ReturnType<TradingExpertMarketWorkspace["alertSimulationPaneGeometry"]>>) {
    if (!this.chart) return geometry.right;
    const times = [
      ...this.chartCandles.map((candle) => candle.time + CHINA_TIME_OFFSET_SECONDS),
      ...(this.alertSimulationMarkerVisible ? this.alertSimulationState?.display.map((candle) => Number(candle.time)) || [] : []),
    ];
    const coordinates = times.flatMap((time) => {
      const coordinate = this.chart?.timeScale().timeToCoordinate(time as UTCTimestamp);
      const paneX = typeof coordinate === "number" ? geometry.left + coordinate : Number.NaN;
      return Number.isFinite(paneX) && paneX >= geometry.left && paneX <= geometry.right
        ? [paneX]
        : [];
    });
    return coordinates.length ? Math.max(...coordinates) : geometry.right;
  }

  private queueAlertSimulationMarkerPaint() {
    if (
      this.disposed
      || !this.chart
      || this.alertSimulationMarkerPaintFrame !== null
      || this.alertSimulationMarkerPaintRetries >= 4
    ) return;
    this.alertSimulationMarkerPaintRetries += 1;
    this.alertSimulationMarkerPaintFrame = window.requestAnimationFrame(() => {
      this.alertSimulationMarkerPaintFrame = null;
      this.paintAlertSimulationMarker();
    });
  }

  private paintAlertSimulationMarker() {
    try {
      this.paintAlertSimulationMarkerNow();
      this.alertSimulationMarkerPaintRetries = 0;
    } catch (error) {
      // Annotation measurement is cosmetic and may race the chart library's
      // internal pane-widget commit. It must never abort simulation display.
      console.error("[trading-alert] simulation annotation paint failed", error);
      this.hideAlertSimulationAnnotations();
      this.queueAlertSimulationMarkerPaint();
    }
  }

  private paintAlertSimulationMarkerNow() {
    const state = this.alertSimulationState;
    const markerColor = marketTheme(isDarkTheme()).alertMarker;
    if (!this.chart) {
      this.hideAlertSimulationAnnotations();
      return;
    }
    const hasEvidenceTarget = Boolean(this.alertEvidencePoint && this.alertEvidenceAnnotation);
    const hasEvidenceIndicatorTarget = this.alertEvidenceIndicatorTargets.length > 0;
    const hasSimulationTarget = Boolean(
      this.alertSimulationMarkerVisible
      && this.alertSimulationSeries
      && state
      && !state.conditionAnnotations?.length
      && state.triggerTime !== null
      && state.triggerPrice !== null,
    );
    const hasConditionTarget = Boolean(
      this.alertSimulationMarkerVisible
      && this.alertSimulationSeries
      && state?.conditionAnnotations?.length
      && this.alertSimulationConditionAnnotations.size,
    );
    const hasIndicatorTarget = this.alertSimulationMarkerVisible
      && this.alertSimulationIndicatorRuntimes.some((runtime) => runtime.series.some((series) => (
        series.annotation || series.additionalAnnotations.length
      )));
    if (!hasEvidenceTarget && !hasEvidenceIndicatorTarget && !hasSimulationTarget && !hasConditionTarget && !hasIndicatorTarget) {
      this.hideAlertSimulationAnnotations();
      return;
    }

    const targets: Array<{
      element: HTMLElement;
      pane: any | null;
      x: number;
      y: number;
    }> = [];
    const mainGeometry = this.alertSimulationPaneGeometry(null);
    if (mainGeometry && this.alertEvidencePoint && this.alertEvidenceAnnotation) {
      const x = this.chart.timeScale().timeToCoordinate(this.alertEvidencePoint.time as UTCTimestamp);
      const y = (this.alertEvidencePoint.series || this.candleSeries)?.priceToCoordinate?.(this.alertEvidencePoint.price);
      if (
        typeof x === "number" && Number.isFinite(x)
        && typeof y === "number" && Number.isFinite(y)
        && x >= 0 && x <= mainGeometry.width
        && y >= 0 && y <= mainGeometry.height
      ) {
        targets.push({
          element: this.alertEvidenceAnnotation,
          pane: null,
          x: mainGeometry.left + x,
          y: mainGeometry.top + y,
        });
      }
    }
    this.alertEvidenceIndicatorTargets.forEach((target) => {
      const geometry = this.alertSimulationPaneGeometry(target.pane);
      if (!geometry) return;
      const x = this.chart?.timeScale().timeToCoordinate(target.time as UTCTimestamp);
      const y = target.series?.priceToCoordinate?.(target.value);
      if (
        typeof x === "number" && Number.isFinite(x)
        && typeof y === "number" && Number.isFinite(y)
        && x >= 0 && x <= geometry.width
        && y >= 0 && y <= geometry.height
      ) {
        targets.push({
          element: target.element,
          pane: target.pane,
          x: geometry.left + x,
          y: geometry.top + y,
        });
      }
    });
    if (
      mainGeometry
      && this.alertSimulationMarkerVisible
      && this.alertSimulationSeries
      && state
      && !state.conditionAnnotations?.length
      && state.triggerTime !== null
      && state.triggerPrice !== null
    ) {
      const x = this.chart.timeScale().timeToCoordinate(state.triggerTime as UTCTimestamp);
      const y = this.alertSimulationSeries.priceToCoordinate(state.triggerPrice);
      const anchoredX = typeof x === "number" && Number.isFinite(x)
        ? Math.max(12, Math.min(mainGeometry.width - 12, x))
        : null;
      if (
        typeof anchoredX === "number" && Number.isFinite(anchoredX)
        && typeof y === "number" && Number.isFinite(y)
        && y >= 0 && y <= mainGeometry.height
      ) {
        targets.push({
          element: this.alertSimulationPointElement,
          pane: null,
          x: mainGeometry.left + anchoredX,
          y: mainGeometry.top + y,
        });
      }
      if (
        typeof x !== "number"
        || !Number.isFinite(x)
        || x < 0
        || x > mainGeometry.width
      ) {
        // A live-data refresh or pane rebuild can restore the historical
        // viewport after the simulation has already focused successfully.
        // Re-assert the isolated overlay range whenever its real trigger
        // coordinate falls outside the pane.
        this.queueAlertSimulationViewportFocus(state, this.alertSimulationSeries);
      }
    }

    if (mainGeometry && this.alertSimulationMarkerVisible && this.alertSimulationSeries && state?.conditionAnnotations?.length) {
      state.conditionAnnotations.forEach((spec) => {
        const element = this.alertSimulationConditionAnnotations.get(spec.annotationId);
        if (!element) return;
        const x = this.chart?.timeScale().timeToCoordinate(spec.time as UTCTimestamp);
        const y = this.alertSimulationSeries?.priceToCoordinate(spec.price);
        const anchoredX = typeof x === "number" && Number.isFinite(x)
          ? Math.max(12, Math.min(mainGeometry.width - 12, x))
          : null;
        if (
          typeof anchoredX === "number" && Number.isFinite(anchoredX)
          && typeof y === "number" && Number.isFinite(y)
          && y >= 0 && y <= mainGeometry.height
        ) {
          targets.push({
            element,
            pane: null,
            x: mainGeometry.left + anchoredX,
            y: mainGeometry.top + y,
          });
        }
        if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > mainGeometry.width) {
          this.queueAlertSimulationViewportFocus(state, this.alertSimulationSeries);
        }
      });
    }

    const triggerTime = this.alertSimulationMarkerVisible
      ? state?.display[state.triggerIndex]?.time
      : null;
    this.alertSimulationIndicatorRuntimes.forEach((runtime) => {
      const geometry = this.alertSimulationPaneGeometry(runtime.pane);
      if (!triggerTime) return;
      if (!geometry) {
        if (state && this.alertSimulationSeries) {
          this.queueAlertSimulationViewportFocus(state, this.alertSimulationSeries);
        }
        return;
      }
      runtime.series.forEach((series) => {
        const annotations = [series.annotation, ...series.additionalAnnotations].filter(Boolean) as HTMLElement[];
        if (!annotations.length) return;
        const triggerValue = series.data.find((entry) => Number(entry.time) === Number(triggerTime))?.value;
        const x = this.chart?.timeScale().timeToCoordinate(triggerTime);
        const y = Number.isFinite(Number(triggerValue))
          ? series.api.priceToCoordinate(Number(triggerValue))
          : null;
        const anchoredX = typeof x === "number" && Number.isFinite(x)
          ? Math.max(12, Math.min(geometry.width - 12, x))
          : null;
        if (
          typeof anchoredX === "number" && Number.isFinite(anchoredX)
          && typeof y === "number" && Number.isFinite(y)
          && y >= 0 && y <= geometry.height
        ) {
          annotations.forEach((element) => targets.push({
            element,
            pane: runtime.pane,
            x: geometry.left + anchoredX,
            y: geometry.top + y,
          }));
        }
      });
    });

    const visibleElements = new Set(targets.map((target) => target.element));
    this.alertSimulationAnnotationLayer.querySelectorAll<HTMLElement>(".trading-alert-simulation-point").forEach((element) => {
      element.hidden = !visibleElements.has(element);
      if (!element.hidden) element.style.visibility = "hidden";
    });

    const occupiedByPane = new Map<any, TradingAlertAnnotationRect[]>();
    const dataTopByPane = new Map<any, number>();
    targets.forEach((target) => {
      const geometry = this.alertSimulationPaneGeometry(target.pane);
      const text = target.element.firstElementChild as HTMLElement | null;
      if (!geometry || !text) {
        target.element.hidden = true;
        return;
      }
      text.style.maxWidth = `${Math.max(96, Math.min(230, geometry.width * 0.34))}px`;
      const labelBounds = text.getBoundingClientRect();
      const labelWidth = Math.max(1, Math.ceil(labelBounds.width));
      const labelHeight = Math.max(1, Math.ceil(labelBounds.height));
      const paneKey = geometry.pane;
      const occupied = occupiedByPane.get(paneKey) || [];
      const dataTop = dataTopByPane.get(paneKey)
        ?? this.alertSimulationPaneDataTop(target.pane, geometry);
      dataTopByPane.set(paneKey, dataTop);
      const position = resolveTradingAlertAnnotationPlacement({
        anchorX: target.x,
        anchorY: target.y,
        labelWidth,
        labelHeight,
        paneLeft: geometry.left,
        paneTop: geometry.top,
        paneRight: geometry.right,
        paneBottom: geometry.bottom,
        dataRightX: this.alertSimulationDataRightX(geometry),
        dataTopY: dataTop,
        occupied,
      });
      occupied.push(position);
      occupiedByPane.set(paneKey, occupied);
      const lineX = position.lineEndX - target.x;
      const lineY = position.lineEndY - target.y;
      target.element.style.left = `${target.x}px`;
      target.element.style.top = `${target.y}px`;
      target.element.style.color = markerColor;
      target.element.style.setProperty("--alert-annotation-line-length", `${Math.hypot(lineX, lineY)}px`);
      target.element.style.setProperty("--alert-annotation-line-angle", `${Math.atan2(lineY, lineX)}rad`);
      target.element.dataset.placement = position.mode;
      text.style.left = `${position.left - target.x}px`;
      text.style.top = `${position.top - target.y}px`;
      target.element.style.visibility = "visible";
    });
  }

  private detachAlertSimulation() {
    if (this.alertSimulationTimer !== null) window.clearTimeout(this.alertSimulationTimer);
    this.alertSimulationTimer = null;
    if (this.alertSimulationMarkerPaintFrame !== null) {
      window.cancelAnimationFrame(this.alertSimulationMarkerPaintFrame);
      this.alertSimulationMarkerPaintFrame = null;
    }
    if (this.alertSimulationViewportFocusFrame !== null) {
      window.cancelAnimationFrame(this.alertSimulationViewportFocusFrame);
      this.alertSimulationViewportFocusFrame = null;
    }
    this.alertSimulationMarkerPaintRetries = 0;
    this.alertSimulationViewportFocusRetries = 0;
    this.chart?.timeScale().applyOptions({
      rightBarStaysOnScroll: this.chartSettings.scaleAnchor === "cursor",
    });
    this.clearAlertEvidenceCandleSeries();
    this.alertEvidencePoint = null;
    if (this.alertEvidenceAnnotation) this.alertEvidenceAnnotation.hidden = true;
    this.detachAlertSimulationIndicators();
    this.detachAlertSimulationConditionAnnotations();
    if (this.chart && this.alertSimulationSeries) this.removeAlertSimulationSeries(this.alertSimulationSeries);
    if (this.chart && this.alertSimulationHistorySeries) this.removeAlertSimulationSeries(this.alertSimulationHistorySeries);
    this.alertSimulationSeries = null;
    this.alertSimulationHistorySeries = null;
    this.alertSimulationMarkerVisible = false;
    this.alertSimulationPointElement.hidden = true;
  }

  private removeAlertSimulationSeries(series: any) {
    if (!this.chart || !series) return;
    try {
      this.chart.removeSeries(series);
    } catch (error) {
      // A chart reload can detach an overlay before the alert cleanup path runs.
      // lightweight-charts reports that harmless lifecycle race as the opaque
      // "Value is undefined". Treat only that already-detached case as removed.
      if (!/^Value is (?:undefined|null)$/i.test(String((error as Error)?.message || error))) throw error;
      console.warn("[trading-alert] skipped an already-detached simulation series");
    }
  }

  private syncAlertSimulationForCurrentContext() {
    if (!this.alertSimulationState) return;
    if (!this.alertSimulationMatchesCurrentContext()) {
      this.detachAlertSimulation();
      return;
    }
    this.attachAlertSimulation({ focus: true });
  }

  private loadPersistedAlertSimulation() {
    this.alertSimulationPreviousLogicalRange = null;
    this.alertSimulationState = loadTradingAlertSimulationState(
      window.localStorage,
      this.drawingStorageSessionId,
    );
    this.alertSimulationId = this.alertSimulationState?.simulationId || "";
  }

  private restoreAlertSimulationSelection() {
    const state = this.alertSimulationState;
    if (!state) return false;
    const market = state.market
      ? marketFromFavoriteRecord(state.market)
      : this.favoriteMarketRecords.has(state.marketId)
        ? marketFromFavoriteRecord(this.favoriteMarketRecords.get(state.marketId) as TradingFavoriteMarketRecord)
        : binanceMarketFromAnalysisContext({
            schemaVersion: 1,
            marketId: state.marketId,
            interval: state.interval,
            updatedAt: state.updatedAt,
          });
    if (!market) return false;
    if (!this.periods.some((period) => tradingViewResolution(period) === state.interval)) {
      const period = tradingPeriodFromResolution(state.interval);
      if (period && this.periods.length < MAX_TRADING_PERIODS) this.periods = [...this.periods, period];
    }
    this.activeInterval = state.interval;
    this.selectMarket(market);
    this.updateSymbolUi();
    return true;
  }

  clearAlertSimulation(options: { restoreViewport?: boolean } = {}) {
    const previousLogicalRange = this.alertSimulationPreviousLogicalRange;
    this.detachAlertSimulation();
    this.alertSimulationId = "";
    this.alertSimulationState = null;
    this.alertSimulationPreviousLogicalRange = null;
    clearTradingAlertSimulationState(window.localStorage, this.drawingStorageSessionId);
    if (options.restoreViewport === false || !this.chart || !this.chartCandles.length) return;
    if (previousLogicalRange) {
      this.chart.timeScale().setVisibleLogicalRange(previousLogicalRange);
      this.updateVisiblePriceScale();
      this.updateCurrentPriceLabel();
      this.drawingController?.redraw();
      return;
    }
    // Persisted overlays from older builds do not have a saved pre-simulation
    // range. Reset them to the standard recent-candle viewport.
    this.applyInitialChartViewport();
  }

  drawingStorageSessionMatches(storageSessionId: string) {
    return this.drawingStorageSessionId === storageSessionId;
  }

  drawingStorageSession() {
    return this.drawingStorageSessionId;
  }

  analysisDrawingTargetMatches(patch: TradingAiDrawingPatch, paneIndex = 0) {
    if (this.disposed) return false;
    if (paneIndex > 0) {
      return this.splitPanes[paneIndex - 1]?.analysisContextMatches(
        patch.marketId,
        patch.interval,
      ) === true;
    }
    return this.selectedMarketId === patch.marketId && this.activeInterval === patch.interval;
  }

  async acceptAnalysisDrawingPatch(
    patch: TradingAiDrawingPatch,
    paneIndex = 0,
    onPhase?: (phase: TradingAiPlaybackPhase) => void,
  ) {
    if (this.disposed) return false;
    if (paneIndex > 0) {
      const pane = this.splitPanes[paneIndex - 1];
      const controller = pane?.getDrawingController();
      if (!pane || !controller) return false;
      if (pane.analysisContextMatches(patch.marketId, patch.interval)) {
        await pane.playAiDrawingPatch(patch, { onPhase });
      } else {
        controller.storeAiDrawingPatch(patch);
      }
      return true;
    }
    if (!this.drawingController) return false;
    if (this.selectedMarketId === patch.marketId && this.activeInterval === patch.interval) {
      await this.drawingController.playAiDrawingPatch(patch, {
        onPhase,
        beforePlayback: () => this.focusAnalysisDrawingPatch(patch),
      });
    } else {
      this.drawingController.storeAiDrawingPatch(patch);
    }
    return true;
  }

  storeAnalysisDrawingPatch(patch: TradingAiDrawingPatch, paneIndex = 0) {
    if (this.disposed) return false;
    if (paneIndex > 0) {
      const controller = this.splitPanes[paneIndex - 1]?.getDrawingController();
      if (!controller) return false;
      controller.storeAiDrawingPatch(patch);
      return true;
    }
    if (!this.drawingController) return false;
    this.drawingController.storeAiDrawingPatch(patch);
    return true;
  }

  clearCurrentStrategyAnalysisDrawings(strategyId: string) {
    if (this.disposed || !this.drawingController) return false;
    return this.drawingController.clearAiAnalysisForCurrentContext(strategyId);
  }

  async runGeneralConversation(
    request: TradingGeneralConversationRequest,
    strategyId?: string,
  ): Promise<TradingGeneralConversationResult> {
    const analysisTheory = strategyId || "price-action";
    const analysisName = String(request.strategyDisplayName || (strategyId ? "策略" : "价格结构")).trim();
    const visibleCandlesOnly = request.visibleCandlesOnly === true;
    const minimumFloor = visibleCandlesOnly ? 8 : 30;
    const minimumCandles = Math.max(minimumFloor, Math.min(600, Math.floor(Number(request.minimumCandles) || minimumFloor)));
    const preferredCandles = Math.max(
      minimumCandles,
      Math.min(600, Math.floor(Number(request.preferredCandles) || Math.max(100, minimumCandles))),
    );
    const api: ((params: any) => Promise<any>) | undefined = strategyId
      ? typeof window.codexDesktop.runTradingStrategyAnalysis === "function"
        ? (params: Record<string, unknown>) => window.codexDesktop.runTradingStrategyAnalysis!({
          ...(params as Parameters<NonNullable<typeof window.codexDesktop.runTradingStrategyAnalysis>>[0]),
          strategyId,
        })
        : undefined
      : window.codexDesktop.runTradingGeneralAnalysis;
    if (typeof api !== "function") throw new Error("当前版本暂不支持通用盘面分析");
    if (!this.markets.length) await this.loadMarkets();
    const normalizedSymbol = String(request.symbol || this.selectedSymbol).trim().toUpperCase();
    const currentMarket = this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const targetMarket = request.symbol
      ? this.markets.find((market) => market.symbol === normalizedSymbol && market.provider === currentMarket?.provider)
        || this.markets.find((market) => market.symbol === normalizedSymbol)
      : currentMarket;
    if (!targetMarket) throw new Error(`未找到可用的 ${normalizedSymbol} 行情`);
    const targetInterval = String(request.interval || this.activeInterval).trim().toUpperCase();
    if (!tradingViewResolutionDurationMs(targetInterval)) {
      throw new Error(`暂不支持 ${targetInterval} K 线周期`);
    }

    const marketLabel = targetMarket.displaySymbol || `${targetMarket.baseAsset}/${targetMarket.quoteAsset}`;
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    request.onProgress?.("loading", shouldReload
      ? `正在将左侧行情切换到 ${marketLabel}，加载 ${tradingPeriodLabelForResolution(targetInterval)} K 线。`
      : `正在优先读取左侧当前画布的 ${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} K 线。`);
    if (shouldReload) {
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (
      this.disposed
      || this.loadedMarketId !== targetMarket.id
      || this.loadedInterval !== targetInterval
      || this.candles.length < 2
    ) {
      throw new Error(`${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} 行情加载失败`);
    }

    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const requestedLookbackMs = Number(request.lookbackMs) > 0 ? Number(request.lookbackMs) : null;
    const visibleRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const canvasCandles = visibleCandlesInLogicalRange(this.candles, visibleRange);
    const analysisWindowCount = Math.min(600, Math.max(canvasCandles.length, preferredCandles));
    let analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles.slice(-(visibleCandlesOnly ? 600 : analysisWindowCount))
        : this.candles.slice(-analysisWindowCount);
    const job = tradingAnalysisJobs.start({
      analysisId: request.analysisId,
      theory: analysisTheory,
      storageSessionId: this.drawingStorageSessionId,
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: this.activeInterval,
      market: tradingFavoriteRecord(targetMarket),
    });
    try {
      let analysisCandlePool = [...this.candles];
      const desiredCandleCount = Math.max(
        minimumCandles,
        Math.min(TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES, preferredCandles),
      );
      const focusAnalysisCandles = (candles: ReadonlyArray<TradingCandle>) => {
        if (
          this.disposed
          || this.loadedMarketId !== job.marketId
          || this.loadedInterval !== job.interval
          || !candles.length
        ) return;
        const first = candles[0];
        const last = candles[candles.length - 1];
        this.chart?.timeScale().setVisibleRange({
          from: first.time as UTCTimestamp,
          to: last.time as UTCTimestamp,
        });
      };
      const expansion = await runTradingAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => analysisCandlePool,
        insufficientDataCode: TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE,
        analyze: async (candles) => {
          focusAnalysisCandles(candles);
          return candles.length >= desiredCandleCount
            ? { ok: true }
            : {
                ok: false,
                error: {
                  code: TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE,
                  message: `当前分析窗口仅有 ${candles.length} 根 K 线`,
                },
              };
        },
        loadMoreHistory: async () => {
          const oldestTime = Number(analysisCandlePool[0]?.time || 0) * 1_000;
          if (!oldestTime) return;
          const history = await this.fetchHistoricalCandleBatch({
            symbol: targetMarket.symbol,
            provider: targetMarket.provider,
            assetClass: targetMarket.assetClass,
            marketType: targetMarket.marketType,
            interval: targetInterval,
            count: TRADING_CANDLE_WINDOW_HISTORY_BATCH_CANDLES,
            endTime: oldestTime - 1,
          });
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("盘面分析已由用户停止");
          }
          analysisCandlePool = mergeCandles(history.candles, analysisCandlePool);
          if (
            !this.disposed
            && this.loadedMarketId === job.marketId
            && this.loadedInterval === job.interval
          ) {
            this.sourceCandles = mergeCandles(history.sourceCandles, this.sourceCandles);
            this.candles = mergeCandles(history.candles, this.candles);
            this.updateChartData();
          }
        },
        onExpansion: (event) => {
          if (event.type === "history") {
            request.onProgress?.(
              "loading",
              `当前仅有 ${event.candleCount} 根 K 线，正在自动加载更早历史，最多扩展到 ${event.maxCandleCount} 根。`,
            );
            return;
          }
          request.onProgress?.(
            "analyzing",
            `当前 ${event.fromCount} 根 K 线不足，正在自动扩大画布到 ${event.toCount} 根再计算${analysisName}。`,
          );
        },
        maxCandleCount: TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES,
      });
      analysisCandles = expansion.candles;
      if (analysisCandles.length < minimumCandles) {
        throw new Error(`${request.lookbackLabel || "当前可用数据窗口"}仅有 ${analysisCandles.length} 根 K 线，${analysisName}至少需要 ${minimumCandles} 根`);
      }
      focusAnalysisCandles(analysisCandles);
      const splitSnapshotsPromise = this.captureSplitPaneAnalysisSnapshots(
        requestedLookbackMs,
        preferredCandles,
      );
      const contextCandlesPromise = request.contextCandlesRequested === true
        ? fetchTradingMarketStructureContexts(targetMarket.symbol, targetInterval)
        : Promise.resolve([] as TradingMarketStructureContext[]);
      const comparisonMarketsPromise = request.comparisonCandlesRequested === true
        ? fetchTradingSmtComparisonMarkets(targetMarket, targetInterval, preferredCandles, Date.now())
        : Promise.resolve([] as TradingSmtComparisonMarket[]);
      const rangeDescription = request.lookbackLabel
        ? `以最近 ${request.lookbackLabel} 为起点自动扩展后的 ${analysisCandles.length} 根`
        : `自动扩展后的 ${analysisCandles.length} 根`;
      request.onProgress?.(
        "analyzing",
        `已读取左侧 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在计算${analysisName}规则、候选结构和条件价位。`,
      );
      const response = await api({
        analysisJobId: job.analysisId,
        marketId: job.marketId,
        interval: job.interval,
        snapshotTime: Date.now(),
        instruction: request.instruction,
        responseMode: request.drawingRequested === false ? "direct" : "full",
        lookbackMs: requestedLookbackMs,
        ...(request.contextCandlesRequested === true ? { contextCandles: await contextCandlesPromise } : {}),
        ...(request.comparisonCandlesRequested === true ? { comparisonMarkets: await comparisonMarketsPromise } : {}),
        candles: analysisCandles.map((candle) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
      }) as TradingGeneralAnalysisResponse;
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("盘面分析已由用户停止");
      }
      if (
        !response?.ok
        || (!response.analysisPlan?.drawingPatch && !response.analysisPlan?.indicatorDrawingPatch)
      ) {
        const error = new Error(response?.error?.message || "盘面分析没有返回可绘制计划");
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "drawing",
          `${modelName} 已完成${analysisName}复核，正在左侧图表逐项绘制形态、确认、失效和目标价位。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("drawing", `${modelName} 正在拟人化逐笔落图。`);
          }
        };
        if (response.analysisPlan.drawingPatch) {
          await commitTradingAnalysisDrawingPatch(job, response.analysisPlan.drawingPatch, 0, onPhase);
        } else if (response.analysisPlan.indicatorDrawingPatch) {
          this.clearCurrentStrategyAnalysisDrawings(analysisTheory);
        }
        if (response.analysisPlan.indicatorDrawingPatch) {
          await commitTradingIndicatorAnalysisDrawingPatch(job, response.analysisPlan.indicatorDrawingPatch);
        }
      }
      const splitResult = await this.runSplitPaneAnalyses({
        job,
        ...(await splitSnapshotsPromise),
        minimumCandles,
        analysisLabel: `${analysisName}分析`,
        analysisProgressPhase: "analyzing",
        drawingProgressPhase: "drawing",
        drawingsRequested: request.drawingRequested !== false,
        onProgress: request.onProgress,
        analyze: async (snapshot) => {
          const contextCandles = request.contextCandlesRequested === true
            ? await fetchTradingMarketStructureContexts(snapshot.market.symbol, snapshot.interval)
            : [];
          const comparisonMarkets = request.comparisonCandlesRequested === true
            ? await fetchTradingSmtComparisonMarkets(snapshot.market, snapshot.interval, preferredCandles, Date.now())
            : [];
          return api({
            analysisJobId: `${job.analysisId}:pane:${snapshot.paneIndex}`,
            marketId: snapshot.market.id,
            interval: snapshot.interval,
            snapshotTime: Date.now(),
            instruction: request.instruction,
            responseMode: request.drawingRequested === false ? "direct" : "full",
            lookbackMs: requestedLookbackMs,
            ...(request.contextCandlesRequested === true ? { contextCandles } : {}),
            ...(request.comparisonCandlesRequested === true ? { comparisonMarkets } : {}),
            candles: snapshot.candles.map((candle) => ({
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
          }) as Promise<TradingGeneralAnalysisResponse>;
        },
      });
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("盘面分析已由用户停止");
      }
      if (request.drawingRequested !== false) rememberTradingAnalysisJobContext(job);
      request.onProgress?.("complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成复核，正在直接回答本次问题；左侧原画线保持不变。`
        : request.executionPlanRequested === false
          ? `${modelName} 已完成${analysisName}绘图，正在整理支撑、阻力与成交量分布信息。`
          : `${modelName} 已完成${analysisName}绘图，正在整理可执行的条件式方案。`);
      const primaryReport = String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "盘面分析已完成");
      const primaryNarrative = String(response.analysisPlan.narrative || "盘面分析已完成");
      const result: TradingGeneralConversationResult = {
        report: combineTradingAnalysisReports(
          tradingAnalysisPaneHeading(targetMarket, job.interval),
          primaryReport,
          splitResult,
        ),
        narrative: combineTradingAnalysisNarratives(
          tradingAnalysisPaneHeading(targetMarket, job.interval),
          primaryNarrative,
          splitResult,
        ),
        marketId: job.marketId,
        symbol: job.symbol,
        interval: job.interval,
        candleCount: analysisCandles.length,
        modelName,
      };
      tradingAnalysisJobs.complete(job.analysisId);
      return result;
    } catch (error) {
      tradingAnalysisJobs.fail(job.analysisId, error);
      throw error;
    }
  }

  async runChanConversation(
    request: TradingChanConversationRequest,
  ): Promise<TradingChanConversationResult> {
    const api = window.codexDesktop.runTradingChanTest;
    if (typeof api !== "function") throw new Error("当前版本暂不支持缠论盘面分析");
    if (!this.markets.length) await this.loadMarkets();
    const normalizedSymbol = String(request.symbol || this.selectedSymbol).trim().toUpperCase();
    const currentMarket = this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const targetMarket = request.symbol
      ? this.markets.find((market) => (
          market.provider === "binance"
          && market.symbol === normalizedSymbol
          && market.marketType === "perpetual"
        )) || this.markets.find((market) => market.provider === "binance" && market.symbol === normalizedSymbol)
      : currentMarket;
    if (!targetMarket) throw new Error(`未找到可用的 ${normalizedSymbol} 行情`);
    const targetInterval = String(request.interval || this.activeInterval).trim().toUpperCase();
    if (!tradingViewResolutionDurationMs(targetInterval)) {
      throw new Error(`暂不支持 ${targetInterval} K 线周期`);
    }

    const marketLabel = targetMarket.displaySymbol || `${targetMarket.baseAsset}/${targetMarket.quoteAsset}`;
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    request.onProgress?.("loading", shouldReload
      ? `正在将左侧行情切换到 ${marketLabel}，加载 ${tradingPeriodLabelForResolution(targetInterval)} K 线。`
      : `正在读取左侧当前画布的 ${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} K 线。`);
    if (shouldReload) {
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (
      this.disposed
      || this.loadedMarketId !== targetMarket.id
      || this.loadedInterval !== targetInterval
      || this.candles.length < 2
    ) {
      throw new Error(`${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} 行情加载失败`);
    }

    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const requestedLookbackMs = Number(request.lookbackMs) > 0 ? Number(request.lookbackMs) : null;
    const visibleRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const canvasCandles = visibleCandlesInLogicalRange(this.candles, visibleRange);
    let analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    const job = tradingAnalysisJobs.start({
      analysisId: request.analysisId,
      theory: "chan",
      storageSessionId: this.drawingStorageSessionId,
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: this.activeInterval,
      market: tradingFavoriteRecord(targetMarket),
    });
    const splitSnapshotsPromise = this.captureSplitPaneAnalysisSnapshots(
      requestedLookbackMs,
      TRADING_CHAN_AUTO_EXPANSION_MAX_CANDLES,
    );
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在识别包含关系、分型、笔和中枢。`,
    );
    try {
      const initialAnalysisCandleCount = analysisCandles.length;
      let chanCandlePool = [...this.candles];
      let chanSourceCandlePool: TradingCandle[] = [];
      let expandCanvasBeforeAnalysis = false;
      const focusChanAnalysisCandles = (candles: ReadonlyArray<TradingCandle>) => {
        if (
          !expandCanvasBeforeAnalysis
          || this.disposed
          || this.loadedMarketId !== job.marketId
          || this.loadedInterval !== job.interval
        ) return;
        const first = candles[0];
        const last = candles.at(-1);
        if (!first || !last) return;
        this.chart?.timeScale().setVisibleRange({
          from: first.time as UTCTimestamp,
          to: last.time as UTCTimestamp,
        });
      };
      const expansion = await runTradingAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => chanCandlePool,
        insufficientDataCode: TRADING_CHAN_INSUFFICIENT_DATA_CODE,
        analyze: async (candles) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("缠论分析已由用户停止");
          }
          focusChanAnalysisCandles(candles);
          if (candles.length < 30) {
            return {
              ok: false,
              error: {
                code: TRADING_CHAN_INSUFFICIENT_DATA_CODE,
                message: `当前范围仅有 ${candles.length} 根 K 线`,
              },
            } as TradingChanAnalysisResponse;
          }
          return api({
            analysisJobId: job.analysisId,
            marketId: job.marketId,
            interval: job.interval,
            snapshotTime: Date.now(),
            instruction: request.instruction,
            responseMode: request.drawingRequested === false ? "direct" : "full",
            lookbackMs: requestedLookbackMs,
            candles: candles.map((candle) => ({
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
          }) as Promise<TradingChanAnalysisResponse>;
        },
        loadMoreHistory: async () => {
          const oldestTime = Number(chanCandlePool[0]?.time || 0) * 1_000;
          if (!oldestTime) return;
          let history: TradingCandleBatch;
          try {
            history = await this.fetchHistoricalCandleBatch({
              symbol: targetMarket.symbol,
              provider: targetMarket.provider,
              assetClass: targetMarket.assetClass,
              marketType: targetMarket.marketType,
              interval: targetInterval,
              count: TRADING_CHAN_HISTORY_BATCH_CANDLES,
              endTime: oldestTime - 1,
            });
          } catch (error) {
            throw new Error(`自动扩大缠论分析范围时加载历史 K 线失败：${String((error as Error)?.message || error)}`);
          }
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("缠论分析已由用户停止");
          }
          chanCandlePool = mergeCandles(history.candles, chanCandlePool);
          chanSourceCandlePool = mergeCandles(history.sourceCandles, chanSourceCandlePool);
          if (
            !this.disposed
            && this.loadedMarketId === job.marketId
            && this.loadedInterval === job.interval
          ) {
            this.sourceCandles = mergeCandles(chanSourceCandlePool, this.sourceCandles);
            this.candles = mergeCandles(chanCandlePool, this.candles);
            this.updateChartData();
          }
        },
        onExpansion: (event: TradingAnalysisExpansionEvent) => {
          if (event.type === "history") {
            request.onProgress?.(
              "loading",
              `已检查 ${event.candleCount} 根 K 线仍未形成缠论笔结构，正在自动加载更早历史，最多检查 ${event.maxCandleCount} 根。`,
            );
            return;
          }
          expandCanvasBeforeAnalysis = true;
          request.onProgress?.(
            "analyzing",
            `当前 ${event.fromCount} 根 K 线不足，正在自动扩大画布到 ${event.toCount} 根并继续缠论分析。`,
          );
        },
        maxCandleCount: TRADING_CHAN_AUTO_EXPANSION_MAX_CANDLES,
      });
      const response = expansion.response;
      analysisCandles = expansion.candles;
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const responseMessage = response?.error?.message || "缠论分析没有返回可绘制计划";
        const error = new Error(expansion.exhausted && response?.error?.code === TRADING_CHAN_INSUFFICIENT_DATA_CODE
          ? `已自动扩大画布并检查 ${analysisCandles.length} 根 K 线，仍未形成可复核的缠论笔结构：${responseMessage}`
          : responseMessage);
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      if (analysisCandles.length > initialAnalysisCandleCount) {
        focusChanAnalysisCandles(analysisCandles);
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "drawing",
          `${modelName} 已完成结构复核，正在左侧图表逐笔绘制已通过校验的缠论结构。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("drawing", `${modelName} 正在逐笔绘制分型、笔与中枢。`);
          }
        };
        await commitTradingAnalysisDrawingPatch(job, response.analysisPlan.drawingPatch, 0, onPhase);
      }
      const splitResult = await this.runSplitPaneAnalyses({
        job,
        ...(await splitSnapshotsPromise),
        minimumCandles: 30,
        analysisLabel: "缠论结构",
        analysisProgressPhase: "analyzing",
        drawingProgressPhase: "drawing",
        drawingsRequested: request.drawingRequested !== false,
        onProgress: request.onProgress,
        analyze: async (snapshot) => api({
          analysisJobId: `${job.analysisId}:pane:${snapshot.paneIndex}`,
          marketId: snapshot.market.id,
          interval: snapshot.interval,
          snapshotTime: Date.now(),
          instruction: request.instruction,
          responseMode: request.drawingRequested === false ? "direct" : "full",
          lookbackMs: requestedLookbackMs,
          candles: snapshot.candles.map((candle) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
        }) as Promise<TradingChanAnalysisResponse>,
      });
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("缠论分析已由用户停止");
      }
      if (request.drawingRequested !== false) rememberTradingAnalysisJobContext(job);
      request.onProgress?.("complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成缠论复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成缠论绘图，正在整理完整分析报告。`);
      const primaryReport = String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "缠论分析已完成");
      const primaryNarrative = String(response.analysisPlan.narrative || "缠论分析已完成");
      const primaryHeading = tradingAnalysisPaneHeading(targetMarket, job.interval);
      const result: TradingChanConversationResult = {
        report: combineTradingAnalysisReports(primaryHeading, primaryReport, splitResult),
        narrative: combineTradingAnalysisNarratives(primaryHeading, primaryNarrative, splitResult),
        marketId: job.marketId,
        symbol: job.symbol,
        interval: job.interval,
        candleCount: analysisCandles.length,
        modelName,
      };
      tradingAnalysisJobs.complete(job.analysisId);
      return result;
    } catch (error) {
      tradingAnalysisJobs.fail(job.analysisId, error);
      throw error;
    }
  }

  async runWaveConversation(
    request: TradingWaveConversationRequest,
  ): Promise<TradingWaveConversationResult> {
    const api = window.codexDesktop.runTradingWaveAnalysis;
    if (typeof api !== "function") throw new Error("当前版本暂不支持波浪理论盘面分析");
    if (!this.markets.length) await this.loadMarkets();
    const normalizedSymbol = String(request.symbol || this.selectedSymbol).trim().toUpperCase();
    const currentMarket = this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const targetMarket = request.symbol
      ? this.markets.find((market) => (
          market.provider === "binance"
          && market.symbol === normalizedSymbol
          && market.marketType === "perpetual"
        )) || this.markets.find((market) => market.provider === "binance" && market.symbol === normalizedSymbol)
      : currentMarket;
    if (!targetMarket) throw new Error(`未找到可用的 ${normalizedSymbol} 行情`);
    const targetInterval = String(request.interval || this.activeInterval).trim().toUpperCase();
    if (!tradingViewResolutionDurationMs(targetInterval)) {
      throw new Error(`暂不支持 ${targetInterval} K 线周期`);
    }

    const marketLabel = targetMarket.displaySymbol || `${targetMarket.baseAsset}/${targetMarket.quoteAsset}`;
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    request.onProgress?.("loading", shouldReload
      ? `正在将左侧行情切换到 ${marketLabel}，加载 ${tradingPeriodLabelForResolution(targetInterval)} K 线。`
      : `正在读取左侧当前画布的 ${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} K 线。`);
    if (shouldReload) {
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (
      this.disposed
      || this.loadedMarketId !== targetMarket.id
      || this.loadedInterval !== targetInterval
      || this.candles.length < 2
    ) {
      throw new Error(`${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} 行情加载失败`);
    }

    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const requestedLookbackMs = Number(request.lookbackMs) > 0 ? Number(request.lookbackMs) : null;
    const visibleRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const canvasCandles = visibleCandlesInLogicalRange(this.candles, visibleRange);
    let analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    const job = tradingAnalysisJobs.start({
      analysisId: request.analysisId,
      theory: "wave",
      storageSessionId: this.drawingStorageSessionId,
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: this.activeInterval,
      market: tradingFavoriteRecord(targetMarket),
    });
    const splitSnapshotsPromise = this.captureSplitPaneAnalysisSnapshots(
      requestedLookbackMs,
      TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES,
    );
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "wave-analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在按价格硬规则与低一级结构验证 0-1-2-3-4-5、A-B-C / W-X-Y 候选。`,
    );
    try {
      let waveCandlePool = [...this.candles];
      let waveSourceCandlePool: TradingCandle[] = [];
      const focusWaveAnalysisCandles = (candles: ReadonlyArray<TradingCandle>) => {
        if (
          this.disposed
          || this.loadedMarketId !== job.marketId
          || this.loadedInterval !== job.interval
          || !candles.length
        ) return;
        const first = candles[0];
        const last = candles[candles.length - 1];
        this.chart?.timeScale().setVisibleRange({
          from: first.time as UTCTimestamp,
          to: last.time as UTCTimestamp,
        });
      };
      const expansion = await runTradingWaveAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => waveCandlePool,
        analyze: async (candles) => {
          focusWaveAnalysisCandles(candles);
          if (candles.length < 30) {
            return {
              ok: false,
              error: {
                code: "TRADING_WAVE_INSUFFICIENT_DATA",
                message: `当前范围仅有 ${candles.length} 根 K 线`,
              },
            } as TradingWaveAnalysisResponse;
          }
          const response = await api({
            analysisJobId: job.analysisId,
            marketId: job.marketId,
            interval: job.interval,
            snapshotTime: Date.now(),
            instruction: request.instruction,
            responseMode: request.drawingRequested === false ? "direct" : "full",
            lookbackMs: requestedLookbackMs,
            candles: candles.map((candle) => ({
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
          }) as TradingWaveAnalysisResponse;
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("波浪理论分析已由用户停止");
          }
          return response;
        },
        loadMoreHistory: async () => {
          const oldestTime = Number(waveCandlePool[0]?.time || 0) * 1_000;
          if (!oldestTime) return;
          let history: TradingCandleBatch;
          try {
            history = await this.fetchHistoricalCandleBatch({
              symbol: targetMarket.symbol,
              provider: targetMarket.provider,
              assetClass: targetMarket.assetClass,
              marketType: targetMarket.marketType,
              interval: targetInterval,
              count: TRADING_WAVE_HISTORY_BATCH_CANDLES,
              endTime: oldestTime - 1,
            });
          } catch (error) {
            throw new Error(`自动扩大波浪分析范围时加载历史 K 线失败：${String((error as Error)?.message || error)}`);
          }
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("波浪理论分析已由用户停止");
          }
          waveCandlePool = mergeCandles(history.candles, waveCandlePool);
          waveSourceCandlePool = mergeCandles(history.sourceCandles, waveSourceCandlePool);
          if (
            !this.disposed
            && this.loadedMarketId === job.marketId
            && this.loadedInterval === job.interval
          ) {
            this.sourceCandles = mergeCandles(history.sourceCandles, this.sourceCandles);
            this.candles = mergeCandles(history.candles, this.candles);
            this.updateChartData();
          }
        },
        onExpansion: (event: TradingWaveExpansionEvent) => {
          if (event.type === "history") {
            request.onProgress?.(
              "loading",
              `已检查 ${event.candleCount} 根 K 线仍无合格浪型，正在自动加载更早历史，最多检查 ${event.maxCandleCount} 根。`,
            );
            return;
          }
          request.onProgress?.(
            "wave-analyzing",
            `当前 ${event.fromCount} 根 K 线未形成合格浪型，正在自动扩大到 ${event.toCount} 根继续验证。`,
          );
        },
        maxCandleCount: TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES,
      });
      const response = expansion.response;
      analysisCandles = expansion.candles;
      focusWaveAnalysisCandles(analysisCandles);
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const responseMessage = response?.error?.message || "波浪理论分析没有返回可绘制计划";
        const error = new Error(expansion.exhausted && response?.error?.code === "TRADING_WAVE_INSUFFICIENT_DATA"
          ? `已自动扩大到 ${analysisCandles.length} 根 K 线，仍未形成可复核浪型：${responseMessage}`
          : responseMessage);
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      if (
        !this.disposed
        && this.loadedMarketId === job.marketId
        && this.loadedInterval === job.interval
        && waveCandlePool.length > this.candles.length
      ) {
        this.sourceCandles = mergeCandles(waveSourceCandlePool, this.sourceCandles);
        this.candles = mergeCandles(waveCandlePool, this.candles);
        this.updateChartData();
        focusWaveAnalysisCandles(analysisCandles);
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "wave-drawing",
          `${modelName} 已完成严格波浪规则复核，正在左侧图表绘制已验证主计数与关键确认/失效区域。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("wave-drawing", `${modelName} 正在逐笔绘制简短浪标、主路径和关键价位。`);
          }
        };
        await commitTradingAnalysisDrawingPatch(job, response.analysisPlan.drawingPatch, 0, onPhase);
      }
      const splitResult = await this.runSplitPaneAnalyses({
        job,
        ...(await splitSnapshotsPromise),
        minimumCandles: 30,
        analysisLabel: "波浪结构",
        analysisProgressPhase: "wave-analyzing",
        drawingProgressPhase: "wave-drawing",
        drawingsRequested: request.drawingRequested !== false,
        onProgress: request.onProgress,
        analyze: async (snapshot) => api({
          analysisJobId: `${job.analysisId}:pane:${snapshot.paneIndex}`,
          marketId: snapshot.market.id,
          interval: snapshot.interval,
          snapshotTime: Date.now(),
          instruction: request.instruction,
          responseMode: request.drawingRequested === false ? "direct" : "full",
          lookbackMs: requestedLookbackMs,
          candles: snapshot.candles.map((candle) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
        }) as Promise<TradingWaveAnalysisResponse>,
      });
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("波浪理论分析已由用户停止");
      }
      if (request.drawingRequested !== false) rememberTradingAnalysisJobContext(job);
      request.onProgress?.("wave-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成波浪复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成精简波浪绘图，正在整理新手可读的多空触发价与风险条件。`);
      const primaryReport = String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "波浪理论分析已完成");
      const primaryNarrative = String(response.analysisPlan.narrative || "波浪理论分析已完成");
      const primaryHeading = tradingAnalysisPaneHeading(targetMarket, job.interval);
      const result: TradingWaveConversationResult = {
        report: combineTradingAnalysisReports(primaryHeading, primaryReport, splitResult),
        narrative: combineTradingAnalysisNarratives(primaryHeading, primaryNarrative, splitResult),
        marketId: job.marketId,
        symbol: job.symbol,
        interval: job.interval,
        candleCount: analysisCandles.length,
        modelName,
      };
      tradingAnalysisJobs.complete(job.analysisId);
      return result;
    } catch (error) {
      tradingAnalysisJobs.fail(job.analysisId, error);
      throw error;
    }
  }

  async runWyckoffConversation(
    request: TradingWyckoffConversationRequest,
  ): Promise<TradingWyckoffConversationResult> {
    const api = window.codexDesktop.runTradingWyckoffAnalysis;
    if (typeof api !== "function") throw new Error("当前版本暂不支持威科夫盘面分析");
    if (!this.markets.length) await this.loadMarkets();
    const normalizedSymbol = String(request.symbol || this.selectedSymbol).trim().toUpperCase();
    const currentMarket = this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const targetMarket = request.symbol
      ? this.markets.find((market) => (
          market.provider === "binance"
          && market.symbol === normalizedSymbol
          && market.marketType === "perpetual"
        )) || this.markets.find((market) => market.provider === "binance" && market.symbol === normalizedSymbol)
      : currentMarket;
    if (!targetMarket) throw new Error(`未找到可用的 ${normalizedSymbol} 行情`);
    const targetInterval = String(request.interval || this.activeInterval).trim().toUpperCase();
    if (!tradingViewResolutionDurationMs(targetInterval)) {
      throw new Error(`暂不支持 ${targetInterval} K 线周期`);
    }

    const marketLabel = targetMarket.displaySymbol || `${targetMarket.baseAsset}/${targetMarket.quoteAsset}`;
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    request.onProgress?.("loading", shouldReload
      ? `正在将左侧行情切换到 ${marketLabel}，加载 ${tradingPeriodLabelForResolution(targetInterval)} K 线。`
      : `正在读取左侧当前画布的 ${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} K 线。`);
    if (shouldReload) {
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (
      this.disposed
      || this.loadedMarketId !== targetMarket.id
      || this.loadedInterval !== targetInterval
      || this.candles.length < 2
    ) {
      throw new Error(`${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} 行情加载失败`);
    }

    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const requestedLookbackMs = Number(request.lookbackMs) > 0 ? Number(request.lookbackMs) : null;
    const visibleRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const canvasCandles = visibleCandlesInLogicalRange(this.candles, visibleRange);
    let analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length >= 60
        ? canvasCandles
        : this.candles.slice(-120);
    const job = tradingAnalysisJobs.start({
      analysisId: request.analysisId,
      theory: "wyckoff",
      storageSessionId: this.drawingStorageSessionId,
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: this.activeInterval,
      market: tradingFavoriteRecord(targetMarket),
    });
    const splitSnapshotsPromise = this.captureSplitPaneAnalysisSnapshots(
      requestedLookbackMs,
      TRADING_WYCKOFF_AUTO_EXPANSION_MAX_CANDLES,
    );
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "wyckoff-analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在识别交易区间、量价努力结果、A–E 阶段和关键事件。`,
    );
    try {
      let wyckoffCandlePool = [...this.candles];
      const focusWyckoffAnalysisCandles = (candles: ReadonlyArray<TradingCandle>) => {
        if (
          this.disposed
          || this.loadedMarketId !== job.marketId
          || this.loadedInterval !== job.interval
          || !candles.length
        ) return;
        const first = candles[0];
        const last = candles[candles.length - 1];
        this.chart?.timeScale().setVisibleRange({
          from: first.time as UTCTimestamp,
          to: last.time as UTCTimestamp,
        });
      };
      const expansion = await runTradingAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => wyckoffCandlePool,
        insufficientDataCode: TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE,
        analyze: async (candles) => {
          focusWyckoffAnalysisCandles(candles);
          if (candles.length < 60) {
            return {
              ok: false,
              error: {
                code: TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE,
                message: `当前范围仅有 ${candles.length} 根 K 线`,
              },
            } as TradingWyckoffAnalysisResponse;
          }
          return api({
            analysisJobId: job.analysisId,
            marketId: job.marketId,
            interval: job.interval,
            snapshotTime: Date.now(),
            instruction: request.instruction,
            responseMode: request.drawingRequested === false ? "direct" : "full",
            lookbackMs: requestedLookbackMs,
            candles: candles.map((candle) => ({
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
          }) as Promise<TradingWyckoffAnalysisResponse>;
        },
        loadMoreHistory: async () => {
          const oldestTime = Number(wyckoffCandlePool[0]?.time || 0) * 1_000;
          if (!oldestTime) return;
          const history = await this.fetchHistoricalCandleBatch({
            symbol: targetMarket.symbol,
            provider: targetMarket.provider,
            assetClass: targetMarket.assetClass,
            marketType: targetMarket.marketType,
            interval: targetInterval,
            count: TRADING_WYCKOFF_HISTORY_BATCH_CANDLES,
            endTime: oldestTime - 1,
          });
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("威科夫分析已由用户停止");
          }
          wyckoffCandlePool = mergeCandles(history.candles, wyckoffCandlePool);
          if (
            !this.disposed
            && this.loadedMarketId === job.marketId
            && this.loadedInterval === job.interval
          ) {
            this.sourceCandles = mergeCandles(history.sourceCandles, this.sourceCandles);
            this.candles = mergeCandles(history.candles, this.candles);
            this.updateChartData();
          }
        },
        onExpansion: (event) => {
          if (event.type === "history") {
            request.onProgress?.(
              "loading",
              `已检查 ${event.candleCount} 根 K 线仍未形成威科夫区间，正在自动加载更早历史，最多检查 ${event.maxCandleCount} 根。`,
            );
            return;
          }
          request.onProgress?.(
            "wyckoff-analyzing",
            `当前 ${event.fromCount} 根 K 线不足，正在自动扩大画布到 ${event.toCount} 根继续威科夫分析。`,
          );
        },
        maxCandleCount: TRADING_WYCKOFF_AUTO_EXPANSION_MAX_CANDLES,
      });
      const response = expansion.response;
      analysisCandles = expansion.candles;
      focusWyckoffAnalysisCandles(analysisCandles);
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("威科夫分析已由用户停止");
      }
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const error = new Error(response?.error?.message || "威科夫分析没有返回可绘制计划");
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "wyckoff-drawing",
          `${modelName} 已完成威科夫候选复核，正在左侧图表绘制交易区间、阶段、关键事件与条件路径。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("wyckoff-drawing", `${modelName} 正在逐项绘制区间边界、Phase A–E 和关键量价事件。`);
          }
        };
        await commitTradingAnalysisDrawingPatch(job, response.analysisPlan.drawingPatch, 0, onPhase);
      }
      const splitResult = await this.runSplitPaneAnalyses({
        job,
        ...(await splitSnapshotsPromise),
        minimumCandles: 60,
        analysisLabel: "威科夫结构",
        analysisProgressPhase: "wyckoff-analyzing",
        drawingProgressPhase: "wyckoff-drawing",
        drawingsRequested: request.drawingRequested !== false,
        onProgress: request.onProgress,
        analyze: async (snapshot) => api({
          analysisJobId: `${job.analysisId}:pane:${snapshot.paneIndex}`,
          marketId: snapshot.market.id,
          interval: snapshot.interval,
          snapshotTime: Date.now(),
          instruction: request.instruction,
          responseMode: request.drawingRequested === false ? "direct" : "full",
          lookbackMs: requestedLookbackMs,
          candles: snapshot.candles.map((candle) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
        }) as Promise<TradingWyckoffAnalysisResponse>,
      });
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("威科夫分析已由用户停止");
      }
      if (request.drawingRequested !== false) rememberTradingAnalysisJobContext(job);
      request.onProgress?.("wyckoff-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成威科夫复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成威科夫拟人落图，正在整理新手可执行的突破、跌破与等待条件。`);
      const primaryReport = String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "威科夫分析已完成");
      const primaryNarrative = String(response.analysisPlan.narrative || "威科夫分析已完成");
      const primaryHeading = tradingAnalysisPaneHeading(targetMarket, job.interval);
      const result: TradingWyckoffConversationResult = {
        report: combineTradingAnalysisReports(primaryHeading, primaryReport, splitResult),
        narrative: combineTradingAnalysisNarratives(primaryHeading, primaryNarrative, splitResult),
        marketId: job.marketId,
        symbol: job.symbol,
        interval: job.interval,
        candleCount: analysisCandles.length,
        modelName,
      };
      tradingAnalysisJobs.complete(job.analysisId);
      return result;
    } catch (error) {
      tradingAnalysisJobs.fail(job.analysisId, error);
      throw error;
    }
  }

  async runOrderFlowConversation(
    request: TradingOrderFlowConversationRequest,
  ): Promise<TradingOrderFlowConversationResult> {
    const api = window.codexDesktop.runTradingOrderFlowAnalysis;
    if (typeof api !== "function") throw new Error("当前版本暂不支持订单流盘面分析");
    if (!this.markets.length) await this.loadMarkets();
    const normalizedSymbol = String(request.symbol || this.selectedSymbol).trim().toUpperCase();
    const currentMarket = this.selectedMarketMeta
      || this.markets.find((market) => market.id === this.selectedMarketId)
      || this.favoriteMarketFromId(this.selectedMarketId);
    const targetMarket = request.symbol
      ? this.markets.find((market) => (
          market.provider === "binance"
          && market.symbol === normalizedSymbol
          && market.marketType === "perpetual"
        ))
      : currentMarket;
    if (!targetMarket) throw new Error(`未找到可用的 ${normalizedSymbol} 币安永续行情`);
    if (targetMarket.provider !== "binance" || targetMarket.marketType !== "perpetual") {
      throw new Error("订单流首发链路仅支持币安永续合约；当前市场没有统一的真实逐笔、深度和持仓量覆盖");
    }
    const targetInterval = String(request.interval || this.activeInterval).trim().toUpperCase();
    if (!tradingViewResolutionDurationMs(targetInterval)) {
      throw new Error(`暂不支持 ${targetInterval} K 线周期`);
    }

    const marketLabel = targetMarket.displaySymbol || `${targetMarket.baseAsset}/${targetMarket.quoteAsset}`;
    const shouldReload = targetMarket.id !== this.loadedMarketId
      || targetInterval !== this.loadedInterval
      || this.candles.length < 2
      || this.marketLoading;
    request.onProgress?.("loading", shouldReload
      ? `正在将左侧行情切换到 ${marketLabel}，加载 ${tradingPeriodLabelForResolution(targetInterval)} K 线。`
      : `正在读取左侧当前画布的 ${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} K 线。`);
    if (shouldReload) {
      this.selectMarket(targetMarket);
      this.activeInterval = targetInterval;
      this.updateSymbolUi();
      this.updateIntervalPressedButtons(targetInterval);
      this.renderMarkets();
      this.drawingController?.redraw();
      this.setPickerOpen(false);
      await this.restartMarketData();
    }
    if (
      this.disposed
      || this.loadedMarketId !== targetMarket.id
      || this.loadedInterval !== targetInterval
      || this.candles.length < 2
    ) {
      throw new Error(`${marketLabel} ${tradingPeriodLabelForResolution(targetInterval)} 行情加载失败`);
    }

    const latestTimeMs = Number(this.candles.at(-1)?.time || 0) * 1_000;
    const requestedLookbackMs = Number(request.lookbackMs) > 0 ? Number(request.lookbackMs) : null;
    const visibleRange = this.chart?.timeScale().getVisibleLogicalRange() || null;
    const canvasCandles = visibleCandlesInLogicalRange(this.candles, visibleRange);
    let analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    const job = tradingAnalysisJobs.start({
      analysisId: request.analysisId,
      theory: "order-flow",
      storageSessionId: this.drawingStorageSessionId,
      marketId: this.selectedMarketId,
      symbol: this.selectedSymbol,
      interval: this.activeInterval,
      market: tradingFavoriteRecord(targetMarket),
    });
    const capturedOpenInterest = this.stats?.openInterest ?? null;
    const splitSnapshotsPromise = this.captureSplitPaneAnalysisSnapshots(
      requestedLookbackMs,
      120,
    );
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "order-flow-analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在读取真实主动成交、盘口深度和持仓量覆盖。`,
    );
    try {
      let orderFlowCandlePool = [...this.candles];
      const focusOrderFlowAnalysisCandles = (candles: ReadonlyArray<TradingCandle>) => {
        if (
          this.disposed
          || this.loadedMarketId !== job.marketId
          || this.loadedInterval !== job.interval
          || !candles.length
        ) return;
        const first = candles[0];
        const last = candles[candles.length - 1];
        this.chart?.timeScale().setVisibleRange({
          from: first.time as UTCTimestamp,
          to: last.time as UTCTimestamp,
        });
      };
      const expansion = await runTradingAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => orderFlowCandlePool,
        insufficientDataCode: TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE,
        analyze: async (candles) => {
          focusOrderFlowAnalysisCandles(candles);
          return candles.length >= 120
            ? { ok: true }
            : {
                ok: false,
                error: {
                  code: TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE,
                  message: `当前订单流背景窗口仅有 ${candles.length} 根 K 线`,
                },
              };
        },
        loadMoreHistory: async () => {
          const oldestTime = Number(orderFlowCandlePool[0]?.time || 0) * 1_000;
          if (!oldestTime) return;
          const history = await this.fetchHistoricalCandleBatch({
            symbol: targetMarket.symbol,
            provider: targetMarket.provider,
            assetClass: targetMarket.assetClass,
            marketType: targetMarket.marketType,
            interval: targetInterval,
            count: TRADING_CANDLE_WINDOW_HISTORY_BATCH_CANDLES,
            endTime: oldestTime - 1,
          });
          if (!tradingAnalysisJobs.isActive(job.analysisId)) {
            throw new Error("订单流分析已由用户停止");
          }
          orderFlowCandlePool = mergeCandles(history.candles, orderFlowCandlePool);
          if (
            !this.disposed
            && this.loadedMarketId === job.marketId
            && this.loadedInterval === job.interval
          ) {
            this.sourceCandles = mergeCandles(history.sourceCandles, this.sourceCandles);
            this.candles = mergeCandles(history.candles, this.candles);
            this.updateChartData();
          }
        },
        onExpansion: (event) => {
          if (event.type === "history") {
            request.onProgress?.(
              "loading",
              `当前仅有 ${event.candleCount} 根 K 线，正在自动加载更早历史，最多扩展到 ${event.maxCandleCount} 根。`,
            );
            return;
          }
          request.onProgress?.(
            "order-flow-analyzing",
            `当前 ${event.fromCount} 根 K 线不足，正在自动扩大画布到 ${event.toCount} 根继续订单流分析。`,
          );
        },
        maxCandleCount: TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES,
      });
      analysisCandles = expansion.candles;
      focusOrderFlowAnalysisCandles(analysisCandles);
      const orderFlow = await fetchTradingOrderFlowWindow(
        job.symbol,
        job.interval,
        capturedOpenInterest,
      );
      const contextCandles = await fetchTradingMarketStructureContexts(
        job.symbol,
        job.interval,
      );
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("订单流分析已由用户停止");
      }
      request.onProgress?.(
        "order-flow-analyzing",
        `已读取 ${orderFlow.trades.length} 笔真实聚合成交、${Math.min(orderFlow.depth.bids.length, orderFlow.depth.asks.length)} 档双边深度和 ${contextCandles.length} 个高周期上下文，正在计算 Delta、ICT/SMC 结构与流动性。`,
      );
      const response = await api({
        analysisJobId: job.analysisId,
        marketId: job.marketId,
        interval: job.interval,
        snapshotTime: Date.now(),
        instruction: request.instruction,
        responseMode: request.drawingRequested === false ? "direct" : "full",
        lookbackMs: requestedLookbackMs,
        candles: analysisCandles.map((candle) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
        contextCandles: contextCandles.map((context) => ({
          interval: context.interval,
          candles: context.candles.map((candle) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
        })),
        orderFlow,
      }) as TradingOrderFlowAnalysisResponse;
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("订单流分析已由用户停止");
      }
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const error = new Error(response?.error?.message || "订单流分析没有返回可绘制计划");
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "order-flow-drawing",
          `${modelName} 已完成订单流与市场结构复核，正在左侧图表只绘制最关键的转折、支撑/压力、流动性与成交证据。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (!tradingAnalysisJobs.isActive(job.analysisId)) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("order-flow-drawing", `${modelName} 正在逐项绘制精简后的关键结构和多空触发价。`);
          }
        };
        await commitTradingAnalysisDrawingPatch(job, response.analysisPlan.drawingPatch, 0, onPhase);
      }
      const splitResult = await this.runSplitPaneAnalyses({
        job,
        ...(await splitSnapshotsPromise),
        minimumCandles: 30,
        analysisLabel: "订单流与市场结构",
        analysisProgressPhase: "order-flow-analyzing",
        drawingProgressPhase: "order-flow-drawing",
        drawingsRequested: request.drawingRequested !== false,
        onProgress: request.onProgress,
        analyze: async (snapshot) => {
          if (snapshot.market.provider !== "binance" || snapshot.market.marketType !== "perpetual") {
            throw new Error("订单流仅支持币安永续合约分屏");
          }
          const [splitOrderFlow, splitContextCandles] = await Promise.all([
            fetchTradingOrderFlowWindow(snapshot.market.symbol, snapshot.interval, null),
            fetchTradingMarketStructureContexts(snapshot.market.symbol, snapshot.interval),
          ]);
          return api({
            analysisJobId: `${job.analysisId}:pane:${snapshot.paneIndex}`,
            marketId: snapshot.market.id,
            interval: snapshot.interval,
            snapshotTime: Date.now(),
            instruction: request.instruction,
            responseMode: request.drawingRequested === false ? "direct" : "full",
            lookbackMs: requestedLookbackMs,
            candles: snapshot.candles.map((candle) => ({
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            })),
            contextCandles: splitContextCandles.map((context) => ({
              interval: context.interval,
              candles: context.candles.map((candle) => ({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
              })),
            })),
            orderFlow: splitOrderFlow,
          }) as Promise<TradingOrderFlowAnalysisResponse>;
        },
      });
      if (!tradingAnalysisJobs.isActive(job.analysisId)) {
        throw new Error("订单流分析已由用户停止");
      }
      if (request.drawingRequested !== false) rememberTradingAnalysisJobContext(job);
      request.onProgress?.("order-flow-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成订单流复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成精简订单流绘图，正在整理新手可读的上破、跌破、回踩与等待方案。`);
      const primaryReport = String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "订单流分析已完成");
      const primaryNarrative = String(response.analysisPlan.narrative || "订单流分析已完成");
      const primaryHeading = tradingAnalysisPaneHeading(targetMarket, job.interval);
      const result: TradingOrderFlowConversationResult = {
        report: combineTradingAnalysisReports(primaryHeading, primaryReport, splitResult),
        narrative: combineTradingAnalysisNarratives(primaryHeading, primaryNarrative, splitResult),
        marketId: job.marketId,
        symbol: job.symbol,
        interval: job.interval,
        candleCount: analysisCandles.length,
        tradeCount: orderFlow.trades.length,
        modelName,
      };
      tradingAnalysisJobs.complete(job.analysisId);
      return result;
    } catch (error) {
      tradingAnalysisJobs.fail(job.analysisId, error);
      throw error;
    }
  }

  private commitMarketSnapshot(
    targetSymbol: string,
    targetMarketId: string,
    targetProvider: TradingMarketProvider,
    targetAssetClass: TradingAssetClass,
    targetMarketType: TradingMarketType,
    targetMarketMeta: TradingMarket | null,
    targetInterval: string,
    stats: TradingMarketStats,
    candleBatch: TradingCandleBatch,
  ) {
    this.stats = stats;
    this.candles = candleBatch.candles;
    this.sourceCandles = candleBatch.sourceCandles;
    this.lastAggregateTradeId = candleBatch.lastTradeId ?? null;
    this.loadedSymbol = targetSymbol;
    this.loadedMarketId = targetMarketId;
    this.loadedProvider = targetProvider;
    this.loadedAssetClass = targetAssetClass;
    this.loadedMarketType = targetMarketType;
    this.loadedMarketMeta = targetMarketMeta;
    this.loadedInterval = targetInterval;
    this.updateStatsUi();
    this.updateChartData({ resetViewport: true });
    this.syncAlertSimulationForCurrentContext();
  }

  private currentMarketCandleCacheKey() {
    return tradingMarketCandleCacheKey({
      provider: this.loadedProvider,
      symbol: this.loadedSymbol,
      assetClass: this.loadedAssetClass,
      interval: this.loadedInterval,
      marketType: this.loadedMarketType,
    });
  }

  private persistCurrentMarketCandleSnapshot() {
    if (!this.stats || !this.candles.length || !this.loadedSymbol || !this.loadedInterval) return;
    const source = this.loadedProvider === "binance"
      ? binanceResolutionSource(this.loadedInterval)
      : {
          targetMs: tradingViewResolutionDurationMs(this.loadedInterval) || 60_000,
          sourceInterval: null,
          sourceMs: null,
        };
    if (!source) return;
    setTradingMarketCandleCache(this.currentMarketCandleCacheKey(), {
      stats: this.stats,
      candleBatch: {
        candles: this.candles,
        sourceCandles: this.sourceCandles,
        source,
        lastTradeId: this.lastAggregateTradeId ?? undefined,
      },
    });
    this.lastCandleCachePersistAt = Date.now();
  }

  private scheduleCurrentMarketCandlePersistence() {
    if (this.disposed || this.candleCachePersistTimer !== null) return;
    const delayMs = Math.max(1_500, 15_000 - (Date.now() - this.lastCandleCachePersistAt));
    this.candleCachePersistTimer = window.setTimeout(() => {
      this.candleCachePersistTimer = null;
      if (!this.disposed) this.persistCurrentMarketCandleSnapshot();
    }, delayMs);
  }

  private async prefetchFavoriteCandleSnapshots() {
    if (this.favoriteCandlePrefetchStarted || this.disposed) return;
    this.favoriteCandlePrefetchStarted = true;
    const targets = [...this.favoriteMarketRecords.values()]
      .filter((record) => record.provider === "binance" && this.favoriteSymbols.has(record.id))
      .slice(0, 4);
    for (const record of targets) {
      if (this.disposed || binanceMarketRestCooldownRemaining() > 0) return;
      const interval = this.activeInterval;
      const marketType = record.marketType === "spot" ? "spot" : "perpetual";
      const key = tradingMarketCandleCacheKey({
        provider: record.provider,
        symbol: record.symbol,
        assetClass: record.assetClass,
        interval,
        marketType: record.marketType,
      });
      if (getTradingMarketCandleCache(key)) continue;
      try {
        const candleBatch = await fetchTradingCandles(
          record.symbol,
          interval,
          500,
          Date.now(),
          marketType,
        );
        if (!candleBatch.candles.length || !tradingCandleSeriesMatchesResolution(candleBatch.candles, interval)) continue;
        setTradingMarketCandleCache(key, {
          stats: tradingMarketStatsFromCandles(record.symbol, candleBatch.candles),
          candleBatch,
        });
      } catch {
        // Prefetch is opportunistic; the explicit selection path still fetches
        // the pair and shows its normal retry state if this request fails.
      }
      // Yield between favorites so the initial chart and picker remain
      // responsive even when several saved pairs need a warm snapshot.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  private async restartMarketData(options: { preserveChart?: boolean } = {}) {
    const generation = ++this.loadGeneration;
    this.marketDataRequestAbortController?.abort();
    const marketDataRequestAbortController = new AbortController();
    this.marketDataRequestAbortController = marketDataRequestAbortController;
    const marketDataRequestSignal = marketDataRequestAbortController.signal;
    const targetSymbol = this.selectedSymbol;
    const targetMarketId = this.selectedMarketId;
    const targetProvider = this.selectedProvider;
    const targetAssetClass = this.selectedAssetClass;
    const targetMarketType = this.selectedMarketType;
    const targetMarketMeta = this.selectedMarketMeta ? { ...this.selectedMarketMeta } : null;
    const targetInterval = this.activeInterval;
    const candleCacheKey = tradingMarketCandleCacheKey({
      provider: targetProvider,
      symbol: targetSymbol,
      assetClass: targetAssetClass,
      interval: targetInterval,
      marketType: targetMarketType,
    });
    const cachedSnapshot = getTradingMarketCandleCache(candleCacheKey);
    const cachedSnapshotUsable = cachedSnapshot
      && cachedSnapshot.candleBatch.candles.length > 0
      && tradingCandleSeriesMatchesResolution(cachedSnapshot.candleBatch.candles, targetInterval);
    let cachedSnapshotApplied = false;
    let binanceSocketStarted = false;
    const keepChart = options.preserveChart === true && this.candles.length > 0;
    if (this.marketRateLimitRetryTimer !== null) {
      window.clearTimeout(this.marketRateLimitRetryTimer);
      this.marketRateLimitRetryTimer = null;
    }
    // The overlay belongs to the exact market/interval where it was created.
    // Detach it while any chart reload is in flight; a matching context restores
    // it only after that context's real candles have committed.
    this.detachAlertSimulation();
    this.loadingHistory = false;
    if (this.historyCooldownTimer !== null) {
      window.clearTimeout(this.historyCooldownTimer);
      this.historyCooldownTimer = null;
    }
    if (this.candleCachePersistTimer !== null) {
      window.clearTimeout(this.candleCachePersistTimer);
      this.candleCachePersistTimer = null;
      this.persistCurrentMarketCandleSnapshot();
    }
    this.closeSocket();
    this.cancelScheduledLiveChartPaint();
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.candlePollTimer !== null) {
      window.clearInterval(this.candlePollTimer);
      this.candlePollTimer = null;
    }
    // Keep the previous pixels behind an opaque loading state, but never expose
    // them under the newly selected interval. Otherwise the old candles are
    // formatted and interpreted as the new period while its request is pending.
    this.setLoading(true);
    this.hideCrosshairTimeLabel();
    this.hideCrosshairPriceLabel();
    this.currentPriceElement.hidden = true;
    this.hideCandleCountdown();
    if (!keepChart) {
      this.stats = null;
      this.candles = [];
      this.sourceCandles = [];
      this.lastAggregateTradeId = null;
      this.clearChart();
    }
    this.clearMarketError();
    if (cachedSnapshotUsable) {
      // Paint a recent snapshot immediately, then keep the network request
      // below as a background refresh. This makes switching back to a viewed
      // pair feel instant without treating the cache as authoritative.
      this.commitMarketSnapshot(
        targetSymbol,
        targetMarketId,
        targetProvider,
        targetAssetClass,
        targetMarketType,
        targetMarketMeta,
        targetInterval,
        cachedSnapshot.stats,
        cachedSnapshot.candleBatch,
      );
      cachedSnapshotApplied = true;
      this.setLoading(false);
    }
    if (targetProvider === "binance") {
      // Establish realtime delivery in parallel with REST history. Cached charts
      // can therefore receive the forming candle immediately instead of waiting
      // for a full history refresh to finish first.
      void this.connectSocket(generation);
      binanceSocketStarted = true;
    }
    try {
      const { stats, candleBatch } = targetProvider === "finnhub"
        ? await this.fetchFinnhubSnapshot(targetSymbol, targetAssetClass, targetInterval, 500)
        : targetProvider === "ifind"
          ? await this.fetchIfindSnapshot(targetSymbol, targetAssetClass, targetInterval, 500)
          : await (async () => {
            // K-line availability is the primary loading result. Quote statistics
            // are refreshed independently after the chart is ready, so a temporary
            // ticker failure cannot expose Retry while candles are still loading.
            // The visible chart uses Chromium's network stack, just like split
            // panes. The background alert service uses Node networking and must
            // not become the chart's history transport or period switching can
            // silently fail behind a cached previous interval.
            const cachedBatch = cachedSnapshotUsable ? cachedSnapshot.candleBatch : null;
            const canRefreshIncrementally = cachedBatch
              ? tradingCandleBatchCanRefreshIncrementally(cachedBatch)
              : false;
            const candleBatch = cachedBatch && canRefreshIncrementally
              ? mergeTradingCandleBatches(
                  cachedBatch,
                  await fetchLatestTradingCandles(
                    targetSymbol,
                    targetInterval,
                    cachedBatch.sourceCandles.at(-1)?.time === undefined
                      ? undefined
                      : cachedBatch.sourceCandles.at(-1)!.time * 1_000,
                    cachedBatch.lastTradeId === undefined ? undefined : cachedBatch.lastTradeId + 1,
                    targetMarketType === "spot" ? "spot" : "perpetual",
                    marketDataRequestSignal,
                  ),
                  { candleLimit: 500 },
                ) as TradingCandleBatch
              : await fetchTradingCandles(
                  targetSymbol,
                  targetInterval,
                  500,
                  Date.now(),
                  targetMarketType === "spot" ? "spot" : "perpetual",
                  marketDataRequestSignal,
                );
            if (!candleBatch.candles.length) throw new Error("未返回可用 K 线数据");
            if (!tradingCandleSeriesMatchesResolution(candleBatch.candles, targetInterval)) {
              throw new Error(`返回的 K 线周期与所选周期 ${targetInterval} 不一致`);
            }
            const stats = tradingMarketStatsFromCandles(targetSymbol, candleBatch.candles);
            return { stats, candleBatch };
          })();
      let finalCandleBatch = candleBatch;
      if (
        targetProvider === "binance"
        && generation === this.loadGeneration
        && this.loadedMarketId === targetMarketId
        && this.loadedInterval === targetInterval
        && this.candles.length
      ) {
        const liveSource = binanceResolutionSource(targetInterval);
        if (liveSource) {
          finalCandleBatch = mergeTradingCandleBatches(candleBatch, {
            candles: this.candles,
            sourceCandles: this.sourceCandles,
            source: liveSource,
            lastTradeId: this.lastAggregateTradeId ?? undefined,
          }, { candleLimit: 500 }) as TradingCandleBatch;
        }
      }
      const finalStats = targetProvider === "binance"
        ? tradingMarketStatsFromCandles(targetSymbol, finalCandleBatch.candles)
        : stats;
      setTradingMarketCandleCache(candleCacheKey, { stats: finalStats, candleBatch: finalCandleBatch });
      this.lastCandleCachePersistAt = Date.now();
      if (this.disposed || generation !== this.loadGeneration) return;
      this.commitMarketSnapshot(
        targetSymbol,
        targetMarketId,
        targetProvider,
        targetAssetClass,
        targetMarketType,
        targetMarketMeta,
        targetInterval,
        finalStats,
        finalCandleBatch,
      );
      this.setLoading(false);
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return;
      console.error("加载实时行情失败", error);
      if (cachedSnapshotApplied) {
        // Keep the cached chart usable when a background refresh is rate
        // limited or temporarily offline; the next fallback poll retries it.
        this.setLoading(false);
        this.clearMarketError();
      } else {
        this.setLoading(false);
        // Never relabel the previous interval's candles as the newly selected
        // period. A failed switch is an explicit error state and the retry keeps
        // the user's requested symbol and interval.
        this.stats = null;
        this.candles = [];
        this.sourceCandles = [];
        this.lastAggregateTradeId = null;
        this.clearChart();
        const message = String((error as Error)?.message || "行情加载失败").trim();
        this.errorElement.textContent = targetProvider === "finnhub"
          ? GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE
          : `${message} 点击重试`;
        this.errorElement.dataset.marketAction = targetProvider === "finnhub"
          ? "open-default-market"
          : "retry";
        if (targetProvider === "finnhub") {
          this.errorElement.setAttribute(
            "aria-label",
            `${GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE}，点击加载 BTC/USDT 永续合约`,
          );
        }
        this.errorElement.hidden = false;
        if (targetProvider === "finnhub") return;
        const cooldownRemaining = targetProvider === "binance"
          ? binanceMarketRestCooldownRemaining()
          : 0;
        if (cooldownRemaining > 0) {
          this.marketRateLimitRetryTimer = window.setTimeout(() => {
            this.marketRateLimitRetryTimer = null;
            if (this.disposed || generation !== this.loadGeneration) return;
            void this.restartMarketData({ preserveChart: true });
          }, cooldownRemaining + BINANCE_MARKET_RATE_LIMIT_RETRY_PADDING_MS);
        }
      }
    }
    if (this.disposed || generation !== this.loadGeneration) return;
    if (this.candles.length) void this.prefetchFavoriteCandleSnapshots();
    if (this.selectedProvider === "binance" && !binanceSocketStarted) {
      this.connectSocket(generation);
    }
    if (this.selectedProvider === "binance") void this.refreshSnapshot(generation);
    this.pollTimer = window.setInterval(() => void this.refreshSnapshot(generation), 30_000);
    this.candlePollTimer = window.setInterval(
      () => this.refreshMarketDataFallback(generation),
      this.selectedProvider === "binance" ? MARKET_SOCKET_FALLBACK_INTERVAL_MS : 60_000,
    );
  }

  private refreshMarketDataFallback(generation: number) {
    if (this.disposed || generation !== this.loadGeneration) return;
    if (this.selectedProvider !== "binance") {
      void this.refreshLiveCandle(generation);
      return;
    }
    if (binanceMarketRestCooldownRemaining() > 0) return;
    const silenceMs = Date.now() - this.marketSocketLastActivityAt;
    if (this.marketSocketLastActivityAt > 0 && silenceMs < MARKET_SOCKET_STALE_MS) return;
    void this.refreshSnapshot(generation);
    void this.refreshLiveCandle(generation);
  }

  private async refreshSnapshot(generation: number) {
    if (this.selectedProvider === "binance" && binanceMarketRestCooldownRemaining() > 0) return;
    if (this.refreshingSnapshotGeneration === generation) return;
    this.refreshingSnapshotGeneration = generation;
    try {
      if (this.selectedProvider !== "binance") {
        const api = this.selectedProvider === "ifind"
          ? window.codexDesktop.getIfindMarketQuotes
          : window.codexDesktop.getFinnhubMarketQuotes;
        if (!api) return;
        const response = await api({ symbols: [this.selectedSymbol] });
        if (this.disposed || generation !== this.loadGeneration || response?.ok !== true) return;
        const quote = Array.isArray(response.quotes) ? response.quotes[0] : null;
        if (!quote || quote.unavailable === true || !this.stats) return;
        this.stats = {
          ...this.stats,
          markPrice: Number(quote.current || this.stats.markPrice),
          midPrice: Number(quote.current || this.stats.midPrice),
          prevDayPrice: Number(quote.previousClose || this.stats.prevDayPrice),
        };
        this.updateStatsUi();
        this.scheduleCurrentMarketCandlePersistence();
        return;
      }
      const stats = await fetchTradingMarketStats(
        this.selectedSymbol,
        this.selectedMarketType === "spot" ? "spot" : "perpetual",
      );
      if (this.disposed || generation !== this.loadGeneration) return;
      this.stats = stats;
      this.updateStatsUi();
      this.scheduleCurrentMarketCandlePersistence();
    } catch {
      // WebSocket is the primary stream; a failed fallback poll is non-fatal.
    } finally {
      if (this.refreshingSnapshotGeneration === generation) {
        this.refreshingSnapshotGeneration = null;
      }
    }
  }

  private async refreshLiveCandle(generation: number) {
    if (this.selectedProvider === "binance" && binanceMarketRestCooldownRemaining() > 0) return;
    if (this.refreshingLiveCandleGeneration === generation) return;
    this.refreshingLiveCandleGeneration = generation;
    try {
      if (this.selectedProvider !== "binance") {
        const api = this.selectedProvider === "ifind"
          ? window.codexDesktop.getIfindMarketCandles
          : window.codexDesktop.getFinnhubMarketCandles;
        if (!api) return;
        const response = await api({
          symbol: this.selectedSymbol,
          assetClass: this.selectedAssetClass,
          resolution: this.activeInterval,
          count: 6,
          endTime: Date.now(),
        });
        if (this.disposed || generation !== this.loadGeneration || response?.ok !== true) return;
        const recovering = this.candles.length === 0;
        this.candles = mergeCandles(this.candles, this.normalizeRemoteCandles(response.candles));
        if (this.candles.length) this.commitLoadedSelection();
        this.updateChartData({ resetViewport: recovering });
        this.scheduleCurrentMarketCandlePersistence();
        return;
      }
      const sourceStartTime = this.sourceCandles.at(-1)?.time;
      const batch = await fetchLatestTradingCandles(
        this.selectedSymbol,
        this.activeInterval,
        sourceStartTime === undefined ? undefined : sourceStartTime * 1000,
        this.lastAggregateTradeId === null ? undefined : this.lastAggregateTradeId + 1,
        this.selectedMarketType === "spot" ? "spot" : "perpetual",
        this.marketDataRequestAbortController?.signal,
      );
      if (this.disposed || generation !== this.loadGeneration) return;
      if (batch.lastTradeId !== undefined) {
        this.lastAggregateTradeId = Math.max(
          this.lastAggregateTradeId ?? batch.lastTradeId,
          batch.lastTradeId,
        );
      }
      const recovering = this.candles.length === 0;
      if (batch.source.sourceInterval && batch.source.sourceMs) {
        this.sourceCandles = mergeCandles(this.sourceCandles, batch.sourceCandles);
        this.candles = batch.source.sourceMs === batch.source.targetMs
          ? [...this.sourceCandles]
          : aggregateTradingCandles(this.sourceCandles, batch.source.targetMs);
      } else {
        this.candles = mergeCandles(this.candles, batch.candles);
      }
      if (this.candles.length) this.commitLoadedSelection();
      this.updateChartData({ resetViewport: recovering });
      this.scheduleCurrentMarketCandlePersistence();
    } catch {
      // Production WebSocket remains primary; REST polling is a best-effort fallback.
    } finally {
      if (this.refreshingLiveCandleGeneration === generation) {
        this.refreshingLiveCandleGeneration = null;
      }
    }
  }

  private async connectSocket(generation: number) {
    if (this.disposed || generation !== this.loadGeneration || this.selectedProvider !== "binance") return;
    const marketType = this.selectedMarketType === "spot" ? "spot" : "perpetual";
    const source = binanceResolutionSource(this.activeInterval);
    const symbol = this.selectedSymbol.toLowerCase();
    const streams = [`${symbol}@ticker`, `${symbol}@aggTrade`];
    if (marketType === "perpetual") streams.unshift(`${symbol}@markPrice@1s`);
    if (source?.sourceInterval) streams.push(`${symbol}@kline_${source.sourceInterval}`);
    let result: { subscriptionId: string };
    try {
      result = await subscribeBinanceMarketStreams(marketType, streams, (event) => {
        if (this.disposed || generation !== this.loadGeneration) return;
        if (event?.type === "health") {
          if (event.status === "connected") this.marketSocketLastActivityAt = Date.now();
          else if (event.status === "reconnecting") this.marketSocketLastActivityAt = 0;
          return;
        }
        if (event?.type !== "data") return;
        this.marketSocketLastActivityAt = Date.now();
        this.handleSocketMessage(event.data);
      });
    } catch {
      if (!this.disposed && generation === this.loadGeneration) {
        this.reconnectTimer = window.setTimeout(() => void this.connectSocket(generation), 1_500);
      }
      return;
    }
    if (this.disposed || generation !== this.loadGeneration || this.selectedProvider !== "binance") {
      unsubscribeBinanceMarketStreams(result.subscriptionId);
      return;
    }
    this.marketStreamSubscriptionId = result.subscriptionId;
  }

  private handleSocketMessage(message: any) {
    const payload = (message?.data?.e ? message.data : message) as BinanceWsMessage;
    if (payload.s && payload.s !== this.selectedSymbol) return;
    if (payload.e === "markPriceUpdate" && this.stats) {
      this.stats = {
        ...this.stats,
        markPrice: Number(payload.p || this.stats.markPrice),
        fundingRate: Number(payload.r || this.stats.fundingRate),
        nextFundingTime: Number(payload.T || this.stats.nextFundingTime),
      };
      this.updateStatsUi();
      this.scheduleCurrentMarketCandlePersistence();
      return;
    }
    if (payload.e === "24hrTicker" && this.stats) {
      const lastPrice = Number(payload.c || this.stats.midPrice);
      this.stats = {
        ...this.stats,
        markPrice: this.selectedMarketType === "spot" ? lastPrice : this.stats.markPrice,
        midPrice: lastPrice,
        prevDayPrice: Number(payload.o || this.stats.prevDayPrice),
        volume24h: Number(payload.q || this.stats.volume24h),
      };
      this.updateStatsUi();
      this.scheduleCurrentMarketCandlePersistence();
      return;
    }
    if (payload.e === "kline" && payload.k) {
      this.updateFromBinanceKline(payload.k);
      return;
    }
    if (payload.e === "aggTrade") this.updateFromBinanceTrade(payload);
  }

  private updateFromBinanceKline(kline: BinanceKlinePayload) {
    const source = binanceResolutionSource(this.activeInterval);
    if (
      !source?.sourceInterval
      || kline.s !== this.selectedSymbol
      || kline.i !== source.sourceInterval
      || Number(kline.t) <= 0
    ) return;
    const incoming: TradingCandle = {
      time: Math.floor(Number(kline.t) / 1000),
      open: Number(kline.o || 0),
      high: Number(kline.h || 0),
      low: Number(kline.l || 0),
      close: Number(kline.c || 0),
      volume: Number(kline.v || 0),
    };
    this.applyLiveSourceCandle(incoming, source);
    this.commitLoadedSelection();
    this.scheduleLiveChartPaint();
    this.scheduleCurrentMarketCandlePersistence();
  }

  private upsertLiveCandle(candles: TradingCandle[], incoming: TradingCandle) {
    const latest = candles.at(-1);
    if (latest?.time === incoming.time) {
      candles[candles.length - 1] = incoming;
      return candles;
    }
    if (!latest || incoming.time > latest.time) {
      candles.push(incoming);
      return candles;
    }
    return mergeCandles(candles, [incoming]);
  }

  private applyLiveSourceCandle(
    incoming: TradingCandle,
    source: NonNullable<ReturnType<typeof binanceResolutionSource>>,
  ) {
    this.sourceCandles = this.upsertLiveCandle(this.sourceCandles, incoming);
    if (source.sourceMs === source.targetMs) {
      this.candles = this.upsertLiveCandle(this.candles, { ...incoming });
      return;
    }
    const bucketTime = Math.floor(incoming.time * 1_000 / source.targetMs) * source.targetMs / 1_000;
    const bucketSourceCandles: TradingCandle[] = [];
    for (let index = this.sourceCandles.length - 1; index >= 0; index -= 1) {
      const candle = this.sourceCandles[index];
      if (candle.time < bucketTime) break;
      if (candle.time < bucketTime + source.targetMs / 1_000) bucketSourceCandles.unshift(candle);
    }
    const target = aggregateTradingCandles(bucketSourceCandles, source.targetMs).at(-1);
    if (target) this.candles = this.upsertLiveCandle(this.candles, target);
  }

  private updateFromBinanceTrade(trade: BinanceWsMessage) {
    const source = binanceResolutionSource(this.activeInterval);
    const timeMs = Number(trade.T || 0);
    const price = Number(trade.p || 0);
    const volume = Number(trade.q || 0);
    const tradeId = Number(trade.a || 0);
    if (!source || timeMs <= 0 || !Number.isFinite(price) || price <= 0) return;
    if (Number.isFinite(tradeId) && tradeId > 0) {
      this.lastAggregateTradeId = Math.max(this.lastAggregateTradeId ?? tradeId, tradeId);
    }
    if (source.sourceInterval) {
      const sourceMs = Number(source.sourceMs || 0);
      if (sourceMs <= 0) return;
      const sourceTime = Math.floor(timeMs / sourceMs) * sourceMs / 1000;
      const latestSource = this.sourceCandles.at(-1);
      const incoming = latestSource?.time === sourceTime
        ? {
            ...latestSource,
            high: Math.max(latestSource.high, price),
            low: Math.min(latestSource.low, price),
            close: price,
          }
        : {
          time: sourceTime,
          open: price,
          high: price,
          low: price,
          close: price,
          volume,
        };
      this.applyLiveSourceCandle(incoming, source);
      this.commitLoadedSelection();
      this.scheduleLiveChartPaint();
      this.scheduleCurrentMarketCandlePersistence();
      return;
    }
    const time = Math.floor(timeMs / source.targetMs) * source.targetMs / 1000;
    const latest = this.candles.at(-1);
    const existing = latest?.time === time
      ? latest
      : this.candles.find((candle) => candle.time === time);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume = Number(existing.volume || 0) + volume;
    } else if (!latest || time > latest.time) {
      this.candles.push({
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    } else {
      this.candles = mergeCandles(this.candles, [{
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      }]);
    }
    this.commitLoadedSelection();
    this.scheduleLiveChartPaint();
    this.scheduleCurrentMarketCandlePersistence();
  }

  private scheduleLiveChartPaint() {
    if (this.disposed || this.liveChartPaintTimer !== null || this.liveChartPaintFrame !== null) return;
    const delayMs = document.hidden
      ? MARKET_BACKGROUND_PAINT_INTERVAL_MS
      : MARKET_LIVE_PAINT_INTERVAL_MS;
    this.liveChartPaintTimer = window.setTimeout(() => {
      this.liveChartPaintTimer = null;
      this.liveChartPaintFrame = window.requestAnimationFrame(() => {
        this.liveChartPaintFrame = null;
        if (this.disposed) return;
        if (Date.now() - this.lastLiveChartFullRefreshAt >= MARKET_LIVE_FULL_REFRESH_INTERVAL_MS) {
          this.updateChartData();
          return;
        }
        this.paintLatestCandle();
      });
    }, delayMs);
  }

  private paintLatestCandle() {
    if (!this.chart || !this.candleSeries) return;
    const latest = this.candles.at(-1);
    if (!latest) return;
    const renderedLatest = this.chartCandles.at(-1);
    if (renderedLatest?.time === latest.time) {
      this.chartCandles[this.chartCandles.length - 1] = { ...latest };
    } else if (!renderedLatest || latest.time > renderedLatest.time) {
      this.chartCandles.push({ ...latest });
    } else {
      this.chartCandles = mergeCandles(this.chartCandles, [{ ...latest }]);
    }
    const trendBars = this.trendBandEnabled ? atm1TrendCandles(this.chartCandles) : null;
    const display = this.primarySeriesData(this.chartCandles, trendBars).at(-1);
    if (!display) return;
    this.candleSeries.update(display);
    const lineColor = latest.close >= latest.open
      ? this.chartSettings.risingColor
      : this.chartSettings.fallingColor;
    this.priceLine?.applyOptions({
      price: latest.close,
      color: lineColor,
      axisLabelColor: lineColor,
    });
    this.renderLatestOhlc();
    this.clearMarketError();
    this.updateCountdown();
  }

  private commitLoadedSelection() {
    this.loadedSymbol = this.selectedSymbol;
    this.loadedMarketId = this.selectedMarketId;
    this.loadedProvider = this.selectedProvider;
    this.loadedAssetClass = this.selectedAssetClass;
    this.loadedMarketType = this.selectedMarketType;
    this.loadedMarketMeta = this.selectedMarketMeta ? { ...this.selectedMarketMeta } : null;
    this.loadedInterval = this.activeInterval;
  }

  private updateStatsUi() {
    if (!this.stats) return;
    this.applyMarketPriceFormat(this.stats.markPrice);
    const changeAmount = this.stats.markPrice - this.stats.prevDayPrice;
    const changePercent = this.stats.prevDayPrice
      ? (changeAmount / this.stats.prevDayPrice) * 100
      : 0;
    const priceDigits = marketPriceFormatFor(this.stats.markPrice).precision;
    const currencyPrefix = this.selectedProvider === "binance" ? "$" : "";
    this.setStat("mark", `${currencyPrefix}${formatPrice(this.stats.markPrice, priceDigits)}`);
    this.setStat(
      "change",
      `${changeAmount >= 0 ? "+" : "-"}${currencyPrefix}${formatPrice(Math.abs(changeAmount), priceDigits)} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`,
      changeAmount >= 0 ? "positive" : "negative",
    );
    const selectedFavorite = this.favoriteTickerMarketsById.get(this.selectedMarketId);
    if (selectedFavorite && this.loadedMarketId === this.selectedMarketId) {
      const latestPrice = this.selectedMarketType === "spot" ? this.stats.markPrice : this.stats.midPrice;
      selectedFavorite.markPrice = latestPrice;
      selectedFavorite.changePercent = this.stats.prevDayPrice > 0
        ? ((latestPrice - this.stats.prevDayPrice) / this.stats.prevDayPrice) * 100
        : 0;
      selectedFavorite.quoteAvailable = latestPrice > 0;
      if (this.stats.prevDayPrice > 0) {
        this.favoriteTickerOpenPricesById.set(selectedFavorite.id, this.stats.prevDayPrice);
      }
      this.scheduleFavoriteTickerPaint();
    }
    this.updateCountdown();
  }

  private applyMarketPriceFormat(price: number) {
    const priceFormat = marketPriceFormatFor(price);
    this.candleSeries?.applyOptions({ priceFormat });
    this.bandUpperSeries?.applyOptions({ priceFormat });
    this.bandLowerSeries?.applyOptions({ priceFormat });
    this.mainIndicatorSeries.forEach((seriesList) => {
      seriesList.forEach((series) => series.applyOptions({ priceFormat }));
    });
  }

  private updateCountdown() {
    const latest = this.chartCandles[this.chartCandles.length - 1];
    const intervalMs = tradingViewResolutionDurationMs(this.activeInterval);
    if (this.chartSettings.showCountdown && latest && intervalMs !== null && intervalMs > 0) {
      const remainingSeconds = Math.max(
        Math.ceil((latest.time * 1000 + intervalMs - Date.now()) / 1000),
        0,
      );
      const hours = Math.floor(remainingSeconds / 3_600);
      const minutes = Math.floor((remainingSeconds % 3_600) / 60);
      const seconds = remainingSeconds % 60;
      this.candleCountdownElement.textContent = [hours, minutes, seconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
      this.candleCountdownElement.dateTime = `PT${remainingSeconds}S`;
      this.candleCountdownElement.setAttribute(
        "aria-label",
        `K线结束倒计时 ${hours}小时${minutes}分${seconds}秒`,
      );
      this.updateCurrentPriceLabel();
    } else {
      this.hideCandleCountdown();
    }
    if (this.stats) {
      if (this.selectedProvider !== "binance" || this.selectedMarketType !== "perpetual") {
        this.setStat("funding", "--");
      } else {
        const funding = this.stats.fundingRate;
        this.setStat(
          "funding",
          `${funding >= 0 ? "+" : ""}${(funding * 100).toFixed(4)}% / ${formatFundingCountdown(Date.now(), this.stats.nextFundingTime)}`,
          funding >= 0 ? "positive" : "negative",
        );
      }
    }
  }

  private setStat(name: string, text: string, tone?: "positive" | "negative") {
    const element = this.host.querySelector<HTMLElement>(`[data-market-stat="${name}"]`);
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("positive", tone === "positive");
    element.classList.toggle("negative", tone === "negative");
  }

  private chartPriceScaleMode() {
    if (this.chartSettings.priceScaleMode === "logarithmic") return PriceScaleMode.Logarithmic;
    if (this.chartSettings.priceScaleMode === "percentage") return PriceScaleMode.Percentage;
    return PriceScaleMode.Normal;
  }

  private addPrimarySeries() {
    if (!this.chart) return;
    const commonOptions = {
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
    };
    if (this.chartSettings.chartStyle === "bars") {
      this.candleSeries = this.chart.addSeries(BarSeries, {
        ...commonOptions,
        upColor: this.chartSettings.risingColor,
        downColor: this.chartSettings.fallingColor,
        openVisible: true,
        thinBars: true,
      });
    } else if (this.chartSettings.chartStyle === "close-line") {
      this.candleSeries = this.chart.addSeries(LineSeries, {
        ...commonOptions,
        color: this.chartSettings.risingColor,
        lineWidth: 2,
        crosshairMarkerVisible: true,
      });
    } else {
      this.candleSeries = this.chart.addSeries(CandlestickSeries, {
        ...commonOptions,
        upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
        downColor: this.chartSettings.fallingColor,
        borderVisible: this.chartSettings.showCandleBorder,
        borderUpColor: this.chartSettings.risingColor,
        borderDownColor: this.chartSettings.fallingColor,
        wickVisible: this.chartSettings.showWicks,
        wickUpColor: this.chartSettings.risingColor,
        wickDownColor: this.chartSettings.fallingColor,
      });
    }
    this.tdMarkers = createSeriesMarkers(this.candleSeries, [], {
      autoScale: true,
      zOrder: "aboveSeries",
    });
  }

  private applyPrimarySeriesOptions() {
    if (!this.candleSeries) return;
    if (this.chartSettings.chartStyle === "bars") {
      this.candleSeries.applyOptions({
        upColor: this.chartSettings.risingColor,
        downColor: this.chartSettings.fallingColor,
      });
      return;
    }
    if (this.chartSettings.chartStyle === "close-line") {
      this.candleSeries.applyOptions({ color: this.chartSettings.risingColor });
      return;
    }
    this.candleSeries.applyOptions({
      upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
      downColor: this.chartSettings.fallingColor,
      borderVisible: this.chartSettings.showCandleBorder,
      borderUpColor: this.chartSettings.risingColor,
      borderDownColor: this.chartSettings.fallingColor,
      wickVisible: this.chartSettings.showWicks,
      wickUpColor: this.chartSettings.risingColor,
      wickDownColor: this.chartSettings.fallingColor,
    });
  }

  private rebuildPrimarySeries() {
    if (!this.chart || !this.candleSeries) return;
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    if (this.priceLine) {
      this.candleSeries.removePriceLine(this.priceLine);
      this.priceLine = null;
    }
    this.chart.removeSeries(this.candleSeries);
    this.candleSeries = null;
    this.tdMarkers = null;
    this.addPrimarySeries();
    this.updateChartData({ preserveViewport: true });
    if (visibleRange) this.chart.timeScale().setVisibleLogicalRange(visibleRange);
    this.drawingController?.redraw();
  }

  private primarySeriesData(candles: TradingCandle[], trendBars: ReturnType<typeof atm1TrendCandles> | null) {
    const transformed = this.chartSettings.chartStyle === "heikin-ashi"
      ? heikinAshiCandles(candles)
      : this.chartSettings.chartStyle === "hlc"
        ? hlcCandles(candles)
        : candles;
    if (this.chartSettings.chartStyle === "close-line") {
      return transformed.map((candle, index) => ({
        time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any,
        value: candle.close,
        ...(trendBars?.[index]?.state
          ? { color: ATM1_COLORS[trendBars[index].state] }
          : {}),
      }));
    }
    return transformed.map((candle, index) => {
      const trendState = trendBars?.[index]?.state;
      const trendColor = trendState ? ATM1_COLORS[trendState] : null;
      return {
        time: (candle.time + CHINA_TIME_OFFSET_SECONDS) as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(trendColor
          ? {
              color: trendColor,
              borderColor: trendColor,
              wickColor: trendColor,
            }
          : {}),
      };
    });
  }

  private createChart() {
    const theme = marketTheme(isDarkTheme());
    const chartTheme = this.chartSettings.themes[isDarkTheme() ? "dark" : "light"];
    this.chart = createChart(this.chartElement, {
      width: Math.max(this.chartElement.clientWidth, 1),
      height: Math.max(this.chartElement.clientHeight, 1),
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.backgroundColor },
        textColor: theme.text,
        fontSize: 11,
        fontFamily: MARKET_FONT_FAMILY,
        panes: {
          enableResize: true,
          separatorColor: theme.paneSeparator,
          separatorHoverColor: theme.paneSeparatorHover,
        },
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: chartTheme.verticalGridVisible, color: chartTheme.verticalGridColor },
        horzLines: { visible: chartTheme.horizontalGridVisible, color: chartTheme.horizontalGridColor },
      },
      crosshair: {
        ...marketCrosshairOptions(theme),
        vertLine: {
          ...marketCrosshairOptions(theme).vertLine,
          color: chartTheme.crosshairColor,
          labelBackgroundColor: chartTheme.crosshairColor,
        },
        horzLine: {
          ...marketCrosshairOptions(theme).horzLine,
          color: chartTheme.crosshairColor,
          labelBackgroundColor: chartTheme.crosshairColor,
        },
      },
      rightPriceScale: {
        mode: this.chartPriceScaleMode(),
        autoScale: tradingPriceScaleUsesAutoScale(this.chartSettings.priceScaleMode),
        borderColor: theme.border,
        ensureEdgeTickMarksVisible: true,
        textColor: theme.text,
        scaleMargins: { top: 0, bottom: 0 },
      },
      timeScale: {
        visible: false,
        borderColor: theme.border,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
        tickMarkFormatter: (timeValue: any) =>
          chartTickLabel(Number(timeValue), this.activeInterval),
        rightBarStaysOnScroll: this.chartSettings.scaleAnchor === "cursor",
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: { time: true, price: false },
        mouseWheel: true,
        pinch: true,
      },
    });
    this.bandUpperSeries = this.chart.addSeries(AreaSeries, {
      topColor: theme.band,
      bottomColor: theme.band,
      lineColor: theme.bandLine,
      lineWidth: 1,
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.bandLowerSeries = this.chart.addSeries(AreaSeries, {
      topColor: chartTheme.backgroundColor,
      bottomColor: chartTheme.backgroundColor,
      lineColor: theme.bandLine,
      lineWidth: 1,
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.addPrimarySeries();
    this.createMainIndicatorSeries();
    this.chart.subscribeCrosshairMove((parameter: any) => {
      if (typeof parameter?.time === "number") {
        const sourceTime = parameter.time - CHINA_TIME_OFFSET_SECONDS;
        const candle = this.chartCandles.find((candidate) => candidate.time === sourceTime);
        if (candle) this.renderOhlc(candle, parameter.time);
      }
      this.updateCrosshairTimeLabel(parameter);
      this.updateCrosshairPriceLabel(parameter);
      this.updateMainIndicatorLegends(parameter?.time);
      this.updateIndicatorLegends(parameter?.seriesData);
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
      if (
        this.resettingChartViewport
        || this.updatingChartData
        || this.rebuildingIndicatorPanes
      ) return;
      if (range?.from < 10) void this.loadMoreHistory();
      this.synchronizeVisibleChartGeometry();
      this.queueVisiblePriceScaleUpdate();
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.applyOptions({
        width: Math.max(this.chartElement.clientWidth, 1),
        height: Math.max(this.chartElement.clientHeight, 1),
      });
      window.requestAnimationFrame(() => {
        this.positionLayoutPicker();
        this.positionIndicatorLegends();
        this.updateCurrentPriceLabel();
        this.paintAlertSimulationMarker();
        this.renderVolumeProfile(false);
        this.drawingController?.redraw();
      });
    });
    this.resizeObserver.observe(this.chartElement);
    const drawingController = new TradingDrawingController({
      host: this.host,
      chartElement: this.chartElement,
      overlay: this.drawingLayer,
      getChart: () => this.chart,
      getCandleSeries: () => this.candleSeries,
      getSymbol: () => this.selectedMarketId,
      getInterval: () => this.activeInterval,
      getCandles: () => this.chartCandles,
      timeOffsetSeconds: CHINA_TIME_OFFSET_SECONDS,
      storageSessionId: this.drawingStorageSessionId,
      resolveControlTarget: () => this.activeDrawingController ?? this.drawingController,
      onSharedToolStateChanged: (state, source) => this.syncDrawingSharedToolState(state, source),
      onSurfaceFocus: (source) => this.activateDrawingController(source),
      onDrawingStateChanged: () => { this.recordLastDrawingWorkspace(); this.queueAlertDrawingSync(); },
      onAiDrawingContextsChanged: (context) => {
        const contextMarket = context
          ? this.markets.find((market) => market.id === context.marketId)
            || (this.selectedMarketId === context.marketId ? this.selectedMarketMeta : null)
          : null;
        saveTradingLastAnalysisContext(
          window.localStorage,
          this.drawingStorageSessionId,
          context
            ? {
                schemaVersion: 1,
                marketId: context.marketId,
                interval: context.interval,
                updatedAt: Date.now(),
                ...(contextMarket ? { market: tradingFavoriteRecord(contextMarket) } : {}),
              }
            : null,
        );
      },
    });
    this.drawingController = drawingController;
    this.activeDrawingController = drawingController;
    drawingController.setOrderLines(this.displayedOrderLines());
  }

  syncAccountOrderLines(snapshot: TradingOrderLineAccountSnapshot | null) {
    this.orderLines = buildTradingOrderLines(snapshot);
    this.applyOrderDisplaySettings();
  }

  private createMainIndicatorSeries() {
    if (!this.chart) return;
    const palette = mainIndicatorPalette(isDarkTheme());
    const addLine = (color: string, lineWidth: 1 | 2 = 2) => this.chart?.addSeries(LineSeries, {
      color,
      lineWidth,
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "",
    });
    const addReferenceWidthLines = (colors: string[]) =>
      colors.map((color, index) => addLine(color, index === 1 ? 2 : 1)).filter(Boolean);
    this.mainIndicatorSeries.set("ma", addReferenceWidthLines(palette.ma));
    this.mainIndicatorSeries.set("ema", addReferenceWidthLines(palette.ema));
    this.mainIndicatorSeries.set("boll", addReferenceWidthLines(palette.boll));
    this.mainIndicatorSeries.set("bbi", palette.bbi.map((color) => addLine(color)).filter(Boolean));
    this.applyMainIndicatorSeriesOptions();
  }

  private applyMainIndicatorSeriesOptions() {
    const keys: Partial<Record<TradingMainIndicatorId, string[]>> = {
      ma: ["short", "medium", "long"],
      ema: ["short", "medium", "long"],
      boll: ["upper", "middle", "lower"],
      bbi: ["bbi"],
    };
    Object.entries(keys).forEach(([id, seriesKeys]) => {
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("main", id as TradingMainIndicatorId)];
      this.mainIndicatorSeries.get(id as TradingMainIndicatorId)?.forEach((series, index) => {
        const style = setting?.series[seriesKeys[index]];
        if (style) series.applyOptions({ color: style.color, lineWidth: style.lineWidth });
      });
    });
  }

  private renderVolumeProfile(recalculate = false) {
    if (!this.chart || !this.candleSeries || !this.activeMainIndicators.includes("vpvr")) {
      this.invalidateVolumeProfileSnapshot();
      clearTradingVolumeProfileLayer(this.volumeProfileLayer);
      return;
    }
    const setting = this.indicatorSettings[tradingIndicatorSettingKey("main", "vpvr")];
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
    const visibleCandles = visibleCandlesInLogicalRange(this.chartCandles, logicalRange);
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
        const coordinate = Number(this.candleSeries?.priceToCoordinate(price));
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

  private setMainIndicatorSeriesData(
    id: TradingMainIndicatorId,
    candles: TradingCandle[],
    values: number[][],
  ) {
    const runtime = this.mainIndicatorSeries.get(id) ?? [];
    const seriesKeys: Partial<Record<TradingMainIndicatorId, string[]>> = {
      ma: ["short", "medium", "long"],
      ema: ["short", "medium", "long"],
      boll: ["upper", "middle", "lower"],
      bbi: ["bbi"],
    };
    const setting = this.indicatorSettings[tradingIndicatorSettingKey("main", id)];
    runtime.forEach((series, seriesIndex) => {
      const seriesKey = seriesKeys[id]?.[seriesIndex];
      if (seriesKey && setting?.series[seriesKey]?.visible === false) {
        series.setData([]);
        return;
      }
      const seriesValues = values[seriesIndex] ?? [];
      series.setData(seriesValues.flatMap((value, index) => {
        if (!Number.isFinite(value) || !candles[index]) return [];
        return [{
          time: (candles[index].time + CHINA_TIME_OFFSET_SECONDS) as any,
          value,
        }];
      }));
    });
  }

  private updateMainIndicatorData(candles: TradingCandle[]) {
    const closes = candles.map((candle) => candle.close);
    const isActive = (id: TradingMainIndicatorId) => this.activeMainIndicators.includes(id);
    const setting = (id: TradingMainIndicatorId) =>
      this.indicatorSettings[tradingIndicatorSettingKey("main", id)];
    const updateLineIndicator = (id: TradingMainIndicatorId, values: number[][]) => {
      this.mainIndicatorValues.set(id, values);
      this.setMainIndicatorSeriesData(id, candles, values);
    };
    updateLineIndicator(
      "ma",
      isActive("ma") ? setting("ma").parameters.map((period) => computeSma(closes, period)) : [],
    );
    updateLineIndicator(
      "ema",
      isActive("ema") ? setting("ema").parameters.map((period) => computeEma(closes, period)) : [],
    );
    const bollinger = isActive("boll")
      ? computeBollingerBands(closes, setting("boll").parameters[0], setting("boll").parameters[1])
      : null;
    updateLineIndicator(
      "boll",
      bollinger ? [bollinger.upper, bollinger.middle, bollinger.lower] : [],
    );
    updateLineIndicator(
      "bbi",
      isActive("bbi") ? [computeBbi(closes, setting("bbi").parameters)] : [],
    );

    const tdSetting = setting("td");
    const tdSignals = isActive("td") ? computeTdSequential(candles, tdSetting.parameters[0]) : [];
    const tdValues = new Array<number>(candles.length).fill(Number.NaN);
    this.tdIndicatorDirections = new Array(candles.length).fill(null);
    tdSignals.forEach((signal) => {
      tdValues[signal.index] = signal.count;
      this.tdIndicatorDirections[signal.index] = signal.direction;
    });
    this.mainIndicatorValues.set("td", tdSignals.length ? [tdValues] : []);
    const markers = tdSignals.filter((signal) => tdSetting.series[signal.direction]?.visible !== false).map((signal) => ({
      time: (candles[signal.index].time + CHINA_TIME_OFFSET_SECONDS) as any,
      position: signal.direction === "buy" ? "belowBar" : "aboveBar",
      color: tdSetting.series[signal.direction].color,
      shape: "circle",
      text: String(signal.count),
      size: 0.7,
    }));
    this.tdMarkers?.setMarkers(markers);
    this.updateMainIndicatorLegends();
  }

  private updateMainIndicatorLegends(timeValue?: number) {
    this.mainIndicatorLegendElement.replaceChildren();
    if (!this.activeMainIndicators.length) {
      this.renderAlertSimulationMainIndicatorLegends();
      return;
    }

    let candleIndex = this.chartCandles.length - 1;
    if (typeof timeValue === "number" && Number.isFinite(timeValue)) {
      const hoveredIndex = this.chartCandles.findIndex(
        (candle) => candle.time + CHINA_TIME_OFFSET_SECONDS === timeValue,
      );
      if (hoveredIndex >= 0) candleIndex = hoveredIndex;
    }
    const formatValue = (value: number) => Number.isFinite(value) ? formatOhlcPrice(value) : "--";
    const appendRow = (
      id: TradingMainIndicatorId,
      titleText: string,
      items: Array<{ label: string; value: number; color: string }>,
    ) => {
      if (!items.length) return;
      const row = document.createElement("div");
      row.className = "trading-market-main-indicator-legend";
      row.dataset.marketMainIndicatorLegend = id;
      const title = document.createElement("strong");
      title.textContent = titleText;
      row.append(title);
      items.forEach((item) => {
        const value = document.createElement("span");
        value.style.setProperty("--main-indicator-series-color", item.color);
        value.textContent = `${item.label}:${formatValue(item.value)}`;
        row.append(value);
      });
      this.mainIndicatorLegendElement.append(row);
    };
    const valueAt = (id: TradingMainIndicatorId, seriesIndex: number) =>
      this.mainIndicatorValues.get(id)?.[seriesIndex]?.[candleIndex] ?? Number.NaN;

    this.activeMainIndicators.forEach((id) => {
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("main", id)];
      if (id === "ma") {
        appendRow("ma", "MA", ["short", "medium", "long"].flatMap((key, index) =>
          setting.series[key].visible ? [{
            label: `MA(${setting.parameters[index]})`,
            value: valueAt("ma", index),
            color: setting.series[key].color,
          }] : []));
        return;
      }
      if (id === "ema") {
        appendRow("ema", "EMA", ["short", "medium", "long"].flatMap((key, index) =>
          setting.series[key].visible ? [{
            label: `EMA(${setting.parameters[index]})`,
            value: valueAt("ema", index),
            color: setting.series[key].color,
          }] : []));
        return;
      }
      if (id === "boll") {
        appendRow("boll", `BOLL(${setting.parameters.join(",")})`, [
          setting.series.middle.visible ? { label: "BOLL", value: valueAt("boll", 1), color: setting.series.middle.color } : null,
          setting.series.upper.visible ? { label: "UB", value: valueAt("boll", 0), color: setting.series.upper.color } : null,
          setting.series.lower.visible ? { label: "LB", value: valueAt("boll", 2), color: setting.series.lower.color } : null,
        ].filter((item): item is { label: string; value: number; color: string } => item !== null));
        return;
      }
      if (id === "bbi") {
        appendRow("bbi", "BBI", setting.series.bbi.visible ? [
          { label: `BBI(${setting.parameters.join(",")})`, value: valueAt("bbi", 0), color: setting.series.bbi.color },
        ] : []);
        return;
      }
      if (id === "vpvr") return;
      const direction = this.tdIndicatorDirections[candleIndex];
      const directionSetting = direction ? setting.series[direction] : null;
      appendRow("td", `TD(${setting.parameters[0]})`, directionSetting?.visible ? [
        {
          label: "TD",
          value: valueAt("td", 0),
          color: directionSetting.color,
        },
      ] : []);
    });
    this.renderAlertSimulationMainIndicatorLegends();
  }

  private rebuildIndicatorPanes() {
    if (!this.chart) return;
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    const restoreAlertSimulationIndicators = this.alertSimulationIndicatorRuntimes.length > 0;
    if (restoreAlertSimulationIndicators) this.detachAlertSimulationIndicators();
    this.rebuildingIndicatorPanes = true;
    try {
      // removePane() only detaches the visual pane in lightweight-charts. Its
      // series must be removed first or their old timestamps remain in the
      // shared time scale and corrupt the next interval's candle spacing.
      this.indicatorPanes.forEach((runtime) => {
        runtime.analysisMarkers?.setMarkers([]);
        runtime.analysisSeries.forEach((series) => {
          this.chart?.removeSeries(series);
        });
        runtime.series.forEach((seriesRuntime) => {
          this.chart?.removeSeries(seriesRuntime.api);
        });
      });
      const remainingPanes = this.chart.panes();
      for (let index = remainingPanes.length - 1; index >= 1; index -= 1) {
        this.chart.removePane(index);
      }
      this.indicatorPanes.clear();
      this.indicatorLegendLayer.replaceChildren();
      const visibleIndicators = this.activeIndicators.filter((id) => {
        const setting = this.indicatorSettings[tradingIndicatorSettingKey("sub", id)];
        return Object.values(setting.series).some((series) => series.visible);
      });
      this.chart.panes()[0]?.setStretchFactor(visibleIndicators.length ? 3 : 1);
      visibleIndicators.forEach((id) => this.createIndicatorPane(id));
      if (restoreAlertSimulationIndicators) {
        try {
          this.attachAlertSimulationIndicators();
        } catch (error) {
          console.error("[trading-alert] simulation indicator rebuild failed", error);
          this.detachAlertSimulationIndicators();
        }
        this.updateAlertSimulationIndicatorsSafely(this.alertSimulationState?.display.length || 0);
        this.paintAlertSimulationMarker();
      }
      if (this.alertSimulationState && this.alertSimulationSeries) {
        this.focusAlertSimulationViewport(this.alertSimulationState);
      } else if (visibleRange) {
        this.chart.timeScale().setVisibleLogicalRange(visibleRange);
      }
    } finally {
      this.rebuildingIndicatorPanes = false;
    }
    window.requestAnimationFrame(() => {
      this.positionIndicatorLegends();
      this.drawingController?.redraw();
    });
  }

  private createIndicatorPane(id: TradingIndicatorId) {
    if (!this.chart) return;
    const theme = marketTheme(isDarkTheme());
    const setting = this.indicatorSettings[tradingIndicatorSettingKey("sub", id)];
    const result = calculateTradingIndicator(id, this.candles, setting.parameters);
    const visibleSeries = result.series.filter((descriptor) => setting.series[descriptor.key]?.visible !== false);
    if (!visibleSeries.length) return;
    const pane = this.chart.addPane(false);
    pane.setStretchFactor(1);
    const runtime: IndicatorPaneRuntime = {
      id,
      pane,
      legend: null,
      series: [],
      analysisSeries: [],
      analysisMarkers: null,
      analysisSignature: "",
    };
    visibleSeries.forEach((descriptor) => {
      const seriesSetting = setting.series[descriptor.key];
      const commonOptions = {
        priceLineVisible: false,
        lastValueVisible: false,
        title: "",
        priceFormat: descriptor.priceFormat === "volume"
          ? { type: "volume" as const }
          : { type: "price" as const, precision: 2, minMove: 0.01 },
      };
      const api = descriptor.type === "histogram"
        ? pane.addSeries(HistogramSeries, {
            ...commonOptions,
            color: seriesSetting?.color ?? descriptor.color,
            base: descriptor.baseValue ?? 0,
          })
        : pane.addSeries(LineSeries, {
            ...commonOptions,
            color: seriesSetting?.color ?? descriptor.color,
            lineWidth: seriesSetting?.lineWidth ?? 2,
            crosshairMarkerVisible: false,
          });
      runtime.series.push({
        key: descriptor.key,
        api,
        label: descriptor.label,
        color: seriesSetting?.color ?? descriptor.color,
        latestValue: Number.NaN,
      });
    });
    runtime.series[0]?.api?.priceScale()?.applyOptions({
      autoScale: true,
      borderColor: theme.border,
      textColor: theme.text,
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
    runtime.legend = this.createIndicatorLegend(result, setting);
    this.indicatorPanes.set(id, runtime);
    this.renderIndicatorAnalysisPatch(id);
  }

  private indicatorAnalysisColor(colorToken: TradingAiDrawingColorToken) {
    const variable = TRADING_INDICATOR_AI_COLOR_VARIABLES[colorToken];
    const hostColor = variable ? getComputedStyle(this.host).getPropertyValue(variable).trim() : "";
    if (hostColor) return hostColor;
    const rootColor = variable ? getComputedStyle(document.documentElement).getPropertyValue(variable).trim() : "";
    if (rootColor) return rootColor;
    return isDarkTheme() ? "#c3a7ff" : "#6d4acb";
  }

  private clearIndicatorAnalysisRuntime(runtime: IndicatorPaneRuntime) {
    runtime.analysisMarkers?.setMarkers([]);
    runtime.analysisMarkers = null;
    runtime.analysisSeries.forEach((series) => {
      this.chart?.removeSeries(series);
    });
    runtime.analysisSeries = [];
    runtime.analysisSignature = "";
  }

  private renderIndicatorAnalysisPatch(id: TradingIndicatorId, force = false) {
    const runtime = this.indicatorPanes.get(id);
    if (!runtime || !this.chart || !runtime.series[0]) return;
    const patch = this.indicatorAnalysisPatches.get(id);
    const matchesContext = patch
      && patch.marketId === this.selectedMarketId
      && patch.interval === this.activeInterval;
    const signature = matchesContext
      ? `${patch.analysisId}:${isDarkTheme() ? "dark" : "light"}:${appLanguageLocale()}`
      : "";
    if (!force && runtime.analysisSignature === signature) return;
    this.clearIndicatorAnalysisRuntime(runtime);
    if (!patch || !matchesContext) return;

    const markers: any[] = [];
    patch.operations.forEach(({ drawing }, operationIndex) => {
      const color = this.indicatorAnalysisColor(drawing.colorToken);
      if (drawing.tool === "path") {
        const lineWidth = Math.max(1, Math.min(4, Math.round(Number(drawing.lineWidth) || 1))) as 1 | 2 | 3 | 4;
        const series = runtime.pane.addSeries(LineSeries, {
          color,
          lineWidth,
          lineStyle: tradingIndicatorAiLineStyle(drawing.lineStyle),
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "",
          priceFormat: { type: "price" as const, precision: 4, minMove: 0.0001 },
        });
        series.setData(
          strictlyAscendingTradingIndicatorPathPoints(drawing.points)
            .map((point) => ({
              time: (point.time + CHINA_TIME_OFFSET_SECONDS) as UTCTimestamp,
              value: point.value,
            })),
        );
        runtime.analysisSeries.push(series);
        return;
      }
      const point = drawing.points[0];
      if (!point || (!drawing.text && drawing.markerSize === undefined)) return;
      const usesExactIndicatorAnchor = drawing.markerSize !== undefined;
      markers.push({
        time: (point.time + CHINA_TIME_OFFSET_SECONDS) as UTCTimestamp,
        position: usesExactIndicatorAnchor
          ? drawing.markerSize === 0
            ? "atPriceMiddle"
            : drawing.text
            ? operationIndex % 2 === 0 ? "atPriceTop" : "atPriceBottom"
            : "atPriceMiddle"
          : operationIndex % 2 === 0 ? "aboveBar" : "belowBar",
        ...(usesExactIndicatorAnchor ? { price: point.value } : {}),
        color,
        shape: "circle",
        ...(drawing.text ? { text: translateTradingAnnotationText(drawing.text) } : {}),
        ...(drawing.markerSize !== undefined ? { size: drawing.markerSize } : {}),
      });
    });
    if (markers.length) {
      markers.sort((first, second) => Number(first.time) - Number(second.time));
      runtime.analysisMarkers = createSeriesMarkers(runtime.series[0].api, markers.slice(id === "rsi" || id === "kdj" ? -16 : -8), {
        autoScale: false,
        zOrder: "aboveSeries",
      });
    }
    runtime.analysisSignature = signature;
    runtime.series[0]?.api?.priceScale()?.setAutoScale(true);
  }

  private renderIndicatorAnalysisPatches(force = false) {
    this.indicatorPanes.forEach((_runtime, id) => this.renderIndicatorAnalysisPatch(id, force));
  }

  acceptIndicatorAnalysisDrawingPatch(value: TradingIndicatorAiDrawingPatch) {
    if (this.disposed) return false;
    const patch = normalizeTradingIndicatorAiDrawingPatch(value);
    const indicatorId = patch.indicatorId as TradingIndicatorId;
    const definition = TRADING_MARKET_INDICATOR_CATALOG.find((item) => (
      item.scope === "sub" && item.id === indicatorId
    ));
    if (!definition) throw new TypeError(`Unsupported indicator drawing target: ${patch.indicatorId}`);
    this.indicatorAnalysisPatches.set(indicatorId, patch);
    if (!this.indicatorPanes.has(indicatorId)) {
      this.ensureChartIndicatorVisible("sub", indicatorId);
    }
    this.renderIndicatorAnalysisPatch(indicatorId, true);
    return true;
  }

  private createIndicatorLegend(result: TradingIndicatorResult, setting: TradingIndicatorSetting) {
    const legend = document.createElement("div");
    legend.className = "trading-market-indicator-legend";
    const title = document.createElement("strong");
    title.textContent = `${result.definition.label}${setting.parameters.length ? ` (${setting.parameters.join(",")})` : ""}`;
    legend.append(title);
    result.series.filter((descriptor) => setting.series[descriptor.key]?.visible !== false).forEach((descriptor) => {
      const value = document.createElement("span");
      value.dataset.indicatorSeries = descriptor.key;
      value.style.setProperty("--indicator-series-color", setting.series[descriptor.key]?.color ?? descriptor.color);
      value.textContent = `${descriptor.label}: --`;
      legend.append(value);
    });
    this.indicatorLegendLayer.append(legend);
    return legend;
  }

  private positionIndicatorLegends() {
    const viewportRect = this.viewport.getBoundingClientRect();
    this.indicatorPanes.forEach((runtime) => {
      const paneElement = runtime.pane?.getHTMLElement?.() as HTMLElement | null;
      if (!paneElement || !runtime.legend) return;
      const paneRect = paneElement.getBoundingClientRect();
      runtime.legend.style.top = `${Math.max(paneRect.top - viewportRect.top + 7, 0)}px`;
    });
    this.alertSimulationIndicatorRuntimes.forEach((runtime) => {
      const paneElement = runtime.pane?.getHTMLElement?.() as HTMLElement | null;
      if (!paneElement || !runtime.legend) return;
      const paneRect = paneElement.getBoundingClientRect();
      runtime.legend.style.top = `${Math.max(paneRect.top - viewportRect.top + 7, 0)}px`;
    });
  }

  private updateIndicatorData(candles: TradingCandle[]) {
    this.activeIndicators.forEach((id) => {
      const runtime = this.indicatorPanes.get(id);
      if (!runtime) return;
      const setting = this.indicatorSettings[tradingIndicatorSettingKey("sub", id)];
      const result = calculateTradingIndicator(id, candles, setting.parameters);
      result.series.forEach((descriptor) => {
        const seriesRuntime = runtime.series.find((series) => series.key === descriptor.key);
        if (!seriesRuntime) return;
        const data = descriptor.values.flatMap<Record<string, unknown>>((value, index) => {
          if (!Number.isFinite(value) || !candles[index]) return [];
          const time = (candles[index].time + CHINA_TIME_OFFSET_SECONDS) as any;
          return [{
            time,
            value,
            ...(descriptor.colors?.[index] ? { color: descriptor.colors[index] } : {}),
          }];
        });
        seriesRuntime.api.setData(data);
        seriesRuntime.latestValue = Number.NaN;
        for (let index = descriptor.values.length - 1; index >= 0; index -= 1) {
          if (Number.isFinite(descriptor.values[index])) {
            seriesRuntime.latestValue = descriptor.values[index];
            break;
          }
        }
      });
      // The chart's rightPriceScale is intentionally manual for the main K-line
      // pane. Subchart panes inherit that default, so explicitly restore their
      // own automatic range after every complete data replacement.
      runtime.series[0]?.api?.priceScale()?.setAutoScale(true);
    });
    this.updateIndicatorLegends();
  }

  private updateIndicatorLegends(seriesData?: Map<any, any>) {
    this.indicatorPanes.forEach((runtime) => {
      if (!runtime.legend) return;
      runtime.series.forEach((seriesRuntime, index) => {
        const current = seriesData?.get(seriesRuntime.api);
        const value = Number(current?.value ?? current?.high ?? seriesRuntime.latestValue);
        const target = runtime.legend?.querySelectorAll<HTMLElement>("span")[index];
        if (target) target.textContent = `${seriesRuntime.label}: ${Number.isFinite(value)
          ? this.formatIndicatorValue(value, runtime.id)
          : "--"}`;
      });
    });
  }

  private formatIndicatorValue(value: number, id: TradingIndicatorId) {
    if (id === "volume" || id === "obv") return formatCompactValue(value, 2);
    const absolute = Math.abs(value);
    if (absolute >= 1000) return formatCompactValue(value, 2);
    if (absolute > 0 && absolute < 0.01) return value.toFixed(4);
    return value.toFixed(2);
  }

  private applyChartTheme() {
    if (!this.chart) return;
    const theme = marketTheme(isDarkTheme());
    const themeName: TradingChartThemeName = isDarkTheme() ? "dark" : "light";
    const chartTheme = this.chartSettings.themes[themeName];
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.backgroundColor },
        textColor: theme.text,
        fontFamily: MARKET_FONT_FAMILY,
        panes: {
          enableResize: true,
          separatorColor: theme.paneSeparator,
          separatorHoverColor: theme.paneSeparatorHover,
        },
      },
      grid: {
        vertLines: { visible: chartTheme.verticalGridVisible, color: chartTheme.verticalGridColor },
        horzLines: { visible: chartTheme.horizontalGridVisible, color: chartTheme.horizontalGridColor },
      },
      crosshair: {
        ...marketCrosshairOptions(theme),
        vertLine: {
          ...marketCrosshairOptions(theme).vertLine,
          color: chartTheme.crosshairColor,
          labelBackgroundColor: chartTheme.crosshairColor,
        },
        horzLine: {
          ...marketCrosshairOptions(theme).horzLine,
          color: chartTheme.crosshairColor,
          labelBackgroundColor: chartTheme.crosshairColor,
        },
      },
      rightPriceScale: {
        mode: this.chartPriceScaleMode(),
        autoScale: tradingPriceScaleUsesAutoScale(this.chartSettings.priceScaleMode),
        borderColor: theme.border,
        ensureEdgeTickMarksVisible: true,
        textColor: theme.text,
        scaleMargins: {
          top: this.chartSettings.verticalPaddingPercent / 100,
          bottom: this.chartSettings.verticalPaddingPercent / 100,
        },
      },
      timeScale: {
        visible: false,
        borderColor: theme.border,
        rightBarStaysOnScroll: this.chartSettings.scaleAnchor === "cursor",
      },
    });
    this.indicatorPanes.forEach((runtime) => {
      runtime.series[0]?.api?.priceScale()?.applyOptions({
        borderColor: theme.border,
        textColor: theme.text,
      });
    });
    this.renderIndicatorAnalysisPatches(true);
    this.bandUpperSeries?.applyOptions({
      topColor: theme.band,
      bottomColor: theme.band,
      lineColor: theme.bandLine,
    });
    this.bandLowerSeries?.applyOptions({
      topColor: chartTheme.backgroundColor,
      bottomColor: chartTheme.backgroundColor,
      lineColor: theme.bandLine,
    });
    const simulationColors = isDarkTheme()
      ? { up: "rgba(91, 156, 255, 0.72)", down: "rgba(255, 173, 66, 0.74)", upBorder: "#7eb2ff", downBorder: "#ffc06b" }
      : { up: "rgba(29, 78, 216, 0.62)", down: "rgba(180, 83, 9, 0.66)", upBorder: "#1d4ed8", downBorder: "#b45309" };
    this.alertSimulationSeries?.applyOptions({
      upColor: simulationColors.up,
      downColor: simulationColors.down,
      borderUpColor: simulationColors.upBorder,
      borderDownColor: simulationColors.downBorder,
      wickUpColor: simulationColors.upBorder,
      wickDownColor: simulationColors.downBorder,
    });
    this.alertSimulationHistorySeries?.applyOptions({
      upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
      downColor: this.chartSettings.fallingColor,
      borderVisible: this.chartSettings.showCandleBorder,
      borderUpColor: this.chartSettings.risingColor,
      borderDownColor: this.chartSettings.fallingColor,
      wickVisible: this.chartSettings.showWicks,
      wickUpColor: this.chartSettings.risingColor,
      wickDownColor: this.chartSettings.fallingColor,
    });
    this.alertEvidenceCandleSeries?.applyOptions({
      upColor: this.chartSettings.hollowRising ? "rgba(0,0,0,0)" : this.chartSettings.risingColor,
      downColor: this.chartSettings.fallingColor,
      borderVisible: this.chartSettings.showCandleBorder,
      borderUpColor: this.chartSettings.risingColor,
      borderDownColor: this.chartSettings.fallingColor,
      wickVisible: this.chartSettings.showWicks,
      wickUpColor: this.chartSettings.risingColor,
      wickDownColor: this.chartSettings.fallingColor,
    });
    this.applyPrimarySeriesOptions();
    this.applyMainIndicatorSeriesOptions();
    this.updateChartData();
    this.applyAlertSimulationIndicatorTheme();
    this.paintAlertSimulationMarker();
    this.drawingController?.redraw();
    this.splitPanes.forEach((pane) => pane.updateSettings(this.chartSettings, themeName));
  }

  private clearChart() {
    this.invalidateVolumeProfileSnapshot();
    this.clearAlertEvidenceCandleSeries();
    this.clearAlertEvidenceIndicatorTargets();
    this.alertEvidencePoint = null;
    if (this.alertEvidenceAnnotation) this.alertEvidenceAnnotation.hidden = true;
    this.candleSeries?.setData([]);
    this.bandUpperSeries?.setData([]);
    this.bandLowerSeries?.setData([]);
    this.mainIndicatorSeries.forEach((seriesList) => {
      seriesList.forEach((series) => series.setData([]));
    });
    this.mainIndicatorValues.clear();
    this.tdIndicatorDirections = [];
    this.tdMarkers?.setMarkers([]);
    this.indicatorPanes.forEach((runtime) => {
      runtime.series.forEach((series) => {
        series.api.setData([]);
        series.latestValue = Number.NaN;
      });
    });
    this.hideCrosshairTimeLabel();
    this.hideCrosshairPriceLabel();
    this.currentPriceElement.hidden = true;
    this.hideCandleCountdown();
    clearTradingVolumeProfileLayer(this.volumeProfileLayer);
    this.mainIndicatorLegendElement.replaceChildren();
    this.updateIndicatorLegends();
    this.chartCandles = [];
    this.lockedPriceRange = null;
    if (this.priceLine && this.candleSeries) {
      this.candleSeries.removePriceLine(this.priceLine);
      this.priceLine = null;
    }
    this.ohlcElement.innerHTML = "";
  }

  private clearMarketError() {
    this.errorElement.hidden = true;
    this.errorElement.dataset.marketAction = "retry";
    this.errorElement.removeAttribute("aria-label");
  }

  private updateChartData(options: { resetViewport?: boolean; preserveViewport?: boolean } = {}) {
    if (!this.chart || !this.candleSeries || !this.candles.length) return;
    const resetViewport = options.resetViewport === true;
    const preservedLogicalRange = !resetViewport && options.preserveViewport === true
      ? this.chart.timeScale().getVisibleLogicalRange()
      : null;
    if (resetViewport) {
      this.invalidateVolumeProfileSnapshot();
      this.prepareChartViewportReset();
    }
    const deduped = mergeCandles([], this.candles);
    this.chartCandles = deduped;
    const trendBandEnabled = this.trendBandEnabled;
    const trendBars = trendBandEnabled ? atm1TrendCandles(deduped) : null;
    const display = this.primarySeriesData(deduped, trendBars);
    this.updatingChartData = true;
    try {
      this.candleSeries.setData(display);
      const band = atm4MaBand(deduped);
      this.bandUpperSeries?.setData(atm4BandSeriesData(band, "bandUpper", trendBandEnabled));
      this.bandLowerSeries?.setData(atm4BandSeriesData(band, "bandLower", trendBandEnabled));
      this.updateMainIndicatorData(deduped);
      this.updateIndicatorData(deduped);
      this.renderIndicatorAnalysisPatches();
      const lastRaw = deduped[deduped.length - 1];
      this.applyMarketPriceFormat(lastRaw.close);
      const lineColor = lastRaw.close >= lastRaw.open
        ? this.chartSettings.risingColor
        : this.chartSettings.fallingColor;
      if (this.priceLine) this.candleSeries.removePriceLine(this.priceLine);
      this.priceLine = this.chartSettings.showPriceLine
        ? this.candleSeries.createPriceLine({
            price: lastRaw.close,
            color: lineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
            axisLabelColor: lineColor,
            axisLabelTextColor: "#ffffff",
          })
        : null;
      this.renderLatestOhlc();
      if (this.alertSimulationState && this.alertSimulationSeries) {
        // Live candle refreshes preserve the current viewport by default. A
        // simulation focus request can still be pending in the chart's render
        // queue at that moment, so restoring the captured pre-simulation range
        // would repeatedly push the trigger off-screen. The simulation range
        // is authoritative until its isolated overlay is cleared.
        this.focusAlertSimulationViewport(this.alertSimulationState);
      } else if (preservedLogicalRange) {
        this.chart.timeScale().setVisibleLogicalRange(preservedLogicalRange);
      }
    } finally {
      this.updatingChartData = false;
    }
    // Initial login can receive live candles after the bootstrap REST request
    // has already exposed its retry state. A successfully rendered candle set
    // is authoritative and must retire that stale error action.
    this.clearMarketError();
    if (resetViewport) {
      this.applyInitialChartViewport();
      this.resettingChartViewport = false;
      this.queueVisiblePriceScaleUpdate();
    } else {
      this.synchronizeVisibleChartGeometry();
    }
    this.lastLiveChartFullRefreshAt = Date.now();
    this.updateCountdown();
  }

  private prepareChartViewportReset() {
    if (!this.chart) return;
    this.resettingChartViewport = true;
    if (this.priceLockAnimationFrame !== null) {
      window.cancelAnimationFrame(this.priceLockAnimationFrame);
      this.priceLockAnimationFrame = null;
    }
    if (this.drawingSettleAnimationFrame !== null) {
      window.cancelAnimationFrame(this.drawingSettleAnimationFrame);
      this.drawingSettleAnimationFrame = null;
    }
    this.cancelVolumeProfileWheelTracking();
    this.lockedPriceRange = null;
    this.chart.priceScale("right", 0).setAutoScale(true);
  }

  private applyInitialChartViewport() {
    if (!this.chart) return;
    const logicalRange = initialMarketLogicalRange(this.chartCandles.length, this.activeInterval);
    if (!logicalRange) return;
    this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.updateVisiblePriceScale();
    this.updateCurrentPriceLabel();
    this.paintAlertSimulationMarker();
    this.renderVolumeProfile(true);
    this.drawingController?.redraw();
  }

  private focusChartLookback(lookbackMs: number) {
    if (!this.chart || !this.chartCandles.length) return;
    const intervalMs = tradingViewResolutionDurationMs(this.activeInterval);
    if (!intervalMs) return;
    const visibleBars = Math.max(1, Math.min(
      this.chartCandles.length,
      Math.ceil(lookbackMs / intervalMs),
    ));
    const logicalRange = {
      from: this.chartCandles.length - visibleBars,
      to: this.chartCandles.length + 2,
    };
    this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.updateVisiblePriceScale();
    this.updateCurrentPriceLabel();
    this.drawingController?.redraw();
  }

  private async focusAnalysisDrawingPatch(patch: TradingAiDrawingPatch) {
    if (!this.chart || !this.chartCandles.length) return;
    const priceScaleWidth = Number(this.chart.priceScale("right", 0).width() || 0);
    const plotWidth = Math.max(this.chartElement.clientWidth - priceScaleWidth, 1);
    const logicalRange = tradingAnalysisDrawingFocusRange(patch, this.chartCandles, plotWidth);
    if (!logicalRange) return;
    this.invalidateVolumeProfileSnapshot();
    this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.updateVisiblePriceScale();
    this.updateCurrentPriceLabel();
    this.renderVolumeProfile(true);
    this.drawingController?.redraw();
    this.queueVisiblePriceScaleUpdate();
    await waitForTradingAnalysisViewportPaint(window);
    if (this.disposed) return;
    this.drawingController?.redraw();
  }

  private updateVisiblePriceScale() {
    if (!this.chart) return;
    if (tradingPriceScaleUsesAutoScale(this.chartSettings.priceScaleMode)) {
      this.lockedPriceRange = null;
      this.chart.priceScale("right", 0).setAutoScale(true);
      return;
    }
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
    const visibleCandles = visibleCandlesInLogicalRange(this.chartCandles, logicalRange);
    const priceRange = fixedPriceScaleRange(
      visibleCandles,
      this.chartSettings.verticalPaddingPercent / 100,
    );
    if (!priceRange) return;
    this.lockedPriceRange = priceRange;
    this.enforceLockedPriceScale();
  }

  private enforceLockedPriceScale() {
    if (!this.chart) return;
    const priceScale = this.chart.priceScale("right", 0);
    if (tradingPriceScaleUsesAutoScale(this.chartSettings.priceScaleMode)) {
      this.lockedPriceRange = null;
      priceScale.setAutoScale(true);
      return;
    }
    if (!this.lockedPriceRange) return;
    priceScale.setAutoScale(false);
    const currentRange = priceScale.getVisibleRange();
    if (
      currentRange?.from === this.lockedPriceRange.from
      && currentRange.to === this.lockedPriceRange.to
    ) return;
    priceScale.setVisibleRange(this.lockedPriceRange);
  }

  private synchronizeVisibleChartGeometry() {
    if (
      this.resettingChartViewport
      || this.updatingChartData
      || this.rebuildingIndicatorPanes
    ) return;
    this.updateVisiblePriceScale();
    this.updateCurrentPriceLabel();
    this.paintAlertSimulationMarker();
    this.renderVolumeProfile(false);
    this.drawingController?.redraw();
  }

  private trackVolumeProfileThroughWheelScale() {
    if (!this.chart || !this.activeMainIndicators.includes("vpvr")) return;
    this.volumeProfileWheelFramesRemaining = TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES;
    if (this.volumeProfileWheelAnimationFrame !== null) return;
    const redraw = () => {
      this.volumeProfileWheelAnimationFrame = null;
      if (this.disposed) {
        this.volumeProfileWheelFramesRemaining = 0;
        return;
      }
      if (
        !this.resettingChartViewport
        && !this.updatingChartData
        && !this.rebuildingIndicatorPanes
      ) this.renderVolumeProfile(false);
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

  private queueVisiblePriceScaleUpdate() {
    if (
      this.resettingChartViewport
      || this.updatingChartData
      || this.rebuildingIndicatorPanes
      || this.priceLockAnimationFrame !== null
    ) return;
    this.priceLockAnimationFrame = window.requestAnimationFrame(() => {
      this.priceLockAnimationFrame = null;
      this.synchronizeVisibleChartGeometry();
      if (this.drawingSettleAnimationFrame !== null) {
        window.cancelAnimationFrame(this.drawingSettleAnimationFrame);
      }
      this.drawingSettleAnimationFrame = window.requestAnimationFrame(() => {
        this.drawingSettleAnimationFrame = null;
        this.synchronizeVisibleChartGeometry();
      });
    });
  }

  private finishChartPan() {
    if (
      this.chartPanPointerId !== null
      && this.chartElement.hasPointerCapture?.(this.chartPanPointerId)
    ) {
      this.chartElement.releasePointerCapture(this.chartPanPointerId);
    }
    this.chartPanPointerId = null;
    this.chartPanStartRange = null;
    this.chartElement.classList.remove("horizontal-panning");
    this.queueVisiblePriceScaleUpdate();
  }

  private renderLatestOhlc() {
    const candle = this.candles[this.candles.length - 1];
    if (!candle) {
      this.ohlcElement.replaceChildren();
      return;
    }
    this.renderOhlc(candle, candle.time + CHINA_TIME_OFFSET_SECONDS);
  }

  private updateCrosshairTimeLabel(parameter: any) {
    const x = Number(parameter?.point?.x);
    if (!Number.isFinite(x)) return;
    const parameterLogical = parameter?.logical;
    const logical = typeof parameterLogical === "number" && Number.isFinite(parameterLogical)
      ? parameterLogical
      : this.chart?.timeScale().coordinateToLogical(x);
    const timeValue = resolveMarketCrosshairTime(
      parameter?.time,
      logical,
      this.chartCandles,
      this.activeInterval,
    );
    if (timeValue === null) return;
    this.crosshairTimeElement.textContent = formatOhlcDateTime(timeValue);
    this.crosshairTimeElement.hidden = false;
    const halfWidth = Math.ceil(this.crosshairTimeElement.offsetWidth / 2);
    const padding = 6;
    const minimum = halfWidth + padding;
    const maximum = Math.max(minimum, this.chartElement.clientWidth - halfWidth - padding);
    this.crosshairTimeElement.style.left = `${Math.min(Math.max(x, minimum), maximum)}px`;
  }

  private hideCrosshairTimeLabel() {
    this.crosshairTimeElement.hidden = true;
    this.crosshairTimeElement.style.removeProperty("left");
  }

  private updateCrosshairPriceLabel(parameter: any) {
    const y = Number(parameter?.point?.y);
    const price = Number.isFinite(y) && this.candleSeries
      ? Number(this.candleSeries.coordinateToPrice(y))
      : Number.NaN;
    if (!Number.isFinite(price)) return;
    this.crosshairPriceElement.textContent = formatFocusedPrice(price);
    this.positionFocusPriceLabel(this.crosshairPriceElement, y);
  }

  private updateCurrentPriceLabel() {
    const candle = this.chartCandles[this.chartCandles.length - 1];
    const y = candle && this.candleSeries
      ? Number(this.candleSeries.priceToCoordinate(candle.close))
      : Number.NaN;
    if (!candle || !Number.isFinite(y)) {
      this.currentPriceElement.hidden = true;
      this.hideCandleCountdown();
      return;
    }
    const livePriceColor = candle.close >= candle.open
      ? this.chartSettings.risingColor
      : this.chartSettings.fallingColor;
    this.currentPriceElement.style.setProperty("--trading-market-live-price-color", livePriceColor);
    this.candleCountdownElement.style.setProperty("--trading-market-live-price-color", livePriceColor);
    if (this.chartSettings.showPriceLabel) {
      this.currentPriceElement.textContent = formatFocusedPrice(candle.close);
      this.positionFocusPriceLabel(this.currentPriceElement, y);
    } else {
      this.currentPriceElement.hidden = true;
    }
    this.positionCandleCountdown(y);
  }

  private positionCandleCountdown(y: number) {
    if (!this.chartSettings.showCountdown || !this.chart) {
      this.hideCandleCountdown();
      return;
    }
    const chartHeight = this.chartElement.clientHeight;
    if (!Number.isFinite(y) || chartHeight <= 0) {
      this.hideCandleCountdown();
      return;
    }
    const priceScaleWidth = Math.max(this.chart.priceScale("right", 0).width(), 64);
    const priceLabelHalfHeight = 12;
    const countdownHeight = 19;
    const priceCenterY = Math.min(
      Math.max(y, priceLabelHalfHeight),
      Math.max(priceLabelHalfHeight, chartHeight - priceLabelHalfHeight),
    );
    let placement: "above" | "below" | "standalone" = "standalone";
    let top = Math.min(
      Math.max(priceCenterY - countdownHeight / 2, 0),
      Math.max(chartHeight - countdownHeight, 0),
    );
    if (this.chartSettings.showPriceLabel) {
      const belowTop = priceCenterY + priceLabelHalfHeight;
      const aboveTop = priceCenterY - priceLabelHalfHeight - countdownHeight;
      if (belowTop + countdownHeight <= chartHeight) {
        placement = "below";
        top = belowTop;
      } else if (aboveTop >= 0) {
        placement = "above";
        top = aboveTop;
      }
    }
    this.candleCountdownElement.dataset.placement = placement;
    this.candleCountdownElement.style.left = `${Math.max(this.chartElement.clientWidth - priceScaleWidth, 0)}px`;
    this.candleCountdownElement.style.width = `${priceScaleWidth}px`;
    this.candleCountdownElement.style.top = `${top}px`;
    this.candleCountdownElement.hidden = false;
  }

  private hideCandleCountdown() {
    this.candleCountdownElement.hidden = true;
    this.candleCountdownElement.removeAttribute("aria-label");
    this.candleCountdownElement.removeAttribute("datetime");
    delete this.candleCountdownElement.dataset.placement;
    this.candleCountdownElement.style.removeProperty("left");
    this.candleCountdownElement.style.removeProperty("width");
    this.candleCountdownElement.style.removeProperty("top");
  }

  private positionFocusPriceLabel(element: HTMLElement, y: number) {
    if (!this.chart) return;
    const priceScaleWidth = Math.max(this.chart.priceScale("right", 0).width(), 64);
    const labelHalfHeight = 12;
    const top = Math.min(
      Math.max(y, labelHalfHeight),
      Math.max(labelHalfHeight, this.chartElement.clientHeight - labelHalfHeight),
    );
    element.style.left = `${Math.max(this.chartElement.clientWidth - priceScaleWidth, 0)}px`;
    element.style.width = `${priceScaleWidth}px`;
    element.style.top = `${top}px`;
    element.hidden = false;
  }

  private hideCrosshairPriceLabel() {
    this.crosshairPriceElement.hidden = true;
    this.crosshairPriceElement.style.removeProperty("top");
  }

  private renderOhlc(bar: any, timeValue: number) {
    const open = Number(bar.open || 0);
    const high = Number(bar.high || 0);
    const low = Number(bar.low || 0);
    const close = Number(bar.close || 0);
    const change = close - open;
    const changePercent = open ? (change / open) * 100 : 0;
    const amplitudePercent = open ? ((high - low) / open) * 100 : 0;
    const tone = change >= 0 ? "positive" : "negative";
    const item = (label: string, value: string) => `
      <span class="trading-market-ohlc-item"><span>${label}</span><b class="${tone}">${value}</b></span>
    `;
    this.ohlcElement.innerHTML = `
      <time>${formatOhlcDateTime(timeValue)}</time>
      ${item("开", formatOhlcPrice(open))}
      ${item("高", formatOhlcPrice(high))}
      ${item("低", formatOhlcPrice(low))}
      ${item("收", formatOhlcPrice(close))}
      ${item("涨幅", `${changePercent.toFixed(2)}%(${formatOhlcPrice(change)})`)}
      ${item("振幅", `${amplitudePercent.toFixed(2)}%`)}
    `;
  }

  private async loadMoreHistory() {
    if (this.loadingHistory || !this.candles.length) return;
    const generation = this.loadGeneration;
    const targetSymbol = this.selectedSymbol;
    const targetProvider = this.selectedProvider;
    const targetAssetClass = this.selectedAssetClass;
    const targetMarketType = this.selectedMarketType;
    const targetInterval = this.activeInterval;
    this.loadingHistory = true;
    try {
      const oldestTime = this.candles[0].time * 1000;
      const history = await this.fetchHistoricalCandleBatch({
        symbol: targetSymbol,
        provider: targetProvider,
        assetClass: targetAssetClass,
        marketType: targetMarketType,
        interval: targetInterval,
        count: 300,
        endTime: oldestTime - 1,
        signal: this.marketDataRequestAbortController?.signal,
      });
      if (
        !this.disposed
        && generation === this.loadGeneration
        && targetSymbol === this.selectedSymbol
        && targetProvider === this.selectedProvider
        && targetInterval === this.activeInterval
      ) {
        this.sourceCandles = mergeCandles(history.sourceCandles, this.sourceCandles);
        this.candles = mergeCandles(history.candles, this.candles);
        this.updateChartData();
      }
    } catch (error) {
      if (!this.disposed && generation === this.loadGeneration) {
        console.error("加载历史K线失败", error);
      }
    } finally {
      if (generation !== this.loadGeneration) return;
      if (this.historyCooldownTimer !== null) window.clearTimeout(this.historyCooldownTimer);
      this.historyCooldownTimer = window.setTimeout(() => {
        this.loadingHistory = false;
      }, 1800);
    }
  }

  private async fetchHistoricalCandleBatch(options: {
    symbol: string;
    provider: TradingMarketProvider;
    assetClass: TradingAssetClass;
    marketType: TradingMarketType;
    interval: string;
    count: number;
    endTime: number;
    signal?: AbortSignal;
  }): Promise<TradingCandleBatch> {
    if (options.provider === "binance") {
      return fetchTradingCandles(
        options.symbol,
        options.interval,
        options.count,
        options.endTime,
        options.marketType === "spot" ? "spot" : "perpetual",
        options.signal,
      );
    }
    const api = options.provider === "ifind"
      ? window.codexDesktop.getIfindMarketCandles
      : window.codexDesktop.getFinnhubMarketCandles;
    if (!api) throw new Error("当前版本缺少行情桥。");
    const response = await api({
      symbol: options.symbol,
      assetClass: options.assetClass,
      resolution: options.interval,
      count: options.count,
      endTime: options.endTime,
    });
    if (response?.ok !== true) throw new Error(String(response?.message || "历史行情加载失败"));
    const targetMs = tradingViewResolutionDurationMs(options.interval) || 60_000;
    return {
      candles: this.normalizeRemoteCandles(response.candles),
      sourceCandles: [],
      source: { targetMs, sourceInterval: null, sourceMs: null },
    };
  }

  private setLoading(loading: boolean) {
    this.marketLoading = loading;
    this.loadingElement.hidden = !loading;
    this.host.setAttribute("aria-busy", String(loading));
  }

  private closeSocket() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    unsubscribeBinanceMarketStreams(this.marketStreamSubscriptionId);
    this.marketStreamSubscriptionId = null;
    this.marketSocketLastActivityAt = 0;
  }

  private cancelScheduledLiveChartPaint() {
    if (this.liveChartPaintTimer !== null) {
      window.clearTimeout(this.liveChartPaintTimer);
      this.liveChartPaintTimer = null;
    }
    if (this.liveChartPaintFrame !== null) {
      window.cancelAnimationFrame(this.liveChartPaintFrame);
      this.liveChartPaintFrame = null;
    }
  }

  ensureChartIndicatorVisible(scope: "main" | "sub", id: string, parameters: number[] = []) {
    const definition = TRADING_MARKET_INDICATOR_CATALOG.find((item) => item.scope === scope && item.id === id);
    if (!definition) return false;
    const current = this.indicatorSettings[tradingIndicatorSettingKey(definition.scope, definition.id)];
    if (!current) return false;
    current.enabled = true;
    if (parameters.length === definition.parameters.length && parameters.every(Number.isFinite)) {
      current.parameters = [...parameters];
    }
    this.indicatorSettings = normalizeTradingIndicatorSettings(this.indicatorSettings);
    this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
    this.syncActiveIndicatorsFromSettings();
    this.persistIndicatorSettings();
    this.updateMainIndicatorButtons();
    this.updateIndicatorButtons();
    this.applyMainIndicatorSeriesOptions();
    this.rebuildIndicatorPanes();
    this.invalidateVolumeProfileSnapshot();
    this.updateChartData({ preserveViewport: true });
    this.splitPanes.forEach((pane) => pane.updateIndicatorSettings(this.indicatorSettings));
    return true;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;
    this.marketDataRequestAbortController?.abort();
    this.marketDataRequestAbortController = null;
    this.marketListRenderGeneration += 1;
    this.favoriteTickerGeneration += 1;
    this.detachAlertSimulation();
    this.closeSocket();
    this.cancelScheduledLiveChartPaint();
    this.closeFavoriteTickerStreams();
    if (this.marketRateLimitRetryTimer !== null) window.clearTimeout(this.marketRateLimitRetryTimer);
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    if (this.candlePollTimer !== null) window.clearInterval(this.candlePollTimer);
    if (this.candleCachePersistTimer !== null) {
      window.clearTimeout(this.candleCachePersistTimer);
      this.candleCachePersistTimer = null;
      this.persistCurrentMarketCandleSnapshot();
    }
    if (this.alertDrawingSyncTimer !== null) window.clearTimeout(this.alertDrawingSyncTimer);
    if (this.historyCooldownTimer !== null) window.clearTimeout(this.historyCooldownTimer);
    if (this.finnhubSearchTimer !== null) window.clearTimeout(this.finnhubSearchTimer);
    if (this.ifindSearchTimer !== null) window.clearTimeout(this.ifindSearchTimer);
    if (this.marketListRenderTimer !== null) {
      window.clearTimeout(this.marketListRenderTimer);
      this.marketListRenderTimer = null;
    }
    if (this.priceLockAnimationFrame !== null) window.cancelAnimationFrame(this.priceLockAnimationFrame);
    if (this.drawingSettleAnimationFrame !== null) {
      window.cancelAnimationFrame(this.drawingSettleAnimationFrame);
    }
    this.cancelVolumeProfileWheelTracking();
    if (this.marketListScrollRestoreFrame !== null) {
      window.cancelAnimationFrame(this.marketListScrollRestoreFrame);
    }
    if (this.favoriteTickerPaintFrame !== null) {
      window.cancelAnimationFrame(this.favoriteTickerPaintFrame);
      this.favoriteTickerPaintFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.activeDrawingController = null;
    this.splitPanes.forEach((pane) => pane.destroy());
    this.splitPanes = [];
    this.drawingController?.destroy();
    this.drawingController = null;
    this.host.removeEventListener("click", this.handleClick);
    this.favoriteTickerBar.removeEventListener("click", this.handleFavoriteTickerClick);
    this.favoriteTickerBar.removeEventListener("keydown", this.handleFavoriteTickerKeyDown);
    this.favoriteTickerBar.removeEventListener("wheel", this.handleFavoriteTickerScrollWheel);
    this.favoriteTickerSortController.destroy();
    this.favoriteTickerBar.remove();
    this.host.removeEventListener("input", this.handleIndicatorEditorInput);
    this.host.removeEventListener("change", this.handleIndicatorEditorInput);
    this.host.removeEventListener("input", this.handleChartSettingsInput);
    this.host.removeEventListener("change", this.handleChartSettingsInput);
    this.host.removeEventListener("error", this.handleMarketLogoError, true);
    this.periodItems.removeEventListener("pointerdown", this.handlePeriodPointerDown);
    this.periodTimes.removeEventListener("pointerdown", this.handlePeriodScrollPointerDown);
    this.periodTimes.removeEventListener("pointermove", this.handlePeriodScrollPointerMove);
    this.periodTimes.removeEventListener("pointerup", this.handlePeriodScrollPointerUp);
    this.periodTimes.removeEventListener("pointercancel", this.handlePeriodScrollPointerCancel);
    this.periodTimes.removeEventListener("wheel", this.handlePeriodScrollWheel);
    this.periodTimes.removeEventListener("focusin", this.handlePeriodScrollFocusIn);
    this.chartElement.removeEventListener("pointerdown", this.handleChartPanPointerDown);
    this.chartElement.removeEventListener("pointermove", this.handleChartPanPointerMove);
    this.chartElement.removeEventListener("pointerup", this.handleChartPanPointerUp);
    this.chartElement.removeEventListener("pointercancel", this.handleChartPanPointerCancel);
    this.chartElement.removeEventListener("wheel", this.handleChartWheel, { capture: true });
    document.removeEventListener("pointermove", this.handlePeriodPointerMove);
    document.removeEventListener("pointerup", this.handlePeriodPointerUp);
    document.removeEventListener("pointercancel", this.handlePeriodPointerCancel);
    this.search.removeEventListener("input", this.handleSearch);
    this.marketList.removeEventListener("scroll", this.handleMarketListScroll);
    this.indicatorCatalog.removeEventListener("scroll", this.handleIndicatorEditorScroll);
    this.indicatorDetail.removeEventListener("scroll", this.handleIndicatorEditorScroll);
    this.indicatorScrollTimers.forEach((timer) => window.clearTimeout(timer));
    this.indicatorScrollTimers.clear();
    this.viewport.removeEventListener("pointerleave", this.handleViewportLeave);
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.chart?.remove();
    this.chart = null;
  }
}

function formatMarketPrice(value: number) {
  return formatTradingMarketTickerPrice(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

let activeWorkspace: TradingExpertMarketWorkspace | null = null;
let activeWorkspaceHost: HTMLElement | null = null;
let activeWorkspaceFavoriteStorageAccountIdentity = "";

async function commitTradingAnalysisDrawingPatch(
  job: TradingAnalysisJobContext,
  patch: TradingAiDrawingPatch,
  paneIndex = 0,
  onPhase?: (phase: TradingAiPlaybackPhase) => void,
) {
  const currentJob = tradingAnalysisJobs.get(job.analysisId);
  if (!currentJob || currentJob.status !== "running") {
    throw new Error("交易分析已由用户停止");
  }
  const targetWorkspace = activeWorkspace;
  if (
    targetWorkspace
    && targetWorkspace.drawingStorageSessionMatches(currentJob.storageSessionId)
  ) {
    await targetWorkspace.acceptAnalysisDrawingPatch(patch, paneIndex, onPhase);
    // The workspace may be promoted from a local draft id to a persisted thread id
    // while playback is running. Keep a single durable exit path below.
  }
  const latestJob = tradingAnalysisJobs.get(job.analysisId);
  if (!latestJob || latestJob.status !== "running") {
    throw new Error("交易分析已由用户停止");
  }
  const storageSessionId = paneIndex > 0
    ? tradingSplitPaneDrawingStorageSessionId(latestJob.storageSessionId, paneIndex)
    : latestJob.storageSessionId;
  persistTradingAiDrawingPatch(storageSessionId, patch);
  if (
    activeWorkspace
    && activeWorkspace.drawingStorageSessionMatches(latestJob.storageSessionId)
    && activeWorkspace.analysisDrawingTargetMatches(patch, paneIndex)
  ) {
    activeWorkspace.storeAnalysisDrawingPatch(patch, paneIndex);
  }
}

async function commitTradingIndicatorAnalysisDrawingPatch(
  job: TradingAnalysisJobContext,
  patch: TradingIndicatorAiDrawingPatch,
) {
  const currentJob = tradingAnalysisJobs.get(job.analysisId);
  if (!currentJob || currentJob.status !== "running") {
    throw new Error("交易分析已由用户停止");
  }
  const targetWorkspace = activeWorkspace;
  if (
    !targetWorkspace
    || !targetWorkspace.drawingStorageSessionMatches(currentJob.storageSessionId)
  ) {
    throw new Error("MACD 副图绘制目标已失效");
  }
  targetWorkspace.acceptIndicatorAnalysisDrawingPatch(patch);
  const latestJob = tradingAnalysisJobs.get(job.analysisId);
  if (!latestJob || latestJob.status !== "running") {
    throw new Error("交易分析已由用户停止");
  }
}

function rememberTradingAnalysisJobContext(job: TradingAnalysisJobContext) {
  saveTradingLastAnalysisContext(window.localStorage, job.storageSessionId, {
    schemaVersion: 1,
    marketId: job.marketId,
    interval: job.interval,
    updatedAt: Date.now(),
    ...(job.market ? { market: job.market as unknown as TradingFavoriteMarketRecord } : {}),
  });
}

export function syncTradingExpertMarketWorkspace(
  host: HTMLElement | null,
  favoriteStorageAccountIdentity = "",
  drawingStorageSessionId = "",
  migrateDrawingsFromSessionId = "",
) {
  if (
    host === activeWorkspaceHost
    && activeWorkspace
    && favoriteStorageAccountIdentity === activeWorkspaceFavoriteStorageAccountIdentity
  ) {
    activeWorkspace.syncTitlebarFavoriteTickerHost();
    activeWorkspace.syncDrawingStorageSession(
      drawingStorageSessionId,
      migrateDrawingsFromSessionId,
    );
    activeWorkspace.restorePreservedViewState();
    return;
  }
  activeWorkspace?.destroy();
  activeWorkspace = null;
  activeWorkspaceHost = host;
  activeWorkspaceFavoriteStorageAccountIdentity = favoriteStorageAccountIdentity;
  if (host) {
    activeWorkspace = new TradingExpertMarketWorkspace(
      host,
      favoriteStorageAccountIdentity,
      drawingStorageSessionId,
    );
  }
}

export function syncTradingExpertOrderLineSnapshot(
  snapshot: TradingOrderLineAccountSnapshot | null,
) {
  activeWorkspace?.syncAccountOrderLines(snapshot);
}

export function migrateTradingExpertMarketWorkspaceStorageSession(
  previousStorageSessionId: string,
  nextStorageSessionId: string,
) {
  if (
    !activeWorkspace
    || !previousStorageSessionId
    || !nextStorageSessionId
    || previousStorageSessionId === nextStorageSessionId
    || !activeWorkspace.drawingStorageSessionMatches(previousStorageSessionId)
  ) {
    return false;
  }
  activeWorkspace.syncDrawingStorageSession(nextStorageSessionId, previousStorageSessionId);
  return activeWorkspace.drawingStorageSessionMatches(nextStorageSessionId);
}

export function tradingExpertMarketWorkspaceStorageSessionId() {
  return activeWorkspace?.drawingStorageSession() || "";
}

export function tradingExpertAlertContextSnapshot() {
  return activeWorkspace?.alertContextSnapshot() || null;
}

export async function prepareTradingExpertAlertContext(marketId?: string | null, interval?: string | null) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.prepareAlertContext(marketId, interval);
}

export async function tradingExpertAlertSimulationFrames(rule: any) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.alertSimulationFrames(rule);
}

export function focusTradingExpertAlertEvidence(evidence: any, rule?: any) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.focusAlertEvidence(evidence, rule);
}

export function showTradingExpertAlertSimulation(
  simulation: any,
  anchorContextId: string,
  rule?: any,
  options: TradingAlertSimulationShowOptions = {},
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.showAlertSimulation(simulation, anchorContextId, rule, options);
}

export function clearTradingExpertAlertSimulation() {
  activeWorkspace?.clearAlertSimulation();
}

export function applyTradingExpertCustomIndicatorMentions(text: string) {
  if (!activeWorkspace) return false;
  return activeWorkspace.setTrendBandEnabled(hasTradingExpertTrendBandMention(text));
}

export function ensureTradingExpertChartIndicatorVisible(
  descriptor?: { id: string; scope: "main" | "sub"; parameters?: number[] } | null,
) {
  if (!activeWorkspace || !descriptor) return false;
  return activeWorkspace.ensureChartIndicatorVisible(descriptor.scope, descriptor.id, descriptor.parameters || []);
}

export function hasTradingExpertCurrentAnalysis(
  theory?: string,
) {
  return activeWorkspace?.hasCurrentAnalysis(theory) === true;
}

export function tradingExpertPersonalStrategyCandles() {
  return activeWorkspace?.personalStrategyCandles() || [];
}

export function prepareTradingExpertMarketForExternalCapture() {
  return activeWorkspace?.prepareForExternalCapture() === true;
}

export async function cancelTradingExpertAnalysis(analysisId: string) {
  const normalizedAnalysisId = String(analysisId || "").trim();
  if (!normalizedAnalysisId) return false;
  const cancelled = tradingAnalysisJobs.cancel(normalizedAnalysisId);
  if (!cancelled) return false;
  await window.codexDesktop.cancelTradingAnalysis?.({
    analysisJobId: normalizedAnalysisId,
  }).catch(() => undefined);
  return true;
}

export async function runTradingExpertChanConversation(
  request: TradingChanConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runChanConversation(request);
}

export async function runTradingExpertOrderFlowConversation(
  request: TradingOrderFlowConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runOrderFlowConversation(request);
}

export async function runTradingExpertWaveConversation(
  request: TradingWaveConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runWaveConversation(request);
}

export async function runTradingExpertWyckoffConversation(
  request: TradingWyckoffConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runWyckoffConversation(request);
}

const BUILTIN_TRADING_STRATEGY_CONVERSATION_RUNNERS = Object.freeze({
  chan: (request: TradingStrategyConversationRequest) => runTradingExpertChanConversation({
    ...request,
    onProgress: request.onProgress as TradingChanConversationRequest["onProgress"],
  }),
  "order-flow": (request: TradingStrategyConversationRequest) => runTradingExpertOrderFlowConversation({
    ...request,
    onProgress: request.onProgress as TradingOrderFlowConversationRequest["onProgress"],
  }),
  wave: (request: TradingStrategyConversationRequest) => runTradingExpertWaveConversation({
    ...request,
    onProgress: request.onProgress as TradingWaveConversationRequest["onProgress"],
  }),
  wyckoff: (request: TradingStrategyConversationRequest) => runTradingExpertWyckoffConversation({
    ...request,
    onProgress: request.onProgress as TradingWyckoffConversationRequest["onProgress"],
  }),
});

export async function runTradingExpertStrategyConversation(
  strategyId: string,
  request: TradingStrategyConversationRequest,
): Promise<TradingStrategyConversationResult> {
  const runner = BUILTIN_TRADING_STRATEGY_CONVERSATION_RUNNERS[
    strategyId as keyof typeof BUILTIN_TRADING_STRATEGY_CONVERSATION_RUNNERS
  ];
  if (runner) return runner(request) as Promise<TradingStrategyConversationResult>;
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runGeneralConversation(request, strategyId) as Promise<TradingStrategyConversationResult>;
}

export async function runTradingExpertGeneralConversation(
  request: TradingGeneralConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runGeneralConversation(request);
}
