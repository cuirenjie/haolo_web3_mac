import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("a conversation group renders a blue dot while any child final result is unviewed", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function renderThreadGroupSection", "function groupedThreadsForList");

  assert.match(renderBlock, /const hasUnviewed = threads\.some\(\(thread\) => hasUnviewedFinalResult\(thread\.id\)\)/);
  assert.match(renderBlock, /hasUnviewed \? "has-unviewed" : ""/);
  assert.match(renderBlock, /hasUnviewed \? `<span class="thread-group-unviewed-dot"/);
});

test("the group blue dot updates even when the changed child row is collapsed", async () => {
  const source = await mainSource;
  const syncBlock = sourceBlock(source, "function syncConversationGroupUnviewedStates", "function patchConversationRow");
  const patchBlock = sourceBlock(source, "function patchConversationRow", "function patchWorkingConversationRowInPlace");

  assert.match(syncBlock, /const unviewedGroupIds = new Set<string>\(\)/);
  assert.match(syncBlock, /hasUnviewedFinalResult\(thread\.id\)/);
  assert.match(syncBlock, /unviewedGroupIds\.add\(knownThreadGroupId\(rawGroupId\)\)/);
  assert.match(syncBlock, /title\.classList\.toggle\("has-unviewed", hasUnviewed\)/);
  assert.match(syncBlock, /if \(hasUnviewed && !dot\)/);
  assert.match(syncBlock, /else if \(!hasUnviewed && dot\)/);
  assert.ok(
    patchBlock.indexOf("syncConversationGroupUnviewedStates()") < patchBlock.indexOf("if (!row || !thread) return false"),
    "collapsed groups must update before a missing child row returns early",
  );
});

test("the group indicator matches the existing unviewed-result blue dot", async () => {
  const styles = await stylesSource;
  const groupDotBlock = sourceBlock(styles, ".thread-group-unviewed-dot", "@keyframes thread-group-working-spin");
  const rowDotBlock = sourceBlock(styles, ".final-result-unviewed-dot", ".task-anchor-avatar");

  assert.match(groupDotBlock, /width: 9px/);
  assert.match(groupDotBlock, /height: 9px/);
  assert.match(groupDotBlock, /background: #0088ff/);
  assert.match(rowDotBlock, /background: #0088ff/);
  assert.match(styles, /\.conversation-group-title\.is-working\.has-unviewed\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 24px 9px 12px/);
});
