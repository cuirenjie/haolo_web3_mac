const viewportUsers = new WeakMap<HTMLElement, number>();

export function clampTradingChartToolbarPosition(
  position: { x: number; y: number },
  bounds: { width: number; height: number; left?: number },
  size: { width: number; height: number },
) {
  const left = bounds.left ?? 0;
  return {
    x: Math.max(left + 8, Math.min(left + bounds.width - size.width - 12, position.x)),
    y: Math.max(12, Math.min(bounds.height - size.height - 8, position.y)),
  };
}

/** Shared by chart navigation and AI text sizing. Only leaving the complete
 * chart viewport can undo a dismissal; annotation/canvas transitions cannot. */
export class TradingChartToolbarVisibility {
  private dismissed = false;
  private reentryPending = false;
  private destroyed = false;
  private readonly toolbar: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly chartElement: HTMLElement;
  private readonly onRestore: () => void;

  constructor(
    toolbar: HTMLElement,
    viewport: HTMLElement,
    chartElement: HTMLElement,
    onRestore: () => void,
  ) {
    this.toolbar = toolbar; this.viewport = viewport;
    this.chartElement = chartElement; this.onRestore = onRestore;
    toolbar.classList.add("trading-chart-floating-toolbar");
    viewport.classList.add("trading-chart-toolbar-viewport");
    viewportUsers.set(viewport, (viewportUsers.get(viewport) ?? 0) + 1);
    viewport.addEventListener("pointerenter", this.pointerEnter);
    viewport.addEventListener("pointerleave", this.pointerLeave, true);
    window.addEventListener("pointermove", this.pointerMove, true);
  }

  setAvailable(available: boolean) {
    this.toolbar.hidden = !available || this.dismissed;
    return !this.toolbar.hidden;
  }

  dismiss() {
    this.dismissed = true;
    this.reentryPending = false;
    this.toolbar.hidden = true;
  }

  private readonly pointerEnter = () => {
    if (!this.reentryPending) return;
    this.reentryPending = false;
    this.dismissed = false;
    this.onRestore();
  };

  private readonly pointerLeave = (event: PointerEvent) => {
    if (event.target === this.viewport && this.dismissed) this.reentryPending = true;
  };

  private readonly pointerMove = (event: PointerEvent) => {
    if (!this.dismissed || !(event.target instanceof Node)) return;
    if (this.viewport.contains(event.target)) {
      this.pointerEnter();
    } else if (!this.reentryPending) {
      // Native boundary targets can be retired during chart overlay updates.
      // Observe actual out-of-bounds movement too, excluding sibling overlays
      // that still occupy a point inside the chart.
      const bounds = this.chartElement.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom) {
        this.reentryPending = true;
      }
    }
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.viewport.removeEventListener("pointerenter", this.pointerEnter);
    this.viewport.removeEventListener("pointerleave", this.pointerLeave, true);
    window.removeEventListener("pointermove", this.pointerMove, true);
    const users = (viewportUsers.get(this.viewport) ?? 1) - 1;
    if (users > 0) viewportUsers.set(this.viewport, users);
    else {
      viewportUsers.delete(this.viewport);
      this.viewport.classList.remove("trading-chart-toolbar-viewport");
    }
  }
}
