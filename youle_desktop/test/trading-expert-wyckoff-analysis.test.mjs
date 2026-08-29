import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runWyckoffTheoryEngine } from "../src/main/trading-analysis/wyckoff-engine.mjs";
import {
  buildWyckoffModelPrompt,
  runTradingWyckoffAnalysisPipeline,
} from "../src/main/trading-analysis/wyckoff-pipeline.mjs";
import {
  buildWyckoffRequestRoutingPrompt,
  normalizeWyckoffRequestRoutingModelResponse,
} from "../src/main/trading-analysis/wyckoff-request-router.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";
import {
  buildTradingWyckoffExpertPrompt,
  stripTradingWyckoffMention,
  tradingWyckoffMentioned,
} from "../src/renderer/trading-expert-wyckoff-request.ts";

function baseRangePrice(index) {
  if (index < 24) return 121 - index * 0.82;
  return 105 + Math.sin((index - 24) * Math.PI / 8) * 6.3;
}

function accumulationCandles(count = 128) {
  const candles = Array.from({ length: count }, (_, index) => {
    const close = baseRangePrice(index);
    const previous = baseRangePrice(Math.max(0, index - 1));
    const open = previous + (close - previous) * 0.3;
    return {
      time: 1_720_000_000 + index * 3_600,
      open,
      high: Math.max(open, close) + 0.72,
      low: Math.min(open, close) - 0.72,
      close,
      volume: 100 + (index % 7) * 4,
    };
  });
  Object.assign(candles[28], { open: 103, high: 104, low: 96.2, close: 101.8, volume: 430 });
  Object.assign(candles[39], { open: 106, high: 112.3, low: 105.4, close: 111.4, volume: 170 });
  Object.assign(candles[55], { open: 101.1, high: 102, low: 98.25, close: 100.4, volume: 92 });
  Object.assign(candles[76], { open: 100.4, high: 101.2, low: 96.7, close: 100.7, volume: 185 });
  Object.assign(candles[83], { open: 100.6, high: 101.3, low: 98.45, close: 100.9, volume: 72 });
  Object.assign(candles[96], { open: 108.2, high: 115.4, low: 107.8, close: 114.6, volume: 280 });
  Object.assign(candles[104], { open: 112.8, high: 113.4, low: 110.7, close: 112.4, volume: 84 });
  for (let index = 105; index < candles.length; index += 1) {
    const close = 113.2 + (index - 105) * 0.08 + Math.sin(index) * 0.3;
    Object.assign(candles[index], {
      open: close - 0.25,
      high: close + 0.62,
      low: close - 0.62,
      close,
      volume: 105 + (index % 5) * 5,
    });
  }
  return candles;
}

function monotonicCandles(count = 100) {
  return Array.from({ length: count }, (_, index) => {
    const close = 50 + index * 0.8;
    return {
      time: 1_720_000_000 + index * 3_600,
      open: close - 0.4,
      high: close + 0.5,
      low: close - 0.6,
      close,
      volume: 100,
    };
  });
}

function distributionCandles() {
  return accumulationCandles().map((candle) => ({
    ...candle,
    open: 210 - candle.open,
    high: 210 - candle.low,
    low: 210 - candle.high,
    close: 210 - candle.close,
  }));
}

function fixtureParams(candles = accumulationCandles()) {
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_720_600_000_000,
    instruction: "分析当前盘面的威科夫结构",
    candles,
  };
}

test("Wyckoff engine deterministically identifies a trading range and evidence-bound candidates", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const first = runWyckoffTheoryEngine(snapshot);
  const second = runWyckoffTheoryEngine(snapshot);

  assert.equal(first.status, "succeeded");
  assert.equal(first.resultId, second.resultId);
  assert.ok(first.statistics.rangeCount >= 1);
  assert.ok(first.structures.candidates.some((candidate) => candidate.pattern === "accumulation"));
  assert.ok(first.structures.candidates.some((candidate) => candidate.pattern === "distribution"));
  assert.ok(first.structures.primaryCandidate.range.support < first.structures.primaryCandidate.range.resistance);
  assert.ok(first.structures.primaryCandidate.range.supportTouches >= 2);
  assert.ok(first.structures.primaryCandidate.range.resistanceTouches >= 2);
  assert.ok(first.structures.primaryCandidate.events.every((event) => (
    event.id && event.ruleId && Number.isFinite(event.evidence.relativeVolume)
  )));
  const accumulation = first.structures.candidates.find((candidate) => candidate.pattern === "accumulation");
  assert.ok(accumulation.events.some((event) => event.code === "SC"));
  assert.ok(accumulation.events.some((event) => event.code === "ST"));
  assert.ok(accumulation.phases.some((phase) => phase.code === "A"));
  assert.ok(accumulation.phases.some((phase) => phase.code === "B"));
});

