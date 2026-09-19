import type { AutoscaleInfoProvider, IChartApi, IPaneApi, IPriceScaleApi, Time } from "lightweight-charts";
import { translateAppText } from "./app-language.mjs";
import { beginTradingChartInteraction, endTradingChartInteraction } from "./trading-chart-interaction.ts";

/** Native gestures own the axes, pan and pinch; the coordinator owns TV modifiers. */
export const TRADING_CHART_NAVIGATION_OPTIONS = {
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
  handleScale: {
    axisPressedMouseMove: { time: true, price: true },
    axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true,
  },
  kineticScroll: { mouse: false, touch: false },
};

/** Explicit zoom controls fit prices again after a box zoom or a manual drag.
 * Clamp the requested span before submitting it: the native scale clamps bar
 * spacing but still applies the requested right edge, which otherwise pans the
 * chart farther into empty future space on every click at the zoom-out limit.
 */
export function zoomTradingChart(chart: IChartApi | null, factor: number) {
  if (!chart || !Number.isFinite(factor) || factor <= 0 || factor === 1) return false;
  const ts = chart.timeScale(), range = ts.getVisibleLogicalRange(), width = ts.width();
  if (!range || ![range.from, range.to, width].every(Number.isFinite) || range.to <= range.from || width <= 0) return false;
  const options = ts.options();
  const maxSpan = Math.max(1, width / options.minBarSpacing - 1);
  const minSpan = Math.min(maxSpan, Math.max(4, width / (options.maxBarSpacing || width / 2) - 1));
  const span = Math.min(maxSpan, Math.max(minSpan, (range.to - range.from) * factor));
  const center = (range.from + range.to) / 2;
  chart.panes().forEach(pane => chart.priceScale("right", pane.paneIndex()).setAutoScale(true));
  if (Math.abs(span - (range.to - range.from)) > 1e-6) {
    ts.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
  }
  return true;
}

export function captureManualTradingPriceRanges(chart: IChartApi | null) {
  return chart?.panes().flatMap((pane) => {
    const scale = chart.priceScale("right", pane.paneIndex());
    // v5 logarithmic reads return prices, while writes consume log units.
    const range = scale.options().autoScale || scale.options().mode === 1 ? null : scale.getVisibleRange();
    return range ? [{ scale, range, mode: scale.options().mode }] : [];
  }) ?? [];
}

export function restoreManualTradingPriceRanges(snapshots: ReturnType<typeof captureManualTradingPriceRanges>) {
  for (const { scale, range, mode } of snapshots) {
    if (scale.options().mode === mode) scale.setVisibleRange(range);
  }
}

type Tool = "zoom" | "measure" | null;
type Point = { x: number; y: number };
type Candle = { time: number; volume?: number };
interface NavigationOptions {
  onFocus?: (paneIndex: number) => void;
  getCandles?: () => readonly Candle[];
  getScaleAnchor?: () => "cursor" | "right";
  getAutoScale?: () => boolean;
  /** Legacy linear fit, using only the visible candles and configured padding. */
  getLockedPriceRange?: (logicalRange: { from: number; to: number } | null) => { from: number; to: number } | null;
  onAutoScaleChange?: (enabled: boolean) => void;
  onPriceModeChange?: (mode: "linear" | "logarithmic" | "percentage") => void;
}

const defaultAutoscaleInfo: AutoscaleInfoProvider = (base) => base();

/** v5.1 logarithmic range writes accept internal units, not prices. Let the
 * native autoscaler convert an explicit price range, then freeze it synchronously.
 * This uses public APIs and preserves every series' provider; no offset inference
 * or rounded getVisibleRange() values are involved, even for narrow price ranges.
 */
export function setTradingLogPriceRange(pane: IPaneApi<Time>, scale: IPriceScaleApi, from: number, to: number) {
  if (![from, to].every(Number.isFinite) || from >= to || scale.options().mode !== 1) return false;
  const saved = pane.getSeries().filter(series => (series.options().priceScaleId ?? "right") === "right")
    .map(series => ({ series, provider: series.options().autoscaleInfoProvider }));
  const source = saved.find(({ series }) => series.options().visible !== false && series.coordinateToPrice(0) !== null)?.series;
  if (!source) return false;
  const wasAuto = scale.options().autoScale;
  let applied = false;
  try {
    for (const { series } of saved) series.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: from, maxValue: to } }) });
    // Reapplying the mode invalidates the lazy native range before the read.
    scale.applyOptions({ mode: 1, autoScale: true });
    const coordinatePrice = source.coordinateToPrice(0);
    applied = coordinatePrice !== null && Number.isFinite(coordinatePrice);
  } finally {
    scale.setAutoScale(applied ? false : wasAuto);
    // applyOptions ignores undefined; explicitly restore the default provider.
    for (const { series, provider } of saved) series.applyOptions({ autoscaleInfoProvider: provider ?? defaultAutoscaleInfo });
  }
  return applied;
}

