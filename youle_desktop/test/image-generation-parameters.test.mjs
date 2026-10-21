import assert from "node:assert/strict";
import test from "node:test";

import {
  imageGenerationSizeForAspectRatio,
  imageGenerationParameterCapability,
  normalizeImageGenerationSize,
  requestedImageGenerationAspectRatio,
} from "../src/renderer/image-generation-parameters.ts";

test("official images expose auto dimensions and bounded references", () => {
  const capability = imageGenerationParameterCapability("codex/gpt-image-2");
  assert.equal(capability.sizeField, "size");
  assert.equal(capability.defaultSize, "auto");
  assert.deepEqual(capability.sizeOptions.map(option => option.value), ["auto"]);
  assert.equal(capability.maxReferenceImages, 4);
  assert.equal(capability.maxReferenceBytesTotal, 20 * 1024 * 1024);
  assert.equal(capability.maxReferenceLongEdge, 0);
  assert.equal(imageGenerationParameterCapability("retired/model").maxReferenceImages, 0);
});

test("persisted image sizes reject unsafe values", () => {
  assert.equal(normalizeImageGenerationSize(" 1024X1536 "), "1024x1536");
  assert.equal(normalizeImageGenerationSize("16:9"), "16:9");
  assert.equal(normalizeImageGenerationSize("unsafe\nvalue"), "");
});

test("image prompts normalize explicit ratios and pixel dimensions", () => {
  assert.equal(
    requestedImageGenerationAspectRatio("生成一张 3：4 的竖版海报"),
    "3:4",
  );
  assert.equal(
    requestedImageGenerationAspectRatio("输出尺寸为 1536×2048"),
    "3:4",
  );
  assert.equal(
    requestedImageGenerationAspectRatio("先参考 1:1，最终输出 3840x2160"),
    "16:9",
  );
  assert.equal(requestedImageGenerationAspectRatio("没有指定画幅"), "");
});

test("prompt ratios do not promise fixed official output dimensions", () => {
  assert.equal(imageGenerationSizeForAspectRatio("codex/gpt-image-2", "3:2"), "");
  assert.equal(imageGenerationSizeForAspectRatio("codex/gpt-image-2", "3:4"), "");
});
