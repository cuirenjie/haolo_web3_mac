import assert from "node:assert/strict";
import test from "node:test";

test("trend-band custom-indicator mention is recognized from composer text", async () => {
  const {
    TRADING_EXPERT_TREND_BAND_MENTION,
    hasTradingExpertTrendBandMention,
  } = await import("../src/renderer/trading-expert-market.ts");

  assert.equal(TRADING_EXPERT_TREND_BAND_MENTION, "@自定义指标:趋势带");
  assert.equal(hasTradingExpertTrendBandMention("@自定义指标:趋势带 "), true);
  assert.equal(hasTradingExpertTrendBandMention("请启用 @自定义指标:趋势带 看盘"), true);
  assert.equal(hasTradingExpertTrendBandMention("@自定义指标:趋势"), false);
  assert.equal(hasTradingExpertTrendBandMention(""), false);
  assert.equal(hasTradingExpertTrendBandMention("@策略:缠论"), false);
});

test("custom periods use TradingView resolution strings and keep at most ten unique items", async () => {
  const {
    DEFAULT_TRADING_PERIODS,
    normalizeTradingPeriods,
    reorderTradingPeriods,
    tradingPeriodLabel,
    tradingViewResolution,
  } = await import("../src/renderer/trading-expert-market.ts");

  assert.deepEqual(DEFAULT_TRADING_PERIODS.map(tradingPeriodLabel), [
    "1周",
    "1日",
    "5分",
    "15分",
    "1时",
    "4时",
  ]);
  assert.equal(tradingViewResolution({ amount: 3, unit: "s" }), "3S");
  assert.equal(tradingViewResolution({ amount: 5, unit: "m" }), "5");
  assert.equal(tradingViewResolution({ amount: 4, unit: "h" }), "240");
  assert.equal(tradingViewResolution({ amount: 2, unit: "d" }), "2D");
  assert.equal(tradingViewResolution({ amount: 1, unit: "w" }), "1W");

  const normalized = normalizeTradingPeriods([
    { amount: 60, unit: "m" },
    { amount: 1, unit: "h" },
    ...Array.from({ length: 12 }, (_, index) => ({ amount: index + 1, unit: "d" })),
  ]);
  assert.equal(normalized.length, 10);
  assert.equal(normalized.filter((period) => tradingViewResolution(period) === "60").length, 1);

  const reordered = reorderTradingPeriods(DEFAULT_TRADING_PERIODS, ["5", "1W", "240"]);
  assert.deepEqual(reordered.map(tradingPeriodLabel), [
    "5分",
    "1周",
    "4时",
    "1日",
    "15分",
    "1时",
  ]);
});

test("trading favorites normalize persisted symbols and remove invalid duplicates", async () => {
  const {
    normalizeTradingFavoriteSymbols,
    tradingMarketVisibleInPicker,
  } = await import("../src/renderer/trading-expert-market.ts");

  assert.deepEqual(
    normalizeTradingFavoriteSymbols(["btcusdt", " BTCUSDT ", "1000pepeusdt", "", null, "BTC-USDT"]),
    ["BTCUSDT", "1000PEPEUSDT"],
  );
  assert.deepEqual(normalizeTradingFavoriteSymbols({ BTCUSDT: true }), []);

  const favorites = new Set(["BTCUSDT"]);
  const btc = { symbol: "BTCUSDT", baseAsset: "BTC" };
  const eth = { symbol: "ETHUSDT", baseAsset: "ETH" };
  assert.equal(tradingMarketVisibleInPicker(btc, "", favorites, true), true);
  assert.equal(tradingMarketVisibleInPicker(eth, "", favorites, true), false);
  assert.equal(tradingMarketVisibleInPicker(eth, "eth", favorites, true), true);
  assert.equal(tradingMarketVisibleInPicker(eth, "btc", favorites, false), false);
});

