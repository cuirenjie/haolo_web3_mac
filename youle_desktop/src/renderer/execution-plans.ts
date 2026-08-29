export type ExecutionPlanCandidate = {
  title: string;
  content: string;
};

export type ExecutionPlanTextPartition = {
  before: string;
  candidate: ExecutionPlanCandidate;
  after: string;
};

export type ExecutionPlanTextPartitions = {
  before: string;
  candidates: ExecutionPlanCandidate[];
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
export type ExecutionPlanTradeDirection = "LONG" | "SHORT";

export type ExecutionPlanBinanceTracking = {
  positionObserved: boolean;
  missingPolls: number;
  lastPositionAt: string | null;
  lastPositionAmount: number | null;
  lastEntryPrice: number | null;
  lastMarkPrice: number | null;
  lastUnrealizedPnl: number | null;
};

export type SavedExecutionPlan = ExecutionPlanCandidate & {
  schemaVersion: 2;
  id: string;
  sourceThreadId: string;
  sourceMessageId: string;
  sourcePlanKey?: string;
  sourceTitle: string;
  createdAt: string;
  status: ExecutionPlanStatus;
  endReason: ExecutionPlanEndReason | null;
  statusUpdatedAt: string;
  linkedAlertId: string | null;
  binanceTracking: ExecutionPlanBinanceTracking;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const EXECUTION_PLAN_STORAGE_PREFIX = "haolo.execution-plans.v1";
const MESSAGE_EXECUTION_PLAN_FONT_STORAGE_PREFIX = "haolo.message-execution-plan-font.v1";
const MAX_SAVED_EXECUTION_PLANS = 100;
const MAX_PLAN_CONTENT_LENGTH = 20_000;
const EXECUTION_PLAN_STATUSES = new Set<ExecutionPlanStatus>(["pending", "executing", "ended"]);
const EXECUTION_PLAN_END_REASONS = new Set<ExecutionPlanEndReason>(["take_profit", "stop_loss", "cancelled", "expired"]);

const CORE_PLAN_LABEL = /(?:当前动作|方向判断|(?:多头|空头|首选方向)?触发|止损(?:与失效)?|分批止盈|风险收益比|候选(?:测算|止损|止盈)|current action|direction|(?:long|short|entry) trigger|stop-loss(?: and invalidation)?|take-profit targets?|risk\/reward)/i;
const PLAN_HEADING = /^(?:(?:标准|推荐|首选|备选|候选|可选)\s*)?(?:(?:执行|行动|实施|操作|落地)\s*)?(?:方案|计划)(?:\s*[A-C一二三123])?(?:\s*[:：-].*)?$|^(?:(?:standard|recommended|preferred|alternative|candidate)\s+)?(?:execution\s+)?plan(?:\s*[A-C123])?(?:\s*[:\-].*)?$/i;
const TRADING_PLAN_HEADING = /^[A-Z0-9]{2,20}\/(?:USDT|USDC|BUSD)\s+(?:币安永续|BINANCE PERPETUAL)\s+\d+(?:M|H|D|W)(?:\s+·\s+(?:(?:多头|空头)条件方案|(?:LONG|SHORT) SETUP))?$/i;
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

function normalizedBinanceSymbol(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizedTradeDirection(value: unknown): ExecutionPlanTradeDirection | null {
  const text = String(value || "");
  if (/(?:偏|看)?空|空头|bearish|short/i.test(text)) return "SHORT";
  if (/(?:偏|看)?多|多头|bullish|long/i.test(text)) return "LONG";
  return null;
}

/**
 * Extracts the Binance USDⓈ-M symbol and intended direction from a saved plan.
 * The title is preferred for the market because it is normalized when a plan
 * is created; content remains a fallback for legacy plans.
 */
export function executionPlanBinanceMarketDetails(input: {
  title?: unknown;
  content?: unknown;
  sourceTitle?: unknown;
  sourceText?: unknown;
}): { symbol: string | null; direction: ExecutionPlanTradeDirection | null } {
  const title = String(input.title || "").trim().toUpperCase();
  const sources = [title, input.content, input.sourceTitle, input.sourceText]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  const combined = sources.join("\n");
  const marketIdMatch = combined.match(/BINANCE\s*:\s*FUTURES\s*:\s*([A-Z0-9]{2,30})\b/);
  const slashMatch = combined.match(/\b([A-Z0-9]{2,20})\s*\/\s*(USDT|USDC|BUSD)\b/);
  const compactMatch = combined.match(/\b([A-Z0-9]{2,24})(?:(?:\s+币安)?(?:永续|合约)|\s+BINANCE\s+PERPETUAL)\b/);
  const symbol = normalizedBinanceSymbol(
    marketIdMatch?.[1]
      || (slashMatch ? `${slashMatch[1]}${slashMatch[2]}` : "")
      || compactMatch?.[1],
  );
  const directionLine = String(input.content || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/, "").trim())
    .find((line) => /^(?:方向判断|direction)\s*[：:]/iu.test(line));
  const direction = normalizedTradeDirection(directionLine || combined);
  return {
    symbol: symbol && /(?:USDT|USDC|BUSD)$/.test(symbol) ? symbol : null,
    direction,
  };
}

function defaultBinanceTracking(): ExecutionPlanBinanceTracking {
  return {
    positionObserved: false,
    missingPolls: 0,
    lastPositionAt: null,
    lastPositionAmount: null,
    lastEntryPrice: null,
    lastMarkPrice: null,
    lastUnrealizedPnl: null,
  };
}

function normalizedBinanceTracking(value: unknown): ExecutionPlanBinanceTracking {
  const record = value && typeof value === "object" ? value as Partial<ExecutionPlanBinanceTracking> : {};
  const numberOrNull = (candidate: unknown) => {
    if (candidate == null || candidate === "") return null;
    const number = Number(candidate);
    return Number.isFinite(number) ? number : null;
  };
  return {
    positionObserved: record.positionObserved === true,
    missingPolls: Math.max(0, Math.trunc(Number(record.missingPolls) || 0)),
    lastPositionAt: String(record.lastPositionAt || "").trim() || null,
    lastPositionAmount: numberOrNull(record.lastPositionAmount),
    lastEntryPrice: numberOrNull(record.lastEntryPrice),
    lastMarkPrice: numberOrNull(record.lastMarkPrice),
    lastUnrealizedPnl: numberOrNull(record.lastUnrealizedPnl),
  };
}

export function executionPlanDirectionTone(label: unknown, text: unknown): ExecutionPlanDirectionTone {
  if (!/(?:方向判断|direction)/iu.test(String(label || ""))) return "";
  const direction = String(text || "");
  if (/空|bearish|short/iu.test(direction)) return "bearish";
  if (/多|bullish|long/iu.test(direction)) return "bullish";
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
  language?: unknown;
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

  const english = input.language === "en";
  const cleanedFallbackTitle = cleanExecutionPlanDisplayText(input.fallbackTitle).slice(0, 120);
  const safeFallbackTitle = english && /[\u3400-\u9fff]/u.test(cleanedFallbackTitle)
    ? "Execution plan"
    : cleanedFallbackTitle;
  const baseTitle = baseAsset && interval
    ? `${baseAsset}/${quoteAsset} ${english ? "Binance Perpetual" : "币安永续"} ${interval}`
    : safeFallbackTitle || (english ? "Execution plan" : "执行计划");
  const fallback = String(input.fallbackTitle || "");
  const sideSuffix = fallback.match(/(?:·|-)\s*(多头|空头)条件方案/u)?.[1]
    || fallback.match(/(?:·|-)\s*(LONG|SHORT) SETUP/iu)?.[1]?.toLowerCase();
  const localizedSideSuffix = sideSuffix
    ? english
      ? `${sideSuffix === "多头" || sideSuffix === "long" ? "Long" : "Short"} setup`
      : `${sideSuffix === "多头" || sideSuffix === "long" ? "多头" : "空头"}条件方案`
    : "";
  if (localizedSideSuffix && !baseTitle.toLowerCase().includes(localizedSideSuffix.toLowerCase())) {
    return `${baseTitle} · ${localizedSideSuffix}`;
  }
  return baseTitle;
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

/**
 * A trading analysis can contain the six familiar labels while still being a
 * non-plan placeholder (for example, a neutral direction with every price
 * marked as "未形成"). Keep the generic step-plan parser permissive, but only
 * expose the Add to Plan action when a trading candidate has a concrete
 * direction, trigger, stop and take-profit price.
 */
export function executionPlanHasConcreteTradingPlan(candidate: ExecutionPlanCandidate | null | undefined) {
  if (!candidate) return false;
  const lines = executionPlanDisplayLines(candidate.content);
  const tradingLabels = lines.filter((line) => /方向判断|触发|止损|止盈|风险收益比|direction|trigger|stop-loss|take-profit|risk\/reward/iu.test(line.label));
  // A market-context heading can be present in an ordinary educational
  // answer (for example, “BTC/USDT 币安永续 4H”).  Do not treat that heading
  // plus prose mentioning stop-loss/take-profit as an actionable plan; a real
  // trading plan must contain at least one of its structured trading fields.
  const candidateTitle = String(candidate.title || "").trim();
  const educationalLabels = lines.some((line) => /交易基础|趋势与结构|支撑与阻力|风险管理|策略执行/u.test(line.label));
  if (
    !tradingLabels.length
    && (
      candidateTitle === "执行计划"
      || TRADING_PLAN_HEADING.test(candidateTitle)
      || educationalLabels
    )
  ) {
    return false;
  }
  if (!tradingLabels.length) return true;
  const direction = lines.find((line) => /方向判断|direction/iu.test(line.label))?.text || "";
  if (
    !/(?:多|空|bullish|bearish|long|short)/iu.test(direction)
    || /中性|未形成|未明确|观望|等待|neutral|not available|unclear|wait/iu.test(direction)
  ) return false;
  const hasConcretePrice = (pattern: RegExp) => lines.some((line) => (
    pattern.test(line.label)
    && !/未形成|未明确|待定|暂无|无|not available|unclear|pending|none/iu.test(line.text)
    && /(?:^|[^\d])\d+(?:,\d{3})*(?:\.\d+)?/u.test(line.text)
  ));
  return hasConcretePrice(/触发|trigger/iu)
    && hasConcretePrice(/止损|stop-loss/iu)
    && hasConcretePrice(/止盈|take-profit/iu);
}

/**
 * Return whether a candidate has the structured fields that identify a
 * trading proposal, independent of whether its values are actionable yet.
 *
 * This is deliberately separate from `executionPlanHasConcreteTradingPlan`:
 * the latter remains permissive for legacy generic plan parsing, while the
 * renderer must not turn arbitrary prose (or a generic project checklist)
 * into a collapsible trading card merely because it contains words such as
 * “止损” or “策略”.
 */
export function executionPlanHasStructuredTradingFields(candidate: ExecutionPlanCandidate | null | undefined) {
  if (!candidate) return false;
  const lines = executionPlanDisplayLines(candidate.content);
  const hasDirection = lines.some((line) => /方向判断|direction/iu.test(line.label));
  const hasTrigger = lines.some((line) => /触发|trigger/iu.test(line.label));
  const hasStop = lines.some((line) => /止损|stop-loss/iu.test(line.label));
  const hasTakeProfit = lines.some((line) => /止盈|take-profit/iu.test(line.label));
  return hasDirection && hasTrigger && hasStop && hasTakeProfit;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const MESSAGE_EXECUTION_PLAN_FONT_SIZES = Object.freeze([11, 12, 13, 14, 16, 18, 20]);

export function normalizeMessageExecutionPlanFontSize(value: unknown) {
  if (value == null || String(value).trim() === "") return 12;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 12;
  return MESSAGE_EXECUTION_PLAN_FONT_SIZES.reduce((nearest, candidate) => (
    Math.abs(candidate - numeric) < Math.abs(nearest - numeric) ? candidate : nearest
  ), MESSAGE_EXECUTION_PLAN_FONT_SIZES[0]);
}

function messageExecutionPlanFontStorageKey(key: string) {
  return `${MESSAGE_EXECUTION_PLAN_FONT_STORAGE_PREFIX}:${encodeURIComponent(String(key || "")).slice(0, 640)}`;
}

export function loadMessageExecutionPlanFontSize(key: string, storage: StorageLike | null = defaultStorage()) {
  if (!storage) return 12;
  try {
    return normalizeMessageExecutionPlanFontSize(storage.getItem(messageExecutionPlanFontStorageKey(key)));
  } catch {
    return 12;
  }
}

export function saveMessageExecutionPlanFontSize(
  key: string,
  value: unknown,
  storage: StorageLike | null = defaultStorage(),
) {
  const fontSize = normalizeMessageExecutionPlanFontSize(value);
  if (!storage) return fontSize;
  try {
    storage.setItem(messageExecutionPlanFontStorageKey(key), String(fontSize));
  } catch {
    // The visible size can still update when browser storage is unavailable.
  }
  return fontSize;
}

export function stepMessageExecutionPlanFontSize(value: unknown, delta: number) {
  const current = normalizeMessageExecutionPlanFontSize(value);
  const index = MESSAGE_EXECUTION_PLAN_FONT_SIZES.indexOf(current);
  const nextIndex = Math.max(0, Math.min(
    MESSAGE_EXECUTION_PLAN_FONT_SIZES.length - 1,
    index + Math.sign(Number(delta) || 0),
  ));
  return MESSAGE_EXECUTION_PLAN_FONT_SIZES[nextIndex];
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

function explicitHeadingCandidates(lines: string[]) {
  const candidates = [];
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
      if (/风险收益比|risk\/reward/i.test(searchable) && coreLabelCount >= 3) break;
    }
    if (structuredLineCount < 2 && coreLabelCount < 2) continue;
    const candidate = planBlock(lines, headingIndex + 1, endIndex);
    if (candidate) candidates.push({
      ...candidate,
      title: heading.slice(0, 120),
      headingIndex,
      endIndex,
    });
  }
  return candidates;
}

function explicitHeadingCandidate(lines: string[]) {
  return explicitHeadingCandidates(lines)[0] || null;
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
      if (/风险收益比|risk\/reward/i.test(searchable) && coreLabelCount >= 3) break;
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

export function executionPlanCandidatesFromText(value: unknown): ExecutionPlanCandidate[] {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const explicitCandidates = explicitHeadingCandidates(lines);
  if (explicitCandidates.length) return explicitCandidates.map(({ headingIndex, endIndex, ...candidate }) => candidate);
  const candidate = executionPlanCandidateFromText(text);
  return candidate ? [candidate] : [];
}

export function executionPlanTextPartitions(value: unknown): ExecutionPlanTextPartitions | null {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const lines = text.split("\n");
  const explicitCandidates = explicitHeadingCandidates(lines);
  if (!explicitCandidates.length) {
    const candidate = executionPlanCandidateFromText(text);
    return candidate ? { before: "", candidates: [candidate], after: "" } : null;
  }
  const first = explicitCandidates[0];
  const last = explicitCandidates[explicitCandidates.length - 1];
  if (!first || !last) return null;
  const candidates = explicitCandidates.map(({ headingIndex, endIndex, ...candidate }) => candidate);
  return {
    before: lines.slice(0, first.headingIndex).join("\n").trim(),
    candidates,
    after: lines.slice(last.endIndex + 1).join("\n").trim(),
  };
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
  const sourcePlanKey = String(record.sourcePlanKey || "").trim().slice(0, 120);
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
    ...(sourcePlanKey ? { sourcePlanKey } : {}),
    sourceTitle,
    createdAt,
    status,
    endReason,
    statusUpdatedAt,
    linkedAlertId,
    binanceTracking: normalizedBinanceTracking(record.binanceTracking),
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
  sourcePlanKey?: string | null;
  sourceTitle?: string | null;
  analysisLabel?: string | null;
  language?: unknown;
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
      language: input.language,
    }),
    content: input.candidate.content,
    sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId,
    ...(String(input.sourcePlanKey || "").trim() ? { sourcePlanKey: String(input.sourcePlanKey).trim().slice(0, 120) } : {}),
    sourceTitle: String(input.sourceTitle || "").trim().slice(0, 200),
    createdAt,
    status: "pending",
    endReason: null,
    statusUpdatedAt: createdAt,
    linkedAlertId: null,
    binanceTracking: defaultBinanceTracking(),
  };
}

export function transitionExecutionPlan(
  plan: SavedExecutionPlan,
  status: ExecutionPlanStatus,
  options: {
    endReason?: ExecutionPlanEndReason | null;
    updatedAt?: string;
    binanceTracking?: Partial<ExecutionPlanBinanceTracking> | null;
  } = {},
): SavedExecutionPlan {
  const statusUpdatedAt = String(options.updatedAt || new Date().toISOString()).trim();
  const tracking = options.binanceTracking == null
    ? plan.binanceTracking
    : normalizedBinanceTracking({ ...plan.binanceTracking, ...options.binanceTracking });
  return {
    ...plan,
    schemaVersion: 2,
    status,
    endReason: status === "ended" && options.endReason && EXECUTION_PLAN_END_REASONS.has(options.endReason)
      ? options.endReason
      : null,
    statusUpdatedAt: statusUpdatedAt || plan.statusUpdatedAt || plan.createdAt,
    binanceTracking: tracking,
  };
}
