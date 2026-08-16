import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computeBollingerBands } from "../src/main/trading-alerts/indicator-registry.mjs";
import {
  calculateBollingerSeries,
  detectBollingerPatterns,
  runBollingerBandsAnalysisEngine,
} from "../src/main/trading-analysis/bollinger-bands-analysis-engine.mjs";
import { runBollingerBandsAnalysisPipeline } from "../src/main/trading-analysis/bollinger-bands-analysis-pipeline.mjs";
import {
  normalizeBollingerBandsAnalysisRequestRoutingModelResponse,
  stripBollingerBandsAnalysisMentionLiteral,
} from "../src/main/trading-analysis/bollinger-bands-analysis-request-router.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";

const START = 1_700_000_000;
const STEP = 3_600;

function candles(count = 160) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 6) * 4 + index * 0.02;
    return { time: START + index * STEP, open: close - 0.2, high: close + 0.8, low: close - 0.8, close, volume: 100 + index };
  });
}

function params(items = candles()) {
  return { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: (items.at(-1).time + STEP) * 1_000, candles: items };
}

function syntheticSeries(length, { upper = 108, middle = 100, lower = 92 } = {}) {
  return {
    upper: Array(length).fill(upper),
    middle: Array(length).fill(middle),
    lower: Array(length).fill(lower),
    bandwidth: Array(length).fill(0.16),
    percentB: Array(length).fill(0.5),
    bandwidthPercentile: Array(length).fill(0.6),
  };
}

test("Bollinger engine reuses the alert BOLL 20/2 formula", () => {
  const items = candles();
  const closes = items.map((item) => item.close);
  const engine = calculateBollingerSeries(items, 20, 2);
  const alert = computeBollingerBands(closes, 20, 2);
  assert.deepEqual(engine.middle, alert.middle);
  assert.deepEqual(engine.upper, alert.upper);
  assert.deepEqual(engine.lower, alert.lower);
  const latest = items.length - 1;
  assert.equal(engine.percentB[latest], (closes[latest] - alert.lower[latest]) / (alert.upper[latest] - alert.lower[latest]));
  assert.equal(engine.bandwidth[latest], (alert.upper[latest] - alert.lower[latest]) / alert.middle[latest]);
});

test("squeeze breakout requires prior low bandwidth and two closed outer-band closes", () => {
  const items = candles(90).map((item) => ({ ...item, open: 100, high: 101, low: 99, close: 100 }));
  const series = syntheticSeries(items.length, { upper: 102, middle: 100, lower: 98 });
  series.bandwidth.fill(0.04);
  series.bandwidthPercentile.fill(0.6);
  series.bandwidth[78] = 0.01;
  series.bandwidthPercentile[78] = 0.1;
  for (const index of [83, 84]) items[index] = { ...items[index], open: 101, high: 104, low: 100, close: 103 };
  series.bandwidth[83] = 0.05;
  series.bandwidth[84] = 0.06;
  const patterns = detectBollingerPatterns(items, series);
  assert.ok(patterns.some((item) => item.kind === "squeeze-breakout" && item.bias === "bullish" && item.confirmationIndex === 84));
});

test("classic M top requires upper-band non-confirmation and a closed neckline break", () => {
  const items = candles(82).map((item) => ({ ...item, open: 100, high: 101, low: 99, close: 100 }));
  items[50] = { ...items[50], high: 110 };
  items[56] = { ...items[56], low: 95 };
  items[62] = { ...items[62], high: 111 };
  items[66] = { ...items[66], open: 100, high: 101, low: 93, close: 94 };
  const series = syntheticSeries(items.length);
  series.upper[50] = 109;
  series.upper[62] = 112;
  const patterns = detectBollingerPatterns(items, series);
  const pattern = patterns.find((item) => item.kind === "m-top");
  assert.equal(pattern?.confirmationIndex, 66);
  assert.equal(pattern?.neckline, 95);
});

