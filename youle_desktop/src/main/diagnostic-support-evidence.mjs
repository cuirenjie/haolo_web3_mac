// HAOLO-TURN-DIAGNOSTICS-MODULE
// Read-only support evidence. Never use the recovering transcript index loader:
// exporting a corrupt index must not rename it or repair the user's history.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { diagnosticHash, redactDiagnosticText } from "./turn-diagnostics.mjs";

export const TRANSCRIPT_DIAGNOSTIC_LOG = "trading-transcript-diagnostics.jsonl";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{16}$/;
const INDEX_NAME = "trading-transcript-index.json";
const MARKER = "<haolo_trading_transcript_item>";
const CLOSE_MARKER = "</haolo_trading_transcript_item>";
const LIMITS = Object.freeze({
  windowMs: 72 * 60 * 60_000, homes: 16, files: 12, directories: 512,
  entries: 10_000, fileBytes: 2 * 1024 * 1024, readBytes: 24 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024, textChars: 24_000, logEvents: 2_000,
});
const STAGES = new Set([
  "persist.started", "persist.completed", "persist.failed", "persist.verification_failed",
  "persist.injection_failed", "persist.title_failed",
  "index.discovery_failed", "index.missing", "index.corrupt", "index.invalid",
  "history.loaded", "history.failed", "history.skipped_unindexed", "history.rollout_missing",
  "renderer.initial_deferred", "renderer.completed_deferred", "renderer.retry_scheduled",
  "renderer.retry_failed", "renderer.retry_exhausted", "renderer.report_created",
]);
const COUNTERS = ["itemCount", "finalCount", "textChars", "attempt", "restoredCount", "rawTurnCount", "missingItemCount"];

