import crypto from "node:crypto";
import {
  EXTERNAL_AGENT_READ_ONLY_ROLES,
  ExternalAgentPolicyError,
} from "./read-only-policy.mjs";
import { normalizeExternalModelProviderId } from "./provider-registry.mjs";
import { runReadOnlyModelOperationWithRecovery } from "../model-transport-recovery.mjs";

const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_QUEUED_RUNS = 8;
const DEFAULT_TERMINAL_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_TERMINAL_RUNS = 50;
const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_LABEL_LENGTH = 120;
const MAX_ORCHESTRATION_ID_LENGTH = 160;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export class ExternalAgentRuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ExternalAgentRuntimeError";
    this.code = code;
    this.provider = options.provider || null;
    this.status = Number.isInteger(options.status) ? options.status : null;
    this.retryable = options.retryable === true;
  }
}

export class ExternalAgentRuntime {
  constructor({
    service,
    enabled = false,
    providerAllowlist = [],
    maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS,
    maxQueuedRuns = DEFAULT_MAX_QUEUED_RUNS,
    terminalTtlMs = DEFAULT_TERMINAL_TTL_MS,
    maxTerminalRuns = DEFAULT_MAX_TERMINAL_RUNS,
    now = () => new Date(),
    createRunId = () => `ext-run_${crypto.randomUUID()}`,
    waitForRetry,
  } = {}) {
    if (!service || typeof service.prepareReadOnly !== "function" || typeof service.invokePreparedReadOnly !== "function") {
      throw new Error("external model service with read-only invocation support is required");
    }
    this.service = service;
    this.enabled = enabled === true;
    this.providerAllowlist = new Set(normalizeAllowlist(providerAllowlist));
    this.maxConcurrentRuns = positiveInteger(maxConcurrentRuns, DEFAULT_MAX_CONCURRENT_RUNS);
    this.maxQueuedRuns = positiveInteger(maxQueuedRuns, DEFAULT_MAX_QUEUED_RUNS);
    this.terminalTtlMs = positiveInteger(terminalTtlMs, DEFAULT_TERMINAL_TTL_MS);
    this.maxTerminalRuns = positiveInteger(maxTerminalRuns, DEFAULT_MAX_TERMINAL_RUNS);
    this.now = now;
    this.createRunId = createRunId;
    this.waitForRetry = waitForRetry;
    this.runs = new Map();
    this.queue = [];
    this.listeners = new Set();
    this.activeCount = 0;
    this.shuttingDown = false;
  }

  capabilities() {
    return {
      enabled: this.enabled && !this.shuttingDown,
      roles: [...EXTERNAL_AGENT_READ_ONLY_ROLES],
      providerAllowlist: [...this.providerAllowlist],
      limits: {
        maxConcurrentRuns: this.maxConcurrentRuns,
        maxQueuedRuns: this.maxQueuedRuns,
      },
      capabilities: {
        textOnly: true,
        toolsEnabled: false,
        localFileAccess: false,
        shellAccess: false,
        writeAccess: false,
        automaticRetry: true,
        automaticProviderFallback: false,
      },
    };
  }

