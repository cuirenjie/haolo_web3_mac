import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { marketDataBackendErrorPayload } from "../src/main/market-data/backend-errors.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

test("iFinD A-share data uses authenticated backend endpoints without exposing tokens", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, markets: [], quotes: [], candles: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new YouleApiClient();
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";

    await client.getIfindMarketDataStatus();
    await client.searchIfindMarkets({ query: "600519", limit: 12 });
    await client.searchIfindMarkets({ query: "", limit: 30 });
    await client.getIfindMarketQuotes({ symbols: ["600519.SH"] });
    await client.getIfindMarketSnapshot({
      symbol: "600519.SH",
      assetClass: "stock",
      resolution: "1D",
    });
    await client.getIfindMarketCandles({
      symbol: "600519.SH",
      assetClass: "stock",
      resolution: "60",
    });

    assert.equal(requests.length, 6);
    assert.equal(requests[0].url, "https://haolo.example/api/market-data/ifind/status");
    assert.equal(requests[1].url, "https://haolo.example/api/market-data/ifind/search?q=600519&limit=12");
    assert.equal(requests[2].url, "https://haolo.example/api/market-data/ifind/search?q=&limit=30");
    assert.deepEqual(
      requests.slice(3).map(({ url }) => new URL(url).pathname),
      [
        "/api/market-data/ifind/quotes",
        "/api/market-data/ifind/snapshot",
        "/api/market-data/ifind/candles",
      ],
    );
    requests.forEach(({ url, init }) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer haolo-session-token");
      assert.equal(headers.has("refresh_token"), false);
      assert.equal(headers.has("access_token"), false);
      assert.doesNotMatch(url, /token|api[_-]?key|secret/i);
    });
    await assert.rejects(
      client.postIfindMarketData("arbitrary-endpoint", {}),
      /Unsupported market-data operation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("iFinD backend errors are reduced to stable renderer-safe messages", () => {
  assert.deepEqual(marketDataBackendErrorPayload({ code: "IFIND_QUOTA_EXCEEDED" }), {
    ok: false,
    code: "IFIND_QUOTA_EXCEEDED",
    message: "同花顺 A 股行情额度暂不可用，请联系管理员。",
  });
  assert.deepEqual(
    marketDataBackendErrorPayload({
      code: "IFIND_INVALID_SYMBOL",
      message: "upstream secret details",
    }),
    {
      ok: false,
      code: "IFIND_INVALID_SYMBOL",
      message: "A 股代码格式不正确。",
    },
  );
});

test("desktop exposes a narrow iFinD bridge and wires A shares into search and candles", async () => {
  const [main, preload, renderer, apiClient, styles] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(main, /getYouleApiClient\(\)\.searchIfindMarkets\(params\)/);
  assert.match(preload, /searchIfindMarkets: \(params\) => ipcRenderer\.invoke\("marketData:searchIfind", params\)/);
  assert.match(apiClient, /DEFAULT_IFIND_MARKET_DATA_PATH = "\/api\/market-data\/ifind"/);
  assert.match(renderer, /type TradingMarketProvider = "binance" \| "finnhub" \| "ifind"/);
  assert.match(renderer, /window\.codexDesktop\.searchIfindMarkets/);
  assert.match(renderer, /normalizeIfindTradingMarket/);
  assert.match(renderer, /IFIND_DEFAULT_DIRECTORY_LIMIT = 30/);
  assert.match(renderer, /this\.ifindConfigured && this\.marketCategory === "a-share"/);
  assert.match(renderer, /item\.description \|\| item\.displaySymbol/);
  assert.match(renderer, /window\.codexDesktop\.getIfindMarketSnapshot/);
  assert.match(renderer, /window\.codexDesktop\.getIfindMarketCandles/);
  assert.match(renderer, /function ifindSupportsTradingResolution\(resolution: string\)/);
  assert.match(renderer, /this\.syncIntervalAvailability\(\)/);
  assert.match(renderer, /同花顺 A 股当前仅支持日线和周线/);
  assert.match(renderer, /A股行情服务尚未完成后台配置/);
  assert.match(renderer, /provider: "ifind"/);
  assert.match(renderer, /tag: String\(item\.tag \|\| "A股"\)/);
  assert.match(styles, /\.trading-market-asset-logo\.provider-finnhub,\s*\.trading-market-asset-logo\.provider-ifind/);
  assert.match(styles, /\.trading-market-row-code/);
  assert.match(styles, /\.trading-market-asset-mark\.asset-class-a-share[\s\S]*?background:\s*#d9363e/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market/);
  assert.match(styles, /\.trading-market-times button:hover:not\(:disabled\)/);
  assert.doesNotMatch(`${main}\n${preload}\n${renderer}\n${apiClient}`, /IFIND_REFRESH_TOKEN|IFIND_ACCESS_TOKEN|X-iFinD-Token/i);
});

test("iFinD symbols are isolated in the A-share picker category", async () => {
  const {
    normalizeIfindTradingMarket,
    tradingMarketCategoryIncludesAssetClass,
  } = await import("../src/renderer/trading-expert-market.ts");
  const market = normalizeIfindTradingMarket({
    symbol: "600519.SH",
    displaySymbol: "600519",
    description: "贵州茅台",
    venue: "上海证券交易所",
    markPrice: 1_500,
    changePercent: 1.2,
  });
  assert.equal(market?.assetClass, "a-share");
  assert.equal(market?.displaySymbol, "贵州茅台");
  assert.equal(market?.baseAsset, "600519");
  assert.equal(market?.venue, "上交所");
  assert.equal(tradingMarketCategoryIncludesAssetClass("a-share", market.assetClass), true);
  assert.equal(tradingMarketCategoryIncludesAssetClass("stock", market.assetClass), false);
});
