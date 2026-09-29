// GPT-6-Sol is a customer-facing alias for the GPT-5.6-Sol execution chain.
// Keep the alias at the request boundary so the existing GPT-5.6-Sol recovery
// policy (including DeepSeek V4.1 Flash) remains the single runtime path.
export const GPT_6_SOL_DISPLAY_MODEL = "gpt-6-sol";
export const GPT_6_SOL_RUNTIME_MODEL = "gpt-5.6-sol";

export function isGpt6SolDisplayModel(value) {
  return String(value || "").trim().toLowerCase() === GPT_6_SOL_DISPLAY_MODEL;
}

export function displayModelAliasForSelection(value) {
  return isGpt6SolDisplayModel(value) ? GPT_6_SOL_DISPLAY_MODEL : "";
}

export function runtimeModelForSelection(value) {
  return isGpt6SolDisplayModel(value)
    ? GPT_6_SOL_RUNTIME_MODEL
    : String(value || "").trim();
}

export function migrateGpt6SolSelection(params = {}) {
  if (!params || typeof params !== "object") return params;
  const selected = [params.model, params.modelId, params.model_id]
    .map((value) => String(value || "").trim().toLowerCase())
    .find((value) => value === GPT_6_SOL_DISPLAY_MODEL);
  if (!selected) return params;
  const next = {
    ...params,
    model: GPT_6_SOL_RUNTIME_MODEL,
    modelProvider: "haolo_ai",
    __haoloModelDisplayAlias: GPT_6_SOL_DISPLAY_MODEL,
  };
  if (Object.prototype.hasOwnProperty.call(params, "modelId")) next.modelId = GPT_6_SOL_RUNTIME_MODEL;
  if (Object.prototype.hasOwnProperty.call(params, "model_id")) next.model_id = GPT_6_SOL_RUNTIME_MODEL;
  delete next.model_provider;
  return next;
}
