export type TradingChartStyle =
  | "candlestick"
  | "hlc"
  | "bars"
  | "close-line"
  | "heikin-ashi";

export type TradingPriceAdjustment = "none" | "forward" | "backward";
export type TradingScaleAnchor = "cursor" | "right";
export type TradingPriceScaleMode = "linear" | "logarithmic" | "percentage";
export type TradingChartThemeName = "light" | "dark";

export interface TradingChartThemeSettings {
  verticalGridVisible: boolean;
  verticalGridColor: string;
  horizontalGridVisible: boolean;
  horizontalGridColor: string;
  crosshairColor: string;
  backgroundColor: string;
}

export interface TradingOrderDisplaySettings {
  currentOrders: boolean;
  positions: boolean;
  liquidation: boolean;
  takeProfitStopLoss: boolean;
}

export interface TradingChartSettings {
  version: 5;
  chartStyle: TradingChartStyle;
  priceAdjustment: TradingPriceAdjustment;
  verticalPaddingPercent: number;
  hollowRising: boolean;
  risingColor: string;
  fallingColor: string;
  showCandleBorder: boolean;
  showWicks: boolean;
  scaleAnchor: TradingScaleAnchor;
  priceScaleMode: TradingPriceScaleMode;
  autoScale: boolean;
  showPriceLine: boolean;
  showPriceLabel: boolean;
  showCountdown: boolean;
  drawingToolsEnabled: boolean;
  orderDisplay: TradingOrderDisplaySettings;
  themes: Record<TradingChartThemeName, TradingChartThemeSettings>;
}

export interface TradingChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type TradingChartSettingsTab =
  | "main-style"
  | "background"
  | "scale"
  | "rise-fall"
  | "coordinate"
  | "live-price"
  | "drawing-tools"
  | "order-display";

export interface TradingSplitLayoutCell {
  column: number;
  row: number;
  columnSpan?: number;
  rowSpan?: number;
}

export interface TradingSplitLayout {
  id: string;
  count: number;
  label: string;
  columns: number[];
  rows: number[];
  cells: TradingSplitLayoutCell[];
}

export interface TradingFloatingOverlayPlacementInput {
  hostWidth: number;
  hostHeight: number;
  anchorLeft: number;
  anchorTop: number;
  anchorBottom: number;
  preferredWidth?: number;
  preferredHeight?: number;
  edge?: number;
  gap?: number;
}

export interface TradingFloatingOverlayPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top: number | null;
  bottom: number | null;
  placement: "above" | "below";
}

export const TRADING_CHART_SETTINGS_STORAGE_KEY = "haolo.trading-market.chart-settings.v1";
export const TRADING_SPLIT_LAYOUT_STORAGE_KEY = "haolo.trading-market.split-layout.v1";
export const DEFAULT_TRADING_SPLIT_LAYOUT_ID = "1-single";

export function tradingPriceScaleUsesAutoScale(mode: TradingPriceScaleMode) {
  return mode !== "linear";
}

export const DEFAULT_TRADING_CHART_SETTINGS: Readonly<TradingChartSettings> = {
  version: 5,
  chartStyle: "hlc",
  priceAdjustment: "none",
  verticalPaddingPercent: 2,
  hollowRising: false,
  risingColor: "#2EBD85",
  fallingColor: "#F6465D",
  showCandleBorder: true,
  showWicks: true,
  scaleAnchor: "right",
  priceScaleMode: "linear",
  autoScale: false,
  showPriceLine: true,
  showPriceLabel: true,
  showCountdown: false,
  drawingToolsEnabled: true,
  orderDisplay: {
    currentOrders: true,
    positions: true,
    liquidation: true,
    takeProfitStopLoss: true,
  },
  themes: {
    light: {
      verticalGridVisible: false,
      verticalGridColor: "#edf1f6",
      horizontalGridVisible: true,
      horizontalGridColor: "#edf1f6",
      crosshairColor: "#97a0ad",
      backgroundColor: "#ffffff",
    },
    dark: {
      verticalGridVisible: false,
      verticalGridColor: "#0e1c2e",
      horizontalGridVisible: true,
      horizontalGridColor: "#0e1c2e",
      crosshairColor: "#626b77",
      backgroundColor: "#0b0c0f",
    },
  },
};

