import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("production entries do not import or expose the retired semantic routers", () => {
  for (const file of ["src/main/main.mjs", "src/main/preload.mjs", "src/renderer/main.ts", "src/main/automation/trading-profile.mjs", "src/main/trading-strategy-runtime/cloud-catalog.mjs"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /external-strategy-router|general-request-router|classifyExternalTradingRequest|handleExternalTradingChannelMessage|repairExternalTradingRoutingFromText/, file);
  }
  const files = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).build.files;
  assert.ok(!files.includes("src/main/trading-analysis/external-strategy-router.mjs"));
  assert.ok(!files.includes("src/main/trading-analysis/general-request-router.mjs"));
});
