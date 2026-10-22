// User-selected history return: gross realized P&L / opening notional.
// The quantity is the closed amount, so partial closes use the matching basis.
export function positionHistoryReturn(record) {
  const number = value => typeof value === "boolean" || value == null || String(value).trim() === ""
    ? NaN : Number(value);
  const pnl = number(record?.realizedPnl);
  const price = number(record?.entryPrice);
  const quantity = number(record?.closedAmount);
  const basis = price * quantity;
  const percent = pnl / basis * 100;
  return Number.isFinite(pnl) && price > 0 && quantity > 0 && Number.isFinite(basis) && Number.isFinite(percent)
    ? percent : null;
}
