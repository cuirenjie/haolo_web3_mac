import type { AutoscaleInfo, ISeriesPrimitive, PriceRange, Time } from 'lightweight-charts';

type Series = {
  attachPrimitive(primitive: ISeriesPrimitive<Time>): void;
  detachPrimitive(primitive: ISeriesPrimitive<Time>): void;
};

/** Native autoscaling supplies visible candle bounds and converts axis modes. */
export function tradingAiPlanFitRange(
  planPrices: readonly number[],
  drawings: readonly { points: readonly { price: number }[] }[],
): PriceRange | null {
  const valid = (price: number) => Number.isFinite(price) && price > 0;
  const prices = planPrices.filter(valid);
  if (!prices.length) return null;
  for (const drawing of drawings) for (const point of drawing.points) {
    if (valid(point.price)) prices.push(point.price);
  }
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
