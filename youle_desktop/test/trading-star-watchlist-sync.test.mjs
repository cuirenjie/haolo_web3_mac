import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { TradingWatchlistStore } from "../src/renderer/trading-watchlist.ts";
import { TradingIndexFavorites } from "../src/renderer/trading-index-favorites.ts";
import { tradingMarketAvailable } from "../src/shared/trading-market-availability.mjs";

const source = await readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const workspaceClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "TradingExpertMarketWorkspace");
const methodNames = [
  "queueFavoriteServer", "syncFavoriteServer", "syncWatchlistMembership", "syncWatchlistOrder",
  "flushFavoriteServerMemberships", "syncFavoriteServerMembership", "syncFavoriteServerOrder",
  "isMarketFavorite", "toggleFavoriteMarket", "removeFavoriteMarket", "addFavoriteMarket",
  "commitFavoriteMarketChanges", "favoriteTickerMarkets",
];
const methods = methodNames.map(name => {
  const node = workspaceClass.members.find(member => member.name?.getText(ast) === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join("\n");
const helpers = ["tradingFavoriteRecord", "tradingFavoriteApiPayload", "tradingFavoriteRecordFromApi", "marketFromFavoriteRecord"]
  .map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join("\n");
const compiled = ts.transpileModule(`${helpers}\nclass Workspace { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const normalize = records => Array.isArray(records)
  ? [...new Map(records.filter(r => r?.id && r?.symbol).map(r => [r.id, r])).values()] : [];
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const market = (symbol, type = "perpetual") => ({
  id: `BINANCE:${type === "spot" ? "SPOT" : "FUTURES"}:${symbol}USDT`,
  provider: "binance", symbol: `${symbol}USDT`, baseAsset: symbol, quoteAsset: "USDT",
  displaySymbol: `${symbol}/USDT`, description: symbol, venue: "币安",
  assetClass: "crypto", marketType: type, tag: type === "spot" ? "现货" : "永续",
  markPrice: 10, changePercent: 1, volume24h: 100, quoteAvailable: true,
});
function server() {
  const records = new Map();
  const calls = [];
  let version = 1;
  return {
    records, calls,
    async listTradingFavorites() { return { initialized: true, version, items: [...records.values()] }; },
    async addTradingFavorite(record) { calls.push(["add", record.id]); records.set(record.id, record); return { version: ++version }; },
    async removeTradingFavorite({ marketId }) { calls.push(["remove", marketId]); records.delete(marketId); return { version: ++version }; },
    async reorderTradingFavorites({ marketIds }) {
      calls.push(["order", marketIds]);
      const ordered = new Map([...marketIds.filter(id => records.has(id)).map(id => [id, records.get(id)]), ...records]);
      records.clear();
      for (const [id, record] of ordered) records.set(id, record);
      return { version: ++version };
    },
  };
}
function harness({ api = server(), storage = memoryStorage(), account = "account-a" } = {}) {
  const warnings = [];
  const Workspace = new Function("window", "normalizeTradingFavoriteMarketRecords", "console",
    "tradingMarketAvailable", "MAX_TRADING_FAVORITE_TICKERS",
    `${compiled}\nreturn Workspace;`)({ codexDesktop: api }, normalize, { warn: (...args) => warnings.push(args) },
      tradingMarketAvailable, 20);
  const workspace = new Workspace();
  Object.assign(workspace, {
    favoriteStorageAccountIdentity: account,
    watchlist: new TradingWatchlistStore(storage, account, normalize),
    indexFavorites: new TradingIndexFavorites(storage, account),
    markets: [], finnhubFavoriteMarkets: new Map(), favoriteTickerMarketsById: new Map(),
    favoriteSymbols: new Set(), favoriteMarketRecords: new Map(),
    favoriteServerQueue: Promise.resolve(), favoriteServerLastSyncAt: 0, favoriteServerVersion: null, favoriteServerReady: true,
    watchlistPanel: { refresh() { workspace.rows = workspace.watchlist.activeGroup.markets.map(r => r.id); } },
    saveFavoriteSymbols() {}, renderMarkets() {},
    renderFavoriteTickerBar() {
      workspace.tickers = workspace.indexFavorites.sort([
        ...workspace.favoriteTickerMarkets(), ...workspace.indexFavorites.values(),
      ]).map(record => record.id);
    },
    syncWatchlistChanges() {}, syncWatchlistPicker() {},
  });
  return { workspace, api, storage, warnings };
}
const sharedIds = workspace => workspace.watchlist.groups[0].markets.map(r => r.id);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("new favorites lead the ticker bar and survive saved mixed ordering, refresh and re-add", async () => {
  const { workspace: w, storage } = harness();
  const btc = market("BTC"), eth = market("ETH"), sol = market("SOL");
  w.toggleFavoriteMarket(btc);
  w.toggleFavoriteMarket(eth);
  assert.deepEqual(w.tickers, [eth.id, btc.id]);

  const index = { id: "index:gold", name: "Gold", code: "XAUUSD" };
  w.indexFavorites.add(index);
  w.indexFavorites.reorder([btc.id, index.id, eth.id]);
  w.toggleFavoriteMarket(sol);
  const expected = [sol.id, btc.id, index.id, eth.id];
  assert.deepEqual(w.tickers, expected, "new addition precedes the saved drag order");
  assert.equal(w.addFavoriteMarket(eth), false);
  w.commitFavoriteMarketChanges();
  assert.deepEqual(w.tickers, expected, "selecting an existing favorite keeps its position");
  await w.favoriteServerQueue;
  await w.syncFavoriteServer(true);
  assert.deepEqual(w.tickers, expected, "server refresh retains the title-bar order");

  w.indexFavorites = new TradingIndexFavorites(storage, "account-a");
  w.renderFavoriteTickerBar();
  assert.deepEqual(w.tickers, expected, "mixed ticker order persists");
  w.toggleFavoriteMarket(btc);
  w.toggleFavoriteMarket(btc);
  assert.deepEqual(w.tickers, [btc.id, sol.id, index.id, eth.id]);
  await w.favoriteServerQueue;
});

test("a new favorite is visible at the front when the ticker bar reaches its limit", async () => {
  const { workspace: w } = harness();
  for (let i = 0; i < 20; i++) {
    const pair = market(`PAIR${i}`);
    w.favoriteSymbols.add(pair.id);
    w.favoriteMarketRecords.set(pair.id, pair);
  }
  const latest = market("SOL", "spot");
  w.toggleFavoriteMarket(latest);
  assert.equal(w.tickers.length, 20);
  assert.equal(w.tickers[0], latest.id);
  assert.equal(w.tickers[1], market("PAIR0").id);
  await w.favoriteServerQueue;
});

test("new stars lead the right watchlist immediately and retain existing manual order through cloud sync and restart", async () => {
  const { workspace: w, api, storage } = harness();
  const btc = market("BTC"), eth = market("ETH"), sol = market("SOL");
  w.toggleFavoriteMarket(btc);
  w.toggleFavoriteMarket(eth);
  await w.favoriteServerQueue;
  w.watchlist.reorder([btc.id, eth.id]);
  w.syncWatchlistOrder(w.watchlist.groups[0].markets);
  w.toggleFavoriteMarket(sol);
  const expected = [sol.id, btc.id, eth.id];
  assert.deepEqual(w.rows, expected);
  assert.equal(w.addFavoriteMarket(btc), false);
  assert.deepEqual(sharedIds(w), expected, "existing members keep their position");
  await w.favoriteServerQueue;
  assert.deepEqual([...api.records.keys()], ["binance:usdm:SOLUSDT", "binance:usdm:BTCUSDT", "binance:usdm:ETHUSDT"]);
  await w.syncFavoriteServer(true);
  assert.deepEqual(w.rows, expected);
  const restored = harness({ storage, api }).workspace;
  assert.deepEqual(sharedIds(restored), expected);
  await restored.syncFavoriteServer(true);
  assert.deepEqual(restored.rows, expected);
  w.toggleFavoriteMarket(btc);
  w.toggleFavoriteMarket(btc);
  assert.deepEqual(w.rows, [btc.id, sol.id, eth.id]);
  await w.favoriteServerQueue;
});

test("an added favorite keeps its pending order across restart when the order upload fails", async () => {
  const { workspace: w, api, storage } = harness();
  w.toggleFavoriteMarket(market("BTC"));
  await w.favoriteServerQueue;
  const originalOrder = api.reorderTradingFavorites;
  api.reorderTradingFavorites = async () => { throw Error("order offline"); };
  w.toggleFavoriteMarket(market("SOL"));
  await w.favoriteServerQueue;
  const expected = [market("SOL").id, market("BTC").id];
  assert.deepEqual(sharedIds(w), expected);
  assert.equal(w.watchlist.pendingMemberships.size, 1);
  const restored = harness({ storage, api }).workspace;
  assert.deepEqual(sharedIds(restored), expected);
  api.reorderTradingFavorites = originalOrder;
  await restored.syncFavoriteServer(true);
  assert.deepEqual(restored.rows, expected);
  assert.equal(restored.watchlist.pendingMemberships.size, 0);
});

test("starring updates both surfaces immediately, deduplicates and unstars both spot and perpetual identities", async () => {
  const { workspace: w, api } = harness();
  for (const pair of [market("SOL"), market("SOL", "spot"), market("龙虾")]) {
    w.toggleFavoriteMarket(pair);
    assert.ok(w.rows.includes(pair.id), "right-side row is visible before server completion");
    assert.ok(w.tickers.includes(pair.id));
    assert.equal(w.addFavoriteMarket(pair), false);
  }
  await w.favoriteServerQueue;
  assert.equal(sharedIds(w).length, 3);
  assert.equal(api.records.size, 3);
  w.toggleFavoriteMarket(market("SOL"));
  assert.ok(!w.rows.includes(market("SOL").id));
  assert.ok(w.rows.includes(market("SOL", "spot").id));
  await w.favoriteServerQueue;
  assert.equal(api.records.size, 2);
});

test("stars target the default group while custom groups and fixed catalogues remain selected and unchanged", async () => {
  for (const group of ["custom", "tradfi", "indices"]) {
    const { workspace: w, api } = harness();
    if (group === "custom") w.watchlist.addGroup("观察组");
    else w.watchlist.selectGroup(group);
    const selected = w.watchlist.activeGroupId;
    w.toggleFavoriteMarket(market("ETH"));
    assert.deepEqual(sharedIds(w), [market("ETH").id]);
    assert.equal(w.watchlist.activeGroupId, selected);
    assert.equal(w.watchlist.activeGroup.markets.length, 0);
    await w.favoriteServerQueue;
    assert.equal(api.records.size, 1);
    const callsBefore = api.calls.length;
    w.syncWatchlistMembership(market("ETH"), false);
    w.syncWatchlistMembership(market("BTC"), true);
    w.syncWatchlistOrder([market("BTC")]);
    await w.favoriteServerQueue;
    assert.equal(api.calls.length, callsBefore, "custom/catalogue changes never write shared favorites");
    assert.ok(w.favoriteSymbols.has(market("ETH").id));
  }
});

test("removing a starred row from the default watchlist also clears the star and ticker", async () => {
  const { workspace: w, api } = harness();
  w.toggleFavoriteMarket(market("ETH"));
  await w.favoriteServerQueue;
  w.watchlist.setMembership(market("ETH"), false);
  w.syncWatchlistMembership(market("ETH"), false);
  assert.deepEqual(w.rows, []);
  assert.deepEqual(w.tickers, []);
  await w.favoriteServerQueue;
  assert.equal(api.records.size, 0);
});

test("selecting an already starred pair repairs a missing right-side membership", async () => {
  const { workspace: w } = harness();
  const pair = market("BTC");
  w.favoriteSymbols.add(pair.id);
  w.favoriteMarketRecords.set(pair.id, pair);
  assert.equal(w.addFavoriteMarket(pair), true);
  w.commitFavoriteMarketChanges();
  assert.deepEqual(w.rows, [pair.id]);
  await w.favoriteServerQueue;
});

test("a pending server snapshot cannot erase a new star or restore a removed one", async () => {
  for (const remove of [false, true]) {
    const { workspace: w, api } = harness();
    if (remove) { w.toggleFavoriteMarket(market("ETH")); await w.favoriteServerQueue; }
    const oldSnapshot = await api.listTradingFavorites();
    const started = deferred(), reply = deferred();
    const originalList = api.listTradingFavorites;
    api.listTradingFavorites = async () => {
      api.listTradingFavorites = originalList;
      started.resolve();
      return reply.promise;
    };
    const sync = w.syncFavoriteServer(true);
    await started.promise;
    w.toggleFavoriteMarket(market("ETH"));
    assert.deepEqual(sharedIds(w), remove ? [] : [market("ETH").id]);
    reply.resolve(oldSnapshot);
    await sync;
    await w.favoriteServerQueue;
    assert.deepEqual(w.rows, remove ? [] : [market("ETH").id]);
    assert.equal(api.records.size, remove ? 0 : 1);
  }
});

test("a click during the final server read remains visible until its queued write completes", async () => {
  const { workspace: w, api } = harness();
  w.watchlist.setSharedMembership(market("BTC"), true);
  const originalList = api.listTradingFavorites;
  const started = deferred(), reply = deferred();
  let reads = 0;
  api.listTradingFavorites = async () => {
    const response = await originalList();
    if (++reads === 2) { started.resolve(); await reply.promise; }
    return response;
  };
  const sync = w.syncFavoriteServer(true);
  await started.promise;
  w.toggleFavoriteMarket(market("SOL"));
  reply.resolve();
  await sync;
  assert.deepEqual(w.rows, [market("SOL").id, market("BTC").id]);
  await w.favoriteServerQueue;
  assert.equal(api.records.size, 2);
});

test("failed writes survive restart, retry on sync, and stay isolated to their account", async () => {
  const { workspace: w, api, storage, warnings } = harness();
  const originalAdd = api.addTradingFavorite;
  api.addTradingFavorite = async () => { throw Error("offline"); };
  w.toggleFavoriteMarket(market("SOL"));
  await w.favoriteServerQueue;
  assert.equal(warnings.length, 1);
  assert.equal(w.watchlist.pendingMemberships.size, 1);
  const restored = harness({ api, storage }).workspace;
  assert.deepEqual(sharedIds(restored), [market("SOL").id]);
  assert.equal(restored.watchlist.pendingMemberships.size, 1);
  assert.deepEqual(sharedIds(harness({ storage, account: "account-b" }).workspace), []);
  api.addTradingFavorite = originalAdd;
  await restored.syncFavoriteServer(true);
  assert.equal(api.records.size, 1);
  assert.equal(restored.watchlist.pendingMemberships.size, 0);
  assert.deepEqual(sharedIds(restored), [market("SOL").id]);
  assert.equal(harness({ storage }).workspace.watchlist.pendingMemberships.size, 0);
});

test("older acknowledgements never clear a rapid subsequent unstar, including across restart", async () => {
  const { workspace: w, api, storage } = harness();
  const originalAdd = api.addTradingFavorite;
  const started = deferred(), reply = deferred();
  api.addTradingFavorite = async record => { started.resolve(); await reply.promise; return originalAdd(record); };
  w.toggleFavoriteMarket(market("ETH"));
  await started.promise;
  w.toggleFavoriteMarket(market("ETH"));
  assert.equal(harness({ storage }).workspace.watchlist.pendingMemberships.get(market("ETH").id).added, false);
  reply.resolve();
  await w.favoriteServerQueue;
  assert.deepEqual(sharedIds(w), []);
  assert.equal(api.records.size, 0);
  assert.equal(w.watchlist.pendingMemberships.size, 0);
});

test("existing saved stars migrate once, append without losing order, and sync to an initialized server", async () => {
  const { workspace: w, api, storage } = harness();
  w.watchlist.addMarkets([market("BTC")]);
  w.watchlist.addGroup("观察组");
  w.watchlist.addMarkets([market("XAU")]);
  w.watchlist.migrateStarFavorites([market("SOL"), market("SOL"), market("ETH")]);
  assert.deepEqual(sharedIds(w), [market("BTC").id, market("SOL").id, market("ETH").id]);
  assert.deepEqual(w.watchlist.activeGroup.markets.map(r => r.id), [market("XAU").id]);
  await api.addTradingFavorite({ ...market("BTC"), id: "binance:usdm:BTCUSDT" });
  await w.syncFavoriteServer(true);
  assert.equal(api.records.size, 3);
  w.watchlist.setSharedMembership(market("SOL"), false);
  await w.syncFavoriteServerMembership();
  const restored = harness({ storage }).workspace.watchlist;
  restored.migrateStarFavorites([market("SOL"), market("ETH")]);
  assert.deepEqual(restored.groups[0].markets.map(r => r.id), [market("BTC").id, market("ETH").id]);
});

test("remote removal clears its linked star without deleting custom-group membership", async () => {
  const { workspace: w, api } = harness();
  w.toggleFavoriteMarket(market("ETH"));
  await w.favoriteServerQueue;
  w.watchlist.addGroup("观察组");
  w.watchlist.addMarkets([market("ETH")]);
  api.records.clear();
  await w.syncFavoriteServer(true);
  assert.deepEqual(sharedIds(w), []);
  assert.deepEqual(w.tickers, []);
  assert.equal(w.watchlist.activeGroup.markets.length, 1);
});

test("a first star initializes the server from the whole existing default list after an earlier read failure", async () => {
  const { workspace: w, api } = harness();
  w.favoriteServerReady = false;
  w.watchlist.addMarkets([market("BTC"), market("ETH")]);
  const originalList = api.listTradingFavorites;
  api.listTradingFavorites = async () => { throw Error("temporarily offline"); };
  await w.syncFavoriteServer(true);
  api.listTradingFavorites = async () => ({ ...await originalList(), initialized: api.records.size > 0 });
  w.toggleFavoriteMarket(market("SOL"));
  await w.favoriteServerQueue;
  assert.deepEqual(sharedIds(w), [market("SOL").id, market("BTC").id, market("ETH").id]);
  assert.equal(api.records.size, 3);
  assert.equal(w.watchlist.pendingMemberships.size, 0);
});

test("failed removal survives restart and cannot be resurrected by a cloud snapshot", async () => {
  const { workspace: w, api, storage } = harness();
  w.toggleFavoriteMarket(market("SOL"));
  await w.favoriteServerQueue;
  const originalRemove = api.removeTradingFavorite;
  api.removeTradingFavorite = async () => { throw Error("offline"); };
  w.toggleFavoriteMarket(market("SOL"));
  await w.favoriteServerQueue;
  const restored = harness({ storage, api }).workspace;
  assert.deepEqual(sharedIds(restored), []);
  assert.equal(restored.watchlist.pendingMemberships.get(market("SOL").id).added, false);
  await restored.syncFavoriteServer(true);
  assert.deepEqual(sharedIds(restored), []);
  api.removeTradingFavorite = originalRemove;
  await restored.syncFavoriteServer(true);
  assert.equal(api.records.size, 0);
  assert.equal(restored.watchlist.pendingMemberships.size, 0);
});