const split = (
  id: string,
  count: number,
  label: string,
  columns: number[],
  rows: number[],
  cells: TradingSplitLayoutCell[],
): TradingSplitLayout => ({ id, count, label, columns, rows, cells });

export const TRADING_SPLIT_LAYOUTS: readonly TradingSplitLayout[] = [
  split("1-single", 1, "单窗", [1], [1], [{ column: 1, row: 1 }]),
  split("2-columns", 2, "左右双窗", [1, 1], [1], [
    { column: 1, row: 1 }, { column: 2, row: 1 },
  ]),
  split("2-rows", 2, "上下双窗", [1], [1, 1], [
    { column: 1, row: 1 }, { column: 1, row: 2 },
  ]),
  split("3-columns", 3, "三列", [1, 1, 1], [1], [
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 },
  ]),
  split("3-rows", 3, "三行", [1], [1, 1, 1], [
    { column: 1, row: 1 }, { column: 1, row: 2 }, { column: 1, row: 3 },
  ]),
  split("3-left-major", 3, "左主双辅", [2, 1], [1, 1], [
    { column: 1, row: 1, rowSpan: 2 }, { column: 2, row: 1 }, { column: 2, row: 2 },
  ]),
  split("3-top-major", 3, "上主双辅", [1, 1], [2, 1], [
    { column: 1, row: 1, columnSpan: 2 }, { column: 1, row: 2 }, { column: 2, row: 2 },
  ]),
  split("4-grid", 4, "四宫格", [1, 1], [1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 },
    { column: 1, row: 2 }, { column: 2, row: 2 },
  ]),
  split("4-columns", 4, "四列", [1, 1, 1, 1], [1], [
    { column: 1, row: 1 }, { column: 2, row: 1 },
    { column: 3, row: 1 }, { column: 4, row: 1 },
  ]),
  split("4-rows", 4, "四行", [1], [1, 1, 1, 1], [
    { column: 1, row: 1 }, { column: 1, row: 2 },
    { column: 1, row: 3 }, { column: 1, row: 4 },
  ]),
  split("4-left-major", 4, "左主三辅", [2, 1], [1, 1, 1], [
    { column: 1, row: 1, rowSpan: 3 },
    { column: 2, row: 1 }, { column: 2, row: 2 }, { column: 2, row: 3 },
  ]),
  split("5-balanced", 5, "上二下三", [1, 1, 1, 1, 1, 1], [1, 1], [
    { column: 1, row: 1, columnSpan: 3 }, { column: 4, row: 1, columnSpan: 3 },
    { column: 1, row: 2, columnSpan: 2 }, { column: 3, row: 2, columnSpan: 2 },
    { column: 5, row: 2, columnSpan: 2 },
  ]),
  split("5-left-major", 5, "左主四辅", [2, 1, 1], [1, 1], [
    { column: 1, row: 1, rowSpan: 2 },
    { column: 2, row: 1 }, { column: 3, row: 1 },
    { column: 2, row: 2 }, { column: 3, row: 2 },
  ]),
  split("5-top-major", 5, "上主四辅", [1, 1, 1, 1], [2, 1], [
    { column: 1, row: 1, columnSpan: 4 },
    { column: 1, row: 2 }, { column: 2, row: 2 },
    { column: 3, row: 2 }, { column: 4, row: 2 },
  ]),
  split("6-three-by-two", 6, "三列两行", [1, 1, 1], [1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 },
    { column: 1, row: 2 }, { column: 2, row: 2 }, { column: 3, row: 2 },
  ]),
  split("6-two-by-three", 6, "两列三行", [1, 1], [1, 1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 },
    { column: 1, row: 2 }, { column: 2, row: 2 },
    { column: 1, row: 3 }, { column: 2, row: 3 },
  ]),
  split("6-left-major", 6, "左主五辅", [2, 1], [1, 1, 1, 1, 1], [
    { column: 1, row: 1, rowSpan: 5 },
    { column: 2, row: 1 }, { column: 2, row: 2 }, { column: 2, row: 3 },
    { column: 2, row: 4 }, { column: 2, row: 5 },
  ]),
  split("7-top-three-bottom-four", 7, "上三下四", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1], [
    { column: 1, row: 1, columnSpan: 4 }, { column: 5, row: 1, columnSpan: 4 },
    { column: 9, row: 1, columnSpan: 4 },
    { column: 1, row: 2, columnSpan: 3 }, { column: 4, row: 2, columnSpan: 3 },
    { column: 7, row: 2, columnSpan: 3 }, { column: 10, row: 2, columnSpan: 3 },
  ]),
  split("7-left-major", 7, "左主六辅", [2, 1, 1], [1, 1, 1], [
    { column: 1, row: 1, rowSpan: 3 },
    { column: 2, row: 1 }, { column: 3, row: 1 },
    { column: 2, row: 2 }, { column: 3, row: 2 },
    { column: 2, row: 3 }, { column: 3, row: 3 },
  ]),
  split("8-four-by-two", 8, "四列两行", [1, 1, 1, 1], [1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 }, { column: 4, row: 1 },
    { column: 1, row: 2 }, { column: 2, row: 2 }, { column: 3, row: 2 }, { column: 4, row: 2 },
  ]),
  split("8-two-by-four", 8, "两列四行", [1, 1], [1, 1, 1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 1, row: 2 }, { column: 2, row: 2 },
    { column: 1, row: 3 }, { column: 2, row: 3 }, { column: 1, row: 4 }, { column: 2, row: 4 },
  ]),
  split("9-grid", 9, "九宫格", [1, 1, 1], [1, 1, 1], [
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 },
    { column: 1, row: 2 }, { column: 2, row: 2 }, { column: 3, row: 2 },
    { column: 1, row: 3 }, { column: 2, row: 3 }, { column: 3, row: 3 },
  ]),
];

