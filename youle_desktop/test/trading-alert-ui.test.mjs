import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTradingAlertsUiState,
  formatTradingAlertCardSummary,
  formatTradingAlertDisplayText,
  formatTradingAlertMarketLabel,
  renderPlanningNavigation,
  renderTradingAlertsPage,
  resolveTradingAlertSourceText,
} from "../src/renderer/trading-alerts-ui.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const alertUiSource = readFile(new URL("../src/renderer/trading-alerts-ui.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("saved plans and alerts share one top-level workspace while automatic tasks remain independent", async () => {
  const source = await rendererSource;
  assert.match(source, /type ViewId[\s\S]*"alerts"/);
  assert.match(source, /function openTradingAlertsPage[\s\S]*state\.activeView = "alerts"/);
  assert.match(source, /function openExecutionPlansPage[\s\S]*state\.activeView = "plans"/);
  assert.match(source, /function openAutoTasksPage[\s\S]*state\.activeView = "autoTasks"/);
  assert.match(source, /renderTradingAlertsPage\(state\.tradingAlerts\)/);
  assert.match(source, /data-conversation-static-action="plans"/);
  assert.match(source, /\[data-planning-section\][\s\S]*openExecutionPlansPage\(\)[\s\S]*openTradingAlertsPage\(\)/);
  assert.match(renderPlanningNavigation("plans"), /data-planning-section="plans"[\s\S]*data-planning-section="alerts"/);
});

