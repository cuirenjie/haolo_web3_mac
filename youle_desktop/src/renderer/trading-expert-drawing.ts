import { zoomTradingChart, type TradingChartNavigation } from "./trading-chart-navigation.ts";
import { TradingChartToolbarVisibility, clampTradingChartToolbarPosition } from "./trading-chart-toolbar-visibility.ts";
import { beginTradingChartInteraction, endTradingChartInteraction } from "./trading-chart-interaction.ts";
import {
  TradingAiDrawingPlaybackController,
  type TradingAiDrawing,
  type TradingAiDrawingColorToken,
  type TradingAiDrawingPatch,
  type TradingAiPlaybackPhase,
  type TradingIndicatorAiDrawingPatch,
} from "./trading-expert-ai-playback.ts";
import {
  fitTradingOrderLineLabels,
  renderTradingOrderLineSvg,
  renderTradingOrderPositionCards,
  type TradingOrderLine,
} from "./trading-expert-order-lines.ts";
import { translateAppText, translateTradingAnnotationText, type AppLanguage } from "./app-language.mjs";

const LEGACY_TRADING_DRAWINGS_STORAGE_KEY = "haolo.trading-market.drawings.v1";
const LEGACY_TRADING_AI_DRAWINGS_STORAGE_KEY = "haolo.trading-market.ai-drawings.v1";
const TRADING_DRAWINGS_STORAGE_KEY_PREFIX = "haolo.trading-market.drawings.v2.";
const TRADING_AI_DRAWINGS_STORAGE_KEY_PREFIX = "haolo.trading-market.ai-drawings.v2.";
const MAX_STORED_AI_DRAWINGS = 1_200;
const DEFAULT_DRAWING_COLOR_LIGHT = "#787b86";
const DEFAULT_DRAWING_COLOR_DARK = "#b2b5be";
const DEFAULT_TEXT_COLOR_LIGHT = "#4b5563";
const DEFAULT_TEXT_COLOR_DARK = "#d5dae1";
const DEFAULT_TEXT_FONT_SIZE = 16;
const AI_NOTE_FONT_SIZE = 10;
const AI_NOTE_TEXT_MAX_WIDTH = 200;
const TRADING_TEXT_BOX_MAX_WIDTH = 320;
const TRADING_TEXT_BOX_PADDING_X = 10;
const TRADING_TEXT_BOX_VIEWPORT_PADDING = 6;
const AI_NOTE_LAYOUT_GAP = 12;
const AI_NOTE_CANDLE_GAP = 8;
const AI_NOTE_LEADER_GAP = 28;
const AI_NOTE_TOP_INSET = 40;
const TRADING_TEXT_FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 36] as const;
const TRADING_AI_TEXT_FONT_SIZES = [8, 9, ...TRADING_TEXT_FONT_SIZES] as const;
const LEGACY_PRICE_ACTION_CANDLESTICK_LABEL_PATTERN = /^pa[-\s]+candlestick[-\s]+[0-9a-f]{8,}(?:\s*[·•]\s*(?:unclosed|待收盘))?$/iu;
const DEFAULT_DRAWING_LINE_WIDTH = 1;
const DRAWING_HANDLE_RADIUS = 5;
const DRAWING_MAGNET_DISTANCE = 18;
const FIBONACCI_HANDLE_RADIUS = 7;
const FIBONACCI_EXPANSION_THRESHOLD = 3;

// Shared toolbar elements can be owned by different chart controllers. Cache
// per element so switching the active chart cannot reuse another chart's state.
const drawingMarkup = new WeakMap<Element, string>();
export function updateTradingDrawingMarkup(element: Element, markup: string) {
  if (drawingMarkup.get(element) === markup) return;
  element.innerHTML = markup;
  drawingMarkup.set(element, markup);
}

function normalizeTradingDrawingStorageSessionId(value: unknown) {
  return String(value ?? "").trim() || "trading-expert-unassigned";
}

export function tradingDrawingSessionStorageKey(
  kind: "manual" | "ai",
  storageSessionId: string,
) {
  const prefix = kind === "ai"
    ? TRADING_AI_DRAWINGS_STORAGE_KEY_PREFIX
    : TRADING_DRAWINGS_STORAGE_KEY_PREFIX;
  return `${prefix}${encodeURIComponent(normalizeTradingDrawingStorageSessionId(storageSessionId))}`;
}

export const TRADING_FIBONACCI_LEVELS = [
  { ratio: 1, label: "100.0%", color: "var(--trading-fibonacci-level-pink)" },
  { ratio: 0.786, label: "78.6%", color: "var(--trading-fibonacci-level-pink)" },
  { ratio: 0.618, label: "61.8%", color: "var(--trading-fibonacci-level-blue)" },
  { ratio: 0.5, label: "50.0%", color: "var(--trading-fibonacci-level-blue)" },
  { ratio: 0.382, label: "38.2%", color: "var(--trading-fibonacci-level-purple)" },
  { ratio: 0.236, label: "23.6%", color: "var(--trading-fibonacci-level-magenta)" },
  { ratio: 0, label: "0.0%", color: "var(--trading-fibonacci-level-blue)" },
] as const;

export function tradingFibonacciLevelPrices(firstPrice: number, secondPrice: number) {
  return TRADING_FIBONACCI_LEVELS.map((level) => ({
    ...level,
    price: secondPrice + (firstPrice - secondPrice) * level.ratio,
  }));
}

