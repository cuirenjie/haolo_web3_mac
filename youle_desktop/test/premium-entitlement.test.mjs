import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activeMembershipEntitlement,
  createPremiumEntitlementCache,
  isPremiumEntitlementRetryableError,
  premiumAccessState,
  premiumEntitlementCacheAccess,
} from "../src/main/premium-entitlement.mjs";

const NOW = Date.parse("2026-09-02T00:00:00Z");
const FUTURE = "2026-09-03T00:00:00Z";

test("a legacy membership_plan label cannot invent an active trial", () => {
  const profile = {
    membership_plan: "experience",
    membership_expires_at: FUTURE,
    total_balance: 100,
    active_membership: null,
  };

  assert.deepEqual(activeMembershipEntitlement(profile, NOW), {
    active: false,
    planId: null,
    expiresAt: null,
    reason: "membership-required",
  });
  assert.equal(premiumAccessState(profile, NOW), "membership-required");
});

test("only an unexpired active membership with positive balance grants premium access", () => {
  const profile = {
    active_membership: { plan_id: "trial", status: "active", expires_at: FUTURE },
    total_balance: 100,
  };

  assert.equal(activeMembershipEntitlement(profile, NOW).planId, "trial");
  assert.equal(premiumAccessState(profile, NOW), "available");
  assert.equal(premiumAccessState({ ...profile, total_balance: 0 }, NOW), "insufficient");
  assert.equal(
    premiumAccessState({ ...profile, total_balance: undefined }, NOW),
    "unknown",
  );
});

test("annual subscription plan ids retain their membership tier", () => {
  const entitlement = activeMembershipEntitlement({
    active_membership: { plan_id: "subscription_flagship_annual", status: "active", expires_at: FUTURE },
  }, NOW);
  assert.equal(entitlement.planId, "flagship");
});

test("expired, malformed and synthetic experience memberships fail closed", () => {
  assert.equal(premiumAccessState({
    active_membership: { plan_id: "pro", expires_at: "2026-09-01T00:00:00Z" },
    total_balance: 100,
  }, NOW), "membership-required");
  assert.equal(premiumAccessState({
    active_membership: { plan_id: "experience", expires_at: FUTURE },
    total_balance: 100,
  }, NOW), "membership-required");
  assert.equal(premiumAccessState({
    active_membership: { plan_id: "pro" },
    total_balance: 100,
  }, NOW), "membership-required");
});

test("available entitlement snapshots can be used for a bounded outage fallback", () => {
  const now = Date.parse("2026-09-02T00:00:00Z");
  const profile = {
    id: "user-cache",
    active_membership: { plan_id: "pro", status: "active", expires_at: "2026-09-30T00:00:00Z" },
    total_balance: 100,
  };
  const cache = createPremiumEntitlementCache(profile, { baseUrl: "https://haolo.com", now });
  assert.equal(cache.accountId, "user-cache");
  assert.equal(cache.membershipExpiresAt, "2026-09-30T00:00:00Z");
  assert.equal(
    premiumEntitlementCacheAccess(cache, {
      accountId: "user-cache",
      baseUrl: "https://haolo.com",
      now: now + 6 * 60 * 60 * 1000,
    }).ok,
    true,
  );
  assert.equal(
    premiumEntitlementCacheAccess(cache, {
      accountId: "another-user",
      baseUrl: "https://haolo.com",
      now,
    }).reason,
    "account-mismatch",
  );
  assert.equal(
    premiumEntitlementCacheAccess(cache, {
      accountId: "user-cache",
      baseUrl: "https://haolo.com",
      now: now + 25 * 60 * 60 * 1000,
    }).reason,
    "stale",
  );
  assert.equal(
    premiumEntitlementCacheAccess(cache, {
      accountId: "user-cache",
      baseUrl: "https://haolo.com",
      now: Date.parse("2026-10-01T00:00:00Z"),
    }).reason,
    "expired",
  );
});

test("cache fallback only accepts retryable entitlement failures", () => {
  assert.equal(isPremiumEntitlementRetryableError(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT", retryable: true })), true);
  assert.equal(isPremiumEntitlementRetryableError({ status: 503, retryable: true }), true);
  assert.equal(isPremiumEntitlementRetryableError({ status: 401, code: "YOULE_AUTH_EXPIRED" }), false);
  assert.equal(isPremiumEntitlementRetryableError({ code: "AUTH_SESSION_REQUIRED", retryable: true }), false);
  assert.equal(isPremiumEntitlementRetryableError({ code: "INSUFFICIENT_BALANCE" }), false);
});

test("renderer and main process both enforce fresh premium access for local analysis", async () => {
  const [renderer, mainProcess] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(renderer, /confirmPremiumTradingAccessBeforeSend\("trading-analysis-send"\)/);
  assert.match(renderer, /requiresPremiumTradingAccess[\s\S]*?accessState !== "available"[\s\S]*?return;/);
  assert.match(mainProcess, /TRADING_PREMIUM_ACCESS_CACHE_MS = 5_000/);
  assert.match(mainProcess, /async function requireFreshTradingPremiumAccess\(\)[\s\S]*?refreshSub2ApiAccount\(\{[\s\S]*?maxAgeMs: TRADING_PREMIUM_ACCESS_CACHE_MS[\s\S]*?premiumAccessState\(profile\)/);
  assert.match(mainProcess, /async function runTradingStrategyRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /tradingAnalysis:runGeneral[\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /async function tradingAlertIpcCall[\s\S]*?\["compile", "resumeDraft", "simulate", "confirm", "revise"\][\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /async function classifyTradingStrategyRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?coordinator\.classify/);
  assert.match(mainProcess, /async function classifyExternalTradingRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?getTradingAnalysisModelRegistry\([^)]*\)\.analyze/);
  assert.match(mainProcess, /tradingAnalysis:classifyGeneralRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?getTradingAnalysisModelRegistry\([^)]*\)\.analyze/);
});
