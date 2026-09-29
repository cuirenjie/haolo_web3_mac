import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("trading analysis progress notifications use a best-effort sender", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(source, /function sendToEventSender\(sender, channel, payload\)/);
  assert.match(source, /sendToEventSender\(event\.sender, "tradingStrategy:progress",/g);
  assert.match(source, /Progress notifications are best effort/);
  assert.doesNotMatch(
    source,
    /if \(!event\.sender\?\.isDestroyed\?\.\(\) && typeof event\.sender\?\.send === "function"\) \{\s*event\.sender\.send\("tradingStrategy:progress"/s,
  );
});
