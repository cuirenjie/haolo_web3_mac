import crypto from "node:crypto";
import fs from "node:fs";

export const DEFAULT_CHROME_RELEASE_POLICY = Object.freeze({
  schemaVersion: 1,
  channel: "development",
  productionExtensionId: null,
  minimumExtensionVersion: "0.1.0",
  maximumExtensionVersionExclusive: "1.0.0",
  minimumWriteExtensionVersion: "0.1.0",
  rolloutPercent: 100,
  emergencyDisabled: false,
  emergencyWriteDisabled: false,
});

export function readChromeReleasePolicy(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ...DEFAULT_CHROME_RELEASE_POLICY };
  try {
    return normalizeChromeReleasePolicy(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    const wrapped = new Error(`Chrome release policy is invalid: ${error?.message || error}`);
    wrapped.code = "CHROME_RELEASE_POLICY_INVALID";
    throw wrapped;
  }
}

export function normalizeChromeReleasePolicy(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Chrome release policy must be an object");
  const productionExtensionId = nullableExtensionId(value.productionExtensionId);
  const policy = {
    schemaVersion: Number(value.schemaVersion ?? DEFAULT_CHROME_RELEASE_POLICY.schemaVersion),
    channel: String(value.channel || DEFAULT_CHROME_RELEASE_POLICY.channel).trim().toLowerCase(),
    productionExtensionId,
    minimumExtensionVersion: normalizeSemver(value.minimumExtensionVersion || DEFAULT_CHROME_RELEASE_POLICY.minimumExtensionVersion),
    maximumExtensionVersionExclusive: normalizeSemver(value.maximumExtensionVersionExclusive || DEFAULT_CHROME_RELEASE_POLICY.maximumExtensionVersionExclusive),
    minimumWriteExtensionVersion: normalizeSemver(value.minimumWriteExtensionVersion || DEFAULT_CHROME_RELEASE_POLICY.minimumWriteExtensionVersion),
    rolloutPercent: Number(value.rolloutPercent ?? DEFAULT_CHROME_RELEASE_POLICY.rolloutPercent),
    emergencyDisabled: value.emergencyDisabled === true,
    emergencyWriteDisabled: value.emergencyWriteDisabled === true,
  };
  if (policy.schemaVersion !== 1) throw new TypeError(`Unsupported Chrome release policy schema: ${policy.schemaVersion}`);
  if (!/^(development|internal|beta|production)$/.test(policy.channel)) throw new TypeError(`Unsupported Chrome release channel: ${policy.channel}`);
  if (!Number.isFinite(policy.rolloutPercent) || policy.rolloutPercent < 0 || policy.rolloutPercent > 100) {
    throw new TypeError("Chrome rolloutPercent must be between 0 and 100");
  }
  return policy;
}

export function chromeReleaseExtensionIds(policy, developmentExtensionId) {
  const values = [developmentExtensionId, policy?.productionExtensionId]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

export function chromeRolloutDecision(policy, installationKey) {
  const normalized = normalizeChromeReleasePolicy(policy);
  const bucket = rolloutBucket(installationKey);
  const selected = normalized.rolloutPercent >= 100 || bucket < normalized.rolloutPercent;
  return Object.freeze({
    channel: normalized.channel,
    bucket,
    rolloutPercent: normalized.rolloutPercent,
    selected,
    enabled: selected && !normalized.emergencyDisabled,
    writeEnabled: selected && !normalized.emergencyDisabled && !normalized.emergencyWriteDisabled,
    reason: normalized.emergencyDisabled
      ? "emergency_disabled"
      : !selected
        ? "outside_rollout"
        : normalized.emergencyWriteDisabled
          ? "writes_emergency_disabled"
          : "enabled",
  });
}

export function chromeExtensionCompatibility(version, policy) {
  let normalizedVersion;
  try {
    normalizedVersion = normalizeSemver(version);
  } catch {
    return Object.freeze({ version: String(version || ""), readEnabled: false, writeEnabled: false, reason: "invalid_extension_version" });
  }
  const normalized = normalizeChromeReleasePolicy(policy);
  const readEnabled = compareSemver(normalizedVersion, normalized.minimumExtensionVersion) >= 0
    && compareSemver(normalizedVersion, normalized.maximumExtensionVersionExclusive) < 0;
  const writeEnabled = readEnabled && compareSemver(normalizedVersion, normalized.minimumWriteExtensionVersion) >= 0;
  return Object.freeze({
    version: normalizedVersion,
    readEnabled,
    writeEnabled,
    reason: !readEnabled ? "extension_version_incompatible" : !writeEnabled ? "extension_write_version_incompatible" : "compatible",
  });
}

export function rolloutBucket(value) {
  const digest = crypto.createHash("sha256").update(String(value || "haolo-chrome")).digest();
  return Number((digest.readUInt32BE(0) / 0x1_0000_0000 * 100).toFixed(6));
}

function normalizeSemver(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new TypeError(`Invalid Chrome extension version: ${String(value || "")}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function compareSemver(left, right) {
  const a = normalizeSemver(left).split(".").map(Number);
  const b = normalizeSemver(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function nullableExtensionId(value) {
  if (value == null || String(value).trim() === "") return null;
  const id = String(value).trim().toLowerCase();
  if (!/^[a-p]{32}$/.test(id)) throw new TypeError("productionExtensionId must be a 32-character Chrome extension id");
  return id;
}
