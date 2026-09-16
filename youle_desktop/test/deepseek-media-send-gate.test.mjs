import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("DeepSeek blocks queued images and videos before any composer send side effect", async () => {
  const source = await rendererSource;
  const validation = sourceBlock(
    source,
    "const DEEPSEEK_MEDIA_SEND_BLOCKED_MESSAGE",
    "async function sendCurrentMessage",
  );
  const send = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(
    validation,
    /GPT-6 Astra仅支持文本，请移除图片、视频或切换GPT模型。/,
  );
  assert.match(
    validation,
    /isImageAttachment\(attachment\) \|\| isVideoAttachment\(attachment\)/,
  );
  assert.match(validation, /channelIdFromThreadId\(threadId\)/);
  assert.match(
    validation,
    /isMediaCreationMode\(newThreadModeForThread\(threadId\)\)/,
  );
  assert.match(
    validation,
    /selectedChatModelRequestOptions\(threadId\)[\s\S]*executionSettings\.modelProvider !== DEEPSEEK_EXECUTION_PROVIDER_ID/,
  );
  assert.match(
    validation,
    /composerAttachmentsForThread\(threadId\)\.some\(isImageOrVideoAttachment\)/,
  );

  const gateIndex = send.indexOf(
    "const deepSeekMediaError = deepSeekMediaComposerValidationError(threadId)",
  );
  assert.ok(gateIndex >= 0, "missing DeepSeek media send gate");
  assert.match(
    send.slice(gateIndex),
    /if \(deepSeekMediaError\) \{\s*showToast\(deepSeekMediaError, 4600\);\s*return;/,
  );
  for (const sideEffect of [
    "recoverStaleCodexWorkForComposer(threadId)",
    "sendConversationSupplementFromComposer(threadId, input, text)",
    "submittingComposerThreadIds.add(originalThreadId)",
    "beginPendingComposerSend",
  ]) {
    const sideEffectIndex = send.indexOf(sideEffect);
    assert.ok(
      sideEffectIndex > gateIndex,
      `${sideEffect} must happen after the DeepSeek media gate`,
    );
  }
  assert.doesNotMatch(send, /readyAttachments\.some\(isImageAttachment\)/);
});

test("DeepSeek model selection uses the same image and video warning", async () => {
  const source = await rendererSource;
  const selection = sourceBlock(
    source,
    "function threadHasNativeMediaHistory",
    "function selectChatModelForThread",
  );

  assert.match(
    selection,
    /composerAttachmentsForThread\(threadId\)\.some\(isImageOrVideoAttachment\)/,
  );
  assert.match(
    selection,
    /showToast\(DEEPSEEK_MEDIA_SEND_BLOCKED_MESSAGE, 4200\)/,
  );
  assert.match(selection, /threadHasNativeMediaHistory\(threadId\)/);
});

test("the shared toast remains high contrast in light and dark themes", async () => {
  const styles = await stylesSource;
  const toast = sourceBlock(styles, ".toast {", ".contact-request-sent-toast");

  assert.match(toast, /background:\s*rgba\(17, 24, 39, 0\.92\)/);
  assert.match(toast, /color:\s*#fff/);
});
