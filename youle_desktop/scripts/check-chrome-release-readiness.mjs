import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readChromeReleasePolicy } from "../src/main/chrome/release-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const checks = [];
const manifestPath = path.join(repoRoot, "extensions", "haolo-chrome", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const policy = readChromeReleasePolicy(path.join(repoRoot, "resources", "chrome-release-policy.json"));
const metadata = readJson(path.join(repoRoot, "docs", "chrome-web-store", "submission-metadata.json"));

add("manifest_v3", manifest.manifest_version === 3, true, `manifest_version=${manifest.manifest_version}`);
add("minimum_chrome", Number(manifest.minimum_chrome_version) >= 121, true, `minimum=${manifest.minimum_chrome_version}`);
add("unused_bookmarks_removed", !manifest.permissions?.includes("bookmarks") && !manifest.optional_permissions?.includes("bookmarks"), true, "bookmarks is not requested");
add("optional_sensitive_permissions", sameSet(manifest.optional_permissions, ["debugger", "downloads", "history"]), true, JSON.stringify(manifest.optional_permissions));
add("optional_http_hosts", sameSet(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]), true, JSON.stringify(manifest.optional_host_permissions));

for (const size of [16, 32, 48, 128]) {
  const iconPath = path.join(repoRoot, "extensions", "haolo-chrome", "icons", `icon-${size}.png`);
  const dimensions = pngDimensions(iconPath);
  add(`icon_${size}`, dimensions?.width === size && dimensions?.height === size, true, dimensions ? `${dimensions.width}x${dimensions.height}` : "missing");
}

for (const [name, relativePath, width, height] of [
  ["store_icon", "store-icon-128.png", 128, 128],
  ["screenshot_light", "screenshot-01-sidepanel-light-1280x800.png", 1280, 800],
  ["screenshot_dark", "screenshot-02-approval-dark-1280x800.png", 1280, 800],
  ["promo_small", "promo-small-440x280.png", 440, 280],
  ["promo_marquee", "promo-marquee-1400x560.png", 1400, 560],
]) {
  const dimensions = pngDimensions(path.join(repoRoot, "docs", "chrome-web-store", "assets", relativePath));
  add(name, dimensions?.width === width && dimensions?.height === height, true, dimensions ? `${dimensions.width}x${dimensions.height}` : "missing");
}

const extensionSources = collectFiles(path.join(repoRoot, "extensions", "haolo-chrome"), (entry) => /\.(?:js|html)$/i.test(entry));
const sourceText = extensionSources.map((entry) => fs.readFileSync(entry, "utf8")).join("\n");
add("no_dynamic_code", !/\beval\s*\(|\bnew\s+Function\s*\(/.test(sourceText), true, "no eval or new Function");
add("no_remote_scripts", !/<script[^>]+src=["']https?:\/\//i.test(sourceText), true, "all scripts are packaged locally");

for (const file of [
  "listing.zh-CN.md",
  "permissions-justification.zh-CN.md",
  "privacy-policy.zh-CN.md",
  "data-disclosure.zh-CN.md",
  "release-runbook.zh-CN.md",
]) {
  add(`document_${file}`, fs.existsSync(path.join(repoRoot, "docs", "chrome-web-store", file)), true, file);
}

const storeZip = path.join(repoRoot, "release", "chrome-extension", "haolo-chrome-store.zip");
add("store_zip", fs.existsSync(storeZip) && fs.statSync(storeZip).size > 0, true, fs.existsSync(storeZip) ? `${fs.statSync(storeZip).size} bytes` : "missing");
if (fs.existsSync(storeZip)) add("store_zip_sha256", fs.existsSync(`${storeZip}.sha256`), true, sha256(storeZip));

add("production_extension_id", /^[a-p]{32}$/.test(String(policy.productionExtensionId || "")), true, policy.productionExtensionId || "not configured");
for (const field of ["publisherLegalName", "supportEmail", "homepageUrl", "privacyPolicyUrl", "haoloPrivacyUrl", "effectiveDate", "storeItemId"]) {
  const value = String(metadata?.[field] || "");
  add(`metadata_${field}`, value.length > 0 && !value.includes("__REQUIRED_"), true, value.includes("__REQUIRED_") ? "requires publisher input" : value);
}

const hostPath = path.join(repoRoot, "resources", "bin", "haolo-chrome-native-host.exe");
const hostSignature = authenticodeStatus(hostPath);
add("native_host_authenticode", hostSignature === "Valid", true, hostSignature);
const installer = newestFile(path.join(repoRoot, "release"), (name) => /Setup\.exe$/i.test(name));
const installerSignature = installer ? authenticodeStatus(installer) : "missing";
add("desktop_installer_authenticode", installerSignature === "Valid", true, installer ? `${installerSignature}: ${path.basename(installer)}` : "missing");

const blockers = checks.filter((check) => check.blocking && !check.ok);
const report = {
  schemaVersion: 1,
  ready: blockers.length === 0,
  strict,
  generatedAt: new Date().toISOString(),
  summary: { total: checks.length, passed: checks.filter((check) => check.ok).length, blockers: blockers.length },
  blockers: blockers.map(({ name, detail }) => ({ name, detail })),
  checks,
};
const outputRoot = path.join(repoRoot, "release", "chrome-extension");
fs.mkdirSync(outputRoot, { recursive: true });
const reportPath = path.join(outputRoot, "release-readiness.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
if (strict && blockers.length) process.exitCode = 1;

function add(name, ok, blocking, detail) {
  checks.push({ name, ok: Boolean(ok), blocking: Boolean(blocking), detail: String(detail || "") });
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function pngDimensions(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function collectFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(fullPath, predicate));
    else if (entry.isFile() && predicate(fullPath)) result.push(fullPath);
  }
  return result;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function newestFile(root, predicate) {
  if (!fs.existsSync(root)) return null;
  return collectFiles(root, (entry) => predicate(path.basename(entry)))
    .map((entry) => ({ entry, mtime: fs.statSync(entry).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0]?.entry || null;
}

function authenticodeStatus(filePath) {
  if (!fs.existsSync(filePath)) return "missing";
  if (process.platform !== "win32") return "unsupported_platform";
  const escaped = filePath.replace(/'/g, "''");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString()`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return result.status === 0 ? String(result.stdout || "Unknown").trim() : `error:${String(result.stderr || result.error?.message || "unknown").trim()}`;
}
