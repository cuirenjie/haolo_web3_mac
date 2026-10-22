import type { IChartApi } from "lightweight-charts";

const UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const CLOCK_FONT_SIZE = 13;

/** A small independent canvas keeps the clock ticking without repainting candles. */
export class TradingChartClock {
  private readonly canvas = document.createElement("canvas");
  private readonly resizeObserver: ResizeObserver;
  private readonly timeAxisRow: HTMLTableRowElement | undefined;
  private timer: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly chart: IChartApi) {
    this.canvas.className = "trading-chart-clock";
    this.canvas.setAttribute("role", "timer");
    this.canvas.setAttribute("aria-live", "off");
    Object.assign(this.canvas.style, {
      position: "absolute", right: "0", zIndex: "4",
      pointerEvents: "none",
    });
    root.append(this.canvas);
    const rows = chart.chartElement().querySelector("table")?.rows;
    this.timeAxisRow = rows?.[rows.length - 1];
    chart.timeScale().subscribeSizeChange(this.update);
    this.resizeObserver = new ResizeObserver(this.update);
    this.resizeObserver.observe(root);
    if (this.timeAxisRow) this.resizeObserver.observe(this.timeAxisRow);
    document.addEventListener("visibilitychange", this.tick);
    this.tick();
  }

  readonly update = () => {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { layout, timeScale } = this.chart.options();
    const height = this.chart.timeScale().height();
    this.canvas.hidden = !timeScale.visible || height <= 0;
    if (this.canvas.hidden) return;
    // The native table rounds pane sizes at Windows display scaling factors.
    // Anchor to its actual axis row so the clock shares the exact text baseline.
    const rootBounds = this.root.getBoundingClientRect();
    const axisBounds = this.timeAxisRow?.getBoundingClientRect();
    this.canvas.style.top = `${axisBounds ? axisBounds.top - rootBounds.top : rootBounds.height - height}px`;
    this.canvas.style.right = `${axisBounds ? rootBounds.right - axisBounds.right : 0}px`;
    const now = new Date(Date.now() + UTC_OFFSET_MS);
    const pad = (value: number) => String(value).padStart(2, "0");
    const text = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC+8`;
    const font = `${CLOCK_FONT_SIZE}px ${layout.fontFamily}`;
    ctx.font = font;
    // Match Lightweight Charts 5.1's outer price-label padding and time-label row.
    const rightPadding = Math.ceil(5 * layout.fontSize / 12 + 6);
    const width = Math.ceil(ctx.measureText(text).width) + rightPadding + 8;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.font = font;
    this.canvas.width = Math.ceil(width * ratio);
    this.canvas.height = Math.ceil(height * ratio);
    ctx.scale(ratio, ratio);
    const background = layout.background;
    ctx.fillStyle = background.type === "solid" ? background.color : background.bottomColor;
    // Leave the native time-axis border intact.
    ctx.fillRect(0, 1, width, height - 1);
    ctx.font = font;
    ctx.fillStyle = layout.textColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const y = 1 + 5 + 3 * layout.fontSize / 12 + layout.fontSize / 2;
    ctx.fillText(text, width - rightPadding, y);
    this.canvas.textContent = text;
    this.canvas.setAttribute("aria-label", text);
  };

  private readonly tick = () => {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.update();
    // Re-read wall time on every tick, including after sleep or a hidden tab.
    this.timer = window.setTimeout(this.tick, 1000 - Date.now() % 1000);
  };

  destroy() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.resizeObserver.disconnect();
    this.chart.timeScale().unsubscribeSizeChange(this.update);
    document.removeEventListener("visibilitychange", this.tick);
    this.canvas.remove();
  }
}
