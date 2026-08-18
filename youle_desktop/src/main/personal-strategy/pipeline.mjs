import { normalizeStrategyUnderstanding } from "./understanding.mjs";

export const PERSONAL_STRATEGY_ATTACHMENT_BATCH_SIZE = 3;
export const PERSONAL_STRATEGY_MAX_RETRIES = 2;

const NETWORK_FAILURE_CODES = new Set([
  "STREAM_DISCONNECTED",
  "RESPONSE_STREAM_DISCONNECTED",
  "NETWORK_ERROR",
  "FETCH_FAILED",
  "ECONNRESET",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
]);
const NETWORK_FAILURE_PATTERN = /(?:econn(?:reset|aborted|refused)|enotfound|enetunreach|etimedout|connection\s+(?:reset|refused|closed|lost)|network\s+(?:error|failure|unreachable)|socket\s+(?:hang\s*up|closed)|broken\s+pipe|unexpected\s+eof|websocket.{0,32}(?:closed|disconnect)|stream\s+(?:closed|disconnected)|responseStreamDisconnected|fetch\s+failed|代理连接|(?:网络|连接|流式响应).{0,24}(?:中断|断开|失败|不可用))/iu;
const TIMEOUT_PATTERN = /(?:timed?\s*out|timeout|deadline\s+exceeded|超时)/iu;

export function chunkPersonalStrategyAttachments(values, size = PERSONAL_STRATEGY_ATTACHMENT_BATCH_SIZE) {
  const attachments = Array.isArray(values) ? values.filter(Boolean) : [];
  const batchSize = Math.max(1, Math.floor(Number(size) || PERSONAL_STRATEGY_ATTACHMENT_BATCH_SIZE));
  const batches = [];
  for (let index = 0; index < attachments.length; index += batchSize) {
    batches.push(attachments.slice(index, index + batchSize));
  }
  return batches;
}

export function personalStrategyRetryDelayMs(attempt) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(4_000, 600 * (2 ** (normalizedAttempt - 1)));
}

