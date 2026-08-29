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

test("external channel connections enter Recent and use the requested pin order", async () => {
  const source = await rendererSource;
  assert.match(source, /const EXTERNAL_CHANNEL_THREAD_ORDER = \["wechat", "telegram", "feishu"\] as const;/);

  const placement = sourceBlock(
    source,
    "function ensureExternalChannelThreadPlacement",
    "function restoreExternalChannelThreadVisibility",
  );
  assert.match(placement, /delete threadGroupByThreadId\[id\]/);
  assert.match(placement, /setThreadPinPreference\(id, true\)/);

  const topLevel = sourceBlock(
    source,
    "function isTopLevelConversationThread",
    "function renderThreadSection",
  );
  assert.doesNotMatch(topLevel, /isExternalChannelConnectionThread/);

  const assignment = sourceBlock(
    source,
    "function assignThreadToDefaultGroup",
    "function assignThreadsToDefaultGroup",
  );
  assert.match(assignment, /isExternalChannelConnectionThread\(thread\)/);
  assert.match(assignment, /ensureExternalChannelThreadPlacement\(thread\.id, channelId\)/);
});
