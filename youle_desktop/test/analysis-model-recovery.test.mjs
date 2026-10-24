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
import { assertThreadProvider } from "../src/main/thread-provider-switch.mjs";
import { tradingAnalysisModelDiagnostic } from "../src/main/trading-analysis/diagnostics.mjs";

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

test('provider failure stops after the original frozen DeepSeek call',async()=>{
 const calls=[],events=[];const provider=createAppServerTradingAnalysisProvider({invoke:async args=>{calls.push(args);return overload()},onRecovery:e=>events.push(e)});
 await assert.rejects(provider.analyze(request,{reasoningEffort:'medium'}));
 assert.equal(calls.length,1);assert.equal(calls[0].modelId,'deepseek-flash');assert.equal(calls[0].modelProvider,'deepseek');assert.equal(calls[0].request,request);assert.deepEqual(events,[]);
});

test('transient failure never invokes another provider',async()=>{
 const calls=[];const provider=createAppServerTradingAnalysisProvider({invoke:async args=>{calls.push(args);return overload()}});
 await assert.rejects(provider.analyze(request),e=>e.modelId==='deepseek-flash'&&!e.recovery);
 assert.equal(calls.length,1);
});

test('account failures, routing, and alert compilation all stop without GPT',async()=>{
 for(const task of [request.task,'chan-request-routing','trading_alert_intent_compile']){
  let calls=0;const provider=createAppServerTradingAnalysisProvider({invoke:async()=>{calls++;return overload()}});
  await assert.rejects(provider.analyze({...request,task}));assert.equal(calls,1);
 }
});

test('cancellation rejects both late success and late failure',async()=>{
 for(const response of [success,overload()]){
  const c=new AbortController();let calls=0;const provider=createAppServerTradingAnalysisProvider({invoke:async()=>{calls++;c.abort();return response}});
  await assert.rejects(provider.analyze(request,{signal:c.signal}),{name:'AbortError'});assert.equal(calls,1);
 }
});

test('schema repair retains DeepSeek and frozen market data',async()=>{
 const calls=[];const provider=createAppServerTradingAnalysisProvider({invoke:async args=>{calls.push(args);return calls.length===1?{status:'success',text:'invalid JSON'}:success}});
 const result=await runValidatedTradingModelReview({modelRegistry:createTradingAnalysisModelProviderRegistry([provider]),providerId:provider.providerId,request,validateResponse});
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.modelId==='deepseek-flash'&&c.modelProvider==='deepseek'&&c.request.snapshotId===request.snapshotId&&c.request.prompt.startsWith(request.prompt)));
 assert.equal(result.modelResponse.modelId,'deepseek-flash');
});

test('empty response exhausts bounded same-model schema repair',async()=>{
 let calls=0;const provider=createAppServerTradingAnalysisProvider({invoke:async args=>{calls++;assert.equal(args.modelId,'deepseek-flash');return {status:'success',text:''}}});
 await assert.rejects(runValidatedTradingModelReview({modelRegistry:createTradingAnalysisModelProviderRegistry([provider]),providerId:provider.providerId,request,validateResponse}));assert.equal(calls,3);
});

const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
function recoveryEntry(overrides = {}) {
  const source = main.slice(main.indexOf("async function startAutomaticTurnRecovery("), main.indexOf("function handleClientNotification("));
  const calls = [], released = [], active = [], business = [];
  const deps = {
    appShuttingDown: false, appCleanupStarted: false,
    acquireSerializedThreadSettingsOperation: async () => () => released.push(true),
    activeCodexTurnsByThread: new Map(), pendingCodexTurnThreadIds: new Set(),
    rootRecoveryModelsByThread: new Map(),
    codexBusinessTools: {
      resume: id => business.push(["resume", id]),
      input: (id, text) => { business.push(["input", id]); return text; },
    },
    getClientForThread: () => ({ __youleWorkspaceCwd: "workspace" }), currentSkillsCwd: "workspace", desktopWorkspace: () => "workspace",
    rememberThreadClient() {}, rememberPendingCodexTurnThread() {}, forgetPendingCodexTurnThread() {},
    rememberActiveCodexTurn: (...args) => active.push(args),
    requestAppServer: async (_client, method, params) => { calls.push([method, withAdaptiveTurnReasoning(method, params)]); return { turn: { id: "recovery-turn" } }; },
    resumeThreadForRequestedProvider: async ({ serverClient, threadId, targetSettings }) => deps.requestAppServer(serverClient, "thread/resume", { threadId, ...targetSettings }),
    ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT, ANALYSIS_RECOVERY_PROVIDER, HAOLO_REASONING_FIXED_EFFORT_FIELD,
    ...overrides,
  };
  return { start: new Function(...Object.keys(deps), `${source}; return startAutomaticTurnRecovery;`)(...Object.values(deps)), calls, released, active, business };
}

