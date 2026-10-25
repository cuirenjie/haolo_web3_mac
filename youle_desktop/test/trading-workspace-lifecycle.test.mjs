import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true);
const workspace = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "TradingExpertMarketWorkspace");
function controller(methods, globals = {}) {
  const members = methods.map(name => workspace.members.find(node => node.name?.getText(parsed) === name).getText(parsed)).join("\n");
  const compiled = ts.transpileModule(`class Harness { ${members} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(globals), `${compiled}\nreturn new Harness();`)(...Object.values(globals));
}

test("a late favorite response cannot commit or initialize favorites after its chart is destroyed", async () => {
  let finish;
  let commits = 0;
  let additions = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const chart = controller(["syncFavoriteServer"], { window: { codexDesktop: {
    listTradingFavorites: () => pending,
    addTradingFavorite: () => { additions++; },
  } } });
  Object.assign(chart, {
    disposed: false, favoriteStorageAccountIdentity: "account-a", favoriteServerLastSyncAt: 0,
    queueFavoriteServer: operation => operation(),
    watchlist: { groups: [{ id: "watchlist", markets: [{ id: "BTC" }] }], pendingMemberships: new Set() },
    commitFavoriteMarketChanges: () => { commits++; },
  });
  const request = chart.syncFavoriteServer(true);
  chart.disposed = true;
  finish({ initialized: false, items: [] });
  await request;
  assert.equal(commits, 0);
  assert.equal(additions, 0);
  assert.equal(chart.favoriteServerReady, undefined);
});

test("only the connected active chart can own the titlebar ticker slot", () => {
  let replacements = 0;
  const host = {
    children: [],
    get childElementCount() { return this.children.length; },
    replaceChildren(bar) {
      replacements++;
      this.children.forEach(child => { child.parentElement = null; });
      this.children = [bar]; bar.parentElement = this;
    },
  };
  const globals = { document: { querySelector: () => host } };
  const make = () => Object.assign(controller(["syncTitlebarFavoriteTickerHost"], globals), {
    disposed: false, host: { isConnected: true }, favoriteTickerBar: { parentElement: null },
  });
  const old = make(), current = make();
  old.syncTitlebarFavoriteTickerHost();
  old.disposed = true;
  current.syncTitlebarFavoriteTickerHost();
  old.syncTitlebarFavoriteTickerHost();
  assert.deepEqual(host.children, [current.favoriteTickerBar]);
  current.syncTitlebarFavoriteTickerHost();
  assert.equal(replacements, 2, "ordinary refresh preserves the current ticker DOM");
  const parked = make(); parked.host.isConnected = false;
  parked.syncTitlebarFavoriteTickerHost();
  assert.deepEqual(host.children, [current.favoriteTickerBar]);
  host.children.push({ parentElement: host });
  current.syncTitlebarFavoriteTickerHost();
  assert.deepEqual(host.children, [current.favoriteTickerBar], "cleans up an already duplicated ticker");
});

test("deferred ticker paints and watchlist bindings stop after chart disposal", () => {
  const chart = controller(["renderFavoriteTickerBar", "syncWatchlistHost"]);
  chart.disposed = true;
  // No DOM or watchlist dependency exists: late callbacks must return first.
  assert.doesNotThrow(() => chart.renderFavoriteTickerBar());
  assert.doesNotThrow(() => chart.syncWatchlistHost());
});
