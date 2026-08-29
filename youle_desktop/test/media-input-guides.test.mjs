import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMediaInputGuideSlots,
  mediaInputAccept,
} from "../src/renderer/media-input-guides.ts";

test("image models render the remaining slots up to their maximum capability", () => {
  const slots = buildMediaInputGuideSlots(
    {
      image: { min: 0, max: 6 },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
    },
    { image: 1, video: 0, audio: 0 },
  );

  assert.equal(slots.length, 5);
  assert.ok(slots.every((slot) => slot.kind === "image"));
  assert.ok(slots.every((slot) => slot.label === "图片"));
});

test("required first-frame and source-video slots keep their semantic labels", () => {
  const frameSlots = buildMediaInputGuideSlots(
    {
      image: { min: 2, max: 2, labels: ["首帧", "尾帧"] },
      video: { min: 0, max: 0 },
      audio: { min: 0, max: 0 },
    },
    { image: 0, video: 0, audio: 0 },
  );
  assert.deepEqual(
    frameSlots.map((slot) => [slot.label, slot.required]),
    [
      ["首帧", true],
      ["尾帧", true],
    ],
  );

  const videoSlots = buildMediaInputGuideSlots(
    {
      image: { min: 0, max: 0 },
      video: { min: 1, max: 2 },
      audio: { min: 0, max: 0 },
    },
    { image: 0, video: 0, audio: 0 },
  );
  assert.deepEqual(
    videoSlots.map((slot) => slot.required),
    [true, false],
  );
});

test("Seedance video and audio slots wait for a main image", () => {
  const capability = {
    image: { min: 0, max: 4 },
    video: { min: 0, max: 3 },
    audio: { min: 0, max: 1 },
    videosRequireImages: 1,
    audiosRequireImages: 1,
  };
  const withoutImage = buildMediaInputGuideSlots(
    capability,
    { image: 0, video: 0, audio: 0 },
  );
  assert.ok(
    withoutImage
      .filter((slot) => slot.kind !== "image")
      .every((slot) => slot.disabled),
  );

  const withImage = buildMediaInputGuideSlots(
    capability,
    { image: 1, video: 0, audio: 0 },
  );
  assert.ok(withImage.every((slot) => !slot.disabled));
});

test("each guide kind opens a type-specific file picker", () => {
  assert.equal(mediaInputAccept("image"), "image/jpeg,image/png,image/webp");
  assert.equal(mediaInputAccept("video"), "video/*");
  assert.equal(mediaInputAccept("audio"), "audio/*");
});
