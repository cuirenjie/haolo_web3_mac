const VALUES = new Set(["foreground", "background", "service", "mixed", "unknown"]);
export const trafficActivity = value => VALUES.has(value) ? value : "unknown";
export function combinedActivity(values) {
  const unique = new Set(values.map(trafficActivity));
  if (!unique.size || unique.has("unknown")) return "unknown";
  return unique.size === 1 ? [...unique][0] : "mixed";
}
export class TrafficActivity {
  constructor(now = Date.now) { this.now = now; this.until = 0; this.streams = new Map(); }
  update(message, subscribed) {
    if (message.version !== 1 || !Array.isArray(message.streams) || message.streams.length > 500) return false;
    const next = new Map();
    for (const row of message.streams) {
      if (!row || !subscribed.has(row.stream) || !VALUES.has(row.activity)) continue;
      next.set(row.stream, row.activity);
    }
    this.streams = next;
    this.until = this.now() + 45_000;
    return true;
  }
  get(stream) { return this.until > this.now() ? this.streams.get(stream) || "unknown" : "unknown"; }
  combined(subscribed) { return combinedActivity([...subscribed].map(stream => this.get(stream))); }
}
export function candleState(event) {
  const value = event?.data?.k;
  if (event?.data?.e !== "kline" || typeof value?.x !== "boolean") return "other";
  return value.x ? "closed" : "open";
}
