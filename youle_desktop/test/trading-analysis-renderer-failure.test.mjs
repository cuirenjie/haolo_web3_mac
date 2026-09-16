import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { describeTradingAnalysisFailure, settleTradingAnalysisDrawing } from "../src/main/trading-analysis/failure.mjs";
import { tradingAnalysisModelDisplayName } from "../src/renderer/trading-analysis-model-display.ts";

// Execute the actual renderer orchestration with only its I/O replaced. This
// catches regressions where its outer catch discards a successful model report.
function harness({ language = "zh-CN", modelId = "validated-model", apiError, drawingError, cancelOnDrawing = false } = {}) {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/renderer/trading-expert-market.ts"), "utf8");
  const method = source.slice(source.indexOf("  async runGeneralConversation("), source.indexOf("  async runChanConversation("));
  const javascript = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const market = { id: "BINANCE:FUTURES:SNDKUSDT", provider: "binance", symbol: "SNDKUSDT", baseAsset: "SNDK", quoteAsset: "USDT" };
  const candles = Array.from({ length: 600 }, (_, i) => ({ time: 1_800_000_000 + i * 3600, open: 100, high: 102, low: 99, close: 101, volume: 100 }));
  const state = { active: true, completed: false, apiCalls: 0, drawingCalls: 0, recoveryCalls: 0, failures: [], progress: [] };
  const deps = {
    window: { codexDesktop: { runTradingGeneralAnalysis: async () => {
      state.apiCalls++;
      if (apiError) return { ok: false, error: apiError };
      return { ok: true, model: { modelId }, analysisPlan: { report: "VALIDATED ORIGINAL REPORT", narrative: "VALIDATED ANSWER", drawingPatch: { marketId: market.id, interval: "60" } } };
    } } },
    marketFromFavoriteRecord: (value) => value,
    selectTradingAnalysisInterval: ({ currentInterval }) => currentInterval,
    tradingViewResolutionDurationMs: () => 3_600_000,
    tradingPeriodLabelForResolution: () => "1h",
    tradingAnalysisShouldForceCurrentRefresh: () => false,
    tradingFavoriteRecord: (value) => value,
    activeTradingAnalysisLanguage: () => language,
    tradingAnalysisJobs: {
      start: (job) => job, isActive: () => state.active,
      complete: () => { state.completed = true; state.active = false; }, fail: () => {},
    },
    TRADING_CANDLE_WINDOW_AUTO_EXPANSION_MAX_CANDLES: 2500,
    TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE: "TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA",
    runTradingAnalysisWithAutoExpansion: async ({ initialCandles, analyze }) => {
      await analyze(initialCandles);
      return { candles: initialCandles };
    },
    describeTradingAnalysisFailure, settleTradingAnalysisDrawing, tradingAnalysisModelDisplayName,
    recordTradingRendererFailure: (error, context) => state.failures.push({ error, context }),
    commitTradingAnalysisDrawingPatch: async () => {
      state.drawingCalls++;
      if (cancelOnDrawing) state.active = false;
      if (drawingError) throw drawingError;
    },
    rememberTradingAnalysisJobContext: () => {},
    buildQuestionAlignedTradingLead: () => "",
    tradingAnalysisPaneHeading: () => "SNDK 1h",
    combineTradingAnalysisReports: (_heading, report) => report,
    combineTradingAnalysisNarratives: (_heading, narrative) => narrative,
    buildRecoverableTradingAnalysis: () => { state.recoveryCalls++; throw new Error("Unexpected local fallback"); },
  };
  const Harness = new Function(...Object.keys(deps), `${javascript}; return Harness;`)(...Object.values(deps));
  const workspace = Object.assign(new Harness(), {
    markets: [], loadedMarketId: market.id, loadedInterval: "60",
    drawingStorageSessionMatches: () => true,
    runSplitPaneAnalyses: async () => ({ completed: 0, failed: 0, reports: [], failures: [] }),
  });
  const request = {
    analysisId: "incident-test", instruction: "分析当前盘面", drawingRequested: true,
    analysisTarget: { market, marketId: market.id, symbol: market.symbol, interval: "60", capturedAt: Date.now(), storageSessionId: "task-one", candles, visibleCandles: candles },
    onProgress: (phase, message) => state.progress.push({ phase, message }),
  };
  return { state, run: () => workspace.runGeneralConversation(request) };
}

test("actual renderer retains validated analysis when drawing/storage fails in Chinese and English", async () => {
  for (const language of ["zh-CN", "en"]) {
    const { state, run } = harness({ language, drawingError: new Error("storage quota exceeded") });
    const result = await run();
    assert.match(result.report, /VALIDATED ORIGINAL REPORT/);
    assert.equal(result.modelName, "validated-model");
    assert.equal(result.drawingDeferred, true);
    assert.equal(result.degraded, undefined);
    assert.equal(state.apiCalls, 1);
    assert.equal(state.recoveryCalls, 0);
    assert.equal(state.completed, true);
    assert.equal(state.failures[0].context.stage, "drawing");
    if (language === "en") assert.doesNotMatch(result.report, /\p{Script=Han}/u);
  }
});

test("actual renderer does not bypass membership failure with local candles", async () => {
  const { state, run } = harness({ apiError: { code: "TRADING_ENTITLEMENT_UNAVAILABLE", message: "verification unavailable" } });
  await assert.rejects(run(), (error) => error.code === "TRADING_ENTITLEMENT_UNAVAILABLE");
  assert.equal(state.recoveryCalls, 0);
  assert.equal(state.drawingCalls, 0);
  assert.equal(state.completed, false);
});

test("actual renderer never reports success after cancellation during drawing", async () => {
  const { state, run } = harness({ drawingError: new DOMException("stopped", "AbortError"), cancelOnDrawing: true });
  await assert.rejects(run(), (error) => error.name === "AbortError");
  assert.equal(state.recoveryCalls, 0);
  assert.equal(state.completed, false);
});

test("actual renderer successful drawing remains successful", async () => {
  const { state, run } = harness();
  const result = await run();
  assert.equal(result.report, "VALIDATED ORIGINAL REPORT");
  assert.equal(result.drawingDeferred, false);
  assert.equal(state.failures.length, 0);
  assert.equal(state.completed, true);
});

test("analysis progress and completion expose the display alias for DeepSeek Flash", async () => {
  const { state, run } = harness({ modelId: "deepseek-flash" });
  const result = await run();
  assert.equal(result.modelName, "GPT-6 Astra 大模型");
  assert.equal(result.report, "VALIDATED ORIGINAL REPORT");
  assert.match(state.progress.find(({ phase }) => phase === "drawing").message, /^GPT-6 Astra 大模型 /);
  assert.match(state.progress.find(({ phase }) => phase === "complete").message, /^GPT-6 Astra 大模型 /);
  assert.doesNotMatch(JSON.stringify(state.progress), /deepseek/i);
});

test("display alias never replaces the real model ID in drawing failure diagnostics", async () => {
  const { state, run } = harness({ modelId: "deepseek-flash", drawingError: new Error("storage quota exceeded") });
  const result = await run();
  assert.equal(result.modelName, "GPT-6 Astra 大模型");
  assert.equal(state.failures[0].context.modelId, "deepseek-flash");
  assert.equal(result.drawingDeferred, true);
});
