import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REFERENCED_MEDIA_INPUTS,
  MAX_REFERENCE_ENTRY_TOKENS,
  MAX_REFERENCE_TOTAL_TOKENS,
  MIN_REFERENCE_BUDGET_TOKENS,
  finalizeReferencedThreads,
  inspectReferencedThreads,
  normalizeThreadReferences,
  providerMessagesWithReferencedThreadContext,
  referencedContextBudgetTokens,
} from "../src/main/thread-reference-context.mjs";

test("normalizes referenced sessions, excludes the current session, and preserves selection order", () => {
  assert.deepEqual(
    normalizeThreadReferences(
      [
        { threadId: "thread-b", name: "第二个会话" },
        { threadId: "thread-current", name: "当前会话" },
        { thread_id: "thread-a", title: "第一个会话" },
        { threadId: "thread-b", name: "重复会话" },
      ],
      "thread-current",
    ),
    [
      { threadId: "thread-b", name: "第二个会话", cwd: null, selectionMode: "all", turnIds: [] },
      { threadId: "thread-a", name: "第一个会话", cwd: null, selectionMode: "all", turnIds: [] },
    ],
  );
});

test("keeps only explicitly selected turns for single and multiple references", () => {
  const references = [{
    threadId: "thread-a",
    name: "指定轮次会话",
    selectionMode: "single",
    turnIds: ["turn-2"],
  }];
  const threadResults = [{
    thread: {
      id: "thread-a",
      turns: [
        {
          id: "turn-1",
          items: [
            { type: "userMessage", content: [{ type: "text", text: "不应引用的第一轮" }] },
            { type: "agentMessage", text: "第一轮回答" },
            { type: "localImage", path: "D:/images/first.png" },
          ],
        },
        {
          id: "turn-2",
          items: [
            { type: "userMessage", content: [{ type: "text", text: "需要引用的第二轮" }] },
            { type: "agentMessage", text: "第二轮回答" },
            { type: "localImage", path: "D:/images/second.png" },
          ],
        },
      ],
    },
  }];

  const inspection = inspectReferencedThreads({ references, threadResults, budgetTokens: 100_000 });
  const finalized = finalizeReferencedThreads(inspection, { budgetTokens: 100_000 });
  const context = Object.values(finalized.additionalContext)[0].value;

  assert.doesNotMatch(context, /不应引用的第一轮|第一轮回答/);
  assert.match(context, /需要引用的第二轮/);
  assert.match(context, /第二轮回答/);
  assert.match(context, /"referenceSelectionMode":"single"/);
  assert.deepEqual(finalized.mediaInputs, [{ type: "localImage", path: "D:/images/second.png" }]);
});

test("accepts an inline question-answer snapshot and keeps its selected exchange", () => {
  const inlineThread = {
    id: "provider:kimi:conversation-1",
    name: "问答记录",
    turns: [
      {
        id: "provider-user-1",
        items: [
          { type: "userMessage", text: "第一问" },
          { type: "agentMessage", text: "第一答" },
        ],
      },
      {
        id: "provider-user-2",
        items: [
          { type: "userMessage", text: "第二问" },
          { type: "agentMessage", text: "第二答" },
        ],
      },
    ],
  };
  const references = normalizeThreadReferences([{
    threadId: inlineThread.id,
    name: inlineThread.name,
    selectionMode: "single",
    turnIds: ["provider-user-2"],
    inlineThread,
  }]);

  assert.deepEqual(references[0].inlineThread, inlineThread);
  const inspection = inspectReferencedThreads({
    references,
    threadResults: [{ thread: references[0].inlineThread }],
    budgetTokens: 100_000,
  });
  const context = Object.values(
    finalizeReferencedThreads(inspection, { budgetTokens: 100_000 }).additionalContext,
  )[0].value;

  assert.doesNotMatch(context, /第一问|第一答/);
  assert.match(context, /第二问/);
  assert.match(context, /第二答/);
});

test("injects finalized referenced sessions as provider system context", () => {
  const messages = [{ role: "user", content: "请根据引用内容回答" }];
  const result = providerMessagesWithReferencedThreadContext(messages, {
    additionalContext: {
      "haolo-referenced-thread-1": {
        kind: "application",
        value: "引用会话里的真实问答内容",
      },
    },
  });

  assert.equal(result[0].role, "system");
  assert.match(result[0].content, /补充上下文/);
  assert.match(result[0].content, /引用会话里的真实问答内容/);
  assert.deepEqual(result.slice(1), messages);
  assert.notEqual(result, messages);
});