  start(params = {}, { ownerId, userDirected = false } = {}) {
    this.prune();
    this.assertEnabled();
    const owner = normalizeOwnerId(ownerId);
    const publicInput = normalizePublicRunInput(params);
    const messages = buildMessages(publicInput.task, publicInput.context);
    const invocation = this.service.prepareReadOnly({
      provider: publicInput.provider,
      role: publicInput.role,
      messages,
      dataClassification: publicInput.dataClassification,
      userDirected: userDirected === true,
      budget: publicInput.budget,
    });
    if (!this.providerAllowlist.has(invocation.provider)) {
      throw new ExternalAgentRuntimeError(
        "PROVIDER_NOT_ALLOWLISTED",
        `${invocation.provider} 尚未进入外部只读 Agent 灰度名单。`,
        { provider: invocation.provider },
      );
    }
    if (this.queue.length >= this.maxQueuedRuns) {
      throw new ExternalAgentRuntimeError("RUNTIME_BUSY", "外部只读 Agent 队列已满，请稍后重试。", { retryable: true });
    }
    const orchestrationId = normalizeOrchestrationId(publicInput.orchestrationId) || `manual-${crypto.randomUUID()}`;
    if (this.hasLiveOrchestrationRun(orchestrationId)) {
      throw new ExternalAgentRuntimeError(
        "ORCHESTRATION_CONCURRENCY_LIMIT",
        "同一编排任务当前只允许一个外部模型 Run。",
      );
    }
    const runId = uniqueRunId(this.runs, this.createRunId);
    const createdAt = this.now().toISOString();
    let resolveCompletion;
    const completionPromise = new Promise((resolve) => { resolveCompletion = resolve; });
    const run = {
      runId,
      ownerId: owner,
      orchestrationId,
      provider: invocation.provider,
      role: invocation.role,
      dataClassification: invocation.dataClassification,
      status: "queued",
      createdAt,
      startedAt: null,
      completedAt: null,
      seq: 0,
      invocation,
      controller: null,
      result: null,
      error: null,
      cancelRequested: false,
      promise: null,
      completionPromise,
      resolveCompletion,
    };
    this.runs.set(runId, run);
    this.queue.push(runId);
    this.pump();
    return publicRun(run);
  }

  getRun(runId, { ownerId } = {}) {
    this.prune();
    return publicRun(this.requireOwnedRun(runId, ownerId));
  }

  async waitRun(runId, { ownerId } = {}) {
    this.prune();
    const run = this.requireOwnedRun(runId, ownerId);
    await run.completionPromise;
    return publicRun(this.requireOwnedRun(runId, ownerId));
  }

  cancelRun(runId, { ownerId } = {}) {
    this.prune();
    const run = this.requireOwnedRun(runId, ownerId);
    if (TERMINAL_STATUSES.has(run.status)) return { cancelled: false, run: publicRun(run) };
    run.cancelRequested = true;
    if (run.status === "queued") {
      this.queue = this.queue.filter((id) => id !== run.runId);
      this.transitionTerminal(run, "cancelled");
      run.invocation = null;
      this.pump();
    } else {
      run.status = "cancelling";
      run.controller?.abort(new Error("external agent run cancelled"));
    }
    return { cancelled: true, run: publicRun(run) };
  }

  async cancelOwner(ownerId, { timeoutMs = 2_000 } = {}) {
    const owner = normalizeOwnerId(ownerId);
    const pending = [];
    for (const run of this.runs.values()) {
      if (run.ownerId !== owner || TERMINAL_STATUSES.has(run.status)) continue;
      this.cancelRun(run.runId, { ownerId: owner });
      pending.push(run.completionPromise);
    }
    await settleWithTimeout(pending, timeoutMs);
  }

