import { GatewayAuthError } from "./auth.mjs";

// Only the authoritative /api/auth/me response may create this entitlement.
// Trial/basic/pro/flagship all qualify while active; names are not credentials.
export function profileMarketEntitlement(profile, now = Date.now()) {
  const expiry = Date.parse(profile?.membership_expires_at);
  if (profile?.is_member === true && Number.isFinite(expiry) && expiry > now) {
    return { marketTier: "paid", membershipExpiresAt: expiry };
  }
  return { marketTier: profile?.is_member === undefined ? "unknown" : "free", membershipExpiresAt: null };
}

export function marketTier(identity, now = Date.now()) {
  if (String(identity?.userId || "").startsWith("anonymous:")) return "free";
  if (identity?.marketTier === "paid" && identity.membershipExpiresAt > now) return "paid";
  return identity?.marketTier === "unknown" || !identity?.marketTier ? "unknown" : "free";
}

export function requireMarketRoute(identity, request, config) {
  const mode = config.marketRoutingMode || "off";
  if (mode === "off") return;
  if (mode === "compatible" && request.headers["x-haolo-market-routing"] !== "1" && !identity?.marketRouting) return;
  const tier = marketTier(identity);
  if (tier === "unknown") {
    const error = new GatewayAuthError("market membership could not be verified", 503);
    error.code = "MARKET_ENTITLEMENT_UNAVAILABLE";
    throw error;
  }
  if (tier === config.marketNodeTier) return;
  // A business conflict, not HTTP 421: some transports automatically replay
  // 421 POST requests on a fresh connection, which is unsafe for one-use tickets.
  const error = new GatewayAuthError("market route changed", 409);
  error.code = "MARKET_ROUTE_REQUIRED";
  error.marketOrigin = tier === "paid" ? config.marketPaidOrigin : config.marketFreeOrigin;
  throw error;
}