const chartStyles = new Set<TradingChartStyle>([
  "candlestick", "hlc", "bars", "close-line", "heikin-ashi",
]);
const adjustments = new Set<TradingPriceAdjustment>(["none", "forward", "backward"]);
const scaleAnchors = new Set<TradingScaleAnchor>(["cursor", "right"]);
const priceScaleModes = new Set<TradingPriceScaleMode>(["linear", "logarithmic", "percentage"]);
const hexColorPattern = /^#[0-9a-f]{6}$/i;

function cloneTheme(theme: TradingChartThemeSettings): TradingChartThemeSettings {
  return { ...theme };
}

export function cloneTradingChartSettings(
  settings: TradingChartSettings = DEFAULT_TRADING_CHART_SETTINGS,
): TradingChartSettings {
  return {
    ...settings,
    orderDisplay: { ...settings.orderDisplay },
    themes: {
      light: cloneTheme(settings.themes.light),
      dark: cloneTheme(settings.themes.dark),
    },
  };
}

function color(value: unknown, fallback: string) {
  const normalized = String(value || "").trim();
  return hexColorPattern.test(normalized) ? normalized.toUpperCase() : fallback;
}

function finitePercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(15, Math.max(0, Math.round(numeric))) : fallback;
}

function normalizeTheme(
  value: unknown,
  fallback: TradingChartThemeSettings,
): TradingChartThemeSettings {
  const source = value && typeof value === "object" ? value as Partial<TradingChartThemeSettings> : {};
  return {
    verticalGridVisible: typeof source.verticalGridVisible === "boolean"
      ? source.verticalGridVisible
      : fallback.verticalGridVisible,
    verticalGridColor: color(source.verticalGridColor, fallback.verticalGridColor),
    horizontalGridVisible: typeof source.horizontalGridVisible === "boolean"
      ? source.horizontalGridVisible
      : fallback.horizontalGridVisible,
    horizontalGridColor: color(source.horizontalGridColor, fallback.horizontalGridColor),
    crosshairColor: color(source.crosshairColor, fallback.crosshairColor),
    backgroundColor: color(source.backgroundColor, fallback.backgroundColor),
  };
}