  async cancelProvider(provider, { timeoutMs = 2_000 } = {}) {
    const id = normalizeExternalModelProviderId(provider);
    if (!id) return;
    const pending = [];
    for (const run of this.runs.values()) {
      if (run.provider !== id || TERMINAL_STATUSES.has(run.status)) continue;
      this.cancelRun(run.runId, { ownerId: run.ownerId });
      pending.push(run.completionPromise);
    }
    await settleWithTimeout(pending, timeoutMs);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown({ timeoutMs = 2_000 } = {}) {
    this.shuttingDown = true;
    const pending = [];
    for (const run of this.runs.values()) {
      if (TERMINAL_STATUSES.has(run.status)) continue;
      this.cancelRun(run.runId, { ownerId: run.ownerId });
      if (run.promise) pending.push(run.promise);
    }
    if (pending.length) {
      let timer;
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => { timer = setTimeout(resolve, positiveInteger(timeoutMs, 2_000)); }),
      ]).finally(() => clearTimeout(timer));
    }
  }

  pump() {
    if (this.shuttingDown) return;
    while (this.activeCount < this.maxConcurrentRuns && this.queue.length) {
      const runId = this.queue.shift();
      const run = this.runs.get(runId);
      if (!run || run.status !== "queued") continue;
      this.beginRun(run);
    }
  }

  beginRun(run) {
    run.status = "running";
    run.startedAt = this.now().toISOString();
    run.controller = new AbortController();
    this.activeCount += 1;
    this.emit(run, "run.started", {
      estimatedInputTokens: run.invocation.estimatedInputTokens,
      budget: { ...run.invocation.budget },
    });
    run.promise = this.execute(run).finally(() => {
      this.activeCount = Math.max(0, this.activeCount - 1);
      run.controller = null;
      run.invocation = null;
      this.pump();
      this.prune();
    });
  }

  async execute(run) {
    try {
      const result = await runReadOnlyModelOperationWithRecovery({
        signal: run.controller.signal,
        waitForRetry: this.waitForRetry,
        operation: () => this.service.invokePreparedReadOnly(
          run.invocation,
          { signal: run.controller.signal },
        ),
        onRetry: ({ attempt, nextAttempt, delayMs, lowFrequency, error }) => {
          this.emit(run, "run.retry_scheduled", {
            attempt,
            nextAttempt,
            delayMs,
            lowFrequency,
            error: publicError(error, run.provider),
          });
        },
      });
      if (run.cancelRequested || run.controller.signal.aborted) {
        this.transitionTerminal(run, "cancelled");
        return;
      }
      run.result = publicResult(result);
      this.emit(run, "model.delta", { text: run.result.text });
      if (run.cancelRequested || run.controller.signal.aborted) {
        run.result = null;
        this.transitionTerminal(run, "cancelled");
        return;
      }
      this.transitionTerminal(run, "completed", { result: run.result });
    } catch (error) {
      if (run.cancelRequested || run.controller?.signal.aborted || error?.code === "INVOCATION_CANCELLED") {
        this.transitionTerminal(run, "cancelled");
        return;
      }
      run.error = publicError(error, run.provider);
      this.transitionTerminal(run, "failed", { error: run.error });
    }
  }

  transitionTerminal(run, status, payload = {}) {
    if (TERMINAL_STATUSES.has(run.status)) return false;
    run.status = status;
    run.completedAt = this.now().toISOString();
    const eventType = status === "completed" ? "run.completed" : status === "failed" ? "run.failed" : "run.cancelled";
    this.emit(run, eventType, payload);
    run.resolveCompletion?.();
    run.resolveCompletion = null;
    return true;
  }

  emit(run, type, payload) {
    const event = {
      schemaVersion: 1,
      runId: run.runId,
      seq: ++run.seq,
      type,
      provider: run.provider,
      role: run.role,
      at: this.now().toISOString(),
      payload,
      ownerId: run.ownerId,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Runtime listeners are observers and cannot affect a provider run.
      }
    }
  }

  requireOwnedRun(runId, ownerId) {
    const id = String(runId || "").trim();
    const owner = normalizeOwnerId(ownerId);
    const run = this.runs.get(id);
    if (!run || run.ownerId !== owner) {
      throw new ExternalAgentRuntimeError("RUN_NOT_FOUND", "外部模型 Run 不存在或不属于当前窗口。");
    }
    return run;
  }

  hasLiveOrchestrationRun(orchestrationId) {
    for (const run of this.runs.values()) {
      if (run.orchestrationId === orchestrationId && !TERMINAL_STATUSES.has(run.status)) return true;
    }
    return false;
  }

  assertEnabled() {
    if (!this.enabled || this.shuttingDown) {
      throw new ExternalAgentRuntimeError(
        "FEATURE_DISABLED",
        "外部只读 Agent Runtime 当前未开启；模型 Key 配置和连接测试仍可正常使用。",
      );
    }
  }

  prune() {
    const nowMs = this.now().getTime();
    const terminal = [];
    for (const [runId, run] of this.runs) {
      if (!TERMINAL_STATUSES.has(run.status)) continue;
      terminal.push(run);
      const completedMs = Date.parse(run.completedAt || "");
      if (Number.isFinite(completedMs) && nowMs - completedMs > this.terminalTtlMs) this.runs.delete(runId);
    }
    const retainedTerminal = terminal
      .filter((run) => this.runs.has(run.runId))
      .sort((left, right) => Date.parse(right.completedAt || "") - Date.parse(left.completedAt || ""));
    for (const run of retainedTerminal.slice(this.maxTerminalRuns)) this.runs.delete(run.runId);
  }
}

