export type ExecutionPlanCandidate = {
  title: string;
  content: string;
};

export type ExecutionPlanTextPartition = {
  before: string;
  candidate: ExecutionPlanCandidate;
  after: string;
};

export type ExecutionPlanDisplayLine = {
  label: string;
  text: string;
};

export type ExecutionPlanDirectionTone = "bearish" | "bullish" | "";

export type ExecutionPlanSignedNumberSegment = {
  text: string;
  tone: ExecutionPlanDirectionTone;
};

export type ExecutionPlanStatus = "pending" | "executing" | "ended";
export type ExecutionPlanEndReason = "take_profit" | "stop_loss" | "cancelled" | "expired";

export type SavedExecutionPlan = ExecutionPlanCandidate & {
  schemaVersion: 2;
  id: string;
  sourceThreadId: string;
  sourceMessageId: string;
  sourceTitle: string;
  createdAt: string;
  status: ExecutionPlanStatus;
  endReason: ExecutionPlanEndReason | null;
  statusUpdatedAt: string;
  linkedAlertId: string | null;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const EXECUTION_PLAN_STORAGE_PREFIX = "haolo.execution-plans.v1";
const MAX_SAVED_EXECUTION_PLANS = 100;
const MAX_PLAN_CONTENT_LENGTH = 20_000;
const EXECUTION_PLAN_STATUSES = new Set<ExecutionPlanStatus>(["pending", "executing", "ended"]);
const EXECUTION_PLAN_END_REASONS = new Set<ExecutionPlanEndReason>(["take_profit", "stop_loss", "cancelled", "expired"]);

const CORE_PLAN_LABEL = /(?:当前动作|方向判断|(?:多头|空头|首选方向)?触发|止损(?:与失效)?|分批止盈|风险收益比|候选(?:测算|止损|止盈))/;
const PLAN_HEADING = /^(?:(?:标准|推荐|首选|备选|候选|可选)\s*)?(?:(?:执行|行动|实施|操作|落地)\s*)?(?:方案|计划)(?:\s*[A-C一二三123])?(?:\s*[:：-].*)?$/i;
const TRADING_PLAN_HEADING = /^[A-Z0-9]{2,20}\/(?:USDT|USDC|BUSD)\s+币安永续\s+\d+(?:M|H|D|W)$/i;
const OPTION_LINE = /^(?:(?:方案|候选|选项|路径)\s*(?:[A-C]|[一二三四五六]|\d+)|[A-C]\s*方案|[A-C])\s*[:：、.)-]/i;
const ORDERED_OR_BULLET_LINE = /^(?:[-*+•▪◦]\s+|(?:\d+|[A-C一二三四五六])[.)、]\s*)/i;

function cleanExecutionPlanDisplayText(value: unknown) {
  let text = String(value || "");
  for (let depth = 0; depth < 6; depth += 1) {
    const next = text.replace(/（[^（）]*）|\([^()]*\)/g, "");
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/[（）()]/g, "")
    .replace(/候选/g, "")
    .replace(/测算/g, "推荐")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；、])/g, "$1")
    .trim();
}

export function executionPlanDirectionTone(label: unknown, text: unknown): ExecutionPlanDirectionTone {
  if (!String(label || "").includes("方向判断")) return "";
  const direction = String(text || "");
  if (direction.includes("空")) return "bearish";
  if (direction.includes("多")) return "bullish";
  return "";
}

export function executionPlanSignedNumberSegments(value: unknown): ExecutionPlanSignedNumberSegment[] {
  const text = String(value || "");
  const pattern = /[+＋\-−－]\s*\d+(?:,\d{3})*(?:\.\d+)?/g;
  const segments: ExecutionPlanSignedNumberSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const matchedText = match[0];
    if (start > 0 && /[\d.]/.test(text[start - 1] || "")) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), tone: "" });
    segments.push({
      text: matchedText,
      tone: /^[+＋]/.test(matchedText) ? "bullish" : "bearish",
    });
    cursor = start + matchedText.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), tone: "" });
  return segments.length ? segments : [{ text, tone: "" }];
}

