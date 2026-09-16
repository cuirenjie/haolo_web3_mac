import assert from "node:assert/strict";
import test from "node:test";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runTradingPriceActionAnalysisPipeline } from "../src/main/trading-analysis/price-action-pipeline.mjs";
import { validateTradingDrawingPatch } from "../src/main/trading-analysis/protocol.mjs";

const candles = Array.from({ length: 100 }, (_, index) => {
  const close = 2300 + Math.sin(index / 5) * 20;
  return { time: 1_710_000_000 + index * 3600, open: close - 2, high: close + 5, low: close - 6, close, volume: 1000 + index };
});
const params = { marketId: "BINANCE:FUTURES:ETHUSDT", interval: "60", snapshotTime: 1_800_000_000_000, candles, instruction: "分析当前结构，并绘制真实支撑压力，不执行交易" };

test("primary overload -> DeepSeek max -> schema repair -> grounded price analysis and renderer-valid K-line drawings", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    waitForRecovery: async () => {},
    invoke: async (args) => {
      calls.push(args);
      if (calls.length === 1) return { status: "failed", error: "Selected model is at capacity", retryable: false };
      if (calls.length === 2) return { status: "success", text: "invalid JSON" };
      return { status: "success", text: JSON.stringify({ schemaVersion: 1, verdict: "approve", summary: "价格结构来自已收盘 K 线。", answer: "等待价格触发后再确认。", marketBias: "bullish", rationale: "根据给定行情复核。", confidence: 0.8 }) };
    },
  });
  const result = await runTradingPriceActionAnalysisPipeline(params, { modelRegistry: createTradingAnalysisModelProviderRegistry([provider]), providerId: provider.providerId });
  assert.equal(result.ok, true);
  assert.equal(result.model.modelId, "deepseek-flash");
  assert.equal(result.model.reasoningEffort, "max");
  assert.equal(calls[1].modelProvider, "deepseek");
  assert.equal(calls[2].modelProvider, "deepseek");
  assert.deepEqual(calls.map((c) => [c.modelId, c.reasoningEffort]), [["gpt-5.6-sol", "medium"], ["deepseek-flash", "max"], ["deepseek-flash", "max"]]);
  assert.ok(calls.every((c) => c.request.snapshotId === result.snapshot.snapshotId));
  assert.ok(calls.every((c) => c.request.prompt.startsWith(calls[0].request.prompt)));
  const patch = result.analysisPlan.drawingPatch;
  assert.ok(patch.operations.length >= 3);
  assert.doesNotThrow(() => validateTradingDrawingPatch(patch, params));
  assert.match(result.analysisPlan.report, /支撑|压力/);
  const levels = result.theoryResult.levels;
  for (const key of ["support", "resistance"]) {
    assert.ok(candles.some((c) => [c.open, c.high, c.low, c.close].includes(levels[key])), `${key} must be anchored to source prices`);
    assert.ok(patch.operations.some((op) => op.drawing.points.some((p) => p.price === levels[key])));
  }
});

test("an explicitly selected DeepSeek trading provider starts at max on the correct provider", async () => {
  let request;
  const provider = createAppServerTradingAnalysisProvider({ modelId: "deepseek-flash", invoke: async (args) => { request = args; return { status: "success", text: '{"valid":true}' }; } });
  await provider.analyze({ task: "wave-theory-review", requestId: "review", snapshotId: "candles", prompt: "frozen candles" }, { reasoningEffort: "medium" });
  assert.equal(request.modelProvider, "deepseek");
  assert.equal(request.reasoningEffort, "max");
});
