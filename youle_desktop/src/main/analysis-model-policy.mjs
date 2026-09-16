// Pure policy shared with the renderer. Persistence and failure handling stay
// in the host; merely reading the policy never renews its one-hour window.
import { canonicalDeepSeekModel, migrateDeepSeekModelSelection } from "./deepseek-model-policy.mjs";
import { DEFAULT_EXECUTION_MODEL, migrateRetiredModelSelection } from "./retired-model-policy.mjs";
export const ANALYSIS_PRIMARY_MODEL = DEFAULT_EXECUTION_MODEL;
// Use the authorized business-pool ID, before any upstream alias mapping.
export const ANALYSIS_RECOVERY_MODEL = "deepseek-flash";
export const ANALYSIS_RECOVERY_EFFORT = "max";
export const ANALYSIS_RECOVERY_PROVIDER = "deepseek";
export const ANALYSIS_RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const LEGACY_ANALYSIS_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function normalizeAnalysisModelRecoveryState(value) {
  if (value?.version !== 1) return null;
  const { activatedAt, fallbackUntil } = value;
  if (!Number.isSafeInteger(activatedAt) || activatedAt <= 0
    || !Number.isSafeInteger(fallbackUntil)
    || (fallbackUntil !== activatedAt + ANALYSIS_RECOVERY_WINDOW_MS
      && fallbackUntil !== activatedAt + LEGACY_ANALYSIS_RECOVERY_WINDOW_MS)) return null;
  // Shorten legacy windows from their original activation, never from upgrade time.
  return { version: 1, activatedAt, fallbackUntil: activatedAt + ANALYSIS_RECOVERY_WINDOW_MS };
}

export function analysisModelPolicySelection(state, modelId, now = Date.now()) {
  const model = String(migrateRetiredModelSelection({ model: canonicalDeepSeekModel(modelId) }).model || ANALYSIS_PRIMARY_MODEL).trim();
  const managed = [ANALYSIS_PRIMARY_MODEL, ANALYSIS_RECOVERY_MODEL].includes(model.toLowerCase());
  const valid = normalizeAnalysisModelRecoveryState(state);
  const fallback = Boolean(managed && valid && now < valid.fallbackUntil);
  return {
    modelId: fallback ? ANALYSIS_RECOVERY_MODEL : managed && valid ? ANALYSIS_PRIMARY_MODEL : model,
    fallback,
  };
}

export function withAnalysisModelRecoveryPolicy(params, state, now = Date.now()) {
  params = migrateDeepSeekModelSelection(migrateRetiredModelSelection(params));
  const selection = analysisModelPolicySelection(state, params.model, now);
  if (selection.fallback) return {
    ...params, model: selection.modelId, modelProvider: ANALYSIS_RECOVERY_PROVIDER,
    reasoningEffort: ANALYSIS_RECOVERY_EFFORT, reasoningEffortPolicy: "fixed",
    supportedReasoningEfforts: ["low", "high", "max"],
  };
  if (normalizeAnalysisModelRecoveryState(state) && selection.modelId !== String(params.model || "")) {
    // A previous fallback may have been remembered by the thread. Let the
    // normal Sol reasoning policy choose the effort again after expiry.
    const restored = { ...params, model: selection.modelId, modelProvider: "haolo_ai" };
    for (const key of ["reasoningEffort", "reasoning_effort", "effort", "reasoningEffortPolicy", "reasoning_effort_policy", "supportedReasoningEfforts", "supported_reasoning_efforts"]) delete restored[key];
    return restored;
  }
  return params;
}
