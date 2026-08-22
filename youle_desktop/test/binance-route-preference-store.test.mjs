import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BinanceRoutePreferenceStore } from "../src/main/binance-route-preference-store.mjs";

test("route preference store atomically persists only known route states", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-binance-route-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "route.json");
  const store = new BinanceRoutePreferenceStore({ storagePath, writeDelayMs: 0, now: () => 10_000 });
  store.schedule({
    "public:futures": { failures: 2, cooldownUntil: 20_000, gatewayPreferredUntil: 40_000 },
    "attacker:route": { failures: 20, cooldownUntil: Number.MAX_SAFE_INTEGER, gatewayPreferredUntil: Number.MAX_SAFE_INTEGER },
  });
  store.close();

  const restored = new BinanceRoutePreferenceStore({ storagePath }).load();
  assert.deepEqual(restored, {
    "public:futures": { failures: 2, cooldownUntil: 20_000, gatewayPreferredUntil: 40_000 },
  });
  assert.deepEqual(fs.readdirSync(root), ["route.json"]);
  assert.equal(JSON.parse(fs.readFileSync(storagePath, "utf8")).version, 1);
});

test("route preference store ignores a damaged file and replaces it on the next transition", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-binance-route-corrupt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "route.json");
  fs.writeFileSync(storagePath, "not json", "utf8");
  const store = new BinanceRoutePreferenceStore({ storagePath, writeDelayMs: 0 });
  assert.deepEqual(store.load(), {});
  store.schedule({ "public:spot": { failures: 1, cooldownUntil: 2, gatewayPreferredUntil: 3 } });
  store.close();
  assert.equal(JSON.parse(fs.readFileSync(storagePath, "utf8")).states["public:spot"].failures, 1);
});
