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

test("a collapsed conversation group renders a tiny spinner while any child thread is working", async () => {
  const source = await mainSource;
  const renderBlock = sourceBlock(source, "function renderThreadGroupSection", "function groupedThreadsForList");

  assert.match(renderBlock, /const working = collapsed && threads\.some\(\(thread\) => isConversationThreadWorking\(thread\.id\)\)/);
  assert.match(renderBlock, /conversation-group-title \$\{working \? "is-working" : ""\}/);
  assert.match(renderBlock, /working \? `<span class="thread-group-working-spinner"/);
  assert.ok(
    renderBlock.indexOf("${moreButton}") < renderBlock.indexOf('class="thread-group-working-spinner"'),
    "the group spinner should occupy the rightmost title slot",
  );
});

test("group working state stays aggregated when a hidden child thread starts or finishes", async () => {
  const source = await mainSource;
  const rowSyncBlock = sourceBlock(source, "function syncConversationRowWorkingState", "function syncConversationGroupWorkingStates");
  const groupSyncBlock = sourceBlock(source, "function syncConversationGroupWorkingStates", "function patchConversationRow");

  assert.ok(
    rowSyncBlock.indexOf("syncConversationGroupWorkingStates()") < rowSyncBlock.indexOf("if (!row) return"),
    "collapsed groups must update even though their child rows are not mounted",
  );
  assert.match(groupSyncBlock, /const workingGroupIds = new Set<string>\(\)/);
  assert.match(groupSyncBlock, /for \(const thread of state\.threads\)/);
  assert.match(groupSyncBlock, /workingGroupIds\.add\(knownThreadGroupId\(rawGroupId\)\)/);
  assert.match(groupSyncBlock, /section\.classList\.contains\("collapsed"\) && workingGroupIds\.has/);
  assert.match(groupSyncBlock, /if \(working && !spinner\)/);
  assert.match(groupSyncBlock, /else if \(!working && spinner\)/);
});

test("the collapsed group spinner is smaller than the conversation row spinner", async () => {
  const styles = await stylesSource;
  const groupSpinnerBlock = sourceBlock(styles, ".thread-group-working-spinner", "@keyframes thread-group-working-spin");

  assert.match(groupSpinnerBlock, /width: 10px/);
  assert.match(groupSpinnerBlock, /height: 10px/);
  assert.match(styles, /\.conversation-group-title\.is-working\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 24px 12px/);
  assert.match(styles, /\.conversation-row-spinner\s*\{[\s\S]*width: 17px;[\s\S]*height: 17px;/);
});
