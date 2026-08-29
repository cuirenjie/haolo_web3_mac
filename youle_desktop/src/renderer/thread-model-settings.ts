import { canonicalExecutionModelProvider } from "../main/execution-model-provider.mjs";

export type ThreadModelSettings = {
  modelProvider?: string | null;
  model: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
};

const CANONICAL_FIXED_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
] as const;

const DEEPSEEK_EXECUTION_MODEL = "deepseek-v4-flash";

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

/**
 * Runtime thread models are not limited to the models currently offered by
 * the picker. Old rollouts and private aliases must remain observable so the
 * UI never replaces an effective model with the new-thread default.
 */
export function normalizeRuntimeThreadModelSettings(value: unknown): ThreadModelSettings | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const requestedModel = firstString(source.model);
  if (!requestedModel) return null;
  const fixedModel = CANONICAL_FIXED_MODELS.find(
    (model) => model.toLowerCase() === requestedModel.toLowerCase(),
  );
  const reasoningEffort = firstString(source.reasoningEffort, source.reasoning_effort, source.effort) || null;
  const rawServiceTier = source.serviceTier ?? source.service_tier;
  const deepSeek = requestedModel.toLowerCase() === DEEPSEEK_EXECUTION_MODEL;
  const modelProvider = canonicalExecutionModelProvider(
    firstString(source.modelProvider, source.model_provider),
    deepSeek
      ? "deepseek"
      : requestedModel.toLowerCase().startsWith("gpt-")
        ? "haolo_ai"
        : "",
  );
  return {
    modelProvider: modelProvider || null,
    model: fixedModel || requestedModel,
    // Preserve the effective per-turn value reported by the runtime. DeepSeek
    // is adaptive too, so its thread metadata must not be rewritten to Max.
    reasoningEffort,
    serviceTier: rawServiceTier == null ? null : String(rawServiceTier).trim() || null,
  };
}
