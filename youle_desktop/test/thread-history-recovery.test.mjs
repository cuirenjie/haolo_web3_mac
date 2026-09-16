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

function emptyFixture(t, options = {}) {
  const f = fixture(t, options);
  f.database.prepare("DELETE FROM threads WHERE id = ?").run(THREAD);
  const sha = "a".repeat(40);
  const header = { type: "session_meta", payload: {
    id: THREAD, history_mode: "paginated", git: { commit_hash: sha },
  } };
  fs.writeFileSync(f.rolloutPath, `${JSON.stringify(header)}\n`);
  const history = new DatabaseSync(path.join(f.sqliteHome, "thread_history_1.sqlite"));
  history.exec(`
    CREATE TABLE thread_turns(thread_id TEXT);
    CREATE TABLE thread_items(thread_id TEXT);
    CREATE TABLE thread_realtime_items(thread_id TEXT);
    CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY, next_rollout_byte_offset INTEGER, next_rollout_ordinal INTEGER);
  `);
  history.prepare("INSERT INTO thread_history_projection_state VALUES (?, ?, 1)").run(THREAD, fs.statSync(f.rolloutPath).size);
  // Close before the parent fixture removes its directory on Windows.
  history.close();
  const thread = {
    id: THREAD, historyMode: "paginated", ephemeral: false, forkedFromId: null,
    parentThreadId: null, preview: "", status: { type: "idle" }, path: f.rolloutPath,
    gitInfo: { sha, branch: "dev", originUrl: "https://example.test/repo.git" }, turns: [],
  };
  const calls = [];
  const request = async (method, params, timeout) => {
    calls.push({ method, params, timeout });
    if (method === "config/read") return { config: { sqlite_home: f.sqliteHome } };
    if (method === "thread/read" && params.includeTurns === false) return { thread };
    if (method === "thread/metadata/update") {
      assert.deepEqual(params, { threadId: THREAD, gitInfo: { sha: thread.gitInfo?.sha ?? null } });
      f.database.prepare("INSERT INTO threads VALUES (?, ?, 'paginated', NULL, 0, 0)").run(THREAD, f.rolloutPath);
      return { thread };
    }
    if (!f.database.prepare("SELECT 1 FROM threads WHERE id = ?").get(THREAD)) throw unsupported();
    return { thread, method, params };
  };
  return { ...f, header, thread, calls, request };
}

test("materializes only verified empty tasks via runtime metadata, preserving every original history request", async (t) => {
  for (const method of ["thread/read", "thread/resume", "thread/turns/list", "thread/items/list"]) {
    await t.test(method, async (t) => {
      const f = emptyFixture(t, { separateSqliteHome: true });
      const beforeFile = fs.readFileSync(f.rolloutPath);
      const beforeOther = f.database.prepare("SELECT * FROM threads WHERE id = ?").get(OTHER);
      const params = { threadId: THREAD, includeTurns: true, excludeTurns: true, model: "chosen-model", cursor: "original-cursor" };
      const events = [];
      const result = await requestWithThreadHistoryRecovery({
        ...f, method, params, timeoutMs: 12345, onRecovery: (event) => events.push(event),
      });
      assert.equal(result.params, params);
      assert.equal(f.calls.at(-1).timeout, 12345);
      assert.deepEqual(f.calls.map((call) => call.method), [method, "config/read", "thread/read", "thread/metadata/update", method]);
      assert.deepEqual(fs.readFileSync(f.rolloutPath), beforeFile);
      assert.deepEqual(f.database.prepare("SELECT * FROM threads WHERE id = ?").get(OTHER), beforeOther);
      assert.deepEqual(events.map((event) => event.status), ["repaired", "verified"]);
      assert.equal(events[0].reason, "verified_empty_thread_materialized");
      const journalRoot = path.join(f.sqliteHome, "haolo-history-index-recovery");
      const journals = fs.readdirSync(journalRoot);
      assert.equal(journals.length, 1);
      const journal = JSON.parse(fs.readFileSync(path.join(journalRoot, journals[0])));
      assert.equal(journal.operation, "materialize_verified_empty_thread_index");
      assert.deepEqual(journal.before, { indexPresent: false });
      assert.doesNotMatch(JSON.stringify(journal), /chosen-model|example.test|private conversation/);
    });
  }
});

