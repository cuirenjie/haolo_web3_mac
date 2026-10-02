// Real loopback sockets, synthetic input. Not WAN/cross-ISP capacity acceptance.
import assert from "node:assert/strict";
import { once } from "node:events";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { decodeMarketPayload } from "../src/market-wire-codec.mjs";
import { baseConfig } from "../test/helpers.mjs";

const count = Number(process.argv[2] || 160);
const codec = process.argv[3] || "json";
if (!Number.isInteger(count) || count < 1 || count > 2000 || !["json", "hmc1"].includes(codec)) throw new Error("usage: benchmark-market-codec.mjs [clients <= 2000] [json|hmc1]");
const listeners = new Set();
const gateway = createPublicGatewayServer({ config: baseConfig({ marketCompactEnabled: true, maxWebsocketClientsTotal: count + 1,
  marketNodeTier: "paid", downstreamRequestsPerMinute: 100000 }), restGateway: { cache: new GatewayCache() },
  accessTokenVerifier: { verify: async (userId) => ({ userId, marketTier: "paid", membershipExpiresAt: Date.now() + 3600000 }) },
  streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { listeners.add(listener); return () => listeners.delete(listener); } } });
await gateway.listen();
const clients = [], latencies = [], sequences = [], offsets = [];
let messages = 0, errors = 0;
try {
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  for (let offset = 0; offset < count; offset += 40) await Promise.all(Array.from({ length: Math.min(40, count - offset) }, async (_, index) => {
    const id = offset + index;
    const response = await fetch(origin + "/api/market/v1/tickets", { method: "POST", headers: { authorization: `Bearer fixture-${id}`, "x-haolo-market-routing": "1" }, body: JSON.stringify({ codecs: [codec] }) });
    const { ticket } = await response.json();
    const client = new WebSocket(origin.replace("http", "ws") + `/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket}`, { perMessageDeflate: false });
    clients[id] = client; sequences[id] = -1;
    client.on("message", (raw) => {
      const { data } = decodeMarketPayload(JSON.parse(String(raw)));
      if (data.a !== sequences[id] + 1 || data.p !== "65123.12345678" || data.q !== "0.00000100") errors++;
      sequences[id] = data.a;
      messages++; latencies.push(performance.now() - data.E);
    });
    await once(client, "open");
    offsets[id] = client._socket.bytesRead;
  }));
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const cpu = process.cpuUsage(), started = performance.now();
  for (let sequence = 0; sequence < 500; sequence++) {
    const event = Object.freeze({ stream: "btcusdt@aggTrade", data: { e: "aggTrade", E: performance.now(), s: "BTCUSDT", a: sequence,
      p: "65123.12345678", q: "0.00000100", f: sequence, l: sequence, T: Date.now(), m: false, M: true } });
    for (const publish of listeners) publish(event);
    await delay(10);
  }
  const deadline = Date.now() + 5000;
  while (messages < count * 500 && Date.now() < deadline) await delay(10);
  const used = process.cpuUsage(cpu); lag.disable(); latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ codec, clients: count, messages, expected: count * 500, sequenceOrPrecisionErrors: errors,
    elapsedMs: performance.now() - started, p95Ms: latencies[Math.floor(latencies.length * .95)], p99Ms: latencies[Math.floor(latencies.length * .99)],
    eventLoopP99Ms: lag.percentile(99) / 1e6, cpuMs: (used.user + used.system) / 1000, rssBytes: process.memoryUsage().rss,
    socketBytes: clients.reduce((sum, client, id) => sum + client._socket.bytesRead - offsets[id], 0),
    applicationBytes: gateway.metrics.websocketMarketPayloadBytes }));
  assert.equal(messages, count * 500); assert.equal(errors, 0);
} finally {
  await Promise.all(clients.map(async (client) => { const done = once(client, "close"); client.close(); await done; }));
  await gateway.close();
}
