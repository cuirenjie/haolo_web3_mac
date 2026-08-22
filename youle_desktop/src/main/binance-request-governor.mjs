import fs from "node:fs";
import path from "node:path";

const WINDOW_MS = 60_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const DEFAULT_BAN_RETRY_AFTER_MS = 5 * 60_000;
const BINANCE_HOST_PATTERN = /(^|\.)binance\.com$/i;

export const BINANCE_REQUEST_PRIORITIES = Object.freeze({
  accountInteractive: 120,
  account: 100,
  chart: 90,
  market: 70,
  alert: 50,
  metadata: 20,
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function nowValue(now) {
  const value = typeof now === "function" ? now() : Date.now();
  return value instanceof Date ? value.getTime() : Number(value) || Date.now();
}

function requestUrl(input) {
  try {
    return new URL(typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || input));
  } catch {
    return null;
  }
}

export function isBinanceHttpUrl(input) {
  const url = requestUrl(input);
  return Boolean(url && /^https?:$/i.test(url.protocol) && BINANCE_HOST_PATTERN.test(url.hostname));
}

export function binanceRequestBucket(input) {
  const url = requestUrl(input);
  if (!url || !BINANCE_HOST_PATTERN.test(url.hostname)) return "other";
  return url.hostname.toLowerCase().startsWith("fapi.") || url.pathname.startsWith("/fapi/") || url.pathname.startsWith("/futures/")
    ? "futures"
    : "spot";
}

function depthWeight(limit, futures) {
  if (futures) {
    if (limit <= 50) return 2;
    if (limit <= 100) return 5;
    if (limit <= 500) return 10;
    return 20;
  }
  if (limit <= 100) return 5;
  if (limit <= 500) return 25;
  if (limit <= 1_000) return 50;
  return 250;
}

function futuresKlineWeight(limit) {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1_000) return 5;
  return 10;
}

// Conservative weights: overestimating is intentional because Binance accounts
// request weight by public IP, shared by every renderer and background service.
export function binanceRequestWeight(input, init = {}) {
  const url = requestUrl(input);
  if (!url || !BINANCE_HOST_PATTERN.test(url.hostname)) return 0;
  const pathname = url.pathname;
  const method = String(init?.method || "GET").toUpperCase();
  const hasSymbol = Boolean(url.searchParams.get("symbol"));
  const limit = positiveInteger(url.searchParams.get("limit"), 500);
  const futures = binanceRequestBucket(url) === "futures";

  if (pathname === "/sapi/v1/asset/wallet/balance") return 60;
  if (/\/fapi\/v\d+\/income$/.test(pathname)) return 30;
  if (/\/fapi\/v\d+\/(openOrders|openAlgoOrders)$/.test(pathname)) return hasSymbol ? 1 : 40;
  if (/\/fapi\/v\d+\/(account|positionRisk)$/.test(pathname)) return 5;
  if (/\/fapi\/v\d+\/userTrades$/.test(pathname)) return 5;
  if (/\/fapi\/v\d+\/aggTrades$/.test(pathname)) return 20;
  if (/\/fapi\/v\d+\/depth$/.test(pathname)) return depthWeight(limit, true);
  if (/\/api\/v3\/depth$/.test(pathname)) return depthWeight(limit, false);
  if (/\/fapi\/v\d+\/klines$/.test(pathname)) return futuresKlineWeight(limit);
  if (/\/api\/v3\/klines$/.test(pathname)) return 2;
  if (/\/(fapi\/v\d+|api\/v3)\/ticker\/24hr$/.test(pathname)) return hasSymbol ? 2 : 80;
  if (pathname === "/fapi/v1/exchangeInfo" || pathname === "/api/v3/exchangeInfo") return futures ? 1 : 20;
  if (method !== "GET" && pathname.includes("/listenKey")) return 1;
  return 1;
}

export function parseBinanceRetryAfterMs(response, currentMs = Date.now()) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - currentMs) : null;
}

function localRateLimitResponse(retryAfterMs, reason) {
  const safeRetryMs = Math.max(1_000, positiveInteger(retryAfterMs, DEFAULT_RETRY_AFTER_MS));
  return new Response(JSON.stringify({
    code: -1003,
    msg: reason === "upstream"
      ? "Binance shared cooldown is active."
      : "Binance local request-weight budget is exhausted.",
  }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.max(1, Math.ceil(safeRetryMs / 1_000))),
      "x-haolo-binance-governor": reason,
    },
  });
}

