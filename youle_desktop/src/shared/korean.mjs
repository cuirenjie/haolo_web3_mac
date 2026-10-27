import { japaneseText, japaneseCopy } from './japanese.mjs';
import { KOREAN_CATALOG } from './korean-catalog.mjs';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slot = /\$?\{([\w.]+)\}/g;
const templates = Object.entries(KOREAN_CATALOG)
  .filter(([source]) => /\$?\{[\w.]+\}/.test(source)
    && !(/^\$?\{/.test(source) && (source.match(/\p{Script=Han}/gu)?.length || 0) <= 2))
  .map(([source, target]) => {
    const names = [...source.matchAll(slot)].map(match => match[1]);
    return { target, names, weight: source.replace(slot, '').length,
      pattern: new RegExp('^' + source.split(slot).filter((_, index) => index % 2 === 0)
        .map(escape).join('([^\\n]*?)') + '$', 'u') };
  }).sort((a, b) => b.weight - a.weight);
const phrases = Object.entries(KOREAN_CATALOG)
  .filter(([source]) => /\p{Script=Han}/u.test(source) && source.length > 1 && !/\$?\{[\w.]+\}/.test(source))
  .sort(([a], [b]) => b.length - a.length);

/** Localize application-authored presentation text only. Protocols and user text stay untouched. */
export function koreanText(value, depth = 0) {
  const source = String(value ?? '');
  const trimmed = source.trim();
  if (!trimmed || depth > 12) return source;
  if (/^[\d\s.,+−\-/%:()–—]+$/.test(trimmed)) return source;
  const duration = /^(\d+(?:\.\d+)?)\s*(天|秒)$/.exec(trimmed);
  if (duration) return source.replace(trimmed, duration[1] + (duration[2] === '天' ? '일' : '초'));
  const exact = KOREAN_CATALOG[trimmed];
  if (exact !== undefined) return source.replace(trimmed, exact);
  const marker = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.exec(trimmed)?.[0];
  if (marker) return source.replace(trimmed, marker + koreanText(trimmed.slice(marker.length), depth + 1));
  if (!/\p{Script=Han}/u.test(source)) return source;
  for (const { pattern, target, names } of templates) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, index) => [name, koreanText(match[index + 1], depth + 1)]));
    return source.replace(trimmed, target.replace(slot, (token, name) => values[name] ?? token));
  }
  if (source.includes('\n')) return source.split('\n').map(line => koreanText(line, depth + 1)).join('\n');
  let translated = source;
  for (const [from, to] of phrases) if (translated.includes(from)) translated = translated.split(from).join(to);
  return translated;
}

export function koreanCopy(value) {
  if (typeof value === 'string') return koreanText(value);
  if (typeof value === 'function') return (...args) => koreanCopy(value(...args));
  if (Array.isArray(value)) return value.map(koreanCopy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'lang' ? 'ko' : koreanCopy(item)]));
  return value;
}

export function withKoreanVariants(mapping) {
  const source = mapping['zh-CN'] ?? mapping.zh ?? mapping['zh-TW'] ?? mapping['zh-Hant'];
  return source === undefined ? mapping : {...mapping, ko: mapping.ko ?? koreanCopy(source), ja: mapping.ja ?? japaneseCopy(source)};
}

export function localizedChoice(choices, language) {
  return language === 'ja' ? japaneseText(choices[0]) : language === 'ko' ? koreanText(choices[0]) : choices[language === 'en' ? 1 : ['zh-TW', 'zh-Hant'].includes(language) ? 2 : 0];
}
