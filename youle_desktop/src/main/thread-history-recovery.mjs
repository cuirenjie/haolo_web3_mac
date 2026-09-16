import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HISTORY_METHODS = new Set(["thread/resume", "thread/read", "thread/turns/list", "thread/items/list"]);
const THREAD_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_HEADER_BYTES = 2 * 1024 * 1024;
const repairsInFlight = new Map();

export function isUnsupportedThreadHistoryError(error) {
  const code = error?.data?.code ?? error?.code;
  return (code == null || code === -32601)
    && /^(?:list_turns|list_items) is not supported yet\.?$/i.test(String(error?.message || "").trim());
}

// Only history RPCs are retried. In particular, turn/start is never replayed.
export async function requestWithThreadHistoryRecovery({ request, method, params = {}, timeoutMs, codexHome, onRecovery }) {
  try {
    return await request(method, params, timeoutMs);
  } catch (originalError) {
    if (!HISTORY_METHODS.has(method) || !THREAD_ID.test(params?.threadId || "")
      || !codexHome || !isUnsupportedThreadHistoryError(originalError)
      // Explicit history/path resumes can select a different thread than threadId.
      || (method === "thread/resume" && (params.history != null || params.path))) throw originalError;

    const resolvedHome = path.resolve(codexHome);
    const key = `${process.platform === "win32" ? resolvedHome.toLowerCase() : resolvedHome}\0${params.threadId.toLowerCase()}`;
    let repair = repairsInFlight.get(key);
    if (!repair) {
      repair = (async () => {
        // Read effective runtime configuration; never guess which database to edit
        // when the user has configured a separate sqlite_home.
        const configuration = await request("config/read", { includeLayers: false }, 5_000);
        if (!configuration?.config || typeof configuration.config !== "object") {
          return { status: "unavailable", reason: "runtime_config_unavailable" };
        }
        const sqliteHome = configuration.config.sqlite_home ?? configuration.config.sqliteHome ?? codexHome;
        const storage = { codexHome, sqliteHome, threadId: params.threadId };
        const outcome = await repairThreadHistoryIndex(storage);
        if (outcome.reason !== "thread_index_missing") return outcome;
        return materializeEmptyThreadIndex({ ...storage, request });
      })();
      repairsInFlight.set(key, repair);
      void repair.finally(() => {
        if (repairsInFlight.get(key) === repair) repairsInFlight.delete(key);
      }).catch(() => {});
    }

    let outcome;
    try {
      outcome = await repair;
    } catch (error) {
      outcome = { status: "unavailable", reason: recoveryFailureReason(error) };
    }
    const threadHash = createHash("sha256").update(params.threadId).digest("hex").slice(0, 16);
    const notify = (event) => {
      try { onRecovery?.({ method, threadHash, ...event }); } catch { /* Diagnostics cannot interrupt recovery. */ }
    };
    notify(outcome);
    if (outcome.status === "repaired" || outcome.status === "consistent") {
      try {
        const result = await request(method, params, timeoutMs);
        notify({ status: "verified", reason: outcome.reason });
        return result;
      } catch (retryError) {
        if (!isUnsupportedThreadHistoryError(retryError)) throw retryError;
        outcome = { status: "unavailable", reason: "runtime_history_still_unavailable" };
        notify(outcome);
      }
    }
    const error = new Error(
      `Task history could not be restored automatically (${outcome.reason}). Please export diagnostics for recovery.`,
      { cause: originalError },
    );
    error.code = "HAOLO_THREAD_HISTORY_UNAVAILABLE";
    error.data = { code: error.code, historyRecoveryReason: outcome.reason };
    throw error;
  }
}

export async function repairThreadHistoryIndex({ codexHome, sqliteHome = codexHome, threadId }) {
  if (!THREAD_ID.test(threadId || "") || !path.isAbsolute(codexHome || "")
    || !path.isAbsolute(sqliteHome || "")) return { status: "unavailable", reason: "invalid_storage_identity" };
  const { DatabaseSync } = await import("node:sqlite");
  for (let attempt = 0; ; attempt++) {
    try {
      return repairIndex({ codexHome, sqliteHome, threadId, DatabaseSync });
    } catch (error) {
      // Do not block Electron's main thread waiting on another SQLite writer.
      if (isDatabaseBusy(error) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, [100, 250][attempt]));
        continue;
      }
      throw error;
    }
  }
}

