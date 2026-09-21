import crypto from "node:crypto";
import { signPrivateEgressPermit } from "./auth.mjs";

const MINUTE_MS = 60_000;
const MAX_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1_000;

const PRIVATE_ROUTES = Object.freeze([
  Object.freeze({ marketType: "spot", pattern: /^\/api\/v3\/time$/, weight: 1, priority: "core" }),
  Object.freeze({ marketType: "spot", pattern: /^\/sapi\/v1\/asset\/wallet\/balance$/, weight: 60, priority: "background" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v1\/time$/, weight: 1, priority: "core" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v3\/account$/, weight: 5, priority: "core" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v[23]\/positionRisk$/, weight: 5, priority: "core" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v1\/income$/, weight: 30, priority: "background" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v1\/(openOrders|openAlgoOrders)$/, weight: ({ hasSymbol }) => hasSymbol ? 1 : 40, priority: "background" }),
  Object.freeze({ marketType: "futures", pattern: /^\/fapi\/v1\/userTrades$/, weight: 5, priority: "background" }),
]);

const TARGET_HOSTS = Object.freeze({
  spot: "api.binance.com",
  futures: "fapi.binance.com",
});

export class PrivateEgressError extends Error {
  constructor(message, { statusCode = 400, code = "PRIVATE_EGRESS_REJECTED", retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "PrivateEgressError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function classifyPrivateRoute(value = {}) {
  const marketType = String(value.marketType || "").trim().toLowerCase();
  const pathname = String(value.pathname || "").trim();
  const hasSymbol = value.hasSymbol === true;
  const method = String(value.method || "GET").toUpperCase();
  if (method === "DELETE" && marketType === "futures"
      && (pathname === "/fapi/v1/algoOrder" || (pathname === "/fapi/v1/order" && hasSymbol))) {
    return Object.freeze({ marketType, pathname, hasSymbol, method, weight: 1, priority: "core", targetHost: TARGET_HOSTS.futures });
  }
  if (method !== "GET") {
    throw new PrivateEgressError("private Binance method is not allowed", { statusCode: 403, code: "PRIVATE_ROUTE_FORBIDDEN" });
  }
  if (!["spot", "futures"].includes(marketType) || !pathname.startsWith("/") || pathname.includes("?") || pathname.length > 160) {
    throw new PrivateEgressError("invalid private route metadata", { code: "INVALID_PRIVATE_ROUTE" });
  }
  const route = PRIVATE_ROUTES.find((entry) => entry.marketType === marketType && entry.pattern.test(pathname));
  if (!route) throw new PrivateEgressError("private Binance route is not allowed", { statusCode: 403, code: "PRIVATE_ROUTE_FORBIDDEN" });
  const weight = typeof route.weight === "function" ? route.weight({ hasSymbol }) : route.weight;
  return Object.freeze({
    marketType,
    pathname,
    hasSymbol,
    weight,
    priority: route.priority,
    targetHost: TARGET_HOSTS[marketType],
  });
}

function currentTimeMs(now) {
  const value = typeof now === "function" ? now() : Date.now();
  return value instanceof Date ? value.getTime() : Number(value) || Date.now();
}

function retryAfterFromReport(status, value) {
  const supplied = Math.max(0, Math.trunc(Number(value) || 0));
  const fallback = status === 418 ? 5 * 60_000 : 60_000;
  return Math.min(MAX_COOLDOWN_MS, Math.max(1_000, supplied || fallback));
}

export class PrivateEgressCoordinator {
  constructor({ config, cache, now = Date.now } = {}) {
    if (!config || !cache) throw new TypeError("config and cache are required");
    this.config = config;
    this.cache = cache;
    this.now = now;
    this.shards = Object.freeze((config.privateEgressShards || []).filter((shard) => shard.enabled));
    if (!this.shards.length) throw new TypeError("at least one enabled private egress shard is required");
    this.metrics = { permitsIssued: 0, permitsRejected: 0, usageReports: 0, upstreamCooldowns: 0 };
  }

  ready() {
    return !this.config.production || this.cache.redis?.isReady === true;
  }

  shardScore(userId, shardId) {
    const digest = crypto.createHmac("sha256", this.config.privateShardHashSecret || this.config.jwtSecret).update(`${userId}\0${shardId}`).digest();
    return digest.readBigUInt64BE(0);
  }

  selectShard(userId) {
    let selected = this.shards[0];
    let bestScore = this.shardScore(userId, selected.id);
    for (const shard of this.shards.slice(1)) {
      const score = this.shardScore(userId, shard.id);
      if (score > bestScore) {
        selected = shard;
        bestScore = score;
      }
    }
    return selected;
  }

  cooldownKey(shardId, marketType) {
    return `private-cooldown:${shardId}:${marketType}`;
  }

  async issuePermit(identity, metadata) {
    if (!identity?.userId) throw new PrivateEgressError("authentication required", { statusCode: 401, code: "AUTHENTICATION_REQUIRED" });
    if (!this.ready()) throw new PrivateEgressError("private egress coordinator is not ready", { statusCode: 503, code: "COORDINATOR_NOT_READY", retryAfterMs: 5_000 });
    const route = classifyPrivateRoute(metadata);
    const shard = this.selectShard(identity.userId);
    const nowMs = currentTimeMs(this.now);
    const cooldown = await this.cache.get(this.cooldownKey(shard.id, route.marketType), nowMs);
    if (Number(cooldown?.value?.until || 0) > nowMs) {
      this.metrics.permitsRejected += 1;
      throw new PrivateEgressError("assigned private egress shard is cooling down", {
        statusCode: 429,
        code: "EGRESS_UPSTREAM_COOLDOWN",
        retryAfterMs: Number(cooldown.value.until) - nowMs,
      });
    }
    const officialLimit = route.marketType === "futures"
      ? shard.futuresWeightLimitPerMinute
      : shard.spotWeightLimitPerMinute;
    const totalLimit = Math.max(1, Math.floor(officialLimit * this.config.privateTotalSafetyPercent / 100));
    const backgroundLimit = Math.max(1, Math.floor(officialLimit * this.config.privateBackgroundSafetyPercent / 100));
    const windowId = Math.floor(nowMs / MINUTE_MS);
    const ttlMs = MINUTE_MS - (nowMs % MINUTE_MS) + 5_000;
    const userKey = crypto.createHash("sha256").update(identity.userId).digest("hex").slice(0, 32);
    const userLimit = route.marketType === "futures"
      ? this.config.privateUserFuturesWeightPerMinute
      : this.config.privateUserSpotWeightPerMinute;
    const budget = await this.cache.consumeWeightBudget({
      shardId: shard.id,
      marketType: route.marketType,
      windowId,
      weight: route.weight,
      totalLimit,
      backgroundLimit,
      background: route.priority === "background",
      userKey,
      userLimit,
      ttlMs,
    });
    if (!budget.allowed) {
      this.metrics.permitsRejected += 1;
      throw new PrivateEgressError("assigned private egress shard weight budget is exhausted", {
        statusCode: 429,
        code: budget.rejectedBy === "user"
          ? "EGRESS_USER_BUDGET_EXHAUSTED"
          : budget.rejectedBy === "background"
            ? "EGRESS_BACKGROUND_BUDGET_EXHAUSTED"
            : "EGRESS_TOTAL_BUDGET_EXHAUSTED",
        retryAfterMs: budget.retryAfterMs,
      });
    }
    const permitId = crypto.randomBytes(18).toString("base64url");
    const permitRecord = Object.freeze({
      userId: identity.userId,
      permitId,
      shardId: shard.id,
      targetHost: route.targetHost,
      marketType: route.marketType,
      priority: route.priority,
      weight: route.weight,
    });
    const permitToken = signPrivateEgressPermit(permitRecord, this.config, Math.floor(nowMs / 1_000));
    const permitTtlMs = Number(this.config.privatePermitTtlMs || 15_000);
    await Promise.all([
      this.cache.set(`private-permit:${permitId}`, permitRecord, permitTtlMs, permitTtlMs),
      this.cache.set(`private-report:${permitId}`, permitRecord, permitTtlMs + 120_000, permitTtlMs + 120_000),
    ]);
    this.metrics.permitsIssued += 1;
    return Object.freeze({
      permitId,
      permitToken,
      expiresInMs: permitTtlMs,
      shardId: shard.id,
      proxyUrl: shard.proxyUrl,
      targetHost: route.targetHost,
      marketType: route.marketType,
      priority: route.priority,
      weight: route.weight,
      budget: Object.freeze({ totalLimit, backgroundLimit }),
    });
  }

  async reportUsage(identity, report = {}) {
    const permitId = String(report.permitId || "").trim();
    if (!identity?.userId || !/^[A-Za-z0-9_-]{20,64}$/.test(permitId)) {
      throw new PrivateEgressError("invalid private egress usage report", { code: "INVALID_USAGE_REPORT" });
    }
    const receipt = await this.cache.take(`private-report:${permitId}`);
    if (!receipt || receipt.userId !== identity.userId) {
      throw new PrivateEgressError("private egress usage report is expired", { statusCode: 409, code: "USAGE_REPORT_EXPIRED" });
    }
    const nowMs = currentTimeMs(this.now);
    const status = Math.trunc(Number(report.status) || 0);
    const usedWeight1m = Math.max(0, Math.min(10_000_000, Math.trunc(Number(report.usedWeight1m) || 0)));
    if (usedWeight1m > 0) {
      const windowId = Math.floor(nowMs / MINUTE_MS);
      const ttlMs = MINUTE_MS - (nowMs % MINUTE_MS) + 5_000;
      await this.cache.raiseWeightFloor({
        shardId: receipt.shardId,
        marketType: receipt.marketType,
        windowId,
        value: usedWeight1m,
        ttlMs,
      });
    }
    let cooldownUntil = 0;
    if (status === 429 || status === 418) {
      const retryAfterMs = retryAfterFromReport(status, report.retryAfterMs);
      cooldownUntil = nowMs + retryAfterMs;
      await this.cache.set(
        this.cooldownKey(receipt.shardId, receipt.marketType),
        { until: cooldownUntil, status },
        retryAfterMs,
        retryAfterMs,
      );
      this.metrics.upstreamCooldowns += 1;
    }
    this.metrics.usageReports += 1;
    return Object.freeze({ accepted: true, cooldownUntil });
  }
}

export { PRIVATE_ROUTES, TARGET_HOSTS };
