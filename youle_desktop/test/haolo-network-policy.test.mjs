import assert from "node:assert/strict";
import test from "node:test";
import { createHaoloNetworkPolicy, HAOLO_NETWORK_ROUTES, haoloRoute, parseResolvedProxy } from "../src/main/haolo-network-policy.mjs";

const data = (egressRegion) => ({ schemaVersion: 1, service: "haolo-network-policy", egressRegion, accelerationEnabled: true, ttlSeconds: 30 });
test("all six origins obey proxy > mainland GA > ordinary, including the Tokyo model origin", async () => {
  for (const hostname of Object.keys(HAOLO_NETWORK_ROUTES)) {
    for (const egressRegion of ["CN", "OTHER", "UNKNOWN"]) {
      for (const proxy of ["DIRECT", "PROXY 127.0.0.1:7890", "SOCKS5 127.0.0.1:1080"]) {
        let probes = 0;
        const policy = createHaoloNetworkPolicy({ resolveProxy: async () => proxy, probeRegion: async () => { probes++; return data(egressRegion); } });
        const decision = await policy.resolve(`https://${hostname}/v1/responses`);
        const accelerated = proxy === "DIRECT" && egressRegion === "CN";
        assert.equal(decision.route, accelerated ? "hong-kong-ga" : "ordinary");
        assert.deepEqual(decision.addresses, accelerated ? HAOLO_NETWORK_ROUTES[hostname].accelerated : [HAOLO_NETWORK_ROUTES[hostname].ordinary]);
        assert.equal(probes, proxy === "DIRECT" ? 1 : 0);
      }
    }
  }
});

test("PAC is per original URL; a proxy-enabled machine can still have DIRECT model traffic", async () => {
  const seen = [];
  const policy = createHaoloNetworkPolicy({ resolveProxy: async (url) => { seen.push(url); return url.includes("haolo.pro") ? "DIRECT" : "PROXY localhost:80; DIRECT"; }, probeRegion: async () => data("CN") });
  assert.equal((await policy.resolve("https://haolo.com/api/profile/me?q=1")).route, "ordinary");
  assert.equal((await policy.resolve("https://haolo.pro/v1/responses")).route, "hong-kong-ga");
  assert.deepEqual(seen, ["https://haolo.com/api/profile/me?q=1", "https://haolo.pro/v1/responses"]);
  assert.equal(parseResolvedProxy("DIRECT; PROXY localhost:80"), null);
  assert.equal(parseResolvedProxy("HTTPS localhost:443"), "https://localhost/");
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
    assert.equal((await policy.resolve("https://haolo.pro/v1/responses")).route, "ordinary");
  }
  for (const url of ["https://haolo.com.evil.test", "http://haolo.com", "https://haolo.com:8443", "https://user@haolo.com"]) assert.equal(haoloRoute(url), null);
});

test("TTL is bounded, probes coalesce, interface changes and explicit invalidation reclassify", async () => {
  let clock = 1, network = "a", egressRegion = "CN", probes = 0;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", now: () => clock, fingerprint: () => network,
    probeRegion: async () => { probes++; return data(egressRegion); } });
  await Promise.all(Array.from({ length: 12 }, () => policy.resolve("https://haolo.com/api/auth/config")));
  assert.equal(probes, 1);
  clock += 29_000;
  await policy.resolve("https://haolo.com"); assert.equal(probes, 1);
  clock += 1_001; egressRegion = "OTHER";
  assert.equal((await policy.resolve("https://haolo.com")).route, "ordinary"); assert.equal(probes, 2);
  network = "vpn-enabled";
  await policy.resolve("https://haolo.com"); assert.equal(probes, 3);
  policy.invalidate(); await policy.resolve("https://haolo.com"); assert.equal(probes, 4);
});

test("one cancelled waiter does not cancel the shared anonymous probe", async () => {
  let finish;
  const policy = createHaoloNetworkPolicy({ resolveProxy: async () => "DIRECT", probeRegion: () => new Promise((resolve) => { finish = resolve; }) });
  const controller = new AbortController();
  const cancelled = policy.resolve("https://haolo.com", { signal: controller.signal });
  const surviving = policy.resolve("https://haolo.com");
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  finish(data("CN"));
  assert.equal((await surviving).route, "hong-kong-ga");
});
