import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const installer = fs.readFileSync(new URL("../resources/installer.nsh", import.meta.url), "utf8");

test("desktop starts and stops the Chrome Native Broker through the main-process boundary", () => {
  assert.match(main, /new ChromeNativeHostManager\(/);
  assert.match(main, /new ChromeNativeBroker\(/);
  assert.match(main, /await chromeNativeBroker\.start\(\)/);
  assert.match(main, /new ChromeToolRuntime\(/);
  assert.match(main, /new ChromeMcpBridge\(/);
  assert.match(main, /withShutdownTimeout\("Chrome native broker", chromeNativeBroker\.stop\(\)\)/);
  assert.match(main, /withShutdownTimeout\("Chrome MCP bridge", chromeMcpBridge\.stop\(\)\)/);
});

test("Windows packaging includes and removes the Chrome Native Host registration", () => {
  assert.ok(pkg.build.extraResources.some((entry) => entry.to === "bin/haolo-chrome-native-host.exe"));
  assert.ok(pkg.build.extraResources.some((entry) => entry.from === "extensions/haolo-chrome" && entry.to === "chrome-extension"));
  assert.ok(pkg.build.extraResources.some((entry) => entry.from === "resources/chrome-release-policy.json" && entry.to === "chrome-release-policy.json"));
  assert.match(installer, /NativeMessagingHosts\\com\.haolo\.chrome/);
  assert.match(pkg.scripts["pack:win"], /build:chrome-host/);
  assert.match(pkg.scripts["dist:win"], /chrome:package/);
});

test("desktop exposes Chrome install, repair, artifact, approval, and audit surfaces without leaking approval tokens", () => {
  for (const channel of ["chrome:getStatus", "chrome:repair", "chrome:openExtensions", "chrome:revealExtension", "chrome:selectArtifact", "chrome:approve", "chrome:reject"]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(\"${channel.replace(":", "\\:")}\"`));
  }
  assert.match(main, /pendingApprovals: chromeToolRuntime\?\.pendingApprovals/);
  assert.match(main, /return \{ approved: true, type: "external", operation: approved\.operation \}/);
  assert.doesNotMatch(main, /return \{ approved: true, type: "external", operation: approved\.operation, approvalToken/);
  assert.match(preload, /getChromeIntegrationStatus/);
  assert.match(preload, /approveChromeRequest/);
  assert.match(preload, /onChromeApproval/);
  assert.match(renderer, /function renderChromeIntegrationDialog/);
  assert.match(renderer, /data-chrome-approval/);
  assert.match(renderer, /data-chrome-artifact/);
  assert.match(renderer, /紧急保护已开启/);
  assert.match(renderer, /Chrome 能力已由发布策略暂停/);
});

test("Chrome desktop controls cover light and dark interaction states", () => {
  assert.match(styles, /\.chrome-integration-dialog/);
  assert.match(styles, /html\[data-theme="dark"\] \.chrome-integration-dialog/);
  assert.match(styles, /\.chrome-setup-actions button:hover:not\(:disabled\)/);
  assert.match(styles, /\.chrome-setup-actions button:active:not\(:disabled\)/);
  assert.match(styles, /\.chrome-setup-actions button:focus-visible/);
  assert.match(styles, /\.chrome-setup-actions button:disabled/);
  assert.match(styles, /\.chrome-approval-card\[data-effect="high_impact"\]/);
  assert.match(styles, /\.chrome-integration-warning/);
});
