import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateMacdSeries, detectMacdClassicPatterns, detectMacdDivergences, macdEma } from "../src/main/trading-analysis/macd-analysis-engine.mjs";
import { buildMacdIndicatorDrawingPatch, runMacdAnalysisPipeline } from "../src/main/trading-analysis/macd-analysis-pipeline.mjs";
import { computeMacd, indicatorEma } from "../src/main/trading-alerts/indicator-registry.mjs";
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

test("MACD engine uses the same 12/26/9 formula as alerts and chart studies", () => {
  const items = candles();
  const closes = items.map((item) => item.close);
  assert.deepEqual(macdEma(closes, 12), indicatorEma(closes, 12));
  const engine = calculateMacdSeries(items);
  const alert = computeMacd(closes, 12, 26, 9);
  assert.deepEqual(engine.dif, alert.dif);
  assert.deepEqual(engine.dea, alert.dea);
  assert.deepEqual(engine.histogram, alert.histogram);
});

test("regular top and bottom divergence require confirmed price pivots", () => {
  const items = Array.from({ length: 24 }, (_, index) => ({ time: START + index * STEP, open: 100, close: 100, high: 101, low: 99, volume: 1 }));
  items[5].high = 110; items[13].high = 116;
  items[6].low = 92; items[16].low = 88;
  const dif = Array(24).fill(0);
  const histogram = Array(24).fill(0);
  dif[5] = 3; dif[13] = 1; histogram[5] = 2; histogram[13] = 0.5;
  dif[6] = -3; dif[16] = -1; histogram[6] = -2; histogram[16] = -0.5;
  const result = detectMacdDivergences(items, { dif, dea: Array(24).fill(0), histogram });
  assert.ok(result.some((item) => item.kind === "regular-bearish"));
  assert.ok(result.some((item) => item.kind === "regular-bullish"));
});

test("the eight classic Chinese MACD combinations are deterministic sequence rules", () => {
  const bars = candles(60);
  const make = (deaValue, difValue) => ({ dif: Array(60).fill(difValue), dea: Array(60).fill(deaValue), histogram: Array(60).fill(difValue - deaValue) });
  const names = new Set();
  const collect = (series) => detectMacdClassicPatterns(bars, series).forEach((item) => names.add(item.name));

  const doubleBelow = make(-1, -1.2);
  for (let i = 20; i < 33; i += 1) doubleBelow.dif[i] = -0.8;
  for (let i = 33; i < 45; i += 1) doubleBelow.dif[i] = -1.2;
  for (let i = 45; i < 60; i += 1) doubleBelow.dif[i] = -0.8;
  doubleBelow.histogram = doubleBelow.dif.map((value) => value + 1);
  collect(doubleBelow);

  const cableCar = make(1, 0.8);
  for (let i = 25; i < 35; i += 1) cableCar.dif[i] = 1.2;
  for (let i = 35; i < 45; i += 1) cableCar.dif[i] = 0.8;
  for (let i = 45; i < 60; i += 1) cableCar.dif[i] = 1.2;
  cableCar.histogram = cableCar.dif.map((value) => value - 1);
  collect(cableCar);

  const cloud = make(0.3, 0.1);
  for (let i = 25; i < 35; i += 1) cloud.dif[i] = 0.5;
  for (let i = 35; i < 45; i += 1) cloud.dif[i] = i < 40 ? 0.2 : -0.1;
  for (let i = 45; i < 60; i += 1) cloud.dif[i] = 0.5;
  cloud.histogram = cloud.dif.map((value) => value - 0.3);
  collect(cloud);

  const rising = make(-0.2, -0.4);
  for (let i = 20; i < 60; i += 1) { rising.dea[i] = -0.05 + (i - 20) * 0.02; rising.dif[i] = rising.dea[i] + 0.16; }
  rising.dif[20] = -0.04;
  for (let i = 42; i < 55; i += 1) rising.dif[i] = rising.dea[i] + Math.max(0.015, 0.16 - (i - 41) * 0.014);
  rising.dif[55] = rising.dea[55] + 0.03; rising.dif[56] = rising.dea[56] + 0.05; rising.dif[57] = rising.dea[57] + 0.08; rising.dif[58] = rising.dea[58] + 0.12; rising.dif[59] = rising.dea[59] + 0.16;
  rising.histogram = rising.dif.map((value, index) => value - rising.dea[index]);
  collect(rising);

  const deep = make(-1, -1.2);
  for (let i = 30; i < 45; i += 1) deep.dif[i] = -0.8;
  for (let i = 45; i < 56; i += 1) deep.dif[i] = -0.98;
  deep.dif[56] = -0.96; deep.dif[57] = -0.9; deep.dif[58] = -0.8; deep.dif[59] = -0.65;
  deep.histogram = deep.dif.map((value) => value + 1);
  collect(deep);

  for (const expected of ["佛手向上", "小鸭出水", "漫步青云", "天鹅展翅", "空中缆绳", "空中缆车", "海底电缆", "海底捞月"]) assert.ok(names.has(expected), `${expected} should be detected`);
});

