import { assertThreadProvider } from "../src/main/thread-provider-switch.mjs";
import { createProviderSendHost } from "./helpers/provider-send-host.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tradingAnalysisTurnPolicy } from "../src/main/trading-analysis-turn-policy.mjs";
import { isRetryableModelTransportError } from "../src/main/model-transport-recovery.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { createTradingModelBudget } from "../src/main/trading-analysis/model-budget.mjs";

const main = readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const recoverySource = main.slice(main.indexOf("async function runWorkflowCodexNodeTurnWithRecovery("), main.indexOf("function scheduleWorkflowInternalCodexCleanup("));
const invokeSource = main.slice(main.indexOf("async function invokeTradingAnalysisAppServer("), main.indexOf("async function notifyTradingAlertTriggered("));
const providerHelpers = createProviderSendHost({ request: async () => ({}) });
const request = { task: "wave-theory-review", requestId: "review", snapshotId: "frozen", prompt: "Frozen market facts" };

function harness(firstResult, { timeout = false, alwaysFail = false } = {}) {
  const starts = [], turns = [], captures = [], cleaned = [], waits = [], events = [];
  const deps = {
    assertThreadProvider, executionProviderSelection: providerHelpers.executionProviderSelection,
    threadModelProviderFromResumeResult: providerHelpers.threadModelProviderFromResumeResult,
    desktopWorkspace: () => "fixture-workspace", getClientForCwd: () => ({}), tradingAnalysisTurnPolicy,
    requestWorkflowInternalThreadStart: async (_client, params) => {
      const id = `review-${starts.length + 1}`;
      starts.push(params); events.push(`start:${id}`);
      return { thread: { id }, modelProvider: params.modelProvider || "haolo_ai" };
    },
    threadConfigurationParams: (params, extra) => ({ ...params, ...extra }),
    rememberThreadClient() {}, tradingAnalysisAbortError: () => new DOMException("Cancelled", "AbortError"),
    captureWorkflowCodexTurn(_client, _thread, options) {
      captures.push(options);
      const failed = alwaysFail || captures.length === 1;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      return { promise, dispose() {}, expectTurn() {
        if (failed && timeout) reject(Object.assign(new Error("Review timed out"), {
          code: "WORKFLOW_TURN_TIMEOUT", category: "timeout", retryable: options.timeoutRetryable,
        }));
        else resolve(failed ? firstResult : { status: "success", text: "Verified report", effects: [] });
      } };
    },
    requestAppServer: async (_client, method, params) => {
      if (method === "turn/start") {
        turns.push(params);
        return { turn: { id: `turn-${turns.length}` } };
      }
      assert.equal(method, "turn/interrupt");
      return {};
    },
    scheduleWorkflowInternalCodexCleanup: async (params) => {
      cleaned.push(params); events.push(`clean:${params.threadId}`); return { deleted: true, interrupted: true };
    },
    interruptWorkflowCodexTurn: async ({ threadId, turnId, interruptTurn }) => {
      await interruptTurn({ threadId, turnId }); return { interrupted: true };
    },
    HAOLO_REASONING_FIXED_EFFORT_FIELD: "fixedEffort", normalizeSandboxPolicy: (value) => value,
    firstString: (...values) => values.find((value) => typeof value === "string" && value.trim()) || "",
    workflowInternalTurnIds: new Set(), workflowManagedVisibleTurnIds: new Set(),
    workflowCodexFailureClass: () => "unknown", isRetryableModelTransportError,
    console: { info() {}, warn() {} },
  };
  const invoke = new Function(...Object.keys(deps), `${recoverySource}\n${invokeSource}\nreturn invokeTradingAnalysisAppServer;`)(...Object.values(deps));
  const provider = createAppServerTradingAnalysisProvider({ invoke, waitForRecovery: async (ms) => waits.push(ms) });
  return { provider, starts, turns, captures, cleaned, waits, events };
}

for (const [name, failure, options] of [
  ["stream disconnect", { status: "failed", error: "stream disconnected", errorCode: "stream_disconnected", retryable: true }],
  ["HTTP 503", { status: "failed", error: "Service unavailable", httpStatus: 503, retryable: true }],
  ["wall-clock timeout", null, { timeout: true }],
]) test(`Mac bounded review returns ${name} once and cleans its thread without GPT replay`, async () => {
  const h = harness(failure, options);
  await assert.rejects(h.provider.analyze(request, {
    reasoningEffort: "medium", modelBudget: createTradingModelBudget({ now: () => 0 }),
  }));
  assert.deepEqual(h.starts.map(entry => entry.model), ["deepseek-flash"]);
  assert.equal(h.starts[0].modelProvider, "deepseek");
  assert.equal(h.turns[0].fixedEffort, "low");
  assert.equal(h.turns.length, 1);
  assert.equal(h.turns[0].input[0].text, request.prompt);
  assert.equal(h.turns[0].sandboxPolicy, "read-only");
  assert.deepEqual(h.captures.map(entry => entry.timeoutMs), [900_000]);
  assert.equal(h.captures[0].resetTimeoutOnActivity, false);
  assert.deepEqual(h.events, ["start:review-1", "clean:review-1"]);
  assert.equal(h.waits.length, 0);
});

test("Mac review cannot enter unbounded workflow transport retries", async () => {
  const h = harness({ status: "failed", error: "stream disconnected", errorCode: "stream_disconnected", retryable: true }, { alwaysFail: true });
  await assert.rejects(h.provider.analyze(request));
  assert.deepEqual(h.starts.map(entry => entry.model), ["deepseek-flash"]);
  assert.equal(h.turns.length, 1);
  assert.equal(h.cleaned.length, 1);
  assert.equal(h.waits.length, 0);
});

for (const [name, result] of [
  ["permission failure", { status: "failed", error: "Forbidden", httpStatus: 403, errorClass: "permission", retryable: false }],
  ["side effect", { status: "failed", error: "stream disconnected", retryable: true, effects: [{ id: "write" }] }],
  ["cancellation", { status: "cancelled", retryable: false }],
]) test(`Mac review never switches model after ${name}`, async () => {
  const h = harness(result);
  await assert.rejects(h.provider.analyze(request));
  assert.equal(h.starts.length, 1);
  assert.equal(h.cleaned.length, 1);
  assert.equal(h.waits.length, 0);
});
