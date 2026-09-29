import assert from "node:assert/strict";
import test from "node:test";
import { createHaoloNetworkPolicy, HAOLO_NETWORK_ROUTES, haoloRoute, parseResolvedProxy } from "../src/main/haolo-network-policy.mjs";

const data = (egressRegion) => ({ schemaVersion: 1, service: "haolo-network-policy", egressRegion, accelerationEnabled: true, ttlSeconds: 30 });
test("edge services use the HK public route while model traffic stays on ordinary Tokyo", async () => {
  for (const hostname of Object.keys(HAOLO_NETWORK_ROUTES)) {
    for (const egressRegion of ["CN", "OTHER", "UNKNOWN"]) {
      for (const proxy of ["DIRECT", "PROXY 127.0.0.1:7890", "SOCKS5 127.0.0.1:1080"]) {
        let probes = 0;
        const policy = createHaoloNetworkPolicy({ resolveProxy: async () => proxy, probeRegion: async () => { probes++; return data(egressRegion); } });
        const decision = await policy.resolve(`https://${hostname}/v1/responses`);
        const isModel = hostname === "haolo.pro";
        assert.equal(decision.route, "ordinary");
        assert.deepEqual(decision.addresses, [HAOLO_NETWORK_ROUTES[hostname].ordinary]);
        assert.equal(probes, 0);
        assert.deepEqual(decision.addresses, [isModel ? "8.216.43.79" : "8.217.125.71"]);
      }
    }
  }
});

test("PAC is evaluated per original URL without model acceleration", async () => {
  const seen = [];
  const policy = createHaoloNetworkPolicy({ resolveProxy: async (url) => { seen.push(url); return url.includes("haolo.com") ? "PROXY localhost:80; DIRECT" : "DIRECT"; }, probeRegion: async () => data("CN") });
  assert.equal((await policy.resolve("https://haolo.com/api/profile/me?q=1")).route, "ordinary");
  assert.equal((await policy.resolve("https://haolo.pro/v1/responses")).route, "ordinary");
  assert.equal((await policy.resolve("https://market.youle.pro/api/v3/time")).route, "ordinary");
  assert.deepEqual(seen, ["https://haolo.com/api/profile/me?q=1", "https://haolo.pro/v1/responses", "https://market.youle.pro/api/v3/time"]);
  assert.equal(parseResolvedProxy("DIRECT; PROXY localhost:80"), null);
  assert.equal(parseResolvedProxy("HTTPS localhost:443"), "https://localhost/");
});

test("all model API paths stay on ordinary Tokyo without a model-region probe", async () => {
  let proxy = "DIRECT";
  let probes = 0;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => proxy, probeRegion: async (url, route) => {
    probes++;
    assert.equal(url.hostname, "haolo.pro"); assert.equal(route.ordinary, "8.216.43.79"); return data("CN");
  } });
  for (const pathname of ["/v1/responses", "/v1/chat/completions", "/v1/messages", "/v1/models", "/v1/embeddings", "/v1/images/generations", "/v1/audio/transcriptions", "/v1/media/input"]) {
    const url = `https://haolo.pro${pathname}`;
    proxy = "DIRECT";
    assert.deepEqual((await policy.resolve(url)).addresses, ["8.216.43.79"]);
    proxy = "PROXY localhost:8080";
    assert.deepEqual((await policy.resolve(url)).addresses, ["8.216.43.79"]);
  }
  assert.equal(probes, 0);
});

test("retired model GA addresses are absent from every active model route", () => {
  assert.deepEqual(HAOLO_NETWORK_ROUTES["haolo.pro"].accelerated, []);
  for (const hostname of ["market.youle.pro", "sg-a.binance-egress.waduo.com"]) {
    assert.deepEqual(HAOLO_NETWORK_ROUTES[hostname].ordinary, "8.217.125.71");
    assert.deepEqual(HAOLO_NETWORK_ROUTES[hostname].accelerated, []);
  }
  assert.equal(HAOLO_NETWORK_ROUTES["haolo.pro"].accelerated.length, 0);
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

test("retired model GA routes do not probe or reclassify on network changes", async () => {
  let clock = 1, network = "a", probes = 0;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", now: () => clock, fingerprint: () => network,
    probeRegion: async () => { probes++; return data("CN"); } });
  await Promise.all(Array.from({ length: 12 }, () => policy.resolve("https://haolo.pro/v1/models")));
  assert.equal(probes, 0);
  clock += 29_000;
  await policy.resolve("https://haolo.pro"); assert.equal(probes, 0);
  clock += 1_001;
  assert.equal((await policy.resolve("https://haolo.pro")).route, "ordinary"); assert.equal(probes, 0);
  network = "vpn-enabled";
  await policy.resolve("https://haolo.pro"); assert.equal(probes, 0);
  policy.invalidate(); await policy.resolve("https://haolo.pro"); assert.equal(probes, 0);
});
