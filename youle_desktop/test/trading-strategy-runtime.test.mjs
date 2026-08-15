import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(plan.scenarios[0].targets[0].price, 108);
  assert.equal(plan.positionSizing.suggestedQuantity, null);
  assert.match(plan.positionSizing.unavailableReason, /账户权益/);
  assert.match(formatExecutionPlanMarkdown(plan), /标准执行方案/);
  assert.deepEqual(validateExecutionPlan(plan), plan);
  const tickNormalized = buildExecutionPlanV1(sampleManifest, sampleLegacyResult(), { tickSize: 0.25 });
  assert.equal(tickNormalized.scenarios[0].trigger.price % 0.25, 0);
  assert.match(tickNormalized.warnings.join(" "), /tick size 0\.25/);
});

test("ExecutionPlanV1 accepts bounded strategy-owned validity and observation policy without strategy id branches", () => {
  const legacyResult = sampleLegacyResult();
  legacyResult.analysisPlan.actionPlan.validityBars = 5;
  legacyResult.analysisPlan.actionPlan.observeTrigger = "只观察已收盘 K 线的结构确认";
  const plan = buildExecutionPlanV1(sampleManifest, legacyResult);
  assert.equal(plan.expiresAt - plan.createdAt, 5 * 60 * 60_000);
  assert.equal(plan.observe[0].text, "只观察已收盘 K 线的结构确认");
});

test("coordinator preserves legacy results while adding a validated execution plan", async () => {
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
    async run() {
      return sampleLegacyResult();
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
  const result = await coordinator.run("sample-strategy", {});
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "sample-strategy");
  assert.equal(result.executionPlan.action, "wait");
  assert.match(result.analysisPlan.report, /标准执行方案/);
  assert.match(result.analysisPlan.report, /原策略报告/);
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
  assert.match(result.analysisPlan.report, /标准执行方案/);
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