test("Wyckoff engine fails closed when price only trends and no rotational range exists", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(monotonicCandles()));
  const result = runWyckoffTheoryEngine(snapshot);
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.structures.candidates.length, 0);
  assert.match(result.missingData.join(" "), /交易区间/);
});

test("Wyckoff engine mirrors volume-price evidence into a distribution scenario", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(distributionCandles()));
  const result = runWyckoffTheoryEngine(snapshot);
  assert.equal(result.status, "succeeded");
  const distribution = result.structures.candidates.find((candidate) => candidate.pattern === "distribution");
  assert.ok(distribution);
  assert.ok(distribution.events.some((event) => event.code === "BC"));
  assert.ok(distribution.events.some((event) => event.code === "ST"));
  assert.ok(distribution.events.every((event) => event.pattern === "distribution"));
  assert.ok(distribution.confirmationPrice < distribution.range.support);
  assert.ok(distribution.invalidationPrice > distribution.range.resistance);
});

test("Wyckoff pipeline keeps the model provider neutral and only draws trusted candidate facts", async () => {
  const calls = [];
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true },
    async analyze(request) {
      calls.push(request);
      return {
        providerId: "fixture-provider",
        modelId: "fixture-model",
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "价格仍在区间附近，等待收盘突破后再跟随。",
          report: "只使用给定区间和事件。",
          marketBias: "neutral",
          strategyRationale: "区间上下沿和量价事件已由本地规则确认。",
          primaryCandidateId: "unknown-candidate",
          alternateCandidateIds: ["unknown-alternate"],
          selectedEventIds: ["invented-spring"],
          showProjectionZone: true,
          confidence: 0.68,
        }),
      };
    },
  }]);
  const result = await runTradingWyckoffAnalysisPipeline(fixtureParams(), {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].theoryId, "wyckoff");
  assert.equal(calls[0].task, "wyckoff-theory-review-and-drawing-plan");
  assert.match(calls[0].prompt, /只能选择给定的候选 ID 和事件 ID/);
  assert.match(calls[0].prompt, /actionLevels/);
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 12);
  assert.ok(result.analysisPlan.drawingPatch.operations.length <= 56);
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => (
    drawing.theory === "wyckoff"
    && drawing.layer === "ai/wyckoff"
    && drawing.locked === true
    && drawing.colorToken.startsWith("wyckoff-")
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => drawing.tool === "rectangle"));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => drawing.tool === "path"));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text.startsWith("Phase ")
  )));
  assert.ok(result.analysisPlan.actionPlan.longTrigger > result.analysisPlan.actionPlan.shortTrigger);
  assert.match(result.analysisPlan.report, /上破 .* 后偏多/);
  assert.match(result.analysisPlan.report, /跌破 .* 后偏空/);
  assert.match(result.analysisPlan.report, /之间先等待/);
  assert.match(result.analysisPlan.report, /新手执行清单/);
  assert.match(result.analysisPlan.report, /不等同于逐笔订单流/);

  const prompt = buildWyckoffModelPrompt(
    normalizeTradingMarketSnapshot(fixtureParams()),
    result.theoryResult,
  );
  assert.doesNotMatch(prompt, /gpt-\d|deepseek|openai/i);
  const [engineSource, pipelineSource] = await Promise.all([
    readFile(new URL("../src/main/trading-analysis/wyckoff-engine.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/wyckoff-pipeline.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(engineSource, /gpt|deepseek|openai/i);
  assert.doesNotMatch(pipelineSource, /gpt-\d|deepseek|openai/i);
});

test("Drawing Gateway rejects cross-theory Wyckoff color injection", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  assert.throws(() => validateTradingDrawingPatch({
    schemaVersion: 1,
    analysisId: "cross-theory",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: [{
      op: "upsert",
      drawing: {
        id: "bad-wave",
        theory: "wave",
        tool: "path",
        points: [
          { time: snapshot.candles[0].time, price: 100 },
          { time: snapshot.candles[1].time, price: 101 },
        ],
        colorToken: "wyckoff-range",
      },
    }],
  }, snapshot), /unsupported drawing style/);
});

test("Wyckoff request routing uses fixed JSON and inherits the active chart when parameters are absent", () => {
  const prompt = buildWyckoffRequestRoutingPrompt({ text: "@策略:威科夫", hasImageAttachment: false });
  assert.match(prompt, /只负责分类/);
  assert.match(prompt, /未指定参数一律输出 null/);
  const routed = normalizeWyckoffRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.98,
  }), "@策略:威科夫");
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.symbol, null);
  assert.equal(routed.request.interval, null);
  assert.equal(routed.request.lookbackMs, null);

  const screenshot = normalizeWyckoffRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "screenshot-question",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.93,
  }), "@策略:威科夫 这里算 Spring 吗");
  assert.equal(screenshot.request.mode, "conversation");
  assert.throws(() => normalizeWyckoffRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "expert-question",
    symbol: "BTCUSDT",
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.9,
  }), "概念问答"), /must not mutate/);
});

