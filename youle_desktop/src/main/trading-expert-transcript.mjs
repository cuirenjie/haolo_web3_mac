import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const TRADING_TRANSCRIPT_OPEN = "<haolo_trading_transcript_item>";
const TRADING_TRANSCRIPT_CLOSE = "</haolo_trading_transcript_item>";
const MAX_TRANSCRIPT_ITEMS_PER_WRITE = 64;
const MAX_TRANSCRIPT_ITEM_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BATCH_BYTES = 4 * 1024 * 1024;
const TRADING_TRANSCRIPT_INDEX_FILE_NAME = "trading-transcript-index.json";
const DEFAULT_TRADING_TRANSCRIPT_TITLE = "新任务";
// Stored by older builds after the Chinese fallback was decoded as Windows-1252.
const LEGACY_MOJIBAKE_NEW_TASK_TITLE = "\u00e6\u2013\u00b0\u00e4\u00bb\u00bb\u00e5\u0160\u00a1";

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function tradingAlertTitleFromPreview(value) {
  const preview = firstString(value);
  const marker = "预警真实触发：";
  if (!preview.startsWith(marker)) return "";
  const firstLine = preview.split(/\n|\s{2,}/u, 1)[0].trim();
  return firstLine.startsWith(marker) ? firstLine.slice(marker.length).trim().slice(0, 200) : "";
}

function normalizedTradingTranscriptTitle(value, preview = "") {
  const title = firstString(value)
    .replace(/[\u0000-\u001f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
  return title === LEGACY_MOJIBAKE_NEW_TASK_TITLE
    ? tradingAlertTitleFromPreview(preview) || DEFAULT_TRADING_TRANSCRIPT_TITLE
    : title;
}

function normalizedCreatedAt(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw new Error("trading transcript createdAt is required");
  return new Date(timestamp).toISOString();
}

function normalizedOptionalTimestamp(value, fieldName) {
  if (value == null || value === "") return "";
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new Error(`trading transcript ${fieldName} is invalid`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeTradingTranscriptActions(value, role) {
  if (role !== "assistant" || !Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const destination = firstString(candidate.destination);
    const label = firstString(candidate.label).slice(0, 80);
    const alertId = firstString(candidate.alert_id, candidate.alertId).slice(0, 160);
    if (destination === "binance-account" && label) {
      return [{
        id: firstString(candidate.id).slice(0, 120) || "connect-binance-account",
        kind: "navigate",
        label,
        destination,
      }];
    }
    if (destination !== "trading-alerts" || !label || !alertId) return [];
    return [{
      id: firstString(candidate.id).slice(0, 120) || "open-trading-alerts",
      kind: "navigate",
      label,
      destination,
      alert_id: alertId,
    }];
  });
}

function normalizeTradingTranscriptItem(value) {
  if (!value || typeof value !== "object") {
    throw new Error("trading transcript item must be an object");
  }
  const id = firstString(value.id, value.itemId, value.item_id);
  if (!id || id.length > 300 || /[\u0000-\u001f]/u.test(id)) {
    throw new Error("trading transcript item id is invalid");
  }
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : "";
  if (!role) throw new Error("trading transcript item role is invalid");
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) throw new Error("trading transcript item text is required");
  if (Buffer.byteLength(text, "utf8") > MAX_TRANSCRIPT_ITEM_BYTES) {
    throw new Error("trading transcript item is too large");
  }
  const phase = role === "assistant"
    ? firstString(value.phase).slice(0, 80) || "final_answer"
    : "";
  const startedAt = normalizedOptionalTimestamp(
    value.startedAt || value.started_at,
    "startedAt",
  );
  const completedAt = normalizedOptionalTimestamp(
    value.completedAt || value.completed_at,
    "completedAt",
  );
  if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("trading transcript completedAt cannot precede startedAt");
  }
  const actions = normalizeTradingTranscriptActions(value.actions, role);
  const executionPlanPresentation = role === "assistant"
    && (value.executionPlanPresentation === "execution-plan" || value.executionPlanPresentation === "plain")
    ? value.executionPlanPresentation
    : "";
  return {
    version: 1,
    id,
    role,
    text,
    createdAt: normalizedCreatedAt(value.createdAt || value.created_at),
    ...(phase ? { phase } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(actions.length ? { actions } : {}),
    ...(executionPlanPresentation ? { executionPlanPresentation } : {}),
  };
}

export function normalizeTradingTranscriptItems(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_TRANSCRIPT_ITEMS_PER_WRITE) {
    throw new Error("trading transcript items are required");
  }
  const byId = new Map();
  for (const candidate of value) {
    const item = normalizeTradingTranscriptItem(candidate);
    const existing = byId.get(item.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
      throw new Error("trading transcript item id was reused with different content");
    }
    byId.set(item.id, item);
  }
  const items = [...byId.values()];
  if (Buffer.byteLength(JSON.stringify(items), "utf8") > MAX_TRANSCRIPT_BATCH_BYTES) {
    throw new Error("trading transcript batch is too large");
  }
  return items;
}

export function tradingTranscriptInjectionItems(items) {
  return normalizeTradingTranscriptItems(items).map((item) => ({
    type: "message",
    role: item.role,
    content: [{
      type: item.role === "user" ? "input_text" : "output_text",
      text: `${TRADING_TRANSCRIPT_OPEN}${JSON.stringify(item)}${TRADING_TRANSCRIPT_CLOSE}`,
    }],
  }));
}

export function parseTradingTranscriptMarkerText(value) {
  if (typeof value !== "string") return null;
  if (!value.startsWith(TRADING_TRANSCRIPT_OPEN) || !value.endsWith(TRADING_TRANSCRIPT_CLOSE)) {
    return null;
  }
  const payload = value.slice(TRADING_TRANSCRIPT_OPEN.length, -TRADING_TRANSCRIPT_CLOSE.length);
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.version !== 1) return null;
    return normalizeTradingTranscriptItem(parsed);
  } catch {
    return null;
  }
}

