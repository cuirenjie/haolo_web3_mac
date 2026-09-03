import WebSocket from "ws";

const STREAM_PATTERN = /^[a-z0-9_\p{Script=Han}]{2,40}@(kline_(?:1s|[1-9]\d*[mhdwM])|ticker|miniTicker|aggTrade|bookTicker|markPrice(?:@1s)?)$/u;

function marketTypeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "spot") return "spot";
  if (normalized === "futures" || normalized === "perpetual") return "futures";
  throw new TypeError("unsupported Binance market type");
}

function streamValue(value) {
  const normalized = String(value || "").trim();
  if (!STREAM_PATTERN.test(normalized)) throw new TypeError(`unsupported Binance stream: ${normalized}`);
  return normalized;
}

function streamClassValue(value) {
  const stream = streamValue(value);
  return /@bookTicker$/.test(stream) ? "public" : "market";
}

function channelKey(marketType, streamClass) {
  return `${marketType}:${streamClass}`;
}

export class TradingMarketDataHub {
  constructor({
    endpointProvider,
    endpointFailureReporter = null,
    lookupProvider = null,
    WebSocketImpl = WebSocket,
    reconnectBaseMs = 500,
    heartbeatMs = 20_000,
  } = {}) {
    if (typeof endpointProvider !== "function") throw new TypeError("endpointProvider is required");
    if (endpointFailureReporter != null && typeof endpointFailureReporter !== "function") {
      throw new TypeError("endpointFailureReporter must be a function");
    }
    if (lookupProvider != null && typeof lookupProvider !== "function") {
      throw new TypeError("lookupProvider must be a function");
    }
    this.endpointProvider = endpointProvider;
    this.endpointFailureReporter = endpointFailureReporter;
    this.lookupProvider = lookupProvider;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectBaseMs = Math.max(10, Number(reconnectBaseMs) || 500);
    this.heartbeatMs = Math.max(1_000, Number(heartbeatMs) || 20_000);
    // Binance limits client-to-server commands to 10 messages/second. A
    // short debounce absorbs favorite/split-pane churn into one batched
    // SUBSCRIBE/UNSUBSCRIBE frame without delaying the market feed itself.
    this.commandDebounceMs = 120;
    this.channels = new Map();
    this.nextSubscriptionId = 1;
    this.nextRequestId = 1;
    this.closed = false;
  }

