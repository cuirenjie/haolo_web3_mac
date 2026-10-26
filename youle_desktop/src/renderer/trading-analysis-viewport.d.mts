export interface TradingAnalysisViewportCandle {
  time: number;
}

export interface TradingAnalysisViewportDrawing {
  theory?: string;
  strategyId?: string;
  colorToken?: string;
  points?: ReadonlyArray<{ time: number; price?: number }>;
}

export function isWyckoffAnalysisDrawing(drawing: { theory?: string; strategyId?: string; colorToken?: string }): boolean;

export function tradingAnalysisPlanFocusRange(
  drawings: ReadonlyArray<TradingAnalysisViewportDrawing>,
  candles: ReadonlyArray<TradingAnalysisViewportCandle>,
  plotWidth: number,
): TradingAnalysisViewportRange | null;

export function tradingAnalysisVisibleTimeRange(
  candles: ReadonlyArray<TradingAnalysisViewportCandle>,
  logicalRange: TradingAnalysisViewportRange | null,
): TradingAnalysisViewportRange | null;

export interface TradingAnalysisViewportPatch {
  operations: ReadonlyArray<{
    drawing?: TradingAnalysisViewportDrawing;
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
