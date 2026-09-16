export type AnalysisModelRecoveryState = { version: 1; activatedAt: number; fallbackUntil: number };
export const ANALYSIS_PRIMARY_MODEL: string;
export const ANALYSIS_RECOVERY_MODEL: string;
export const ANALYSIS_RECOVERY_EFFORT: string;
export const ANALYSIS_RECOVERY_PROVIDER: string;
export const ANALYSIS_RECOVERY_WINDOW_MS: number;
export function normalizeAnalysisModelRecoveryState(value: unknown): AnalysisModelRecoveryState | null;
export function analysisModelPolicySelection(state: unknown, modelId?: unknown, now?: number): { modelId: string; fallback: boolean };
export function withAnalysisModelRecoveryPolicy<T extends Record<string, unknown>>(params: T, state: unknown, now?: number, context?: { conversationMode?: unknown }): T & Record<string, unknown>;
