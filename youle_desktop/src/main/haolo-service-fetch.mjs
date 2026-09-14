import { isReadOnlyRequest, isRecoverableNetworkError, networkErrorCode, withAbort } from "./system-proxy-fetch.mjs";

export const HAOLO_SERVICE_ORIGIN = "https://haolo.com";
// Both names terminate at the same verified HaoLo account backend. Keep the
// canonical account URL in settings; never reuse model/invitation hosts or IPs.
export const HAOLO_SERVICE_FALLBACK_ORIGINS = Object.freeze(["https://www.haolo.com"]);

class ServiceProbeHttpError extends Error {
  constructor(status, retryAfterMs) {
    super(`Account route probe returned HTTP ${status}`);
    this.retryAfterMs = retryAfterMs;
  }
}

function probeCooldownMs(retryAfter, nowMs, fallbackMs) {
  const value = String(retryAfter || "").trim();
  const seconds = value ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000 : Date.parse(value) - nowMs;
  return Math.max(fallbackMs, Number.isFinite(delay) ? Math.max(0, Math.ceil(delay)) : 0);
}

// Keep the timeout alive until the JSON body finishes, not just until headers.
export async function fetchServiceJson(fetchImpl, url, init = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  if (signal.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await withAbort(fetchImpl(url, { ...init, signal }), signal);
    const payload = await withAbort(response.json(), signal);
    return { response, payload };
  } finally { clearTimeout(timer); }
}

export function createHaoloServiceFetch({
  fetchImpl,
  primaryOrigin = HAOLO_SERVICE_ORIGIN,
  fallbackOrigins = HAOLO_SERVICE_FALLBACK_ORIGINS,
  probeTimeoutMs = 3_500,
  routeTtlMs = 60_000,
  failureCooldownMs = 3_000,
  now = Date.now,
  onDiagnostic = () => {},
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const origins = [...new Set([primaryOrigin, ...fallbackOrigins].map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new TypeError("Service origins must be credential-free HTTPS origins");
    }
    return url.origin;
  }))];
  const canonical = origins[0];
  let route = null;
  let selection = null;
  let failure = null;
  const probeFailures = new Map();

  function note(event, origin, error) {
    try { onDiagnostic({ event, origin, ...(error ? { code: networkErrorCode(error) || "ROUTE_UNAVAILABLE" } : {}) }); } catch {}
  }

  function remember(origin) {
    if (!route || route.origin !== origin || route.expiresAt <= now()) {
      route = { origin, expiresAt: now() + routeTtlMs };
    }
    failure = null;
  }

  async function probe(origin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Route probe timed out", "TimeoutError")), probeTimeoutMs);
    try {
      const response = await fetchImpl(`${origin}/api/auth/config`, {
        method: "GET", headers: { Accept: "application/json" },
        credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel?.();
        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          throw new ServiceProbeHttpError(response.status,
            probeCooldownMs(response.headers?.get?.("retry-after"), now(), failureCooldownMs));
        }
        throw new Error(`Account route probe returned HTTP ${response.status}`);
      }
      const config = await response.json();
      if (!Array.isArray(config?.enabled_channels) || typeof config?.default_channel !== "string") {
        throw new Error("Account route probe returned an unexpected response");
      }
    } catch (error) {
      // Electron may report net::ERR_ABORTED instead of the signal's reason.
      // Preserve the probe timeout so another reachable origin can be tried.
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function selectRoute(excludeOrigin) {
    if (route && route.expiresAt > now() && route.origin !== excludeOrigin) return route.origin;
    if (failure && failure.expiresAt > now()) throw failure.error;
    // One anonymous probe chain serves concurrent account requests. A caller's
    // cancellation does not abort the probes needed by other callers.
    if (selection) {
      await selection;
      return selectRoute(excludeOrigin);
    }
    selection = (async () => {
      let lastError = new Error("No reachable HaoLo account route");
      for (const origin of origins.filter((candidate) => candidate !== excludeOrigin)) {
        const cooling = probeFailures.get(origin);
        if (cooling && cooling.expiresAt > now()) {
          lastError = cooling.error;
          continue;
        }
        probeFailures.delete(origin);
        try {
          await probe(origin);
          remember(origin);
          note("service-route-selected", origin);
          return origin;
        } catch (error) {
          lastError = error;
          note("service-route-probe-failed", origin, error);
          if (error instanceof ServiceProbeHttpError) {
            // Cool only this anonymous probe. A verified alias may still serve
            // business traffic; HTTP business responses are never replayed here.
            probeFailures.set(origin, { error, expiresAt: now() + error.retryAfterMs });
            continue;
          }
          if (!isRecoverableNetworkError(error) && error?.name !== "TimeoutError") throw error;
        }
      }
      route = null;
      failure = { error: lastError, expiresAt: now() + failureCooldownMs };
      throw lastError;
    })();
    try { return await selection; } finally { selection = null; }
  }

  function routedUrl(url, origin) {
    return `${origin}${url.pathname}${url.search}`;
  }

  return async function haoloServiceFetch(input, init = {}) {
    const url = new URL(input);
    // Custom/local servers and external downloads never receive HaoLo aliases.
    if (url.origin !== canonical || !url.pathname.startsWith("/api/") || url.username || url.password) {
      return fetchImpl(input, init);
    }
    const signal = init.signal;
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const readOnly = isReadOnlyRequest(input, init);
    // Select with anonymous GETs before a cold write. A failed write is never
    // replayed across routes: sending OTPs or creating orders may have succeeded.
    const origin = await withAbort(selectRoute(), signal);
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    try {
      const response = await fetchImpl(routedUrl(url, origin), init);
      remember(origin);
      return response;
    } catch (error) {
      if (signal?.aborted || !isRecoverableNetworkError(error)) throw error;
      if (route?.origin === origin) route = null;
      note("service-route-failed", origin, error);
      if (!readOnly || origins.length < 2) throw error;
      let alternate;
      try { alternate = await withAbort(selectRoute(origin), signal); }
      catch (selectionError) { if (signal?.aborted) throw selectionError; throw error; }
      if (signal?.aborted) throw signal.reason || error;
      try {
        return await fetchImpl(routedUrl(url, alternate), init);
      } catch (alternateError) {
        if (route?.origin === alternate) route = null;
        throw alternateError;
      }
    }
  };
}
