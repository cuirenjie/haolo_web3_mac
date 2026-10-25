// Read-only Prometheus report. No account IDs, credentials, or cost projection.
import { pathToFileURL } from "node:url";

const ratio = (part, total) => total > 0 ? part / total : null;
export function summarizeAttribution(vector) {
  const groups = [];
  const payerBytes = { paid: 0, free: 0, unknown: 0 };
  const activityBytes = { foreground: 0, background: 0, service: 0, mixed: 0, unknown: 0 };
  const entitlementBytes = { active: 0, inactive: 0, unknown: 0 };
  let total = 0, versioned = 0;
  let freeOpenKline = 0, freeBackgroundTicker = 0;
  for (const row of vector) {
    const bytes = Number(row.value?.[1]);
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid Prometheus byte value");
    const m = row.metric || {}, current = m.classification === "paid_or_gift_v1";
    const payer = current && Object.hasOwn(payerBytes, m.payer) ? m.payer : "unknown";
    const activity = current && Object.hasOwn(activityBytes, m.activity) ? m.activity : "unknown";
    const entitlement = current && Object.hasOwn(entitlementBytes, m.entitlement) ? m.entitlement : "unknown";
    total += bytes;
    if (current) versioned += bytes;
    payerBytes[payer] += bytes; activityBytes[activity] += bytes; entitlementBytes[entitlement] += bytes;
    groups.push({ payer, entitlement, activity, transport: m.transport || "unknown",
      market: m.market || "unknown", family: m.family || "unknown", candle: m.candle || "unknown", bytes });
    if (payer === "free" && m.transport === "ws") {
      if (m.family === "kline" && m.candle === "open") freeOpenKline += bytes;
      if (["ticker", "miniTicker", "bookTicker", "markPrice"].includes(m.family) && activity === "background") freeBackgroundTicker += bytes;
    }
  }
  return { total_bytes: total, payer_bytes: payerBytes, activity_bytes: activityBytes,
    entitlement_bytes: entitlementBytes, instrumentation_coverage: ratio(versioned, total),
    payer_coverage: ratio(payerBytes.paid + payerBytes.free, total),
    activity_coverage: ratio(total - activityBytes.unknown, total),
    free_share_all_bytes: ratio(payerBytes.free, total),
    free_share_known_payers: ratio(payerBytes.free, payerBytes.free + payerBytes.paid),
    free_share_bounds: [ratio(payerBytes.free, total), ratio(payerBytes.free + payerBytes.unknown, total)],
    // These are candidate *application* bytes, not a predicted wire saving.
    free_open_kline_bytes: freeOpenKline, free_background_quote_bytes: freeBackgroundTicker,
    groups };
}

export async function trafficAttributionReport({ origin, start, end, fetchImpl = globalThis.fetch }) {
  const from = Date.parse(start), to = Date.parse(end), seconds = Math.ceil((to - from) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 31 * 86400) throw new Error("Use an explicit 1-minute to 31-day time window");
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid Prometheus origin");
  const query = async expression => {
    const url = new URL("/api/v1/query", base);
    url.searchParams.set("query", expression); url.searchParams.set("time", String(to / 1000));
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Prometheus HTTP ${response.status}`);
    const body = await response.json();
    if (body.status !== "success" || body.data?.resultType !== "vector") throw new Error("Prometheus query failed");
    if (body.warnings?.length) throw new Error("Prometheus returned a partial result warning");
    return body.data.result;
  };
  const dimensions = "classification,payer,entitlement,activity,transport,market,family,candle";
  const [payload, socket, scrape] = await Promise.all([
    query(`sum by (${dimensions}) (increase(haolo_market_traffic_payload_bytes_total{job="haolo-market",transport=~"ws|rest"}[${seconds}s]))`),
    query(`sum by (${dimensions}) (increase(haolo_market_socket_bytes_total{job="haolo-market",transport="ws"}[${seconds}s]))`),
    query(`min_over_time(up{job="haolo-market"}[${seconds}s])`),
  ]);
  return { version: 1, start: new Date(from).toISOString(), end: new Date(to).toISOString(),
    application: summarizeAttribution(payload), websocket_socket: summarizeAttribution(socket),
    scrape_targets_seen: scrape.length,
    scrape_failed_targets: scrape.filter(row => Number(row.value[1]) !== 1).length,
    notes: ["Prometheus increase extrapolates between scrapes; missing scrapes and missing targets need independent review.",
      "Old/unclassified instances remain in the denominator as unknown. No historical backfill is inferred.",
      "Application and WebSocket socket bytes overlap: never add them. Neither equals public-cloud billing bytes.",
      "Visibility describes native windows; service/mixed/unknown traffic is not assumed removable background traffic.",
      "REST activity is the initiating consumer at request start; shared cache/request consumers cannot be attributed afterwards."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, start, end] = process.argv.slice(2);
  try { console.log(JSON.stringify(await trafficAttributionReport({ origin, start, end }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
