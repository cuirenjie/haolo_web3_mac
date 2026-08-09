import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("context compaction stays visible through requesting, compacting, completed, and failed states", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);

  const automaticCompaction = sourceSection(
    renderer,
    "function requestAutomaticThreadContextCompaction",
    "async function prepareContextBudgetForSend",
  );
  assert.match(automaticCompaction, /api\.compactThread\(\{[\s\S]*threadId,[\s\S]*cwd:[\s\S]*selectedChatModelRequestOptions\(threadId\)/);
  assert.match(automaticCompaction, /beginLocalContextCompactionItem\(threadId\)/);
  assert.match(automaticCompaction, /setActiveContextCompactionUiStatus\(threadId, "completed"\)/);

  const preSendBudget = sourceSection(
    renderer,
    "async function prepareContextBudgetForSend",
    "async function sendCurrentMessage",
  );
  assert.match(preSendBudget, /await requestAutomaticThreadContextCompaction\(threadId\)/);

  const send = sourceSection(renderer, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  assert.ok(
    send.indexOf("beginPendingComposerSend(threadId") < send.indexOf("await prepareContextBudgetForSend(threadId, initialAgentText"),
    "the optimistic user bubble must exist before context preparation can compact or fail",
  );

  const snapshotMerge = sourceSection(renderer, "function shouldPreserveExistingThreadItem", "function shouldPreserveLocalHistoryAheadItem");
  assert.match(snapshotMerge, /isContextCompactionItem\(item\)[\s\S]*options\.preserveUnmatched/);
  const optimistic = sourceSection(renderer, "function isOptimisticUserItemId", "function isWechatOptimisticUserItemId");
  assert.match(optimistic, /local-pending-send-/);

  const completedTurn = sourceSection(renderer, 'case "turn\/completed":', 'case "turn\/failed":');
  assert.match(completedTurn, /compactionCompletedWithoutItemNotification/);
  assert.match(completedTurn, /!completedTurnFailed[\s\S]*wasPureContextCompactionTurn/);
  assert.match(completedTurn, /completeContextCompactionFromNotification\(threadId, message\)/);
  assert.match(completedTurn, /armThreadContinuationFromCompactionNotification/);
  assert.doesNotMatch(completedTurn, /上下文压缩未完成/);
  assert.doesNotMatch(completedTurn, /failLatestOptimisticUserItem/);

  const startedTurn = sourceSection(renderer, 'case "turn\/started":', 'case "turn\/completed":');
  assert.match(
    startedTurn,
    /!contextCompactionPromises\.has\(threadId\)[\s\S]*clearInFlightPendingComposerSendForThread\(threadId\)/,
  );

  const statusRenderer = sourceSection(renderer, "function renderContextCompactionBubble", "function renderThinkingBubble");
  assert.match(statusRenderer, /正在准备压缩上下文/);
  assert.match(statusRenderer, /正在压缩上下文/);
  assert.match(statusRenderer, /上下文压缩成功/);
  assert.match(statusRenderer, /上下文压缩失败/);
  assert.match(statusRenderer, /context-compaction-error/);
  assert.match(statusRenderer, /thinking-dots/);
  assert.match(statusRenderer, /context-compaction-elapsed/);
  assert.match(statusRenderer, /HANDLED_STATUS_LABEL/);

  const itemMapping = sourceSection(renderer, "function itemToMessage", "function withLocalSendStatus");
  assert.match(itemMapping, /isContextCompactionItem\(item\)/);
  assert.match(itemMapping, /contextCompactionUiStatusFromItem\(item\)/);

  const hiddenItems = sourceSection(renderer, "function shouldHideChatItem", "function isHiddenRoleItem");
  assert.doesNotMatch(hiddenItems, /isContextCompactionItem\(item\)/);
  assert.match(styles, /\.context-compaction-bubble/);
  assert.match(styles, /\.context-compaction-row:hover \.context-compaction-elapsed/);
  assert.match(styles, /\.context-compaction-bubble\.completed/);
  assert.match(styles, /\.context-compaction-bubble\.failed/);
  assert.match(styles, /\.context-compaction-text\s*\{[\s\S]*?border-radius:\s*999px[\s\S]*?padding:\s*6px 12px[\s\S]*?font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\)[\s\S]*?font-weight:\s*400[\s\S]*?line-height:\s*normal/);
  assert.match(styles, /html\[data-theme="dark"\] \.context-compaction-bubble\.completed/);
  assert.match(styles, /html\[data-theme="dark"\] \.context-compaction-bubble\.failed/);

  const thinkingMessages = sourceSection(renderer, "function withThinkingMessage", "function hasActiveFinalAnswerMessage");
  assert.match(thinkingMessages, /hasActiveContextCompaction\(threadId\)/);
  assert.match(thinkingMessages, /contextCompactionPromises\.has\(threadId\)/);
  assert.match(thinkingMessages, /status === "requesting" \|\| status === "compacting"/);

  const thinkingBubble = sourceSection(renderer, "function thinkingContextUsageLabel", "function renderMessageAvatar");
  assert.match(thinkingBubble, /contextUsageProgressState\(id\)/);
  assert.match(thinkingBubble, /thinking-context-usage/);
  assert.match(thinkingBubble, /\u4e0a\u4e0b\u6587/);
  assert.match(styles, /\.thinking-elapsed\s*\{[\s\S]*?display:\s*flex/);
  assert.match(styles, /\.thinking-context-usage/);

  const elapsedTimer = sourceSection(renderer, "function hasAnyActiveElapsedStatus", "function patchThinkingHoverMetaPart");
  assert.match(elapsedTimer, /hasActiveContextCompaction\(state\.currentThreadId\)/);
  assert.match(elapsedTimer, /patchActiveContextCompactionElapsed\(\)/);
  assert.match(elapsedTimer, /contextCompactionElapsedLabel\(threadId, item\)/);
});
