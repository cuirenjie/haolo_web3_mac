export const DEFAULT_EXECUTION_MODEL: string;
export function isRetiredExecutionModel(value: unknown): boolean;
export function migrateRetiredModelSelection<T extends Record<string, unknown>>(params: T): T & Record<string, unknown>;
export function assertAllowedModel(value: unknown): void;
export function assertAllowedModelRequest(params?: Record<string, unknown>): void;
