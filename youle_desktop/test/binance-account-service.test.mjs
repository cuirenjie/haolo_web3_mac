import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BinanceCredentialStore } from "../src/main/binance-account/credential-store.mjs";
import {
  BinanceAccountError,
  BinanceAccountService,
  buildSignedBinanceUrl,
  normalizeBinanceAccountSnapshot,
  normalizeBinanceOpenOrders,
  normalizeBinancePositionHistory,
  normalizeBinanceProfitCalendar,
} from "../src/main/binance-account/service.mjs";
import { createUserDataSnapshot, restoreUserDataSnapshot } from "../src/main/user-data-transfer.mjs";

const API_KEY = "binance-api-key-test-123456";
const API_SECRET = "binance-secret-never-write-plaintext";
const OWNER = "https://haolo.example::user-42";

test("Binance credential vault encrypts per-account credentials and returns only masked status", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-binance-vault-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "binance-account-credentials.json");
  const store = new BinanceCredentialStore({
    storagePath,
    safeStorage: fakeSafeStorage(),
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });

  const status = await store.upsert(OWNER, { apiKey: API_KEY, apiSecret: API_SECRET });
  assert.equal(status.bound, true);
  assert.equal(status.apiKeyMasked, "bina••••••3456");
  assert.equal("apiKey" in status, false);
  assert.equal("apiSecret" in status, false);

  const disk = await fs.promises.readFile(storagePath, "utf8");
  assert.equal(disk.includes(API_KEY), false);
  assert.equal(disk.includes(API_SECRET), false);
  assert.equal(disk.includes(OWNER), false);
  assert.deepEqual(await store.resolve(OWNER), { apiKey: API_KEY, apiSecret: API_SECRET });
  assert.equal((await store.status("different-user")).bound, false);
});

test("Binance credential vault fails closed without Electron safeStorage", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-binance-no-vault-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "binance-account-credentials.json");
  const store = new BinanceCredentialStore({
    storagePath,
    safeStorage: { isEncryptionAvailable: () => false },
  });
  await assert.rejects(
    store.upsert(OWNER, { apiKey: API_KEY, apiSecret: API_SECRET }),
    (error) => error?.code === "SECURE_STORAGE_UNAVAILABLE",
  );
  assert.equal(fs.existsSync(storagePath), false);
});

test("signed Binance URLs use the exact encoded query and HMAC-SHA256", () => {
  const url = new URL(buildSignedBinanceUrl({
    baseUrl: "https://fapi.binance.com",
    pathname: "/fapi/v3/account",
    params: { recvWindow: 5000, timestamp: 1_660_000_000_000 },
    apiSecret: API_SECRET,
  }));
  const unsigned = "recvWindow=5000&timestamp=1660000000000";
  const expected = crypto.createHmac("sha256", API_SECRET).update(unsigned).digest("hex");
  assert.equal(url.origin, "https://fapi.binance.com");
  assert.equal(url.pathname, "/fapi/v3/account");
  assert.equal(url.searchParams.get("signature"), expected);
});

test("account reads re-time and re-sign after the direct route switches to Haolo", async () => {
  const signedRequests = [];
  let timeRequests = 0;
  const service = new BinanceAccountService({
    credentialStore: { resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }) },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/v3/time") {
        timeRequests += 1;
        return jsonResponse({ serverTime: timeRequests === 1 ? 1_700_000_000_000 : 1_700_000_000_500 });
      }
      if (parsed.pathname === "/sapi/v1/asset/wallet/balance") {
        signedRequests.push({
          timestamp: parsed.searchParams.get("timestamp"),
          signature: parsed.searchParams.get("signature"),
          apiKey: new Headers(init.headers).get("x-mbx-apikey"),
        });
        if (signedRequests.length === 1) {
          const error = new Error("direct route failed");
          error.code = "BINANCE_DIRECT_ROUTE_FAILED";
          throw error;
        }
        return jsonResponse([]);
      }
      throw new Error(`unexpected route ${parsed.pathname}`);
    },
  });

  assert.deepEqual(await service.walletBalances({ apiKey: API_KEY, apiSecret: API_SECRET }), []);
  assert.equal(timeRequests, 2);
  assert.deepEqual(signedRequests.map((request) => request.timestamp), ["1700000000000", "1700000000500"]);
  assert.notEqual(signedRequests[0].signature, signedRequests[1].signature);
  assert.equal(signedRequests[1].apiKey, API_KEY);
});

test("Binance server time is reused briefly and can still be force-resynchronized", async () => {
  let timeReads = 0;
  const service = new BinanceAccountService({
    credentialStore: { resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }) },
    fetch: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/fapi/v1/time");
      timeReads += 1;
      return jsonResponse({ serverTime: 1_700_000_000_000 + timeReads * 1_000 });
    },
  });

  const first = await service.serverTime("https://fapi.binance.com", "/fapi/v1/time");
  const cached = await service.serverTime("https://fapi.binance.com", "/fapi/v1/time");
  assert.equal(timeReads, 1);
  assert.ok(cached >= first);

  const resynchronized = await service.serverTime(
    "https://fapi.binance.com",
    "/fapi/v1/time",
    { force: true },
  );
  assert.equal(timeReads, 2);
  assert.ok(resynchronized > cached);
});

