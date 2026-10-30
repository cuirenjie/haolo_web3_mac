import { tickerIdentity } from './trading-index-favorites.ts';

/** Device/account display preference. Never writes shared favorite membership. */
export class TradingTickerVisibility {
  private hidden = new Set<string>();
  private readonly key: string;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, account = '') {
    this.storage = storage;
    this.key = `haolo.trading.hidden-tickers.v1.${encodeURIComponent(account.trim().toLowerCase() || 'guest')}`;
    try {
      const saved = JSON.parse(storage.getItem(this.key) || '[]');
      if (Array.isArray(saved)) this.hidden = new Set(saved.filter(id => typeof id === 'string' && id.length <= 200).slice(-2000).map(tickerIdentity));
    } catch { /* A damaged display preference must not affect favorites. */ }
  }
  visible(id: string) { return !this.hidden.has(tickerIdentity(id)); }
  get count() { return this.hidden.size; }
  hide(id: string) { this.hidden.add(tickerIdentity(id)); this.save(); }
  show(id: string) { if (this.hidden.delete(tickerIdentity(id))) this.save(); }
  restore() { this.hidden.clear(); this.save(); }
  private save() {
    try { this.storage.setItem(this.key, JSON.stringify([...this.hidden])); }
    catch { /* Keep the current session usable if storage is full. */ }
  }
}

export function tickerVisibilityLabel(action: 'hide' | 'restore', language = 'zh-CN') {
  const copy: Record<string, [string, string]> = {
    en: ['Hide top tab', 'Restore hidden tabs'],
    'zh-Hant': ['隱藏頂部標籤', '恢復隱藏的標籤'],
    ko: ['상단 탭 숨기기', '숨긴 탭 복원'],
    ja: ['上部タブを非表示', '非表示のタブを再表示'],
    vi: ['Ẩn thẻ trên cùng', 'Hiện lại các thẻ đã ẩn'],
    'zh-CN': ['隐藏顶部标签', '恢复隐藏的标签'],
  };
  const key = /^zh-(TW|HK|Hant)/i.test(language) ? 'zh-Hant' : language.split('-')[0];
  return (copy[key] || copy['zh-CN'])[action === 'hide' ? 0 : 1];
}
