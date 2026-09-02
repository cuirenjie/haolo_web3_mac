import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTradingAnalysisModelProviderRegistry,
} from "../src/main/trading-analysis/model-provider.mjs";
import { runOrderFlowTheoryEngine } from "../src/main/trading-analysis/order-flow-engine.mjs";
import {
  buildOrderFlowDrawingPatch,
  buildOrderFlowModelPrompt,
  orderFlowMicroDrawingWindow,
  runTradingOrderFlowAnalysisPipeline,
} from "../src/main/trading-analysis/order-flow-pipeline.mjs";
import {
  buildOrderFlowRequestRoutingPrompt,
  deterministicOrderFlowChartRequest,
  normalizeOrderFlowRequestRoutingModelResponse,
} from "../src/main/trading-analysis/order-flow-request-router.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";
import {
  buildExecutionPlanV1,
  formatExecutionPlanMarkdown,
} from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import {
  buildTradingOrderFlowExpertPrompt,
  stripTradingOrderFlowMention,
  tradingOrderFlowMentioned,
  TRADING_ORDER_FLOW_EXPERT_PROMPT_END,
  TRADING_ORDER_FLOW_EXPERT_PROMPT_START,
} from "../src/renderer/trading-expert-order-flow-request.ts";

function fixtureCandles(count = 96, spacing = 900) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index * 0.31) * 2 + index * 0.025;
    const open = close - Math.cos(index * 0.23) * 0.35;
    return {
      time: 1_720_000_000 + index * spacing,
      open,
      high: Math.max(open, close) + 0.6,
      low: Math.min(open, close) - 0.6,
      close,
      volume: 80 + index,
    };
  });
}

function fixtureOrderFlow(tradeCount = 180, startTime = 1_720_085_600) {
  const trades = Array.from({ length: tradeCount }, (_, index) => {
    const buy = index % 5 !== 0;
    return {
      id: String(90_000 + index),
      time: startTime + index,
      price: 102 + Math.floor(index / 30) * 0.08 + (index % 3) * 0.01,
      quantity: buy ? 2.4 + (index % 4) * 0.1 : 0.6,
      side: buy ? "buy" : "sell",
    };
  });
  return {
    source: "binance-rest",
    windowStart: trades[0]?.time || 0,
    windowEnd: trades.at(-1)?.time || 0,
    trades,
    depth: {
      snapshotTime: 1_720_090_200_000,
      lastUpdateId: 765_432,
      bids: Array.from({ length: 30 }, (_, index) => ({
        price: 102.45 - index * 0.01,
        quantity: 9 + index * 0.2,
      })),
      asks: Array.from({ length: 30 }, (_, index) => ({
        price: 102.46 + index * 0.01,
        quantity: 4 + index * 0.1,
      })),
    },
    openInterest: {
      current: 1_025_000,
      history: Array.from({ length: 12 }, (_, index) => ({
        time: 1_720_080_000 + index * 300,
        value: 1_000_000 + index * 2_000,
      })),
    },
    coverage: {
      trades: "available",
      depth: "partial",
      openInterest: "available",
      liquidations: "unavailable",
    },
  };
}

function fixtureParams(orderFlow = fixtureOrderFlow()) {
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "15",
    snapshotTime: 1_720_100_000_000,
    instruction: "分析当前真实订单流并落图",
    candles: fixtureCandles(),
    orderFlow,
  };
}

function approvedMicroDrawingReview(theoryResult) {
  return {
    schemaVersion: 1,
    verdict: "approve",
    summary: "测试绘图计划",
    report: "测试绘图计划",
    marketBias: "selling",
    strategyRationale: "测试绘图计划",
    selectedClusterIds: theoryResult.structures.imbalanceClusters.slice(0, 2).map(({ id }) => id),
    selectedPressureEventIds: theoryResult.structures.pressureEvents.slice(0, 2).map(({ id }) => id),
    selectedMarketStructureIds: [],
    showPointOfControl: true,
    showDealingRange: false,
    showLiquidity: false,
    confidence: 0.8,
  };
}

test("order-flow engine deterministically computes real trade, depth, POC, and OI evidence", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const first = runOrderFlowTheoryEngine(snapshot);
  const second = runOrderFlowTheoryEngine(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.engineId, "order_flow");
  assert.equal(first.status, "succeeded");
  assert.equal(first.statistics.tradeCount, 180);
  assert.ok(first.statistics.delta > 0);
  assert.ok(first.statistics.depthImbalanceRatio > 0);
  assert.ok(first.statistics.openInterestChangeRatio > 0);
  assert.ok(first.structures.pointOfControl?.price > 0);
  assert.ok(first.structures.cumulativeDelta.length > 1);
  assert.ok(Math.abs(first.structures.cumulativeDelta.at(-1).value - first.statistics.delta) < 1e-9);
  assert.ok(first.structures.clusters.length > 0);
  assert.ok(first.structures.pressureEvents.length > 0);
  assert.deepEqual(first.missingData, ["liquidations"]);
});

