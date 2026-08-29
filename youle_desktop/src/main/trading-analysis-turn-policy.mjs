const ROUTING_TIMEOUT_MS = 60_000;
const ALERT_INTENT_IDLE_TIMEOUT_MS = 180_000;
const THEORY_REVIEW_IDLE_TIMEOUT_MS = 180_000;

export function tradingAnalysisTurnPolicy(taskValue) {
  const task = String(taskValue || "");
  if (task.endsWith("-request-routing")) {
    return Object.freeze({
      kind: "request_routing",
      reasoningEffort: "medium",
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
  return Object.freeze({
    kind: "theory_review",
    reasoningEffort: "high",
    timeoutMs: THEORY_REVIEW_IDLE_TIMEOUT_MS,
    resetTimeoutOnActivity: true,
    timeoutRetryable: true,
  });
}
