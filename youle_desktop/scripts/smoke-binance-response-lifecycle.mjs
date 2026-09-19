import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { fetch as transportFetch } from "undici";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";

// Run with node --expose-gc. Only synthetic data on loopback is requested.
export async function verifyBinanceResponseLifecycle() {
  assert.equal(typeof globalThis.gc, "function", "Run with --expose-gc");
  const candles = [[1, "93.1", "94.2", "92.8", "93.7", "100"]];
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "application/json", "x-haolo-cache": "MISS" });
    response.end(JSON.stringify(candles));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const localUrl = `http://127.0.0.1:${server.address().port}/klines`;
  const config = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_ROUTING_MODE: "gateway",
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private.haolo.example",
  });
  const router = new BinanceNetworkRouter({ config, gatewayClient: { fetch: () => transportFetch(localUrl) } });
  const governor = new BinanceRequestGovernor();
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=HYPEUSDT&interval=1h";
  try {
    const fetchAfterCollection = async (url, init) => {
      const response = await router.publicFetch(url, init);
      // No reference to the transport's original Response survives the router.
      // Undici's finalizer used to cancel the shared body during this interval.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        globalThis.gc();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(response.bodyUsed, false, "GC must not consume an unread routed response");
      return response;
    };
    const responses = await Promise.all([
      governor.fetch(fetchAfterCollection, input),
      governor.fetch(fetchAfterCollection, input),
    ]);
    assert.equal(requests, 1, "concurrent chart requests must share one HTTP request");
    for (const response of responses) {
      assert.equal(response.headers.get("x-haolo-binance-route"), "public-gateway");
      assert.equal(response.headers.get("x-haolo-binance-egress"), "haolo-public");
      assert.equal(response.headers.get("x-haolo-cache"), "MISS");
      assert.deepEqual(await response.json(), candles);
    }
    assert.equal(governor.snapshot().coalesced, 1);
    return { requests, readers: responses.length, garbageCollections: 20 };
  } finally {
    router.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await verifyBinanceResponseLifecycle()));
}
