// Finite label sets; no tokens, URLs, user IDs or symbols in metrics.
export function streamFamily(stream) {
  const name = String(stream).split("@")[1];
  if (name?.startsWith("kline_")) return "kline";
  return ["aggTrade", "ticker", "miniTicker", "bookTicker", "markPrice", "depth"].includes(name) ? name : "other";
}

const families = new Set(["aggTrade", "ticker", "miniTicker", "bookTicker", "markPrice", "depth", "kline",
  "exchangeInfo", "openInterest", "openInterestHist", "ratio", "other"]);
export function restFamily(url) {
  const path = String(url || "").split("?", 1)[0];
  if (/\/(?:ticker\/(?:24hr|price|bookTicker))$/.test(path)) return "ticker";
  if (path.endsWith("/klines")) return "kline";
  if (path.endsWith("/aggTrades")) return "aggTrade";
  if (path.endsWith("/premiumIndex")) return "markPrice";
  if (path.endsWith("Ratio")) return "ratio";
  const name = path.slice(path.lastIndexOf("/") + 1);
  return families.has(name) ? name : "other";
}

function scope(node, tier, transport, market) {
  tier = ["paid", "free"].includes(tier) ? tier : "unknown";
  market = ["spot", "futures"].includes(market) ? market : "other";
  transport = ["rest", "ws", "private_client", "private_upstream"].includes(transport) ? transport : "other";
  return `node="${node}",tier="${tier}",transport="${transport}",market="${market}"`;
}

export class TrafficMetrics {
  constructor(nodeTier = "shared") {
    this.node = ["paid", "free"].includes(nodeTier) ? nodeTier : "shared";
    this.counters = new Map();
    this.socketCounters = new Map();
    this.sockets = new Set();
    this.startedAt = Date.now() / 1000;
    this.timer = null;
  }
  record({ tier, transport, market, family = "other", codec = "json", legacy = false, bytes, jsonBytes = bytes }) {
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(jsonBytes) || jsonBytes < 0) return;
    family = families.has(family) ? family : "other";
    codec = codec === "hmc1" ? "hmc1" : "json";
    const labels = `${scope(this.node, tier, transport, market)},family="${family}",codec="${codec}",legacy="${Boolean(legacy)}"`;
    let counter = this.counters.get(labels);
    if (!counter) this.counters.set(labels, counter = { payload_bytes_total: 0, json_bytes_total: 0, messages_total: 0 });
    counter.payload_bytes_total += bytes;
    counter.json_bytes_total += jsonBytes;
    counter.messages_total++;
  }
  // Socket bytes include framing/compression; behind HAProxy they exclude its
  // public TLS/TCP overhead and are NOT CDT billing bytes. One sampler avoids
  // a callback/allocation for every market message and counts live connections.
  trackSocket(socket, labels) {
    const entry = { socket, labels: scope(this.node, labels.tier, labels.transport, labels.market),
      // Test doubles and a few early WebSocket lifecycle callbacks may not
      // expose the underlying net.Socket yet. Treat those as zero until the
      // socket is available instead of making the connection handler throw.
      written: Number(socket?.bytesWritten) || 0 };
    this.sockets.add(entry);
    if (!this.timer) {
      this.timer = setInterval(() => this.sampleSockets(), 1000);
      this.timer.unref?.();
    }
    return () => {
      if (!this.sockets.delete(entry)) return;
      this.sampleSocket(entry);
      if (!this.sockets.size) { clearInterval(this.timer); this.timer = null; }
    };
  }
  sampleSocket(entry) {
    const written = Number(entry.socket?.bytesWritten);
    if (!Number.isFinite(written) || written < entry.written) return;
    this.socketCounters.set(entry.labels, (this.socketCounters.get(entry.labels) || 0) + written - entry.written);
    entry.written = written;
  }
  sampleSockets() { for (const entry of this.sockets) this.sampleSocket(entry); }
  prometheus() {
    this.sampleSockets();
    return [`haolo_market_process_start_seconds ${this.startedAt}`,
      ...[...this.socketCounters].map(([labels, value]) => `haolo_market_socket_bytes_total{${labels}} ${value}`),
      ...[...this.counters].flatMap(([labels, counter]) => Object.entries(counter).map(([name, value]) =>
        `haolo_market_traffic_${name}{${labels}} ${value}`))].join("\n");
  }
}
