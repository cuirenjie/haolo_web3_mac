import type { AutoscaleInfo, ISeriesPrimitive, PriceRange, Time } from 'lightweight-charts';
import { isWyckoffAnalysisDrawing } from './trading-analysis-viewport.mjs';

type Series = {
  attachPrimitive(primitive: ISeriesPrimitive<Time>): void;
  detachPrimitive(primitive: ISeriesPrimitive<Time>): void;
};

/** Native autoscaling supplies visible candle bounds and converts axis modes. */
export function tradingAiPlanFitRange(
  planPrices: readonly number[],
  drawings: readonly { theory?: string; strategyId?: string; colorToken?: string; tool?: string; points: readonly { price: number; time?: number }[] }[],
  visibleTime?: { from: number; to: number } | null,
): PriceRange | null {
  const valid = (price: number) => Number.isFinite(price) && price > 0;
  const prices = planPrices.filter(valid);
  // Wyckoff can have a complete structure without an executable plan. Its
  // projections must still fit; other strategies retain their plan-only fit.
  const fittedDrawings = prices.length ? drawings : drawings.filter(drawing => isWyckoffAnalysisDrawing(drawing));
  for (const drawing of fittedDrawings) {
    const points = drawing.points.filter(point => valid(point.price));
    if (!visibleTime || points.some(point => !Number.isFinite(point.time))) {
      prices.push(...points.map(point => point.price));
      continue;
    }
    const times = points.map(point => point.time!);
    if (!times.length || Math.max(...times) < visibleTime.from || Math.min(...times) > visibleTime.to) continue;
    if (drawing.tool === 'rectangle') {
      prices.push(...points.map(point => point.price));
      continue;
    }
    for (const [index, point] of points.entries()) {
      if (point.time! >= visibleTime.from && point.time! <= visibleTime.to) prices.push(point.price);
      const previous = points[index - 1];
      if (!previous || previous.time === point.time) continue;
      // A crossing line contributes its boundary intersection, not its distant
      // off-screen anchor. This keeps old highs from shrinking recent candles.
      for (const boundary of [visibleTime.from, visibleTime.to]) {
        const ratio = (boundary - previous.time!) / (point.time! - previous.time!);
        if (ratio > 0 && ratio < 1) prices.push(previous.price + ratio * (point.price - previous.price));
      }
    }
  }
  if (!prices.length) return null;
  const low = Math.min(...prices), high = Math.max(...prices);
  const padding = Math.max((high - low) * .03, high * .0001);
  return { minValue: Math.max(low - padding, low / 2), maxValue: high + padding };
}

/** Contributes no pixels or data points; SVG remains the only plan renderer. */
export class TradingAiPlanAutoscale implements ISeriesPrimitive<Time> {
  private series: Series | null = null;
  private range: PriceRange | null = null;
  private requestUpdate: (() => void) | null = null;

  attached({ requestUpdate }: { requestUpdate: () => void }) { this.requestUpdate = requestUpdate; }
  detached() { this.requestUpdate = null; }
  priceRange() { return this.range; }
  autoscaleInfo(): AutoscaleInfo | null {
    return this.range ? { priceRange: this.range, margins: { above: 12, below: 12 } } : null;
  }

  update(series: Series | null, range: PriceRange | null) {
    const changed = this.range?.minValue !== range?.minValue || this.range?.maxValue !== range?.maxValue;
    this.range = range;
    if (series !== this.series) {
      this.series?.detachPrimitive(this);
      this.series = series;
      this.series?.attachPrimitive(this);
    } else if (changed) this.requestUpdate?.();
  }

  destroy() {
    this.series?.detachPrimitive(this);
    this.series = null;
    this.range = null;
  }
}
