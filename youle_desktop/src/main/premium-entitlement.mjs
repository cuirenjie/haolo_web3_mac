const TOKEN_BALANCE_KEYS = [
  "real_balance",
  "realBalance",
  "token_balance",
  "tokenBalance",
  "balance_cny_fen",
  "balanceCnyFen",
  "balance_cny",
  "balanceCny",
  "balance_usd",
  "balanceUsd",
  "balance",
];

export function activeMembershipEntitlement(profile, now = Date.now()) {
  const activeMembership = plainRecord(profile?.active_membership ?? profile?.activeMembership);
  if (!activeMembership) return inactiveEntitlement("membership-required");

  const status = firstString(activeMembership.status)?.toLowerCase();
  if (status && status !== "active") return inactiveEntitlement("membership-inactive");

  const planId = normalizePlanId(firstString(
    activeMembership.plan_id,
    activeMembership.planId,
    activeMembership.product_id,
    activeMembership.productId,
  ));
  if (!planId || planId === "free" || planId === "experience") {
    return inactiveEntitlement("membership-plan-invalid");
  }

  const expiresAt = firstString(
    activeMembership.expires_at,
    activeMembership.expiresAt,
    profile?.membership_expires_at,
    profile?.membershipExpiresAt,
  );
  const expiryTimestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(expiryTimestamp)) return inactiveEntitlement("membership-expiry-invalid");
  if (expiryTimestamp <= normalizeNow(now)) return inactiveEntitlement("membership-expired");

  return {
    active: true,
    planId,
    expiresAt,
    reason: null,
  };
}

export function profileAvailableBalanceState(profile) {
  if (!profile || typeof profile !== "object") return "unknown";

  const totalBalance = firstNumericProfileValue(profile, ["total_balance", "totalBalance"]);
  const subscriptionBalance = firstNumericProfileValue(profile, ["subscription_balance", "subscriptionBalance"]);
  const tokenBalances = TOKEN_BALANCE_KEYS
    .map((key) => numericBalanceValue(profile[key]))
    .filter((value) => value != null);

  if (totalBalance != null && totalBalance > 0) return "available";
  if (subscriptionBalance != null && subscriptionBalance > 0) return "available";
  if (tokenBalances.some((balance) => balance > 0)) return "available";

  if (totalBalance != null && totalBalance <= 0) return "insufficient";
  if (
    subscriptionBalance != null
    && subscriptionBalance <= 0
    && tokenBalances.length > 0
    && tokenBalances.every((balance) => balance <= 0)
  ) return "insufficient";

  return "unknown";
}

export function premiumAccessState(profile, now = Date.now()) {
  if (!activeMembershipEntitlement(profile, now).active) {
    const permanentBalance = firstNumericProfileValue(profile || {}, ["real_balance", "realBalance", "balance"]);
    return permanentBalance != null && permanentBalance > 0 ? "available" : "membership-required";
  }
  const balanceState = profileAvailableBalanceState(profile);
  if (balanceState === "available") return "available";
  if (balanceState === "insufficient") return "insufficient";
  return "unknown";
}

function inactiveEntitlement(reason) {
  return { active: false, planId: null, expiresAt: null, reason };
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizePlanId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^subscription[_-]/, "")
    .replace(/[_-](?:monthly|annual|yearly)$/, "");
}

function normalizeNow(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function firstNumericProfileValue(profile, keys) {
  for (const key of keys) {
    const value = numericBalanceValue(profile[key]);
    if (value != null) return value;
  }
  return null;
}

function numericBalanceValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
