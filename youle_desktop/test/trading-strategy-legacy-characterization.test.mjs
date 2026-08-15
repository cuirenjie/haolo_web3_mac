import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const readSource = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const sha256 = (source) => crypto.createHash("sha256").update(source).digest("hex");
const contract = JSON.parse(readSource("test/fixtures/trading-strategy-legacy-contract.json"));

const requestSourceByStrategy = Object.freeze({
  chan: "src/renderer/trading-expert-chan-request.ts",
  "order-flow": "src/renderer/trading-expert-order-flow-request.ts",
  wave: "src/renderer/trading-expert-wave-request.ts",
  wyckoff: "src/renderer/trading-expert-wyckoff-request.ts",
});

test("legacy strategy catalog keeps stable ids, order, mentions, and prompt assets", () => {
  assert.deepEqual(contract.catalog.map((strategy) => strategy.id), ["chan", "order-flow", "wave", "wyckoff"]);
  assert.deepEqual(contract.catalog.map((strategy) => strategy.displayName), ["缠论", "订单流", "波浪理论", "威科夫"]);
  for (const strategy of contract.catalog) {
    const source = readSource(requestSourceByStrategy[strategy.id]);
    assert.equal(sha256(source), strategy.requestSourceSha256, `${strategy.id} prompt source changed`);
    assert.match(source, new RegExp(strategy.mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("legacy main and preload channels stay available during migration", () => {
  const mainSource = readSource("src/main/main.mjs");
  const preloadSource = readSource("src/main/preload.mjs");
  for (const strategy of contract.catalog) {
    assert.ok(mainSource.includes(`ipcMain.handle("${strategy.legacyClassifyChannel}"`));
    assert.ok(mainSource.includes(`ipcMain.handle("${strategy.legacyRunChannel}"`));
    assert.ok(preloadSource.includes(`ipcRenderer.invoke("${strategy.legacyClassifyChannel}"`));
    assert.ok(preloadSource.includes(`ipcRenderer.invoke("${strategy.legacyRunChannel}"`));
  }
});

test("every legacy strategy owns an engine, pipeline, and request router", () => {
  for (const strategy of contract.catalog) {
    const prefix = strategy.id;
    for (const suffix of ["engine.mjs", "pipeline.mjs", "request-router.mjs"]) {
      assert.equal(
        fs.existsSync(path.join(repositoryRoot, `src/main/trading-analysis/${prefix}-${suffix}`)),
        true,
        `${strategy.id} is missing ${suffix}`,
      );
    }
  }
});

test("drawing protocol keeps each strategy on its historical isolated layer", () => {
  const protocolSource = readSource("src/main/trading-analysis/protocol.mjs");
  for (const strategy of contract.catalog) {
    assert.ok(protocolSource.includes(`layer: "${strategy.layer}"`), `${strategy.id} layer changed`);
  }
  assert.match(protocolSource, /operations\.length > 64/);
  assert.match(protocolSource, /ALLOWED_DRAWING_TOOLS = new Set\(\["path", "rectangle", "arrow-up", "arrow-down", "note", "text"\]\)/);
  assert.match(protocolSource, /DRAWING_LINE_STYLES = new Set\(\["solid", "dashed", "dotted"\]\)/);
  assert.match(protocolSource, /lineWidth < 0\.5 \|\| lineWidth > 4/);
});

test("renderer preserves four independent analysis entry points and order-flow data safety", () => {
  const marketSource = readSource("src/renderer/trading-expert-market.ts");
  assert.match(marketSource, /async runChanConversation\(/);
  assert.match(marketSource, /async runOrderFlowConversation\(/);
  assert.match(marketSource, /async runWaveConversation\(/);
  assert.match(marketSource, /async runWyckoffConversation\(/);
  assert.match(marketSource, /getBinancePublicMarketData/);
  assert.doesNotMatch(marketSource, /BINANCE_FUTURES_REST_URL/);
  assert.match(marketSource, /fetchTradingOrderFlowWindow/);
  assert.match(marketSource, /runTradingWaveAnalysisWithAutoExpansion/);
});
