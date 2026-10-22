// Gateway and synthetic clients use independent processes so client decoding
// does not count as gateway CPU. Loopback results are not WAN acceptance.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createPublicGatewayServer } from '../src/public-server.mjs';
import { GatewayCache } from '../src/cache.mjs';
import { decodeMarketPayload } from '../src/market-wire-codec.mjs';
import { baseConfig } from '../test/helpers.mjs';

const stamp = () => performance.timeOrigin + performance.now();
const count = Number(process.argv[2] || 320), codec = process.argv[3] || 'json';
assert(Number.isInteger(count) && count >= 1 && count <= 2000);
assert(['json', 'hmc1'].includes(codec));

if (process.argv[4] === 'client') {
  const origin = process.argv[5], clients = [], offsets = [], sequence = Array(count).fill(-1), latencies = [];
  let messages = 0, errors = 0, cpu;
  const completed = new Promise(resolve => {
    process.on('message', command => {
      if (command === 'start') { cpu = process.cpuUsage(); process.send({ type: 'started' }); }
      if (command === 'finish') resolve();
    });
  });
  await Promise.all(Array.from({ length: count }, async (_, id) => {
    const ticket = await (await fetch(origin + '/api/market/v1/tickets', { method: 'POST',
      headers: { authorization: `Bearer client-${id}` }, body: JSON.stringify({ codecs: [codec] }) })).json();
    const client = new WebSocket(origin.replace('http:', 'ws:') + `/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket.ticket}`, { perMessageDeflate: false });
    clients[id] = client;
    client.on('message', raw => {
      const { data } = decodeMarketPayload(JSON.parse(String(raw)));
      if (data.a !== sequence[id] + 1 || data.p !== '65123.12345678' || data.q !== '0.00000100') errors++;
      sequence[id] = data.a; messages++; latencies.push(stamp() - data.E);
      if (messages === count * 500) process.send({ type: 'delivered' });
    });
    await once(client, 'open'); offsets[id] = client._socket.bytesRead;
  }));
  process.send({ type: 'ready' });
  await completed;
  const used = process.cpuUsage(cpu);
  latencies.sort((a, b) => a - b);
  process.send({ type: 'result', messages, expected: count * 500, sequenceOrPrecisionErrors: errors,
    p95Ms: latencies[Math.floor(latencies.length * .95)], p99Ms: latencies[Math.floor(latencies.length * .99)],
    simulatedClientsCpuMs: (used.user + used.system) / 1000,
    socketBytes: clients.reduce((sum, client, id) => sum + client._socket.bytesRead - offsets[id], 0) });
  await Promise.all(clients.map(async client => { const closed = once(client, 'close'); client.close(); await closed; }));
  process.disconnect();
} else {
  const listeners = new Set();
  const gateway = createPublicGatewayServer({ config: baseConfig({ marketCompactEnabled: true,
    maxWebsocketClientsTotal: count + 1, marketNodeTier: 'paid', downstreamRequestsPerMinute: 100000 }),
    restGateway: { cache: new GatewayCache() },
    accessTokenVerifier: { verify: async userId => ({ userId, marketTier: 'paid', membershipExpiresAt: Date.now() + 3600000 }) },
    onDiagnostic: () => {},
    streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { listeners.add(listener); return () => listeners.delete(listener); } } });
  await gateway.listen();
  const worker = fork(fileURLToPath(import.meta.url), [String(count), codec, 'client', `http://127.0.0.1:${gateway.server.address().port}`], { windowsHide: true });
  const waiters = new Map(), received = new Map();
  worker.on('message', message => { received.set(message.type, message); waiters.get(message.type)?.(message); });
  const wait = type => received.has(type) ? Promise.resolve(received.get(type)) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`client ${type} timeout`)), 60000);
    waiters.set(type, result => { clearTimeout(timer); resolve(result); });
  });
  try {
    await wait('ready'); worker.send('start'); await wait('started');
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
    const cpu = process.cpuUsage(), started = performance.now();
    for (let a = 0; a < 500; a++) {
      const event = Object.freeze({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', E: stamp(), s: 'BTCUSDT', a,
        p: '65123.12345678', q: '0.00000100', f: a, l: a, T: Date.now(), m: false, M: true } });
      for (const publish of listeners) publish(event);
      await delay(10);
    }
    await wait('delivered');
    const used = process.cpuUsage(cpu); loop.disable();
    worker.send('finish');
    const result = await wait('result');
    console.log(JSON.stringify({ codec, clients: count, ...result, type: 'isolated-result',
      elapsedMs: performance.now() - started, gatewayCpuMs: (used.user + used.system) / 1000,
      gatewayEventLoopP99Ms: loop.percentile(99) / 1e6, gatewayRssBytes: process.memoryUsage().rss,
      applicationBytes: gateway.metrics.websocketMarketPayloadBytes }));
    assert.equal(result.messages, count * 500); assert.equal(result.sequenceOrPrecisionErrors, 0);
    await once(worker, 'exit');
  } finally { worker.kill(); for (const socket of gateway.websocketServer.clients) socket.terminate(); await gateway.close(); }
}
