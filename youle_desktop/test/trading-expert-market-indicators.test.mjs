import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("trend-band indicator mention is recognized from composer text", async () => {
  const {
    TRADING_EXPERT_TREND_BAND_MENTION,
    hasTradingExpertTrendBandMention,
  } = await import("../src/renderer/trading-expert-market.ts");

  assert.equal(TRADING_EXPERT_TREND_BAND_MENTION, "@指标:趋势带");
  assert.equal(hasTradingExpertTrendBandMention("@指标:趋势带 "), true);
  assert.equal(hasTradingExpertTrendBandMention("@指标：趋势带 "), true);
  assert.equal(hasTradingExpertTrendBandMention("请启用 @指标:趋势带 看盘"), true);
  assert.equal(hasTradingExpertTrendBandMention("@自定义指标:趋势带 "), true);
  assert.equal(hasTradingExpertTrendBandMention("@自定义指标：趋势带 "), true);
  assert.equal(hasTradingExpertTrendBandMention("@Indicator:Trend band "), true);
  assert.equal(hasTradingExpertTrendBandMention("@指標:趨勢帶 "), true);
  assert.equal(hasTradingExpertTrendBandMention("@指标:趋势"), false);
  assert.equal(hasTradingExpertTrendBandMention(""), false);
  assert.equal(hasTradingExpertTrendBandMention("@策略:缠论"), false);
});

test("custom periods use TradingView resolution strings and keep at most ten unique items", async () => {
  const {
    DEFAULT_TRADING_PERIODS,
    normalizeTradingPeriods,
    reorderTradingPeriods,
    tradingAlertIntervalFromResolution,
    tradingPeriodLabel,
    tradingPeriodFromResolution,
    tradingResolutionFromAlertInterval,
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
  assert.equal(tradingViewResolution({ amount: 1, unit: "M" }), "1M");
  assert.equal(tradingViewResolution({ amount: 1, unit: "Y" }), "12M");
  assert.equal(tradingPeriodLabel({ amount: 2, unit: "M" }), "2月");
  assert.equal(tradingPeriodLabel({ amount: 1, unit: "Y" }), "1年");
  assert.deepEqual(tradingPeriodFromResolution("1M"), { amount: 1, unit: "M" });
  assert.deepEqual(tradingPeriodFromResolution("12M"), { amount: 1, unit: "Y" });
  assert.equal(tradingAlertIntervalFromResolution("12M"), "12M");
  assert.equal(tradingResolutionFromAlertInterval("1M"), "1M");
  assert.equal(tradingResolutionFromAlertInterval("1m"), "1");

  const normalized = normalizeTradingPeriods([
    { amount: 60, unit: "m" },
    { amount: 1, unit: "h" },
    { amount: 1, unit: "M" },
    { amount: 1, unit: "Y" },
    ...Array.from({ length: 12 }, (_, index) => ({ amount: index + 1, unit: "d" })),
  ]);
  assert.equal(normalized.length, 10);
  assert.equal(normalized.filter((period) => tradingViewResolution(period) === "60").length, 1);
  assert.deepEqual(normalized.filter((period) => period.unit === "M" || period.unit === "Y"), [
    { amount: 1, unit: "M" },
    { amount: 1, unit: "Y" },
  ]);

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
    orderTradingMarketPickerResults,
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

  const market = (id, symbol, provider = "binance") => ({
    id,
    provider,
    symbol,
    baseAsset: symbol.replace("USDT", ""),
    quoteAsset: "USDT",
    displaySymbol: `${symbol.replace("USDT", "")}/USDT`,
    description: symbol,
    venue: provider === "binance" ? "币安" : "Finnhub",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
    markPrice: 1,
    changePercent: 0,
    volume24h: 0,
    quoteAvailable: true,
  });
  const ordered = orderTradingMarketPickerResults(
    [market("BINANCE:FUTURES:ETHUSDT", "ETHUSDT"), market("BINANCE:FUTURES:BTCUSDT", "BTCUSDT"), market("BINANCE:FUTURES:SOLUSDT", "SOLUSDT")],
    new Set(["BTCUSDT"]),
  );
  assert.deepEqual(ordered.map(({ symbol }) => symbol), ["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
});

test("every trading pair opened from the picker is auto-favorited", async () => {
  const { shouldAutoFavoriteTradingMarketSelection } = await import(
    "../src/renderer/trading-expert-market.ts"
  );

  assert.equal(shouldAutoFavoriteTradingMarketSelection("symbol"), true);
  assert.equal(shouldAutoFavoriteTradingMarketSelection("favorite-symbol"), false);
  assert.equal(shouldAutoFavoriteTradingMarketSelection("favorite"), false);
});

test("official Han-character Binance symbols survive persistence and stay searchable", async () => {
  const {
    loadTradingFavoritesFromStorage,
    normalizeBinanceMarketSymbol,
    normalizeTradingFavoriteSymbols,
    tradingFavoriteStorageKeys,
    tradingMarketVisibleInPicker,
  } = await import("../src/renderer/trading-expert-market.ts");
  const keys = tradingFavoriteStorageKeys();
  const values = new Map([
    [keys.symbols, JSON.stringify([
      "BINANCE:FUTURES:龙虾USDT",
      "BINANCE:FUTURES:币安人生USDT",
    ])],
    [keys.records, JSON.stringify([{
      id: "BINANCE:FUTURES:龙虾USDT",
      provider: "binance",
      symbol: "龙虾USDT",
      baseAsset: "龙虾",
      quoteAsset: "USDT",
      displaySymbol: "龙虾/USDT",
      description: "龙虾/USDT 币安永续合约",
      venue: "币安",
      assetClass: "crypto",
      marketType: "perpetual",
      tag: "永续",
    }, {
      id: "BINANCE:FUTURES:币安人生USDT",
      provider: "binance",
      symbol: "币安人生USDT",
      baseAsset: "币安人生",
      quoteAsset: "USDT",
      displaySymbol: "币安人生/USDT",
      description: "币安人生/USDT 币安永续合约",
      venue: "币安",
      assetClass: "crypto",
      marketType: "perpetual",
      tag: "永续",
    }])],
  ]);
  const snapshot = loadTradingFavoritesFromStorage({
    getItem: (key) => values.get(key) ?? null,
  });
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(snapshot.records[0], {
    id: "BINANCE:FUTURES:龙虾USDT",
    provider: "binance",
    symbol: "龙虾USDT",
    baseAsset: "龙虾",
    quoteAsset: "USDT",
    displaySymbol: "龙虾/USDT",
    description: "龙虾/USDT 币安永续合约",
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
  });
  assert.equal(tradingMarketVisibleInPicker(snapshot.records[0], "龙虾", new Set(), false), true);
  assert.equal(tradingMarketVisibleInPicker(snapshot.records[1], "币安人生", new Set(), false), true);
  assert.equal(normalizeBinanceMarketSymbol(" 龙虾USDT "), "龙虾USDT");
  assert.equal(normalizeBinanceMarketSymbol("币安人生USDT"), "币安人生USDT");
  assert.equal(normalizeBinanceMarketSymbol(" btcusdt "), "BTCUSDT");
  assert.equal(normalizeBinanceMarketSymbol("龙虾/USDT"), null);
  assert.equal(normalizeBinanceMarketSymbol("币安 人生USDT"), null);
  assert.deepEqual(normalizeTradingFavoriteSymbols([
    "BINANCE:FUTURES:龙虾USDT",
    "币安人生USDT",
  ]), ["BINANCE:FUTURES:龙虾USDT", "币安人生USDT"]);
});

test("invalid Binance symbols use a local recoverable error in both theme-backed states", async () => {
  const {
    BINANCE_MARKET_UNAVAILABLE_MESSAGE,
    isBinanceMarketSymbolError,
    tradingMarketErrorPresentation,
  } = await import("../src/renderer/trading-expert-market.ts");
  assert.equal(isBinanceMarketSymbolError(new Error("Invalid Binance symbol")), true);
  assert.equal(isBinanceMarketSymbolError({ code: "BINANCE_MARKET_SYMBOL_UNAVAILABLE" }), true);
  assert.deepEqual(tradingMarketErrorPresentation("binance", new Error("Invalid symbol.")), {
    message: `${BINANCE_MARKET_UNAVAILABLE_MESSAGE}，点击返回 BTC/USDT`,
    action: "open-default-market",
    ariaLabel: `${BINANCE_MARKET_UNAVAILABLE_MESSAGE}，点击加载 BTC/USDT 永续合约`,
  });

  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.trading-market-error\s*\{[^}]*var\(--trading-market-negative\)[^}]*var\(--trading-market-panel\)/s);
  assert.match(styles, /\.trading-market-error:hover\s*\{[^}]*var\(--trading-market-negative\)[^}]*var\(--trading-market-panel\)/s);
  assert.match(styles, /\.trading-market-error:active\s*\{[^}]*var\(--trading-market-negative\)[^}]*var\(--trading-market-panel\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[^}]*--trading-market-panel:[^;]+;[^}]*--trading-market-negative:/s);
});

