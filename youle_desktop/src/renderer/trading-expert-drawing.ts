import { fibonacciWedgeEndpoint } from './trading-fibonacci-radial.ts';
import { tradingPriceAxisLabelGeometry } from './trading-price-axis.ts';
import { deferInteractionRender } from "./interaction-render-guard.ts";
import { rotatedRectangleGeometry, rotatedRectangleWidthPoint, moveRotatedRectangleHandle } from './trading-rotated-rectangle.ts';
import { isPositionDrawing, isPredictionDrawing, positionAnchors, movePositionAnchor, normalizePositionOptions, renderPositionDrawing, renderForecastDrawing, type PositionOptions } from './trading-position-tools.ts';
import { isPredictionShape, normalizeBarsSnapshot, nearestPatternBar, patternPreviewPoint, captureBarsPattern, sectorEndpoint, renderPredictionShape, type BarsPatternSnapshot } from './trading-prediction-shapes.ts';
import { openColorPicker, closeColorPicker, colorPickerContainsTarget } from './color-picker.ts';
import { readTradingMagnetPreferences, writeTradingMagnetPreferences, snapTradingDrawingMagnet, type TradingMagnetMode, type TradingMagnetSeries } from './trading-drawing-magnet.ts';
import { zoomTradingChart, type TradingChartNavigation } from "./trading-chart-navigation.ts";
import { DesktopDrawingSync, drawingSyncText } from './manual-drawing-sync.ts';
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
  tradingPlanPriceLineObstacles,
  renderTradingOrderLineSvg,
  renderTradingOrderPositionCards,
  type TradingOrderLine,
} from "./trading-expert-order-lines.ts";
import { buildTradingPlanPriceLines } from './trading-plan-price-lines.ts';
import { TradingAiPlanAutoscale, tradingAiPlanFitRange } from './trading-ai-plan-autoscale.ts';
import { tradingAnalysisPlanFocusRange, tradingAnalysisVisibleTimeRange } from './trading-analysis-viewport.mjs';
import { normalizePlanLevel, type PlanLevel } from '../shared/execution-plan-drawings.mjs';
import { PLAN_DRAWING_HISTORY_CHANGED, projectStoredTradingPlanDrawings } from './trading-plan-drawing-history.ts';
import { tradingDrawingLabelObstacles } from './trading-drawing-label-obstacles.ts';
import { translateAppText, translateDrawingText, translateTradingAnnotationText, type AppLanguage } from "./app-language.mjs";
import { DRAWING_MENU_SECTIONS, DRAWING_SHORTCUTS, DRAWING_SYMBOLS, renderDrawingIcon as drawingIcon, drawingMenuGroup } from './trading-drawing-catalog.ts';
import { renderExtraDrawingGeometry, renderExtraAnnotation, drawingImageUrl, type DrawingCandle } from './trading-drawing-extra-tools.ts';
import { DrawingImageDialog, type DrawingImageSelection } from './trading-drawing-image-dialog.ts';
import { TradingXPostDialog, readTradingXPost } from './trading-x-post.ts';
import { normalizeXPostUrl } from '../shared/trading-x-post.mjs';
import { isRangeDrawing, rangeFillColor, rangeMeasurement, renderRangeDrawing } from './trading-range-tools.ts';
import { isVolumeDrawing, isVolumeProfile, volumeProfilePoints, calculateFixedVolume, volumeBarIndex, vwapSourcePrice, volumeDrawingAnchors, calculateAnchoredVwap, normalizeAnchoredVwapOptions, normalizeFixedVolumeOptions, renderAnchoredVwap, renderFixedVolume, type AnchoredVwapOptions, type FixedVolumeOptions } from './trading-volume-drawings.ts';
import { VolumeProfileHistory, volumeBarEnd, volumeProfileResolution, volumeResolutionSeconds, type VolumeHistoryLoader } from './trading-volume-history.ts';
import { isCycleDrawing, cycleAnchorPoints, moveCycleAnchor, cycleFillColor, renderCycleDrawing, cycleHitDistance } from './trading-cycle-tools.ts';
import { manualDrawingDefaults, manualFibLevelColor, DRAWING_SELECTION_COLOR, type ManualDrawingDefaults } from './trading-drawing-defaults.ts';
import { TradingDrawingLayer } from './trading-drawing-layer.ts';
import { TradingDrawingHoverText } from './trading-drawing-hover-text.ts';
import { TradingAiAnnotationHover } from './trading-ai-annotation-hover.ts';
import { isPlainTextDrawing, isManualNote, isManualPriceNote, isPinNote, isCallout, isComment, isSignpost, isAnnotationTable, isInlineAnnotation, annotationTextGeometry, annotationPrice, priceLabelGeometry, calloutPath, PLAIN_TEXT_FONT_SIZE, PLAIN_TEXT_COLOR, PLAIN_TEXT_FONT_FAMILY } from './trading-plain-text.ts';
import { annotationTableCells, annotationTableGeometry, annotationTableCellAt, updateAnnotationTableCell, type TableCell } from './trading-annotation-table.ts';
import { TradingDrawingCrosshair } from './trading-drawing-crosshair.ts';
import { TradingDrawingVisibility, TRADING_VISIBILITY_LAYERS } from './trading-drawing-visibility.ts';
import { TradingAiDrawingSets } from './trading-ai-drawing-sets.ts';
import { tradingInfoLineRows, renderTradingInfoLineCard } from './trading-info-line.ts';
import { renderTradingTrendAngleAnnotation } from './trading-trend-angle.ts';
import { isTradingPitchfork, renderTradingPitchfork } from './trading-pitchfork.ts';
import { isReferencePatternDrawing, renderReferencePattern, harmonicFillColor, HARMONIC_BLUE } from './trading-patterns.ts';
import { usesNativeAiDrawingStyle, nativeAiDrawingDefaults, nativeAiDrawingDisplayModel, isHiddenOrderFlowAnnotation, isHiddenAiArrowDrawing, renderNativeAiHarmonicPath } from './trading-ai-native-style.ts';
import { projectAiFibonacciDrawings, renderAiFibonacci } from './trading-ai-fibonacci.ts';
import { chartPatternNativeDrawingModel } from './chart-pattern-native-tools.ts';
import { isElliottWave, renderElliottWave, ELLIOTT_FONT_SIZE, ELLIOTT_HANDLE_COLOR } from './trading-elliott-wave.ts';
import { captureTradingChartToDesktop } from './trading-chart-screenshot.ts';
import { calculateRegressionTrend, normalizeRegressionTrendOptions, regressionBarIndex, renderRegressionTrend, type RegressionTrendOptions } from './trading-regression-trend.ts';
import { HorizontalLineSettingsDialog, horizontalLineSettingsIcon, normalizeHorizontalLineTextStyle, type HorizontalLineTextStyle } from './trading-horizontal-line-settings.ts';
import { normalizeFibonacciOptions, fibonacciOptionsForDrawing, fibonacciVisibleAtInterval, renderFibonacci, type FibonacciOptions } from './trading-fibonacci.ts';
import { isThreePointFibonacci, isFibonacciProjection, renderFibonacciProjection } from './trading-fibonacci-projections.ts';

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
const DEFAULT_DRAWING_LINE_WIDTH = 1;
const DRAWING_HANDLE_RADIUS = 5;
const FIBONACCI_HANDLE_RADIUS = 7;
const FIBONACCI_EXPANSION_THRESHOLD = 3;

// Shared toolbar elements can be owned by different chart controllers. Cache
// per element so switching the active chart cannot reuse another chart's state.
const drawingMarkup = new WeakMap<Element, string>();
const drawingToolbarState = new WeakMap<HTMLElement, string>();
export function updateTradingDrawingMarkup(element: Element, markup: string) {
  // Freeze interactive controls only; live geometry must still follow a drag.
  if (element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && (element.matches("button") || element.querySelector("button"))
    && deferInteractionRender(element, () => updateTradingDrawingMarkup(element, markup))) return;
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

export const TRADING_FIBONACCI_LEVELS = [4.236, 3.618, 2.618, 1.618, 1, 0.786, 0.618, 0.5, 0.382, 0.236, 0]
  .map((ratio) => ({ ratio, label: String(ratio), color: manualFibLevelColor(ratio) }));

export function tradingFibonacciLevelPrices(firstPrice: number, secondPrice: number) {
  return TRADING_FIBONACCI_LEVELS.map((level) => ({
    ...level,
    price: secondPrice + (firstPrice - secondPrice) * level.ratio,
  }));
}

export function formatTradingFibonacciPrice(value: number, useGrouping = false) {
  if (!Number.isFinite(value)) return "--";
  const absolute = Math.abs(value);
  const precision = absolute >= 1_000 ? 2 : absolute >= 1 ? 3 : absolute >= 0.01 ? 4 : 6;
  return useGrouping
    ? value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision })
    : value.toFixed(precision);
}

export type TradingDrawingLineStyle = "solid" | "dashed" | "dotted";

export interface TradingDrawingStyle extends HorizontalLineTextStyle {
  imageOpacity?: number;
  vwap?: AnchoredVwapOptions;
  volumeProfile?: FixedVolumeOptions;
  position?: PositionOptions;
  fibonacci?: FibonacciOptions;
  regression?: RegressionTrendOptions;
  color?: string;
  textBackgroundColor?: string;
  fontSize?: number;
  bold?: boolean;
  lineStyle?: TradingDrawingLineStyle;
  lineWidth?: number;
}


export type TradingDrawingToolId =
  | "magic" | "multi-point-path" | "multi-point-polyline"
  | "dot" | "demonstration"
  | "fib-trend-time" | "fib-speed-arcs" | "gann-square-fixed"
  | "elliott-double-combo" | "elliott-triple-combo" | "time-cycles" | "sine-line"
  | "anchored-vwap" | "anchored-volume-profile" | "sector"
  | "anchored-note" | "pin-note" | "table" | "price-label" | "image" | "tweet" | "idea"
  | "arrow-left" | "arrow-right" | "emoji" | "sticker" | "icon"
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
  "elliott-double-combo": 4,
  "elliott-triple-combo": 6,
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
  if (definition.id === 'ghost-feed') return 6;
  if (definition.freehand || tradingDrawingIsMultiPoint(definition.id)) return 0;
  if (isTradingPitchfork(definition.id)) return 3;
  if (isThreePointFibonacci(definition.id)) return 3;
  if (definition.id === "sector" || definition.id === "parallel-channel" || definition.id === 'rotated-rectangle' || tradingDrawingIsShapedChannel(definition.id)) return 3;
  if (["anchored-vwap", "anchored-volume-profile", "price-label"].includes(definition.id)) return 1;
  const patternPointCount = TRADING_PATTERN_POINT_COUNTS[definition.id];
  if (patternPointCount) return patternPointCount;
  if (definition.id === "price-note" || definition.id === "note" || definition.id === "callout" || definition.id === "arrow-marker") return 2;
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
  if (tradingDrawingIsMultiPoint(definition.id)) return "multi-click";
  const requiredPointCount = tradingDrawingRequiredPointCount(definition);
  if (requiredPointCount === 1) return "single-click";
  if (requiredPointCount === 2) return "two-click";
  if (requiredPointCount === 3) return "three-click";
  return "multi-click";
}

export function tradingDrawingIsMultiPoint(id: string) {
  return id === 'multi-point-path' || id === 'multi-point-polyline';
}

export function tradingDrawingIsClosedPolyline(drawing: Pick<TradingDrawingModel, 'tool' | 'points'>) {
  const first = drawing.points[0], last = drawing.points.at(-1);
  return drawing.tool === 'multi-point-polyline' && drawing.points.length > 3
    && first.time === last?.time && first.price === last?.price;
}

export type TradingDrawingGroupId =
  | "icons"
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
  tool("cursor", "箭头", "cursor", "cursor", "cursor"),
  tool("crosshair", "十字线", "cursor", "cursor", "crosshair"),
  tool("eraser", "橡皮擦", "cursor", "eraser", "eraser"),

  tool("trend-line", "趋势线", "trend", "line", "trend"),
  tool("ray", "射线", "trend", "ray", "ray"),
  tool("extended-line", "延长线", "trend", "extended", "extended"),
  tool("info-line", "信息线", "trend", "measure", "info-line"),
  tool("trend-angle", "趋势角度", "trend", "measure", "angle"),
  tool("horizontal-line", "水平线", "trend", "horizontal", "horizontal"),
  tool("horizontal-ray", "水平射线", "trend", "horizontal-ray", "horizontal-ray"),
  tool("vertical-line", "垂直线", "trend", "vertical", "vertical"),
  tool("cross-line", "横线", "trend", "cross", "cross-line"),
  tool("arrow", "箭头", "trend", "arrow", "arrow"),

  tool("parallel-channel", "平行通道", "channel", "channel", "channel"),
  tool("regression-trend", "回归趋势", "channel", "channel", "regression"),
  tool("flat-top-bottom", "平顶/平底", "channel", "channel", "flat-channel"),
  tool("disjoint-channel", "不相交通道", "channel", "channel", "disjoint-channel"),
  tool("pitchfork", "分叉线", "channel", "pitchfork", "pitchfork"),
  tool("schiff-pitchfork", "希夫干草叉", "channel", "pitchfork", "schiff"),
  tool("modified-schiff-pitchfork", "改良希夫干草叉", "channel", "pitchfork", "modified-schiff"),
  tool("inside-pitchfork", "内部分叉线", "channel", "pitchfork", "inside-pitchfork"),

  tool("gann-box", "江恩箱", "gann-fib", "gann", "gann"),
  tool("gann-square", "江恩正方", "gann-fib", "gann", "gann-square"),
  tool("gann-fan", "江恩扇", "gann-fib", "gann", "gann-fan"),
  tool("fib-retracement", "斐波那契回撤", "gann-fib", "fib", "fib"),
  tool("fib-trend-extension", "斐波那契趋势扩展", "gann-fib", "fib", "fib-extension"),
  tool("fib-speed-fan", "斐波那契速度阻力扇", "gann-fib", "gann", "fan"),
  tool("fib-time-zone", "斐波那契时区", "gann-fib", "fib-time", "time-zone"),
  tool("fib-circles", "斐波那契圈", "gann-fib", "fib-circle", "fib-circles"),
  tool("fib-spiral", "斐波那契螺旋", "gann-fib", "fib-circle", "spiral"),
  tool("fib-channel", "斐波那契通道", "gann-fib", "fib", "fib-channel"),
  tool("fib-wedge", "斐波那契楔形", "gann-fib", "gann", "wedge"),
  tool("pitchfan", "倾斜扇形", "gann-fib", "gann", "pitchfan"),

  tool("brush", "笔刷", "brush", "freehand", "brush", true),
  tool("highlighter", "荧光笔", "brush", "freehand", "highlighter", true),
  tool("path", "自由路径", "brush", "freehand", "path", true),

  tool("rectangle", "矩形", "geometry", "rectangle", "rectangle"),
  tool("rotated-rectangle", "旋转矩形", "geometry", "rotated-rectangle", "rotated-rectangle"),
  tool("circle", "圆", "geometry", "ellipse", "circle"),
  tool("ellipse", "椭圆", "geometry", "ellipse", "ellipse"),
  tool("triangle", "三角形", "geometry", "triangle", "triangle"),
  tool("arc", "弧形", "geometry", "arc", "arc"),
  tool("curve", "曲线", "geometry", "curve", "curve"),
  tool("double-curve", "双曲线", "geometry", "curve", "double-curve"),
  tool("polyline", "预设折线", "geometry", "polyline", "polyline"),

  tool("text", "文字", "annotation", "text", "text"),
  tool("anchored-text", "锚定文本", "annotation", "text", "anchored-text"),
  tool("note", "笔记", "annotation", "text", "note"),
  tool("price-note", "价格笔记", "annotation", "text", "price-note"),
  tool("signpost", "指示牌", "annotation", "text", "signpost"),
  tool("callout", "标注", "annotation", "text", "callout"),
  tool("comment", "评论", "annotation", "text", "comment"),
  tool("arrow-marker", "箭头标记", "annotation", "marker", "arrow-marker"),
  tool("arrow-up", "向上箭头", "annotation", "marker", "arrow-up"),
  tool("arrow-down", "向下箭头", "annotation", "marker", "arrow-down"),
  tool("flag", "旗标", "annotation", "marker", "flag"),

  tool("xabcd", "XABCD 形态", "pattern", "pattern", "xabcd"),
  tool("cypher", "赛福形态", "pattern", "pattern", "cypher"),
  tool("head-shoulders", "头肩形态", "pattern", "pattern", "head-shoulders"),
  tool("abcd", "ABCD 形态", "pattern", "pattern", "abcd"),
  tool("triangle-pattern", "三角形态", "pattern", "pattern", "triangle-pattern"),
  tool("three-drives", "三驱形态", "pattern", "pattern", "three-drives"),
  tool("elliott-impulse", "艾略特脉冲波（1·2·3·4·5）", "pattern", "pattern", "elliott-impulse"),
  tool("elliott-correction", "艾略特修正浪（A·B·C）", "pattern", "pattern", "elliott-correction"),
  tool("elliott-triangle", "艾略特三角波（A·B·C·D·E）", "pattern", "pattern", "elliott-triangle"),
  tool("cyclic-lines", "循环线", "pattern", "fib-time", "cyclic-lines"),

  tool("long-position", "多头仓位", "prediction", "position", "long-position"),
  tool("short-position", "空头仓位", "prediction", "position", "short-position"),
  tool("forecast", "仓位预测", "prediction", "projection", "forecast"),
  tool("date-range", "日期范围", "prediction", "range", "date-range"),
  tool("price-range", "价格范围", "prediction", "range", "price-range"),
  tool("date-price-range", "日期和价格范围", "prediction", "measure", "date-price-range"),
  tool("bars-pattern", "K线形态", "prediction", "projection", "bars"),
  tool("ghost-feed", "模拟K线", "prediction", "projection", "ghost"),
  tool("projection", "价格投影", "prediction", "projection", "projection"),
  tool("fixed-range-volume", "固定范围成交量分布图", "prediction", "range", "volume-profile"),
  tool("measure", "测量", "prediction", "measure", "ruler"),
  tool("multi-point-path", "路径", "geometry", "polyline", "multi-point-path"),
  tool("multi-point-polyline", "折线", "geometry", "polyline", "multi-point-polyline"),
  tool("magic", "魔法", "cursor", "cursor", "magic"),
  tool("dot", "圆点", "cursor", "cursor", "dot"),
  tool("demonstration", "荧光笔光标", "cursor", "cursor", "demonstration"),
  tool("fib-trend-time", "斐波那契趋势时间", "gann-fib", "fib-time", "fib-trend-time"),
  tool("fib-speed-arcs", "斐波那契速度阻力弧", "gann-fib", "fib-circle", "fib-speed-arcs"),
  tool("gann-square-fixed", "固定江恩正方", "gann-fib", "gann", "gann-fixed"),
  tool("elliott-double-combo", "艾略特双重组合浪（W·X·Y）", "pattern", "pattern", "elliott-double-combo"),
  tool("elliott-triple-combo", "艾略特三重组合浪（W·X·Y·X·Z）", "pattern", "pattern", "elliott-triple-combo"),
  tool("time-cycles", "时间循环", "pattern", "fib-time", "time-cycles"),
  tool("sine-line", "正弦线", "pattern", "curve", "sine-line"),
  tool("anchored-vwap", "锚定VWAP", "prediction", "line", "anchored-vwap"),
  tool("anchored-volume-profile", "锚定成交量分布图", "prediction", "range", "anchored-volume-profile"),
  tool("sector", "扇形", "prediction", "arc", "sector"),
  tool("anchored-note", "锚定笔记", "annotation", "text", "anchored-note"),
  tool("pin-note", "置顶", "annotation", "text", "pin-note"),
  tool("table", "表格", "annotation", "text", "table"),
  tool("price-label", "价格标签", "annotation", "marker", "price-label"),
  tool("image", "图片", "annotation", "text", "image"),
  tool("tweet", "帖子", "annotation", "text", "tweet"),
  tool("idea", "观点", "annotation", "text", "idea"),
  tool("arrow-left", "向左箭头", "annotation", "marker", "arrow-left"),
  tool("arrow-right", "向右箭头", "annotation", "marker", "arrow-right"),
  tool("emoji", "表情符号", "icons", "marker", "emoji"),
  tool("sticker", "贴纸", "icons", "marker", "emoji"),
  tool("icon", "图标", "icons", "marker", "emoji"),
] as const;

const TRADING_DRAWING_GROUPS: ReadonlyArray<TradingDrawingGroupDefinition> = DRAWING_MENU_SECTIONS;

export function tradingDrawingToolDefinition(id: string | null | undefined) {
  return TRADING_DRAWING_TOOLS.find((candidate) => candidate.id === id) ?? null;
}

export function tradingDrawingSupportsSettings(toolId: string | null | undefined) {
  const definition = tradingDrawingToolDefinition(toolId);
  return Boolean(definition && !['cursor', 'eraser', 'text'].includes(definition.kind)
    && !['emoji', 'sticker', 'icon'].includes(definition.id));
}

// Lines keep their endpoint hit targets for resizing, without painting circles.
// Closed shapes and point annotations retain their visible adjustment handles.
export function tradingDrawingHidesLineNodes(toolId: string | null | undefined) {
  const definition = tradingDrawingToolDefinition(toolId);
  return Boolean(definition
    && ['line', 'ray', 'extended', 'horizontal', 'horizontal-ray', 'vertical', 'cross',
      'arrow', 'channel', 'pitchfork', 'gann', 'fib', 'fib-time', 'freehand',
      'polyline', 'curve', 'pattern', 'projection', 'measure'].includes(definition.kind)
    && !['gann-box', 'gann-square', 'gann-square-fixed', 'sector', 'bars-pattern',
      'ghost-feed', 'date-price-range'].includes(definition.id))
    || toolId === 'fib-spiral' || toolId === 'fib-speed-arcs';
}

export interface TradingDrawingPoint {
  time: number;
  price: number;
}