export function formatTradingFibonacciPrice(value: number) {
  if (!Number.isFinite(value)) return "--";
  const absolute = Math.abs(value);
  if (absolute >= 1_000) return value.toFixed(2);
  if (absolute >= 1) return value.toFixed(3);
  if (absolute >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

export type TradingDrawingLineStyle = "solid" | "dashed" | "dotted";

export interface TradingDrawingStyle {
  color?: string;
  textBackgroundColor?: string;
  fontSize?: number;
  bold?: boolean;
  lineStyle?: TradingDrawingLineStyle;
  lineWidth?: number;
}

const TRADING_DRAWING_COLORS = [
  "#000000", "#4b5563", "#787b86", "#b2b5be", "#ffffff",
  "#ef5350", "#ff9800", "#f6bf26", "#8bc34a", "#22ab94", "#26c6da", "#2962ff", "#7b61ff", "#ab47bc", "#ec407a",
  "#b71c1c", "#e65100", "#9e6c00", "#33691e", "#00695c", "#00838f", "#0d47a1", "#4527a0", "#6a1b9a", "#ad1457",
] as const;

export type TradingDrawingToolId =
  | "cursor"
  | "crosshair"
  | "eraser"
  | "trend-line"
  | "ray"
  | "extended-line"
  | "info-line"
  | "trend-angle"
  | "horizontal-line"
  | "horizontal-ray"
  | "vertical-line"
  | "cross-line"
  | "arrow"
  | "parallel-channel"
  | "regression-trend"
  | "flat-top-bottom"
  | "disjoint-channel"
  | "pitchfork"
  | "schiff-pitchfork"
  | "modified-schiff-pitchfork"
  | "inside-pitchfork"
  | "gann-box"
  | "gann-square"
  | "gann-fan"
  | "fib-retracement"
  | "fib-trend-extension"
  | "fib-speed-fan"
  | "fib-time-zone"
  | "fib-circles"
  | "fib-spiral"
  | "fib-channel"
  | "fib-wedge"
  | "pitchfan"
  | "brush"
  | "highlighter"
  | "path"
  | "rectangle"
  | "rotated-rectangle"
  | "circle"
  | "ellipse"
  | "triangle"
  | "arc"
  | "curve"
  | "double-curve"
  | "polyline"
  | "text"
  | "anchored-text"
  | "note"
  | "price-note"
  | "signpost"
  | "callout"
  | "comment"
  | "arrow-marker"
  | "arrow-up"
  | "arrow-down"
  | "flag"
  | "xabcd"
  | "cypher"
  | "head-shoulders"
  | "abcd"
  | "triangle-pattern"
  | "three-drives"
  | "elliott-impulse"
  | "elliott-correction"
  | "elliott-triangle"
  | "cyclic-lines"
  | "long-position"
  | "short-position"
  | "forecast"
  | "date-range"
  | "price-range"
  | "date-price-range"
  | "bars-pattern"
  | "ghost-feed"
  | "projection"
  | "fixed-range-volume"
  | "measure";

type TradingDrawingKind =
  | "cursor"
  | "eraser"
  | "line"
  | "ray"
  | "extended"
  | "horizontal"
  | "horizontal-ray"
  | "vertical"
  | "cross"
  | "arrow"
  | "channel"
  | "pitchfork"
  | "gann"
  | "fib"
  | "fib-time"
  | "fib-circle"
  | "freehand"
  | "rectangle"
  | "rotated-rectangle"
  | "ellipse"
  | "triangle"
  | "arc"
  | "curve"
  | "polyline"
  | "text"
  | "marker"
  | "pattern"
  | "position"
  | "range"
  | "projection"
  | "measure";

export interface TradingDrawingToolDefinition {
  id: TradingDrawingToolId;
  label: string;
  group: TradingDrawingGroupId;
  kind: TradingDrawingKind;
  icon: string;
  freehand?: boolean;
}

export type TradingDrawingPlacementMode = "single-click" | "two-click" | "three-click" | "multi-click" | "drag";

const TRADING_PATTERN_POINT_COUNTS: Readonly<Partial<Record<TradingDrawingToolId, number>>> = {
  xabcd: 5,
  cypher: 5,
  "head-shoulders": 7,
  abcd: 4,
  "triangle-pattern": 4,
  "three-drives": 7,
  "elliott-impulse": 6,
  "elliott-correction": 4,
  "elliott-triangle": 6,
};

export function tradingDrawingRequiredPointCount(
  definition: TradingDrawingToolDefinition,
) {
  if (definition.freehand) return 0;
  const patternPointCount = TRADING_PATTERN_POINT_COUNTS[definition.id];
  if (patternPointCount) return patternPointCount;
  if (definition.id === "price-note") return 2;
  if (definition.kind === "triangle") return 3;
  if (
    definition.kind === "horizontal"
    || definition.kind === "horizontal-ray"
    || definition.kind === "vertical"
    || definition.kind === "cross"
    || definition.kind === "text"
    || definition.kind === "marker"
  ) return 1;
  return 2;
}

export function tradingDrawingPlacementMode(
  definition: TradingDrawingToolDefinition,
): TradingDrawingPlacementMode {
  if (definition.freehand) return "drag";
  const requiredPointCount = tradingDrawingRequiredPointCount(definition);
  if (requiredPointCount === 1) return "single-click";
  if (requiredPointCount === 2) return "two-click";
  if (requiredPointCount === 3) return "three-click";
  return "multi-click";
}

export type TradingDrawingGroupId =
  | "cursor"
  | "trend"
  | "channel"
  | "gann-fib"
  | "brush"
  | "geometry"
  | "annotation"
  | "pattern"
  | "prediction";

interface TradingDrawingGroupDefinition {
  id: TradingDrawingGroupId;
  label: string;
  icon: string;
  defaultTool: TradingDrawingToolId;
}

const tool = (
  id: TradingDrawingToolId,
  label: string,
  group: TradingDrawingGroupId,
  kind: TradingDrawingKind,
  icon: string,
  freehand = false,
): TradingDrawingToolDefinition => ({ id, label, group, kind, icon, freehand });

export const TRADING_DRAWING_TOOLS: ReadonlyArray<TradingDrawingToolDefinition> = [
  tool("cursor", "光标", "cursor", "cursor", "cursor"),
  tool("crosshair", "十字光标", "cursor", "cursor", "crosshair"),
  tool("eraser", "删除单个绘图", "cursor", "eraser", "eraser"),

  tool("trend-line", "趋势线", "trend", "line", "trend"),
  tool("ray", "射线", "trend", "ray", "ray"),
  tool("extended-line", "延长线", "trend", "extended", "extended"),
  tool("info-line", "信息线", "trend", "measure", "measure"),
  tool("trend-angle", "趋势角度", "trend", "measure", "angle"),
  tool("horizontal-line", "水平线", "trend", "horizontal", "horizontal"),
  tool("horizontal-ray", "水平射线", "trend", "horizontal-ray", "ray"),
  tool("vertical-line", "垂直线", "trend", "vertical", "vertical"),
  tool("cross-line", "十字线", "trend", "cross", "crosshair"),
  tool("arrow", "箭头", "trend", "arrow", "arrow"),

  tool("parallel-channel", "平行通道", "channel", "channel", "channel"),
  tool("regression-trend", "回归趋势", "channel", "channel", "regression"),
  tool("flat-top-bottom", "平顶/底", "channel", "channel", "flat-channel"),
  tool("disjoint-channel", "不连续通道", "channel", "channel", "channel"),
  tool("pitchfork", "安德鲁音叉", "channel", "pitchfork", "pitchfork"),
  tool("schiff-pitchfork", "希夫音叉", "channel", "pitchfork", "pitchfork"),
  tool("modified-schiff-pitchfork", "修正希夫音叉", "channel", "pitchfork", "pitchfork"),
  tool("inside-pitchfork", "内部音叉", "channel", "pitchfork", "pitchfork"),

  tool("gann-box", "江恩箱", "gann-fib", "gann", "gann"),
  tool("gann-square", "江恩正方形", "gann-fib", "gann", "gann"),
  tool("gann-fan", "江恩扇形", "gann-fib", "gann", "fan"),
  tool("fib-retracement", "斐波那契回撤", "gann-fib", "fib", "fib"),
  tool("fib-trend-extension", "趋势斐波那契扩展", "gann-fib", "fib", "fib"),
  tool("fib-speed-fan", "斐波那契速度阻力扇", "gann-fib", "gann", "fan"),
  tool("fib-time-zone", "斐波那契时间周期", "gann-fib", "fib-time", "time-zone"),
  tool("fib-circles", "斐波那契圆", "gann-fib", "fib-circle", "circle"),
  tool("fib-spiral", "斐波那契螺旋", "gann-fib", "fib-circle", "spiral"),
  tool("fib-channel", "斐波那契通道", "gann-fib", "fib", "channel"),
  tool("fib-wedge", "斐波那契楔形", "gann-fib", "gann", "wedge"),
  tool("pitchfan", "音叉扇形", "gann-fib", "gann", "fan"),

  tool("brush", "画笔", "brush", "freehand", "brush", true),
  tool("highlighter", "荧光笔", "brush", "freehand", "highlighter", true),
  tool("path", "路径", "brush", "freehand", "path", true),

  tool("rectangle", "矩形", "geometry", "rectangle", "rectangle"),
  tool("rotated-rectangle", "旋转矩形", "geometry", "rotated-rectangle", "rotated-rectangle"),
  tool("circle", "圆形", "geometry", "ellipse", "circle"),
  tool("ellipse", "椭圆", "geometry", "ellipse", "ellipse"),
  tool("triangle", "三角形", "geometry", "triangle", "triangle"),
  tool("arc", "圆弧", "geometry", "arc", "arc"),
  tool("curve", "曲线", "geometry", "curve", "curve"),
  tool("double-curve", "双曲线", "geometry", "curve", "double-curve"),
  tool("polyline", "折线", "geometry", "polyline", "polyline"),

  tool("text", "文本", "annotation", "text", "text"),
  tool("anchored-text", "锚定文本", "annotation", "text", "anchored-text"),
  tool("note", "注释", "annotation", "text", "note"),
  tool("price-note", "价格注释", "annotation", "text", "price-note"),
  tool("signpost", "路标", "annotation", "marker", "signpost"),
  tool("callout", "标注框", "annotation", "text", "callout"),
  tool("comment", "评论", "annotation", "marker", "comment"),
  tool("arrow-marker", "箭头标记", "annotation", "marker", "arrow-marker"),
  tool("arrow-up", "向上箭头", "annotation", "marker", "arrow-up"),
  tool("arrow-down", "向下箭头", "annotation", "marker", "arrow-down"),
  tool("flag", "旗帜", "annotation", "marker", "flag"),

  tool("xabcd", "XABCD 形态", "pattern", "pattern", "xabcd"),
  tool("cypher", "Cypher 形态", "pattern", "pattern", "cypher"),
  tool("head-shoulders", "头肩形态", "pattern", "pattern", "head-shoulders"),
  tool("abcd", "ABCD 形态", "pattern", "pattern", "abcd"),
  tool("triangle-pattern", "三角形态", "pattern", "pattern", "triangle"),
  tool("three-drives", "三驱形态", "pattern", "pattern", "three-drives"),
  tool("elliott-impulse", "艾略特推动浪", "pattern", "pattern", "elliott"),
  tool("elliott-correction", "艾略特调整浪", "pattern", "pattern", "elliott"),
  tool("elliott-triangle", "艾略特三角浪", "pattern", "pattern", "elliott"),
  tool("cyclic-lines", "周期线", "pattern", "fib-time", "time-zone"),

  tool("long-position", "多头仓位", "prediction", "position", "long-position"),
  tool("short-position", "空头仓位", "prediction", "position", "short-position"),
  tool("forecast", "预测", "prediction", "projection", "forecast"),
  tool("date-range", "日期范围", "prediction", "range", "date-range"),
  tool("price-range", "价格范围", "prediction", "range", "price-range"),
  tool("date-price-range", "日期和价格范围", "prediction", "measure", "measure"),
  tool("bars-pattern", "K线形态", "prediction", "projection", "bars"),
  tool("ghost-feed", "幽灵走势", "prediction", "projection", "ghost"),
  tool("projection", "价格投影", "prediction", "projection", "projection"),
  tool("fixed-range-volume", "固定范围成交量", "prediction", "range", "volume"),
  tool("measure", "测量", "prediction", "measure", "ruler"),
] as const;

const TRADING_DRAWING_GROUPS: ReadonlyArray<TradingDrawingGroupDefinition> = [
  { id: "cursor", label: "光标与删除", icon: "cursor", defaultTool: "cursor" },
  { id: "trend", label: "趋势线工具", icon: "trend", defaultTool: "trend-line" },
  { id: "channel", label: "通道与音叉", icon: "channel", defaultTool: "parallel-channel" },
  { id: "gann-fib", label: "江恩与斐波那契", icon: "fib", defaultTool: "fib-retracement" },
  { id: "brush", label: "画笔", icon: "brush", defaultTool: "brush" },
  { id: "geometry", label: "几何图形", icon: "geometry", defaultTool: "rectangle" },
  { id: "annotation", label: "文本与标注", icon: "text", defaultTool: "text" },
  { id: "pattern", label: "技术形态", icon: "pattern", defaultTool: "xabcd" },
  { id: "prediction", label: "预测与测量", icon: "measure", defaultTool: "long-position" },
] as const;

export function tradingDrawingToolDefinition(id: string | null | undefined) {
  return TRADING_DRAWING_TOOLS.find((candidate) => candidate.id === id) ?? null;
}

export interface TradingDrawingPoint {
  time: number;
  price: number;
}

interface TradingDrawingModel extends TradingDrawingStyle {
  id: string;
  strategyId?: string;
  symbol: string;
  interval?: string;
  /** The chart pane that owns the drawing. Legacy records default to main. */
  drawingScope?: string;
  tool: TradingDrawingToolId;
  points: TradingDrawingPoint[];
  text?: string;
  locked?: boolean;
  viewportAnchor?: ScreenPoint;
  source?: "manual" | "ai";
  colorToken?: TradingAiDrawingColorToken;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TradingDrawingCollisionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TradingAiNoteLayoutRequest {
  id: string;
  anchor: ScreenPoint;
  text: string;
  fontSize: number;
  maxLeaderDistance?: number;
  avoidBoxInteriors?: boolean;
}

export function tradingDrawingIsPriceActionCandlestickPatternLabel(drawing: {
  id: string;
  source?: "manual" | "ai";
  strategyId?: string;
}) {
  return drawing.source === "ai"
    && drawing.strategyId === "price-action"
    && drawing.id.includes("-candlestick-pattern-label-");
}

export function tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing: {
  id: string;
  source?: "manual" | "ai";
  strategyId?: string;
  tool: TradingDrawingToolId;
}) {
  return drawing.source === "ai"
    && drawing.strategyId === "price-action"
    && drawing.tool === "ellipse"
    && drawing.id.includes("-candlestick-pattern-")
    && !drawing.id.includes("-candlestick-pattern-label-");
}

export function tradingDrawingIsGannTheoryBox(drawing: {
  source?: "manual" | "ai";
  strategyId?: string;
  tool: TradingDrawingToolId;
}) {
  return drawing.source === "ai"
    && drawing.strategyId === "gann-theory"
    && drawing.tool === "rectangle";
}

export function tradingDrawingPriceActionCandlestickLayerRank(drawing: {
  id: string;
  source?: "manual" | "ai";
  strategyId?: string;
  tool: TradingDrawingToolId;
}) {
  if (tradingDrawingIsPriceActionCandlestickPatternLabel(drawing)) return 2;
  if (tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing)) return 1;
  return 0;
}

export function tradingDrawingScreenPointVisible(
  point: ScreenPoint,
  bounds: { width: number; height: number },
) {
  return point.x >= 0
    && point.x <= bounds.width
    && point.y >= 0
    && point.y <= bounds.height;
}

export interface TradingDrawingAxisMarkerPoint {
  point: TradingDrawingPoint;
  showPrice: boolean;
  showTime: boolean;
}

export interface TradingDrawingDraftProgress {
  points: TradingDrawingPoint[];
  confirmedPointCount: number;
  complete: boolean;
}

export function tradingDrawingAdvanceDraftPoints(
  points: ReadonlyArray<TradingDrawingPoint>,
  confirmedPointCount: number,
  requiredPointCount: number,
  point: TradingDrawingPoint,
): TradingDrawingDraftProgress {
  const nextPoints = points.map((candidate) => ({ ...candidate }));
  const previewIndex = Math.max(confirmedPointCount, 0);
  while (nextPoints.length <= previewIndex) nextPoints.push({ ...point });
  nextPoints[previewIndex] = { ...point };
  const nextConfirmedPointCount = Math.min(previewIndex + 1, Math.max(requiredPointCount, 1));
  const complete = nextConfirmedPointCount >= requiredPointCount;
  if (!complete) nextPoints.push({ ...point });
  return {
    points: nextPoints,
    confirmedPointCount: nextConfirmedPointCount,
    complete,
  };
}

export function tradingDrawingRewindDraftPoints(
  points: ReadonlyArray<TradingDrawingPoint>,
  confirmedPointCount: number,
  previewPoint: TradingDrawingPoint,
): TradingDrawingDraftProgress {
  const safeConfirmedPointCount = Math.min(
    Math.max(Math.trunc(confirmedPointCount), 0),
    points.length,
  );
  const nextConfirmedPointCount = Math.max(safeConfirmedPointCount - 1, 0);
  if (nextConfirmedPointCount === 0) {
    return { points: [], confirmedPointCount: 0, complete: false };
  }
  return {
    points: [
      ...points.slice(0, nextConfirmedPointCount).map((point) => ({ ...point })),
      { ...previewPoint },
    ],
    confirmedPointCount: nextConfirmedPointCount,
    complete: false,
  };
}

export function tradingDrawingAxisMarkerPoints(
  definition: TradingDrawingToolDefinition,
  points: ReadonlyArray<TradingDrawingPoint>,
): TradingDrawingAxisMarkerPoint[] {
  const first = points[0];
  if (!first || definition.kind === "text" || definition.kind === "marker") return [];
  if (definition.kind === "horizontal") {
    return [{ point: first, showPrice: true, showTime: false }];
  }
  if (definition.kind === "vertical") {
    return [{ point: first, showPrice: false, showTime: true }];
  }
  if (definition.kind === "horizontal-ray" || definition.kind === "cross") {
    return [{ point: first, showPrice: true, showTime: true }];
  }
  if (definition.kind === "triangle" || definition.kind === "pattern") {
    return points.map((point) => ({ point, showPrice: true, showTime: true }));
  }
  const last = points[points.length - 1] ?? first;
  const endpoints = first.time === last.time && first.price === last.price
    ? [first]
    : [first, last];
  return endpoints.map((point) => ({ point, showPrice: true, showTime: true }));
}

/**
 * Horizontal-line prices stay visible on the price axis after the line is
 * deselected. Other drawing types keep the existing selected-only markers.
 */
export function tradingDrawingAlwaysVisibleAxisMarkerPoints(
  definition: TradingDrawingToolDefinition,
  points: ReadonlyArray<TradingDrawingPoint>,
): TradingDrawingAxisMarkerPoint[] {
  return definition.kind === "horizontal"
    ? tradingDrawingAxisMarkerPoints(definition, points)
    : [];
}

export function formatTradingDrawingAxisPrice(value: number) {
  return formatTradingFibonacciPrice(value);
}

export function formatTradingDrawingAxisTime(time: number, timeOffsetSeconds: number) {
  const date = new Date((time + timeOffsetSeconds) * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

type TradingDrawingLineExtension = "segment" | "ray" | "extended";

interface DrawingDragState {
  drawingId: string;
  mode: "handle" | "drawing";
  handleIndex: number;
  startPoint: TradingDrawingPoint;
  handleGrabOffset: ScreenPoint;
  originalPoints: TradingDrawingPoint[];
  originalViewportAnchor?: ScreenPoint;
}

interface SelectionToolbarDragState {
  pointerId: number;
  startClient: ScreenPoint;
  startPosition: ScreenPoint;
}

type TradingDrawingSelectionMenu =
  | "color"
  | "style"
  | "width"
  | "text-input"
  | "text-color"
  | "text-background"
  | "font-size";

export interface TradingDrawingMeasurement {
  seconds: number;
  priceChange: number;
  percentChange: number;
}

export function finiteTradingChartCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function tradingDrawingLogicalToCoordinate(
  logical: number,
  logicalToCoordinate: (integerLogical: number) => unknown,
): number | null {
  if (!Number.isFinite(logical)) return null;
  const lowerLogical = Math.floor(logical);
  const upperLogical = Math.ceil(logical);
  const lowerCoordinate = finiteTradingChartCoordinate(logicalToCoordinate(lowerLogical));
  if (lowerLogical === upperLogical) return lowerCoordinate;
  const upperCoordinate = finiteTradingChartCoordinate(logicalToCoordinate(upperLogical));
  if (lowerCoordinate === null || upperCoordinate === null) return lowerCoordinate ?? upperCoordinate;
  return lowerCoordinate + (upperCoordinate - lowerCoordinate) * (logical - lowerLogical);
}

export function tradingDrawingEllipseGeometry(first: ScreenPoint, second: ScreenPoint) {
  return {
    cx: (first.x + second.x) / 2,
    cy: (first.y + second.y) / 2,
    rx: Math.abs(second.x - first.x) / 2,
    ry: Math.abs(second.y - first.y) / 2,
  };
}

function tradingDrawingEdgeInterval(
  candles: ReadonlyArray<{ time: number }>,
  edge: "start" | "end",
) {
  if (candles.length < 2) return 60;
  if (edge === "start") {
    for (let index = 1; index < candles.length; index += 1) {
      const interval = candles[index].time - candles[index - 1].time;
      if (Number.isFinite(interval) && interval > 0) return interval;
    }
  } else {
    for (let index = candles.length - 1; index > 0; index -= 1) {
      const interval = candles[index].time - candles[index - 1].time;
      if (Number.isFinite(interval) && interval > 0) return interval;
    }
  }
  return 60;
}

export function tradingDrawingTimeAtLogicalIndex(
  candles: ReadonlyArray<{ time: number }>,
  logical: number,
): number | null {
  if (!candles.length || !Number.isFinite(logical)) return null;
  const lastIndex = candles.length - 1;
  if (logical <= 0) return candles[0].time + logical * tradingDrawingEdgeInterval(candles, "start");
  if (logical >= lastIndex) {
    return candles[lastIndex].time + (logical - lastIndex) * tradingDrawingEdgeInterval(candles, "end");
  }
  const lowerIndex = Math.floor(logical);
  const upperIndex = Math.ceil(logical);
  const lowerTime = candles[lowerIndex].time;
  const upperTime = candles[upperIndex].time;
  return lowerTime + (upperTime - lowerTime) * (logical - lowerIndex);
}

export function tradingDrawingLogicalIndexAtTime(
  candles: ReadonlyArray<{ time: number }>,
  time: number,
): number | null {
  if (!candles.length || !Number.isFinite(time)) return null;
  const lastIndex = candles.length - 1;
  if (time <= candles[0].time) {
    return (time - candles[0].time) / tradingDrawingEdgeInterval(candles, "start");
  }
  if (time >= candles[lastIndex].time) {
    return lastIndex + (time - candles[lastIndex].time) / tradingDrawingEdgeInterval(candles, "end");
  }
  let lowerIndex = 0;
  let upperIndex = lastIndex;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (candles[middleIndex].time <= time) lowerIndex = middleIndex;
    else upperIndex = middleIndex;
  }
  const lowerTime = candles[lowerIndex].time;
  const upperTime = candles[upperIndex].time;
  const span = upperTime - lowerTime;
  return span > 0 ? lowerIndex + (time - lowerTime) / span : lowerIndex;
}

export function tradingDrawingIsSingleCandlePatternSpan(
  candles: ReadonlyArray<{ time: number }>,
  points: ReadonlyArray<Pick<TradingDrawingPoint, "time">>,
) {
  if (candles.length < 2 || points.length < 2) return false;
  const firstLogical = tradingDrawingLogicalIndexAtTime(candles, points[0].time);
  const lastLogical = tradingDrawingLogicalIndexAtTime(candles, points[points.length - 1].time);
  if (firstLogical === null || lastLogical === null) return false;
  return Math.abs(lastLogical - firstLogical) < 1.5;
}

export function measureTradingDrawing(
  first: TradingDrawingPoint,
  second: TradingDrawingPoint,
): TradingDrawingMeasurement {
  const priceChange = second.price - first.price;
  return {
    seconds: Math.round(second.time - first.time),
    priceChange,
    percentChange: first.price ? (priceChange / first.price) * 100 : 0,
  };
}

export function clampTradingDrawingToolbarPosition(
  position: ScreenPoint,
  bounds: { width: number; height: number },
  toolbarSize: { width: number; height: number },
): ScreenPoint {
  const inset = 8;
  return {
    x: Math.min(Math.max(position.x, inset), Math.max(inset, bounds.width - toolbarSize.width - inset)),
    y: Math.min(Math.max(position.y, inset), Math.max(inset, bounds.height - toolbarSize.height - inset)),
  };
}

export function positionTradingAiTextSizeToolbar(
  textBounds: TradingDrawingCollisionRect,
  bounds: { width: number; height: number },
  toolbarSize: { width: number; height: number },
  placement: "auto" | "left" = "auto",
): ScreenPoint {
  const inset = 8;
  const gap = 6;
  const left = textBounds.x - toolbarSize.width - gap;
  const x = placement === "left"
    ? Math.max(inset, left)
    : left >= inset
    ? left
    : textBounds.x + textBounds.width + gap;
  const y = textBounds.y + (textBounds.height - toolbarSize.height) / 2;
  return clampTradingDrawingToolbarPosition({ x, y }, bounds, toolbarSize);
}

export function tradingAiTextNextFontSize(
  value: unknown,
  action: "decrease" | "increase",
) {
  const numericValue = Number(value);
  const current = Number.isFinite(numericValue) ? numericValue : AI_NOTE_FONT_SIZE;
  if (action === "increase") {
    return TRADING_AI_TEXT_FONT_SIZES.find((size) => size > current)
      ?? TRADING_AI_TEXT_FONT_SIZES.at(-1)!;
  }
  return [...TRADING_AI_TEXT_FONT_SIZES].reverse().find((size) => size < current)
    ?? TRADING_AI_TEXT_FONT_SIZES[0];
}

function drawingIcon(name: string) {
  const paths: Record<string, string> = {
    cursor: '<path d="M5 3.5 18 12l-6.1 1.4L9.5 20z"/>',
    crosshair: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3"/>',
    eraser: '<path d="m5 15 7.8-9a2 2 0 0 1 3 0l2.2 2.2a2 2 0 0 1 0 2.8l-7.8 9H6l-2-2zM11 19h9"/>',
    trend: '<path d="M4 18 20 6"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="6" r="1.6"/>',
    ray: '<path d="M4 18 21 5"/><circle cx="4" cy="18" r="1.7"/>',
    extended: '<path d="M2 20 22 4"/><circle cx="8" cy="15.2" r="1.4"/><circle cx="16" cy="8.8" r="1.4"/>',
    measure: '<path d="M4 18 20 6M6 15l3 3m6-12 3 3"/>',
    ruler: '<path d="m5 18 13-13 2 2L7 20zM10 13l2 2m1-5 2 2m1-5 2 2"/>',
    angle: '<path d="M4 19h16M4 19 17 6M9 19a5 5 0 0 0-1.5-3.5"/>',
    horizontal: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.7"/>',
    vertical: '<path d="M12 3v18"/><circle cx="12" cy="12" r="1.7"/>',
    arrow: '<path d="M4 18 20 6m-7 1 7-1-1 7"/>',
    channel: '<path d="M3 16 19 6M5 20 21 10"/>',
    regression: '<path d="M3 17 21 7M4 13 20 4M4 21l16-9"/>',
    "flat-channel": '<path d="M3 7h18M3 17h18"/>',
    pitchfork: '<path d="M4 20 18 5M8 20 22 5M6 17 4 9m0 0 6 2"/>',
    gann: '<rect x="4" y="4" width="16" height="16"/><path d="M4 20 20 4M4 12h16M12 4v16"/>',
    fan: '<path d="M4 20 20 4M4 20 21 11M4 20l9-17M4 20h17"/>',
    fib: '<path d="M4 5h16M4 9h16M4 14h16M4 19h16"/><path d="M7 3v18"/>',
    "time-zone": '<path d="M5 3v18M9 3v18M15 3v18M20 3v18"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
    spiral: '<path d="M13 12c0-2-3-2-3 0 0 3 5 3 5-1 0-5-8-5-8 1 0 7 11 8 13 1"/>',
    wedge: '<path d="M4 20 19 5M4 20l18-7M4 20h18"/>',
    brush: '<path d="M4 18c4-9 6 1 9-7s4-5 7-6"/>',
    highlighter: '<path d="m5 18 3 2L20 8l-4-4zM3 21h9"/>',
    path: '<path d="M3 18c4-12 8 8 12-4 2-6 4-7 6-8"/>',
    geometry: '<rect x="5" y="5" width="14" height="14"/>',
    templates: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    rectangle: '<rect x="4" y="6" width="16" height="12"/>',
    "rotated-rectangle": '<path d="m7 3 14 8-6 10L1 13z"/>',
    triangle: '<path d="m12 4 9 16H3z"/>',
    arc: '<path d="M4 18A10 10 0 0 1 20 6"/>',
    curve: '<path d="M3 18Q12 2 21 17"/>',
    "double-curve": '<path d="M3 8q9 12 18 0M3 16Q12 4 21 16"/>',
    polyline: '<path d="m3 17 5-8 5 5 8-10"/>',
    text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
    "anchored-text": '<path d="M4 5h12M10 5v11M7 16h6M18 18v3m-2-1 2 1 2-1"/>',
    note: '<path d="M5 4h14v12l-5 4H5zM8 8h8M8 12h6"/>',
    "price-note": '<path d="M4 6h12l4 6-4 6H4zM8 10h6M8 14h4"/>',
    signpost: '<path d="M7 5h10l3 4-3 4H7zM12 13v8"/>',
    callout: '<path d="M4 5h16v11H9l-4 4 1-4H4z"/>',
    comment: '<path d="M4 5h16v12H9l-4 3 1-3H4zM8 9h8M8 13h5"/>',
    "arrow-marker": '<path d="M12 21V5m-5 6 5-6 5 6"/>',
    "arrow-up": '<path d="m5 14 7-8 7 8h-4v6H9v-6z"/>',
    "arrow-down": '<path d="m5 10 7 8 7-8h-4V4H9v6z"/>',
    flag: '<path d="M6 21V4m0 1h12l-3 4 3 4H6"/>',
    pattern: '<path d="m3 17 4-8 5 6 4-11 5 13"/>',
    xabcd: '<path d="m2 16 4-9 5 8 5-11 6 13"/><path d="M2 20h20"/>',
    cypher: '<path d="m3 17 5-10 4 8 4-12 5 15"/>',
    "head-shoulders": '<path d="M3 18 7 9l4 4 3-10 3 10 4-4"/>',
    abcd: '<path d="m3 17 5-10 5 8 8-12"/>',
    "three-drives": '<path d="m3 19 3-8 3 5 3-11 3 8 3-10 3 16"/>',
    elliott: '<path d="m3 18 4-10 4 6 4-11 3 8 3-5"/>',
    "long-position": '<rect x="5" y="4" width="14" height="8"/><rect x="5" y="12" width="14" height="8"/><path d="M5 12h14"/>',
    "short-position": '<rect x="5" y="4" width="14" height="8"/><rect x="5" y="12" width="14" height="8"/><path d="M5 12h14"/>',
    forecast: '<path d="M3 18 10 11l4 3 7-9m-5 0h5v5"/>',
    "date-range": '<path d="M5 4v16M19 4v16M5 12h14m-3-3 3 3-3 3M8 9l-3 3 3 3"/>',
    "price-range": '<path d="M4 5h16M4 19h16M12 5v14m-3-3 3 3 3-3M9 8l3-3 3 3"/>',
    bars: '<path d="M4 17v-7m4 10V5m4 12V8m4 11V4m4 13V9"/>',
    ghost: '<path d="M4 18c4-10 7 3 11-7 2-4 4-4 6-6" stroke-dasharray="2 2"/>',
    projection: '<path d="M3 18 10 10l4 4 7-9" stroke-dasharray="3 2"/>',
    volume: '<path d="M4 20v-6h3v6m2 0V8h3v12m2 0V4h3v16m2 0v-9h2v9"/>',
    undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>',
    redo: '<path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6"/>',
    magnet: '<path d="M6 4v9a6 6 0 0 0 12 0V4h-4v9a2 2 0 0 1-4 0V4z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M16 10V7a4 4 0 0 0-7-2"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M3 3l18 18M9.5 6.4A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.2 7.3C3.8 9.1 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3-.5"/>',
    pin: '<path d="m9 3 6 2-1 5 4 4-5 1-4 6v-7l-4-4 5-1z"/>',
    zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/>',
    "zoom-out": '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/>',
    reset: '<path d="M4 4v6h6M5.7 16.4A8 8 0 1 0 4.3 9.2"/>',
    color: '<path d="m5 18 2.2-5.5L16.7 3a2 2 0 0 1 2.8 2.8L10 15.3zM4 21h16"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 9v11h10V9M10.5 11v6M13.5 11v6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.trend}</svg>`;
}

function renderDrawingToolMenu(group: TradingDrawingGroupDefinition) {
  const tools = TRADING_DRAWING_TOOLS.filter((candidate) => candidate.group === group.id);
  return `
    <section class="trading-drawing-tool-menu" data-drawing-tool-menu="${group.id}" role="menu" aria-label="${group.label}" hidden>
      <header><strong>${group.label}</strong><span>${tools.length} 项</span></header>
      <div>
        ${tools.map((candidate) => `
          <button type="button" role="menuitemradio" aria-checked="false" data-drawing-action="select-tool" data-drawing-tool="${candidate.id}" title="${candidate.label}">
            ${drawingIcon(candidate.icon)}<span>${candidate.label}</span><i aria-hidden="true"></i>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function toolbarAction(
  action: string,
  label: string,
  icon: string,
  extra = "",
) {
  return `
    <button type="button" class="trading-drawing-action" data-drawing-action="${action}" aria-label="${label}" title="${label}" ${extra}>
      ${drawingIcon(icon)}
    </button>
  `;
}

export function renderTradingDrawingToolbar() {
  return `
    <aside class="trading-drawing-toolbar" data-drawing-toolbar aria-label="K线绘图工具">
      <div class="trading-drawing-toolbar-head" aria-hidden="true"></div>
      <div class="trading-drawing-toolbar-scroll">
        ${TRADING_DRAWING_GROUPS.map((group) => `
          <div class="trading-drawing-group" data-drawing-group="${group.id}">
            <button type="button" class="trading-drawing-primary" data-drawing-action="select-group-tool" data-drawing-group-id="${group.id}" data-drawing-tool="${group.defaultTool}" aria-label="${group.label}" title="${group.label}">
              ${drawingIcon(group.icon)}
            </button>
            <button type="button" class="trading-drawing-disclosure" data-drawing-action="toggle-tool-menu" data-drawing-group-id="${group.id}" aria-label="展开${group.label}" aria-haspopup="menu" aria-expanded="false">
            <svg viewBox="0 0 8 8" aria-hidden="true"><path d="m3 2 2 2-2 2"/></svg>
            </button>
          </div>
        `).join("")}
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        ${toolbarAction("measure", "快速测量（Shift + 点击或拖动）", "ruler")}
        ${toolbarAction("zoom-in", "框选放大（点击起点和终点，或拖动框选）", "zoom")}
        ${toolbarAction("zoom-out", "缩小", "zoom-out")}
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        ${toolbarAction("toggle-magnet", "磁吸到K线价格", "magnet", 'aria-pressed="false"')}
        ${toolbarAction("toggle-stay", "保持绘图模式", "pin", 'aria-pressed="false"')}
        ${toolbarAction("toggle-lock", "锁定全部绘图", "lock", 'aria-pressed="false"')}
        ${toolbarAction("toggle-visibility", "隐藏全部绘图", "eye", 'aria-pressed="false"')}
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        ${toolbarAction("undo", "撤销绘图", "undo", "disabled")}
        ${toolbarAction("redo", "重做绘图", "redo", "disabled")}
        ${toolbarAction("clear", "清空本会话所有绘图", "trash")}
      </div>
      ${TRADING_DRAWING_GROUPS.map(renderDrawingToolMenu).join("")}
      <p class="trading-drawing-status" data-drawing-status aria-live="polite">光标</p>
    </aside>
    <dialog
      class="trading-drawing-clear-dialog"
      data-drawing-clear-dialog
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="trading-drawing-clear-title"
      aria-describedby="trading-drawing-clear-description"
    >
      <header>
        <h2 id="trading-drawing-clear-title">清空本会话所有绘图？</h2>
      </header>
      <p id="trading-drawing-clear-description">本会话的手动绘图、AI 绘图及历史记录都将被永久删除，其他会话不受影响。此操作无法撤销。</p>
      <footer>
        <button type="button" data-drawing-clear-action="cancel">取消</button>
        <button type="button" class="danger" data-drawing-clear-action="confirm">确认清空</button>
      </footer>
    </dialog>
  `;
}

function selectionAction(action: string, label: string, content: string, extra = "") {
  return `
    <button type="button" class="trading-drawing-selection-action" data-drawing-selection-action="${action}" aria-label="${label}" title="${label}" ${extra}>
      ${content}
    </button>
  `;
}

function renderTradingDrawingSelectionToolbar() {
  return `
    <div class="trading-drawing-selection" data-drawing-selection role="toolbar" aria-label="绘图选项" hidden>
      <span class="trading-drawing-selection-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <div class="trading-drawing-selection-mode" data-drawing-selection-mode="drawing">
        ${selectionAction("reset", "恢复默认", drawingIcon("reset"))}
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-color", "选择颜色", drawingIcon("color"), 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover color" data-drawing-selection-popover="color" role="menu" aria-label="选择颜色" hidden>
            <strong>选择颜色</strong>
            <div class="trading-drawing-color-grid">
              ${TRADING_DRAWING_COLORS.map((color) => `<button type="button" data-drawing-selection-action="set-color" data-drawing-color="${color}" role="menuitemradio" aria-checked="false" aria-label="颜色 ${color}" style="--drawing-swatch:${color}"><span></span></button>`).join("")}
            </div>
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-style", "选择样式", '<span class="trading-drawing-line-preview" data-drawing-style-preview></span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact" data-drawing-selection-popover="style" role="menu" aria-label="选择样式" hidden>
            ${(["solid", "dotted", "dashed"] as TradingDrawingLineStyle[]).map((style) => `<button type="button" data-drawing-selection-action="set-style" data-drawing-style="${style}" role="menuitemradio" aria-checked="false" aria-label="${style === "solid" ? "实线" : style === "dotted" ? "点线" : "虚线"}"><span class="trading-drawing-line-preview ${style}"></span></button>`).join("")}
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-width", "选择线宽", '<span class="trading-drawing-width-preview" data-drawing-width-preview></span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact" data-drawing-selection-popover="width" role="menu" aria-label="选择线宽" hidden>
            ${[1, 2, 3, 4].map((width) => `<button type="button" data-drawing-selection-action="set-width" data-drawing-width="${width}" role="menuitemradio" aria-checked="false" aria-label="${width} 像素"><span class="trading-drawing-width-preview" style="--drawing-width:${width}px"></span></button>`).join("")}
          </div>
        </div>
        ${selectionAction("toggle-lock", "锁定", drawingIcon("lock"), 'aria-pressed="false"')}
        ${selectionAction("delete", "删除", drawingIcon("trash"))}
      </div>
      <div class="trading-drawing-selection-mode text" data-drawing-selection-mode="text" hidden>
        ${selectionAction("reset-text", "恢复默认文本样式", drawingIcon("templates"))}
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("edit-text", "文本输入", drawingIcon("color"), 'aria-haspopup="dialog" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover text-input" data-drawing-selection-popover="text-input" role="dialog" aria-label="文本输入" hidden>
            <header><strong data-drawing-text-input-title>文本输入</strong>${selectionAction("close-text-input", "关闭文本输入", "×")}</header>
            <textarea data-drawing-text-input maxlength="240" placeholder="请输入内容…"></textarea>
            <footer>
              <button type="button" data-drawing-selection-action="clear-text">清空</button>
              <button type="button" class="primary" data-drawing-selection-action="confirm-text">确定</button>
            </footer>
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-text-color", "文本颜色", '<span class="trading-drawing-text-symbol">A</span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover color" data-drawing-selection-popover="text-color" role="menu" aria-label="文本颜色" hidden>
            <strong>文本颜色</strong>
            <div class="trading-drawing-color-grid">
              ${TRADING_DRAWING_COLORS.map((color) => `<button type="button" data-drawing-selection-action="set-text-color" data-drawing-text-color="${color}" role="menuitemradio" aria-checked="false" aria-label="文本颜色 ${color}" style="--drawing-swatch:${color}"><span></span></button>`).join("")}
            </div>
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-text-background", "背景颜色", '<span class="trading-drawing-background-symbol"></span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover color" data-drawing-selection-popover="text-background" role="menu" aria-label="背景颜色" hidden>
            <strong>背景颜色</strong>
            <div class="trading-drawing-color-grid">
              <button type="button" class="transparent" data-drawing-selection-action="set-text-background" data-drawing-background-color="transparent" role="menuitemradio" aria-checked="false" aria-label="透明背景"><span></span></button>
              ${TRADING_DRAWING_COLORS.map((color) => `<button type="button" data-drawing-selection-action="set-text-background" data-drawing-background-color="${color}" role="menuitemradio" aria-checked="false" aria-label="背景颜色 ${color}" style="--drawing-swatch:${color}"><span></span></button>`).join("")}
            </div>
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap font-size">
          ${selectionAction("toggle-font-size", "字体大小", '<span class="trading-drawing-font-size" data-drawing-font-size-label>16</span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact font-size" data-drawing-selection-popover="font-size" role="menu" aria-label="字体大小" hidden>
            ${TRADING_TEXT_FONT_SIZES.map((size) => `<button type="button" data-drawing-selection-action="set-font-size" data-drawing-font-size="${size}" role="menuitemradio" aria-checked="false">${size}</button>`).join("")}
          </div>
        </div>
        ${selectionAction("toggle-bold", "加粗", '<span class="trading-drawing-bold-symbol">B</span>', 'aria-pressed="false"')}
        ${selectionAction("toggle-lock", "锁定", drawingIcon("lock"), 'aria-pressed="false"')}
        ${selectionAction("delete", "删除", drawingIcon("trash"))}
      </div>
    </div>
  `;
}

export function renderTradingDrawingLayer() {
  return `
    <svg class="trading-drawing-layer" data-drawing-layer aria-label="K线绘图画布" role="img">
      <defs>
        <marker id="trading-drawing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="none" />
        </marker>
      </defs>
      <g data-trading-order-lines aria-label="账户持仓与委托线"></g>
      <g data-drawing-content></g>
      <g data-ai-drawing-content aria-label="AI 策略绘图"></g>
      <g data-ai-text-hit-content aria-label="AI 文字标注字号调节"></g>
      <g data-ai-drawing-cursor aria-hidden="true"></g>
    </svg>
    <div class="trading-order-position-cards" data-trading-order-position-cards></div>
    <div class="trading-drawing-axis-markers" data-drawing-axis-markers aria-hidden="true"></div>
    <div class="trading-ai-text-size-toolbar" data-ai-text-size-toolbar role="toolbar" aria-label="当前图表全部 AI 标注字号" hidden title="拖动可移动字号工具栏">
      <button type="button" data-ai-text-size-action="decrease" aria-label="缩小当前图表全部标注文字" title="缩小当前图表全部标注文字"><span aria-hidden="true">A−</span></button>
      <button type="button" data-ai-text-size-action="increase" aria-label="放大当前图表全部标注文字" title="放大当前图表全部标注文字"><span aria-hidden="true">A+</span></button>
      <button type="button" class="trading-ai-text-size-toolbar-dismiss trading-chart-toolbar-close" data-ai-text-size-action="dismiss" aria-label="隐藏字号调节（移出图表后重新进入可恢复）" title="隐藏字号调节（移出图表后重新进入可恢复）"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg></button>
    </div>
    ${renderTradingDrawingSelectionToolbar()}
  `;
}

function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function finitePoint(value: unknown): value is TradingDrawingPoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TradingDrawingPoint>;
  return Number.isFinite(candidate.time) && Number.isFinite(candidate.price);
}

function drawingColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

function tradingDrawingStyleFromModel(
  drawing: Pick<TradingDrawingModel, "color" | "textBackgroundColor" | "fontSize" | "bold" | "lineStyle" | "lineWidth">,
): TradingDrawingStyle {
  const color = drawingColor(drawing.color);
  const textBackgroundColor = drawingColor(drawing.textBackgroundColor);
  const lineStyle = drawingLineStyle(drawing.lineStyle);
  const lineWidth = drawingLineWidth(drawing.lineWidth);
  const fontSize = drawingTextFontSize(drawing.fontSize);
  return {
    ...(color ? { color } : {}),
    ...(textBackgroundColor ? { textBackgroundColor } : {}),
    ...(fontSize ? { fontSize } : {}),
    ...(drawing.bold ? { bold: true } : {}),
    ...(lineStyle ? { lineStyle } : {}),
    ...(lineWidth !== undefined ? { lineWidth } : {}),
  };
}

function normalizeTradingDrawingStyle(value: unknown): TradingDrawingStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as Partial<TradingDrawingStyle>;
  return tradingDrawingStyleFromModel({
    color: candidate.color,
    textBackgroundColor: candidate.textBackgroundColor,
    fontSize: candidate.fontSize,
    bold: candidate.bold,
    lineStyle: candidate.lineStyle,
    lineWidth: candidate.lineWidth,
  });
}

const TRADING_AI_DRAWING_COLOR_VARIABLES: Readonly<Record<TradingAiDrawingColorToken, string>> = {
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

const TRADING_AI_DRAWING_TOOLS = new Set<TradingDrawingToolId>([
  "path",
  "rectangle",
  "circle",
  "ellipse",
  "arrow-up",
  "arrow-down",
  "note",
  "text",
]);

const TRADING_AI_DRAWING_COLOR_TOKENS = new Set<TradingAiDrawingColorToken>(
  Object.keys(TRADING_AI_DRAWING_COLOR_VARIABLES) as TradingAiDrawingColorToken[],
);

interface TradingAiDrawingContextItem {
  symbol: string;
  interval?: string;
}

export function tradingAiDrawingMatchesContext(
  drawing: TradingAiDrawingContextItem,
  symbol: string,
  interval: string,
) {
  return drawing.symbol === symbol && drawing.interval === interval;
}

export function tradingManualDrawingMatchesContext(
  drawing: Pick<TradingDrawingModel, "symbol" | "interval" | "drawingScope">,
  symbol: string,
  _interval: string,
  drawingScope = "main",
) {
  // Manual drawings are anchored to market time/price coordinates, not to a
  // particular aggregation period. Keep them visible when the user changes
  // 15m/1h/4h/etc.; the pane scope still prevents a price drawing from being
  // rendered over an indicator pane (and vice versa).
  return drawing.symbol === symbol
    && (drawing.drawingScope || "main") === normalizeTradingDrawingScope(drawingScope);
}

function normalizeTradingDrawingScope(value: unknown) {
  return String(value || "main").trim().slice(0, 80) || "main";
}

export function replaceTradingAiDrawingContext<T extends TradingAiDrawingContextItem>(
  drawings: ReadonlyArray<T>,
  symbol: string,
  interval: string,
  replacements: ReadonlyArray<T> = [],
) {
  return [
    ...drawings.filter((drawing) => !tradingAiDrawingMatchesContext(drawing, symbol, interval)),
    ...replacements,
  ];
}

function tradingAiDrawingColor(token: TradingAiDrawingColorToken | undefined) {
  const variable = token ? TRADING_AI_DRAWING_COLOR_VARIABLES[token] : undefined;
  return variable ? `var(${variable})` : undefined;
}

function drawingLineStyle(value: unknown): TradingDrawingLineStyle | undefined {
  return value === "solid" || value === "dashed" || value === "dotted" ? value : undefined;
}

function drawingLineWidth(value: unknown) {
  const width = Number(value);
  return Number.isFinite(width) && width >= 0.5 && width <= 4 ? width : undefined;
}

function drawingTextFontSize(value: unknown) {
  const size = Number(value);
  return TRADING_AI_TEXT_FONT_SIZES.includes(size as typeof TRADING_AI_TEXT_FONT_SIZES[number]) ? size : undefined;
}

function drawingViewportAnchor(value: unknown): ScreenPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ScreenPoint>;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return undefined;
  if ((candidate.x as number) < 0 || (candidate.x as number) > 1) return undefined;
  if ((candidate.y as number) < 0 || (candidate.y as number) > 1) return undefined;
  return { x: candidate.x as number, y: candidate.y as number };
}

function loadStoredDrawingValues(
  kind: "manual" | "ai",
  storageSessionId: string,
) {
  const storageKey = tradingDrawingSessionStorageKey(kind, storageSessionId);
  const legacyStorageKey = kind === "ai"
    ? LEGACY_TRADING_AI_DRAWINGS_STORAGE_KEY
    : LEGACY_TRADING_DRAWINGS_STORAGE_KEY;
  let serialized = window.localStorage.getItem(storageKey);
  if (serialized === null) {
    const legacySerialized = window.localStorage.getItem(legacyStorageKey);
    if (legacySerialized !== null) {
      serialized = legacySerialized;
      window.localStorage.setItem(storageKey, legacySerialized);
      window.localStorage.removeItem(legacyStorageKey);
    }
  }
  const parsed = JSON.parse(serialized || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function loadStoredDrawings(storageSessionId: string): TradingDrawingModel[] {
  try {
    const parsed = loadStoredDrawingValues("manual", storageSessionId);
    return parsed.flatMap((value): TradingDrawingModel[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<TradingDrawingModel>;
      const definition = tradingDrawingToolDefinition(candidate.tool);
      if (!definition || definition.kind === "cursor" || definition.kind === "eraser") return [];
      const storedPoints = Array.isArray(candidate.points)
        ? candidate.points.filter(finitePoint).slice(0, 4000)
        : [];
      const points = tradingDrawingPlacementMode(definition) === "single-click"
        ? storedPoints.slice(0, 1)
        : storedPoints;
      if (!points.length) return [];
      return [{
        id: String(candidate.id || crypto.randomUUID()),
        symbol: String(candidate.symbol || ""),
        interval: typeof candidate.interval === "string" && candidate.interval.trim()
          ? candidate.interval.trim().slice(0, 24)
          : undefined,
        drawingScope: normalizeTradingDrawingScope(candidate.drawingScope),
        tool: definition.id,
        points,
        text: typeof candidate.text === "string" ? candidate.text.slice(0, 240) : undefined,
        locked: candidate.locked === true,
        color: drawingColor(candidate.color),
        textBackgroundColor: drawingColor(candidate.textBackgroundColor),
        fontSize: drawingTextFontSize(candidate.fontSize),
        bold: candidate.bold === true,
        lineStyle: drawingLineStyle(candidate.lineStyle),
        lineWidth: drawingLineWidth(candidate.lineWidth),
        viewportAnchor: definition.id === "anchored-text"
          ? drawingViewportAnchor(candidate.viewportAnchor)
          : undefined,
      }];
    }).slice(-600);
  } catch {
    return [];
  }
}

function loadStoredAiDrawings(storageSessionId: string): TradingDrawingModel[] {
  try {
    const parsed = loadStoredDrawingValues("ai", storageSessionId);
    return parsed.flatMap((value): TradingDrawingModel[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<TradingDrawingModel>;
      const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 160) : "";
      const symbol = typeof candidate.symbol === "string" ? candidate.symbol.trim().slice(0, 120) : "";
      const interval = typeof candidate.interval === "string" ? candidate.interval.trim().slice(0, 24) : "";
      const colorToken = candidate.colorToken;
      const strategyId = typeof candidate.strategyId === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(candidate.strategyId)
        ? candidate.strategyId
        : undefined;
      if (
        !id
        || !symbol
        || !interval
        || candidate.source !== "ai"
        || !TRADING_AI_DRAWING_TOOLS.has(candidate.tool as TradingDrawingToolId)
        || !TRADING_AI_DRAWING_COLOR_TOKENS.has(colorToken as TradingAiDrawingColorToken)
        || (String(colorToken).startsWith("strategy-") && !strategyId)
      ) {
        return [];
      }
      const points = Array.isArray(candidate.points)
        ? candidate.points.filter(finitePoint).slice(0, 64)
        : [];
      if (!points.length) return [];
      return [{
        id,
        strategyId,
        symbol,
        interval,
        tool: candidate.tool as TradingDrawingToolId,
        points,
        text: typeof candidate.text === "string" ? candidate.text.slice(0, 120) : undefined,
        locked: true,
        source: "ai",
        colorToken: colorToken as TradingAiDrawingColorToken,
        lineStyle: drawingLineStyle(candidate.lineStyle),
        lineWidth: drawingLineWidth(candidate.lineWidth),
        fontSize: drawingTextFontSize(candidate.fontSize),
        bold: candidate.bold === true,
      }];
    }).slice(-MAX_STORED_AI_DRAWINGS);
  } catch {
    return [];
  }
}

function formatDuration(seconds: number) {
  const absolute = Math.abs(seconds);
  if (absolute >= 86_400) return `${(absolute / 86_400).toFixed(1)}天`;
  if (absolute >= 3_600) return `${(absolute / 3_600).toFixed(1)}小时`;
  if (absolute >= 60) return `${Math.round(absolute / 60)}分钟`;
  return `${Math.round(absolute)}秒`;
}

interface TradingDrawingStrokeAppearance {
  opacity: number;
  width?: number;
  style?: TradingDrawingLineStyle;
  dashed?: boolean;
  arrow?: boolean;
}

export function tradingDrawingStrokeDashArray(
  style: TradingDrawingLineStyle | undefined,
  fallbackDashed = false,
) {
  if (style === "dotted") return "2 4";
  if (style === "dashed" || (!style && fallbackDashed)) return "7 5";
  return "";
}

function svgStrokeAttributes(
  appearance: Pick<TradingDrawingStrokeAppearance, "width" | "style" | "dashed">,
  defaultWidth = DEFAULT_DRAWING_LINE_WIDTH,
) {
  const dashArray = tradingDrawingStrokeDashArray(appearance.style, appearance.dashed);
  return `stroke-width="${appearance.width ?? defaultWidth}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ""} vector-effect="non-scaling-stroke"`;
}

function svgLine(
  first: ScreenPoint,
  second: ScreenPoint,
  color: string,
  options: Partial<TradingDrawingStrokeAppearance> = {},
) {
  return `<line x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" stroke="${color}" ${svgStrokeAttributes(options)} ${options.arrow ? 'marker-end="url(#trading-drawing-arrow)"' : ""} opacity="${options.opacity ?? 1}" />`;
}

export function clipTradingDrawingLine(
  first: ScreenPoint,
  second: ScreenPoint,
  bounds: { width: number; height: number },
  extension: TradingDrawingLineExtension,
): [ScreenPoint, ScreenPoint] | null {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return [first, second];
  let minimum = extension === "extended" ? Number.NEGATIVE_INFINITY : 0;
  let maximum = extension === "segment" ? 1 : Number.POSITIVE_INFINITY;
  const constrain = (origin: number, delta: number, lower: number, upper: number) => {
    if (Math.abs(delta) < 0.0001) return origin >= lower && origin <= upper;
    let entry = (lower - origin) / delta;
    let exit = (upper - origin) / delta;
    if (entry > exit) [entry, exit] = [exit, entry];
    minimum = Math.max(minimum, entry);
    maximum = Math.min(maximum, exit);
    return minimum <= maximum;
  };
  if (!constrain(first.x, dx, 0, bounds.width) || !constrain(first.y, dy, 0, bounds.height)) return null;
  return [
    { x: first.x + minimum * dx, y: first.y + minimum * dy },
    { x: first.x + maximum * dx, y: first.y + maximum * dy },
  ];
}

function perpendicularOffset(first: ScreenPoint, second: ScreenPoint, magnitude: number) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  return { x: (-dy / length) * magnitude, y: (dx / length) * magnitude };
}

function patternPoints(first: ScreenPoint, second: ScreenPoint, count = 6) {
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);
  const span = Math.max(right - left, 1);
  const ratios = [0.82, 0.18, 0.68, 0.08, 0.75, 0.28, 0.9, 0.4];
  return Array.from({ length: count }, (_, index) => ({
    x: left + (span * index) / Math.max(count - 1, 1),
    y: top + (bottom - top) * ratios[index % ratios.length],
  }));
}

function pointsAttribute(points: ScreenPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function tradingDrawingGlyphWidth(character: string, fontSize: number) {
  if (/\s/u.test(character)) return fontSize * 0.35;
  if (/[\x00-\xff]/u.test(character)) return fontSize * (/[MW@#%&]/u.test(character) ? 0.88 : 0.62);
  return fontSize;
}

function tradingDrawingLineWidth(line: string, fontSize: number) {
  return Array.from(line).reduce((width, character) => width + tradingDrawingGlyphWidth(character, fontSize), 0);
}

export function tradingDrawingTextLayout(
  text: string,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
  maxWidth = Number.POSITIVE_INFINITY,
) {
  const widthLimit = Number.isFinite(maxWidth) ? Math.max(1, maxWidth) : Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    let line = "";
    let lineWidth = 0;
    const tokens = paragraph.match(/[A-Za-z0-9][A-Za-z0-9,.'’:/+\-]*|\s+|[^\s]/gu) ?? [];
    for (const token of tokens) {
      const tokenWidth = tradingDrawingLineWidth(token, fontSize);
      if (line && lineWidth + tokenWidth > widthLimit) {
        lines.push(line.trimEnd());
        line = "";
        lineWidth = 0;
        if (!token.trim()) continue;
      }
      // Keep English words and prices together; only split a token when it
      // cannot fit on an otherwise empty line (for example a long identifier).
      for (const character of Array.from(token)) {
        const characterWidth = tradingDrawingGlyphWidth(character, fontSize);
        if (line && lineWidth + characterWidth > widthLimit) {
          lines.push(line);
          line = character;
          lineWidth = characterWidth;
        } else {
          line += character;
          lineWidth += characterWidth;
        }
      }
    }
    lines.push(line);
  }
  const normalizedLines = (lines.length ? lines : [""]).slice(0, 8);
  if (lines.length > normalizedLines.length) {
    let finalLine = normalizedLines.at(-1) ?? "";
    while (finalLine && tradingDrawingLineWidth(`${finalLine}…`, fontSize) > widthLimit) {
      finalLine = Array.from(finalLine).slice(0, -1).join("");
    }
    normalizedLines[normalizedLines.length - 1] = `${finalLine}…`;
  }
  const lineWidths = normalizedLines.map((line) => Math.min(widthLimit, tradingDrawingLineWidth(line, fontSize)));
  const lineHeight = Math.round(fontSize * 1.3 * 10) / 10;
  const width = Math.max(8, ...lineWidths);
  return {
    lines: normalizedLines,
    lineWidths,
    lineHeight,
    width,
    height: Math.max(fontSize, normalizedLines.length * lineHeight),
  };
}

export function tradingDrawingRegionLabelGeometry(
  first: ScreenPoint,
  second: ScreenPoint,
  text: string,
  bounds: { width: number; height: number },
  fontSize = AI_NOTE_FONT_SIZE,
) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalizedText || bounds.width <= 0 || bounds.height <= 0) return null;
  const viewportPadding = 6;
  const paddingX = 5;
  const paddingY = 3;
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);
  const availableViewportWidth = Math.max(24, bounds.width - viewportPadding * 2 - paddingX * 2);
  const regionWidth = Math.max(0, right - left);
  const textMaxWidth = Math.min(180, availableViewportWidth, Math.max(56, regionWidth - paddingX * 2));
  const layout = tradingDrawingTextLayout(normalizedText, fontSize, textMaxWidth);
  const width = Math.max(1, Math.min(bounds.width - viewportPadding * 2, layout.width + paddingX * 2));
  const height = layout.height + paddingY * 2;
  const maximumX = Math.max(viewportPadding, bounds.width - width - viewportPadding);
  const x = Math.min(Math.max(left + 4, viewportPadding), maximumX);
  const insideY = top + 4;
  const aboveY = top - height - 3;
  const preferredY = insideY + height <= bottom - 2 || aboveY < viewportPadding
    ? insideY
    : aboveY;
  const maximumY = Math.max(viewportPadding, bounds.height - height - viewportPadding);
  const y = Math.min(Math.max(preferredY, viewportPadding), maximumY);
  return { x, y, width, height, paddingX, paddingY, fontSize, layout };
}

export function renderTradingDrawingRegionLabel(
  first: ScreenPoint,
  second: ScreenPoint,
  text: string,
  color: string,
  bounds: { width: number; height: number },
  fontSize = AI_NOTE_FONT_SIZE,
) {
  const geometry = tradingDrawingRegionLabelGeometry(first, second, text, bounds, fontSize);
  if (!geometry) return "";
  const textX = geometry.x + geometry.paddingX;
  const firstBaseline = geometry.y + geometry.paddingY + geometry.fontSize;
  const lines = geometry.layout.lines.map((line, index) => (
    `<tspan x="${textX}" y="${firstBaseline + index * geometry.layout.lineHeight}">${escapeHtml(line)}</tspan>`
  )).join("");
  return `<g class="trading-drawing-region-label" pointer-events="none">`
    + `<rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="3" fill="var(--trading-market-panel)" fill-opacity="0.92" stroke="${color}" stroke-width="0.8" vector-effect="non-scaling-stroke" />`
    + `<text fill="${color}" font-size="${geometry.fontSize}" font-weight="600">${lines}</text>`
    + `</g>`;
}

export function tradingDrawingTextBoxLayout(
  text: string,
  fontSize: number,
  bounds: { width: number; height: number },
) {
  const maxBoxWidth = Math.max(
    1,
    Math.min(TRADING_TEXT_BOX_MAX_WIDTH, bounds.width - TRADING_TEXT_BOX_VIEWPORT_PADDING * 2),
  );
  const layout = tradingDrawingTextLayout(
    text,
    fontSize,
    Math.max(1, maxBoxWidth - TRADING_TEXT_BOX_PADDING_X * 2),
  );
  return {
    layout,
    boxWidth: Math.min(
      maxBoxWidth,
      Math.max(Math.min(86, maxBoxWidth), layout.width + TRADING_TEXT_BOX_PADDING_X * 2),
    ),
    boxHeight: Math.max(34, layout.height + 16),
  };
}

export function tradingDrawingAiNoteTextLayout(
  text: string,
  fontSize: number,
  bounds: { width: number; height: number },
) {
  const maximumWidth = Math.max(
    1,
    Math.min(AI_NOTE_TEXT_MAX_WIDTH, bounds.width - TRADING_TEXT_BOX_VIEWPORT_PADDING * 2),
  );
  const layout = tradingDrawingTextLayout(text, fontSize, maximumWidth);
  return {
    layout,
    boxWidth: layout.width,
    boxHeight: layout.height,
  };
}

function tradingDrawingConstrainedBoxOrigin(value: number, size: number, limit: number) {
  return Math.min(
    Math.max(value, TRADING_TEXT_BOX_VIEWPORT_PADDING),
    Math.max(TRADING_TEXT_BOX_VIEWPORT_PADDING, limit - size - TRADING_TEXT_BOX_VIEWPORT_PADDING),
  );
}

function tradingDrawingNoteBoxGeometryFromMetrics(
  point: ScreenPoint,
  metrics: ReturnType<typeof tradingDrawingTextBoxLayout>,
  bounds: { width: number; height: number },
  preferredBoxOrigin?: ScreenPoint,
) {
  const boxLeft = tradingDrawingConstrainedBoxOrigin(
    preferredBoxOrigin?.x ?? point.x,
    metrics.boxWidth,
    bounds.width,
  );
  const preferredBoxTop = point.y - metrics.boxHeight - 10;
  const belowBoxTop = point.y + 10;
  const boxTop = tradingDrawingConstrainedBoxOrigin(
    preferredBoxOrigin?.y
      ?? (preferredBoxTop >= TRADING_TEXT_BOX_VIEWPORT_PADDING ? preferredBoxTop : belowBoxTop),
    metrics.boxHeight,
    bounds.height,
  );
  const boxRight = boxLeft + metrics.boxWidth;
  const boxBottom = boxTop + metrics.boxHeight;
  let connectorPoint = {
    x: Math.min(Math.max(point.x, boxLeft), boxRight),
    y: Math.min(Math.max(point.y, boxTop), boxBottom),
  };
  if (
    point.x >= boxLeft
    && point.x <= boxRight
    && point.y >= boxTop
    && point.y <= boxBottom
  ) {
    const edges = [
      { distance: point.x - boxLeft, point: { x: boxLeft, y: point.y } },
      { distance: boxRight - point.x, point: { x: boxRight, y: point.y } },
      { distance: point.y - boxTop, point: { x: point.x, y: boxTop } },
      { distance: boxBottom - point.y, point: { x: point.x, y: boxBottom } },
    ].sort((first, second) => first.distance - second.distance);
    connectorPoint = edges[0].point;
  }
  return {
    ...metrics,
    boxLeft,
    boxTop,
    connectorPoint,
    textStartPoint: {
      x: boxLeft,
      y: boxTop + metrics.layout.lineHeight / 2,
    },
  };
}

export function tradingDrawingNoteBoxGeometry(
  point: ScreenPoint,
  text: string,
  fontSize: number,
  bounds: { width: number; height: number },
  preferredBoxOrigin?: ScreenPoint,
) {
  return tradingDrawingNoteBoxGeometryFromMetrics(
    point,
    tradingDrawingTextBoxLayout(text, fontSize, bounds),
    bounds,
    preferredBoxOrigin,
  );
}

function tradingDrawingRectsOverlap(
  first: TradingDrawingCollisionRect,
  second: TradingDrawingCollisionRect,
  gap = 0,
) {
  return first.x < second.x + second.width + gap
    && first.x + first.width + gap > second.x
    && first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y;
}

function tradingDrawingRectOverlapArea(
  first: TradingDrawingCollisionRect,
  second: TradingDrawingCollisionRect,
) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

export function layoutTradingAiNoteBoxes(
  notes: TradingAiNoteLayoutRequest[],
  bounds: { width: number; height: number },
  candleObstacles: TradingDrawingCollisionRect[],
  boxObstacles: TradingDrawingCollisionRect[] = [],
) {
  const collisionCellSize = 8;
  const collisionColumns = Math.max(1, Math.ceil(bounds.width / collisionCellSize));
  const collisionRows = Math.max(1, Math.ceil(bounds.height / collisionCellSize));
  const collisionGrid = new Uint8Array(collisionColumns * collisionRows);
  for (const obstacle of candleObstacles) {
    const firstColumn = Math.max(0, Math.floor((obstacle.x - AI_NOTE_CANDLE_GAP) / collisionCellSize));
    const lastColumn = Math.min(
      collisionColumns - 1,
      Math.floor((obstacle.x + obstacle.width + AI_NOTE_CANDLE_GAP) / collisionCellSize),
    );
    const firstRow = Math.max(0, Math.floor((obstacle.y - AI_NOTE_CANDLE_GAP) / collisionCellSize));
    const lastRow = Math.min(
      collisionRows - 1,
      Math.floor((obstacle.y + obstacle.height + AI_NOTE_CANDLE_GAP) / collisionCellSize),
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        collisionGrid[row * collisionColumns + column] = 1;
      }
    }
  }
  const integralColumns = collisionColumns + 1;
  const collisionIntegral = new Uint32Array(integralColumns * (collisionRows + 1));
  for (let row = 1; row <= collisionRows; row += 1) {
    let rowTotal = 0;
    for (let column = 1; column <= collisionColumns; column += 1) {
      rowTotal += collisionGrid[(row - 1) * collisionColumns + column - 1];
      collisionIntegral[row * integralColumns + column] = collisionIntegral[(row - 1) * integralColumns + column] + rowTotal;
    }
  }
  const candleCollisionCells = (rect: TradingDrawingCollisionRect) => {
    const firstColumn = Math.max(0, Math.floor(rect.x / collisionCellSize));
    const lastColumn = Math.min(collisionColumns, Math.ceil((rect.x + rect.width) / collisionCellSize));
    const firstRow = Math.max(0, Math.floor(rect.y / collisionCellSize));
    const lastRow = Math.min(collisionRows, Math.ceil((rect.y + rect.height) / collisionCellSize));
    return collisionIntegral[lastRow * integralColumns + lastColumn]
      - collisionIntegral[firstRow * integralColumns + lastColumn]
      - collisionIntegral[lastRow * integralColumns + firstColumn]
      + collisionIntegral[firstRow * integralColumns + firstColumn];
  };
  const placements: Array<{
    id: string;
    geometry: ReturnType<typeof tradingDrawingNoteBoxGeometry>;
  }> = [];
  const occupied: TradingDrawingCollisionRect[] = [];
  for (const [noteIndex, note] of notes.entries()) {
    const metrics = tradingDrawingAiNoteTextLayout(note.text, note.fontSize, bounds);
    const maximumLeaderDistance = Number.isFinite(note.maxLeaderDistance)
      ? Math.max(AI_NOTE_LEADER_GAP, Number(note.maxLeaderDistance))
      : Number.POSITIVE_INFINITY;
    const minimumX = TRADING_TEXT_BOX_VIEWPORT_PADDING;
    const maximumX = Math.max(minimumX, bounds.width - metrics.boxWidth - TRADING_TEXT_BOX_VIEWPORT_PADDING);
    const minimumY = Math.min(
      Math.max(TRADING_TEXT_BOX_VIEWPORT_PADDING, AI_NOTE_TOP_INSET),
      Math.max(TRADING_TEXT_BOX_VIEWPORT_PADDING, bounds.height - metrics.boxHeight - TRADING_TEXT_BOX_VIEWPORT_PADDING),
    );
    const maximumY = Math.max(minimumY, bounds.height - metrics.boxHeight - TRADING_TEXT_BOX_VIEWPORT_PADDING);
    const candidateOrigins: ScreenPoint[] = [];
    const candidateKeys = new Set<string>();
    const addCandidate = (x: number, y: number) => {
      const candidate = {
        x: Math.min(Math.max(x, minimumX), maximumX),
        y: Math.min(Math.max(y, minimumY), maximumY),
      };
      if (
        Number.isFinite(maximumLeaderDistance)
        && Math.abs(candidate.x - note.anchor.x) > maximumLeaderDistance
      ) return;
      const key = `${Math.round(candidate.x * 10)}:${Math.round(candidate.y * 10)}`;
      if (candidateKeys.has(key)) return;
      candidateKeys.add(key);
      candidateOrigins.push(candidate);
    };
    for (const distance of [AI_NOTE_LEADER_GAP, 56, 96, 152, 224, 320]
      .filter((value) => value <= maximumLeaderDistance)) {
      addCandidate(note.anchor.x + distance, note.anchor.y - metrics.boxHeight / 2);
      addCandidate(note.anchor.x - metrics.boxWidth - distance, note.anchor.y - metrics.boxHeight / 2);
      addCandidate(note.anchor.x - metrics.boxWidth / 2, note.anchor.y - metrics.boxHeight - distance);
      addCandidate(note.anchor.x - metrics.boxWidth / 2, note.anchor.y + distance);
      addCandidate(note.anchor.x + distance, note.anchor.y - metrics.boxHeight - distance / 2);
      addCandidate(note.anchor.x + distance, note.anchor.y + distance / 2);
      addCandidate(note.anchor.x - metrics.boxWidth - distance, note.anchor.y + distance / 2);
    }
    if (note.avoidBoxInteriors) {
      for (const obstacle of boxObstacles) {
        addCandidate(
          obstacle.x + obstacle.width + AI_NOTE_CANDLE_GAP,
          note.anchor.y - metrics.boxHeight / 2,
        );
        addCandidate(
          obstacle.x - metrics.boxWidth - AI_NOTE_CANDLE_GAP,
          note.anchor.y - metrics.boxHeight / 2,
        );
        addCandidate(
          note.anchor.x - metrics.boxWidth / 2,
          obstacle.y - metrics.boxHeight - AI_NOTE_CANDLE_GAP,
        );
        addCandidate(
          note.anchor.x - metrics.boxWidth / 2,
          obstacle.y + obstacle.height + AI_NOTE_CANDLE_GAP,
        );
      }
    }
    const horizontalStep = Math.max(36, Math.min(96, metrics.boxWidth * 0.4));
    const verticalStep = Math.max(28, Math.min(72, metrics.boxHeight + AI_NOTE_LAYOUT_GAP));
    for (let y = minimumY; y <= maximumY; y += verticalStep) {
      for (let x = minimumX; x <= maximumX; x += horizontalStep) addCandidate(x, y);
      addCandidate(maximumX, y);
    }
    addCandidate(minimumX, maximumY);
    addCandidate(maximumX, maximumY);

    const ranked = candidateOrigins.map((origin, candidateIndex) => {
      const geometry = tradingDrawingNoteBoxGeometryFromMetrics(
        note.anchor,
        metrics,
        bounds,
        origin,
      );
      const rect = {
        x: geometry.boxLeft,
        y: geometry.boxTop,
        width: geometry.boxWidth,
        height: geometry.boxHeight,
      };
      const noteCollision = occupied.some((candidate) => (
        tradingDrawingRectsOverlap(rect, candidate, AI_NOTE_LAYOUT_GAP)
      ));
      const candleCells = candleCollisionCells(rect);
      const candleCollision = candleCells > 0;
      const boxCollision = note.avoidBoxInteriors && boxObstacles.some((obstacle) => (
        tradingDrawingRectsOverlap(rect, obstacle, AI_NOTE_CANDLE_GAP)
      ));
      const noteOverlapArea = occupied.reduce((total, candidate) => (
        total + tradingDrawingRectOverlapArea(rect, candidate)
      ), 0);
      const leaderDistance = Math.hypot(
        note.anchor.x - geometry.textStartPoint.x,
        note.anchor.y - geometry.textStartPoint.y,
      );
      const textStartsBeforeAnchor = geometry.textStartPoint.x < note.anchor.x + AI_NOTE_LEADER_GAP;
      const verticalSeparation = Math.abs(note.anchor.y - geometry.textStartPoint.y);
      const diagonalThreshold = Math.max(14, note.fontSize * 1.8);
      const nearHorizontalPenalty = Math.max(0, diagonalThreshold - verticalSeparation) * 5_000;
      return {
        geometry,
        rect,
        boxCollision,
        score: (noteCollision ? 1_000_000_000 : 0)
          + (candleCollision ? 1_000_000 : 0)
          + noteOverlapArea * 10_000
          + candleCells * 100
          + (textStartsBeforeAnchor ? 100_000 : 0)
          + nearHorizontalPenalty
          + leaderDistance
          + noteIndex * 0.001
          + candidateIndex * 0.000001,
      };
    }).sort((first, second) => first.score - second.score);
    const selected = ranked.find((candidate) => !candidate.boxCollision);
    if (!selected) continue;
    occupied.push(selected.rect);
    placements.push({ id: note.id, geometry: selected.geometry });
  }
  return placements;
}

export function tradingDrawingPriceNoteBoxGeometry(
  labelPoint: ScreenPoint,
  text: string,
  fontSize: number,
  bounds: { width: number; height: number },
) {
  const metrics = tradingDrawingTextBoxLayout(text, fontSize, bounds);
  return {
    ...metrics,
    boxLeft: tradingDrawingConstrainedBoxOrigin(labelPoint.x + 9, metrics.boxWidth, bounds.width),
    boxTop: tradingDrawingConstrainedBoxOrigin(
      labelPoint.y - metrics.boxHeight / 2,
      metrics.boxHeight,
      bounds.height,
    ),
  };
}

export function tradingDrawingViewportAnchor(
  point: ScreenPoint,
  bounds: { width: number; height: number },
): ScreenPoint {
  return {
    x: Math.min(Math.max(point.x / Math.max(bounds.width, 1), 0), 1),
    y: Math.min(Math.max(point.y / Math.max(bounds.height, 1), 0), 1),
  };
}

export function tradingDrawingAnchoredScreenPoint(
  anchor: ScreenPoint,
  bounds: { width: number; height: number },
): ScreenPoint {
  return {
    x: Math.min(Math.max(anchor.x, 0), 1) * Math.max(bounds.width, 1),
    y: Math.min(Math.max(anchor.y, 0), 1) * Math.max(bounds.height, 1),
  };
}

export function tradingDrawingCircleGeometry(center: ScreenPoint, circumference: ScreenPoint) {
  return {
    cx: center.x,
    cy: center.y,
    radius: Math.max(Math.hypot(circumference.x - center.x, circumference.y - center.y), 1),
  };
}

export function tradingDrawingTrianglePoints(
  first: ScreenPoint,
  second: ScreenPoint,
  third?: ScreenPoint,
): ScreenPoint[] {
  if (third) return [first, second, third];
  return [{ x: (first.x + second.x) / 2, y: first.y }, { x: first.x, y: second.y }, second];
}

export type TradingDrawingClosedHitArea =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "circle"; cx: number; cy: number; radius: number }
  | { type: "polygon"; points: ScreenPoint[] };