test("alerts keep a 16px top-left workspace corner when the window is maximized", async () => {
  const styles = await stylesSource;
  assert.match(
    styles,
    /\.window-maximized \.desktop-body > :is\([\s\S]*?\.trading-alerts-page,[\s\S]*?\.skills-plaza-page[\s\S]*?\)\s*\{\s*border-top-left-radius:\s*16px;/s,
  );
  assert.match(
    styles,
    /html\[data-theme\] \.desktop-body:has\(> :is\([\s\S]*?\.trading-alerts-page,[\s\S]*?\.skills-plaza-page[\s\S]*?\)\)\s*\{\s*background:\s*var\(--app-chrome-background\);/s,
  );
});

test("alert errors stay hidden and overflowing cards use a themed scroll region", async () => {
  const state = createTradingAlertsUiState();
  state.error = "确认已过期，请重新模拟";
  const html = renderTradingAlertsPage(state);
  const [source, styles, renderer] = await Promise.all([alertUiSource, stylesSource, rendererSource]);
  const actionHandlers = renderer.slice(
    renderer.indexOf('root.querySelectorAll<HTMLElement>("[data-trading-alert-action]")'),
    renderer.indexOf("bindTradingAlertEditorSelects()"),
  );

  assert.doesNotMatch(html, /确认已过期|重试|role="alert"|trading-alert-page-error/);
  assert.match(html, /class="trading-alert-list-scroll" role="region" aria-label="预警列表" tabindex="0"/);
  assert.doesNotMatch(source, /trading-alert-page-error|data-trading-alert-action="refresh"/);
  assert.doesNotMatch(actionHandlers, /action === "refresh"/);
  assert.doesNotMatch(styles, /\.trading-alert-page-error/);
  assert.match(styles, /\.trading-alerts-page\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.trading-alert-list-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(styles, /\.trading-alert-list-scroll::-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--alert-scrollbar-thumb\);/s);
  assert.match(styles, /\.trading-alert-list-scroll::-webkit-scrollbar-thumb:hover,[\s\S]*?::-webkit-scrollbar-thumb:active/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alerts-page\s*\{[^}]*--alert-scrollbar-thumb:/s);
});

test("alert market scopes use concise venue-asset-interval labels", () => {
  assert.equal(formatTradingAlertMarketLabel("BINANCE:FUTURES:BTCUSDT", "4h"), "币安-BTC-4h");
  assert.equal(formatTradingAlertMarketLabel("BINANCE:SPOT:ETHUSDC", "15m"), "币安-ETH-15m");
  assert.equal(formatTradingAlertMarketLabel("HYPERLIQUID:PERPETUAL:SOL", "1h"), "Hyperliquid-SOL-1h");
  assert.equal(
    formatTradingAlertDisplayText("BINANCE:FUTURES:BTCUSDT 4h 收盘时确认"),
    "币安-BTC-4h 收盘时确认",
  );
  assert.equal(
    formatTradingAlertDisplayText("BINANCE:FUTURES:BTCUSDT · 4h 盘中触发"),
    "币安-BTC-4h 盘中触发",
  );
  assert.equal(
    formatTradingAlertCardSummary("BINANCE:FUTURES:BTCUSDT 4h 收盘时确认", "币安-BTC-4h"),
    "收盘时确认",
  );
  assert.equal(
    formatTradingAlertCardSummary("BTC 永续 4小时收盘确认", "币安-BTC-4h"),
    "BTC 永续 4小时收盘确认",
  );
});

test("alert cards use the concise market label", () => {
  const state = createTradingAlertsUiState();
  const rule = {
    title: "BINANCE:FUTURES:BTCUSDT 4h 趋势预警",
    normalizedSummary: "BINANCE:FUTURES:BTCUSDT 4h 收盘时确认",
    contexts: [{
      contextId: "primary",
      marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
      intervals: ["4h"],
    }],
    evaluationPolicy: { anchorContextId: "primary", clock: "bar_close" },
    triggerPolicy: { mode: "once" },
  };
  state.loaded = true;
  state.alerts = [{ alertId: "market-label", rule, status: "monitoring", enabled: true }];
  const listHtml = renderTradingAlertsPage(state);
  assert.match(listHtml, /<h2 title="币安-BTC-4h 趋势预警">币安-BTC-4h 趋势预警<\/h2>/);
  assert.match(listHtml, /<p title="收盘时确认">收盘时确认<\/p>/);
  assert.match(listHtml, /<small title="币安-BTC-4h · 收盘确认 · 一次性">币安-BTC-4h · 收盘确认 · 一次性<\/small>/);
});

test("the alert page contains no draft filter, cards, confirmation, or deletion UI", async () => {
  const [ui, renderer, styles] = await Promise.all([alertUiSource, rendererSource, stylesSource]);
  assert.doesNotMatch(ui, /trading-alert-draft|renderDraft|pendingConfirmations|busyDraftId|deleteDraftId|\["draft", "草稿"\]/);
  assert.doesNotMatch(renderer, /confirmTradingAlertDraft|deleteTradingAlertDraft|tradingAlertsCancelDraft|confirm-draft|draft-delete/);
  assert.doesNotMatch(styles, /trading-alert-(?:draft|status\.draft)/);
});

test("@预警 conversation is compiled, simulated and explicitly confirmed before creation", async () => {
  const source = await rendererSource;
  assert.match(source, /function tradingAlertMentioned/);
  assert.match(source, /tradingAlertsCompile!/);
  assert.match(source, /tradingExpertAlertSimulationFrames/);
  assert.match(source, /tradingAlertsSimulate!/);
  assert.match(source, /showTradingExpertAlertSimulation/);
  assert.match(source, /tradingAlertAffirmative[\s\S]*tradingAlertsConfirm!/);
  assert.match(source, /tradingAlertCancelled[\s\S]*tradingAlertConversationByThreadId\.delete\(threadId\)[\s\S]*clearTradingExpertAlertSimulation/);
});

test("clarification replies keep the original alert instruction as source text", () => {
  const sourceText = resolveTradingAlertSourceText({
    sourceText: "触碰任意一条就预警",
    conversation: [
      { role: "user", text: "当K线触碰我画的两条趋势线并且量能比前一根高时预警" },
      { role: "assistant", text: "任意一条还是两条都触碰？" },
      { role: "user", text: "触碰任意一条就预警" },
    ],
  }, "两条都监控");

  assert.equal(sourceText, "当K线触碰我画的两条趋势线并且量能比前一根高时预警");
});

test("a bounded conversation never replaces a persisted original with its first remaining reply", () => {
  const sourceText = resolveTradingAlertSourceText({
    sourceText: "当MA5死叉MA20并且MACD下穿零轴时预警",
    conversation: [
      { role: "user", text: "等待当前4小时K线收盘确认" },
      { role: "assistant", text: "只提醒一次还是重复提醒？" },
    ],
  }, "只提醒一次");

  assert.equal(sourceText, "当MA5死叉MA20并且MACD下穿零轴时预警");
});

test("unconfirmed state is memory-only and success is shown only after persisted list readback", async () => {
  const [renderer, ui] = await Promise.all([rendererSource, alertUiSource]);
  assert.doesNotMatch(ui, /drafts: any\[\]|pendingConfirmations|deleteDraftId/);
  assert.match(renderer, /!state\.tradingAlerts\.loaded[\s\S]*await refreshTradingAlerts\(\)/);
  assert.match(renderer, /function tradingAlertConversationStateForThread[\s\S]*inMemoryTradingAlertConversationForThread\(threadId\)/);
  assert.doesNotMatch(renderer, /pendingTradingAlertConfirmationForThread|activeTradingAlertDraftForThread|recoveredTradingAlertDraftConversation/);
  assert.match(renderer, /tradingAlertCandidateAtSend[\s\S]*tradingAlertConversationStateForThread\(threadId\)/);
  assert.match(renderer, /tradingAlertsConfirm![\s\S]*refreshTradingAlertsAndRequireAlert\(alertId\)[\s\S]*persistTradingAlertCreationSuccessItem/);
  assert.match(renderer, /预警写入后未能从预警列表读回/);
});

test("clarification replies remain on the promoted Trading Expert task", async () => {
  const source = await rendererSource;
  assert.match(
    source,
    /function composerThreadIdForSend[\s\S]*resolveComposerThreadIdForSend\([\s\S]*resolveThreadId: resolvedTradingAlertThreadId[\s\S]*isVisibleThreadId/,
  );
  assert.match(
    source,
    /function replaceRenderedComposerThreadId[\s\S]*form\.dataset\.threadId === previousThreadId[\s\S]*form\.dataset\.threadId = nextThreadId/,
  );
  assert.match(
    source,
    /replaceComposerDraftThreadId\(previousThreadId, nextThreadId\);\s*replaceRenderedComposerThreadId\(previousThreadId, nextThreadId\);/,
  );
  assert.match(
    source,
    /async function sendCurrentMessage[\s\S]*composerThreadIdForSend\(firstString\(threadIdOverride, currentComposerThreadId\(\)\)\)/,
  );
  assert.match(
    source,
    /addEventListener\("submit"[\s\S]*currentComposerThreadId\([\s\S]*event\.currentTarget as HTMLFormElement/,
  );
});

test("clarification and dependency state is not recovered after reload", async () => {
  const source = await rendererSource;
  assert.match(source, /function inMemoryTradingAlertConversationForThread[\s\S]*tradingAlertThreadMatches/);
  assert.match(source, /function tradingAlertConversationStateForThread[\s\S]*return inMemoryTradingAlertConversationForThread\(threadId\) \|\| null/);
  assert.doesNotMatch(source, /activeTradingAlertDraftForThread|recoveredTradingAlertDraftConversation|rememberTradingAlertDraftSnapshot/);
});

test("a simulation overlay lifecycle error never reports intent creation as failed", async () => {
  const [renderer, market] = await Promise.all([rendererSource, marketSource]);
  assert.match(renderer, /simulation overlay failed/);
  assert.match(renderer, /规则和模拟已经生成，但本次图表标注暂时没有显示/);
  assert.match(market, /skipped an already-detached simulation series/);
  assert.match(market, /Value is \(\?:undefined\|null\)/);
});

test("failed alert history removes simulated candles and restores the real K-line viewport", async () => {
  const [renderer, market] = await Promise.all([rendererSource, marketSource]);
  assert.match(renderer, /function tradingAlertThreadEndedWithFailure[\s\S]*预警流程尚未完成，未创建后台监控/);
  assert.match(renderer, /clearFailedTradingAlertHistorySimulation[\s\S]*clearTradingExpertAlertSimulation/);
  assert.match(renderer, /catch \(visualizationError\)[\s\S]*clearTradingExpertAlertSimulation\(\)/);
  assert.match(renderer, /catch \(error\)[\s\S]*TRADING_ANALYSIS_CANCELLED[\s\S]*clearTradingExpertAlertSimulation\(\)/);
  assert.match(market, /alertSimulationPreviousLogicalRange/);
  assert.match(market, /partially attached series[\s\S]*this\.clearAlertSimulation\(\)/);
  assert.match(market, /Persisted overlays from older builds[\s\S]*this\.applyInitialChartViewport\(\)/);
  assert.match(market, /simulation animation failed[\s\S]*this\.clearAlertSimulation\(\)/);
});

test("created-alert bubble exposes a persistent minimal link to the alert list in both themes", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  assert.match(renderer, /label: "查看我的预警"/);
  assert.match(renderer, /destination: "trading-alerts"/);
  assert.match(renderer, /data-message-action-destination/);
  assert.match(renderer, /button\.dataset\.messageActionDestination === "trading-alerts"[\s\S]*openTradingAlertsPage\(\)/);
  assert.match(renderer, /actionsBelowBubble[\s\S]*message-actions-below-bubble/);
  assert.match(styles, /\.message-actions-below-bubble/);
  assert.match(styles, /\.message-actions \.message-trading-alert-link\s*\{[\s\S]*?font-weight:\s*400;/);
  assert.match(styles, /\.message-actions \.message-trading-alert-link:hover/);
  assert.match(styles, /\.message-actions \.message-trading-alert-link:active/);
  assert.match(styles, /\.message-actions \.message-trading-alert-link:focus-visible/);
  assert.match(styles, /\.message-actions \.message-trading-alert-link:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.message-trading-alert-link/);
});

test("simulation candles stay isolated without chart watermark or future-divider chrome", async () => {
  const [source, renderer, styles] = await Promise.all([marketSource, rendererSource, stylesSource]);
  const method = source.match(/showAlertSimulation\([\s\S]*?\n  clearAlertSimulation/)?.[0] || "";
  assert.match(method, /const series = this\.chart\.addSeries\(CandlestickSeries/);
  assert.doesNotMatch(source, /模拟情景|仅用于确认规则，不是真实行情|退出模拟|未来模拟/);
  assert.doesNotMatch(source, /data-alert-simulation-(?:watermark|divider)|clear-alert-simulation/);
  assert.doesNotMatch(renderer, /模拟 K 线带有“模拟情景”标识/);
  assert.match(method, /stagedDisplay[\s\S]*index < visibleCount \? candle : \{ time: candle\.time \}/);
  assert.match(method, /series\.setData\(stagedDisplay\(animate \? 1 : state\.display\.length\)\)/);
  assert.match(method, /series\.setData\(stagedDisplay\(count\)\)/);
  assert.match(method, /time: \(Math\.floor\(Number\(candle\.time\) \/ 1_000\) \+ CHINA_TIME_OFFSET_SECONDS\) as UTCTimestamp/);
  assert.match(method, /latestRealDisplayTime[\s\S]*display\[0\][\s\S]*模拟 K 线时间锚点已过期/);
  assert.match(method, /timeScale\.setVisibleRange/);
  assert.match(method, /simulation\.triggerBarIndex/);
  assert.match(method, /simulation\?\.triggerPoint\?\.time/);
  assert.match(method, /simulation\?\.triggerPoint\?\.price/);
  assert.match(method, /timeToCoordinate\(state\.triggerTime as UTCTimestamp\)/);
  assert.match(method, /anchoredX[\s\S]*Math\.max\(12, Math\.min\(mainGeometry\.width - 12, x\)\)/);
  assert.match(method, /priceToCoordinate\(state\.triggerPrice\)/);
  assert.match(method, /resolveTradingAlertAnnotationPlacement\(/);
  assert.match(method, /--alert-annotation-line-length/);
  assert.match(method, /--alert-annotation-line-angle/);
  assert.match(method, /markerColor = marketTheme\(isDarkTheme\(\)\)\.alertMarker/);
  assert.match(source, /alertMarker: "#fbbf24"[\s\S]*alertMarker: "#b45309"/);
  assert.match(styles, /\.trading-alert-simulation-annotations\s*\{[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.trading-alert-simulation-point\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s);
  assert.match(styles, /\.trading-alert-simulation-point > span\s*\{[^}]*width:\s*max-content;[^}]*background:[^}]*var\(--trading-market-panel\)/s);
  assert.match(styles, /\.trading-alert-simulation-point::after\s*\{[^}]*width:\s*var\(--alert-annotation-line-length\);[^}]*border-top:\s*1px dashed currentColor;[^}]*transform:\s*rotate\(var\(--alert-annotation-line-angle\)\);[^}]*transform-origin:\s*left center;/s);
  assert.match(styles, /\.trading-alert-simulation-point::before\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*currentColor;/s);
  assert.doesNotMatch(styles, /\.trading-alert-simulation-point::after\s*\{[^}]*(?:border-right|border-left):[^}]*transparent/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-simulation-point/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-simulation-point > span/);
  assert.doesNotMatch(method, /dataset\.side|labelBounds\.right > chartBounds\.right/);
  assert.doesNotMatch(method, /shape:\s*"arrowDown"/);
  const geometrySync = source.match(/private synchronizeVisibleChartGeometry\(\)[\s\S]*?\n  }/)?.[0] || "";
  assert.match(geometrySync, /updateVisiblePriceScale\(\)[\s\S]*paintAlertSimulationMarker\(\)[\s\S]*redrawDrawingControllers\(\)/);
  assert.match(source, /subscribeVisibleLogicalRangeChange[\s\S]*synchronizeVisibleChartGeometry\(\)/);
  assert.doesNotMatch(method, /fitContent\(\)/);
  assert.doesNotMatch(method, /this\.candles\s*=|this\.candles\.push/);
});

test("simulation annotations survive pane-layout races and off-screen trigger coordinates", async () => {
  const source = await marketSource;
  const geometry = source.match(/private alertSimulationPaneGeometry\([\s\S]*?\n  }/)?.[0] || "";
  const marker = source.match(/private paintAlertSimulationMarkerNow\(\)[\s\S]*?\n  private detachAlertSimulation/)?.[0] || "";
  const focus = source.match(/private queueAlertSimulationViewportFocus\([\s\S]*?\n  }/)?.[0] || "";
  assert.match(geometry, /getHTMLElement\?\.\(\)\?\.getBoundingClientRect/);
  assert.match(geometry, /try \{[\s\S]*this\.chart\.paneSize\(paneIndex\)[\s\S]*\} catch/);
  assert.match(marker, /Math\.max\(12, Math\.min\(mainGeometry\.width - 12, x\)\)/);
  assert.match(marker, /Math\.max\(12, Math\.min\(geometry\.width - 12, x\)\)/);
  assert.match(marker, /queueAlertSimulationViewportFocus\(state, this\.alertSimulationSeries\)/);
  assert.match(focus, /indicatorPanesReady/);
  assert.match(focus, /alertSimulationViewportFocusRetries >= 12/);
  assert.match(source, /simulation range[\s\S]*authoritative until its isolated overlay is cleared/);
});

test("simulation annotation layout reserves a data-free rail and avoids earlier labels", async () => {
  const {
    resolveTradingAlertAnnotationPlacement,
    tradingAlertAnnotationRightPaddingBars,
  } = await import("../src/renderer/trading-expert-market.ts");
  const first = resolveTradingAlertAnnotationPlacement({
    anchorX: 610,
    anchorY: 250,
    labelWidth: 170,
    labelHeight: 26,
    paneLeft: 0,
    paneTop: 0,
    paneRight: 900,
    paneBottom: 500,
    dataRightX: 660,
    dataTopY: 90,
  });
  assert.equal(first.mode, "right-rail");
  assert.ok(first.left > 660, "label must begin after the final plotted value");
  assert.ok(first.lineEndX > 610 && first.lineEndY < 250, "leader must run diagonally to the label");

  const second = resolveTradingAlertAnnotationPlacement({
    anchorX: 610,
    anchorY: 250,
    labelWidth: 170,
    labelHeight: 26,
    paneLeft: 0,
    paneTop: 0,
    paneRight: 900,
    paneBottom: 500,
    dataRightX: 660,
    dataTopY: 90,
    occupied: [first],
  });
  assert.equal(second.mode, "right-rail");
  assert.ok(second.top >= first.top + first.height + 7 || first.top >= second.top + second.height + 7);

  const topLane = resolveTradingAlertAnnotationPlacement({
    anchorX: 530,
    anchorY: 260,
    labelWidth: 170,
    labelHeight: 26,
    paneLeft: 0,
    paneTop: 0,
    paneRight: 700,
    paneBottom: 400,
    dataRightX: 650,
    dataTopY: 100,
  });
  assert.equal(topLane.mode, "top-lane");
  assert.ok(topLane.top + topLane.height < 100, "fallback lane must remain above pane data");
  assert.ok(tradingAlertAnnotationRightPaddingBars(1000, 40, 24) > 4);
  assert.ok(tradingAlertAnnotationRightPaddingBars(480, 40, 24) >= tradingAlertAnnotationRightPaddingBars(1000, 40, 24));
});

test("real trigger evidence marks the real K-line and matching indicator pane", async () => {
  const source = await marketSource;
  const focus = source.match(/focusAlertEvidence\(evidence: any, rule\?: any\)[\s\S]*?\n  async alertSimulationFrames/)?.[0] || "";
  assert.match(focus, /matchingContext[\s\S]*matchingContext\?\.eventTime \|\| evidence\?\.triggeredAt/);
  assert.match(focus, /createAlertSimulationAnnotation\("预警已触发", "alert-evidence"\)/);
  assert.match(focus, /evidenceCandle\?\.time[\s\S]*alertEvidenceCandleSeries = this\.chart\.addSeries\(CandlestickSeries/);
  assert.match(focus, /price: hasEvidenceCandle \? Number\(evidenceCandle\.high\) : nearest\.high/);
  assert.match(focus, /alertSimulationIndicatorRuntimes[\s\S]*\.filter\(\(runtime\) => runtime\.pane\)/);
  assert.match(focus, /result\.currentValues\?\.left[\s\S]*result\.currentValues\?\.right/);
  assert.match(focus, /runtime\.pane\.addSeries\(LineSeries/);
  assert.match(focus, /`已触发 · \$\{simulationIndicatorTriggerLabel\(condition\)\}`/);
  assert.match(focus, /paintAlertSimulationMarker\(\)/);
  assert.doesNotMatch(focus, /createSeriesMarkers|shape:\s*"arrowDown"/);
  assert.match(source, /hasEvidenceIndicatorTarget[\s\S]*alertEvidenceIndicatorTargets\.forEach[\s\S]*priceToCoordinate/);
});

test("alert view returns to its origin conversation and restores saved simulation instead of rendering a detail page", async () => {
  const [renderer, ui, styles, market] = await Promise.all([rendererSource, alertUiSource, stylesSource, marketSource]);
  assert.match(ui, /data-trading-alert-action="view"/);
  assert.match(renderer, /action === "view" && alertId[\s\S]*openTradingAlertSourceConversation\(alertId\)/);
  assert.match(renderer, /openTradingAlertSourceConversation[\s\S]*alert\.originThreadId[\s\S]*selectThread\(threadId\)/);
  assert.match(renderer, /tradingAlertsGetSimulation\(\{ simulationId:[\s\S]*showTradingExpertAlertSimulation/);
  assert.match(renderer, /allowHistorical: true, animate: false, focus: !evidence/);
  assert.match(renderer, /focusTradingExpertAlertEvidence\(evidence, alert\.rule\)/);
  assert.match(market, /options\.allowHistorical !== true[\s\S]*模拟 K 线时间锚点已过期/);
  for (const removed of ["selectedAlertId", "selectedEvidenceId", "renderDetail", "view-evidence-chart"]) {
    assert.doesNotMatch(ui, new RegExp(removed));
  }
  assert.doesNotMatch(styles, /\.trading-alert-detail|\.trading-alert-evidence/);
  const tradingAlertConversation = renderer.match(/async function runTradingAlertConversation[\s\S]*?\nfunction tradingTranscriptPayloadFromItem/)?.[0] || "";
  const confirmation = tradingAlertConversation.match(/if \(confirmsDraftCreation\)[\s\S]*?await persistTradingAlertCreationSuccessItem/)?.[0] || "";
  assert.doesNotMatch(confirmation, /clearTradingExpertAlertSimulation\(\)/);
});

test("simulation series are isolated by market and interval and restore after returning", async () => {
  const source = await marketSource;
  const contextMatch = source.match(/private alertSimulationMatchesCurrentContext\(\)[\s\S]*?\n  }/)?.[0] || "";
  const restart = source.match(/private async restartMarketData\([\s\S]*?\n  }/)?.[0] || "";
  assert.match(contextMatch, /state\.marketId === this\.selectedMarketId/);
  assert.match(contextMatch, /state\.interval === this\.activeInterval/);
  assert.match(contextMatch, /state\.marketId === this\.loadedMarketId/);
  assert.match(contextMatch, /state\.interval === this\.loadedInterval/);
  assert.match(restart, /this\.detachAlertSimulation\(\)[\s\S]*await[\s\S]*this\.commitMarketSnapshot\(/);
  assert.match(source, /private commitMarketSnapshot\([\s\S]*?this\.syncAlertSimulationForCurrentContext\(\)/);
  assert.match(source, /expectedMarketId[\s\S]*模拟结果与当前 K 线图的交易对或周期不一致，已拒绝显示/);
  assert.doesNotMatch(source, /queueAlertSimulationLayout|alertSimulationLayoutFrame/);
});

test("simulation overlay persists per Trading Expert task until the workflow resets it", async () => {
  const {
    clearTradingAlertSimulationState,
    loadTradingAlertSimulationState,
    saveTradingAlertSimulationState,
    tradingAlertSimulationStorageKey,
  } = await import("../src/renderer/trading-expert-market.ts");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const state = {
    schemaVersion: 1,
    simulationId: "simulation-persisted",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    display: [
      { time: 1_800_000_000, open: 100, high: 103, low: 99, close: 102 },
      { time: 1_800_003_600, open: 102, high: 105, low: 101, close: 104 },
    ],
    history: [
      { time: 1_799_996_400, open: 98, high: 101, low: 97, close: 100, volume: 12_000 },
    ],
    triggerIndex: 1,
    triggerTime: 1_800_003_200,
    triggerPrice: 103.5,
    stepSeconds: 3_600,
    updatedAt: 1_800_000_000_000,
    conditionAnnotations: [{
      annotationId: "condition:line-1",
      label: "模拟触发 · K线触碰趋势线",
      conditionIds: ["line-high", "line-low"],
      time: 1_800_003_200,
      price: 103.5,
    }],
  };

  assert.equal(saveTradingAlertSimulationState(storage, "task-a", state), true);
  assert.deepEqual(loadTradingAlertSimulationState(storage, "task-a"), state);
  assert.equal(loadTradingAlertSimulationState(storage, "task-b"), null);
  assert.match(tradingAlertSimulationStorageKey("task-a"), /alert-simulation\.v1\.task-a$/);
  clearTradingAlertSimulationState(storage, "task-a");
  assert.equal(loadTradingAlertSimulationState(storage, "task-a"), null);

  values.set(tradingAlertSimulationStorageKey("invalid"), JSON.stringify({ ...state, display: [{ time: 1, open: 10, high: 8, low: 9, close: 10 }] }));
  assert.equal(loadTradingAlertSimulationState(storage, "invalid"), null);

  const source = await marketSource;
  const show = source.match(/showAlertSimulation\([\s\S]*?\n  private alertSimulationMatchesCurrentContext/)?.[0] || "";
  const clear = source.match(/\n  clearAlertSimulation\([^)]*\) \{[\s\S]*?\n  }/)?.[0] || "";
  const destroy = source.match(/\n  destroy\(\) \{[\s\S]*?\n  }/)?.[0] || "";
  assert.match(show, /saveTradingAlertSimulationState\([\s\S]*window\.localStorage[\s\S]*this\.drawingStorageSessionId/);
  assert.match(source, /loadPersistedAlertSimulation\(\)[\s\S]*loadTradingAlertSimulationState/);
  assert.match(source, /attachAlertSimulationConditionAnnotations\(\)/);
  assert.match(source, /state\.history\?\.length[\s\S]*alertSimulationHistorySeries/);
  assert.match(source, /detachAlertSimulationConditionAnnotations\(\)/);
  assert.match(source, /migrateTradingAlertSimulationState\([\s\S]*migrateFromSessionId[\s\S]*drawingStorageSessionId/);
  assert.match(clear, /clearTradingAlertSimulationState\(window\.localStorage, this\.drawingStorageSessionId\)/);
  assert.match(destroy, /this\.detachAlertSimulation\(\)/);
  assert.doesNotMatch(destroy, /this\.clearAlertSimulation\(\)/);
});

test("indicator simulations are extracted from the verified rule and preserve exact parameters", async () => {
  const { collectTradingAlertSimulationIndicators } = await import("../src/renderer/trading-expert-market.ts");
  const condition = (conditionId, operator, left, right) => ({
    type: "condition",
    condition: { conditionId, contextId: "primary", operator, left, right },
  });
  const indicator = (name, params, output) => ({
    type: "indicator",
    name,
    params,
    ...(output ? { output } : {}),
  });
  const rule = {
    root: {
      type: "all",
      children: [
        condition("ma-death-cross", "cross_under", indicator("ma", { period: 5 }), indicator("sma", { period: 20 })),
        condition("macd-zero", "cross_under", indicator("macd", { fast: 8, slow: 21, signal: 5 }, "dif"), { type: "constant", value: 0 }),
        condition("boll-upper", "cross_over", { type: "field", field: "close" }, indicator("boll", { period: 18, multiplier: 2.5 }, "upper")),
        condition("rsi-level", "cross_under", indicator("rsi", { period: 9 }), { type: "constant", value: 30 }),
        condition("kdj-cross", "cross_under", indicator("kdj", { period: 9, smoothK: 3, smoothD: 5 }, "k"), indicator("kdj", { period: 9, smoothK: 3, smoothD: 5 }, "d")),
        condition("volume-spike", "gt", { type: "field", field: "volume" }, {
          type: "math", op: "mul", args: [
            { type: "constant", value: 3 },
            { type: "rolling", op: "max", expr: { type: "field", field: "volume" }, period: 3, offset: 1 },
          ],
        }),
      ],
    },
  };
  const specs = collectTradingAlertSimulationIndicators(rule, "primary");
  const byId = new Map(specs.map((spec) => [spec.specId, spec]));

  assert.deepEqual(byId.get("main:ma:5")?.parameters, [5]);
  assert.deepEqual(byId.get("main:ma:20")?.parameters, [20]);
  assert.equal(byId.get("main:ma:5")?.triggerLabel, "MA5/MA20死叉");
  assert.deepEqual(byId.get("main:boll:18:2.5")?.parameters, [18, 2.5]);
  assert.deepEqual(byId.get("pane:macd:8:21:5")?.parameters, [8, 21, 5]);
  assert.deepEqual(byId.get("pane:rsi:9")?.parameters, [9]);
  assert.deepEqual(byId.get("pane:kdj:9:3:5")?.parameters, [9, 3, 5]);
  assert.deepEqual(byId.get("pane:volume:5:10")?.parameters, [5, 10]);
  assert.equal(byId.get("pane:volume:5:10")?.triggerLabel, "VOLUME高于3×前3根最大量");
  assert.ok(specs.every((spec) => spec.conditionIds.length > 0));
});

test("multi-condition simulation annotates every active condition and includes chart-compatible drawing contexts", async () => {
  const {
    collectTradingAlertSimulationConditionAnnotations,
    collectTradingAlertSimulationIndicators,
  } = await import("../src/renderer/trading-expert-market.ts");
  const drawing = { type: "drawing", drawingId: "line-2", output: "price_at_time" };
  const rule = {
    contexts: [
      { contextId: "primary", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] }, intervals: ["4h"] },
      { contextId: "drawing_2", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] }, intervals: ["4h"], drawingBinding: { marketId: "BINANCE:FUTURES:BTCUSDT" } },
    ],
    root: { type: "all", children: [
      { type: "condition", condition: { conditionId: "line-high", contextId: "drawing_2", operator: "gte", left: { type: "field", field: "high" }, right: drawing } },
      { type: "condition", condition: { conditionId: "line-low", contextId: "drawing_2", operator: "lte", left: { type: "field", field: "low" }, right: drawing } },
      { type: "condition", condition: { conditionId: "volume-up", contextId: "primary", operator: "gt", left: { type: "field", field: "volume" }, right: { type: "lag", expr: { type: "field", field: "volume" }, bars: 1 } } },
      { type: "condition", condition: { conditionId: "inactive-rsi", contextId: "primary", operator: "gt", left: { type: "indicator", name: "rsi", params: { period: 14 } }, right: { type: "constant", value: 70 } } },
    ] },
  };
  const activeConditionIds = ["line-high", "line-low", "volume-up"];
  const simulation = {
    activeConditionIds,
    triggerPoints: [{
      kind: "drawing",
      contextId: "drawing_2",
      drawingId: "line-2",
      conditionId: "line-high",
      conditionIds: ["line-high", "line-low"],
      time: 1_800_000_000_000,
      price: 63_000,
    }],
  };
  const annotations = collectTradingAlertSimulationConditionAnnotations(rule, simulation, "primary");
  const indicators = collectTradingAlertSimulationIndicators(rule, "primary", activeConditionIds);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].label, "模拟触发 · K线触碰趋势线");
  assert.deepEqual(annotations[0].conditionIds, ["line-high", "line-low"]);
  assert.equal(indicators.length, 1);
  assert.equal(indicators[0].name, "volume");
  assert.deepEqual(indicators[0].conditionIds, ["volume-up"]);
  assert.deepEqual(
    new Set([...annotations.flatMap((entry) => entry.conditionIds), ...indicators.flatMap((entry) => entry.conditionIds)]),
    new Set(activeConditionIds),
  );

  const legacyRule = { ...rule, root: { type: "all", children: rule.root.children.slice(0, 3) } };
  const legacyAnnotations = collectTradingAlertSimulationConditionAnnotations(legacyRule, {
    triggerBarIndex: 0,
    generated: {
      drawing_2: [{ time: 1_800_000_000_000, open: 63_100, high: 63_200, low: 62_900, close: 63_000 }],
    },
    proof: { trace: [
      { conditionId: "line-high", value: true, left: 63_200, right: 63_000 },
      { conditionId: "line-low", value: true, left: 62_900, right: 63_000 },
      { conditionId: "volume-up", value: true, left: 20_000, right: 15_000 },
    ] },
  }, "primary");
  assert.equal(legacyAnnotations[0]?.label, "模拟触发 · K线触碰趋势线");
  assert.deepEqual(legacyAnnotations[0]?.conditionIds, ["line-high", "line-low"]);
});

test("main-chart indicator crosses anchor their annotation to the planner's exact intersection", async () => {
  const { collectTradingAlertSimulationConditionAnnotations } = await import("../src/renderer/trading-expert-market.ts");
  const rule = {
    contexts: [{
      contextId: "primary",
      marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:ETHUSDT"] },
      intervals: ["1h"],
    }],
    root: { type: "condition", condition: {
      conditionId: "ma-death-cross",
      contextId: "primary",
      operator: "cross_under",
      left: { type: "indicator", name: "ma", params: { period: 5 } },
      right: { type: "indicator", name: "ma", params: { period: 20 } },
    } },
  };
  const simulation = { triggerPoints: [{
    kind: "indicator",
    contextId: "primary",
    conditionId: "ma-death-cross",
    conditionIds: ["ma-death-cross"],
    time: 1_800_001_800_000,
    price: 1_884.375,
  }] };
  const annotations = collectTradingAlertSimulationConditionAnnotations(rule, simulation, "primary");
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].label, "模拟触发 · MA5/MA20死叉");
  assert.equal(annotations[0].time, 1_800_001_800 + 8 * 60 * 60);
  assert.equal(annotations[0].price, 1_884.375);
});

test("future candles and all supported main/sub indicator paths animate on one verified trigger timeline", async () => {
  const [source, renderer, styles] = await Promise.all([marketSource, rendererSource, stylesSource]);
  assert.match(renderer, /showTradingExpertAlertSimulation\(simulated\.simulation, draft\.rule\.evaluationPolicy\.anchorContextId, draft\.rule\)/);
  assert.match(source, /collectTradingAlertSimulationIndicators\(rule, anchorContextId, activeConditionIds\)/);
  assert.match(source, /\["ma", "ema", "boll"\]/);
  for (const indicator of ["volume", "macd", "rsi", "kdj", "atr", "cci", "adx", "momentum", "roc"]) {
    assert.match(source, new RegExp(`TRADING_ALERT_SIMULATION_PANE_INDICATORS[\\s\\S]*?"${indicator}"`));
  }
  assert.match(source, /alertSimulationCombinedCandles[\s\S]*simulationStart[\s\S]*this\.chartCandles\.filter\(\(candle\) => candle\.time < simulationStart\)[\s\S]*\.\.\.simulated/);
  assert.match(source, /realCandleCount = Math\.max\(0, candles\.length - state\.display\.length\)/);
  assert.match(source, /calculateAlertSimulationIndicator[\s\S]*computeSma[\s\S]*computeEma[\s\S]*computeBollingerBands[\s\S]*calculateTradingIndicator/);
  assert.match(source, /updateAlertSimulationIndicatorsSafely\(animate \? 1 : state\.display\.length\)/);
  assert.match(source, /series\.setData\(stagedDisplay\(count\)\)[\s\S]*updateAlertSimulationIndicatorsSafely\(count\)/);
  assert.match(source, /createAlertSimulationAnnotation\([\s\S]*`模拟触发 · \$\{ownedTriggers\[0\]\.label\}`/);
  assert.doesNotMatch(source, /createSeriesMarkers\(api,[\s\S]{0,2000}模拟触发/);
  assert.match(source, /runtime\.pane[\s\S]*priceToCoordinate\(Number\(triggerValue\)\)/);
  assert.match(source, /detachAlertSimulationIndicators\(\)[\s\S]*removeSeries[\s\S]*removePane/);
  assert.match(source, /alertSimulationIndicatorPalette\(isDarkTheme\(\)\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-simulation-point/);
});

test("simulation indicator pane failures cannot suppress the main trigger marker", async () => {
  const source = await marketSource;
  const attach = source.match(/private attachAlertSimulation\([^]*?\n  private alertSimulationCombinedCandles/)?.[0] || "";
  const attachIndicators = source.match(/private attachAlertSimulationIndicators\(\)[^]*?\n  private createAlertSimulationAnnotation/)?.[0] || "";
  const detachIndicators = source.match(/private detachAlertSimulationIndicators\(\)[^]*?\n  private applyAlertSimulationIndicatorTheme/)?.[0] || "";

  assert.match(attach, /simulation indicator attach failed[^]*?detachAlertSimulationIndicators\(\)/);
  assert.match(attach, /updateAlertSimulationIndicatorsSafely\(animate \? 1 : state\.display\.length\)/);
  assert.match(attach, /series\.setData\(stagedDisplay\(count\)\)[^]*?updateAlertSimulationIndicatorsSafely\(count\)/);
  assert.match(attachIndicators, /addPane\(true\)/);
  assert.doesNotMatch(attachIndicators, /addPane\(false\)/);
  assert.match(attachIndicators, /alertSimulationIndicatorRuntimes\.push\(runtime\)[^]*?result\.series\.forEach/);
  assert.match(detachIndicators, /splice\(0\)/);
  assert.match(detachIndicators, /panes\(\)\.indexOf\(pane\)/);
  assert.match(detachIndicators, /removeAlertSimulationPane\(pane\)/);
  assert.match(source, /simulation indicator update failed[^]*?detachAlertSimulationIndicators\(\)/);
});

test("alert cards expose lifecycle, gaps, source-conversation view and revision controls", async () => {
  const source = await alertUiSource;
  for (const token of ["monitoring", "triggered", "paused", "attention", "gap_detected", "reconnecting", "cooling_down"]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /监控空档/);
  assert.match(source, /Revision/);
  assert.match(source, /data-trading-alert-action="view"/);
  assert.match(source, /name="marketIds"/);
  assert.match(source, /renderEditorSelect\("intervals"/);
  assert.doesNotMatch(source, /当前约 .*逻辑监控组合|相同交易对\/周期会共享行情连接/);
  assert.match(source, /data-trading-alert-action="pause"|\? "pause" : "resume"/);
  assert.match(source, /data-trading-alert-action="delete"/);
});

test("alert editor hides the technical market scope and uses Haolo selects for visible dropdowns", async () => {
  const state = createTradingAlertsUiState();
  state.alerts = [{
    alertId: "editor-selects",
    status: "monitoring",
    enabled: true,
    rule: {
      contexts: [{
        contextId: "primary",
        marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
        intervals: ["4h"],
      }],
      evaluationPolicy: { anchorContextId: "primary", clock: "bar_close" },
      triggerPolicy: { mode: "repeat" },
    },
  }];
  state.editorAlertId = "editor-selects";
  state.editorMarkets = [
    { id: "BINANCE:FUTURES:BTCUSDT", provider: "binance", baseAsset: "BTC", displaySymbol: "BTC/USDT", venue: "币安", tag: "永续", markPrice: 63861.6, changePercent: .18, quoteAvailable: true },
    { id: "BINANCE:FUTURES:ETHUSDT", provider: "binance", baseAsset: "ETH", displaySymbol: "ETH/USDT", venue: "币安", tag: "永续", markPrice: 1896.39, changePercent: .38, quoteAvailable: true },
  ];
  state.editorPeriodOptions = [
    { value: "1m", label: "1分" },
    { value: "4h", label: "4时" },
  ];

  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const html = renderTradingAlertsPage(state);
  assert.equal((html.match(/data-trading-alert-select="/g) || []).length, 4);
  assert.doesNotMatch(html, /<select\b/);
  assert.doesNotMatch(html, /市场范围|指定交易对（可多选）|市场集合（确认时冻结）/);
  assert.doesNotMatch(html, /当前约 .*逻辑监控组合|相同交易对\/周期会共享行情连接/);
  assert.match(html, /<input type="hidden" name="selectorKind" value="fixed"/);
  assert.doesNotMatch(html, /<input(?![^>]*type="hidden")[^>]*name="(?:marketIds|intervals)"/);
  for (const name of ["marketIds", "intervals", "clock", "mode"]) {
    assert.match(html, new RegExp(`data-trading-alert-select="${name}"[\\s\\S]*?<input type="hidden" name="${name}"`));
  }
  assert.match(html, /data-trading-alert-market-search[^>]*placeholder="搜索交易对"/);
  assert.match(html, /BTC\/USDT[\s\S]*ETH\/USDT/);
  assert.match(html, /data-trading-alert-select="intervals"[\s\S]*?data-trading-alert-select-value="1m"[\s\S]*?>1分<[\s\S]*?data-trading-alert-select-value="4h"[\s\S]*?>4时</);
  assert.doesNotMatch(html, />1周<|>1日<|>5分<|>15分<|>1时</);
  assert.match(html, /data-trading-alert-select-value="mixed"[^>]*>多个条件</);
  assert.doesNotMatch(html, /按条件混合/);
  assert.doesNotMatch(html, /修改会生成新 Revision/);
  assert.match(html, /生成新预警/);
  assert.doesNotMatch(html, /生成新 Revision/);
  state.editorSelection = {
    alertId: "editor-selects",
    marketId: "BINANCE:FUTURES:ETHUSDT",
    interval: "1h",
    selectorKind: "fixed",
    clock: "bar_close",
    mode: "repeat",
  };
  state.editorPeriodOptions = [...state.editorPeriodOptions, { value: "1h", label: "1时" }];
  state.editorMarketsLoading = true;
  const rerenderedHtml = renderTradingAlertsPage(state);
  assert.match(rerenderedHtml, /name="marketIds" value="BINANCE:FUTURES:ETHUSDT"/);
  assert.match(rerenderedHtml, /trading-alert-editor-market-value[^>]*>ETH\/USDT · 币安 · 永续</);
  assert.match(rerenderedHtml, /name="intervals" value="1h"/);
  assert.match(rerenderedHtml, /trading-alert-editor-intervals-value[^>]*>1时</);
  state.busyAlertId = "editor-selects";
  const busyHtml = renderTradingAlertsPage(state);
  assert.match(busyHtml, /data-trading-alert-editor-form[^>]*aria-busy="true"/);
  assert.match(busyHtml, /button type="submit" class="primary-button" disabled>正在生成…<\/button>/);
  assert.doesNotMatch(busyHtml, /data-trading-alert-action="edit"[^>]*data-alert-id="editor-selects"/);
  assert.match(html, /button type="button" class="secondary-button" data-trading-alert-action="close-editor">取消<\/button>/);
  assert.match(html, /class="video-expert-select trading-alert-select/);
  assert.match(html, /class="video-expert-select-menu trading-alert-select-menu"[^>]*role="listbox"/);
  assert.match(html, /role="option" aria-selected="true" tabindex="-1"/);
  assert.match(html, /data-trading-alert-select="mode"[^>]*opens-above|trading-alert-select opens-above[^>]*data-trading-alert-select="mode"/);
  const binding = renderer.match(/function bindTradingAlertEditorSelects\(\)[\s\S]*?\n}\n\nfunction bindEvents/)?.[0] || "";
  assert.match(binding, /aria-expanded/);
  assert.match(binding, /input\.value = value/);
  assert.match(binding, /aria-selected/);
  assert.match(binding, /ArrowDown/);
  assert.match(binding, /refreshMarketOptions/);
  assert.match(renderer, /function syncTradingAlertEditorPeriods[\s\S]*loadTradingPeriodsFromStorage\(window\.localStorage\)/);
  assert.match(renderer, /function ensureTradingAlertEditorMarkets[\s\S]*fetchTradingMarkets/);
  assert.match(renderer, /const tradingAlertRevisionSubmissions = new Set<string>\(\)/);
  assert.match(renderer, /tradingAlertRevisionSubmissions\.has\(alertId\)/);
  assert.match(renderer, /selection\.marketId = value\.trim\(\)\.toUpperCase\(\)/);
  assert.match(renderer, /selection\.interval = value\.trim\(\)\.toLowerCase\(\)/);
  assert.match(renderer, /marketIds: requested\.marketId[\s\S]*intervals: requested\.interval/);
  assert.match(renderer, /revisedMarketId !== requested\.marketId \|\| revisedInterval !== requested\.interval/);
  assert.match(renderer, /anchorFrame[\s\S]*模拟行情与本次编辑设置不一致，已停止模拟/);
  assert.match(renderer, /submitButton\.disabled = true[\s\S]*submitButton\.textContent = "正在生成…"/);
  assert.match(renderer, /allowTradingAlertRevisionBusyStateToPaint\(\)/);
  assert.match(renderer, /tradingAlertRevisionSubmissions\.delete\(alertId\)/);
  assert.match(styles, /\.trading-alert-select > \.video-expert-select-button/);
  assert.match(styles, /\.trading-alert-select\.open > \.video-expert-select-button/);
  assert.match(styles, /\.trading-alert-editor input:not\(\[type="hidden"\]\):focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.trading-alert-select > \.video-expert-select-button:focus-visible,[^{]*html\[data-theme="dark"\] \.trading-alert-editor\[open\] \.trading-alert-select > \.video-expert-select-button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.trading-alert-select\.open > \.video-expert-select-button,[^{]*html\[data-theme="dark"\] \.trading-alert-editor\[open\] \.trading-alert-select\.open > \.video-expert-select-button\s*\{[^}]*border-color:\s*var\(--line-strong\);[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.trading-alert-select-menu button:focus-visible,[^{]*html\[data-theme="dark"\] \.trading-alert-editor\[open\] \.trading-alert-select-menu button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.trading-alert-select-menu\[hidden\]/);
  assert.match(styles, /\.trading-alert-market-menu\s*\{/);
  assert.match(styles, /\.trading-alert-market-option\.selected/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-market-menu/);
  assert.match(styles, /\.trading-alert-editor > header\s*\{[^}]*padding:\s*18px 20px 0;[^}]*\}/s);
  assert.doesNotMatch(styles, /\.trading-alert-editor > header\s*\{[^}]*border-bottom/s);
  assert.match(styles, /\.primary-button,\s*\.secondary-button\s*\{[^}]*height:\s*36px;[^}]*border-radius:\s*999px;/s);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] \.primary-button:not\(:disabled\)/);
  assert.doesNotMatch(styles, /\.trading-alert-editor form footer (?:button|\.primary)/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\.video-expert-select-menu/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\[role="listbox"\][\s\S]*\[role="option"\]/);
});

test("alerts containing drawing contexts cannot open the generic revision editor", () => {
  const state = createTradingAlertsUiState();
  state.alerts = [{
    alertId: "drawing-context-editor-locked",
    status: "monitoring",
    enabled: true,
    rule: {
      contexts: [
        { contextId: "primary", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:ETHUSDT"] }, intervals: ["1h"] },
        {
          contextId: "trend_line_1",
          marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
          intervals: ["4h"],
          drawingBinding: { drawingId: "line-1", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "4h" },
        },
      ],
      evaluationPolicy: { anchorContextId: "primary", clock: "mixed" },
      triggerPolicy: { mode: "once" },
    },
  }];
  state.editorAlertId = "drawing-context-editor-locked";

  const html = renderTradingAlertsPage(state);
  assert.doesNotMatch(html, /data-trading-alert-action="edit"[^>]*data-alert-id="drawing-context-editor-locked"/);
  assert.doesNotMatch(html, /data-trading-alert-editor-form/);
});

test("alert list starts directly with filters without a create action or status chrome", async () => {
  const [source, styles, renderer] = await Promise.all([alertUiSource, stylesSource, rendererSource]);
  assert.doesNotMatch(source, /trading-alerts-toolbar|trading-alert-create|新建智能预警|data-trading-alert-action="create"/);
  assert.doesNotMatch(styles, /\.trading-alerts-toolbar|\.trading-alert-create/);
  assert.doesNotMatch(renderer, /action === "create"/);
  assert.doesNotMatch(source, /<h1>预警<\/h1>|使用数学公式与实时原始数据监控/);
  assert.doesNotMatch(source, /trading-alert-engine-health|主进程引擎运行中/);
  assert.doesNotMatch(source, /trading-alert-providers|数据提供方与能力/);
  assert.match(styles, /\.trading-alerts-page button:focus-visible/);
  assert.match(styles, /\.trading-alerts-page button:disabled/);
});

test("empty alert state is reduced to one small status line", async () => {
  const [source, styles] = await Promise.all([alertUiSource, stylesSource]);
  assert.match(source, /<section class="trading-alert-empty"><p>当前筛选下没有预警<\/p><\/section>/);
  assert.match(source, /const alertSubfilters = state\.alerts\.length\s*\?/);
  assert.doesNotMatch(source, /class="trading-alert-empty"><div aria-hidden="true">⏰/);
  assert.doesNotMatch(source, /前往交易专家创建|在交易专家会话中输入/);
  assert.match(styles, /\.trading-alert-empty p\s*\{[^}]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.trading-alert-empty\s*\{[^}]*min-height:\s*100%;[^}]*padding-bottom:\s*10vh;/s);
  assert.doesNotMatch(styles, /\.trading-alert-empty(?:\s*>)?\s+(?:div|h2)/);
});

test("alerts default to monitoring and expose no unconfirmed filter", async () => {
  const [source, renderer, styles] = await Promise.all([alertUiSource, rendererSource, stylesSource]);
  assert.match(source, /TradingAlertFilter = "monitoring" \| "triggered" \| "paused"/);
  assert.match(source, /filter: "monitoring"/);
  assert.match(source, /\["monitoring", "监控中"\], \["triggered", "已触发"\]/);
  assert.doesNotMatch(source, /\["all", "全部"\]/);
  assert.doesNotMatch(source, /\["attention", "需处理"\]/);
  assert.doesNotMatch(source, /drafts|renderDraft|\["draft", "草稿"\]/);
  assert.match(renderer, /"monitoring", "triggered", "paused"/);
  assert.doesNotMatch(renderer, /"all", "monitoring"/);
  assert.doesNotMatch(renderer, /"paused", "draft"/);
  assert.doesNotMatch(styles, /\.trading-alert-draft/);
  assert.match(styles, /\.trading-alert-actions button:hover/);
  assert.match(styles, /\.trading-alert-actions button:active/);
});

test("alert filters keep active monitoring separate and move attention lifecycles under paused", () => {
  const state = createTradingAlertsUiState();
  state.loaded = true;
  state.alerts = [
    { alertId: "attention-reconnecting", status: "reconnecting" },
    { alertId: "paused", status: "paused" },
    { alertId: "triggered-completed", status: "completed" },
    { alertId: "monitoring-cooling", status: "cooling_down" },
    { alertId: "attention-failed", status: "failed" },
    { alertId: "triggered", status: "triggered" },
    { alertId: "monitoring-arming", status: "arming" },
    { alertId: "monitoring", status: "monitoring" },
    { alertId: "attention-gap", status: "gap_detected" },
  ];
  const html = renderTradingAlertsPage(state);
  const cardIds = [...html.matchAll(/data-trading-alert-card="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(cardIds, [
    "monitoring-cooling",
    "monitoring-arming",
    "monitoring",
  ]);

  state.filter = "paused";
  const pausedHtml = renderTradingAlertsPage(state);
  const pausedCardIds = [...pausedHtml.matchAll(/data-trading-alert-card="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(pausedCardIds, [
    "attention-reconnecting",
    "paused",
    "attention-failed",
    "attention-gap",
  ]);
  assert.match(pausedHtml, /data-trading-alert-filter="paused"[^>]*aria-pressed="true"[^>]*>[^<]+<span>4<\/span>/);
  assert.match(pausedHtml, /trading-alert-status attention[^>]*>重连中<\/span>/);
  assert.match(pausedHtml, /trading-alert-status attention[^>]*>需要处理<\/span>/);
  assert.match(pausedHtml, /trading-alert-status attention[^>]*>存在空档<\/span>/);
});

test("alert cards mirror the compact installed-skill card layout", async () => {
  const [source, styles] = await Promise.all([alertUiSource, stylesSource]);
  assert.doesNotMatch(source, /trading-alert-draft/);
  assert.doesNotMatch(source, /trading-alert-(?:card-icon|draft-icon|card-title-row)|⏰/);
  assert.match(source, /class="trading-alert-card-copy"/);
  assert.match(source, /class="trading-alert-card-head"[\s\S]*?<h2[\s\S]*?class="trading-alert-status/);
  assert.match(styles, /\.trading-alert-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 320px\)\);[^}]*gap:\s*20px;/s);
  assert.match(styles, /\.trading-alert-card-grid\s*\{[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.trading-alert-card\s*\{[^}]*min-height:\s*106px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*align-items:\s*stretch;[^}]*gap:\s*0;[^}]*border-radius:\s*8px;[^}]*padding:\s*14px 16px;/s);
  assert.match(styles, /\.trading-alert-card-copy\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-self:\s*stretch;/s);
  assert.match(styles, /\.trading-alert-card-head\s*\{[^}]*min-width:\s*0;[^}]*align-items:\s*flex-start;[^}]*gap:\s*10px;/s);
  assert.match(styles, /\.trading-alert-status\s*\{[^}]*position:\s*static;[^}]*max-width:\s*50%;[^}]*flex:\s*0 0 auto;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(styles, /\.trading-alert-status\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.trading-alert-card-copy small\s*\{[^}]*margin-top:\s*auto;/s);
  assert.doesNotMatch(styles, /\.trading-alert-(?:card-icon|draft-icon|card-title-row)/);
  assert.match(styles, /\.trading-alert-card-copy p\s*\{[^}]*display:\s*-webkit-box;[^}]*min-height:\s*36px;[^}]*line-height:\s*18px;[^}]*white-space:\s*normal;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;/s);
  assert.doesNotMatch(styles, /\.trading-alert-card-copy p\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /@media \(max-width: 980px\)[^}]+repeat\(2, minmax\(0, 320px\)\)/s);
  assert.match(styles, /@media \(max-width: 660px\)[^}]+minmax\(0, 1fr\)/s);
});

