import { getExternalModelProvider } from "./provider-registry.mjs";
import { gptReasoningEffortForTask } from "../gpt-reasoning-effort.mjs";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_DETAIL_LENGTH = 400;
const MAX_OUTPUT_TEXT_CHARACTERS = 200_000;
const MAX_CITATIONS = 20;

export class ExternalModelInvocationError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ExternalModelInvocationError";
    this.code = code;
    this.provider = options.provider || null;
    this.status = Number.isInteger(options.status) ? options.status : null;
    this.retryable = options.retryable === true;
  }
}

export async function invokeReadOnlyExternalModel({ credential, invocation, fetch, signal } = {}) {
  if (typeof fetch !== "function") throw new Error("fetch is required");
  if (signal?.aborted) {
    throw new ExternalModelInvocationError(
      "INVOCATION_CANCELLED",
      `${credential?.provider?.displayName || "外部模型"} 只读调用已取消。`,
      { provider: credential?.provider?.id },
    );
  }
  const request = buildReadOnlyInvocationRequest({ credential, invocation });
  const provider = credential.provider;
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener?.("abort", onCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("external model invocation timeout"));
  }, invocation.budget?.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    const payload = await readJsonResponse(response, controller);
    if (!response?.ok) {
      throw httpInvocationError(provider, response?.status, payload, credential.apiKey);
    }
    return parseReadOnlyInvocationResponse({ provider, payload, apiKey: credential.apiKey });
  } catch (error) {
    if (error instanceof ExternalModelInvocationError) throw error;
    if (signal?.aborted) {
      throw new ExternalModelInvocationError(
        "INVOCATION_CANCELLED",
        `${provider.displayName} 只读调用已取消。`,
        { provider: provider.id },
      );
    }
    if (timedOut) {
      throw new ExternalModelInvocationError(
        "INVOCATION_TIMEOUT",
        `${provider.displayName} 只读调用超时。`,
        { provider: provider.id, retryable: true },
      );
    }
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new ExternalModelInvocationError(
        "INVOCATION_CANCELLED",
        `${provider.displayName} 只读调用已取消。`,
        { provider: provider.id },
      );
    }
    throw new ExternalModelInvocationError(
      "INVOCATION_FAILED",
      `${provider.displayName} 只读调用失败，请检查网络和服务状态。`,
      { provider: provider.id, retryable: true },
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", onCallerAbort);
  }
}

