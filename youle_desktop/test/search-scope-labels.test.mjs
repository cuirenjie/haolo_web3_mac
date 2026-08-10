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

test("the removed global search leaves only the current-conversation search", async () => {
  const source = await mainSource;
  const chatList = sourceBlock(source, "function renderChatList", "function isHaoloContact");
  const conversationSearch = sourceBlock(
    source,
    "function renderThreadHistoryPopover",
    "function renderThreadHistoryOptions",
  );

  assert.doesNotMatch(chatList, /type="search"|搜索全局记录|chat-search-box/);
  assert.match(conversationSearch, /aria-label="搜索此对话"/);
  assert.match(conversationSearch, /placeholder="搜索此对话"/);
  assert.doesNotMatch(source, /搜索全局记录|codex:searchThreads|searchThreads/);
});
