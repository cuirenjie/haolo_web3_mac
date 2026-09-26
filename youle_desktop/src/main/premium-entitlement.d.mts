export type ActiveMembershipEntitlement = {
  active: boolean;
  planId: string | null;
  expiresAt: string | null;
  reason: string | null;
};

export type ProfileAvailableBalanceState = "available" | "insufficient" | "unknown";
export type PremiumAccessState = "available" | "membership-required" | "insufficient" | "unknown";

export const PREMIUM_ENTITLEMENT_CACHE_VERSION: number;
export const PREMIUM_ENTITLEMENT_CACHE_MAX_STALE_MS: number;

export function premiumEntitlementAccountId(
  profile: Readonly<Record<string, unknown>> | null | undefined,
): string;

export function createPremiumEntitlementCache(
  profile: Readonly<Record<string, unknown>> | null | undefined,
  options?: { baseUrl?: string; now?: number | Date },
): Readonly<Record<string, unknown>> | null;

export function premiumEntitlementCacheAccess(
  cache: Readonly<Record<string, unknown>> | null | undefined,
  options?: {
    accountId?: string;
    baseUrl?: string;
    now?: number | Date;
    maxStaleMs?: number;
  },
): {
  ok: boolean;
  reason?: string;
  profile?: Readonly<Record<string, unknown>>;
  ageMs?: number;
  expiresAt?: string | null;
  planId?: string | null;
};

export function isPremiumEntitlementRetryableError(error: unknown): boolean;

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
