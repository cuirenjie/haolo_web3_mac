const finite = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function sharedSnapshotTime(value) {
  const time = typeof value === "number" || /^\d+$/.test(String(value || "")) ? Number(value) : Date.parse(String(value || ""));
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : "";
}

// The shared USDⓈ-M summary uses signed quantity, entry and unrealized P&L.
// Reconstruct its mark only from that same snapshot, never today's chart price.
export function sharedSnapshotPosition(row = {}, fetchedAt) {
  row = row || {};
  const quantity = finite(row.quantity);
  const entry = finite(row.entryPrice);
  const pnl = finite(row.unrealizedPnl);
  const suppliedMark = finite(row.markPrice);
  const inferredMark = quantity && entry > 0 && pnl !== null ? entry + pnl / quantity : null;
  const mark = suppliedMark > 0 ? suppliedMark : inferredMark > 0 ? inferredMark : null;
  return {
    symbol: String(row.symbol || ""),
    direction: quantity < 0 ? "SHORT" : "LONG",
    positionSide: "BOTH",
    marginType: "cross",
    leverage: finite(row.leverage) || 0,
    amount: quantity === null ? 0 : Math.abs(quantity),
    notionalValue: mark === null || quantity === null ? 0 : Math.abs(quantity) * mark,
    margin: 0,
    unrealizedPnl: pnl,
    roi: null,
    marginRatio: null,
    entryPrice: entry,
    markPrice: mark,
    liquidationPrice: 0,
    breakEvenPrice: entry,
    marginAsset: "USDT",
    updatedAt: fetchedAt,
  };
}
