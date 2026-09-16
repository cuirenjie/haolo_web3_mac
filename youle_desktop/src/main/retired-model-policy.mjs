// Shared by UI selection, host RPC and outbound transports. Keep historical
// transcripts readable, but never dispatch another request to retired models.
export const DEFAULT_EXECUTION_MODEL = "gpt-5.6-sol";

export function isRetiredExecutionModel(value) {
  const slug = String(value || "").trim().toLowerCase().split("/").at(-1);
  return /^gpt-5\.5(?:$|[-_:])/.test(slug || "");
}

export function migrateRetiredModelSelection(params = {}) {
  if (!isRetiredExecutionModel(params.model)) return params;
  const next = { ...params, model: DEFAULT_EXECUTION_MODEL, modelProvider: "haolo_ai" };
  delete next.model_provider;
  for (const key of ["effort", "reasoningEffort", "reasoning_effort", "reasoningEffortPolicy", "reasoning_effort_policy", "supportedReasoningEfforts", "supported_reasoning_efforts", "__haoloFixedReasoningEffort", "__haoloSupportedReasoningEfforts"]) delete next[key];
  return next;
}

export function assertAllowedModel(value) {
  if (!isRetiredExecutionModel(value)) return;
  throw Object.assign(new Error("This model is retired. Select GPT-5.6-Sol or GPT-6 Astra."), {
    code: "MODEL_RETIRED", category: "invalid_request", status: 400, retryable: false,
  });
}

export function assertAllowedModelRequest(params = {}) {
  for (const value of [params.model, params.modelId, params.model_id,
    params.settings?.model, params.config?.model, params.response?.model,
    params.collaborationMode?.settings?.model, params.collaboration_mode?.settings?.model]) assertAllowedModel(value);
}