function normalizeOrderDisplay(
  value: unknown,
  fallback: TradingOrderDisplaySettings,
): TradingOrderDisplaySettings {
  const source = value && typeof value === "object"
    ? value as Partial<TradingOrderDisplaySettings>
    : {};
  return {
    currentOrders: typeof source.currentOrders === "boolean"
      ? source.currentOrders
      : fallback.currentOrders,
    positions: typeof source.positions === "boolean"
      ? source.positions
      : fallback.positions,
    liquidation: typeof source.liquidation === "boolean"
      ? source.liquidation
      : fallback.liquidation,
    takeProfitStopLoss: typeof source.takeProfitStopLoss === "boolean"
      ? source.takeProfitStopLoss
      : fallback.takeProfitStopLoss,
  };
}

export function normalizeTradingChartSettings(value: unknown): TradingChartSettings {
  const defaults = DEFAULT_TRADING_CHART_SETTINGS;
  const source = value && typeof value === "object" ? value as Partial<TradingChartSettings> : {};
  const sourceThemes = source.themes && typeof source.themes === "object" ? source.themes : {} as TradingChartSettings["themes"];
  const sourceVersion = Number((source as { version?: unknown }).version);
  const sourceChartStyle = chartStyles.has(source.chartStyle as TradingChartStyle)
    ? source.chartStyle as TradingChartStyle
    : defaults.chartStyle;
  const lightTheme = normalizeTheme(sourceThemes.light, defaults.themes.light);
  if ((!Number.isFinite(sourceVersion) || sourceVersion < 2) && lightTheme.backgroundColor === "#F7F9FC") {
    lightTheme.backgroundColor = defaults.themes.light.backgroundColor;
  }
  return {
    version: 5,
    chartStyle: (!Number.isFinite(sourceVersion) || sourceVersion < 3)
      && sourceChartStyle === "candlestick"
      ? "hlc"
      : sourceChartStyle,
    priceAdjustment: adjustments.has(source.priceAdjustment as TradingPriceAdjustment)
      ? source.priceAdjustment as TradingPriceAdjustment
      : defaults.priceAdjustment,
    verticalPaddingPercent: finitePercent(source.verticalPaddingPercent, defaults.verticalPaddingPercent),
    hollowRising: typeof source.hollowRising === "boolean" ? source.hollowRising : defaults.hollowRising,
    risingColor: color(source.risingColor, defaults.risingColor),
    fallingColor: color(source.fallingColor, defaults.fallingColor),
    showCandleBorder: typeof source.showCandleBorder === "boolean"
      ? source.showCandleBorder
      : defaults.showCandleBorder,
    showWicks: typeof source.showWicks === "boolean" ? source.showWicks : defaults.showWicks,
    scaleAnchor: sourceVersion >= 4 && scaleAnchors.has(source.scaleAnchor as TradingScaleAnchor)
      ? source.scaleAnchor as TradingScaleAnchor
      : defaults.scaleAnchor,
    // The relocated A/L settings start unchecked when upgrading the old toolbar.
    priceScaleMode: sourceVersion >= 5 && priceScaleModes.has(source.priceScaleMode as TradingPriceScaleMode)
      ? source.priceScaleMode as TradingPriceScaleMode
      : defaults.priceScaleMode,
    autoScale: typeof source.autoScale === "boolean" ? source.autoScale : defaults.autoScale,
    showPriceLine: typeof source.showPriceLine === "boolean" ? source.showPriceLine : defaults.showPriceLine,
    showPriceLabel: typeof source.showPriceLabel === "boolean" ? source.showPriceLabel : defaults.showPriceLabel,
    showCountdown: typeof source.showCountdown === "boolean" ? source.showCountdown : defaults.showCountdown,
    drawingToolsEnabled: typeof source.drawingToolsEnabled === "boolean"
      ? source.drawingToolsEnabled
      : defaults.drawingToolsEnabled,
    orderDisplay: normalizeOrderDisplay(source.orderDisplay, defaults.orderDisplay),
    themes: {
      light: lightTheme,
      dark: normalizeTheme(sourceThemes.dark, defaults.themes.dark),
    },
  };
}

export function filterTradingOrderLinesForDisplay<T extends { kind: string }>(
  lines: readonly T[],
  settings: TradingOrderDisplaySettings,
): T[] {
  return lines.filter((line) => {
    if (line.kind === "position-long" || line.kind === "position-short") {
      return settings.positions;
    }
    if (line.kind === "liquidation") return settings.liquidation;
    if (line.kind === "take-profit" || line.kind === "stop-loss") {
      return settings.takeProfitStopLoss;
    }
    return settings.currentOrders;
  });
}

