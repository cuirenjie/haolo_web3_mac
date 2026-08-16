import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computeKdj } from "../src/main/trading-alerts/indicator-registry.mjs";
import { calculateKdjSeries, detectKdjCrossovers, detectKdjDivergences, kdjCrossoverPoint, runKdjAnalysisEngine } from "../src/main/trading-analysis/kdj-analysis-engine.mjs";
import { buildKdjIndicatorDrawingPatch, runKdjAnalysisPipeline } from "../src/main/trading-analysis/kdj-analysis-pipeline.mjs";
import { stripKdjAnalysisMentionLiteral } from "../src/main/trading-analysis/kdj-analysis-request-router.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";

const START = 1_700_000_000;
const STEP = 3_600;

function candles(count = 140) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 4) * 8 + Math.sin(index / 11) * 3 + index * 0.02;
    return { time: START + index * STEP, open: close - 0.2, high: close + 0.9, low: close - 0.9, close, volume: 100 + index };
  });
}

function params(items = candles()) {
  return { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: (items.at(-1).time + STEP) * 1_000, candles: items };
}

test("KDJ engine reuses the shared native/alert 9,3,3 formula and preserves unbounded J", () => {
  const items = candles();
  const actual = calculateKdjSeries(items, 9, 3, 3);
  const expected = computeKdj(items, 9, 3, 3);
  assert.deepEqual(actual.k, expected.k);
  assert.deepEqual(actual.d, expected.d);
  assert.deepEqual(actual.j, expected.j);
  const extreme = Array.from({ length: 30 }, (_, index) => ({ time: START + index * STEP, open: 100, high: 110, low: 90, close: index < 12 ? 90 : 110, volume: 1 }));
  assert.equal(calculateKdjSeries(extreme).j.some((value) => Number.isFinite(value) && (value < 0 || value > 100)), true);
});

test("KDJ crossover point is the interpolated K/D intersection, not a candle price", () => {
  const items = candles(3);
  const series = { k: [10, 30, 40], d: [20, 20, 25] };
  const point = kdjCrossoverPoint(items, series, 0, 1);
  assert.equal(point.time, START + STEP / 2);
  assert.equal(point.value, 20);
  const detected = detectKdjCrossovers(items, { k: [Number.NaN, ...series.k], d: [Number.NaN, ...series.d] });
  assert.equal(Array.isArray(detected), true);
});

test("KDJ divergence requires confirmed price pivots and material D-line separation", () => {
  const items = Array.from({ length: 28 }, (_, index) => ({ time: START + index * STEP, open: 100, close: 100, high: 101, low: 99, volume: 1 }));
  items[5].high = 110; items[13].high = 116;
  items[6].low = 92; items[16].low = 88;
  const series = { d: Array(28).fill(50) };
  series.d[5] = 82; series.d[13] = 70;
  series.d[6] = 18; series.d[16] = 31;
  const result = detectKdjDivergences(items, series);
  assert.ok(result.some((item) => item.kind === "regular-bearish"));
  assert.ok(result.some((item) => item.kind === "regular-bullish"));
  assert.equal(result.every((item) => item.secondIndex <= items.length - 3), true);
});

test("KDJ extreme readings alone remain wait/no-trade", () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ time: START + index * STEP, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1 }));
  const result = runKdjAnalysisEngine(params(items));
  assert.equal(result.currentState.zone, "overbought");
  assert.equal(result.actionPlan.disposition, "wait");
  assert.equal("longTrigger" in result.actionPlan || "shortTrigger" in result.actionPlan, false);
});

test("KDJ pipeline excludes a live bar and draws evidence only in the KDJ pane", async () => {
  const complete = candles(140);
  const live = { ...complete.at(-1), time: complete.at(-1).time + STEP, close: 999, high: 1_000, low: 1 };
  const result = await runKdjAnalysisPipeline({ ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 });
  assert.equal(result.theoryResult.excludedLiveCandles, 1);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.indicatorId, "kdj");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.layer === "ai/strategy/kdj-analysis"), true);
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.points.every((point) => "value" in point && !("price" in point))), true);
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations
    .filter((item) => item.drawing.tool === "path")
    .every((item) => item.drawing.points.slice(1).every((point, index) => point.time > item.drawing.points[index].time)), true);
  assert.equal(result.analysisPlan.drawingPatch?.operations.every((item) => ["strategy-entry", "strategy-stop", "strategy-target"].includes(item.drawing.colorToken)) ?? true, true);
  assert.match(result.analysisPlan.report, /K\/D 交叉/);
  assert.match(result.analysisPlan.report, /KDJ 不得单独触发下单/);
});

