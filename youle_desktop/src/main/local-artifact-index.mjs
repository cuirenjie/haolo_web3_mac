import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_RESULT_ARTIFACT_INDEX_FILE_NAME = ".haolo-artifacts.json";

const RESULT_ARTIFACT_INDEX_VERSION = 2;
const SESSION_SCAN_LIMIT = 100;
const SESSION_SCAN_DEPTH = 5;
const resultArtifactIndexUpdateQueues = new Map();
const DELIVERABLE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "tif",
  "tiff",
  "avif",
  "pdf",
  "doc",
  "docx",
  "rtf",
  "wps",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "html",
  "htm",
  "md",
  "txt",
  "csv",
  "tsv",
  "json",
  "xml",
  "log",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "scss",
  "less",
  "yml",
  "yaml",
  "sql",
  "ipynb",
  "tex",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "sh",
  "bat",
  "ps1",
  "mp4",
  "webm",
  "ogg",
  "mov",
  "m4v",
  "avi",
  "mkv",
  "mpeg",
  "mpg",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "flac",
  "epub",
  "parquet",
  "sqlite",
  "db",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
];
const DELIVERABLE_EXTENSION_PATTERN = `(?:${DELIVERABLE_EXTENSIONS.map(escapeRegExp).join("|")})`;
const GENERIC_ARTIFACT_EXTENSION_PATTERN = "(?:[A-Za-z0-9][A-Za-z0-9_+-]{0,31})";
const TRAILING_CANDIDATE_PUNCTUATION = /[)\].,;\uFF0C\u3002\uFF1B\u3001]+$/u;

export function resultArtifactIndexPath(outputRoot) {
  return path.join(path.resolve(outputRoot), LOCAL_RESULT_ARTIFACT_INDEX_FILE_NAME);
}

export function normalizeArtifactPathKey(value) {
  const normalized = path.resolve(String(value || "")).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathInsideDirectory(candidate, root) {
  const resolvedCandidate = path.resolve(String(candidate || ""));
  const resolvedRoot = path.resolve(String(root || ""));
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function extractDeliveredArtifactPaths(text, options = {}) {
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const outputRoot = path.resolve(String(options.outputRoot || path.join(cwd, "outputs")));
  const candidates = extractArtifactPathCandidates(text, {
    allowAnyExtension: options.allowAnyExtension === true,
  });
  const paths = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const filePath = artifactPathFromCandidate(candidate, { cwd, outputRoot });
    if (!filePath) continue;
    const key = normalizeArtifactPathKey(filePath);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(filePath);
  }
  return paths;
}

export async function readResultArtifactIndex(outputRoot) {
  const indexPath = resultArtifactIndexPath(outputRoot);
  try {
    const raw = await fs.promises.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    return {
      version: Number(parsed?.version) || RESULT_ARTIFACT_INDEX_VERSION,
      items: normalizeIndexItems(items, outputRoot),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: RESULT_ARTIFACT_INDEX_VERSION, items: [] };
    return { version: RESULT_ARTIFACT_INDEX_VERSION, items: [] };
  }
}

export async function writeResultArtifactIndex(outputRoot, index) {
  const indexPath = resultArtifactIndexPath(outputRoot);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  const items = normalizeIndexItems(index?.items || [], outputRoot).map((item) => ({
    ...item,
    relative_path: artifactRelativePath(item.path, outputRoot),
  }));
  const payload = {
    version: RESULT_ARTIFACT_INDEX_VERSION,
    updated_at: new Date().toISOString(),
    items,
  };
  const tempPath = `${indexPath}.tmp`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.rename(tempPath, indexPath);
  return payload;
}

export function updateResultArtifactIndex(outputRoot, entries = []) {
  const queueKey = path.resolve(String(outputRoot || ""));
  const previous = resultArtifactIndexUpdateQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => updateResultArtifactIndexUnlocked(outputRoot, entries));
  resultArtifactIndexUpdateQueues.set(queueKey, operation);
  return operation.finally(() => {
    if (resultArtifactIndexUpdateQueues.get(queueKey) === operation) {
      resultArtifactIndexUpdateQueues.delete(queueKey);
    }
  });
}

