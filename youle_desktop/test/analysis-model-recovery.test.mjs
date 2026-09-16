import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT, ANALYSIS_RECOVERY_PROVIDER,
  isRecoverableAnalysisModelFailure,
} from "../src/main/analysis-model-recovery.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runValidatedTradingModelReview } from "../src/main/trading-analysis/model-review.mjs";
import { HAOLO_REASONING_FIXED_EFFORT_FIELD, withAdaptiveTurnReasoning } from "../src/main/gpt-reasoning-effort.mjs";
import { tradingAnalysisTurnPolicy } from "../src/main/trading-analysis-turn-policy.mjs";

const request = Object.freeze({ schemaVersion: 1, requestId: "request-1", snapshotId: "snapshot-1", task: "wave-theory-review", theoryId: "elliott_wave", prompt: "ETH怎么看\nFROZEN_CANDLES_AND_ATTACHMENTS", responseFormat: "json" });
const overload = () => ({ status: "failed", error: "Selected model is at capacity. Please try a different model.", retryable: false });
const success = { status: "success", text: '{"valid":true}' };
const validateResponse = (text) => { const value = JSON.parse(text); assert.equal(value.valid, true); return value; };

test("capacity errors override runtime retryability, unknown and transient failures recover when not denied", () => {
  for (const failure of [
    { code: "server_is_overloaded", retryable: false },
    { error: { code: "slow_down" }, retryable: false },
    { cause: { message: overload().error }, retryable: false },
    { code: "TRADING_ANALYSIS_MODEL_FAILED" },
    { errorClass: "unknown", status: "failed" },
    { category: "stream_disconnected" },
    { httpStatus: 503 },
  ]) assert.equal(isRecoverableAnalysisModelFailure(failure, { allowUnknownTerminal: true }), true, JSON.stringify(failure));
});

test("hard failures take precedence over overload and transport labels", () => {
  for (const failure of [
    { code: "INVALID_API_KEY" }, { status: 403 }, { code: "INSUFFICIENT_BALANCE" },
    { category: "auth" }, { code: "CONTENT_FILTER" }, { code: "INVALID_REQUEST" },
    { code: "CONTEXT_LENGTH_EXCEEDED" }, { code: "TRADING_ANALYSIS_MODEL_SIDE_EFFECT_BLOCKED" },
    { effects: [{ type: "command" }] }, { status: "interrupted" }, { name: "AbortError" },
    { willRetry: true }, { code: "THREAD_HISTORY_MISSING" },
  ]) assert.equal(isRecoverableAnalysisModelFailure({ message: "at capacity", errorClass: "stream_disconnected", ...failure }), false, JSON.stringify(failure));
});

test("actual provider changes model and effort, retaining the identical request and snapshot", async () => {
  const calls = [], delays = [], events = [];
  const provider = createAppServerTradingAnalysisProvider({
    invoke: async (args) => { calls.push(args); return calls.length === 1 ? overload() : success; },
    waitForRecovery: async (ms) => delays.push(ms), onRecovery: (event) => events.push(event),
  });
  const result = await provider.analyze(request, { reasoningEffort: "medium" });
  assert.deepEqual(calls.map((c) => [c.modelId, c.reasoningEffort]), [["gpt-5.6-sol", "medium"], ["deepseek-flash", "max"]]);
  assert.equal(calls[1].modelProvider, "deepseek");
  assert.ok(calls.every((call) => call.request === request));
  assert.deepEqual(delays, [1500]);
  assert.equal(events[0].snapshotId, request.snapshotId);
  assert.equal(result.modelId, "deepseek-flash");
  assert.equal(result.reasoningEffort, "max");
  assert.equal(result.recovery.attempts, 1);
  const policy = tradingAnalysisTurnPolicy(request.task, { modelId: calls[1].modelId, requestedReasoningEffort: calls[1].reasoningEffort });
  const wire = withAdaptiveTurnReasoning("turn/start", { model: calls[1].modelId, input: [{ type: "text", text: "你好" }], effort: policy.reasoningEffort, [HAOLO_REASONING_FIXED_EFFORT_FIELD]: policy.reasoningEffort });
  assert.equal(wire.effort, "max");
  assert.equal(HAOLO_REASONING_FIXED_EFFORT_FIELD in wire, false);
});

