// The existing execution-plan rule: equal whole percentages, with the
// remainder in the final target (two: 50/50; three: 33/33/34).
export function defaultTakeProfitPercent(index, count) {
  return index === count - 1 ? 100 - Math.floor(100 / count) * (count - 1) : Math.floor(100 / count);
}

export function takeProfitNotionals(notional, percentages) {
  const cents = Math.floor((notional + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || !Array.isArray(percentages) || !percentages.length
    || percentages.some(p => !Number.isFinite(p) || p <= 0 || p > 100)
    || Math.abs(percentages.reduce((sum, p) => sum + p, 0) - 100) > 1e-8) return undefined;
  let allocated = 0;
  const amounts = percentages.map((percent, index) => {
    const amount = index === percentages.length - 1 ? cents - allocated : Math.floor(cents * percent / 100);
    allocated += amount;
    return amount / 100;
  });
  return {notional: cents / 100, amounts};
}
