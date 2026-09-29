import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { describeTradingAnalysisFailure } from "../src/main/trading-analysis/failure.mjs";
import { isRetryableModelTransportError } from "../src/main/model-transport-recovery.mjs";

const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("trading-expert-market.ts", source, ts.ScriptTarget.Latest, true);
const methods = ["runGeneralConversation", "runChanConversation", "runWaveConversation", "runWyckoffConversation", "runOrderFlowConversation"];
const calls = new Map(methods.map((name) => [name, []]));
function collect(node, method) {
  if (ts.isMethodDeclaration(node)) method = node.name.getText(parsed);
  if (calls.has(method) && ts.isCallExpression(node) && node.expression.getText(parsed) === "api") {
    calls.get(method).push(node.arguments[0].getText(parsed));
  }
  ts.forEachChild(node, (child) => collect(child, method));
}
collect(parsed);

// Execute each real IPC payload expression with fixture market data, including
// every auxiliary pane. This covers the renderer boundary that provider-only
// tests miss, without loading Electron or making paid model requests.
for (const [method, payloads] of calls) {
  test(`${method} preserves the selected model on the main chart and split panes`, async () => {
    assert.equal(payloads.length, 2, "Expected a primary and a split-pane request");
    for (const selection of [
      { model: "gpt-6-sol", modelProvider: "haolo_ai" },
      { modelId: "gpt-6-astra", modelProvider: "haolo_ai" },
      { model: "deepseek-flash", modelProvider: "deepseek" },
    ]) {
      for (const [index, payload] of payloads.entries()) {
        const candles = [{ time: 1_800_000_000, open: 100, high: 102, low: 99, close: 101, volume: 100 }];
        const context = {
          request: { ...selection, instruction: "分析当前盘面", drawingRequested: true },
          job: { analysisId: "test-analysis", marketId: "BTCUSDT", interval: "60", language: "zh-CN" },
          snapshot: { paneIndex: 1, market: { id: "ETHUSDT", symbol: "ETHUSDT", marketType: "perpetual" }, interval: "15", candles },
          candles, analysisCandles: candles, analysisSnapshotTime: Date.now(), snapshotTime: Date.now(),
          directResponseRequested: false, requestedLookbackMs: null,
          contextCandles: [], contextCandlesPromise: Promise.resolve([]),
          comparisonMarkets: [], comparisonMarketsPromise: Promise.resolve([]),
          waveDegreeContextsPromise: Promise.resolve([]),
          fetchTradingWaveDegreeContexts: async () => [],
          getCurrentAppLanguage: () => "zh-CN",
          tradingWaveContextEndTime: (_candles, _interval, now) => now,
          orderFlow: {}, splitOrderFlow: {}, splitContextCandles: [],
        };
        const javascript = ts.transpileModule(`async function payload() { return (${payload}); }`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const result = await new Function(...Object.keys(context), `${javascript}; return payload();`)(...Object.values(context));
        assert.equal(result.model, selection.model, `${method} call ${index} model`);
        assert.equal(result.modelId, selection.modelId, `${method} call ${index} modelId`);
        assert.equal(result.modelProvider, selection.modelProvider, `${method} call ${index} provider`);
        assert.equal(result.reasoningEffort, "max", `${method} call ${index} effort`);
      }
    }
  });
}

const unsupportedMessage = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";

test("ChatGPT account model denial is terminal through WebSocket wrappers", () => {
  for (const error of [
    { message: unsupportedMessage, type: "websocket_error", status: 101 },
    { code: "STREAM_DISCONNECTED", retryable: true, cause: { error: { message: unsupportedMessage } } },
    { code: "TRADING_ANALYSIS_APP_SERVER_FAILED", retryable: true, message: unsupportedMessage },
  ]) {
    assert.equal(isRetryableModelTransportError(error), false);
    for (const language of ["zh-CN", "en"]) {
      const failure = describeTradingAnalysisFailure(error, { language });
      assert.equal(failure.category, "model_unavailable");
      assert.equal(failure.allowLocalRecovery, false);
      assert.doesNotMatch(failure.summary, /ChatGPT account|gpt-6-sol/);
    }
  }
});

test("GPT-6 account denial does not invoke a backup model or activate recovery", async () => {
  const calls = [];
  const recoveries = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: "gpt-6-sol", modelProvider: "haolo_ai", fixedReasoningEffort: "max",
    invoke: async (params) => {
      calls.push(params.modelId);
      return { status: "failed", error: unsupportedMessage, httpStatus: 101 };
    },
    onRecovery: (event) => recoveries.push(event),
    waitForRecovery: async () => {},
  });
  await assert.rejects(provider.analyze({
    schemaVersion: 1, requestId: "denied-model", task: "price-action-review-and-drawing-plan",
    theoryId: "price_action", snapshotId: "fixture", prompt: "{}", responseFormat: "json",
  }), (error) => error.message === unsupportedMessage);
  assert.deepEqual(calls, ["gpt-6-sol"]);
  assert.deepEqual(recoveries, []);
});