test("profit calendar groups realized PnL by local trading date and preserves zero-income days", () => {
  const firstDay = new Date(2026, 6, 1, 9, 30).getTime();
  const secondDay = new Date(2026, 6, 2, 18, 45).getTime();
  const thirdDay = new Date(2026, 6, 3, 11, 15).getTime();
  const calendar = normalizeBinanceProfitCalendar({
    month: "2026-07",
    income: [
      { income: "500.30", time: firstDay },
      { income: "-200", time: firstDay + 60_000 },
      { income: "0", time: secondDay },
      { incomeType: "COMMISSION", income: "-0.42", time: thirdDay },
      { incomeType: "FUNDING_FEE", income: "1.2", time: new Date(2026, 6, 4, 8, 0).getTime() },
      { income: "999", time: new Date(2026, 7, 1, 0, 0).getTime() },
    ],
    fetchedAt: "2026-08-14T04:00:00.000Z",
  });

  assert.equal(calendar.month, "2026-07");
  assert.deepEqual(calendar.days, [
    { date: "2026-07-01", pnl: 300.3 },
    { date: "2026-07-02", pnl: 0 },
    { date: "2026-07-03", pnl: 0 },
  ]);
  assert.equal(calendar.source, "USD_M_INCOME_REALIZED_PNL+COMMISSION_ACTIVITY");
  assert.equal(calendar.days.some((day) => day.date === "2026-07-04"), false);
});

test("profit calendar reads one Binance month with signed pagination parameters and caches closed months", async () => {
  const now = new Date(2026, 7, 14, 12, 0);
  const incomeRequests = [];
  const income = [
    { incomeType: "REALIZED_PNL", income: "500.3", time: new Date(2026, 6, 1, 10, 0).getTime() },
    { incomeType: "REALIZED_PNL", income: "-256.23", time: new Date(2026, 6, 22, 10, 0).getTime() },
  ];
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => now,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/fapi/v1/time") return jsonResponse({ serverTime: now.getTime() });
      if (parsed.pathname !== "/fapi/v1/income") throw new Error(`unexpected route ${parsed.pathname}`);
      incomeRequests.push(parsed);
      const startTime = Number(parsed.searchParams.get("startTime"));
      const endTime = Number(parsed.searchParams.get("endTime"));
      return jsonResponse(income.filter((item) => item.time >= startTime && item.time <= endTime));
    },
  });

  const first = await service.profitCalendar(OWNER, { month: "2026-07" });
  const second = await service.profitCalendar(OWNER, { month: "2026-07" });

  assert.deepEqual(second, first);
  assert.equal(incomeRequests.length, 3);
  assert.ok(incomeRequests.every((request) => request.searchParams.get("incomeType") === "REALIZED_PNL"));
  assert.ok(incomeRequests.every((request) => (
    Number(request.searchParams.get("endTime")) - Number(request.searchParams.get("startTime"))
    < 14 * 24 * 60 * 60 * 1_000
  )));
  assert.equal(incomeRequests[0].searchParams.get("startTime"), String(new Date(2026, 6, 1).getTime()));
  assert.equal(incomeRequests.at(-1).searchParams.get("endTime"), String(new Date(2026, 7, 1).getTime() - 1));
  assert.equal(incomeRequests[0].searchParams.get("page"), "1");
  assert.equal(incomeRequests[0].searchParams.get("limit"), "1000");
  assert.deepEqual(first.days, [
    { date: "2026-07-01", pnl: 500.3 },
    { date: "2026-07-22", pnl: -256.23 },
  ]);
  await assert.rejects(
    service.profitCalendar(OWNER, { month: "2026-09" }),
    (error) => error?.code === "INVALID_PROFIT_CALENDAR_MONTH",
  );
});

test("profit calendar halves only a failing range and preserves successful range data", async () => {
  const requests = [];
  const service = new BinanceAccountService({
    credentialStore: { resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }) },
  });
  service.signedGet = async ({ pathname, params }) => {
    assert.equal(pathname, "/fapi/v1/income");
    requests.push({ startTime: params.startTime, endTime: params.endTime });
    if (params.endTime - params.startTime >= 7 * 24 * 60 * 60 * 1_000) {
      throw new BinanceAccountError("BINANCE_TIMEOUT", "timeout", { retryable: true });
    }
    return [{
      incomeType: "REALIZED_PNL",
      income: "1",
      time: params.startTime,
    }];
  };

  const result = await service.monthlyProfitCalendarIncome({
    credentials: { apiKey: API_KEY, apiSecret: API_SECRET },
    serverTime: Date.now(),
    startTime: new Date(2026, 6, 1).getTime(),
    endTime: new Date(2026, 7, 1).getTime() - 1,
  });
  assert.equal(result.truncated, false);
  assert.equal(result.income.length, 5);
  assert.equal(requests.length, 7);
  assert.equal(requests.filter((request) => (
    request.endTime - request.startTime >= 7 * 24 * 60 * 60 * 1_000
  )).length, 2);
});

test("a newer profit-calendar month aborts the older month for the same account", async () => {
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const service = new BinanceAccountService({
    credentialStore: { resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }) },
    now: () => new Date(2026, 7, 14, 12, 0),
  });
  service.serverTime = async () => Date.now();
  let callCount = 0;
  service.monthlyProfitCalendarIncome = async ({ signal }) => {
    callCount += 1;
    if (callCount > 1) return { income: [], truncated: false };
    firstStarted();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };

  const july = service.profitCalendar(OWNER, { month: "2026-07", force: true });
  await started;
  const june = service.profitCalendar(OWNER, { month: "2026-06", force: true });
  await assert.rejects(july, (error) => error?.name === "AbortError");
  assert.equal((await june).month, "2026-06");
  assert.equal(callCount, 2);
});

