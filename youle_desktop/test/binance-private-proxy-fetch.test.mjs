import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { BinancePrivateProxyTransport, performHttpsConnectRequest } from "../src/main/binance-account/private-proxy-fetch.mjs";

test("default transport performs outer proxy TLS, CONNECT and inner Binance TLS", async () => {
  const writes = [];
  const tlsCalls = [];
  class FakeSocket extends EventEmitter {
    constructor(onWrite = null) { super(); this.onWrite = onWrite; this.destroyed = false; }
    write(value) { writes.push(String(value)); this.onWrite?.(); return true; }
    unshift() {}
    destroy() { this.destroyed = true; }
  }
  const outer = new FakeSocket(() => queueMicrotask(() => outer.emit("data", Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n"))));
  const inner = new FakeSocket();
  const tlsModule = {
    connect(options, callback) {
      tlsCalls.push(options);
      const socket = options.socket ? inner : outer;
      queueMicrotask(callback);
      return socket;
    },
  };
  class FakeAgent { destroy() {} }
  const httpsModule = {
    Agent: FakeAgent,
    request(target, options, callback) {
      assert.equal(target.pathname, "/fapi/v3/account");
      assert.equal(target.searchParams.get("signature"), "sig");
      assert.equal(options.headers["x-mbx-apikey"], "api-key");
      const request = new EventEmitter();
      request.end = () => queueMicrotask(() => {
        const incoming = new EventEmitter();
        incoming.statusCode = 200;
        incoming.statusMessage = "OK";
        incoming.headers = { "content-type": "application/json" };
        callback(incoming);
        incoming.emit("data", Buffer.from('{"ok":true}'));
        incoming.emit("end");
      });
      request.destroy = (error) => request.emit("error", error);
      return request;
    },
  };
  const result = await performHttpsConnectRequest({
    target: new URL("https://fapi.binance.com/fapi/v3/account?signature=sig"),
    proxy: new URL("https://sg-a.private.haolo.example"),
    permitToken: "single-use-permit",
    headers: { "x-mbx-apikey": "api-key" },
    tlsModule,
    httpsModule,
    lookup: (host, options, callback) => callback(null, "203.0.113.8", 4),
  });
  assert.equal(result.upstream, true);
  assert.deepEqual(await result.response.json(), { ok: true });
  assert.equal(tlsCalls[0].host, "sg-a.private.haolo.example");
  assert.equal(tlsCalls[0].servername, "sg-a.private.haolo.example");
  assert.equal(tlsCalls[0].rejectUnauthorized, true);
  assert.equal(typeof tlsCalls[0].lookup, "function");
  assert.equal(tlsCalls[1].lookup, undefined, "only the outer proxy connection uses GA resolution");
  assert.equal(tlsCalls[1].servername, "fapi.binance.com");
  assert.equal(tlsCalls[1].rejectUnauthorized, true);
  assert.equal(tlsCalls[1].socket, outer);
  assert.match(writes[0], /^CONNECT fapi\.binance\.com:443 HTTP\/1\.1/);
  assert.match(writes[0], new RegExp(Buffer.from("haolo:single-use-permit").toString("base64")));
});

test("private account transport obtains one permit per request and reports sanitized upstream usage", async () => {
  const permitRequests = [];
  const tunnelRequests = [];
  const reports = [];
  const transport = new BinancePrivateProxyTransport({
    proxyUrl: "https://bootstrap.private.haolo.example",
    permitProvider: async (url) => {
      permitRequests.push(url);
      return {
        permitId: "permit-id-000000000001",
        permitToken: "single-use-permit",
        proxyUrl: "https://sg-a.private.haolo.example",
        targetHost: "fapi.binance.com",
      };
    },
    usageReporter: async (report) => reports.push(report),
    requestImpl: async (request) => {
      tunnelRequests.push(request);
      return {
        upstream: true,
        response: new Response('{"ok":true}', {
          status: 200,
          headers: { "x-mbx-used-weight-1m": "123" },
        }),
      };
    },
  });
  const url = "https://fapi.binance.com/fapi/v3/account?timestamp=1&signature=sig";
  const response = await transport.fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": "api-key", "Proxy-Authorization": "must-not-pass" },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(permitRequests, [url]);
  assert.equal(tunnelRequests[0].proxy.origin, "https://sg-a.private.haolo.example");
  assert.equal(tunnelRequests[0].permitToken, "single-use-permit");
  assert.deepEqual(tunnelRequests[0].headers, { "x-mbx-apikey": "api-key" });
  assert.deepEqual(reports, [{
    permitId: "permit-id-000000000001",
    status: 200,
    usedWeight1m: 123,
    retryAfterMs: 0,
  }]);
  await transport.close();
});

test("private account transport turns coordinator capacity rejection into Binance-compatible rate limit", async () => {
  const transport = new BinancePrivateProxyTransport({
    permitProvider: async () => { throw Object.assign(new Error("capacity"), { status: 429, retryAfterMs: 12_000 }); },
    requestImpl: async () => { throw new Error("must not open a tunnel"); },
  });
  const response = await transport.fetch("https://fapi.binance.com/fapi/v3/account");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "12");
  assert.equal((await response.json()).code, -1003);
});

test("private account transport fails closed for non-Binance targets, writes and mismatched permits", async () => {
  const transport = new BinancePrivateProxyTransport({
    permitProvider: async () => ({
      permitId: "permit-id-000000000001",
      permitToken: "token",
      proxyUrl: "https://sg-a.private.haolo.example",
      targetHost: "api.binance.com",
    }),
    requestImpl: async () => { throw new Error("must not be called"); },
  });
  await assert.rejects(() => transport.fetch("https://example.com/account"), /not allowed/);
  await assert.rejects(() => transport.fetch("https://fapi.binance.com/fapi/v1/order", { method: "POST" }), /GET only/);
  await assert.rejects(() => transport.fetch("https://fapi.binance.com/fapi/v3/account"), /invalid permit/);
});
