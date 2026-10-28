import { vietnamesePanelCopy } from './panel-copy-vi.js';
import { japanesePanelCopy } from './panel-copy-ja.js';
import { panelCopy } from './panel-copy.js';
let activeLanguage = globalThis.chrome?.i18n?.getUILanguage?.() || 'zh-CN';
export function setPanelLanguage(language) { activeLanguage = language || activeLanguage; }
export function panelLanguage() { return /^vi/i.test(activeLanguage) ? 'vi' : /^ja/i.test(activeLanguage) ? 'ja' : /^ko/i.test(activeLanguage) ? 'ko' : /^zh[-_](TW|HK|MO|Hant)/i.test(activeLanguage) ? 'zh-TW' : /^zh/i.test(activeLanguage) ? 'zh-CN' : 'en'; }
export function taskMessage(text, language = activeLanguage, values = []) {
  const row = panelCopy[text] || Object.values(panelCopy).find(row => row[0] === text || row[1] === text || row[2] === text);
  const source = panelCopy[text] ? text : Object.keys(panelCopy).find(key => panelCopy[key] === row) || text;
  const value = /^vi/i.test(language) ? (vietnamesePanelCopy[source] || text) : /^ja/i.test(language) ? (japanesePanelCopy[source] || text) : !row ? text : /^ko/i.test(language) ? row[2] : /^zh[-_](?:TW|HK|MO|Hant)/i.test(language) ? row[1] : /^zh/i.test(language) ? source : row[0];
  return String(value).replace(/\{(\d+)\}/g, (token,index) => values[index] === undefined ? token : String(values[index]));
}
