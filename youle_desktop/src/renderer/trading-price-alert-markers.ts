import { subscribeChartPriceAlerts, type ChartPriceAlert } from './trading-price-alert-store.ts';

export type PriceAlertChart = {
  root: HTMLElement;
  chartElement: HTMLElement;
  getChart: () => any;
  getSeries: () => any;
};
type Marker = { row: HTMLDivElement; label: HTMLButtonElement; remove: HTMLButtonElement; alert: ChartPriceAlert };
type Drag = { marker: Marker; pointerId: number; startY: number; price: number; moved: boolean; marketId: string };

export class TradingPriceAlertMarkers {
  private layer = document.createElement('div');
  private markers = new Map<string, Marker>();
  private alerts: ChartPriceAlert[] = [];
  private drag: Drag | null = null;
  private pendingMove: { alertId: string; price: number } | null = null;
  private unsubscribe: () => void;
  private destroyed = false;
  private frame: number | null = null;
  constructor(private options: PriceAlertChart & {
    marketId: () => string | undefined;
    precision: (price: number) => number;
    label: (alert: ChartPriceAlert) => string;
    editLabel: () => string;
    deleteLabel: () => string;
    blocked: () => boolean;
    edit: (alert: ChartPriceAlert) => void;
    remove: (alert: ChartPriceAlert) => void;
    move: (alert: ChartPriceAlert, price: number) => void;
  }) {
    this.layer.className = 'trading-price-alert-layer';
    options.root.append(this.layer);
    this.unsubscribe = subscribeChartPriceAlerts(alerts => { this.alerts = alerts; this.update(); });
    window.addEventListener('blur', this.cancelDrag);
    window.addEventListener('keydown', this.onKeyDown, true);
  }
  get interacting() { return !!this.drag; }
  schedule() {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  }
  finishMove() { this.pendingMove = null; this.update(); }
  update() {
    if (this.destroyed) return;
    const { getChart, getSeries, marketId } = this.options;
    const chart = getChart(), series = getSeries(), market = marketId();
    const visible = this.alerts.filter(alert => alert.marketId === market);
    const width = chart?.timeScale().width() ?? 0;
    const height = chart?.panes()[0]?.getHeight() ?? 0;
    this.layer.style.width = `${width}px`;
    this.layer.style.height = `${height}px`;
    if (this.drag && (this.drag.marketId !== market || !visible.some(a => a.alertId === this.drag!.marker.alert.alertId))) this.cancelDrag();
    for (const [id, marker] of this.markers) {
      if (!visible.some(alert => alert.alertId === id)) { marker.row.remove(); this.markers.delete(id); }
    }
    for (const alert of visible) {
      const marker = this.markers.get(alert.alertId) ?? this.createMarker(alert);
      marker.alert = alert;
      const label = this.options.label(alert);
      if (marker.label.textContent !== label) marker.label.textContent = label;
      marker.label.title = this.options.editLabel();
      marker.label.ariaLabel = `${this.options.editLabel()}: ${label}`;
      marker.row.setAttribute('aria-label', marker.label.textContent);
      marker.remove.title = marker.remove.ariaLabel = this.options.deleteLabel();
      const price = this.drag?.marker === marker ? this.drag.price
        : this.pendingMove?.alertId === alert.alertId ? this.pendingMove.price : alert.price;
      const y = series?.priceToCoordinate(price);
      marker.row.hidden = typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > height || width < 20;
      if (!marker.row.hidden) marker.row.style.top = `${y}px`;
      marker.row.classList.toggle('is-pending', this.pendingMove?.alertId === alert.alertId);
    }
  }
  private createMarker(alert: ChartPriceAlert) {
    const row = document.createElement('div');
    row.className = 'trading-price-alert-line';
    row.dataset.priceAlertId = alert.alertId;
    row.tabIndex = 0;
    row.innerHTML = '<span class="trading-price-alert-dash"></span><span class="trading-price-alert-tip"></span><span class="trading-price-alert-caption"><button type="button" data-price-alert-label></button><button type="button" data-price-alert-delete><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg></button></span>';
    const marker = { row, label: row.querySelector<HTMLButtonElement>('[data-price-alert-label]')!,
      remove: row.querySelector<HTMLButtonElement>('[data-price-alert-delete]')!, alert };
    marker.label.addEventListener('pointerdown', event => event.stopPropagation());
    marker.label.addEventListener('click', event => { event.stopPropagation(); if (!this.options.blocked()) this.options.edit(marker.alert); });
    marker.remove.addEventListener('pointerdown', event => event.stopPropagation());
    marker.remove.addEventListener('click', event => { event.stopPropagation(); if (!this.options.blocked()) this.options.remove(marker.alert); });
    row.addEventListener('pointerdown', event => this.startDrag(event, marker));
    row.addEventListener('pointermove', this.onPointerMove);
    row.addEventListener('pointerup', this.onPointerUp);
    row.addEventListener('pointercancel', this.cancelDrag);
    row.addEventListener('lostpointercapture', this.cancelDrag);
    row.addEventListener('keydown', event => {
      if (event.target === row && ['Enter', ' '].includes(event.key) && !this.options.blocked()) {
        event.preventDefault(); event.stopPropagation(); this.options.edit(marker.alert);
      }
      if (event.target === row && ['Delete', 'Backspace'].includes(event.key) && !this.options.blocked()) {
        event.preventDefault(); event.stopPropagation(); this.options.remove(marker.alert);
      }
    });
    this.layer.append(row); this.markers.set(alert.alertId, marker);
    return marker;
  }
  private startDrag(event: PointerEvent, marker: Marker) {
    if (event.button !== 0 || this.options.blocked() || this.drag) return;
    event.preventDefault(); event.stopPropagation();
    this.drag = { marker, pointerId: event.pointerId, startY: event.clientY,
      price: marker.alert.price, moved: false, marketId: marker.alert.marketId };
    marker.row.setPointerCapture(event.pointerId);
    marker.row.classList.add('is-dragging');
    this.layer.classList.add('is-dragging');
    this.options.getChart()?.clearCrosshairPosition();
  }
  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 3) return;
    drag.moved = true;
    const height = this.options.getChart()?.panes()[0]?.getHeight() ?? 0;
    const y = Math.max(0, Math.min(height, event.clientY - this.options.chartElement.getBoundingClientRect().top));
    const raw = this.options.getSeries()?.coordinateToPrice(y);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return;
    const price = Number(raw.toFixed(this.options.precision(raw)));
    if (price <= 0) return;
    drag.price = price;
    this.update();
  };
  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.onPointerMove(event);
    event.preventDefault(); event.stopPropagation();
    const changed = drag.moved && drag.price !== drag.marker.alert.price;
    this.releaseDrag();
    if (changed && this.options.marketId() === drag.marketId) {
      this.pendingMove = { alertId: drag.marker.alert.alertId, price: drag.price };
      this.options.move(drag.marker.alert, drag.price);
    }
    this.update();
  };
  private releaseDrag() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    drag.marker.row.classList.remove('is-dragging'); this.layer.classList.remove('is-dragging');
    if (drag.marker.row.hasPointerCapture(drag.pointerId)) drag.marker.row.releasePointerCapture(drag.pointerId);
  }
  private cancelDrag = () => { this.releaseDrag(); this.update(); };
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.drag) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); }
  };
  destroy() {
    this.destroyed = true; this.releaseDrag(); this.unsubscribe();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    window.removeEventListener('blur', this.cancelDrag);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.layer.remove();
  }
}
