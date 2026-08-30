import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STORE_VERSION = 1;
const FILE_NAME = "email-notifications-v1.json";
const SUPPORTED_LOCALES = new Set(["zh-CN", "zh-Hant", "en"]);
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60 * 60_000;

function boundedText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeLocale(value) {
  const locale = boundedText(value, 16);
  return SUPPORTED_LOCALES.has(locale) ? locale : "zh-CN";
}

function validTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function retryDelay(attempts, requestedMs = 0) {
  const exponential = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** Math.min(Math.max(0, attempts - 1), 10)));
  return Math.min(MAX_RETRY_MS, Math.max(exponential, validTime(requestedMs, 0)));
}

function emptyState() {
  return { version: STORE_VERSION, deliveries: [] };
}

function normalizePayload(value = {}) {
  const triggeredAt = new Date(value.triggeredAt || Date.now());
  return {
    accountId: boundedText(value.accountId, 80),
    eventId: boundedText(value.eventId, 160),
    alertId: boundedText(value.alertId, 160),
    alertTitle: boundedText(value.alertTitle, 240),
    summary: boundedText(value.summary, 1_200),
    marketId: boundedText(value.marketId, 160),
    interval: boundedText(value.interval, 32),
    triggeredAt: Number.isNaN(triggeredAt.getTime()) ? new Date().toISOString() : triggeredAt.toISOString(),
    locale: normalizeLocale(value.locale),
  };
}

function normalizeDelivery(value, now) {
  const payload = normalizePayload(value?.payload || value);
  const status = value?.status === "sent" || value?.status === "failed" ? value.status : "pending";
  return {
    deliveryId: boundedText(value?.deliveryId || `delivery-${crypto.randomUUID()}`, 160),
    payload,
    status,
    attempts: Math.max(0, Math.floor(Number(value?.attempts) || 0)),
    nextAttemptAt: validTime(value?.nextAttemptAt, now),
    createdAt: validTime(value?.createdAt, now),
    updatedAt: validTime(value?.updatedAt, now),
    ...(value?.deliveredAt ? { deliveredAt: validTime(value.deliveredAt, now) } : {}),
    ...(value?.lastError ? { lastError: boundedText(value.lastError, 1_000) } : {}),
  };
}

function normalizeState(value, now) {
  if (!value || typeof value !== "object" || Number(value.version || 1) > STORE_VERSION) return emptyState();
  const deliveries = Array.isArray(value.deliveries)
    ? value.deliveries.map((entry) => normalizeDelivery(entry, now)).filter((entry) => entry.payload.accountId && entry.payload.eventId)
    : [];
  return { version: STORE_VERSION, deliveries };
}

export class TradingAlertEmailNotifier {
  constructor({ dataDir, deliver, currentAccountId, now = () => Date.now(), autoStart = true } = {}) {
    if (!dataDir) throw new TypeError("TradingAlertEmailNotifier requires dataDir");
    if (typeof deliver !== "function") throw new TypeError("TradingAlertEmailNotifier requires deliver");
    if (typeof currentAccountId !== "function") throw new TypeError("TradingAlertEmailNotifier requires currentAccountId");
    this.dataDir = path.resolve(String(dataDir));
    this.filePath = path.join(this.dataDir, FILE_NAME);
    this.deliver = deliver;
    this.currentAccountId = currentAccountId;
    this.now = now;
    this.autoStart = autoStart !== false;
    this.state = emptyState();
    this.loaded = false;
    this.stateQueue = Promise.resolve();
    this.deliveryPromise = null;
    this.timer = null;
    this.timerDueAt = null;
    this.stopped = false;
  }

