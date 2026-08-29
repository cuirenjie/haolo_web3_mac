import { estimateAgentTextTokens } from "./context-budget";

export const THREAD_CONTINUATION_HISTORY_RATIO = 0.2;
export const THREAD_CONTINUATION_WELCOME_TEXT =
  "原会话信息有点多，小咯已经帮你整理并续接到新任务啦。关键上下文和最近2条消息都保留好了，可以继续吩咐我办事~";

export const THREAD_CONTINUATION_INTERNAL_PREFIXES = Object.freeze([
  "<haolo_thread_continuation_handoff>",
  "<haolo_thread_continuation_copy>",
  "<haolo_thread_continuation_welcome>",
]);

export type ThreadContinuationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ThreadContinuationCopiedMessage = ThreadContinuationMessage & {
  summarized: boolean;
};

export type ThreadContinuationHandoff = {
  originalTokens: number;
  budgetTokens: number;
  transferredTokens: number;
  olderSummary: string;
  copiedMessages: ThreadContinuationCopiedMessage[];
};

export type ThreadContinuationInjectedItem = {
  type: "message";
  role: "user" | "assistant";
  content: Array<{
    type: "input_text" | "output_text";
    text: string;
  }>;
};

const SUMMARY_LABEL = "（内容已摘要）";
const SUMMARY_SUFFIX = `\n${SUMMARY_LABEL}`;
const TRUNCATION_SEPARATOR = "…";
const HANDOFF_INTRO =
  "这是从原任务自动续接的只读上下文。请把它当作此前已经确认的会话背景，不要向用户复述内部标记。";
const HANDOFF_SOURCE_PREFIX = "原任务：";
const EMPTY_OLDER_SUMMARY = "较早历史没有可用的剩余交接预算。";
const MAX_SUMMARY_CANDIDATE_CHARS = 1_200;
const MAX_SUMMARY_ITEMS_PER_SECTION = 8;

export function buildThreadContinuationHandoff(
  messages: readonly ThreadContinuationMessage[],
  ratio = THREAD_CONTINUATION_HISTORY_RATIO,
): ThreadContinuationHandoff {
  const normalized = messages
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      text: normalizeContinuationText(message.text),
    }))
    .filter((message) => Boolean(message.text));
  const originalTokens = normalized.reduce((total, message) => total + estimateAgentTextTokens(message.text), 0);
  // The product contract is a hard 20% ceiling. Keep the optional ratio useful
  // for stricter tests/callers, but never allow it to raise that ceiling.
  const safeRatio = Number.isFinite(ratio)
    ? Math.max(0, Math.min(THREAD_CONTINUATION_HISTORY_RATIO, ratio))
    : THREAD_CONTINUATION_HISTORY_RATIO;
  const budgetTokens = Math.floor(originalTokens * safeRatio);
  if (!normalized.length || budgetTokens <= 0) {
    return { originalTokens, budgetTokens, transferredTokens: 0, olderSummary: "", copiedMessages: [] };
  }

  const recent = normalized.slice(-2);
  const older = normalized.slice(0, -recent.length);
  const copiedMessages = fitRecentMessages(recent, budgetTokens);
  const copiedTokens = copiedMessages.reduce((total, message) => total + estimateAgentTextTokens(message.text), 0);
  const summaryBudget = Math.max(0, budgetTokens - copiedTokens);
  const olderSummary = buildStructuredOlderSummary(older, summaryBudget);
  const transferredTokens = copiedTokens + estimateAgentTextTokens(olderSummary);

  return {
    originalTokens,
    budgetTokens,
    transferredTokens,
    olderSummary,
    copiedMessages,
  };
}