function collectTradingTranscriptItems(value, byId, seen = new Set()) {
  if (typeof value === "string") {
    const item = parseTradingTranscriptMarkerText(value);
    if (item && !byId.has(item.id)) byId.set(item.id, item);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectTradingTranscriptItems(item, byId, seen);
    return;
  }
  for (const item of Object.values(value)) collectTradingTranscriptItems(item, byId, seen);
}

function threadRolloutPath(result) {
  return firstString(
    result?.thread?.path,
    result?.thread?.rolloutPath,
    result?.thread?.rollout_path,
    result?.path,
    result?.rolloutPath,
    result?.rollout_path,
  );
}

export async function readTradingTranscriptItemsFromRollout(rolloutPath) {
  const filePath = firstString(rolloutPath);
  if (!filePath) return [];
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isFile()) return [];

  const byId = new Map();
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes(TRADING_TRANSCRIPT_OPEN)) continue;
      try {
        collectTradingTranscriptItems(JSON.parse(line), byId);
      } catch {
        // Ignore an incomplete trailing rollout line or unrelated malformed entry.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return [...byId.values()];
}

async function findTradingTranscriptRolloutPath(codexHome, threadId) {
  const root = path.join(path.resolve(codexHome), "sessions");
  const expectedSuffix = `-${threadId}.jsonl`.toLowerCase();
  const stack = [root];
  let visitedDirectories = 0;
  while (stack.length && visitedDirectories < 512) {
    const directory = stack.pop();
    visitedDirectories += 1;
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(expectedSuffix)) {
        return entryPath;
      }
    }
  }
  return "";
}