test("account snapshot maps real Binance wallet, futures, income and position fields", () => {
  const snapshot = normalizeBinanceAccountSnapshot({
    account: {
      totalMarginBalance: "2.8427",
      totalMaintMargin: "0.0994945",
      totalWalletBalance: "2.8548",
      totalUnrealizedProfit: "-0.0121",
      totalInitialMargin: "1.43",
      availableBalance: "1.4248",
      positions: [{
        symbol: "ETHUSDT",
        positionSide: "BOTH",
        initialMargin: "1.43",
        maintMargin: "0.143",
      }],
    },
    positions: [{
      symbol: "ETHUSDT",
      positionSide: "BOTH",
      positionAmt: "-0.038",
      entryPrice: "1883.91",
      markPrice: "1884.21",
      liquidationPrice: "1951.30",
      breakEvenPrice: "1882.50",
      unRealizedProfit: "-0.0121",
      notional: "-71.60",
      isolatedMargin: "0",
      leverage: "50",
      marginType: "cross",
      updateTime: 1_660_000_000_000,
    }],
    income: [{ incomeType: "REALIZED_PNL", income: "0.25", asset: "USDT" }],
    walletBalances: [
      { activate: true, walletName: "Spot", balance: "1.09625088" },
      { activate: true, walletName: "USD-M Futures", balance: "2.8427" },
    ],
    fetchedAt: "2026-08-13T00:00:00.000Z",
  });

  assert.ok(Math.abs(snapshot.estimatedTotalAssets - 3.93895088) < 1e-10);
  assert.equal(snapshot.marginBalance, 2.8427);
  assert.equal(snapshot.realizedPnlToday, 0.25);
  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.positions[0].direction, "SHORT");
  assert.equal(snapshot.positions[0].leverage, 50);
  assert.equal(snapshot.positions[0].notionalValue, 71.6);
  assert.equal(snapshot.positions[0].margin, 1.43);
  assert.ok(Math.abs(snapshot.positions[0].marginRatio - 3.5) < 1e-12);
  assert.ok(snapshot.positions[0].roi < 0);
  assert.equal(JSON.stringify(snapshot).includes(API_KEY), false);
  assert.equal(JSON.stringify(snapshot).includes(API_SECRET), false);
});

test("cross positions share Binance account margin ratio while isolated positions use isolated margin", () => {
  const snapshot = normalizeBinanceAccountSnapshot({
    account: {
      totalMarginBalance: "3.6",
      totalMaintMargin: "0.126",
      positions: [{
        symbol: "PROMUSDT",
        positionSide: "BOTH",
        initialMargin: "0.343361",
        maintMargin: "0.1030083",
      }, {
        symbol: "ETHUSDT",
        positionSide: "BOTH",
        initialMargin: "0.1128",
        maintMargin: "0.02256",
      }, {
        symbol: "BTCUSDT",
        positionSide: "BOTH",
        initialMargin: "0.6",
        maintMargin: "0.08",
      }],
    },
    positions: [{
      symbol: "PROMUSDT",
      positionSide: "BOTH",
      positionAmt: "-2.6",
      notional: "-6.8672",
      isolatedMargin: "0",
      leverage: "20",
      marginType: "cross",
    }, {
      symbol: "ETHUSDT",
      positionSide: "BOTH",
      positionAmt: "-0.003",
      notional: "-5.64",
      isolatedMargin: "0",
      leverage: "50",
      marginType: "cross",
    }, {
      symbol: "BTCUSDT",
      positionSide: "BOTH",
      positionAmt: "0.001",
      notional: "100",
      isolatedMargin: "2",
      leverage: "20",
      marginType: "isolated",
    }],
    fetchedAt: "2026-08-14T05:22:00.000Z",
  });
  const bySymbol = new Map(snapshot.positions.map((position) => [position.symbol, position]));

  assert.ok(Math.abs(bySymbol.get("PROMUSDT").marginRatio - 3.5) < 1e-12);
  assert.ok(Math.abs(bySymbol.get("ETHUSDT").marginRatio - 3.5) < 1e-12);
  assert.equal(bySymbol.get("BTCUSDT").marginRatio, 4);
});

test("current orders normalize official regular and algo fields into read-only USDT cards", () => {
  const createdAt = Date.parse("2026-08-14T11:37:07.000Z");
  const orders = normalizeBinanceOpenOrders({
    openOrders: [{
      avgPrice: "0",
      clientOrderId: "regular-client-id",
      cumQuote: "0",
      executedQty: "0",
      orderId: 101,
      origQty: "191",
      origType: "LIMIT",
      price: "0.07000",
      reduceOnly: false,
      side: "BUY",
      positionSide: "BOTH",
      status: "NEW",
      symbol: "EDENUSDT",
      time: createdAt,
      timeInForce: "GTC",
      type: "LIMIT",
      updateTime: createdAt,
    }],
    algoOpenOrders: [{
      algoId: 202,
      clientAlgoId: "algo-client-id",
      algoType: "CONDITIONAL",
      orderType: "STOP_MARKET",
      symbol: "EDENUSDT",
      side: "SELL",
      positionSide: "BOTH",
      quantity: "243",
      algoStatus: "NEW",
      triggerPrice: "0.079",
      price: "0",
      workingType: "CONTRACT_PRICE",
      closePosition: false,
      priceProtect: true,
      reduceOnly: true,
      createTime: createdAt + 1_000,
      updateTime: createdAt + 1_000,
    }],
  });

  assert.equal(orders.length, 2);
  assert.equal(orders[0].source, "ALGO");
  assert.equal(orders[0].orderType, "STOP_MARKET");
  assert.equal(orders[0].quantityUsdt, 19.197);
  assert.equal(orders[0].triggerPrice, 0.079);
  assert.equal(orders[0].workingType, "CONTRACT_PRICE");
  assert.equal(orders[0].reduceOnly, true);
  assert.equal(orders[0].priceProtect, true);
  assert.equal(orders[1].source, "ORDER");
  assert.ok(Math.abs(orders[1].quantityUsdt - 13.37) < 1e-12);
  assert.equal(orders[1].executedQuantityUsdt, 0);
  assert.equal(orders[1].progressPercent, 0);
  assert.equal(orders[1].price, 0.07);
  assert.equal("apiKey" in orders[0], false);
  assert.equal("clientAlgoId" in orders[0], false);
});