test("trading favorites survive reconstruction, migrate locally, and stay account scoped", async () => {
  const {
    loadTradingFavoritesFromStorage,
    saveTradingFavoritesToStorage,
    tradingFavoriteStorageKeys,
  } = await import("../src/renderer/trading-expert-market.ts");
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const legacyKeys = tradingFavoriteStorageKeys();
  storage.setItem(legacyKeys.symbols, JSON.stringify(["BINANCE:FUTURES:BTCUSDT"]));
  storage.setItem(legacyKeys.records, JSON.stringify([{
    id: "BINANCE:FUTURES:BTCUSDT",
    provider: "binance",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    displaySymbol: "BTC/USDT",
    description: "BTC/USDT 币安永续合约",
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
  }]));

  const firstLogin = loadTradingFavoritesFromStorage(storage, "https://haolo.com::user-a");
  assert.equal(firstLogin.migratedFromLegacy, true);
  assert.deepEqual(firstLogin.symbols, ["BINANCE:FUTURES:BTCUSDT"]);
  saveTradingFavoritesToStorage(
    storage,
    "https://haolo.com::user-a",
    firstLogin,
    { removeLegacy: true },
  );

  assert.equal(storage.getItem(legacyKeys.symbols), null);
  assert.equal(storage.getItem(legacyKeys.records), null);
  const afterLogoutOrRestart = loadTradingFavoritesFromStorage(
    storage,
    "https://haolo.com::user-a",
  );
  assert.deepEqual(afterLogoutOrRestart.symbols, ["BINANCE:FUTURES:BTCUSDT"]);
  assert.equal(afterLogoutOrRestart.records[0]?.displaySymbol, "BTC/USDT");
  assert.deepEqual(
    loadTradingFavoritesFromStorage(storage, "https://haolo.com::user-b").symbols,
    [],
  );
});

test("duplicate crypto search results prefer Binance over Finnhub", async () => {
  const {
    tradingMarketCryptoPairKey,
    tradingMarketsPreferBinance,
  } = await import("../src/renderer/trading-expert-market.ts");
  const market = (overrides) => ({
    id: "BINANCE:FUTURES:BTCUSDT",
    provider: "binance",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    displaySymbol: "BTC/USDT",
    description: "Bitcoin",
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
    markPrice: 65_000,
    changePercent: 1,
    volume24h: 1,
    quoteAvailable: true,
    ...overrides,
  });
  const binanceBtc = market({});
  const binanceSpotBtc = market({
    id: "BINANCE:SPOT:BTCUSDT",
    marketType: "spot",
    tag: "现货",
  });
  const finnhubBtc = market({
    id: "FINNHUB:BINANCE:BTCUSDT",
    provider: "finnhub",
    symbol: "BINANCE:BTCUSDT",
    venue: "Binance",
    marketType: "global",
  });
  const finnhubEth = market({
    id: "FINNHUB:BINANCE:ETHUSDT",
    provider: "finnhub",
    symbol: "BINANCE:ETHUSDT",
    baseAsset: "ETH",
    displaySymbol: "ETH/USDT",
    venue: "Binance",
    marketType: "global",
  });
  const finnhubApple = market({
    id: "FINNHUB:AAPL",
    provider: "finnhub",
    symbol: "AAPL",
    baseAsset: "AAPL",
    quoteAsset: "",
    displaySymbol: "AAPL",
    assetClass: "stock",
    marketType: "global",
    tag: "股票",
    venue: "NASDAQ",
  });

  assert.equal(tradingMarketCryptoPairKey(binanceBtc), "BTCUSDT");
  assert.equal(tradingMarketCryptoPairKey(finnhubBtc), "BTCUSDT");
  assert.deepEqual(
    tradingMarketsPreferBinance([binanceBtc, binanceSpotBtc, finnhubBtc, finnhubEth, finnhubApple])
      .map(({ id }) => id),
    [
      "BINANCE:FUTURES:BTCUSDT",
      "BINANCE:SPOT:BTCUSDT",
      "FINNHUB:BINANCE:ETHUSDT",
      "FINNHUB:AAPL",
    ],
  );
});

