// Local synthetic replay only; no upstream, account, order or production calls.
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { startGateway } from "../src/server.mjs";
import { loadGatewayConfig } from "../src/config.mjs";
import { GatewayCache } from "../src/cache.mjs";

const count = Number(process.argv[2] || 375);
const percent = Number(process.argv[3] || 0);
if (!Number.isInteger(count) || count < 1 || count > 10000 || ![0, 5, 25, 50, 100].includes(percent)) throw Error("usage: node benchmark-market-fanout.mjs [1..10000 clients] [0|5|25|50|100 compression]");
const config = { ...loadGatewayConfig({ HAOLO_GATEWAY_ROLE: "market", HAOLO_GATEWAY_ALLOW_ANONYMOUS_PUBLIC: "false", HAOLO_AUTH_API_ORIGIN: "https://haolo.com", HAOLO_MARKET_WS_COMPRESSION_PERCENT: String(percent) }),
  publicHost: "127.0.0.1", publicPort: 0, maxWebsocketClientsTotal: count + 1, downstreamRequestsPerMinute: 100000 };
const cache = new GatewayCache();
const listeners = new Set();
const gateway = await startGateway({ config, cache, restGateway: { cache },
  accessTokenVerifier: { verify: async (token) => ({ userId: token }) },
  streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { listeners.add(listener); return () => listeners.delete(listener); }, close: async () => {} } });
const clients = [], latencies = [], sequences = [];
let wireBytes = 0, messages = 0, errors = 0;
try {
  for (let start = 0; start < count; start += 50) {
    await Promise.all(Array.from({ length: Math.min(50, count - start) }, async (_, offset) => {
      const index = start + offset;
      const client = new WebSocket(`ws://127.0.0.1:${gateway.publicGateway.server.address().port}/stream/futures?streams=btcusdt@aggTrade`, { headers: { authorization: `Bearer replay-${index}` } });
      clients.push(client); sequences[index] = -1;
      client.on("message", (raw) => {
        const { data } = JSON.parse(String(raw));
        if (data.sequence !== sequences[index] + 1) errors++;
        sequences[index] = data.sequence; messages++; latencies.push(performance.now() - data.sent);
      });
      await once(client, "open");
    }));
  }
  const cpu = process.cpuUsage(), start = performance.now();
  for (let sequence = 0; sequence < 100; sequence++) {
    const event = Object.freeze({ stream: "btcusdt@aggTrade", data: { sequence, sent: performance.now(), p: "60000.1234", q: "0.001", fixturePadding: "x".repeat(1500) } });
    for (const listener of listeners) listener(event);
    await delay(25);
  }
  const deadline = Date.now() + 30000;
  while (messages < count * 100 && Date.now() < deadline) await delay(20);
  for (const client of clients) wireBytes += client._socket.bytesRead;
  latencies.sort((a, b) => a - b);
  const usage = process.cpuUsage(cpu);
  console.log(JSON.stringify({ clients: count, compressionPercent: percent, messages, expected: count * 100, sequenceErrors: errors,
    elapsedMs: performance.now() - start, p95Ms: latencies[Math.floor(latencies.length * .95)], p99Ms: latencies[Math.floor(latencies.length * .99)],
    cpuMs: (usage.user + usage.system) / 1000, rssBytes: process.memoryUsage().rss, wireBytes,
    warning: "Synthetic single-host replay; not Hong Kong capacity or WAN latency acceptance." }));
  if (messages !== count * 100 || errors) process.exitCode = 1;
} finally {
  await Promise.all(clients.map(async (client) => { const done = once(client, "close"); client.close(); await done; }));
  await gateway.close();
}
