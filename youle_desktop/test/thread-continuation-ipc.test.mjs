import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("continuation IPC initializes in start-inject-name order and never activates the target", () => {
  const block = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:createContinuationThread"',
    'ipcMain.handle("codex:resumeThread"',
  );
  const start = block.indexOf("requestContinuationThreadStart");
  const inject = block.indexOf('"thread/inject_items"');
  const name = block.indexOf('"thread/name/set"');
  assert.ok(start >= 0 && inject > start && name > inject);
  assert.match(block, /ephemeral:\s*false/);
  assert.doesNotMatch(block, /currentThreadId\s*=/);
  assert.match(preloadSource, /createContinuationThread:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:createContinuationThread", params\)/);
  assert.match(preloadSource, /stageContinuationPrompt:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:stageContinuationPrompt", params\)/);
  assert.match(preloadSource, /discardSupersededContinuations:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:discardSupersededContinuations", params\)/);
  assert.match(preloadSource, /listContinuationTransactions:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:listContinuationTransactions", params\)/);
});

test("continuation IPC deletes a partial target and archives only as cleanup fallback", () => {
  const block = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:createContinuationThread"',
    'ipcMain.handle("codex:resumeThread"',
  );
  const deleteIndex = block.indexOf('"thread/delete"');
  const archiveIndex = block.indexOf('"thread/archive"');
  assert.ok(deleteIndex >= 0 && archiveIndex > deleteIndex);
  assert.doesNotMatch(block, /thread\/fork|thread\/rollback/);
  assert.match(block, /appServerClientByThreadId\.delete\(targetThreadId\)/);
  assert.match(block, /discardedThreadId:\s*targetThreadId \|\| null/);
  assert.match(block, /cleanupStatus/);
});
