// Pure policy shared with the renderer. Persistence and failure handling stay
// in the host; merely reading the policy never renews its 24-hour window.
export const ANALYSIS_PRIMARY_MODEL = "gpt-5.6-sol";
export const ANALYSIS_RECOVERY_MODEL = "gpt-5.5";
export const ANALYSIS_RECOVERY_EFFORT = "xhigh";
export const ANALYSIS_RECOVERY_PROVIDER = "haolo_ai";
export const ANALYSIS_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function normalizeAnalysisModelRecoveryState(value) {
  if (value?.version !== 1) return null;
  const { activatedAt, fallbackUntil } = value;
  if (!Number.isSafeInteger(activatedAt) || activatedAt <= 0
    || !Number.isSafeInteger(fallbackUntil)
    || fallbackUntil !== activatedAt + ANALYSIS_RECOVERY_WINDOW_MS) return null;
  return { version: 1, activatedAt, fallbackUntil };
}

export function analysisModelPolicySelection(state, modelId, now = Date.now()) {
  const model = String(modelId || ANALYSIS_PRIMARY_MODEL).trim();
  const managed = [ANALYSIS_PRIMARY_MODEL, ANALYSIS_RECOVERY_MODEL].includes(model.toLowerCase());
  const valid = normalizeAnalysisModelRecoveryState(state);
  const fallback = Boolean(managed && valid && now < valid.fallbackUntil);
  return {
    modelId: fallback ? ANALYSIS_RECOVERY_MODEL : managed && valid ? ANALYSIS_PRIMARY_MODEL : model,
    fallback,
  };
}

export function withAnalysisModelRecoveryPolicy(params, state, now = Date.now()) {
  const selection = analysisModelPolicySelection(state, params.model, now);
  if (selection.fallback) return {
    ...params, model: selection.modelId, modelProvider: ANALYSIS_RECOVERY_PROVIDER,
    reasoningEffort: ANALYSIS_RECOVERY_EFFORT, reasoningEffortPolicy: "fixed",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  };
  if (normalizeAnalysisModelRecoveryState(state) && selection.modelId !== String(params.model || "")) {
    // A previous fallback may have been remembered by the thread. Let the
    // normal Sol reasoning policy choose the effort again after expiry.
    const restored = { ...params, model: selection.modelId, modelProvider: ANALYSIS_RECOVERY_PROVIDER };
    for (const key of ["reasoningEffort", "reasoning_effort", "effort", "reasoningEffortPolicy", "reasoning_effort_policy", "supportedReasoningEfforts", "supported_reasoning_efforts"]) delete restored[key];
    return restored;
  }
  return params;
}