test("Wyckoff mention and expert prompt preserve the actual user message", () => {
  assert.equal(tradingWyckoffMentioned("@策略:威科夫 帮我分析"), true);
  assert.equal(stripTradingWyckoffMention("@策略：威科夫 看 ETH"), "看 ETH");
  const prompt = buildTradingWyckoffExpertPrompt("用户实际问题");
  assert.match(prompt, /横盘本身不等于吸筹或派发/);
  assert.match(prompt, /不得为了凑完整 A-E 阶段强行命名/);
  assert.match(prompt, /站上哪个确定性价格后偏多/);
  assert.ok(prompt.endsWith("用户实际问题"));
});

test("Trading Expert wires Wyckoff through IPC, persistent playback, and paired themes", async () => {
  const [mainSource, preloadSource, rendererSource, catalogSource, clientSource, marketSource, drawingSource, playbackSource, stylesSource] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-ai-playback.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(mainSource, /tradingAnalysis:classifyWyckoffRequest/);
  assert.match(mainSource, /tradingAnalysis:runWyckoff/);
  assert.match(preloadSource, /classifyTradingWyckoffRequest/);
  assert.match(preloadSource, /runTradingWyckoffAnalysis/);
  assert.match(rendererSource, /await classifyTradingStrategyForSend\(/);
  assert.match(clientSource, /client\.classifyTradingStrategyRequest\(/);
  assert.match(rendererSource, /tradingStrategyRequestAtSend\?\.mode === "chart-analysis"/);
  assert.match(rendererSource, /runTradingStrategyChartRequest\(threadId, tradingStrategyAtSend/);
  assert.match(catalogSource, /buildTradingWyckoffExpertPrompt/);
  assert.match(marketSource, /runWyckoffConversation/);
  assert.match(marketSource, /runTradingAnalysisWithAutoExpansion\(\{/);
  assert.match(marketSource, /TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE/);
  assert.match(marketSource, /focusWyckoffAnalysisCandles[\s\S]*timeScale\(\)\.setVisibleRange/);
  assert.doesNotMatch(marketSource, /所选范围"\}仅有 \$\{analysisCandles\.length\} 根 K 线，不足以识别可靠的威科夫交易区间/);
  assert.match(marketSource, /识别交易区间、量价努力结果、A–E 阶段和关键事件/);
  assert.match(marketSource, /playAiDrawingPatch/);
  assert.match(drawingSource, /drawing\.theory === "wyckoff"/);
  assert.match(drawingSource, /ai\/wyckoff/);
  assert.match(playbackSource, /"wyckoff"/);
  assert.doesNotMatch(playbackSource, /new\s+PointerEvent|dispatchEvent\s*\(/);
  assert.match(stylesSource, /--trading-ai-wyckoff-range: #7c5c36;/);
  assert.match(stylesSource, /--trading-ai-wyckoff-demand: #078c53;/);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-ai-wyckoff-range: #c9a875;[\s\S]*?--trading-ai-wyckoff-demand: #52dc88;/,
  );
  assert.match(drawingSource, /persistAiDrawings/);
});
