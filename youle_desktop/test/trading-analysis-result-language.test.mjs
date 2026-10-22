import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { applyAppLanguage } from "../src/renderer/app-language.mjs";
import { combineTradingAnalysisReports, combineTradingAnalysisNarratives } from "../src/renderer/trading-expert-market.ts";
import { executionPlanTextPartitions, executionPlanHasStructuredTradingFields } from "../src/renderer/execution-plans.ts";

const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
const emptySplit = { reports: [], failures: [] };
const genericCompletion = /The (?:market |auxiliary )?analysis is complete\. Review/;

function resultFixture(symbol = "BTCUSDT") {
  return {
    ok: true,
    snapshot: { snapshotId: "language-fixture", marketId: `BINANCE:FUTURES:${symbol}`, interval: "60", snapshotTime: 1_800_000_000_000, inputHash: "language-fixture" },
    theoryResult: { status: "succeeded", evidence: [{ id: "breakout", summary: "Confirmed swing" }], coverage: { candles: "available" }, signals: [{ direction: "bullish", strength: 0.8 }] },
    analysisPlan: {
      analysisId: "language-analysis",
      report: "### Evidence\n\nBuyers lead above 102; invalidation 98.\n\nQuoted strategy: 自定义突破；目标 108。",
      narrative: "Wait for a close above 102. 支撑 98; target 108.",
      actionPlan: { currentPrice: 100, longTrigger: 102, longInvalidation: 98, longTarget: 108, shortTrigger: 99, shortInvalidation: 102, shortTarget: 90, waitZone: { lower: 99, upper: 102 } },
      drawingPatch: { operations: [] },
    },
    model: { providerId: "fixture", modelId: "fixture", latencyMs: 0 },
  };
}

// Use the installed manifests, including their actual Chinese display names.
// Only the engine response is stubbed here; real-engine coverage lives in the
// strategy suites and trading-strategy-analysis-coverage.test.mjs.
for (const strategy of registry.list()) {
  for (const language of ["en", "zh-CN", "zh-TW"]) {
    test(`${strategy.id}/${language}: full and direct results survive coordinator, panes and card parsing`, async () => {
      applyAppLanguage(language);
      const legacy = resultFixture();
      const before = structuredClone(legacy);
      const actualRegistry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS.map((adapter) => ({ ...adapter, run: async () => legacy })) });
      const coordinator = new TradingStrategyCoordinator({ registry: actualRegistry, modelRegistry: { async analyze() { throw Error("Unexpected model call"); } } });
      for (const responseMode of ["full", "direct"]) {
        const result = await coordinator.run(strategy.id, { language, responseMode });
        const report = combineTradingAnalysisReports("BTC/USDT · 1H", result.analysisPlan.report, emptySplit);
        assert.ok(report.includes(legacy.analysisPlan.report), "All evidence and quoted text must survive");
        const narrative = combineTradingAnalysisNarratives("BTC/USDT · 1H", result.analysisPlan.narrative, emptySplit);
        assert.ok(narrative.endsWith(legacy.analysisPlan.narrative), "Structural evidence must remain intact");
        if (responseMode === "full" && strategy.capabilities.includes("execution-plan") && language === "en") {
          assert.match(narrative, /^Original structural assessment/);
          assert.match(report, /Configured price-touch plan/);
        }
        assert.doesNotMatch(report, genericCompletion);
        if (responseMode === "full" && strategy.capabilities.includes("execution-plan")) {
          const cardText = formatExecutionPlanMarkdown(result.executionPlan, { language });
          if (language === "en") {
            assert.match(cardText, /^Strategy: [A-Za-z]/m);
            assert.doesNotMatch(cardText, /\p{Script=Han}/u);
          }
          const cards = executionPlanTextPartitions(report);
          assert.ok(cards?.candidates.length, "A real manifest must produce a visible plan card");
          assert.ok(cards.candidates.every(executionPlanHasStructuredTradingFields));
        }
      }
      assert.deepEqual(legacy, before, "Presentation must not rewrite the engine result");
    });
  }
}

test("English main/auxiliary charts preserve Han symbols, custom names, narrative and failed-pane notes", () => {
  applyAppLanguage("en");
  const report = "## 龙虾/USDT Binance Perpetual 1H\nStrategy: 我的策略\nLong trigger: 0.02850\nStop-loss and invalidation: 0.02700";
  const split = {
    reports: [{ paneIndex: 2, heading: "龙虾/USDT · 4H", report: "Support 支撑: 0.02600", narrative: "Waiting 等待: 0.02600" }],
    failures: [{ paneIndex: 1, heading: "BTC/USDT · 1D" }],
  };
  const combined = combineTradingAnalysisReports("龙虾/USDT · 1H", report, split);
  assert.ok(combined.includes(report));
  assert.ok(combined.includes(split.reports[0].report));
  assert.match(combined, /Auxiliary chart notes/);
  assert.match(combined, /primary analysis and answer remain available/);
  assert.doesNotMatch(combined, genericCompletion);
  const narrative = combineTradingAnalysisNarratives("龙虾/USDT · 1H", "关键价位 0.02850", split);
  assert.match(narrative, /关键价位 0.02850/);
  assert.match(narrative, /Waiting 等待: 0.02600/);
  // Switching language after an analysis must never replace its stored result.
  for (const language of ["zh-CN", "zh-TW", "en"]) {
    applyAppLanguage(language);
    assert.equal(combineTradingAnalysisReports("History", report, emptySplit), report);
  }
});

test("a VPVR result preserves original evidence alongside its configured plan even with Han text", async () => {
  applyAppLanguage("en");
  const legacy = resultFixture();
  legacy.analysisPlan.report = "VPVR: POC 100.25; VAH 102; VAL 98. No entry setup. 成交分布。";
  const actualRegistry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS.map((adapter) => ({ ...adapter, run: async () => legacy })) });
  const coordinator = new TradingStrategyCoordinator({ registry: actualRegistry, modelRegistry: { async analyze() {} } });
  const result = await coordinator.run("vpvr-analysis", { language: "en" });
  assert.ok(combineTradingAnalysisReports("VPVR", result.analysisPlan.report, emptySplit).includes(legacy.analysisPlan.report));
  assert.ok(result.analysisPlan.narrative.endsWith(legacy.analysisPlan.narrative));
  assert.ok(executionPlanTextPartitions(result.analysisPlan.report)?.candidates.length);
});
