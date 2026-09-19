import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("real gateway responses survive GC before the governor clones them", { timeout: 15_000 }, async () => {
  const script = fileURLToPath(new URL("../scripts/smoke-binance-response-lifecycle.mjs", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--expose-gc", script,
  ], { timeout: 12_000, windowsHide: true });
  assert.deepEqual(JSON.parse(stdout), { requests: 1, readers: 2, garbageCollections: 20 });
});
