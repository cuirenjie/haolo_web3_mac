import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("conversation search temporarily expands every matching group without changing saved collapse state", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function renderThreadGroupSection", "function groupedThreadsForList");
  const toggleBlock = sourceBlock(source, "function toggleThreadGroupCollapsed", "async function toggleThreadPin");

  assert.match(renderBlock, /const collapsed = !state\.search\.trim\(\) && collapsedThreadGroupIds\.has\(group\.id\)/);
  assert.match(renderBlock, /\$\{collapsed \? "" : threads\.map\(renderThreadRow\)\.join\(""\)\}/);
  assert.doesNotMatch(renderBlock, /collapsedThreadGroupIds\.(?:clear|delete)/);
  assert.match(toggleBlock, /if \(state\.search\.trim\(\)\) return/);
  assert.match(toggleBlock, /collapsedThreadGroupIds\.has\(groupId\)/);
  assert.match(toggleBlock, /saveThreadPreferences\(\)/);
});

test("conversation search uses server search per workspace before touching local histories", async () => {
  const source = await mainSource;
  const prepareBlock = sourceBlock(source, "async function prepareConversationSearchResults", "function queueConversationSearchHydrations");
  const serverBlock = sourceBlock(source, "async function prepareServerConversationSearchResults", "function threadSearchResponseRequiresFallback");
  const queueBlock = sourceBlock(source, "function queueConversationSearchHydrations", "function canHydrateConversationSearchThread");
  const flushBlock = sourceBlock(source, "function flushConversationSearchHydrations", "async function hydrateConversationSearchThread");

  assert.ok(prepareBlock.indexOf("prepareServerConversationSearchResults(query)") < prepareBlock.indexOf("queueConversationSearchHydrations()"));
  assert.match(prepareBlock, /serverSearchStatus === "handled"/);
  assert.match(prepareBlock, /serverSearchStatus === "stale"/);
  assert.match(serverBlock, /sortedThreadGroups\(\)\.map/);
  assert.match(serverBlock, /cwd: groupCwd/);
  assert.match(serverBlock, /searchTerm: query/);
  assert.match(serverBlock, /limit: 100/);
  assert.match(serverBlock, /archived: false/);
  assert.match(serverBlock, /groupResults\.some\(\(\{ result \}\) => threadSearchResponseRequiresFallback\(result\)\)/);
  assert.match(serverBlock, /rememberThreadWorkspace\(thread\.id, groupCwd\)/);
  assert.match(serverBlock, /threadGroupByThreadId\[thread\.id\] = group\.id/);
  assert.match(serverBlock, /serverConversationSearchMatchesByThreadId\.set\(threadId, matches\)/);
  assert.match(serverBlock, /Server conversation search failed; falling back to local history search/);
  assert.match(queueBlock, /pendingServerConversationSearchQuery === query \|\| serverConversationSearchQuery === query/);
  assert.match(flushBlock, /pendingServerConversationSearchQuery === query \|\| serverConversationSearchQuery === query/);
});

