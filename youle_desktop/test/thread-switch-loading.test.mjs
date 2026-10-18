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

test("cold thread switching starts resume immediately and delays loading feedback", async () => {
  const source = await mainSource;
  const selectBlock = sourceBlock(source, "async function selectThread", "function selectAutoTaskThread");
  const delayBlock = sourceBlock(source, "function scheduleThreadSwitchLoadingState", "function isThreadSwitchMaterializing");
  const paintBlock = sourceBlock(source, "function waitForThreadSwitchLoadingPaint", "function threadMessageSurfaceCacheSignature");
  const prepareBlock = sourceBlock(source, "async function prepareThreadSwitchSnapshotForLoad", "function isHeavyThreadSwitchContent");

  const cacheIndex = selectBlock.indexOf("hasFullyLoadedThreadDetailCache(threadId)");
  const beginIndex = selectBlock.indexOf('beginThreadSwitchTransition(threadId, { deferLoading: true })');
  const resumeIndex = selectBlock.indexOf("const resumeRequest = resumeThreadForSelectionWithRolloutRetry", beginIndex);
  const scheduleIndex = selectBlock.indexOf("scheduleThreadSwitchLoadingState(threadId, threadSwitchToken)", resumeIndex);
  const awaitIndex = selectBlock.indexOf("const result = await resumeRequest", scheduleIndex);
  const ownershipIndex = selectBlock.indexOf("isOwnedThreadSwitchSelection(threadId, threadSwitchToken, workspaceSession)", awaitIndex);
  assert.ok(cacheIndex >= 0 && cacheIndex < beginIndex);
  assert.match(
    selectBlock,
    /hasFullyLoadedThreadDetailCache\(threadId\) &&[\s\S]*threadModelSelection\(threadId\) \|\| threadModelSettings\(threadId\)/,
  );
  assert.ok(beginIndex < resumeIndex && resumeIndex < scheduleIndex);
  assert.ok(scheduleIndex < awaitIndex && awaitIndex < ownershipIndex);
  assert.match(selectBlock, /threadSwitchTransition\?\.threadId === threadId[\s\S]*state\.currentThreadId === threadId[\s\S]*return;/);
  assert.match(source, /const THREAD_SWITCH_LOADING_DELAY_MS = 500/);
  assert.match(delayBlock, /window\.setTimeout\([\s\S]*showThreadSwitchLoadingState\(threadId, token\)[\s\S]*THREAD_SWITCH_LOADING_DELAY_MS/);
  assert.match(paintBlock, /window\.setTimeout\(finish, 100\)/);
  assert.equal((paintBlock.match(/window\.requestAnimationFrame/g) || []).length, 2);
  assert.match(paintBlock, /ownsThreadSwitchTransition\(threadId, token\)/);
  assert.match(prepareBlock, /performance\.now\(\) - switchStartedAt >= THREAD_SWITCH_LOADING_DELAY_MS/);
  assert.match(prepareBlock, /heavySnapshot[\s\S]*showThreadSwitchLoadingState\(threadId, token\)[\s\S]*waitForThreadSwitchLoadingPaint\(threadId, token\)/);
  assert.ok(selectBlock.indexOf("await prepareThreadSwitchSnapshotForLoad") < selectBlock.indexOf("loadThread(result.thread"));
});

test("visited heavy threads restore their retained DOM while data-only heavy caches materialize cooperatively", async () => {
  const source = await mainSource;
  const selectBlock = sourceBlock(source, "async function selectThread", "function selectAutoTaskThread");
  const cachedBlock = sourceBlock(source, "async function refreshCachedThreadAfterSelection", "async function selectThread");
  const surfaceBlock = sourceBlock(source, "function threadMessageSurfaceCacheSignature", "function hasFullyLoadedThreadDetailCache");
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");

  const cacheIndex = selectBlock.indexOf("hasFullyLoadedThreadDetailCache(threadId)");
  const surfaceSwapIndex = selectBlock.indexOf("swapCachedThreadMessageSurface(threadId, previousRenderedThreadId)", cacheIndex);
  const dataOnlyHeavyIndex = selectBlock.indexOf("isHeavyThreadSwitchContent(threadId)", surfaceSwapIndex);
  const beginIndex = selectBlock.indexOf("beginThreadSwitchTransition(threadId)", dataOnlyHeavyIndex);
  assert.ok(cacheIndex >= 0 && cacheIndex < surfaceSwapIndex && surfaceSwapIndex < dataOnlyHeavyIndex && dataOnlyHeavyIndex < beginIndex);
  assert.match(selectBlock, /swapCachedThreadMessageSurface[\s\S]*renderBeforeRead: false/);
  assert.match(selectBlock, /isHeavyThreadSwitchContent\(threadId\)[\s\S]*showThreadSwitchLoadingState\(threadId, cachedThreadSwitchToken\)[\s\S]*stageThreadSwitchReveal/);
  assert.match(cachedBlock, /options\.renderBeforeRead !== false\)[\s\S]*render\(\);[\s\S]*resumeThreadForBackgroundHydration\(threadId, workspaceSession, \{ displayCache: true \}\)/);
  assert.match(cachedBlock, /incomingSignature === loadedThreadDetailSnapshotSignatures\.get\(threadId\)[\s\S]*return;/);
  assert.match(cachedBlock, /loadThread\(incomingThread[\s\S]*patchActiveChatSurfaces\(threadId, \{ patchThreadRow: true \}\)/);
  assert.doesNotMatch(cachedBlock, /resumeThreadWithModelLock|api\.resumeThread|threadParams\(/);
  assert.doesNotMatch(cachedBlock, /beginThreadSwitchTransition|thread-revealing|renderThreadSwitchLoadingPlaceholder/);
  assert.match(surfaceBlock, /THREAD_MESSAGE_SURFACE_CACHE_LIMIT/);
  assert.match(surfaceBlock, /node\.dataset\.threadId !== threadId/);
  assert.match(surfaceBlock, /cached\.node\.dataset\.threadId !== threadId/);
  assert.match(surfaceBlock, /threadMessageSurfaceContentSignature\(threadId\)/);
  assert.match(surfaceBlock, /messagesForThread\(threadId\)[\s\S]*messageRenderSignature\(message, \{ streaming: false \}\)/);
  assert.match(surfaceBlock, /rememberThreadMessageSurface\(previousRenderedThreadId, currentScroller\)/);
  assert.match(surfaceBlock, /currentScroller\.replaceWith\(cached\.node\)/);
  assert.match(surfaceBlock, /cached\.node\.scrollTop = cached\.scrollTop/);
  assert.match(
    renderBlock,
    /rememberThreadMessageSurface\(\s*lastRenderedThreadId,\s*activeMessageScrollerBeforeRender,?\s*\)[\s\S]*root\.innerHTML/,
  );
});

test("only render-heavy snapshots keep the cooperative loading cover", async () => {
  const source = await mainSource;
  const snapshotPolicyBlock = sourceBlock(source, "function isHeavyThreadSnapshotContent", "async function prepareThreadSwitchSnapshotForLoad");
  const policyBlock = sourceBlock(source, "function isHeavyThreadSwitchContent", "async function finishThreadSwitchAfterLoad");
  const finishBlock = sourceBlock(source, "async function finishThreadSwitchAfterLoad", "async function refreshCachedThreadAfterSelection");

  assert.match(source, /THREAD_SWITCH_HEAVY_MESSAGE_COUNT = 24/);
  assert.match(source, /THREAD_SWITCH_HEAVY_TEXT_CHARS = 50_000/);
  assert.match(source, /THREAD_SWITCH_HEAVY_ASSET_COUNT = 6/);
  assert.match(snapshotPolicyBlock, /rawThreadItems\(thread\)/);
  assert.match(snapshotPolicyBlock, /THREAD_SWITCH_HEAVY_MESSAGE_COUNT[\s\S]*THREAD_SWITCH_HEAVY_TEXT_CHARS[\s\S]*THREAD_SWITCH_HEAVY_ASSET_COUNT/);
  assert.match(policyBlock, /messagesForThread\(threadId\)/);
  assert.match(finishBlock, /if \(revealHeavyContent\)[\s\S]*showThreadSwitchLoadingState[\s\S]*waitForThreadSwitchLoadingPaint[\s\S]*stageThreadSwitchReveal/);
  assert.match(finishBlock, /invalidateThreadSwitchTransition\(threadId, token\)[\s\S]*render\(\)/);
});

test("the request phase wins before long messages or continuation details are materialized", async () => {
  const source = await mainSource;
  const panelBlock = sourceBlock(source, "function renderChatPanel", "function renderMessageScrollBottomButton");
  const scrollerBlock = sourceBlock(source, "function renderMessageScrollerContent", "function updateActiveMessageScroller");
  const patchBlock = sourceBlock(source, "function patchMessageScrollerContent", "function renderChatHeader");
  const placeholderBlock = sourceBlock(source, "function renderThreadSwitchLoadingPlaceholder", "function shouldHideEmptyChatStateDuringSwitch");
  const emptyStateBlock = sourceBlock(source, "function shouldHideEmptyChatStateDuringSwitch", "function renderDeferredThreadResumeEmptyState");

  assert.ok(panelBlock.indexOf("isThreadSwitchLoadingState(thread.id)") < panelBlock.indexOf("currentMessages()"));
  assert.match(panelBlock, /data-thread-loading="true" aria-busy="true"/);
  assert.match(panelBlock, /renderThreadSwitchLoadingPlaceholder\(\)/);
  assert.doesNotMatch(scrollerBlock.split("const messages = messagesForThread")[0], /messagesForThread\(|renderMessage\(/);
  assert.match(scrollerBlock, /if \(isThreadSwitchLoadingState\(thread\.id\)\) return renderThreadSwitchLoadingPlaceholder\(\)/);
  assert.ok(patchBlock.indexOf("isThreadSwitchLoadingState(thread.id)") < patchBlock.indexOf("messagesForThread(thread.id)"));
  assert.match(placeholderBlock, /data-thread-loading-placeholder="true"/);
  assert.match(emptyStateBlock, /return isThreadSwitchTransitionActive\(threadId\)/);
});

test("ordinary local thread switches keep the conversation list node and render only thread-owned surfaces", async () => {
  const source = await mainSource;
  const localBlock = sourceBlock(source, "function patchThreadSwitchHeaderAndComposer", "function invalidateThreadSwitchTransition");
  const selectBlock = sourceBlock(source, "async function selectThread", "function selectAutoTaskThread");
  const stageBlock = sourceBlock(source, "function stageThreadSwitchReveal", "function finishThreadSwitchReveal");
  const deferredBlock = sourceBlock(source, "async function flushDeferredThreadResume", "function conversationSupplementIdFromRecord");

  assert.match(localBlock, /const conversationRows = root\.querySelector<HTMLElement>\("\.conversation-rows"\)/);
  assert.match(localBlock, /updateActiveMessageScroller\(\)/);
  assert.match(localBlock, /patchActiveAgentPanel\(threadId\)/);
  assert.match(localBlock, /patchConversationRow\(threadId\)/);
  assert.match(localBlock, /row\.classList\.toggle\("active", row\.dataset\.threadRow === threadId\)/);
  assert.doesNotMatch(localBlock, /root\.innerHTML|renderChatList\(|conversationRows\.innerHTML/);
  assert.match(localBlock, /form\.inert = loading/);
  assert.match(localBlock, /function releaseThreadSwitchSurface[\s\S]*form\.inert = false/);
  assert.match(selectBlock, /holdThreadSwitchSurfaceDuringDelay\(threadId\)[\s\S]*scheduleThreadSwitchLoadingState\(threadId, threadSwitchToken\)/);
  assert.match(stageBlock, /void materializeThreadSwitchSurface\(threadId, token\)/);
  assert.match(
    deferredBlock,
    /hasFullyLoadedThreadDetailCache\(threadId\) &&[\s\S]*threadModelSelection\(threadId\) \|\| threadModelSettings\(threadId\)[\s\S]*refreshCachedThreadAfterSelection/,
  );
  assert.match(deferredBlock, /holdThreadSwitchSurfaceDuringDelay\(threadId\)[\s\S]*scheduleThreadSwitchLoadingState\(threadId, threadSwitchToken\)/);
});

test("large thread history is materialized cooperatively while unrelated full renders stay deferred", async () => {
  const source = await mainSource;
  const stageBlock = sourceBlock(source, "function stageThreadSwitchReveal", "function finishThreadSwitchReveal");
  const materializeBlock = sourceBlock(source, "async function materializeThreadSwitchSurface", "function finishThreadSwitchReveal");
  const batchBlock = sourceBlock(source, "async function materializeThreadSwitchMessagesInBatches", "function yieldThreadSwitchMaterialization");
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const updateBlock = sourceBlock(source, "function updateActiveMessageScroller", "function patchMessageScrollerContent");

  assert.match(stageBlock, /void materializeThreadSwitchSurface\(threadId, token\)/);
  assert.doesNotMatch(stageBlock, /renderThreadSwitchSurface\(threadId\)/);
  assert.match(materializeBlock, /threadSwitchMaterializationToken = token/);
  assert.match(materializeBlock, /await materializeThreadSwitchMessagesInBatches\(thread, scroller, token\)/);
  assert.match(batchBlock, /const maxBatchItems = 4/);
  assert.match(batchBlock, /const batchBudgetMs = 8/);
  assert.match(batchBlock, /insertAdjacentHTML\("beforeend", batchHtml\)/);
  assert.match(batchBlock, /await yieldThreadSwitchMaterialization\(\)/);
  assert.match(renderBlock, /if \(canDeferFullRenderForThreadSwitch\(\)\)[\s\S]*threadSwitchDeferredFullRender = true;[\s\S]*return;/);
  assert.match(updateBlock, /if \(isThreadSwitchMaterializing\(thread\.id\)\) return true;/);
});

test("loaded history stays covered through DOM construction, layout, scrolling, and idle", async () => {
  const source = await mainSource;
  const stageBlock = sourceBlock(source, "function stageThreadSwitchReveal", "function finishThreadSwitchReveal");
  const finishBlock = sourceBlock(source, "function finishThreadSwitchReveal", "function scheduleThreadSwitchRevealAfterRender");
  const scheduleBlock = sourceBlock(source, "function scheduleThreadSwitchRevealAfterRender", "function waitForThreadSwitchLoadingPaint");
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");

  const revealingIndex = stageBlock.indexOf('phase: "revealing"');
  const coverIndex = stageBlock.indexOf('root.classList.add("thread-switching", "thread-revealing")');
  const clearRequestIndex = stageBlock.indexOf("switchingThreadId = null");
  const materializeIndex = stageBlock.indexOf("void materializeThreadSwitchSurface(threadId, token)");
  assert.ok(revealingIndex >= 0 && revealingIndex < coverIndex);
  assert.ok(clearRequestIndex >= 0 && clearRequestIndex < materializeIndex);
  assert.ok(coverIndex < materializeIndex);
  assert.match(finishBlock, /root\.classList\.remove\("thread-revealing", "thread-switching"\)/);
  assert.doesNotMatch(finishBlock, /\brender\(\)/, "revealing must not rebuild the huge DOM a second time");
  assert.match(scheduleBlock, /window\.setTimeout\([\s\S]*}, 200\)/);
  assert.equal((scheduleBlock.match(/window\.requestAnimationFrame/g) || []).length, 2);
  assert.match(scheduleBlock, /scrollHeight/);
  assert.match(scheduleBlock, /offsetHeight/);
  assert.match(scheduleBlock, /requestIdleCallback\(finish, \{ timeout: 1_500 \}\)/);
  assert.match(scheduleBlock, /if \(!scroller\)[\s\S]*finishThreadSwitchReveal/);
  assert.match(stageBlock, /armThreadSwitchRevealDeadline\(threadId, token\)[\s\S]*window\.setTimeout\([\s\S]*finishThreadSwitchReveal[\s\S]*8_000/);
  assert.match(stageBlock, /threadSwitchMaterializationToken === token[\s\S]*armThreadSwitchRevealDeadline\(threadId, token\)/);
  assert.match(stageBlock, /state\.activeView !== "chat" \|\| state\.currentThreadId !== threadId[\s\S]*invalidateThreadSwitchTransition\(threadId, token\)/);
  assert.match(finishBlock, /clearTimeout\(threadSwitchRevealDeadlineTimer\)/);
  assert.match(finishBlock, /state\.activeView !== "chat" \|\| state\.currentThreadId !== threadId[\s\S]*invalidateThreadSwitchTransition\(threadId, token\)/);
  assert.match(scheduleBlock, /state\.activeView !== "chat" \|\| state\.currentThreadId !== transition\.threadId[\s\S]*invalidateThreadSwitchTransition\(transition\.threadId, transition\.token\)/);
  assert.ok(renderBlock.lastIndexOf("bindEvents();") < renderBlock.lastIndexOf("scheduleThreadSwitchRevealAfterRender(renderedThreadId)"));
});

test("completion, failure, fallback, and deferred resume keep token ownership", async () => {
  const source = await mainSource;
  const selectBlock = sourceBlock(source, "async function selectThread", "function selectAutoTaskThread");
  const deferredBlock = sourceBlock(source, "async function flushDeferredThreadResume", "function conversationSupplementIdFromRecord");
  const retryBlock = sourceBlock(source, "async function resumeThreadForSelectionWithRolloutRetry", "function threadParams");
  const resumeBlock = sourceBlock(source, "async function resumeThreadWithModelLock", "async function resumeThreadForSelectionWithRolloutRetry");

  assert.match(selectBlock, /if \(!ownsThreadSwitchTransition\(threadId, threadSwitchToken\)\) return;/);
  assert.match(selectBlock, /if \(!stillOwnsSelection\) return;[\s\S]*scheduleThreadListRefresh\(250\)/);
  assert.doesNotMatch(selectBlock, /hideUnavailableThread\(threadId\)/);
  assert.match(retryBlock, /const retryDelaysMs = \[200, 700\]/);
  assert.match(retryBlock, /isMissingRolloutError\(errorMessage\(error\)\)[\s\S]*stillOwnsSelection\(\)[\s\S]*await waitMs/);
  assert.match(resumeBlock, /returnedThreadId !== threadId[\s\S]*THREAD_RESUME_ID_MISMATCH/);
  assert.match(selectBlock, /finally[\s\S]*ownsThreadSwitchTransition\(threadId, threadSwitchToken\)[\s\S]*finishThreadSwitchAfterLoad\(threadId, threadSwitchToken, revealHeavyContent\)/);
  assert.match(deferredBlock, /const workspaceSession = backgroundHydrationSession/);
  assert.match(deferredBlock, /resumeThreadForSelectionWithRolloutRetry\([\s\S]*isOwnedThreadSwitchSelection\(threadId, threadSwitchToken, workspaceSession\)/);
  assert.match(deferredBlock, /isOwnedThreadSwitchSelection\(threadId, threadSwitchToken, workspaceSession\)/);
  assert.match(deferredBlock, /finishThreadSwitchAfterLoad\(threadId, threadSwitchToken, revealHeavyContent\)/);
});

test("resume response is authoritative and task rebuilding occurs exactly with loaded snapshots", async () => {
  const source = await mainSource;
  const notificationBlock = sourceBlock(source, "function handleNotification", "function handleAutomationThreadNotification");
  const loadBlock = sourceBlock(source, "function loadThread", "function restoreThreadContinuationPayloadFromItems");
  const streamScheduler = sourceBlock(source, "function armQuestionAnswerStreamUiPatch", "function resumeQuestionAnswerStreamUiPatchAfterPointer");

  assert.match(notificationBlock, /startedThreadId && isThreadSwitchTransitionActive\(startedThreadId\)[\s\S]*return;/);
  assert.match(notificationBlock, /if \(threadId && message\.method !== "thread\/started" && !isStreamDelta\)[\s\S]*rebuildTaskFromItems\(threadId\)/);
  assert.match(streamScheduler, /flushPendingCodexStreamDeltas\(threadId\)[\s\S]*rebuildTaskFromItems\(threadId\)/);
  assert.match(loadBlock, /threadHistoryEntriesFromMessages\(threadId\)[\s\S]*rebuildTaskFromItems\(threadId\)/);
});

test("normal streaming still patches locally while stale scroll callbacks cannot affect another thread", async () => {
  const source = await mainSource;
  const notificationBlock = sourceBlock(source, "function handleNotification", "function handleAutomationThreadNotification");
  const surfacesBlock = sourceBlock(source, "function patchActiveChatSurfaces", "function shouldKeepChatSurfaceUpdateLocal");
  const updateBlock = sourceBlock(source, "function updateActiveMessageScroller", "function patchMessageScrollerContent");
  const patchBlock = sourceBlock(source, "function patchMessageScrollerContent", "function renderChatHeader");
  const scrollBlock = sourceBlock(source, "function scheduleScrollMessagesToBottom", "function isFollowingMessageStream");
  const wheelBlock = sourceBlock(source, "function bindMessageScrollerEvents", "function currentMessageScrollState");

  assert.match(notificationBlock, /if \(isStreamDelta && threadId\)[\s\S]*scheduleCodexStreamUiPatch\(threadId\);[\s\S]*return;/);
  assert.match(notificationBlock, /queueCodexStreamDelta\(threadId,[\s\S]*"agentMessage"/);
  assert.match(surfacesBlock, /updateActiveMessageScroller\(\)/);
  assert.match(updateBlock, /patchMessageScrollerContent\(scroller, thread\)/);
  assert.match(updateBlock, /scroller\.dataset\.threadId === thread\.id/);
  assert.match(updateBlock, /scroller\.dataset\.threadId = thread\.id;[\s\S]*renderMessageScrollerContent\(thread\)/);
  assert.match(patchBlock, /if \(scroller\.dataset\.threadId !== thread\.id\) return false;/);
  assert.match(patchBlock, /row\.replaceWith\(nextRow\)/);
  assert.match(scrollBlock, /state\.activeView === "chat"[\s\S]*state\.currentThreadId === threadId[\s\S]*scrollMessagesToBottom\(\)/);
  assert.match(wheelBlock, /isThreadSwitchTransitionActive\(state\.currentThreadId\)[\s\S]*return;/);
});

test("the revealing cover is solid and hides the entire message scroller until removal", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.thread-revealing \.message-scroller \{[\s\S]*visibility: hidden;/);
  assert.match(styles, /\.thread-revealing \.message-area::after \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*z-index: 6;[\s\S]*background: var\(--surface-primary\);[\s\S]*content: var\(--i18n-loading-conversation\);/);
});