export function classifyPersonalStrategyFailure(error, phase = "model") {
  const code = String(error?.code || error?.error?.code || "").trim().toUpperCase();
  const text = String(error?.message || error?.error?.message || error || "").trim();
  if (code === "STRATEGY_NAME_CONFLICT") {
    return {
      code,
      kind: "strategy_name_conflict",
      phase: "compiler",
      retryable: false,
      userMessage: text || "已有同名策略，请从“我的策略”进入优化，或为新策略换一个名称。",
      detail: text,
    };
  }
  if (code === "STRATEGY_NOT_FOUND" || code === "STRATEGY_DRAFT_NOT_FOUND") {
    return {
      code,
      kind: "strategy_not_found",
      phase: "compiler",
      retryable: false,
      userMessage: "找不到正在编辑的策略草稿，可能是会话状态过期。请刷新策略列表后重新编辑。",
      detail: text,
    };
  }
  if (code === "PERSONAL_STRATEGY_FEEDBACK_BRIDGE_UNAVAILABLE" || code === "PERSONAL_STRATEGY_CREATE_BRIDGE_UNAVAILABLE") {
    return {
      code,
      kind: "client_bridge_unavailable",
      phase: "compiler",
      retryable: false,
      userMessage: text || "当前客户端缺少策略编辑桥，请重启开发版后重试。",
      detail: text,
    };
  }
  if (code === "PERSONAL_STRATEGY_ATTACHMENT_READ_TIMEOUT" || code === "ATTACHMENT_READ_TIMEOUT") {
    return {
      code: "PERSONAL_STRATEGY_ATTACHMENT_READ_TIMEOUT",
      kind: "attachment_read_timeout",
      phase: "attachments",
      retryable: true,
      userMessage: "附件读取超时：资料还没有完整读入。请减少附件数量、拆分文件后重试。",
      detail: text,
    };
  }
  if (code === "PROVIDER_FIRST_BYTE_TIMEOUT") {
    return {
      code,
      kind: "model_timeout",
      phase: "model",
      retryable: true,
      userMessage: "模型首响应超时：资料已经提交，但智能体迟迟没有开始返回理解结果。",
      detail: text,
    };
  }
  if (code === "PROVIDER_STREAM_INACTIVITY_TIMEOUT") {
    return {
      code,
      kind: "model_timeout",
      phase: "model",
      retryable: true,
      userMessage: "模型生成中断超时：智能体已经开始理解，但返回过程长时间没有新进展。",
      detail: text,
    };
  }
  if (code === "PERSONAL_STRATEGY_MODEL_TIMEOUT" || (phase === "model" && TIMEOUT_PATTERN.test(text) && !NETWORK_FAILURE_PATTERN.test(text))) {
    return {
      code: "PERSONAL_STRATEGY_MODEL_TIMEOUT",
      kind: "model_timeout",
      phase: "model",
      retryable: true,
      userMessage: "模型理解超时：智能体没有在规定时间内完成策略理解。可重试，或减少附件数量。",
      detail: text,
    };
  }
  if (code === "PERSONAL_STRATEGY_NETWORK_DISCONNECTED" || NETWORK_FAILURE_CODES.has(code) || NETWORK_FAILURE_PATTERN.test(text)) {
    return {
      code: "PERSONAL_STRATEGY_NETWORK_DISCONNECTED",
      kind: "network_disconnected",
      phase,
      retryable: true,
      userMessage: "网络连接中断：模型通道没有完成本次请求。请检查网络或代理后重试。",
      detail: text,
    };
  }
  if (code === "PERSONAL_STRATEGY_MODEL_RESPONSE_INVALID") {
    return {
      code,
      kind: "model_response_invalid",
      phase: "model",
      retryable: true,
      userMessage: "模型理解结果不可校验：智能体没有返回完整的结构化策略。正在允许重试。",
      detail: text,
    };
  }
  if (phase === "compiler") {
    return {
      code: code || "PERSONAL_STRATEGY_RULE_COMPILER_FAILED",
      kind: "rule_compiler_failed",
      phase: "compiler",
      retryable: false,
      userMessage: text
        ? `本地规则编译失败：${text}`
        : "本地规则编译失败：智能体理解结果还不够明确，策略没有写入。请补充或修正条件。",
      detail: text,
    };
  }
  return {
    code: code || (phase === "attachments" ? "PERSONAL_STRATEGY_ATTACHMENT_READ_FAILED" : "PERSONAL_STRATEGY_MODEL_FAILED"),
    kind: phase === "attachments" ? "attachment_read_failed" : "model_failed",
    phase,
    retryable: phase === "model",
    userMessage: phase === "attachments"
      ? "附件读取失败：暂时无法提取资料内容。请检查文件是否可读后重试。"
      : "模型理解失败：智能体没有完成策略资料分析。请重试或补充关键条件。",
    detail: text,
  };
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function uniqueStrings(values, max = 48) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, max);
}

function uniqueObjects(values, max = 48) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== "object") continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

export function mergePersonalStrategyUnderstandings(values, { rawText = "" } = {}) {
  const parts = (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === "object")
    .map((value) => normalizeStrategyUnderstanding(value));
  if (!parts.length) return normalizeStrategyUnderstanding({}, { rawText });
  const directions = uniqueStrings(parts.map((part) => part.direction).filter((value) => value && value !== "unknown"));
  const direction = directions.length === 1 ? directions[0] : directions.length > 1 ? "both" : "unknown";
  const confidence = parts.reduce((sum, part) => sum + (Number(part.confidence) || 0), 0) / parts.length;
  const merged = {
    ...parts[0],
    name: firstNonEmpty(parts.map((part) => part.name)),
    summary: uniqueStrings(parts.map((part) => part.summary), 8).join("；"),
    direction,
    timeframes: uniqueStrings(parts.flatMap((part) => part.timeframes)),
    marketScope: uniqueStrings(parts.flatMap((part) => part.marketScope)),
    entryRules: uniqueObjects(parts.flatMap((part) => part.entryRules)),
    exitRules: uniqueObjects(parts.flatMap((part) => part.exitRules)),
    risk: Object.assign({}, ...parts.map((part) => part.risk || {})),
    exceptions: uniqueStrings(parts.flatMap((part) => part.exceptions)),
    evidence: uniqueObjects(parts.flatMap((part) => part.evidence)),
    uncertainties: uniqueStrings(parts.flatMap((part) => part.uncertainties)),
    questions: uniqueStrings(parts.flatMap((part) => part.questions)),
    confidence: Math.max(0, Math.min(1, confidence)),
    compilerText: firstNonEmpty(parts.map((part) => part.compilerText)),
    rawText: String(rawText || parts.map((part) => part.rawText).filter(Boolean).join("\n\n")).slice(0, 40_000),
  };
  return normalizeStrategyUnderstanding(merged, { rawText: merged.rawText });
}
