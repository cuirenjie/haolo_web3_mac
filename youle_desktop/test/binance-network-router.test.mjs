import assert from "node:assert/strict";
import test from "node:test";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import {
  BINANCE_DIRECT_ROUTE_FAILED,
  BinanceNetworkRouter,
} from "../src/main/binance-network-router.mjs";

function autoConfig() {
  return resolveBinanceGatewayConfig({
    HAOLO_BINANCE_ROUTING_MODE: "auto",
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private-market.haolo.example",
    HAOLO_BINANCE_DIRECT_ATTEMPT_TIMEOUT_MS: "1000",
  });
}

test("route decoration preserves streaming reads and downstream cancellation", { timeout: 2_000 }, async () => {
  for (const route of ["direct", "public-gateway", "private-gateway"]) {
    let source;
    let cancelled;
    const cancelledPromise = new Promise((resolve) => { cancelled = resolve; });
    const upstream = new Response(new ReadableStream({
      start(controller) { source = controller; },
      cancel(reason) { cancelled(reason); },
    }), { status: 200, headers: { "x-haolo-cache": "MISS" } });
    const config = route === "direct" ? { ...autoConfig(), routingMode: "direct" }
      : { ...autoConfig(), routingMode: "gateway" };
    const router = new BinanceNetworkRouter({ config,
      directFetch: async () => upstream,
      gatewayClient: { fetch: async () => upstream },
      privateProxyFetch: async () => upstream,
    });
    const response = route === "private-gateway"
      ? await router.privateFetch("https://fapi.binance.com/fapi/v3/account")
      : await router.publicFetch("https://fapi.binance.com/fapi/v1/klines");
    assert.equal(response.headers.get("x-haolo-binance-route"), route);
    assert.equal(response.headers.get("x-haolo-cache"), "MISS");
    const reader = response.body.getReader();
    source.enqueue(new TextEncoder().encode("first chunk"));
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "first chunk", "must deliver data before upstream finishes");
    assert.equal(first.done, false);
    await reader.cancel("chart closed");
    assert.equal(await cancelledPromise, "chart closed");
  }
});

test("route decoration preserves upstream body failures and null bodies", { timeout: 2_000 }, async () => {
  let source;
  const router = new BinanceNetworkRouter({ config: { ...autoConfig(), routingMode: "direct" },
    directFetch: async () => new Response(new ReadableStream({ start(controller) { source = controller; } })),
  });
  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines");
  const reading = response.text();
  const failure = new Error("upstream connection closed");
  source.error(failure);
  await assert.rejects(reading, (error) => error === failure);
  for (const status of [204, 205, 304]) {
    router.directFetch = async () => new Response(null, { status });
    const empty = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines");
    assert.equal(empty.status, status);
    assert.equal(empty.body, null);
    assert.equal(await empty.clone().text(), "");
  }
});

