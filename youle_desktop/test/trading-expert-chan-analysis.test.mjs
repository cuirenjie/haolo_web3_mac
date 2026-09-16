import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTradingAnalysisModelProviderRegistry,
} from "../src/main/trading-analysis/model-provider.mjs";
import {
  createAppServerTradingAnalysisProvider,
  DEFAULT_TRADING_ANALYSIS_MODEL_ID,
  DEFAULT_TRADING_ANALYSIS_PROVIDER_ID,
} from "../src/main/trading-analysis/app-server-provider.mjs";
import { runChanTheoryEngine } from "../src/main/trading-analysis/chan-engine.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";
import {
  buildChanAnalysisReport,
  buildChanMarketOutlook,
  buildChanDrawingPatch,
  buildChanModelPrompt,
  runTradingChanAnalysisPipeline,
} from "../src/main/trading-analysis/chan-pipeline.mjs";
import {
  buildChanRequestRoutingPrompt,
  normalizeChanRequestRoutingModelResponse,
} from "../src/main/trading-analysis/chan-request-router.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { executionPlanTextPartitions } from "../src/renderer/execution-plans.ts";
import { interpolateTradingDrawingPoint } from "../src/renderer/trading-expert-ai-playback.ts";
import {
  buildTradingChanExpertPrompt,
  stripTradingChanMention,
  tradingChanMentioned,
  TRADING_CHAN_EXPERT_PROMPT_END,
  TRADING_CHAN_EXPERT_PROMPT_START,
} from "../src/renderer/trading-expert-chan-request.ts";
import {
  TRADING_CHAN_INSUFFICIENT_DATA_CODE,
  runTradingAnalysisWithAutoExpansion,
} from "../src/renderer/trading-expert-wave-expansion.ts";

function fixtureCandles(count = 96) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index * 0.62) * 12 + index * 0.035;
    const open = close - Math.cos(index * 0.37) * 0.8;
    return {
      time: 1_720_000_000 + index * 3_600,
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 100 + index,
    };
  });
}

function fixtureSnapshot() {
  return normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_720_400_000_000,
    candles: fixtureCandles(),
  });
}

test("English Chan annotations are generated in English even when a model returns Chinese", () => {
  const snapshot = fixtureSnapshot();
  const theoryResult = runChanTheoryEngine(snapshot);
  const review = {
    verdict: "approve", summary: "中枢震荡后向上反弹，后续笔尚未确认。",
    selectedPenPointIds: theoryResult.structures.penPoints.map((point) => point.penPointId),
    selectedCenterIds: theoryResult.structures.centers.map((center) => center.id),
    showFractals: true,
  };
  const chinese = buildChanDrawingPatch(snapshot, theoryResult, review);
  const english = buildChanDrawingPatch(snapshot, theoryResult, review, { language: "en" });
  const notes = english.operations.map((operation) => operation.drawing).filter((drawing) => drawing.text);
  assert.ok(notes.length >= 3);
  for (const note of notes) {
    assert.doesNotMatch(note.text, /\p{Script=Han}/u);
    assert.ok(note.text.length <= 120);
    assert.match(note.text, /[.!?]$/);
  }
  assert.match(notes.find((note) => note.id.endsWith("latest-center")).text, /Latest central zone/);
  assert.match(notes.find((note) => note.id.endsWith("latest-pen")).text, /Latest (up|down) stroke/);
  const withoutText = (patch) => patch.operations.map(({ drawing: { text, ...drawing }, ...operation }) => ({ ...operation, drawing }));
  assert.deepEqual(withoutText(english), withoutText(chinese), "language must not change chart facts or geometry");
  const nativeEnglish = buildChanDrawingPatch(snapshot, theoryResult, { ...review, summary: "The latest stroke is up; wait for confirmation." }, { language: "en" });
  assert.equal(nativeEnglish.operations.find(({ drawing }) => drawing.id.endsWith("note-summary")).drawing.text, "Summary: The latest stroke is up; wait for confirmation.");
  const prompt = buildChanModelPrompt(snapshot, theoryResult, { language: "en" });
  assert.match(prompt, /English-only chart summary/);
  assert.match(prompt, /Do not emit Chinese characters in summary, report or strategyRationale/);
  assert.doesNotMatch(prompt, /完整中文缠论分析|不超过80个中文字符/);
});

test("Chan engine deterministically produces confirmed fractals, pen points, and centers", () => {
  const snapshot = fixtureSnapshot();
  const first = runChanTheoryEngine(snapshot);
  const second = runChanTheoryEngine(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.engineId, "chan");
  assert.equal(first.status, "succeeded");
  assert.ok(first.structures.penPoints.length >= 4);
  assert.ok(first.structures.fractals.length >= 4);
  for (let index = 1; index < first.structures.penPoints.length; index += 1) {
    assert.notEqual(first.structures.penPoints[index - 1].type, first.structures.penPoints[index].type);
    assert.ok(first.structures.penPoints[index - 1].time < first.structures.penPoints[index].time);
  }
});

