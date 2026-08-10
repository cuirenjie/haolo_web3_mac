import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
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
  renderTradingDrawingLayer,
  renderTradingDrawingToolbar,
} from "./trading-expert-drawing.ts";
import type { TradingAiDrawingPatch, TradingAiPlaybackPhase } from "./trading-expert-ai-playback.ts";
import {
  TRADING_WAVE_AUTO_EXPANSION_MAX_CANDLES,
  TRADING_WAVE_HISTORY_BATCH_CANDLES,
  runTradingWaveAnalysisWithAutoExpansion,
  type TradingWaveExpansionEvent,
} from "./trading-expert-wave-expansion.ts";

const BINANCE_FUTURES_REST_URL = "https://fapi.binance.com";
const BINANCE_FUTURES_WS_URL = "wss://fstream.binance.com/ws";
const BINANCE_SPOT_REST_URL = "https://data-api.binance.vision";
const BINANCE_SPOT_WS_URL = "wss://stream.binance.com:9443/ws";
const BINANCE_ASSET_LOGO_URL = "https://bin.bnbstatic.com/static/assets/logos";
const HYPERLIQUID_ASSET_LOGO_URL = "https://app.hyperliquid.xyz/coins";
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_INTERVAL = "1D";
const MARKET_QUOTE = "USDT";
const MARKET_VENUE = "币安";
const MARKET_PRICE_FORMAT = { type: "price", precision: 2, minMove: 0.01 } as const;
const MARKET_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", Arial, sans-serif';
const TRADING_PERIODS_STORAGE_KEY = "haolo.trading-market.periods.v1";
const TRADING_FAVORITES_STORAGE_KEY = "haolo.trading-market.favorites.v1";
const TRADING_FAVORITE_MARKETS_STORAGE_KEY = "haolo.trading-market.favorite-records.v1";
const TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v3";
const LEGACY_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v2";
const OLDEST_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo.trading-market.indicator-settings.v1";
export const TRADING_EXPERT_TREND_BAND_MENTION = "@自定义指标:趋势带";
const MAX_TRADING_PERIODS = 10;
const MAX_TRADING_FAVORITES = 500;
export const MAX_TRADING_FAVORITE_TICKERS = 6;
const FAVORITE_TICKER_FALLBACK_INTERVAL_MS = 4_000;
const FAVORITE_TICKER_FALLBACK_TIMEOUT_MS = 8_000;
const FAVORITE_TICKER_SOCKET_STALE_MS = 5_000;
const FAVORITE_TICKER_SOCKET_WATCHDOG_MS = 12_000;
const FINNHUB_SEARCH_DEBOUNCE_MS = 480;
const GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE = "目前版本此交易对数据还未接入";

export function hasTradingExpertTrendBandMention(text: string) {
  return String(text || "").includes(TRADING_EXPERT_TREND_BAND_MENTION);
}

