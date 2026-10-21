export type BusinessToolError = { message: string; code?: string; retryable?: boolean; category?: string;
  diagnosticId?: string; runId?: string; strategyId?: string; completedStrategyIds?: string[]; nextAction?: 'stop'; terminal?: true };
export function businessToolError(error: unknown): BusinessToolError;
export function isTerminalAnalysisError(error: unknown): boolean;
export function restoreBusinessToolError(value: unknown): Error & BusinessToolError;
