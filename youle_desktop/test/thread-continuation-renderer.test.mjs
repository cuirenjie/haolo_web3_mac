import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("legacy plan mode control, state, prompt injection, and continuation metadata stay removed", () => {
  assert.doesNotMatch(renderer, /PLAN_MODE_INSTRUCTION|AgentRunMode|agentRunMode|agent-run-mode|threadRunModes|runMode|run_mode/);
  assert.doesNotMatch(styles, /agent-mode-(?:picker|button|menu)/);
  assert.doesNotMatch(main, /runMode|run_mode/);
});

test("automatic compaction replaces the source's pending prompt only after compaction succeeds", () => {
  const block = sourceBlock(
    renderer,
    "function requestAutomaticThreadContextCompaction",
    "async function prepareContextBudgetForSend",
  );
  const compactCall = block.indexOf("await api.compactThread");
  const armCall = block.indexOf("armAutomaticThreadContinuation(threadId)");
  assert.ok(compactCall >= 0 && armCall > compactCall);
  assert.match(renderer, /return\s+\(\s*!pendingThreadContinuationForSource\(id\)\s*&&\s*!isThreadContinuationCreationActive\(id\)/);
  const arm = sourceBlock(renderer, "function armAutomaticThreadContinuation", "function bindThreadContinuationAnswerTurn");
  assert.match(arm, /record\.sourceThreadId === threadId/);
  assert.match(arm, /delete threadContinuationByOperationId\[operationId\]/);
  assert.match(arm, /api\.discardSupersededContinuations/);
  assert.match(renderer, /taskFromThreadId\(id\) \|\| isExternalChannelAgentThreadId\(id\) \|\| isDesktopAgentThreadId\(id\)/);
});

test("continuation prompt waits for hydrated final output and same-thread work to drain", () => {
  const hydration = sourceBlock(renderer, "async function hydrateCompletedTurn", "function hasAgentReplyForTurn");
  assert.match(hydration, /const hasReplyAfterHydration = hasAgentReplyForTurn/);
  assert.match(hydration, /await maybePrepareThreadContinuationAfterHydration\(threadId, turnId\)/);
  const blockers = sourceBlock(renderer, "function hasThreadContinuationCreationBlocker", "async function maybePrepareThreadContinuationAfterHydration");
  for (const expected of [
    "!threadContinuationReconciliationReady",
    "isThreadBusy(threadId)",
    "hasThreadCodexSendInFlight(threadId)",
    "state.queuedSends.some((item) => item.threadId === threadId)",
    "isComposerSendPending(threadId)",
    "submittingComposerThreadIds.has(threadId)",
    "contextCompactionPromises.has(threadId)",
  ]) assert.ok(blockers.includes(expected), `missing blocker: ${expected}`);
  const drain = sourceBlock(renderer, "function scheduleThreadContinuationDrain", "async function maybePrepareThreadContinuationAfterHydration");
  assert.match(drain, /record\.answerTurnId/);
  assert.match(drain, /hasThreadContinuationCreationBlocker\(threadId\)/);
  assert.match(drain, /!hasAgentReplyForTurn\(threadId, current\.answerTurnId\)[\s\S]*resetThreadContinuationAnswerTurn\(threadId, current\.answerTurnId\)/);
  assert.match(drain, /prepareThreadContinuationPrompt\(current\.operationId\)/);
  const hydrationGate = sourceBlock(renderer, "async function maybePrepareThreadContinuationAfterHydration", "function threadContinuationAnchorMessageId");
  assert.doesNotMatch(hydrationGate, /record\.answerTurnId\s*=/);
});

test("continuation task creation is deferred until the user clicks the persisted prompt", () => {
  const preparation = sourceBlock(renderer, "async function prepareThreadContinuationPrompt", "function applyCanonicalThreadContinuationResult");
  assert.match(preparation, /await api\.stageContinuationPrompt/);
  assert.match(preparation, /record\.status = "ready"/);
  assert.doesNotMatch(preparation, /api\.createContinuationThread/);
  const click = sourceBlock(renderer, "async function openThreadContinuation", "function createThreadContinuation");
  assert.match(click, /await createThreadContinuation\(operationId\)/);
  assert.match(click, /await selectThread\(record\.continuationThreadId\)/);
});

test("unrecoverable compaction prepares a click-to-open continuation without another model turn", () => {
  const recovery = sourceBlock(
    renderer,
    "function isUnrecoverableContextCompactionError",
    "async function prepareThreadContinuationPrompt",
  );
  assert.match(recovery, /max_output_tokens/);
  assert.match(recovery, /oversized history item/);
  assert.match(recovery, /thread compaction timed out/);
  assert.match(recovery, /armAutomaticThreadContinuation\(threadId\)/);
  assert.doesNotMatch(recovery, /existing\?\.status === "ready"\) return true/);
  assert.match(recovery, /allowWithoutAnswer:\s*true/);
  assert.match(recovery, /threadContinuationFallbackAnchorMessageId\(threadId\)/);

  const preparation = sourceBlock(
    renderer,
    "async function prepareThreadContinuationPrompt",
    "function applyCanonicalThreadContinuationResult",
  );
  assert.match(preparation, /\(!record\.answerTurnId && !allowWithoutAnswer\)/);
  assert.match(preparation, /options\.anchorMessageId/);
  assert.match(preparation, /ignoreCurrentComposerSend:\s*allowWithoutAnswer/);

  const budget = sourceBlock(renderer, "async function prepareContextBudgetForSend", "async function sendCurrentMessage");
  assert.match(budget, /prepareThreadContinuationAfterCompactionFailure/);
});

