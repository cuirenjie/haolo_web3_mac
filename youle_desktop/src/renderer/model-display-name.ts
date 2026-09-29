import { isDeepSeekFlashModel } from "../main/deepseek-model-policy.mjs";
import { isGpt6SolDisplayModel } from "../main/gpt6-sol-alias-policy.mjs";

// Display aliases never change the model ID or provider used for requests.
export function modelDisplayName(modelId: string, displayName = modelId): string {
  const label = displayName.trim() || modelId.trim();
  if (isGpt6SolDisplayModel(modelId) || isGpt6SolDisplayModel(label)) return "GPT-6-Sol";
  return isDeepSeekFlashModel(modelId) ||
    isDeepSeekFlashModel(label) ||
    /^DeepSeek\s+V4\.1\s+Flash$/i.test(label)
    ? "GPT-6 Astra"
    : label;
}
