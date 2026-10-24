import assert from "node:assert/strict";
import test from "node:test";
import { tradingAnalysisTurnPolicy } from "../src/main/trading-analysis-turn-policy.mjs";

test("alert intent uses a bounded long DeepSeek request", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("trading_alert_intent_compile"), {
    kind: "alert_intent",
    reasoningEffort: "low",
    timeoutMs: 900_000,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
  });
});

test("small request routers use low reasoning and remain hard-bounded", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("chan-request-routing"), {
    kind: "request_routing",
    reasoningEffort: "low",
    timeoutMs: 900_000,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
  });
});

test("theory review uses the long low-effort policy", () => {
  assert.deepEqual(tradingAnalysisTurnPolicy("trading_theory_review"), {
    kind: "theory_review",
    reasoningEffort: "low",
    timeoutMs: 900_000,
    resetTimeoutOnActivity: false,
    timeoutRetryable: false,
  });
});

test("DeepSeek reviews and repairs cannot escalate above low", () => {
  assert.equal(tradingAnalysisTurnPolicy("wave-theory-review", {
    requestedReasoningEffort: "high",
  }).reasoningEffort, "low");
  assert.equal(tradingAnalysisTurnPolicy("wave-theory-review", {
    requestedReasoningEffort: "max",
  }).reasoningEffort, "low");
  assert.equal(tradingAnalysisTurnPolicy("wave-theory-review", {
    requestedReasoningEffort: "ultra",
  }).reasoningEffort, "low");
  assert.equal(tradingAnalysisTurnPolicy("chan-request-routing", {
    requestedReasoningEffort: "max",
  }).reasoningEffort, "low");
  assert.equal(tradingAnalysisTurnPolicy("trading_alert_intent_compile", {
    requestedReasoningEffort: "max",
  }).reasoningEffort, "low");
});