test("classic W bottom requires lower-band non-confirmation and a closed neckline break", () => {
  const items = candles(82).map((item) => ({ ...item, open: 100, high: 101, low: 99, close: 100 }));
  items[50] = { ...items[50], low: 90 };
  items[56] = { ...items[56], high: 105 };
  items[62] = { ...items[62], low: 89 };
  items[66] = { ...items[66], open: 100, high: 107, low: 99, close: 106 };
  const series = syntheticSeries(items.length);
  series.lower[50] = 91;
  series.lower[62] = 88;
  const patterns = detectBollingerPatterns(items, series);
  const pattern = patterns.find((item) => item.kind === "w-bottom");
  assert.equal(pattern?.confirmationIndex, 66);
  assert.equal(pattern?.neckline, 105);
});

test("analysis excludes the live candle and succeeds without forcing a pattern", async () => {
  const complete = candles(160);
  const live = { ...complete.at(-1), time: complete.at(-1).time + STEP, open: 100, high: 1_000, low: 1, close: 999 };
  const input = { ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 };
  const result = await runBollingerBandsAnalysisPipeline(input);
  assert.equal(result.theoryResult.excludedLiveCandles, 1);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 1);
  assert.equal(result.analysisPlan.drawingPatch.operations.every((item) => item.drawing.layer === "ai/strategy/bollinger-bands-analysis"), true);
  assert.match(result.analysisPlan.report, /单次触轨不能触发下单/);
  assert.match(result.analysisPlan.report, /已收盘 K 线/);
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const plan = buildExecutionPlanV1(registry.list().find((item) => item.id === "bollinger-bands-analysis"), result);
  assert.equal(plan.action, "wait");
  assert.match(formatExecutionPlanMarkdown(plan), /^## BTC\/USDT 币安永续 1H/m);
  assert.doesNotMatch(formatExecutionPlanMarkdown(plan), /前置条件|确认方式|继续观察|方案有效期|取消执行/);
});

test("a live-only price spike cannot alter the deterministic closed-candle state", () => {
  const complete = candles(140);
  const baselineSnapshot = { ...params(complete), snapshotTime: (complete.at(-1).time + STEP) * 1_000 };
  const live = { time: complete.at(-1).time + STEP, open: 100, high: 1_000, low: 1, close: 999, volume: 1 };
  const withLiveSnapshot = { ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 };
  const baseline = runBollingerBandsAnalysisEngine(baselineSnapshot);
  const withLive = runBollingerBandsAnalysisEngine(withLiveSnapshot);
  assert.deepEqual(withLive.currentState, baseline.currentState);
  assert.deepEqual(withLive.patterns, baseline.patterns);
});

test("Bollinger indicator package is separately registered and requests the native main-chart BOLL", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "bollinger-bands-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "boll", scope: "main", parameters: [20, 2] });
  assert.equal(registry.adapter("bollinger-bands-analysis").id, "bollinger-bands-analysis");
});

test("Bollinger mention routing is strict and preserves explicit market fields", () => {
  assert.equal(stripBollingerBandsAnalysisMentionLiteral("@指标:布林带 帮我分析"), "帮我分析");
  const routed = normalizeBollingerBandsAnalysisRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: "ETHUSDT",
    interval: "60",
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "@指标:布林带 帮我分析", {});
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.symbol, "ETHUSDT");
  assert.equal(routed.request.drawingRequested, true);
});

test("Bollinger Skill card, rules, icon, and both themes are wired", async () => {
  const [renderer, css, skill, rules, manifest] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/bollinger-bands-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/bollinger-bands-analysis/references/rules.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/bollinger-bands-analysis/strategy.json", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /data-trading-indicator-icon="bollinger-bands-analysis"/);
  assert.match(renderer, /ensureTradingExpertChartIndicatorVisible\(strategy\.chartIndicator\)/);
  assert.match(css, /\.trading-indicator-icon-bollinger-bands/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-bollinger-bands/);
  for (const boundary of ["单次触轨", "收盘", "M 顶", "W 底", "BandWidth", "%B"]) assert.match(`${skill}\n${rules}`, new RegExp(boundary));
  assert.match(manifest, /"group": "indicator"/);
  assert.match(manifest, /"scope": "main"/);
});
