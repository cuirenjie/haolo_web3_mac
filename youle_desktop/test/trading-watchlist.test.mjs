import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  TradingWatchlistStore,
  WATCHLIST_RECOMMENDED_MARKETS,
  tradingWatchlistStorageKey,
  watchlistGroupNameError,
} from "../src/renderer/trading-watchlist.ts";

const record = (symbol, marketType = "perpetual") => ({
  id: `BINANCE:${marketType === "spot" ? "SPOT" : "FUTURES"}:${symbol}USDT`,
  provider: "binance",
  symbol: `${symbol}USDT`,
  baseAsset: symbol,
  quoteAsset: "USDT",
  displaySymbol: `${symbol}/USDT`,
  description: symbol,
  venue: "币安",
  assetClass: "crypto",
  marketType,
  tag: marketType === "spot" ? "现货" : "永续",
});
const normalize = (records) =>
  Array.isArray(records)
    ? [
        ...new Map(
          records.filter((r) => r?.id && r?.symbol).map((r) => [r.id, r]),
        ).values(),
      ]
    : [];
const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test("watchlists start expanded and empty without reading or writing independent star favorites", () => {
  const storage = memoryStorage();
  storage.setItem(
    "haolo.trading-market.favorites.v1",
    '["BINANCE:FUTURES:BTCUSDT"]',
  );
  const store = new TradingWatchlistStore(storage, "", normalize);
  assert.deepEqual(
    store.groups.map((g) => [g.name, g.markets.length]),
    [
      ["自选", 0],
      ["传统金融", 0],
      ["指数", 0],
    ],
  );
  assert.equal(store.expanded, true);
  store.setMembership(record("ETH"), true);
  assert.equal(
    storage.getItem("haolo.trading-market.favorites.v1"),
    '["BINANCE:FUTURES:BTCUSDT"]',
  );
  assert.equal(store.groups[1].markets.length, 0);
});

test("saved visibility is respected while missing or invalid visibility defaults to expanded", () => {
  const storage = memoryStorage();
  const key = tradingWatchlistStorageKey("visibility");
  for (const expanded of [undefined, null, "false", true, false]) {
    storage.setItem(key, JSON.stringify({
      version: 1,
      groups: [{ id: "watchlist", name: "自选", markets: [record("BTC")] }],
      expanded,
    }));
    const restored = new TradingWatchlistStore(storage, "visibility", normalize);
    assert.equal(restored.expanded, expanded !== false);
    assert.equal(restored.has(record("BTC").id), true);
  }
  const store = new TradingWatchlistStore(storage, "visibility", normalize);
  for (const expanded of [true, false]) {
    store.expanded = expanded;
    store.save();
    assert.equal(new TradingWatchlistStore(storage, "visibility", normalize).expanded, expanded);
  }
});

test("membership is independent across default and custom lists and market identities", () => {
  const store = new TradingWatchlistStore(memoryStorage(), "", normalize);
  const future = record("BTC"),
    spot = record("BTC", "spot");
  store.setMembership(future, true);
  store.setMembership(future, true);
  store.setMembership(spot, true);
  assert.equal(store.activeGroup.markets.length, 2);
  store.addGroup("观察组");
  store.setMembership(future, true);
  store.setMembership(future, false);
  assert.equal(store.activeGroup.markets.length, 0);
  store.selectGroup("watchlist");
  assert.equal(store.has(future.id), true);
  store.setMembership(future, false);
  assert.equal(store.has(spot.id), true);
  assert.equal(store.groups[1].markets.length, 0);
  assert.equal(store.groups[2].markets.length, 0);
});

test("group selection, expansion, members and drag order persist only for the current account", () => {
  const storage = memoryStorage();
  const store = new TradingWatchlistStore(
    storage,
    " HTTPS://haolo.com::USER ",
    normalize,
  );
  store.addGroup("观察组");
  const groupId = store.activeGroup.id;
  for (const symbol of ["BTC", "ETH", "SOL"])
    store.setMembership(record(symbol), true);
  store.move(record("SOL").id, record("BTC").id, false);
  store.expanded = true;
  store.save();
  const restored = new TradingWatchlistStore(
    storage,
    "https://haolo.com::user",
    normalize,
  );
  assert.equal(restored.activeGroup.id, groupId);
  assert.equal(restored.expanded, true);
  assert.deepEqual(
    restored.activeGroup.markets.map((r) => r.baseAsset),
    ["SOL", "BTC", "ETH"],
  );
  assert.equal(
    new TradingWatchlistStore(storage, "another-account", normalize).groups
      .length,
    3,
  );
  assert.equal(
    new TradingWatchlistStore(storage, "", normalize).groups.length,
    3,
  );
});

