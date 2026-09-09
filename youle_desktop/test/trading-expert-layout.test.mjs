import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderTradingChartBrand } from "../src/renderer/trading-chart-brand.ts";

import {
  TRADING_EXPERT_DEFAULT_MODEL_VALUE,
  TRADING_EXPERT_DEEPSEEK_REASONING_EFFORT,
  TRADING_EXPERT_MODEL_VALUES,
  TRADING_EXPERT_REASONING_EFFORT,
  defaultTradingExpertModelOption,
  tradingExpertReasoningEffort,
  tradingExpertModelOptions,
} from "../src/renderer/trading-expert-models.ts";
import {
  TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH,
  TRADING_EXPERT_MARKET_MIN_WIDTH,
  TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH,
  clampTradingExpertPanelWidths,
  loadTradingExpertPanelWidths,
  resizeTradingExpertPanelWidth,
} from "../src/renderer/trading-expert-panel-resize.ts";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const strategyCatalogSource = readFile(new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url), "utf8");
const favoriteTickerSortSource = readFile(new URL("../src/renderer/trading-expert-favorite-ticker-sort.ts", import.meta.url), "utf8");
const marketIdentitySource = readFile(new URL("../src/renderer/trading-expert-market-identity.ts", import.meta.url), "utf8");
const chartSettingsSource = readFile(new URL("../src/renderer/trading-expert-chart-settings.ts", import.meta.url), "utf8");
const panelResizeSource = readFile(new URL("../src/renderer/trading-expert-panel-resize.ts", import.meta.url), "utf8");
const splitPaneSource = readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8");
const indicatorSource = readFile(new URL("../src/renderer/trading-expert-indicators.ts", import.meta.url), "utf8");
const volumeProfileSource = readFile(new URL("../src/renderer/trading-volume-profile.ts", import.meta.url), "utf8");
const desktopMainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Trading Expert keeps its legacy profile but is removed from the agent directory", async () => {
  const source = await mainSource;
  const profiles = sourceBlock(source, "const CONTACT_PROFILES", "const state:");
  const visibilityBlock = sourceBlock(
    source,
    "function shouldShowContactInDirectory",
    "function isVisibleAgentDirectoryContact",
  );
  const haoloIndex = profiles.indexOf("id: HAOLO_CONTACT_ID");
  const tradingIndex = profiles.indexOf("id: TRADING_EXPERT_CONTACT_ID");
  const videoIndex = profiles.indexOf("id: VIDEO_EXPERT_CONTACT_ID");

  assert.ok(haoloIndex >= 0 && tradingIndex > haoloIndex && tradingIndex < videoIndex);
  const tradingProfile = profiles.slice(tradingIndex, videoIndex);
  assert.match(tradingProfile, /section: "agents"/);
  assert.match(tradingProfile, /avatarUrl: APP_AVATAR_URL/);
  assert.match(tradingProfile, /summary: "交易专家是擅长金融交易和分析的综合智能体，是你的全能交易助手。"/);
  assert.match(tradingProfile, /developer: "Haolo"/);
  assert.match(tradingProfile, /features: \["自然语言交易", "自动分析行情画图表", "自然语言写策略"\]/);
  assert.match(visibilityBlock, /contact\.id === TRADING_EXPERT_CONTACT_ID\) return false/);
});

test("the top-level New Task opens the complete Trading Expert workspace in the main module", async () => {
  const source = await mainSource;
  const blankCreation = sourceBlock(
    source,
    "async function createBlankThreadForList",
    "function ensureTopLevelBlankThreadForList",
  );
  const ensureTopLevelBlank = sourceBlock(
    source,
    "function ensureTopLevelBlankThreadForList",
    "function groupBlankThreadForGroup",
  );
  const activation = sourceBlock(
    source,
    "function activateBlankThread",
    "function isBlankNewThread",
  );
  const initializer = sourceBlock(
    source,
    "function initializeTradingExpertTaskThread",
    "function providerFromThreadId",
  );
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const leftToggle = sourceBlock(
    source,
    "function renderLeftPanelToggle",
    "function syncLeftPanelToggleState",
  );
  const modeSwitch = sourceBlock(
    source,
    "async function switchNewThreadMode",
    "async function switchComposerClusterMode",
  );

  assert.match(blankCreation, /initializeTradingExpertTaskThread\(threadId, \{ expandPanel: options\.activate === true \}\)/);
  assert.match(ensureTopLevelBlank, /shouldActivateBlankThread[\s\S]*state\.currentThreadId = threadId/);
  assert.match(ensureTopLevelBlank, /shouldExpandTradingExpert[\s\S]*!tradingExpertThreadIds\.has\(threadId\)/);
  assert.match(ensureTopLevelBlank, /expandPanel: shouldExpandTradingExpert/);
  assert.match(activation, /initializeTradingExpertTaskThread\(threadId, \{ expandPanel: true \}\)/);
  assert.match(initializer, /tradingExpertThreadIds\.add\(threadId\)/);
  assert.match(initializer, /model: TRADING_EXPERT_DEFAULT_MODEL_VALUE/);
  assert.match(initializer, /reasoningEffort: TRADING_EXPERT_REASONING_EFFORT/);
  assert.match(initializer, /state\.leftCollapsed = false/);
  assert.match(initializer, /state\.rightCollapsed = false/);
  assert.doesNotMatch(initializer, /tradingExpertPanelTab/);
  assert.match(initializer, /state\.tradingExpertChartCollapsed = false/);
  assert.doesNotMatch(renderBlock, /renderAppSidebar/);
  assert.match(renderBlock, /\$\{renderChatList\(\)\}[\s\S]*\$\{renderChatPanel\(thread\)\}[\s\S]*\$\{state\.chatPreview \? renderChatPreviewPanel\(\) : renderAgentPanel\(thread\)\}/);
  assert.doesNotMatch(leftToggle, /isTradingExpertThreadId/);
  assert.match(modeSwitch, /mode !== "execution"\) tradingExpertThreadIds\.delete\(sourceThreadId\)/);
});