function normalizePublicRunInput(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new ExternalAgentRuntimeError("INVALID_RUN_INPUT", "外部模型 Run 参数不正确。");
  }
  const allowedKeys = new Set([
    "provider",
    "role",
    "task",
    "context",
    "dataClassification",
    "budget",
    "orchestrationId",
  ]);
  for (const key of Object.keys(params)) {
    if (!allowedKeys.has(key)) {
      throw new ExternalAgentRuntimeError(
        "UNSAFE_RUN_INPUT",
        `Renderer 不允许覆盖外部模型 ${key}；系统提示、模型、凭据、站点和能力由主进程管理。`,
      );
    }
  }
  const task = typeof params.task === "string" ? params.task.trim() : "";
  if (!task) throw new ExternalAgentRuntimeError("TASK_REQUIRED", "请填写外部只读 Agent 的任务。");
  const context = normalizeContext(params.context);
  return {
    provider: String(params.provider || "").trim().toLowerCase(),
    role: String(params.role || "").trim().toLowerCase(),
    task,
    context,
    dataClassification: String(params.dataClassification || "internal").trim().toLowerCase(),
    budget: normalizePublicBudget(params.budget),
    orchestrationId: params.orchestrationId,
  };
}

function normalizeContext(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_ITEMS) {
    throw new ExternalAgentRuntimeError(
      "INVALID_CONTEXT",
      `当前阶段最多允许 ${MAX_CONTEXT_ITEMS} 段显式文本上下文。`,
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || typeof item.content !== "string" || !item.content.trim()) {
      throw new ExternalAgentRuntimeError("INVALID_CONTEXT", "外部模型上下文必须是非空纯文本。");
    }
    if (Object.keys(item).some((key) => !["label", "content"].includes(key))) {
      throw new ExternalAgentRuntimeError("INVALID_CONTEXT", "外部模型上下文只允许 label 和 content 文本字段。");
    }
    const label = typeof item.label === "string" ? item.label.trim().slice(0, MAX_CONTEXT_LABEL_LENGTH) : `材料 ${index + 1}`;
    if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(label)) {
      throw new ExternalAgentRuntimeError("ABSOLUTE_PATH_BLOCKED", "上下文标签不得包含绝对路径或 UNC 路径。");
    }
    return { label: label || `材料 ${index + 1}`, content: item.content.trim() };
  });
}

function buildMessages(task, context) {
  return [{
    role: "user",
    content: [
      "<reference_material_json>",
      JSON.stringify(context),
      "</reference_material_json>",
      "<task_json>",
      JSON.stringify(task),
      "</task_json>",
    ].join("\n"),
  }];
}

function publicRun(run) {
  return {
    runId: run.runId,
    orchestrationId: run.orchestrationId,
    provider: run.provider,
    role: run.role,
    dataClassification: run.dataClassification,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    result: run.result ? { ...run.result, usage: { ...run.result.usage }, citations: run.result.citations.map((item) => ({ ...item })) } : null,
    error: run.error ? { ...run.error } : null,
  };
}

function publicResult(result) {
  return {
    text: safeResultText(result?.text, 200_000),
    usage: publicUsage(result?.usage),
    finishReason: publicFinishReason(result?.finishReason),
    citations: Array.isArray(result?.citations)
      ? result.citations.map(publicCitation).filter(Boolean).slice(0, 20)
      : [],
    clientTruncated: result?.clientTruncated === true,
  };
}

function publicError(error, provider) {
  if (error instanceof ExternalAgentPolicyError) {
    return { code: error.code, message: error.message, provider, status: null, retryable: false };
  }
  return {
    code: String(error?.code || "RUN_FAILED").replace(/[^A-Z0-9_]/gi, "_").slice(0, 100),
    message: safeErrorMessage(error?.message),
    provider: String(error?.provider || provider || "").slice(0, 100),
    status: Number.isInteger(error?.status) ? error.status : null,
    retryable: error?.retryable === true,
  };
}

function safeErrorMessage(value) {
  const message = typeof value === "string"
    ? redactRuntimeSecrets(value)
      .replace(/[\r\n\t\0]+/g, " ")
      .trim()
      .slice(0, 500)
    : "";
  return message || "外部只读 Agent 运行失败。";
}

