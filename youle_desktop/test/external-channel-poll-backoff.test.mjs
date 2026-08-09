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

test("external channel message polling uses backoff and auth failure circuit breakers", async () => {
  const source = await mainSource;

  assert.match(source, /const EXTERNAL_CHANNEL_MESSAGE_POLL_BACKOFF_MAX_MS = 5 \* 60_000;/);
  assert.match(source, /const EXTERNAL_CHANNEL_MESSAGE_POLL_LOG_THROTTLE_MS = 60_000;/);
  assert.match(source, /const externalChannelPollBackoffState: Record<ExternalChannelId,/);

  const helpersBlock = sourceBlock(source, "function resetExternalChannelPollBackoff", "async function pollWechatChannelMessages");
  assert.match(helpersBlock, /pollState\.failureCount = 0;/);
  assert.match(helpersBlock, /function markExternalChannelPollFailure\(channelId: ExternalChannelId\)/);
  assert.match(helpersBlock, /pollState\.failureCount \+= 1;/);
  assert.match(helpersBlock, /WECHAT_CHANNEL_MESSAGE_POLL_TRANSIENT_INTERVAL_MS \* 2 \*\* backoffStep/);
  assert.match(helpersBlock, /nextPollDelayMs >= EXTERNAL_CHANNEL_MESSAGE_POLL_BACKOFF_MAX_MS/);
  assert.match(helpersBlock, /function disconnectExternalChannelAfterPollBackoffCap\(channelId: ExternalChannelId\)/);
  assert.match(helpersBlock, /resetExternalChannelPollBackoff\(channelId\);/);
  assert.match(helpersBlock, /result\?\.raw\?\.transientError/);
  assert.match(helpersBlock, /function isExternalChannelAuthFailure\(error: unknown\)/);
  assert.match(helpersBlock, /status === 401 \|\| status === 403/);
  assert.match(helpersBlock, /EXTERNAL_CHANNEL_MESSAGE_POLL_LOG_THROTTLE_MS/);

  const wechatStartBlock = sourceBlock(source, "function startWechatChannelMessagePolling", "function stopWechatChannelMessagePolling");
  assertStartPollBlock(wechatStartBlock, "wechat");
  const wechatBlock = sourceBlock(source, "async function pollWechatChannelMessages", "function startFeishuChannelMessagePolling");
  assertChannelPollBlock(wechatBlock, "wechat", "markWechatChannelDisconnected");
  assert.match(wechatBlock, /logWechatPollDiagnostic\("wechat\.poll\.auth_required"/);
  assert.match(wechatBlock, /logWechatPollDiagnostic\("wechat\.poll\.transient_unavailable"/);

  const feishuStartBlock = sourceBlock(source, "function startFeishuChannelMessagePolling", "function stopFeishuChannelMessagePolling");
  assertStartPollBlock(feishuStartBlock, "feishu");
  const feishuBlock = sourceBlock(source, "async function pollFeishuChannelMessages", "function startTelegramChannelMessagePolling");
  assertChannelPollBlock(feishuBlock, "feishu", "markFeishuChannelDisconnected");

  const telegramStartBlock = sourceBlock(source, "function startTelegramChannelMessagePolling", "function stopTelegramChannelMessagePolling");
  assertStartPollBlock(telegramStartBlock, "telegram");
  const telegramBlock = sourceBlock(source, "async function pollTelegramChannelMessages", "function queueFeishuChannelMessage");
  assertChannelPollBlock(telegramBlock, "telegram", "markTelegramChannelDisconnected");
});

function assertStartPollBlock(block, channel) {
  assert.match(block, new RegExp(`delayMs <= WECHAT_CHANNEL_MESSAGE_POLL_INTERVAL_MS\\) resetExternalChannelPollBackoff\\("${channel}"\\);`));
}

function assertChannelPollBlock(block, channel, disconnectFunction) {
  assert.match(block, /const transientError = externalChannelPollHasTransientError\(result\);/);
  assert.match(block, /status === "unavailable"\s*\|\|\s*transientError/);
  assert.match(block, new RegExp(`resetExternalChannelPollBackoff\\("${channel}"\\);`));
  assert.match(block, new RegExp(`const pollFailure = markExternalChannelPollFailure\\("${channel}"\\);`));
  assert.match(block, /nextPollDelayMs = pollFailure\.nextPollDelayMs;/);
  assert.match(block, /if \(pollFailure\.shouldDisconnect\) \{/);
  assert.match(block, new RegExp(`disconnectExternalChannelAfterPollBackoffCap\\("${channel}"\\);`));
  assert.match(block, /if \(isExternalChannelAuthFailure\(error\)\) \{/);
  assert.match(block, new RegExp(`${disconnectFunction}\\(`));
  assert.doesNotMatch(block, /nextPollDelayMs = WECHAT_CHANNEL_MESSAGE_POLL_TRANSIENT_INTERVAL_MS;/);
}
