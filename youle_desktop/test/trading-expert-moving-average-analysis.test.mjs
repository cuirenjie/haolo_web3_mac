import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { indicatorSma } from "../src/main/trading-alerts/indicator-registry.mjs";
import {
  calculateMovingAverageSeries,
  detectMovingAveragePatterns,
  movingAverageCrossoverPoint,
  runMovingAverageAnalysisEngine,
} from "../src/main/trading-analysis/moving-average-analysis-engine.mjs";
import {
  buildMovingAverageAnalysisDrawingPatch,
  runMovingAverageAnalysisPipeline,
} from "../src/main/trading-analysis/moving-average-analysis-pipeline.mjs";
import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";
import {
  normalizeMovingAverageAnalysisRequestRoutingModelResponse,
  stripMovingAverageAnalysisMentionLiteral,
} from "../src/main/trading-analysis/moving-average-analysis-request-router.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";

const START = 1_700_000_000;
const STEP = 3_600;

function candles(count = 180) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 3 + index * 0.04;
    return { time: START + index * STEP, open: close - 0.2, high: close + 0.8, low: close - 0.8, close, volume: 100 + index };
  });
}

function params(items = candles()) {
  return { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: (items.at(-1).time + STEP) * 1_000, candles: items };
}

function syntheticSeries(length) {
  return {
    short: Array(length).fill(99),
    medium: Array(length).fill(100),
    long: Array(length).fill(95),
    atr: Array(length).fill(2),
    ribbonSpread: Array(length).fill(0.02),
    spreadPercentile: Array(length).fill(0.6),
  };
}

test("moving-average engine reuses the native SMA formula for MA5/MA20/MA60", () => {
  const items = candles();
  const closes = items.map((item) => item.close);
  const series = calculateMovingAverageSeries(items);
  assert.deepEqual(series.short, indicatorSma(closes, 5));
  assert.deepEqual(series.medium, indicatorSma(closes, 20));
  assert.deepEqual(series.long, indicatorSma(closes, 60));
});

test("golden and death crosses require a following closed candle to persist", () => {
  const items = candles(20).map((item) => ({ ...item, open: 105, high: 106, low: 104, close: 105 }));
  const goldenSeries = syntheticSeries(items.length);
  goldenSeries.short[11] = 101;
  goldenSeries.short[12] = 102;
  const golden = detectMovingAveragePatterns(items, goldenSeries).find((item) => item.kind === "golden-cross" && item.confirmationIndex === 12);
  assert.equal(golden?.eligible, true);
  assert.equal(golden.crossPoint.time, items[10].time + STEP / 2);
  assert.equal(golden.crossPoint.price, 100);

  const deathSeries = syntheticSeries(items.length);
  deathSeries.short.fill(101);
  deathSeries.long.fill(110);
  items.forEach((item) => Object.assign(item, { open: 95, high: 96, low: 94, close: 95 }));
  deathSeries.short[11] = 99;
  deathSeries.short[12] = 98;
  const death = detectMovingAveragePatterns(items, deathSeries).find((item) => item.kind === "death-cross" && item.confirmationIndex === 12);
  assert.equal(death?.eligible, true);
  assert.equal(death.crossPoint.time, items[10].time + STEP / 2);
  assert.equal(death.crossPoint.price, 100);
});

test("golden/death labels anchor at the interpolated MA intersection instead of the confirmation candle or label offset", () => {
  const items = candles(90);
  const snapshot = normalizeTradingMarketSnapshot(params(items));
  const series = syntheticSeries(items.length);
  const goldenPoint = movingAverageCrossoverPoint(items, {
    ...series,
    short: series.short.map((value, index) => index === 70 ? 99 : index === 71 ? 103 : value),
    medium: series.medium.map((value, index) => index === 70 ? 100 : index === 71 ? 101 : value),
  }, 70, 71);
  const deathPoint = movingAverageCrossoverPoint(items, {
    ...series,
    short: series.short.map((value, index) => index === 74 ? 103 : index === 75 ? 99 : value),
    medium: series.medium.map((value, index) => index === 74 ? 101 : index === 75 ? 100 : value),
  }, 74, 75);
  const patterns = [
    { id: "golden-fixture", kind: "golden-cross", name: "均线金叉", bias: "bullish", eligible: true, startIndex: 70, crossIndex: 71, confirmationIndex: 72, crossPoint: goldenPoint },
    { id: "death-fixture", kind: "death-cross", name: "均线死叉", bias: "bearish", eligible: true, startIndex: 74, crossIndex: 75, confirmationIndex: 76, crossPoint: deathPoint },
  ];
  const patch = buildMovingAverageAnalysisDrawingPatch(snapshot, {
    patterns,
    evidence: patterns.map((item) => ({ id: item.id, summary: item.name })),
    series,
    recentCompression: null,
    closedCandleCount: items.length,
    actionPlan: {},
  });
  const goldenLabel = patch.operations.find((item) => item.drawing.id.endsWith("golden-fixture-label"));
  const deathLabel = patch.operations.find((item) => item.drawing.id.endsWith("death-fixture-label"));
  assert.deepEqual(goldenLabel.drawing.points, [goldenPoint]);
  assert.deepEqual(deathLabel.drawing.points, [deathPoint]);
  assert.equal(patch.operations.some((item) => item.drawing.id.endsWith("golden-fixture-leader")), false);
  assert.equal(patch.operations.some((item) => item.drawing.id.endsWith("death-fixture-leader")), false);
});

