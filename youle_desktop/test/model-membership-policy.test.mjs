import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  modelMembershipAccess,
  modelMembershipRequirement,
} from "../src/main/model-membership-policy.mjs";

const expiry = "2099-01-01T00:00:00.000Z";
const profile = (planId) => ({
  active_membership: { status: "active", plan_id: planId, expires_at: expiry },
});

test("model membership tiers expose the three requested access levels", () => {
  assert.equal(modelMembershipRequirement("gpt-5.6-sol").allowed, true);
  assert.equal(modelMembershipAccess(profile("subscription_trial"), "gpt-6-sol").allowed, false);
  assert.equal(modelMembershipAccess(profile("subscription_basic"), "gpt-6-sol").allowed, true);
  assert.equal(modelMembershipAccess(profile("subscription_pro"), "gpt-6-sol").allowed, true);
  assert.equal(modelMembershipAccess(profile("subscription_pro"), "gpt-6-astra").allowed, false);
  assert.equal(modelMembershipAccess(profile("subscription_flagship"), "gpt-6-astra").allowed, true);
});

test("locked model access reports the required upgrade plan", () => {
  const basic = modelMembershipAccess(profile("subscription_trial"), "gpt-6-sol");
  assert.deepEqual(
    { allowed: basic.allowed, requiredPlan: basic.requiredPlan, requiredLabel: basic.requiredLabel },
    { allowed: false, requiredPlan: "basic", requiredLabel: "基础版" },
  );
  const flagship = modelMembershipAccess(profile("subscription_pro"), "gpt-6-astra");
  assert.deepEqual(
    { allowed: flagship.allowed, requiredPlan: flagship.requiredPlan, requiredLabel: flagship.requiredLabel },
    { allowed: false, requiredPlan: "flagship", requiredLabel: "旗舰版" },
  );
});

test("expired or absent memberships cannot use GPT-6, while annual plans keep their tier", () => {
  for (const model of ["gpt-6-sol", "gpt-6-astra"]) {
    assert.equal(modelMembershipAccess(null, model).allowed, false);
    assert.equal(modelMembershipAccess({ active_membership: {
      status: "active", plan_id: "subscription_flagship", expires_at: "2000-01-01T00:00:00Z",
    } }, model).allowed, false);
    assert.equal(modelMembershipAccess(profile("subscription_flagship_annual"), model).allowed, true);
  }
  assert.equal(modelMembershipAccess(profile("subscription_basic_annual"), "gpt-6-sol").allowed, true);
  assert.equal(modelMembershipAccess(profile("subscription_basic_annual"), "gpt-6-astra").allowed, false);
  assert.equal(modelMembershipAccess(null, "deepseek-flash").allowed, true);
});

test("renderer locks the selection before persisting it and maps upgrades to the qualifying plans", async () => {
  const source = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  assert.match(source, /const membership = modelMembershipAccess\(state\.auth\.profile, selected\.value\)/);
  assert.match(source, /此模型仅限\$\{membership\.requiredLabel\}及以上会员使用/);
  assert.match(source, /if \(upgraded\) openRechargePage\(selected\.value\)/);
  assert.match(source, /gpt-6-astra[\s\S]{0,180}subscription_flagship/);
  assert.match(source, /gpt-6-sol[\s\S]{0,180}subscription_basic/);
  assert.match(source, /model: selected\.value/);
  assert.match(source, /const reasoningEffort =\s*\n\s*modelProvider === DEEPSEEK_EXECUTION_PROVIDER_ID[\s\S]*\? "max"/);
});
