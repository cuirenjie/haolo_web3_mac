// Independent, bounded observation. Never used to admit, reroute or throttle.
const UNKNOWN = Object.freeze({ payer: "unknown", entitlement: "unknown" });
const EXPIRED_PAID = Object.freeze({ payer: "paid", entitlement: "unknown" });
export class TrafficIdentityObserver {
  constructor({ origin, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.origin = origin;
    this.fetch = fetchImpl;
    this.now = now;
    this.entries = new Map();
    this.pending = 0;
  }
  observe(userId, token) {
    if (!this.origin || !userId || !token) return;
    let entry = this.entries.get(userId);
    if (!entry) {
      if (this.entries.size >= 5000) this.entries.delete(this.entries.keys().next().value);
      entry = { value: UNKNOWN, until: 0, next: 0, pending: false };
      this.entries.set(userId, entry);
    }
    entry.token = token;
    this.get(userId);
  }
  get(userId) {
    const entry = this.entries.get(userId);
    if (!entry) return UNKNOWN;
    const now = this.now();
    if (!entry.pending && now >= entry.next && this.pending < 8) {
      entry.pending = true;
      entry.next = now + 15_000;
      this.pending++;
      void this.refresh(userId, entry);
    }
    if (entry.until > now) return entry.value;
    // Historical payment/gift is monotonic; an outage cannot make it free.
    return entry.value.payer === "paid" ? EXPIRED_PAID : UNKNOWN;
  }
  async refresh(userId, entry) {
    try {
      const response = await this.fetch(`${this.origin}/api/profile/me/market-traffic`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(3000),
        headers: { authorization: `Bearer ${entry.token}`, accept: "application/json" },
      });
      if (!response.ok) {
        if ([401, 403, 404, 429].includes(response.status)) entry.next = this.now() + 60_000;
        await response.body?.cancel?.(); return;
      }
      const value = await response.json();
      if (value.version !== 1 || value.classification !== "paid_or_gift_v1" || value.user_id !== userId ||
          !["paid", "free", "unknown"].includes(value.payer) ||
          !["active", "inactive", "unknown"].includes(value.entitlement)) return;
      const until = Math.min(Date.parse(value.valid_until), this.now() + 60_000);
      if (!Number.isFinite(until) || until <= this.now()) return;
      if (entry.value.payer === "paid" && value.payer !== "paid") {
        // A partial ledger response cannot erase a verified payment or gift.
        entry.value = EXPIRED_PAID;
        return;
      }
      entry.value = Object.freeze({ payer: value.payer, entitlement: value.entitlement });
      entry.until = until;
      entry.next = Math.max(this.now() + 1000, until - 5000);
    } catch { /* Telemetry errors never enter authentication or market handling. */ }
    finally { entry.pending = false; this.pending--; }
  }
}
