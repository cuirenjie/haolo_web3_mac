import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateVpvrProfile,
  runVpvrAnalysisEngine,
} from "../src/main/trading-analysis/vpvr-analysis-engine.mjs";
import { runVpvrAnalysisPipeline } from "../src/main/trading-analysis/vpvr-analysis-pipeline.mjs";
import { stripVpvrAnalysisMentionLiteral } from "../src/main/trading-analysis/vpvr-analysis-request-router.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { calculateTradingVolumeProfile } from "../src/renderer/trading-volume-profile.ts";

const START = 1_780_000_000;
const STEP = 3_600;

function visibleCandles(count = 72) {
  const items = Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 5) * 7 + Math.sin(index / 13) * 2;
    const clusterWeight = Math.abs(close - 95) < 1.5 || Math.abs(close - 105) < 1.5 ? 5 : 1;
    return {
      time: START + index * STEP,
      open: close - Math.cos(index / 3) * 0.35,
      high: close + 1.4,
      low: close - 1.4,
      close,
      volume: (100 + index * 2) * clusterWeight,
    };
  });
  items[items.length - 1] = {
    ...items.at(-1),
    open: 99.6,
    high: 101.2,
    low: 98.8,
    close: 100,
    volume: 420,
  };
  return items;
}

function params(items = visibleCandles(), developing = false) {
  return {
    analysisJobId: "vpvr-test",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: (items.at(-1).time + (developing ? STEP / 2 : STEP)) * 1_000,
    candles: items,
  };
}

test("VPVR deterministic engine exactly matches the native chart profile allocation", () => {
  const items = visibleCandles();
  const native = calculateTradingVolumeProfile(items, 96, 0.7);
  const engine = calculateVpvrProfile(items, 96, 0.7);
  assert.ok(native);
  assert.equal(engine.rows.length, 96);
  assert.equal(engine.pocIndex, native.pocIndex);
  assert.equal(engine.valueAreaFrom, native.valueAreaFrom);
  assert.equal(engine.valueAreaTo, native.valueAreaTo);
  assert.ok(Math.abs(engine.totalVolume - native.totalVolume) < 1e-8);
  assert.equal(engine.valueAreaShare >= 0.7, true);
  engine.rows.forEach((row, index) => {
    assert.ok(Math.abs(row.volume - native.rows[index].volume) < 1e-8);
    assert.equal(row.valueArea, native.rows[index].valueArea);
    assert.equal(row.poc, native.rows[index].poc);
  });
});

test("VPVR uses the entire visible window and labels a live descriptive candle", async () => {
  const items = visibleCandles(20);
  const result = await runVpvrAnalysisPipeline(params(items, true));
  assert.equal(result.theoryResult.candleCount, 20);
  assert.equal(result.theoryResult.developingCandleCount, 1);
  assert.equal(result.theoryResult.usableVolumeCandleCount, 20);
  assert.match(result.analysisPlan.report, /当前可见窗口的 20 根/);
  assert.match(result.analysisPlan.report, /包含 1 根尚在发展的 K 线/);
});

test("VPVR support and resistance candidates stay on their correct side of current price", () => {
  const result = runVpvrAnalysisEngine(params());
  const current = result.marketInsights.currentPrice;
  assert.equal(result.levels.supports.length > 0, true);
  assert.equal(result.levels.resistances.length > 0, true);
  assert.equal(result.levels.supports.every((level) => level.priceHigh < current), true);
  assert.equal(result.levels.resistances.every((level) => level.priceLow > current), true);
  assert.equal(result.levels.supports.length <= 3 && result.levels.resistances.length <= 3, true);
  const supportPrices = new Set(result.levels.supports.map((level) => level.price));
  assert.equal(result.levels.resistances.some((level) => supportPrices.has(level.price)), false);
});