export function tradingDrawingClosedHitArea(
  definition: TradingDrawingToolDefinition,
  first: ScreenPoint,
  second: ScreenPoint,
  third?: ScreenPoint,
): TradingDrawingClosedHitArea | null {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const width = Math.abs(second.x - first.x);
  const height = Math.abs(second.y - first.y);
  if (
    definition.kind === "rectangle"
    || definition.kind === "position"
    || definition.kind === "range"
    || (
      definition.kind === "gann"
      && !definition.id.includes("fan")
      && definition.id !== "fib-wedge"
    )
  ) {
    return { type: "rect", x: left, y: top, width, height };
  }
  if (definition.kind === "ellipse") {
    if (definition.id === "circle") {
      const circle = tradingDrawingCircleGeometry(first, second);
      return { type: "circle", cx: circle.cx, cy: circle.cy, radius: circle.radius };
    }
    const radiusX = width / 2;
    return {
      type: "ellipse",
      cx: (first.x + second.x) / 2,
      cy: (first.y + second.y) / 2,
      rx: radiusX,
      ry: height / 2,
    };
  }
  if (definition.kind === "triangle") {
    return {
      type: "polygon",
      points: tradingDrawingTrianglePoints(first, second, third),
    };
  }
  if (definition.kind === "rotated-rectangle") {
    const offset = perpendicularOffset(
      first,
      second,
      Math.max(16, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.18, 50)),
    );
    return {
      type: "polygon",
      points: [
        { x: first.x - offset.x, y: first.y - offset.y },
        { x: second.x - offset.x, y: second.y - offset.y },
        { x: second.x + offset.x, y: second.y + offset.y },
        { x: first.x + offset.x, y: first.y + offset.y },
      ],
    };
  }
  if (definition.kind === "channel") {
    const offset = perpendicularOffset(
      first,
      second,
      Math.max(20, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.2, 72)),
    );
    return {
      type: "polygon",
      points: [
        first,
        second,
        { x: second.x + offset.x, y: second.y + offset.y },
        { x: first.x + offset.x, y: first.y + offset.y },
      ],
    };
  }
  if (definition.kind === "fib-circle" && definition.id !== "fib-spiral") {
    return {
      type: "circle",
      cx: first.x,
      cy: first.y,
      radius: Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1),
    };
  }
  return null;
}

function renderTradingDrawingClosedHitArea(area: TradingDrawingClosedHitArea) {
  if (area.type === "rect") {
    return `<rect class="trading-drawing-hit-target area" x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" />`;
  }
  if (area.type === "ellipse") {
    return `<ellipse class="trading-drawing-hit-target area" cx="${area.cx}" cy="${area.cy}" rx="${area.rx}" ry="${area.ry}" />`;
  }
  if (area.type === "circle") {
    return `<circle class="trading-drawing-hit-target area" cx="${area.cx}" cy="${area.cy}" r="${area.radius}" />`;
  }
  return `<polygon class="trading-drawing-hit-target area" points="${pointsAttribute(area.points)}" />`;
}

export interface TradingDrawingSharedToolState {
  activeTool: TradingDrawingToolId;
  stayInDrawingMode: boolean;
  magnetEnabled: boolean;
  drawingStyles?: Partial<Record<TradingDrawingToolId, TradingDrawingStyle>>;
}

export function tradingDrawingForwardedWheelEventInit(event: Pick<
  WheelEvent,
  | "altKey"
  | "buttons"
  | "clientX"
  | "clientY"
  | "ctrlKey"
  | "deltaMode"
  | "deltaX"
  | "deltaY"
  | "deltaZ"
  | "metaKey"
  | "screenX"
  | "screenY"
  | "shiftKey"
>): WheelEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: event.altKey,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    metaKey: event.metaKey,
    screenX: event.screenX,
    screenY: event.screenY,
    shiftKey: event.shiftKey,
  };
}

export function normalizeTradingAiDrawingPatch(
  patch: TradingAiDrawingPatch,
  expectedContext?: { marketId: string; interval: string },
) {
  if (
    Number(patch?.schemaVersion) !== 1
    || !String(patch?.marketId || "").trim()
    || !String(patch?.interval || "").trim()
    || (expectedContext && String(patch.marketId) !== expectedContext.marketId)
    || (expectedContext && String(patch.interval) !== expectedContext.interval)
    || !Array.isArray(patch?.operations)
    || !patch.operations.length
    || patch.operations.length > 64
  ) {
    throw new TypeError("AI drawing patch is invalid for the target market");
  }
  return patch.operations.map((operation, index): TradingAiDrawing => {
    const drawing = operation?.drawing;
    if (
      operation?.op !== "upsert"
      || !drawing
      || !TRADING_AI_DRAWING_TOOLS.has(drawing.tool)
      || !TRADING_AI_DRAWING_COLOR_TOKENS.has(drawing.colorToken)
      || drawing.symbol !== patch.marketId
      || !(
        (drawing.theory === "chan" && drawing.layer === "ai/chan" && drawing.colorToken.startsWith("chan-"))
        || (
          drawing.theory === "order-flow"
          && drawing.layer === "ai/order-flow"
          && drawing.colorToken.startsWith("order-flow-")
        )
        || (
          drawing.theory === "wave"
          && drawing.layer === "ai/wave"
          && drawing.colorToken.startsWith("wave-")
        )
        || (
          drawing.theory === "wyckoff"
          && drawing.layer === "ai/wyckoff"
          && drawing.colorToken.startsWith("wyckoff-")
        )
        || (
          drawing.theory === "price-action"
          && drawing.layer === "ai/price-action"
          && drawing.colorToken.startsWith("price-action-")
        )
        || (
          drawing.theory === "strategy"
          && /^[a-z][a-z0-9-]{1,63}$/.test(String(drawing.strategyId || ""))
          && drawing.layer === `ai/strategy/${drawing.strategyId}`
          && drawing.colorToken.startsWith("strategy-")
        )
      )
      || !Array.isArray(drawing.points)
      || !drawing.points.length
      || drawing.points.length > 64
      || !drawing.points.every(finitePoint)
      || (drawing.tool === "path" && drawing.points.length < 2)
      || (drawing.tool === "rectangle" && drawing.points.length !== 2)
      || ((drawing.tool === "circle" || drawing.tool === "ellipse") && drawing.points.length !== 2)
      || (["arrow-up", "arrow-down", "note", "text"].includes(drawing.tool) && drawing.points.length !== 1)
    ) {
      throw new TypeError(`AI drawing operation ${index} is invalid`);
    }
    return {
      id: String(drawing.id || `ai-${index}`).slice(0, 160),
      strategyId: drawing.theory === "strategy" ? String(drawing.strategyId) : undefined,
      symbol: patch.marketId,
      interval: patch.interval,
      theory: drawing.theory,
      layer: drawing.layer,
      tool: drawing.tool,
      points: drawing.points.map((point) => ({ time: Number(point.time), price: Number(point.price) })),
      text: typeof drawing.text === "string" ? drawing.text.slice(0, 120) : undefined,
      colorToken: drawing.colorToken,
      lineStyle: drawingLineStyle(drawing.lineStyle),
      lineWidth: drawingLineWidth(drawing.lineWidth),
      fontSize: drawingTextFontSize(drawing.fontSize),
      bold: drawing.bold === true,
      locked: true,
      status: drawing.status === "tentative" ? "tentative" : "confirmed",
      evidenceIds: Array.isArray(drawing.evidenceIds)
        ? drawing.evidenceIds.map(String).slice(0, 32)
        : [],
    };
  });
}