test("two failed fallback calls end recovery without cycling back to the primary model", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({ invoke: async (args) => { calls.push(args); return overload(); }, waitForRecovery: async () => {} });
  await assert.rejects(provider.analyze(request), (error) => error.modelId === "deepseek-flash" && error.recovery.exhausted && error.recovery.attempts === 2);
  assert.deepEqual(calls.map((c) => c.modelId), ["gpt-5.6-sol", "deepseek-flash", "deepseek-flash"]);
});

test("hard failures and routing/alert tasks never enter analysis model fallback", async () => {
  for (const [task, response] of [
    [request.task, { status: "failed", code: "INVALID_API_KEY", error: "at capacity", httpStatus: 401 }],
    ["chan-request-routing", overload()], ["trading_alert_intent_compile", overload()],
  ]) {
    let calls = 0;
    const provider = createAppServerTradingAnalysisProvider({ invoke: async () => { calls++; return response; }, waitForRecovery: async () => assert.fail("must not wait") });
    await assert.rejects(provider.analyze({ ...request, task }));
    assert.equal(calls, 1);
  }
});

test("cancelling during backoff or after a late model result prevents recovery success", async () => {
  for (const duringWait of [true, false]) {
    const controller = new AbortController();
    let calls = 0;
    const provider = createAppServerTradingAnalysisProvider({
      invoke: async () => { calls++; if (!duringWait && calls === 2) controller.abort(); return calls === 1 ? overload() : success; },
      waitForRecovery: async () => { if (duringWait) controller.abort(); },
    });
    await assert.rejects(provider.analyze(request, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, duringWait ? 1 : 2);
  }
});

test("validation repair stays on DeepSeek V4.1 Flash max and retains original data after failover", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    invoke: async (args) => { calls.push(args); return calls.length === 1 ? overload() : calls.length === 2 ? { status: "success", text: "invalid JSON" } : success; },
    waitForRecovery: async () => {},
  });
  const result = await runValidatedTradingModelReview({ modelRegistry: createTradingAnalysisModelProviderRegistry([provider]), providerId: provider.providerId, request, validateResponse });
  assert.deepEqual(calls.map((c) => [c.modelId, c.reasoningEffort]), [["gpt-5.6-sol", "medium"], ["deepseek-flash", "max"], ["deepseek-flash", "max"]]);
  assert.ok(calls.every((c) => c.request.snapshotId === request.snapshotId && c.request.prompt.startsWith(request.prompt)));
  assert.equal(calls[2].modelProvider, "deepseek");
  assert.equal(result.reasoningEffort, "max");
  assert.deepEqual(result.attempts.map((a) => a.effort), ["max", "max"]);
});

test("empty fallback responses cannot reset the recovery budget through validation repair", async () => {
  let calls = 0;
  const provider = createAppServerTradingAnalysisProvider({ invoke: async () => { calls++; return { status: "success", text: "" }; }, waitForRecovery: async () => {} });
  await assert.rejects(runValidatedTradingModelReview({ modelRegistry: createTradingAnalysisModelProviderRegistry([provider]), providerId: provider.providerId, request, validateResponse }), (error) => error.recovery.exhausted && error.attempts[0].effort === "max");
  assert.equal(calls, 3);
});

