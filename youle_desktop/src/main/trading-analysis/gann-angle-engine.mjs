import { gannPoint } from "./gann-theory-common.mjs";

export const GANN_ANGLE_ENGINE_ID = "gann-angle-engine-v1";

export const GANN_FAN_RATIOS = Object.freeze([
  Object.freeze({ label: "1x8", value: 1 / 8 }),
  Object.freeze({ label: "1x4", value: 1 / 4 }),
  Object.freeze({ label: "1x3", value: 1 / 3 }),
  Object.freeze({ label: "1x2", value: 1 / 2 }),
  Object.freeze({ label: "1x1", value: 1 }),
  Object.freeze({ label: "2x1", value: 2 }),
  Object.freeze({ label: "3x1", value: 3 }),
  Object.freeze({ label: "4x1", value: 4 }),
  Object.freeze({ label: "8x1", value: 8 }),
]);

export function runGannAngleEngine(context) {
  const { anchor, calibration, directionSign } = context;
  const lines = GANN_FAN_RATIOS.map((ratio) => {
    const barSpan = ratio.value <= 1 ? context.projection.spanBars : context.projection.spanBars / ratio.value;
    const priceSpan = ratio.value <= 1 ? context.projection.priceRange * ratio.value : context.projection.priceRange;
    const endIndex = anchor.index + barSpan;
    const endPrice = anchor.price + directionSign * priceSpan;
    return Object.freeze({
      id: `gann-angle-${ratio.label}`,
      ratio: ratio.label,
      slopeRatio: ratio.value,
      pricePerBar: calibration.pricePerBar * ratio.value,
      start: gannPoint(context, anchor.index, anchor.price),
      end: gannPoint(context, endIndex, endPrice),
    });
  });
  const oneByOne = lines.find((line) => line.ratio === "1x1");
  const relativeToOneByOne = context.direction === "bullish"
    ? context.latest.close >= context.projection.oneByOneNow ? "above" : "below"
    : context.latest.close <= context.projection.oneByOneNow ? "below" : "above";
  return Object.freeze({
    engineId: GANN_ANGLE_ENGINE_ID,
    status: "completed",
    direction: context.direction,
    anchor: context.anchor,
    scale: Object.freeze({
      pricePerBar: calibration.pricePerBar,
      cycleBars: calibration.cycleBars,
      method: calibration.method,
      screenAngleIndependent: true,
    }),
    lines: Object.freeze(lines),
    oneByOne,
    oneByOneAtLatest: context.projection.oneByOneNow,
    relativeToOneByOne,
  });
}