function repairIndex({ codexHome, sqliteHome, threadId, DatabaseSync }) {
  const home = fs.realpathSync(codexHome);
  const databaseRoot = fs.realpathSync(sqliteHome);
  // 0.144.1 and 0.153.4 share this schema. Unknown future schemas fail closed.
  const databasePath = fs.realpathSync(path.join(databaseRoot, "state_5.sqlite"));
  if (!isWithin(databaseRoot, databasePath) || !fs.statSync(databasePath).isFile()) {
    return { status: "unavailable", reason: "invalid_database_path" };
  }
  const database = new DatabaseSync(databasePath);
  let transaction = false;
  try {
    database.exec("PRAGMA busy_timeout = 0");
    const columns = database.prepare("PRAGMA table_info(threads)").all().map((column) => column.name);
    if (!["id", "rollout_path", "history_mode"].every((column) => columns.includes(column))) {
      return { status: "unavailable", reason: "unsupported_index_schema" };
    }
    database.exec("BEGIN IMMEDIATE");
    transaction = true;
    const row = database.prepare("SELECT id, rollout_path, history_mode FROM threads WHERE id = ?").get(threadId);
    if (!row) return { status: "unavailable", reason: "thread_index_missing" };
    if (!path.isAbsolute(row.rollout_path || "") || !/\.jsonl$/i.test(row.rollout_path)) {
      return { status: "unavailable", reason: "unsupported_rollout_path" };
    }
    const rolloutPath = fs.realpathSync(row.rollout_path);
    if (!isWithin(home, rolloutPath)) return { status: "unavailable", reason: "rollout_outside_runtime_home" };
    const { metadata, headerHash } = readSessionMetadata(rolloutPath);
    if (metadata.id !== threadId) return { status: "unavailable", reason: "rollout_identity_mismatch" };
    if (metadata.history_mode !== "paginated") return { status: "unavailable", reason: "rollout_is_not_paginated" };
    if (row.history_mode === "paginated") return { status: "consistent", reason: "index_already_paginated" };
    if (row.history_mode !== "legacy") return { status: "unavailable", reason: "unknown_index_history_mode" };

    // Persist the exact reversible row change before committing it. This small
    // journal contains no conversation text; rollouts and other rows are untouched.
    writeRecoveryJournal(databaseRoot, {
      operation: "promote_verified_history_index",
      threadId,
      before: { historyMode: row.history_mode, rolloutPath: row.rollout_path },
      after: { historyMode: "paginated" },
      headerHash,
    });
    if (fs.realpathSync(row.rollout_path) !== rolloutPath || readSessionMetadata(rolloutPath).headerHash !== headerHash) {
      throw new Error("rollout_changed_during_repair");
    }
    const result = database.prepare(
      "UPDATE threads SET history_mode = 'paginated' WHERE id = ? AND history_mode = 'legacy' AND rollout_path = ?",
    ).run(threadId, row.rollout_path);
    if (result.changes !== 1) throw new Error("history_index_changed_during_repair");
    database.exec("COMMIT");
    transaction = false;
    return { status: "repaired", reason: "verified_history_mode_mismatch" };
  } finally {
    try { if (transaction) database.exec("ROLLBACK"); } finally { database.close(); }
  }
}

