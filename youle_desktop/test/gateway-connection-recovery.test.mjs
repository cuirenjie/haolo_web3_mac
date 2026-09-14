import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import test from "node:test";
import { createGatewayRouteLookup } from "../src/main/gateway-route-lookup.mjs";
import { performHttpsConnectRequest } from "../src/main/binance-account/private-proxy-fetch.mjs";
import { createProxyFreeHttpsFetch } from "../src/main/proxy-free-https-fetch.mjs";
import { TradingMarketDataHub } from "../src/main/trading-market-data-hub.mjs";

const resolveAddress = (lookup, host) => new Promise((resolve, reject) => {
  lookup(host, { family: 4 }, (error, address) => error ? reject(error) : resolve(address));
});
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Fixture did not reach expected state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function routeFixture(a = "203.0.113.1", b = "203.0.113.2") {
  const hostname = "gateway-recovery.invalid";
  let clock = 0;
  let winner = a;
  const invalidated = [];
  const probes = [];
  const lookup = createGatewayRouteLookup({
    routes: [{ origin: `https://${hostname}`, service: "fixture", candidates: [a, b] }],
    now: () => clock, cacheTtlMs: 100,
    lookupImpl(_host, _options, callback) { queueMicrotask(() => callback(new Error("fixture DNS unavailable"))); },
    probeImpl: async ({ address }) => { probes.push(address); if (winner && address !== winner) throw new Error("fixture route unavailable"); },
  });
  const invalidate = lookup.invalidate;
  lookup.invalidate = (host, address) => { invalidated.push({ host, address }); invalidate(host, address); };
  return { hostname, lookup, invalidated, probes, a, b,
    async selectB() { clock = 101; winner = b; assert.equal(await resolveAddress(lookup, hostname), b); },
    async assertBRetained() {
      winner = null;
      const count = probes.length;
      assert.equal(await resolveAddress(lookup, hostname), b);
      assert.equal(probes.length, count, "the healthy cache must not be evicted or re-probed");
    },
  };
}

test("late private TLS failure invalidates A while retaining the newer healthy B", async () => {
  const f = routeFixture();
  const socket = new EventEmitter();
  socket.destroy = () => {};
  const tlsModule = { connect(options) {
    options.lookup(options.host, { family: 4 }, (error, address) => {
      assert.equal(error, null); socket.remoteAddress = address;
    });
    return socket;
  } };
  try {
    const request = performHttpsConnectRequest({
      target: new URL("https://fapi.binance.com/fapi/v3/account"), proxy: new URL(`https://${f.hostname}`),
      permitToken: "local-fixture", lookup: f.lookup, tlsModule,
    }).catch((error) => error);
    await until(() => socket.remoteAddress === f.a);
    await f.selectB();
    socket.emit("error", Object.assign(new Error("old TLS connection reset"), { code: "ECONNRESET" }));
    assert.equal((await request).code, "ECONNRESET");
    assert.deepEqual(f.invalidated, [{ host: f.hostname, address: f.a }]);
    await f.assertBRetained();
  } finally { f.lookup.close(); }
});

test("late HTTPS failure retains its DNS result after the socket loses remoteAddress", async () => {
  const f = routeFixture();
  let request;
  let selected;
  const network = createProxyFreeHttpsFetch({ allowedOrigins: [`https://${f.hostname}`], routeLookup: f.lookup,
    requestImpl(url, options) {
      request = new EventEmitter();
      request.socket = {}; request.end = () => {}; request.destroy = () => {};
      options.lookup(url.hostname, { family: 4 }, (error, address) => { assert.equal(error, null); selected = address; });
      return request;
    }, agent: { destroy() {} } });
  try {
    const response = network(`https://${f.hostname}/api/market/test`).catch((error) => error);
    await until(() => selected === f.a);
    await f.selectB();
    request.emit("error", Object.assign(new Error("old connection reset"), { code: "ECONNRESET" }));
    assert.equal((await response).code, "ECONNRESET");
    assert.deepEqual(f.invalidated, [{ host: f.hostname, address: f.a }]);
    await f.assertBRetained();
  } finally { network.close(); }
});

test("real ws pre-upgrade failure retains the newer gateway cache", async () => {
  const f = routeFixture("127.0.0.1", "127.0.0.2");
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const hub = new TradingMarketDataHub({
    endpointProvider: () => ({ url: `ws://${f.hostname}:${server.address().port}`, route: "gateway" }),
    lookupProvider: () => f.lookup, handshakeTimeoutMs: 2000, reconnectBaseMs: 60000,
  });
  try {
    hub.subscribe({ marketType: "futures", streams: ["btcusdt@aggTrade"] }, () => {});
    await until(() => sockets.size === 1);
    const channel = [...hub.channels.values()][0];
    await until(() => channel.socket?._req?.socket?.remoteAddress === f.a);
    assert.equal(channel.socket._socket, null);
    await f.selectB();
    [...sockets][0].destroy();
    await until(() => f.invalidated.length > 0);
    assert.deepEqual(f.invalidated, [{ host: f.hostname, address: f.a }]);
    await f.assertBRetained();
  } finally {
    hub.close(); f.lookup.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("WebSocket constructor failure before address selection preserves the healthy cache", async () => {
  const f = routeFixture();
  await f.selectB();
  const outcomes = [];
  const hub = new TradingMarketDataHub({
    endpointProvider: () => ({ url: `wss://${f.hostname}/stream/futures`, route: "gateway" }),
    lookupProvider: () => f.lookup, reconnectBaseMs: 60000,
    endpointFailureReporter: (outcome) => outcomes.push(outcome),
    WebSocketImpl: class { constructor() { throw new Error("constructor failed before DNS"); } },
  });
  try {
    hub.subscribe({ marketType: "futures", streams: ["btcusdt@aggTrade"] }, () => {});
    await until(() => outcomes.length > 0);
    assert.deepEqual(f.invalidated, []);
    await f.assertBRetained();
  } finally { hub.close(); f.lookup.close(); }
});
