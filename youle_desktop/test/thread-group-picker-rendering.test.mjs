import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const electronMainSource = readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("new task group picker opens the group option list before folder import", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(
    source,
    "function renderNewThreadGroupPicker",
    "function isThreadGroupOnboardingEmptyForThreads",
  );

  assert.match(renderBlock, /renderThreadGroupPickerOptionRow/);
  assert.match(renderBlock, /"new-thread-group-option"/);
  assert.match(
    renderBlock,
    /filter\(\(group\) => !isDefaultThreadGroup\(group\.id\)\)/,
  );
  assert.match(
    renderBlock,
    /selectedIsDefaultGroup \? "选择分组" : threadGroupDisplayLabel\(selectedGroup\)/,
  );
  assert.match(
    renderBlock,
    /<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" \/><\/svg>/,
  );
  assert.match(renderBlock, /data-action="clear-new-thread-group"/);
  assert.match(
    renderBlock,
    /data-new-thread-group-picker-thread-id="\$\{escapeAttr\(threadId\)\}"/,
  );
  assert.match(renderBlock, /class="new-thread-group-clear-button"/);
  assert.match(renderBlock, /class="new-thread-group-folder-icon"/);
  assert.match(renderBlock, /HOME_ICON_URL\.groupPickerFolder/);
  assert.doesNotMatch(renderBlock, /HOME_ICON_URL\.folder/);
  assert.match(renderBlock, /selectedIsDefaultGroup \? "" : selectedGroupIcon/);
  assert.match(renderBlock, /selectedIsDefaultGroup \? selectedGroupIcon : ""/);
  assert.match(renderBlock, /renderThreadGroupAddMenuItem\("new-thread"\)/);
  assert.match(
    renderBlock,
    /renderThreadGroupPickerOptionRow\(group,\s*selectedGroup\.id,\s*"new-thread-group-option",?\s*\)/,
  );
  assert.doesNotMatch(
    renderBlock,
    /data-action="import-new-thread-group-folder"/,
  );
  assert.doesNotMatch(source, /new-thread-picker/);
  assert.doesNotMatch(source, /["']auto-task-picker["']/);

  const optionRowBlock = sourceBlock(
    source,
    "function renderThreadGroupPickerOptionRow",
    "function renderThreadGroupAddMenuIcon",
  );
  assert.doesNotMatch(optionRowBlock, /thread-group-option-more/);
  assert.doesNotMatch(optionRowBlock, /open-thread-group-menu-from-picker/);

  const eventBindings = source.slice(source.indexOf("function bindEvents"));
  const toggleBlock = sourceBlock(
    eventBindings,
    "'[data-action=\"toggle-new-thread-group-picker\"]'",
    "'[data-action=\"toggle-video-expert-menu\"]'",
  );

  assert.match(toggleBlock, /querySelectorAll<HTMLButtonElement>/);
  assert.match(
    toggleBlock,
    /button\.dataset\.newThreadGroupPickerAnchor === "hero" \? "hero" : "composer"/,
  );
  assert.match(
    toggleBlock,
    /state\.newThreadGroupPickerOpen = !closingCurrentAnchor/,
  );
  assert.match(toggleBlock, /state\.newThreadGroupPickerAnchor = anchor/);
  assert.match(
    toggleBlock,
    /data-action="clear-new-thread-group"[\s\S]*selectComposerThreadGroup\(currentComposerThreadId\(\), DEFAULT_THREAD_GROUP_ID\)/,
  );
  assert.doesNotMatch(toggleBlock, /importThreadGroupFolder/);

  const optionSelectionBlock = sourceBlock(
    eventBindings,
    '.querySelectorAll<HTMLButtonElement>("[data-new-thread-group-option]")',
    "'[data-action=\"open-auto-tasks\"]'",
  );
  assert.match(
    optionSelectionBlock,
    /button\.closest<HTMLElement>\("\[data-new-thread-group-picker-thread-id\]"\)/,
  );
  assert.match(
    optionSelectionBlock,
    /picker\?\.dataset\.newThreadGroupPickerThreadId/,
  );
  assert.match(
    optionSelectionBlock,
    /selectComposerThreadGroup\(threadId, groupId\)/,
  );

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.composer-context-group-picker \.chat-title-group-button\s*\{[\s\S]*gap: 8px;/,
  );
  assert.match(
    styles,
    /\.composer-context-group-picker \.chat-title-group-button \.new-thread-group-folder-icon,[\s\S]*width: 15px;[\s\S]*height: 15px;[\s\S]*opacity: 1;/,
  );
  assert.match(
    styles,
    /\.composer-group-picker\.has-selected-group \.chat-title-group-control:hover \.new-thread-group-clear-button img\s*\{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.composer-group-picker\.has-selected-group \.chat-title-group-control:hover \.new-thread-group-clear-button svg\s*\{[\s\S]*display: block;/,
  );
});

test("group add entries use a cascading create-or-existing folder menu", async () => {
  const source = await mainSource;
  const addMenuBlock = sourceBlock(
    source,
    "function renderThreadGroupAddMenuItem",
    "function renderThreadGroupDropdownOptions",
  );

  assert.match(addMenuBlock, /增加分组/);
  assert.match(addMenuBlock, /新建文件夹/);
  assert.match(addMenuBlock, /使用现有文件夹/);
  assert.match(addMenuBlock, /data-action="create-thread-group-folder"/);
  assert.match(addMenuBlock, /data-action="use-existing-thread-group-folder"/);
  assert.match(addMenuBlock, /data-thread-group-import-target/);

  const chatListBlock = sourceBlock(
    source,
    "function renderChatList",
    "function renderExternalChannelMenu",
  );
  assert.match(chatListBlock, /data-action="open-group-chat-dialog"/);
  assert.match(chatListBlock, /<strong>发起群聊<\/strong>/);
  assert.doesNotMatch(chatListBlock, /renderThreadGroupAddMenuItem/);
  assert.match(chatListBlock, /renderExternalChannelCascadeMenuItem\(\)/);
  assert.doesNotMatch(chatListBlock, />导入分组</);

  const autoTaskBlock = sourceBlock(
    source,
    "function renderAutoTaskGroupPicker",
    "function renderAutoTaskFrequencyPanel",
  );
  assert.match(autoTaskBlock, /renderThreadGroupAddMenuItem\("auto-task"\)/);
  assert.match(autoTaskBlock, /class="new-thread-group-folder-icon"/);
  assert.match(autoTaskBlock, /HOME_ICON_URL\.groupPickerFolder/);
  assert.doesNotMatch(autoTaskBlock, /HOME_ICON_URL\.folder/);

  const dropdownBlock = sourceBlock(
    source,
    "function renderThreadGroupDropdownOptions",
    "function renderThreadGroupCreateFolderDialog",
  );
  assert.match(dropdownBlock, /renderThreadGroupAddMenuItem\("set-dialog"\)/);
  assert.doesNotMatch(dropdownBlock, />导入分组</);

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.chat-new-menu\s*\{[\s\S]*--chat-new-menu-padding: 10px;[\s\S]*--chat-new-menu-submenu-gap: 2px;[\s\S]*--chat-new-menu-submenu-offset: calc\([\s\S]*var\(--chat-new-menu-padding\) \+ 1px \+ var\(--chat-new-menu-submenu-gap\)/,
  );
  assert.match(
    styles,
    /\.thread-group-add-menu-item\s*\{[\s\S]*--thread-group-add-submenu-offset: 9px;/,
  );
  assert.match(
    styles,
    /\.thread-group-select-menu \.thread-group-add-menu-item\s*\{[\s\S]*--thread-group-add-submenu-offset: 10px;/,
  );
  assert.match(
    styles,
    /\.thread-group-add-submenu\s*\{[\s\S]*left: calc\(100% \+ var\(--thread-group-add-submenu-offset\)\);/,
  );
  assert.match(
    styles,
    /\.composer-group-picker \.thread-group-add-submenu\s*\{[\s\S]*transform: translateY\(-50px\);/,
  );
  assert.match(
    styles,
    /\.auto-task-group-panel \.thread-group-add-submenu\s*\{[\s\S]*transform: translateY\(-50px\);/,
  );
  assert.match(
    styles,
    /\.auto-task-group-trigger \.new-thread-group-folder-icon\s*\{[\s\S]*width: 15px;[\s\S]*height: 15px;[\s\S]*flex-basis: 15px;[\s\S]*opacity: 1;/,
  );
  assert.doesNotMatch(styles, /\.thread-group-add-menu-item\.quick/);
  assert.doesNotMatch(styles, /\.thread-group-add-trigger-quick/);
  assert.match(
    styles,
    /\.thread-group-add-submenu::before\s*\{[\s\S]*right: 100%;[\s\S]*width: var\(--thread-group-add-submenu-offset\);/,
  );
  assert.match(
    styles,
    /\.thread-group-add-menu-item:hover > \.thread-group-add-submenu/,
  );
  assert.doesNotMatch(styles, /--chat-new-menu-joint-overlap/);
  assert.doesNotMatch(
    styles,
    /\.chat-new-menu:has\(\.thread-group-add-menu-item/,
  );
  assert.doesNotMatch(styles, /border-radius: 0 10px 10px 0/);
  assert.doesNotMatch(styles, /clip-path: inset\(-40px -40px -40px 0\)/);
  assert.match(
    styles,
    /\.chat-title-group-menu\.thread-group-add-menu-host,\s*\.auto-task-group-panel\.thread-group-add-menu-host,\s*\.thread-group-select-menu\.thread-group-add-menu-host\s*\{[\s\S]*overflow: visible;/,
  );
  assert.match(
    styles,
    /\.desktop-body > aside:not\(\.app-sidebar\):not\(\.agent-panel\):not\(\.chat-list\)/,
  );
  assert.match(
    styles,
    /\.desktop-body > aside\.chat-list\s*\{[\s\S]*z-index: 30;[\s\S]*overflow: visible;/,
  );
  assert.match(
    styles,
    /\.desktop-body > \.chat-panel:has\(\.composer-context-group-picker\.open\)\s*\{[\s\S]*z-index: 5;[\s\S]*overflow: visible;/,
  );
});

test("external channel entry opens as a cascading submenu", async () => {
  const source = await mainSource;
  const cascadeBlock = sourceBlock(
    source,
    "function renderExternalChannelCascadeMenuItem",
    "function renderExternalChannelMenu",
  );

  assert.match(cascadeBlock, /external-channel-cascade-item/);
  assert.match(cascadeBlock, /data-action="prime-external-channel-menu"/);
  assert.match(
    cascadeBlock,
    /renderExternalChannelMenu\(\{ submenu: true \}\)/,
  );
  assert.match(cascadeBlock, /renderThreadGroupAddMenuIcon\("chevron"\)/);

  const menuBlock = sourceBlock(
    source,
    "function renderExternalChannelMenu",
    "function renderExternalChannelRow",
  );
  assert.match(menuBlock, /options: \{ submenu\?: boolean \} = \{\}/);
  assert.match(menuBlock, /external-channel-submenu/);
  assert.doesNotMatch(menuBlock, /external-channel-menu-title/);
  assert.doesNotMatch(menuBlock, />连接渠道</);

  const eventBindings = source.slice(source.indexOf("function bindEvents"));
  const bindBlock = sourceBlock(
    eventBindings,
    "'[data-action=\"prime-external-channel-menu\"]'",
    '"[data-external-channel-id]"',
  );
  assert.match(bindBlock, /mouseenter/);
  assert.match(bindBlock, /focus/);
  assert.match(bindBlock, /primeExternalChannelMenu\(\)/);
  assert.doesNotMatch(source, /data-action="open-external-channel-menu"/);

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.external-channel-menu\.external-channel-submenu\s*\{[\s\S]*top: auto;[\s\S]*bottom: calc\(-1 \* \(var\(--chat-new-menu-padding\) \+ 1px\)\);[\s\S]*left: calc\(100% \+ var\(--chat-new-menu-submenu-offset\)\);[\s\S]*display: none;[\s\S]*border-radius: 10px;/,
  );
  assert.doesNotMatch(styles, /--chat-new-menu-row-height/);
  assert.match(
    styles,
    /\.external-channel-menu\.external-channel-submenu::before\s*\{[\s\S]*right: 100%;[\s\S]*width: var\(--chat-new-menu-submenu-offset\);/,
  );
  assert.match(
    styles,
    /\.external-channel-cascade-item:hover > \.external-channel-submenu/,
  );
  assert.match(
    styles,
    /\.chat-new-menu \.external-channel-menu \.external-channel-row\s*\{[\s\S]*display: grid;[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\);/,
  );
});

test("new group folder dialog creates a real folder before importing it", async () => {
  const source = await mainSource;
  const dialogBlock = sourceBlock(
    source,
    "function renderThreadGroupCreateFolderDialog",
    "function renderThreadGroupEditorDialog",
  );
  assert.match(dialogBlock, /新建文件夹/);
  assert.match(dialogBlock, /填写文件夹名/);
  assert.match(dialogBlock, /id="threadGroupCreateFolderForm"/);

  const submitBlock = sourceBlock(
    source,
    "async function submitThreadGroupCreateFolderDialog",
    "async function importThreadGroupFolder",
  );
  assert.match(submitBlock, /api\.createThreadGroupFolder\(\{ name \}\)/);
  assert.match(
    submitBlock,
    /importThreadGroupFolderPath\(folderPath, folderName, target/,
  );

  const main = await electronMainSource;
  assert.match(main, /ipcMain\.handle\("app:createThreadGroupFolder"/);
  assert.match(main, /validateThreadGroupFolderName/);
  assert.match(main, /DEFAULT_THREAD_GROUP_ID/);
  assert.match(main, /DEFAULT_THREAD_GROUP_WORKSPACE_SLUG/);
  assert.match(main, /path\.relative\(basePath, folderPath\)/);
  assert.match(main, /fs\.promises\.mkdir\(folderPath\)/);
});

test("a newly created folder group expands while every other group collapses", async () => {
  const source = await mainSource;
  const collapseBlock = sourceBlock(
    source,
    "function collapseOtherThreadGroupsAfterCreate",
    "function upsertExternalThreadGroup",
  );
  assert.match(collapseBlock, /collapsedThreadGroupIds\.clear\(\)/);
  assert.match(collapseBlock, /for \(const group of threadGroups\)/);
  assert.match(
    collapseBlock,
    /if \(group\.id !== createdGroupId\) collapsedThreadGroupIds\.add\(group\.id\)/,
  );

  const upsertBlock = sourceBlock(
    source,
    "function upsertExternalThreadGroup",
    "function externalThreadGroupByPath",
  );
  const existingReturnIndex = upsertBlock.indexOf("return nextGroup");
  const createIndex = upsertBlock.indexOf("threadGroups.unshift(group)");
  const collapseIndex = upsertBlock.indexOf(
    "collapseOtherThreadGroupsAfterCreate(group.id)",
  );
  assert.ok(
    existingReturnIndex >= 0,
    "existing folder groups should return without resetting collapse state",
  );
  assert.ok(
    createIndex > existingReturnIndex,
    "collapse state should only reset in the new-group branch",
  );
  assert.ok(
    collapseIndex > createIndex,
    "other groups should collapse after the new group is inserted",
  );
});

test("composer creates an empty folder group immediately and assigns the conversation on first send", async () => {
  const source = await mainSource;
  const importBlock = sourceBlock(
    source,
    "async function importThreadGroupFolderPath",
    "function selectNewThreadGroupFolder",
  );
  assert.match(
    importBlock,
    /if \(target === "new-thread"\) \{[\s\S]*selectNewThreadGroupFolder\(folderPath, displayName\);[\s\S]*return;/,
  );

  const selectionBlock = sourceBlock(
    source,
    "function selectNewThreadGroupFolder",
    "function selectAutoTaskThreadGroupFolder",
  );
  assert.match(
    selectionBlock,
    /const group = upsertExternalThreadGroup\(folderName \|\| folderNameFromPath\(folderPath\), folderPath\)/,
  );
  assert.match(
    selectionBlock,
    /selectComposerThreadGroup\(composerThreadId, group\.id\)/,
  );
  assert.match(selectionBlock, /已创建空分组，发送任务后会话将归入该分组/);
  assert.doesNotMatch(selectionBlock, /pendingNewThreadGroup/);
  assert.doesNotMatch(selectionBlock, /ensureLocalGroupBlankThread/);

  const commitBlock = sourceBlock(
    source,
    "function commitSelectedNewThreadGroupForSend",
    "function selectComposerThreadGroup",
  );
  assert.match(
    commitBlock,
    /return commitActiveNewThreadGroupForSend\(threadId, selectedGroupId\)/,
  );
  assert.match(commitBlock, /threadGroupByThreadId\[threadId\] = group\.id/);
  assert.match(commitBlock, /canCommitNewThreadGroupForSend\(threadId\)/);
  assert.doesNotMatch(commitBlock, /upsertExternalThreadGroup/);

  const localSelectionBlock = sourceBlock(
    source,
    "function selectActiveNewThreadGroup",
    "function pinThreadGroup",
  );
  assert.match(
    localSelectionBlock,
    /if \(blankThread && isDefaultThreadGroup\(group\.id\)\) \{[\s\S]*threadGroupByThreadId\[blankThread\.id\] = group\.id/,
  );

  const listBlock = sourceBlock(
    source,
    "function renderThreadSections",
    "function conversationGroupSectionsForList",
  );
  assert.match(
    listBlock,
    /const showEmptyGroups = [\s\S]*visibleGroups\.length > 0/,
  );
  assert.match(listBlock, /groupedThreadsForList\(threads, showEmptyGroups\)/);
});

test("conversation-list group menus open beside the list with the same small gap as thread menus", async () => {
  const source = await mainSource;
  const threadMenuBlock = sourceBlock(
    source,
    "function threadMenuStyle",
    "function threadGroupMenuStyle",
  );
  const groupMenuBlock = sourceBlock(
    source,
    "function threadGroupMenuStyle",
    "function isThreadGroupPickerMenuSource",
  );

  assert.match(source, /const THREAD_CONTEXT_MENU_LIST_GAP = 2;/);
  assert.match(
    threadMenuBlock,
    /chatListRight == null \? menu\.x : chatListRight \+ THREAD_CONTEXT_MENU_LIST_GAP/,
  );
  assert.match(
    groupMenuBlock,
    /const compactMenu = isThreadGroupPickerMenuSource\(menu\.source\)/,
  );
  assert.match(
    groupMenuBlock,
    /const requestedLeft = compactMenu \|\| chatListRight == null[\s\S]*\? menu\.x[\s\S]*: chatListRight \+ THREAD_CONTEXT_MENU_LIST_GAP/,
  );
  assert.match(
    groupMenuBlock,
    /const left = Math\.min\(Math\.max\(8, requestedLeft\), window\.innerWidth - width - 8\)/,
  );
});

test("quick chat menu no longer has a conversation-list group import target", async () => {
  const source = await mainSource;
  const targetBlock = sourceBlock(
    source,
    "type ThreadGroupImportTarget =",
    "function threadGroupImportTargetFromButton",
  );
  const importBlock = sourceBlock(
    source,
    "async function importThreadGroupFolderPath",
    "function selectNewThreadGroupFolder",
  );

  assert.doesNotMatch(targetBlock, /"thread-group"/);
  assert.doesNotMatch(importBlock, /target === "thread-group"/);
  assert.doesNotMatch(source, /renderThreadGroupAddMenuItem\("thread-group"/);
  assert.match(targetBlock, /"new-thread"/);
  assert.match(targetBlock, /"auto-task"/);
  assert.match(targetBlock, /"set-dialog"/);
  assert.match(targetBlock, /"thread-menu"/);
});

test("restoring a selected group never creates or renders a blank task inside that group", async () => {
  const source = await mainSource;
  const createBlock = sourceBlock(
    source,
    "async function createBlankThreadForList",
    "function ensureTopLevelBlankThreadForList",
  );

  assert.match(
    createBlock,
    /state\.activeNewThreadGroupId = selectedGroupId/,
  );
  assert.match(
    createBlock,
    /threadGroupByThreadId\[threadId\] = DEFAULT_THREAD_GROUP_ID/,
  );
  assert.doesNotMatch(createBlock, /ensureLocalGroupBlankThread/);

  const currentBlankBlock = sourceBlock(
    source,
    "function currentBlankThread",
    "function discardVolatileBlankThread",
  );
  assert.match(
    currentBlankBlock,
    /threadGroupByThreadId\[threadId\] = DEFAULT_THREAD_GROUP_ID/,
  );
  assert.doesNotMatch(currentBlankBlock, /groupBlankThreadIds\.add/);

  const groupingBlock = sourceBlock(
    source,
    "function groupedThreadsForList",
    "function conversationListThreadGroups",
  );
  const blankBranch = sourceBlock(
    groupingBlock,
    "if (isBlankNewThread(thread.id))",
    "if (isTopLevelConversationThread(thread))",
  );
  assert.match(blankBranch, /ungrouped\.push\(thread\)/);
  assert.doesNotMatch(blankBranch, /itemByGroupId|defaultThreads/);
});

test("the last composer group selection remains the default until the user changes it", async () => {
  const source = await mainSource;
  const replacementBlankBlock = sourceBlock(
    source,
    "function upsertItem",
    "function removeMatchingLocalUserItem",
  );
  assert.match(
    replacementBlankBlock,
    /createBlankThreadForList\(\{ allowDuringCodexWork: true \}\)/,
  );
  assert.doesNotMatch(
    replacementBlankBlock,
    /createBlankThreadForList\(\{[^}]*groupId:\s*DEFAULT_THREAD_GROUP_ID/,
  );

  const ensureBlankBlock = sourceBlock(
    source,
    "function ensureTopLevelBlankThreadForList",
    "function groupBlankThreadForGroup",
  );
  assert.doesNotMatch(
    ensureBlankBlock,
    /state\.activeNewThreadGroupId\s*=\s*DEFAULT_THREAD_GROUP_ID/,
  );

  const resetWorkspaceBlock = sourceBlock(
    source,
    "function resetAuthenticatedWorkspace",
    "function revokeAttachmentPreviews",
  );
  assert.doesNotMatch(
    resetWorkspaceBlock,
    /state\.activeNewThreadGroupId\s*=\s*DEFAULT_THREAD_GROUP_ID/,
  );

  const discardBlock = sourceBlock(
    source,
    "function activateTopLevelBlankThreadAfterDiscard",
    "function normalizeExternalFolderPath",
  );
  assert.doesNotMatch(
    discardBlock,
    /state\.activeNewThreadGroupId\s*=\s*DEFAULT_THREAD_GROUP_ID/,
  );

  const preferencesBlock = sourceBlock(
    source,
    "function loadThreadPreferences",
    "function emptyThreadPreferences",
  );
  assert.match(
    preferencesBlock,
    /typeof parsed\.newThreadGroupId === "string" && knownGroupIds\.has\(parsed\.newThreadGroupId\)/,
  );
  const savePreferencesBlock = sourceBlock(
    source,
    "function saveThreadPreferences",
    "async function refreshMembershipProfileAfterPayment",
  );
  assert.match(
    savePreferencesBlock,
    /newThreadGroupId:\s*knownGroupIds\.has\(state\.activeNewThreadGroupId\)\s*\?\s*state\.activeNewThreadGroupId/,
  );
});

test("new-task folder creation and import still target the active question-answer draft", async () => {
  const source = await mainSource;
  const createBlock = sourceBlock(
    source,
    "async function submitThreadGroupCreateFolderDialog",
    "async function importThreadGroupFolder",
  );
  const existingFolderBlock = sourceBlock(
    source,
    "async function importThreadGroupFolder",
    "async function importThreadGroupFolderPath",
  );
  const importBlock = sourceBlock(
    source,
    "async function importThreadGroupFolderPath",
    "function selectNewThreadGroupFolder",
  );

  assert.match(
    createBlock,
    /importThreadGroupFolderPath\(folderPath, folderName, target/,
  );
  assert.match(
    existingFolderBlock,
    /importThreadGroupFolderPath\(folderPath, folderName, target/,
  );
  assert.match(
    importBlock,
    /target === "new-thread"[\s\S]*selectNewThreadGroupFolder\(folderPath, displayName\)/,
  );
  assert.doesNotMatch(importBlock, /target === "thread-group"/);

  const pickerBlock = sourceBlock(
    source,
    "function renderNewThreadGroupPicker",
    "function renderNewThreadGroupPickerMenuContent",
  );
  assert.match(
    pickerBlock,
    /const selectedGroupId = groupIdForThreadContext\(threadId\)/,
  );

  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  assert.match(
    sendBlock,
    /const composerGroupIdForSend = isTradingExpertThreadId\(threadId\)[\s\S]*?: groupIdForThreadContext\(threadId\)/,
  );
  assert.match(
    sendBlock,
    /commitSelectedNewThreadGroupForSend\(threadId, composerGroupIdForSend\)/,
  );
});

test("sending a composer message expands its group and collapses every other group", async () => {
  const source = await mainSource;
  const revealBlock = sourceBlock(
    source,
    "function expandableThreadGroupId",
    "function commitSelectedNewThreadGroupForSend",
  );
  assert.match(
    revealBlock,
    /const explicitGroupId = threadGroupByThreadId\[threadId\]/,
  );
  assert.match(
    revealBlock,
    /if \(explicitGroupId\) return knownThreadGroupId\(explicitGroupId\)/,
  );
  assert.match(
    revealBlock,
    /!isTopLevelConversationThread\(thread\) && isDefaultAssignableThread\(thread\)/,
  );
  assert.match(revealBlock, /return DEFAULT_THREAD_GROUP_ID/);
  assert.match(
    revealBlock,
    /function revealThreadGroupForComposerSend[\s\S]*focusThreadGroupInConversationList\(expandableThreadGroupId\(threadId\)\)/,
  );

  const focusBlock = sourceBlock(
    source,
    "function collapseOtherThreadGroupsAfterCreate",
    "function upsertExternalThreadGroup",
  );
  assert.match(focusBlock, /collapsedThreadGroupIds\.clear\(\)/);
  assert.match(
    focusBlock,
    /if \(group\.id !== createdGroupId\) collapsedThreadGroupIds\.add\(group\.id\)/,
  );
  assert.match(focusBlock, /focusThreadGroupInConversationList/);

  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  const pendingSendIndex = sendBlock.indexOf("beginPendingComposerSend");
  const captureGroupIndex = sendBlock.indexOf(
    "const composerGroupIdForSend =",
  );
  const commitGroupIndex = sendBlock.indexOf(
    "commitSelectedNewThreadGroupForSend",
  );
  const revealIndex = sendBlock.indexOf(
    "if (revealThreadGroupForComposerSend(threadId))",
  );
  const firstRenderIndex = sendBlock.indexOf("render();", pendingSendIndex);
  assert.doesNotMatch(sendBlock, /sendingBlankNewThread/);
  assert.ok(
    captureGroupIndex >= 0 && captureGroupIndex < pendingSendIndex,
    "send should capture the group displayed by the composer before adding the user bubble",
  );
  assert.ok(
    pendingSendIndex >= 0,
    "send should register a pending user bubble before preparation",
  );
  assert.ok(
    commitGroupIndex > pendingSendIndex,
    "blank thread should become non-empty before its real group mapping is committed",
  );
  assert.ok(
    firstRenderIndex > commitGroupIndex,
    "selected group must bind before the optimistic bubble can render in history",
  );
  assert.ok(
    revealIndex > commitGroupIndex && firstRenderIndex > revealIndex,
    "selected group should focus after binding and before the local user bubble render",
  );
  assert.match(
    sendBlock,
    /pendingSend = beginPendingComposerSend[\s\S]*commitSelectedNewThreadGroupForSend\(threadId, composerGroupIdForSend\);[\s\S]*if \(revealThreadGroupForComposerSend\(threadId\)\) saveThreadPreferences\(\);[\s\S]*render\(\);/,
  );
  assert.match(
    sendBlock,
    /if \(revealThreadGroupForComposerSend\(threadId\)\) \{\s*saveThreadPreferences\(\);\s*\}/s,
  );

  const supplementBlock = sourceBlock(
    source,
    "async function sendConversationSupplementFromComposer",
    "async function steerConversationSupplement",
  );
  assert.match(
    supplementBlock,
    /upsertItem\([\s\S]*beginConversationSupplementItem[\s\S]*if \(revealThreadGroupForComposerSend\(threadId\)\) saveThreadPreferences\(\);/,
  );
});

test("auto task added folder is only committed when the task form is submitted", async () => {
  const source = await mainSource;
  const importBlock = sourceBlock(
    source,
    "async function importThreadGroupFolderPath",
    "function selectNewThreadGroupFolder",
  );
  assert.match(
    importBlock,
    /if \(target === "auto-task"\) \{[\s\S]*selectAutoTaskThreadGroupFolder\(folderPath, displayName\);[\s\S]*return;/,
  );

  const selectBlock = sourceBlock(
    source,
    "function selectAutoTaskThreadGroupFolder",
    "function expandableThreadGroupId",
  );
  assert.match(selectBlock, /importFolderPath: folderPath/);
  assert.match(
    selectBlock,
    /importFolderName: folderName \|\| folderNameFromPath\(folderPath\)/,
  );
  assert.doesNotMatch(selectBlock, /upsertExternalThreadGroup/);
  assert.doesNotMatch(selectBlock, /ensureBlankThreadForGroup/);
  assert.doesNotMatch(selectBlock, /threadGroupByThreadId/);

  const submitBlock = sourceBlock(
    source,
    "async function submitAutoTaskForm",
    "function startChatPreviewResize",
  );
  assert.match(
    submitBlock,
    /const importedGroup = importedFolderPath[\s\S]*upsertExternalThreadGroup/,
  );
  assert.doesNotMatch(
    submitBlock,
    /state\.activeNewThreadGroupId = importedGroup\.id/,
  );
  assert.doesNotMatch(submitBlock, /ensureBlankThreadForGroup/);
  assert.doesNotMatch(submitBlock, /createBlankThreadForList/);
  assert.match(
    submitBlock,
    /const savedThreadId = ensureAutoTaskThreadId\(savedTask\)/,
  );
  assert.match(submitBlock, /syncAutoTaskThreadSummaries\(\)/);

  const pickerBlock = sourceBlock(
    source,
    "function renderAutoTaskGroupPicker",
    "function renderAutoTaskFrequencyPanel",
  );
  assert.match(
    pickerBlock,
    /const pendingFolderPath = firstString\(draft\.importFolderPath\)/,
  );
  assert.match(
    pickerBlock,
    /const selectedGroupId = pendingFolderPath \? null : knownThreadGroupId\(draft\.groupId\)/,
  );
});

test("auto task pickers close when the rest of the dialog is clicked in either theme", async () => {
  const source = await mainSource;
  const dismissBlock = sourceBlock(
    source,
    "function dismissAutoTaskPicker",
    "function bindAutoTaskPickerEvents",
  );
  const outsideClickBlock = sourceBlock(
    source,
    'root.querySelector<HTMLDialogElement>(".auto-task-dialog")',
    'root.querySelectorAll<HTMLButtonElement>("[data-auto-task-picker]")',
  );

  assert.match(outsideClickBlock, /dismissAutoTaskPicker\(target\)/);
  assert.doesNotMatch(outsideClickBlock, /render\(\)/);
  assert.match(dismissBlock, /const activePicker = state\.autoTaskPicker/);
  assert.match(dismissBlock, /if \(!activePicker\) return false/);
  assert.match(dismissBlock, /data-auto-task-picker=.*activePicker/);
  assert.match(dismissBlock, /activePicker === "group"/);
  assert.match(
    dismissBlock,
    /trigger\?\.closest<HTMLElement>\("\.auto-task-group-picker"\)/,
  );
  assert.match(
    dismissBlock,
    /trigger\?\.closest<HTMLElement>\("\.auto-task-picker-wrap"\)/,
  );
  assert.match(dismissBlock, /pickerSurface\?\.contains\(target\)/);
  assert.match(dismissBlock, /state\.autoTaskPicker = null/);
  assert.match(dismissBlock, /pickerSurface\?\.classList\.remove\("open"\)/);
  assert.match(
    dismissBlock,
    /pickerSurface\?\.querySelector<HTMLElement>\("\.auto-task-popover"\)\?\.remove\(\)/,
  );
  assert.match(dismissBlock, /trigger\?\.classList\.remove\("active"\)/);
  assert.match(dismissBlock, /setAttribute\("aria-expanded", "false"\)/);
  assert.doesNotMatch(dismissBlock, /render\(\)/);
  assert.doesNotMatch(dismissBlock, /state\.settings\.theme|data-theme/);
});

test("the auto task schedule heading cannot implicitly activate the frequency picker", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const dialogBlock = sourceBlock(
    source,
    "function renderAutoTaskDialog",
    "function renderAutoTaskGroupPicker",
  );

  assert.match(
    dialogBlock,
    /<div class="auto-task-field" role="group" aria-labelledby="autoTaskScheduleLabel">\s*<span id="autoTaskScheduleLabel">执行时间/,
  );
  assert.match(
    dialogBlock,
    /<label>\s*<span>任务说明<em>\*<\/em><\/span>\s*<div class="auto-task-input-wrap textarea-wrap">\s*<textarea id="autoTaskDescription"/,
  );
  assert.doesNotMatch(dialogBlock, /<label>\s*<span>执行时间/);
  assert.match(
    styles,
    /\.auto-task-dialog label,\s*\.auto-task-dialog \.auto-task-field\s*\{/,
  );
  assert.match(
    styles,
    /\.auto-task-dialog label em,\s*\.auto-task-dialog \.auto-task-field em\s*\{/,
  );
});

test("clicking another auto task picker responds immediately", async () => {
  const source = await mainSource;
  const triggerClickBlock = sourceBlock(
    source,
    'root.querySelectorAll<HTMLButtonElement>("[data-auto-task-picker]")',
    'root.querySelectorAll<HTMLButtonElement>("[data-auto-task-frequency]")',
  );

  assert.match(triggerClickBlock, /event\.stopPropagation\(\)/);
  assert.match(
    triggerClickBlock,
    /const picker = button\.dataset\.autoTaskPicker as AutoTaskPickerState/,
  );
  assert.doesNotMatch(
    triggerClickBlock,
    /state\.autoTaskPicker && state\.autoTaskPicker !== picker/,
  );
  assert.doesNotMatch(triggerClickBlock, /dismissAutoTaskPicker\(\)/);
  assert.match(
    triggerClickBlock,
    /state\.autoTaskPicker = state\.autoTaskPicker === picker \? null : picker/,
  );
  assert.match(triggerClickBlock, /render\(\)/);
});

test("only the top-level new task composer renders the group picker", async () => {
  const source = await mainSource;
  const composerBlock = sourceBlock(
    source,
    "function renderComposer(thread: ConversationSummary)",
    "function renderVideoExpertComposer",
  );

  assert.match(composerBlock, /shouldRenderComposerGroupPicker/);
  assert.match(
    composerBlock,
    /groupBlank:\s*groupBlankThreadIds\.has\(thread\.id\)/,
  );
  assert.match(
    composerBlock,
    /const groupPicker = showEditableGroupPicker\s*\? renderNewThreadGroupPicker\(thread\.id\)\s*:\s*"";/,
  );
  assert.match(
    composerBlock,
    /\$\{groupPicker\}\s*\n\s*\$\{renderWorkflowComposerInputSlots\(thread\.id,\s*workflowInputContract\)\}\s*\n\s*\$\{renderPendingAttachmentsRail\(\s*thread\.id,\s*`\$\{renderWorkflowComposerUploadGuideSlots\(thread\.id, workflowInputContract\)\}\$\{renderMediaInputGuideSlots\(thread\.id\)\}`,\s*\)\}/,
  );
  assert.doesNotMatch(
    composerBlock,
    /<div class="composer-tools">[\s\S]*\$\{groupPicker\}[\s\S]*<\/div>/,
  );
  assert.doesNotMatch(composerBlock, /renderReadonlyThreadGroupPill/);
  assert.doesNotMatch(
    composerBlock,
    /isMultiModelClusterThread\(thread\.id\)[\s\S]*renderNewThreadGroupPicker/,
  );
});

test("thread rows reserve the blank background class for top-level blank tasks", async () => {
  const source = await mainSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(rowBlock, /isTopLevelBlankTaskPlaceholder/);
  assert.match(
    rowBlock,
    /groupBlankNewThread\s*=\s*groupBlankThreadIds\.has\(thread\.id\)/,
  );
  assert.match(
    rowBlock,
    /\$\{topLevelBlankNewThread \? "blank-new-thread" : ""\}/,
  );
  assert.doesNotMatch(
    rowBlock,
    /\$\{blankNewThread \? "blank-new-thread" : ""\}/,
  );
});

test("conversation group sections are ordered through group sorting instead of forcing history first", async () => {
  const source = await mainSource;
  const sectionBlock = sourceBlock(
    source,
    "function renderThreadSections(threads: ConversationSummary[], emptyText: string)",
    "function isTopLevelConversationThread",
  );

  assert.match(sectionBlock, /conversationGroupSectionsForList/);
  assert.doesNotMatch(
    sectionBlock,
    /grouped\.defaultThreads\.length \? renderThreadGroupSection\(defaultGroup, grouped\.defaultThreads, \{ history: true \}\) : "",\s*\.\.\.grouped\.groups\.map/s,
  );

  const orderingBlock = sourceBlock(
    source,
    "function conversationGroupSectionsForList",
    "function isTopLevelConversationThread",
  );

  assert.match(orderingBlock, /sortedThreadGroups\(\)/);
  assert.match(orderingBlock, /history:\s*true/);
});

test("all provider tasks enter groups and provider drafts stay out of the conversation list", async () => {
  const source = await mainSource;
  const topLevelBlock = sourceBlock(
    source,
    "function isTopLevelConversationThread",
    "function compareTopLevelConversationThreads",
  );
  assert.doesNotMatch(topLevelBlock, /isVideoExpertThread\(thread\)/);
  assert.doesNotMatch(topLevelBlock, /isProviderThread\(thread\)/);

  const rankBlock = sourceBlock(
    source,
    "function topLevelConversationThreadRank",
    "function renderThreadSection",
  );
  assert.match(rankBlock, /externalChannelConnectionThreadRank\(thread\)/);
  assert.doesNotMatch(rankBlock, /isVideoExpertThread\(thread\)/);

  const groupingBlock = sourceBlock(
    source,
    "function groupedThreadsForList",
    "function conversationListThreadGroups",
  );
  assert.match(groupingBlock, /isTopLevelConversationThread\(thread\)/);

  const visibleBlock = sourceBlock(
    source,
    "function visibleConversationThreadsForChatList",
    "function renderThreadGroupSetDialog",
  );
  assert.match(visibleBlock, /!providerDraftThreadIds\.has\(thread\.id\)/);
});

test("provider question drafts use the new-task picker and hide it after send", async () => {
  const source = await mainSource;
  const composerBlock = sourceBlock(
    source,
    "function renderComposer(thread: ConversationSummary)",
    "function renderVideoExpertComposer",
  );
  assert.match(
    composerBlock,
    /shouldRenderComposerGroupPicker\([\s\S]*blank: blankNewThread/,
  );
  assert.doesNotMatch(composerBlock, /\|\| isProviderThread\(thread\)/);
  assert.match(composerBlock, /renderNewThreadGroupPicker\(thread\.id\)/);
  assert.doesNotMatch(
    composerBlock,
    /renderReadonlyThreadGroupPill\(thread\.id\)/,
  );

  const selectionBlock = sourceBlock(
    source,
    "function selectComposerThreadGroup",
    "function selectActiveNewThreadGroup",
  );
  assert.match(selectionBlock, /providerFromThreadId\(id\)/);
  assert.match(
    selectionBlock,
    /providerDraftThreadIds\.has\(id\)[\s\S]*state\.activeNewThreadGroupId = group\.id/,
  );
  assert.match(selectionBlock, /threadGroupByThreadId\[id\] = group\.id/);
  assert.match(
    selectionBlock,
    /rememberThreadWorkspace\(id, workspaceForGroupId\(group\.id\)\)/,
  );
});

test("video-generation drafts reuse the new-task group picker above the composer", async () => {
  const source = await mainSource;
  const composerBlock = sourceBlock(
    source,
    "function renderVideoExpertComposer",
    "function renderVideoExpertAspectRatioPicker",
  );

  assert.match(
    composerBlock,
    /shouldRenderComposerGroupPicker\([\s\S]*blank:\s*isBlankNewThread\(thread\.id\)/,
  );
  assert.match(
    composerBlock,
    /groupBlank:\s*groupBlankThreadIds\.has\(thread\.id\)/,
  );
  assert.match(
    composerBlock,
    /const groupPicker = showEditableGroupPicker\s*\? renderNewThreadGroupPicker\(thread\.id\)\s*:\s*"";/,
  );
  assert.match(
    composerBlock,
    /\$\{groupPicker\}\s*\n\s*\$\{renderPendingAttachmentsRail\(thread\.id,\s*renderMediaInputGuideSlots\(thread\.id\)\)\}/,
  );
  assert.doesNotMatch(
    composerBlock,
    /<div class="composer-tools video-expert-tools">[\s\S]*\$\{groupPicker\}[\s\S]*<\/div>/,
  );
});

test("adjacent conversation rows have a uniform 3px top gap", async () => {
  const source = await stylesSource;

  assert.match(
    source,
    /\.conversation-section > \.conversation-row-wrap \+ \.conversation-row-wrap\s*\{\s*margin-top: 3px;\s*\}/s,
  );
  assert.match(
    source,
    /\.conversation-row-wrap\.wechat-channel-row-wrap\s*\{\s*margin-top: 3px;\s*\}/s,
  );
});

test("agent and contact rows have a uniform 3px gap", async () => {
  const source = await stylesSource;

  assert.match(
    source,
    /\.contacts-group-items\s*\{\s*display: flex;\s*flex-direction: column;\s*gap: 3px;\s*\}/s,
  );
});

test("only the video expert row keeps empty preview height for time alignment", async () => {
  const source = await mainSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(
    rowBlock,
    /const videoExpertThread = isVideoExpertThread\(thread\)/,
  );
  assert.match(
    rowBlock,
    /\$\{videoExpertThread \? "video-expert-row-wrap" : ""\}/,
  );
  assert.doesNotMatch(rowBlock, /hasThreadMenu/);

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.conversation-row-wrap\.video-expert-row-wrap \.row-preview:empty\s*\{\s*min-height: 16px;\s*\}/s,
  );
  assert.doesNotMatch(styles, /\.conversation-row-wrap\.has-thread-menu/);
});

test("top-level new task placeholder is repaired after thread loading", async () => {
  const source = await mainSource;
  const loadThreadsBlock = sourceBlock(
    source,
    "async function loadThreads()",
    "function ensureInitialBlankChatThread",
  );
  assert.match(
    loadThreadsBlock,
    /ensureTopLevelBlankThreadForList\(\{\s*activateIfMissingSelection:\s*true\s*\}\)/,
  );

  const ensureBlock = sourceBlock(
    source,
    "function ensureTopLevelBlankThreadForList",
    "function groupBlankThreadForGroup",
  );
  assert.match(ensureBlock, /hiddenThreadIds\.delete\(threadId\)/);
  assert.match(ensureBlock, /groupBlankThreadIds\.delete\(threadId\)/);
  assert.match(
    ensureBlock,
    /threadGroupByThreadId\[threadId\]\s*=\s*DEFAULT_THREAD_GROUP_ID/,
  );
  assert.match(
    ensureBlock,
    /state\.threads\s*=\s*\[summary,\s*\.\.\.state\.threads\.filter/,
  );
  assert.match(ensureBlock, /activateIfMissingSelection/);
  assert.match(ensureBlock, /state\.currentThreadId\s*=\s*threadId/);
});

test("left panel collapse control stays on chat pages except the blank new canvas", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(
    source,
    "function render()",
    "const renderedThreadId =",
  );
  assert.match(
    renderBlock,
    /const isChatLeftCollapsed =\s*state\.activeView === "chat" && state\.leftCollapsed/,
  );
  assert.match(
    renderBlock,
    /isChatLeftCollapsed \? "left-panel-collapsed" : ""/,
  );
  assert.match(
    renderBlock,
    /state\.activeView === "chat" && !isBlankWorkflowCanvasThread\(thread\?\.id\) \? renderLeftPanelToggle\(\) : ""/,
  );
  assert.match(renderBlock, /renderAppSidebar\(\)/);
  assert.match(renderBlock, /renderChatList\(\)/);

  const toggleBlock = sourceBlock(
    source,
    "function renderLeftPanelToggle",
    "function renderMaximizeIcon",
  );
  assert.match(toggleBlock, /data-action="toggle-left-panel"/);
  assert.match(toggleBlock, /renderPanelLayoutIcon\("left"\)/);
  assert.match(
    toggleBlock,
    /class="panel-layout-icon panel-layout-icon-\$\{side\}"/,
  );
  assert.match(toggleBlock, /side === "left" \? 9 : 15/);
  assert.match(toggleBlock, /viewBox="0 0 24 16"/);
  assert.match(toggleBlock, /preserveAspectRatio="none"/);
  assert.match(toggleBlock, /width="18" height="12"/);
  assert.match(toggleBlock, /aria-expanded/);
  assert.match(toggleBlock, /function syncLeftPanelToggleState/);
  assert.match(
    toggleBlock,
    /button\?\.setAttribute\("aria-expanded", collapsed \? "false" : "true"\)/,
  );
  assert.match(toggleBlock, /function toggleLeftPanelCollapsed/);
  assert.match(toggleBlock, /if \(state\.activeView !== "chat"\) return/);

  const eventBlock = sourceBlock(
    source,
    "root.querySelector<HTMLButtonElement>('[data-action=\"toggle-left-panel\"]')",
    'root.querySelector<HTMLElement>(".skills-plaza-page")',
  );
  assert.match(eventBlock, /event\.stopPropagation\(\)/);
  assert.match(eventBlock, /toggleLeftPanelCollapsed\(\)/);

  const eventBindings = source.slice(source.indexOf("function bindEvents"));
  const rightToggleBlock = sourceBlock(
    eventBindings,
    "'[data-action=\"toggle-right-panel\"]'",
    "bindAgentPanelEvents(root)",
  );
  assert.doesNotMatch(rightToggleBlock, /state\.leftCollapsed = false/);
  assert.match(
    rightToggleBlock,
    /state\.rightCollapsed = !state\.rightCollapsed/,
  );

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.left-panel-toggle\s*\{[\s\S]*left: calc\(52px \+ 240px \+ 6px\);[\s\S]*transition: color 0\.18s ease, background-color 0\.18s ease, left 0\.24s ease;/,
  );
  assert.match(
    styles,
    /\.desktop-shell\.left-panel-collapsed \.left-panel-toggle/,
  );
  assert.match(
    styles,
    /\.panel-toggle:is\(\.left-panel-toggle, \[data-action="toggle-right-panel"\]\)\s*\{[\s\S]*color: var\(--text-placeholder\);/,
  );
  assert.match(
    styles,
    /\.panel-toggle\[data-action="toggle-right-panel"\]\s*\{[\s\S]*left: 5px;/,
  );
  assert.match(
    styles,
    /\.panel-toggle:is\(\.left-panel-toggle, \[data-action="toggle-right-panel"\]\)\[aria-expanded="true"\]\s*\{[\s\S]*color: var\(--text-tertiary\);/,
  );
  assert.match(
    styles,
    /\.panel-layout-icon\s*\{[\s\S]*width: 13\.5px;[\s\S]*height: 12px;[\s\S]*stroke: currentColor;[\s\S]*stroke-width: 1\.65;/,
  );
  assert.match(
    styles,
    /\.desktop-body > \.app-sidebar,\s*\.desktop-body > \.chat-list\s*\{[\s\S]*width 0\.24s ease,[\s\S]*max-width 0\.24s ease,[\s\S]*border-color 0\.24s ease;/,
  );
  assert.match(styles, /\.desktop-body\.left-panel-collapsed > \.app-sidebar/);
  assert.match(styles, /\.desktop-body\.left-panel-collapsed > \.chat-list/);
  assert.match(
    styles,
    /\.desktop-shell:not\(\.left-panel-collapsed\) \.desktop-body > \.chat-panel \.chat-header\s*\{[\s\S]*padding-left: 44px;/,
  );
  assert.match(styles, /\.chat-title-text\s*\{[\s\S]*left: -5px;/);
});

test("clicking a new task row collapses the expanded system dashboard", async () => {
  const source = await mainSource;
  const bindEventsBlock = source.slice(source.indexOf("function bindEvents"));
  const conversationRowsBlock = sourceBlock(
    bindEventsBlock,
    "const conversationRows =",
    'conversationRows?.addEventListener("pointerover"',
  );
  const blankThreadGuardIndex = conversationRowsBlock.indexOf(
    "if (isBlankNewThread(id))",
  );
  const collapseIndex = conversationRowsBlock.indexOf(
    "state.rightCollapsed = true",
  );
  const syncIndex = conversationRowsBlock.indexOf("syncAgentPanelState()");
  const selectIndex = conversationRowsBlock.indexOf("void selectThread(id)");

  assert.ok(
    blankThreadGuardIndex >= 0,
    "new task row should be identified before selection",
  );
  assert.ok(
    collapseIndex > blankThreadGuardIndex,
    "new task row should collapse the system dashboard",
  );
  assert.ok(
    syncIndex > collapseIndex,
    "the collapsed dashboard state should be applied immediately",
  );
  assert.ok(
    selectIndex > syncIndex,
    "the new task should be selected after the dashboard is collapsed",
  );
});

test("new task header hides its dashboard toggle while preserving a canvas title", async () => {
  const source = await mainSource;
  const headerBlock = sourceBlock(
    source,
    "function renderChatHeader",
    "function formatContextTokens",
  );

  assert.match(
    headerBlock,
    /const blankWorkflowCanvas = isBlankWorkflowCanvasThread\(thread\.id\)/,
  );
  assert.match(
    headerBlock,
    /const titleContent = isBlankNewThread\(thread\.id\) && !blankWorkflowCanvas\s*\?\s*""\s*:\s*`<span class="chat-title-text\$\{blankWorkflowCanvas \? " blank-workflow-canvas-title" : ""\}">/,
  );
  assert.match(
    headerBlock,
    /const showPanelToggle = !state\.contactChat\.open && !isBlankNewThread\(thread\.id\)/,
  );
  assert.match(
    headerBlock,
    /showPanelToggle[\s\S]*data-action="toggle-right-panel"/,
  );
  assert.match(headerBlock, /renderPanelLayoutIcon\("right"\)/);

  const rightToggleEvents = sourceBlock(
    source.slice(source.indexOf("function bindEvents")),
    "'[data-action=\"toggle-right-panel\"]'",
    "bindAgentPanelEvents(root)",
  );
  assert.match(
    rightToggleEvents,
    /state\.rightCollapsed = !state\.rightCollapsed/,
  );
});