export function executionPlanCardTitle(input: {
  fallbackTitle?: unknown;
  analysisLabel?: unknown;
  sourceTitle?: unknown;
  sourceText?: unknown;
}) {
  const sources = [input.analysisLabel, input.sourceTitle, input.sourceText]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const combined = sources.join("\n").toUpperCase();
  let baseAsset = "";
  let quoteAsset = "USDT";
  let interval = "";

  const marketIdMatch = combined.match(/BINANCE:FUTURES:([A-Z0-9]+?)(USDT|USDC|BUSD)\b/);
  const slashMatch = combined.match(/\b([A-Z0-9]{2,20})\/(USDT|USDC|BUSD)\b/);
  if (marketIdMatch) {
    baseAsset = marketIdMatch[1];
    quoteAsset = marketIdMatch[2];
  } else if (slashMatch) {
    baseAsset = slashMatch[1];
    quoteAsset = slashMatch[2];
  }

  for (const source of sources) {
    const compactMatch = source.toUpperCase().match(/(?:^|[^A-Z0-9])([A-Z0-9]{2,20}?)(\d+)([MHDW])(?:[^A-Z0-9]|$)/);
    if (!compactMatch || !/[A-Z]/.test(compactMatch[1])) continue;
    const compactBase = compactMatch[1];
    const compactQuoteMatch = compactBase.match(/^(.*?)(USDT|USDC|BUSD)$/);
    if (!baseAsset) baseAsset = compactQuoteMatch?.[1] || compactBase;
    if (compactQuoteMatch) quoteAsset = compactQuoteMatch[2];
    interval = `${Number(compactMatch[2])}${compactMatch[3]}`;
    break;
  }

  if (!interval) {
    const chineseInterval = combined.match(/(?:^|[^0-9])(\d+)\s*(分钟|小时|日|天|周)/u);
    const standardInterval = combined.match(/(?:^|[^A-Z0-9])(\d+)\s*([MHDW])(?:[^A-Z0-9]|$)/);
    if (chineseInterval) {
      const unit = chineseInterval[2] === "分钟"
        ? "M"
        : chineseInterval[2] === "小时"
          ? "H"
          : chineseInterval[2] === "周"
            ? "W"
            : "D";
      interval = `${Number(chineseInterval[1])}${unit}`;
    } else if (standardInterval) {
      interval = `${Number(standardInterval[1])}${standardInterval[2]}`;
    }
  }

  if (baseAsset && interval) return `${baseAsset}/${quoteAsset} 币安永续 ${interval}`;
  return cleanExecutionPlanDisplayText(input.fallbackTitle).slice(0, 120) || "执行计划";
}

