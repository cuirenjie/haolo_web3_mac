// Finite label sets; no tokens, URLs, user IDs or symbols in metrics.
export function streamFamily(stream) {
  const name = String(stream).split("@")[1];
  if (name?.startsWith("kline_")) return "kline";
  return ["aggTrade", "ticker", "miniTicker", "bookTicker", "markPrice", "depth"].includes(name) ? name : "other";
}

export class TrafficMetrics {
  constructor(nodeTier = "shared") {
    this.node = ["paid", "free"].includes(nodeTier) ? nodeTier : "shared";
    this.counters = new Map();
  }
  record({ tier, transport, market, family = "other", codec = "json", legacy = false, bytes, jsonBytes = bytes }) {
    tier = ["paid", "free"].includes(tier) ? tier : "unknown";
    market = ["spot", "futures"].includes(market) ? market : "other";
    const labels = `node="${this.node}",tier="${tier}",transport="${transport}",market="${market}",family="${family}",codec="${codec}",legacy="${legacy}"`;
    let counter = this.counters.get(labels);
    if (!counter) this.counters.set(labels, counter = { payload_bytes_total: 0, json_bytes_total: 0, messages_total: 0 });
    counter.payload_bytes_total += bytes;
    counter.json_bytes_total += jsonBytes;
    counter.messages_total++;
  }
  prometheus() {
    return [...this.counters].flatMap(([labels, counter]) => Object.entries(counter).map(([name, value]) =>
      `haolo_market_traffic_${name}{${labels}} ${value}`)).join("\n");
  }
}