test("pipeline excludes a live bar, isolates drawings, and returns a conditional plan", async () => {
  const complete = candles(140);
  const live = { ...complete.at(-1), time: complete.at(-1).time + STEP, close: 999, high: 1_000, low: 1 };
  const input = { ...params([...complete, live]), snapshotTime: (live.time + STEP / 2) * 1_000 };
  const result = await runMacdAnalysisPipeline(input);
  assert.equal(result.theoryResult.excludedLiveCandles, 1);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.indicatorId, "macd");
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.layer === "ai/strategy/macd-analysis"), true);
  assert.equal(result.analysisPlan.indicatorDrawingPatch.operations.every((item) => item.drawing.points.every((point) => "value" in point && !("price" in point))), true);
  assert.equal(result.analysisPlan.drawingPatch?.operations.every((item) => (
    ["strategy-entry", "strategy-stop", "strategy-target"].includes(item.drawing.colorToken)
  )) ?? true, true);
  assert.match(result.analysisPlan.report, /八大经典组合形态/);
  assert.match(result.analysisPlan.report, /顶背离|底背离|没有通过/);
  assert.match(result.analysisPlan.report, /MACD 不能单独触发下单/);
});

test("all four divergence kinds use protocol-supported strategy drawing roles", () => {
  const items = candles(40);
  const snapshot = { snapshotId: "macd-divergence-drawing", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", candles: items };
  const divergences = ["regular-bearish", "regular-bullish", "hidden-bearish", "hidden-bullish"].map((kind, index) => ({
    id: `divergence-${index}`,
    kind,
    firstIndex: 10 + index,
    secondIndex: 20 + index,
    priceFirst: items[10 + index].close,
    priceSecond: items[20 + index].close,
    difFirst: index % 2 === 0 ? -2 - index : 2 + index,
    difSecond: index % 2 === 0 ? -1 - index : 1 + index,
    histogramAgrees: true,
  }));
  const divergenceRoles = divergences.map((divergence) => {
    const patch = buildMacdIndicatorDrawingPatch(snapshot, {
      divergences: [divergence],
      patterns: [],
      evidence: [divergence],
      closedCandleCount: items.length,
      series: {
        dif: items.map((_item, index) => index / 10 - 2),
        dea: items.map((_item, index) => index / 12 - 2),
        histogram: items.map((_item, index) => index / 60 - 0.3),
      },
      actionPlan: { longTargets: [], shortTargets: [] },
    });
    return patch.operations.find((item) => item.drawing.tool === "path")?.drawing.colorToken;
  });
  assert.deepEqual(divergenceRoles, [
    "strategy-resistance",
    "strategy-support",
    "strategy-resistance",
    "strategy-support",
  ]);
});

test("indicator drawing protocol accepts zero-axis and negative MACD coordinates", () => {
  const snapshot = { snapshotId: "macd-negative-values", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", candles: candles(10) };
  const patch = validateStrategyIndicatorDrawingPatch({
    schemaVersion: 1,
    analysisId: "macd-negative-values",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    indicatorId: "macd",
    operations: [{
      op: "upsert",
      drawing: {
        id: "negative-divergence",
        strategyId: "macd-analysis",
        theory: "strategy",
        layer: "ai/strategy/macd-analysis",
        tool: "path",
        points: [{ time: START, value: -3.2 }, { time: START + STEP, value: 0 }],
        colorToken: "strategy-support",
        locked: true,
        status: "confirmed",
        evidenceIds: [],
      },
    }],
  }, snapshot, "macd-analysis", "macd");
  assert.deepEqual(patch.operations[0].drawing.points.map((point) => point.value), [-3.2, 0]);
});

test("MACD indicator package is registered separately without changing strategy catalog semantics", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "macd-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "macd", scope: "sub", parameters: [12, 26, 9] });
  assert.equal(registry.adapter("macd-analysis").id, "macd-analysis");
});

test("MACD Skill card, mention catalog, auto pane, and both icon themes are wired", async () => {
  const [renderer, market, css, skill, rules] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/macd-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/macd-analysis/references/rules.md", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /tradingIndicatorCatalog\(\)/);
  assert.match(renderer, /label: "指标"/);
  assert.match(renderer, /@指标:/);
  assert.match(renderer, /ensureTradingExpertChartIndicatorVisible\(strategy\.chartIndicator\)/);
  assert.match(market, /ensureChartIndicatorVisible/);
  assert.match(market, /normalizeTradingIndicatorAiDrawingPatch/);
  assert.match(market, /runtime\.pane\.addSeries\(LineSeries/);
  assert.match(market, /createSeriesMarkers\(runtime\.series\[0\]\.api/);
  assert.match(market, /commitTradingIndicatorAnalysisDrawingPatch/);
  assert.match(css, /\.trading-indicator-icon-macd/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-macd/);
  for (const name of ["佛手向上", "小鸭出水", "漫步青云", "天鹅展翅", "空中缆绳", "空中缆车", "海底电缆", "海底捞月"]) {
    assert.match(`${skill}\n${rules}`, new RegExp(name));
  }
});
