import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backfillResultArtifactIndexFromSessions,
  buildUnclaimedArtifactIndexEntries,
  extractDeliveredArtifactPaths,
  readResultArtifactIndex,
  resultArtifactIndexPath,
  updateResultArtifactIndex,
  writeResultArtifactIndex,
} from "../src/main/local-artifact-index.mjs";

async function tempWorkspace(name) {
  const dir = path.join(os.tmpdir(), `haolo-local-artifacts-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path.join(dir, "outputs"), { recursive: true });
  return dir;
}

function markdownAnglePath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/").replace(/^([a-zA-Z]:\/)/, "/$1");
}

test("extractDeliveredArtifactPaths only returns delivered outputs paths", async () => {
  const cwd = await tempWorkspace("extract");
  try {
    const summaryPath = path.join(cwd, "outputs", "summary.md");
    const bodyPath = path.join(cwd, "outputs", "body.txt");
    const sourceNameOnly = "source.docx";
    const message = [
      `I analyzed \`${sourceNameOnly}\`.`,
      `Delivered file: [summary.md](${summaryPath})`,
      `Extracted body: \`${bodyPath}\``,
      "The source filename alone should not be indexed.",
    ].join("\n");

    assert.deepEqual(extractDeliveredArtifactPaths(message, { cwd }), [summaryPath, bodyPath]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("extractDeliveredArtifactPaths handles Windows absolute paths wrapped in markdown angle brackets", async () => {
  const cwd = await tempWorkspace("angle");
  try {
    const outputs = path.join(cwd, "outputs");
    const delivered = [
      path.join(outputs, "weather.pdf"),
      path.join(outputs, "weather.docx"),
      path.join(outputs, "weather.txt"),
      path.join(outputs, "weather.md"),
    ];
    const message = delivered.map((filePath) => `[${path.basename(filePath)}](<${markdownAnglePath(filePath)}>)`).join("\n");

    assert.deepEqual(extractDeliveredArtifactPaths(message, { cwd }), delivered.map((filePath) => path.resolve(filePath)));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("backfillResultArtifactIndexFromSessions ignores input files from tool calls", async () => {
  const cwd = await tempWorkspace("backfill");
  try {
    const outputs = path.join(cwd, "outputs");
    const sessionsDir = path.join(cwd, "haolo-ai-home", "sessions", "2026", "06", "27");
    await mkdir(sessionsDir, { recursive: true });

    const sourcePath = path.join(outputs, "source.docx");
    const summaryPath = path.join(outputs, "summary.md");
    const bodyPath = path.join(outputs, "body.txt");
    await writeFile(sourcePath, "input copy");
    await writeFile(summaryPath, "# Summary\n");
    await writeFile(bodyPath, "body\n");

    const sessionRecords = [
      {
        timestamp: "2026-06-27T15:13:45.910Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell_command",
          arguments: JSON.stringify({
            command: `Invoke-WebRequest -OutFile '${sourcePath}'`,
          }),
        },
      },
      {
        timestamp: "2026-06-27T15:15:20.632Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: `Done:\n[summary.md](<${markdownAnglePath(summaryPath)}>)\n[body.txt](${bodyPath})`,
          completed_at: 1782573320,
        },
      },
    ];
    await writeFile(path.join(sessionsDir, "rollout.jsonl"), sessionRecords.map((record) => JSON.stringify(record)).join("\n"));

    await backfillResultArtifactIndexFromSessions({
      cwd,
      outputRoot: outputs,
      sessionsDir: path.join(cwd, "haolo-ai-home", "sessions"),
    });

    const index = JSON.parse(await readFile(resultArtifactIndexPath(outputs), "utf8"));
    assert.deepEqual(
      index.items.map((item) => path.basename(item.path)).sort(),
      ["body.txt", "summary.md"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("result artifact indexes persist workspace-relative paths", async () => {
  const cwd = await tempWorkspace("relative-index");
  try {
    const outputs = path.join(cwd, "outputs");
    const filePath = path.join(outputs, "nested", "result.html");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "result");

    await writeResultArtifactIndex(outputs, {
      items: [{ path: filePath, threadId: "thread-1", turnId: "turn-1" }],
    });

    const stored = JSON.parse(await readFile(resultArtifactIndexPath(outputs), "utf8"));
    assert.equal(stored.version, 2);
    assert.equal(stored.items[0].relative_path, "nested/result.html");
    const restored = await readResultArtifactIndex(outputs);
    assert.equal(restored.items[0].path, filePath);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("legacy absolute artifact paths are rebased after user-data migration", async () => {
  const cwd = await tempWorkspace("legacy-rebase");
  try {
    const outputs = path.join(cwd, "outputs");
    const currentFile = path.join(outputs, "nested", "result.html");
    const staleFile = path.join(path.dirname(cwd), "old-user-data", "thread-groups", "default", "outputs", "nested", "result.html");
    await mkdir(path.dirname(currentFile), { recursive: true });
    await writeFile(currentFile, "result");
    await writeFile(
      resultArtifactIndexPath(outputs),
      JSON.stringify({
        version: 1,
        items: [{ path: staleFile, threadId: "thread-1", turnId: "turn-1" }],
      }),
    );

    const restored = await readResultArtifactIndex(outputs);

    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].path, currentFile);
    assert.equal(restored.items[0].relative_path, path.join("nested", "result.html").replace(/\\/g, "/"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("workspace scan entries remain unclaimed and cannot overwrite an explicit thread owner", async () => {
  const cwd = await tempWorkspace("unclaimed-scan");
  try {
    const outputs = path.join(cwd, "outputs");
    const filePath = path.join(outputs, "whiskey.png");
    await writeFile(filePath, "image");

    const scanned = buildUnclaimedArtifactIndexEntries([filePath], {
      threadId: "thread-cat",
      turnId: "turn-cat",
    });
    assert.equal(scanned[0].threadId, null);
    assert.equal(scanned[0].turnId, null);

    await updateResultArtifactIndex(outputs, scanned);
    const initiallyScanned = await readResultArtifactIndex(outputs);
    assert.equal(initiallyScanned.items[0].threadId, null);
    assert.equal(initiallyScanned.items[0].turnId, null);

    await updateResultArtifactIndex(outputs, [{
      path: filePath,
      threadId: "thread-whiskey",
      turnId: "turn-whiskey",
      source: "final_message",
    }]);
    await updateResultArtifactIndex(outputs, scanned);

    const restored = await readResultArtifactIndex(outputs);
    assert.equal(restored.items[0].threadId, "thread-whiskey");
    assert.equal(restored.items[0].turnId, "turn-whiskey");
    assert.equal(restored.items[0].source, "final_message");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("concurrent artifact index updates preserve every entry", async () => {
  const cwd = await tempWorkspace("concurrent-updates");
  try {
    const outputs = path.join(cwd, "outputs");
    const paths = Array.from({ length: 12 }, (_, index) => path.join(outputs, `result-${index}.txt`));
    await Promise.all(paths.map((filePath) => writeFile(filePath, "result")));

    await Promise.all(paths.map((filePath, index) => (
      updateResultArtifactIndex(outputs, [{
        path: filePath,
        threadId: `thread-${index}`,
        turnId: `turn-${index}`,
      }])
    )));

    const restored = await readResultArtifactIndex(outputs);
    assert.equal(restored.items.length, paths.length);
    assert.deepEqual(
      new Set(restored.items.map((item) => item.threadId)),
      new Set(paths.map((_, index) => `thread-${index}`)),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("main process only associates artifacts through a resolved thread and trusted delivery", async () => {
  const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const handlerStart = mainSource.indexOf("function handleClientNotification(");
  const handlerEnd = mainSource.indexOf("\nfunction recordArtifactAgentMessageNotification", handlerStart);
  const handler = mainSource.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.doesNotMatch(handler, /snapshotThreadArtifacts\([^\n]*currentThreadId/);
  assert.doesNotMatch(handler, /notifyThreadArtifactsChanged\([^\n]*currentThreadId/);

  const notifyStart = mainSource.indexOf("async function notifyThreadArtifactsChanged(");
  const notifyEnd = mainSource.indexOf("\nasync function createQuestionAnswerDerivedMediaResult", notifyStart);
  const notify = mainSource.slice(notifyStart, notifyEnd);
  assert.ok(notifyStart >= 0 && notifyEnd > notifyStart);
  assert.match(
    notify,
    /buildUnclaimedArtifactIndexEntries\(changedOutputItems\.map\(\(item\) => item\.path\)/,
  );
});
