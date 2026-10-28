import { VIETNAMESE_CATALOG } from './vietnamese-catalog.mjs';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slot = /\$?\{([\w.]+)\}/g;
const entries = Object.entries(VIETNAMESE_CATALOG);
const templates = entries.filter(([source]) => /\$?\{[\w.]+\}/.test(source))
  .map(([source, target]) => ({ target,
    protectInput: /^(?:分析要求|你的问题|你的要求|用户输入|Analysis request|Your question|Your request)[:：]/.test(source),
    names: [...source.matchAll(slot)].map(match => match[1]),
    weight: source.replace(slot, '').length,
    pattern: new RegExp('^' + source.split(slot).filter((_, index) => index % 2 === 0).map(escape).join('([^\\n]*?)') + '$', 'u'),
  })).filter(item => item.weight > 2).sort((a, b) => b.weight - a.weight);
const phrases = entries.filter(([source]) => /\p{Script=Han}/u.test(source) && source.length > 1 && !/[{}]/.test(source))
  .sort(([a], [b]) => b.length - a.length);
const phrasePattern = phrases.length ? new RegExp(phrases.map(([source]) => escape(source)).join('|'), 'gu') : null;
const cache = new Map();

/** Application-authored presentation copy only. Never pass arbitrary API objects or user messages.
 * Enable translateSystemValues only for structured system-generated plan fields;
 * normal UI interpolation keeps captured user values verbatim. */
export function vietnameseText(value, translateSystemValues = false) {
  translateSystemValues = translateSystemValues === true;
  const source = String(value ?? '');
  const key = source.trim();
  if (!key || /^[\d\s.,+−\-/%:()–—]+$/.test(key)) return source;
  const cacheKey = `${translateSystemValues ? 'system:' : 'display:'}${source}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let translated = VIETNAMESE_CATALOG[key];
  const duration = /^(\d+(?:\.\d+)?)\s*(天|秒)$/.exec(key);
  if (translated === undefined && duration) translated = `${duration[1]} ${duration[2] === '天' ? 'ngày' : 'giây'}`;
  if (translated === undefined && source.includes('\n')) return source.split('\n').map(line=>vietnameseText(line,translateSystemValues)).join('\n');
  if (translated === undefined) {
    const marker = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.exec(key)?.[0];
    if (marker) return source.replace(key, () => marker + vietnameseText(key.slice(marker.length),translateSystemValues));
  }
  if (translated === undefined) {
    for (const template of templates) {
      const match = template.pattern.exec(key);
      if (!match) continue;
      const values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
      translated = template.target.replace(slot, (token, name) => values[name] === undefined ? token
        : translateSystemValues && !template.protectInput ? vietnameseText(values[name],true) : values[name]);
      break;
    }
  }
  if (translated === undefined && translateSystemValues && /[，；]/u.test(key))
    return source.split(/([，；])/u).map(part => part === '，' ? ', ' : part === '；' ? '; ' : vietnameseText(part,true)).join('');
  // A single replacement pass avoids recursively translating replacement text.
  // Already-localized Vietnamese and interpolated user content remain unchanged.
  if (translated === undefined && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(key) && phrasePattern)
    translated = key.replace(phrasePattern, match => VIETNAMESE_CATALOG[match]);
  const result = translated === undefined ? source : source.replace(key, () => translated);
  if (cache.size >= 6000) cache.clear();
  cache.set(cacheKey, result);
  return result;
}

export function vietnameseCopy(value) {
  if (typeof value === 'string') return vietnameseText(value);
  if (typeof value === 'function') return (...args) => vietnameseCopy(value(...args));
  if (Array.isArray(value)) return value.map(vietnameseCopy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'lang' ? 'vi' : vietnameseCopy(item)]));
  return value;
}

/** Validate prose without rewriting model output or financial evidence. */
export function isVietnameseProse(value) {
  const prose = String(value ?? '').normalize('NFC').replace(/```[\s\S]*?```|https?:\/\/\S+|`[^`]*`/g, '');
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prose)) return false;
  const words = prose.match(/[\p{Letter}]+/gu) || [];
  if (!words.length || /^[A-Z0-9\W_]*$/.test(prose)) return true;
  const vietnamese = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯư\u1ea0-\u1ef9]/u;
  return prose.split(/[.!?\n]+/u).every(part => {
    const count = (part.match(/[\p{Letter}]+/gu) || []).length;
    return count <= 3 || vietnamese.test(part) || /\b(?:của|và|cho|khi|vào|là|mua|bán|giá|lệnh|với|trong|không|cần|chờ|sau|theo)\b/iu.test(part);
  });
}
