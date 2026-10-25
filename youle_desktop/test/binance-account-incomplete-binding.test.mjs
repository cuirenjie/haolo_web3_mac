import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";
import { binanceBindingErrorMessage } from "../src/shared/binance-account-errors.mjs";
import { createBinanceAccountUiState, renderBinanceAccountPage, resetBinanceAccountDialog } from "../src/renderer/binance-account-ui.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";

function functions(file, names) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  return names.map(name => ts.transpileModule(source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText).join("\n");
}
const names = ["sharedBinanceConnectionDeviceId", "activeSharedBinanceConnection", "readSharedBinanceAccountConnections", "syncSharedBinanceAccountCredentials", "readBinanceAccountStatusWithSharedBinding"];
const mainFunctions = functions("../src/main/main.mjs", names);

function harness({ initial = [], cleanup = "ok", failure = true } = {}) {
  const rows = initial.map(row => ({ venue: "binance", marketType: "usdm", ...row }));
  const requests = [], warnings = [];
  let local = { bound: false, secureStorageAvailable: true }, saves = 0, sequence = 0;
  const api = new YouleApiClient();
  api.loaded = true; api.baseUrl = "https://offline.invalid"; api.token = "synthetic-session";
  api.mobileBindingDeviceId = "22222222-2222-4222-8222-222222222222";
  const h = { rows, requests, warnings, failure, api };
  api.serviceFetch = async (url, init = {}) => {
    const path = new URL(url).pathname, method = init.method || "GET";
    requests.push([method, path]);
    if (path.endsWith("/devices")) return Response.json({ id: api.mobileBindingDeviceId });
    if (path.endsWith("/account-connections")) {
      if (method === "GET") return Response.json({ items: rows.filter(row => !row.revoked) });
      const row = { id: `new-${++sequence}`, ...JSON.parse(init.body), credentialsBound: false };
      rows.push(row); return Response.json(row);
    }
    const row = rows.find(row => row.id === path.split("/")[5]);
    assert.ok(row, path);
    if (path.endsWith("/pending-binding")) {
      assert.equal(method, "DELETE");
      if (cleanup === "unavailable") return Response.json({ detail: "Not Found" }, { status: 404 });
      if (cleanup === "concurrent-bind") row.credentialsBound = true;
      if (row.credentialsBound) return Response.json({ status: "retained" });
      row.revoked = true; return Response.json({ status: "revoked" });
    }
    assert.equal(method, "PUT"); assert.ok(path.endsWith("/credentials"));
    if (h.failure) return Response.json({ detail: { code: "READ_ONLY_KEY_REQUIRED" } }, { status: 422 });
    row.credentialsBound = true; return Response.json(row);
  };
  const service = new BinanceAccountService({ credentialStore: {
    status: async () => local,
    upsert: async () => { saves++; local = { ...local, bound: true }; return local; },
    remove: async () => { local = { ...local, bound: false }; return local; },
  } });
  service.snapshotWithCredentials = async () => ({ positions: [] });
  Object.assign(h, new Function("getYouleApiClient", "getBinanceAccountService", "maskedEmail", "console", `${mainFunctions};return {${names.join(",")}};`)(
    () => api, () => service, () => "masked", { warn: (...args) => warnings.push(args) },
  ));
  h.bind = () => service.bind("owner", { apiKey: "synthetic-key", apiSecret: "synthetic-secret" }, {
    beforeSave: () => h.syncSharedBinanceAccountCredentials({ apiKey: "synthetic-key", apiSecret: "synthetic-secret" }),
  });
  h.status = () => h.readBinanceAccountStatusWithSharedBinding({ ownerId: "owner", email: "masked" });
  h.saves = () => saves;
  return h;
}

test("first 422 discards the new empty connection, leaves no local key, and allows a successful retry", async () => {
  const h = harness();
  await assert.rejects(h.bind(), e => e.code === "READ_ONLY_KEY_REQUIRED" && e.status === 422 && e.message === binanceBindingErrorMessage(e.code));
  assert.equal(h.saves(), 0); assert.equal(h.rows[0].revoked, true);
  assert.equal((await h.status()).bound, false);
  assert.equal((await h.status()).bindingIncomplete, false);
  h.failure = false;
  await h.bind();
  assert.equal(h.saves(), 1); assert.equal(h.rows.length, 2);
  const status = await h.status();
  assert.equal(status.bound, true); assert.equal(status.serverCredentialsBound, true);
});