test("moving rows works in both directions and cannot corrupt other groups or drop unknown IDs", () => {
  const store = new TradingWatchlistStore(memoryStorage(), "", normalize);
  for (const symbol of ["BTC", "ETH", "SOL"])
    store.setMembership(record(symbol), true);
  store.addGroup("观察组");
  store.setMembership(record("BTC"), true);
  store.selectGroup("watchlist");
  assert.equal(store.move(record("BTC").id, record("SOL").id, true), true);
  assert.deepEqual(
    store.activeGroup.markets.map((r) => r.baseAsset),
    ["ETH", "SOL", "BTC"],
  );
  assert.equal(store.move(record("BTC").id, record("ETH").id, false), true);
  assert.equal(store.move("unknown", record("BTC").id, true), false);
  assert.equal(store.move(record("BTC").id, "unknown", true), false);
  assert.equal(store.move(record("BTC").id, record("BTC").id, true), false);
  assert.deepEqual(
    store.activeGroup.markets.map((r) => r.baseAsset),
    ["BTC", "ETH", "SOL"],
  );
  assert.deepEqual(
    store.groups[3].markets.map((r) => r.baseAsset),
    ["BTC"],
  );
});

test("group names reject empty, duplicate, control characters and over five Unicode characters", () => {
  const store = new TradingWatchlistStore(memoryStorage(), "", normalize);
  for (const name of ["", "   ", "自选", " 传统金融 ", "六个字的分组", "a\nb"])
    assert.ok(store.addGroup(name).error, name);
  assert.equal(store.addGroup(" 五个字分组 ").error, "");
  assert.equal(store.activeGroup.name, "五个字分组");
  assert.equal(store.addGroup("🚀🚀🚀🚀🚀").error, "");
  assert.ok(store.addGroup("🚀🚀🚀🚀🚀🚀").error);
  assert.equal(watchlistGroupNameError("stock", store.groups), "");
  store.addGroup("Stock");
  assert.ok(store.addGroup("stock").error);
});

test("deleting custom groups persists, falls back only for the active group and preserves other accounts and builtins", () => {
  const storage = memoryStorage();
  const store = new TradingWatchlistStore(storage, "owner", normalize);
  store.setMembership(record("BTC"), true);
  const first = store.addGroup("观察组").group.id;
  store.setMembership(record("ETH"), true);
  const second = store.addGroup("短线").group.id;
  store.setMembership(record("SOL"), true);
  const other = new TradingWatchlistStore(storage, "other", normalize);
  other.addGroup("观察组");
  other.setMembership(record("ETH"), true);
  const otherSnapshot = storage.getItem(tradingWatchlistStorageKey("other"));
  assert.equal(store.removeGroup(first), true);
  assert.equal(store.activeGroupId, second);
  assert.equal(store.has(record("SOL").id), true);
  assert.equal(store.removeGroup(second), true);
  assert.equal(store.activeGroupId, "watchlist");
  assert.equal(store.has(record("BTC").id), true);
  for (const id of ["watchlist", "tradfi", "indices", "custom-unknown"])
    assert.equal(store.removeGroup(id), false);
  const restored = new TradingWatchlistStore(storage, "owner", normalize);
  assert.deepEqual(restored.groups, store.groups);
  assert.equal(restored.activeGroupId, "watchlist");
  assert.equal(storage.getItem(tradingWatchlistStorageKey("other")), otherSnapshot);
});

test("fixed recommendations add only the selected Binance USDT perpetuals once, in order and to the current editable group", () => {
  assert.deepEqual(WATCHLIST_RECOMMENDED_MARKETS.map(m => m.baseAsset), ["BTC", "ETH", "ZEC", "BNB", "SNDK", "MU", "SKHYNIX", "XAU"]);
  assert.ok(WATCHLIST_RECOMMENDED_MARKETS.every(m => m.provider === "binance" && m.marketType === "perpetual" && m.quoteAsset === "USDT"));
  assert.deepEqual(WATCHLIST_RECOMMENDED_MARKETS.slice(4).map(m => m.assetClass), ["stock", "stock", "stock", "commodity"]);
  const storage = memoryStorage();
  const store = new TradingWatchlistStore(storage, "recommend", normalize);
  store.setMembership(record("BTC", "spot"), true);
  const selected = WATCHLIST_RECOMMENDED_MARKETS.filter(m => ["BTC", "MU", "XAU"].includes(m.baseAsset));
  store.addMarkets(selected);
  store.addMarkets(selected);
  assert.deepEqual(store.activeGroup.markets.map(m => m.id), [record("BTC", "spot").id, ...selected.map(m => m.id)]);
  store.addGroup("推荐");
  store.addMarkets(WATCHLIST_RECOMMENDED_MARKETS);
  assert.deepEqual(store.activeGroup.markets, WATCHLIST_RECOMMENDED_MARKETS);
  assert.equal(store.groups[0].markets.length, 4);
  const restored = new TradingWatchlistStore(storage, "recommend", normalize);
  assert.deepEqual(restored.activeGroup.markets, WATCHLIST_RECOMMENDED_MARKETS);
  for (const id of ["tradfi", "indices"]) {
    store.selectGroup(id);
    store.addMarkets(WATCHLIST_RECOMMENDED_MARKETS);
    assert.equal(store.activeGroup.markets.length, 0);
  }
});

