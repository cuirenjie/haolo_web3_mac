import crypto from "node:crypto";
import { GatewayAuthError } from "./auth.mjs";

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
function authenticationUnavailable(message = "Haolo authentication service unavailable") {
  const error = new GatewayAuthError(message, 503);
  error.code = "AUTHENTICATION_UNAVAILABLE";
  return error;
}

export class HaoloAccessTokenVerifier {
  constructor({ config, cache, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
  }

  async verify(token) {
    const compact = String(token || "").trim();
    if (!compact) throw new GatewayAuthError("authentication required");
    const key = tokenCacheKey(compact);
    const cached = await this.cache.get(key);
    if (cached?.fresh && cached.value?.userId) return Object.freeze(cached.value);
    return this.cache.singleFlight(key, async () => {
      const secondRead = await this.cache.get(key);
      if (secondRead?.fresh && secondRead.value?.userId) return Object.freeze(secondRead.value);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.authRequestTimeoutMs);
      timeout.unref?.();
      let response;
      try {
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
      } catch (error) {
        if (error instanceof GatewayAuthError) throw error;
        throw authenticationUnavailable();
      } finally {
        clearTimeout(timeout);
      }
      if ([401, 403, 404].includes(response.status)) {
        throw new GatewayAuthError("invalid or expired Haolo access token");
      }
      if (!response.ok) throw authenticationUnavailable();
      let profile;
      try { profile = await response.json(); } catch { throw authenticationUnavailable(); }
      const userId = String(profile?.id || profile?.user_id || profile?.userId || profile?.user?.id || "").trim();
      if (!userId || userId.length > 128) throw authenticationUnavailable("Haolo authentication response is invalid");
      const identity = Object.freeze({ userId, payload: null });
      const remainingMs = tokenRemainingLifetimeMs(compact);
      const ttlMs = Math.min(this.config.authCacheTtlMs, remainingMs);
      if (ttlMs >= 1_000) await this.cache.set(key, identity, ttlMs, ttlMs);
      return identity;
    });
  }
}
