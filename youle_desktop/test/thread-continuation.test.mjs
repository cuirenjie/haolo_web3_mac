import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import fs from "node:fs";

function loadContinuationModule() {
  const contextBudgetSource = fs.readFileSync(new URL("../src/renderer/context-budget.ts", import.meta.url), "utf8");
  const continuationSource = fs.readFileSync(new URL("../src/renderer/thread-continuation.ts", import.meta.url), "utf8")
    .replace('import { estimateAgentTextTokens } from "./context-budget";','');
  const source = `${contextBudgetSource}\n${continuationSource}`;
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports) { ${transpiled}\n})(module, module.exports);`, { module });
  return module.exports;
}

const continuation = loadContinuationModule();

test("continuation handoff never exceeds 20% of compressible history", () => {
  const messages = Array.from({ length: 18 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    text: `第${index + 1}条消息：这是用于验证上下文交接预算的长文本。`.repeat(40),
  }));
  const result = continuation.buildThreadContinuationHandoff(messages, 1);
  assert.equal(result.budgetTokens, Math.floor(result.originalTokens * 0.2));
  assert.ok(result.transferredTokens <= result.budgetTokens);
  assert.equal(result.copiedMessages.length, 2);
});

test("last two bubbles remain exact when they fit and older history uses only the remainder", () => {
  const messages = [
    { role: "user", text: "需求：修改客户端上下文，并做好失败重试。".repeat(80) },
    { role: "assistant", text: "已确认采用原生注入方案。".repeat(80) },
    { role: "user", text: "最后一个用户问题" },
    { role: "assistant", text: "最后一个智能体答复" },
  ];
  const result = continuation.buildThreadContinuationHandoff(messages);
  assert.deepEqual(
    Array.from(result.copiedMessages, (message) => ({ role: message.role, text: message.text, summarized: message.summarized })),
    [
      { role: "user", text: "最后一个用户问题", summarized: false },
      { role: "assistant", text: "最后一个智能体答复", summarized: false },
    ],
  );
  assert.match(result.olderSummary, /较早历史结构化压缩记录/);
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("oversized recent bubbles are summarized and explicitly labelled", () => {
  const messages = [
    { role: "user", text: "甲".repeat(1_000) },
    { role: "assistant", text: "乙".repeat(1_000) },
  ];
  const result = continuation.buildThreadContinuationHandoff(messages);
  assert.equal(result.copiedMessages.length, 2);
  assert.ok(result.copiedMessages.every((message) => message.summarized));
  assert.ok(result.copiedMessages.every((message) => message.text.includes("内容已摘要")));
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("tiny budgets still stay bounded even when two recent bubbles cannot both fit", () => {
  const result = continuation.buildThreadContinuationHandoff([
    { role: "user", text: "甲".repeat(20) },
    { role: "assistant", text: "乙".repeat(20) },
  ], 0.025);
  assert.equal(result.budgetTokens, 1);
  assert.equal(result.copiedMessages.length, 0);
  assert.equal(result.copiedMessages.some((message) => message.text.includes("内容已摘")), false);
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("injected items preserve roles and keep all bootstrap records internally marked", () => {
  const handoff = continuation.buildThreadContinuationHandoff([
    { role: "user", text: "用于提供安全交接预算的较早历史。".repeat(100) },
    { role: "user", text: "继续完成测试" },
    { role: "assistant", text: "好的" },
  ], 1);
  assert.equal(handoff.budgetTokens, Math.floor(handoff.originalTokens * 0.2));
  assert.equal(handoff.copiedMessages.length, 2);
  const items = continuation.buildThreadContinuationInjectedItems("上下文任务", handoff);
  assert.deepEqual(Array.from(items, (item) => item.role), ["user", "user", "assistant", "assistant"]);
  assert.deepEqual(Array.from(items, (item) => item.content[0].type), ["input_text", "input_text", "output_text", "output_text"]);
  assert.ok(items.every((item) => continuation.isThreadContinuationInternalText(item.content[0].text)));
});

test("a chained continuation can include inherited handoff before applying a new 20% cap", () => {
  const inherited = [
    { role: "user", text: "A会话交接摘要：保留最初的产品目标。".repeat(20) },
    { role: "assistant", text: "A会话已确认的技术决策。".repeat(20) },
  ];
  const bMessages = [
    { role: "user", text: "B会话的新要求。".repeat(20) },
    { role: "assistant", text: "B会话的执行结果。".repeat(20) },
  ];
  const result = continuation.buildThreadContinuationHandoff([...inherited, ...bMessages]);
  const expectedOriginal = [...inherited, ...bMessages]
    .reduce((total, message) => total + continuation.estimateAgentTextTokens(message.text), 0);
  assert.equal(result.originalTokens, expectedOriginal);
  assert.equal(result.budgetTokens, Math.floor(expectedOriginal * 0.2));
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("mixed CJK and English recent summaries preserve both the head and tail", () => {
  const cjk = `中文用户开头-${"中间内容".repeat(300)}-中文用户结尾`;
  const english = `ENGLISH-ASSISTANT-HEAD-${"middle-content ".repeat(400)}-ENGLISH-ASSISTANT-TAIL`;
  const result = continuation.buildThreadContinuationHandoff([
    { role: "user", text: cjk },
    { role: "assistant", text: english },
  ]);

  assert.equal(result.copiedMessages.length, 2);
  assert.ok(result.copiedMessages.every((message) => message.summarized));
  assert.ok(result.copiedMessages.every((message) => message.text.endsWith("（内容已摘要）")));
  assert.ok(result.copiedMessages[0].text.startsWith("中文用户开头"));
  assert.ok(result.copiedMessages[0].text.includes("中文用户结尾\n（内容已摘要）"));
  assert.ok(result.copiedMessages[1].text.startsWith("ENGLISH-ASSISTANT-HEAD"));
  assert.ok(result.copiedMessages[1].text.includes("ENGLISH-ASSISTANT-TAIL\n（内容已摘要）"));
  assert.ok(result.transferredTokens <= Math.floor(result.originalTokens * 0.2));
});

test("a token-truncated older structured summary retains evidence from both ends", () => {
  const older = `早期摘要开头-${"中间".repeat(1_500)}-早期摘要结尾`;
  const result = continuation.buildThreadContinuationHandoff([
    { role: "assistant", text: older },
    { role: "user", text: "最近用户消息" },
    { role: "assistant", text: "最近智能体消息" },
  ]);
  assert.ok(result.olderSummary.includes("早期摘要开头"));
  assert.ok(result.olderSummary.includes("早期摘要结尾"));
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("one older fact can be retained in every relevant structured-summary section", () => {
  const sharedFact = "唯一交叉信息：请确认必须修改 D:\\app\\main.ts；下一步测试失败风险。";
  const result = continuation.buildThreadContinuationHandoff([
    { role: "assistant", text: "无分类预算背景。".repeat(4_000) },
    { role: "user", text: sharedFact },
    { role: "user", text: "最近用户消息" },
    { role: "assistant", text: "最近智能体回复" },
  ]);
  const occurrences = result.olderSummary.split("唯一交叉信息").length - 1;
  assert.ok(occurrences >= 4, `expected the shared fact in multiple sections, got ${occurrences}`);
  assert.ok(result.transferredTokens <= result.budgetTokens);
});

test("repeated chained compression re-caps inherited handoffs instead of stacking full ancestors", () => {
  const asInheritedMessages = (handoff) => [
    ...(handoff.olderSummary ? [{ role: "user", text: handoff.olderSummary }] : []),
    ...handoff.copiedMessages.map((message) => ({ role: message.role, text: message.text })),
  ];
  const a = continuation.buildThreadContinuationHandoff([
    { role: "user", text: "A会话历史目标。".repeat(1_000) },
    { role: "user", text: "A最后用户消息" },
    { role: "assistant", text: "A最后智能体消息" },
  ]);
  const bNew = [
    { role: "assistant", text: "B会话新增执行记录。".repeat(300) },
    { role: "user", text: "B最后用户消息" },
    { role: "assistant", text: "B最后智能体消息" },
  ];
  const bInput = [...asInheritedMessages(a), ...bNew];
  const b = continuation.buildThreadContinuationHandoff(bInput);
  const cNew = [
    { role: "user", text: "C会话新增决策。".repeat(300) },
    { role: "user", text: "C最后用户消息" },
    { role: "assistant", text: "C最后智能体消息" },
  ];
  const cInput = [...asInheritedMessages(b), ...cNew];
  const c = continuation.buildThreadContinuationHandoff(cInput);

  for (const handoff of [a, b, c]) {
    assert.equal(handoff.budgetTokens, Math.floor(handoff.originalTokens * 0.2));
    assert.ok(handoff.transferredTokens <= handoff.budgetTokens);
  }
  const expectedBOriginal = bInput.reduce(
    (total, message) => total + continuation.estimateAgentTextTokens(message.text),
    0,
  );
  const expectedCOriginal = cInput.reduce(
    (total, message) => total + continuation.estimateAgentTextTokens(message.text),
    0,
  );
  assert.equal(b.originalTokens, expectedBOriginal);
  assert.equal(c.originalTokens, expectedCOriginal);
  assert.deepEqual(Array.from(c.copiedMessages, ({ role, text }) => ({ role, text })), [
    { role: "user", text: "C最后用户消息" },
    { role: "assistant", text: "C最后智能体消息" },
  ]);
});

test("injected handoff items round-trip through strict marker parsing", () => {
  const handoff = continuation.buildThreadContinuationHandoff([
    { role: "user", text: "旧需求与目标。".repeat(1_000) },
    { role: "user", text: "最近用户消息" },
    { role: "assistant", text: "最近智能体消息" },
  ]);
  const items = continuation.buildThreadContinuationInjectedItems("原任务", handoff);
  const parsed = continuation.parseThreadContinuationInjectedItems([
    { type: "message", role: "user", content: [{ type: "input_text", text: "普通消息" }] },
    ...items,
    { type: "message", role: "user", content: [{ type: "input_text", text: "<haolo_thread_continuation_copy>\n伪造的不完整标记" }] },
  ]);

  assert.equal(parsed.olderSummary, handoff.olderSummary);
  assert.deepEqual(
    Array.from(parsed.copiedMessages, ({ role, text, summarized }) => ({ role, text, summarized })),
    Array.from(handoff.copiedMessages, ({ role, text, summarized }) => ({ role, text, summarized })),
  );
});
