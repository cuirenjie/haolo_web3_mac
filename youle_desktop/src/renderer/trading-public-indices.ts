export interface PublicMarketIndex {
  id: string;
  name: string;
  code: string;
  source: string;
  sourceUrl: string;
  description: string;
  intervalMs: number;
  value: number | null;
  changePercent: number | null;
  updatedAt: number | null;
  status: "ready" | "stale" | "error";
  series: { time: number; value: number }[];
}
export interface PublicIndicesSnapshot {
  indices: PublicMarketIndex[];
  fetchedAt: number;
}

export class TradingPublicIndices {
  indices: PublicMarketIndex[] = [];
  loading = false;
  failed = false;
  private active = false;
  private started = false;
  private disposed = false;
  private timer: number | null = null;
  private readonly onChange: () => void;
  constructor(onChange: () => void) {
    this.onChange = onChange;
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.schedule();
    queueMicrotask(() => { if (!document.hidden) void this.refresh(); });
  }
  private schedule() {
    if (this.timer !== null) window.clearInterval(this.timer);
    // Keep the cache warm even when another watchlist category is selected.
    this.timer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, this.active ? 60_000 : 300_000);
  }
  setActive(active: boolean) {
    if (this.active === active || this.disposed) return;
    this.active = active;
    if (this.started) this.schedule();
  }
  private visibilityChanged = () => {
    if (this.started && !document.hidden) void this.refresh();
  };
  async refresh() {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      const snapshot = await window.codexDesktop?.getPublicMarketIndices?.();
      if (!snapshot || !Array.isArray(snapshot.indices) || !snapshot.indices.length) throw Error("Index service unavailable");
      if (this.disposed) return;
      this.indices = snapshot.indices;
      this.failed = false;
    } catch {
      this.failed = true;
      this.indices = this.indices.map(index => ({ ...index, status: index.value === null ? "error" : "stale" }));
    } finally {
      this.loading = false;
      if (!this.disposed && this.active) this.onChange();
    }
  }
  destroy() {
    this.disposed = true;
    this.active = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
  }
}

export const indexValue = (index: PublicMarketIndex) => index.value === null ? "--" : index.value.toLocaleString("zh-CN", { maximumFractionDigits: index.id === "alternative:fng" ? 0 : 4 });
export const indexChange = (index: PublicMarketIndex) => index.changePercent === null ? "--" : `${index.changePercent >= 0 ? "+" : ""}${index.changePercent.toFixed(2)}%`;
export const indexTime = (time: number | null) => time ? new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "暂无数据";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function indexSourceLink(index: PublicMarketIndex) {
  return `<a href="${escape(index.sourceUrl)}" data-index-source="${escape(index.sourceUrl)}">${escape(index.source)}</a>`;
}

function renderHistory(index: PublicMarketIndex) {
  const series = index.series;
  if (!series.length) return '<p class="trading-index-empty">暂无历史数据</p>';
  const minimum = Math.min(...series.map(point => point.value));
  const maximum = Math.max(...series.map(point => point.value));
  const padding = Math.max((maximum - minimum) * 0.12, maximum * 0.01, 0.01);
  const lo = index.id === "alternative:fng" ? 0 : Math.max(0, minimum - padding);
  const hi = index.id === "alternative:fng" ? 100 : maximum + padding;
  const first = series[0].time;
  const last = series.at(-1)!.time;
  const x = (time: number) => 54 + (time - first) / Math.max(last - first, 1) * 516;
  const y = (value: number) => 18 + (hi - value) / (hi - lo) * 182;
  const path = series.map((point, i) => `${i ? "L" : "M"}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const label = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: index.id === "alternative:fng" ? 0 : 3 });
  return `<svg class="trading-index-chart" viewBox="0 0 600 238" role="img" aria-label="${escape(index.name)}历史走势，最低${label(minimum)}，最高${label(maximum)}">
    ${[lo, (hi + lo) / 2, hi].map(value => `<line x1="54" x2="570" y1="${y(value)}" y2="${y(value)}"/><text x="46" y="${y(value) + 4}" text-anchor="end">${label(value)}</text>`).join("")}
    <path d="${path}"/><circle cx="${x(last)}" cy="${y(series.at(-1)!.value)}" r="3"/>
    <text x="54" y="226">${escape(indexTime(first))}</text><text x="570" y="226" text-anchor="end">${escape(indexTime(last))}</text>
  </svg>`;
}

export function openIndexHistory(index: PublicMarketIndex, onClose: () => void) {
  const dialog = document.createElement("dialog");
  dialog.className = "trading-watchlist-dialog trading-index-dialog";
  dialog.setAttribute("aria-label", `${index.name}历史走势`);
  dialog.innerHTML = `<header><h2>${escape(index.name)}</h2><button type="button" data-index-close aria-label="关闭">×</button></header>
    <div class="trading-index-summary"><strong>${indexValue(index)}</strong><span class="${(index.changePercent || 0) < 0 ? "negative" : "positive"}">24H ${indexChange(index)}</span></div>
    <p class="trading-index-meta">${index.status === "stale" ? "更新延迟 · " : index.status === "error" ? "暂时无法获取 · " : ""}数据时间 ${indexTime(index.updatedAt)} · ${index.intervalMs === 86_400_000 ? "每日更新" : "每小时采样"}</p>
    ${renderHistory(index)}<p class="trading-index-description">${escape(index.description)}</p>
    <p class="trading-index-attribution">数据来源：${indexSourceLink(index)}</p>`;
  dialog.querySelector("[data-index-close]")!.addEventListener("click", () => dialog.close());
  dialog.querySelector<HTMLAnchorElement>("[data-index-source]")!.addEventListener("click", event => {
    event.preventDefault();
    void window.codexDesktop?.openExternal(index.sourceUrl).catch(() => {});
  });
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