test("keeps semantic messages and user media while omitting reasoning and tool-process payloads", () => {
  const references = [{ threadId: "thread-a", name: "包含附件的会话" }];
  const threadResults = [
    {
      thread: {
        id: "thread-a",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [
                  { type: "text", text: "请分析附件", attachments: [{ name: "report.pdf", path: "D:/docs/report.pdf" }] },
                  { type: "localImage", path: "D:/images/chart.png" },
                ],
              },
              {
                id: "tool-1",
                type: "mcpToolCall",
                tool: "inspect_document",
                status: "completed",
                result: { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }], text: "工具执行结果" },
              },
              {
                id: "reasoning-1",
                type: "reasoning",
                content: [{ type: "text", text: "内部推理过程" }],
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "最终结论：报告数据有效。",
              },
            ],
          },
        ],
      },
    },
  ];

  const inspection = inspectReferencedThreads({ references, threadResults, budgetTokens: 100_000 });
  const finalized = finalizeReferencedThreads(inspection, { budgetTokens: 100_000 });
  const context = Object.values(finalized.additionalContext)[0].value;

  assert.equal(finalized.compressed, false);
  assert.match(context, /report\.pdf/);
  assert.match(context, /最终结论：报告数据有效/);
  assert.match(context, /semantic_messages_complete_process_items_omitted/);
  assert.match(context, /"omittedProcessItems":2/);
  assert.doesNotMatch(context, /inspect_document|工具执行结果|内部推理过程/);
  assert.deepEqual(finalized.mediaInputs, [
    { type: "localImage", path: "D:/images/chart.png" },
    { type: "image", url: "data:image/png;base64,aGVsbG8=" },
  ]);
});

test("caps each referenced session below the indivisible compaction-item limit", () => {
  const references = [{ threadId: "thread-large", name: "超长会话" }];
  const threadResults = [{
    thread: {
      id: "thread-large",
      turns: [{
        id: "turn-large",
        items: [
          { type: "userMessage", text: "请总结" },
          { type: "agentMessage", text: `开头-${"中".repeat(220_000)}-结尾` },
        ],
      }],
    },
  }];

  const inspection = inspectReferencedThreads({
    references,
    threadResults,
    budgetTokens: MAX_REFERENCE_TOTAL_TOKENS,
  });
  const finalized = finalizeReferencedThreads(inspection, {
    budgetTokens: MAX_REFERENCE_TOTAL_TOKENS,
  });

  assert.equal(inspection.requiresCompression, true);
  assert.equal(finalized.compressed, true);
  assert.ok(finalized.estimatedTokens <= MAX_REFERENCE_ENTRY_TOKENS);
  const context = Object.values(finalized.additionalContext)[0].value;
  assert.match(context, /开头-/);
  assert.match(context, /-结尾/);
});

test("attaches only the most recent bounded set of semantic historical images", () => {
  const references = [{ threadId: "thread-images", name: "图片会话" }];
  const threadResults = [{
    thread: {
      id: "thread-images",
      turns: Array.from({ length: 12 }, (_, index) => ({
        id: `turn-${index}`,
        items: [
          { type: "userMessage", text: `图片 ${index}` },
          { type: "localImage", path: `D:/images/${index}.png` },
        ],
      })),
    },
  }];

  const inspection = inspectReferencedThreads({
    references,
    threadResults,
    budgetTokens: MAX_REFERENCE_TOTAL_TOKENS,
  });

  assert.equal(inspection.mediaInputs.length, MAX_REFERENCED_MEDIA_INPUTS);
  assert.deepEqual(
    inspection.mediaInputs.map((input) => input.path),
    Array.from({ length: MAX_REFERENCED_MEDIA_INPUTS }, (_, index) => `D:/images/${index + 4}.png`),
  );
});

test("compresses many large referenced sessions within the shared total token budget", () => {
  const references = Array.from({ length: 10 }, (_, index) => ({ threadId: `thread-${index}`, name: `会话-${index}` }));
  const threadResults = references.map((reference) => ({
    thread: {
      id: reference.threadId,
      turns: [{ id: "turn", items: [{ type: "agentMessage", text: "中".repeat(120_000) }] }],
    },
  }));
  const inspection = inspectReferencedThreads({ references, threadResults, budgetTokens: MIN_REFERENCE_BUDGET_TOKENS });
  const finalized = finalizeReferencedThreads(inspection, { budgetTokens: MIN_REFERENCE_BUDGET_TOKENS });

  assert.equal(inspection.requiresCompression, true);
  assert.equal(finalized.compressed, true);
  assert.ok(finalized.estimatedTokens <= MIN_REFERENCE_BUDGET_TOKENS);
  assert.equal(Object.keys(finalized.additionalContext).length, references.length);
});

test("reports no reference budget when the active session already occupies the automatic compaction threshold", () => {
  assert.equal(
    referencedContextBudgetTokens({
      currentContextTokens: 299_000,
      messageTokens: 1_000,
      modelContextWindow: 380_000,
    }),
    0,
  );
});

test("caps referenced-session context at a conservative shared budget", () => {
  assert.equal(
    referencedContextBudgetTokens({
      currentContextTokens: 0,
      messageTokens: 1_000,
      modelContextWindow: 380_000,
    }),
    MAX_REFERENCE_TOTAL_TOKENS,
  );
});
