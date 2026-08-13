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
  normalizeBinancePositionHistory,
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

test("account snapshot maps real Binance wallet, futures, income and position fields", () => {
  const snapshot = normalizeBinanceAccountSnapshot({
    account: {
      totalMarginBalance: "2.8427",
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
  assert.equal(snapshot.positions[0].marginRatio, 10);
  assert.ok(snapshot.positions[0].roi < 0);
  assert.equal(JSON.stringify(snapshot).includes(API_KEY), false);
  assert.equal(JSON.stringify(snapshot).includes(API_SECRET), false);
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
  assert.equal(JSON.stringify(result).includes(API_SECRET), false);
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v3/account"));
  assert.ok(requests.some((request) => new URL(request.url).pathname === "/fapi/v1/userTrades"));
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
