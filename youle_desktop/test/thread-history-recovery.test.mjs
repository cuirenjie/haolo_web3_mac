import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AppServerClient } from "../src/main/app-server-client.mjs";
import { classifyTurnFailure } from "../src/main/turn-diagnostics.mjs";
import { isUnsupportedThreadHistoryError, repairThreadHistoryIndex, requestWithThreadHistoryRecovery } from "../src/main/thread-history-recovery.mjs";

const THREAD = "01a0a572-0c50-7573-a037-5a8a0e190e5b";
const OTHER = "01a0a572-0c50-7573-a037-5a8a0e190e5b".replace(/b$/, "c");
const unsupported = () => Object.assign(new Error("list_turns is not supported yet"), { data: { code: -32601 } });

function fixture(t, { fileMode = "paginated", indexMode = "legacy", separateSqliteHome = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-history-recovery-"));
  const codexHome = path.join(root, "runtime");
  const sqliteHome = separateSqliteHome ? path.join(root, "sqlite") : codexHome;
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.mkdirSync(sqliteHome, { recursive: true });
  const rolloutPath = path.join(codexHome, "sessions", `rollout-${THREAD}.jsonl`);
  const content = `${JSON.stringify({ type: "session_meta", payload: { id: THREAD, history_mode: fileMode } })}\n${JSON.stringify({ type: "response_item", payload: { text: "private conversation contents" } })}\n`;
  fs.writeFileSync(rolloutPath, content);
  const dbPath = path.join(sqliteHome, "state_5.sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, history_mode TEXT NOT NULL, name TEXT, archived INTEGER, tokens_used INTEGER)");
  database.prepare("INSERT INTO threads VALUES(?, ?, ?, 'original title', 1, 1234)").run(THREAD, rolloutPath, indexMode);
  database.prepare("INSERT INTO threads VALUES(?, ?, 'legacy', 'other title', 0, 99)").run(OTHER, rolloutPath);
  t.after(() => {
    database.close();
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^haolo-history-recovery-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { root, codexHome, sqliteHome, rolloutPath, content, database, dbPath, threadId: THREAD };
}

test("repairs only a verified mismatched index row and writes a reversible journal without transcript text", async (t) => {
  const f = fixture(t);
  const before = f.database.prepare("SELECT * FROM threads ORDER BY id").all();
  assert.deepEqual(await repairThreadHistoryIndex(f), { status: "repaired", reason: "verified_history_mode_mismatch" });
  const after = f.database.prepare("SELECT * FROM threads ORDER BY id").all();
  assert.deepEqual(after.map((row) => ({ ...row })), before.map((row) => ({ ...row, ...(row.id === THREAD ? { history_mode: "paginated" } : {}) })));
  assert.equal(fs.readFileSync(f.rolloutPath, "utf8"), f.content);
  const backupRoot = path.join(f.sqliteHome, "haolo-history-index-recovery");
  const files = fs.readdirSync(backupRoot);
  assert.equal(files.length, 1);
  const backup = JSON.parse(fs.readFileSync(path.join(backupRoot, files[0]), "utf8"));
  assert.equal(backup.before.historyMode, "legacy");
  assert.equal(backup.after.historyMode, "paginated");
  assert.equal(backup.headerHash, createHash("sha256").update(f.content.split("\n")[0]).digest("hex"));
  assert.doesNotMatch(JSON.stringify(backup), /private conversation|original title/);
  assert.equal((await repairThreadHistoryIndex(f)).status, "consistent");
  assert.equal(fs.readdirSync(backupRoot).length, 1);
});

test("refuses incompatible or uncertain history without changing data", async (t) => {
  for (const [name, options, mutate, reason] of [
    ["legacy file", { fileMode: "legacy" }, () => {}, "rollout_is_not_paginated"],
    ["new unknown index", { indexMode: "future" }, () => {}, "unknown_index_history_mode"],
    ["missing index", {}, (f) => f.database.prepare("DELETE FROM threads WHERE id=?").run(THREAD), "thread_index_missing"],
    ["different identity", {}, (f) => fs.writeFileSync(f.rolloutPath, `${JSON.stringify({ type: "session_meta", payload: { id: OTHER, history_mode: "paginated" } })}\n`), "rollout_identity_mismatch"],
    ["external file", {}, (f) => {
      const outside = path.join(f.root, "outside.jsonl");
      fs.copyFileSync(f.rolloutPath, outside);
      f.database.prepare("UPDATE threads SET rollout_path=? WHERE id=?").run(outside, THREAD);
    }, "rollout_outside_runtime_home"],
  ]) {
    await t.test(name, async (t) => {
      const f = fixture(t, options);
      mutate(f);
      const before = f.database.prepare("SELECT * FROM threads").all();
      assert.deepEqual(await repairThreadHistoryIndex(f), { status: "unavailable", reason });
      assert.deepEqual(f.database.prepare("SELECT * FROM threads").all(), before);
      assert.equal(fs.existsSync(path.join(f.sqliteHome, "haolo-history-index-recovery")), false);
    });
  }
});

test("backup failure rolls back and releases the database lock", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.sqliteHome, "haolo-history-index-recovery"), "blocked");
  await assert.rejects(repairThreadHistoryIndex(f));
  assert.equal(f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode, "legacy");
  assert.doesNotThrow(() => f.database.exec("BEGIN IMMEDIATE; ROLLBACK"));
});

