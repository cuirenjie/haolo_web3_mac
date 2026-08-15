import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateRsiSeries, detectRsiDivergences, detectRsiFailureSwings, runRsiAnalysisEngine } from "../src/main/trading-analysis/rsi-analysis-engine.mjs";
import { buildRsiIndicatorDrawingPatch, runRsiAnalysisPipeline } from "../src/main/trading-analysis/rsi-analysis-pipeline.mjs";
import { stripRsiAnalysisMentionLiteral } from "../src/main/trading-analysis/rsi-analysis-request-router.mjs";
import { computeRsi } from "../src/main/trading-alerts/indicator-registry.mjs";
import { validateStrategyIndicatorDrawingPatch } from "../src/main/trading-analysis/protocol.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";

const START = 1_700_000_000;
const STEP = 3_600;

function candles(count = 140) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 5) * 7 + index * 0.03;
    return { time: START + index * STEP, open: close - 0.2, high: close + 0.8, low: close - 0.8, close, volume: 100 + index };
  });
}

function params(items = candles()) {
  return { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: (items.at(-1).time + STEP) * 1_000, candles: items };
}

test("RSI engine uses the same Wilder RSI(14) formula as alerts and the native chart pane", () => {
  const items = candles();
  assert.deepEqual(calculateRsiSeries(items, 14), computeRsi(items.map((item) => item.close), 14));
  assert.equal(calculateRsiSeries(items, 14).every((value) => !Number.isFinite(value) || (value >= 0 && value <= 100)), true);
});

test("regular and hidden RSI divergences require confirmed price pivots and material RSI separation", () => {
  const items = Array.from({ length: 28 }, (_, index) => ({ time: START + index * STEP, open: 100, close: 100, high: 101, low: 99, volume: 1 }));
  items[5].high = 110; items[13].high = 116;
  items[6].low = 92; items[16].low = 88;
  const rsi = Array(28).fill(50);
  rsi[5] = 76; rsi[13] = 67;
  rsi[6] = 24; rsi[16] = 34;
  const result = detectRsiDivergences(items, rsi);
  assert.ok(result.some((item) => item.kind === "regular-bearish"));
  assert.ok(result.some((item) => item.kind === "regular-bullish"));
  assert.equal(result.every((item) => item.secondIndex <= items.length - 3), true);
});

test("bullish and bearish RSI failure swings require the full four-stage closed sequence", () => {
  const items = candles(30);
  const bullish = Array(30).fill(50);
  [40, 35, 25, 32, 38, 45, 40, 36, 34, 38, 43, 48].forEach((value, offset) => { bullish[3 + offset] = value; });
  const bullishResult = detectRsiFailureSwings(items, bullish);
  assert.ok(bullishResult.some((item) => item.bias === "bullish" && item.confirmationIndex === 14));

  const bearish = Array(30).fill(50);
  [60, 65, 75, 68, 62, 55, 60, 64, 66, 62, 57, 52].forEach((value, offset) => { bearish[3 + offset] = value; });
  const bearishResult = detectRsiFailureSwings(items, bearish);
  assert.ok(bearishResult.some((item) => item.bias === "bearish" && item.confirmationIndex === 14));
});

test("an extreme RSI reading alone remains wait/no-trade", () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ time: START + index * STEP, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1 }));
  const result = runRsiAnalysisEngine({ ...params(items) });
  assert.equal(result.currentState.zone, "overbought");
  assert.equal(result.actionPlan.primaryBias, "neutral");
  assert.equal(result.actionPlan.disposition, "wait");
  assert.equal("longTrigger" in result.actionPlan || "shortTrigger" in result.actionPlan, false);
});

test("RSI pipeline excludes a live bar and draws indicator evidence only in the RSI pane", async () => {
  const complete = candles(140);
  const live = { ...complete.at(-1), time: complete.at(-1).time + STEP, close: 999, high: 1_000, low: 1 };
  const result = await runRsiAnalysisPipeline({ ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 });
  assert.equal(result.theoryResult.excludedLiveCandles, 1);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.indicatorId, "rsi");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.layer === "ai/strategy/rsi-analysis"), true);
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.points.every((point) => "value" in point && !("price" in point))), true);
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations
    .filter((item) => item.drawing.tool === "path")
    .every((item) => item.drawing.points.slice(1).every((point, index) => point.time > item.drawing.points[index].time)), true);
  assert.equal(result.analysisPlan.drawingPatch?.operations.every((item) => ["strategy-entry", "strategy-stop", "strategy-target"].includes(item.drawing.colorToken)) ?? true, true);
  assert.match(result.analysisPlan.report, /失败摆动/);
  assert.match(result.analysisPlan.report, /背离/);
  assert.match(result.analysisPlan.report, /RSI 不能单独触发下单/);
});