export function buildThreadContinuationInjectedItems(
  sourceTitle: string,
  handoff: ThreadContinuationHandoff,
): ThreadContinuationInjectedItem[] {
  const items: ThreadContinuationInjectedItem[] = [];
  const normalizedSourceTitle = normalizeContinuationText(sourceTitle).replace(/\s*\n+\s*/g, " ");
  const handoffLines = [
    HANDOFF_INTRO,
    `${HANDOFF_SOURCE_PREFIX}${normalizedSourceTitle || "未命名任务"}`,
    handoff.olderSummary || EMPTY_OLDER_SUMMARY,
  ];
  items.push(injectedMessage("user", "input_text", wrapInternal("handoff", handoffLines.join("\n\n"))));
  for (const message of handoff.copiedMessages) {
    items.push(
      injectedMessage(
        message.role,
        message.role === "assistant" ? "output_text" : "input_text",
        wrapInternal("copy", message.text),
      ),
    );
  }
  items.push(injectedMessage("assistant", "output_text", wrapInternal("welcome", THREAD_CONTINUATION_WELCOME_TEXT)));
  return items;
}

export function parseThreadContinuationInjectedItems(items: readonly unknown[] | null | undefined): {
  olderSummary: string;
  copiedMessages: ThreadContinuationCopiedMessage[];
} {
  let olderSummary = "";
  const copiedMessages: ThreadContinuationCopiedMessage[] = [];
  for (const item of items || []) {
    const parsed = parseInjectedMessage(item);
    if (!parsed) continue;

    const handoff = unwrapInternal("handoff", parsed.text);
    if (parsed.role === "user" && parsed.contentType === "input_text" && handoff != null) {
      const prefix = `${HANDOFF_INTRO}\n\n${HANDOFF_SOURCE_PREFIX}`;
      if (!handoff.startsWith(prefix)) continue;
      const sourceEnd = handoff.indexOf("\n\n", prefix.length);
      if (sourceEnd < 0 || !handoff.slice(prefix.length, sourceEnd).trim()) continue;
      const summary = normalizeContinuationText(handoff.slice(sourceEnd + 2));
      olderSummary = summary === EMPTY_OLDER_SUMMARY ? "" : summary;
      continue;
    }

    const copy = unwrapInternal("copy", parsed.text);
    const expectedContentType = parsed.role === "assistant" ? "output_text" : "input_text";
    if (copy != null && parsed.contentType === expectedContentType) {
      const text = normalizeContinuationText(copy);
      if (!text) continue;
      copiedMessages.push({ role: parsed.role, text, summarized: text.includes(SUMMARY_LABEL) });
      continue;
    }

    // Validate the third marker shape as well, even though the local welcome is
    // intentionally not part of the reconstructed handoff payload.
    const welcome = unwrapInternal("welcome", parsed.text);
    if (
      welcome != null
      && parsed.role === "assistant"
      && parsed.contentType === "output_text"
      && normalizeContinuationText(welcome) === THREAD_CONTINUATION_WELCOME_TEXT
    ) {
      continue;
    }
  }
  return { olderSummary, copiedMessages };
}

