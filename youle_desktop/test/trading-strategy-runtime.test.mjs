import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { tradingRiskProfileFromEntries } from "../src/main/personal-context/memory-store.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import {
  validateExecutionPlan,
  validateStrategyManifest,
} from "../src/main/trading-strategy-runtime/contracts.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { validateDeclarativeStrategyRules } from "../src/main/trading-strategy-runtime/declarative-rules.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import {
  tradingStrategyRuntimeEnabled,
  tradingStrategyRuntimeMode,
  tradingStrategyShadowMode,
} from "../src/main/trading-strategy-runtime/feature-flags.mjs";
import { createTradingStrategyRegistry, TradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { compileConfirmedStrategyDraft, validateStrategyDraft } from "../src/main/trading-strategy-runtime/strategy-draft.mjs";
import { selectTradingAnalysisInterval } from "../src/renderer/trading-analysis-target.mjs";
import { normalizeTradingAiDrawingPatch } from "../src/renderer/trading-expert-drawing.ts";

const sampleManifest = Object.freeze({
  schemaVersion: 1,
  id: "sample-strategy",
  version: "1.0.0",
  minimumHostVersion: "0.1.164",
  publisher: { id: "haolo", type: "official" },
  display: { name: "示例策略", group: "strategy", sortOrder: 50 },
  mentions: { canonical: "示例策略", aliases: [] },
  implementation: { kind: "builtin-adapter", adapterId: "sample-strategy" },
  capabilities: ["conversation", "chart-analysis", "drawing", "execution-plan"],
  dataRequirements: { candles: { required: true, minCount: 30, minimumCoverage: "available" } },
  drawingPolicyId: "sample-v1",
  executionPlanPolicyId: "standard-v1",
  assets: { skill: "SKILL.md" },
});

function sampleLegacyResult() {
  return {
    ok: true,
    snapshot: {
      snapshotId: "snapshot-sample",
      marketId: "BINANCE:FUTURES:BTCUSDT",
      interval: "60",
      snapshotTime: 1_800_000_000_000,
      inputHash: "sample-input-hash",
    },
    theoryResult: {
      status: "succeeded",
      evidence: [{ id: "evidence-1", summary: "确定性突破候选" }],
      coverage: { candles: "available" },
      signals: [{ direction: "bullish", strength: 0.8 }],
    },
    analysisPlan: {
      analysisId: "analysis-sample",
      report: "原策略报告",
      actionPlan: {
        currentPrice: 100,
        longTrigger: 102,
        longInvalidation: 98,
        longTarget: 108,
        shortTrigger: 96,
        shortInvalidation: 101,
        shortTarget: 90,
        waitZone: { lower: 96, upper: 102 },
        confirmation: "等待一小时 K 线收盘确认",
      },
      drawingPatch: { operations: [] },
    },
    model: { providerId: "stub", modelId: "stub", latencyMs: 1 },
  };
}

test("strategy runtime flags support v1, legacy rollback, per-strategy disable, and shadow mode", () => {
  assert.equal(tradingStrategyRuntimeMode({}), "v1");
  assert.equal(tradingStrategyRuntimeEnabled("chan", {}), true);
  assert.equal(tradingStrategyRuntimeEnabled("chan", { HAOLO_TRADING_STRATEGY_RUNTIME_MODE: "legacy" }), false);
  assert.equal(tradingStrategyRuntimeEnabled("wave", { HAOLO_DISABLED_TRADING_STRATEGIES: "wave, order-flow" }), false);
  assert.equal(tradingStrategyRuntimeEnabled("wyckoff", { HAOLO_DISABLED_TRADING_STRATEGIES: "wave" }), true);
  assert.equal(tradingStrategyRuntimeEnabled("moving-average-demo", {}), true);
  assert.equal(tradingStrategyShadowMode("chan", { HAOLO_TRADING_STRATEGY_RUNTIME_MODE: "shadow" }), true);
});

test("manifest contract fails closed for unknown fields and executable paths", () => {
  assert.equal(validateStrategyManifest(sampleManifest).id, "sample-strategy");
  const preferred = validateStrategyManifest({
    ...sampleManifest,
    dataRequirements: {
      candles: { required: true, minCount: 30, preferredCount: 600, minimumCoverage: "available" },
    },
  });
  assert.equal(preferred.dataRequirements.candles.preferredCount, 600);
  assert.throws(() => validateStrategyManifest({
    ...sampleManifest,
    dataRequirements: {
      candles: { required: true, minCount: 80, preferredCount: 60, minimumCoverage: "available" },
    },
  }), /cannot be smaller/);
  assert.throws(() => validateStrategyManifest({ ...sampleManifest, entrypoint: "./arbitrary.mjs" }), /not supported/);
  assert.throws(() => validateStrategyManifest({
    ...sampleManifest,
    implementation: { kind: "builtin-adapter", adapterId: "sample-strategy", entrypoint: "./arbitrary.mjs" },
  }), /not supported/);
  assert.throws(() => validateStrategyManifest({ ...sampleManifest, schemaVersion: 99 }), /unsupported/);
});

test("built-in registry discovers all valid isolated strategy packages in stable order", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  assert.deepEqual(registry.list().map((strategy) => strategy.id), ["chan", "macd-analysis", "moving-average-analysis", "bollinger-bands-analysis", "order-flow", "ict-smc", "smt-divergence", "rsi-analysis", "wave", "kdj-analysis", "vpvr-analysis", "wyckoff", "harmonic", "chart-patterns", "price-action", "dow-theory", "gann-theory"]);
  assert.deepEqual(registry.list().map((strategy) => strategy.display.name), ["缠论", "MACD", "均线", "布林带", "订单流", "ICT / SMC", "SMT 背离", "RSI", "波浪理论", "KDJ", "VPVR", "威科夫", "谐波形态", "图表形态学", "裸K分析", "道氏理论", "江恩理论"]);
  assert.deepEqual(registry.diagnostics(), []);
  assert.equal(registry.adapter("order-flow").id, "order-flow");
  assert.equal(registry.adapter("harmonic").id, "harmonic");
  assert.equal(registry.adapter("chart-patterns").id, "chart-patterns");
  assert.equal(registry.adapter("price-action").id, "price-action");
  assert.equal(registry.adapter("dow-theory").id, "dow-theory");
  assert.equal(registry.adapter("gann-theory").id, "gann-theory");
  assert.equal(registry.adapter("ict-smc").id, "ict-smc");
  assert.equal(registry.adapter("smt-divergence").id, "smt-divergence");
  assert.equal(registry.adapter("moving-average-analysis").id, "moving-average-analysis");
  assert.equal(registry.adapter("macd-analysis").id, "macd-analysis");
  assert.equal(registry.adapter("rsi-analysis").id, "rsi-analysis");
  assert.equal(registry.adapter("kdj-analysis").id, "kdj-analysis");
  assert.equal(registry.adapter("vpvr-analysis").id, "vpvr-analysis");
});

test("legacy rollback keeps strategies selectable while transparently using compatibility adapters", () => {
  const registry = createTradingStrategyRegistry({
    adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS,
    environment: { HAOLO_TRADING_STRATEGY_RUNTIME_MODE: "legacy" },
  });
  assert.equal(registry.list().every((strategy) => strategy.enabled === true), true);
  assert.equal(registry.list().every((strategy) => /兼容链路/.test(strategy.diagnostic)), true);
});