type TradingMarketProvider = "binance" | "finnhub" | "ifind";
type TradingAssetClass = "crypto" | "stock" | "index" | "forex";
type TradingMarketType = "perpetual" | "spot" | "global";
interface TradingChanAnalysisResponse {
  ok?: boolean;
  error?: { code?: string; message?: string; retryable?: boolean };
  analysisPlan?: {
    narrative?: string;
    report?: string;
    drawingPatch?: TradingAiDrawingPatch;
  };
  model?: {
    providerId?: string;
    modelId?: string;
    latencyMs?: number;
  };
}
export type TradingChanConversationPhase = "loading" | "analyzing" | "drawing" | "complete";
export interface TradingChanConversationRequest {
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
  instruction: string;
  symbol?: string | null;
  interval?: string | null;
  lookbackMs?: number | null;
  lookbackLabel?: string | null;
  drawingRequested?: boolean;
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
export type TradingMainIndicatorId = "ma" | "ema" | "boll" | "td" | "bbi";
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
      enabled: false,
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

export function ifindSupportsTradingResolution(resolution: string) {
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
    const assetClass: TradingAssetClass = ["crypto", "stock", "index", "forex"].includes(String(item.assetClass))
      ? item.assetClass as TradingAssetClass
      : provider === "binance" ? "crypto" : "stock";
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
      venue: String(item.venue || (provider === "binance" ? MARKET_VENUE : provider === "ifind" ? "A股市场" : "Finnhub"))
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
  const symbols = normalizeTradingFavoriteSymbols(snapshot.symbols).sort();
  const symbolSet = new Set(symbols);
  const records = normalizeTradingFavoriteMarketRecords(snapshot.records)
    .filter((record) => symbolSet.has(record.id))
    .sort((first, second) => first.id.localeCompare(second.id));
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
  const assetClass: TradingAssetClass = ["crypto", "stock", "index", "forex"].includes(String(item.assetClass))
    ? item.assetClass as TradingAssetClass
    : "stock";
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
  const displaySymbol = String(item.displaySymbol || symbol.split(".", 1)[0]).trim().slice(0, 96);
  const markPrice = Number(item.markPrice || 0);
  const changePercent = Number(item.changePercent || 0);
  return {
    id: `IFIND:${symbol}`,
    provider: "ifind",
    symbol,
    baseAsset: displaySymbol,
    quoteAsset: "",
    displaySymbol,
    description: String(item.description || displaySymbol).replace(/[\r\n\0]+/g, " ").trim().slice(0, 160),
    venue: String(item.venue || "A股市场").replace(/[\r\n\0]+/g, " ").trim().slice(0, 80),
    assetClass: "stock",
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

export function tradingFavoriteTickerStreamUrl(
  marketType: Extract<TradingMarketType, "spot" | "perpetual">,
  symbols: Iterable<string>,
) {
  const streams = [...new Set([...symbols]
    .map((symbol) => String(symbol || "").trim().toLowerCase())
    .filter((symbol) => /^[a-z0-9]+$/.test(symbol)))]
    .map((symbol) => `${symbol}@ticker`);
  const rawUrl = marketType === "spot" ? BINANCE_SPOT_WS_URL : BINANCE_FUTURES_WS_URL;
  return `${rawUrl.replace(/\/ws$/, "/stream")}?streams=${streams.join("/")}`;
}

function defaultBinancePerpetualMarket(): TradingMarket {
  return {
    id: `BINANCE:FUTURES:${DEFAULT_SYMBOL}`,
    provider: "binance",
    symbol: DEFAULT_SYMBOL,
    baseAsset: "BTC",
    quoteAsset: MARKET_QUOTE,
    displaySymbol: `BTC/${MARKET_QUOTE}`,
    description: `BTC/${MARKET_QUOTE} 币安永续合约`,
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
  const url = new URL(path, BINANCE_FUTURES_REST_URL);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Binance Futures request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchBinanceSpot<T>(
  path: string,
  parameters: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, BINANCE_SPOT_REST_URL);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Binance Spot request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

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

export async function fetchTradingMarkets() {
  const [futuresExchangeInfo, futuresTickers, spotExchangeInfo, spotTickers] = await Promise.all([
    fetchBinanceFutures<BinanceExchangeInfo>("/fapi/v1/exchangeInfo"),
    fetchBinanceFutures<BinanceTicker24h[]>("/fapi/v1/ticker/24hr"),
    fetchBinanceSpot<BinanceExchangeInfo>("/api/v3/exchangeInfo", {
      permissions: "SPOT",
      symbolStatus: "TRADING",
    }),
    fetchBinanceSpot<BinanceTicker24h[]>("/api/v3/ticker/24hr", { type: "MINI" }),
  ]);
  const futuresTickerBySymbol = new Map(
    futuresTickers.map((ticker) => [String(ticker.symbol || ""), ticker]),
  );
  const futuresMarkets: TradingMarket[] = (futuresExchangeInfo.symbols ?? []).flatMap((item) => {
    const symbol = String(item.symbol || "");
    const baseAsset = String(item.baseAsset || "");
    const quoteAsset = String(item.quoteAsset || "");
    if (
      !symbol
      || !baseAsset
      || quoteAsset !== MARKET_QUOTE
      || item.contractType !== "PERPETUAL"
      || item.status !== "TRADING"
    ) return [];
    const ticker = futuresTickerBySymbol.get(symbol);
    return [{
      id: `BINANCE:FUTURES:${symbol}`,
      provider: "binance",
      symbol,
      baseAsset,
      quoteAsset,
      displaySymbol: `${baseAsset}/${quoteAsset}`,
      description: `${baseAsset}/${quoteAsset} 币安永续合约`,
      venue: MARKET_VENUE,
      assetClass: "crypto",
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
    if (
      !symbol
      || !baseAsset
      || quoteAsset !== MARKET_QUOTE
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
      description: `${baseAsset}/${quoteAsset} 币安现货`,
      venue: MARKET_VENUE,
      assetClass: "crypto",
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

async function fetchTradingCandles(
  symbol: string,
  resolution: string,
  count = 500,
  endTime = Date.now(),
  marketType: Extract<TradingMarketType, "perpetual" | "spot"> = "perpetual",
): Promise<TradingCandleBatch> {
  const source = binanceResolutionSource(resolution);
  if (!source) throw new Error(`Unsupported TradingView resolution: ${resolution}`);
  if (!source.sourceInterval || !source.sourceMs) {
    const trades = await fetchBinanceAggregateTrades(symbol, marketType, { endTime });
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
    const items = await fetchBinanceMarket<unknown[][]>(marketType, "/fapi/v1/klines", "/api/v3/klines", {
      symbol,
      interval: source.sourceInterval,
      endTime: cursor,
      limit,
    });
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

async function fetchBinanceAggregateTrades(
  symbol: string,
  marketType: Extract<TradingMarketType, "perpetual" | "spot">,
  options: { endTime?: number; fromId?: number } = {},
) {
  return fetchBinanceMarket<BinanceAggregateTrade[]>(marketType, "/fapi/v1/aggTrades", "/api/v3/aggTrades", {
    symbol,
    endTime: options.endTime === undefined ? undefined : Math.floor(options.endTime),
    fromId: options.fromId,
    limit: 1_000,
  });
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
): Promise<TradingCandleBatch> {
  const source = binanceResolutionSource(resolution);
  if (!source) throw new Error(`Unsupported TradingView resolution: ${resolution}`);
  if (!source.sourceInterval || !source.sourceMs) {
    const trades = await fetchBinanceAggregateTrades(symbol, marketType, fromTradeId
      ? { fromId: fromTradeId }
      : { endTime: Date.now() });
    return {
      candles: aggregateBinanceTrades(trades, source.targetMs),
      sourceCandles: [],
      source,
      lastTradeId: Number(trades.at(-1)?.a || 0) || undefined,
    };
  }
  const items = await fetchBinanceMarket<unknown[][]>(marketType, "/fapi/v1/klines", "/api/v3/klines", {
    symbol,
    interval: source.sourceInterval,
    startTime: sourceStartTime,
    limit: sourceStartTime === undefined ? 2 : marketType === "spot" ? 1_000 : 1_500,
  });
  const sourceCandles = normalizeBinanceCandles(items);
  return {
    candles: source.sourceMs === source.targetMs
      ? sourceCandles
      : aggregateTradingCandles(sourceCandles, source.targetMs),
    sourceCandles,
    source,
  };
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

function symbolBadge(symbol: string) {
  if (symbol === "BTC") return "₿";
  return symbol.slice(0, 2).toUpperCase();
}

export function binanceAssetLogoUrl(asset: string) {
  return `${BINANCE_ASSET_LOGO_URL}/${encodeURIComponent(asset.trim().toUpperCase())}.png`;
}

function hyperliquidAssetLogoUrl(asset: string) {
  return `${HYPERLIQUID_ASSET_LOGO_URL}/${encodeURIComponent(asset.trim().toUpperCase())}.svg`;
}

function renderMarketAssetLogo(
  asset: string,
  provider: TradingMarketProvider = "binance",
  current = false,
) {
  const normalizedAsset = asset.trim().toUpperCase();
  return `
    <span class="trading-market-asset-logo provider-${provider}${current ? " current" : ""}" data-market-logo-shell aria-hidden="true">
      <span data-market-logo-fallback>${escapeHtml(symbolBadge(normalizedAsset))}</span>
      ${provider === "binance" ? `<img
        src="${escapeAttribute(binanceAssetLogoUrl(normalizedAsset))}"
        alt=""
        loading="${current ? "eager" : "lazy"}"
        decoding="async"
        referrerpolicy="no-referrer"
        data-market-logo
        data-market-logo-asset="${escapeAttribute(normalizedAsset)}"
        data-market-logo-stage="binance"
      />` : ""}
    </span>
  `;
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
            ${renderMarketAssetLogo("BTC", "binance", true)}
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
            <div class="trading-market-picker-head">
              <span>名称</span><span>平台</span><span>最新价</span><span>24H涨幅</span><span>收藏</span>
            </div>
            <div class="trading-market-list" data-market-list role="list" aria-label="永续合约币种"></div>
          </div>
        </div>
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
          <div class="trading-market-times" data-market-times aria-label="K线周期">${renderTimeButtons()}</div>
          ${renderPeriodEditorShell()}
        </div>
          </div>
          <div class="trading-market-chart-panel">
          <div class="trading-market-chart-viewport" data-market-chart-viewport>
            <div class="trading-market-chart" data-market-chart></div>
            ${renderTradingDrawingLayer()}
            <time class="trading-market-crosshair-time" data-market-crosshair-time hidden></time>
            <div class="trading-market-focus-price crosshair" data-market-crosshair-price hidden></div>
            <div class="trading-market-focus-price current" data-market-current-price hidden></div>
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
          </div>
        </div>
      </div>
      ${renderIndicatorEditorShell()}
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
  private readonly picker: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly marketList: HTMLElement;
  private readonly favoriteTickerBar: HTMLElement;
  private readonly indicatorLegendLayer: HTMLElement;
  private readonly mainIndicatorLegendElement: HTMLElement;
  private readonly periodControls: HTMLElement;
  private readonly periodTimes: HTMLElement;
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
  private chart: ReturnType<typeof createChart> | null = null;
  private candleSeries: any = null;
  private bandUpperSeries: any = null;
  private bandLowerSeries: any = null;
  private priceLine: any = null;
  private lockedPriceRange: { from: number; to: number } | null = null;
  private priceLockAnimationFrame: number | null = null;
  private drawingSettleAnimationFrame: number | null = null;
  private resettingChartViewport = false;
  private updatingChartData = false;
  private rebuildingIndicatorPanes = false;
  private marketListScrollRestoreFrame: number | null = null;
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
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private favoriteTickerSockets: WebSocket[] = [];
  private favoriteTickerReconnectTimer: number | null = null;
  private favoriteTickerGeneration = 0;
  private favoriteTickerPaintFrame: number | null = null;
  private favoriteTickerFallbackTimer: number | null = null;
  private favoriteTickerFallbackPending = false;
  private favoriteTickerFallbackAbortController: AbortController | null = null;
  private favoriteTickerSocketWatchdogs = new Map<WebSocket, number>();
  private favoriteTickerSocketUpdatesByMarketId = new Map<string, number>();
  private favoriteTickerOpenPricesById = new Map<string, number>();
  private countdownTimer: number | null = null;
  private pollTimer: number | null = null;
  private candlePollTimer: number | null = null;
  private refreshingLiveCandleGeneration: number | null = null;
  private loadGeneration = 0;
  private loadingHistory = false;
  private historyCooldownTimer: number | null = null;
  private disposed = false;
  private marketLoading = true;
  private chanAnalysisGeneration = 0;
  private chanAnalysisActive = false;
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
  private favoriteTickerMarketsById = new Map<string, TradingMarket>();
  private showFavoritesOnly = false;
  private finnhubConfigured = false;
  private finnhubSearchPending = false;
  private ifindConfigured = false;
  private ifindSearchPending = false;
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
  private drawingController: TradingDrawingController | null = null;

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
    this.picker = this.requireElement("[data-market-picker]");
    this.search = this.requireElement<HTMLInputElement>("[data-market-search]");
    this.marketList = this.requireElement("[data-market-list]");
    this.favoriteTickerBar = this.requireElement("[data-market-favorite-tickers]");
    this.indicatorLegendLayer = this.requireElement("[data-market-indicator-legends]");
    this.mainIndicatorLegendElement = this.requireElement("[data-market-main-indicator-legends]");
    this.periodControls = this.requireElement("[data-market-period-controls]");
    this.periodTimes = this.requireElement("[data-market-times]");
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
    this.periods = this.loadTradingPeriods();
    const storedFavorites = this.loadFavoriteStorage();
    this.favoriteSymbols = new Set(storedFavorites.symbols);
    this.favoriteMarketRecords = new Map(
      storedFavorites.records.map((record) => [record.id, record]),
    );
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
    this.updateCountdown();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
    void this.loadMarkets();
    void this.loadFinnhubStatus();
    void this.loadIfindStatus();
    void this.restartMarketData();
  }

  private requireElement<T extends Element = HTMLElement>(selector: string) {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Trading market element missing: ${selector}`);
    return element;
  }

  private bindEvents() {
    this.host.addEventListener("click", this.handleClick);
    this.host.addEventListener("input", this.handleIndicatorEditorInput);
    this.host.addEventListener("change", this.handleIndicatorEditorInput);
    this.host.addEventListener("error", this.handleMarketLogoError, true);
    this.periodItems.addEventListener("pointerdown", this.handlePeriodPointerDown);
    this.chartElement.addEventListener("pointerdown", this.handleChartPanPointerDown);
    this.chartElement.addEventListener("pointermove", this.handleChartPanPointerMove);
    this.chartElement.addEventListener("pointerup", this.handleChartPanPointerUp);
    this.chartElement.addEventListener("pointercancel", this.handleChartPanPointerCancel);
    this.chartElement.addEventListener("wheel", this.handleChartWheel, { passive: true });
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
    this.themeObserver = new MutationObserver(() => this.applyChartTheme());
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
    if (action === "toggle-symbols") {
      this.setPickerOpen(this.picker.hidden);
      return;
    }
    if (action === "toggle-period-editor") {
      this.setPeriodEditorOpen(this.periodEditor.hidden);
      return;
    }
    if (action === "toggle-indicator-editor") {
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
      if (!interval || interval === this.activeInterval) return;
      if (this.selectedProvider === "ifind" && !ifindSupportsTradingResolution(interval)) return;
      this.activeInterval = interval;
      this.updateIntervalPressedButtons(interval);
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
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => {
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

  private readonly handleChartWheel = () => this.queueVisiblePriceScaleUpdate();

  private updateIntervalPressedButtons(value: string) {
    this.host.querySelectorAll<HTMLElement>("[data-market-interval]").forEach((button) => {
      const active = button.dataset.marketInterval === value;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  private loadTradingPeriods() {
    try {
      const saved = window.localStorage.getItem(TRADING_PERIODS_STORAGE_KEY);
      return saved
        ? normalizeTradingPeriods(JSON.parse(saved))
        : cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
    } catch {
      return cloneTradingPeriods(DEFAULT_TRADING_PERIODS);
    }
  }

  private loadIndicatorSettings() {
    try {
      const current = window.localStorage.getItem(TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const legacy = current
        ? null
        : window.localStorage.getItem(LEGACY_TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const oldestLegacy = current || legacy
        ? null
        : window.localStorage.getItem(OLDEST_TRADING_INDICATOR_SETTINGS_STORAGE_KEY);
      const settings = normalizeTradingIndicatorSettings(
        current || legacy || oldestLegacy
          ? JSON.parse(current || legacy || oldestLegacy || "null")
          : null,
      );
      if (!current && (legacy || oldestLegacy)) {
        const referenceMigrated = oldestLegacy
          ? migrateTradingVolumeReferenceStyle(settings)
          : settings;
        const migrated = migrateTradingBarColors(referenceMigrated);
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
      .filter((record) => record.assetClass === "crypto" && this.favoriteSymbols.has(record.id))
      .map((record) => liveMarkets.get(record.id)
        || this.finnhubFavoriteMarkets.get(record.id)
        || this.favoriteTickerMarketsById.get(record.id)
        || marketFromFavoriteRecord(record))
      .slice(0, MAX_TRADING_FAVORITE_TICKERS);
  }

  private renderFavoriteTickerBar() {
    const markets = this.favoriteTickerMarkets();
    this.favoriteTickerMarketsById = new Map(markets.map((market) => [market.id, market]));
    this.favoriteTickerBar.hidden = markets.length === 0;
    if (!markets.length) {
      this.favoriteTickerBar.innerHTML = "";
      return;
    }
    this.favoriteTickerBar.innerHTML = markets.map((market) => {
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
          aria-current="${selected}"
          aria-label="切换至 ${escapeAttribute(name)}，价格 ${escapeAttribute(priceText)}，24小时涨幅 ${escapeAttribute(changeText)}"
          title="${escapeAttribute(name)}"
        >
          <strong>${escapeHtml(name)}</strong>
          <span><b data-market-favorite-price>${escapeHtml(priceText)}</b><em class="${changeClass}" data-market-favorite-change>${escapeHtml(changeText)}</em></span>
        </button>
      `;
    }).join("");
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
        button.setAttribute(
          "aria-label",
          `切换至 ${market.displaySymbol}${market.tag}，价格 ${priceText}，24小时涨幅 ${changeText}`,
        );
      });
      if (!this.picker.hidden) this.renderMarkets();
    });
  }

  private armFavoriteTickerSocketWatchdog(socket: WebSocket, generation: number) {
    const previousTimer = this.favoriteTickerSocketWatchdogs.get(socket);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      this.favoriteTickerSocketWatchdogs.delete(socket);
      if (this.disposed || generation !== this.favoriteTickerGeneration) return;
      socket.close();
    }, FAVORITE_TICKER_SOCKET_WATCHDOG_MS);
    this.favoriteTickerSocketWatchdogs.set(socket, timer);
  }

  private async refreshFavoriteTickerFallback(generation: number) {
    if (
      this.disposed
      || generation !== this.favoriteTickerGeneration
      || this.favoriteTickerFallbackPending
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
      const results = await Promise.allSettled(staleMarkets.map(async (market) => ({
        marketId: market.id,
        symbol: market.symbol,
        ticker: await fetchBinanceMarket<BinanceTicker24h>(
          market.marketType === "spot" ? "spot" : "perpetual",
          "/fapi/v1/ticker/24hr",
          "/api/v3/ticker/24hr",
          { symbol: market.symbol },
          abortController.signal,
        ),
      })));
      if (this.disposed || generation !== this.favoriteTickerGeneration) return;
      let updated = false;
      results.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const market = this.favoriteTickerMarketsById.get(result.value.marketId);
        if (!market || market.provider !== "binance" || market.symbol !== result.value.symbol) return;
        const applied = applyTradingMarketTickerQuote(
          market,
          {
            lastPrice: result.value.ticker.lastPrice,
            openPrice: result.value.ticker.openPrice,
            changePercent: result.value.ticker.priceChangePercent,
          },
          this.favoriteTickerOpenPricesById.get(market.id),
        );
        if (!applied.updated) return;
        if (applied.openPrice !== null) {
          this.favoriteTickerOpenPricesById.set(market.id, applied.openPrice);
        }
        updated = true;
      });
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
    this.favoriteTickerSocketWatchdogs.forEach((timer) => window.clearTimeout(timer));
    this.favoriteTickerSocketWatchdogs.clear();
    this.favoriteTickerSockets.forEach((socket) => {
      socket.onclose = null;
      socket.close();
    });
    this.favoriteTickerSockets = [];
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
    groups.forEach((markets, marketType) => {
      const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
      const socket = new WebSocket(tradingFavoriteTickerStreamUrl(marketType, marketBySymbol.keys()));
      this.favoriteTickerSockets.push(socket);
      socket.onopen = () => {
        if (this.disposed || generation !== this.favoriteTickerGeneration) return;
        this.armFavoriteTickerSocketWatchdog(socket, generation);
      };
      socket.onmessage = (event) => {
        if (this.disposed || generation !== this.favoriteTickerGeneration) return;
        try {
          const message = JSON.parse(String(event.data));
          const payload = (message?.data?.e ? message.data : message) as BinanceWsMessage;
          if (payload.e !== "24hrTicker" || !payload.s) return;
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
          this.armFavoriteTickerSocketWatchdog(socket, generation);
          this.scheduleFavoriteTickerPaint();
        } catch {
          // Ignore malformed ticker events and keep the remaining streams alive.
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        const watchdog = this.favoriteTickerSocketWatchdogs.get(socket);
        if (watchdog !== undefined) window.clearTimeout(watchdog);
        this.favoriteTickerSocketWatchdogs.delete(socket);
        if (
          this.disposed
          || generation !== this.favoriteTickerGeneration
          || this.favoriteTickerReconnectTimer !== null
        ) return;
        this.favoriteTickerReconnectTimer = window.setTimeout(
          () => this.syncFavoriteTickerStreams(),
          1_500,
        );
      };
    });
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
  }

  private syncIntervalAvailability() {
    const ifindSelected = this.selectedProvider === "ifind";
    this.periodTimes.querySelectorAll<HTMLButtonElement>("[data-market-interval]").forEach((button) => {
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
    this.periodTimes.innerHTML = renderTimeButtons(this.periods, this.activeInterval);
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
          <span>${tradingPeriodLabel(period)}</span>
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
    this.setPeriodEditorOpen(false);
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
      if (this.ifindConfigured) void this.refreshFavoriteIfindQuotes();
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
    if (!query || !this.ifindConfigured || !window.codexDesktop.searchIfindMarkets) {
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
      const response = await search({ query, limit: 12 });
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
      this.setPeriodEditorOpen(false);
      this.setIndicatorEditorOpen(false);
    }
    this.picker.hidden = !open;
    this.host.querySelector<HTMLElement>('[data-market-action="toggle-symbols"]')
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
      this.showFavoritesOnly = this.favoriteSymbols.size > 0;
      this.renderMarkets({ resetScroll: true });
      if (this.finnhubConfigured) void this.refreshFavoriteFinnhubQuotes();
      if (this.ifindConfigured) void this.refreshFavoriteIfindQuotes();
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
    const trigger = this.host.querySelector<HTMLElement>('[data-market-action="toggle-indicator-editor"]');
    trigger?.setAttribute("aria-expanded", String(open));
    trigger?.classList.toggle("active", open);
    if (open) {
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
    const selectedSetting = this.draftIndicatorSettings[this.selectedIndicatorSettingKey];
    if (selectedSetting) selectedSetting.enabled = true;
    this.indicatorSettings = normalizeTradingIndicatorSettings(this.draftIndicatorSettings);
    this.draftIndicatorSettings = cloneTradingIndicatorSettings(this.indicatorSettings);
    this.syncActiveIndicatorsFromSettings();
    this.persistIndicatorSettings();
    this.updateMainIndicatorButtons();
    this.updateIndicatorButtons();
    this.applyMainIndicatorSeriesOptions();
    this.rebuildIndicatorPanes();
    this.updateChartData({ preserveViewport: true });
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

  private async loadMarkets() {
    try {
      this.markets = await fetchTradingMarkets();
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
        this.renderMarkets();
        this.renderFavoriteTickerBar();
        this.syncFavoriteTickerStreams();
      }
    } catch (error) {
      console.error("加载交易币种失败", error);
    }
  }

  private renderMarkets(options: { resetScroll?: boolean } = {}) {
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
    const markets = tradingMarketsPreferBinance([
      ...this.markets,
      ...favoriteMarkets,
      ...this.finnhubSearchMarkets,
      ...this.ifindSearchMarkets,
    ])
      .filter((market) => tradingMarketVisibleInPicker(
        market,
        query,
        this.favoriteSymbols,
        favoritesOnly,
      ))
      .slice(0, 120);
    this.renderedMarkets = new Map(markets.map((market) => [market.id, market]));
    if (!markets.length) {
      this.marketList.innerHTML = `<p class="trading-market-list-empty">${
        this.finnhubSearchPending || this.ifindSearchPending
          ? "正在搜索行情市场…"
          : favoritesOnly ? "暂无可用的收藏品种" : "未找到匹配品种"
      }</p>`;
      this.marketListScrollTop = 0;
      this.marketList.scrollTop = 0;
      return;
    }
    this.marketList.innerHTML = markets.map((market) => {
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
            ${renderMarketAssetLogo(market.baseAsset, market.provider)}
            <strong title="${escapeAttribute(accessibleName)}">${escapeHtml(market.displaySymbol)}</strong>
            <span class="trading-market-contract-tag">${escapeHtml(market.tag)}</span>
          </span>
          <span class="trading-market-row-venue" title="${escapeAttribute(market.venue)}">${escapeHtml(market.venue)}</span>
          <b>${escapeHtml(priceText)}</b>
          <em class="${market.quoteAvailable ? changeClass : ""}">${escapeHtml(changeText)}</em>
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
    }).join("");
    this.restoreMarketListScroll(preservedScrollTop);
  }

  private restoreMarketListScroll(scrollTop: number) {
    const target = Math.max(0, scrollTop);
    this.marketListScrollTop = target;
    this.marketList.scrollTop = target;
    if (this.marketListScrollRestoreFrame !== null) {
      window.cancelAnimationFrame(this.marketListScrollRestoreFrame);
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
    this.drawingStorageSessionId = drawingStorageSessionId;
    this.drawingController?.switchStorageSession(drawingStorageSessionId, {
      migrateFromSessionId: migrateFromSessionId || undefined,
    });
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
    const logoFallback = logoShell?.querySelector<HTMLElement>("[data-market-logo-fallback]");
    const logoImage = logoShell?.querySelector<HTMLImageElement>("[data-market-logo]");
    if (logoFallback) logoFallback.textContent = symbolBadge(baseAsset);
    logoShell?.classList.toggle("provider-finnhub", provider === "finnhub");
    logoShell?.classList.toggle("provider-ifind", provider === "ifind");
    logoShell?.classList.toggle("provider-binance", provider === "binance");
    if (logoImage) {
      logoImage.hidden = provider !== "binance";
      logoImage.dataset.marketLogoAsset = baseAsset;
      logoImage.dataset.marketLogoStage = "binance";
      logoImage.src = binanceAssetLogoUrl(baseAsset);
      logoShell?.classList.toggle("fallback", provider !== "binance");
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

  private cancelChanAnalysis(options: { clear?: boolean; notifyMain?: boolean } = {}) {
    this.chanAnalysisGeneration += 1;
    this.drawingController?.cancelAiPlayback({ clear: options.clear === true });
    if (options.notifyMain === true && this.chanAnalysisActive) {
      void window.codexDesktop.cancelTradingAnalysis?.().catch(() => undefined);
    }
    this.chanAnalysisActive = false;
  }

  hasCurrentAnalysis(
    theory?: "chan" | "order-flow" | "wave" | "wyckoff" | "price-action",
  ) {
    return this.drawingController?.hasAiAnalysisForCurrentContext(theory) === true;
  }

  async runGeneralConversation(
    request: TradingGeneralConversationRequest,
  ): Promise<TradingGeneralConversationResult> {
    const api = window.codexDesktop.runTradingGeneralAnalysis;
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
    const analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    if (analysisCandles.length < 30) {
      throw new Error(`${request.lookbackLabel || "当前画布可见范围"}仅有 ${analysisCandles.length} 根 K 线，不足以形成可靠的价格结构`);
    }
    const generation = ++this.chanAnalysisGeneration;
    this.chanAnalysisActive = true;
    this.drawingController?.cancelAiPlayback({ clear: false });
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "analyzing",
      `已读取左侧 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在计算趋势、摆动高低点和关键支撑压力。`,
    );
    try {
      const response = await api({
        marketId: this.selectedMarketId,
        interval: this.activeInterval,
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
      }) as TradingGeneralAnalysisResponse;
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("盘面分析已取消");
      }
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const error = new Error(response?.error?.message || "盘面分析没有返回可绘制计划");
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "drawing",
          `${modelName} 已完成盘面复核，正在左侧图表逐项绘制趋势、支撑、压力和条件价位。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (generation !== this.chanAnalysisGeneration) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("drawing", `${modelName} 正在拟人化逐笔落图。`);
          }
        };
        await this.drawingController?.playAiDrawingPatch(response.analysisPlan.drawingPatch, { onPhase });
      }
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("盘面分析已取消");
      }
      request.onProgress?.("complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成盘面绘图，正在整理新手可执行的多空条件。`);
      return {
        report: String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "盘面分析已完成"),
        narrative: String(response.analysisPlan.narrative || "盘面分析已完成"),
        marketId: this.selectedMarketId,
        symbol: this.selectedSymbol,
        interval: this.activeInterval,
        candleCount: analysisCandles.length,
        modelName,
      };
    } finally {
      if (generation === this.chanAnalysisGeneration) this.chanAnalysisActive = false;
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
    const analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    if (analysisCandles.length < 30) {
      throw new Error(`${request.lookbackLabel || "所选范围"}仅有 ${analysisCandles.length} 根 K 线，不足以形成可靠的缠论笔结构`);
    }
    const generation = ++this.chanAnalysisGeneration;
    this.chanAnalysisActive = true;
    this.drawingController?.cancelAiPlayback({ clear: false });
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在识别包含关系、分型、笔和中枢。`,
    );
    try {
      const response = await api({
        marketId: this.selectedMarketId,
        interval: this.activeInterval,
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
      }) as TradingChanAnalysisResponse;
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("缠论分析已取消");
      }
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const error = new Error(response?.error?.message || "缠论分析没有返回可绘制计划");
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "drawing",
          `${modelName} 已完成结构复核，正在左侧图表逐笔绘制已通过校验的缠论结构。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (generation !== this.chanAnalysisGeneration) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("drawing", `${modelName} 正在逐笔绘制分型、笔与中枢。`);
          }
        };
        await this.drawingController?.playAiDrawingPatch(response.analysisPlan.drawingPatch, { onPhase });
      }
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("缠论分析已取消");
      }
      request.onProgress?.("complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成缠论复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成缠论绘图，正在整理完整分析报告。`);
      return {
        report: String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "缠论分析已完成"),
        narrative: String(response.analysisPlan.narrative || "缠论分析已完成"),
        marketId: this.selectedMarketId,
        symbol: this.selectedSymbol,
        interval: this.activeInterval,
        candleCount: analysisCandles.length,
        modelName,
      };
    } finally {
      if (generation === this.chanAnalysisGeneration) this.chanAnalysisActive = false;
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
    if (analysisCandles.length < 30) {
      throw new Error(`${request.lookbackLabel || "所选范围"}仅有 ${analysisCandles.length} 根 K 线，不足以形成可靠的波浪摆动点`);
    }
    const generation = ++this.chanAnalysisGeneration;
    this.chanAnalysisActive = true;
    this.drawingController?.cancelAiPlayback({ clear: false });
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
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
      const expansion = await runTradingWaveAnalysisWithAutoExpansion({
        initialCandles: analysisCandles,
        getAvailableCandles: () => waveCandlePool,
        analyze: async (candles) => {
          const response = await api({
            marketId: this.selectedMarketId,
            interval: this.activeInterval,
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
          if (this.disposed || generation !== this.chanAnalysisGeneration) {
            throw new Error("波浪理论分析已取消");
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
          if (
            this.disposed
            || generation !== this.chanAnalysisGeneration
            || this.loadedMarketId !== targetMarket.id
            || this.loadedInterval !== targetInterval
          ) {
            throw new Error("波浪理论分析已取消");
          }
          waveCandlePool = mergeCandles(history.candles, waveCandlePool);
          waveSourceCandlePool = mergeCandles(history.sourceCandles, waveSourceCandlePool);
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
      if (!response?.ok || !response.analysisPlan?.drawingPatch) {
        const responseMessage = response?.error?.message || "波浪理论分析没有返回可绘制计划";
        const error = new Error(expansion.exhausted && response?.error?.code === "TRADING_WAVE_INSUFFICIENT_DATA"
          ? `已自动扩大到 ${analysisCandles.length} 根 K 线，仍未形成可复核浪型：${responseMessage}`
          : responseMessage);
        (error as Error & { code?: string }).code = response?.error?.code;
        throw error;
      }
      if (waveCandlePool.length > this.candles.length) {
        const visibleTimeRange = this.chart?.timeScale().getVisibleRange() || null;
        this.sourceCandles = mergeCandles(waveSourceCandlePool, this.sourceCandles);
        this.candles = mergeCandles(waveCandlePool, this.candles);
        this.updateChartData();
        if (visibleTimeRange) this.chart?.timeScale().setVisibleRange(visibleTimeRange);
      }
      const modelName = response.model?.modelId || response.model?.providerId || "分析模型";
      if (request.drawingRequested !== false) {
        request.onProgress?.(
          "wave-drawing",
          `${modelName} 已完成严格波浪规则复核，正在左侧图表绘制已验证主计数与关键确认/失效区域。`,
        );
        const onPhase = (phase: TradingAiPlaybackPhase) => {
          if (generation !== this.chanAnalysisGeneration) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("wave-drawing", `${modelName} 正在逐笔绘制简短浪标、主路径和关键价位。`);
          }
        };
        await this.drawingController?.playAiDrawingPatch(response.analysisPlan.drawingPatch, { onPhase });
      }
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("波浪理论分析已取消");
      }
      request.onProgress?.("wave-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成波浪复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成精简波浪绘图，正在整理新手可读的多空触发价与风险条件。`);
      return {
        report: String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "波浪理论分析已完成"),
        narrative: String(response.analysisPlan.narrative || "波浪理论分析已完成"),
        marketId: this.selectedMarketId,
        symbol: this.selectedSymbol,
        interval: this.activeInterval,
        candleCount: analysisCandles.length,
        modelName,
      };
    } finally {
      if (generation === this.chanAnalysisGeneration) this.chanAnalysisActive = false;
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
    const analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length >= 60
        ? canvasCandles
        : this.candles.slice(-120);
    if (analysisCandles.length < 60) {
      throw new Error(`${request.lookbackLabel || "所选范围"}仅有 ${analysisCandles.length} 根 K 线，不足以识别可靠的威科夫交易区间`);
    }
    const generation = ++this.chanAnalysisGeneration;
    this.chanAnalysisActive = true;
    this.drawingController?.cancelAiPlayback({ clear: false });
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "wyckoff-analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在识别交易区间、量价努力结果、A–E 阶段和关键事件。`,
    );
    try {
      const response = await api({
        marketId: this.selectedMarketId,
        interval: this.activeInterval,
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
      }) as TradingWyckoffAnalysisResponse;
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("威科夫分析已取消");
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
          if (generation !== this.chanAnalysisGeneration) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("wyckoff-drawing", `${modelName} 正在逐项绘制区间边界、Phase A–E 和关键量价事件。`);
          }
        };
        await this.drawingController?.playAiDrawingPatch(response.analysisPlan.drawingPatch, { onPhase });
      }
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("威科夫分析已取消");
      }
      request.onProgress?.("wyckoff-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成威科夫复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成威科夫拟人落图，正在整理新手可执行的突破、跌破与等待条件。`);
      return {
        report: String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "威科夫分析已完成"),
        narrative: String(response.analysisPlan.narrative || "威科夫分析已完成"),
        marketId: this.selectedMarketId,
        symbol: this.selectedSymbol,
        interval: this.activeInterval,
        candleCount: analysisCandles.length,
        modelName,
      };
    } finally {
      if (generation === this.chanAnalysisGeneration) this.chanAnalysisActive = false;
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
    const analysisCandles = requestedLookbackMs
      ? this.candles.filter((candle) => candle.time * 1_000 >= latestTimeMs - requestedLookbackMs)
      : canvasCandles.length
        ? canvasCandles
        : this.candles.slice(-100);
    if (analysisCandles.length < 30) {
      throw new Error(`${request.lookbackLabel || "所选范围"}仅有 ${analysisCandles.length} 根 K 线，不足以提供订单流所需的价格背景`);
    }
    const generation = ++this.chanAnalysisGeneration;
    this.chanAnalysisActive = true;
    this.drawingController?.cancelAiPlayback({ clear: false });
    if (requestedLookbackMs) this.focusChartLookback(requestedLookbackMs);
    const rangeDescription = request.lookbackLabel
      ? `最近 ${request.lookbackLabel}`
      : `当前画布可见的 ${analysisCandles.length} 根`;
    request.onProgress?.(
      "order-flow-analyzing",
      `已准备 ${marketLabel} ${rangeDescription} ${tradingPeriodLabelForResolution(targetInterval)} K 线，正在读取真实主动成交、盘口深度和持仓量覆盖。`,
    );
    try {
      const orderFlow = await fetchTradingOrderFlowWindow(
        this.selectedSymbol,
        this.activeInterval,
        this.stats?.openInterest ?? null,
      );
      const contextCandles = await fetchTradingMarketStructureContexts(
        this.selectedSymbol,
        this.activeInterval,
      );
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("订单流分析已取消");
      }
      request.onProgress?.(
        "order-flow-analyzing",
        `已读取 ${orderFlow.trades.length} 笔真实聚合成交、${Math.min(orderFlow.depth.bids.length, orderFlow.depth.asks.length)} 档双边深度和 ${contextCandles.length} 个高周期上下文，正在计算 Delta、ICT/SMC 结构与流动性。`,
      );
      const response = await api({
        marketId: this.selectedMarketId,
        interval: this.activeInterval,
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
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("订单流分析已取消");
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
          if (generation !== this.chanAnalysisGeneration) return;
          if (phase === "moving" || phase === "drawing" || phase === "committing") {
            request.onProgress?.("order-flow-drawing", `${modelName} 正在逐项绘制精简后的关键结构和多空触发价。`);
          }
        };
        await this.drawingController?.playAiDrawingPatch(response.analysisPlan.drawingPatch, { onPhase });
      }
      if (this.disposed || generation !== this.chanAnalysisGeneration) {
        throw new Error("订单流分析已取消");
      }
      request.onProgress?.("order-flow-complete", request.drawingRequested === false
        ? `${modelName} 已按最新行情完成订单流复核，正在直接回答本次问题；左侧原画线保持不变。`
        : `${modelName} 已完成精简订单流绘图，正在整理新手可读的上破、跌破、回踩与等待方案。`);
      return {
        report: String((request.drawingRequested === false
          ? response.analysisPlan.narrative
          : response.analysisPlan.report) || response.analysisPlan.narrative || "订单流分析已完成"),
        narrative: String(response.analysisPlan.narrative || "订单流分析已完成"),
        marketId: this.selectedMarketId,
        symbol: this.selectedSymbol,
        interval: this.activeInterval,
        candleCount: analysisCandles.length,
        tradeCount: orderFlow.trades.length,
        modelName,
      };
    } finally {
      if (generation === this.chanAnalysisGeneration) this.chanAnalysisActive = false;
    }
  }

  private async restartMarketData(options: { preserveChart?: boolean } = {}) {
    this.cancelChanAnalysis({ clear: false, notifyMain: true });
    const generation = ++this.loadGeneration;
    const targetSymbol = this.selectedSymbol;
    const targetMarketId = this.selectedMarketId;
    const targetProvider = this.selectedProvider;
    const targetAssetClass = this.selectedAssetClass;
    const targetMarketType = this.selectedMarketType;
    const targetMarketMeta = this.selectedMarketMeta ? { ...this.selectedMarketMeta } : null;
    const targetInterval = this.activeInterval;
    const keepChart = options.preserveChart === true && this.candles.length > 0;
    this.loadingHistory = false;
    if (this.historyCooldownTimer !== null) {
      window.clearTimeout(this.historyCooldownTimer);
      this.historyCooldownTimer = null;
    }
    this.closeSocket();
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
    if (!keepChart) {
      this.stats = null;
      this.candles = [];
      this.sourceCandles = [];
      this.lastAggregateTradeId = null;
      this.clearChart();
    }
    this.errorElement.hidden = true;
    this.errorElement.dataset.marketAction = "retry";
    this.errorElement.removeAttribute("aria-label");
    try {
      const { stats, candleBatch } = targetProvider === "finnhub"
        ? await this.fetchFinnhubSnapshot(targetSymbol, targetAssetClass, targetInterval, 500)
        : targetProvider === "ifind"
          ? await this.fetchIfindSnapshot(targetSymbol, targetAssetClass, targetInterval, 500)
          : await (async () => {
            const [stats, candleBatch] = await Promise.all([
              fetchTradingMarketStats(targetSymbol, targetMarketType === "spot" ? "spot" : "perpetual"),
              fetchTradingCandles(
                targetSymbol,
                targetInterval,
                500,
                Date.now(),
                targetMarketType === "spot" ? "spot" : "perpetual",
              ),
            ]);
            return { stats, candleBatch };
          })();
      if (this.disposed || generation !== this.loadGeneration) return;
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
      this.setLoading(false);
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return;
      console.error("加载实时行情失败", error);
      this.setLoading(false);
      if (keepChart && targetProvider === "binance") {
        this.selectedSymbol = this.loadedSymbol;
        this.selectedMarketId = this.loadedMarketId;
        this.selectedProvider = this.loadedProvider;
        this.selectedAssetClass = this.loadedAssetClass;
        this.selectedMarketType = this.loadedMarketType;
        this.selectedMarketMeta = this.loadedMarketMeta;
        this.activeInterval = this.loadedInterval;
        this.updateSymbolUi();
        this.updateIntervalPressedButtons(this.activeInterval);
        this.renderMarkets();
      } else {
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
      }
    }
    if (this.disposed || generation !== this.loadGeneration) return;
    if (this.selectedProvider === "binance") this.connectSocket(generation);
    this.pollTimer = window.setInterval(() => void this.refreshSnapshot(generation), 30_000);
    this.candlePollTimer = window.setInterval(
      () => void this.refreshLiveCandle(generation),
      this.selectedProvider === "binance" ? 2_000 : 60_000,
    );
  }

  private async refreshSnapshot(generation: number) {
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
        return;
      }
      const stats = await fetchTradingMarketStats(
        this.selectedSymbol,
        this.selectedMarketType === "spot" ? "spot" : "perpetual",
      );
      if (this.disposed || generation !== this.loadGeneration) return;
      this.stats = stats;
      this.updateStatsUi();
    } catch {
      // WebSocket is the primary stream; a failed fallback poll is non-fatal.
    }
  }

  private async refreshLiveCandle(generation: number) {
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
        this.candles = mergeCandles(this.candles, this.normalizeRemoteCandles(response.candles));
        this.updateChartData();
        return;
      }
      const sourceStartTime = this.sourceCandles.at(-1)?.time;
      const batch = await fetchLatestTradingCandles(
        this.selectedSymbol,
        this.activeInterval,
        sourceStartTime === undefined ? undefined : sourceStartTime * 1000,
        this.lastAggregateTradeId === null ? undefined : this.lastAggregateTradeId + 1,
        this.selectedMarketType === "spot" ? "spot" : "perpetual",
      );
      if (this.disposed || generation !== this.loadGeneration) return;
      if (batch.lastTradeId !== undefined) {
        this.lastAggregateTradeId = Math.max(
          this.lastAggregateTradeId ?? batch.lastTradeId,
          batch.lastTradeId,
        );
      }
      if (batch.source.sourceInterval && batch.source.sourceMs) {
        this.sourceCandles = mergeCandles(this.sourceCandles, batch.sourceCandles);
        this.candles = batch.source.sourceMs === batch.source.targetMs
          ? [...this.sourceCandles]
          : aggregateTradingCandles(this.sourceCandles, batch.source.targetMs);
      } else {
        this.candles = mergeCandles(this.candles, batch.candles);
      }
      this.updateChartData();
    } catch {
      // Production WebSocket remains primary; REST polling is a best-effort fallback.
    } finally {
      if (this.refreshingLiveCandleGeneration === generation) {
        this.refreshingLiveCandleGeneration = null;
      }
    }
  }

  private connectSocket(generation: number) {
    if (this.disposed || generation !== this.loadGeneration || this.selectedProvider !== "binance") return;
    const marketType = this.selectedMarketType === "spot" ? "spot" : "perpetual";
    const socket = new WebSocket(marketType === "spot" ? BINANCE_SPOT_WS_URL : BINANCE_FUTURES_WS_URL);
    this.socket = socket;
    socket.onopen = () => {
      if (this.disposed || generation !== this.loadGeneration) return;
      const source = binanceResolutionSource(this.activeInterval);
      const symbol = this.selectedSymbol.toLowerCase();
      const streams = [`${symbol}@ticker`];
      if (marketType === "perpetual") streams.unshift(`${symbol}@markPrice@1s`);
      streams.push(source?.sourceInterval
        ? `${symbol}@kline_${source.sourceInterval}`
        : `${symbol}@aggTrade`);
      socket.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: streams,
        id: generation,
      }));
    };
    socket.onmessage = (event) => {
      if (this.disposed || generation !== this.loadGeneration) return;
      try {
        this.handleSocketMessage(JSON.parse(String(event.data)));
      } catch (error) {
        console.error("解析实时行情消息失败", error);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.disposed || generation !== this.loadGeneration) return;
      this.reconnectTimer = window.setTimeout(() => this.connectSocket(generation), 1500);
    };
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
    this.sourceCandles = mergeCandles(this.sourceCandles, [incoming]);
    this.candles = source.sourceMs === source.targetMs
      ? [...this.sourceCandles]
      : aggregateTradingCandles(this.sourceCandles, source.targetMs);
    this.updateChartData();
  }

  private updateFromBinanceTrade(trade: BinanceWsMessage) {
    const source = binanceResolutionSource(this.activeInterval);
    const timeMs = Number(trade.T || 0);
    const price = Number(trade.p || 0);
    const volume = Number(trade.q || 0);
    const tradeId = Number(trade.a || 0);
    if (!source || source.sourceInterval || timeMs <= 0 || !Number.isFinite(price) || price <= 0) return;
    if (Number.isFinite(tradeId) && tradeId > 0) {
      this.lastAggregateTradeId = Math.max(this.lastAggregateTradeId ?? tradeId, tradeId);
    }
    const time = Math.floor(timeMs / source.targetMs) * source.targetMs / 1000;
    const existing = this.candles.find((candle) => candle.time === time);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume = Number(existing.volume || 0) + volume;
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
    this.updateChartData();
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
    if (!this.stats) return;
    if (this.selectedProvider !== "binance" || this.selectedMarketType !== "perpetual") {
      this.setStat("funding", "--");
      return;
    }
    const funding = this.stats.fundingRate;
    this.setStat(
      "funding",
      `${funding >= 0 ? "+" : ""}${(funding * 100).toFixed(4)}% / ${formatFundingCountdown(Date.now(), this.stats.nextFundingTime)}`,
      funding >= 0 ? "positive" : "negative",
    );
  }

  private setStat(name: string, text: string, tone?: "positive" | "negative") {
    const element = this.host.querySelector<HTMLElement>(`[data-market-stat="${name}"]`);
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("positive", tone === "positive");
    element.classList.toggle("negative", tone === "negative");
  }

  private createChart() {
    const theme = marketTheme(isDarkTheme());
    this.chart = createChart(this.chartElement, {
      width: Math.max(this.chartElement.clientWidth, 1),
      height: Math.max(this.chartElement.clientHeight, 1),
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
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
        vertLines: { visible: false },
        horzLines: { color: theme.grid },
      },
      crosshair: marketCrosshairOptions(theme),
      rightPriceScale: {
        autoScale: false,
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
      topColor: theme.background,
      bottomColor: theme.background,
      lineColor: theme.bandLine,
      lineWidth: 1,
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: TRADING_RISING_BAR_COLOR,
      downColor: TRADING_FALLING_BAR_COLOR,
      borderVisible: true,
      borderUpColor: TRADING_RISING_BAR_COLOR,
      borderDownColor: TRADING_FALLING_BAR_COLOR,
      wickVisible: true,
      wickUpColor: TRADING_RISING_BAR_COLOR,
      wickDownColor: TRADING_FALLING_BAR_COLOR,
      priceFormat: { ...MARKET_PRICE_FORMAT },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    this.createMainIndicatorSeries();
    this.tdMarkers = createSeriesMarkers(this.candleSeries, [], {
      autoScale: true,
      zOrder: "aboveSeries",
    });
    this.chart.subscribeCrosshairMove((parameter: any) => {
      const bar = parameter?.seriesData?.get(this.candleSeries);
      if (bar && typeof parameter?.time === "number") {
        this.renderOhlc(bar, parameter.time);
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
        this.positionIndicatorLegends();
        this.updateCurrentPriceLabel();
        this.drawingController?.redraw();
      });
    });
    this.resizeObserver.observe(this.chartElement);
    this.drawingController = new TradingDrawingController({
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
    });
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
    if (!this.activeMainIndicators.length) return;

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
  }

  private rebuildIndicatorPanes() {
    if (!this.chart) return;
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    this.rebuildingIndicatorPanes = true;
    try {
      // removePane() only detaches the visual pane in lightweight-charts. Its
      // series must be removed first or their old timestamps remain in the
      // shared time scale and corrupt the next interval's candle spacing.
      this.indicatorPanes.forEach((runtime) => {
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
      if (visibleRange) this.chart.timeScale().setVisibleLogicalRange(visibleRange);
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
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.text,
        fontFamily: MARKET_FONT_FAMILY,
        panes: {
          enableResize: true,
          separatorColor: theme.paneSeparator,
          separatorHoverColor: theme.paneSeparatorHover,
        },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme.grid },
      },
      crosshair: marketCrosshairOptions(theme),
      rightPriceScale: {
        autoScale: false,
        borderColor: theme.border,
        ensureEdgeTickMarksVisible: true,
        textColor: theme.text,
        scaleMargins: { top: 0, bottom: 0 },
      },
      timeScale: { visible: false, borderColor: theme.border },
    });
    this.indicatorPanes.forEach((runtime) => {
      runtime.series[0]?.api?.priceScale()?.applyOptions({
        borderColor: theme.border,
        textColor: theme.text,
      });
    });
    this.bandUpperSeries?.applyOptions({
      topColor: theme.band,
      bottomColor: theme.band,
      lineColor: theme.bandLine,
    });
    this.bandLowerSeries?.applyOptions({
      topColor: theme.background,
      bottomColor: theme.background,
      lineColor: theme.bandLine,
    });
    this.applyMainIndicatorSeriesOptions();
    this.updateChartData();
    this.drawingController?.redraw();
  }

  private clearChart() {
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

  private updateChartData(options: { resetViewport?: boolean; preserveViewport?: boolean } = {}) {
    if (!this.chart || !this.candleSeries || !this.candles.length) return;
    const resetViewport = options.resetViewport === true;
    const preservedLogicalRange = !resetViewport && options.preserveViewport === true
      ? this.chart.timeScale().getVisibleLogicalRange()
      : null;
    if (resetViewport) this.prepareChartViewportReset();
    const deduped = mergeCandles([], this.candles);
    this.chartCandles = deduped;
    const trendBandEnabled = this.trendBandEnabled;
    const trendBars = trendBandEnabled ? atm1TrendCandles(deduped) : null;
    const display = deduped.map((candle, index) => {
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
    this.updatingChartData = true;
    try {
      this.candleSeries.setData(display);
      const band = atm4MaBand(deduped);
      this.bandUpperSeries?.setData(atm4BandSeriesData(band, "bandUpper", trendBandEnabled));
      this.bandLowerSeries?.setData(atm4BandSeriesData(band, "bandLower", trendBandEnabled));
      this.updateMainIndicatorData(deduped);
      this.updateIndicatorData(deduped);
      const lastRaw = deduped[deduped.length - 1];
      this.applyMarketPriceFormat(lastRaw.close);
      const lineColor = isDarkTheme() ? "#45c979" : "#269d4d";
      if (this.priceLine) this.candleSeries.removePriceLine(this.priceLine);
      this.priceLine = this.candleSeries.createPriceLine({
        price: lastRaw.close,
        color: lineColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
        axisLabelColor: lineColor,
        axisLabelTextColor: "#ffffff",
      });
      this.renderLatestOhlc();
      if (preservedLogicalRange) {
        this.chart.timeScale().setVisibleLogicalRange(preservedLogicalRange);
      }
    } finally {
      this.updatingChartData = false;
    }
    if (resetViewport) {
      this.applyInitialChartViewport();
      this.resettingChartViewport = false;
      this.queueVisiblePriceScaleUpdate();
    } else {
      this.synchronizeVisibleChartGeometry();
    }
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
    this.lockedPriceRange = null;
    this.chart.priceScale("right", 0).setAutoScale(true);
  }

  private applyInitialChartViewport() {
    if (!this.chart) return;
    const logicalRange = initialMarketLogicalRange(this.chartCandles.length, this.activeInterval);
    if (!logicalRange) return;
    this.chart.timeScale().setVisibleLogicalRange(logicalRange);
    this.lockedPriceRange = fixedPriceScaleRange(
      visibleCandlesInLogicalRange(this.chartCandles, logicalRange),
    );
    this.enforceLockedPriceScale();
    this.updateCurrentPriceLabel();
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
    this.lockedPriceRange = fixedPriceScaleRange(
      visibleCandlesInLogicalRange(this.chartCandles, logicalRange),
    );
    this.enforceLockedPriceScale();
    this.updateCurrentPriceLabel();
    this.drawingController?.redraw();
  }

  private updateVisiblePriceScale() {
    if (!this.chart) return;
    const logicalRange = this.chart.timeScale().getVisibleLogicalRange();
    const visibleCandles = visibleCandlesInLogicalRange(this.chartCandles, logicalRange);
    const priceRange = fixedPriceScaleRange(visibleCandles);
    if (!priceRange) return;
    this.lockedPriceRange = priceRange;
    this.enforceLockedPriceScale();
  }

  private enforceLockedPriceScale() {
    if (!this.chart || !this.lockedPriceRange) return;
    const priceScale = this.chart.priceScale("right", 0);
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
    this.drawingController?.redraw();
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
      return;
    }
    this.currentPriceElement.textContent = formatFocusedPrice(candle.close);
    this.positionFocusPriceLabel(this.currentPriceElement, y);
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
  }): Promise<TradingCandleBatch> {
    if (options.provider === "binance") {
      return fetchTradingCandles(
        options.symbol,
        options.interval,
        options.count,
        options.endTime,
        options.marketType === "spot" ? "spot" : "perpetual",
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
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;
    this.favoriteTickerGeneration += 1;
    this.cancelChanAnalysis({ clear: false, notifyMain: true });
    this.closeSocket();
    this.closeFavoriteTickerStreams();
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    if (this.candlePollTimer !== null) window.clearInterval(this.candlePollTimer);
    if (this.historyCooldownTimer !== null) window.clearTimeout(this.historyCooldownTimer);
    if (this.finnhubSearchTimer !== null) window.clearTimeout(this.finnhubSearchTimer);
    if (this.ifindSearchTimer !== null) window.clearTimeout(this.ifindSearchTimer);
    if (this.priceLockAnimationFrame !== null) window.cancelAnimationFrame(this.priceLockAnimationFrame);
    if (this.drawingSettleAnimationFrame !== null) {
      window.cancelAnimationFrame(this.drawingSettleAnimationFrame);
    }
    if (this.marketListScrollRestoreFrame !== null) {
      window.cancelAnimationFrame(this.marketListScrollRestoreFrame);
    }
    if (this.favoriteTickerPaintFrame !== null) {
      window.cancelAnimationFrame(this.favoriteTickerPaintFrame);
      this.favoriteTickerPaintFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.drawingController?.destroy();
    this.drawingController = null;
    this.host.removeEventListener("click", this.handleClick);
    this.host.removeEventListener("input", this.handleIndicatorEditorInput);
    this.host.removeEventListener("change", this.handleIndicatorEditorInput);
    this.host.removeEventListener("error", this.handleMarketLogoError, true);
    this.periodItems.removeEventListener("pointerdown", this.handlePeriodPointerDown);
    this.chartElement.removeEventListener("pointerdown", this.handleChartPanPointerDown);
    this.chartElement.removeEventListener("pointermove", this.handleChartPanPointerMove);
    this.chartElement.removeEventListener("pointerup", this.handleChartPanPointerUp);
    this.chartElement.removeEventListener("pointercancel", this.handleChartPanPointerCancel);
    this.chartElement.removeEventListener("wheel", this.handleChartWheel);
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

export function applyTradingExpertCustomIndicatorMentions(text: string) {
  if (!activeWorkspace) return false;
  return activeWorkspace.setTrendBandEnabled(hasTradingExpertTrendBandMention(text));
}

export function hasTradingExpertCurrentAnalysis(
  theory?: "chan" | "order-flow" | "wave" | "wyckoff" | "price-action",
) {
  return activeWorkspace?.hasCurrentAnalysis(theory) === true;
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

export async function runTradingExpertGeneralConversation(
  request: TradingGeneralConversationRequest,
) {
  if (!activeWorkspace) throw new Error("交易专家行情工作区尚未就绪");
  return activeWorkspace.runGeneralConversation(request);
}
