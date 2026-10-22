import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { sharedSnapshotPosition, sharedSnapshotTime } from "../src/main/binance-account/shared-snapshot.mjs";
import { createBinanceAccountUiState, renderBinanceAccountPage } from "../src/renderer/binance-account-ui.ts";
import { binanceCredentialErrorResult, binanceAccountReadErrorResult } from "../src/shared/binance-account-errors.mjs";

const source = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const normalizer = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "normalizeSharedBinanceSnapshot");
const normalize = new Function("sharedSnapshotPosition", "sharedSnapshotTime", `${normalizer.getText(source)}; return normalizeSharedBinanceSnapshot;`)(sharedSnapshotPosition, sharedSnapshotTime);
let snapshotHandler;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle" && node.arguments[0]?.text === "binanceAccount:getSnapshot") {
    snapshotHandler = node.arguments[1];
  }
  ts.forEachChild(node, visit);
}
visit(source);

const serverSnapshot = () => ({
  fetchedAt: Date.now(), equity: 68.83561522, walletBalance: 68.93081522,
  available: 61.9301, margin: 6.8919, unrealizedPnl: -0.0952, positions: [],
  pnlStatus: "available", realizedPnlToday: 1.25, todayPnl: 1.1548,
  todayPnlPercent: 1.70624461, pnlTimeZone: "Asia/Shanghai",
  pnlDayStart: Date.parse("2026-10-20T16:00:00Z"), pnlAsOf: Date.parse("2026-10-21T06:00:00Z"),
});

function render(snapshot, visible = true) {
  const state = createBinanceAccountUiState();
  state.loaded = true;
  state.status = { bound: true, serverCredentialsBound: true };
  state.snapshot = snapshot;
  state.balancesVisible = visible;
  return renderBinanceAccountPage(state);
}

test("shared binding flows through the API client, actual IPC and account cards", async () => {
  const requests = [];
  const client = new YouleApiClient();
  client.loaded = true;
  client.baseUrl = "https://offline.invalid";
  client.token = "test-session";
  client.serviceFetch = async (url, init) => {
    requests.push({ url: new URL(url), init });
    return new Response(JSON.stringify(serverSnapshot()), { status: 200 });
  };
  const deps = {
    assertExternalModelsIpcSender() {},
    requireBinanceAccountOwner: async () => ({ ownerId: "owner" }),
    readBinanceAccountStatusWithSharedBinding: async () => ({ serverCredentialsBound: true, serverConnectionId: "shared-a" }),
    getYouleApiClient: () => client,
    normalizeSharedBinanceSnapshot: normalize, binanceCredentialErrorResult, binanceAccountReadErrorResult,
    sameBinanceBindingOwner: (a,b) => a.ownerId === b.ownerId,
    console: { info() {} },
  };
  const handle = new Function(...Object.keys(deps), `return (${snapshotHandler.getText(source)});`)(...Object.values(deps));
  for (const options of [{}, { force: true }, { live: true, summary: true }]) {
    const response = await handle({}, options);
    assert.equal(response.ok, true);
    const html = render(response.snapshot);
    assert.match(html, /今日盈亏 <strong class="positive">\+\$1\.15 \(\+1\.71%\)<\/strong>/);
    assert.match(html, /今日已实现盈亏 <strong class="binance-account-realized-value positive">\+\$1\.25<\/strong>/);
    assert.doesNotMatch(html, /暂不可用/);
    assert.equal(response.snapshot.walletBalance, 68.93081522);
    assert.equal(response.snapshot.sources.realizedPnl, "USD_M_INCOME");
  }
  assert.equal(requests.length, 3);
  for (const { url, init } of requests) {
    assert.equal(url.pathname, "/api/mobile/v1/account-connections/shared-a/snapshot");
    assert.equal(url.searchParams.get("pnlTimeZone"), Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(init.method, "GET");
  }
  await client.getAccountConnectionSnapshot("shared-a");
  assert.equal(requests.at(-1).url.search, "", "strategy reads keep their lightweight contract");
});

test("zero, negative, unavailable and hidden balances retain honest card output", () => {
  const zero = normalize({ ...serverSnapshot(), realizedPnlToday: 0, todayPnl: 0, todayPnlPercent: null });
  assert.match(render(zero), /今日盈亏 <strong class="neutral">\$0\.00<\/strong>/);
  assert.match(render(zero), /今日已实现盈亏 <strong class="binance-account-realized-value neutral">\$0\.00<\/strong>/);
  const negative = normalize({ ...serverSnapshot(), realizedPnlToday: -1.25, todayPnl: -1.3452, todayPnlPercent: -1.92 });
  assert.match(render(negative), /今日盈亏 <strong class="negative">-\$1\.35 \(-1\.92%\)<\/strong>/);
  assert.match(render(negative), /今日已实现盈亏 <strong class="binance-account-realized-value negative">-\$1\.25<\/strong>/);
  assert.doesNotMatch(render(negative, false), /1\.25|1\.35|暂不可用/);
  for (const patch of [
    { pnlStatus: undefined }, // Older backend.
    { pnlStatus: "unavailable", pnlReason: "INCOME_HISTORY_UNAVAILABLE" },
    { realizedPnlToday: null }, { realizedPnlToday: "NaN" }, { realizedPnlToday: true },
  ]) {
    const unavailable = normalize({ ...serverSnapshot(), ...patch });
    assert.equal(unavailable.realizedPnlToday, null);
    assert.equal(unavailable.todayPnl, null);
    assert.match(render(unavailable), /今日盈亏 <strong class="muted">—<\/strong>/);
    assert.match(render(unavailable), /今日已实现盈亏 <strong class="binance-account-realized-value neutral">—<\/strong>/);
    assert.equal(unavailable.estimatedTotalAssets, 68.83561522);
  }
});