test("one malformed or duplicate strategy is isolated without disabling valid packages", () => {
  const adapter = {
    id: "sample-strategy",
    routing: { buildPrompt() {}, normalizeResponse() {} },
    async run() {},
  };
  const registry = new TradingStrategyRegistry({
    adapters: [adapter],
    manifestRecords: [
      { manifest: sampleManifest },
      { manifest: { ...sampleManifest, id: "bad id", display: { ...sampleManifest.display, sortOrder: 60 } } },
      { manifest: { ...sampleManifest, id: "duplicate", implementation: { ...sampleManifest.implementation }, display: { ...sampleManifest.display, sortOrder: 70 } } },
    ],
  });
  assert.deepEqual(registry.list().map((strategy) => strategy.id), ["sample-strategy"]);
  assert.equal(registry.diagnostics().length, 2);
});

test("a valid package with a missing implementation remains visible as a diagnosed disabled strategy", () => {
  const unavailableManifest = {
    ...sampleManifest,
    id: "unavailable-strategy",
    display: { name: "不可用策略", group: "strategy", sortOrder: 80 },
    mentions: { canonical: "不可用策略", aliases: [] },
    implementation: { kind: "builtin-adapter", adapterId: "unavailable-strategy" },
  };
  const registry = new TradingStrategyRegistry({ manifestRecords: [{ manifest: unavailableManifest }] });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].enabled, false);
  assert.match(registry.list()[0].diagnostic, /not registered/);
  assert.equal(registry.list({ includeDisabled: false }).length, 0);
  assert.equal(registry.diagnostics().length, 1);
});

test("ExecutionPlanV1 derives prices from deterministic action levels and remains non-ordering", () => {
  const plan = buildExecutionPlanV1(sampleManifest, sampleLegacyResult());
  assert.equal(plan.action, "wait");
  assert.equal(plan.preferredSide, "long");
  assert.deepEqual(plan.scenarios.map((scenario) => scenario.side), ["long", "short"]);
  assert.equal(plan.scenarios[0].trigger.price, 102);
  assert.equal(plan.scenarios[0].stop.price, 98);
  assert.deepEqual(plan.scenarios[0].targets.map((target) => target.price), [104.306, 105.5672, 108]);
  assert.deepEqual(plan.riskReward, [
    { targetIndex: 0, ratio: 0.5 },
    { targetIndex: 1, ratio: 0.8 },
    { targetIndex: 2, ratio: 1.38 },
  ]);
  assert.equal(plan.takeProfits.length, 3);
  assert.deepEqual(plan.takeProfits.map((target) => target.allocationPercent), [33, 33, 34]);
  assert.match(plan.takeProfits[2].price.label, /原策略止盈位/);
  assert.equal(plan.positionSizing.suggestedQuantity, null);
  assert.match(plan.positionSizing.unavailableReason, /账户权益/);
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^## BTC\/USDT 币安永续 1H/m);
  assert.match(markdown, /^当前动作：等待条件触发/m);
  assert.match(markdown, /^方向判断：偏多/m);
  assert.match(markdown, /^多头触发：102/m);
  assert.equal(markdown.split("\n").filter((line) => /^(?:当前动作|方向判断|多头触发|止损与失效|分批止盈|风险收益比)：/.test(line)).length, 6);
  assert.doesNotMatch(markdown, /标准执行方案|^[•*-]\s+/m);
  assert.doesNotMatch(markdown, /前置条件|确认方式|继续观察|方案有效期|取消执行|回踩|反抽/);
  const englishMarkdown = formatExecutionPlanMarkdown(plan, { language: "en" });
  assert.match(englishMarkdown, /^## BTC\/USDT Binance Perpetual 1H/m);
  assert.match(englishMarkdown, /^Current action: Wait for the trigger/m);
  assert.match(englishMarkdown, /^Direction: Bullish/m);
  assert.match(englishMarkdown, /^Long trigger: 102/m);
  assert.match(englishMarkdown, /^Stop-loss and invalidation: 98/m);
  assert.match(englishMarkdown, /^Take-profit targets: Target 1: /m);
  assert.match(englishMarkdown, /^Risk\/reward: /m);
  assert.doesNotMatch(englishMarkdown, /[\u3400-\u9fff]/u);
  assert.deepEqual(validateExecutionPlan(plan), plan);
  const tickNormalized = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), { tickSize: 0.25 });
  assert.equal(tickNormalized.scenarios[0].targets.every((target) => target.price % 0.25 === 0), true);
  assert.equal(tickNormalized.riskReward[0].ratio <= 0.5, true);
  assert.equal(tickNormalized.riskReward[1].ratio <= 0.8, true);
  assert.equal(tickNormalized.takeProfits[2].price.price, 108);
  assert.match(tickNormalized.warnings.join(" "), /tick size 0\.25/);

  const shortResult = sampleLegacyResult();
  shortResult.theoryResult.signals = [{ direction: "bearish", strength: 0.9 }];
  const shortTickNormalized = buildExecutionPlanV1(sampleManifest, shortResult, { tickSize: 0.25 });
  const shortTargets = shortTickNormalized.scenarios.find((item) => item.side === "short").targets;
  assert.equal(shortTargets.length, 3);
  assert.equal(shortTargets[0].price > shortTargets[1].price, true);
  assert.equal(shortTargets[1].price > shortTargets[2].price, true);
  assert.equal(shortTickNormalized.riskReward[0].ratio <= 0.5, true);
  assert.equal(shortTickNormalized.riskReward[1].ratio <= 0.8, true);
  assert.equal(shortTargets[2].price, 90);
});

test("bilateral conditional plans are rendered as independent long and short execution plans", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.theoryResult.signals = [{ direction: "neutral", strength: 0.9 }];
  legacyResult.analysisPlan.actionPlan.primaryBias = "neutral";
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  assert.equal(plan.preferredSide, "neutral");
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^## BTC\/USDT 币安永续 1H · 多头条件方案$/m);
  assert.match(markdown, /^## BTC\/USDT 币安永续 1H · 空头条件方案$/m);
  assert.match(markdown, /多头触发：102/);
  assert.match(markdown, /空头触发：98/);
  assert.equal((markdown.match(/^当前动作：等待条件触发$/gm) || []).length, 2);
  assert.equal((markdown.match(/^方向判断：/gm) || []).length, 2);
  assert.doesNotMatch(markdown, /方向触发：未形成明确单侧方案/);
});

test("ExecutionPlanV1 bounds every long and short trigger to the current price ±2%", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.theoryResult.signals = [{ direction: "neutral", strength: 1 }];
  legacyResult.analysisPlan.actionPlan.primaryBias = "neutral";
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 110,
    longInvalidation: 95,
    longTarget: 115,
    shortTrigger: 85,
    shortInvalidation: 105,
    shortTarget: 80,
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, { currentPrice: 100 });
  const longScenario = plan.scenarios.find((item) => item.side === "long");
  const shortScenario = plan.scenarios.find((item) => item.side === "short");
  assert.equal(longScenario.trigger.price, 102);
  assert.equal(shortScenario.trigger.price, 98);
  assert.ok(Math.abs(longScenario.trigger.price - 100) / 100 <= 0.02);
  assert.ok(Math.abs(shortScenario.trigger.price - 100) / 100 <= 0.02);
  assert.match(plan.warnings.join(" "), /多空触发价距当前价限制在 ±2% 以内/);
  assert.match(formatExecutionPlanMarkdown(plan), /多头触发：102/);
  assert.match(formatExecutionPlanMarkdown(plan), /空头触发：98/);
});

test("ExecutionPlanV1 recognizes nested order-flow bias and signal kinds", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.theoryResult = {
    statistics: { direction: "buying_pressure" },
    marketStructure: { currentBias: "bullish" },
    signals: [{ kind: "bullish_structure", strength: 0.7 }],
  };
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  assert.equal(plan.preferredSide, "long");
  assert.match(formatExecutionPlanMarkdown(plan), /^方向判断：偏多$/m);
});

