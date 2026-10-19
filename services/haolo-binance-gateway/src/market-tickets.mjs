import crypto from "node:crypto";

export const MARKET_TICKET_TTL_MS = 30_000;
// Diagnostic tombstones are not credentials. Keeping them briefly lets us
// distinguish a replay from expiry without extending the 30-second lease.
const AUDIT_RETENTION_MS = 5 * 60_000;
const validTicket = value => /^[A-Za-z0-9_-]{43}$/.test(value);
const ticketReference = ticket => crypto.createHash("sha256").update(ticket).digest("hex").slice(0, 24);
const unavailable = () => Object.assign(new Error("Market ticket store unavailable"), {
  statusCode: 503, code: "WS_TICKET_STORE_UNAVAILABLE",
});

const consumeScript = `
  local raw = redis.call('GETDEL', KEYS[1])
  local auditRaw = redis.call('GET', KEYS[2])
  local audit = nil
  if auditRaw then
    local ok, value = pcall(cjson.decode, auditRaw)
    if ok then audit = value end
  end
  local now = tonumber(ARGV[1])
  if raw then
    local ok, record = pcall(cjson.decode, raw)
    if not ok or not record or not record.value or not record.value.userId then
      return cjson.encode({status='invalid', audit=audit})
    end
    if tonumber(record.staleUntil or 0) <= now then
      return cjson.encode({status='expired', audit=audit})
    end
    if not audit then
      audit = {ticketRef=ARGV[2], issuedAt=0, expiresAt=record.staleUntil, clientProtocol='legacy'}
    end
    audit.consumedAt = now
    redis.call('SET', KEYS[2], cjson.encode(audit), 'PX', ARGV[3])
    return cjson.encode({status='ok', identity=record.value, audit=audit})
  end
  if audit and tonumber(audit.consumedAt or 0) > 0 then
    return cjson.encode({status='consumed', audit=audit})
  end
  if audit and tonumber(audit.expiresAt or 0) <= now then
    return cjson.encode({status='expired', audit=audit})
  end
  return cjson.encode({status=audit and 'unavailable' or 'unknown', audit=audit})
`;

export class MarketTicketStore {
  constructor(cache, { now = Date.now } = {}) { this.cache = cache; this.now = now; }

  keys(ticket) {
    return { live: `ticket:${ticket}`, audit: `ticket-audit:${ticketReference(ticket)}` };
  }

  checkReady() {
    if (this.cache.redisUrl && !this.cache.redis?.isReady) throw unavailable();
  }

  remember(key, value, expiresAt) {
    this.cache.memory.set(key, { value, freshUntil: expiresAt, staleUntil: expiresAt });
    while (this.cache.memory.size > 10_000) this.cache.memory.delete(this.cache.memory.keys().next().value);
  }

  async issue(identity, { clientProtocol = "legacy" } = {}) {
    this.checkReady();
    const ticket = crypto.randomBytes(32).toString("base64url");
    const issuedAt = this.now(), expiresAt = issuedAt + MARKET_TICKET_TTL_MS;
    const audit = { ticketRef: ticketReference(ticket), issuedAt, expiresAt, consumedAt: 0,
      clientProtocol: clientProtocol === "2" ? "2" : "legacy" };
    const keys = this.keys(ticket);
    if (this.cache.redis) {
      try {
        await this.cache.redis.multi()
          .set(this.cache.key(keys.live), JSON.stringify({ value: identity, freshUntil: expiresAt, staleUntil: expiresAt }), { PX: MARKET_TICKET_TTL_MS })
          .set(this.cache.key(keys.audit), JSON.stringify(audit), { PX: AUDIT_RETENTION_MS })
          .exec();
      } catch { throw unavailable(); }
    } else {
      this.remember(keys.live, identity, expiresAt);
      this.remember(keys.audit, audit, issuedAt + AUDIT_RETENTION_MS);
    }
    return { ticket, audit, expiresInMs: Math.max(0, expiresAt - this.now()) };
  }

  async consume(ticket) {
    if (!validTicket(ticket)) return { status: "invalid", audit: null };
    this.checkReady();
    const keys = this.keys(ticket), now = this.now();
    if (this.cache.redis) {
      try {
        const result = await this.cache.redis.sendCommand(["EVAL", consumeScript, "2",
          this.cache.key(keys.live), this.cache.key(keys.audit), String(now), ticketReference(ticket), String(AUDIT_RETENTION_MS)]);
        this.cache.memory.delete(keys.live);
        this.cache.memory.delete(keys.audit);
        return JSON.parse(result);
      } catch { throw unavailable(); }
    }
    // No awaits between read, delete and tombstone publication in memory mode.
    const record = this.cache.memory.get(keys.live);
    this.cache.memory.delete(keys.live);
    const savedAudit = this.cache.memory.get(keys.audit);
    let audit = savedAudit?.staleUntil > now ? savedAudit.value : null;
    if (savedAudit && !audit) this.cache.memory.delete(keys.audit);
    if (record) {
      if (!record.value?.userId) return { status: "invalid", audit };
      if (record.staleUntil <= now) return { status: "expired", audit };
      audit = { ...(audit || { ticketRef: ticketReference(ticket), issuedAt: 0, expiresAt: record.staleUntil, clientProtocol: "legacy" }), consumedAt: now };
      this.remember(keys.audit, audit, now + AUDIT_RETENTION_MS);
      return { status: "ok", identity: record.value, audit };
    }
    return { status: audit?.consumedAt ? "consumed" : audit && audit.expiresAt <= now ? "expired" : audit ? "unavailable" : "unknown", audit };
  }
}
