import { JAPANESE_CATALOG } from './japanese-catalog.mjs';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slot = /\$?\{([\w.]+)\}/g;
const entries = Object.entries(JAPANESE_CATALOG);
const templates = entries.filter(([source]) => /\$?\{[\w.]+\}/.test(source))
  .map(([source, target]) => ({ target,
    names: [...source.matchAll(slot)].map(match => match[1]),
    weight: source.replace(slot, '').length,
    pattern: new RegExp('^' + source.split(slot).filter((_, index) => index % 2 === 0).map(escape).join('([^\\n]*?)') + '$', 'u'),
  })).filter(item => item.weight > 2).sort((a, b) => b.weight - a.weight);
const phrases = entries.filter(([source]) => /\p{Script=Han}/u.test(source) && source.length > 1 && !/[{}]/.test(source))
  .sort(([a], [b]) => b.length - a.length);
const phrasePattern = phrases.length ? new RegExp(phrases.map(([source]) => escape(source)).join('|'), 'gu') : null;
const cache = new Map();

/** Application-authored presentation copy only. Never pass arbitrary API objects or user messages. */
export function japaneseText(value) {
  const source = String(value ?? '');
  const key = source.trim();
  if (!key || /^[\d\s.,+−\-/%:()–—]+$/.test(key)) return source;
  if (cache.has(source)) return cache.get(source);
  let translated = JAPANESE_CATALOG[key];
  if (translated === undefined && source.includes('\n')) return source.split('\n').map(japaneseText).join('\n');
  if (translated === undefined) {
    const marker = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.exec(key)?.[0];
    if (marker) return source.replace(key, () => marker + japaneseText(key.slice(marker.length)));
  }
  if (translated === undefined) {
    for (const template of templates) {
      const match = template.pattern.exec(key);
      if (!match) continue;
      const values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
      translated = template.target.replace(slot, (token, name) => values[name] ?? token);
      break;
    }
  }
  // A single replacement pass prevents Japanese kanji from being translated a second time.
  // Already-localized Japanese and interpolated user content remain unchanged.
  if (translated === undefined && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(key) && phrasePattern)
    translated = key.replace(phrasePattern, match => JAPANESE_CATALOG[match]);
  const result = translated === undefined ? source : source.replace(key, () => translated);
  if (cache.size >= 6000) cache.clear();
  cache.set(source, result);
  return result;
}

export function japaneseCopy(value) {
  if (typeof value === 'string') return japaneseText(value);
  if (typeof value === 'function') return (...args) => japaneseCopy(value(...args));
  if (Array.isArray(value)) return value.map(japaneseCopy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'lang' ? 'ja' : japaneseCopy(item)]));
  return value;
}

/** Kana distinguish Japanese sentences; short shared kanji labels and technical symbols are valid. */
export function isJapaneseProse(value) {
  const prose = String(value ?? '').replace(/```[\s\S]*?```|https?:\/\/\S+|`[^`]*`/g, '');
  if (/\p{Script=Hangul}|这|请|们|当前|账户|订单|价格|风险|设置|选择|没有|结论|确认|等待|数据|趋势|未收盘|做多|做空|渠道|分佣|提交|充值|登录|后台/u.test(prose)) return false;
  if (prose.split(/[。！？.!?\n]+/u).some(part => !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part) && (part.match(/\b[a-zA-Z]{2,}\b/g)?.length || 0) > 6)) return false;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prose)) return true;
  if (/[A-Za-z]{3}/.test(prose) && prose.trim().split(/\s+/).length > 4) return false;
  return (prose.match(/\p{Script=Han}/gu)?.length || 0) <= 8;
}
