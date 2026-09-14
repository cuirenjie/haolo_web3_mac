import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { YouleApiClient, isYouleAuthExpiredError } from "../src/main/youle-api-client.mjs";

function clientFixture(t, handler = () => Response.json({ items: [] })) {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Node direct networking is blocked"); });
  const calls = [];
  const client = new YouleApiClient({ serviceFetch: async (url, init) => {
    calls.push({ url, init });
    assert.equal(Object.hasOwn(init, "fetchImpl"), false, "Internal transport options must not reach Chromium");
    return handler(url, init);
  } });
  client.loaded = true;
  client.token = "test-access-token";
  client.save = async () => {};
  return { client, calls };
}

test("login, recharge history, contacts and consumption use the service transport when Node direct is blocked", async (t) => {
  const { client, calls } = clientFixture(t);
  await client.sendOtp({ identifier: "test@example.com", channel: "email" });
  await client.lookupIdentity({ identifier: "test@example.com", channel: "email" });
  await client.getWechatAuthConfig();
  await client.listWeb3RechargeHistory();
  await client.listContacts();
  await client.getConsumptionRecords();
  assert.deepEqual(calls.map((r) => new URL(r.url).pathname), [
    "/api/auth/otp/send", "/api/auth/identity/lookup", "/api/auth/wechat/config",
    "/api/finance/web3/token-products/orders/history", "/api/contacts", "/api/consumption/me/records",
  ]);
  assert.equal(JSON.parse(calls[0].init.body).identifier, "test@example.com");
  assert.equal(calls[3].init.headers.Authorization, "Bearer test-access-token");
});

test("a custom login base URL also uses the injected service transport", async (t) => {
  const { client, calls } = clientFixture(t);
  await client.sendOtp({ baseUrl: "https://custom.example", identifier: "test@example.com", channel: "email" });
  assert.equal(calls[0].url, "https://custom.example/api/auth/otp/send");
});

test("session refresh uses the same transport and preserves refresh-session semantics", async (t) => {
  const { client, calls } = clientFixture(t, () => Response.json({
    access_token: "new-access-token", expires_in: 7200,
    refresh_token: "new-refresh-token", refresh_expires_in: 86400, session_id: "test-session",
  }));
  client.refreshToken = "old-refresh-token";
  await client.performAccessTokenRefresh();
  assert.equal(calls[0].url, "https://haolo.com/api/auth/refresh");
  assert.equal(JSON.parse(calls[0].init.body).refresh_token, "old-refresh-token");
  assert.equal(client.token, "new-access-token");
});

test("401 auth refresh keeps the injected transport on the retried request", async (t) => {
  let attempt = 0;
  const { client, calls } = clientFixture(t, () => ++attempt === 1
    ? Response.json({ message: "expired" }, { status: 401 })
    : Response.json({ items: [] }));
  client.refreshAccessToken = async ({ force }) => {
    if (force) client.token = "renewed-access-token";
    return client.token;
  };
  await client.listWeb3RechargeHistory();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer renewed-access-token");
});

test("binary exports and channel event streams use service networking without buffering streams", async (t) => {
  const xlsx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
  const { client, calls } = clientFixture(t, (url) => new URL(url).pathname.endsWith("/export")
    ? new Response(xlsx, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })
    : new Response("data: test\n\n", { headers: { "content-type": "text/event-stream" } }));
  const result = await client.exportConsumptionReport();
  assert.deepEqual([...result.bytes], [...xlsx]);
  const stream = await client.openChannelEventStream({ lastEventId: "test-event" });
  assert.equal(new TextDecoder().decode((await stream.reader.read()).value), "data: test\n\n");
  assert.equal(calls[1].init.headers["Last-Event-ID"], "test-event");
  stream.controller.abort();
  assert.equal(calls[1].init.signal.aborted, true);
});

test("Chromium connection errors preserve structured diagnostics and do not expire the session", async (t) => {
  const { client } = clientFixture(t, () => { throw new Error("net::ERR_CONNECTION_RESET"); });
  for (const run of [() => client.listWeb3RechargeHistory(), () => client.exportConsumptionReport()]) {
    await assert.rejects(run(), (error) => {
      assert.equal(error.code, "ERR_CONNECTION_RESET");
      assert.equal(error.category, "transport");
      assert.equal(isYouleAuthExpiredError(error), false);
      return true;
    });
  }
  assert.equal(client.token, "test-access-token");
});

test("main wires account APIs and updater checks to the same service transport", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(source, /new YouleApiClient\(\{[^}]*serviceFetch: haoloServiceFetch/);
  const updater = source.slice(source.indexOf("async function checkAppUpdate("), source.indexOf("async function downloadAppUpdate("));
  assert.match(updater, /fetchServiceJson\(haoloServiceFetch, url\.toString\(\)/);
  assert.match(source, /session\.fromPartition\("haolo-service-network", \{ cache: false \}\)/);
});

test("Chromium ERR_ABORTED from an elapsed API deadline is reported as a timeout", async (t) => {
  const { client } = clientFixture(t, (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("net::ERR_ABORTED")), { once: true });
  }));
  await assert.rejects(client.requestJson("https://haolo.com/api/profile/me", { timeoutMs: 5 }), { code: "REQUEST_TIMEOUT", category: "timeout" });
});

test("binary caller cancellation reaches the network and remains distinct from a timeout", async (t) => {
  const { client } = clientFixture(t, (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("net::ERR_ABORTED")), { once: true });
  }));
  const controller = new AbortController();
  const request = client.requestBinary("https://haolo.com/api/consumption/me/export", { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { code: "REQUEST_CANCELLED", category: "cancelled" });
});