async function updateResultArtifactIndexUnlocked(outputRoot, entries = []) {
  const current = await readResultArtifactIndex(outputRoot);
  const byPath = new Map(current.items.map((item) => [normalizeArtifactPathKey(item.path), item]));
  const now = new Date().toISOString();
  let changed = false;
  for (const entry of entries) {
    const normalized = normalizeIndexEntry(entry, outputRoot);
    if (!normalized) continue;
    const key = normalizeArtifactPathKey(normalized.path);
    const existing = byPath.get(key) || {};
    const existingThreadId = firstString(existing.threadId, existing.thread_id);
    const incomingThreadId = firstString(normalized.threadId, normalized.thread_id);
    if (existingThreadId && !incomingThreadId) {
      continue;
    }
    const existingTurnId = firstString(existing.turnId, existing.turn_id);
    const incomingTurnId = firstString(normalized.turnId, normalized.turn_id);
    const nextThreadId = incomingThreadId || existingThreadId || null;
    const nextTurnId = incomingTurnId || (
      !incomingThreadId || incomingThreadId === existingThreadId
        ? existingTurnId
        : null
    ) || null;
    byPath.set(key, {
      ...existing,
      ...normalized,
      threadId: nextThreadId,
      thread_id: nextThreadId,
      turnId: nextTurnId,
      turn_id: nextTurnId,
      indexed_at: existing.indexed_at || normalized.indexed_at || now,
      updated_at: normalized.updated_at || existing.updated_at || now,
    });
    changed = true;
  }
  if (!changed) return current;
  return writeResultArtifactIndex(outputRoot, { items: [...byPath.values()] });
}

