import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createBinanceAccountUiState, renderBinanceAccountPage } from "../src/renderer/binance-account-ui.ts";
import { loadSharedAccountDetails } from "../src/renderer/binance-account-details.ts";
import { normalizeSharedAccountDetails } from "../src/main/binance-account/shared-details.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { binanceCredentialErrorResult, binanceAccountReadErrorResult } from "../src/shared/binance-account-errors.mjs";

function state() {
  const value = createBinanceAccountUiState();
  value.status = { bound: true, remoteOnly: true, serverCredentialsBound: true, serverConnectionId: "a" };
  value.activeSection = "history";
  return value;
}
const options = () => ({ force: true, isCurrent: () => true, changed() {}, credentialError: () => false });
const row = (id) => ({ id, symbol: "BTCUSDT", contractType: "PERPETUAL", direction: "LONG", positionSide: "BOTH",
  closeType: "FULL", realizedPnl: 12, closedAmount: .01, openTime: 1000, closeTime: 2000, entryPrice: 100, averageClosePrice: 200 });
const result = (items, extra = {}) => normalizeSharedAccountDetails({ section: "positionHistory", items,
  status: "ready", nextCursor: null, asOf: 5000, ...extra }, "positionHistory");

test("shared history loads without a summary; failures never render false empty and retain verified rows", async () => {
  const value = state();
  assert.match(renderBinanceAccountPage(value), /正在加载账户明细/);
  assert.doesNotMatch(renderBinanceAccountPage(value), /暂无仓位历史/);
  await loadSharedAccountDetails(value, async () => { throw new Error("offline"); }, options());
  assert.match(renderBinanceAccountPage(value), /offline/);
  assert.doesNotMatch(renderBinanceAccountPage(value), /暂无仓位历史/);
  await loadSharedAccountDetails(value, async () => result([row("1")], {status: "stale"}), options());
  assert.match(renderBinanceAccountPage(value), /BTCUSDT|BTC\/USDT/);
  assert.doesNotMatch(renderBinanceAccountPage(value), /上次成功读取|数据时间/);
  await loadSharedAccountDetails(value, async () => { throw new Error("timeout"); }, options());
  assert.equal(value.details.positionHistory.result.items.length, 1);
  assert.match(renderBinanceAccountPage(value), /timeout/);
  assert.doesNotMatch(renderBinanceAccountPage(value), /暂无仓位历史/);
});

test("only a successful complete empty collection renders empty; pagination deduplicates and resets on rotation", async () => {
  const value = state();
  await loadSharedAccountDetails(value, async () => result([]), options());
  assert.match(renderBinanceAccountPage(value), /暂无仓位历史/);
  await loadSharedAccountDetails(value, async () => result([row("1")], {nextCursor: "page2"}), options());
  await loadSharedAccountDetails(value, async params => {
    assert.equal(params.cursor, "page2");
    return result([row("1"), row("2")]);
  }, {...options(), more: true});
  assert.deepEqual(value.details.positionHistory.result.items.map(r => r.id), ["1", "2"]);
  let finish;
  const pending = loadSharedAccountDetails(value, () => new Promise(resolve => { finish = resolve; }), options());
  value.status.serverConnectionId = "b";
  finish(result([row("old-account")]));
  await pending;
  assert.doesNotMatch(renderBinanceAccountPage(value), /BTCUSDT|BTC\/USDT/);
  await loadSharedAccountDetails(value, async () => result([]), options());
  assert.equal(value.details.positionHistory.connectionId, "b");
  assert.deepEqual(value.details.positionHistory.result.items, []);
});

test("incomplete calendar never invents a month total or labels unsynced days no trades", () => {
  const value = state();
  value.activeSection = "profit-calendar";
  value.profitCalendarMonth = "2026-10";
  value.profitCalendar = { month: "2026-10", currency: "USDT", days: [{date: "2026-10-21", pnl: 12}],
    status: "partial", availableDates: ["2026-10-21"], asOf: 1792562400000 };
  const html = renderBinanceAccountPage(value);
  assert.match(html, /数据尚未同步/);
  assert.match(html, /未完整月份不计算总收益/);
  assert.match(html, /<strong>--<\/strong>/);
  value.profitCalendarError = "offline";
  assert.match(renderBinanceAccountPage(value), /offline/);
  assert.match(renderBinanceAccountPage(value), /12\.00/);
});