test("unbound Binance output uses estimated net risk/reward in the requested six-item short plan", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.theoryResult.signals = [{ direction: "bearish", strength: 0.9 }];
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 63_050,
    shortTrigger: 63_007.1,
    shortInvalidation: 63_141.6,
    shortTarget: 62_770.701875,
  });
  const markdown = formatExecutionPlanMarkdown(buildExecutionPlanV1(sampleManifest, legacyResult, {
    userRiskProfile: { minimumRiskRewardRatio: 0.4 },
    binanceAccountContext: { bound: false, available: false, snapshot: null },
  }));
  assert.equal(markdown, [
    "## BTC/USDT 币安永续 1H",
    "",
    "当前动作：等待条件触发",
    "方向判断：偏空",
    "空头触发：63007.1",
    "止损与失效：63141.6",
    "分批止盈：第1目标 62776.88011999，第2目标 62770.701875",
    "风险收益比：目标1为 1:0.4，目标2为 1:0.42",
  ].join("\n"));
});

test("ExecutionPlanV1 finds a product-floor fallback target instead of dropping a low-reward setup", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTarget: 102,
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, {
    currentPrice: 100,
    tickSize: 0.25,
  });
  assert.equal(plan.action, "long");
  assert.ok(plan.takeProfits.length >= 1);
  assert.ok(plan.riskReward.every(({ ratio }) => ratio >= 0.4));
  assert.ok(plan.takeProfits[0].price.price > 102);
  assert.match(plan.takeProfits[0].price.label, /结构风险倍数兜底目标 R0\.4/);
  assert.match(formatExecutionPlanMarkdown(plan), /风险收益比：目标1为 1:0\.4/);

  const stricter = buildExecutionPlanV1(sampleManifest, legacyResult, {
    currentPrice: 100,
    userRiskProfile: { minimumRiskRewardRatio: 1.5 },
  });
  assert.equal(stricter.action, "long");
  assert.equal(stricter.executionBlocked, true);
  assert.match(stricter.marketAssessment, /低于用户设定的最低 1:1\.5/);
});

test("ExecutionPlanV1 honors an explicit minimum below the product default", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTarget: 102,
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, {
    currentPrice: 100,
    tickSize: 0.25,
    userRiskProfile: { minimumRiskRewardRatio: 0.2 },
  });
  assert.equal(plan.action, "long");
  assert.equal(plan.executionBlocked, false);
  assert.equal(plan.positionSizing.minimumRiskRewardRatio, 0.2);
  assert.ok(plan.riskReward.every(({ ratio }) => ratio >= 0.2));
  assert.ok(plan.riskReward.some(({ ratio }) => ratio < 0.4));
  assert.match(plan.preconditions.map((item) => item.text).join("；"), /净盈亏比.*1:0\.2/);
});

test("ExecutionPlanV1 prefers the requested three-target ratio bands when the final strategy target fits", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTargets: [109.2, 112, 114],
    longTarget: 114,
    targetBasis: [
      { price: 109.2, label: "Fib 0.5" },
      { price: 112, label: "Fib 0.8" },
      { price: 114, label: "Fib 1.0" },
    ],
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  assert.deepEqual(plan.riskReward, [
    { targetIndex: 0, ratio: 0.5 },
    { targetIndex: 1, ratio: 0.88 },
    { targetIndex: 2, ratio: 1.35 },
  ]);
  assert.ok(plan.riskReward[0].ratio >= 0.4 && plan.riskReward[0].ratio <= 0.6);
  assert.ok(plan.riskReward[1].ratio >= 0.8 && plan.riskReward[1].ratio <= 1);
  assert.ok(plan.riskReward[2].ratio >= 1.3 && plan.riskReward[2].ratio <= 1.5);
  assert.match(plan.scenarios.find((scenario) => scenario.side === "long").targets[0].label, /优先净盈亏比 1:0\.4–1:0\.6/);
  assert.doesNotMatch(plan.warnings.join(" "), /未落在优先净盈亏比/);
});

test("ExecutionPlanV1 preserves current measured ratios when the preferred third band is unavailable", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTargets: [109.2, 114, 119.9],
    longTarget: 119.9,
    targetBasis: [
      { price: 109.2, label: "Fib 0.5" },
      { price: 114, label: "Fib 1.0" },
      { price: 119.9, label: "Fib 1.5" },
    ],
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  const longScenario = plan.scenarios.find((scenario) => scenario.side === "long");
  assert.deepEqual(longScenario.targets.map((target) => target.price), [109.2, 114, 119.9]);
  assert.ok(plan.riskReward.at(-1).ratio > 1.5);
  assert.match(plan.warnings.join(" "), /未落在优先净盈亏比 1:1\.3–1:1\.5 区间；为保持可执行性，已保留当前策略可用比例/);
});

test("ExecutionPlanV1 fills missing preferred exits when a measured final target is above the third band", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTargets: [119.5],
    longTarget: 119.5,
    targetBasis: [{ price: 119.5, label: "候选结构投影" }],
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  const longScenario = plan.scenarios.find((item) => item.side === "long");
  assert.equal(longScenario.targets.length, 3);
  assert.equal(plan.takeProfits.length, 3);
  assert.ok(plan.riskReward[0].ratio >= 0.4 && plan.riskReward[0].ratio <= 0.6);
  assert.ok(plan.riskReward[1].ratio >= 0.8 && plan.riskReward[1].ratio <= 1);
  assert.ok(plan.riskReward[2].ratio > 1.5);
  assert.match(longScenario.targets[0].label, /优先净盈亏比 1:0\.4–1:0\.6/);
  assert.match(longScenario.targets[1].label, /优先净盈亏比 1:0\.8–1:1/);
  assert.match(plan.warnings.join(" "), /未落在优先净盈亏比 1:1\.3–1:1\.5 区间；为保持可执行性，已保留当前策略可用比例/);
  assert.match(formatExecutionPlanMarkdown(plan), /分批止盈：第1目标 .*，第2目标 .*，第3目标/);

  const shortResult = sampleLegacyResult();
  shortResult.theoryResult.signals = [{ direction: "bearish", strength: 0.9 }];
  Object.assign(shortResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    shortTrigger: 100,
    shortInvalidation: 110,
    shortTargets: [80.5],
    shortTarget: 80.5,
    targetBasis: [{ price: 80.5, label: "候选结构投影" }],
  });
  const shortPlan = buildExecutionPlanV1(sampleManifest, shortResult);
  const shortScenario = shortPlan.scenarios.find((item) => item.side === "short");
  assert.equal(shortScenario.targets.length, 3);
  assert.ok(shortPlan.riskReward[0].ratio >= 0.4 && shortPlan.riskReward[0].ratio <= 0.6);
  assert.ok(shortPlan.riskReward[1].ratio >= 0.8 && shortPlan.riskReward[1].ratio <= 1);
  assert.ok(shortPlan.riskReward[2].ratio > 1.5);

  const compressedResult = sampleLegacyResult();
  Object.assign(compressedResult.analysisPlan.actionPlan, {
    currentPrice: 100,
    longTrigger: 100,
    longInvalidation: 90,
    longTargets: [107],
    longTarget: 107,
    targetBasis: [{ price: 107, label: "候选结构投影" }],
  });
  const compressedPlan = buildExecutionPlanV1(sampleManifest, compressedResult);
  const compressedScenario = compressedPlan.scenarios.find((item) => item.side === "long");
  assert.equal(compressedScenario.targets.length, 2);
  assert.ok(compressedPlan.riskReward[0].ratio >= 0.4 && compressedPlan.riskReward[0].ratio <= 0.6);
  assert.ok(compressedPlan.riskReward[1].ratio >= 0.4);
});

