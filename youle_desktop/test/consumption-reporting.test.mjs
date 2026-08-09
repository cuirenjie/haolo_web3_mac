import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubagentConsumptionQuestion,
  buildSubagentConsumptionRecord,
  buildVisibleConsumptionQuestion,
  createSerializedConsumptionReporter,
} from "../src/main/consumption-reporting.mjs";

test("visible consumption questions include only user text and attachment names", () => {
  const question = buildVisibleConsumptionQuestion("  请分析这张图  ", [{
    name: "C:\\private\\报表.png",
    mime: "image/png",
    url: "https://internal.example/secret",
    local_path: "C:\\private\\报表.png",
    object_key: "secret-key",
  }]);

  assert.equal(question, "请分析这张图\n图片：报表.png");
  assert.doesNotMatch(question, /internal|private|secret-key/);
});

test("subagent consumption questions identify the parent task", () => {
  assert.equal(buildSubagentConsumptionQuestion("  分析销售数据  ", 1), "[子Agent1]分析销售数据");
  assert.equal(buildSubagentConsumptionQuestion("[子Agent]分析销售数据", 2), "[子Agent2]分析销售数据");
  assert.equal(buildSubagentConsumptionQuestion("", 3), "[子Agent3]未命名任务");
});

test("subagent consumption records never reuse the parent interaction id", () => {
  const parent = {
    interactionId: "parent-turn",
    conversationId: "parent-thread",
    sourceType: "haolo",
    question: "分析销售数据",
  };
  const child = buildSubagentConsumptionRecord(parent, {
    interactionId: "child-turn",
    childConversationId: "child-thread",
    index: 2,
    status: "running",
  });

  assert.deepEqual(child, {
    interactionId: "child-turn",
    conversationId: "parent-thread",
    childConversationId: "child-thread",
    sourceType: "haolo",
    question: "[子Agent2]分析销售数据",
    status: "running",
    startedAt: undefined,
    endedAt: undefined,
    answer: undefined,
  });
  assert.equal(parent.question, "分析销售数据");
});

test("consumption lifecycle reports retry finitely and stay ordered per interaction", async () => {
  const calls = [];
  let runningAttempts = 0;
  const report = createSerializedConsumptionReporter(async (params) => {
    calls.push(params.status);
    if (params.status === "running" && ++runningAttempts === 1) throw new Error("temporary outage");
    return { ok: true };
  }, { maxAttempts: 2, retryDelayMs: 1 });

  const running = report({ interactionId: "turn-1", status: "running" });
  const complete = report({ interactionId: "turn-1", status: "complete" });
  await Promise.all([running, complete]);

  assert.deepEqual(calls, ["running", "running", "complete"]);
});

test("a permanently failed start report does not discard the queued final report", async () => {
  const calls = [];
  const report = createSerializedConsumptionReporter(async (params) => {
    calls.push(params.status);
    if (params.status === "running") throw new Error("backend unavailable");
    return { ok: true };
  }, { maxAttempts: 2, retryDelayMs: 1 });

  const running = report({ interactionId: "turn-2", status: "running" });
  const complete = report({ interactionId: "turn-2", status: "complete" });
  await assert.rejects(running, /backend unavailable/);
  await complete;

  assert.deepEqual(calls, ["running", "running", "complete"]);
});

test("shutdown flush waits for queued workflow lifecycle reports", async () => {
  let release;
  const sent = [];
  const report = createSerializedConsumptionReporter(async (params) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    sent.push(params.status);
  });

  report({ interactionId: "workflow-turn", status: "complete" });
  assert.equal(report.pendingCount(), 1);
  const flushing = report.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, []);
  release();
  await flushing;

  assert.deepEqual(sent, ["complete"]);
  assert.equal(report.pendingCount(), 0);
});
