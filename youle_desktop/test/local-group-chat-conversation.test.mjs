import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const domainSource = readFile(new URL("../src/renderer/domain.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("stored group conversations remain supported without a new-group creation path", async () => {
  const source = await rendererSource;
  const sorting = sourceBlock(source, "function sortThreadsForList", "function comparePinnedThreadContinuationOrder");

  assert.match(await domainSource, /thread_kind\?:[^;]*"group_chat"/);
  assert.doesNotMatch(source, /local-group-chat:\$\{crypto\.randomUUID|function openGroupChatDialog/);
  assert.doesNotMatch(source, /type GroupChatDialogMode[^;]*"create"/);
  assert.match(
    sorting,
    /const pinnedDelta = Number\(Boolean\(b\.pinned\)\) - Number\(Boolean\(a\.pinned\)\);[\s\S]*const timeDelta = threadSortTime\(b\) - threadSortTime\(a\)/,
  );
});

test("quantities expand the information-panel members while avatars and join notices stay deduplicated", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function completeGroupChatDialog", "function toggleGroupChatSection");
  const localRendering = sourceBlock(source, "function renderLocalGroupChatJoinNotice", "function renderChatPanel");
  const avatarRendering = sourceBlock(source, "function renderLocalGroupChatThreadAvatar", "function renderThreadAvatar");

  assert.match(actions, /selected\.flatMap\(\(contact\) =>/);
  assert.match(actions, /\{ length: groupChatQuantity\(contactStableId\(contact\)\) \}/);
  assert.match(actions, /const uniqueMembers = selected\.map\(localGroupChatMemberFromProfile\)/);
  assert.match(source, /function localGroupChatUniqueMembers\([\s\S]*seen\.has\(member\.selectionId\)/);
  assert.match(avatarRendering, /localGroupChatUniqueMembers\(record\)\.slice\(0, 9\)/);
  assert.match(localRendering, /const members = localGroupChatUniqueMembers\(record\)/);
  assert.match(localRendering, /const visibleMembers = normalizedQuery[\s\S]*record\.members\.filter/);
  assert.match(localRendering, /record\.members\.forEach\(\(member\) =>/);
  assert.match(localRendering, /duplicateCount > 1/);
  assert.match(localRendering, /class="local-group-chat-member-grid" role="list"/);
});

test("local groups render the join notice, message bubbles, and expanded details panel", async () => {
  const source = await rendererSource;
  const chatPanel = sourceBlock(source, "function renderLocalGroupChatPanel", "function renderLocalGroupChatMemberCell");
  const header = sourceBlock(source, "function renderChatHeader", "function formatContextTokens");
  const selection = sourceBlock(source, "function activateLocalGroupChatThread", "async function selectThread");
  const panel = sourceBlock(source, "function renderLocalGroupChatMembersPanel", "function renderChatPanel");

  assert.match(chatPanel, /class="message-scroller local-group-chat-scroller"/);
  assert.match(chatPanel, /renderLocalGroupChatJoinNotice\(record\)/);
  assert.match(chatPanel, /messages\.map\(\(message\) => renderMessage\(message, messages\)\)/);
  assert.match(header, /class="small-icon-button panel-toggle/);
  assert.match(header, /data-action="toggle-right-panel"/);
  assert.match(header, /renderPanelLayoutIcon\("right"\)/);
  assert.match(header, /收起右侧区域/);
  assert.doesNotMatch(header, /<span><\/span><span><\/span><span><\/span>/);
  assert.doesNotMatch(header, /local-group-chat-more/);
  assert.match(selection, /state\.rightCollapsed = !record\.panelExpanded/);
  assert.match(panel, /placeholder="搜索群成员"/);
  assert.doesNotMatch(panel, /class="local-group-chat-members-heading"/);
  assert.doesNotMatch(panel, /<h2[^>]*>群聊成员<\/h2>/);
  assert.match(panel, /aria-label="群聊成员列表"/);
  assert.match(panel, /群聊名称/);
  assert.match(panel, /群公告/);
  assert.match(panel, /备注/);
  assert.match(panel, /我在本群的昵称/);
});

test("group details expose four hover-to-edit values with inline keyboard editing", async () => {
  const source = await rendererSource;
  const panel = sourceBlock(
    source,
    "function localGroupChatProfileNickname",
    "function renderLocalGroupChatMemberMenu",
  );

  for (const [field, label] of [
    ["name", "群聊名称"],
    ["announcement", "群公告"],
    ["note", "备注"],
    ["nickname", "我在本群的昵称"],
  ]) {
    assert.match(
      panel,
      new RegExp(
        `renderLocalGroupChatInfoItem\\(record, "${field}", "${label}"\\)`,
      ),
    );
  }
  assert.match(panel, /data-local-group-info-edit=/);
  assert.match(panel, /class="local-group-chat-info-edit-icon"/);
  assert.match(panel, /data-local-group-info-form=/);
  assert.match(panel, /data-local-group-info-input=/);
  assert.match(source, /openLocalGroupChatInfoEditor\(threadId, field\)/);
  assert.match(source, /keyboardEvent\.key === "Escape"/);
  assert.match(
    source,
    /keyboardEvent\.key === "Enter"[\s\S]*keyboardEvent\.ctrlKey \|\| keyboardEvent\.metaKey/,
  );
  assert.match(source, /submitLocalGroupChatInfoEditor\(\)/);
});

test("group name and my group nickname persist and update their linked conversation surfaces", async () => {
  const source = await rendererSource;
  const submit = sourceBlock(
    source,
    "function submitLocalGroupChatInfoEditor",
    "function renderLocalGroupChatMemberMenu",
  );
  const sender = sourceBlock(
    source,
    "function visibleMessageSenderLabel",
    "function isWechatChannelMessageContext",
  );

  assert.match(source, /nickname:\s*typeof source\.nickname === "string" \? source\.nickname : ""/);
  assert.match(submit, /record\[editor\.field\] = value/);
  assert.match(submit, /threadNameOverrides\[record\.id\] = value/);
  assert.match(
    submit,
    /thread\.id === record\.id \? \{ \.\.\.thread, name: value \} : thread/,
  );
  assert.match(submit, /saveThreadPreferences\(\)/);
  assert.match(submit, /saveLocalGroupChatRecords\(\)/);
  assert.match(sender, /const localGroup = localGroupChatRecord\(message\?\.conversation_id\)/);
  assert.match(sender, /localGroupChatProfileNickname\(localGroup\)/);
});

test("the details panel places add and remove controls after the member list", async () => {
  const source = await rendererSource;
  const panel = sourceBlock(
    source,
    "function renderLocalGroupChatMemberCell",
    "function renderLocalGroupChatMemberMenu",
  );

  assert.match(panel, /function renderLocalGroupChatAddMemberButton/);
  assert.match(panel, /data-action="open-add-group-members-dialog"/);
  assert.match(panel, /aria-label="添加群成员"/);
  assert.match(panel, /<span class="local-group-chat-member-name">添加<\/span>/);
  assert.match(panel, /function renderLocalGroupChatRemoveMemberButton/);
  assert.match(panel, /data-action="open-remove-group-members-dialog"/);
  assert.match(panel, /aria-label="移出群成员"/);
  assert.match(panel, /<span class="local-group-chat-member-name">移出<\/span>/);
  assert.ok(
    panel.indexOf("${renderLocalGroupChatAddMemberButton(record)}") >
      panel.indexOf(".map((member) =>"),
    "add-member control should render after mapped group members",
  );
  assert.ok(
    panel.indexOf("${renderLocalGroupChatRemoveMemberButton(record)}") >
      panel.indexOf("${renderLocalGroupChatAddMemberButton(record)}"),
    "remove-member control should render after add-member control",
  );
});

test("local group conversations expose rename and persist the name used across every surface", async () => {
  const source = await rendererSource;
  const renamePolicy = sourceBlock(source, "function canRenameThread", "function threadListPreviewText");
  const renameSubmit = sourceBlock(source, "function submitThreadRenameDialog", "function openThreadGroupSetDialog");

  assert.match(renamePolicy, /if \(isLocalGroupChatThread\(thread\)\) return true/);
  assert.match(renamePolicy, /title: "重命名群聊"/);
  assert.match(renamePolicy, /placeholder: "填写群聊名称"/);
  assert.match(source, /data-thread-action="rename"/);
  assert.match(renameSubmit, /const localGroup = localGroupChatRecord\(dialog\.threadId\)/);
  assert.match(renameSubmit, /localGroup\.name = name/);
  assert.match(renameSubmit, /saveLocalGroupChatRecords\(\)/);
  assert.match(renameSubmit, /thread\.id === dialog\.threadId \? \{ \.\.\.thread, name \} : thread/);
  assert.match(renameSubmit, /saveThreadPreferences\(\)/);
});

test("the group ellipsis controls both member details and file previews", async () => {
  const source = await rendererSource;
  const toggle = sourceBlock(
    source,
    "function toggleLocalGroupChatMembersPanel",
    "function toggleGroupChatSection",
  );

  assert.match(toggle, /if \(state\.chatPreview\)/);
  assert.match(toggle, /record\.panelExpanded = false/);
  assert.match(toggle, /saveLocalGroupChatRecords\(\)/);
  assert.match(toggle, /closePreviewPanel\("chat"\)/);
  assert.match(toggle, /state\.rightCollapsed = !state\.rightCollapsed/);
});

test("local group details cover light and dark interaction states without a custom toggle surface", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.local-group-chat-members-panel\s*\{[^}]*width:\s*270px;[^}]*max-width:\s*270px;/s);
  assert.match(styles, /\.local-group-chat-members-inner\s*\{[^}]*width:\s*270px;[^}]*min-width:\s*270px;/s);
  assert.match(styles, /\.local-group-chat-member-search\s*\{[^}]*width:\s*100%;[^}]*height:\s*32px;/s);
  assert.doesNotMatch(styles, /\.local-group-chat-more/);
  assert.match(styles, /\.panel-toggle:is\([\s\S]*?\.left-panel-toggle,[\s\S]*?\[data-action="toggle-right-panel"\],[\s\S]*?\[data-action="toggle-trading-expert-chart"\]/);
  assert.match(styles, /\.local-group-chat-member-search:hover\s*\{/);
  assert.match(styles, /\.local-group-chat-member-search:focus-within\s*\{/);
  assert.match(styles, /\.local-group-chat-member-search:has\(input:disabled\)\s*\{/);
  assert.match(styles, /\.local-group-chat-member-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.match(styles, /\.local-group-chat-member-grid\s*\{[^}]*gap:\s*10px clamp\(5px, 2%, 6px\);/s);
  assert.match(styles, /\.local-group-chat-member-avatar\s*\{[^}]*width:\s*35px;[^}]*height:\s*35px;/s);
  assert.match(styles, /\.local-group-chat-info-item h3\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.local-group-chat-info-value:hover\s*\{/);
  assert.match(styles, /\.local-group-chat-info-value:active\s*\{/);
  assert.match(styles, /\.local-group-chat-info-value:focus-visible\s*\{/);
  assert.match(styles, /\.local-group-chat-info-edit-icon\s*\{[^}]*opacity:\s*0;/s);
  assert.match(
    styles,
    /\.local-group-chat-info-value:hover \.local-group-chat-info-edit-icon,[\s\S]*opacity:\s*1;/,
  );
  assert.match(styles, /\.local-group-chat-info-editor input:focus,/);
  assert.match(styles, /\.local-group-chat-info-editor-actions button:hover\s*\{/);
  assert.match(styles, /\.local-group-chat-info-editor-actions button:active\s*\{/);
  assert.match(styles, /\.local-group-chat-info-editor-actions button:focus-visible\s*\{/);
  assert.match(styles, /\.local-group-chat-info-editor-actions button:disabled\s*\{/);
  assert.doesNotMatch(styles, /\.local-group-chat-members-heading/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-search:focus-within\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-member-cell:hover\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-value:hover\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-value:active\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-value:focus-visible\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-editor input:focus,/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-editor-actions button:hover\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-editor-actions button:active\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-editor-actions button:focus-visible\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info-editor-actions button:disabled\s*\{/);
  for (const state of ["hover", "active", "focus-visible", "disabled"]) {
    assert.match(
      styles,
      new RegExp(
        `html\\[data-theme="dark"\\] \\.local-group-chat-add-member:${state} \\.local-group-chat-add-member-icon`,
      ),
    );
    assert.match(
      styles,
      new RegExp(
        `html\\[data-theme="dark"\\] \\.local-group-chat-remove-member:${state} \\.local-group-chat-add-member-icon`,
      ),
    );
  }
  assert.match(styles, /html\[data-theme="dark"\] \.local-group-chat-info\s*\{/);
});