test("ExecutionPlanV1 keeps displayed SOL net risk/reward consistent with its net PnL and gate", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.snapshot.marketId = "BINANCE:FUTURES:SOLUSDT";
  legacyResult.theoryResult.signals = [{ direction: "bearish", strength: 0.9 }];
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 75.22,
    shortTrigger: 74.61,
    shortInvalidation: 75.68,
    shortTarget: 73.005,
  });
  const params = {
    estimatedRoundTripCostRate: 0.002,
    userRiskProfile: {
      maxLossPerTradePercent: 10,
      maxLeverage: 10,
    },
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        marginBalance: 5_000,
        availableBalance: 183.334,
        positions: [],
        warnings: [],
      },
    },
  };
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, params);
  assert.equal(plan.positionSizing.accountPlan.notional, 1_833.34);
  assert.equal(plan.positionSizing.accountPlan.estimatedStopLoss, 29.95);
  assert.equal(plan.positionSizing.accountPlan.estimatedTakeProfit, 24.93);
  assert.deepEqual(plan.riskReward, [
    { targetIndex: 0, ratio: 0.5 },
    { targetIndex: 1, ratio: 0.8 },
    { targetIndex: 2, ratio: 1.19 },
  ]);
  assert.deepEqual(
    plan.positionSizing.accountPlan.targetOrders.map((target) => target.notional),
    [605, 605, 623.33],
  );
  assert.match(
    formatExecutionPlanMarkdown(plan),
    /目标1为 1:0\.5，目标2为 1:0\.8，目标3为 1:1\.19，如果止损：约 -29\.95 USDT，如果全部止盈：约 \+24\.93 USDT/,
  );

  const blocked = buildExecutionPlanV1(sampleManifest, legacyResult, {
    ...params,
    userRiskProfile: {
      ...params.userRiskProfile,
      minimumRiskRewardRatio: 1.5,
    },
  });
  assert.equal(blocked.action, "no_trade");
  assert.deepEqual(blocked.riskReward, [
    { targetIndex: 0, ratio: 0.5 },
    { targetIndex: 1, ratio: 0.8 },
    { targetIndex: 2, ratio: 1.19 },
  ]);
  assert.equal(blocked.takeProfits.length, 3);
  assert.equal(blocked.scenarios.find((item) => item.side === "short").trigger.price, 74.61);
  assert.equal(blocked.positionSizing.accountPlan.estimatedStopLoss, 29.95);
  assert.equal(blocked.positionSizing.accountPlan.estimatedTakeProfit, 24.93);
  assert.match(blocked.marketAssessment, /最终止盈目标.*净盈亏比低于用户设定的最低 1:1\.5/);
  const blockedMarkdown = formatExecutionPlanMarkdown(blocked);
  assert.match(blockedMarkdown, /当前动作：不交易/);
  assert.match(blockedMarkdown, /止损与失效：止损 75\.68/);
  assert.match(blockedMarkdown, /分批止盈：止盈 73\.854205，候选分批测算（不可执行）605 USDT.*止盈 73\.49026，候选分批测算（不可执行）605 USDT.*止盈 73\.005，候选分批测算（不可执行）623\.33 USDT/);
  assert.match(blockedMarkdown, /仓位大小：候选测算 24\.57230934 SOL（不可下单）/);
  assert.doesNotMatch(blockedMarkdown, /推荐下单|推荐仓位|，推荐：/);
  assert.match(blockedMarkdown, /目标1为 1:0\.5，目标2为 1:0\.8，目标3为 1:1\.19，如果止损：约 -29\.95 USDT，如果全部止盈：约 \+24\.93 USDT/);
});

test("ExecutionPlanV1 keeps a reached short action visible when a risk gate blocks execution", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.snapshot.marketId = "BINANCE:FUTURES:MUUSDT";
  legacyResult.theoryResult.signals = [{ direction: "bearish", strength: 1 }];
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 927.44,
    shortTrigger: 927.53435714,
    shortInvalidation: 931.16091214,
    shortTarget: 920.73,
    shortTargets: [920.73, 916.39],
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, {
    currentPrice: 927.44,
    userRiskProfile: { minimumRiskRewardRatio: 2 },
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        marginBalance: 1_000,
        availableBalance: 500,
        positions: [],
        warnings: [],
      },
    },
  });
  assert.equal(plan.preferredSide, "short");
  assert.equal(plan.action, "short");
  assert.equal(plan.executionBlocked, true);
  assert.match(plan.marketAssessment, /当前空头条件已满足，但/);
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^当前动作：现价做空/m);
  assert.match(markdown, /^空头触发：927\.44/m);
  assert.match(markdown, /候选测算（不可执行）/);
  assert.doesNotMatch(markdown, /当前动作：不交易/);
});

test("every execution-plan strategy reports a reached short condition as short", () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const executionStrategies = registry.list().filter((strategy) => strategy.capabilities.includes("execution-plan"));
  assert.equal(executionStrategies.length, 16);
  for (const strategy of executionStrategies) {
    const legacyResult = sampleLegacyResult();
    legacyResult.theoryResult.signals = [{ direction: "bearish", strength: 1 }];
    Object.assign(legacyResult.analysisPlan.actionPlan, {
      currentPrice: 95,
      shortTrigger: 96,
      shortInvalidation: 101,
      shortTarget: 90,
    });
    const plan = buildExecutionPlanV1(strategy, legacyResult, {
      currentPrice: 95,
      userRiskProfile: { minimumRiskRewardRatio: 2 },
    });
    assert.equal(plan.action, "short", strategy.id);
    assert.equal(plan.executionBlocked, true, strategy.id);
    assert.match(formatExecutionPlanMarkdown(plan), /^当前动作：现价做空/m, strategy.id);
  }
});

test("ExecutionPlanV1 uses direct price-touch execution and fresh read-only Binance sizing", () => {
  const legacyResult = sampleLegacyResult();
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, {
    currentPrice: 102,
    userRiskProfile: {
      maxLossPerTradePercent: 10,
      maxLeverage: 10,
      minimumRiskRewardRatio: 1.3,
    },
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        marginBalance: 1_000,
        availableBalance: 500,
        positions: [],
        warnings: [],
      },
    },
  });
  assert.equal(plan.action, "long");
  assert.equal(plan.scenarios.find((item) => item.side === "long").conditions[0].id, "long-price-touch");
  assert.match(plan.entry.confirmation[0].text, /价格触达.*即执行/);
  assert.doesNotMatch(plan.entry.confirmation[0].text, /回踩.*确认|反抽.*确认/);
  assert.equal(plan.positionSizing.accountStatus, "available");
  assert.equal(plan.positionSizing.accountPlan.mode, "new_position");
  assert.equal(plan.positionSizing.accountPlan.leverage, 10);
  assert.ok(plan.positionSizing.accountPlan.notional > 0);
  assert.ok(plan.positionSizing.accountPlan.quantity > 0);
  assert.equal(plan.positionSizing.accountPlan.entryPrice, 102);
  assert.ok(plan.positionSizing.accountPlan.estimatedStopLoss <= 100);
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^当前动作：现价做多/m);
  assert.match(markdown, /用 10 倍杠杆开仓 .* USDT 的多单/);
  assert.match(markdown, /挂条件委托 98 市价止损/);
  assert.match(markdown, /挂条件委托 108 市价止盈 .* USDT/);
  assert.match(markdown, /仓位大小：推荐下单 .* BTC；名义金额 .* USDT；10 倍杠杆/);
  assert.match(markdown, /可能盈亏：止损约 -.* USDT；全部止盈约 \+.* USDT/);
  assert.match(markdown, /如果止损：约 -.* USDT，如果全部止盈：约 \+.* USDT/);
});

