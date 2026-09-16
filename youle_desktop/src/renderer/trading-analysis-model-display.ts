import { isDeepSeekFlashModel } from "../main/deepseek-model-policy.mjs";
import { translateAppText, type AppLanguage } from "./app-language.mjs";

// Presentation only: requests, provider metadata and diagnostics retain the real ID.
export function tradingAnalysisModelDisplayName(
  model: { modelId?: string; providerId?: string } | null | undefined,
  language?: AppLanguage,
): string {
  const name = model?.modelId || model?.providerId || "分析模型";
  return isDeepSeekFlashModel(name)
    ? translateAppText("GPT-6 Astra 大模型", language)
    : name;
}
