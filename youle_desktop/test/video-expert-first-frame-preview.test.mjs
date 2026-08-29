import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("video expert sends stable ordered frame attachments for chat preview", async () => {
  const source = await mainSource;
  const sendBlock = sourceBlock(source, "async function sendCurrentVideoExpertMessage", "function videoAttachmentFromGenerationResult");
  assert.match(sendBlock, /const inputAttachments = videoExpertInputAttachments\([\s\S]*?submissionReadyAttachments/);
  assert.match(sendBlock, /const sentAttachments = inputAttachments\.map\(\(attachment, index\) =>/);
  assert.match(sendBlock, /videoExpertFirstFrameMessageAttachment\([\s\S]*?sentMediaAttachments\[index\]/);
  assert.match(sendBlock, /inputPolicy\.mode === "first-last-frame-to-video"[\s\S]*?"首帧图"[\s\S]*?"尾帧图"/);
  assert.match(sendBlock, /isVideoAttachment\(attachment\)[\s\S]*?`参考视频\$\{index \+ 1\}`/);

  const helperBlock = sourceBlock(source, "function videoExpertFirstFrameMessageAttachment", "function isHttpUrl");
  assert.match(helperBlock, /attachmentLocalPath\(firstFrame\)/);
  assert.match(helperBlock, /download_url:\s*remoteUrl \|\| null/);
  assert.match(helperBlock, /local_path:\s*localPath \|\| null/);
  assert.match(helperBlock, /preview_url:\s*null/);
  assert.match(helperBlock, /rememberUploadedAttachmentPreview\(firstFrame,\s*attachment\)/);
  assert.match(sendBlock, /quote_context:\s*composerQuoteContextRecord\(params\.quote\)/);
});

test("attachment preview falls back to local paths before stale blob urls", async () => {
  const source = await mainSource;
  const candidatesBlock = sourceBlock(source, "function attachmentPreviewReferenceCandidates", "function cleanGeneratedPathReference");
  assert.ok(candidatesBlock.indexOf("attachmentLocalPath(attachment)") < candidatesBlock.indexOf("firstString(attachment.url)"));

  const cachedBlock = sourceBlock(source, "function cachedUploadedAttachmentPreviewUrl", "function cachedUploadedAttachmentVideoPosterUrl");
  assert.ok(cachedBlock.includes("if (/^(blob:|data:)/i.test(currentUrl)) return null;"));
  assert.doesNotMatch(cachedBlock, /return currentUrl/);
});

test("video expert quote and edit restore use the standard attachment preview rail", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function renderVideoExpertComposer", "function renderVideoExpertAspectRatioPicker");
  assert.match(renderBlock, /renderPendingAttachmentsRail\(thread\.id,\s*renderMediaInputGuideSlots\(thread\.id\)\)/);
  assert.match(renderBlock, /state\.composerQuote \? renderComposerQuotePreview\(state\.composerQuote\) : ""/);
  assert.doesNotMatch(renderBlock, /data-video-expert-frame|video-expert-first-frame/);

  const previewBlock = sourceBlock(source, "function renderPendingAttachmentsRail", "function renderComposer");
  assert.match(
    previewBlock,
    /state\.attachments[\s\S]*?\.map\(\(attachment\) =>[\s\S]*?renderPendingAttachment\([\s\S]*?attachment,[\s\S]*?mediaLabels\.get\(attachment\.id\) \|\| null/,
  );

  const editBlock = sourceBlock(source, "function localAttachmentFromMessageAttachment", "function inferAttachmentMime");
  assert.match(editBlock, /cachedUploadedAttachmentPreviewUrl\(attachment\)/);
  assert.match(editBlock, /download_url:\s*downloadUrl \|\| null/);
  assert.doesNotMatch(editBlock, /previewUrl:\s*url \|\| undefined/);
});
