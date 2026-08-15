import { gannPoint } from "./gann-theory-common.mjs";

export const GANN_SQUARE_ENGINE_ID = "gann-square-wheel-engine-v1";
const DIVISIONS = Object.freeze([0.25, 0.5, 0.75]);

export function runGannSquareEngine(context) {
  const { anchor, calibration, directionSign } = context;
  const start = gannPoint(context, anchor.index, anchor.price);
  const end = gannPoint(
    context,
    anchor.index + context.projection.spanBars,
    anchor.price + directionSign * context.projection.priceRange,
  );
  const priceLevels = DIVISIONS.map((fraction) => Object.freeze({
    fraction,
    price: Math.max(Number.EPSILON, anchor.price + directionSign * context.projection.priceRange * fraction),
  }));
  const timeLevels = DIVISIONS.map((fraction) => Object.freeze({
    fraction,
    index: anchor.index + context.projection.spanBars * fraction,
    time: anchor.time + context.projection.spanBars * fraction * context.intervalSeconds,
  }));
  const nestedSquares = [0.5, 0.25].map((fraction, index) => Object.freeze({
    id: index === 0 ? "gann-wheel-inner" : "gann-wheel-core",
    fraction,
    start,
    end: gannPoint(
      context,
      anchor.index + context.projection.spanBars * fraction,
      anchor.price + directionSign * context.projection.priceRange * fraction,
    ),
  }));
  return Object.freeze({
    engineId: GANN_SQUARE_ENGINE_ID,
    status: "completed",
    outer: Object.freeze({ start, end }),
    priceLevels: Object.freeze(priceLevels),
    timeLevels: Object.freeze(timeLevels),
    diagonals: Object.freeze([
      Object.freeze({ start, end }),
      Object.freeze({
        start: gannPoint(context, anchor.index, anchor.price + directionSign * context.projection.priceRange),
        end: gannPoint(context, anchor.index + context.projection.spanBars, anchor.price),
      }),
    ]),
    nestedSquares: Object.freeze(nestedSquares),
    wheelInWheel: Object.freeze({
      representation: "nested-time-price-squares",
      rings: nestedSquares.length + 1,
      literalNumericWheel: false,
    }),
  });
}
