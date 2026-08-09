import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  chromeExtensionCompatibility,
  chromeReleaseExtensionIds,
  chromeRolloutDecision,
  normalizeChromeReleasePolicy,
  rolloutBucket,
} from "../src/main/chrome/release-policy.mjs";
import { HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID } from "../src/main/chrome/native-host-manager.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Chrome release policy uses deterministic cohorts and emergency fail-closed switches", () => {
  const base = normalizeChromeReleasePolicy({ rolloutPercent: 20, channel: "internal" });
  assert.equal(rolloutBucket("installation-a"), rolloutBucket("installation-a"));
  assert.notEqual(rolloutBucket("installation-a"), rolloutBucket("installation-b"));
  const decision = chromeRolloutDecision(base, "installation-a");
  assert.equal(decision.selected, decision.bucket < 20);

  const writeStopped = chromeRolloutDecision({ ...base, rolloutPercent: 100, emergencyWriteDisabled: true }, "installation-a");
  assert.equal(writeStopped.enabled, true);
  assert.equal(writeStopped.writeEnabled, false);
  assert.equal(writeStopped.reason, "writes_emergency_disabled");

  const allStopped = chromeRolloutDecision({ ...base, rolloutPercent: 100, emergencyDisabled: true }, "installation-a");
  assert.equal(allStopped.enabled, false);
  assert.equal(allStopped.writeEnabled, false);
  assert.equal(allStopped.reason, "emergency_disabled");
});

test("Chrome compatibility matrix blocks unknown versions and can stop writes independently", () => {
  const policy = normalizeChromeReleasePolicy({
    minimumExtensionVersion: "0.1.0",
    minimumWriteExtensionVersion: "0.2.0",
    maximumExtensionVersionExclusive: "1.0.0",
  });
  assert.deepEqual(chromeExtensionCompatibility("not-semver", policy), {
    version: "not-semver",
    readEnabled: false,
    writeEnabled: false,
    reason: "invalid_extension_version",
  });
  assert.equal(chromeExtensionCompatibility("0.1.5", policy).readEnabled, true);
  assert.equal(chromeExtensionCompatibility("0.1.5", policy).writeEnabled, false);
  assert.equal(chromeExtensionCompatibility("0.2.0", policy).writeEnabled, true);
  assert.equal(chromeExtensionCompatibility("1.0.0", policy).readEnabled, false);
});

test("production store id is added without removing the stable development id", () => {
  const productionId = "abcdefghijklmnopabcdefghijklmnop";
  const ids = chromeReleaseExtensionIds({ productionExtensionId: productionId }, HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID);
  assert.deepEqual(ids, [HAOLO_CHROME_DEVELOPMENT_EXTENSION_ID, productionId]);
});

test("store submission materials, exact image sizes, and release scripts are present", () => {
  const required = [
    "docs/chrome-web-store/listing.zh-CN.md",
    "docs/chrome-web-store/privacy-policy.zh-CN.md",
    "docs/chrome-web-store/permissions-justification.zh-CN.md",
    "docs/chrome-web-store/data-disclosure.zh-CN.md",
    "docs/chrome-web-store/release-runbook.zh-CN.md",
    "scripts/generate-chrome-store-assets.ps1",
    "scripts/check-chrome-release-readiness.mjs",
    "scripts/configure-chrome-release.mjs",
  ];
  for (const relativePath of required) assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, relativePath);
  for (const [relativePath, width, height] of [
    ["extensions/haolo-chrome/icons/icon-16.png", 16, 16],
    ["extensions/haolo-chrome/icons/icon-32.png", 32, 32],
    ["extensions/haolo-chrome/icons/icon-48.png", 48, 48],
    ["extensions/haolo-chrome/icons/icon-128.png", 128, 128],
    ["docs/chrome-web-store/assets/screenshot-01-sidepanel-light-1280x800.png", 1280, 800],
    ["docs/chrome-web-store/assets/screenshot-02-approval-dark-1280x800.png", 1280, 800],
    ["docs/chrome-web-store/assets/promo-small-440x280.png", 440, 280],
    ["docs/chrome-web-store/assets/promo-marquee-1400x560.png", 1400, 560],
  ]) {
    const dimensions = pngDimensions(path.join(repoRoot, relativePath));
    assert.deepEqual(dimensions, { width, height }, relativePath);
  }
});

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString("hex", 0, 8), "89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
