export const DEEPSEEK_FLASH_MODEL: "deepseek-flash";
export const LEGACY_DEEPSEEK_FLASH_MODEL: "deepseek-v4-flash";
export function canonicalDeepSeekModel(value: unknown): string;
export function isDeepSeekFlashModel(value: unknown): boolean;
export function migrateDeepSeekModelSelection<T extends Record<string, unknown>>(params: T): T;
