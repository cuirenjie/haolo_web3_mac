import { translateAppText } from "./app-language.mjs";
import type { BinanceAccountUiState } from "./binance-account-ui.ts";

export const PERFORMANCE_RANGES = [1, 7, 30, 90, 180, 365] as const;
type Sample = { timestamp: number; amount: number | null; rate: number | null };
export type AccountPerformance = {
  days: number;
  asOf?: number | null;
  status?: string;
  points: Sample[];
  stats: { totalAmount: number | null; totalRate: number | null };
  chart?: { startAt: number; endAt: number; points: Sample[] };
};
type PerformanceEntry = {
  data: AccountPerformance | null; loading: boolean; error: boolean;
  loadedAt: number; retryAfter: number; failures: number;
};
export type AccountPerformanceState = {
  days: number; mode: "amount" | "rate"; connectionId: string | null;
  entries: Record<number, PerformanceEntry>;
};
export const createAccountPerformanceState = (): AccountPerformanceState => ({
  days: 7, mode: "amount", connectionId: null, entries: {},
});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validTime = (value: unknown): value is number => finite(value) && value >= 0 && value <= 8.64e15;
const DAY = 86_400_000;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const text = (value: string) => escape(translateAppText(value));

export async function loadAccountPerformance(
  state: BinanceAccountUiState,
  read: ((params: { days: number }) => Promise<AccountPerformance>) | undefined,
  options: { force?: boolean; isCurrent: () => boolean; changed: () => void; credentialError: (error: unknown) => boolean },
) {
  const connectionId = state.status?.serverConnectionId || state.status?.connectionId || null;
  if (!state.status?.bound || !state.status.serverCredentialsBound || !connectionId || state.rebindRequired) return;
  if (state.performance.connectionId !== connectionId) {
    state.performance = { ...createAccountPerformanceState(), days: state.performance.days, mode: state.performance.mode, connectionId };
  }
  const performance = state.performance;
  const days = performance.days;
  const entry = performance.entries[days] ||= { data: null, loading: false, error: false, loadedAt: 0, retryAfter: 0, failures: 0 };
  if (entry.loading || Date.now() < entry.retryAfter || (!options.force && Date.now() - entry.loadedAt < 30_000)) return;
  const current = () => options.isCurrent() && state.performance === performance
    && state.status?.bound && state.status.serverCredentialsBound
    && (state.status.serverConnectionId || state.status.connectionId) === connectionId;
  entry.loading = true;
  entry.error = false;
  options.changed();
  try {
    if (!read) throw new Error("Account performance unavailable");
    const data = await read({ days });
    if (!current()) return;
    if (data?.days !== days || !Array.isArray(data.points) || !data.stats) throw new Error("Invalid account performance");
    // A pending archive sync cannot erase previously verified observations.
    if (!["syncing", "unavailable"].includes(data.status || "") || !entry.data) entry.data = data;
    entry.loadedAt = Date.now();
    entry.failures = 0;
    entry.retryAfter = 0;
  } catch (error) {
    if (!current() || options.credentialError(error)) return;
    entry.error = true;
    entry.failures += 1;
    const wait = Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0;
    entry.retryAfter = Date.now() + Math.max(wait, Math.min(60_000, 5_000 * 2 ** Math.min(4, entry.failures - 1)));
  } finally {
    if (current()) { entry.loading = false; options.changed(); }
  }
}

// Match mobile's reporting window and fallback rate basis. Unknown buckets
// remain gaps; the display clock never turns a cached sample into a new one.
export function accountProfitTimeline(data: AccountPerformance, days: number, mode: "amount" | "rate", equity: number | null, now = Date.now()) {
  const chart = data.chart;
  const hasChart = Array.isArray(chart?.points);
  const samples = hasChart ? chart!.points : data.points;
  const total = data.stats.totalAmount;
  const base = finite(equity) && equity > 0 && finite(total) ? (equity - total > 0 ? equity - total : equity) : null;
  const rate = (amount: number | null, value: number | null) => finite(value) ? value : finite(amount) && base ? amount / base * 100 : null;
  const latest = samples.reduce((time, p) => validTime(p?.timestamp) ? Math.max(time, p.timestamp) : time, 0);
  const dataEnd = Math.min(now, validTime(chart?.endAt) ? chart.endAt : validTime(data.asOf) ? data.asOf : latest || now);
  const start = Math.min(dataEnd, validTime(chart?.startAt) ? chart.startAt : Math.floor(dataEnd / DAY) * DAY - (days - 1) * DAY);
  const values = new Map<number, number | null>();
  for (const sample of samples) {
    if (!validTime(sample?.timestamp) || sample.timestamp > dataEnd) continue;
    const time = !hasChart && sample.timestamp % DAY === 0 ? Math.min(sample.timestamp + DAY - 1, dataEnd) : sample.timestamp;
    if (time < start) continue;
    const value = mode === "rate" ? rate(sample.amount, sample.rate) : sample.amount;
    values.set(time, finite(value) ? value : null);
  }
  const points = [...values].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp, value }));
  const segments: Array<Array<{ timestamp: number; value: number }>> = [];
  let segment: Array<{ timestamp: number; value: number }> = [];
  for (const point of points) {
    if (point.value === null || (segment.length && point.timestamp - segment[segment.length - 1].timestamp > (days === 1 ? DAY / 24 : DAY))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (point.value !== null) segment.push({ timestamp: point.timestamp, value: point.value });
  }
  if (segment.length) segments.push(segment);
  return { start, end: now, points, segments, total: mode === "rate" ? rate(total, data.stats.totalRate) : total };
}

