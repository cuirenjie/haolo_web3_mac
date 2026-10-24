import { TradingAnalysisModelProviderError } from "./model-provider.mjs";
import { runWithAnalysisModelRecovery } from "../analysis-model-recovery.mjs";
import { ANALYSIS_PRIMARY_MODEL, analysisModelPolicySelection } from "../analysis-model-policy.mjs";
import { canonicalDeepSeekModel } from "../deepseek-model-policy.mjs";
import { migrateRetiredModelSelection } from "../retired-model-policy.mjs";
import { displayModelAliasForSelection } from "../gpt6-sol-alias-policy.mjs";
import { createTradingModelBudget } from "./model-budget.mjs";

export const DEFAULT_TRADING_ANALYSIS_PROVIDER_ID = "openai-codex";
export const DEFAULT_TRADING_ANALYSIS_MODEL_ID = ANALYSIS_PRIMARY_MODEL;

export function createAppServerTradingAnalysisProvider(options = {}) {
  const invoke = options.invoke;
  if (typeof invoke !== "function") throw new TypeError("invoke is required");
  const providerId = String(options.providerId || DEFAULT_TRADING_ANALYSIS_PROVIDER_ID);
  const modelId = String(migrateRetiredModelSelection({ model: canonicalDeepSeekModel(options.modelId) }).model || DEFAULT_TRADING_ANALYSIS_MODEL_ID);
  const displayModelId = String(
    options.displayModelId || displayModelAliasForSelection(options.modelId) || "",
  ).trim();
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
    async analyze(request, { signal, reasoningEffort, recoveryModel, modelBudget = createTradingModelBudget() } = {}) {
      const startedAt = Date.now();
      // Routing and intent compilation are isolated model calls too. Their
      // validated tools/effects are still applied only by their caller.
      const recoverableReview = true;
      const operation = async (selection) => {
        const remainingModelTime = recoverableReview ? modelBudget.begin(selection.modelId) : undefined;
        remainingModelTime?.();
        const selectedReasoningEffort = selection.modelId === ANALYSIS_PRIMARY_MODEL
          ? "low" : fixedReasoningEffort || selection.reasoningEffort || reasoningEffort;
        const result = await invoke({
          providerId,
          modelId,
          modelProvider,
          request,
          signal,
          ...selection,
          reasoningEffort: selectedReasoningEffort,
          remainingModelTime,
        });
        if (signal?.aborted) throw signal.reason || new DOMException("Analysis cancelled", "AbortError");
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
        remainingModelTime?.();
        return {
          providerId,
          modelId: displayModelId || selection.modelId,
          text: result.text,
          latencyMs: Date.now() - startedAt,
          usage: result.usage || null,
          finishReason: result.finishReason || "completed",
          reasoningEffort: selectedReasoningEffort,
        };
      };
      const policy = recoverableReview ? options.selectModel?.(modelId) : null;
      const selectedModel = analysisModelPolicySelection(null, policy?.modelId || modelId).modelId;
      const selection = { modelId: selectedModel, reasoningEffort: fixedReasoningEffort || reasoningEffort,
        ...(selectedModel === ANALYSIS_PRIMARY_MODEL ? { modelProvider: "deepseek" } : {}) };
      return runWithAnalysisModelRecovery({
        operation, ...selection, signal,
        onRecovery: (event) => options.onRecovery?.({ ...event, requestId: request.requestId, snapshotId: request.snapshotId }),
        wait: options.waitForRecovery,
      });
    },
  });
}
