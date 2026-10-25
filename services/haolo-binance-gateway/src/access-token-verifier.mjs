import crypto from "node:crypto";
import { GatewayAuthError } from "./auth.mjs";
import { profileMarketEntitlement } from "./market-routing.mjs";
import { TrafficIdentityObserver } from "./traffic-identity.mjs";

function tokenCacheKey(token) {
  return `auth-token:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function tokenRemainingLifetimeMs(token, now = Date.now()) {
  const parts = String(token || "").split(".");
  const payloadSegment = parts.length === 2 ? parts[0] : parts.length === 3 ? parts[1] : "";
  if (!payloadSegment) return Number.POSITIVE_INFINITY;
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    const expiryMs = Number(payload?.exp) * 1_000;
    return Number.isFinite(expiryMs) ? Math.max(0, expiryMs - now) : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function authenticationUnavailable(kind, dependencyStatus = 0) {
  const error = new GatewayAuthError("Haolo authentication service unavailable", 503);
  error.code = "AUTHENTICATION_UNAVAILABLE";
  error.dependency = "haolo-auth";
  error.failureKind = kind;
  error.dependencyStatus = dependencyStatus;
  error.retryAfterMs = 1_000;
  return error;
}

export class HaoloAccessTokenVerifier {
  constructor({ config, cache, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.trafficIdentity = new TrafficIdentityObserver({ origin: config.authApiOrigin, fetchImpl });
  }

  async verify(token) {
    const compact = String(token || "").trim();
    if (!compact) throw new GatewayAuthError("authentication required");
    const key = tokenCacheKey(compact);
    const cached = await this.cache.get(key);
    if (cached?.fresh && cached.value?.userId) {
      this.trafficIdentity.observe(cached.value.userId, compact);
      return Object.freeze(cached.value);
    }
    return this.cache.singleFlight(key, async () => {
      const secondRead = await this.cache.get(key);
      if (secondRead?.fresh && secondRead.value?.userId) {
        this.trafficIdentity.observe(secondRead.value.userId, compact);
        return Object.freeze(secondRead.value);
      }
      const controller = new AbortController();
      const startedAt = Date.now();
      let timeout;
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = authenticationUnavailable("timeout");
          controller.abort(error);
          reject(error);
        }, this.config.authRequestTimeoutMs);
      });
      timeout.unref?.();
      let response, profile;
      try {
        profile = await Promise.race([deadline, (async () => {
          response = await this.fetchImpl(`${this.config.authApiOrigin}${this.config.authProfilePath}`, {
            method: "GET",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${compact}`,
              "user-agent": "haolo-binance-gateway/1.0",
            },
            redirect: "error",
            signal: controller.signal,
          });
          if ([401, 403, 404].includes(response.status)) {
            throw new GatewayAuthError("invalid or expired Haolo access token");
          }
          if (!response.ok) throw authenticationUnavailable("upstream-status", response.status);
          try { return await response.json(); }
          catch {
            if (controller.signal.aborted) throw controller.signal.reason;
            throw authenticationUnavailable("invalid-response", response.status);
          }
        })()]);
      } catch (error) {
        // Abort covers headers AND body; never leave a hung JSON read waiting
        // for HAProxy's much longer timeout. Do not log bearer/profile content.
        controller.abort();
        void response?.body?.cancel?.().catch(() => {});
        const failure = error instanceof GatewayAuthError ? error : authenticationUnavailable("network");
        failure.dependencyElapsedMs = Date.now() - startedAt;
        throw failure;
      } finally {
        clearTimeout(timeout);
      }
      const userId = String(profile?.id || profile?.user_id || profile?.userId || profile?.user?.id || "").trim();
      if (!userId || userId.length > 128) throw authenticationUnavailable("invalid-profile", response.status);
      const identity = Object.freeze({ userId, payload: null, ...profileMarketEntitlement(profile) });
      this.trafficIdentity.observe(userId, compact);
      const remainingMs = tokenRemainingLifetimeMs(compact);
      const ttlMs = Math.min(this.config.authCacheTtlMs, remainingMs,
        identity.membershipExpiresAt ? Math.max(0, identity.membershipExpiresAt - Date.now()) : Infinity);
      if (ttlMs >= 1_000) await this.cache.set(key, identity, ttlMs, ttlMs);
      return identity;
    });
  }
}
