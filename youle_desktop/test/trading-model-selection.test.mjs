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

test("Trading analysis preserves selected GPT-6 display while executing DeepSeek low", async () => {
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
  assert.equal(calls[0].modelId, "deepseek-flash");
  assert.equal(calls[0].modelProvider, "deepseek");
  assert.equal(calls[0].reasoningEffort, "low");
  assert.equal(result.modelId, GPT_6_SOL_MODEL);
  assert.equal(result.reasoningEffort, "low");
});

test("Astra selection uses DeepSeek inference", async () => {
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
  assert.equal(calls[0].modelId, "deepseek-flash");
  assert.equal(calls[0].reasoningEffort, "low");
});

test("GPT-6 selections never fall back to GPT after a failure", async () => {
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
  await assert.rejects(provider.analyze(request), /overloaded/);
  assert.deepEqual(calls.map(({ modelId, modelProvider, reasoningEffort }) => ({ modelId, modelProvider, reasoningEffort })), [
    { modelId: "deepseek-flash", modelProvider: "deepseek", reasoningEffort: "low" },
  ]);
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
    modelId, providerId: "haolo-ai-test", effort: "low",
  })));
});