export function buildReadOnlyInvocationRequest({ credential, invocation } = {}) {
  const provider = getExternalModelProvider(credential?.provider?.id);
  const baseUrl = String(credential?.baseUrl || "").replace(/\/+$/, "");
  const allowedBaseUrls = new Set(
    (provider?.baseUrlOptions || []).map((option) => String(option.baseUrl || "").replace(/\/+$/, "")),
  );
  if (
    !provider?.id ||
    typeof credential?.apiKey !== "string" ||
    !credential.apiKey ||
    /[\r\n\0]/.test(credential.apiKey) ||
    !allowedBaseUrls.has(baseUrl)
  ) {
    throw new ExternalModelInvocationError("INVALID_CREDENTIAL", "外部模型凭据配置不完整。");
  }
  if (!invocation?.systemPrompt || !Array.isArray(invocation?.messages) || !invocation?.budget) {
    throw new ExternalModelInvocationError("INVALID_INVOCATION", "外部模型只读调用参数不完整。", {
      provider: provider.id,
    });
  }
  const headers = authenticationHeaders(provider, credential.apiKey);
  const body = invocationBody(provider, credential.model, invocation);
  const path = invocationPath(provider);
  return {
    url: joinUrl(baseUrl, path),
    init: {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export function parseReadOnlyInvocationResponse({ provider, payload, apiKey = "" } = {}) {
  if (!provider?.id || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ExternalModelInvocationError(
      "INVALID_PROVIDER_RESPONSE",
      `${provider?.displayName || "外部模型"} 返回了无法识别的响应。`,
      { provider: provider?.id },
    );
  }
  if (payload.error) {
    throw new ExternalModelInvocationError(
      "PROVIDER_RESPONSE_ERROR",
      `${provider.displayName} 未能生成结果。`,
      { provider: provider.id },
    );
  }
  let parsed;
  if (provider.protocol === "anthropic-messages") parsed = parseAnthropicResponse(provider, payload);
  else if (provider.protocol === "perplexity-sonar") parsed = parseChatCompletionResponse(provider, payload);
  else if (["openai-chat-completions", "google-openai-compat"].includes(provider.protocol)) {
    parsed = parseChatCompletionResponse(provider, payload);
  } else if (provider.protocol === "openai-responses") parsed = parseResponsesApiResponse(provider, payload);
  else {
    throw new ExternalModelInvocationError(
      "UNSUPPORTED_PROTOCOL",
      `${provider.displayName} 的只读调用协议尚未实现。`,
      { provider: provider.id },
    );
  }
  const clipped = clipOutputText(redactPotentialSecrets(parsed.text, apiKey));
  if (!clipped.text) {
    throw new ExternalModelInvocationError(
      "EMPTY_PROVIDER_RESPONSE",
      `${provider.displayName} 没有返回可用的文本结果。`,
      { provider: provider.id },
    );
  }
  return {
    text: clipped.text,
    usage: normalizeUsage(payload.usage, provider.protocol),
    finishReason: normalizeFinishReason(parsed.finishReason),
    citations: collectCitations(payload, apiKey),
    clientTruncated: clipped.truncated,
    providerState: {
      requestId: safeIdentifier(redactPotentialSecrets(payload.id, apiKey)),
      status: safeIdentifier(redactPotentialSecrets(payload.status || parsed.finishReason, apiKey)),
    },
  };
}

function invocationBody(provider, model, invocation) {
  if (provider.protocol === "anthropic-messages") {
    return {
      model,
      system: invocation.systemPrompt,
      messages: invocation.messages,
      max_tokens: invocation.budget.maxOutputTokens,
      stream: false,
    };
  }
  if (provider.protocol === "perplexity-sonar") {
    return {
      model,
      messages: [{ role: "system", content: invocation.systemPrompt }, ...invocation.messages],
      max_tokens: invocation.budget.maxOutputTokens,
      stream: false,
      ...(invocation.role === "research" ? {} : { web_search_options: { disable_search: true } }),
    };
  }
  if (["openai-chat-completions", "google-openai-compat"].includes(provider.protocol)) {
    const body = {
      model,
      messages: [{ role: "system", content: invocation.systemPrompt }, ...invocation.messages],
      stream: false,
    };
    if (provider.id === "moonshot") {
      body.max_completion_tokens = invocation.budget.maxOutputTokens;
      body.thinking = { type: "disabled" };
    } else if (provider.id !== "google") {
      body.max_tokens = invocation.budget.maxOutputTokens;
    }
    if (provider.id === "deepseek") body.thinking = { type: "disabled" };
    return body;
  }
  if (provider.protocol === "openai-responses") {
    const reasoningEffort = gptReasoningEffortForTask({
      model,
      task: invocation.messages.at(-1)?.content,
    });
    const body = {
      model,
      instructions: invocation.systemPrompt,
      input: invocation.messages,
      max_output_tokens: invocation.budget.maxOutputTokens,
      stream: false,
    };
    if (provider.id === "openai" || provider.id === "xai") body.store = false;
    if (provider.id === "openai" && reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }
    if (provider.id === "xiaomi") body.reasoning = { effort: "none" };
    return body;
  }
  throw new ExternalModelInvocationError(
    "UNSUPPORTED_PROTOCOL",
    `${provider.displayName} 的只读调用协议尚未实现。`,
    { provider: provider.id },
  );
}

function invocationPath(provider) {
  if (provider.protocol === "anthropic-messages") return "/messages";
  if (provider.protocol === "perplexity-sonar") return "/v1/sonar";
  if (["openai-chat-completions", "google-openai-compat"].includes(provider.protocol)) {
    return "/chat/completions";
  }
  if (provider.protocol === "openai-responses") return "/responses";
  throw new ExternalModelInvocationError(
    "UNSUPPORTED_PROTOCOL",
    `${provider.displayName} 的只读调用协议尚未实现。`,
    { provider: provider.id },
  );
}

function authenticationHeaders(provider, apiKey) {
  if (provider.id === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function parseResponsesApiResponse(provider, payload) {
  const unexpected = Array.isArray(payload.output)
    ? payload.output.some((item) => isToolCallType(item?.type) || containsToolCallShape(item))
    : false;
  if (unexpected) throw unexpectedToolCall(provider);
  const outputText = typeof payload.output_text === "string" ? payload.output_text : "";
  const contentText = Array.isArray(payload.output)
    ? payload.output
      .filter((item) => item?.type === "message" && Array.isArray(item.content))
      .flatMap((item) => item.content)
      .filter((item) => item?.type === "output_text" || item?.type === "text")
      .map((item) => typeof item.text === "string" ? item.text : "")
      .filter(Boolean)
      .join("\n")
    : "";
  return {
    text: outputText || contentText,
    finishReason: payload.status === "incomplete"
      ? payload.incomplete_details?.reason || "incomplete"
      : payload.status || "completed",
  };
}

function parseChatCompletionResponse(provider, payload) {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (
    choice?.message?.tool_calls?.length ||
    choice?.message?.function_call ||
    ["tool_calls", "function_call"].includes(choice?.finish_reason) ||
    containsToolCallShape(choice?.message?.content)
  ) {
    throw unexpectedToolCall(provider);
  }
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((item) => typeof item === "string" ? item : item?.text || "").filter(Boolean).join("\n")
      : "";
  return { text, finishReason: choice?.finish_reason || null };
}

function parseAnthropicResponse(provider, payload) {
  if (Array.isArray(payload.content) && payload.content.some((item) => isToolCallType(item?.type) || containsToolCallShape(item))) {
    throw unexpectedToolCall(provider);
  }
  const text = Array.isArray(payload.content)
    ? payload.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
    : "";
  return { text, finishReason: payload.stop_reason || null };
}

function unexpectedToolCall(provider) {
  return new ExternalModelInvocationError(
    "UNEXPECTED_TOOL_CALL",
    `${provider.displayName} 返回了工具调用，但 Haolo 当前只读阶段不会执行任何工具。`,
    { provider: provider.id },
  );
}

function isToolCallType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (/(?:^|_)call(?:_|$)/.test(type) || type.endsWith("_call")) return true;
  return /(?:^|_)(?:function|tool|mcp|computer|browser|web_search|file_search|code_interpreter|code_execution|image_generation|shell)(?:_|$)/.test(type) &&
    /(?:call|use|request|approval|execution|search|generation)/.test(type);
}

function containsToolCallShape(value) {
  const pending = [value];
  let inspected = 0;
  while (pending.length && inspected < 10_000) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    inspected += 1;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.replace(/[-_]/g, "").toLowerCase();
      if (
        ["functioncall", "toolcall", "toolcalls", "tooluse", "servertooluse", "mcpcall"].includes(normalized) ||
        normalized.endsWith("call")
      ) {
        return true;
      }
      if (key === "type" && isToolCallType(child)) return true;
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return inspected >= 10_000;
}

function normalizeUsage(value, protocol) {
  const usage = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const inputTokens = protocol === "anthropic-messages"
    ? nonNegativeInteger(usage.input_tokens)
    : nonNegativeInteger(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = protocol === "anthropic-messages"
    ? nonNegativeInteger(usage.output_tokens)
    : nonNegativeInteger(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens) ?? (
    inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null
  );
  const totalCost = finiteNumber(usage.cost?.total_cost);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: nonNegativeInteger(
      usage.output_tokens_details?.reasoning_tokens ??
      usage.completion_tokens_details?.reasoning_tokens ??
      usage.reasoning_tokens,
    ),
    cachedInputTokens: nonNegativeInteger(
      usage.input_tokens_details?.cached_tokens ??
      usage.prompt_tokens_details?.cached_tokens ??
      usage.cached_tokens ??
      usage.prompt_cache_hit_tokens,
    ),
    searchQueries: nonNegativeInteger(usage.num_search_queries),
    totalCost,
  };
}

function collectCitations(payload, apiKey = "") {
  const candidates = [];
  if (Array.isArray(payload.citations)) {
    for (const item of payload.citations) {
      if (typeof item === "string") candidates.push({ url: item, title: "" });
      else if (item && typeof item === "object") candidates.push({
        url: item.url,
        title: item.title,
        date: item.date,
        snippet: item.snippet,
      });
    }
  }
  if (Array.isArray(payload.search_results)) {
    for (const item of payload.search_results) candidates.push({
      url: item?.url,
      title: item?.title,
      date: item?.date || item?.last_updated,
      snippet: item?.snippet,
    });
  }
  if (Array.isArray(payload.output)) {
    for (const outputItem of payload.output) {
      if (!Array.isArray(outputItem?.content)) continue;
      for (const contentItem of outputItem.content) {
        if (!Array.isArray(contentItem?.annotations)) continue;
        for (const annotation of contentItem.annotations) {
          candidates.push({
            url: annotation?.url || annotation?.url_citation?.url,
            title: annotation?.title || annotation?.url_citation?.title,
          });
        }
      }
    }
  }
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const url = safeHttpUrl(candidate.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      title: safeText(redactPotentialSecrets(candidate.title, apiKey), 300),
      date: safeText(redactPotentialSecrets(candidate.date, apiKey), 40),
      snippet: safeText(redactPotentialSecrets(candidate.snippet, apiKey), 500),
    });
    if (result.length >= MAX_CITATIONS) break;
  }
  return result;
}

async function readJsonResponse(response, controller) {
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  if (response?.ok && contentType && !contentType.includes("json")) {
    throw new ExternalModelInvocationError(
      "INVALID_PROVIDER_RESPONSE",
      "外部模型返回了非 JSON 响应。",
      { status: response?.status },
    );
  }
  const text = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES, controller);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ExternalModelInvocationError(
      "INVALID_PROVIDER_RESPONSE",
      "外部模型返回了无法解析的响应。",
      { status: response?.status, retryable: Number(response?.status || 0) >= 500 },
    );
  }
}

