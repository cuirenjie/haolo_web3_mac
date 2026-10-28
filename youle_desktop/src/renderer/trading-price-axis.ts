import type { IChartApi } from 'lightweight-charts';

type ChartWithPriceAxisOverlay = IChartApi & {
  haoloSetPriceAxisOverlay?: (enabled: boolean) => void;
  haoloPriceAxisLabelWidth?: () => number;
};

export function setTradingPriceAxisOverlay(chart: IChartApi | null | undefined, enabled: boolean) {
  (chart as ChartWithPriceAxisOverlay | null | undefined)?.haoloSetPriceAxisOverlay?.(enabled);
}

/** DOM labels share the native price-label column, inside the plot when collapsed. */
export function tradingPriceAxisLabelGeometry(chart: IChartApi, paneIndex = 0) {
  const reservedWidth = chart.priceScale('right', paneIndex).width();
  const plotWidth = chart.timeScale().width();
  const overlay = reservedWidth === 0;
  const width = overlay
    ? Math.min(plotWidth, Math.max((chart as ChartWithPriceAxisOverlay).haoloPriceAxisLabelWidth?.() ?? 0, 64))
    : reservedWidth;
  return { width, left: Math.max(0, overlay ? plotWidth - width : plotWidth), overlay };
}