test("favorite market resolution preserves live prices over persisted metadata", async () => {
  const {
    resolveTradingFavoriteMarkets,
    tradingMarketsPreferBinance,
  } = await import("../src/renderer/trading-expert-market.ts");
  const liveMarket = {
    id: "BINANCE:FUTURES:ETHUSDT",
    provider: "binance",
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    displaySymbol: "ETH/USDT",
    description: "ETH/USDT 币安永续合约",
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
    markPrice: 1_917.24,
    changePercent: -0.14,
    volume24h: 1_000,
    quoteAvailable: true,
  };
  const favoriteRecord = Object.fromEntries(
    Object.entries(liveMarket).filter(([key]) => ![
      "markPrice",
      "changePercent",
      "volume24h",
      "quoteAvailable",
    ].includes(key)),
  );
  const websocketMarket = {
    ...liveMarket,
    markPrice: 1_920.5,
    changePercent: 0.35,
  };
  const staleFavorite = {
    ...liveMarket,
    markPrice: 0,
    changePercent: 0,
    volume24h: 0,
    quoteAvailable: false,
  };

  assert.equal(resolveTradingFavoriteMarkets([favoriteRecord], [])[0].quoteAvailable, false);
  assert.strictEqual(resolveTradingFavoriteMarkets([favoriteRecord], [liveMarket])[0], liveMarket);
  assert.strictEqual(
    resolveTradingFavoriteMarkets([favoriteRecord], [liveMarket, websocketMarket])[0],
    websocketMarket,
  );
  assert.strictEqual(tradingMarketsPreferBinance([liveMarket, staleFavorite])[0], liveMarket);
});

test("favorite ticker quotes update continuously and use direct combined streams", async () => {
  const {
    applyTradingMarketTickerQuote,
    formatTradingMarketTickerPrice,
    tradingFavoriteTickerStreamUrl,
  } = await import("../src/renderer/trading-expert-market.ts");
  const liveMarket = {
    id: "BINANCE:FUTURES:ETHUSDT",
    provider: "binance",
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    displaySymbol: "ETH/USDT",
    description: "ETH/USDT 币安永续合约",
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
    markPrice: 0,
    changePercent: 0,
    volume24h: 0,
    quoteAvailable: false,
  };

  assert.equal(
    tradingFavoriteTickerStreamUrl("perpetual", ["ETHUSDT", "SOLUSDT", "ETHUSDT"]),
    "wss://fstream.binance.com/stream?streams=ethusdt@ticker/solusdt@ticker",
  );
  assert.equal(
    tradingFavoriteTickerStreamUrl("spot", ["BTCUSDT"]),
    "wss://stream.binance.com:9443/stream?streams=btcusdt@ticker",
  );
  assert.equal(formatTradingMarketTickerPrice(1_916.9), "1,916.90");
  assert.equal(formatTradingMarketTickerPrice(76.81), "76.81");
  assert.equal(formatTradingMarketTickerPrice(0.14031), "0.14031");
  assert.equal(formatTradingMarketTickerPrice(0.029876), "0.02988");

  const first = applyTradingMarketTickerQuote(liveMarket, {
    lastPrice: "1916.90",
    openPrice: "1900",
    changePercent: "0.88",
  });
  assert.equal(first.updated, true);
  assert.equal(first.openPrice, 1900);
  assert.equal(liveMarket.markPrice, 1916.9);
  assert.equal(liveMarket.quoteAvailable, true);
  assert.ok(Math.abs(liveMarket.changePercent - ((16.9 / 1900) * 100)) < 1e-10);

  const second = applyTradingMarketTickerQuote(
    liveMarket,
    { lastPrice: "1921.40", changePercent: "1.12" },
    first.openPrice,
  );
  assert.equal(second.updated, true);
  assert.equal(liveMarket.markPrice, 1921.4);
  assert.ok(Math.abs(liveMarket.changePercent - ((21.4 / 1900) * 100)) < 1e-10);

  assert.equal(applyTradingMarketTickerQuote(liveMarket, { lastPrice: "invalid" }).updated, false);
  assert.equal(liveMarket.markPrice, 1921.4);
});

