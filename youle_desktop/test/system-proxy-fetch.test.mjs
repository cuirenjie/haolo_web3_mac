import assert from "node:assert/strict";
import test from "node:test";
import { createSystemProxyFetch, networkErrorCode } from "../src/main/system-proxy-fetch.mjs";

const reset = () => new Error("net::ERR_CONNECTION_RESET");
function fixture(fetchImpl, overrides = {}) {
  const calls = { configurations: [], refreshes: 0, requests: [], diagnostics: [] };
  const ses = {
    setProxy: async (config) => { calls.configurations.push(config); },
    forceReloadProxyConfig: async () => { calls.refreshes++; },
    fetch: async (...args) => { calls.requests.push(args); return fetchImpl(...args); },
    closeAllConnections: () => assert.fail("Must not close in-flight streams"),
    ...overrides,
  };
  return { calls, fetch: createSystemProxyFetch({ getSession: () => ses, onDiagnostic: (entry) => calls.diagnostics.push(entry), configurationTimeoutMs: 30 }) };
}

test("uses one system/PAC session and preserves auth, bytes and caller cancellation", async () => {
  const f = fixture(async () => new Response("ok"));
  const init = { method: "POST", body: "payload", headers: { Authorization: "Bearer test-token" }, signal: new AbortController().signal };
  await f.fetch("https://haolo.com/api/test", init);
  await f.fetch("https://haolo.com/api/test");
  assert.deepEqual(f.calls.configurations, [{ mode: "system" }]);
  assert.equal(f.calls.requests[0][1], init);
  assert.equal(f.calls.refreshes, 0);
});

test("reloads stale proxy configuration once and recovers a GET", async () => {
  let attempts = 0;
  const f = fixture(async () => { if (!attempts++) throw reset(); return new Response("recovered"); });
  assert.equal(await (await f.fetch("https://haolo.com/api/auth/config")).text(), "recovered");
  assert.equal(f.calls.refreshes, 1);
  assert.equal(f.calls.requests.length, 2);
});

test("persistent proxy failure has bounded retries and never falls back to Node/direct", async () => {
  const f = fixture(async () => { throw new Error("net::ERR_PROXY_CONNECTION_FAILED"); });
  await assert.rejects(f.fetch("https://haolo.com/api/test"), /ERR_PROXY_CONNECTION_FAILED/);
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.calls.refreshes, 1);
  await assert.rejects(f.fetch("https://haolo.com/api/test"));
  assert.equal(f.calls.requests.length, 3);
});

for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  test(`${method} network failure refreshes configuration without duplicating the operation`, async () => {
    const f = fixture(async () => { throw reset(); });
    await assert.rejects(f.fetch("https://haolo.com/api/finance/orders", { method, body: "{}" }));
    assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.refreshes, 1);
  });
}

test("concurrent failures share a proxy reload", async () => {
  let refreshed = false;
  let release;
  let refreshes = 0;
  const barrier = new Promise((resolve) => { release = resolve; });
  const f = fixture(async () => { if (!refreshed) throw reset(); return new Response("ok"); }, {
    forceReloadProxyConfig: async () => { refreshes++; await barrier; refreshed = true; },
  });
  const requests = Array.from({ length: 8 }, () => f.fetch("https://haolo.com/api/test"));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all(requests);
  assert.equal(refreshes, 1);
  assert.equal(f.calls.requests.length, 16);
});

test("HTTP business errors and TLS trust errors are never retried", async () => {
  for (const status of [401, 403, 429, 500]) {
    const f = fixture(async () => new Response("business error", { status }));
    assert.equal((await f.fetch("https://haolo.com/api/test")).status, status);
    assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.refreshes, 0);
  }
  const f = fixture(async () => { throw new Error("net::ERR_CERT_AUTHORITY_INVALID"); });
  await assert.rejects(f.fetch("https://haolo.com/api/test"), /ERR_CERT_AUTHORITY_INVALID/);
  assert.equal(f.calls.requests.length, 1);
  assert.equal(f.calls.refreshes, 0);
});

test("cancellation during proxy refresh does not start another request", async () => {
  let release;
  const f = fixture(async () => { throw reset(); }, { forceReloadProxyConfig: () => new Promise((resolve) => { release = resolve; }) });
  const controller = new AbortController();
  const result = f.fetch("https://haolo.com/api/test", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  release();
  assert.equal(f.calls.requests.length, 1);
});

test("proxy refresh timeout preserves the network error without an infinite wait", async () => {
  const f = fixture(async () => { throw reset(); }, { forceReloadProxyConfig: () => new Promise(() => {}) });
  await assert.rejects(f.fetch("https://haolo.com/api/test"), /ERR_CONNECTION_RESET/);
  assert.equal(f.calls.requests.length, 1);
});

test("diagnostics omit request paths, query strings, credentials and raw messages", async () => {
  const f = fixture(async () => { throw new Error("net::ERR_CONNECTION_RESET private-detail"); });
  await assert.rejects(f.fetch("https://haolo.com/api/private-user-id?token=secret-query", { headers: { Authorization: "Bearer secret-auth" } }));
  const text = JSON.stringify(f.calls.diagnostics);
  assert.match(text, /ERR_CONNECTION_RESET/);
  assert.doesNotMatch(text, /private-detail|private-user-id|secret-query|secret-auth/);
  assert.equal(networkErrorCode(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })), "ECONNRESET");
});
