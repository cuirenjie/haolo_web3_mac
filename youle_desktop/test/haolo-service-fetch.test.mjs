import assert from "node:assert/strict";
import test from "node:test";
import { createHaoloServiceFetch, fetchServiceJson } from "../src/main/haolo-service-fetch.mjs";

const main = "https://haolo.com";
const alternate = "https://www.haolo.com";
const reset = () => new Error("net::ERR_CONNECTION_RESET");
const config = () => Response.json({ enabled_channels: ["email"], default_channel: "email" });
function setup(implementation, options = {}) {
  const requests = [];
  const fetch = createHaoloServiceFetch({
    fetchImpl: async (url, init) => { requests.push({ url, init }); return implementation(url, init); },
    ...options,
  });
  return { fetch, requests };
}

test("healthy direct access stays on the canonical host and shares a route probe", async () => {
  const f = setup(async (url) => url.endsWith("/api/auth/config") ? config() : new Response("ok"));
  await Promise.all([f.fetch(`${main}/api/profile/me`), f.fetch(`${main}/api/contacts`)]);
  assert.equal(f.requests.filter((r) => r.url.endsWith("/api/auth/config")).length, 1);
  assert.ok(f.requests.every((r) => r.url.startsWith(main)));
});

test("blocked primary uses the verified direct alias with the original path and auth", async () => {
  const f = setup(async (url) => { if (url.startsWith(main)) throw reset(); return url.endsWith("/api/auth/config") ? config() : new Response("ok"); });
  const init = { headers: { Authorization: "Bearer test" } };
  await f.fetch(`${main}/api/finance/history?limit=50`, init);
  assert.equal(f.requests.at(-1).url, `${alternate}/api/finance/history?limit=50`);
  assert.equal(f.requests.at(-1).init, init);
  for (const request of f.requests.slice(0, -1)) {
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.credentials, "omit");
    assert.equal(request.init.headers.Authorization, undefined);
    assert.equal(request.init.redirect, "error");
  }
});

test("OTP and payment writes select a reachable route before sending exactly once", async () => {
  for (const path of ["/api/auth/otp/send", "/api/finance/web3/token-products/orders"]) {
    const f = setup(async (url) => { if (url.startsWith(main)) throw reset(); return url.endsWith("/api/auth/config") ? config() : new Response("accepted"); });
    await f.fetch(`${main}${path}`, { method: "POST", headers: { Authorization: "Bearer test" }, body: "{}" });
    const writes = f.requests.filter((r) => r.init.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, `${alternate}${path}`);
  }
});

test("a reset after accepting a write never replays it on another origin", async () => {
  const f = setup(async (url) => { if (url.endsWith("/api/auth/config")) return config(); throw reset(); });
  await assert.rejects(f.fetch(`${main}/api/finance/orders`, { method: "POST", body: "{}" }), /ERR_CONNECTION_RESET/);
  assert.equal(f.requests.filter((r) => r.init.method === "POST").length, 1);
  assert.ok(f.requests.every((r) => r.url.startsWith(main)));
});

test("cached GET route failure can recover on another verified origin", async () => {
  let blocked = false;
  const f = setup(async (url) => { if (blocked && url.startsWith(main)) throw reset(); return url.endsWith("/api/auth/config") ? config() : new Response("ok"); });
  await f.fetch(`${main}/api/contacts`);
  blocked = true;
  await f.fetch(`${main}/api/profile/me`);
  assert.equal(f.requests.at(-1).url, `${alternate}/api/profile/me`);
});

test("route expiry rechecks the canonical host even during continuous traffic", async () => {
  let clock = 0;
  let blocked = true;
  const f = setup(async (url) => { if (blocked && url.startsWith(main)) throw reset(); return url.endsWith("/api/auth/config") ? config() : new Response("ok"); }, { now: () => clock, routeTtlMs: 100 });
  await f.fetch(`${main}/api/profile/me`);
  clock = 90;
  await f.fetch(`${main}/api/profile/me`);
  blocked = false;
  clock = 110;
  await f.fetch(`${main}/api/profile/me`);
  assert.equal(f.requests.at(-1).url, `${main}/api/profile/me`);
});

