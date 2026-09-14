// Run with Electron, not Node. All writes hit a local fixture. --live adds only
// anonymous GETs to the public HaoLo config/update endpoints.
import { app, session } from "electron/main";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createSystemProxyFetch } from "../src/main/system-proxy-fetch.mjs";
import { createHaoloServiceFetch, fetchServiceJson } from "../src/main/haolo-service-fetch.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "haolo-service-smoke-")));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("host-resolver-rules", "MAP haolo-network.invalid ~NOTFOUND");
const reportFile = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
const report = { at: new Date().toISOString(), electron: process.versions.electron, checks: [] };
const sessions = [];
const servers = [];
const stalledTlsServers = [];
let writes = 0;
let rejectWrite = false;

function handler(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST") {
    writes++;
    if (rejectWrite) { request.socket.destroy(); return; }
  }
  request.resume();
  if (url.pathname.endsWith("/export")) {
    response.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    response.end(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
  } else if (url.pathname.endsWith("/events/stream")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: fixture-event\n\n");
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(url.pathname === "/api/auth/config"
      ? { enabled_channels: ["email"], default_channel: "email" }
      : { items: [], challenge_id: "fixture-challenge" }));
  }
}

async function listen() {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server.address().port;
}

function transport(name, config, refreshedConfig = config) {
  const ses = session.fromPartition(`haolo-smoke-${name}`, { cache: false });
  sessions.push(ses);
  let refreshes = 0;
  // The production module requests system mode. Map that to an isolated test
  // session configuration instead of modifying the machine's Windows proxy.
  const fetch = createSystemProxyFetch({ getSession: () => ({
    setProxy: async (requested) => { assert.deepEqual(requested, { mode: "system" }); await ses.setProxy(config); },
    forceReloadProxyConfig: async () => { refreshes++; await ses.setProxy(refreshedConfig); await ses.forceReloadProxyConfig(); },
    fetch: (url, init) => ses.fetch(url, init),
  }) });
  return { fetch, refreshes: () => refreshes };
}

async function check(name, run) {
  const startedAt = Date.now();
  report.running = name;
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  let timer;
  try {
    await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Smoke check timed out: ${name}`)), 20000); })]);
  } finally { clearTimeout(timer); }
  report.checks.push({ name, passed: true, elapsedMs: Date.now() - startedAt });
  delete report.running;
}

async function run() {
try {
  const port = await listen();
  const local = `http://127.0.0.1:${port}`;
  const proxy = { mode: "fixed_servers", proxyRules: `http://127.0.0.1:${port}`, proxyBypassRules: "<-loopback>" };
  await check("no-proxy direct HTTP", async () => {
    const direct = transport("direct", { mode: "direct" });
    assert.equal((await direct.fetch(`${local}/api/auth/config`)).status, 200);
  });
  await check("blocked Node/direct DNS", async () => {
    await assert.rejects(fetch("http://haolo-network.invalid/api/auth/config", { signal: AbortSignal.timeout(2000) }));
  });
  await check("account operations work through a proxy without TUN", async () => {
    const network = transport("proxy", proxy);
    const client = new YouleApiClient({ serviceFetch: createHaoloServiceFetch({ fetchImpl: network.fetch }) });
    client.baseUrl = "http://haolo-network.invalid";
    client.loaded = true;
    client.token = "fixture-token-not-a-real-account";
    client.save = async () => {};
    await client.sendOtp({ identifier: "fixture@example.test", channel: "email" });
    await client.listWeb3RechargeHistory();
    const binary = await client.exportConsumptionReport();
    assert.equal(binary.byteLength, 5);
    const stream = await client.openChannelEventStream();
    assert.match(new TextDecoder().decode((await stream.reader.read()).value), /fixture-event/);
    stream.controller.abort();
    await stream.reader.cancel().catch(() => {});
  });
  await check("stale proxy reload recovers an actual Chromium request", async () => {
    const network = transport("stale", { mode: "fixed_servers", proxyRules: "http://127.0.0.1:1" }, proxy);
    assert.equal((await network.fetch("http://haolo-network.invalid/api/auth/config")).status, 200);
    assert.equal(network.refreshes(), 1);
  });
  await check("accepted POST is not replayed after a connection reset", async () => {
    const network = transport("write-reset", proxy);
    const before = writes;
    rejectWrite = true;
    try {
      await assert.rejects(network.fetch("http://haolo-network.invalid/api/finance/orders", { method: "POST", body: "{}" }));
      assert.equal(writes - before, 1);
    } finally { rejectWrite = false; }
  });
  if (process.argv.includes("--live")) {
    const direct = transport("live-direct", { mode: "direct" });
    await check("public HaoLo API with proxy disabled", async () => {
      const service = createHaoloServiceFetch({ fetchImpl: direct.fetch });
      const { response, payload } = await fetchServiceJson(service, "https://haolo.com/api/app-updates/windows/check?version=0.1.167&client_variant=haolo_windows_web3", {}, 15000);
      assert.equal(response.status, 200);
      assert.equal(typeof payload.update_available, "boolean");
    });
    await check("real TLS alias fallback after DNS failure with proxy disabled", async () => {
      const service = createHaoloServiceFetch({
        fetchImpl: direct.fetch, primaryOrigin: "https://haolo-network.invalid", fallbackOrigins: ["https://www.haolo.com"],
      });
      const { response, payload } = await fetchServiceJson(service, "https://haolo-network.invalid/api/app-updates/windows/check?version=0.1.167&client_variant=haolo_windows_web3", {}, 15000);
      assert.equal(response.status, 200);
      assert.equal(typeof payload.update_available, "boolean");
    });
    await check("TLS handshake timeout recovers on the verified alias", async () => {
      const sockets = new Set();
      const server = net.createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      stalledTlsServers.push({ server, sockets });
      const primaryOrigin = `https://127.0.0.1:${server.address().port}`;
      const service = createHaoloServiceFetch({
        fetchImpl: direct.fetch, primaryOrigin, fallbackOrigins: ["https://www.haolo.com"], probeTimeoutMs: 500,
      });
      const { response, payload } = await fetchServiceJson(service, `${primaryOrigin}/api/app-updates/windows/check?version=0.1.167&client_variant=haolo_windows_web3`, {}, 15000);
      assert.equal(response.status, 200);
      assert.equal(typeof payload.update_available, "boolean");
    });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error?.stack || error);
} finally {
  await Promise.allSettled(sessions.map((ses) => ses.closeAllConnections()));
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  for (const { server, sockets } of stalledTlsServers) { for (const socket of sockets) socket.destroy(); server.close(); }
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
}
}

app.whenReady().then(run);
