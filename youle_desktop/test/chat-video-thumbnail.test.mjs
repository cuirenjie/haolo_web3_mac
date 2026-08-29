import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("sent media messages retain stable uploaded URLs instead of session blob URLs", async () => {
  const source = await rendererSource;
  const block = sourceBlock(
    source,
    "function messageAttachmentFromLocal",
    "function rememberUploadedAttachmentPreview",
  );

  assert.match(block, /url: attachment\.url \|\| attachment\.previewUrl \|\| null/);
  assert.doesNotMatch(block, /useLocalPreview/);
  assert.match(block, /posterUrl && !isEphemeralPreviewUrl\(posterUrl\)/);
});

test("chat video thumbnails reject stale blob posters and keep a clean fallback", async () => {
  const source = await rendererSource;
  const renderBlock = sourceBlock(
    source,
    "function renderMediaAttachment",
    "type MediaAttachmentDisplay",
  );
  const validationBlock = sourceBlock(
    source,
    "function isEphemeralPreviewUrl",
    "function toggleWindowMaximizedFromTitlebar",
  );
  const bindingBlock = sourceBlock(
    source,
    "function bindAttachmentPreviewEvents",
    "function bindLocalFileDragEvents",
  );

  assert.match(renderBlock, /usableVideoPosterUrl\(videoPosterUrlFromAttachment\(displayAttachment\)\)/);
  assert.match(renderBlock, /class="attachment-media attachment-video-thumb"/);
  assert.match(renderBlock, /class="attachment-media attachment-video-poster"[^>]*alt=""/);
  assert.match(validationBlock, /liveVideoPosterObjectUrls\.has\(posterUrl\)/);
  assert.match(bindingBlock, /failedVideoPosterUrls\.add\(posterUrl\)/);
  assert.match(bindingBlock, /image\.remove\(\)/);
  assert.match(bindingBlock, /ensureVideoPosterResource\(file, videoUrl\)/);
});

test("chat video poster layers stay above the fallback and below the play control", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.attachment-video-poster\s*\{[^}]*position: absolute;[^}]*z-index: 1;[^}]*inset: 0;/s,
  );
  assert.match(
    styles,
    /\.attachment-video-play\s*\{[^}]*position: absolute;[^}]*z-index: 2;/s,
  );
  assert.match(
    styles,
    /\.attachment-hover-actions\.media-surface-actions\s*\{[^}]*z-index: 3;/s,
  );
});
