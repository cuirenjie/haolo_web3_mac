import {
  profileAvailableBalanceState as sharedProfileAvailableBalanceState,
  type ProfileAvailableBalanceState,
} from "../main/premium-entitlement.mjs";

export type { ProfileAvailableBalanceState };

type ProfileBalanceRecord = Readonly<Record<string, unknown>>;

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
