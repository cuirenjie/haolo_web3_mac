import assert from "node:assert/strict";
import test from "node:test";

import {
  QUESTION_ANSWER_STREAM_CHANNEL,
  createQuestionAnswerStreamEmitter,
  isQuestionAnswerStreamRequest,
} from "../src/main/workflow/question-answer-stream.mjs";

test("plan-mode stream events preserve upstream deltas and reconcile the final text", () => {
  const events = [];
  const stream = createQuestionAnswerStreamEmitter({
    params: {
      interactionId: "interaction-1",
      threadId: "thread-1",
      provider: "codex",
      model: "gpt-5.6-sol",
      modelPool: "question_answer",
      modelCapability: "question_answer",
    },
    emit: (event) => events.push(event),
    now: () => "2026-07-28T00:00:00.000Z",
  });

  assert.equal(QUESTION_ANSWER_STREAM_CHANNEL, "questionAnswer:stream");
  stream.onEvent({ phase: "started", round: 1 });
  stream.onEvent({
    phase: "delta",
    round: 1,
    delta: "分片一",
    receivedChars: 3,
  });
  stream.onEvent({
    phase: "delta",
    round: 1,
    delta: "，分片二",
    receivedChars: 7,
  });
  stream.complete("分片一，分片二");

  assert.deepEqual(
    events.map((event) => event.phase),
    ["started", "delta", "delta", "completed"],
  );
  assert.deepEqual(
    events.filter((event) => event.phase === "delta").map((event) => event.delta),
    ["分片一", "，分片二"],
  );
  assert.equal(events.at(-1).text, "分片一，分片二");
  assert.equal(events.at(-1).interactionId, "interaction-1");
  assert.equal(events.at(-1).threadId, "thread-1");
});

test("plan-mode stream rounds reset independently for tool-assisted answers", () => {
  const events = [];
  const stream = createQuestionAnswerStreamEmitter({
    params: {
      interactionId: "interaction-tools",
      threadId: "thread-tools",
      modelPool: "question_answer",
    },
    emit: (event) => events.push(event),
  });

  stream.onEvent({ phase: "started", round: 1 });
  stream.onEvent({ phase: "delta", round: 1, delta: "准备读取资料" });
  stream.onEvent({ phase: "started", round: 2 });
  stream.onEvent({ phase: "delta", round: 2, delta: "最终回答" });
  stream.complete("最终回答");

  assert.deepEqual(
    events.map((event) => [event.phase, event.round]),
    [
      ["started", 1],
      ["delta", 1],
      ["started", 2],
      ["delta", 2],
      ["completed", 2],
    ],
  );
});

test("GPT plan-mode stream preserves numbered public process segments separately from final text", () => {
  const events = [];
  const stream = createQuestionAnswerStreamEmitter({
    params: {
      interactionId: "interaction-gpt-plan",
      threadId: "thread-gpt-plan",
      provider: "codex",
      model: "gpt-5.6-sol",
      modelPool: "question_answer",
      modelCapability: "question_answer",
    },
    emit: (event) => events.push(event),
  });

  stream.onEvent({ phase: "started", round: 1 });
  stream.onEvent({
    phase: "plan_process_delta",
    round: 1,
    segmentIndex: 1,
    delta: "确认目标",
  });
  stream.onEvent({
    phase: "plan_process_delta",
    round: 1,
    segmentIndex: 2,
    delta: "形成方案",
  });
  stream.onEvent({ phase: "delta", round: 1, delta: "最终结果" });
  stream.complete("最终结果");

  assert.deepEqual(
    events.map((event) => event.phase),
    [
      "started",
      "plan_process_delta",
      "plan_process_delta",
      "delta",
      "completed",
    ],
  );
  assert.deepEqual(
    events
      .filter((event) => event.phase === "plan_process_delta")
      .map((event) => [event.segmentIndex, event.delta]),
    [
      [1, "确认目标"],
      [2, "形成方案"],
    ],
  );
  assert.equal(events.at(-1).text, "最终结果");
});

test("question-answer streaming is not exposed to group chat or execution mode", () => {
  assert.equal(isQuestionAnswerStreamRequest({
    modelPool: "execution",
    modelCapability: "cluster_node",
  }), false);
  assert.equal(isQuestionAnswerStreamRequest({
    modelPool: "question_answer",
    modelCapability: "question_answer",
    groupChatContextPreparationId: "group-preparation-1",
  }), false);
  assert.equal(createQuestionAnswerStreamEmitter({
    params: {
      interactionId: "group-interaction",
      threadId: "group-thread",
      modelPool: "question_answer",
      groupChatThreadId: "group-thread",
    },
    emit: () => {},
  }), null);
});

test("an interrupted plan-mode stream drops late deltas and terminal output", () => {
  const events = [];
  const controller = new AbortController();
  const stream = createQuestionAnswerStreamEmitter({
    params: {
      interactionId: "interaction-stopped",
      threadId: "thread-stopped",
      provider: "codex",
      model: "gpt-5.6-sol",
      modelPool: "question_answer",
    },
    signal: controller.signal,
    emit: (event) => events.push(event),
  });

  stream.onEvent({ phase: "started", round: 1 });
  stream.onEvent({ phase: "plan_process_delta", round: 1, delta: "停止前过程" });
  controller.abort();
  stream.onEvent({ phase: "delta", round: 1, delta: "迟到回答" });
  assert.equal(stream.complete("不应返回的最终回答"), null);
  assert.equal(stream.fail(), null);

  assert.deepEqual(
    events.map((event) => event.phase),
    ["started", "plan_process_delta"],
  );
});
