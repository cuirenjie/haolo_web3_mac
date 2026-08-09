import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("message context menus prioritize the exact attachment under the pointer", async () => {
  const source = await rendererSource;
  const contextBlock = sourceBlock(source, "function contextActionsFromTarget", "function copyTextFromContextTarget");
  const attachmentBlock = sourceBlock(source, "function attachmentCopyPayloadFromTarget", "function attachmentsFromMessageRow");

  assert.ok(
    contextBlock.indexOf("attachmentCopyPayloadFromTarget(element)") < contextBlock.indexOf("selectedCopyText()"),
    "attachment hit testing must run before selected-text copying",
  );
  assert.match(contextBlock, /if \(attachmentPayload\) return \{\s*copyPayload: attachmentPayload,\s*editPayload: null,\s*favoriteText: null,?\s*\}/);
  assert.match(attachmentBlock, /\[data-pending-attachment-id\]/);
  assert.match(attachmentBlock, /\[data-chat-preview\], \.attachment-card, \.attachment-media-wrap/);
  assert.match(attachmentBlock, /kind: file\.kind === "image" \? "image" : "file"/);
  assert.match(attachmentBlock, /return \{ kind: image \? "image" : "file", file \}/);
});

test("non-attachment bubble areas keep text and original edit semantics", async () => {
  const source = await rendererSource;
  const messageActions = sourceBlock(source, "function messageContextActions", "function copyTextFromMessageRow");
  const bindings = sourceBlock(source, "function bindMessageContentEvents", "async function writeTextToClipboard");

  assert.match(messageActions, /options: \{ attachmentFallback\?: boolean \} = \{\}/);
  assert.match(messageActions, /options\.attachmentFallback \? imageCopyPayload/);
  assert.match(bindings, /messageContextActions\(row, \{ attachmentFallback: true \}\)/);
});

test("user bubble copy action sits after favorite and only appears for text", async () => {
  const source = await rendererSource;
  const bubble = sourceBlock(source, "function renderTextBubble", "function renderMessageThreadReferencePreview");

  assert.match(bubble, /const copyTextPayload = isBlankThreadWelcomeMessage\(message\)[\s\S]*?textCopyPayload\(normalizeCopyText\(content\.text\)\)/);
  assert.match(
    bubble,
    /data-action="favorite-message"[\s\S]*?copyTextPayload && fromUser[\s\S]*?data-action="copy-message"[\s\S]*?data-action="quote-message"/,
  );
  assert.doesNotMatch(bubble, /copyPayload && fromUser/);
});

test("pending composer image, file, and folder cards expose exact attachment ids", async () => {
  const source = await rendererSource;
  const pendingBlock = sourceBlock(source, "function renderPendingAttachment", "function renderAgentPanel");
  assert.equal((pendingBlock.match(/data-pending-attachment-id=/g) || []).length, 3);
  assert.match(pendingBlock, /pending-media/);
  assert.match(pendingBlock, /data-replace-media-attachment/);
  assert.match(pendingBlock, /pending-folder/);
  assert.match(pendingBlock, /data-open-pending-file/);
});

test("attachment copying crosses the preload bridge and writes native image or file clipboard data", async () => {
  const [renderer, preload, main] = await Promise.all([rendererSource, preloadSource, mainSource]);
  const rendererCopy = sourceBlock(renderer, "async function copyPayloadToClipboard", "function bindAttachmentPreviewEvents");
  const mainCopy = sourceBlock(main, "async function copyAttachmentToClipboard", "function startLocalFileDrag");

  assert.match(rendererCopy, /api\.copyAttachmentToClipboard/);
  assert.match(rendererCopy, /isLocalPreviewUrl\(url\).*\{ path: url \}/s);
  assert.match(rendererCopy, /isRemotePreviewUrl\(url\).*\{ url \}/s);
  assert.match(rendererCopy, /base64: await base64FromPreviewUrl\(url\)/);
  assert.match(preload, /copyAttachmentToClipboard: \(params\) => ipcRenderer\.invoke\("youle:copyAttachmentToClipboard", params\)/);
  assert.match(main, /ipcMain\.handle\("youle:copyAttachmentToClipboard"/);
  assert.match(mainCopy, /clipboard\.writeImage\(image\)/);
  assert.match(mainCopy, /haolo-desktop-clipboard/);
  assert.match(mainCopy, /SetFileDropList\(\$files\)/);
  assert.match(mainCopy, /Preferred DropEffect/);
  assert.match(mainCopy, /\["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Sta"/);
});

test("standalone image preview has a copy-only context menu", async () => {
  const source = await mainSource;
  const openBlock = sourceBlock(source, "async function openImagePreviewWindow", "function imagePreviewSavePayload");
  const menuBlock = sourceBlock(source, "function wireImagePreviewContextMenu", "function imagePreviewSavePayload");

  assert.match(openBlock, /wireImagePreviewContextMenu\(previewWindow, image\)/);
  assert.match(menuBlock, /params\.mediaType !== "image"/);
  assert.equal((menuBlock.match(/label:/g) || []).length, 1);
  assert.match(menuBlock, /label: "复制"/);
  assert.match(menuBlock, /clipboard\.writeImage\(image\)/);
});