async function materializeEmptyThreadIndex({ request, codexHome, sqliteHome, threadId }) {
  // In 0.153.4 an empty durable thread can already have a paginated rollout,
  // but no threads row until its first write. History pagination then returns
  // Unsupported, preventing the very first transcript write or turn/resume.
  const result = await request("thread/read", { threadId, includeTurns: false }, 5_000);
  const thread = result?.thread;
  if (thread?.id !== threadId || thread.historyMode !== "paginated" || thread.ephemeral !== false
    || thread.forkedFromId || thread.parentThreadId || thread.preview
    || !["idle", "notLoaded"].includes(thread.status?.type)
    || !path.isAbsolute(thread.path || "") || !/\.jsonl$/i.test(thread.path)) {
    return { status: "unavailable", reason: "thread_index_missing" };
  }
  const home = fs.realpathSync(codexHome);
  const databaseRoot = fs.realpathSync(sqliteHome);
  const sessionsRoot = fs.realpathSync(path.join(home, "sessions"));
  const rolloutPath = fs.realpathSync(thread.path);
  if (!isWithin(home, sessionsRoot) || !isWithin(sessionsRoot, rolloutPath)) {
    return { status: "unavailable", reason: "unverified_empty_rollout_path" };
  }
  const snapshot = readSessionMetadata(rolloutPath);
  if (!snapshot.headerOnly || snapshot.metadata.id !== threadId
    || snapshot.metadata.history_mode !== "paginated"
    || snapshot.metadata.forked_from_id || snapshot.metadata.parent_thread_id) {
    return { status: "unavailable", reason: "thread_index_missing" };
  }
  // Metadata-only reads deliberately return turns: [] even for nonempty tasks.
  // Check the canonical file AND the projection; never infer emptiness from RPC.
  if (!await hasEmptyHistoryProjection({ databaseRoot, threadId, headerBytes: snapshot.headerBytes })) {
    return { status: "unavailable", reason: "thread_index_missing" };
  }
  // A same-value metadata write asks the runtime to persist its own index with
  // its own schema/defaults. Do not invent a row, a title, or a chat message.
  if (!Object.hasOwn(thread, "gitInfo")
    || (thread.gitInfo !== null && (!thread.gitInfo || !Object.hasOwn(thread.gitInfo, "sha")))) {
    return { status: "unavailable", reason: "empty_thread_metadata_unavailable" };
  }
  const sha = thread.gitInfo?.sha ?? null;
  if ((sha !== null && (typeof sha !== "string" || !sha.trim()))
    || (snapshot.metadata.git?.commit_hash ?? null) !== sha) {
    return { status: "unavailable", reason: "empty_thread_metadata_changed" };
  }
  writeRecoveryJournal(databaseRoot, {
    operation: "materialize_verified_empty_thread_index",
    threadId,
    before: { indexPresent: false },
    after: { historyMode: "paginated" },
    headerHash: snapshot.headerHash,
  });
  const current = readSessionMetadata(rolloutPath);
  if (fs.realpathSync(thread.path) !== rolloutPath || !current.headerOnly
    || current.headerHash !== snapshot.headerHash) throw new Error("rollout_changed_during_repair");
  const persisted = await request("thread/metadata/update", { threadId, gitInfo: { sha } }, 5_000);
  if (persisted?.thread?.id !== threadId) throw new Error("empty_thread_materialization_unverified");
  const verified = await repairThreadHistoryIndex({ codexHome, sqliteHome, threadId });
  if (verified.status !== "consistent") return verified;
  return { status: "repaired", reason: "verified_empty_thread_materialized" };
}

async function hasEmptyHistoryProjection({ databaseRoot, threadId, headerBytes }) {
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = fs.realpathSync(path.join(databaseRoot, "thread_history_1.sqlite"));
  if (!isWithin(databaseRoot, databasePath)) return false;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN");
    for (const table of ["thread_turns", "thread_items", "thread_realtime_items"]) {
      if (database.prepare(`SELECT 1 FROM ${table} WHERE thread_id = ? LIMIT 1`).get(threadId)) return false;
    }
    const projection = database.prepare(
      "SELECT next_rollout_byte_offset, next_rollout_ordinal FROM thread_history_projection_state WHERE thread_id = ?",
    ).get(threadId);
    return !projection || (projection.next_rollout_ordinal >= 0 && projection.next_rollout_ordinal <= 1
      && projection.next_rollout_byte_offset >= 0 && projection.next_rollout_byte_offset <= headerBytes);
  } finally {
    database.close();
  }
}

function writeRecoveryJournal(databaseRoot, change) {
  const backupRoot = path.join(databaseRoot, "haolo-history-index-recovery");
  fs.mkdirSync(backupRoot, { recursive: true });
  if (!isWithin(databaseRoot, fs.realpathSync(backupRoot))) throw new Error("invalid_backup_path");
  const fd = fs.openSync(path.join(backupRoot, `${Date.now()}-${randomUUID()}.json`), "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify({
      schemaVersion: 1, database: "state_5.sqlite", ...change, createdAt: new Date().toISOString(),
    })}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function readSessionMetadata(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("invalid_rollout_file");
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, length).indexOf(10);
    if (newline < 0) throw new Error("incomplete_rollout_header");
    const header = buffer.subarray(0, newline);
    const record = JSON.parse(header.toString("utf8").replace(/^\uFEFF/, ""));
    if (record?.type !== "session_meta" || !record.payload || typeof record.payload !== "object") {
      throw new Error("invalid_rollout_header");
    }
    return {
      metadata: record.payload,
      headerHash: createHash("sha256").update(header).digest("hex"),
      headerBytes: newline + 1,
      headerOnly: fs.fstatSync(fd).size === newline + 1,
    };
  } finally { fs.closeSync(fd); }
}

function isWithin(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isDatabaseBusy(error) {
  return [5, 6].includes(Number(error?.errcode) & 0xff) || /database (?:is )?(?:locked|busy)/i.test(error?.message || "");
}

function recoveryFailureReason(error) {
  if (isDatabaseBusy(error)) return "index_busy";
  if (["ENOENT", "ENOTDIR"].includes(error?.code)) return "history_storage_missing";
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) return "history_storage_not_writable";
  if (error instanceof SyntaxError) return "invalid_rollout_header";
  if (/^[a-z_]+$/.test(error?.message || "")) return error.message;
  return "history_storage_unavailable";
}
