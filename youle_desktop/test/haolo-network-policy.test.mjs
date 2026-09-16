import assert from "node:assert/strict";
import test from "node:test";
import { createHaoloNetworkPolicy, HAOLO_NETWORK_ROUTES, haoloRoute, parseResolvedProxy } from "../src/main/haolo-network-policy.mjs";

const data = (egressRegion) => ({ schemaVersion: 1, service: "haolo-network-policy", egressRegion, accelerationEnabled: true, ttlSeconds: 30 });
test("only mainland DIRECT market and model traffic use GA; account and invite keep ordinary origins", async () => {
  for (const hostname of Object.keys(HAOLO_NETWORK_ROUTES)) {
    for (const egressRegion of ["CN", "OTHER", "UNKNOWN"]) {
      for (const proxy of ["DIRECT", "PROXY 127.0.0.1:7890", "SOCKS5 127.0.0.1:1080"]) {
        let probes = 0;
        const policy = createHaoloNetworkPolicy({ resolveProxy: async () => proxy, probeRegion: async () => { probes++; return data(egressRegion); } });
        const decision = await policy.resolve(`https://${hostname}/v1/responses`);
        const eligible = ["market.youle.pro", "sg-a.binance-egress.waduo.com", "haolo.pro"].includes(hostname);
        const accelerated = eligible && proxy === "DIRECT" && egressRegion === "CN";
        assert.equal(decision.route, accelerated ? "hong-kong-ga" : "ordinary");
        assert.deepEqual(decision.addresses, accelerated ? HAOLO_NETWORK_ROUTES[hostname].accelerated : [HAOLO_NETWORK_ROUTES[hostname].ordinary]);
        assert.equal(probes, eligible && proxy === "DIRECT" ? 1 : 0);
      }
    }
  }
});

test("PAC is per original URL; DIRECT models and markets can accelerate", async () => {
  const seen = [];
  const policy = createHaoloNetworkPolicy({ resolveProxy: async (url) => { seen.push(url); return url.includes("haolo.com") ? "PROXY localhost:80; DIRECT" : "DIRECT"; }, probeRegion: async () => data("CN") });
  assert.equal((await policy.resolve("https://haolo.com/api/profile/me?q=1")).route, "ordinary");
  assert.equal((await policy.resolve("https://haolo.pro/v1/responses")).route, "hong-kong-ga");
  assert.equal((await policy.resolve("https://market.youle.pro/api/v3/time")).route, "hong-kong-ga");
  assert.deepEqual(seen, ["https://haolo.com/api/profile/me?q=1", "https://haolo.pro/v1/responses", "https://market.youle.pro/api/v3/time"]);
  assert.equal(parseResolvedProxy("DIRECT; PROXY localhost:80"), null);
  assert.equal(parseResolvedProxy("HTTPS localhost:443"), "https://localhost/");
});

test("all model API paths share the audited BGP targets and model probes keep the Tokyo origin", async () => {
  let proxy = "DIRECT";
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => proxy, probeRegion: async (url, route) => {
    assert.equal(url.hostname, "haolo.pro"); assert.equal(route.ordinary, "8.216.43.79"); return data("CN");
  } });
  for (const pathname of ["/v1/responses", "/v1/chat/completions", "/v1/messages", "/v1/models", "/v1/embeddings", "/v1/images/generations", "/v1/audio/transcriptions", "/v1/media/input"]) {
    const url = `https://haolo.pro${pathname}`;
    proxy = "DIRECT";
    assert.deepEqual((await policy.resolve(url)).addresses, ["47.76.124.53", "47.238.144.244"]);
    proxy = "PROXY localhost:8080";
    assert.deepEqual((await policy.resolve(url)).addresses, ["8.216.43.79"]);
  }
});

test("proxy errors/unsupported PAC never bypass a configured proxy", async () => {
  for (const value of ["", "UNKNOWN localhost:80", "PROXY user:pass@localhost:80", "PROXY localhost", "PROXY localhost:80/path"]) {
    assert.throws(() => parseResolvedProxy(value));
  }
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => { throw new Error("PAC unavailable"); }, probeRegion: async () => { throw new Error("must not probe"); } });
  await assert.rejects(policy.resolve("https://haolo.com"), /PAC unavailable/);
});

test("region probe errors and forged policies cannot send credentials to new endpoints", async () => {
  for (const payload of [{}, data("HK"), { ...data("CN"), accelerationEnabled: false }, { ...data("CN"), service: "other" }]) {
    const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", probeRegion: async () => payload });
    for (const url of ["https://market.youle.pro/api/v3/time", "https://haolo.pro/v1/responses"]) {
      assert.equal((await policy.resolve(url)).route, "ordinary");
    }
  }
  for (const url of ["https://haolo.com.evil.test", "http://haolo.com", "https://haolo.com:8443", "https://user@haolo.com"]) assert.equal(haoloRoute(url), null);
});

test("TTL is bounded, probes coalesce, interface changes and explicit invalidation reclassify", async () => {
  let clock = 1, network = "a", egressRegion = "CN", probes = 0;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", now: () => clock, fingerprint: () => network,
    probeRegion: async () => { probes++; return data(egressRegion); } });
  await Promise.all(Array.from({ length: 12 }, () => policy.resolve("https://market.youle.pro/api/v3/time")));
  assert.equal(probes, 1);
  clock += 29_000;
  await policy.resolve("https://market.youle.pro"); assert.equal(probes, 1);
  clock += 1_001; egressRegion = "OTHER";
  assert.equal((await policy.resolve("https://market.youle.pro")).route, "ordinary"); assert.equal(probes, 2);
  network = "vpn-enabled";
  await policy.resolve("https://market.youle.pro"); assert.equal(probes, 3);
  policy.invalidate(); await policy.resolve("https://market.youle.pro"); assert.equal(probes, 4);
});

test("one cancelled waiter does not cancel the shared anonymous probe", async () => {
  let finish;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", probeRegion: () => new Promise((resolve) => { finish = resolve; }) });
  const controller = new AbortController();
  const cancelled = policy.resolve("https://market.youle.pro", { signal: controller.signal });
  const surviving = policy.resolve("https://market.youle.pro");
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  finish(data("CN"));
  assert.equal((await surviving).route, "hong-kong-ga");
});
