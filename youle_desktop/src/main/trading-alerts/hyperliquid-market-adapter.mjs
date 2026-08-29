import WebSocket from "ws";
import { TradingAlertError } from "./errors.mjs";

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

export function createHyperliquidMarketAdapter({ fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, now = () => Date.now() } = {}) {
  return Object.freeze({
    providerId: "hyperliquid-public",
    async loadHistory(subscription, limit = 500) {
      const { coin } = parseMarket(subscription.marketId);
      const interval = String(subscription.interval || "");
      if (!INTERVALS.has(interval)) throw new TradingAlertError(`Hyperliquid 不支持 ${interval} 周期`, { code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation" });
      const endTime = now();
      const response = await fetchImpl("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime: endTime - durationMs(interval) * Math.min(5_000, limit + 10), endTime } }) });
      if (!response.ok) throw new TradingAlertError(`Hyperliquid 历史行情失败：HTTP ${response.status}`, { code: "TRADING_ALERT_MARKET_HISTORY_FAILED", category: "transport", retryable: response.status >= 500 });
      return (await response.json()).map(normalize).sort((a, b) => a.time - b.time).slice(-limit);
    },
    async subscribe(subscription, onEvent, onHealth = () => {}) {
      const { coin } = parseMarket(subscription.marketId);
      const interval = String(subscription.interval || "");
      if (!INTERVALS.has(interval)) throw new TradingAlertError(`Hyperliquid 不支持 ${interval} 周期`, { code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation" });
      let socket = null; let reconnectTimer = null; let heartbeatTimer = null; let disposed = false; let attempt = 0; let current = null;
      const connect = () => {
        if (disposed) return;
        socket = new WebSocketImpl("wss://api.hyperliquid.xyz/ws");
        socket.on("open", () => { attempt = 0; onHealth({ status: "connected", at: now() }); socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "candle", coin, interval } })); heartbeatTimer = setInterval(() => socket?.readyState === WebSocketImpl.OPEN && socket.send(JSON.stringify({ method: "ping" })), 30_000); heartbeatTimer.unref?.(); });
        socket.on("message", (payload) => { try {
          const message = JSON.parse(String(payload)); if (message.channel !== "candle") return;
          for (const row of (Array.isArray(message.data) ? message.data : [message.data]).filter(Boolean).sort((a, b) => Number(a.t) - Number(b.t))) {
            const next = normalize(row);
            if (current && next.time > current.time) onEvent({ eventId: `${coin}:${interval}:${current.time}:close`, candle: current, closed: true, eventTime: next.time, receivedAt: now(), source: "hyperliquid-websocket", coverage: "available" });
            current = next;
            onEvent({ eventId: `${coin}:${interval}:${next.time}:${now()}:update`, candle: next, closed: false, eventTime: now(), receivedAt: now(), source: "hyperliquid-websocket", coverage: "available" });
          }
        } catch {} });
        socket.on("error", () => socket?.close());
        socket.on("close", () => { socket = null; clearInterval(heartbeatTimer); if (disposed) return; onHealth({ status: "reconnecting", at: now(), reason: "websocket_closed" }); reconnectTimer = setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempt++, 6))); reconnectTimer.unref?.(); });
      };
      connect();
      return async () => { disposed = true; clearTimeout(reconnectTimer); clearInterval(heartbeatTimer); if (socket && [WebSocketImpl.OPEN, WebSocketImpl.CONNECTING].includes(socket.readyState)) socket.close(); };
    },
  });
}