test("a failed HTTP ping never selects direct WebSocket or resets gateway preference", async () => {
  for (const status of [403, 429, 451, 500, 503]) {
    const router = new BinanceNetworkRouter({
      config: autoConfig(),
      directFetch: async () => new Response("unavailable", { status }),
      gatewayClient: { async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=fresh"; } },
      privateProxyFetch: async () => new Response("{}"),
    });
    assert.equal((await router.marketStreamEndpoint({ marketType: "futures" })).route, "gateway");
    router.markDirectFailure("private", "futures");
    await router.runBackgroundProbes();
    assert.ok(router.snapshot()["public:futures"].gatewayPreferenceRemainingMs > 0);
    assert.ok(router.snapshot()["private:futures"].gatewayPreferenceRemainingMs > 0);
    assert.equal(router.snapshot()["public:futures"].healthyRemainingMs, 0);
    assert.equal(router.snapshot()["private:futures"].healthyRemainingMs, 0);
  }
});

test("public server errors cannot beat healthy gateway data in a race or a direct lease", async () => {
  for (const healthyLease of [false, true]) {
    const router = new BinanceNetworkRouter({
      config: autoConfig(),
      directFetch: async () => new Response("upstream unavailable", { status: 503 }),
      gatewayClient: { async fetch() { return new Response("[[1,2]]"); } },
    });
    if (healthyLease) router.markDirectSuccess("public", "futures");
    const result = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-haolo-binance-route"), "public-gateway");
    assert.equal(await result.text(), "[[1,2]]");
  }
});

test("auto router uses the current client network when Binance is reachable", async () => {
  const directRequests = [];
  const gatewayRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async (url) => {
      directRequests.push(String(url));
      return new Response(JSON.stringify([[1, "2"]]), { status: 200 });
    },
    gatewayClient: {
      async fetch(url) { gatewayRequests.push(String(url)); return new Response("[]"); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-haolo-binance-route"), "direct");
  assert.equal(response.headers.get("x-haolo-binance-egress"), "local");
  assert.deepEqual(directRequests, ["https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT"]);
  assert.deepEqual(gatewayRequests, []);
  assert.equal(router.snapshot()["public:futures"].failures, 0);
});

test("public requests remember Haolo after failure and recover through a background probe", async () => {
  let currentMs = 10_000;
  let directAttempts = 0;
  const gatewayRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    now: () => currentMs,
    cooldownBaseMs: 1_000,
    directFetch: async () => {
      directAttempts += 1;
      if (directAttempts === 1) throw new Error("blocked network");
      return new Response("[]", { status: 200 });
    },
    gatewayClient: {
      async fetch(url) {
        gatewayRequests.push(String(url));
        return new Response("[]", { status: 200 });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT";

  await router.publicFetch(input);
  await router.publicFetch(input);
  assert.equal(directAttempts, 1);
  assert.deepEqual(gatewayRequests, [
    "https://market.haolo.example/fapi/v1/klines?symbol=BTCUSDT",
    "https://market.haolo.example/fapi/v1/klines?symbol=BTCUSDT",
  ]);
  currentMs += 1_001;
  await router.publicFetch(input);
  assert.equal(directAttempts, 1, "foreground requests must not pay for another direct probe");
  assert.ok(router.snapshot()["public:futures"].gatewayPreferenceRemainingMs > 0);

  await router.runBackgroundProbes();
  assert.equal(directAttempts, 2);
  assert.equal(router.snapshot()["public:futures"].failures, 0);

  await router.publicFetch(input);
  assert.equal(directAttempts, 3);
});

test("direct timeout falls back even when the Electron fetch promise ignores abort", async () => {
  let directSignalAborted = false;
  const gatewayRequests = [];
  const router = new BinanceNetworkRouter({
    config: { ...autoConfig(), directAttemptTimeoutMs: 25 },
    directFetch: async (_url, init) => new Promise(() => {
      init.signal.addEventListener("abort", () => { directSignalAborted = true; }, { once: true });
    }),
    gatewayClient: {
      async fetch(url) {
        gatewayRequests.push(String(url));
        return new Response("[]", { status: 200 });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const startedAt = Date.now();
  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT");

  assert.equal(response.status, 200);
  assert.equal(directSignalAborted, true);
  assert.ok(Date.now() - startedAt < 500, "fallback must not wait for the stalled direct fetch promise");
  assert.deepEqual(gatewayRequests, ["https://market.haolo.example/fapi/v1/klines?symbol=BTCUSDT"]);
});

test("public GET starts the gateway after the hedge delay and remembers the faster route", async () => {
  let directAttempts = 0;
  let directAborted = false;
  let gatewayAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    publicHedgeDelayMs: 25,
    directFetch: async (_url, init) => new Promise(() => {
      directAttempts += 1;
      init.signal.addEventListener("abort", () => { directAborted = true; }, { once: true });
    }),
    gatewayClient: {
      async fetch() {
        gatewayAttempts += 1;
        return new Response("[]", { status: 200 });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT";

  const startedAt = Date.now();
  const first = await router.publicFetch(input);
  assert.equal(first.status, 200);
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(directAttempts, 1);
  assert.equal(gatewayAttempts, 1);
  assert.equal(directAborted, true);
  assert.ok(router.snapshot()["public:futures"].gatewayPreferenceRemainingMs > 0);

  await router.publicFetch(input);
  assert.equal(directAttempts, 1, "remembered route should bypass foreground direct attempts");
  assert.equal(gatewayAttempts, 2);
});

test("a healthy direct lease avoids repeating the delayed hedge on every public GET", async () => {
  let directAttempts = 0;
  let gatewayAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    publicHedgeDelayMs: 25,
    healthyTtlMs: 60_000,
    directFetch: async () => {
      directAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, directAttempts === 1 ? 5 : 45));
      return new Response("[]", { status: 200 });
    },
    gatewayClient: {
      async fetch() { gatewayAttempts += 1; return new Response("[]", { status: 200 }); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT";
  assert.equal((await router.publicFetch(input)).headers.get("x-haolo-binance-route"), "direct");
  assert.equal((await router.publicFetch(input)).headers.get("x-haolo-binance-route"), "direct");
  assert.equal(directAttempts, 2);
  assert.equal(gatewayAttempts, 0);
});

test("a gateway downstream 429 cannot win a hedge while direct Binance is still healthy", async () => {
  let directAttempts = 0;
  let gatewayAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    publicHedgeDelayMs: 10,
    directFetch: async () => {
      directAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response("[]", { status: 200 });
    },
    gatewayClient: {
      async fetch() {
        gatewayAttempts += 1;
        return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
          status: 429,
          headers: { "retry-after": "20", "x-haolo-rate-limit-source": "gateway-downstream" },
        });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-haolo-binance-route"), "direct");
  assert.equal(directAttempts, 1);
  assert.equal(gatewayAttempts, 1);
});

test("gateway stale data waits for a fresh direct hedge and remains the final fallback", async () => {
  let directMode = "healthy";
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    publicHedgeDelayMs: 10,
    directFetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (directMode === "failed") throw new Error("direct unavailable");
      return new Response(JSON.stringify({ source: "direct" }), { status: 200 });
    },
    gatewayClient: {
      async fetch() {
        return new Response(JSON.stringify({ source: "stale" }), {
          status: 200,
          headers: { "x-haolo-cache": "STALE" },
        });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT";
  const fresh = await router.publicFetch(input);
  assert.deepEqual(await fresh.json(), { source: "direct" });
  assert.equal(fresh.headers.get("x-haolo-binance-route"), "direct");

  directMode = "failed";
  const fallback = await router.publicHedgedFetch(new URL(input), {}, "futures");
  assert.deepEqual(await fallback.json(), { source: "stale" });
  assert.equal(fallback.headers.get("x-haolo-cache"), "STALE");
});

test("persisted gateway preference survives a router restart and clears after recovery", async () => {
  let persisted = null;
  const gatewayClient = {
    async fetch() { return new Response("[]", { status: 200 }); },
    async marketStreamEndpoint() { return "wss://market.haolo.example/stream/spot?ticket=one"; },
  };
  const firstRouter = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => { throw new Error("blocked"); },
    gatewayClient,
    privateProxyFetch: async () => new Response("{}"),
    onStateChange: (state) => { persisted = state; },
  });
  const input = "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT";
  await firstRouter.publicFetch(input);
  assert.ok(persisted["public:spot"].gatewayPreferredUntil > Date.now());

  let recoveredDirectAttempts = 0;
  const secondRouter = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => {
      recoveredDirectAttempts += 1;
      return new Response("[]", { status: 200 });
    },
    gatewayClient,
    privateProxyFetch: async () => new Response("{}"),
    initialState: persisted,
    onStateChange: (state) => { persisted = state; },
  });
  await secondRouter.publicFetch(input);
  assert.equal(recoveredDirectAttempts, 0);
  await secondRouter.runBackgroundProbes();
  assert.equal(recoveredDirectAttempts, 1);
  assert.equal(secondRouter.snapshot()["public:spot"].gatewayPreferenceRemainingMs, 0);
  assert.deepEqual(persisted, {});
});

test("remembered gateway failures immediately fall back to a recovered direct route", async () => {
  let directAttempts = 0;
  let gatewayAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    initialState: {
      "public:futures": {
        failures: 1,
        cooldownUntil: Date.now() + 60_000,
        gatewayPreferredUntil: Date.now() + 60_000,
      },
    },
    directFetch: async () => {
      directAttempts += 1;
      return new Response("[]", { status: 200 });
    },
    gatewayClient: {
      async fetch() {
        gatewayAttempts += 1;
        throw new Error("gateway transport unavailable");
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT");
  assert.equal(response.status, 200);
  assert.equal(gatewayAttempts, 1);
  assert.equal(directAttempts, 1);
  assert.equal(router.snapshot()["public:futures"].gatewayPreferenceRemainingMs, 0);
});

test("private account GET never participates in the public hedge race", async () => {
  let proxyAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    publicHedgeDelayMs: 25,
    directFetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return new Response("{}", { status: 200 });
    },
    gatewayClient: {
      async fetch() { return new Response("[]"); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => {
      proxyAttempts += 1;
      return new Response("{}", { status: 200 });
    },
  });

  const response = await router.privateFetch("https://api.binance.com/api/v3/account?timestamp=1&signature=one");
  assert.equal(response.status, 200);
  assert.equal(proxyAttempts, 0);
});

test("private route signals the account service to re-sign before gateway retry", async () => {
  let directAttempts = 0;
  let proxyAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => {
      directAttempts += 1;
      throw new Error("direct account route unavailable");
    },
    gatewayClient: {
      async fetch() { return new Response("{}"); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => {
      proxyAttempts += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const url = "https://fapi.binance.com/fapi/v3/account?timestamp=1&signature=old";

  await assert.rejects(router.privateFetch(url), (error) => error?.code === BINANCE_DIRECT_ROUTE_FAILED);
  const response = await router.privateFetch(url);
  assert.equal(response.status, 200);
  assert.equal(directAttempts, 1);
  assert.equal(proxyAttempts, 1);
});

test("websocket routing probes the real target and obtains a one-use gateway ticket only on failure", async () => {
  const ticketRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => new Response("blocked", { status: 451 }),
    gatewayClient: {
      async fetch() { return new Response("{}"); },
      async marketStreamEndpoint(params) {
        ticketRequests.push(params);
        return "wss://market.haolo.example/stream/futures?ticket=short";
      },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const endpoint = await router.marketStreamEndpoint({ marketType: "futures", combined: true });
  assert.deepEqual(endpoint, {
    url: "wss://market.haolo.example/stream/futures?ticket=short",
    route: "gateway",
    marketType: "futures",
    streamClass: "market",
  });
  assert.deepEqual(ticketRequests, [{ marketType: "futures", combined: true, streamClass: "market" }]);
});

test("direct Futures WebSocket routing selects the Binance public base for bookTicker", async () => {
  const router = new BinanceNetworkRouter({
    config: resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "direct" }),
    directFetch: async () => new Response("{}"),
  });
  const endpoint = await router.marketStreamEndpoint({
    marketType: "futures",
    combined: true,
    streamClass: "public",
  });
  assert.deepEqual(endpoint, {
    url: "wss://fstream.binance.com/public/stream",
    route: "direct",
    marketType: "futures",
    streamClass: "public",
  });
});

test("router rejects arbitrary targets and any private write method", async () => {
  const router = new BinanceNetworkRouter({
    config: resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "direct" }),
    directFetch: async () => new Response("{}"),
  });
  await assert.rejects(router.publicFetch("https://attacker.example/api/v3/time"), /not allowed/);
  await assert.rejects(
    router.privateFetch("https://api.binance.com/api/v3/order", { method: "POST" }),
    /GET only/,
  );
});

test("automatic routing observes Binance reachability without inspecting VPNs or user IPs", async () => {
  const { readFile } = await import("node:fs/promises");
  const [routerSource, mainSource] = await Promise.all([
    readFile(new URL("../src/main/binance-network-router.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ]);
  const source = `${routerSource}\n${mainSource}`;
  assert.doesNotMatch(source, /Get-NetAdapter|NetworkInterfaceType|networkInterfaces\(|vpn process|public ip/i);
  assert.match(routerSource, /fapi\/v1\/ping/);
  assert.match(routerSource, /api\/v3\/ping/);
});
