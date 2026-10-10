import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "main.mjs",
  readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const functionNames = [
  "sharedBinanceConnectionDeviceId",
  "activeSharedBinanceConnection",
  "readSharedBinanceAccountConnections",
  "syncSharedBinanceAccountConnection",
  "syncSharedBinanceAccountCredentials",
  "removeSharedBinanceAccountConnection",
];
const functions = functionNames.map((name) => {
  const node = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `missing ${name}`);
  return node.getText(source);
}).join("\n");

function harness(initialItems) {
  const calls = [];
  let items = initialItems.map((item) => ({ ...item }));
  const api = {
    mobileBindingDeviceId: "windows-device",
    async load() { calls.push(["load"]); },
    async registerMobileDevice(params) { calls.push(["register", params]); },
    async listAccountConnections() { calls.push(["list"]); return { items }; },
    async createAccountConnection(params) {
      calls.push(["create", params]);
      const created = { id: "windows-created", deviceId: params.deviceId, venue: "binance", marketType: "usdm" };
      items = [...items, created];
      return created;
    },
    async bindAccountConnectionCredentials(id, credentials) {
      calls.push(["bind", id, credentials]);
      return { id };
    },
    async deleteAccountConnection(id) {
      calls.push(["delete", id]);
      items = items.filter((item) => item.id !== id);
      return { status: "revoked" };
    },
  };
  const getClient = () => api;
  const run = new Function("getYouleApiClient", `${functions}\nreturn { syncSharedBinanceAccountConnection, syncSharedBinanceAccountCredentials, removeSharedBinanceAccountConnection };`)(getClient);
  return { calls, run };
}

const mobile = { id: "connection-mobile", deviceId: "mobile-device", venue: "binance", marketType: "usdm" };
const windows = { id: "connection-windows", deviceId: "windows-device", venue: "binance", marketType: "usdm" };

test("shared Binance lifecycle keeps credentials and unbind scoped to Windows", async () => {
  const onlyMobile = harness([mobile]);
  const created = await onlyMobile.run.syncSharedBinanceAccountConnection();
  assert.equal(created.id, "windows-created");
  assert.equal(onlyMobile.calls.filter(([kind]) => kind === "create").length, 1);
  await onlyMobile.run.syncSharedBinanceAccountCredentials({ apiKey: "key", apiSecret: "secret" });
  assert.deepEqual(onlyMobile.calls.at(-1), ["bind", "windows-created", { apiKey: "key", apiSecret: "secret" }]);

  const multiDevice = harness([mobile, windows]);
  await multiDevice.run.removeSharedBinanceAccountConnection();
  assert.deepEqual(multiDevice.calls.at(-1), ["delete", "connection-windows"]);
  assert.equal(multiDevice.calls.some(([kind, id]) => kind === "delete" && id === "connection-mobile"), false);
});