test("position history is reconstructed from official account trades without maximum-open-interest data", () => {
  const openTime = Date.parse("2026-08-13T12:00:00.000Z");
  const partialCloseTime = Date.parse("2026-08-13T12:10:00.000Z");
  const finalCloseTime = Date.parse("2026-08-13T12:20:00.000Z");
  const history = normalizeBinancePositionHistory({
    trades: [
      { id: 1, symbol: "TUTUSDT", side: "SELL", positionSide: "BOTH", qty: "100", baseQty: "0", price: "0.05562", realizedPnl: "0", time: openTime },
      { id: 2, symbol: "TUTUSDT", side: "BUY", positionSide: "BOTH", qty: "40", baseQty: "0", price: "0.05549", realizedPnl: "0.0052", time: partialCloseTime },
      { id: 3, symbol: "TUTUSDT", side: "BUY", positionSide: "BOTH", qty: "60", baseQty: "0", price: "0.05549", realizedPnl: "0.0078", time: finalCloseTime },
    ],
    positions: [{
      symbol: "TUTUSDT",
      positionSide: "BOTH",
      positionAmt: "0",
      leverage: "10",
      marginType: "cross",
      marginAsset: "USDT",
      unRealizedProfit: "0",
    }],
    fetchedAt: "2026-08-13T12:30:00.000Z",
    historyStartTime: openTime - 1,
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].symbol, "TUTUSDT");
  assert.equal(history[0].direction, "SHORT");
  assert.equal(history[0].closeType, "FULL");
  assert.equal(history[0].marginType, "cross");
  assert.equal(history[0].leverage, 10);
  assert.equal(history[0].closedAmount, 100);
  assert.equal(history[0].baseAsset, "TUT");
  assert.equal(history[0].openTime, openTime);
  assert.equal(history[0].closeTime, finalCloseTime);
  assert.ok(Math.abs(history[0].entryPrice - 0.05562) < 1e-12);
  assert.ok(Math.abs(history[0].averageClosePrice - 0.05549) < 1e-12);
  assert.ok(Math.abs(history[0].realizedPnl - 0.013) < 1e-12);
  assert.ok(history[0].roi > 0);
  assert.equal("maximumOpenInterest" in history[0], false);
});

test("position history falls back to a positive base quantity when qty is unavailable", () => {
  const openTime = Date.parse("2026-08-13T13:00:00.000Z");
  const closeTime = Date.parse("2026-08-13T13:10:00.000Z");
  const history = normalizeBinancePositionHistory({
    trades: [
      { id: 1, symbol: "ETHUSDT", side: "BUY", positionSide: "BOTH", baseQty: "0.02", price: "1887.20", realizedPnl: "0", time: openTime },
      { id: 2, symbol: "ETHUSDT", side: "SELL", positionSide: "BOTH", baseQty: "0.02", price: "1888.20", realizedPnl: "0.02", time: closeTime },
    ],
    positions: [{
      symbol: "ETHUSDT",
      positionSide: "BOTH",
      positionAmt: "0",
      leverage: "50",
      marginType: "cross",
      marginAsset: "USDT",
      unRealizedProfit: "0",
    }],
    fetchedAt: "2026-08-13T13:15:00.000Z",
    historyStartTime: openTime - 1,
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].symbol, "ETHUSDT");
  assert.equal(history[0].direction, "LONG");
  assert.equal(history[0].closedAmount, 0.02);
  assert.equal(history[0].closeTime, closeTime);
});

test("recent position-history trades page through every Binance account-trade result", async () => {
  const startTime = Date.parse("2026-08-06T04:00:00.000Z");
  const endTime = Date.parse("2026-08-13T04:00:00.000Z");
  const tradeRequests = [];
  const service = new BinanceAccountService({
    credentialStore: {},
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/fapi/v1/time") return jsonResponse({ serverTime: endTime });
      if (parsed.pathname !== "/fapi/v1/userTrades") throw new Error(`unexpected route ${parsed.pathname}`);
      tradeRequests.push(parsed);
      const fromId = Number(parsed.searchParams.get("fromId") || 0);
      if (fromId === 0) {
        return jsonResponse(Array.from({ length: 1_000 }, (_, index) => ({
          id: index + 1,
          symbol: "ETHUSDT",
          side: index % 2 ? "BUY" : "SELL",
          positionSide: "BOTH",
          qty: "0.001",
          price: "1880",
          realizedPnl: "0",
          time: startTime + index,
        })));
      }
      assert.equal(fromId, 1_001);
      return jsonResponse([{
        id: 1_001,
        symbol: "ETHUSDT",
        side: "BUY",
        positionSide: "BOTH",
        qty: "0.001",
        price: "1881",
        realizedPnl: "0.001",
        time: startTime + 1_001,
      }]);
    },
  });

  const result = await service.recentAccountTrades({
    credentials: { apiKey: API_KEY, apiSecret: API_SECRET },
    income: [{ symbol: "ETHUSDT" }],
    startTime,
    endTime,
  });
  assert.equal(result.trades.length, 1_001);
  assert.equal(result.failedSymbols.length, 0);
  assert.equal(result.truncatedSymbols.length, 0);
  assert.equal(tradeRequests.length, 2);
  assert.equal(tradeRequests[0].searchParams.get("startTime"), String(startTime));
  assert.equal(tradeRequests[1].searchParams.get("fromId"), "1001");
});

