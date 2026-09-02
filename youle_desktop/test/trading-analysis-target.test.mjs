import assert from "node:assert/strict";
import test from "node:test";

import {
  explicitTradingAnalysisMarketType,
  selectTradingAnalysisInterval,
  selectTradingAnalysisMarket,
} from "../src/renderer/trading-analysis-target.mjs";

const btcSpot = Object.freeze({
  id: "BINANCE:SPOT:BTCUSDT",
  provider: "binance",
  symbol: "BTCUSDT",
  marketType: "spot",
});
const sndkSpot = Object.freeze({
  id: "BINANCE:SPOT:SNDKUSDT",
  provider: "binance",
  symbol: "SNDKUSDT",
  marketType: "spot",
});
const sndkPerpetual = Object.freeze({
  id: "BINANCE:FUTURES:SNDKUSDT",
  provider: "binance",
  symbol: "SNDKUSDT",
  marketType: "perpetual",
});
const markets = Object.freeze([btcSpot, sndkSpot, sndkPerpetual]);

test("an explicit symbol overrides the current BTC market while an omitted interval inherits the current chart", () => {
  const market = selectTradingAnalysisMarket(markets, {
    symbol: "SNDKUSDT",
    currentMarket: btcSpot,
    explicitSymbol: true,
    instruction: "帮我分析SNDK一小时走势",
  });
  assert.equal(market, sndkPerpetual);
  assert.equal(selectTradingAnalysisInterval({
    interval: null,
    currentInterval: "15",
    explicitSymbol: true,
  }), "15");
});

test("explicit market type and interval override defaults while omitted symbols keep the current chart", () => {
  assert.equal(explicitTradingAnalysisMarketType("分析 SNDK 现货 4 小时走势"), "spot");
  assert.equal(selectTradingAnalysisMarket(markets, {
    symbol: "SNDKUSDT",
    currentMarket: btcSpot,
    explicitSymbol: true,
    instruction: "分析 SNDK 现货 4 小时走势",
  }), sndkSpot);
  assert.equal(selectTradingAnalysisInterval({
    interval: "240",
    currentInterval: "15",
    explicitSymbol: true,
  }), "240");
  assert.equal(selectTradingAnalysisMarket(markets, {
    symbol: "BTCUSDT",
    currentMarket: btcSpot,
    explicitSymbol: false,
    instruction: "分析下",
  }), btcSpot);
  assert.equal(selectTradingAnalysisInterval({
    interval: null,
    currentInterval: "15",
    explicitSymbol: false,
  }), "15");
});
