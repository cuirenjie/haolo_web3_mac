// Inference policy only; the product tariff remains independent.
import { canonicalDeepSeekModel, migrateDeepSeekModelSelection, isManagedAnalysisModel } from "./deepseek-model-policy.mjs";
import { DEFAULT_EXECUTION_MODEL, migrateRetiredModelSelection } from "./retired-model-policy.mjs";
export const ANALYSIS_PRIMARY_MODEL = DEFAULT_EXECUTION_MODEL;
export const ANALYSIS_RECOVERY_MODEL = "gpt-5.6-sol";
export const ANALYSIS_RECOVERY_EFFORT = "high";
export const ANALYSIS_RECOVERY_PROVIDER = "haolo_ai";
export const ANALYSIS_RECOVERY_WINDOW_MS = 60_000;
// Product inference is DeepSeek-only. Keep legacy names for saved envelopes
// and billing compatibility; none of them may enable another model.
export const ANALYSIS_MODEL_FALLBACK_ENABLED = false;

export function normalizeAnalysisModelRecoveryState(value) {
  // Both historical directions (v1/v2) are retired, including unexpired v2.
  return null;
}

export function analysisModelPolicySelection(state, modelId, now = Date.now()) {
  const model = String(migrateRetiredModelSelection({ model: canonicalDeepSeekModel(modelId) }).model || ANALYSIS_PRIMARY_MODEL).trim();
  const managed = isManagedAnalysisModel(model);
  return { modelId: managed ? ANALYSIS_PRIMARY_MODEL : model, fallback: false };
}

export function withAnalysisModelRecoveryPolicy(params, state, now = Date.now()) {
  params = migrateDeepSeekModelSelection(migrateRetiredModelSelection(params));
  if (["image-generation", "video-generation"].includes(params.conversationMode || params.conversation_mode)) return params;
  const selection = analysisModelPolicySelection(state, params.model, now);
  if (![ANALYSIS_PRIMARY_MODEL, ANALYSIS_RECOVERY_MODEL].includes(selection.modelId)) return params;
  const next = { ...params, model: selection.modelId,
    modelProvider: selection.fallback ? ANALYSIS_RECOVERY_PROVIDER : "deepseek" };
  delete next.model_provider;
  const oldProvider = params.modelProvider || params.model_provider;
  if (selection.modelId !== params.model || (oldProvider && oldProvider !== next.modelProvider)) {
    for (const key of ["reasoningEffort", "reasoning_effort", "effort", "reasoningEffortPolicy", "reasoning_effort_policy", "supportedReasoningEfforts", "supported_reasoning_efforts"]) delete next[key];
  }
  Object.assign(next, { reasoningEffort: "low", reasoningEffortPolicy: "fixed", supportedReasoningEfforts: ["low"] });
  for (const key of ["reasoning_effort", "effort"]) if (key in next) next[key] = "low";
  return next;
}

// Apply at the native RPC boundary as well as UI entry points: resume, fork
// and automatic thread setup can otherwise restore a persisted GPT provider.
// Only selection envelopes are traversed; prompts/history and billing labels
// are never rewritten.
export function normalizeAnalysisRPCSelection(method, params) {
  if (!["thread/start", "thread/resume", "thread/fork", "thread/settings/update", "turn/start"].includes(method)) return params;
  if (["image-generation", "video-generation"].includes(params.conversationMode || params.conversation_mode)) return params;
  const visit = (value, root = false) => {
    let next = value;
    const modelKey = ["model", "modelId", "model_id"].find(key => typeof value[key] === "string");
    const model = modelKey ? value[modelKey] : undefined;
    if (isManagedAnalysisModel(model) || (root && !modelKey && !value.modelProvider && !value.model_provider)) {
      next = withAnalysisModelRecoveryPolicy({ ...value, model }, null);
      if (modelKey && modelKey !== "model") next[modelKey] = next.model;
      for (const key of ["reasoning_effort", "effort"]) if (key in value) next[key] = "low";
      if (!root && "model_provider" in value) next.model_provider = "deepseek";
    }
    for (const key of ["settings", "config", "collaborationMode", "collaboration_mode"]) {
      if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
        const nested = visit(value[key]);
        if (nested !== value[key]) next = { ...next, [key]: nested };
      }
    }
    return next;
  };
  return visit(params, true);
}