export class TradingChartNavigation {
  private readonly element: HTMLElement;
  private readonly getChart: () => IChartApi | null;
  private readonly redraw: () => void;
  private readonly options: NavigationOptions;
  private readonly root: HTMLElement;
  private readonly controls: HTMLDivElement;
  private verticalLocked = false;
  private freezeAutoNextFrame = false;
  private tool: Tool = null;
  private drag: { pointerId: number; x: number; y: number; scale: IPriceScaleApi | null; moved: boolean;
    axis?: { scale: IPriceScaleApi; range: { from: number; to: number }; height: number; y: number };
    lockedScroll?: { position: number; barSpacing: number; pending: number | null } } | null = null;
  private selection: {
    pane: IPaneApi<Time>; element: HTMLDivElement; label: HTMLDivElement;
    bounds: { left: number; right: number; top: number; bottom: number };
    start: Point; end: Point; kind: Exclude<Tool, null>; autoScale: boolean; awaitingClick: boolean;
  } | null = null;
  private measurement: HTMLDivElement | null = null;
  private measurementPane: IPaneApi<Time> | null = null;
  private measurementGeometry: number[] | null = null;
  private measurementSeries: ReturnType<IPaneApi<Time>["getSeries"]>[number] | null = null;
  private readonly timeScale: ReturnType<IChartApi["timeScale"]> | undefined;
  private readonly resizeObserver: ResizeObserver | null;
  private frame: number | null = null;
  private framesRemaining = 0;
  private interactionTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private activePane = 0;
  private menu: HTMLDivElement | null = null;
  private maximized: { pane: IPaneApi<Time>; factors: Map<IPaneApi<Time>, number> } | null = null;
  private collapsed = new Map<IPaneApi<Time>, number>();
  private expandedChart: HTMLElement | null = null;