test("an older/unavailable cleanup endpoint preserves the permission error and exposes recovery after reload", async () => {
  const h = harness({ cleanup: "unavailable" });
  await assert.rejects(h.bind(), e => e.code === "READ_ONLY_KEY_REQUIRED");
  const status = await h.status();
  assert.equal(status.bound, false); assert.equal(status.remoteBound, false);
  assert.equal(status.bindingIncomplete, true); assert.equal(h.saves(), 0);
  const state = createBinanceAccountUiState(); state.loaded = true; state.status = status;
  const html = renderBinanceAccountPage(state);
  assert.match(html, /账户绑定未完成/); assert.match(html, /data-binance-account-action="rebind"/);
  assert.doesNotMatch(html, /当前绑定设备不在 Windows|账户已绑定/);
  assert.equal(h.requests.filter(([method, path]) => method === "DELETE" && !path.endsWith("/pending-binding")).length, 0);
  assert.doesNotMatch(JSON.stringify(h.warnings), /synthetic-key|synthetic-secret/);
  h.failure = false; await h.bind();
  assert.equal(h.rows.length, 1); assert.equal((await h.status()).bound, true);
});

test("cleanup retains a concurrent successful bind and status prefers credentials over empty metadata", async () => {
  const h = harness({ cleanup: "concurrent-bind" });
  await assert.rejects(h.bind(), e => e.code === "READ_ONLY_KEY_REQUIRED");
  assert.equal(h.rows[0].revoked, undefined);
  const status = await h.status();
  assert.equal(status.bound, true); assert.equal(status.serverCredentialsBound, true);
  assert.equal(status.bindingIncomplete, false); assert.equal(h.saves(), 0);
});

test("rebind failure preserves an existing shared key even when newer empty records sort first", async () => {
  const h = harness({ initial: [
    { id: "pending", deviceId: "22222222-2222-4222-8222-222222222222", credentialsBound: false },
    { id: "working", deviceId: "phone", credentialsBound: true },
  ] });
  await assert.rejects(h.bind(), e => e.code === "READ_ONLY_KEY_REQUIRED");
  assert.ok(h.requests.some(([method, path]) => method === "PUT" && path.endsWith("/pending/credentials")));
  assert.equal(h.requests.filter(([method]) => method === "DELETE").length, 0);
  assert.equal(h.rows[1].credentialsBound, true);
  const status = await h.status();
  assert.equal(status.connectionId, "working"); assert.equal(status.bindingIncomplete, false);
});

test("only empty records are incomplete; a truly empty account and a shared bound account remain distinct", async () => {
  const empty = await harness().status();
  assert.equal(empty.bound, false); assert.equal(empty.bindingIncomplete, false);
  const pending = await harness({ initial: [{ id: "old-attempt", credentialsBound: false }] }).status();
  assert.equal(pending.bound, false); assert.equal(pending.bindingIncomplete, true);
  const bound = await harness({ initial: [{ id: "phone", credentialsBound: true }] }).status();
  assert.equal(bound.bound, true); assert.equal(bound.remoteOnly, true); assert.equal(bound.bindingIncomplete, false);
});

test("recovery after a device change creates an owned connection and leaves other device metadata untouched", async () => {
  const h = harness({ initial: [{ id: "old-attempt", deviceId: "previous-device", credentialsBound: false }], failure: false });
  await h.bind();
  assert.equal(h.rows.length, 2);
  assert.equal(h.rows[0].credentialsBound, false);
  assert.equal(h.rows[1].deviceId, h.api.mobileBindingDeviceId);
  assert.equal((await h.status()).connectionId, "new-1");
  assert.equal((await h.status()).serverCredentialsBound, true);
});

test("the recovery button uses the real event handler and opens the OTP rebind dialog", () => {
  const state = { binanceAccount: createBinanceAccountUiState() }; let otp = 0, click;
  const code = functions("../src/renderer/main.ts", ["bindBinanceAccountEvents", "openBinanceAccountDialog"]);
  const bindEvents = new Function("state", "resetBinanceAccountDialog", "render", "sendBinanceAccountOtp", `${code};return bindBinanceAccountEvents;`)(
    state, resetBinanceAccountDialog, () => {}, async () => { otp++; },
  );
  const element = { dataset: { binanceAccountAction: "rebind" }, addEventListener: (_event, callback) => { click = callback; } };
  bindEvents({ querySelector: () => null, querySelectorAll: selector => selector === "[data-binance-account-action]" ? [element] : [] });
  click({ preventDefault() {} });
  assert.equal(state.binanceAccount.dialog.open, true); assert.equal(state.binanceAccount.dialog.mode, "rebind"); assert.equal(otp, 1);
});

test("permission and incomplete-binding copy translate in all three languages and respect unavailable storage", () => {
  for (const text of [binanceBindingErrorMessage("READ_ONLY_KEY_REQUIRED"), "账户绑定未完成", "尚未保存可用的 API 密钥，请重新绑定只读 API。", "重新绑定"]) {
    assert.equal(translateAppText(text, "zh-CN"), text);
    assert.doesNotMatch(translateAppText(text, "en"), /[\u3400-\u9fff]/);
    assert.notEqual(translateAppText(text, "zh-TW"), text);
  }
  const state = createBinanceAccountUiState(); state.loaded = true;
  state.status = { bound: false, bindingIncomplete: true, secureStorageAvailable: false };
  assert.match(renderBinanceAccountPage(state), /data-binance-account-action="rebind" disabled/);
});
