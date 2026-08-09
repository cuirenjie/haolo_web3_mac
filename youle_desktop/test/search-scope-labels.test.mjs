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

test("search controls clearly identify global and current-conversation scope", async () => {
  const source = await mainSource;
  const globalSearch = sourceBlock(source, "function renderChatList", "function isHaoloContact");
  const conversationSearch = sourceBlock(
    source,
    "function renderThreadHistoryPopover",
    "function renderThreadHistoryOptions",
  );

  assert.match(globalSearch, /aria-label="搜索全局记录"/);
  assert.match(globalSearch, /placeholder="搜索全局记录"/);
  assert.match(conversationSearch, /aria-label="搜索此对话，全局至顶部搜"/);
  assert.match(conversationSearch, /placeholder="搜索此对话，全局至顶部搜"/);
  assert.doesNotMatch(conversationSearch, /搜索历史消息/);
});
