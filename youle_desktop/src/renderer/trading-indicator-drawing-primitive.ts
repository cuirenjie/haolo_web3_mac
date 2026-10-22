import type { AutoscaleInfo, IPrimitivePaneRenderer, ISeriesPrimitive, Logical, SeriesAttachedParameter, UTCTimestamp } from 'lightweight-charts';

type CandleTime = { time: number };
export interface IndicatorDrawingPath {
  points: readonly { time: number; value: number }[];
  color: string;
  lineWidth: number;
  lineStyle?: string;
}
export interface IndicatorDrawingMarker {
  time: number;
  value: number;
  color: string;
  text?: string;
  size: number;
  position: 'above' | 'below' | 'center';
  fontSize: number;
  bold: boolean;
}

/** Project between actual candle coordinates, including off-grid crossover
 * times and legacy +1s leaders. Never insert, sort or modify market data. */
export function indicatorDrawingTimeCoordinate(
  time: number, candles: readonly CandleTime[], offset: number,
  coordinate: (time: number) => number | null,
): number | null {
  if (!Number.isFinite(time) || !candles.length) return null;
  let low = 0, high = candles.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  if (candles[low]?.time === time) return coordinate(time + offset);
  if (candles.length < 2) return null;
  const right = Math.max(1, Math.min(candles.length - 1, low));
  const first = candles[right - 1].time, second = candles[right].time;
  const x1 = coordinate(first + offset), x2 = coordinate(second + offset);
  if (x1 === null || x2 === null || second <= first) return null;
  return x1 + (x2 - x1) * (time - first) / (second - first);
}

/** Pure pane graphics: no series/data writes, axis labels or pointer capture.
 * The existing indicator owns the price scale and all candle times remain
 * authoritative, even when several indicators contain off-grid annotations. */
export class TradingIndicatorDrawingPrimitive implements ISeriesPrimitive {
  readonly paths: readonly IndicatorDrawingPath[];
  readonly markers: readonly IndicatorDrawingMarker[];
  private readonly getCandles: () => readonly CandleTime[];
  private readonly offset: number;
  private chart: SeriesAttachedParameter['chart'] | null = null;
  private series: SeriesAttachedParameter['series'] | null = null;
  private readonly views = [{ zOrder: () => 'top' as const, renderer: () => this }];

  constructor(paths: readonly IndicatorDrawingPath[], markers: readonly IndicatorDrawingMarker[], getCandles: () => readonly CandleTime[], offset: number) {
    this.paths = paths;
    this.markers = markers;
    this.getCandles = getCandles;
    this.offset = offset;
  }

  attached({ chart, series }: SeriesAttachedParameter) { this.chart = chart; this.series = series; }
  detached() { this.chart = null; this.series = null; }
  destroy() { this.series?.detachPrimitive(this); this.detached(); }
  paneViews() { return this.views; }

  private x(time: number) {
    return indicatorDrawingTimeCoordinate(time, this.getCandles(), this.offset,
      timestamp => this.chart?.timeScale().timeToCoordinate(timestamp as UTCTimestamp) ?? null);
  }

  autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    if (!this.chart || !this.series) return null;
    let min = Infinity, max = -Infinity;
    // Match path autoscaling without introducing times to the DataLayer.
    for (const path of this.paths) {
      let previous: { logical: number; value: number } | null = null;
      for (const point of path.points) {
        const x = this.x(point.time);
        const logical = x === null ? null : this.chart.timeScale().coordinateToLogical(x);
        if (logical === null) { previous = null; continue; }
        if (logical >= start && logical <= end) {
          min = Math.min(min, point.value); max = Math.max(max, point.value);
        }
        if (previous && Math.max(previous.logical, logical) >= start && Math.min(previous.logical, logical) <= end) {
          min = Math.min(min, previous.value, point.value); max = Math.max(max, previous.value, point.value);
        }
        previous = { logical, value: point.value };
      }
    }
    return Number.isFinite(min) ? { priceRange: { minValue: min, maxValue: max } } : null;
  }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
      for (const path of this.paths) {
        ctx.strokeStyle = path.color; ctx.lineWidth = path.lineWidth;
        ctx.setLineDash(path.lineStyle === 'dotted' ? [path.lineWidth, path.lineWidth]
          : path.lineStyle === 'dashed' ? [path.lineWidth * 5, path.lineWidth * 5] : []);
        ctx.beginPath();
        let started = false;
        for (const point of path.points) {
          const x = this.x(point.time), y = this.series!.priceToCoordinate(point.value);
          if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
          if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          started = true;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const marker of this.markers) {
        const x = this.x(marker.time), priceY = this.series!.priceToCoordinate(marker.value);
        if (x === null || priceY === null || !Number.isFinite(x) || !Number.isFinite(priceY)) continue;
        const radius = marker.size * 5;
        const direction = marker.position === 'above' ? -1 : marker.position === 'below' ? 1 : 0;
        const y = priceY + direction * (radius + 4);
        ctx.fillStyle = marker.color;
        if (radius > 0) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
        if (marker.text) {
          ctx.font = `${marker.bold ? 'bold ' : ''}${marker.fontSize}px Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = direction < 0 ? 'bottom' : direction > 0 ? 'top' : 'middle';
          ctx.fillText(marker.text, x, y + direction * (radius + 3));
        }
      }
      ctx.restore();
    });
  }
}
