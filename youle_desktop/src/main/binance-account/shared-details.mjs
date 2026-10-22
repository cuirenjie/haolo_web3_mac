import { positionHistoryReturn } from "../../shared/position-history-return.mjs";
// Adapt the owner-only display DTO; never infer historical leverage.
export function normalizeSharedAccountDetails(result, section) {
  if (result?.section !== section || !Array.isArray(result.items)
      || !["ready", "partial", "stale", "syncing", "unavailable"].includes(result.status)) {
    throw new Error("账户明细返回格式无效，请重试。");
  }
  return {
    ...result,
    items: section === "positionHistory" ? result.items.map(row => ({
      ...row,
      marginType: row.marginType ?? null,
      leverage: row.leverage ?? null,
      unrealizedPnl: row.unrealizedPnl ?? null,
      roi: positionHistoryReturn(row),
      baseAsset: row.baseAsset || String(row.symbol || "").replace(/(?:USDT|USDC|BUSD|FDUSD|TUSD)$/, ""),
      updatedAt: row.updatedAt ?? row.closeTime ?? result.asOf,
    })) : result.items,
  };
}
