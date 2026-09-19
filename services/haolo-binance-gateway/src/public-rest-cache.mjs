// Public price history is disposable. Tickets, permits and weight ledgers are
// not: Redis must retain noeviction, and only this namespace may be evicted.
export const PUBLIC_REST_CACHE_WRITE = `
local index, sizes, totalKey = KEYS[2], KEYS[3], KEYS[4]
local size, cap, countCap = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local total = tonumber(redis.call('GET', totalKey) or '0')
local old = tonumber(redis.call('HGET', sizes, KEYS[1]) or '0')
if size > cap then return 0 end
redis.call('ZREM', index, KEYS[1])
redis.call('HDEL', sizes, KEYS[1])
total = math.max(0, total - old)
while total + size > cap or redis.call('ZCARD', index) >= countCap do
  local victim = redis.call('ZRANGE', index, 0, 0)[1]
  if not victim then break end
  local removed = tonumber(redis.call('HGET', sizes, victim) or '0')
  if string.sub(victim, 1, string.len(ARGV[7])) ~= ARGV[7] then
    return redis.error_reply('Invalid public REST cache index')
  end
  redis.call('DEL', victim)
  redis.call('ZREM', index, victim)
  redis.call('HDEL', sizes, victim)
  total = math.max(0, total - removed)
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', index, ARGV[6], KEYS[1])
redis.call('HSET', sizes, KEYS[1], size)
redis.call('SET', totalKey, total + size)
return 1
`;

export class PublicRestCache {
  constructor({ prefix, memoryMaxBytes = 32 * 1024 * 1024, redisMaxBytes = 128 * 1024 * 1024,
    maxEntries = 1024, onDiagnostic = (entry) => console.warn(JSON.stringify(entry)) } = {}) {
    this.prefix = `${prefix}rest:`;
    this.memoryMaxBytes = memoryMaxBytes;
    this.redisMaxBytes = redisMaxBytes;
    this.maxEntries = maxEntries;
    this.memory = new Map();
    this.memoryBytes = 0;
    this.onDiagnostic = onDiagnostic;
    this.nextDiagnosticAt = 0;
  }

  note(operation) {
    if (Date.now() < this.nextDiagnosticAt) return;
    this.nextDiagnosticAt = Date.now() + 60_000;
    try { this.onDiagnostic({ event: "public_rest_cache_unavailable", operation }); } catch {}
  }

  remember(key, raw) {
    this.forget(key);
    const bytes = Buffer.byteLength(raw) + Buffer.byteLength(key) + 256;
    if (bytes > this.memoryMaxBytes) return;
    while (this.memory.size && (this.memoryBytes + bytes > this.memoryMaxBytes || this.memory.size >= this.maxEntries)) {
      this.forget(this.memory.keys().next().value);
    }
    // Keep only serialized data: parsed OHLC arrays otherwise amplify memory.
    this.memory.set(key, { raw, bytes });
    this.memoryBytes += bytes;
  }

  forget(key) {
    const entry = this.memory.get(key);
    if (!entry) return;
    this.memoryBytes -= entry.bytes;
    this.memory.delete(key);
  }

  async get(key, redis, now = Date.now()) {
    let raw = this.memory.get(key)?.raw;
    if (!raw && redis) {
      try { raw = await redis.get(key); } catch { this.note("read"); }
    }
    if (!raw) return null;
    let record;
    try { record = JSON.parse(raw); } catch { this.forget(key); return null; }
    if (Number(record.staleUntil || 0) <= now) { this.forget(key); return null; }
    this.remember(key, raw);
    return Object.freeze({ value: record.value, fresh: Number(record.freshUntil || 0) > now });
  }

  async set(key, value, freshTtlMs, staleTtlMs, redis) {
    const now = Date.now();
    const raw = JSON.stringify({ value, freshUntil: now + Math.max(0, freshTtlMs),
      staleUntil: now + Math.max(freshTtlMs, staleTtlMs) });
    this.remember(key, raw);
    if (redis) {
      try {
        await redis.sendCommand(["EVAL", PUBLIC_REST_CACHE_WRITE, "4", key,
          `${this.prefix}index`, `${this.prefix}sizes`, `${this.prefix}bytes`,
          raw, String(Math.max(1_000, freshTtlMs, staleTtlMs)),
          String(Buffer.byteLength(raw) + Buffer.byteLength(key) + 256),
          String(this.redisMaxBytes), String(this.maxEntries), String(now), this.prefix]);
      } catch {
        // A successful Binance response remains successful when the disposable
        // cache is full/offline. Security state still uses GatewayCache.set.
        this.note("write");
      }
    }
    return value;
  }

  clear() { this.memory.clear(); this.memoryBytes = 0; }
}
