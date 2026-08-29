import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  captureWorkflowInternalStartNotification,
  cleanupWorkflowInternalCodexThread,
  createWorkflowInternalStartCapture,
  drainWorkflowInternalStartCapture,
  interruptWorkflowCodexTurn,
} from "../src/main/workflow/internal-codex-lifecycle.mjs";

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("workflow internal start capture suppresses only the response thread", () => {
  const capture = createWorkflowInternalStartCapture();
  const unrelatedStatus = { method: "thread/status/changed" };
  const internalStarted = { method: "thread/started", params: { thread: { id: "thread-internal" } } };
  const internalStatus = { method: "thread/status/changed", params: { threadId: "thread-internal" } };
  const unrelatedStarted = { method: "thread/started", params: { thread: { id: "thread-unrelated" } } };

  assert.equal(captureWorkflowInternalStartNotification(capture, unrelatedStatus, "thread-unrelated"), false);
  assert.equal(captureWorkflowInternalStartNotification(capture, internalStarted, "thread-internal"), true);
  assert.equal(captureWorkflowInternalStartNotification(capture, internalStatus, "thread-internal"), true);
  assert.equal(captureWorkflowInternalStartNotification(capture, unrelatedStarted, "thread-unrelated"), true);

  const drained = drainWorkflowInternalStartCapture(capture, "thread-internal");
  assert.equal(drained.suppressedCount, 2);
  assert.deepEqual(drained.forwardedNotifications, [unrelatedStarted]);
  assert.equal(capture.bufferedNotifications.length, 0);
  assert.equal(capture.candidateThreadIds.size, 0);
});

test("unfinished workflow planner interrupts before deleting its internal thread", async () => {
  const calls = [];
  const result = await cleanupWorkflowInternalCodexThread({
    threadId: "thread-internal",
    turnId: "turn-internal",
    interrupt: true,
    interruptTurn: async (params) => calls.push(["interrupt", params]),
    deleteThread: async (params) => calls.push(["delete", params]),
  });

  assert.deepEqual(calls, [
    ["interrupt", { threadId: "thread-internal", turnId: "turn-internal" }],
    ["delete", { threadId: "thread-internal" }],
  ]);
  assert.equal(result.interrupted, true);
  assert.equal(result.deleted, true);
  assert.deepEqual(result.errors, []);
});

test("internal thread cleanup still deletes after interrupt failure and reports delete failure safely", async () => {
  const interruptFailure = new Error("already completed");
  const interruptedResult = await cleanupWorkflowInternalCodexThread({
    threadId: "thread-internal",
    turnId: "turn-internal",
    interrupt: true,
    interruptTurn: async () => {
      throw interruptFailure;
    },
    deleteThread: async () => {},
  });
  assert.equal(interruptedResult.deleted, true);
  assert.equal(interruptedResult.interrupted, false);
  assert.deepEqual(interruptedResult.errors, [{ phase: "interrupt", error: interruptFailure }]);

  const deleteFailure = new Error("thread still busy");
  const retainedResult = await cleanupWorkflowInternalCodexThread({
    threadId: "thread-internal",
    turnId: "turn-internal",
    interrupt: false,
    deleteThread: async () => {
      throw deleteFailure;
    },
  });
  assert.equal(retainedResult.deleted, false);
  assert.deepEqual(retainedResult.errors, [{ phase: "delete", error: deleteFailure }]);
});

test("workflow turn interruption stays bound to the exact thread and turn without retrying another turn", async () => {
  const calls = [];
  const interrupted = await interruptWorkflowCodexTurn({
    threadId: "thread-root",
    turnId: "turn-root-final",
    interruptTurn: async (params) => calls.push(params),
  });

  assert.deepEqual(calls, [{
    threadId: "thread-root",
    turnId: "turn-root-final",
  }]);
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.error, null);

  const failure = new Error("turn already completed");
  const failedCalls = [];
  const notInterrupted = await interruptWorkflowCodexTurn({
    threadId: "thread-root",
    turnId: "turn-root-final",
    interruptTurn: async (params) => {
      failedCalls.push(params);
      throw failure;
    },
  });
  assert.equal(failedCalls.length, 1);
  assert.equal(notInterrupted.interrupted, false);
  assert.equal(notInterrupted.error, failure);
});

test("main keeps workflow planner notifications hidden through confirmed deletion", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const startBlock = sourceBlock(
    source,
    "function requestWorkflowInternalThreadStart",
    "async function requestContinuationThreadStart",
  );
  const cleanupBlock = sourceBlock(
    source,
    "function scheduleWorkflowInternalCodexCleanup",
    "async function runInternalWorkflowCodexStep",
  );
  const plannerBlock = sourceBlock(
    source,
    "async function runInternalWorkflowCodexStep",
    "async function executeClusterRootFinal",
  );
  const rootFinalBlock = sourceBlock(
    source,
    "async function executeClusterRootFinal",
    "function captureWorkflowCodexTurn",
  );
  const artifactBlock = sourceBlock(
    source,
    "async function notifyThreadArtifactsChanged",
    "async function createQuestionAnswerDerivedMediaResult",
  );

  assert.ok(
    startBlock.indexOf("pendingWorkflowInternalStartByClient.set") <
      startBlock.indexOf('requestAppServer(serverClient, "thread/start"'),
  );
  assert.ok(
    startBlock.indexOf("workflowInternalThreadIds.add") <
      startBlock.indexOf("drainWorkflowInternalStartCapture"),
  );
  assert.match(cleanupBlock, /interruptTurn:[\s\S]*?"turn\/interrupt"/);
  assert.match(cleanupBlock, /deleteThread:[\s\S]*?"thread\/delete"/);
  assert.match(cleanupBlock, /if \(deleted\) \{[\s\S]*?workflowInternalThreadIds\.delete/);
  assert.match(plannerBlock, /requestWorkflowInternalThreadStart/);
  assert.match(plannerBlock, /interrupt: !workflowTurnFinished/);
  assert.match(rootFinalBlock, /if \(!turnFinished && turnId\)/);
  assert.match(rootFinalBlock, /interruptWorkflowCodexTurn/);
  assert.match(rootFinalBlock, /"turn\/interrupt"/);
  assert.match(rootFinalBlock, /allowSideEffects = true/);
  assert.match(rootFinalBlock, /allowSideEffects \? "danger-full-access" : "read-only"/);
  assert.match(rootFinalBlock, /haolo-frozen-workflow-report-only/);
  assert.match(artifactBlock, /workflowInternalThreadIds\.has\(String\(threadId\)\)/);
  assert.match(artifactBlock, /workflowInternalTurnIds\.has\(String\(options\.turnId\)\)/);
});

