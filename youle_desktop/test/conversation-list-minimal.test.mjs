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
  assert.match(rowBlock, /const analysisContextLabel = tradingLastAnalysisLabelForThread\(thread\.id\);/);
  assert.match(rowBlock, /class="conversation-analysis-context" title="最后分析画布/);
  assert.match(
    rowBlock,
    /class="row-name" title="\$\{escapeAttr\(minimalTitle\)\}"><span class="row-name-text">\$\{escapeHtml\(minimalTitle\)\}<\/span><\/span>/,
  );
  assert.doesNotMatch(rowBlock, /renderThreadRowAvatar|row-preview|<time/);

  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  assert.match(sections, /threads\.filter\(\(thread\) => !isBlankNewThread\(thread\.id\)\)/);
});

test("sidebar actions follow Codex order, with settings moved from the titlebar to the bottom-left icon", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const titlebarActions = sourceBlock(source, "function renderTitlebarPrimaryActions", "function renderWindowControls");
  const footer = sourceBlock(source, "function renderConversationListFooter", "function renderChatList");
  const chatList = sourceBlock(source, "function renderChatList", "function isHaoloContact");
  const labels = ["新任务", "账户", "预警", "知识库", "策略"];
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
  assert.match(actions, /data-conversation-static-action="skills"/);
  assert.match(actions, /renderConversationListIcon\("skills"\)/);
  assert.doesNotMatch(actions, /data-trading-expert-panel-tab|role="tab"|aria-selected/);
  assert.match(titlebarActions, /data-action="toggle-external-channel-menu"/);
  assert.doesNotMatch(titlebarActions, /自动化|open-auto-tasks/);
  assert.match(titlebarActions, /titlebar-icon-action[^>]*toggle-external-channel-menu[^>]*aria-label="连接"[\s\S]*renderTitlebarPlugIcon\(\)/);
  assert.match(titlebarActions, /data-action="open-auto-task-dialog"[\s\S]*aria-label="自动任务"[\s\S]*renderTitlebarAlarmIcon\(\)/);
  assert.ok(titlebarActions.indexOf('data-action="toggle-external-channel-menu"') < titlebarActions.indexOf('data-action="open-auto-task-dialog"'));
  assert.doesNotMatch(titlebarActions, />连接<|data-action="open-settings"|>设置<|renderConversationListIcon|>任务</);
  assert.doesNotMatch(actions, /data-action="open-auto-task-dialog"|renderTitlebarAlarmIcon/);
  assert.match(footer, /class="conversation-list-footer"/);
  assert.match(footer, /class="conversation-list-settings-button/);
  assert.match(footer, /data-action="open-settings"/);
  assert.match(footer, /title="设置"[^]*aria-label="设置"[^]*aria-haspopup="dialog"/);
  assert.match(footer, /aria-expanded="\$\{state\.settingsOpen \? "true" : "false"\}"/);
  assert.match(footer, /renderConversationListIcon\("settings"\)/);
  assert.ok(chatList.indexOf("renderUpdateDownloadDock()") < chatList.indexOf("renderConversationListFooter()"));
  assert.doesNotMatch(actions, /open-group-chat-dialog|renderConversationListIcon\("group-chat"\)|创建群聊/);
  assert.doesNotMatch(source, /renderChatNewMenu|CHAT_NEW_PLUS|create-workflow-canvas|createBlankWorkflowCanvas/);
  assert.doesNotMatch(source, /renderAppSidebar|renderNavIcon|class="app-sidebar"|data-nav=/);
});

test("the sidebar skills action opens the existing skills and plugins page", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const openSkillsPage = sourceBlock(source, "function openMyConfigPage", "function openSettingsDialog");
  const eventBindings = source.slice(source.indexOf("function bindEvents()"));

  assert.match(actions, /data-conversation-static-action="knowledge"[\s\S]*data-conversation-static-action="skills"/);
  assert.match(actions, /data-conversation-static-action="skills"[\s\S]*<span>策略<\/span>/);
  assert.match(openSkillsPage, /state\.activeView = "skillsPlaza"/);
  assert.match(openSkillsPage, /state\.skillsPlazaTab = "mySkills"/);
  assert.match(openSkillsPage, /refreshSkills\(\{ forceReload: true, reason: "my-config", renderAfter: false \}\)/);
  assert.match(openSkillsPage, /loadMyMarketplaceSkills\(\)/);
  assert.match(
    eventBindings,
    /\[data-conversation-static-action="skills"\][\s\S]*openMyConfigPage\(\)/,
  );
});

test("the bottom-left settings icon covers light and dark interaction states with shared theme tokens", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.conversation-list-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*background:\s*var\(--app-chrome-background\);/s);
  assert.match(styles, /\.conversation-list-settings-button\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-secondary\);/s);
  assert.match(styles, /\.conversation-list-settings-button:is\(:hover, :focus-visible\),[\s\S]*?\.conversation-list-settings-button\.active\s*\{[^}]*background:\s*var\(--conversation-action-hover\);[^}]*color:\s*var\(--text-primary\);/);
  assert.match(styles, /\.conversation-list-settings-button:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.conversation-list-settings-button:active:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-active-translucent\);/s);
  assert.match(styles, /\.conversation-list-settings-button:disabled\s*\{[^}]*color:\s*var\(--text-muted\);/s);
});

