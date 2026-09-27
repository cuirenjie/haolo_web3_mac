import assert from "node:assert/strict";
import test from "node:test";

import {
  GPT_6_SOL_DISPLAY_MODEL,
  GPT_6_SOL_RUNTIME_MODEL,
  displayModelAliasForSelection,
  migrateGpt6SolSelection,
  runtimeModelForSelection,
} from "../src/main/gpt6-sol-alias-policy.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";

test("GPT-6-Sol selection uses the GPT-5.6-Sol runtime chain and preserves its display alias", () => {
  assert.equal(runtimeModelForSelection(GPT_6_SOL_DISPLAY_MODEL), GPT_6_SOL_RUNTIME_MODEL);
  assert.equal(displayModelAliasForSelection(GPT_6_SOL_DISPLAY_MODEL), GPT_6_SOL_DISPLAY_MODEL);
  assert.deepEqual(migrateGpt6SolSelection({
    model: GPT_6_SOL_DISPLAY_MODEL,
    explicitModelSelection: true,
  }), {
    model: GPT_6_SOL_RUNTIME_MODEL,
    modelProvider: "haolo_ai",
    explicitModelSelection: true,
    __haoloModelDisplayAlias: GPT_6_SOL_DISPLAY_MODEL,
  });
});

test("trading analysis keeps GPT-6-Sol as the visible model while using the selected runtime", async () => {
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: GPT_6_SOL_RUNTIME_MODEL,
    displayModelId: GPT_6_SOL_DISPLAY_MODEL,
    modelProvider: "haolo_ai",
    invoke: async (params) => {
      calls.push(params);
      return { status: "success", text: "{}" };
    },
    fixedReasoningEffort: "max",
  });
  const result = await provider.analyze({ task: "price-action-review" }, { reasoningEffort: "low" });
  assert.equal(calls[0].modelId, GPT_6_SOL_RUNTIME_MODEL);
  assert.equal(result.modelId, GPT_6_SOL_DISPLAY_MODEL);
});
