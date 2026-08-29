import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const mainSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(start, end) {
  const startIndex = mainSource.indexOf(start);
  const endIndex = mainSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return mainSource.slice(startIndex, endIndex);
}

function loadContinuationStore(userDataDir) {
  const persistence = sourceBlock("function continuationTransactionsPath", "function desktopInstallDir");
  const module = { exports: {} };
  const context = {
    module,
    fs,
    path,
    crypto,
    process,
    Buffer,
    app: { getPath: () => userDataDir },
    console: { warn() {} },
  };
  vm.runInNewContext(`
    const CONTINUATION_TRANSACTIONS_FILE_NAME = "thread-continuation-transactions.json";
    let continuationTransactionsCache = null;
    const bufferedContinuationStartThreadIds = new Set();
    const initializingContinuationThreadIds = new Set();
    const discardedContinuationThreadIds = new Set();
    const publishedContinuationThreadIds = new Set();
    ${persistence}
    module.exports = { loadContinuationTransactions, continuationTransactionsPath };
  `, context);
  return module.exports;
}

function continuationItems(label = "snapshot") {
  const item = (role, kind, contentType, text) => ({
    type: "message",
    role,
    content: [{
      type: contentType,
      text: `<haolo_thread_continuation_${kind}>\n${text}\n</haolo_thread_continuation_${kind}>`,
    }],
  });
  return [
    item("user", "handoff", "input_text", `${label}-handoff`),
    item("user", "copy", "input_text", `${label}-user`),
    item("assistant", "copy", "output_text", `${label}-assistant`),
    item("assistant", "welcome", "output_text", `${label}-welcome`),
  ];
}

test("continuation transactions are atomically persisted with the handoff payload", () => {
  const persistence = sourceBlock("function continuationTransactionsPath", "function desktopInstallDir");
  assert.match(persistence, /thread-continuation-transactions\.json|CONTINUATION_TRANSACTIONS_FILE_NAME/);
  assert.match(persistence, /fs\.fsyncSync\(fd\)/);
  assert.match(persistence, /fs\.renameSync\(tempPath, destination\)/);
  assert.match(persistence, /sourceTitle: record\.sourceTitle/);
  assert.match(persistence, /items: record\.items/);
  assert.match(persistence, /normalized\.length !== 4/);
  assert.match(persistence, /markerOrder\[3\] !== "welcome"/);
  assert.match(persistence, /status === "target_deleted"/);
  assert.match(persistence, /state\.bySourceThreadId\[record\.operationId\] = record/);
  assert.match(persistence, /\[operationId\]: record/);
  assert.match(persistence, /targetThreadIds/);
  assert.match(persistence, /quarantineCorruptContinuationTransactions/);
  assert.match(persistence, /fs\.renameSync\(filePath, backupPath\)/);
  assert.match(persistence, /continuing with an empty ledger/);
  assert.match(persistence, /transaction ledger could not be read; continuing without it/);
  assert.match(persistence, /recovered transaction ledger could not be rewritten/);
  assert.match(persistence, /threadResult\?\.thread\?\.path/);
  assert.match(persistence, /visit\(JSON\.parse\(line\)\)/);
});

test("a prompt is durably staged without creating a thread and removes every older source snapshot", () => {
  const staging = sourceBlock(
    'ipcMain.handle("codex:stageContinuationPrompt"',
    'ipcMain.handle("codex:createContinuationThread"',
  );
  assert.match(staging, /discardSupersededContinuationPrompts\(sourceThreadId, operationId\)/);
  assert.match(staging, /status: "ready"/);
  assert.match(staging, /items/);
  assert.doesNotMatch(staging, /requestContinuationThreadStart|"thread\/start"|"thread\/inject_items"/);
  const pruning = sourceBlock("function discardSupersededContinuationPrompts", "function safeContinuationTransaction");
  assert.match(pruning, /record\.sourceThreadId === sourceId && record\.operationId !== retainedId/);
  assert.match(pruning, /releaseSupersededContinuationTransaction\(record\)/);
  assert.doesNotMatch(pruning, /record\.status === "ready"|record\.status === "failed"/);
});

