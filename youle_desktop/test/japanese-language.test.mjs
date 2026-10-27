import test from 'node:test';
import assert from 'node:assert/strict';
import { japaneseText, isJapaneseProse } from '../src/shared/japanese.mjs';
import { APP_LANGUAGES, normalizeAppLanguage, translateAppText, appLanguageOptions } from '../src/renderer/app-language.mjs';
import { panelCopy } from '../extensions/haolo-chrome/panel-copy.js';
import { japanesePanelCopy } from '../extensions/haolo-chrome/panel-copy-ja.js';
import { taskMessage, setPanelLanguage, panelLanguage } from '../extensions/haolo-chrome/task-messages.js';
import { normalizeAssistantOutputLanguage, withAssistantOutputLanguageMessage } from '../src/main/assistant-output-language.mjs';

test('Japanese locale, native setting label and professional output contract', () => {
  assert.ok(APP_LANGUAGES.includes('ja'));
  assert.match(withAssistantOutputLanguageMessage([{role:'user',content:'分析してください'}],'ja')[0].content,/professional Japanese/);
  assert.ok(appLanguageOptions().some(row => row.value === 'ja' && row.label === '日本語'));
  for(const locale of ['ja','ja-JP','ja_JP']) {
    assert.equal(normalizeAppLanguage(locale),'ja');
    assert.equal(normalizeAssistantOutputLanguage(locale),'ja');
  }
  assert.notEqual(translateAppText('交易偏好','ja'),'交易偏好');
  assert.equal(translateAppText('你的','en'),'Your');
  assert.match(translateAppText('请稍后重试','ja'), /[ぁ-ヿ]/u);
});

test('Japanese permits kanji and kana while refusing foreign prose', () => {
  assert.ok(isJapaneseProse('価格が 123.45 を上回るまで待ちます。注文は送信されていません。'));
  assert.ok(isJapaneseProse('取引履歴'));
  assert.ok(isJapaneseProse('BTCUSDT 123.45 USDT'));
  for(const text of ['这是中文结论，请等待价格突破后确认。','Wait for a confirmed breakout before entering.','확인을 기다리세요.']) assert.equal(isJapaneseProse(text),false,text);
});

test('numbers, identifiers and captured user values are retained', () => {
  for(const text of ['123.456','-0.75%','82,000.00','BTCUSDT','https://haolo.com']) assert.equal(japaneseText(text),text);
  assert.equal(japaneseText('任务已发送到 Haolo · 用户原文 BTC 123.45'),japaneseText('任务已发送到 Haolo · {0}').replace('{0}','用户原文 BTC 123.45'));
});

test('Chrome packaged Japanese copy covers every entry and preserves placeholders', () => {
  for(const [source,row] of Object.entries(panelCopy)) {
    assert.ok(japanesePanelCopy[source],source);
    for(const variant of [source,row[0],row[1]]) assert.equal(taskMessage(variant,'ja'),japanesePanelCopy[source]);
    assert.deepEqual([...japanesePanelCopy[source].matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...source.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort());
  }
  setPanelLanguage('ja-JP'); assert.equal(panelLanguage(),'ja');
  assert.equal(taskMessage('用户原始输入 BTC 123.45'),'用户原始输入 BTC 123.45');
});
