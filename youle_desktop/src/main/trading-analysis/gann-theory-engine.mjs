import { runGannAngleEngine } from "./gann-angle-engine.mjs";
import { runGannSpiralEngine } from "./gann-spiral-engine.mjs";
import { runGannSquareEngine } from "./gann-square-engine.mjs";
import { GANN_THEORY_ENGINE_ID, prepareGannContext } from "./gann-theory-common.mjs";

function nearestLevel(levels, predicate, order) {
  return levels.filter(predicate).sort(order)[0] || null;
}

function actionPlan(context, fan, spiral) {
  const bullish = context.direction === "bullish";
  const latest = context.latest;
  const buffer = Math.max(context.rangeUnit * 0.15, latest.close * 0.00015);
  const structuralBoundary = context.previousOpposite?.price
    || (bullish
      ? Math.max(...context.candles.slice(-32).map((candle) => candle.high))
      : Math.min(...context.candles.slice(-32).map((candle) => candle.low)));
  const trigger = bullish ? structuralBoundary + buffer : structuralBoundary - buffer;
  const invalidation = bullish ? context.anchor.price - buffer : context.anchor.price + buffer;
  const risk = Math.max(Math.abs(trigger - invalidation), context.rangeUnit * 2);
  const eligibleLevels = spiral.levels.filter((level) => bullish
    ? level.price > trigger + risk * 0.45
    : level.price < trigger - risk * 0.45);
  eligibleLevels.sort((first, second) => bullish ? first.price - second.price : second.price - first.price);
  const targetOne = eligibleLevels[0]?.price ?? (bullish ? trigger + risk : trigger - risk);
  const targetTwoCandidate = eligibleLevels.find((level) => bullish
    ? level.price > targetOne + risk * 0.35
    : level.price < targetOne - risk * 0.35);
  const targetTwo = targetTwoCandidate?.price ?? (bullish ? trigger + risk * 2 : trigger - risk * 2);
  const closeConfirmed = bullish ? latest.close > trigger : latest.close < trigger;
  const nearOneByOne = Math.abs(latest.close - fan.oneByOneAtLatest) <= context.rangeUnit;
  const closestSpiral = nearestLevel(
    spiral.levels,
    () => true,
    (first, second) => Math.abs(first.price - latest.close) - Math.abs(second.price - latest.close),
  );
  const nearSpiral = closestSpiral && Math.abs(closestSpiral.price - latest.close) <= context.rangeUnit;
  return Object.freeze({
    primaryBias: context.direction,
    disposition: "wait",
    currentPrice: latest.close,
    validityBars: Math.min(12, Math.max(4, Math.round(context.calibration.cycleBars / 4))),
    triggerState: closeConfirmed ? "closed-beyond-trigger-await-retest" : "waiting-closed-breakout",
    calibration: Object.freeze({
      anchorPrice: context.anchor.price,
      pricePerBar: context.calibration.pricePerBar,
      cycleBars: context.calibration.cycleBars,
    }),
    confluence: Object.freeze({
      nearOneByOne,
      nearSquareOfNine: Boolean(nearSpiral),
      nearestSquareOfNinePrice: closestSpiral?.price || null,
    }),
    ...(bullish ? {
      longTrigger: trigger,
      longInvalidation: invalidation,
      longTarget: targetOne,
      longTargets: Object.freeze([targetOne, targetTwo]),
    } : {
      shortTrigger: trigger,
      shortInvalidation: invalidation,
      shortTarget: targetOne,
      shortTargets: Object.freeze([targetOne, targetTwo]),
    }),
    confirmation: closeConfirmed
      ? `价格已由已收盘 K 线越过结构触发位；仍须等待回踩/反抽守住，并重新核对 1x1 与数字螺旋价位，禁止追价`
      : `等待已收盘 K 线${bullish ? "站上" : "跌破"}结构触发位；盘中影线、单独触及角度线或数字螺旋价位均不构成执行确认`,
    observeTrigger: `优先观察 1x1 角度线 ${fan.oneByOneAtLatest} 与最近 Square of Nine 价位的共振；只有价格行为确认后才执行`,
    cancellation: "锚点被新的确认主摆动替代、价格收盘越过结构失效位、校准周期结束后未触发、数据覆盖下降或回踩/反抽重新收回触发位",
  });
}

export function runGannTheoryEngine(snapshot) {
  const context = prepareGannContext(snapshot);
  const fan = runGannAngleEngine(context);
  const square = runGannSquareEngine(context);
  const spiral = runGannSpiralEngine(context);
  const plan = actionPlan(context, fan, spiral);
  const evidence = [
    ...context.pivots.slice(-8).map((pivot) => Object.freeze({
      id: pivot.id,
      summary: `${pivot.type === "high" ? "确认高点" : "确认低点"} ${pivot.price}`,
    })),
    Object.freeze({
      id: "gann-scale-calibration",
      summary: `${context.calibration.method}: ${context.calibration.pricePerBar} price/bar, ${context.calibration.cycleBars} bars`,
    }),
    Object.freeze({
      id: "gann-square-of-nine-scale",
      summary: `Square of Nine priceUnit=${spiral.priceUnit}, normalizedAnchor=${spiral.normalizedAnchor}`,
    }),
    Object.freeze({
      id: `gann-last-closed-${context.latest.time}`,
      summary: `最后已收盘 K 线 ${context.latest.time} close=${context.latest.close}`,
    }),
  ];
  return Object.freeze({
    engineId: GANN_THEORY_ENGINE_ID,
    version: "1.0.0",
    status: "completed",
    direction: context.direction,
    closedCandleCount: context.candles.length,
    excludedLiveCandles: context.excludedLiveCandles,
    lastClosedCandle: context.latest,
    rangeUnit: context.rangeUnit,
    pivots: context.pivots,
    anchor: context.anchor,
    anchorQuality: context.anchorQuality,
    previousOpposite: context.previousOpposite,
    calibration: context.calibration,
    projection: context.projection,
    fan,
    square,
    spiral,
    actionPlan: plan,
    evidence: Object.freeze(evidence),
    limitations: Object.freeze({
      astrologyUsed: false,
      literalSpiralOverlay: false,
      forecastGuarantee: false,
      reason: "只自动化可由 OHLC 时间、确认摆动、价格/Bar 标尺和平方根因子复算的部分；角度与价位必须由收盘价格行为验证",
    }),
  });
}
