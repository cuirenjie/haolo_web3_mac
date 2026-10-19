import type { PublicMarketIndex } from './trading-public-indices.ts';

const indexId = /^index:[a-z0-9][a-z0-9-]{0,79}$/;
export const tickerIdentity = (id: string) => /^index:/i.test(id) ? id.toLowerCase() : id.toUpperCase();
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function indexRecord(value: unknown): PublicMarketIndex | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as PublicMarketIndex;
  if (!indexId.test(item.id) || typeof item.name !== 'string' || typeof item.code !== 'string') return null;
  return {
    id: item.id, name: item.name.slice(0, 160), enName: String(item.enName || item.code).slice(0, 160),
    code: item.code.slice(0, 80), description: '', intervalMs: number(item.intervalMs) || 0,
    value: number(item.value), changePercent: number(item.changePercent), change24H: number(item.change24H),
    updatedAt: number(item.updatedAt), fetchedAt: number(item.fetchedAt),
    status: item.status === 'ready' ? 'ready' : item.value == null ? 'error' : 'stale', series: [],
  };
}

/** Title-bar favorites are local/account-scoped, like ordinary star tickers.
 * Index identities never enter exchange subscriptions or the trading API. */
export class TradingIndexFavorites {
  private records = new Map<string, PublicMarketIndex>();
  private order: string[] = [];
  private readonly key: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, account = '') {
    this.storage = storage;
    this.key = `haolo.trading.index-favorites.v1.${encodeURIComponent(account.trim().toLowerCase() || 'guest')}`;
    try {
      const saved = JSON.parse(storage.getItem(this.key) || '{}');
      for (const raw of (Array.isArray(saved.indices) ? saved.indices : []).slice(0, 200)) {
        const item = indexRecord(raw);
        if (item) { item.status = item.value == null ? 'error' : 'stale'; this.records.set(item.id, item); }
      }
      this.order = Array.isArray(saved.order) ? saved.order.filter((id: unknown) => typeof id === 'string').map(tickerIdentity).slice(0, 400) : [];
    } catch { /* A corrupt local preference must not block the chart. */ }
  }
  get(id: string) { return this.records.get(tickerIdentity(id)); }
  values() { return [...this.records.values()]; }
  add(item: PublicMarketIndex) {
    const record = indexRecord(item);
    if (!record) return;
    this.records.set(record.id, record); this.save();
  }
  refresh(items: PublicMarketIndex[]) {
    let changed = false;
    for (const item of items) if (this.records.has(item.id)) {
      const record = indexRecord(item);
      if (record) { this.records.set(record.id, record); changed = true; }
    }
    if (changed) this.save();
    return changed;
  }
  remove(id: string) {
    const key = tickerIdentity(id);
    this.records.delete(key); this.order = this.order.filter(item => item !== key); this.save();
  }
  reorder(ids: string[]) { this.order = [...new Set(ids.map(tickerIdentity))]; this.save(); }
  sort<T extends {id: string}>(items: T[]): T[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const ids = [...new Set([...this.order, ...byId.keys()])];
    return ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  }
  private save() {
    try { this.storage.setItem(this.key, JSON.stringify({indices: this.values(), order: this.order})); }
    catch { /* Selection and removal remain usable when local storage is full. */ }
  }
}