  channelFor(marketType, streamClass = "market") {
    const normalized = marketTypeValue(marketType);
    const key = channelKey(normalized, streamClass);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = {
        marketType: normalized,
        streamClass,
        subscriptions: new Map(),
        streamSubscriptions: new Map(),
        socket: null,
        connecting: false,
        reconnectAttempt: 0,
        reconnectTimer: null,
        heartbeatTimer: null,
        pendingCommands: [],
        commandTimer: null,
        alive: true,
        generation: 0,
      };
      this.channels.set(key, channel);
    }
    return channel;
  }

  isOpen(socket) {
    return socket?.readyState === (this.WebSocketImpl.OPEN ?? 1);
  }

  sendCommand(channel, method, streams) {
    if (!this.isOpen(channel.socket) || !streams.length) return;
    try {
      channel.socket.send(JSON.stringify({ method, params: streams, id: this.nextRequestId++ }));
    } catch {}
  }

  queueCommand(channel, method, streams) {
    if (!streams.length) return;
    channel.pendingCommands.push({ method, streams });
    if (channel.commandTimer !== null) return;
    channel.commandTimer = setTimeout(() => {
      channel.commandTimer = null;
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
        this.sendCommand(channel, queuedMethod, queuedStreams);
      }
    }, this.commandDebounceMs);
    channel.commandTimer.unref?.();
  }

  broadcastHealth(channel, health) {
    const frozen = Object.freeze({ type: "health", at: Date.now(), ...health });
    for (const subscription of channel.subscriptions.values()) {
      try { subscription.onHealth(frozen); } catch {}
    }
  }

  scheduleReconnect(channel, reason = "websocket_closed") {
    if (this.closed || !channel.subscriptions.size || channel.reconnectTimer) return;
    this.broadcastHealth(channel, { status: "reconnecting", reason });
    const delay = Math.min(30_000, this.reconnectBaseMs * 2 ** Math.min(channel.reconnectAttempt++, 6));
    channel.reconnectTimer = setTimeout(() => {
      channel.reconnectTimer = null;
      void this.connect(channel);
    }, delay);
    channel.reconnectTimer.unref?.();
  }

  armHeartbeat(channel, socket) {
    clearInterval(channel.heartbeatTimer);
    channel.alive = true;
    channel.heartbeatTimer = setInterval(() => {
      if (channel.socket !== socket || !this.isOpen(socket)) return;
      if (!channel.alive) {
        try { socket.terminate?.(); } catch { try { socket.close(); } catch {} }
        return;
      }
      channel.alive = false;
      try { socket.ping?.(); } catch { try { socket.close(); } catch {} }
    }, this.heartbeatMs);
    channel.heartbeatTimer.unref?.();
  }

  async connect(channel) {
    if (this.closed || channel.connecting || channel.socket || !channel.subscriptions.size) return;
    channel.connecting = true;
    const generation = ++channel.generation;
    let endpoint;
    let endpointContext;
    try {
      const resolved = await this.endpointProvider({
        marketType: channel.marketType,
        combined: true,
        streamClass: channel.streamClass,
      });
      endpointContext = typeof resolved === "string"
        ? { url: resolved, route: null, marketType: channel.marketType }
        : { ...resolved, marketType: resolved?.marketType || channel.marketType };
      endpoint = String(endpointContext?.url || "");
      if (!endpoint) throw new Error("market endpoint is empty");
    } catch (error) {
      channel.connecting = false;
      this.scheduleReconnect(channel, String(error?.message || "endpoint_failed").slice(0, 240));
      return;
    }
    if (this.closed || generation !== channel.generation || channel.socket || !channel.subscriptions.size) {
      channel.connecting = false;
      return;
    }
    let socket;
    try {
      const lookup = this.lookupProvider?.(endpointContext);
      socket = new this.WebSocketImpl(endpoint, {
        perMessageDeflate: false,
        maxPayload: 1024 * 1024,
        ...(typeof lookup === "function" ? { family: 4, lookup } : {}),
      });
    } catch (error) {
      channel.connecting = false;
      this.reportEndpointOutcome({ ...endpointContext, outcome: "failed", connectedDurationMs: 0 });
      this.scheduleReconnect(channel, String(error?.message || "connect_failed").slice(0, 240));
      return;
    }
    channel.socket = socket;
    channel.connecting = false;
    let openedAt = 0;
    socket.on("open", () => {
      if (channel.socket !== socket || this.closed) return;
      openedAt = Date.now();
      channel.reconnectAttempt = 0;
      channel.alive = true;
      // The open handshake sends the authoritative current stream set. Drop
      // commands queued while CONNECTING so they cannot replay a duplicate
      // SUBSCRIBE after the socket has already been initialized.
      clearTimeout(channel.commandTimer);
      channel.commandTimer = null;
      channel.pendingCommands = [];
      this.sendCommand(channel, "SUBSCRIBE", [...channel.streamSubscriptions.keys()]);
      this.armHeartbeat(channel, socket);
      this.broadcastHealth(channel, { status: "connected" });
      this.reportEndpointOutcome({ ...endpointContext, outcome: "connected", connectedDurationMs: 0 });
    });
    socket.on("pong", () => {
      if (channel.socket === socket) channel.alive = true;
    });
    socket.on("message", (payload) => {
      if (channel.socket !== socket || this.closed) return;
      channel.alive = true;
      let message;
      try { message = JSON.parse(String(payload)); } catch { return; }
      const stream = String(message?.stream || "");
      if (!stream) return;
      const event = Object.freeze({
        type: "data",
        stream,
        data: message.data,
        receivedAt: Date.now(),
      });
      for (const subscriptionId of channel.streamSubscriptions.get(stream) || []) {
        const subscription = channel.subscriptions.get(subscriptionId);
        try { subscription?.onEvent(event); } catch {}
      }
    });
    socket.on("error", () => {
      try { socket.close(); } catch {}
    });
    socket.on("close", () => {
      if (channel.socket !== socket) return;
      channel.socket = null;
      clearInterval(channel.heartbeatTimer);
      channel.heartbeatTimer = null;
      this.reportEndpointOutcome({
        ...endpointContext,
        outcome: "failed",
        connectedDurationMs: openedAt ? Math.max(0, Date.now() - openedAt) : 0,
      });
      if (!this.closed && channel.subscriptions.size) this.scheduleReconnect(channel);
    });
  }

  reportEndpointOutcome(outcome) {
    if (!this.endpointFailureReporter) return;
    try {
      Promise.resolve(this.endpointFailureReporter(outcome)).catch(() => {});
    } catch {}
  }

  subscribe({ marketType, streams } = {}, onEvent, onHealth = () => {}) {
    if (this.closed) throw new Error("TradingMarketDataHub is closed");
    if (typeof onEvent !== "function") throw new TypeError("onEvent is required");
    const normalizedStreams = [...new Set((Array.isArray(streams) ? streams : []).map(streamValue))];
    if (!normalizedStreams.length || normalizedStreams.length > 50) throw new TypeError("one to fifty Binance streams are required");
    const subscriptionId = `market-${this.nextSubscriptionId++}`;
    const channels = new Map();
    for (const stream of normalizedStreams) {
      const streamClass = streamClassValue(stream);
      const channel = channels.get(streamClass) || this.channelFor(marketType, streamClass);
      const entry = channels.get(streamClass) || { channel, streams: [] };
      entry.streams.push(stream);
      channels.set(streamClass, entry);
    }
    for (const { channel, streams: groupedStreams } of channels.values()) {
      const addedStreams = [];
      const subscription = { id: subscriptionId, streams: groupedStreams, onEvent, onHealth };
      channel.subscriptions.set(subscriptionId, subscription);
      for (const stream of groupedStreams) {
        let ids = channel.streamSubscriptions.get(stream);
        if (!ids) {
          ids = new Set();
          channel.streamSubscriptions.set(stream, ids);
          addedStreams.push(stream);
        }
        ids.add(subscriptionId);
      }
      this.queueCommand(channel, "SUBSCRIBE", addedStreams);
      if (this.isOpen(channel.socket)) onHealth(Object.freeze({ type: "health", status: "connected", at: Date.now() }));
      else void this.connect(channel);
    }
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      for (const { channel, streams: groupedStreams } of channels.values()) {
        channel.subscriptions.delete(subscriptionId);
        const removedStreams = [];
        for (const stream of groupedStreams) {
          const ids = channel.streamSubscriptions.get(stream);
          ids?.delete(subscriptionId);
          if (!ids?.size) {
            channel.streamSubscriptions.delete(stream);
            removedStreams.push(stream);
          }
        }
        this.queueCommand(channel, "UNSUBSCRIBE", removedStreams);
        if (channel.subscriptions.size) continue;
        channel.generation += 1;
        clearTimeout(channel.reconnectTimer);
        clearInterval(channel.heartbeatTimer);
        clearTimeout(channel.commandTimer);
        channel.commandTimer = null;
        channel.pendingCommands = [];
        channel.reconnectTimer = null;
        channel.heartbeatTimer = null;
        const socket = channel.socket;
        channel.socket = null;
        this.channels.delete(channelKey(channel.marketType, channel.streamClass));
        if (socket) {
          try { socket.close(1000, "unused"); } catch {}
        }
      }
    };
    return Object.freeze({ subscriptionId, dispose });
  }

  stats() {
    let subscriptions = 0;
    let streams = 0;
    let sockets = 0;
    for (const channel of this.channels.values()) {
      subscriptions += channel.subscriptions.size;
      streams += channel.streamSubscriptions.size;
      if (channel.socket) sockets += 1;
    }
    return Object.freeze({ channels: this.channels.size, subscriptions, streams, sockets });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.channels.values()) {
      channel.generation += 1;
      clearTimeout(channel.reconnectTimer);
      clearInterval(channel.heartbeatTimer);
      clearTimeout(channel.commandTimer);
      channel.commandTimer = null;
      channel.pendingCommands = [];
      const socket = channel.socket;
      channel.socket = null;
      if (socket) {
        try { socket.close(1001, "hub_shutdown"); } catch {}
      }
    }
    this.channels.clear();
  }
}

export { marketTypeValue as normalizeTradingMarketHubType, streamValue as normalizeTradingMarketHubStream };