test("the titlebar plug and adjacent alarm actions preserve menus, dialog flow, and themed states", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const titlebarActions = sourceBlock(source, "function renderTitlebarPrimaryActions", "function renderWindowControls");
  const titlebarIcons = sourceBlock(source, "function renderTitlebarPlugIcon", "function renderTitlebarPrimaryActions");
  const eventBindings = source.slice(source.indexOf("function bindEvents()"));

  assert.match(actions, /class="conversation-list-new-row"/);
  assert.match(actions, /data-action="new-chat"[\s\S]*<span>新任务<\/span>/);
  assert.doesNotMatch(actions, /data-action="open-auto-task-dialog"|renderTitlebarAlarmIcon/);
  assert.match(titlebarActions, /renderTitlebarPlugIcon\(\)[\s\S]*data-action="open-auto-task-dialog"[\s\S]*renderTitlebarAlarmIcon\(\)/);
  assert.match(titlebarActions, /aria-label="自动任务"[\s\S]*aria-haspopup="dialog"/);
  assert.match(titlebarIcons, /class="titlebar-action-icon titlebar-plug-icon"[\s\S]*class="titlebar-action-icon titlebar-alarm-icon"/);
  assert.match(styles, /\.conversation-list-new-row\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;/s);
  assert.match(styles, /\.conversation-list-new-action\s*\{[^}]*width:\s*auto;[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.titlebar-primary-action\.titlebar-icon-action\s*\{[^}]*width:\s*30px;[^}]*flex:\s*0 0 30px;[^}]*padding:\s*0;/s);
  assert.match(styles, /\.titlebar-action-icon\s*\{[^}]*width:\s*18px;[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;/s);
  assert.match(styles, /\.titlebar-plug-icon\s*\{[^}]*transform:\s*translateX\(-5px\);/s);
  assert.match(styles, /\.titlebar-alarm-icon\s*\{[^}]*transform:\s*translateX\(-15px\);/s);
  assert.match(styles, /\.titlebar-primary-action:hover:not\(:disabled\),[\s\S]*?\.titlebar-channel-action\.menu-open > \.titlebar-primary-action,[\s\S]*?\.titlebar-primary-action:is\(\.active, :active\):not\(:disabled\)\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(styles, /\.titlebar-primary-action\s*\{[^}]*transition:[^;}]*background/s);
  assert.match(styles, /\.titlebar-primary-action:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.titlebar-primary-action:disabled\s*\{[^}]*color:\s*var\(--text-muted\);/s);
  assert.doesNotMatch(styles, /\.conversation-list-auto-task-action|\.conversation-list-alarm-icon/);
  assert.match(
    eventBindings,
    /\.querySelectorAll<HTMLElement>\(\s*'\[data-action="open-auto-task-dialog"\]',\s*\)/,
  );
  assert.doesNotMatch(eventBindings, /open-auto-tasks/);
  assert.match(eventBindings, /state\.autoTaskDraft = createAutoTaskDraft\(state\.activeNewThreadGroupId\);/);
  assert.match(eventBindings, /state\.autoTaskPicker = null;/);
  assert.match(eventBindings, /state\.autoTaskCalendarMonth = state\.autoTaskDraft\.date;/);
  assert.match(eventBindings, /state\.autoTaskDialogOpen = true;/);
  assert.match(eventBindings, /state\.externalChannels\.menuOpen = false;/);
});

test("pinned conversations are global and projects use folders with a five-row preview", async () => {
  const source = await rendererSource;
  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  const projectSection = sourceBlock(source, "function renderThreadGroupSection", "function renderUngroupedConversationProject");
  const projectRows = sourceBlock(source, "function renderConversationProjectThreads", "function groupedThreadsForList");

  assert.match(sections, /const pinnedThreads = conversations\.filter\(\(thread\) => Boolean\(thread\.pinned\)\)/);
  assert.match(sections, /const projectThreads = conversations\.filter\(\(thread\) => !thread\.pinned\)/);
  assert.ok(sections.indexOf("renderPinnedThreadSection") < sections.indexOf("conversation-projects-section"));
  assert.match(source, /renderConversationListIcon\("folder"\)/);
  assert.match(source, /const DEFAULT_THREAD_GROUP_CONVERSATION_LABEL = "最近";/);
  assert.doesNotMatch(source, /TRADING_EXPERT_GROUP_DISPLAY_NAME|历史任务/);
  assert.match(projectSection, /const displayName = storedDisplayName;/);
  assert.match(projectRows, /threads\.slice\(0, CONVERSATION_PROJECT_PREVIEW_LIMIT\)/);
  assert.match(projectRows, /data-conversation-project-expand/);
  assert.match(projectRows, />展开显示<\/button>/);
});