test("order-flow engine refuses to promote incomplete market coverage", () => {
  const orderFlow = fixtureOrderFlow(24);
  orderFlow.depth.bids = orderFlow.depth.bids.slice(0, 3);
  orderFlow.coverage.trades = "partial";
  orderFlow.coverage.depth = "partial";
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(orderFlow));
  const result = runOrderFlowTheoryEngine(snapshot);

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.statistics.tradeCount, 24);
});

test("order-flow pipeline stays model-neutral and emits a guarded AI drawing layer", async () => {
  const calls = [];
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true, theoryReview: true },
    async analyze(request) {
      calls.push(request);
      return {
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "主动买方占优，但仍需 POC 与后续 Delta 同向确认。",
          report: "复核接受确定性候选，不补造未提供的逐笔、撤单或爆仓事实。",
          marketBias: "buying",
          strategyRationale: "买方 Delta 与前二十档深度同向，跌回 POC 且 Delta 转负即失效。",
          selectedClusterIds: [],
          selectedPressureEventIds: [],
          showPointOfControl: true,
          confidence: 0.76,
        }),
      };
    },
  }]);
  const result = await runTradingOrderFlowAnalysisPipeline(fixtureParams(), {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].theoryId, "order_flow");
  assert.equal(calls[0].task, "order-flow-theory-review-and-drawing-plan");
  assert.match(calls[0].prompt, /确定性 TheoryResult/);
  assert.match(calls[0].prompt, /确定性 actionLevels/);
  assert.doesNotMatch(calls[0].prompt, /"orderFlow"\s*:/, "the normalized raw order-flow envelope must not be sent to the model");
  assert.doesNotMatch(calls[0].prompt, /"id":"90001"/, "non-candidate raw trades must not be sent to the model");
  assert.equal(result.model.providerId, "fixture-provider");
  assert.equal(result.model.modelId, "fixture-model");
  assert.equal(result.analysisPlan.drawingPatch.operations[0].drawing.theory, "order-flow");
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => (
    drawing.layer === "ai/order-flow" && drawing.locked === true
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 18);
  assert.ok(result.analysisPlan.drawingPatch.operations.length <= 32);
  assert.ok(result.analysisPlan.actionPlan.longTrigger > result.analysisPlan.actionPlan.currentPrice);
  assert.ok(result.analysisPlan.actionPlan.shortTrigger < result.analysisPlan.actionPlan.currentPrice);
  assert.match(result.analysisPlan.report, /真实聚合成交/);
  assert.match(result.analysisPlan.report, /上破 .* 后偏多/);
  assert.match(result.analysisPlan.report, /跌破 .* 后偏空/);
  assert.match(result.analysisPlan.report, /区间内等待|之间先等待/);
  assert.match(result.analysisPlan.report, /单笔预设亏损建议控制在账户的 0\.5%–1%/);
  assert.match(result.analysisPlan.report, /盘口是 REST 快照/);
  assert.match(result.analysisPlan.report, /爆仓数据 不可用/);
  assert.match(result.analysisPlan.report, /不是保证成交、保证盈利或经过历史校准的涨跌概率/);
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text.includes("关键价位：上破")
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text.includes("成交密集价（POC）")
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && /主动买入失衡区|主动卖出失衡区/.test(drawing.text)
  )));
  assert.doesNotMatch(result.analysisPlan.report, /成交密集价（POC）|主动买入失衡区|主动卖出失衡区/);
  const microWindow = orderFlowMicroDrawingWindow(normalizeTradingMarketSnapshot(fixtureParams()));
  assert.ok(microWindow);
  const microDrawings = result.analysisPlan.drawingPatch.operations
    .map(({ drawing }) => drawing)
    .filter(({ colorToken }) => ["order-flow-buy", "order-flow-sell", "order-flow-poc"].includes(colorToken));
  assert.ok(microDrawings.length > 0);
  assert.ok(microDrawings.every(({ points }) => points.every(({ time }) => (
    time >= microWindow.barStart && time <= microWindow.barStart + microWindow.barSpan
  ))));
  assert.ok(microDrawings
    .filter(({ tool }) => tool === "note" || tool === "arrow-up" || tool === "arrow-down")
    .every(({ points }) => points[0].time === microWindow.anchorTime));

  const prompt = buildOrderFlowModelPrompt(
    normalizeTradingMarketSnapshot(fixtureParams()),
    result.theoryResult,
  );
  assert.doesNotMatch(prompt, /gpt-\d|deepseek|openai/i);
  const [engineSource, pipelineSource] = await Promise.all([
    readFile(new URL("../src/main/trading-analysis/order-flow-engine.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/order-flow-pipeline.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(engineSource, /gpt|deepseek|openai/i);
  assert.doesNotMatch(pipelineSource, /gpt-\d|deepseek|openai/i);
});

test("neutral order-flow review keeps both deterministic sides as separate execution plans", async () => {
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true, theoryReview: true },
    async analyze() {
      return {
        text: JSON.stringify({
          ...approvedMicroDrawingReview(runOrderFlowTheoryEngine(normalizeTradingMarketSnapshot(fixtureParams()))),
          marketBias: "neutral",
        }),
      };
    },
  }]);
  const result = await runTradingOrderFlowAnalysisPipeline(fixtureParams(), {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });
  assert.equal(result.analysisPlan.actionPlan.primaryBias, "neutral");
  const plan = buildExecutionPlanV1({ id: "order-flow", version: "1.0.0" }, result);
  assert.equal(plan.preferredSide, "neutral");
  assert.deepEqual(plan.scenarios.map((scenario) => scenario.side), ["long", "short"]);
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^## BTC\/USDT 币安永续 15M · 多头条件方案$/m);
  assert.match(markdown, /^## BTC\/USDT 币安永续 15M · 空头条件方案$/m);
  assert.doesNotMatch(markdown, /未形成明确单侧方案/);
});