test("service validates credentials before saving and returns sanitized real-data DTOs", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-binance-service-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = new BinanceCredentialStore({
    storagePath: path.join(root, "binance-account-credentials.json"),
    safeStorage: fakeSafeStorage(),
  });
  const requests = [];
  const service = new BinanceAccountService({
    credentialStore: store,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/time")) return jsonResponse({ serverTime: 1_660_000_000_000 });
      assert.equal(init.headers["X-MBX-APIKEY"], API_KEY);
      assert.ok(parsed.searchParams.get("signature"));
      if (parsed.pathname === "/fapi/v3/account") {
        return jsonResponse({
          totalMarginBalance: "10",
          totalWalletBalance: "9",
          totalUnrealizedProfit: "1",
          totalInitialMargin: "2",
          availableBalance: "7",
          positions: [],
        });
      }
      if (parsed.pathname === "/fapi/v2/positionRisk") {
        return jsonResponse([{
          symbol: "TUTUSDT",
          positionSide: "BOTH",
          positionAmt: "0",
          leverage: "10",
          marginType: "cross",
          marginAsset: "USDT",
          unRealizedProfit: "0",
        }]);
      }
      if (parsed.pathname === "/fapi/v1/income") {
        return jsonResponse([{
          symbol: "TUTUSDT",
          incomeType: "REALIZED_PNL",
          income: "0.013",
          asset: "USDT",
          time: Date.parse("2026-08-13T03:00:00.000Z"),
        }]);
      }
      if (parsed.pathname === "/fapi/v1/userTrades") {
        assert.equal(parsed.searchParams.get("symbol"), "TUTUSDT");
        assert.equal(parsed.searchParams.get("limit"), "1000");
        return jsonResponse([
          { id: 1, symbol: "TUTUSDT", side: "SELL", positionSide: "BOTH", qty: "100", baseQty: "0", price: "0.05562", realizedPnl: "0", time: Date.parse("2026-08-13T02:00:00.000Z") },
          { id: 2, symbol: "TUTUSDT", side: "BUY", positionSide: "BOTH", qty: "100", baseQty: "0", price: "0.05549", realizedPnl: "0.013", time: Date.parse("2026-08-13T03:00:00.000Z") },
        ]);
      }
      if (parsed.pathname === "/fapi/v1/openOrders") {
        return jsonResponse([{
          orderId: 101,
          symbol: "EDENUSDT",
          side: "BUY",
          positionSide: "BOTH",
          type: "LIMIT",
          origType: "LIMIT",
          status: "NEW",
          origQty: "191",
          executedQty: "0",
          cumQuote: "0",
          price: "0.07",
          avgPrice: "0",
          time: Date.parse("2026-08-13T03:30:00.000Z"),
          updateTime: Date.parse("2026-08-13T03:30:00.000Z"),
        }]);
      }
      if (parsed.pathname === "/fapi/v1/openAlgoOrders") {
        return jsonResponse([{
          algoId: 202,
          algoType: "CONDITIONAL",
          orderType: "STOP_MARKET",
          symbol: "EDENUSDT",
          side: "SELL",
          positionSide: "BOTH",
          quantity: "243",
          algoStatus: "NEW",
          triggerPrice: "0.079",
          price: "0",
          workingType: "CONTRACT_PRICE",
          reduceOnly: true,
          createTime: Date.parse("2026-08-13T03:40:00.000Z"),
          updateTime: Date.parse("2026-08-13T03:40:00.000Z"),
        }]);
      }
      if (parsed.pathname === "/sapi/v1/asset/wallet/balance") {
        assert.equal(parsed.searchParams.get("quoteAsset"), "USDT");
        return jsonResponse([{ activate: true, walletName: "USD-M Futures", balance: "10" }]);
      }
      throw new Error(`unexpected route ${parsed.pathname}`);
    },
    now: () => new Date("2026-08-13T04:00:00.000Z"),
  });

  const result = await service.bind(OWNER, { apiKey: API_KEY, apiSecret: API_SECRET });
  assert.equal(result.status.bound, true);
  assert.equal(result.snapshot.estimatedTotalAssets, 10);
  assert.equal(result.snapshot.positions.length, 0);
  assert.equal(result.snapshot.positionHistory.length, 1);
  assert.equal(result.snapshot.positionHistory[0].symbol, "TUTUSDT");
  assert.equal(result.snapshot.positionHistory[0].leverage, 10);
  assert.ok(Math.abs(result.snapshot.positionHistory[0].roi - 2.337289) < 1e-6);
  assert.equal(result.snapshot.openOrders.length, 2);
  assert.equal(result.snapshot.openOrders[0].source, "ALGO");
  assert.equal(JSON.stringify(result).includes(API_SECRET), false);
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v3/account"));
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v2/positionRisk"));
  assert.equal(requests.some((request) => new URL(request.url).pathname === "/fapi/v3/positionRisk"), false);
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v1/userTrades"));
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v1/openOrders"));
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v1/openAlgoOrders"));
});

test("account snapshots reuse fresh data, merge concurrent reads, and allow a forced refresh", async () => {
  let nowMs = Date.parse("2026-08-13T04:00:00.000Z");
  let reads = 0;
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(nowMs),
    snapshotCacheTtlMs: 60_000,
  });
  service.snapshotWithCredentials = async () => {
    reads += 1;
    await Promise.resolve();
    return { schemaVersion: 1, warnings: [], fetchedAt: new Date(nowMs).toISOString(), read: reads };
  };

  const [first, concurrent] = await Promise.all([
    service.snapshot(OWNER),
    service.snapshot(OWNER),
  ]);
  assert.strictEqual(first, concurrent);
  assert.equal(reads, 1);
  assert.strictEqual(await service.snapshot(OWNER), first);
  assert.equal(reads, 1);

  const forced = await service.snapshot(OWNER, { force: true });
  assert.equal(forced.read, 2);
  assert.equal(reads, 2);

  nowMs += 60_001;
  const expired = await service.snapshot(OWNER);
  assert.equal(expired.read, 3);
  assert.equal(reads, 3);
});

