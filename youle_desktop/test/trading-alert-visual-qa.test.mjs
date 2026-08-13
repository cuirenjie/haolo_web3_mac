import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser preview supplies complete alert states for Windows visual QA", async () => {
  const source = await readFile(new URL("../src/renderer/browser_mock.ts", import.meta.url), "utf8");
  for (const token of ["qa-monitoring", "qa-triggered", "qa-paused", "qa-gap", "qa-evidence", "awaiting_authorization", "chain-provider"]) assert.match(source, new RegExp(token));
  assert.match(source, /tradingAlertsSnapshot/);
  assert.match(source, /__haoloTradingAlertsQa/);
  assert.match(source, /normal.*loading.*error/s);
});

test("Windows visual QA captures paired themes, zooms, errors, loading, detail and editor", async () => {
  const source = await readFile(new URL("../scripts/trading-alert-windows-visual-qa.mjs", import.meta.url), "utf8");
  assert.match(source, /\[1, 1\.25, 1\.5\]/);
  assert.match(source, /\["light", "dark"\]/);
  for (const surface of ["list", "detail", "editor", "error", "loading"]) assert.match(source, new RegExp(`surface: \\"${surface}\\"`));
  assert.match(source, /horizontal overflow/);
  assert.match(source, /capturePage/);
  assert.match(source, /trading-alert-visual-qa/);
});