export function loadTradingChartSettings(storage: Pick<Storage, "getItem">): TradingChartSettings {
  try {
    const raw = storage.getItem(TRADING_CHART_SETTINGS_STORAGE_KEY);
    return raw ? normalizeTradingChartSettings(JSON.parse(raw)) : cloneTradingChartSettings();
  } catch {
    return cloneTradingChartSettings();
  }
}

export function saveTradingChartSettings(
  storage: Pick<Storage, "setItem">,
  settings: TradingChartSettings,
) {
  storage.setItem(TRADING_CHART_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeTradingChartSettings(settings)));
}

export function normalizeTradingSplitLayoutId(value: unknown) {
  const id = String(value || "");
  return TRADING_SPLIT_LAYOUTS.some((layout) => layout.id === id)
    ? id
    : DEFAULT_TRADING_SPLIT_LAYOUT_ID;
}

export function loadTradingSplitLayoutId(storage: Pick<Storage, "getItem">) {
  try {
    return normalizeTradingSplitLayoutId(storage.getItem(TRADING_SPLIT_LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_TRADING_SPLIT_LAYOUT_ID;
  }
}

export function saveTradingSplitLayoutId(storage: Pick<Storage, "setItem">, layoutId: string) {
  storage.setItem(TRADING_SPLIT_LAYOUT_STORAGE_KEY, normalizeTradingSplitLayoutId(layoutId));
}

export function tradingSplitLayout(layoutId: string) {
  return TRADING_SPLIT_LAYOUTS.find((layout) => layout.id === layoutId)
    ?? TRADING_SPLIT_LAYOUTS[0];
}

export function tradingFloatingOverlayPlacement(
  input: TradingFloatingOverlayPlacementInput,
): TradingFloatingOverlayPlacement {
  const finiteOr = (value: number | undefined, fallback: number) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const hostWidth = Math.max(finiteOr(input.hostWidth, 0), 1);
  const hostHeight = Math.max(finiteOr(input.hostHeight, 0), 1);
  const edge = Math.max(finiteOr(input.edge, 8), 0);
  const gap = Math.max(finiteOr(input.gap, 5), 0);
  const preferredWidth = Math.max(finiteOr(input.preferredWidth, 390), 1);
  const preferredHeight = Math.max(finiteOr(input.preferredHeight, 420), 1);
  const width = Math.max(1, Math.min(preferredWidth, hostWidth - edge * 2));
  const maxLeft = Math.max(edge, hostWidth - edge - width);
  const left = Math.min(Math.max(finiteOr(input.anchorLeft, edge), edge), maxLeft);
  const anchorTop = Math.min(Math.max(finiteOr(input.anchorTop, edge), edge), hostHeight - edge);
  const anchorBottom = Math.min(Math.max(finiteOr(input.anchorBottom, edge), edge), hostHeight - edge);
  const availableBelow = Math.max(0, hostHeight - anchorBottom - gap - edge);
  const availableAbove = Math.max(0, anchorTop - gap - edge);
  const placement = availableBelow >= Math.min(preferredHeight, availableAbove)
    || availableBelow >= availableAbove
    ? "below"
    : "above";
  return {
    left,
    width,
    maxHeight: Math.max(1, placement === "below" ? availableBelow : availableAbove),
    top: placement === "below" ? anchorBottom + gap : null,
    bottom: placement === "above" ? hostHeight - anchorTop + gap : null,
    placement,
  };
}

export function heikinAshiCandles(candles: readonly TradingChartCandle[]) {
  let previousOpen = 0;
  let previousClose = 0;
  return candles.map((candle, index) => {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open = index === 0
      ? (candle.open + candle.close) / 2
      : (previousOpen + previousClose) / 2;
    const transformed = {
      ...candle,
      open,
      close,
      high: Math.max(candle.high, open, close),
      low: Math.min(candle.low, open, close),
    };
    previousOpen = open;
    previousClose = close;
    return transformed;
  });
}

export function hlcCandles(candles: readonly TradingChartCandle[]) {
  return candles.map((candle, index) => ({
    ...candle,
    open: index > 0 ? candles[index - 1].close : candle.open,
  }));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function layoutIcon(layout: TradingSplitLayout) {
  const columnTotal = layout.columns.reduce((total, value) => total + value, 0);
  const rowTotal = layout.rows.reduce((total, value) => total + value, 0);
  const columnOffsets = layout.columns.map((_, index) =>
    layout.columns.slice(0, index).reduce((total, value) => total + value, 0));
  const rowOffsets = layout.rows.map((_, index) =>
    layout.rows.slice(0, index).reduce((total, value) => total + value, 0));
  return `<span class="trading-market-layout-icon" aria-hidden="true">${layout.cells.map((cell) => {
    const left = columnOffsets[cell.column - 1] / columnTotal * 100;
    const top = rowOffsets[cell.row - 1] / rowTotal * 100;
    const width = layout.columns
      .slice(cell.column - 1, cell.column - 1 + (cell.columnSpan ?? 1))
      .reduce((total, value) => total + value, 0) / columnTotal * 100;
    const height = layout.rows
      .slice(cell.row - 1, cell.row - 1 + (cell.rowSpan ?? 1))
      .reduce((total, value) => total + value, 0) / rowTotal * 100;
    return `<i style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></i>`;
  }).join("")}</span>`;
}

export function renderTradingSplitLayoutPicker(activeLayoutId = DEFAULT_TRADING_SPLIT_LAYOUT_ID) {
  const rows = Array.from({ length: 9 }, (_, index) => index + 1).map((count) => {
    const layouts = TRADING_SPLIT_LAYOUTS.filter((layout) => layout.count === count);
    return `
      <div class="trading-market-layout-row" role="group" aria-label="${count}窗布局">
        <span>${count}</span>
        <div>${layouts.map((layout) => `
          <button
            type="button"
            data-market-action="select-split-layout"
            data-market-layout="${escapeHtml(layout.id)}"
            class="${layout.id === activeLayoutId ? "selected" : ""}"
            aria-pressed="${layout.id === activeLayoutId}"
            title="${escapeHtml(layout.label)}"
          >${layoutIcon(layout)}<span class="sr-only">${escapeHtml(layout.label)}</span></button>
        `).join("")}</div>
      </div>
    `;
  }).join("");
  return `
    <section class="trading-market-layout-picker" data-market-layout-picker role="dialog" aria-label="图表排列" hidden>
      <header><strong>图表排列</strong><span>最多 9 窗 · 各窗可独立选择品种与周期</span></header>
      <div class="trading-market-layout-rows">${rows}</div>
    </section>
  `;
}

const option = (name: string, value: string, label: string, checked = false, disabled = false) => `
  <label class="trading-chart-settings-choice${disabled ? " disabled" : ""}">
    <input type="radio" name="${name}" value="${value}" data-chart-setting="${name}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}/>
    <span></span>${label}
  </label>
`;

const checkbox = (key: string, label: string, checked = false) => `
  <label class="trading-chart-settings-check">
    <input type="checkbox" data-chart-setting="${key}" ${checked ? "checked" : ""}/>
    <span></span>${label}
  </label>
`;

const orderDisplaySwitch = (
  key: keyof TradingOrderDisplaySettings,
  label: string,
  checked: boolean,
) => `
  <div class="trading-chart-order-display-row">
    <span class="trading-chart-order-display-copy"><strong>${label}</strong></span>
    <label class="trading-chart-settings-switch">
      <input type="checkbox" data-chart-setting="orderDisplay.${key}" ${checked ? "checked" : ""} aria-label="显示${label}"/>
      <span aria-hidden="true"></span>
    </label>
  </div>
`;

const colorInput = (key: string, label: string, value: string) => `
  <label class="trading-chart-settings-color"><input type="color" data-chart-setting="${key}" value="${value}"/><span>${label}</span></label>
`;

export function renderTradingChartSettingsDialog(
  settings: TradingChartSettings = cloneTradingChartSettings(),
  themeName: TradingChartThemeName = "dark",
) {
  const theme = settings.themes[themeName];
  const tabs: Array<[TradingChartSettingsTab, string]> = [
    ["main-style", "主图样式"],
    ["background", "图表背景"],
    ["scale", "K线缩放"],
    ["rise-fall", "涨跌颜色"],
    ["coordinate", "坐标选择"],
    ["live-price", "实时价格"],
    ["drawing-tools", "画线工具"],
    ["order-display", "订单显示"],
  ];
  return `
    <div class="trading-chart-settings-backdrop" data-market-chart-settings hidden>
      <section class="trading-chart-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="trading-chart-settings-title">
        <header>
          <strong id="trading-chart-settings-title">设置</strong>
          <button type="button" data-market-action="close-chart-settings" aria-label="关闭设置">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg>
          </button>
        </header>
        <div class="trading-chart-settings-body">
          <nav aria-label="图表设置分类">${tabs.map(([id, label], index) => `
            <button type="button" data-market-action="chart-settings-tab" data-market-settings-tab="${id}" class="${index === 0 ? "selected" : ""}" aria-selected="${index === 0}">${label}</button>
          `).join("")}</nav>
          <main>
            <section data-chart-settings-panel="main-style">
              <div class="trading-chart-settings-row"><span>类型</span><div class="trading-chart-settings-options wrap">
                ${option("chartStyle", "candlestick", "K线图", settings.chartStyle === "candlestick")}
                ${option("chartStyle", "hlc", "K线图（HLC）", settings.chartStyle === "hlc")}
                ${option("chartStyle", "bars", "美国线", settings.chartStyle === "bars")}
                ${option("chartStyle", "close-line", "收盘价线", settings.chartStyle === "close-line")}
                ${option("chartStyle", "heikin-ashi", "平均K线", settings.chartStyle === "heikin-ashi")}
              </div></div>
              <div class="trading-chart-settings-row"><span>复权</span><div class="trading-chart-settings-options">
                ${option("priceAdjustment", "none", "不复权", settings.priceAdjustment === "none")}
                ${option("priceAdjustment", "forward", "前复权", settings.priceAdjustment === "forward")}
                ${option("priceAdjustment", "backward", "后复权", settings.priceAdjustment === "backward")}
              </div><small>永续与现货没有除权事件，三种模式会保持原始真实价格。</small></div>
              <div class="trading-chart-settings-row"><span>上下间距</span><label class="trading-chart-settings-number"><input type="number" min="0" max="15" step="1" data-chart-setting="verticalPaddingPercent" value="${settings.verticalPaddingPercent}"/><b>%</b></label></div>
              <div class="trading-chart-settings-row"><span>K线阳柱</span><div class="trading-chart-settings-options">
                ${option("hollowRising", "true", "空心", settings.hollowRising)}
                ${option("hollowRising", "false", "实心", !settings.hollowRising)}
              </div></div>
              <div class="trading-chart-settings-row"><span>柱子颜色</span><div class="trading-chart-settings-options">${colorInput("risingColor", "上涨", settings.risingColor)}${colorInput("fallingColor", "下跌", settings.fallingColor)}</div></div>
              <div class="trading-chart-settings-row"><span>边框颜色</span><div class="trading-chart-settings-options">${colorInput("risingColor", "上涨", settings.risingColor)}${colorInput("fallingColor", "下跌", settings.fallingColor)}${checkbox("showCandleBorder", "显示边框", settings.showCandleBorder)}</div></div>
              <div class="trading-chart-settings-row"><span>影线颜色</span><div class="trading-chart-settings-options">${colorInput("risingColor", "上涨", settings.risingColor)}${colorInput("fallingColor", "下跌", settings.fallingColor)}${checkbox("showWicks", "显示影线", settings.showWicks)}</div></div>
            </section>
            <section data-chart-settings-panel="background" hidden>
              <div class="trading-chart-settings-row"><span>垂直辅助线</span><div class="trading-chart-settings-options">${checkbox("theme.verticalGridVisible", "显示", theme.verticalGridVisible)}${colorInput("theme.verticalGridColor", "颜色", theme.verticalGridColor)}</div></div>
              <div class="trading-chart-settings-row"><span>水平辅助线</span><div class="trading-chart-settings-options">${checkbox("theme.horizontalGridVisible", "显示", theme.horizontalGridVisible)}${colorInput("theme.horizontalGridColor", "颜色", theme.horizontalGridColor)}</div></div>
              <div class="trading-chart-settings-row"><span>十字线</span><div class="trading-chart-settings-options">${colorInput("theme.crosshairColor", "颜色", theme.crosshairColor)}<span class="trading-chart-settings-line-preview dashed"></span></div></div>
              <div class="trading-chart-settings-row"><span>背景颜色</span><div class="trading-chart-settings-options">${colorInput("theme.backgroundColor", "颜色", theme.backgroundColor)}</div></div>
              <p class="trading-chart-settings-theme-note">当前正在编辑${themeName === "dark" ? "暗色" : "亮色"}主题；切换主题后可分别设置另一套颜色。</p>
            </section>
            <section data-chart-settings-panel="scale" hidden>
              <div class="trading-chart-settings-row"><span>K线缩放</span><div class="trading-chart-settings-options vertical">
                ${option("scaleAnchor", "cursor", "以光标位置缩放 K 线（Ctrl + 滚轮始终聚焦光标）", settings.scaleAnchor === "cursor")}
                ${option("scaleAnchor", "right", "以最右侧位置缩放 K 线（TradingView 默认，Ctrl + 滚轮聚焦光标）", settings.scaleAnchor === "right")}
              </div></div>
            </section>
            <section data-chart-settings-panel="rise-fall" hidden>
              <div class="trading-chart-settings-row"><span>涨跌颜色</span><div class="trading-chart-settings-options">
                ${option("riseFallPalette", "green-up", "绿涨红跌", settings.risingColor.toUpperCase() !== "#F6465D")}
                ${option("riseFallPalette", "red-up", "红涨绿跌", settings.risingColor.toUpperCase() === "#F6465D")}
              </div></div>
            </section>
            <section data-chart-settings-panel="coordinate" hidden>
              <div class="trading-chart-settings-row"><span>主图价格坐标</span><div class="trading-chart-settings-options vertical">
                ${checkbox("autoScale", "自动适配价格", settings.autoScale)}
                ${checkbox("logarithmicScale", "对数坐标", settings.priceScaleMode === "logarithmic")}
                ${checkbox("percentageScale", "百分比坐标", settings.priceScaleMode === "percentage")}
              </div></div>
              <p class="trading-chart-settings-theme-note">默认使用线性坐标，自动适配和对数坐标均关闭；这些设置仅作用于主图价格，不影响成交量等副图。</p>
            </section>
            <section data-chart-settings-panel="live-price" hidden>
              <div class="trading-chart-settings-row"><span>实时价格</span><div class="trading-chart-settings-options">
                ${checkbox("showPriceLine", "价格线", settings.showPriceLine)}
                ${checkbox("showPriceLabel", "价格标签", settings.showPriceLabel)}
                ${checkbox("showCountdown", "K线结束倒计时", settings.showCountdown)}
              </div></div>
            </section>
            <section data-chart-settings-panel="drawing-tools" hidden>
              <div class="trading-chart-settings-row"><span>画线工具</span><div class="trading-chart-settings-options">
                ${option("drawingToolsEnabled", "true", "打开", settings.drawingToolsEnabled)}
                ${option("drawingToolsEnabled", "false", "关闭", !settings.drawingToolsEnabled)}
              </div></div>
            </section>
            <section data-chart-settings-panel="order-display" hidden>
              <div class="trading-chart-order-display-list">
                ${orderDisplaySwitch("currentOrders", "当前委托", settings.orderDisplay.currentOrders)}
                ${orderDisplaySwitch("positions", "当前持仓", settings.orderDisplay.positions)}
                ${orderDisplaySwitch("liquidation", "强平价格", settings.orderDisplay.liquidation)}
                ${orderDisplaySwitch("takeProfitStopLoss", "止盈止损", settings.orderDisplay.takeProfitStopLoss)}
              </div>
            </section>
          </main>
        </div>
        <footer><button type="button" data-market-action="restore-chart-settings">恢复默认</button></footer>
      </section>
    </div>
  `;
}