export function executionPlanDisplayLines(value: unknown): ExecutionPlanDisplayLine[] {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((rawLine) => rawLine
      .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, "")
      .replace(/^\s*(?:[-*+•▪◦]\s+|(?:\d+|[A-C一二三四五六])[.)、]\s*)/i, "")
      .replace(/[*_`~]/g, ""))
    .map(cleanExecutionPlanDisplayText)
    .filter(Boolean)
    .map((line) => {
      const labelMatch = line.match(/^(.{1,32}?)([：:])\s*(.*)$/u);
      if (!labelMatch) return { label: "", text: line };
      return {
        label: `${labelMatch[1].trim()}${labelMatch[2]}`,
        text: labelMatch[3].trim(),
      };
    });
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function storageKey(scope: string) {
  const normalizedScope = scope.trim() || "anonymous";
  return `${EXECUTION_PLAN_STORAGE_PREFIX}:${encodeURIComponent(normalizedScope).slice(0, 320)}`;
}

function searchableLine(line: string) {
  return line
    .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, "")
    .replace(/^\s*(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

function isExecutionPlanHeading(value: string) {
  return PLAN_HEADING.test(value) || TRADING_PLAN_HEADING.test(value);
}

function planHeading(lines: string[], startIndex: number) {
  for (let index = startIndex; index >= Math.max(0, startIndex - 3); index -= 1) {
    const line = searchableLine(lines[index] || "");
    if (!line) continue;
    if (isExecutionPlanHeading(line)) return line.replace(/[：:]\s*$/, "").slice(0, 120);
  }
  return "执行计划";
}

function planBlock(lines: string[], startIndex: number, endIndex: number): ExecutionPlanCandidate | null {
  const content = lines.slice(startIndex, endIndex + 1).join("\n").trim().slice(0, MAX_PLAN_CONTENT_LENGTH);
  if (content.length < 32) return null;
  return {
    title: planHeading(lines, startIndex - 1),
    content,
  };
}

function explicitHeadingCandidate(lines: string[]) {
  for (let headingIndex = 0; headingIndex < lines.length; headingIndex += 1) {
    const heading = searchableLine(lines[headingIndex] || "");
    if (!isExecutionPlanHeading(heading)) continue;
    let endIndex = headingIndex;
    let structuredLineCount = 0;
    let coreLabelCount = 0;
    for (let index = headingIndex + 1; index < Math.min(lines.length, headingIndex + 42); index += 1) {
      const raw = lines[index] || "";
      const searchable = searchableLine(raw);
      if (index > headingIndex + 1 && (/^\s*#{1,6}\s+/.test(raw) || /^\s*(?:---+|___+)\s*$/.test(raw))) break;
      if (ORDERED_OR_BULLET_LINE.test(raw.trim())) structuredLineCount += 1;
      if (CORE_PLAN_LABEL.test(searchable)) coreLabelCount += 1;
      if (searchable) endIndex = index;
      if (/风险收益比/.test(searchable) && coreLabelCount >= 3) break;
    }
    if (structuredLineCount < 2 && coreLabelCount < 2) continue;
    const candidate = planBlock(lines, headingIndex + 1, endIndex);
    if (candidate) return { ...candidate, title: heading.slice(0, 120) };
  }
  return null;
}

function boundedCorePlanCandidate(lines: string[]) {
  for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
    if (!CORE_PLAN_LABEL.test(searchableLine(lines[startIndex] || ""))) continue;
    let coreLabelCount = 0;
    let endIndex = startIndex;
    for (let index = startIndex; index < Math.min(lines.length, startIndex + 36); index += 1) {
      const raw = lines[index] || "";
      if (index > startIndex && (/^\s*#{1,6}\s+/.test(raw) || /^\s*(?:---+|___+)\s*$/.test(raw))) break;
      const searchable = searchableLine(raw);
      if (!CORE_PLAN_LABEL.test(searchable)) continue;
      coreLabelCount += 1;
      endIndex = index;
      if (/风险收益比/.test(searchable) && coreLabelCount >= 3) break;
    }
    if (coreLabelCount >= 3) return planBlock(lines, startIndex, endIndex);
  }
  return null;
}

export function executionPlanCandidateFromText(value: unknown): ExecutionPlanCandidate | null {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const lines = text.split("\n");
  const headingCandidate = explicitHeadingCandidate(lines);
  if (headingCandidate) return headingCandidate;

  const coreCandidate = boundedCorePlanCandidate(lines);
  if (coreCandidate) return coreCandidate;

  const optionIndexes = lines
    .map((line, index) => (OPTION_LINE.test(searchableLine(line)) ? index : -1))
    .filter((index) => index >= 0);
  if (optionIndexes.length < 2) return null;
  return planBlock(lines, optionIndexes[0], optionIndexes[optionIndexes.length - 1]);
}

export function executionPlanTextPartition(value: unknown): ExecutionPlanTextPartition | null {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  const candidate = executionPlanCandidateFromText(text);
  if (!candidate) return null;
  const contentIndex = text.indexOf(candidate.content);
  if (contentIndex < 0) return null;
  let before = text.slice(0, contentIndex);
  const beforeLines = before.split("\n");
  let headingIndex = beforeLines.length - 1;
  while (headingIndex >= 0 && !searchableLine(beforeLines[headingIndex] || "")) headingIndex -= 1;
  if (headingIndex >= 0 && isExecutionPlanHeading(searchableLine(beforeLines[headingIndex] || ""))) {
    before = beforeLines.slice(0, headingIndex).join("\n");
  }
  return {
    before: before.trim(),
    candidate,
    after: text.slice(contentIndex + candidate.content.length).trim(),
  };
}

function savedExecutionPlanFromUnknown(value: unknown): SavedExecutionPlan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SavedExecutionPlan>;
  const title = String(record.title || "").trim().slice(0, 120);
  const content = String(record.content || "").trim().slice(0, MAX_PLAN_CONTENT_LENGTH);
  const narrowedCandidate = executionPlanCandidateFromText(content);
  const sourceTitle = String(record.sourceTitle || "").trim().slice(0, 200);
  const sourceThreadId = String(record.sourceThreadId || "").trim();
  const sourceMessageId = String(record.sourceMessageId || "").trim();
  const id = String(record.id || "").trim();
  const createdAt = String(record.createdAt || "").trim();
  const status = EXECUTION_PLAN_STATUSES.has(record.status as ExecutionPlanStatus)
    ? record.status as ExecutionPlanStatus
    : "pending";
  const endReason = status === "ended" && EXECUTION_PLAN_END_REASONS.has(record.endReason as ExecutionPlanEndReason)
    ? record.endReason as ExecutionPlanEndReason
    : null;
  const statusUpdatedAt = String(record.statusUpdatedAt || createdAt).trim() || createdAt;
  const linkedAlertId = String(record.linkedAlertId || "").trim().slice(0, 160) || null;
  if (!id || !content || !sourceThreadId || !sourceMessageId || !createdAt) return null;
  return {
    schemaVersion: 2,
    id,
    title: executionPlanCardTitle({
      fallbackTitle: title || narrowedCandidate?.title,
      sourceTitle,
      sourceText: content,
    }),
    content: narrowedCandidate?.content || content,
    sourceThreadId,
    sourceMessageId,
    sourceTitle,
    createdAt,
    status,
    endReason,
    statusUpdatedAt,
    linkedAlertId,
  };
}

export function loadExecutionPlans(scope: string, storage: StorageLike | null = defaultStorage()) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(scope)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(savedExecutionPlanFromUnknown)
      .filter((plan): plan is SavedExecutionPlan => Boolean(plan))
      .slice(0, MAX_SAVED_EXECUTION_PLANS);
  } catch {
    return [];
  }
}

export function saveExecutionPlans(
  scope: string,
  plans: SavedExecutionPlan[],
  storage: StorageLike | null = defaultStorage(),
) {
  if (!storage) return false;
  try {
    storage.setItem(storageKey(scope), JSON.stringify(plans.slice(0, MAX_SAVED_EXECUTION_PLANS)));
    return true;
  } catch {
    return false;
  }
}

export function createSavedExecutionPlan(input: {
  candidate: ExecutionPlanCandidate;
  sourceThreadId: string;
  sourceMessageId: string;
  sourceTitle?: string | null;
  analysisLabel?: string | null;
  createdAt?: string;
}): SavedExecutionPlan {
  const createdAt = input.createdAt || new Date().toISOString();
  return {
    schemaVersion: 2,
    id: `execution-plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    title: executionPlanCardTitle({
      fallbackTitle: input.candidate.title,
      analysisLabel: input.analysisLabel,
      sourceTitle: input.sourceTitle,
      sourceText: input.candidate.content,
    }),
    content: input.candidate.content,
    sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId,
    sourceTitle: String(input.sourceTitle || "").trim().slice(0, 200),
    createdAt,
    status: "pending",
    endReason: null,
    statusUpdatedAt: createdAt,
    linkedAlertId: null,
  };
}

export function transitionExecutionPlan(
  plan: SavedExecutionPlan,
  status: ExecutionPlanStatus,
  options: { endReason?: ExecutionPlanEndReason | null; updatedAt?: string } = {},
): SavedExecutionPlan {
  const statusUpdatedAt = String(options.updatedAt || new Date().toISOString()).trim();
  return {
    ...plan,
    schemaVersion: 2,
    status,
    endReason: status === "ended" && options.endReason && EXECUTION_PLAN_END_REASONS.has(options.endReason)
      ? options.endReason
      : null,
    statusUpdatedAt: statusUpdatedAt || plan.statusUpdatedAt || plan.createdAt,
  };
}
