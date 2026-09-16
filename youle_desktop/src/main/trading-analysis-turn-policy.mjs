import { ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT } from "./analysis-model-recovery.mjs";

const ROUTING_TIMEOUT_MS = 30_000;
const ALERT_INTENT_IDLE_TIMEOUT_MS = 180_000;
const THEORY_REVIEW_IDLE_TIMEOUT_MS = 180_000;

const THEORY_REVIEW_EFFORTS = new Set(["medium", "high", "max"]);

export function tradingAnalysisTurnPolicy(taskValue, options = {}) {
  const task = String(taskValue || "");
  if (task.endsWith("-request-routing")) {
    return Object.freeze({
      kind: "request_routing",
      reasoningEffort: "low",
      timeoutMs: ROUTING_TIMEOUT_MS,
      resetTimeoutOnActivity: false,
      timeoutRetryable: false,
    });
  }
  if (task === "trading_alert_intent_compile") {
    return Object.freeze({
      kind: "alert_intent",
      reasoningEffort: "medium",
      timeoutMs: ALERT_INTENT_IDLE_TIMEOUT_MS,
      resetTimeoutOnActivity: true,
      timeoutRetryable: true,
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
    timeoutMs: THEORY_REVIEW_IDLE_TIMEOUT_MS,
    resetTimeoutOnActivity: true,
    timeoutRetryable: true,
  });
}
