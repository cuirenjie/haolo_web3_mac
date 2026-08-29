import fs from "node:fs";

const BACKGROUND_HYDRATION_ITEM_TYPES = new Set(["userMessage", "agentMessage"]);
const ACTIVE_CONVERSATION_ITEM_TYPES = new Set(["userMessage", "agentMessage", "channelMessage"]);
const ACTIVE_PROCESS_VALUE_MAX_CHARS = 16_000;
const ACTIVE_PROCESS_VALUE_TAIL_CHARS = 12_000;
const ROLLOUT_USAGE_TAIL_MAX_BYTES = 4 * 1024 * 1024;
// HAOLO-CONTEXT-RECOVERY-PATCH-BEGIN
const ZERO_CONTEXT_USAGE_RECOVERY_RATIO = 0.8;
// HAOLO-CONTEXT-RECOVERY-PATCH-END

export async function readLatestThreadContextUsage(thread) {
  const rolloutPath = typeof thread?.path === "string" ? thread.path.trim() : "";
  if (!rolloutPath || !/\.jsonl$/i.test(rolloutPath)) return null;
  let handle;
  try {
    handle = await fs.promises.open(rolloutPath, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) return null;
    const byteLength = Math.min(stat.size, ROLLOUT_USAGE_TAIL_MAX_BYTES);
    const buffer = Buffer.allocUnsafe(byteLength);
    const { bytesRead } = await handle.read(buffer, 0, byteLength, stat.size - byteLength);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);
    if (stat.size > byteLength) lines.shift();
    let latestUsage = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line || !line.includes('"token_count"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "event_msg" || record?.payload?.type !== "token_count") continue;
      const info = record.payload.info || {};
      const last = info.last_token_usage || info.lastTokenUsage || {};
      const usedTokens = nonNegativeInteger(last.total_tokens ?? last.totalTokens);
      const modelContextWindow = nonNegativeInteger(info.model_context_window ?? info.modelContextWindow);
      if (usedTokens == null && modelContextWindow == null) return null;
      const usage = { usedTokens, modelContextWindow };
      if (!latestUsage) {
        latestUsage = usage;
        if (usedTokens !== 0) return latestUsage;
        continue;
      }
      // HAOLO-CONTEXT-RECOVERY-PATCH-BEGIN
      // A failed full-context turn can append a zero token sample even though
      // the existing history is still full. Recover only when the immediately
      // preceding non-zero sample was already near the active window limit.
      const effectiveWindow = latestUsage.modelContextWindow ?? modelContextWindow;
      if (usedTokens == null || usedTokens === 0) continue;
      if (
        latestUsage.usedTokens === 0 &&
        effectiveWindow != null &&
        effectiveWindow > 0 &&
        usedTokens != null &&
        usedTokens >= Math.floor(effectiveWindow * ZERO_CONTEXT_USAGE_RECOVERY_RATIO)
      ) {
        return { usedTokens: effectiveWindow, modelContextWindow: effectiveWindow };
      }
      // HAOLO-CONTEXT-RECOVERY-PATCH-END
      return latestUsage;
    }
    if (latestUsage) return latestUsage;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
  return null;
}

export function compactBackgroundThreadReadResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const thread = result.thread;
  if (!thread || typeof thread !== "object" || Array.isArray(thread) || !Array.isArray(thread.turns)) return result;

  return {
    ...result,
    thread: {
      ...thread,
      turns: thread.turns.map(compactBackgroundHydrationTurn),
    },
  };
}

export function compactActiveThreadReadResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const thread = result.thread;
  if (!thread || typeof thread !== "object" || Array.isArray(thread) || !Array.isArray(thread.turns)) return result;

  return {
    ...result,
    thread: {
      ...thread,
      turns: thread.turns.map(compactActiveHydrationTurn),
    },
  };
}

export function compactActiveThreadNotification(message) {
  if (message?.method !== "thread/started" || !message.params?.thread) return message;
  const compacted = compactActiveThreadReadResult({ thread: message.params.thread });
  if (compacted.thread === message.params.thread) return message;
  return {
    ...message,
    params: {
      ...message.params,
      thread: compacted.thread,
    },
  };
}

export function compactActiveThreadItemForRenderer(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  if (ACTIVE_CONVERSATION_ITEM_TYPES.has(String(item.type || ""))) return item;
  return compactActiveProcessValue(item);
}

function compactBackgroundHydrationTurn(turn) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn) || !Array.isArray(turn.items)) return turn;
  return {
    ...turn,
    items: turn.items.filter((item) => BACKGROUND_HYDRATION_ITEM_TYPES.has(String(item?.type || ""))),
  };
}

function compactActiveHydrationTurn(turn) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn) || !Array.isArray(turn.items)) return turn;
  return {
    ...turn,
    items: turn.items.map(compactActiveThreadItemForRenderer),
  };
}

function compactActiveProcessValue(value) {
  if (typeof value === "string") return compactActiveProcessText(value);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const compacted = compactActiveProcessValue(entry);
      if (compacted !== entry) changed = true;
      return compacted;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== "object") return value;
  const compactedImageBlock = compactActiveProcessImageBlock(value);
  if (compactedImageBlock) return compactedImageBlock;
  let changed = false;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactActiveProcessValue(entry);
    next[key] = compacted;
    if (compacted !== entry) changed = true;
  }
  return changed ? next : value;
}

function compactActiveProcessImageBlock(value) {
  if (value.type !== "input_image" && value.type !== "output_image") return null;
  const imageUrl = typeof value.image_url === "string"
    ? value.image_url
    : typeof value.imageUrl === "string"
      ? value.imageUrl
      : "";
  if (imageUrl.length <= ACTIVE_PROCESS_VALUE_MAX_CHARS || !imageUrl.startsWith("data:image/")) return null;
  const { image_url: _imageUrl, imageUrl: _imageUrlCamel, detail: _detail, ...rest } = value;
  return {
    ...rest,
    type: value.type === "output_image" ? "output_text" : "input_text",
    text: `[historical tool image omitted from renderer: ${imageUrl.length} chars]`,
  };
}

function compactActiveProcessText(value) {
  if (value.length <= ACTIVE_PROCESS_VALUE_MAX_CHARS) return value;
  const headChars = ACTIVE_PROCESS_VALUE_MAX_CHARS - ACTIVE_PROCESS_VALUE_TAIL_CHARS;
  return [
    value.slice(0, headChars),
    `[process output truncated for renderer: ${value.length} chars total]`,
    value.slice(-ACTIVE_PROCESS_VALUE_TAIL_CHARS),
  ].join("\n");
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}
