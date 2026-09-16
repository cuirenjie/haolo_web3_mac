import assert from "node:assert/strict";
import test from "node:test";
import {
  HAOLO_REASONING_FIXED_EFFORT_FIELD,
  HAOLO_REASONING_SUPPORT_FIELD,
  HAOLO_REASONING_TASK_FIELD,
  adaptiveReasoningEffortForTask,
  assessTaskDifficulty,
  isDeepSeekTextModel,
  isGptSeriesTextModel,
  reasoningTaskText,
  withAdaptiveTurnReasoning,
} from "../src/main/gpt-reasoning-effort.mjs";

test("classifies each task into an automatic reasoning tier", () => {
  assert.deepEqual(
    assessTaskDifficulty("你好"),
    { level: "trivial", effort: "low", reason: "bounded_trivial_task" },
  );
  assert.deepEqual(
    assessTaskDifficulty("北京的天气"),
    { level: "trivial", effort: "low", reason: "bounded_quick_lookup" },
  );
  assert.equal(assessTaskDifficulty("翻译成英文：明天见").effort, "low");
  assert.equal(
    assessTaskDifficulty("把按钮文案改成保存，并更新对应测试").effort,
    "medium",
  );
  assert.equal(
    assessTaskDifficulty("设计缓存架构").effort,
    "high",
  );
  assert.equal(
    assessTaskDifficulty("全面重构认证系统并迁移数据库，完成安全审计和生产部署").effort,
    "max",
  );
});

test("routine transformation stays medium even when the supplied source is long", () => {
  const assessment = assessTaskDifficulty(`总结下面材料：\n${"项目背景与普通正文。".repeat(500)}`);
  assert.equal(assessment.level, "simple");
  assert.equal(assessment.effort, "medium");
});

test("automatic target ignores user choices and maps to each model's supported tiers", () => {
  assert.equal(adaptiveReasoningEffortForTask({
    model: "gpt-5.6-terra",
    task: "把标题改短一点",
    requestedEffort: "high",
  }), "medium");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "gpt-5.6-terra",
    task: "把标题改短一点",
    requestedEffort: "low",
  }), "medium");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "gpt-5.6-terra",
    task: "北京的天气",
    requestedEffort: "max",
  }), "low");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "gpt-5.6-terra",
    task: "",
    requestedEffort: "ultra",
  }), "medium");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "gpt-5.5",
    task: "全面重构认证系统并迁移数据库，完成安全审计和生产部署",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  }), "xhigh");

  assert.equal(adaptiveReasoningEffortForTask({
    model: "deepseek-flash",
    task: "北京的天气",
    requestedEffort: "max",
    supportedReasoningEfforts: ["low", "high", "max"],
  }), "low");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "deepseek-flash",
    task: "把按钮文案改成保存，并更新对应测试",
    requestedEffort: "low",
    supportedReasoningEfforts: ["low", "high", "max"],
  }), "high");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "deepseek-flash",
    task: "全面重构认证系统并迁移数据库，完成安全审计和生产部署",
    supportedReasoningEfforts: ["low", "high", "max"],
  }), "max");

  assert.equal(adaptiveReasoningEffortForTask({
    model: "claude-sonnet-5",
    task: "你好",
    requestedEffort: "high",
  }), "high");
  assert.equal(adaptiveReasoningEffortForTask({
    model: "aihubcc/gpt-image-2",
    task: "你好",
  }), undefined);
  assert.equal(isGptSeriesTextModel("openai/gpt-5.5"), true);
  assert.equal(isGptSeriesTextModel("aihubcc/gpt-image-2"), false);
  assert.equal(isDeepSeekTextModel("deepseek-flash"), true);
});

