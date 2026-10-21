import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";
import { BINANCE_REBIND_MESSAGE, binanceCredentialErrorResult, binanceAccountReadErrorResult, isBinanceCredentialError } from "../src/shared/binance-account-errors.mjs";
import { createBinanceAccountUiState, resetBinanceAccountDialog, renderBinanceAccountPage, renderBinanceAccountDialog } from "../src/renderer/binance-account-ui.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";
import { loadSharedAccountDetails } from "../src/renderer/binance-account-details.ts";

function source(file) {
  return ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
}
const renderer = source("../src/renderer/main.ts");
const main = source("../src/main/main.mjs");
const preload = source("../src/main/preload.mjs");
function functionText(file, name) {
  const node = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name);
  return ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function ipcHandler(channel, deps) {
  let callback;
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(main) === "ipcMain.handle" && n.arguments[0]?.text === channel) callback = n.arguments[1];
    ts.forEachChild(n, visit);
  }
  visit(main);
  assert.ok(callback, channel);
  return new Function(...Object.keys(deps), `return (${callback.getText(main)});`)(...Object.values(deps));
}
const invalidKey = () => Object.assign(new Error(BINANCE_REBIND_MESSAGE), { code: "BINANCE_CREDENTIALS_INVALID", retryable: false });
const snapshot = () => ({ fetchedAt: "2026-10-18T14:00:00Z", currency: "USDT", positions: [], warnings: [] });

test("code-only backend 422 survives API client, actual main handler and preload", async () => {
  const client = new YouleApiClient({ baseUrl: "https://offline.invalid" });
  client.loaded = true;
  client.baseUrl = "https://offline.invalid";
  client.token = "offline-token";
  client.serviceFetch = async () => new Response(JSON.stringify({ detail: { code: "BINANCE_CREDENTIALS_INVALID" } }), { status: 422 });
  let serverError;
  await assert.rejects(client.getAccountConnectionSnapshot("connection"), e => {
    serverError = e;
    return e.code === "BINANCE_CREDENTIALS_INVALID" && e.message === BINANCE_REBIND_MESSAGE && e.retryable === false;
  });
  const handler = ipcHandler("binanceAccount:getSnapshot", {
    assertExternalModelsIpcSender() {}, requireBinanceAccountOwner: async () => ({ ownerId: "owner" }),
    readBinanceAccountStatusWithSharedBinding: async () => ({ serverCredentialsBound: true, serverConnectionId: "connection" }),
    getYouleApiClient: () => ({ getAccountConnectionSnapshot: async () => { throw serverError; } }),
    normalizeSharedBinanceSnapshot: s => s, binanceCredentialErrorResult, binanceAccountReadErrorResult, sameBinanceBindingOwner: () => true, console: { info() {} },
  });
  const envelope = await handler({});
  assert.deepEqual(envelope, binanceCredentialErrorResult(serverError));
  const invoke = new Function("ipcRenderer", `${functionText(preload, "invokeBinanceAccountSnapshot")}; return invokeBinanceAccountSnapshot;`)({ invoke: async () => envelope });
  await assert.rejects(invoke(), e => e.code === "BINANCE_CREDENTIALS_INVALID" && e.message === BINANCE_REBIND_MESSAGE && !e.retryable);
  assert.equal(binanceCredentialErrorResult({ code: "BINANCE_UNAVAILABLE", status: 502 }), null);
});

test("direct/private-tunnel Binance -2008 rejects a rebind before replacing credentials", async () => {
  let writes = 0;
  const service = new BinanceAccountService({
    credentialStore: { upsert: async () => { writes++; } },
    fetch: async url => new Response(JSON.stringify(String(url).includes("/time")
      ? { serverTime: Date.now() } : { code: -2008, msg: "Invalid Api-Key ID." }), { status: String(url).includes("/time") ? 200 : 400 }),
  });
  await assert.rejects(service.bind("owner", { apiKey: "offline-api-key", apiSecret: "offline-secret" }), e => e.code === "BINANCE_CREDENTIALS_INVALID" && e.message === BINANCE_REBIND_MESSAGE && !e.retryable);
  assert.equal(writes, 0);
});

