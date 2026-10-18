// Drawing SVGs intercept the canvas's native hover events. Bridge hover only:
// forwarding down/up would also pan the chart while placing or editing a line.
// Use canvas coordinates instead of setCrosshairPosition(time, price), which
// snaps to existing data and does not notify crosshair/legend subscribers.
export class TradingDrawingCrosshair {
  private frame: number | null = null;
  private pending: PointerEvent | null = null;
  private surface: HTMLCanvasElement | null = null;
  private destroyed = false;
  private readonly overlay: SVGSVGElement;
  private readonly getSurface: () => HTMLCanvasElement | null;

  constructor(overlay: SVGSVGElement, getSurface: () => HTMLCanvasElement | null) {
    this.overlay = overlay;
    this.getSurface = getSurface;
    overlay.addEventListener('pointerenter', this.queue);
    overlay.addEventListener('pointermove', this.queue);
    overlay.addEventListener('pointerdown', this.queue);
    overlay.addEventListener('pointerup', this.queue);
    overlay.addEventListener('pointerleave', this.clear);
    overlay.addEventListener('pointercancel', this.clear);
    window.addEventListener('blur', this.clear);
  }

  private readonly queue = (event: PointerEvent) => {
    if (this.destroyed || event.pointerType === 'touch' || event.isPrimary === false) return;
    this.pending = event;
    if (this.frame !== null) return;
    // Run after native mouseleave (generated when the SVG gains hit testing),
    // and limit chart/legend work to once per display frame while drawing.
    this.frame = window.requestAnimationFrame(this.flush);
  };

  private readonly flush = () => {
    this.frame = null;
    const event = this.pending;
    this.pending = null;
    if (!event || this.destroyed) return;
    const surface = this.getSurface();
    if (!surface?.isConnected || !this.overlay.isConnected) {
      this.clear();
      return;
    }
    const rect = surface.getBoundingClientRect();
    // Pointer capture can keep delivering events after leaving the plot.
    if (rect.width <= 0 || rect.height <= 0 || event.clientX < rect.left
      || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) {
      this.clear();
      return;
    }
    const init: MouseEventInit = {
      clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey,
      view: window, bubbles: false, buttons: 0,
    };
    if (surface !== this.surface) {
      this.clear();
      this.surface = surface;
      surface.dispatchEvent(new MouseEvent('mouseenter', init));
    } else {
      surface.dispatchEvent(new MouseEvent('mousemove', init));
    }
  };

  private readonly clear = () => {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
    const surface = this.surface;
    this.surface = null;
    if (surface?.isConnected) surface.dispatchEvent(new MouseEvent('mouseleave', { view: window }));
  };

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
    this.overlay.removeEventListener('pointerenter', this.queue);
    this.overlay.removeEventListener('pointermove', this.queue);
    this.overlay.removeEventListener('pointerdown', this.queue);
    this.overlay.removeEventListener('pointerup', this.queue);
    this.overlay.removeEventListener('pointerleave', this.clear);
    this.overlay.removeEventListener('pointercancel', this.clear);
    window.removeEventListener('blur', this.clear);
  }
}