export function redactSupportText(value, maxChars = LIMITS.textChars) {
  // Do this before truncation so a cut through a credential cannot evade a rule.
  const text = String(value ?? "")
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/gi, "[REDACTED_KEY]")
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"')]+/gi, "[REDACTED_URL]")
    .replace(/((?:api[_ -]?key|access[_ -]?key|secret|token|password|authorization|cookie|密码|密钥)["']?\s*[:=：]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, "$1[REDACTED_SECRET]")
    .replace(/[A-Za-z]:[\\/][^\r\n"<>|]*/g, "[REDACTED_PATH]")
    .replace(/\\\\[^\s"<>]+/g, "[REDACTED_PATH]");
  return redactDiagnosticText(text, maxChars);
}

export function transcriptDiagnosticPayload(stage, context = {}) {
  if (!STAGES.has(stage)) return null;
  const result = { stage };
  if (context.threadId) result.threadHash = diagnosticHash(context.threadId);
  if (context.cwd) result.cwdHash = diagnosticHash(context.cwd);
  for (const key of COUNTERS) {
    if (Number.isFinite(context[key])) result[key] = Math.max(0, Math.min(1_000_000_000, Math.round(context[key])));
  }
  if (context.error) {
    const message = String(context.error.message || context.error);
    result.errorHash = diagnosticHash(message);
    result.detail = redactSupportText(message, 1_200);
    const code = String(context.error.code || "");
    if (/^[A-Z0-9_.-]{1,100}$/i.test(code)) result.code = code;
  }
  return result;
}

function safeId(value) {
  const text = String(value || "");
  return UUID.test(text) ? text.toLowerCase() : "";
}

function safeTimestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function safeFile(root, candidate) {
  if (!within(root, candidate)) return { status: "outside_root" };
  try {
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return { status: "not_regular_file" };
    const real = await fs.realpath(candidate);
    if (!within(root, real)) return { status: "outside_root" };
    return { status: "ok", stat, real };
  } catch (error) {
    return { status: error.code === "ENOENT" ? "missing" : "unreadable" };
  }
}

async function readFileEvidence(root, candidate, budget, { tail = false } = {}) {
  const checked = await safeFile(root, candidate);
  if (checked.status !== "ok") return checked;
  const sourceBytes = checked.stat.size;
  if (budget.remaining <= 0) return { status: "read_budget_exhausted", sourceBytes };
  const bytes = Math.min(sourceBytes, LIMITS.fileBytes, budget.remaining);
  budget.remaining -= bytes;
  const offset = tail ? Math.max(0, sourceBytes - bytes) : 0;
  let file;
  try {
    file = await fs.open(checked.real, "r");
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, offset);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset) text = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : "";
    return { status: "ok", text, sourceBytes, truncated: bytesRead < sourceBytes, sha256: crypto.createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex"), hashScope: offset || bytesRead < sourceBytes ? "sample" : "full" };
  } catch {
    return { status: "unreadable", sourceBytes };
  } finally {
    await file?.close();
  }
}

function textEvidence(value) {
  const source = String(value ?? "");
  return { text: redactSupportText(source), originalTextChars: source.length, textHash: diagnosticHash(source), textTruncated: source.length > LIMITS.textChars };
}

function safeIdentifier(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9_.:-]{1,300}$/.test(text) ? text : null;
}

function relativeRolloutName(root, candidate) {
  const relative = path.relative(root, candidate).split(path.sep).join("/");
  // Storage names must not expose user-selected directories or arbitrary text
  // from a damaged index. The hash still correlates rejected path metadata.
  return /^(?:sessions\/(?:\d{4}\/\d{2}\/\d{2}\/)?|archived_sessions\/)rollout-[0-9TtZz_.:-]+-[a-f0-9-]{36}\.jsonl$/i.test(relative)
    ? relative : null;
}

function transcriptMarker(value) {
  if (!value.startsWith(MARKER) || !value.endsWith(CLOSE_MARKER)) return null;
  try {
    const item = JSON.parse(value.slice(MARKER.length, -CLOSE_MARKER.length));
    if (!["user", "assistant"].includes(item.role)) return null;
    return {
      version: item.version === 1 ? 1 : null, id: safeIdentifier(item.id), role: item.role,
      phase: safeIdentifier(item.phase), createdAt: safeTimestamp(item.createdAt),
      startedAt: safeTimestamp(item.startedAt), completedAt: safeTimestamp(item.completedAt),
      executionPlanPresentation: ["plain", "execution-plan"].includes(item.executionPlanPresentation) ? item.executionPlanPresentation : null,
      ...textEvidence(item.text),
    };
  } catch {
    return null;
  }
}

function sanitizeRolloutLine(row, lineNumber) {
  const output = { lineNumber, timestamp: safeTimestamp(row?.timestamp), type: safeIdentifier(row?.type) };
  const data = row?.payload;
  if (!data || typeof data !== "object") return { ...output, omitted: true };
  const type = safeIdentifier(data.type);
  if (row.type === "session_meta") {
    return { ...output, payload: { id: safeId(data.id), timestamp: safeTimestamp(data.timestamp), cwdHash: diagnosticHash(data.cwd), cliVersion: safeIdentifier(data.cli_version) } };
  }
  if (row.type === "response_item" && type === "message" && ["user", "assistant"].includes(data.role)) {
    const content = (Array.isArray(data.content) ? data.content : []).slice(0, 32).flatMap((part) => {
      if (!["input_text", "output_text", "text"].includes(part?.type) || typeof part.text !== "string") return [];
      const item = transcriptMarker(part.text);
      // Never copy opaque malformed transcript JSON: it could contain fields
      // intentionally excluded by the structured projection above.
      if (part.text.includes(MARKER) && !item) return [{ type: part.type, malformedTranscript: true, originalTextChars: part.text.length }];
      return [{ type: part.type, ...(item ? { transcript: item } : textEvidence(part.text)) }];
    });
    return { ...output, payload: { type, role: data.role, phase: safeIdentifier(data.phase), id: safeIdentifier(data.id), content } };
  }
  if (row.type === "event_msg" && ["user_message", "agent_message"].includes(type)) {
    const source = String(data.message || "");
    const item = transcriptMarker(source);
    return { ...output, payload: { type, ...(item ? { transcript: item } : source.includes(MARKER) ? { malformedTranscript: true } : textEvidence(source)) } };
  }
  if (row.type === "event_msg" && ["task_started", "task_complete", "turn_aborted"].includes(type)) {
    return { ...output, payload: { type, turnId: safeIdentifier(data.turn_id), status: safeIdentifier(data.status) } };
  }
  // Keep row topology for diagnosis, but omit tools, commands, environment,
  // system/developer instructions, attachments and account snapshots.
  return { ...output, payloadType: type, omitted: true };
}

function sanitizedJsonl(source) {
  const lines = [];
  let malformedLines = 0;
  let hasConversationText = false;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const row = sanitizeRolloutLine(JSON.parse(line), index + 1);
      const serialized = JSON.stringify(row);
      if (serialized.includes('"originalTextChars":')) hasConversationText = true;
      lines.push(serialized);
    } catch {
      malformedLines++;
      lines.push(JSON.stringify({ lineNumber: index + 1, malformed: true }));
    }
  }
  return { jsonl: lines.join("\n") + (lines.length ? "\n" : ""), malformedLines, hasConversationText };
}

async function discoverRollouts(root, traversal) {
  const candidates = [];
  const pending = [path.join(root, "archived_sessions"), path.join(root, "sessions")];
  while (pending.length && traversal.directories < LIMITS.directories && traversal.entries < LIMITS.entries) {
    const directory = pending.pop();
    traversal.directories++;
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !within(root, await fs.realpath(directory))) continue;
      // Newest date folders are visited first if a large history hits the cap.
      const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++traversal.entries > LIMITS.entries) break;
        if (entry.isSymbolicLink()) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(entryPath);
        else if (entry.isFile()) {
          const match = entry.name.match(/-([a-f0-9-]{36})\.jsonl$/i);
          const threadId = safeId(match?.[1]);
          if (!threadId) continue;
          const info = await safeFile(root, entryPath);
          if (info.status === "ok") candidates.push({ path: entryPath, threadId, mtimeMs: info.stat.mtimeMs });
        }
      }
    } catch { /* A missing or unreadable directory is recorded by the result count. */ }
  }
  return candidates;
}