const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
function recoveryEntry(overrides = {}) {
  const source = main.slice(main.indexOf("async function startAutomaticTurnRecovery("), main.indexOf("function handleClientNotification("));
  const calls = [], released = [], active = [];
  const deps = {
    appShuttingDown: false, appCleanupStarted: false,
    acquireSerializedThreadSettingsOperation: async () => () => released.push(true),
    activeCodexTurnsByThread: new Map(), pendingCodexTurnThreadIds: new Set(),
    rootRecoveryModelsByThread: new Map(),
    getClientForThread: () => ({ __youleWorkspaceCwd: "workspace" }), currentSkillsCwd: "workspace", desktopWorkspace: () => "workspace",
    rememberThreadClient() {}, rememberPendingCodexTurnThread() {}, forgetPendingCodexTurnThread() {},
    rememberActiveCodexTurn: (...args) => active.push(args),
    requestAppServer: async (_client, method, params) => { calls.push([method, withAdaptiveTurnReasoning(method, params)]); return { turn: { id: "recovery-turn" } }; },
    resumeThreadForRequestedProvider: async ({ serverClient, threadId, targetSettings }) => deps.requestAppServer(serverClient, "thread/resume", { threadId, ...targetSettings }),
    ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT, ANALYSIS_RECOVERY_PROVIDER, HAOLO_REASONING_FIXED_EFFORT_FIELD,
    ...overrides,
  };
  return { start: new Function(...Object.keys(deps), `${source}; return startAutomaticTurnRecovery;`)(...Object.values(deps)), calls, released, active };
}

test("production root recovery RPC resumes the same thread and sends fixed max on the wire", async () => {
  const harness = recoveryEntry();
  await harness.start({ threadId: "existing-thread", prompt: "continue retained progress" });
  assert.deepEqual(harness.calls.map(([method]) => method), ["thread/resume", "turn/start"]);
  assert.deepEqual(harness.calls[0][1], { threadId: "existing-thread", model: "deepseek-flash", modelProvider: "deepseek", effort: "max", serviceTier: null });
  assert.equal(harness.calls[1][1].threadId, "existing-thread");
  assert.equal(harness.calls[1][1].model, "deepseek-flash");
  assert.equal(harness.calls[1][1].effort, "max");
  assert.equal(harness.calls[1][1].input[0].text, "continue retained progress");
  assert.equal(harness.released.length, 1);
});

test("production media recovery RPC retains the GPT provider, effort and original thread", async () => {
  const harness = recoveryEntry();
  await harness.start({ threadId: "existing-media", prompt: "continue retained media job", modelId: "gpt-5.6-sol", modelProvider: "haolo_ai", reasoningEffort: "high" });
  assert.deepEqual(harness.calls[0], ["thread/resume", { threadId: "existing-media", model: "gpt-5.6-sol", modelProvider: "haolo_ai", effort: "high", serviceTier: null }]);
  const [method, params] = harness.calls[1];
  assert.equal(method, "turn/start");
  assert.equal(params.threadId, "existing-media");
  assert.equal(params.model, "gpt-5.6-sol");
  assert.equal(params.effort, "high");
  assert.equal(params.input[0].text, "continue retained media job");
  assert.equal(HAOLO_REASONING_FIXED_EFFORT_FIELD in params, false);
  assert.equal(harness.calls.length, 2);
});

test("production root recovery cannot start after cancellation during resume", async () => {
  const calls = [];
  let current = true;
  const harness = recoveryEntry({ requestAppServer: async (_client, method) => { calls.push(method); current = false; return {}; } });
  await assert.rejects(harness.start({ threadId: "t", prompt: "continue", isCurrent: () => current }), { name: "AbortError" });
  assert.deepEqual(calls, ["thread/resume"]);
  assert.equal(harness.released.length, 1);
});

test("production root recovery interrupts its own late-started turn after cancellation", async () => {
  const calls = [];
  let current = true;
  const harness = recoveryEntry({ requestAppServer: async (_client, method, params) => {
    calls.push([method, params]);
    if (method === "turn/start") current = false;
    return { turn: { id: "late-turn" } };
  } });
  await assert.rejects(harness.start({ threadId: "t", prompt: "continue", isCurrent: () => current }), { name: "AbortError" });
  assert.deepEqual(calls.map(([method]) => method), ["thread/resume", "turn/start", "turn/interrupt"]);
  assert.deepEqual(calls[2][1], { threadId: "t", turnId: "late-turn" });
  assert.equal(harness.active.length, 0);
});

