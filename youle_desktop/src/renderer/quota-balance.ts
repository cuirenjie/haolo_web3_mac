export type ProfileAvailableBalanceState = "available" | "insufficient" | "unknown";

type ProfileBalanceRecord = Readonly<Record<string, unknown>>;

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
] as const;

export function profileAvailableBalanceState(
  profile: ProfileBalanceRecord | null | undefined,
): ProfileAvailableBalanceState {
  if (!profile) return "unknown";

  const totalBalance = firstNumericProfileValue(profile, ["total_balance", "totalBalance"]);
  const subscriptionBalance = firstNumericProfileValue(profile, ["subscription_balance", "subscriptionBalance"]);
  const tokenBalances = TOKEN_BALANCE_KEYS
    .map((key) => numericBalanceValue(profile[key]))
    .filter((value): value is number => value != null);

  // A positive current bucket must win over a stale or inconsistent zero alias.
  // The gateway remains authoritative and can still reject the request if the
  // cached account snapshot is out of date.
  if (totalBalance != null && totalBalance > 0) return "available";
  if (subscriptionBalance != null && subscriptionBalance > 0) return "available";
  if (tokenBalances.some((balance) => balance > 0)) return "available";

  if (totalBalance != null && totalBalance <= 0) return "insufficient";
  if (
    subscriptionBalance != null &&
    subscriptionBalance <= 0 &&
    tokenBalances.length > 0 &&
    tokenBalances.every((balance) => balance <= 0)
  ) {
    return "insufficient";
  }

  // Do not infer exhaustion from one missing bucket. Incomplete client data
  // must not pre-empt a request that the billing gateway may accept.
  return "unknown";
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

function firstNumericProfileValue(profile: ProfileBalanceRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = numericBalanceValue(profile[key]);
    if (value != null) return value;
  }
  return null;
}

function numericBalanceValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
