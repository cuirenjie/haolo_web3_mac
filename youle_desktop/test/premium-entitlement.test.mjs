import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activeMembershipEntitlement,
  premiumAccessState,
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

test("renderer and main process both enforce fresh premium access for local analysis", async () => {
  const [renderer, mainProcess] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(renderer, /confirmPremiumTradingAccessBeforeSend\("trading-analysis-send"\)/);
  assert.match(renderer, /requiresPremiumTradingAccess[\s\S]*?accessState !== "available"[\s\S]*?return;/);
  assert.match(mainProcess, /async function requireFreshTradingPremiumAccess\(\)[\s\S]*?refreshSub2ApiAccount\(\)[\s\S]*?premiumAccessState\(profile\)/);
  assert.match(mainProcess, /async function runTradingStrategyRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /tradingAnalysis:runGeneral[\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /async function tradingAlertIpcCall[\s\S]*?\["compile", "resumeDraft", "simulate", "confirm", "revise"\][\s\S]*?await requireFreshTradingPremiumAccess\(\)/);
  assert.match(mainProcess, /async function classifyTradingStrategyRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?coordinator\.classify/);
  assert.match(mainProcess, /async function classifyExternalTradingRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?getTradingAnalysisModelRegistry\(\)\.analyze/);
  assert.match(mainProcess, /tradingAnalysis:classifyGeneralRequest[\s\S]*?await requireFreshTradingPremiumAccess\(\)[\s\S]*?getTradingAnalysisModelRegistry\(\)\.analyze/);
});
