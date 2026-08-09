import assert from "node:assert/strict";
import test from "node:test";

import {
  isFeishuImageAttachment,
  isFeishuVideoAttachment,
  isImageAttachment,
  isVideoAttachment,
} from "../src/renderer/media-attachment-classification.js";

test("image prompt text files are not classified as image attachments", () => {
  const attachment = {
    name: "image-generation-prompt.txt",
    mime: "text/plain",
    url: "C:/outputs/image-generation-prompt.txt",
  };

  assert.equal(isFeishuImageAttachment(attachment), false);
  assert.equal(isImageAttachment(attachment), false);
});

test("video prompt text files are not classified as video attachments", () => {
  const attachment = {
    name: "video-generation-prompt.txt",
    mime: "text/plain",
    url: "C:/outputs/video-generation-prompt.txt",
  };

  assert.equal(isFeishuVideoAttachment(attachment), false);
  assert.equal(isVideoAttachment(attachment), false);
});

test("real image and video files remain previewable media", () => {
  assert.equal(isImageAttachment({ name: "generated-photo.JPG", mime: null }), true);
  assert.equal(isVideoAttachment({ name: "generated-video.mp4", mime: null }), true);
});

test("Feishu media keys remain valid when filename and mime are unavailable", () => {
  assert.equal(isImageAttachment({ name: "", file_key: "img_v3_02ab" }), true);
  assert.equal(isVideoAttachment({ name: "", file_key: "video_v3_02ab" }), true);
  assert.equal(isImageAttachment({ name: "", image_key: "opaque-feishu-key" }), true);
  assert.equal(isVideoAttachment({ name: "", video_key: "opaque-feishu-key" }), true);
});

test("explicit non-media metadata overrides ambiguous Feishu-style prefixes", () => {
  assert.equal(isImageAttachment({ name: "image_notes.txt", object_key: "image_notes", mime: "text/plain" }), false);
  assert.equal(isVideoAttachment({ name: "video_notes.json", object_key: "video_notes", mime: "application/json" }), false);
});
