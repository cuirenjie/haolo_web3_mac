import assert from "node:assert/strict";
import test from "node:test";

import {
  QUESTION_ANSWER_PROGRESS_CHANNEL,
  createQuestionAnswerProgressEmitter,
  normalizeQuestionAnswerProgressEvent,
} from "../src/main/workflow/question-answer-progress.mjs";

test("question-answer progress uses a stable sender-scoped envelope", () => {
  const events = [];
  const progress = createQuestionAnswerProgressEmitter({
    params: {
      interactionId: "provider-turn-1",
      threadId: "provider:gemini:thread-1",
      sourceType: "gemini",
      model: "gemini-3.5-flash",
    },
    emit: (event) => events.push(event),
    now: () => "2026-07-27T12:00:00.000Z",
  });

  progress({
    stepId: "context-build",
    stage: "context_build",
    status: "running",
    title: "正在读取并整理资料",
    detail: "按任务相关性读取文件",
  });
  progress({
    stepId: "context-build",
    stage: "context_build",
    status: "completed",
    runStatus: "completed",
    title: "回答已完成",
  });

  assert.equal(QUESTION_ANSWER_PROGRESS_CHANNEL, "questionAnswer:progress");
  assert.equal(events.length, 2);
  assert.equal(events[0].protocolVersion, 1);
  assert.equal(events[0].kind, "question_answer_progress");
  assert.equal(events[0].mode, "question_answer");
  assert.equal(events[0].interactionId, "provider-turn-1");
  assert.equal(events[0].threadId, "provider:gemini:thread-1");
  assert.equal(events[0].provider, "gemini");
  assert.equal(events[0].sequence, 1);
  assert.equal(events[1].sequence, 2);
  assert.equal(events[1].runStatus, "completed");
  assert.equal("prompt" in events[0], false);
  assert.equal("content" in events[0], false);
  assert.equal("rationale" in events[0], false);
});

test("progress normalization rejects anonymous steps and bounds display text", () => {
  assert.equal(normalizeQuestionAnswerProgressEvent({ title: "missing id" }), null);
  const normalized = normalizeQuestionAnswerProgressEvent({
    stepId: "step",
    title: "x".repeat(300),
    detail: "y".repeat(600),
  });
  assert.equal(normalized.status, "running");
  assert.equal(normalized.runStatus, "running");
  assert.ok(normalized.title.length <= 120);
  assert.ok(normalized.detail.length <= 320);
});

test("question-answer progress stops emitting after cancellation", () => {
  const events = [];
  const controller = new AbortController();
  const progress = createQuestionAnswerProgressEmitter({
    params: {
      interactionId: "provider-turn-stopped",
      threadId: "provider:codex:stopped",
      provider: "codex",
    },
    signal: controller.signal,
    emit: (event) => events.push(event),
  });

  progress({
    stepId: "context-build",
    title: "正在准备上下文",
  });
  controller.abort();
  assert.equal(progress({
    stepId: "finalize-answer",
    status: "completed",
    runStatus: "completed",
    title: "迟到回答",
  }), null);
  assert.equal(events.length, 1);
});
