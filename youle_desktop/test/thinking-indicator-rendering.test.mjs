import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("thinking indicator is suppressed once the active turn has a final answer", async () => {
  const source = await mainSource;
  const thinkingBlock = sourceBlock(
    source,
    "function withThinkingMessage",
    "function hasActiveFinalAnswerMessage",
  );

  assert.match(thinkingBlock, /isThreadBusy\(threadId\)/);
  assert.match(thinkingBlock, /if \(!busy\) return visible/);
  assert.match(thinkingBlock, /if \(hasActiveFinalAnswerMessage\(threadId\)\) return visible/);
  assert.match(thinkingBlock, /id: `thinking-\$\{threadId\}`/);
  assert.match(thinkingBlock, /const thinkingStage = activeCodexThinkingStage\(threadId\)/);
  assert.match(thinkingBlock, /text: thinkingStage\.label/);
});

test("thinking state names the observable request phase instead of showing one generic wait", async () => {
  const source = await mainSource;
  const stageBlock = sourceBlock(
    source,
    "function activeCodexThinkingStage",
    "function dedupeAdjacentRenderedUserMessages",
  );

  assert.match(stageBlock, /activeTurnIdForThread\(threadId\)/);
  assert.match(stageBlock, /itemTurnId\(item\) === activeTurnId/);
  assert.match(stageBlock, /label: "正在准备请求"/);
  assert.match(stageBlock, /label: "等待模型响应"/);
  assert.match(stageBlock, /请求已提交，正在等待首个模型事件/);
  assert.match(stageBlock, /latestItem\.type === "reasoning"/);
  assert.match(stageBlock, /label: "模型正在推理"/);
  assert.match(stageBlock, /latestItem\.type === "plan"/);
  assert.match(stageBlock, /label: "正在规划任务"/);
  assert.match(stageBlock, /latestItem\.type === "agentMessage"/);
  assert.match(stageBlock, /label: "正在生成回复"/);
  assert.match(stageBlock, /label: "智能体正在执行"/);
});

test("thinking phase metadata stays visible and theme-safe", async () => {
  const [source, styles] = await Promise.all([mainSource, stylesSource]);
  const bubbleBlock = sourceBlock(
    source,
    "type ThinkingStagePresentation",
    "function localGroupChatMessageMember",
  );
  const patchBlock = sourceBlock(
    source,
    "function patchActiveThinkingElapsed",
    "function patchThinkingHoverMetaPart",
  );

  assert.match(bubbleBlock, /class="thinking-stage-label"/);
  assert.match(bubbleBlock, /class="thinking-status-meta"/);
  assert.match(bubbleBlock, /class="thinking-stage-detail"/);
  assert.match(bubbleBlock, /data-thinking-stage/);
  assert.match(patchBlock, /activeCodexThinkingStage\(threadId\)/);
  assert.match(patchBlock, /stageLabel\.textContent = stage\.label/);
  assert.match(patchBlock, /bubble\.dataset\.thinkingStage = stage\.key/);
  assert.match(patchBlock, /stage\.detail/);

  assert.match(styles, /\.thinking-text\s*\{[\s\S]*border:\s*1px solid var\(--border-subtle\)[\s\S]*background:\s*var\(--bubble-agent\)/);
  assert.match(styles, /\.thinking-status-meta\s*\{[\s\S]*color:\s*var\(--text-tertiary\)/);
  assert.match(styles, /\.thinking-status-meta \.thinking-stage-detail\s*\{[\s\S]*color:\s*var\(--text-subtle\)/);
  assert.match(styles, /\.thinking-dots i\s*\{[\s\S]*background:\s*currentColor/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.thinking-dots i[\s\S]*animation:\s*none/);
});

test("reasoning placeholders are localized and do not leak provider debug text", async () => {
  const source = await mainSource;
  const itemTextBlock = sourceBlock(source, "function itemText", "function sanitizeIncomingThreadItem");

  assert.match(itemTextBlock, /模型正在推理/);
  assert.doesNotMatch(itemTextBlock, /Thinking\.\.\./);
});

test("final answer detection is scoped to the current busy response and final phase", async () => {
  const source = await mainSource;
  const activeFinalBlock = sourceBlock(
    source,
    "function hasActiveFinalAnswerMessage",
    "function isFinalAnswerAgentItem",
  );

  assert.match(activeFinalBlock, /activeThinkingResponseId\(\{/);
  assert.match(activeFinalBlock, /providerBusy: isProviderThreadBusy\(threadId\)/);
  assert.match(activeFinalBlock, /providerInteractionId: activeProviderInteractionByThreadId\.get\(threadId\)/);
  assert.match(activeFinalBlock, /codexBusy: activeCodexThreadIds\.has\(threadId\)/);
  assert.match(activeFinalBlock, /activeTurnIdForThread\(threadId\)/);
  assert.match(activeFinalBlock, /isFinalAnswerForThinkingResponse\(activeResponseId/);
  assert.match(activeFinalBlock, /responseId: itemTurnId\(item\)/);
  assert.match(activeFinalBlock, /isFinalAnswer: isFinalAnswerAgentItem\(item\)/);
  assert.match(
    activeFinalBlock,
    /itemText\(item\)\.trim\(\)[\s\S]*?\|\| itemAttachments\(item\)\.length[\s\S]*?\|\| messageActionsFromItem\(item\)\?\.length/,
  );
  assert.doesNotMatch(activeFinalBlock, /itemTurn && itemTurn !== activeTurnId/);

  const finalItemBlock = sourceBlock(
    source,
    "function isFinalAnswerAgentItem",
    "function isThinkingNoiseMessage",
  );
  const phaseBlock = sourceBlock(
    source,
    "function agentMessagePhase",
    "function isConclusiveAgentReplyItem",
  );

  assert.match(finalItemBlock, /item\.type !== "agentMessage"/);
  assert.match(finalItemBlock, /agentMessagePhase\(item\) === "final_answer"/);
  assert.match(phaseBlock, /record\.phase/);
  assert.match(phaseBlock, /record\.message_phase/);
  assert.match(phaseBlock, /record\.messagePhase/);
});

test("new process messages keep the live thinking row mounted", async () => {
  const source = await mainSource;
  const patchBlock = sourceBlock(
    source,
    "function patchMessageScrollerContent",
    "function renderChatHeader",
  );
  const appendBlock = sourceBlock(
    source,
    "function appendNewMessageRowsBeforeThinkingRow",
    "function renderChatHeader",
  );

  assert.match(patchBlock, /appendNewMessageRowsBeforeThinkingRow/);
  assert.match(patchBlock, /isThinkingMessage\(message\)[\s\S]*row\.classList\.contains\("thinking-row"\)[\s\S]*patchActiveThinkingElapsed\(\)[\s\S]*return/);
  assert.match(appendBlock, /const thinkingRow = existingRows\.at\(-1\)/);
  assert.match(appendBlock, /thinkingRow\.before\(row\)/);
  assert.match(appendBlock, /return \[\.\.\.existingRows\.slice\(0, -1\), \.\.\.insertedRows, thinkingRow\]/);
  assert.doesNotMatch(appendBlock, /thinkingRow\.(?:replaceWith|remove|innerHTML\s*=)/);
});
