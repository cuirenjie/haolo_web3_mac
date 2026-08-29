import { getExternalModelProvider, normalizeExternalModelProviderId } from "./provider-registry.mjs";
import {
  ExternalModelInvocationError,
  invokeReadOnlyExternalModel,
} from "./adapter.mjs";
import { prepareReadOnlyInvocation } from "./read-only-policy.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BILLABLE_TEST_COOLDOWN_MS = 10_000;
const MAX_CONNECTION_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_DETAIL_LENGTH = 400;

export class ExternalModelServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ExternalModelServiceError";
    this.code = code;
    this.status = options.status || null;
    this.provider = options.provider || null;
  }
}

export class ExternalModelService {
  constructor({
    credentialStore,
    fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    billableTestCooldownMs = DEFAULT_BILLABLE_TEST_COOLDOWN_MS,
    now = () => new Date(),
    readOnlyInvoker = invokeReadOnlyExternalModel,
  } = {}) {
    if (!credentialStore) throw new Error("credentialStore is required");
    if (typeof fetch !== "function") throw new Error("fetch is required");
    if (typeof readOnlyInvoker !== "function") throw new Error("readOnlyInvoker is required");
    this.credentialStore = credentialStore;
    this.fetch = fetch;
    this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
    this.billableTestCooldownMs = nonNegativeInteger(
      billableTestCooldownMs,
      DEFAULT_BILLABLE_TEST_COOLDOWN_MS,
    );
    this.now = now;
    this.readOnlyInvoker = readOnlyInvoker;
    this.connectionTests = new Map();
    this.preparedInvocations = new WeakSet();
  }

  async listProviders() {
    return { providers: await this.credentialStore.listStatus() };
  }

  async saveProvider(params = {}) {
    const provider = await this.credentialStore.upsert(params);
    this.invalidateConnectionTest(params?.provider);
    return { provider };
  }

  async removeProvider(providerValue) {
    const provider = await this.credentialStore.remove(providerValue);
    this.invalidateConnectionTest(providerValue);
    return { provider };
  }

  async testConnection(providerValue) {
    const providerId = normalizeExternalModelProviderId(providerValue);
    const publicProvider = getExternalModelProvider(providerId);
    if (!publicProvider) throw new ExternalModelServiceError("UNKNOWN_PROVIDER", "未知的外部模型供应商。");
    const cached = this.connectionTests.get(providerId);
    if (cached?.inFlight || (publicProvider.connectionTest.billable && cached?.expiresAt > this.nowMs())) {
      return cached.promise;
    }
    if (cached) this.connectionTests.delete(providerId);

    const entry = {
      inFlight: true,
      expiresAt: 0,
      promise: this.performConnectionTest(providerId, publicProvider),
    };
    this.connectionTests.set(providerId, entry);
    entry.promise.then(
      () => this.settleConnectionTest(providerId, publicProvider, entry),
      () => this.settleConnectionTest(providerId, publicProvider, entry),
    );
    return entry.promise;
  }

  prepareReadOnly(params = {}) {
    // The policy layer must run before provider credentials are resolved. It also
    // owns the system prompt, text-only contract, data classification and budgets.
    const invocation = prepareReadOnlyInvocation(params);
    const providerId = normalizeExternalModelProviderId(invocation.provider);
    if (!getExternalModelProvider(providerId)) {
      throw new ExternalModelServiceError("UNKNOWN_PROVIDER", "未知的外部模型供应商。");
    }
    const prepared = Object.freeze({
      ...invocation,
      provider: providerId,
      messages: Object.freeze(invocation.messages.map((message) => Object.freeze({ ...message }))),
      budget: Object.freeze({ ...invocation.budget }),
    });
    this.preparedInvocations.add(prepared);
    return prepared;
  }

  async invokePreparedReadOnly(invocation, { signal } = {}) {
    if (!invocation || typeof invocation !== "object" || !this.preparedInvocations.has(invocation)) {
      throw new ExternalModelServiceError(
        "INVOCATION_NOT_PREPARED",
        "外部模型只读调用必须先通过 Haolo 安全策略检查。",
      );
    }
    if (signal?.aborted) throw invocationCancelled(invocation.provider);
    const credential = await this.credentialStore.resolve(invocation.provider);
    if (signal?.aborted) throw invocationCancelled(invocation.provider);
    return this.readOnlyInvoker({
      credential,
      invocation,
      fetch: this.fetch,
      signal,
    });
  }

  async invokeReadOnly(params = {}, options = {}) {
    const invocation = this.prepareReadOnly(params);
    return this.invokePreparedReadOnly(invocation, options);
  }

  invalidateConnectionTest(providerValue) {
    const providerId = normalizeExternalModelProviderId(providerValue);
    if (providerId) this.connectionTests.delete(providerId);
  }

  settleConnectionTest(providerId, provider, entry) {
    if (this.connectionTests.get(providerId) !== entry) return;
    entry.inFlight = false;
    if (provider.connectionTest.billable && this.billableTestCooldownMs > 0) {
      entry.expiresAt = this.nowMs() + this.billableTestCooldownMs;
    } else {
      this.connectionTests.delete(providerId);
    }
  }

  nowMs() {
    const value = this.now();
    const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  }