test("restart restores canonical continuation payload before the client becomes send-ready", () => {
  const boot = sourceBlock(renderer, "async function bootLocalWorkspace", "function applyAuthSession");
  const earlyReconciliation = boot.indexOf("await reconcilePersistedThreadContinuations()");
  const ready = boot.indexOf("state.serverReady = true");
  const slowStartupLoad = boot.indexOf("await refreshSkills", ready);
  assert.ok(earlyReconciliation >= 0 && ready > earlyReconciliation && slowStartupLoad > ready);
  assert.match(boot, /续接事务状态读取失败，已暂停任务发送以保护会话数据/);

  const reconciliation = sourceBlock(renderer, "async function reconcilePersistedThreadContinuations", "function wireThreadHistoryPopoverDismissal");
  assert.match(reconciliation, /threadContinuationReconciliationReady = false/);
  assert.match(reconciliation, /threadContinuationReconciliationReady = true/);

  const onDemandStart = sourceBlock(renderer, "async function ensureServerReadyForComposerSend", "async function promoteLocalBlankThreadForSend");
  const onDemandReconciliation = onDemandStart.indexOf("await reconcilePersistedThreadContinuations()");
  const onDemandReady = onDemandStart.indexOf("state.serverReady = true");
  assert.ok(onDemandReconciliation >= 0 && onDemandReady > onDemandReconciliation);
  assert.match(onDemandStart, /if \(state\.serverReady && threadContinuationReconciliationReady\) return true/);
  assert.match(onDemandStart, /if \(!\(await reconcilePersistedThreadContinuations\(\)\)\) \{\s*throw new Error/);
});

test("a server-backed blank thread retries app-server readiness before sending", () => {
  const send = sourceBlock(renderer, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  const readinessGuard = sourceBlock(
    send,
    "const tradingGeneralCandidateAtSend",
    "recoverStaleCodexWorkForComposer",
  );
  assert.match(
    readinessGuard,
    /!state\.serverReady[\s\S]*isBlankNewThread\(threadId\) && !isLocalBlankThreadId\(threadId\)/,
  );
  assert.match(readinessGuard, /if \(!\(await ensureServerReadyForComposerSend\(\)\)\) return/);
  assert.doesNotMatch(readinessGuard, /app-server 未启动成功/);
});

test("continuation creation inherits settings, opens after an explicit click, and never steals focus after navigation", () => {
  const block = sourceBlock(renderer, "async function performThreadContinuationCreation", "function contextUsageNumber");
  assert.match(block, /selectedChatModelRequestOptions\(sourceThreadId\)/);
  assert.match(block, /threadWorkspaceCwd\(sourceThreadId\)/);
  assert.match(block, /threadGroupAgentContext\(sourceGroupId\)/);
  assert.doesNotMatch(block, /runMode|AgentRunMode|agentRunMode/);
  assert.match(block, /activate:\s*false/);
  assert.match(block, /operationId:\s*record\.operationId/);
  assert.match(block, /if \(discardedThreadId\) hideUnavailableThread\(discardedThreadId, true\)/);
  assert.match(block, /state\.activeView === "chat"[\s\S]*state\.currentThreadId === sourceThreadId/);
  assert.match(block, /if \(stillOnSource\) \{\s*await selectThread\(targetThreadId\);\s*\} else \{[\s\S]*markFinalResultUnviewed\(targetThreadId\)/);
  const stillOnSource = sourceBlock(block, "const stillOnSource", "if (stillOnSource)");
  assert.doesNotMatch(stillOnSource, /composerText|attachments|isComposerSendPending|hasThreadContinuationCreationBlocker/);
});

test("a newly created continuation is pinned below every existing pin in its inherited group", () => {
  const creation = sourceBlock(renderer, "async function performThreadContinuationCreation", "function contextUsageNumber");
  assert.match(creation, /threadGroupByThreadId\[targetThreadId\] = targetGroupId;\s*setThreadPinPreference\(targetThreadId, true\)/);

  const sorting = sourceBlock(renderer, "function sortThreadsForList", "function fixedTopLevelThreadSortRank");
  assert.match(sorting, /if \(a\.pinned && b\.pinned\)/);
  assert.match(sorting, /comparePinnedThreadContinuationOrder\(a, b\)/);
  assert.match(sorting, /Number\(Boolean\(aContinuation\)\) - Number\(Boolean\(bContinuation\)\)/);
  assert.match(sorting, /threadContinuationCompletedSortTime\(aContinuation\) - threadContinuationCompletedSortTime\(bContinuation\)/);
});

test("continuation creation freezes source sends and deletion until initialization commits", () => {
  const active = sourceBlock(renderer, "function isThreadContinuationCreationActive", "function clearThreadContinuationDrain");
  assert.match(active, /threadContinuationOpeningSourceThreadIds\.has\(id\)/);
  assert.match(active, /record\.status === "preparing" \|\| record\.status === "creating"/);
  assert.doesNotMatch(active, /record\.status === "ready"/);
  const send = sourceBlock(renderer, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  assert.match(send, /isThreadContinuationCreationActive\(threadId\)/);
  const canSend = sourceBlock(renderer, "function canSendComposer", "function canSendConversationSupplement");
  assert.match(canSend, /isThreadContinuationCreationActive\(threadId\)/);
  const deletion = sourceBlock(renderer, "async function deleteThread", "function currentThread");
  assert.match(deletion, /isThreadContinuationCreationActive\(threadId\)/);
});

test("deleting a continuation target preserves its frozen handoff for click-to-recreate", () => {
  const deletion = sourceBlock(renderer, "function forgetDeletedThreadContinuation", "function adoptReplacementCodexThread");
  assert.match(deletion, /record\.sourceThreadId === threadId[\s\S]*delete threadContinuationByOperationId\[operationId\]/);
  assert.match(deletion, /api\.discardSupersededContinuations/);
  assert.match(deletion, /record\.continuationThreadId !== threadId/);
  assert.match(deletion, /record\.status = record\.copiedMessages\.length === 2 \? "ready" : "failed"/);
  assert.match(deletion, /record\.needsNewOperation = true/);
  assert.doesNotMatch(deletion, /record\.copiedMessages = \[\]/);
  const targetLookup = sourceBlock(renderer, "function continuationRecordForTarget", "function inheritedContinuationHistoryMessages");
  assert.match(targetLookup, /record\.status === "completed" && record\.continuationThreadId === id/);
});

test("continuation persistence failures abort before server mutation and keep a stable idempotency key", () => {
  const arm = sourceBlock(renderer, "function armAutomaticThreadContinuation", "function bindThreadContinuationAnswerTurn");
  assert.match(arm, /const operationId = createThreadContinuationOperationId\(\)/);
  assert.match(arm, /if \(!saveThreadPreferences\(\)\)/);
  const creation = sourceBlock(renderer, "async function performThreadContinuationCreation", "function contextUsageNumber");
  const stagePersist = creation.indexOf("await api.stageContinuationPrompt");
  const creatingPersist = creation.indexOf('record.status = "creating"');
  const ipcMutation = creation.indexOf("await api.createContinuationThread");
  assert.ok(creatingPersist >= 0 && stagePersist > creatingPersist && ipcMutation > stagePersist);
  assert.match(creation.slice(creatingPersist, ipcMutation), /if \(!saveThreadPreferences\(\)\)/);
});

test("an unknown completed-target verification never creates a duplicate", () => {
  const open = sourceBlock(renderer, "async function openThreadContinuation", "function createThreadContinuation");
  assert.match(open, /targetAvailability: "exists" \| "missing" \| "unknown"/);
  assert.match(open, /transaction\?\.status === "target_deleted"[\s\S]*targetAvailability = "missing"/);
  assert.match(open, /catch \{\s*targetAvailability = "unknown"/);
  const unknownGuard = open.indexOf('targetAvailability === "unknown"');
  const rotate = open.indexOf("rotateThreadContinuationOperation");
  assert.ok(unknownGuard >= 0 && rotate > unknownGuard);
  assert.match(open.slice(unknownGuard, rotate), /暂时无法确认续接任务状态，请稍后重试/);
});

test("live server-side compaction can arm the currently running answer", () => {
  const helper = sourceBlock(
    renderer,
    "function armThreadContinuationFromCompactionNotification",
    "function failContextCompaction",
  );
  assert.match(helper, /clientRequestedCompaction \|\| !armAutomaticThreadContinuation\(threadId\)/);
  assert.match(helper, /bindThreadContinuationAnswerTurn\(threadId, turnId\)/);
  assert.match(helper, /recentlyCompletedFinalAnswerTurnId\(threadId\)/);
  assert.match(helper, /!isThreadBusy\(threadId\)[\s\S]*scheduleCompletedTurnHydration\(threadId, turnId\)/);

  const notifications = sourceBlock(renderer, "function handleNotification", "function handleAutomationThreadNotification");
  const legacy = sourceBlock(notifications, 'case "thread/compacted":', 'case "turn/started":');
  assert.match(legacy, /const previousCompactionCount = context\.compactionCount/);
  assert.match(
    legacy,
    /if \(completedItem\) \{\s*upsertItem\(threadId, completedItem, \{ updateThreadPreview: false \}\);\s*\}\s*if \(context\.compactionCount > previousCompactionCount\) \{\s*armThreadContinuationFromCompactionNotification/,
  );

  const itemNotifications = sourceBlock(notifications, 'case "item/started":', 'case "item\/agentMessage\/delta":');
  assert.match(itemNotifications, /let completedNewCompaction = false/);
  assert.match(itemNotifications, /completedNewCompaction = context\.compactionCount > previousCompactionCount/);
  assert.match(itemNotifications, /if \(completedNewCompaction\) \{\s*armThreadContinuationFromCompactionNotification/);

  const completedTurn = sourceBlock(notifications, 'case "turn/completed":', 'case "turn/failed":');
  assert.match(completedTurn, /compactionCompletedWithoutItemNotification/);
  assert.match(completedTurn, /completeContextCompactionFromNotification\(threadId, message\)/);
  assert.match(
    completedTurn,
    /compactionContext\.compactionCount > previousCompactionCount[\s\S]*armThreadContinuationFromCompactionNotification/,
  );
});

test("a final answer in the same turn as compaction is not treated as a pure compaction turn", () => {
  const notifications = sourceBlock(renderer, "function handleNotification", "function handleAutomationThreadNotification");
  const completed = sourceBlock(notifications, 'case "turn/completed":', 'case "turn/failed":');
  assert.match(completed, /hadFinalReplyForCompletedTurn = Boolean\(threadId && hasAgentReplyForTurn\(threadId, completedTurnId\)\)/);
  assert.match(completed, /wasPureContextCompactionTurn = wasContextCompactionTurn && !hadFinalReplyForCompletedTurn/);
  assert.match(completed, /!wasInterrupted\s*&&\s*!wasPureContextCompactionTurn/);
});

test("continuation accepts only the visible final agent output with the exact completed turn id", () => {
  const detector = sourceBlock(renderer, "function hasAgentReplyForTurn", "function setCodexThreadBusy");
  assert.match(detector, /const messages = messagesForThread\(threadId\)/);
  assert.match(detector, /isConclusiveAgentReplyItem\(item\)/);
  assert.match(detector, /hasConclusiveAgentMessagePhase\(item\)/);
  assert.match(detector, /agentMessagePhase\(item\) !== "commentary"/);
  assert.match(detector, /expectedTurnId \? itemTurn === expectedTurnId : true/);
  assert.doesNotMatch(detector, /!itemTurn \|\|/);
});

test("progress commentary cannot suppress silent-turn recovery", () => {
  const notifications = sourceBlock(renderer, "function handleNotification", "function handleAutomationThreadNotification");
  const itemNotifications = sourceBlock(notifications, 'case "item/started":', 'case "thread/status/changed":');
  assert.match(itemNotifications, /if \(isConclusiveAgentReplyItem\(startedItem\)\)/);
  assert.match(itemNotifications, /hasConclusiveAgentMessagePhase\(\s*state\.items\[threadId\]/);

  const detector = sourceBlock(renderer, "function hasAgentReplyForTurn", "function setCodexThreadBusy");
  assert.match(detector, /return agentMessagePhase\(item\) !== "commentary"/);
});

test("deleted or failed continuation rotates only on click and reuses the frozen snapshot", () => {
  const open = sourceBlock(renderer, "function rotateThreadContinuationOperation", "function createThreadContinuation");
  assert.match(open, /record\.needsNewOperation \|\| record\.status === "failed"/);
  assert.match(open, /rotateThreadContinuationOperation\(record\)/);
  assert.match(open, /await createThreadContinuation\(operationId\)/);
  assert.doesNotMatch(open, /record\.copiedMessages = \[\]/);
  assert.doesNotMatch(open, /record\.olderSummary = ""/);
});

test("an idempotent completed target replaces renderer handoff state with main's canonical payload", () => {
  const canonical = sourceBlock(
    renderer,
    "function applyCanonicalThreadContinuationResult",
    "function rotateThreadContinuationOperation",
  );
  assert.match(canonical, /parseThreadContinuationInjectedItems\(items\)/);
  assert.match(canonical, /parsed\.copiedMessages\.length !== 2/);
  assert.match(canonical, /record\.olderSummary = parsed\.olderSummary/);
  assert.match(canonical, /record\.copiedMessages = parsed\.copiedMessages/);

  const creation = sourceBlock(renderer, "async function performThreadContinuationCreation", "function contextUsageNumber");
  assert.match(creation, /operationChanged && !appliedCanonicalResult/);
  assert.match(creation, /record\.operationId = responseOperationId/);
  assert.match(creation, /continuationTitle = nextThreadContinuationTitle\(sourceTitle\)/);
  assert.match(creation, /canonicalTransaction\?\.sourceGroupId/);
  assert.match(creation, /canonicalTransaction\?\.cwd/);
  assert.doesNotMatch(creation, /runMode|run_mode/);
});

test("renderer persists only the latest source prompt and renders one whole-card click target", () => {
  const preferences = sourceBlock(renderer, "function loadThreadPreferences", "function shouldPersistThreadPreferenceId");
  assert.match(preferences, /threadContinuations:\s*normalizePersistedThreadContinuations/);
  assert.match(preferences, /threadContinuations:\s*Object\.fromEntries/);
  assert.match(preferences, /olderSummary:\s*""/);
  assert.match(preferences, /copiedMessages:\s*\[\]/);
  assert.match(preferences, /latestThreadContinuationRecordForSource\(record\.sourceThreadId\)\?\.operationId === operationId/);
  assert.doesNotMatch(preferences, /record\.status === "completed" \|\| latestThreadContinuationRecordForSource/);
  assert.match(renderer, /async function reconcilePersistedThreadContinuations/);
  const reconciliation = sourceBlock(renderer, "async function reconcilePersistedThreadContinuations", "function wireThreadHistoryPopoverDismissal");
  assert.match(reconciliation, /record\.status !== "awaiting_answer"/);
  assert.match(reconciliation, /scheduleCompletedTurnHydration\(sourceThreadId, record\.answerTurnId\)/);
  assert.match(renderer, /parseThreadContinuationInjectedItems/);
  assert.match(renderer, /status === "ready"/);
  assert.match(renderer, /上次续接被客户端重启中断，请重试/);
  assert.match(renderer, /const quotedSourceTitle = `“\$\{sourceTitle\}”`/);
  assert.match(renderer, /来自\$\{escapeHtml\(quotedSourceTitle\)\} · 最近2条消息/);
  assert.doesNotMatch(renderer, /continuation-copy-source/);
  assert.doesNotMatch(renderer, /来自原会话| · 原会话/);
  assert.doesNotMatch(renderer, /续接自「/);
  assert.doesNotMatch(styles, /thread-continuation-source-link/);
  assert.match(renderer, /点击打开续接任务，会更快更省Token/);
  assert.match(renderer, /data-action="open-thread-continuation"/);
  assert.doesNotMatch(renderer, /已整理上下文并续接到新任务/);
  const placement = sourceBlock(renderer, "function resolvedThreadContinuationAnchorMessageId", "function renderChatPanel");
  assert.match(placement, /latestThreadContinuationRecordForSource\(threadId\)/);
  assert.match(placement, /threadContinuationAnswerMessageId\(threadId, record\.answerTurnId\)/);
  assert.doesNotMatch(placement, /legacyThreadContinuationAnchorMessageId/);
  assert.match(placement, /function renderUnanchoredThreadContinuationStatuses[\s\S]*?return ""/);
  assert.doesNotMatch(placement, /return renderThreadContinuationStatus\(threadId, record\)/);
  assert.doesNotMatch(placement, /threadContinuationRecordsForSource\(threadId\)\s*\.filter/);
  assert.match(renderer, /THREAD_CONTINUATION_WELCOME_TEXT/);
  const prelude = sourceBlock(renderer, "function renderThreadContinuationPrelude", "function shouldRenderThreadContinuationStatus");
  assert.ok(prelude.indexOf("continuation-welcome-row") < prelude.indexOf("thread-continuation-history-heading"));
  assert.match(styles, /\.thread-continuation-prelude/);
  assert.match(styles, /\.thread-continuation-status-card\.failed/);
  assert.match(styles, /\.thread-continuation-status-card\s*\{[\s\S]*?margin:\s*10px 0 8px 44px/);
  assert.match(styles, /\.thread-continuation-status-card\s*\{[\s\S]*?border-radius:\s*999px/);
  assert.match(styles, /\.thread-continuation-status-card\s*\{[\s\S]*?cursor:\s*pointer/);
  assert.match(styles, /\.thread-continuation-history-heading\s*\{[\s\S]*?font-weight:\s*400/);
  assert.doesNotMatch(styles, /\.continuation-copy-source/);
  assert.match(styles, /\.context-compaction-bubble\.completed \.context-compaction-text\s*\{[\s\S]*?color:\s*#5471a5/);

  const threadRow = sourceBlock(renderer, "function renderThreadRow", "function threadComposerDraftPreview");
  assert.doesNotMatch(threadRow, /row-continuation-suffix|（续）/);
  assert.doesNotMatch(styles, /\.row-name-with-continuation|\.row-title \.row-continuation-suffix/);

  const naming = sourceBlock(renderer, "function nextThreadContinuationTitle", "function hasThreadContinuationCreationBlocker");
  assert.match(naming, /return `\[续\]\$\{rootTitle\}`/);
  assert.match(naming, /\^\\\[续\(\?:\\d\+\)\?\\\]/);
  assert.match(naming, /（续\(\?:\\d\+\)\?）/);
});

test("inherited continuation history is fed into the next generation before a fresh cap", () => {
  const inherited = sourceBlock(renderer, "function inheritedContinuationHistoryMessages", "function nextThreadContinuationTitle");
  assert.match(inherited, /continuationRecordForTarget\(threadId\)/);
  assert.match(inherited, /inherited\.olderSummary/);
  assert.match(inherited, /inherited\.copiedMessages/);
  assert.match(renderer, /const history = threadContinuationHistoryMessages\(sourceThreadId\);\s*const handoff = buildThreadContinuationHandoff\(history\)/);
});

test("server-injected bootstrap items are hidden from real history rendering to avoid duplicate bubbles", () => {
  const hidden = sourceBlock(renderer, "function shouldHideChatItem", "function isHiddenRoleItem");
  assert.match(hidden, /isThreadContinuationInternalText\(itemText\(item\)\)/);
  const patcher = sourceBlock(renderer, "function patchMessageScrollerContent", "function renderChatHeader");
  assert.match(patcher, /data-thread-continuation-decoration/);
  assert.match(patcher, /\.message-row\[data-message-id\]/);
  assert.match(patcher, /statusDecoration\.previousElementSibling !== anchorRow/);
});

test("a missing continuation target returns to its source instead of adopting an empty replacement", () => {
  const send = sourceBlock(renderer, "async function sendAgentText", "async function flushQueuedSend");
  assert.match(send, /sendErrorMessage\.includes\("续接任务数据已不存在"\)/);
  assert.match(send, /continuationRecordForTarget\(activeThreadId\)\?\.sourceThreadId/);
  assert.match(send, /forgetDeletedThreadContinuation\(activeThreadId\)/);
  assert.match(send, /hideUnavailableThread\(activeThreadId, true\)/);
  assert.match(send, /selectThread\(originalSourceThreadId\)/);
});
