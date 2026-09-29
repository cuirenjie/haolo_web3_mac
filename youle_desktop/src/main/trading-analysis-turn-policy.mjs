import { ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT } from "./analysis-model-recovery.mjs";
import { TRADING_PRIMARY_MODEL_BUDGET_MS, TRADING_BACKUP_MODEL_BUDGET_MS } from "./trading-analysis/model-budget.mjs";

const ROUTING_TIMEOUT_MS = 30_000;
const ALERT_INTENT_IDLE_TIMEOUT_MS = 180_000;

const THEORY_REVIEW_EFFORTS = new Set(["medium", "high", "max"]);

export function tradingAnalysisTurnPolicy(taskValue, options = {}) {
  const task = String(taskValue || "");
  if (task.endsWith("-request-routing") || task === "trading-turn-intent-routing") {
    return Object.freeze({
      kind: "request_routing",
      reasoningEffort: "low",
      timeoutMs: ROUTING_TIMEOUT_MS,
      resetTimeoutOnActivity: false,
      timeoutRetryable: false,
      maxAttempts: 1,
    });
  }
  if (task === "trading_alert_intent_compile") {
    return Object.freeze({
      kind: "alert_intent",
      reasoningEffort: "medium",
      timeoutMs: ALERT_INTENT_IDLE_TIMEOUT_MS,
      resetTimeoutOnActivity: true,
      timeoutRetryable: true,
      maxAttempts: 2,
    });
  }
  const requestedReasoningEffort = String(options.requestedReasoningEffort || "").trim().toLowerCase();
  return Object.freeze({
    kind: "theory_review",
    reasoningEffort: options.modelId === ANALYSIS_RECOVERY_MODEL && requestedReasoningEffort === ANALYSIS_RECOVERY_EFFORT
      ? ANALYSIS_RECOVERY_EFFORT
      : THEORY_REVIEW_EFFORTS.has(requestedReasoningEffort)
      ? requestedReasoningEffort
      : "medium",
    timeoutMs: options.modelId === ANALYSIS_RECOVERY_MODEL
      ? TRADING_BACKUP_MODEL_BUDGET_MS : TRADING_PRIMARY_MODEL_BUDGET_MS,
    resetTimeoutOnActivity: false,
    timeoutRetryable: true,
    maxAttempts: 1,
  });
}