test("a summary refresh never waits for or gets overwritten by an older full refresh", async () => {
  let releaseFull;
  let markFullStarted;
  const fullGate = new Promise((resolve) => { releaseFull = resolve; });
  const fullStarted = new Promise((resolve) => { markFullStarted = resolve; });
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date("2026-08-13T04:00:00.000Z"),
    snapshotCacheTtlMs: 0,
  });
  service.storeSnapshotCache(OWNER, { schemaVersion: 1, warnings: [], mode: "cached" });
  service.snapshotWithCredentials = async (_credentials, options) => {
    if (options.summary) return { schemaVersion: 1, warnings: [], mode: "summary" };
    markFullStarted();
    await fullGate;
    return { schemaVersion: 1, warnings: [], mode: "full" };
  };

  const fullRequest = service.snapshot(OWNER, { force: true, live: false });
  await fullStarted;
  const summary = await service.snapshot(OWNER, { force: true, live: true, summary: true });
  assert.equal(summary.mode, "summary");
  assert.equal(service.snapshotCache.get(OWNER).snapshot.mode, "summary");

  releaseFull();
  assert.equal((await fullRequest).mode, "full");
  assert.equal(service.snapshotCache.get(OWNER).snapshot.mode, "summary");
});

test("a transient Binance failure falls back to the last successful snapshot", async () => {
  let nowMs = Date.parse("2026-08-13T04:00:00.000Z");
  let fail = false;
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(nowMs),
    snapshotCacheTtlMs: 1_000,
    snapshotStaleTtlMs: 60_000,
  });
  const successful = { schemaVersion: 1, warnings: [], fetchedAt: new Date(nowMs).toISOString() };
  service.snapshotWithCredentials = async () => {
    if (fail) throw new BinanceAccountError(
      "BINANCE_TIMEOUT",
      "连接 Binance 超时，请检查网络后重试。",
      { retryable: true },
    );
    return successful;
  };

  assert.strictEqual(await service.snapshot(OWNER), successful);
  nowMs += 2_000;
  fail = true;
  const fallback = await service.snapshot(OWNER);
  assert.equal(fallback.fetchedAt, successful.fetchedAt);
  assert.match(fallback.warnings.join("\n"), /当前展示上次成功读取的数据/);
});

test("current orders survive partial failures and require confirmation before becoming empty", async () => {
  const createdAt = Date.parse("2026-08-14T13:33:14.000Z");
  const regularOrder = {
    orderId: 301,
    symbol: "PROMUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    origType: "LIMIT",
    status: "NEW",
    origQty: "3.4",
    executedQty: "0",
    cumQuote: "0",
    price: "2.65",
    avgPrice: "0",
    time: createdAt,
    updateTime: createdAt,
  };
  let regularResponses = [[regularOrder]];
  let regularReads = 0;
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date("2026-08-14T13:34:00.000Z"),
    snapshotCacheTtlMs: 0,
  });
  service.serverTime = async () => createdAt;
  service.walletBalances = async () => [];
  service.recentAccountTrades = async () => ({
    trades: [],
    failedSymbols: [],
    truncatedSymbols: [],
  });
  service.signedGet = async ({ pathname }) => {
    if (pathname === "/fapi/v3/account") {
      return {
        totalMarginBalance: "10",
        totalMaintMargin: "0.1",
        totalWalletBalance: "10",
        totalUnrealizedProfit: "0",
        totalInitialMargin: "0",
        availableBalance: "10",
        positions: [],
      };
    }
    if (pathname === "/fapi/v2/positionRisk" || pathname === "/fapi/v1/income") return [];
    if (pathname === "/fapi/v1/openAlgoOrders") return [];
    if (pathname === "/fapi/v1/openOrders") {
      regularReads += 1;
      const response = regularResponses.shift();
      if (response instanceof Error) throw response;
      if (response === undefined) throw new Error("missing regular-order test response");
      return response;
    }
    throw new Error(`unexpected route ${pathname}`);
  };

  const first = await service.snapshot(OWNER, { force: true });
  assert.deepEqual(first.openOrders.map((order) => order.id), ["order:301"]);

  regularResponses = [new Error("temporary openOrders failure")];
  const afterFailure = await service.snapshot(OWNER, { force: true });
  assert.deepEqual(afterFailure.openOrders.map((order) => order.id), ["order:301"]);
  assert.match(afterFailure.warnings.join("\n"), /部分当前委托暂时无法读取/);

  regularResponses = [[], [regularOrder]];
  const readsBeforeTransientEmpty = regularReads;
  const afterTransientEmpty = await service.snapshot(OWNER, { force: true });
  assert.equal(regularReads - readsBeforeTransientEmpty, 2);
  assert.deepEqual(afterTransientEmpty.openOrders.map((order) => order.id), ["order:301"]);

  regularResponses = [[], []];
  const readsBeforeConfirmedEmpty = regularReads;
  const afterConfirmedEmpty = await service.snapshot(OWNER, { force: true });
  assert.equal(regularReads - readsBeforeConfirmedEmpty, 2);
  assert.deepEqual(afterConfirmedEmpty.openOrders, []);
});

