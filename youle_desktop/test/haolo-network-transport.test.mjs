import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { createHaoloNetworkTransport, openHaoloSocket } from "../src/main/haolo-network-transport.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { AppServerClient } from "../src/main/app-server-client.mjs";

// Public test-only key and certificate. Never used by a deployed server.
const key = fs.readFileSync(new URL("fixtures/haolo-network/server-key.pem", import.meta.url));
const cert = fs.readFileSync(new URL("fixtures/haolo-network/server-cert.pem", import.meta.url));
const region = (value) => ({ schemaVersion: 1, service: "haolo-network-policy", egressRegion: value, accelerationEnabled: true });
async function listen(server, t) {
  const sockets = new Set();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return server.address().port;
}

async function fixture(t, { proxy = "DIRECT", egressRegion = "CN", handler } = {}) {
  const requests = [], connections = [], proxyConnects = [];
  let finishStream;
  const server = https.createServer({ key, cert }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, host: req.headers.host, sni: req.socket.servername, headers: req.headers, body: Buffer.concat(chunks) });
    if (handler) return handler(req, res);
    if (req.url === "/.well-known/haolo-network") return res.end(JSON.stringify(region(egressRegion)));
    if (req.url.startsWith("/v1/")) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n");
      finishStream = () => res.end("data: [DONE]\n\n"); return;
    }
    res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
  });
  const port = await listen(server, t);
  const proxyServer = http.createServer();
  proxyServer.on("connect", (req, socket, head) => {
    proxyConnects.push({ target: req.url, headers: req.headers });
    const upstream = net.connect(port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    socket.on("close", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
  });
  const proxyPort = await listen(proxyServer, t);
  let currentProxy = proxy === "PROXY" ? `PROXY 127.0.0.1:${proxyPort}` : proxy;
  const transport = createHaoloNetworkTransport({ resolveProxy: async () => currentProxy,
    fallbackFetch: async () => { throw new Error("unexpected fallback"); },
    openSocket: (url, decision, options) => {
      connections.push(decision);
      const target = new URL(url); target.port = String(port);
      return openHaoloSocket(target, { ...decision, addresses: decision.proxyUrl ? decision.addresses : ["127.0.0.1"] }, { ...options, ca: cert });
    } });
  t.after(() => transport.close());
  return { transport, server, port, requests, connections, proxyConnects,
    finish: () => finishStream(), setProxy: (value) => { currentProxy = value === "PROXY" ? `PROXY 127.0.0.1:${proxyPort}` : value; } };
}

test("real TLS keeps canonical Host/SNI, DIRECT models stay ordinary and streams arrive before completion", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const response = await f.transport.fetch("https://haolo.pro/v1/responses", { method: "POST", headers: { authorization: "Bearer test-only" }, body: '{"stream":true}', signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  assert.equal(f.connections.at(-1).route, "ordinary");
  assert.deepEqual(f.connections.at(-1).addresses, ["8.216.43.79"]);
  assert.equal(f.requests.some((r) => r.url === "/.well-known/haolo-network"), false);
  const request = f.requests.at(-1);
  assert.equal(request.host, "haolo.pro"); assert.equal(request.sni, "haolo.pro");
  assert.equal(request.headers.authorization, "Bearer test-only");
  controller.abort(); await assert.rejects(reader.read(), { name: "AbortError" });
  assert.equal(f.requests.filter((r) => r.url === "/v1/responses").length, 1);
});

test("DIRECT mainland market REST and WebSocket still use GA", async (t) => {
  const f = await fixture(t);
  const response = await f.transport.fetch("https://market.youle.pro/api/v3/time");
  assert.equal(response.status, 200); await response.json();
  assert.equal(f.connections.at(-1).route, "hong-kong-ga");
  assert.deepEqual(f.connections.at(-1).addresses, ["47.75.103.197", "47.75.125.102"]);
  const wss = new WebSocketServer({ server: f.server }); t.after(() => wss.close());
  wss.on("connection", (socket) => socket.send('{"stream":"btcusdt@ticker"}'));
  const Routed = f.transport.webSocketClass(WebSocket);
  const socket = new Routed("wss://market.youle.pro/stream"); t.after(() => socket.terminate());
  const [frame] = await once(socket, "message");
  assert.equal(JSON.parse(String(frame)).stream, "btcusdt@ticker");
  assert.equal(f.connections.at(-1).route, "hong-kong-ga");
  socket.close(); await once(socket, "close");
});

test("HTTP proxy CONNECT targets ordinary IP and never receives the origin Authorization header", async (t) => {
  const f = await fixture(t, { proxy: "PROXY" });
  const response = await f.transport.fetch("https://haolo.com/api/profile/me", { headers: { authorization: "Bearer test-only" } });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.connections[0].route, "ordinary");
  assert.equal(f.proxyConnects[0].target, `8.219.93.44:${f.port}`);
  assert.equal(f.proxyConnects[0].headers.authorization, undefined);
  assert.equal(f.requests[0].headers.authorization, "Bearer test-only");
  assert.equal(f.requests.length, 1, "a configured proxy must not trigger a direct geolocation probe");
});

test("proxy changes affect new connections without interrupting an existing model stream", async (t) => {
  const f = await fixture(t);
  const first = await f.transport.fetch("https://haolo.pro/v1/responses", { method: "POST", body: "{}" });
  const reader = first.body.getReader(); await reader.read();
  f.setProxy("PROXY");
  const second = await f.transport.fetch("https://haolo.com/api/auth/config"); await second.text();
  assert.equal(f.connections.at(-1).route, "ordinary");
  f.finish(); assert.equal(new TextDecoder().decode((await reader.read()).value), "data: [DONE]\n\n");
});

test("market WebSocket uses the same proxy/ordinary route and receives an actual frame", async (t) => {
  const f = await fixture(t, { proxy: "PROXY" });
  const wss = new WebSocketServer({ server: f.server }); t.after(() => wss.close());
  wss.on("connection", (socket) => socket.send('{"stream":"btcusdt@ticker","data":{"c":"1"}}'));
  const RoutedWebSocket = f.transport.webSocketClass(WebSocket);
  const socket = new RoutedWebSocket("wss://market.youle.pro/stream?ticket=test-only");
  t.after(() => socket.terminate());
  const [message] = await once(socket, "message");
  assert.equal(JSON.parse(message.toString()).stream, "btcusdt@ticker");
  assert.equal(f.connections.at(-1).route, "ordinary");
  assert.equal(f.proxyConnects.at(-1).target, `8.219.93.44:${f.port}`);
  socket.close(); await once(socket, "close");
});

test("model local relay uses the routed transport and preserves streaming POST exactly once", async (t) => {
  const f = await fixture(t, { proxy: "PROXY" });
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://haolo.pro/v1", fetch: f.transport.fetch });
  await relay.start(); t.after(() => relay.stop());
  const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", headers: { authorization: "Bearer test-only", "content-type": "application/json" }, body: '{"model":"test","stream":true}' });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: first/);
  f.finish(); await reader.read();
  assert.equal(f.requests.filter((r) => r.url === "/v1/responses").length, 1);
  assert.equal(f.connections[0].addresses[0], "8.216.43.79");
});

test("TLS hostname mismatch is rejected and proxy rejection never falls back to GA", async (t) => {
  const f = await fixture(t);
  await assert.rejects(openHaoloSocket(`https://wrong.example:${f.port}`, { addresses: ["127.0.0.1"] }, { ca: cert }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  const proxy = http.createServer(); proxy.on("connect", (_req, socket) => socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"));
  const port = await listen(proxy, t);
  await assert.rejects(openHaoloSocket("https://haolo.com", { addresses: ["8.219.93.44"], proxyUrl: `http://127.0.0.1:${port}` }), { code: "HAOLO_PROXY_CONNECT", status: 407 });
});

test("Responses WebSocket relay preserves text frames, auth, immediate events and close", async (t) => {
  const f = await fixture(t, { proxy: "PROXY" });
  const wss = new WebSocketServer({ server: f.server }); t.after(() => wss.close());
  let received = 0;
  wss.on("connection", (socket, request) => {
    assert.equal(request.headers.authorization, "Bearer ws-test-only");
    socket.send('{"type":"session.created"}');
    socket.on("message", (bytes, binary) => {
      received++; assert.equal(binary, false); assert.equal(JSON.parse(String(bytes)).type, "response.create");
      socket.send('{"type":"response.completed"}');
    });
  });
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://haolo.pro/v1", fetch: f.transport.fetch, WebSocketImpl: f.transport.webSocketClass(WebSocket) });
  await relay.start(); t.after(() => relay.stop());
  const socket = new WebSocket(`${relay.localBaseUrl().replace(/^http:/, "ws:")}/responses`, { headers: { authorization: "Bearer ws-test-only" } });
  t.after(() => socket.terminate());
  const frames = [];
  socket.on("message", (bytes, binary) => { assert.equal(binary, false); frames.push(JSON.parse(String(bytes)).type); });
  await once(socket, "open");
  socket.send('{"type":"response.create"}');
  const deadline = AbortSignal.timeout(3000);
  while (!frames.includes("response.completed")) await once(socket, "message", { signal: deadline });
  assert.deepEqual(frames, ["session.created", "response.completed"]);
  assert.equal(received, 1); assert.equal(f.connections.at(-1).addresses[0], "8.216.43.79");
  socket.close(1000); await once(socket, "close");
});

test("SOCKS5 negotiates an IP tunnel and verifies the original TLS hostname", async (t) => {
  const f = await fixture(t);
  let destination;
  const proxy = net.createServer((socket) => {
    let buffer = Buffer.alloc(0), stage = 0;
    const receive = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0 && buffer.length >= 2 + buffer[1]) {
        assert.equal(buffer[0], 5); buffer = buffer.subarray(2 + buffer[1]); stage = 1;
        socket.write(Buffer.from([5, 0]));
      }
      if (stage === 1 && buffer.length >= 10) {
        assert.equal(buffer[3], 1, "SOCKS must receive the selected IP, never the GA DNS name");
        destination = [...buffer.subarray(4, 8)].join(".");
        stage = 2; socket.off("data", receive);
        const upstream = net.connect(f.port, "127.0.0.1", () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on("error", () => socket.destroy()); socket.on("close", () => upstream.destroy());
      }
    };
    socket.on("data", receive);
  });
  const port = await listen(proxy, t);
  const socket = await openHaoloSocket(`https://haolo.com:${f.port}`, { addresses: ["8.219.93.44"], proxyUrl: `socks5://127.0.0.1:${port}` }, { ca: cert });
  assert.equal(destination, "8.219.93.44"); assert.equal(socket.authorized, true); socket.destroy();
});

test("a stalled CONNECT is cancelled within the connect deadline", async (t) => {
  const proxy = http.createServer(); proxy.on("connect", () => {});
  const port = await listen(proxy, t); const started = Date.now();
  await assert.rejects(openHaoloSocket("https://haolo.com", { addresses: ["8.219.93.44"], proxyUrl: `http://127.0.0.1:${port}` }, { connectTimeoutMs: 100 }));
  assert.ok(Date.now() - started < 1000);
});

test("the production GPT route cannot bypass policy through the legacy relay:false flag", async (t) => {
  const client = new AppServerClient({ modelRelayFetch: async () => new Response("fixture") });
  t.after(() => client.stopModelRequestRelays());
  const routes = await client.startModelRequestRelays({
    default: { baseUrl: "https://haolo.pro/v1", relay: false },
    custom: { baseUrl: "https://custom.example/v1", relay: false },
  });
  assert.equal(routes.default.relay, true);
  assert.match(routes.default.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.deepEqual(routes.custom, { baseUrl: "https://custom.example/v1", relay: false });
});

test("a paid POST whose origin closes the connection is not replayed", async (t) => {
  const f = await fixture(t, { proxy: "PROXY", handler: (req) => req.socket.destroy() });
  await assert.rejects(f.transport.fetch("https://haolo.pro/v1/responses", { method: "POST", body: "{}" }));
  assert.equal(f.requests.length, 1);
});
