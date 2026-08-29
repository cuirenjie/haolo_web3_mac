import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkflowFinalResponse,
  parseWorkflowNodeResponse,
  workflowFinalResponseFormatInstructions,
  workflowNodeResponseFormatInstructions,
} from "../src/main/workflow/node-response.mjs";

test("workflow node response keeps the full result separate from its human chat summary", () => {
  const original = [
    "## 故事蓝图",
    "公元 2091 年，全球协调网络接管关键基础设施。",
    "这里是完整的长篇节点正文，供下游继续使用。",
  ].join("\n");
  const parsed = parseWorkflowNodeResponse([
    "<haolo_chat_summary>",
    "我这边先把世界观和规则理顺了，核心冲突是效率与选择权之间的拉扯，后面可以直接接人物线。",
    "</haolo_chat_summary>",
    "<haolo_node_result>",
    original,
    "</haolo_node_result>",
  ].join("\n"));

  assert.equal(parsed.text, original);
  assert.match(parsed.chatSummary, /^我这边/);
  assert.match(parsed.chatSummary, /效率与选择权/);
  assert.doesNotMatch(parsed.chatSummary, /##|公元 2091 年|完整的长篇节点正文/);
});

test("workflow node response uses a conversational fallback without excerpting untagged output", () => {
  const original = "## 原始长文\n这是不应进入群聊气泡的完整原文。".repeat(20);
  const parsed = parseWorkflowNodeResponse(original, {
    title: "技术逻辑审校",
    purpose: "检查故事中的技术漏洞",
  });

  assert.equal(parsed.text, original);
  assert.match(parsed.chatSummary, /^我这边/);
  assert.match(parsed.chatSummary, /检查故事中的技术漏洞/);
  assert.doesNotMatch(parsed.chatSummary, /原始长文|不应进入群聊气泡/);
});

test("workflow node prompt requests a short first-person summary and a separate complete result", () => {
  const instructions = workflowNodeResponseFormatInstructions();

  assert.match(instructions, /<haolo_chat_summary>/);
  assert.match(instructions, /第一人称/);
  assert.match(instructions, /不超过 100 个汉字/);
  assert.match(instructions, /不要写标题、Markdown、列表/);
  assert.match(instructions, /<haolo_node_result>/);
  assert.match(instructions, /完整、严谨的节点结果/);
  assert.match(instructions, /<haolo_node_meta>/);
  assert.match(instructions, /requirementsSatisfied/);
});

test("workflow node response exposes a backward-compatible self-check envelope", () => {
  const parsed = parseWorkflowNodeResponse([
    "<haolo_chat_summary>我这边完成了检查。</haolo_chat_summary>",
    "<haolo_node_result>完整结果</haolo_node_result>",
    '<haolo_node_meta>{"status":"succeeded","confidence":0.82,"requirementsSatisfied":true,"failureReason":""}</haolo_node_meta>',
  ].join("\n"));

  assert.equal(parsed.text, "完整结果");
  assert.equal(parsed.status, "succeeded");
  assert.equal(parsed.confidence, 0.82);
  assert.equal(parsed.requirementsSatisfied, true);
});

test("frozen workflow node responses fail closed when mandatory metadata is missing or invalid", () => {
  const missing = parseWorkflowNodeResponse("plain result", { requireMeta: true });
  const invalid = parseWorkflowNodeResponse([
    "<haolo_node_result>result</haolo_node_result>",
    "<haolo_node_meta>{not-json}</haolo_node_meta>",
  ].join("\n"), { requireMeta: true });
  const incomplete = parseWorkflowNodeResponse([
    "<haolo_node_result>result</haolo_node_result>",
    "<haolo_node_meta>{}</haolo_node_meta>",
  ].join("\n"), { requireMeta: true });

  assert.equal(missing.status, "failed");
  assert.match(missing.failureReason, /missing|invalid/i);
  assert.equal(invalid.status, "failed");
  assert.equal(incomplete.status, "failed");
  assert.equal(parseWorkflowNodeResponse("legacy result").status, "succeeded");
});

test("root final acceptance separates the user answer from its mandatory outcome", () => {
  const parsed = parseWorkflowFinalResponse([
    "The requested artifact is complete and verified.",
    '<haolo_final_meta>{"goalAchieved":true,"confidence":0.93,"failureReason":""}</haolo_final_meta>',
  ].join("\n"));

  assert.equal(parsed.text, "The requested artifact is complete and verified.");
  assert.equal(parsed.metaPresent, true);
  assert.equal(parsed.goalAchieved, true);
  assert.equal(parsed.confidence, 0.93);
  assert.match(workflowFinalResponseFormatInstructions(), /goalAchieved/);
});

test("missing root final acceptance metadata can never become a false success", () => {
  const parsed = parseWorkflowFinalResponse("I could not complete the requested artifact.");

  assert.equal(parsed.metaPresent, false);
  assert.equal(parsed.goalAchieved, false);
  assert.match(parsed.failureReason, /missing/i);
});
