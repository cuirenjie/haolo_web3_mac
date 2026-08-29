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

test("empty Trading Expert conversations show Haolo's preference onboarding bubble", async () => {
  const source = await rendererSource;
  const entry = sourceBlock(
    source,
    "function renderTradingPreferenceOnboardingEntry",
    "function startTradingPreferenceOnboarding",
  );
  const emptyState = sourceBlock(
    source,
    "function renderMessageScrollerContent",
    "function updateActiveMessageScroller",
  );
  const materializeState = sourceBlock(
    source,
    "async function materializeThreadSwitchMessagesInBatches",
    "function yieldThreadSwitchMaterialization",
  );
  const activeScrollerState = sourceBlock(
    source,
    "function updateActiveMessageScroller",
    "function patchMessageScrollerContent",
  );

  assert.match(entry, /isTradingExpertThreadId\(thread\.id\)/);
  assert.match(entry, /tradingPreferenceProfileCompleted/);
  assert.match(entry, /tradingPreferenceProfileLoadStatus/);
  assert.match(entry, /messagesForThread\(thread\.id\)\.length/);
  assert.match(entry, /class="message-row from-agent trading-preference-onboarding-message"/);
  assert.match(entry, /class="message-meta">Haolo<\/div>/);
  assert.match(entry, /class="message-bubble agent-bubble trading-preference-onboarding-bubble"/);
  assert.match(entry, /data-action="start-trading-preference-onboarding"/);
  assert.match(entry, />开始<\/button>/);
  assert.doesNotMatch(entry, /告诉Haolo你的交易偏好/);
  assert.match(emptyState, /isTradingExpertThreadId\(thread\.id\)[\s\S]*renderTradingPreferenceOnboardingEntry\(thread\)/);
  assert.match(materializeState, /"new-thread-scroller",[\s\S]*!isTradingExpertThreadId\(threadId\)/);
  assert.match(activeScrollerState, /"new-thread-scroller",[\s\S]*!isTradingExpertThreadId\(thread\.id\)/);
});

test("preference start keeps the chart layout and immediately asks question one", async () => {
  const source = await rendererSource;
  const handler = sourceBlock(
    source,
    "function startTradingPreferenceOnboarding",
    "function workflowRevisionNodePayload",
  );

  assert.match(source, /const TRADING_PREFERENCE_ONBOARDING_GREETING =[\s\S]*天才交易员/);
  assert.doesNotMatch(source, /回复“开始”即可/);
  assert.doesNotMatch(handler, /state\.rightCollapsed\s*=/);
  assert.doesNotMatch(handler, /state\.tradingExpertChartCollapsed\s*=/);
  assert.doesNotMatch(handler, /restoreTradingExpertChartFocusLayout/);
  assert.match(handler, /text: TRADING_PREFERENCE_ONBOARDING_GREETING/);
  assert.match(handler, /text: TRADING_PREFERENCE_QUESTION_ONE/);
  assert.match(handler, /stage: 1/);
  assert.match(handler, /tradingPreferenceOnboardingByThreadId\.set/);
  assert.match(handler, /sender_label: "Haolo"/);
  assert.match(handler, /threadNameOverrides\[threadId\] = TRADING_PREFERENCE_THREAD_TITLE/);
  assert.match(handler, /name: TRADING_PREFERENCE_THREAD_TITLE/);
  assert.doesNotMatch(handler, /api\.sendMessage/);
  assert.match(
    source,
    /\[data-action="start-trading-preference-onboarding"\][\s\S]*addEventListener\("click", startTradingPreferenceOnboarding\)/,
  );
});

