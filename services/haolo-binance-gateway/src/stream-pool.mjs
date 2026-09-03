import WebSocket from "ws";

const STREAM_PATTERN = /^[a-z0-9_\p{Script=Han}]{2,40}@(kline_(?:1s|[1-9]\d*[mhdwM])|ticker|miniTicker|aggTrade|bookTicker|markPrice(?:@1s)?)$/u;

export function validateStreamName(value) {
  const stream = String(value || "").trim();
  if (!STREAM_PATTERN.test(stream)) throw new TypeError(`unsupported Binance stream: ${stream}`);
  return stream;
}

export function streamClassForName(value) {
  const stream = validateStreamName(value);
  return /@bookTicker$/.test(stream) ? "public" : "market";
}

export class BinanceStreamPool {
  constructor({ config, WebSocketImpl = WebSocket, now = () => Date.now() } = {}) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.channels = new Map();
    this.requestId = 1;
    this.metrics = { messages: 0, reconnects: 0, upstreamSockets: 0, subscriptions: 0 };
  }

  upstreamUrl(marketType, streamClass = "market") {
    if (marketType === "futures" && streamClass === "public") {
      return this.config.futuresPublicWebSocketUrl || this.config.futuresWebSocketUrl;
    }
    return marketType === "futures" ? this.config.futuresWebSocketUrl : this.config.spotWebSocketUrl;
  }

  channelKey(marketType, streamClass) {
    return `${marketType}:${streamClass}`;
  }

  channelsFor(marketType, streamClass = "market") {
    const key = this.channelKey(marketType, streamClass);
    if (!this.channels.has(key)) this.channels.set(key, []);
    return this.channels.get(key);
  }

  selectChannel(marketType, streamClass = "market") {
    const channels = this.channelsFor(marketType, streamClass);
    const available = channels.find((channel) => channel.streams.size < this.config.maxStreamsPerUpstreamSocket);
    if (available) return available;
    const channel = {
      marketType,
      streamClass,
      streams: new Map(),
      socket: null,
      reconnectTimer: null,
      rotateTimer: null,
      reconnectAttempt: 0,
      closed: false,
      pendingCommands: [],
      commandTimer: null,
    };
    channels.push(channel);
    return channel;
  }

  subscribe(marketType, streamValue, listener) {
    if (!["spot", "futures"].includes(marketType)) throw new TypeError("invalid marketType");
    const stream = validateStreamName(streamValue);
    const streamClass = streamClassForName(stream);
    let channel = this.channelsFor(marketType, streamClass).find((entry) => entry.streams.has(stream));
    if (!channel) channel = this.selectChannel(marketType, streamClass);
    let listeners = channel.streams.get(stream);
    const first = !listeners;
    if (!listeners) {
      listeners = new Set();
      channel.streams.set(stream, listeners);
      this.metrics.subscriptions += 1;
    }
    listeners.add(listener);
    if (first) this.queueCommand(channel, "SUBSCRIBE", [stream]);
    this.connect(channel);
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      channel.streams.delete(stream);
      this.metrics.subscriptions = Math.max(0, this.metrics.subscriptions - 1);
      this.queueCommand(channel, "UNSUBSCRIBE", [stream]);
      if (!channel.streams.size) this.closeChannel(channel);
    };
  }

  queueCommand(channel, method, streams) {
    channel.pendingCommands.push({ method, streams });
    if (channel.commandTimer) return;
    channel.commandTimer = setTimeout(() => {
      channel.commandTimer = null;
      this.flushCommands(channel);
    }, 250);
    channel.commandTimer.unref?.();
  }

  flushCommands(channel) {
    if (channel.socket?.readyState !== (this.WebSocketImpl.OPEN ?? 1)) return;
    const intents = new Map();
    for (const command of channel.pendingCommands.splice(0)) {
      command.streams.forEach((stream) => intents.set(stream, command.method));
    }
    const grouped = new Map();
    for (const [stream, method] of intents) {
      if (!grouped.has(method)) grouped.set(method, []);
      grouped.get(method).push(stream);
    }
    for (const [method, streams] of grouped) {
      if (!streams.length) continue;
      channel.socket.send(JSON.stringify({ method, params: streams, id: this.requestId++ }));
    }
  }

  connect(channel) {
    if (channel.closed || channel.socket || !channel.streams.size) return;
    const socket = new this.WebSocketImpl(this.upstreamUrl(channel.marketType, channel.streamClass), { perMessageDeflate: false });
    channel.socket = socket;
    this.metrics.upstreamSockets += 1;
    socket.on("open", () => {
      if (channel.socket !== socket || channel.closed) return;
      channel.reconnectAttempt = 0;
      channel.pendingCommands = [{ method: "SUBSCRIBE", streams: [...channel.streams.keys()] }];
      this.flushCommands(channel);
      clearTimeout(channel.rotateTimer);
      channel.rotateTimer = setTimeout(() => {
        if (channel.socket === socket) socket.close(1012, "scheduled_rotation");
      }, this.config.upstreamRotationMs);
      channel.rotateTimer.unref?.();
    });
    socket.on("ping", (payload) => {
      try { socket.pong(payload); } catch {}
    });
    socket.on("message", (payload) => {
      if (channel.socket !== socket || channel.closed) return;
      let parsed;
      try { parsed = JSON.parse(String(payload)); } catch { return; }
      const stream = String(parsed?.stream || "");
      if (!stream || !channel.streams.has(stream)) return;
      this.metrics.messages += 1;
      const event = Object.freeze({ stream, data: parsed.data, receivedAt: this.now() });
      for (const listener of channel.streams.get(stream) || []) listener(event);
    });
    socket.on("error", () => {
      try { socket.close(); } catch {}
    });
    socket.on("close", () => {
      if (channel.socket !== socket) return;
      channel.socket = null;
      this.metrics.upstreamSockets = Math.max(0, this.metrics.upstreamSockets - 1);
      clearTimeout(channel.rotateTimer);
      channel.rotateTimer = null;
      if (channel.closed || !channel.streams.size) return;
      this.metrics.reconnects += 1;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(channel.reconnectAttempt++, 6)) + Math.floor(Math.random() * 250);
      channel.reconnectTimer = setTimeout(() => {
        channel.reconnectTimer = null;
        this.connect(channel);
      }, delay);
      channel.reconnectTimer.unref?.();
    });
  }

  closeChannel(channel) {
    channel.closed = true;
    clearTimeout(channel.reconnectTimer);
    clearTimeout(channel.rotateTimer);
    clearTimeout(channel.commandTimer);
    channel.reconnectTimer = null;
    channel.rotateTimer = null;
    channel.commandTimer = null;
    const channels = this.channelsFor(channel.marketType, channel.streamClass);
    const index = channels.indexOf(channel);
    if (index >= 0) channels.splice(index, 1);
    if (!channels.length) this.channels.delete(this.channelKey(channel.marketType, channel.streamClass));
    const socket = channel.socket;
    channel.socket = null;
    if (socket) {
      this.metrics.upstreamSockets = Math.max(0, this.metrics.upstreamSockets - 1);
      try { socket.close(1000, "unused"); } catch {}
    }
  }

  stats() {
    // Keep the legacy `markets` metric as the number of active market types;
    // the map is now split by market/public stream class, so its raw size can
    // be larger for one Futures market. This avoids breaking dashboards while
    // still allowing class-level pooling internally.
    const marketTypes = new Set();
    for (const channels of this.channels.values()) {
      for (const channel of channels) marketTypes.add(channel.marketType);
    }
    return Object.freeze({ ...this.metrics, markets: marketTypes.size });
  }

  async close() {
    for (const channels of this.channels.values()) {
      for (const channel of [...channels]) this.closeChannel(channel);
    }
    this.channels.clear();
  }
}
