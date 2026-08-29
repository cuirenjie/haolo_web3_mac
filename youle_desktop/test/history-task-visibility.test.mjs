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

test("history tasks stay hidden until the first real conversation exists", async () => {
  const source = await rendererSource;
  const sections = sourceBlock(
    source,
    "function renderThreadSections",
    "function conversationGroupSectionsForList",
  );
  const groupSections = sourceBlock(
    source,
    "function conversationGroupSectionsForList",
    "function isTopLevelConversationThread",
  );

  assert.match(
    sections,
    /threads\.filter\(\(thread\) => !isBlankNewThread\(thread\.id\)\)/,
  );
  assert.match(
    groupSections,
    /if \(grouped\.defaultThreads\.length\) \{\s*byGroupId\.set\(defaultGroup\.id, \{ group: defaultGroup, threads: grouped\.defaultThreads \}\);\s*\}/,
  );
});
