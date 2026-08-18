export const PERSONAL_STRATEGY_ATTACHMENT_BATCH_SIZE: number;
export const PERSONAL_STRATEGY_MAX_RETRIES: number;

export function chunkPersonalStrategyAttachments<T>(values: T[], size?: number): T[][];
export function personalStrategyRetryDelayMs(attempt: number): number;
export function classifyPersonalStrategyFailure(error: unknown, phase?: string): {
  code: string;
  kind: string;
  phase: string;
  retryable: boolean;
  userMessage: string;
  detail: string;
};
export function mergePersonalStrategyUnderstandings(values: unknown[], options?: { rawText?: string }): Record<string, unknown>;