test("unsupported server search keeps the debounced bounded local-history fallback", async () => {
  const source = await mainSource;
  const searchBlock = sourceBlock(source, "function scheduleConversationSearchHydration", "function syncConversationSearchQuery");

  assert.match(searchBlock, /window\.setTimeout\([\s\S]*180\)/);
  assert.match(searchBlock, /for \(const thread of state\.threads\)/);
  assert.doesNotMatch(
    sourceBlock(source, "function queueConversationSearchHydrations", "function canHydrateConversationSearchThread"),
    /filteredThreads\(\)/,
  );
  assert.match(searchBlock, /thread\.thread_kind !== "local_codex"/);
  assert.match(searchBlock, /activeConversationSearchHydrationCount\(\) < CONVERSATION_SEARCH_HYDRATION_CONCURRENCY/);
  assert.match(source, /const CONVERSATION_SEARCH_HYDRATION_CONCURRENCY = 2/);
  assert.match(source, /resumeThreadForBackgroundHydration\(threadId, hydrationSession\)/);
  assert.match(searchBlock, /indexConversationSearchThreadSnapshot\(threadId, result\.thread\)/);
  assert.doesNotMatch(
    sourceBlock(source, "async function hydrateConversationSearchThread", "function resetConversationSearchHydration"),
    /loadThreadInBackground/,
  );
  assert.match(searchBlock, /hydratedConversationSearchThreadIds\.has\(thread\.id\)/);
  assert.match(searchBlock, /conversationSearchHydrationActiveKey\(threadId, hydrationSession\)/);
  assert.match(searchBlock, /activeConversationSearchHydrations\.delete\(activeKey\)/);
  assert.match(searchBlock, /preparedConversationSearchQuery !== query/);
  assert.match(searchBlock, /preparedConversationSearchQuery === currentQuery/);
  assert.match(searchBlock, /scheduleConversationSearchHydrationRetry\(threadId, query, hydrationSession\)/);
  assert.match(searchBlock, /hasPendingConversationSearchHydrationRetry\(query\)/);
  assert.match(searchBlock, /}, 240\)/);

  const prepareBlock = sourceBlock(source, "async function prepareConversationSearchResults", "function queueConversationSearchHydrations");
  assert.ok(prepareBlock.indexOf("flushConversationSearchHydrations(query)") < prepareBlock.indexOf("await autoSelection"));

  const brokerBlock = sourceBlock(source, "function backgroundThreadResumeRequestKey", "function scheduleMissingAssistantPreviewHydration");
  assert.match(brokerBlock, /backgroundThreadResumeRequests\.get\(key\)/);
  assert.match(brokerBlock, /api\.readThreadForBackgroundHydration\(\{[\s\S]*threadId,[\s\S]*cwd: threadWorkspaceCwd\(threadId\)/);
  assert.doesNotMatch(brokerBlock, /resumeThreadWithModelLock|api\.resumeThread/);
  assert.match(brokerBlock, /backgroundThreadResumeRequests\.delete\(key\)/);
  assert.match(sourceBlock(source, "async function hydrateAssistantPreviewForThread", "function applyAssistantPreviewHydration"), /resumeThreadForBackgroundHydration\(threadId, hydrationSession\)/);

  const busyBlock = sourceBlock(source, "function setCodexThreadBusy", "function attachTurnIdToLatestOptimisticUserItem");
  assert.match(busyBlock, /if \(!busy && state\.activeView === "chat" && state\.search\.trim\(\)\)/);
  assert.match(busyBlock, /queueConversationSearchHydrations\(\)/);

  const loadThreadsBlock = sourceBlock(source, "async function loadThreads", "function ensureInitialBlankChatThread");
  assert.match(loadThreadsBlock, /if \(state\.activeView === "chat" && state\.search\.trim\(\)\)/);
  assert.match(loadThreadsBlock, /flushConversationSearchHydrations\(\)/);
});

test("background search keeps a lightweight searchable index instead of loading every chat into renderer state", async () => {
  const source = await mainSource;
  const indexBlock = sourceBlock(source, "function indexConversationSearchThreadSnapshot", "function threadSearchMatchesFromMessages");
  const hydrateBlock = sourceBlock(source, "async function hydrateConversationSearchThread", "function resetConversationSearchHydration");

  assert.match(indexBlock, /ConversationSearchIndexedDocument\[\]/);
  assert.match(indexBlock, /isUserSideThreadItem\(item\)/);
  assert.match(indexBlock, /item\.type !== "agentMessage"/);
  assert.match(indexBlock, /finalAgentDocument/);
  assert.match(indexBlock, /conversationSearchIndexByThreadId\.set\(threadId, documents\)/);
  assert.doesNotMatch(hydrateBlock, /loadThreadInBackground|state\.items|state\.itemOrder/);

  const cleanupBlock = sourceBlock(source, "function conversationSearchThreadHydrationGeneration", "function loadThread(thread: any");
  assert.match(cleanupBlock, /function dropConversationSearchThreadState/);
  assert.match(cleanupBlock, /conversationSearchIndexByThreadId\.delete\(threadId\)/);
  assert.match(cleanupBlock, /function pruneConversationSearchThreadState/);
  assert.match(cleanupBlock, /conversationSearchThreadHydrationGenerations\.keys\(\)/);
});

