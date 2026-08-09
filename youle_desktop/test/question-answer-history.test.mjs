import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT,
  settleRestoredQuestionAnswerItems,
} from "../src/renderer/question-answer-history.js";

const timestamp = "2026-07-29T09:00:00.000Z";

function runningProgress(interactionId = "interaction-1") {
  return {
    id: `question-answer-progress-${interactionId}`,
    type: "questionAnswerProgress",
    provider: "doubao",
    __youleQuestionAnswerProgress: {
      protocolVersion: 1,
      interactionId,
      threadId: "provider:doubao:thread-1",
      provider: "doubao",
      model: "doubao-seed",
      status: "running",
      sequence: 4,
      startedAt: "2026-07-29T08:00:00.000Z",
      updatedAt: "2026-07-29T08:01:00.000Z",
      steps: [{
        id: "provider-round-1",
        stage: "provider_stream",
        status: "running",
        title: "模型正在流式生成回答",
        sequence: 4,
      }],
    },
  };
}

test("restored running plan task is settled as failed with a visible terminal message", () => {
  const result = settleRestoredQuestionAnswerItems(
    [runningProgress()],
    { timestamp },
  );

  assert.equal(result.changed, true);
  assert.equal(result.items.length, 2);
  const progress = result.items[0].__youleQuestionAnswerProgress;
  assert.equal(progress.status, "failed");
  assert.equal(progress.steps[0].status, "failed");
  assert.deepEqual(progress.steps.at(-1), {
    id: "request-interrupted",
    stage: "request_interrupted",
    status: "failed",
    title: "任务已中断",
    detail: RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT,
    sequence: 5,
    timestamp,
  });
  assert.match(result.items[1].id, /^provider-agent-interrupted-/);
  assert.equal(result.items[1].text, RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT);
  assert.equal(
    result.items[1].__youleQuestionAnswerStream.status,
    "failed",
  );

  const repeated = settleRestoredQuestionAnswerItems(result.items, { timestamp });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.items.length, 2);
});

test("completed final answer repairs a stale running board as completed", () => {
  const interactionId = "interaction-completed";
  const finalAnswer = {
    id: `provider-agent-stream-${interactionId}`,
    type: "agentMessage",
    provider: "doubao",
    text: "最终回答",
    turn_id: interactionId,
    __youleQuestionAnswerStream: {
      protocolVersion: 1,
      interactionId,
      round: 1,
      sequence: 8,
      status: "completed",
    },
  };
  const result = settleRestoredQuestionAnswerItems(
    [runningProgress(interactionId), finalAnswer],
    { timestamp },
  );

  assert.equal(
    result.items[0].__youleQuestionAnswerProgress.status,
    "completed",
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1], finalAnswer);
});

test("restored GPT plan process keeps partial output but becomes failed", () => {
  const interactionId = "interaction-plan";
  const processItem = {
    id: `provider-agent-plan-process-${interactionId}-1`,
    type: "agentMessage",
    provider: "codex",
    text: "我正在检查文件",
    turn_id: interactionId,
    __youleGptPlanProcess: true,
    __youleQuestionAnswerStream: {
      protocolVersion: 1,
      interactionId,
      round: 1,
      sequence: 3,
      status: "running",
    },
  };
  const result = settleRestoredQuestionAnswerItems(
    [runningProgress(interactionId), processItem],
    { timestamp },
  );

  assert.equal(result.items[1].text, processItem.text);
  assert.equal(result.items[1].__youleQuestionAnswerStream.status, "failed");
  assert.equal(result.items.at(-1).text, RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT);
});

test("renderer and main process own provider interruption and restore reconciliation", async () => {
  const [renderer, main, preload] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(renderer, /settleRestoredQuestionAnswerItems/);
  assert.match(renderer, /restoredProviderChatRecordsSettled/);
  assert.match(renderer, /function settleInterruptedProviderQuestionAnswer/);
  assert.match(renderer, /api\.interruptProviderChat/);
  assert.match(main, /activeProviderChatsByInteractionId/);
  assert.match(main, /providerChatAbortController\.signal/);
  assert.match(main, /youle:interruptProviderChat/);
  assert.match(preload, /interruptProviderChat:[\s\S]*youle:interruptProviderChat/);
});
