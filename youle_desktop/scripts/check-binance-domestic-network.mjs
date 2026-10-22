// Run from the Windows repository root. Only these diagnostic sockets use the
// physical IPv4 address; do not disable VPN, change DNS, or change system routes.
// Uses public time endpoints, never exchange keys or account mutations.
import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { BinancePrivateProxyTransport } from "../src/main/binance-account/private-proxy-fetch.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf("="); return [arg.slice(2, i), arg.slice(i + 1)];
}));
const physicalIp = args["physical-ip"], edgeIp = args["edge-ip"], spotIp = args["spot-ip"];
if (![physicalIp, edgeIp, spotIp].every(isIPv4)
  || !Object.values(networkInterfaces()).flat().some(item => item?.address === physicalIp && !item.internal)) {
  throw new Error("Supply --physical-ip=<local adapter IPv4> --edge-ip=<verified gateway IPv4> --spot-ip=<resolved Binance IPv4>");
}
const report = { checkedAt: new Date().toISOString(), physicalIp, probes: [] };
function probe(name, url, host, address, physical) {
  const run = spawnSync("curl.exe", ["--noproxy", "*", ...(physical ? ["--interface", physicalIp] : []),
    "--resolve", `${host}:443:${address}`, "--connect-timeout", "5", "--max-time", "8", "-sS", "-o", "NUL",
    "-w", "%{json}", url], { encoding: "utf8", timeout: 10000, windowsHide: true });
  let value = {}; try { value = JSON.parse(run.stdout); } catch {}
  report.probes.push({ name, status: value.http_code || 0, curlExit: run.status,
    localIp: value.local_ip || null, remoteIp: value.remote_ip || null,
    elapsedMs: Math.round((value.time_total || 0) * 1000),
    ...(run.status ? { error: String(value.errormsg || run.stderr || "Probe failed").trim().slice(0, 180) } : {}) });
}
probe("physical_haolo", "https://haolo.com/api/auth/config", "haolo.com", edgeIp, true);
probe("physical_binance", "https://api.binance.com/api/v3/time", "api.binance.com", spotIp, true);
probe("physical_private_ready", "https://sg-a.binance-egress.waduo.com/ready", "sg-a.binance-egress.waduo.com", edgeIp, true);
probe("default_binance", "https://api.binance.com/api/v3/time", "api.binance.com", spotIp, false);

if (args["session-file"]) {
  // Existing Haolo authentication is read only in memory. Nothing here saves,
  // refreshes or logs the session, permit, headers or response body.
  const { token } = JSON.parse(fs.readFileSync(args["session-file"], "utf8"));
  if (!token) throw new Error("The selected Haolo session has no access token");
  const origins = new Set(["https://market.youle.pro", "https://sg-a.binance-egress.waduo.com"]);
  const lookup = (_host, opts, cb) => cb(null, opts?.all ? [{ address: edgeIp, family: 4 }] : edgeIp, 4);
  const fetchImpl = (input, init = {}) => new Promise((resolve, reject) => {
    const url = new URL(input);
    if (!origins.has(url.origin)) return reject(new Error("Unapproved diagnostic destination"));
    const req = https.request(url, { method: init.method || "GET", headers: Object.fromEntries(new Headers(init.headers || {})),
      agent: false, lookup, localAddress: physicalIp, family: 4, signal: init.signal, rejectUnauthorized: true }, res => {
      const chunks = []; res.on("data", b => chunks.push(b)); res.on("error", reject);
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on("error", reject); req.setTimeout(8000, () => req.destroy(new Error("Diagnostic timeout"))); req.end(init.body);
  });
  const client = createBinanceGatewayClient({
    config: { marketOrigin: "https://market.youle.pro", privateProxyEnabled: true,
      privatePermitUrl: "https://market.youle.pro/api/private/v1/permits", privateUsageUrl: "https://market.youle.pro/api/private/v1/usage", gatewayControlTimeoutMs: 10000 },
    apiClient: { getTrustedAccessToken: async () => token }, fetchImpl,
  });
  let socketInfo;
  const transport = new BinancePrivateProxyTransport({
    proxyUrl: "https://sg-a.binance-egress.waduo.com",
    permitProvider: (u, o) => client.privateRequestPermit(u, o), usageReporter: r => client.reportPrivateUsage(r),
    connectOuter: (input, { signal } = {}) => new Promise((resolve, reject) => {
      const url = new URL(input);
      if (!origins.has(url.origin)) return reject(new Error("Unapproved diagnostic proxy"));
      const socket = tls.connect({ host: edgeIp, port: 443, servername: url.hostname, localAddress: physicalIp,
        family: 4, rejectUnauthorized: true, minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"], signal }, () => {
        socketInfo = { localIp: socket.localAddress, remoteIp: socket.remoteAddress }; resolve(socket);
      });
      socket.on("error", reject); socket.setTimeout(8000, () => socket.destroy(new Error("Diagnostic timeout")));
    }),
  });
  try {
    for (const target of ["https://api.binance.com/api/v3/time", "https://fapi.binance.com/fapi/v1/time"]) {
      const started = Date.now();
      try {
        const response = await transport.fetch(target, { signal: AbortSignal.timeout(12000) });
        const body = await response.json();
        report.probes.push({ name: "physical_private_tunnel", host: new URL(target).hostname, status: response.status,
          validServerTime: Number.isFinite(body.serverTime), elapsedMs: Date.now() - started, ...socketInfo });
      } catch (error) {
        report.probes.push({ name: "physical_private_tunnel", host: new URL(target).hostname,
          status: Number(error.status) || 0, code: error.code || error.name, elapsedMs: Date.now() - started });
      }
    }
  } finally { await transport.close(); }
}
console.log(JSON.stringify(report, null, 2));
if (args.output) fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n");
const required = report.probes.filter(p => ["physical_haolo", "physical_private_ready", "physical_private_tunnel"].includes(p.name));
if (required.some(p => p.status !== 200 || p.validServerTime === false)) process.exitCode = 1;
