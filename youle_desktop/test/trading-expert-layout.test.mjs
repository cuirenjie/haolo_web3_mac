import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TRADING_EXPERT_DEFAULT_MODEL_VALUE,
  TRADING_EXPERT_MODEL_VALUES,
  TRADING_EXPERT_REASONING_EFFORT,
  defaultTradingExpertModelOption,
  tradingExpertModelOptions,
} from "../src/renderer/trading-expert-models.ts";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const indicatorSource = readFile(new URL("../src/renderer/trading-expert-indicators.ts", import.meta.url), "utf8");
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

test("Trading Expert appears directly below Haolo with the requested profile", async () => {
  const source = await mainSource;
  const profiles = sourceBlock(source, "const CONTACT_PROFILES", "const state:");
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
  assert.match(messageBlock, /tradingExpertThreadIds\.add\(threadId\)/);
  assert.match(renderBlock, /tradingExpertLayout \? "trading-expert-layout" : ""/);
  assert.match(
    renderBlock,
    /state\.activeView === "chat" && state\.rightCollapsed && !state\.chatPreview\s*\? "right-panel-collapsed"/,
  );
  assert.doesNotMatch(renderBlock, /!state\.chatPreview && !tradingExpertLayout/);
  assert.match(source, /function renderLeftPanelToggle\(\) \{\s*if \(isTradingExpertThreadId\(state\.currentThreadId\)\) return "";/);
  assert.match(tradingChatBranch, /class="chat-panel trading-expert-chat-panel"/);
  assert.match(tradingChatBranch, /\$\{renderTradingExpertPanelToggle\(\)\}/);
  assert.match(tradingChatBranch, /\$\{renderTradingExpertMarketWorkspace\(\)\}/);
  assert.match(tradingChatBranch, /state\.tradingExpertPanelTab === "chat" \? renderComposer\(thread\) : ""/);
  assert.doesNotMatch(tradingChatBranch, /renderChatHeader\(thread\)/);
  assert.match(tradingPanelToggleBlock, /return collapsed \? "展开功能栏" : "收起功能栏"/);
  assert.match(tradingPanelToggleBlock, /data-action="toggle-right-panel"/);
  assert.match(tradingPanelToggleBlock, /renderPanelLayoutIcon\("right"\)/);
  assert.match(tradingPanelToggleBlock, /aria-expanded="\$\{panelExpanded \? "true" : "false"\}"/);
  assert.match(tradingAgentPanelBranch, /const collapsed = state\.rightCollapsed/);
  assert.match(tradingAgentPanelBranch, /class="agent-panel \$\{collapsed \? "collapsed" : "expanded"\} trading-expert-panel"/);
  assert.match(tradingAgentPanelBranch, /aria-hidden="\$\{collapsed \? "true" : "false"\}"/);
  assert.match(tradingAgentPanelBranch, /aria-label="交易专家功能栏"/);
  assert.doesNotMatch(tradingAgentPanelBranch, /<header>|<h2>/);
  assert.match(tradingAgentPanelBranch, /renderTradingExpertPanelTabs\(\)/);
  assert.match(tradingAgentPanelBranch, /renderTradingExpertPanelViews\(thread\)/);
  assert.match(tradingPanelToggleBlock, /\{ id: "chat", label: "任务"/);
  assert.match(tradingPanelToggleBlock, /\{ id: "account", label: "账户"/);
  assert.match(tradingPanelToggleBlock, /\{ id: "alerts", label: "预警"/);
  assert.match(tradingPanelToggleBlock, /\{ id: "knowledge", label: "知识库"/);
  assert.match(tradingPanelToggleBlock, /class="trading-expert-panel-tabs" role="tablist"/);
  assert.match(tradingPanelToggleBlock, /data-trading-expert-panel-tab="\$\{tab\.id\}"[\s\S]*role="tab"[\s\S]*aria-selected="\$\{selected\}"/);
  assert.match(tradingPanelToggleBlock, /class="trading-expert-task-refresh\$\{state\.tradingExpertTaskRefreshing \? " refreshing" : ""\}"/);
  assert.match(tradingPanelToggleBlock, /data-trading-expert-task-refresh[\s\S]*title="开启新任务"/);
  assert.match(tradingPanelToggleBlock, /state\.tradingExpertTaskRefreshing \? "disabled aria-busy=\\"true\\"" : ""/);
  assert.match(tradingPanelToggleBlock, /async function refreshTradingExpertTask\(\)[\s\S]*state\.tradingExpertTaskRefreshing = true/);
  assert.match(tradingPanelToggleBlock, /isBlankNewThread\(currentThreadId\) && threadIsEmpty\(currentThreadId\)[\s\S]*hideUnavailableThread\(currentThreadId\)/);
  assert.match(tradingPanelToggleBlock, /await ensureTradingExpertThreadGroup\(\)[\s\S]*assignThreadToGroup\(currentThreadId, group\.id\)/);
  assert.match(tradingPanelToggleBlock, /await openTradingExpertWorkspace\(\)/);
  assert.match(tradingPanelToggleBlock, /role="tabpanel"[\s\S]*aria-labelledby="trading-expert-tab-\$\{tab\.id\}"/);
  assert.match(tradingPanelToggleBlock, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  assert.match(source, /function bindEvents\(\)[\s\S]*bindTradingExpertPanelTabEvents\(\)/);
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
  assert.match(panelSyncBlock, /tradingExpertPanelToggleLabel\(collapsed\)/);
});

test("Trading Expert keeps its identity after first-send promotion and silently groups the task", async () => {
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
  const groupBlock = sourceBlock(
    source,
    "async function ensureTradingExpertThreadGroup",
    "function isDefaultThreadGroup",
  );

  assert.match(
    sendBlock,
    /isTradingExpertThreadId\(threadId\)[\s\S]*await ensureTradingExpertThreadGroup\(\)[\s\S]*commitSelectedNewThreadGroupForSend\(threadId, composerGroupIdForSend\)/,
  );
  assert.match(replacementBlock, /tradingExpertThreadIds\.delete\(previousThreadId\)/);
  assert.match(replacementBlock, /tradingExpertThreadIds\.add\(nextThreadId\)/);
  assert.match(replacementBlock, /threadGroupByThreadId\[nextThreadId\] = oldGroupId/);
  assert.match(identityBlock, /threadGroupByThreadId\[threadId\]/);
  assert.match(identityBlock, /name\.trim\(\) === TRADING_EXPERT_NAME/);
  assert.match(groupBlock, /group\.name\.trim\(\) === TRADING_EXPERT_NAME/);
  assert.match(groupBlock, /name: TRADING_EXPERT_NAME/);
  assert.match(groupBlock, /threadGroups\.unshift\(group\)/);
  assert.match(groupBlock, /saveThreadPreferences\(\)/);
  assert.match(groupBlock, /syncThreadGroupWorkspaces\(\{ renderAfter: false \}\)/);
  assert.doesNotMatch(groupBlock, /showToast\(|\brender\(\)/);
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

test("Trading Expert hides model selection and always uses GPT-5.6 Sol at ultra", async () => {
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

  assert.deepEqual(TRADING_EXPERT_MODEL_VALUES, ["gpt-5.6-sol"]);
  assert.equal(TRADING_EXPERT_REASONING_EFFORT, "ultra");
  assert.deepEqual(
    tradingExpertModelOptions(catalog).map((option) => option.value),
    ["gpt-5.6-sol"],
  );
  assert.equal(
    defaultTradingExpertModelOption(catalog)?.value,
    TRADING_EXPERT_DEFAULT_MODEL_VALUE,
  );

  const fixedRequestOptions = sourceBlock(
    source,
    "function tradingExpertFixedModelRequestOptions",
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
  const conversationMode = sourceBlock(
    source,
    "function newThreadModeForThread",
    "function isMediaCreationMode",
  );

  assert.match(
    fixedRequestOptions,
    /modelProvider: DEFAULT_EXECUTION_MODEL_PROVIDER_ID[\s\S]*model: TRADING_EXPERT_DEFAULT_MODEL_VALUE[\s\S]*reasoningEffort: TRADING_EXPERT_REASONING_EFFORT[\s\S]*reasoningEffortPolicy: "fixed"/,
  );
  assert.match(
    requestOptions,
    /isTradingExpertThreadId\(threadId\)\) return tradingExpertFixedModelRequestOptions\(\)/,
  );
  assert.match(
    reasoningOptions,
    /isTradingExpertThreadId\(threadId\)\) return \[TRADING_EXPERT_REASONING_EFFORT\]/,
  );
  assert.match(
    composer,
    /multiAgentMode \|\| isTradingExpertThreadId\(thread\.id\)[\s\S]*\? ""[\s\S]*: renderComposerModelPicker\(thread\.id\)/,
  );
  assert.match(
    styles,
    /> \.composer-model-picker,[\s\S]*?\.composer-mode-picker\s*\{\s*display: none;/,
  );
  assert.match(
    openWorkspace,
    /newThreadModeByThreadId\.set\(threadId, "execution"\)[\s\S]*modelProvider: DEFAULT_EXECUTION_MODEL_PROVIDER_ID[\s\S]*model: TRADING_EXPERT_DEFAULT_MODEL_VALUE[\s\S]*reasoningEffort: TRADING_EXPERT_REASONING_EFFORT/,
  );
  assert.match(
    conversationMode,
    /isTradingExpertThreadId\(threadId\)\) return "execution"/,
  );
  assert.ok(
    conversationMode.indexOf("isTradingExpertThreadId(threadId)") <
      conversationMode.indexOf("newThreadModeByThreadId.get(threadId)"),
    "Trading Expert must override stale persisted multi-agent preferences",
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

test("Trading Expert layout moves the composer right and covers light and dark surfaces", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const renderMessageBlock = sourceBlock(
    source,
    "function renderMessage(message: Message",
    "function messageRenderSignature",
  );

  assert.match(styles, /--trading-expert-panel-width:\s*300px;/);
  assert.match(styles, /\.desktop-body\.trading-expert-layout > \.chat-list\s*\{\s*display: none;/);
  assert.doesNotMatch(styles, /\.desktop-body\.trading-expert-layout > \.app-sidebar,[\s\S]*?\.desktop-body\.trading-expert-layout > \.chat-list/);
  assert.match(styles, /> \.trading-expert-chat-panel\s*\{[^}]*flex: 1 1 auto;[^}]*overflow: visible;[^}]*background: #ffffff;/s);
  assert.match(styles, /> \.trading-expert-panel\s*\{[^}]*flex: 0 0 var\(--trading-expert-panel-width\);[^}]*background: #ffffff;/s);
  assert.match(styles, /--trading-expert-panel-divider: #e3e8ef;/);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*height: 36\.4px;[^}]*border-bottom: 1px solid var\(--trading-market-border\);/s);
  assert.match(styles, /\.trading-expert-panel-tabs\s*\{[^}]*height: 36\.4px;[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[^}]*border-bottom: 1px solid var\(--trading-expert-panel-divider\);/s);
  assert.match(styles, /\.trading-expert-panel-tab-cell\s*\{[^}]*border-left: 1px solid var\(--trading-expert-panel-divider\);/s);
  assert.match(styles, /\.trading-expert-panel-tab-cell:first-child\s*\{[^}]*justify-content: center;[^}]*gap: 5px;[^}]*border-left: 0;/s);
  assert.match(styles, /\.trading-expert-panel-tab-cell:first-child \.trading-expert-panel-tab\s*\{[^}]*flex: 0 0 auto;[^}]*padding: 0;/s);
  assert.match(styles, /\.trading-expert-panel-tab:hover:not\(:disabled\):not\(\.active\)/);
  assert.match(styles, /\.trading-expert-panel-tab:active:not\(:disabled\)/);
  assert.match(styles, /\.trading-expert-panel-tab-cell\.active\s*\{[^}]*background: var\(--trading-expert-panel-tab-active-bg\);/s);
  assert.match(styles, /\.trading-expert-panel-tab\.active\s*\{[^}]*color: var\(--trading-expert-panel-tab-active\);/s);
  assert.doesNotMatch(styles, /\.trading-expert-panel-tab\.active::after/);
  assert.match(styles, /\.trading-expert-panel-tab:focus-visible,[\s\S]*?\.trading-expert-task-refresh:focus-visible\s*\{[^}]*box-shadow: inset 0 0 0 2px var\(--trading-expert-panel-tab-focus\);/s);
  assert.match(styles, /\.trading-expert-panel-tab:disabled,[\s\S]*?\.trading-expert-task-refresh:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.46;/s);
  assert.match(styles, /\.trading-expert-task-refresh\s*\{[^}]*width: 13px;[^}]*flex: 0 0 13px;[^}]*color: var\(--trading-expert-panel-tab-active\);/s);
  assert.match(styles, /\.trading-expert-task-refresh:hover:not\(:disabled\)\s*\{[^}]*background: transparent;/s);
  assert.match(styles, /\.trading-expert-task-refresh:active:not\(:disabled\)/);
  assert.match(styles, /\.trading-expert-task-refresh\.refreshing > svg\s*\{[^}]*animation: trading-expert-task-refresh-spin 0\.8s linear infinite;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.trading-expert-task-refresh\.refreshing > svg\s*\{[^}]*animation: none;/s);
  assert.match(styles, /> \.trading-expert-panel-toggle\s*\{[^}]*position: absolute;[^}]*top: 4px;[^}]*right: 5px;[^}]*left: auto;[^}]*z-index: 40;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout \.trading-market-overview\s*\{[^}]*padding-right: 42px;/s);
  assert.match(styles, /\.desktop-body\.trading-expert-layout\.right-panel-collapsed[\s\S]*?> \.composer\s*\{\s*display: none;/s);
  assert.match(styles, /\.desktop-body\.right-panel-collapsed > \.agent-panel\.collapsed\s*\{\s*display: none;/s);
  assert.match(styles, /\.panel-toggle:is\(\.left-panel-toggle, \[data-action="toggle-right-panel"\]\)\s*\{[^}]*color: var\(--text-placeholder\);/s);
  assert.match(styles, /\.panel-toggle:is\(\.left-panel-toggle, \[data-action="toggle-right-panel"\]\)\[aria-expanded="true"\]\s*\{[^}]*color: var\(--text-tertiary\);/s);
  assert.match(styles, /\.panel-toggle:is\(\.left-panel-toggle, \[data-action="toggle-right-panel"\]\):hover,[\s\S]*?:focus-visible\s*\{[^}]*color: var\(--text-secondary\);/s);
  assert.match(styles, /> \.trading-expert-chat-panel\s*> \.composer\s*\{[^}]*bottom: 13px;[^}]*left: calc\(100% \+ 12px\);[^}]*width: calc\(var\(--trading-expert-panel-width\) - 24px\);[^}]*min-height: 158px;/s);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-submenu\s*\{[^}]*right: calc\(100% \+ 3px\);[^}]*left: auto;/s);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-submenu::before\s*\{[^}]*right: auto;[^}]*left: 100%;/s);
  assert.match(styles, /> \.composer[\s\S]*?\.composer-mention-root-item[\s\S]*?> svg\s*\{[^}]*transform: rotate\(180deg\);/s);
  assert.match(styles, /\.composer-mention-submenu\s*\{[^}]*left: calc\(100% \+ 3px\);/s);
  assert.match(styles, /> \.composer\s*> \.composer-context-group-picker,[\s\S]*?\.composer-mode-picker\s*\{\s*display: none;/);
  assert.match(styles, /\.trading-expert-dashboard\s*\{[^}]*display: flex;[^}]*padding-bottom: 0;/s);
  assert.match(styles, /\.trading-expert-dashboard\.chat\s*\{[^}]*padding-bottom: 184px;/s);
  assert.match(styles, /\.trading-expert-dashboard\[hidden\]\s*\{[^}]*display: none;/s);
  assert.match(styles, /\.trading-expert-conversation\s*\{[^}]*min-height: 0;[^}]*flex: 1 1 auto;/s);
  assert.match(styles, /\.trading-expert-message-scroller\s*\{[^}]*scrollbar-gutter: stable;/s);
  assert.match(renderMessageBlock, /const showAvatar = !isTradingExpertThreadId\(message\.conversation_id\);/);
  assert.match(renderMessageBlock, /alignRight \|\| !showAvatar \? "" : renderMessageAvatar\(message, role\)/);
  assert.match(renderMessageBlock, /alignRight && showAvatar \? renderMessageAvatar\(message, role\) : ""/);
  assert.match(styles, /\.trading-expert-message-scroller \.message-stack\s*\{[^}]*max-width: 100%;/s);
  assert.doesNotMatch(styles, /\.trading-expert-message-scroller \.message-avatar\s*\{/);
  assert.match(styles, /\.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /\.message-scroll-bottom-button:focus-visible/);
  assert.match(styles, /\.message-scroll-bottom-button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.desktop-body\.trading-expert-layout[\s\S]*?> \.trading-expert-panel[\s\S]*?background: #15171b;/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?\.desktop-body\.trading-expert-layout[\s\S]*?> \.trading-expert-chat-panel[\s\S]*?background: #12161c;/);
  assert.match(styles, /html\[data-theme="dark"\] \.desktop-body\.trading-expert-layout,[\s\S]*--trading-expert-panel-divider: #1a2437;[\s\S]*--trading-expert-panel-tab-hover: #20242b;[\s\S]*--trading-expert-panel-tab-active-bg: #172337;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:hover:not\(:disabled\):not\(\.hidden\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-scroll-bottom-button:disabled/);
});

test("Trading Expert shows its mention catalog with left-opening submenus", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
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

  assert.match(source, /const TRADING_EXPERT_MENTION_CATALOG = \[[\s\S]*?label: "策略", options: \["缠论", "订单流", "波浪理论", "威科夫"\][\s\S]*?label: "知识库", options: \[\][\s\S]*?label: "自定义指标", options: \["趋势带"\]/);
  assert.match(menuBlock, /class="composer-mention-root trading-expert-mention-root"/);
  assert.match(menuBlock, /class="composer-mention-submenu trading-expert-mention-submenu"/);
  assert.match(menuBlock, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(menuBlock, /class="trading-expert-mention-option"[^>]*data-trading-expert-mention-group=/);
  assert.match(menuBlock, /data-trading-expert-mention-option=/);
  assert.doesNotMatch(menuBlock, /aria-disabled="true"/);
  assert.doesNotMatch(menuBlock, /data-composer-mention-root|data-skill-mention-index|applyComposerSkillMention/);
  assert.match(popoverBlock, /isTradingExpertThreadId\(currentComposerThreadId\(\)\)[\s\S]*return renderTradingExpertMentionMenu\(open\)/);
  assert.match(styles, /\.trading-expert-mention-submenu\s*\{[^}]*display: none;[^}]*width: 154px;/s);
  assert.match(styles, /\.trading-expert-mention-group:hover[\s\S]*?> \.trading-expert-mention-submenu,[\s\S]*?\.trading-expert-mention-group:focus-within[\s\S]*?> \.trading-expert-mention-submenu,[\s\S]*?\.trading-expert-mention-group\.submenu-open[\s\S]*?> \.trading-expert-mention-submenu\s*\{\s*display: block;/s);
  assert.match(cascadeHoverBlock, /\.trading-expert-mention-group/);
  assert.match(cascadeHoverBlock, /item\.addEventListener\("pointerleave", scheduleClose\)/);
  assert.match(cascadeHoverBlock, /CASCADE_MENU_CLOSE_DELAY_MS/);
  assert.match(styles, /\.trading-expert-mention-popover[\s\S]*?button:focus-visible\s*\{[^}]*outline: 2px solid var\(--brand-blue\);[^}]*background: var\(--selection-soft\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-skill-popover,[\s\S]*?html\[data-theme="dark"\] \.composer-mention-submenu,[\s\S]*?background: #1b1e23;/s);
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

  assert.match(placeholderBlock, /isTradingExpertThreadId\(thread\.id\)[\s\S]*return "输入@调用 策略、知识库、自定义指标"/);
  assert.match(applyBlock, /isTradingExpertThreadId\(threadId\)/);
  assert.match(applyBlock, /const token = `@\$\{item\.label\}:\$\{option\}`/);
  assert.match(applyBlock, /composerMentionLeadingSpacer\(input\.value, match\.start\)/);
  assert.match(applyBlock, /composerMentionTrailingSpacer\(afterSelection\)/);
  assert.match(applyBlock, /applyTradingExpertCustomIndicatorMentions\(nextValue\)/);
  assert.match(applyBlock, /rememberActiveComposerDraft\(\)/);
  assert.match(applyBlock, /syncComposerMentionHighlights\(\)/);
  assert.match(bindBlock, /\[data-trading-expert-mention-option\][\s\S]*applyTradingExpertMention/);
  assert.match(highlightTokenBlock, /tradingExpertMentionTokens\(\)/);
  assert.match(atomicTokenBlock, /tradingExpertMentionTokens\(\)[\s\S]*TRADING_EXPERT_MENTION_CATALOG\.flatMap/);
  assert.match(composerInputBlock, /state\.composerText = input\.value;\s*applyTradingExpertCustomIndicatorMentions\(input\.value\)/);
  assert.match(pendingSendBlock, /state\.composerText = "";\s*applyTradingExpertCustomIndicatorMentions\(state\.composerText\)/);
  assert.match(atomicDeleteBlock, /state\.composerText = nextValue;\s*applyTradingExpertCustomIndicatorMentions\(nextValue\)/);
});

test("Trading Expert market uses Binance USDT perpetual REST and realtime data", async () => {
  const source = await marketSource;
  const styles = await stylesSource;

  assert.match(source, /from "lightweight-charts"/);
  assert.match(source, /BINANCE_FUTURES_REST_URL = "https:\/\/fapi\.binance\.com"/);
  assert.match(source, /BINANCE_FUTURES_WS_URL = "wss:\/\/fstream\.binance\.com\/ws"/);
  assert.match(source, /const DEFAULT_SYMBOL = "BTCUSDT"/);
  assert.match(source, /const MARKET_QUOTE = "USDT"/);
  assert.match(source, /const MARKET_VENUE = "币安"/);
  assert.match(source, /"\/fapi\/v1\/exchangeInfo"/);
  assert.match(source, /"\/fapi\/v1\/ticker\/24hr"/);
  assert.match(source, /"\/fapi\/v1\/premiumIndex"/);
  assert.match(source, /"\/fapi\/v1\/openInterest"/);
  assert.match(source, /"\/fapi\/v1\/klines"/);
  assert.match(source, /async function fetchLatestTradingCandles/);
  assert.match(source, /startTime: sourceStartTime/);
  assert.match(source, /fromId: options\.fromId/);
  assert.match(source, /this\.lastAggregateTradeId === null \? undefined : this\.lastAggregateTradeId \+ 1/);
  assert.match(source, /quoteAsset !== MARKET_QUOTE[\s\S]*?item\.contractType !== "PERPETUAL"[\s\S]*?item\.status !== "TRADING"/);
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
  assert.match(source, /window\.setTimeout\(\(\) => this\.connectSocket\(generation\), 1500\)/);
  assert.match(source, /this\.selectedProvider === "binance" \? 2_000 : 60_000/);

  assert.match(styles, /\.trading-expert-market\s*\{[\s\S]*?--trading-market-panel: #ffffff;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-panel: #0f1014;/);
  assert.match(styles, /\.trading-market-symbol:hover,[\s\S]*?\.trading-market-symbol\[aria-expanded="true"\]/);
  assert.match(styles, /\.trading-market-symbol:focus-visible,[\s\S]*?outline: 2px solid #2da6f7;/);
  assert.match(styles, /\.trading-market-loading\[hidden\],[\s\S]*?display: none !important;/);
  assert.doesNotMatch(styles, /trading-market-modes/);
});

test("Trading Expert hides the bottom time axis and every vertical grid line in both themes", async () => {
  const source = await marketSource;
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
    assert.match(block, /vertLines: \{ visible: false \}/);
    assert.match(block, /horzLines: \{ color: theme\.grid \}/);
    assert.match(block, /timeScale: \{[\s\S]*?visible: false,/);
    assert.doesNotMatch(block, /vertLines: \{ color: theme\.grid \}/);
  }
  assert.match(createLayoutBlock, /attributionLogo: false/);
  assert.equal((createChartBlock.match(/attributionLogo: false/g) ?? []).length, 1);
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
  assert.match(source, /crosshair: marketCrosshairOptions\(theme\)/);
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
  assert.match(createChartBlock, /rightPriceScale: \{[\s\S]*?autoScale: false,[\s\S]*?ensureEdgeTickMarksVisible: true,[\s\S]*?scaleMargins: \{ top: 0, bottom: 0 \}/);
  assert.match(createChartBlock, /axisPressedMouseMove: \{ time: true, price: false \}/);
  assert.match(createChartBlock, /axisDoubleClickReset: \{ time: true, price: false \}/);
  assert.match(createChartBlock, /handleScroll: \{[\s\S]*?pressedMouseMove: false,[\s\S]*?horzTouchDrag: false,[\s\S]*?vertTouchDrag: false,/);
  assert.match(source, /addEventListener\("pointerdown", this\.handleChartPanPointerDown\)/);
  assert.match(source, /this\.chart\.timeScale\(\)\.setVisibleLogicalRange\(\{/);
  assert.match(source, /const logicalShift = -\(\(event\.clientX - this\.chartPanStartX\) \/ paneWidth\) \* span/);
  assert.match(source, /this\.chartCandles = deduped/);
  assert.match(source, /subscribeVisibleLogicalRangeChange\(\(range: any\) => \{[\s\S]*?this\.queueVisiblePriceScaleUpdate\(\)/);
  assert.match(lockPriceScale, /this\.chart\.timeScale\(\)\.getVisibleLogicalRange\(\)/);
  assert.match(lockPriceScale, /visibleCandlesInLogicalRange\(this\.chartCandles, logicalRange\)/);
  assert.match(lockPriceScale, /fixedPriceScaleRange\(visibleCandles\)/);
  assert.match(lockPriceScale, /priceScale\.setAutoScale\(false\)/);
  assert.match(lockPriceScale, /this\.lockedPriceRange = priceRange/);
  assert.match(lockPriceScale, /priceScale\.setVisibleRange\(this\.lockedPriceRange\)/);
  assert.match(geometrySync, /this\.updateVisiblePriceScale\(\);[\s\S]*?this\.updateCurrentPriceLabel\(\);[\s\S]*?this\.drawingController\?\.redraw\(\)/);
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
    '<div class="trading-market-chart-panel">',
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
  assert.match(overview, /renderMarketAssetLogo\("BTC", "binance", true\)/);
  assert.match(overview, /class="trading-market-contract-tag" data-market-current-tag>永续<\/span>/);
  assert.match(source, /const DEFAULT_INTERVAL = "1D"/);
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
  assert.match(styles, /\.trading-market-period-controls\s*\{[^}]*flex: 0 1 auto;[^}]*margin-left: auto;/s);
  assert.match(styles, /\.trading-market-times\s*\{[^}]*flex: 0 1 auto;[^}]*margin-left: 0;/s);
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
  assert.doesNotMatch(editor, /<select[^>]*data-market-period-unit/);
  assert.match(editor, /class="video-expert-select trading-market-period-unit-picker"/);
  assert.match(editor, /class="video-expert-select-button"/);
  assert.match(editor, /class="video-expert-select-menu trading-market-period-unit-menu"/);
  assert.match(editor, /data-market-action="toggle-period-unit"/);
  assert.match(editor, /data-market-action="period-unit" data-market-period-unit="m"/);
  assert.match(editor, /data-market-action="restore-periods">恢复默认</);
  assert.match(editor, /data-market-action="confirm-periods">确定</);
  assert.match(source, /const MAX_TRADING_PERIODS = 10/);
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
  assert.match(source, /window\.localStorage\.getItem\(TRADING_PERIODS_STORAGE_KEY\)/);
  assert.match(source, /window\.localStorage\.setItem\(TRADING_PERIODS_STORAGE_KEY, JSON\.stringify\(this\.periods\)\)/);
  assert.match(styles, /\.trading-market-period-editor\s*\{[^}]*background: var\(--trading-market-panel\);/s);
  assert.match(styles, /\.trading-market-period-editor\s*\{[^}]*width: min\(336px, calc\(100vw - 112px\)\);/s);
  assert.match(styles, /\.trading-market-period-item:hover\s*\{[^}]*background: var\(--trading-market-accent-soft\);/s);
  assert.match(styles, /\.trading-market-period-item\s*\{[^}]*touch-action: none;[^}]*user-select: none;/s);
  assert.match(styles, /\.trading-market-period-item\.drag-over\s*\{[^}]*border-color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-period-drag-ghost\s*\{[^}]*position: fixed;[^}]*pointer-events: none;[^}]*cursor: grabbing;/s);
  assert.match(styles, /\.trading-market-period-add-controls > \[data-market-action="add-period"\]:disabled,[\s\S]*?opacity: 0\.45;/s);
  assert.match(styles, /\.trading-market-period-unit-menu\s*\{[^}]*top: calc\(100% \+ 6px\);[^}]*bottom: auto;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.copy-context-menu,[\s\S]*?html\[data-theme="dark"\] \.video-expert-select-menu,[\s\S]*?\{[^}]*background: #1b1e23;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-editor\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-drag-ghost\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-market-period-add input\s*\{[^}]*color-scheme: dark;/s);
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
  assert.match(saveBlock, /this\.indicatorSettings = normalizeTradingIndicatorSettings\(this\.draftIndicatorSettings\)/);
  assert.match(saveBlock, /const selectedSetting = this\.draftIndicatorSettings\[this\.selectedIndicatorSettingKey\];[\s\S]*selectedSetting\.enabled = true/);
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
  const styles = await stylesSource;

  assert.match(source, /class="trading-market-picker-search"/);
  assert.doesNotMatch(source, /data-market-action="close-symbols"|aria-label="关闭交易对列表">×/);
  assert.doesNotMatch(source, /trading-market-picker-toolbar|data-market-count|项目对\(0\)/);
  assert.match(source, /<span>名称<\/span><span>平台<\/span><span>最新价<\/span><span>24H涨幅<\/span><span>收藏<\/span>/);
  assert.doesNotMatch(source, /<span>#<\/span>/);
  assert.doesNotMatch(source, /CNY价格|24H成交额|24小时成交额|>操作</);
  assert.doesNotMatch(source, /trading-market-row-number|markets\.map\(\(market, index\)/);
  assert.match(source, /class="trading-market-row-pair"/);
  assert.match(source, /https:\/\/bin\.bnbstatic\.com\/static\/assets\/logos/);
  assert.match(source, /https:\/\/app\.hyperliquid\.xyz\/coins/);
  assert.match(source, /renderMarketAssetLogo\(market\.baseAsset, market\.provider\)/);
  assert.match(source, /data-market-logo-stage="binance"/);
  assert.match(source, /addEventListener\("error", this\.handleMarketLogoError, true\)/);
  assert.match(source, /this\.marketList\.addEventListener\("scroll", this\.handleMarketListScroll, \{ passive: true \}\)/);
  assert.match(source, /const preservedScrollTop = options\.resetScroll[\s\S]*?Math\.max\(this\.marketList\.scrollTop, this\.marketListScrollTop\)/);
  assert.match(source, /this\.restoreMarketListScroll\(preservedScrollTop\)/);
  assert.match(source, /restorePreservedViewState\(\)/);
  assert.match(source, /activeWorkspace\.restorePreservedViewState\(\)/);
  assert.match(source, /image\.dataset\.marketLogoStage = "hyperliquid"/);
  assert.match(source, /class="trading-market-contract-tag">\$\{escapeHtml\(market\.tag\)\}<\/span>/);
  assert.match(source, /class="trading-market-row-venue"[^>]*>\$\{escapeHtml\(market\.venue\)\}<\/span>/);
  assert.match(styles, /\.trading-market-overview\s*\{[^}]*z-index: 30;/s);
  assert.match(styles, /\.trading-market-chart-panel\s*\{[^}]*z-index: 1;/s);
  assert.match(styles, /\.trading-market-picker\s*\{[^}]*z-index: 100;[^}]*width: 576px;[^}]*max-width: min\(576px,[^}]*background: var\(--trading-market-panel\);/s);
  assert.match(styles, /\.trading-market-picker-search\s*\{[^}]*border: 0;[^}]*background: var\(--trading-market-control\);/s);
  assert.match(styles, /\.trading-market-picker-search:hover,[\s\S]*?\.trading-market-picker-search:focus-within\s*\{[^}]*background: var\(--trading-market-control-hover\);[^}]*box-shadow: none;/s);
  assert.match(styles, /\.trading-market-picker input:focus-visible\s*\{[^}]*outline: 0;/s);
  assert.doesNotMatch(styles, /\.trading-market-picker-search:focus-within\s*\{[^}]*(?:border-color|trading-market-accent)/s);
  assert.match(styles, /--trading-market-control: #f0f3f7;[\s\S]*--trading-market-control-hover: #e6ebf2;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-control: #212224;[\s\S]*--trading-market-control-hover: #172337;/s);
  assert.match(styles, /\.trading-market-picker-head,[\s\S]*?\.trading-market-row\s*\{[^}]*grid-template-columns: minmax\(0, 1\.65fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 0\.8fr\) 32px;/s);
  assert.match(styles, /\.trading-market-picker-search\s*\{[^}]*margin: 10px 12px 6px;/s);
  assert.match(styles, /\.trading-market-picker-head\s*\{[^}]*padding: 0 20px 0 12px;/s);
  assert.match(styles, /\.trading-market-row\s*\{[^}]*padding: 5px 7px;/s);
  assert.match(styles, /\.trading-market-picker-head > \*,[\s\S]*?\.trading-market-row > em\s*\{[^}]*justify-self: stretch;[^}]*text-align: left;/s);
  assert.doesNotMatch(styles, /\.trading-market-row-number\s*\{/);
  assert.doesNotMatch(styles, /\.trading-market-picker-search > button/);
  assert.match(styles, /\.trading-market-asset-logo\s*\{[^}]*border-radius: 50%;[^}]*background: var\(--trading-market-logo-bg\);/s);
  assert.match(styles, /\.trading-market-contract-tag\s*\{[^}]*background: var\(--trading-market-tag-bg\);[^}]*color: var\(--trading-market-tag-text\);/s);
  assert.match(styles, /\.trading-market-row\.selected \.trading-market-contract-tag\s*\{[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-market-row > b,[\s\S]*?\.trading-market-row > em\s*\{[^}]*text-align: left;/s);
  assert.doesNotMatch(styles, /\.trading-market-picker-toolbar|\.trading-market-indicator-count/);
  assert.match(styles, /\.trading-market-row:hover \.trading-market-row-select,[\s\S]*?background: var\(--trading-market-accent-soft\);/);
  assert.match(styles, /\.trading-market-row-select:active\s*\{[^}]*background: color-mix\(in srgb, var\(--trading-market-accent\) 14%, transparent\);/s);
  assert.match(styles, /\.trading-market-list\s*\{[^}]*overscroll-behavior-y: contain;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-panel: #0f1014;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-logo-bg: #171a20;[\s\S]*--trading-market-tag-bg: #24282f;/s);
});

test("Trading Expert favorites persist, filter the next open, and remain available in search", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const renderer = await mainSource;
  const pickerOpen = sourceBlock(source, "private setPickerOpen", "private setPeriodEditorOpen");
  const marketRender = sourceBlock(source, "private renderMarkets", "private restoreMarketListScroll");
  const tickerRender = sourceBlock(source, "private favoriteTickerMarkets()", "private scheduleFavoriteTickerPaint()");
  const tickerStreams = sourceBlock(source, "private syncFavoriteTickerStreams()", "private toggleFavoriteMarket");

  assert.match(source, /const TRADING_FAVORITES_STORAGE_KEY = "haolo\.trading-market\.favorites\.v1"/);
  assert.match(source, /export function tradingFavoriteStorageKeys\(accountIdentity = ""\)/);
  assert.match(source, /loadTradingFavoritesFromStorage\([\s\S]*?window\.localStorage,[\s\S]*?this\.favoriteStorageAccountIdentity/);
  assert.match(source, /saveTradingFavoritesToStorage\([\s\S]*?window\.localStorage,[\s\S]*?this\.favoriteStorageAccountIdentity/);
  assert.match(source, /removeLegacy: this\.favoriteStorageMigratedFromLegacy/);
  assert.match(renderer, /function tradingExpertFavoriteStorageAccountIdentity\(\)[\s\S]*?state\.auth\.profile\?\.id[\s\S]*?state\.auth\.baseUrl/);
  assert.match(renderer, /syncTradingExpertMarketWorkspace\([\s\S]*?tradingExpertFavoriteStorageAccountIdentity\(\)/);
  assert.match(source, /if \(action === "favorite"\)[\s\S]*?this\.toggleFavoriteMarket\(market\)/);
  assert.match(source, /const TRADING_FAVORITE_MARKETS_STORAGE_KEY = "haolo\.trading-market\.favorite-records\.v1"/);
  assert.match(source, /export const MAX_TRADING_FAVORITE_TICKERS = 6/);
  assert.match(source, /data-market-favorite-tickers[\s\S]*?data-market-period-controls/);
  assert.match(pickerOpen, /this\.search\.value = ""/);
  assert.match(pickerOpen, /this\.showFavoritesOnly = this\.favoriteSymbols\.size > 0/);
  assert.match(pickerOpen, /this\.renderMarkets\(\{ resetScroll: true \}\)/);
  assert.match(marketRender, /const favoritesOnly = !query && this\.showFavoritesOnly && this\.favoriteSymbols\.size > 0/);
  assert.match(marketRender, /tradingMarketVisibleInPicker\([\s\S]*?market,[\s\S]*?query,[\s\S]*?this\.favoriteSymbols,[\s\S]*?favoritesOnly/);
  assert.match(marketRender, /class="trading-market-favorite\$\{favorite \? " active" : ""\}"/);
  assert.match(marketRender, /data-market-action="favorite"/);
  assert.match(marketRender, /aria-pressed="\$\{favorite\}"/);
  assert.match(marketRender, /title="\$\{favorite \? "取消收藏" : "添加收藏"\}"/);
  assert.match(source, /function renderMarketFavoriteIcon\(\)[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(tickerRender, /record\.assetClass === "crypto"[\s\S]*?this\.favoriteSymbols\.has\(record\.id\)[\s\S]*?slice\(0, MAX_TRADING_FAVORITE_TICKERS\)/);
  assert.match(tickerRender, /data-market-action="favorite-symbol"/);
  assert.match(tickerRender, /data-market-favorite-price[\s\S]*?data-market-favorite-change/);
  assert.doesNotMatch(tickerRender, /renderMarketAssetLogo/);
  assert.match(source, /action === "symbol" \|\| action === "favorite-symbol"[\s\S]*?this\.selectMarket\(market\)[\s\S]*?this\.restartMarketData\(\{ preserveChart: true \}\)/);
  assert.match(tickerRender, /this\.favoriteTickerMarketsById\.get\(record\.id\)/);
  assert.match(tickerStreams, /\[\.\.\.this\.favoriteTickerMarketsById\.values\(\)\]/);
  assert.match(tickerStreams, /market\.provider === "binance"[\s\S]*?`\$\{symbol\.toLowerCase\(\)\}@ticker`/);
  assert.match(tickerStreams, /payload\.e !== "24hrTicker"[\s\S]*?Number\(payload\.c\)[\s\S]*?Number\(payload\.o\)/);
  assert.match(tickerStreams, /favoriteTickerOpenPricesById\.set\(market\.id, openPrice\)[\s\S]*?market\.changePercent = \(\(market\.markPrice - Number\(currentOpenPrice\)\) \/ Number\(currentOpenPrice\)\) \* 100/);
  assert.match(source, /const latestPrice = this\.selectedMarketType === "spot" \? this\.stats\.markPrice : this\.stats\.midPrice[\s\S]*?selectedFavorite\.markPrice = latestPrice/);
  assert.match(styles, /\.trading-market-picker-head > :nth-child\(3\),[\s\S]*?\.trading-market-row > em\s*\{[^}]*transform: translateX\(-13px\);/s);
  assert.match(styles, /\.trading-market-favorite > svg\s*\{[^}]*fill: transparent;[^}]*stroke: currentColor;/s);
  assert.match(styles, /\.trading-market-favorite\.active > svg\s*\{[^}]*fill: currentColor;/s);
  assert.match(styles, /\.trading-market-favorite:hover\s*\{[^}]*background: transparent;[^}]*color: var\(--trading-market-favorite-fill\);/s);
  assert.match(styles, /\.trading-market-favorite:focus-visible\s*\{[^}]*outline: 2px solid var\(--trading-market-favorite-fill\);/s);
  assert.match(styles, /\.trading-market-favorite:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.45;/s);
  assert.match(styles, /\.trading-market-favorite-tickers\s*\{[^}]*flex: 1 1 auto;[^}]*gap: 4px;[^}]*overflow: hidden;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\s*\{[^}]*width: 146px;[^}]*max-width: 146px;[^}]*background: transparent;/s);
  assert.match(styles, /\.trading-market-favorite-ticker\.selected\s*\{[^}]*background: var\(--trading-market-accent-soft\);/s);
  assert.match(styles, /\.trading-market-favorite-ticker > strong\s*\{[^}]*text-overflow: ellipsis;/s);
  assert.match(styles, /--trading-market-favorite-fill: var\(--brand-blue\);[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-favorite-fill: var\(--brand-blue\);/s);
  assert.doesNotMatch(styles, /--trading-market-favorite-(?:fill|soft): #[fF](?:5b800|fd24a|ff5cc)/);
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
  assert.match(source, /this\.selectedProvider === "binance" \? 2_000 : 60_000/);
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
    /\.trading-market-overview\s*\{[^}]*border-bottom: 1px solid var\(--trading-market-border\);[^}]*box-shadow: none;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.trading-expert-market\s*\{[^}]*--trading-market-border: #1a2437;/s,
  );
});

test("Trading Expert replaces the floating OHLC card with the reference-style quote strip", async () => {
  const source = await marketSource;
  const styles = await stylesSource;
  const ohlcMarkup = sourceBlock(
    source,
    'this.ohlcElement.innerHTML = `',
    "`;",
  );

  assert.match(source, /formatOhlcDateTime\(timeValue\)/);
  assert.match(source, /amplitudePercent = open \? \(\(high - low\) \/ open\) \* 100 : 0/);
  assert.match(source, /this\.renderOhlc\(bar, parameter\.time\)/);
  assert.match(source, /this\.renderOhlc\(candle, candle\.time \+ CHINA_TIME_OFFSET_SECONDS\)/);
  assert.match(ohlcMarkup, /<time>/);
  assert.match(ohlcMarkup, /item\("开"/);
  assert.match(ohlcMarkup, /item\("高"/);
  assert.match(ohlcMarkup, /item\("低"/);
  assert.match(ohlcMarkup, /item\("收"/);
  assert.match(ohlcMarkup, /item\("涨幅"/);
  assert.match(ohlcMarkup, /item\("振幅"/);
  assert.doesNotMatch(ohlcMarkup, /<button|<svg|row\("[OHLC]"/);
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

  assert.match(source, /background: "#ffffff",\s*text: "#000000"/);
  assert.match(source, /function marketPriceFormatFor[\s\S]*?return \{ \.\.\.MARKET_PRICE_FORMAT \};/);
  assert.match(source, /function marketFocusedPriceFormatFor[\s\S]*?const precision = Math\.max\(MARKET_PRICE_FORMAT\.precision, 6 - integerDigits\)/);
  assert.match(updateChartData, /this\.applyMarketPriceFormat\(lastRaw\.close\)/);
  assert.match(updateChartData, /const lineColor = isDarkTheme\(\) \? "#45c979" : "#269d4d"/);
  assert.match(updateChartData, /lineStyle: LineStyle\.Dashed/);
  assert.match(updateChartData, /axisLabelVisible: false/);
  assert.match(source, /this\.currentPriceElement\.textContent = formatFocusedPrice\(candle\.close\)/);
  assert.match(source, /this\.crosshairPriceElement\.textContent = formatFocusedPrice\(price\)/);
  assert.match(styles, /--trading-market-current-price: #269d4d;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-current-price: #45c979;/);
  assert.match(updateChartData, /axisLabelColor: lineColor/);
  assert.match(updateChartData, /axisLabelTextColor: "#ffffff"/);
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
  assert.match(updateIndicatorData, /priceScale\(\)\?\.setAutoScale\(true\)/);
  assert.match(source, /subscribeVisibleLogicalRangeChange\(\(range: any\) => \{[\s\S]*?this\.rebuildingIndicatorPanes/);

  assert.match(styles, /\.trading-market-indicator-bar\s*\{[^}]*background: var\(--trading-market-panel\)/s);
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

  assert.match(source, /export type TradingMainIndicatorId = "ma" \| "ema" \| "boll" \| "td" \| "bbi";/);
  assert.match(source, /\{ id: "ma", label: "MA"/);
  assert.match(source, /\{ id: "ema", label: "EMA"/);
  assert.match(source, /\{ id: "boll", label: "BOLL"/);
  assert.match(source, /\{ id: "td", label: "TD"/);
  assert.match(source, /\{ id: "bbi", label: "BBI"/);
  assert.match(source, /data-market-action="main-indicator"/);
  assert.match(source, /setting\.enabled = !setting\.enabled;[\s\S]*this\.syncActiveIndicatorsFromSettings\(\)/);
  assert.match(source, /setting\("ma"\)\.parameters\.map\([\s\S]*computeSma\(closes, period\)[\s\S]*setting\("ema"\)\.parameters\.map\([\s\S]*computeEma\(closes, period\)/);
  assert.match(source, /computeBollingerBands\(closes, setting\("boll"\)\.parameters\[0\], setting\("boll"\)\.parameters\[1\]\)/);
  assert.match(source, /computeBbi\(closes, setting\("bbi"\)\.parameters\)/);
  assert.match(source, /createSeriesMarkers\(this\.candleSeries/);
  assert.match(source, /const tdSignals = isActive\("td"\) \? computeTdSequential\(candles, tdSetting\.parameters\[0\]\) : \[\]/);
  assert.ok(indicatorBar.indexOf("data-market-main-indicators") < indicatorBar.indexOf("data-market-indicators"));
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

test("Trading Expert keeps the live chart workspace across unrelated app renders", async () => {
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
  const viewportResetBlock = sourceBlock(
    source,
    "private updateChartData(options:",
    "private updateVisiblePriceScale()",
  );
  const historyBlock = sourceBlock(
    source,
    "private async loadMoreHistory",
    "private setLoading",
  );
  const preservedSwitches = source.match(/restartMarketData\(\{ preserveChart: true \}\)/g) ?? [];

  assert.equal(preservedSwitches.length, 3);
  assert.match(restartBlock, /const targetSymbol = this\.selectedSymbol/);
  assert.match(restartBlock, /const targetInterval = this\.activeInterval/);
  assert.match(restartBlock, /const keepChart = options\.preserveChart === true && this\.candles\.length > 0/);
  assert.match(restartBlock, /this\.setLoading\(true\)/);
  assert.match(restartBlock, /this\.hideCrosshairTimeLabel\(\)/);
  assert.match(restartBlock, /this\.hideCrosshairPriceLabel\(\)/);
  assert.match(restartBlock, /this\.currentPriceElement\.hidden = true/);
  assert.match(
    restartBlock,
    /if \(!keepChart\) \{[\s\S]*?this\.candles = \[\][\s\S]*?this\.clearChart\(\)/,
  );
  assert.match(restartBlock, /fetchTradingCandles\([\s\S]*?targetSymbol,[\s\S]*?targetInterval,[\s\S]*?500,[\s\S]*?targetMarketType === "spot"/);
  assert.match(restartBlock, /this\.loadedSymbol = targetSymbol[\s\S]*?this\.loadedInterval = targetInterval/);
  assert.match(restartBlock, /this\.updateChartData\(\{ resetViewport: true \}\)/);
  assert.match(restartBlock, /this\.selectedSymbol = this\.loadedSymbol[\s\S]*?this\.activeInterval = this\.loadedInterval/);
  assert.match(restartBlock, /this\.loadingHistory = false;[\s\S]*?window\.clearTimeout\(this\.historyCooldownTimer\)/);
  assert.doesNotMatch(source, /firstChartLoad/);
  assert.match(viewportResetBlock, /const resetViewport = options\.resetViewport === true/);
  assert.match(viewportResetBlock, /this\.prepareChartViewportReset\(\)/);
  assert.match(viewportResetBlock, /setAutoScale\(true\)/);
  assert.match(viewportResetBlock, /initialMarketLogicalRange\(this\.chartCandles\.length, this\.activeInterval\)/);
  assert.match(viewportResetBlock, /fixedPriceScaleRange\([\s\S]*?visibleCandlesInLogicalRange\(this\.chartCandles, logicalRange\)/);
  assert.match(viewportResetBlock, /this\.resettingChartViewport = false;[\s\S]*?this\.queueVisiblePriceScaleUpdate\(\)/);
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
  assert.match(source, /export const TRADING_EXPERT_TREND_BAND_MENTION = "@自定义指标:趋势带"/);
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