test("ExecutionPlanV1 caps a live ETH order from the account's actual available balance", () => {
  const legacyResult = sampleLegacyResult();
  Object.assign(legacyResult.analysisPlan.actionPlan, {
    currentPrice: 1_879.93,
    longTrigger: 1_881.57,
    longInvalidation: 1_876.01,
    longTarget: 1_889.91,
  });
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult, {
    userRiskProfile: {
      maxLossPerTradePercent: 10,
      maxLeverage: 10,
      minimumRiskRewardRatio: 0.4,
    },
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        marginBalance: 299.5056,
        availableBalance: 262.8893,
        positions: [],
        warnings: [],
      },
    },
  });
  assert.equal(plan.positionSizing.accountPlan.mode, "new_position");
  assert.equal(plan.positionSizing.accountPlan.availableBalance, 262.88);
  assert.equal(plan.positionSizing.accountPlan.notional, 2_628.89);
  assert.ok(plan.positionSizing.accountPlan.estimatedStopLoss <= 29.95);
  assert.match(formatExecutionPlanMarkdown(plan), /用 10 倍杠杆开仓 2628\.89 USDT 的多单/);
});

test("ExecutionPlanV1 never invents Binance sizing from an unavailable or stale snapshot", () => {
  const stalePlan = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        marginBalance: 1_000,
        availableBalance: 500,
        positions: [],
        warnings: [],
      },
    },
  });
  assert.equal(stalePlan.positionSizing.accountStatus, "unavailable");
  assert.equal(stalePlan.positionSizing.accountPlan, null);
  assert.doesNotMatch(formatExecutionPlanMarkdown(stalePlan), /倍杠杆|USDT 的多单|USDT 的空单|如果止损/);
});

test("ExecutionPlanV1 tells the user to close an opposite Binance position before opening", () => {
  const plan = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date().toISOString(),
        marginBalance: 1_000,
        availableBalance: 500,
        positions: [{
          symbol: "BTCUSDT",
          direction: "SHORT",
          leverage: 5,
          notionalValue: 300,
          markPrice: 100,
        }],
        warnings: [],
      },
    },
  });
  assert.equal(plan.positionSizing.accountPlan.mode, "close_opposite");
  const markdown = formatExecutionPlanMarkdown(plan);
  assert.match(markdown, /^当前动作：先平反向仓位，暂不开新仓/m);
  assert.match(markdown, /先平现有 300 USDT 的空单/);
  assert.doesNotMatch(markdown, /用 .* 倍杠杆开仓/);
});

test("ExecutionPlanV1 manages or reduces an existing same-direction Binance position without adding", () => {
  const accountContext = (notionalValue) => ({
    bound: true,
    available: true,
    snapshot: {
      fetchedAt: new Date().toISOString(),
      marginBalance: 1_000,
      availableBalance: 200,
      positions: [{
        symbol: "BTCUSDT",
        direction: "LONG",
        leverage: 5,
        notionalValue,
        markPrice: 100,
      }],
      warnings: [],
    },
  });
  const managed = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    binanceAccountContext: accountContext(300),
  });
  assert.equal(managed.positionSizing.accountPlan.mode, "manage_existing");
  assert.match(formatExecutionPlanMarkdown(managed), /按现有仓位执行，不重复开仓/);
  assert.doesNotMatch(formatExecutionPlanMarkdown(managed), /倍杠杆开仓/);

  const reduced = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    binanceAccountContext: accountContext(1_000),
  });
  assert.equal(reduced.positionSizing.accountPlan.mode, "reduce_existing");
  assert.ok(reduced.positionSizing.accountPlan.notional < 1_000);
  assert.match(formatExecutionPlanMarkdown(reduced), /^当前动作：先减仓，再按计划管理/m);
});

test("ExecutionPlanV1 deterministically enforces remembered personal risk limits", () => {
  const blocked = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    userRiskProfile: {
      maxLossPerTradePercent: 3,
      maxPositionPercent: 50,
      maxLeverage: 2,
      minimumRiskRewardRatio: 2,
      riskPreference: "conservative",
      entries: [{
        scope: "trading.risk",
        kind: "constraint",
        key: "avoid_weekend_entries",
        value: "周末不开新仓",
        strength: "hard",
      }],
    },
  });
  assert.equal(blocked.action, "no_trade");
  assert.equal(blocked.entry.mode, "conditional");
  assert.equal(blocked.takeProfits.length, 3);
  assert.equal(blocked.positionSizing.maxAccountRiskPercent, 3);
  assert.equal(blocked.positionSizing.maxPositionPercent, 50);
  assert.equal(blocked.positionSizing.maxLeverage, 2);
  assert.equal(blocked.positionSizing.minimumRiskRewardRatio, 2);
  assert.match(blocked.marketAssessment, /最低 1:2/);
  assert.equal(blocked.scenarios.length, 2);
  assert.deepEqual(blocked.riskReward, [
    { targetIndex: 0, ratio: 0.5 },
    { targetIndex: 1, ratio: 0.8 },
    { targetIndex: 2, ratio: 1.38 },
  ]);
  assert.match(blocked.positionSizing.formula, /账户权益 × 3%/);
  assert.match(blocked.positionSizing.formula, /手续费与滑点/);
  assert.match(blocked.positionSizing.formula, /账户权益 × 50%/);
  assert.match(blocked.preconditions.map((item) => item.text).join("；"), /周末不开新仓/);
  assert.match(blocked.preconditions.map((item) => item.text).join("；"), /浮盈达到 1R/);
  assert.match(formatExecutionPlanMarkdown(blocked), /当前动作.*不交易/);

  const explicitlyHigherRisk = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    userRiskProfile: {
      maxLossPerTradePercent: 9,
      // A stale field from an older client must not lower the user's current value.
      absoluteMaxLossPerTradePercent: 3,
      moveStopToBreakEven: true,
      breakEvenTriggerR: 1.5,
    },
  });
  assert.equal(explicitlyHigherRisk.positionSizing.maxAccountRiskPercent, 9);
  assert.match(explicitlyHigherRisk.positionSizing.formula, /账户权益 × 9%/);
  assert.doesNotMatch(explicitlyHigherRisk.preconditions.map((item) => item.text).join("；"), /绝对.*3%/);
  assert.match(explicitlyHigherRisk.preconditions.map((item) => item.text).join("；"), /浮盈达到 1\.5R/);

  const allowed = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    userRiskProfile: { minimumRiskRewardRatio: 1.3 },
  });
  assert.equal(allowed.action, "wait");
  assert.equal(allowed.riskReward[2].ratio, 1.38);
  assert.equal(allowed.takeProfits.length, 3);
});