test("collapsing a project resets only its temporary expanded-all view", async () => {
  const source = await rendererSource;
  const toggleBlock = sourceBlock(
    source,
    "function toggleThreadGroupCollapsed",
    "async function toggleThreadPin",
  );
  assert.match(
    toggleBlock,
    /collapsedThreadGroupIds\.has\(groupId\)[\s\S]*collapsedThreadGroupIds\.delete\(groupId\)[\s\S]*else\s*\{[\s\S]*collapsedThreadGroupIds\.add\(groupId\)[\s\S]*expandedConversationProjectIds\.delete\(groupId\)/,
  );
  assert.ok(
    toggleBlock.indexOf("expandedConversationProjectIds.delete(groupId)")
      < toggleBlock.indexOf("render()"),
  );
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
  const reportBlock = sourceBlock(
    source,
    "function appendTradingExpertReport",
    "async function runTradingGeneralChartRequest",
  );
  assert.match(reportBlock, /patchConversationRow\(threadId\);/);
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
    /\.conversation-row-wrap\.conversation-row-minimal \.conversation-row\s*\{[^}]*padding:\s*0 12px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\.has-final-result-unviewed[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*28px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal:is\([\s\S]*:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open,[\s\S]*\.has-unread,[\s\S]*\.is-working[\s\S]*\)[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*36px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\.has-unread\.is-working[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*54px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.unread-dot\s*\{[^}]*top:\s*8px;/s,
  );
  assert.match(minimalStyles, /> \.conversation-row-minimal\s*\+ \.conversation-row-minimal\s*\{[^}]*margin-top:\s*2px;/s);
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.conversation-copy-minimal \.row-name\s*\{[^}]*container-type:\s*inline-size;[^}]*font-weight:\s*400;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;[^}]*mask-image:\s*linear-gradient/s,
  );
  assert.match(
    minimalStyles,
    /black calc\(100% - 12px\),[\s\S]*black 82%[\s\S]*calc\(100% - 8px\),[\s\S]*black 48%[\s\S]*calc\(100% - 3px\),[\s\S]*transparent 100%/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.thread-marker-dot\s*\{[^}]*left:\s*-2px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.row-name-text\s*\{[^}]*width:\s*max-content;[^}]*text-overflow:\s*clip;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal:is\([\s\S]*:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open[\s\S]*\)[\s\S]*\.row-name-text\s*\{[^}]*animation:\s*conversation-title-scroll-left 2s ease-in-out 0\.2s both;/s,
  );
  assert.match(
    minimalStyles,
    /@keyframes conversation-title-scroll-left\s*\{[\s\S]*translateX\(min\(0px, calc\(100cqw - 100%\)\)\)/s,
  );
  assert.match(
    minimalStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.row-name-text\s*\{[^}]*animation:\s*none;/s,
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
    /\.conversation-project-thread-list > \.conversation-row-wrap\.conversation-row-minimal\s*\{[^}]*width:\s*calc\(100% - 19px\);[^}]*margin-right:\s*4px;[^}]*margin-left:\s*15px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-expand\s*\{[^}]*width:\s*calc\(100% - 19px\);[^}]*height:\s*32px;[^}]*margin:\s*0 4px 0 15px;[^}]*align-items:\s*center;[^}]*justify-content:\s*flex-start;[^}]*padding:\s*7px 12px;[^}]*line-height:\s*18px;[^}]*text-align:\s*left;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section\s*\{[^}]*position:\s*relative;[^}]*left:\s*-6px;[^}]*padding-top:\s*0;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section \.conversation-group-title\s*\{[^}]*position:\s*relative;[^}]*left:\s*2px;[^}]*height:\s*32px;/s,
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
  assert.match(lightTokens, /--conversation-analysis-context:\s*#9a6700/);
  assert.match(darkTokens, /--conversation-analysis-context:\s*#ffd43b/);
  assert.match(darkTokens, /--border-translucent:/);
  assert.match(minimalStyles, /\.conversation-analysis-context\s*\{[^}]*color:\s*var\(--conversation-analysis-context\);[^}]*font-weight:\s*650;/s);
  assert.match(minimalStyles, /:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open[\s\S]*background:\s*var\(--surface-hover-translucent\);/);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);[^}]*box-shadow:\s*none;/s);
  assert.match(minimalStyles, /html\[data-theme="dark"\] \.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);/s);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active[\s\S]*\.conversation-copy-minimal[\s\S]*\.row-name\s*\{[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /\.conversation-row:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--border-translucent\);/s);
  assert.match(styles, /\.conversation-row-wrap:focus-within \.thread-more-button/);
  assert.match(minimalStyles, /\.thread-more-button:is\(:hover, :focus-visible, \.active\)\s*\{[^}]*background:\s*var\(--surface-hover-translucent\);[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /has-final-result-unviewed[\s\S]*background:\s*var\(--brand-blue\);/);
  assert.doesNotMatch(minimalStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