test("order-flow drawing aggregates same-side live evidence on its execution candle", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const baseResult = runOrderFlowTheoryEngine(snapshot);
  const cluster = baseResult.structures.imbalanceClusters[0];
  const pressureEvent = baseResult.structures.pressureEvents[0];
  assert.ok(cluster);
  assert.ok(pressureEvent);
  const theoryResult = {
    ...baseResult,
    structures: {
      ...baseResult.structures,
      imbalanceClusters: [
        { ...cluster, id: `${cluster.id}-sell-a`, side: "sell" },
        {
          ...cluster,
          id: `${cluster.id}-sell-b`,
          side: "sell",
          firstTime: cluster.firstTime + 12,
          lastTime: cluster.lastTime + 24,
        },
      ],
      pressureEvents: [
        { ...pressureEvent, id: `${pressureEvent.id}-sell-a`, side: "sell" },
        {
          ...pressureEvent,
          id: `${pressureEvent.id}-sell-b`,
          side: "sell",
          time: pressureEvent.time + 18,
          notional: pressureEvent.notional * 1.1,
        },
      ],
    },
  };
  const patch = buildOrderFlowDrawingPatch(
    snapshot,
    theoryResult,
    approvedMicroDrawingReview(theoryResult),
  );
  const notes = patch.operations.map(({ drawing }) => drawing).filter(({ tool }) => tool === "note");
  const imbalanceNotes = notes.filter(({ text = "" }) => text.startsWith("主动卖出失衡区"));
  const pressureNotes = notes.filter(({ text = "" }) => text.startsWith("大额主动卖出"));
  assert.equal(imbalanceNotes.length, 1);
  assert.equal(pressureNotes.length, 1);
  assert.equal(imbalanceNotes[0].evidenceIds.length, 2);
  assert.equal(pressureNotes[0].evidenceIds.length, 2);
  assert.match(imbalanceNotes[0].text, /2处/);
  assert.match(pressureNotes[0].text, /×2/);
  const microWindow = orderFlowMicroDrawingWindow(snapshot);
  assert.ok(microWindow);
  const microDrawings = patch.operations
    .map(({ drawing }) => drawing)
    .filter(({ colorToken }) => ["order-flow-buy", "order-flow-sell", "order-flow-poc"].includes(colorToken));
  assert.ok(microDrawings.every(({ points }) => points.every(({ time }) => (
    time >= microWindow.barStart && time <= microWindow.barStart + microWindow.barSpan
  ))));
});

