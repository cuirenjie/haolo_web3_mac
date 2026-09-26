import { TradingAnalysisModelProviderError } from "./model-provider.mjs";
import { ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT, ANALYSIS_RECOVERY_PROVIDER, runWithAnalysisModelRecovery } from "../analysis-model-recovery.mjs";
import { ANALYSIS_PRIMARY_MODEL } from "../analysis-model-policy.mjs";
import { canonicalDeepSeekModel } from "../deepseek-model-policy.mjs";
import { migrateRetiredModelSelection } from "../retired-model-policy.mjs";

export const DEFAULT_TRADING_ANALYSIS_PROVIDER_ID = "openai-codex";
export const DEFAULT_TRADING_ANALYSIS_MODEL_ID = ANALYSIS_PRIMARY_MODEL;

export function createAppServerTradingAnalysisProvider(options = {}) {
  const invoke = options.invoke;
  if (typeof invoke !== "function") throw new TypeError("invoke is required");
  const providerId = String(options.providerId || DEFAULT_TRADING_ANALYSIS_PROVIDER_ID);
  const modelId = String(migrateRetiredModelSelection({ model: canonicalDeepSeekModel(options.modelId) }).model || DEFAULT_TRADING_ANALYSIS_MODEL_ID);
  const modelProvider = options.modelProvider ? String(options.modelProvider) : undefined;
  const fixedReasoningEffort = options.fixedReasoningEffort
    ? String(options.fixedReasoningEffort)
    : null;
  return Object.freeze({
    providerId,
    modelId,
    capabilities: Object.freeze({
      json: true,
      cancellation: true,
      theoryReview: true,
    }),
    async analyze(request, { signal, reasoningEffort, recoveryModel } = {}) {
      const startedAt = Date.now();
      const recoverableReview = !String(request.task || "").endsWith("-request-routing")
        && request.task !== "trading_alert_intent_compile";
      const operation = async (selection) => {
        const selectedReasoningEffort = fixedReasoningEffort || selection.reasoningEffort || reasoningEffort;
        const result = await invoke({
          providerId,
          modelId,
          modelProvider,
          request,
          signal,
          reasoningEffort: selectedReasoningEffort,
          ...selection,
        });
        if (result?.status !== "success" || !String(result?.text || "").trim()) {
          throw new TradingAnalysisModelProviderError(
            String(result?.error || "Trading analysis app-server turn failed"),
            {
              code: String(result?.code || (result?.status === "success" ? "TRADING_ANALYSIS_MODEL_EMPTY_RESPONSE" : "TRADING_ANALYSIS_APP_SERVER_FAILED")),
              providerId,
              modelId: selection.modelId,
              retryable: result?.status === "success" || result?.retryable !== false,
              status: result?.httpStatus,
              category: result?.category,
              requestId: request.requestId,
            },
          );
        }
        return {
          providerId,
          modelId: selection.modelId,
          text: result.text,
          latencyMs: Date.now() - startedAt,
          usage: result.usage || null,
          finishReason: result.finishReason || "completed",
          reasoningEffort: selectedReasoningEffort,
        };
      };
      const policy = recoverableReview ? options.selectModel?.(modelId) : null;
      const selectedModel = canonicalDeepSeekModel(policy?.modelId || modelId);
      const selection = recoverableReview && (selectedModel === ANALYSIS_RECOVERY_MODEL || canonicalDeepSeekModel(recoveryModel) === ANALYSIS_RECOVERY_MODEL || policy?.fallback)
        ? { modelId: ANALYSIS_RECOVERY_MODEL, modelProvider: ANALYSIS_RECOVERY_PROVIDER, reasoningEffort: ANALYSIS_RECOVERY_EFFORT }
        : { modelId: selectedModel, reasoningEffort: fixedReasoningEffort || reasoningEffort, ...(modelId === ANALYSIS_RECOVERY_MODEL && selectedModel === ANALYSIS_PRIMARY_MODEL ? { modelProvider: "haolo_ai" } : {}) };
      if (!recoverableReview) return operation(selection);
      return runWithAnalysisModelRecovery({
        operation, ...selection, signal,
        onRecovery: (event) => options.onRecovery?.({ ...event, requestId: request.requestId, snapshotId: request.snapshotId }),
        wait: options.waitForRecovery,
      });
    },
  });
}
