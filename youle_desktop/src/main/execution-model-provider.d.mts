export const DEFAULT_EXECUTION_MODEL_PROVIDER_ID: "haolo_ai";
export const LEGACY_GPT_EXECUTION_MODEL_PROVIDER_ID: "codex";

export function canonicalExecutionModelProvider(
  value: unknown,
  fallback?: unknown,
): string;