test("turn/start applies the policy centrally and strips private metadata", () => {
  const result = withAdaptiveTurnReasoning("turn/start", {
    model: "gpt-5.6-terra",
    effort: "ultra",
    input: [{
      type: "text",
      text: "<haolo_windows_utf8_reminder>internal</haolo_windows_utf8_reminder>\n北京的天气",
    }],
    [HAOLO_REASONING_TASK_FIELD]: "北京的天气",
    [HAOLO_REASONING_SUPPORT_FIELD]: ["low", "medium", "high", "max", "ultra"],
  });
  assert.equal(result.effort, "low");
  assert.equal(Object.hasOwn(result, HAOLO_REASONING_TASK_FIELD), false);
  assert.equal(Object.hasOwn(result, HAOLO_REASONING_SUPPORT_FIELD), false);

  const deepSeek = withAdaptiveTurnReasoning("turn/start", {
    model: "deepseek-flash",
    effort: "max",
    input: [{ type: "text", text: "把按钮文案改成保存，并更新对应测试" }],
    [HAOLO_REASONING_SUPPORT_FIELD]: ["low", "high", "max"],
  });
  assert.equal(deepSeek.effort, "high");

  const intensive = withAdaptiveTurnReasoning("turn/start", {
    model: "gpt-5.6-sol",
    effort: "low",
    input: [{ type: "text", text: "全面重构认证系统并迁移数据库，完成安全审计和生产部署" }],
    [HAOLO_REASONING_SUPPORT_FIELD]: ["low", "medium", "high", "xhigh", "max", "ultra"],
  });
  assert.equal(intensive.effort, "max");
});

test("fixed internal effort stays at the highest supported Sol tier", () => {
  const result = withAdaptiveTurnReasoning("turn/start", {
    model: "gpt-5.6-sol",
    effort: "medium",
    input: [{ type: "text", text: "你好" }],
    [HAOLO_REASONING_FIXED_EFFORT_FIELD]: "ultra",
    [HAOLO_REASONING_SUPPORT_FIELD]: ["low", "medium", "high", "xhigh", "max", "ultra"],
  });

  assert.equal(result.effort, "ultra");
  assert.equal(Object.hasOwn(result, HAOLO_REASONING_FIXED_EFFORT_FIELD), false);
  assert.equal(Object.hasOwn(result, HAOLO_REASONING_SUPPORT_FIELD), false);
});

test("a fixed medium internal review cannot be promoted by a long prompt", () => {
  const result = withAdaptiveTurnReasoning("turn/start", {
    model: "gpt-5.6-sol",
    effort: "medium",
    input: [{ type: "text", text: "复杂交易候选。".repeat(2_000) }],
    [HAOLO_REASONING_FIXED_EFFORT_FIELD]: "medium",
  });

  assert.equal(result.effort, "medium");
  assert.equal(Object.hasOwn(result, HAOLO_REASONING_FIXED_EFFORT_FIELD), false);
});

test("native collaboration effort is authoritative and cannot be adaptively changed", () => {
  const result = withAdaptiveTurnReasoning("turn/start", {
    model: "gpt-5.6-sol",
    effort: "medium",
    collaborationMode: {
      mode: "default",
      settings: {
        model: "gpt-5.6-sol",
        reasoning_effort: "ultra",
        developer_instructions: "multi-agent contract",
      },
    },
    input: [{ type: "text", text: "你好" }],
  });

  assert.equal(result.effort, "ultra");
  assert.equal(result.collaborationMode.settings.reasoning_effort, "ultra");
});

test("extracts the actual user task from internal planner envelopes", () => {
  assert.equal(
    reasoningTaskText('<task_json>"翻译这句话"</task_json>'),
    "翻译这句话",
  );
  assert.equal(
    reasoningTaskText([
      "planner policy",
      "<haolo_group_chat_assignment_request>",
      JSON.stringify({ userMessage: "你好" }),
      "</haolo_group_chat_assignment_request>",
    ].join("\n")),
    "你好",
  );
  assert.equal(
    reasoningTaskText("planner rules\n\n用户目标：\n\n把标题改短一点"),
    "把标题改短一点",
  );
});
