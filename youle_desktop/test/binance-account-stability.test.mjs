import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createAccountReadCoordinator } from "../src/main/binance-account/read-coordinator.mjs";
import { binanceAccountReadErrorResult } from "../src/shared/binance-account-errors.mjs";
import { positionHistoryReturn } from "../src/shared/position-history-return.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { createBinanceAccountUiState, renderBinanceAccountPage } from "../src/renderer/binance-account-ui.ts";
import { loadSharedAccountDetails } from "../src/renderer/binance-account-details.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";

const unavailable = () => Object.assign(new Error("connection reset"), { code: "ECONNRESET", retryable: true });
const request = { scope: "owner-a", key: "snapshot", group: "connection-a" };

test("concurrent reads share one retry chain, return independent objects, and never use a stale snapshot", async () => {
  let calls = 0, sleeps = 0;
  const coordinator = createAccountReadCoordinator({ sleep: async () => { sleeps++; }, random: () => 0 });
  const read = async () => { if (++calls === 1) throw unavailable(); return { equity: calls }; };
  const values = await Promise.all(Array.from({ length: 8 }, () => coordinator.run(request, read)));
  assert.equal(calls, 2); assert.equal(sleeps, 1);
  values[0].equity = -1;
  assert.equal(values[1].equity, 2);
  assert.equal((await coordinator.run(request, read)).equity, 3);
});

test("429 blocks requests in the same dataset group until retry-after, then recovers", async () => {
  let now = 1000, calls = 0;
  const coordinator = createAccountReadCoordinator({ now: () => now, sleep: async () => assert.fail("must not immediately retry 429") });
  const read = async () => { calls++; throw Object.assign(new Error("HTTP 429"), { status: 429, code: "BINANCE_UNAVAILABLE", retryable: true, retryAfterMs: 90_000 }); };
  await assert.rejects(coordinator.run(request, read), { status: 429 });
  now += 10_000;
  await assert.rejects(coordinator.run({ ...request, key: "snapshot-with-timezone" }, read), e => e.retryAfterMs === 80_000);
  assert.equal(calls, 1);
  now += 80_001;
  assert.equal(await coordinator.run(request, async () => "recovered"), "recovered");
});

test("binding invalidation and owner switch discard pending reads and prevent retries with new credentials", async () => {
  const coordinator = createAccountReadCoordinator();
  let finish;
  const pending = coordinator.run({ ...request, ttlMs: 750 }, () => new Promise(resolve => { finish = resolve; }));
  coordinator.invalidate();
  finish({ items: ["old"] });
  await assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
  assert.deepEqual(await coordinator.run({ ...request, scope: "owner-b" }, async () => ({ items: ["new"] })), { items: ["new"] });
  let current = true, calls = 0;
  const changing = createAccountReadCoordinator({ sleep: async () => { current = false; } });
  await assert.rejects(changing.run({ ...request, isCurrent: () => current }, async () => { calls++; throw unavailable(); }), { code: "ACCOUNT_CHANGED" });
  assert.equal(calls, 1);
});

test("auth and validation failures do not retry; a sustained outage is bounded", async () => {
  for (const error of [Object.assign(new Error("invalid key"), { status: 422, retryable: false }), Object.assign(new Error("revoked"), { status: 401, retryable: false }), unavailable()]) {
    let calls = 0;
    const coordinator = createAccountReadCoordinator({ sleep: async () => {} });
    await assert.rejects(coordinator.run(request, async () => { calls++; throw error; }));
    assert.equal(calls, error.retryable ? 2 : 1);
  }
});

function client() {
  const value = new YouleApiClient();
  value.loaded = true; value.baseUrl = "https://offline.invalid"; value.token = "offline-session";
  value.accountReadCoordinator = createAccountReadCoordinator({ sleep: async () => {} });
  return value;
}

test("real API GET recovers from a non-JSON proxy 502; writes remain single attempt and invalidate the binding cache", async () => {
  const value = client(); let reads = 0, writes = 0;
  value.serviceFetch = async (_url, init) => {
    if (init.method !== "GET") { writes++; return new Response("bad gateway", { status: 502 }); }
    if (++reads === 1) return new Response("bad gateway", { status: 502 });
    return Response.json({ items: [{ id: String(reads) }] });
  };
  assert.equal((await value.listAccountConnections()).items[0].id, "2");
  await value.listAccountConnections(); assert.equal(reads, 2);
  await assert.rejects(value.deleteAccountConnection("a")); assert.equal(writes, 1);
  await value.listAccountConnections(); assert.equal(reads, 3);
});