test("chart period controls opt into compact localized labels", async () => {
  const source = await readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  assert.match(source, /data-market-action="interval"[\s\S]*data-i18n-trading-period-label/);
  assert.match(source, /<span data-i18n-trading-period-label>\$\{tradingPeriodLabel\(period\)\}<\/span>/);
});

test("trading candle snapshots are keyed by market context, survive stale refreshes, and clone arrays", async () => {
  const {
    getTradingMarketCandleCache,
    setTradingMarketCandleCache,
    tradingMarketCandleCacheKey,
  } = await import("../src/renderer/trading-expert-market.ts");
  const key = tradingMarketCandleCacheKey({
    provider: "binance",
    symbol: "BTCUSDT",
    assetClass: "crypto",
    interval: "240",
    marketType: "perpetual",
  });
  const snapshot = {
    stats: {
      symbol: "BTCUSDT",
      markPrice: 100,
      midPrice: 101,
      oraclePrice: 99,
      openInterest: 1,
      fundingRate: 0.001,
      nextFundingTime: 123,
      prevDayPrice: 98,
      volume24h: 10,
    },
    candleBatch: {
      candles: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, closed: false }],
      sourceCandles: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, closed: false }],
      source: { targetMs: 240 * 60_000, sourceInterval: "4h", sourceMs: 240 * 60_000 },
      lastTradeId: 7,
    },
  };
  setTradingMarketCandleCache(key, snapshot, 1_000);
  const cached = getTradingMarketCandleCache(key, 1_001);
  assert.deepEqual(cached?.candleBatch.candles, snapshot.candleBatch.candles);
  assert.notEqual(cached?.candleBatch.candles, snapshot.candleBatch.candles);
  assert.notEqual(cached?.stats, snapshot.stats);
  assert.equal(getTradingMarketCandleCache(key, 301_001)?.isStale, true);
  assert.equal(getTradingMarketCandleCache(key, 7 * 24 * 60 * 60_000 + 1_001), null);
});