test("planning uses pill-style primary tabs and plain-text alert subcategories in both themes", async () => {
  const styles = await stylesSource;
  const emptyState = createTradingAlertsUiState();
  const html = renderTradingAlertsPage(emptyState);
  assert.match(html, /class="planning-primary-tabs"[\s\S]*>计划<\/button>[\s\S]*>预警<\/button>/);
  assert.doesNotMatch(html, /class="trading-alert-subfilters"/);
  emptyState.alerts = [{ alertId: "alert-one", status: "monitoring", enabled: true, rule: { contexts: [] } }];
  const populatedHtml = renderTradingAlertsPage(emptyState);
  assert.match(populatedHtml, /class="trading-alert-subfilters"[\s\S]*>监控中<span>1<\/span>[\s\S]*>已触发<span>0<\/span>[\s\S]*>已暂停<span>0<\/span>/);
  assert.match(styles, /\.planning-primary-tabs,[\s\S]*?\{[^}]*gap:\s*18px;[^}]*padding:\s*0 0 8px;/s);
  assert.match(styles, /\.planning-primary-tabs button,[\s\S]*?\{[^}]*height:\s*34px;[^}]*border-radius:\s*14px;[^}]*padding:\s*0 16px;/s);
  assert.match(styles, /\.planning-primary-tabs button:is\(\.active, \[aria-pressed="true"\]\),[\s\S]*?\{[^}]*background:\s*var\(--selection-strong\);[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(styles, /\.trading-alert-subfilters button\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;[^}]*color:\s*var\(--text-tertiary\);/s);
  assert.match(styles, /\.trading-alert-subfilters button:is\(\.active, \[aria-pressed="true"\]\),[\s\S]*?\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.planning-primary-tabs button:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-subfilters button:is\(\.active, \[aria-pressed="true"\]\)/);
  assert.doesNotMatch(styles, /\.trading-alert-subfilters button\.active::after/);
});