test("production root recovery RPC resumes the same thread and sends fixed high on the wire", async () => {
  const harness = recoveryEntry();
  await harness.start({ threadId: "existing-thread", prompt: "continue retained progress" });
  assert.deepEqual(harness.calls.map(([method]) => method), ["thread/resume", "turn/start"]);
  assert.deepEqual(harness.calls[0][1], { threadId: "existing-thread", model: "gpt-5.6-sol", modelProvider: "haolo_ai", effort: "high", serviceTier: null });
  assert.equal(harness.calls[1][1].threadId, "existing-thread");
  assert.equal(harness.calls[1][1].model, "gpt-5.6-sol");
  assert.equal(harness.calls[1][1].effort, "high");
  assert.equal(harness.calls[1][1].input[0].text, "continue retained progress");
  assert.equal(harness.released.length, 1);
  assert.deepEqual(harness.business, [["resume", "existing-thread"], ["input", "existing-thread"]]);
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
    tradingAnalysisModelDiagnostic,
    requestWorkflowInternalThreadStart: async (_client, params) => { starts.push(params); return { thread: { id: `internal-${starts.length}` }, modelProvider: params.modelProvider || "haolo_ai" }; },
    assertThreadProvider,
    executionProviderSelection: (params) => ({ modelProvider: params.modelProvider || "haolo_ai" }),
    threadModelProviderFromResumeResult: (result) => result.modelProvider,
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

test('production review cleans up its only DeepSeek call before returning failure',async()=>{
 const harness=reviewEntry();const provider=createAppServerTradingAnalysisProvider({invoke:harness.invoke});
 await assert.rejects(provider.analyze(request,{reasoningEffort:'medium'}));
 assert.equal(harness.starts.length,1);assert.equal(harness.cleanup.length,1);assert.equal(harness.turns[0].model,'deepseek-flash');
 assert.ok(harness.starts[0].ephemeral&&harness.starts[0].sandboxPolicy==='read-only'&&harness.starts[0].approvalPolicy==='never');
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

test("production review rejects an unconfirmed provider before model dispatch and still cleans up its temporary thread", async () => {
  const harness = reviewEntry({ requestWorkflowInternalThreadStart: async () => ({ thread: { id: "wrong-provider" }, modelProvider: "deepseek" }) });
  await assert.rejects(harness.invoke({ modelId: "gpt-5.6-sol", request, reasoningEffort: "medium" }), { code: "THREAD_PROVIDER_MISMATCH" });
  assert.equal(harness.turns.length, 0);
  assert.equal(harness.cleanup.length, 1);
  assert.equal(harness.cleanup[0].threadId, "wrong-provider");
});

test("runtime-cancelled reviews remain cancelled even without a caller abort signal", async () => {
  const harness = reviewEntry({ runWorkflowCodexNodeTurnWithRecovery: async () => ({ status: "cancelled", turnFinished: true }) });
  const provider = createAppServerTradingAnalysisProvider({ invoke: harness.invoke, waitForRecovery: async () => assert.fail("cancelled review must not retry") });
  await assert.rejects(provider.analyze(request), { name: "AbortError" });
  assert.equal(harness.starts.length, 1);
});

test("production model diagnostics record success, HTTP failures and actual remaining deadlines accurately", async () => {
  for (const outcome of [
    { status: "success", text: "PRIVATE_RESPONSE" },
    { status: "failed", error: "PRIVATE_UPSTREAM", errorCode: "CODEX_TURN_FAILED", httpStatus: 503, retryable: true },
    Object.assign(new Error("PRIVATE_TIMEOUT"), { code: "WORKFLOW_TURN_TIMEOUT", category: "timeout", retryable: true }),
  ]) {
    const events = [];
    const harness = reviewEntry({
      recordTurnDiagnostic: (event, detail) => events.push({ event, detail }),
      runWorkflowCodexNodeTurnWithRecovery: async () => {
        if (outcome instanceof Error) throw outcome;
        return { ...outcome, turnFinished: true };
      },
    });
    const pending = harness.invoke({ modelId: "deepseek-flash", request, reasoningEffort: "high", remainingModelTime: () => 56_982 });
    if (outcome instanceof Error) await assert.rejects(pending, (error) => error === outcome);
    else await pending;
    assert.equal(events.length, 1);
    const { detail } = events[0];
    assert.equal(detail.timeoutMs, 56_982);
    assert.equal(detail.reasoningEffort, "low");
    assert.equal(detail.model, "deepseek-flash");
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|FROZEN_CANDLES/);
    if (outcome.status === "success") {
      assert.equal(detail.status, "success");
      assert.equal(detail.errorClass, null);
      assert.equal(detail.detail, null);
    } else {
      assert.equal(detail.status, "failed");
      assert.equal(detail.errorClass, outcome instanceof Error ? "timeout" : "transport");
      assert.equal(detail.httpStatus, outcome.httpStatus || null);
    }
  }
});
