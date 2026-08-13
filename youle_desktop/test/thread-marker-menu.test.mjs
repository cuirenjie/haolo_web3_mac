import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("thread context menu exposes the marker submenu directly below pin", async () => {
  const source = await rendererSource;
  const menu = sourceBlock(
    source,
    "function renderThreadContextMenuWithGroups",
    "function renderThreadMarkerMenuItem",
  );
  const markerMenu = sourceBlock(
    source,
    "function renderThreadMarkerMenuItem",
    "function renderThreadRenameMenuItem",
  );
  const rowContextMenu = sourceBlock(
    source,
    "function openThreadRowContextMenuFromElement",
    "function openThreadGroupContextMenuFromElement",
  );

  assert.match(
    source,
    /const THREAD_MARKER_PRESETS = \["待办", "进行", "完成", "暂缓", "关闭"\] as const;/,
  );
  assert.ok(
    menu.indexOf('data-thread-action="pin"') <
      menu.indexOf("renderThreadMarkerMenuItem(target)"),
  );
  assert.ok(
    menu.indexOf("renderThreadMarkerMenuItem(target)") <
      menu.indexOf("renderThreadRenameMenuItem(target)"),
  );
  assert.match(markerMenu, /class="thread-marker-submenu"/);
  assert.match(
    markerMenu,
    /class="thread-marker-custom"[\s\S]*data-thread-action="marker-custom"/,
  );
  assert.match(markerMenu, /<span>自定义<\/span>/);
  assert.doesNotMatch(markerMenu, /renderThreadGroupAddMenuIcon\("chevron"\)/);
  assert.doesNotMatch(markerMenu, /thread-marker-check|<svg/);
  assert.match(source, /const THREAD_CONTEXT_MENU_WIDTH = 92;/);
  assert.match(source, /const THREAD_CONTEXT_MENU_ROW_HEIGHT = 28;/);
  assert.match(source, /const THREAD_CONTEXT_MENU_CHROME_HEIGHT = 14;/);
  assert.match(
    source,
    /const rowCount = target && isExternalChannelConnectionThread\(target\) \? 2 : 5;/,
  );
  assert.match(
    source,
    /rowCount \* THREAD_CONTEXT_MENU_ROW_HEIGHT\s*\+\s*THREAD_CONTEXT_MENU_CHROME_HEIGHT/,
  );
  assert.match(
    source,
    /openThreadMenuAt\(id, rect\.right - THREAD_CONTEXT_MENU_WIDTH - 9,/,
  );
  assert.match(
    source,
    /root\s*\.querySelector<HTMLElement>\("\.chat-list"\)\s*\?\.getBoundingClientRect\(\)\.right/,
  );
  assert.match(
    source,
    /const requestedLeft = chatListRight == null \? menu\.x : chatListRight \+ THREAD_CONTEXT_MENU_LIST_GAP;/,
  );
  assert.match(source, /const top = bottomClampedMenuTop\(menu\.y, height\);/);
  const bottomClamp = sourceBlock(
    source,
    "function bottomClampedMenuTop",
    "function floatingMenuTop",
  );
  assert.match(
    bottomClamp,
    /const bottomLimit = Math\.max\(viewportTop, viewportBottom - height\);/,
  );
  assert.match(
    bottomClamp,
    /return Math\.min\(Math\.max\(viewportTop, preferredTop\), bottomLimit\);/,
  );
  assert.doesNotMatch(bottomClamp, /shouldOpenAbove|aboveTop/);
  assert.match(
    rowContextMenu,
    /row\.querySelector<HTMLButtonElement>\("\[data-thread-more\]"\)/,
  );
  assert.match(
    rowContextMenu,
    /if \(moreButton\) \{\s*openThreadMoreMenu\(moreButton\);\s*return true;/s,
  );
});

test("thread group action opens a hover submenu and moves directly to another group", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const menu = sourceBlock(
    source,
    "function renderThreadContextMenuWithGroups",
    "function renderThreadMarkerMenuItem",
  );
  const groupMenu = sourceBlock(
    source,
    "function renderThreadGroupMoveMenuItem",
    "function renderThreadRenameMenuItem",
  );
  const commands = sourceBlock(
    source,
    "function runThreadMenuCommand",
    "function runThreadGroupMenuCommand",
  );
  const assignment = sourceBlock(
    source,
    "function assignThreadToGroup",
    "function openThreadGroupEditor",
  );
  const groupCreation = sourceBlock(
    source,
    "type ThreadGroupImportTarget",
    "function selectNewThreadGroupFolder",
  );

  assert.match(menu, /renderThreadGroupMoveMenuItem\(target\)/);
  assert.doesNotMatch(menu, /data-thread-action="group"/);
  assert.match(
    groupMenu,
    /class="thread-group-move-menu-trigger"[\s\S]*aria-haspopup="menu"/,
  );
  assert.match(
    groupMenu,
    /\.filter\(\(group\) => group\.id !== currentGroupId\)/,
  );
  assert.match(groupMenu, /data-thread-action="group-select"/);
  assert.match(groupMenu, /data-thread-group-id=/);
  assert.match(
    groupMenu,
    /class="thread-group-add-from-menu"[\s\S]*data-thread-action="group-add"/,
  );
  assert.match(groupMenu, /<span>增加分组<\/span>/);
  assert.match(
    commands,
    /action === "group-select"[\s\S]*moveThreadToGroup\(id, button\.dataset\.threadGroupId\)/,
  );
  assert.match(
    commands,
    /action === "group-add"[\s\S]*openThreadGroupCreateFolderDialog\("thread-menu", \{ threadId: id \}\)/,
  );
  assert.match(
    assignment,
    /rememberThreadWorkspace\(threadId, threadWorkspaceCwd\(threadId\)\)/,
  );
  assert.match(assignment, /threadGroupByThreadId\[threadId\] = group\.id/);
  assert.match(
    assignment,
    /showToast\(`已移动到\$\{threadGroupDisplayLabel\(group\)\}`/,
  );
  assert.match(groupCreation, /\| "thread-menu"/);
  assert.match(groupCreation, /threadId: options\.threadId \?\? null/);
  assert.match(
    groupCreation,
    /target === "thread-menu"[\s\S]*threadGroupByThreadId\[targetThread\.id\] = group\.id/,
  );

  assert.match(
    styles,
    /\.thread-group-move-menu-item:hover \.thread-group-move-submenu[\s\S]*display: grid/,
  );
  assert.match(
    styles,
    /\.thread-group-move-menu-item\.submenu-open \.thread-group-move-submenu[\s\S]*display: grid/,
  );
  assert.match(
    styles,
    /\.thread-group-move-submenu\s*\{[\s\S]*bottom: -6px;[\s\S]*width: 140px/,
  );
  assert.match(
    styles,
    /button\.thread-group-add-from-menu[\s\S]*color: var\(--brand-blue\)/,
  );
});

test("custom markers require exactly two characters and persist per thread", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const normalize = sourceBlock(
    source,
    "function normalizeThreadMarkerText",
    "function threadMarkerForThreadId",
  );
  const submit = sourceBlock(
    source,
    "function submitThreadMarkerDialog",
    "function replaceThreadMarker",
  );
  const dialog = sourceBlock(
    source,
    "function renderThreadMarkerDialog",
    "function visibleConversationThreadsForChatList",
  );
  const save = sourceBlock(
    source,
    "function saveThreadPreferences",
    "function shouldPersistThreadPreferenceId",
  );

  assert.match(normalize, /characters\.length === 2/);
  assert.match(submit, /请输入两个字的标记名称/);
  assert.match(dialog, /maxlength="2"/);
  assert.match(save, /threadMarkers: Object\.fromEntries/);
  assert.match(source, /parsed\.threadMarkers/);
  assert.match(
    styles,
    /\.thread-marker-dialog #threadMarkerNameInput\s*\{[\s\S]*?border: 1px solid var\(--line-strong\)/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.thread-marker-dialog #threadMarkerNameInput\s*\{[\s\S]*?background: #111317/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.thread-marker-dialog #threadMarkerNameInput:focus\s*\{[\s\S]*?border-color: #5b9dff/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.thread-marker-dialog \.thread-dialog-primary:not\(:disabled\)\s*\{[\s\S]*?background: #2563eb/,
  );
});

test("manual markers override automatic avatar anchors and use semantic colors", async () => {
  const source = await rendererSource;
  const markerMenu = sourceBlock(
    source,
    "function renderThreadMarkerMenuItem",
    "function renderThreadRenameMenuItem",
  );
  const avatarText = sourceBlock(
    source,
    "function taskAnchorAvatarText",
    "function renderThreadAvatar",
  );
  const colors = sourceBlock(
    source,
    "const THREAD_MARKER_PRESET_COLORS",
    "const CASCADE_MENU_CLOSE_DELAY_MS",
  );
  const markerColor = sourceBlock(
    source,
    "function threadMarkerColor",
    "function renderThreadMarkerDot",
  );
  const threadRow = sourceBlock(
    source,
    "function renderThreadRow",
    "function threadComposerDraftPreview",
  );
  const threadAvatar = sourceBlock(
    source,
    "function renderThreadAvatar",
    "function renderThreadRowAvatar",
  );
  const styles = await stylesSource;

  assert.match(avatarText, /threadMarkerForThreadId\(thread\?\.id\)/);
  assert.match(colors, /待办:[\s\S]*进行:[\s\S]*完成:[\s\S]*暂缓:[\s\S]*关闭:/);
  const presetColorValues = [
    ...colors.matchAll(/(?:待办|进行|完成|暂缓|关闭): "(#[0-9a-f]{6})"/gi),
  ].map((match) => match[1].toLowerCase());
  assert.equal(presetColorValues.length, 5);
  assert.equal(new Set(presetColorValues).size, 5);
  assert.match(markerColor, /THREAD_MARKER_PRESET_COLORS/);
  assert.match(markerColor, /character\.codePointAt\(0\)/);
  assert.match(markerColor, /hsl\(\$\{hash\} 66% 46%\)/);
  assert.match(threadRow, /const marker = threadMarkerForThreadId\(thread\.id\)/);
  assert.match(threadRow, /marker \? `标记 \$\{marker\}` : ""/);
  assert.match(threadRow, /marker \? renderThreadMarkerDot\(marker\) : ""/);
  assert.match(threadAvatar, /marker \? threadMarkerColor\(marker\) : taskAnchorAvatarBg\(taskAnchor\)/);
  assert.match(markerMenu, /renderThreadMarkerDot\(marker, "thread-marker-choice-dot"\)/);
  assert.match(
    styles,
    /\.conversation-row-minimal \.thread-marker-dot\s*\{[\s\S]*position: absolute;[\s\S]*left: -2px;[\s\S]*width: 7px;[\s\S]*height: 7px;/,
  );
  assert.match(
    styles,
    /\.thread-marker-choice-dot,\s*\.thread-marker-dot\s*\{[\s\S]*background: var\(--thread-marker-color\)/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.thread-marker-choice-dot,\s*html\[data-theme="dark"\] \.thread-marker-dot\s*\{[\s\S]*rgba\(255, 255, 255, 0\.28\)/,
  );
  assert.match(
    styles,
    /\.thread-marker-menu-item:hover \.thread-marker-submenu[\s\S]*display: grid/,
  );
  assert.match(
    styles,
    /\.thread-marker-menu-item\.submenu-open \.thread-marker-submenu[\s\S]*display: grid/,
  );
  assert.match(
    styles,
    /\.thread-context-menu\.has-thread-marker-submenu[\s\S]*overflow: visible/,
  );
  assert.match(
    styles,
    /\.thread-marker-submenu button\.active\s*\{[\s\S]*background: var\(--selection-strong\)/,
  );
  assert.match(
    styles,
    /\.thread-context-menu \.thread-marker-submenu button:hover\s*\{[\s\S]*background: var\(--surface-hover\)/,
  );
  assert.match(
    styles,
    /button\.thread-marker-custom\s*\{[\s\S]*color: var\(--brand-blue\)/,
  );
  assert.match(
    markerMenu,
    /class="thread-marker-custom"[\s\S]*?<span>自定义<\/span>/,
  );
  assert.match(
    styles,
    /button\.thread-marker-custom > span\s*\{[\s\S]*color: var\(--brand-blue\);[\s\S]*font-weight: 500;/,
  );
  assert.match(styles, /\.thread-marker-submenu\s*\{[\s\S]*width: 108px/);
  assert.doesNotMatch(
    styles,
    /\.thread-marker-check|\.thread-marker-menu-trigger svg/,
  );
  assert.match(styles, /\.thread-context-menu\s*\{[\s\S]*width: 92px/);
  assert.match(styles, /--thread-context-submenu-gap: 2px/);
  assert.match(
    styles,
    /--thread-context-submenu-offset: calc\(6px \+ 1px \+ var\(--thread-context-submenu-gap\)\)/,
  );
  assert.match(
    styles,
    /\.thread-marker-submenu\s*\{[\s\S]*top: -97px;[\s\S]*left: calc\(100% \+ var\(--thread-context-submenu-offset\)\)[\s\S]*gap: 2px[\s\S]*border-radius: 10px/,
  );
  assert.match(
    styles,
    /\.thread-marker-submenu::before\s*\{[\s\S]*top: -8px[\s\S]*width: var\(--thread-context-submenu-offset\)[\s\S]*height: calc\(100% \+ 16px\)/,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.thread-marker-submenu,/);

  const hoverEvents = sourceBlock(
    source,
    "function bindCascadeMenuHoverEvents",
    "function bindEvents",
  );
  assert.match(source, /const CASCADE_MENU_CLOSE_DELAY_MS = 180;/);
  assert.match(
    hoverEvents,
    /\.thread-group-add-menu-item, \.thread-marker-menu-item, \.thread-group-move-menu-item/,
  );
  assert.doesNotMatch(hoverEvents, /external-channel-cascade-item/);
  assert.match(
    hoverEvents,
    /item\.addEventListener\("pointerenter", keepOpen\)/,
  );
  assert.match(
    hoverEvents,
    /item\.addEventListener\("pointerleave", scheduleClose\)/,
  );
  assert.match(
    hoverEvents,
    /item\.matches\(":hover"\) \|\| item\.contains\(document\.activeElement\)/,
  );
});
