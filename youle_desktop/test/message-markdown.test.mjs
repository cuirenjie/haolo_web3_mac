import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { stripLeadingMarkdownThematicBreak } from "../src/renderer/message-markdown.ts";

test("assistant reports hide only a leading markdown separator", () => {
  assert.equal(
    stripLeadingMarkdownThematicBreak("---\n\n## BINANCE:FUTURES:SNDKUSDT · 1日缠论分析\n\n正文"),
    "## BINANCE:FUTURES:SNDKUSDT · 1日缠论分析\n\n正文",
  );
  assert.equal(
    stripLeadingMarkdownThematicBreak("\n  - - -  \n\n分析正文"),
    "分析正文",
  );
  assert.equal(
    stripLeadingMarkdownThematicBreak("分析正文\n\n---\n\n数据范围"),
    "分析正文\n\n---\n\n数据范围",
  );
});

test("assistant bubbles enable leading separator removal without changing user bubbles", async () => {
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const start = renderer.indexOf("function renderTextBubble");
  const end = renderer.indexOf("function shouldLocalizeAppOwnedMessage", start);
  const block = renderer.slice(start, end);
  const userBranchStart = block.indexOf("const messageTextMarkup = fromUser");
  const assistantBranchStart = block.indexOf(": executionPlanPresentation?.bubbleContent", userBranchStart);
  const userBranch = block.slice(userBranchStart, assistantBranchStart);

  assert.match(block, /renderMessageExecutionPlan\(message, content\.text,[\s\S]*?hideLeadingThematicBreak: true/);
  assert.match(block, /executionPlanPresentation\?\.bubbleContent \?\? formatMessageText\(content\.text,[\s\S]*?hideLeadingThematicBreak: true/);
  assert.match(userBranch, /assistantSkillDisplayAliases: false/);
  assert.doesNotMatch(userBranch, /hideLeadingThematicBreak/);
});
