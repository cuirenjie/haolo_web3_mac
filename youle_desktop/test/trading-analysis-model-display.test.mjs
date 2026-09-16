import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tradingAnalysisModelDisplayName } from "../src/renderer/trading-analysis-model-display.ts";

test("analysis model display handles current and legacy Flash IDs without mutating metadata", () => {
  for (const modelId of ["deepseek-flash", "deepseek-v4-flash", " DEEPSEEK-FLASH "]) {
    const model = Object.freeze({ modelId, providerId: "deepseek" });
    assert.equal(tradingAnalysisModelDisplayName(model, "zh-CN"), "GPT-6 Astra 大模型");
    assert.equal(model.modelId, modelId);
    assert.equal(model.providerId, "deepseek");
  }
});

test("display alias respects the analysis language and retains unrelated model names", () => {
  const model = { modelId: "deepseek-flash" };
  assert.equal(tradingAnalysisModelDisplayName(model, "en"), "GPT-6 Astra model");
  assert.equal(tradingAnalysisModelDisplayName(model, "zh-TW"), "GPT-6 Astra 大模型");
  for (const modelId of ["gpt-5.6-sol", "gpt-6-astra", "deepseek-v4-pro", "deepseek-flash-custom"]) {
    assert.equal(tradingAnalysisModelDisplayName({ modelId, providerId: "deepseek" }, "zh-CN"), modelId);
  }
  assert.equal(tradingAnalysisModelDisplayName({ providerId: "test-provider" }), "test-provider");
  for (const missing of [undefined, null, {}]) {
    assert.equal(tradingAnalysisModelDisplayName(missing), "分析模型");
  }
});

test("all chart analysis paths share the same theme-neutral display boundary", async () => {
  const market = await readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  const display = await readFile(new URL("../src/renderer/trading-analysis-model-display.ts", import.meta.url), "utf8");
  for (const method of ["runGeneralConversation", "runChanConversation", "runWaveConversation", "runWyckoffConversation", "runOrderFlowConversation"]) {
    const start = market.indexOf(`  async ${method}(`);
    assert.ok(start >= 0, method);
    const end = market.indexOf("\n  async ", start + 1);
    const body = market.slice(start, end < 0 ? undefined : end);
    assert.match(body, /const modelName = tradingAnalysisModelDisplayName\(response\.model, job\.language\)/, method);
  }
  assert.match(market, /modelName: tradingAnalysisModelDisplayName\(response\.model, options\.job\.language\)/);
  // The alias is plain text on the existing shared light/dark message surface.
  // A future HTML/style special case must not bypass its theme tokens.
  assert.doesNotMatch(display, /#[0-9a-f]{3,8}\b|(?:background|color)\s*:|<\/?(?:span|div|style)\b|data-theme/iu);
});
