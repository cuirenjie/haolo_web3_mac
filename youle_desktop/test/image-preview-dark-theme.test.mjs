import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const previewPreloadSource = readFile(new URL("../src/main/image-preview-preload.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("image preview requests forward the active application theme", async () => {
  const renderer = await rendererSource;
  const previewBlock = sourceBlock(renderer, "async function openImagePreviewFile", "async function openPreviewFile");
  const pendingBlock = sourceBlock(renderer, "async function openPendingImagePreview", "async function base64FromPreviewUrl");

  assert.match(
    previewBlock,
    /api\.previewImageFile\(\{[^}]*theme: state\.settings\.theme[^}]*\}\)/s,
  );
  assert.equal((previewBlock.match(/theme: state\.settings\.theme/g) || []).length, 3);
  assert.match(pendingBlock, /api\.annotateImage\(\{[^}]*theme: state\.settings\.theme[^}]*\}\)/s);
});

test("standalone image preview uses dark titlebar colors and pale controls", async () => {
  const source = await mainSource;
  const annotateBlock = sourceBlock(source, "async function annotateImage", "async function previewImageFile");
  const fileBlock = sourceBlock(source, "async function previewImageFile", "function imageBase64Payload");
  const themeBlock = sourceBlock(source, "function imagePreviewTheme", "async function openImagePreviewWindow");
  const htmlBlock = sourceBlock(source, "function imagePreviewHtml", "function imagePreviewWindowBounds");
  const darkBlock = sourceBlock(htmlBlock, 'html[data-theme="dark"] {', "body {");

  assert.match(annotateBlock, /theme: imagePreviewTheme\(params\.theme\)/);
  assert.match(fileBlock, /theme: imagePreviewTheme\(params\.theme\)/);
  assert.match(themeBlock, /return value === "dark" \? "dark" : "light"/);
  assert.match(htmlBlock, /<html lang="\$\{htmlEscape\(appLanguageLocale\(normalizedLanguage\)\)\}" data-theme="\$\{htmlEscape\(imagePreviewTheme\(theme\)\)\}">/);
  assert.match(darkBlock, /color-scheme: dark/);
  assert.match(darkBlock, /--titlebar-bg: #2b2d31/);
  assert.match(darkBlock, /--titlebar-fg: #f3f4f6/);
  assert.match(darkBlock, /--titlebar-border: #252a31/);
  assert.match(darkBlock, /--titlebar-action-fg: #f3f4f6/);
  assert.match(htmlBlock, /\.titlebar\s*\{[^}]*background: var\(--titlebar-bg\);[^}]*color: var\(--titlebar-fg\);/s);
  assert.match(htmlBlock, /\.window-actions button\s*\{[^}]*color: var\(--titlebar-action-fg\);/s);
  assert.match(htmlBlock, /\.window-actions svg\s*\{[^}]*stroke: currentColor;/s);
});

test("standalone image preview omits minimize and maximize controls and capabilities", async () => {
  const [source, preload] = await Promise.all([mainSource, previewPreloadSource]);
  const ipcBlock = sourceBlock(
    source,
    'ipcMain.handle("youle:imagePreviewSave"',
    'ipcMain.handle("codex:listThreads"',
  );
  const openBlock = sourceBlock(source, "async function openImagePreviewWindow", "function wireImagePreviewContextMenu");
  const htmlBlock = sourceBlock(source, "function imagePreviewHtml", "function imagePreviewWindowBounds");

  assert.match(openBlock, /minimizable: false/);
  assert.match(openBlock, /maximizable: false/);
  assert.doesNotMatch(htmlBlock, /data-action="minimize"/);
  assert.doesNotMatch(htmlBlock, /data-action="maximize"/);
  assert.doesNotMatch(htmlBlock, /runAction\("maximize"\)/);
  assert.match(htmlBlock, /data-action="close"/);
  assert.match(htmlBlock, /window\.youleImagePreview\?\.close\?\.\(\)/);
  assert.match(ipcBlock, /ipcMain\.handle\("youle:imagePreviewClose"/);
  assert.doesNotMatch(ipcBlock, /youle:imagePreviewControl/);
  assert.doesNotMatch(source, /function applyImagePreviewWindowControl/);
  assert.match(preload, /close: \(\) => ipcRenderer\.invoke\("youle:imagePreviewClose"\)/);
  assert.doesNotMatch(preload, /control:/);
});

test("all previewable image entry points route to the standalone window", async () => {
  const renderer = await rendererSource;
  const routingHelper = sourceBlock(
    renderer,
    "function shouldOpenImageInStandaloneWindow",
    "function taskAnchorAvatarText",
  );
  const attachmentBlock = sourceBlock(renderer, "function renderAttachment(", "function renderAttachmentResultActions");
  const mediaBlock = sourceBlock(renderer, "function renderMediaAttachment", "type MediaAttachmentDisplay");
  const messageBindingBlock = sourceBlock(
    renderer,
    "function bindAttachmentPreviewEvents",
    "function bindLocalFileDragEvents",
  );
  const libraryBindingBlock = sourceBlock(renderer, "function bindEvents", "function openChannelDialog");
  const previewToggleBlock = libraryBindingBlock;
  const resetBlock = sourceBlock(renderer, "function resetLibraryImagePreviewState", "function currentResultPreviewCandidateId");

  assert.match(routingHelper, /file\.kind === "image" && file\.url/);
  assert.match(attachmentBlock, /shouldOpenImageInStandaloneWindow\(previewFile\)/);
  assert.match(mediaBlock, /shouldOpenImageInStandaloneWindow\(previewFile\)/);
  assert.match(messageBindingBlock, /if \(shouldOpenImageInStandaloneWindow\(file\)\) \{\s*void openImagePreviewFile\(file\);\s*return;/s);
  assert.ok(
    messageBindingBlock.indexOf("openImagePreviewFile(file)") < messageBindingBlock.indexOf("state.chatPreview ="),
    "image routing must happen before the legacy chat side preview",
  );
  assert.match(libraryBindingBlock, /\.library-file-row\[data-preview-id\]/);
  assert.match(
    libraryBindingBlock,
    /const source =\s*row\.dataset\.previewSource === "material" \? "material" : "result"/,
  );
  assert.match(libraryBindingBlock, /resetLibraryImagePreviewState\(source\)/);
  assert.match(previewToggleBlock, /data-preview-open/);
  assert.match(previewToggleBlock, /shouldOpenImageInStandaloneWindow\(file\)/);
  assert.match(previewToggleBlock, /resetLibraryImagePreviewState\(source\)/);
  assert.match(resetBlock, /state\.selectedMaterialId = null/);
  assert.match(resetBlock, /state\.materialPreviewClosed = true/);
  assert.match(resetBlock, /state\.selectedResultId = null/);
  assert.match(resetBlock, /state\.resultPreviewClosed = true/);
});

test("remote image previews are loaded through the main-process preview bridge", async () => {
  const renderer = await rendererSource;
  const mimeBlock = sourceBlock(renderer, "function standaloneImagePreviewMime", "async function openImagePreviewFile");
  const previewBlock = sourceBlock(renderer, "async function openImagePreviewFile", "async function openPreviewFile");

  assert.match(mimeBlock, /find\(\(value\) => value\.toLowerCase\(\)\.startsWith\("image\/"\)\) \|\| "image\/png"/);
  assert.match(
    previewBlock,
    /isRemotePreviewUrl\(file\.url\)[\s\S]*api\.previewFile\(\{ url: file\.url, name: file\.name, mime: file\.mime \|\| null \}\)/,
  );
  assert.match(previewBlock, /firstString\(remotePreview\?\.base64\)/);
  assert.match(previewBlock, /mime: standaloneImagePreviewMime\(file, remotePreview\?\.mime\)/);
});