test("Binance search catalog combines USDT spot and perpetual markets", async () => {
  const { fetchTradingMarkets } = await import("../src/renderer/trading-expert-market.ts");
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (urlValue) => {
    const url = new URL(String(urlValue));
    paths.push(url.pathname);
    const payload = url.pathname === "/fapi/v1/exchangeInfo"
      ? { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" }] }
      : url.pathname === "/fapi/v1/ticker/24hr"
        ? [{ symbol: "BTCUSDT", lastPrice: "65000", openPrice: "64000", priceChangePercent: "1.5625", quoteVolume: "1000" }]
        : url.pathname === "/api/v3/exchangeInfo"
          ? { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true }] }
          : [{ symbol: "BTCUSDT", lastPrice: "64900", openPrice: "64000", quoteVolume: "900" }];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const markets = await fetchTradingMarkets();
    assert.deepEqual(
      markets.map(({ id, tag }) => [id, tag]),
      [
        ["BINANCE:FUTURES:BTCUSDT", "永续"],
        ["BINANCE:SPOT:BTCUSDT", "现货"],
      ],
    );
    assert.equal(markets[1].changePercent, ((64_900 - 64_000) / 64_000) * 100);
    assert.deepEqual(new Set(paths), new Set([
      "/fapi/v1/exchangeInfo",
      "/fapi/v1/ticker/24hr",
      "/api/v3/exchangeInfo",
      "/api/v3/ticker/24hr",
    ]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Binance futures resolution adapter selects native sources and aggregates custom bars", async () => {
  const {
    aggregateTradingCandles,
    binanceResolutionSource,
    formatFundingCountdown,
    marketFocusedPriceFormatFor,
    marketPriceFormatFor,
    tradingViewResolutionDurationMs,
  } = await import("../src/renderer/trading-expert-market.ts");

  assert.equal(tradingViewResolutionDurationMs("5S"), 5_000);
  assert.equal(tradingViewResolutionDurationMs("240"), 14_400_000);
  assert.equal(tradingViewResolutionDurationMs("2D"), 172_800_000);
  assert.deepEqual(binanceResolutionSource("1S"), {
    targetMs: 1_000,
    sourceInterval: null,
    sourceMs: null,
  });
  assert.deepEqual(binanceResolutionSource("7"), {
    targetMs: 420_000,
    sourceInterval: "1m",
    sourceMs: 60_000,
  });
  assert.deepEqual(binanceResolutionSource("240"), {
    targetMs: 14_400_000,
    sourceInterval: "4h",
    sourceMs: 14_400_000,
  });
  assert.deepEqual(binanceResolutionSource("480"), {
    targetMs: 28_800_000,
    sourceInterval: "8h",
    sourceMs: 28_800_000,
  });
  assert.deepEqual(binanceResolutionSource("2D"), {
    targetMs: 172_800_000,
    sourceInterval: "1d",
    sourceMs: 86_400_000,
  });

  const candles = aggregateTradingCandles([
    { time: 0, open: 10, high: 13, low: 9, close: 12, volume: 2 },
    { time: 60, open: 12, high: 15, low: 11, close: 14, volume: 3 },
    { time: 120, open: 14, high: 16, low: 13, close: 15, volume: 4 },
  ], 120_000);
  assert.deepEqual(candles, [
    { time: 0, open: 10, high: 15, low: 9, close: 14, volume: 5 },
    { time: 120, open: 14, high: 16, low: 13, close: 15, volume: 4 },
  ]);
  assert.deepEqual(marketPriceFormatFor(8.5), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketPriceFormatFor(73.17), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketPriceFormatFor(905.87), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketPriceFormatFor(1_905.87), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketPriceFormatFor(64_000), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketPriceFormatFor(0.0065), { type: "price", precision: 2, minMove: 0.01 });
  assert.deepEqual(marketFocusedPriceFormatFor(8.5), { type: "price", precision: 5, minMove: 0.00001 });
  assert.deepEqual(marketFocusedPriceFormatFor(73.17), { type: "price", precision: 4, minMove: 0.0001 });
  assert.deepEqual(marketFocusedPriceFormatFor(905.87), { type: "price", precision: 3, minMove: 0.001 });
  assert.deepEqual(marketFocusedPriceFormatFor(1_905.87), { type: "price", precision: 2, minMove: 0.01 });
  assert.equal(formatFundingCountdown(1_000, 3_662_000), "01:01:01");
  assert.equal(formatFundingCountdown(2_000, 1_000), "00:00:00");
});

test("crosshair time remains available in blank space beyond the loaded candles", async () => {
  const { resolveMarketCrosshairTime } = await import("../src/renderer/trading-expert-market.ts");
  const candles = [
    { time: 0 },
    { time: 86_400 },
  ];

  assert.equal(resolveMarketCrosshairTime(123_456, 8, candles, "1D"), 123_456);
  assert.equal(resolveMarketCrosshairTime(undefined, 3, candles, "1D"), 288_000);
  assert.equal(resolveMarketCrosshairTime(undefined, -2, candles, "1D"), -144_000);
  assert.equal(resolveMarketCrosshairTime(undefined, undefined, candles, "1D"), null);
  assert.equal(resolveMarketCrosshairTime(undefined, 3, [], "1D"), null);
});

test("migrated Folus EMA and SMA calculations preserve their trading behavior", async () => {
  const { computeEma, computeSma } = await import("../src/renderer/trading-expert-market.ts");
  const values = [1, 2, 3, 4, 5];
  const ema = computeEma(values, 3);
  const sma = computeSma(values, 3);

  assert.ok(Number.isNaN(ema[0]) && Number.isNaN(ema[1]));
  assert.deepEqual(ema.slice(2), [2, 3, 4]);
  assert.ok(Number.isNaN(sma[0]) && Number.isNaN(sma[1]));
  assert.deepEqual(sma.slice(2), [2, 3, 4]);
});

test("upgraded chart produces trend colors and a finite MA band", async () => {
  const {
    atm1TrendCandles,
    atm4BandSeriesData,
    atm4MaBand,
  } = await import("../src/renderer/trading-expert-market.ts");
  const candles = Array.from({ length: 80 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
  }));

  const trends = atm1TrendCandles(candles);
  const band = atm4MaBand(candles);

  assert.equal(trends.at(-1)?.state, "bull_trend");
  assert.ok(Number.isFinite(band.at(-1)?.bandUpper));
  assert.ok(Number.isFinite(band.at(-1)?.bandLower));
  assert.ok((band.at(-1)?.bandUpper ?? 0) >= (band.at(-1)?.bandLower ?? 0));

  const upperData = atm4BandSeriesData(band, "bandUpper");
  const hiddenData = atm4BandSeriesData(band, "bandUpper", false);
  assert.equal(upperData.length, candles.length);
  assert.deepEqual(upperData[0], { time: candles[0].time + 8 * 60 * 60 });
  assert.ok(Number.isFinite(upperData.at(-1)?.value));
  assert.ok(hiddenData.every((point) => !("value" in point)));
});

test("main-chart MA, EMA, BOLL, TD, and BBI studies expose working calculations", async () => {
  const {
    TRADING_MAIN_INDICATORS,
    TRADING_MAIN_INDICATOR_LINE_COLORS,
    computeBbi,
    computeBollingerBands,
    computeTdSequential,
  } = await import("../src/renderer/trading-expert-market.ts");
  const closes = Array.from({ length: 30 }, (_, index) => index + 1);
  const bollinger = computeBollingerBands(closes);
  const bbi = computeBbi(closes);
  const fallingCandles = Array.from({ length: 14 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: 100 - index,
    high: 101 - index,
    low: 98 - index,
    close: 99 - index,
  }));
  const td = computeTdSequential(fallingCandles);

  assert.deepEqual(
    TRADING_MAIN_INDICATORS.map((indicator) => indicator.id),
    ["ma", "ema", "boll", "td", "bbi"],
  );
  assert.deepEqual(
    TRADING_MAIN_INDICATOR_LINE_COLORS,
    ["#d1ab2e", "#2dccac", "#c935cc"],
  );
  assert.ok(Number.isFinite(bollinger.middle.at(-1)));
  assert.ok((bollinger.upper.at(-1) ?? 0) > (bollinger.middle.at(-1) ?? 0));
  assert.ok((bollinger.lower.at(-1) ?? 0) < (bollinger.middle.at(-1) ?? 0));
  assert.ok(Number.isFinite(bbi.at(-1)));
  assert.deepEqual(td.slice(0, 9).map((signal) => signal.count), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(td.slice(0, 9).every((signal) => signal.direction === "buy"));
});

test("fixed price scale follows the high-low range of the visible candles", async () => {
  const {
    fixedPriceScaleRange,
    initialMarketLogicalRange,
    visibleCandlesInLogicalRange,
  } = await import("../src/renderer/trading-expert-market.ts");
  const candles = [
    { time: 1, open: 50_000, high: 126_200, low: 47_566, close: 60_000 },
    { time: 2, open: 60_000, high: 82_000, low: 57_809, close: 64_000 },
    { time: 3, open: 64_000, high: 68_000, low: 60_000, close: 66_000 },
  ];

  assert.deepEqual(fixedPriceScaleRange(candles), { from: 45_000, to: 130_000 });
  const visibleCandles = visibleCandlesInLogicalRange(candles, { from: 1, to: 2 });
  assert.deepEqual(visibleCandles, candles.slice(1, 3));
  assert.deepEqual(fixedPriceScaleRange(visibleCandles), { from: 56_000, to: 84_000 });
  assert.deepEqual(visibleCandlesInLogicalRange(candles, { from: 8, to: 12 }), []);
  assert.equal(fixedPriceScaleRange([]), null);
  assert.deepEqual(initialMarketLogicalRange(500, "1W"), { from: 400, to: 505 });
  assert.deepEqual(initialMarketLogicalRange(500, "1D"), { from: 320, to: 505 });
  assert.deepEqual(initialMarketLogicalRange(80, "1D"), { from: 0, to: 85 });
  assert.equal(initialMarketLogicalRange(0, "1D"), null);
});

test("Binance asset logos use the shared official static asset path", async () => {
  const { binanceAssetLogoUrl } = await import("../src/renderer/trading-expert-market.ts");

  assert.equal(
    binanceAssetLogoUrl("btc"),
    "https://bin.bnbstatic.com/static/assets/logos/BTC.png",
  );
  assert.equal(
    binanceAssetLogoUrl(" 1000pepe "),
    "https://bin.bnbstatic.com/static/assets/logos/1000PEPE.png",
  );
});

test("every Trading Expert subchart indicator produces aligned finite series", async () => {
  const {
    TRADING_INDICATORS,
    calculateTradingIndicator,
  } = await import("../src/renderer/trading-expert-indicators.ts");
  const candles = Array.from({ length: 160 }, (_, index) => {
    const trend = 100 + index * 0.35;
    const wave = Math.sin(index / 5) * 2.5;
    const open = trend + wave;
    const close = open + Math.cos(index / 4) * 1.2;
    return {
      time: 1_700_000_000 + index * 60,
      open,
      high: Math.max(open, close) + 1.4,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 1_000 + index * 13 + (index % 7) * 41,
    };
  });

  assert.deepEqual(
    TRADING_INDICATORS.map((indicator) => indicator.id),
    ["volume", "macd", "rsi", "kdj", "stoch", "cci", "atr", "adx", "momentum", "roc", "obv", "mfi", "willr"],
  );
  for (const definition of TRADING_INDICATORS) {
    const result = calculateTradingIndicator(definition.id, candles);
    assert.equal(result.definition, definition);
    assert.ok(result.series.length >= 1, `${definition.id} must expose a series`);
    for (const series of result.series) {
      assert.equal(series.values.length, candles.length);
      assert.ok(
        series.values.some(Number.isFinite),
        `${definition.id}/${series.key} must produce a finite value`,
      );
    }
  }
});

test("TradingView-style indicator catalog provides unique selectable studies", async () => {
  const { TRADING_INDICATORS } = await import("../src/renderer/trading-expert-indicators.ts");
  const ids = TRADING_INDICATORS.map((item) => item.id);

  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("volume"));
  assert.ok(ids.includes("macd"));
  assert.ok(ids.includes("rsi"));
  assert.ok(ids.includes("mfi"));
});

