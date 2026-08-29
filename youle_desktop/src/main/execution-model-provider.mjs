export const DEFAULT_EXECUTION_MODEL_PROVIDER_ID = "haolo_ai";
export const LEGACY_GPT_EXECUTION_MODEL_PROVIDER_ID = "codex";

/**
 * AgentMS uses `codex` as the business/credential provider for GPT routes,
 * while the bundled app-server registers that same route as `haolo_ai`.
 * Keep that translation at every desktop runtime boundary so catalog values
 * and legacy persisted preferences can never reach app-server unchanged.
 */
export function canonicalExecutionModelProvider(value, fallback = "") {
  const requested = normalizedProvider(value) || normalizedProvider(fallback);
  return requested === LEGACY_GPT_EXECUTION_MODEL_PROVIDER_ID
    ? DEFAULT_EXECUTION_MODEL_PROVIDER_ID
    : requested;
}

function normalizedProvider(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