test("fixed catalogs contain all Binance TradFi perpetuals, reject edits and never persist derived members", () => {
  const storage = memoryStorage();
  const store = new TradingWatchlistStore(storage, "fixed", normalize);
  const gold = { ...record("XAU"), assetClass: "commodity" };
  const stock = { ...record("SKHYNIX"), assetClass: "stock" };
  const usdGold = { ...gold, id: "BINANCE:FUTURES:XAUUSDC", symbol: "XAUUSDC", quoteAsset: "USDC" };
  store.updateTradFiMarkets([record("BTC"), gold, stock, usdGold, { ...record("XAU", "spot"), assetClass: "commodity" }, { ...stock, provider: "finnhub" }]);
  store.selectGroup("tradfi");
  assert.deepEqual(store.activeGroup.markets.map(m => m.id), [gold.id, stock.id, usdGold.id]);
  store.setMembership(gold, false);
  store.setMembership(record("ETH"), true);
  store.move(gold.id, stock.id, true);
  store.reorder([stock.id, gold.id]);
  assert.deepEqual(store.activeGroup.markets.map(m => m.id), [gold.id, stock.id, usdGold.id]);
  store.selectGroup("indices");
  store.setMembership(record("ETH"), true);
  assert.equal(store.activeGroup.markets.length, 0);
  const saved = JSON.parse(storage.getItem(tradingWatchlistStorageKey("fixed")));
  assert.equal(saved.groups.find(g => g.id === "tradfi").markets.length, 0);
});

test("legacy lists and custom names colliding with new categories retain members and selection", () => {
  const storage = memoryStorage();
  storage.setItem(tradingWatchlistStorageKey("migration"), JSON.stringify({
    version: 1, activeGroupId: "contracts", expanded: false,
    groups: [null, { id: "watchlist", name: "自选", markets: [record("BTC")] },
      { id: "contracts", name: "合约", markets: [record("ETH")] },
      { id: "spot", name: "现货", markets: [record("SOL", "spot")] },
      { id: "custom-existing", name: "传统金融", markets: [record("XAU")] }],
  }));
  const store = new TradingWatchlistStore(storage, "migration", normalize);
  assert.equal(store.activeGroup.name, "原合约");
  assert.equal(store.activeGroup.markets[0].baseAsset, "ETH");
  assert.equal(store.groups.find(g => g.id === "custom-existing").markets[0].baseAsset, "XAU");
  assert.equal(new Set(store.groups.map(g => g.name)).size, store.groups.length);
  assert.equal(store.expanded, false);
  store.save();
  const restored = new TradingWatchlistStore(storage, "migration", normalize);
  assert.deepEqual(restored.groups, store.groups);
});

test("pointer order commits deduplicate IDs and retain members omitted by stale views", () => {
  const store = new TradingWatchlistStore(memoryStorage(), "", normalize);
  for (const symbol of ["BTC", "ETH", "SOL"]) store.setMembership(record(symbol), true);
  store.reorder([record("ETH").id, "unknown", record("BTC").id, record("ETH").id]);
  assert.deepEqual(store.activeGroup.markets.map(m => m.baseAsset), ["ETH", "BTC", "SOL"]);
});

test("unavailable or malformed storage remains usable without importing another account", () => {
  const storage = memoryStorage();
  storage.setItem(tradingWatchlistStorageKey("x"), "invalid json");
  const store = new TradingWatchlistStore(storage, "x", normalize);
  assert.equal(store.groups.length, 3);
  assert.equal(store.expanded, true);
  store.setMembership(record("BTC"), true);
  const unavailable = new TradingWatchlistStore(
    {
      getItem() {
        throw Error("disabled");
      },
      setItem() {
        throw Error("full");
      },
    },
    "x",
    normalize,
  );
  assert.doesNotThrow(() => unavailable.addGroup("测试"));
  assert.equal(unavailable.expanded, true);
  assert.doesNotThrow(() => unavailable.setMembership(record("BTC"), true));
  assert.equal(unavailable.has(record("BTC").id), true);
});

