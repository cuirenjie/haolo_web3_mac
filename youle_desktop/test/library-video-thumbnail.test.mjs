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

test("library videos load a first-frame poster and overlay a play affordance", async () => {
  const renderer = await rendererSource;
  const thumbBlock = sourceBlock(renderer, "function renderVideoFileThumb", "function previewUrlWithHash");

  assert.match(thumbBlock, /ensurePreviewResource\(file\)/);
  assert.match(thumbBlock, /ensureVideoPosterResource\(file, videoUrl\)/);
  assert.match(thumbBlock, /resource\.posterUrl/);
  assert.match(thumbBlock, /class="thumb-image"/);
  assert.match(thumbBlock, /class="library-video-thumb-play"/);
});

test("library video thumbnail play control stays centered over the poster", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.library-video-thumb-play\s*\{[^}]*position: absolute;[^}]*left: 50%;[^}]*top: 50%;[^}]*border-radius: 50%;[^}]*transform: translate\(-50%, -50%\);/s,
  );
  assert.match(styles, /\.library-video-thumb-play::before\s*\{[^}]*border-left: 6px solid #fff;/s);
});
