import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { englishAnalysisText } from "../src/main/trading-analysis/report-language.mjs";
import { runValidatedTradingModelReview, clearTradingModelReviewCache } from "../src/main/trading-analysis/model-review.mjs";

const local = new Set(["ict-smc", "smt-divergence", "chart-patterns", "price-action", "dow-theory", "gann-theory", "moving-average-analysis", "macd-analysis", "bollinger-bands-analysis", "rsi-analysis", "kdj-analysis", "vpvr-analysis"]);
function params(mode) {
  const candles = Array.from({ length: 300 }, (_, index) => {
    const base = mode === "flat" ? 100 : 100 + Math.sin(index * Math.PI / 10) * 5 + index * 0.015;
    const close = mode === "bearish" ? 210 - base : base;
    const open = close - Math.cos(index * Math.PI / 10) * 0.3;
    return { time: 1_720_000_000 + index * 900, open, close, high: Math.max(open, close) + 0.4, low: Math.min(open, close) - 0.4, volume: 100 + index };
  });
  return { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15", snapshotTime: (candles.at(-1).time + 901) * 1000, candles, contextCandles: [], comparisonMarkets: [{ marketId: "HYPERLIQUID:PERP:ETH", symbol: "ETH", source: "hyperliquid-public", kind: "correlated-market", candles }] };
}

for (const adapter of BUILTIN_TRADING_STRATEGY_ADAPTERS.filter((item) => local.has(item.id))) {
  for (const mode of ["bullish", "bearish", "flat"]) {
    test(`${adapter.id}/${mode}: professional English preserves facts without model access`, async () => {
      const input = params(mode);
      const options = { modelRegistry: { async analyze() { assert.fail("Deterministic localization must not call a model"); } } };
      const original = await adapter.run({ ...input, language: "zh-CN" }, options);
      const result = await adapter.run({ ...input, language: "en" }, options);
      assert.deepEqual(result.theoryResult, original.theoryResult);
      const text = [result.analysisPlan.report, result.analysisPlan.narrative,
        result.analysisPlan.actionPlan?.confirmation || "", result.analysisPlan.actionPlan?.observeTrigger || "",
        ...(result.analysisPlan.drawingPatch?.operations || []).map(({ drawing }) => drawing?.text || ""),
        ...(result.analysisPlan.indicatorDrawingPatch?.operations || []).map(({ drawing }) => drawing?.text || ""),
      ].join("\n");
      const untranslated = text.split("\n").filter((line) => /\p{Script=Han}/u.test(line));
      assert.deepEqual(untranslated, [], untranslated.join("\n"));
      assert.ok(result.analysisPlan.report.length > 300);
      assert.doesNotMatch(text, /The market analysis is complete\. Review/);
      // Numeric facts are retained in the localized report, including tiny prices.
      // English timestamps are UTC ISO strings; Chinese timestamps are local.
      // Timezone conversion changes clock digits, not the underlying event.
      const originalFacts = original.analysisPlan.report.replace(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/g, "");
      for (const number of originalFacts.match(/\d+(?:[,.]\d+)*/g) || []) {
        assert.ok(result.analysisPlan.report.includes(number), `Missing numeric fact ${number}`);
      }
    });
  }
}

test("repeated zones keep every range and touch count, and unknown proper names are retained", () => {
  assert.equal(englishAnalysisText("支撑区 97.165–99.085（5 个触点）；阻力区 107.815–109.735（14 个触点）"), "support zone 97.165–99.085 (5 touches); resistance zone 107.815–109.735 (14 touches)");
  assert.equal(englishAnalysisText("龙虾/USDT · 我的策略 0.02850"), "龙虾/USDT · 我的策略 0.02850");
});

test("model review repairs Chinese prose under English locale and preserves the protocol", async () => {
  clearTradingModelReviewCache();
  const requests = [];
  const result = await runValidatedTradingModelReview({
    modelRegistry: { async analyze(_id, request) {
      requests.push(request);
      return { text: JSON.stringify({ summary: requests.length === 1 ? "等待确认" : "Await a confirmed close above resistance; invalidate below support." }), latencyMs: 0 };
    } }, providerId: "fixture", theoryResult: {},
    request: { requestId: "language-repair", task: "review", language: "en", prompt: "Return JSON with summary. 示例使用中文。" },
    validateResponse: JSON.parse,
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].prompt, /professional financial English/);
  assert.match(requests[1].prompt, /Output language mismatch/);
  assert.equal(result.review.summary, "Await a confirmed close above resistance; invalidate below support.");
});