test("workflow media subagents keep the selected media model out of the Codex worker slot", async () => {
  const mainSource = await readFile(
    new URL("../src/main/main.mjs", import.meta.url),
    "utf8",
  );
  const executor = sourceBlock(
    mainSource,
    "async function executeClusterCodexSubAgentNode",
    "async function runWorkflowCodexNodeTurnWithRecovery",
  );

  assert.match(executor, /nodeProvider === HAOLO_IMAGE_SUBAGENT_PROVIDER[\s\S]*"image-generation"/);
  assert.match(executor, /nodeProvider === HAOLO_VIDEO_SUBAGENT_PROVIDER[\s\S]*"video-generation"/);
  assert.match(executor, /const workerModel = mediaMode \? null : model/);
  assert.match(executor, /mediaMode === "image-generation" \? model : null/);
  assert.match(executor, /mediaMode === "video-generation"[\s\S]*videoGenerationModel: model/);
  assert.match(executor, /model: workerModel/);
  assert.match(executor, /provider: nodeProvider \|\| "haolo-codex-agent"/);
});

test("all workflow Codex phases use same-thread transport recovery and handle turn/failed immediately", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const recoveryBlock = sourceBlock(
    source,
    "async function runWorkflowCodexNodeTurnWithRecovery",
    "function scheduleWorkflowInternalCodexCleanup",
  );
  const captureBlock = sourceBlock(
    source,
    "function captureWorkflowCodexTurn",
    "function workflowCodexTerminalFailure",
  );
  const plannerThroughFinalBlock = sourceBlock(
    source,
    "async function runInternalWorkflowCodexStep",
    "function captureWorkflowCodexTurn",
  );

  assert.match(captureBlock, /message\.method === "turn\/completed" \|\| message\.method === "turn\/failed"/);
  assert.match(captureBlock, /retryable: failure\?\.retryable === true/);
  assert.match(recoveryBlock, /for \(;;\)/);
  assert.match(recoveryBlock, /buildAutomaticTurnRecoveryPrompt/);
  assert.match(recoveryBlock, /waitForModelTransportRecovery/);
  assert.match(recoveryBlock, /lowFrequency/);
  assert.match(recoveryBlock, /do not replay completed or unknown side effects/i);
  assert.ok(
    plannerThroughFinalBlock.match(/runWorkflowCodexNodeTurnWithRecovery\(\{/g)?.length >= 4,
    "planner, assignment, context intent, context reader, and final acceptance should share recovery",
  );
  assert.match(plannerThroughFinalBlock, /hideFromRenderer: false/);
  assert.match(source, /workflowManagedVisibleTurnIds\.has\(String\(turnId\)\)/);
});

test("every billable workflow phase reports semantic lifecycle correlation", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const providerBlock = sourceBlock(
    source,
    "async function executeClusterProviderNode",
    "async function executeClusterCodexSubAgentNode",
  );
  const agentBlock = sourceBlock(
    source,
    "async function executeClusterCodexSubAgentNode",
    "async function runWorkflowCodexNodeTurnWithRecovery",
  );
  const plannerBlock = sourceBlock(
    source,
    "async function runInternalWorkflowCodexStep",
    "async function runInternalGroupChatTaskPlanningStep",
  );
  const contextBlock = sourceBlock(
    source,
    "async function runInternalHaoloReadOnlyContextStep",
    "function haoloAgentContextPackage",
  );

  assert.match(providerBlock, /interactionId = workflowNodeConsumptionInteractionId/);
  assert.match(providerBlock, /reportWorkflowConsumption\(consumptionContext/);
  assert.match(providerBlock, /finishWorkflowTurnConsumption\(consumptionRecord/);
  assert.match(agentBlock, /reportWorkflowInternalSessionConsumption/);
  assert.match(agentBlock, /startWorkflowTurnConsumption/);
  assert.match(agentBlock, /workflowMediaCorrelationInstructions/);
  assert.match(agentBlock, /mediaInteractionId/);
  assert.match(plannerBlock, /reportWorkflowInternalSessionConsumption/);
  assert.match(plannerBlock, /startWorkflowTurnConsumption/);
  assert.match(contextBlock, /reportWorkflowInternalSessionConsumption/);
  assert.match(contextBlock, /startWorkflowTurnConsumption/);
});
