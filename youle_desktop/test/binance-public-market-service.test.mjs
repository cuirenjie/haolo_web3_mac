import assert from "node:assert/strict";
import test from "node:test";
import {
  BinancePublicMarketService,
  normalizeBinancePublicMarketRequest,
} from "../src/main/binance-public-market-service.mjs";

test("public market gateway accepts only fixed Binance read-only routes and parameters", () => {
  assert.equal(
    normalizeBinancePublicMarketRequest({
      marketType: "futures",
      path: "/fapi/v1/klines",
      parameters: { symbol: "btcusdt", interval: "1m", limit: 500 },
    }).url,
    "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500",
  );
  assert.equal(
    normalizeBinancePublicMarketRequest({
      marketType: "spot",
      path: "/api/v3/exchangeInfo",
      parameters: { permissions: "SPOT", symbolStatus: "TRADING" },
    }).url,
    "https://data-api.binance.vision/api/v3/exchangeInfo?permissions=SPOT&symbolStatus=TRADING",
  );
  assert.equal(
    normalizeBinancePublicMarketRequest({
      marketType: "spot",
      path: "/api/v3/ticker/24hr",
      parameters: { type: "MINI" },
    }).url,
    "https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI",
  );
  const hanSymbolRequest = normalizeBinancePublicMarketRequest({
    marketType: "futures",
    path: "/fapi/v1/klines",
    parameters: { symbol: "龙虾USDT", interval: "1d", limit: 2 },
  });
  assert.equal(new URL(hanSymbolRequest.url).searchParams.get("symbol"), "龙虾USDT");
  assert.throws(
    () => normalizeBinancePublicMarketRequest({ marketType: "futures", path: "/fapi/v1/order", parameters: {} }),
    /not allowed/,
  );
  assert.throws(
    () => normalizeBinancePublicMarketRequest({ marketType: "spot", path: "/api/v3/klines", parameters: { signature: "secret" } }),
    /not allowed/,
  );
  assert.throws(
    () => normalizeBinancePublicMarketRequest({ marketType: "spot", path: "/api/v3/klines", parameters: { symbol: "BTC/USDT" } }),
    /symbol/,
  );
});

test("public market service returns structured symbol failures instead of leaking IPC exceptions", async () => {
  let calls = 0;
  const service = new BinancePublicMarketService({
    fetch: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const result = await service.request({
    marketType: "futures",
    path: "/fapi/v1/klines",
    parameters: { symbol: "龙虾/USDT", interval: "1d", limit: 500 },
  });
  assert.deepEqual(result, {
    ok: false,
    status: 400,
    data: null,
    cached: false,
    retryAfterMs: null,
    error: "Invalid Binance symbol",
    errorCode: "BINANCE_MARKET_SYMBOL_INVALID",
  });
  assert.equal(calls, 0);
});

test("public market service classifies Binance's delisted or unknown symbol response", async () => {
  const service = new BinancePublicMarketService({
    fetch: async () => new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), {
      status: 400,
    }),
  });
  const result = await service.request({
    marketType: "futures",
    path: "/fapi/v1/klines",
    parameters: { symbol: "LOBSTERUSDT", interval: "1d", limit: 500 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid symbol.");
  assert.equal(result.errorCode, "BINANCE_MARKET_SYMBOL_UNAVAILABLE");
});

test("public market gateway accepts deployment-specific HTTPS market gateways", () => {
  const request = normalizeBinancePublicMarketRequest({
    marketType: "futures",
    path: "/fapi/v1/klines",
    parameters: { symbol: "BTCUSDT", interval: "1m", limit: 2 },
  }, {
    baseUrls: {
      futures: "https://market-gateway.example.test",
      spot: "https://spot-gateway.example.test",
    },
  });
  assert.equal(
    request.url,
    "https://market-gateway.example.test/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2",
  );
  assert.throws(
    () => normalizeBinancePublicMarketRequest({ marketType: "spot", path: "/api/v3/klines" }, {
      baseUrls: { spot: "http://insecure.example.test", futures: "https://futures.example.test" },
    }),
    /HTTPS origin/,
  );
});

test("public market gateway caches immutable results and avoids duplicate network weight", async () => {
  let calls = 0;
  let currentMs = 1_000_000;
  const service = new BinancePublicMarketService({
    now: () => currentMs,
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify([{ symbol: "BTCUSDT" }]), { status: 200 });
    },
  });
  const request = { marketType: "futures", path: "/fapi/v1/ticker/24hr", parameters: {} };
  const first = await service.request(request);
  first.data[0].symbol = "MUTATED";
  const second = await service.request(request);
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.data, [{ symbol: "BTCUSDT" }]);
  currentMs += 30_001;
  await service.request(request);
  assert.equal(calls, 2);
});