test("alert UI has semantic light/dark tokens and all interaction states", async () => {
  const styles = await stylesSource;
  assert.match(styles, /--alert-accent:/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*--alert-accent:/);
  assert.match(styles, /\.trading-alert-card:hover/);
  assert.match(styles, /\.trading-alerts-page button:focus-visible/);
  assert.match(styles, /\.trading-alerts-page button:disabled/);
  assert.doesNotMatch(styles, /\.trading-alert-simulation-(?:watermark|divider)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*trading-alert/);
  assert.match(styles, /\.trading-alerts-page\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?box-sizing:\s*border-box;/);
});

test("plan-linked alert cards show all three conditions while keeping their editor plan-managed", async () => {
  const state = createTradingAlertsUiState();
  state.loaded = true;
  state.alerts = [{
    alertId: "alert-plan-sol-1",
    status: "monitoring",
    enabled: true,
    rule: {
      ruleId: "execution-plan-alert-plan-sol-1",
      title: "SOL/USDT 计划预警",
      normalizedSummary: "待执行｜SOL 价格达到 75.12 时触发开空预警\n执行中｜SOL 价格达到 75.68 时触发止损预警\n执行中｜SOL 价格达到 74.28 时触发止盈预警",
      root: { type: "condition", condition: { conditionId: "execution-plan-entry" } },
      contexts: [{ contextId: "plan-market", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:SOLUSDT"] }, intervals: ["1h"] }],
      evaluationPolicy: { clock: "bar_update" },
      triggerPolicy: { mode: "once" },
      revision: 1,
    },
  }];
  const html = renderTradingAlertsPage(state);
  assert.match(html, /execution-plan-linked/);
  assert.match(html, /待执行[\s\S]*触发开空预警/);
  assert.match(html, /执行中[\s\S]*触发止损预警/);
  assert.match(html, /执行中[\s\S]*触发止盈预警/);
  assert.match(html, /随计划自动管理/);
  assert.match(html, /data-trading-alert-action="view"[^>]*data-alert-id="alert-plan-sol-1"/);
  assert.doesNotMatch(html, /data-trading-alert-action="edit"[^>]*data-alert-id="alert-plan-sol-1"/);
  assert.match(html, /data-trading-alert-action="pause"[^>]*data-alert-id="alert-plan-sol-1"/);
  assert.match(html, /data-trading-alert-action="delete"[^>]*data-alert-id="alert-plan-sol-1"/);
  assert.match(html, /trading-alert-plan-condition active/);
  assert.match(html, /trading-alert-plan-condition(?! active)/);
  state.editorAlertId = "alert-plan-sol-1";
  assert.doesNotMatch(renderTradingAlertsPage(state), /data-trading-alert-editor-form/);
  const renderer = await rendererSource;
  assert.match(renderer, /function openTradingAlertEditor[\s\S]*tradingAlertIsExecutionPlanLinked\(alert\)[\s\S]*该预警由计划自动管理，请前往计划卡片调整/);
  const styles = await stylesSource;
  assert.match(styles, /\.trading-alert-card\.execution-plan-linked\s*\{[^}]*min-height:\s*0/);
  assert.match(styles, /\.trading-alert-plan-conditions\s*\{[^}]*margin:\s*2px 0 9px;/);
  assert.match(styles, /\.trading-alert-card-copy \.trading-alert-plan-condition\s*\{[^}]*grid-template-columns:\s*minmax\(0, \.75fr\) minmax\(0, 1\.25fr\);[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.trading-alert-plan-condition span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-plan-condition\.active/);
});