test("rollout replacement during backup aborts rather than promoting an outdated format", async (t) => {
  const f = fixture(t);
  const originalFsync = fs.fsyncSync;
  t.mock.method(fs, "fsyncSync", (fd) => {
    originalFsync(fd);
    fs.writeFileSync(f.rolloutPath, `${JSON.stringify({ type: "session_meta", payload: { id: THREAD, history_mode: "legacy" } })}\n`);
  });
  await assert.rejects(repairThreadHistoryIndex(f), /rollout_changed_during_repair/);
  assert.equal(f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode, "legacy");
  assert.doesNotThrow(() => f.database.exec("BEGIN IMMEDIATE; ROLLBACK"));
});

test("missing storage and malformed headers never create an empty replacement database", async (t) => {
  const f = fixture(t);
  const absentRoot = path.join(f.root, "absent-index");
  fs.mkdirSync(absentRoot);
  await assert.rejects(repairThreadHistoryIndex({ ...f, sqliteHome: absentRoot }), { code: "ENOENT" });
  assert.deepEqual(fs.readdirSync(absentRoot), []);
  fs.writeFileSync(f.rolloutPath, '{"type":"session_meta"');
  await assert.rejects(repairThreadHistoryIndex(f), /incomplete_rollout_header/);
  assert.equal(f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode, "legacy");
  assert.equal(fs.existsSync(path.join(f.sqliteHome, "haolo-history-index-recovery")), false);
});

test("database writer contention yields and retries without resetting history", async (t) => {
  const f = fixture(t);
  f.database.exec("BEGIN IMMEDIATE");
  const timer = setTimeout(() => f.database.exec("ROLLBACK"), 50);
  t.after(() => clearTimeout(timer));
  assert.equal((await repairThreadHistoryIndex(f)).status, "repaired");
});

test("history calls recover on the same thread with original settings and configured sqlite_home", async (t) => {
  for (const method of ["thread/resume", "thread/read", "thread/turns/list", "thread/items/list"]) {
    await t.test(method, async (t) => {
      const f = fixture(t, { separateSqliteHome: true });
      const params = { threadId: THREAD, model: "gpt-5.5", includeTurns: true, excludeTurns: false, cwd: "preserved-cwd" };
      const calls = [];
      const events = [];
      const result = { thread: { id: THREAD, turns: [{ id: "prior-turn" }] } };
      const request = async (m, p, timeout) => {
        calls.push({ m, p, timeout });
        if (m === "config/read") return { config: { sqlite_home: f.sqliteHome } };
        if (f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode === "legacy") throw unsupported();
        return result;
      };
      assert.equal(await requestWithThreadHistoryRecovery({ request, method, params, timeoutMs: 12345, codexHome: f.codexHome, onRecovery: (e) => events.push(e) }), result);
      assert.deepEqual(calls.map((c) => c.m), [method, "config/read", method]);
      assert.equal(calls[2].p, params);
      assert.equal(calls[2].timeout, 12345);
      assert.deepEqual(events.map((e) => e.status), ["repaired", "verified"]);
      assert.doesNotMatch(JSON.stringify(events), new RegExp(THREAD));
    });
  }
});

