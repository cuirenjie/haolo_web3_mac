import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import net from "node:net";
import test from "node:test";
import { GatewayCache } from "../src/cache.mjs";
import { PrivateEgressCoordinator } from "../src/private-egress-coordinator.mjs";
import { createPrivateProxyServer, isPublicAddress } from "../src/private-proxy.mjs";
import { baseConfig } from "./helpers.mjs";

class FakeUpstream extends Duplex {
  _read() {}
  _write(_chunk, _encoding, callback) { callback(); }
  setTimeout() { return this; }
}

async function connectRequest(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
    let value = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      value += chunk;
      if (value.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(value);
      }
    });
    socket.on("error", reject);
  });
}

test("private proxy authenticates, enforces host allowlist and opens an opaque tunnel", async (t) => {
  const config = baseConfig();
  const cache = new GatewayCache();
  const coordinator = new PrivateEgressCoordinator({ config, cache });
  const proxy = createPrivateProxyServer({
    config,
    cache,
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect: () => {
      const upstream = new FakeUpstream();
      process.nextTick(() => upstream.emit("connect"));
      return upstream;
    },
  });
  await proxy.listen();
  t.after(() => proxy.close());
  const port = proxy.server.address().port;
  const ready = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(ready.status, 200);
  const deniedMetrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(deniedMetrics.status, 401);
  const allowedMetrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: { authorization: `Bearer ${config.metricsToken}` },
  });
  assert.equal(allowedMetrics.status, 200);
  assert.match(await allowedMetrics.text(), /haolo_private_proxy_activeTunnels/);
  const unauthenticated = await connectRequest(port, "CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\n\r\n");
  assert.match(unauthenticated, /^HTTP\/1\.1 407/);
  const permit = await coordinator.issuePermit(
    { userId: "00000000-0000-0000-0000-000000000001" },
    { marketType: "futures", pathname: "/fapi/v3/account", hasSymbol: false },
  );
  const auth = Buffer.from(`haolo:${permit.permitToken}`).toString("base64");
  const forbidden = await connectRequest(port, `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
  assert.match(forbidden, /^HTTP\/1\.1 403/);
  const accepted = await connectRequest(port, `CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
  assert.match(accepted, /^HTTP\/1\.1 200 Connection Established/);
  assert.equal(proxy.metrics.acceptedTunnels, 1);
  const replayed = await connectRequest(port, `CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
  assert.match(replayed, /^HTTP\/1\.1 409/);
});

test("private proxy rejects private, shared, mapped and documentation addresses", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("100.64.0.1"), false);
  assert.equal(isPublicAddress("203.0.113.10"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), false);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
