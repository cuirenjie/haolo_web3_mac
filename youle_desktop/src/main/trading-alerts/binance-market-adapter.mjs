import WebSocket from "ws";
import { TradingAlertError } from "./errors.mjs";

function parseMarket(marketId) {
  const [venue, marketType, symbol] = String(marketId).toUpperCase().split(":");
  if (venue !== "BINANCE" || !symbol || !["SPOT", "FUTURES"].includes(marketType)) {
    throw new TradingAlertError(`Binance adapter 不支持 ${marketId}`, { code: "TRADING_ALERT_MARKET_UNSUPPORTED", category: "provider" });
  }
  return { marketType, symbol };
}

function candleFromKline(row) {
  if (Array.isArray(row)) return { time: Number(row[0]), closeTime: Number(row[6]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
  return { time: Number(row.t), closeTime: Number(row.T), open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c), volume: Number(row.v) };
}

const BINANCE_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"]);

function intervalMs(value) {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(String(value || ""));
  if (!match) throw new TradingAlertError(`不支持的 K 线周期：${value}`, { code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation" });
  return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase()];
}

export function planBinanceInterval(value) {
  const interval = String(value || "").toLowerCase();
  const targetMs = intervalMs(interval);
  if (BINANCE_INTERVALS.has(interval)) return Object.freeze({ interval, sourceInterval: interval, sourceMs: targetMs, targetMs, aggregate: false });
  const candidates = [...BINANCE_INTERVALS]
    .map((sourceInterval) => ({ sourceInterval, sourceMs: intervalMs(sourceInterval) }))
    .filter((entry) => entry.sourceMs <= targetMs && targetMs % entry.sourceMs === 0)
    .sort((a, b) => b.sourceMs - a.sourceMs);
  const selected = candidates[0] || { sourceInterval: "1m", sourceMs: 60_000 };
  return Object.freeze({ interval, ...selected, targetMs, aggregate: true });
}

function mergeAggregate(previous, candle, plan) {
  const time = Math.floor(candle.time / plan.targetMs) * plan.targetMs;
  if (!previous || previous.time !== time) return { time, closeTime: time + plan.targetMs, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
  return { ...previous, high: Math.max(previous.high, candle.high), low: Math.min(previous.low, candle.low), close: candle.close, volume: previous.volume + candle.volume };
}

function aggregateCandles(rows, plan) {
  if (!plan.aggregate) return rows;
  const result = [];
  for (const candle of rows) {
    const merged = mergeAggregate(result.at(-1), candle, plan);
    if (result.at(-1)?.time === merged.time) result[result.length - 1] = merged; else result.push(merged);
  }
  return result;
}

function createBinanceSocketPool(WebSocketImpl, { resolveWebSocketUrl } = {}) {
  const channels = new Map();
  let requestId = 1;

  const defaultWebsocketBase = (marketType) => marketType === "FUTURES"
    ? "wss://fstream.binance.com/market/ws"
    : "wss://data-stream.binance.vision:443/ws";
  const websocketBase = typeof resolveWebSocketUrl === "function"
    ? resolveWebSocketUrl
    : async (marketType) => defaultWebsocketBase(marketType);
  const isOpen = (socket) => socket?.readyState === (WebSocketImpl.OPEN ?? 1);
  const commandDebounceMs = 120;
  const sendCommand = (channel, method, streams) => {
    if (!isOpen(channel.socket) || !streams.length) return;
    try {
      channel.socket.send(JSON.stringify({ method, params: streams, id: requestId++ }));
    } catch {}
  };
  const queueCommand = (channel, method, streams) => {
    if (!streams.length) return;
    channel.pendingCommands.push({ method, streams });
    if (channel.commandTimer !== null) return;
    channel.commandTimer = setTimeout(() => {
      channel.commandTimer = null;
      if (!isOpen(channel.socket)) return;
      const intents = new Map();
      for (const command of channel.pendingCommands.splice(0)) {
        command.streams.forEach((stream) => intents.set(stream, command.method));
      }
      const grouped = new Map();
      for (const [stream, queuedMethod] of intents) {
        if (!grouped.has(queuedMethod)) grouped.set(queuedMethod, []);
        grouped.get(queuedMethod).push(stream);
      }
      for (const [queuedMethod, queuedStreams] of grouped) {
        sendCommand(channel, queuedMethod, queuedStreams);
      }
    }, commandDebounceMs);
    channel.commandTimer.unref?.();
  };
  const broadcastHealth = (channel, health) => {
    for (const listeners of channel.streams.values()) {
      for (const listener of listeners) listener.onHealth(health);
    }
  };
  const scheduleReconnect = (channel, reason = "websocket_closed") => {
    if (!channel.active || !channel.streams.size || channel.reconnectTimer) return;
    broadcastHealth(channel, { status: "reconnecting", at: Date.now(), reason });
    const delay = Math.min(30_000, 500 * 2 ** Math.min(channel.reconnectAttempt++, 6));
    channel.reconnectTimer = setTimeout(() => {
      channel.reconnectTimer = null;
      void connect(channel);
    }, delay);
    channel.reconnectTimer.unref?.();
  };
  const connect = async (channel) => {
    if (!channel.active || channel.socket || channel.connecting || !channel.streams.size) return;
    channel.connecting = true;
    let endpoint;
    try {
      endpoint = await websocketBase(channel.marketType);
    } catch (error) {
      channel.connecting = false;
      scheduleReconnect(channel, String(error?.message || "websocket_endpoint_failed").slice(0, 240));
      return;
    }
    if (!channel.active || channel.socket || !channel.streams.size) {
      channel.connecting = false;
      return;
    }
    const socket = new WebSocketImpl(endpoint);
    channel.socket = socket;
    channel.connecting = false;
    socket.on("open", () => {
      if (channel.socket !== socket || !channel.active) return;
      channel.reconnectAttempt = 0;
      clearTimeout(channel.commandTimer);
      channel.commandTimer = null;
      channel.pendingCommands = [];
      sendCommand(channel, "SUBSCRIBE", [...channel.streams.keys()]);
      broadcastHealth(channel, { status: "connected", at: Date.now() });
    });
    socket.on("message", (payload) => {
      if (channel.socket !== socket || !channel.active) return;
      try {
        const parsed = JSON.parse(String(payload));
        const message = parsed?.data || parsed;
        const kline = message?.k;
        const stream = kline?.s && kline?.i ? `${String(kline.s).toLowerCase()}@kline_${String(kline.i)}` : "";
        if (!stream) return;
        for (const listener of channel.streams.get(stream) || []) listener.onMessage(message);
      } catch {}
    });
    socket.on("error", () => {
      try { socket.close(); } catch {}
    });
    socket.on("close", () => {
      if (channel.socket !== socket) return;
      channel.socket = null;
      if (!channel.active || !channel.streams.size) return;
      scheduleReconnect(channel);
    });
  };

  return Object.freeze({
    subscribe(marketType, stream, onMessage, onHealth) {
      let channel = channels.get(marketType);
      if (!channel) {
        channel = {
          marketType,
          streams: new Map(),
          socket: null,
          connecting: false,
          reconnectTimer: null,
          reconnectAttempt: 0,
          pendingCommands: [],
          commandTimer: null,
          active: true,
        };
        channels.set(marketType, channel);
      }
      let listeners = channel.streams.get(stream);
      const existingStream = Boolean(listeners);
      if (!listeners) {
        listeners = new Set();
        channel.streams.set(stream, listeners);
      }
      const listener = { onMessage, onHealth };
      listeners.add(listener);
      if (existingStream && isOpen(channel.socket)) onHealth({ status: "connected", at: Date.now() });
      if (!existingStream) queueCommand(channel, "SUBSCRIBE", [stream]);
      void connect(channel);

      return async () => {
        const current = channel.streams.get(stream);
        current?.delete(listener);
        if (current?.size) return;
        channel.streams.delete(stream);
        queueCommand(channel, "UNSUBSCRIBE", [stream]);
        if (channel.streams.size) return;
        channel.active = false;
        clearTimeout(channel.reconnectTimer);
        clearTimeout(channel.commandTimer);
        channel.reconnectTimer = null;
        channel.commandTimer = null;
        channel.pendingCommands = [];
        channels.delete(marketType);
        const socket = channel.socket;
        channel.socket = null;
        if (socket && (isOpen(socket) || socket.readyState === (WebSocketImpl.CONNECTING ?? 0))) {
          try { socket.close(); } catch {}
        }
      };
    },
  });
}

export function createBinanceMarketAdapter({
  fetchImpl = globalThis.fetch,
  WebSocketImpl = WebSocket,
  subscribeMode = "websocket",
  pollIntervalMs = 5_000,
  restBaseUrls = {},
  resolveWebSocketUrl,
  streamHub,
} = {}) {
  const socketPool = createBinanceSocketPool(WebSocketImpl, { resolveWebSocketUrl });
  const loadHistory = async (subscription, limit = 500) => {
    const { marketType, symbol } = parseMarket(subscription.marketId);
    const plan = planBinanceInterval(subscription.interval);
    const base = marketType === "FUTURES"
      ? `${String(restBaseUrls.futures || "https://fapi.binance.com").replace(/\/+$/, "")}/fapi/v1/klines`
      : `${String(restBaseUrls.spot || "https://data-api.binance.vision").replace(/\/+$/, "")}/api/v3/klines`;
    const sourceLimit = Math.min(1_500, Math.max(limit, Math.ceil(limit * plan.targetMs / plan.sourceMs)));
    const url = `${base}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(plan.sourceInterval)}&limit=${sourceLimit}`;
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new TradingAlertError(`Binance 历史行情连接失败：${String(error?.message || error || "fetch failed")}`, {
        code: "TRADING_ALERT_MARKET_HISTORY_FAILED",
        category: "transport",
        retryable: true,
        cause: error,
      });
    }
    if (!response?.ok) {
      const status = Number(response?.status || 0);
      const retryAfterSeconds = Number(response?.headers?.get?.("retry-after"));
      throw new TradingAlertError(`Binance 历史行情失败：HTTP ${status}`, {
        code: status === 429 || status === 418 ? "TRADING_ALERT_MARKET_RATE_LIMITED" : "TRADING_ALERT_MARKET_HISTORY_FAILED",
        category: "transport",
        retryable: status === 429 || status === 418 || status >= 500 || !status,
        details: Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? { retryAfterMs: Math.ceil(retryAfterSeconds * 1_000) }
          : null,
      });
    }
    let rows;
    try {
      rows = await response.json();
    } catch (error) {
      throw new TradingAlertError("Binance 历史行情响应无法解析", { code: "TRADING_ALERT_MARKET_HISTORY_INVALID", category: "protocol", retryable: true, cause: error });
    }
    if (!Array.isArray(rows)) throw new TradingAlertError("Binance 历史行情响应格式无效", { code: "TRADING_ALERT_MARKET_HISTORY_INVALID", category: "protocol", retryable: true });
    return aggregateCandles(rows.map(candleFromKline), plan).slice(-limit);
  };
  return Object.freeze({
    providerId: "binance-public",
    async loadHistory(subscription, limit = 500) {
      return loadHistory(subscription, limit);
    },
    async subscribe(subscription, onEvent, onHealth = () => {}) {
      const { marketType, symbol } = parseMarket(subscription.marketId);
      const plan = planBinanceInterval(subscription.interval);
      if (subscribeMode === "polling") {
        let disposed = false;
        let timer = null;
        let failures = 0;
        const signatures = new Map();
        const delayMs = Math.max(1_000, Number(pollIntervalMs) || 5_000);
        const poll = async () => {
          if (disposed) return;
          try {
            const rows = await loadHistory(subscription, 3);
            const receivedAt = Date.now();
            for (const candle of rows.slice(-2)) {
              const closed = candle.closeTime <= receivedAt;
              const signature = `${candle.open}:${candle.high}:${candle.low}:${candle.close}:${candle.volume}:${closed}`;
              if (signatures.get(candle.time) === signature) continue;
              signatures.set(candle.time, signature);
              if (signatures.size > 8) signatures.delete(signatures.keys().next().value);
              onEvent({
                eventId: `${symbol}:${plan.interval}:${candle.time}:${closed ? "close" : `update:${candle.open}:${candle.high}:${candle.low}:${candle.close}:${candle.volume}`}`,
                candle,
                closed,
                eventTime: Math.min(receivedAt, candle.closeTime),
                receivedAt,
                coverage: "available",
                source: "binance-electron-net-polling",
              });
            }
            failures = 0;
            onHealth({ status: "connected", at: receivedAt });
          } catch (error) {
            failures += 1;
            onHealth({ status: "reconnecting", at: Date.now(), reason: String(error?.message || error || "poll_failed").slice(0, 240) });
          } finally {
            if (!disposed) {
              timer = setTimeout(poll, Math.min(30_000, delayMs * 2 ** Math.min(failures, 3)));
              timer.unref?.();
            }
          }
        };
        onHealth({ status: "connected", at: Date.now() });
        timer = setTimeout(poll, delayMs);
        timer.unref?.();
        return async () => {
          disposed = true;
          clearTimeout(timer);
        };
      }
      let aggregate = null;
      const stream = `${symbol.toLowerCase()}@kline_${plan.sourceInterval}`;
      const receive = (message) => {
        const kline = message.k;
        if (!kline) return;
        const sourceCandle = candleFromKline(kline);
        aggregate = plan.aggregate ? mergeAggregate(aggregate, sourceCandle, plan) : sourceCandle;
        const closed = plan.aggregate
          ? kline.x === true && Number(kline.T) >= aggregate.closeTime - 1
          : kline.x === true;
        onEvent({
          eventId: `${symbol}:${plan.interval}:${sourceCandle.time}:${Number(message.E || kline.T)}:${closed ? "close" : "update"}`,
          candle: { ...aggregate }, closed, eventTime: Number(message.E || kline.T), receivedAt: Date.now(), coverage: "available",
          source: plan.aggregate ? `binance-websocket:${plan.sourceInterval}->${plan.interval}` : "binance-websocket",
        });
        if (closed && plan.aggregate) aggregate = null;
      };
      if (streamHub) {
        return streamHub.subscribe(
          { marketType: marketType.toLowerCase(), streams: [stream] },
          (event) => receive(event.data),
          onHealth,
        ).dispose;
      }
      return socketPool.subscribe(marketType, stream, receive, onHealth);
    },
  });
}