  async enqueue(input = {}) {
    const payload = normalizePayload(input);
    if (!payload.accountId || !payload.eventId || !payload.alertId || !payload.alertTitle || !payload.summary || !payload.marketId || !payload.interval) {
      throw new TypeError("Trading alert email payload is incomplete");
    }
    await this.withState(async () => {
      const existing = this.state.deliveries.find((entry) => entry.payload.accountId === payload.accountId && entry.payload.eventId === payload.eventId);
      if (existing) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
          const error = new Error("Trading alert email event content does not match its idempotency key");
          error.code = "TRADING_ALERT_EMAIL_EVENT_CONFLICT";
          throw error;
        }
        return;
      }
      const now = this.now();
      this.state.deliveries.push(normalizeDelivery({ payload, status: "pending", nextAttemptAt: now, createdAt: now, updatedAt: now }, now));
      await this.persist();
    });
    this.schedule(0);
    return { queued: true, eventId: payload.eventId };
  }

  start() {
    this.stopped = false;
    this.schedule(0);
    return this;
  }

  async flush() {
    if (this.deliveryPromise) return this.deliveryPromise;
    this.deliveryPromise = this.deliverDue().finally(() => { this.deliveryPromise = null; });
    return this.deliveryPromise;
  }

  async deliverDue() {
    await this.load();
    while (!this.stopped) {
      const accountId = boundedText(await this.currentAccountId(), 80);
      if (!accountId) break;
      let current = null;
      await this.withState(async () => {
        const now = this.now();
        current = this.state.deliveries
          .filter((entry) => entry.status === "pending" && entry.payload.accountId === accountId && entry.nextAttemptAt <= now)
          .sort((left, right) => left.createdAt - right.createdAt)[0] || null;
        if (!current) return;
        current.status = "sending";
        current.attempts += 1;
        current.updatedAt = now;
        delete current.lastError;
        await this.persist();
        current = structuredClone(current);
      });
      if (!current) break;

      try {
        const result = await this.deliver({
          account_id: current.payload.accountId,
          event_id: current.payload.eventId,
          alert_id: current.payload.alertId,
          alert_title: current.payload.alertTitle,
          summary: current.payload.summary,
          market_id: current.payload.marketId,
          interval: current.payload.interval,
          triggered_at: current.payload.triggeredAt,
          locale: current.payload.locale,
        });
        await this.withState(async () => {
          const saved = this.find(current);
          if (!saved) return;
          if (result?.delivered === true) {
            saved.status = "sent";
            saved.deliveredAt = this.now();
            saved.updatedAt = this.now();
            delete saved.lastError;
          } else {
            saved.status = "pending";
            saved.nextAttemptAt = this.now() + retryDelay(saved.attempts, result?.retry_after_ms);
            saved.updatedAt = this.now();
          }
          this.pruneSent();
          await this.persist();
        });
      } catch (error) {
        await this.withState(async () => {
          const saved = this.find(current);
          if (!saved) return;
          const status = Number(error?.status);
          const terminalClientError = Number.isFinite(status)
            && status >= 400 && status < 500
            && ![401, 404].includes(status)
            && error?.code !== "TRADING_ALERT_EMAIL_ACCOUNT_EMAIL_REQUIRED";
          if (terminalClientError || error?.code === "TRADING_ALERT_EMAIL_EVENT_CONFLICT" || error?.code === "TRADING_ALERT_EMAIL_ACCOUNT_MISMATCH") {
            saved.status = "failed";
          } else {
            saved.status = "pending";
            saved.nextAttemptAt = this.now() + retryDelay(saved.attempts, error?.retryAfterMs);
          }
          saved.lastError = boundedText(error?.message || error || "email delivery failed", 1_000);
          saved.updatedAt = this.now();
          await this.persist();
        });
      }
    }
    this.scheduleNext();
  }

  find(delivery) {
    return this.state.deliveries.find((entry) => entry.deliveryId === delivery.deliveryId);
  }

  pruneSent() {
    const sent = this.state.deliveries.filter((entry) => entry.status === "sent").sort((left, right) => right.updatedAt - left.updatedAt);
    const retained = new Set(sent.slice(0, 500).map((entry) => entry.deliveryId));
    this.state.deliveries = this.state.deliveries.filter((entry) => entry.status !== "sent" || retained.has(entry.deliveryId));
  }

  schedule(delayMs) {
    if (!this.autoStart || this.stopped) return;
    const delay = Math.max(0, Number(delayMs) || 0);
    const dueAt = this.now() + delay;
    if (this.timer && Number(this.timerDueAt) <= dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = null;
      void this.flush().catch(() => {});
    }, delay);
    this.timer.unref?.();
  }

  scheduleNext() {
    if (!this.autoStart || this.stopped) return;
    const current = this.currentAccountId();
    if (!current || typeof current.then === "function") {
      this.schedule(60_000);
      return;
    }
    const accountId = boundedText(current, 80);
    if (accountId) {
      const next = this.state.deliveries
        .filter((entry) => entry.status === "pending" && entry.payload.accountId === accountId)
        .reduce((minimum, entry) => Math.min(minimum, entry.nextAttemptAt), Number.POSITIVE_INFINITY);
      if (Number.isFinite(next)) this.schedule(Math.max(0, next - this.now()));
      return;
    }
    this.schedule(60_000);
  }

  async snapshot() {
    await this.load();
    return structuredClone(this.state);
  }

  async load() {
    if (this.loaded) return;
    await this.withState(async () => {
      if (this.loaded) return;
      await fs.mkdir(this.dataDir, { recursive: true });
      try {
        this.state = normalizeState(JSON.parse(await fs.readFile(this.filePath, "utf8")), this.now());
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        this.state = emptyState();
      }
      for (const entry of this.state.deliveries) {
        if (entry.status === "sending") entry.status = "pending";
      }
      this.loaded = true;
    });
  }

  async withState(operation) {
    const next = this.stateQueue.then(async () => {
      if (!this.loaded) {
        await fs.mkdir(this.dataDir, { recursive: true });
        try {
          this.state = normalizeState(JSON.parse(await fs.readFile(this.filePath, "utf8")), this.now());
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
          this.state = emptyState();
        }
        for (const entry of this.state.deliveries) if (entry.status === "sending") entry.status = "pending";
        this.loaded = true;
      }
      return operation();
    });
    this.stateQueue = next.catch(() => {});
    return next;
  }

  async persist() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = null;
    await this.deliveryPromise?.catch(() => {});
  }
}