export async function tradingTranscriptItemsFromThreadResult(result, options = {}) {
  const byId = new Map();
  collectTradingTranscriptItems(result?.thread || result, byId);
  const codexHome = firstString(options.codexHome, options.codex_home);
  const scanUnindexed = options.scanUnindexed === true || options.scan_unindexed === true;
  const threadId = firstString(
    result?.thread?.id,
    result?.thread?.threadId,
    result?.thread?.thread_id,
  );
  const indexRecord = codexHome && threadId
    ? loadTradingTranscriptIndex(codexHome).threads[threadId]
    : null;
  if (
    !byId.size
    && !scanUnindexed
    && codexHome
    && threadId
    && !indexRecord
  ) {
    return [];
  }
  let rolloutPath = threadRolloutPath(result) || indexRecord?.rolloutPath || "";
  if (!rolloutPath && scanUnindexed && codexHome && threadId) {
    rolloutPath = await findTradingTranscriptRolloutPath(codexHome, threadId);
  }
  const rolloutItems = await readTradingTranscriptItemsFromRollout(rolloutPath);
  for (const item of rolloutItems) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function markerFromThreadItem(item) {
  const direct = parseTradingTranscriptMarkerText(item?.text);
  if (direct) return direct;
  for (const content of Array.isArray(item?.content) ? item.content : []) {
    const parsed = parseTradingTranscriptMarkerText(content?.text);
    if (parsed) return parsed;
  }
  return null;
}

function visibleThreadItem(item, transcriptItem) {
  const contentType = transcriptItem.role === "user" ? "input_text" : "output_text";
  return {
    ...item,
    id: transcriptItem.id,
    type: transcriptItem.role === "user" ? "userMessage" : "agentMessage",
    role: transcriptItem.role,
    text: transcriptItem.text,
    content: [{ type: contentType, text: transcriptItem.text }],
    createdAt: transcriptItem.createdAt,
    created_at: transcriptItem.createdAt,
    ...(transcriptItem.phase ? { phase: transcriptItem.phase } : {}),
    ...(transcriptItem.startedAt ? { __youleTurnStartedAt: transcriptItem.startedAt } : {}),
    ...(transcriptItem.completedAt ? { __youleTurnCompletedAt: transcriptItem.completedAt } : {}),
    ...(transcriptItem.actions?.length ? { actions: transcriptItem.actions } : {}),
    ...(transcriptItem.executionPlanPresentation
      ? { __youleExecutionPlanPresentation: transcriptItem.executionPlanPresentation }
      : {}),
    __haoloTradingTranscript: true,
  };
}

function transcriptGroupTimestamp(items, fields, fallbackItem, select = Math.min) {
  const timestamps = items
    .map((item) => firstString(...fields.map((field) => item[field])))
    .filter(Boolean)
    .map(Date.parse)
    .filter(Number.isFinite);
  if (timestamps.length) return new Date(select(...timestamps)).toISOString();
  return fallbackItem.createdAt;
}

function syntheticTranscriptTurn(items) {
  const firstItem = items[0];
  const userItem = items.find((item) => item.role === "user") || null;
  const assistantItems = items.filter((item) => item.role === "assistant");
  const progressItems = assistantItems.filter((item) => item.phase !== "final_answer");
  const terminalItems = assistantItems.filter((item) => item.phase === "final_answer");
  const startedFallback = progressItems[0] || userItem || assistantItems[0] || firstItem;
  const completedFallback = terminalItems.at(-1) || assistantItems.at(-1) || firstItem;
  const startedAt = transcriptGroupTimestamp(items, ["startedAt"], startedFallback);
  const completedAt = terminalItems.length
    ? transcriptGroupTimestamp(items, ["completedAt"], completedFallback, Math.max)
    : null;
  return {
    id: `haolo-trading-transcript-turn-${userItem?.id || firstItem.id}`,
    status: terminalItems.length ? "completed" : "inProgress",
    startedAt,
    completedAt,
    items: items.map((item) => visibleThreadItem({}, item)),
    __haoloTradingTranscript: true,
  };
}

function groupedTradingTranscriptItems(items) {
  const groups = [];
  let current = null;
  for (const item of items) {
    if (!current || item.role === "user") {
      current = [];
      groups.push(current);
    }
    current.push(item);
  }
  return groups;
}

function turnTimestamp(turn) {
  const timestamp = Date.parse(firstString(
    turn?.startedAt,
    turn?.started_at,
    turn?.createdAt,
    turn?.created_at,
    turn?.completedAt,
    turn?.completed_at,
  ));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

export function withTradingTranscriptItems(result, transcriptItems) {
  if (!result?.thread) return result;
  const items = normalizeTradingTranscriptItems(transcriptItems);
  // Injected transcript markers can surface as one app-server turn per item.
  // Strip those transport turns and rebuild the original user/assistant turn
  // so the renderer inherits one real start/completion window after restart.
  const existingTurns = (Array.isArray(result.thread.turns) ? result.thread.turns : [])
    .map((turn) => ({
      ...turn,
      items: (Array.isArray(turn?.items) ? turn.items : []).filter((item) => (
        !markerFromThreadItem(item)
      )),
    }))
    .filter((turn) => turn.items.length);
  const syntheticTurns = groupedTradingTranscriptItems(items).map(syntheticTranscriptTurn);
  const turns = [...existingTurns, ...syntheticTurns]
    .map((turn, index) => ({ turn, index, timestamp: turnTimestamp(turn) }))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
    .map((entry) => entry.turn);
  return {
    ...result,
    thread: {
      ...result.thread,
      turns,
    },
  };
}

export async function withTradingTranscriptHistory(result, options = {}) {
  const items = await tradingTranscriptItemsFromThreadResult(result, options);
  return items.length ? withTradingTranscriptItems(result, items) : result;
}

function emptyTradingTranscriptIndex() {
  return { version: 1, threads: {}, aliases: {} };
}

function normalizedIndexRecord(value) {
  if (!value || typeof value !== "object") return null;
  const threadId = firstString(value.threadId, value.thread_id, value.id);
  const cwd = firstString(value.cwd);
  const rolloutPath = firstString(value.rolloutPath, value.rollout_path, value.path);
  if (!threadId || !cwd || !rolloutPath) return null;
  const createdAt = firstString(value.createdAt, value.created_at, value.updatedAt, value.updated_at);
  const updatedAt = firstString(value.updatedAt, value.updated_at, createdAt);
  try {
    const preview = firstString(value.preview).replace(/[\u0000-\u001f]/gu, " ").slice(0, 500);
    return {
      threadId,
      cwd: path.resolve(cwd),
      rolloutPath: path.resolve(rolloutPath),
      title: normalizedTradingTranscriptTitle(firstString(value.title, value.name), preview),
      preview,
      createdAt: normalizedCreatedAt(createdAt),
      updatedAt: normalizedCreatedAt(updatedAt),
    };
  } catch {
    return null;
  }
}

export function tradingTranscriptIndexPath(codexHome) {
  const root = firstString(codexHome);
  if (!root) throw new Error("Codex home is required for the trading transcript index");
  return path.join(path.resolve(root), TRADING_TRANSCRIPT_INDEX_FILE_NAME);
}

export function loadTradingTranscriptIndex(codexHome) {
  const filePath = tradingTranscriptIndexPath(codexHome);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyTradingTranscriptIndex();
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantinePath);
    } catch {
      // A corrupt optional index must not make ordinary thread history unavailable.
    }
    console.warn("[trading-transcript] corrupt index ignored", error?.message || error);
    return emptyTradingTranscriptIndex();
  }
  if (!parsed || parsed.version !== 1 || !parsed.threads || typeof parsed.threads !== "object") {
    return emptyTradingTranscriptIndex();
  }
  const threads = {};
  for (const value of Object.values(parsed.threads)) {
    const record = normalizedIndexRecord(value);
    if (record) threads[record.threadId] = record;
  }
  const aliases = {};
  if (parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)) {
    for (const [sourceValue, targetValue] of Object.entries(parsed.aliases)) {
      const source = firstString(sourceValue);
      const target = firstString(targetValue);
      if (source && target && source !== target) aliases[source] = target;
    }
  }
  return { version: 1, threads, aliases };
}

