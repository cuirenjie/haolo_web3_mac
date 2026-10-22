import assert from "node:assert/strict";
import test from "node:test";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";

const config = resolveBinanceGatewayConfig({
  HAOLO_BINANCE_ROUTING_MODE: "auto",
  HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.example.invalid",
  HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private.example.invalid",
});
const credentials = { apiKey: "synthetic-account-key", apiSecret: "synthetic-account-secret" };
const accountUrl = "https://fapi.binance.com/fapi/v3/account?signature=synthetic";
const auth = { headers: { "X-MBX-APIKEY": credentials.apiKey } };

for (const condition of ["cooldown", "budget", "direct-429", "direct-418", "direct-reset"]) {
  test(`account binding uses the private egress during ${condition}`, async () => {
    const governor = new BinanceRequestGovernor(condition === "budget"
      ? { safetyRatio: 0.5, limits: { futures: 10, spot: 10 } } : {});
    if (condition === "budget") {
      for (const bucket of ["spot", "futures"]) governor.observeResponse(bucket,
        new Response("{}", { headers: { "x-mbx-used-weight-1m": "5" } }), Date.now());
    }
    if (condition === "cooldown") {
      for (const bucket of ["spot", "futures"]) governor.setUpstreamCooldown(bucket, Date.now() + 60_000);
    }
    let direct = 0, proxy = 0, saved = 0, beforeSave = 0;
    const paths = new Set();
    const router = new BinanceNetworkRouter({ config,
      directCooldownRemaining: bucket => governor.cooldownRemaining(bucket, Date.now()),
      onDirectRateLimit: (bucket, response, now) => governor.observeResponse(bucket, response, now),
      directFetch: async () => {
        direct++;
        if (condition === "direct-reset") throw new Error("synthetic ECONNRESET");
        assert.ok(condition.startsWith("direct-"), "local cooldown/budget must not touch direct egress");
        return new Response("{}", { status: Number(condition.slice(7)), headers: { "retry-after": "60" } });
      },
      privateProxyFetch: async (input, init) => {
        proxy++;
        const url = new URL(input); paths.add(url.pathname);
        if (url.pathname.endsWith("/time")) return Response.json({ serverTime: Date.now() });
        assert.equal(new Headers(init.headers).get("x-mbx-apikey"), credentials.apiKey);
        assert.match(url.searchParams.get("signature"), /^[a-f0-9]{64}$/);
        if (url.pathname === "/fapi/v3/account") return Response.json({
          totalMarginBalance: "100", totalWalletBalance: "100", totalUnrealizedProfit: "0",
          totalInitialMargin: "0", availableBalance: "100", positions: [],
        });
        return Response.json([]);
      },
    });
    const service = new BinanceAccountService({
      credentialStore: { upsert: async () => { saved++; return { bound: true }; } },
      fetch: (url, init) => governor.fetch(router.privateFetch.bind(router), url, init, {
        source: "account", privateFallbackFetch: router.privateFallbackFetch.bind(router),
      }),
    });
    const result = await service.bind("synthetic-owner", credentials, { beforeSave: async () => { beforeSave++; } });
    assert.equal(result.status.bound, true);
    assert.equal(saved, 1); assert.equal(beforeSave, 1);
    assert.ok(proxy >= 6); assert.ok(paths.has("/fapi/v3/account"));
    assert.equal(direct, condition.startsWith("direct-") ? 2 : 0);
    if (["cooldown", "direct-429", "direct-418"].includes(condition)) {
      assert.ok(governor.cooldownRemaining("futures", Date.now()) > 0, "private success must not clear the direct ban");
    }
  });
}

test("private fallback preserves gateway rejection without direct retry or public credential leakage", async () => {
  const governor = new BinanceRequestGovernor();
  governor.setUpstreamCooldown("futures", Date.now() + 60_000);
  const forbidden = async () => { throw new Error("unexpected direct/public request"); };
  const router = new BinanceNetworkRouter({ config, directFetch: forbidden,
    privateProxyFetch: async () => new Response("{}", { status: 429, headers: { "retry-after": "20" } }),
  });
  const response = await governor.fetch(forbidden, accountUrl, auth, {
    publicFallbackFetch: forbidden, privateFallbackFetch: router.privateFallbackFetch.bind(router),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-haolo-binance-egress"), "haolo-private");
  const noPrivate = await governor.fetch(forbidden, accountUrl, auth, { publicFallbackFetch: forbidden });
  assert.equal(noPrivate.status, 429);
  const post = await governor.fetch(forbidden, accountUrl, { ...auth, method: "POST" }, {
    privateFallbackFetch: forbidden,
  });
  assert.equal(post.status, 429);
});

test("private fallback enforces GET, target origin, explicit direct mode, and caller cancellation", async () => {
  let calls = 0;
  const router = new BinanceNetworkRouter({ config, privateProxyFetch: async () => { calls++; return Response.json({}); } });
  await assert.rejects(router.privateFallbackFetch(accountUrl, { method: "POST" }), /GET only/);
  await assert.rejects(router.privateFallbackFetch("https://other.example.invalid/account"), /not allowed/);
  await assert.rejects(router.privateFallbackFetch(accountUrl, { signal: AbortSignal.abort() }), { name: "AbortError" });
  const direct = new BinanceNetworkRouter({ config: { ...config, routingMode: "direct" }, privateProxyFetch: router.privateProxyFetch });
  assert.equal(direct.canUsePrivateGateway(), false);
  await assert.rejects(direct.privateFallbackFetch(accountUrl), /unavailable/);
  assert.equal(calls, 0);
});
