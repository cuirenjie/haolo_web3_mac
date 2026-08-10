import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const desktopMainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("history conversations render as one-line titles and the blank thread is not duplicated as a row", async () => {
  const source = await rendererSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(rowBlock, /const minimalTitle = rawRowName\.trim\(\) \|\| preview\.trim\(\) \|\| NEW_THREAD_TITLE;/);
  assert.match(rowBlock, /conversation-row-wrap conversation-row-minimal/);
  assert.match(rowBlock, /conversation-copy conversation-copy-minimal/);
  assert.match(rowBlock, /class="row-name" title="\$\{escapeAttr\(minimalTitle\)\}"/);
  assert.doesNotMatch(rowBlock, /renderThreadRowAvatar|row-preview|<time/);

  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  assert.match(sections, /threads\.filter\(\(thread\) => !isBlankNewThread\(thread\.id\)\)/);
});

test("sidebar actions follow Codex order and remove the old plus and blank-canvas shortcut", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const titlebarActions = sourceBlock(source, "function renderTitlebarPrimaryActions", "function renderWindowControls");
  const labels = ["新对话", "账户", "预警", "知识库"];
  let cursor = -1;
  for (const label of labels) {
    const index = actions.indexOf(`<span>${label}</span>`);
    assert.ok(index > cursor, `${label} should appear in the requested order`);
    cursor = index;
  }
  assert.match(actions, /data-action="new-chat"/);
  assert.match(actions, /renderConversationListIcon\("account"\)/);
  assert.match(actions, /renderConversationListIcon\("alerts"\)/);
  assert.match(actions, /renderConversationListIcon\("knowledge"\)/);
  assert.doesNotMatch(actions, /data-trading-expert-panel-tab|role="tab"|aria-selected/);
  assert.match(titlebarActions, /data-action="open-auto-tasks"/);
  assert.match(titlebarActions, /data-action="toggle-external-channel-menu"/);
  assert.match(titlebarActions, /data-action="open-settings"/);
  assert.ok(titlebarActions.indexOf("自动化") < titlebarActions.indexOf("连接"));
  assert.ok(titlebarActions.indexOf("连接") < titlebarActions.indexOf("设置"));
  assert.doesNotMatch(titlebarActions, /renderConversationListIcon|<svg|>任务</);
  assert.doesNotMatch(actions, /open-group-chat-dialog|renderConversationListIcon\("group-chat"\)|创建群聊/);
  assert.doesNotMatch(source, /renderChatNewMenu|CHAT_NEW_PLUS|create-workflow-canvas|createBlankWorkflowCanvas/);
  assert.doesNotMatch(source, /renderAppSidebar|renderNavIcon|class="app-sidebar"|data-nav=/);
});

test("the direct auto-task action restores the original create-dialog flow", async () => {
  const source = await rendererSource;
  const eventBindings = source.slice(source.indexOf("function bindEvents()"));

  assert.match(
    eventBindings,
    /\[data-action="open-auto-task-dialog"\], \[data-action="open-auto-tasks"\]/,
  );
  assert.match(eventBindings, /state\.autoTaskDraft = createAutoTaskDraft\(state\.activeNewThreadGroupId\);/);
  assert.match(eventBindings, /state\.autoTaskPicker = null;/);
  assert.match(eventBindings, /state\.autoTaskCalendarMonth = state\.autoTaskDraft\.date;/);
  assert.match(eventBindings, /state\.autoTaskDialogOpen = true;/);
  assert.match(eventBindings, /state\.externalChannels\.menuOpen = false;/);
});

test("pinned conversations are global and projects use folders with a five-row preview", async () => {
  const source = await rendererSource;
  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  const projectRows = sourceBlock(source, "function renderConversationProjectThreads", "function groupedThreadsForList");

  assert.match(sections, /const pinnedThreads = conversations\.filter\(\(thread\) => Boolean\(thread\.pinned\)\)/);
  assert.match(sections, /const projectThreads = conversations\.filter\(\(thread\) => !thread\.pinned\)/);
  assert.ok(sections.indexOf("renderPinnedThreadSection") < sections.indexOf("conversation-projects-section"));
  assert.match(source, /renderConversationListIcon\("folder"\)/);
  assert.match(projectRows, /threads\.slice\(0, CONVERSATION_PROJECT_PREVIEW_LIMIT\)/);
  assert.match(projectRows, /data-conversation-project-expand/);
  assert.match(projectRows, />展开显示<\/button>/);
});

