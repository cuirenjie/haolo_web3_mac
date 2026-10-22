import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const files = {
  client: new URL("../src/main/youle-api-client.mjs", import.meta.url),
  main: new URL("../src/main/main.mjs", import.meta.url),
  preload: new URL("../src/main/preload.mjs", import.meta.url),
  renderer: new URL("../src/renderer/main.ts", import.meta.url),
  market: new URL("../src/renderer/trading-expert-market.ts", import.meta.url),
};

test("trading favorites use the shared authenticated server collection", async () => {
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
    ),
  );

  for (const operation of [
    "listTradingFavorites",
    "addTradingFavorite",
    "removeTradingFavorite",
    "reorderTradingFavorites",
  ]) {
    assert.match(sources.client, new RegExp(`async ${operation}`));
    assert.match(sources.main, new RegExp(operation));
    assert.match(sources.preload, new RegExp(operation));
  }
  assert.match(sources.client, /DEFAULT_TRADING_FAVORITES_PATH = "\/api\/mobile\/v1\/favorites"/);
  assert.match(sources.market, /syncFavoriteServer\(true\)/);
  assert.match(sources.market, /onMembershipChange: \(record, checked\) => this\.syncWatchlistMembership/);
  assert.match(sources.market, /onReorder: \(records\) => this\.syncWatchlistOrder/);
  assert.doesNotMatch(sources.market, /this\.syncFavoriteServerMembership\(market, !wasFavorite\)/);
  assert.doesNotMatch(sources.market, /this\.syncFavoriteServerOrder\(orderedMarketIds\)/);
  assert.match(sources.market, /mergeSharedSnapshot\(remoteRecords\)/);
  assert.match(sources.renderer, /reorderTradingFavorites\?\(params/);

  assert.match(sources.main, /if \(!local\.bound\) throw error/);
});

test("reading shared account connections never registers or mutates a binding", async () => {
  const source = await readFile(files.main, "utf8");
  const parsed = ts.createSourceFile("main.mjs", source, ts.ScriptTarget.Latest, true);
  const runtime = ["activeSharedBinanceConnection", "readSharedBinanceAccountConnections"].map((name) => {
    const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `missing function: ${name}`);
    return declaration.getText(parsed);
  }).join("\n");
  const calls = [];
  const active = { id: "active", venue: "binance", marketType: "usdm" };
  const perpetual = { id: "perpetual", venue: "binance", marketType: "perpetual" };
  const api = {
    load: async () => { calls.push("load"); },
    listAccountConnections: async () => {
      calls.push("list");
      return { items: [active, perpetual, { ...active, revoked: true }, { ...active, venue: "other" }, { ...active, marketType: "spot" }] };
    },
    registerMobileDevice: () => assert.fail("a read must not register a device"),
  };
  const context = { getYouleApiClient: () => api };
  runInNewContext(runtime, context);
  assert.deepEqual(await context.readSharedBinanceAccountConnections(), [active, perpetual]);
  assert.deepEqual(calls, ["load", "list"]);
  const unavailable = new Error("connection list unavailable");
  api.listAccountConnections = async () => { throw unavailable; };
  await assert.rejects(context.readSharedBinanceAccountConnections(), (error) => error === unavailable);
});
