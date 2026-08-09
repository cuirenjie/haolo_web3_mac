import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("video expert reuses the standard upload and pending attachment controls", () => {
  const renderBlock = sourceBlock(mainSource, "function renderVideoExpertComposer", "function renderVideoExpertAspectRatioPicker");
  const capabilityBlock = sourceBlock(mainSource, "function videoExpertMediaInputCapability", "function renderMediaInputGuideSlots");
  const guideBlock = sourceBlock(mainSource, "function renderMediaInputGuideSlots", "function renderPendingAttachmentsRail");
  const pendingBlock = sourceBlock(mainSource, "function renderPendingAttachmentsRail", "function renderComposer");
  const eventsBlock = sourceBlock(mainSource, "function bindEvents()", "function bindAutoTaskPickerEvents");

  assert.match(renderBlock, /renderPendingAttachmentsRail\(thread\.id,\s*renderMediaInputGuideSlots\(thread\.id\)\)/);
  assert.match(renderBlock, /fileInputAccept =[\s\S]*?"video\/\*"[\s\S]*?"image\/jpeg,image\/png,image\/webp"/);
  assert.match(renderBlock, /id="fileInput" type="file" accept="\$\{fileInputAccept\}"/);
  assert.match(renderBlock, /fileInputMultipleAttribute = maxMediaCount > 1 \? "multiple" : ""/);
  assert.match(renderBlock, /uploadDisabled = inputPolicy\.mediaType === "none" \|\| maxMediaCount === 0/);
  assert.match(renderBlock, /data-action="pick-files" title="\$\{escapeAttr\(inputPolicy\.uploadTitle\)\}"/);
  assert.match(renderBlock, /renderComposerModePicker\(thread\.id\)/);
  assert.match(renderBlock, /class="composer video-expert-composer media-creation-composer"/);
  assert.match(pendingBlock, /renderPendingAttachment/);
  assert.match(guideBlock, /data-media-input-kind/);
  assert.match(eventsBlock, /mediaInputAccept\(kind\)/);
  assert.match(eventsBlock, /\[data-remove-attachment\]/);
  assert.match(eventsBlock, /\[data-preview-pending-image\]/);
  assert.match(eventsBlock, /\[data-open-pending-file\]/);
  assert.doesNotMatch(mainSource, /data-video-expert-frame|videoExpertFirstFramePreviewUrl/);
  assert.doesNotMatch(stylesSource, /\.video-expert-first-frame/);
  assert.match(stylesSource, /\.media-upload-guide-slot/);
  assert.match(stylesSource, /\.media-creation-composer \.pending-attachments/);
  assert.doesNotMatch(stylesSource, /\.media-upload-guide-required|\.media-upload-guide-slot\.required/);
  assert.match(guideBlock, /aria-required="\$\{slot\.required \? "true" : "false"\}"/);
  assert.match(capabilityBlock, /inputPolicy\.mode === "first-last-frame-to-video"[\s\S]*?\["首帧", "尾帧"\]/);
  assert.match(capabilityBlock, /inputPolicy\.mode === "image-to-video"[\s\S]*?\["首帧"\]/);
  assert.match(capabilityBlock, /inputPolicy\.mode === "video-to-video"[\s\S]*?"源视频"/);
  assert.match(capabilityBlock, /"参考图"[\s\S]*?"参考视频"[\s\S]*?"参考音频"/);
});
