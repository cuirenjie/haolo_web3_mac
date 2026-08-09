import assert from "node:assert/strict";
import test from "node:test";

import {
  imageGenerationSizeForAspectRatio,
  imageGenerationParameterCapability,
  normalizeImageGenerationSize,
  requestedImageGenerationAspectRatio,
} from "../src/renderer/image-generation-parameters.ts";

test("GPT Image 2 exposes three fixed canvases without adaptive size", () => {
  const capability = imageGenerationParameterCapability("aihubcc/gpt-image-2");

  assert.equal(capability.sizeField, "size");
  assert.equal(capability.defaultSize, "1024x1024");
  assert.deepEqual(
    capability.sizeOptions.map((option) => option.value),
    ["1024x1024", "1536x1024", "1024x1536"],
  );
  assert.deepEqual(
    capability.sizeOptions.map((option) => option.compactLabel),
    ["1:1", "3:2", "2:3"],
  );
  assert.equal(capability.requiredReferenceImages, 0);
  assert.equal(capability.maxReferenceImages, 1);
  assert.equal(capability.maxReferenceLongEdge, 2048);
});

test("1K sync and async aliases expose the asynchronous aspect-ratio contract", () => {
  for (const model of ["gpt-image-2-1k", "aihubcc/gpt-image-2-1k-async"]) {
    const capability = imageGenerationParameterCapability(model);

    assert.equal(capability.sizeField, "aspect_ratio");
    assert.equal(capability.defaultSize, "1:1");
    assert.deepEqual(
      capability.sizeOptions.map((option) => option.value),
      ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5"],
    );
    assert.equal(capability.maxReferenceImages, 6);
    assert.equal(capability.maxReferenceBytesTotal, 5 * 1024 * 1024);
  }
});

test("2K and 3.5K expose aspect ratios", () => {
  for (const model of ["gpt-image-2-2k", "catalog/gpt-image-2-3.5k"]) {
    const capability = imageGenerationParameterCapability(model);
    assert.equal(capability.sizeField, "aspect_ratio");
    assert.equal(capability.defaultSize, "1:1");
    assert.deepEqual(
      capability.sizeOptions.map((option) => option.value),
      ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5"],
    );
  }
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

test("explicit prompt ratios map to a supporting model size", () => {
  assert.equal(
    imageGenerationSizeForAspectRatio("aihubcc/gpt-image-2", "3:2"),
    "1536x1024",
  );
  assert.equal(
    imageGenerationSizeForAspectRatio("aihubcc/gpt-image-2", "3:4"),
    "",
  );
  assert.equal(
    imageGenerationSizeForAspectRatio("gpt-image-2-2k", "3:4"),
    "3:4",
  );
});