test("live account refresh uses low-weight per-symbol order reads and reuses slow-changing data", async () => {
  const fetchedAt = Date.parse("2026-08-14T13:40:00.000Z");
  const regularOrder = {
    orderId: 401,
    symbol: "PROMUSDT",
    side: "BUY",
    positionSide: "BOTH",
    type: "LIMIT",
    origType: "LIMIT",
    status: "NEW",
    origQty: "3.4",
    executedQty: "0",
    cumQuote: "0",
    price: "2.65",
    avgPrice: "0",
    time: fetchedAt,
    updateTime: fetchedAt,
  };
  const previousSnapshot = {
    schemaVersion: 1,
    currency: "USDT",
    estimatedTotalAssets: 20,
    todayPnl: 3,
    todayPnlPercent: 17.647,
    marginBalance: 10,
    walletBalance: 9,
    unrealizedPnl: 1,
    realizedPnlToday: 2,
    initialMargin: 1,
    availableBalance: 9,
    positions: [],
    positionHistory: [{ id: "preserved-history" }],
    openOrders: normalizeBinanceOpenOrders({ openOrders: [regularOrder] }),
    walletBreakdown: [{ walletName: "Spot", balance: 10 }],
    sources: {
      totalAssets: "BINANCE_WALLETS_USDT",
      futures: "USD_M_FUTURES",
      realizedPnl: "USD_M_INCOME",
      positionHistory: "USD_M_ACCOUNT_TRADES",
      openOrders: "USD_M_OPEN_ORDERS+USD_M_OPEN_ALGO_ORDERS",
    },
    warnings: [],
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
  const orderReads = [];
  let walletReads = 0;
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(fetchedAt + 5_000),
    snapshotCacheTtlMs: 0,
  });
  service.storeSnapshotCache(OWNER, previousSnapshot);
  service.serverTime = async () => fetchedAt + 5_000;
  service.walletBalances = async () => {
    walletReads += 1;
    return [];
  };
  service.recentAccountTrades = async () => {
    throw new Error("live refresh must not read account-trade history");
  };
  service.signedGet = async ({ pathname, params }) => {
    if (pathname === "/fapi/v3/account") {
      return {
        totalMarginBalance: "11",
        totalMaintMargin: "0.11",
        totalWalletBalance: "9",
        totalUnrealizedProfit: "2",
        totalInitialMargin: "1",
        availableBalance: "10",
        positions: [{ symbol: "ETHUSDT", positionSide: "BOTH" }],
      };
    }
    if (pathname === "/fapi/v3/positionRisk") {
      return [
        {
          symbol: "ETHUSDT",
          positionSide: "BOTH",
          positionAmt: "-0.001",
          notional: "-1.9",
          leverage: "50",
          marginType: "cross",
          unRealizedProfit: "2",
        },
        {
          symbol: "ZEROUSDT",
          positionSide: "BOTH",
          positionAmt: "0",
          notional: "0",
          leverage: "20",
          marginType: "cross",
          unRealizedProfit: "0",
        },
      ];
    }
    if (pathname === "/fapi/v1/income") {
      throw new Error("live refresh must not read income history");
    }
    if (pathname === "/fapi/v1/openOrders" || pathname === "/fapi/v1/openAlgoOrders") {
      orderReads.push({ pathname, symbol: params?.symbol ?? null });
      if (pathname === "/fapi/v1/openOrders" && params?.symbol === "PROMUSDT") {
        return [regularOrder];
      }
      return [];
    }
    throw new Error(`unexpected route ${pathname}`);
  };

  const snapshot = await service.snapshot(OWNER, { force: true, live: true });
  assert.equal(walletReads, 0);
  assert.deepEqual(
    [...new Set(orderReads.map((request) => request.symbol))],
    ["ETHUSDT", "PROMUSDT"],
  );
  assert.ok(orderReads.every((request) => request.symbol));
  assert.ok(orderReads.every((request) => request.symbol !== "ZEROUSDT"));
  assert.equal(snapshot.estimatedTotalAssets, 21);
  assert.equal(snapshot.realizedPnlToday, 2);
  assert.equal(snapshot.todayPnl, 4);
  assert.deepEqual(snapshot.positionHistory, previousSnapshot.positionHistory);
  assert.deepEqual(snapshot.walletBreakdown, previousSnapshot.walletBreakdown);
  assert.deepEqual(snapshot.openOrders.map((order) => order.id), ["order:401"]);
});

test("a first live refresh stays lightweight without a cached full snapshot", async () => {
  const fetchedAt = Date.parse("2026-08-14T13:45:00.000Z");
  const paths = [];
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(fetchedAt),
    snapshotCacheTtlMs: 0,
  });
  service.serverTime = async () => fetchedAt;
  service.walletBalances = async () => {
    throw new Error("first live refresh must not read wallet history");
  };
  service.recentAccountTrades = async () => {
    throw new Error("first live refresh must not read account-trade history");
  };
  service.signedGet = async ({ pathname }) => {
    paths.push(pathname);
    if (pathname === "/fapi/v3/account") {
      return {
        totalMarginBalance: "11",
        totalMaintMargin: "0.11",
        totalWalletBalance: "9",
        totalUnrealizedProfit: "2",
        totalInitialMargin: "1",
        availableBalance: "10",
        positions: [{ symbol: "ETHUSDT", positionSide: "BOTH" }],
      };
    }
    if (pathname === "/fapi/v3/positionRisk") {
      return [{
        symbol: "ETHUSDT",
        positionSide: "BOTH",
        positionAmt: "-0.001",
        notional: "-1.9",
        leverage: "50",
        marginType: "cross",
        unRealizedProfit: "2",
      }];
    }
    if (pathname === "/fapi/v1/openOrders" || pathname === "/fapi/v1/openAlgoOrders") return [];
    throw new Error(`unexpected route ${pathname}`);
  };

  const snapshot = await service.snapshot(OWNER, { force: true, live: true });
  assert.ok(paths.includes("/fapi/v3/account"));
  assert.ok(paths.includes("/fapi/v3/positionRisk"));
  assert.ok(paths.includes("/fapi/v1/openOrders"));
  assert.ok(paths.includes("/fapi/v1/openAlgoOrders"));
  assert.equal(paths.includes("/fapi/v1/income"), false);
  assert.equal(snapshot.availableBalance, 10);
  assert.equal(snapshot.positions.length, 1);
});