test("order-flow drawing never projects a live micro window onto unrelated historical candles", () => {
  const orderFlow = fixtureOrderFlow();
  const shift = 100_000;
  orderFlow.trades = orderFlow.trades.map((trade) => ({ ...trade, time: trade.time + shift }));
  orderFlow.windowStart += shift;
  orderFlow.windowEnd += shift;
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(orderFlow));
  const theoryResult = runOrderFlowTheoryEngine(snapshot);
  assert.equal(orderFlowMicroDrawingWindow(snapshot), null);
  const patch = buildOrderFlowDrawingPatch(
    snapshot,
    theoryResult,
    approvedMicroDrawingReview(theoryResult),
  );
  assert.equal(patch.operations.some(({ drawing }) => (
    ["order-flow-buy", "order-flow-sell", "order-flow-poc"].includes(drawing.colorToken)
  )), false);
  assert.ok(patch.operations.some(({ drawing }) => drawing.colorToken === "order-flow-note"));
});

test("hourly order-flow drawings use exact candle boundaries instead of intra-bar timestamps", () => {
  const candles = fixtureCandles(96, 3_600);
  const lastCandleTime = candles.at(-1).time;
  const orderFlow = fixtureOrderFlow(180, lastCandleTime + 24 * 60);
  const snapshot = normalizeTradingMarketSnapshot({
    ...fixtureParams(orderFlow),
    interval: "60",
    candles,
  });
  const theoryResult = runOrderFlowTheoryEngine(snapshot);
  const patch = buildOrderFlowDrawingPatch(
    snapshot,
    theoryResult,
    approvedMicroDrawingReview(theoryResult),
  );
  const microWindow = orderFlowMicroDrawingWindow(snapshot);
  assert.ok(microWindow);
  assert.equal(microWindow.anchorTime, lastCandleTime);
  const microDrawings = patch.operations
    .map(({ drawing }) => drawing)
    .filter(({ colorToken }) => ["order-flow-buy", "order-flow-sell", "order-flow-poc"].includes(colorToken));
  for (const drawing of microDrawings) {
    if (drawing.points.length === 1) {
      assert.equal(drawing.points[0].time, lastCandleTime);
    } else {
      assert.deepEqual(drawing.points.map(({ time }) => time), [lastCandleTime, lastCandleTime + 3_600]);
    }
  }
});

test("Drawing Gateway isolates order-flow styles from Chan styles", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const base = {
    schemaVersion: 1,
    analysisId: "order-flow-analysis-test",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: [{
      op: "upsert",
      drawing: {
        id: "order-flow-poc-test",
        theory: "order-flow",
        tool: "path",
        colorToken: "order-flow-poc",
        points: [
          { time: snapshot.orderFlow.windowStart, price: 102.2 },
          { time: snapshot.orderFlow.windowEnd, price: 102.2 },
        ],
      },
    }],
  };
  const patch = validateTradingDrawingPatch(base, snapshot);
  assert.equal(patch.operations[0].drawing.layer, "ai/order-flow");
  assert.throws(
    () => validateTradingDrawingPatch({
      ...base,
      operations: [{
        ...base.operations[0],
        drawing: { ...base.operations[0].drawing, theory: "chan" },
      }],
    }, snapshot),
    /unsupported drawing style/,
  );
});

test("order-flow request routing preserves the current canvas unless fields are explicit", () => {
  assert.deepEqual(deterministicOrderFlowChartRequest("@策略:订单流 分析下"), {
    mode: "chart-analysis",
    instruction: "分析下",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });
  assert.equal(
    deterministicOrderFlowChartRequest("@策略:订单流 什么是买方吸收？"),
    null,
  );
  assert.equal(
    deterministicOrderFlowChartRequest("@策略:订单流 分析下", { hasImageAttachment: true }),
    null,
  );
  const bare = normalizeOrderFlowRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.99,
  }), "@策略:订单流");
  assert.deepEqual(bare.request, {
    mode: "chart-analysis",
    instruction: "",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });

  const explicit = normalizeOrderFlowRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: "ETHUSDT",
    interval: "15",
    lookbackMs: 86_400_000,
    lookbackLabel: "24小时",
    confidence: 0.98,
  }), "@策略:订单流 看下 ETH 最近24小时的15分钟K线并画图");
  assert.equal(explicit.request.symbol, "ETHUSDT");
  assert.equal(explicit.request.interval, "15");
  assert.equal(explicit.request.lookbackMs, 86_400_000);
  assert.equal(tradingOrderFlowMentioned("@策略：订单流"), true);
  assert.equal(stripTradingOrderFlowMention("@策略：订单流 什么是吸收？"), "什么是吸收？");
  const routingPrompt = buildOrderFlowRequestRoutingPrompt({ text: "@策略:订单流" });
  assert.match(routingPrompt, /不得根据常见默认值、上下文猜测或补全 BTC、日线、时间范围/);

  const expertPrompt = buildTradingOrderFlowExpertPrompt("附件：order-flow.png");
  assert.match(expertPrompt, /不得把普通 OHLCV、K 线形态或截图猜测冒充真实订单流/);
  assert.match(expertPrompt, /盘面只标记最重要的趋势转折、主要支撑\/压力区/);
  assert.match(expertPrompt, /上破哪个确定性价位后偏多、跌破哪个价位后偏空/);
  assert.ok(expertPrompt.includes(TRADING_ORDER_FLOW_EXPERT_PROMPT_START));
  assert.ok(expertPrompt.includes(TRADING_ORDER_FLOW_EXPERT_PROMPT_END));
  assert.ok(expertPrompt.indexOf("附件：order-flow.png") > expertPrompt.indexOf(TRADING_ORDER_FLOW_EXPERT_PROMPT_END));
});

