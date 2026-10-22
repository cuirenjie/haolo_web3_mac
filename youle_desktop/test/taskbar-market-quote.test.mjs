import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { normalizeTaskbarMarketQuote, taskbarMarketQuoteBounds } from "../src/main/taskbar-market-quote-view.mjs";

const bar = { x: 0, y: 1032, width: 1920, height: 48 };
const anchor = { x: 960, y: 1036, width: 44, height: 40 };
const tray = { x: 1680, y: 1032, width: 240, height: 48 };
const layout = { visible: true, bar, anchor, occupied: [anchor, tray] };

test("quote sits immediately right of Haolo, vertically centered", () => {
  assert.deepEqual(taskbarMarketQuoteBounds(layout), { x: 1010, y: 1036, width: 176, height: 40 });
});
test("new taskbar buttons move the quote into free space without covering tray or icons", () => {
  const next = { x: 1010, y: 1036, width: 44, height: 40 };
  const bounds = taskbarMarketQuoteBounds({ ...layout, occupied: [tray, next, anchor] });
  assert.equal(bounds.x, 1060);
  assert.equal(taskbarMarketQuoteBounds({ ...layout, occupied: [...layout.occupied, { x: 1004, y: 1032, width: 676, height: 48 }] }), null);
});
test("150% DPI taskbars with a narrow right-hand gap retain a compact readable quote", () => {
  assert.deepEqual(taskbarMarketQuoteBounds({
    ...layout, anchor: { x: 1076, y: 1019, width: 44, height: 48 },
    bar: { x: 0, y: 1019, width: 1707, height: 48 },
    occupied: [{ x: 1274, y: 1019, width: 433, height: 48 }],
  }), { x: 1126, y: 1023, width: 142, height: 40 });
});
test("hidden, fullscreen, missing-anchor, vertical and clipped taskbars do not show a quote", () => {
  assert.equal(taskbarMarketQuoteBounds({ ...layout, visible: false }), null);
  assert.equal(taskbarMarketQuoteBounds({ ...layout, anchor: null }), null);
  assert.equal(taskbarMarketQuoteBounds({ ...layout, bar: { ...bar, height: 2 } }), null);
  assert.equal(taskbarMarketQuoteBounds({ ...layout, bar: { ...bar, width: 48, height: 1080 } }), null);
  assert.equal(taskbarMarketQuoteBounds({ ...layout, anchor: { ...anchor, x: -200 } }), null);
});
test("negative monitor coordinates and small DPI taskbars remain inside their bounds", () => {
  assert.deepEqual(taskbarMarketQuoteBounds({
    visible: true, bar: { x: -1920, y: -40, width: 1920, height: 40 },
    anchor: { x: -1000, y: -40, width: 40, height: 40 }, occupied: [],
  }), { x: -954, y: -38, width: 176, height: 36 });
});
test("malformed and unavailable quote values cannot become misleading zero prices", () => {
  assert.equal(normalizeTaskbarMarketQuote(null), null);
  assert.equal(normalizeTaskbarMarketQuote({ name: "BTC" }), null);
  const quote = normalizeTaskbarMarketQuote({ marketId: "BTC", name: " BTC/USDT\n 永续 ", price: NaN, changePercent: -1.61 });
  assert.equal(quote.name, "BTC/USDT 永续");
  assert.equal(quote.priceText, "--");
  assert.equal(quote.changePercent, null);
});

// Exercise the real renderer method with state fixtures, including switching
// before the new REST/WS snapshot has arrived (the old-price race).
const source = readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const start = source.indexOf("  private syncTaskbarQuote()");
const end = source.indexOf("  private updateStatsUi()", start);
const js = ts.transpileModule(source.slice(start, end).replace("private syncTaskbarQuote()", "function syncTaskbarQuote()"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(overrides = {}) {
  const sent = [];
  const window = { codexDesktop: { setTaskbarMarketQuote: async (quote) => { sent.push(quote); } } };
  const publish = new Function("window", "formatMarketPrice", "baseAssetFromSymbol", "MARKET_QUOTE", "indexName", "indexCopy",
    `${js};return syncTaskbarQuote;`)(window, (p) => p.toLocaleString("en-US", { minimumFractionDigits: 2 }), (s) => s.replace(/USDT$/, ""), "USDT",
    (index) => index.name, (zh) => zh);
  const state = {
    disposed: false, host: { isConnected: true }, selectedIndex: null,
    selectedMarketId: "BINANCE:FUTURES:BTCUSDT", loadedMarketId: "BINANCE:FUTURES:BTCUSDT",
    selectedSymbol: "BTCUSDT", selectedMarketType: "perpetual",
    selectedMarketMeta: { displaySymbol: "BTC/USDT", tag: "永续" },
    stats: { midPrice: 81511.9, markPrice: 81520, prevDayPrice: 82846 },
    favoriteTickerMarketsById: new Map(), markets: [], favoriteMarketFromId: () => null, ...overrides,
  };
  publish.call(state);
  return { state, sent, publish };
}
test("current futures quote uses the same latest price and 24h denominator as titlebar", () => {
  const { sent } = harness();
  assert.equal(sent[0].price, 81511.9);
  assert.equal(sent[0].priceText, "81,511.90");
  assert.equal(sent[0].name, "BTC/USDT 永续");
  assert.equal(sent[0].changePercent.toFixed(2), "-1.61");
});
test("switching pairs cannot show BTC stats under ETH; current ticker is allowed as fallback", () => {
  const { sent, state, publish } = harness({
    selectedMarketId: "BINANCE:FUTURES:ETHUSDT", selectedSymbol: "ETHUSDT",
    selectedMarketMeta: { displaySymbol: "ETH/USDT", tag: "永续" },
  });
  assert.equal(sent[0].price, null);
  assert.equal(sent[0].priceText, "--");
  state.favoriteTickerMarketsById.set(state.selectedMarketId, { quoteAvailable: true, markPrice: 2322, changePercent: 2 });
  publish.call(state);
  assert.equal(sent[1].price, 2322);
  assert.equal(sent[1].changePercent, 2);
});
test("spot quotes, nonfavorite pairs, indices and workspace cleanup publish correctly", () => {
  assert.equal(harness({ selectedMarketType: "spot" }).sent[0].price, 81520);
  assert.equal(harness({ selectedIndex: { name: "上证指数", value: 4000, changePercent: 1.2 } }).sent[0].name, "上证指数 指数");
  assert.deepEqual(harness({ disposed: true }).sent, [null]);
  assert.deepEqual(harness({ host: { isConnected: false } }).sent, [null]);
});
