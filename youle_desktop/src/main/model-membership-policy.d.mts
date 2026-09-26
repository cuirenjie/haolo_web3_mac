export const GPT_5_6_SOL_MODEL: "gpt-5.6-sol";
export const GPT_6_SOL_MODEL: "gpt-6-sol";
export const GPT_6_ASTRA_MODEL: "gpt-6-astra";
export const MODEL_MEMBERSHIP_PLAN_LABELS: Readonly<{ basic: "基础版"; flagship: "旗舰版" }>;
export function normalizeModelMembershipPlan(value: unknown): string;
export function modelMembershipRequirement(model: unknown): {
  allowed: boolean;
  requiredPlan: string | null;
  requiredLabel: string | null;
};
export function modelMembershipAccess(profile: unknown, model: unknown, now?: number): {
  allowed: boolean;
  requiredPlan: string | null;
  requiredLabel: string | null;
  planId: string;
  reason: string | null;
};
export function modelRequiresMembership(model: unknown): boolean;
