const ROUTING_TIMEOUT_MS = 60_000;
const ALERT_INTENT_IDLE_TIMEOUT_MS = 180_000;
// Theory review is an interactive analysis request. Keep this as a wall-clock
// budget: active reasoning must not extend the user's wait indefinitely.
const THEORY_REVIEW_TIMEOUT_MS = 180_000;

const THEORY_REVIEW_EFFORTS = new Set(["medium", "high", "max"]);

export function tradingAnalysisTurnPolicy(taskValue, options = {}) {
  const task = String(taskValue || "");
  if (task.endsWith("-request-routing")) {
    return Object.freeze({
      kind: "request_routing",
      reasoningEffort: "medium",
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
    reasoningEffort: THEORY_REVIEW_EFFORTS.has(requestedReasoningEffort)
      ? requestedReasoningEffort
      : requestedReasoningEffort
        ? "medium"
        : "high",
    timeoutMs: THEORY_REVIEW_TIMEOUT_MS,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
    maxAttempts: 1,
  });
}
