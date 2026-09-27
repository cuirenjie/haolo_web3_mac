import assert from "node:assert/strict";
import test from "node:test";
import { modelDisplayName } from "../src/renderer/model-display-name.ts";
import { chatModelOptionsFromList, DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION } from "../src/renderer/chat-model-catalog.ts";
import { executionChatModelOptions, normalizeBusinessModelPoolsState } from "../src/renderer/business-model-pools.ts";
import { normalizeProviderModelCatalog, providerModelOptions } from "../src/renderer/provider-model-catalog.ts";

test("Flash display aliases preserve unrelated model names", () => {
  for (const name of ["deepseek-flash", "deepseek-v4-flash", "DeepSeek V4.1 Flash", " deepseek V4.1 flash "]) {
    assert.equal(modelDisplayName(name), "GPT-6 Astra");
  }
  assert.equal(modelDisplayName("server-alias", "DeepSeek V4.1 Flash"), "GPT-6 Astra");
  assert.equal(modelDisplayName("deepseek-flash", "后台自定义名称"), "GPT-6 Astra");
  assert.equal(modelDisplayName("deepseek-v4-pro", "DeepSeek V4 Pro"), "DeepSeek V4 Pro");
  assert.equal(modelDisplayName("deepseek-flash-custom"), "deepseek-flash-custom");
  assert.equal(modelDisplayName("gpt-6-astra", "GPT-6 Astra"), "GPT-6 Astra");
  assert.equal(modelDisplayName("gpt-6-sol", "GPT-6-Sol"), "GPT-6-Sol");
});

test("execution catalogs apply display aliases without changing routing or capabilities", () => {
  assert.equal(DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION.label, "GPT-6 Astra");
  const [listed] = chatModelOptionsFromList({ data: [{
    id: "deepseek-flash", display_name: "DeepSeek V4.1 Flash", model_provider: "deepseek", input_modalities: ["text"],
  }] });
  const [pooled] = executionChatModelOptions(normalizeBusinessModelPoolsState({
    configured: true,
    pools: [{ id: "execution", capabilities: ["root_execution"], models: [{
      id: "deepseek-flash", displayName: "DeepSeek V4.1 Flash", provider: "deepseek", routeGroupId: 15,
    }] }],
  }));
  for (const option of [listed, pooled]) {
    assert.equal(option.label, "GPT-6 Astra");
    assert.equal(option.value, "deepseek-flash");
    assert.equal(option.providerId, "deepseek");
    assert.deepEqual(option.inputModalities, ["text"]);
  }
  assert.equal(pooled.routeGroupId, 15);
});

test("provider catalogs normalize server names in configured and fallback lists", () => {
  for (const configured of [false, true]) {
    const catalog = normalizeProviderModelCatalog({ configured, providers: [{
      provider: "deepseek", status: "online", models: [{ id: "deepseek-flash", displayName: "DeepSeek V4.1 Flash" }],
    }] });
    const [option] = providerModelOptions(catalog, "deepseek");
    assert.equal(option.label, "GPT-6 Astra");
    assert.equal(option.description, "GPT-6 Astra");
    assert.equal(option.value, "deepseek-flash");
    assert.equal(catalog.providers.deepseek.models[0].displayName, "GPT-6 Astra");
  }
});
