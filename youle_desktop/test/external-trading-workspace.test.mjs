import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("external channel threads share the trading split workspace surface", async () => {
  const source = await rendererSource;
  const surface = sourceBlock(
    source,
    "function isExternalTradingWorkspaceThreadId",
    "function initializeTradingExpertTaskThread",
  );
  assert.match(surface, /isWechatConnectionThreadId\(id\)/);
  assert.match(surface, /isFeishuConnectionThreadId\(id\)/);
  assert.match(surface, /isTelegramConnectionThreadId\(id\)/);
  assert.match(surface, /function isTradingExpertSurfaceThreadId/);

  const render = sourceBlock(source, "function renderChatPanel", "function tradingExpertPanelToggleLabel");
  assert.match(render, /isExternalTradingWorkspaceThreadId\(thread\.id\)/);
  const panel = sourceBlock(source, "function renderAgentPanel", "function blankNewThreadMembers");
  assert.match(panel, /isExternalTradingWorkspaceThreadId\(threadId\)/);
});

test("external strategy analysis uses the full strategy runner with drawing playback", async () => {
  const source = await rendererSource;
  const runner = sourceBlock(
    source,
    "async function runExternalTradingStrategyAnalysis",
    "async function handleExternalTradingChannelMessage",
  );
  assert.match(runner, /runTradingExpertStrategyConversation\(route\.strategyId/);
  assert.match(runner, /drawingRequested: true/);
  assert.match(runner, /onProgress/);
  assert.doesNotMatch(runner, /responseMode:\s*["']direct["']/);
});

test("external strategy final replies capture the focused chart and send it with the report", async () => {
  const source = await rendererSource;
  const capture = sourceBlock(
    source,
    "async function captureExternalTradingChartAttachment",
    "async function sendExternalTradingReply",
  );
  assert.match(capture, /state\.tradingExpertChartFocusMode = true/);
  assert.match(capture, /prepareTradingExpertMarketForExternalCapture\(\)/);
  assert.match(capture, /captureTradingChart\(/);
  assert.match(capture, /restoreTradingExpertChartFocusLayout\(\)/);

  const reply = sourceBlock(
    source,
    "const result = await runExternalTradingStrategyAnalysis",
    "} catch (error) {",
  );
  assert.match(reply, /captureExternalTradingChartAttachment\(params\.threadId\)/);
  assert.match(reply, /chartAttachment \? \[chartAttachment\] : \[\]/);
});

test("trading surface avatars are hidden only while the chart is split and restored when collapsed", async () => {
  const source = await rendererSource;
  const renderMessage = sourceBlock(source, "function renderMessage(", "function messageRenderSignature");
  assert.match(renderMessage, /isTradingExpertSurfaceThreadId\(message\.conversation_id\)/);
  assert.match(renderMessage, /!state\.tradingExpertChartCollapsed/);
  assert.match(renderMessage, /const showAvatar = !hideAvatarInTradingSplit/);
});
