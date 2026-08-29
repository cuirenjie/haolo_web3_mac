import assert from "node:assert/strict";
import test from "node:test";
import { GatewayAuthError, proxyToken, signPrivateEgressPermit, verifyHaoloJwt, verifyPrivateEgressPermit } from "../src/auth.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

test("Haolo JWT verification accepts valid HS256 tokens and rejects tampering", () => {
  const config = baseConfig();
  const token = createJwt(config.jwtSecret, { aud: "market", role: "member" });
  assert.equal(verifyHaoloJwt(token, config).userId, "00000000-0000-0000-0000-000000000001");
  assert.throws(() => verifyHaoloJwt(`${token.slice(0, -1)}x`, config), GatewayAuthError);
  assert.throws(() => verifyHaoloJwt(createJwt(config.jwtSecret, { exp: 1 }), config), /expired/);
  assert.throws(() => verifyHaoloJwt(createJwt(config.jwtSecret, { exp: null }), config), /expiry is missing/);
});

test("private proxy extracts an opaque permit only as Haolo basic password or bearer token", () => {
  const token = "header.payload.signature";
  assert.equal(proxyToken({ "proxy-authorization": `Bearer ${token}` }), token);
  assert.equal(proxyToken({ "proxy-authorization": `Basic ${Buffer.from(`haolo:${token}`).toString("base64")}` }), token);
  assert.equal(proxyToken({ "proxy-authorization": `Basic ${Buffer.from(`other:${token}`).toString("base64")}` }), "");
});

test("private egress permits are signed, short-lived and claim-bound", () => {
  const config = baseConfig();
  const token = signPrivateEgressPermit({
    userId: "00000000-0000-0000-0000-000000000001",
    permitId: "permit-id-000000000001",
    shardId: "sg-a",
    targetHost: "fapi.binance.com",
    marketType: "futures",
    priority: "core",
    weight: 5,
  }, config, 1_000);
  const permit = verifyPrivateEgressPermit(token, config, 1_001);
  assert.equal(permit.shardId, "sg-a");
  assert.equal(permit.targetHost, "fapi.binance.com");
  assert.equal(permit.weight, 5);
  assert.throws(() => verifyPrivateEgressPermit(token, config, 1_020), /expired/);
});