export function renderAccountPerformance(state: BinanceAccountUiState) {
  const { days, mode } = state.performance;
  const connectionId = state.status?.serverConnectionId || state.status?.connectionId;
  const entry = connectionId === state.performance.connectionId ? state.performance.entries[days] : undefined;
  const label = (range: number) => range === 1 ? text("今日") : text("{days}日").replace("{days}", String(range));
  const controls = `<header class="binance-account-curve-toolbar">
    <label class="binance-account-curve-range"><select data-binance-performance-range aria-label="${text("选择周期")}">${PERFORMANCE_RANGES.map(range => `<option value="${range}" ${range === days ? "selected" : ""}>${label(range)}</option>`).join("")}</select><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3Z"/></svg></label>
    <div class="binance-account-curve-modes" role="group" aria-label="${text("收益类型")}">${(["rate", "amount"] as const).map(value => `<button type="button" data-binance-performance-mode="${value}" aria-pressed="${mode === value}">${text(value === "rate" ? "收益率" : "收益额")}</button>`).join("")}</div>
  </header>`;
  let content: string;
  if (!state.balancesVisible) {
    content = `<div class="binance-account-curve-empty" aria-label="${text("资产已隐藏")}">••••</div>`;
  } else if (entry?.data) {
    // Mobile's equity is the futures margin balance, not all-wallet assets.
    const timeline = accountProfitTimeline(entry.data, days, mode, state.snapshot?.marginBalance ?? null);
    content = timeline.segments.length ? renderProfitSvg(timeline, mode) : `<div class="binance-account-curve-empty">${text("暂无历史收益数据")}</div>`;
  } else if (entry?.loading) {
    content = `<div class="binance-account-curve-empty" role="status"><span class="binance-account-button-spinner" aria-hidden="true"></span>${text("正在加载收益曲线…")}</div>`;
  } else {
    content = `<div class="binance-account-curve-empty" role="status">${text(entry?.error ? "收益分析暂时不可用，请刷新重试" : "暂无历史收益数据")}${entry?.error ? `<button type="button" class="binance-account-quiet-button" data-binance-account-action="retry-performance">${text("重试")}</button>` : ""}</div>`;
  }
  return `<section class="binance-account-curve" aria-label="${text("收益曲线")}" aria-busy="${Boolean(entry?.loading)}">${controls}${content}</section>`;
}

