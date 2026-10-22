import assert from "node:assert/strict";
import test from "node:test";
import { nativeIndicatorPipelines } from "./helpers/native-indicator-pipelines.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { combineTradingAnalysisReports } from "../src/renderer/trading-expert-market.ts";
import { applyAppLanguage } from "../src/renderer/app-language.mjs";
import { executionPlanTextPartitions } from "../src/renderer/execution-plans.ts";

const reviewedStrategies = ["chan", "order-flow", "wave", "wyckoff", "harmonic"];
const localStrategies = [
  "ict-smc", "smt-divergence", "chart-patterns", "price-action", "dow-theory", "gann-theory",
  "moving-average-analysis", "macd-analysis", "bollinger-bands-analysis", "rsi-analysis", "kdj-analysis", "vpvr-analysis",
];
const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });

function marketParams() {
  const candles = Array.from({ length: 300 }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 10) * 5 + index * 0.015;
    const open = close - Math.cos(index * Math.PI / 10) * 0.3;
    return {
      time: 1_720_000_000 + index * 900, open, close,
      high: Math.max(open, close) + 0.4, low: Math.min(open, close) - 0.4,
      volume: 100 + index,
    };
  });
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15",
    snapshotTime: (candles.at(-1).time + 901) * 1_000,
    candles, contextCandles: [],
    comparisonMarkets: [
      { marketId: "HYPERLIQUID:PERP:BTC", symbol: "BTC", source: "hyperliquid-public", kind: "venue-confirmation", candles },
      { marketId: "HYPERLIQUID:PERP:ETH", symbol: "ETH", source: "hyperliquid-public", kind: "correlated-market", candles: candles.map((bar) => ({
        ...bar, open: bar.open * 20, high: bar.high * 20, low: bar.low * 20, close: bar.close * 20,
      })) },
    ],
  };
}

test("every installed built-in is covered by model recovery or model-independent execution tests", () => {
  assert.deepEqual(registry.diagnostics(), []);
  assert.deepEqual(registry.list().map(({ id }) => id).sort(), [...reviewedStrategies, ...localStrategies].sort());
});

for (const strategy of registry.list()) {
  test(`${strategy.id}: explicit strategy analysis skips model intent routing`, async () => {
    let modelCalls = 0;
    const coordinator = new TradingStrategyCoordinator({ registry, providerId: "unavailable", modelRegistry: {
      async analyze() { modelCalls += 1; throw new Error("Model service unavailable"); },
    } });
    const result = await coordinator.classify(strategy.id, { text: `@策略:${strategy.mentions.canonical}` });
    assert.equal(result.ok, true);
    assert.equal(result.request.mode, "chart-analysis");
    assert.equal(modelCalls, 0, "Bare strategy mentions must not wait for another model call");
  });
}

for (const strategyId of localStrategies) {
 for (const language of ["zh-CN", "en", "zh-TW"]) {
  test(`${strategyId}/${language}: model unavailability preserves the strategy's review requirement`, async () => {
    applyAppLanguage(language);
    let modelCalls = 0;
    const coordinator = new TradingStrategyCoordinator({ registry, providerId: "unavailable", modelRegistry: {
      async analyze() { modelCalls += 1; throw new Error("Model service unavailable"); },
    } });
    if (nativeIndicatorPipelines[strategyId]) {
      await assert.rejects(coordinator.run(strategyId, { ...marketParams(), language }), /Model service unavailable/);
      assert.equal(modelCalls, 1, "Combined analysis must not pretend an unavailable model review succeeded");
      return;
    }
    const result = await coordinator.run(strategyId, { ...marketParams(), language });
    assert.equal(result.ok, true);
    assert.equal(result.strategy.id, strategyId);
    assert.equal(result.model.providerId, "deterministic");
    assert.ok(["succeeded", "completed", "developing"].includes(result.theoryResult.status),
      "The fixture must complete a real scan, rather than stop for missing data");
    assert.ok(result.analysisPlan.report.length > 0);
    assert.ok(result.analysisPlan.drawingPatch?.operations.length > 0
      || result.analysisPlan.indicatorDrawingPatch?.operations.length > 0);
    assert.equal(modelCalls, 0);
    const report = combineTradingAnalysisReports("BTC/USDT", result.analysisPlan.report, { reports: [], failures: [] });
    assert.equal(report, result.analysisPlan.report);
    assert.doesNotMatch(report, /The market analysis is complete\. Review/);
    if (registry.get(strategyId).manifest.capabilities.includes("execution-plan")) {
      assert.ok(executionPlanTextPartitions(report)?.candidates.length, "Every real strategy report must keep its plan card");
    }
  });
 }
}