function resolveTradingTranscriptIndexAlias(index, threadId) {
  let current = firstString(threadId);
  if (!current) return "";
  const visited = new Set();
  while (index?.aliases?.[current] && !visited.has(current)) {
    visited.add(current);
    current = firstString(index.aliases[current]);
    if (!current) return "";
  }
  return current;
}

export function resolveTradingTranscriptIndexThreadAlias(codexHome, threadId) {
  return resolveTradingTranscriptIndexAlias(loadTradingTranscriptIndex(codexHome), threadId);
}

function writeTradingTranscriptIndex(codexHome, index) {
  const filePath = tradingTranscriptIndexPath(codexHome);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify(index)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The atomic destination has already committed or the temp never existed.
    }
  }
}

export function updateTradingTranscriptIndex(codexHome, value) {
  const incoming = normalizedIndexRecord(value);
  if (!incoming) throw new Error("trading transcript index record is invalid");
  const index = loadTradingTranscriptIndex(codexHome);
  const existing = index.threads[incoming.threadId];
  const record = {
    ...incoming,
    title: incoming.title || existing?.title || DEFAULT_TRADING_TRANSCRIPT_TITLE,
    preview: incoming.preview || existing?.preview || "",
    createdAt: existing?.createdAt || incoming.createdAt,
  };
  index.threads[record.threadId] = record;
  writeTradingTranscriptIndex(codexHome, index);
  return record;
}