export async function backfillResultArtifactIndexFromSessions(options = {}) {
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const outputRoot = path.resolve(String(options.outputRoot || path.join(cwd, "outputs")));
  const sessionsDir = path.resolve(String(options.sessionsDir || path.join(cwd, "haolo-ai-home", "sessions")));
  const sinceMs = Number(options.sinceMs || 0);
  const sessionFiles = await recentSessionFiles(sessionsDir);
  const entries = [];
  const seen = new Set();
  for (const sessionFile of sessionFiles) {
    const records = await finalMessageRecordsFromSessionFile(sessionFile);
    for (const record of records) {
      const deliveredAt = record.completedAt || record.timestamp || new Date().toISOString();
      const deliveredAtMs = Date.parse(deliveredAt);
      if (sinceMs && Number.isFinite(deliveredAtMs) && deliveredAtMs < sinceMs) continue;
      const paths = extractDeliveredArtifactPaths(record.message, { cwd, outputRoot });
      for (const filePath of paths) {
        if (!(await isExistingFile(filePath))) continue;
        const key = `${normalizeArtifactPathKey(filePath)}\n${record.turnId || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          path: filePath,
          turnId: record.turnId || null,
          delivered_at: deliveredAt,
          source: "session_final_message",
        });
      }
    }
  }
  if (!entries.length) return readResultArtifactIndex(outputRoot);
  return updateResultArtifactIndex(outputRoot, entries);
}

export function buildResultArtifactIndexEntries(paths, metadata = {}) {
  const deliveredAt = metadata.deliveredAt || metadata.delivered_at || new Date().toISOString();
  return paths.map((filePath) => ({
    path: filePath,
    threadId: metadata.threadId || metadata.thread_id || null,
    thread_id: metadata.threadId || metadata.thread_id || null,
    turnId: metadata.turnId || metadata.turn_id || null,
    turn_id: metadata.turnId || metadata.turn_id || null,
    delivered_at: deliveredAt,
    source: metadata.source || "final_message",
  }));
}

export function buildUnclaimedArtifactIndexEntries(paths, metadata = {}) {
  return buildResultArtifactIndexEntries(paths, {
    deliveredAt: metadata.deliveredAt || metadata.delivered_at,
    source: metadata.source || "turn_output_scan",
  });
}

async function recentSessionFiles(sessionsDir) {
  const root = path.resolve(sessionsDir);
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < SESSION_SCAN_DEPTH) stack.push({ dir: entryPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".jsonl") continue;
      try {
        const stats = await fs.promises.stat(entryPath);
        files.push({ path: entryPath, updatedAtMs: stats.mtimeMs || stats.birthtimeMs || 0 });
      } catch {
        // Ignore disappearing session files.
      }
    }
  }
  return files
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, SESSION_SCAN_LIMIT)
    .map((item) => item.path);
}

async function finalMessageRecordsFromSessionFile(sessionFile) {
  let raw;
  try {
    raw = await fs.promises.readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const records = [];
  const seen = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const record = finalMessageRecordFromSessionItem(item);
    if (!record?.message) continue;
    const key = `${record.turnId || ""}\n${record.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }
  return records;
}

function finalMessageRecordFromSessionItem(item) {
  const payload = item?.payload || {};
  if (item?.type === "event_msg" && payload.type === "task_complete" && payload.last_agent_message) {
    return {
      message: String(payload.last_agent_message),
      turnId: firstString(payload.turn_id, payload.turnId),
      timestamp: item.timestamp || null,
      completedAt: completedAtIso(payload.completed_at) || item.timestamp || null,
    };
  }
  if (item?.type === "event_msg" && payload.type === "agent_message" && payload.phase === "final_answer" && payload.message) {
    return {
      message: String(payload.message),
      turnId: firstString(payload.turn_id, payload.turnId),
      timestamp: item.timestamp || null,
      completedAt: item.timestamp || null,
    };
  }
  if (item?.type === "response_item" && payload.type === "message" && payload.role === "assistant" && payload.phase === "final_answer") {
    const message = responseItemText(payload);
    return {
      message,
      turnId: firstString(
        payload.turn_id,
        payload.turnId,
        payload.internal_chat_message_metadata_passthrough?.turn_id,
        payload.internal_chat_message_metadata_passthrough?.turnId,
      ),
      timestamp: item.timestamp || null,
      completedAt: item.timestamp || null,
    };
  }
  return null;
}

function responseItemText(payload) {
  if (typeof payload.text === "string") return payload.text;
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.output_text === "string") return part.output_text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractArtifactPathCandidates(text, options = {}) {
  const value = String(text || "");
  if (!value) return [];
  const extensionPattern = options.allowAnyExtension === true
    ? GENERIC_ARTIFACT_EXTENSION_PATTERN
    : DELIVERABLE_EXTENSION_PATTERN;
  const candidates = [];
  collectMatches(value, /\[[^\]\n]*\]\(([^)\n]+)\)/g, candidates);
  collectMatches(value, /`([^`\n]+)`/g, candidates);
  collectMatches(
    value,
    new RegExp(`(file:\\/\\/\\/[^\\s)\\]}>,;]+?\\.${extensionPattern})(?=$|[\\s)\\]}>,;\\uFF0C\\u3002\\uFF1B\\u3001])`, "giu"),
    candidates,
  );
  collectMatches(
    value,
    new RegExp(
      `(?:^|[\\s(["':\\uFF1A])((?:[A-Za-z]:|\\\\\\\\)[\\\\/][^\\r\\n\`]*?\\.${extensionPattern})(?=$|[\\s\\])'",.;\\uFF0C\\u3002\\uFF1B\\u3001])`,
      "giu",
    ),
    candidates,
  );
  collectMatches(
    value,
    new RegExp(
      `(?:^|[\\s(["':\\uFF1A\`])((?:\\/(?!\\/))[^\\r\\n\`]*?\\.${extensionPattern})(?=$|[\\s\\])'",.;\\uFF0C\\u3002\\uFF1B\\u3001])`,
      "giu",
    ),
    candidates,
  );
  collectMatches(
    value,
    new RegExp(
      `(?:^|[\\s(["':\\uFF1A\`])((?:\\.?[\\\\/])?outputs[\\\\/][^\\r\\n\`]*?\\.${extensionPattern})(?=$|[\\s\\])'",.;\\uFF0C\\u3002\\uFF1B\\u3001])`,
      "giu",
    ),
    candidates,
  );
  return candidates;
}

function collectMatches(text, regex, candidates) {
  for (const match of text.matchAll(regex)) {
    const candidate = match[1] || match[0];
    if (candidate) candidates.push(candidate);
  }
}

function artifactPathFromCandidate(candidate, { cwd, outputRoot }) {
  let text = cleanCandidate(candidate);
  if (!text) return null;
  let filePath = null;
  if (/^file:\/\//i.test(text)) {
    try {
      filePath = fileURLToPath(text);
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(text)) {
    return null;
  } else if (isAbsoluteLocalPath(text)) {
    filePath = path.resolve(text);
  } else {
    const relative = text.replace(/^\.?[\\/]/, "");
    if (/^outputs[\\/]/i.test(relative)) {
      filePath = path.resolve(cwd, relative);
    }
  }
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  return isPathInsideDirectory(resolved, outputRoot) ? resolved : null;
}

function cleanCandidate(candidate) {
  let text = String(candidate || "").trim();
  text = text.replace(/^<(.+)>$/, "$1").trim();
  text = text.replace(/^["'](.+)["']$/, "$1").trim();
  if (process.platform === "win32") {
    text = text.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
  }
  while (TRAILING_CANDIDATE_PUNCTUATION.test(text)) {
    text = text.replace(TRAILING_CANDIDATE_PUNCTUATION, "").trim();
  }
  if (/%[0-9a-f]{2}/i.test(text) && !/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the original candidate when it is not a URI-encoded string.
    }
  }
  return text;
}

function isAbsoluteLocalPath(value) {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function normalizeIndexItems(items, outputRoot) {
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const entry = normalizeIndexEntry(item, outputRoot);
    if (!entry) continue;
    const key = normalizeArtifactPathKey(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(entry);
  }
  normalized.sort((left, right) => Date.parse(right.delivered_at || right.updated_at || 0) - Date.parse(left.delivered_at || left.updated_at || 0));
  return normalized;
}

function normalizeIndexEntry(entry, outputRoot) {
  const storedPath = firstString(entry?.path, entry?.local_path);
  const storedRelativePath = safeArtifactRelativePath(
    firstString(entry?.relative_path, entry?.relativePath),
  );
  let filePath = storedRelativePath
    ? path.resolve(outputRoot, storedRelativePath)
    : artifactPathFromStoredValue(storedPath, outputRoot);
  if (filePath && !isPathInsideDirectory(filePath, outputRoot)) {
    const legacyRelativePath = legacyOutputsRelativePath(filePath);
    filePath = legacyRelativePath ? path.resolve(outputRoot, legacyRelativePath) : filePath;
  }
  if (!filePath || !isPathInsideDirectory(filePath, outputRoot)) return null;
  return {
    path: filePath,
    relative_path: artifactRelativePath(filePath, outputRoot),
    threadId: firstString(entry.threadId, entry.thread_id) || null,
    thread_id: firstString(entry.threadId, entry.thread_id) || null,
    turnId: firstString(entry.turnId, entry.turn_id) || null,
    turn_id: firstString(entry.turnId, entry.turn_id) || null,
    delivered_at: firstString(entry.delivered_at, entry.created_at, entry.indexed_at) || new Date().toISOString(),
    indexed_at: firstString(entry.indexed_at, entry.created_at) || null,
    updated_at: firstString(entry.updated_at) || null,
    source: firstString(entry.source) || "final_message",
  };
}

function artifactPathFromStoredValue(value, outputRoot) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (isAbsoluteLocalPath(text)) return path.resolve(text);
  const relativePath = safeArtifactRelativePath(text);
  return relativePath ? path.resolve(outputRoot, relativePath) : null;
}

function artifactRelativePath(filePath, outputRoot) {
  if (!filePath || !isPathInsideDirectory(filePath, outputRoot)) return null;
  return path.relative(path.resolve(outputRoot), path.resolve(filePath)).replace(/\\/g, "/");
}

function legacyOutputsRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const marker = "/outputs/";
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  if (markerIndex < 0) return null;
  return safeArtifactRelativePath(normalized.slice(markerIndex + marker.length));
}

function safeArtifactRelativePath(value) {
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!text) return null;
  const segments = text.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  return path.join(...segments);
}

async function isExistingFile(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function completedAtIso(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(ms).toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
