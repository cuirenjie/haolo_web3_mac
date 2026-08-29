import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildContextWindowRecoveryReplayText,
  canReplayContextWindowFailure,
  decideContextUsageSample,
  isContextWindowRecoveryReplayText,
} from "../src/renderer/context-window-recovery.ts";

const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("automatic replay preserves the request and carries a durable hidden-item marker", () => {
  const request = "请继续完成原来的 Word 调研报告";
  const replay = buildContextWindowRecoveryReplayText(request);
  assert.equal(isContextWindowRecoveryReplayText(replay), true);
  assert.equal(replay.includes(request), true);
  assert.match(replay, /do not mention this recovery wrapper/i);
  assert.equal(isContextWindowRecoveryReplayText(request), false);
});

test("a context failure receives exactly one automatic replay", () => {
  assert.equal(canReplayContextWindowFailure(0), true);
  assert.equal(canReplayContextWindowFailure(1), false);
  assert.equal(canReplayContextWindowFailure(2), false);
});

test("full-window and late zero samples cannot clear the recovery guard", () => {
  assert.deepEqual(
    decideContextUsageSample({
      contextWindowExhausted: true,
      exhaustedTurnId: "failed-turn",
      awaitingPostRecoveryUsage: false,
      sampleTurnId: "failed-turn",
    }),
    { acceptUsedTokens: false, clearAwaitingPostRecoveryUsage: false },
  );
  assert.equal(
    decideContextUsageSample({
      contextWindowExhausted: false,
      exhaustedTurnId: "failed-turn",
      awaitingPostRecoveryUsage: true,
      postRecoveryTurnId: "replay-turn",
      sampleTurnId: "failed-turn",
    }).acceptUsedTokens,
    false,
    "a late failed-turn zero must stay quarantined after compaction",
  );
  assert.equal(
    decideContextUsageSample({
      contextWindowExhausted: false,
      exhaustedTurnId: "failed-turn",
      awaitingPostRecoveryUsage: true,
      postRecoveryTurnId: "replay-turn",
      sampleTurnId: null,
    }).acceptUsedTokens,
    false,
    "an unattributed hydration snapshot must not race the replay turn",
  );
  assert.equal(
    decideContextUsageSample({
      contextWindowExhausted: false,
      exhaustedTurnId: "failed-turn",
      awaitingPostRecoveryUsage: true,
      postRecoveryTurnId: "replay-turn",
      sampleTurnId: "older-turn",
    }).acceptUsedTokens,
    false,
    "an unrelated late turn must not unlock post-recovery usage",
  );
  assert.deepEqual(
    decideContextUsageSample({
      contextWindowExhausted: false,
      exhaustedTurnId: "failed-turn",
      awaitingPostRecoveryUsage: true,
      postRecoveryTurnId: "replay-turn",
      sampleTurnId: "replay-turn",
    }),
    { acceptUsedTokens: true, clearAwaitingPostRecoveryUsage: true },
  );
});

test("renderer compacts and transparently replays both terminal and immediate full-window failures", () => {
  const recovery = sourceBlock(
    renderer,
    "function queueContextWindowRecovery",
    "// HAOLO-CONTEXT-RECOVERY-PATCH-END",
  );
  const completed = sourceBlock(renderer, 'case "turn/completed":', 'case "turn/failed":');
  const failed = sourceBlock(renderer, 'case "turn/failed":', 'case "item/started":');
  const dispatch = sourceBlock(renderer, "async function sendAgentText", "async function flushQueuedSend");

  const compactIndex = recovery.indexOf("await requestAutomaticThreadContextCompaction(threadId)");
  const replayIndex = recovery.indexOf("await sendAgentText(");
  assert.ok(compactIndex >= 0 && replayIndex > compactIndex);
  assert.match(recovery, /contextWindowRecoveryReplayCount:\s*replay\.replayCount \+ 1/);
  assert.ok(
    recovery.indexOf("!canReplayContextWindowFailure(replay.replayCount)") <
      recovery.indexOf("contextWindowRecoveryPromises.has(threadId)"),
    "an immediate failure of the replay must stop before the in-flight recovery dedupe guard",
  );
  assert.match(completed, /queueContextWindowRecovery\(threadId, completedTurnId, completedTurnFailureReason\)/);
  assert.match(completed, /!contextRecoveryQueued/);
  assert.match(completed, /duplicateContextRecoveryTerminal[\s\S]*scheduleThreadListRefresh\(\);\s*break;/);
  assert.match(failed, /queueContextWindowRecovery\(threadId, failedTurnId, reason\)/);
  assert.match(failed, /duplicateContextRecoveryTerminal[\s\S]*scheduleThreadListRefresh\(\);\s*break;/);
  assert.match(dispatch, /buildContextWindowRecoveryReplayText\(agentText\)/);
  assert.match(dispatch, /queueContextWindowRecovery\(activeThreadId, null, sendErrorMessage\)/);
});

test("renderer keeps exhaustion latched across token races and hides replay items after hydration", () => {
  const tokenUsage = sourceBlock(
    renderer,
    "function handleThreadTokenUsageNotification",
    "function isContextCompactionItem",
  );
  const snapshot = sourceBlock(
    renderer,
    "function applyThreadContextUsageSnapshot",
    "function adoptReplacementCodexThread",
  );
  const budget = sourceBlock(
    renderer,
    "async function prepareContextBudgetForSend",
    "function applyWorkflowEvent",
  );
  const sanitizer = sourceBlock(
    renderer,
    "function sanitizeIncomingThreadItem",
    "function sanitizeProcessItemText",
  );
  const hidden = sourceBlock(renderer, "function shouldHideChatItem", "function isHiddenRoleItem");

  assert.match(tokenUsage, /decideContextUsageSample/);
  assert.match(tokenUsage, /decision\.acceptUsedTokens/);
  assert.match(snapshot, /decideContextUsageSample/);
  assert.match(budget, /context\?\.contextWindowExhausted === true/);
  assert.ok(
    budget.indexOf('decision.action === "allow"') <
      budget.indexOf("await requestAutomaticThreadContextCompaction(threadId)"),
    "ordinary sends must return before the compaction call",
  );
  assert.match(sanitizer, /isContextWindowRecoveryReplayText\(rawText\)/);
  assert.match(hidden, /__youleContextWindowRecoveryReplay === true/);
});
