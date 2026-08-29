export const GANN_SPIRAL_ENGINE_ID = "gann-square-of-nine-engine-v1";

export const GANN_SQUARE_OF_NINE_FACTORS = Object.freeze([
  Object.freeze({ angle: 45, factor: 0.25 }),
  Object.freeze({ angle: 90, factor: 0.5 }),
  Object.freeze({ angle: 135, factor: 0.75 }),
  Object.freeze({ angle: 180, factor: 1 }),
  Object.freeze({ angle: 225, factor: 1.25 }),
  Object.freeze({ angle: 270, factor: 1.5 }),
  Object.freeze({ angle: 315, factor: 1.75 }),
  Object.freeze({ angle: 360, factor: 2 }),
]);

export function gannSquareOfNinePriceUnit(price) {
  const normalized = Number(price);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new TypeError("Square of Nine anchor price must be positive");
  return 10 ** (Math.floor(Math.log10(normalized)) - 2);
}

export function gannSquareOfNineLevel(anchorPrice, factor, priceUnit = 1) {
  const anchor = Number(anchorPrice);
  const step = Number(factor);
  const unit = Number(priceUnit);
  if (!Number.isFinite(anchor) || anchor <= 0 || !Number.isFinite(step) || !Number.isFinite(unit) || unit <= 0) {
    throw new TypeError("Square of Nine inputs are invalid");
  }
  const root = Math.sqrt(anchor / unit) + step;
  if (root <= 0) return null;
  return root * root * unit;
}

export function runGannSpiralEngine(context) {
  const anchorPrice = context.anchor.price;
  const priceUnit = gannSquareOfNinePriceUnit(anchorPrice);
  const levels = [];
  for (const item of GANN_SQUARE_OF_NINE_FACTORS) {
    for (const side of ["up", "down"]) {
      const signedFactor = side === "up" ? item.factor : -item.factor;
      const price = gannSquareOfNineLevel(anchorPrice, signedFactor, priceUnit);
      if (!Number.isFinite(price) || price <= 0) continue;
      levels.push(Object.freeze({
        id: `gann-square-nine-${side}-${item.angle}`,
        side,
        angle: item.angle,
        factor: signedFactor,
        price,
        distanceFromAnchor: Math.abs(price - anchorPrice),
      }));
    }
  }
  const above = levels.filter((level) => level.price > context.latest.close)
    .sort((first, second) => first.price - second.price);
  const below = levels.filter((level) => level.price < context.latest.close)
    .sort((first, second) => second.price - first.price);
  const visibleLevels = [...below.slice(0, 3).reverse(), ...above.slice(0, 3)];
  return Object.freeze({
    engineId: GANN_SPIRAL_ENGINE_ID,
    status: "completed",
    anchorPrice,
    priceUnit,
    normalizedAnchor: anchorPrice / priceUnit,
    formula: "((sqrt(anchor / priceUnit) +/- factor) ^ 2) * priceUnit",
    levels: Object.freeze(levels.sort((first, second) => first.price - second.price)),
    visibleLevels: Object.freeze(visibleLevels),
    angles: Object.freeze(GANN_SQUARE_OF_NINE_FACTORS.map((item) => item.angle)),
    interpretation: "deterministic-price-level-projection",
    literalSpiralOverlay: false,
  });
}