test("free-form trading preferences flow through canonical memory into deterministic sizing and exits", () => {
  const memoryEntry = (scope, key, value, kind = "preference", strength = "normal") => ({
    scope,
    key,
    value,
    kind,
    strength,
    source: "user_explicit",
  });
  const profile = tradingRiskProfileFromEntries([
    memoryEntry("trading.risk", "max_loss_per_trade_percent", 5, "constraint", "hard"),
    memoryEntry("trading.exit", "preferred_take_profit_percent", 2),
    memoryEntry("trading.exit", "max_take_profit_percent", 10, "constraint", "hard"),
  ]);
  const eth = sampleLegacyResult();
  eth.snapshot.marketId = "BINANCE:FUTURES:ETHUSDT";
  Object.assign(eth.analysisPlan.actionPlan, {
    currentPrice: 2_450,
    longTrigger: 2_462.46,
    longInvalidation: 2_441.5865,
    longTarget: 2_496.7175,
  });
  const account = {
    bound: true,
    available: true,
    snapshot: {
      fetchedAt: new Date().toISOString(),
      marginBalance: 704.76,
      availableBalance: 704.76,
      positions: [],
      warnings: [],
    },
  };
  const plan = buildExecutionPlanV1(sampleManifest, eth, {
    userRiskProfile: profile,
    binanceAccountContext: account,
  });
  assert.equal(plan.positionSizing.maxAccountRiskPercent, 5);
  assert.ok(plan.positionSizing.accountPlan.estimatedStopLoss <= 704.76 * 0.05);
  assert.ok(plan.positionSizing.accountPlan.estimatedStopLoss >= 35.2);
  assert.match(plan.positionSizing.formula, /账户权益 × 5%/);

  const wideTarget = sampleLegacyResult();
  wideTarget.analysisPlan.actionPlan.longTarget = 140;
  const exitPlan = buildExecutionPlanV1(sampleManifest, wideTarget, {
    userRiskProfile: profile,
  });
  const longTargets = exitPlan.scenarios.find((scenario) => scenario.side === "long").targets;
  assert.deepEqual(longTargets.map((target) => target.price), [104.04, 104.306, 112.2]);
  assert.match(longTargets[0].label, /用户偏好 2%/);
  assert.match(longTargets[2].label, /用户最大止盈距离 10%/);

  const legacyConflict = tradingRiskProfileFromEntries([
    memoryEntry("trading.risk", "max_loss_per_trade_percent", 10, "constraint", "hard"),
    memoryEntry("trading.exit", "preferred_stop_loss_percent", 5),
  ]);
  const conflicted = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    userRiskProfile: legacyConflict,
    binanceAccountContext: account,
  });
  assert.equal(conflicted.action, "no_trade");
  assert.equal(conflicted.positionSizing.accountPlan, null);
  assert.match(conflicted.positionSizing.unavailableReason, /口径存在未澄清冲突/);
  assert.match(formatExecutionPlanMarkdown(conflicted), /禁止生成账户仓位/);

  const stopDistanceBlocked = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), {
    userRiskProfile: {
      maxLossPerTradePercent: 5,
      maxStopDistancePercent: 3,
    },
    binanceAccountContext: account,
  });
  assert.equal(stopDistanceBlocked.action, "no_trade");
  assert.equal(stopDistanceBlocked.positionSizing.accountPlan, null);
  assert.match(stopDistanceBlocked.marketAssessment, /止损距离约 3\.92%.*硬上限 3%/);
});

test("ExecutionPlanV1 accepts bounded strategy-owned validity and observation policy without strategy id branches", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.analysisPlan.actionPlan.validityBars = 5;
  legacyResult.analysisPlan.actionPlan.observeTrigger = "只观察已收盘 K 线的结构确认";
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  assert.equal(plan.expiresAt - plan.createdAt, 5 * 60 * 60_000);
  assert.equal(plan.observe[0].text, "只观察已收盘 K 线的结构确认");
});

test("coordinator refreshes private Binance context after analysis before building the execution plan", async () => {
  const sequence = [];
  const adapter = {
    id: "sample-strategy",
    errors: {},
    routing: {
      task: "sample-routing",
      theoryId: "sample",
      buildPrompt: ({ text }) => `route:${text}`,
      normalizeResponse: () => ({
        request: { mode: "chart-analysis", instruction: "分析" },
        classification: { schemaVersion: 1, mode: "chart-analysis", intent: "chart-drawing", confidence: 1 },
      }),
      deterministic: null,
    },
    async run(adapterParams) {
      assert.equal("binanceAccountContext" in adapterParams, false);
      assert.equal("loadBinanceAccountContext" in adapterParams, false);
      sequence.push("analysis");
      const result = sampleLegacyResult();
      result.analysisPlan.report = `### 标准执行方案

• 当前动作：等待
• 方向判断：偏多
• 多头触发：102
• 止损与失效：98
• 分批止盈：108
• 风险收益比：1:1.5

### 原策略分析

原策略报告`;
      return result;
    },
  };
  const registry = new TradingStrategyRegistry({ adapters: [adapter], manifestRecords: [{ manifest: sampleManifest }] });
  const modelRegistry = {
    async analyze() {
      return { text: "{}", providerId: "stub", modelId: "stub", latencyMs: 1 };
    },
  };
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry, providerId: "stub" });
  const classified = await coordinator.classify("sample-strategy", { text: "分析" });
  assert.equal(classified.request.mode, "chart-analysis");
  const result = await coordinator.run("sample-strategy", {
    binanceAccountContext: {
      bound: true,
      available: true,
      snapshot: {
        fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        marginBalance: 1_000,
        availableBalance: 500,
        positions: [],
        warnings: [],
      },
    },
    async loadBinanceAccountContext() {
      assert.deepEqual(sequence, ["analysis"]);
      sequence.push("account-refresh");
      return {
        bound: true,
        available: true,
        snapshot: {
          fetchedAt: new Date().toISOString(),
          marginBalance: 1_000,
          availableBalance: 500,
          positions: [],
          warnings: [],
        },
      };
    },
  });
  assert.deepEqual(sequence, ["analysis", "account-refresh"]);
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "sample-strategy");
  assert.equal(result.executionPlan.action, "wait");
  assert.equal(result.executionPlan.positionSizing.accountStatus, "available");
  assert.equal(result.executionPlan.positionSizing.accountPlan.mode, "new_position");
  assert.match(result.analysisPlan.report, /^## BTC\/USDT 币安永续 1H/m);
  assert.doesNotMatch(result.analysisPlan.report, /标准执行方案|^[•*-]\s+/m);
  assert.match(result.analysisPlan.report, /倍杠杆开仓/);
  assert.match(result.analysisPlan.report, /原策略报告/);

  sequence.length = 0;
  const englishResult = await coordinator.run("sample-strategy", {
    language: "en",
    async loadBinanceAccountContext() {
      assert.deepEqual(sequence, ["analysis"]);
      sequence.push("account-refresh");
      return {
        bound: true,
        available: true,
        snapshot: {
          fetchedAt: new Date().toISOString(),
          marginBalance: 1_000,
          availableBalance: 500,
          positions: [],
          warnings: [],
        },
      };
    },
  });
  assert.match(englishResult.analysisPlan.report, /^## BTC\/USDT Binance Perpetual 1H/m);
  assert.match(englishResult.analysisPlan.report, /open a .* USDT long position with \d+x leverage/);
  assert.doesNotMatch(englishResult.analysisPlan.report, /原策略报告|[\u3400-\u9fff]/u);
});

