import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("quick menu opens the group chat picker instead of the removed group submenu", async () => {
  const source = await rendererSource;
  const chatList = sourceBlock(source, "function renderChatList", "function isHaoloContact");

  assert.match(chatList, /data-action="create-workflow-canvas"/);
  assert.match(chatList, /renderChatNewMenuIcon\("canvas"\)/);
  assert.match(chatList, /<strong>创建画布<\/strong>/);
  assert.match(chatList, /data-action="open-group-chat-dialog"/);
  assert.match(chatList, /<strong>发起群聊<\/strong>/);
  assert.match(chatList, /renderChatNewMenuIcon\("group-chat"\)/);
  assert.doesNotMatch(chatList, /renderThreadGroupAddMenuItem/);
  assert.doesNotMatch(source, /renderThreadGroupAddMenuItem\("thread-group"/);
  assert.doesNotMatch(source, /\|\s*"thread-group"\s*\n\s*\|/);
  assert.ok(
    chatList.indexOf('data-action="create-workflow-canvas"')
      < chatList.indexOf('data-action="open-group-chat-dialog"'),
    "创建画布 should be the first quick-menu option",
  );
});

test("quick menu represents group chat with layered conversation bubbles", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const iconRenderer = sourceBlock(source, "function renderChatNewMenuIcon", "function renderChatList");
  const groupChatIcon = sourceBlock(iconRenderer, 'icon === "group-chat"', ': icon === "auto-task"');

  assert.match(groupChatIcon, /chat-bubble-layer--back/);
  assert.match(groupChatIcon, /chat-bubble-layer--front/);
  assert.match(groupChatIcon, /chat-bubble-dot/);
  assert.doesNotMatch(groupChatIcon, /C3\.3 12\.9 4\.7 11\.6 7\.2 11\.6/);
  assert.match(iconRenderer, /viewBox="0 0 24 24"/);
  assert.match(
    styles,
    /\.chat-new-menu-icon\s*\{[\s\S]*width:\s*19px;[\s\S]*height:\s*19px;[\s\S]*stroke-width:\s*1\.7;/,
  );
  assert.match(
    styles,
    /\.chat-new-menu-icon \.chat-bubble-dot\s*\{[\s\S]*fill:\s*currentColor;[\s\S]*stroke:\s*none;/,
  );
});

test("quick menu interaction colors work in light and dark themes", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.chat-new-menu button:hover,\s*\.chat-new-menu button:focus-visible\s*\{[\s\S]*background:\s*var\(--surface-hover\);/,
  );
  assert.match(
    styles,
    /\.chat-new-menu button:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--brand-blue\);/,
  );
  assert.match(
    styles,
    /\.chat-new-menu button:active\s*\{[\s\S]*background:\s*var\(--surface-active-translucent\);/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\]\s*\{[\s\S]*--surface-hover:\s*#222428;[\s\S]*--surface-active-translucent:\s*rgba\(255,\s*255,\s*255,\s*0\.11\);/,
  );
});

test("group chat dialog includes Haolo first, filters unsupported profiles, and mirrors selections on the right", async () => {
  const source = await rendererSource;
  const dialog = sourceBlock(source, "function groupChatSelectableProfiles", "function contactSearchExecutedForCurrentQuery");

  assert.doesNotMatch(dialog, /!isHaoloContact\(contact\)\s*&&/);
  assert.match(dialog, /contact\.id !== VIDEO_EXPERT_CONTACT_ID/);
  assert.match(dialog, /\.\.\.profiles\.filter\(isHaoloContact\)/);
  assert.match(dialog, /\.\.\.profiles\.filter\(\(contact\) => !isHaoloContact\(contact\)\)/);
  assert.match(dialog, /contactMatchesQuery\(contact, query\)/);
  assert.match(dialog, /id="groupChatSearchInput"/);
  assert.match(dialog, /aria-multiselectable="true"/);
  assert.match(dialog, /renderGroupChatOptionSection\("agents", "智能体", agents\)/);
  assert.match(dialog, /renderGroupChatOptionSection\("models", "大模型", models\)/);
  assert.match(dialog, /renderGroupChatOptionSection\("contacts", "联系人", contacts\)/);
  assert.match(dialog, /已选择\$\{selectedMemberCount\}个成员/);
  assert.match(dialog, /data-group-chat-option=/);
  assert.match(dialog, /data-group-chat-quantity=/);
  assert.match(dialog, /data-remove-group-chat-option=/);
  assert.match(dialog, /group-chat-selected-quantity/);
  assert.match(dialog, /data-action="complete-group-chat-dialog"/);
  assert.match(dialog, /data-action="close-group-chat-dialog"/);
});

test("group chat choices stay in UI state while complete creates a local group conversation", async () => {
  const source = await rendererSource;
  const stateActions = sourceBlock(source, "function openGroupChatDialog", "function openChannelDialog");
  const bindings = sourceBlock(
    source.slice(source.indexOf("function bindEvents")),
    "'[data-action=\"open-group-chat-dialog\"]'",
    "'[data-action=\"toggle-new-thread-group-picker\"]'",
  );

  assert.match(source, /function emptyGroupChatDialogState\(\): GroupChatDialogState\s*\{[\s\S]*selectedIds:\s*\[\]/);
  assert.match(source, /function emptyGroupChatDialogState\(\): GroupChatDialogState\s*\{[\s\S]*quantities:\s*\{\s*\}/);
  assert.match(source, /function emptyGroupChatDialogState\(\): GroupChatDialogState\s*\{[\s\S]*collapsedSections:\s*\{\s*agents:\s*false,\s*models:\s*false,\s*contacts:\s*false\s*\}/);
  assert.match(stateActions, /selectedIds\.includes\(selectionId\)/);
  assert.match(stateActions, /\[\.\.\.selectedIds, selectionId\]/);
  assert.match(stateActions, /selectedIds\.filter\(\(id\) => id !== selectionId\)/);
  assert.match(bindings, /#groupChatSearchInput/);
  assert.match(bindings, /\[data-group-chat-section-toggle\]/);
  assert.match(bindings, /\[data-group-chat-option\]/);
  assert.match(bindings, /\[data-group-chat-quantity\]/);
  assert.match(bindings, /setGroupChatQuantity/);
  assert.match(bindings, /\[data-remove-group-chat-option\]/);
  assert.match(bindings, /close-group-chat-dialog/);
  assert.match(bindings, /complete-group-chat-dialog/);
  assert.match(bindings, /completeGroupChatDialog\(\)/);
  assert.match(stateActions, /function completeGroupChatDialog\(\)/);
  assert.match(stateActions, /const threadId = `local-group-chat:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(stateActions, /threadGroupByThreadId\[threadId\] = DEFAULT_THREAD_GROUP_ID/);
  assert.match(stateActions, /state\.rightCollapsed = false/);
  assert.doesNotMatch(bindings, /createChannel|sendProviderChat|startWorkflowRun/);
});

test("an existing local group reuses the picker to add only new members", async () => {
  const source = await rendererSource;
  const dialog = sourceBlock(
    source,
    "function groupChatSelectableProfiles",
    "function contactSearchExecutedForCurrentQuery",
  );
  const stateActions = sourceBlock(
    source,
    "function openGroupChatDialog",
    "function openChannelDialog",
  );
  const bindings = sourceBlock(
    source.slice(source.indexOf("function bindEvents")),
    "'[data-action=\"open-group-chat-dialog\"]'",
    "'[data-action=\"toggle-new-thread-group-picker\"]'",
  );

  assert.match(
    source,
    /type GroupChatDialogMode = "create" \| "add-members" \| "remove-members"/,
  );
  assert.match(
    dialog,
    /const dialogTitle = addingMembers[\s\S]*\? "添加群成员"[\s\S]*: removingMembers[\s\S]*\? "移出群成员"[\s\S]*: "发起群聊"/,
  );
  assert.match(dialog, /groupChatOptionAlreadyInGroup\(selectionId\)/);
  assert.match(dialog, /const disabled = existing \|\| unavailable/);
  assert.match(dialog, /aria-disabled="\$\{disabled \? "true" : "false"\}"/);
  assert.match(dialog, /\$\{disabled \? "disabled" : ""\}/);
  assert.match(dialog, /group-chat-existing-label">已在群聊/);
  assert.match(stateActions, /function openAddGroupMembersDialog\(threadId: string\)/);
  assert.match(stateActions, /mode: "add-members"/);
  assert.match(stateActions, /record\.members = \[\.\.\.record\.members, \.\.\.addedMembers\]/);
  assert.match(stateActions, /state\.members\[record\.id\] = record\.members\.map/);
  assert.match(stateActions, /appendLocalGroupChatMemberEvent\(record, member, "added"/);
  assert.match(bindings, /open-add-group-members-dialog/);
  assert.match(bindings, /openAddGroupMembersDialog\(threadId\)/);
});

test("remove-member mode lists current members and applies a persistent batch removal", async () => {
  const source = await rendererSource;
  const dialog = sourceBlock(
    source,
    "function groupChatSelectableProfiles",
    "function contactSearchExecutedForCurrentQuery",
  );
  const stateActions = sourceBlock(
    source,
    "function openGroupChatDialog",
    "function openChannelDialog",
  );
  const bindings = sourceBlock(
    source.slice(source.indexOf("function bindEvents")),
    "'[data-action=\"open-group-chat-dialog\"]'",
    "'[data-action=\"toggle-new-thread-group-picker\"]'",
  );

  assert.match(dialog, /state\.groupChatDialog\.mode !== "remove-members"/);
  assert.match(dialog, /localGroupChatUniqueMembers\(record\)\.map/);
  assert.match(dialog, /removingMembers\s*\?\s*"移出群成员"/);
  assert.match(dialog, /class="group-chat-remove"/);
  assert.match(dialog, />移出<\/button>/);
  assert.match(
    dialog,
    /state\.groupChatDialog\.mode !== "remove-members"[\s\S]*groupChatSupportsQuantity/,
  );
  assert.match(stateActions, /function openRemoveGroupMembersDialog\(threadId: string\)/);
  assert.match(stateActions, /mode: "remove-members"/);
  assert.match(stateActions, /const removedMembers = localGroupChatUniqueMembers\(record\)\.filter/);
  assert.match(stateActions, /record\.members = record\.members\.filter/);
  assert.match(stateActions, /appendLocalGroupChatMemberEvent\(record, member, "removed"/);
  assert.match(bindings, /open-remove-group-members-dialog/);
  assert.match(bindings, /openRemoveGroupMembersDialog\(threadId\)/);
});

test("standby agents are directly disabled when creating or adding group members", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const dialog = sourceBlock(
    source,
    "function groupChatSelectableProfiles",
    "function contactSearchExecutedForCurrentQuery",
  );
  const stateActions = sourceBlock(
    source,
    "function openGroupChatDialog",
    "function openChannelDialog",
  );

  assert.match(
    dialog,
    /function groupChatContactCannotJoin\(contact: ContactProfile\)[\s\S]*state\.groupChatDialog\.mode !== "remove-members"[\s\S]*contact\.kind === "agent"[\s\S]*contactStatusTone\(effectiveContactStatus\(contact\)\) === "standby"/,
  );
  assert.match(
    dialog,
    /groupChatSelectedProfiles\(\)[\s\S]*Boolean\(contact && !groupChatContactCannotJoin\(contact\)\)/,
  );
  assert.match(dialog, /const unavailable = groupChatContactCannotJoin\(contact\)/);
  assert.match(dialog, /const disabled = existing \|\| unavailable/);
  assert.match(dialog, /\$\{unavailable \? "unavailable" : ""\}/);
  assert.match(dialog, /aria-disabled="\$\{disabled \? "true" : "false"\}"/);
  assert.match(dialog, /\$\{disabled \? "disabled" : ""\}/);
  assert.match(
    stateActions,
    /function toggleGroupChatSelection[\s\S]*groupChatContactCannotJoin\(contact\)[\s\S]*return;/,
  );
  assert.match(
    stateActions,
    /function setGroupChatQuantity[\s\S]*groupChatContactCannotJoin\(contact\)/,
  );
  assert.doesNotMatch(dialog, /不可加入|不能加入|无法加入/);
  assert.match(
    styles,
    /\.group-chat-option\.unavailable,[\s\S]*\.group-chat-option\.unavailable:focus-within[\s\S]*background:\s*transparent;/,
  );
  assert.match(styles, /\.group-chat-option\.unavailable \.group-chat-option-select/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.group-chat-option\.unavailable,[\s\S]*html\[data-theme="dark"\] \.group-chat-option\.unavailable:focus-within[\s\S]*background:\s*transparent;/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.group-chat-option\.unavailable \.group-chat-check/,
  );
});

test("every group chat option supports quantities 1 through 10 and updates the selected-member total", async () => {
  const source = await rendererSource;
  const dialog = sourceBlock(source, "function groupChatSelectableProfiles", "function contactSearchExecutedForCurrentQuery");
  const stateActions = sourceBlock(source, "function openGroupChatDialog", "function openChannelDialog");

  assert.match(source, /const GROUP_CHAT_QUANTITY_MIN = 1;/);
  assert.match(source, /const GROUP_CHAT_QUANTITY_MAX = 10;/);
  assert.match(dialog, /function groupChatSupportsQuantity\(contact: ContactProfile\)\s*\{\s*return contact\.section === "agents" \|\| contact\.section === "models" \|\| contact\.section === "contacts";/);
  assert.match(dialog, /const supportsQuantity = groupChatSupportsQuantity\(contact\)/);
  assert.match(dialog, /Array\.from\(\{ length: GROUP_CHAT_QUANTITY_MAX \}/);
  assert.match(dialog, /<details class="group-chat-quantity">/);
  assert.match(dialog, /data-group-chat-quantity-toggle="\$\{escapeAttr\(selectionId\)\}"/);
  assert.match(dialog, /class="group-chat-quantity-menu" role="menu"/);
  assert.match(dialog, /data-group-chat-quantity-value="\$\{value\}"/);
  assert.match(dialog, /role="menuitemradio"/);
  assert.match(dialog, /aria-checked="\$\{value === quantity \? "true" : "false"\}"/);
  assert.doesNotMatch(dialog, /<span>数量<\/span>/);
  assert.doesNotMatch(dialog, /<select[\s\S]*data-group-chat-quantity=/);
  assert.match(dialog, /groupChatSelectedMemberCount\(selected\)/);
  assert.match(dialog, /groupChatQuantity\(contactStableId\(contact\)\)/);
  assert.match(dialog, /数量 \$\{groupChatQuantity\(selectionId\)\}/);
  assert.match(stateActions, /function setGroupChatQuantity\(selectionId: string, quantity: number\)/);
  assert.match(stateActions, /Math\.min\(\s*GROUP_CHAT_QUANTITY_MAX/);
  assert.match(stateActions, /Math\.max\(\s*GROUP_CHAT_QUANTITY_MIN/);
  assert.match(stateActions, /if \(!state\.groupChatDialog\.selectedIds\.includes\(selectionId\)\)/);
  assert.match(stateActions, /state\.groupChatDialog\.quantities = \{/);
});

test("selecting a member preserves both group chat list scroll positions", async () => {
  const source = await rendererSource;
  const stateActions = sourceBlock(source, "function openGroupChatDialog", "function openChannelDialog");
  const selectionStart = stateActions.indexOf("function toggleGroupChatSelection");
  assert.notEqual(selectionStart, -1);
  const selectionAction = stateActions.slice(selectionStart);

  assert.match(stateActions, /function captureGroupChatDialogScroll\(\)/);
  assert.match(stateActions, /querySelector<HTMLElement>\("\.group-chat-options"\)\?\.scrollTop/);
  assert.match(stateActions, /querySelector<HTMLElement>\("\.group-chat-selected-list"\)\?\.scrollTop/);
  assert.match(stateActions, /function restoreGroupChatDialogScroll/);
  assert.match(stateActions, /Math\.max\(0, options\.scrollHeight - options\.clientHeight\)/);
  assert.match(stateActions, /Math\.max\(0, selected\.scrollHeight - selected\.clientHeight\)/);
  assert.match(stateActions, /window\.requestAnimationFrame\(restore\)/);
  assert.match(selectionAction, /const scrollSnapshot = captureGroupChatDialogScroll\(\)/);
  assert.match(selectionAction, /render\(\);\s*restoreGroupChatDialogScroll\(scrollSnapshot\)/);
});

test("agent, model, and contact sections expose independent accessible collapse controls", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const dialog = sourceBlock(source, "function groupChatSelectableProfiles", "function contactSearchExecutedForCurrentQuery");
  const stateActions = sourceBlock(source, "function openGroupChatDialog", "function openChannelDialog");

  assert.match(dialog, /data-group-chat-section-toggle="\$\{section\}"/);
  assert.match(dialog, /aria-expanded="\$\{collapsed \? "false" : "true"\}"/);
  assert.match(dialog, /class="group-chat-option-rows" \$\{collapsed \? "hidden" : ""\}/);
  assert.match(stateActions, /function toggleGroupChatSection\(section: string\)/);
  assert.match(stateActions, /section !== "agents" && section !== "models" && section !== "contacts"/);
  assert.match(stateActions, /\[section\]: !state\.groupChatDialog\.collapsedSections\[section\]/);
  assert.match(styles, /\.group-chat-option-rows\[hidden\]\s*\{\s*display:\s*none/);
});

test("group chat dialog covers light and dark interaction states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.group-chat-dialog\[open\]\s*\{[\s\S]*grid-template-columns:/);
  assert.match(styles, /\.group-chat-option:hover,[\s\S]*\.group-chat-option:focus-within/);
  assert.match(styles, /\.group-chat-option:hover,[\s\S]*background:\s*#e9e9ec/);
  assert.match(styles, /\.group-chat-option:active\s*\{[\s\S]*background:\s*#e3e3e6/);
  assert.match(styles, /\.group-chat-option\.selected,[\s\S]*background:\s*transparent/);
  assert.match(styles, /\.group-chat-option\.selected:hover\s*\{[\s\S]*background:\s*#e9e9ec/);
  assert.match(styles, /\.group-chat-option:focus-within\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(styles, /\.group-chat-search:focus-within/);
  assert.match(styles, /\.group-chat-quantity > summary:hover/);
  assert.match(styles, /\.group-chat-quantity\[open\] > summary/);
  assert.match(styles, /\.group-chat-quantity > summary:focus-visible/);
  assert.match(styles, /\.group-chat-quantity-menu button:hover,[\s\S]*\.group-chat-quantity-menu button:focus-visible/);
  assert.match(styles, /\.group-chat-quantity-menu button:active/);
  assert.match(styles, /\.group-chat-quantity-menu button\[aria-checked="true"\]/);
  assert.match(styles, /\.group-chat-quantity-menu button:disabled/);
  assert.match(styles, /\.group-chat-selection > footer button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\]/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option:hover,[\s\S]*background:\s*#23262c/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option:active\s*\{[\s\S]*background:\s*#292d34/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option\.selected,[\s\S]*background:\s*transparent/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option\.selected:hover\s*\{[\s\S]*background:\s*#23262c/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-search:focus-within/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity > summary:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity\[open\] > summary/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity-menu/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity-menu button:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity-menu button\[aria-checked="true"\]/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-quantity-menu button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-selected-quantity/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\] \.group-chat-complete:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\] \.group-chat-selection > footer button:disabled/);
  assert.match(styles, /\.group-chat-option\.existing:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option\.existing:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option-copy small\.group-chat-existing-label/);
  assert.match(styles, /\.group-chat-option\.unavailable:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option\.unavailable:hover/);
  assert.match(styles, /\.group-chat-remove:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\] \.group-chat-remove:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\] \.group-chat-remove:hover:not\(:disabled\)/);
});

test("group chat selection actions use the unified black rounded style", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const selectedRow = sourceBlock(source, "function renderGroupChatSelectedRow", "function contactSearchExecutedForCurrentQuery");

  assert.match(styles, /\.group-chat-option\.selected \.group-chat-check\s*\{[\s\S]*background:\s*#111315/);
  assert.match(styles, /\.group-chat-selection > footer button\s*\{[\s\S]*border-radius:\s*999px/);
  assert.match(styles, /\.group-chat-complete\s*\{[\s\S]*background:\s*#111315/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-option\.selected \.group-chat-check\s*\{[\s\S]*background:\s*#050607/);
  assert.match(styles, /html\[data-theme="dark"\] \.group-chat-dialog\[open\] \.group-chat-complete:not\(:disabled\)\s*\{[\s\S]*background:\s*#050607/);
  assert.match(selectedRow, /<svg viewBox="0 0 16 16" aria-hidden="true">/);
  assert.match(selectedRow, /<path d="M4 4l8 8m0-8-8 8" \/>/);
  assert.match(
    styles,
    /\.group-chat-selected-row > button\s*\{[\s\S]*place-items:\s*center;[\s\S]*padding:\s*0;[\s\S]*line-height:\s*0;/,
  );
  assert.match(
    styles,
    /\.group-chat-selected-row > button svg\s*\{[\s\S]*width:\s*10px;[\s\S]*height:\s*10px;[\s\S]*stroke:\s*currentColor;/,
  );
});

test("group chat dialog keeps compact, balanced visual proportions", async () => {
  const styles = await stylesSource;
  const lightTheme = sourceBlock(
    styles,
    "/* Group chat member picker mirrors the two-column contact selection dialog. */",
    'html[data-theme="dark"] .group-chat-backdrop',
  );

  assert.match(lightTheme, /width:\s*min\(780px,/);
  assert.match(lightTheme, /height:\s*min\(580px,/);
  assert.match(lightTheme, /\.group-chat-search\s*\{[\s\S]*height:\s*34px/);
  assert.match(lightTheme, /\.group-chat-option\s*\{[\s\S]*min-height:\s*54px/);
  assert.match(lightTheme, /\.group-chat-option-select\s*\{[\s\S]*grid-template-columns:\s*18px 34px minmax\(0, 1fr\)/);
  assert.match(lightTheme, /\.group-chat-option\.has-quantity\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(lightTheme, /\.group-chat-quantity\s*\{[\s\S]*height:\s*24px;[\s\S]*min-width:\s*52px/);
  assert.match(lightTheme, /\.group-chat-quantity > summary\s*\{[\s\S]*height:\s*24px;[\s\S]*border-radius:\s*8px;[\s\S]*background:\s*#f1f2f4/);
  assert.match(lightTheme, /\.group-chat-quantity > summary > strong\s*\{[\s\S]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\)/);
  assert.match(lightTheme, /\.group-chat-quantity-menu\s*\{[\s\S]*width:\s*58px;[\s\S]*border-radius:\s*10px;[\s\S]*background:\s*#f7f7f8/);
  assert.match(lightTheme, /\.group-chat-quantity-menu button\s*\{[\s\S]*height:\s*22px;[\s\S]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\)/);
  assert.match(lightTheme, /\.group-chat-selected-row\.has-quantity\s*\{[\s\S]*grid-template-columns:\s*34px minmax\(0, 1fr\) auto 18px/);
  assert.match(lightTheme, /\.group-chat-option \.contact-avatar\.small,[\s\S]*width:\s*34px/);
  assert.match(lightTheme, /\.group-chat-selection > footer button\s*\{[\s\S]*width:\s*120px;[\s\S]*height:\s*36px/);
});
