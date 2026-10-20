export function errorSignals(error: unknown): { detail: string; statuses: number[]; retryable: boolean | undefined };
export function isMembershipFailure(error: unknown): boolean;
export function isQuotaFailure(error: unknown): boolean;
