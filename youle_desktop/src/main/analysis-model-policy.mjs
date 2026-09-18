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

function restoreGptSelection(params, model) {
  const restored = { ...params, model, modelProvider: "haolo_ai" };
  delete restored.model_provider;
  for (const key of [
    "reasoningEffort", "reasoning_effort", "effort",
    "reasoningEffortPolicy", "reasoning_effort_policy",
    "supportedReasoningEfforts", "supported_reasoning_efforts",
    "__haoloFixedReasoningEffort", "__haoloSupportedReasoningEfforts",
  ]) delete restored[key];
  return restored;
}

export function withAnalysisModelRecoveryPolicy(params, state, now = Date.now(), context = {}) {
  params = migrateDeepSeekModelSelection(migrateRetiredModelSelection(params));
  const mode = String(context.conversationMode || params.conversationMode || params.conversation_mode || "").trim().toLowerCase().replace(/_/g, "-");
  if (["image-generation", "video-generation"].includes(mode)) {
    // Media tools require a GPT root. Repair remembered fallback selections,
    // but never let the global text fallback override a compatible GPT choice.
    const model = String(params.model || "").trim();
    if (!model || model.toLowerCase() === ANALYSIS_RECOVERY_MODEL) return restoreGptSelection(params, ANALYSIS_PRIMARY_MODEL);
    if (model.toLowerCase().startsWith("gpt-") && String(params.modelProvider || params.model_provider || "").toLowerCase() === ANALYSIS_RECOVERY_PROVIDER) return restoreGptSelection(params, model);
    return params;
  }
  const selection = analysisModelPolicySelection(state, params.model, now);
  if (selection.fallback) return {
    ...params, model: selection.modelId, modelProvider: ANALYSIS_RECOVERY_PROVIDER,
    reasoningEffort: ANALYSIS_RECOVERY_EFFORT, reasoningEffortPolicy: "fixed",
    supportedReasoningEfforts: ["low", "high", "max"],
  };
  const staleRecoveryProvider = selection.modelId === ANALYSIS_PRIMARY_MODEL
    && String(params.modelProvider || params.model_provider || "").trim().toLowerCase() === ANALYSIS_RECOVERY_PROVIDER;
  if (normalizeAnalysisModelRecoveryState(state)
    && (selection.modelId !== String(params.model || "") || staleRecoveryProvider)) {
    // A previous fallback may have been remembered by the thread. Let the
    // normal Sol reasoning policy choose the effort again after expiry.
    return restoreGptSelection(params, selection.modelId);
  }
  return params;
}