test("main rebind verifies OTP and shared credentials before the local save, preserving old key on failure", async () => {
  for (const failShared of [false, true]) {
    const events = [];
    const accountService = new BinanceAccountService({ credentialStore: { upsert: async () => { events.push("local-save"); return { bound: true }; } } });
    accountService.snapshotWithCredentials = async () => snapshot();
    const handler = ipcHandler("binanceAccount:bind", {
      assertExternalModelsIpcSender() {}, firstString: (...v) => v.find(x => typeof x === "string" && x),
      requireBinanceAccountOwner: async () => ({ ownerId: "owner", accountId: "owner", email: "offline@example.test" }),
      getBinanceAccountService: () => accountService,
      getYouleApiClient: () => ({ verifyOtp: async () => { events.push("otp"); return { authenticated: true }; } }),
      sameBinanceBindingOwner: () => true, clearVoiceCredentialCache() {}, restartClientAfterAuthChange: async () => {},
      syncSharedBinanceAccountConnection: async () => {},
      syncSharedBinanceAccountCredentials: async () => { events.push("shared-save"); if (failShared) throw invalidKey(); },
    });
    const result = handler({}, { challengeId: "challenge", code: "123456", apiKey: "offline-api-key", apiSecret: "offline-secret" });
    if (failShared) await assert.rejects(result, isBinanceCredentialError);
    else assert.equal((await result).status.bound, true);
    assert.deepEqual(events, failShared ? ["otp", "shared-save"] : ["otp", "shared-save", "local-save"]);
  }
});

function harness() {
  const state = { activeView: "account", binanceAccount: createBinanceAccountUiState() };
  const stats = { snapshots: 0, binds: [], renders: 0, scheduled: 0 };
  const deps = {
    state, BINANCE_REBIND_MESSAGE, isBinanceCredentialError, resetBinanceAccountDialog, createBinanceAccountUiState, loadSharedAccountDetails,
    api: {
      getBinanceAccountStatus: async () => ({ bound: true, serverCredentialsBound: true }),
      getBinanceAccountSnapshot: async () => { stats.snapshots++; throw invalidKey(); },
      bindBinanceAccount: async params => { stats.binds.push(params); return { status: { bound: true }, snapshot: snapshot() }; },
    },
    render: () => { stats.renders++; }, renderBinanceAccountLiveUpdate: () => { stats.renders++; },
    syncTradingExpertOrderLineSnapshot() {}, reconcileExecutionPlansWithBinanceSnapshot: async () => {},
    stopBinanceAccountLiveRefresh() {}, stopBinanceAccountOtpCountdown() {}, startBinanceAccountOtpCountdown() {},
    sendBinanceAccountOtp: async () => {}, showToast() {}, errorMessage: e => e.message,
    binanceAccountReadOnlyDataVisible: () => true, executionPlanBinanceMonitoringNeeded: () => false,
    binanceAccountLiveRefreshInterval: () => 5000, binanceAccountRetryDelay: () => 1000,
    document: { hidden: false }, console: { warn() {} },
    window: { setTimeout: () => { stats.scheduled++; return 1; } },
    BINANCE_ACCOUNT_AUTO_REFRESH_INTERVAL_MS: 60000, BINANCE_ACCOUNT_AUTO_RETRY_INTERVAL_MS: 1000,
    BINANCE_ACCOUNT_LIVE_RETRY_MAX_INTERVAL_MS: 60000, BINANCE_ACCOUNT_LIVE_RETRY_BASE_INTERVAL_MS: 1000,
  };
  const names = ["loadBinanceAccountDetails", "loadBinanceAccountPage", "loadBinanceAccountProfitCalendar", "refreshBinanceAccountSnapshot", "silentlyRefreshBinanceAccountSnapshot", "progressivelyRefreshBinanceAccountSnapshot", "handleBinanceCredentialFailure", "openBinanceAccountDialog", "submitBinanceAccountBinding", "scheduleBinanceAccountLiveRefresh"];
  const code = names.map(name => functionText(renderer, name)).join("\n");
  const fns = new Function(...Object.keys(deps), `
    let binanceAccountLoadSequence=0, binanceAccountSnapshotApplySequence=0, binanceAccountProfitCalendarLoadSequence=0;
    let binanceAccountFullRefreshAfter=0, binanceAccountLiveRefreshFailures=0, binanceAccountLiveRetryAfter=0, binanceAccountLiveRefreshTimer=null;
    let binanceAccountLoadPromise=null, binanceAccountLiveRefreshPromise=null, binanceAccountProgressiveRefreshPromise=null;
    ${code}
    return {${names.join(",")}};
  `)(...Object.values(deps));
  return { state, stats, ...fns };
}