function renderProfitSvg(timeline: ReturnType<typeof accountProfitTimeline>, mode: "amount" | "rate") {
  const { start, end, segments } = timeline;
  const samples = segments.flat();
  const last = samples[samples.length - 1];
  const peak = samples.reduce((a, b) => b.value > a.value ? b : a);
  const max = Math.max(0.01, ...samples.map(p => Math.abs(p.value))) * 1.25;
  const x = (time: number) => 64 + Math.max(0, Math.min(1, (time - start) / Math.max(1, end - start))) * 464;
  const y = (value: number) => 98 - value / max * 78;
  const n = (value: number) => value.toFixed(2);
  const format = (value: number, signed = false) => `${signed && value > 0 ? "+" : ""}${Math.abs(value) < .005 ? "0.00" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${mode === "rate" ? "%" : ""}`;
  const plots = segments.map(segment => {
    const points = [...segment];
    // Only extend a known tail; an explicit unknown tail stays disconnected.
    if (segment === segments[segments.length - 1] && timeline.points[timeline.points.length - 1]?.value !== null && last.timestamp < end) points.push({ ...last, timestamp: end });
    let path = `M${n(x(points[0].timestamp))},${n(y(points[0].value))}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const middle = (x(a.timestamp) + x(b.timestamp)) / 2;
      path += ` C${n(middle)},${n(y(a.value))} ${n(middle)},${n(y(b.value))} ${n(x(b.timestamp))},${n(y(b.value))}`;
    }
    const finish = points[points.length - 1];
    const positive = points.some(point => point.value > 0);
    const negative = points.some(point => point.value < 0);
    const tones = positive && negative ? ["positive", "negative"] : [negative ? "negative" : "positive"];
    // Clip the same smooth geometry at zero, so crossing points stay joined.
    return tones.map(tone => `<g class="binance-account-curve-segment ${tone}"${positive && negative ? ` clip-path="url(#account-profit-${tone})"` : ""}><path class="binance-account-curve-fill" d="${path} L${n(x(finish.timestamp))},98 L${n(x(points[0].timestamp))},98Z" fill="url(#account-profit-fill-${tone})"/><path class="binance-account-curve-line" d="${path}"/>${points.length === 1 ? `<circle cx="${n(x(points[0].timestamp))}" cy="${n(y(points[0].value))}" r="2.5" fill="currentColor"/>` : ""}</g>`).join("");
  }).join("");
  const marker = (point: typeof last, endpoint: boolean) => {
    const label = format(point.value, true);
    const width = Math.max(36, label.length * 6.6 + 10);
    const cx = endpoint ? 528 : x(point.timestamp);
    const left = Math.max(64, Math.min(560 - width, cx - width / 2));
    const top = endpoint ? y(point.value) - 10 : y(point.value) - 29;
    return `<g class="binance-account-curve-marker ${point.value >= 0 ? "positive" : "negative"}"><circle cx="${n(cx)}" cy="${n(y(point.value))}" r="3"/><rect x="${n(left)}" y="${n(top)}" width="${width}" height="20" rx="2"/><text x="${n(left + width / 2)}" y="${n(top + 14)}" text-anchor="middle">${escape(label)}</text></g>`;
  };
  const dateLabel = (time: number, endpoint = false) => {
    const date = new Date(time), today = new Date(end);
    const dayDiff = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / DAY);
    const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    if (endpoint) return `${translateAppText("今天")} ${clock}`;
    if (end - start < DAY && dayDiff === 0) return clock;
    return dayDiff === 0 ? translateAppText("今天") : dayDiff === 1 ? translateAppText("昨天") : `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const today = new Date(end);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const middle = end - start < 2 * DAY && x(midnight) > 164 && x(midnight) < 408 ? midnight : start + (end - start) / 2;
  const middleLabel = dateLabel(middle);
  const firstLabel = dateLabel(start);
  return `<svg class="binance-account-curve-chart" viewBox="0 0 560 210" role="img" aria-label="${text(mode === "rate" ? "收益率曲线" : "收益额曲线")}">
    <defs>
      <clipPath id="account-profit-positive"><rect x="0" y="0" width="560" height="98"/></clipPath>
      <clipPath id="account-profit-negative"><rect x="0" y="98" width="560" height="112"/></clipPath>
      <linearGradient id="account-profit-fill-positive" class="positive" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="98"><stop offset="0%" stop-color="currentColor" stop-opacity=".14"/><stop offset="100%" stop-color="currentColor" stop-opacity=".02"/></linearGradient>
      <linearGradient id="account-profit-fill-negative" class="negative" gradientUnits="userSpaceOnUse" x1="0" y1="98" x2="0" y2="176"><stop offset="0%" stop-color="currentColor" stop-opacity=".02"/><stop offset="100%" stop-color="currentColor" stop-opacity=".14"/></linearGradient>
    </defs>
    ${[1, .5, 0, -.5, -1].map(scale => `<g class="binance-account-curve-grid"><line x1="64" x2="528" y1="${n(y(scale * max))}" y2="${n(y(scale * max))}"/><text x="0" y="${n(y(scale * max) + 4)}">${escape(format(scale * max))}</text></g>`).join("")}
    ${plots}${peak !== last && x(last.timestamp) - x(peak.timestamp) > 70 ? marker(peak, false) : ""}${marker(last, true)}
    <g class="binance-account-curve-axis"><text x="64" y="204" text-anchor="middle">${escape(firstLabel)}</text>${middleLabel !== firstLabel ? `<text x="${n(x(middle))}" y="204" text-anchor="middle">${escape(middleLabel)}</text>` : ""}<text x="558" y="204" text-anchor="end">${escape(dateLabel(end, true))}</text></g>
  </svg>`;
}