test("a probe timeout can move to the alternate within its own deadline", async () => {
  const f = setup((url, init) => {
    if (url.startsWith(main)) return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("net::ERR_ABORTED")), { once: true }));
    return Promise.resolve(url.endsWith("/api/auth/config") ? config() : new Response("ok"));
  }, { probeTimeoutMs: 10 });
  assert.equal(await (await f.fetch(`${main}/api/profile/me`)).text(), "ok");
});

test("custom servers, model traffic and downloads are not rewritten or probed", async () => {
  const f = setup(async () => new Response("ok"));
  for (const url of ["http://localhost:8000/api/test", "https://custom.example/api/test", "https://haolo.pro/v1/models", `${main}/v1/models`, "https://download.haolo.com/setup.exe"]) {
    await f.fetch(url);
    assert.equal(f.requests.at(-1).url, url);
  }
  assert.equal(f.requests.length, 5);
});

test("business 401/429/500 responses do not trigger origin failover", async () => {
  for (const status of [401, 429, 500]) {
    const f = setup(async (url) => url.endsWith("/api/auth/config") ? config() : new Response("error", { status }));
    assert.equal((await f.fetch(`${main}/api/profile/me`)).status, status);
    assert.equal(f.requests.length, 2);
  }
});

test("unexpected probe content and certificate errors fail closed", async () => {
  for (const implementation of [
    async () => Response.json({ page: "unrelated" }),
    async () => { throw new Error("net::ERR_CERT_AUTHORITY_INVALID"); },
  ]) {
    const f = setup(implementation);
    await assert.rejects(f.fetch(`${main}/api/auth/otp/send`, { method: "POST", body: "{}" }));
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].init.method, "GET");
  }
});

test("all routes down have a bounded probe count and suppress repeated immediate probes", async () => {
  const f = setup(async () => { throw reset(); });
  await assert.rejects(f.fetch(`${main}/api/profile/me`));
  await assert.rejects(f.fetch(`${main}/api/profile/me`));
  assert.equal(f.requests.length, 2);
});

test("one cancelled caller does not cancel the route probe used by another caller", async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const f = setup(async (url) => { if (url.endsWith("/api/auth/config")) { await barrier; return config(); } return new Response("ok"); });
  const controller = new AbortController();
  const cancelled = f.fetch(`${main}/api/profile/me`, { signal: controller.signal });
  const other = f.fetch(`${main}/api/contacts`);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release();
  await other;
  assert.equal(f.requests.filter((r) => r.url.endsWith("/api/profile/me")).length, 0);
  assert.equal(f.requests.filter((r) => r.url.endsWith("/api/contacts")).length, 1);
});

test("update JSON deadline covers the body after response headers arrive", async () => {
  let signal;
  await assert.rejects(fetchServiceJson(async (_url, init) => {
    signal = init.signal;
    return { json: () => new Promise(() => {}) };
  }, `${main}/api/app-updates/windows/check`, {}, 10), { name: "AbortError" });
  assert.equal(signal.aborted, true);
});

test("invalid update JSON is an error instead of a false no-update result", async () => {
  await assert.rejects(fetchServiceJson(async () => new Response("<html>unexpected</html>"), `${main}/api/app-updates/windows/check`), SyntaxError);
});

test("already cancelled update checks never start networking", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchServiceJson(() => assert.fail("No request expected"), `${main}/api/app-updates/windows/check`, { signal: controller.signal }), { name: "AbortError" });
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`a primary probe HTTP ${status} validates the alias before sending a cold write once`, async () => {
    const f = setup(async (url) => url === `${main}/api/auth/config`
      ? new Response("temporary probe failure", { status })
      : url.endsWith("/api/auth/config") ? config() : new Response("accepted"));
    assert.equal((await f.fetch(`${main}/api/auth/otp/send`, { method: "POST", body: "{}" })).status, 200);
    const writes = f.requests.filter((request) => request.init.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, `${alternate}/api/auth/otp/send`);
    assert.deepEqual(f.requests.slice(0, 2).map((request) => request.url),
      [`${main}/api/auth/config`, `${alternate}/api/auth/config`]);
  });
}