test("initial, manual, silent and progressive failures offer rebind and stop retrying invalid credentials", async () => {
  for (const kind of ["initial", "manual", "silent", "progressive"]) {
    const h = harness();
    const a = h.state.binanceAccount;
    if (kind !== "initial") {
      a.status = { bound: true }; a.loaded = true; a.snapshot = snapshot(); a.profitCalendar = { month: "2026-10" };
    }
    if (kind === "initial") await h.loadBinanceAccountPage();
    if (kind === "manual") await h.refreshBinanceAccountSnapshot();
    if (kind === "silent") await h.silentlyRefreshBinanceAccountSnapshot();
    if (kind === "progressive") await h.progressivelyRefreshBinanceAccountSnapshot(a, 0, 0, true);
    assert.equal(a.rebindRequired, true, kind);
    assert.equal(a.error, BINANCE_REBIND_MESSAGE);
    assert.equal(a.snapshot, null);
    assert.equal(a.profitCalendar, null);
    assert.match(renderBinanceAccountPage(a), /data-binance-account-action="rebind"/);
    const calls = h.stats.snapshots;
    await h.loadBinanceAccountPage(); await h.silentlyRefreshBinanceAccountSnapshot(); h.scheduleBinanceAccountLiveRefresh();
    assert.equal(h.stats.snapshots, calls);
    assert.equal(h.stats.scheduled, 0);
  }
});

test("rebind opens secure form, submits new key and OTP, clears old history and resumes account display", async () => {
  const h = harness();
  await h.loadBinanceAccountPage();
  h.openBinanceAccountDialog(true);
  const a = h.state.binanceAccount;
  assert.equal(a.dialog.mode, "rebind");
  assert.match(renderBinanceAccountDialog(a), /重新绑定 Binance API/);
  assert.equal(a.dialog.apiSecret, "");
  Object.assign(a.dialog, { apiKey: "new-offline-key", apiSecret: "new-offline-secret", challengeId: "challenge", code: "123456" });
  await h.submitBinanceAccountBinding();
  assert.deepEqual(h.stats.binds, [{ apiKey: "new-offline-key", apiSecret: "new-offline-secret", challengeId: "challenge", code: "123456" }]);
  assert.equal(a.rebindRequired, false);
  assert.equal(a.loaded, true);
  assert.equal(a.error, null);
  assert.equal(a.dialog.open, false);
  assert.equal(a.dialog.apiSecret, "");
  assert.equal(a.profitCalendar, null);
  assert.equal(h.stats.scheduled, 1);
});

test("generic 502 stays retryable UI and all recovery copy has three locales", () => {
  const h = harness();
  assert.equal(h.handleBinanceCredentialFailure({ code: "BINANCE_UNAVAILABLE" }, h.state.binanceAccount), false);
  h.state.binanceAccount.error = "HTTP 502";
  assert.doesNotMatch(renderBinanceAccountPage(h.state.binanceAccount), /data-binance-account-action="rebind"/);
  for (const [locale, message, button] of [["zh-CN", BINANCE_REBIND_MESSAGE, "重新绑定"], ["en", "Invalid API Key. Please reconnect your account.", "Reconnect"], ["zh-TW", "API Key 無效，請重新綁定", "重新綁定"]]) {
    assert.equal(translateAppText(BINANCE_REBIND_MESSAGE, locale), message);
    assert.equal(translateAppText("重新绑定", locale), button);
  }
});
