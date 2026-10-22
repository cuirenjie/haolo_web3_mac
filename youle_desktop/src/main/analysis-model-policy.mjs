// Inference policy only; the product tariff remains independent.
import { canonicalDeepSeekModel, migrateDeepSeekModelSelection } from "./deepseek-model-policy.mjs";
import { DEFAULT_EXECUTION_MODEL, migrateRetiredModelSelection } from "./retired-model-policy.mjs";
export const ANALYSIS_PRIMARY_MODEL = DEFAULT_EXECUTION_MODEL;
export const ANALYSIS_RECOVERY_MODEL = "gpt-5.6-sol";
export const ANALYSIS_RECOVERY_EFFORT = "high";
export const ANALYSIS_RECOVERY_PROVIDER = "haolo_ai";
export const ANALYSIS_RECOVERY_WINDOW_MS = 60_000;

export function normalizeAnalysisModelRecoveryState(value) {
  // v1 meant GPT -> DeepSeek. Never reinterpret an old window in reverse.
  if (value?.version !== 2) return null;
  const { activatedAt, fallbackUntil } = value;
  if (!Number.isSafeInteger(activatedAt) || activatedAt <= 0
    || !Number.isSafeInteger(fallbackUntil)
    || fallbackUntil !== activatedAt + ANALYSIS_RECOVERY_WINDOW_MS) return null;
  return { version: 2, activatedAt, fallbackUntil };
}

export function analysisModelPolicySelection(state, modelId, now = Date.now()) {
  const model = String(migrateRetiredModelSelection({ model: canonicalDeepSeekModel(modelId) }).model || ANALYSIS_PRIMARY_MODEL).trim();
  const managed = [ANALYSIS_PRIMARY_MODEL, ANALYSIS_RECOVERY_MODEL, "gpt-6-sol"].includes(model.toLowerCase());
  const valid = normalizeAnalysisModelRecoveryState(state);
  const fallback = Boolean(managed && valid && now < valid.fallbackUntil);
  return { modelId: managed ? fallback ? ANALYSIS_RECOVERY_MODEL : ANALYSIS_PRIMARY_MODEL : model, fallback };
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
    if (!model || model.toLowerCase().startsWith("deepseek-")) return restoreGptSelection(params, ANALYSIS_RECOVERY_MODEL);
    if (model.toLowerCase().startsWith("gpt-") && String(params.modelProvider || params.model_provider || "").toLowerCase() === "deepseek") return restoreGptSelection(params, model);
    return params;
  }
  if (params.explicitModelSelection === true) return params;
  const selection = analysisModelPolicySelection(state, params.model, now);
  if (![ANALYSIS_PRIMARY_MODEL, ANALYSIS_RECOVERY_MODEL].includes(selection.modelId)) return params;
  const next = { ...params, model: selection.modelId,
    modelProvider: selection.fallback ? ANALYSIS_RECOVERY_PROVIDER : "deepseek" };
  delete next.model_provider;
  const oldProvider = params.modelProvider || params.model_provider;
  if (selection.modelId !== params.model || (oldProvider && oldProvider !== next.modelProvider)) {
    for (const key of ["reasoningEffort", "reasoning_effort", "effort", "reasoningEffortPolicy", "reasoning_effort_policy", "supportedReasoningEfforts", "supported_reasoning_efforts", "__haoloFixedReasoningEffort", "__haoloSupportedReasoningEfforts"]) delete next[key];
  }
  if (selection.fallback) Object.assign(next, {
    reasoningEffort: ANALYSIS_RECOVERY_EFFORT, reasoningEffortPolicy: "fixed",
    supportedReasoningEfforts: ["low", "medium", "high"],
  });
  return next;
}