test("the continuation ledger migrates to at most one full snapshot per source", () => {
  const persistence = sourceBlock("function continuationTransactionsPath", "function desktopInstallDir");
  assert.match(persistence, /const latestBySourceThreadId = new Map/);
  assert.match(persistence, /newerContinuationTransaction\(record, previous\)/);
  assert.match(persistence, /releaseSupersededContinuationTransaction\(superseded\)/);
  assert.match(persistence, /state\.bySourceThreadId\[record\.operationId\] = record/);
});

test("a corrupt ledger is quarantined without breaking ordinary IPC callers", (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-continuation-corrupt-"));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const filePath = path.join(userDataDir, "thread-continuation-transactions.json");
  fs.writeFileSync(filePath, "{truncated", "utf8");

  const store = loadContinuationStore(userDataDir);
  const state = store.loadContinuationTransactions();
  assert.deepEqual(Object.keys(state.bySourceThreadId), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { version: 1, bySourceThreadId: {} });
  assert.equal(
    fs.readdirSync(userDataDir).filter((name) => name.startsWith("thread-continuation-transactions.json.corrupt-")).length,
    1,
  );
});

test("ledger migration physically removes older full snapshots for the same source", (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-continuation-latest-"));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const filePath = path.join(userDataDir, "thread-continuation-transactions.json");
  const older = {
    sourceThreadId: "source-1",
    operationId: "operation-old",
    status: "completed",
    targetThreadId: "target-old",
    targetThreadIds: ["target-old"],
    triggeredAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:01:00.000Z",
    items: continuationItems("old"),
  };
  const latest = {
    sourceThreadId: "source-1",
    operationId: "operation-latest",
    status: "ready",
    triggeredAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-07-15T09:01:00.000Z",
    items: continuationItems("latest"),
  };
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    bySourceThreadId: {
      [older.operationId]: older,
      [latest.operationId]: latest,
    },
  }), "utf8");

  const store = loadContinuationStore(userDataDir);
  const state = store.loadContinuationTransactions();
  assert.deepEqual(Object.keys(state.bySourceThreadId), [latest.operationId]);
  const rewritten = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.deepEqual(Object.keys(rewritten.bySourceThreadId), [latest.operationId]);
  assert.equal(JSON.stringify(rewritten).includes("old-handoff"), false);
});

test("continuation creation is idempotent and records every initialization boundary", () => {
  const creation = sourceBlock(
    'ipcMain.handle("codex:createContinuationThread"',
    'ipcMain.handle("codex:listContinuationTransactions"',
  );
  assert.match(creation, /params\.operationId/);
  assert.match(creation, /params\.idempotencyKey/);
  assert.match(creation, /existing\?\.status === "completed"/);
  assert.match(creation, /"thread\/read"/);
  assert.match(creation, /status: "starting"/);
  assert.match(creation, /status: "injecting"/);
  assert.match(creation, /status: "injected"/);
  assert.match(creation, /status: "naming"/);
  assert.match(creation, /status: "completed"/);
  assert.match(creation, /continuationInjectedItemsPresent/);
  assert.match(creation, /discardedThreadId/);
  assert.match(creation, /cleanupStatus/);
  assert.match(creation, /recoverableStatuses\.has\(existing\.status\)/);
  assert.match(creation, /existing\?\.status === "target_deleted" && existing\.operationId === operationId/);
  assert.match(creation, /targetThreadIds: cleanupThreadIds/);
  assert.match(creation, /requestContinuationThreadStart/);
  assert.match(creation, /completedTargetNotFound/);
  assert.match(creation, /canonicalContinuationResultFields\(existing\)/);
  assert.match(creation, /canonicalContinuationResultFields\(completedRecord\)/);
});

