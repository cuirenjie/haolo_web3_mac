export type ActiveMembershipEntitlement = {
  active: boolean;
  planId: string | null;
  expiresAt: string | null;
  reason: string | null;
};

export type ProfileAvailableBalanceState = "available" | "insufficient" | "unknown";
export type PremiumAccessState = "available" | "membership-required" | "insufficient" | "unknown";

export function activeMembershipEntitlement(
  profile: Readonly<Record<string, unknown>> | null | undefined,
  now?: number | Date,
): ActiveMembershipEntitlement;

export function profileAvailableBalanceState(
  profile: Readonly<Record<string, unknown>> | null | undefined,
): ProfileAvailableBalanceState;

export function premiumAccessState(
  profile: Readonly<Record<string, unknown>> | null | undefined,
  now?: number | Date,
): PremiumAccessState;
