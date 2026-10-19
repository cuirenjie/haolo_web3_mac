export function errorSignals(error: unknown): { detail: string; statuses: number[]; retryable: boolean | undefined };
export function isQuotaFailure(error: unknown): boolean;
