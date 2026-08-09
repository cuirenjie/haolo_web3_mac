import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("live supplement controls treat an attachment-only composer as sendable content", async () => {
  const source = await rendererSource;
  const visibilityBlock = sourceBlock(
    source,
    "function hasSupplementComposerContent",
    "function closeConversationSupplementWindow",
  );
  const sendStateBlock = sourceBlock(
    source,
    "function canSendConversationSupplement",
    "function syncComposerSendButton",
  );

  assert.match(
    visibilityBlock,
    /state\.composerText\.trim\(\) \|\| hasSendableComposerAttachments\(\)/,
  );
  assert.match(
    visibilityBlock,
    /isConversationSupplementWindowOpen\(threadId\) && hasSupplementComposerContent\(\)/,
  );
  assert.match(sendStateBlock, /hasSupplementComposerContent\(\)/);
});

test("attachment-only supplements pass the submit guard and retain attachment metadata", async () => {
  const source = await rendererSource;
  const supplementBlock = sourceBlock(
    source,
    "async function sendConversationSupplementFromComposer",
    "async function steerConversationSupplement",
  );

  assert.match(
    supplementBlock,
    /if \(!text\.trim\(\) && !hasSendableComposerAttachments\(\)\) return "handled";/,
  );
  assert.match(
    supplementBlock,
    /const submissionAttachments = mediaCreationSubmissionAttachments\([\s\S]*?threadId,[\s\S]*?state\.attachments,[\s\S]*?\);/,
  );
  assert.match(
    supplementBlock,
    /const readyAttachments = submissionAttachments\.filter\([\s\S]*?\(attachment\) => attachment\.uploadStatus === "uploaded"/,
  );
  assert.match(
    supplementBlock,
    /composerAgentText\(text, readyAttachments, composerQuote\)/,
  );
  assert.match(
    supplementBlock,
    /state\.attachments = failedAttachments;/,
    "sent attachments should be removed from composer state",
  );
});

test("live supplement rendering removes sent files from the attachment upload area", async () => {
  const source = await rendererSource;
  const attachmentPatchBlock = sourceBlock(
    source,
    "function patchComposerPendingAttachments",
    "function patchComposerDynamicState",
  );
  const composerPatchBlock = sourceBlock(
    source,
    "function patchComposerDynamicState",
    "function renderComposerSkillMentionPopover",
  );

  assert.match(attachmentPatchBlock, /new Set\(state\.attachments\.map\(\(attachment\) => attachment\.id\)\)/);
  assert.match(attachmentPatchBlock, /card\.remove\(\)/);
  assert.match(
    attachmentPatchBlock,
    /!state\.attachments\.length[\s\S]*!wrap\.querySelector\("\[data-media-input-kind\], \[data-workflow-input-slot\]"\)[\s\S]*wrap\.remove\(\)/,
  );
  assert.match(composerPatchBlock, /patchComposerPendingAttachments\(form\)/);
});

test("Enter routes an open live supplement through the same composer send path", async () => {
  const source = await rendererSource;
  const keydownBlock = sourceBlock(source, "function bindEvents", "function openChannelDialog");

  assert.match(keydownBlock, /#composerInput[\s\S]*?addEventListener\("keydown"/);
  assert.match(keydownBlock, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(keydownBlock, /!isConversationSupplementWindowOpen\(threadId\)/);
  assert.match(keydownBlock, /void sendCurrentMessage\(threadId\);/);
});
