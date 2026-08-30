import { TradingAnalysisModelProviderError } from "./model-provider.mjs";

export const DEFAULT_TRADING_ANALYSIS_PROVIDER_ID = "openai-codex";
export const DEFAULT_TRADING_ANALYSIS_MODEL_ID = "gpt-5.6-sol";

export function createAppServerTradingAnalysisProvider(options = {}) {
  const invoke = options.invoke;
  if (typeof invoke !== "function") throw new TypeError("invoke is required");
  const providerId = String(options.providerId || DEFAULT_TRADING_ANALYSIS_PROVIDER_ID);
  const modelId = String(options.modelId || DEFAULT_TRADING_ANALYSIS_MODEL_ID);
  const modelProvider = options.modelProvider ? String(options.modelProvider) : undefined;
  return Object.freeze({
    providerId,
    modelId,
    capabilities: Object.freeze({
      json: true,
      cancellation: true,
      theoryReview: true,
    }),
    async analyze(request, { signal, reasoningEffort } = {}) {
      const startedAt = Date.now();
      const result = await invoke({
        providerId,
        modelId,
        modelProvider,
        request,
        signal,
        reasoningEffort,
      });
      if (result?.status !== "success") {
        throw new TradingAnalysisModelProviderError(
          String(result?.error || "Trading analysis app-server turn failed"),
          {
            code: String(result?.code || "TRADING_ANALYSIS_APP_SERVER_FAILED"),
            providerId,
            modelId,
            retryable: result?.retryable === true,
          },
        );
      }
      return {
        providerId,
        modelId,
        text: result.text,
        latencyMs: Date.now() - startedAt,
        usage: result.usage || null,
        finishReason: result.finishReason || "completed",
      };
    },
  });
}
