import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "extensions", "haolo-chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));

test("MV3 manifest uses a stable development id and least-privilege host access", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(extensionIdFromKey(manifest.key), "eigggpflnllomdeppbengffgoealckcb");
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.permissions.includes("<all_urls>"), false);
  assert.equal(manifest.optional_permissions.includes("debugger"), true);
  assert.equal(manifest.optional_permissions.includes("bookmarks"), false);
  assert.equal(manifest.icons[128], "icons/icon-128.png");
});

test("page agent and service worker implement bounded, fail-closed reads", () => {
  const pageAgent = fs.readFileSync(path.join(extensionRoot, "page-agent.js"), "utf8");
  const worker = fs.readFileSync(path.join(extensionRoot, "service-worker.js"), "utf8");
  assert.match(pageAgent, /untrusted_web_content/);
  assert.match(pageAgent, /instructionAuthority/);
  assert.match(pageAgent, /CHROME_WAIT_TIMEOUT/);
  assert.match(pageAgent, /SENSITIVE_PATTERN/);
  assert.match(pageAgent, /CHROME_EXTERNAL_TARGET_CHANGED/);
  assert.match(pageAgent, /data-haolo-upload-token/);
  assert.match(worker, /CHROME_SITE_PERMISSION_REQUIRED/);
  assert.match(worker, /revokeTemporaryAccess/);
  assert.match(worker, /completedToolRequests/);
  assert.match(worker, /DOM\.setFileInputFiles/);
  assert.match(worker, /permission_revoked/);
  assert.match(worker, /12 \* 1024 \* 1024/);
  assert.doesNotMatch(worker, /eval\s*\(|new Function\s*\(/);
});

test("side panel declares complete light and dark interaction states", () => {
  const css = fs.readFileSync(path.join(extensionRoot, "sidepanel.css"), "utf8");
  const html = fs.readFileSync(path.join(extensionRoot, "sidepanel.html"), "utf8");
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /button:hover:not\(:disabled\)/);
  assert.match(css, /button:active:not\(:disabled\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /button:disabled/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /task-feedback\[data-state="loading"\]/);
  assert.match(css, /capability-row\[data-state="ready"\]/);
  assert.match(css, /capability-feedback\[data-state="loading"\]/);
  assert.match(html, /id="allowOnceButton"/);
  assert.match(html, /id="allowSiteButton"/);
  assert.match(html, /data-capability="downloads"/);
  assert.match(html, /data-capability="debugger"/);
  assert.match(html, /data-capability="history"/);
});

function extensionIdFromKey(key) {
  const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))).join("");
}
