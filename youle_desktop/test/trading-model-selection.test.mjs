import test from "node:test";
import assert from "node:assert/strict";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import {
  GPT_6_ASTRA_MODEL,
  GPT_6_SOL_MODEL,
} from "../src/main/model-membership-policy.mjs";

const request = {
  schemaVersion: 1,
  requestId: "model-selection-test",
  task: "price-action-review-and-drawing-plan",
  theoryId: "price_action",
  snapshotId: "snapshot-1",
  prompt: "{}",
  responseFormat: "json",
};

test("Trading analysis sends the selected GPT-6 model through Haolo AI at max", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: GPT_6_SOL_MODEL,
    modelProvider: "haolo_ai",
    invoke: async (params) => {
      calls.push(params);
      return { status: "success", text: "{\"ok\":true}" };
    },
    fixedReasoningEffort: "max",
  });

  const result = await provider.analyze(request, { reasoningEffort: "low" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].modelId, GPT_6_SOL_MODEL);
  assert.equal(calls[0].modelProvider, "haolo_ai");
  assert.equal(calls[0].reasoningEffort, "max");
  assert.equal(result.modelId, GPT_6_SOL_MODEL);
  assert.equal(result.reasoningEffort, "max");
});

test("Astra selection remains a distinct request model", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: GPT_6_ASTRA_MODEL,
    modelProvider: "haolo_ai",
    invoke: async (params) => {
      calls.push(params);
      return { status: "success", text: "{\"ok\":true}" };
    },
    fixedReasoningEffort: "max",
  });

  await provider.analyze(request, { reasoningEffort: "medium" });
  assert.equal(calls[0].modelId, GPT_6_ASTRA_MODEL);
  assert.equal(calls[0].reasoningEffort, "max");
});

test("GPT-6 failures retain the existing DeepSeek fallback at max", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: GPT_6_ASTRA_MODEL,
    modelProvider: "haolo_ai",
    fixedReasoningEffort: "max",
    waitForRecovery: async () => {},
    invoke: async (params) => {
      calls.push(params);
      return calls.length === 1
        ? { status: "failed", code: "server_is_overloaded", error: "server is overloaded" }
        : { status: "success", text: "{}" };
    },
  });
  const result = await provider.analyze(request);
  assert.deepEqual(calls.map(({ modelId, modelProvider, reasoningEffort }) => ({ modelId, modelProvider, reasoningEffort })), [
    { modelId: GPT_6_ASTRA_MODEL, modelProvider: "haolo_ai", reasoningEffort: "max" },
    { modelId: "deepseek-flash", modelProvider: "deepseek", reasoningEffort: "max" },
  ]);
  assert.equal(result.modelId, "deepseek-flash");
});

test("concurrent intent routing keeps each request's selected model registry", async () => {
  const calls = [];
  const registryFor = (modelId) => ({
    async analyze(providerId, request, options) {
      calls.push({ modelId, providerId, effort: options.reasoningEffort });
      await Promise.resolve();
      return { text: "{}", providerId, modelId, latencyMs: 0 };
    },
  });
  const coordinator = new TradingStrategyCoordinator({
    registry: {
      require: () => ({ manifest: { id: "sample-strategy", name: "测试策略" } }),
      adapter: () => ({}),
    },
    modelRegistry: { analyze: () => assert.fail("Default registry must not replace the selected model") },
    providerId: "haolo-ai-test",
  });
  await Promise.all([GPT_6_SOL_MODEL, GPT_6_ASTRA_MODEL].map((modelId) =>
    coordinator.classify("sample-strategy", { text: "分析当前走势" }, { modelRegistry: registryFor(modelId) }),
  ));
  assert.deepEqual(calls, [GPT_6_SOL_MODEL, GPT_6_ASTRA_MODEL].map((modelId) => ({
    modelId, providerId: "haolo-ai-test", effort: "max",
  })));
});