test("volume and MACD return aligned multi-series pane data", async () => {
  const { calculateTradingIndicator } = await import("../src/renderer/trading-expert-indicators.ts");
  const candles = Array.from({ length: 80 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: 100 + index,
    high: 103 + index,
    low: 98 + index,
    close: index === 0 ? 99 : 101 + index + Math.sin(index / 3),
    volume: 1_000 + index * 17,
  }));

  const volume = calculateTradingIndicator("volume", candles);
  const macd = calculateTradingIndicator("macd", candles);

  assert.deepEqual(volume.series.map((series) => series.label), ["VOL", "MA5", "MA10"]);
  assert.deepEqual(macd.series.map((series) => series.label), ["DIF", "DEA", "MACD"]);
  assert.equal(volume.series[0].colors[0], "#F6465D");
  assert.equal(volume.series[0].colors[1], "#2EBD85");
  assert.ok(volume.series[0].colors.every((color) => ["#2EBD85", "#F6465D"].includes(color)));
  assert.ok(macd.series[2].colors.every((color) => ["#2EBD85", "#F6465D"].includes(color)));
  assert.ok(volume.series.every((series) => series.values.length === candles.length));
  assert.ok(macd.series.every((series) => series.values.length === candles.length));
  assert.ok(Number.isFinite(macd.series[0].values.at(-1)));
  assert.ok(Number.isFinite(macd.series[1].values.at(-1)));
  assert.ok(Number.isFinite(macd.series[2].values.at(-1)));
});