export function isThreadContinuationInternalText(value: unknown) {
  const text = String(value || "").trimStart();
  return THREAD_CONTINUATION_INTERNAL_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function fitRecentMessages(
  messages: readonly ThreadContinuationMessage[],
  budgetTokens: number,
): ThreadContinuationCopiedMessage[] {
  if (!messages.length || budgetTokens <= 0) return [];
  const totalTokens = messages.reduce((total, message) => total + estimateAgentTextTokens(message.text), 0);
  if (totalTokens <= budgetTokens) {
    return messages.map((message) => ({ ...message, summarized: false }));
  }

  // Once the pair does not fit, both bubbles must visibly say that they were
  // summarized. If even the two atomic labels do not fit, returning no copied
  // bubbles is safer than showing an incomplete label or pretending both exist.
  const minimumPerMessage = estimateAgentTextTokens(SUMMARY_LABEL);
  const minimumTotal = minimumPerMessage * messages.length;
  if (budgetTokens < minimumTotal) return [];

  const originalTokenCounts = messages.map((message) => estimateAgentTextTokens(message.text));
  const bodyBudget = budgetTokens - minimumTotal;
  const allocations = originalTokenCounts.map((originalTokens) =>
    minimumPerMessage + Math.floor((bodyBudget * originalTokens) / Math.max(1, totalTokens))
  );
  let unallocated = budgetTokens - allocations.reduce((total, value) => total + value, 0);
  for (let index = 0; unallocated > 0; index = (index + 1) % allocations.length) {
    allocations[index] += 1;
    unallocated -= 1;
  }

  const copied = messages.map((message, index) => ({
    ...message,
    text: summarizeMarkedTextToTokenBudget(message.text, allocations[index]),
    summarized: true,
  }));
  if (copied.some((message) => !message.text.includes(SUMMARY_LABEL))) return [];
  if (copied.reduce((total, message) => total + estimateAgentTextTokens(message.text), 0) > budgetTokens) return [];
  return copied;
}

function buildStructuredOlderSummary(messages: readonly ThreadContinuationMessage[], budgetTokens: number) {
  if (!messages.length || budgetTokens <= 0) return "";
  const sections = new Map<string, string[]>();
  const seenBySection = new Map<string, Set<string>>();
  const add = (section: string, value: string) => {
    const text = boundedSummaryCandidate(value);
    const key = text.toLocaleLowerCase();
    const seen = seenBySection.get(section) || new Set<string>();
    if (!text || seen.has(key)) return;
    seen.add(key);
    seenBySection.set(section, seen);
    const entries = sections.get(section) || [];
    if (entries.length >= MAX_SUMMARY_ITEMS_PER_SECTION) return;
    entries.push(text);
    sections.set(section, entries);
  };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const label = message.role === "assistant" ? "智能体" : "用户";
    const text = message.text;
    const line = `${label}：${text}`;
    if (/(?:需求|目标|希望|需要|请|要做|实现|修改|支持|want|need|goal|require)/i.test(text)) add("目标与需求", line);
    if (/(?:确认|决定|同意|采用|必须|不要|应当|约定|方案|结论|approved|decid|must|should)/i.test(text)) add("已确认决策", line);
    if (/(?:[A-Za-z]:[\\/]|(?:^|\s)[./][\w./\\-]+|\.(?:ts|tsx|js|mjs|cjs|json|md|css|html|py|go|rs)\b|文件|代码|配置|测试|build|test)/i.test(text)) {
      add("涉及文件、修改与验证", line);
    }
    if (/(?:未完成|待办|下一步|风险|失败|错误|异常|阻塞|注意|问题|pending|todo|risk|fail|error|block)/i.test(text)) {
      add("未完成事项与风险", line);
    }
    if (index >= messages.length - 6) add("最近进展", line);
  }

  const order = ["目标与需求", "已确认决策", "涉及文件、修改与验证", "未完成事项与风险", "最近进展"];
  const rendered = ["较早历史结构化压缩记录："];
  for (const section of order) {
    const entries = sections.get(section);
    if (!entries?.length) continue;
    rendered.push(`${section}：`, ...entries.map((entry) => `- ${entry}`));
  }
  if (rendered.length === 1) {
    rendered.push(...messages.slice(-MAX_SUMMARY_ITEMS_PER_SECTION).map((message) => `- ${message.role === "assistant" ? "智能体" : "用户"}：${boundedSummaryCandidate(message.text)}`));
  }
  return summarizeTextToTokenBudget(rendered.join("\n"), budgetTokens, false);
}

function summarizeTextToTokenBudget(text: string, budgetTokens: number, markSummarized = true) {
  const normalized = normalizeContinuationText(text);
  if (!normalized || budgetTokens <= 0) return "";
  if (estimateAgentTextTokens(normalized) <= budgetTokens) return normalized;
  const suffix = markSummarized ? SUMMARY_SUFFIX : "";
  const suffixTokens = estimateAgentTextTokens(suffix);
  if (suffixTokens >= budgetTokens) return "";
  const body = truncateTextHeadAndTailToTokenBudget(normalized, budgetTokens - suffixTokens).trimEnd();
  if (!body) return "";
  const combined = `${body}${suffix}`;
  return estimateAgentTextTokens(combined) <= budgetTokens
    ? combined
    : "";
}