test("Windows reads the existing mobile detail contract and timezone-aware calendar through authenticated GET", async () => {
  const client = new YouleApiClient();
  client.loaded = true; client.baseUrl = "https://offline.invalid"; client.token = "test-session";
  const requests = [];
  client.serviceFetch = async (url, init) => {
    requests.push({url: new URL(url), init});
    return new Response(JSON.stringify({items: []}), {status: 200});
  };
  await client.getAccountConnectionDetails("a", {section: "openOrders"});
  await client.getAccountConnectionDetails("a", {section: "positionHistory", cursor: "next"});
  await client.getAccountConnectionProfitCalendar("a", {month: "2026-10"});
  assert.deepEqual(requests.map(r => r.url.pathname.split("/").at(-1)), ["details", "details", "profit-calendar"]);
  assert.equal(requests[0].url.searchParams.get("section"), "openOrders");
  assert.equal(requests[1].url.searchParams.get("cursor"), "next");
  assert.equal(requests[2].url.searchParams.get("timeZone"), Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.ok(requests.every(r => r.init.method === "GET"));
});

test("actual calendar loader supports a shared-only binding and discards previous binding responses", async () => {
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "loadBinanceAccountProfitCalendar");
  const value = state();
  value.activeSection = "profit-calendar";
  const requests = [];
  const deps = { state: { binanceAccount: value }, api: {getBinanceAccountProfitCalendar: () => new Promise(resolve => requests.push(resolve))},
    renderBinanceAccountLiveUpdate() {}, handleBinanceCredentialFailure: () => false, errorMessage: e => e.message };
  const code = ts.transpileModule(node.getText(source), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const load = new Function(...Object.keys(deps), `let binanceAccountProfitCalendarLoadSequence=0;${code};return loadBinanceAccountProfitCalendar;`)(...Object.values(deps));
  const first = load();
  assert.equal(value.profitCalendarLoading, true);
  value.status.serverConnectionId = "b";
  const second = load();
  requests[0]({month: value.profitCalendarMonth, days: [{date:"old",pnl:100}]});
  await first;
  assert.equal(value.profitCalendar, null);
  assert.equal(value.profitCalendarLoading, true);
  requests[1]({month: value.profitCalendarMonth, days: []});
  await second;
  assert.deepEqual(value.profitCalendar.days, []);
  assert.equal(value.profitCalendarLoading, false);
  assert.equal(value.profitCalendarConnectionId, "b");
});

test("actual detail IPC uses the shared owner binding and preserves errors for the preload", async () => {
  const source = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let node;
  function visit(n) { if (ts.isCallExpression(n) && n.expression.getText(source) === "ipcMain.handle" && n.arguments[0]?.text === "binanceAccount:getDetails") node=n.arguments[1]; ts.forEachChild(n,visit); }
  visit(source);
  let failure = false;
  const deps = {assertExternalModelsIpcSender() {}, requireBinanceAccountOwner: async () => ({ownerId:"owner"}),
    sameBinanceBindingOwner: (a,b) => a.ownerId === b.ownerId,
    readBinanceAccountStatusWithSharedBinding: async () => ({serverCredentialsBound:true,serverConnectionId:"bound"}),
    getYouleApiClient: () => ({getAccountConnectionDetails:async(id,params) => {
      assert.equal(id,"bound"); assert.equal(params.section,"positionHistory");
      if (failure) throw Object.assign(new Error("timeout"),{code:"REQUEST_TIMEOUT",retryable:true});
      return result([row("1")]);
    }}), normalizeSharedAccountDetails, binanceCredentialErrorResult, binanceAccountReadErrorResult};
  const handle=new Function(...Object.keys(deps),`return (${node.getText(source)});`)(...Object.values(deps));
  const ok=await handle({}, {section:"positionHistory"});
  assert.equal(ok.ok,true); assert.equal(ok.details.items.length,1);
  failure=true;
  const failed=await handle({}, {section:"positionHistory"});
  assert.equal(failed.ok,false); assert.equal(failed.error.code,"REQUEST_TIMEOUT");
});
