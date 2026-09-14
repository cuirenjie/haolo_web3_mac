// Anonymous probes only. No user session, Binance keys, tickets or permits.
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { createBinanceGatewayNetworkFetch } from "../src/main/binance-gateway-network.mjs";

if (!process.argv.includes("--live")) throw new Error("Pass --live to probe the configured production gateways");
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
const deployment = JSON.parse(fs.readFileSync(new URL("../resources/binance-gateway.json", import.meta.url), "utf8"));
const config = resolveBinanceGatewayConfig({}, deployment);
const network = createBinanceGatewayNetworkFetch(config);
const report = { at: new Date().toISOString(), checks: [], scope: "anonymous health and TLS only" };
try {
  for (const origin of [config.marketOrigin, config.privateProxyUrl]) {
    const start = performance.now();
    const hostname = new URL(origin).hostname;
    const address = await new Promise((resolve, reject) => network.lookup(hostname, { family: 4 },
      (error, value) => error ? reject(error) : resolve(value)));
    report.checks.push({ check: "selected route with verified TLS and health identity", hostname, address, elapsedMs: performance.now() - start });
  }
  for (let round = 0; round < 3; round++) {
    const start = performance.now();
    const response = await network(`${config.marketOrigin}/health`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.service, "haolo-binance-market-gateway");
    assert.equal(body.status, "ok");
    report.checks.push({ check: "market HTTPS through production transport", round, elapsedMs: performance.now() - start, status: response.status });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { code: error.code, message: error.message };
  process.exitCode = 1;
} finally {
  network.close();
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