test("favorite ticker drag order is stable across unrelated records and storage reloads", async () => {
  const {
    loadTradingFavoritesFromStorage,
    reorderTradingFavoriteRecords,
    saveTradingFavoritesToStorage,
  } = await import("../src/renderer/trading-expert-market.ts");
  const favoriteRecord = (id, assetClass = "crypto") => {
    const symbol = id.split(":").at(-1);
    return {
      id,
      provider: id.startsWith("FINNHUB:") ? "finnhub" : "binance",
      symbol,
      baseAsset: symbol.replace("USDT", ""),
      quoteAsset: assetClass === "crypto" ? "USDT" : "",
      displaySymbol: symbol,
      description: symbol,
      venue: assetClass === "crypto" ? "币安" : "NASDAQ",
      assetClass,
      marketType: assetClass === "crypto" ? "perpetual" : "global",
      tag: assetClass === "crypto" ? "永续" : "股票",
    };
  };
  const btc = favoriteRecord("BINANCE:FUTURES:BTCUSDT");
  const apple = favoriteRecord("FINNHUB:AAPL", "stock");
  const eth = favoriteRecord("BINANCE:FUTURES:ETHUSDT");
  const sol = favoriteRecord("BINANCE:FUTURES:SOLUSDT");
  const reordered = reorderTradingFavoriteRecords(
    [btc, apple, eth, sol],
    [sol.id, btc.id, eth.id],
  );
  assert.deepEqual(reordered.map(({ id }) => id), [sol.id, apple.id, btc.id, eth.id]);

  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  saveTradingFavoritesToStorage(storage, "account-a", {
    symbols: reordered.map(({ id }) => id),
    records: reordered,
  });
  assert.deepEqual(
    loadTradingFavoritesFromStorage(storage, "account-a").records.map(({ id }) => id),
    [sol.id, apple.id, btc.id, eth.id],
  );
});

test("new accounts start with only BTC and ETH perpetual favorites while a saved empty list stays empty", async () => {
  const {
    DEFAULT_TRADING_FAVORITE_MARKET_IDS,
    loadTradingFavoritesFromStorage,
    saveTradingFavoritesToStorage,
  } = await import("../src/renderer/trading-expert-market.ts");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  const firstLoad = loadTradingFavoritesFromStorage(storage, "account-new");
  assert.deepEqual(firstLoad.symbols, DEFAULT_TRADING_FAVORITE_MARKET_IDS);
  assert.deepEqual(
    firstLoad.records.map(({ id, displaySymbol, marketType, tag }) => ({ id, displaySymbol, marketType, tag })),
    [
      { id: "BINANCE:FUTURES:BTCUSDT", displaySymbol: "BTC/USDT", marketType: "perpetual", tag: "永续" },
      { id: "BINANCE:FUTURES:ETHUSDT", displaySymbol: "ETH/USDT", marketType: "perpetual", tag: "永续" },
    ],
  );

  saveTradingFavoritesToStorage(storage, "account-new", { symbols: [], records: [] });
  assert.deepEqual(loadTradingFavoritesFromStorage(storage, "account-new").symbols, []);
  assert.deepEqual(loadTradingFavoritesFromStorage(storage, "account-new").records, []);
  assert.deepEqual(
    loadTradingFavoritesFromStorage(storage, "another-new-account").symbols,
    DEFAULT_TRADING_FAVORITE_MARKET_IDS,
  );
});

