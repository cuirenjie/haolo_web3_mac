import { appLanguageLocale, getCurrentAppLanguage, translateAppText } from "./app-language.mjs";

export interface PublicMarketIndex {
  id: string;
  name: string;
  enName?: string;
  priority?: number | null;
  code: string;
  source?: string;
  sourceUrl?: string;
  description: string;
  intervalMs: number;
  value: number | null;
  changePercent: number | null;
  change24H?: number | null;
  updatedAt: number | null;
  fetchedAt?: number | null;
  status: "ready" | "stale" | "error";
  series: { time: number; value: number }[];
}
export interface PublicIndicesSnapshot {
  indices: PublicMarketIndex[];
  fetchedAt: number;
}

const INDEX_ENGLISH_COPY: Readonly<Record<string, string>> = Object.freeze({
  "恐惧与贪婪指数": "Fear & Greed Index",
  "BTC 多空人数比": "BTC long/short account ratio",
  "BTC 大户多空人数比": "BTC top-trader long/short account ratio",
  "BTC 大户多空持仓比": "BTC top-trader long/short position ratio",
  "ETH 多空人数比": "ETH long/short account ratio",
  "ETH 大户多空人数比": "ETH top-trader long/short account ratio",
  "ETH 大户多空持仓比": "ETH top-trader long/short position ratio",
  "0–100，数值越高表示市场情绪越贪婪；每日更新。": "0–100; higher values indicate greedier market sentiment; updated daily.",
  "持有净多仓的账户数 ÷ 持有净空仓的账户数。按小时采样；24H 涨幅为比值自身相对 24 小时前的变化。": "Net-long account count ÷ net-short account count. Sampled hourly; 24H change is the ratio's change versus 24 hours earlier.",
  "保证金余额前 20% 用户中，净多仓账户数 ÷ 净空仓账户数。按小时采样；24H 涨幅为比值自身相对 24 小时前的变化。": "Among users in the top 20% by margin balance, net-long account count ÷ net-short account count. Sampled hourly; 24H change is the ratio's change versus 24 hours earlier.",
  "保证金余额前 20% 用户中，多仓持仓量 ÷ 空仓持仓量。按小时采样；24H 涨幅为比值自身相对 24 小时前的变化。": "Among users in the top 20% by margin balance, long-position size ÷ short-position size. Sampled hourly; 24H change is the ratio's change versus 24 hours earlier.",
});

export function localizedIndexText(value: string) {
  const language = getCurrentAppLanguage();
  if (language === "en") return INDEX_ENGLISH_COPY[value] || translateAppText(value, language);
  return translateAppText(value, language);
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
      if (!this.disposed) this.onChange();
    }
  }
  destroy() {
    this.disposed = true;
    this.active = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
  }
}

const fearGreed = (index: PublicMarketIndex) => index.id === "alternative:fng" || index.id === "index:fear-greed";
export const indexCopy = (zh: string, en: string) => appLanguageLocale() === "en-US" ? en : translateAppText(zh);
export const indexName = (index: PublicMarketIndex) => {
  if (appLanguageLocale() !== "en-US") return translateAppText(index.name);
  const name = index.enName || localizedIndexText(index.name);
  // A few provider en_name fields still contain Chinese. Retain the verifiable
  // symbol when an English name is absent rather than inventing a translation.
  return /\p{Script=Han}/u.test(name) ? (/\p{Script=Han}/u.test(index.code) ? index.id : index.code) : name;
};
export const indexFullValue = (index: PublicMarketIndex) => index.value === null ? "--" : index.value.toLocaleString(appLanguageLocale(), { maximumFractionDigits: 12 });
export const indexValue = (index: PublicMarketIndex) => {
  if (index.value === null) return "--";
  const magnitude = Math.abs(index.value);
  if (magnitude > 0 && magnitude < 0.0001) return index.value.toExponential(2);
  if (magnitude >= 10_000) return index.value.toLocaleString(appLanguageLocale(), { notation: "compact", maximumSignificantDigits: 5 });
  return index.value.toLocaleString(appLanguageLocale(), fearGreed(index)
    ? { maximumFractionDigits: 0 }
    : { maximumFractionDigits: 4, maximumSignificantDigits: 6 });
};
export const indexChange = (index: PublicMarketIndex) => index.changePercent === null ? "--" : `${index.changePercent >= 0 ? "+" : ""}${index.changePercent.toFixed(2)}%`;
export const indexTime = (time: number | null) => time ? new Date(time).toLocaleString(appLanguageLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : indexCopy("暂无数据", "No data");
export const indexStatus = (index: PublicMarketIndex) => {
  const frequency = { 60_000: ["每分钟", "Every minute"], 3_600_000: ["每时", "Hourly"], 86_400_000: ["每日", "Daily"], 604_800_000: ["每周", "Weekly"] }[index.intervalMs];
  return frequency ? indexCopy(frequency[0], frequency[1]) : "";
};
export const indexTiming = (index: PublicMarketIndex) => index.updatedAt
  ? `${indexCopy("数据时间", "Data time")} ${indexTime(index.updatedAt)}`
  : `${indexCopy("获取时间", "Fetched")} ${indexTime(index.fetchedAt ?? null)}`;
export const indexPeriodNote = () => indexCopy("涨跌幅为24小时口径。", "Changes cover 24 hours.");
