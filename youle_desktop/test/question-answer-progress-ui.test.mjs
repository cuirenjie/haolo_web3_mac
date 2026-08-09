import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const providerLoopSource = readFile(new URL("../src/main/workflow/question-answer-provider-loop.mjs", import.meta.url), "utf8");

test("question-answer progress crosses the main/preload boundary without exposing private reasoning", async () => {
  const [main, preload] = await Promise.all([mainSource, preloadSource]);
  assert.match(main, /createQuestionAnswerProgressEmitter/);
  assert.match(main, /QUESTION_ANSWER_PROGRESS_CHANNEL/);
  assert.match(main, /onProgress:\s*emitQuestionAnswerProgress/);
  assert.match(preload, /onQuestionAnswerProgress:\s*\(callback\)\s*=>\s*on\("questionAnswer:progress", callback\)/);
  assert.doesNotMatch(main, /emitQuestionAnswerProgress\(\{[\s\S]{0,500}(?:rationale|systemPrompt|chainOfThought|chain_of_thought):/);
});

test("chat uses the ordinary thinking bubble while the system board keeps full progress", async () => {
  const [source, providerLoop] = await Promise.all([rendererSource, providerLoopSource]);
  assert.match(source, /function applyQuestionAnswerProgressEvent/);
  assert.doesNotMatch(source, /function renderQuestionAnswerProgressBubble/);
  assert.match(source, /function renderQuestionAnswerProgressBoard/);
  assert.match(
    source,
    /questionAnswerProgress[\s\S]*?renderThinkingBubble\([\s\S]*?activeThinkingElapsedLabel/,
  );
  assert.match(
    source,
    /questionAnswerProgress\.status === "running"/,
  );
  assert.match(
    source,
    /function shouldRenderQuestionAnswerProgressMessage[\s\S]*?questionAnswerStreamItemId\(progress\.interactionId\)[\s\S]*?!itemText\(streamItem\)\.trim\(\)/,
  );
  assert.match(source, /questionAnswerProgress\?\.provider \|\| effectiveProviderForThread/);
  assert.match(source, /PROVIDER_CHAT_META\[progress\.provider\]/);
  assert.match(source, /questionAnswerProgressFromItem\(item\)/);
  assert.match(source, /questionAnswerProgressFromItem\(item\)\) continue/);
  assert.match(source, /function settleQuestionAnswerProgressSteps/);
  assert.match(source, /step\.status === "running"[\s\S]*\{ \.\.\.step, status, timestamp \}/);
  assert.match(
    source,
    /runStatus === "running"[\s\S]*settleQuestionAnswerProgressSteps\(existing\?\.steps \|\| \[\], runStatus, timestamp\)/,
  );
  assert.match(providerLoop, /不附带分组文件上下文/);
  assert.match(providerLoop, /Haolo 语义选中的必要文件资料/);
});

test("question-answer board and shared thinking bubble retain light and dark theme coverage", async () => {
  const styles = await stylesSource;
  for (const selector of [
    ".thinking-bubble",
    ".question-answer-workflow-steps > li.running",
    ".question-answer-workflow-steps > li.completed",
    ".question-answer-workflow-steps > li.failed",
    ".question-answer-progress-bubble.failed",
    'html[data-theme="dark"] .question-answer-workflow-steps article',
    'html[data-theme="dark"] .question-answer-workflow-steps > li.failed article',
    'html[data-theme="dark"] .question-answer-progress-bubble.failed',
    "@media (prefers-reduced-motion: reduce)",
  ]) {
    assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    styles,
    /\.question-answer-workflow-steps > li\.running article\s*\{[^}]*box-shadow:\s*none;/,
    "running board cards should not render a left accent stripe",
  );
  assert.match(
    styles,
    /\.question-answer-workflow-step-head strong\s*\{[^}]*font-weight:\s*400;/,
    "board progress titles should use regular weight",
  );
});
