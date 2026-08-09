export function isInternalSubagentThreadRecord(thread) {
  return classifyThreadRecordVisibility(thread) === "internal-subagent";
}

export function classifyThreadRecordVisibility(thread) {
  if (!thread || typeof thread !== "object") return "unknown";
  if (subagentParentThreadIdFromRecord(thread)) return "internal-subagent";
  const source = thread.source;
  const sourceRecord = threadSourceRecord(thread);
  const candidates = [
    thread.sourceKind,
    thread.source_kind,
    thread.threadSource,
    thread.thread_source,
    typeof source === "string" ? source : null,
    sourceRecord?.kind,
    sourceRecord?.type,
    sourceRecord?.sourceKind,
    sourceRecord?.source_kind,
    ...Object.keys(sourceRecord || {}),
  ];
  if (candidates.some(isInternalSubagentSourceKind)) return "internal-subagent";
  if (candidates.some(isVisibleThreadSourceKind)) return "visible";
  return "unknown";
}

export function isInternalSubagentThreadStartedNotification(message) {
  return message?.method === "thread/started" && isInternalSubagentThreadRecord(message.params?.thread);
}

// A sub_agent_activity item is emitted by the parent immediately after a
// child is created and carries the child's own thread id. Unlike participant
// lists on collabAgentToolCall, this field cannot refer to the parent or a
// peer, so it is authoritative enough to establish internal-child identity
// before the child's first thread/started or streaming notification arrives.
export function internalSubagentThreadIdsFromProcessItem(item) {
  if (!item || typeof item !== "object") return [];
  const type = normalizeSourceKind(item.type);
  if (type === "subagentactivity") {
    const threadId = firstString(item.agentThreadId, item.agent_thread_id);
    return threadId ? [threadId] : [];
  }
  // A spawnAgent receiver is the newly-created child. Receivers on later
  // collaboration calls can be a parent or peer and remain activity hints.
  if (type !== "collabagenttoolcall" || normalizeSourceKind(firstString(item.tool, item.name)) !== "spawnagent") return [];
  return uniqueStrings([
    ...arrayStrings(item.receiverThreadIds),
    ...arrayStrings(item.receiver_thread_ids),
  ]);
}

// Collaboration participants are activity hints only. They may be a parent or
// peer, so callers must never use these IDs to decide thread visibility.
export function subagentActivityThreadIdsFromProcessItem(item) {
  if (!item || typeof item !== "object") return [];
  const type = normalizeSourceKind(item.type);
  if (type === "subagentactivity") {
    const threadId = firstString(item.agentThreadId, item.agent_thread_id);
    return threadId ? [threadId] : [];
  }
  if (type !== "collabagenttoolcall") return [];
  const states = objectValue(item.agentsStates) || objectValue(item.agents_states) || {};
  return uniqueStrings([
    ...arrayStrings(item.receiverThreadIds),
    ...arrayStrings(item.receiver_thread_ids),
    ...Object.keys(states),
  ]);
}

export function createInternalSubagentThreadRegistry() {
  let idsByClient = new WeakMap();
  const rememberInternal = (client, threadId) => {
    const normalizedThreadId = firstString(threadId);
    if (!isWeakMapKey(client) || !normalizedThreadId) return false;
    let ids = idsByClient.get(client);
    if (!ids) {
      ids = new Set();
      idsByClient.set(client, ids);
    }
    ids.add(normalizedThreadId);
    return true;
  };
  return {
    remember(client, thread) {
      const threadId = threadRecordId(thread);
      const visibility = classifyThreadRecordVisibility(thread);
      if (!isWeakMapKey(client) || !threadId) return visibility;
      if (visibility === "internal-subagent") {
        rememberInternal(client, threadId);
      }
      // Thread IDs do not change identity during their lifetime. Once a
      // record has authoritatively identified an internal child, later sparse
      // or parent-derived snapshots must not promote it into the top-level
      // conversation list. Client teardown is the only reset boundary.
      return idsByClient.get(client)?.has(threadId) ? "internal-subagent" : visibility;
    },
    rememberInternal,
    has(client, threadId) {
      return Boolean(isWeakMapKey(client) && firstString(threadId) && idsByClient.get(client)?.has(String(threadId).trim()));
    },
    clear(client) {
      if (isWeakMapKey(client)) idsByClient.delete(client);
    },
    clearAll() {
      idsByClient = new WeakMap();
    },
  };
}

