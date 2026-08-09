function profileBalanceNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/^(?:\$|🐾|ฅ)/u, "")
    .replace(/(?:ฅ|\s+lo)$/iu, "")
    .replaceAll(",", "")
    .trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function expandedDecimal(value: number) {
  const text = Math.abs(value).toString();
  if (!/[eE]/.test(text)) return text;

  const [coefficient, exponentText] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function formatProfileBalancePoints(value: unknown) {
  const amount = profileBalanceNumber(value);
  if (amount == null) return null;

  const [whole, fraction = ""] = expandedDecimal(amount).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = `${fraction}00`.slice(0, 2);
  const sign = amount < 0 ? "-" : "";
  return `${sign}${groupedWhole}.${cents}`;
}

/** @deprecated Use formatProfileBalancePoints; the value has point semantics. */
export const formatProfileBalanceUsd = formatProfileBalancePoints;
