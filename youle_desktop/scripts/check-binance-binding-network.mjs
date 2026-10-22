// Run from the Windows repository root. Every network socket in this probe is
// bound to the supplied physical IPv4. It never changes VPN, DNS or routes.
// Uses the existing Haolo token in memory and deliberately invalid Binance
// credentials: expected 401 proves account-endpoint reachability, not a real
// successful binding. No OTP, credential save or production binding mutation.
import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { Readable } from "node:stream";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { performance } from "node:perf_hooks";
import { createHaoloNetworkTransport } from "../src/main/haolo-network-transport.mjs";
import { haoloRoute } from "../src/main/haolo-network-policy.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";
import { BinancePrivateProxyTransport } from "../src/main/binance-account/private-proxy-fetch.mjs";
import { createBinanceAccountFetch } from "../src/main/binance-account/network-fetch.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf("="); return [arg.slice(2, i), arg.slice(i + 1)];
}));
const physicalIp = args["physical-ip"];
if (!isIPv4(physicalIp) || !Object.values(networkInterfaces()).flat().some(i => i?.address === physicalIp && !i.internal)
  || !args["session-file"]) throw new Error("Supply --physical-ip=<physical adapter IPv4> and --session-file=<existing Haolo session>");
const { token } = JSON.parse(fs.readFileSync(args["session-file"], "utf8"));
if (!token) throw new Error("Existing Haolo access token required; this probe does not refresh or save authentication");
const config = resolveBinanceGatewayConfig({}, JSON.parse(fs.readFileSync(
  new URL("../resources/binance-gateway.json", import.meta.url), "utf8")));
const report = { checkedAt: new Date().toISOString(), physicalIp, realBinanceCredentials: false,
  productionBindingWritten: false, probes: [], connections: [] };
const allowedHaolo = new Set(["haolo.com", "market.youle.pro", "sg-a.binance-egress.waduo.com"]);
const physicalSocket = (input, decision, { signal } = {}) => new Promise((resolve, reject) => {
  const url = new URL(input);
  if (!allowedHaolo.has(url.hostname) || decision.proxyUrl || decision.addresses.length !== 1
    || decision.addresses[0] !== haoloRoute(url)?.ordinary) return reject(new Error("Unapproved diagnostic route"));
  const socket = tls.connect({ host: decision.addresses[0], port: 443, servername: url.hostname,
    localAddress: physicalIp, family: 4, rejectUnauthorized: true, minVersion: "TLSv1.2",
    ALPNProtocols: ["http/1.1"], signal }, () => {
    if (socket.localAddress !== physicalIp) return socket.destroy(new Error("Physical egress not used"));
    socket.setTimeout(0);
    report.connections.push({ host: url.hostname, localIp: socket.localAddress, remoteIp: socket.remoteAddress });
    resolve(socket);
  });
  socket.once("error", reject);
  socket.setTimeout(8000, () => socket.destroy(new Error("Diagnostic connection timeout")));
});
const network = createHaoloNetworkTransport({ resolveProxy: async () => "DIRECT", openSocket: physicalSocket });
const client = createBinanceGatewayClient({ config, apiClient: { getTrustedAccessToken: async () => token }, fetchImpl: network.fetch });
const transport = new BinancePrivateProxyTransport({ proxyUrl: config.privateProxyUrl,
  permitProvider: (u, o) => client.privateRequestPermit(u, o), usageReporter: r => client.reportPrivateUsage(r),
  connectOuter: (u, o) => network.connect(u, o) });

function directFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(input);
    if (!["api.binance.com", "fapi.binance.com"].includes(url.hostname)) return reject(new Error("Unapproved direct target"));
    const req = https.request(url, { method: "GET", agent: false, localAddress: physicalIp, family: 4,
      headers: Object.fromEntries(new Headers(init.headers || {})), signal: init.signal, rejectUnauthorized: true }, res => {
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }));
    });
    req.on("socket", socket => socket.once("secureConnect", () => {
      if (socket.localAddress !== physicalIp) return req.destroy(new Error("Physical egress not used"));
      report.connections.push({ host: url.hostname, localIp: socket.localAddress, remoteIp: socket.remoteAddress });
    }));
    req.once("error", reject); req.end();
  });
}

// The app keeps its event loop alive; this standalone probe also needs a handle
// while a synthetic stalled body waits for the production unref'ed deadline.
const keepAlive = setInterval(() => {}, 1000);
try {
  for (const [name, url] of [["haolo", "https://haolo.com/api/auth/config"],
    ["private-ready", `${config.privateProxyUrl}/ready`]]) {
    const started = performance.now();
    const response = await network.fetch(url, { signal: AbortSignal.timeout(10000) });
    await response.arrayBuffer();
    report.probes.push({ name, status: response.status, elapsedMs: Math.round(performance.now() - started) });
  }
  for (const name of ["auto-domestic", "market-busy-domestic", "direct-body-stall-domestic"]) {
    const governor = new BinanceRequestGovernor({ maxConcurrency: 6, reservedAccountConcurrency: 2 });
    let directCalls = 0, privateCalls = 0, release;
    const reads = [];
    const router = new BinanceNetworkRouter({ config, directFetch: async (u, i) => {
      directCalls++;
      if (name === "direct-body-stall-domestic") return new Response(new ReadableStream());
      try { return await directFetch(u, i); }
      catch (e) { reads.push({ route: "direct", path: new URL(u).pathname, code: e.code || e.name }); throw e; }
    }, privateProxyFetch: async (u, i) => {
      privateCalls++; const response = await transport.fetch(u, i);
      reads.push({ route: "private", path: new URL(u).pathname, status: response.status }); return response;
    } });
    const service = new BinanceAccountService({ credentialStore: { upsert: () => { throw new Error("Saving credentials forbidden"); } },
      fetch: createBinanceAccountFetch({ governor, router }) });
    const hold = new Promise(r => { release = r; });
    const busy = name === "market-busy-domestic" ? Array.from({ length: 6 }, (_, n) => governor.fetch(
      async () => { await hold; return Response.json([]); },
      `https://fapi.binance.com/fapi/v1/klines?symbol=LOCAL_FIXTURE_${n}`, {}, { source: "market", priority: 90 })) : [];
    const started = performance.now();
    try {
      await service.validateCredentials({ apiKey: "diagnostic-placeholder-key", apiSecret: "diagnostic-placeholder-secret" });
      throw new Error("Placeholder credentials unexpectedly accepted");
    } catch (e) {
      report.probes.push({ name, code: e.code || e.name, directCalls, privateCalls, reads,
        expectedAccountRejection: e.code === "BINANCE_AUTH_FAILED"
          && reads.some(r => r.path === "/fapi/v3/account" && r.status === 401),
        elapsedMs: Math.round(performance.now() - started) });
    } finally { release(); await Promise.allSettled(busy); }
  }
} finally {
  try { await transport.close(); await network.close(); }
  finally { clearInterval(keepAlive); }
}
report.passed = report.probes.length === 5 && report.probes.every(p => p.status === 200 || p.expectedAccountRejection === true)
  && report.connections.length > 0 && report.connections.every(c => c.localIp === physicalIp);
console.log(JSON.stringify(report, null, 2));
if (args.output) fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n");
if (!report.passed) process.exitCode = 1;