test("VPVR report contains only support, resistance, and volume-distribution insight domains", async () => {
  const result = await runVpvrAnalysisPipeline(params());
  const report = result.analysisPlan.report;
  assert.match(report, /### 支撑位/);
  assert.match(report, /### 阻力位/);
  assert.match(report, /### VPVR 市场信息/);
  assert.match(report, /POC/);
  assert.match(report, /70% 价值区/);
  assert.match(result.analysisPlan.narrative, /支撑位：/);
  assert.match(result.analysisPlan.narrative, /阻力位：/);
  assert.match(result.analysisPlan.narrative, /VPVR 市场信息：/);
  assert.doesNotMatch(result.analysisPlan.narrative, /标准执行方案|多头触发|空头触发|入场|止损|止盈|仓位|风险收益比|自动下单/);
  assert.doesNotMatch(report, /标准执行方案|多头触发|空头触发|入场|止损|止盈|仓位|风险收益比|自动下单/);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
  assert.equal("longTrigger" in result.analysisPlan.actionPlan, false);
  assert.equal("shortTrigger" in result.analysisPlan.actionPlan, false);
});

test("VPVR drawings are thin dashed support/resistance lines on the main price chart", async () => {
  const result = await runVpvrAnalysisPipeline(params());
  const patch = result.analysisPlan.drawingPatch;
  assert.equal(patch.operations.length > 0, true);
  assert.equal(patch.operations.every((operation) => (
    operation.drawing.strategyId === "vpvr-analysis"
    && operation.drawing.layer === "ai/strategy/vpvr-analysis"
    && operation.drawing.tool === "path"
    && operation.drawing.lineStyle === "dashed"
    && operation.drawing.lineWidth === 0.8
    && operation.drawing.points.length === 2
    && operation.drawing.points[1].time > operation.drawing.points[0].time
    && operation.drawing.points.every((point) => "price" in point && !("value" in point))
  )), true);
  assert.equal(patch.operations.every((operation) => (
    ["strategy-support", "strategy-resistance", "strategy-primary"].includes(operation.drawing.colorToken)
  )), true);
});

test("VPVR mention, manifest, native overlay, and execution-plan opt-out are independently wired", async () => {
  assert.equal(stripVpvrAnalysisMentionLiteral("@指标:VPVR 帮我分析"), "帮我分析");
  assert.equal(stripVpvrAnalysisMentionLiteral("@指标：可见范围成交量分布"), "");
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const manifest = registry.list().find((item) => item.id === "vpvr-analysis");
  assert.equal(manifest.display.group, "indicator");
  assert.deepEqual(manifest.chartIndicator, { id: "vpvr", scope: "main", parameters: [96] });
  assert.equal(manifest.dataRequirements["visible-candles"].required, true);
  assert.equal(manifest.capabilities.includes("execution-plan"), false);
  assert.equal(registry.adapter("vpvr-analysis").id, "vpvr-analysis");

  const coordinator = new TradingStrategyCoordinator({
    registry,
    modelRegistry: { async analyze() { throw new Error("exact VPVR mention must stay deterministic"); } },
    providerId: "unused",
  });
  const classified = await coordinator.classify("vpvr-analysis", { text: "@指标:VPVR" });
  assert.equal(classified.request.mode, "chart-analysis");
  const result = await coordinator.run("vpvr-analysis", params());
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "vpvr-analysis");
  assert.equal(result.executionPlan.action, "wait");
  assert.doesNotMatch(result.analysisPlan.report, /标准执行方案|入场|止损|止盈|仓位/);
});

test("VPVR card and visible-range host path cover both light and dark themes", async () => {
  const [renderer, market, profile, css, coordinator, skill, rules, metadata] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-volume-profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-strategy-runtime/coordinator.mjs", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/vpvr-analysis/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/vpvr-analysis/references/rules.md", import.meta.url), "utf8"),
    readFile(new URL("../resources/trading-strategies/builtins/vpvr-analysis/agents/openai.yaml", import.meta.url), "utf8"),
  ]);
  assert.match(renderer, /trading-indicator-icon-vpvr/);
  assert.match(renderer, /data-trading-indicator-icon="vpvr-analysis"/);
  assert.match(renderer, /visibleCandlesOnly: Boolean\(strategy\.dataRequirements\?\.\["visible-candles"\]\?\.required\)/);
  assert.match(renderer, /executionPlanRequested: strategy\.capabilities\.includes\("execution-plan"\)/);
  assert.match(market, /canvasCandles\.length[\s\S]*canvasCandles\.slice\(-\(visibleCandlesOnly \? 600 : analysisWindowCount\)\)/);
  assert.match(market, /TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE/);
  assert.match(market, /visibleCandlesOnly[\s\S]*desiredCandleCount/);
  assert.match(skill, /tiny visible range is only a starting point/i);
  assert.match(market, /captureSplitPaneAnalysisSnapshots\(\s*requestedLookbackMs,\s*preferredCandles,/);
  assert.match(market, /id: "vpvr"[\s\S]*name: "可见范围成交量分布"/);
  assert.match(profile, /requestedRowCount = 96/);
  assert.match(profile, /requestedValueAreaRatio = 0\.7/);
  assert.match(css, /\.trading-indicator-icon-vpvr/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-indicator-icon-vpvr/);
  assert.match(coordinator, /strategy\.manifest\.capabilities\.includes\("execution-plan"\)/);
  assert.match(metadata, /display_name: "VPVR"/);
  assert.match(metadata, /default_prompt: "使用 \$vpvr-analysis/);
  assert.match(`${skill}\n${rules}`, /70%/);
  assert.match(`${skill}\n${rules}`, /HVN/);
  assert.match(`${skill}\n${rules}`, /LVN/);
});