export interface TradingDrawingModel extends TradingDrawingStyle {
  barsPattern?: BarsPatternSnapshot;
  entryConditionRef?: {conditionId:string;revision:number;conditionHash:string};
  planLevel?: PlanLevel;
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
  if (!first || definition.kind === "text" || (definition.kind === "marker" && definition.id !== "arrow-marker")) return [];
  if (definition.kind === "horizontal") {
    return [{ point: first, showPrice: true, showTime: false }];
  }
  if (definition.kind === "vertical") {
    return [{ point: first, showPrice: false, showTime: true }];
  }
  if (definition.kind === "horizontal-ray" || definition.kind === "cross") {
    return [{ point: first, showPrice: true, showTime: true }];
  }
  if (definition.kind === "triangle" || definition.kind === "pattern" || definition.id === 'rotated-rectangle' || isTradingPitchfork(definition.id) || isThreePointFibonacci(definition.id)) {
    return points.map((point) => ({ point, showPrice: true, showTime: true }));
  }
  if (tradingDrawingIsShapedChannel(definition.id) && points.length >= 3) {
    const corners = [0, 1, 2, 3].map(index => tradingDrawingShapedChannelHandlePoint(definition.id, points, index));
    return corners.map(point => ({ point, showPrice: true, showTime: true }));
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
  magnetAnchorIndex?: number;
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

export function tradingDrawingCoordinateToLogical(
  coordinate: number,
  coordinateToLogical: (coordinate: number) => unknown,
  logicalToCoordinate: (integerLogical: number) => unknown,
): number | null {
  if (!Number.isFinite(coordinate)) return null;
  const nearest = finiteTradingChartCoordinate(coordinateToLogical(coordinate));
  if (nearest === null) return null;
  // Lightweight Charts 5.1 returns an INTEGER from coordinateToLogical and
  // rejects fractions in logicalToCoordinate. Invert the same interpolation
  // used by pointToScreen so an unsnapped pen/endpoint moves at pixel precision.
  const index = Math.floor(nearest);
  const first = finiteTradingChartCoordinate(logicalToCoordinate(index));
  const second = finiteTradingChartCoordinate(logicalToCoordinate(index + 1));
  if (first === null || second === null || second === first) return nearest;
  return index + (coordinate - first) / (second - first);
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
  inset = 8,
): ScreenPoint {
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

function renderDrawingToolMenu(group: TradingDrawingGroupDefinition) {
  const sections = DRAWING_MENU_SECTIONS.find(candidate => candidate.id === group.id)?.sections ?? [];
  if (group.id === 'icons') return `<section class="trading-drawing-tool-menu trading-drawing-symbol-menu" data-drawing-tool-menu="icons" role="menu" aria-label="图标" hidden>
    <div class="trading-drawing-symbol-categories" aria-label="表情分类">${['😀','🐻','🍎','⚽','🚀','💡','❤️','🚩'].map((glyph,i) => `<button type="button" data-drawing-action="symbol-category" data-symbol-category="${i}" aria-label="${['笑脸和人物','动物和自然','食物和饮料','活动','旅行','物品','符号','旗帜'][i]}">${glyph}</button>`).join('')}</div>
    <div class="trading-drawing-symbol-grid" data-drawing-symbol-grid>${renderDrawingSymbolGrid('emoji')}</div>
    <footer role="tablist">${(['emoji','sticker','icon'] as const).map((id,i)=>`<button type="button" role="tab" aria-selected="${i===0}" data-drawing-action="symbol-tab" data-symbol-tab="${id}">${['表情符号','贴纸','图标'][i]}</button>`).join('')}</footer>
  </section>`;
  return `
    <section class="trading-drawing-tool-menu" data-drawing-tool-menu="${group.id}" role="menu" aria-label="${group.label}" hidden>
      <div class="trading-drawing-menu-scroll">
        ${sections.map(section => `<div class="trading-drawing-menu-section">${section.label ? `<h3 data-i18n-drawing-section>${section.label}</h3>` : ''}${section.tools.map(id => {
          const candidate = tradingDrawingToolDefinition(id)!;
          const shortcut = DRAWING_SHORTCUTS[id];
          const help = tradingDrawingIsMultiPoint(id) ? '连续点击设置端点；右键撤销上一端点；双击、Enter 或 Esc 完成；折线点击起点闭合' : candidate.freehand ? '按住鼠标拖动绘制' : `依次点击图表设置 ${tradingDrawingRequiredPointCount(candidate)} 个端点；完成后可拖动端点调整`;
          return `<div class="trading-drawing-menu-row">
            <button type="button" role="menuitemradio" aria-checked="false" data-drawing-action="select-tool" data-drawing-tool="${id}" title="${candidate.label}">
              ${drawingIcon(candidate.icon)}<span>${candidate.label}${shortcut ? `<i class="trading-drawing-tool-help" title="${help}" aria-label="${help}">?</i>` : ''}</span><kbd>${shortcut ?? ''}</kbd>
            </button>
            ${group.id !== 'cursor' ? `<button type="button" class="trading-drawing-favorite" data-drawing-action="toggle-favorite" data-favorite-tool="${id}" aria-pressed="false" aria-label="收藏${candidate.label}" title="添加到收藏">${drawingIcon('star')}</button>` : ''}
          </div>`;
        }).join('')}</div>`).join('')}
        ${group.id === 'prediction' ? `<div class="trading-drawing-menu-section"><h3 data-i18n-drawing-section>视图与历史</h3>${[
          ['zoom-out', '缩小', 'zoom-out'], ['undo', '撤销绘图', 'undo'], ['redo', '重做绘图', 'redo'],
        ].map(([action,label,icon]) => `<button type="button" class="trading-drawing-menu-action" role="menuitem" data-drawing-action="${action}">${drawingIcon(icon)}<span>${label}</span><kbd>${action === 'undo' ? 'Ctrl + Z' : action === 'redo' ? 'Ctrl + Y' : ''}</kbd></button>`).join('')}</div>` : ''}
      </div>
    </section>
  `;
}

function renderDrawingSymbolGrid(tab: keyof typeof DRAWING_SYMBOLS) {
  return DRAWING_SYMBOLS[tab].map(glyph => `<button type="button" role="menuitem" data-drawing-action="select-symbol" data-symbol-tool="${tab}" data-symbol-glyph="${glyph}" aria-label="${glyph}">${glyph}</button>`).join('');
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
    <aside class="trading-drawing-toolbar" data-drawing-toolbar data-i18n-drawing aria-label="K线绘图工具">
      <div class="trading-drawing-toolbar-scroll">
        ${TRADING_DRAWING_GROUPS.map((group) => `
          <div class="trading-drawing-group" data-drawing-group="${group.id}">
            <button type="button" class="trading-drawing-primary" data-drawing-action="select-group-tool" data-drawing-group-id="${group.id}" data-drawing-tool="${group.defaultTool}" aria-pressed="false" aria-label="${group.label}" title="${group.label}">
              ${drawingIcon(group.icon)}
            </button>
            <button type="button" class="trading-drawing-disclosure" data-drawing-action="toggle-tool-menu" data-drawing-group-id="${group.id}" aria-label="展开${group.label}" aria-haspopup="menu" aria-expanded="false">
            <svg viewBox="0 0 8 8" aria-hidden="true"><path d="m3 2 2 2-2 2"/></svg>
            </button>
          </div>
        `).join("")}
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        ${toolbarAction("measure", "快速测量（Shift + 点击或拖动）", "ruler", 'aria-pressed="false"')}
        ${toolbarAction("zoom-in", "框选放大（点击起点和终点，或拖动框选）", "zoom", 'aria-pressed="false"')}
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        <div class="trading-drawing-group trading-drawing-magnet-group" data-drawing-group="magnet">
          ${toolbarAction("toggle-magnet", "弱磁铁", "magnet", 'aria-pressed="false"')}
          <button type="button" class="trading-drawing-disclosure" data-drawing-action="toggle-tool-menu" data-drawing-group-id="magnet" aria-label="磁铁模式" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 8 8" aria-hidden="true"><path d="m3 2 2 2-2 2"/></svg></button>
        </div>
        ${toolbarAction("toggle-stay", "保持绘图模式", "pin", 'aria-pressed="false"')}
        ${toolbarAction("toggle-lock", "锁定全部绘图", "unlock", 'aria-pressed="false"')}
        ${toolbarAction("screenshot", "截图并保存到桌面", "camera")}
        <div class="trading-drawing-group trading-drawing-visibility-group" data-drawing-group="visibility">
          ${toolbarAction("toggle-visibility", "隐藏AI绘图和计划线", "drawings-visible", 'aria-pressed="false"')}
          <button type="button" class="trading-drawing-disclosure" data-drawing-action="toggle-tool-menu" data-drawing-group-id="visibility" aria-label="展开隐藏绘图选项" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 8 8" aria-hidden="true"><path d="m3 2 2 2-2 2"/></svg></button>
        </div>
        <div class="trading-drawing-divider" aria-hidden="true"></div>
        ${toolbarAction("clear", "清空本会话所有绘图", "trash")}
      </div>
      ${TRADING_DRAWING_GROUPS.map(renderDrawingToolMenu).join("")}
      <section class="trading-drawing-tool-menu trading-drawing-visibility-menu" data-drawing-tool-menu="visibility" role="menu" aria-label="隐藏绘图" hidden>
        ${TRADING_VISIBILITY_LAYERS.map(({ key, label }) => `<button type="button" role="menuitemcheckbox" aria-checked="false" data-drawing-action="toggle-layer-visibility" data-drawing-visibility-layer="${key}"><span>${label}</span><svg class="trading-drawing-visibility-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>`).join('')}
      </section>
      <section class="trading-drawing-tool-menu trading-drawing-magnet-menu" data-drawing-tool-menu="magnet" role="menu" aria-label="磁铁模式" hidden>
        <button type="button" role="menuitemradio" aria-checked="false" data-drawing-action="set-magnet-mode" data-magnet-mode="weak">${drawingIcon('magnet')}<span>弱磁铁</span></button>
        <button type="button" role="menuitemradio" aria-checked="false" data-drawing-action="set-magnet-mode" data-magnet-mode="strong">${drawingIcon('magnet-strong')}<span>强磁铁</span></button>
        <div class="trading-drawing-magnet-divider" role="separator"></div>
        <button type="button" role="menuitemcheckbox" aria-checked="false" data-drawing-action="toggle-magnet-indicators"><span>吸附到指标</span><span class="trading-drawing-magnet-switch" aria-hidden="true"></span></button>
      </section>
      <div class="trading-drawing-favorites-bar" data-drawing-favorites-bar aria-label="收藏的绘图工具" hidden></div>
      <p class="trading-drawing-status" data-drawing-status aria-live="polite">光标</p>
    </aside>
    <dialog
      class="trading-drawing-clear-dialog"
      data-drawing-clear-dialog
      data-i18n-drawing
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

// Compact controls share a 24px grid and balanced insets; the larger drawing
// palette keeps its own artwork so its tool silhouettes remain unchanged.
function selectionIcon(name: 'reset' | 'color' | 'lock' | 'unlock' | 'trash' | 'templates' | 'eye' | 'eye-closed') {
  const paths = {
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-closed': '<path d="M3 8s3 6 9 6 9-6 9-6M5 11l-2 3M9 14l-1 4M15 14l1 4M19 11l2 3"/>',
    reset: '<path d="M4 5v5h5M4.5 10a8 8 0 1 1 1.8 8"/>',
    color: '<path d="m5 15 10-10a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Zm8-8 3 3"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
    trash: '<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    templates: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
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
    <div class="trading-drawing-selection" data-drawing-selection data-i18n-drawing role="toolbar" aria-label="绘图选项" hidden>
      <button type="button" class="trading-chart-toolbar-close" data-drawing-selection-action="hide-toolbar" aria-label="隐藏绘图工具栏（重新选中图形可恢复）" title="隐藏绘图工具栏（重新选中图形可恢复）"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg></button>
      <span class="trading-drawing-selection-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <div class="trading-drawing-selection-mode" data-drawing-selection-mode="drawing">
        ${selectionAction("reset", "恢复默认", selectionIcon("reset"))}
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-color", "选择颜色", selectionIcon("color") + '<span class="trading-drawing-color-indicator" data-drawing-current-color></span>', 'aria-haspopup="dialog" aria-expanded="false"')}
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-style", "选择样式", '<span class="trading-drawing-line-preview" data-drawing-style-preview></span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact" data-drawing-selection-popover="style" role="menu" aria-label="选择样式" hidden>
            ${(["solid", "dotted", "dashed"] as TradingDrawingLineStyle[]).map((style) => `<button type="button" data-drawing-selection-action="set-style" data-drawing-style="${style}" role="menuitemradio" aria-checked="false" aria-label="${style === "solid" ? "实线" : style === "dotted" ? "点线" : "虚线"}"><span class="trading-drawing-line-preview ${style}"></span></button>`).join("")}
          </div>
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-width", "选择线宽", '<span class="trading-drawing-width-preview" data-drawing-width-preview></span><span class="trading-drawing-width-value" data-drawing-width-value>2px</span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact" data-drawing-selection-popover="width" role="menu" aria-label="选择线宽" hidden>
            ${[1, 2, 3, 4].map((width) => `<button type="button" class="line-width-option" style="--line-width:${width}px" data-drawing-selection-action="set-width" data-drawing-width="${width}" role="menuitemradio" aria-checked="false" aria-label="${width} 像素">${width}px</button>`).join("")}
          </div>
        </div>
        ${selectionAction("settings", "绘图设置", horizontalLineSettingsIcon, 'data-horizontal-line-settings hidden aria-haspopup="dialog"')}
        ${selectionAction('pattern-fill', '背景颜色', '<span class="trading-drawing-background-symbol"></span><span class="trading-drawing-color-indicator" data-pattern-fill-color></span>', 'data-harmonic-style-control hidden aria-haspopup="dialog"')}
        ${selectionAction('pattern-label', '文本颜色', '<span class="trading-drawing-text-symbol">T</span>', 'data-harmonic-style-control hidden aria-haspopup="dialog"')}
        ${selectionAction("toggle-lock", "锁定", selectionIcon("lock"), 'aria-pressed="false"')}
        ${selectionAction("toggle-visibility", "隐藏此画线", selectionIcon("eye"), 'aria-pressed="false"')}
        ${selectionAction("delete", "删除", selectionIcon("trash"))}
      </div>
      <div class="trading-drawing-selection-mode text" data-drawing-selection-mode="text" hidden>
        ${selectionAction("reset-text", "恢复默认文本样式", selectionIcon("templates"))}
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("edit-text", "文本输入", selectionIcon("color"), 'aria-haspopup="dialog" aria-expanded="false"')}
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
          ${selectionAction("toggle-text-color", "文本颜色", '<span class="trading-drawing-text-symbol">A</span>', 'aria-haspopup="dialog" aria-expanded="false"')}
        </div>
        <div class="trading-drawing-selection-menu-wrap">
          ${selectionAction("toggle-text-background", "背景颜色", '<span class="trading-drawing-background-symbol"></span>', 'aria-haspopup="dialog" aria-expanded="false"')}
        </div>
        <div class="trading-drawing-selection-menu-wrap font-size">
          ${selectionAction("toggle-font-size", "字体大小", '<span class="trading-drawing-font-size" data-drawing-font-size-label>16</span>', 'aria-haspopup="menu" aria-expanded="false"')}
          <div class="trading-drawing-selection-popover compact font-size" data-drawing-selection-popover="font-size" role="menu" aria-label="字体大小" hidden>
            ${TRADING_TEXT_FONT_SIZES.map((size) => `<button type="button" data-drawing-selection-action="set-font-size" data-drawing-font-size="${size}" role="menuitemradio" aria-checked="false">${size}</button>`).join("")}
          </div>
        </div>
        ${selectionAction("toggle-bold", "加粗", '<span class="trading-drawing-bold-symbol">B</span>', 'aria-pressed="false"')}
        ${selectionAction("toggle-lock", "锁定", selectionIcon("lock"), 'aria-pressed="false"')}
        ${selectionAction("toggle-visibility", "隐藏此画线", selectionIcon("eye"), 'aria-pressed="false"')}
        ${selectionAction("delete", "删除", selectionIcon("trash"))}
      </div>
    </div>
  `;
}

export function renderTradingDrawingLayer() {
  return `
    <svg class="trading-order-line-layer" data-trading-order-line-layer data-i18n-drawing>
      <g data-trading-order-lines aria-label="账户持仓与委托线"></g>
    </svg>
    <svg class="trading-drawing-layer" data-drawing-layer data-i18n-drawing aria-label="K线绘图画布" role="img">
      <defs>
        <marker id="trading-drawing-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="none" />
        </marker>
      </defs>
      <g data-drawing-content></g>
      <g data-ai-drawing-content aria-label="AI 策略绘图"></g>
      <g data-ai-text-hit-content aria-label="AI 文字标注字号调节"></g>
      <g data-ai-drawing-cursor aria-hidden="true"></g>
    </svg>
    <div class="trading-order-position-cards" data-trading-order-position-cards></div>
    <div class="trading-drawing-axis-markers" data-drawing-axis-markers aria-hidden="true"></div>
    <div class="trading-ai-text-size-toolbar" data-i18n-drawing data-ai-text-size-toolbar role="toolbar" aria-label="AI 画线显示与字号" hidden title="拖动可移动字号工具栏">
      <button type="button" data-ai-text-size-action="decrease" aria-label="缩小当前图表全部标注文字" title="缩小当前图表全部标注文字"><span aria-hidden="true">A−</span></button>
      <button type="button" data-ai-text-size-action="increase" aria-label="放大当前图表全部标注文字" title="放大当前图表全部标注文字"><span aria-hidden="true">A+</span></button>
      <button type="button" data-ai-text-size-action="toggle-visibility" aria-label="隐藏当前会话 AI 画线" title="隐藏当前会话 AI 画线" aria-pressed="false">${selectionIcon("eye")}</button>
      <button type="button" data-ai-text-size-action="next-drawing" aria-label="切换 K 线绘制" title="切换 K 线绘制" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h13m-3-3 3 3-3 3M17 14H4m3-3-3 3 3 3"/></svg><span data-ai-drawing-set-position aria-hidden="true"></span></button>
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
  return typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value.toLowerCase() : undefined;
}

function tradingDrawingStyleFromModel(
  drawing: TradingDrawingStyle & { tool?: string },
): TradingDrawingStyle {
  const color = drawingColor(drawing.color);
  const textBackgroundColor = drawingColor(drawing.textBackgroundColor);
  const lineStyle = drawingLineStyle(drawing.lineStyle);
  const lineWidth = drawingLineWidth(drawing.lineWidth);
  const fontSize = drawingTextFontSize(drawing.fontSize);
  return {
    ...normalizeHorizontalLineTextStyle(drawing),
    ...(drawing.regression ? { regression: normalizeRegressionTrendOptions(drawing.regression) } : {}),
    ...(drawing.vwap ? { vwap: normalizeAnchoredVwapOptions(drawing.vwap) } : {}),
    ...(drawing.volumeProfile ? { volumeProfile: normalizeFixedVolumeOptions(drawing.volumeProfile) } : {}),
    ...(drawing.position ? { position: normalizePositionOptions(drawing.position) } : {}),
    ...(drawing.fibonacci ? { fibonacci: normalizeFibonacciOptions(drawing.fibonacci, drawing.tool) } : {}),
    ...(color ? { color } : {}),
    ...(textBackgroundColor ? { textBackgroundColor } : {}),
    ...(fontSize ? { fontSize } : {}),
    ...(drawing.bold ? { bold: true } : {}),
    ...(lineStyle ? { lineStyle } : {}),
    ...(lineWidth !== undefined ? { lineWidth } : {}),
  };
}

function normalizeTradingDrawingStyle(value: unknown, tool?: string): TradingDrawingStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = value as Partial<TradingDrawingStyle>;
  return tradingDrawingStyleFromModel({
    tool,
    ...normalizeHorizontalLineTextStyle(candidate),
    regression: candidate.regression,
    vwap: candidate.vwap,
    volumeProfile: candidate.volumeProfile,
    position: candidate.position,
    fibonacci: candidate.fibonacci,
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

function conditionReference(value: unknown): TradingDrawingModel['entryConditionRef'] {
  if(value==null)return undefined;
  const ref=value as NonNullable<TradingDrawingModel['entryConditionRef']>;
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ref.conditionId)||!Number.isSafeInteger(ref.revision)||ref.revision<1
    ||!/^[a-f0-9]{64}$/.test(ref.conditionHash))throw new TypeError('AI condition reference is invalid');
  return {conditionId:ref.conditionId,revision:ref.revision,conditionHash:ref.conditionHash};
}

function drawingLineWidth(value: unknown) {
  const width = Number(value);
  return Number.isFinite(width) && width >= 0.5 && width <= 40 ? width : undefined;
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
      const points = tradingDrawingPlacementMode(definition) === "single-click" && !['table', 'image'].includes(definition.id)
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
        points: isPositionDrawing(definition.id) ? positionAnchors({ tool: definition.id, points, position: candidate.position }) : isCycleDrawing(definition.id) ? cycleAnchorPoints(definition.id, points) : points,
        text: typeof candidate.text === "string" ? candidate.text.slice(0, 240) : undefined,
        ...(typeof candidate.imageOpacity === 'number' && Number.isFinite(candidate.imageOpacity) ? { imageOpacity: Math.max(0, Math.min(1, candidate.imageOpacity)) } : {}),
        ...normalizeHorizontalLineTextStyle(candidate),
        ...(candidate.regression ? { regression: normalizeRegressionTrendOptions(candidate.regression) } : {}),
        ...(candidate.vwap ? { vwap: normalizeAnchoredVwapOptions(candidate.vwap) } : {}),
        ...(candidate.volumeProfile ? { volumeProfile: normalizeFixedVolumeOptions(candidate.volumeProfile) } : {}),
        ...(candidate.position ? { position: normalizePositionOptions(candidate.position) } : {}),
        ...(candidate.barsPattern ? { barsPattern: normalizeBarsSnapshot(candidate.barsPattern) } : {}),
        ...(candidate.fibonacci ? { fibonacci: normalizeFibonacciOptions(candidate.fibonacci, definition.id) } : {}),
        locked: candidate.locked === true,
        color: drawingColor(candidate.color),
        textBackgroundColor: drawingColor(candidate.textBackgroundColor),
        fontSize: drawingTextFontSize(candidate.fontSize),
        bold: candidate.bold === true,
        lineStyle: drawingLineStyle(candidate.lineStyle),
        lineWidth: drawingLineWidth(candidate.lineWidth),
        viewportAnchor: ["anchored-text", "anchored-note"].includes(definition.id)
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
    return normalizeStoredAiDrawings(loadStoredDrawingValues("ai", storageSessionId));
  } catch { return []; }
}

function normalizeStoredAiDrawings(parsed: unknown[]): TradingDrawingModel[] {
  try {
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
        entryConditionRef:conditionReference(candidate.entryConditionRef),
        planLevel:normalizePlanLevel(candidate.planLevel),
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
  manualDefaults?: Readonly<ManualDrawingDefaults>;
  customColor?: boolean;
  customWidth?: boolean;
  customStyle?: boolean;
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

export function tradingDrawingChannelPoints(first: ScreenPoint, second: ScreenPoint, widthPoint?: ScreenPoint): ScreenPoint[] {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  // The third point sets only the offset. Both edges retain the baseline's
  // time span, including when the pointer moves beyond either endpoint.
  // Keep the original appearance of saved two-point channels.
  const offset = widthPoint
    ? Math.abs(dx) < 1e-6
      ? { x: widthPoint.x - first.x, y: 0 }
      : { x: 0, y: widthPoint.y - (first.y + dy * (widthPoint.x - first.x) / dx) }
    : perpendicularOffset(first, second, Math.max(20, Math.min(Math.hypot(dx, dy) * 0.2, 72)));
  return [first, second,
    { x: second.x + offset.x, y: second.y + offset.y },
    { x: first.x + offset.x, y: first.y + offset.y }];
}

// Two anchors define the primary line; the third sets an absolute price, not
// a parallel offset. Both boundaries share the primary line's time span.
export function tradingDrawingFlatTopBottomPoints(first: ScreenPoint, second: ScreenPoint, level: ScreenPoint = second): ScreenPoint[] {
  return [first, second, { x: second.x, y: level.y }, { x: first.x, y: level.y }];
}

export function tradingDrawingIsShapedChannel(tool: TradingDrawingToolId) {
  return tool === 'flat-top-bottom' || tool === 'disjoint-channel';
}

// TradingView's three-click disjoint channel mirrors the first edge's price
// change. The placement pointer sets the opposite END price, ignoring its x.
export function tradingDrawingDisjointChannelPoints(first: ScreenPoint, second: ScreenPoint, level: ScreenPoint = second, oppositeStart?: ScreenPoint): ScreenPoint[] {
  return [first, second, { x: second.x, y: level.y }, oppositeStart ?? { x: first.x, y: level.y + second.y - first.y }];
}

export function tradingDrawingShapedChannelHandlePoint(tool: TradingDrawingToolId, points: ReadonlyArray<TradingDrawingPoint>, index: number): TradingDrawingPoint {
  if (index < 2) return points[index];
  const level = (points[2] ?? points[1]).price;
  return { time: points[index === 3 ? 0 : 1].time,
    price: index === 3 && tool === 'disjoint-channel' ? level + points[1].price - points[0].price : level };
}

export function tradingDrawingMoveShapedChannelHandle(tool: TradingDrawingToolId, points: TradingDrawingPoint[], index: number, point: TradingDrawingPoint): TradingDrawingPoint[] {
  const next = points.map(p => ({ ...p }));
  if (tool === 'disjoint-channel') {
    // Circular corners resize symmetrically about the existing center price;
    // the opposite end handle moves the second edge without moving the first.
    if (index === 1) next[2].price -= point.price - next[1].price;
    if (index < 2) next[index] = { ...point };
    else if (index === 3) next[0] = { time: point.time, price: next[1].price + next[2].price - point.price };
    else next[2].price = point.price;
    next[2].time = next[1].time;
    return next;
  }
  if (index < 2) next[index] = { ...point };
  else {
    // Either flat corner adjusts the shared price and its corresponding end
    // time. The primary line's two prices remain independently editable.
    next[index === 3 ? 0 : 1].time = point.time;
    next[2] = { time: next[1].time, price: point.price };
  }
  next[2] = { time: next[1].time, price: (next[2] ?? next[1]).price };
  return next;
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

let drawingLabelMeasure: CanvasRenderingContext2D | null | undefined;
function tradingDrawingLabelLayout(drawing: TradingDrawingModel, fontSize: number, maxWidth: number) {
  const layout = tradingDrawingTextLayout(drawing.text ?? '', fontSize, maxWidth);
  if (drawingLabelMeasure === undefined && typeof document !== 'undefined') {
    drawingLabelMeasure = document.createElement('canvas').getContext('2d');
  }
  if (drawingLabelMeasure) {
    drawingLabelMeasure.font = `${drawing.italic ? 'italic' : 'normal'} ${drawing.bold ? 700 : 400} ${fontSize}px Inter, "Segoe UI", "Microsoft YaHei", sans-serif`;
    layout.lineWidths = layout.lines.map(line => drawingLabelMeasure!.measureText(line).width);
    layout.width = Math.max(8, ...layout.lineWidths);
  }
  return layout;
}

export function tradingHorizontalLineTextGeometry(drawing: TradingDrawingModel, y: number, width: number) {
  if (!drawing.text?.trim() || width <= 16) return null;
  const fontSize = drawingTextFontSize(drawing.fontSize) ?? 12;
  const layout = tradingDrawingLabelLayout(drawing, fontSize, width - 24);
  const align = drawing.textAlign ?? 'center';
  const vertical = drawing.textVerticalAlign ?? 'top';
  const x = align === 'left' ? 8 : align === 'right' ? width - 8 : width / 2;
  const left = align === 'left' ? x : align === 'right' ? x - layout.width : x - layout.width / 2;
  const top = vertical === 'middle' ? y - layout.height / 2 : vertical === 'bottom' ? y + 6 : y - layout.height - 6;
  return { x, y, left, top, angle: 0, fontSize, layout, anchor: align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle', vertical };
}

export function tradingDrawingLabelSpan(drawing: TradingDrawingModel, points: ScreenPoint[], bounds: { width: number; height: number }): [ScreenPoint, ScreenPoint] | null {
  if (!points.length || !tradingDrawingSupportsSettings(drawing.tool)) return null;
  const first = points[0], last = points.at(-1)!;
  const kind = tradingDrawingToolDefinition(drawing.tool)!.kind;
  if (kind === 'horizontal' || kind === 'cross') return [{ x: 0, y: first.y }, { x: bounds.width, y: first.y }];
  if (kind === 'horizontal-ray') return first.x <= bounds.width ? [{ x: Math.max(0, first.x), y: first.y }, { x: bounds.width, y: first.y }] : null;
  if (kind === 'vertical') return first.x >= 0 && first.x <= bounds.width ? [{ x: first.x, y: 0 }, { x: first.x, y: bounds.height }] : null;
  if (drawing.textVerticalAlign === 'middle' && kind === 'channel' && points.length >= 3) {
    const corners = drawing.tool === 'parallel-channel' ? tradingDrawingChannelPoints(first, points[1], points[2])
      : drawing.tool === 'flat-top-bottom' ? tradingDrawingFlatTopBottomPoints(first, points[1], points[2])
      : drawing.tool === 'disjoint-channel' ? tradingDrawingDisjointChannelPoints(first, points[1], points[2], points[3]) : null;
    if (corners) {
      const middle = (a: ScreenPoint, b: ScreenPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const span = clipTradingDrawingLine(middle(corners[0], corners[3]), middle(corners[1], corners[2]), bounds, 'segment');
      if (span) return span[0].x > span[1].x || span[0].x === span[1].x && span[0].y > span[1].y ? [span[1], span[0]] : span;
    }
  }
  if (drawing.tool !== 'anchored-vwap' && (['line', 'ray', 'extended', 'arrow', 'channel', 'pitchfork', 'measure', 'rotated-rectangle'].includes(kind) || drawing.tool === 'arrow-marker')) {
    const end = drawing.tool === 'parallel-channel' || drawing.tool === 'rotated-rectangle' || tradingDrawingIsShapedChannel(drawing.tool) ? points[1] ?? first : last;
    const clipped = points.length > 1 ? clipTradingDrawingLine(first, end, bounds, kind === 'ray' ? 'ray' : kind === 'extended' ? 'extended' : 'segment') : [first, first] as [ScreenPoint, ScreenPoint];
    return clipped && (clipped[0].x > clipped[1].x || clipped[0].x === clipped[1].x && clipped[0].y > clipped[1].y) ? [clipped[1], clipped[0]] : clipped;
  }
  if (['arc', 'curve', 'double-curve'].includes(drawing.tool)) {
    const [a, b] = first.x > last.x ? [last, first] : [first, last];
    const control = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - (drawing.tool === 'arc' ? Math.abs(b.x - a.x) / 3 : Math.max(Math.abs(b.x - a.x) * .28, 18)) };
    const t = drawing.textAlign === 'left' ? .1 : drawing.textAlign === 'right' ? .9 : .5;
    const point = { x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t * t * b.y };
    const dx = (1 - t) * (control.x - a.x) + t * (b.x - control.x), dy = (1 - t) * (control.y - a.y) + t * (b.y - control.y);
    const scale = 8 / (Math.hypot(dx, dy) || 1);
    return [{ x: point.x - dx * scale, y: point.y - dy * scale }, { x: point.x + dx * scale, y: point.y + dy * scale }];
  }
  if (kind === 'freehand' || kind === 'polyline' || kind === 'pattern' || drawing.tool === 'anchored-vwap') {
    const path = kind === 'polyline' && !tradingDrawingIsMultiPoint(drawing.tool) ? patternPoints(first, last, 5) : points;
    const ordered = path[0].x > path.at(-1)!.x ? [...path].reverse() : path;
    const segments = ordered.slice(1).flatMap((point, index) => {
      const span = clipTradingDrawingLine(ordered[index], point, bounds, 'segment');
      return span ? [{ span, length: Math.hypot(span[1].x - span[0].x, span[1].y - span[0].y) }] : [];
    }).filter(segment => segment.length > 0);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    let distance = total * (drawing.textAlign === 'left' ? 0 : drawing.textAlign === 'right' ? 1 : .5);
    for (const segment of segments) {
      if (distance <= segment.length) {
        const [a, b] = segment.span;
        if (!drawing.textAlign || drawing.textAlign === 'center') {
          const ratio = distance / segment.length;
          const point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
          const direction = a.x > b.x || a.x === b.x && a.y > b.y ? -1 : 1;
          const dx = (b.x - a.x) / segment.length * 8 * direction, dy = (b.y - a.y) / segment.length * 8 * direction;
          return [{ x: point.x - dx, y: point.y - dy }, { x: point.x + dx, y: point.y + dy }];
        }
        return a.x > b.x || a.x === b.x && a.y > b.y ? [b, a] : [a, b];
      }
      distance -= segment.length;
    }
  }
  let left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
  let top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y));
  if (drawing.tool === 'circle') {
    const circle = tradingDrawingCircleGeometry(first, last);
    left = circle.cx - circle.radius; right = circle.cx + circle.radius;
    top = circle.cy - circle.radius; bottom = circle.cy + circle.radius;
  }
  if (right < 0 || left > bounds.width || bottom < 0 || top > bounds.height) return null;
  const y = (Math.max(0, top) + Math.min(bounds.height, bottom)) / 2;
  return [{ x: Math.max(0, left), y }, { x: Math.min(bounds.width, right), y }];
}

export function tradingDrawingLabelGeometry(drawing: TradingDrawingModel, points: ScreenPoint[], bounds: { width: number; height: number }, measured?: { width: number; height: number }) {
  const span = tradingDrawingLabelSpan(drawing, points, bounds);
  if (!span || !drawing.text?.trim() || bounds.width <= 24) return null;
  const fontSize = drawingTextFontSize(drawing.fontSize) ?? 12;
  const layout = tradingDrawingLabelLayout(drawing, fontSize, bounds.width - 24);
  const width = measured?.width ?? layout.width, height = measured?.height ?? layout.height;
  const align = drawing.textAlign ?? 'center', vertical = drawing.textVerticalAlign ?? 'top';
  const [start, end] = span;
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  const ux = length ? dx / length : 1, uy = length ? dy / length : 0;
  const angle = Math.atan2(uy, ux) * 180 / Math.PI;
  const localLeft = align === 'left' ? 0 : align === 'right' ? -width : -width / 2;
  const localTop = vertical === 'middle' ? -height / 2 : vertical === 'bottom' ? 6 : -height - 6;
  const inset = Math.min(8, length / 2);
  let distance = align === 'left' ? inset : align === 'right' ? length - inset : length / 2;
  // Keep the rotated label in the viewport by sliding its anchor along the
  // stroke. An independent x/y clamp would move it away from a sloping line.
  const corners = [localLeft, localLeft + width].flatMap(x => [localTop, localTop + height].map(y => ({ x: ux * x - uy * y, y: uy * x + ux * y })));
  let minimum = 0, maximum = length;
  for (const [axis, unit, limit] of [['x', ux, bounds.width], ['y', uy, bounds.height]] as const) {
    if (Math.abs(unit) < 1e-9) continue;
    const offsets = corners.map(point => point[axis]);
    const a = (4 - start[axis] - Math.min(...offsets)) / unit;
    const b = (limit - 4 - start[axis] - Math.max(...offsets)) / unit;
    minimum = Math.max(minimum, Math.min(a, b)); maximum = Math.min(maximum, Math.max(a, b));
  }
  if (minimum <= maximum) distance = Math.max(minimum, Math.min(maximum, distance));
  const x = start.x + ux * distance, y = start.y + uy * distance;
  if (y < 0 || y > bounds.height) return null;
  return { x, y, left: x + localLeft, top: y + localTop, angle, fontSize, layout, anchor: align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle', vertical };
}

export function renderTradingHorizontalLineText(drawing: TradingDrawingModel, y: number, width: number, color: string, interactive = false) {
  return renderTradingDrawingLabel(drawing, tradingHorizontalLineTextGeometry(drawing, y, width), color, interactive);
}

export function renderTradingDrawingLabel(drawing: TradingDrawingModel, geometry: ReturnType<typeof tradingDrawingLabelGeometry>, color: string, interactive = false) {
  if (!geometry) return '';
  const { x, y, left, top, angle, fontSize, layout, anchor } = geometry;
  const text = `<text class="trading-horizontal-line-text" data-i18n-skip fill="${drawingColor(drawing.textColor) ?? color}" font-size="${fontSize}" font-weight="${drawing.bold ? 700 : 400}" font-style="${drawing.italic ? 'italic' : 'normal'}" text-anchor="${anchor}">${layout.lines.map((line, index) => `<tspan x="${x}" y="${top + fontSize + index * layout.lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
  const hit = interactive ? `<rect class="trading-drawing-hit-target area" data-horizontal-line-edit-text="${escapeHtml(drawing.id)}" role="button" tabindex="0" aria-label="${escapeHtml(translateAppText('文本输入'))}" x="${left - 4}" y="${top - 2}" width="${layout.width + 8}" height="${layout.height + 4}"/>` : '';
  return `<g class="trading-drawing-label" transform="rotate(${angle} ${x} ${y})">${text}${hit}</g>`;
}

// Cut only this drawing's geometry, preserving candles and grid lines behind
// the text. The gap shares the label's local coordinates and rotation.
function renderTradingDrawingLabelMask(id: string, geometry: NonNullable<ReturnType<typeof tradingDrawingLabelGeometry>>, bounds: { width: number; height: number }, placeholder = false) {
  const { x, y, left, top, angle, fontSize, layout } = geometry;
  const padding = Math.max(4, fontSize * .3);
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${bounds.width}" height="${bounds.height}" style="mask-type:luminance">`
    + `<rect width="${bounds.width}" height="${bounds.height}" fill="white"/>`
    + `<rect${placeholder ? ' class="trading-drawing-add-text-mask"' : ''} x="${left - padding}" y="${top - 2}" width="${layout.width + padding * 2}" height="${layout.height + 4}" fill="black" transform="rotate(${angle} ${x} ${y})"/>`
    + `</mask></defs>`;
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
  reservedObstacles: TradingDrawingCollisionRect[] = [],
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
    for (const obstacle of [...reservedObstacles, ...(note.avoidBoxInteriors ? boxObstacles : [])]) {
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
      const reservedCollision = reservedObstacles.some(obstacle => (
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
        reservedCollision,
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
    const selected = ranked.find((candidate) => !candidate.boxCollision && !candidate.reservedCollision);
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

// A tapered, filled arrow whose entire silhouette scales with the distance
// between the tail and tip. Vector offsets also handle vertical, reversed and
// coincident anchors without angles, division by zero or a fixed-size head.
export function tradingDrawingArrowMarkerPoints(tail: ScreenPoint, tip: ScreenPoint): ScreenPoint[] {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const offset = (along: number, across: number): ScreenPoint => ({
    x: tail.x + dx * along - dy * across,
    y: tail.y + dy * along + dx * across,
  });
  return [tail, offset(0.8, -0.075), offset(0.76, -0.16), tip, offset(0.76, 0.16), offset(0.8, 0.075)];
}

// Fixed-size directional arrows: 21 x 22 CSS px, with a 10 px wide stem.
// Use the same silhouette for the visible fill and the whole-arrow drag target.
export function tradingDrawingDirectionalArrowPoints(point: ScreenPoint, direction: 'arrow-up' | 'arrow-down'): ScreenPoint[] {
  const sign = direction === 'arrow-up' ? 1 : -1;
  return [[0, -11], [10.5, 1], [5, 1], [5, 11], [-5, 11], [-5, 1], [-10.5, 1]]
    .map(([x, y]) => ({ x: point.x + x, y: point.y + y * sign }));
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
  if (definition.id === "arrow-marker") {
    return { type: "polygon", points: tradingDrawingArrowMarkerPoints(first, second) };
  }
  if (definition.id === 'arrow-up' || definition.id === 'arrow-down') {
    return { type: 'polygon', points: tradingDrawingDirectionalArrowPoints(first, definition.id) };
  }
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
    return { type: 'polygon', points: rotatedRectangleGeometry(first, second, third).corners };
  }
  if (definition.kind === "channel") {
    return {
      type: "polygon",
      points: definition.id === 'disjoint-channel' ? tradingDrawingDisjointChannelPoints(first, second, third)
        : definition.id === 'flat-top-bottom'
        ? tradingDrawingFlatTopBottomPoints(first, second, third)
        : tradingDrawingChannelPoints(first, second, definition.id === 'parallel-channel' ? third : undefined),
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
  lastToolByGroup?: Partial<Record<TradingDrawingGroupId, TradingDrawingToolId>>;
  stayInDrawingMode: boolean;
  magnetEnabled: boolean;
  magnetMode?: TradingMagnetMode;
  snapToIndicators?: boolean;
  drawingStyles?: Partial<Record<TradingDrawingToolId, TradingDrawingStyle>>;
  symbolGlyph?: string;
  favoriteTools?: TradingDrawingToolId[];
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
    || (!patch.operations.length && patch.resultPolicy!=='entry-v2')
    || patch.operations.length > (patch.resultPolicy==='entry-v2'?128:64)
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
      entryConditionRef:conditionReference(patch.entryConditionRef),
      planLevel:normalizePlanLevel(drawing.planLevel),
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
    entryConditionRef:conditionReference(drawing.entryConditionRef),
    planLevel:normalizePlanLevel(drawing.planLevel),
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

export function tradingAiDrawingDisplayModel<T extends { text?: string }>(drawing: T, _language?: AppLanguage): T {
  // Stored AI text is already localized when its analysis is committed. Never
  // reinterpret saved history when the user later changes the interface language.
  return drawing;
}

export function persistTradingAiDrawingPatch(
  storageSessionId: string,
  patch: TradingAiDrawingPatch,
) {
  const drawings = normalizeTradingAiDrawingPatch(patch).map(tradingAiDrawingModel);
  const stored = loadStoredAiDrawings(storageSessionId);
  const sets = new TradingAiDrawingSets(window.localStorage, storageSessionId, normalizeStoredAiDrawings);
  sets.upsert(patch, patch.drawingTurnId || patch.analysisId, patch.analysisId, drawings, patch.baseRevision);
  const next = sets.selectedDrawings(replaceTradingAiDrawingContext(stored, patch.marketId, patch.interval, drawings))
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
  getMagnetIndicatorSeries?: () => readonly TradingMagnetSeries[];
  getSymbol: () => string;
  getInterval: () => string;
  getCandles: () => DrawingCandle[];
  getVolumeCandles?: () => DrawingCandle[];
  volumeFutures?: () => boolean;
  loadVolumeHistory?: VolumeHistoryLoader;
  timeOffsetSeconds: number;
  storageSessionId: string;
  isNewTask?: () => boolean;
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
  private readonly horizontalLineSettings = new HorizontalLineSettingsDialog();
  private fibonacciSettingsPreview: TradingDrawingModel | null = null;
  private readonly labelMaskPrefix = `drawing-label-${crypto.randomUUID()}`;
  private horizontalLineTextEdit: {
    drawing: TradingDrawingModel;
    session: string;
    input: HTMLTextAreaElement;
    measure: CanvasRenderingContext2D | null;
    composing: boolean;
    cell?: TableCell;
  } | null = null;
  private readonly getChart: () => any;
  private readonly getCandleSeries: () => any;
  private readonly getMagnetIndicatorSeries: () => readonly TradingMagnetSeries[];
  private readonly getSymbol: () => string;
  private readonly getInterval: () => string;
  private readonly getCandles: TradingDrawingControllerOptions["getCandles"];
  private readonly getVolumeCandles: () => DrawingCandle[];
  private readonly volumeFutures: () => boolean;
  private readonly volumeHistory?: VolumeProfileHistory;
  private readonly volumeCalculations = new Map<string, ReturnType<typeof calculateFixedVolume>>();
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
  private aiDrawingClearVersion = 0;
  private readonly drawingVisibility: TradingDrawingVisibility;
  private manualSync: DesktopDrawingSync | null = null;
  private applyingManualSync = false;
  private drawings: TradingDrawingModel[] = [];
  private aiDrawings: TradingDrawingModel[] = [];
  private readonly aiDrawingSets: TradingAiDrawingSets<TradingDrawingModel>;
  private aiDrawingSetPlaying = false;
  private aiPlanAutoscale: TradingAiPlanAutoscale | null = null;
  private aiDrawingPlaybackVersion = 0;
  private readonly aiPlaybackDeletedTextIds = new Set<string>();
  private aiDraft: TradingDrawingModel | null = null;
  private aiDraftOpacity = 1;
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
  private activeTool: TradingDrawingToolId = "crosshair";
  private activeMenu: TradingDrawingGroupId | 'magnet' | 'visibility' | null = null;
  private activeSelectionMenu: TradingDrawingSelectionMenu | null = null;
  private draft: TradingDrawingModel | null = null;
  private draftConfirmedPointCount = 0;
  private draftRequiredPointCount = 0;
  private pendingTextDrawingId: string | null = null;
  private openPinNoteId: string | null = null;
  private selectedDrawingId: string | null = null;
  private readonly volumeProfileTimers = new Map<string, number>();
  private dismissedSelectionToolbarDrawingId: string | null = null;
  private dragState: DrawingDragState | null = null;
  private selectionToolbarPosition: ScreenPoint | null = null;
  private selectionToolbarDrag: SelectionToolbarDragState | null = null;
  private pointerId: number | null = null;
  private pointerStart: ScreenPoint | null = null;
  private dragRedrawFrame: number | null = null;
  private pendingPointerMoves: PointerEvent[] = [];
  private readonly pointerInteraction = {};
  private readonly manualLayer: TradingDrawingLayer;
  private readonly hoverText: TradingDrawingHoverText;
  private readonly aiAnnotationHover: TradingAiAnnotationHover;
  private projectionTimes: Map<number, number | null> | null = null;
  private readonly crosshair: TradingDrawingCrosshair;
  private selectionToolbarStyleKey = '';
  private selectionToolbarSize = { width: 326, height: 42 };
  private readonly selectionToolbarResizeObserver: ResizeObserver | null;
  private stayInDrawingMode = false;
  private magnetEnabled = false;
  private magnetMode: TradingMagnetMode = 'weak';
  private snapToIndicators = false;
  private magnetModifierHeld = false;
  private lastMagnetPointerEvent: PointerEvent | null = null;
  private drawingsLocked = false;
  private get drawingsHidden() { return this.drawingVisibility.aiHidden && this.drawingVisibility.manualHidden; }
  private userDrawingEnabled = true;
  private destroyed = false;
  private clearDialogTrigger: HTMLElement | null = null;
  private readonly lastToolByGroup = new Map<TradingDrawingGroupId, TradingDrawingToolId>(
    TRADING_DRAWING_GROUPS.map((group) => [group.id, group.defaultTool]),
  );
  // Keep manual preferences per tool so selecting a tool again starts with its
  // most recently used appearance instead of rebuilding the default style.
  private readonly drawingStyles = new Map<TradingDrawingToolId, TradingDrawingStyle>();
  private symbolGlyph = '🙂';
  private pendingImageReference = '';
  private pendingImageSelection: DrawingImageSelection | null = null;
  private readonly imageDialog = new DrawingImageDialog();
  private readonly xPostDialog = new TradingXPostDialog();
  private favoriteTools = new Set<TradingDrawingToolId>();
  private magicTrail: HTMLDivElement | null = null;
  private magicTrailTime = 0;

  constructor(options: TradingDrawingControllerOptions) {
    const magnet = readTradingMagnetPreferences();
    this.magnetEnabled = magnet.enabled;
    this.magnetMode = magnet.mode;
    this.snapToIndicators = magnet.snapToIndicators;
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem('haolo.drawing-favorites.v1') ?? '[]');
      if (Array.isArray(saved)) this.favoriteTools = new Set(saved.filter(id => tradingDrawingToolDefinition(id)));
    } catch { /* Ignore malformed preferences. */ }
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
    this.drawings = loadStoredDrawings(this.storageSessionId);
    this.aiDrawings = loadStoredAiDrawings(this.storageSessionId);
    this.aiDrawingSets = new TradingAiDrawingSets(window.localStorage, this.storageSessionId, normalizeStoredAiDrawings);
    this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
    for (const drawing of [...this.drawings].reverse()) {
      if (!this.drawingStyles.has(drawing.tool)) {
        this.drawingStyles.set(drawing.tool, tradingDrawingStyleFromModel(drawing));
      }
    }
    const orderLineContent = this.host.querySelector<SVGGElement>("[data-trading-order-lines]");
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
    this.orderLineContent = orderLineContent;
    this.orderPositionCardLayer = orderPositionCardLayer;
    this.content = content;
    this.manualLayer = new TradingDrawingLayer(content);
    this.hoverText = new TradingDrawingHoverText(this.overlay, content, () => this.userDrawingEnabled
      && !this.draft && !this.dragState && !this.horizontalLineSettings.open && !this.horizontalLineTextEdit
      && tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor');
    this.aiContent = aiContent;
    this.aiTextHitContent = aiTextHitContent;
    this.aiAnnotationHover = new TradingAiAnnotationHover(this.chartElement, aiTextHitContent,
      () => this.userDrawingEnabled && !this.drawingsHidden && !this.drawingVisibility.aiHidden
        && tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor',
      id => this.deleteAiTextDrawing(id));
    this.aiCursorContent = aiCursorContent;
    this.toolbar = toolbar;
    this.status = status;
    this.selectionToolbar = selectionToolbar;
    this.selectionToolbarResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      const size = entries[0]?.borderBoxSize?.[0];
      if (!size?.inlineSize || !size.blockSize || this.destroyed) return;
      this.selectionToolbarSize = { width: size.inlineSize, height: size.blockSize };
      this.positionSelectionToolbar(this.plotBounds());
    });
    this.selectionToolbarResizeObserver?.observe(selectionToolbar);
    this.aiTextSizeToolbar = aiTextSizeToolbar;
    this.axisMarkerLayer = axisMarkerLayer;
    this.clearDialog = clearDialog;
    this.getChart = options.getChart;
    this.getCandleSeries = options.getCandleSeries;
    this.getMagnetIndicatorSeries = options.getMagnetIndicatorSeries ?? (() => []);
    this.getSymbol = options.getSymbol;
    this.getInterval = options.getInterval;
    this.getCandles = options.getCandles;
    this.getVolumeCandles = options.getVolumeCandles ?? options.getCandles;
    this.volumeFutures = options.volumeFutures ?? (() => /:(FUTURES|USDM):/i.test(this.getSymbol()));
    if (options.loadVolumeHistory) this.volumeHistory = new VolumeProfileHistory(options.loadVolumeHistory, () => { if (!this.destroyed) this.redraw(); });
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
      setDraft: (drawing, opacity = 1) => {
        this.aiDraft = drawing ? this.aiDrawingModel(drawing) : null;
        this.aiDraftOpacity = opacity;
        this.redraw();
      },
      commit: (drawing) => {
        if (this.aiPlaybackDeletedTextIds.has(drawing.id)) return;
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
    this.host.dataset.drawingCursor = this.activeTool;
    this.crosshair = new TradingDrawingCrosshair(this.overlay, () => {
      const pane = this.getChart()?.panes()[this.paneIndex]?.getHTMLElement() as HTMLElement | null;
      // The middle table cell holds the plot; side cells hold price axes.
      // Resolve on each frame because indicator rebuilds can replace the pane.
      return pane?.children[1]?.querySelector<HTMLCanvasElement>('canvas:last-of-type') ?? null;
    });
    this.drawingVisibility = new TradingDrawingVisibility(this.storageSessionId, () => this.redraw());
    this.bindEvents();
    if (this.controlActive) this.updateToolbarState();
    this.redraw();
    this.manualSync = new DesktopDrawingSync({
      session: () => this.storageSessionId, symbol: this.getSymbol,
      isNewTask: options.isNewTask ?? (() => false),
      interval: this.getInterval, scope: this.drawingScope,
      snapshot: () => this.drawings.filter(d => d.id !== this.pendingTextDrawingId),
      busy: () => Boolean(this.draft || this.dragState || this.pendingTextDrawingId || this.horizontalLineSettings.open || this.horizontalLineTextEdit),
      status: message => this.setStatus(message),
      apply: (drawings, symbol, persist = true) => {
        if (this.destroyed) return;
        this.applyingManualSync = true;
        try {
          this.drawings = [...this.drawings.filter(d => d.symbol !== symbol || (d.drawingScope || 'main') !== this.drawingScope), ...drawings];
          if (!this.drawings.some(d => d.id === this.selectedDrawingId)) this.selectedDrawingId = null;
          if (persist) this.persistDrawings(false);
          // Initialization clears the surface before restoring its replica.
          // Do not feed that intermediate empty redraw back as a local snapshot.
          this.redraw(); this.updateToolbarState();
        } finally {
          this.applyingManualSync = false;
        }
      },
    });
  }

  sharedToolState(): TradingDrawingSharedToolState {
    const drawingStyles = Object.fromEntries(
      [...this.drawingStyles.entries()].map(([toolId, style]) => [toolId, { ...style }]),
    ) as Partial<Record<TradingDrawingToolId, TradingDrawingStyle>>;
    return {
      activeTool: this.activeTool,
      lastToolByGroup: Object.fromEntries(this.lastToolByGroup),
      stayInDrawingMode: this.stayInDrawingMode,
      magnetEnabled: this.magnetEnabled,
      magnetMode: this.magnetMode,
      snapToIndicators: this.snapToIndicators,
      drawingStyles,
      symbolGlyph: this.symbolGlyph,
      favoriteTools: [...this.favoriteTools],
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
    for (const group of TRADING_DRAWING_GROUPS) {
      const remembered = tradingDrawingToolDefinition(state.lastToolByGroup?.[group.id]);
      if (remembered && drawingMenuGroup(remembered.id) === group.id) {
        this.lastToolByGroup.set(group.id, remembered.id);
      }
    }
    this.lastToolByGroup.set(drawingMenuGroup(definition.id), definition.id);
    this.host.dataset.drawingCursor = definition.id;
    if (state.symbolGlyph) this.symbolGlyph = state.symbolGlyph;
    if (state.favoriteTools) this.favoriteTools = new Set(state.favoriteTools);
    if (state.drawingStyles && typeof state.drawingStyles === "object") {
      this.drawingStyles.clear();
      for (const candidate of TRADING_DRAWING_TOOLS) {
        if (!Object.prototype.hasOwnProperty.call(state.drawingStyles, candidate.id)) continue;
        this.drawingStyles.set(
          candidate.id,
          normalizeTradingDrawingStyle(state.drawingStyles[candidate.id], candidate.id),
        );
      }
    }
    this.stayInDrawingMode = state.stayInDrawingMode;
    this.magnetEnabled = state.magnetEnabled;
    this.magnetMode = state.magnetMode === 'strong' ? 'strong' : 'weak';
    this.snapToIndicators = state.snapToIndicators === true;
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
    if (!enabled) { this.imageDialog.close(); this.xPostDialog.close(); }
    if (this.bindControlEvents) {
      this.toolbar.toggleAttribute("inert", !enabled);
      this.toolbar.setAttribute("aria-hidden", String(!enabled));
    }
    if (enabled) {
      this.updateToolbarState();
      this.redraw();
      return;
    }
    this.closeToolMenus();
    this.hideAiTextSizeToolbar();
    this.closeSelectionMenus();
    this.cancelDraft();
    this.cancelSelectionDrag();
    this.releasePointer();
    this.selectDrawing(null);
    this.selectTool(this.lastToolByGroup.get("cursor") ?? "crosshair");
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
    this.imageDialog.close();
    this.xPostDialog.close();
    this.finishHorizontalLineTextEdit(false);
    this.horizontalLineSettings.close();
    const migrateFromSessionId = options.migrateFromSessionId
      ? normalizeTradingDrawingStorageSessionId(options.migrateFromSessionId)
      : "";
    const migrateCurrentDrawings = migrateFromSessionId === previousSessionId;

    this.aiPlayback.cancel();
    this.releasePointer();
    this.finishSelectionToolbarDrag();
    this.storageSessionId = nextSessionId;
    this.aiDrawingSets.switchSession(nextSessionId, migrateCurrentDrawings);
    if (migrateCurrentDrawings) {
      this.applyingManualSync = true;
      const manualPersisted = this.persistDrawings(false);
      this.applyingManualSync = false;
      const aiPersisted = this.persistAiDrawings(false);
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
      this.drawings = loadStoredDrawings(this.storageSessionId);
      this.aiDrawings = loadStoredAiDrawings(this.storageSessionId);
      this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
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
    this.overlay.classList.remove("dragging-drawing");
    this.closeSelectionMenus();
    this.drawingVisibility.switchSession(nextSessionId, migrateCurrentDrawings);
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
    this.overlay.addEventListener("click", this.handleHorizontalLineAddTextClick);
    this.overlay.addEventListener("keydown", this.handleHorizontalLineAddTextKeyDown);
    this.overlay.addEventListener("contextmenu", this.handleContextMenu);
    this.overlay.addEventListener("dblclick", this.handleDrawingDoubleClick);
    this.overlay.addEventListener("wheel", this.handleWheel, { passive: false });
    document.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("pointerup", this.handlePointerUp);
    document.addEventListener("pointercancel", this.handlePointerCancel);
    document.addEventListener('paste', this.handleDrawingImagePaste);
    this.overlay.addEventListener("lostpointercapture", this.handlePointerCancel);
    window.addEventListener("blur", this.cancelPointerInteraction);
    window.addEventListener(PLAN_DRAWING_HISTORY_CHANGED, this.handlePlanDrawingHistoryChanged);
    document.addEventListener("pointerdown", this.handleChartBackgroundPointerDown, true);
    document.addEventListener("pointerdown", this.handleToolMenuOutsidePointerDown, true);
    document.addEventListener("pointerdown", this.handleOutsidePointerDown);
    document.addEventListener("focusin", this.handleInlineTextFocusIn);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener('keydown', this.handleMagnetModifierChange, true);
    document.addEventListener('keyup', this.handleMagnetModifierChange, true);
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

  private readonly handleChartBackgroundPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element)) return;
    if (!this.chartElement.contains(target) && !this.overlay.contains(target)) return;
    if (target.closest('[data-drawing-id], [data-ai-annotation-delete], button, input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=toolbar]')) return;
    if (this.userDrawingEnabled
      && tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor') {
      const hidden = !this.drawingVisibility.manualHidden && this.drawingVisibility.latestHidden(this.drawings.filter(drawing =>
        tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)));
      if (hidden || this.drawingVisibility.aiHidden) this.onSurfaceFocus?.(this);
      if (this.drawingVisibility.aiHidden) {
        this.aiTextSizeToolbarVisibility.restore();
        this.updateAiTextSizeToolbar(this.plotBounds());
      }
      if (hidden) {
        this.selectDrawing(hidden.id);
        const point = this.eventScreenPoint(event);
        this.selectionToolbarPosition = { x: point.x, y: point.y + 18 };
        this.updateSelectionToolbar(this.plotBounds());
        return;
      }
    }
    if (!this.selectedDrawingId) return;
    const selected = this.selectedDrawing();
    if (selected && (isElliottWave(selected.tool) || isPredictionDrawing(selected.tool))) {
      this.selectDrawing(null);
      return;
    }
    // Navigation consumes chart presses in capture. Observe them beforehand
    // without consuming the event or interrupting the native pan gesture.
    this.dismissSelectionToolbar();
    this.overlay.classList.add('drawing-handles-idle');
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
      && !isHiddenOrderFlowAnnotation(drawing)
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

  private deleteAiTextDrawing(id: string) {
    const drawing = this.aiTextDrawing(id);
    if (!drawing) return;
    if (this.aiDrawingSetPlaying) this.aiPlaybackDeletedTextIds.add(id);
    this.aiDrawings = this.aiDrawings.filter(candidate => candidate !== drawing);
    this.persistAiDrawings();
    this.redraw();
    this.setStatus(translateDrawingText('AI 标注已删除'));
  }

  private showAiTextSizeToolbar(id: string) {
    if (
      !this.userDrawingEnabled
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
    if (action !== "decrease" && action !== "increase" && action !== "dismiss" && action !== "toggle-visibility" && action !== "next-drawing") return;
    event.preventDefault();
    this.onSurfaceFocus?.(this);
    if (action === "next-drawing") {
      const context = { marketId: this.getSymbol(), interval: this.getInterval() };
      if (this.aiDrawingSetPlaying) return;
      this.aiDrawingSets.updateSelected(this.aiDrawings);
      if (!this.aiDrawingSets.next(context)) return;
      this.aiTextSizeToolbarPosition = {
        x: parseFloat(this.aiTextSizeToolbar.style.left), y: parseFloat(this.aiTextSizeToolbar.style.top),
      };
      this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
      this.persistAiDrawings();
      this.redraw();
      return;
    }
    if (action === "toggle-visibility") {
      this.aiTextSizeToolbarPosition = {
        x: parseFloat(this.aiTextSizeToolbar.style.left), y: parseFloat(this.aiTextSizeToolbar.style.top),
      };
      this.drawingVisibility.toggleAi();
      this.setStatus(this.drawingVisibility.aiHidden ? "当前会话 AI 画线已隐藏" : "当前会话 AI 画线已显示");
      return;
    }
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
    if (action === 'screenshot') {
      this.closeToolMenus();
      void captureTradingChartToDesktop(this.toolbar);
      return;
    }
    if (action === 'toggle-favorite') {
      const id = target.dataset.favoriteTool as TradingDrawingToolId;
      if (this.favoriteTools.has(id)) this.favoriteTools.delete(id); else this.favoriteTools.add(id);
      try { window.localStorage.setItem('haolo.drawing-favorites.v1', JSON.stringify([...this.favoriteTools])); } catch { /* Preferences may be unavailable. */ }
      this.updateToolbarState();
      this.emitSharedToolState();
      return;
    }
    if (action === 'symbol-tab') {
      const tab = target.dataset.symbolTab as keyof typeof DRAWING_SYMBOLS;
      const grid = this.toolbar.querySelector<HTMLElement>('[data-drawing-symbol-grid]');
      if (grid && DRAWING_SYMBOLS[tab]) { grid.innerHTML = renderDrawingSymbolGrid(tab); grid.scrollTop = 0; }
      this.toolbar.querySelectorAll('[data-symbol-tab]').forEach(button => button.setAttribute('aria-selected', String((button as HTMLElement).dataset.symbolTab === tab)));
      return;
    }
    if (action === 'symbol-category') {
      const grid = this.toolbar.querySelector<HTMLElement>('[data-drawing-symbol-grid]');
      if (grid) {
        grid.innerHTML = renderDrawingSymbolGrid('emoji');
        const index = [0, 40, 48, 52, 56, 60, 64, 68][Number(target.dataset.symbolCategory)] ?? 0;
        (grid.children[index] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (action === 'select-symbol') {
      const glyph = target.dataset.symbolGlyph ?? '🙂';
      const sameGlyph = this.symbolGlyph === glyph;
      this.symbolGlyph = glyph;
      if (sameGlyph) this.toggleToolbarTool(target.dataset.symbolTool as TradingDrawingToolId);
      else this.selectTool(target.dataset.symbolTool as TradingDrawingToolId);
      this.closeToolMenus();
      return;
    }
    if (action === "select-tool") {
      if (target.dataset.drawingTool === 'image') { this.closeToolMenus(); this.pickDrawingImage(); return; }
      if (target.dataset.drawingTool === 'tweet') { this.closeToolMenus(); this.pickXPost(); return; }
      this.toggleToolbarTool(target.dataset.drawingTool as TradingDrawingToolId);
      this.closeToolMenus();
      return;
    }
    if (action === "select-group-tool") {
      const group = target.dataset.drawingGroupId as TradingDrawingGroupId;
      if (group === 'icons' && (this.activeTool !== target.dataset.drawingTool || this.getNavigation?.()?.getTool())) {
        this.toggleToolMenu(group, target); return;
      }
      this.toggleToolbarTool(target.dataset.drawingTool as TradingDrawingToolId);
      this.closeToolMenus();
      return;
    }
    if (action === "toggle-tool-menu") {
      this.toggleToolMenu(target.dataset.drawingGroupId as TradingDrawingGroupId | 'magnet' | 'visibility', target);
      return;
    }
    if (action === 'toggle-layer-visibility') {
      const layer = TRADING_VISIBILITY_LAYERS.find(({ key }) => key === target.dataset.drawingVisibilityLayer);
      if (layer) this.drawingVisibility.setLayers({ [layer.key]: !this.drawingVisibility.layers()[layer.key] });
      return;
    }
    if (action === "measure" || action === "zoom-in") {
      const navigation = this.getNavigation?.();
      const tool = action === "measure" ? "measure" : "zoom";
      const selected = navigation?.getTool() === tool;
      this.selectTool(this.toolbarCursorTool());
      if (!selected) navigation?.setTool(tool);
      this.closeToolMenus();
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
      this.saveMagnetPreferences();
      this.emitSharedToolState();
    } else if (action === 'set-magnet-mode') {
      const mode = target.dataset.magnetMode === 'strong' ? 'strong' : 'weak';
      this.magnetEnabled = !this.magnetEnabled || this.magnetMode !== mode;
      this.magnetMode = mode;
      this.saveMagnetPreferences();
      this.closeToolMenus();
      this.setStatus(this.magnetEnabled ? this.magnetMode === 'strong' ? '强磁铁' : '弱磁铁' : '磁吸已关闭');
      this.emitSharedToolState();
    } else if (action === 'toggle-magnet-indicators') {
      this.snapToIndicators = !this.snapToIndicators;
      this.saveMagnetPreferences();
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
      const hidden = !(this.drawingVisibility.aiHidden && this.drawingVisibility.plansHidden);
      this.drawingVisibility.setLayers({ aiHidden: hidden, plansHidden: hidden });
      this.setStatus(hidden ? "AI 绘图和计划线已隐藏" : "AI 绘图和计划线已显示");
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
    if (this.manualSync?.automatic) {
      if (title) title.textContent = drawingSyncText('clearTitle');
      if (description) description.textContent = drawingSyncText('clearDescription');
    }
    if (!this.clearDialog.open) this.clearDialog.showModal();
    window.requestAnimationFrame(() => {
      this.clearDialog.querySelector<HTMLButtonElement>('[data-drawing-clear-action="cancel"]')?.focus();
    });
  }

  private readonly handleSelectionToolbarPointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0 || this.selectionToolbarDrag) return;
    // Formatting buttons must not blur the editor before their click runs.
    // Editable controls keep their native focus behavior.
    if (this.horizontalLineTextEdit && event.target instanceof Element
      && !event.target.closest('input, textarea, select, [contenteditable=true]')) event.preventDefault();
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
    }, 12);
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
    if (action === "hide-toolbar") {
      this.dismissSelectionToolbar();
      return;
    }
    if (action === "toggle-visibility") {
      this.finishHorizontalLineTextEdit(true);
      this.closeSelectionMenus();
      this.drawingVisibility.toggle(drawing);
      this.setStatus(this.drawingVisibility.isHidden(drawing) ? "画线已隐藏，点击画布可恢复" : "画线已显示");
      return;
    }
    if (action === "settings") {
      this.openHorizontalLineSettings(drawing, target);
      return;
    }
    if (action === 'pattern-label' && (isReferencePatternDrawing(drawing.tool) || isRangeDrawing(drawing.tool))) {
      this.openHorizontalLineSettings(drawing, target, 'text');
      return;
    }
    if (action === 'pattern-fill' && (isReferencePatternDrawing(drawing.tool) || drawing.tool === 'time-cycles' || drawing.tool === 'sector' || isRangeDrawing(drawing.tool))) {
      this.closeSelectionMenus();
      openColorPicker({ anchor: target, value: isRangeDrawing(drawing.tool) ? rangeFillColor(drawing) : drawing.tool === 'sector' ? drawing.textBackgroundColor ?? '#9c6ade33' : drawing.tool === 'time-cycles' ? cycleFillColor(drawing) : harmonicFillColor(drawing),
        onChange: color => {
          if (this.selectedDrawingId !== drawing.id) return;
          drawing.textBackgroundColor = color;
          this.persistDrawingEdit('已更新颜色', false);
        },
      });
      return;
    }
    if (['toggle-color', 'toggle-text-color', 'toggle-text-background'].includes(action)) {
      const background = action === 'toggle-text-background';
      const field = background ? 'textBackgroundColor' : action === 'toggle-text-color' && !isPlainTextDrawing(drawing) && (isInlineAnnotation(drawing) || isManualPriceNote(drawing)) ? 'textColor' : 'color';
      const menuName = background ? 'text-background' : action === 'toggle-text-color' ? 'text-color' : 'color';
      const wasOpen = this.activeSelectionMenu === menuName;
      this.closeSelectionMenus();
      if (wasOpen) return;
      this.activeSelectionMenu = menuName;
      openColorPicker({ anchor: target,
        value: drawing[field] ?? (background ? '#ffffff00' : manualDrawingDefaults(drawing.tool).color),
        onChange: color => {
          if (this.selectedDrawingId !== drawing.id) return;
          drawing[field] = color;
          this.persistDrawingEdit('已更新颜色', false);
        },
        onClose: () => { this.activeSelectionMenu = null; },
      });
      return;
    }
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
      if (isReferencePatternDrawing(drawing.tool) || isElliottWave(drawing.tool) || isRangeDrawing(drawing.tool)) {
        delete drawing.textBackgroundColor;
        delete drawing.textColor;
        delete drawing.fontSize;
        delete drawing.bold;
        delete drawing.italic;
      }
      if (drawing.tool === 'fib-retracement' || isFibonacciProjection(drawing.tool)) delete drawing.fibonacci;
      if (drawing.tool === 'anchored-vwap') delete drawing.vwap;
      if (isVolumeProfile(drawing.tool)) delete drawing.volumeProfile;
      delete drawing.color;
      delete drawing.lineStyle;
      delete drawing.lineWidth;
      if (drawing.tool === 'regression-trend' && drawing.regression) {
        const { source, upperDeviation, lowerDeviation, useUpperDeviation, useLowerDeviation } = drawing.regression;
        drawing.regression = normalizeRegressionTrendOptions({ source, upperDeviation, lowerDeviation, useUpperDeviation, useLowerDeviation });
      }
      this.persistDrawingEdit("已恢复默认样式");
      return;
    }
    if (action === "reset-text") {
      delete drawing.color;
      delete drawing.textBackgroundColor;
      delete drawing.fontSize;
      delete drawing.bold;
      if (isInlineAnnotation(drawing) || isManualPriceNote(drawing)) delete drawing.textColor;
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
      if (color) {
        if (!isPlainTextDrawing(drawing) && (isInlineAnnotation(drawing) || isManualPriceNote(drawing))) drawing.textColor = color;
        else drawing.color = color;
      }
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
      this.finishHorizontalLineTextEdit(true);
      if (!this.drawings.includes(drawing)) return;
      drawing.locked = !drawing.locked;
      this.persistDrawingEdit(drawing.locked ? "绘图已锁定" : "绘图已解锁", false);
      return;
    }
    if (action === "delete") this.deleteSelectedDrawing();
  };

  private readonly handleToolMenuOutsidePointerDown = (event: PointerEvent) => {
    if (this.horizontalLineTextEdit && event.target instanceof Node && !this.isInlineTextEditTarget(event.target)) {
      this.finishHorizontalLineTextEdit(true);
    }
    if (this.openPinNoteId && event.target instanceof Element
      && !this.isInlineTextEditTarget(event.target)
      && event.target.closest<SVGElement>('[data-drawing-id]')?.dataset.drawingId !== this.openPinNoteId) {
      this.finishHorizontalLineTextEdit(true);
      this.openPinNoteId = null;
      this.redraw();
    }
    // Chart navigation can stop propagation before the document bubble phase.
    // Only dismiss the tool menu here; keep selection and text edits on their existing path.
    if (this.activeMenu && event.target instanceof Node && !this.toolbar.contains(event.target)) {
      this.closeToolMenus();
    }
  };

  private readonly handleOutsidePointerDown = (event: Event) => {
    if (!(event.target instanceof Node)) return;
    if (this.isInlineTextEditTarget(event.target)) return;
    this.finishHorizontalLineTextEdit(true);
    if (this.horizontalLineSettings.open) return;
    if (this.selectedDrawing() && this.drawingVisibility.isHidden(this.selectedDrawing()!)
      && this.chartElement.contains(event.target)) return;
    if (this.activeSelectionMenu) this.closeSelectionMenus();
    if (this.selectedDrawingId && !this.overlay.contains(event.target)) this.selectDrawing(null);
  };

  private saveMagnetPreferences() {
    writeTradingMagnetPreferences({ enabled: this.magnetEnabled, mode: this.magnetMode, snapToIndicators: this.snapToIndicators });
  }

  private rememberMagnetPointer(event: PointerEvent) {
    this.lastMagnetPointerEvent = event;
    const held = event.ctrlKey || event.metaKey;
    if (held !== this.magnetModifierHeld) {
      this.magnetModifierHeld = held;
      this.updateToolbarState();
    }
  }

  private readonly handleMagnetModifierChange = (event: KeyboardEvent) => {
    if (!['Control', 'Meta'].includes(event.key)) return;
    const held = (event.ctrlKey || event.metaKey) && !(event.target instanceof Element
      && event.target.closest('input, textarea, select, [contenteditable=true], [role=dialog], dialog'));
    if (held === this.magnetModifierHeld) return;
    this.flushPointerMoves();
    this.magnetModifierHeld = held;
    this.updateToolbarState();
    const last = this.lastMagnetPointerEvent;
    // Switching Ctrl/Command must update a stationary preview/handle as well.
    // Do not append extra freehand samples just because a key was pressed.
    if (last && this.controlActive && this.userDrawingEnabled && (this.dragState || this.draft)
      && !tradingDrawingToolDefinition(this.draft?.tool)?.freehand) {
      this.applyPointerMove(new PointerEvent('pointermove', {
        pointerId: last.pointerId, clientX: last.clientX, clientY: last.clientY,
        ctrlKey: held && event.ctrlKey, metaKey: held && event.metaKey, shiftKey: event.shiftKey,
      }));
      this.redraw();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.controlActive || !this.userDrawingEnabled || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
    if (this.clearDialog.open || this.horizontalLineSettings.open) return;
    if (this.activeMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const menu = this.toolbar.querySelector<HTMLElement>(`[data-drawing-tool-menu="${this.activeMenu}"]`);
      const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"], [role="menuitemcheckbox"]') ?? []);
      if (items.length) {
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault(); items[index].focus(); items[index].scrollIntoView({ block: 'nearest' }); return;
      }
    }
    if (event.key === "Escape") {
      if (this.activeMenu) {
        const trigger = this.toolbar.querySelector<HTMLButtonElement>(`[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="${this.activeMenu}"]`);
        this.closeToolMenus();
        trigger?.focus();
      }
      else if (this.activeSelectionMenu === "text-input") this.closeTextInput();
      else if (this.activeSelectionMenu) this.closeSelectionMenus();
      else if (this.dragState) this.cancelSelectionDrag();
      else if (this.draft && tradingDrawingIsMultiPoint(this.draft.tool)) this.finishMultiPointDrawing();
      else if (this.draft) this.cancelDraft();
      else if (this.selectedDrawingId) this.selectDrawing(null);
      else this.selectTool(this.lastToolByGroup.get("cursor") ?? "crosshair");
      return;
    }
    if (event.key === 'Enter' && this.draft && (tradingDrawingIsMultiPoint(this.draft.tool) || this.draft.tool === 'ghost-feed')) {
      event.preventDefault();
      this.finishMultiPointDrawing();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.selectedDrawingId
      && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.deleteSelectedDrawing();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const shortcutTool = event.shiftKey
        ? event.key.toLowerCase() === 'r' ? 'rectangle' : undefined
        : ({ t: "trend-line", f: "fib-retracement", h: "horizontal-line", j: "horizontal-ray", v: "vertical-line", c: "cross-line", x: "text" } as const)[event.key.toLowerCase()];
      if (shortcutTool && event.target instanceof Element && (event.target.closest(".trading-chart-navigable") || event.target.closest('[data-drawing-toolbar]'))) {
        event.preventDefault(); this.closeToolMenus(); this.selectTool(shortcutTool); return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.shiftKey || event.key.toLowerCase() === "y") this.redo();
      else this.undo();
      this.updateToolbarState();
    }
  };

  private readonly handleDrawingImagePaste = (event: ClipboardEvent) => {
    if (!this.controlActive || !this.userDrawingEnabled || this.imageDialog.open || event.defaultPrevented) return;
    if (!(event.target instanceof Element) || !this.host.contains(event.target)
      || event.target.closest('input, textarea, [contenteditable=true], [role=dialog], dialog')) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault(); this.pickDrawingImage(undefined, file);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.flushPointerMoves();
    this.onSurfaceFocus?.(this);
    this.rememberMagnetPointer(event);
    if (this.orderPositionTrigger(event.target)) {
      event.stopPropagation();
      return;
    }
    if (!this.userDrawingEnabled) return;
    if (event.button !== 0 || this.pointerId !== null) return;
    if (event.target instanceof Element && event.target.closest('[data-x-post-link]')) { event.preventDefault(); event.stopPropagation(); return; }
    // The inline text action owns the click; it must never start a line drag.
    if (event.target instanceof Element && event.target.closest('[data-horizontal-line-add-text], [data-horizontal-line-edit-text]')
      && tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.finishHorizontalLineTextEdit(true);
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
        && (parsedHandleIndex < drawing.points.length
          || drawing.tool === 'rotated-rectangle' && parsedHandleIndex <= 5
          || tradingDrawingIsShapedChannel(drawing.tool) && drawing.points.length === 3 && parsedHandleIndex === 3
          || (drawing.tool === 'gann-box' || isAnnotationTable(drawing) || drawing.tool === 'image') && drawing.points.length === 2 && parsedHandleIndex <= 3)
        ? parsedHandleIndex
        : -1;
      const handleScreenPoint = handleIndex >= 0
        ? drawing.tool === 'rotated-rectangle'
          ? this.rotatedRectangleGeometry(drawing)?.handles[handleIndex] ?? null
          : this.drawingPointToScreen(drawing, handleIndex, this.plotBounds())
        : null;
      const startPoint = (drawing.tool === 'rotated-rectangle' || (drawing.tool === 'gann-box' || isAnnotationTable(drawing) || drawing.tool === 'image') && handleIndex >= 2) && handleScreenPoint
        ? this.screenToDrawingPoint(handleScreenPoint, false)
        : handleIndex >= 0
        ? { ...(tradingDrawingIsShapedChannel(drawing.tool) ? tradingDrawingShapedChannelHandlePoint(drawing.tool, drawing.points, handleIndex) : drawing.points[handleIndex]) }
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
        magnetAnchorIndex: drawing.points.reduce((nearest, point, index, points) => {
          const a = this.pointToScreen(point), b = this.pointToScreen(points[nearest]);
          return a && (!b || Math.hypot(a.x - screenPoint.x, a.y - screenPoint.y) < Math.hypot(b.x - screenPoint.x, b.y - screenPoint.y)) ? index : nearest;
        }, 0),
        originalViewportAnchor: drawing.viewportAnchor ? { ...drawing.viewportAnchor } : undefined,
      };
      this.overlay.classList.add("dragging-drawing");
      this.capturePointer(event.pointerId);
      this.redraw();
      return;
    }
    if (this.draft && this.hasPendingDraftPoint()) {
      const drawingPoint = this.eventDrawingPoint(screenPoint, this.draft, this.draftConfirmedPointCount);
      if (!drawingPoint) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.draft.tool === 'multi-point-polyline' && this.draftConfirmedPointCount >= 3) {
        const first = this.pointToScreen(this.draft.points[0]);
        if (first && Math.hypot(screenPoint.x - first.x, screenPoint.y - first.y) <= 6) {
          this.finishMultiPointDrawing(true);
          return;
        }
      }
      const referenceIndex = Math.max(this.draftConfirmedPointCount - 1, 0);
      const previewIndex = this.draftConfirmedPointCount;
      const referenceScreen = this.pointToScreen(this.draft.points[referenceIndex]);
      this.draft.points[previewIndex] = drawingPoint;
      const baselineStart = this.draft.tool === 'parallel-channel' && previewIndex === 2
        ? this.pointToScreen(this.draft.points[0]) : null;
      const widthEnd = baselineStart && referenceScreen
        ? tradingDrawingChannelPoints(baselineStart, referenceScreen, this.pointToScreen(drawingPoint) ?? screenPoint)[2] : null;
      let placementDistance = referenceScreen
        ? Math.hypot((widthEnd ?? screenPoint).x - referenceScreen.x, (widthEnd ?? screenPoint).y - referenceScreen.y)
        : Infinity;
      if (this.draft.tool === 'rotated-rectangle' && previewIndex === 2) {
        placementDistance = this.rotatedRectangleGeometry(this.draft)?.halfWidth ?? 0;
      }
      if ((this.draft.tool === 'fib-time-zone' || isCycleDrawing(this.draft.tool)) && referenceScreen) {
        placementDistance = Math.abs((this.pointToScreen(drawingPoint) ?? screenPoint).x - referenceScreen.x);
      }
      if (tradingDrawingIsShapedChannel(this.draft.tool) && referenceScreen) {
        const start = this.pointToScreen(this.draft.points[0])!;
        const end = this.pointToScreen(drawingPoint) ?? screenPoint;
        // A horizontal primary line needs a nonzero height. An angled line
        // may meet the flat edge at either end (a valid triangle).
        placementDistance = previewIndex === 1 ? Math.abs(end.x - start.x)
          : Math.max(Math.abs(end.y - start.y), Math.abs(end.y - referenceScreen.y));
      }
      if (placementDistance >= 3) {
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
      this.beginTextDrawing(definition.id, drawingPoint, screenPoint, definition.id === 'image' ? this.pendingImageReference : '');
      if (!this.stayInDrawingMode) this.pendingImageReference = '';
      return;
    }
    this.pointerId = event.pointerId;
    this.pointerStart = screenPoint;
    const requiredPointCount = tradingDrawingIsMultiPoint(definition.id) ? 4000 : tradingDrawingRequiredPointCount(definition);
    this.draft = {
      id: crypto.randomUUID(),
      symbol: this.getSymbol(),
      interval: this.getInterval(),
      drawingScope: this.drawingScope,
      tool: definition.id,
      points: requiredPointCount > 1 ? [drawingPoint, drawingPoint] : [drawingPoint],
      text: definition.id === "price-note" ? formatTradingDrawingAxisPrice(drawingPoint.price)
        : definition.group === 'icons' ? this.symbolGlyph : undefined,
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
    this.flushPointerMoves();
    event.preventDefault();
    event.stopPropagation();
    this.onSurfaceFocus?.(this);
    const definition = tradingDrawingToolDefinition(this.draft.tool);
    const cancelledPointNumber = this.draftConfirmedPointCount;
    if (cancelledPointNumber <= 1) {
      // Cancel the tool only after its last confirmed point is removed,
      // including when stay-in-drawing mode is enabled.
      this.selectTool(this.lastToolByGroup.get("cursor") ?? "crosshair");
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
    this.updateMagicCursor(event);
    const followingMultiClickDraft = Boolean(
      this.draft
      && this.hasPendingDraftPoint()
      && this.pointerId === null,
    );
    if (!followingMultiClickDraft && event.pointerId !== this.pointerId) return;
    if (!this.draft && !this.dragState) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.draft && tradingDrawingToolDefinition(this.draft.tool)?.freehand) {
      const samples = event.getCoalescedEvents?.() ?? [];
      this.pendingPointerMoves.push(...(samples.length ? samples : [event]));
    } else this.pendingPointerMoves = [event];
    this.queueDragRedraw();
  };

  private flushPointerMoves() {
    if (!this.pendingPointerMoves.length) return;
    const events = this.pendingPointerMoves;
    this.pendingPointerMoves = [];
    // Read once before writing this frame's SVG, even for a 1000 Hz pen/mouse.
    const rect = this.chartElement.getBoundingClientRect();
    const bounds = this.plotBounds();
    for (const event of events) this.applyPointerMove(event, {
      x: Math.min(Math.max(event.clientX - rect.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), bounds.height),
    });
  }

  private applyPointerMove(event: PointerEvent, screenPoint = this.eventScreenPoint(event)) {
    this.rememberMagnetPointer(event);
    if (this.dragState && this.pointerStart && Math.hypot(screenPoint.x - this.pointerStart.x, screenPoint.y - this.pointerStart.y) < 3) {
      const drawing = this.drawings.find(candidate => candidate.id === this.dragState?.drawingId);
      if (drawing && !drawing.locked) {
        drawing.points = this.dragState.originalPoints.map(point => ({ ...point }));
        if (this.dragState.originalViewportAnchor) drawing.viewportAnchor = { ...this.dragState.originalViewportAnchor };
      }
      // Merely selecting a drawing/handle must never move it to a price.
      return;
    }
    const constrainedDrawing = this.dragState?.mode === 'handle' ? this.drawings.find(d => d.id === this.dragState?.drawingId) : this.draft;
    if (event.shiftKey && constrainedDrawing?.tool === 'gann-square') {
      const index=this.dragState?.mode === 'handle'?this.dragState.handleIndex:1;
      const original=this.dragState?.originalPoints??constrainedDrawing.points;
      const a=this.pointToScreen(original[0]),b=this.pointToScreen(original[1]),anchor=this.pointToScreen(constrainedDrawing.points[1-index]);
      if(a&&b&&anchor&&Math.abs(b.x-a.x)>1e-6&&Math.abs(b.y-a.y)>1e-6){
        const ratio=Math.abs((b.y-a.y)/(b.x-a.x)),dx=screenPoint.x-anchor.x,dy=screenPoint.y-anchor.y;
        screenPoint=Math.abs(dx)*ratio>=Math.abs(dy)?{x:screenPoint.x,y:anchor.y+(dy<0?-1:1)*Math.abs(dx)*ratio}:{x:anchor.x+(dx<0?-1:1)*Math.abs(dy)/ratio,y:screenPoint.y};
      }
    }
    if (event.shiftKey && constrainedDrawing?.tool === 'fib-circles') {
      const index = this.dragState?.mode === 'handle' ? this.dragState.handleIndex : 1;
      const opposite = this.pointToScreen(constrainedDrawing.points[1-index]);
      if (opposite) {
        const size = Math.max(Math.abs(screenPoint.x-opposite.x),Math.abs(screenPoint.y-opposite.y));
        screenPoint = {x:opposite.x+(screenPoint.x<opposite.x?-1:1)*size,y:opposite.y+(screenPoint.y<opposite.y?-1:1)*size};
      }
    }
    if (event.shiftKey && this.dragState?.mode === "drawing" && this.pointerStart) {
      if (Math.abs(screenPoint.x - this.pointerStart.x) >= Math.abs(screenPoint.y - this.pointerStart.y)) screenPoint.y = this.pointerStart.y;
      else screenPoint.x = this.pointerStart.x;
    }
    if (this.dragState) {
      const drawing = this.drawings.find((candidate) => candidate.id === this.dragState?.drawingId);
      if (!drawing || drawing.locked) return;
      if (["anchored-text", "anchored-note"].includes(drawing.tool) && this.dragState.originalViewportAnchor && this.pointerStart) {
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
        }, drawing, this.dragState.handleIndex);
        if (point && drawing.tool === 'rotated-rectangle') {
          const original = this.dragState.originalPoints.map(p => this.pointToScreen(p));
          const pointer = this.pointToScreen(point);
          if (pointer && original.every((p): p is ScreenPoint => p !== null)) {
            const next = moveRotatedRectangleHandle(original, this.dragState.handleIndex, pointer).map(p => this.screenToDrawingPoint(p, false));
            if (next.every((p): p is TradingDrawingPoint => p !== null)) drawing.points = next;
          }
        } else if (point && (drawing.tool === 'gann-box' || isAnnotationTable(drawing) || drawing.tool === 'image') && this.dragState.handleIndex >= 2) {
          const i=this.dragState.handleIndex;
          drawing.points = i===2 ? [{...drawing.points[0],price:point.price},{...drawing.points[1],time:point.time}]
            : [{...drawing.points[0],time:point.time},{...drawing.points[1],price:point.price}];
        } else if (point && isPositionDrawing(drawing.tool)) {
          drawing.points = movePositionAnchor(drawing, this.dragState.handleIndex, point);
        } else if (point && isCycleDrawing(drawing.tool)) {
          drawing.points = moveCycleAnchor(drawing.tool, drawing.points, this.dragState.handleIndex, point);
        } else if (point && tradingDrawingIsShapedChannel(drawing.tool)) {
          drawing.points = tradingDrawingMoveShapedChannelHandle(drawing.tool, drawing.points, this.dragState.handleIndex, point);
        } else if (point && this.dragState.handleIndex >= 0 && this.dragState.handleIndex < drawing.points.length) {
          if (drawing.tool === 'regression-trend' && point.time === drawing.points[1 - this.dragState.handleIndex]?.time) return;
          const closed = tradingDrawingIsClosedPolyline(drawing);
          drawing.points[this.dragState.handleIndex] = point;
          this.normalizeWedgeAnchors(drawing);
          if (closed && this.dragState.handleIndex === 0) drawing.points[drawing.points.length - 1] = { ...point };
        }
      } else {
        const currentPoint = this.screenToDrawingPoint(screenPoint, false);
        if (!currentPoint) return;
        const deltaTime = currentPoint.time - this.dragState.startPoint.time;
        const deltaPrice = currentPoint.price - this.dragState.startPoint.price;
        if (drawing.tool === 'regression-trend' || isVolumeDrawing(drawing.tool)) {
          const candles = this.getCandles();
          const original = this.dragState.originalPoints.map(p => regressionBarIndex(candles, p.time));
          const from = tradingDrawingLogicalIndexAtTime(candles, this.dragState.startPoint.time);
          const to = tradingDrawingLogicalIndexAtTime(candles, currentPoint.time);
          if (from !== null && to !== null && original.every(i => i >= 0)) {
            const shift = Math.max(-Math.min(...original), Math.min(candles.length - 1 - Math.max(...original), Math.round(to - from)));
            drawing.points = this.dragState.originalPoints.map((p, i) => ({ ...p, time: candles[original[i] + shift].time }));
          }
        } else if ((drawing.tool === 'rotated-rectangle' || isFibonacciProjection(drawing.tool) || isCycleDrawing(drawing.tool) || isElliottWave(drawing.tool) || isPredictionDrawing(drawing.tool) || isRangeDrawing(drawing.tool)) && this.pointerStart) {
          const original = { ...drawing, points: this.dragState.originalPoints };
          const bounds = this.plotBounds();
          let dx = screenPoint.x - this.pointerStart.x;
          const dy = screenPoint.y - this.pointerStart.y;
          if (isCycleDrawing(drawing.tool) || isElliottWave(drawing.tool) || isPredictionDrawing(drawing.tool) || isRangeDrawing(drawing.tool)) {
            const from = this.screenToDrawingPoint(this.pointerStart, false);
            const to = this.screenToDrawingPoint(screenPoint, false);
            const candles = this.getCandles();
            const i = from && tradingDrawingLogicalIndexAtTime(candles, from.time);
            const j = to && tradingDrawingLogicalIndexAtTime(candles, to.time);
            if (i != null && j != null && Math.abs(j - i) > 1e-6) dx *= Math.round(j - i) / (j - i);
          }
          // Translate visible geometry consistently, including on logarithmic axes.
          drawing.points = original.points.map((point, index) => {
            const screen = this.drawingPointToScreen(original, index, bounds);
            const moved = screen ? this.screenToDrawingPoint({ x: screen.x + dx, y: screen.y + dy }, false) ?? point : point;
            if (isPositionDrawing(drawing.tool)) {
              const tick = normalizePositionOptions(drawing.position).tickSize;
              return { ...moved, price: Math.round(moved.price / tick) * tick };
            }
            if (isRangeDrawing(drawing.tool)) {
              const tick = this.getCandleSeries()?.options?.().priceFormat?.minMove;
              if (typeof tick === 'number' && tick > 0) return { ...moved, price: Math.round(moved.price / tick) * tick };
            }
            return moved;
          });
        } else drawing.points = this.dragState.originalPoints.map((point) => ({
          time: point.time + deltaTime,
          price: point.price + deltaPrice,
        }));
        if (drawing.tool !== 'regression-trend' && !isVolumeDrawing(drawing.tool)) this.snapMovedDrawing(drawing);
      }
      return;
    }
    if (!this.draft) return;
    const point = this.eventDrawingPoint(screenPoint, this.draft, this.draftConfirmedPointCount);
    if (!point) return;
    const definition = tradingDrawingToolDefinition(this.draft.tool);
    if (definition?.freehand) {
      const previous = this.draft.points[this.draft.points.length - 1];
      const previousScreen = this.pointToScreen(previous);
      const distance = previousScreen ? Math.hypot(screenPoint.x - previousScreen.x, screenPoint.y - previousScreen.y) : Infinity;
      if (distance >= 2 || (event.type === 'pointerup' && distance > 0)) {
        this.draft.points.push(point);
      }
    } else {
      this.draft.points[this.draft.points.length - 1] = point;
    }
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.flushPointerMoves();
    // Pointerup can carry a newer position than the final delivered move.
    this.applyPointerMove(event);
    if (this.dragState) {
      const mode = this.dragState.mode;
      const moved = this.drawings.find(d => d.id === this.dragState?.drawingId);
      const end = this.eventScreenPoint(event);
      const editText = moved && isInlineAnnotation(moved) && mode === 'drawing' && this.pointerStart
        && Math.hypot(end.x - this.pointerStart.x, end.y - this.pointerStart.y) < 3;
      if (editText) {
        moved.points = this.dragState.originalPoints;
        this.dragState = null;
        this.releasePointer();
        this.overlay.classList.remove('dragging-drawing');
        const points = moved.points.map((_point, index) => this.drawingPointToScreen(moved, index, this.plotBounds())).filter((point): point is ScreenPoint => Boolean(point));
        this.beginInlineTextEdit(moved, isAnnotationTable(moved) ? annotationTableCellAt(moved, points, end) : undefined);
        return;
      }
      if (moved?.tool === 'regression-trend') {
        const fit = calculateRegressionTrend(this.getCandles(), moved.points, moved.regression);
        moved.points = fit?.anchors ?? this.dragState.originalPoints;
      }
      if (moved && isVolumeDrawing(moved.tool)) {
        const changed = moved.points.some((p, i) => p.time !== this.dragState!.originalPoints[i]?.time);
        moved.points = this.volumeAnchors(moved);
        if (changed && isVolumeProfile(moved.tool)) this.scheduleVolumeProfile(moved.id);
      }
      this.dragState = null;
      this.redoStack = [];
      this.persistDrawings();
      this.releasePointer();
      this.showDrawingHandles();
      this.overlay.classList.remove("dragging-drawing");
      this.redraw();
      this.setStatus(mode === "handle" ? "已调整端点" : "已移动绘图");
      return;
    }
    if (!this.draft) return;
    if (this.hasPendingDraftPoint()) {
      if ((['note', 'price-note', 'callout'].includes(this.draft.tool) || this.draft.tool === 'regression-trend' || this.draft.tool === 'fixed-range-volume' || isRangeDrawing(this.draft.tool) || isPredictionDrawing(this.draft.tool) && this.draftRequiredPointCount === 2) && this.pointerStart
        && (['note', 'price-note', 'callout'].includes(this.draft.tool) || isRangeDrawing(this.draft.tool)
          ? Math.hypot(this.eventScreenPoint(event).x - this.pointerStart.x, this.eventScreenPoint(event).y - this.pointerStart.y)
          : Math.abs(this.eventScreenPoint(event).x - this.pointerStart.x)) >= 3) {
        this.commitDraft();
        return;
      }
      // Also allow press-drag-release to confirm the baseline before the
      // pointer starts adjusting width, alongside the usual two clicks.
      if ((this.draft.tool === 'parallel-channel' || this.draft.tool === 'rotated-rectangle' || tradingDrawingIsShapedChannel(this.draft.tool) || isTradingPitchfork(this.draft.tool) || isThreePointFibonacci(this.draft.tool)) && this.draftConfirmedPointCount === 1 && this.pointerStart) {
        const end = this.eventScreenPoint(event);
        const distance = tradingDrawingIsShapedChannel(this.draft.tool) ? Math.abs(end.x - this.pointerStart.x)
          : Math.hypot(end.x - this.pointerStart.x, end.y - this.pointerStart.y);
        if (distance >= 3) {
          const progress = tradingDrawingAdvanceDraftPoints(this.draft.points, 1, 3, this.draft.points[1]);
          this.draft.points = progress.points;
          this.draftConfirmedPointCount = progress.confirmedPointCount;
        }
      }
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

  private readonly cancelPointerInteraction = () => {
    this.magnetModifierHeld = false;
    this.lastMagnetPointerEvent = null;
    this.updateToolbarState();
    this.finishSelectionToolbarDrag();
    if (this.dragState) this.cancelSelectionDrag();
    else if (this.draft) this.cancelDraft();
    else this.releasePointer();
  };

  private readonly handleDrawingDoubleClick = (event: MouseEvent) => {
    if (!this.userDrawingEnabled) return;
    if (this.horizontalLineTextEdit) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!this.draft) {
      // Drag capture retargets Chromium's dblclick to the SVG root. Resolve the
      // actual hit after pointerup instead of treating that root as blank space.
      const target = (event.target instanceof Element ? event.target.closest<SVGElement>('[data-drawing-id]') : null)
        ?? document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>('[data-drawing-id]');
      if (!target || !this.overlay.contains(target)) return;
      const drawing = this.drawings.find(item => item.id === target?.dataset.drawingId);
      if (!drawing) return;
      if (isManualPriceNote(drawing)) return;
      if (drawing.tool === 'image') { event.preventDefault(); event.stopPropagation(); this.pickDrawingImage(drawing); return; }
      const textDrawing = tradingDrawingToolDefinition(drawing.tool)?.kind === "text";
      if (!textDrawing && !tradingDrawingSupportsSettings(drawing.tool)) return;
      event.preventDefault();
      event.stopPropagation();
      this.selectDrawing(drawing.id);
      if (textDrawing) {
        this.closeSelectionMenus();
        this.openPendingTextEditor(drawing);
      } else {
        this.openHorizontalLineSettings(drawing);
      }
      return;
    }
    if (!tradingDrawingIsMultiPoint(this.draft.tool) && this.draft.tool !== 'ghost-feed') return;
    event.preventDefault();
    event.stopPropagation();
    this.finishMultiPointDrawing();
  };

  private finishMultiPointDrawing(close = false) {
    if (!this.draft || !tradingDrawingIsMultiPoint(this.draft.tool) && this.draft.tool !== 'ghost-feed') return;
    this.flushPointerMoves();
    const minimum = close ? 3 : 2;
    if (this.draftConfirmedPointCount < minimum) { this.cancelDraft(); return; }
    // The following preview is never a confirmed vertex (including Escape/Enter).
    this.draft.points = this.draft.points.slice(0, this.draftConfirmedPointCount);
    // Store the closing vertex explicitly so older sync/storage transports keep it intact.
    if (close) this.draft.points.push({ ...this.draft.points[0] });
    this.commitDraft();
  }

  private updateMagicCursor(event: PointerEvent) {
    if (this.activeTool !== 'magic' || !this.controlActive || !this.userDrawingEnabled
      || !(event.target instanceof Node) || !this.chartElement.contains(event.target)
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = performance.now();
    if (now - this.magicTrailTime < 35) return;
    this.magicTrailTime = now;
    if (!this.magicTrail) {
      this.magicTrail = document.createElement('div');
      this.magicTrail.className = 'trading-drawing-magic-trail';
      this.magicTrail.setAttribute('aria-hidden', 'true');
      this.chartElement.append(this.magicTrail);
    }
    const point = this.eventScreenPoint(event), bounds = this.plotBounds();
    this.magicTrail.style.width = `${bounds.width}px`;
    this.magicTrail.style.height = `${bounds.height}px`;
    const spark = document.createElement('span');
    spark.textContent = '✦';
    spark.style.left = `${point.x}px`; spark.style.top = `${point.y}px`;
    this.magicTrail.append(spark);
    while (this.magicTrail.children.length > 18) this.magicTrail.firstElementChild?.remove();
    const animation = spark.animate([
      { opacity: .9, transform: 'translate(-50%, -50%) scale(1)' },
      { opacity: 0, transform: 'translate(-50%, 12px) scale(.2)' },
    ], { duration: 600, easing: 'ease-out' });
    animation.onfinish = () => spark.remove();
  }

  private toolbarCursorTool(): TradingDrawingToolId {
    const remembered = this.lastToolByGroup.get('cursor');
    // The cursor group also contains the eraser. Cancelling must not arm it.
    return remembered && tradingDrawingToolDefinition(remembered)?.kind === 'cursor' ? remembered : 'crosshair';
  }

  private toggleToolbarTool(id: TradingDrawingToolId) {
    const definition = tradingDrawingToolDefinition(id);
    if (!definition) return;
    const selected = !this.getNavigation?.()?.getTool() && this.activeTool === id;
    this.selectTool(selected ? definition.group === 'cursor' ? 'crosshair' : this.toolbarCursorTool() : id);
  }

  private selectTool(id: TradingDrawingToolId) {
    const definition = tradingDrawingToolDefinition(id);
    if (!definition) return;
    if (id === 'image') { this.pickDrawingImage(); return; }
    if (id === 'tweet') { this.pickXPost(); return; }
    this.finishHorizontalLineTextEdit(true);
    if (this.pendingTextDrawingId) this.discardPendingTextDrawing();
    if (this.dragState) this.cancelSelectionDrag();
    else this.cancelDraft();
    this.getNavigation?.()?.setTool(null);
    this.activeTool = definition.id;
    this.lastToolByGroup.set(drawingMenuGroup(definition.id), definition.id);
    this.host.dataset.drawingCursor = definition.id;
    this.overlay.classList.toggle("drawing-active", definition.kind !== "cursor");
    this.overlay.dataset.drawingTool = definition.id;
    if (definition.id === "price-note") this.setStatus("价格注释 · 请点击图表确定价格锚点");
    else if (definition.id === 'note') this.setStatus('笔记 · 拖出线段后输入文字，也可依次点击两个端点');
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
    return { ...(['text', 'note', 'pin-note', 'table', 'callout', 'comment', 'signpost'].includes(tool) ? { fontSize: PLAIN_TEXT_FONT_SIZE } : {}), ...style };
  }

  private pickDrawingImage(drawing?: TradingDrawingModel, pastedFile?: File) {
    if (drawing?.locked || !this.userDrawingEnabled) return;
    this.selectTool(this.lastToolByGroup.get('cursor') ?? 'crosshair');
    this.lastToolByGroup.set(drawingMenuGroup('image'), 'image');
    this.updateToolbarState();
    const bounds = this.plotBounds();
    const session = this.storageSessionId, symbol = this.getSymbol();
    const points = drawing?.points.map(p => this.pointToScreen(p)).filter((p): p is ScreenPoint => Boolean(p));
    const initial = drawing ? { reference: drawing.text ?? '', opacity: drawing.imageOpacity ?? 1,
      width: points?.[1] ? Math.abs(points[1].x - points[0].x) : 240,
      height: points?.[1] ? Math.abs(points[1].y - points[0].y) : 160 } : undefined;
    this.imageDialog.show(this.chartElement.closest<HTMLElement>('.trading-expert-market') ?? this.host, selection => {
      if (this.destroyed || session !== this.storageSessionId || symbol !== this.getSymbol()) return;
      if (drawing) {
        if (!this.drawings.includes(drawing) || drawing.locked) return;
        drawing.text = selection.reference; drawing.imageOpacity = selection.opacity;
        this.selectDrawing(drawing.id); this.persistDrawingEdit('已更新图片');
      } else {
        this.pendingImageSelection = selection;
        const screen = { x: Math.max(0, (bounds.width - selection.width) / 2), y: Math.max(0, (bounds.height - selection.height) / 2) };
        const point = this.screenToDrawingPoint(screen, false);
        if (point) this.beginTextDrawing('image', point, screen, selection.reference);
        this.pendingImageSelection = null;
      }
    }, initial, pastedFile);
  }

  private pickXPost(drawing?: TradingDrawingModel) {
    if (drawing?.locked || !this.userDrawingEnabled) return;
    this.selectTool(this.lastToolByGroup.get('cursor') ?? 'crosshair');
    this.lastToolByGroup.set(drawingMenuGroup('tweet'), 'tweet');
    this.updateToolbarState();
    const session = this.storageSessionId, symbol = this.getSymbol();
    this.xPostDialog.show(this.chartElement.closest<HTMLElement>('.trading-expert-market') ?? this.host, post => {
      if (this.destroyed || session !== this.storageSessionId || symbol !== this.getSymbol()) return;
      if (drawing) {
        if (!this.drawings.includes(drawing) || drawing.locked) return;
        drawing.text = post.url;
        if (this.pendingTextDrawingId === drawing.id) this.pendingTextDrawingId = null;
        this.selectDrawing(drawing.id); this.persistDrawingEdit('已更新帖子');
      } else {
        const bounds = this.plotBounds(), screen = { x: bounds.width / 2, y: Math.max(20, bounds.height / 2 - 100) };
        const point = this.screenToDrawingPoint(screen, false);
        if (point) this.beginTextDrawing('tweet', point, screen, post.url);
      }
    }, drawing?.text ?? '');
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
      viewportAnchor: ["anchored-text", "anchored-note"].includes(tool)
        ? tradingDrawingViewportAnchor(screenPoint, this.plotBounds())
        : undefined,
    };
    this.drawings.push(drawing);
    this.redoStack = [];
    this.selectedDrawingId = drawing.id;
    this.showDrawingHandles();
    this.selectionToolbarPosition = null;
    if (!this.stayInDrawingMode) this.selectTool(this.lastToolByGroup.get("cursor") ?? "crosshair");
    if (tool === 'image' && initialText.startsWith('haolo-image:')) {
      const image = this.pendingImageSelection;
      if (image) {
        const second = this.screenToDrawingPoint({ x: screenPoint.x + image.width, y: screenPoint.y + image.height }, false);
        if (second) drawing.points = [point, second];
        drawing.imageOpacity = image.opacity;
      }
      this.persistDrawings(); this.redraw(); this.setStatus('图片已放置'); return;
    }
    if (tool === 'tweet' && normalizeXPostUrl(initialText)) {
      this.persistDrawings(); this.redraw(); this.setStatus('帖子已添加'); return;
    }
    this.pendingTextDrawingId = drawing.id;
    this.redraw();
    this.setStatus("请输入文本内容");
    this.openPendingTextEditor(drawing);
  }

  private openPendingTextEditor(drawing: TradingDrawingModel) {
    window.requestAnimationFrame(() => {
      if (this.destroyed || this.selectedDrawingId !== drawing.id) return;
      if (isInlineAnnotation(drawing)) { this.beginInlineTextEdit(drawing); return; }
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
    if (definition?.id === 'ghost-feed') return `已确定 ${Math.max(0,this.draftConfirmedPointCount-1)} / 5 段 · 点击添加下一段 · Enter 或双击完成 · 右键撤销上一端点`;
    if (definition?.id === 'bars-pattern') return '选择结束 K 线，点击生成 K 线形态 · Esc 取消';
    if (definition?.id === 'fib-trend-extension') return this.draftConfirmedPointCount >= 2
      ? '趋势幅度已确定 · 移动鼠标选择第三点作为 0 位，点击完成 · 右键撤销上一端点'
      : '移动鼠标选择趋势终点，点击确定第一段 · 右键撤销上一端点';
    if (definition?.id === 'fib-channel') return this.draftConfirmedPointCount >= 2
      ? '基准线已确定 · 移动鼠标选择 1 倍通道起点，点击完成 · 右键撤销上一端点'
      : '移动鼠标选择第二点，点击确定通道方向 · 右键撤销上一端点';
    if (definition?.id === 'fib-time-zone') return '起始时间已确定 · 横向移动鼠标设置时间间隔，点击完成 · 右键撤销上一端点';
    if (definition?.id === 'cyclic-lines' || definition?.id === 'time-cycles') return '起点已确定 · 横向移动鼠标设置循环间隔，点击完成 · Esc 取消';
    if (definition?.id === 'sine-line') return '起点已确定 · 移动鼠标设置半周期和振幅，点击完成 · Esc 取消';
    if (definition?.id === 'fib-trend-time') return this.draftConfirmedPointCount >= 2
      ? '趋势时间已确定 · 移动鼠标选择时间投射起点，点击完成 · 右键撤销上一端点'
      : '移动鼠标选择第二点，点击确定趋势时间 · 右键撤销上一端点';
    if (definition?.id === 'fib-speed-fan') return '扇形起点已确定 · 移动鼠标设置价格和时间范围，点击完成 · 右键撤销上一端点';
    if (definition && isTradingPitchfork(definition.id)) {
      return this.draftConfirmedPointCount >= 2
        ? '前两点已确定 · 移动鼠标选择第三点，调整叉口与方向，点击完成 · 右键撤销上一端点'
        : '移动鼠标选择第二点，点击确定第一段 · 右键撤销上一端点';
    }
    if (definition && tradingDrawingIsMultiPoint(definition.id)) {
      return `已设置 ${this.draftConfirmedPointCount} 个端点 · 点击继续，双击、Enter 或 Esc 完成 · 右键撤销上一端点${definition.id === 'multi-point-polyline' ? ' · 点击起点闭合' : ''}`;
    }
    if (definition?.kind === "triangle") {
      return this.draftConfirmedPointCount >= 2
        ? "第二个端点已设置 · 移动鼠标选择第三个端点，再次点击完成 · 右键撤销上一端点"
        : "移动鼠标选择第二个端点，再次点击确定一边 · 右键撤销上一端点";
    }
    if (definition?.id === 'rotated-rectangle') {
      return this.draftConfirmedPointCount >= 2
        ? '中轴线已确定 · 移动鼠标调整矩形宽度，点击完成 · 右键撤销上一端点'
        : '移动鼠标选择终点，点击确定中轴线 · 右键撤销上一端点';
    }
    if (definition?.id === 'parallel-channel') {
      return this.draftConfirmedPointCount >= 2
        ? "线段已确定 · 上下移动鼠标调整通道宽度，点击完成 · 右键撤销上一端点"
        : "移动鼠标选择终点，点击确定线段 · 右键撤销上一端点";
    }
    if (definition?.id === 'flat-top-bottom') {
      return this.draftConfirmedPointCount >= 2
        ? "线段已确定 · 上下移动鼠标放置水平边界，点击完成 · 右键撤销上一端点"
        : "移动鼠标选择终点，点击确定线段 · 右键撤销上一端点";
    }
    if (definition?.id === 'disjoint-channel') {
      return this.draftConfirmedPointCount >= 2
        ? "线段已确定 · 上下移动鼠标放置反向边界，点击完成 · 右键撤销上一端点"
        : "移动鼠标选择终点，点击确定线段 · 右键撤销上一端点";
    }
    if (definition?.id === 'regression-trend') return '选择结束 K 线，点击后自动计算回归通道 · 右键撤销上一端点';
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
    if (this.draftRequiredPointCount > 2) return `${definition?.label} · 已设置 ${this.draftConfirmedPointCount}/${this.draftRequiredPointCount} 个端点 · 再次点击继续 · 右键撤销上一端点`;
    return "移动鼠标选择终点，再次点击完成 · 右键撤销上一端点";
  }

  private setStatus(message: string) {
    if (!this.controlActive) return;
    this.status.textContent = message;
  }

  private toggleToolMenu(group: TradingDrawingGroupId | 'magnet' | 'visibility', trigger: HTMLElement) {
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
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - toolbarRect.top - 8)}px`;
    const maxTop = Math.max(toolbarRect.top + 4, window.innerHeight - menu.getBoundingClientRect().height - 8);
    menu.style.top = `${Math.min(Math.max(triggerRect.top, toolbarRect.top + 4), maxTop)}px`;
    menu.style.left = `${Math.max(4, Math.min(toolbarRect.right, window.innerWidth - menu.getBoundingClientRect().width - 8))}px`;
    this.toolbar.querySelector(`[data-drawing-action="toggle-tool-menu"][data-drawing-group-id="${group}"]`)?.setAttribute("aria-expanded", "true");
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

  private isInlineTextEditTarget(target: EventTarget | null) {
    return target instanceof Node && (this.horizontalLineTextEdit?.input.contains(target)
      || this.selectionToolbar.contains(target) || colorPickerContainsTarget(this.selectionToolbar, target));
  }

  private readonly handleInlineTextFocusIn = (event: FocusEvent) => {
    // A keyboard user may leave through a toolbar button or a color input,
    // after the textarea itself has already blurred within this editing group.
    if (this.horizontalLineTextEdit && !this.isInlineTextEditTarget(event.target)) this.finishHorizontalLineTextEdit(true);
  };

  private horizontalLineTextEditIsValid() {
    const edit = this.horizontalLineTextEdit;
    return Boolean(edit && !this.destroyed && this.userDrawingEnabled && !this.drawingVisibility.manualHidden
      && edit.session === this.storageSessionId && this.drawings.includes(edit.drawing)
      && (tradingDrawingSupportsSettings(edit.drawing.tool) || isInlineAnnotation(edit.drawing)) && !edit.drawing.locked && !this.drawingVisibility.isHidden(edit.drawing)
      && (tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor' || isInlineAnnotation(edit.drawing) && this.activeTool === edit.drawing.tool)
      && tradingManualDrawingMatchesContext(edit.drawing, this.getSymbol(), this.getInterval(), this.drawingScope));
  }

  private activateHorizontalLineTextEdit(target: EventTarget | null) {
    const trigger = target instanceof Element ? target.closest<SVGElement>('[data-horizontal-line-edit-text]') : null;
    if (!trigger || !this.overlay.contains(trigger) || !this.userDrawingEnabled || this.draft || this.dragState
      || this.horizontalLineSettings.open || tradingDrawingToolDefinition(this.activeTool)?.kind !== 'cursor') return false;
    const drawing = this.drawings.find(candidate => candidate.id === trigger.dataset.horizontalLineEditText
      && tradingManualDrawingMatchesContext(candidate, this.getSymbol(), this.getInterval(), this.drawingScope));
    if (!drawing || !tradingDrawingSupportsSettings(drawing.tool) || drawing.source === 'ai' || drawing.locked || !drawing.text?.trim()) return false;
    return this.beginInlineTextEdit(drawing);
  }

  private beginInlineTextEdit(drawing: TradingDrawingModel, cell?: TableCell) {
    if (drawing.locked || drawing.source === 'ai' || !this.userDrawingEnabled || this.destroyed) return false;
    if (this.horizontalLineTextEdit?.drawing === drawing && (!cell || this.horizontalLineTextEdit.cell?.row === cell.row && this.horizontalLineTextEdit.cell?.column === cell.column)) {
      this.horizontalLineTextEdit.input.focus({ preventScroll: true });
      return true;
    }
    this.finishHorizontalLineTextEdit(true);
    this.onSurfaceFocus?.(this);
    this.selectDrawing(drawing.id);
    this.closeSelectionMenus();
    if (isPinNote(drawing)) this.openPinNoteId = drawing.id;
    const input = document.createElement('textarea');
    input.className = 'trading-horizontal-line-inline-input';
    if (isInlineAnnotation(drawing)) {
      input.classList.add(isAnnotationTable(drawing) ? 'trading-table-inline-input' : isSignpost(drawing) ? 'trading-signpost-inline-input' : isCallout(drawing) || isComment(drawing) ? 'trading-bubble-inline-input' : isPinNote(drawing) ? 'trading-pin-inline-input' : isManualNote(drawing) ? 'trading-note-inline-input' : 'trading-plain-text-input');
      input.placeholder = isAnnotationTable(drawing) ? '' : translateAppText('添加文字');
    }
    input.setAttribute('data-i18n-skip', '');
    input.setAttribute('aria-label', translateAppText('文本输入'));
    input.maxLength = 240;
    input.wrap = 'off';
    input.spellcheck = false;
    const tableCell = isAnnotationTable(drawing) ? cell ?? { row: 0, column: 0 } : undefined;
    input.value = tableCell ? annotationTableCells(drawing.text)[tableCell.row][tableCell.column] : drawing.text ?? '';
    if (tableCell) {
      const current = updateAnnotationTableCell(drawing.text ?? '', tableCell, '');
      input.maxLength = Math.max(0, 240 - current.length);
      input.setAttribute('aria-label', `${translateAppText('表格')} ${tableCell.row + 1}, ${tableCell.column + 1}`);
    }
    const edit = { drawing, input, session: this.storageSessionId, measure: document.createElement('canvas').getContext('2d'), composing: false, cell: tableCell };
    this.horizontalLineTextEdit = edit;
    // Keep the native input outside the SVG diff so quote ticks and viewport
    // redraws never replace the focused node or interrupt an IME composition.
    this.overlay.parentElement?.append(input);
    input.addEventListener('input', () => {
      if (isPinNote(drawing) || isCallout(drawing) || isComment(drawing) || isSignpost(drawing)) this.redraw();
      else this.positionHorizontalLineTextEdit(this.plotBounds());
    });
    input.addEventListener('compositionstart', () => { edit.composing = true; });
    input.addEventListener('compositionend', () => { edit.composing = false; });
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || edit.composing || event.keyCode === 229) return;
      if (edit.cell && (event.key === 'Tab' || event.key === 'Enter')) {
        event.preventDefault();
        const rows = annotationTableCells(drawing.text), columns = rows[0].length;
        const index = edit.cell.row * columns + edit.cell.column;
        const next = (index + (event.key === 'Enter' ? columns : event.shiftKey ? -1 : 1) + rows.length * columns) % (rows.length * columns);
        this.finishHorizontalLineTextEdit(true);
        this.beginInlineTextEdit(drawing, { row: Math.floor(next / columns), column: next % columns });
        return;
      }
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        this.finishHorizontalLineTextEdit(event.key === 'Enter');
        this.chartElement.focus({ preventScroll: true });
      }
    });
    input.addEventListener('blur', event => {
      // A null destination also occurs when the window/IME loses focus. Keep
      // that editing session; outside pointer and focusin handle user exits.
      if (this.horizontalLineTextEdit === edit && event.relatedTarget
        && !this.isInlineTextEditTarget(event.relatedTarget)) this.finishHorizontalLineTextEdit(true);
    });
    for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu']) {
      input.addEventListener(type, event => event.stopPropagation());
    }
    this.redraw();
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }

  private positionHorizontalLineTextEdit(bounds: { width: number; height: number }) {
    const edit = this.horizontalLineTextEdit;
    if (!edit) return;
    if (!this.horizontalLineTextEditIsValid()) { this.finishHorizontalLineTextEdit(false, false); return; }
    const { drawing, input, measure } = edit;
    const points = this.drawingLabelPoints(drawing, bounds);
    // Quote/history updates and layout changes can temporarily lack a usable
    // projection. Keep the input at its last position until the next frame.
    if (!points.length || bounds.width < 32 || bounds.height < 32) return;
    if (isInlineAnnotation(drawing)) {
      if (edit.cell) {
        const table = annotationTableGeometry(drawing, points);
        const width = table.width / table.columns, height = table.height / table.rows.length;
        Object.assign(input.style, {
          left: `${table.x + edit.cell.column * width}px`, top: `${table.y + edit.cell.row * height}px`,
          width: `${width}px`, height: `${height}px`, font: `${drawing.bold ? 700 : 400} ${drawing.fontSize ?? PLAIN_TEXT_FONT_SIZE}px ${PLAIN_TEXT_FONT_FAMILY}`,
          lineHeight: `${Math.max(20, height - 16)}px`, color: drawing.textColor ?? 'var(--trading-note-text)',
        });
        return;
      }
      const geometry = annotationTextGeometry(drawing, points, input.value || input.placeholder);
      const width = Math.min(geometry.width, bounds.width);
      const height = Math.min(geometry.height, bounds.height);
      Object.assign(input.style, {
        left: `${Math.max(0, Math.min(geometry.x, bounds.width - width))}px`,
        top: `${Math.max(0, Math.min(geometry.y, bounds.height - height))}px`,
        width: `${width}px`, height: `${height}px`, font: geometry.font,
        lineHeight: `${geometry.lineHeight}px`,
        color: isCallout(drawing) || isComment(drawing) ? drawing.textColor ?? '#ffffff' : isManualNote(drawing) || isPinNote(drawing) || isSignpost(drawing) ? drawing.textColor ?? 'var(--trading-note-text)' : drawing.color ?? PLAIN_TEXT_COLOR,
        background: isPinNote(drawing) || isCallout(drawing) || isComment(drawing) || isSignpost(drawing) ? 'transparent' : drawing.textBackgroundColor ?? (isManualNote(drawing) ? 'var(--trading-note-background)' : 'transparent'),
        overflow: geometry.width > width || geometry.height > height ? 'auto' : 'hidden',
      });
      return;
    }
    const fontSize = drawingTextFontSize(drawing.fontSize) ?? 12;
    const lineHeight = Math.round(fontSize * 1.3 * 10) / 10;
    const font = `${drawing.italic ? 'italic' : 'normal'} ${drawing.bold ? 700 : 400} ${fontSize}px Inter, "Segoe UI", "Microsoft YaHei", sans-serif`;
    if (measure) measure.font = font;
    const lines = input.value.split('\n');
    const width = Math.min(bounds.width - 16, Math.max(24, ...lines.map(line => measure?.measureText(line).width ?? tradingDrawingLineWidth(line, fontSize))) + 8);
    const height = Math.min(8, lines.length) * lineHeight;
    const align = drawing.textAlign ?? 'center';
    const geometry = tradingDrawingLabelGeometry({ ...drawing, text: input.value || ' ' }, points, bounds, { width, height })
      ?? tradingDrawingLabelGeometry({ ...drawing, text: '|' }, points, bounds, { width, height });
    if (!geometry) return;
    const { x, y, left, top, angle } = geometry;
    Object.assign(input.style, {
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
      transform: `rotate(${angle}deg)`, transformOrigin: `${x - left}px ${y - top}px`,
      font, lineHeight: `${lineHeight}px`, textAlign: align,
      color: drawingColor(drawing.textColor) ?? drawing.color ?? manualDrawingDefaults(drawing.tool).color,
    });
  }

  private finishHorizontalLineTextEdit(save: boolean, redraw = true) {
    const edit = this.horizontalLineTextEdit;
    if (!edit) return;
    const text = edit.cell ? updateAnnotationTableCell(edit.drawing.text ?? '', edit.cell, edit.input.value).slice(0, 240) : edit.input.value.slice(0, 240);
    const validSave = save && this.horizontalLineTextEditIsValid();
    const pending = this.pendingTextDrawingId === edit.drawing.id;
    const changed = validSave && text !== edit.drawing.text;
    this.horizontalLineTextEdit = null;
    edit.input.remove();
    if (pending && (!validSave || !text.trim())) {
      this.discardPendingTextDrawing();
    } else if (changed || pending && validSave) {
      edit.drawing.text = text;
      if (pending) this.pendingTextDrawingId = null;
      this.redoStack = [];
      this.persistDrawings();
      this.setStatus('已确定文本');
    }
    if (redraw) this.redraw();
  }

  private activateHorizontalLineAddText(target: EventTarget | null) {
    const trigger = target instanceof Element ? target.closest<SVGElement>('[data-horizontal-line-add-text]') : null;
    if (!trigger || !this.overlay.contains(trigger) || !this.userDrawingEnabled || this.draft || this.dragState
      || this.horizontalLineSettings.open || tradingDrawingToolDefinition(this.activeTool)?.kind !== 'cursor') return false;
    const drawing = this.drawings.find(candidate => candidate.id === trigger.dataset.horizontalLineAddText
      && tradingManualDrawingMatchesContext(candidate, this.getSymbol(), this.getInterval(), this.drawingScope));
    if (!drawing || !tradingDrawingSupportsSettings(drawing.tool) || drawing.source === 'ai' || drawing.locked || drawing.text?.trim()) return false;
    this.onSurfaceFocus?.(this);
    this.selectDrawing(drawing.id);
    const centered = trigger.dataset.drawingTextPosition === 'center';
    this.openHorizontalLineSettings(centered ? { ...drawing, textAlign: 'center', textVerticalAlign: 'middle' } : drawing,
      this.selectionToolbar.querySelector<HTMLButtonElement>('[data-horizontal-line-settings]') ?? undefined, 'text');
    return true;
  }

  private readonly handleHorizontalLineAddTextClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<SVGElement>('[data-x-post-link]') : null;
    const post = link && normalizeXPostUrl(link.dataset.xPostLink);
    if (post && event.button === 0) {
      event.preventDefault(); event.stopPropagation(); void window.codexDesktop.openExternal(post.url); return;
    }
    if (event.button !== 0 || !(this.activateHorizontalLineTextEdit(event.target) || this.activateHorizontalLineAddText(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly handleHorizontalLineAddTextKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.target instanceof Element) {
      const post = normalizeXPostUrl(event.target.closest<SVGElement>('[data-x-post-link]')?.dataset.xPostLink);
      if (post) { event.preventDefault(); event.stopPropagation(); void window.codexDesktop.openExternal(post.url); return; }
    }
    if (['Enter', ' '].includes(event.key) && event.target instanceof Element) {
      const id = event.target.closest<SVGElement>('[data-inline-annotation]')?.dataset.inlineAnnotation;
      const drawing = this.drawings.find(item => item.id === id);
      if (drawing && isInlineAnnotation(drawing) && this.beginInlineTextEdit(drawing)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
    }
    if (!['Enter', ' '].includes(event.key) || !(this.activateHorizontalLineTextEdit(event.target) || this.activateHorizontalLineAddText(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private openHorizontalLineSettings(drawing: TradingDrawingModel, trigger?: HTMLElement, initialTab: 'style' | 'text' = 'style') {
    if (!tradingDrawingSupportsSettings(drawing.tool) || drawing.source === 'ai') return;
    this.finishHorizontalLineTextEdit(true);
    this.cancelSelectionDrag();
    this.closeSelectionMenus();
    this.horizontalLineSettings.show(drawing, next => {
      const current = this.selectedDrawing();
      if (!current || current.id !== next.id) return;
      if (initialTab !== 'text' && next.tool === 'regression-trend') {
        const fit = calculateRegressionTrend(this.getCandles(), next.points, next.regression);
        if (!fit) { this.setStatus('回归趋势至少需要两根有效 K 线'); return; }
        next.points = fit.anchors;
      }
      if (initialTab !== 'text' && isVolumeDrawing(next.tool)) {
        next.points = this.volumeAnchors(next);
        if (isVolumeProfile(next.tool)) this.scheduleVolumeProfile(next.id);
      }
      if (initialTab !== 'text') this.normalizeWedgeAnchors(next);
      Object.assign(current, next);
      this.persistDrawingEdit('已更新绘图');
    }, this.chartElement.closest<HTMLElement>('.trading-expert-market') ?? this.host, trigger, initialTab, tradingDrawingToolDefinition(drawing.tool)!.label, next => {
      this.fibonacciSettingsPreview = next;
      this.redraw();
    });
  }

  private openTextInput(drawing: TradingDrawingModel, trigger: HTMLElement) {
    if (drawing.tool === 'tweet') { this.pickXPost(drawing); return; }
    if (drawing.tool === 'image') { this.pickDrawingImage(drawing); return; }
    if (isManualPriceNote(drawing)) return;
    if (isInlineAnnotation(drawing)) { this.beginInlineTextEdit(drawing); return; }
    this.toggleSelectionMenu("text-input", trigger);
    if (this.activeSelectionMenu !== "text-input") return;
    const definition = tradingDrawingToolDefinition(drawing.tool);
    const title = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-text-input-title]");
    if (title) title.textContent = `${definition?.label ?? "文本"}输入`;
    const input = this.textInputElement();
    if (!input) return;
    input.value = drawing.text ?? "";
    input.placeholder = drawing.tool === 'table' ? '每行一行表格，用 | 分隔列' : '请输入内容…';
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
    if (id !== this.openPinNoteId) this.openPinNoteId = null;
    if (id !== this.selectedDrawingId) this.finishHorizontalLineTextEdit(true);
    if (id !== this.selectedDrawingId) this.horizontalLineSettings.close();
    this.dismissedSelectionToolbarDrawingId = null;
    if (this.pendingTextDrawingId && id !== this.pendingTextDrawingId) {
      this.discardPendingTextDrawing();
    }
    if (id === this.selectedDrawingId) {
      this.showDrawingHandles();
      this.redraw();
      return;
    }
    this.finishSelectionToolbarDrag();
    this.selectedDrawingId = id;
    this.showDrawingHandles();
    this.selectionToolbarPosition = null;
    this.closeSelectionMenus();
    this.redraw();
  }

  private dismissSelectionToolbar() {
    this.dismissedSelectionToolbarDrawingId = this.selectedDrawingId;
    this.finishSelectionToolbarDrag();
    this.closeSelectionMenus();
    this.selectionToolbar.hidden = true;
  }

  private showSelectionToolbar() {
    // Selection stays visible until an explicit dismiss or selection change.
    this.selectionToolbar.hidden = false;
  }

  private showDrawingHandles() {
    this.overlay.classList.remove('drawing-handles-idle');
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
    closeColorPicker(this.selectionToolbar);
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

  private drawingBarSpan(drawing:TradingDrawingModel) {
    if (drawing.tool !== 'gann-square' || drawing.points.length < 2) return 0;
    const a=tradingDrawingLogicalIndexAtTime(this.getCandles(),drawing.points[0].time),b=tradingDrawingLogicalIndexAtTime(this.getCandles(),drawing.points[1].time);
    return a!==null&&b!==null?b-a:0;
  }

  private normalizeWedgeAnchors(drawing:TradingDrawingModel) {
    if (drawing.tool === 'sector' && drawing.points.length >= 3) {
      const [a,b,c] = drawing.points.map(p=>this.pointToScreen(p));
      if (a && b && c) { const point=this.screenToDrawingPoint(sectorEndpoint(a,b,c),false);if(point)drawing.points[2]=point; }
      return;
    }
    if(drawing.tool !== 'fib-wedge' || drawing.points.length < 3)return;
    const [a,b,c]=drawing.points.map(p=>this.pointToScreen(p));
    if(a&&b&&c){const p=this.screenToDrawingPoint(fibonacciWedgeEndpoint(a,b,c),false);if(p)drawing.points[2]=p;}
  }

  private volumeProfileForDrawing(drawing: TradingDrawingModel) {
    if (this.projectionTimes && this.volumeCalculations.has(drawing.id)) return this.volumeCalculations.get(drawing.id)!;
    const candles = this.getVolumeCandles(), points = volumeProfilePoints(drawing, candles);
    const from = volumeBarIndex(candles, Math.min(...points.map(p => p.time))), to = volumeBarIndex(candles, Math.max(...points.map(p => p.time)));
    if (from < 0 || to < 0 || points.length < 2) return null;
    const chart = this.getInterval(), end = volumeBarEnd(candles[to].time, chart);
    const resolution = volumeProfileResolution(drawing.tool, chart, end - candles[from].time, this.volumeFutures());
    const tick = this.getCandleSeries()?.options?.().priceFormat?.minMove ?? .01;
    this.volumeHistory?.useContext(`${this.getSymbol()}|${chart}`);
    const history = volumeResolutionSeconds(resolution) <= volumeResolutionSeconds(chart)
      ? this.volumeHistory?.get({ market: this.getSymbol(), resolution, start: candles[from].time, end }, candles.slice(from, to + 1), chart, tick,
        drawing !== this.draft && this.dragState?.drawingId !== drawing.id) : undefined;
    const sourceLabel = history ? `计算周期 ${history.resolution} · 低周期覆盖 ${history.covered}/${history.total} · ${history.state === 'loading' ? '加载中' : history.state === 'lower' ? '完整' : history.state === 'mixed' ? '缺失部分使用图表周期' : '使用图表周期'}` : `计算周期 ${chart}`;
    const profile = calculateFixedVolume(candles, points, drawing.volumeProfile, { candles: history?.candles, tickSize: history?.tickSize ?? tick, sourceLabel: translateDrawingText(sourceLabel) });
    if (this.projectionTimes) this.volumeCalculations.set(drawing.id, profile);
    return profile;
  }

  private volumeAnchors(drawing: TradingDrawingModel) {
    return volumeDrawingAnchors(drawing, isVolumeProfile(drawing.tool) ? this.getVolumeCandles() : this.getCandles(), isVolumeProfile(drawing.tool) ? this.volumeProfileForDrawing(drawing) : undefined);
  }

  private eventDrawingPoint(screen: ScreenPoint, drawing?: TradingDrawingModel, pointIndex?: number): TradingDrawingPoint | null {
    const regression = (drawing?.tool ?? this.activeTool) === 'regression-trend';
    const volumeTool = isVolumeDrawing(drawing?.tool ?? this.activeTool);
    const point = this.screenToDrawingPoint(screen, !regression && !volumeTool);
    if (point && isRangeDrawing(drawing?.tool ?? this.activeTool)) {
      const candles = this.getCandles(), logical = tradingDrawingLogicalIndexAtTime(candles, point.time);
      if (logical !== null) point.time = tradingDrawingTimeAtLogicalIndex(candles, Math.round(logical)) ?? point.time;
      const format = this.getCandleSeries()?.options?.().priceFormat;
      const tick = format?.minMove;
      if (typeof tick === 'number' && tick > 0) point.price = Math.round(point.price / tick) * tick;
      return point;
    }
    if (point && volumeTool) {
      const candles = this.getCandles(), index = volumeBarIndex(candles, point.time);
      if (index < 0) return null;
      const candle = candles[index];
      return { time: candle.time, price: (drawing?.tool ?? this.activeTool) === 'anchored-vwap'
        ? vwapSourcePrice(candle, normalizeAnchoredVwapOptions(drawing?.vwap).source) : point.price };
    }
    if (point && (drawing?.tool ?? this.activeTool) === 'bars-pattern' && (!drawing || drawing === this.draft)) {
      const bar = nearestPatternBar(this.getCandles(), point.time);
      if (!bar) return null;
      const clamped = { ...point, time: bar.time };
      return drawing && pointIndex === 1 ? patternPreviewPoint(drawing, clamped, this.getCandles()) : clamped;
    }
    if (point && drawing?.tool === 'sector' && pointIndex === 2) {
      const [a,b]=drawing.points.map(p=>this.pointToScreen(p));
      if(a&&b)return this.screenToDrawingPoint(sectorEndpoint(a,b,screen),false);
    }
    if (point && isCycleDrawing(drawing?.tool ?? this.activeTool)) {
      const candles = this.getCandles(), logical = tradingDrawingLogicalIndexAtTime(candles, point.time);
      if (logical !== null) point.time = tradingDrawingTimeAtLogicalIndex(candles, Math.round(logical)) ?? point.time;
      if (drawing?.tool === 'time-cycles' && drawing === this.draft && pointIndex === 1) point.price = drawing.points[0].price;
      return point;
    }
    if (point && (isElliottWave(drawing?.tool ?? this.activeTool) || isPredictionDrawing(drawing?.tool ?? this.activeTool))) {
      // TradingView anchors wave time to a bar even with the price magnet off.
      // The shared conversion also extrapolates bars in the future blank area.
      const candles = this.getCandles(), logical = tradingDrawingLogicalIndexAtTime(candles, point.time);
      if (logical !== null) point.time = tradingDrawingTimeAtLogicalIndex(candles, Math.round(logical)) ?? point.time;
      if (isPositionDrawing(drawing?.tool ?? this.activeTool)) {
        const tick = normalizePositionOptions(drawing?.position).tickSize;
        point.price = Math.round(point.price / tick) * tick;
      }
      if (drawing?.tool === 'ghost-feed' && pointIndex !== undefined) {
        const step=tradingDrawingEdgeInterval(candles,'end');
        const before=drawing.points[pointIndex-1],after=drawing===this.draft?null:drawing.points[pointIndex+1];
        if(before)point.time=Math.max(before.time+step,point.time);
        if(after)point.time=Math.min(after.time-step,point.time);
      }
      return point;
    }
    if (point && drawing?.tool === 'fib-wedge' && pointIndex === 2) {
      const a=this.pointToScreen(drawing.points[0]),b=this.pointToScreen(drawing.points[1]);
      if(a&&b)return this.screenToDrawingPoint(fibonacciWedgeEndpoint(a,b,screen),false);
    }
    if (point && regression) {
      const candles = this.getCandles(), index = regressionBarIndex(candles, point.time);
      return index < 0 ? null : { ...point, time: candles[index].time };
    }
    if (point && drawing && tradingDrawingIsShapedChannel(drawing.tool) && drawing === this.draft && pointIndex === 2) {
      return { time: drawing.points[1].time, price: point.price };
    }
    if (point && drawing?.tool === 'rotated-rectangle' && drawing === this.draft && pointIndex === 2) {
      const first = this.pointToScreen(drawing.points[0]), second = this.pointToScreen(drawing.points[1]), width = this.pointToScreen(point);
      if (first && second && width) return this.screenToDrawingPoint(rotatedRectangleWidthPoint(first, second, width), false);
    }
    if (point && drawing?.tool === 'parallel-channel' && pointIndex === 2) {
      const first = this.pointToScreen(drawing.points[0]);
      const second = this.pointToScreen(drawing.points[1]);
      const widthPoint = this.pointToScreen(point);
      if (first && second && widthPoint) {
        const endpoint = tradingDrawingChannelPoints(first, second, widthPoint)[2];
        const anchor = this.screenToDrawingPoint(endpoint, false);
        // Persist the actual handle anchor so axis labels and reloads agree
        // with the channel endpoint, not the mouse's arbitrary click time.
        if (anchor) return Math.abs(second.x - first.x) < 1e-6
          ? { ...anchor, price: drawing.points[1].price }
          : { ...anchor, time: drawing.points[1].time };
      }
    }
    return point;
  }

  private screenToDrawingPoint(screen: ScreenPoint, applyMagnet: boolean): TradingDrawingPoint | null {
    const chart = this.getChart();
    const candleSeries = this.getCandleSeries();
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    const logical = tradingDrawingCoordinateToLogical(screen.x,
      x => timeScale.coordinateToLogical(x), index => timeScale.logicalToCoordinate(index));
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
    if (applyMagnet && this.magnetEnabled !== this.magnetModifierHeld) {
      point = this.snapPointToCandle(point, screen);
    }
    return point;
  }

  private snapMovedDrawing(drawing: TradingDrawingModel) {
    if (this.magnetEnabled === this.magnetModifierHeld) return;
    const index = this.dragState?.magnetAnchorIndex ?? 0;
    const point = drawing.points[index], screen = point && this.pointToScreen(point);
    if (!screen) return;
    const snapped = this.snapPointToCandle(point, screen);
    if (snapped === point) return;
    const target = this.pointToScreen(snapped);
    if (!target) return;
    // Translate the whole object by one anchor's snap delta. Snapping each
    // vertex independently would distort channels, patterns and freehand paths.
    drawing.points = drawing.points.map((candidate, i) => {
      if (i === index) return snapped;
      const position = this.pointToScreen(candidate);
      return position ? this.screenToDrawingPoint({
        x: position.x + target.x - screen.x, y: position.y + target.y - screen.y,
      }, false) ?? candidate : candidate;
    });
  }

  private snapPointToCandle(point: TradingDrawingPoint, screen: ScreenPoint) {
    const candles = this.getCandles();
    if (!candles.length) return point;
    const logical = tradingDrawingLogicalIndexAtTime(candles, point.time);
    if (logical === null) return point;
    const index = Math.round(logical);
    // A strong magnet removes the distance threshold, not the requirement for
    // a real bar under the pointer. Never pull future space back to the last bar.
    if (index < 0 || index >= candles.length) return point;
    const nearest = candles[index];
    const chart = this.getChart();
    const chartTime = nearest.time + this.timeOffsetSeconds;
    const nearestX = finiteTradingChartCoordinate(
      chart?.timeScale?.().timeToCoordinate(chartTime as any),
    );
    if (nearestX === null) return point;
    const timeScale = chart?.timeScale();
    return snapTradingDrawingMagnet({
      point, screen, mode: this.magnetMode ?? 'weak', candle: nearest, candleX: nearestX, chartTime,
      dataIndex: timeScale?.timeToIndex ? timeScale.timeToIndex(chartTime, false) : index,
      priceSeries: this.getCandleSeries(), includeCandle: !this.drawingScope || this.drawingScope === 'main',
      indicatorSeries: this.snapToIndicators ? this.getMagnetIndicatorSeries() : [],
    });
  }

  private pointToScreen(point: TradingDrawingPoint): ScreenPoint | null {
    const chart = this.getChart();
    const candleSeries = this.getCandleSeries();
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    if (this.projectionTimes?.has(point.time)) {
      const x = this.projectionTimes.get(point.time)!;
      const y = finiteTradingChartCoordinate(candleSeries.priceToCoordinate(point.price));
      return x !== null && y !== null ? { x, y } : null;
    }
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
    this.projectionTimes?.set(point.time, x);
    return x !== null && y !== null ? { x, y } : null;
  }

  private drawingPointToScreen(
    drawing: TradingDrawingModel,
    pointIndex: number,
    bounds: { width: number; height: number },
  ): ScreenPoint | null {
    if (isVolumeDrawing(drawing.tool) && drawing !== this.draft && this.dragState?.drawingId !== drawing.id) {
      const point = this.volumeAnchors(drawing)[pointIndex];
      return point ? this.pointToScreen(point) : null;
    }
    if (drawing.tool === 'sector' && pointIndex === 2) {
      const [a,b,c]=drawing.points.map(p=>this.pointToScreen(p));return a&&b&&c?sectorEndpoint(a,b,c):null;
    }
    if (drawing.tool === 'time-cycles' && pointIndex === 1 && drawing.points[1]) {
      return this.pointToScreen({ ...drawing.points[1], price: drawing.points[0].price });
    }
    if (drawing.tool === 'fib-wedge' && pointIndex === 2) {
      const [a, b, c] = drawing.points.map(point => this.pointToScreen(point));
      // Reproject the angular handle after zooming or changing the price scale.
      return a && b && c ? fibonacciWedgeEndpoint(a, b, c) : null;
    }
    if ((drawing.tool === 'gann-box' || isAnnotationTable(drawing) || drawing.tool === 'image') && pointIndex >= 2) {
      const [a,b]=drawing.points;
      if(!a||!b)return null;
      return this.pointToScreen(pointIndex===2?{time:b.time,price:a.price}:{time:a.time,price:b.price});
    }
    if (tradingDrawingIsShapedChannel(drawing.tool)) {
      return this.pointToScreen(tradingDrawingShapedChannelHandlePoint(drawing.tool, drawing.points, pointIndex));
    }
    if (drawing.tool === 'regression-trend' && drawing !== this.draft) {
      const fit = calculateRegressionTrend(this.getCandles(), drawing.points, drawing.regression);
      return fit?.anchors[pointIndex] ? this.pointToScreen(fit.anchors[pointIndex]) : null;
    }
    if (["anchored-text", "anchored-note"].includes(drawing.tool) && pointIndex === 0 && drawing.viewportAnchor) {
      return tradingDrawingAnchoredScreenPoint(drawing.viewportAnchor, bounds);
    }
    if (drawing.tool === 'parallel-channel' && pointIndex === 2) {
      const first = this.pointToScreen(drawing.points[0]);
      const second = this.pointToScreen(drawing.points[1]);
      const widthPoint = this.pointToScreen(drawing.points[2]);
      // Display the width handle on the parallel edge's endpoint, even if
      // its original placement click was outside the channel's time span.
      if (first && second && widthPoint) return tradingDrawingChannelPoints(first, second, widthPoint)[2];
    }
    return this.pointToScreen(drawing.points[pointIndex]);
  }

  private ensureAnchoredViewportAnchor(drawing: TradingDrawingModel) {
    if (!["anchored-text", "anchored-note"].includes(drawing.tool) || drawing.viewportAnchor || !drawing.points[0]) return;
    const screenPoint = this.pointToScreen(drawing.points[0]);
    if (screenPoint) drawing.viewportAnchor = tradingDrawingViewportAnchor(screenPoint, this.plotBounds());
  }

  private ensureArrowMarkerEndpoints(drawing: TradingDrawingModel) {
    if (drawing.tool !== "arrow-marker" || drawing.points.length !== 1) return;
    // Older clients saved only the glyph anchor. Preserve it as the tail and
    // give that drawing a real editable tip once the chart can project it.
    // Two-point drafts (including coincident anchors) must never be expanded.
    const tail = this.pointToScreen(drawing.points[0]);
    if (!tail) return;
    const tip = this.screenToDrawingPoint({ x: tail.x + 60, y: tail.y }, false);
    if (tip && (tip.time !== drawing.points[0].time || tip.price !== drawing.points[0].price)) {
      drawing.points.push(tip);
    }
  }

  private rotatedRectangleGeometry(drawing: TradingDrawingModel) {
    const [first, second, width] = drawing.points.map(point => this.pointToScreen(point));
    return first && second ? rotatedRectangleGeometry(first, second, width ?? undefined) : null;
  }

  private plotBounds() {
    const chart = this.getChart();
    if (chart) {
      // Native chart dimensions are already cached. Measuring this DOM surface
      // after price/legend writes forces a desktop layout for every drag frame.
      // The SVG viewport clips every child (AI/manual geometry, labels, hit
      // targets and playback). Chart height includes indicator panes and the
      // time axis, so it must never be used as the main drawing surface height.
      const height = chart.panes()[this.paneIndex]?.getHeight();
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
    if (isVolumeDrawing(completed.tool)) {
      completed.points = this.volumeAnchors(completed);
      if (isVolumeProfile(completed.tool)) this.scheduleVolumeProfile(completed.id);
    }
    if (isPositionDrawing(completed.tool)) completed.points = positionAnchors(completed);
    if (completed.tool === 'bars-pattern') {
      const capture = captureBarsPattern(completed, this.getCandles());
      if (!capture) { this.releasePointer(); this.setStatus('请选择至少两根 K 线'); return; }
      Object.assign(completed, capture);
    }
    this.normalizeWedgeAnchors(completed);
    if (completed.tool === 'regression-trend') {
      const fit = calculateRegressionTrend(this.getCandles(), completed.points, completed.regression);
      if (!fit) {
        this.draftConfirmedPointCount = 1;
        this.releasePointer();
        this.redraw();
        this.setStatus('回归趋势至少需要两根有效 K 线');
        return;
      }
      completed.points = fit.anchors;
    }
    const definition = tradingDrawingToolDefinition(completed.tool);
    const pendingText = definition?.kind === "text" && !isManualPriceNote(completed);
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.drawings.push(completed);
    this.redoStack = [];
    this.releasePointer();
    this.draft = null;
    this.selectedDrawingId = completed.id;
    this.showDrawingHandles();
    this.selectionToolbarPosition = null;
    if (!this.stayInDrawingMode) this.selectTool(this.lastToolByGroup.get("cursor") ?? "crosshair");
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

  private scheduleVolumeProfile(id: string) {
    const previous = this.volumeProfileTimers.get(id);
    if (previous !== undefined) window.clearTimeout(previous);
    this.volumeProfileTimers.set(id, window.setTimeout(() => {
      this.volumeProfileTimers.delete(id);
      if (!this.destroyed && this.drawings.some(d => d.id === id)) this.redraw();
    }, 1000));
  }

  private cancelDraft() {
    this.releasePointer();
    this.draftConfirmedPointCount = 0;
    this.draftRequiredPointCount = 0;
    this.draft = null;
    this.redraw();
  }

  private cancelSelectionDrag() {
    const wasDragging = Boolean(this.dragState);
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
    if (wasDragging) {
      this.showDrawingHandles();
    }
    this.redraw();
  }

  private capturePointer(pointerId: number) {
    beginTradingChartInteraction(this.pointerInteraction);
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
      this.flushPointerMoves();
      this.redrawDraggedDrawing();
    });
  }

  private redrawDraggedDrawing() {
    if (this.destroyed || this.drawingVisibility.manualHidden) return;
    const drawing = this.draft ?? this.drawings.find(item => item.id === this.dragState?.drawingId);
    if (!drawing || !tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)) return;
    const bounds = this.plotBounds();
    this.manualLayer.update(drawing.id, this.renderDrawing(drawing, bounds, drawing === this.draft));
    this.updateAxisMarkers(bounds);
  }

  private cancelDragRedraw() {
    if (this.dragRedrawFrame === null) return;
    window.cancelAnimationFrame(this.dragRedrawFrame);
    this.dragRedrawFrame = null;
  }

  private releasePointer() {
    this.cancelDragRedraw();
    this.pendingPointerMoves = [];
    const pointerId = this.pointerId;
    this.pointerId = null;
    this.pointerStart = null;
    if (pointerId !== null && this.overlay.hasPointerCapture?.(pointerId)) this.overlay.releasePointerCapture(pointerId);
    endTradingChartInteraction(this.pointerInteraction);
  }

  private persistDrawings(notify = true) {
    try {
      const persisted = this.pendingTextDrawingId
        ? this.drawings.filter((drawing) => drawing.id !== this.pendingTextDrawingId)
        : this.drawings;
      window.localStorage.setItem(
        tradingDrawingSessionStorageKey("manual", this.storageSessionId),
        JSON.stringify(persisted.slice(-600)),
      );
      if (notify) this.onDrawingStateChanged?.(this);
      if (!this.applyingManualSync) this.manualSync?.changed();
      return true;
    } catch {
      // Drawing remains available for the current session if storage is unavailable.
      return false;
    }
  }

  private persistAiDrawings(notify = true) {
    try {
      if (!this.aiDrawingSetPlaying) this.aiDrawingSets.updateSelected(this.aiDrawings);
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

  clearAllDrawings({ allScopes = false }: { allScopes?: boolean } = {}) {
    const clearedManual = this.drawings.slice();
    this.aiDrawingClearVersion += 1;
    this.aiPlayback.cancel();
    this.cancelDragRedraw();
    this.releasePointer();
    this.finishSelectionToolbarDrag();
    const scopedClear = !allScopes && this.drawingScope !== "main";
    this.drawings = scopedClear
      ? this.drawings.filter((drawing) => (
          (drawing.drawingScope || "main") !== this.drawingScope
        ))
      : [];
    this.aiDrawings = scopedClear ? this.aiDrawings : [];
    if (!scopedClear) this.aiDrawingSets.clear();
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
    this.drawingVisibility.setLayers({ aiHidden: false, manualHidden: false, plansHidden: false });
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
    }
    this.redraw();
    this.updateToolbarState();
    this.setStatus("本会话所有绘图及历史记录已清空");
    this.manualSync?.clearKnown(clearedManual, scopedClear ? this.drawingScope : undefined);
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
      if (isCycleDrawing(drawing.tool)) {
        const distance = cycleHitDistance(drawing.tool, screenPoints, point, bounds.width);
        if (distance < selectedDistance) { selectedIndex = index; selectedDistance = distance; }
      } else if (isFibonacciProjection(drawing.tool) && screenPoints.length >= 2) {
        const projection = renderFibonacciProjection(drawing, screenPoints, bounds,
          price => finiteTradingChartCoordinate(this.getCandleSeries()?.priceToCoordinate(price)),
          y => finiteTradingChartCoordinate(this.getCandleSeries()?.coordinateToPrice(y)),
          price => formatTradingFibonacciPrice(price, true), clipTradingDrawingLine, this.drawingBarSpan(drawing));
        for (const [first, second] of projection.segments) {
          const distance = distanceToSegment(point, first, second);
          if (distance < selectedDistance) { selectedIndex = index; selectedDistance = distance; }
        }
      } else if (isTradingPitchfork(drawing.tool) && screenPoints.length >= 3) {
        const fork = renderTradingPitchfork(drawing.tool, screenPoints, bounds, drawing, clipTradingDrawingLine);
        for (const [first, second] of fork.segments) {
          const distance = distanceToSegment(point, first, second);
          if (distance < selectedDistance) { selectedIndex = index; selectedDistance = distance; }
        }
      } else if (screenPoints.length >= 2) {
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
    if (deferInteractionRender(this.toolbar, () => this.updateToolbarState())) return;
    if (!this.controlActive) return;
    const symbol = this.getSymbol(), interval = this.getInterval();
    const canUndo = this.drawings.some(drawing => tradingManualDrawingMatchesContext(drawing, symbol, interval, this.drawingScope) && !drawing.locked);
    const canRedo = this.redoStack.some(drawing => tradingManualDrawingMatchesContext(drawing, symbol, interval, this.drawingScope));
    const navigationTool = this.getNavigation?.()?.getTool();
    const state = JSON.stringify([this.activeTool, navigationTool, this.magnetEnabled, this.magnetMode, this.snapToIndicators, this.magnetModifierHeld,
      this.stayInDrawingMode, this.drawingsLocked, this.drawingVisibility.layers(), canUndo, canRedo,
      [...this.lastToolByGroup], [...this.favoriteTools]]);
    if (drawingToolbarState.get(this.toolbar) === state) return;
    drawingToolbarState.set(this.toolbar, state);
    // Navigation temporarily owns the chart even though the remembered drawing
    // tool is a cursor. Only the tool actually accepting input is selected.
    const definition = navigationTool ? undefined : tradingDrawingToolDefinition(this.activeTool);
    this.toolbar.querySelectorAll<HTMLElement>("[data-drawing-group]").forEach((group) => {
      group.classList.toggle("active", !!definition && group.dataset.drawingGroup === drawingMenuGroup(definition.id));
      const primary = group.querySelector<HTMLElement>("[data-drawing-action=\"select-group-tool\"]");
      const menuGroup = DRAWING_MENU_SECTIONS.find(item => item.id === group.dataset.drawingGroup);
      // Keep each primary button on its last selected tool after drawing or switching groups.
      const current = menuGroup ? this.lastToolByGroup.get(menuGroup.id) ?? menuGroup.defaultTool : undefined;
      const currentDefinition = tradingDrawingToolDefinition(current);
      if (primary && currentDefinition) {
        if (primary.dataset.drawingTool !== currentDefinition.id) primary.dataset.drawingTool = currentDefinition.id;
        updateTradingDrawingMarkup(primary, drawingIcon(currentDefinition.icon));
        // Retain the source for live language switching. Passing pretranslated
        // text here would lose the Chinese source in the DOM localizer.
        const label = currentDefinition.label;
        if (primary.dataset.drawingLabel !== label) {
          primary.dataset.drawingLabel = label;
          primary.title = label;
          primary.setAttribute("aria-label", label);
        }
      }
    });
    const setPressed = (action: string, pressed: boolean, icon?: string, label?: string) => {
      const button = this.toolbar.querySelector<HTMLButtonElement>(`[data-drawing-action="${action}"]`);
      if (button && button.getAttribute("aria-pressed") !== String(pressed)) button.setAttribute("aria-pressed", String(pressed));
      button?.classList.toggle("active", pressed);
      if (button && icon) updateTradingDrawingMarkup(button, drawingIcon(icon));
      if (button && label && button.dataset.drawingActionLabel !== label) {
        button.dataset.drawingActionLabel = label;
        button.title = label;
        button.setAttribute("aria-label", label);
      }
    };
    setPressed("zoom-in", navigationTool === "zoom");
    setPressed("measure", navigationTool === "measure");
    setPressed("toggle-magnet", this.magnetEnabled !== this.magnetModifierHeld,
      this.magnetMode === 'strong' ? 'magnet-strong' : 'magnet', this.magnetMode === 'strong' ? '强磁铁' : '弱磁铁');
    this.toolbar.querySelectorAll<HTMLElement>('[data-magnet-mode]').forEach(button => {
      button.setAttribute('aria-checked', String(this.magnetEnabled && button.dataset.magnetMode === this.magnetMode));
    });
    this.toolbar.querySelector('[data-drawing-action="toggle-magnet-indicators"]')?.setAttribute('aria-checked', String(this.snapToIndicators));
    setPressed("toggle-stay", this.stayInDrawingMode, this.stayInDrawingMode ? "pin-locked" : "pin");
    setPressed("toggle-lock", this.drawingsLocked, this.drawingsLocked ? "lock" : "unlock", this.drawingsLocked ? "解锁全部绘图" : "锁定全部绘图");
    const aiAndPlansHidden = this.drawingVisibility.aiHidden && this.drawingVisibility.plansHidden;
    setPressed("toggle-visibility", aiAndPlansHidden, aiAndPlansHidden ? "drawings-hidden" : "drawings-visible", aiAndPlansHidden ? "显示AI绘图和计划线" : "隐藏AI绘图和计划线");
    const visibility = this.drawingVisibility.layers();
    this.toolbar.querySelectorAll<HTMLElement>('[data-drawing-visibility-layer]').forEach(button => {
      const layer = TRADING_VISIBILITY_LAYERS.find(({ key }) => key === button.dataset.drawingVisibilityLayer);
      if (layer) button.setAttribute('aria-checked', String(visibility[layer.key]));
    });
    const undo = this.toolbar.querySelector<HTMLButtonElement>('[data-drawing-action="undo"]');
    const redo = this.toolbar.querySelector<HTMLButtonElement>('[data-drawing-action="redo"]');
    if (undo) undo.disabled = !canUndo;
    if (redo) redo.disabled = !canRedo;
    this.toolbar.querySelectorAll<HTMLElement>('[data-favorite-tool]').forEach(button => {
      const id = button.dataset.favoriteTool as TradingDrawingToolId;
      const pressed = String(this.favoriteTools.has(id));
      if (button.dataset.favoriteState !== pressed) {
        button.dataset.favoriteState = pressed;
        button.setAttribute('aria-pressed', pressed);
        button.title = pressed === 'true' ? '从收藏移除' : '添加到收藏';
        button.setAttribute('aria-label', `${pressed === 'true' ? '取消收藏' : '收藏'}${tradingDrawingToolDefinition(id)?.label ?? ''}`);
      }
    });
    const favorites = this.toolbar.querySelector<HTMLElement>('[data-drawing-favorites-bar]');
    if (favorites) {
      favorites.hidden = !this.favoriteTools.size;
      updateTradingDrawingMarkup(favorites, [...this.favoriteTools].map(id => {
        const tool = tradingDrawingToolDefinition(id)!;
        return `<button type="button" data-drawing-action="select-tool" data-drawing-tool="${id}" aria-pressed="false" title="${tool.label}" aria-label="${tool.label}">${drawingIcon(tool.icon)}</button>`;
      }).join(''));
    }
    // Update after remembered primary tools and favorite buttons are rendered;
    // otherwise new/rebuilt buttons lose their selection until another change.
    this.toolbar.querySelectorAll<HTMLElement>("[data-drawing-tool]").forEach((button) => {
      const selected = !navigationTool && button.dataset.drawingTool === this.activeTool;
      button.classList.toggle("active", selected);
      const attribute = button.hasAttribute("aria-checked") ? "aria-checked" : "aria-pressed";
      if (button.getAttribute(attribute) !== String(selected)) button.setAttribute(attribute, String(selected));
    });
  }

  private updateSelectionToolbar(bounds: { width: number; height: number }) {
    if (deferInteractionRender(this.selectionToolbar, () => this.updateSelectionToolbar(bounds))) return;
    const drawing = this.selectedDrawing();
    if (!drawing) this.dismissedSelectionToolbarDrawingId = null;
    if (!drawing || this.drawingVisibility.manualHidden || this.dismissedSelectionToolbarDrawingId === drawing.id) {
      this.selectionToolbar.hidden = true;
      this.selectionToolbarStyleKey = '';
      return;
    }
    const styleKey = JSON.stringify([drawing.id, drawing.tool, drawing.source, drawing.color,
      drawing.lineStyle, drawing.lineWidth, drawing.textBackgroundColor, drawing.fontSize,
      drawing.bold, drawing.locked, drawing.fibonacci, this.drawingVisibility.isHidden(drawing), isDarkTheme()]);
    if (this.selectionToolbarStyleKey === styleKey && this.selectionToolbarPosition) {
      this.showSelectionToolbar();
      this.positionSelectionToolbar(bounds);
      return;
    }
    const definition = tradingDrawingToolDefinition(drawing.tool);
    const textMode = definition?.kind === "text";
    this.selectionToolbar.dataset.annotationMedia = String(drawing.tool === 'image' || drawing.tool === 'tweet');
    const editAction = this.selectionToolbar.querySelector<HTMLElement>('[data-drawing-selection-action="edit-text"]');
    if (editAction) {
      const media = drawing.tool === 'image' || drawing.tool === 'tweet';
      editAction.innerHTML = media ? horizontalLineSettingsIcon : selectionIcon('color');
      editAction.setAttribute('aria-label', translateAppText(media ? '绘图设置' : '文本输入'));
      editAction.title = translateAppText(media ? '绘图设置' : '文本输入');
    }
    const textEntry = this.selectionToolbar.querySelector('[data-drawing-selection-action="edit-text"]')?.closest<HTMLElement>('.trading-drawing-selection-menu-wrap');
    // Text annotations are edited directly on the chart; no separate pen button.
    if (textEntry) textEntry.hidden = isInlineAnnotation(drawing) || isManualPriceNote(drawing);
    this.selectionToolbar.querySelectorAll<HTMLElement>('[data-harmonic-style-control]').forEach(control => {
      control.hidden = !isReferencePatternDrawing(drawing.tool) || ['abcd', 'three-drives'].includes(drawing.tool) && control.dataset.drawingSelectionAction === 'pattern-fill';
      if ((isRangeDrawing(drawing.tool) || drawing.tool === 'time-cycles' || drawing.tool === 'sector') && control.dataset.drawingSelectionAction === 'pattern-fill') control.hidden = false;
      if (isRangeDrawing(drawing.tool) && control.dataset.drawingSelectionAction === 'pattern-label') control.hidden = false;
    });
    const settings = this.selectionToolbar.querySelector<HTMLElement>('[data-horizontal-line-settings]');
    if (settings) settings.hidden = !tradingDrawingSupportsSettings(drawing.tool);
    this.selectionToolbar.querySelectorAll<HTMLElement>("[data-drawing-selection-mode]").forEach((mode) => {
      mode.hidden = (mode.dataset.drawingSelectionMode === "text") !== textMode;
    });
    this.selectionToolbar.querySelectorAll<HTMLElement>('[data-drawing-selection-mode="drawing"] > .trading-drawing-selection-menu-wrap').forEach(control => { control.hidden = isVolumeProfile(drawing.tool); });
    this.selectionToolbar.dataset.mode = textMode ? "text" : "drawing";
    const pointEntries = drawing.points
      .map((_point, index) => ({ index, point: this.drawingPointToScreen(drawing, index, bounds) }))
      .filter((entry): entry is { index: number; point: ScreenPoint } => Boolean(entry.point));
    const points = pointEntries.map((entry) => entry.point);
    if (!points.length && !this.drawingVisibility.isHidden(drawing)) {
      this.selectionToolbar.hidden = true;
      return;
    }
    if (!points.length) points.push({ x: 20, y: 80 });
    const defaults = drawing.source === 'ai' ? undefined : manualDrawingDefaults(drawing.tool);
    const color = drawing.color ?? defaults?.color ?? (textMode
      ? isDarkTheme() ? DEFAULT_TEXT_COLOR_DARK : DEFAULT_TEXT_COLOR_LIGHT
      : isDarkTheme() ? DEFAULT_DRAWING_COLOR_DARK : DEFAULT_DRAWING_COLOR_LIGHT);
    const style = drawing.lineStyle ?? drawing.fibonacci?.lineStyle ?? defaults?.lineStyle ?? "solid";
    const width = drawing.lineWidth ?? drawing.fibonacci?.lineWidth ?? defaults?.lineWidth ?? DEFAULT_DRAWING_LINE_WIDTH;
    this.selectionToolbar.style.setProperty('--drawing-current-color', color);
    const patternFillIndicator = this.selectionToolbar.querySelector<HTMLElement>('[data-pattern-fill-color]');
    if (patternFillIndicator && drawing.tool === 'sector') patternFillIndicator.style.background = drawing.textBackgroundColor ?? '#9c6ade33';
    if (patternFillIndicator && isRangeDrawing(drawing.tool)) patternFillIndicator.style.background = rangeFillColor(drawing);
    if (patternFillIndicator && drawing.tool === 'time-cycles') patternFillIndicator.style.background = cycleFillColor(drawing);
    if (patternFillIndicator && isReferencePatternDrawing(drawing.tool)) patternFillIndicator.style.background = harmonicFillColor(drawing);
    const colorIndicator = this.selectionToolbar.querySelector<HTMLElement>('[data-drawing-current-color]');
    const levelColors = isFibonacciProjection(drawing.tool) && drawing.tool !== 'fib-spiral'
      ? [...new Set(fibonacciOptionsForDrawing(drawing).levels.filter(level => level.enabled).map(level => level.color))] : [];
    if (colorIndicator) colorIndicator.style.background = levelColors.length > 1
      ? `linear-gradient(90deg, ${levelColors.join(', ')})` : levelColors[0] ?? color;
    const stylePreview = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-style-preview]");
    if (stylePreview) stylePreview.className = `trading-drawing-line-preview ${style}`;
    const widthPreview = this.selectionToolbar.querySelector<HTMLElement>("[data-drawing-width-preview]");
    widthPreview?.style.setProperty("--drawing-width", `${width}px`);
    const widthLabel = this.selectionToolbar.querySelector<HTMLElement>('[data-drawing-width-value]');
    if (widthLabel) widthLabel.textContent = `${width}px`;
    const widthMenu = this.selectionToolbar.querySelector<HTMLElement>('[data-drawing-selection-popover="width"]');
    if (widthMenu) updateTradingDrawingMarkup(widthMenu, (drawing.tool === 'highlighter' ? [10, 20, 30, 40] : [1, 2, 3, 4]).map(value =>
      `<button type="button" class="line-width-option" style="--line-width:${drawing.tool === 'highlighter' ? value / 10 : value}px" data-drawing-selection-action="set-width" data-drawing-width="${value}" role="menuitemradio" aria-checked="false" aria-label="${value} 像素">${value}px</button>`).join(''));
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
    const fontSize = drawing.fontSize ?? (isInlineAnnotation(drawing) ? PLAIN_TEXT_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
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
      updateTradingDrawingMarkup(lock, selectionIcon(drawing.locked ? "unlock" : "lock"));
      lock.setAttribute("aria-pressed", String(Boolean(drawing.locked)));
      lock.setAttribute("aria-label", drawing.locked ? "解锁" : "锁定");
      lock.title = drawing.locked ? "解锁" : "锁定";
    });
    this.selectionToolbar.dataset.locked = String(Boolean(drawing.locked));
    const hidden = this.drawingVisibility.isHidden(drawing);
    this.selectionToolbar.querySelectorAll<HTMLButtonElement>('[data-drawing-selection-action="toggle-visibility"]').forEach(button => {
      updateTradingDrawingMarkup(button, selectionIcon(hidden ? 'eye-closed' : 'eye'));
      button.setAttribute('aria-pressed', String(hidden));
      button.setAttribute('aria-label', hidden ? '显示此画线' : '隐藏此画线');
      button.title = hidden ? '显示此画线' : '隐藏此画线';
    });
    this.showSelectionToolbar();
    this.selectionToolbarStyleKey = styleKey;
    const { width: panelWidth, height: panelHeight } = this.selectionToolbarSize;
    if (!this.selectionToolbarPosition && (isVolumeDrawing(drawing.tool) || isRangeDrawing(drawing.tool) || isCycleDrawing(drawing.tool) || isPredictionDrawing(drawing.tool))) {
      this.selectionToolbarPosition = { x: (bounds.width - panelWidth) / 2, y: isPredictionDrawing(drawing.tool) ? 38 : 18 };
    }
    if (!this.selectionToolbarPosition) {
      if (isInlineAnnotation(drawing) && !isAnnotationTable(drawing)) {
        const box = annotationTextGeometry(drawing, points, drawing.text || translateAppText('添加文字'));
        points.push({ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height });
      }
      // Curves and rotated labels can extend above their control points.
      // Include the label when initially placing the toolbar so it stays editable.
      const hasText = Boolean(drawing.text?.trim());
      const label = tradingDrawingLabelGeometry(hasText ? drawing : { ...drawing, text: '＋ 添加文字', fontSize: 12, textAlign: 'center', textVerticalAlign: 'top' }, points, bounds, hasText ? undefined : { width: 84, height: 22 });
      if (label) {
        const radians = label.angle * Math.PI / 180;
        const width = hasText ? label.layout.width : 84, height = hasText ? label.layout.height : 22;
        for (const x of [label.left, label.left + width]) for (const y of [label.top, label.top + height]) {
          points.push({ x: label.x + (x - label.x) * Math.cos(radians) - (y - label.y) * Math.sin(radians), y: label.y + (x - label.x) * Math.sin(radians) + (y - label.y) * Math.cos(radians) });
        }
      }
      if (drawing.tool === 'rotated-rectangle') points.push(...(this.rotatedRectangleGeometry(drawing)?.corners ?? []));
      const minimumX = Math.min(...points.map((point) => point.x));
      const maximumX = Math.max(...points.map((point) => point.x));
      const minimumY = Math.min(...points.map((point) => point.y));
      const maximumY = Math.max(...points.map((point) => point.y));
      const centeredLeft = (minimumX + maximumX - panelWidth) / 2;
      const patternLabelGap = isElliottWave(drawing.tool) ? (drawing.fontSize ?? ELLIOTT_FONT_SIZE) + 20
        : isReferencePatternDrawing(drawing.tool) ? (drawing.fontSize ?? 14) + 20 : 18;
      const preferredTop = minimumY - panelHeight - patternLabelGap;
      const belowTop = maximumY + patternLabelGap;
      this.selectionToolbarPosition = { x: centeredLeft, y: preferredTop >= 8 ? preferredTop : belowTop };
    }
    this.positionSelectionToolbar(bounds);
  }

  private positionSelectionToolbar(bounds: { width: number; height: number }) {
    if (!this.selectionToolbarPosition || this.selectionToolbar.hidden) return;
    const position = clampTradingDrawingToolbarPosition(this.selectionToolbarPosition, bounds, this.selectionToolbarSize, 12);
    this.selectionToolbarPosition = position;
    if (this.selectionToolbar.style.left !== `${position.x}px`) this.selectionToolbar.style.left = `${position.x}px`;
    if (this.selectionToolbar.style.top !== `${position.y}px`) this.selectionToolbar.style.top = `${position.y}px`;
  }

  private updateAxisMarkers(bounds: { width: number; height: number }) {
    const selected = this.fibonacciSettingsPreview ?? (this.draft && (isRangeDrawing(this.draft.tool) || isVolumeDrawing(this.draft.tool) || isReferencePatternDrawing(this.draft.tool) || isElliottWave(this.draft.tool) || isCycleDrawing(this.draft.tool) || isPredictionDrawing(this.draft.tool)) ? this.draft : this.selectedDrawing());
    const selectedDrawing = selected && !this.drawingVisibility.isHidden(selected)
      && (!selected.fibonacci || fibonacciVisibleAtInterval(selected.fibonacci, this.getInterval())) ? selected : null;
    if (this.drawingVisibility.manualHidden) {
      updateTradingDrawingMarkup(this.axisMarkerLayer, "");
      return;
    }
    const visibleDrawings = this.drawings.filter((drawing) => (
      tradingManualDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval(), this.drawingScope)
      && !this.drawingVisibility.isHidden(drawing)
    ));
    const persistentHorizontalDrawings = visibleDrawings.filter((drawing) => (
      (tradingDrawingToolDefinition(drawing.tool)?.kind === "horizontal" || drawing.tool === 'anchored-vwap' || drawing.tool === 'anchored-volume-profile')
      && drawing.showPriceLabel !== false
    ));
    const markerDrawings = [
      ...persistentHorizontalDrawings,
      ...(selectedDrawing && !persistentHorizontalDrawings.some((drawing) => drawing.id === selectedDrawing.id)
        ? [selectedDrawing]
        : []),
    ];
    const markers = markerDrawings.flatMap((drawing) => {
      const definition = tradingDrawingToolDefinition(drawing.tool);
      if (drawing.tool === 'anchored-volume-profile') {
        const profile = this.volumeProfileForDrawing(drawing);
        const anchor = this.volumeAnchors(drawing)[0];
        const pending = drawing === this.draft || this.dragState?.drawingId === drawing.id || this.volumeProfileTimers.has(drawing.id);
        const markers = profile?.total && profile.options.showPoc && drawing.showPriceLabel !== false && !pending
          ? [{ point: { time: profile.startTime, price: profile.poc }, showPrice: true, showTime: false, drawingId: drawing.id, markerColor: '#131722' }] : [];
        if (anchor && drawing.id === selectedDrawing?.id) markers.push({ point: anchor, showPrice: false, showTime: true, drawingId: drawing.id, markerColor: '#2962ff' });
        return markers;
      }
      if (drawing.tool === 'anchored-vwap') {
        const latest = calculateAnchoredVwap(this.getCandles(), drawing.points[0].time, drawing.vwap).at(-1);
        const anchor = this.volumeAnchors(drawing)[0];
        const markers = latest && drawing.showPriceLabel !== false ? [{ point: latest as TradingDrawingPoint, showPrice: true, showTime: false, drawingId: drawing.id, markerColor: drawing.color ?? '#1e88e5' }] : [];
        if (anchor && drawing.id === selectedDrawing?.id) markers.push({ point: anchor, showPrice: false, showTime: true, drawingId: drawing.id, markerColor: '#2962ff' });
        return markers;
      }
      if (!definition) return [];
      if (isPositionDrawing(drawing.tool)) {
        const points = positionAnchors(drawing), options = normalizePositionOptions(drawing.position);
        return points.map((point, i) => ({ point, showPrice: i !== 1 && drawing.showPriceLabel !== false, showTime: false,
          drawingId: drawing.id, markerColor: i === 2 ? options.profitColor : i === 3 ? options.lossColor : '#808080' }))
          .concat(points.slice(0, 2).map(point => ({ point, showPrice: false, showTime: true, drawingId: drawing.id, markerColor: '#2962ff' })));
      }
      const axisPoints = drawing.tool === 'fixed-range-volume' ? (drawing === this.draft || this.dragState?.drawingId === drawing.id ? drawing.points : this.volumeAnchors(drawing))
        : isCycleDrawing(drawing.tool) ? cycleAnchorPoints(drawing.tool, drawing.points)
        : drawing.tool === 'fib-wedge' || drawing.tool === 'sector'
        ? drawing.points.map((point, index) => {
            const screen = this.drawingPointToScreen(drawing, index, bounds);
            return screen ? this.screenToDrawingPoint(screen, false) ?? point : point;
          })
        : drawing.tool === 'regression-trend'
        ? calculateRegressionTrend(this.getCandles(), drawing.points, drawing.regression)?.anchors ?? []
        : (isTradingPitchfork(drawing.tool) || isReferencePatternDrawing(drawing.tool) || isElliottWave(drawing.tool)) && drawing === this.draft
          ? drawing.points.slice(0, this.draftConfirmedPointCount) : drawing.points;
      const markerPoints = definition.kind === "horizontal"
        ? tradingDrawingAlwaysVisibleAxisMarkerPoints(definition, drawing.points)
        : drawing.tool === 'sector' ? axisPoints.map(point => ({ point, showPrice: true, showTime: true }))
        : tradingDrawingAxisMarkerPoints(definition, axisPoints);
      const active = drawing.id === selectedDrawing?.id;
      const markerColor = isRangeDrawing(drawing.tool) || isVolumeDrawing(drawing.tool) || isPredictionDrawing(drawing.tool) || isCycleDrawing(drawing.tool) || isTradingPitchfork(drawing.tool) || isFibonacciProjection(drawing.tool) || isReferencePatternDrawing(drawing.tool) || isElliottWave(drawing.tool) ? '#2962ff'
        : drawing.tool === 'info-line' || drawing.tool === 'trend-angle' || drawing.tool === 'regression-trend' ? drawing.color ?? manualDrawingDefaults(drawing.tool).color
        : active ? DRAWING_SELECTION_COLOR : drawing.color ?? manualDrawingDefaults(drawing.tool).color;
      return markerPoints.map((marker) => ({ ...marker, showPrice: marker.showPrice && drawing.showPriceLabel !== false, drawingId: drawing.id, markerColor }));
    })
      .map((marker) => ({ ...marker, screen: this.pointToScreen(marker.point) }))
      .filter((marker): marker is TradingDrawingAxisMarkerPoint & { drawingId: string; markerColor: string; screen: ScreenPoint } => Boolean(marker.screen));
    const chart = this.getChart();
    const priceAxisLabel = chart ? tradingPriceAxisLabelGeometry(chart, this.paneIndex) : null;
    const priceScaleWidth = this.drawingScope === "main" ? Math.max(priceAxisLabel?.width || 0, 64) : 0;
    const priceLabelLeft = priceAxisLabel?.overlay ? Math.max(0, bounds.width - priceScaleWidth) : bounds.width;
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
    const patternMarkerTops = new Map<(typeof priceMarkers)[number], number>();
    if (selectedDrawing && isReferencePatternDrawing(selectedDrawing.tool)) {
      const ordered = [...priceMarkers].sort((a, b) => a.screen.y - b.screen.y);
      const spacing = Math.min(24, bounds.height / Math.max(ordered.length, 1));
      let previous = -spacing / 2;
      for (const marker of ordered) {
        previous = Math.max(marker.screen.y, previous + spacing);
        patternMarkerTops.set(marker, previous);
      }
      let next = bounds.height + spacing / 2;
      for (const marker of ordered.reverse()) {
        next = Math.min(patternMarkerTops.get(marker)!, next - spacing);
        patternMarkerTops.set(marker, next);
      }
    }
    const priceHtml = priceScaleWidth > 0 ? priceMarkers.map((marker) => {
      const top = patternMarkerTops.get(marker) ?? Math.min(Math.max(marker.screen.y, 12), Math.max(12, bounds.height - 12));
      return `<div class="trading-drawing-axis-marker price" data-drawing-axis-price style="--trading-drawing-axis-marker:${marker.markerColor};--trading-drawing-axis-marker-text:${marker.markerColor === DRAWING_SELECTION_COLOR ? "var(--interaction-on-accent)" : "#fff"};left:${priceLabelLeft}px;top:${top}px;width:${priceScaleWidth}px">${escapeHtml(formatTradingDrawingAxisPrice(marker.point.price))}</div>`;
    }).join("") : "";
    const timeHalfWidth = 70;
    const minimumTimeX = Math.min(timeHalfWidth + 4, bounds.width / 2);
    const maximumTimeX = Math.max(minimumTimeX, bounds.width - timeHalfWidth - 4);
    const timeHtml = timeMarkers.map((marker) => {
      const left = Math.min(Math.max(marker.screen.x, minimumTimeX), maximumTimeX);
      return `<time class="trading-drawing-axis-marker time" data-drawing-axis-time style="--trading-drawing-axis-marker:${marker.markerColor};--trading-drawing-axis-marker-text:${marker.markerColor === DRAWING_SELECTION_COLOR ? "var(--interaction-on-accent)" : "#fff"};left:${left}px">${escapeHtml(formatTradingDrawingAxisTime(marker.point.time, this.timeOffsetSeconds))}</time>`;
    }).join("");
    let infoLineRange = '';
    if ((selectedDrawing?.tool === 'info-line' || selectedDrawing?.tool === 'trend-angle') && priceScaleWidth > 0) {
      const endpoints = selectedDrawing.points.map(point => this.pointToScreen(point)).filter((point): point is ScreenPoint => point !== null);
      if (endpoints.length === 2) {
        const top = Math.max(0, Math.min(endpoints[0].y, endpoints[1].y));
        const bottom = Math.min(bounds.height, Math.max(endpoints[0].y, endpoints[1].y));
        const color = selectedDrawing.color ?? manualDrawingDefaults(selectedDrawing.tool).color;
        const rangeClass = selectedDrawing.tool === 'trend-angle' ? 'trading-trend-angle-axis-range' : 'trading-info-line-axis-range';
        if (bottom > top) infoLineRange = `<div class="${rangeClass}" style="left:${priceLabelLeft}px;top:${top}px;width:${priceScaleWidth}px;height:${bottom - top}px;background:${color}"></div>`;
      }
    }
    let harmonicRange = '';
    if (selectedDrawing && (isRangeDrawing(selectedDrawing.tool) || selectedDrawing.tool === 'fixed-range-volume' || isCycleDrawing(selectedDrawing.tool) || isReferencePatternDrawing(selectedDrawing.tool) || isFibonacciProjection(selectedDrawing.tool) || isElliottWave(selectedDrawing.tool) || isPredictionDrawing(selectedDrawing.tool))) {
      const endpoints = (isPositionDrawing(selectedDrawing.tool) ? positionAnchors(selectedDrawing).map(p => this.pointToScreen(p))
        : selectedDrawing.points.map((_point, index) => this.drawingPointToScreen(selectedDrawing, index, bounds))).filter((p): p is ScreenPoint => p !== null);
      if (endpoints.length > 1) {
        const top = Math.max(0, Math.min(...endpoints.map(p => p.y))), bottom = Math.min(bounds.height, Math.max(...endpoints.map(p => p.y)));
        const left = Math.max(0, Math.min(...endpoints.map(p => p.x))), right = Math.min(bounds.width, Math.max(...endpoints.map(p => p.x)));
        if (priceScaleWidth && bottom > top) harmonicRange += `<div class="trading-harmonic-axis-range" style="left:${priceLabelLeft}px;top:${top}px;width:${priceScaleWidth}px;height:${bottom - top}px"></div>`;
        if (right > left) harmonicRange += `<div class="trading-harmonic-axis-range" data-pattern-time-range style="left:${left}px;bottom:0;width:${right - left}px;height:28px"></div>`;
      }
    }
    updateTradingDrawingMarkup(this.axisMarkerLayer, infoLineRange + harmonicRange + priceHtml + timeHtml);
  }

  async playAiDrawingPatch(
    patch: TradingAiDrawingPatch,
    options: {
      onPhase?: (phase: TradingAiPlaybackPhase, drawing?: TradingAiDrawing) => void;
      beforePlayback?: () => void | Promise<void>;
      shouldContinue?: () => boolean;
      speedMultiplier?: number;
    } = {},
  ) {
    // Validate the complete patch before omitting arrows from the visible playback.
    const drawings = this.normalizeAiDrawingPatch(patch)
      .filter(drawing => !isHiddenAiArrowDrawing({ source: 'ai', tool: drawing.tool }));
    const playbackStorageSessionId = this.storageSessionId;
    // Explicit removal must also invalidate pending playback and its final patch save.
    const playbackClearVersion = this.aiDrawingClearVersion;
    this.cancelAiPlayback({ clear: true });
    this.aiPlaybackDeletedTextIds.clear();
    const playbackVersion = ++this.aiDrawingPlaybackVersion;
    this.aiDrawingSetPlaying = true;
    let fitCompletedPlan = false;
    try {
      await options.beforePlayback?.();
      if (
        this.destroyed
        || this.aiDrawingClearVersion !== playbackClearVersion
        || this.storageSessionId !== playbackStorageSessionId
        || this.getSymbol() !== patch.marketId
        || this.getInterval() !== patch.interval
        || this.aiDrawingPlaybackVersion !== playbackVersion
        || options.shouldContinue?.() === false
      ) return;
      await this.aiPlayback.play(drawings, options);
      if (
        !this.destroyed
        && this.aiDrawingClearVersion === playbackClearVersion
        && this.storageSessionId === playbackStorageSessionId
        && this.getSymbol() === patch.marketId
        && this.getInterval() === patch.interval
        && this.aiDrawingPlaybackVersion === playbackVersion
        && options.shouldContinue?.() !== false
      ) {
        // Playback cancellation is intentionally non-throwing. Re-apply the complete
        // patch so a cancelled frame sequence can never leave a blank or partial chart.
        this.storeAiDrawingPatch(patch);
        fitCompletedPlan = true;
      }
    } finally {
      if (this.aiDrawingPlaybackVersion === playbackVersion) {
        this.aiPlaybackDeletedTextIds.clear();
        this.aiDrawingSetPlaying = false;
        this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
        if (!this.destroyed) {
          if (fitCompletedPlan) this.fitCompletedAiPlan();
          else this.redraw();
        }
      }
    }
  }

  showExecutionPlanDrawing(patch: TradingAiDrawingPatch) {
    this.cancelAiPlayback();
    this.storeAiDrawingPatch(patch);
    this.aiDrawingSets.select(patch, patch.analysisId);
    this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
    this.drawingVisibility.setLayers({aiHidden: false, plansHidden: false});
    this.persistAiDrawings(); this.fitCompletedAiPlan();
  }

  aiPlanPriceRange() { return this.aiPlanAutoscale?.priceRange() ?? null; }

  private fitCompletedAiPlan() {
    if (this.drawingScope !== 'main') { this.redraw(); return; }
    const chart = this.getChart();
    const drawings = projectStoredTradingPlanDrawings(this.aiDrawings, this.storageSessionId)
      .filter(drawing => tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval())
        && !isHiddenOrderFlowAnnotation(drawing) && !isHiddenAiArrowDrawing(drawing)
        && (!this.drawingVisibility.aiHidden || ['strategy-entry', 'strategy-stop', 'strategy-target'].includes(drawing.colorToken || '')));
    const logicalRange = this.drawingVisibility.plansHidden ? null
      : tradingAnalysisPlanFocusRange(drawings, this.getCandles(), this.plotBounds().width);
    if (logicalRange) chart?.timeScale().setVisibleLogicalRange(logicalRange);
    this.aiPlanAutoscale ??= new TradingAiPlanAutoscale();
    this.redraw();
    if (!this.aiPlanPriceRange()) return;
    chart?.priceScale('right', this.paneIndex).setAutoScale(true);
    this.redraw();
    this.getNavigation?.()?.schedule();
  }

  storeAiDrawingPatch(patch: TradingAiDrawingPatch) {
    const drawings = normalizeTradingAiDrawingPatch(patch).map(tradingAiDrawingModel);
    this.aiDrawingSets.upsert(patch, patch.drawingTurnId || patch.analysisId, patch.analysisId, drawings, patch.baseRevision);
    this.aiDrawings = replaceTradingAiDrawingContext(
      this.aiDrawings,
      patch.marketId,
      patch.interval,
      drawings,
    );
    this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
    if (this.aiDrawingSetPlaying && this.aiPlaybackDeletedTextIds.size) {
      this.aiDrawings = this.aiDrawings.filter(drawing => !tradingAiDrawingMatchesContext(drawing, patch.marketId, patch.interval)
        || !this.aiPlaybackDeletedTextIds.has(drawing.id));
      // The final complete playback patch must not resurrect a label deleted
      // while later objects were still being animated.
      this.aiDrawingSets.updateSelected(this.aiDrawings);
    }
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
      // Playback can temporarily clear the visible view, but the completed
      // alternatives stay intact until the new patch has finished.
      const wasPlaying = this.aiDrawingSetPlaying;
      this.aiDrawingSetPlaying = true;
      this.persistAiDrawings(false);
      this.aiDrawingSetPlaying = wasPlaying;
    }
    this.redraw();
  }

  clearAiDrawings() {
    this.aiDrawingClearVersion += 1;
    this.aiDrawingSets.clear({ marketId: this.getSymbol(), interval: this.getInterval() });
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
    this.aiDrawingSets.clear({ marketId: this.getSymbol(), interval: this.getInterval() }, normalizedStrategyId);
    const previousLength = this.aiDrawings.length;
    this.aiDrawings = this.aiDrawings.filter((drawing) => (
      !tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval())
      || drawing.strategyId !== normalizedStrategyId
    ));
    this.aiDrawings = this.aiDrawingSets.selectedDrawings(this.aiDrawings);
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
    if (!this.aiCursorPoint || this.drawingsHidden || this.drawingVisibility.aiHidden || this.destroyed) {
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
    this.volumeCalculations.clear();
    this.volumeHistory?.useContext(`${this.getSymbol()}|${this.getInterval()}`);
    if (!this.selectedDrawing()) {
      this.overlay.classList.remove('drawing-handles-idle');
    }
    this.projectionTimes = new Map();
    try {
    this.cancelDragRedraw();
    this.flushPointerMoves();
    if (!this.applyingManualSync) this.manualSync?.contextChanged();
    const bounds = this.plotBounds();
    const viewBox = `0 0 ${bounds.width} ${bounds.height}`;
    this.positionHorizontalLineTextEdit(bounds);
    if (this.overlay.getAttribute("viewBox") !== viewBox) this.overlay.setAttribute("viewBox", viewBox);
    if (this.overlay.getAttribute("width") !== String(bounds.width)) this.overlay.setAttribute("width", String(bounds.width));
    if (this.overlay.getAttribute("height") !== String(bounds.height)) this.overlay.setAttribute("height", String(bounds.height));
    // Only the price-line surface spans the right axis. All drawing geometry
    // remains clipped to its own plot/pane, including during zoom and resize.
    const orderLineOverlay = this.orderLineContent.ownerSVGElement;
    const priceScaleWidth = orderLineOverlay ? Math.max(0, this.getChart()?.priceScale("right").width() ?? 0) : 0;
    const priceLabelChart = orderLineOverlay ? this.getChart() : null;
    const priceAxisLabel = priceLabelChart ? tradingPriceAxisLabelGeometry(priceLabelChart, this.paneIndex) : null;
    const orderLineBounds = { ...bounds, priceScaleWidth,
      ...(priceAxisLabel?.overlay ? { priceScaleOverlayWidth: priceAxisLabel.width } : {}) };
    if (orderLineOverlay) {
      const width = bounds.width + priceScaleWidth;
      const attributes = { viewBox: `0 0 ${width} ${bounds.height}`, width: String(width), height: String(bounds.height) };
      for (const [name, value] of Object.entries(attributes)) {
        if (orderLineOverlay.getAttribute(name) !== value) orderLineOverlay.setAttribute(name, value);
      }
    }
    const candleSeries = this.getCandleSeries();
    const priceToCoordinate = (price: number) => finiteTradingChartCoordinate(candleSeries?.priceToCoordinate(price));
    const symbol = this.getSymbol();
    const interval = this.getInterval();
    const aiSourceDrawings = this.drawingScope === "main"
      ? projectStoredTradingPlanDrawings(this.aiDrawings, this.storageSessionId).filter((drawing) => tradingAiDrawingMatchesContext(drawing, symbol, interval))
      : [];
    if (this.drawingScope === "main"
      && this.aiDraft && tradingAiDrawingMatchesContext(this.aiDraft, symbol, interval)) {
      aiSourceDrawings.push(this.aiDraft);
    }
    const planPriceLines = buildTradingPlanPriceLines(aiSourceDrawings);
    this.aiPlanAutoscale?.update(candleSeries, this.aiDrawingSetPlaying || this.drawingVisibility.plansHidden ? null
      : tradingAiPlanFitRange(planPriceLines.lines.map(line => line.price),
        this.drawingVisibility.aiHidden ? [] : aiSourceDrawings.filter(drawing => !isHiddenOrderFlowAnnotation(drawing) && !isHiddenAiArrowDrawing(drawing)),
        tradingAnalysisVisibleTimeRange(this.getCandles(), this.getChart()?.timeScale().getVisibleLogicalRange() ?? null)));
    const displayedOrderLines = [
      ...(this.drawingVisibility.ordersHidden ? [] : this.orderLines),
      ...(this.drawingVisibility.plansHidden ? [] : planPriceLines.lines),
    ];
    const planObstacles = tradingPlanPriceLineObstacles(displayedOrderLines, symbol, orderLineBounds, priceToCoordinate);
    // Most charts have no order labels or notes to avoid. Do not scan history
    // just to render an empty layer, and share the work when both need it.
    let obstacles: TradingDrawingCollisionRect[] | null = null;
    const candleObstacles = () => obstacles ??= this.drawingScope === "main" ? this.visibleCandleObstacles(bounds) : [];
    // Resolve drawing text first, then place price badges using this frame's
    // actual glyph bounds (including wrapped region labels and rotated text).
    const renderOrderLines = () => {
      const annotationObstacles = displayedOrderLines.length && !this.drawingsHidden
        ? tradingDrawingLabelObstacles(this.overlay, [this.content, this.aiContent]) : [];
      updateTradingDrawingMarkup(this.orderLineContent, candleSeries && this.drawingScope === "main" && displayedOrderLines.length
        ? renderTradingOrderLineSvg(
          displayedOrderLines,
          this.getSymbol(),
          orderLineBounds,
          priceToCoordinate,
          candleObstacles(),
          annotationObstacles,
        )
        : "");
      updateTradingDrawingMarkup(this.orderPositionCardLayer, candleSeries && this.drawingScope === "main" && displayedOrderLines.length
        ? renderTradingOrderPositionCards(
          displayedOrderLines,
          this.getSymbol(),
          bounds,
          priceToCoordinate,
          candleObstacles(),
          annotationObstacles,
        )
        : "");
      fitTradingOrderLineLabels(this.orderLineContent, this.orderPositionCardLayer, bounds);
      this.setOpenOrderPositionCard(this.openOrderPositionCardId);
    };
    if (this.drawingsHidden) {
      this.manualLayer.render([]);
      updateTradingDrawingMarkup(this.aiContent, "");
      updateTradingDrawingMarkup(this.aiTextHitContent, "");
      updateTradingDrawingMarkup(this.aiCursorContent, "");
      renderOrderLines();
      this.updateAiTextSizeToolbar(bounds);
      this.updateSelectionToolbar(bounds);
      this.updateAxisMarkers(bounds);
      this.updateToolbarState();
      return;
    }
    const drawings = this.drawings.filter((drawing) => (
      tradingManualDrawingMatchesContext(drawing, symbol, interval, this.drawingScope)
      && !this.drawingVisibility.manualHidden
      && !this.drawingVisibility.isHidden(drawing)
    ));
    if (!this.drawingVisibility.manualHidden && this.draft && tradingManualDrawingMatchesContext(this.draft, symbol, interval, this.drawingScope)) drawings.push(this.draft);
    this.manualLayer.render(drawings.map(drawing => {
      const render = () => this.renderDrawing(drawing, bounds, drawing === this.draft);
      // Labels and add-text prompts stay screen-sized during zoom. Reconcile
      // their attributes instead of scaling the whole segment group.
      if (drawing.tool === 'trend-line' && drawing.points.length === 2 && drawing !== this.draft
        && drawing.id !== this.selectedDrawingId && drawing.source !== 'ai' && !this.userDrawingEnabled && !drawing.text?.trim()) {
        const first = this.pointToScreen(drawing.points[0]), second = this.pointToScreen(drawing.points[1]);
        const clipped = first && second && clipTradingDrawingLine(first, second, bounds, 'segment');
        if (clipped) return { id: drawing.id, render, segment: {
          key: JSON.stringify([drawing.color, drawing.lineWidth, drawing.lineStyle, drawing.locked, drawing.source, drawing.text, isDarkTheme()]),
          x1: clipped[0].x, y1: clipped[0].y, x2: clipped[1].x, y2: clipped[1].y,
        } };
      }
      return { id: drawing.id, render };
    }));
    const aiDrawings = projectAiFibonacciDrawings(aiSourceDrawings.filter(drawing => !this.drawingVisibility.aiHidden && !planPriceLines.drawingIds.has(drawing.id) && !isHiddenOrderFlowAnnotation(drawing) && !isHiddenAiArrowDrawing(drawing))).drawings
      .map((drawing) => nativeAiDrawingDisplayModel(chartPatternNativeDrawingModel(tradingAiDrawingDisplayModel(drawing))));
    const aiFibonacciRenderings = new Map<string, NonNullable<ReturnType<typeof renderAiFibonacci>>>();
    const fibonacciLabelObstacles: TradingDrawingCollisionRect[] = [];
    for (const drawing of aiDrawings) {
      const rendered = renderAiFibonacci(drawing, point => this.pointToScreen(point), bounds, priceToCoordinate,
        price => formatTradingFibonacciPrice(price, true), [...planObstacles, ...fibonacciLabelObstacles],
        drawing.id === this.aiDraft?.id, drawing.tool === 'fib-retracement' ? candleObstacles() : []);
      if (rendered) { aiFibonacciRenderings.set(drawing.id, rendered); fibonacciLabelObstacles.push(...rendered.obstacles); }
    }
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
    const aiInlineRequests = aiDrawings.flatMap((drawing): TradingAiNoteLayoutRequest[] => {
      if (!planObstacles.length || !['text', 'anchored-text'].includes(drawing.tool)
        || tradingDrawingIsPriceActionCandlestickPatternLabel(drawing) || !drawing.text) return [];
      const anchor = this.drawingPointToScreen(drawing, 0, bounds);
      if (!anchor || !tradingDrawingScreenPointVisible(anchor, bounds)) return [];
      const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
      const layout = tradingDrawingTextLayout(drawing.text, fontSize);
      const rect = { x: anchor.x - layout.width / 2, y: anchor.y - fontSize, width: layout.width, height: layout.height };
      if (!planObstacles.some(obstacle => tradingDrawingRectsOverlap(rect, obstacle, AI_NOTE_CANDLE_GAP))) return [];
      return [{ id: drawing.id, anchor, text: drawing.text, fontSize }];
    });
    const aiTextLayoutRequests = [...aiCandlestickLabelRequests, ...aiNoteRequests, ...aiInlineRequests];
    const layoutRequestedIds = new Set(aiTextLayoutRequests.map(request => request.id));
    const aiTextLayouts = new Map((aiTextLayoutRequests.length
      ? layoutTradingAiNoteBoxes(
        aiTextLayoutRequests,
        bounds,
        candleObstacles(),
        [...orderFlowBoxObstacles, ...priceActionDrawingObstacles, ...gannTheoryBoxObstacles],
        [...planObstacles, ...fibonacciLabelObstacles],
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
        if ((drawing.tool === "note" || layoutRequestedIds.has(drawing.id)) && !textLayout) return "";
        const markup = this.renderDrawing(
          drawing,
          bounds,
          drawing.id === this.aiDraft?.id,
          false,
          textLayout,
          aiFibonacciRenderings.get(drawing.id),
        );
        return drawing.id === this.aiDraft?.id ? `<g opacity="${this.aiDraftOpacity}">${markup}</g>` : markup;
      })
      .map((markup) => `<g data-i18n-skip>${markup}</g>`)
      .join(""));
    updateTradingDrawingMarkup(this.aiTextHitContent, orderedAiDrawings
      .map((drawing) => {
        if (drawing.id === this.aiDraft?.id) return "";
        const textLayout = aiTextLayouts.get(drawing.id);
        if ((drawing.tool === "note" || layoutRequestedIds.has(drawing.id)) && !textLayout) return "";
        return this.renderAiTextSizeHitTarget(drawing, bounds, textLayout);
      })
      .join(""));
    renderOrderLines();
    this.renderAiCursor(bounds);
    this.updateAiTextSizeToolbar(bounds);
    this.updateToolbarState();
    this.updateSelectionToolbar(bounds);
    this.updateAxisMarkers(bounds);
    } finally { this.projectionTimes = null; this.hoverText?.refresh(); this.aiAnnotationHover?.refresh(); }
  }

  private renderDrawing(
    drawing: TradingDrawingModel,
    bounds: { width: number; height: number },
    draft: boolean,
    interactive = true,
    resolvedTextGeometry?: ReturnType<typeof tradingDrawingNoteBoxGeometry>,
    resolvedFibonacci?: NonNullable<ReturnType<typeof renderAiFibonacci>>,
  ) {
    if (this.fibonacciSettingsPreview?.id === drawing.id) drawing = this.fibonacciSettingsPreview;
    if ((drawing.tool === 'fib-retracement' || isFibonacciProjection(drawing.tool)) && drawing.fibonacci && !fibonacciVisibleAtInterval(drawing.fibonacci, this.getInterval())) return '';
    if (resolvedFibonacci) return this.renderDrawingFrame(drawing, [], bounds, draft, false, resolvedFibonacci.body, '', '');
    const definition = tradingDrawingToolDefinition(drawing.tool);
    if (!definition) return "";
    if (
      tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing)
      && tradingDrawingIsSingleCandlePatternSpan(this.getCandles(), drawing.points)
    ) return "";
    this.ensureAnchoredViewportAnchor(drawing);
    this.ensureArrowMarkerEndpoints(drawing);
    if ((isManualNote(drawing) || isCallout(drawing) || isAnnotationTable(drawing)) && drawing.points.length === 1) {
      const anchor = this.pointToScreen(drawing.points[0]);
      const label = anchor && this.screenToDrawingPoint(isAnnotationTable(drawing)
        ? { x: anchor.x + Math.min(540, Math.max(180, bounds.width - anchor.x - 8)), y: anchor.y + 144 }
        : { x: anchor.x + 60, y: anchor.y - 40 }, false);
      if (label) drawing.points.push(label);
    }
    if (isAnnotationTable(drawing)) return this.renderAnnotationTable(drawing, bounds, draft, interactive);
    if (drawing.tool === 'image' && drawing.source !== 'ai') return this.renderImageDrawing(drawing, bounds, interactive);
    if (drawing.tool === 'tweet' && drawing.source !== 'ai') return this.renderXPostDrawing(drawing, bounds, interactive);
    if (isRangeDrawing(drawing.tool) && drawing.points.length) {
      const points = drawing.points.map(p => this.pointToScreen(p)).filter((p): p is ScreenPoint => p !== null);
      const first = drawing.points[0], last = drawing.points.at(-1)!;
      const candles = this.getCandles(), from = tradingDrawingLogicalIndexAtTime(candles, first.time), to = tradingDrawingLogicalIndexAtTime(candles, last.time);
      const format = this.getCandleSeries()?.options?.().priceFormat;
      const measurements = rangeMeasurement({ start: first, end: last, candles, bars: from === null || to === null ? null : to - from, precision: format?.precision ?? 2, minMove: format?.minMove ?? .01 });
      const selected = interactive && drawing.id === this.selectedDrawingId;
      const result = renderRangeDrawing(drawing, points, bounds, measurements, selected, draft && interactive);
      return this.renderDrawingFrame(drawing, points, bounds, draft, interactive, result.body, interactive && !draft ? result.hit : '', result.handles);
    }
    if (isVolumeDrawing(drawing.tool) && drawing.points.length) {
      const selected = interactive && drawing.id === this.selectedDrawingId;
      const preview = draft || this.dragState?.drawingId === drawing.id || this.volumeProfileTimers.has(drawing.id);
      const result = drawing.tool === 'anchored-vwap'
        ? renderAnchoredVwap(drawing, this.getCandles(), p => this.pointToScreen(p), interactive && (selected || draft), bounds)
        : renderFixedVolume(drawing, this.getVolumeCandles(), p => this.pointToScreen(p), interactive && (selected || draft), preview, bounds, this.volumeProfileForDrawing(drawing));
      return this.renderDrawingFrame(drawing, drawing.points.map(p => this.pointToScreen(p)).filter((p): p is ScreenPoint => Boolean(p)), bounds, draft, interactive, result.body, interactive && !draft ? result.hit : '', result.handles);
    }
    if (isPredictionDrawing(drawing.tool)) {
      if (!draft && isPositionDrawing(drawing.tool) && drawing.points.length < 4) drawing.points = positionAnchors(drawing);
      if (!draft && drawing.tool === 'bars-pattern' && !drawing.barsPattern) {
        const capture=captureBarsPattern(drawing,this.getCandles());if(capture)Object.assign(drawing,capture);
      }
      const selected = interactive && drawing.id === this.selectedDrawingId;
      const result = isPredictionShape(drawing.tool)
        ? renderPredictionShape(drawing, p=>this.pointToScreen(p), this.getCandles(), bounds, selected, draft, draft ? this.draftConfirmedPointCount : drawing.points.length)
        : isPositionDrawing(drawing.tool)
        ? renderPositionDrawing(drawing, p => this.pointToScreen(p), this.getCandles(), bounds, selected, draft, translateDrawingText)
        : renderForecastDrawing(drawing, drawing.points.map(p => this.pointToScreen(p)).filter((p): p is ScreenPoint => Boolean(p)), this.getCandles(), bounds, selected, draft, this.timeOffsetSeconds, translateDrawingText);
      return this.renderDrawingFrame(drawing, drawing.points.map(p => this.pointToScreen(p)).filter((p): p is ScreenPoint => Boolean(p)), bounds, draft, interactive, result.body, interactive && !draft ? result.hit : '', result.handles);
    }
    // Legacy two-point records have no saved opposite price. Retain both
    // anchors and use the endpoint price until the user adjusts the other edge.
    if (!draft && tradingDrawingIsShapedChannel(drawing.tool) && drawing.points.length === 2) drawing.points.push({ ...drawing.points[1] });
    const pointEntries = drawing.points
      .map((_point, index) => ({ index, point: this.drawingPointToScreen(drawing, index, bounds) }))
      .filter((entry): entry is { index: number; point: ScreenPoint } => Boolean(entry.point));
    const points = pointEntries.map((entry) => entry.point);
    if (!points.length) return "";
    const first = points[0];
    const second = (drawing.tool === 'parallel-channel' || drawing.tool === 'rotated-rectangle' || tradingDrawingIsShapedChannel(drawing.tool) ? points[1] : points[points.length - 1]) ?? first;
    const defaults = usesNativeAiDrawingStyle(drawing) ? nativeAiDrawingDefaults(drawing)
      : drawing.source === 'ai' ? undefined : manualDrawingDefaults(drawing.tool);
    const color = drawing.color ?? tradingAiDrawingColor(drawing.colorToken) ?? defaults?.color ?? (definition.kind === "text"
      ? isDarkTheme() ? DEFAULT_TEXT_COLOR_DARK : DEFAULT_TEXT_COLOR_LIGHT
      : isDarkTheme() ? DEFAULT_DRAWING_COLOR_DARK : DEFAULT_DRAWING_COLOR_LIGHT);
    const opacity = (draft ? 0.72 : 1) * (defaults?.opacity ?? 1);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const selected = interactive && drawing.id === this.selectedDrawingId;
    // Preserve legacy two-anchor extension/channel records. New drafts always
    // enter the dedicated renderer and acquire the third anchor explicitly.
    const projection = isFibonacciProjection(drawing.tool) && (draft || !isThreePointFibonacci(drawing.tool) || points.length >= 3)
      ? renderFibonacciProjection(drawing, points, bounds,
        price => finiteTradingChartCoordinate(this.getCandleSeries()?.priceToCoordinate(price)),
        y => finiteTradingChartCoordinate(this.getCandleSeries()?.coordinateToPrice(y)),
        price => formatTradingFibonacciPrice(price, true), clipTradingDrawingLine, this.drawingBarSpan(drawing)) : null;
    const fibonacci = drawing.tool === 'fib-retracement' && drawing.source !== 'ai'
      ? renderFibonacci(drawing, first, second, bounds,
        price => finiteTradingChartCoordinate(this.getCandleSeries()?.priceToCoordinate(price)),
        price => formatTradingFibonacciPrice(price, true), opacity) : null;
    const lineAppearance: TradingDrawingStrokeAppearance = {
      opacity,
      width: drawing.lineWidth ?? defaults?.lineWidth,
      style: drawing.lineStyle ?? defaults?.lineStyle,
      manualDefaults: defaults,
      customColor: Boolean(drawing.color),
      customWidth: drawing.lineWidth !== undefined,
      customStyle: drawing.lineStyle !== undefined,
    };
    const segmentLine = clipTradingDrawingLine(first, second, bounds, "segment") ?? [first, second];
    const rayLine = clipTradingDrawingLine(first, second, bounds, "ray") ?? [first, second];
    const extendedLine = clipTradingDrawingLine(first, second, bounds, "extended") ?? [first, second];
    if (tradingDrawingIsShapedChannel(drawing.tool) && points.length >= 3) {
      const oppositeStart = this.drawingPointToScreen(drawing, 3, bounds);
      if (oppositeStart) {
        pointEntries.push({ index: 3, point: oppositeStart });
        points.push(oppositeStart);
      }
    }
    if (drawing.tool === 'gann-box' && points.length >= 2) {
      for (const index of [2,3]) { const point=this.drawingPointToScreen(drawing,index,bounds);if(point)pointEntries.push({index,point}); }
    }
    const handleEntries = definition.kind === "fib" || isTradingPitchfork(drawing.tool) || drawing.tool === 'parallel-channel' || tradingDrawingIsShapedChannel(drawing.tool)
      ? pointEntries.filter(({ point }, index, entries) => !entries.slice(0, index).some((entry) => (
        Math.hypot(entry.point.x - point.x, entry.point.y - point.y) < 1
      )))
      : tradingDrawingPlacementMode(definition) === "single-click"
        ? pointEntries.slice(0, 1)
        : tradingDrawingIsMultiPoint(drawing.tool)
          ? tradingDrawingIsClosedPolyline(drawing) ? pointEntries.slice(0, -1) : pointEntries
          : pointEntries.slice(0, 12);
    const measurementHandles = drawing.tool === 'info-line' || drawing.tool === 'trend-angle' || drawing.tool === 'regression-trend';
    // Brush samples form a continuous stroke, not individually editable anchors.
    const showPointHandles = drawing.tool !== 'brush' && drawing.tool !== 'highlighter' && drawing.tool !== 'price-label' && !isPlainTextDrawing(drawing);
    let handles = interactive && (draft || selected) && showPointHandles
      ? definition.kind === "fib"
        ? handleEntries.map(({ point, index }) => `<circle class="trading-drawing-handle fibonacci" data-drawing-handle-index="${index}" data-fibonacci-endpoint="${index === 0 ? "100" : "0"}" cx="${point.x}" cy="${point.y}" r="${defaults ? DRAWING_HANDLE_RADIUS : FIBONACCI_HANDLE_RADIUS}" fill="var(--trading-market-panel)" stroke="${defaults ? DRAWING_SELECTION_COLOR : drawing.color ?? "var(--trading-fibonacci-handle-stroke)"}" stroke-width="${defaults ? 1.5 : 2}" vector-effect="non-scaling-stroke" />`).join("")
        : handleEntries.map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" ${measurementHandles ? `data-${drawing.tool}-handle style="stroke:${color}"` : ''} cx="${point.x}" cy="${point.y}" r="${measurementHandles ? 6 : DRAWING_HANDLE_RADIUS}" fill="var(--trading-market-panel)" stroke="${defaults ? DRAWING_SELECTION_COLOR : color}" stroke-width="${defaults && !measurementHandles ? 1.5 : 2}" vector-effect="non-scaling-stroke" />`).join("")
      : "";
    if ((isManualNote(drawing) || isManualPriceNote(drawing)) && interactive && (draft || selected)) {
      handles = handleEntries.map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-note-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if ((isCallout(drawing) || isComment(drawing)) && interactive && (draft || selected)) {
      handles = `<circle class="trading-drawing-handle" data-drawing-handle-index="0" data-note-handle cx="${first.x}" cy="${first.y}" r="6" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    }
    if (isSignpost(drawing) && interactive && (draft || selected)) {
      handles = `<rect class="trading-drawing-handle" data-drawing-handle-index="0" data-note-handle x="${first.x - 6}" y="${first.y - 6}" width="12" height="12" rx="3" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5"/>`;
    }
    if (isTradingPitchfork(drawing.tool) && interactive && (draft || selected)) {
      handles = handleEntries.filter(({ index }) => !draft || index < this.draftConfirmedPointCount)
        .map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-pitchfork-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if (projection && interactive && (draft || selected)) {
      handles = handleEntries.filter(({ index }) => !draft || index < this.draftConfirmedPointCount || drawing.tool === 'fib-time-zone' || drawing.tool === 'gann-box')
        .map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-fibonacci-projection-handle="${index}" cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if (isReferencePatternDrawing(drawing.tool) && interactive && (draft || selected)) {
      handles = handleEntries.filter(({ index }) => !draft || index < this.draftConfirmedPointCount)
        .map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-harmonic-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:${HARMONIC_BLUE}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if (isElliottWave(drawing.tool) && drawing.source !== 'ai' && interactive && (draft || selected)) {
      handles = handleEntries.filter(({ index }) => !draft || index < this.draftConfirmedPointCount)
        .map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-elliott-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:${ELLIOTT_HANDLE_COLOR}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if (isCycleDrawing(drawing.tool) && interactive && (draft || selected)) {
      handles = handleEntries.filter(({ index }) => !draft || drawing.tool === 'cyclic-lines' || index < this.draftConfirmedPointCount)
        .map(({ point, index }) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-cycle-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    if (drawing.tool === 'rotated-rectangle' && interactive && (draft || selected)) {
      const entries = draft && this.draftConfirmedPointCount < 2 ? [first, second]
        : rotatedRectangleGeometry(first, second, points[2]).handles;
      handles = entries.map((point, index) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-rotated-rectangle-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-market-panel)" style="stroke:#2962ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
    }
    let body = "";
    const cycle = renderCycleDrawing(drawing, points, bounds, draft || selected);
    const extra = cycle ? null : renderExtraDrawingGeometry({ drawing, points, bounds, color, candles: this.getCandles(), project: point => this.pointToScreen(point) });
    const extraAnnotation = renderExtraAnnotation(drawing, first, color);
    const regressionFit = drawing.tool === 'regression-trend' && !draft
      ? calculateRegressionTrend(this.getCandles(), drawing.points, drawing.regression) : null;
    const regressionGeometry = regressionFit ? renderRegressionTrend(regressionFit, drawing, p => this.pointToScreen(p), bounds.width) : null;
    // Old two-anchor records retain their original appearance. New forks store
    // the three actual swing points, never an inferred pixel-width handle.
    const fork = isTradingPitchfork(drawing.tool) && (draft || points.length >= 3)
      ? renderTradingPitchfork(drawing.tool, points, bounds, drawing, clipTradingDrawingLine) : null;
    const harmonic = isReferencePatternDrawing(drawing.tool)
      ? renderReferencePattern(drawing, points, draft ? this.draftConfirmedPointCount : drawing.points.length, bounds, translateDrawingText) : null;
    const aiHarmonicPath = renderNativeAiHarmonicPath(drawing, points);
    const elliott = isElliottWave(drawing.tool) && drawing.source !== 'ai'
      ? renderElliottWave(drawing, points, { draft, selected, confirmedPointCount: draft ? this.draftConfirmedPointCount : drawing.points.length }) : null;
    if (regressionGeometry && interactive && selected && regressionFit?.options.showUpper) {
      handles += regressionGeometry.upper.map((point, i) => `<circle class="trading-drawing-handle" data-drawing-handle-index="${drawing.points[0].time <= drawing.points[1].time ? i : 1 - i}" cx="${point.x}" cy="${point.y}" r="3.5" fill="var(--trading-market-panel)" style="stroke:${color}" stroke-width="1.5"/>`).join('');
    }

    if (drawing.tool === 'regression-trend') body = draft
      ? svgLine(first, second, '#787b86', { width: 1, opacity: 1, style: 'solid' })
      : regressionGeometry?.body ?? '';
    else if (cycle) body = cycle.body;
    else if (projection) body = projection.body;
    else if (fork) body = fork.body;
    else if (harmonic) body = harmonic.body;
    else if (aiHarmonicPath !== null) body = `<g opacity="${opacity}">${aiHarmonicPath}</g>`;
    else if (elliott) body = elliott.body;
    else if (extra) body = `<g opacity="${opacity}">${extra.body}</g>`;
    else if (extraAnnotation !== null) body = extraAnnotation;
    else if (definition.kind === "line") body = svgLine(segmentLine[0], segmentLine[1], color, lineAppearance);
    else if (definition.kind === "ray") body = svgLine(rayLine[0], rayLine[1], color, lineAppearance);
    else if (definition.kind === "extended") body = svgLine(extendedLine[0], extendedLine[1], color, lineAppearance);
    else if (definition.kind === "horizontal") body = svgLine({ x: 0, y: first.y }, { x: bounds.width, y: first.y }, color, lineAppearance);
    else if (definition.kind === "horizontal-ray") body = svgLine(first, { x: bounds.width, y: first.y }, color, lineAppearance);
    else if (definition.kind === "vertical") body = svgLine({ x: first.x, y: 0 }, { x: first.x, y: bounds.height }, color, lineAppearance);
    else if (definition.kind === "cross") {
      body = svgLine({ x: 0, y: first.y }, { x: bounds.width, y: first.y }, color, { ...lineAppearance, dashed: true })
        + svgLine({ x: first.x, y: 0 }, { x: first.x, y: bounds.height }, color, { ...lineAppearance, dashed: true });
    } else if (definition.kind === "arrow") body = svgLine(segmentLine[0], segmentLine[1], color, { ...lineAppearance, arrow: true });
    else if (tradingDrawingIsShapedChannel(drawing.tool)) body = points.length < 3
      ? svgLine(first, second, color, lineAppearance)
      : this.renderShapedChannel(drawing.tool === 'flat-top-bottom'
        ? tradingDrawingFlatTopBottomPoints(first, second, points[2])
        : tradingDrawingDisjointChannelPoints(first, second, points[2], points[3]), color, lineAppearance);
    else if (definition.kind === "channel") body = drawing.tool === 'parallel-channel' && draft && points.length < 3
      ? svgLine(first, second, color, lineAppearance)
      : this.renderChannel(first, second, color, lineAppearance, drawing.tool === 'parallel-channel' ? points[2] : undefined);
    else if (definition.kind === "pitchfork") body = this.renderPitchfork(first, second, color, lineAppearance);
    else if (definition.kind === "gann") body = this.renderGann(first, second, color, lineAppearance, drawing.tool);
    else if (fibonacci) body = fibonacci.body;
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
      body = `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" ${svgStrokeAttributes(lineAppearance, drawing.tool === "highlighter" ? 9 : 2.2)} stroke-linecap="round" stroke-linejoin="round" opacity="${defaults ? opacity : drawing.tool === "highlighter" ? 0.3 : opacity}" />`;
    } else if (definition.kind === "rectangle") {
      body = `<rect x="${Math.min(first.x, second.x)}" y="${Math.min(first.y, second.y)}" width="${Math.abs(dx)}" height="${Math.abs(dy)}" fill="${color}" fill-opacity="${defaults?.fillOpacity ?? 0.08}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`
        + (drawing.text && drawing.source === 'ai'
          ? renderTradingDrawingRegionLabel(first, second, drawing.text, tradingAiDrawingColor(drawing.colorToken) ?? color, bounds, drawing.fontSize ?? AI_NOTE_FONT_SIZE)
          : "");
    } else if (definition.kind === "rotated-rectangle") body = draft && this.draftConfirmedPointCount < 2
      ? svgLine(first, second, color, { ...lineAppearance, width: 1 })
      : this.renderRotatedRectangle(first, second, color, lineAppearance, points[2]);
    else if (definition.kind === "ellipse") {
      if (definition.id === "circle") {
        const circle = tradingDrawingCircleGeometry(first, second);
        body = `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.radius}" fill="${color}" fill-opacity="${defaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
      } else {
        const ellipse = tradingDrawingEllipseGeometry(first, second);
        const candlestickPatternClass = tradingDrawingIsPriceActionCandlestickPatternEllipse(drawing)
          ? ' class="trading-price-action-candlestick-pattern-ellipse"'
          : "";
        body = `<ellipse${candlestickPatternClass} cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="${color}" fill-opacity="${defaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
      }
    } else if (definition.kind === "triangle") {
      const triangle = tradingDrawingTrianglePoints(first, points[1] ?? second, points[2]);
      body = `<polygon points="${pointsAttribute(triangle)}" fill="${color}" fill-opacity="${defaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.6)} opacity="${opacity}" />`;
    } else if (definition.kind === "arc") {
      body = `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${Math.min(first.y, second.y) - Math.abs(dx) / 3} ${second.x} ${second.y}" fill="${defaults ? color : 'none'}" fill-opacity="${defaults?.fillOpacity ?? 0}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.8)} opacity="${opacity}" />`;
    } else if (definition.kind === "curve") body = this.renderCurve(first, second, color, lineAppearance, drawing.tool === "double-curve");
    else if (definition.kind === "polyline") {
      if (tradingDrawingIsMultiPoint(drawing.tool)) {
        const closed = tradingDrawingIsClosedPolyline(drawing);
        const tag = closed ? 'polygon' : 'polyline';
        body = `<${tag} points="${pointsAttribute(points)}" fill="${closed ? color : 'none'}" fill-opacity="${defaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.8)} stroke-linejoin="round" opacity="${opacity}"${drawing.tool === 'multi-point-path' ? ' marker-end="url(#trading-drawing-arrow)"' : ''} />`;
      } else body = `<polyline points="${pointsAttribute(patternPoints(first, second, 5))}" fill="none" stroke="${color}" ${svgStrokeAttributes(lineAppearance, 1.8)} stroke-linejoin="round" opacity="${opacity}" />`;
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
    else if (drawing.tool === "arrow-marker") {
      body = `<polygon class="trading-drawing-arrow-marker" points="${pointsAttribute(tradingDrawingArrowMarkerPoints(first, second))}" fill="${color}" stroke="${color}" ${svgStrokeAttributes(lineAppearance)} stroke-linejoin="round" opacity="${opacity}" />`;
    }
    else if ((drawing.tool === 'arrow-up' || drawing.tool === 'arrow-down') && (drawing.source !== 'ai' || usesNativeAiDrawingStyle(drawing))) {
      body = `<polygon class="trading-drawing-directional-arrow" points="${pointsAttribute(tradingDrawingDirectionalArrowPoints(first, drawing.tool))}" fill="${color}" stroke="none" />`;
    }
    else if (definition.kind === "marker") body = this.renderMarker(first, definition, color);
    else if (definition.kind === "pattern") body = this.renderPattern(points, definition, color, lineAppearance);
    else if (definition.kind === "position") body = this.renderPosition(first, second, drawing.tool === "long-position", color, Boolean(drawing.color), lineAppearance);
    else if (definition.kind === "range") body = this.renderRange(first, second, definition, color, lineAppearance);
    else if (definition.kind === "projection") body = this.renderProjection(first, second, definition, color, lineAppearance);
    else if (drawing.tool === 'info-line') body = svgLine(segmentLine[0], segmentLine[1], color, lineAppearance);
    else if (drawing.tool === 'trend-angle') body = svgLine(segmentLine[0], segmentLine[1], color, lineAppearance)
      + renderTradingTrendAngleAnnotation(first, second, color, opacity);
    else if (definition.kind === "measure") body = this.renderMeasurement(drawing, first, second, color, lineAppearance);

    const infoLineCard = drawing.tool === 'info-line' && clipTradingDrawingLine(first, second, bounds, 'segment')
      ? this.renderInfoLineCard(drawing, first, second, bounds, opacity) : '';

    const hitTargets = !interactive || draft
      ? ""
      : drawing.tool === 'regression-trend' ? regressionGeometry?.hit ?? ''
      : cycle ? cycle.hit
      : projection ? projection.hit
      : fibonacci ? fibonacci.hit
      : fork ? fork.hit
      : harmonic ? harmonic.hit
      : elliott ? elliott.hit
      : extra ? extra.hit
      : drawing.tool === 'price-label' && drawing.source !== 'ai'
        ? (() => { const box = priceLabelGeometry(drawing, first); return `<rect class="trading-drawing-hit-target area" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>`; })()
      : drawing.tool === 'flag' && drawing.source !== 'ai'
        ? `<rect class="trading-drawing-hit-target area" x="${first.x - 4}" y="${first.y - 34}" width="34" height="38"/>`
      : definition.kind === "text"
        ? this.renderTextHitTargets(points, drawing, bounds)
        : this.renderDrawingHitTargets(definition, points, bounds);
    return this.renderDrawingFrame(drawing, points, bounds, draft, interactive, body, hitTargets, handles, infoLineCard, color);
  }

  // All manual geometry, including dedicated range/volume/prediction renderers,
  // shares the same text actions, editing layer and handle visibility policy.
  private renderDrawingFrame(drawing: TradingDrawingModel, points: ScreenPoint[], bounds: { width: number; height: number },
    draft: boolean, interactive: boolean, body: string, hitTargets: string, handles: string, extra = '',
    color = drawing.color ?? manualDrawingDefaults(drawing.tool).color) {
    if (isVolumeDrawing(drawing.tool)) points = this.drawingLabelPoints(drawing, bounds);
    const selected = interactive && drawing.id === this.selectedDrawingId;
    const canAdd = interactive && !draft && this.userDrawingEnabled && tradingDrawingSupportsSettings(drawing.tool)
      && drawing.source !== 'ai' && !drawing.locked && !drawing.text?.trim();
    const addAnchor = canAdd
      ? tradingDrawingLabelGeometry({ ...drawing, text: '＋ 添加文字', fontSize: 12, textAlign: 'center', textVerticalAlign: 'top' }, points, bounds, { width: 84, height: 22 })
        : null;
    const addText = addAnchor && bounds.width >= 96
      && addAnchor.y >= 0 && addAnchor.y <= bounds.height
      ? `<g class="trading-horizontal-line-add-text" data-horizontal-line-add-text="${escapeHtml(drawing.id)}" role="button" tabindex="0" aria-label="添加文字" aria-haspopup="dialog" style="color:${color}" transform="translate(${addAnchor.x} ${addAnchor.y}) rotate(${addAnchor.angle})">`
        + `<rect x="-42" y="-22.5" width="84" height="29.5" fill="transparent"/>`
        + `<text x="0" y="-11.5" dominant-baseline="central" text-anchor="middle" font-size="12" font-weight="400" fill="currentColor">＋ 添加文字</text></g>`
      : '';
    const centerAnchor = canAdd
      ? tradingDrawingLabelGeometry({ ...drawing, text: '＋ 添加文字', fontSize: 12, textAlign: 'center', textVerticalAlign: 'middle' }, points, bounds, { width: 84, height: 22 }) : null;
    const centerAddText = centerAnchor && bounds.width >= 96
      ? `<g class="trading-horizontal-line-add-text" data-horizontal-line-add-text="${escapeHtml(drawing.id)}" data-drawing-text-position="center" role="button" tabindex="0" aria-label="添加文字" aria-haspopup="dialog" style="color:${color}" transform="translate(${centerAnchor.x} ${centerAnchor.y}) rotate(${centerAnchor.angle})">`
        + `<rect x="-42" y="-11" width="84" height="22" fill="transparent"/>`
        + `<text x="0" y="0" dominant-baseline="central" text-anchor="middle" font-size="12" font-weight="400" fill="currentColor">＋ 添加文字</text></g>`
      : '';
    const authoredText = drawing.text?.trim() && drawing.tool !== "image" ? " data-i18n-skip" : "";
    // Labels stay above geometry, but visible handles must win overlapping
    // label/add-text hit areas so grabbing an endpoint always starts a drag.
    const label = tradingDrawingSupportsSettings(drawing.tool) && drawing.source !== 'ai'
      ? tradingDrawingLabelGeometry(drawing, points, bounds) : null;
    const lineText = this.horizontalLineTextEdit?.drawing !== drawing
      ? renderTradingDrawingLabel(drawing, label, color,
        interactive && !draft && this.userDrawingEnabled && !drawing.locked
        && tradingDrawingToolDefinition(this.activeTool)?.kind === 'cursor') : '';
    const maskId = `${this.labelMaskPrefix}-${Array.from(drawing.id, character => character.codePointAt(0)!.toString(16)).join('-')}`;
    const hideLineNodes = drawing.source !== 'ai' && tradingDrawingHidesLineNodes(drawing.tool);
    const maskedLabel = label?.vertical === 'middle' ? label : centerAddText && centerAnchor
      ? { ...centerAnchor, layout: { ...centerAnchor.layout, width: 84, height: 22 } } : null;
    const mask = maskedLabel && hideLineNodes
      ? renderTradingDrawingLabelMask(maskId, maskedLabel, bounds, !label) : '';
    const geometryClass = interactive && this.userDrawingEnabled && drawing.source !== 'ai' ? ' class="trading-drawing-geometry"' : '';
    // An invisible add-text gap must not rasterize a full-pane SVG mask for
    // every unselected line on every pan frame. CSS activates this same mask
    // only while its placeholder is visible; authored text keeps its real gap.
    const geometryMask = !mask ? '' : label ? ` mask="url(#${maskId})"`
      : ` data-drawing-placeholder-mask="true" style="--trading-drawing-placeholder-mask:url(#${maskId})"`;
    const geometry = geometryClass || mask ? `<g${geometryClass}${geometryMask}>${body}</g>` : body;
    return `<g data-drawing-id="${escapeHtml(drawing.id)}" data-drawing-source="${drawing.source ?? "manual"}" data-selected="${selected}" data-locked="${Boolean(drawing.locked)}"${hideLineNodes ? ' data-hide-line-nodes="true"' : ''}${authoredText}>${mask}${geometry}${hitTargets}${extra}${lineText}${addText}${centerAddText}${handles}</g>`;
  }

  private drawingLabelPoints(drawing: TradingDrawingModel, bounds: { width: number; height: number }) {
    if (drawing.tool === 'anchored-vwap' && drawing.points.length) {
      const points = calculateAnchoredVwap(this.getCandles(), drawing.points[0].time, drawing.vwap)
        .map(point => this.pointToScreen(point)).filter((point): point is ScreenPoint => Boolean(point));
      if (points.length) return points;
    }
    if (isVolumeProfile(drawing.tool)) {
      const profile = this.volumeProfileForDrawing(drawing);
      if (profile) return [{ time: profile.startTime, price: profile.high }, { time: profile.endTime, price: profile.low }]
        .map(point => this.pointToScreen(point)).filter((point): point is ScreenPoint => Boolean(point));
    }
    return drawing.points.map((_point, index) => this.drawingPointToScreen(drawing, index, bounds))
      .filter((point): point is ScreenPoint => Boolean(point));
  }

  private renderDrawingHitTargets(
    definition: TradingDrawingToolDefinition,
    points: ScreenPoint[],
    bounds: { width: number; height: number },
  ) {
    const first = points[0];
    const last = points[points.length - 1] ?? first;
    const hasThirdPoint = definition.kind === "triangle" || definition.id === 'parallel-channel' || definition.id === 'rotated-rectangle' || tradingDrawingIsShapedChannel(definition.id);
    const second = hasThirdPoint ? points[1] ?? last : last;
    const third = hasThirdPoint ? points[2] : undefined;
    if (!first) return "";
    if (definition.id === 'disjoint-channel') return renderTradingDrawingClosedHitArea({
      type: 'polygon', points: tradingDrawingDisjointChannelPoints(first, second, third, points[3]),
    });
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
          return [{ x: first.x, y }, { x: second.x, y }];
        }),
      ];
    } else if (tradingDrawingIsMultiPoint(definition.id) && points.length > 1) {
      if (definition.id === 'multi-point-polyline' && points.length > 3 && first.x === last.x && first.y === last.y) {
        return `<polygon class="trading-drawing-hit-target area" points="${pointsAttribute(points)}" />`;
      }
      segments = points.slice(1).map((point, index) => [points[index], point]);
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

  private renderShapedChannel(corners: ScreenPoint[], color: string, appearance: TradingDrawingStrokeAppearance) {
    return `<polygon points="${pointsAttribute(corners)}" fill="${color}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.2}" />`
      + svgLine(corners[0], corners[1], color, appearance)
      + svgLine(corners[3], corners[2], color, appearance);
  }

  private renderChannel(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, widthPoint?: ScreenPoint) {
    const [, , fourth, third] = tradingDrawingChannelPoints(first, second, widthPoint);
    if (Math.hypot(fourth.x - second.x, fourth.y - second.y) < 0.01) return svgLine(first, second, color, appearance);
    return `<polygon points="${pointsAttribute([first, second, fourth, third])}" fill="${color}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.055}" />`
      + svgLine(first, second, color, appearance)
      + svgLine(third, fourth, color, appearance)
      + svgLine({ x: (first.x + third.x) / 2, y: (first.y + third.y) / 2 }, { x: (second.x + fourth.x) / 2, y: (second.y + fourth.y) / 2 }, color, {
        ...appearance, opacity: appearance.manualDefaults ? appearance.opacity : appearance.opacity * 0.62,
        width: appearance.manualDefaults && !appearance.customWidth ? 1 : appearance.width,
        style: appearance.manualDefaults && !appearance.customStyle ? 'dashed' : appearance.style, dashed: true,
      });
  }

  private renderPitchfork(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance) {
    const offset = perpendicularOffset(first, second, Math.max(24, Math.min(Math.hypot(second.x - first.x, second.y - first.y) * 0.24, 80)));
    return [-1, 0, 1].map((multiple) => svgLine(
      { x: first.x + offset.x * multiple, y: first.y + offset.y * multiple },
      { x: second.x + offset.x * multiple, y: second.y + offset.y * multiple },
      appearance.manualDefaults && !appearance.customColor && multiple !== 0 ? '#2962ff' : color,
      { ...appearance, opacity: appearance.manualDefaults || multiple === 0 ? appearance.opacity : appearance.opacity * 0.72, dashed: multiple !== 0 },
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
    const visibleLevels = expanded ? levels : levels.filter((level) => level.ratio === 1);
    const left = Math.min(first.x, second.x);
    const right = Math.max(first.x, second.x);
    const levelY = (ratio: number) => second.y + (first.y - second.y) * ratio;
    // Each band inherits the higher ratio's color, including extensions above 1.
    // Clip fills to this pane; they must not intercept candle navigation.
    const fillLeft = Math.max(0, left);
    const fillRight = Math.min(bounds.width, right);
    const bands = expanded && fillRight > fillLeft ? levels.slice(0, -1).map((level, index) => {
      const y = levelY(level.ratio);
      const nextY = levelY(levels[index + 1].ratio);
      const top = Math.max(0, Math.min(y, nextY));
      const bottom = Math.min(bounds.height, Math.max(y, nextY));
      if (bottom <= top) return "";
      const fill = customColor ? color : level.color;
      return `<rect class="trading-fibonacci-band" data-fibonacci-band="${level.label}" x="${fillLeft}" y="${top}" width="${fillRight - fillLeft}" height="${bottom - top}" fill="${fill}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.2}" opacity="${appearance.opacity}" />`;
    }).join("") : "";
    const connectorColor = customColor ? color : '#808080';
    const connector = expanded
      ? `<line class="trading-fibonacci-connector" x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}" stroke="${connectorColor}" ${svgStrokeAttributes({ ...appearance, style: appearance.manualDefaults && !appearance.customStyle ? 'dashed' : appearance.style, dashed: true }, 1.5)} opacity="${appearance.opacity}" />`
      : "";
    return bands + connector + visibleLevels.map((level) => {
      const y = levelY(level.ratio);
      const label = `${level.label} (${formatTradingFibonacciPrice(level.price, true)})`;
      const levelColor = customColor ? color : appearance.manualDefaults ? manualFibLevelColor(level.ratio) : level.color;
      return `<g class="trading-fibonacci-level" data-fibonacci-level="${level.label}">`
        + `<line class="trading-fibonacci-level-line" x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${levelColor}" ${svgStrokeAttributes(appearance, 1.25)} opacity="${appearance.opacity}" />`
        + `<text class="trading-fibonacci-label" x="${left - 8}" y="${y}" text-anchor="end" dominant-baseline="central" fill="${levelColor}" opacity="${appearance.opacity}">${label}</text>`
        + "</g>";
    }).join("");
  }

  private renderTimeZones(first: ScreenPoint, second: ScreenPoint, color: string, height: number, appearance: TradingDrawingStrokeAppearance) {
    const step = Math.max(Math.abs(second.x - first.x), 8);
    const fib = [0, 1, 2, 3, 5, 8, 13, 21];
    return fib.map((factor) => {
      const x = first.x + Math.sign(second.x - first.x || 1) * step * factor;
      return svgLine({ x, y: 0 }, { x, y: height }, appearance.manualDefaults && !appearance.customColor ? (factor === 0 ? '#808080' : '#2962ff') : color, { ...appearance, opacity: appearance.manualDefaults || factor <= 1 ? appearance.opacity : appearance.opacity * 0.45, dashed: factor > 1 });
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
    return [0.236, 0.382, 0.5, 0.618, 1].map((ratio) => `<circle cx="${first.x}" cy="${first.y}" r="${radius * ratio}" fill="none" stroke="${appearance.manualDefaults && !appearance.customColor ? manualFibLevelColor(ratio) : color}" ${svgStrokeAttributes(appearance, 1.2)} opacity="${appearance.manualDefaults ? appearance.opacity : appearance.opacity * (0.45 + ratio * 0.45)}" />`).join("");
  }

  private renderRotatedRectangle(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, widthPoint?: ScreenPoint) {
    const points = rotatedRectangleGeometry(first, second, widthPoint).corners;
    return `<polygon class="trading-rotated-rectangle" points="${pointsAttribute(points)}" fill="${color}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes(appearance, 1.6)} opacity="${appearance.opacity}" />`;
  }

  private renderCurve(first: ScreenPoint, second: ScreenPoint, color: string, appearance: TradingDrawingStrokeAppearance, double: boolean) {
    const controlY = Math.min(first.y, second.y) - Math.max(Math.abs(second.x - first.x) * 0.28, 18);
    const path = `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${controlY} ${second.x} ${second.y}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.8)} opacity="${appearance.opacity}" />`;
    return double
      ? path + `<path d="M ${first.x} ${first.y} Q ${(first.x + second.x) / 2} ${Math.max(first.y, second.y) + Math.abs(second.x - first.x) * 0.28} ${second.x} ${second.y}" fill="none" stroke="${color}" ${svgStrokeAttributes(appearance, 1.4)} opacity="${appearance.manualDefaults ? appearance.opacity : appearance.opacity * 0.65}" />`
      : path;
  }

  private renderXPostDrawing(drawing: TradingDrawingModel, bounds: { width: number; height: number }, interactive: boolean) {
    const point = this.pointToScreen(drawing.points[0]);
    if (!point) return '';
    const post = readTradingXPost(drawing.text ?? ''), url = normalizeXPostUrl(drawing.text);
    const width = Math.min(416, bounds.width - 16), x = Math.max(4, Math.min(point.x - width / 2, bounds.width - width - 4)), y = point.y;
    const bodyText = post?.body ?? translateAppText('帖子内容暂不可用，双击重新加载');
    const layout = tradingDrawingTextLayout(bodyText, 16, width - 40);
    const lines = layout.lines.slice(0, 14), height = 150 + lines.length * 21;
    const avatar = post?.avatarUrl && /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(post.avatarUrl) ? post.avatarUrl : '';
    const avatarClip = `x-post-avatar-${drawing.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const date = post?.createdAt && Number.isFinite(Date.parse(post.createdAt))
      ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(post.createdAt)).replaceAll('/', '-') : '';
    const body = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="var(--trading-note-background)" stroke="#e5e5e5" stroke-width="1.5"/>`
      + `<circle cx="${x + 41}" cy="${y + 37}" r="21" fill="#16181c"/><text x="${x + 41}" y="${y + 43}" text-anchor="middle" fill="#fff" font-size="20">𝕏</text>`
      + (avatar ? `<svg x="${x + 20}" y="${y + 16}" width="42" height="42"><defs><clipPath id="${avatarClip}"><circle cx="21" cy="21" r="21"/></clipPath></defs><image href="${escapeHtml(avatar)}" width="42" height="42" clip-path="url(#${avatarClip})"/></svg>` : '')
      + `<text x="${x + 72}" y="${y + 32}" fill="var(--trading-note-text)" font-size="16" font-weight="700">${escapeHtml(post?.authorName ?? url?.handle ?? 'X')}</text>`
      + `<text x="${x + 72}" y="${y + 52}" fill="#888" font-size="14">@${escapeHtml(post?.handle ?? url?.handle ?? '')}</text>`
      + `<text fill="var(--trading-note-text)" font-size="16">${lines.map((line, index) => `<tspan x="${x + 20}" y="${y + 82 + index * 21}">${escapeHtml(line)}${index === 13 && layout.lines.length > 14 ? '…' : ''}</tspan>`).join('')}</text>`
      + `<line x1="${x + 20}" y1="${y + height - 38}" x2="${x + width - 20}" y2="${y + height - 38}" stroke="#e5e5e5"/><text x="${x + 20}" y="${y + height - 15}" fill="#888" font-size="14">${escapeHtml(date)}</text>`;
    const link = url ? `<g data-x-post-link="${escapeHtml(url.url)}" role="link" tabindex="0" aria-label="${translateAppText('链接到帖子')}" class="trading-x-post-link"><rect x="${x + 16}" y="${y + height - 76}" width="130" height="30" fill="transparent"/><text x="${x + 20}" y="${y + height - 55}" fill="#2962ff" font-size="16">${translateAppText('链接到帖子')}</text></g>` : '';
    const hit = interactive ? `<rect class="trading-drawing-hit-target area" x="${x}" y="${y}" width="${width}" height="${height}"/>` : '';
    const handles = interactive && this.selectedDrawingId === drawing.id ? `<circle class="trading-drawing-handle" data-drawing-handle-index="0" data-note-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5"/>` : '';
    return this.renderDrawingFrame(drawing, [point], bounds, false, interactive, body, hit, handles, link);
  }

  private renderImageDrawing(drawing: TradingDrawingModel, bounds: { width: number; height: number }, interactive: boolean) {
    const first = this.pointToScreen(drawing.points[0]);
    if (!first) return '';
    if (drawing.points.length === 1) {
      const second = this.screenToDrawingPoint({ x: first.x + 240, y: first.y + 160 }, false);
      if (second) drawing.points.push(second);
    }
    const second = this.pointToScreen(drawing.points[1]) ?? { x: first.x + 240, y: first.y + 160 };
    const x = Math.min(first.x, second.x), y = Math.min(first.y, second.y);
    const width = Math.max(16, Math.abs(second.x - first.x)), height = Math.max(16, Math.abs(second.y - first.y));
    const url = drawingImageUrl(drawing.text ?? '');
    const body = url ? `<image href="${escapeHtml(url)}" x="${x}" y="${y}" width="${width}" height="${height}" opacity="${drawing.imageOpacity ?? 1}" preserveAspectRatio="none"/>`
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="var(--trading-note-background)" stroke="#d9d9d9"/><text x="${x + 12}" y="${y + 24}" fill="var(--trading-note-text)">${translateAppText('图片不可用')}</text>`;
    const hit = interactive ? `<rect class="trading-drawing-hit-target area" x="${x}" y="${y}" width="${width}" height="${height}"/>` : '';
    const handles = interactive && this.selectedDrawingId === drawing.id ? [0,1,2,3].map(index => {
      const point = this.drawingPointToScreen(drawing, index, bounds);
      return point ? `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-note-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5"/>` : '';
    }).join('') : '';
    return this.renderDrawingFrame(drawing, [first, second], bounds, false, interactive, body, hit, handles);
  }

  private renderAnnotationTable(drawing: TradingDrawingModel, bounds: { width: number; height: number }, draft: boolean, interactive: boolean) {
    const points = drawing.points.map((_point, index) => this.drawingPointToScreen(drawing, index, bounds)).filter((point): point is ScreenPoint => Boolean(point));
    if (!points.length) return '';
    const box = annotationTableGeometry(drawing, points), width = box.width / box.columns, height = box.height / box.rows.length;
    const fontSize = drawing.fontSize ?? PLAIN_TEXT_FONT_SIZE;
    const edit = this.horizontalLineTextEdit?.drawing === drawing ? this.horizontalLineTextEdit.cell : undefined;
    let body = '', hit = '';
    box.rows.forEach((row, r) => row.forEach((value, c) => {
      const x = box.x + c * width, y = box.y + r * height;
      body += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${drawing.textBackgroundColor ?? 'var(--trading-note-background)'}" stroke="#d9d9d9" stroke-width="1"/>`;
      if (edit?.row !== r || edit.column !== c) {
        body += `<svg x="${x + 10}" y="${y}" width="${Math.max(0, width - 20)}" height="${height}" overflow="hidden"><text x="0" y="${height / 2}" dominant-baseline="central" style="font-family:${escapeHtml(PLAIN_TEXT_FONT_FAMILY)}" fill="${drawing.textColor ?? 'var(--trading-note-text)'}" font-size="${fontSize}" font-weight="${drawing.bold ? 700 : 400}">${escapeHtml(value)}</text></svg>`;
      }
      if (interactive) hit += `<rect class="trading-drawing-hit-target area trading-inline-annotation-hit" data-inline-annotation="${escapeHtml(drawing.id)}" data-table-row="${r}" data-table-column="${c}" role="button" tabindex="0" aria-label="${translateAppText('表格')} ${r + 1}, ${c + 1}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
    }));
    const handles = interactive && (draft || this.selectedDrawingId === drawing.id) ? [0, 1, 2, 3].map(index => {
      const point = this.drawingPointToScreen(drawing, index, bounds);
      return point ? `<circle class="trading-drawing-handle" data-drawing-handle-index="${index}" data-note-handle cx="${point.x}" cy="${point.y}" r="6" fill="var(--trading-note-background)" style="stroke:#2962ff" stroke-width="1.5"/>` : '';
    }).join('') : '';
    return this.renderDrawingFrame(drawing, points, bounds, draft, interactive, body, hit, handles);
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
    if (isSignpost(drawing)) {
      const edit = this.horizontalLineTextEdit?.drawing === drawing ? this.horizontalLineTextEdit : null;
      const value = (edit ? edit.input.value : text) || translateAppText('添加文字');
      const box = annotationTextGeometry(drawing, [point], value);
      const candles = this.getCandles();
      const index = tradingDrawingLogicalIndexAtTime(candles, drawing.points[0].time);
      const candle = index === null ? undefined : candles[Math.max(0, Math.min(candles.length - 1, Math.round(index)))];
      const price = candle ? drawing.points[0].price > candle.high ? candle.high : candle.low : drawing.points[0].price;
      const anchor = this.pointToScreen({ time: drawing.points[0].time, price });
      const line = anchor ? svgLine({ x: point.x, y: anchor.y }, { x: point.x, y: anchor.y < box.y ? box.y : box.y + box.height }, drawing.color ?? '#787878', { ...appearance, width: drawing.lineWidth ?? 1 }) : '';
      return line + `<rect class="trading-signpost-card" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="7" fill="${drawing.textBackgroundColor ?? 'var(--trading-note-background)'}" stroke="#e0e0e0" stroke-width="1.5"/>`
        + (edit ? '' : `<text style="font-family:${escapeHtml(PLAIN_TEXT_FONT_FAMILY)}" fill="${drawing.textColor ?? 'var(--trading-note-text)'}" font-size="${box.fontSize}" font-weight="${drawing.bold ? 700 : 400}" opacity="${text ? 1 : .5}">${box.lines.map((line, i) => `<tspan x="${box.x + box.padding}" y="${box.y + box.baseline + i * box.lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`);
    }
    if (isCallout(drawing) || isComment(drawing)) {
      const edit = this.horizontalLineTextEdit?.drawing === drawing ? this.horizontalLineTextEdit : null;
      const value = (edit ? edit.input.value : text) || translateAppText('添加文字');
      const geometry = annotationTextGeometry(drawing, [point, labelPoint], value);
      const { x, y, width, height, padding, baseline, lineHeight, lines, fontSize } = geometry;
      const comment = isComment(drawing), color = drawing.color ?? (comment ? PLAIN_TEXT_COLOR : '#0097a7');
      const path = comment
        ? `M ${x} ${y + height} V ${y + height / 2} Q ${x} ${y} ${x + height / 2} ${y} H ${x + width - height / 2} A ${height / 2} ${height / 2} 0 0 1 ${x + width - height / 2} ${y + height} Z`
        : calloutPath(geometry, point);
      const bubble = `<path class="${comment ? 'trading-comment-bubble' : 'trading-callout-bubble'}" d="${path}" fill="${drawing.textBackgroundColor ?? color}" fill-opacity="${drawing.textBackgroundColor || comment ? 1 : .7}" stroke="${color}" stroke-width="${comment ? 0 : drawing.lineWidth ?? 2}" stroke-linejoin="round"/>`;
      return bubble + (edit ? '' : `<text style="font-family:${escapeHtml(PLAIN_TEXT_FONT_FAMILY)}" fill="${drawing.textColor ?? '#ffffff'}" font-size="${fontSize}" font-weight="${drawing.bold ? 700 : 400}" opacity="${text ? 1 : .5}">${lines.map((line, i) => `<tspan x="${x + padding}" y="${y + baseline + i * lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`);
    }
    if (isPinNote(drawing)) {
      const pinColor = drawing.color ?? PLAIN_TEXT_COLOR;
      const icon = `<g class="trading-pin-note-icon"><path d="M ${point.x} ${point.y} C ${point.x - 5} ${point.y - 7} ${point.x - 16} ${point.y - 17} ${point.x - 16} ${point.y - 25} A 16 16 0 1 1 ${point.x + 16} ${point.y - 25} C ${point.x + 16} ${point.y - 17} ${point.x + 5} ${point.y - 7} ${point.x} ${point.y} Z" fill="${pinColor}"/><circle cx="${point.x}" cy="${point.y - 25}" r="6.5" fill="#fff"/></g>`;
      if (this.openPinNoteId !== drawing.id && this.pendingTextDrawingId !== drawing.id) return icon;
      const edit = this.horizontalLineTextEdit?.drawing === drawing ? this.horizontalLineTextEdit : null;
      const value = (edit ? edit.input.value : text) || translateAppText('添加文字');
      const geometry = annotationTextGeometry(drawing, [point], value);
      const width = Math.min(geometry.width, bounds.width);
      const x = Math.max(0, Math.min(geometry.x, bounds.width - width));
      const y = Math.max(0, geometry.y), bottom = y + geometry.height;
      const tail = Math.max(x + 12, Math.min(point.x, x + width - 12));
      const bubble = `<path class="trading-pin-note-bubble" d="M ${x + 5} ${y} H ${x + width - 5} Q ${x + width} ${y} ${x + width} ${y + 5} V ${bottom - 5} Q ${x + width} ${bottom} ${x + width - 5} ${bottom} H ${tail + 9} L ${tail} ${bottom + 10} L ${tail - 9} ${bottom} H ${x + 5} Q ${x} ${bottom} ${x} ${bottom - 5} V ${y + 5} Q ${x} ${y} ${x + 5} ${y} Z" fill="${drawing.textBackgroundColor ?? 'var(--trading-note-background)'}"/>`;
      return icon + bubble + (edit ? '' : `<text style="font-family:${escapeHtml(PLAIN_TEXT_FONT_FAMILY)}" fill="${drawing.textColor ?? 'var(--trading-note-text)'}" font-size="${geometry.fontSize}" font-weight="${drawing.bold ? 700 : 400}" opacity="${text ? 1 : .5}">${geometry.lines.map((line, index) => `<tspan x="${x + geometry.padding}" y="${y + geometry.baseline + index * geometry.lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`);
    }
    if (isInlineAnnotation(drawing) || isManualPriceNote(drawing)) {
      const note = isManualNote(drawing), price = isManualPriceNote(drawing);
      const value = price ? annotationPrice(drawing.points[0].price) : text || translateAppText('添加文字');
      const geometry = annotationTextGeometry(drawing, [point, labelPoint], value);
      const { x, y, width, height, fontSize, lineHeight, lines, baseline, padding } = geometry;
      const connector = note || price ? svgLine(point, labelPoint, drawing.color ?? (note ? '#787878' : PLAIN_TEXT_COLOR), {
        ...appearance, width: drawing.lineWidth ?? (note ? 1 : 1.5),
      }) : '';
      if (this.horizontalLineTextEdit?.drawing === drawing) return connector;
      const selected = drawing.id === this.selectedDrawingId;
      const background = note ? drawing.textBackgroundColor ?? 'var(--trading-note-background)'
        : price ? drawing.textBackgroundColor ?? color : drawing.textBackgroundColor ?? 'transparent';
      const textColor = note ? drawing.textColor ?? 'var(--trading-note-text)' : price ? drawing.textColor ?? '#ffffff' : color;
      const frame = `<rect class="${note ? 'trading-manual-note-card' : price ? 'trading-manual-price-card' : 'trading-plain-text-frame'}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${note ? 4 : price ? 7 : 0}" fill="${background}" stroke="${!note && !price && selected ? PLAIN_TEXT_COLOR : 'none'}" stroke-width="1.5"/>`;
      const content = `<text class="trading-inline-annotation-text" style="font-family:${escapeHtml(PLAIN_TEXT_FONT_FAMILY)}" fill="${textColor}" font-size="${fontSize}" font-weight="${drawing.bold ?? price ? 700 : 400}" font-style="${drawing.italic ? 'italic' : 'normal'}" opacity="${!text && !price ? .5 : 1}">`
        + lines.map((line, i) => `<tspan x="${x + padding}" y="${y + baseline + i * lineHeight}">${escapeHtml(line)}</tspan>`).join('') + '</text>';
      return connector + frame + content;
    }
    if (!text) return "";
    const toolId = drawing.tool;
    const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const boxed = toolId !== "text" && toolId !== "anchored-text";
    const noteGeometry = (toolId === "note" || toolId === "callout")
      ? resolvedTextGeometry ?? tradingDrawingNoteBoxGeometry(point, text, fontSize, bounds)
      : null;
    const textBox = noteGeometry ?? (boxed ? tradingDrawingTextBoxLayout(text, fontSize, bounds) : null);
    const layout = resolvedTextGeometry?.layout ?? textBox?.layout ?? tradingDrawingTextLayout(text, fontSize);
    const textLines = (x: number, firstBaseline: number) => layout.lines.map((line, index) => (
      `<tspan x="${x}" y="${firstBaseline + index * layout.lineHeight}"${line ? ` textLength="${layout.lineWidths[index]}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeHtml(line)}</tspan>`
    )).join("");
    const fontWeight = drawing.bold ? 700 : 400;
    if (toolId === "text" || toolId === "anchored-text") {
      const isPriceActionCandlestickPatternLabel = tradingDrawingIsPriceActionCandlestickPatternLabel(drawing);
      const inlinePoint = resolvedTextGeometry
        ? {
            x: resolvedTextGeometry.boxLeft + resolvedTextGeometry.boxWidth / 2,
            y: resolvedTextGeometry.boxTop + fontSize,
          }
        : point;
      const backgroundPoint = drawing.source === 'ai'
        ? { x: inlinePoint.x - layout.width / 2, y: inlinePoint.y }
        : inlinePoint;
      const background = drawing.textBackgroundColor
        ? `<rect x="${backgroundPoint.x - 5}" y="${backgroundPoint.y - fontSize - 4}" width="${layout.width + 10}" height="${layout.height + 8}" rx="2" fill="${drawing.textBackgroundColor}" />`
        : "";
      const inlineLabelClass = drawing.source === "ai"
        ? ` class="trading-ai-inline-label${isPriceActionCandlestickPatternLabel ? " trading-price-action-candlestick-label" : ""}"`
        : "";
      const candlestickLeader = resolvedTextGeometry
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
    if (isPinNote(drawing)) {
      const icon = `<rect class="trading-drawing-hit-target area trading-inline-annotation-hit" data-inline-annotation="${escapeHtml(drawing.id)}" role="button" tabindex="0" aria-label="${translateAppText('置顶')}" aria-expanded="${this.openPinNoteId === drawing.id}" x="${point.x - 18}" y="${point.y - 43}" width="36" height="45"/>`;
      if (this.openPinNoteId !== drawing.id) return icon;
      const geometry = annotationTextGeometry(drawing, [point], drawing.text || translateAppText('添加文字'));
      return icon + `<rect class="trading-drawing-hit-target area trading-inline-annotation-hit" x="${Math.max(0, Math.min(geometry.x, bounds.width - geometry.width))}" y="${Math.max(0, geometry.y)}" width="${Math.min(geometry.width, bounds.width)}" height="${geometry.height}"/>`;
    }
    if (isInlineAnnotation(drawing) || isManualPriceNote(drawing)) {
      const price = isManualPriceNote(drawing);
      const text = price ? annotationPrice(drawing.points[0].price) : drawing.text || translateAppText('添加文字');
      const geometry = annotationTextGeometry(drawing, points, text);
      const last = points.at(-1)!;
      const line = isManualNote(drawing) || price
        ? `<line class="trading-drawing-hit-target" x1="${point.x}" y1="${point.y}" x2="${last.x}" y2="${last.y}"/>` : '';
      return line + `<rect class="trading-drawing-hit-target area trading-inline-annotation-hit" data-inline-annotation="${escapeHtml(drawing.id)}" tabindex="0" role="button" aria-label="${translateAppText(price ? '价格笔记' : '文本输入')}" x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}"/>`;
    }
    const fontSize = drawing.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const text = drawing.text ?? "";
    if (drawing.tool === 'image') return `<rect class="trading-drawing-hit-target area" x="${point.x}" y="${point.y}" width="240" height="160"/>`;
    if (drawing.tool === 'table') {
      const rows = (text || '项目 | 数值\n价格 | 0').split('\n').slice(0, 12);
      const columns = Math.min(6, Math.max(...rows.map(row => row.split(/[|\t]/).length)));
      return `<rect class="trading-drawing-hit-target area" x="${point.x}" y="${point.y}" width="${columns * Math.max(72, fontSize * 6)}" height="${rows.length * (fontSize + 16)}"/>`;
    }
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
    } else if (resolvedTextGeometry) {
      box = {
        x: resolvedTextGeometry.boxLeft - 6,
        y: resolvedTextGeometry.boxTop - 6,
        width: resolvedTextGeometry.boxWidth + 12,
        height: resolvedTextGeometry.boxHeight + 12,
      };
    } else {
      const layout = tradingDrawingTextLayout(drawing.text, fontSize);
      box = {
        x: point.x - (['text', 'anchored-text'].includes(drawing.tool) ? layout.width / 2 : 0) - 7,
        y: point.y - fontSize - 6,
        width: layout.width + 14,
        height: layout.height + 12,
      };
    }
    const label = drawing.text.replace(/\s+/g, " ").trim().slice(0, 48);
    const deleteX = Math.max(0, Math.min(bounds.width - 18, box.x + box.width - 18));
    const deleteY = Math.max(0, Math.min(bounds.height - 18, box.y - 16));
    return `<g class="trading-ai-text-size-trigger" data-i18n-skip data-ai-text-size-trigger="${escapeHtml(drawing.id)}" tabindex="0" role="group" aria-label="${escapeHtml(translateAppText(`AI 标注：${label}；当前字号 ${fontSize}px`))}">`
      + `<rect class="trading-ai-text-size-hit-target" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" />`
      + `<g class="trading-ai-annotation-delete" data-ai-annotation-delete="${escapeHtml(drawing.id)}" role="button" tabindex="0" aria-label="${escapeHtml(translateDrawingText('删除 AI 标注'))}" transform="translate(${deleteX} ${deleteY})">`
      + `<title>${escapeHtml(translateDrawingText('删除 AI 标注'))}</title><circle cx="9" cy="9" r="9"/><path d="m5.5 5.5 7 7m0-7-7 7"/></g>`
      + `</g>`;
  }

  private updateAiTextSizeToolbar(bounds: { width: number; height: number }) {
    if (deferInteractionRender(this.aiTextSizeToolbar, () => this.updateAiTextSizeToolbar(bounds))) return;
    // Keep the eye state current even while the toolbar is dismissed, or a
    // drawing tool owns the canvas. Restoring the toolbar must not show stale state.
    const eye = this.aiTextSizeToolbar.querySelector<HTMLButtonElement>('[data-ai-text-size-action="toggle-visibility"]');
    const next = this.aiTextSizeToolbar.querySelector<HTMLButtonElement>('[data-ai-text-size-action="next-drawing"]');
    if (next) {
      const { count, index } = this.aiDrawingSets.info({ marketId: this.getSymbol(), interval: this.getInterval() });
      next.hidden = count < 2;
      next.disabled = this.aiDrawingSetPlaying;
      const position = next.querySelector('[data-ai-drawing-set-position]');
      const label = `${index + 1}/${count}`;
      if (position && position.textContent !== label) position.textContent = label;
      next.title = `${translateDrawingText('切换 K 线绘制')} (${label})`;
      next.setAttribute('aria-label', next.title);
    }
    if (eye) {
      const hidden = this.drawingVisibility.aiHidden;
      updateTradingDrawingMarkup(eye, selectionIcon(hidden ? 'eye-closed' : 'eye'));
      eye.setAttribute('aria-pressed', String(hidden));
      eye.setAttribute('aria-label', hidden ? '显示当前会话 AI 画线' : '隐藏当前会话 AI 画线');
      eye.title = hidden ? '显示当前会话 AI 画线' : '隐藏当前会话 AI 画线';
    }
    if (
      !this.userDrawingEnabled
      || tradingDrawingToolDefinition(this.activeTool)?.kind !== "cursor"
    ) {
      this.hideAiTextSizeToolbar();
      return;
    }
    const target = this.topmostAiTextSizeTarget() ?? (this.drawingScope === 'main'
      && this.aiDrawings.some(drawing => tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval()))
      ? { drawing: this.aiTextDrawingsForCurrentContext()[0] ?? this.aiDrawings.find(drawing =>
          tradingAiDrawingMatchesContext(drawing, this.getSymbol(), this.getInterval()))!,
        bounds: { x: 120, y: 80, width: 0, height: 0 } } : null);
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
    const textDrawings = this.aiTextDrawingsForCurrentContext();
    if (!this.aiTextSizeToolbarVisibility.setAvailable(true)) return;
    this.aiTextSizeToolbar.setAttribute("aria-label", 'AI 画线显示与字号');
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
      "elliott-double-combo": ["0", "W", "X", "Y"],
      "elliott-triple-combo": ["0", "W", "X", "Y", "X", "Z"],
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
    const profitColor = appearance.manualDefaults ? "#089981" : "#22ab94";
    const lossColor = "#f23645";
    const upperColor = long ? profitColor : lossColor;
    const lowerColor = long ? lossColor : profitColor;
    const upperStroke = customColor ? color : upperColor;
    const lowerStroke = customColor ? color : lowerColor;
    return `<rect x="${left}" y="${top}" width="${width}" height="${Math.max(middle - top, 1)}" fill="${upperColor}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.18}" stroke="${upperStroke}" ${svgStrokeAttributes(appearance)} opacity="${appearance.opacity}" />`
      + `<rect x="${left}" y="${middle}" width="${width}" height="${Math.max(bottom - middle, 1)}" fill="${lowerColor}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.18}" stroke="${lowerStroke}" ${svgStrokeAttributes(appearance)} opacity="${appearance.opacity}" />`
      + `<text x="${left + 5}" y="${top + 14}" fill="${upperStroke}" font-size="10" font-weight="600">${long ? "目标" : "止损"}</text>`
      + `<text x="${left + 5}" y="${bottom - 5}" fill="${lowerStroke}" font-size="10" font-weight="600">${long ? "止损" : "目标"}</text>`;
  }

  private renderRange(first: ScreenPoint, second: ScreenPoint, definition: TradingDrawingToolDefinition, color: string, appearance: TradingDrawingStrokeAppearance) {
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    return `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${color}" fill-opacity="${appearance.manualDefaults?.fillOpacity ?? 0.06}" stroke="${color}" ${svgStrokeAttributes({ ...appearance, dashed: true }, 1.4)} opacity="${appearance.opacity}" />`;
  }

  private renderProjection(first: ScreenPoint, second: ScreenPoint, definition: TradingDrawingToolDefinition, color: string, appearance: TradingDrawingStrokeAppearance) {
    const points = patternPoints(first, second, definition.id === "bars-pattern" ? 9 : 6);
    const fallbackDash = definition.id === "ghost-feed" ? "4 5" : "7 4";
    const customDash = tradingDrawingStrokeDashArray(appearance.style);
    return `<polyline points="${pointsAttribute(points)}" fill="none" stroke="${color}" stroke-width="${appearance.width ?? 2}" stroke-dasharray="${appearance.style ? customDash : fallbackDash}" marker-end="url(#trading-drawing-arrow)" opacity="${appearance.opacity}" vector-effect="non-scaling-stroke" />`;
  }

  private renderInfoLineCard(drawing: TradingDrawingModel, first: ScreenPoint, second: ScreenPoint, bounds: { width: number; height: number }, opacity: number) {
    const start = drawing.points[0], end = drawing.points[drawing.points.length - 1];
    const candles = this.getCandles();
    const startIndex = tradingDrawingLogicalIndexAtTime(candles, start.time);
    const endIndex = tradingDrawingLogicalIndexAtTime(candles, end.time);
    const format = this.getCandleSeries()?.options?.().priceFormat;
    const rows = tradingInfoLineRows({ start, end, first, second,
      bars: startIndex === null || endIndex === null ? null : endIndex - startIndex,
      precision: format?.precision ?? 2, minMove: format?.minMove ?? .01,
    });
    return renderTradingInfoLineCard(rows, first, second, bounds, opacity);
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

  private handlePlanDrawingHistoryChanged = (event: Event) => {
    if ((event as CustomEvent<string>).detail === this.storageSessionId) this.redraw();
  };

  destroy() {
    for (const timer of this.volumeProfileTimers.values()) window.clearTimeout(timer);
    this.volumeHistory?.destroy();
    this.volumeProfileTimers.clear();
    closeColorPicker(this.selectionToolbar);
    this.crosshair.destroy();
    this.selectionToolbarResizeObserver?.disconnect();
    this.manualSync?.destroy();
    this.aiTextSizeToolbarVisibility.destroy();
    this.drawingVisibility.destroy();
    if (this.destroyed) return;
    this.destroyed = true;
    this.aiPlanAutoscale?.destroy();
    this.hoverText.destroy();
    this.aiAnnotationHover.destroy();
    this.overlay.classList.remove('drawing-handles-idle');
    this.finishHorizontalLineTextEdit(false, false);
    this.horizontalLineSettings.close();
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
    this.overlay.removeEventListener("click", this.handleHorizontalLineAddTextClick);
    this.overlay.removeEventListener("keydown", this.handleHorizontalLineAddTextKeyDown);
    this.overlay.removeEventListener("contextmenu", this.handleContextMenu);
    this.overlay.removeEventListener("dblclick", this.handleDrawingDoubleClick);
    this.magicTrail?.remove();
    this.magicTrail = null;
    this.overlay.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerUp);
    document.removeEventListener("pointercancel", this.handlePointerCancel);
    document.removeEventListener('paste', this.handleDrawingImagePaste);
    this.imageDialog.close();
    this.xPostDialog.close();
    this.overlay.removeEventListener("lostpointercapture", this.handlePointerCancel);
    window.removeEventListener("blur", this.cancelPointerInteraction);
    window.removeEventListener(PLAN_DRAWING_HISTORY_CHANGED, this.handlePlanDrawingHistoryChanged);
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown);
    document.removeEventListener("focusin", this.handleInlineTextFocusIn);
    document.removeEventListener("pointerdown", this.handleToolMenuOutsidePointerDown, true);
    document.removeEventListener("pointerdown", this.handleChartBackgroundPointerDown, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener('keydown', this.handleMagnetModifierChange, true);
    document.removeEventListener('keyup', this.handleMagnetModifierChange, true);
  }
}

function distanceToSegment(point: ScreenPoint, first: ScreenPoint, second: ScreenPoint) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (!dx && !dy) return Math.hypot(point.x - first.x, point.y - first.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (first.x + ratio * dx), point.y - (first.y + ratio * dy));
}