test("Chan analysis never expands a historical visible window into future candles", async () => {
  const allCandles = Array.from({ length: 501 }, (_, index) => ({ time: index + 1 }));
  const expansionEvents = [];
  const result = await runTradingAnalysisWithAutoExpansion({
    initialCandles: allCandles.slice(177, 201),
    getAvailableCandles: () => allCandles,
    insufficientDataCode: TRADING_CHAN_INSUFFICIENT_DATA_CODE,
    async analyze(candles) {
      return candles.length >= 240
        ? { ok: true }
        : { ok: false, error: { code: TRADING_CHAN_INSUFFICIENT_DATA_CODE } };
    },
    onExpansion: (event) => expansionEvents.push(event),
    maxCandleCount: 600,
  });

  assert.deepEqual(result.attemptCounts, [24, 120, 201]);
  assert.equal(result.exhausted, true, "a historical end point cannot manufacture earlier candles");
  assert.equal(result.candles[0].time, 1);
  assert.equal(result.candles.at(-1).time, 201, "expansion must not introduce future candles");
  assert.deepEqual(expansionEvents.map((event) => event.type), ["window", "window"]);
});

test("Chan analysis reaches success after expanding the current 24-candle canvas", async () => {
  const allCandles = Array.from({ length: 501 }, (_, index) => ({ time: index + 1 }));
  const result = await runTradingAnalysisWithAutoExpansion({
    initialCandles: allCandles.slice(-24),
    getAvailableCandles: () => allCandles,
    insufficientDataCode: TRADING_CHAN_INSUFFICIENT_DATA_CODE,
    async analyze(candles) {
      return candles.length >= 240
        ? { ok: true }
        : { ok: false, error: { code: TRADING_CHAN_INSUFFICIENT_DATA_CODE } };
    },
    maxCandleCount: 600,
  });

  assert.deepEqual(result.attemptCounts, [24, 120, 240]);
  assert.equal(result.candles.length, 240);
  assert.equal(result.exhausted, false);
});

test("Chan analysis loads older history when the chart has no larger loaded window", async () => {
  let candlePool = Array.from({ length: 24 }, (_, index) => ({ time: index + 501 }));
  const expansionEvents = [];
  const result = await runTradingAnalysisWithAutoExpansion({
    initialCandles: candlePool,
    getAvailableCandles: () => candlePool,
    insufficientDataCode: TRADING_CHAN_INSUFFICIENT_DATA_CODE,
    async analyze(candles) {
      return candles.length >= 120
        ? { ok: true }
        : { ok: false, error: { code: TRADING_CHAN_INSUFFICIENT_DATA_CODE } };
    },
    async loadMoreHistory() {
      candlePool = [
        ...Array.from({ length: 500 }, (_, index) => ({ time: index + 1 })),
        ...candlePool,
      ];
    },
    onExpansion: (event) => expansionEvents.push(event),
    maxCandleCount: 600,
  });

  assert.deepEqual(result.attemptCounts, [24, 120]);
  assert.equal(result.historyLoadCount, 1);
  assert.deepEqual(expansionEvents.map((event) => event.type), ["history", "window"]);
});

