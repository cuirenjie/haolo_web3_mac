import assert from "node:assert/strict";
import test from "node:test";
import { tradingAnalysisTurnPolicy } from "../src/main/trading-analysis-turn-policy.mjs";

test("alert intent timeout is activity-based and recoverable", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("trading_alert_intent_compile"), {
    kind: "alert_intent",
    reasoningEffort: "medium",
    timeoutMs: 180_000,
    resetTimeoutOnActivity: true,
    timeoutRetryable: true,
    maxAttempts: 2,
  });
});

test("small request routers remain hard-bounded", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("chan-request-routing"), {
    kind: "request_routing",
    reasoningEffort: "medium",
    timeoutMs: 60_000,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
    maxAttempts: 1,
  });
});

test("theory review fixes high effort behind a single hard-bounded attempt", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("trading_theory_review"), {
    kind: "theory_review",
    reasoningEffort: "high",
    timeoutMs: 180_000,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
    maxAttempts: 1,
  });
});
