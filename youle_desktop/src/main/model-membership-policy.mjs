import { activeMembershipEntitlement } from "./premium-entitlement.mjs";

export const GPT_5_6_SOL_MODEL = "gpt-5.6-sol";
export const GPT_6_SOL_MODEL = "gpt-6-sol";
export const GPT_6_ASTRA_MODEL = "gpt-6-astra";

export const MODEL_MEMBERSHIP_PLAN_LABELS = Object.freeze({
  basic: "基础版",
  flagship: "旗舰版",
});

const PLAN_RANK = Object.freeze({
  free: 0,
  trial: 1,
  basic: 2,
  pro: 3,
  professional: 3,
  flagship: 4,
});

export function normalizeModelMembershipPlan(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^subscription[_-]/, "")
    .replace(/[_-](?:monthly|annual|yearly)$/, "");
  if (normalized === "professional") return "pro";
  return normalized || "free";
}

export function modelMembershipRequirement(model) {
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized === GPT_6_ASTRA_MODEL) {
    return { allowed: false, requiredPlan: "flagship", requiredLabel: MODEL_MEMBERSHIP_PLAN_LABELS.flagship };
  }
  if (normalized === GPT_6_SOL_MODEL) {
    return { allowed: false, requiredPlan: "basic", requiredLabel: MODEL_MEMBERSHIP_PLAN_LABELS.basic };
  }
  return { allowed: true, requiredPlan: null, requiredLabel: null };
}

export function modelMembershipAccess(profile, model, now = Date.now()) {
  const requirement = modelMembershipRequirement(model);
  if (requirement.allowed) return { ...requirement, planId: "free", reason: null };

  const entitlement = activeMembershipEntitlement(profile, now);
  const planId = normalizeModelMembershipPlan(entitlement.planId);
  const allowed = entitlement.active &&
    (PLAN_RANK[planId] || 0) >= (PLAN_RANK[requirement.requiredPlan] || 0);
  return {
    ...requirement,
    allowed,
    planId,
    reason: allowed ? null : entitlement.reason || "membership-required",
  };
}

export function modelRequiresMembership(model) {
  return !modelMembershipRequirement(model).allowed;
}

