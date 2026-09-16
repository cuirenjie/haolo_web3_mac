// HAOLO-TURN-DIAGNOSTICS-MODULE
// This file is an isolated, removable feature boundary. See docs/turn-diagnostics-removal.md.
import crypto from "node:crypto";
import { isModelOverloadFailure } from "./analysis-model-recovery.mjs";
import { modelFailureFacts } from "./model-failure-policy.mjs";
import fs from "node:fs";
import path from "node:path";

export const TURN_DIAGNOSTIC_SCHEMA_VERSION = 1;

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_EXPORT_EVENTS = 5_000;
const DEFAULT_EXPORT_WINDOW_MS = 72 * 60 * 60_000;
const MAX_TEXT_CHARS = 1_200;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 80;

export function createTurnDiagnosticId(date = new Date(), randomBytes = crypto.randomBytes(4)) {
  const timestamp = date.toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Buffer.from(randomBytes).toString("hex").slice(0, 8).toUpperCase().padEnd(8, "0");
  return `H-${timestamp}-${suffix}`;
}

export function normalizeTurnDiagnosticId(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^H-\d{14}-[A-F0-9]{8}$/.test(text) ? text : "";
}

export function diagnosticHash(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function redactDiagnosticText(value, maxChars = MAX_TEXT_CHARS) {
  let text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!text) return "";
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED_KEY]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(["'])[A-Za-z]:\\[^"'\r\n]+\1/g, "$1[REDACTED_PATH]$1")
    .replace(/\b[A-Za-z]:\\[^\s"'<>|]*/g, "[REDACTED_PATH]")
    .replace(/(?:^|[\s"'(])\/(?:Users|home|var|tmp)\/[^\s"')]+/g, (match) => `${match[0]}[REDACTED_PATH]`);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15))}…[TRUNCATED]`;
}

export function failureDiagnosticsFromNotification(message) {
  const params = message?.params || {};
  const turnError = params?.turn?.error;
  const rootError = params?.error;
  const candidates = [
    turnError?.code,
    rootError?.code,
    turnError?.message,
    turnError?.additionalDetails,
    turnError?.additional_details,
    turnError?.codexErrorInfo?.additionalDetails,
    turnError?.codexErrorInfo?.additional_details,
    turnError?.codex_error_info?.additionalDetails,
    turnError?.codex_error_info?.additional_details,
    rootError?.message,
    rootError?.additionalDetails,
    rootError?.additional_details,
    rootError?.codexErrorInfo?.additionalDetails,
    rootError?.codexErrorInfo?.additional_details,
    rootError?.codex_error_info?.additionalDetails,
    rootError?.codex_error_info?.additional_details,
    params?.message,
    params?.reason,
  ];
  const details = [...new Set(candidates.map((value) => redactDiagnosticText(value)).filter(Boolean))];
  const facts = modelFailureFacts({ error: turnError || rootError, message: details.join(" | ") });
  const httpStatus = facts.httpStatus ?? firstHttpStatus([
    turnError?.status,
    turnError?.statusCode,
    turnError?.status_code,
    turnError?.httpStatusCode,
    turnError?.http_status_code,
    turnError?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode,
    turnError?.codex_error_info?.response_stream_disconnected?.http_status_code,
    rootError?.status,
    rootError?.statusCode,
    rootError?.status_code,
    rootError?.httpStatusCode,
    rootError?.http_status_code,
    rootError?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode,
    rootError?.codex_error_info?.response_stream_disconnected?.http_status_code,
    params?.status,
    params?.statusCode,
    params?.status_code,
  ]);
  const combined = details.join(" | ");
  return {
    errorClass: classifyTurnFailure(combined, httpStatus),
    httpStatus,
    detail: combined || null,
    ...(facts.retryable === undefined ? {} : { retryable: facts.retryable }),
    willRetry: Boolean(
      params?.willRetry === true
      || params?.will_retry === true
      || rootError?.willRetry === true
      || rootError?.will_retry === true
      || turnError?.willRetry === true
      || turnError?.will_retry === true
    ),
  };
}

export function classifyTurnFailure(detail, httpStatus = null) {
  const text = String(detail || "");
  if (/\b(?:list_turns|list_items) is not supported yet|Task history could not be restored automatically/i.test(text)) {
    return "thread_history_index";
  }
  if (httpStatus === 401 || httpStatus === 403 || /unauthori[sz]ed|forbidden|authentication|auth(?:entication)? expired/i.test(text)) {
    return "authentication";
  }
  if (/concurrency limit|too many concurrent|maximum concurrent|并发(?:限制|上限)/i.test(text)) {
    return "concurrency_limit";
  }
  if (isModelOverloadFailure(text)) return "overloaded";
  if (httpStatus === 429 || /rate limit|too many requests|429\b|限流|频率限制/i.test(text)) {
    return "rate_limit";
  }
  if (/context window|maximum context|too many tokens|上下文.{0,8}(?:满|超|限制)/i.test(text)) {
    return "context_window";
  }
  if (/responseStreamDisconnected|stream disconnected|stream closed|connection reset|broken pipe|unexpected eof|websocket.{0,20}(?:closed|disconnect)/i.test(text)) {
    return "stream_disconnected";
  }
  if (/\b10061\b|ECONNREFUSED|connection refused|actively refused|failed to connect/i.test(text)) {
    return "connection_refused";
  }
  if (/timed?\s*out|timeout|deadline exceeded|超时/i.test(text)) {
    return "timeout";
  }
  if (httpStatus != null && httpStatus >= 500) return "upstream_5xx";
  if (/\b(?:500|502|503|504|529)\b|internal server error|bad gateway|service unavailable|gateway timeout/i.test(text)) {
    return "upstream_5xx";
  }
  if (/proxy|代理/i.test(text)) return "proxy";
  return text || httpStatus != null ? "unknown" : "none";
}

export class TurnDiagnosticRecorder {
  constructor({
    logPath,
    appVersion = "",
    sessionId = crypto.randomUUID(),
    maxBytes = DEFAULT_MAX_BYTES,
    now = () => new Date(),
  } = {}) {
    if (!logPath) throw new Error("TurnDiagnosticRecorder requires logPath");
    this.logPath = path.resolve(logPath);
    this.appVersion = String(appVersion || "");
    this.sessionId = String(sessionId || crypto.randomUUID());
    this.maxBytes = Math.max(64 * 1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
    this.now = now;
  }

  record(event, payload = {}) {
    const diagnosticId = normalizeTurnDiagnosticId(payload.diagnosticId);
    const record = sanitizeDiagnosticValue({
      schemaVersion: TURN_DIAGNOSTIC_SCHEMA_VERSION,
      timestamp: this.now().toISOString(),
      sessionId: this.sessionId,
      appVersion: this.appVersion,
      event: String(event || "unknown"),
      ...(diagnosticId ? { diagnosticId } : {}),
      ...payload,
    });
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      this.rotateIfNeeded();
      fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
      return record;
    } catch {
      return null;
    }
  }

  exportReport(destinationPath, snapshot = {}, options = {}) {
    const exportedAt = this.now();
    const windowMs = Math.max(60_000, Number(options.windowMs) || DEFAULT_EXPORT_WINDOW_MS);
    const maxEvents = Math.max(1, Number(options.maxEvents) || DEFAULT_MAX_EXPORT_EVENTS);
    const cutoffMs = exportedAt.getTime() - windowMs;
    const events = this.readEvents()
      .filter((event) => {
        const timestampMs = Date.parse(event?.timestamp || "");
        return Number.isFinite(timestampMs) && timestampMs >= cutoffMs;
      })
      .slice(-maxEvents);
    // Events are already bounded by maxEvents, but each event still needs to
    // pass through the same privacy sanitizer used for live records. Do not
    // sanitize the completed report as one generic object: that would apply
    // MAX_ARRAY_ITEMS to the top-level event timeline and silently discard
    // every event after the first 40.
    const sanitizedEvents = events.map((event) => sanitizeDiagnosticValue(event));
    const report = {
      schemaVersion: TURN_DIAGNOSTIC_SCHEMA_VERSION,
      reportType: "haolo_turn_diagnostics",
      generatedAt: exportedAt.toISOString(),
      privacy: {
        includesPromptText: false,
        includesResponseText: false,
        includesCredentials: false,
        includesAbsolutePaths: false,
        note: "此报告仅包含脱敏运行状态、时延、错误分类和哈希关联标识。",
      },
      snapshot: sanitizeDiagnosticValue(snapshot),
      summary: sanitizeDiagnosticValue(summarizeEvents(sanitizedEvents)),
      events: sanitizedEvents,
    };
    const target = path.resolve(destinationPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, target);
    return { path: target, eventCount: events.length, report };
  }

  readEvents() {
    const events = [];
    for (const candidate of [`${this.logPath}.1`, this.logPath]) {
      let text = "";
      try {
        text = fs.readFileSync(candidate, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (value && typeof value === "object") events.push(value);
        } catch {
          // A partial final line must not prevent exporting earlier diagnostics.
        }
      }
    }
    return events;
  }

  rotateIfNeeded() {
    try {
      if (fs.statSync(this.logPath).size <= this.maxBytes) return;
      fs.rmSync(`${this.logPath}.1`, { force: true });
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    } catch {
      // First write or a rotation race; appendFileSync creates the file.
    }
  }
}

function firstHttpStatus(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 100 && number <= 599) return number;
  }
  return null;
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactDiagnosticText(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (/token|secret|credential|api.?key|access.?key|password|authorization|cookie|prompt|responseText|answer|question/i.test(key)) {
      if (item === false && /includesPromptText|includesResponseText|includesCredentials/i.test(key)) {
        output[key] = false;
        continue;
      }
      if (/tokens?|tokenCount|inputTokens|outputTokens|contextTokens/i.test(key) && typeof item === "number") {
        output[key] = item;
      }
      continue;
    }
    output[key] = sanitizeDiagnosticValue(item, depth + 1);
  }
  return output;
}

function summarizeEvents(events) {
  const eventCounts = {};
  const failureClasses = {};
  const models = {};
  const diagnosticIds = new Set();
  for (const event of events) {
    const eventName = String(event?.event || "unknown");
    eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;
    if (event?.errorClass && event.errorClass !== "none") {
      failureClasses[event.errorClass] = (failureClasses[event.errorClass] || 0) + 1;
    }
    if (event?.model) models[event.model] = (models[event.model] || 0) + 1;
    if (event?.diagnosticId) diagnosticIds.add(event.diagnosticId);
  }
  return {
    eventCount: events.length,
    turnCount: diagnosticIds.size,
    eventCounts,
    failureClasses,
    models,
  };
}