test("public market gateway preserves shared cooldown status and Retry-After", async () => {
  const service = new BinancePublicMarketService({
    fetch: async () => new Response(JSON.stringify({ code: -1003, msg: "cooldown" }), {
      status: 429,
      headers: { "retry-after": "37", "x-haolo-binance-governor": "upstream" },
    }),
  });
  const result = await service.request({
    marketType: "futures",
    path: "/fapi/v1/premiumIndex",
    parameters: { symbol: "BTCUSDT" },
  });
  assert.deepEqual(result, {
    ok: false,
    status: 429,
    data: null,
    cached: false,
    retryAfterMs: 37_000,
    error: "cooldown",
  });
});

test("main-process public service can delegate its deadline and honor renderer cancellation", async () => {
  let receivedSignal = null;
  const service = new BinancePublicMarketService({
    timeoutMs: 0,
    fetch: async (_url, init) => {
      receivedSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = service.request({
    marketType: "futures",
    path: "/fapi/v1/klines",
    parameters: { symbol: "ZECUSDT", interval: "4h", limit: 500 },
  }, { signal: controller.signal });
  await Promise.resolve();
  assert.equal(receivedSignal, controller.signal);
  controller.abort(new DOMException("superseded", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("renderer market REST is authenticated IPC-only and shares the main governor", async () => {
  const { readFile } = await import("node:fs/promises");
  const [main, preload, renderer] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
  ]);
  assert.match(main, /ipcMain\.handle\("binanceMarket:publicGet"[\s\S]*assertExternalModelsIpcSender\(event\)[\s\S]*getBinancePublicMarketService\(\)\.request/);
  assert.match(main, /new BinancePublicMarketService\([\s\S]*getBinanceRequestGovernor\(\)\.fetch\([\s\S]*router\.publicFetch\.bind\(router\)/);
  assert.match(preload, /getBinancePublicMarketData: \(params\) => ipcRenderer\.invoke\("binanceMarket:publicGet", params\)/);
  assert.match(preload, /cancelBinancePublicMarketData: \(params\) => ipcRenderer\.invoke\("binanceMarket:publicCancel", params\)/);
  assert.match(main, /new BinancePublicMarketService\([\s\S]*timeoutMs: 0/);
  assert.match(main, /metadataRequest \? 50_000 : chartRequest \? 50_000 : 30_000/);
  assert.match(main, /pathname\.endsWith\("\/ticker\/24hr"\) && !requestUrl\.searchParams\.has\("symbol"\)/);
  assert.match(main, /BINANCE_REQUEST_PRIORITIES\.metadata/);
  assert.match(main, /binancePublicRequestCoordinator\.begin\(ownerId, requestId\)/);
  assert.match(renderer, /marketDataRequestAbortController\?\.abort\(\)/);
  assert.match(renderer, /cancelBinancePublicMarketData/);
  assert.match(renderer, /window\.codexDesktop\?\.getBinancePublicMarketData/);
  assert.doesNotMatch(renderer, /fetch\(url, \{ cache: "no-store", signal \}\)/);
});
