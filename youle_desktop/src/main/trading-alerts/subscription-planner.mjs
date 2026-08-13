import { normalizeAlertRule } from "./protocol.mjs";

export function planRuleSubscriptions(ruleValue, { defaultProviderId = "binance-public" } = {}) {
  const rule = normalizeAlertRule(ruleValue);
  const subscriptions = [];
  for (const context of rule.contexts) {
    if (context.marketSelector.kind === "current") throw new TypeError(`Context ${context.contextId} must be frozen to a market before monitoring`);
    const markets = context.marketSelector.kind === "fixed" ? context.marketSelector.marketIds : context.marketSelector.frozenMarketIds || [];
    if (!markets.length) throw new TypeError(`Context ${context.contextId} has no frozen markets`);
    for (const marketId of markets) for (const interval of context.intervals) subscriptions.push(Object.freeze({
      providerId: String(marketId).toUpperCase().startsWith("HYPERLIQUID:") ? "hyperliquid-public" : defaultProviderId,
      marketId,
      interval,
      fields: ["ohlcv"],
      contextId: context.contextId,
    }));
  }
  return Object.freeze(subscriptions);
}

export function estimateSubscriptionCost(rules) {
  const unique = new Set();
  let logical = 0;
  for (const rule of rules) for (const subscription of planRuleSubscriptions(rule)) {
    logical += 1;
    unique.add(`${subscription.providerId}|${subscription.marketId}|${subscription.interval}`);
  }
  return Object.freeze({ logicalSubscriptions: logical, physicalSubscriptions: unique.size, sharedSubscriptions: Math.max(0, logical - unique.size) });
}
