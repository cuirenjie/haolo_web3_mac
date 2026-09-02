export class FixedWindowRateLimiter {
  constructor({ limit = 300, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  inspect(key, now = Date.now(), cost = 1) {
    const current = this.windows.get(key);
    const record = !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current;
    const normalizedCost = Math.max(0, Math.floor(Number(cost) || 0));
    return Object.freeze({
      allowed: record.count + normalizedCost <= this.limit,
      remaining: Math.max(0, this.limit - record.count),
      resetAt: record.resetAt,
    });
  }

  consume(key, now = Date.now(), cost = 1) {
    const current = this.windows.get(key);
    const record = !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current;
    const normalizedCost = Math.max(0, Math.floor(Number(cost) || 0));
    const allowed = record.count + normalizedCost <= this.limit;
    if (allowed) record.count += normalizedCost;
    this.windows.set(key, record);
    if (this.windows.size > 20_000) {
      for (const [entryKey, entry] of this.windows) {
        if (entry.resetAt <= now) this.windows.delete(entryKey);
        if (this.windows.size <= 15_000) break;
      }
    }
    return Object.freeze({ allowed, remaining: Math.max(0, this.limit - record.count), resetAt: record.resetAt });
  }
}
