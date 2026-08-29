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

test("thread history remains a local user-message index after global search removal", async () => {
  const source = await mainSource;
  const historyBlock = sourceBlock(source, "function renderThreadHistoryPopover", "function threadListDisplayName");
  const entryBlock = sourceBlock(source, "function threadHistoryEntriesFromMessages", "function threadHistoryEntriesFromSnapshot");
  const snapshotBlock = sourceBlock(source, "function threadHistoryEntriesFromSnapshot", "function threadHistoryGeneration");
  const hoverBlock = sourceBlock(source, "function beginThreadHistoryHover", "function endThreadHistoryHover");
  const showBlock = sourceBlock(source, "function showThreadHistoryPopover", "function threadHistoryPopoverAnchorCenterY");

  assert.match(source, /type ThreadHistoryEntry = \{[\s\S]*label: string;[\s\S]*fromUser: boolean;/);
  assert.match(entryBlock, /threadHistorySearchableMessages\(threadId, messages\)/);
  assert.match(entryBlock, /threadHistoryEntryLabel/);
  assert.match(snapshotBlock, /sanitizeIncomingThreadItem\(item, threadId\)/);
  assert.match(snapshotBlock, /dedupeRenderedOptimisticUserMessages\([\s\S]*orderedThreadItems\(thread\)/);
  assert.match(snapshotBlock, /\.filter\(isRenderedUserSideMessage\)/);
  assert.match(historyBlock, /thread\.thread_kind !== "local_codex"/);
  assert.match(historyBlock, /resumeThreadForBackgroundHydration\(threadId, backgroundSession\)/);
  assert.match(historyBlock, /generation !== threadHistoryGeneration\(threadId\)/);
  assert.match(historyBlock, /threadHistoryEntriesByThreadId\.set\(threadId, entries\)/);
  assert.doesNotMatch(historyBlock, /loadThreadInBackground/);
  assert.match(hoverBlock, /hasThreadHistoryPopoverEntries\(knownEntries\)/);
  assert.match(historyBlock, /return entries\.filter\(\(entry\) => entry\.fromUser\)\.length > 1/);
  assert.match(showBlock, /query: ""/);
  assert.doesNotMatch(historyBlock, /globalSearchMode|state\.search|conversationSearch/);
  assert.match(historyBlock, /window\.setTimeout\([\s\S]*120\)/);
});

test("legacy history labels still use the first sentence and attachment placeholders", async () => {
  const source = await mainSource;
  const historyBlock = sourceBlock(source, "function threadHistoryEntryLabel", "function knownThreadHistoryEntries");

  assert.match(historyBlock, /firstSentenceEndIndex\(firstLine\)/);
  assert.match(historyBlock, /return attachmentLabel \|\| "消息"/);
  assert.match(historyBlock, /return "图片"/);
  assert.match(historyBlock, /return "视频"/);
  assert.match(historyBlock, /return "音频"/);
  assert.match(historyBlock, /return "文档"/);
  assert.match(historyBlock, /return "文件"/);
});

test("popover search is local, filters user entries, and highlights matching labels", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const renderBlock = sourceBlock(source, "function renderThreadHistoryPopover", "function threadHistoryEntriesFromMessages");
  const originalBlock = sourceBlock(source, "function renderOriginalThreadHistoryOptions", "function hasThreadHistoryPopoverEntries");
  const showBlock = sourceBlock(source, "function showThreadHistoryPopover", "function threadHistoryPopoverAnchorCenterY");

  assert.match(renderBlock, /data-thread-history-search/);
  assert.match(renderBlock, /aria-label="搜索此对话"/);
  assert.match(renderBlock, /return renderOriginalThreadHistoryOptions\(popover\)/);
  assert.match(originalBlock, /const userEntries = popover\.entries\.filter\(\(entry\) => entry\.fromUser\)/);
  assert.match(originalBlock, /normalizedSearchText\(entry\.label\)\.includes\(normalizedSearchText\(query\)\)/);
  assert.match(originalBlock, /query \? renderHighlightedSearchText\(entry\.label, query\) : escapeHtml\(entry\.label\)/);
  assert.match(showBlock, /query: ""/);
  assert.match(renderBlock, /未找到相关内容/);
  assert.doesNotMatch(renderBlock, /globalSearchMode|state\.search|conversationSearch/);
  assert.match(styles, /\.thread-history-popover\s*\{[\s\S]*width: min\(336px, calc\(100vw - 24px\)\);[\s\S]*max-height: min\(392px, calc\(100vh - 24px\)\)/);
  assert.match(styles, /\.thread-history-search\s*\{[\s\S]*flex: 0 0 44px/);
  assert.match(styles, /\.thread-history-options\s*\{[\s\S]*max-height: 348px;[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.thread-history-option-text\s*\{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap/);
  assert.doesNotMatch(styles, /global-search-mode/);
  assert.doesNotMatch(styles, /\.thread-search-nav-button/);
  assert.doesNotMatch(styles, /message-search-highlight-(?:line|table-row)/);
});

test("every history popover option keeps its message time aligned at the right", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const timeBlock = sourceBlock(source, "function threadHistoryEntryTime", "function threadHistoryEntriesFromMessages");
  const entryBlock = sourceBlock(source, "function threadHistoryEntriesFromMessages", "function threadHistoryEntriesFromSnapshot");
  const snapshotBlock = sourceBlock(source, "function threadHistoryEntriesFromSnapshot", "function threadHistoryGeneration");
  const optionsBlock = sourceBlock(source, "function renderOriginalThreadHistoryOptions", "function hasThreadHistoryPopoverEntries");

  assert.match(source, /type ThreadHistoryEntry = \{[\s\S]*time: string;/);
  assert.match(timeBlock, /firstString\(message\.time\) \|\| formatThreadTime\(firstString\(message\.created_at, createdAt\)\)/);
  assert.match(entryBlock, /time: threadHistoryEntryTime\(message\)/);
  assert.match(snapshotBlock, /time: threadHistoryEntryTime\(message\)/);
  assert.match(optionsBlock, /<time class="thread-history-option-time bubble-time">\$\{escapeHtml\(entry\.time\)\}<\/time>/);
  assert.match(styles, /\.thread-history-option\s*\{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*gap: 10px/);
  assert.match(styles, /\.thread-history-option-text\s*\{[\s\S]*flex: 1 1 auto/);
  assert.match(styles, /\.thread-history-option-time\s*\{[\s\S]*flex: 0 0 auto;[\s\S]*margin-left: auto;[\s\S]*color: #b6bcc6/);
  assert.match(styles, /\.bubble-time\s*\{[\s\S]*font-size: calc\(11px \+ var\(--app-font-size-offset\)\);[\s\S]*font-weight: 400;[\s\S]*line-height: 1\.4/);
});

test("local history jumps select the message and keep the outline highlight", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const jumpBlock = sourceBlock(source, "function requestThreadHistoryJump", "function resetThreadHistoryNavigation");
  const resolverBlock = sourceBlock(source, "function resolveThreadHistoryJumpMessageId", "function resolveConsumptionRecordJumpMessageId");
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const eventBlock = sourceBlock(source, "function bindThreadHistoryPopoverEvents", "function refreshThreadHistoryOptions");
  const targetBlock = sourceBlock(source, "function threadHistoryJumpHighlightTargetForMessages", "function searchableConversationMessageText");
  const messageBlock = sourceBlock(source, "function renderMessage(message: Message", "function messageRenderSignature");

  assert.ok(jumpBlock.indexOf("pendingThreadHistoryJump =") < jumpBlock.indexOf("selectThread(threadId"));
  assert.match(eventBlock, /requestThreadHistoryJump\(threadId, messageId, "", entry\)/);
  assert.match(jumpBlock, /function requestThreadHistoryJump\([\s\S]*keyword: string,[\s\S]*entry: ThreadHistoryEntry/);
  assert.match(jumpBlock, /keyword,[\s\S]*fallbackSearchableIndex/);
  assert.match(jumpBlock, /selectThread\(threadId, \{ threadHistoryJumpToken: token \}\)/);
  assert.match(jumpBlock, /\.message-row\[data-message-id=/);
  assert.match(jumpBlock, /setMessageStreamFollow\(target\.threadId, false\)/);
  assert.match(jumpBlock, /scrollTo\(\{ top: clampNumber\(targetTop, 0, maxTop\), behavior: "smooth" \}\)/);
  assert.match(jumpBlock, /threadHistorySearchableMessages\(target\.threadId, messagesForThread\(target\.threadId\)\)/);
  assert.match(jumpBlock, /fallbackSearchableIndex/);
  assert.doesNotMatch(resolverBlock, /fallbackUserIndex|const userMessages/);
  assert.match(jumpBlock, /activeThreadHistoryJumpHighlight = \{ threadId, messageId, keyword, expiresAt: Date\.now\(\) \+ 1800 \}/);
  assert.match(jumpBlock, /updateActiveMessageScroller\(\)/);
  assert.match(jumpBlock, /classList\.add\("thread-history-jump-target"\)/);
  assert.match(jumpBlock, /window\.setTimeout\(\(\) => clearThreadHistoryJumpHighlight\(\), 1800\)/);
  assert.match(jumpBlock, /const previous = activeThreadHistoryJumpHighlight/);
  assert.match(jumpBlock, /options\.refreshMessages !== false[\s\S]*updateActiveMessageScroller\(\)/);
  assert.match(targetBlock, /return \{ messageId: target\.messageId, keyword: target\.keyword \}/);
  assert.match(messageBlock, /threadHistoryJumpTarget \? "thread-history-jump-target" : ""/);
  assert.match(renderBlock, /const hasPendingThreadHistoryJump/);
  assert.match(renderBlock, /const hasActiveThreadHistoryHighlight/);
  assert.match(renderBlock, /!hasPendingThreadHistoryJump &&[\s\S]*!hasActiveThreadHistoryHighlight/);
  assert.doesNotMatch(renderBlock, /hasPendingConversationSearchScroll|scheduleConversationSearchMatchScroll/);
  assert.match(styles, /\.message-row\.thread-history-jump-target \.message-bubble\s*\{[\s\S]*thread-history-jump-outline-pulse 1\.8s/);
  assert.doesNotMatch(styles, /global-search-jump-target|thread-history-global-jump-pulse/);
  assert.match(styles, /@keyframes thread-history-jump-outline-pulse/);
});

test("conversation rows delegate mouse hover and render the fixed popover outside the scrolling list", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const bindBlock = sourceBlock(
    source,
    'root.querySelector<HTMLDivElement>(".conversation-rows")',
    "bindConversationScrollbarEvents();",
  );

  assert.match(bindBlock, /addEventListener\("pointerover"/);
  assert.match(bindBlock, /addEventListener\("pointerout"/);
  assert.match(bindBlock, /addEventListener\("focusin"/);
  assert.match(bindBlock, /addEventListener\("focusout"/);
  assert.match(bindBlock, /beginThreadHistoryHover\(row\)/);
  assert.match(bindBlock, /endThreadHistoryHover\(threadId, event\.relatedTarget\)/);
  assert.match(renderBlock, /\$\{renderThreadHistoryPopover\(\)\}[\s\S]*\$\{renderThreadContextMenuWithGroups\(\)\}/);
  const positionBlock = sourceBlock(source, "function positionThreadHistoryPopover", "function syncThreadHistoryPointerStateAfterRender");
  assert.match(positionBlock, /clampNumber\(popoverState\.anchorRight, viewportPadding, maxLeft\)/);
  assert.doesNotMatch(positionBlock, /popoverState\.anchorRight\s*\+\s*\d/);
  assert.match(positionBlock, /popoverState\.anchorCenterY - top/);
  assert.match(positionBlock, /--thread-history-arrow-y/);
  const anchorBlock = sourceBlock(source, "function threadHistoryPopoverAnchorCenterY", "function updateThreadHistoryPopoverAnchor");
  assert.match(anchorBlock, /\[data-thread-more\]/);
  assert.match(anchorBlock, /moreButtonRect\.top \+ moreButtonRect\.bottom/);
  const styles = await stylesSource;
  assert.match(styles, /\.thread-history-popover\s*\{[\s\S]*position: fixed;[\s\S]*z-index: 70/);
  assert.match(styles, /\.thread-history-hover-bridge\s*\{[\s\S]*width: 14px/);
  assert.match(styles, /\.thread-history-hover-bridge::before\s*\{[\s\S]*border-right: 14px solid var\(--border-field\)/);
  assert.match(styles, /\.thread-history-hover-bridge::after\s*\{[\s\S]*border-right: 12px solid var\(--surface-primary\)/);
  assert.match(styles, /\.thread-history-search:focus-within/);
});

test("history popover closes after the pointer leaves both its anchor row and the shared popover", async () => {
  const source = await mainSource;
  const hoverBlock = sourceBlock(source, "function beginThreadHistoryHover", "function showThreadHistoryPopover");
  const threadMoreBlock = sourceBlock(source, "function openThreadMoreMenu", "function openThreadGroupMoreMenu");
  const popoverEventsBlock = sourceBlock(source, "function bindThreadHistoryPopoverEvents", "function refreshThreadHistoryOptions");
  const dismissBlock = sourceBlock(source, "function wireThreadHistoryPopoverDismissal", "function ensureInitialBlankChatThread");
  const wireBlock = sourceBlock(source, "function wireDesktopEvents", "function wirePointerTracking");
  const rowEventsBlock = sourceBlock(
    source,
    'root.querySelector<HTMLDivElement>(".conversation-rows")',
    "bindConversationScrollbarEvents();",
  );

  assert.match(hoverBlock, /if \(threadHistoryPopover\?\.threadId === threadId\)[\s\S]*return;/);
  assert.match(hoverBlock, /function endThreadHistoryHover\(threadId: string, nextTarget: EventTarget \| null = null\)/);
  assert.match(hoverBlock, /popover\?\.contains\(nextTarget\)/);
  assert.match(hoverBlock, /closeThreadHistoryPopover\(\)/);
  assert.match(hoverBlock, /if \(state\.threadMenu\) \{\s*closeThreadHistoryPopover\(\);\s*return;\s*\}/s);
  assert.ok(threadMoreBlock.indexOf("closeThreadHistoryPopover();") < threadMoreBlock.indexOf("openThreadMenuAt("));
  assert.match(rowEventsBlock, /endThreadHistoryHover\(threadId, event\.relatedTarget\)/);
  assert.match(popoverEventsBlock, /addEventListener\("pointerleave"/);
  assert.match(popoverEventsBlock, /event\.pointerType && event\.pointerType !== "mouse"/);
  assert.match(popoverEventsBlock, /anchorRow\?\.contains\(nextTarget\)/);
  assert.match(popoverEventsBlock, /closeThreadHistoryPopover\(\)/);
  assert.match(dismissBlock, /addEventListener\([\s\S]*"pointerdown"/);
  assert.match(dismissBlock, /event\.button !== 0 \|\| !threadHistoryPopover/);
  assert.match(dismissBlock, /target\?\.closest\("\.thread-history-popover"\)/);
  assert.match(dismissBlock, /event\.clientX >= rect\.left[\s\S]*event\.clientX <= rect\.right/);
  assert.match(dismissBlock, /event\.clientY >= rect\.top[\s\S]*event\.clientY <= rect\.bottom/);
  assert.match(dismissBlock, /target\?\.closest\("\.thread-history-popover"\) \|\| insidePopoverBounds/);
  assert.match(dismissBlock, /closeThreadHistoryPopover\(\)/);
  assert.ok(wireBlock.indexOf("wireThreadHistoryPopoverDismissal()") < wireBlock.indexOf("wireCopyContextMenu()"));
});

test("hovering any other conversation closes the old popover before checking new history eligibility", async () => {
  const source = await mainSource;
  const hoverBlock = sourceBlock(source, "function beginThreadHistoryHover", "function showThreadHistoryPopover");
  const mountBlock = sourceBlock(source, "function mountThreadHistoryPopover", "function positionThreadHistoryPopover");

  assert.match(
    hoverBlock,
    /if \(threadHistoryPopover && threadHistoryPopover\.threadId !== threadId\) \{\s*closeThreadHistoryPopover\(\);\s*\}/s,
  );
  assert.ok(hoverBlock.indexOf("closeThreadHistoryPopover();") < hoverBlock.indexOf("isBlankNewThread(threadId)"));
  assert.ok(hoverBlock.indexOf("closeThreadHistoryPopover();") < hoverBlock.indexOf("knownThreadHistoryEntries(threadId)"));
  assert.match(hoverBlock, /if \(threadHistoryPopover\?\.threadId === threadId\)/);
  assert.match(hoverBlock, /showThreadHistoryPopover\(row, threadId, knownEntries\)/);
  assert.match(hoverBlock, /requestSequence !== threadHistoryRequestSequence \|\|[\s\S]*hoveredThreadHistoryThreadId !== threadId/);
  assert.match(hoverBlock, /showThreadHistoryPopover\(currentRow, threadId, entries\)/);
  assert.match(mountBlock, /\.thread-history-popover"\)\?\.remove\(\)/);
});

test("scrolling the history options does not dismiss the popover", async () => {
  const source = await mainSource;
  const scrollBlock = sourceBlock(source, "function handleContextMenuScroll", "function handleThreadListContextPointerDown");

  assert.match(scrollBlock, /target\?\.closest\("\.thread-history-popover"\)\) return/);
  assert.ok(scrollBlock.indexOf('target?.closest(".thread-history-popover")') < scrollBlock.indexOf("closeAllContextMenus()"));
});