test("every strategy request uses model-first intent routing with deterministic recovery and literal targets", async () => {
  let modelCalls = 0;
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({
    registry,
    providerId: "intent-provider",
    modelRegistry: {
      async analyze() {
        modelCalls += 1;
        return {
          text: JSON.stringify({
            schemaVersion: 1,
            mode: "chart-analysis",
            intent: "chart-drawing",
            symbol: null,
            interval: null,
            lookbackMs: null,
            lookbackLabel: null,
            confidence: 0.98,
          }),
          providerId: "intent-provider",
          modelId: "intent-model",
          latencyMs: 3,
        };
      },
    },
  });

  const exactIncident = await coordinator.classify("ict-smc", {
    text: "@策略:ICT / SMC 分析SNDK 15min这个盘\r面并绘图，生成交易策略",
    hasCurrentAnalysis: true,
  });
  assert.equal(exactIncident.request.mode, "chart-analysis");
  assert.equal(exactIncident.request.symbol, "SNDKUSDT");
  assert.equal(exactIncident.request.interval, "15");
  assert.equal(exactIncident.request.drawingRequested, true);
  assert.equal(exactIncident.request.instruction, "分析SNDK 15min这个盘面并绘图，生成交易策略");
  assert.equal(exactIncident.classification.source, "model-first-unified-intent");

  const conceptualMention = await coordinator.classify("ict-smc", {
    text: "@策略:ICT/SMC 什么是 FVG",
  });
  assert.equal(conceptualMention.request.mode, "conversation");
  assert.equal(conceptualMention.request.drawingRequested, false);

  const bareKIncident = await coordinator.classify("price-action", {
    text: "@策略:裸K分析 看下走势跟给出开单点位",
    hasCurrentAnalysis: false,
  });
  assert.equal(bareKIncident.request.mode, "chart-analysis");
  assert.equal(bareKIncident.request.instruction, "看下走势跟给出开单点位");
  assert.equal(bareKIncident.request.symbol, null);
  assert.equal(bareKIncident.request.interval, null);

  const dowIncident = await coordinator.classify("dow-theory", {
    text: "@策略:道氏理论 分析下一个小时是多还是空",
    hasCurrentAnalysis: false,
  });
  assert.equal(dowIncident.request.mode, "chart-analysis");
  assert.equal(dowIncident.request.instruction, "分析下一个小时是多还是空");
  assert.equal(dowIncident.request.symbol, null);
  assert.equal(dowIncident.request.interval, null);

  const periodOnlyIncident = await coordinator.classify("chan", {
    text: "@策略:缠论 分析4小时",
    hasCurrentAnalysis: false,
  });
  assert.equal(periodOnlyIncident.request.mode, "chart-analysis");
  assert.equal(periodOnlyIncident.request.instruction, "分析4小时");
  assert.equal(periodOnlyIncident.request.symbol, null);
  assert.equal(periodOnlyIncident.request.interval, "240");
  assert.equal(periodOnlyIncident.request.forecastHorizonMs, null);
  assert.equal(selectTradingAnalysisInterval({
    interval: periodOnlyIncident.request.interval,
    currentInterval: "60",
  }), "240", "the explicit 4H request must not inherit the open 1H chart");

  const enabledStrategies = registry.list({ includeDisabled: false });
  for (const manifest of enabledStrategies) {
    const routed = await coordinator.classify(manifest.id, {
      text: `@策略:${manifest.mentions.canonical} 分析下一个小时是多还是空并给出开单点位`,
      hasCurrentAnalysis: false,
    });
    assert.equal(routed.request.mode, "chart-analysis", manifest.id);
    assert.equal(routed.request.symbol, null, manifest.id);
    assert.equal(routed.request.interval, null, manifest.id);
    assert.equal(routed.request.drawingRequested, true, manifest.id);

    const fourHour = await coordinator.classify(manifest.id, {
      text: `@策略:${manifest.mentions.canonical} 分析4小时`,
      hasCurrentAnalysis: false,
    });
    assert.equal(fourHour.request.mode, "chart-analysis", manifest.id);
    assert.equal(fourHour.request.symbol, null, manifest.id);
    assert.equal(fourHour.request.interval, "240", manifest.id);
    assert.equal(fourHour.request.forecastHorizonMs, null, manifest.id);
    assert.equal(fourHour.request.drawingRequested, true, manifest.id);
  }

  const explicitNoDrawing = await coordinator.classify("ict-smc", {
    text: "@策略:ICT/SMC 分析 BTC 1小时，不要画线",
  });
  assert.equal(explicitNoDrawing.request.mode, "chart-analysis");
  assert.equal(explicitNoDrawing.request.symbol, "BTCUSDT");
  assert.equal(explicitNoDrawing.request.interval, "60");
  assert.equal(explicitNoDrawing.request.drawingRequested, false);
  assert.equal(modelCalls, enabledStrategies.length * 2 + 6);
});

test("model position-management intent survives strategy routing before chart execution", async () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({
    registry,
    providerId: "intent-provider",
    modelRegistry: {
      async analyze() {
        return {
          text: JSON.stringify({
            schemaVersion: 1,
            mode: "chart-analysis",
            intent: "position-management",
            symbol: null,
            interval: null,
            lookbackMs: null,
            lookbackLabel: null,
            confidence: 0.96,
          }),
          providerId: "intent-provider",
          modelId: "intent-model",
          latencyMs: 2,
        };
      },
    },
  });

  const routed = await coordinator.classify("ict-smc", {
    text: "帮我照看这笔仓位",
    hasCurrentAnalysis: false,
  });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.positionManagementRequested, true);
  assert.equal(routed.classification.intent, "position-management");
  assert.equal(routed.classification.source, "model-first-unified-intent");
});

test("strategy intent routing remains available when the model or JSON response is unavailable", async () => {
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({
    registry,
    providerId: "offline",
    modelRegistry: {
      async analyze() {
        throw new Error("provider offline");
      },
    },
  });
  const routed = await coordinator.classify("dow-theory", {
    text: "@策略:道氏理论 分析下一个小时是多还是空",
  });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.symbol, null);
  assert.equal(routed.request.interval, null);
  assert.equal(routed.request.forecastHorizonMs, 3_600_000);
  assert.equal(routed.classification.source, "deterministic-recovery");

  const periodOnly = await coordinator.classify("chan", {
    text: "@策略:缠论 分析4小时",
  });
  assert.equal(periodOnly.request.mode, "chart-analysis");
  assert.equal(periodOnly.request.symbol, null);
  assert.equal(periodOnly.request.interval, "240");
  assert.equal(periodOnly.request.forecastHorizonMs, null);
  assert.equal(periodOnly.classification.source, "deterministic-recovery");
});

const declarativeManifest = Object.freeze({
  schemaVersion: 1,
  id: "moving-average-demo",
  version: "1.0.0",
  minimumHostVersion: "0.1.164",
  publisher: { id: "community-user", type: "community" },
  display: { name: "均线趋势演示", group: "strategy", sortOrder: 900 },
  mentions: { canonical: "均线趋势演示", aliases: [] },
  implementation: { kind: "declarative-v1", rulesAsset: "rules.json" },
  capabilities: ["conversation", "chart-analysis", "drawing", "execution-plan"],
  dataRequirements: { candles: { required: true, minCount: 30, minimumCoverage: "available" } },
  drawingPolicyId: "generic-declarative-v1",
  executionPlanPolicyId: "standard-v1",
  assets: { skill: "SKILL.md", rules: "rules.json" },
});

const declarativeRules = Object.freeze({
  schemaVersion: 1,
  minimumCandles: 30,
  indicators: [
    { id: "fast", type: "sma", source: "close", period: 5 },
    { id: "slow", type: "sma", source: "close", period: 20 },
  ],
  signals: [
    {
      id: "trend-long",
      side: "long",
      label: "快线上穿慢线",
      all: [{
        left: { kind: "indicator", indicatorId: "fast", offset: 0 },
        operator: "gt",
        right: { kind: "indicator", indicatorId: "slow", offset: 0 },
      }],
    },
    {
      id: "trend-short",
      side: "short",
      label: "快线跌破慢线",
      all: [{
        left: { kind: "indicator", indicatorId: "fast", offset: 0 },
        operator: "lt",
        right: { kind: "indicator", indicatorId: "slow", offset: 0 },
      }],
    },
  ],
  levels: { breakoutLookback: 20, invalidationLookback: 10, riskMultiple: 2 },
  drawing: { enabled: true, roles: ["primary", "entry", "stop", "target", "note"] },
});

