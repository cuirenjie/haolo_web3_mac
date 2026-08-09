const THREAD_SEARCH_SORT_KEYS = new Map([
  ["createdat", "created_at"],
  ["updatedat", "updated_at"],
  ["recencyat", "recency_at"],
]);

const THREAD_SEARCH_SORT_DIRECTIONS = new Map([
  ["asc", "asc"],
  ["ascending", "asc"],
  ["desc", "desc"],
  ["descending", "desc"],
]);

const THREAD_SEARCH_SOURCE_KINDS = new Map([
  ["cli", "cli"],
  ["vscode", "vscode"],
  ["exec", "exec"],
  ["appserver", "appServer"],
  ["subagent", "subAgent"],
  ["subagentreview", "subAgentReview"],
  ["subagentcompact", "subAgentCompact"],
  ["subagentthreadspawn", "subAgentThreadSpawn"],
  ["subagentother", "subAgentOther"],
  ["unknown", "unknown"],
]);

export const THREAD_SEARCH_FALLBACK_CODE = "THREAD_SEARCH_UNAVAILABLE";

export function normalizeThreadSearchParams(params = {}) {
  const searchTerm = String(params.searchTerm ?? params.search_term ?? "").trim();
  if (!searchTerm) {
    const error = new Error("searchTerm is required");
    error.code = "THREAD_SEARCH_INVALID_QUERY";
    throw error;
  }

  const normalized = { searchTerm };
  const limit = normalizedLimit(params.limit);
  const cursor = normalizedOptionalString(params.cursor);
  const sortKey = normalizedEnum(params.sortKey ?? params.sort_key, THREAD_SEARCH_SORT_KEYS);
  const sortDirection = normalizedEnum(params.sortDirection ?? params.sort_direction, THREAD_SEARCH_SORT_DIRECTIONS);
  const sourceKinds = normalizedSourceKinds(params.sourceKinds ?? params.source_kinds);
  const archived = normalizedOptionalBoolean(params.archived);

  if (limit !== undefined) normalized.limit = limit;
  if (cursor !== undefined) normalized.cursor = cursor;
  if (sortKey !== undefined) normalized.sortKey = sortKey;
  if (sortDirection !== undefined) normalized.sortDirection = sortDirection;
  if (sourceKinds !== undefined) normalized.sourceKinds = sourceKinds;
  if (archived !== undefined) normalized.archived = archived;
  return normalized;
}

export async function searchThreadsWithFallback({ request, params = {} } = {}) {
  if (typeof request !== "function") throw new TypeError("request is required");
  const requestParams = normalizeThreadSearchParams(params);
  try {
    return await request("thread/search", requestParams);
  } catch (error) {
    const fallback = classifyThreadSearchUnavailableError(error);
    if (!fallback) throw error;
    return {
      data: [],
      nextCursor: null,
      backwardsCursor: null,
      fallback: {
        required: true,
        code: THREAD_SEARCH_FALLBACK_CODE,
        reason: fallback.reason,
        rpcCode: fallback.rpcCode,
      },
    };
  }
}

export function classifyThreadSearchUnavailableError(error) {
  const rpcCode = firstFiniteNumber(
    error?.code,
    error?.data?.code,
    error?.data?.error?.code,
  );
  const message = [error?.message, error?.data?.message, error?.data?.error?.message]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
  if (rpcCode === -32601 || /method\s+not\s+found|unknown\s+method/i.test(message)) {
    return { reason: "method_not_found", rpcCode: rpcCode ?? -32601 };
  }
  if (/not\s+supported|unsupported|not\s+implemented/i.test(message)) {
    return { reason: "unsupported", rpcCode: rpcCode ?? null };
  }
  return null;
}

function normalizedLimit(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(0xffffffff, Math.max(0, Math.trunc(parsed)));
}

function normalizedOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizedEnum(value, values) {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return values.get(key);
}

function normalizedSourceKinds(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = [];
  const seen = new Set();
  for (const entry of entries) {
    const sourceKind = normalizedEnum(entry, THREAD_SEARCH_SOURCE_KINDS);
    if (!sourceKind || seen.has(sourceKind)) continue;
    seen.add(sourceKind);
    normalized.push(sourceKind);
  }
  return normalized.length ? normalized : undefined;
}

function normalizedOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || String(value).trim().toLowerCase() === "true" || String(value).trim() === "1") return true;
  if (value === 0 || String(value).trim().toLowerCase() === "false" || String(value).trim() === "0") return false;
  return undefined;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}
