import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { marketDataBackendErrorPayload } from "../src/main/market-data/backend-errors.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

test("Finnhub market data uses authenticated Haolo backend endpoints without exposing its key", async () => {
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

    await client.getFinnhubMarketDataStatus();
    await client.searchFinnhubMarkets({ query: "BTC/USDT", limit: 12 });
    await client.getFinnhubMarketQuotes({ symbols: ["AAPL"] });
    await client.getFinnhubMarketSnapshot({ symbol: "AAPL", assetClass: "stock" });
    await client.getFinnhubMarketCandles({ symbol: "AAPL", assetClass: "stock", resolution: "D" });

    assert.equal(requests.length, 5);
    assert.equal(requests[0].url, "https://haolo.example/api/market-data/finnhub/status");
    assert.equal(requests[1].url, "https://haolo.example/api/market-data/finnhub/search?q=BTC%2FUSDT&limit=12");
    assert.deepEqual(
      requests.slice(2).map(({ url }) => new URL(url).pathname),
      [
        "/api/market-data/finnhub/quotes",
        "/api/market-data/finnhub/snapshot",
        "/api/market-data/finnhub/candles",
      ],
    );
    requests.forEach(({ url, init }) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer haolo-session-token");
      assert.equal(headers.has("x-finnhub-token"), false);
      assert.doesNotMatch(url, /token|api[_-]?key|secret/i);
    });
    await assert.rejects(
      client.postFinnhubMarketData("arbitrary-endpoint", {}),
      /Unsupported market-data operation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("backend market-data errors are reduced to stable renderer-safe messages", () => {
  assert.deepEqual(marketDataBackendErrorPayload({ code: "FINNHUB_UNAUTHORIZED" }), {
    ok: false,
    code: "FINNHUB_UNAUTHORIZED",
    message: "目前版本此交易对数据还未接入",
  });
  assert.deepEqual(
    marketDataBackendErrorPayload({
      code: "FINNHUB_RATE_LIMITED",
      status: 429,
      retryAfterMs: 1_500,
      message: "upstream secret details",
    }),
    {
      ok: false,
      code: "FINNHUB_RATE_LIMITED",
      message: "全球行情请求较多，请稍等片刻再试。",
      status: 429,
      retryAfterMs: 1_500,
    },
  );
  assert.deepEqual(marketDataBackendErrorPayload({ code: "UNKNOWN", message: "secret" }), {
    ok: false,
    code: "MARKET_DATA_FAILED",
    message: "全球行情服务暂时不可用，请稍后重试。",
  });
});

test("desktop exposes only narrow backend-managed Finnhub IPC methods", async () => {
  const [main, preload, renderer, apiClient] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(main, /getYouleApiClient\(\)\.searchFinnhubMarkets\(params\)/);
  assert.match(main, /assertExternalModelsIpcSender\(event\)/);
  assert.match(preload, /searchFinnhubMarkets: \(params\) => ipcRenderer\.invoke\("marketData:searchFinnhub", params\)/);
  assert.match(apiClient, /DEFAULT_FINNHUB_MARKET_DATA_PATH = "\/api\/market-data\/finnhub"/);
  assert.match(renderer, /response\.status\?\.available === true/);
  assert.match(renderer, /GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE = "目前版本此交易对数据还未接入"/);
  assert.match(renderer, /targetProvider === "finnhub"\s*\? GLOBAL_MARKET_DATA_UNAVAILABLE_MESSAGE/);
  assert.match(renderer, /action === "open-default-market"/);
  assert.match(renderer, /candidate\.id === `BINANCE:FUTURES:\$\{DEFAULT_SYMBOL\}`/);
  assert.match(renderer, /点击加载 BTC\/USDT 永续合约/);
  assert.doesNotMatch(`${main}\n${preload}\n${renderer}\n${apiClient}`, /FinnhubCredentialStore|FinnhubMarketDataService/);
  assert.doesNotMatch(preload, /saveFinnhub|removeFinnhub|testFinnhub|resolveFinnhub|getFinnhubApiKey/);
  assert.doesNotMatch(renderer, /type="password"|data-market-finnhub-key|saveFinnhubMarketDataApiKey/);
  assert.doesNotMatch(`${main}\n${preload}\n${renderer}\n${apiClient}`, /FINNHUB_API_KEY|X-Finnhub-Token/);
});
