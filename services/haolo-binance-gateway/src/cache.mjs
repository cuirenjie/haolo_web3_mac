import { PublicRestCache } from "./public-rest-cache.mjs";

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
    const client = createClient({ url: this.redisUrl });
    client.on("error", () => {});
    await client.connect();
    this.redis = client;
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  async get(key, now = Date.now()) {
    if (key.startsWith("rest:")) return this.publicRest.get(this.key(key), this.redis, now);
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

  async close() {
    await this.redis?.quit().catch(() => {});
    this.redis = null;
    this.memory.clear();
    this.publicRest.clear();
    this.budgetMemory.clear();
    this.inflight.clear();
  }
}
