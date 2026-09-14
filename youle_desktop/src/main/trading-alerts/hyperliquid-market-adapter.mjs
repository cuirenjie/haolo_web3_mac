import WebSocket from "ws";
import { TradingAlertError } from "./errors.mjs";
import { withAbort } from "../system-proxy-fetch.mjs";

const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]);
const DURATION = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000 };
function parseMarket(value) {
  const [venue, marketType, ...symbolParts] = String(value || "").split(":");
  const coin = symbolParts.join(":");
  if (venue?.toUpperCase() !== "HYPERLIQUID" || !coin || !["PERPETUAL", "SPOT"].includes(marketType?.toUpperCase())) throw new TradingAlertError(`Hyperliquid adapter 不支持 ${value}`, { code: "TRADING_ALERT_MARKET_UNSUPPORTED", category: "provider" });
  return { coin };
}
function durationMs(interval) { const match = /^(\d+)(m|h|d|w|M)$/.exec(interval); return match ? Number(match[1]) * DURATION[match[2]] : 0; }
function normalize(row) { return { time: Number(row.t), closeTime: Number(row.T), open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: Number(row.v) }; }

export function createHyperliquidMarketAdapter({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, now = () => Date.now(), historyTimeoutMs = 12_000, handshakeTimeoutMs = 8_000, reconnectBaseMs = 500 } = {}) {
  const historyDeadline = Math.max(1, Number(historyTimeoutMs) || 12_000);
  const handshakeDeadline = Math.max(1, Number(handshakeTimeoutMs) || 8_000);
  const reconnectDelay = Math.max(1, Number(reconnectBaseMs) || 500);
  return Object.freeze({
    providerId: "hyperliquid-public",
    async loadHistory(subscription, limit = 500) {
      const { coin } = parseMarket(subscription.marketId);
      const interval = String(subscription.interval || "");
      if (!INTERVALS.has(interval)) throw new TradingAlertError(`Hyperliquid 不支持 ${interval} 周期`, { code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation" });
      const endTime = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), historyDeadline);
      timer.unref?.();
      try {
        const response = await withAbort(fetchImpl("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime: endTime - durationMs(interval) * Math.min(5_000, limit + 10), endTime } }), signal: controller.signal }), controller.signal);
        if (!response.ok) throw new TradingAlertError(`Hyperliquid 历史行情失败：HTTP ${response.status}`, { code: "TRADING_ALERT_MARKET_HISTORY_FAILED", category: "transport", retryable: response.status >= 500 });
        const rows = await withAbort(response.json(), controller.signal);
        return rows.map(normalize).sort((a, b) => a.time - b.time).slice(-limit);
      } finally { clearTimeout(timer); }
    },
    async subscribe(subscription, onEvent, onHealth = () => {}) {
      const { coin } = parseMarket(subscription.marketId);
      const interval = String(subscription.interval || "");
      if (!INTERVALS.has(interval)) throw new TradingAlertError(`Hyperliquid 不支持 ${interval} 周期`, { code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation" });
      let socket = null; let reconnectTimer = null; let heartbeatTimer = null; let handshakeTimer = null; let disposed = false; let attempt = 0; let current = null;
      const clearConnectionTimers = () => { clearTimeout(handshakeTimer); clearInterval(heartbeatTimer); };
      const closeSocket = (candidate) => {
        try {
          if (typeof candidate?.terminate === "function") candidate.terminate();
          else candidate?.close();
        } catch {}
      };
      const scheduleReconnect = () => {
        if (disposed) return;
        onHealth({ status: "reconnecting", at: now(), reason: "websocket_closed" });
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, Math.min(30_000, reconnectDelay * 2 ** Math.min(attempt++, 6)));
        reconnectTimer.unref?.();
      };
      const connect = () => {
        if (disposed) return;
        let candidate;
        try { candidate = new WebSocketImpl("wss://api.hyperliquid.xyz/ws", { handshakeTimeout: handshakeDeadline }); }
        catch { scheduleReconnect(); return; }
        socket = candidate;
        const failed = () => {
          if (disposed || socket !== candidate) return;
          socket = null;
          clearConnectionTimers();
          closeSocket(candidate);
          scheduleReconnect();
        };
        handshakeTimer = setTimeout(failed, handshakeDeadline);
        handshakeTimer.unref?.();
        candidate.on("open", () => {
          if (disposed || socket !== candidate) return;
          clearTimeout(handshakeTimer);
          attempt = 0;
          onHealth({ status: "connected", at: now() });
          try { candidate.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", coin, interval } })); }
          catch { failed(); return; }
          heartbeatTimer = setInterval(() => {
            if (disposed || socket !== candidate || candidate.readyState !== WebSocketImpl.OPEN) return;
            try { candidate.send(JSON.stringify({ method: "ping" })); } catch { failed(); }
          }, 30_000);
          heartbeatTimer.unref?.();
        });
        candidate.on("message", (payload) => { if (disposed || socket !== candidate) return; try {
          const message = JSON.parse(String(payload)); if (message.channel !== "candle") return;
          for (const row of (Array.isArray(message.data) ? message.data : [message.data]).filter(Boolean).sort((a, b) => Number(a.t) - Number(b.t))) {
            const next = normalize(row);
            if (current && next.time > current.time) onEvent({ eventId: `${coin}:${interval}:${current.time}:close`, candle: current, closed: true, eventTime: next.time, receivedAt: now(), source: "hyperliquid-websocket", coverage: "available" });
            current = next;
            onEvent({ eventId: `${coin}:${interval}:${next.time}:${now()}:update`, candle: next, closed: false, eventTime: now(), receivedAt: now(), source: "hyperliquid-websocket", coverage: "available" });
          }
        } catch {} });
        candidate.on("error", failed);
        candidate.on("close", failed);
      };
      connect();
      return async () => { disposed = true; clearTimeout(reconnectTimer); clearConnectionTimers(); const candidate = socket; socket = null; closeSocket(candidate); };
    },
  });
}