function responseCopy(response) {
  return typeof response?.clone === "function" ? response.clone() : response;
}

function abortReason(signal) {
  return signal?.reason || new DOMException("The operation was aborted", "AbortError");
}

function requestTimeoutError(timeoutMs) {
  const error = new Error(`Binance network request timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function runWithExecutionDeadline(networkFetch, input, init, timeoutMs) {
  const callerSignal = init?.signal;
  if (callerSignal?.aborted) throw abortReason(callerSignal);
  const durationMs = Number(timeoutMs);
  if ((!Number.isFinite(durationMs) || durationMs <= 0) && !callerSignal) {
    return networkFetch(input, init);
  }
  const controller = new AbortController();
  const forwardAbort = callerSignal
    ? () => controller.abort(abortReason(callerSignal))
    : null;
  if (forwardAbort) callerSignal.addEventListener("abort", forwardAbort, { once: true });
  let timer = null;
  let rejectAbort = null;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(abortReason(controller.signal));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  if (Number.isFinite(durationMs) && durationMs > 0) {
    timer = setTimeout(() => controller.abort(requestTimeoutError(Math.floor(durationMs))), Math.floor(durationMs));
    timer.unref?.();
  }
  try {
    return await Promise.race([
      Promise.resolve().then(() => networkFetch(input, { ...init, signal: controller.signal })),
      aborted,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    if (forwardAbort) callerSignal.removeEventListener("abort", forwardAbort);
  }
}

export class BinanceRequestGovernor {
  constructor({
    statePath = "",
    now = Date.now,
    maxConcurrency = 4,
    safetyRatio = 0.6,
    limits = {},
  } = {}) {
    this.statePath = String(statePath || "");
    this.now = now;
    this.maxConcurrency = Math.max(1, positiveInteger(maxConcurrency, 4));
    this.safetyRatio = Math.min(0.9, Math.max(0.1, Number(safetyRatio) || 0.6));
    this.limits = {
      futures: positiveInteger(limits.futures, 2_400),
      spot: positiveInteger(limits.spot, 6_000),
    };
    this.entries = new Map([["futures", []], ["spot", []]]);
    this.observedUsedWeight = new Map();
    this.bucketCooldownUntil = new Map();
    this.globalCooldownUntil = 0;
    this.queue = [];
    this.running = 0;
    this.sequence = 0;
    this.inflightPublicGets = new Map();
    this.metrics = { admitted: 0, coalesced: 0, blocked: 0, upstreamRateLimits: 0 };
    this.loadState();
  }

  loadState() {
    if (!this.statePath) return;
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      const value = Number(state?.globalCooldownUntil);
      if (Number.isFinite(value) && value > nowValue(this.now)) this.globalCooldownUntil = value;
    } catch {}
  }

  persistState() {
    if (!this.statePath) return;
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify({ version: 1, globalCooldownUntil: this.globalCooldownUntil }), "utf8");
    } catch {}
  }

  snapshot() {
    const currentMs = nowValue(this.now);
    return Object.freeze({
      ...this.metrics,
      running: this.running,
      queued: this.queue.length,
      globalCooldownRemainingMs: Math.max(0, this.globalCooldownUntil - currentMs),
      futuresWeight: this.usedWeight("futures", currentMs),
      spotWeight: this.usedWeight("spot", currentMs),
    });
  }

  usedWeight(bucket, currentMs = nowValue(this.now)) {
    const entries = this.entries.get(bucket) || [];
    while (entries.length && entries[0].at <= currentMs - WINDOW_MS) entries.shift();
    const reserved = entries.reduce((total, entry) => total + entry.weight, 0);
    const observed = this.observedUsedWeight.get(bucket);
    const observedValue = observed && observed.at > currentMs - WINDOW_MS ? observed.value : 0;
    return Math.max(reserved, observedValue);
  }

  budgetLimit(bucket) {
    return Math.max(1, Math.floor((this.limits[bucket] || this.limits.spot) * this.safetyRatio));
  }

  retryAfterForBudget(bucket, currentMs) {
    const entries = this.entries.get(bucket) || [];
    const observed = this.observedUsedWeight.get(bucket);
    const candidates = [];
    if (entries[0]) candidates.push(entries[0].at + WINDOW_MS);
    if (observed?.at > currentMs - WINDOW_MS) candidates.push(observed.at + WINDOW_MS);
    return Math.max(1_000, Math.min(...(candidates.length ? candidates : [currentMs + WINDOW_MS])) - currentMs);
  }

  reserve(bucket, weight, currentMs) {
    const used = this.usedWeight(bucket, currentMs);
    if (used + weight > this.budgetLimit(bucket)) return false;
    this.entries.get(bucket).push({ at: currentMs, weight });
    return true;
  }

  cooldownRemaining(bucket, currentMs) {
    return Math.max(0, this.globalCooldownUntil, this.bucketCooldownUntil.get(bucket) || 0) - currentMs;
  }

  setUpstreamCooldown(until) {
    if (until <= this.globalCooldownUntil) return;
    this.globalCooldownUntil = until;
    this.persistState();
  }

  observeResponse(bucket, response, currentMs) {
    const usedHeader = response?.headers?.get?.("x-mbx-used-weight-1m")
      || response?.headers?.get?.("x-sapi-used-ip-weight-1m")
      || response?.headers?.get?.("x-mbx-used-weight");
    const used = Number(usedHeader);
    if (Number.isFinite(used) && used >= 0) {
      this.observedUsedWeight.set(bucket, { at: currentMs, value: used });
      if (used >= this.budgetLimit(bucket)) this.bucketCooldownUntil.set(bucket, currentMs + WINDOW_MS);
    }
    const status = Number(response?.status || 0);
    if (status === 429 || status === 418) {
      const retryAfterMs = parseBinanceRetryAfterMs(response, currentMs)
        ?? (status === 418 ? DEFAULT_BAN_RETRY_AFTER_MS : DEFAULT_RETRY_AFTER_MS);
      this.metrics.upstreamRateLimits += 1;
      this.setUpstreamCooldown(currentMs + Math.max(1_000, retryAfterMs));
    }
  }

  enqueue(run, priority, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const task = {
        run,
        priority: Number(priority) || 0,
        sequence: this.sequence++,
        resolve,
        reject,
        signal,
        abortQueued: null,
      };
      task.abortQueued = signal
        ? () => {
          const index = this.queue.indexOf(task);
          if (index < 0) return;
          this.queue.splice(index, 1);
          signal.removeEventListener("abort", task.abortQueued);
          reject(abortReason(signal));
        }
        : null;
      if (task.abortQueued) signal.addEventListener("abort", task.abortQueued, { once: true });
      this.queue.push(task);
      this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      this.pump();
    });
  }

  pump() {
    while (this.running < this.maxConcurrency && this.queue.length) {
      const task = this.queue.shift();
      if (task.abortQueued) task.signal.removeEventListener("abort", task.abortQueued);
      this.running += 1;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  async fetch(networkFetch, input, init = {}, context = {}) {
    if (typeof networkFetch !== "function") throw new TypeError("networkFetch must be a function");
    if (!isBinanceHttpUrl(input)) return networkFetch(input, init);
    const url = requestUrl(input);
    const bucket = binanceRequestBucket(url);
    const currentMs = nowValue(this.now);
    const cooldownMs = this.cooldownRemaining(bucket, currentMs);
    if (cooldownMs > 0) {
      this.metrics.blocked += 1;
      return localRateLimitResponse(cooldownMs, "upstream");
    }

    const method = String(init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers || {});
    const isPublicGet = method === "GET" && !headers.has("x-mbx-apikey");
    const dedupeKey = isPublicGet ? `${method} ${url.href}` : "";
    const pending = dedupeKey ? this.inflightPublicGets.get(dedupeKey) : null;
    if (pending) {
      this.metrics.coalesced += 1;
      return awaitWithSignal(pending.then(responseCopy), init?.signal);
    }

    const weight = Math.max(1, positiveInteger(context.weight, binanceRequestWeight(url, init)));
    if (!this.reserve(bucket, weight, currentMs)) {
      this.metrics.blocked += 1;
      return localRateLimitResponse(this.retryAfterForBudget(bucket, currentMs), "budget");
    }

    this.metrics.admitted += 1;
    const request = this.enqueue(async () => {
      const response = await runWithExecutionDeadline(networkFetch, input, init, context.timeoutMs);
      this.observeResponse(bucket, response, nowValue(this.now));
      return response;
    }, context.priority ?? BINANCE_REQUEST_PRIORITIES.market, init?.signal);
    if (dedupeKey) this.inflightPublicGets.set(dedupeKey, request);
    try {
      return responseCopy(await request);
    } finally {
      if (dedupeKey && this.inflightPublicGets.get(dedupeKey) === request) this.inflightPublicGets.delete(dedupeKey);
    }
  }
}