test("three-question flow requires every question and supports per-question recommendations, custom answers, and encrypted persistence", async () => {
  const source = await rendererSource;
  const flow = sourceBlock(
    source,
    "function tradingPreferenceReplyUsesCurrentRecommendation",
    "function workflowRevisionNodePayload",
  );
  const send = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(source, /const TRADING_PREFERENCE_QUESTION_ONE =/);
  assert.match(source, /每笔交易触发止损后，你最多允许亏损当前账户净值的百分之多少/);
  assert.match(source, /const TRADING_PREFERENCE_QUESTION_TWO =/);
  assert.match(source, /浮盈达到1R后移动保本，最低净盈亏比为2:1/);
  assert.match(source, /const TRADING_PREFERENCE_QUESTION_THREE =/);
  assert.match(source, /仓位健康度、风险校验、关键价位、入场条件、止损、止盈、仓位大小和失效条件/);
  assert.doesNotMatch(flow, /按此项推荐|同意推荐|全部使用推荐|采用全部推荐配置/);
  assert.match(flow, /回复“同意”/);
  assert.match(flow, /return \/\^同意\[。！!\]\?\$\//);
  assert.match(flow, /flow\.stage = 2;[\s\S]*TRADING_PREFERENCE_QUESTION_TWO/);
  assert.match(flow, /flow\.stage = 3;[\s\S]*TRADING_PREFERENCE_QUESTION_THREE/);
  assert.match(flow, /flow\.stage === 3[\s\S]*saveTradingPreferenceOnboarding/);
  assert.match(flow, /maxLossPerTradePercent \?\?= 2/);
  assert.match(flow, /breakEvenTriggerR \?\?= 1/);
  assert.match(flow, /minimumRiskRewardRatio \?\?= 2/);
  assert.match(source, /Haolo 推荐：单笔风险为2%/);
  assert.match(flow, /percent > 100/);
  assert.match(flow, /例如“2%”或“10%”/);
  assert.doesNotMatch(flow, /percent > 3|absolute_max_loss_per_trade_percent|单笔绝对上限 3/);
  assert.match(flow, /move_stop_to_break_even/);
  assert.match(flow, /trading_analysis_style/);
  assert.match(flow, /required_analysis_sections/);
  assert.match(flow, /user_custom_rules/);
  assert.match(flow, /api\.saveTradingPreferenceProfile/);
  assert.match(flow, /result\?\.completed !== true/);
  assert.match(flow, /以后无论使用普通分析、技能还是交易策略，我都会参考这份配置/);
  assert.match(source, /const TRADING_PREFERENCE_BINANCE_INVITATION =[\s\S]*只读权限[\s\S]*不能下单、转账或修改账户设置/);
  assert.match(flow, /const binanceInvitationItem = appendTradingPreferenceMessage\([\s\S]*TRADING_PREFERENCE_BINANCE_INVITATION[\s\S]*label: "连接币安"[\s\S]*destination: "binance-account"/);
  assert.match(flow, /transcriptItems\.length \? transcriptItems : \[completionItem, binanceInvitationItem\]/);
  assert.match(send, /tradingPreferenceOnboardingByThreadId\.has\(threadId\)[\s\S]*handleTradingPreferenceOnboardingReply/);
  assert.ok(
    send.indexOf("handleTradingPreferenceOnboardingReply") < send.indexOf("classifyTradingStrategyForSend"),
    "onboarding replies must be consumed before model or strategy routing",
  );
});

test("completed preference onboarding promotes a local blank task before persisting its transcript", async () => {
  const source = await rendererSource;
  const persistence = sourceBlock(
    source,
    "async function persistCompletedTradingExpertTranscript",
    "function stampCompletedTradingExpertTranscriptTiming",
  );

  assert.match(persistence, /isLocalBlankThreadId\(activeThreadId\)/);
  assert.match(persistence, /await promoteLocalBlankThreadForSend\(activeThreadId\)/);
  assert.match(persistence, /await persistTradingExpertTranscriptItems\(activeThreadId, items, options\)/);
  assert.doesNotMatch(persistence, /persistTradingExpertTranscriptItems\(threadId, items\)/);
  assert.match(source, /const TRADING_PREFERENCE_THREAD_TITLE = "配置交易偏好"/);
  assert.match(source, /persistCompletedTradingExpertTranscript\([\s\S]*\{ title: TRADING_PREFERENCE_THREAD_TITLE \}/);
});

test("preference start action sits below the bubble and covers all light and dark interaction states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.trading-preference-onboarding-message \.message-stack\s*\{[^}]*width: 100%;[^}]*max-width: 100%;/s);
  assert.match(styles, /\.trading-preference-onboarding-actions\s*\{[^}]*justify-content: flex-start;[^}]*margin-top: 8px;/s);
  assert.match(styles, /\.trading-preference-onboarding-start,\s*\.message-actions \.trading-preference-binance-connect\s*\{[^}]*border-radius: 8px;[^}]*background:/s);
  assert.match(styles, /\.trading-preference-onboarding-start:hover:not\(:disabled\)/);
  assert.match(styles, /\.trading-preference-onboarding-start:active:not\(:disabled\)/);
  assert.match(styles, /\.trading-preference-onboarding-start:focus-visible/);
  assert.match(styles, /\.trading-preference-onboarding-start:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-preference-onboarding-start,\s*html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-preference-onboarding-start:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-preference-onboarding-start:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-preference-onboarding-start:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-preference-onboarding-start:disabled/);
});

test("the final Binance invitation uses the onboarding action style and opens the account page", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const actionRenderer = sourceBlock(
    source,
    "function renderMessageActions",
    "function isRechargeTokenAction",
  );
  const actionBindings = sourceBlock(
    source,
    "function bindMessageContentEvents",
    "async function writeTextToClipboard",
  );
  const actionHydration = sourceBlock(
    source,
    "function messageActionsFromItem",
    "function itemToMessage",
  );

  assert.match(actionRenderer, /action\.destination === "binance-account"/);
  assert.match(actionRenderer, /trading-preference-onboarding-actions/);
  assert.match(actionRenderer, /trading-preference-onboarding-start trading-preference-binance-connect/);
  assert.match(actionBindings, /messageActionDestination === "binance-account"[\s\S]*openBinanceAccountPage\(\)/);
  assert.match(actionHydration, /TRADING_PREFERENCE_BINANCE_INVITATION/);
  assert.match(actionHydration, /destination: "binance-account"/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect\s*\{/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:hover:not\(:disabled\)/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:active:not\(:disabled\)/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:focus-visible/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect:disabled/);
});
