// Reproduce mainland app traffic without disconnecting the coding agent.
// Uses an existing access session for read-only public market requests only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { Agent, fetch } from "undici";
import { createHaoloNetworkTransport, openHaoloSocket } from "../src/main/haolo-network-transport.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";

const argument = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
assert.ok(process.argv.includes("--live"), "Use --live to run read-only production market checks");
const sessionPath = argument("session-file");
assert.ok(sessionPath, "Provide an existing --session-file; credentials are never printed");
const { token } = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
assert.ok(token, "Existing access token required");
const report = { at: new Date().toISOString(), mode: "application-DIRECT", routes: [], connections: [], checks: [],
  scope: "Explicitly bypasses HTTP/system proxy; cannot bypass an operating-system TUN or VPN route." };
const save = () => { if (argument("report")) fs.writeFileSync(argument("report"), JSON.stringify(report, null, 2)); };
const dispatcher = new Agent();
const network = createHaoloNetworkTransport({ resolveProxy: async () => "DIRECT",
  fallbackFetch: (url, init) => fetch(url, { ...init, dispatcher }),
  onDiagnostic: entry => report.routes.push(entry),
  openSocket: async (url, decision, options) => {
    const socket = await openHaoloSocket(url, decision, options);
    report.connections.push({ hostname: new URL(url).hostname, remoteAddress: socket.remoteAddress,
      proxy: Boolean(decision.proxyUrl), tlsAuthorized: socket.authorized });
    return socket;
  },
});
const config = resolveBinanceGatewayConfig({}, JSON.parse(fs.readFileSync(new URL("../resources/binance-gateway.json", import.meta.url), "utf8")));
const gatewayClient = createBinanceGatewayClient({ config, apiClient: { getTrustedAccessToken: async () => token }, fetchImpl: network.fetch });
const router = new BinanceNetworkRouter({ config, gatewayClient, directFetch: network.fetch });
const governor = new BinanceRequestGovernor();
const service = new BinancePublicMarketService({ timeoutMs: 0,
  fetch: (url, init) => governor.fetch(router.publicFetch.bind(router), url, init, { timeoutMs: 30000 }),
});
try {
  for (const [marketType, symbol] of [["futures", "SKHYNIXUSDT"], ["futures", "BTCUSDT"], ["spot", "BTCUSDT"]]) {
    const started = Date.now();
    const result = await service.request({ marketType, path: marketType === "spot" ? "/api/v3/klines" : "/fapi/v1/klines",
      parameters: { symbol, interval: "1h", limit: 500, endTime: Date.now() } }, { signal: AbortSignal.timeout(35000) });
    const check = { marketType, symbol, status: result.status, rows: result.data?.length || 0,
      stale: result.stale === true, elapsedMs: Date.now() - started, diagnostics: result.diagnostics };
    report.checks.push(check); save(); console.log(JSON.stringify(check));
    assert.equal(result.ok, true); assert.equal(result.status, 200); assert.equal(result.stale === true, false);
    assert.equal(result.data.length, 500);
    for (let i = 1; i < result.data.length; i++) assert.ok(result.data[i][0] > result.data[i - 1][0]);
  }
  assert.ok(report.connections.every(c => c.proxy === false && c.tlsAuthorized));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { name: error.name, code: error.code || error.cause?.code };
  process.exitCode = 1;
} finally {
  router.close(); network.close(); await dispatcher.destroy(); save();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length }));
}