  constructor(
    element: HTMLElement,
    getChart: () => IChartApi | null,
    redraw: () => void,
    options: NavigationOptions = {},
  ) {
    this.element = element;
    this.getChart = getChart;
    this.redraw = redraw;
    this.options = options;
    this.root = element.parentElement ?? element;
    element.classList.add("trading-chart-navigable");
    element.tabIndex = 0;
    element.setAttribute("aria-label", translateAppText("K 线图表"));
    this.controls = document.createElement("div");
    this.controls.className = "trading-chart-navigation-controls";
    const buttons = [
      ["zoom-out", "−", "缩小"], ["zoom-in", "+", "放大"],
      ["left", "‹", "向左移动"], ["right", "›", "向右移动"], ["reset", "↺", "重置图表（Alt + R）"],
      ["lock-vertical", "", "锁定并自动适配价格"],
    ];
    for (const [action, text, label] of buttons) {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.navigationAction = action;
      button.textContent = text; button.title = translateAppText(label);
      button.setAttribute("aria-label", button.title);
      if (action === "lock-vertical") {
        button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="9" rx="2"/><path data-lock-shackle d="M7 9V6a3 3 0 0 1 6 0v3"/><path d="M10 12v3"/></svg>';
        button.setAttribute("aria-pressed", "false");
      }
      this.controls.append(button);
    }
    this.controls.addEventListener("click", this.controlClick);
    element.append(this.controls);
    this.root.addEventListener("pointerdown", this.pointerDown, true);
    element.addEventListener("wheel", this.wheel, { capture: true, passive: false });
    this.root.addEventListener("dblclick", this.doubleClick, true);
    element.addEventListener("keydown", this.keyDown);
    this.root.addEventListener("contextmenu", this.contextMenu);
    window.addEventListener("pointermove", this.pointerMove, true);
    window.addEventListener("pointerup", this.pointerEnd, true);
    window.addEventListener("pointercancel", this.pointerEnd, true);
    window.addEventListener("pointerdown", this.outsidePointerDown, true);
    window.addEventListener("blur", this.cancelGesture);
    this.timeScale = getChart()?.timeScale();
    this.timeScale?.subscribeVisibleLogicalRangeChange(this.viewportChanged);
    this.timeScale?.subscribeSizeChange(this.viewportChanged);
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.viewportChanged);
    this.resizeObserver?.observe(element);
    this.schedule();
  }

  getTool() { return this.tool; }

  setAutoScale(enabled: boolean, paneIndex = 0) {
    const chart = this.getChart(); if (!chart) return;
    if (paneIndex === 0) { this.freezeAutoNextFrame = false; this.options.onAutoScaleChange?.(enabled); }
    chart.priceScale("right", paneIndex).setAutoScale(enabled);
    if (paneIndex === 0 && this.verticalLocked) this.syncAutoScale();
    this.schedule();
  }

  private syncAutoScale() {
    const chart = this.getChart();
    if (chart && this.verticalLocked && !this.selection) {
      this.freezeAutoNextFrame = false;
      const scale = chart.priceScale("right", 0);
      // Restore the pre-navigation behavior: recompute linear bounds from the
      // CURRENT visible candles; log/percentage (and split charts) use the
      // native autoscaler. Locking is a viewport mode, not a saved A preference.
      if (scale.options().mode === 0 && this.options.getLockedPriceRange) {
        const range = this.options.getLockedPriceRange(chart.timeScale().getVisibleLogicalRange());
        if (range) {
          if (scale.options().autoScale) scale.setAutoScale(false);
          const current = scale.getVisibleRange();
          if (current?.from !== range.from || current.to !== range.to) scale.setVisibleRange(range);
        }
      } else if (!scale.options().autoScale) scale.setAutoScale(true);
      return;
    }
    if (!chart || this.options.getAutoScale?.() !== false) { this.freezeAutoNextFrame = false; return; }
    const pane = chart.panes()[0], scale = chart.priceScale("right", 0);
    if (!pane || !scale.options().autoScale) { this.freezeAutoNextFrame = false; return; }
    // Native setVisibleLogicalRange queues its target for the chart's next
    // paint. Give it that paint before freezing, even if our RAF ran first.
    if (!this.freezeAutoNextFrame) { this.freezeAutoNextFrame = true; this.schedule(2); return; }
    this.freezeAutoNextFrame = false;
    if (this.priceSeries(pane)?.coordinateToPrice(pane.getHeight() / 2) != null) scale.setAutoScale(false);
  }

  private flushLockedScroll() {
    const scroll = this.drag?.lockedScroll;
    if (scroll?.pending == null) return;
    const position = scroll.pending; scroll.pending = null;
    this.getChart()?.timeScale().scrollToPosition(position, false);
  }

  private toggleVerticalLock() {
    this.cancelGesture();
    this.verticalLocked = !this.verticalLocked;
    // Horizontal movement remains coalesced once per frame; that same frame
    // fits the new visible high/low instead of preserving a stale price range.
    const chart = this.getChart();
    chart?.applyOptions({ handleScroll: {
      pressedMouseMove: !this.verticalLocked,
      horzTouchDrag: !this.verticalLocked,
      vertTouchDrag: !this.verticalLocked,
    } });
    this.freezeAutoNextFrame = false;
    if (this.verticalLocked) this.syncAutoScale();
    else chart?.priceScale("right", 0).setAutoScale(this.options.getAutoScale?.() ?? false);
    this.schedule();
  }

  setTool(tool: Tool) {
    this.cancelGesture();
    this.tool = tool;
    this.root.dataset.chartNavigationTool = tool ?? "";
    this.element.dispatchEvent(new CustomEvent("trading-navigation-tool-change"));
    if (tool) this.element.focus({ preventScroll: true });
  }

  private paneAt(event: { clientX: number; clientY: number }, plotOnly = true) {
    const chart = this.getChart();
    return chart?.panes().find((pane) => {
      const b = pane.getHTMLElement()?.getBoundingClientRect();
      return b && event.clientY >= b.top && event.clientY < b.bottom
        && event.clientX >= b.left + (plotOnly ? chart.priceScale("left", pane.paneIndex()).width() : 0)
        && event.clientX < b.right - (plotOnly ? chart.priceScale("right", pane.paneIndex()).width() : 0);
    });
  }

  private readonly pointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) { this.cancelGesture(); return; }
    if (event.button !== 0 || this.drag || this.isControl(event.target)) return;
    if (!this.tool && event.target instanceof Element && event.target.closest(".drawing-active, [data-drawing-id], [data-drawing-handle-index]")) return;
    const pane = this.paneAt(event, false);
    if (!pane) {
      if (event.target instanceof Node && this.element.contains(event.target)) {
        this.clearMeasurement();
        this.options.onFocus?.(this.activePane);
        this.element.focus({ preventScroll: true });
        // Time-axis and pane-separator drags are native too; keep their DOM
        // attached until the same pointer ends, just like a plot drag.
        this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scale: null, moved: false };
        beginTradingChartInteraction(this);
      }
      return;
    }
    this.activePane = pane.paneIndex();
    this.options.onFocus?.(this.activePane);
    if (event.altKey) { this.toggleChartExpansion(); this.consume(event); return; }
    this.closeMenu();
    this.element.focus({ preventScroll: true });
    this.clearMeasurement();
    const plot = this.paneAt(event);
    const kind = this.tool ?? (event.shiftKey && event.pointerType !== "touch" ? "measure" : null);
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      scale: plot ? this.getChart()!.priceScale("right", plot.paneIndex()) : null, moved: false };
    beginTradingChartInteraction(this);
    const axisScale = this.getChart()!.priceScale("right", pane.paneIndex());
    if (!plot && axisScale.options().mode >= 2) {
      const range = axisScale.getVisibleRange();
      if (range) {
        this.drag.axis = { scale: axisScale, range, height: pane.getHeight(), y: event.clientY - pane.getHTMLElement()!.getBoundingClientRect().top };
        this.consume(event); return;
      }
    }
    if (this.selection?.awaitingClick) {
      this.paintSelection(event); this.selection.awaitingClick = false;
      this.consume(event); return;
    }
    if (kind && plot) {
      const chart = this.getChart()!;
      const bounds = plot.getHTMLElement()!.getBoundingClientRect();
      const scale = chart.priceScale("right", plot.paneIndex());
      const overlay = document.createElement("div");
      const label = document.createElement("div");
      overlay.className = kind === "zoom" ? "trading-chart-zoom-selection" : "trading-chart-measurement";
      label.className = "trading-chart-measurement-label";
      overlay.append(label);
      this.selection = { pane: plot, element: overlay, label, kind, autoScale: scale.options().autoScale,
        awaitingClick: false, start: { x: event.clientX, y: event.clientY }, end: { x: event.clientX, y: event.clientY },
        bounds: { left: bounds.left + chart.priceScale("left", plot.paneIndex()).width(),
          right: bounds.right - scale.width(), top: bounds.top, bottom: bounds.bottom } };
      scale.setAutoScale(false);
      this.element.append(overlay);
      this.paintSelection(event);
      this.consume(event);
    } else if (!(event.target instanceof Node) || !this.element.contains(event.target)) {
      // A drawing overlay owns its own drag. Do not disable its pane's auto-fit.
      this.drag = null;
      endTradingChartInteraction(this);
    } else if (plot && this.verticalLocked) {
      const ts = this.getChart()!.timeScale();
      this.drag.lockedScroll = { position: ts.scrollPosition(), barSpacing: ts.options().barSpacing, pending: null };
      this.consume(event);
    }
  };

  private readonly pointerMove = (event: PointerEvent) => {
    if (this.selection?.awaitingClick) { this.paintSelection(event); return; }
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.selection) { this.paintSelection(event); this.consume(event); return; }
    if (this.drag.lockedScroll) {
      const scroll = this.drag.lockedScroll;
      scroll.pending = scroll.position + (this.drag.x - event.clientX) / scroll.barSpacing;
      this.consume(event); this.schedule(); return;
    }
    if (this.drag.axis) {
      const a = this.drag.axis;
      const factor = Math.max(0.1, (a.height - a.y + (a.height - 1) * 0.2) / (Math.max(0, a.height - a.y - event.clientY + this.drag.y) + (a.height - 1) * 0.2));
      const mid = (a.range.from + a.range.to) / 2, half = (a.range.to - a.range.from) * factor / 2;
      a.scale.setVisibleRange({ from: mid - half, to: mid + half });
      if (this.activePane === 0) this.options.onAutoScaleChange?.(false);
      this.consume(event); this.schedule(); return;
    }
    // Horizontal scrolling keeps Auto; a deliberate vertical drag releases it.
    if (!this.drag.moved && Math.abs(event.clientY - this.drag.y) >= 4) {
      this.drag.moved = true;
      if (this.drag.scale) this.setAutoScale(false, this.activePane);
    }
    this.schedule();
  };

  private readonly pointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.drag?.pointerId) return;
    if (event.type === "pointercancel") { this.cancelGesture(); return; }
    this.flushLockedScroll();
    if (!this.selection && !this.drag.lockedScroll && this.activePane === 0 && !this.getChart()?.priceScale("right", 0).options().autoScale) this.options.onAutoScaleChange?.(false);
    if (this.selection) {
      this.paintSelection(event);
      const { start, end } = this.selection;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 4) {
        this.selection.awaitingClick = true; this.drag = null; endTradingChartInteraction(this); return;
      }
      if (this.selection.kind === "zoom") {
        this.applySelection();
        if (this.activePane === 0) this.options.onAutoScaleChange?.(false);
      }
      else {
        this.measurement = this.selection.element;
        this.measurementPane = this.selection.pane;
        this.measurementSeries = this.priceSeries(this.selection.pane) ?? null;
        this.measurementSeries?.subscribeDataChanged(this.clearMeasurement);
      }
      this.finishSelection();
      if (this.measurementPane) this.measurementGeometry = this.measurementViewport();
      this.tool = null;
      this.root.dataset.chartNavigationTool = "";
      this.element.dispatchEvent(new CustomEvent("trading-navigation-tool-change"));
      this.consume(event);
    }
    this.drag = null;
    endTradingChartInteraction(this);
    this.schedule();
  };

  private paintSelection(event: { clientX: number; clientY: number }) {
    const s = this.selection!; const b = s.bounds;
    s.end = { x: Math.max(b.left, Math.min(b.right, event.clientX)), y: Math.max(b.top, Math.min(b.bottom, event.clientY)) };
    const rect = this.selectionRect(); const host = this.element.getBoundingClientRect();
    Object.assign(s.element.style, { left: `${rect.left - host.left}px`, top: `${rect.top - host.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    if (s.kind !== "measure") return;
    const series = this.priceSeries(s.pane);
    const start = series?.coordinateToPrice(s.start.y - b.top);
    const end = series?.coordinateToPrice(s.end.y - b.top);
    const ts = this.getChart()!.timeScale();
    const from = ts.coordinateToLogical(s.start.x - b.left);
    const to = ts.coordinateToLogical(s.end.x - b.left);
    if (start == null || end == null || from == null || to == null) return;
    const delta = end - start, percent = start ? delta / Math.abs(start) * 100 : 0;
    const count = Math.round(to) - Math.round(from);
    const candles = this.options.getCandles?.() ?? [];
    const secondsPerBar = candles.length > 1 ? candles[1].time - candles[0].time : 0;
    const timeAt = (index: number) => {
      const rounded = Math.round(index), bounded = Math.max(0, Math.min(candles.length - 1, rounded));
      return (candles[bounded]?.time ?? 0) + (rounded - bounded) * secondsPerBar;
    };
    const seconds = timeAt(to) - timeAt(from);
    const duration = Math.abs(seconds) >= 86400 ? `${(seconds / 86400).toFixed(1)}d`
      : Math.abs(seconds) >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
    const volume = candles.slice(Math.max(0, Math.min(Math.round(from), Math.round(to))), Math.max(0, Math.max(Math.round(from), Math.round(to)) + 1))
      .reduce((sum, candle) => sum + (candle.volume ?? 0), 0);
    s.label.textContent = `${delta >= 0 ? "+" : ""}${Number(delta.toPrecision(7))} (${percent.toFixed(2)}%)\n${count} ${translateAppText("根 K 线")} · ${duration}${volume ? `\nVol ${volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}`;
    s.element.classList.toggle("negative", delta < 0);
    // Keep the measurement card inside the chart, including reversed drags.
    s.label.style.transform = rect.left + 200 > b.right ? "translateX(calc(-100% + 16px))" : "none";
    s.label.style.top = rect.top - b.top > 80 ? "-72px" : "4px";
  }

  private selectionRect() {
    const { start, end } = this.selection!;
    return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }

  private priceSeries(pane: IPaneApi<Time>) {
    return pane.getSeries().find((item) => (item.options().priceScaleId ?? "right") === "right" && item.coordinateToPrice(0) !== null);
  }

  private applySelection() {
    const chart = this.getChart(); const s = this.selection!;
    if (!chart?.panes().includes(s.pane)) return;
    const rect = this.selectionRect(); if (rect.width < 8 || rect.height < 8) return;
    const ts = chart.timeScale();
    const from = ts.coordinateToLogical(rect.left - s.bounds.left);
    const to = ts.coordinateToLogical(rect.left + rect.width - s.bounds.left);
    const series = this.priceSeries(s.pane);
    if (from === null || to === null || to - from < 2 || !series) return;
    const scale = chart.priceScale("right", s.pane.paneIndex());
    const mode = scale.options().mode;
    // Percent scales rebase to the first visible bar after changing time range.
    const first = mode >= 2 ? series.dataByIndex(Math.floor(from), 1) : null;
    const base = first ? Number("close" in first ? first.close : "value" in first ? first.value : NaN) : 0;
    if (mode >= 2 && (!base || !Number.isFinite(base))) return;
    const value = (y: number) => {
      const price = series.coordinateToPrice(y - s.bounds.top);
      if (price === null) return NaN;
      if (mode >= 2) return 100 * (price - base) / Math.abs(base) + (mode === 3 ? 100 : 0);
      return price;
    };
    const a = value(rect.top), b = value(rect.top + rect.height);
    if (![a, b].every(Number.isFinite) || a === b) return;
    if (mode === 1 && !setTradingLogPriceRange(s.pane, scale, Math.min(a, b), Math.max(a, b))) return;
    ts.setVisibleLogicalRange({ from, to });
    if (mode !== 1) scale.setVisibleRange({ from: Math.min(a, b), to: Math.max(a, b) });
    s.autoScale = false;
  }

  private finishSelection() {
    const s = this.selection;
    if (s) {
      const chart = this.getChart();
      if (chart?.panes().includes(s.pane) && s.autoScale) chart.priceScale("right", s.pane.paneIndex()).setAutoScale(true);
      if (s.element !== this.measurement) s.element.remove();
    }
    this.selection = null;
  }

  private readonly clearMeasurement = () => {
    this.measurementSeries?.unsubscribeDataChanged(this.clearMeasurement);
    this.measurement?.remove(); this.measurement = null;
    this.measurementSeries = null; this.measurementPane = null; this.measurementGeometry = null;
  };

  private measurementViewport() {
    const pane = this.measurementPane, chart = this.getChart();
    if (!pane || !chart?.panes().includes(pane)) return null;
    const b = pane.getHTMLElement()?.getBoundingClientRect(), series = this.measurementSeries;
    if (!b || !series) return null;
    const scale = chart.priceScale("right", pane.paneIndex()).options();
    const top = series.coordinateToPrice(0), bottom = series.coordinateToPrice(pane.getHeight() - 1);
    if (top === null || bottom === null) return null;
    return [b.left, b.top, b.right, b.bottom, scale.mode, Number(scale.invertScale), top, bottom];
  }

  private readonly viewportChanged = () => {
    this.clearMeasurement();
    this.schedule();
  };

  readonly cancelGesture = () => {
    this.finishSelection(); this.drag = null; this.clearMeasurement(); this.closeMenu(); this.schedule();
    if (this.interactionTimer !== null) clearTimeout(this.interactionTimer);
    this.interactionTimer = null;
    endTradingChartInteraction(this);
  };

  private consume(event: Event) { event.preventDefault(); event.stopPropagation(); }
  private isControl(target: EventTarget | null) {
    return target instanceof Element && !!target.closest("button, input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]");
  }

  private readonly wheel = (event: WheelEvent) => {
    this.cancelGesture();
    const chart = this.getChart(); if (!chart) return;
    beginTradingChartInteraction(this);
    this.interactionTimer = setTimeout(() => {
      this.interactionTimer = null;
      if (!this.drag) endTradingChartInteraction(this);
    }, 120);
    const pane = this.paneAt(event, false);
    const plot = this.paneAt(event);
    const factor = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? this.element.clientHeight : 1;
    if (pane && !plot && event.deltaY) {
      const scale = chart.priceScale("right", pane.paneIndex());
      const zoom = Math.exp(Math.max(-1, Math.min(1, event.deltaY * factor / 500)));
      if (scale.options().mode === 1) {
        const series = this.priceSeries(pane), h = pane.getHeight(), margins = scale.options().scaleMargins;
        const top = h * margins.top, bottom = h * (1 - margins.bottom) - 1;
        const mid = (top + bottom) / 2, half = (bottom - top) * zoom / 2;
        const a = series?.coordinateToPrice(mid - half), b = series?.coordinateToPrice(mid + half);
        if (a != null && b != null) setTradingLogPriceRange(pane, scale, Math.min(a, b), Math.max(a, b));
      } else {
        const range = scale.getVisibleRange();
        if (range) {
          const mid = (range.from + range.to) / 2;
          const span = (range.to - range.from) * zoom / 2;
          scale.setVisibleRange({ from: mid - span, to: mid + span });
        }
      }
      if (pane.paneIndex() === 0) this.options.onAutoScaleChange?.(false);
      this.consume(event);
    } else if (event.shiftKey && !(event.ctrlKey || event.metaKey)) {
      // Some browsers convert Shift+wheel into deltaX already. Consume once.
      this.pan((event.deltaY || event.deltaX) * factor / Math.max(chart.timeScale().options().barSpacing, 0.5));
      this.consume(event);
    } else {
      const rightBarStaysOnScroll = !(event.ctrlKey || event.metaKey) && this.options.getScaleAnchor?.() !== "cursor";
      if (chart.timeScale().options().rightBarStaysOnScroll !== rightBarStaysOnScroll) {
        chart.timeScale().applyOptions({ rightBarStaysOnScroll });
      }
    }
    this.schedule();
  };

  private pan(bars: number) {
    this.clearMeasurement();
    const ts = this.getChart()?.timeScale(); const range = ts?.getVisibleLogicalRange();
    if (range && Number.isFinite(bars)) ts!.setVisibleLogicalRange({ from: range.from + bars, to: range.to + bars });
    this.schedule();
  }

  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    this.setTool(null);
    this.freezeAutoNextFrame = false;
    zoomTradingChart(this.getChart(), factor);
    this.schedule();
  }

  reset() {
    this.setTool(null); this.restorePanes();
    this.freezeAutoNextFrame = false;
    const chart = this.getChart(); if (!chart) return;
    this.restoreCollapsedPanes();
    chart.panes().forEach((pane) => chart.priceScale("right", pane.paneIndex()).setAutoScale(true));
    chart.timeScale().resetTimeScale();
    chart.timeScale().scrollToPosition(chart.timeScale().options().rightOffset, false);
    this.schedule();
  }

  private setMode(mode: 0 | 1 | 2) {
    this.clearMeasurement();
    const chart = this.getChart(); if (!chart) return;
    if (this.options.onPriceModeChange) {
      this.options.onPriceModeChange(mode === 1 ? "logarithmic" : mode === 2 ? "percentage" : "linear");
    } else chart.priceScale("right", 0).applyOptions({ mode, autoScale: true });
    this.schedule();
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || this.isControl(event.target) || event.isComposing) return;
    const chart = this.getChart(); if (!chart) return;
    const key = event.key.toLowerCase(); const ctrl = event.ctrlKey || event.metaKey;
    if (key === "escape" && (this.tool || this.selection || this.measurement || this.menu)) this.setTool(null);
    else if (event.altKey && !ctrl && key === "r") this.reset();
    else if (event.altKey && !ctrl && key === "enter") this.toggleChartExpansion();
    else if (event.altKey && !ctrl && key === "l") this.setMode(chart.priceScale("right", 0).options().mode === 1 ? 0 : 1);
    else if (event.altKey && !ctrl && key === "p") this.setMode(chart.priceScale("right", 0).options().mode === 2 ? 0 : 2);
    else if (event.altKey && !ctrl && key === "i") {
      this.clearMeasurement();
      const s = chart.priceScale("right", this.activePane); s.applyOptions({ invertScale: !s.options().invertScale });
    } else if (!event.altKey && !event.shiftKey && (key === "arrowleft" || key === "arrowright")) this.pan((key === "arrowleft" ? -1 : 1) * (ctrl ? 10 : 1));
    else if (ctrl && !event.altKey && !event.shiftKey && (key === "arrowup" || key === "arrowdown")) this.zoom(key === "arrowup" ? 0.8 : 1.25);
    else return;
    this.consume(event); this.schedule();
  };

  private readonly doubleClick = (event: MouseEvent) => {
    const pane = this.paneAt(event);
    if (pane && !this.isControl(event.target) && !this.tool && !(event.target instanceof Element && event.target.closest("[data-drawing-id]"))) {
      const chart = this.getChart()!;
      if (chart.panes().length > 1) {
        if (event.ctrlKey || event.metaKey) {
          if (this.maximized) this.restorePanes();
          const previous = this.collapsed.get(pane);
          const totalHeight = chart.panes().reduce((total, p) => total + p.getHeight(), 0);
          if (previous !== undefined) { pane.setHeight(Math.round(previous * totalHeight)); this.collapsed.delete(pane); }
          else { this.collapsed.set(pane, pane.getHeight() / Math.max(1, totalHeight)); pane.setHeight(30); }
        } else if (this.maximized) this.restorePanes();
        else {
          this.maximized = { pane, factors: new Map(chart.panes().map((p) => [p, p.getStretchFactor()])) };
          chart.panes().forEach((p) => p.setStretchFactor(p === pane ? 1 : 0));
        }
        this.consume(event);
      }
    }
    this.schedule();
  };

  private restorePanes() {
    for (const [pane, factor] of this.maximized?.factors ?? []) {
      if (this.getChart()?.panes().includes(pane)) pane.setStretchFactor(factor);
    }
    this.maximized = null;
  }

  private restoreCollapsedPanes() {
    const panes = this.getChart()?.panes() ?? [];
    const height = panes.reduce((sum, p) => sum + p.getHeight(), 0);
    for (const [pane, ratio] of this.collapsed) if (panes.includes(pane)) pane.setHeight(Math.round(height * ratio));
    this.collapsed.clear();
  }

  restoreLayout() {
    this.restorePanes(); this.restoreCollapsedPanes();
    if (this.expandedChart) this.toggleChartExpansion();
  }

  private toggleChartExpansion() {
    if (this.expandedChart) {
      this.expandedChart.classList.remove("trading-chart-expanded");
      this.expandedChart.parentElement?.classList.remove("trading-chart-has-expanded");
      this.expandedChart = null;
    } else {
      const panel = this.element.closest<HTMLElement>(".trading-market-primary-pane, .trading-market-split-pane");
      if (!panel?.parentElement?.classList.contains("trading-market-chart-grid")) return;
      panel.parentElement.querySelectorAll(".trading-chart-expanded").forEach(p => p.classList.remove("trading-chart-expanded"));
      panel.parentElement.classList.add("trading-chart-has-expanded");
      panel.classList.add("trading-chart-expanded");
      this.expandedChart = panel;
    }
    this.schedule();
  }

  private readonly controlClick = (event: Event) => {
    const action = (event.target as Element).closest<HTMLElement>("[data-navigation-action]")?.dataset.navigationAction;
    const paneIndex = this.activePane;
    this.options.onFocus?.(paneIndex);
    this.runAction(action, paneIndex); this.element.focus({ preventScroll: true });
  };

  private runAction(action?: string, paneIndex = this.activePane) {
    this.clearMeasurement();
    const chart = this.getChart(); if (!chart) return;
    this.activePane = Math.min(this.activePane, chart.panes().length - 1);
    const scale = chart.priceScale("right", Math.min(paneIndex, chart.panes().length - 1));
    if (action === "reset") this.reset();
    else if (action === "auto") this.setAutoScale(!scale.options().autoScale, paneIndex);
    else if (action === "lock-vertical") this.toggleVerticalLock();
    else if (action === "log") this.setMode(chart.priceScale("right", 0).options().mode === 1 ? 0 : 1);
    else if (action === "percent") this.setMode(chart.priceScale("right", 0).options().mode === 2 ? 0 : 2);
    else if (action === "invert") scale.applyOptions({ invertScale: !scale.options().invertScale });
    else if (action === "zoom-in") this.zoom(0.8);
    else if (action === "zoom-out") this.zoom(1.25);
    else if (action === "left" || action === "right") this.pan(action === "left" ? -10 : 10);
    this.closeMenu(); this.schedule();
  }

  private readonly contextMenu = (event: MouseEvent) => {
    const pane = this.paneAt(event, false);
    if (!pane || this.isControl(event.target) || event.defaultPrevented) return;
    this.consume(event); this.setTool(null); this.activePane = pane.paneIndex();
    this.options.onFocus?.(this.activePane);
    const menu = document.createElement("div"); menu.className = "trading-chart-navigation-menu"; menu.setAttribute("role", "menu");
    const actions = [["reset", "重置图表（Alt + R）"], ["auto", this.activePane === 0 ? "自动适配主图价格" : "自动适配副图"]];
    if (this.activePane === 0) actions.push(["log", "对数坐标（Alt + L）"], ["percent", "百分比坐标（Alt + P）"]);
    actions.push(["invert", "反转坐标（Alt + I）"]);
    for (const [action, label] of actions) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = translateAppText(label);
      button.setAttribute("role", action === "reset" ? "menuitem" : "menuitemcheckbox");
      const scaleOptions = this.getChart()!.priceScale("right", this.activePane).options();
      if (action !== "reset") button.setAttribute("aria-checked", String(action === "auto" ? scaleOptions.autoScale : action === "log" ? scaleOptions.mode === 1 : action === "percent" ? scaleOptions.mode === 2 : scaleOptions.invertScale));
      button.addEventListener("click", () => { this.runAction(action); this.element.focus(); }); menu.append(button);
    }
    menu.addEventListener("keydown", (e) => {
      const buttons = Array.from(menu.querySelectorAll("button")); const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") { this.closeMenu(); this.element.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
      else return;
      this.consume(e);
    });
    this.element.append(menu); this.menu = menu;
    const host = this.element.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(event.clientX - host.left, host.width - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY - host.top, host.height - menu.offsetHeight))}px`;
    menu.querySelector("button")?.focus();
  };

  private closeMenu() { this.menu?.remove(); this.menu = null; }
  private readonly outsidePointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && !this.root.contains(event.target)) { this.cancelGesture(); if (this.tool) this.setTool(null); }
  };

  readonly schedule = (frames = 2) => {
    if (this.destroyed) return;
    this.framesRemaining = Math.max(this.framesRemaining, frames);
    if (this.frame !== null) return;
    const paint = () => {
      if (this.destroyed) return;
      // Keep the frame reserved during painting: native lazy layout may emit
      // another viewport change while an overlay reads its coordinates.
      this.flushLockedScroll();
      this.syncAutoScale();
      this.redraw();
      if (this.measurement) {
        const current = this.measurementViewport(), previous = this.measurementGeometry;
        if (!current || !previous || current.some((value, i) => !Number.isFinite(value)
          || Math.abs(value - previous[i]) > Math.max(Math.abs(value), Math.abs(previous[i]), Number.MIN_VALUE) * 1e-10)) this.clearMeasurement();
      }
      const chart = this.getChart();
      if (chart?.panes().length) {
        this.activePane = Math.min(this.activePane, chart.panes().length - 1);
        this.controls.style.bottom = `${chart.timeScale().height() + 8}px`;
        const empty = !this.priceSeries(chart.panes()[0]);
        this.controls.querySelectorAll("button").forEach(button => { button.disabled = empty; });
        const button = this.controls.querySelector('[data-navigation-action="lock-vertical"]');
        if (button) {
          const state = String(this.verticalLocked);
          if (button.getAttribute("aria-pressed") !== state) button.setAttribute("aria-pressed", state);
          const label = translateAppText(this.verticalLocked ? "已锁定：随可见 K 线自动适配价格（点击恢复自由拖动）" : "自由拖动（点击锁定并自动适配价格）");
          if (button.getAttribute("title") !== label) button.setAttribute("title", label);
          if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
          const shackle = button.querySelector('[data-lock-shackle]');
          const path = this.verticalLocked ? "M7 9V6a3 3 0 0 1 6 0v3" : "M7 9V6a3 3 0 0 1 6 0";
          if (shackle?.getAttribute("d") !== path) shackle?.setAttribute("d", path);
        }
      }
      this.frame = null;
      if (--this.framesRemaining > 0) this.frame = window.requestAnimationFrame(paint);
    };
    this.frame = window.requestAnimationFrame(paint);
  };

  destroy() {
    this.destroyed = true; this.cancelGesture(); this.restoreLayout();
    this.timeScale?.unsubscribeVisibleLogicalRangeChange(this.viewportChanged);
    this.timeScale?.unsubscribeSizeChange(this.viewportChanged);
    this.resizeObserver?.disconnect();
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null; this.controls.remove();
    this.root.removeEventListener("pointerdown", this.pointerDown, true);
    this.element.removeEventListener("wheel", this.wheel, true);
    this.root.removeEventListener("dblclick", this.doubleClick, true);
    this.element.removeEventListener("keydown", this.keyDown);
    this.root.removeEventListener("contextmenu", this.contextMenu);
    window.removeEventListener("pointermove", this.pointerMove, true);
    window.removeEventListener("pointerup", this.pointerEnd, true);
    window.removeEventListener("pointercancel", this.pointerEnd, true);
    window.removeEventListener("pointerdown", this.outsidePointerDown, true);
    window.removeEventListener("blur", this.cancelGesture);
    delete this.root.dataset.chartNavigationTool;
    this.element.classList.remove("trading-chart-navigable");
  }
}
