import crypto from "node:crypto";

const ACCOUNT_RISK_KEY = "max_loss_per_trade_percent";
const LEGACY_STOP_KEY = "preferred_stop_loss_percent";
const RISK_PREFERENCE_KEY = "risk_preference";
const LEGACY_RISK_PREFERENCE_KEY = "risk_reward_preference";

function boundedPercent(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.01 || number > 100) {
    throw new TypeError(`${field} must be between 0.01 and 100`);
  }
  return number;
}

function identityId(scope, key) {
  const identity = `${scope}\u0000${key}`;
  return `memory-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function migrateLegacyStopPreferenceToAccountRisk(profile, options = {}) {
  if (!profile || typeof profile !== "object" || !Array.isArray(profile.entries)) {
    throw new TypeError("profile entries are required");
  }
  const accountRiskPercent = boundedPercent(options.accountRiskPercent, "accountRiskPercent");
  const expectedLegacyPercent = boundedPercent(options.expectedLegacyPercent, "expectedLegacyPercent");
  const updatedAt = new Date(options.updatedAt || Date.now()).toISOString();
  const legacyStop = profile.entries.find((entry) => (
    entry?.scope === "trading.exit" && entry?.key === LEGACY_STOP_KEY
  ));
  if (!legacyStop) throw new Error("legacy ambiguous stop-loss preference was not found");
  if (Math.abs(Number(legacyStop.value) - expectedLegacyPercent) > Number.EPSILON) {
    throw new Error("legacy ambiguous stop-loss preference does not match the expected value");
  }
  const accountRisk = profile.entries.find((entry) => (
    entry?.scope === "trading.risk" && entry?.key === ACCOUNT_RISK_KEY
  ));
  if (!accountRisk) throw new Error("existing account-equity risk limit was not found");

  const retained = profile.entries
    .filter((entry) => !(entry?.scope === "trading.exit" && entry?.key === LEGACY_STOP_KEY))
    .filter((entry) => !(entry?.scope === "trading.risk" && entry?.key === LEGACY_RISK_PREFERENCE_KEY))
    .map((entry) => {
      if (entry === accountRisk) {
        return {
          ...entry,
          scope: "trading.risk",
          key: ACCOUNT_RISK_KEY,
          kind: "constraint",
          value: accountRiskPercent,
          strength: "hard",
          source: "user_explicit",
          updatedAt,
        };
      }
      return { ...entry };
    });
  const legacyRiskPreference = profile.entries.find((entry) => (
    entry?.scope === "trading.risk" && entry?.key === LEGACY_RISK_PREFERENCE_KEY
  ));
  const canonicalRiskPreference = retained.find((entry) => (
    entry?.scope === "trading.risk" && entry?.key === RISK_PREFERENCE_KEY
  ));
  if (legacyRiskPreference && !canonicalRiskPreference) {
    retained.push({
      ...legacyRiskPreference,
      id: identityId("trading.risk", RISK_PREFERENCE_KEY),
      scope: "trading.risk",
      key: RISK_PREFERENCE_KEY,
      kind: "preference",
      strength: "normal",
      source: "user_explicit",
      createdAt: legacyRiskPreference.createdAt || updatedAt,
      updatedAt,
    });
  }
  return {
    ...profile,
    schemaVersion: Number(profile.schemaVersion) || 1,
    revision: Math.max(0, Math.trunc(Number(profile.revision) || 0)) + 1,
    entries: retained,
    updatedAt,
  };
}
