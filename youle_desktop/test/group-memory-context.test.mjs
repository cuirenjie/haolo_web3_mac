import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { excludeCurrentThreadMemory } from "../src/main/group-memory-context.mjs";

const threadId = "11111111-2222-3333-4444-555555555555";
const current = `C:\\用户\\sessions\\2026\\rollout-2026-10-25-${threadId}.jsonl`;
const other = "C:\\用户\\sessions\\rollout-2026-10-25-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl";

test("only the known current rollout is excluded, preserving other tasks and unknown identities", () => {
  const files = [current, other, `${current}.backup`, `C:/${threadId}/rollout-other.jsonl`];
  assert.deepEqual(excludeCurrentThreadMemory(files, threadId.toUpperCase()), files.slice(1));
  for (const id of [null, "", "current", "../invalid"]) assert.equal(excludeCurrentThreadMemory(files, id), files);
  assert.equal(files.length, 4);
});

test("real group-memory builder no longer reads or re-injects the active transcript", () => {
  const source = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildThreadGroupMemoryInstructions(");
  const end = source.indexOf("\nfunction buildThreadGroupContextInstructions(", start);
  const read = [];
  const build = vm.runInNewContext(`(${source.slice(start, end)})`, {
    path, excludeCurrentThreadMemory,
    performanceTimingStart: () => 0,
    desktopWorkspace: () => "C:/用户",
    workspaceCodexHome: value => value,
    recentGroupSessionFiles: () => [current, other],
    readGroupSessionMemoryRecord: file => { read.push(file); return { timeLabel: "2026-10-25", title: "other task", messages: [{ role: "user", text: file === current ? "redundant current request" : "necessary earlier task fact" }] }; },
    GROUP_MEMORY_MAX_TOTAL_CHARS: 7_000,
  });
  const text = build("C:/用户", { currentThreadId: threadId });
  assert.deepEqual(read, [other]);
  assert.match(text, /necessary earlier task fact/);
  assert.doesNotMatch(text, /redundant current request/);
  // Actual turn entry passes its owned ID; never rely on the UI's global task.
  assert.match(source, /"before-turn",[\s\S]{0,650}videoGenerationOptions,\s*\{ currentThreadId: threadId \}/);
  assert.match(source, /buildThreadGroupMemoryInstructions\(cwd \|\| desktopWorkspace\(\), contextPolicy\)/);
});
