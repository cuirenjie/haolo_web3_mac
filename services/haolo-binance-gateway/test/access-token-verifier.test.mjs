import assert from "node:assert/strict";
import test from "node:test";
import { HaoloAccessTokenVerifier } from "../src/access-token-verifier.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig } from "./helpers.mjs";

function twoPartToken(payload = {}) {
  const body = Buffer.from(JSON.stringify({ sub: "legacy-subject", exp: Math.floor(Date.now() / 1_000) + 300, ...payload })).toString("base64url");
  return `${body}.opaque-signature`;
}

test("authoritative Haolo profile verification accepts current two-part access tokens and caches only identity", async () => {
  const cache = new GatewayCache();
  const requests = [];
  const config = baseConfig({
    authApiOrigin: "https://haolo.example",
    authProfilePath: "/api/auth/me",
    authRequestTimeoutMs: 1_000,
    authCacheTtlMs: 15_000,
  });
  const verifier = new HaoloAccessTokenVerifier({
    config,
    cache,
    async fetchImpl(url, options) {
      requests.push({ url, authorization: options.headers.authorization });
      return new Response(JSON.stringify({ id: "00000000-0000-0000-0000-000000000042" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const token = twoPartToken();
  assert.equal((await verifier.verify(token)).userId, "00000000-0000-0000-0000-000000000042");
  assert.equal((await verifier.verify(token)).userId, "00000000-0000-0000-0000-000000000042");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://haolo.example/api/auth/me");
  assert.equal(requests[0].authorization, `Bearer ${token}`);
  assert.doesNotMatch(JSON.stringify([...cache.memory.entries()]), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("authoritative Haolo profile verification rejects invalid sessions", async () => {
  const config = baseConfig({
    authApiOrigin: "https://haolo.example",
    authProfilePath: "/api/auth/me",
    authRequestTimeoutMs: 1_000,
    authCacheTtlMs: 15_000,
  });
  const verifier = new HaoloAccessTokenVerifier({
    config,
    cache: new GatewayCache(),
    fetchImpl: async () => new Response("unauthorized", { status: 401 }),
  });
  await assert.rejects(() => verifier.verify(twoPartToken()), (error) => error.statusCode === 401);
});
