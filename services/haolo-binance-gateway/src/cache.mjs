import { PublicRestCache } from "./public-rest-cache.mjs";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export class GatewayCache {
  constructor({ redisUrl = "", prefix = "haolo:market:" } = {}) {
    this.redisUrl = redisUrl;
    this.prefix = prefix;
    this.memory = new Map();
    this.budgetMemory = new Map();
    this.inflight = new Map();
    this.redis = null;
    this.publicRest = new PublicRestCache({ prefix });
  }

  async connect() {
    if (!this.redisUrl || this.redis) return;
    const { createClient } = await import("redis");
    const client = createClient({ url: this.redisUrl, disableOfflineQueue: true });
    client.on("error", () => {});
    await client.connect();
    this.redis = client;
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  async get(key, now = Date.now(), options = {}) {
    if (key.startsWith("rest:")) return this.publicRest.get(this.key(key), this.redis, now, options);
    let record = this.memory.get(key);
    if (!record && this.redis) {
      const raw = await this.redis.get(this.key(key));
      if (raw) {
        try {
          record = JSON.parse(raw);
          this.memory.set(key, record);
        } catch {}
      }
    }
    if (!record) return null;
    if (Number(record.staleUntil || 0) <= now) {
      this.memory.delete(key);
      return null;
    }
    return Object.freeze({ value: record.value, fresh: Number(record.freshUntil || 0) > now });
  }

  async getSharedValue(key, now = Date.now()) {
    if (!this.redis) return this.get(key, now);
    let raw = null;
    try { raw = await this.redis.get(this.key(key)); } catch {
      const record = this.memory.get(key);
      if (!record || Number(record.staleUntil || 0) <= now) return null;
      return Object.freeze({ value: record.value, fresh: Number(record.freshUntil || 0) > now });
    }
    if (!raw) return null;
    let record;
    try { record = JSON.parse(raw); } catch { return null; }
    if (Number(record.staleUntil || 0) <= now) return null;
    return Object.freeze({ value: record.value, fresh: Number(record.freshUntil || 0) > now });
  }

  async set(key, value, freshTtlMs, staleTtlMs = freshTtlMs) {
    if (key.startsWith("rest:")) return this.publicRest.set(this.key(key), value, freshTtlMs, staleTtlMs, this.redis);
    const now = Date.now();
    const record = { value, freshUntil: now + Math.max(0, freshTtlMs), staleUntil: now + Math.max(freshTtlMs, staleTtlMs) };
    this.memory.set(key, record);
    if (this.memory.size > 10_000) this.memory.delete(this.memory.keys().next().value);
    if (this.redis) {
      await this.redis.set(this.key(key), JSON.stringify(record), { PX: Math.max(1_000, staleTtlMs) });
    }
    return value;
  }

  async setCooldownAtLeast(key, value, ttlMs) {
    const safeTtlMs = Math.max(1_000, Math.trunc(Number(ttlMs) || 60_000));
    const requestedUntil = Math.max(0, Number(value?.until) || 0);
    const storageKey = this.key(key);
    const now = Date.now();
    const record = {
      value,
      freshUntil: now + safeTtlMs,
      staleUntil: now + safeTtlMs,
    };
    if (this.redis) {
      const script = `
        local currentRaw = redis.call('GET', KEYS[1])
        local currentUntil = 0
        if currentRaw then
          local ok, current = pcall(cjson.decode, currentRaw)
          if ok and current and current.value then
            currentUntil = tonumber(current.value['until'] or 0) or 0
          end
        end
        local requestedUntil = tonumber(ARGV[1]) or 0
        if currentUntil >= requestedUntil then return currentUntil end
        redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
        return requestedUntil
      `;
      return Number(await this.redis.sendCommand([
        "EVAL", script, "1", storageKey,
        String(requestedUntil), JSON.stringify(record), String(safeTtlMs),
      ]));
    }
    const current = this.memory.get(key);
    const currentUntil = Number(current?.value?.until || 0);
    if (currentUntil >= requestedUntil && current) return currentUntil;
    this.memory.set(key, record);
    if (this.memory.size > 10_000) this.memory.delete(this.memory.keys().next().value);
    return requestedUntil;
  }

  async take(key) {
    if (this.redis) {
      const raw = await this.redis.getDel(this.key(key));
      this.memory.delete(key);
      if (!raw) return null;
      let record;
      try { record = JSON.parse(raw); } catch { return null; }
      if (Number(record.staleUntil || 0) <= Date.now()) return null;
      return record.value;
    }
    const record = this.memory.get(key);
    this.memory.delete(key);
    if (!record || Number(record.staleUntil || 0) <= Date.now()) return null;
    return record.value;
  }

  budgetKeys(shardId, marketType, windowId) {
    const slot = `${shardId}:${marketType}:${windowId}`;
    return {
      total: this.key(`private-weight:{${slot}}:total`),
      background: this.key(`private-weight:{${slot}}:background`),
      users: this.key(`private-weight:{${slot}}:users`),
    };
  }

  async consumeWeightBudget({ shardId, marketType, windowId, weight, totalLimit, backgroundLimit, background, userKey, userLimit, ttlMs }) {
    const keys = this.budgetKeys(shardId, marketType, windowId);
    const amount = Math.max(1, Math.trunc(Number(weight) || 1));
    const safeTtlMs = Math.max(1_000, Math.trunc(Number(ttlMs) || 60_000));
    if (this.redis) {
      const script = `
        local total = tonumber(redis.call('GET', KEYS[1]) or '0')
        local background = tonumber(redis.call('GET', KEYS[2]) or '0')
        local user = tonumber(redis.call('HGET', KEYS[3], ARGV[6]) or '0')
        local amount = tonumber(ARGV[1])
        local totalLimit = tonumber(ARGV[2])
        local backgroundLimit = tonumber(ARGV[3])
        local isBackground = tonumber(ARGV[4])
        local ttl = tonumber(ARGV[5])
        local userLimit = tonumber(ARGV[7])
        local rejectedBy = 0
        if total + amount > totalLimit then rejectedBy = 1
        elseif isBackground == 1 and background + amount > backgroundLimit then rejectedBy = 2
        elseif user + amount > userLimit then rejectedBy = 3 end
        if rejectedBy > 0 then
          local remaining = redis.call('PTTL', KEYS[1])
          if remaining < 1 then remaining = ttl end
          return {0, total, background, remaining, rejectedBy, user}
        end
        local nextTotal = redis.call('INCRBY', KEYS[1], amount)
        if nextTotal == amount then redis.call('PEXPIRE', KEYS[1], ttl) end
        local nextBackground = background
        if isBackground == 1 then
          nextBackground = redis.call('INCRBY', KEYS[2], amount)
          if nextBackground == amount then redis.call('PEXPIRE', KEYS[2], ttl) end
        end
        local usersTtl = redis.call('PTTL', KEYS[3])
        local nextUser = redis.call('HINCRBY', KEYS[3], ARGV[6], amount)
        if usersTtl < 1 then redis.call('PEXPIRE', KEYS[3], ttl) end
        return {1, nextTotal, nextBackground, redis.call('PTTL', KEYS[1]), 0, nextUser}
      `;
      const result = await this.redis.sendCommand([
        "EVAL", script, "3", keys.total, keys.background, keys.users,
        String(amount), String(totalLimit), String(backgroundLimit), background ? "1" : "0", String(safeTtlMs), String(userKey), String(userLimit),
      ]);
      return Object.freeze({
        allowed: Number(result?.[0]) === 1,
        usedTotal: Number(result?.[1] || 0),
        usedBackground: Number(result?.[2] || 0),
        retryAfterMs: Math.max(1_000, Number(result?.[3] || safeTtlMs)),
        rejectedBy: ["", "total", "background", "user"][Number(result?.[4] || 0)] || "",
        usedByUser: Number(result?.[5] || 0),
      });
    }
    const now = Date.now();
    let record = this.budgetMemory.get(keys.total);
    if (!record || record.expiresAt <= now) record = { total: 0, background: 0, users: new Map(), expiresAt: now + safeTtlMs };
    if (!record.users) record.users = new Map();
    const usedByUser = Number(record.users.get(userKey) || 0);
    const allowed = record.total + amount <= totalLimit
      && (!background || record.background + amount <= backgroundLimit)
      && usedByUser + amount <= userLimit;
    const rejectedBy = record.total + amount > totalLimit
      ? "total"
      : background && record.background + amount > backgroundLimit
        ? "background"
        : usedByUser + amount > userLimit ? "user" : "";
    if (allowed) {
      record.total += amount;
      if (background) record.background += amount;
      record.users.set(userKey, usedByUser + amount);
      this.budgetMemory.set(keys.total, record);
    }
    return Object.freeze({
      allowed,
      usedTotal: record.total,
      usedBackground: record.background,
      retryAfterMs: Math.max(1_000, record.expiresAt - now),
      rejectedBy,
      usedByUser: allowed ? usedByUser + amount : usedByUser,
    });
  }

  async raiseWeightFloor({ shardId, marketType, windowId, value, ttlMs }) {
    const keys = this.budgetKeys(shardId, marketType, windowId);
    const floor = Math.max(0, Math.trunc(Number(value) || 0));
    const safeTtlMs = Math.max(1_000, Math.trunc(Number(ttlMs) || 60_000));
    if (this.redis) {
      const script = `
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local floor = tonumber(ARGV[1])
        local remaining = redis.call('PTTL', KEYS[1])
        if remaining < 1 then remaining = tonumber(ARGV[2]) end
        if current < floor then redis.call('SET', KEYS[1], floor, 'PX', remaining); return floor end
        if redis.call('PTTL', KEYS[1]) < 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
        return current
      `;
      return Number(await this.redis.sendCommand(["EVAL", script, "1", keys.total, String(floor), String(safeTtlMs)]));
    }
    const now = Date.now();
    let record = this.budgetMemory.get(keys.total);
    if (!record || record.expiresAt <= now) record = { total: 0, background: 0, users: new Map(), expiresAt: now + safeTtlMs };
    record.total = Math.max(record.total, floor);
    this.budgetMemory.set(keys.total, record);
    return record.total;
  }

  ready() {
    return !this.redisUrl || this.redis?.isReady === true;
  }

  async singleFlight(key, factory) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = Promise.resolve().then(factory).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async sharedSingleFlight(key, factory, { leaseMs = 65_000, readResult = null } = {}) {
    return this.singleFlight(key, async () => {
      if (!this.redisUrl) return factory();
      // Coordination and budget state fail closed. Never turn a Redis outage
      // into one upstream fetch per replica; callers can still use stale data.
      if (!this.redis?.isReady) throw Object.assign(new Error("Market coordination unavailable"), {
        statusCode: 503, code: "MARKET_COORDINATION_UNAVAILABLE", retryAfterMs: 1_000,
      });
      const lockKey = this.key(`rest-flight:${crypto.createHash("sha256").update(key).digest("hex")}`);
      const token = crypto.randomUUID();
      const duration = Math.max(100, Math.trunc(leaseMs));
      const deadline = Date.now() + duration;
      while (Date.now() < deadline) {
        const ready = await readResult?.();
        if (ready !== undefined && ready !== null) return ready;
        let acquired;
        try { acquired = await this.redis.set(lockKey, token, { NX: true, PX: duration }); }
        catch { throw Object.assign(new Error("Market coordination unavailable"), {
          statusCode: 503, code: "MARKET_COORDINATION_UNAVAILABLE", retryAfterMs: 1_000,
        }); }
        if (acquired) {
          const controller = new AbortController();
          let renewing = false;
          const renew = setInterval(async () => {
            if (renewing || controller.signal.aborted) return;
            renewing = true;
            try {
              const owned = await this.redis.sendCommand(["EVAL",
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0",
                "1", lockKey, token, String(duration)]);
              if (Number(owned) !== 1) throw new Error("Market refresh lease lost");
            } catch {
              controller.abort(Object.assign(new Error("Market coordination unavailable"), {
                statusCode: 503, code: "MARKET_COORDINATION_UNAVAILABLE", retryAfterMs: 1_000,
              }));
            } finally { renewing = false; }
          }, Math.max(25, Math.floor(duration / 3)));
          renew.unref?.();
          try {
            const result = await factory(controller.signal);
            controller.signal.throwIfAborted();
            return result;
          } finally {
            clearInterval(renew);
            await this.redis.sendCommand(["EVAL",
              "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
              "1", lockKey, token]).catch(() => {});
          }
        }
        await delay(Math.min(100, Math.max(1, deadline - Date.now())));
      }
      throw Object.assign(new Error("Market refresh already in progress"), {
        statusCode: 503, code: "MARKET_REFRESH_PENDING", retryAfterMs: 1_000,
      });
    });
  }

  async close() {
    await this.redis?.quit().catch(() => {});
    this.redis = null;
    this.memory.clear();
    this.publicRest.clear();
    this.budgetMemory.clear();
    this.inflight.clear();
  }
}