function safeLogEvent(value) {
  if (!STAGES.has(value?.stage)) return null;
  const payload = transcriptDiagnosticPayload(value.stage, value);
  for (const field of ["threadHash", "cwdHash", "errorHash"]) {
    if (HASH.test(value[field] || "")) payload[field] = value[field];
  }
  if (value.detail) payload.detail = redactSupportText(value.detail, 1_200);
  if (/^[A-Z0-9_.-]{1,100}$/i.test(value.code || "")) payload.code = value.code;
  return { timestamp: safeTimestamp(value.timestamp), ...payload };
}

export async function collectDiagnosticSupportEvidence({ homes = [], logPath, selectedThreadId, now = new Date() } = {}) {
  const cutoff = now.getTime() - LIMITS.windowMs;
  const selected = safeId(selectedThreadId);
  const budget = { remaining: LIMITS.readBytes };
  const traversal = { directories: 0, entries: 0 };
  const evidence = {
    schemaVersion: 1, windowStart: new Date(cutoff).toISOString(), limits: LIMITS,
    selectedThreadId: selected || null, indexes: [], rollouts: [], persistenceLog: { files: [], events: [] },
    omissions: [], includesConversationText: false,
  };
  if (logPath) {
    let logRoot;
    try { logRoot = await fs.realpath(path.dirname(logPath)); } catch { /* Missing log is evidence too. */ }
    for (const suffix of [".1", ""]) {
      const read = logRoot ? await readFileEvidence(logRoot, `${logPath}${suffix}`, budget, { tail: true }) : { status: "missing" };
      evidence.persistenceLog.files.push({ name: `${TRANSCRIPT_DIAGNOSTIC_LOG}${suffix}`, status: read.status, sourceBytes: read.sourceBytes, truncated: read.truncated });
      for (const line of (read.text || "").split(/\r?\n/)) {
        try {
          const event = safeLogEvent(JSON.parse(line));
          if (event && Date.parse(event.timestamp) >= cutoff) evidence.persistenceLog.events.push(event);
        } catch { /* Rotated/trailing partial lines cannot block export. */ }
      }
    }
    if (evidence.persistenceLog.events.length > LIMITS.logEvents) evidence.omissions.push({ reason: "log_event_limit" });
    evidence.persistenceLog.events = evidence.persistenceLog.events.slice(-LIMITS.logEvents);
  }
  // Reading an ordinary conversation also probes the trading index. An empty
  // probe alone must not pull unrelated conversation content into the report.
  const relatedHashes = new Set(evidence.persistenceLog.events
    .filter((event) => /^(?:persist\.|renderer\.)/.test(event.stage) || (event.stage === "history.loaded" && event.restoredCount > 0))
    .map((event) => event.threadHash).filter(Boolean));
  const seen = new Set();
  const pending = [];
  for (const value of homes) {
    let root;
    try { root = await fs.realpath(value); } catch { evidence.omissions.push({ workspaceHash: diagnosticHash(value), reason: "home_unavailable" }); continue; }
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (seen.has(key)) continue;
    if (seen.size >= LIMITS.homes) { evidence.omissions.push({ reason: "home_limit" }); break; }
    seen.add(key);
    const workspaceHash = diagnosticHash(root);
    const indexRead = await readFileEvidence(root, path.join(root, INDEX_NAME), budget);
    const index = { workspaceHash, name: INDEX_NAME, status: indexRead.status, sourceBytes: indexRead.sourceBytes, truncated: indexRead.truncated, sha256: indexRead.sha256, threads: {}, aliases: {} };
    let sourceIndex = null;
    if (indexRead.status === "ok") {
      if (indexRead.truncated) index.status = "too_large";
      else try {
        sourceIndex = JSON.parse(indexRead.text);
        if (sourceIndex?.version !== 1 || !sourceIndex.threads || typeof sourceIndex.threads !== "object" || Array.isArray(sourceIndex.threads)) { sourceIndex = null; index.status = "invalid_schema"; }
      } catch { index.status = "corrupt"; }
    }
    evidence.indexes.push(index);
    const candidates = await discoverRollouts(root, traversal);
    const discoveredIds = new Set(candidates.map((candidate) => candidate.threadId));
    const relatedIds = new Set();
    for (const [id, record] of Object.entries(sourceIndex?.threads || {})) {
      const threadId = safeId(id);
      if (!threadId) continue;
      const related = threadId === selected || relatedHashes.has(diagnosticHash(threadId)) || Date.parse(record?.updatedAt) >= cutoff;
      if (!related) continue;
      relatedIds.add(threadId);
      if (Object.keys(index.threads).length >= 100) { index.truncated = true; continue; }
      const rolloutPath = typeof record?.rolloutPath === "string" ? path.resolve(record.rolloutPath) : "";
      index.threads[threadId] = {
        threadId, title: redactSupportText(record?.title, 200), preview: redactSupportText(record?.preview, 500),
        cwdHash: diagnosticHash(record?.cwd), createdAt: safeTimestamp(record?.createdAt), updatedAt: safeTimestamp(record?.updatedAt),
        rolloutPath: rolloutPath && within(root, rolloutPath) ? relativeRolloutName(root, rolloutPath) : null,
        rolloutPathHash: diagnosticHash(rolloutPath),
        pathStatus: !rolloutPath ? "missing" : within(root, rolloutPath) ? "inside_root" : "outside_root",
        fileDiscovered: discoveredIds.has(threadId),
      };
      evidence.includesConversationText ||= Boolean(record?.title || record?.preview);
    }
    for (const [from, to] of Object.entries(sourceIndex?.aliases || {})) {
      if (safeId(from) && safeId(to) && (relatedIds.has(from) || relatedIds.has(to) || from === selected || to === selected)) {
        if (Object.keys(index.aliases).length < 100) index.aliases[from] = to;
        relatedIds.add(from); relatedIds.add(to);
      }
    }
    for (const candidate of candidates) {
      const explicit = candidate.threadId === selected || relatedHashes.has(diagnosticHash(candidate.threadId)) || relatedIds.has(candidate.threadId);
      if (!explicit && candidate.mtimeMs < cutoff) continue;
      pending.push({ ...candidate, root, index, workspaceHash, explicit, priority: candidate.threadId === selected ? 2 : explicit ? 1 : 0 });
    }
  }
  let outputBytes = Buffer.byteLength(JSON.stringify(evidence));
  pending.sort((a, b) => b.priority - a.priority || b.mtimeMs - a.mtimeMs);
  for (const candidate of pending) {
    if (evidence.rollouts.length >= LIMITS.files || budget.remaining <= 0) { evidence.omissions.push({ reason: evidence.rollouts.length >= LIMITS.files ? "file_limit" : "read_budget_exhausted" }); break; }
    const read = await readFileEvidence(candidate.root, candidate.path, budget, { tail: true });
    if (!candidate.explicit && !read.text?.includes(MARKER)) continue;
    const projected = sanitizedJsonl(read.text || "");
    const rollout = {
      workspaceHash: candidate.workspaceHash, threadId: candidate.threadId,
      name: relativeRolloutName(candidate.root, candidate.path) || `session-${candidate.threadId}.jsonl`,
      status: read.status, sourceBytes: read.sourceBytes, truncated: read.truncated,
      sha256: read.sha256, hashScope: read.hashScope, indexEntryPresent: Boolean(candidate.index.threads[candidate.threadId]),
      lineNumbersRelativeToSample: read.truncated === true, malformedLines: projected.malformedLines, jsonl: projected.jsonl,
    };
    const bytes = Buffer.byteLength(JSON.stringify(rollout));
    if (outputBytes + bytes > LIMITS.outputBytes) { evidence.omissions.push({ threadId: candidate.threadId, reason: "output_budget_exhausted" }); continue; }
    outputBytes += bytes;
    evidence.rollouts.push(rollout);
    evidence.includesConversationText ||= projected.hasConversationText;
  }
  if (traversal.directories >= LIMITS.directories || traversal.entries >= LIMITS.entries) evidence.omissions.push({ reason: "discovery_limit" });
  if (selected && !evidence.rollouts.some((item) => item.threadId === selected)) evidence.omissions.push({ threadId: selected, reason: "selected_rollout_not_collected" });
  return evidence;
}
