import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { tradingMarketAvailable } from '../src/shared/trading-market-availability.mjs';
import { TRADING_MARKET_CATEGORY_OPTIONS, normalizeIfindTradingMarket, tradingMarketVisibleInPicker } from '../src/renderer/trading-expert-market.ts';
import {setup} from './helpers/cloud-renderer-harness.mjs';

test('retired A shares stay out of search and favorites even when restored from old records', () => {
  const market = normalizeIfindTradingMarket({ symbol: '600519.SH', description: '贵州茅台' });
  const saved = JSON.stringify(market);
  for (const query of ['', '600519', '贵州茅台']) {
    for (const favoritesOnly of [true, false]) {
      assert.equal(tradingMarketVisibleInPicker(market, query, new Set([market.id]), favoritesOnly), false);
    }
  }
  assert.equal(JSON.stringify(market), saved);
  assert.equal(TRADING_MARKET_CATEGORY_OPTIONS.some(option => option.id === 'a-share'), false);
  for (const identity of [{provider:'ifind'}, {assetClass:'a-share'}, {id:'IFIND:600519.SH'}]) {
    assert.equal(tradingMarketAvailable(identity), false);
  }
  assert.equal(tradingMarketAvailable({provider:'binance', assetClass:'stock', id:'BINANCE:FUTURES:TSLAUSDT'}), true);
  assert.equal(tradingMarketAvailable({provider:'finnhub', assetClass:'stock'}), true);
});

test('retirement blocks status polling and cached primary/split workspace selection', async () => {
  const source = await readFile(new URL('../src/renderer/trading-expert-market.ts', import.meta.url), 'utf8');
  for (const name of ['loadIfindStatus', 'scheduleIfindSearch', 'refreshFavoriteIfindQuotes']) {
    assert.match(source, new RegExp(name + '\\([^)]*\\) \\{\\s*if \\(!IFIND_BUSINESS_ENABLED\\) return;'));
  }
  assert.match(source, /private selectMarket\([^)]*\) \{\s*if \(!tradingMarketAvailable\(market\)\) return false;/);
  assert.match(source, /!primary \|\| !tradingMarketAvailable\(primary.market\)/);
  assert.match(source, /pane.paneIndex === 0 \|\| !tradingMarketAvailable\(pane.market\)/);
  const watchlist = await readFile(new URL('../src/renderer/trading-watchlist-ui.ts', import.meta.url), 'utf8');
  assert.match(watchlist, /activeGroup.markets.filter\(tradingMarketAvailable\)/);
});

test('a captured historical A-share analysis is rejected before any cloud call or drawing', async () => {
  const {workspace,calls,drawings}=setup();
  const market=normalizeIfindTradingMarket({symbol:'600519.SH',description:'贵州茅台'});
  workspace.selectedMarketMeta=market;
  workspace.selectedMarketId=market.id;
  workspace.selectedSymbol=market.symbol;
  workspace.markets=[market];
  await assert.rejects(workspace.runGeneralConversation({}), /A-share services have been discontinued/);
  assert.equal(calls.length,0);
  assert.equal(drawings.length,0);
});
