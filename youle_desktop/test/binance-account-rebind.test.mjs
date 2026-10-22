import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";
import { binanceBindingErrorMessage } from "../src/shared/binance-account-errors.mjs";
import { translateAppText } from "../src/renderer/app-language.mjs";
import { createBinanceAccountUiState, renderBinanceAccountDialog } from "../src/renderer/binance-account-ui.ts";

const main = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function bindingSync(client) {
  const names = ["sharedBinanceConnectionDeviceId", "activeSharedBinanceConnection", "readSharedBinanceAccountConnections", "syncSharedBinanceAccountCredentials"];
  const code = names.map(name => main.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(main)).join("\n");
  return new Function("getYouleApiClient", `${code};return syncSharedBinanceAccountCredentials;`)(() => client);
}

function client(fetchImpl) {
  const result = new YouleApiClient();
  result.loaded = true;
  result.baseUrl = "https://offline.invalid";
  result.token = "synthetic-session";
  result.mobileBindingDeviceId = "22222222-2222-4222-8222-222222222222";
  result.serviceFetch = fetchImpl;
  return result;
}

test("actual Windows sync can bind, unbind and rebind against a legacy idempotency server", async () => {
  const connections = new Map(), remembered = new Map(), creationKeys = [], calls = [];
  const c = client(async (url, init) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    calls.push([method, path]);
    if (path.endsWith("/devices")) return Response.json({ id: c.mobileBindingDeviceId });
    if (path.endsWith("/account-connections")) {
      if (method === "GET") return Response.json({ items: [...connections.values()].filter(r => !r.revoked) });
      const key = new Headers(init.headers).get("idempotency-key");
      creationKeys.push(key);
      if (remembered.has(key)) return Response.json(remembered.get(key));
      const row = { id: String(connections.size + 1), ...JSON.parse(init.body), credentialsBound: false };
      connections.set(row.id, row); remembered.set(key, structuredClone(row));
      return Response.json(row);
    }
    const id = path.split("/")[5];
    const row = connections.get(id);
    assert.ok(row, path);
    if (method === "DELETE") { row.revoked = true; row.credentialsBound = false; return Response.json({ status: "revoked" }); }
    if (row.revoked) return Response.json({ detail: { code: "CONNECTION_REVOKED" } }, { status: 409 });
    assert.equal(method, "PUT"); row.credentialsBound = true;
    return Response.json(row);
  });
  const sync = bindingSync(c);
  for (let i = 0; i < 3; i++) {
    const bound = await sync({ apiKey: "synthetic-key", apiSecret: "synthetic-secret" });
    assert.equal(bound.id, String(i + 1)); assert.equal(bound.credentialsBound, true);
    await c.deleteAccountConnection(bound.id);
    assert.deepEqual((await c.listAccountConnections()).items, []);
  }
  assert.equal(creationKeys.length, 3);
  assert.equal(new Set(creationKeys).size, 3);
  assert.equal(calls.filter(([method, path]) => method === "POST" && path.endsWith("/devices")).length, 3);
  assert.equal([...connections.values()].filter(r => !r.revoked).length, 0);
});

test("an explicit retry identifier remains stable for retries of the same creation", async () => {
  const keys = [];
  const c = client(async (_url, init) => { keys.push(new Headers(init.headers).get("idempotency-key")); return Response.json({ id: "same" }); });
  await c.createAccountConnection({ idempotencyKey: "one-binding-attempt" });
  await c.createAccountConnection({ idempotencyKey: "one-binding-attempt" });
  assert.deepEqual(keys, ["one-binding-attempt", "one-binding-attempt"]);
});

for (const code of ["CONNECTION_REVOKED", "ACCOUNT_CREDENTIALS_NOT_BOUND", "CONNECTION_LIMIT", "DEVICE_LIMIT", "IDEMPOTENCY_CONFLICT"]) {
  test(`${code} yields actionable text in all three dialog languages`, async () => {
    const c = client(async () => Response.json({ detail: { code } }, { status: 409 }));
    let message;
    await assert.rejects(c.bindAccountConnectionCredentials("connection", { apiKey: "synthetic-key", apiSecret: "synthetic-secret" }), error => {
      message = error.message;
      return error.code === code && message === binanceBindingErrorMessage(code) && error.status === 409 && !error.retryable;
    });
    const ui = createBinanceAccountUiState(); ui.dialog.open = true; ui.dialog.error = message;
    const html = renderBinanceAccountDialog(ui);
    assert.match(html, /role="alert"/); assert.ok(html.includes(message));
    const english = translateAppText(message, "en");
    const traditional = translateAppText(message, "zh-TW");
    assert.doesNotMatch(english, /[\u3400-\u9fff]/);
    assert.notEqual(traditional, message);
    assert.doesNotMatch(message, /^HTTP 409$/);
    assert.equal(translateAppText(message, "zh-CN"), message);
  });
}

test("binding submission runs one shared credential sync after OTP verification", () => {
  let handler;
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(main) === "ipcMain.handle" && n.arguments[0]?.text === "binanceAccount:bind") handler = n.arguments[1].getText(main);
    ts.forEachChild(n, visit);
  }
  visit(main);
  assert.ok(handler);
  assert.doesNotMatch(handler, /syncSharedBinanceAccountConnection\(/);
  assert.equal(handler.match(/syncSharedBinanceAccountCredentials\(/g)?.length, 1);
});