function declarativeCandles(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.35 + Math.sin(index / 5);
    return {
      time: 1_720_000_000 + index * 3_600,
      open: close - 0.2,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 100 + index,
    };
  });
}

test("a fifth declarative strategy registers, analyzes, draws, and plans without a host adapter branch", async () => {
  const registry = new TradingStrategyRegistry({
    adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS,
    manifestRecords: [{ manifest: declarativeManifest, rules: declarativeRules }],
  });
  assert.deepEqual(registry.list().map((strategy) => strategy.id), ["moving-average-demo"]);
  assert.equal(registry.list()[0].enabled, true);
  assert.equal(registry.adapter("moving-average-demo").kind, "declarative-v1");
  const coordinator = new TradingStrategyCoordinator({
    registry,
    modelRegistry: { async analyze() { throw new Error("declarative routing must not execute a model"); } },
    providerId: "unused",
  });
  const classified = await coordinator.classify("moving-average-demo", { text: "@策略:均线趋势演示 分析当前走势并画线" });
  assert.equal(classified.request.mode, "chart-analysis");
  const result = await coordinator.run("moving-average-demo", {
    analysisJobId: "declarative-analysis",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_800_000_000_000,
    candles: declarativeCandles(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "moving-average-demo");
  assert.equal(result.analysisPlan.drawingPatch.operations[0].drawing.theory, "strategy");
  assert.equal(result.analysisPlan.drawingPatch.operations[0].drawing.layer, "ai/strategy/moving-average-demo");
  assert.equal(result.analysisPlan.drawingPatch.operations[0].drawing.colorToken, "strategy-primary");
  assert.equal(normalizeTradingAiDrawingPatch(result.analysisPlan.drawingPatch)[0].strategyId, "moving-average-demo");
  assert.equal(result.executionPlan.action, "wait");
  assert.equal(result.executionPlan.scenarios.length, 2);
  assert.match(result.analysisPlan.report, /^## BTC\/USDT 币安永续 1H/m);
});

test("generic Drawing Gateway isolates declarative strategy layers and semantic colors", () => {
  const patch = {
    schemaVersion: 1,
    analysisId: "drawing-isolation",
    baseRevision: 0,
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    operations: [{
      op: "upsert",
      drawing: {
        id: "moving-average-demo-entry",
        strategyId: "moving-average-demo",
        symbol: "BINANCE:FUTURES:BTCUSDT",
        interval: "60",
        theory: "strategy",
        layer: "ai/strategy/moving-average-demo",
        tool: "path",
        points: [{ time: 1_720_000_000, price: 100 }, { time: 1_720_003_600, price: 100 }],
        colorToken: "strategy-entry",
        locked: true,
        status: "confirmed",
        evidenceIds: ["trend-long"],
      },
    }],
  };
  assert.equal(normalizeTradingAiDrawingPatch(patch)[0].layer, "ai/strategy/moving-average-demo");
  const crossedLayer = structuredClone(patch);
  crossedLayer.operations[0].drawing.layer = "ai/strategy/other-strategy";
  assert.throws(() => normalizeTradingAiDrawingPatch(crossedLayer), /operation 0 is invalid/);
  const arbitraryColor = structuredClone(patch);
  arbitraryColor.operations[0].drawing.colorToken = "#ff0000";
  assert.throws(() => normalizeTradingAiDrawingPatch(arbitraryColor), /operation 0 is invalid/);
});

test("declarative rules fail closed on future data and unauthorized drawing roles", () => {
  const withFutureOffset = structuredClone(declarativeRules);
  withFutureOffset.signals[0].all[0].left.offset = 1;
  assert.throws(() => validateDeclarativeStrategyRules(withFutureOffset), /offset/);
  const withArbitraryStyle = structuredClone(declarativeRules);
  withArbitraryStyle.drawing.roles.push("javascript-color");
  assert.throws(() => validateDeclarativeStrategyRules(withArbitraryStyle), /semantic role/);
  assert.throws(() => validateStrategyManifest({
    ...declarativeManifest,
    implementation: { kind: "declarative-v1", rulesAsset: "../escape.json" },
  }), /safe package-relative path/);
});

test("natural-language strategy drafts cannot run before ambiguities, defaults, and replay tests are confirmed", () => {
  const baseDraft = {
    schemaVersion: 1,
    draftId: "draft-moving-average-demo",
    source: {
      naturalLanguage: "快线上穿慢线做多，跌破做空，突破后再执行。",
      locale: "zh-CN",
      createdAt: 1_800_000_000_000,
      generator: "haolo-strategy-draft-v1",
    },
    status: "needs-clarification",
    manifest: declarativeManifest,
    rules: declarativeRules,
    fieldSources: {
      "rules.levels.riskMultiple": { type: "system-suggested", rationale: "用户没有说明风险收益倍数" },
    },
    ambiguities: [{ id: "risk-multiple", question: "目标按几倍风险计算？", status: "open" }],
    tests: [{ id: "historical-replay", status: "pending", summary: "等待历史回放" }],
    publication: { visibility: "private" },
  };
  assert.equal(validateStrategyDraft(baseDraft).runnable, false);
  assert.throws(() => compileConfirmedStrategyDraft(baseDraft), /requires clarification/);
  const confirmed = structuredClone(baseDraft);
  confirmed.status = "confirmed";
  confirmed.fieldSources["rules.levels.riskMultiple"].type = "user-confirmed";
  confirmed.ambiguities[0] = { ...confirmed.ambiguities[0], status: "resolved", resolution: "2 倍风险" };
  confirmed.tests[0] = { ...confirmed.tests[0], status: "passed", summary: "固定历史样本回放通过" };
  assert.equal(compileConfirmedStrategyDraft(confirmed).manifest.id, "moving-average-demo");
});

test("strategy runtime and execution plans expose no order-placement or credential path", async () => {
  const sources = await Promise.all([
    "../src/main/trading-strategy-runtime/coordinator.mjs",
    "../src/main/trading-strategy-runtime/execution-plan-builder.mjs",
    "../src/main/trading-strategy-runtime/declarative-adapter.mjs",
    "../src/renderer/trading-strategy-runtime/client.ts",
  ].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /fapi\/v1\/order|placeOrder|createOrder|executeOrder|apiSecret/i);
  assert.match(source, /suggestedQuantity:\s*null/);
});


test("coordinator keeps English analysis alongside cards and direct position answers without cards", async () => {
  const report = "### Market evidence\n\nReduce exposure if support at 98 fails.";
  const adapter = {
    id: "sample-strategy",
    errors: {},
    routing: {},
    async run() {
      const result = sampleLegacyResult();
      result.analysisPlan.report = report;
      result.analysisPlan.narrative = "Support is holding at 98.";
      return result;
    },
  };
  const registry = new TradingStrategyRegistry({ adapters: [adapter], manifestRecords: [{ manifest: sampleManifest }] });
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry: { async analyze() { throw new Error("Unexpected model call"); } }, providerId: "stub" });
  const full = await coordinator.run("sample-strategy", { language: "en" });
  assert.match(full.analysisPlan.report, /^## BTC\/USDT Binance Perpetual 1H/m);
  assert.ok(full.analysisPlan.report.includes(report));
  assert.doesNotMatch(full.analysisPlan.report, /[\u3400-\u9fff]/u);
  const direct = await coordinator.run("sample-strategy", { language: "en", responseMode: "direct", positionManagementRequested: true });
  assert.equal(direct.analysisPlan.report, report);
  assert.equal(direct.analysisPlan.narrative, "Support is holding at 98.");
});