export async function collectVisibleThreadPage({
  requestPage,
  params = {},
  includeEntry = () => true,
  threadFromEntry = (entry) => entry,
  onThread = () => {},
  maxPages = 64,
} = {}) {
  if (typeof requestPage !== "function") throw new TypeError("requestPage is required");
  const requestedLimit = normalizedPageLimit(params.limit, 25);
  if (requestedLimit === 0) {
    const page = await requestPage({ ...params, limit: 0 });
    return { ...page, data: [] };
  }

  const collected = [];
  const seenThreadIds = new Set();
  const seenCursors = new Set();
  let cursor = firstString(params.cursor);
  let firstPage = null;
  let lastPage = null;

  for (let pageIndex = 0; pageIndex < maxPages && collected.length < requestedLimit; pageIndex += 1) {
    if (cursor) {
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
    }
    const pageParams = {
      ...params,
      limit: Math.max(1, requestedLimit - collected.length),
      ...(cursor ? { cursor } : { cursor: null }),
    };
    const page = await requestPage(pageParams);
    firstPage ||= page || {};
    lastPage = page || {};
    const entries = Array.isArray(page?.data) ? page.data : [];
    for (const entry of entries) {
      const thread = threadFromEntry(entry);
      if (!thread || typeof thread !== "object") continue;
      onThread(thread, entry);
      if (!includeEntry(entry, thread)) continue;
      const threadId = threadRecordId(thread);
      if (threadId && seenThreadIds.has(threadId)) continue;
      if (threadId) seenThreadIds.add(threadId);
      collected.push(entry);
      if (collected.length >= requestedLimit) break;
    }
    cursor = firstString(page?.nextCursor, page?.next_cursor);
    if (!cursor) break;
  }

  const base = firstPage || lastPage || {};
  return {
    ...base,
    data: collected,
    nextCursor: firstString(lastPage?.nextCursor, lastPage?.next_cursor),
    backwardsCursor: firstString(firstPage?.backwardsCursor, firstPage?.backwards_cursor),
  };
}

function isInternalSubagentSourceKind(value) {
  if (typeof value !== "string") return false;
  return INTERNAL_SUBAGENT_SOURCE_KINDS.has(normalizeSourceKind(value));
}

function isVisibleThreadSourceKind(value) {
  if (typeof value !== "string") return false;
  return VISIBLE_THREAD_SOURCE_KINDS.has(normalizeSourceKind(value));
}

function normalizeSourceKind(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.map((entry) => firstString(entry)).filter(Boolean) : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

export function subagentParentThreadIdFromRecord(thread) {
  const source = threadSourceRecord(thread);
  return firstString(
    thread?.parentThreadId,
    thread?.parent_thread_id,
    source?.parentThreadId,
    source?.parent_thread_id,
    source?.subagent?.thread_spawn?.parentThreadId,
    source?.subagent?.thread_spawn?.parent_thread_id,
    source?.subAgent?.thread_spawn?.parentThreadId,
    source?.subAgent?.thread_spawn?.parent_thread_id,
    source?.subAgent?.threadSpawn?.parentThreadId,
    source?.subAgent?.threadSpawn?.parent_thread_id,
  );
}

function threadSourceRecord(thread) {
  const source = thread?.source;
  const direct = objectValue(source);
  if (direct) return direct;
  if (typeof source !== "string") return null;
  const serialized = source.trim();
  if (!serialized.startsWith("{") || !serialized.endsWith("}")) return null;
  try {
    return objectValue(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function threadRecordId(thread) {
  return firstString(thread?.id, thread?.threadId, thread?.thread_id);
}

function normalizedPageLimit(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(0xffffffff, Math.max(0, Math.trunc(parsed)));
}

function isWeakMapKey(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

const INTERNAL_SUBAGENT_SOURCE_KINDS = new Set([
  "subagent",
  "subagentreview",
  "subagentcompact",
  "subagentthreadspawn",
  "subagentother",
]);

const VISIBLE_THREAD_SOURCE_KINDS = new Set([
  "cli",
  "vscode",
  "exec",
  "appserver",
  "user",
]);
