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

export const PREMIUM_ENTITLEMENT_CACHE_VERSION = 1;
// A cached entitlement is a resilience measure for a temporarily unavailable
// account endpoint. A membership expiry remains the hard upper bound when one
// exists; the stale age bound prevents an old snapshot from being used
// indefinitely when the account service is unavailable for an extended period.
export const PREMIUM_ENTITLEMENT_CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const PREMIUM_ENTITLEMENT_CACHE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const CACHE_PROFILE_NUMBER_KEYS = [
  "total_balance",
  "subscription_balance",
  "subscription_total_balance",
  "subscription_credited_balance",
  "subscription_pending_balance",
  "real_balance",
  "balance",
  "token_balance",
  "balance_cny_fen",
  "balance_cny",
  "balance_usd",
];

export function premiumEntitlementAccountId(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return "";
  return firstString(
    profile.id,
    profile.userId,
    profile.user_id,
    profile.uid,
    profile.sub,
    profile.citizen_id,
    profile.citizenId,
    profile.public_id,
    profile.publicId,
    profile.member_no,
    profile.memberNo,
    profile.email,
    profile.emailAddress,
    profile.email_address,
    profile.phone,
    profile.mobile,
  ).toLowerCase();
}

export function createPremiumEntitlementCache(profile, { baseUrl = "", now = Date.now() } = {}) {
  const nowMs = normalizeNow(now);
  const accountId = premiumEntitlementAccountId(profile);
  const entitlement = activeMembershipEntitlement(profile, nowMs);
  if (!accountId || premiumAccessState(profile, nowMs) !== "available") return null;
  return {
    version: PREMIUM_ENTITLEMENT_CACHE_VERSION,
    accountId,
    baseUrl: normalizeCacheBaseUrl(baseUrl),
    verifiedAt: new Date(nowMs).toISOString(),
    membershipExpiresAt: entitlement.expiresAt,
    planId: entitlement.planId,
    profile: entitlementProfileSnapshot(profile),
  };
}

export function premiumEntitlementCacheAccess(
  cache,
  {
    accountId = "",
    baseUrl = "",
    now = Date.now(),
    maxStaleMs = PREMIUM_ENTITLEMENT_CACHE_MAX_STALE_MS,
  } = {},
) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return { ok: false, reason: "missing" };
  if (Number(cache.version) !== PREMIUM_ENTITLEMENT_CACHE_VERSION) return { ok: false, reason: "version" };
  if (String(cache.accountId || "").toLowerCase() !== String(accountId || "").toLowerCase()) {
    return { ok: false, reason: "account-mismatch" };
  }
  if (normalizeCacheBaseUrl(cache.baseUrl) !== normalizeCacheBaseUrl(baseUrl)) return { ok: false, reason: "base-url-mismatch" };
  const nowMs = normalizeNow(now);
  const verifiedAtMs = Date.parse(String(cache.verifiedAt || ""));
  const expiresAtMs = cache.membershipExpiresAt ? Date.parse(String(cache.membershipExpiresAt)) : null;
  if (!Number.isFinite(verifiedAtMs) || (expiresAtMs != null && !Number.isFinite(expiresAtMs))) return { ok: false, reason: "invalid-date" };
  if (verifiedAtMs > nowMs + PREMIUM_ENTITLEMENT_CACHE_CLOCK_SKEW_MS) return { ok: false, reason: "future-verified-at" };
  if (expiresAtMs != null && expiresAtMs <= nowMs) return { ok: false, reason: "expired" };
  const ageMs = Math.max(0, nowMs - verifiedAtMs);
  if (Number.isFinite(Number(maxStaleMs)) && Number(maxStaleMs) >= 0 && ageMs > Number(maxStaleMs)) {
    return { ok: false, reason: "stale" };
  }
  const profile = cache.profile;
  if (premiumEntitlementAccountId(profile) !== String(accountId || "").toLowerCase()) {
    return { ok: false, reason: "profile-account-mismatch" };
  }
  if (premiumAccessState(profile, nowMs) !== "available") return { ok: false, reason: "profile-unavailable" };
  return {
    ok: true,
    profile,
    ageMs,
    expiresAt: cache.membershipExpiresAt,
    planId: cache.planId || null,
  };
}

export function isPremiumEntitlementRetryableError(error) {
  const candidates = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    candidates.push(current);
    current = current.cause;
  }
  for (const candidate of candidates) {
    const code = String(candidate?.code || candidate?.errorCode || "").toUpperCase();
    const status = Number(candidate?.status ?? candidate?.httpStatus ?? candidate?.upstreamStatus);
    const category = String(candidate?.category || "").toLowerCase();
    if (
      ["HAOLO_AUTH_REQUIRED", "HAOLO_ACCOUNT_ID_REQUIRED", "YOULE_AUTH_EXPIRED", "TRIAL_REQUIRED", "INSUFFICIENT_BALANCE", "MEMBERSHIP_EXPIRED"].includes(code)
      || /AUTH|UNAUTHORIZED|FORBIDDEN|SESSION_REVOKED|INVALID_API_KEY/.test(code)
      || status === 401
      || status === 403
      || /请先登录|登录已过期|会员到期|积分不足|余额不足/iu.test(String(candidate?.message || ""))
    ) return false;
    if (
      category === "transport"
      || category === "timeout"
      || status === 408
      || status === 425
      || status === 429
      || status >= 500
      || candidate?.retryable === true
      || /REQUEST_TIMEOUT|TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|NETWORK_ERROR|FETCH_FAILED|ROUTE_UNAVAILABLE|UND_ERR/i.test(code)
    ) return true;
  }
  return false;
}

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

function entitlementProfileSnapshot(profile) {
  const activeMembership = plainRecord(profile?.active_membership ?? profile?.activeMembership);
  const snapshot = {
    id: premiumEntitlementAccountId(profile),
    email: firstString(profile?.email, profile?.emailAddress, profile?.email_address) || null,
    phone: firstString(profile?.phone, profile?.mobile, profile?.phoneNumber, profile?.phone_number) || null,
    active_membership: activeMembership ? { ...activeMembership } : null,
    membership_expires_at: firstString(
      profile?.membership_expires_at,
      profile?.membershipExpiresAt,
      activeMembership?.expires_at,
      activeMembership?.expiresAt,
    ) || null,
    membership_plan: firstString(
      profile?.membership_plan,
      profile?.membershipPlan,
      activeMembership?.plan_id,
      activeMembership?.planId,
    ) || null,
  };
  for (const key of CACHE_PROFILE_NUMBER_KEYS) {
    const value = profile?.[key];
    if (typeof value === "number" && Number.isFinite(value)) snapshot[key] = value;
    else if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) snapshot[key] = value;
  }
  return snapshot;
}

function normalizeCacheBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
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