async function readResponseTextWithLimit(response, maxBytes, controller) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response?.text?.();
    if (Buffer.byteLength(String(text || ""), "utf8") > maxBytes) {
      controller?.abort(new Error("external model response too large"));
      throw responseTooLarge(response);
    }
    return String(text || "");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value?.byteLength || 0;
      if (totalBytes > maxBytes) {
        controller?.abort(new Error("external model response too large"));
        await reader.cancel().catch(() => {});
        throw responseTooLarge(response);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

function responseTooLarge(response) {
  return new ExternalModelInvocationError(
    "PROVIDER_RESPONSE_TOO_LARGE",
    "外部模型响应超过 Haolo 当前阶段的安全大小限制。",
    { status: response?.status },
  );
}

function httpInvocationError(provider, status, payload, apiKey) {
  const detail = sanitizedProviderError(payload, apiKey);
  const suffix = detail ? `：${detail}` : "";
  if (status === 401 || status === 403) {
    return new ExternalModelInvocationError(
      "AUTHENTICATION_FAILED",
      `${provider.displayName} 鉴权失败，请检查 Key、站点和模型权限${suffix}`,
      { provider: provider.id, status },
    );
  }
  if (status === 429) {
    return new ExternalModelInvocationError(
      "RATE_LIMITED",
      `${provider.displayName} 返回限流或额度不足${suffix}`,
      { provider: provider.id, status, retryable: true },
    );
  }
  if (status >= 500) {
    return new ExternalModelInvocationError(
      "PROVIDER_UNAVAILABLE",
      `${provider.displayName} 服务暂时不可用（HTTP ${status}）${suffix}`,
      { provider: provider.id, status, retryable: true },
    );
  }
  return new ExternalModelInvocationError(
    "PROVIDER_REQUEST_REJECTED",
    `${provider.displayName} 拒绝了只读请求（HTTP ${status || "未知"}）${suffix}`,
    { provider: provider.id, status },
  );
}

function sanitizedProviderError(payload, apiKey) {
  const detail = payload?.error?.message || payload?.message || payload?.detail || "";
  return redactPotentialSecrets(String(detail || ""), apiKey)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function redactPotentialSecrets(value, exactSecret) {
  let result = String(value || "");
  if (exactSecret) result = result.replaceAll(String(exactSecret), "[REDACTED]");
  return result
    .replace(/\b(?:sk-ant-|sk-|pplx-|xai-|tp-)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{12,}\b/g, "[REDACTED]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi, "Authorization: [REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|secret)["']?\s*[:=]\s*["'])[^"'\s]{8,}(["'])/gi, "$1[REDACTED]$2");
}

function clipOutputText(value) {
  const text = String(value || "").replace(/\0/g, "").trim();
  if (text.length <= MAX_OUTPUT_TEXT_CHARACTERS) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT_TEXT_CHARACTERS), truncated: true };
}

function normalizeFinishReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  if (["completed", "stop", "end_turn", "stop_sequence"].includes(reason)) return "stop";
  if (["length", "max_tokens", "max_output_tokens", "model_context_window_exceeded", "incomplete"].includes(reason)) {
    return "length";
  }
  if (["content_filter", "refusal"].includes(reason)) return "content_filter";
  if (["tool_calls", "tool_use"].includes(reason)) return "tool_call";
  if (["insufficient_system_resource", "overloaded", "overload"].includes(reason)) return "overload";
  return reason || "unknown";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      /^[0-9.]+$/.test(hostname) ||
      hostname.includes(":")
    ) return "";
    for (const key of url.searchParams.keys()) {
      if (/(?:api[_-]?key|access[_-]?token|auth|authorization|credential|password|secret|signature)/i.test(key)) {
        return "";
      }
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function safeIdentifier(value) {
  return safeText(value, 200).replace(/[\r\n\0]/g, " ") || null;
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, maxLength) : "";
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(pathname || "").replace(/^\/+/, "")}`;
}
