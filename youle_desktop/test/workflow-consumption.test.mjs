import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowConsumptionRecord,
  workflowConsumptionQuestion,
  workflowMediaCorrelationInstructions,
} from "../src/main/workflow/consumption.mjs";

test("workflow consumption questions explain every semantic canvas phase", () => {
  assert.equal(
    workflowConsumptionQuestion({ phase: "canvas_create_plan", runId: "workflow-1" }),
    "创建画布 · 智能体语义规划",
  );
  assert.equal(
    workflowConsumptionQuestion({
      phase: "node_output_validate",
      runId: "workflow-1",
      nodeId: "review",
      nodeTitle: "质量复核",
    }),
    "运行画布 · 节点输出语义验收 · 节点「质量复核」",
  );
});

test("workflow consumption records bind turn usage to its run and internal conversation", () => {
  assert.deepEqual(buildWorkflowConsumptionRecord({
    phase: "node_agent_execute",
    runId: "workflow-1",
    rootThreadId: "thread-root",
    nodeId: "writer",
    nodeTitle: "正文写作",
  }, {
    interactionId: "turn-worker",
    conversationId: "workflow-1",
    childConversationId: "thread-internal",
    status: "running",
    startedAt: "2026-08-03T00:00:00.000Z",
  }), {
    interactionId: "turn-worker",
    conversationId: "workflow-1",
    childConversationId: "thread-internal",
    sourceType: "multi_model_cluster_node",
    question: "运行画布 · 智能体执行 · 节点「正文写作」",
    status: "running",
    startedAt: "2026-08-03T00:00:00.000Z",
    endedAt: undefined,
    answer: undefined,
  });
});

test("workflow media instructions preserve one billable interaction across tool calls", () => {
  const image = workflowMediaCorrelationInstructions({
    phase: "node_media_execute",
    runId: "workflow-1",
  }, "workflow-1:node:image:media:attempt-1", { mediaMode: "image-generation" });
  assert.match(image, /--interaction-id "workflow-1:node:image:media:attempt-1"/);
  assert.match(image, /--conversation-id "workflow-1"/);
  assert.match(image, /--source-type "multi_model_cluster_media"/);

  const video = workflowMediaCorrelationInstructions({
    phase: "node_media_execute",
    runId: "workflow-1",
  }, "workflow-1:node:video:media:attempt-1", { mediaMode: "video-generation" });
  assert.match(video, /--request-id "workflow-1:node:video:media:attempt-1"/);
  assert.match(video, /HAOLO_SOURCE_TYPE="multi_model_cluster_media"/);
});
