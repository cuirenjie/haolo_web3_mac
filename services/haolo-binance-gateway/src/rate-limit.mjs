export class FixedWindowRateLimiter {
  constructor({ limit = 300, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  consume(key, now = Date.now()) {
    const current = this.windows.get(key);
    const record = !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current;
    record.count += 1;
    this.windows.set(key, record);
    if (this.windows.size > 20_000) {
      for (const [entryKey, entry] of this.windows) {
        if (entry.resetAt <= now) this.windows.delete(entryKey);
        if (this.windows.size <= 15_000) break;
      }
    }
    return Object.freeze({ allowed: record.count <= this.limit, remaining: Math.max(0, this.limit - record.count), resetAt: record.resetAt });
  }
}