test("Trading Expert workspace switch keeps a forgiving hover path through the drawing toolbar", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const bindingBlock = sourceBlock(
    source,
    'root.querySelectorAll<HTMLElement>("[data-trading-expert-workspace-switch]")',
    'root.querySelector<HTMLElement>(".skills-plaza-page")',
  );
  const switchBlock = sourceBlock(
    styles,
    ".trading-expert-workspace-switch-trigger {",
    ".trading-expert-workspace-switch-trigger:hover:not(:disabled)",
  );
  const bridgeBlock = sourceBlock(
    styles,
    ".trading-expert-workspace-switch-menu::before {",
    ".trading-expert-workspace-switch:hover",
  );

  assert.match(switchBlock, /z-index:\s*5;/);
  assert.match(bridgeBlock, /top:\s*-4px;/);
  assert.match(bridgeBlock, /left:\s*-12px;/);
  assert.match(bridgeBlock, /width:\s*12px;/);
  assert.match(bridgeBlock, /height:\s*calc\(100% \+ 8px\);/);
  assert.match(bridgeBlock, /pointer-events:\s*auto;/);
  assert.match(bindingBlock, /root\.querySelector<HTMLElement>\("\[data-drawing-toolbar\]"\)/);
  assert.match(bindingBlock, /host\.contains\(target\) \|\| drawingToolbar\?\.contains\(target\) === true/);
  assert.match(bindingBlock, /host\.addEventListener\("mouseleave"[\s\S]*event\.relatedTarget[\s\S]*setExpanded\(false\)/);
  assert.match(bindingBlock, /drawingToolbar\?\.addEventListener\("mouseleave"[\s\S]*event\.relatedTarget[\s\S]*setExpanded\(false\)/);
  assert.match(bindingBlock, /host\.classList\.toggle\("menu-open", expanded\)/);
  assert.match(bindingBlock, /event\.key !== "Escape"[\s\S]*setExpanded\(false\)[\s\S]*trigger\.focus/);
  assert.match(styles, /\.trading-expert-workspace-switch\.menu-open\s*> \.trading-expert-workspace-switch-menu\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /\.trading-expert-workspace-switch-trigger\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--surface-hover-translucent\);/s);
  assert.match(styles, /\.trading-expert-workspace-switch-menu\s*\{[\s\S]*background:\s*var\(--surface-glass-strong\);[\s\S]*color:\s*var\(--text-primary\);/);
  assert.match(styles, /\.trading-expert-workspace-switch-option\.active\s*\{[\s\S]*background:\s*var\(--conversation-action-selected\);/);
});

test("Trading Expert message action opens its dedicated two-pane presentation", async () => {
  const source = await mainSource;
  const messageBlock = sourceBlock(source, "async function messageContact", "async function openHaoloContactNewThread");
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const chatPanelBlock = sourceBlock(source, "function renderChatPanel", "function workflowRevisionNodePayload");
  const tradingChatBranch = sourceBlock(
    chatPanelBlock,
    "if (isTradingExpertThreadId(thread.id))",
    "if (isThreadSwitchLoadingState(thread.id))",
  );
  const agentPanelBlock = sourceBlock(source, "function renderAgentPanel", "function renderComposerThreadMentionSearch");
  const tradingAgentPanelBranch = sourceBlock(
    agentPanelBlock,
    "if (thread && isTradingExpertThreadId(threadId))",
    "const localGroupChat",
  );
  const chatListBlock = sourceBlock(source, "function renderChatList", "function isHaoloContact");
  const sidebarActions = sourceBlock(
    source,
    "function renderConversationListActions",
    "function renderChatList",
  );
  const titlebarActions = sourceBlock(
    source,
    "function renderTitlebarPrimaryActions",
    "function renderWindowControls",
  );
  const tradingConversationBlock = sourceBlock(
    source,
    "function renderTradingExpertConversation",
    "function workflowRevisionNodePayload",
  );
  const tradingPanelToggleBlock = sourceBlock(
    source,
    "function tradingExpertPanelToggleLabel",
    "function workflowRevisionNodePayload",
  );
  const panelSyncBlock = sourceBlock(
    source,
    "function syncAgentPanelState",
    "function scheduleWorkflowComposerConnector",
  );
  const panelPatchBlock = sourceBlock(
    source,
    "function patchActiveAgentPanel",
    "function blankNewThreadMembers",
  );

  assert.match(messageBlock, /contact\?\.id === TRADING_EXPERT_CONTACT_ID/);
  assert.match(messageBlock, /await openTradingExpertWorkspace\(\)/);
  assert.match(source, /function initializeTradingExpertTaskThread[\s\S]*tradingExpertThreadIds\.add\(threadId\)/);
  assert.match(renderBlock, /tradingExpertLayout \? "trading-expert-layout" : ""/);
  assert.match(renderBlock, /tradingExpertLayout && state\.tradingExpertChartCollapsed[\s\S]*?\? "trading-expert-chart-collapsed"/);
  assert.match(
    renderBlock,
    /state\.activeView === "chat" && state\.rightCollapsed && !state\.chatPreview\s*\? "right-panel-collapsed"/,
  );
  assert.doesNotMatch(renderBlock, /!state\.chatPreview && !tradingExpertLayout/);
  assert.doesNotMatch(source, /function renderLeftPanelToggle\(\) \{\s*if \(isTradingExpertThreadId\(state\.currentThreadId\)\) return "";/);
  assert.match(renderBlock, /tradingExpertLayout \? renderTradingExpertCollapseControls\(\) : ""/);
  assert.doesNotMatch(renderBlock, /renderBinanceAccountExpansionControl|data-trading-expert-account-expansion/);
  assert.match(tradingChatBranch, /class="chat-panel trading-expert-chat-panel"/);
  assert.doesNotMatch(tradingChatBranch, /renderTradingExpertCollapseControls/);
  assert.match(tradingChatBranch, /\$\{renderTradingExpertMarketWorkspace\(\)\}/);
  assert.doesNotMatch(tradingChatBranch, /renderComposer\(thread\)/);
  assert.doesNotMatch(tradingChatBranch, /renderChatHeader\(thread\)/);
  assert.match(tradingPanelToggleBlock, /return expanded \? "收起会话" : "展开会话"/);
  assert.match(tradingPanelToggleBlock, /function renderTradingExpertConversationHeader\(thread: ConversationSummary\)/);
  assert.match(tradingPanelToggleBlock, /const title = chatHeaderTitle\(thread\) \|\| NEW_THREAD_TITLE/);
  assert.match(tradingPanelToggleBlock, /const conversationExpanded = state\.tradingExpertChartCollapsed && !state\.rightCollapsed/);
  assert.match(tradingPanelToggleBlock, /class="trading-expert-panel-header"[\s\S]*class="trading-expert-panel-title"[\s\S]*data-action="toggle-right-panel"/);
  assert.match(tradingPanelToggleBlock, /data-trading-expert-conversation-expansion/);
  assert.match(tradingPanelToggleBlock, /aria-expanded="\$\{conversationExpanded \? "true" : "false"\}"/);
  assert.match(tradingPanelToggleBlock, /function renderTradingExpertCollapseControls/);
  assert.match(tradingPanelToggleBlock, /class="trading-expert-collapse-controls" role="group" aria-label="K线展开与全屏显示控制"/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-trading-expert-chart"[\s\S]*data-trading-expert-chart-expansion/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-right-panel"/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-right-panel"[\s\S]*renderPanelLayoutIcon\("right"\)/);
  assert.match(tradingPanelToggleBlock, /const chartExpanded = panelCollapsed && !chartCollapsed/);
  assert.match(tradingPanelToggleBlock, /aria-expanded="\$\{chartExpanded \? "true" : "false"\}"/);
  assert.doesNotMatch(tradingPanelToggleBlock, /trading-expert-panel-toggle/);
  assert.match(tradingAgentPanelBranch, /const collapsed = state\.rightCollapsed/);
  assert.match(tradingAgentPanelBranch, /class="agent-panel \$\{collapsed \? "collapsed" : "expanded"\} trading-expert-panel"/);
  assert.match(tradingAgentPanelBranch, /aria-hidden="\$\{collapsed \? "true" : "false"\}"/);
  assert.match(tradingAgentPanelBranch, /aria-label="交易专家任务会话"/);
  assert.match(tradingAgentPanelBranch, /renderTradingExpertConversationHeader\(thread\)[\s\S]*renderTradingExpertConversationPanel\(thread\)/);
  assert.doesNotMatch(tradingAgentPanelBranch, /<h2>/);
  assert.doesNotMatch(tradingAgentPanelBranch, /renderTradingExpertChartToggle|trading-expert-chart-toggle/);
  assert.match(tradingAgentPanelBranch, /renderTradingExpertConversationPanel\(thread\)/);
  assert.match(tradingAgentPanelBranch, /renderComposer\(thread\)/);
  assert.match(chatListBlock, /<aside class="chat-list trading-expert-task-list">/);
  assert.match(chatListBlock, /<div class="conversation-list-body">[\s\S]*\$\{renderConversationListActions\(\)\}/);
  assert.match(chatListBlock, /\$\{renderUpdateDownloadDock\(\)\}[\s\S]*\$\{renderConversationListFooter\(\)\}/);
  assert.doesNotMatch(chatListBlock, /isTradingExpertThreadId\(state\.currentThreadId\)/);
  assert.match(sidebarActions, /data-conversation-static-action="account"[\s\S]*>账户<\/span>/);
  assert.match(sidebarActions, /data-conversation-static-action="plans"[\s\S]*>计划<\/span>/);
  assert.match(sidebarActions, /data-conversation-static-action="skills"[\s\S]*>策略<\/span>/);
  assert.match(sidebarActions, /renderConversationListIcon\("account"\)[\s\S]*renderConversationListIcon\("plans"\)[\s\S]*renderConversationListIcon\("skills"\)/);
  assert.doesNotMatch(sidebarActions, /data-conversation-static-action="knowledge"|renderConversationListIcon\("knowledge"\)|>知识库<\/span>/);
  assert.doesNotMatch(sidebarActions, /data-trading-expert-panel-tab|role="tab"|aria-selected/);
  assert.match(titlebarActions, /toggle-external-channel-menu[\s\S]*renderTitlebarPlugIcon\(\)/);
  assert.match(titlebarActions, /open-auto-task-dialog[\s\S]*renderTitlebarAlarmIcon\(\)/);
  assert.ok(titlebarActions.indexOf("toggle-external-channel-menu") < titlebarActions.indexOf("open-auto-task-dialog"));
  assert.doesNotMatch(titlebarActions, /自动化|open-auto-tasks|>连接<|data-action="open-settings"|>设置<|>任务<\/button>|renderConversationListIcon/);
  assert.match(source, /class="titlebar-drag-region">[\s\S]*class="titlebar-market-favorites-host" data-titlebar-market-favorites-host/);
  assert.doesNotMatch(source, /trading-expert-task-refresh|data-trading-expert-task-refresh|refreshTradingExpertTask/);
  assert.doesNotMatch(source, /TradingExpertPanelTab|tradingExpertPanelTab|renderTradingExpertPanelTabs|bindTradingExpertPanelTabEvents/);
  assert.match(tradingConversationBlock, /id="messageScroller"/);
  assert.match(tradingConversationBlock, /renderMessageScrollerContent\(thread\)/);
  assert.match(tradingConversationBlock, /renderMessageScrollBottomButton\(\)/);
  assert.match(
    panelPatchBlock,
    /isTradingExpertThreadId\(threadId\)[\s\S]*scroller\?\.dataset\.threadId === threadId[\s\S]*return true/,
  );
  assert.match(
    source,
    /\[data-action="toggle-right-panel"\][\s\S]*state\.rightCollapsed = !state\.rightCollapsed;[\s\S]*syncAgentPanelState\(\)/,
  );
  assert.match(panelSyncBlock, /classList\.toggle\("right-panel-collapsed", collapsed\)/);
  assert.match(panelSyncBlock, /isTradingExpertThreadId\(state\.currentThreadId\)/);
  assert.match(panelSyncBlock, /tradingExpertChartToggleLabel\(collapsed\)/);
  assert.match(panelSyncBlock, /syncTradingExpertCollapseControlsState\(\)/);
  assert.match(tradingPanelToggleBlock, /querySelectorAll<HTMLButtonElement>\("\[data-trading-expert-chart-expansion\]"\)/);
  assert.match(tradingPanelToggleBlock, /querySelectorAll<HTMLButtonElement>\("\[data-trading-expert-conversation-expansion\]"\)/);
  assert.match(tradingPanelToggleBlock, /conversationButtons\.forEach\(\(panelButton\)/);
  assert.match(tradingPanelToggleBlock, /button\.innerHTML = renderPanelLayoutIcon\(side\)/);
  assert.match(tradingPanelToggleBlock, /return expanded \? "收起K线画布" : "展开K线画布"/);
  assert.doesNotMatch(tradingPanelToggleBlock, /收起账户页|展开账户页|data-trading-expert-account-expansion|accountButtons/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-trading-expert-chart"/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-trading-expert-chart"[\s\S]*renderPanelLayoutIcon\("left"\)/);
  assert.doesNotMatch(source, /function renderCollapseChevronIcon|collapse-chevron-icon/);
  assert.match(source, /data-action="toggle-left-panel"[\s\S]*renderPanelLayoutIcon\("left"\)/);
  assert.match(
    source,
    /\[data-action="toggle-trading-expert-chart"\][\s\S]*state\.tradingExpertChartCollapsed[\s\S]*state\.rightCollapsed = !state\.rightCollapsed;[\s\S]*syncAgentPanelState\(\)/,
  );
  assert.doesNotMatch(source, /data-trading-expert-account-expansion|accountExpansion/);
  assert.match(
    source,
    /button\.hasAttribute\("data-trading-expert-conversation-expansion"\)[\s\S]*state\.tradingExpertChartCollapsed = !state\.tradingExpertChartCollapsed;[\s\S]*render\(\)/,
  );
  assert.doesNotMatch(source, /function renderTradingExpert(?:Panel|Chart)Toggle/);
});

test("Trading Expert chart focus mode fills the workspace and restores the exact prior layout", async () => {
  const [source, styles] = await Promise.all([mainSource, stylesSource]);
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const focusBlock = sourceBlock(
    source,
    "function tradingExpertChartFocusToggleLabel",
    "function renderTradingExpertCollapseControls",
  );
  const controlsBlock = sourceBlock(
    source,
    "function renderTradingExpertCollapseControls",
    "function renderTradingExpertConversation",
  );
  const bindingBlock = sourceBlock(
    source,
    '.querySelectorAll<HTMLButtonElement>(\'[data-action="toggle-right-panel"]\')',
    '.querySelector<HTMLInputElement>("#localGroupChatMemberSearch")',
  );
  const leftToggleBlock = sourceBlock(
    source,
    "function toggleLeftPanelCollapsed",
    "function renderMaximizeIcon",
  );

  assert.match(source, /tradingExpertChartFocusMode: boolean/);
  assert.match(source, /tradingExpertChartFocusMode: false/);
  assert.match(renderBlock, /tradingExpertChartFocusMode \? "trading-expert-chart-focus-mode" : ""/);
  assert.match(
    renderBlock,
    /!tradingExpertLayout && state\.tradingExpertChartFocusMode[\s\S]*restoreTradingExpertChartFocusLayout\(\)/,
  );
  assert.match(focusBlock, /return active \? "退出K线全屏" : "K线全屏"/);
  assert.match(focusBlock, /trading-expert-chart-focus-icon[\s\S]*M10 10L4 4/);
  assert.match(focusBlock, /trading-expert-chart-focus-icon[\s\S]*M4 4l6 6/);
  assert.match(
    focusBlock,
    /tradingExpertChartFocusRestoreState = \{[\s\S]*leftCollapsed: state\.leftCollapsed,[\s\S]*rightCollapsed: state\.rightCollapsed,[\s\S]*chartCollapsed: state\.tradingExpertChartCollapsed/,
  );
  assert.match(
    focusBlock,
    /state\.tradingExpertChartFocusMode = true;[\s\S]*state\.leftCollapsed = true;[\s\S]*state\.rightCollapsed = true;[\s\S]*state\.tradingExpertChartCollapsed = false/,
  );
  assert.match(
    focusBlock,
    /state\.leftCollapsed = restore\.leftCollapsed;[\s\S]*state\.rightCollapsed = restore\.rightCollapsed;[\s\S]*state\.tradingExpertChartCollapsed = restore\.chartCollapsed/,
  );
  assert.match(
    focusBlock,
    /isTradingExpertConversationCollapseLocked\(state\.currentThreadId\)[\s\S]*syncTradingExpertCollapseControlsState\(\)[\s\S]*return/,
  );
  assert.match(
    controlsBlock,
    /data-action="toggle-trading-expert-chart-focus"[\s\S]*aria-pressed="\$\{focusMode \? "true" : "false"\}"/,
  );
  assert.match(controlsBlock, /分析进行中，暂不可进入K线全屏/);
  assert.match(controlsBlock, /focusButton\.hidden = chartCollapsed && !focusMode/);
  assert.match(
    bindingBlock,
    /\[data-action="toggle-trading-expert-chart-focus"\][\s\S]*toggleTradingExpertChartFocusMode\(\)/,
  );
  assert.match(
    leftToggleBlock,
    /state\.tradingExpertChartFocusMode[\s\S]*restoreTradingExpertChartFocusLayout\(\);[\s\S]*state\.leftCollapsed = false/,
  );
  assert.match(
    bindingBlock,
    /\[data-action="toggle-trading-expert-chart"\][\s\S]*state\.tradingExpertChartFocusMode[\s\S]*restoreTradingExpertChartFocusLayout\(\);[\s\S]*state\.tradingExpertChartCollapsed = false;[\s\S]*state\.rightCollapsed = false;[\s\S]*render\(\)/,
  );
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout\.trading-expert-chart-focus-mode[\s\S]*> \.trading-expert-resize-handle\s*\{\s*display: none;/s,
  );
  assert.doesNotMatch(styles, /\.trading-expert-chart-focus-mode[^{}]*\.left-panel-toggle[^{}]*\{[^}]*display: none;/s);
  assert.doesNotMatch(styles, /\.trading-expert-chart-focus-mode[^{}]*\.trading-expert-chart-toggle[^{}]*\{[^}]*display: none;/s);
  assert.match(styles, /\.trading-expert-chart-focus-icon\s*\{[^}]*width: 14px;[^}]*height: 14px;[^}]*stroke: currentColor;[^}]*stroke-width: 1\.55;/s);
  assert.match(styles, /\.trading-expert-chart-focus-toggle\[aria-pressed="true"\]\s*\{[^}]*color: var\(--text-tertiary\);/s);
  assert.match(styles, /\[data-action="toggle-trading-expert-chart-focus"\][\s\S]*:hover:not\(:disabled\),[\s\S]*:focus-visible[\s\S]*color: var\(--text-secondary\);/s);
  assert.match(styles, /\[data-action="toggle-trading-expert-chart-focus"\][\s\S]*:active:not\(:disabled\)[\s\S]*background: var\(--surface-active-translucent\);/s);
  assert.match(styles, /\[data-action="toggle-trading-expert-chart-focus"\][\s\S]*:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
});

test("collapsed Trading Expert progress cannot replace the restore control mid-click", async () => {
  const source = await mainSource;
  const pointerBlock = sourceBlock(
    source,
    "function wirePointerTracking",
    "function wireComposerFileDrop",
  );
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const surfaceBlock = sourceBlock(
    source,
    "function patchActiveChatSurfaces",
    "function canInterruptThread",
  );
  const bindingBlock = sourceBlock(
    source,
    '.querySelectorAll<HTMLButtonElement>(\'[data-action="toggle-right-panel"]\')',
    '.querySelector<HTMLInputElement>("#localGroupChatMemberSearch")',
  );

  assert.match(
    pointerBlock,
    /\.trading-expert-layout \[data-action="toggle-left-panel"\][\s\S]*?\.trading-expert-layout \[data-action="toggle-right-panel"\][\s\S]*?\.trading-expert-layout \[data-action="toggle-trading-expert-chart"\]/,
  );
  assert.match(pointerBlock, /tradingExpertLayoutControlPointerActive = true/);
  assert.match(pointerBlock, /finishTradingExpertLayoutControlPointerInteraction/);
  assert.match(
    pointerBlock,
    /"blur",[\s\S]*?finishTradingExpertLayoutControlPointerInteraction\(\)/,
  );
  assert.match(
    renderBlock,
    /if \(tradingExpertLayoutControlPointerActive\) \{\s*tradingExpertLayoutControlRenderPending = true;\s*return;/,
  );
  assert.match(
    surfaceBlock,
    /const bufferCollapsedTradingExpertConversation = canBufferCollapsedTradingExpertConversation\(threadId\)/,
  );
  assert.match(
    surfaceBlock,
    /if \(!bufferCollapsedTradingExpertConversation\) \{[\s\S]*?updateActiveMessageScroller\(\)[\s\S]*?patchActiveAgentPanel\(threadId\)[\s\S]*?patchComposerDynamicState\(threadId\)/,
  );
  assert.match(
    surfaceBlock,
    /function canBufferCollapsedTradingExpertConversation[\s\S]*?state\.rightCollapsed[\s\S]*?isTradingExpertThreadId\(threadId\)[\s\S]*?scroller\?\.dataset\.threadId === threadId[\s\S]*?expandButton/,
  );
  assert.match(
    surfaceBlock,
    /function shouldKeepChatSurfaceUpdateLocal[\s\S]*?isTradingExpertThreadId\(threadId\)[\s\S]*?\|\| !state\.rightCollapsed/,
  );
  assert.ok(
    bindingBlock.match(/finishTradingExpertLayoutControlPointerInteraction\(false\)/g)?.length >= 2,
    "both Trading Expert layout controls must release the pointer guard in their click handlers",
  );
  assert.match(
    bindingBlock,
    /state\.rightCollapsed = !state\.rightCollapsed;[\s\S]*?syncAgentPanelState\(\);[\s\S]*?!state\.rightCollapsed[\s\S]*?patchActiveChatSurfaces\(state\.currentThreadId, \{ patchThreadRow: true \}\)/,
  );
});

test("Trading Expert hides and hard-locks chart expansion until analysis reaches a terminal state", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const lockBlock = sourceBlock(
    source,
    "function isTradingExpertConversationCollapseLocked",
    "function isConversationThreadWorking",
  );
  const headerBlock = sourceBlock(
    source,
    "function renderTradingExpertConversationHeader",
    "function renderTradingExpertConversationPanel",
  );
  const controlsBlock = sourceBlock(
    source,
    "function renderTradingExpertCollapseControls",
    "function renderTradingExpertConversation",
  );
  const busyBlock = sourceBlock(
    source,
    "function setCodexThreadBusy",
    "function attachTurnIdToLatestOptimisticUserItem",
  );
  const bindingBlock = sourceBlock(
    source,
    '.querySelectorAll<HTMLButtonElement>(\'[data-action="toggle-right-panel"]\')',
    '.querySelector<HTMLInputElement>("#localGroupChatMemberSearch")',
  );
  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(lockBlock, /submittingComposerThreadIds\.has\(threadId\)/);
  assert.match(lockBlock, /tradingExpertThinkingStateByThreadId\.has\(threadId\)/);
  assert.match(lockBlock, /isThreadBusy\(threadId\)/);
  assert.match(headerBlock, /data-trading-expert-conversation-expansion/);
  assert.doesNotMatch(headerBlock, /isTradingExpertConversationCollapseLocked/);
  assert.match(controlsBlock, /chartExpansionLocked = !chartExpanded && isTradingExpertConversationCollapseLocked\(state\.currentThreadId\)/);
  assert.match(controlsBlock, /chartButton\.hidden = chartCollapsed \|\| chartExpansionLocked/);
  assert.match(controlsBlock, /chartButton\.removeAttribute\("aria-hidden"\)/);
  assert.match(
    busyBlock,
    /threadId === state\.currentThreadId && isTradingExpertThreadId\(threadId\)[\s\S]*syncTradingExpertCollapseControlsState\(\)/,
  );
  assert.match(
    styles,
    /\.trading-expert-panel-header-toggle\[hidden\],[\s\S]*\.trading-expert-chart-toggle\[hidden\][\s\S]*display:\s*none !important/,
  );
  assert.match(
    bindingBlock,
    /\[data-action="toggle-trading-expert-chart"\][\s\S]*!state\.rightCollapsed[\s\S]*isTradingExpertConversationCollapseLocked\(state\.currentThreadId\)[\s\S]*return;[\s\S]*state\.rightCollapsed = !state\.rightCollapsed/,
  );
  assert.match(
    sendBlock,
    /submittingComposerThreadIds\.delete\(originalThreadId\);[\s\S]*submittingComposerThreadIds\.delete\(threadId\);[\s\S]*syncTradingExpertCollapseControlsState\(\)/,
  );
});

test("Trading Expert keeps its identity while unselected tasks migrate into the single recent project", async () => {
  const source = await mainSource;
  const sendBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  const replacementBlock = sourceBlock(
    source,
    "function adoptReplacementCodexThread",
    "async function sendAgentText",
  );
  const identityBlock = sourceBlock(
    source,
    "function isTradingExpertThreadId",
    "function providerFromThreadId",
  );
  const preferenceBlock = sourceBlock(
    source,
    "function loadThreadPreferences",
    "function emptyThreadPreferences",
  );

  assert.match(
    sendBlock,
    /const composerGroupIdForSend = groupIdForThreadContext\(threadId\);[\s\S]*commitSelectedNewThreadGroupForSend\(threadId, composerGroupIdForSend\)/,
  );
  assert.match(replacementBlock, /tradingExpertThreadIds\.delete\(previousThreadId\)/);
  assert.match(replacementBlock, /tradingExpertThreadIds\.add\(nextThreadId\)/);
  assert.match(replacementBlock, /threadGroupByThreadId\[nextThreadId\] = oldGroupId/);
  assert.match(identityBlock, /threadGroupByThreadId\[threadId\]/);
  assert.match(identityBlock, /newThreadModeByThreadId\.get\(threadId\) === "execution"/);
  assert.match(identityBlock, /name\.trim\(\) === TRADING_EXPERT_NAME/);
  assert.match(preferenceBlock, /migrateLegacyRecentThreadGroupPreferences/);
  assert.match(preferenceBlock, /legacyTradingGroupName: TRADING_EXPERT_NAME/);
  assert.match(preferenceBlock, /threadModes: normalizedThreadModes/);
  assert.match(preferenceBlock, /recentAliasIds\.has\(groupId\) \? DEFAULT_THREAD_GROUP_ID : groupId/);
  assert.doesNotMatch(source, /ensureTradingExpertThreadGroup|TRADING_EXPERT_GROUP_DISPLAY_NAME|历史任务/);
});

test("Trading Expert starts with a clean conversation pane without hero or model aurora", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const scrollerBlock = sourceBlock(
    source,
    "function renderMessageScrollerContent",
    "function updateActiveMessageScroller",
  );
  const auroraBlock = sourceBlock(
    source,
    "function renderComposerModelAurora",
    "function dismissComposerModelAuroraAfterScroll",
  );

  assert.match(
    scrollerBlock,
    /!isTradingExpertThreadId\(thread\.id\)[\s\S]*shouldRenderBlankThreadHero\(thread\.id\)/,
  );
  assert.match(
    scrollerBlock,
    /const emptyContent = isTradingExpertThreadId\(thread\.id\)[\s\S]*\? ""/,
  );
  assert.match(auroraBlock, /if \(isTradingExpertThreadId\(threadId\)\) return "";/);
  assert.match(
    styles,
    /\.trading-expert-message-scroller > \.new-thread-hero,[\s\S]*?> \.composer-model-aurora\s*\{\s*display: none;/,
  );
  assert.doesNotMatch(
    styles,
    /html\[data-theme="dark"\][^{]*(?:\.new-thread-hero|\.composer-model-aurora)[^{]*\{[^}]*display:\s*(?:block|flex|grid)/s,
  );
});

test("Trading Expert keeps Sol as the default and exposes media models in the expanded conversation", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const desktopMain = await desktopMainSource;
  const catalog = [
    { value: "gpt-5.6-terra" },
    { value: "deepseek-v4-flash" },
    { value: "image2" },
    { value: "gpt-5.6-sol" },
    { value: "gpt-5.5" },
  ];

  assert.deepEqual(TRADING_EXPERT_MODEL_VALUES, [
    "gpt-5.6-sol",
    "deepseek-v4-flash",
  ]);
  assert.equal(TRADING_EXPERT_DEFAULT_MODEL_VALUE, "gpt-5.6-sol");
  assert.equal(TRADING_EXPERT_REASONING_EFFORT, "ultra");
  assert.equal(TRADING_EXPERT_DEEPSEEK_REASONING_EFFORT, "max");
  assert.equal(tradingExpertReasoningEffort("gpt-5.6-sol"), "ultra");
  assert.equal(tradingExpertReasoningEffort("deepseek-v4-flash"), "max");
  assert.deepEqual(
    tradingExpertModelOptions(catalog).map((option) => option.value),
    ["gpt-5.6-sol", "deepseek-v4-flash"],
  );
  assert.equal(
    defaultTradingExpertModelOption(catalog)?.value,
    TRADING_EXPERT_DEFAULT_MODEL_VALUE,
  );

  const selectedRequestOptions = sourceBlock(
    source,
    "function tradingExpertSelectedModelRequestOptions",
    "function selectedChatModelRequestOptions",
  );
  const requestOptions = sourceBlock(
    source,
    "function selectedChatModelRequestOptions",
    "function selectedChatModelReasoningEffortsForRequest",
  );
  const reasoningOptions = sourceBlock(
    source,
    "function selectedChatModelReasoningEffortsForRequest",
    "function codexToolExecutionModelRequestOptions",
  );
  const composer = sourceBlock(
    source,
    "function renderComposer(thread",
    "function renderVideoExpertComposer",
  );
  const openWorkspace = sourceBlock(
    source,
    "async function openTradingExpertWorkspace",
    "async function openHaoloContactNewThread",
  );
  const initializeWorkspace = sourceBlock(
    source,
    "function initializeTradingExpertTaskThread",
    "function providerFromThreadId",
  );
  const conversationMode = sourceBlock(
    source,
    "function newThreadModeForThread",
    "function isMediaCreationMode",
  );
  const lockedModel = sourceBlock(
    source,
    "function lockedExecutionModelForThread",
    "type ExecutionModelFamily",
  );
  const selectModel = sourceBlock(
    source,
    "function selectChatModelForThread",
    "function isThreadModelSelectionLocked",
  );

  assert.match(
    selectedRequestOptions,
    /const model = firstString\([\s\S]*selectedSettings\?\.model,[\s\S]*knownSettings\?\.model,[\s\S]*selected\.value,[\s\S]*TRADING_EXPERT_DEFAULT_MODEL_VALUE/,
  );
  assert.match(
    selectedRequestOptions,
    /modelProvider,[\s\S]*model,[\s\S]*reasoningEffort: tradingExpertReasoningEffort\(model\),[\s\S]*reasoningEffortPolicy: "fixed"/,
  );
  assert.match(
    selectedRequestOptions,
    /model\.toLowerCase\(\) === DEEPSEEK_EXECUTION_MODEL_VALUE[\s\S]*\? DEEPSEEK_EXECUTION_PROVIDER_ID[\s\S]*: selectedModelProvider/,
  );
  assert.match(
    requestOptions,
    /isTradingExpertExecutionThreadId\(threadId\)\)[\s\S]*return tradingExpertSelectedModelRequestOptions\(threadId\)/,
  );
  assert.match(
    reasoningOptions,
    /isTradingExpertExecutionThreadId\(threadId\)\)[\s\S]*tradingExpertSelectedModelRequestOptions\(threadId\)\.reasoningEffort/,
  );
  assert.match(
    composer,
    /const groupPicker = showEditableGroupPicker[\s\S]*renderNewThreadGroupPicker\(thread\.id\)/,
  );
  assert.match(
    composer,
    /const composerTrailingPicker = multiAgentMode \|\| \(tradingExpertMode && !usesUnifiedExecutionModelPicker\(thread\.id\)\)[\s\S]*\? ""[\s\S]*: renderComposerModelPicker\(thread\.id\)/,
  );
  assert.doesNotMatch(
    styles,
    /> \.composer\s*> \.composer-(?:context-group|model)-picker\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    styles,
    /> \.composer[\s\S]*?\.composer-mode-picker\s*\{\s*display: none;/,
  );
  assert.match(
    openWorkspace,
    /initializeTradingExpertTaskThread\(threadId, \{ expandPanel: true \}\)/,
  );
  assert.match(
    initializeWorkspace,
    /newThreadModeByThreadId\.set\(threadId, "execution"\)[\s\S]*if \(!isTradingExpertModelValue\(existingModel\)\)[\s\S]*modelProvider: DEFAULT_EXECUTION_MODEL_PROVIDER_ID[\s\S]*model: TRADING_EXPERT_DEFAULT_MODEL_VALUE[\s\S]*reasoningEffort: TRADING_EXPERT_REASONING_EFFORT/,
  );
  assert.match(
    lockedModel,
    /isTradingExpertThreadId\(id\) \|\|[\s\S]*return null/,
  );
  assert.match(
    selectModel,
    /if \(id && isTradingExpertThreadId\(id\)\)[\s\S]*rememberThreadModelSelection\(id, desiredSettings,[\s\S]*persist: !isBlankNewThread\(id\) && !isLocalBlankThreadId\(id\)/,
  );
  assert.match(
    conversationMode,
    /isTradingExpertThreadId\(threadId\)\) return isMediaCreationMode\(mode\) \? mode : "execution"/,
  );
  assert.match(
    desktopMain,
    /reasoningEffortPolicy \|\| params\.reasoning_effort_policy[\s\S]*=== "fixed"[\s\S]*requestedReasoningEffort\(params\)/,
  );
  assert.match(
    desktopMain,
    /\[HAOLO_REASONING_FIXED_EFFORT_FIELD\]: fixedReasoningEffort/,
  );
});

test("Trading Expert layout keeps the conversation independent and covers light and dark surfaces", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const market = await marketSource;
  const renderMessageBlock = sourceBlock(
    source,
    "function renderMessage(message: Message",
    "function messageRenderSignature",
  );
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");

  assert.match(styles, /--trading-expert-left-panel-min-width:\s*192px;/);
  assert.match(styles, /--trading-expert-panel-min-width:\s*300px;/);
  assert.match(styles, /--trading-expert-panel-width:\s*var\(--trading-expert-panel-min-width\);/);
  assert.doesNotMatch(styles, /\.desktop-body\.trading-expert-layout > \.chat-list\s*\{\s*display: none;/);
  assert.match(styles, /> \.trading-expert-chat-panel\s*\{[^}]*flex: 1 1 auto;[^}]*overflow: visible;[^}]*background: #ffffff;/s);
  assert.match(styles, /> \.trading-expert-panel\s*\{[^}]*flex: 0 0 var\(--trading-expert-panel-width\);[^}]*background: #ffffff;/s);
  assert.match(styles, /> \.trading-expert-panel:has\([\s\S]*?\.trading-expert-mention-popover:not\(\.hidden\)[\s\S]*?\)\s*\{[^}]*z-index: 70;[^}]*overflow: visible;/s);
  assert.match(styles, /--trading-expert-panel-divider: #e3e8ef;/);
  assert.match(styles, /\.chat-list\.trading-expert-task-list\s*\{[^}]*--trading-expert-panel-divider: #e3e8ef;[^}]*border-right: 0;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.chat-list\.trading-expert-task-list\s*\{[^}]*--trading-expert-panel-divider: #1a2437;/s);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*height: 36\.4px;[^}]*border-bottom: 0;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\s*> \.trading-expert-panel\s+\.trading-expert-panel-header\s*\{[^}]*display: grid;[^}]*height: 36\.4px;[^}]*flex: 0 0 36\.4px;[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*border-bottom: 0;[^}]*background: inherit;[^}]*padding: 0 14px;/s);
  assert.match(styles, /\.trading-expert-panel-title\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(styles, /\.trading-expert-panel-heading\s*\{[^}]*display: grid;[^}]*height: 100%;[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*grid-template-rows: 1fr;/s);
  assert.match(styles, /\.trading-expert-panel-heading > \*\s*\{[^}]*position: static;[^}]*grid-row: 1;[^}]*align-self: center;/s);
  assert.match(styles, /\.trading-expert-panel-header-toggle\s*\{[^}]*width: 24px;[^}]*height: 26px;[^}]*justify-self: end;[^}]*border-radius: 7px;[^}]*background: transparent;/s);
  assert.doesNotMatch(styles, /trading-expert-panel-tabs|trading-expert-panel-tab-cell|trading-expert-sidebar-category/);
  assert.match(styles, /\.titlebar-primary-actions\s*\{[^}]*display: flex;[^}]*height: 100%;[^}]*gap: 2px;[^}]*margin-left: -17px;/s);
  assert.match(styles, /\.titlebar-primary-action\s*\{[^}]*height: 30px;[^}]*border-radius: 16px;[^}]*background: transparent;[^}]*font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.titlebar-primary-action:hover:not\(:disabled\),[\s\S]*?\.titlebar-more-action\.menu-open > \.titlebar-primary-action,[\s\S]*?\.titlebar-primary-action:is\(\.active, :active\):not\(:disabled\)\s*\{[^}]*background: transparent;/s);
  assert.doesNotMatch(styles, /\.titlebar-primary-action\s*\{[^}]*transition:[^;}]*background/s);
  assert.match(styles, /\.titlebar-primary-action:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.titlebar-primary-action:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.58;/s);
  assert.match(styles, /\.chat-list\.trading-expert-task-list \.conversation-list-body\s*\{[^}]*padding-top: 8px;/s);
  assert.match(styles, /\.titlebar-more-menu-overlay\s*\{[^}]*top: 100%;[^}]*z-index: 90;[^}]*display: none;[^}]*width: 164px;[^}]*padding-top: 5px;/s);
  assert.match(styles, /\.titlebar-more-action\.menu-open > \.titlebar-more-menu-overlay\s*\{[^}]*display: block;/s);
  assert.match(styles, /\.app-titlebar\s*\{[^}]*z-index: 100;[^}]*background: var\(--app-chrome-background\);[^}]*border-bottom: 0;[^}]*overflow: visible;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.app-titlebar\s*\{[^}]*border-bottom: 0;/s);
  assert.match(styles, /\.chat-list\s*\{[^}]*background: var\(--app-chrome-background\);[^}]*backdrop-filter: none;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.chat-list\s*\{[^}]*background: var\(--app-chrome-background\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.desktop-body:has\(> \.chat-panel\) > \.chat-list\s*\{[^}]*background: var\(--app-chrome-background\);/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\s*\{[^}]*background: var\(--app-chrome-background\);/s);
  assert.match(styles, /> \.trading-expert-chat-panel\s*\{[^}]*border-radius: 16px 0 0 0;/s);
  assert.match(styles, /> \.trading-expert-chat-panel[\s\S]*?> \.trading-expert-market\s*\{[^}]*border-right: 0;/s);
  assert.match(styles, /> \.trading-expert-chat-panel[\s\S]*?> \.trading-expert-market\s*\{[^}]*border-top-left-radius: inherit;/s);
  assert.match(styles, /> \.trading-expert-panel\s*\{[^}]*border-left-color: var\(--trading-expert-panel-divider\);/s);
  assert.doesNotMatch(styles, /trading-expert-task-refresh/);
  assert.match(styles, /> \.trading-expert-collapse-controls\s*\{[^}]*position: absolute;[^}]*top: 4px;[^}]*right: calc\(var\(--trading-expert-panel-width\) \+ 5px\);[^}]*left: auto;[^}]*z-index: 60;[^}]*display: flex;[^}]*gap: 2px;[^}]*height: 26px;[^}]*background: transparent;/s);
  assert.match(styles, /> \.trading-expert-collapse-controls[\s\S]*?> \.trading-expert-collapse-button\s*\{[^}]*position: static;[^}]*left: auto;[^}]*width: 24px;[^}]*height: 26px;[^}]*border-radius: 7px;[^}]*background: transparent;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout:has\(\.trading-expert-market\.split-layout-active\)[\s\S]*?> \.trading-expert-collapse-controls\s*\{\s*display: none;/s);
  assert.match(market, /class="small-icon-button panel-toggle trading-market-split-panel-restore expanded"[\s\S]*?data-action="toggle-right-panel"[\s\S]*?aria-label="收起K线画布"/);
  assert.match(styles, /\.trading-market-split-panel-restore\s*\{[^}]*display: none;[^}]*width: 24px;[^}]*height: 26px;[^}]*border-radius: 7px;[^}]*background: transparent;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\.right-panel-collapsed[\s\S]*?\.trading-expert-market\.split-layout-active[\s\S]*?\.trading-market-primary-pane[\s\S]*?\.trading-market-split-panel-restore\s*\{\s*display: inline-flex;/s);
  assert.match(styles, /\.trading-market-split-panel-restore:hover:not\(:disabled\),[\s\S]*?\.trading-market-split-panel-restore:focus-visible\s*\{[^}]*background: var\(--surface-hover-translucent\);/s);
  assert.match(styles, /\.trading-market-split-panel-restore:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 2px var\(--conversation-action-focus\);/s);
  assert.doesNotMatch(styles, /> \.trading-expert-panel-toggle/);
  assert.doesNotMatch(styles, /\.trading-expert-layout\.right-panel-collapsed[\s\S]*?> \.trading-expert-chart-toggle\s*\{\s*display: none;/s);
  assert.match(styles, /\.trading-expert-layout\.trading-expert-chart-collapsed[\s\S]*?> \.trading-expert-collapse-controls\s*\{\s*display: none;/s);
  assert.doesNotMatch(styles, /\.trading-expert-collapse-controls\s*\{[^}]*border:/s);
  assert.doesNotMatch(styles, /> \.trading-expert-collapse-button\s*\+ \.trading-expert-collapse-button/);
  assert.doesNotMatch(styles, /\.collapse-chevron-icon\s*\{/);
  assert.match(styles, /\.panel-layout-icon\s*\{[^}]*width: 13\.5px;[^}]*height: 12px;[^}]*stroke: currentColor;[^}]*stroke-width: 1\.65;/s);
  assert.match(styles, /\.trading-expert-collapse-button:hover:not\(:disabled\),[\s\S]*\.trading-expert-collapse-button:focus-visible\s*\{[^}]*background: var\(--surface-hover-translucent\);/s);
  assert.match(styles, /\.trading-expert-collapse-button:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 2px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.trading-expert-layout\.right-panel-collapsed:not\(\.trading-expert-chart-collapsed\)[\s\S]*?> \.trading-expert-collapse-controls\s*\{[^}]*right: 5px;/s);
  assert.doesNotMatch(styles, /\.trading-expert-chart-collapsed[\s\S]*?> \.trading-expert-collapse-controls\s*\{[^}]*left:/s);
  assert.match(renderBlock, /tradingExpertLayout \? "trading-expert-shell" : ""/);
  assert.match(styles, /\.app-titlebar\s*\{[^}]*height: 38px;/s);
  assert.match(styles, /\.small-icon-button\s*\{[^}]*height: 26px;/s);
  assert.match(styles, /\.desktop-body > \.left-panel-toggle\s*\{[^}]*top: 4px;[^}]*left: calc\(var\(--conversation-list-width\) \+ 4px\);[^}]*z-index: 70;[^}]*left 0\.24s ease,/s);
  assert.match(styles, /\.desktop-body\.left-panel-collapsed > \.left-panel-toggle\s*\{[^}]*left: 4px;/s);
  assert.match(styles, /\.desktop-body > \.left-panel-toggle:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 2px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.app-titlebar\s*\{[^}]*padding: 0 0 0 15px;/s);
  assert.match(styles, /\.app-titlebar > \.titlebar-left-panel-toggle\s*\{[^}]*margin-left: -7px;[^}]*margin-right: -1px;/s);
  assert.match(styles, /\.titlebar-profile\s*\{[^}]*transform: none;/s);
  assert.match(styles, /\.profile-menu\s*\{[^}]*left: 15px;/s);
  assert.doesNotMatch(styles, /\.desktop-shell\.trading-expert-shell \.titlebar-profile/);
  assert.match(styles, /\.desktop-body\.trading-expert-layout \.trading-market-content > \.trading-market-overview\s*\{[^}]*padding-right: 64px;[^}]*padding-left: 0;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout \.trading-market-symbol-wrap\s*\{[^}]*margin-left: 0;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\.left-panel-collapsed:not\(\.trading-expert-chart-collapsed\)[\s\S]*?\.trading-market-content > \.trading-market-overview\s*\{[^}]*width: calc\(100% \+ 41\.6px\);[^}]*margin-left: -41\.6px;[^}]*padding-left: 36px;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\.trading-expert-chart-collapsed\s*> \.trading-expert-chat-panel\s*\{\s*display: none;/s);
  assert.doesNotMatch(styles, /binance-account-page-expansion-toggle/);
  assert.match(styles, /\.trading-expert-chart-collapsed:not\(\.right-panel-collapsed\)[\s\S]*?> \.trading-expert-panel\s*\{[^}]*width: auto;[^}]*max-width: none;[^}]*flex: 1 1 auto;[^}]*border-top-left-radius: 16px;/s);
  assert.match(styles, /\.trading-expert-layout\.trading-expert-chart-collapsed[\s\S]*?> \.trading-expert-panel[\s\S]*?\.trading-expert-panel-header\s*\{[^}]*padding-left: 44px;/s);
  assert.match(styles, /\.desktop-body\.right-panel-collapsed > \.agent-panel\.collapsed\s*\{\s*display: none;/s);
  assert.match(styles, /\.panel-toggle:is\([\s\S]*?\[data-action="toggle-trading-expert-chart"\][\s\S]*?\)\s*\{[^}]*color: var\(--text-placeholder\);/s);
  assert.match(styles, /\.panel-toggle:is\([\s\S]*?\[data-action="toggle-trading-expert-chart"\][\s\S]*?\)\[aria-expanded="true"\]\s*\{[^}]*color: var\(--text-tertiary\);/s);
  assert.match(styles, /\[data-action="toggle-trading-expert-chart"\][\s\S]*?:hover:not\(:disabled\),[\s\S]*?:focus-visible\s*\{[^}]*color: var\(--text-secondary\);/s);
  assert.match(styles, /\.panel-toggle:is\([\s\S]*?\[data-action="toggle-right-panel"\],[\s\S]*?\[data-action="toggle-trading-expert-chart"\][\s\S]*?\):active:not\(:disabled\)/);
  assert.match(styles, /\.panel-toggle:is\([\s\S]*?\[data-action="toggle-right-panel"\],[\s\S]*?\[data-action="toggle-trading-expert-chart"\][\s\S]*?\):disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(styles, /> \.trading-expert-collapse-button:disabled:hover\s*\{[^}]*background: transparent;[^}]*color: var\(--text-placeholder\);[^}]*transform: none;/s);
  assert.match(styles, /> \.trading-expert-panel\s*> \.composer\s*\{[^}]*right: 12px;[^}]*bottom: 13px;[^}]*left: 12px;[^}]*width: auto;[^}]*min-height: 158px;/s);
  assert.doesNotMatch(styles, /> \.trading-expert-chat-panel\s*> \.composer/);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-submenu\s*\{[^}]*right: calc\(100% \+ 3px\);[^}]*left: auto;/s);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-submenu::before\s*\{[^}]*right: auto;[^}]*left: 100%;/s);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-root-item[\s\S]*?> svg\s*\{[^}]*transform: rotate\(180deg\);/s);
  assert.match(styles, /\.composer-mention-submenu\s*\{[^}]*left: calc\(100% \+ 3px\);/s);
  assert.doesNotMatch(styles, /> \.composer\s*> \.composer-context-group-picker,[\s\S]*?display: none;/);
  assert.doesNotMatch(styles, /> \.composer\s*> \.composer-model-picker,[\s\S]*?display: none;/);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mode-picker\s*\{\s*display: none;/);
  assert.match(source, /composer-model-menu grouped trading-expert-model-menu/);
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout:not\(\.trading-expert-chart-collapsed\)[\s\S]*?> \.composer\s*> \.composer-model-picker\s*\{[^}]*right: 0;[^}]*left: 0;[^}]*width: auto;[^}]*margin: 0;[^}]*pointer-events: none;/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout:not\(\.trading-expert-chart-collapsed\)[\s\S]*?> \.composer\s*> \.composer-model-picker\s*> \.chat-title-group-wrap\s*\{[^}]*position: absolute;[^}]*right: 104px;[^}]*bottom: 0;[^}]*pointer-events: auto;/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout:not\(\.trading-expert-chart-collapsed\)[\s\S]*?> \.composer\s*> \.composer-model-picker\s*> \.composer-model-menu\s*\{[^}]*right: auto;[^}]*left: 50%;[^}]*width: min\(224px, calc\(100% - 24px\)\);[^}]*pointer-events: auto;[^}]*transform: translateX\(-50%\);/s,
  );
  assert.match(styles, /\.composer-model-picker\s*\{[^}]*right: 104px;[^}]*bottom: 8px;/s);
  assert.match(styles, /\.composer-model-menu\s*\{[^}]*right: 0;[^}]*bottom: calc\(100% \+ 8px\);[^}]*left: auto;/s);
  assert.match(styles, /\.composer-model-menu button:hover,[\s\S]*?\.composer-model-menu button:focus-visible\s*\{[^}]*background: var\(--surface-soft\);/s);
  assert.match(styles, /\.composer-model-menu button:disabled\s*\{[^}]*cursor: default;[^}]*opacity: 0\.55;/s);
  assert.match(styles, /\.composer-model-menu button\.active,[\s\S]*?button\.active:hover\s*\{[^}]*background: var\(--selection-strong\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-model-group-title\s*\{[^}]*color: var\(--text-secondary\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-model-menu button:focus-visible\s*\{[^}]*outline-color: rgba\(113, 190, 255, 0\.72\);/s);
  assert.match(styles, /\.trading-expert-dashboard\s*\{[^}]*display: flex;[^}]*padding-bottom: 0;/s);
  assert.match(styles, /\.trading-expert-dashboard\.chat\s*\{[^}]*padding-bottom: 184px;/s);
  assert.match(styles, /\.trading-expert-conversation\s*\{[^}]*min-height: 0;[^}]*flex: 1 1 auto;/s);
  assert.match(styles, /\.trading-expert-message-scroller\s*\{[^}]*padding: 14px 12px 22px;[^}]*scrollbar-gutter: stable;/s);
  assert.match(renderMessageBlock, /const showAvatar = !isTradingExpertThreadId\(message\.conversation_id\);/);
  assert.match(renderMessageBlock, /alignRight \|\| !showAvatar \? "" : renderMessageAvatar\(message, role\)/);
  assert.match(renderMessageBlock, /alignRight && showAvatar \? renderMessageAvatar\(message, role\) : ""/);
  assert.match(styles, /\.trading-expert-message-scroller \.message-stack\s*\{[^}]*max-width: 100%;/s);
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout \.trading-expert-message-scroller \.message-row\s*\{[^}]*gap: 8px;[^}]*margin: 20px 0;/s,
  );
  assert.doesNotMatch(styles, /\.trading-expert-message-scroller \.message-avatar\s*\{/);
  assert.match(styles, /\.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /\.message-scroll-bottom-button:focus-visible/);
  assert.match(styles, /\.message-scroll-bottom-button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.desktop-body\.trading-expert-layout[\s\S]*?> \.trading-expert-panel[\s\S]*?background: #15171b;/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.desktop-body\.trading-expert-layout[\s\S]*?> \.trading-expert-chat-panel[\s\S]*?background: #12161c;/);
  assert.match(styles, /html\[data-theme="dark"\] \.desktop-body\.trading-expert-layout\s*\{[^}]*--trading-expert-panel-divider: #1a2437;[^}]*background: var\(--app-chrome-background\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:disabled/);
});

test("Trading Expert splitters keep the former fixed widths as minima", () => {
  assert.equal(TRADING_EXPERT_LEFT_PANEL_MIN_WIDTH, 192);
  assert.equal(TRADING_EXPERT_RIGHT_PANEL_MIN_WIDTH, 300);
  assert.equal(TRADING_EXPERT_MARKET_MIN_WIDTH, 560);
  assert.deepEqual(loadTradingExpertPanelWidths({ getItem: () => null }), {
    left: 192,
    right: 300,
  });
  assert.deepEqual(loadTradingExpertPanelWidths({
    getItem: () => JSON.stringify({ left: 80, right: 120 }),
  }), {
    left: 192,
    right: 300,
  });

  assert.deepEqual(
    resizeTradingExpertPanelWidth({ left: 192, right: 300 }, "left", 400, 1280),
    { left: 400, right: 300 },
  );
  assert.deepEqual(
    resizeTradingExpertPanelWidth({ left: 192, right: 300 }, "left", 999, 1280),
    { left: 420, right: 300 },
  );
  assert.deepEqual(
    resizeTradingExpertPanelWidth({ left: 192, right: 300 }, "right", 999, 1280),
    { left: 192, right: 528 },
  );
  assert.deepEqual(
    resizeTradingExpertPanelWidth({ left: 192, right: 300 }, "right", 999, 900),
    { left: 192, right: 300 },
  );
  assert.deepEqual(
    clampTradingExpertPanelWidths({ left: 400, right: 500 }, 1280),
    { left: 308, right: 412 },
  );
});

test("Trading Expert splitters expose mouse, keyboard, persistence, and both theme states", async () => {
  const source = await mainSource;
  const resizeSource = await panelResizeSource;
  const styles = await stylesSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");

  assert.match(renderBlock, /renderTradingExpertPanelResizeHandles\(\)/);
  assert.match(renderBlock, /bindTradingExpertPanelResize\(root\)/);
  assert.match(resizeSource, /data-trading-expert-resize="\$\{side\}"/);
  assert.match(resizeSource, /role="separator"/);
  assert.match(resizeSource, /aria-orientation="vertical"/);
  assert.match(resizeSource, /aria-valuemin="\$\{panelMinimumForSide\(side\)\}"/);
  assert.match(resizeSource, /handle\.setPointerCapture\(pointerId\)/);
  assert.match(resizeSource, /side === "left" \? delta : -delta/);
  assert.match(resizeSource, /event\.key === "ArrowLeft"/);
  assert.match(resizeSource, /event\.key === "ArrowRight"/);
  assert.match(resizeSource, /event\.key === "Home"/);
  assert.match(resizeSource, /event\.key === "End"/);
  assert.match(resizeSource, /haolo\.trading-expert\.panel-widths\.v1/);
  assert.match(resizeSource, /const shell = body\.closest<HTMLElement>\("\.desktop-shell"\);/);
  assert.match(resizeSource, /shell\?\.style\.setProperty\("--conversation-list-width", `\$\{panelWidths\.left\}px`\);/);
  assert.match(resizeSource, /new ResizeObserver\(\(\) => applyWidths\(panelWidths\)\)/);

  assert.match(
    styles,
    /> \.trading-expert-resize-handle\s*\{[^}]*position: absolute;[^}]*width: 12px;[^}]*cursor: ew-resize;[^}]*touch-action: none;/s,
  );
  assert.match(styles, /> \.trading-expert-resize-handle\.left\s*\{[^}]*left: var\(--conversation-list-width\);/s);
  assert.match(styles, /> \.trading-expert-resize-handle\.right\s*\{[^}]*right: var\(--trading-expert-panel-width\);/s);
  assert.match(styles, /> \.trading-expert-resize-handle::before,[\s\S]*?> \.trading-expert-resize-handle::after\s*\{[^}]*height: 16px;[^}]*opacity: 0;/s);
  assert.match(styles, /> \.trading-expert-resize-handle:hover::before,[\s\S]*?> \.trading-expert-resize-handle\.active::after\s*\{[^}]*opacity: 1;/s);
  assert.match(styles, /\.trading-expert-panel-resizing,[\s\S]*?cursor: ew-resize !important;[\s\S]*?user-select: none !important;/s);
  assert.match(styles, /--trading-expert-resize-grip: #737d8c;/);
  assert.match(styles, /html\[data-theme="dark"\] \.desktop-body\.trading-expert-layout\s*\{[^}]*--trading-expert-resize-grip: #9ca7b8;[^}]*--trading-expert-resize-grip-active: #82b6ff;[^}]*--trading-expert-resize-hover: rgba\(105, 168, 255, 0\.13\);/s);
  assert.match(styles, /\.left-panel-collapsed[\s\S]*?> \.trading-expert-resize-handle\.left,[\s\S]*?\.right-panel-collapsed[\s\S]*?> \.trading-expert-resize-handle\.right,[\s\S]*?\.trading-expert-chart-collapsed[\s\S]*?> \.trading-expert-resize-handle\.right\s*\{\s*display: none;/s);
});

test("Trading Expert shows its mention catalog with left-opening submenus", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const catalog = await strategyCatalogSource;
  const menuBlock = sourceBlock(
    source,
    "function renderTradingExpertMentionMenu",
    "function renderComposerSkillMentionPopover",
  );
  const popoverBlock = sourceBlock(
    source,
    "function renderComposerSkillMentionPopover",
    "function renderVideoExpertModelPicker",
  );
  const cascadeHoverBlock = sourceBlock(
    source,
    "function bindCascadeMenuHoverEvents",
    "function bindEvents",
  );

  assert.match(source, /label: "策略", get options\(\) \{ return tradingStrategyMentionOptions\(\); \}/);
  assert.match(source, /label: "指标",[\s\S]*?"趋势带",[\s\S]*?tradingIndicatorMentionOptions\(\)\.filter/);
  assert.match(source, /label: "预警", options: \[\]/);
  assert.doesNotMatch(source, /label: "知识库", options: \[\]|label: "自定义指标", options:/);
  assert.match(catalog, /import\.meta\.glob<TradingStrategyPublicManifest>/);
  assert.match(catalog, /sort\(\(left, right\) => left\.display\.sortOrder - right\.display\.sortOrder/);
  assert.match(menuBlock, /class="composer-mention-root trading-expert-mention-root"/);
  assert.match(menuBlock, /class="composer-mention-submenu trading-expert-mention-submenu"/);
  assert.match(menuBlock, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(menuBlock, /class="trading-expert-mention-option"[^>]*data-trading-expert-mention-group=/);
  assert.match(menuBlock, /data-trading-expert-mention-option=/);
  assert.match(menuBlock, /item\.options\.length \? ' aria-haspopup="menu" aria-expanded="false"' : ` data-trading-expert-mention-group=/);
  assert.match(menuBlock, /strategy\?\.enabled === false/);
  assert.match(menuBlock, /disabled aria-disabled="true" title=/);
  assert.match(menuBlock, /data-action="pick-composer-files-and-folders"/);
  assert.match(menuBlock, /class="trading-expert-attachment-icon"/);
  assert.match(menuBlock, /<span>文件和文件夹<\/span>/);
  assert.match(source, /tradingStrategyByDisplayName/);
  assert.match(styles, /\.trading-expert-mention-option:disabled/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\.trading-expert-mention-option:disabled/);
  assert.doesNotMatch(menuBlock, /data-composer-mention-root|data-skill-mention-index|applyComposerSkillMention/);
  assert.match(popoverBlock, /isTradingExpertThreadId\(currentComposerThreadId\(\)\)[\s\S]*return renderTradingExpertMentionMenu\(open\)/);
  assert.match(styles, /\.trading-expert-mention-submenu\s*\{[^}]*display: none;[^}]*width: 154px;/s);
  assert.match(styles, /\.trading-expert-mention-group:hover[\s\S]*?> \.trading-expert-mention-submenu,[\s\S]*?\.trading-expert-mention-group:focus-within[\s\S]*?> \.trading-expert-mention-submenu,[\s\S]*?\.trading-expert-mention-group\.submenu-open[\s\S]*?> \.trading-expert-mention-submenu\s*\{\s*display: block;/s);
  assert.match(cascadeHoverBlock, /\.trading-expert-mention-group/);
  assert.match(cascadeHoverBlock, /item\.addEventListener\("pointerleave", scheduleClose\)/);
  assert.match(cascadeHoverBlock, /CASCADE_MENU_CLOSE_DELAY_MS/);
  assert.match(styles, /\.trading-expert-mention-popover[\s\S]*?button:focus-visible\s*\{[^}]*outline: 2px solid var\(--brand-blue\);[^}]*background: var\(--selection-soft\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-skill-popover,[\s\S]*?html\[data-theme="dark"\] \.composer-mention-submenu,[\s\S]*?background: #1b1e23;/s);
  assert.match(styles, /\.trading-expert-attachment-item[\s\S]*?justify-content: flex-start;/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.trading-expert-attachment-item:hover:not\(:disabled\),[\s\S]*?background: var\(--selection-soft\);/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.trading-expert-attachment-item:active:not\(:disabled\)[\s\S]*?background: var\(--selection-strong\);/);
});

test("Trading Expert composer resource hint preserves workflow, continuation, and group prompts", async () => {
  const source = sourceBlock(await mainSource, "function composerPlaceholderForThread", "function normalizeThreadModelSettings");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    workflowComposerInvocationContract: (id) => id === "workflow" ? { slots: [] } : null,
    workflowInvocationRequirementMessage: () => "Required workflow input",
    isMultiModelClusterThread: () => false,
    isThreadContinuationCreationActive: (id) => id === "continuation",
    localGroupChatRecord: (id) => id === "group" ? {} : null,
    isTradingExpertExecutionThreadId: () => true,
  };
  const placeholderFor = new Function(...Object.keys(context), `${compiled}\nreturn composerPlaceholderForThread;`)(...Object.values(context));
  assert.equal(placeholderFor({ id: "trading" }), "点击+调用策略、指标、预警和文件");
  assert.equal(placeholderFor({ id: "workflow" }), "Required workflow input");
  assert.equal(placeholderFor({ id: "continuation" }), "正在创建续接任务，请稍候…");
  assert.equal(placeholderFor({ id: "group" }), "发送消息，输入 @ 可指定一个或多个群成员回复");
});

test("Trading Expert mention selection inserts an atomic highlighted category token", async () => {
  const source = await mainSource;
  const placeholderBlock = sourceBlock(
    source,
    "function composerPlaceholderForThread",
    "function normalizeThreadModelSettings",
  );
  const applyBlock = sourceBlock(
    source,
    "function applyTradingExpertMention",
    "function applyComposerPromptFavorite",
  );
  const bindBlock = sourceBlock(
    source,
    "function bindComposerSkillMentionItemEvents",
    "function bindComposerMediaMentionEvents",
  );
  const highlightTokenBlock = sourceBlock(
    source,
    "function composerMentionHighlightTokens",
    "function composerSkillMentionTokens",
  );
  const atomicTokenBlock = sourceBlock(
    source,
    "function composerSkillMentionTokens",
    "function composerMediaReferenceRanges",
  );
  const composerInputBlock = sourceBlock(
    source,
    '?.addEventListener("input", (event) => {',
    '?.addEventListener("compositionstart", () => {',
  );
  const pendingSendBlock = sourceBlock(
    source,
    "function beginPendingComposerSend",
    "function upsertPendingComposerSendItem",
  );
  const atomicDeleteBlock = sourceBlock(
    source,
    "function handleComposerSkillTokenDeleteKeydown",
    "function composerSkillTokenDeleteRange",
  );

  assert.match(placeholderBlock, /isTradingExpertExecutionThreadId\(thread\.id\)[\s\S]*return "点击\+调用策略、指标、预警和文件"/);
  assert.match(applyBlock, /isTradingExpertThreadId\(threadId\)/);
  assert.match(applyBlock, /item\.options\.length > 0 && !option/);
  assert.match(applyBlock, /const token = localizedTradingExpertMentionToken\(item\.label, option \|\| ""\)/);
  assert.match(applyBlock, /composerMentionLeadingSpacer\(input\.value, match\.start\)/);
  assert.match(applyBlock, /composerMentionTrailingSpacer\(afterSelection\)/);
  assert.match(applyBlock, /applyTradingExpertCustomIndicatorMentions\(nextValue\)/);
  assert.match(applyBlock, /rememberActiveComposerDraft\(\)/);
  assert.match(applyBlock, /syncComposerMentionHighlights\(\)/);
  assert.match(bindBlock, /\[data-trading-expert-mention-option\][\s\S]*applyTradingExpertMention/);
  assert.match(highlightTokenBlock, /tradingExpertMentionTokens\(\)/);
  assert.match(atomicTokenBlock, /tradingExpertMentionTokens\(\)[\s\S]*TRADING_EXPERT_MENTION_CATALOG\.flatMap/);
  assert.match(atomicTokenBlock, /item\.options\.length[\s\S]*item\.options\.flatMap[\s\S]*localizedTradingExpertMentionToken[\s\S]*\[`@\$\{item\.label\}`, localizedTradingExpertMentionToken/);
  assert.match(composerInputBlock, /state\.composerText = input\.value;\s*applyTradingExpertCustomIndicatorMentions\(input\.value\)/);
  assert.match(pendingSendBlock, /state\.composerText = "";\s*applyTradingExpertCustomIndicatorMentions\(state\.composerText\)/);
  assert.match(atomicDeleteBlock, /state\.composerText = nextValue;\s*applyTradingExpertCustomIndicatorMentions\(nextValue\)/);
});

test("Trading Expert opens the former mention menu from plus without reacting to typed @", async () => {
  const [source, desktopMain, preload, styles] = await Promise.all([
    mainSource,
    desktopMainSource,
    preloadSource,
    stylesSource,
  ]);
  const composer = sourceBlock(
    source,
    "function renderComposer(thread",
    "function renderVideoExpertComposer",
  );
  const toggle = sourceBlock(
    source,
    "function toggleTradingExpertMentionMenu",
    "function resetComposerMediaMentionState",
  );
  const sync = sourceBlock(
    source,
    "function syncComposerSkillMentionPopover",
    "function syncComposerMediaMentionPopover",
  );
  const picker = sourceBlock(
    source,
    "async function pickComposerFilesAndFolders",
    "function queueComposerFolders",
  );
  const nativePicker = sourceBlock(
    desktopMain,
    'ipcMain.handle("app:pickComposerFilesAndFolders"',
    "function validateThreadGroupFolderName",
  );

  assert.match(composer, /const tradingExpertMode = isTradingExpertThreadId\(thread\.id\)/);
  assert.match(composer, /const composerUploadAction = tradingExpertMode[\s\S]*?data-action="toggle-trading-expert-mention-menu"/);
  assert.match(composer, /aria-expanded="\$\{state\.composerSkillMention\.open \? "true" : "false"\}"/);
  assert.match(composer, /<button type="button" class="composer-icon-btn composer-upload-button" \$\{composerUploadAction\}/);
  assert.match(toggle, /const start = input\.selectionStart \?\? input\.value\.length/);
  assert.match(toggle, /open: true/);
  assert.match(toggle, /start,\s*end,/);
  assert.match(sync, /if \(isTradingExpertThreadId\(currentComposerThreadId\(\)\)\) \{[\s\S]*?open: false,[\s\S]*?start: -1,[\s\S]*?return;/);
  assert.match(source, /\[data-action="toggle-trading-expert-mention-menu"\][\s\S]*?toggleTradingExpertMentionMenu\(\)/);
  assert.match(source, /\[data-action="pick-composer-files-and-folders"\][\s\S]*?pickComposerFilesAndFolders\(\)/);
  assert.match(picker, /queueDroppedFolders\(paths\)/);
  assert.match(picker, /filesFromDroppedLocalPaths\(paths\)/);
  assert.match(preload, /pickComposerFilesAndFolders: \(\) => ipcRenderer\.invoke\("app:pickComposerFilesAndFolders"\)/);
  assert.match(nativePicker, /process\.platform === "win32" \|\| process\.platform === "linux"/);
  assert.match(nativePicker, /buttons: \[mainUiText\("selectFiles"\), mainUiText\("selectFolder"\), mainUiText\("cancel"\)\]/);
  assert.match(nativePicker, /\["openFile", "multiSelections"\]/);
  assert.match(nativePicker, /\["openDirectory", "multiSelections"\]/);
  assert.match(nativePicker, /\["openFile", "openDirectory", "multiSelections"\]/);
  assert.match(styles, /\.composer-upload-button\[aria-expanded="true"\][\s\S]*?background: var\(--surface-hover\);/);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-upload-button\[aria-expanded="true"\][\s\S]*?background: var\(--selection-soft\);/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.trading-expert-attachment-item:disabled[\s\S]*?color: var\(--text-disabled\);/);
});

test("Trading Expert market uses the governed Binance gateway and realtime data", async () => {
  const source = await marketSource;
  const styles = await stylesSource;

  assert.match(source, /from "lightweight-charts"/);
  assert.match(source, /window\.codexDesktop\?\.getBinancePublicMarketData/);
  assert.match(source, /window\.codexDesktop\?\.subscribeBinanceMarketStreams/);
  assert.doesNotMatch(source, /BINANCE_FUTURES_REST_URL|BINANCE_SPOT_REST_URL/);
  assert.doesNotMatch(source, /fstream\.binance\.com|data-stream\.binance\.vision|new WebSocket/);
  assert.match(source, /const DEFAULT_SYMBOL = "BTCUSDT"/);
  assert.match(source, /const MARKET_QUOTE = "USDT"/);
  assert.match(source, /const MARKET_VENUE = "币安"/);
  assert.match(source, /"\/fapi\/v1\/exchangeInfo"/);
  assert.match(source, /"\/fapi\/v1\/ticker\/24hr"/);
  assert.match(source, /"\/fapi\/v1\/premiumIndex"/);
  assert.match(source, /"\/fapi\/v1\/openInterest"/);
  assert.match(source, /"\/fapi\/v1\/klines"/);
  assert.match(source, /async function fetchLatestTradingCandles/);
  assert.match(source, /startTime: cursor/);
  assert.match(source, /const maxPages = sourceStartTime === undefined \? 1 : 4/);
  assert.match(source, /fromId: options\.fromId/);
  assert.match(source, /this\.lastAggregateTradeId === null \? undefined : this\.lastAggregateTradeId \+ 1/);
  assert.match(source, /!tradFi && quoteAsset !== MARKET_QUOTE[\s\S]*?contractType !== "PERPETUAL"[\s\S]*?contractType !== "TRADIFI_PERPETUAL"[\s\S]*?item\.status !== "TRADING"/);
  assert.match(source, /export function binanceTradFiSpotAssetClass[\s\S]*?aliasRoot = \/\[BT\]\$\//);
  assert.match(source, /!tradFiAssetClass && quoteAsset !== MARKET_QUOTE/);
  assert.match(source, /币安\$\{tradFiAssetClass \? "传统金融" : ""\}现货/);
  assert.match(source, /`\$\{symbol\}@markPrice@1s`/);
  assert.match(source, /`\$\{symbol\}@ticker`/);
  assert.match(source, /`\$\{symbol\}@kline_\$\{source\.sourceInterval\}`/);
  assert.match(source, /`\$\{symbol\}@aggTrade`/);
  assert.match(source, /data-market-action="toggle-symbols"/);
  assert.match(source, /data-market-action="interval"/);
  assert.doesNotMatch(source, /data-market-mode=|data-market-action="mode"|trading-market-modes/);
  assert.match(source, /export function atm1TrendCandles/);
  assert.match(source, /export function atm4MaBand/);
  assert.match(source, /subscribeVisibleLogicalRangeChange/);
  assert.match(source, /subscribeBinanceMarketStreams\(marketType, streams/);
  assert.match(source, /window\.setTimeout\(\(\) => void this\.connectSocket\(generation\), 1_500\)/);
  assert.match(source, /this\.selectedProvider === "binance" \? MARKET_SOCKET_FALLBACK_INTERVAL_MS : 60_000/);

  assert.match(styles, /\.trading-expert-market\s*\{[\s\S]*?--trading-market-panel: #ffffff;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-panel: #0f1014;/);
  assert.match(styles, /\.trading-market-symbol:hover,[\s\S]*?\.trading-market-symbol\[aria-expanded="true"\]/);
  assert.match(styles, /\.trading-market-symbol:focus-visible,[\s\S]*?outline: 2px solid #2da6f7;/);
  assert.match(styles, /\.trading-market-loading\[hidden\],[\s\S]*?display: none !important;/);
  assert.doesNotMatch(styles, /trading-market-modes/);
});

test("Trading Expert hides the bottom time axis and applies each theme's configurable grid", async () => {
  const source = await marketSource;
  const settingsSource = await chartSettingsSource;
  const createChartBlock = sourceBlock(
    source,
    "private createChart()",
    "private createMainIndicatorSeries()",
  );
  const applyThemeBlock = sourceBlock(
    source,
    "private applyChartTheme()",
    "private clearChart()",
  );
  const createLayoutBlock = sourceBlock(
    createChartBlock,
    "layout: {",
    "grid: {",
  );

  for (const block of [createChartBlock, applyThemeBlock]) {
    assert.match(block, /vertLines: \{ visible: chartTheme\.verticalGridVisible, color: chartTheme\.verticalGridColor \}/);
    assert.match(block, /horzLines: \{ visible: chartTheme\.horizontalGridVisible, color: chartTheme\.horizontalGridColor \}/);
    assert.match(block, /timeScale: \{[\s\S]*?visible: false,/);
  }
  assert.equal((settingsSource.match(/verticalGridVisible: false/g) ?? []).length, 2);
  assert.equal((settingsSource.match(/horizontalGridVisible: true/g) ?? []).length, 2);
  assert.match(createLayoutBlock, /attributionLogo: false/);
  assert.equal((createChartBlock.match(/attributionLogo: false/g) ?? []).length, 1);
});

test("Trading Expert renders the supplied wordmark with transparent, independently scoped masks", async () => {
  const primary = renderTradingChartBrand();
  const nextPrimary = renderTradingChartBrand();
  const primaryMask = primary.match(/<mask id="([^"]+)"/)[1];
  const nextPrimaryMask = nextPrimary.match(/<mask id="([^"]+)"/)[1];

  assert.match(primary, /class="trading-market-brand"[^>]*role="img"[^>]*aria-label="Haolo\."[^>]*focusable="false"/);
  assert.match(primary, /<image href="[^"]*\/assets\/haolo-chart-wordmark\.png"/);
  const artwork = await readFile(new URL("../src/renderer/assets/haolo-chart-wordmark.png", import.meta.url));
  assert.match(primary, new RegExp(`<image[^>]*width="${artwork.readUInt32BE(16)}" height="${artwork.readUInt32BE(20)}"`));
  assert.doesNotMatch(primary, /Haolo\.com/);
  assert.match(primary, /mask-type: luminance/);
  assert.match(primary, /<rect[^>]*fill="currentColor"/);
  assert.ok(primary.includes(`mask="url(#${primaryMask})"`));
  assert.ok(nextPrimary.includes(`mask="url(#${nextPrimaryMask})"`));
  assert.notEqual(primaryMask, nextPrimaryMask, "re-rendered charts must not share SVG mask IDs");
  assert.doesNotMatch(primary, /tabindex|<a\b|<button\b/);
});

test("Trading Expert shows its black/white wordmark only in single-screen layout", async () => {
  const [market, split, styles] = await Promise.all([marketSource, splitPaneSource, stylesSource]);
  const brandStyles = sourceBlock(styles, ".trading-market-brand {", ".trading-market-volume-profile-layer {");
  const lightTokens = sourceBlock(styles, "\n.trading-expert-market {", "\n}");
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] .trading-expert-market {', "\n}");

  assert.match(market, /data-market-chart-viewport>\s*<div[^>]*data-market-chart><\/div>\s*\$\{renderTradingChartBrand\(\)\}/);
  assert.doesNotMatch(split, /renderTradingChartBrand|haolo-chart-wordmark|trading-market-brand/);
  assert.match(brandStyles, /position: absolute;/);
  assert.match(brandStyles, /left: 12px;/);
  assert.match(brandStyles, /bottom: 36px;/);
  assert.match(brandStyles, /pointer-events: none;/);
  assert.match(brandStyles, /user-select: none;/);
  assert.match(brandStyles, /color: var\(--trading-market-brand\);/);
  assert.match(brandStyles, /\.trading-expert-market\.split-layout-active \.trading-market-brand\s*\{\s*display: none;/s);
  assert.match(lightTokens, /--trading-market-brand: #000000;/);
  assert.match(darkTokens, /--trading-market-brand: #ffffff;/);
});

test("Trading Expert uses the shared settings gear for chart settings in both themes", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const chartActions = sourceBlock(
    source,
    "function renderMarketChartActions()",
    "export function renderTradingExpertMarketWorkspace()",
  );

  assert.match(chartActions, /data-market-action="open-chart-settings"[\s\S]*?<svg viewBox="0 0 24 24"[^>]*>[\s\S]*?<path d="M12\.22 2h-\.44[^"]*"\/>[\s\S]*?<circle cx="12" cy="12" r="3"\/>/);
  assert.doesNotMatch(chartActions, /M10 2\.2v2M10 15\.8v2/);
  assert.match(styles, /\.trading-market-chart-action\s*\{[^}]*color:\s*var\(--trading-market-muted\);/s);
  assert.match(styles, /\.trading-market-chart-action:hover:not\(:disabled\),[\s\S]*?color:\s*var\(--trading-market-text\);/s);
  assert.match(styles, /\.trading-market-chart-action:focus-visible,[\s\S]*?outline:\s*2px solid var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-chart-action:disabled,[\s\S]*?opacity:\s*0\.45;/s);
  assert.match(styles, /\.trading-market-chart-action svg\s*\{[^}]*stroke:\s*currentColor;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-text:[^;]+;[\s\S]*?--trading-market-muted:[^;]+;/s);
});

test("Trading Expert gives every split pane the primary pane indicator footer instead of a date axis", async () => {
  const market = await marketSource;
  const splitPane = await splitPaneSource;
  const styles = await stylesSource;
  const createSplitChart = sourceBlock(splitPane, "private createChart()", "private addSeries()");
  const updateSplitSettings = sourceBlock(splitPane, "updateSettings(", "getDrawingController()");
  const splitActions = sourceBlock(splitPane, "private readonly handleToolbarClick", "private readonly handleOutsidePointerDown");
  const splitIndicatorPanes = sourceBlock(splitPane, "private rebuildIndicatorPanes()", "private createIndicatorPane(");

  assert.match(market, /function renderTradingMarketIndicatorBar\(\)[\s\S]*?<footer class="trading-market-indicator-bar"[\s\S]*?data-market-main-indicators[\s\S]*?data-market-indicators/);
  assert.match(splitPane, /<footer class="trading-market-indicator-bar" aria-label="分屏 \$\{this\.paneIndex \+ 1\} 技术指标">/);
  assert.match(splitPane, /data-split-action="main-indicator"[\s\S]*?data-split-main-indicator/);
  assert.match(splitPane, /data-split-action="indicator"[\s\S]*?data-split-indicator/);
  assert.doesNotMatch(splitPane, /data-market-action="main-indicator"|data-market-action="indicator"/);
  assert.match(splitActions, /action === "main-indicator"[\s\S]*?this\.activeMainIndicators[\s\S]*?this\.updateMainIndicatorData\(\)/);
  assert.match(splitActions, /action === "indicator"[\s\S]*?this\.activeIndicators[\s\S]*?this\.rebuildIndicatorPanes\(\)[\s\S]*?this\.updateIndicatorData\(\)/);
  assert.match(splitPane, /private createMainIndicatorSeries\(\)[\s\S]*?this\.mainIndicatorSeries\.set\("ma"[\s\S]*?set\("ema"[\s\S]*?set\("boll"[\s\S]*?set\("bbi"/);
  assert.match(splitIndicatorPanes, /removeSeries\(series\.api\)[\s\S]*?removePane\(index\)[\s\S]*?visibleIndicators\.forEach\(\(id\) => this\.createIndicatorPane\(id\)\)/);
  assert.match(splitPane, /calculateTradingIndicator\(id, this\.candles, current\.parameters\)/);
  assert.match(market, /mainIndicators: TRADING_MAIN_INDICATORS,[\s\S]*?indicatorSettings: this\.indicatorSettings,[\s\S]*?indicatorSelection/);
  assert.match(market, /onIndicatorSelectionChange: \(selection\) => \{[\s\S]*?this\.splitPaneIndicatorSelections\.set\(index, selection\)/);
  assert.match(market, /onOpenIndicatorEditor: \(\) => \{[\s\S]*?this\.indicatorEditorSplitPane = pane;[\s\S]*?this\.setIndicatorEditorOpen\(true\)/);
  assert.match(market, /if \(splitTarget\) \{[\s\S]*?nextSettings\[key\]\.enabled = this\.indicatorSettings\[key\]\?\.enabled === true;[\s\S]*?splitTarget\.activateIndicator\(selectedIndicator\.scope, selectedIndicator\.id\)/);
  assert.match(createSplitChart, /timeScale: \{[\s\S]*?visible: false,/);
  assert.match(updateSplitSettings, /timeScale: \{[\s\S]*?visible: false,/);
  assert.match(styles, /\.trading-market-split-pane-inner\s*\{[^}]*grid-template-rows: 36\.4px minmax\(0, 1fr\) 32px;/s);
  assert.match(styles, /\.trading-expert-market\.split-layout-active \.trading-market-primary-pane \.trading-market-indicator-bar,\s*\.trading-expert-market\.split-layout-active \.trading-market-split-pane \.trading-market-indicator-bar\s*\{[^}]*z-index: 20;[^}]*height: 32px;[^}]*flex-basis: 32px;/s);
  assert.match(styles, /\.trading-expert-market\.split-layout-active \.trading-market-split-pane \.trading-market-main-indicators button,[\s\S]*?\.trading-market-split-pane \.trading-market-indicators button/);
  assert.match(styles, /\.trading-market-indicator-heading:focus-visible\s*\{[^}]*background: var\(--trading-market-accent-soft\);[^}]*color: var\(--trading-market-accent\);[^}]*box-shadow: inset 0 0 0 2px var\(--trading-market-accent\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-accent-soft: #172337;[\s\S]*?--trading-market-indicator-selected: #82b6ff;/);
});

test("VPVR keeps one volume snapshot through wheel movement in primary and split charts", async () => {
  const market = await marketSource;
  const splitPane = await splitPaneSource;
  const styles = await stylesSource;
  const volumeProfile = await volumeProfileSource;
  const marketWheelTracking = sourceBlock(
    market,
    "private trackVolumeProfileThroughWheelScale()",
    "private cancelVolumeProfileWheelTracking()",
  );
  const splitWheelTracking = sourceBlock(
    splitPane,
    "private trackVolumeProfileThroughWheelScale()",
    "private cancelVolumeProfileWheelTracking()",
  );

  assert.match(market, /data-market-volume-profile-layer/);
  assert.match(market, /private renderVolumeProfile\(recalculate = false\)[\s\S]*?visibleCandlesInLogicalRange\(this\.chartCandles, logicalRange\)/);
  assert.match(market, /if \(recalculate \|\| this\.volumeProfileSnapshot === undefined\)[\s\S]*?calculateTradingVolumeProfile/);
  assert.match(market, /profile: this\.volumeProfileSnapshot/);
  assert.match(market, /subscribeVisibleLogicalRangeChange[\s\S]*?this\.synchronizeVisibleChartGeometry\(\)/);
  assert.match(market, /private synchronizeVisibleChartGeometry\(\)[\s\S]*?this\.renderVolumeProfile\(false\)/);
  assert.match(market, /private applyInitialChartViewport\(\)[\s\S]*?this\.renderVolumeProfile\(true\)/);
  assert.match(market, /private updateChartData[\s\S]*?if \(resetViewport\) \{[\s\S]*?this\.invalidateVolumeProfileSnapshot\(\)/);
  assert.match(market, /private readonly handleChartWheel[\s\S]*?this\.trackVolumeProfileThroughWheelScale\(\)/);
  assert.match(marketWheelTracking, /TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES[\s\S]*?this\.renderVolumeProfile\(false\)[\s\S]*?requestAnimationFrame\(redraw\)/);
  assert.doesNotMatch(marketWheelTracking, /calculateTradingVolumeProfile|renderVolumeProfile\(true\)/);
  assert.match(splitPane, /data-split-volume-profile-layer/);
  assert.match(splitPane, /subscribeVisibleLogicalRangeChange[\s\S]*?this\.renderVolumeProfile\(false\)/);
  assert.match(splitPane, /private renderVolumeProfile\(recalculate = false\)[\s\S]*?profile: this\.volumeProfileSnapshot/);
  assert.match(splitPane, /private updateMainIndicatorData\(refreshVolumeProfile = false\)[\s\S]*?this\.renderVolumeProfile\(refreshVolumeProfile\)/);
  assert.match(splitPane, /updateIndicatorSettings[\s\S]*?this\.updateMainIndicatorData\(true\)/);
  assert.match(splitPane, /private async reload\(resetViewport: boolean\): Promise<boolean> \{\s*if \(resetViewport\) this\.invalidateVolumeProfileSnapshot\(\)/);
  assert.match(splitPane, /private readonly handleWheel[\s\S]*?this\.trackVolumeProfileThroughWheelScale\(\)/);
  assert.match(splitWheelTracking, /TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES[\s\S]*?this\.renderVolumeProfile\(false\)[\s\S]*?requestAnimationFrame\(redraw\)/);
  assert.doesNotMatch(splitWheelTracking, /calculateTradingVolumeProfile|renderVolumeProfile\(true\)/);
  assert.match(volumeProfile, /requestedValueAreaRatio = 0\.7/);
  assert.match(volumeProfile, /TRADING_VOLUME_PROFILE_WHEEL_TRACKING_FRAMES = 12/);
  assert.match(volumeProfile, /options\.profile === undefined[\s\S]*?calculateTradingVolumeProfile/);
  assert.match(volumeProfile, /candle\.volume \* \(overlap\.amount \/ overlapTotal\)/);
  assert.match(styles, /\.trading-market-vpvr-bar\.value-area/);
  assert.match(styles, /\.trading-market-vpvr-bar\.poc/);
  assert.match(styles, /\.trading-market-vpvr-poc-line/);
  assert.equal([...styles.matchAll(/--trading-vpvr-bar-opacity:/g)].length, 2);
  assert.equal([...styles.matchAll(/--trading-vpvr-value-area-opacity:/g)].length, 2);
  assert.equal([...styles.matchAll(/--trading-vpvr-poc-opacity:/g)].length, 2);
  assert.match(styles, /--trading-vpvr-bar-opacity: 15%;[\s\S]*?--trading-vpvr-value-area-opacity: 26%;[\s\S]*?--trading-vpvr-poc-opacity: 43%;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-vpvr-bar-opacity: 18%;[\s\S]*?--trading-vpvr-value-area-opacity: 30%;[\s\S]*?--trading-vpvr-poc-opacity: 46%;/);
  assert.match(market, /id: "vpvr"[\s\S]*?indicatorParameter\("价格区间数", 96,[\s\S]*?key: "poc"[\s\S]*?color: "#5b95e5"/);
  assert.match(market, /indicator-settings\.v4[\s\S]*?PREVIOUS_TRADING_INDICATOR_SETTINGS_STORAGE_KEY = "haolo\.trading-market\.indicator-settings\.v3"/);
});

test("Trading Expert matches the reference crosshair, price, and hover-time presentation", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const crosshairOptions = sourceBlock(
    source,
    "const marketCrosshairOptions",
    "async function fetchBinanceFutures",
  );
  const updateTimeLabel = sourceBlock(
    source,
    "private updateCrosshairTimeLabel",
    "private hideCrosshairTimeLabel",
  );
  const updatePriceLabel = sourceBlock(
    source,
    "private updateCrosshairPriceLabel",
    "private updateCurrentPriceLabel",
  );
  const viewportLeave = sourceBlock(
    source,
    "private readonly handleViewportLeave",
    "private readonly handleOutsidePointerDown",
  );

  assert.equal((crosshairOptions.match(/style: LineStyle\.Dashed/g) ?? []).length, 2);
  assert.doesNotMatch(crosshairOptions, /LineStyle\.Solid|crosshairSoft/);
  assert.match(crosshairOptions, /vertLine:[\s\S]*?labelVisible: false/);
  assert.match(crosshairOptions, /horzLine:[\s\S]*?labelVisible: false/);
  assert.match(source, /crosshair: \{[\s\S]*?\.\.\.marketCrosshairOptions\(theme\)[\s\S]*?color: chartTheme\.crosshairColor/);
  assert.match(source, /const MARKET_PRICE_FORMAT = \{ type: "price", precision: 2, minMove: 0\.01 \} as const/);
  assert.match(source, /data-market-crosshair-time hidden/);
  assert.match(source, /data-market-crosshair-price hidden/);
  assert.match(source, /data-market-current-price hidden/);
  assert.match(source, /this\.updateCrosshairTimeLabel\(parameter\)/);
  assert.match(source, /this\.updateCrosshairPriceLabel\(parameter\)/);
  assert.match(updateTimeLabel, /resolveMarketCrosshairTime\(/);
  assert.match(updateTimeLabel, /coordinateToLogical\(x\)/);
  assert.match(updateTimeLabel, /formatOhlcDateTime\(timeValue\)/);
  assert.match(updateTimeLabel, /this\.crosshairTimeElement\.style\.left/);
  assert.doesNotMatch(updateTimeLabel, /hideCrosshairTimeLabel\(/);
  assert.match(updatePriceLabel, /this\.candleSeries\.coordinateToPrice\(y\)/);
  assert.doesNotMatch(updatePriceLabel, /seriesData|hideCrosshairPriceLabel\(/);
  assert.match(viewportLeave, /this\.hideCrosshairTimeLabel\(\)/);
  assert.match(viewportLeave, /this\.hideCrosshairPriceLabel\(\)/);
  assert.match(styles, /--trading-market-crosshair-label: #7d838c;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-crosshair-label: #626b77;/);
  assert.match(styles, /\.trading-market-crosshair-time\s*\{[^}]*bottom: 4px;[^}]*background: var\(--trading-market-crosshair-label\);[^}]*color: var\(--trading-market-crosshair-label-text\);[^}]*font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;[^}]*font-weight: 600;/s);
  assert.match(styles, /\.trading-market-focus-price\s*\{[^}]*font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;[^}]*font-feature-settings: "zero" 0;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(styles, /\.trading-market-crosshair-time\[hidden\]\s*\{[^}]*display: none !important;/s);
});

test("Trading Expert pans horizontally while locking price to the candles visible on screen", async () => {
  const source = await marketSource;
  const createChartBlock = sourceBlock(
    source,
    "private createChart()",
    "private createMainIndicatorSeries()",
  );
  const lockPriceScale = sourceBlock(
    source,
    "private updateVisiblePriceScale",
    "private renderLatestOhlc",
  );
  const geometrySync = sourceBlock(
    source,
    "private synchronizeVisibleChartGeometry()",
    "private queueVisiblePriceScaleUpdate()",
  );
  const queuedGeometrySync = sourceBlock(
    source,
    "private queueVisiblePriceScaleUpdate()",
    "private finishChartPan()",
  );

  assert.match(source, /export function fixedPriceScaleRange/);
  assert.match(source, /export function visibleCandlesInLogicalRange/);
  assert.match(createChartBlock, /rightPriceScale: \{[\s\S]*?autoScale: tradingPriceScaleUsesAutoScale\(this\.chartSettings\.priceScaleMode\),[\s\S]*?ensureEdgeTickMarksVisible: true,[\s\S]*?scaleMargins: \{ top: 0, bottom: 0 \}/);
  assert.match(createChartBlock, /axisPressedMouseMove: \{ time: true, price: false \}/);
  assert.match(createChartBlock, /axisDoubleClickReset: \{ time: true, price: false \}/);
  assert.match(createChartBlock, /handleScroll: \{[\s\S]*?pressedMouseMove: false,[\s\S]*?horzTouchDrag: false,[\s\S]*?vertTouchDrag: false,/);
  assert.match(source, /addEventListener\("pointerdown", this\.handleChartPanPointerDown\)/);
  assert.match(source, /this\.chart\.timeScale\(\)\.setVisibleLogicalRange\(\{/);
  assert.match(source, /const logicalShift = -\(\(event\.clientX - this\.chartPanStartX\) \/ paneWidth\) \* span/);
  assert.match(source, /this\.chartCandles = deduped/);
  assert.match(source, /subscribeVisibleLogicalRangeChange\(\(range: any\) => \{[\s\S]*?this\.queueVisiblePriceScaleUpdate\(\)/);
  assert.match(lockPriceScale, /tradingPriceScaleUsesAutoScale\(this\.chartSettings\.priceScaleMode\)/);
  assert.match(lockPriceScale, /this\.lockedPriceRange = null;[\s\S]*?setAutoScale\(true\);[\s\S]*?return;/);
  assert.match(lockPriceScale, /this\.chart\.timeScale\(\)\.getVisibleLogicalRange\(\)/);
  assert.match(lockPriceScale, /visibleCandlesInLogicalRange\(this\.chartCandles, logicalRange\)/);
  assert.match(lockPriceScale, /fixedPriceScaleRange\(\s*visibleCandles,\s*this\.chartSettings\.verticalPaddingPercent \/ 100,\s*\)/);
  assert.match(lockPriceScale, /priceScale\.setAutoScale\(false\)/);
  assert.match(lockPriceScale, /this\.lockedPriceRange = priceRange/);
  assert.match(lockPriceScale, /priceScale\.setVisibleRange\(this\.lockedPriceRange\)/);
  assert.match(geometrySync, /this\.updateVisiblePriceScale\(\);[\s\S]*?this\.updateCurrentPriceLabel\(\);[\s\S]*?this\.redrawDrawingControllers\(\)/);
  assert.match(
    queuedGeometrySync,
    /this\.resettingChartViewport[\s\S]*?\|\| this\.updatingChartData[\s\S]*?\|\| this\.priceLockAnimationFrame !== null/,
  );
  assert.doesNotMatch(queuedGeometrySync, /cancelAnimationFrame\(this\.priceLockAnimationFrame\)/);
  assert.match(queuedGeometrySync, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?this\.synchronizeVisibleChartGeometry\(\)/);
  assert.match(queuedGeometrySync, /this\.drawingSettleAnimationFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?this\.synchronizeVisibleChartGeometry\(\)/);
  assert.match(createChartBlock, /subscribeVisibleLogicalRangeChange\(\(range: any\) => \{[\s\S]*?this\.synchronizeVisibleChartGeometry\(\);[\s\S]*?this\.queueVisiblePriceScaleUpdate\(\)/);
  assert.match(source, /if \(this\.drawingSettleAnimationFrame !== null\) \{[\s\S]*?window\.cancelAnimationFrame\(this\.drawingSettleAnimationFrame\)/);
});

test("Trading Expert market uses the compact pair title and customizable period bar", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const overview = sourceBlock(
    source,
    '<div class="trading-market-overview">',
    '<div class="trading-market-chart-grid"',
  );
  const indicatorBar = sourceBlock(
    source,
    '<footer class="trading-market-indicator-bar"',
    "</footer>",
  );

  assert.doesNotMatch(source, /trading-market-chart-header|data-market-pair|data-market-token/);
  assert.doesNotMatch(overview, /trading-market-metric|data-market-stat/);
  assert.match(overview, /<strong><span data-market-symbol>BTC<\/span><span data-market-quote>\/\$\{MARKET_QUOTE\}<\/span><\/strong>/);
  assert.match(overview, /class="trading-market-venue" data-market-current-venue>\$\{MARKET_VENUE\}<\/span>/);
  assert.match(overview, /renderTradingMarketAssetLogo\("BTC", "binance", true\)/);
  assert.match(overview, /class="trading-market-contract-tag" data-market-current-tag>永续<\/span>/);
  assert.match(source, /const DEFAULT_INTERVAL = "60"/);
  assert.match(source, /const intervalSequence = \[DEFAULT_INTERVAL, "240", "15", DEFAULT_INTERVAL, "5", "1W", "30", "120"\]/);
  assert.match(source, /\{ amount: 1, unit: "w" \},[\s\S]*?\{ amount: 1, unit: "d" \},[\s\S]*?\{ amount: 5, unit: "m" \},[\s\S]*?\{ amount: 15, unit: "m" \},[\s\S]*?\{ amount: 1, unit: "h" \},[\s\S]*?\{ amount: 4, unit: "h" \}/);
  assert.ok(
    indicatorBar.indexOf("data-market-main-indicators")
      < indicatorBar.indexOf("data-market-indicators"),
  );
  assert.match(indicatorBar, /class="trading-market-indicator-heading"[\s\S]*?data-market-action="toggle-indicator-editor"[\s\S]*?aria-haspopup="dialog"[\s\S]*?>\s*自定义指标\s*<svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5"\/><\/svg>/);
  assert.doesNotMatch(indicatorBar, /trading-market-indicator-count|data-market-indicator-count|未选择/);
  assert.doesNotMatch(indicatorBar, />\s*指标\s*<\/span>/);
  assert.match(styles, /\.trading-market-indicator-heading\s*\{[^}]*height: 32px;[^}]*gap: 5px;[^}]*padding: 0 8px;[^}]*font-size: calc\(12px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.doesNotMatch(styles, /\.trading-market-indicator-heading\s*\{[^}]*border-right:/s);
  assert.match(styles, /\.trading-market-indicator-heading svg\s*\{[^}]*width: 8px;[^}]*height: 5px;[^}]*stroke: currentColor;[^}]*stroke-width: 1\.5;/s);
  assert.match(styles, /\.trading-market-period-controls\s*\{[^}]*min-width: 210px;[^}]*flex: 0 1 auto;[^}]*margin-left: auto;/s);
  assert.match(styles, /\.trading-market-times\s*\{[^}]*flex: 0 1 auto;[^}]*margin-left: 0;/s);
  assert.match(styles, /\.trading-market-times\s*\{[^}]*overflow-x: auto;[^}]*overflow-y: hidden;[^}]*overscroll-behavior-x: contain;[^}]*scroll-padding-inline: 4px;[^}]*touch-action: pan-x;/s);
  assert.match(styles, /\.trading-market-times\.dragging\s*\{[^}]*cursor: grabbing;[^}]*user-select: none;/s);
  assert.match(styles, /\.trading-market-times button\s*\{[^}]*border: 0;[^}]*background: transparent;/s);
  assert.match(styles, /\.trading-market-times button:hover:not\(:disabled\)\s*\{[^}]*background: var\(--trading-market-accent-soft\);[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-times button\.active\s*\{[^}]*background: transparent;[^}]*color: var\(--trading-market-accent\);/s);
  assert.doesNotMatch(styles, /\.trading-market-times button\.active::after/);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*padding: 0 10px 0 0;/s);
  assert.match(styles, /\.trading-market-symbol\s*\{[^}]*min-width: 212px;/s);
  assert.match(styles, /\.trading-market-symbol > svg\s*\{[^}]*margin-left: 3px;/s);
  assert.doesNotMatch(styles, /\.trading-market-symbol > svg\s*\{[^}]*margin-left: auto;/s);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*height: 36\.4px;[^}]*flex: 0 0 36\.4px;/s);
  assert.match(styles, /--trading-market-accent: #2f80ed;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-accent: #69a8ff;/);
  assert.doesNotMatch(indicatorBar, /普通|升级|trading-market-modes|data-market-mode/);
  assert.doesNotMatch(styles, /trading-market-modes/);
});

test("Trading Expert custom periods support official resolutions, ordering, persistence, and themes", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const editor = sourceBlock(
    source,
    "function renderPeriodEditorShell()",
    "function renderIndicatorButtons()",
  );
  const sharedFocusRing = sourceBlock(
    styles,
    ".trading-market-symbol:focus-visible",
    ".trading-market-symbol strong",
  );
  const applyPeriods = sourceBlock(
    source,
    "private applyDraftPeriods()",
    "private clearPeriodDragState()",
  );
  const addPeriod = sourceBlock(source, "private addDraftPeriod()", "private applyDraftPeriods()");
  const removePeriod = sourceBlock(source, 'if (action === "remove-period")', 'if (action === "retry")');

  assert.match(source, /function tradingViewResolution/);
  assert.match(source, /period\.unit === "s"\) return `\$\{amount\}S`/);
  assert.match(source, /period\.unit === "m"\) return String\(amount\)/);
  assert.match(source, /period\.unit === "h"\) return String\(amount \* 60\)/);
  assert.match(source, /period\.unit === "d"\) return `\$\{amount\}D`/);
  assert.match(source, /return `\$\{amount\}W`/);
  assert.match(source, />\s*自定义周期\s*/);
  assert.match(editor, />已添加项</);
  assert.match(editor, />拖动可排序</);
  assert.match(editor, />新增周期</);
  assert.doesNotMatch(editor, /未添加项/);
  assert.doesNotMatch(editor, />秒</);
  for (const unit of ["分", "时", "日"]) assert.match(editor, new RegExp(`>${unit}<`));
  for (const unit of ["周", "月", "年"]) assert.match(editor, new RegExp(`>${unit}<`));
  assert.match(editor, /data-market-action="period-unit" data-market-period-unit="w"/);
  assert.match(editor, /data-market-action="period-unit" data-market-period-unit="M"/);
  assert.match(editor, /data-market-action="period-unit" data-market-period-unit="Y"/);
  assert.doesNotMatch(editor, /<select[^>]*data-market-period-unit/);
  assert.match(editor, /class="video-expert-select trading-market-period-unit-picker"/);
  assert.match(editor, /class="video-expert-select-button"/);
  assert.match(editor, /class="video-expert-select-menu trading-market-period-unit-menu"/);
  assert.match(editor, /data-market-action="toggle-period-unit"/);
  assert.match(editor, /data-market-action="period-unit" data-market-period-unit="m"/);
  assert.doesNotMatch(editor, /trading-market-period-editor-actions/);
  assert.doesNotMatch(editor, /最多展示|恢复默认|data-market-action="restore-periods"|data-market-action="confirm-periods"/);
  assert.match(source, /const MAX_TRADING_PERIODS = 10/);
  assert.match(addPeriod, /this\.applyDraftPeriods\(\)/);
  assert.match(removePeriod, /if \(!nextPeriods\.length\)[\s\S]*?请至少保留一个周期。[\s\S]*?this\.applyDraftPeriods\(\)/);
  assert.match(applyPeriods, /this\.renderPeriodEditor\(false\)/);
  assert.match(applyPeriods, /this\.renderPeriodButtons\(\)/);
  assert.match(applyPeriods, /this\.setPeriodStatus\("周期已自动应用。", "success"\)/);
  assert.doesNotMatch(applyPeriods, /setPeriodEditorOpen\(false\)/);
  assert.match(source, /this\.periodTimes\.addEventListener\("wheel", this\.handlePeriodScrollWheel, \{ passive: false \}\)/);
  assert.match(source, /this\.periodTimes\.addEventListener\("pointermove", this\.handlePeriodScrollPointerMove\)/);
  assert.match(source, /private readonly handlePeriodScrollWheel = \(event: WheelEvent\) => \{[\s\S]*?this\.periodTimes\.scrollLeft = nextScrollLeft;/);
  assert.match(source, /private readonly handlePeriodScrollPointerMove = \(event: PointerEvent\) => \{[\s\S]*?this\.periodTimes\.scrollLeft = this\.periodScrollStartLeft - distance;/);
  assert.match(source, /if \(action === "interval" && this\.periodScrollSuppressClick\)[\s\S]*?event\.preventDefault\(\);/);
  assert.match(source, /private revealPeriodButton\(interval: string,[\s\S]*?buttonRect\.right > stripRect\.right - edgeInset[\s\S]*?this\.periodTimes\.scrollTo\(\{/);
  assert.match(source, /const addedResolution = this\.periods\.reduce<string \| null>[\s\S]*?this\.revealPeriodButton\(addedResolution \|\| this\.activeInterval\)/);
  assert.doesNotMatch(source, /draggable="true"/);
  assert.match(source, /addEventListener\("pointerdown", this\.handlePeriodPointerDown\)/);
  assert.match(source, /addEventListener\("pointermove", this\.handlePeriodPointerMove\)/);
  assert.match(source, /addEventListener\("pointerup", this\.handlePeriodPointerUp\)/);
  assert.match(source, /document\.elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(source, /this\.draggedPeriodGhost = this\.createPeriodDragGhost\(item, rect\)/);
  assert.match(source, /this\.positionPeriodDragGhost\(event\.clientX, event\.clientY\)/);
  assert.match(source, /this\.periodItems\.insertBefore\(/);
  assert.match(source, /item\.animate\(/);
  assert.match(source, /this\.draftPeriods = reorderTradingPeriods\(this\.draftPeriods, orderedResolutions\)/);
  assert.match(source, /finishPeriodPointerDrag\(commit: boolean\)[\s\S]*?this\.applyDraftPeriods\(\)/);
  assert.match(source, /function loadTradingPeriodsFromStorage[\s\S]*storage\.getItem\(TRADING_PERIODS_STORAGE_KEY\)/);
  assert.match(source, /private loadTradingPeriods\(\)[\s\S]*return loadTradingPeriodsFromStorage\(window\.localStorage\)/);
  assert.match(source, /window\.localStorage\.setItem\(TRADING_PERIODS_STORAGE_KEY, JSON\.stringify\(this\.periods\)\)/);
  assert.match(styles, /\.trading-market-period-editor\s*\{[^}]*background: var\(--trading-market-panel\);/s);
  assert.match(styles, /\.trading-market-period-editor\s*\{[^}]*width: min\(336px, calc\(100vw - 112px\)\);/s);
  assert.match(styles, /\.trading-market-period-item:hover\s*\{[^}]*background: var\(--trading-market-accent-soft\);/s);
  assert.match(styles, /\.trading-market-period-item\s*\{[^}]*touch-action: none;[^}]*user-select: none;/s);
  assert.match(styles, /\.trading-market-period-item\.drag-over\s*\{[^}]*border-color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-period-drag-ghost\s*\{[^}]*position: fixed;[^}]*pointer-events: none;[^}]*cursor: grabbing;/s);
  assert.match(styles, /\.trading-market-period-add-controls > \[data-market-action="add-period"\]:disabled\s*\{[^}]*opacity: 0\.45;/s);
  assert.match(styles, /\.trading-market-period-unit-menu\s*\{[^}]*top: calc\(100% \+ 6px\);[^}]*bottom: auto;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.copy-context-menu,[\s\S]*?html\[data-theme="dark"\] \.video-expert-select-menu,[\s\S]*?\{[^}]*background: #1b1e23;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-editor\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-drag-ghost\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-add input\s*\{[^}]*color-scheme: dark;/s);
  assert.doesNotMatch(sharedFocusRing, /\.trading-market-period-editor input:focus-visible/);
  assert.match(
    styles,
    /\.trading-market-period-add input:focus-visible\s*\{[^}]*outline: 0;[^}]*border-color: color-mix\(in srgb, var\(--trading-market-text\) 38%, var\(--trading-market-border\)\);[^}]*box-shadow: none;/s,
  );
});

test("Trading Expert custom indicator dialog configures every existing study and applies only on save", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const shell = sourceBlock(
    source,
    'class="trading-market-indicator-editor-backdrop"',
    "function renderTradingExpertMarketWorkspace",
  );
  const saveBlock = sourceBlock(
    source,
    "private saveDraftIndicatorSettings()",
    "private setPeriodUnitMenuOpen",
  );
  const editorRenderBlock = sourceBlock(
    source,
    "private renderIndicatorEditor(resetStatus = true)",
    "private saveDraftIndicatorSettings()",
  );

  assert.match(shell, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(shell, /data-market-indicator-catalog/);
  assert.match(shell, /data-market-indicator-detail/);
  assert.match(shell, /data-market-action="restore-indicator-settings">恢复默认/);
  assert.match(shell, /data-market-action="save-indicator-settings">保存/);
  assert.doesNotMatch(shell, /删除快捷指标|trading-market-indicator-alphabet|data-market-indicator-alphabet/);
  assert.match(source, /TRADING_MARKET_INDICATOR_CATALOG[\s\S]*scope: "main", id: "ma"[\s\S]*scope: "main", id: "bbi"[\s\S]*scope: "sub", id: "volume"[\s\S]*scope: "sub", id: "willr"/);
  assert.match(source, /TRADING_MARKET_INDICATOR_CATALOG\.filter\(\(indicator\) => indicator\.scope === scope\)/);
  assert.match(source, /data-market-indicator-parameter/);
  assert.match(editorRenderBlock, /trading-market-indicator-parameter-stepper/);
  assert.match(source, /action === "step-indicator-parameter"[\s\S]*?input\.stepUp\(\)[\s\S]*?input\.stepDown\(\)/);
  assert.match(source, /data-market-indicator-series-visible/);
  assert.match(source, /data-market-indicator-series-color/);
  assert.match(source, /data-market-indicator-width-menu/);
  assert.match(source, /data-market-indicator-width=/);
  assert.doesNotMatch(editorRenderBlock, /trading-market-indicator-catalog-icon|trading-market-indicator-enabled-switch|<em>\$\{indicator\.scope/);
  assert.match(source, /this\.draftIndicatorSettings = cloneTradingIndicatorSettings\(this\.indicatorSettings\)/);
  assert.match(source, /this\.indicatorCatalog\.addEventListener\("scroll", this\.handleIndicatorEditorScroll/);
  assert.match(source, /this\.indicatorDetail\.addEventListener\("scroll", this\.handleIndicatorEditorScroll/);
  assert.match(source, /scroller\.scrollHeight <= scroller\.clientHeight \+ 2[\s\S]*?scroller\.classList\.add\("scrolling"\)[\s\S]*?}, 500\)/);
  assert.match(editorRenderBlock, /this\.clearIndicatorScrollerState\(this\.indicatorCatalog\)[\s\S]*?this\.clearIndicatorScrollerState\(this\.indicatorDetail\)/);
  assert.match(saveBlock, /const nextSettings = normalizeTradingIndicatorSettings\(this\.draftIndicatorSettings\)[\s\S]*this\.indicatorSettings = nextSettings/);
  assert.match(saveBlock, /const selectedSetting = this\.draftIndicatorSettings\[this\.selectedIndicatorSettingKey\];[\s\S]*if \(selectedSetting && !splitTarget\) selectedSetting\.enabled = true/);
  assert.match(saveBlock, /this\.persistIndicatorSettings\(\)/);
  assert.match(saveBlock, /this\.applyMainIndicatorSeriesOptions\(\)/);
  assert.match(saveBlock, /this\.rebuildIndicatorPanes\(\)/);
  assert.match(saveBlock, /this\.updateChartData\(\{ preserveViewport: true \}\)/);
  assert.match(styles, /\.trading-market-indicator-editor\s*\{[^}]*width: min\(800px, calc\(100% - 24px\)\);/s);
  assert.match(styles, /\.trading-market-indicator-editor-body\s*\{[^}]*grid-template-columns: 210px minmax\(0, 1fr\);/s);
  assert.match(styles, /\.trading-market-indicator-catalog,\s*\.trading-market-indicator-detail\s*\{[^}]*overflow-y: auto;[^}]*scrollbar-color: transparent transparent;/s);
  assert.match(styles, /\.trading-market-indicator-catalog\s*\{[^}]*border-right: 1px solid var\(--trading-market-border\);/s);
  assert.match(styles, /\.trading-market-indicator-catalog-section > h3\s*\{[^}]*padding: 10px 18px 10px 33px;/s);
  assert.match(styles, /\.trading-market-indicator-catalog-section > h3\s*\{[^}]*background: var\(--trading-market-indicator-section-bg\);/s);
  assert.match(styles, /--trading-market-indicator-section-bg: #e1e5eb;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-indicator-section-bg: #24262b;/s);
  assert.match(styles, /\.trading-market-indicator-catalog-item\s*\{[^}]*padding: 4px 8px 4px 23px;/s);
  assert.match(styles, /\.trading-market-indicator-catalog::-webkit-scrollbar,[\s\S]*?width: 0;/s);
  assert.match(styles, /\.trading-market-indicator-catalog\.scrolling::-webkit-scrollbar,[\s\S]*?width: 4px;/s);
  assert.match(styles, /\.trading-market-indicator-catalog::-webkit-scrollbar-thumb,[\s\S]*?background: transparent;/s);
  assert.match(styles, /\.trading-market-indicator-catalog\.scrolling::-webkit-scrollbar-thumb,[\s\S]*?var\(--trading-market-muted\) 22%/s);
  assert.doesNotMatch(styles, /\.trading-market-indicator-catalog-icon|\.trading-market-indicator-enabled-switch/);
  assert.doesNotMatch(styles, /\.trading-market-indicator-catalog-item\.enabled/);
  assert.doesNotMatch(editorRenderBlock, /setting\.enabled \? " enabled"/);
  assert.doesNotMatch(editorRenderBlock, /<select/);
  assert.match(editorRenderBlock, /class="video-expert-select trading-market-indicator-width-select/);
  assert.match(editorRenderBlock, /class="video-expert-select-button trading-market-indicator-width-trigger"/);
  assert.match(editorRenderBlock, /class="video-expert-select-menu trading-market-indicator-width-menu"/);
  assert.match(source, /action === "toggle-indicator-width-menu"[\s\S]*?action === "set-indicator-series-width"/);
  assert.match(styles, /\.trading-market-indicator-width-menu\s*\{[^}]*top: calc\(100% \+ 6px\);[^}]*width: 100%;/s);
  assert.match(styles, /\.trading-market-indicator-editor button:focus-visible,[\s\S]*?outline: 0;/s);
  assert.match(styles, /\.trading-market-indicator-width-trigger\.video-expert-select-button:focus-visible\s*\{[^}]*outline: 0;[^}]*box-shadow: none;/s);
  assert.match(styles, /\.trading-market-indicator-parameter-row input\[type="number"\]::-webkit-inner-spin-button,[\s\S]*?-webkit-appearance: none;/s);
  assert.match(styles, /\.trading-market-indicator-parameter-stepper > button\s*\{[^}]*background: transparent;/s);
  assert.match(styles, /\.trading-market-indicator-editor-footer button\.primary\s*\{[^}]*background: var\(--trading-market-accent\);[^}]*color: #ffffff;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-indicator-editor\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-indicator-editor input\s*\{[^}]*color-scheme: dark;/s);
  assert.match(styles, /@media \(max-width: 880px\)[\s\S]*?\.trading-market-indicator-editor\s*\{[^}]*width: min\(800px, 100%\);/s);
});

test("Trading Expert market picker is compact, neutral-search, left-aligned, and themed", async () => {
  const source = await marketSource;
  const identity = await marketIdentitySource;
  const styles = await stylesSource;

  assert.match(source, /class="trading-market-picker-search"/);
  assert.doesNotMatch(source, /data-market-action="close-symbols"|aria-label="关闭交易对列表">×/);
  assert.doesNotMatch(source, /trading-market-picker-toolbar|data-market-count|项目对\(0\)/);
  assert.match(source, /<span>名称<\/span><span>平台<\/span><span>最新价<\/span><span>24H涨幅<\/span><span>收藏<\/span>/);
  assert.doesNotMatch(source, /<span>#<\/span>/);
  assert.doesNotMatch(source, /CNY价格|24H成交额|24小时成交额|>操作</);
  assert.doesNotMatch(source, /trading-market-row-number|markets\.map\(\(market, index\)/);
  assert.match(source, /class="trading-market-row-pair"/);
  assert.match(identity, /https:\/\/bin\.bnbstatic\.com\/static\/assets\/logos/);
  assert.match(identity, /https:\/\/app\.hyperliquid\.xyz\/coins/);
  assert.match(source, /renderTradingMarketAssetLogo\(market\.baseAsset, market\.provider, false, market\.assetClass, market\.displaySymbol\)/);
  assert.match(identity, /data-market-logo-stage="binance"/);
  assert.match(source, /addEventListener\("error", this\.handleMarketLogoError, true\)/);
  assert.match(source, /this\.marketList\.addEventListener\("scroll", this\.handleMarketListScroll, \{ passive: true \}\)/);
  assert.match(source, /const preservedScrollTop = options\.resetScroll[\s\S]*?Math\.max\(this\.marketList\.scrollTop, this\.marketListScrollTop\)/);
  assert.match(source, /this\.restoreMarketListScroll\(preservedScrollTop\)/);
  assert.match(source, /restorePreservedViewState\(\)/);
  assert.match(source, /activeWorkspace\.restorePreservedViewState\(\)/);
  assert.match(source, /image\.dataset\.marketLogoStage = "hyperliquid"/);
  assert.match(source, /class="trading-market-contract-tag">\$\{escapeHtml\(market\.tag\)\}<\/span>/);
  assert.match(source, /class="trading-market-row-venue"[^>]*>\$\{escapeHtml\(market\.venue\)\}<\/span>/);
  assert.match(source, /TRADING_MARKET_CATEGORY_OPTIONS\.map\(\(option\) =>/);
  assert.match(source, /data-market-action="market-category"[\s\S]*?data-market-category="\$\{option\.id\}"[\s\S]*?aria-selected="\$\{option\.id === "all"\}"/);
  assert.match(source, /action === "market-category"[\s\S]*?this\.marketCategory = category[\s\S]*?this\.showFavoritesOnly = false/);
  assert.match(source, /private syncMarketCategoryButtons\(\)[\s\S]*?aria-selected/);
  assert.match(styles, /\.trading-market-categories\s*\{[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/s);
  assert.match(styles, /\.trading-market-categories button:hover:not\(:disabled\),[\s\S]*?\.trading-market-categories button\.active\s*\{[^}]*background: var\(--trading-market-accent-soft\);[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-categories button:active:not\(:disabled\)\s*\{[^}]*color-mix\(in srgb, var\(--trading-market-accent\) 14%, transparent\)/s);
  assert.match(styles, /\.trading-market-categories button:focus-visible\s*\{[^}]*outline: 2px solid var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-categories button:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*z-index: 30;/s);
  assert.match(styles, /\.trading-market-chart-panel\s*\{[^}]*z-index: 1;/s);
  assert.match(styles, /\.trading-market-picker\s*\{[^}]*z-index: 100;[^}]*width: 576px;[^}]*max-width: min\(576px,[^}]*background: var\(--trading-market-panel\);/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\.left-panel-collapsed:not\(\.trading-expert-chart-collapsed\)[\s\S]*?\.trading-market-picker\s*\{[^}]*left: 40px;/s);
  assert.match(styles, /\.trading-market-picker-search\s*\{[^}]*border: 0;[^}]*background: var\(--trading-market-control\);/s);
  assert.match(styles, /\.trading-market-picker-search:hover,[\s\S]*?\.trading-market-picker-search:focus-within\s*\{[^}]*background: var\(--trading-market-control-hover\);[^}]*box-shadow: none;/s);
  assert.match(styles, /\.trading-market-picker input:focus-visible\s*\{[^}]*outline: 0;/s);
  assert.doesNotMatch(styles, /\.trading-market-picker-search:focus-within\s*\{[^}]*(?:border-color|trading-market-accent)/s);
  assert.match(styles, /--trading-market-control: #f0f3f7;[\s\S]*--trading-market-control-hover: #e6ebf2;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-control: #212224;[\s\S]*--trading-market-control-hover: #172337;/s);
  assert.match(styles, /\.trading-market-picker-head,[\s\S]*?\.trading-market-row\s*\{[^}]*grid-template-columns: minmax\(0, 1\.65fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 0\.8fr\) 32px;/s);
  assert.match(styles, /\.trading-market-picker-search\s*\{[^}]*margin: 10px 12px 6px;/s);
  assert.match(styles, /\.trading-market-picker-head\s*\{[^}]*padding: 0 20px 0 12px;/s);
  assert.match(styles, /\.trading-market-row\s*\{[^}]*min-height: 44px;[^}]*padding: 5px 7px;/s);
  assert.match(styles, /\.trading-market-picker-head > \*,[\s\S]*?\.trading-market-row > em\s*\{[^}]*justify-self: stretch;[^}]*text-align: left;/s);
  assert.doesNotMatch(styles, /\.trading-market-row-number\s*\{/);
  assert.doesNotMatch(styles, /\.trading-market-picker-search > button/);
  assert.match(styles, /\.trading-market-asset-logo\s*\{[^}]*border-radius: 50%;[^}]*background: var\(--trading-market-logo-bg\);/s);
  assert.match(styles, /\.trading-market-asset-logo > \.trading-market-asset-mark\s*\{[^}]*background: #3d74d8;[^}]*color: #ffffff;/s);
  assert.match(styles, /\.trading-market-asset-mark\.asset-class-commodity\s*\{[^}]*background: #dca52a;/s);
  assert.match(styles, /\.trading-market-asset-mark\.asset-symbol-sndk\s*\{[^}]*background: #df0014;/s);
  assert.match(styles, /\.trading-market-asset-mark\.asset-symbol-xag\s*\{[^}]*background: #a7abb6;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-asset-mark\.asset-class-commodity\s*\{[^}]*background: #c9931e;[^}]*color: #fff2b4;/s);
  assert.match(styles, /\.trading-market-asset-mark > svg\s*\{[^}]*stroke: currentColor;[^}]*opacity: 0\.42;/s);
  assert.match(styles, /\.trading-market-contract-tag\s*\{[^}]*background: var\(--trading-market-tag-bg\);[^}]*color: var\(--trading-market-tag-text\);/s);
  assert.match(styles, /\.trading-market-row\.selected \.trading-market-contract-tag\s*\{[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-row > b,[\s\S]*?\.trading-market-row > em\s*\{[^}]*text-align: left;/s);
  assert.doesNotMatch(styles, /\.trading-market-picker-toolbar|\.trading-market-indicator-count/);
  assert.match(styles, /\.trading-market-row:hover \.trading-market-row-select,[\s\S]*?background: var\(--trading-market-accent-soft\);/);
  assert.match(styles, /\.trading-market-row-select:active\s*\{[^}]*background: color-mix\(in srgb, var\(--trading-market-accent\) 14%, transparent\);/s);
  assert.match(styles, /\.trading-market-list\s*\{[^}]*Six 44px rows[^}]*max-height: min\(270px, calc\(100vh - 216px\)\);[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;[^}]*scrollbar-gutter: stable;[^}]*touch-action: pan-y;/s);
  assert.match(styles, /\.trading-market-list::-webkit-scrollbar-thumb\s*\{[^}]*background-color: var\(--trading-market-scrollbar-thumb\);/s);
  assert.match(styles, /--trading-market-scrollbar-thumb: rgba\(91, 108, 132, 0\.52\);[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-scrollbar-thumb: rgba\(148, 161, 181, 0\.5\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-panel: #0f1014;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-logo-bg: #171a20;[\s\S]*--trading-market-tag-bg: #24282f;/s);
});

test("Trading Expert auto-favorites every successfully opened picker result", async () => {
  const source = await marketSource;

  assert.match(source, /shouldAutoFavoriteTradingMarketSelection\(action\)/);
  assert.doesNotMatch(source, /shouldAutoFavoriteTradingMarketSelection\(action, this\.search\.value\)/);
  assert.match(source, /market && autoFavorite && this\.addFavoriteMarket\(market\)[\s\S]*?this\.commitFavoriteMarketChanges\(\)/);
  assert.match(source, /if \(!this\.selectMarket\(market\)\)[\s\S]*?const favoriteAdded = autoFavorite && this\.addFavoriteMarket\(market\)[\s\S]*?this\.commitFavoriteMarketChanges\(false\)/);
  assert.match(source, /private addFavoriteMarket\(market: TradingMarket\)[\s\S]*?this\.favoriteSymbols\.has\(market\.id\)[\s\S]*?this\.favoriteMarketRecords\.has\(market\.id\)[\s\S]*?if \(alreadyFavorite && hasStableFavorite\) return false;[\s\S]*?this\.favoriteMarketRecords\.set\(market\.id, tradingFavoriteRecord\(market\)\)/);
});

test("Trading Expert favorites persist, lead the next open, and remain available in the full directory", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const renderer = await mainSource;
  const favoriteTickerSort = await favoriteTickerSortSource;
  const pickerOpen = sourceBlock(source, "private setPickerOpen", "private setPeriodEditorOpen");
  const marketRender = sourceBlock(source, "private renderMarkets", "private restoreMarketListScroll");
  const tickerRender = sourceBlock(source, "private favoriteTickerMarkets()", "private scheduleFavoriteTickerPaint()");
  const tickerStreams = sourceBlock(source, "private syncFavoriteTickerStreams()", "private toggleFavoriteMarket");

  assert.match(source, /const TRADING_FAVORITES_STORAGE_KEY = "haolo\.trading-market\.favorites\.v1"/);
  assert.match(source, /const DEFAULT_TRADING_FAVORITE_SYMBOLS = \["BTCUSDT", "ETHUSDT"\] as const/);
  assert.match(source, /if \(rawSymbols === null && rawRecords === null\)[\s\S]*?DEFAULT_TRADING_FAVORITE_SYMBOLS/);
  assert.match(source, /export function tradingFavoriteStorageKeys\(accountIdentity = ""\)/);
  assert.match(source, /loadTradingFavoritesFromStorage\([\s\S]*?window\.localStorage,[\s\S]*?this\.favoriteStorageAccountIdentity/);
  assert.match(source, /saveTradingFavoritesToStorage\([\s\S]*?window\.localStorage,[\s\S]*?this\.favoriteStorageAccountIdentity/);
  assert.match(source, /removeLegacy: this\.favoriteStorageMigratedFromLegacy/);
  assert.match(renderer, /function tradingExpertFavoriteStorageAccountIdentity\(\)[\s\S]*?state\.auth\.profile\?\.id[\s\S]*?state\.auth\.baseUrl/);
  assert.match(renderer, /syncTradingExpertMarketWorkspace\([\s\S]*?tradingExpertFavoriteStorageAccountIdentity\(\)/);
  assert.match(source, /if \(action === "favorite"\)[\s\S]*?this\.toggleFavoriteMarket\(market\)/);
  assert.match(source, /if \(action === "add-favorite"\)[\s\S]*?this\.setPickerOpen\(true\)/);
  assert.match(source, /if \(action === "remove-favorite"\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?this\.toggleFavoriteMarket\(market\)/);
  assert.match(source, /const TRADING_FAVORITE_MARKETS_STORAGE_KEY = "haolo\.trading-market\.favorite-records\.v1"/);
  assert.match(source, /export const MAX_TRADING_FAVORITE_TICKERS = 20/);
  assert.match(source, /data-market-favorite-tickers[\s\S]*?data-market-period-controls/);
  assert.match(pickerOpen, /this\.search\.value = ""/);
  assert.match(pickerOpen, /this\.showFavoritesOnly = false/);
  assert.match(pickerOpen, /this\.renderMarkets\(\{ resetScroll: true \}\)/);
  assert.match(marketRender, /const favoritesOnly = !query && this\.showFavoritesOnly && this\.favoriteSymbols\.size > 0/);
  assert.match(marketRender, /tradingMarketVisibleInPicker\([\s\S]*?market,[\s\S]*?query,[\s\S]*?this\.favoriteSymbols,[\s\S]*?favoritesOnly/);
  assert.match(marketRender, /const orderedMarkets = orderTradingMarketPickerResults\(matchingMarkets, this\.favoriteSymbols\)/);
  assert.match(marketRender, /const markets = orderedMarkets/);
  assert.match(marketRender, /if \(this\.picker\.hidden\) return/);
  assert.match(marketRender, /const chunkSize = 48/);
  assert.match(marketRender, /setTimeout\(\(\) => appendChunk\(0\), 0\)/);
  assert.match(source, /export function orderTradingMarketPickerResults\([\s\S]*?favoriteSymbols[\s\S]*?return \[\.\.\.favorites, \.\.\.others\]/);
  assert.match(source, /export function tradingMarketCandleCacheKey\([\s\S]*?provider[\s\S]*?interval/);
  assert.match(source, /getTradingMarketCandleCache\(candleCacheKey\)/);
  assert.match(source, /if \(cachedSnapshotUsable\)[\s\S]*?commitMarketSnapshot/);
  assert.match(source, /setTradingMarketCandleCache\(candleCacheKey, \{ stats: finalStats, candleBatch: finalCandleBatch \}\)/);
  assert.match(marketRender, /class="trading-market-favorite\$\{favorite \? " active" : ""\}"/);
  assert.match(marketRender, /data-market-action="favorite"/);
  assert.match(marketRender, /aria-pressed="\$\{favorite\}"/);
  assert.match(marketRender, /title="\$\{favorite \? "取消收藏" : "添加收藏"\}"/);
  assert.match(source, /function renderMarketFavoriteIcon\(\)[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(tickerRender, /record\.assetClass === "crypto"[\s\S]*?this\.favoriteSymbols\.has\(record\.id\)[\s\S]*?slice\(0, MAX_TRADING_FAVORITE_TICKERS\)/);
  assert.match(tickerRender, /data-market-action="favorite-symbol"/);
  assert.match(tickerRender, /data-market-favorite-sort-item/);
  assert.match(tickerRender, /aria-posinset="\$\{tickerIndex \+ 1\}"[\s\S]*?aria-setsize="\$\{markets\.length\}"/);
  assert.match(tickerRender, /class="trading-market-favorite-sort-status" data-market-favorite-sort-status aria-live="polite"/);
  assert.match(tickerRender, /data-quote-state="\$\{market\.quoteAvailable \? "live" : "loading"\}"[\s\S]*?aria-busy="\$\{!market\.quoteAvailable\}"/);
  assert.match(tickerRender, /data-market-favorite-price[\s\S]*?data-market-favorite-change/);
  assert.match(tickerRender, /class="trading-market-favorite-remove"[\s\S]*?data-market-action="remove-favorite"[\s\S]*?data-market-favorite-sort-ignore[\s\S]*?取消收藏/);
  assert.match(tickerRender, /class="trading-market-favorite-add"[\s\S]*?data-market-action="add-favorite"[\s\S]*?aria-label="添加收藏交易对"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-expanded="false"/);
  assert.match(tickerRender, /this\.favoriteTickerBar\.hidden = false/);
  assert.doesNotMatch(tickerRender, /renderTradingMarketAssetLogo/);
  assert.match(source, /action === "symbol" \|\| action === "favorite-symbol"[\s\S]*?this\.selectMarket\(market\)[\s\S]*?this\.restartMarketData\(\{ preserveChart: true \}\)/);
  assert.match(tickerRender, /this\.favoriteTickerMarketsById\.get\(record\.id\)/);
  assert.match(tickerStreams, /const streamMarkets = new Map\(this\.favoriteTickerMarketsById\)/);
  assert.match(tickerStreams, /\[\.\.\.streamMarkets\.values\(\)\]/);
  assert.match(source, /tradingFavoriteTickerStreams[\s\S]*?`\$\{symbol\}@ticker`/);
  assert.match(tickerStreams, /subscribeBinanceMarketStreams\([\s\S]*?tradingFavoriteTickerStreams\(marketBySymbol\.keys\(\)\)/);
  assert.doesNotMatch(tickerStreams, /new WebSocket|resolveBinanceMarketStreamEndpoint/);
  assert.match(tickerStreams, /payload\?\.e !== "24hrTicker"[\s\S]*?applyTradingMarketTickerQuote\([\s\S]*?lastPrice: payload\.c[\s\S]*?openPrice: payload\.o/);
  assert.match(tickerStreams, /favoriteTickerSocketUpdatesByMarketId\.set\(market\.id, Date\.now\(\)\)[\s\S]*?scheduleFavoriteTickerPaint/);
  assert.match(source, /refreshFavoriteTickerFallback[\s\S]*?FAVORITE_TICKER_SOCKET_STALE_MS[\s\S]*?"\/fapi\/v1\/ticker\/24hr"[\s\S]*?"\/api\/v3\/ticker\/24hr"/);
  assert.match(source, /formatTradingMarketTickerPrice[\s\S]*?Math\.abs\(value\) < 1[\s\S]*?marketFocusedPriceFormatFor\(value\)\.precision/);
  assert.match(source, /const latestPrice = this\.selectedMarketType === "spot" \? this\.stats\.markPrice : this\.stats\.midPrice[\s\S]*?selectedFavorite\.markPrice = latestPrice/);
  assert.match(styles, /\.trading-market-picker-head > :nth-child\(3\),[\s\S]*?\.trading-market-row > em\s*\{[^}]*transform: translateX\(-13px\);/s);
  assert.match(styles, /\.trading-market-favorite > svg\s*\{[^}]*fill: transparent;[^}]*stroke: currentColor;/s);
  assert.match(styles, /\.trading-market-favorite\.active > svg\s*\{[^}]*fill: currentColor;/s);
  assert.match(styles, /\.trading-market-favorite:hover\s*\{[^}]*background: transparent;[^}]*color: var\(--trading-market-favorite-fill\);/s);
  assert.match(styles, /\.trading-market-favorite:focus-visible\s*\{[^}]*outline: 2px solid var\(--trading-market-favorite-fill\);/s);
  assert.match(styles, /\.trading-market-favorite:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(
    styles,
    /\.app-titlebar:has\(\.titlebar-market-favorites-host:not\(\[hidden\]\)\)[\s\S]*?> \.titlebar-drag-region\s*\{[^}]*position: static;/s,
  );
  assert.match(
    styles,
    /\.titlebar-market-favorites-host\s*\{[^}]*position: absolute;[^}]*right: 144px;[^}]*left: var\(--conversation-list-width\);[^}]*margin: 0;[^}]*overflow: hidden;/s,
  );
  assert.match(styles, /\.desktop-shell:has\(\.titlebar-market-favorites-host:not\(\[hidden\]\)\)\s*> \.desktop-body\.trading-expert-layout\s*> \.trading-expert-chat-panel\s*\{\s*border-top-left-radius: 0;/s);
  assert.match(styles, /\.desktop-body > :is\([\s\S]*?\.trading-expert-chat-panel,[\s\S]*?\.binance-account-page,[\s\S]*?\.trading-alerts-page[\s\S]*?\)\s*\{\s*border-top-left-radius: 16px;/s);
  assert.match(styles, /\.titlebar-market-favorites-host\s*\{[^}]*--trading-market-selected-background: #fff;/s);
  assert.match(styles, /\.titlebar-market-favorites-host\[hidden\]\s*\{\s*display: none;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.titlebar-market-favorites-host\s*\{[^}]*--trading-market-positive: #52dc88;[^}]*--trading-market-negative: #ff718e;[^}]*--trading-market-selected-background: #1b1e23;/s);
  assert.match(renderer, /const showTradingExpertFavoriteTickers =\s*state\.activeView === "chat"\s*&& !state\.chatPreview\s*&& !state\.tradingExpertChartCollapsed\s*&& isTradingExpertThreadId\(state\.currentThreadId\)/s);
  assert.match(renderer, /data-titlebar-market-favorites-host\$\{showTradingExpertFavoriteTickers \? "" : " hidden"\}/);
  assert.match(styles, /\.trading-market-favorite-tickers\s*\{[^}]*flex: 1 1 auto;[^}]*gap: 4px;[^}]*overflow-x: hidden;[^}]*overflow-y: hidden;[^}]*overscroll-behavior-x: contain;[^}]*scrollbar-width: none;[^}]*touch-action: pan-x;/s);
  assert.match(styles, /\.trading-market-favorite-tickers\.sorting\s*\{[^}]*cursor: grabbing;[^}]*user-select: none;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\s*\{[^}]*width: 100px;[^}]*min-width: 0;[^}]*max-width: 100px;[^}]*flex: 0 1 100px;[^}]*background: transparent;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\s*\{[^}]*cursor: grab;[^}]*touch-action: none;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\.selected\s*\{[^}]*background: var\(--trading-market-selected-background\);/s);
  assert.match(styles, /\.trading-market-favorite-ticker\.selected\s*\{[^}]*width: max-content;[^}]*min-width: 132px;[^}]*max-width: 220px;[^}]*flex: 0 0 auto;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\.selected > strong\s*\{[^}]*color: var\(--trading-market-text\);/s);
  assert.match(styles, /\.trading-market-favorite-ticker\.sorting\s*\{[^}]*cursor: grabbing;[^}]*visibility: hidden;/s);
  assert.doesNotMatch(styles, /\.trading-market-favorite-ticker\.sorting\s*\{[^}]*opacity:/s);
  assert.match(styles, /\.trading-market-favorite-ticker-drag-ghost\s*\{[^}]*position: fixed;[^}]*z-index: 10000;[^}]*pointer-events: none;[^}]*background: #fff !important;[^}]*opacity: 1 !important;[^}]*transform: scale\(1\.035\);[^}]*border: 1px solid var\(--conversation-action-focus\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-favorite-ticker-drag-ghost\s*\{[^}]*background: #1b1e23 !important;[^}]*rgba\(0, 0, 0, 0\.58\);/s);
  assert.match(styles, /\.trading-market-favorite-sort-status\s*\{[^}]*position: fixed;[^}]*width: 1px;[^}]*height: 1px;[^}]*overflow: hidden;[^}]*clip-path: inset\(50%\);[^}]*pointer-events: none;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.trading-market-favorite-ticker-drag-ghost[\s\S]*?transform: none;/s);
  assert.match(styles, /\.trading-market-favorite-ticker:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.trading-market-favorite-ticker:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\[data-quote-state="loading"\] > span\s*\{[^}]*opacity: 0\.72;/s);
  assert.match(styles, /\.trading-market-favorite-ticker > strong\s*\{[^}]*text-overflow: ellipsis;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\s*\{[^}]*padding: 0 8px;/s);
  assert.match(styles, /\.trading-market-favorite-ticker b,[\s\S]*?\.trading-market-favorite-ticker em\s*\{[^}]*min-width: 0;/s);
  assert.match(styles, /\.trading-market-favorite-ticker em\s*\{[^}]*flex: 0 1 auto;/s);
  assert.match(styles, /\.trading-market-favorite-remove\s*\{[^}]*position: absolute;[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/s);
  assert.match(styles, /\.trading-market-favorite-ticker:hover > \.trading-market-favorite-remove,[\s\S]*?\.trading-market-favorite-ticker:focus-within > \.trading-market-favorite-remove[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;[\s\S]*?pointer-events: auto;/s);
  assert.match(styles, /\.trading-market-favorite-remove\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: center;[^}]*border: 0;[^}]*border-radius: 50%;[^}]*background: var\(--trading-market-muted\);[^}]*color: #fff;/s);
  assert.match(styles, /\.trading-market-favorite-remove:hover,[\s\S]*?\.trading-market-favorite-remove:focus-visible[\s\S]*?background: color-mix\(in srgb, var\(--trading-market-muted\) 78%, #000\);[\s\S]*?color: #fff;/s);
  assert.match(styles, /\.trading-market-favorite-remove > svg\s*\{[^}]*position: absolute;[^}]*top: 50%;[^}]*left: 50%;[^}]*width: 10px;[^}]*height: 10px;[^}]*transform: translate\(-50%, -50%\);[^}]*fill: none;[^}]*stroke: currentColor;/s);
  assert.match(styles, /\.trading-market-favorite-add\s*\{[^}]*width: 32px;[^}]*min-width: 32px;[^}]*flex: 0 0 32px;[^}]*background: transparent;[^}]*color: var\(--trading-market-muted\);/s);
  assert.match(styles, /\.trading-market-favorite-add:hover\s*\{[^}]*background: var\(--trading-market-control\);[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-favorite-add:focus-visible\s*\{[^}]*border-color: var\(--trading-market-accent\);[^}]*box-shadow: inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.trading-market-favorite-add:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(styles, /--trading-market-favorite-fill: var\(--brand-blue\);[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-favorite-fill: var\(--brand-blue\);/s);
  assert.doesNotMatch(styles, /--trading-market-favorite-(?:fill|soft): #[fF](?:5b800|fd24a|ff5cc)/);
  assert.match(source, /syncTitlebarFavoriteTickerHost\(\)[\s\S]*?\[data-titlebar-market-favorites-host\][\s\S]*?titlebarHost\.append\(this\.favoriteTickerBar\)/);
  assert.match(source, /private revealSelectedFavoriteTicker\(\)[\s\S]*?favoriteTickerBar\.scrollLeft[\s\S]*?private renderFavoriteTickerBar\(\)[\s\S]*?this\.revealSelectedFavoriteTicker\(\)/);
  assert.match(source, /host === activeWorkspaceHost[\s\S]*?activeWorkspace\.syncTitlebarFavoriteTickerHost\(\)/);
  assert.match(source, /this\.favoriteTickerBar\.addEventListener\("click", this\.handleFavoriteTickerClick\)/);
  assert.match(source, /this\.favoriteTickerBar\.addEventListener\("wheel", this\.handleFavoriteTickerScrollWheel, \{ passive: false \}\)/);
  assert.match(source, /private readonly handleFavoriteTickerClick = \(event: Event\) => \{\s*this\.handleClick\(event\);\s*event\.stopPropagation\(\);/);
  assert.match(source, /private readonly handleFavoriteTickerKeyDown = \(event: KeyboardEvent\)[\s\S]*?target\.click\(\)/);
  assert.match(source, /private readonly handleFavoriteTickerScrollWheel = \(event: WheelEvent\) => \{[\s\S]*?this\.favoriteTickerBar\.scrollLeft = nextScrollLeft;/);
  assert.match(source, /new TradingFavoriteTickerSortController\(\{[\s\S]*?onCommit: \(orderedMarketIds\) => this\.commitFavoriteTickerOrder\(orderedMarketIds\)/);
  assert.match(source, /reorderTradingFavoriteRecords\([\s\S]*?this\.favoriteMarketRecords = new Map[\s\S]*?this\.saveFavoriteSymbols\(\)/);
  assert.doesNotMatch(source, /normalizeTradingFavoriteSymbols\(snapshot\.symbols\)\.sort\(\)/);
  assert.match(favoriteTickerSort, /Math\.hypot\([\s\S]*?DRAG_START_DISTANCE_PX/);
  assert.match(favoriteTickerSort, /data-market-favorite-sort-ignore/);
  const pointerDownBlock = sourceBlock(favoriteTickerSort, "private readonly handlePointerDown", "private readonly handlePointerMove");
  const beginDragBlock = sourceBlock(favoriteTickerSort, "private beginDrag()", "private createGhost");
  assert.doesNotMatch(pointerDownBlock, /setPointerCapture/);
  assert.match(beginDragBlock, /this\.pointerId !== null[\s\S]*?this\.host\.setPointerCapture\?\.\(this\.pointerId\)/);
  assert.match(favoriteTickerSort, /this\.host\.hasPointerCapture\?\.\(pointerId\)[\s\S]*?this\.host\.releasePointerCapture\(pointerId\)/);
  assert.doesNotMatch(favoriteTickerSort, /item\.setPointerCapture/);
  assert.match(favoriteTickerSort, /this\.ghost = this\.createGhost\(this\.sourceItem, rect\);\s*this\.sourceItem\.classList\.add\("sorting"\)/);
  assert.match(favoriteTickerSort, /this\.host\.insertBefore\(this\.sourceItem, before\)[\s\S]*?this\.animateReorder\(previousRects\)/);
  assert.match(favoriteTickerSort, /AUTO_SCROLL_EDGE_PX[\s\S]*?requestAnimationFrame\([\s\S]*?this\.autoScrollStep\(\)/);
  assert.match(favoriteTickerSort, /event\.altKey[\s\S]*?"ArrowLeft"[\s\S]*?"ArrowRight"[\s\S]*?this\.onCommit\(this\.orderedMarketIds\(\)\)/);
  assert.match(favoriteTickerSort, /addEventListener\("click", this\.handleClickCapture, true\)[\s\S]*?event\.stopImmediatePropagation\(\)/);
  assert.match(favoriteTickerSort, /getPropertyValue\("--trading-market-selected-background"\)[\s\S]*?\.trim\(\) \|\| "#fff"[\s\S]*?setProperty\("background-color", solidBackground, "important"\)[\s\S]*?setProperty\("opacity", "1", "important"\)/);
});

test("Trading Expert uses backend-managed Finnhub without a visible provider status row", async () => {
  const [source, styles, desktopMain, preload, apiClient] = await Promise.all([
    marketSource,
    stylesSource,
    desktopMainSource,
    preloadSource,
    apiClientSource,
  ]);

  assert.match(source, /window\.codexDesktop\.searchFinnhubMarkets/);
  assert.match(source, /response\.status\?\.available === true/);
  assert.match(source, /const FINNHUB_SEARCH_DEBOUNCE_MS = 480/);
  assert.match(source, /TRADING_FAVORITE_MARKETS_STORAGE_KEY/);
  assert.match(source, /tradingMarketsPreferBinance/);
  assert.match(source, /BINANCE:SPOT:\$\{symbol\}/);
  assert.match(source, /marketType: "spot"/);
  assert.match(source, /tag: "现货"/);
  assert.match(source, /fetchBinanceSpot<BinanceExchangeInfo>\("\/api\/v3\/exchangeInfo"/);
  assert.match(source, /fetchBinanceMarket<unknown\[\]\[]>\(marketType, "\/fapi\/v1\/klines", "\/api\/v3\/klines"/);
  assert.match(source, /this\.selectedProvider === "binance" \? MARKET_SOCKET_FALLBACK_INTERVAL_MS : 60_000/);
  assert.match(desktopMain, /getYouleApiClient\(\)\.getFinnhubMarketDataStatus\(\)/);
  assert.match(preload, /getFinnhubMarketDataStatus: \(\) => ipcRenderer\.invoke\("marketData:getFinnhubStatus"\)/);
  assert.match(apiClient, /\/api\/market-data\/finnhub/);
  assert.doesNotMatch(source, /data-market-source-bar|data-market-finnhub-state|data-market-search-status|后台托管 · 用户免配置/);
  assert.doesNotMatch(source, /type="password"|data-market-finnhub-key|save-finnhub|test-finnhub/);
  assert.doesNotMatch(styles, /trading-market-source-bar|trading-market-finnhub-config|trading-market-search-status/);
});

test("Trading Expert market chart sits flush beneath a shadowless themed divider", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.trading-expert-market\s*\{[^}]*--trading-market-border: #e3e8ef;[^}]*gap: 0;/s,
  );
  assert.match(
    styles,
    /\.trading-market-overview\s*\{[^}]*border-bottom: 0;[^}]*box-shadow: none;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.trading-expert-market\s*\{[^}]*--trading-market-border: #1a2437;/s,
  );
});

test("Trading Expert keeps the quote strip DOM stable while updating hovered OHLC values", async () => {
  const source = await marketSource;
  const splitPane = await splitPaneSource;
  const styles = await stylesSource;
  const ohlcRenderer = sourceBlock(
    source,
    "private renderOhlc",
    "private clearOhlc",
  );
  const splitOhlcRenderer = sourceBlock(
    splitPane,
    "private renderOhlc",
    "private scheduleRefresh",
  );

  assert.match(source, /formatOhlcDateTime\(timeValue\)/);
  assert.match(source, /amplitudePercent = open \? \(\(high - low\) \/ open\) \* 100 : 0/);
  assert.match(source, /this\.renderOhlc\(candle, parameter\.time\)/);
  assert.match(source, /this\.renderOhlc\(candle, candle\.time \+ CHINA_TIME_OFFSET_SECONDS\)/);
  assert.match(source, /private hoveredOhlcSourceTime: number \| null = null/);
  assert.match(source, /this\.hoveredOhlcSourceTime = sourceTime;[\s\S]*?this\.renderOhlc\(candle, parameter\.time\)/);
  assert.match(source, /private renderLatestOhlc\(\)[\s\S]*?this\.hoveredOhlcSourceTime !== null[\s\S]*?this\.renderOhlc\(hovered, hovered\.time \+ CHINA_TIME_OFFSET_SECONDS\)/);
  assert.match(source, /this\.hoveredOhlcSourceTime = null;\s*this\.renderLatestOhlc\(\);/);
  assert.match(source, /private readonly handleViewportLeave = \(\) => \{[\s\S]*?this\.hoveredOhlcSourceTime = null;[\s\S]*?this\.renderLatestOhlc\(\);/);
  assert.match(source, /data-market-ohlc-time/);
  assert.equal((source.match(/data-market-ohlc-value=/g) ?? []).length, 6);
  assert.match(splitPane, /data-split-ohlc-time/);
  assert.equal((splitPane.match(/data-split-ohlc-value=/g) ?? []).length, 6);
  assert.match(splitPane, /private hoveredOhlcSourceTime: number \| null = null/);
  assert.match(splitPane, /this\.hoveredOhlcSourceTime = rawTime;[\s\S]*?this\.renderOhlc\(candle, parameter\.time\)/);
  assert.match(splitPane, /private renderLatestOhlc\(\)[\s\S]*?this\.hoveredOhlcSourceTime !== null[\s\S]*?this\.renderOhlc\(hovered, hovered\.time \+ CHINA_TIME_OFFSET_SECONDS\)/);
  assert.match(splitPane, /this\.viewportElement\.addEventListener\("pointerleave", this\.handleViewportLeave\)/);
  assert.match(splitPane, /private readonly handleViewportLeave = \(\) => \{[\s\S]*?this\.hoveredOhlcSourceTime = null;[\s\S]*?this\.renderLatestOhlc\(\);/);
  assert.match(ohlcRenderer, /const dateText = formatOhlcDateTime\(timeValue\)/);
  assert.match(ohlcRenderer, /this\.ohlcTimeElement\.textContent !== dateText/);
  assert.match(ohlcRenderer, /this\.ohlcValueElements\.forEach/);
  assert.match(ohlcRenderer, /if \(element\.textContent !== value\) element\.textContent = value/);
  assert.match(ohlcRenderer, /classList\.toggle\("positive"/);
  assert.match(ohlcRenderer, /classList\.toggle\("negative"/);
  assert.doesNotMatch(ohlcRenderer, /innerHTML|replaceChildren/);
  assert.doesNotMatch(sourceBlock(source, "private renderOhlc", "private async loadMoreHistory"), /innerHTML/);
  assert.match(splitOhlcRenderer, /this\.ohlcValueElements\.forEach/);
  assert.doesNotMatch(splitOhlcRenderer, /innerHTML|replaceChildren/);
  assert.match(styles, /\.trading-market-ohlc\s*\{[^}]*display: flex;[^}]*white-space: nowrap;/s);
  assert.doesNotMatch(
    styles,
    /\.trading-market-ohlc\s*\{[^}]*(?:background|border|box-shadow):/s,
  );
  assert.match(styles, /\.trading-market-ohlc\s*\{[^}]*font-size: calc\(11px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(styles, /\.trading-market-ohlc\s*\{[^}]*font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;[^}]*font-feature-settings: "zero" 0;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(source, /function formatOhlcPrice[\s\S]*?toFixed\(MARKET_PRICE_FORMAT\.precision\)/);
  assert.match(styles, /\.trading-market-ohlc time\s*\{[^}]*color: var\(--trading-market-ohlc-label\);[^}]*font-weight: 500;/s);
  assert.match(styles, /\.trading-market-ohlc-item > span\s*\{[^}]*color: var\(--trading-market-ohlc-label\);[^}]*font-weight: 500;/s);
  assert.match(styles, /\.trading-market-ohlc-item > b\s*\{[^}]*font-weight: 400;/s);
  assert.match(styles, /--trading-market-ohlc-label: #000000;[\s\S]*--trading-market-ohlc-positive: #078c53;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-ohlc-label: #f5f7fa;[\s\S]*--trading-market-ohlc-positive: #52dc88;/);
  assert.match(styles, /--trading-market-positive: #12a66a;[\s\S]*--trading-market-negative: #e54865;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-positive: #41d37c;[\s\S]*--trading-market-negative: #ff4f75;/);
});

test("Trading Expert uses two-decimal ticks and high-precision highlighted price markers", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const updateChartData = sourceBlock(
    source,
    "private updateChartData(options:",
    "private updateVisiblePriceScale()",
  );
  const syncCurrentPriceLine = sourceBlock(
    source,
    "private syncCurrentPriceLine",
    "private commitLoadedSelection",
  );

  assert.match(source, /background: "#ffffff",\s*text: "#000000"/);
  assert.match(source, /function marketPriceFormatFor[\s\S]*?return \{ \.\.\.MARKET_PRICE_FORMAT \};/);
  assert.match(source, /function marketFocusedPriceFormatFor[\s\S]*?const precision = Math\.max\(MARKET_PRICE_FORMAT\.precision, 6 - integerDigits\)/);
  assert.match(updateChartData, /this\.applyMarketPriceFormat\(lastRaw\.close\)/);
  assert.match(updateChartData, /this\.syncCurrentPriceLine\(lastRaw\)/);
  assert.match(syncCurrentPriceLine, /const lineColor = candle\.close >= candle\.open[\s\S]*?\? this\.chartSettings\.risingColor[\s\S]*?: this\.chartSettings\.fallingColor/);
  assert.match(syncCurrentPriceLine, /lineStyle: LineStyle\.Dashed/);
  assert.match(syncCurrentPriceLine, /axisLabelVisible: false/);
  assert.match(source, /this\.currentPriceElement\.textContent = formatFocusedPrice\(candle\.close\)/);
  assert.match(source, /this\.crosshairPriceElement\.textContent = formatFocusedPrice\(price\)/);
  assert.match(styles, /--trading-market-current-price: #269d4d;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-current-price: #45c979;/);
  assert.match(syncCurrentPriceLine, /axisLabelColor: lineColor/);
  assert.match(syncCurrentPriceLine, /axisLabelTextColor: "#ffffff"/);
});

test("Trading Expert defaults to solid Binance candles and can apply configured candle styling", async () => {
  const source = await marketSource;
  const indicators = await indicatorSource;
  const addPrimarySeries = sourceBlock(
    source,
    "private addPrimarySeries()",
    "private applyPrimarySeriesOptions()",
  );
  const updateChartData = sourceBlock(
    source,
    "private updateChartData(options:",
    "private updateVisiblePriceScale()",
  );
  const primarySeriesData = sourceBlock(
    source,
    "private primarySeriesData(",
    "private createChart()",
  );

  assert.match(indicators, /TRADING_RISING_BAR_COLOR = "#2EBD85"/);
  assert.match(indicators, /TRADING_FALLING_BAR_COLOR = "#F6465D"/);
  assert.match(addPrimarySeries, /upColor: this\.chartSettings\.hollowRising \? "rgba\(0,0,0,0\)" : this\.chartSettings\.risingColor/);
  assert.match(addPrimarySeries, /downColor: this\.chartSettings\.fallingColor/);
  assert.match(addPrimarySeries, /borderVisible: this\.chartSettings\.showCandleBorder/);
  assert.match(addPrimarySeries, /borderUpColor: this\.chartSettings\.risingColor/);
  assert.match(addPrimarySeries, /borderDownColor: this\.chartSettings\.fallingColor/);
  assert.match(addPrimarySeries, /wickVisible: this\.chartSettings\.showWicks/);
  assert.match(addPrimarySeries, /wickUpColor: this\.chartSettings\.risingColor/);
  assert.match(addPrimarySeries, /wickDownColor: this\.chartSettings\.fallingColor/);
  assert.match(primarySeriesData, /color: trendColor,[\s\S]*?borderColor: trendColor/);
  assert.match(primarySeriesData, /borderColor: trendColor,[\s\S]*?wickColor: trendColor/);
  const settingsSource = await chartSettingsSource;
  assert.match(settingsSource, /hollowRising: false/);
  assert.match(settingsSource, /risingColor: "#2EBD85"[\s\S]*?fallingColor: "#F6465D"/);
  assert.doesNotMatch(updateChartData, /rgba\(0, 0, 0, 0\)/);
});

test("Trading Expert keeps every price scale bright when switching to dark mode", async () => {
  const source = await marketSource;
  const createPane = sourceBlock(
    source,
    "private createIndicatorPane",
    "private createIndicatorLegend",
  );
  const applyTheme = sourceBlock(
    source,
    "private applyChartTheme()",
    "private clearChart()",
  );

  assert.match(source, /background: "#0f1014",\s*text: "#dfe1e3"/);
  assert.match(source, /rightPriceScale: \{[\s\S]*?textColor: theme\.text/s);
  assert.match(createPane, /priceScale\(\)\?\.applyOptions\(\{[\s\S]*?textColor: theme\.text/s);
  assert.match(applyTheme, /rightPriceScale: \{[\s\S]*?textColor: theme\.text/s);
  assert.match(applyTheme, /this\.indicatorPanes\.forEach[\s\S]*?priceScale\(\)\?\.applyOptions\(\{[\s\S]*?textColor: theme\.text/s);
  assert.match(source, /attributeFilter: \["data-theme"\]/);
});

test("Trading Expert subchart indicators cover pane behavior and both themes", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const rebuildPanes = sourceBlock(
    source,
    "private rebuildIndicatorPanes()",
    "private createIndicatorPane",
  );
  const createPane = sourceBlock(
    source,
    "private createIndicatorPane",
    "private createIndicatorLegend",
  );
  const updateIndicatorData = sourceBlock(
    source,
    "private updateIndicatorData",
    "private updateIndicatorLegends",
  );

  assert.match(source, /data-market-action="indicator"/);
  assert.match(source, /const HIDDEN_TRADING_INDICATORS: ReadonlySet<TradingIndicatorId> = new Set\(\[/);
  assert.match(source, /"momentum",[\s\S]*"roc",[\s\S]*"obv",[\s\S]*"mfi",[\s\S]*"willr",/);
  assert.match(source, /TRADING_INDICATORS[\s\S]*?\.filter\(\(indicator\) => !HIDDEN_TRADING_INDICATORS\.has\(indicator\.id\)\)/);
  assert.match(source, /TRADING_INDICATORS[\s\S]*?\.map\(\(indicator\) =>/);
  assert.match(source, /calculateTradingIndicator\(id, this\.candles, setting\.parameters\)/);
  assert.match(source, /this\.chart\.addPane\(false\)/);
  assert.match(source, /this\.chart\.removePane\(index\)/);
  assert.match(source, /pane\.setStretchFactor\(1\)/);
  assert.match(source, /updateIndicatorLegends\(parameter\?\.seriesData\)/);
  assert.match(rebuildPanes, /this\.rebuildingIndicatorPanes = true/);
  assert.match(rebuildPanes, /this\.chart\?\.removeSeries\(seriesRuntime\.api\)/);
  assert.ok(
    rebuildPanes.indexOf("removeSeries(seriesRuntime.api)")
      < rebuildPanes.indexOf("removePane(index)"),
    "subchart series must leave the shared time scale before their panes are removed",
  );
  assert.match(rebuildPanes, /finally \{\s*this\.rebuildingIndicatorPanes = false/);
  assert.match(createPane, /priceScale\(\)\?\.applyOptions\(\{\s*autoScale: true,/);
  assert.match(createPane, /descriptor\.type === "histogram"[\s\S]*?pane\.addSeries\(HistogramSeries/);
  assert.match(updateIndicatorData, /descriptor\.colors\?\.\[index\][\s\S]*?color: descriptor\.colors\[index\]/);
  assert.doesNotMatch(createPane, /descriptor\.barStyle|rgba\(0, 0, 0, 0\)/);
  assert.doesNotMatch(updateIndicatorData, /descriptor\.barStyle/);
  assert.match(updateIndicatorData, /priceScale\(\)\?\.setAutoScale\(true\)/);
  assert.match(source, /current\?\.value \?\? current\?\.high \?\? seriesRuntime\.latestValue/);
  assert.match(source, /subscribeVisibleLogicalRangeChange\(\(range: any\) => \{[\s\S]*?this\.rebuildingIndicatorPanes/);

  assert.match(styles, /\.trading-market-indicator-bar\s*\{[^}]*border-top: 0;[^}]*background: var\(--trading-market-panel\)/s);
  assert.match(styles, /\.trading-market-indicators button\s*\{[^}]*color: var\(--trading-market-muted\)/s);
  assert.match(styles, /\.trading-market-indicators button:hover\s*\{[^}]*background: var\(--trading-market-control\)/s);
  assert.match(styles, /\.trading-market-indicators button:active\s*\{[^}]*transform: translateY\(1px\)/s);
  assert.match(styles, /\.trading-market-indicators button\.active,[\s\S]*?button\[aria-pressed="true"\][\s\S]*?border-color: transparent;[\s\S]*?background: transparent;[\s\S]*?color: var\(--trading-market-indicator-selected\)/);
  assert.match(styles, /\.trading-market-indicators button:focus-visible,[\s\S]*?outline: 2px solid #2da6f7/);
  assert.match(styles, /\.trading-market-indicators button:disabled\s*\{[^}]*opacity: 0\.45/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-control: #212224;[\s\S]*?--trading-market-control-hover: #172337;/);
});

test("Trading Expert adds functional main-chart studies on the left and moves subcharts right", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const indicatorBar = sourceBlock(
    source,
    '<footer class="trading-market-indicator-bar"',
    "</footer>",
  );

  assert.match(source, /export type TradingMainIndicatorId = "ma" \| "ema" \| "boll" \| "td" \| "bbi" \| "vpvr";/);
  assert.match(source, /\{ id: "ma", label: "MA"/);
  assert.match(source, /\{ id: "ema", label: "EMA"/);
  assert.match(source, /\{ id: "boll", label: "BOLL"/);
  assert.match(source, /\{ id: "td", label: "TD"/);
  assert.match(source, /\{ id: "bbi", label: "BBI"/);
  assert.match(source, /\{ id: "vpvr", label: "VPVR"/);
  assert.match(source, /data-market-action="main-indicator"/);
  assert.match(source, /setting\.enabled = !setting\.enabled;[\s\S]*this\.syncActiveIndicatorsFromSettings\(\)/);
  assert.match(source, /setting\("ma"\)\.parameters\.map\([\s\S]*computeSma\(closes, period\)[\s\S]*setting\("ema"\)\.parameters\.map\([\s\S]*computeEma\(closes, period\)/);
  assert.match(source, /computeBollingerBands\(closes, setting\("boll"\)\.parameters\[0\], setting\("boll"\)\.parameters\[1\]\)/);
  assert.match(source, /computeBbi\(closes, setting\("bbi"\)\.parameters\)/);
  assert.match(source, /createSeriesMarkers\(this\.candleSeries/);
  assert.match(source, /const tdSignals = isActive\("td"\) \? computeTdSequential\(candles, tdSetting\.parameters\[0\]\) : \[\]/);
  assert.ok(indicatorBar.indexOf("data-market-main-indicators") < indicatorBar.indexOf("data-market-indicators"));
  assert.match(styles, /\.trading-drawing-toolbar\s*\{[^}]*width: 41\.6px;[^}]*flex: 0 0 41\.6px;[^}]*margin-bottom: 42px;/s);
  assert.match(styles, /\.trading-expert-market\.split-layout-active \.trading-drawing-toolbar\s*\{[^}]*margin-bottom: 32px;/s);
  assert.doesNotMatch(styles, /\.desktop-body\.trading-expert-layout[^,{]*\s+\.trading-drawing-toolbar\s*\{\s*display: none;/s);
  assert.match(styles, /\.trading-market-chart-panel\s*\{[^}]*overflow: visible;/s);
  assert.match(styles, /\.trading-market-chart-viewport\s*\{[^}]*overflow: hidden;/s);
  assert.match(styles, /\.trading-expert-market:not\(\.split-layout-active\) \.trading-market-chart-grid,[\s\S]*?\.trading-market-chart-grid > \.trading-market-primary-pane\s*\{[^}]*overflow: visible;/s);
  assert.match(styles, /\.trading-market-indicator-bar\s*\{[^}]*width: calc\(100% \+ 41\.6px\);[^}]*margin-left: -41\.6px;[^}]*padding: 0 11px 0 10px;/s);
  assert.doesNotMatch(styles, /\.desktop-body\.trading-expert-layout:not\(\.left-panel-collapsed\)\s+\.trading-market-indicator-bar\s*\{/s);
  assert.match(styles, /\.trading-market-indicators\s*\{[^}]*justify-content: flex-end;[^}]*margin-left: auto;/s);
  assert.match(styles, /\.trading-market-main-indicators button\.active,[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;[\s\S]*?color: var\(--trading-market-indicator-selected\);/);
  assert.doesNotMatch(styles, /\.trading-market-main-indicators button\.active::after|\.trading-market-indicators button\.active::after/);
  assert.match(styles, /--trading-market-indicator-selected: #5b95e5;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-indicator-selected: #82b6ff;/);
  assert.match(source, /TRADING_MAIN_INDICATOR_LINE_COLORS = \["#d1ab2e", "#2dccac", "#c935cc"\]/);
  assert.match(source, /ma: \[\.\.\.TRADING_MAIN_INDICATOR_LINE_COLORS\],[\s\S]*ema: \[\.\.\.TRADING_MAIN_INDICATOR_LINE_COLORS\],[\s\S]*boll: \[\.\.\.TRADING_MAIN_INDICATOR_LINE_COLORS\],/);
  assert.match(source, /const addReferenceWidthLines = \(colors: string\[\]\) =>[\s\S]*index === 1 \? 2 : 1/);
  assert.match(source, /set\("ma", addReferenceWidthLines\(palette\.ma\)\)[\s\S]*set\("ema", addReferenceWidthLines\(palette\.ema\)\)[\s\S]*set\("boll", addReferenceWidthLines\(palette\.boll\)\)/);
  assert.doesNotMatch(styles, /trading-market-modes/);
});

test("Trading Expert shows selected main-indicator values below OHLC in reference format", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const legendUpdate = sourceBlock(
    source,
    "private updateMainIndicatorLegends",
    "private rebuildIndicatorPanes",
  );

  assert.match(source, /data-market-main-indicator-legends/);
  assert.match(source, /this\.updateMainIndicatorLegends\(parameter\?\.time\)/);
  assert.match(source, /this\.renderLatestOhlc\(\);\s*this\.updateMainIndicatorLegends\(\);/);
  assert.match(legendUpdate, /appendRow\("ma", "MA", \["short", "medium", "long"\]\.flatMap/);
  assert.match(legendUpdate, /label: `MA\(\$\{setting\.parameters\[index\]\}\)`/);
  assert.match(legendUpdate, /appendRow\("ema", "EMA", \["short", "medium", "long"\]\.flatMap/);
  assert.match(legendUpdate, /label: `EMA\(\$\{setting\.parameters\[index\]\}\)`/);
  assert.match(legendUpdate, /appendRow\("boll", `BOLL\(\$\{setting\.parameters\.join\(","\)\}\)`, \[/);
  assert.match(legendUpdate, /label: "BOLL"[\s\S]*label: "UB"[\s\S]*label: "LB"/);
  assert.match(legendUpdate, /`\$\{item\.label\}:\$\{formatValue\(item\.value\)\}`/);
  assert.match(styles, /\.trading-market-main-indicator-legends\s*\{[^}]*top: 29px;[^}]*left: 12px;[^}]*display: grid;/s);
  assert.match(styles, /\.trading-market-main-indicator-legend span\s*\{[^}]*color: var\(--main-indicator-series-color\);/s);
});

test("Trading Expert exposes multi-select TradingView-style indicator panes", async () => {
  const source = await marketSource;
  const indicators = await indicatorSource;
  const styles = await stylesSource;

  assert.match(source, /data-market-action="indicator"/);
  assert.match(source, /this\.chart\.addPane\(false\)/);
  assert.match(source, /this\.chart\.removePane\(index\)/);
  assert.match(source, /tradingIndicatorSettingKey\("sub", indicator\)[\s\S]*setting\.enabled = !setting\.enabled;[\s\S]*this\.syncActiveIndicatorsFromSettings\(\)/);
  assert.match(source, /class="trading-market-indicator-bar"/);
  assert.match(source, /className = "trading-market-indicator-legend"/);
  assert.match(styles, /\.trading-market-indicator-legend strong,\s*\.trading-market-indicator-legend span\s*\{[^}]*font-weight: 400;/s);
  assert.match(indicators, /id: "volume"/);
  assert.match(indicators, /id: "macd"/);
  assert.match(indicators, /id: "rsi"/);
  assert.match(indicators, /id: "kdj"/);
  assert.match(indicators, /id: "adx"/);
  assert.match(indicators, /id: "mfi"/);
  assert.match(styles, /\.trading-market-indicators button\.active,/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market/);
  assert.match(styles, /\.trading-market-indicators button:disabled/);
});

test("Trading Expert keeps the live chart workspace across renders and page navigation", async () => {
  const source = await mainSource;
  const market = await marketSource;
  const preservationBlock = sourceBlock(
    source,
    "function preserveTradingExpertMarketWorkspace",
    "function restorePreviewVideoPlayback",
  );
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const marketSyncBlock = sourceBlock(
    market,
    "export function syncTradingExpertMarketWorkspace",
    "export function applyTradingExpertCustomIndicatorMentions",
  );

  assert.match(preservationBlock, /host\.remove\(\)/);
  assert.match(preservationBlock, /freshHost\.replaceWith\(preserved\.host\)/);
  assert.match(source, /let parkedTradingExpertMarketWorkspace: PreservedTradingExpertMarketWorkspace \| null = null/);
  assert.match(
    preservationBlock,
    /return parkedTradingExpertMarketWorkspace;[\s\S]*?parkedTradingExpertMarketWorkspace = preserved;/,
    "an already detached chart must survive subsequent renders on non-chart pages",
  );
  assert.match(
    preservationBlock,
    /if \(!targetThreadId\) \{[\s\S]*?parkedTradingExpertMarketWorkspace = preserved;[\s\S]*?return;/,
    "leaving New Task must park the live chart instead of destroying it",
  );
  assert.match(
    preservationBlock,
    /freshHost\.replaceWith\(preserved\.host\);[\s\S]*?parkedTradingExpertMarketWorkspace = null;[\s\S]*?syncTradingExpertMarketWorkspace\(/,
    "returning to the task must reattach the same chart before workspace sync",
  );
  assert.match(
    preservationBlock,
    /syncTradingExpertMarketWorkspace\([\s\S]*?preserved\.host,[\s\S]*?tradingExpertFavoriteStorageAccountIdentity\(\)/,
  );
  assert.match(source, /const tradingExpertWorkspaceThreadReplacements = new Map<string, string>\(\)/);
  assert.match(
    source,
    /if \(wasTradingExpertThread\) \{[\s\S]*?tradingExpertThreadIds\.add\(nextThreadId\);[\s\S]*?tradingExpertWorkspaceThreadReplacements\.set\(previousThreadId, nextThreadId\);/,
  );
  assert.match(
    preservationBlock,
    /targetThreadId === preserved\.threadId \|\| targetThreadId === replacementThreadId/,
    "promoting a blank Trading Expert task must keep the already selected chart and interval",
  );
  assert.match(renderBlock, /const preservedTradingExpertMarketWorkspace = preserveTradingExpertMarketWorkspace\(\)/);
  assert.match(renderBlock, /restorePreservedTradingExpertMarketWorkspace\([\s\S]*?tradingExpertLayout \? thread\?\.id : null/);
  assert.doesNotMatch(
    renderBlock,
    /suppressScrollDetection\(\);\s*syncTradingExpertMarketWorkspace\(null\);/,
  );
  assert.match(
    renderBlock,
    /if \(shouldShowLoginWindow\(\)\) \{[\s\S]*?parkedTradingExpertMarketWorkspace = null;[\s\S]*?syncTradingExpertMarketWorkspace\(null\);/,
    "logout must still dispose any parked account-scoped chart",
  );
  assert.match(
    marketSyncBlock,
    /host === activeWorkspaceHost[\s\S]*&& activeWorkspace[\s\S]*activeWorkspace\.restorePreservedViewState\(\);[\s\S]*return;/,
  );
  assert.ok(
    marketSyncBlock.indexOf("return;") < marketSyncBlock.indexOf("activeWorkspace?.destroy()"),
    "the preserved chart instance must return before destroy/recreate",
  );
});

test("Trading Expert switches symbols and periods without exposing stale chart data", async () => {
  const source = await marketSource;
  const restartBlock = sourceBlock(
    source,
    "private async restartMarketData",
    "private async refreshSnapshot",
  );
  const commitSnapshotBlock = sourceBlock(
    source,
    "private commitMarketSnapshot",
    "private async restartMarketData",
  );
  const viewportResetBlock = sourceBlock(
    source,
    "private updateChartData(options:",
    "private updateVisiblePriceScale()",
  );
  const clearMarketErrorBlock = sourceBlock(
    source,
    "private clearMarketError()",
    "private updateChartData(options:",
  );
  const historyBlock = sourceBlock(
    source,
    "private async loadMoreHistory",
    "private setLoading",
  );
  const preservedSwitches = source.match(/restartMarketData\(\{ preserveChart: true \}\)/g) ?? [];

  assert.equal(preservedSwitches.length, 5);
  assert.match(restartBlock, /const targetSymbol = this\.selectedSymbol/);
  assert.match(restartBlock, /const targetInterval = this\.activeInterval/);
  assert.match(restartBlock, /const keepChart = options\.preserveChart === true && this\.candles\.length > 0/);
  assert.match(restartBlock, /this\.setLoading\(true\)/);
  assert.match(restartBlock, /this\.clearMarketError\(\)/);
  assert.match(restartBlock, /this\.hideCrosshairTimeLabel\(\)/);
  assert.match(restartBlock, /this\.hideCrosshairPriceLabel\(\)/);
  assert.match(restartBlock, /this\.currentPriceElement\.hidden = true/);
  assert.match(
    restartBlock,
    /this\.stats = null;[\s\S]*?this\.candles = \[\];[\s\S]*?this\.sourceCandles = \[\];[\s\S]*?if \(keepChart\) this\.chartCandles = \[\];[\s\S]*?else this\.clearChart\(\)/,
  );
  assert.match(restartBlock, /fetchTradingCandles\([\s\S]*?targetSymbol,[\s\S]*?targetInterval,[\s\S]*?500,[\s\S]*?targetMarketType === "spot"/);
  assert.match(restartBlock, /tradingCandleBatchCanRefreshIncrementally\(cachedBatch\)/);
  assert.match(restartBlock, /tradingCandleBatchHasFinalizedHistory\(cachedSnapshot\.candleBatch\)/);
  assert.match(restartBlock, /tradingCandleRefreshStartTime\(cachedBatch\)/);
  assert.match(restartBlock, /mergeTradingCandleBatches\([\s\S]*?fetchLatestTradingCandles/);
  assert.match(restartBlock, /this\.loadedMarketId === targetMarketId[\s\S]*?mergeTradingCandleBatches\(candleBatch/);
  assert.match(restartBlock, /closedCandleAuthority: "current"/);
  assert.doesNotMatch(restartBlock, /targetProvider === "binance"\s*&& cachedSnapshotApplied\s*&& generation/);
  assert.doesNotMatch(restartBlock, /Promise\.all\(\[\s*fetchTradingMarketStats/);
  assert.doesNotMatch(restartBlock, /tradingAlertsMarketSubscribe|subscribeAlertMarketData/);
  assert.match(restartBlock, /if \(!candleBatch\.candles\.length\) throw new Error\("未返回可用 K 线数据"\)/);
  assert.match(restartBlock, /tradingCandleSeriesMatchesResolution\(candleBatch\.candles, targetInterval\)/);
  assert.match(restartBlock, /const stats = tradingMarketStatsFromCandles\(targetSymbol, candleBatch\.candles\)/);
  assert.match(restartBlock, /this\.connectSocket\(generation\);[\s\S]*?window\.setInterval\(\(\) => void this\.refreshSnapshot\(generation\), 30_000\)/);
  assert.match(restartBlock, /if \(targetProvider === "binance"\)[\s\S]*?void this\.connectSocket\(generation\);[\s\S]*?try \{/);
  assert.match(restartBlock, /if \(this\.selectedProvider === "binance"\) void this\.refreshSnapshot\(generation\)/);
  assert.match(commitSnapshotBlock, /this\.loadedSymbol = targetSymbol[\s\S]*?this\.loadedInterval = targetInterval/);
  assert.match(commitSnapshotBlock, /this\.reconcileCurrentLivePrice\(\);[\s\S]*?this\.updateChartData\(\{ resetViewport: true \}\)/);
  assert.match(commitSnapshotBlock, /this\.updateChartData\(\{ resetViewport: true \}\)/);
  assert.doesNotMatch(restartBlock, /this\.selectedSymbol = this\.loadedSymbol|this\.activeInterval = this\.loadedInterval/);
  assert.match(restartBlock, /this\.candles = \[\];[\s\S]*?this\.clearChart\(\);[\s\S]*?this\.errorElement\.hidden = false/);
  assert.match(source, /const streams = \[`\$\{symbol\}@ticker`, `\$\{symbol\}@aggTrade`\]/);
  assert.match(source, /if \(source\?\.sourceInterval\) streams\.push\(`\$\{symbol\}@kline_\$\{source\.sourceInterval\}`\)/);
  assert.doesNotMatch(source, /if \(this\.alertMarketSubscriptionId\) return/);
  assert.match(restartBlock, /this\.loadingHistory = false;[\s\S]*?window\.clearTimeout\(this\.historyCooldownTimer\)/);
  assert.doesNotMatch(source, /firstChartLoad/);
  assert.match(viewportResetBlock, /const resetViewport = options\.resetViewport === true/);
  assert.match(viewportResetBlock, /this\.prepareChartViewportReset\(\)/);
  assert.match(viewportResetBlock, /setAutoScale\(true\)/);
  assert.match(viewportResetBlock, /initialMarketLogicalRange\(this\.chartCandles\.length, this\.activeInterval\)/);
  assert.match(viewportResetBlock, /private applyInitialChartViewport\(\)[\s\S]*?this\.updateVisiblePriceScale\(\)/);
  assert.match(viewportResetBlock, /this\.resettingChartViewport = false;[\s\S]*?this\.queueVisiblePriceScaleUpdate\(\)/);
  assert.match(viewportResetBlock, /this\.clearMarketError\(\);[\s\S]*?this\.updateCountdown\(\)/);
  assert.match(clearMarketErrorBlock, /this\.errorElement\.hidden = true/);
  assert.match(clearMarketErrorBlock, /this\.errorElement\.dataset\.marketAction = "retry"/);
  assert.match(clearMarketErrorBlock, /this\.errorElement\.removeAttribute\("aria-label"\)/);
  assert.match(historyBlock, /const generation = this\.loadGeneration/);
  assert.match(historyBlock, /const targetSymbol = this\.selectedSymbol/);
  assert.match(historyBlock, /const targetInterval = this\.activeInterval/);
  assert.match(historyBlock, /generation === this\.loadGeneration/);
  assert.match(historyBlock, /targetSymbol === this\.selectedSymbol/);
  assert.match(historyBlock, /targetInterval === this\.activeInterval/);
  assert.match(source, /private refreshingLiveCandleGeneration: number \| null = null/);
  assert.match(source, /if \(this\.refreshingLiveCandleGeneration === generation\) return/);
  assert.match(source, /if \(this\.refreshingLiveCandleGeneration === generation\) \{[\s\S]*?this\.refreshingLiveCandleGeneration = null/);
});

test("Trading Expert coalesces live candles while throttling REST fallbacks and rate-limit retries", async () => {
  const source = await marketSource;
  const socketBlock = sourceBlock(source, "private async connectSocket", "private handleSocketMessage");
  const livePriceBlock = sourceBlock(source, "private recordLatestLivePrice", "private commitMarketSnapshot");
  const messageBlock = sourceBlock(source, "private handleSocketMessage", "private updateFromBinanceKline");
  const klineBlock = sourceBlock(source, "private updateFromBinanceKline", "private updateFromBinanceTrade");
  const tradeBlock = sourceBlock(source, "private updateFromBinanceTrade", "private scheduleLiveChartPaint");
  const paintBlock = sourceBlock(source, "private scheduleLiveChartPaint", "private commitLoadedSelection");
  const fallbackBlock = sourceBlock(source, "private refreshMarketDataFallback", "private async refreshSnapshot");
  const favoriteFallbackBlock = sourceBlock(source, "private async refreshFavoriteTickerFallback", "private closeFavoriteTickerStreams");
  const restartBlock = sourceBlock(source, "private async restartMarketData", "private refreshMarketDataFallback");
  const favoritePaintBlock = sourceBlock(source, "private scheduleFavoriteTickerPaint", "private async refreshFavoriteTickerFallback");

  assert.doesNotMatch(source, /MARKET_LIVE_PAINT_INTERVAL_MS/);
  assert.match(source, /const MARKET_BACKGROUND_PAINT_INTERVAL_MS = 1_000/);
  assert.match(source, /const MARKET_LIVE_FULL_REFRESH_INTERVAL_MS = 1_000/);
  assert.match(source, /const MARKET_SOCKET_STALE_MS = 10_000/);
  assert.match(source, /const MARKET_SOCKET_FALLBACK_INTERVAL_MS = 10_000/);
  assert.match(source, /const FAVORITE_TICKER_FALLBACK_INTERVAL_MS = 10_000/);
  assert.match(source, /const FAVORITE_TICKER_SOCKET_STALE_MS = 10_000/);
  assert.match(source, /const FAVORITE_TICKER_FALLBACK_BATCH_SIZE = 4/);
  assert.match(source, /export function parseBinanceMarketRetryAfterMs[\s\S]*Number\.isFinite\(seconds\)[\s\S]*Date\.parse\(text\)/);
  assert.match(source, /response\?\.status === 418 \|\| response\?\.status === 429[\s\S]*recordBinanceMarketRateLimit\(response\?\.retryAfterMs, marketType\)/);
  assert.match(socketBlock, /this\.marketSocketLastActivityAt = Date\.now\(\)/);
  assert.match(socketBlock, /event\.status === "reconnecting"[\s\S]*?this\.marketSocketNeedsBackfill = true/);
  assert.match(socketBlock, /const needsBackfill = this\.marketSocketNeedsBackfill[\s\S]*?this\.refreshLiveCandle\(generation\)/);
  assert.match(socketBlock, /`\$\{symbol\}@aggTrade`/);
  assert.match(livePriceBlock, /latestLivePricesByMarketId\.set/);
  assert.match(livePriceBlock, /loadedMarketId !== this\.selectedMarketId[\s\S]*?loadedInterval !== this\.activeInterval/);
  assert.match(livePriceBlock, /applyTradingLivePriceToBatch/);
  assert.match(messageBlock, /payload\.e === "24hrTicker"[\s\S]*?recordLatestLivePrice[\s\S]*?reconcileCurrentLivePrice[\s\S]*?scheduleLiveChartPaint/);
  assert.match(klineBlock, /closed: kline\.x === true/);
  assert.match(klineBlock, /loadedMarketId !== this\.selectedMarketId[\s\S]*?loadedInterval !== this\.activeInterval/);
  assert.match(klineBlock, /applyLiveSourceCandle\(incoming, source\);[\s\S]*?reconcileCurrentLivePrice\(\)/);
  assert.match(klineBlock, /preferredTradingCandle\(latest, incoming\)/);
  assert.match(klineBlock, /const bucketTime = tradingCandleBucketTimeMs\([\s\S]*?source\.targetMs,[\s\S]*?source\.sourceInterval/);
  assert.match(klineBlock, /this\.scheduleLiveChartPaint\(\)/);
  assert.match(tradeBlock, /const sourceTime = tradingCandleBucketTimeMs\([\s\S]*?sourceMs,[\s\S]*?source\.sourceInterval/);
  assert.match(tradeBlock, /if \(source\.sourceInterval\)[\s\S]*?close: price[\s\S]*?this\.applyLiveSourceCandle\(incoming, source\)[\s\S]*?this\.scheduleLiveChartPaint\(\)/);
  assert.match(paintBlock, /if \(document\.hidden\)[\s\S]*?MARKET_BACKGROUND_PAINT_INTERVAL_MS/);
  assert.match(paintBlock, /this\.liveChartPaintFrame = window\.requestAnimationFrame/);
  assert.match(paintBlock, /Date\.now\(\) - this\.lastLiveChartFullRefreshAt >= MARKET_LIVE_FULL_REFRESH_INTERVAL_MS[\s\S]*?this\.updateChartData\(\)/);
  assert.match(paintBlock, /private paintLatestCandle\(\)[\s\S]*?this\.candleSeries\.update\(display\)/);
  assert.doesNotMatch(paintBlock, /this\.candleSeries\.setData/);
  assert.match(fallbackBlock, /binanceMarketRestCooldownRemaining\(Date\.now\(\), this\.selectedMarketType\) > 0/);
  assert.match(fallbackBlock, /silenceMs < MARKET_SOCKET_STALE_MS/);
  assert.match(fallbackBlock, /source\?\.sourceInterval[\s\S]*?this\.marketKlineLastActivityAt/);
  assert.doesNotMatch(fallbackBlock, /this\.refreshSnapshot\(generation\)/);
  assert.match(fallbackBlock, /this\.refreshLiveCandle\(generation\)/);
  assert.doesNotMatch(fallbackBlock, /WebSocket|socket\.close/);
  assert.match(favoritePaintBlock, /this\.paintVisibleMarketQuotes\(\)/);
  assert.doesNotMatch(favoritePaintBlock, /this\.renderMarkets\(\)/);
  assert.match(favoriteFallbackBlock, /binanceMarketRestCooldownRemaining\(now, market\.marketType === "spot" \? "spot" : "futures"\) === 0/);
  assert.doesNotMatch(favoriteFallbackBlock, /Promise\.allSettled\(staleMarkets/);
  assert.match(favoriteFallbackBlock, /const selectedMarkets = Array\.from\([\s\S]*FAVORITE_TICKER_FALLBACK_BATCH_SIZE/);
  assert.match(favoriteFallbackBlock, /this\.favoriteTickerFallbackCursor = \(start \+ selectedMarkets\.length\) % staleMarkets\.length/);
  assert.match(favoriteFallbackBlock, /for \(const staleMarket of selectedMarkets\)[\s\S]*binanceMarketRestCooldownRemaining\(Date\.now\(\), cooldownMarketType\) > 0[\s\S]*continue/);
  assert.match(source, /private async refreshSnapshot\(generation: number\) \{\s*if \(this\.selectedProvider === "binance" && binanceMarketRestCooldownRemaining\(Date\.now\(\), this\.selectedMarketType\) > 0\) return/);
  assert.match(source, /private async refreshLiveCandle\(generation: number\) \{\s*if \(this\.selectedProvider === "binance" && binanceMarketRestCooldownRemaining\(Date\.now\(\), this\.selectedMarketType\) > 0\) return/);
  assert.match(source, /const sourceStartTime = tradingCandleRefreshStartTime\(\{/);
  assert.match(restartBlock, /marketRateLimitRetryTimer = window\.setTimeout\([\s\S]*restartMarketData\(\{ preserveChart: true \}\)[\s\S]*cooldownRemaining \+ BINANCE_MARKET_RATE_LIMIT_RETRY_PADDING_MS/);
  assert.match(source, /destroy\(\)[\s\S]*clearTimeout\(this\.marketRateLimitRetryTimer\)/);
  assert.match(source, /data-market-row-price/);
  assert.match(source, /data-market-row-change/);
});

test("Trading Expert split panes share the market-wide live price across intervals", async () => {
  const [market, split] = await Promise.all([marketSource, splitPaneSource]);
  const quoteBlock = sourceBlock(market, "private recordLatestLivePrice", "private reconcileCurrentLivePrice");
  const splitLoadBlock = sourceBlock(market, "private async loadSplitPaneCandles", "private readonly handleMarketListScroll");
  const splitPriceBlock = sourceBlock(split, "  applyLivePrice(", "  async analysisSnapshot(");
  const splitSnapshotBlock = sourceBlock(split, "  async analysisSnapshot(", "  cancelAiPlayback(");
  const streamsBlock = sourceBlock(market, "private syncFavoriteTickerStreams", "private async connectFavoriteTickerGroup");

  assert.match(quoteBlock, /selection\.marketId !== marketId/);
  assert.match(quoteBlock, /pane\.applyLivePrice\(marketId, price, timestamp, source\.targetMs\)/);
  assert.match(splitLoadBlock, /applyTradingLivePriceToBatch\(result, quote\.price, quote\.eventTimeMs\)/);
  assert.match(splitPriceBlock, /this\.market\.id !== marketId/);
  assert.match(splitPriceBlock, /loadedMarketId !== this\.market\.id[\s\S]*?loadedInterval !== this\.interval/);
  assert.match(splitPriceBlock, /applyTradingLivePriceToBatch[\s\S]*?this\.updateData\(previousCandles\)/);
  assert.match(splitSnapshotBlock, /loadedMarketId === this\.market\.id[\s\S]*?loadedInterval === this\.interval/);
  assert.match(splitSnapshotBlock, /!this\.candles\.length \|\| !loadedContextMatches[\s\S]*?this\.reload\(true\)/);
  assert.match(streamsBlock, /this\.splitPanes\.forEach[\s\S]*?this\.splitPaneSelections\.get\(index \+ 1\)[\s\S]*?streamMarkets\.set\(selection\.marketId/);
});

test("Trading Expert trend-band mention toggles the chart without a transient time-axis shift", async () => {
  const source = await marketSource;
  const modeSyncBlock = sourceBlock(
    source,
    "setTrendBandEnabled(enabled: boolean)",
    "restorePreservedViewState()",
  );
  const mentionSyncBlock = sourceBlock(
    source,
    "export function applyTradingExpertCustomIndicatorMentions",
    "export async function runTradingExpertChanConversation",
  );
  const updateBlock = sourceBlock(
    source,
    "private updateChartData(options:",
    "private prepareChartViewportReset",
  );

  assert.match(modeSyncBlock, /this\.trendBandEnabled === enabled/);
  assert.match(modeSyncBlock, /this\.trendBandEnabled = enabled/);
  assert.match(modeSyncBlock, /this\.updateChartData\(\{ preserveViewport: true \}\)/);
  assert.match(mentionSyncBlock, /setTrendBandEnabled\(hasTradingExpertTrendBandMention\(text\)\)/);
  assert.match(source, /export const TRADING_EXPERT_TREND_BAND_MENTION = "@指标:趋势带"/);
  assert.match(source, /export function applyTradingExpertCustomIndicatorMentions/);
  assert.match(source, /export function atm4BandSeriesData/);
  assert.match(updateBlock, /const preservedLogicalRange = !resetViewport && options\.preserveViewport === true/);
  assert.match(updateBlock, /this\.updatingChartData = true/);
  assert.match(updateBlock, /atm4BandSeriesData\(band, "bandUpper", trendBandEnabled\)/);
  assert.match(updateBlock, /atm4BandSeriesData\(band, "bandLower", trendBandEnabled\)/);
  assert.match(updateBlock, /setVisibleLogicalRange\(preservedLogicalRange\)/);
  assert.match(updateBlock, /finally \{[\s\S]*?this\.updatingChartData = false/);
  assert.match(source, /if \(\s*this\.resettingChartViewport\s*\|\| this\.updatingChartData\s*\|\| this\.rebuildingIndicatorPanes\s*\) return/);
});
