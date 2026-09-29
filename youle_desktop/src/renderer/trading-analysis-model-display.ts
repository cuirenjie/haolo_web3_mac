import { isDeepSeekFlashModel } from "../main/deepseek-model-policy.mjs";
import { isGpt6SolDisplayModel } from "../main/gpt6-sol-alias-policy.mjs";
import { translateAppText, type AppLanguage } from "./app-language.mjs";

// Presentation only: requests, provider metadata and diagnostics retain the real ID.
export function tradingAnalysisModelDisplayName(
  model: { modelId?: string; providerId?: string } | null | undefined,
  language?: AppLanguage,
): string {
  const name = model?.modelId || model?.providerId || "分析模型";
  if (isGpt6SolDisplayModel(name)) return translateAppText("GPT-6-Sol", language);
  return isDeepSeekFlashModel(name)
    ? translateAppText("GPT-6 Astra 大模型", language)
    : name;
}