function reviewEntry(overrides = {}) {
  const source = main.slice(main.indexOf("async function invokeTradingAnalysisAppServer("), main.indexOf("async function notifyTradingAlertTriggered("));
  const starts = [], turns = [], cleanup = [];
  const deps = {
    desktopWorkspace: () => "workspace", getClientForCwd: () => ({}), tradingAnalysisTurnPolicy,
    requestWorkflowInternalThreadStart: async (_client, params) => { starts.push(params); return { thread: { id: `internal-${starts.length}` } }; },
    threadConfigurationParams: (params, extra) => ({ ...params, ...extra }),
    rememberThreadClient() {}, tradingAnalysisAbortError: () => new DOMException("Cancelled", "AbortError"),
    runWorkflowCodexNodeTurnWithRecovery: async (params) => {
      turns.push(params);
      return turns.length === 1 ? { status: "failed", error: overload().error, retryable: false, turnFinished: true } : { ...success, turnFinished: true };
    },
    scheduleWorkflowInternalCodexCleanup: async (params) => { cleanup.push(params); return { deleted: true }; },
    workflowCodexFailureClass: () => "unknown", console: { info() {}, warn() {} },
    ...overrides,
  };
  return { invoke: new Function(...Object.keys(deps), `${source}; return invokeTradingAnalysisAppServer;`)(...Object.values(deps)), starts, turns, cleanup };
}

test("production review wiring completes cleanup before fallback and preserves read-only isolation", async () => {
  let finishCleanup, cleanupStarted;
  const ready = new Promise((resolve) => { cleanupStarted = resolve; });
  let cleanupCalls = 0;
  const harness = reviewEntry({ scheduleWorkflowInternalCodexCleanup: async () => {
    if (++cleanupCalls > 1) return { deleted: true };
    cleanupStarted();
    return new Promise((resolve) => { finishCleanup = resolve; });
  } });
  const provider = createAppServerTradingAnalysisProvider({ invoke: harness.invoke, waitForRecovery: async () => {} });
  const pending = provider.analyze(request, { reasoningEffort: "medium" });
  await ready;
  assert.equal(harness.starts.length, 1);
  finishCleanup({ deleted: true });
  const result = await pending;
  assert.equal(result.modelId, "deepseek-flash");
  assert.equal(harness.starts.length, 2);
  assert.equal(cleanupCalls, 2);
  assert.ok(harness.starts.every((start) => start.ephemeral && start.sandboxPolicy === "read-only" && start.approvalPolicy === "never"));
  assert.ok(harness.turns.every((turn) => turn.maxAttempts === 1 && turn.initialPrompt === request.prompt));
  assert.equal(harness.turns[1].model, "deepseek-flash");
  assert.equal(harness.turns[1].fixedEffort, "max");
});

test("production review cannot replay a side effect or overlap an unconfirmed old turn", async () => {
  for (const sideEffect of [true, false]) {
    let calls = 0;
    const harness = reviewEntry({
      runWorkflowCodexNodeTurnWithRecovery: async () => {
        calls++;
        return { status: "failed", error: overload().error, turnFinished: sideEffect, effects: sideEffect ? [{ id: "unexpected-effect" }] : [] };
      },
      scheduleWorkflowInternalCodexCleanup: async () => ({ deleted: sideEffect, interrupted: false }),
    });
    const provider = createAppServerTradingAnalysisProvider({ invoke: harness.invoke, waitForRecovery: async () => assert.fail("unsafe retry") });
    await assert.rejects(provider.analyze(request), { code: sideEffect ? "TRADING_ANALYSIS_MODEL_SIDE_EFFECT_BLOCKED" : "TRADING_ANALYSIS_CLEANUP_INCOMPLETE" });
    assert.equal(calls, 1);
  }
});

test("runtime-cancelled reviews remain cancelled even without a caller abort signal", async () => {
  const harness = reviewEntry({ runWorkflowCodexNodeTurnWithRecovery: async () => ({ status: "cancelled", turnFinished: true }) });
  const provider = createAppServerTradingAnalysisProvider({ invoke: harness.invoke, waitForRecovery: async () => assert.fail("cancelled review must not retry") });
  await assert.rejects(provider.analyze(request), { name: "AbortError" });
  assert.equal(harness.starts.length, 1);
});