test("trading favorites survive reconstruction, migrate locally, and stay account scoped", async () => {
  const {
    DEFAULT_TRADING_FAVORITE_MARKET_IDS,
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
    DEFAULT_TRADING_FAVORITE_MARKET_IDS,
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

test("chart bootstrap derives temporary quote stats without treating quote loading as a chart failure", async () => {
  const { tradingMarketStatsFromCandles } = await import("../src/renderer/trading-expert-market.ts");
  const stats = tradingMarketStatsFromCandles("BTCUSDT", [
    { close: 62_500 },
    { close: 63_710 },
  ]);

  assert.equal(stats.symbol, "BTCUSDT");
  assert.equal(stats.markPrice, 63_710);
  assert.equal(stats.midPrice, 63_710);
  assert.equal(stats.prevDayPrice, 63_710);
});

test("market candle cadence rejects daily data for intraday selections", async () => {
  const { tradingCandleSeriesMatchesResolution } = await import("../src/renderer/trading-expert-market.ts");
  const fiveMinute = Array.from({ length: 20 }, (_, index) => ({ time: 1_700_000_000 + index * 300 }));
  const daily = Array.from({ length: 20 }, (_, index) => ({ time: 1_700_000_000 + index * 86_400 }));

  assert.equal(tradingCandleSeriesMatchesResolution(fiveMinute, "5"), true);
  assert.equal(tradingCandleSeriesMatchesResolution(fiveMinute, "15"), false);
  assert.equal(tradingCandleSeriesMatchesResolution(daily, "5"), false);
  assert.equal(tradingCandleSeriesMatchesResolution(daily, "1D"), true);
});

test("current-market analysis rejects a cache whose latest candle is days behind now", async () => {
  const {
    tradingAnalysisCandlesRequireCurrentRefresh,
    tradingAnalysisShouldForceCurrentRefresh,
  } = await import("../src/renderer/trading-expert-market.ts");
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const currentHour = Math.floor((now - 30 * 60_000) / 3_600_000) * 3_600;
  const closedHour = currentHour - 3_600;
  const staleHour = currentHour - 48 * 3_600;

  assert.equal(
    tradingAnalysisCandlesRequireCurrentRefresh([{ time: currentHour }], "60", now),
    false,
  );
  assert.equal(
    tradingAnalysisCandlesRequireCurrentRefresh([{ time: closedHour }], "60", now),
    true,
  );
  assert.equal(
    tradingAnalysisCandlesRequireCurrentRefresh([{ time: staleHour }], "60", now),
    true,
  );
  assert.equal(
    tradingAnalysisCandlesRequireCurrentRefresh([], "60", now),
    true,
  );
  // A timestamp-only current forming candle is not enough for Binance: its
  // OHLC values can still be an old cache hit, so every current analysis must
  // fetch and reconcile a fresh snapshot.
  assert.equal(
    tradingAnalysisShouldForceCurrentRefresh("binance", [{ time: currentHour }], "60", now),
    true,
  );
  assert.equal(
    tradingAnalysisShouldForceCurrentRefresh("finnhub", [{ time: currentHour }], "60", now),
    false,
  );
  assert.equal(
    tradingAnalysisShouldForceCurrentRefresh("finnhub", [{ time: staleHour }], "60", now),
    true,
  );
});

test("all strategy chart runners refresh stale current snapshots before analysis", async () => {
  const source = await readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  for (const method of [
    "runGeneralConversation",
    "runChanConversation",
    "runWaveConversation",
    "runWyckoffConversation",
    "runOrderFlowConversation",
  ]) {
    const start = source.indexOf(`  async ${method}(`);
    assert.notEqual(start, -1, `${method} must exist`);
    const next = source.indexOf("\n  async ", start + 8);
    const block = source.slice(start, next === -1 ? source.length : next);
    assert.match(block, /tradingAnalysisShouldForceCurrentRefresh/);
    assert.match(block, /refreshCurrentMarketSnapshotForAnalysis/);
  }
});

test("current Binance strategy windows ignore an old chart viewport", async () => {
  const source = await readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  for (const method of [
    "runGeneralConversation",
    "runChanConversation",
    "runWaveConversation",
    "runWyckoffConversation",
    "runOrderFlowConversation",
  ]) {
    const start = source.indexOf(`  async ${method}(`);
    const next = source.indexOf("\n  async ", start + 8);
    const block = source.slice(start, next === -1 ? source.length : next);
    assert.match(block, /useCurrentMarketTail = targetMarket\.provider === "binance" && !requestedLookbackMs/);
    assert.match(block, /useCurrentMarketTail[\s\S]*?targetCandles\.slice\(-|useCurrentMarketTail[\s\S]*?this\.candles\.slice\(-/);
  }
  const refresh = source.slice(
    source.indexOf("  private async refreshCurrentMarketSnapshotForAnalysis("),
    source.indexOf("\n  private commitMarketSnapshot(", source.indexOf("  private async refreshCurrentMarketSnapshotForAnalysis(")),
  );
  assert.match(refresh, /if \(targetMarket\.provider === "binance"\)/);
  assert.match(refresh, /applyTradingLivePriceToBatch\(candleBatch, livePrice/);
  const splitPane = await readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8");
  assert.match(splitPane, /currentMarketAnalysis = this\.market\.provider === "binance" && !lookbackMs/);
  assert.match(splitPane, /currentMarketAnalysis[\s\S]*?await this\.reload\(true\)/);
  assert.match(source, /fetchTradingCandles\([\s\S]*?forceFresh: true/);
});

test("cached Binance history rejects expired forming fragments and backfills from the earliest one", async () => {
  const {
    tradingCandleBatchHasFinalizedHistory,
    tradingCandleRefreshStartTime,
  } = await import("../src/renderer/trading-expert-market.ts");
  const stepMs = 4 * 60 * 60_000;
  const start = 1_700_000_000;
  const candles = Array.from({ length: 6 }, (_, index) => ({
    time: start + index * stepMs / 1_000,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 10,
    closed: index !== 1 && index !== 5,
  }));
  const batch = {
    candles,
    sourceCandles: candles,
    source: { targetMs: stepMs, sourceInterval: "4h", sourceMs: stepMs },
  };
  const now = candles.at(-1).time * 1_000 + stepMs / 2;

  assert.equal(tradingCandleBatchHasFinalizedHistory(batch, now), false);
  assert.equal(tradingCandleRefreshStartTime(batch, now, 3), candles[1].time * 1_000);

  candles[1].closed = true;
  assert.equal(tradingCandleBatchHasFinalizedHistory(batch, now), true);
  assert.equal(tradingCandleRefreshStartTime(batch, now, 3), candles[3].time * 1_000);
});

test("Binance REST finality distinguishes a closed bar from the current forming bar", async () => {
  const { fetchTradingCandles } = await import("../src/renderer/trading-expert-market.ts");
  const originalWindow = globalThis.window;
  const now = Date.now();
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData() {
        return {
          ok: true,
          status: 200,
          cached: false,
          data: [
            [now - 120_000, "100", "102", "99", "101", "10", now - 60_001],
            [now - 60_000, "101", "103", "100", "102", "12", now + 59_999],
          ],
        };
      },
    },
  };
  try {
    const batch = await fetchTradingCandles("BTCUSDT", "1", 2, now, "perpetual");
    assert.deepEqual(batch.candles.map((candle) => candle.closed), [true, false]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
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

test("favorite ticker quotes update continuously through normalized Data Hub streams", async () => {
  const {
    applyTradingMarketTickerQuote,
    formatTradingMarketTickerPrice,
    tradingFavoriteTickerStreams,
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

  assert.deepEqual(
    tradingFavoriteTickerStreams(["ETHUSDT", "SOLUSDT", "ETHUSDT"]),
    ["ethusdt@ticker", "solusdt@ticker"],
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
  const originalWindow = globalThis.window;
  const paths = [];
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        paths.push(request.path);
        const payload = request.path === "/fapi/v1/exchangeInfo"
      ? { symbols: [
        { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "龙虾USDT", baseAsset: "龙虾", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "币安人生USDT", baseAsset: "币安人生", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
      ] }
      : request.path === "/fapi/v1/ticker/24hr"
        ? [
          { symbol: "BTCUSDT", lastPrice: "65000", openPrice: "64000", priceChangePercent: "1.5625", quoteVolume: "1000" },
          { symbol: "龙虾USDT", lastPrice: "0.06", openPrice: "0.05", priceChangePercent: "20", quoteVolume: "800" },
          { symbol: "币安人生USDT", lastPrice: "0.50", openPrice: "0.40", priceChangePercent: "25", quoteVolume: "700" },
        ]
        : request.path === "/api/v3/exchangeInfo"
          ? { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true }] }
          : [{ symbol: "BTCUSDT", lastPrice: "64900", openPrice: "64000", quoteVolume: "900" }];
        return { ok: true, status: 200, data: payload, cached: false };
      },
    },
  };
  try {
    const markets = await fetchTradingMarkets();
    assert.deepEqual(
      markets.map(({ id, tag }) => [id, tag]),
        [
          ["BINANCE:FUTURES:BTCUSDT", "永续"],
          ["BINANCE:SPOT:BTCUSDT", "现货"],
          ["BINANCE:FUTURES:龙虾USDT", "永续"],
          ["BINANCE:FUTURES:币安人生USDT", "永续"],
        ],
      );
    assert.equal(markets[1].changePercent, ((64_900 - 64_000) / 64_000) * 100);
    assert.equal(markets[2].displaySymbol, "龙虾/USDT");
    assert.equal(markets[3].displaySymbol, "币安人生/USDT");
    assert.deepEqual(paths, [
      "/fapi/v1/ticker/24hr",
      "/fapi/v1/exchangeInfo",
      "/api/v3/ticker/24hr",
      "/api/v3/exchangeInfo",
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("official Han-character Binance symbols reach the candle gateway unchanged", async () => {
  const { fetchTradingCandles } = await import("../src/renderer/trading-expert-market.ts");
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        requests.push(request);
        return {
          ok: true,
          status: 200,
          cached: false,
          data: [
            [1_700_000_000_000, "0.05", "0.07", "0.04", "0.06", "100", 1_700_086_399_999],
            [1_700_086_400_000, "0.06", "0.08", "0.05", "0.07", "120", 1_700_172_799_999],
          ],
        };
      },
    },
  };
  try {
    await fetchTradingCandles("龙虾USDT", "1D", 2, Date.now(), "perpetual");
    await fetchTradingCandles("币安人生USDT", "1D", 2, Date.now(), "perpetual");
    assert.deepEqual(requests.map((request) => request.parameters.symbol), [
      "龙虾USDT",
      "币安人生USDT",
    ]);
    assert.deepEqual(requests.map((request) => request.path), [
      "/fapi/v1/klines",
      "/fapi/v1/klines",
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("latest Binance candles share a stable gateway cache key while historical pages keep endTime", async () => {
  const { fetchTradingCandles } = await import("../src/renderer/trading-expert-market.ts");
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        requests.push(request);
        const end = Date.now();
        return {
          ok: true,
          status: 200,
          cached: false,
          data: [
            [end - 60_000, "1", "2", "0.5", "1.5", "10"],
            [end, "1.5", "2.5", "1", "2", "12"],
          ],
        };
      },
    },
  };
  try {
    await fetchTradingCandles("XRPUSDT", "60", 2, Date.now(), "perpetual");
    assert.equal(requests[0].parameters.endTime, undefined);

    const historicalEndTime = Date.now() - 5 * 60_000;
    await fetchTradingCandles("XRPUSDT", "60", 2, historicalEndTime, "perpetual");
    assert.equal(requests[1].parameters.endTime, historicalEndTime);

    const forceFreshEndTime = Date.now();
    await fetchTradingCandles("XRPUSDT", "60", 2, forceFreshEndTime, "perpetual", undefined, { forceFresh: true });
    assert.equal(requests[2].parameters.endTime, forceFreshEndTime);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("fast Binance catalog builds the perpetual picker from the lightweight ticker route", async () => {
  const { fetchTradingMarkets } = await import("../src/renderer/trading-expert-market.ts");
  const originalWindow = globalThis.window;
  const requests = [];
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        requests.push(request.path);
        return {
          ok: true,
          status: 200,
          cached: false,
          data: [
            { symbol: "XRPUSDT", lastPrice: "0.55", priceChangePercent: "1.2", quoteVolume: "100" },
            { symbol: "ETHBTC", lastPrice: "0.04", priceChangePercent: "0.1", quoteVolume: "50" },
          ],
        };
      },
    },
  };
  try {
    const markets = await fetchTradingMarkets({ fast: true });
    assert.deepEqual(requests, ["/fapi/v1/ticker/24hr"]);
    assert.deepEqual(markets.map((market) => market.id), ["BINANCE:FUTURES:XRPUSDT"]);
    assert.equal(markets[0].markPrice, 0.55);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Binance TradFi perpetual contracts are catalogued with their underlying categories", async () => {
  const {
    fetchTradingMarkets,
    isBinanceTradFiContract,
    tradingMarketCategoryIncludesAssetClass,
    tradingMarketCategoryLabel,
    TRADING_MARKET_CATEGORY_OPTIONS,
  } = await import("../src/renderer/trading-expert-market.ts");
  assert.equal(isBinanceTradFiContract({
    contractType: "TRADIFI_PERPETUAL",
    underlyingType: "COMMODITY",
    underlyingSubType: ["TradFi"],
  }), true);
  assert.equal(isBinanceTradFiContract({
    contractType: "PERPETUAL",
    underlyingType: "EQUITY",
    underlyingSubType: "TradFi",
  }), true);
  assert.equal(tradingMarketCategoryLabel("commodity"), "大宗商品");
  assert.equal(tradingMarketCategoryLabel("stock"), "美股");
  assert.equal(tradingMarketCategoryLabel("etf"), "美股");
  assert.equal(tradingMarketCategoryLabel("preipo"), "美股");
  assert.equal(tradingMarketCategoryIncludesAssetClass("stock", "stock"), true);
  assert.equal(tradingMarketCategoryIncludesAssetClass("stock", "etf"), true);
  assert.equal(tradingMarketCategoryIncludesAssetClass("stock", "preipo"), true);
  assert.equal(tradingMarketCategoryIncludesAssetClass("stock", "index"), false);
  assert.equal(tradingMarketCategoryLabel("a-share"), "A股");
  assert.equal(tradingMarketCategoryIncludesAssetClass("a-share", "a-share"), true);
  assert.equal(tradingMarketCategoryIncludesAssetClass("a-share", "stock"), false);
  assert.deepEqual(TRADING_MARKET_CATEGORY_OPTIONS, [
    { id: "all", label: "全部" },
    { id: "crypto", label: "加密货币" },
    { id: "commodity", label: "大宗商品" },
    { id: "stock", label: "美股" },
    { id: "a-share", label: "A股" },
  ]);
  const originalWindow = globalThis.window;
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        const payload = request.path === "/fapi/v1/exchangeInfo"
          ? {
            symbols: [
              {
                symbol: "SNDKUSDT",
                baseAsset: "SNDK",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "EQUITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
              {
                symbol: "XAUUSDT",
                baseAsset: "XAU",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "COMMODITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
              {
                symbol: "XAGUSDT",
                baseAsset: "XAG",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "COMMODITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
              {
                symbol: "SPCXUSD1",
                baseAsset: "SPCX",
                quoteAsset: "USD1",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "EQUITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
              {
                symbol: "OPENAIUSDT",
                baseAsset: "OPENAI",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "PREMARKET",
                underlyingSubType: ["Pre-IPO", "TradFi"],
                status: "TRADING",
              },
            ],
          }
          : request.path === "/fapi/v1/ticker/24hr"
            ? [
              { symbol: "SNDKUSDT", lastPrice: "1725.97", priceChangePercent: "4.05", quoteVolume: "1000" },
              { symbol: "XAUUSDT", lastPrice: "4398.98", priceChangePercent: "0.25", quoteVolume: "900" },
              { symbol: "XAGUSDT", lastPrice: "65.62", priceChangePercent: "0.89", quoteVolume: "850" },
              { symbol: "SPCXUSD1", lastPrice: "141.62", priceChangePercent: "0.95", quoteVolume: "800" },
              { symbol: "OPENAIUSDT", lastPrice: "99.5", priceChangePercent: "1.4", quoteVolume: "700" },
            ]
            : request.path === "/api/v3/exchangeInfo"
              ? { symbols: [] }
              : [];
        return { ok: true, status: 200, data: payload, cached: false };
      },
    },
  };
  try {
    const markets = await fetchTradingMarkets();
    assert.deepEqual(
      markets.map(({ symbol, quoteAsset, assetClass, description }) => ({ symbol, quoteAsset, assetClass, description })),
      [
        { symbol: "SNDKUSDT", quoteAsset: "USDT", assetClass: "stock", description: "SNDK/USDT 币安传统金融永续合约" },
        { symbol: "XAUUSDT", quoteAsset: "USDT", assetClass: "commodity", description: "XAU/USDT 币安传统金融永续合约" },
        { symbol: "XAGUSDT", quoteAsset: "USDT", assetClass: "commodity", description: "XAG/USDT 币安传统金融永续合约" },
        { symbol: "SPCXUSD1", quoteAsset: "USD1", assetClass: "stock", description: "SPCX/USD1 币安传统金融永续合约" },
        { symbol: "OPENAIUSDT", quoteAsset: "USDT", assetClass: "preipo", description: "OPENAI/USDT 币安传统金融永续合约" },
      ],
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Binance TradFi spot wrappers inherit Futures categories and keep every live quote", async () => {
  const { fetchTradingMarkets, binanceTradFiSpotAssetClass } = await import("../src/renderer/trading-expert-market.ts");
  assert.equal(binanceTradFiSpotAssetClass("XAUT", new Map([["XAU", "commodity"]])), "commodity");
  assert.equal(binanceTradFiSpotAssetClass("SNDKB", new Map([["SNDK", "stock"]])), "stock");
  const originalWindow = globalThis.window;
  globalThis.window = {
    ...(originalWindow || {}),
    codexDesktop: {
      ...(originalWindow?.codexDesktop || {}),
      async getBinancePublicMarketData(request) {
        const payload = request.path === "/fapi/v1/exchangeInfo"
          ? {
            symbols: [
              {
                symbol: "XAUUSDT",
                baseAsset: "XAU",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "COMMODITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
              {
                symbol: "SNDKUSDT",
                baseAsset: "SNDK",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                underlyingType: "EQUITY",
                underlyingSubType: ["TradFi"],
                status: "TRADING",
              },
            ],
          }
          : request.path === "/fapi/v1/ticker/24hr"
            ? []
            : request.path === "/api/v3/exchangeInfo"
              ? {
                symbols: [
                  { symbol: "XAUTUSDT", baseAsset: "XAUT", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
                  { symbol: "XAUTUSDC", baseAsset: "XAUT", quoteAsset: "USDC", status: "TRADING", isSpotTradingAllowed: true },
                  { symbol: "XAUTBTC", baseAsset: "XAUT", quoteAsset: "BTC", status: "TRADING", isSpotTradingAllowed: true },
                  { symbol: "SNDKBUSDT", baseAsset: "SNDKB", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
                  { symbol: "ETHUSDC", baseAsset: "ETH", quoteAsset: "USDC", status: "TRADING", isSpotTradingAllowed: true },
                ],
              }
              : [
                { symbol: "XAUTUSDT", lastPrice: "4400", openPrice: "4300", quoteVolume: "100" },
                { symbol: "XAUTUSDC", lastPrice: "4401", openPrice: "4301", quoteVolume: "250" },
                { symbol: "XAUTBTC", lastPrice: "0.07", openPrice: "0.06", quoteVolume: "300" },
                { symbol: "SNDKBUSDT", lastPrice: "18", openPrice: "17", quoteVolume: "200" },
              ];
        return { ok: true, status: 200, data: payload, cached: false };
      },
    },
  };
  try {
    const spotMarkets = (await fetchTradingMarkets()).filter((market) => market.marketType === "spot");
    assert.deepEqual(
      spotMarkets.map(({ symbol, quoteAsset, assetClass, description }) => ({ symbol, quoteAsset, assetClass, description })),
      [
        { symbol: "XAUTBTC", quoteAsset: "BTC", assetClass: "commodity", description: "XAUT/BTC 币安传统金融现货" },
        { symbol: "XAUTUSDC", quoteAsset: "USDC", assetClass: "commodity", description: "XAUT/USDC 币安传统金融现货" },
        { symbol: "SNDKBUSDT", quoteAsset: "USDT", assetClass: "stock", description: "SNDKB/USDT 币安传统金融现货" },
        { symbol: "XAUTUSDT", quoteAsset: "USDT", assetClass: "commodity", description: "XAUT/USDT 币安传统金融现货" },
      ],
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
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
  assert.equal(tradingViewResolutionDurationMs("1M"), 2_592_000_000);
  assert.equal(tradingViewResolutionDurationMs("12M"), 31_104_000_000);
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
  assert.deepEqual(binanceResolutionSource("1M"), {
    targetMs: 2_592_000_000,
    sourceInterval: "1M",
    sourceMs: 2_592_000_000,
  });

  const monday = Date.UTC(2026, 7, 31, 0, 0, 0) / 1_000;
  const weekly = aggregateTradingCandles([
    { time: monday, open: 10, high: 12, low: 9, close: 11, volume: 2, closed: true },
    { time: monday + 3 * 86_400, open: 11, high: 14, low: 10, close: 13, volume: 3, closed: true },
  ], 604_800_000, "1w");
  assert.deepEqual(weekly.map(({ time, close, volume }) => ({ time, close, volume })), [
    { time: monday, close: 13, volume: 5 },
  ], "weekly aggregation must not fall back to the Unix Thursday anchor");

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

test("main-chart indicators expose working calculations and VPVR is placed after BBI", async () => {
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
    ["ma", "ema", "boll", "td", "bbi", "vpvr"],
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

test("VPVR distributes visible OHLCV across price rows and identifies POC/value area", async () => {
  const { calculateTradingVolumeProfile } = await import("../src/renderer/trading-volume-profile.ts");
  const profile = calculateTradingVolumeProfile([
    { low: 0, high: 8, volume: 80 },
    { low: 6, high: 8, volume: 40 },
  ], 8);

  assert.ok(profile);
  assert.equal(profile.rows.length, 8);
  assert.ok(Math.abs(profile.totalVolume - 120) < 1e-9);
  assert.equal(profile.pocIndex, 6);
  assert.equal(profile.rows[6].volume, 30);
  assert.equal(profile.rows[6].poc, true);
  assert.ok(profile.rows[6].valueArea);
  const valueAreaVolume = profile.rows
    .filter((row) => row.valueArea)
    .reduce((sum, row) => sum + row.volume, 0);
  assert.ok(valueAreaVolume >= profile.totalVolume * 0.7);
  assert.equal(calculateTradingVolumeProfile([{ low: 10, high: 12, volume: 0 }], 32), null);
  assert.equal(calculateTradingVolumeProfile([{ low: 10, high: 12, volume: 1 }], 200)?.rows.length, 96);
  assert.equal(calculateTradingVolumeProfile([{ low: 10, high: 12, volume: 1 }])?.rows.length, 96);
});

test("VPVR v3 defaults migrate once to 96 light-blue rows without overwriting custom choices", async () => {
  const {
    migrateTradingVpvrDefaults,
    normalizeTradingIndicatorSettings,
  } = await import("../src/renderer/trading-expert-market.ts");
  const legacy = normalizeTradingIndicatorSettings({
    "main:vpvr": {
      enabled: true,
      parameters: [32],
      series: {
        volume: { visible: true, color: "#5b95e5", lineWidth: 2 },
        poc: { visible: true, color: "#f59e0b", lineWidth: 2 },
      },
    },
  });
  const migrated = migrateTradingVpvrDefaults(legacy);
  assert.deepEqual(migrated["main:vpvr"].parameters, [96]);
  assert.equal(migrated["main:vpvr"].series.volume.color, "#5b95e5");
  assert.equal(migrated["main:vpvr"].series.poc.color, "#5b95e5");
  assert.deepEqual(legacy["main:vpvr"].parameters, [32]);
  assert.equal(legacy["main:vpvr"].series.poc.color, "#f59e0b");

  const custom = normalizeTradingIndicatorSettings({
    "main:vpvr": {
      parameters: [48],
      series: { poc: { visible: true, color: "#123456", lineWidth: 1 } },
    },
  });
  const customMigrated = migrateTradingVpvrDefaults(custom);
  assert.deepEqual(customMigrated["main:vpvr"].parameters, [48]);
  assert.equal(customMigrated["main:vpvr"].series.poc.color, "#123456");
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
  assert.deepEqual(initialMarketLogicalRange(80, "1D"), { from: -100, to: 85 });
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

test("TradFi asset logos use deterministic local marks when exchange logos are unavailable", async () => {
  const { renderTradingMarketAssetLogo } = await import("../src/renderer/trading-expert-market-identity.ts");

  const xau = renderTradingMarketAssetLogo("XAU", "binance", false, "commodity");
  assert.match(xau, /data-market-logo-local="commodity"/);
  assert.match(xau, /data-market-logo-glyph="Au"/);
  assert.doesNotMatch(xau, /bin\.bnbstatic\.com/);

  const sndk = renderTradingMarketAssetLogo("SNDK", "binance", false, "stock");
  assert.match(sndk, /data-market-logo-local="stock"/);
  assert.match(sndk, /asset-symbol-sndk/);
  assert.match(sndk, /data-market-logo-glyph="S"/);

  const xag = renderTradingMarketAssetLogo("XAG", "binance", false, "commodity");
  assert.match(xag, /asset-symbol-xag/);
  assert.match(xag, /data-market-logo-glyph="Ag"/);

  const xaut = renderTradingMarketAssetLogo("XAUT", "binance", false, "commodity");
  assert.match(xaut, /asset-symbol-xaut/);
  assert.match(xaut, /data-market-logo-glyph="Au"/);

  const sndkSpot = renderTradingMarketAssetLogo("SNDKB", "binance", false, "stock");
  assert.match(sndkSpot, /asset-symbol-sndkb/);
  assert.match(sndkSpot, /data-market-logo-glyph="S"/);

  const preIpo = renderTradingMarketAssetLogo("OPENAI", "binance", false, "preipo");
  assert.match(preIpo, /data-market-logo-local="preipo"/);

  const btc = renderTradingMarketAssetLogo("BTC", "binance");
  assert.match(btc, /data-market-logo-stage="binance"/);
  assert.match(btc, /bin\.bnbstatic\.com\/static\/assets\/logos\/BTC\.png/);

  const aShare = renderTradingMarketAssetLogo("600519", "ifind", false, "a-share", "贵州茅台");
  assert.match(aShare, /asset-class-a-share/);
  assert.match(aShare, /data-market-logo-local="a-share"/);
  assert.match(aShare, /data-market-logo-glyph="贵"/);
  assert.doesNotMatch(aShare, /bin\.bnbstatic\.com/);
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
  assert.equal(defaults["sub:volume"].enabled, true);
  assert.equal(defaults["sub:macd"].enabled, false);
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

  assert.equal(TRADING_MARKET_INDICATOR_CATALOG.filter((item) => item.scope === "main").length, 6);
  assert.equal(TRADING_MARKET_INDICATOR_CATALOG.filter((item) => item.scope === "sub").length, 13);
  assert.equal(Object.keys(settings).length, 19);
  assert.equal(settings["main:ma"].enabled, true);
  assert.deepEqual(settings["main:ma"].parameters, [2, 500, 20]);
  assert.deepEqual(settings["main:ma"].series.short, {
    visible: false,
    color: "#123456",
    lineWidth: 3,
  });
  assert.deepEqual(settings["main:vpvr"].parameters, [96]);
  assert.equal(settings["main:vpvr"].series.volume.color, "#5b95e5");
  assert.equal(settings["main:vpvr"].series.poc.color, "#5b95e5");
  assert.equal(settings["main:vpvr"].series.volume.visible, true);
  assert.equal(settings["main:vpvr"].series.poc.visible, true);
  assert.equal(settings["sub:obv"].parameters.length, 0);
});