test("missing indexes for nonempty, inherited, active, or unverified tasks remain protected", async (t) => {
  const projectedItem = (table, ordinal = false) => (f) => {
    const db = new DatabaseSync(path.join(f.sqliteHome, "thread_history_1.sqlite"));
    try {
      if (ordinal) db.prepare("UPDATE thread_history_projection_state SET next_rollout_ordinal = 2 WHERE thread_id = ?").run(THREAD);
      else db.prepare(`INSERT INTO ${table} VALUES (?)`).run(THREAD);
    } finally { db.close(); }
  };
  for (const [name, mutate] of [
    ["real history despite empty RPC turns", (f) => fs.appendFileSync(f.rolloutPath, JSON.stringify({ type: "response_item", payload: { text: "preserve me" } }) + "\n")],
    ["truncated history", (f) => fs.appendFileSync(f.rolloutPath, '{"type":')],
    ["projected turn", projectedItem("thread_turns")],
    ["projected item", projectedItem("thread_items")],
    ["projected realtime item", projectedItem("thread_realtime_items")],
    ["previously projected history", projectedItem(null, true)],
    ["fork", (f) => { f.thread.forkedFromId = OTHER; }],
    ["child", (f) => { f.thread.parentThreadId = OTHER; }],
    ["active task", (f) => { f.thread.status.type = "active"; }],
    ["ephemeral task", (f) => { f.thread.ephemeral = true; }],
    ["legacy task", (f) => { f.thread.historyMode = "legacy"; }],
    ["wrong task", (f) => { f.thread.id = OTHER; }],
    ["missing git identity", (f) => { delete f.thread.gitInfo; }],
    ["changed git identity", (f) => { f.thread.gitInfo.sha = "b".repeat(40); }],
    ["header identity mismatch", (f) => { f.header.payload.id = OTHER; fs.writeFileSync(f.rolloutPath, JSON.stringify(f.header) + "\n"); }],
    ["archived rollout", (f) => { const archived = path.join(f.codexHome, "archived_sessions"); fs.mkdirSync(archived); f.thread.path = path.join(archived, "archived.jsonl"); fs.copyFileSync(f.rolloutPath, f.thread.path); }],
    ["external rollout", (f) => { f.thread.path = path.join(f.root, "outside.jsonl"); fs.copyFileSync(f.rolloutPath, f.thread.path); }],
  ]) {
    await t.test(name, async (t) => {
      const f = emptyFixture(t);
      mutate(f);
      const beforeRows = f.database.prepare("SELECT * FROM threads").all();
      const beforeFile = fs.readFileSync(f.rolloutPath);
      await assert.rejects(requestWithThreadHistoryRecovery({ ...f, method: "thread/read", params: { threadId: THREAD, includeTurns: true } }), { code: "HAOLO_THREAD_HISTORY_UNAVAILABLE" });
      assert.equal(f.calls.some((call) => call.method === "thread/metadata/update"), false);
      assert.deepEqual(f.database.prepare("SELECT * FROM threads").all(), beforeRows);
      assert.deepEqual(fs.readFileSync(f.rolloutPath), beforeFile);
    });
  }
});

test("empty task initialization coalesces concurrent readers and rechecks rollout changes before mutation", async (t) => {
  await t.test("concurrent readers", async (t) => {
    const f = emptyFixture(t);
    const invoke = (method) => requestWithThreadHistoryRecovery({ ...f, method, params: { threadId: THREAD, includeTurns: true } });
    const results = await Promise.all([invoke("thread/read"), invoke("thread/resume"), invoke("thread/turns/list")]);
    assert.deepEqual(results.map((result) => result.method), ["thread/read", "thread/resume", "thread/turns/list"]);
    assert.equal(f.calls.filter((call) => call.method === "thread/metadata/update").length, 1);
  });
  await t.test("history arrives during journal write", async (t) => {
    const f = emptyFixture(t);
    const originalFsync = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", (fd) => {
      originalFsync(fd);
      fs.appendFileSync(f.rolloutPath, JSON.stringify({ type: "response_item", payload: { text: "new user message" } }) + "\n");
    });
    await assert.rejects(requestWithThreadHistoryRecovery({ ...f, method: "thread/read", params: { threadId: THREAD, includeTurns: true } }), (error) => error.data.historyRecoveryReason === "rollout_changed_during_repair");
    assert.equal(f.calls.some((call) => call.method === "thread/metadata/update"), false);
  });
});

test("empty materialization is bounded and never invents success when the runtime fails", async (t) => {
  for (const failure of ["timeout", "wrong identity", "missing index", "still unsupported"]) {
    await t.test(failure, async (t) => {
      const f = emptyFixture(t);
      let updates = 0;
      const request = async (method, params, timeout) => {
        if (method === "thread/metadata/update") {
          updates++;
          if (failure === "timeout") throw new Error("request timed out");
          if (failure === "wrong identity") return { thread: { id: OTHER } };
          if (failure === "missing index") return { thread: f.thread };
        }
        if (failure === "still unsupported" && updates && method === "thread/resume") throw unsupported();
        return f.request(method, params, timeout);
      };
      await assert.rejects(requestWithThreadHistoryRecovery({ ...f, request, method: "thread/resume", params: { threadId: THREAD } }), { code: "HAOLO_THREAD_HISTORY_UNAVAILABLE" });
      assert.equal(updates, 1);
    });
  }
});

test("explicit resume sources never repair a database using an unrelated threadId", async () => {
  for (const extra of [{ path: "explicit.jsonl" }, { history: [] }]) {
    let calls = 0;
    const error = unsupported();
    await assert.rejects(requestWithThreadHistoryRecovery({
      request: async () => { calls++; throw error; }, method: "thread/resume",
      params: { threadId: THREAD, ...extra }, codexHome: os.tmpdir(),
    }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});