test("composer sends collapse only the active trading watchlist after content and send guards pass", async () => {
  const source = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function sendCurrentMessage(");
  const end = source.indexOf("  const tradingExpertRoutingText =", start);
  assert.ok(start >= 0 && end > start);
  // Run the real send preflight without dispatching a model request.
  const compiled = ts.transpileModule(source.slice(start, end) + "\n}", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const scenario of [
    { text: "分析一下走势", expected: 1 },
    { text: "", expected: 0 },
    { text: " \n ", expected: 0 },
    { text: "", attachments: [{ id: "chart", uploadStatus: "uploading" }], expected: 1 },
    { text: "分析一下走势", pending: true, expected: 0 },
    { text: "分析一下走势", submitting: true, expected: 0 },
    { text: "分析一下走势", workflowRunning: true, expected: 0 },
    { text: "分析一下走势", resuming: true, expected: 0 },
    { text: "分析一下走势", voiceStatus: "recording", expected: 0 },
    { text: "分析一下走势", validationError: "unsupported attachment", expected: 0 },
    { text: "普通对话", trading: false, expected: 0 },
    { text: "后台任务", currentThreadId: "another-task", expected: 0 },
  ]) {
    let collapses = 0;
    const input = { value: scenario.text };
    const context = {
      state: {
        currentThreadId: scenario.currentThreadId || "task",
        attachments: scenario.attachments || [],
        voiceInput: { status: scenario.voiceStatus || "idle" },
      },
      root: { querySelector: () => input },
      submittingComposerThreadIds: new Set(scenario.submitting ? ["task"] : []),
      switchingThreadId: null,
      WORKFLOW_RUNNING_SEND_BLOCKED_TOAST: "blocked",
      firstString: (...values) => values.find(Boolean),
      currentComposerThreadId: () => "task",
      composerThreadIdForSend: (id) => id,
      isComposerSendPending: () => scenario.pending,
      activeWorkflowRunForThread: () => scenario.workflowRunning,
      showToast: () => {},
      localGroupChatRecord: () => null,
      isThreadContinuationCreationActive: () => false,
      isThreadResumeInFlight: () => scenario.resuming,
      isLocalCodexThread: () => false,
      mediaCreationVisibleComposerText: (_id, text) => text,
      workflowComposerInvocationContract: () => null,
      newThreadModeForThread: () => "execution",
      isMediaCreationMode: () => false,
      deepSeekMediaComposerValidationError: () => scenario.validationError,
      isImageGenerationThreadMode: () => false,
      isVideoExpertThreadId: () => false,
      workflowComposerTopologyValidation: () => null,
      isTradingExpertSurfaceThreadId: () => scenario.trading !== false,
      collapseTradingExpertWatchlist: () => { collapses++; },
    };
    const send = new Function(...Object.keys(context), `${compiled}\nreturn sendCurrentMessage;`)(...Object.values(context));
    await send("task");
    assert.equal(collapses, scenario.expected, JSON.stringify(scenario));
    assert.equal(input.value, scenario.text, "collapsing must preserve the message being sent");
  }
});

test("watchlist surfaces cover both themes and checkbox, hover, focus, selected, open and disabled states", async () => {
  const css = await readFile(
    new URL("../src/renderer/trading-watchlist.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /html\[data-theme="dark"\][\s\S]*--watchlist-accent:[\s\S]*--watchlist-positive:[\s\S]*--watchlist-negative:/,
  );
  for (const state of [
    ":hover",
    ":active",
    ":focus-visible",
    ":disabled",
    ":checked",
    '[aria-pressed="true"]',
    '[aria-expanded="true"]',
    ".sorting",
    ".trading-watchlist-drag-ghost",
  ])
    assert.ok(css.includes(state), state);
  assert.match(
    css,
    /\.trading-watchlist\[hidden\][^{]*\{\s*display: none !important/,
  );
  assert.match(
    css,
    /\.trading-watchlist-dialog[^}]+background: var\(--surface-primary\)/s,
  );
  assert.match(
    css,
    /\.trading-watchlist-name input::placeholder\s*\{\s*color: var\(--text-secondary\)/,
  );
  const market = await readFile(
    new URL("../src/renderer/trading-expert-market.ts", import.meta.url),
    "utf8",
  );
  const checkboxHandler = market.slice(
    market.indexOf('if (action === "watchlist-membership")'),
    market.indexOf('if (action === "symbol" || action === "favorite-symbol")'),
  );
  assert.match(checkboxHandler, /setMembership/);
  assert.doesNotMatch(
    checkboxHandler,
    /toggleFavoriteMarket|addFavoriteMarket|restartMarketData|setPickerOpen/,
  );
  assert.match(market, /this\.watchlistPanel\.destroy\(\)/);
});
