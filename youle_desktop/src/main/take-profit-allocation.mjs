// The existing execution-plan rule: equal whole percentages, with the
// remainder in the final target (two: 50/50; three: 33/33/34).
export function defaultTakeProfitPercent(index, count) {
  return index === count - 1 ? 100 - Math.floor(100 / count) * (count - 1) : Math.floor(100 / count);
}

// Decimal inputs must be floored in decimal space. For example, binary
// 1.13 * 100 is 112.99999999999999; adding Number.EPSILON cannot repair it.
function decimalFraction(value) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const coefficient = BigInt(whole + fraction);
  return scale >= 0 ? [coefficient, 10n ** BigInt(scale)] : [coefficient * 10n ** BigInt(-scale), 1n];
}

export function takeProfitNotionals(notional, percentages) {
  if (!Number.isFinite(notional) || notional <= 0 || !Array.isArray(percentages) || !percentages.length
    || percentages.some(p => !Number.isFinite(p) || p <= 0 || p > 100)
    || Math.abs(percentages.reduce((sum, p) => sum + p, 0) - 100) > 1e-8) return undefined;
  const [numerator, denominator] = decimalFraction(notional);
  const cents = Number(numerator * 100n / denominator);
  if (!Number.isSafeInteger(cents) || cents <= 0) return undefined;
  let allocated = 0;
  const amounts = percentages.map((percent, index) => {
    const [numerator, denominator] = decimalFraction(percent);
    const amount = index === percentages.length - 1 ? cents - allocated : Number(BigInt(cents) * numerator / (denominator * 100n));
    allocated += amount;
    return amount / 100;
  });
  return {notional: cents / 100, amounts};
}
