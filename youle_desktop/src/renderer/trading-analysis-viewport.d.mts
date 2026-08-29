export interface TradingAnalysisViewportCandle {
  time: number;
}

export interface TradingAnalysisViewportPatch {
  operations: ReadonlyArray<{
    drawing?: {
      points?: ReadonlyArray<{ time: number }>;
    };
  }>;
}

export interface TradingAnalysisViewportRange {
  from: number;
  to: number;
}

export function tradingAnalysisDrawingFocusRange(
  patch: TradingAnalysisViewportPatch,
  candles: ReadonlyArray<TradingAnalysisViewportCandle>,
  plotWidth: number,
): TradingAnalysisViewportRange | null;

export interface TradingAnalysisViewportPaintScheduler {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
}

export function waitForTradingAnalysisViewportPaint(
  scheduler?: TradingAnalysisViewportPaintScheduler,
): Promise<void>;