function summarizeMarkedTextToTokenBudget(text: string, budgetTokens: number) {
  const normalized = normalizeContinuationText(text);
  if (!normalized || budgetTokens < estimateAgentTextTokens(SUMMARY_LABEL)) return "";
  if (estimateAgentTextTokens(`${normalized}${SUMMARY_SUFFIX}`) <= budgetTokens) {
    return `${normalized}${SUMMARY_SUFFIX}`;
  }
  const bodyBudget = budgetTokens - estimateAgentTextTokens(SUMMARY_SUFFIX);
  if (bodyBudget <= 0) return SUMMARY_LABEL;
  const body = truncateTextHeadAndTailToTokenBudget(normalized, bodyBudget).trimEnd();
  if (!body) return SUMMARY_LABEL;
  const combined = `${body}${SUMMARY_SUFFIX}`;
  return estimateAgentTextTokens(combined) <= budgetTokens ? combined : SUMMARY_LABEL;
}

function truncateTextHeadAndTailToTokenBudget(text: string, budgetTokens: number) {
  const characters = Array.from(String(text || ""));
  if (!characters.length || budgetTokens <= 0) return "";
  if (estimateAgentTextTokens(characters.join("")) <= budgetTokens) return characters.join("");
  if (characters.length < 2 || estimateAgentTextTokens(TRUNCATION_SEPARATOR) >= budgetTokens) return "";

  const candidate = (keptCharacters: number) => {
    const headLength = Math.ceil(keptCharacters / 2);
    const tailLength = Math.floor(keptCharacters / 2);
    if (headLength <= 0 || tailLength <= 0 || headLength + tailLength >= characters.length) return "";
    return `${characters.slice(0, headLength).join("")}${TRUNCATION_SEPARATOR}${characters.slice(-tailLength).join("")}`;
  };

  let low = 2;
  let high = Math.max(1, characters.length - 1);
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = candidate(middle);
    if (value && estimateAgentTextTokens(value) <= budgetTokens) {
      best = value;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function boundedSummaryCandidate(value: string) {
  const text = normalizeContinuationText(value);
  const characters = Array.from(text);
  if (characters.length <= MAX_SUMMARY_CANDIDATE_CHARS) return text;
  const retainedCharacters = MAX_SUMMARY_CANDIDATE_CHARS - TRUNCATION_SEPARATOR.length;
  const headLength = Math.ceil(retainedCharacters / 2);
  const tailLength = Math.floor(retainedCharacters / 2);
  return `${characters.slice(0, headLength).join("").trimEnd()}${TRUNCATION_SEPARATOR}${characters.slice(-tailLength).join("").trimStart()}`;
}

function normalizeContinuationText(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function wrapInternal(kind: "handoff" | "copy" | "welcome", text: string) {
  return `<haolo_thread_continuation_${kind}>\n${text}\n</haolo_thread_continuation_${kind}>`;
}

function unwrapInternal(kind: "handoff" | "copy" | "welcome", value: string) {
  const opening = `<haolo_thread_continuation_${kind}>`;
  const closing = `</haolo_thread_continuation_${kind}>`;
  const text = String(value || "");
  if (!text.startsWith(`${opening}\n`) || !text.endsWith(`\n${closing}`)) return null;
  return text.slice(opening.length + 1, -(closing.length + 1));
}

function parseInjectedMessage(value: unknown): {
  role: "user" | "assistant";
  contentType: "input_text" | "output_text";
  text: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ThreadContinuationInjectedItem>;
  if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) return null;
  if (!Array.isArray(item.content) || item.content.length !== 1) return null;
  const content = item.content[0];
  if (!content || (content.type !== "input_text" && content.type !== "output_text") || typeof content.text !== "string") {
    return null;
  }
  return { role: item.role, contentType: content.type, text: content.text };
}

function injectedMessage(
  role: "user" | "assistant",
  contentType: "input_text" | "output_text",
  text: string,
): ThreadContinuationInjectedItem {
  return { type: "message", role, content: [{ type: contentType, text }] };
}
