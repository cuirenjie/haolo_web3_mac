import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadRoutingModule() {
  const source = await readFile(new URL("../src/renderer/conversation-supplement-routing.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const routingModule = loadRoutingModule();
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function baseState(overrides = {}) {
  return {
    isLocalCodexThread: true,
    hasCodexWork: true,
    hasActiveTurn: true,
    canSteerTurn: true,
    isWindowClosed: false,
    activeTurnStartedAtMs: 1_000,
    nowMs: 2_000,
    staleTurnMs: 30_000,
    hasCodexSendInFlight: false,
    isThreadBusy: true,
    ...overrides,
  };
}

test("opens supplement window only for a fresh active local turn", async () => {
  const { shouldOpenConversationSupplementWindow, shouldRecoverStaleCodexComposerWork } = await routingModule;

  assert.equal(shouldOpenConversationSupplementWindow(baseState()), true);
  assert.equal(shouldRecoverStaleCodexComposerWork(baseState()), false);
});

test("does not route a fake busy thread without an active turn to supplement", async () => {
  const { shouldOpenConversationSupplementWindow, shouldRecoverStaleCodexComposerWork } = await routingModule;
  const state = baseState({ hasActiveTurn: false, activeTurnStartedAtMs: null });

  assert.equal(shouldOpenConversationSupplementWindow(state), false);
  assert.equal(shouldRecoverStaleCodexComposerWork(state), true);
});

test("does not recover while a send request is still in flight", async () => {
  const { shouldOpenConversationSupplementWindow, shouldRecoverStaleCodexComposerWork } = await routingModule;
  const state = baseState({ hasActiveTurn: false, activeTurnStartedAtMs: null, hasCodexSendInFlight: true });

  assert.equal(shouldOpenConversationSupplementWindow(state), false);
  assert.equal(shouldRecoverStaleCodexComposerWork(state), false);
});

test("treats old active turns as stale instead of live supplements", async () => {
  const { shouldOpenConversationSupplementWindow, shouldRecoverStaleCodexComposerWork } = await routingModule;
  const state = baseState({ activeTurnStartedAtMs: 1_000, nowMs: 90_000, staleTurnMs: 30_000 });

  assert.equal(shouldOpenConversationSupplementWindow(state), false);
  assert.equal(shouldRecoverStaleCodexComposerWork(state), true);
});

test("does not recover non-local or idle threads", async () => {
  const { shouldRecoverStaleCodexComposerWork } = await routingModule;

  assert.equal(shouldRecoverStaleCodexComposerWork(baseState({ isLocalCodexThread: false, hasActiveTurn: false })), false);
  assert.equal(shouldRecoverStaleCodexComposerWork(baseState({ hasCodexWork: false, isThreadBusy: false })), false);
});

test("keeps the stop action for recoverable stale composer work", async () => {
  const { conversationSupplementComposerSubmitAction } = await routingModule;

  assert.equal(conversationSupplementComposerSubmitAction(baseState({ hasActiveTurn: false, activeTurnStartedAtMs: null })), "interrupt");
  assert.equal(conversationSupplementComposerSubmitAction(baseState({ activeTurnStartedAtMs: 1_000, nowMs: 90_000, staleTurnMs: 30_000 })), "interrupt");
});

test("keeps supplement and interrupt actions for live busy work", async () => {
  const { conversationSupplementComposerSubmitAction } = await routingModule;

  assert.equal(conversationSupplementComposerSubmitAction(baseState()), "supplement");
  assert.equal(conversationSupplementComposerSubmitAction(baseState({ hasActiveTurn: false, activeTurnStartedAtMs: null, hasCodexSendInFlight: true })), "interrupt");
});

test("only reorders agent messages from the turn targeted by a supplement", async () => {
  const { isConversationSupplementTargetTurnMessage } = await routingModule;

  assert.equal(isConversationSupplementTargetTurnMessage("turn-current", "turn-current"), true);
  assert.equal(isConversationSupplementTargetTurnMessage("turn-current", "turn-history"), false);
  assert.equal(isConversationSupplementTargetTurnMessage("turn-current", null), false);
  assert.equal(isConversationSupplementTargetTurnMessage(null, "turn-history"), true);
});

test("live supplement ordering is scoped to the captured active turn", async () => {
  const source = await rendererSource;
  const snapshotBlock = sourceBlock(source, "function conversationSupplementOrderSnapshot", "function liveConversationSupplementMessageSignature");
  const itemOrderBlock = sourceBlock(source, "function preserveLiveConversationSupplementOrder", "function agentMessageWasVisibleBefore");
  const messageOrderBlock = sourceBlock(source, "function preserveLiveConversationSupplementMessageOrder", "function renderedUserMessageDedupKey");
  const sendBlock = sourceBlock(source, "async function sendConversationSupplementFromComposer", "type ContextBudgetPreparation");

  assert.match(snapshotBlock, /turnId: activeTurnIdForThread\(threadId\)/);
  assert.match(itemOrderBlock, /isConversationSupplementTargetTurnMessage\(targetTurnId, rowTurnId\)/);
  assert.match(messageOrderBlock, /isConversationSupplementTargetTurnMessage\(targetTurnId, itemTurnId/);
  assert.match(sendBlock, /steerConversationSupplement\(threadId, supplementId, agentText, targetTurnId, visibleQuestion\)/);
  assert.match(sendBlock, /expectedTurnId: targetTurnId/);
  assert.match(sendBlock, /visibleQuestion/);
});

test("a supplement that misses the final output is queued as a new turn without replacing its bubble", async () => {
  const source = await rendererSource;
  const sendBlock = sourceBlock(
    source,
    "async function sendConversationSupplementFromComposer",
    "type ContextBudgetPreparation",
  );
  const queueBlock = sourceBlock(
    source,
    "function queueConversationSupplementAsFollowUp",
    "function finishPendingConversationSupplementsForTurn",
  );
  const finishBlock = sourceBlock(
    source,
    "function finishPendingConversationSupplementsForTurn",
    "function scheduleCompletedTurnHydration",
  );

  assert.match(sendBlock, /if \(budget\.deferred\) \{\s*return "send-as-follow-up";/);
  assert.match(sendBlock, /if \(!targetTurnId \|\| !isConversationSupplementWindowOpen\(threadId\)\) \{\s*return "send-as-follow-up";/);
  assert.ok(
    sendBlock.indexOf("conversationSupplementFollowUps.set(supplementId") <
      sendBlock.indexOf("await steerConversationSupplement("),
    "the fallback must be registered before turn completion can race the steer request",
  );
  assert.match(queueBlock, /nextItem\[field\] = undefined/);
  assert.match(queueBlock, /upsertItem\(followUp\.threadId, nextItem/);
  assert.match(queueBlock, /localHistoryAheadThreadIds\.add\(followUp\.threadId\)/);
  assert.match(queueBlock, /state\.queuedSends\.push\(\{[\s\S]*?agentText: followUp\.agentText,[\s\S]*?visibleQuestion: followUp\.visibleQuestion/);
  assert.match(finishBlock, /options\.queueAsFollowUp && queueConversationSupplementAsFollowUp\(supplementId\)/);
});

test("turn completion releases queued follow-ups after clearing the old busy state", async () => {
  const source = await rendererSource;
  const completedBlock = sourceBlock(source, 'case "turn/completed":', 'case "turn/failed":');
  const failedBlock = sourceBlock(source, 'case "turn/failed":', 'case "item/started":');

  assert.match(completedBlock, /finishPendingConversationSupplementsForTurn\(threadId, completedTurnId, \{ queueAsFollowUp: !wasInterrupted \}\)/);
  assert.ok(
    completedBlock.indexOf("setCodexThreadBusy(threadId, false, completedTurnId)") <
      completedBlock.indexOf("void flushQueuedSend()"),
  );
  assert.match(failedBlock, /finishPendingConversationSupplementsForTurn\(threadId, failedTurnId, \{ queueAsFollowUp: true \}\)/);
  assert.ok(
    failedBlock.indexOf("setCodexThreadBusy(threadId, false, failedTurnId)") <
      failedBlock.indexOf("void flushQueuedSend()"),
  );
});

test("stop button handlers always dispatch an interrupt", async () => {
  const source = await rendererSource;
  const submitHandler = source.match(
    /root\s*\.querySelector<HTMLFormElement>\("#composerForm"\)[\s\S]*?(?=root\s*\.querySelector<HTMLButtonElement>\('\[data-action="interrupt-turn"\]'\))/,
  )?.[0] || "";
  const clickHandler = source.match(
    /root\s*\.querySelector<HTMLButtonElement>\('\[data-action="interrupt-turn"\]'\)[\s\S]*?(?=root\s*\.querySelector<HTMLButtonElement>\('\[data-action="toggle-voice-input"\]'\))/,
  )?.[0] || "";

  assert.ok(submitHandler, "missing composer submit handler");
  assert.ok(clickHandler, "missing interrupt click handler");
  assert.match(submitHandler, /#composerForm[\s\S]*?addEventListener\("submit"/);
  assert.match(clickHandler, /data-action="interrupt-turn"[\s\S]*?addEventListener\("click"/);
  assert.doesNotMatch(submitHandler, /shouldRecoverStaleCodexWorkForComposer/);
  assert.match(submitHandler, /void interruptCurrentTurn\(formThreadId, "composer-submit"\);/);
  assert.doesNotMatch(clickHandler, /shouldRecoverStaleCodexWorkForComposer|sendCurrentMessage/);
  assert.match(clickHandler, /void interruptCurrentTurn\(threadId, "composer-click"\);/);
});

test("missing backend turns are reconciled without an age gate", async () => {
  const source = await rendererSource;
  const interruptHandler = sourceBlock(source, "async function interruptCurrentTurn", "function interruptNoticeText");

  assert.doesNotMatch(interruptHandler, /shouldRecoverStaleCodexWorkForComposer/);
  assert.match(interruptHandler, /if \(isMissingActiveTurnInterruptError\(error\)\)/);
  assert.match(interruptHandler, /finishInterruptedTurnLocally\(threadId, turnId, source\);/);
});

test("active workflows cancel the whole run even when an inner Codex turn exists", async () => {
  const source = await rendererSource;
  const interruptHandler = sourceBlock(source, "async function interruptCurrentTurn", "function interruptNoticeText");

  assert.match(interruptHandler, /if \(threadId && workflowActive && api\.cancelWorkflowRun\)/);
  assert.doesNotMatch(interruptHandler, /workflowActive && !turnId/);
  assert.match(interruptHandler, /await api\.cancelWorkflowRun\(\{ runId: workflowRun\.id \}\)/);
  assert.match(interruptHandler, /cancelled\.status !== "cancelled"/);
  assert.match(interruptHandler, /后台未确认工作流已停止/);
});
