import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type Time,
} from 'lightweight-charts';

export type TradingHistogramStyle = 'solid' | 'hollow';

interface HollowHistogramData extends CustomData<Time> {
  value: number;
}

/** A zero-based histogram whose interior stays transparent on every theme. */
export class TradingHollowHistogram implements ICustomSeriesPaneView<Time, HollowHistogramData>, ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, HollowHistogramData> | null = null;

  renderer(): ICustomSeriesPaneRenderer { return this; }

  update(data: PaneRendererCustomData<Time, HollowHistogramData>) { this.data = data; }

  defaultOptions(): CustomSeriesOptions { return { ...customSeriesDefaultOptions }; }

  // Include zero in autoscaling; the final value is used for the crosshair.
  priceValueBuilder(data: HollowHistogramData) { return [0, data.value]; }

  isWhitespace(data: HollowHistogramData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('value' in data) || !Number.isFinite(data.value);
  }

  draw(...[target, priceToCoordinate]: Parameters<ICustomSeriesPaneRenderer['draw']>) {
    const data = this.data;
    if (!data?.visibleRange) return;
    const zero = priceToCoordinate(0);
    if (zero === null || !Number.isFinite(zero)) return;
    const { from, to } = data.visibleRange;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hRatio, verticalPixelRatio: vRatio }) => {
      const spacing = data.barSpacing * (data.conflationFactor || 1) * hRatio;
      const gap = spacing <= 1 ? 0 : Math.max(1, Math.floor(hRatio));
      const width = Math.max(1, Math.round(spacing) - gap);
      const borderX = Math.max(1, Math.round(hRatio));
      const borderY = Math.max(1, Math.round(vRatio));
      const baseline = Math.round(zero * vRatio);
      ctx.save();
      for (let i = Math.max(0, from); i < Math.min(to, data.bars.length); i++) {
        const bar = data.bars[i];
        const y = priceToCoordinate(bar.originalData.value);
        if (y === null || !Number.isFinite(y)) continue;
        const tip = Math.round(y * vRatio);
        const left = Math.round(bar.x * hRatio) - Math.floor(width / 2);
        const top = Math.min(tip, baseline);
        const height = Math.max(borderY, Math.abs(tip - baseline) + 1);
        ctx.fillStyle = bar.barColor;
        // At very small zoom levels the outline itself occupies the whole bar.
        if (width <= 2 * borderX || height <= 2 * borderY) {
          ctx.fillRect(left, top, width, height);
        } else {
          ctx.fillRect(left, top, width, borderY);
          ctx.fillRect(left, top + height - borderY, width, borderY);
          ctx.fillRect(left, top + borderY, borderX, height - 2 * borderY);
          ctx.fillRect(left + width - borderX, top + borderY, borderX, height - 2 * borderY);
        }
      }
      ctx.restore();
    });
  }

  destroy() { this.data = null; }
}