test("RSI divergence and failure-swing drawings use protocol-supported indicator coordinates", () => {
  const items = candles(40);
  const result = {
    closedCandleCount: items.length,
    series: items.map((_item, index) => 30 + index),
    evidence: [{ id: "evidence" }],
    thresholdEvents: [],
    divergences: [{ id: "rsi-div", kind: "regular-bullish", firstIndex: 10, secondIndex: 20, rsiFirst: 24, rsiSecond: 34 }],
    failureSwings: [{ id: "rsi-swing", name: "看涨失败摆动", bias: "bullish", firstIndex: 22, middleIndex: 25, secondIndex: 28, confirmationIndex: 31 }],
  };
  const patch = buildRsiIndicatorDrawingPatch({ snapshotId: "rsi-drawing", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", candles: items }, result);
  assert.equal(patch.indicatorId, "rsi");
  assert.ok(patch.operations.some((item) => item.drawing.tool === "path" && item.drawing.colorToken === "strategy-support"));
  assert.equal(patch.operations.every((item) => item.drawing.points.every((point) => point.value >= 0 && point.value <= 100)), true);
  const dots = patch.operations.filter((item) => item.drawing.id.endsWith("-dot"));
  const labels = patch.operations.filter((item) => item.drawing.id.endsWith("-label"));
  const leaders = patch.operations.filter((item) => item.drawing.id.endsWith("-leader"));
  assert.equal(dots.length, 2);
  assert.equal(leaders.length, dots.length);
  assert.equal(labels.length, dots.length);
  assert.equal(dots.every((item) => item.drawing.tool === "note" && item.drawing.markerSize === 0.35 && !item.drawing.text), true);
  assert.equal(labels.every((item) => item.drawing.tool === "text" && item.drawing.markerSize === 0 && item.drawing.text), true);
  assert.deepEqual(labels.map((item) => item.drawing.points[0].value), [44, 38]);
  assert.equal(leaders.every((item) => item.drawing.tool === "path" && item.drawing.lineStyle === "dashed" && item.drawing.lineWidth === 0.8), true);
  assert.equal(leaders.every((item) => item.drawing.points.length === 2), true);
  assert.equal(leaders.every((item, index) => {
    const dot = dots[index].drawing.points[0];
    const label = labels[index].drawing.points[0];
    return item.drawing.points[0].time === dot.time
      && item.drawing.points[0].value === dot.value
      && item.drawing.points[1].time === label.time + 1
      && item.drawing.points[1].value === label.value;
  }), true);
  const invalidMarkerPatch = structuredClone(patch);
  invalidMarkerPatch.operations.find((item) => item.drawing.id.endsWith("-dot")).drawing.markerSize = 2.1;
  assert.throws(
    () => validateStrategyIndicatorDrawingPatch(invalidMarkerPatch, { marketId: patch.marketId, interval: patch.interval }, "rsi-analysis", "rsi"),
    /markerSize is invalid/,
  );
  invalidMarkerPatch.operations.find((item) => item.drawing.id.endsWith("-dot")).drawing.markerSize = 0;
  assert.throws(
    () => validateStrategyIndicatorDrawingPatch(invalidMarkerPatch, { marketId: patch.marketId, interval: patch.interval }, "rsi-analysis", "rsi"),
    /markerSize is invalid/,
  );
  invalidMarkerPatch.operations.find((item) => item.drawing.id.endsWith("-dot")).drawing.markerSize = -0.1;
  assert.throws(
    () => validateStrategyIndicatorDrawingPatch(invalidMarkerPatch, { marketId: patch.marketId, interval: patch.interval }, "rsi-analysis", "rsi"),
    /markerSize is invalid/,
  );
});

test("RSI labels occupy descending rows and use non-crossing near-vertical leaders with strictly ascending time", () => {
  const items = candles(60);
  const result = {
    closedCandleCount: items.length,
    series: items.map((_item, index) => 48 + Math.sin(index / 4) * 3),
    evidence: [{ id: "evidence" }],
    divergences: [
      { id: "rsi-div-1", kind: "regular-bullish", firstIndex: 4, secondIndex: 10, rsiFirst: 28, rsiSecond: 34 },
      { id: "rsi-div-2", kind: "regular-bearish", firstIndex: 8, secondIndex: 16, rsiFirst: 72, rsiSecond: 65 },
      { id: "rsi-div-3", kind: "hidden-bullish", firstIndex: 14, secondIndex: 22, rsiFirst: 35, rsiSecond: 30 },
    ],
    failureSwings: [
      { id: "rsi-swing-1", name: "看涨失败摆动", bias: "bullish", firstIndex: 20, middleIndex: 23, secondIndex: 26, confirmationIndex: 29 },
      { id: "rsi-swing-2", name: "看跌失败摆动", bias: "bearish", firstIndex: 28, middleIndex: 31, secondIndex: 34, confirmationIndex: 37 },
    ],
    thresholdEvents: [
      { id: "rsi-threshold-1", index: 41, value: 51, name: "上穿 50 中轴", type: "center-enter" },
      { id: "rsi-threshold-2", index: 45, value: 49, name: "下穿 50 中轴", type: "center-exit" },
      { id: "rsi-threshold-3", index: 49, value: 52, name: "上穿 50 中轴", type: "center-enter" },
    ],
  };
  const patch = buildRsiIndicatorDrawingPatch({ snapshotId: "rsi-label-layout", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", candles: items }, result);
  const labels = patch.operations.filter((item) => item.drawing.id.endsWith("-label"));
  const leaders = patch.operations.filter((item) => item.drawing.id.endsWith("-leader"));
  assert.equal(labels.length, 8);
  assert.deepEqual(labels.map((item) => item.drawing.points[0].value), [44, 38, 32, 26, 20, 44, 38, 32]);
  assert.equal(labels.every((item) => item.drawing.markerSize === 0 && item.drawing.text), true);
  assert.equal(leaders.every((item, index) => {
    const dot = patch.operations.filter((operation) => operation.drawing.id.endsWith("-dot"))[index].drawing.points[0];
    const label = labels[index].drawing.points[0];
    const start = item.drawing.points[0];
    const end = item.drawing.points[1];
    return start.time === dot.time
      && end.time === label.time + 1
      && end.time === start.time + 1
      && end.value === label.value;
  }), true);
});

test("RSI mention routing strips all supported literal forms", () => {
  assert.equal(stripRsiAnalysisMentionLiteral("@指标:RSI 帮我分析"), "帮我分析");
  assert.equal(stripRsiAnalysisMentionLiteral("@指标：相对强弱指标"), "");
});

test("RSI Indicator Skill registers independently with its native sub-pane contract", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "rsi-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "rsi", scope: "sub", parameters: [14] });
  assert.equal(registry.adapter("rsi-analysis").id, "rsi-analysis");
});

test("RSI card, mention catalog, auto pane, centerline and both icon themes are wired", async () => {
  const [renderer, indicators, market, css, skill, rules] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-indicators.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/rsi-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/rsi-analysis/references/rules.md", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /trading-indicator-icon-rsi/);
  assert.match(renderer, /data-trading-indicator-icon="rsi-analysis"/);
  assert.match(renderer, /ensureTradingExpertChartIndicatorVisible\(strategy\.chartIndicator\)/);
  assert.match(indicators, /value: 50, color: "rgba\(123, 135, 151, 0\.45\)"/);
  assert.match(market, /commitTradingIndicatorAnalysisDrawingPatch/);
  assert.match(market, /drawing\.markerSize/);
  assert.match(market, /drawing\.markerSize === 0/);
  assert.match(market, /id === "rsi" \|\| id === "kdj" \? -16 : -8/);
  assert.match(market, /strictlyAscendingTradingIndicatorPathPoints\(drawing\.points\)/);
  assert.match(market, /"atPriceMiddle"/);
  assert.match(css, /\.trading-indicator-icon-rsi/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-rsi/);
  assert.match(`${skill}\n${rules}`, /失败摆动/);
  assert.match(`${skill}\n${rules}`, /hidden bullish|隐藏看涨/);
});