test("a one-bar cross that immediately reverses is not confirmed", () => {
  const items = candles(20).map((item) => ({ ...item, close: 105 }));
  const series = syntheticSeries(items.length);
  series.short[11] = 101;
  series.short[12] = 99;
  assert.equal(detectMovingAveragePatterns(items, series).some((item) => item.kind === "golden-cross"), false);
});

test("ribbon expansion requires prior compression, persistent ordering, and aligned slopes", () => {
  const items = candles(90).map((item) => ({ ...item, open: 100, high: 101, low: 99, close: 100 }));
  const series = syntheticSeries(items.length);
  series.short.fill(100);
  series.medium.fill(99);
  series.long.fill(98);
  series.ribbonSpread.fill(0.02);
  series.spreadPercentile.fill(0.6);
  series.ribbonSpread[70] = 0.002;
  series.spreadPercentile[70] = 0.1;
  Object.assign(series, {
    short: series.short.map((value, index) => index === 73 ? 102 : index === 74 ? 103 : index === 75 ? 104 : value),
    medium: series.medium.map((value, index) => index === 73 ? 99.8 : index === 74 ? 100.4 : index === 75 ? 101 : value),
    long: series.long.map((value, index) => index === 73 ? 98.2 : index === 74 ? 98.45 : index === 75 ? 98.7 : value),
  });
  series.ribbonSpread[73] = 0.003;
  series.ribbonSpread[74] = 0.004;
  series.ribbonSpread[75] = 0.006;
  const expansion = detectMovingAveragePatterns(items, series).find((item) => item.kind === "bullish-expansion" && item.confirmationIndex === 75);
  assert.equal(expansion?.eligible, true);
});

test("MA20 pullback needs trend alignment, zone touch, close-back, and next-bar break", () => {
  const items = candles(90).map((item) => ({ ...item, open: 108, high: 109, low: 107, close: 108 }));
  const series = syntheticSeries(items.length);
  series.short.fill(105);
  series.medium.fill(100);
  series.long.fill(95);
  items[85] = { ...items[85], open: 102, high: 102, low: 99.8, close: 101 };
  items[86] = { ...items[86], open: 101, high: 104, low: 100.8, close: 103 };
  const retest = detectMovingAveragePatterns(items, series).find((item) => item.kind === "bullish-retest" && item.confirmationIndex === 86);
  assert.equal(retest?.eligible, true);
  assert.ok(retest?.zone.lower < 100 && retest?.zone.upper > 100);
});

test("analysis excludes the live candle, draws on the main chart, and remains conditional", async () => {
  const complete = candles(180);
  const live = { ...complete.at(-1), time: complete.at(-1).time + STEP, open: 100, high: 1_000, low: 1, close: 999 };
  const input = { ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 };
  const result = await runMovingAverageAnalysisPipeline(input);
  assert.equal(result.theoryResult.excludedLiveCandles, 1);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 1);
  assert.equal(result.analysisPlan.drawingPatch.operations.every((item) => item.drawing.layer === "ai/strategy/moving-average-analysis"), true);
  assert.equal(result.analysisPlan.drawingPatch.operations.every((item) => item.drawing.points.every((point) => "price" in point && !("value" in point))), true);
  assert.match(result.analysisPlan.report, /单次触线或交叉不能直接下单/);
  assert.match(result.analysisPlan.report, /已收盘 K 线/);
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const plan = buildExecutionPlanV1(registry.list().find((item) => item.id === "moving-average-analysis"), result);
  assert.equal(plan.action, "wait");
  assert.match(formatExecutionPlanMarkdown(plan), /^## BTC\/USDT 币安永续 1H/m);
  assert.doesNotMatch(formatExecutionPlanMarkdown(plan), /前置条件|确认方式|继续观察|方案有效期|取消执行/);
});

test("a live-only spike cannot alter closed-candle moving-average state", () => {
  const complete = candles(160);
  const baseline = runMovingAverageAnalysisEngine(params(complete));
  const live = { time: complete.at(-1).time + STEP, open: 100, high: 1_000, low: 1, close: 999, volume: 1 };
  const withLive = runMovingAverageAnalysisEngine({ ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 });
  assert.deepEqual(withLive.currentState, baseline.currentState);
  assert.deepEqual(withLive.patterns, baseline.patterns);
});

test("moving-average package is separately registered and requests native main-chart MA", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "moving-average-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "ma", scope: "main", parameters: [5, 20, 60] });
  assert.equal(registry.adapter("moving-average-analysis").id, "moving-average-analysis");
});

test("moving-average mention routing is strict and preserves explicit market fields", () => {
  assert.equal(stripMovingAverageAnalysisMentionLiteral("@指标:均线 帮我分析"), "帮我分析");
  const routed = normalizeMovingAverageAnalysisRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: "ETHUSDT",
    interval: "240",
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "@指标:均线 帮我分析", {});
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.symbol, "ETHUSDT");
  assert.equal(routed.request.drawingRequested, true);
});

test("moving-average Skill card, rules, icon, and both themes are wired", async () => {
  const [renderer, css, skill, rules, manifest] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/moving-average-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/moving-average-analysis/references/rules.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/moving-average-analysis/strategy.json", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /data-trading-indicator-icon="moving-average-analysis"/);
  assert.match(renderer, /ensureTradingExpertChartIndicatorVisible\(strategy\.chartIndicator\)/);
  assert.match(css, /\.trading-indicator-icon-moving-average/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-moving-average/);
  for (const boundary of ["MA5", "MA20", "MA60", "金叉", "死叉", "滞后", "动态", "已收盘"]) assert.match(`${skill}\n${rules}`, new RegExp(boundary));
  assert.match(manifest, /"group": "indicator"/);
  assert.match(manifest, /"scope": "main"/);
});