test("search chooses the first conversation in the first visible group once per query and respects a manual choice", async () => {
  const source = await mainSource;
  const searchBlock = sourceBlock(source, "async function maybeAutoSelectFirstConversationSearchResult", "function syncConversationSearchQuery");

  assert.match(searchBlock, /conversationSearchUserSelectedQuery === query/);
  assert.match(searchBlock, /state\.activeView !== "chat"/);
  assert.match(searchBlock, /if \(alreadySelectedForQuery && !final\) return false/);
  assert.match(searchBlock, /alreadySelectedForQuery && conversationSearchAutoSelectedThreadId === firstThread\.id/);
  assert.match(searchBlock, /selectThread\(firstThread\.id, \{ conversationSearchAutoSelection: true \}\)/);
  assert.match(searchBlock, /conversationGroupSectionsForList\(grouped, ensureDefaultThreadGroup\(\)\)/);
  assert.match(searchBlock, /groupSections\.find\(\(section\) => section\.threads\.length\)\?\.threads\[0\]/);
  assert.match(searchBlock, /visibleConversationThreadsForChatList\(\)/);

  const selectBlock = sourceBlock(source, "async function selectThread", "function selectAutoTaskThread");
  assert.match(selectBlock, /!options\.conversationSearchAutoSelection/);
  assert.match(selectBlock, /conversationSearchUserSelectedQuery = searchQuery/);
  assert.match(selectBlock, /const stillOwnsSelection =[\s\S]*ownsThreadSwitchTransition\(threadId, threadSwitchToken\)[\s\S]*state\.activeView === "chat"[\s\S]*state\.currentThreadId === threadId/);
  assert.match(selectBlock, /conversationSearchAutoSelectedThreadId === threadId/);
  assert.match(selectBlock, /conversationSearchAutoSelection: options\.conversationSearchAutoSelection/);
  assert.match(selectBlock, /const workspaceSession = conversationSearchHydrationSession/);
  assert.match(selectBlock, /if \(workspaceSession !== conversationSearchHydrationSession\) return/);
  assert.match(selectBlock, /loadThread\(result\.thread/);
});

test("search input starts hydration and keeps its focus and caret through async renders", async () => {
  const source = await mainSource;
  const inputBlock = sourceBlock(source, "function bindEvents", "function openChannelDialog");
  assert.match(
    inputBlock,
    /#conversationSearch[\s\S]*?addEventListener\("input"/,
  );
  assert.match(inputBlock, /syncConversationSearchQuery\(\)/);
  assert.match(inputBlock, /scheduleConversationSearchHydration\(\)/);

  const focusBlock = sourceBlock(source, "function captureConversationSearchFocus", "function captureSkillsSearchFocus");
  assert.match(focusBlock, /captureFormFieldFocus\("#conversationSearch"\)/);
  assert.match(focusBlock, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focusBlock, /input\.setSelectionRange\(selectionStart, selectionEnd\)/);
  assert.ok(
    focusBlock.indexOf("++conversationSearchFocusRestoreToken") < focusBlock.indexOf('if (!snapshot || state.activeView !== "chat") return'),
    "every render should invalidate an older delayed focus restore, even when the search field is no longer focused",
  );

  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  assert.match(renderBlock, /const conversationSearchFocus = captureConversationSearchFocus\(\)/);
  assert.match(renderBlock, /restoreConversationSearchFocus\(conversationSearchFocus\)/);

  assert.match(inputBlock, /if \(state\.search\.trim\(\)\) scheduleConversationSearchHydration\(\)/);
});

test("every hydrated message match renders highlighted list text and count without legacy navigation or bubble marking", async () => {
  const source = await mainSource;
  const rowBlock = sourceBlock(source, "function renderThreadRow(thread: ConversationSummary)", "function threadComposerDraftPreview");

  assert.match(rowBlock, /threadSearchMatchSummary\(thread, searchKeyword\)/);
  assert.match(rowBlock, /renderThreadSearchPreview\(searchMatch\.match, searchKeyword\)/);
  assert.match(rowBlock, /renderThreadSearchCount\(searchMatch\)/);
  assert.match(rowBlock, /renderHighlightedConversationSearchText\(rawRowName, searchKeyword\)/);

  const countBlock = sourceBlock(source, "function renderThreadSearchCount", "function renderThreadHistoryPopover");
  assert.match(countBlock, /row-search-count/);
  assert.match(countBlock, /match\.count/);

  assert.doesNotMatch(source, /data-thread-search-nav/);
  assert.doesNotMatch(source, /renderThreadSearchNavButton/);
  assert.doesNotMatch(source, /function (?:navigateConversationSearchMatch|scheduleConversationSearchMatchScroll|scrollConversationSearchMatchIntoView)\b/);
  assert.doesNotMatch(source, /conversationSearchHighlightTargetForMessages/);
  assert.doesNotMatch(source, /ConversationSearchNavigation|conversationSearchNavigation/);
});