test("volume reference style uses thin defaults and migrates legacy widths once", async () => {
  const {
    migrateTradingVolumeReferenceStyle,
    normalizeTradingIndicatorSettings,
  } = await import("../src/renderer/trading-expert-market.ts");
  const defaults = normalizeTradingIndicatorSettings(null);
  assert.equal(defaults["sub:volume"].series.ma5.lineWidth, 1);
  assert.equal(defaults["sub:volume"].series.ma10.lineWidth, 1);

  const legacy = normalizeTradingIndicatorSettings({
    "sub:volume": {
      enabled: true,
      parameters: [5, 10],
      series: {
        volume: { visible: true, color: "#16a873", lineWidth: 2 },
        ma5: { visible: true, color: "#22b8cf", lineWidth: 2 },
        ma10: { visible: true, color: "#e5ad25", lineWidth: 3 },
      },
    },
  });
  const migrated = migrateTradingVolumeReferenceStyle(legacy);

  assert.notStrictEqual(migrated, legacy);
  assert.equal(migrated["sub:volume"].series.ma5.lineWidth, 1);
  assert.equal(migrated["sub:volume"].series.ma10.lineWidth, 3);
  assert.equal(legacy["sub:volume"].series.ma5.lineWidth, 2);
});

test("Binance bar palette migrates legacy volume and MACD defaults", async () => {
  const {
    migrateTradingBarColors,
    normalizeTradingIndicatorSettings,
  } = await import("../src/renderer/trading-expert-market.ts");
  const defaults = normalizeTradingIndicatorSettings(null);
  assert.equal(defaults["sub:volume"].series.volume.color, "#2EBD85");
  assert.equal(defaults["sub:macd"].series.histogram.color, "#2EBD85");

  const legacy = normalizeTradingIndicatorSettings({
    "sub:volume": {
      series: { volume: { visible: true, color: "#16a873", lineWidth: 2 } },
    },
    "sub:macd": {
      series: { histogram: { visible: true, color: "#16a873", lineWidth: 2 } },
    },
  });
  const migrated = migrateTradingBarColors(legacy);

  assert.equal(migrated["sub:volume"].series.volume.color, "#2EBD85");
  assert.equal(migrated["sub:macd"].series.histogram.color, "#2EBD85");
  assert.equal(legacy["sub:volume"].series.volume.color, "#16a873");
});