export function replaceTradingTranscriptIndexThread(codexHome, previousThreadId, value) {
  const previousId = firstString(previousThreadId);
  const incoming = normalizedIndexRecord(value);
  if (!previousId || !incoming) throw new Error("trading transcript replacement record is invalid");
  const index = loadTradingTranscriptIndex(codexHome);
  const canonicalPreviousId = resolveTradingTranscriptIndexAlias(index, previousId) || previousId;
  const previous = index.threads[canonicalPreviousId] || index.threads[previousId];
  const existing = index.threads[incoming.threadId];
  const incomingTitle = incoming.title || tradingAlertTitleFromPreview(incoming.preview);
  const record = {
    ...incoming,
    title: incomingTitle || previous?.title || existing?.title || DEFAULT_TRADING_TRANSCRIPT_TITLE,
    preview: incoming.preview || previous?.preview || existing?.preview || "",
    createdAt: previous?.createdAt || existing?.createdAt || incoming.createdAt,
  };

  if (canonicalPreviousId !== record.threadId) delete index.threads[canonicalPreviousId];
  if (previousId !== record.threadId) delete index.threads[previousId];
  index.threads[record.threadId] = record;

  for (const [source, target] of Object.entries(index.aliases)) {
    if (target === previousId || target === canonicalPreviousId) {
      index.aliases[source] = record.threadId;
    }
  }
  if (previousId !== record.threadId) index.aliases[previousId] = record.threadId;
  if (canonicalPreviousId !== record.threadId) index.aliases[canonicalPreviousId] = record.threadId;
  delete index.aliases[record.threadId];
  writeTradingTranscriptIndex(codexHome, index);
  return record;
}

export function removeTradingTranscriptIndexThread(codexHome, threadId) {
  const id = firstString(threadId);
  if (!id) return false;
  const index = loadTradingTranscriptIndex(codexHome);
  const canonicalId = resolveTradingTranscriptIndexAlias(index, id) || id;
  const hadRecord = Boolean(index.threads[id] || index.threads[canonicalId]);
  const aliasesToRemove = Object.keys(index.aliases).filter((source) => (
    source === id
    || source === canonicalId
    || resolveTradingTranscriptIndexAlias(index, source) === canonicalId
  ));
  if (!hadRecord && !aliasesToRemove.length) return false;
  delete index.threads[id];
  delete index.threads[canonicalId];
  aliasesToRemove.forEach((source) => delete index.aliases[source]);
  writeTradingTranscriptIndex(codexHome, index);
  return true;
}

function comparablePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function indexedTradingTranscriptThreads(codexHome, cwd) {
  const expectedCwd = comparablePath(cwd);
  return Object.values(loadTradingTranscriptIndex(codexHome).threads)
    .filter((record) => comparablePath(record.cwd) === expectedCwd && fs.existsSync(record.rolloutPath))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((record) => ({
      id: record.threadId,
      name: record.title || DEFAULT_TRADING_TRANSCRIPT_TITLE,
      preview: record.preview,
      cwd: record.cwd,
      path: record.rolloutPath,
      source: "appServer",
      createdAt: record.createdAt,
      created_at: record.createdAt,
      updatedAt: record.updatedAt,
      updated_at: record.updatedAt,
      last_message_at: record.updatedAt,
      archived: false,
      hasUserEvent: true,
      has_user_event: true,
      turns: [],
    }));
}

export function mergeIndexedTradingTranscriptThreads(result, indexedThreads) {
  const serverThreads = Array.isArray(result?.data) ? result.data : [];
  const indexedById = new Map((Array.isArray(indexedThreads) ? indexedThreads : []).map((thread) => [thread.id, thread]));
  const serverIds = new Set(serverThreads.map((thread) => firstString(
    thread?.id,
    thread?.threadId,
    thread?.thread_id,
  )));
  const merged = [
    ...serverThreads.map((thread) => {
      const threadId = firstString(thread?.id, thread?.threadId, thread?.thread_id);
      const indexed = indexedById.get(threadId);
      const serverTitle = firstString(thread?.name, thread?.title);
      const normalizedServerTitle = normalizedTradingTranscriptTitle(serverTitle);
      if (!indexed?.name || (normalizedServerTitle && normalizedServerTitle !== DEFAULT_TRADING_TRANSCRIPT_TITLE)) return thread;
      return { ...thread, name: indexed.name };
    }),
    ...(Array.isArray(indexedThreads) ? indexedThreads : []).filter((thread) => !serverIds.has(thread.id)),
  ].sort((left, right) => {
    const timestamp = (thread) => Date.parse(firstString(
      thread?.updatedAt,
      thread?.updated_at,
      thread?.last_message_at,
      thread?.createdAt,
      thread?.created_at,
    )) || 0;
    return timestamp(right) - timestamp(left);
  });
  return { ...(result || {}), data: merged };
}
