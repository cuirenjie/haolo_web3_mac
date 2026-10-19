import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAppText } from '../src/renderer/app-language.mjs';

test('watchlist and trading labels use complete professional English phrases', () => {
  const phrases = {
    '收起自选': 'Hide watchlist', '展开自选': 'Show watchlist', '指数': 'Indices',
    '最新价': 'Last price', '24H涨幅': '24h change', '保证金': 'Margin',
    '强平价格': 'Liquidation price', '币安永续': 'Binance perpetual',
    '已复制': 'Copied', '积分': 'Points', '趋势线': 'Trend line',
    '1小时': '1h',
  };
  for (const [source, expected] of Object.entries(phrases)) {
    assert.equal(translateAppText(source, 'en'), expected);
    assert.equal(translateAppText(translateAppText(source, 'zh-TW'), 'en'), expected);
    assert.equal(translateAppText(`  ${source}  `, 'en'), `  ${expected}  `);
  }
});

test('dynamic public index metadata translates without changing identifiers or values', () => {
  for (const source of [
    'BTC 大户多空人数比', 'ETH 大户多空持仓比',
    '0–100，数值越高表示市场情绪越贪婪；每日更新。',
    '保证金余额前 20% 用户中，净多仓账户数 ÷ 净空仓账户数。按小时采样；24H 涨幅为比值自身相对 24 小时前的变化。',
    '畫線已保留在本機，等待同步',
  ]) assert.doesNotMatch(translateAppText(source, 'en'), /\p{Script=Han}/u);
  assert.equal(translateAppText('BTC 大户多空人数比', 'en'), 'BTC Top Trader Long/Short Account Ratio');
  assert.equal(translateAppText('BTC/USDT 82,106.50 +1.07%', 'en'), 'BTC/USDT 82,106.50 +1.07%');
});