test("bounded oscillators and volatility studies calculate finite values", async () => {
  const { calculateTradingIndicator } = await import("../src/renderer/trading-expert-indicators.ts");
  const candles = Array.from({ length: 100 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: 100 + index * 0.25,
    high: 103 + index * 0.25 + Math.sin(index),
    low: 97 + index * 0.25 - Math.cos(index),
    close: 100 + index * 0.25 + Math.sin(index / 2),
    volume: 2_000 + (index % 9) * 230,
  }));

  for (const id of ["rsi", "kdj", "stoch", "cci", "atr", "adx", "mfi", "willr"]) {
    const result = calculateTradingIndicator(id, candles);
    assert.ok(result.series.length > 0, `${id} should expose at least one series`);
    assert.ok(result.series.every((series) => Number.isFinite(series.values.at(-1))), `${id} should end with finite data`);
  }
});

test("custom indicator parameters change real calculations without changing the catalog", async () => {
  const { calculateTradingIndicator } = await import("../src/renderer/trading-expert-indicators.ts");
  const candles = Array.from({ length: 120 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    open: 100 + index * 0.2,
    high: 103 + index * 0.2 + Math.sin(index / 3),
    low: 97 + index * 0.2 - Math.cos(index / 4),
    close: 100 + index * 0.2 + Math.sin(index / 2) * 2,
    volume: 1_000 + index * 19,
  }));

  const defaultVolume = calculateTradingIndicator("volume", candles);
  const customVolume = calculateTradingIndicator("volume", candles, [3, 7]);
  const defaultMacd = calculateTradingIndicator("macd", candles);
  const customMacd = calculateTradingIndicator("macd", candles, [5, 10, 3]);

  assert.deepEqual(customVolume.series.map((series) => series.label), ["VOL", "MA3", "MA7"]);
  assert.notEqual(customVolume.series[1].values.at(-1), defaultVolume.series[1].values.at(-1));
  assert.notEqual(customMacd.series[0].values.at(-1), defaultMacd.series[0].values.at(-1));
  assert.ok(customMacd.series.every((series) => Number.isFinite(series.values.at(-1))));
});

test("custom indicator settings normalize all current main and subchart studies", async () => {
  const {
    TRADING_MARKET_INDICATOR_CATALOG,
    normalizeTradingIndicatorSettings,
  } = await import("../src/renderer/trading-expert-market.ts");
  const settings = normalizeTradingIndicatorSettings({
    "main:ma": {
      enabled: true,
      parameters: [2, 999, "invalid"],
      series: {
        short: { visible: false, color: "#123456", lineWidth: 3 },
      },
    },
  });

  assert.equal(TRADING_MARKET_INDICATOR_CATALOG.filter((item) => item.scope === "main").length, 5);
  assert.equal(TRADING_MARKET_INDICATOR_CATALOG.filter((item) => item.scope === "sub").length, 13);
  assert.equal(Object.keys(settings).length, 18);
  assert.equal(settings["main:ma"].enabled, true);
  assert.deepEqual(settings["main:ma"].parameters, [2, 500, 20]);
  assert.deepEqual(settings["main:ma"].series.short, {
    visible: false,
    color: "#123456",
    lineWidth: 3,
  });
  assert.equal(settings["sub:obv"].parameters.length, 0);
});
