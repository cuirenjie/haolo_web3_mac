import {
  activeMembershipEntitlement,
  profileAvailableBalanceState as sharedProfileAvailableBalanceState,
  type ProfileAvailableBalanceState,
} from "../main/premium-entitlement.mjs";

export type { ProfileAvailableBalanceState };

type ProfileBalanceRecord = Readonly<Record<string, unknown>>;

export const INSUFFICIENT_CREDITS_NOTICE = "当前可用积分不足，请查看消耗明细。若刚完成付款，请核对订单是否到账。";
export const ACTIVE_MEMBERSHIP_CREDITS_NOTICE = "会员仍在有效期内，但当前可用积分已用完。会员有效期不代表无限积分，请查看消耗明细核对用量；需要继续使用时可补充积分。";
const LEGACY_QUOTA_NOTICE = "您的积分不足，请充值或开通会员";

export function insufficientCreditsNotice(profile: ProfileBalanceRecord | null | undefined, now = Date.now()): string {
  // Only explain exhaustion when both the balance and membership are known.
  // A failed refresh or a stale positive balance must not invent a diagnosis.
  return profileAvailableBalanceState(profile) === "insufficient"
    && activeMembershipEntitlement(profile, now).active
    ? ACTIVE_MEMBERSHIP_CREDITS_NOTICE : INSUFFICIENT_CREDITS_NOTICE;
}

export function isInsufficientCreditsNotice(text: string): boolean {
  return [LEGACY_QUOTA_NOTICE, INSUFFICIENT_CREDITS_NOTICE, ACTIVE_MEMBERSHIP_CREDITS_NOTICE].includes(text.trim());
}

export function profileAvailableBalanceState(
  profile: ProfileBalanceRecord | null | undefined,
): ProfileAvailableBalanceState {
  return sharedProfileAvailableBalanceState(profile);
}

export async function confirmProfileAvailableBalanceStateBeforeSend(
  profile: ProfileBalanceRecord | null | undefined,
  refreshProfile: () => Promise<ProfileBalanceRecord | null | undefined>,
): Promise<ProfileAvailableBalanceState> {
  const initialState = profileAvailableBalanceState(profile);
  if (initialState !== "insufficient") return initialState;

  try {
    const refreshedProfile = await refreshProfile();
    if (!refreshedProfile) return "unknown";
    return profileAvailableBalanceState(refreshedProfile);
  } catch {
    // A failed refresh must not let a stale client snapshot pre-empt the
    // authoritative billing gateway.
    return "unknown";
  }
}
