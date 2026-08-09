import assert from "node:assert/strict";
import test from "node:test";
import {
  providerInputCapabilityPrompt,
  providerModelInputCapabilities,
} from "../src/main/provider-input-capabilities.mjs";

test("provider input capabilities reflect production-verified image routes", () => {
  assert.deepEqual(
    providerModelInputCapabilities("codex", "gpt-5.6-terra").modalities,
    ["text", "file", "image"],
  );
  assert.deepEqual(
    providerModelInputCapabilities("deepseek", "deepseek-v4-flash").modalities,
    ["text", "file"],
  );
  assert.deepEqual(
    providerModelInputCapabilities("qwen", "qwen3.7-plus").modalities,
    ["text", "file", "image"],
  );
});

test("Gemini and Doubao advertise native video understanding", () => {
  assert.deepEqual(
    providerModelInputCapabilities("gemini", "gemini-3.5-flash").modalities,
    ["text", "file", "image", "video"],
  );
  assert.deepEqual(
    providerModelInputCapabilities("volcengine", "doubao-seed-2-1-pro-260628").modalities,
    ["text", "file", "image", "video"],
  );
  assert.match(
    providerInputCapabilityPrompt("gemini", "gemini-3.5-flash"),
    /当前分组文件、上传文档、图片和视频/,
  );
});
