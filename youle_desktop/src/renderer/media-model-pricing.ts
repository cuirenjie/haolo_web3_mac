export type MediaModelBillingUnit = "request" | "second" | "";

export function normalizeMediaModelUnitPoints(value: unknown): number | null {
  const points = Number(value);
  return Number.isFinite(points) && points > 0 ? points : null;
}

export function normalizeMediaModelBillingUnit(
  value: unknown,
): MediaModelBillingUnit {
  const unit = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (unit === "second" || unit === "per_second") return "second";
  if (
    unit === "request" ||
    unit === "per_request" ||
    unit === "generation" ||
    unit === "per_generation"
  ) {
    return "request";
  }
  return "";
}

export function mediaModelPriceLabel(
  unitPoints: unknown,
  billingUnit: unknown,
): string {
  const points = normalizeMediaModelUnitPoints(unitPoints);
  const unit = normalizeMediaModelBillingUnit(billingUnit);
  if (points == null || !unit) return "";
  const amount = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 4,
    useGrouping: false,
  }).format(points);
  return `${amount}/${unit === "second" ? "秒" : "次"}`;
}
