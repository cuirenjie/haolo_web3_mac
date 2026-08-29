import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("macOS package declares native resources and architecture-specific runtimes", async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
  const mac = packageJson.build.mac;
  const resources = mac.extraResources.map((entry) => String(entry.from));

  assert.equal(mac.icon, "resources/haolo-logo.icns");
  assert.equal(mac.extendInfo.NSMicrophoneUsageDescription.includes("麦克风"), true);
  assert.ok(resources.includes("resources/bin/darwin-${arch}/haolo_ai"));
  assert.ok(resources.includes("resources/bin/darwin-${arch}/rg"));
  assert.equal(resources.some((entry) => /\.exe$/i.test(entry)), false);
  assert.ok(packageJson.scripts["dist:mac"]);
  assert.ok(packageJson.scripts["dist:mac:universal"]);
});

test("main and renderer use native macOS window, tray, dock, and microphone paths", async () => {
  const main = await readFile(path.join(appRoot, "src/main/main.mjs"), "utf8");
  const renderer = await readFile(path.join(appRoot, "src/renderer/main.ts"), "utf8");

  for (const marker of [
    "const IS_MAC = process.platform === \"darwin\"",
    "titleBarStyle = \"hiddenInset\"",
    "app.dock.setIcon",
    "MAC_TRAY_ICON_PATH",
    "systemPreferences.askForMediaAccess(\"microphone\")",
  ]) {
    assert.match(main, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(renderer, /isMacDesktop = api\.platform === "darwin"/);
  assert.match(renderer, /mac-titlebar/);
  assert.match(renderer, /shouldIgnoreComposerImeConfirmKeydown/);
});