test("concurrent readers coalesce repair and retain their independent responses", async (t) => {
  const f = fixture(t);
  let configReads = 0;
  const request = async (method, params) => {
    if (method === "config/read") { configReads++; await new Promise((r) => setTimeout(r, 15)); return { config: {} }; }
    if (f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode === "legacy") throw unsupported();
    return { method, cursor: params.cursor };
  };
  const invoke = (method, cursor) => requestWithThreadHistoryRecovery({ request, method, params: { threadId: THREAD, cursor }, codexHome: f.codexHome });
  assert.deepEqual(await Promise.all([invoke("thread/read", "a"), invoke("thread/resume", "b")]), [
    { method: "thread/read", cursor: "a" }, { method: "thread/resume", cursor: "b" },
  ]);
  assert.equal(configReads, 1);
  assert.equal(fs.readdirSync(path.join(f.sqliteHome, "haolo-history-index-recovery")).length, 1);
});

test("unrecoverable storage stops with an actionable error and never recreates a thread", async (t) => {
  const f = fixture(t, { fileMode: "legacy" });
  const calls = [];
  const request = async (method) => { calls.push(method); if (method === "config/read") return { config: {} }; throw unsupported(); };
  await assert.rejects(requestWithThreadHistoryRecovery({ request, method: "thread/resume", params: { threadId: THREAD }, codexHome: f.codexHome }), (e) => {
    assert.equal(e.code, "HAOLO_THREAD_HISTORY_UNAVAILABLE");
    assert.equal(e.data.historyRecoveryReason, "rollout_is_not_paginated");
    assert.equal(classifyTurnFailure(e.message), "thread_history_index");
    assert.doesNotMatch(e.message, /thread not found|no rollout found/i);
    return true;
  });
  assert.deepEqual(calls, ["thread/resume", "config/read"]);
});

test("unsupported errors after one recovery are bounded; unrelated errors retain their identity", async (t) => {
  const f = fixture(t);
  let reads = 0;
  const request = async (method) => {
    if (method === "config/read") return { config: {} };
    reads++; throw unsupported();
  };
  await assert.rejects(requestWithThreadHistoryRecovery({ request, method: "thread/read", params: { threadId: THREAD }, codexHome: f.codexHome }), (e) => e.data.historyRecoveryReason === "runtime_history_still_unavailable");
  assert.equal(reads, 2);
  for (const method of ["turn/start", "thread/start", "thread/fork", "thread/archive"]) {
    const error = unsupported(); let attempts = 0;
    await assert.rejects(requestWithThreadHistoryRecovery({ request: async () => { attempts++; throw error; }, method, params: { threadId: THREAD }, codexHome: f.codexHome }), (e) => e === error);
    assert.equal(attempts, 1);
  }
  const timeout = new Error("thread/resume timed out");
  await assert.rejects(requestWithThreadHistoryRecovery({ request: async () => { throw timeout; }, method: "thread/resume", params: { threadId: THREAD }, codexHome: f.codexHome }), (e) => e === timeout);
});

test("normal AppServerClient entrypoint uses the recovery and preserves JSON-RPC errors", async (t) => {
  const f = fixture(t);
  const client = new AppServerClient({ codexHome: f.codexHome });
  client.ws = { readyState: 1, send: (wire) => {
    const { id, method } = JSON.parse(wire);
    queueMicrotask(() => {
      if (method === "config/read") client.handleMessage(JSON.stringify({ id, result: { config: {} } }));
      else if (f.database.prepare("SELECT history_mode FROM threads WHERE id=?").get(THREAD).history_mode === "legacy") client.handleMessage(JSON.stringify({ id, error: { code: -32601, message: "list_turns is not supported yet" } }));
      else client.handleMessage(JSON.stringify({ id, result: { thread: { id: THREAD } } }));
    });
  } };
  assert.equal((await client.request("thread/resume", { threadId: THREAD })).thread.id, THREAD);
  assert.equal(client.pending.size, 0);
  assert.equal(isUnsupportedThreadHistoryError(unsupported()), true);
  assert.equal(isUnsupportedThreadHistoryError(Object.assign(unsupported(), { data: { code: -32603 } })), false);
  assert.equal(classifyTurnFailure("list_items is not supported yet"), "thread_history_index");
});