for (const form of ["seconds", "HTTP date"]) {
  test(`probe Retry-After in ${form} survives alias cache expiry and permits eventual primary recovery`, async () => {
    const start = Date.UTC(2026, 8, 14);
    let clock = start;
    let limited = true;
    const retryAfter = form === "seconds" ? "2" : new Date(start + 2000).toUTCString();
    const f = setup(async (url) => limited && url === `${main}/api/auth/config`
      ? new Response("limited", { status: 429, headers: { "retry-after": retryAfter } })
      : url.endsWith("/api/auth/config") ? config() : new Response("ok"),
    { now: () => clock, routeTtlMs: 100, failureCooldownMs: 10 });
    await f.fetch(`${main}/api/profile/me`);
    clock = start + 101;
    await f.fetch(`${main}/api/contacts`);
    assert.equal(f.requests.filter((request) => request.url === `${main}/api/auth/config`).length, 1);
    assert.equal(f.requests.at(-1).url, `${alternate}/api/contacts`);
    limited = false;
    clock = start + 2001;
    await f.fetch(`${main}/api/profile/me`);
    assert.equal(f.requests.filter((request) => request.url === `${main}/api/auth/config`).length, 2);
    assert.equal(f.requests.at(-1).url, `${main}/api/profile/me`);
  });
}

test("all temporary HTTP probe failures apply cooldown without sending business writes", async () => {
  let clock = 0;
  const f = setup(async (url, init) => {
    assert.equal(init.method, "GET");
    assert.ok(url.endsWith("/api/auth/config"));
    return new Response("unavailable", { status: 503, headers: { "retry-after": "invalid" } });
  }, { now: () => clock });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.fetch(`${main}/api/finance/orders`, { method: "POST", body: "{}" }), /HTTP 503/);
  }
  assert.equal(f.requests.length, 2);
  clock = 3001;
  await assert.rejects(f.fetch(`${main}/api/finance/orders`, { method: "POST", body: "{}" }), /HTTP 503/);
  assert.equal(f.requests.length, 4);
});

test("concurrent business requests share temporary-failure probes and the verified alias", async () => {
  const f = setup(async (url) => url === `${main}/api/auth/config`
    ? new Response("unavailable", { status: 503 })
    : url.endsWith("/api/auth/config") ? config() : new Response("ok"));
  const replies = await Promise.all(["profile/me", "contacts", "app-updates/mac/check"]
    .map((path) => f.fetch(`${main}/api/${path}`)));
  assert.ok(replies.every((response) => response.ok));
  assert.equal(f.requests.filter((request) => request.url.endsWith("/api/auth/config")).length, 2);
  assert.ok(f.requests.slice(2).every((request) => request.url.startsWith(alternate)));
});

test("probe authentication failures and an unverified alias still fail closed", async () => {
  for (const status of [401, 403, 404]) {
    const f = setup(async () => new Response("denied", { status }));
    await assert.rejects(f.fetch(`${main}/api/auth/otp/send`, { method: "POST", body: "{}" }));
    assert.equal(f.requests.length, 1);
  }
  const f = setup(async (url) => url.startsWith(main)
    ? new Response("unavailable", { status: 503 }) : Response.json({ page: "unrelated" }));
  await assert.rejects(f.fetch(`${main}/api/auth/otp/send`, { method: "POST", body: "{}" }), /unexpected response/);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((request) => request.init.method === "GET"));
});

test("an actual business write HTTP 503 is returned once without alias replay", async () => {
  const f = setup(async (url) => url.endsWith("/api/auth/config") ? config() : new Response("unavailable", { status: 503 }));
  assert.equal((await f.fetch(`${main}/api/finance/orders`, { method: "POST", body: "{}" })).status, 503);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests.filter((request) => request.init.method === "POST").length, 1);
  assert.ok(f.requests.every((request) => request.url.startsWith(main)));
});