test("Trading Expert wires @策略:订单流 through IPC, real Binance inputs, playback, and both themes", async () => {
  const [
    mainSource,
    orderFlowAdapterSource,
    coordinatorSource,
    preloadSource,
    rendererSource,
    catalogSource,
    clientSource,
    marketSource,
    drawingSource,
    playbackSource,
    stylesSource,
  ] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-strategy-runtime/builtins/order-flow-adapter.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-strategy-runtime/coordinator.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-ai-playback.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(mainSource, /tradingAnalysis:classifyOrderFlowRequest/);
  assert.match(orderFlowAdapterSource, /deterministicRouting:\s*deterministicOrderFlowChartRequest/);
  assert.match(coordinatorSource, /buildGeneralRequestRoutingPrompt/);
  assert.match(coordinatorSource, /source: "model-first-unified-intent"/);
  assert.match(coordinatorSource, /source: "deterministic-recovery"/);
  assert.match(mainSource, /tradingAnalysis:runOrderFlow/);
  assert.match(preloadSource, /classifyTradingOrderFlowRequest/);
  assert.match(preloadSource, /runTradingOrderFlowAnalysis/);
  assert.match(rendererSource, /await classifyTradingStrategyForSend\(/);
  assert.match(clientSource, /client\.classifyTradingStrategyRequest\(/);
  assert.match(rendererSource, /tradingStrategyRequestAtSend\?\.mode === "chart-analysis"/);
  assert.match(rendererSource, /runTradingStrategyChartRequest\(threadId, tradingStrategyAtSend/);
  assert.match(catalogSource, /buildTradingOrderFlowExpertPrompt/);
  assert.match(
    rendererSource,
    /\["<haolo_trading_order_flow_expert_prompt>", "<\/haolo_trading_order_flow_expert_prompt>"\]/,
  );
  assert.match(rendererSource, /正在分析订单流/);
  assert.match(rendererSource, /正在绘制订单流结构/);
  assert.match(marketSource, /\/fapi\/v1\/aggTrades/);
  assert.match(marketSource, /\/fapi\/v1\/depth/);
  assert.match(marketSource, /\/futures\/data\/openInterestHist/);
  assert.match(marketSource, /trade\.m === true \? "sell" as const : "buy" as const/);
  assert.match(marketSource, /liquidations: "unavailable"/);
  assert.match(marketSource, /runOrderFlowConversation/);
  assert.match(marketSource, /runTradingAnalysisWithAutoExpansion\(\{/);
  assert.match(marketSource, /focusOrderFlowAnalysisCandles[\s\S]*timeScale\(\)\.setVisibleRange/);
  assert.doesNotMatch(marketSource, /所选范围"\}仅有 \$\{analysisCandles\.length\} 根 K 线，不足以提供订单流所需的价格背景/);
  assert.match(marketSource, /只绘制最关键的转折、支撑\/压力、流动性与成交证据/);
  assert.match(marketSource, /整理新手可读的上破、跌破、回踩与等待方案/);
  assert.match(marketSource, /playAiDrawingPatch/);
  assert.match(drawingSource, /data-ai-drawing-content/);
  assert.match(playbackSource, /"chan" \| "order-flow"/);
  assert.doesNotMatch(playbackSource, /new\s+PointerEvent|dispatchEvent\s*\(/);
  assert.match(stylesSource, /--trading-ai-order-flow-buy: #078c53;/);
  assert.match(stylesSource, /--trading-ai-order-flow-sell: #dc3658;/);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-ai-order-flow-buy: #52dc88;[\s\S]*?--trading-ai-order-flow-sell: #ff718e;/,
  );
});
