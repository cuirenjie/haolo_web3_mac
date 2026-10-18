import {cloudAnalysisWindow} from "../src/renderer/cloud-analysis-window.ts";
import {cloudAnalysisText} from "../src/renderer/cloud-analysis-text.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { describeTradingAnalysisFailure, settleTradingAnalysisDrawing } from "../src/main/trading-analysis/failure.mjs";
import { tradingAnalysisModelDisplayName } from "../src/renderer/trading-analysis-model-display.ts";
import * as expansion from "../src/renderer/trading-expert-wave-expansion.ts";

// Execute the actual renderer orchestration with only its I/O replaced. This
// catches regressions where its outer catch discards a successful model report.
function harness({ language = "zh-CN", modelId = "validated-model", strategyId, wyckoff = false, apiError, drawingError, cancelOnDrawing = false } = {}) {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/renderer/trading-expert-market.ts"), "utf8");
  const ast=ts.createSourceFile("market.ts",source,ts.ScriptTarget.Latest,true);const picked=[];
  const visit=node=>{if(ts.isMethodDeclaration(node)&&["runGeneralConversation","runChanConversation","runWaveConversation","runWyckoffConversation","runOrderFlowConversation"].includes(node.name.getText(ast)))picked.push(node.getText(ast));ts.forEachChild(node,visit);};visit(ast);
  const method=picked.join("\n");
  const javascript = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const market = { id: "BINANCE:FUTURES:SNDKUSDT", provider: "binance", symbol: "SNDKUSDT", baseAsset: "SNDK", quoteAsset: "USDT" };
  const candles = Array.from({ length: 600 }, (_, i) => ({ time: 1_800_000_000 + i * 3600, open: 100, high: 102, low: 99, close: 101, volume: 100 }));
  const state = { active: true, completed: false, apiCalls: 0, drawingCalls: 0, recoveryCalls: 0, failures: [], progress: [] };
  const deps = {
    ...expansion, cloudAnalysisWindow, cloudAnalysisText, cloudReportFromResponse:()=>[],
    window: { codexDesktop: { runTradingGeneralAnalysis: async () => {
      state.apiCalls++;
      if (apiError) return { ok: false, error: apiError };
      return { ok: true, snapshot:{candles}, model: { modelId }, analysisPlan: { report: "VALIDATED ORIGINAL REPORT", narrative: "VALIDATED ANSWER", drawingPatch: { marketId: market.id, interval: "60" } } };
    } } },
    marketFromFavoriteRecord: (value) => value,
    selectTradingAnalysisMarket: () => market,
    visibleCandlesInLogicalRange: (value) => value,
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
    runTradingAnalysisWithAutoExpansion: wyckoff ? expansion.runTradingAnalysisWithAutoExpansion
      : async ({ initialCandles, analyze }) => ({ candles: initialCandles, response: await analyze(initialCandles) }),
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
  deps.window.codexDesktop.runTradingStrategyAnalysis = deps.window.codexDesktop.runTradingGeneralAnalysis;
  deps.window.codexDesktop.runTradingWyckoffAnalysis = deps.window.codexDesktop.runTradingGeneralAnalysis;
  const Harness = new Function(...Object.keys(deps), `${javascript}; return Harness;`)(...Object.values(deps));
  const workspace = Object.assign(new Harness(), {
    markets: [market], loadedMarketId: market.id, loadedInterval: "60",
    selectedMarketId: market.id, selectedSymbol: market.symbol, selectedMarketMeta: market,
    activeInterval: "60", candles, drawingStorageSessionId: "task-one",
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => null, setVisibleRange() {} }) },
    captureSplitPaneAnalysisSnapshots: async () => ({}),
    drawingStorageSessionMatches: () => true,
    runSplitPaneAnalyses: async () => ({ completed: 0, failed: 0, reports: [], failures: [] }),
  });
  const request = {
    analysisId: "incident-test", instruction: "分析当前盘面", drawingRequested: true,
    analysisTarget: { market, marketId: market.id, symbol: market.symbol, interval: "60", capturedAt: Date.now(), storageSessionId: "task-one", candles, visibleCandles: candles },
    onProgress: (phase, message) => state.progress.push({ phase, message }),
  };
  return { state, run: () => wyckoff ? workspace.runWyckoffConversation(request) : workspace.runGeneralConversation(request, strategyId) };
}

test("Wyckoff renderer preserves server insufficiency evidence without local expansion", async () => {
  const { state, run } = harness({ wyckoff: true, apiError: { code: expansion.TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE, message: "No valid range", candleCount:600 } });
  await assert.rejects(run(), (error) => error.code === expansion.TRADING_WYCKOFF_INSUFFICIENT_DATA_CODE && error.candleCount === 600);
  assert.equal(state.apiCalls, 1); // Expansion is owned by the server.
  assert.equal(state.drawingCalls, 0);
  assert.equal(state.recoveryCalls, 0);
  assert.equal(state.completed, false);
});

test("Wyckoff drawing failures preserve the validated strategy report instead of replacing it", async () => {
  for (const language of ["zh-CN", "en"]) {
    const { state, run } = harness({ wyckoff: true, language, drawingError: new Error("storage quota exceeded") });
    const result = await run();
    assert.match(result.report, /VALIDATED ORIGINAL REPORT/);
    assert.equal(result.drawingDeferred, true);
    assert.equal(state.apiCalls, 1);
    assert.equal(state.recoveryCalls, 0);
    assert.equal(state.completed, true);
    assert.equal(state.failures[0].context.strategyId, "wyckoff");
    assert.equal(state.failures[0].context.stage, "drawing");
    if (language === "en") assert.doesNotMatch(result.report, /\p{Script=Han}/u);
  }
});

test("Wyckoff drawing cancellation remains cancelled", async () => {
  const { state, run } = harness({ wyckoff: true, drawingError: new DOMException("stopped", "AbortError"), cancelOnDrawing: true });
  await assert.rejects(run(), (error) => error.name === "AbortError");
  assert.equal(state.completed, false);
  assert.equal(state.recoveryCalls, 0);
});

test("explicit strategies using the shared renderer cannot fall back to local price action", async () => {
  for (const strategyId of ["price-action", "harmonic", "ict-smc", "macd-analysis", "personal:fixture"]) {
    for (const code of ["TRADING_ANALYSIS_MODEL_REVIEW_INVALID", "TRADING_ANALYSIS_MODEL_TIMEOUT", "TRADING_STRATEGY_INSUFFICIENT_DATA"]) {
      const { state, run } = harness({ strategyId, apiError: { code, message: "fixture failure" } });
      await assert.rejects(run(), (error) => error.code === code);
      assert.equal(state.apiCalls, 1);
      assert.equal(state.recoveryCalls, 0, strategyId);
      assert.equal(state.drawingCalls, 0);
      assert.equal(state.completed, false);
    }
  }
});

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