test("model provider registry keeps the Chan pipeline independent from a concrete vendor", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    invoke: async (request) => {
      calls.push(request);
      return {
        status: "success",
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "笔结构交替延伸，当前按已确认分型绘制。",
          report: "模型复核认为末端笔仍在延伸，应等待中枢离开确认。",
          selectedPenPointIds: [],
          selectedCenterIds: [],
          showFractals: true,
          confidence: 0.72,
        }),
      };
    },
  });
  const registry = createTradingAnalysisModelProviderRegistry([provider]);
  const result = await runTradingChanAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_720_400_000_000,
    candles: fixtureCandles(),
  }, {
    modelRegistry: registry,
    providerId: DEFAULT_TRADING_ANALYSIS_PROVIDER_ID,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].modelId, DEFAULT_TRADING_ANALYSIS_MODEL_ID);
  assert.equal(calls[0].reasoningEffort, "medium");
  assert.equal(result.model.reasoningEffort, "medium");
  assert.equal(result.model.reviewAttempts, 1);
  assert.equal(result.model.providerId, DEFAULT_TRADING_ANALYSIS_PROVIDER_ID);
  assert.equal(result.model.modelId, DEFAULT_TRADING_ANALYSIS_MODEL_ID);
  assert.equal(result.analysisPlan.drawingPatch.operations[0].drawing.tool, "path");
  assert.ok(result.analysisPlan.drawingPatch.operations.length > 2);
  const annotations = result.analysisPlan.drawingPatch.operations
    .map((operation) => operation.drawing)
    .filter((drawing) => drawing.tool === "note");
  const penPath = result.analysisPlan.drawingPatch.operations
    .map((operation) => operation.drawing)
    .find((drawing) => drawing.tool === "path");
  const latestPenAnnotation = annotations.find((drawing) => drawing.id.endsWith("-note-latest-pen"));
  assert.ok(annotations.length >= 3 && annotations.length <= 4);
  assert.deepEqual(latestPenAnnotation.points[0], penPath.points.at(-1));
  assert.ok(new Set(annotations.map((drawing) => JSON.stringify(drawing.points[0]))).size >= 3);
  assert.match(annotations.map((drawing) => drawing.text).join("\n"), /盘面结论/);
  assert.match(annotations.map((drawing) => drawing.text).join("\n"), /末端向[上下]笔/);
  assert.match(annotations.map((drawing) => drawing.text).join("\n"), /前序关键[顶底]分型/);
  assert.ok(annotations.every((drawing) => drawing.points.length === 1 && drawing.text.length <= 120));
  assert.match(result.analysisPlan.report, /数据范围/);
  assert.match(result.analysisPlan.report, /缠论结构/);
  assert.match(result.analysisPlan.report, /当下行情判断与涨跌情景概率/);
  assert.match(result.analysisPlan.report, /上涨情景权重约 \d+%/);
  assert.match(result.analysisPlan.report, /条件交易计划/);
  assert.match(result.analysisPlan.report, /多头方案[\s\S]*有效站上/);
  assert.match(result.analysisPlan.report, /空头方案[\s\S]*有效跌破/);
  assert.match(result.analysisPlan.report, /观望条件/);
  assert.match(result.analysisPlan.report, /风险控制/);
  assert.match(result.analysisPlan.report, /观察与失效条件/);
  assert.match(calls[0].request.prompt, /确定性 TheoryResult/);
  assert.match(calls[0].request.prompt, /riseProbability/);
  assert.match(calls[0].request.prompt, /strategyRationale/);
  const englishResult = await runTradingChanAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: 1_720_400_000_000,
    candles: fixtureCandles(), language: "en",
  }, { modelRegistry: registry, providerId: DEFAULT_TRADING_ANALYSIS_PROVIDER_ID });
  assert.match(calls[1].request.prompt, /English-only chart summary/);
  assert.ok(englishResult.analysisPlan.drawingPatch.operations.every(({ drawing }) => !/\p{Script=Han}/u.test(drawing.text || "")));
  assert.match(englishResult.analysisPlan.report, /^## BINANCE:FUTURES:BTCUSDT · 1H Chan analysis/m);
  assert.match(englishResult.analysisPlan.report, /### Chan structure/);
  assert.match(englishResult.analysisPlan.report, /### Overall assessment/);
  assert.match(englishResult.analysisPlan.report, /### Current view and scenario weights/);
  assert.match(englishResult.analysisPlan.report, /### Conditional trading plan/);
  assert.match(englishResult.analysisPlan.report, /### Observation and invalidation/);
  assert.doesNotMatch(englishResult.analysisPlan.report, /\p{Script=Han}/u);
  const [engineSource, pipelineSource] = await Promise.all([
    readFile(new URL("../src/main/trading-analysis/chan-engine.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/chan-pipeline.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(engineSource, /gpt|deepseek|openai/i);
  assert.doesNotMatch(pipelineSource, /gpt-\d|deepseek|openai/i);
});

test("English Chan reports keep deterministic conclusions when the model narrative is Chinese", () => {
  const snapshot = fixtureSnapshot();
  const theoryResult = runChanTheoryEngine(snapshot);
  const report = buildChanAnalysisReport(snapshot, theoryResult, {
    verdict: "approve",
    summary: "末笔向上但仍需等待突破确认。",
    report: "中文模型复核结论不应泄漏到英文报告。",
    strategyRationale: "中枢内仍有反复。",
    confidence: 0.72,
    marketBias: "bullish",
    riseProbability: 0.62,
    fallProbability: 0.38,
  }, {
    language: "en",
    instruction: "分析当前缠论结构",
  });

  assert.match(report, /### Overall assessment/);
  assert.match(report, /deterministic review identifies/i);
  assert.match(report, /upside scenario weight is about \d+%/i);
  assert.match(report, /Long setup[\s\S]*Short setup/);
  assert.doesNotMatch(report, /\p{Script=Han}/u);
});

test("English Chan coordination returns plan cards plus a complete parseable analysis", async () => {
  const snapshot = fixtureSnapshot();
  const coordinator = new TradingStrategyCoordinator({
    registry: createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS }),
    providerId: "test-provider",
    modelRegistry: {
      async analyze() {
        return {
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "The latest stroke is up, but price is still testing the central zone.",
            report: "The structure remains conditional; wait for a closed-candle break and retest.",
            strategyRationale: "The last stroke is rising while the central zone still contains price.",
            marketBias: "neutral",
            riseProbability: 0.54,
            fallProbability: 0.46,
            selectedPenPointIds: [],
            selectedCenterIds: [],
            showFractals: true,
            confidence: 0.72,
          }),
          providerId: "test-provider",
          modelId: "test-model",
          requestId: "test-request",
          latencyMs: 1,
          usage: null,
          finishReason: "stop",
        };
      },
    },
  });
  const coordinated = await coordinator.run("chan", {
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    snapshotTime: snapshot.snapshotTime,
    language: "en",
    candles: snapshot.candles,
  });

  assert.match(coordinated.analysisPlan.report, /^## BTC\/USDT Binance Perpetual 1H/m);
  assert.match(coordinated.analysisPlan.report, /Current action:/);
  assert.match(coordinated.analysisPlan.report, /---[\s\S]*## BINANCE:FUTURES:BTCUSDT · 1H Chan analysis/);
  assert.match(coordinated.analysisPlan.report, /### Overall assessment/);
  assert.doesNotMatch(coordinated.analysisPlan.report, /\p{Script=Han}/u);

  const partitions = executionPlanTextPartitions(coordinated.analysisPlan.report);
  assert.ok(partitions);
  assert.ok(partitions.candidates.length >= 1);
  assert.match(partitions.after, /### Chan structure/);
  assert.match(partitions.after, /### Observation and invalidation/);
});

test("Chan market outlook produces bounded probabilities and structure-derived trade levels", () => {
  const snapshot = fixtureSnapshot();
  const theoryResult = runChanTheoryEngine(snapshot);
  const latestClose = snapshot.candles.at(-1).close;
  const outlook = buildChanMarketOutlook(snapshot, theoryResult, {
    confidence: 0.72,
    marketBias: "bullish",
    riseProbability: 0.62,
    fallProbability: 0.38,
    strategyRationale: "末笔向上但仍需突破确认。",
  });

  assert.equal(outlook.risePercent + outlook.fallPercent, 100);
  assert.ok(outlook.risePercent >= 25 && outlook.risePercent <= 75);
  assert.ok(outlook.longTrigger > latestClose);
  assert.ok(outlook.shortTrigger < latestClose);
  assert.ok(outlook.longInvalidation < outlook.longTrigger);
  assert.ok(outlook.shortInvalidation > outlook.shortTrigger);
  assert.ok(outlook.longTarget > outlook.longTrigger);
  assert.ok(outlook.shortTarget < outlook.shortTrigger);
  assert.match(outlook.basis, /末笔|中枢|动量/);
});

test("Drawing Gateway rejects arbitrary styles and market identity changes", () => {
  const snapshot = fixtureSnapshot();
  const base = {
    schemaVersion: 1,
    analysisId: "analysis-1",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: [{
      op: "upsert",
      drawing: {
        id: "drawing-1",
        tool: "path",
        colorToken: "chan-pen",
        points: [
          { time: snapshot.candles[0].time, price: snapshot.candles[0].low },
          { time: snapshot.candles[1].time, price: snapshot.candles[1].high },
        ],
      },
    }],
  };
  assert.equal(validateTradingDrawingPatch(base, snapshot).operations.length, 1);
  assert.throws(
    () => validateTradingDrawingPatch({
      ...base,
      operations: [{
        ...base.operations[0],
        drawing: { ...base.operations[0].drawing, colorToken: "url(javascript:alert(1))" },
      }],
    }, snapshot),
    /unsupported drawing style/,
  );
  assert.throws(
    () => validateTradingDrawingPatch({ ...base, marketId: "OTHER" }, snapshot),
    /market identity/,
  );
});

test("AI drawing playback interpolates time and price without synthetic pointer input", async () => {
  assert.deepEqual(
    interpolateTradingDrawingPoint(
      { time: 100, price: 20 },
      { time: 200, price: 60 },
      0.25,
    ),
    { time: 125, price: 30 },
  );
  const playbackSource = await readFile(
    new URL("../src/renderer/trading-expert-ai-playback.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(playbackSource, /new\s+PointerEvent|dispatchEvent\s*\(/);
  assert.match(playbackSource, /requestAnimationFrame/);
  assert.match(playbackSource, /prefers-reduced-motion/);
});

test("Trading Expert routes @策略:缠论 through model JSON or controlled chart analysis", async () => {
  const [mainSource, preloadSource, rendererSource, catalogSource, clientSource, requestSource, routerSource, marketSource, drawingSource, stylesSource, strategySource, skillSource] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-chan-request.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/chan-request-router.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/chan/strategy.json", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/chan/SKILL.md", import.meta.url), "utf8"),
  ]);

  assert.match(mainSource, /createTradingAnalysisModelProviderRegistry/);
  assert.match(mainSource, /tradingAnalysis:classifyChanRequest/);
  assert.match(mainSource, /tradingAnalysis:runChanTest/);
  assert.match(mainSource, /DEFAULT_TRADING_ANALYSIS_PROVIDER_ID/);
  assert.match(mainSource, /const turnPolicy = tradingAnalysisTurnPolicy\(request\.task, \{ requestedReasoningEffort, modelId \}\)/);
  assert.match(mainSource, /fixedEffort: reasoningEffort/);
  assert.match(mainSource, /resetTimeoutOnActivity,/);
  assert.match(mainSource, /timeoutRetryable,/);
  assert.match(mainSource, /fixedReasoningEffort: reasoningEffort/);
  assert.match(mainSource, /maxAttempts,/);
  assert.match(mainSource, /\[HAOLO_REASONING_FIXED_EFFORT_FIELD\]: fixedReasoningEffort/);
  assert.match(mainSource, /error\.code = "WORKFLOW_TURN_TIMEOUT"/);
  assert.match(mainSource, /error\.category = "timeout"/);
  assert.match(mainSource, /if \(resetTimeoutOnActivity\) armTimeout\(\)/);
  assert.match(
    mainSource,
    /isRetryableModelTransportError\(\{[\s\S]{0,220}category: errorClass[\s\S]{0,120}status: httpStatus/,
    "structured timeout categories must reach the transport recovery classifier",
  );
  assert.match(mainSource, /\[trading-analysis\] model turn recovering/);
  assert.doesNotMatch(
    mainSource,
    /\[trading-analysis\][^\n]{0,100}(?:prompt|instruction):\s*request\.(?:prompt|instruction)/,
    "trading diagnostics must not log the model prompt",
  );
  assert.match(
    mainSource,
    /type === "userMessage"[\s\S]{0,180}type === "agentMessage"/,
    "submitted user messages must not be classified as model side effects",
  );
  assert.match(preloadSource, /classifyTradingChanRequest/);
  assert.match(preloadSource, /runTradingChanTest/);
  assert.doesNotMatch(marketSource, /data-market-action="chan-test"|data-market-chan-test|>测试<|chanTestButton/);
  assert.doesNotMatch(stylesSource, /\.trading-market-chan-test/);
  assert.doesNotMatch(requestSource, /_PATTERN|parseTradingChanRequest|parseTradingChanSymbol|parseTradingChanInterval|parseTradingChanLookback/);
  assert.match(routerSource, /输出必须是单个 JSON 对象/);
  assert.match(routerSource, /不得根据常见默认值、上下文猜测或补全 BTC、日线、时间范围/);
  assert.match(rendererSource, /await classifyTradingStrategyForSend\(/);
  assert.match(clientSource, /client\.classifyTradingStrategyRequest\(/);
  assert.match(rendererSource, /label: "正在理解请求"/);
  assert.match(rendererSource, /tradingStrategyRequestAtSend\?\.mode === "chart-analysis"/);
  assert.match(rendererSource, /runTradingStrategyChartRequest\(threadId, tradingStrategyAtSend/);
  assert.match(catalogSource, /buildTradingChanExpertPrompt/);
  assert.match(marketSource, /chan: \(request:[\s\S]{0,180}runTradingExpertChanConversation/);
  assert.match(marketSource, /selectTradingAnalysisMarket\(this\.markets,[\s\S]{0,240}explicitSymbol: Boolean\(request\.symbol\)/);
  assert.match(marketSource, /selectTradingAnalysisInterval\(\{[\s\S]{0,180}currentInterval: this\.activeInterval/);
  assert.match(marketSource, /targetInterval !== this\.loadedInterval[\s\S]{0,520}this\.activeInterval = targetInterval[\s\S]{0,420}await this\.restartMarketData\(\)/);
  assert.match(marketSource, /this\.loadedInterval !== targetInterval[\s\S]{0,240}行情加载失败/);
  assert.match(marketSource, /interval: job\.interval,[\s\S]{0,420}candles: candles\.map/);
  assert.match(
    marketSource,
    /async runChanConversation\([\s\S]*?snapshotTime: Date\.now\(\),\s*language: getCurrentAppLanguage\(\)/,
  );
  assert.match(marketSource, /当前画布可见的 \$\{analysisCandles\.length\} 根/);
  assert.match(marketSource, /visibleCandlesInLogicalRange\(this\.candles, visibleRange\)/);
  assert.match(marketSource, /runTradingAnalysisWithAutoExpansion\(\{/);
  assert.match(marketSource, /insufficientDataCode: TRADING_CHAN_INSUFFICIENT_DATA_CODE/);
  assert.match(marketSource, /focusChanAnalysisCandles[\s\S]*?timeScale\(\)\.setVisibleRange\(\{[\s\S]*?from: first\.time[\s\S]*?to: last\.time/);
  assert.match(marketSource, /当前 \$\{event\.fromCount\} 根 K 线不足，正在自动扩大画布到 \$\{event\.toCount\} 根并继续缠论分析/);
  assert.match(marketSource, /自动加载更早历史，最多检查 \$\{event\.maxCandleCount\} 根/);
  assert.doesNotMatch(marketSource, /所选范围"\}仅有 \$\{analysisCandles\.length\} 根 K 线，不足以形成可靠的缠论笔结构/);
  assert.match(marketSource, /playAiDrawingPatch/);
  assert.equal(JSON.parse(strategySource).dataRequirements.candles.preferredCount, 600);
  assert.match(skillSource, /visible range as the starting window only/);
  assert.match(skillSource, /expand the chart leftward and retry/);
  assert.match(drawingSource, /data-ai-drawing-content/);
  assert.match(drawingSource, /data-ai-drawing-cursor/);
  assert.match(stylesSource, /--trading-ai-chan-pen: #7b61ff;/);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-ai-chan-pen: #a994ff;/,
  );
});

test("generic drawing progress describes the chart instead of Chan analysis", async () => {
  const rendererSource = await readFile(
    new URL("../src/renderer/main.ts", import.meta.url),
    "utf8",
  );
  const tradingThinkingBlock = rendererSource.slice(
    rendererSource.indexOf("function tradingExpertThinkingStage"),
    rendererSource.indexOf("function updateTradingExpertThinkingState"),
  );

  assert.match(tradingThinkingBlock, /phase === "drawing"[\s\S]*?label: "正在绘制盘面结构"/);
  assert.doesNotMatch(tradingThinkingBlock, /label: "正在绘制缠论结构"/);
});

test("Trading Expert keeps the sent bubble and updates analysis progress without remounting the page", async () => {
  const rendererSource = await readFile(
    new URL("../src/renderer/main.ts", import.meta.url),
    "utf8",
  );
  const chartSendStart = rendererSource.indexOf(
    'localHistoryAheadThreadIds.add(threadId);\n      if (pendingSend) clearPendingComposerSend',
  );
  assert.notEqual(chartSendStart, -1);
  const chartSendEnd = rendererSource.indexOf(
    "if (isMultiModelClusterThread(threadId))",
    chartSendStart,
  );
  assert.notEqual(chartSendEnd, -1);
  const chartSendBlock = rendererSource.slice(chartSendStart, chartSendEnd);
  const progressBlock = rendererSource.slice(
    rendererSource.indexOf("function refreshTradingExpertConversationSurface"),
    rendererSource.indexOf("async function runTradingGeneralChartRequest"),
  );
  const tradingThinkingBlock = rendererSource.slice(
    rendererSource.indexOf("function tradingExpertThinkingStage"),
    rendererSource.indexOf("function updateTradingExpertThinkingState"),
  );

  assert.match(chartSendBlock, /localHistoryAheadThreadIds\.add\(threadId\)/);
  assert.match(chartSendBlock, /clearPendingComposerSend\(threadId, pendingSend\.itemId\)/);
  assert.match(chartSendBlock, /clearTradingExpertComposerAfterSend\(threadId\)/);
  assert.match(chartSendBlock, /refreshTradingExpertConversationSurface\(threadId\)/);
  assert.doesNotMatch(chartSendBlock, /\brender\(\)/);
  assert.match(progressBlock, /function clearTradingExpertComposerAfterSend[\s\S]*?state\.composerText = ""/);
  assert.match(progressBlock, /querySelectorAll<HTMLFormElement>\("#composerForm"\)[\s\S]*?form\.dataset\.threadId !== threadId[\s\S]*?input\.value = ""/);
  assert.match(progressBlock, /const highlight = form\.querySelector<HTMLElement>\("\.composer-highlight"\)[\s\S]*?highlight\.innerHTML = ""/);
  assert.match(progressBlock, /syncComposerMentionPopovers\(\)/);
  assert.match(progressBlock, /if \(patchActiveChatSurfaces\(threadId, \{ patchThreadRow: true \}\)\) return/);
  assert.match(progressBlock, /tradingExpertThinkingStateByThreadId\.set\(threadId/);
  assert.match(progressBlock, /label: "正在准备行情"/);
  assert.match(progressBlock, /label: "正在分析盘面"/);
  assert.match(progressBlock, /label: "正在绘制盘面结构"/);
  assert.doesNotMatch(progressBlock, /label: "正在绘制缠论结构"/);
  assert.match(progressBlock, /label: "正在整理分析报告"/);
  assert.match(tradingThinkingBlock, /function tradingExpertThinkingStage\(phase: string, reasoningSummary = "", message = ""\)[\s\S]*?const detail = message \|\| "";/);
  assert.match(tradingThinkingBlock, /phase === "alert-analyzing" \? reasoningSummary\.trim\(\) : detail/);
  assert.doesNotMatch(tradingThinkingBlock, /message\.trim\(\)/);
  assert.match(progressBlock, /function appendTradingExpertProgress/);
  assert.match(progressBlock, /phase: phase === "error" \? "final_answer" : "commentary"/);
  assert.match(progressBlock, /localHistoryAheadThreadIds\.add\(threadId\)/);
  assert.doesNotMatch(progressBlock, /function upsertTradingExpertProgress/);
  assert.doesNotMatch(progressBlock, /__youleLocalStatus: true/);
  assert.match(progressBlock, /appendTradingExpertReport[\s\S]*?localHistoryAheadThreadIds\.add\(threadId\)/);
  assert.match(progressBlock, /appendTradingExpertReport[\s\S]*?phase: "final_answer"/);
  assert.doesNotMatch(progressBlock, /scheduleProtectedRender\(\{ sourceThreadId: threadId \}\)/);
  const requestProgressBlock = rendererSource.slice(
    rendererSource.indexOf("async function runTradingStrategyChartRequest"),
    rendererSource.indexOf("function hasUploadingAttachments"),
  );
  const allChartProgressBlock = rendererSource.slice(
    rendererSource.indexOf("async function runTradingGeneralChartRequest"),
    rendererSource.indexOf("function hasUploadingAttachments"),
  );
  assert.match(requestProgressBlock, /const progressIdPrefix = `trading-\$\{strategy\.id\}-progress-/);
  assert.match(requestProgressBlock, /let progressSequence = 0/);
  assert.match(requestProgressBlock, /progressSequence \+= 1/);
  assert.match(requestProgressBlock, /`\$\{progressIdPrefix\}-\$\{progressSequence\}`/);
  assert.match(requestProgressBlock, /appendTradingExpertProgress\([\s\S]*?phase,[\s\S]*?message/);
  assert.match(allChartProgressBlock, /正在优先读取左侧当前选择的品种、周期和可见 K 线/);
  assert.match(allChartProgressBlock, /updateProgress\("preparing", strategy\.ui\.preparingMessage\)/);
  assert.doesNotMatch(
    allChartProgressBlock,
    /updateTradingExpertThinkingState\(\s*threadId,\s*"preparing"/,
    "initial Trading Expert progress must not exist only in thinking metadata",
  );
  const turnCompletionBlock = rendererSource.slice(
    rendererSource.indexOf("function isTurnResultGroupComplete"),
    rendererSource.indexOf("function turnResultGroups"),
  );
  assert.match(
    turnCompletionBlock,
    /isLatestGroup && tradingExpertThinkingStateByThreadId\.has\(threadId\)[\s\S]*?return false/,
    "Trading Expert progress must stay expanded until its terminal report arrives",
  );
  assert.match(
    rendererSource,
    /const tradingExpertThinking = tradingExpertThinkingStateByThreadId\.get\(threadId\);[\s\S]*?id: `thinking-\$\{threadId\}`[\s\S]*?thinkingStage/,
  );
  assert.match(
    rendererSource,
    /function activeThinkingElapsedLabel\(threadId: string\)[\s\S]*?tradingExpertThinking\.startedAtMs/,
  );
  assert.match(
    rendererSource,
    /function patchActiveThinkingElapsed\(\)[\s\S]*?const stage = localizedThinkingStage\(tradingExpertThinking[\s\S]*?tradingExpertThinkingStage\(/,
    "the elapsed timer must retain the Trading Expert execution stage",
  );
  assert.match(
    rendererSource,
    /visibleStage\.detail \? `<span class="thinking-stage-detail">/,
    "blank Trading Expert details must not leave a duplicate gray detail row",
  );
  const pendingSendStart = rendererSource.indexOf(
    "pendingSend = beginPendingComposerSend(threadId, text, submissionSnapshotAttachments",
  );
  const immediateClear = rendererSource.indexOf(
    "if (tradingStrategyAtSend) clearTradingExpertComposerAfterSend(threadId);",
    pendingSendStart,
  );
  const routeModelWait = rendererSource.indexOf(
    "tradingStrategyRequestAtSend = await classifyTradingStrategyForSend(",
    pendingSendStart,
  );
  assert.ok(pendingSendStart >= 0 && immediateClear > pendingSendStart);
  assert.ok(routeModelWait > immediateClear, "the composer must clear before waiting for model routing");
});

test("Chan request router accepts only fixed model JSON and preserves unspecified canvas fields", () => {
  const currentCanvasRequest = normalizeChanRequestRoutingModelResponse(
    JSON.stringify({
      schemaVersion: 1,
      mode: "chart-analysis",
      intent: "chart-analysis",
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 0.96,
    }),
    "@策略:缠论 帮我分析下",
  );
  assert.deepEqual(currentCanvasRequest.request, {
    mode: "chart-analysis",
    instruction: "帮我分析下",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });

  const explicitMarketRequest = normalizeChanRequestRoutingModelResponse(
    JSON.stringify({
      schemaVersion: 1,
      mode: "chart-analysis",
      intent: "chart-drawing",
      symbol: "ETHUSDT",
      interval: "15",
      lookbackMs: 24 * 60 * 60 * 1000,
      lookbackLabel: "24小时",
      confidence: 0.98,
    }),
    "@策略:缠论 看下 ETH 最近24小时的15分钟K线并画图",
  );
  assert.deepEqual(explicitMarketRequest.request, {
    mode: "chart-analysis",
    instruction: "看下 ETH 最近24小时的15分钟K线并画图",
    symbol: "ETHUSDT",
    interval: "15",
    lookbackMs: 24 * 60 * 60 * 1000,
    lookbackLabel: "24小时",
    drawingRequested: true,
  });

  const screenshotRequest = normalizeChanRequestRoutingModelResponse(
    JSON.stringify({
      schemaVersion: 1,
      mode: "conversation",
      intent: "screenshot-question",
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 0.94,
    }),
    "@策略:缠论 这张图里的三买成立吗？",
  );
  assert.equal(screenshotRequest.request.mode, "conversation");

  const lowConfidenceRequest = normalizeChanRequestRoutingModelResponse(
    JSON.stringify({
      schemaVersion: 1,
      mode: "chart-analysis",
      intent: "chart-analysis",
      symbol: "BTCUSDT",
      interval: "1D",
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 0.4,
    }),
    "@策略:缠论 这个怎么理解？",
  );
  assert.deepEqual(lowConfidenceRequest.request, {
    mode: "conversation",
    instruction: "这个怎么理解？",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: false,
  });

  assert.throws(
    () => normalizeChanRequestRoutingModelResponse(JSON.stringify({
      schemaVersion: 1,
      mode: "conversation",
      intent: "expert-question",
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 0.9,
      unexpected: true,
    }), "@策略:缠论 什么是三买？"),
    /invalid JSON shape/,
  );
  assert.throws(
    () => normalizeChanRequestRoutingModelResponse(
      `\`\`\`json\n${JSON.stringify({
        schemaVersion: 1,
        mode: "conversation",
        intent: "expert-question",
        symbol: null,
        interval: null,
        lookbackMs: null,
        lookbackLabel: null,
        confidence: 0.9,
      })}\n\`\`\``,
      "@策略:缠论 什么是三买？",
    ),
    /must return only one JSON object/,
  );
  assert.equal(tradingChanMentioned("@策略：缠论 什么是三买？"), true);
  assert.equal(tradingChanMentioned("普通问题"), false);
  assert.equal(stripTradingChanMention("@策略：缠论 什么是三买？"), "什么是三买？");
  const routingPrompt = buildChanRequestRoutingPrompt({
    text: "@策略:缠论 帮我分析下",
    hasImageAttachment: false,
  });
  assert.match(routingPrompt, /symbol、interval、lookbackMs 只提取用户消息中明确出现的参数/);
  assert.match(routingPrompt, /所有行情参数为 null/);

  const expertPrompt = buildTradingChanExpertPrompt("附件：chart.png");
  assert.match(expertPrompt, /专业缠论交易专家/);
  assert.match(expertPrompt, /认真查看附件中的盘面/);
  assert.ok(expertPrompt.includes(TRADING_CHAN_EXPERT_PROMPT_START));
  assert.ok(expertPrompt.includes(TRADING_CHAN_EXPERT_PROMPT_END));
  assert.ok(
    expertPrompt.indexOf("附件：chart.png") > expertPrompt.indexOf(TRADING_CHAN_EXPERT_PROMPT_END),
    "the visible user content must remain outside the redacted internal prompt block",
  );
});

test("Trading Expert redacts its internal Chan prompt from visible message bubbles", async () => {
  const rendererSource = await readFile(
    new URL("../src/renderer/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    rendererSource,
    /\["<haolo_trading_chan_expert_prompt>", "<\/haolo_trading_chan_expert_prompt>"\]/,
  );
  assert.match(
    rendererSource,
    /cleanVisibleMessageText\(text: string\)[\s\S]{0,180}stripInternalTurnGroupMemoryText\(text\)/,
  );
});