function tradingAiDrawingModel(drawing: TradingAiDrawing): TradingDrawingModel {
  const waveAuxiliaryPath = drawing.theory === "wave"
    && drawing.tool === "path"
    && (
      drawing.id.includes("-fib-")
      || drawing.id.endsWith("-invalidation")
      || drawing.id.endsWith("-confirmation")
    );
  return {
    id: drawing.id,
    strategyId: drawing.strategyId,
    symbol: drawing.symbol,
    interval: drawing.interval,
    tool: drawing.tool,
    points: drawing.points.map((point) => ({ ...point })),
    text: drawing.text,
    locked: true,
    source: "ai",
    colorToken: drawing.colorToken,
    lineStyle: drawing.lineStyle ?? (drawing.theory === "wave" && drawing.tool === "path" && !waveAuxiliaryPath
      ? "solid"
      : drawing.status === "tentative" ? "dashed" : "solid"),
    lineWidth: drawing.lineWidth ?? (drawing.tool === "path" ? 2 : undefined),
    fontSize: drawing.fontSize ?? (drawing.tool === "note" ? AI_NOTE_FONT_SIZE : undefined),
    bold: drawing.bold === true,
  };
}

export function localizeTradingAiDrawingPatch<
  T extends TradingAiDrawingPatch | TradingIndicatorAiDrawingPatch,
>(patch: T, language: AppLanguage): T {
  let changed = false;
  const operations = patch.operations.map((operation) => {
    const text = operation.drawing.text;
    if (!text) return operation;
    const translated = translateTradingAnnotationText(text, language);
    const localizedText = language === "en" && /\p{Script=Han}/u.test(translated)
      ? "Trading analysis annotation"
      : translated;
    if (localizedText === text) return operation;
    changed = true;
    return { ...operation, drawing: { ...operation.drawing, text: localizedText } };
  });
  return changed ? { ...patch, operations } as T : patch;
}

export function tradingAiDrawingDisplayModel<T extends { text?: string }>(drawing: T, language?: AppLanguage): T {
  if (!drawing.text) return drawing;
  const source = String(drawing.text);
  // Stored AI text is already localized when its analysis is committed. Only
  // repair the legacy candlestick evidence-id label, which was never a real
  // user-facing translation and cannot be recovered after the fact.
  if (!LEGACY_PRICE_ACTION_CANDLESTICK_LABEL_PATTERN.test(source)) return drawing;
  const english = language === "en";
  const traditional = language === "zh-TW";
  const suffix = /(?:·|•)\s*(?:unclosed|待收盘)$/iu.test(source)
    ? english ? " · unclosed" : traditional ? " · 待收盤" : " · 待收盘"
    : "";
  return { ...drawing, text: `${english ? "Candlestick pattern" : traditional ? "蠟燭形態" : "蜡烛形态"}${suffix}` };
}

export function persistTradingAiDrawingPatch(
  storageSessionId: string,
  patch: TradingAiDrawingPatch,
) {
  const drawings = normalizeTradingAiDrawingPatch(patch).map(tradingAiDrawingModel);
  const stored = loadStoredAiDrawings(storageSessionId);
  const next = replaceTradingAiDrawingContext(stored, patch.marketId, patch.interval, drawings)
    .slice(-MAX_STORED_AI_DRAWINGS);
  window.localStorage.setItem(
    tradingDrawingSessionStorageKey("ai", storageSessionId),
    JSON.stringify(next),
  );
  return next.length;
}

interface TradingDrawingControllerOptions {
  host: HTMLElement;
  controlsHost?: HTMLElement;
  chartElement: HTMLElement;
  overlay: SVGSVGElement;
  getNavigation?: () => TradingChartNavigation | null;
  getChart: () => any;
  getCandleSeries: () => any;
  getSymbol: () => string;
  getInterval: () => string;
  getCandles: () => Array<{ time: number; open: number; high: number; low: number; close: number }>;
  timeOffsetSeconds: number;
  storageSessionId: string;
  drawingScope?: string;
  paneIndex?: number;
  bindControlEvents?: boolean;
  controlActive?: boolean;
  clearScopeLabel?: string;
  resolveControlTarget?: () => TradingDrawingController | null;
  onSharedToolStateChanged?: (
    state: TradingDrawingSharedToolState,
    source: TradingDrawingController,
  ) => void;
  onSurfaceFocus?: (source: TradingDrawingController) => void;
  onAiDrawingContextsChanged?: (context: { marketId: string; interval: string } | null) => void;
  onDrawingStateChanged?: (source: TradingDrawingController) => void;
}

type ManualDrawingSession = {
  drawings: TradingDrawingModel[];
  controllers: Set<TradingDrawingController>;
};
const manualDrawingSessions = new Map<string, ManualDrawingSession>();

export class TradingDrawingController {
  private readonly host: HTMLElement;
  private readonly chartElement: HTMLElement;
  private readonly overlay: SVGSVGElement;
  private readonly orderLineContent: SVGGElement;
  private readonly orderPositionCardLayer: HTMLElement;
  private readonly content: SVGGElement;
  private readonly aiContent: SVGGElement;
  private readonly aiTextHitContent: SVGGElement;
  private readonly aiCursorContent: SVGGElement;
  private readonly toolbar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly selectionToolbar: HTMLElement;
  private readonly aiTextSizeToolbar: HTMLElement;
  private readonly axisMarkerLayer: HTMLElement;
  private readonly clearDialog: HTMLDialogElement;
  private readonly getChart: () => any;
  private readonly getCandleSeries: () => any;
  private readonly getSymbol: () => string;
  private readonly getInterval: () => string;
  private readonly getCandles: TradingDrawingControllerOptions["getCandles"];
  private readonly onAiDrawingContextsChanged: NonNullable<TradingDrawingControllerOptions["onAiDrawingContextsChanged"]>;
  private readonly bindControlEvents: boolean;
  private controlActive: boolean;
  private readonly clearScopeLabel: string;
  private readonly resolveControlTarget?: TradingDrawingControllerOptions["resolveControlTarget"];
  private readonly onSharedToolStateChanged?: TradingDrawingControllerOptions["onSharedToolStateChanged"];
  private readonly onSurfaceFocus?: TradingDrawingControllerOptions["onSurfaceFocus"];
  private readonly onDrawingStateChanged?: TradingDrawingControllerOptions["onDrawingStateChanged"];
  private readonly timeOffsetSeconds: number;
  private readonly drawingScope: string;
  private readonly paneIndex: number;
  private storageSessionId: string;
  private manualDrawingSession!: ManualDrawingSession;
  private get drawings() { return this.manualDrawingSession.drawings; }
  private set drawings(value: TradingDrawingModel[]) { this.manualDrawingSession.drawings = value; }
  private aiDrawings: TradingDrawingModel[] = [];
  private aiDraft: TradingDrawingModel | null = null;
  private aiCursorPoint: TradingDrawingPoint | null = null;
  private aiCursorPulse = false;
  private orderLines: TradingOrderLine[] = [];
  private openOrderPositionCardId: string | null = null;
  private hoveredAiTextDrawingId: string | null = null;
  private readonly aiTextSizeToolbarVisibility: TradingChartToolbarVisibility;
  private aiTextSizeToolbarPosition: ScreenPoint | null = null;
  private aiTextSizeToolbarDrag: (SelectionToolbarDragState & { moved: boolean }) | null = null;
  private suppressAiTextSizeToolbarClick = false;
  private readonly aiPlayback: TradingAiDrawingPlaybackController;
  private redoStack: TradingDrawingModel[] = [];
  private readonly getNavigation?: () => TradingChartNavigation | null;
  private activeTool: TradingDrawingToolId = "cursor";
  private activeMenu: TradingDrawingGroupId | null = null;
  private activeSelectionMenu: TradingDrawingSelectionMenu | null = null;
  private draft: TradingDrawingModel | null = null;
  private draftConfirmedPointCount = 0;
  private draftRequiredPointCount = 0;
  private pendingTextDrawingId: string | null = null;
  private selectedDrawingId: string | null = null;
  private dragState: DrawingDragState | null = null;
  private selectionToolbarPosition: ScreenPoint | null = null;
  private selectionToolbarDrag: SelectionToolbarDragState | null = null;
  private pointerId: number | null = null;
  private pointerStart: ScreenPoint | null = null;
  private dragRedrawFrame: number | null = null;
  private stayInDrawingMode = false;
  private magnetEnabled = false;
  private drawingsLocked = false;
  private drawingsHidden = false;
  private userDrawingEnabled = true;
  private destroyed = false;
  private clearDialogTrigger: HTMLElement | null = null;
  private readonly lastToolByGroup = new Map<TradingDrawingGroupId, TradingDrawingToolId>(
    TRADING_DRAWING_GROUPS.map((group) => [group.id, group.defaultTool]),
  );
  // Keep manual preferences per tool so selecting a tool again starts with its
  // most recently used appearance instead of rebuilding the default style.
  private readonly drawingStyles = new Map<TradingDrawingToolId, TradingDrawingStyle>();

  constructor(options: TradingDrawingControllerOptions) {
    this.getNavigation = options.getNavigation;
    this.host = options.host;
    this.chartElement = options.chartElement;
    this.overlay = options.overlay;
    this.bindControlEvents = options.bindControlEvents !== false;
    this.controlActive = options.controlActive !== false;
    this.clearScopeLabel = options.clearScopeLabel?.trim() || "";
    this.resolveControlTarget = options.resolveControlTarget;
    this.onSharedToolStateChanged = options.onSharedToolStateChanged;
    this.onSurfaceFocus = options.onSurfaceFocus;
    this.onDrawingStateChanged = options.onDrawingStateChanged;
    this.storageSessionId = normalizeTradingDrawingStorageSessionId(options.storageSessionId);
    this.drawingScope = normalizeTradingDrawingScope(options.drawingScope);
    this.paneIndex = Math.max(0, Math.trunc(options.paneIndex ?? 0));
    this.aiDrawings = loadStoredAiDrawings(this.storageSessionId);
    const orderLineContent = this.overlay.querySelector<SVGGElement>("[data-trading-order-lines]");
    const orderPositionCardLayer = this.host.querySelector<HTMLElement>("[data-trading-order-position-cards]");
    const content = this.overlay.querySelector<SVGGElement>("[data-drawing-content]");
    const aiContent = this.overlay.querySelector<SVGGElement>("[data-ai-drawing-content]");
    const aiTextHitContent = this.overlay.querySelector<SVGGElement>("[data-ai-text-hit-content]");
    const aiCursorContent = this.overlay.querySelector<SVGGElement>("[data-ai-drawing-cursor]");
    const controlsHost = options.controlsHost ?? this.host;
    const toolbar = controlsHost.querySelector<HTMLElement>("[data-drawing-toolbar]");
    const status = controlsHost.querySelector<HTMLElement>("[data-drawing-status]");
    const selectionToolbar = this.host.querySelector<HTMLElement>("[data-drawing-selection]");
    const aiTextSizeToolbar = this.host.querySelector<HTMLElement>("[data-ai-text-size-toolbar]");
    const axisMarkerLayer = this.host.querySelector<HTMLElement>("[data-drawing-axis-markers]");
    const clearDialog = controlsHost.querySelector<HTMLDialogElement>("[data-drawing-clear-dialog]");
    if (!orderLineContent || !orderPositionCardLayer || !content || !aiContent || !aiTextHitContent || !aiCursorContent || !toolbar || !status || !selectionToolbar || !aiTextSizeToolbar || !axisMarkerLayer || !clearDialog) {
      throw new Error("Trading drawing surface is incomplete");
    }
    this.joinManualDrawingSession();
    for (const drawing of [...this.drawings].reverse()) {
      if (!this.drawingStyles.has(drawing.tool)) {
        this.drawingStyles.set(drawing.tool, tradingDrawingStyleFromModel(drawing));
      }
    }
    this.orderLineContent = orderLineContent;
    this.orderPositionCardLayer = orderPositionCardLayer;
    this.content = content;
    this.aiContent = aiContent;
    this.aiTextHitContent = aiTextHitContent;
    this.aiCursorContent = aiCursorContent;
    this.toolbar = toolbar;
    this.status = status;
    this.selectionToolbar = selectionToolbar;
    this.aiTextSizeToolbar = aiTextSizeToolbar;
    this.axisMarkerLayer = axisMarkerLayer;
    this.clearDialog = clearDialog;
    this.getChart = options.getChart;
    this.getCandleSeries = options.getCandleSeries;
    this.getSymbol = options.getSymbol;
    this.getInterval = options.getInterval;
    this.getCandles = options.getCandles;
    this.aiTextSizeToolbarVisibility = new TradingChartToolbarVisibility(
      this.aiTextSizeToolbar, this.chartElement.parentElement ?? this.chartElement, this.chartElement,
      () => {
        this.aiTextSizeToolbarPosition = null;
        this.updateAiTextSizeToolbar(this.plotBounds());
      },
    );
    this.onAiDrawingContextsChanged = options.onAiDrawingContextsChanged || (() => undefined);
    this.timeOffsetSeconds = options.timeOffsetSeconds;
    this.aiPlayback = new TradingAiDrawingPlaybackController({
      setDraft: (drawing) => {
        this.aiDraft = drawing ? this.aiDrawingModel(drawing) : null;
        this.redraw();
      },
      commit: (drawing) => {
        const model = this.aiDrawingModel(drawing);
        this.aiDrawings = [
          ...this.aiDrawings.filter((candidate) => (
            candidate.id !== model.id
            || !tradingAiDrawingMatchesContext(candidate, model.symbol, model.interval || "")
          )),
          model,
        ];
        this.persistAiDrawings();
        this.redraw();
      },
      setCursor: (point, pulse = false) => {
        this.aiCursorPoint = point;
        this.aiCursorPulse = pulse;
        this.renderAiCursor(this.plotBounds());
      },
    });
    this.bindEvents();
    if (this.controlActive) this.updateToolbarState();
    this.redraw();
  }

  sharedToolState(): TradingDrawingSharedToolState {
    const drawingStyles = Object.fromEntries(
      [...this.drawingStyles.entries()].map(([toolId, style]) => [toolId, { ...style }]),
    ) as Partial<Record<TradingDrawingToolId, TradingDrawingStyle>>;
    return {
      activeTool: this.activeTool,
      stayInDrawingMode: this.stayInDrawingMode,
      magnetEnabled: this.magnetEnabled,
      drawingStyles,
    };
  }

  alertDrawingSnapshots() {
    const symbol = this.getSymbol();
    const interval = this.getInterval();
    return this.drawings
      // Alert rules remain explicitly bound to the interval where the line was
      // created; visual rendering itself intentionally ignores interval.
      .filter((drawing) => (
        tradingManualDrawingMatchesContext(drawing, symbol, interval, this.drawingScope)
        && this.drawingScope === "main"
        && (!drawing.interval || drawing.interval === interval)
      ))
      .map((drawing) => Object.freeze({
        drawingId: drawing.id,
        revision: 1,
        marketId: symbol,
        interval,
        tool: drawing.tool,
        geometryMode: drawing.tool === "ray" || drawing.tool === "horizontal-ray"
          ? "ray"
          : drawing.tool === "extended-line" ? "extended" : "segment",
        points: drawing.points.map((point) => Object.freeze({
          time: Math.round(point.time * 1_000),
          price: point.price,
        })),
        ...(drawing.text ? { text: drawing.text } : {}),
      }));
  }

  applySharedToolState(state: TradingDrawingSharedToolState) {
    const definition = tradingDrawingToolDefinition(state.activeTool);
    if (!definition) return;
    if (this.activeTool !== definition.id) {
      if (this.pendingTextDrawingId) this.discardPendingTextDrawing();
      if (this.dragState) this.cancelSelectionDrag();
      else this.cancelDraft();
    }
    if (this.activeTool !== definition.id || definition.kind !== "cursor") this.getNavigation?.()?.setTool(null);
    this.activeTool = definition.id;
    this.lastToolByGroup.set(definition.group, definition.id);
    if (state.drawingStyles && typeof state.drawingStyles === "object") {
      this.drawingStyles.clear();
      for (const candidate of TRADING_DRAWING_TOOLS) {
        if (!Object.prototype.hasOwnProperty.call(state.drawingStyles, candidate.id)) continue;
        this.drawingStyles.set(
          candidate.id,
          normalizeTradingDrawingStyle(state.drawingStyles[candidate.id]),
        );
      }
    }
    this.stayInDrawingMode = state.stayInDrawingMode;
    this.magnetEnabled = state.magnetEnabled;
    this.overlay.classList.toggle("drawing-active", definition.kind !== "cursor");
    if (definition.kind !== "cursor") this.hideAiTextSizeToolbar();
    this.overlay.dataset.drawingTool = definition.id;
    if (this.controlActive) {
      this.setStatus(this.activeToolLabel());
      this.updateToolbarState();
    }
  }

  setControlActive(active: boolean) {
    if (active === this.controlActive) {
      if (active) this.updateToolbarState();
      return;
    }
    this.controlActive = active;
    if (!active) {
      this.hideAiTextSizeToolbar();
      this.closeToolMenus();
      this.closeSelectionMenus();
      this.cancelDraft();
      this.cancelSelectionDrag();
      this.releasePointer();
      this.selectDrawing(null);
      return;
    }
    this.setStatus(this.activeToolLabel());
    this.updateToolbarState();
    this.redraw();
  }

  setUserDrawingEnabled(enabled: boolean) {
    this.userDrawingEnabled = enabled;
    if (this.bindControlEvents) {
      this.toolbar.toggleAttribute("inert", !enabled);
      this.toolbar.setAttribute("aria-hidden", String(!enabled));
    }
    if (enabled) {
      this.updateToolbarState();
      return;
    }
    this.closeToolMenus();
    this.hideAiTextSizeToolbar();
    this.closeSelectionMenus();
    this.cancelDraft();
    this.cancelSelectionDrag();
    this.releasePointer();
    this.selectDrawing(null);
    this.selectTool("cursor");
  }

  setOrderLines(lines: readonly TradingOrderLine[]) {
    this.orderLines = lines.flatMap((line) => (
      line
      && typeof line.id === "string"
      && typeof line.marketId === "string"
      && typeof line.label === "string"
      && typeof line.shortLabel === "string"
      && Number.isFinite(line.price)
      && line.price > 0
        ? [{ ...line }]
        : []
    ));
    this.redraw();
  }

  switchStorageSession(
    storageSessionId: string,
    options: { migrateFromSessionId?: string } = {},
  ) {
    const nextSessionId = normalizeTradingDrawingStorageSessionId(storageSessionId);
    if (nextSessionId === this.storageSessionId) return;
    const previousSessionId = this.storageSessionId;
    const migrateFromSessionId = options.migrateFromSessionId
      ? normalizeTradingDrawingStorageSessionId(options.migrateFromSessionId)
      : "";
    const migrateCurrentDrawings = migrateFromSessionId === previousSessionId;

    this.aiPlayback.cancel();
    this.releasePointer();
    this.finishSelectionToolbarDrag();
    this.discardPendingTextDrawing();
    const pendingIds = new Set([...this.manualDrawingSession.controllers].map((peer) => peer.pendingTextDrawingId));
    const previousDrawings = this.drawings.filter((drawing) => !pendingIds.has(drawing.id));
    this.leaveManualDrawingSession();
    this.storageSessionId = nextSessionId;
    this.joinManualDrawingSession();
    if (migrateCurrentDrawings) {
      // Move every scope, including indicators that are currently closed.
      // Later controllers joining this session must not overwrite its newer data.
      const combined = new Map(previousDrawings.map((drawing) => [drawing.id, drawing]));
      this.drawings.forEach((drawing) => combined.set(drawing.id, drawing));
      this.drawings = [...combined.values()];
      const manualPersisted = this.persistDrawings(false);
      const aiPersisted = this.drawingScope === "main" && this.persistAiDrawings(false);
      try {
        if (manualPersisted) {
          window.localStorage.removeItem(tradingDrawingSessionStorageKey("manual", previousSessionId));
        }
        if (aiPersisted) {
          window.localStorage.removeItem(tradingDrawingSessionStorageKey("ai", previousSessionId));
        }
      } catch {
        // Keeping the previous keys is safer if the promoted-session migration cannot finish.
      }
    } else {
      this.aiDrawings = loadStoredAiDrawings(this.storageSessionId);
    }

    this.redoStack = [];
    this.draft = null;
    this.aiDraft = null;
    this.aiCursorPoint = null;
    this.aiCursorPulse = false;
    this.dragState = null;
    this.pendingTextDrawingId = null;
    this.selectedDrawingId = null;
    this.hideAiTextSizeToolbar();
    this.selectionToolbarPosition = null;
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.drawingsLocked = false;
    this.drawingsHidden = false;
    this.overlay.classList.remove("dragging-drawing");
    this.closeSelectionMenus();
    this.redraw();
    this.updateToolbarState();
  }

  private bindEvents() {
    if (this.bindControlEvents) {
      this.toolbar.addEventListener("click", this.handleToolbarClick);
      this.clearDialog.addEventListener("click", this.handleClearDialogClick);
      this.clearDialog.addEventListener("cancel", this.handleClearDialogCancel);
      this.clearDialog.addEventListener("close", this.handleClearDialogClose);
    }
    this.selectionToolbar.addEventListener("click", this.handleSelectionToolbarClick);
    this.selectionToolbar.addEventListener("pointerdown", this.handleSelectionToolbarPointerDown);
    this.selectionToolbar.addEventListener("pointermove", this.handleSelectionToolbarPointerMove);
    this.selectionToolbar.addEventListener("pointerup", this.handleSelectionToolbarPointerUp);
    this.selectionToolbar.addEventListener("pointercancel", this.handleSelectionToolbarPointerCancel);
    this.selectionToolbar.addEventListener("lostpointercapture", this.handleSelectionToolbarPointerCancel);
    this.aiTextHitContent.addEventListener("pointerover", this.handleAiTextPointerOver);
    this.aiTextHitContent.addEventListener("pointerout", this.handleAiTextPointerOut);
    this.aiTextHitContent.addEventListener("focusin", this.handleAiTextFocusIn);
    this.aiTextHitContent.addEventListener("focusout", this.handleAiTextFocusOut);
    this.aiTextHitContent.addEventListener("keydown", this.handleAiTextTriggerKeyDown);
    this.aiTextSizeToolbar.addEventListener("click", this.handleAiTextSizeToolbarClick);
    this.aiTextSizeToolbar.addEventListener("pointerdown", this.handleAiTextSizeToolbarPointerDown);
    document.addEventListener("pointermove", this.handleAiTextSizeToolbarPointerMove);
    document.addEventListener("pointerup", this.handleAiTextSizeToolbarPointerUp);
    document.addEventListener("pointercancel", this.handleAiTextSizeToolbarPointerCancel);
    this.aiTextSizeToolbar.addEventListener("lostpointercapture", this.handleAiTextSizeToolbarPointerCancel);
    window.addEventListener("blur", this.finishAiTextSizeToolbarDrag);
    this.chartElement.addEventListener("trading-navigation-tool-change", this.handleNavigationToolChange);
    this.chartElement.addEventListener("pointerdown", this.handleSurfacePointerDown, { capture: true });
    this.orderLineContent.addEventListener("pointerover", this.handleOrderPositionPointerOver);
    this.orderLineContent.addEventListener("pointerout", this.handleOrderPositionPointerOut);
    this.orderLineContent.addEventListener("focusin", this.handleOrderPositionFocusIn);
    this.orderLineContent.addEventListener("focusout", this.handleOrderPositionFocusOut);
    this.overlay.addEventListener("pointerdown", this.handlePointerDown);
    this.overlay.addEventListener("contextmenu", this.handleContextMenu);
    this.overlay.addEventListener("wheel", this.handleWheel, { passive: false });
    document.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("pointerup", this.handlePointerUp);
    document.addEventListener("pointercancel", this.handlePointerCancel);
    document.addEventListener("pointerdown", this.handleOutsidePointerDown);
    document.addEventListener("keydown", this.handleKeyDown);
  }

  private controlTarget() {
    const target = this.resolveControlTarget?.();
    return target && !target.destroyed ? target : this;
  }

  focusPane(paneIndex: number) {
    if (this.paneIndex === paneIndex) this.onSurfaceFocus?.(this);
  }

  private readonly handleNavigationToolChange = () => this.controlTarget().updateToolbarState();

  private readonly handleSurfacePointerDown = () => {
    this.onSurfaceFocus?.(this);
  };

  private orderPositionTrigger(target: EventTarget | null) {
    return target instanceof Element
      ? target.closest<SVGGElement>("[data-trading-order-card-trigger]")
      : null;
  }

  private setOpenOrderPositionCard(id: string | null) {
    this.openOrderPositionCardId = id;
    let matched = false;
    this.orderPositionCardLayer
      .querySelectorAll<HTMLElement>("[data-trading-order-card]")
      .forEach((card) => {
        const open = id !== null && card.dataset.tradingOrderCard === id;
        card.toggleAttribute("hidden", !open);
        card.setAttribute("aria-hidden", String(!open));
        matched ||= open;
      });
    if (id !== null && !matched) this.openOrderPositionCardId = null;
  }

  private readonly handleOrderPositionPointerOver = (event: PointerEvent) => {
    const trigger = this.orderPositionTrigger(event.target);
    if (trigger?.dataset.tradingOrderCardTrigger) {
      this.setOpenOrderPositionCard(trigger.dataset.tradingOrderCardTrigger);
    }
  };

