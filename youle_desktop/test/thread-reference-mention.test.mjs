import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

test("composer exposes the approved placeholder and three-level @ cascade", async () => {
  const renderer = await rendererSource;
  assert.match(renderer, /return "输入@引用附件\/技能\/会话\/提示词";/);
  assert.doesNotMatch(renderer, /今天帮你做点什么？输入@引用附件\/技能\/会话\/提示词/);
  assert.match(renderer, /\{ id: "favorites", label: "已收藏提示词" \}/);
  assert.match(renderer, /\{ id: "threads", label: "引用会话" \}/);
  assert.match(renderer, /\{ id: "skills", label: "技能\/插件" \}/);
  assert.match(renderer, /data-composer-mention-root/);
  assert.match(renderer, /composer-mention-submenu/);
  assert.match(renderer, /composer-thread-detail-submenu/);
  assert.match(renderer, /data-thread-reference-detail-search/);
  assert.match(renderer, /data-confirm-thread-reference-selection/);
});

test("input placeholders use one legible color per theme", async () => {
  const styles = await stylesSource;
  assert.match(styles, /:root\s*\{[\s\S]*?--text-placeholder: #7b8492;/);
  assert.match(styles, /html\[data-theme="dark"\]\s*\{[\s\S]*?--text-placeholder: #969eaa;/);
  assert.match(
    styles,
    /input::placeholder,\s*textarea::placeholder\s*\{\s*color: var\(--text-placeholder\);\s*opacity: 1;\s*\}/,
  );

  const placeholderRules = styles.match(/[^{}]*::placeholder[^{}]*\{[^{}]*\}/g) || [];
  assert.ok(placeholderRules.length > 0);
  for (const rule of placeholderRules) {
    assert.match(rule, /color: var\(--text-placeholder\);/, rule);
  }
});

test("question-answer @ menu keeps favorites and session references but hides skills", async () => {
  const renderer = await rendererSource;
  const match = renderer.slice(
    renderer.indexOf("function composerSkillMentionMatch"),
    renderer.indexOf("function composerPromptFavoriteMentionCandidates"),
  );
  const rootItems = renderer.slice(
    renderer.indexOf("function composerMentionSupportsSkills"),
    renderer.indexOf("function dismissComposerSkillMentionPopover"),
  );

  assert.match(
    match,
    /provider &&[\s\S]*?!isQuestionAnswerThreadId\(threadId\)[\s\S]*?!isVideoExpertThreadId\(threadId\)/,
  );
  assert.match(match, /if \(!composerMentionSupportsSkills\(\)\) return \[\];/);
  assert.match(
    renderer,
    /isQuestionAnswerThreadId\(thread\.id\)[\s\S]*?providerInputCapabilityPrompt\(provider, selectedModel\)/,
  );
  assert.match(rootItems, /\{ id: "favorites", label: "已收藏提示词" \}/);
  assert.match(rootItems, /\{ id: "threads", label: "引用会话" \}/);
  assert.match(rootItems, /composerMentionSupportsSkills\(threadId\)[\s\S]*?\{ id: "skills", label: "技能\/插件" \}/);
});

test("question-answer sends resolve selected sessions and inject their finalized context", async () => {
  const [renderer, main] = await Promise.all([rendererSource, mainSource]);
  const providerBranch = renderer.slice(
    renderer.indexOf("const provider = providerFromThreadId(threadId);", renderer.indexOf("async function sendCurrentMessage")),
    renderer.indexOf("const agentText = composerAgentText", renderer.indexOf("const provider = providerFromThreadId(threadId);", renderer.indexOf("async function sendCurrentMessage"))),
  );
  const providerSend = renderer.slice(
    renderer.indexOf("async function sendCurrentProviderMessage"),
    renderer.indexOf("function applyVideoGenerationBillingSession"),
  );
  const mainProviderHandler = main.slice(
    main.indexOf('ipcMain.handle("youle:sendProviderChat"'),
    main.indexOf("function assertExternalModelsIpcSender"),
  );

  assert.match(providerBranch, /prepareThreadReferencesForSend\([\s\S]*?composerThreadReferences/);
  assert.match(providerBranch, /threadReferences: composerThreadReferences/);
  assert.match(providerBranch, /threadReferencePreparationId: threadReferencePreparation\.preparationId/);
  assert.match(providerSend, /threadReferences: referenceRequest\.references/);
  assert.match(providerSend, /threadReferencePreparationId: params\.threadReferencePreparationId/);
  assert.match(mainProviderHandler, /resolvedThreadReferenceContext\(params, threadId, cwd\)/);
  assert.match(
    mainProviderHandler,
    /providerMessagesWithQuestionAnswerConversationPlan\(\s*params\.messages,\s*questionAnswerFileContext,\s*\)/,
  );
  assert.match(
    mainProviderHandler,
    /providerMessagesWithReferencedThreadContext\(\s*conversationMessages,\s*threadReferenceContext,\s*\)/,
  );
});

test("the @ cascade closes on Enter and outside pointer clicks", async () => {
  const renderer = await rendererSource;
  const keydown = renderer.slice(
    renderer.indexOf("function handleComposerSkillMentionKeydown"),
    renderer.indexOf("function handleComposerSkillMentionSearchKeydown"),
  );
  const outsideDismissal = renderer.slice(
    renderer.indexOf("function wireComposerSkillMentionPopoverDismissal"),
    renderer.indexOf("function wireThreadHistoryPopoverDismissal"),
  );

  assert.match(renderer, /wireComposerSkillMentionPopoverDismissal\(\);/);
  assert.match(keydown, /!state\.composerSkillMention\.open && event\.key === "Enter"/);
  assert.match(keydown, /event\.key === "Enter" \|\| event\.key === "Escape"/);
  assert.match(keydown, /dismissComposerSkillMentionPopover\(\)/);
  assert.match(
    outsideDismissal,
    /event\.button !== 0 \|\|[\s\S]*?!state\.composerSkillMention\.open &&[\s\S]*?!state\.composerMediaMention\.open/,
  );
  assert.match(
    outsideDismissal,
    /target\?\.closest\([\s\S]*?"\.composer-skill-popover, \.composer-media-mention-popover"/,
  );
  assert.match(outsideDismissal, /dismissComposerSkillMentionPopover\(\)/);
});

test("session references exclude the current session, use left-list grouping order, and truncate to ten characters", async () => {
  const renderer = await rendererSource;
  const candidates = renderer.slice(
    renderer.indexOf("function composerThreadMentionCandidates"),
    renderer.indexOf("function composerSkillName"),
  );
  assert.match(candidates, /sortThreadsForList\(state\.threads\)/);
  assert.match(candidates, /thread\.id !== currentThreadId/);
  assert.match(candidates, /for \(const group of sortedThreadGroups\(\)\)/);
  assert.match(candidates, /characters\.slice\(0, 10\)/);
});

test("execution and multi-agent sessions can reference all or selected question-answer turns", async () => {
  const [renderer, main] = await Promise.all([rendererSource, mainSource]);
  const candidates = renderer.slice(
    renderer.indexOf("function composerThreadMentionCandidates"),
    renderer.indexOf("function composerThreadReferenceHistoryEntriesFromSnapshot"),
  );
  const history = renderer.slice(
    renderer.indexOf("function questionAnswerThreadReferenceSnapshot"),
    renderer.indexOf("function prefetchAllComposerThreadReferenceHistories"),
  );
  const request = renderer.slice(
    renderer.indexOf("function threadReferenceRequestParams"),
    renderer.indexOf("async function prepareThreadReferencesForSend"),
  );
  const mainRead = main.slice(
    main.indexOf("async function readReferencedThreadResults"),
    main.indexOf("function threadReferenceBudgetFromParams"),
  );

  assert.match(candidates, /isLocalCodexThread\(thread\.id\) \|\| isQuestionAnswerThreadId\(thread\.id\)/);
  assert.match(candidates, /!providerDraftThreadIds\.has\(thread\.id\)/);
  assert.match(history, /item\.type === "userMessage"/);
  assert.match(history, /item\.type !== "agentMessage"/);
  assert.match(history, /composerThreadReferenceHistoryEntriesFromSnapshot\(questionAnswerSnapshot\)/);
  assert.match(request, /questionAnswerThreadReferenceSnapshot\(reference\.threadId, reference\.name\)/);
  assert.match(request, /inlineThread/);
  assert.match(mainRead, /if \(reference\.inlineThread\) return \{ thread: reference\.inlineThread \}/);
});

test("session submenu titles use the full remaining row width before ellipsizing", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const list = renderer.slice(
    renderer.indexOf("function renderComposerThreadReferenceList"),
    renderer.indexOf("function renderSubagentOutputBoard"),
  );
  assert.match(list, /class="composer-thread-reference-name">\$\{escapeHtml\(candidate\.name\)\}<\/span>/);
  assert.doesNotMatch(list, /truncateThreadReferenceName\(candidate\.name\)/);
  assert.match(styles, /\.composer-thread-reference-name\s*\{[\s\S]*?flex:\s*1;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
});

test("selected session ids survive drafts and are sent through the reference-context bridge", async () => {
  const [renderer, main, preload] = await Promise.all([rendererSource, mainSource, preloadSource]);
  assert.match(renderer, /composerThreadReferences: ComposerThreadReference\[\]/);
  assert.match(renderer, /threadReferences: cloneComposerThreadReferences/);
  assert.match(renderer, /prepareThreadReferencesForSend/);
  assert.match(renderer, /selectionMode: reference\.selectionMode/);
  assert.match(renderer, /turnIds: \[\.\.\.reference\.turnIds\]/);
  assert.match(preload, /codex:prepareThreadReferences/);
  assert.match(main, /thread\/read/);
  assert.match(main, /includeTurns: true/);
  assert.match(main, /additionalContext: threadReferenceContext\?\.additionalContext/);
  assert.match(main, /threadReferenceContext\?\.mediaInputs/);
});

test("skill and session mentions normalize an inline trigger to a valid token boundary", async () => {
  const renderer = await rendererSource;
  const skillApply = renderer.slice(
    renderer.indexOf("function applyComposerSkillMention("),
    renderer.indexOf("function applyComposerPromptFavorite("),
  );
  const threadApply = renderer.slice(
    renderer.indexOf("function applyComposerThreadReferenceSelection("),
    renderer.indexOf("function syncComposerMentionPopovers("),
  );
  assert.match(skillApply, /composerMentionLeadingSpacer\(input\.value, match\.start\)/);
  assert.match(skillApply, /composerMentionTrailingSpacer\(afterSelection\)/);
  assert.match(threadApply, /composerMentionLeadingSpacer\(input\.value, match\.start\)/);
  assert.match(threadApply, /composerMentionTrailingSpacer\((?:afterSelection|afterExisting)\)/);
});

test("skill and session mention labels keep an atomic caret boundary", async () => {
  const renderer = await rendererSource;
  assert.match(renderer, /function composerSkillReferenceAtomicRanges\(/);
  assert.match(
    renderer,
    /function handleComposerSkillReferenceArrowKeydown\([\s\S]*target\.leadingStart[\s\S]*target\.end/,
  );
  assert.match(
    renderer,
    /handleComposerMediaReferenceArrowKeydown\(event\)[\s\S]*handleComposerSkillReferenceArrowKeydown\(event\)/,
  );
  assert.match(
    renderer,
    /function normalizeComposerSkillReferenceSpacingInInput\(/,
  );
  assert.match(
    renderer,
    /normalizeComposerMediaReferenceSpacingInInput\(input\);[\s\S]*normalizeComposerSkillReferenceSpacingInInput\(input\);/,
  );
  assert.match(renderer, /function snapComposerAtomicReferenceCaret\(/);
  assert.match(
    renderer,
    /addEventListener\("beforeinput",[\s\S]*snapComposerAtomicReferenceCaret/,
  );
  assert.match(
    renderer,
    /addEventListener\("click",[\s\S]*snapComposerAtomicReferenceCaret/,
  );
});

test("third-level session history supports filtered select-all and actual-range labels", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  assert.match(renderer, /searchableConversationMessageText\(`\$\{userText\}\\n\$\{assistantText\}`\)/);
  assert.match(renderer, /const visible = filteredComposerThreadReferenceHistory\(detail\)/);
  assert.match(renderer, /if \(allVisibleSelected\) selected\.delete\(entry\.turnId\)/);
  assert.match(renderer, /function threadReferenceSelectionMode\(selectedTurnCount: number, totalTurnCount: number\)/);
  assert.match(renderer, /selectedTurnCount === 1 \? "single" : "multiple"/);
  assert.match(renderer, /确定引用已勾选的内容/);
  assert.match(styles, /\.composer-thread-detail-submenu\s*\{/);
  assert.match(styles, /\.composer-thread-detail-option-time\s*\{/);
});

test("partial history selection leaves the select-all checkbox visually unchecked", async () => {
  const renderer = await rendererSource;
  assert.match(renderer, /aria-checked="\$\{allVisibleSelected \? "true" : "false"\}"/);
  assert.match(renderer, />\$\{allVisibleSelected \? "✓" : ""\}<\/span>/);
  assert.doesNotMatch(renderer, /someVisibleSelected|indeterminate|aria-checked="\$\{[^\n]*"mixed"/);
});

test("third-level session history stays centered beside the active session row", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  assert.match(renderer, /function positionComposerThreadReferenceDetail\(\)/);
  assert.match(renderer, /anchorRect\.top \+ anchorRect\.height \/ 2 - submenuRect\.top - detailRect\.height \/ 2/);
  assert.match(renderer, /window\.innerHeight - viewportPadding - submenuRect\.top - detailRect\.height/);
  assert.match(renderer, /"scroll",\s*positionComposerThreadReferenceDetail/);
  const detailStyles = styles.slice(
    styles.indexOf(".composer-thread-detail-submenu {"),
    styles.indexOf(".composer-thread-detail-hover-bridge {"),
  );
  assert.match(detailStyles, /top:\s*50%/);
  assert.match(detailStyles, /transform:\s*translateY\(-50%\)/);
  assert.doesNotMatch(detailStyles, /bottom:\s*0/);
});

test("opening third-level history preserves the second-level scroll position", async () => {
  const renderer = await rendererSource;
  assert.match(renderer, /function renderComposerMentionPreservingThreadListScroll\(\)/);
  assert.match(renderer, /const previousScrollTop = previousList\?\.scrollTop \?\? 0/);
  assert.match(renderer, /if \(nextList\) nextList\.scrollTop = previousScrollTop/);
  const detailOpen = renderer.slice(
    renderer.indexOf("function showComposerThreadReferenceDetail"),
    renderer.indexOf("function filteredComposerThreadReferenceHistory"),
  );
  assert.match(detailOpen, /renderComposerMentionPreservingThreadListScroll\(\)/);
  assert.match(renderer, /candidate\?\.threadId === state\.composerSkillMention\.threadDetail\.threadId/);
});

test("third-level session history opens only from the trailing selection control", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  assert.match(renderer, /data-thread-reference-main-index="\$\{index\}"/);
  assert.match(renderer, /data-thread-reference-detail-index="\$\{index\}"/);
  assert.match(renderer, /<span>选择<\/span>/);
  assert.doesNotMatch(renderer, /composer-thread-reference-select-arrow/);
  assert.doesNotMatch(renderer, /class="composer-thread-reference-icon"/);
  assert.doesNotMatch(styles, /\.composer-thread-reference-icon\s*\{/);
  assert.doesNotMatch(styles, /\.composer-thread-reference-select-arrow\s*\{/);
  const bindings = renderer.slice(
    renderer.indexOf("function bindComposerSkillMentionItemEvents"),
    renderer.indexOf("function focusComposerInputAfterSkillSearch"),
  );
  assert.match(bindings, /\[data-thread-reference-detail-index\][\s\S]*?trigger\.addEventListener\("mouseenter", openDetail\)/);
  assert.match(bindings, /\[data-thread-reference-main-index\][\s\S]*?threadDetail = null/);
  assert.match(styles, /\.composer-thread-reference-select\s*\{[\s\S]*?color:\s*var\(--brand-blue\);[\s\S]*?cursor:\s*pointer/);
  assert.match(styles, /\.composer-thread-reference-select\s*\{[\s\S]*?font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\)/);
  assert.match(styles, /\.composer-thread-reference-select:hover\s*\{[\s\S]*?color:\s*var\(--brand-blue\);/);
});

test("the trailing history selector appears only after global count prefetch finds at least two entries", async () => {
  const renderer = await rendererSource;
  const listRenderer = renderer.slice(
    renderer.indexOf("function renderComposerThreadReferenceList"),
    renderer.indexOf("function renderComposerThreadReferenceDetail"),
  );
  assert.match(listRenderer, /composerThreadReferenceHistoryByThreadId\.get\(candidate\.threadId\)\?\.length \?\? 0\) >= 2/);
  assert.match(listRenderer, /\$\{showHistorySelection[\s\S]*?data-thread-reference-detail-index/);
  assert.match(renderer, /function prefetchAllComposerThreadReferenceHistories\(\)/);
  assert.match(renderer, /COMPOSER_THREAD_REFERENCE_PREFETCH_CONCURRENCY = 2/);
  assert.match(renderer, /if \(submenu === "threads"\) prefetchAllComposerThreadReferenceHistories\(\)/);
  const bindings = renderer.slice(
    renderer.indexOf("function bindComposerSkillMentionItemEvents"),
    renderer.indexOf("function focusComposerInputAfterSkillSearch"),
  );
  const mainHoverBinding = bindings.slice(
    bindings.indexOf("[data-thread-reference-main-index]"),
    bindings.indexOf("[data-thread-reference-detail-index]"),
  );
  assert.doesNotMatch(mainHoverBinding, /prefetchAllComposerThreadReferenceHistories/);
});

test("the three-level mention cascade uses three-quarter widths", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.composer-skill-popover\s*\{[\s\S]*?width:\s*126px/);
  assert.match(styles, /\.composer-mention-submenu\s*\{[\s\S]*?width:\s*min\(270px, calc\(75vw - 195px\)\)/);
  assert.match(styles, /\.composer-thread-detail-submenu\s*\{[\s\S]*?width:\s*clamp\(240px, 22\.5vw, 300px\)/);
});

test("the mention cascade keeps three-pixel gaps between levels", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.composer-mention-submenu\s*\{[\s\S]*?left:\s*calc\(100% \+ 3px\)/);
  assert.match(styles, /\.composer-thread-detail-submenu\s*\{[\s\S]*?left:\s*calc\(100% \+ 3px\)/);
});

test("the mention cascade uses light gray hover rows at every level", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.composer-skill-popover button:hover\s*\{[\s\S]*?background:\s*var\(--surface-soft\)/);
  assert.match(styles, /\.composer-skill-popover button\.active\s*\{[\s\S]*?background:\s*var\(--surface-soft\)/);
});

test("dark mention submenus distinguish panels, selections, and disabled actions", async () => {
  const styles = await stylesSource;
  const activeReferenceRuleStart = styles.indexOf(
    'html[data-theme="dark"] .composer-skill-popover .composer-thread-reference-item.active {',
  );
  const activeReferenceRule = styles.slice(activeReferenceRuleStart, styles.indexOf("}", activeReferenceRuleStart) + 1);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-mention-submenu\s*\{[\s\S]*?border-color: #383b42/);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-thread-detail-submenu\s*\{[\s\S]*?border-color: #41454d/);
  assert.match(styles, /\.composer-thread-detail-option\.selected \.composer-thread-detail-checkbox\s*\{[\s\S]*?background: #3478cf/);
  assert.match(activeReferenceRule, /border-color: rgba\(91, 157, 255, 0\.24\)/);
  assert.doesNotMatch(activeReferenceRule, /box-shadow/);
  assert.match(styles, /\.composer-thread-detail-footer button:disabled:hover\s*\{[\s\S]*?background: #25282d/);
});

test("dark mention navigation uses the shared hover blue instead of the stronger selected blue", async () => {
  const styles = await stylesSource;
  assert.match(
    styles,
    /\.composer-mention-root\[role="menu"\][\s\S]*?> \.composer-mention-root-item\[role="menuitem"\]\.active:not\(:disabled\),[\s\S]*?\.composer-skill-popover \[role="listbox"\] \[role="option"\]\.active\s*\{\s*background: var\(--selection-soft\);/,
  );
});

test("the mention cascade is not clipped behind the expanded system dashboard", async () => {
  const styles = await stylesSource;
  const cascadePanelStyles = styles.slice(
    styles.indexOf(".desktop-body > .chat-panel:has(.composer-mention-cascade:not(.hidden))"),
    styles.indexOf(".blank-panel {"),
  );
  assert.match(cascadePanelStyles, /z-index:\s*5/);
  assert.match(cascadePanelStyles, /overflow:\s*visible/);
});

test("session groups do not render divider lines", async () => {
  const styles = await stylesSource;
  const groupSpacing = styles.slice(
    styles.indexOf(".composer-thread-reference-group + .composer-thread-reference-group {"),
    styles.indexOf(".composer-thread-reference-title {"),
  );
  assert.doesNotMatch(groupSpacing, /border-top/);
});

test("the third-level select-all and search controls use a four-pixel gap", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.composer-thread-detail-search-row\s*\{[\s\S]*?gap:\s*4px/);
});

test("selected third-level controls use black instead of blue", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.composer-thread-detail-option\.selected \.composer-thread-detail-checkbox\s*\{[\s\S]*?border-color:\s*#000;[\s\S]*?background:\s*#000/);
  assert.match(styles, /\.composer-skill-popover \.composer-thread-detail-footer button\s*\{[\s\S]*?background:\s*#000/);
  assert.match(styles, /\.composer-skill-popover \.composer-thread-detail-footer button:hover\s*\{[\s\S]*?background:\s*#000/);
});

test("third-level bulk controls appear only for at least four history entries", async () => {
  const renderer = await rendererSource;
  const detailRenderer = renderer.slice(
    renderer.indexOf("function renderComposerThreadReferenceDetail"),
    renderer.indexOf("function renderSubagentOutputBoard"),
  );
  assert.match(detailRenderer, /const showBulkControls = detail\.entries\.length >= 4/);
  assert.match(detailRenderer, /\$\{showBulkControls[\s\S]*?composer-thread-detail-search-row/);
});

test("reference overflow uses the existing visible context-compaction status", async () => {
  const renderer = await rendererSource;
  const preparation = renderer.slice(
    renderer.indexOf("async function prepareThreadReferencesForSend"),
    renderer.indexOf("function requestAutomaticThreadContextCompaction"),
  );
  assert.match(preparation, /beginLocalContextCompactionItem\(threadId\)/);
  assert.match(preparation, /setActiveContextCompactionUiStatus\(threadId, "compacting"\)/);
  assert.match(preparation, /phase: "compress"/);
});

test("reference compression uses the refreshed budget after compacting the current session", async () => {
  const renderer = await rendererSource;
  const preparation = renderer.slice(
    renderer.indexOf("async function prepareThreadReferencesForSend"),
    renderer.indexOf("function requestAutomaticThreadContextCompaction"),
  );
  assert.match(preparation, /let requestParams = threadReferenceRequestParams\(threadId, references, agentText\)/);
  assert.match(
    preparation,
    /requestParams = threadReferenceRequestParams\(threadId, references, agentText\);\s*inspection = await api\.prepareThreadReferences\(\{\s*\.\.\.requestParams,\s*phase: "inspect"/,
  );
  assert.match(
    preparation,
    /if \(inspection\?\.requiresCompression\)[\s\S]*?api\.prepareThreadReferences\(\{\s*\.\.\.requestParams,\s*phase: "compress"/,
  );
});

test("all-session references hide the selection label before and after sending", async () => {
  const renderer = await rendererSource;
  const directApply = renderer.slice(
    renderer.indexOf("function applyComposerThreadReference("),
    renderer.indexOf("function applyComposerThreadReferenceSelection("),
  );
  assert.match(directApply, /selectionMode: "all",\s*displaySelectionLabel: false/);
  assert.match(renderer, /function composerThreadReferenceToken\(name: string, mode: ThreadReferenceSelectionMode, displaySelectionLabel = true\)/);
  assert.match(renderer, /const displaySelectionLabel = selection\.selectionMode !== "all" && selection\.displaySelectionLabel !== false/);
  assert.match(renderer, /threadReferenceSelectionSuffix\(reference\.selectionMode, reference\.displaySelectionLabel !== false\)/);
  assert.match(renderer, /displaySelectionLabel: Boolean\(match\?\.\[2\]\)/);
});

test("sent session mentions render as gray reference lines above the user message", async () => {
  const renderer = await rendererSource;
  assert.match(renderer, /THREAD_REFERENCE_DISPLAY_START = "<haolo_referenced_threads>"/);
  assert.match(renderer, /applyComposerThreadReferenceContext\(text, threadReferences\)/);
  assert.match(renderer, /__youleThreadReferences: cloneComposerThreadReferences/);
  assert.match(renderer, /threadReferencePreviews: display\.threadReferences/);
  assert.match(renderer, /class="message-quote-line message-thread-reference-line"/);
  assert.match(renderer, /const text = `引用会话：\$\{sentThreadReferenceName\(reference\.name\)\}\$\{suffix\}`/);
  assert.match(renderer, /characters\.slice\(0, 10\)\.join\(""\)\}\.\.\.`/);
});
