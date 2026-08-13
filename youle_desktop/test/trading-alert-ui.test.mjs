import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTradingAlertsUiState,
  renderTradingAlertsPage,
  resolveTradingAlertSourceText,
} from "../src/renderer/trading-alerts-ui.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const alertUiSource = readFile(new URL("../src/renderer/trading-alerts-ui.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("alerts use an independent page and do not route to legacy auto tasks", async () => {
  const source = await rendererSource;
  assert.match(source, /type ViewId[\s\S]*"alerts"/);
  assert.match(source, /function openTradingAlertsPage[\s\S]*state\.activeView = "alerts"/);
  assert.match(source, /renderTradingAlertsPage\(state\.tradingAlerts\)/);
  assert.match(source, /data-conversation-static-action="alerts"/);
  assert.doesNotMatch(source, /function openAutoTasksFromAlerts/);
});

test("@预警 conversation is compiled, simulated and explicitly confirmed before creation", async () => {
  const source = await rendererSource;
  assert.match(source, /function tradingAlertMentioned/);
  assert.match(source, /tradingAlertsCompile!/);
  assert.match(source, /tradingExpertAlertSimulationFrames/);
  assert.match(source, /tradingAlertsSimulate!/);
  assert.match(source, /showTradingExpertAlertSimulation/);
  assert.match(source, /tradingAlertAffirmative[\s\S]*tradingAlertsConfirm!/);
  assert.match(source, /tradingAlertCancelled[\s\S]*tradingAlertsCancelDraft/);
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

test("confirmation is recovered from the persisted Store and success is shown only after list readback", async () => {
  const [renderer, ui] = await Promise.all([rendererSource, alertUiSource]);
  assert.match(ui, /pendingConfirmations: any\[\]/);
  assert.match(ui, /state\.pendingConfirmations = Array\.isArray\(value\?\.pendingConfirmations\)/);
  assert.match(renderer, /!state\.tradingAlerts\.loaded[\s\S]*await refreshTradingAlerts\(\)/);
  assert.match(renderer, /function tradingAlertConversationStateForThread[\s\S]*pendingTradingAlertConfirmationForThread/);
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

test("clarification and dependency drafts recover their exact conversation after reload", async () => {
  const source = await rendererSource;
  assert.match(source, /function inMemoryTradingAlertConversationForThread[\s\S]*tradingAlertThreadMatches/);
  assert.match(source, /function activeTradingAlertDraftForThread[\s\S]*originThreadId[\s\S]*updatedAt/);
  assert.match(source, /function recoveredTradingAlertDraftConversation[\s\S]*draft\?\.conversation/);
  assert.match(
    source,
    /function tradingAlertConversationStateForThread[\s\S]*activeTradingAlertDraftForThread\(threadId\)[\s\S]*stage:[\s\S]*"dependency"[\s\S]*"clarification"/,
  );
  assert.match(source, /rememberTradingAlertDraftSnapshot\(draft\)/);
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

test("created-alert bubble exposes a persistent minimal link to the alert page in both themes", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  assert.match(renderer, /label: "查看我的预警"/);
  assert.match(renderer, /destination: "trading-alerts"/);
  assert.match(renderer, /data-message-action-destination/);
  assert.match(renderer, /button\.dataset\.messageActionDestination === "trading-alerts"[\s\S]*openTradingAlertsPage\(null, null\)/);
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
  assert.match(geometrySync, /updateVisiblePriceScale\(\)[\s\S]*paintAlertSimulationMarker\(\)[\s\S]*drawingController\?\.redraw\(\)/);
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

test("real trigger evidence uses the same diagonal collision-free annotation path", async () => {
  const source = await marketSource;
  const focus = source.match(/focusAlertEvidence\(triggeredAt: number\)[\s\S]*?\n  }/)?.[0] || "";
  assert.match(focus, /createAlertSimulationAnnotation\("预警真实触发", "alert-evidence"\)/);
  assert.match(focus, /alertEvidencePoint = \{ time: displayTime, price: nearest\.high \}/);
  assert.match(focus, /paintAlertSimulationMarker\(\)/);
  assert.doesNotMatch(focus, /createSeriesMarkers|shape:\s*"arrowDown"/);
});

test("simulation series are isolated by market and interval and restore after returning", async () => {
  const source = await marketSource;
  const contextMatch = source.match(/private alertSimulationMatchesCurrentContext\(\)[\s\S]*?\n  }/)?.[0] || "";
  const restart = source.match(/private async restartMarketData\([\s\S]*?\n  }/)?.[0] || "";
  assert.match(contextMatch, /state\.marketId === this\.selectedMarketId/);
  assert.match(contextMatch, /state\.interval === this\.activeInterval/);
  assert.match(contextMatch, /state\.marketId === this\.loadedMarketId/);
  assert.match(contextMatch, /state\.interval === this\.loadedInterval/);
  assert.match(restart, /this\.detachAlertSimulation\(\)[\s\S]*await[\s\S]*this\.syncAlertSimulationForCurrentContext\(\)/);
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

test("future candles and all supported main/sub indicator paths animate on one verified trigger timeline", async () => {
  const [source, renderer, styles] = await Promise.all([marketSource, rendererSource, stylesSource]);
  assert.match(renderer, /showTradingExpertAlertSimulation\(simulated\.simulation, draft\.rule\.evaluationPolicy\.anchorContextId, draft\.rule\)/);
  assert.match(source, /collectTradingAlertSimulationIndicators\(rule, anchorContextId, activeConditionIds\)/);
  assert.match(source, /\["ma", "ema", "boll"\]/);
  for (const indicator of ["volume", "macd", "rsi", "kdj", "atr", "cci", "adx", "momentum", "roc"]) {
    assert.match(source, new RegExp(`TRADING_ALERT_SIMULATION_PANE_INDICATORS[\\s\\S]*?"${indicator}"`));
  }
  assert.match(source, /alertSimulationCombinedCandles[\s\S]*\.\.\.this\.chartCandles[\s\S]*\.\.\.state\.display/);
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

test("alert cards expose lifecycle, gap, evidence and revision controls", async () => {
  const source = await alertUiSource;
  for (const token of ["monitoring", "triggered", "paused", "attention", "gap_detected", "reconnecting", "cooling_down"]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /监控空档/);
  assert.match(source, /触发证据/);
  assert.match(source, /Revision/);
  assert.match(source, /data-trading-alert-action="view-evidence-chart"/);
  assert.match(source, /name="marketIds"/);
  assert.match(source, /name="intervals"/);
  assert.match(source, /相同交易对\/周期会共享行情连接/);
  assert.match(source, /data-trading-alert-action="pause"|\? "pause" : "resume"/);
  assert.match(source, /data-trading-alert-action="delete"/);
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
  assert.match(source, /<section class="trading-alert-empty"><p>\$\{state\.filter === "draft" \? "还没有草稿" : state\.filter === "all" \? "还没有智能预警" : "当前筛选下没有预警"\}<\/p><\/section>/);
  assert.doesNotMatch(source, /class="trading-alert-empty"><div aria-hidden="true">⏰/);
  assert.doesNotMatch(source, /前往交易专家创建|在交易专家会话中输入/);
  assert.match(styles, /\.trading-alert-empty p\s*\{[^}]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\);/s);
  assert.doesNotMatch(styles, /\.trading-alert-empty(?:\s*>)?\s+(?:div|h2)/);
});

test("active drafts render as cards in all and in a dedicated draft filter", async () => {
  const [source, renderer, styles] = await Promise.all([alertUiSource, rendererSource, stylesSource]);
  assert.match(source, /TradingAlertFilter = [^;]+\| "draft"/);
  assert.match(source, /const drafts = \["all", "draft"\]\.includes\(state\.filter\) \? activeDrafts : \[\]/);
  assert.match(source, /all: state\.alerts\.length \+ activeDrafts\.length/);
  assert.match(source, /draft: activeDrafts\.length/);
  assert.match(source, /\["attention", "需处理"\], \["draft", "草稿"\]/);
  assert.match(source, /trading-alert-card-grid[^`]+alerts\.map[^`]+drafts\.map\(renderDraftCard\)/s);
  assert.doesNotMatch(source, /trading-alert-drafts|待完成的草稿/);
  assert.match(renderer, /"attention", "draft"/);
  assert.doesNotMatch(styles, /\.trading-alert-drafts/);
  assert.match(styles, /\.trading-alert-actions button:hover/);
  assert.match(styles, /\.trading-alert-actions button:active/);
});

test("all alert cards are ordered by lifecycle with drafts last", () => {
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
  ];
  state.drafts = [{ draftId: "draft", status: "awaiting_confirmation" }];

  const html = renderTradingAlertsPage(state);
  const cardIds = [...html.matchAll(/data-trading-alert-(?:card|draft-card)="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(cardIds, [
    "monitoring-cooling",
    "monitoring-arming",
    "monitoring",
    "triggered-completed",
    "triggered",
    "paused",
    "attention-reconnecting",
    "attention-failed",
    "draft",
  ]);
});

test("alert and draft cards mirror the compact installed-skill card layout", async () => {
  const [source, styles] = await Promise.all([alertUiSource, stylesSource]);
  assert.match(source, /class="trading-alert-card trading-alert-draft-card"/);
  assert.doesNotMatch(source, /trading-alert-(?:card-icon|draft-icon|card-title-row)|⏰/);
  assert.match(source, /class="trading-alert-card-copy"/);
  assert.match(styles, /\.trading-alert-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 320px\)\);[^}]*gap:\s*20px;/s);
  assert.match(styles, /\.trading-alert-card\s*\{[^}]*min-height:\s*88px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*0;[^}]*border-radius:\s*8px;[^}]*padding:\s*14px 16px;/s);
  assert.doesNotMatch(styles, /\.trading-alert-(?:card-icon|draft-icon|card-title-row)/);
  assert.match(styles, /\.trading-alert-card-copy p\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /@media \(max-width: 980px\)[^}]+repeat\(2, minmax\(0, 320px\)\)/s);
  assert.match(styles, /@media \(max-width: 660px\)[^}]+minmax\(0, 1fr\)/s);
});

test("alert filters mirror the skills pill tabs in both themes", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.trading-alert-filters\s*\{[^}]*gap:\s*18px;[^}]*padding:\s*0 0 8px;/s);
  assert.match(styles, /\.trading-alert-filters button\s*\{[^}]*height:\s*34px;[^}]*border-radius:\s*14px;[^}]*padding:\s*0 16px;/s);
  assert.match(styles, /\.trading-alert-filters button:is\(\.active, \[aria-pressed="true"\]\)\s*\{[^}]*background:\s*var\(--selection-strong\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alert-filters button:hover/);
  assert.doesNotMatch(styles, /\.trading-alert-filters button\.active::after/);
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