test("minimal rows retain accessible status, unread, working, and overflow-menu behavior", async () => {
  const source = await rendererSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(rowBlock, /const finalResultUnviewed = hasUnviewedFinalResult\(thread\.id\);/);
  assert.match(rowBlock, /finalResultUnviewed \? "has-final-result-unviewed" : ""/);
  assert.match(rowBlock, /pinned \? "已置顶" : ""/);
  assert.match(rowBlock, /working \? "AI 正在工作" : ""/);
  assert.match(rowBlock, /aria-label="\$\{escapeAttr\(minimalAriaLabel\)\}"/);
  assert.match(rowBlock, /thread\.unread \? `<span class="unread-dot">/);
  assert.match(rowBlock, /working \? `<span class="conversation-row-spinner"/);
  assert.match(rowBlock, /data-thread-more="\$\{escapeAttr\(thread\.id\)\}"/);
});

test("minimal conversation rows use compact single-line geometry and trailing actions", async () => {
  const styles = await stylesSource;
  const desktopMain = await desktopMainSource;
  const minimalStyles = styles.slice(styles.indexOf("/* Codex-like conversation history:"));

  assert.match(styles, /--conversation-list-width:\s*192px;/);
  assert.match(desktopMain, /const APP_CHAT_LIST_WIDTH = 192;/);
  assert.match(
    styles,
    /\.chat-list\s*\{[^}]*width:\s*var\(--conversation-list-width\);[^}]*max-width:\s*var\(--conversation-list-width\);/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-action\s*\{[^}]*height:\s*32px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\s*\{[^}]*width:\s*calc\(100% - 12px\);[^}]*height:\s*32px;[^}]*margin:\s*0 6px;[^}]*border-radius:\s*7px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.unread-dot\s*\{[^}]*top:\s*8px;/s,
  );
  assert.match(minimalStyles, /> \.conversation-row-minimal\s*\+ \.conversation-row-minimal\s*\{[^}]*margin-top:\s*2px;/s);
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.conversation-copy-minimal \.row-name\s*\{[^}]*font-weight:\s*400;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.thread-more-button\s*\{[^}]*right:\s*4px;[^}]*width:\s*28px;[^}]*height:\s*28px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-sticky\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*12;[^}]*padding:\s*0 6px;[^}]*background:\s*var\(--app-chrome-background\);[^}]*backdrop-filter:\s*none;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-sticky,\s*\.conversation-list-secondary-actions,\s*\.conversation-list-heading\s*\{[^}]*margin-right:\s*5px;[^}]*margin-left:\s*-5px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-action\.active\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-action\.active:is\(:hover, :focus-visible\),[\s\S]*background:\s*var\(--conversation-action-hover\);/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-thread-list > \.conversation-row-wrap\.conversation-row-minimal\s*\{[^}]*width:\s*calc\(100% - 39px\);[^}]*margin-right:\s*6px;[^}]*margin-left:\s*33px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-expand\s*\{[^}]*width:\s*calc\(100% - 39px\);[^}]*margin:\s*0 6px 0 33px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section \.conversation-group-title\s*\{[^}]*height:\s*32px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section \.conversation-group-toggle\s*\{[^}]*height:\s*32px;/s,
  );
});

test("minimal row hover, selected, focus, menu, and status states share light-dark tokens", async () => {
  const styles = await stylesSource;
  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const minimalStyles = styles.slice(styles.indexOf("/* Codex-like conversation history:"));

  assert.match(lightTokens, /--surface-hover-translucent:/);
  assert.match(lightTokens, /--surface-active-translucent:/);
  assert.match(lightTokens, /--conversation-row-selected:\s*rgba\(17, 24, 39, 0\.05\)/);
  assert.match(lightTokens, /--border-translucent:/);
  assert.match(darkTokens, /--surface-hover-translucent:/);
  assert.match(darkTokens, /--surface-active-translucent:/);
  assert.match(darkTokens, /--conversation-row-selected:\s*rgba\(130, 159, 194, 0\.11\)/);
  assert.match(darkTokens, /--border-translucent:/);
  assert.match(minimalStyles, /:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open[\s\S]*background:\s*var\(--surface-hover-translucent\);/);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);[^}]*box-shadow:\s*none;/s);
  assert.match(minimalStyles, /html\[data-theme="dark"\] \.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);/s);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active[\s\S]*\.conversation-copy-minimal[\s\S]*\.row-name\s*\{[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /\.conversation-row:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--border-translucent\);/s);
  assert.match(minimalStyles, /\.thread-more-button:is\(:hover, :focus-visible, \.active\)\s*\{[^}]*background:\s*var\(--surface-hover-translucent\);[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /has-final-result-unviewed[\s\S]*background:\s*var\(--brand-blue\);/);
  assert.doesNotMatch(minimalStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