  private readonly handleOrderPositionPointerOut = (event: PointerEvent) => {
    const trigger = this.orderPositionTrigger(event.target);
    if (!trigger) return;
    if (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
    if (trigger.matches(":focus, :focus-within")) return;
    this.setOpenOrderPositionCard(null);
  };

  private readonly handleOrderPositionFocusIn = (event: FocusEvent) => {
    const trigger = this.orderPositionTrigger(event.target);
    if (trigger?.dataset.tradingOrderCardTrigger) {
      this.setOpenOrderPositionCard(trigger.dataset.tradingOrderCardTrigger);
    }
  };

  private readonly handleOrderPositionFocusOut = (event: FocusEvent) => {
    const trigger = this.orderPositionTrigger(event.target);
    if (!trigger) return;
    if (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
    if (trigger.matches(":hover")) return;
    this.setOpenOrderPositionCard(null);
  };

  private aiTextSizeTrigger(target: EventTarget | null) {
    return target instanceof Element
      ? target.closest<SVGGElement>("[data-ai-text-size-trigger]")
      : null;
  }

  private aiTextDrawingsForCurrentContext() {
    const symbol = this.getSymbol();
    const interval = this.getInterval();
    return this.aiDrawings.filter((drawing) => (
      tradingAiDrawingMatchesContext(drawing, symbol, interval)
      && tradingDrawingToolDefinition(drawing.tool)?.kind === "text"
    ));
  }

  private aiTextDrawing(id: string | null) {
    if (!id) return null;
    return this.aiTextDrawingsForCurrentContext().find((drawing) => drawing.id === id) ?? null;
  }

  private hideAiTextSizeToolbar() {
    this.finishAiTextSizeToolbarDrag();
    this.hoveredAiTextDrawingId = null;
    this.aiTextSizeToolbarVisibility.setAvailable(false);
  }

  private showAiTextSizeToolbar(id: string) {
    if (
      !this.userDrawingEnabled
      || this.drawingsHidden
      || tradingDrawingToolDefinition(this.activeTool)?.kind !== "cursor"
      || !this.aiTextDrawing(id)
    ) return;
    this.updateAiTextSizeToolbar(this.plotBounds());
  }

  private adjustAiTextFontSize(action: "decrease" | "increase") {
    const drawing = this.aiTextDrawing(this.hoveredAiTextDrawingId);
    if (!drawing) {
      this.hideAiTextSizeToolbar();
      return;
    }
    let changed = false;
    for (const textDrawing of this.aiTextDrawingsForCurrentContext()) {
      const current = textDrawing.fontSize
        ?? (textDrawing.tool === "note" ? AI_NOTE_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
      const next = tradingAiTextNextFontSize(current, action);
      if (next === current) continue;
      textDrawing.fontSize = next;
      changed = true;
    }
    if (!changed) {
      this.updateAiTextSizeToolbar(this.plotBounds());
      return;
    }
    this.persistAiDrawings();
    this.redraw();
    this.setStatus(`当前图表全部 AI 标注已${action === "decrease" ? "缩小" : "放大"}`);
  }

  private dismissAiTextSizeToolbar() {
    this.aiTextSizeToolbarVisibility.dismiss();
    this.hideAiTextSizeToolbar();
    this.chartElement.focus({ preventScroll: true });
  }

  private readonly handleAiTextPointerOver = (event: PointerEvent) => {
    const trigger = this.aiTextSizeTrigger(event.target);
    const id = trigger?.dataset.aiTextSizeTrigger;
    if (id) {
      this.showAiTextSizeToolbar(id);
    }
  };

  private readonly handleAiTextPointerOut = (event: PointerEvent) => {
    const trigger = this.aiTextSizeTrigger(event.target);
    if (!trigger) return;
    if (event.relatedTarget instanceof Node && (
      trigger.contains(event.relatedTarget)
      || this.aiTextSizeToolbar.contains(event.relatedTarget)
    )) return;
    if (trigger.matches(":focus, :focus-within")) return;
    this.updateAiTextSizeToolbar(this.plotBounds());
  };

  private readonly handleAiTextFocusIn = (event: FocusEvent) => {
    const id = this.aiTextSizeTrigger(event.target)?.dataset.aiTextSizeTrigger;
    if (id) {
      this.showAiTextSizeToolbar(id);
    }
  };

  private readonly handleAiTextFocusOut = (event: FocusEvent) => {
    const trigger = this.aiTextSizeTrigger(event.target);
    if (!trigger) return;
    if (event.relatedTarget instanceof Node && (
      trigger.contains(event.relatedTarget)
      || this.aiTextSizeToolbar.contains(event.relatedTarget)
    )) return;
    if (trigger.matches(":hover")) return;
    this.updateAiTextSizeToolbar(this.plotBounds());
  };

  private readonly handleAiTextTriggerKeyDown = (event: KeyboardEvent) => {
    const id = this.aiTextSizeTrigger(event.target)?.dataset.aiTextSizeTrigger;
    if (!id) return;
    if (event.key === "Escape") {
      this.updateAiTextSizeToolbar(this.plotBounds());
      return;
    }
    const action = event.key === "+" || event.key === "=" || event.key === "ArrowUp"
      ? "increase"
      : event.key === "-" || event.key === "_" || event.key === "ArrowDown"
        ? "decrease"
        : null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    this.showAiTextSizeToolbar(id);
    this.adjustAiTextFontSize(action);
  };

  private readonly handleAiTextSizeToolbarClick = (event: MouseEvent) => {
    event.stopPropagation();
    // A browser click can follow pointerup even when the gesture moved the bar.
    // Keyboard activation has detail=0 and must remain available after a drag.
    const suppress = this.suppressAiTextSizeToolbarClick;
    this.suppressAiTextSizeToolbarClick = false;
    if (suppress && event.detail !== 0) {
      event.preventDefault();
      return;
    }
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-ai-text-size-action]")
      : null;
    const action = button?.dataset.aiTextSizeAction;
    if (button?.disabled) return;
    if (action !== "decrease" && action !== "increase" && action !== "dismiss") return;
    event.preventDefault();
    this.onSurfaceFocus?.(this);
    if (action === "dismiss") {
      this.dismissAiTextSizeToolbar();
      return;
    }
    this.adjustAiTextFontSize(action);
  };

  private readonly handleAiTextSizeToolbarPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || this.aiTextSizeToolbarDrag) return;
    this.suppressAiTextSizeToolbarClick = false;
    if (event.target instanceof Element && event.target.closest('[data-ai-text-size-action="dismiss"]')) return;
    this.onSurfaceFocus?.(this);
    this.aiTextSizeToolbarDrag = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: parseFloat(this.aiTextSizeToolbar.style.left), y: parseFloat(this.aiTextSizeToolbar.style.top) },
      moved: false,
    };
    beginTradingChartInteraction(this);
  };

  private readonly handleAiTextSizeToolbarPointerMove = (event: PointerEvent) => {
    const drag = this.aiTextSizeToolbarDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startClient.x;
    const dy = event.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    event.preventDefault();
    event.stopPropagation();
    if (!drag.moved) {
      drag.moved = true;
      this.suppressAiTextSizeToolbarClick = true;
      this.aiTextSizeToolbar.classList.add("dragging");
      this.aiTextSizeToolbar.dataset.dragging = "true";
      // Capture only after the threshold so an ordinary click still targets
      // the original A−/A+ button, with its native focus and click behavior.
      if (event.type !== "pointerup") this.aiTextSizeToolbar.setPointerCapture(event.pointerId);
    }
    this.aiTextSizeToolbarPosition = clampTradingChartToolbarPosition({
      x: drag.startPosition.x + dx,
      y: drag.startPosition.y + dy,
    }, this.plotBounds(), {
      width: this.aiTextSizeToolbar.offsetWidth,
      height: this.aiTextSizeToolbar.offsetHeight,
    });
    this.aiTextSizeToolbar.style.left = `${this.aiTextSizeToolbarPosition.x}px`;
    this.aiTextSizeToolbar.style.top = `${this.aiTextSizeToolbarPosition.y}px`;
  };

  private readonly handleAiTextSizeToolbarPointerUp = (event: PointerEvent) => {
    if (this.aiTextSizeToolbarDrag?.pointerId !== event.pointerId) return;
    // Include the final coordinates if pointermove was coalesced before release.
    this.handleAiTextSizeToolbarPointerMove(event);
    this.finishAiTextSizeToolbarDrag();
  };

  private readonly handleAiTextSizeToolbarPointerCancel = (event: PointerEvent) => {
    if (this.aiTextSizeToolbarDrag?.pointerId !== event.pointerId) return;
    this.finishAiTextSizeToolbarDrag();
  };

  private readonly finishAiTextSizeToolbarDrag = () => {
    const pointerId = this.aiTextSizeToolbarDrag?.pointerId;
    this.aiTextSizeToolbarDrag = null;
    this.aiTextSizeToolbar.classList.remove("dragging");
    delete this.aiTextSizeToolbar.dataset.dragging;
    if (pointerId !== undefined && this.aiTextSizeToolbar.hasPointerCapture(pointerId)) {
      this.aiTextSizeToolbar.releasePointerCapture(pointerId);
    }
    if (pointerId !== undefined) endTradingChartInteraction(this);
  };

  private topmostAiTextSizeTarget() {
    const textDrawings = new Map(
      this.aiTextDrawingsForCurrentContext().map((drawing) => [drawing.id, drawing]),
    );
    let topmost: {
      drawing: TradingDrawingModel;
      bounds: TradingDrawingCollisionRect;
    } | null = null;
    for (const trigger of this.aiTextHitContent.querySelectorAll<SVGGElement>("[data-ai-text-size-trigger]")) {
      const id = trigger.dataset.aiTextSizeTrigger;
      const drawing = id ? textDrawings.get(id) : undefined;
      const hitTarget = trigger.querySelector<SVGRectElement>(".trading-ai-text-size-hit-target");
      if (!drawing || !hitTarget) continue;
      const bounds = {
        x: Number(hitTarget.getAttribute("x")),
        y: Number(hitTarget.getAttribute("y")),
        width: Number(hitTarget.getAttribute("width")),
        height: Number(hitTarget.getAttribute("height")),
      };
      if (
        ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0
        || bounds.height <= 0
      ) continue;
      if (!topmost || bounds.y < topmost.bounds.y || (
        bounds.y === topmost.bounds.y && bounds.x < topmost.bounds.x
      )) {
        topmost = { drawing, bounds };
      }
    }
    return topmost;
  }

  private readonly handleWheel = (event: WheelEvent) => {
    this.setOpenOrderPositionCard(null);
    const chartSurface = this.chartElement.firstElementChild;
    if (!chartSurface) return;
    const forwardedEvent = new WheelEvent(
      "wheel",
      tradingDrawingForwardedWheelEventInit(event),
    );
    chartSurface.dispatchEvent(forwardedEvent);
    if (forwardedEvent.defaultPrevented) event.preventDefault();
  };

  private readonly handleToolbarClick = (event: Event) => {
    const controlTarget = this.controlTarget();
    if (controlTarget !== this) {
      controlTarget.handleToolbarClick(event);
      return;
    }
    if (!this.userDrawingEnabled) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-drawing-action]")
      : null;
    const action = target?.dataset.drawingAction;
    if (!target || !action) return;
    event.stopPropagation();
    if (action === "select-tool") {
      this.selectTool(target.dataset.drawingTool as TradingDrawingToolId);
      this.closeToolMenus();
      return;
    }
    if (action === "select-group-tool") {
      const group = target.dataset.drawingGroupId as TradingDrawingGroupId;
      this.selectTool(this.lastToolByGroup.get(group) ?? target.dataset.drawingTool as TradingDrawingToolId);
      return;
    }
    if (action === "toggle-tool-menu") {
      this.toggleToolMenu(target.dataset.drawingGroupId as TradingDrawingGroupId, target);
      return;
    }
    if (action === "measure" || action === "zoom-in") {
      this.selectTool("cursor");
      this.getNavigation?.()?.setTool(action === "measure" ? "measure" : "zoom");
      this.updateToolbarState();
      return;
    }
    if (action === "zoom-out") {
      this.getNavigation?.()?.setTool(null);
      this.zoomChart(1.25);
      return;
    }
    if (action === "toggle-magnet") {
      this.magnetEnabled = !this.magnetEnabled;
      this.setStatus(this.magnetEnabled ? "磁吸已开启" : "磁吸已关闭");
      this.emitSharedToolState();
    } else if (action === "toggle-stay") {
      this.stayInDrawingMode = !this.stayInDrawingMode;
      this.setStatus(this.stayInDrawingMode ? "保持绘图模式" : this.activeToolLabel());
      this.emitSharedToolState();
    } else if (action === "toggle-lock") {
      this.drawingsLocked = !this.drawingsLocked;
      this.drawings.forEach((drawing) => {
        if (tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)) {
          drawing.locked = this.drawingsLocked;
        }
      });
      this.persistDrawings();
      this.setStatus(this.drawingsLocked ? "全部绘图已锁定" : "全部绘图已解锁");
    } else if (action === "toggle-visibility") {
      this.drawingsHidden = !this.drawingsHidden;
      this.setStatus(this.drawingsHidden ? "绘图已隐藏" : "绘图已显示");
      this.redraw();
    } else if (action === "undo") {
      this.undo();
    } else if (action === "redo") {
      this.redo();
    } else if (action === "clear") {
      this.openClearDialog(target);
    }
    this.updateToolbarState();
  };

  private readonly handleClearDialogClick = (event: Event) => {
    const controlTarget = this.controlTarget();
    if (controlTarget !== this) {
      controlTarget.handleClearDialogClick(event);
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-drawing-clear-action]")
      : null;
    const action = target?.dataset.drawingClearAction;
    if (action === "confirm") {
      this.clearAllDrawings();
      this.clearDialog.close();
      return;
    }
    if (action === "cancel" || event.target === this.clearDialog) {
      this.clearDialog.close();
    }
  };

  private readonly handleClearDialogCancel = (event: Event) => {
    const controlTarget = this.controlTarget();
    if (controlTarget !== this) {
      controlTarget.handleClearDialogCancel(event);
      return;
    }
    event.preventDefault();
    this.clearDialog.close();
  };

  private readonly handleClearDialogClose = () => {
    const controlTarget = this.controlTarget();
    if (controlTarget !== this) {
      controlTarget.handleClearDialogClose();
      return;
    }
    const trigger = this.clearDialogTrigger;
    this.clearDialogTrigger = null;
    window.requestAnimationFrame(() => trigger?.focus());
  };

  private openClearDialog(trigger: HTMLElement) {
    this.closeToolMenus();
    this.closeSelectionMenus();
    this.clearDialogTrigger = trigger;
    const title = this.clearDialog.querySelector<HTMLElement>("#trading-drawing-clear-title");
    const description = this.clearDialog.querySelector<HTMLElement>("#trading-drawing-clear-description");
    if (title) title.textContent = this.clearScopeLabel
      ? `清空${this.clearScopeLabel}的所有绘图？`
      : "清空本会话所有绘图？";
    if (description) description.textContent = this.clearScopeLabel
      ? `${this.clearScopeLabel}的手动绘图、AI 绘图及历史记录都将被永久删除，其他分屏不受影响。此操作无法撤销。`
      : "本会话的手动绘图、AI 绘图及历史记录都将被永久删除，其他会话不受影响。此操作无法撤销。";
    if (!this.clearDialog.open) this.clearDialog.showModal();
    window.requestAnimationFrame(() => {
      this.clearDialog.querySelector<HTMLButtonElement>('[data-drawing-clear-action="cancel"]')?.focus();
    });
  }

  private readonly handleSelectionToolbarPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0 || this.selectionToolbarDrag) return;
    const grip = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".trading-drawing-selection-grip")
      : null;
    if (!grip) return;
    event.preventDefault();
    this.closeSelectionMenus();
    const startPosition = this.selectionToolbarPosition ?? {
      x: this.selectionToolbar.offsetLeft,
      y: this.selectionToolbar.offsetTop,
    };
    this.selectionToolbarPosition = { ...startPosition };
    this.selectionToolbarDrag = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { ...startPosition },
    };
    this.selectionToolbar.classList.add("dragging");
    this.selectionToolbar.setPointerCapture?.(event.pointerId);
  };

  private readonly handleSelectionToolbarPointerMove = (event: PointerEvent) => {
    const drag = this.selectionToolbarDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = this.plotBounds();
    const position = clampTradingDrawingToolbarPosition({
      x: drag.startPosition.x + event.clientX - drag.startClient.x,
      y: drag.startPosition.y + event.clientY - drag.startClient.y,
    }, bounds, {
      width: this.selectionToolbar.offsetWidth,
      height: this.selectionToolbar.offsetHeight,
    });
    this.selectionToolbarPosition = position;
    this.selectionToolbar.style.left = `${position.x}px`;
    this.selectionToolbar.style.top = `${position.y}px`;
  };

  private readonly handleSelectionToolbarPointerUp = (event: PointerEvent) => {
    if (this.selectionToolbarDrag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishSelectionToolbarDrag();
    this.setStatus("已移动选项栏");
  };

  private readonly handleSelectionToolbarPointerCancel = (event: PointerEvent) => {
    if (this.selectionToolbarDrag?.pointerId !== event.pointerId) return;
    this.finishSelectionToolbarDrag();
  };

  private finishSelectionToolbarDrag() {
    const pointerId = this.selectionToolbarDrag?.pointerId;
    this.selectionToolbarDrag = null;
    this.selectionToolbar.classList.remove("dragging");
    if (pointerId !== undefined && this.selectionToolbar.hasPointerCapture?.(pointerId)) {
      this.selectionToolbar.releasePointerCapture(pointerId);
    }
  }

  private readonly handleSelectionToolbarClick = (event: Event) => {
    if (!this.userDrawingEnabled) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-drawing-selection-action]")
      : null;
    const action = target?.dataset.drawingSelectionAction;
    const drawing = this.selectedDrawing();
    if (!target || !action || !drawing) return;
    event.preventDefault();
    event.stopPropagation();
    const menuByAction: Partial<Record<string, TradingDrawingSelectionMenu>> = {
      "toggle-color": "color",
      "toggle-style": "style",
      "toggle-width": "width",
      "toggle-text-color": "text-color",
      "toggle-text-background": "text-background",
      "toggle-font-size": "font-size",
    };
    const menuName = menuByAction[action];
    if (menuName) {
      this.toggleSelectionMenu(menuName, target);
      return;
    }
    if (action === "edit-text") {
      this.openTextInput(drawing, target);
      return;
    }
    if (action === "clear-text") {
      const input = this.textInputElement();
      if (input) {
        input.value = "";
        input.focus();
      }
      return;
    }
    if (action === "confirm-text") {
      this.confirmTextInput(drawing);
      return;
    }
    if (action === "close-text-input") {
      this.closeTextInput();
      return;
    }
    if (action === "reset") {
      delete drawing.color;
      delete drawing.lineStyle;
      delete drawing.lineWidth;
      this.persistDrawingEdit("已恢复默认样式");
      return;
    }
    if (action === "reset-text") {
      delete drawing.color;
      delete drawing.textBackgroundColor;
      delete drawing.fontSize;
      delete drawing.bold;
      this.persistDrawingEdit("已恢复默认文本样式");
      return;
    }
    if (action === "set-color") {
      const color = drawingColor(target.dataset.drawingColor);
      if (color) drawing.color = color;
      this.persistDrawingEdit("已更新颜色");
      return;
    }
    if (action === "set-text-color") {
      const color = drawingColor(target.dataset.drawingTextColor);
      if (color) drawing.color = color;
      this.persistDrawingEdit("已更新文本颜色");
      return;
    }
    if (action === "set-text-background") {
      const background = target.dataset.drawingBackgroundColor;
      if (background === "transparent") delete drawing.textBackgroundColor;
      else {
        const color = drawingColor(background);
        if (color) drawing.textBackgroundColor = color;
      }
      this.persistDrawingEdit("已更新文本背景");
      return;
    }
    if (action === "set-font-size") {
      const size = drawingTextFontSize(target.dataset.drawingFontSize);
      if (size) drawing.fontSize = size;
      this.persistDrawingEdit("已更新字体大小");
      return;
    }
    if (action === "toggle-bold") {
      drawing.bold = !drawing.bold;
      this.persistDrawingEdit(drawing.bold ? "已加粗文本" : "已取消加粗", false);
      return;
    }
    if (action === "set-style") {
      const style = drawingLineStyle(target.dataset.drawingStyle);
      if (style) drawing.lineStyle = style;
      this.persistDrawingEdit("已更新线条样式");
      return;
    }
    if (action === "set-width") {
      const width = drawingLineWidth(target.dataset.drawingWidth);
      if (width) drawing.lineWidth = width;
      this.persistDrawingEdit("已更新线宽");
      return;
    }
    if (action === "toggle-lock") {
      drawing.locked = !drawing.locked;
      this.persistDrawingEdit(drawing.locked ? "绘图已锁定" : "绘图已解锁", false);
      return;
    }
    if (action === "delete") this.deleteSelectedDrawing();
  };

  private readonly handleOutsidePointerDown = (event: Event) => {
    if (!(event.target instanceof Node)) return;
    if (this.activeMenu && !this.toolbar.contains(event.target)) this.closeToolMenus();
    if (this.selectionToolbar.contains(event.target)) return;
    if (this.activeSelectionMenu) this.closeSelectionMenus();
    if (this.selectedDrawingId && !this.overlay.contains(event.target)) this.selectDrawing(null);
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.controlActive || !this.userDrawingEnabled || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
    if (this.clearDialog.open) return;
    if (event.key === "Escape") {
      if (this.activeMenu) this.closeToolMenus();
      else if (this.activeSelectionMenu === "text-input") this.closeTextInput();
      else if (this.activeSelectionMenu) this.closeSelectionMenus();
      else if (this.dragState) this.cancelSelectionDrag();
      else if (this.draft) this.cancelDraft();
      else if (this.selectedDrawingId) this.selectDrawing(null);
      else this.selectTool("cursor");
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.selectedDrawingId
      && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.deleteSelectedDrawing();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const shortcutTool = ({ t: "trend-line", f: "fib-retracement", h: "horizontal-line", v: "vertical-line" } as const)[event.key.toLowerCase()];
      if (shortcutTool && event.target instanceof Element && event.target.closest(".trading-chart-navigable")) {
        event.preventDefault(); this.selectTool(shortcutTool); return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.shiftKey || event.key.toLowerCase() === "y") this.redo();
      else this.undo();
      this.updateToolbarState();
    }
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.onSurfaceFocus?.(this);
    if (this.orderPositionTrigger(event.target)) {
      event.stopPropagation();
      return;
    }
    if (!this.userDrawingEnabled) return;
    if (event.button !== 0 || this.pointerId !== null) return;
    const definition = tradingDrawingToolDefinition(this.activeTool);
    const screenPoint = this.eventScreenPoint(event);
    if (!definition) return;
    if (definition.kind === "cursor") {
      const target = event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-drawing-id]")
        : null;
      const drawingId = target?.dataset.drawingId;
      const drawing = drawingId
        ? this.drawings.find((candidate) => (
            candidate.id === drawingId
            && tradingManualDrawingMatchesContext(candidate, this.getSymbol(), this.getInterval(), this.drawingScope)
          ))
        : null;
      if (!drawing) return;
      this.ensureAnchoredViewportAnchor(drawing);
      this.selectDrawing(drawing.id);
      event.preventDefault();
      event.stopPropagation();
      if (drawing.locked) {
        this.setStatus("绘图已锁定");
        return;
      }
      const handle = event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-drawing-handle-index]")
        : null;
      const handleValue = handle?.dataset.drawingHandleIndex;
      const parsedHandleIndex = handleValue === undefined ? -1 : Number.parseInt(handleValue, 10);
      const handleIndex = Number.isInteger(parsedHandleIndex)
        && parsedHandleIndex >= 0
        && parsedHandleIndex < drawing.points.length
        ? parsedHandleIndex
        : -1;
      const handleScreenPoint = handleIndex >= 0
        ? this.drawingPointToScreen(drawing, handleIndex, this.plotBounds())
        : null;
      const startPoint = handleIndex >= 0
        ? { ...drawing.points[handleIndex] }
        : this.screenToDrawingPoint(screenPoint, false);
      if (!startPoint) return;
      this.pointerId = event.pointerId;
      this.pointerStart = screenPoint;
      this.dragState = {
        drawingId: drawing.id,
        mode: handleIndex >= 0 ? "handle" : "drawing",
        handleIndex,
        startPoint,
        handleGrabOffset: handleScreenPoint
          ? { x: handleScreenPoint.x - screenPoint.x, y: handleScreenPoint.y - screenPoint.y }
          : { x: 0, y: 0 },
        originalPoints: drawing.points.map((point) => ({ ...point })),
        originalViewportAnchor: drawing.viewportAnchor ? { ...drawing.viewportAnchor } : undefined,
      };
      this.overlay.classList.add("dragging-drawing");
      this.capturePointer(event.pointerId);
      this.redraw();
      return;
    }
    if (this.draft && this.hasPendingDraftPoint()) {
      const drawingPoint = this.eventDrawingPoint(screenPoint);
      if (!drawingPoint) return;
      event.preventDefault();
      event.stopPropagation();
      const referenceIndex = Math.max(this.draftConfirmedPointCount - 1, 0);
      const previewIndex = this.draftConfirmedPointCount;
      const referenceScreen = this.pointToScreen(this.draft.points[referenceIndex]);
      this.draft.points[previewIndex] = drawingPoint;
      if (!referenceScreen || Math.hypot(screenPoint.x - referenceScreen.x, screenPoint.y - referenceScreen.y) >= 3) {
        const progress = tradingDrawingAdvanceDraftPoints(
          this.draft.points,
          this.draftConfirmedPointCount,
          this.draftRequiredPointCount,
          drawingPoint,
        );
        this.draft.points = progress.points;
        this.draftConfirmedPointCount = progress.confirmedPointCount;
        if (!progress.complete) {
          this.redraw();
          this.setStatus(this.draftPlacementStatus());
        } else {
          this.commitDraft();
        }
      } else {
        this.redraw();
        this.setStatus(this.draftPlacementStatus());
      }
      return;
    }
    const drawingPoint = this.eventDrawingPoint(screenPoint);
    if (!drawingPoint) return;
    event.preventDefault();
    event.stopPropagation();
    if (definition.kind === "eraser") {
      this.eraseNearest(screenPoint);
      return;
    }
    this.selectDrawing(null);
    const placementMode = tradingDrawingPlacementMode(definition);
    if (definition.kind === "text" && placementMode === "single-click") {
      this.beginTextDrawing(definition.id, drawingPoint, screenPoint);
      return;
    }
    this.pointerId = event.pointerId;
    this.pointerStart = screenPoint;
    const requiredPointCount = tradingDrawingRequiredPointCount(definition);
    this.draft = {
      id: crypto.randomUUID(),
      symbol: this.getSymbol(),
      interval: this.getInterval(),
      drawingScope: this.drawingScope,
      tool: definition.id,
      points: requiredPointCount > 1 ? [drawingPoint, drawingPoint] : [drawingPoint],
      text: definition.id === "price-note" ? formatTradingDrawingAxisPrice(drawingPoint.price) : undefined,
      ...this.drawingStyleForTool(definition.id),
    };
    this.draftConfirmedPointCount = 1;
    this.draftRequiredPointCount = requiredPointCount;
    if (this.hasPendingDraftPoint()) this.setStatus(this.draftPlacementStatus());
    this.capturePointer(event.pointerId);
    this.redraw();
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    if (!this.userDrawingEnabled || !this.draft || !this.hasPendingDraftPoint()) return;
    event.preventDefault();
    event.stopPropagation();
    this.onSurfaceFocus?.(this);
    const definition = tradingDrawingToolDefinition(this.draft.tool);
    const cancelledPointNumber = this.draftConfirmedPointCount;
    if (cancelledPointNumber <= 1) {
      this.cancelDraft();
      this.setStatus(`${definition?.label ?? "绘图"} · 已取消起点，请点击图表重新设置`);
      return;
    }
    const previewPoint = this.eventDrawingPoint(this.eventScreenPoint(event))
      ?? this.draft.points[this.draftConfirmedPointCount]
      ?? this.draft.points[this.draftConfirmedPointCount - 1];
    if (!previewPoint) return;
    const progress = tradingDrawingRewindDraftPoints(
      this.draft.points,
      this.draftConfirmedPointCount,
      previewPoint,
    );
    this.draft.points = progress.points;
    this.draftConfirmedPointCount = progress.confirmedPointCount;
    this.redraw();
    this.setStatus(
      `${definition?.label ?? "绘图"} · 已取消第 ${cancelledPointNumber} 个端点，前 ${progress.confirmedPointCount} 个端点已保留 · ${this.draftPlacementStatus()}`,
    );
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    const followingMultiClickDraft = Boolean(
      this.draft
      && this.hasPendingDraftPoint()
      && this.pointerId === null,
    );
    if (!followingMultiClickDraft && event.pointerId !== this.pointerId) return;
    const screenPoint = this.eventScreenPoint(event);
    if (event.shiftKey && this.dragState?.mode === "drawing" && this.pointerStart) {
      if (Math.abs(screenPoint.x - this.pointerStart.x) >= Math.abs(screenPoint.y - this.pointerStart.y)) screenPoint.y = this.pointerStart.y;
      else screenPoint.x = this.pointerStart.x;
    }
    if (this.dragState) {
      const drawing = this.drawings.find((candidate) => candidate.id === this.dragState?.drawingId);
      if (!drawing || drawing.locked) return;
      if (drawing.tool === "anchored-text" && this.dragState.originalViewportAnchor && this.pointerStart) {
        const bounds = this.plotBounds();
        const originalScreen = tradingDrawingAnchoredScreenPoint(this.dragState.originalViewportAnchor, bounds);
        const targetScreen = this.dragState.mode === "handle"
          ? {
              x: screenPoint.x + this.dragState.handleGrabOffset.x,
              y: screenPoint.y + this.dragState.handleGrabOffset.y,
            }
          : {
              x: originalScreen.x + screenPoint.x - this.pointerStart.x,
              y: originalScreen.y + screenPoint.y - this.pointerStart.y,
            };
        drawing.viewportAnchor = tradingDrawingViewportAnchor(targetScreen, bounds);
        const fallbackPoint = this.screenToDrawingPoint(
          tradingDrawingAnchoredScreenPoint(drawing.viewportAnchor, bounds),
          false,
        );
        if (fallbackPoint) drawing.points[0] = fallbackPoint;
      } else if (this.dragState.mode === "handle") {
        const point = this.eventDrawingPoint({
          x: screenPoint.x + this.dragState.handleGrabOffset.x,
          y: screenPoint.y + this.dragState.handleGrabOffset.y,
        });
        if (point && this.dragState.handleIndex >= 0 && this.dragState.handleIndex < drawing.points.length) {
          drawing.points[this.dragState.handleIndex] = point;
        }
      } else {
        const currentPoint = this.screenToDrawingPoint(screenPoint, false);
        if (!currentPoint) return;
        const deltaTime = currentPoint.time - this.dragState.startPoint.time;
        const deltaPrice = currentPoint.price - this.dragState.startPoint.price;
        drawing.points = this.dragState.originalPoints.map((point) => ({
          time: point.time + deltaTime,
          price: point.price + deltaPrice,
        }));
      }
      event.preventDefault();
      event.stopPropagation();
      this.queueDragRedraw();
      return;
    }
    if (!this.draft) return;
    const point = this.eventDrawingPoint(screenPoint);
    if (!point) return;
    const definition = tradingDrawingToolDefinition(this.draft.tool);
    if (definition?.freehand) {
      const previous = this.draft.points[this.draft.points.length - 1];
      const previousScreen = this.pointToScreen(previous);
      if (!previousScreen || Math.hypot(screenPoint.x - previousScreen.x, screenPoint.y - previousScreen.y) >= 2) {
        this.draft.points.push(point);
      }
    } else {
      this.draft.points[this.draft.points.length - 1] = point;
    }
    event.preventDefault();
    event.stopPropagation();
    this.queueDragRedraw();
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.dragState) {
      const mode = this.dragState.mode;
      this.dragState = null;
      this.redoStack = [];
      this.persistDrawings();
      this.releasePointer();
      this.overlay.classList.remove("dragging-drawing");
      this.redraw();
      this.setStatus(mode === "handle" ? "已调整端点" : "已移动绘图");
      return;
    }
    if (!this.draft) return;
    if (this.hasPendingDraftPoint()) {
      this.releasePointer();
      this.redraw();
      this.setStatus(this.draftPlacementStatus());
      return;
    }
    const end = this.eventScreenPoint(event);
    const start = this.pointerStart ?? end;
    const definition = tradingDrawingToolDefinition(this.draft.tool);
    const enoughMovement = (definition && tradingDrawingPlacementMode(definition) === "single-click")
      || Math.hypot(end.x - start.x, end.y - start.y) >= 3;
    if (enoughMovement) this.commitDraft();
    else this.cancelDraft();
  };

  private readonly handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    if (this.dragState) this.cancelSelectionDrag();
    else this.cancelDraft();
  };

  private selectTool(id: TradingDrawingToolId) {
    const definition = tradingDrawingToolDefinition(id);
    if (!definition) return;
    if (this.pendingTextDrawingId) this.discardPendingTextDrawing();
    if (this.dragState) this.cancelSelectionDrag();
    else this.cancelDraft();
    this.getNavigation?.()?.setTool(null);
    this.activeTool = definition.id;
    this.lastToolByGroup.set(definition.group, definition.id);
    this.overlay.classList.toggle("drawing-active", definition.kind !== "cursor");
    this.overlay.dataset.drawingTool = definition.id;
    if (definition.id === "price-note") this.setStatus("价格注释 · 请点击图表确定价格锚点");
    else if (definition.kind === "text") this.setStatus(`${definition.label} · 请点击图表放置文本`);
    else this.setStatus(definition.label);
    this.updateToolbarState();
    this.emitSharedToolState();
  }

  private emitSharedToolState() {
    this.onSharedToolStateChanged?.(this.sharedToolState(), this);
  }

  private activeToolLabel() {
    return tradingDrawingToolDefinition(this.activeTool)?.label ?? "光标";
  }

  private drawingStyleForTool(tool: TradingDrawingToolId): TradingDrawingStyle {
    const style = this.drawingStyles.get(tool);
    return style ? { ...style } : {};
  }

  private rememberDrawingStyle(drawing: TradingDrawingModel | null) {
    if (!drawing || drawing.source === "ai") return;
    this.drawingStyles.set(drawing.tool, tradingDrawingStyleFromModel(drawing));
    this.emitSharedToolState();
  }

  private beginTextDrawing(
    tool: TradingDrawingToolId,
    point: TradingDrawingPoint,
    screenPoint: ScreenPoint,
    initialText = "",
  ) {
    const drawing: TradingDrawingModel = {
      id: crypto.randomUUID(),
      symbol: this.getSymbol(),
      interval: this.getInterval(),
      tool,
      points: [point],
      text: initialText,
      ...this.drawingStyleForTool(tool),
      viewportAnchor: tool === "anchored-text"
        ? tradingDrawingViewportAnchor(screenPoint, this.plotBounds())
        : undefined,
    };
    this.drawings.push(drawing);
    this.redoStack = [];
    this.selectedDrawingId = drawing.id;
    this.selectionToolbarPosition = null;
    if (!this.stayInDrawingMode) this.selectTool("cursor");
    this.pendingTextDrawingId = drawing.id;
    this.redraw();
    this.setStatus("请输入文本内容");
    this.openPendingTextEditor(drawing);
  }

  private openPendingTextEditor(drawing: TradingDrawingModel) {
    window.requestAnimationFrame(() => {
      if (this.selectedDrawingId !== drawing.id) return;
      const trigger = this.selectionToolbar.querySelector<HTMLElement>('[data-drawing-selection-action="edit-text"]');
      if (trigger) this.openTextInput(drawing, trigger);
    });
  }

  private hasPendingDraftPoint() {
    return Boolean(
      this.draft
      && this.draftRequiredPointCount > 1
      && this.draftConfirmedPointCount < this.draftRequiredPointCount
    );
  }

  private draftPlacementStatus() {
    const definition = tradingDrawingToolDefinition(this.draft?.tool);
    if (definition?.kind === "triangle") {
      return this.draftConfirmedPointCount >= 2
        ? "第二个端点已设置 · 移动鼠标选择第三个端点，再次点击完成 · 右键撤销上一端点"
        : "移动鼠标选择第二个端点，再次点击确定一边 · 右键撤销上一端点";
    }
    if (definition?.id === "price-note") {
      return "价格锚点已设置 · 移动鼠标选择标签位置，再次点击后输入注释 · 右键撤销上一端点";
    }
    if (definition?.kind === "fib") {
      return "100% 端点已设置 · 移动鼠标展开 0% 端点，再次点击完成 · 右键撤销上一端点";
    }
    if (definition?.kind === "pattern") {
      const nextPoint = Math.min(this.draftConfirmedPointCount + 1, this.draftRequiredPointCount);
      return `${definition.label} · 第 ${this.draftConfirmedPointCount} 个端点已设置（共 ${this.draftRequiredPointCount} 个） · 移动鼠标选择第 ${nextPoint} 个端点，再次点击继续 · 右键撤销上一端点`;
    }
    return "移动鼠标选择终点，再次点击完成 · 右键撤销上一端点";
  }

  private setStatus(message: string) {
    if (!this.controlActive) return;
    this.status.textContent = message;
  }

  private toggleToolMenu(group: TradingDrawingGroupId, trigger: HTMLElement) {
    const open = this.activeMenu !== group;
    this.closeToolMenus();
    if (!open) return;
    const menu = this.toolbar.querySelector<HTMLElement>(`[data-drawing-tool-menu="${group}"]`);
    if (!menu) return;
    this.activeMenu = group;
    menu.hidden = false;
    const toolbarRect = this.toolbar.getBoundingClientRect();
    const triggerRect = trigger.closest<HTMLElement>("[data-drawing-group]")?.getBoundingClientRect()
      ?? trigger.getBoundingClientRect();
    const maxTop = Math.max(4, toolbarRect.height - Math.min(menu.scrollHeight || 420, 520) - 4);
    menu.style.top = `${Math.min(Math.max(triggerRect.top - toolbarRect.top, 4), maxTop)}px`;
    trigger.setAttribute("aria-expanded", "true");
  }

  private closeToolMenus() {
    this.activeMenu = null;
    this.toolbar.querySelectorAll<HTMLElement>("[data-drawing-tool-menu]").forEach((menu) => {
      menu.hidden = true;
    });
    this.toolbar.querySelectorAll<HTMLElement>('[data-drawing-action="toggle-tool-menu"]').forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  private selectedDrawing() {
    return this.selectedDrawingId
      ? this.drawings.find((drawing) => (
          drawing.id === this.selectedDrawingId
          && tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)
        )) ?? null
      : null;
  }

  private textInputElement() {
    return this.selectionToolbar.querySelector<HTMLTextAreaElement>("[data-drawing-text-input]");
  }

  private openTextInput(drawing: TradingDrawingModel, trigger: HTMLElement) {
    this.toggleSelectionMenu("text-input", trigger);
    if (this.activeSelectionMenu !== "text-input") return;
    const definition = tradingDrawingToolDefinition(drawing.tool);
    const title = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-text-input-title]");
    if (title) title.textContent = `${definition?.label ?? "文本"}输入`;
    const input = this.textInputElement();
    if (!input) return;
    input.value = drawing.text ?? "";
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  private confirmTextInput(drawing: TradingDrawingModel) {
    const input = this.textInputElement();
    const text = input?.value.trim().slice(0, 240) ?? "";
    if (!text) {
      this.setStatus("请输入文本内容");
      input?.focus();
      return;
    }
    drawing.text = text;
    if (this.pendingTextDrawingId === drawing.id) this.pendingTextDrawingId = null;
    this.persistDrawingEdit("已确定文本");
  }

  private discardPendingTextDrawing() {
    const pendingId = this.pendingTextDrawingId;
    if (!pendingId) return false;
    const index = this.drawings.findIndex((drawing) => drawing.id === pendingId);
    if (index >= 0) this.drawings.splice(index, 1);
    if (this.selectedDrawingId === pendingId) this.selectedDrawingId = null;
    this.pendingTextDrawingId = null;
    return true;
  }

  private closeTextInput() {
    const discarded = this.discardPendingTextDrawing();
    this.closeSelectionMenus();
    this.redraw();
    this.setStatus(discarded ? "已取消文本输入" : "已关闭文本输入");
  }

  private selectDrawing(id: string | null) {
    if (this.pendingTextDrawingId && id !== this.pendingTextDrawingId) {
      this.discardPendingTextDrawing();
    }
    if (id === this.selectedDrawingId) {
      this.redraw();
      return;
    }
    this.finishSelectionToolbarDrag();
    this.selectedDrawingId = id;
    this.selectionToolbarPosition = null;
    this.closeSelectionMenus();
    this.redraw();
  }

  private toggleSelectionMenu(menuName: TradingDrawingSelectionMenu, trigger: HTMLElement) {
    const open = this.activeSelectionMenu !== menuName;
    this.closeSelectionMenus();
    if (!open) return;
    const menu = this.selectionToolbar.querySelector<HTMLElement>(`[data-drawing-selection-popover="${menuName}"]`);
    if (!menu) return;
    this.activeSelectionMenu = menuName;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  private closeSelectionMenus() {
    this.activeSelectionMenu = null;
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-selection-popover]").forEach((menu) => {
      menu.hidden = true;
    });
    this.selectionToolbar.querySelectorAll<HTMLElement>("[aria-haspopup]").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  private persistDrawingEdit(message: string, closeMenu = true) {
    this.redoStack = [];
    this.rememberDrawingStyle(this.selectedDrawing());
    this.persistDrawings();
    if (closeMenu) this.closeSelectionMenus();
    this.redraw();
    this.setStatus(message);
  }

  private deleteSelectedDrawing() {
    const selectedIndex = this.drawings.findIndex((drawing) => drawing.id === this.selectedDrawingId);
    if (selectedIndex < 0) return;
    const [drawing] = this.drawings.splice(selectedIndex, 1);
    if (drawing.id === this.pendingTextDrawingId) this.pendingTextDrawingId = null;
    this.redoStack.push(drawing);
    this.selectedDrawingId = null;
    this.selectionToolbarPosition = null;
    this.closeSelectionMenus();
    this.persistDrawings();
    this.redraw();
    this.setStatus("已删除绘图");
  }

  private eventScreenPoint(event: Pick<MouseEvent, "clientX" | "clientY">): ScreenPoint {
    const rect = this.chartElement.getBoundingClientRect();
    const bounds = this.plotBounds();
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), bounds.height),
    };
  }

  private eventDrawingPoint(screen: ScreenPoint): TradingDrawingPoint | null {
    return this.screenToDrawingPoint(screen, true);
  }

  private screenToDrawingPoint(screen: ScreenPoint, applyMagnet: boolean): TradingDrawingPoint | null {
    const chart = this.getChart();
    const candleSeries = this.getCandleSeries();
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    const logical = finiteTradingChartCoordinate(timeScale.coordinateToLogical(screen.x));
    const logicalTime = logical === null
      ? null
      : tradingDrawingTimeAtLogicalIndex(this.getCandles(), logical);
    const chartTime = logicalTime === null
      ? finiteTradingChartCoordinate(timeScale.coordinateToTime(screen.x))
      : null;
    const price = finiteTradingChartCoordinate(candleSeries.coordinateToPrice(screen.y));
    const time = logicalTime ?? (chartTime === null ? null : chartTime - this.timeOffsetSeconds);
    if (time === null || price === null) return null;
    let point = { time, price };
    if (applyMagnet && this.magnetEnabled && this.drawingScope === "main") {
      point = this.snapPointToCandle(point, screen);
    }
    return point;
  }

  private snapPointToCandle(point: TradingDrawingPoint, screen: ScreenPoint) {
    const candles = this.getCandles();
    if (!candles.length) return point;
    let nearest = candles[0];
    let distance = Math.abs(nearest.time - point.time);
    candles.forEach((candle) => {
      const candidateDistance = Math.abs(candle.time - point.time);
      if (candidateDistance < distance) {
        nearest = candle;
        distance = candidateDistance;
      }
    });
    const chart = this.getChart();
    const nearestX = finiteTradingChartCoordinate(
      chart?.timeScale?.().timeToCoordinate((nearest.time + this.timeOffsetSeconds) as any),
    );
    if (nearestX === null || Math.abs(nearestX - screen.x) > DRAWING_MAGNET_DISTANCE) return point;
    const prices = [nearest.open, nearest.high, nearest.low, nearest.close];
    const candleSeries = this.getCandleSeries();
    const nearestPrice = prices.reduce((selected, candidate) => {
      const selectedY = finiteTradingChartCoordinate(candleSeries.priceToCoordinate(selected));
      const candidateY = finiteTradingChartCoordinate(candleSeries.priceToCoordinate(candidate));
      if (candidateY === null) return selected;
      if (selectedY === null) return candidate;
      return Math.abs(candidateY - screen.y) < Math.abs(selectedY - screen.y) ? candidate : selected;
    }, prices[0]);
    const nearestY = finiteTradingChartCoordinate(candleSeries.priceToCoordinate(nearestPrice));
    return nearestY !== null && Math.abs(nearestY - screen.y) <= DRAWING_MAGNET_DISTANCE
      ? { time: nearest.time, price: nearestPrice }
      : { time: nearest.time, price: point.price };
  }

  private pointToScreen(point: TradingDrawingPoint): ScreenPoint | null {
    const chart = this.getChart();
    const candleSeries = this.getCandleSeries();
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    const logical = tradingDrawingLogicalIndexAtTime(this.getCandles(), point.time);
    const logicalX = logical === null
      ? null
      : tradingDrawingLogicalToCoordinate(
        logical,
        (integerLogical) => timeScale.logicalToCoordinate(integerLogical as any),
      );
    const x = logicalX ?? finiteTradingChartCoordinate(
      timeScale.timeToCoordinate((point.time + this.timeOffsetSeconds) as any),
    );
    const y = finiteTradingChartCoordinate(candleSeries.priceToCoordinate(point.price));
    return x !== null && y !== null ? { x, y } : null;
  }

  private drawingPointToScreen(
    drawing: TradingDrawingModel,
    pointIndex: number,
    bounds: { width: number; height: number },
  ): ScreenPoint | null {
    if (drawing.tool === "anchored-text" && pointIndex === 0 && drawing.viewportAnchor) {
      return tradingDrawingAnchoredScreenPoint(drawing.viewportAnchor, bounds);
    }
    return this.pointToScreen(drawing.points[pointIndex]);
  }

  private ensureAnchoredViewportAnchor(drawing: TradingDrawingModel) {
    if (drawing.tool !== "anchored-text" || drawing.viewportAnchor || !drawing.points[0]) return;
    const screenPoint = this.pointToScreen(drawing.points[0]);
    if (screenPoint) drawing.viewportAnchor = tradingDrawingViewportAnchor(screenPoint, this.plotBounds());
  }

  private plotBounds() {
    const chart = this.getChart();
    if (chart) {
      // Native chart dimensions are already cached. Measuring this DOM surface
      // after price/legend writes forces a desktop layout for every drag frame.
      // The main pane can shrink when indicator panes are present. Keep its
      // drawing bounds inside that pane without forcing a DOM measurement.
      const height = chart.panes()[this.paneIndex]?.getHeight() || chart.options().height;
      return {
        width: Math.max(chart.timeScale().width(), 1),
        height: Math.max(height || 1, 1),
      };
    }
    return {
      width: Math.max(this.chartElement.clientWidth, 1),
      height: Math.max(this.chartElement.clientHeight, 1),
    };
  }

  private commitDraft() {
    if (!this.draft) return;
    const completed = this.draft;
    const definition = tradingDrawingToolDefinition(completed.tool);
    const pendingText = definition?.kind === "text";
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.drawings.push(completed);
    this.redoStack = [];
    this.releasePointer();
    this.draft = null;
    this.selectedDrawingId = completed.id;
    this.selectionToolbarPosition = null;
    if (!this.stayInDrawingMode) this.selectTool("cursor");
    if (pendingText) {
      this.pendingTextDrawingId = completed.id;
      this.redraw();
      this.setStatus("请输入文本内容");
      this.openPendingTextEditor(completed);
      return;
    }
    this.persistDrawings();
    if (this.stayInDrawingMode) {
      this.setStatus(`${this.activeToolLabel()} · 已完成`);
      this.updateToolbarState();
      this.redraw();
    }
  }

  private cancelDraft() {
    this.releasePointer();
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.draft = null;
    this.redraw();
  }

  private cancelSelectionDrag() {
    if (this.dragState) {
      const drawing = this.drawings.find((candidate) => candidate.id === this.dragState?.drawingId);
      if (drawing) {
        drawing.points = this.dragState.originalPoints.map((point) => ({ ...point }));
        drawing.viewportAnchor = this.dragState.originalViewportAnchor
          ? { ...this.dragState.originalViewportAnchor }
          : undefined;
      }
    }
    this.dragState = null;
    this.overlay.classList.remove("dragging-drawing");
    this.releasePointer();
    this.redraw();
  }

  private capturePointer(pointerId: number) {
    try {
      this.overlay.setPointerCapture?.(pointerId);
    } catch {
      // Document-level listeners keep the drag alive if Chromium rejects capture.
    }
  }

  private queueDragRedraw() {
    if (this.dragRedrawFrame !== null) return;
    this.dragRedrawFrame = window.requestAnimationFrame(() => {
      this.dragRedrawFrame = null;
      this.redraw();
    });
  }

  private cancelDragRedraw() {
    if (this.dragRedrawFrame === null) return;
    window.cancelAnimationFrame(this.dragRedrawFrame);
    this.dragRedrawFrame = null;
  }

  private releasePointer() {
    this.cancelDragRedraw();
    if (this.pointerId !== null && this.overlay.hasPointerCapture?.(this.pointerId)) {
      this.overlay.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.pointerStart = null;
  }

  private joinManualDrawingSession() {
    let session = manualDrawingSessions.get(this.storageSessionId);
    if (!session) {
      session = { drawings: loadStoredDrawings(this.storageSessionId), controllers: new Set() };
      manualDrawingSessions.set(this.storageSessionId, session);
    }
    this.manualDrawingSession = session;
    session.controllers.add(this);
  }

  private leaveManualDrawingSession() {
    this.manualDrawingSession.controllers.delete(this);
    if (!this.manualDrawingSession.controllers.size) manualDrawingSessions.delete(this.storageSessionId);
  }

  private refreshManualDrawingPeers(clearHistory = false) {
    for (const peer of this.manualDrawingSession.controllers) {
      if (peer === this) continue;
      if (clearHistory) {
        peer.redoStack = [];
        peer.draft = null;
        peer.pendingTextDrawingId = null;
        peer.selectedDrawingId = null;
        peer.dragState = null;
        peer.releasePointer();
        peer.closeSelectionMenus();
      }
      peer.redraw();
      peer.updateToolbarState();
    }
  }

  private persistDrawings(notify = true) {
    try {
      const pendingIds = new Set([...this.manualDrawingSession.controllers].map((peer) => peer.pendingTextDrawingId));
      const persisted = this.drawings.filter((drawing) => !pendingIds.has(drawing.id));
      window.localStorage.setItem(
        tradingDrawingSessionStorageKey("manual", this.storageSessionId),
        JSON.stringify(persisted.slice(-600)),
      );
      this.refreshManualDrawingPeers();
      if (notify) this.onDrawingStateChanged?.(this);
      return true;
    } catch {
      // Drawing remains available for the current session if storage is unavailable.
      return false;
    }
  }

  private persistAiDrawings(notify = true) {
    try {
      window.localStorage.setItem(
        tradingDrawingSessionStorageKey("ai", this.storageSessionId),
        JSON.stringify(this.aiDrawings.slice(-MAX_STORED_AI_DRAWINGS)),
      );
      if (notify) this.onDrawingStateChanged?.(this);
      return true;
    } catch {
      // AI drawings remain available for the current session if storage is unavailable.
      return false;
    }
  }

  private undo() {
    const symbol = this.getSymbol();
    for (let index = this.drawings.length - 1; index >= 0; index -= 1) {
      if (
        !tradingManualDrawingMatchesContext(this.drawings[index], symbol, this.getInterval(), this.drawingScope)
        || this.drawings[index].locked
      ) continue;
      const [drawing] = this.drawings.splice(index, 1);
      if (drawing.id === this.selectedDrawingId) {
        this.selectedDrawingId = null;
        this.selectionToolbarPosition = null;
      }
      this.redoStack.push(drawing);
      this.persistDrawings();
      this.redraw();
      this.setStatus("已撤销绘图");
      return;
    }
  }

  private redo() {
    const symbol = this.getSymbol();
    for (let index = this.redoStack.length - 1; index >= 0; index -= 1) {
      if (!tradingManualDrawingMatchesContext(this.redoStack[index], symbol, this.getInterval(), this.drawingScope)) continue;
      const [drawing] = this.redoStack.splice(index, 1);
      this.drawings.push(drawing);
      this.persistDrawings();
      this.redraw();
      this.setStatus("已重做绘图");
      return;
    }
  }

  private clearAllDrawings() {
    this.aiPlayback.cancel();
    this.cancelDragRedraw();
    this.releasePointer();
    this.finishSelectionToolbarDrag();
    const scopedClear = this.drawingScope !== "main";
    this.drawings = scopedClear
      ? this.drawings.filter((drawing) => (
          (drawing.drawingScope || "main") !== this.drawingScope
        ))
      : [];
    this.aiDrawings = scopedClear ? this.aiDrawings : [];
    this.redoStack = [];
    this.draft = null;
    this.aiDraft = null;
    this.aiCursorPoint = null;
    this.aiCursorPulse = false;
    this.dragState = null;
    this.pendingTextDrawingId = null;
    this.selectedDrawingId = null;
    this.selectionToolbarPosition = null;
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.drawingsLocked = false;
    this.drawingsHidden = false;
    this.overlay.classList.remove("dragging-drawing");
    this.closeSelectionMenus();
    if (scopedClear) {
      this.persistDrawings(false);
    } else {
      try {
        window.localStorage.removeItem(tradingDrawingSessionStorageKey("manual", this.storageSessionId));
        window.localStorage.removeItem(tradingDrawingSessionStorageKey("ai", this.storageSessionId));
      } catch {
        // The in-memory drawing history is still cleared when storage is unavailable.
      }
      this.onAiDrawingContextsChanged(null);
      this.refreshManualDrawingPeers(true);
    }
    this.redraw();
    this.updateToolbarState();
    this.setStatus("本会话所有绘图及历史记录已清空");
  }

  private eraseNearest(point: ScreenPoint) {
    const symbol = this.getSymbol();
    let selectedIndex = -1;
    let selectedDistance = 16;
    this.drawings.forEach((drawing, index) => {
      if (!tradingManualDrawingMatchesContext(drawing, symbol, this.getInterval(), this.drawingScope) || drawing.locked) return;
      const bounds = this.plotBounds();
      const screenPoints = drawing.points
        .map((_candidate, pointIndex) => this.drawingPointToScreen(drawing, pointIndex, bounds))
        .filter(Boolean) as ScreenPoint[];
      for (const candidate of screenPoints) {
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (distance < selectedDistance) {
          selectedIndex = index;
          selectedDistance = distance;
        }
      }
      if (screenPoints.length >= 2) {
        const first = screenPoints[0];
        const second = screenPoints[screenPoints.length - 1];
        const distance = distanceToSegment(point, first, second);
        if (distance < selectedDistance) {
          selectedIndex = index;
          selectedDistance = distance;
        }
      }
    });
    if (selectedIndex < 0) {
      this.setStatus("请点击绘图线条或控制点");
      return;
    }
    const [drawing] = this.drawings.splice(selectedIndex, 1);
    if (drawing.id === this.selectedDrawingId) {
      this.selectedDrawingId = null;
      this.selectionToolbarPosition = null;
    }
    this.redoStack.push(drawing);
    this.persistDrawings();
    this.redraw();
    this.updateToolbarState();
    this.setStatus("已删除绘图");
  }

  private zoomChart(factor: number) {
    const navigation = this.getNavigation?.();
    if (navigation) navigation.zoom(factor);
    else if (!zoomTradingChart(this.getChart(), factor)) return;
    this.redraw();
    this.setStatus(factor < 1 ? "已放大" : "已缩小");
  }

  private updateToolbarState() {
    if (!this.controlActive) return;
    const definition = tradingDrawingToolDefinition(this.activeTool);
    this.toolbar.querySelectorAll<HTMLElement>("[data-drawing-tool]").forEach((button) => {
      const selected = button.dataset.drawingTool === this.activeTool;
      button.classList.toggle("active", selected);
      if (button.hasAttribute("aria-checked") && button.getAttribute("aria-checked") !== String(selected)) button.setAttribute("aria-checked", String(selected));
    });
    this.toolbar.querySelectorAll<HTMLElement>("[data-drawing-group]").forEach((group) => {
      group.classList.toggle("active", group.dataset.drawingGroup === definition?.group);
      const primary = group.querySelector<HTMLElement>("[data-drawing-action=\"select-group-tool\"]");
      const current = this.lastToolByGroup.get(group.dataset.drawingGroup as TradingDrawingGroupId);
      const currentDefinition = tradingDrawingToolDefinition(current);
      if (primary && currentDefinition) {
        if (primary.dataset.drawingTool !== currentDefinition.id) primary.dataset.drawingTool = currentDefinition.id;
        updateTradingDrawingMarkup(primary, drawingIcon(currentDefinition.icon));
        const label = translateAppText(currentDefinition.label);
        if (primary.title !== label) primary.title = label;
        if (primary.getAttribute("aria-label") !== label) primary.setAttribute("aria-label", label);
      }
    });
    const setPressed = (action: string, pressed: boolean, icon?: string) => {
      const button = this.toolbar.querySelector<HTMLButtonElement>(`[data-drawing-action="${action}"]`);
      if (button && button.getAttribute("aria-pressed") !== String(pressed)) button.setAttribute("aria-pressed", String(pressed));
      button?.classList.toggle("active", pressed);
      if (button && icon) updateTradingDrawingMarkup(button, drawingIcon(icon));
    };
    setPressed("zoom-in", this.getNavigation?.()?.getTool() === "zoom");
    setPressed("measure", this.getNavigation?.()?.getTool() === "measure");
    setPressed("toggle-magnet", this.magnetEnabled);
    setPressed("toggle-stay", this.stayInDrawingMode);
    setPressed("toggle-lock", this.drawingsLocked, this.drawingsLocked ? "unlock" : "lock");
    setPressed("toggle-visibility", this.drawingsHidden, this.drawingsHidden ? "eye-off" : "eye");
    const symbol = this.getSymbol();
    const undo = this.toolbar.querySelector<HTMLButtonElement>('[data-drawing-action="undo"]');
    const redo = this.toolbar.querySelector<HTMLButtonElement>('[data-drawing-action="redo"]');
    if (undo) undo.disabled = !this.drawings.some((drawing) => (
      tradingManualDrawingMatchesContext(drawing, symbol, this.getInterval(), this.drawingScope) && !drawing.locked
    ));
    if (redo) redo.disabled = !this.redoStack.some((drawing) => (
      tradingManualDrawingMatchesContext(drawing, symbol, this.getInterval(), this.drawingScope)
    ));
  }

  private updateSelectionToolbar(bounds: { width: number; height: number }) {
    const drawing = this.selectedDrawing();
    if (!drawing || this.drawingsHidden) {
      this.selectionToolbar.hidden = true;
      return;
    }
    const definition = tradingDrawingToolDefinition(drawing.tool);
    const textMode = definition?.kind === "text";
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-selection-mode]").forEach((mode) => {
      mode.hidden = (mode.dataset.drawingSelectionMode === "text") !== textMode;
    });
    this.selectionToolbar.dataset.mode = textMode ? "text" : "drawing";
    const pointEntries = drawing.points
      .map((_point, index) => ({ index, point: this.drawingPointToScreen(drawing, index, bounds) }))
      .filter((entry): entry is { index: number; point: ScreenPoint } => Boolean(entry.point));
    const points = pointEntries.map((entry) => entry.point);
    if (!points.length) {
      this.selectionToolbar.hidden = true;
      return;
    }
    const color = drawing.color ?? (textMode
      ? isDarkTheme() ? DEFAULT_TEXT_COLOR_DARK : DEFAULT_TEXT_COLOR_LIGHT
      : isDarkTheme() ? DEFAULT_DRAWING_COLOR_DARK : DEFAULT_DRAWING_COLOR_LIGHT);
    const style = drawing.lineStyle ?? "solid";
    const width = drawing.lineWidth ?? DEFAULT_DRAWING_LINE_WIDTH;
    const stylePreview = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-style-preview]");
    if (stylePreview) stylePreview.className = `trading-drawing-line-preview ${style}`;
    const widthPreview = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-width-preview]");
    widthPreview?.style.setProperty("--drawing-width", `${width}px`);
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-color]").forEach((button) => {
      const selected = button.dataset.drawingColor?.toLowerCase() === color.toLowerCase();
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-text-color]").forEach((button) => {
      const selected = button.dataset.drawingTextColor?.toLowerCase() === color.toLowerCase();
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-background-color]").forEach((button) => {
      const background = button.dataset.drawingBackgroundColor;
      const selected = background === "transparent"
        ? !drawing.textBackgroundColor
        : background?.toLowerCase() === drawing.textBackgroundColor?.toLowerCase();
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const fontSizeLabel = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-font-size-label]");
    if (fontSizeLabel) fontSizeLabel.textContent = String(fontSize);
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-font-size]").forEach((button) => {
      const selected = Number(button.dataset.drawingFontSize) === fontSize;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    const bold = this.selectionToolbar.querySelector<HTMLButtonElement>('[data-drawing-selection-action="toggle-bold"]');
    bold?.setAttribute("aria-pressed", String(Boolean(drawing.bold)));
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-style]").forEach((button) => {
      const selected = button.dataset.drawingStyle === style;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-width]").forEach((button) => {
      const selected = Number(button.dataset.drawingWidth) === width;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    this.selectionToolbar.querySelectorAll<HTMLButtonElement>('[data-drawing-selection-action="toggle-lock"]').forEach((lock) => {
      updateTradingDrawingMarkup(lock, drawingIcon(drawing.locked ? "unlock" : "lock"));
      lock.setAttribute("aria-pressed", String(Boolean(drawing.locked)));
      lock.setAttribute("aria-label", drawing.locked ? "解锁" : "锁定");
      lock.title = drawing.locked ? "解锁" : "锁定";
    });
    this.selectionToolbar.dataset.locked = String(Boolean(drawing.locked));
    this.selectionToolbar.hidden = false;
    const panelWidth = this.selectionToolbar.offsetWidth || 326;
    const panelHeight = this.selectionToolbar.offsetHeight || 42;
    if (!this.selectionToolbarPosition) {
      const minimumX = Math.min(...points.map((point) => point.x));
      const maximumX = Math.max(...points.map((point) => point.x));
      const minimumY = Math.min(...points.map((point) => point.y));
      const maximumY = Math.max(...points.map((point) => point.y));
      const centeredLeft = (minimumX + maximumX - panelWidth) / 2;
      const preferredTop = minimumY - panelHeight - 18;
      const belowTop = maximumY + 18;
      this.selectionToolbarPosition = { x: centeredLeft, y: preferredTop >= 8 ? preferredTop : belowTop };
    }
    const position = clampTradingDrawingToolbarPosition(this.selectionToolbarPosition, bounds, {
      width: panelWidth,
      height: panelHeight,
    });
    this.selectionToolbarPosition = position;
    this.selectionToolbar.style.left = `${position.x}px`;
    this.selectionToolbar.style.top = `${position.y}px`;
  }

  private updateAxisMarkers(bounds: { width: number; height: number }) {
    const selectedDrawing = this.selectedDrawing();
    if (this.drawingsHidden) {
      updateTradingDrawingMarkup(this.axisMarkerLayer, "");
      return;
    }
    const visibleDrawings = this.drawings.filter((drawing) => (
      tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)
    ));
    const persistentHorizontalDrawings = visibleDrawings.filter((drawing) => (
      tradingDrawingToolDefinition(drawing.tool)?.kind === "horizontal"
    ));
    const markerDrawings = [
      ...persistentHorizontalDrawings,
      ...(selectedDrawing && !persistentHorizontalDrawings.some((drawing) => drawing.id === selectedDrawing.id)
        ? [selectedDrawing]
        : []),
    ];
    const markers = markerDrawings.flatMap((drawing) => {
      const definition = tradingDrawingToolDefinition(drawing.tool);
      if (!definition) return [];
      const markerPoints = definition.kind === "horizontal"
        ? tradingDrawingAlwaysVisibleAxisMarkerPoints(definition, drawing.points)
        : tradingDrawingAxisMarkerPoints(definition, drawing.points);
      return markerPoints.map((marker) => ({ ...marker, drawingId: drawing.id }));
    })
      .map((marker) => ({ ...marker, screen: this.pointToScreen(marker.point) }))
      .filter((marker): marker is TradingDrawingAxisMarkerPoint & { drawingId: string; screen: ScreenPoint } => Boolean(marker.screen));
    const priceScaleWidth = this.drawingScope === "main"
      ? Math.max(this.getChart()?.priceScale("right", this.paneIndex).width() || 0, 64)
      : 0;
    const priceMarkers = markers.filter((marker, index, entries) => (
      marker.showPrice
      && marker.screen.y >= 0
      && marker.screen.y <= bounds.height
      && !entries.slice(0, index).some((entry) => (
        entry.showPrice
        && entry.point.price === marker.point.price
        && Math.abs(entry.screen.y - marker.screen.y) < 1
      ))
    ));
    const timeMarkers = markers.filter((marker, index, entries) => (
      marker.showTime
      && marker.screen.x >= 0
      && marker.screen.x <= bounds.width
      && !entries.slice(0, index).some((entry) => (
        entry.showTime
        && entry.point.time === marker.point.time
        && Math.abs(entry.screen.x - marker.screen.x) < 1
      ))
    ));
    const priceHtml = priceScaleWidth > 0 ? priceMarkers.map((marker) => {
      const top = Math.min(Math.max(marker.screen.y, 12), Math.max(12, bounds.height - 12));
      return `<div class="trading-drawing-axis-marker price" data-drawing-axis-price style="left:${bounds.width}px;top:${top}px;width:${priceScaleWidth}px">${escapeHtml(formatTradingDrawingAxisPrice(marker.point.price))}</div>`;
    }).join("") : "";
    const timeHalfWidth = 70;
    const minimumTimeX = Math.min(timeHalfWidth + 4, bounds.width / 2);
    const maximumTimeX = Math.max(minimumTimeX, bounds.width - timeHalfWidth - 4);
    const timeHtml = timeMarkers.map((marker) => {
      const left = Math.min(Math.max(marker.screen.x, minimumTimeX), maximumTimeX);
      return `<time class="trading-drawing-axis-marker time" data-drawing-axis-time style="left:${left}px">${escapeHtml(formatTradingDrawingAxisTime(marker.point.time, this.timeOffsetSeconds))}</time>`;
    }).join("");
    updateTradingDrawingMarkup(this.axisMarkerLayer, priceHtml + timeHtml);
  }

  async playAiDrawingPatch(
    patch: TradingAiDrawingPatch,
    options: {
      onPhase?: (phase: TradingAiPlaybackPhase, drawing?: TradingAiDrawing) => void;
      beforePlayback?: () => void | Promise<void>;
    } = {},
  ) {
    const drawings = this.normalizeAiDrawingPatch(patch);
    const playbackStorageSessionId = this.storageSessionId;
    this.cancelAiPlayback({ clear: true });
    await options.beforePlayback?.();
    if (
      this.destroyed
      || this.storageSessionId !== playbackStorageSessionId
      || this.getSymbol() !== patch.marketId
      || this.getInterval() !== patch.interval
    ) return;
    await this.aiPlayback.play(drawings, options);
    if (
      !this.destroyed
      && this.storageSessionId === playbackStorageSessionId
      && this.getSymbol() === patch.marketId
      && this.getInterval() === patch.interval
    ) {
      // Playback cancellation is intentionally non-throwing. Re-apply the complete
      // patch so a cancelled frame sequence can never leave a blank or partial chart.
      this.storeAiDrawingPatch(patch);
    }
  }

  storeAiDrawingPatch(patch: TradingAiDrawingPatch) {
    const drawings = normalizeTradingAiDrawingPatch(patch).map(tradingAiDrawingModel);
    this.aiDrawings = replaceTradingAiDrawingContext(
      this.aiDrawings,
      patch.marketId,
      patch.interval,
      drawings,
    );
    this.persistAiDrawings();
    this.redraw();
  }

  cancelAiPlayback(options: { clear?: boolean } = {}) {
    this.aiPlayback.cancel();
    this.aiDraft = null;
    this.aiCursorPoint = null;
    if (options.clear === true) {
      this.aiDrawings = replaceTradingAiDrawingContext(
        this.aiDrawings,
        this.getSymbol(),
        this.getInterval(),
      );
      this.persistAiDrawings(false);
    }
    this.redraw();
  }

  clearAiDrawings() {
    this.cancelAiPlayback({ clear: true });
    const latest = this.aiDrawings.at(-1);
    this.onAiDrawingContextsChanged(latest?.symbol && latest.interval
      ? { marketId: latest.symbol, interval: latest.interval }
      : null);
  }

  clearAiAnalysisForCurrentContext(strategyId: string) {
    const normalizedStrategyId = String(strategyId || "").trim();
    if (!normalizedStrategyId) return false;
    this.cancelAiPlayback();
    const previousLength = this.aiDrawings.length;
    this.aiDrawings = this.aiDrawings.filter((drawing) => (
      !tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval())
      || drawing.strategyId !== normalizedStrategyId
    ));
    if (this.aiDrawings.length === previousLength) return false;
    this.persistAiDrawings();
    this.redraw();
    return true;
  }

  hasAiAnalysisForCurrentContext(theory?: string) {
    const colorPrefix = theory ? `${theory}-` : "";
    return this.aiDrawings.some((drawing) => (
      tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval())
      && (!theory
        || drawing.strategyId === theory
        || String(drawing.colorToken || "").startsWith(colorPrefix))
    ));
  }

  private normalizeAiDrawingPatch(patch: TradingAiDrawingPatch) {
    return normalizeTradingAiDrawingPatch(patch, {
      marketId: this.getSymbol(),
      interval: this.getInterval(),
    });
  }

  private aiDrawingModel(drawing: TradingAiDrawing): TradingDrawingModel {
    return tradingAiDrawingModel({
      ...drawing,
      interval: drawing.interval || this.getInterval(),
    });
  }

  private renderAiCursor(bounds: { width: number; height: number }) {
    if (!this.aiCursorPoint || this.drawingsHidden || this.destroyed) {
      updateTradingDrawingMarkup(this.aiCursorContent, "");
      return;
    }
    const point = this.pointToScreen(this.aiCursorPoint);
    if (!point || point.x < -24 || point.x > bounds.width + 24 || point.y < -24 || point.y > bounds.height + 24) {
      updateTradingDrawingMarkup(this.aiCursorContent, "");
      return;
    }
    updateTradingDrawingMarkup(this.aiCursorContent, `<g class="trading-ai-cursor${this.aiCursorPulse ? " pulse" : ""}" transform="translate(${point.x} ${point.y})">`
      + `<circle class="trading-ai-cursor-ripple" cx="0" cy="0" r="6" />`
      + `<path class="trading-ai-cursor-pointer" d="M 0 0 L 3.5 16 L 7.2 10.1 L 13.3 9.2 Z" />`
      + `<g class="trading-ai-cursor-badge" transform="translate(11 -15)"><rect x="0" y="0" width="24" height="16" rx="8"/><text x="12" y="11.5" text-anchor="middle">AI</text></g>`
      + `</g>`);
    this.aiCursorPulse = false;
  }

  private visibleCandleObstacles(bounds: { width: number; height: number }) {
    const candles = this.getCandles();
    const timeScale = this.getChart()?.timeScale();
    // Include the same 12px edge tolerance used below, including very narrow
    // bars. Off-screen history cannot collide with a visible annotation.
    const from = timeScale?.coordinateToLogical(-12);
    const to = timeScale?.coordinateToLogical(bounds.width + 12);
    const start = from != null && Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0;
    const end = to != null && Number.isFinite(to) ? Math.max(start, Math.min(candles.length, Math.ceil(to) + 1)) : candles.length;
    const screenCandles = candles.slice(start, end).map((candle) => {
      const high = this.pointToScreen({ time: candle.time, price: candle.high });
      const low = this.pointToScreen({ time: candle.time, price: candle.low });
      if (!high || !low) return null;
      const x = (high.x + low.x) / 2;
      if (x < -12 || x > bounds.width + 12) return null;
      return { x, top: Math.min(high.y, low.y), bottom: Math.max(high.y, low.y) };
    }).filter((candle): candle is { x: number; top: number; bottom: number } => Boolean(candle));
    const xCoordinates = screenCandles.map((candle) => candle.x).sort((first, second) => first - second);
    const spacings = xCoordinates.slice(1)
      .map((x, index) => x - xCoordinates[index])
      .filter((spacing) => spacing > 0.5 && Number.isFinite(spacing))
      .sort((first, second) => first - second);
    const medianSpacing = spacings.length ? spacings[Math.floor(spacings.length / 2)] : 8;
    const halfWidth = Math.max(3, Math.min(10, medianSpacing * 0.46 + 2));
    return screenCandles.map((candle): TradingDrawingCollisionRect => {
      const left = Math.max(0, candle.x - halfWidth);
      const right = Math.min(bounds.width, candle.x + halfWidth);
      const top = Math.max(0, candle.top - 3);
      const bottom = Math.min(bounds.height, candle.bottom + 3);
      return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };
    }).filter((rect) => rect.y < bounds.height && rect.y + rect.height > 0);
  }

  private visiblePriceActionDrawingObstacles(
    drawings: TradingDrawingModel[],
    bounds: { width: number; height: number },
  ) {
    const obstacles: TradingDrawingCollisionRect[] = [];
    const addRect = (x: number, y: number, width: number, height: number) => {
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(bounds.width, x + width);
      const bottom = Math.min(bounds.height, y + height);
      if (right <= left || bottom <= top) return;
      obstacles.push({ x: left, y: top, width: right - left, height: bottom - top });
    };
    const addSegment = (first: ScreenPoint, second: ScreenPoint, padding = 4) => {
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(dx) <= 2 || Math.abs(dy) <= 2) {
        addRect(
          Math.min(first.x, second.x) - padding,
          Math.min(first.y, second.y) - padding,
          Math.abs(dx) + padding * 2,
          Math.abs(dy) + padding * 2,
        );
        return;
      }
      const samples = Math.max(1, Math.ceil(distance / 24));
      for (let index = 0; index <= samples; index += 1) {
        const progress = index / samples;
        addRect(first.x + dx * progress - padding, first.y + dy * progress - padding, padding * 2, padding * 2);
      }
    };

    for (const drawing of drawings) {
      if (drawing.strategyId !== "price-action" || tradingDrawingIsPriceActionCandlestickPatternLabel(drawing)) continue;
      const points = drawing.points.map((point) => this.pointToScreen(point)).filter((point): point is ScreenPoint => Boolean(point));
      if (!points.length) continue;
      const first = points[0];
      const last = points.at(-1) ?? first;
      if (drawing.tool === "text" || drawing.tool === "anchored-text") {
        const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const layout = tradingDrawingTextLayout(drawing.text ?? "", fontSize);
        addRect(first.x - layout.width / 2, first.y - fontSize, layout.width, layout.height);
      } else if (drawing.tool === "circle") {
        const circle = tradingDrawingCircleGeometry(first, last);
        addRect(
          circle.cx - circle.radius,
          circle.cy - circle.radius,
          circle.radius * 2,
          circle.radius * 2,
        );
      } else if (drawing.tool === "ellipse") {
        addRect(
          Math.min(first.x, last.x),
          Math.min(first.y, last.y),
          Math.abs(last.x - first.x),
          Math.abs(last.y - first.y),
        );
      } else if (drawing.tool === "rectangle") {
        const left = Math.min(first.x, last.x);
        const right = Math.max(first.x, last.x);
        const top = Math.min(first.y, last.y);
        const bottom = Math.max(first.y, last.y);
        addSegment({ x: left, y: top }, { x: right, y: top });
        addSegment({ x: right, y: top }, { x: right, y: bottom });
        addSegment({ x: right, y: bottom }, { x: left, y: bottom });
        addSegment({ x: left, y: bottom }, { x: left, y: top });
      } else if (drawing.tool === "path") {
        for (let index = 1; index < points.length; index += 1) addSegment(points[index - 1], points[index]);
      } else if (["arrow-up", "arrow-down"].includes(drawing.tool)) {
        addRect(first.x - 10, first.y - 10, 20, 20);
      }
    }
    return obstacles;
  }

  private visibleOrderFlowBoxObstacles(
    drawings: TradingDrawingModel[],
    bounds: { width: number; height: number },
  ) {
    return drawings.flatMap((drawing): TradingDrawingCollisionRect[] => {
      if (
        !String(drawing.colorToken || "").startsWith("order-flow-")
        || drawing.tool !== "rectangle"
        || drawing.points.length < 2
      ) {
        return [];
      }
      const first = this.pointToScreen(drawing.points[0]);
      const second = this.pointToScreen(drawing.points[1]);
      if (!first || !second) return [];
      const left = Math.max(0, Math.min(first.x, second.x));
      const right = Math.min(bounds.width, Math.max(first.x, second.x));
      const top = Math.max(0, Math.min(first.y, second.y));
      const bottom = Math.min(bounds.height, Math.max(first.y, second.y));
      if (right <= left || bottom <= top) return [];
      return [{ x: left, y: top, width: right - left, height: bottom - top }];
    });
  }

  private visibleGannTheoryBoxObstacles(
    drawings: TradingDrawingModel[],
    bounds: { width: number; height: number },
  ) {
    return drawings.flatMap((drawing): TradingDrawingCollisionRect[] => {
      if (!tradingDrawingIsGannTheoryBox(drawing) || drawing.points.length < 2) return [];
      const first = this.pointToScreen(drawing.points[0]);
      const second = this.pointToScreen(drawing.points.at(-1) ?? drawing.points[0]);
      if (!first || !second) return [];
      const left = Math.max(0, Math.min(first.x, second.x));
      const right = Math.min(bounds.width, Math.max(first.x, second.x));
      const top = Math.max(0, Math.min(first.y, second.y));
      const bottom = Math.min(bounds.height, Math.max(first.y, second.y));
      if (right <= left || bottom <= top) return [];
      return [{ x: left, y: top, width: right - left, height: bottom - top }];
    });
  }

  redraw() {
    if (this.destroyed) return;
    const bounds = this.plotBounds();
    this.overlay.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    this.overlay.setAttribute("width", String(bounds.width));
    this.overlay.setAttribute("height", String(bounds.height));
    const candleSeries = this.getCandleSeries();
    const priceToCoordinate = (price: number) => finiteTradingChartCoordinate(candleSeries?.priceToCoordinate(price));
    // Most charts have no order labels or notes to avoid. Do not scan history
    // just to render an empty layer, and share the work when both need it.
    let obstacles: TradingDrawingCollisionRect[] | null = null;
    const candleObstacles = () => obstacles ??= this.drawingScope === "main" ? this.visibleCandleObstacles(bounds) : [];
    updateTradingDrawingMarkup(this.orderLineContent, candleSeries && this.drawingScope === "main" && this.orderLines.length
      ? renderTradingOrderLineSvg(
        this.orderLines,
        this.getSymbol(),
        bounds,
        priceToCoordinate,
        candleObstacles(),
      )
      : "");
    updateTradingDrawingMarkup(this.orderPositionCardLayer, candleSeries && this.drawingScope === "main" && this.orderLines.length
      ? renderTradingOrderPositionCards(
        this.orderLines,
        this.getSymbol(),
        bounds,
        priceToCoordinate,
        candleObstacles(),
      )
      : "");
    fitTradingOrderLineLabels(this.orderLineContent, this.orderPositionCardLayer, bounds);
    this.setOpenOrderPositionCard(this.openOrderPositionCardId);
    if (this.drawingsHidden) {
      updateTradingDrawingMarkup(this.content, "");
      updateTradingDrawingMarkup(this.aiContent, "");
      updateTradingDrawingMarkup(this.aiTextHitContent, "");
      updateTradingDrawingMarkup(this.aiCursorContent, "");
      this.hideAiTextSizeToolbar();
      this.updateSelectionToolbar(bounds);
      this.updateAxisMarkers(bounds);
      return;
    }
    const symbol = this.getSymbol();
    const interval = this.getInterval();
    const drawings = this.drawings.filter((drawing) => (
      tradingManualDrawingMatchesContext(drawing, symbol, interval, this.drawingScope)
    ));
    if (this.draft && tradingManualDrawingMatchesContext(this.draft, symbol, interval, this.drawingScope)) drawings.push(this.draft);
    updateTradingDrawingMarkup(this.content, drawings.map((drawing) => this.renderDrawing(drawing, bounds, drawing === this.draft)).join(""));
    const aiSourceDrawings = this.drawingScope === "main"
      ? this.aiDrawings.filter((drawing) => tradingAiDrawingMatchesContext(drawing, symbol, interval))
      : [];
    if (this.aiDraft && tradingAiDrawingMatchesContext(this.aiDraft, symbol, interval)) {
      aiSourceDrawings.push(this.aiDraft);
    }
    const aiDrawings = aiSourceDrawings.map((drawing) => tradingAiDrawingDisplayModel(drawing));
    const aiCandlestickLabelRequests = aiDrawings.flatMap((drawing): TradingAiNoteLayoutRequest[] => {
      if (!tradingDrawingIsPriceActionCandlestickPatternLabel(drawing) || !drawing.points[0]) return [];
      const anchor = this.pointToScreen(drawing.points[0]);
      if (!anchor || !tradingDrawingScreenPointVisible(anchor, bounds)) return [];
      return [{
        id: drawing.id,
        anchor,
        text: drawing.text ?? "",
        fontSize: drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        avoidBoxInteriors: true,
        maxLeaderDistance: 180,
      }];
    });
    const aiNoteRequests = aiDrawings.flatMap((drawing): TradingAiNoteLayoutRequest[] => {
      if (drawing.tool !== "note" || !drawing.points[0]) return [];
      const anchor = this.pointToScreen(drawing.points[0]);
      if (!anchor || !tradingDrawingScreenPointVisible(anchor, bounds)) return [];
      const isOrderFlowNote = String(drawing.colorToken || "").startsWith("order-flow-");
      const isGannTheoryNote = drawing.strategyId === "gann-theory";
      return [{
        id: drawing.id,
        anchor,
        text: drawing.text ?? "",
        fontSize: drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        avoidBoxInteriors: isOrderFlowNote || isGannTheoryNote,
        maxLeaderDistance: ["order-flow-buy", "order-flow-sell", "order-flow-poc"]
          .includes(String(drawing.colorToken || ""))
          ? 220
          : isGannTheoryNote ? 360 : undefined,
      }];
    });
    const orderFlowBoxObstacles = this.visibleOrderFlowBoxObstacles(aiDrawings, bounds);
    const priceActionDrawingObstacles = this.visiblePriceActionDrawingObstacles(aiDrawings, bounds);
    const gannTheoryBoxObstacles = this.visibleGannTheoryBoxObstacles(aiDrawings, bounds);
    const aiTextLayoutRequests = [...aiCandlestickLabelRequests, ...aiNoteRequests];
    const aiTextLayouts = new Map((aiTextLayoutRequests.length
      ? layoutTradingAiNoteBoxes(
        aiTextLayoutRequests,
        bounds,
        candleObstacles(),
        [...orderFlowBoxObstacles, ...priceActionDrawingObstacles, ...gannTheoryBoxObstacles],
      )
      : []
    ).map((placement) => [placement.id, placement.geometry]));
    const orderedAiDrawings = [...aiDrawings].sort((left, right) => (
      tradingDrawingPriceActionCandlestickLayerRank(left)
      - tradingDrawingPriceActionCandlestickLayerRank(right)
    ));
    updateTradingDrawingMarkup(this.aiContent, orderedAiDrawings
      .map((drawing) => {
        const textLayout = aiTextLayouts.get(drawing.id);
        if (drawing.tool === "note" && !textLayout) return "";
        return this.renderDrawing(
          drawing,
          bounds,
          drawing.id === this.aiDraft?.id,
          false,
          textLayout,
        );
      })
      .map((markup) => `<g data-i18n-skip>${markup}</g>`)
      .join(""));
    updateTradingDrawingMarkup(this.aiTextHitContent, orderedAiDrawings
      .map((drawing) => {
        if (drawing.id === this.aiDraft?.id) return "";
        const textLayout = aiTextLayouts.get(drawing.id);
        if (drawing.tool === "note" && !textLayout) return "";
        return this.renderAiTextSizeHitTarget(drawing, bounds, textLayout);
      })
      .join(""));
    this.renderAiCursor(bounds);
    this.updateAiTextSizeToolbar(bounds);
    this.updateToolbarState();
    this.updateSelectionToolbar(bounds);
    this.updateAxisMarkers(bounds);
  }

  private renderDrawing(
    drawing: TradingDrawingModel,
    bounds: { width: number; height: number },
    draft: boolean,
    interactive = true,
    resolvedTextGeometry?: ReturnType<typeof tradingDrawingNoteBoxGeometry>,
  ) {
    const definition = tradingDrawingToolDefinition(drawing.tool);
    if (!definition) return "";
    if (
      tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing)
      && tradingDrawingIsSingleCandlePatternSpan(this.getCandles(), drawing.points)
    ) return "";
    this.ensureAnchoredViewportAnchor(drawing);
    const pointEntries = drawing.points
      .map((_point, index) => ({ index, point: this.drawingPointToScreen(drawing, index, bounds) }))
      .filter((entry): entry is { index: number; point: ScreenPoint } => Boolean(entry.point));
    const points = pointEntries.map((entry) => entry.point);
    if (!points.length) return "";
    const first = points[0];
    const second = points[points.length - 1] ?? first;
    const color = drawing.color ?? tradingAiDrawingColor(drawing.colorToken) ?? (definition.kind === "text"
      ? isDarkTheme() ? DEFAULT_TEXT_COLOR_DARK : DEFAULT_TEXT_COLOR_LIGHT
      : isDarkTheme() ? DEFAULT_DRAWING_COLOR_DARK : DEFAULT_DRAWING_COLOR_LIGHT);
    const opacity = draft ? 0.72 : 1;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const selected = interactive && drawing.id === this.selectedDrawingId;
    const lineAppearance: TradingDrawingStrokeAppearance = {
      opacity,
      width: drawing.lineWidth,
      style: drawing.lineStyle,
    };
    const segmentLine = clipTradingDrawingLine(first, second, bounds, "segment") ?? [first, second];
    const rayLine = clipTradingDrawingLine(first, second, bounds, "ray") ?? [first, second];
    const extendedLine = clipTradingDrawingLine(first, second, bounds, "extended") ?? [first, second];
    const handleEntries = definition.kind === "fib"
      ? pointEntries.filter(({ point }, index, entries) => !entries.slice(0, index).some((entry) => (
        Math.hypot(entry.point.x - point.x, entry.point.y - point.y) < 1
      )))
      : tradingDrawingPlacementMode(definition) === "single-click"
        ? pointEntries.slice(0, 1)
        : pointEntries.slice(0, 12);
    const handles = interactive && (draft || selected)
      ? definition.kind === "fib"
        ? handleEntries.map(({ point, index }) => `<circle class="trading-drawing-handle fibonacci" data-drawing-handle-index="${index}" data-fibonacci-endpoint="${index === 0 ? "100" : "0"}" cx="${point.x}" cy="${point.y}" r="${FIBONACCI_HANDLE_RADIUS}" fill="var(--trading-market-panel)" stroke="${drawing.color ?? "var(--trading-fibonacci-handle-stroke)"}" stroke-width="2" vector-effect="non-scaling-stroke" />`).join("")
        : handleEntries.map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" cx="${point.x}" cy="${point.y}" r="${DRAWING_HANDLE_RADIUS}" fill="var(--trading-market-panel)" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" />`).join("")
      : "";
    let body = "";

    if (definition.kind === "line") body = svgLine(segmentLine[0], segmentLine[1], color, lineAppearance);
    else if (definition.kind === "ray") body = svgLine(rayLine[0], rayLine[1], color, lineAppearance);
    else if (definition.kind === "extended") body = svgLine(extendedLine[0], extendedLine[1], color, lineAppearance);
    else if (definition.kind === "horizontal") body = svgLine({ x: 0, y: first.y }, { x: bounds.width, y: first.y }, color, lineAppearance);
    else if (definition.kind === "horizontal-ray") body = svgLine(first, { x: bounds.width, y: first.y }, color, lineAppearance);
    else if (definition.kind === "vertical") body = svgLine({ x: first.x, y: 0 }, { x: first.x, y: bounds.height }, color, lineAppearance);
    else if (definition.kind === "cross") {
      body = svgLine({ x: 0, y: first.y }, { x: bounds.width, y: first.y }, color, { ...lineAppearance, dashed: true })
        + svgLine({ x: first.x, y: 0 }, { x: first.x, y: bounds.height }, color, { ...lineAppearance, dashed: true });
    } else if (definition.kind === "arrow") body = svgLine(segmentLine[0], segmentLine[1], color, { ...lineAppearance, arrow: true, width: drawing.lineWidth ?? DEFAULT_DRAWING_LINE_WIDTH });
    else if (definition.kind === "channel") body = this.renderChannel(first, second, color, lineAppearance);
    else if (definition.kind === "pitchfork") body = this.renderPitchfork(first, second, color, lineAppearance);
    else if (definition.kind === "gann") body = this.renderGann(first, second, color, lineAppearance, drawing.tool);
    else if (definition.kind === "fib") body = this.renderFib(
      first,
      second,
      drawing.points[0]?.price ?? 0,
      drawing.points[drawing.points.length - 1]?.price ?? 0,
      bounds,
      color,
      Boolean(drawing.color),
      lineAppearance,
    );
    else if (definition.kind === "fib-time") body = this.renderTimeZones(first, second, color, bounds.height, lineAppearance);
    else if (definition.kind === "fib-circle") body = this.renderFibCircles(first, second, color, lineAppearance, drawing.tool === "fib-spiral");
    else if (definition.kind === "freehand") {
      body = `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" ${svgStrokeAttributes(lineAppearance, drawing.tool === "highlighter" ? 9 : 2.2)} stroke-linecap="round" stroke-linejoin="round" opacity="${drawing.tool === "highlighter" ? 0.3 : opacity}" />`;
    } else if (definition.kind === "rectangle") {
      body = `<rect x="${Math.min(first.x, second.x)}" y="${Math.min(first.y, second.y)}" width="${Math.abs(dx)}" height="${Math.abs(dy)}" fill="${color}" fill-opacity="0.08" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`
        + (drawing.text
          ? renderTradingDrawingRegionLabel(first, second, drawing.text, color, bounds, drawing.fontSize ?? AI_NOTE_FONT_SIZE)
          : "");
    } else if (definition.kind === "rotated-rectangle") body = this.renderRotatedRectangle(first, second, color, lineAppearance);
    else if (definition.kind === "ellipse") {
      if (definition.id === "circle") {
        const circle = tradingDrawingCircleGeometry(first, second);
        body = `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.radius}" fill="${color}" fill-opacity="0.06" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
      } else {
        const ellipse = tradingDrawingEllipseGeometry(first, second);
        const candlestickPatternClass = tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing)
          ? ' class="trading-price-action-candlestick-pattern-ellipse"'
          : "";
        body = `<ellipse${candlestickPatternClass} cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="${color}" fill-opacity="0.06" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
      }
    } else if (definition.kind === "triangle") {
      const triangle = tradingDrawingTrianglePoints(first, points[1] ?? second, points[2]);
      body = `<polygon points="${pointsAttribute(triangle)}" fill="${color}" fill-opacity="0.06" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
    } else if (definition.kind === "arc") {
      body = `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${Math.min(first.y, second.y) - Math.abs(dx) / 3} ${second.x} ${second.y}" fill="none" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.8)} opacity="${opacity}" />`;
    } else if (definition.kind === "curve") body = this.renderCurve(first, second, color, lineAppearance, drawing.tool === "double-curve");
    else if (definition.kind === "polyline") {
      body = `<polyline points="${pointsAttribute(patternPoints(first, second, 5))}" fill="none" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.8)} stroke-linejoin="round" opacity="${opacity}" />`;
    } else if (definition.kind === "text") body = this.renderText(
      first,
      drawing.text ?? "",
      color,
      drawing,
      lineAppearance,
      bounds,
      second,
      resolvedTextGeometry,
    );
    else if (definition.kind === "marker") body = this.renderMarker(first, definition, color);
    else if (definition.kind === "pattern") body = this.renderPattern(points, definition, color, lineAppearance);
    else if (definition.kind === "position") body = this.renderPosition(first, second, drawing.tool === "long-position", color, Boolean(drawing.color), lineAppearance);
    else if (definition.kind === "range") body = this.renderRange(first, second, definition, color, lineAppearance);
    else if (definition.kind === "projection") body = this.renderProjection(first, second, definition, color, lineAppearance);
    else if (definition.kind === "measure") body = this.renderMeasurement(drawing, first, second, color, lineAppearance);

    const hitTargets = !interactive || draft
      ? ""
      : definition.kind === "text"
        ? this.renderTextHitTargets(points, drawing, bounds)
        : this.renderDrawingHitTargets(definition, points, bounds);
    return `<g data-drawing-id="${escapeHtml(drawing.id)}" data-drawing-source="${drawing.source ?? "manual"}" data-selected="${selected}" data-locked="${Boolean(drawing.locked)}">${body}${hitTargets}${handles}</g>`;
  }

  private renderDrawingHitTargets(
    definition: TradingDrawingToolDefinition,
    points: ScreenPoint[],
    bounds: { width: number; height: number },
  ) {
    const first = points[0];
    const last = points[points.length - 1] ?? first;
    const second = definition.kind === "triangle" ? points[1] ?? last : last;
    const third = definition.kind === "triangle" ? points[2] : undefined;
    if (!first) return "";
    const closedArea = tradingDrawingClosedHitArea(definition, first, second, third);
    if (closedArea) return renderTradingDrawingClosedHitArea(closedArea);
    let segments: Array<[ScreenPoint, ScreenPoint]> = [];
    if (definition.kind === "line" || definition.kind === "arrow") {
      const segment = clipTradingDrawingLine(first, second, bounds, "segment");
      if (segment) segments = [segment];
    } else if (definition.kind === "ray") {
      const segment = clipTradingDrawingLine(first, second, bounds, "ray");
      if (segment) segments = [segment];
    } else if (definition.kind === "extended") {
      const segment = clipTradingDrawingLine(first, second, bounds, "extended");
      if (segment) segments = [segment];
    } else if (definition.kind === "horizontal") {
      segments = [[{ x: 0, y: first.y }, { x: bounds.width, y: first.y }]];
    } else if (definition.kind === "horizontal-ray") {
      segments = [[first, { x: bounds.width, y: first.y }]];
    } else if (definition.kind === "vertical") {
      segments = [[{ x: first.x, y: 0 }, { x: first.x, y: bounds.height }]];
    } else if (definition.kind === "cross") {
      segments = [
        [{ x: 0, y: first.y }, { x: bounds.width, y: first.y }],
        [{ x: first.x, y: 0 }, { x: first.x, y: bounds.height }],
      ];
    } else if (definition.kind === "fib") {
      segments = [
        [first, second],
        ...TRADING_FIBONACCI_LEVELS.map((level): [ScreenPoint, ScreenPoint] => {
          const y = second.y + (first.y - second.y) * level.ratio;
          return [{ x: 0, y }, { x: bounds.width, y }];
        }),
      ];
    } else if (definition.freehand && points.length > 1) {
      segments = points.slice(1).map((point, index) => [points[index], point]);
    } else if (definition.kind === "pattern" && points.length > 1) {
      segments = points.slice(1).map((point, index) => [points[index], point]);
    } else if (points.length > 1) {
      segments = [[first, second]];
    }
    if (!segments.length) {
      return `<circle class="trading-drawing-hit-target point" cx="${first.x}" cy="${first.y}" r="12" />`;
    }
    return segments.map(([start, end]) => `<line class="trading-drawing-hit-target" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`).join("");
  }

  private renderChannel(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance) {
    const offset = perpendicularOffset(first, second, Math.max(20, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.2, 72)));
    const third = { x: first.x + offset.x, y: first.y + offset.y };
    const fourth = { x: second.x + offset.x, y: second.y + offset.y };
    return `<polygon points="${pointsAttribute([first, second, fourth, third])}" fill="${color}" fill-opacity="0.055" />`
      + svgLine(first, second, color, appearance)
      + svgLine(third, fourth, color, appearance)
      + svgLine({ x: (first.x + third.x) / 2, y: (first.y + third.y) / 2 }, { x: (second.x + fourth.x) / 2, y: (second.y + fourth.y) / 2 }, color, { ...appearance, opacity: appearance.opacity * 0.62, dashed: true });
  }

  private renderPitchfork(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance) {
    const offset = perpendicularOffset(first, second, Math.max(24, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.24, 80)));
    return [-1, 0, 1].map((multiple) => svgLine(
      { x: first.x + offset.x * multiple, y: first.y + offset.y * multiple },
      { x: second.x + offset.x * multiple, y: second.y + offset.y * multiple },
      color,
      { ...appearance, opacity: multiple === 0 ? appearance.opacity : appearance.opacity * 0.72, dashed: multiple !== 0 },
    )).join("") + svgLine(
      { x: first.x - offset.x, y: first.y - offset.y },
      { x: first.x + offset.x, y: first.y + offset.y },
      color,
      appearance,
    );
  }

  private renderGann(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, id: TradingDrawingToolId) {
    if (id.includes("fan") || id === "pitchfan" || id === "fib-wedge") {
      return [0, 0.25, 0.5, 0.75, 1].map((ratio) => svgLine(
        first,
        { x: second.x, y: first.y + (second.y - first.y) * ratio },
        color,
        { ...appearance, opacity: ratio === 0.5 ? appearance.opacity : appearance.opacity * 0.55 },
      )).join("");
    }
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    const grid = [0.25, 0.5, 0.75].map((ratio) =>
      svgLine({ x: left, y: top + height * ratio }, { x: left + width, y: top + height * ratio }, color, { ...appearance, opacity: appearance.opacity * 0.42 })
      + svgLine({ x: left + width * ratio, y: top }, { x: left + width * ratio, y: top + height }, color, { ...appearance, opacity: appearance.opacity * 0.42 }),
    ).join("");
    return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.035" stroke="${color}" ${svgStrokeAttributes(appearance, 1.5)} opacity="${appearance.opacity}" />`
      + grid + svgLine(first, second, color, { ...appearance, opacity: appearance.opacity * 0.75 });
  }

  private renderFib(
    first: ScreenPoint,
    second: ScreenPoint,
    firstPrice: number,
    secondPrice: number,
    bounds: { width: number; height: number },
    color: string,
    customColor: boolean,
    appearance: TradingDrawingStrokeAppearance,
  ) {
    const expanded = Math.hypot(second.x - first.x, second.y - first.y)
      >= FIBONACCI_EXPANSION_THRESHOLD;
    const levels = tradingFibonacciLevelPrices(firstPrice, secondPrice);
    const visibleLevels = expanded ? levels : levels.slice(0, 1);
    const connectorColor = customColor ? color : "var(--trading-fibonacci-connector)";
    const connector = expanded
      ? `<line class="trading-fibonacci-connector" x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" stroke="${connectorColor}" ${svgStrokeAttributes({ ...appearance, dashed: true }, 1.5)} opacity="${appearance.opacity}" />`
      : "";
    return connector + visibleLevels.map((level) => {
      const y = second.y + (first.y - second.y) * level.ratio;
      const labelY = y < 16 ? y + 14 : y - 6;
      const label = `${level.label}(${formatTradingFibonacciPrice(level.price)})`;
      const levelColor = customColor ? color : level.color;
      return `<g class="trading-fibonacci-level" data-fibonacci-level="${level.label}">`
        + `<line class="trading-fibonacci-level-line" x1="0" y1="${y}" x2="${bounds.width}" y2="${y}" stroke="${levelColor}" ${svgStrokeAttributes(appearance, 1.25)} opacity="${appearance.opacity}" />`
        + `<text class="trading-fibonacci-label" x="6" y="${labelY}" fill="${levelColor}" opacity="${appearance.opacity}">${label}</text>`
        + "</g>";
    }).join("");
  }

  private renderTimeZones(first: ScreenPoint, second: ScreenPoint, color: string, height: number, appearance: TradingDrawingStrokeAppearance) {
    const step = Math.max(Math.abs(second.x - first.x), 8);
    const fib = [0, 1, 2, 3, 5, 8, 13, 21];
    return fib.map((factor) => {
      const x = first.x + Math.sign(second.x - first.x || 1) * step * factor;
      return svgLine({ x, y: 0 }, { x, y: height }, color, { ...appearance, opacity: factor <= 1 ? appearance.opacity : appearance.opacity * 0.45, dashed: factor > 1 });
    }).join("");
  }

  private renderFibCircles(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, spiral: boolean) {
    const radius = Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1);
    if (spiral) {
      const points = Array.from({ length: 80 }, (_, index) => {
        const angle = index * 0.24;
        const currentRadius = (radius * index) / 80;
        return { x: first.x + Math.cos(angle) * currentRadius, y: first.y + Math.sin(angle) * currentRadius };
      });
      return `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.5)} opacity="${appearance.opacity}" />`;
    }
    return [0.236, 0.382, 0.5, 0.618, 1].map((ratio) => `<circle cx="${first.x}" cy="${first.y}" r="${radius * ratio}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.2)} opacity="${appearance.opacity * (0.45 + ratio * 0.45)}" />`).join("");
  }

  private renderRotatedRectangle(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance) {
    const offset = perpendicularOffset(first, second, Math.max(16, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.18, 50)));
    const points = [
      { x: first.x - offset.x, y: first.y - offset.y },
      { x: second.x - offset.x, y: second.y - offset.y },
      { x: second.x + offset.x, y: second.y + offset.y },
      { x: first.x + offset.x, y: first.y + offset.y },
    ];
    return `<polygon points="${pointsAttribute(points)}" fill="${color}" fill-opacity="0.06" stroke="${color}" ${svgStrokeAttributes(appearance, 1.6)} opacity="${appearance.opacity}" />`;
  }

  private renderCurve(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, double: boolean) {
    const controlY = Math.min(first.y, second.y) - Math.max(Math.abs(second.x - first.x) * 0.28, 18);
    const path = `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${controlY} ${second.x} ${second.y}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.8)} opacity="${appearance.opacity}" />`;
    return double
      ? path + `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${Math.max(first.y, second.y) + Math.abs(second.x - first.x) * 0.28} ${second.x} ${second.y}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.4)} opacity="${appearance.opacity * 0.65}" />`
      : path;
  }

  private renderText(
    point: ScreenPoint,
    text: string,
    color: string,
    drawing: TradingDrawingModel,
    appearance: TradingDrawingStrokeAppearance,
    bounds: { width: number; height: number },
    labelPoint: ScreenPoint = point,
    resolvedTextGeometry?: ReturnType<typeof tradingDrawingNoteBoxGeometry>,
  ) {
    if (!text) return "";
    const toolId = drawing.tool;
    const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const boxed = toolId !== "text" && toolId !== "anchored-text";
    const noteGeometry = (toolId === "note" || toolId === "callout")
      ? resolvedTextGeometry ?? tradingDrawingNoteBoxGeometry(point, text, fontSize, bounds)
      : null;
    const textBox = noteGeometry ?? (boxed ? tradingDrawingTextBoxLayout(text, fontSize, bounds) : null);
    const layout = textBox?.layout ?? tradingDrawingTextLayout(text, fontSize);
    const textLines = (x: number, firstBaseline: number) => layout.lines.map((line, index) => (
      `<tspan x="${x}" y="${firstBaseline + index * layout.lineHeight}"${line ? ` textLength="${layout.lineWidths[index]}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeHtml(line)}</tspan>`
    )).join("");
    const fontWeight = drawing.bold ? 700 : 400;
    if (toolId === "text" || toolId === "anchored-text") {
      const isPriceActionCandlestickPatternLabel = tradingDrawingIsPriceActionCandlestickPatternLabel(drawing);
      const inlinePoint = isPriceActionCandlestickPatternLabel && resolvedTextGeometry
        ? {
            x: resolvedTextGeometry.boxLeft + resolvedTextGeometry.boxWidth / 2,
            y: resolvedTextGeometry.boxTop + fontSize,
          }
        : point;
      const backgroundPoint = isPriceActionCandlestickPatternLabel
        ? { x: inlinePoint.x - layout.width / 2, y: inlinePoint.y }
        : inlinePoint;
      const background = drawing.textBackgroundColor
        ? `<rect x="${backgroundPoint.x - 5}" y="${backgroundPoint.y - fontSize - 4}" width="${layout.width + 10}" height="${layout.height + 8}" rx="2" fill="${drawing.textBackgroundColor}" />`
        : "";
      const inlineLabelClass = drawing.source === "ai"
        ? ` class="trading-ai-inline-label${isPriceActionCandlestickPatternLabel ? " trading-price-action-candlestick-label" : ""}"`
        : "";
      const candlestickLeader = isPriceActionCandlestickPatternLabel && resolvedTextGeometry
        ? `<line class="trading-price-action-candlestick-label-leader" x1="${point.x}" y1="${point.y}" x2="${resolvedTextGeometry.connectorPoint.x}" y2="${resolvedTextGeometry.connectorPoint.y}" />`
          + `<circle class="trading-price-action-candlestick-label-target" cx="${point.x}" cy="${point.y}" r="2.2" />`
        : "";
      return `${candlestickLeader}${background}<text${inlineLabelClass} fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}">${textLines(inlinePoint.x, inlinePoint.y)}</text>`;
    }
    const background = drawing.textBackgroundColor ?? "transparent";
    if (toolId === "price-note") {
      const geometry = tradingDrawingPriceNoteBoxGeometry(labelPoint, text, fontSize, bounds);
      return `<g class="trading-price-note">`
        + svgLine(point, labelPoint, color, appearance)
        + `<path d="M ${labelPoint.x} ${labelPoint.y} L ${geometry.boxLeft} ${geometry.boxTop + 6} L ${geometry.boxLeft} ${geometry.boxTop + geometry.boxHeight - 6} Z" fill="${background}" stroke="${color}" ${svgStrokeAttributes(appearance, 1.4)} />`
        + `<rect x="${geometry.boxLeft}" y="${geometry.boxTop}" width="${geometry.boxWidth}" height="${geometry.boxHeight}" rx="4" fill="${background}" stroke="${color}" ${svgStrokeAttributes(appearance, 1.4)} />`
        + `<text fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}">${textLines(geometry.boxLeft + TRADING_TEXT_BOX_PADDING_X, geometry.boxTop + fontSize + 2)}</text>`
        + `</g>`;
    }
    const geometry = noteGeometry ?? tradingDrawingNoteBoxGeometry(point, text, fontSize, bounds);
    return `<g class="trading-note">`
      + svgLine(point, geometry.textStartPoint, color, {
        ...appearance,
        style: drawing.source === "ai" ? "dashed" : appearance.style,
        width: drawing.source === "ai" ? 1.2 : appearance.width,
      })
      + `<circle class="trading-note-anchor" cx="${point.x}" cy="${point.y}" r="2.4" fill="${color}" />`
      + `<text fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}">${textLines(geometry.boxLeft, geometry.boxTop + fontSize)}</text>`
      + `</g>`;
  }

  private renderTextHitTargets(
    points: ScreenPoint[],
    drawing: TradingDrawingModel,
    bounds: { width: number; height: number },
  ) {
    const point = points[0];
    if (!point) return "";
    const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const text = drawing.text ?? "";
    if (drawing.tool === "price-note") {
      const labelPoint = points[points.length - 1] ?? point;
      const geometry = tradingDrawingPriceNoteBoxGeometry(labelPoint, text, fontSize, bounds);
      return `<line class="trading-drawing-hit-target" x1="${point.x}" y1="${point.y}" x2="${labelPoint.x}" y2="${labelPoint.y}" />`
        + `<rect class="trading-drawing-hit-target area" x="${geometry.boxLeft - 4}" y="${geometry.boxTop - 4}" width="${geometry.boxWidth + 8}" height="${geometry.boxHeight + 8}" />`;
    }
    if (drawing.tool === "note" || drawing.tool === "callout") {
      const geometry = tradingDrawingNoteBoxGeometry(point, text, fontSize, bounds);
      return `<rect class="trading-drawing-hit-target area" x="${geometry.boxLeft - 5}" y="${geometry.boxTop - 5}" width="${geometry.boxWidth + 10}" height="${geometry.boxHeight + 10}" />`;
    }
    const layout = tradingDrawingTextLayout(text, fontSize);
    return `<rect class="trading-drawing-hit-target area" x="${point.x - 7}" y="${point.y - fontSize - 6}" width="${layout.width + 14}" height="${layout.height + 12}" />`;
  }

  private renderAiTextSizeHitTarget(
    drawing: TradingDrawingModel,
    bounds: { width: number; height: number },
    resolvedTextGeometry?: ReturnType<typeof tradingDrawingNoteBoxGeometry>,
  ) {
    if (tradingDrawingToolDefinition(drawing.tool)?.kind !== "text" || !drawing.text) return "";
    this.ensureAnchoredViewportAnchor(drawing);
    const points = drawing.points
      .map((_point, index) => this.drawingPointToScreen(drawing, index, bounds))
      .filter((point): point is ScreenPoint => Boolean(point));
    const point = points[0];
    if (!point) return "";
    const fontSize = drawing.fontSize ?? (drawing.tool === "note" ? AI_NOTE_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
    let box: TradingDrawingCollisionRect;
    if (drawing.tool === "price-note") {
      const labelPoint = points.at(-1) ?? point;
      const geometry = tradingDrawingPriceNoteBoxGeometry(labelPoint, drawing.text, fontSize, bounds);
      box = {
        x: geometry.boxLeft - 5,
        y: geometry.boxTop - 5,
        width: geometry.boxWidth + 10,
        height: geometry.boxHeight + 10,
      };
    } else if (drawing.tool === "note" || drawing.tool === "callout") {
      const geometry = resolvedTextGeometry
        ?? tradingDrawingNoteBoxGeometry(point, drawing.text, fontSize, bounds);
      box = {
        x: geometry.boxLeft - 6,
        y: geometry.boxTop - 6,
        width: geometry.boxWidth + 12,
        height: geometry.boxHeight + 12,
      };
    } else if (tradingDrawingIsPriceActionCandlestickPatternLabel(drawing) && resolvedTextGeometry) {
      box = {
        x: resolvedTextGeometry.boxLeft - 6,
        y: resolvedTextGeometry.boxTop - 6,
        width: resolvedTextGeometry.boxWidth + 12,
        height: resolvedTextGeometry.boxHeight + 12,
      };
    } else {
      const layout = tradingDrawingTextLayout(drawing.text, fontSize);
      box = {
        x: point.x - 7,
        y: point.y - fontSize - 6,
        width: layout.width + 14,
        height: layout.height + 12,
      };
    }
    const label = drawing.text.replace(/\s+/g, " ").trim().slice(0, 48);
    return `<g class="trading-ai-text-size-trigger" data-i18n-skip data-ai-text-size-trigger="${escapeHtml(drawing.id)}" tabindex="0" role="group" aria-label="${escapeHtml(translateAppText(`AI 标注：${label}；当前字号 ${fontSize}px`))}">`
      + `<rect class="trading-ai-text-size-hit-target" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" />`
      + `</g>`;
  }

  private updateAiTextSizeToolbar(bounds: { width: number; height: number }) {
    if (
      !this.userDrawingEnabled
      || this.drawingsHidden
      || tradingDrawingToolDefinition(this.activeTool)?.kind !== "cursor"
    ) {
      this.hideAiTextSizeToolbar();
      return;
    }
    const target = this.topmostAiTextSizeTarget();
    if (!target) {
      this.hideAiTextSizeToolbar();
      return;
    }
    const { drawing, bounds: textBounds } = target;
    // Keep the existing drawing id as an action anchor (keyboard shortcuts and
    // toolbar clicks reuse the same all-label adjustment path), while the
    // initial visual position is derived from the topmost visible annotation.
    this.hoveredAiTextDrawingId = drawing.id;
    const { x, y, width, height } = textBounds;
    const current = drawing.fontSize ?? (drawing.tool === "note" ? AI_NOTE_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
    const textDrawings = this.aiTextDrawingsForCurrentContext();
    if (!this.aiTextSizeToolbarVisibility.setAvailable(true)) return;
    this.aiTextSizeToolbar.setAttribute("aria-label", `当前图表全部 AI 标注字号，所在标注当前 ${current}px`);
    this.aiTextSizeToolbar.querySelectorAll<HTMLButtonElement>(
      '[data-ai-text-size-action="decrease"], [data-ai-text-size-action="increase"]',
    ).forEach((button) => {
      const action = button.dataset.aiTextSizeAction as "decrease" | "increase";
      const disabled = textDrawings.every((textDrawing) => {
        const fontSize = textDrawing.fontSize
          ?? (textDrawing.tool === "note" ? AI_NOTE_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
        return tradingAiTextNextFontSize(fontSize, action) === fontSize;
      });
      const verb = action === "decrease" ? "缩小" : "放大";
      button.disabled = disabled;
      button.setAttribute("aria-label", `${verb}当前图表全部标注文字`);
      button.title = `${verb}当前图表全部标注文字`;
    });
    const toolbarSize = {
      width: this.aiTextSizeToolbar.offsetWidth || 66,
      height: this.aiTextSizeToolbar.offsetHeight || 34,
    };
    const preferredPosition = this.aiTextSizeToolbarPosition ?? this.aiTextSizeToolbarDrag?.startPosition;
    const position = clampTradingChartToolbarPosition(preferredPosition ?? positionTradingAiTextSizeToolbar(
      { x, y, width, height },
      bounds,
      toolbarSize,
      "left",
    ), bounds, toolbarSize);
    if (this.aiTextSizeToolbarPosition) this.aiTextSizeToolbarPosition = position;
    this.aiTextSizeToolbar.style.left = `${position.x}px`;
    this.aiTextSizeToolbar.style.top = `${position.y}px`;
  }

  private renderMarker(point: ScreenPoint, definition: TradingDrawingToolDefinition, color: string) {
    const glyph: Partial<Record<TradingDrawingToolId, string>> = {
      signpost: "◆",
      comment: "●",
      "arrow-marker": "➤",
      "arrow-up": "▲",
      "arrow-down": "▼",
      flag: "⚑",
    };
    return `<text x="${point.x}" y="${point.y}" fill="${color}" font-size="20" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="var(--trading-market-panel)" stroke-width="3">${glyph[definition.id] ?? "●"}</text>`;
  }

  private renderPattern(points: ScreenPoint[], definition: TradingDrawingToolDefinition, color: string, appearance: TradingDrawingStrokeAppearance) {
    const labels: Partial<Record<TradingDrawingToolId, string[]>> = {
      xabcd: ["X", "A", "B", "C", "D"],
      cypher: ["X", "A", "B", "C", "D"],
      abcd: ["A", "B", "C", "D"],
      "triangle-pattern": ["A", "B", "C", "D"],
      "elliott-impulse": ["0", "1", "2", "3", "4", "5"],
      "elliott-correction": ["0", "A", "B", "C"],
      "elliott-triangle": ["0", "A", "B", "C", "D", "E"],
    };
    const pointLabels = labels[definition.id]
      ?? Array.from({ length: points.length }, (_, index) => String(index + 1));
    const line = points.length > 1
      ? `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.8)} stroke-linejoin="round" opacity="${appearance.opacity}" />`
      : "";
    return line
      + points.map((point, index) => `<g><circle cx="${point.x}" cy="${point.y}" r="3" fill="${color}"/><text x="${point.x}" y="${point.y - 7}" fill="${color}" font-size="9" text-anchor="middle">${pointLabels[index] ?? index + 1}</text></g>`).join("");
  }

  private renderPosition(
    first: ScreenPoint,
    second: ScreenPoint,
    long: boolean,
    color: string,
    customColor: boolean,
    appearance: TradingDrawingStrokeAppearance,
  ) {
    const left = Math.min(first.x, second.x);
    const width = Math.max(Math.abs(second.x - first.x), 2);
    const middle = first.y;
    const top = Math.min(first.y, second.y);
    const bottom = Math.max(first.y, second.y);
    const profitColor = "#22ab94";
    const lossColor = "#f23645";
    const upperColor = long ? profitColor : lossColor;
    const lowerColor = long ? lossColor : profitColor;
    const upperStroke = customColor ? color : upperColor;
    const lowerStroke = customColor ? color : lowerColor;
    return `<rect x="${left}" y="${top}" width="${width}" height="${Math.max(middle - top, 1)}" fill="${upperColor}" fill-opacity="0.18" stroke="${upperStroke}" ${svgStrokeAttributes(appearance)} opacity="${appearance.opacity}" />`
      + `<rect x="${left}" y="${middle}" width="${width}" height="${Math.max(bottom - middle, 1)}" fill="${lowerColor}" fill-opacity="0.18" stroke="${lowerStroke}" ${svgStrokeAttributes(appearance)} opacity="${appearance.opacity}" />`
      + `<text x="${left + 5}" y="${top + 14}" fill="${upperStroke}" font-size="10" font-weight="600">${long ? "目标" : "止损"}</text>`
      + `<text x="${left + 5}" y="${bottom - 5}" fill="${lowerStroke}" font-size="10" font-weight="600">${long ? "止损" : "目标"}</text>`;
  }

  private renderRange(first: ScreenPoint, second: ScreenPoint, definition: TradingDrawingToolDefinition, color: string, appearance: TradingDrawingStrokeAppearance) {
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    if (definition.id === "fixed-range-volume") {
      const bars = [0.25, 0.56, 0.8, 0.42, 0.66, 0.34, 0.9, 0.52];
      return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.025" stroke="${color}" ${svgStrokeAttributes({ ...appearance, dashed: true }, 1.4)} opacity="${appearance.opacity}"/>`
        + bars.map((value, index) => `<rect x="${left}" y="${top + (height * index) / bars.length}" width="${width * value}" height="${Math.max(height / bars.length - 1, 1)}" fill="${color}" fill-opacity="0.22" />`).join("");
    }
    return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.06" stroke="${color}" ${svgStrokeAttributes({ ...appearance, dashed: true }, 1.4)} opacity="${appearance.opacity}" />`;
  }

  private renderProjection(first: ScreenPoint, second: ScreenPoint, definition: TradingDrawingToolDefinition, color: string, appearance: TradingDrawingStrokeAppearance) {
    const points = patternPoints(first, second, definition.id === "bars-pattern" ? 9 : 6);
    const fallbackDash = definition.id === "ghost-feed" ? "4 5" : "7 4";
    const customDash = tradingDrawingStrokeDashArray(appearance.style);
    return `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" stroke-width="${appearance.width ?? 2}" stroke-dasharray="${appearance.style ? customDash : fallbackDash}" marker-end="url(#trading-drawing-arrow)" opacity="${appearance.opacity}" vector-effect="non-scaling-stroke" />`;
  }

  private renderMeasurement(drawing: TradingDrawingModel, first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance) {
    const firstPoint = drawing.points[0];
    const secondPoint = drawing.points[drawing.points.length - 1];
    const measurement = measureTradingDrawing(firstPoint, secondPoint);
    const label = `${measurement.priceChange >= 0 ? "+" : ""}${measurement.priceChange.toFixed(2)} (${measurement.percentChange.toFixed(2)}%) · ${formatDuration(measurement.seconds)}`;
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y) - 8;
    return svgLine(first, second, color, { ...appearance, dashed: true, arrow: true })
      + `<rect x="${x}" y="${y - 19}" width="${Math.max(label.length * 6.4 + 14, 122)}" height="22" rx="4" fill="${color}" opacity="${appearance.opacity * 0.94}" />`
      + `<text x="${x + 7}" y="${y - 5}" fill="#fff" font-size="10" font-weight="600">${escapeHtml(label)}</text>`;
  }

  destroy() {
    this.aiTextSizeToolbarVisibility.destroy();
    if (this.destroyed) return;
    this.destroyed = true;
    this.discardPendingTextDrawing();
    this.leaveManualDrawingSession();
    this.aiPlayback.cancel();
    this.hideAiTextSizeToolbar();
    if (this.clearDialog.open && (this.bindControlEvents || this.clearDialogTrigger)) this.clearDialog.close();
    this.releasePointer();
    this.finishSelectionToolbarDrag();
    if (this.bindControlEvents) {
      this.toolbar.removeEventListener("click", this.handleToolbarClick);
      this.clearDialog.removeEventListener("click", this.handleClearDialogClick);
      this.clearDialog.removeEventListener("cancel", this.handleClearDialogCancel);
      this.clearDialog.removeEventListener("close", this.handleClearDialogClose);
    }
    this.selectionToolbar.removeEventListener("click", this.handleSelectionToolbarClick);
    this.selectionToolbar.removeEventListener("pointerdown", this.handleSelectionToolbarPointerDown);
    this.selectionToolbar.removeEventListener("pointermove", this.handleSelectionToolbarPointerMove);
    this.selectionToolbar.removeEventListener("pointerup", this.handleSelectionToolbarPointerUp);
    this.selectionToolbar.removeEventListener("pointercancel", this.handleSelectionToolbarPointerCancel);
    this.selectionToolbar.removeEventListener("lostpointercapture", this.handleSelectionToolbarPointerCancel);
    this.aiTextHitContent.removeEventListener("pointerover", this.handleAiTextPointerOver);
    this.aiTextHitContent.removeEventListener("pointerout", this.handleAiTextPointerOut);
    this.aiTextHitContent.removeEventListener("focusin", this.handleAiTextFocusIn);
    this.aiTextHitContent.removeEventListener("focusout", this.handleAiTextFocusOut);
    this.aiTextHitContent.removeEventListener("keydown", this.handleAiTextTriggerKeyDown);
    this.aiTextSizeToolbar.removeEventListener("click", this.handleAiTextSizeToolbarClick);
    this.aiTextSizeToolbar.removeEventListener("pointerdown", this.handleAiTextSizeToolbarPointerDown);
    document.removeEventListener("pointermove", this.handleAiTextSizeToolbarPointerMove);
    document.removeEventListener("pointerup", this.handleAiTextSizeToolbarPointerUp);
    document.removeEventListener("pointercancel", this.handleAiTextSizeToolbarPointerCancel);
    this.aiTextSizeToolbar.removeEventListener("lostpointercapture", this.handleAiTextSizeToolbarPointerCancel);
    window.removeEventListener("blur", this.finishAiTextSizeToolbarDrag);
    this.chartElement.removeEventListener("trading-navigation-tool-change", this.handleNavigationToolChange);
    this.chartElement.removeEventListener("pointerdown", this.handleSurfacePointerDown, { capture: true });
    this.orderLineContent.removeEventListener("pointerover", this.handleOrderPositionPointerOver);
    this.orderLineContent.removeEventListener("pointerout", this.handleOrderPositionPointerOut);
    this.orderLineContent.removeEventListener("focusin", this.handleOrderPositionFocusIn);
    this.orderLineContent.removeEventListener("focusout", this.handleOrderPositionFocusOut);
    this.overlay.removeEventListener("pointerdown", this.handlePointerDown);
    this.overlay.removeEventListener("contextmenu", this.handleContextMenu);
    this.overlay.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerUp);
    document.removeEventListener("pointercancel", this.handlePointerCancel);
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown);
    document.removeEventListener("keydown", this.handleKeyDown);
  }
}

function distanceToSegment(point: ScreenPoint, first: ScreenPoint, second: ScreenPoint) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (!dx && !dy) return Math.hypot(point.x - first.x, point.y - first.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (first.x + ratio * dx), point.y - (first.y + ratio * dy));
}
