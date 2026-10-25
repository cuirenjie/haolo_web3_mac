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

function scope(node, tier, transport, market, observation = {}) {
  tier = ["paid", "free"].includes(tier) ? tier : "unknown";
  market = ["spot", "futures"].includes(market) ? market : "other";
  transport = ["rest", "ws", "private_client", "private_upstream"].includes(transport) ? transport : "other";
  const payer = ["paid", "free"].includes(observation.payer) ? observation.payer : "unknown";
  const entitlement = ["active", "inactive"].includes(observation.entitlement) ? observation.entitlement : "unknown";
  const activity = ["foreground", "background", "service", "mixed"].includes(observation.activity) ? observation.activity : "unknown";
  return `node="${node}",tier="${tier}",transport="${transport}",market="${market}",classification="paid_or_gift_v1",payer="${payer}",entitlement="${entitlement}",activity="${activity}"`;
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
  record({ tier, transport, market, family = "other", codec = "json", legacy = false, bytes, jsonBytes = bytes,
    payer, entitlement, activity, candle = "other" }) {
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(jsonBytes) || jsonBytes < 0) return;
    family = families.has(family) ? family : "other";
    codec = ["hmc1", "hmc2", "hmz1"].includes(codec) ? codec : "json";
    candle = family === "kline" && ["open", "closed"].includes(candle) ? candle : "other";
    const labels = `${scope(this.node, tier, transport, market, { payer, entitlement, activity })},family="${family}",codec="${codec}",legacy="${Boolean(legacy)}",candle="${candle}"`;
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
    const provider = typeof labels === "function" ? labels : () => labels;
    const entry = { socket, provider, previous: provider(),
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
    const current = entry.provider();
    const observation = { ...current };
    // A sampling interval spanning a state transition cannot be attributed
    // wholly to either side. Keep it explicit instead of inventing precision.
    for (const key of ["payer", "entitlement", "activity"]) {
      if (current[key] !== entry.previous[key]) observation[key] = key === "activity" ? "mixed" : "unknown";
    }
    const labels = scope(this.node, current.tier, current.transport, current.market, observation);
    this.socketCounters.set(labels, (this.socketCounters.get(labels) || 0) + written - entry.written);
    entry.written = written;
    entry.previous = current;
  }
  sampleSockets() { for (const entry of this.sockets) this.sampleSocket(entry); }
  prometheus() {
    this.sampleSockets();
    return [`haolo_market_process_start_seconds ${this.startedAt}`,
      'haolo_market_traffic_schema_info{classification="paid_or_gift_v1"} 1',
      ...[...this.socketCounters].map(([labels, value]) => `haolo_market_socket_bytes_total{${labels}} ${value}`),
      ...[...this.counters].flatMap(([labels, counter]) => Object.entries(counter).map(([name, value]) =>
        `haolo_market_traffic_${name}{${labels}} ${value}`))].join("\n");
  }
}