const main = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const renderer = ts.createSourceFile("main.ts", readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const preload = ts.createSourceFile("preload.mjs", readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function functionText(source, name) {
  return ts.transpileModule(source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function ipc(channel, deps) {
  let handler;
  function visit(n) { if (ts.isCallExpression(n) && n.expression.getText(main) === "ipcMain.handle" && n.arguments[0]?.text === channel) handler = n.arguments[1]; ts.forEachChild(n, visit); }
  visit(main);
  return new Function(...Object.keys(deps), `return (${handler.getText(main)});`)(...Object.values(deps));
}

test("actual API -> main IPC -> preload retains the observed generic 429 and its 13-second cooldown", async () => {
  const value = client();
  value.serviceFetch = async () => Response.json({ detail: { code: "BINANCE_UNAVAILABLE" } }, { status: 429, headers: { "Retry-After": "13" } });
  const handle = ipc("binanceAccount:getSnapshot", {
    assertExternalModelsIpcSender() {}, requireBinanceAccountOwner: async () => ({ ownerId: "a" }),
    readBinanceAccountStatusWithSharedBinding: async () => ({ serverCredentialsBound: true, serverConnectionId: "a" }),
    getYouleApiClient: () => value, normalizeSharedBinanceSnapshot: s => s,
    binanceAccountReadErrorResult, sameBinanceBindingOwner: () => true, console: { info() {} },
  });
  const envelope = await handle({});
  assert.equal(envelope.error.retryAfterMs, 13_000); assert.equal(envelope.error.status, 429);
  const invoke = new Function("ipcRenderer", `${functionText(preload, "invokeBinanceAccountSnapshot")};return invokeBinanceAccountSnapshot;`)({ invoke: async () => envelope });
  await assert.rejects(invoke(), e => e.code === "BINANCE_UNAVAILABLE" && e.retryAfterMs === 13_000 && e.retryable && e.status === 429);
});

test("history's selected return is based on opening notional for wins, losses, zero and partial closes", () => {
  const examples = [
    [{ realizedPnl: .2588, entryPrice: 1.0125, closedAmount: 136.2 }, .18766882398796253],
    [{ realizedPnl: -5, entryPrice: 100, closedAmount: 2, roi: 999, leverage: 20 }, -2.5],
    [{ realizedPnl: 1, entryPrice: 100, closedAmount: .5, closeType: "PARTIAL" }, 2],
    [{ realizedPnl: 0, entryPrice: 100, closedAmount: 1 }, 0],
  ];
  for (const [row, expected] of examples) assert.ok(Math.abs(positionHistoryReturn(row) - expected) < 1e-8);
  for (const invalid of [null, "", " ", false, Infinity, NaN]) {
    assert.equal(positionHistoryReturn({ realizedPnl: invalid, entryPrice: 100, closedAmount: 1 }), null);
    assert.equal(positionHistoryReturn({ realizedPnl: 1, entryPrice: invalid, closedAmount: 1 }), null);
  }
  assert.equal(positionHistoryReturn({ realizedPnl: 1, entryPrice: 100, closedAmount: 0 }), null);
  const label = "已实现盈亏 ÷ 开仓成交金额 × 100%";
  assert.equal(translateAppText(label, "en"), "Realized P&L ÷ opening notional × 100%");
  assert.equal(translateAppText(label, "zh-TW"), "已實現盈虧 ÷ 開倉成交金額 × 100%");
});

test("detail failures preserve rows, respect retry-after even on manual refresh, and resume without the summary", async () => {
  const value = createBinanceAccountUiState();
  value.status = { bound: true, serverCredentialsBound: true, serverConnectionId: "a" }; value.activeSection = "history";
  const options = { force: true, isCurrent: () => true, changed() {}, credentialError: () => false };
  const result = { section: "positionHistory", items: [{ id: "one", symbol: "SUIUSDT", realizedPnl: .2588, entryPrice: 1.0125, closedAmount: 136.2 }], status: "ready", asOf: 1000 };
  await loadSharedAccountDetails(value, async () => result, options);
  await loadSharedAccountDetails(value, async () => { throw Object.assign(unavailable(), { retryAfterMs: 60_000 }); }, options);
  await loadSharedAccountDetails(value, async () => assert.fail("early retry"), options);
  assert.equal(value.details.positionHistory.result.items.length, 1);
  value.details.positionHistory.retryAfter = 0;
  await loadSharedAccountDetails(value, async () => ({ ...result, status: "stale" }), options);
  const html = renderBinanceAccountPage(value);
  assert.doesNotMatch(html, /数据时间|上次成功读取|暂不可用/);
  assert.match(html, /\+0\.19%/);
});

test("one shared manual refresh makes one snapshot request instead of the local three-stage ladder", async () => {
  const account = createBinanceAccountUiState();
  account.status = { bound: true, serverCredentialsBound: true }; account.activeSection = "assets";
  let snapshots = 0, reconciled = 0;
  const deps = {
    state: { activeView: "account", binanceAccount: account },
    api: { getBinanceAccountStatus: async () => account.status, getBinanceAccountSnapshot: async () => { snapshots++; return { fetchedAt: "now" }; } },
    render() {}, renderBinanceAccountLiveUpdate() {}, syncTradingExpertOrderLineSnapshot() {},
    reconcileExecutionPlansWithBinanceSnapshot: async () => { reconciled++; },
    progressivelyRefreshBinanceAccountSnapshot: () => assert.fail("shared snapshot is already complete"),
    scheduleBinanceAccountLiveRefresh() {}, handleBinanceCredentialFailure: () => false, errorMessage: e => e.message,
    binanceAccountRetryDelay: () => 1000, showToast: () => assert.fail("refresh should succeed"),
    BINANCE_ACCOUNT_AUTO_REFRESH_INTERVAL_MS: 300_000, BINANCE_ACCOUNT_AUTO_RETRY_INTERVAL_MS: 30_000,
  };
  const run = new Function(...Object.keys(deps), `let binanceAccountProgressiveRefreshPromise=null,binanceAccountLoadSequence=0,binanceAccountSnapshotApplySequence=0,binanceAccountFullRefreshAfter=0,binanceAccountLiveRefreshFailures=0,binanceAccountLiveRetryAfter=0;${functionText(renderer, "refreshBinanceAccountSnapshot")};return refreshBinanceAccountSnapshot;`)(...Object.values(deps));
  await run(); assert.equal(snapshots, 1); assert.equal(reconciled, 1); assert.equal(account.error, null);
});

test("calendar auto-refresh retries after a temporary failure and refreshes an already loaded month", async () => {
  const account = createBinanceAccountUiState();
  account.status = { bound: true, serverCredentialsBound: true, serverConnectionId: "a" };
  account.activeSection = "profit-calendar";
  let calls = 0;
  const deps = {
    state: { binanceAccount: account },
    api: { getBinanceAccountProfitCalendar: async () => { if (++calls === 1) throw unavailable(); return { month: account.profitCalendarMonth, days: [] }; } },
    renderBinanceAccountLiveUpdate() {}, handleBinanceCredentialFailure: () => false,
    errorMessage: e => e.message, binanceAccountRetryDelay: () => 30_000,
  };
  const run = new Function(...Object.keys(deps), `let binanceAccountProfitCalendarLoadSequence=0;${functionText(renderer, "loadBinanceAccountProfitCalendar")};return loadBinanceAccountProfitCalendar;`)(...Object.values(deps));
  await run(); await run(); assert.equal(calls, 1);
  account.profitCalendarRetryAfter = 0;
  await run(); assert.equal(calls, 2); assert.equal(account.profitCalendarError, null);
  await run(); assert.equal(calls, 2);
  account.profitCalendarLoadedAt -= 30_001;
  await run(); assert.equal(calls, 3);
});


test("a snapshot's HTTP 429 does not suppress archived history/calendar or open orders", async () => {
  const value = client(), calls = [];
  value.serviceFetch = async url => {
    const target = new URL(url); calls.push(target.pathname + target.search);
    if (target.pathname.endsWith('/snapshot')) return Response.json({detail:{code:'BINANCE_UNAVAILABLE'}}, {status:429,headers:{'Retry-After':'13'}});
    return Response.json({ items: [], status: 'ready', days: [] });
  };
  await assert.rejects(value.getAccountConnectionSnapshot('a', {includeTodayPnl:true}), {status:429});
  await value.getAccountConnectionDetails('a', {section:'positionHistory'});
  await value.getAccountConnectionProfitCalendar('a', {month:'2026-10'});
  await value.getAccountConnectionDetails('a', {section:'openOrders'});
  await assert.rejects(value.getAccountConnectionSnapshot('a'), {status:429});
  assert.equal(calls.length, 4);
});


test('account identity changes invalidate a successful in-flight read before caching', async () => {
  const coordinator = createAccountReadCoordinator();
  let current = true;
  const result = coordinator.run({ scope: 'owner-a', key: 'summary', ttlMs: 10_000, isCurrent: () => current }, async () => {
    current = false;
    return { balance: 'old-account-value' };
  });
  await assert.rejects(result, { code: 'ACCOUNT_CHANGED' });
  const fresh = await coordinator.run({ scope: 'owner-a', key: 'summary', ttlMs: 10_000 }, async () => ({ balance: 'fresh' }));
  assert.deepEqual(fresh, { balance: 'fresh' });
});

test('a joined account reader rechecks its own validity without cancelling another caller', async () => {
  const coordinator = createAccountReadCoordinator();
  let done, current = true;
  const waiting = new Promise(resolve => { done = resolve; });
  const first = coordinator.run({ scope: 'owner-a', key: 'summary' }, () => waiting);
  const joined = coordinator.run({ scope: 'owner-a', key: 'summary', isCurrent: () => current }, () => assert.fail('must join'));
  current = false; done({ balance: 'fresh' });
  await assert.rejects(joined, { code: 'ACCOUNT_CHANGED' });
  assert.deepEqual(await first, { balance: 'fresh' });
});