test("partial continuation targets stay hidden until an explicit final thread notification", () => {
  const notifications = sourceBlock("function shouldSuppressContinuationNotification", "function handleClientNotification");
  assert.match(notifications, /pendingContinuationStartByClient/);
  assert.match(notifications, /initializingContinuationThreadIds/);
  assert.match(notifications, /discardedContinuationThreadIds/);
  assert.match(notifications, /bufferedStartNotifications/);
  assert.match(notifications, /responseThreadId/);

  const creation = sourceBlock(
    'ipcMain.handle("codex:createContinuationThread"',
    'ipcMain.handle("codex:listContinuationTransactions"',
  );
  const completed = creation.indexOf('status: "completed"');
  const published = creation.indexOf("publishedContinuationThreadIds.add", completed);
  const notification = creation.indexOf('method: "thread/started"', published);
  assert.ok(completed >= 0 && published > completed && notification > published);

  const send = sourceBlock('ipcMain.handle("codex:sendMessage"', 'ipcMain.handle("codex:interruptTurn"');
  assert.match(send, /initializingContinuationThreadIds\.has\(originalThreadId\)/);
  assert.match(send, /discardedContinuationThreadIds\.has\(originalThreadId\)/);
  const acquire = send.indexOf("acquireSerializedThreadSettingsOperation");
  const lockedInitializingCheck = send.indexOf("initializingContinuationThreadIds.has(originalThreadId)", acquire);
  const lockedDiscardedCheck = send.indexOf("discardedContinuationThreadIds.has(originalThreadId)", acquire);
  assert.ok(acquire >= 0 && lockedInitializingCheck > acquire && lockedDiscardedCheck > acquire);
});

test("late continuation starts are correlated by JSON-RPC response and quarantined", () => {
  const serialization = sourceBlock("async function runSerializedThreadStartOperation", "function wireAppServerClientEvents");
  assert.match(serialization, /capture\.requestId = serverClient\.nextId/);
  assert.match(serialization, /pendingCapture\?\.awaitingLateResponse/);

  const notifications = sourceBlock("function forwardBufferedContinuationStartNotification", "function handleClientNotification");
  assert.match(notifications, /String\(response\.id\) !== String\(capture\.requestId\)/);
  assert.match(notifications, /cleanupLateTargets/);
  assert.match(notifications, /CONTINUATION_LATE_START_RESPONSE_GRACE_MS/);
  assert.match(notifications, /unmatched notifications are not ours/);
});

test("archiving a continuation target creates a persistent tombstone", () => {
  const archive = sourceBlock('ipcMain.handle("codex:archiveThread"', 'ipcMain.handle("codex:sendMessage"');
  assert.match(archive, /continuationTransactionForTarget/);
  const recordLookup = archive.indexOf("continuationTransactionForTarget");
  const workspaceClient = archive.indexOf("getClientForCwd(continuationRecord.cwd", recordLookup);
  assert.ok(recordLookup >= 0 && workspaceClient > recordLookup);
  assert.match(archive, /status: "target_deleted"/);
  assert.match(archive, /cleanupStatus: "archived"/);
});

test("a missing completed continuation target is tombstoned instead of replaced by an empty thread", () => {
  const send = sourceBlock('ipcMain.handle("codex:sendMessage"', 'ipcMain.handle("codex:interruptTurn"');
  const replacement = send.slice(
    send.indexOf("const replaceMissingThread"),
    send.indexOf("const startTurn"),
  );
  assert.match(replacement, /publishedContinuationThreadIds\.has\(previousThreadId\)/);
  assert.match(replacement, /discardedContinuationThreadIds\.has\(previousThreadId\)/);
  const lookup = replacement.indexOf("continuationTransactionForTarget(previousThreadId)");
  const tombstone = replacement.indexOf('status: "target_deleted"', lookup);
  const sourceLock = replacement.indexOf("runSerializedThreadSettingsOperation(", tombstone);
  const rejection = replacement.indexOf("请返回原任务后点击“重新续接”", tombstone);
  const replacementStart = replacement.indexOf("requestThreadStart", rejection);
  assert.ok(lookup >= 0 && tombstone > lookup && sourceLock > tombstone && rejection > sourceLock && replacementStart > rejection);
});
