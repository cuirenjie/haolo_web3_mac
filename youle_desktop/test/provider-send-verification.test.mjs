import assert from "node:assert/strict";
import test from "node:test";
import { createProviderSendHost } from "./helpers/provider-send-host.mjs";
import { withAnalysisModelRecoveryPolicy, ANALYSIS_RECOVERY_WINDOW_MS } from "../src/main/analysis-model-policy.mjs";
import { isRecoverableAnalysisModelFailure } from "../src/main/analysis-model-recovery.mjs";
import { describeTradingAnalysisFailure } from "../src/main/trading-analysis/failure.mjs";

const activatedAt = 1_800_000_000_000;
const state = { version: 1, activatedAt, fallbackUntil: activatedAt + ANALYSIS_RECOVERY_WINDOW_MS };

for (const [label, initial, model, target, now] of [
  ["expired fallback", "deepseek", "deepseek-flash", "haolo_ai", state.fallbackUntil],
  ["active fallback", "haolo_ai", "gpt-5.6-sol", "deepseek", activatedAt],
]) test(`real send handler verifies ${label} before starting the turn and preserves host configuration`, async () => {
  const calls = [];
  let provider = initial, restarts = 0;
  const host = createProviderSendHost({ state, now, stop: () => { restarts++; }, request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { modelProvider: provider, turns: [] } };
    // Simulate the native systemError case: unsubscribe alone cannot switch it.
    if (method === "thread/resume") {
      if (restarts) provider = params.modelProvider;
      return { modelProvider: provider };
    }
    if (method === "turn/start") {
      assert.equal(provider, target);
      assert.equal(params.model, target === "deepseek" ? "deepseek-flash" : "gpt-5.6-sol");
      if (target === "deepseek") assert.equal(params.effort, "max");
      return { turn: { id: "turn" } };
    }
  } });
  await host.send({ threadId: "same-task", model, text: "continue the original task", approvalPolicy: "never", sandbox: "read-only" });
  assert.equal(restarts, 1);
  const resumes = calls.filter((c) => c.method === "thread/resume");
  assert.equal(resumes.length, 3);
  for (const { params } of resumes) {
    assert.equal(params.threadId, "same-task");
    assert.equal(params.developerInstructions, "preserved host instructions");
    assert.equal(params.approvalPolicy, "never");
    assert.equal(params.sandbox, "read-only");
  }
  assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
});

for (const scenario of ["unknown provider", "still mismatched", "busy runtime", "unmaterialized mismatch"]) {
  test(`send fails closed without model traffic for ${scenario}`, async () => {
    let turns = 0, stops = 0;
    const host = createProviderSendHost({ stop: () => { stops++; }, request: async (method) => {
      if (method === "turn/start") { turns++; return {}; }
      if (scenario === "unmaterialized mismatch" && method === "thread/resume") throw new Error("no rollout found for thread id same-task");
      return scenario === "unknown provider" ? { model: "gpt-5.6-sol" } : { modelProvider: "deepseek" };
    } });
    if (scenario === "busy runtime") {
      host.client.activeRuntimeTurns = new Map([["hidden-analysis", "turn"]]);
    }
    await assert.rejects(host.send({ threadId: "same-task", model: "gpt-5.6-sol", text: "hello" }), (error) => {
      assert.ok(["THREAD_PROVIDER_MISMATCH", "PROVIDER_SWITCH_RUNTIME_BUSY"].includes(error.code));
      assert.equal(isRecoverableAnalysisModelFailure(error), false);
      return true;
    });
    assert.equal(turns, 0);
    assert.equal(host.pending.size, 0);
    if (["busy runtime", "unmaterialized mismatch"].includes(scenario)) assert.equal(stops, 0);
  });
}

test("fresh in-memory task verifies provider through metadata before its first turn", async () => {
  const calls = [];
  const host = createProviderSendHost({ request: async (method) => {
    calls.push(method);
    if (method === "thread/resume") throw new Error("no rollout found for thread id fresh");
    if (method === "thread/read") return { thread: { modelProvider: "haolo_ai" } };
    return { turn: { id: "first" } };
  } });
  await host.send({ threadId: "fresh", text: "hello" });
  assert.deepEqual(calls, ["thread/resume", "thread/read", "turn/start"]);
});

test("expired policy clears stale provider and DeepSeek reasoning even when the picker already displays Sol", () => {
  for (const providerKey of ["modelProvider", "model_provider"]) {
    const restored = withAnalysisModelRecoveryPolicy({ model: "gpt-5.6-sol", [providerKey]: "deepseek", reasoningEffort: "max", reasoningEffortPolicy: "fixed" }, state, state.fallbackUntil);
    assert.equal(restored.modelProvider, "haolo_ai");
    assert.equal(restored.model_provider, undefined);
    assert.equal(restored.reasoningEffort, undefined);
  }
});

test("an existing automation uses the same provider verification without losing its sandbox or instructions", async () => {
  let provider = "deepseek", detached = false;
  const calls = [];
  const host = createProviderSendHost({ request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/unsubscribe") detached = true;
    if (method === "thread/resume" && detached) provider = params.modelProvider;
    return { modelProvider: provider };
  } });
  await host.resumeAutomationThread({ threadId: "scheduled", workspacePath: "workspace", developerInstructions: "frozen automation instructions",
    job: { model: "gpt-5.6-sol", sandboxMode: "read-only", reasoningEffort: "high" }, serverClient: host.client });
  assert.equal(provider, "haolo_ai");
  assert.equal(calls.at(-1).params.developerInstructions, "frozen automation instructions");
  assert.equal(calls.at(-1).params.sandbox, "read-only");
  assert.equal(calls.at(-1).params.config.model_reasoning_effort, "high");
});

test("native wrapped 403 and route denials cannot become a successful local analysis fallback", () => {
  for (const error of [
    new Error('unexpected status 403 Forbidden: {"error":{"code":"PERMISSION_DENIED","category":"policy","retryable":false}}'),
    { message: "stream disconnected", cause: { error: { code: "MODEL_ROUTE_GROUP_MISMATCH", category: "policy" } } },
    { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } } },
    { code: "THREAD_PROVIDER_MISMATCH", category: "policy", retryable: false },
    // Electron/WS wrappers may preserve only the error text.
    new Error("Thread provider switch was not applied (expected haolo_ai, received deepseek)."),
    new Error("Provider recovery is waiting for other active runtime operations to finish."),
    new Error('model "gpt-5.6-sol" is enabled for execution, but the API key is not bound to its route group'),
  ]) {
    const failure = describeTradingAnalysisFailure(error);
    assert.equal(failure.allowLocalRecovery, false);
    assert.equal(isRecoverableAnalysisModelFailure(error), false);
    assert.ok(["policy", "authentication"].includes(failure.category));
  }
  assert.equal(describeTradingAnalysisFailure(new Error("HTTP 503 service unavailable")).allowLocalRecovery, true);
});