test("summary account refresh uses one signed account read and preserves detailed data", async () => {
  const fetchedAt = Date.parse("2026-08-14T13:50:00.000Z");
  const previousSnapshot = {
    schemaVersion: 1,
    currency: "USDT",
    estimatedTotalAssets: 20,
    todayPnl: 3,
    todayPnlPercent: 17.647,
    marginBalance: 10,
    walletBalance: 9,
    unrealizedPnl: 1,
    realizedPnlToday: 2,
    initialMargin: 1,
    availableBalance: 9,
    positions: [{ symbol: "ETHUSDT", direction: "LONG" }],
    positionHistory: [{ id: "preserved-history" }],
    openOrders: [{ id: "preserved-order", source: "ORDER" }],
    walletBreakdown: [{ walletName: "Spot", balance: 10 }],
    sources: {
      totalAssets: "BINANCE_WALLETS_USDT",
      futures: "USD_M_FUTURES",
      realizedPnl: "USD_M_INCOME",
      positionHistory: "USD_M_ACCOUNT_TRADES",
      openOrders: "USD_M_OPEN_ORDERS+USD_M_OPEN_ALGO_ORDERS",
    },
    warnings: ["preserved-warning"],
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
  const signedPaths = [];
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(fetchedAt + 5_000),
    snapshotCacheTtlMs: 0,
  });
  service.storeSnapshotCache(OWNER, previousSnapshot);
  service.serverTime = async () => fetchedAt + 5_000;
  service.signedGet = async ({ pathname }) => {
    signedPaths.push(pathname);
    assert.equal(pathname, "/fapi/v3/account");
    return {
      totalMarginBalance: "12",
      totalMaintMargin: "0.12",
      totalWalletBalance: "10",
      totalUnrealizedProfit: "3",
      totalInitialMargin: "1.5",
      availableBalance: "10.5",
      positions: [],
    };
  };

  const snapshot = await service.snapshot(OWNER, {
    force: true,
    live: true,
    summary: true,
  });
  assert.deepEqual(signedPaths, ["/fapi/v3/account"]);
  assert.equal(snapshot.estimatedTotalAssets, 22);
  assert.equal(snapshot.marginBalance, 12);
  assert.equal(snapshot.availableBalance, 10.5);
  assert.equal(snapshot.todayPnl, 5);
  assert.deepEqual(snapshot.positions, previousSnapshot.positions);
  assert.deepEqual(snapshot.positionHistory, previousSnapshot.positionHistory);
  assert.deepEqual(snapshot.openOrders, previousSnapshot.openOrders);
  assert.deepEqual(snapshot.walletBreakdown, previousSnapshot.walletBreakdown);
  assert.deepEqual(snapshot.warnings, previousSnapshot.warnings);
  assert.equal(snapshot.sources.openOrders, previousSnapshot.sources.openOrders);
});

test("Binance Retry-After starts a local cooldown instead of repeating rate-limited requests", async () => {
  let nowMs = Date.parse("2026-08-14T13:45:00.000Z");
  let requests = 0;
  const service = new BinanceAccountService({
    credentialStore: {
      resolve: async () => ({ apiKey: API_KEY, apiSecret: API_SECRET }),
    },
    now: () => new Date(nowMs),
    fetch: async () => {
      requests += 1;
      return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "2" },
      });
    },
  });

  await assert.rejects(
    service.snapshot(OWNER, { force: true }),
    (error) => error?.code === "BINANCE_RATE_LIMITED" && error?.retryAfterMs === 2_000,
  );
  assert.equal(requests, 1);
  await assert.rejects(
    service.snapshot(OWNER, { force: true }),
    (error) => error?.code === "BINANCE_RATE_LIMITED" && error?.retryAfterMs === 2_000,
  );
  assert.equal(requests, 1);

  nowMs += 2_001;
  await assert.rejects(service.snapshot(OWNER, { force: true }), /自动降频/);
  assert.equal(requests, 2);
});

test("binding fails atomically when required Binance account data cannot be read", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-binance-atomic-bind-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "binance-account-credentials.json");
  const store = new BinanceCredentialStore({ storagePath, safeStorage: fakeSafeStorage() });
  const service = new BinanceAccountService({
    credentialStore: store,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/time")) return jsonResponse({ serverTime: 1_660_000_000_000 });
      if (parsed.pathname.startsWith("/fapi/")) return jsonResponse({ code: -2015, msg: "Invalid API-key" }, 401);
      if (parsed.pathname === "/sapi/v1/asset/wallet/balance") return jsonResponse({ code: -2015, msg: "Invalid API-key" }, 401);
      throw new Error(`unexpected route ${parsed.pathname}`);
    },
  });

  let authorized = false;
  await assert.rejects(
    service.bind(OWNER, { apiKey: API_KEY, apiSecret: API_SECRET }, {
      beforeSave: async () => { authorized = true; },
    }),
    (error) => error?.code === "BINANCE_AUTH_FAILED",
  );
  assert.equal(authorized, false);
  assert.equal((await store.status(OWNER)).bound, false);
  assert.equal(fs.existsSync(storagePath), false);
});

test("Binance vault is excluded from export and preserved across import", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "haolo-binance-export-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const userDataPath = path.join(root, "user-data");
  const destinationRoot = path.join(root, "snapshot");
  const vaultPath = path.join(userDataPath, "binance-account-credentials.json");
  await fs.promises.mkdir(userDataPath, { recursive: true });
  await fs.promises.writeFile(vaultPath, "local-encrypted-vault", "utf8");
  await fs.promises.writeFile(path.join(userDataPath, "haolo-session.json"), "{}", "utf8");

  await createUserDataSnapshot({ userDataPath, destinationRoot, externalWorkspaces: [] });
  assert.equal(
    fs.existsSync(path.join(destinationRoot, "data", "userData", "binance-account-credentials.json")),
    false,
  );
  await fs.promises.mkdir(path.join(destinationRoot, "data", "userData"), { recursive: true });
  await fs.promises.writeFile(
    path.join(destinationRoot, "data", "userData", "binance-account-credentials.json"),
    "malicious-imported-vault",
    "utf8",
  );
  await restoreUserDataSnapshot({ snapshotRoot: destinationRoot, userDataPath, externalWorkspaces: [] });
  assert.equal(await fs.promises.readFile(vaultPath, "utf8"), "local-encrypted-vault");
});

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8");
    },
    decryptString(value) {
      return Buffer.from(String(value).replace(/^encrypted:/, ""), "base64").toString("utf8");
    },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
