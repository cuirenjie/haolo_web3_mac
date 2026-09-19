// Electron smoke: --live checks the deployed routes. --session-file uses an
// existing legitimate login; --inference explicitly permits two tiny model calls.
// Reports contain status/route metadata only, never credentials or response text.
import { app, session } from "electron/main";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import WebSocket from "ws";
import { createElectronProxyResolver, createHaoloNetworkTransport } from "../src/main/haolo-network-transport.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { BinancePrivateProxyTransport } from "../src/main/binance-account/private-proxy-fetch.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const reportPath = argument("report");
const report = { at: new Date().toISOString(), checks: [], routes: [], connections: [] };
const transports = [], servers = [], sockets = new Set();
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "haolo-routing-smoke-")));
app.disableHardwareAcceleration();
const save = () => { if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); };
async function check(name, action) {
  report.running = name; save();
  const started = Date.now(); await action();
  report.checks.push({ name, passed: true, elapsedMs: Date.now() - started }); save();
}
const init = (extra = {}) => ({ signal: AbortSignal.timeout(20_000), ...extra });

async function main() {
  await app.whenReady();
  if (!process.argv.includes("--live")) throw new Error("Pass --live to run production read-only probes");
  const ordinary = new Set(["8.217.125.71:443", "8.216.43.79:443"]);
  const proxy = http.createServer(); servers.push(proxy);
  proxy.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  proxy.on("connect", (request, socket, head) => {
    if (!ordinary.has(request.url)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    report.connections.push({ target: request.url });
    const [host, port] = request.url.split(":");
    const upstream = net.connect({ host, port: Number(port) }, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.once("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.destroy()); socket.once("close", () => upstream.destroy());
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const proxyPort = proxy.address().port;
  function transport(name, config) {
    const ses = session.fromPartition(`routing-${name}`, { cache: false });
    const resolver = createElectronProxyResolver({ getSession: () => ({
      setProxy: () => ses.setProxy(config), forceReloadProxyConfig: () => ses.forceReloadProxyConfig(),
      resolveProxy: (url) => ses.resolveProxy(url),
    }) });
    const result = createHaoloNetworkTransport({ resolveProxy: resolver, onDiagnostic: (entry) => report.routes.push({ name, ...entry }) });
    transports.push(result); return result;
  }
  const direct = transport("direct", { mode: "direct" });
  const proxied = transport("proxy", { mode: "fixed_servers", proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`, proxyBypassRules: "<-loopback>" });
  const system = transport("system", { mode: "system" });
  for (const [name, network] of [["direct", direct], ["proxy", proxied], ["system", system]]) {
    for (const url of ["https://haolo.com/api/auth/config", "https://market.youle.pro/health", "https://haolo.pro/health"]) {
      await check(`${name}:${new URL(url).hostname}:health`, async () => {
        const response = await network.fetch(url, init()); assert.equal(response.status, 200); await response.json();
        if (name === "proxy") assert.equal(report.routes.at(-1).route, "ordinary");
      });
    }
  }
  const sessionFile = argument("session-file");
  if (sessionFile) {
    const login = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    assert.ok(login.token, "Existing session token is required");
    const deployment = JSON.parse(fs.readFileSync(new URL("../resources/binance-gateway.json", import.meta.url), "utf8"));
    const config = resolveBinanceGatewayConfig({}, deployment);
    for (const [name, network] of [["direct", direct], ["proxy", proxied]]) {
      await check(`${name}:account-profile`, async () => {
        const response = await network.fetch("https://haolo.com/api/profile/me", init({ headers: { authorization: `Bearer ${login.token}` } }));
        assert.equal(response.status, 200); const body = await response.json(); assert.ok(body);
      });
      const gateway = createBinanceGatewayClient({ config, apiClient: { getTrustedAccessToken: async () => login.token }, fetchImpl: network.fetch });
      await check(`${name}:market-rest`, async () => {
        const response = await gateway.fetch("https://market.youle.pro/api/v3/ticker/price?symbol=BTCUSDT", init());
        assert.equal(response.status, 200); assert.equal((await response.json()).symbol, "BTCUSDT");
      });
      await check(`${name}:market-websocket`, async () => {
        const endpoint = await gateway.marketStreamEndpoint({ marketType: "spot", combined: true });
        const Routed = network.webSocketClass(WebSocket);
        const socket = new Routed(endpoint, { handshakeTimeout: 12_000 });
        try {
          await once(socket, "open", { signal: AbortSignal.timeout(15_000) });
          socket.send(JSON.stringify({ method: "SUBSCRIBE", params: ["btcusdt@ticker"], id: 1 }));
          const deadline = AbortSignal.timeout(15_000);
          while (true) {
            const [bytes] = await once(socket, "message", { signal: deadline });
            if (JSON.parse(String(bytes)).stream === "btcusdt@ticker") break;
          }
        } finally { socket.terminate(); }
      });
      await check(`${name}:private-connect-readonly`, async () => {
        const privateTransport = new BinancePrivateProxyTransport({ proxyUrl: config.privateProxyUrl,
          permitProvider: (url, options) => gateway.privateRequestPermit(url, options),
          usageReporter: (usage) => gateway.reportPrivateUsage(usage), connectOuter: network.connect });
        try {
          // Public clock through the private CONNECT channel: no exchange key,
          // signed account operation, order or balance mutation is involved.
          const response = await privateTransport.fetch("https://api.binance.com/api/v3/time", init());
          assert.equal(response.status, 200); assert.ok((await response.json()).serverTime > 0);
        } finally { await privateTransport.close(); }
      });
      if (process.argv.includes("--inference")) await check(`${name === "proxy" ? "system-proxy" : name}:model-responses-websocket`, async () => {
        const modelNetwork = name === "proxy" ? system : network;
        const credential = login.modelKeys.find((item) => item.provider === "codex"); assert.ok(credential?.apiKey);
        const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://haolo.pro/v1", fetch: modelNetwork.fetch, WebSocketImpl: modelNetwork.webSocketClass(WebSocket) });
        relay.on("websocket-frame", (frame) => { report.relayFrames ||= []; report.relayFrames.push(frame); save(); });
        await relay.start();
        let socket;
        try {
          socket = new WebSocket(`${relay.localBaseUrl().replace(/^http:/, "ws:")}/responses`, {
            headers: { authorization: `Bearer ${credential.apiKey}`, "OpenAI-Beta": "responses_websockets=2026-02-06", "X-Haolo-Model-Pool": "execution" }, handshakeTimeout: 20_000 });
          socket.once("close", (code, reason) => { report.modelClose = { code, reason: String(reason).slice(0, 120) }; save(); });
          await once(socket, "open", { signal: AbortSignal.timeout(22_000) });
          report.modelOpened = true; save();
          socket.send(JSON.stringify({ type: "response.create", model: "gpt-5.6-sol", instructions: "Respond briefly.", input: [{ role: "user", content: [{ type: "input_text", text: "Reply with OK only." }] }], max_output_tokens: 128, reasoning: { effort: "low" }, store: false }));
          report.modelSent = true; save();
          const deadline = AbortSignal.timeout(60_000);
          while (true) {
            const [bytes] = await once(socket, "message", { signal: deadline });
            const event = JSON.parse(String(bytes));
            report.modelEvents ||= [];
            report.modelEvents.push({ route: name, type: event.type || "unknown", status: event.response?.status, errorCode: event.error?.code || event.response?.error?.code });
            save();
            if (["response.failed", "response.incomplete", "error"].includes(event.type) || event.error) throw new Error(`Model returned ${event.type || "error"}`);
            if (event.type === "response.completed") { report.modelCompleted = (report.modelCompleted || 0) + 1; break; }
          }
        } finally { socket?.terminate(); await relay.stop(); }
      });
    }
  }
  report.passed = true; delete report.running; save();
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, modelCompleted: report.modelCompleted || 0 }));
}
main().catch((error) => { report.passed = false; report.error = { name: error.name, code: error.code, message: error.message.slice(0, 180) }; save(); console.error(JSON.stringify(report.error)); process.exitCode = 1; }).finally(() => {
  for (const transport of transports) transport.close();
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  app.exit(process.exitCode || 0);
});