  async performConnectionTest(providerId, publicProvider) {
    const credential = await this.credentialStore.resolve(providerId);
    const request = buildConnectionTestRequest(credential);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetch(request.url, {
        ...request.init,
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      const responsePayload = await readConnectionResponse(response, controller, publicProvider);
      if (!response?.ok) {
        const detail = readSafeErrorDetail(responsePayload, credential.apiKey);
        throw httpError(publicProvider, response?.status, detail);
      }
      const modelVerified = publicProvider.id === "perplexity"
        ? true
        : inspectModelAvailability(responsePayload.payload, credential.model);
      return {
        ok: true,
        provider: providerId,
        model: credential.model,
        baseUrlProfile: credential.baseUrlProfile,
        testedAt: this.now().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        billable: Boolean(publicProvider.connectionTest.billable),
        modelVerified,
      };
    } catch (error) {
      if (error instanceof ExternalModelServiceError) throw error;
      if (controller.signal.aborted || error?.name === "AbortError") {
        throw new ExternalModelServiceError(
          "CONNECTION_TIMEOUT",
          `${publicProvider.displayName} 连接测试超时，请检查网络、地区可用性和 API 站点。`,
          { provider: providerId },
        );
      }
      throw new ExternalModelServiceError(
        "CONNECTION_FAILED",
        `${publicProvider.displayName} 连接失败，请检查网络和 API 站点。`,
        { provider: providerId },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildConnectionTestRequest({ provider, apiKey, model, baseUrl }) {
  const test = provider.connectionTest;
  const url = joinUrl(baseUrl, test.path);
  const headers = authenticationHeaders(provider, apiKey);
  const init = { method: test.method, headers };
  if (provider.id === "perplexity") {
    init.headers = { ...headers, "content-type": "application/json" };
    init.body = JSON.stringify({
      model: model || "sonar",
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 1,
    });
  }
  return { url, init };
}

function inspectModelAvailability(payload, model) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const hasModelCollection = Array.isArray(payload?.data) || Array.isArray(payload?.models);
  const candidates = [
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.models) ? payload.models : []),
  ];
  const ids = candidates
    .map((item) => typeof item === "string" ? item : item?.id || item?.name || "")
    .map(normalizeModelId)
    .filter(Boolean);
  if (!hasModelCollection) return null;
  return ids.includes(normalizeModelId(model));
}

function normalizeModelId(value) {
  return String(value || "").trim().replace(/^models\//, "");
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

function httpError(provider, status, detail) {
  const suffix = detail ? `：${detail}` : "";
  if (status === 401 || status === 403) {
    return new ExternalModelServiceError(
      "AUTHENTICATION_FAILED",
      `${provider.displayName} 鉴权失败，请确认 Key、所属站点、权限和账号状态${suffix}`,
      { provider: provider.id, status },
    );
  }
  if (status === 429) {
    return new ExternalModelServiceError(
      "RATE_LIMITED",
      `${provider.displayName} 返回限流或额度不足，请检查余额、账单和速率限制${suffix}`,
      { provider: provider.id, status },
    );
  }
  if (status === 404) {
    return new ExternalModelServiceError(
      "ENDPOINT_NOT_FOUND",
      `${provider.displayName} 接口不存在，请检查 API 站点与模型配置${suffix}`,
      { provider: provider.id, status },
    );
  }
  return new ExternalModelServiceError(
    "PROVIDER_HTTP_ERROR",
    `${provider.displayName} 连接测试失败（HTTP ${status || "未知"}）${suffix}`,
    { provider: provider.id, status },
  );
}

function readSafeErrorDetail({ text, payload }, apiKey) {
  const detail = payload?.error?.message || payload?.message || payload?.detail || text || "";
  const sanitized = redactSecret(String(detail || ""), apiKey)
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return sanitized.slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function redactSecret(value, secret) {
  const normalizedSecret = String(secret || "");
  let result = normalizedSecret ? value.replaceAll(normalizedSecret, "[REDACTED]") : value;
  result = result
    .replace(/\b(?:sk-ant-|sk-|pplx-|xai-|tp-)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{12,}\b/g, "[REDACTED]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi, "Authorization: [REDACTED]");
  return result;
}

async function readConnectionResponse(response, controller, provider) {
  if (!response?.body && typeof response?.text !== "function" && typeof response?.json === "function") {
    const payload = await response.json();
    const text = JSON.stringify(payload ?? null);
    if (Buffer.byteLength(text, "utf8") > MAX_CONNECTION_RESPONSE_BYTES) {
      controller?.abort(new Error("external model connection-test response too large"));
      throw responseTooLarge(provider, response?.status);
    }
    return { text, payload };
  }
  const text = await readResponseTextWithLimit(response, MAX_CONNECTION_RESPONSE_BYTES, controller, provider);
  if (!text.trim()) return { text: "", payload: null };
  try {
    return { text, payload: JSON.parse(text) };
  } catch {
    return { text, payload: null };
  }
}

async function readResponseTextWithLimit(response, maxBytes, controller, provider) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    const text = String(await response?.text?.() || "");
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      controller?.abort(new Error("external model connection-test response too large"));
      throw responseTooLarge(provider, response?.status);
    }
    return text;
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
        controller?.abort(new Error("external model connection-test response too large"));
        await reader.cancel().catch(() => {});
        throw responseTooLarge(provider, response?.status);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

function responseTooLarge(provider, status) {
  return new ExternalModelServiceError(
    "PROVIDER_RESPONSE_TOO_LARGE",
    `${provider.displayName} 连接测试响应超过 Haolo 的安全大小限制。`,
    { provider: provider.id, status },
  );
}

function invocationCancelled(providerId) {
  const provider = getExternalModelProvider(providerId);
  return new ExternalModelInvocationError(
    "INVOCATION_CANCELLED",
    `${provider?.displayName || "外部模型"} 只读调用已取消。`,
    { provider: provider?.id || providerId || null },
  );
}

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(pathname || "").replace(/^\/+/, "")}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