function publicEvent(event) {
  const { ownerId: _ownerId, ...safe } = event;
  return safe;
}

export function externalAgentPublicEvent(event) {
  return publicEvent(event);
}

function normalizeAllowlist(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => normalizeExternalModelProviderId(item)).filter(Boolean))];
}

function publicUsage(value) {
  const usage = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
    "searchQueries",
    "totalCost",
  ]) {
    const number = Number(usage[key]);
    result[key] = Number.isFinite(number) && number >= 0 ? number : null;
  }
  return result;
}

function publicFinishReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return ["stop", "length", "content_filter", "tool_call", "overload", "cancelled", "error", "unknown"]
    .includes(reason) ? reason : "unknown";
}

function publicCitation(item) {
  if (!item || typeof item !== "object") return null;
  let url;
  try {
    url = new URL(String(item.url || ""));
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return null;
  if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) return null;
  for (const key of url.searchParams.keys()) {
    if (/(?:api[_-]?key|access[_-]?token|auth|authorization|credential|password|secret|signature)/i.test(key)) return null;
  }
  url.hash = "";
  return {
    url: url.href,
    title: safeResultText(item.title, 300),
    date: safeResultText(item.date, 40),
    snippet: safeResultText(item.snippet, 500),
  };
}

function safeResultText(value, maxLength) {
  return redactRuntimeSecrets(typeof value === "string" ? value : "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, maxLength);
}

function redactRuntimeSecrets(value) {
  return String(value || "")
    .replace(/\b(?:sk-ant-|sk-|pplx-|xai-|tp-)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{12,}\b/g, "[REDACTED]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi, "Authorization: [REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|secret|password)["']?\s*[:=]\s*["'])[^"'\s]{8,}(["'])/gi, "$1[REDACTED]$2");
}

async function settleWithTimeout(promises, timeoutMs) {
  if (!promises.length) return;
  let timer;
  await Promise.race([
    Promise.allSettled(promises),
    new Promise((resolve) => {
      timer = setTimeout(resolve, positiveInteger(timeoutMs, 2_000));
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalizeOwnerId(value) {
  const owner = String(value ?? "").trim();
  if (!owner || owner.length > 200) throw new ExternalAgentRuntimeError("INVALID_OWNER", "外部模型 Run 所有者不正确。");
  return owner;
}

function normalizeOrchestrationId(value) {
  if (value == null || value === "") return "";
  const id = String(value).trim();
  if (!id || id.length > MAX_ORCHESTRATION_ID_LENGTH || /[\r\n\0]/.test(id)) {
    throw new ExternalAgentRuntimeError("INVALID_ORCHESTRATION_ID", "外部模型编排关联 ID 不正确。");
  }
  return id;
}

function uniqueRunId(runs, createRunId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = String(createRunId() || "").trim();
    if (/^ext-run_[a-zA-Z0-9-]{8,}$/.test(id) && !runs.has(id)) return id;
  }
  throw new ExternalAgentRuntimeError("RUN_ID_GENERATION_FAILED", "无法创建唯一的外部模型 Run ID。");
}

function normalizePublicBudget(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExternalAgentRuntimeError("INVALID_BUDGET", "外部模型预算参数不正确。");
  }
  for (const key of Object.keys(value)) {
    if (!["maxOutputTokens", "timeoutMs"].includes(key)) {
      throw new ExternalAgentRuntimeError("INVALID_BUDGET", `Renderer 不允许设置预算字段 ${key}。`);
    }
  }
  const result = {};
  if (value.maxOutputTokens != null) {
    const maxOutputTokens = Number(value.maxOutputTokens);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 2_048) {
      throw new ExternalAgentRuntimeError("INVALID_BUDGET", "首轮灰度最大输出预算不得超过 2048 tokens。");
    }
    result.maxOutputTokens = maxOutputTokens;
  }
  if (value.timeoutMs != null) {
    const timeoutMs = Number(value.timeoutMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 90_000) {
      throw new ExternalAgentRuntimeError("INVALID_BUDGET", "首轮灰度超时时间必须在 5-90 秒之间。");
    }
    result.timeoutMs = timeoutMs;
  }
  return result;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
