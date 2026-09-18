export function describeTradingAnalysisFailure(error: unknown, options?: { stage?: string; language?: string }): {
  category: string;
  summary: string;
  cancelled: boolean;
  allowLocalRecovery: boolean;
};
export function settleTradingAnalysisDrawing(options: {
  commit: () => Promise<unknown>;
  isActive: () => boolean;
  onFailure?: (error: unknown) => unknown;
}): Promise<{ drawingDeferred: boolean }>;
export function tradingAnalysisSnapshotUnavailable(reason: string): Error & { code: string; retryable: boolean };