test("KDJ annotations match RSI small-dot style and leaders cannot cross", () => {
  const items = candles(50);
  const result = {
    closedCandleCount: items.length,
    series: { k: Array(50).fill(40), d: Array(50).fill(42), j: Array(50).fill(36) },
    evidence: [{ id: "evidence" }],
    divergences: [{ id: "kdj-div", kind: "regular-bullish", firstIndex: 10, secondIndex: 20, dFirst: 18, dSecond: 30 }],
    crossovers: [
      { id: "kdj-golden", name: "低位金叉", eligible: true, crossPoint: { time: items[28].time + STEP / 2, value: 19 } },
      { id: "kdj-death", name: "中位死叉", eligible: false, crossPoint: { time: items[34].time + STEP / 2, value: 54 } },
    ],
    extremeEvents: [{ id: "kdj-exit", index: 40, name: "D线离开超买区", value: 78 }],
  };
  const patch = buildKdjIndicatorDrawingPatch({ snapshotId: "kdj-drawing", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", candles: items }, result);
  const dots = patch.operations.filter((item) => item.drawing.id.endsWith("-dot"));
  const labels = patch.operations.filter((item) => item.drawing.id.endsWith("-label"));
  const leaders = patch.operations.filter((item) => item.drawing.id.endsWith("-leader"));
  assert.equal(dots.length, 4);
  assert.equal(labels.length, dots.length);
  assert.equal(leaders.length, dots.length);
  assert.equal(dots.every((item) => item.drawing.tool === "note" && item.drawing.markerSize === 0.35 && !item.drawing.text), true);
  assert.equal(labels.every((item) => item.drawing.tool === "text" && item.drawing.markerSize === 0 && item.drawing.text), true);
  assert.deepEqual(labels.map((item) => item.drawing.points[0].value), [44, 38, 32, 26]);
  assert.equal(leaders.every((item, index) => (
    item.drawing.tool === "path"
    && item.drawing.lineStyle === "dashed"
    && item.drawing.lineWidth === 0.8
    && item.drawing.points[1].time === item.drawing.points[0].time + 1
    && item.drawing.points[0].time === dots[index].drawing.points[0].time
    && labels[index].drawing.points[0].time === dots[index].drawing.points[0].time
  )), true);
});

test("KDJ mention routing and independent Indicator Skill registration are wired", () => {
  assert.equal(stripKdjAnalysisMentionLiteral("@指标:KDJ 帮我分析"), "帮我分析");
  assert.equal(stripKdjAnalysisMentionLiteral("@指标：随机指标"), "");
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "kdj-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "kdj", scope: "sub", parameters: [9, 3, 3] });
  assert.equal(registry.adapter("kdj-analysis").id, "kdj-analysis");
});

test("KDJ mention runs through Registry and Coordinator into a standard execution plan", async () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({
    registry,
    modelRegistry: { async analyze() { throw new Error("exact KDJ mention must stay deterministic"); } },
    providerId: "unused",
  });
  const classified = await coordinator.classify("kdj-analysis", { text: "@指标:KDJ" });
  assert.equal(classified.request.mode, "chart-analysis");
  const result = await coordinator.run("kdj-analysis", { analysisJobId: "kdj-e2e", ...params() });
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "kdj-analysis");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.indicatorId, "kdj");
  assert.equal(result.executionPlan.action, "wait");
  assert.match(result.analysisPlan.report, /^## BTC\/USDT 币安永续 1H/m);
});

test("KDJ card, Chinese metadata, pane, reference lines and both icon themes are wired", async () => {
  const [renderer, indicators, market, css, skill, rules, metadata] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-indicators.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/kdj-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/kdj-analysis/references/rules.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/kdj-analysis/agents/openai.yaml", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /trading-indicator-icon-kdj/);
  assert.match(renderer, /data-trading-indicator-icon="kdj-analysis"/);
  assert.match(renderer, /ensureTradingExpertChartIndicatorVisible\(strategy\.chartIndicator\)/);
  assert.match(indicators, /if \(id === "kdj"\)[\s\S]*value: 80[\s\S]*value: 50[\s\S]*value: 20/);
  assert.match(market, /id === "rsi" \|\| id === "kdj" \? -16 : -8/);
  assert.match(market, /strictlyAscendingTradingIndicatorPathPoints\(drawing\.points\)/);
  assert.match(css, /\.trading-indicator-icon-kdj/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-kdj/);
  assert.match(metadata, /display_name: "KDJ"/);
  assert.match(metadata, /short_description: "分析KDJ金叉死叉、超买超卖、钝化状态与背离形态并生成条件执行方案"/);
  assert.doesNotMatch(metadata, /KDJ Analysis|Analyze KDJ/);
  assert.match(`${skill}\n${rules}`, /one second later|一秒/);
  assert.match(`${skill}\n${rules}`, /J = 3K - 2D/);
});
