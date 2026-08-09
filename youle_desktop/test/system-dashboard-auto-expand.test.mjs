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

test("sending a new message expands the system dashboard for every composer-backed conversation", async () => {
  const source = await rendererSource;
  const helper = sourceBlock(
    source,
    "function expandSystemDashboardForNewMessage",
    "function conversationSupplementSteerText",
  );

  assert.match(helper, /state\.chatPreview = null/);
  assert.match(helper, /state\.closingPreviewSource === "chat"/);
  assert.match(helper, /window\.clearTimeout\(previewCloseTimer\)/);
  assert.match(helper, /state\.rightCollapsed = false/);
  assert.match(helper, /classList\.remove\("right-panel-collapsed"\)/);
  assert.match(helper, /syncAgentPanelState\(\)/);

  const send = sourceBlock(source, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  const expandIndex = send.indexOf("expandSystemDashboardForNewMessage()");
  const channelIndex = send.indexOf("const channelId = channelIdFromThreadId(threadId)");
  const providerIndex = send.indexOf("const provider = providerFromThreadId(threadId)");
  assert.ok(expandIndex >= 0, "the shared composer send path should expand the system dashboard");
  assert.ok(expandIndex < channelIndex, "channel conversations should inherit dashboard expansion");
  assert.ok(expandIndex < providerIndex, "provider and video conversations should inherit dashboard expansion");

  const supplement = sourceBlock(
    source,
    "async function sendConversationSupplementFromComposer",
    "async function steerConversationSupplement",
  );
  assert.match(
    supplement,
    /submittingComposerThreadIds\.add\(threadId\);\s*expandSystemDashboardForNewMessage\(\);/,
  );
});
