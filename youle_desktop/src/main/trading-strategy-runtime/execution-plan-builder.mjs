import crypto from "node:crypto";
import { EXECUTION_PLAN_SCHEMA_VERSION, validateExecutionPlan } from "./contracts.mjs";

const DEFAULT_EXECUTION_LEVERAGE = 10;
// Product default for the first executable take-profit target when the user
// has not configured a minimum. Ratios are represented as reward:risk in the
// runtime and displayed as `1:<ratio>`.
const DEFAULT_MINIMUM_RISK_REWARD_RATIO = 0.4;
const MINIMUM_FIRST_TARGET_RISK_REWARD_RATIO = DEFAULT_MINIMUM_RISK_REWARD_RATIO;
// Preferred ladder for the three exits. These are soft defaults: when the
// strategy's final target cannot support the complete ladder, keep the
// strategy-owned ratios while enforcing the user's configured minimum.
const PREFERRED_FIRST_TARGET_RATIO_MIN = 0.4;
const PREFERRED_FIRST_TARGET_RATIO_MAX = 0.6;
const PREFERRED_SECOND_TARGET_RATIO_MIN = 0.8;
const PREFERRED_SECOND_TARGET_RATIO_MAX = 1;
const PREFERRED_THIRD_TARGET_RATIO_MIN = 1.3;
const PREFERRED_THIRD_TARGET_RATIO_MAX = 1.5;
// Keep every strategy's executable entry condition close enough to the live
// market price to be realistically reachable. This is a shared execution
// policy, so strategy-specific structural levels remain evidence while the
// plan uses a bounded tactical trigger.
const MAX_TRIGGER_DISTANCE_PERCENT = 2;
const MAX_TRIGGER_DISTANCE_RATE = MAX_TRIGGER_DISTANCE_PERCENT / 100;
// Conservative fallback for both-side fees plus slippage when the read-only
// account snapshot does not expose an account-specific commission schedule.
const DEFAULT_ROUND_TRIP_COST_RATE = 0.002;
const ACCOUNT_SNAPSHOT_MAX_AGE_MS = 2 * 60_000;

function finite(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function nonNegative(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

function roundedDown(value, decimals = 2) {
  const normalized = nonNegative(value);
  if (normalized === null) return null;
  const scale = 10 ** decimals;
  return Math.floor((normalized + Number.EPSILON) * scale) / scale;
}

function roundedQuantity(value) {
  // Binance quantity precision varies by contract. Keep enough precision for
  // a useful recommendation, while rounding down so the displayed quantity
  // never exceeds the exposure used by the risk calculation.
  return roundedDown(value, 8);
}

function boundedRiskValue(value, min, max, fallback = null) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= min && normalized <= max
    ? normalized
    : fallback;
}

function normalizeUserRiskProfile(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nativelyEnforcedKeys = new Set([
    "max_loss_per_trade_percent",
    // Deprecated profile key: suppress it as a custom constraint, but never
    // cap the user's current max_loss_per_trade_percent with its old value.
    "absolute_max_loss_per_trade_percent",
    "max_position_percent",
    "max_leverage",
    "minimum_risk_reward_ratio",
    "preferred_stop_distance_percent",
    "max_stop_distance_percent",
    "preferred_take_profit_percent",
    "max_take_profit_percent",
    "preferred_stop_loss_percent",
    "risk_reward_preference",
    "move_stop_to_break_even",
    "break_even_trigger_r",
    "trading_analysis_style",
    "required_analysis_sections",
    "risk_conflict_handling",
    "onboarding_completed",
  ]);
  const customHardConstraints = (Array.isArray(source.entries) ? source.entries : [])
    .filter((entry) => (
      entry?.kind === "constraint"
      && entry?.strength === "hard"
      && !nativelyEnforcedKeys.has(String(entry?.key || ""))
    ))
    .slice(0, 24)
    .map((entry) => Object.freeze({
      key: String(entry.key || "").trim().slice(0, 96),
      value: String(entry.value ?? "").trim().slice(0, 300),
    }))
    .filter((entry) => entry.key && entry.value);
  const configuredMinimumRiskRewardRatio = boundedRiskValue(source.minimumRiskRewardRatio, Number.MIN_VALUE, 100);
  return Object.freeze({
    maxLossPerTradePercent: boundedRiskValue(source.maxLossPerTradePercent, 0.01, 100, 2),
    maxPositionPercent: boundedRiskValue(source.maxPositionPercent, 0.01, 100),
    maxLeverage: boundedRiskValue(source.maxLeverage, 1, 1_000),
    // An explicit user value has priority, including values below the
    // product default. Apply the product default only when no value is set.
    minimumRiskRewardRatio: configuredMinimumRiskRewardRatio ?? DEFAULT_MINIMUM_RISK_REWARD_RATIO,
    preferredStopDistancePercent: boundedRiskValue(source.preferredStopDistancePercent, 0.01, 100),
    maxStopDistancePercent: boundedRiskValue(source.maxStopDistancePercent, 0.01, 100),
    preferredTakeProfitPercent: boundedRiskValue(source.preferredTakeProfitPercent, 0.01, 100),
    maxTakeProfitPercent: boundedRiskValue(source.maxTakeProfitPercent, 0.01, 100),
    legacyAmbiguousStopLossPercent: boundedRiskValue(source.legacyAmbiguousStopLossPercent, 0.01, 100),
    riskClarificationRequired: source.riskClarificationRequired === true,
    moveStopToBreakEven: source.moveStopToBreakEven !== false,
    breakEvenTriggerR: boundedRiskValue(source.breakEvenTriggerR, 0.01, 100, 1),
    riskPreference: typeof source.riskPreference === "string"
      ? source.riskPreference.trim().slice(0, 120) || null
      : null,
    customHardConstraints: Object.freeze(customHardConstraints),
  });
}

function roundedPrice(value, tickSize = null) {
  const price = finite(value);
  if (price === null) return null;
  const tick = finite(tickSize);
  if (tick) return Number((Math.round(price / tick) * tick).toFixed(12));
  return Number(price.toFixed(8));
}

function intervalMilliseconds(interval) {
  const source = String(interval || "").trim().toUpperCase();
  if (source === "1D") return 86_400_000;
  if (source === "1W") return 604_800_000;
  const minutes = Number(source);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 3_600_000;
}

function marketSymbol(marketId) {
  const segments = String(marketId || "").split(":");
  return segments.at(-1) || String(marketId || "UNKNOWN");
}

function evidenceFromResult(result) {
  const evidence = Array.isArray(result?.theoryResult?.evidence) ? result.theoryResult.evidence : [];
  const seen = new Set();
  return evidence.slice(0, 64).flatMap((item) => {
    const id = String(item?.id ?? item ?? "").trim().slice(0, 160);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, summary: String(item?.summary || item?.label || item?.description || "").trim().slice(0, 300) }];
  });
}

function condition(id, text, evidenceIds = []) {
  return { id, text, evidenceIds };
}

function level(price, label, evidenceIds = [], tickSize = null) {
  const normalized = roundedPrice(price, tickSize);
  return normalized === null ? null : { price: normalized, label, evidenceIds };
}

function triggerPriceWithinCurrentRange(price, currentPrice, tickSize = null) {
  const trigger = finite(price);
  const current = finite(currentPrice);
  if (trigger === null || current === null) return trigger;
  const lower = current * (1 - MAX_TRIGGER_DISTANCE_RATE);
  const upper = current * (1 + MAX_TRIGGER_DISTANCE_RATE);
  const bounded = Math.min(upper, Math.max(lower, trigger));
  const tick = finite(tickSize);
  if (!tick) return Number(bounded.toFixed(8));

  // Keep the tick-normalized value inside the percentage envelope. Nearest
  // rounding can otherwise move a boundary one tick outside the policy.
  const minimumUnits = Math.ceil(lower / tick - Number.EPSILON);
  const maximumUnits = Math.floor(upper / tick + Number.EPSILON);
  if (minimumUnits > maximumUnits) return roundedPrice(bounded, tick);
  const units = Math.min(
    maximumUnits,
    Math.max(minimumUnits, Math.round(bounded / tick)),
  );
  return Number((units * tick).toFixed(12));
}

function triggerWasCapped(price, currentPrice, tickSize = null) {
  const source = finite(price);
  const normalized = triggerPriceWithinCurrentRange(price, currentPrice, tickSize);
  return source !== null
    && normalized !== null
    && Math.abs(source - normalized) > Math.max(Number.EPSILON, Math.abs(source) * 1e-12);
}

function inferredPreferredSide(actionPlan, theoryResult) {
  const normalizedSide = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (/bull|long|accum|向上|偏多|看多/.test(normalized)) return "long";
    if (/bear|short|distrib|向下|偏空|看空/.test(normalized)) return "short";
    if (/neutral|balanced|range|sideways|中性|震荡|横盘|双向/.test(normalized)) return "neutral";
    return null;
  };
  const explicitValues = [
    actionPlan?.primaryBias,
    actionPlan?.primaryScenario,
    actionPlan?.bias,
  ];
  for (const value of explicitValues) {
    const side = normalizedSide(value);
    if (side) return side;
  }
  const theoryValues = [
    theoryResult?.bias,
    theoryResult?.direction,
    theoryResult?.statistics?.direction,
    theoryResult?.marketStructure?.currentBias,
    theoryResult?.structure?.currentBias,
  ];
  for (const value of theoryValues) {
    const side = normalizedSide(value);
    if (side) return side;
  }
  const signals = Array.isArray(theoryResult?.signals) ? theoryResult.signals : [];
  let score = 0;
  for (const signal of signals) {
    const direction = String(
      signal?.direction
        || signal?.side
        || signal?.bias
        || signal?.kind
        || signal?.type
        || "",
    ).toLowerCase();
    const weight = Math.max(0.1, Math.min(1, Number(signal?.strength) || 0.5));
    if (/bull|buy|long|up/.test(direction)) score += weight;
    if (/bear|sell|short|down/.test(direction)) score -= weight;
  }
  return score > 0.2 ? "long" : score < -0.2 ? "short" : "neutral";
}

function scenario(side, actionPlan, status, evidenceIds, tickSize = null, currentPrice = null) {
  const long = side === "long";
  const triggerLabel = long ? "多头触发价" : "空头触发价";
  const rawTrigger = long ? actionPlan?.longTrigger : actionPlan?.shortTrigger;
  const normalizedTrigger = triggerPriceWithinCurrentRange(rawTrigger, currentPrice, tickSize);
  const triggerCapped = triggerWasCapped(rawTrigger, currentPrice, tickSize);
  const configuredTrigger = level(
    normalizedTrigger,
    triggerCapped ? `${triggerLabel}（距现价不超过 ±${MAX_TRIGGER_DISTANCE_PERCENT}%）` : triggerLabel,
    evidenceIds,
    tickSize,
  );
  const stopBasisLabel = String(actionPlan?.stopBasis?.label || "").trim();
  const stopLabel = `${long ? "多头失效/止损参考" : "空头失效/止损参考"}${stopBasisLabel ? `（${stopBasisLabel}）` : ""}`;
  const stop = level(long ? actionPlan?.longInvalidation : actionPlan?.shortInvalidation, stopLabel, evidenceIds, tickSize);
  const configuredTargets = long ? actionPlan?.longTargets : actionPlan?.shortTargets;
  const fallbackTarget = long ? actionPlan?.longTarget : actionPlan?.shortTarget;
  const targetBasis = Array.isArray(actionPlan?.targetBasis) ? actionPlan.targetBasis : [];
  const targetValues = (Array.isArray(configuredTargets) && configuredTargets.length
    ? configuredTargets
    : [fallbackTarget])
    .map(finite)
    .filter((value) => value !== null);
  const seenTargets = new Set();
  const targets = targetValues.flatMap((value, index) => {
    const basisLabel = String(targetBasis[index]?.label || "").trim();
    const target = level(
      value,
      `${long ? "多头" : "空头"}第 ${index + 1} 目标${basisLabel ? `（${basisLabel}）` : ""}`,
      evidenceIds,
      tickSize,
    );
    if (!target || seenTargets.has(target.price)) return [];
    seenTargets.add(target.price);
    return [target];
  }).slice(0, 8);
  if (!configuredTrigger || !stop || !targets.length) return null;
  const normalizedCurrentPrice = roundedPrice(currentPrice, tickSize);
  const currentPriceTriggered = status === "preferred"
    && normalizedCurrentPrice !== null
    && (long ? normalizedCurrentPrice >= configuredTrigger.price : normalizedCurrentPrice <= configuredTrigger.price);
  const trigger = currentPriceTriggered
    ? level(normalizedCurrentPrice, long ? "现价直接做多" : "现价直接做空", evidenceIds, tickSize)
    : configuredTrigger;
  return {
    id: `${side}-scenario`,
    side,
    status,
    trigger,
    stop,
    targets,
    conditions: [condition(
      `${side}-price-touch`,
      currentPriceTriggered
        ? `现价 ${trigger.price} 已满足条件，直接${long ? "做多" : "做空"}`
        : `价格触达 ${trigger.price} 即${long ? "做多" : "做空"}`,
      evidenceIds,
    )],
  };
}

function riskReward(entry, stop, target, side = null, estimatedRoundTripCostRate = 0) {
  const ratio = rawRiskReward(entry, stop, target, side, estimatedRoundTripCostRate);
  // ExecutionPlanV1 stores ratios in a bounded [0, 100] contract field. Keep
  // the raw ratio for gates, but cap the display/schema value when a very tight
  // structural stop makes the theoretical ratio exceed that bound.
  return ratio === null ? null : Number(Math.min(100, ratio).toFixed(2));
}

function rawRiskReward(entry, stop, target, side = null, estimatedRoundTripCostRate = 0) {
  if (!entry || !stop || !target) return null;
  if (side === "long" && !(stop.price < entry.price && entry.price < target.price)) return null;
  if (side === "short" && !(target.price < entry.price && entry.price < stop.price)) return null;
  const entryPrice = finite(entry.price);
  if (entryPrice === null) return null;
  const costRate = Number.isFinite(estimatedRoundTripCostRate) && estimatedRoundTripCostRate >= 0
    ? estimatedRoundTripCostRate
    : 0;
  const netRiskRate = Math.abs(entry.price - stop.price) / entryPrice + costRate;
  const netRewardRate = Math.abs(target.price - entry.price) / entryPrice - costRate;
  return netRiskRate > Number.EPSILON
    ? Math.max(0, netRewardRate) / netRiskRate
    : null;
}

function ensureMinimumRiskRewardPrice(value, price, side, estimatedRoundTripCostRate, minimumRatio, tickSize = null) {
  let candidate = finite(price);
  if (candidate === null) return null;
  const tick = finite(tickSize);
  const step = tick || 1e-8;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ratio = rawRiskReward(
      value?.trigger,
      value?.stop,
      { price: candidate },
      side,
      estimatedRoundTripCostRate,
    );
    if (ratio !== null && ratio + Number.EPSILON >= minimumRatio) return candidate;
    candidate = side === "long" ? candidate + step : candidate - step;
    candidate = tick
      ? Number((candidate / tick).toFixed(12)) * tick
      : Number(candidate.toFixed(8));
  }
  const finalRatio = rawRiskReward(
    value?.trigger,
    value?.stop,
    { price: candidate },
    side,
    estimatedRoundTripCostRate,
  );
  return finalRatio !== null && finalRatio + Number.EPSILON >= minimumRatio
    ? candidate
    : null;
}

function roundedIntermediateTargetPrice(value, side, tickSize = null) {
  const price = finite(value);
  if (price === null) return null;
  const tick = finite(tickSize);
  if (tick) {
    const units = side === "long"
      ? Math.floor(price / tick + Number.EPSILON)
      : Math.ceil(price / tick - Number.EPSILON);
    return Number((units * tick).toFixed(12));
  }
  const scale = 10 ** 8;
  const normalized = side === "long"
    ? Math.floor(price * scale + Number.EPSILON) / scale
    : Math.ceil(price * scale - Number.EPSILON) / scale;
  return Number(normalized.toFixed(8));
}

function roundedMinimumTargetPrice(value, side, tickSize = null) {
  const price = finite(value);
  if (price === null) return null;
  const tick = finite(tickSize);
  if (tick) {
    // For a minimum reward floor, round in the favorable direction so the
    // normalized price cannot silently fall below the requested ratio.
    const units = side === "long"
      ? Math.ceil(price / tick - Number.EPSILON)
      : Math.floor(price / tick + Number.EPSILON);
    return Number((units * tick).toFixed(12));
  }
  const scale = 10 ** 8;
  const normalized = side === "long"
    ? Math.ceil(price * scale - Number.EPSILON) / scale
    : Math.floor(price * scale + Number.EPSILON) / scale;
  return Number(normalized.toFixed(8));
}

function targetPriceForPercent(entryPrice, side, percent, tickSize = null) {
  const entry = finite(entryPrice);
  const normalizedPercent = boundedRiskValue(percent, 0.01, 100);
  if (entry === null || normalizedPercent === null) return null;
  const multiplier = normalizedPercent / 100;
  return roundedIntermediateTargetPrice(
    side === "long" ? entry * (1 + multiplier) : entry * (1 - multiplier),
    side,
    tickSize,
  );
}

function minimumRiskRewardTarget(
  value,
  estimatedRoundTripCostRate,
  tickSize = null,
  minimumRatio = MINIMUM_FIRST_TARGET_RISK_REWARD_RATIO,
) {
  if (!value?.trigger || !value?.stop || !value?.targets?.length) return null;
  const entryPrice = finite(value.trigger.price);
  const stopPrice = finite(value.stop.price);
  if (entryPrice === null || stopPrice === null) return null;
  const costRate = Number.isFinite(estimatedRoundTripCostRate) && estimatedRoundTripCostRate >= 0
    ? estimatedRoundTripCostRate
    : 0;
  const netRiskRate = Math.abs(entryPrice - stopPrice) / entryPrice + costRate;
  if (!Number.isFinite(netRiskRate) || netRiskRate <= Number.EPSILON) return null;
  const requestedRatio = Number(minimumRatio);
  const requiredRatio = Number.isFinite(requestedRatio) && requestedRatio > 0
    ? requestedRatio
    : DEFAULT_MINIMUM_RISK_REWARD_RATIO;
  const favorableMove = entryPrice * (requiredRatio * netRiskRate + costRate);
  const rawPrice = value.side === "long"
    ? entryPrice + favorableMove
    : entryPrice - favorableMove;
  const price = ensureMinimumRiskRewardPrice(
    value,
    roundedMinimumTargetPrice(rawPrice, value.side, tickSize),
    value.side,
    estimatedRoundTripCostRate,
    requiredRatio,
    tickSize,
  );
  if (price === null) return null;
  const directional = value.side === "long" ? price > entryPrice : price < entryPrice;
  if (!directional) return null;
  const template = value.targets.at(-1);
  return {
    ...template,
    price,
    label: `${value.side === "long" ? "多头" : "空头"}结构风险倍数兜底目标 R${requiredRatio}（最低净盈亏比）`,
  };
}

function scenarioWithTakeProfitCap(value, maxTakeProfitPercent, tickSize = null) {
  if (!value?.targets?.length || maxTakeProfitPercent === null) return value;
  const cappedPrice = targetPriceForPercent(
    value.trigger?.price,
    value.side,
    maxTakeProfitPercent,
    tickSize,
  );
  if (cappedPrice === null) return value;
  const seen = new Set();
  const targets = value.targets.flatMap((target) => {
    const beyondCap = value.side === "long" ? target.price > cappedPrice : target.price < cappedPrice;
    const price = beyondCap ? cappedPrice : target.price;
    if (seen.has(price)) return [];
    seen.add(price);
    return [{
      ...target,
      price,
      label: beyondCap
        ? `${value.side === "long" ? "多头" : "空头"}目标（用户最大止盈距离 ${maxTakeProfitPercent}%）${waveBasisLabel(target) ? `；依据 ${waveBasisLabel(target)}` : ""}`
        : target.label,
    }];
  });
  return targets.length ? { ...value, targets } : null;
}

function scenarioWithThreeTakeProfitTargets(
  value,
  estimatedRoundTripCostRate,
  tickSize = null,
  preferredTakeProfitPercent = null,
  minimumRequiredRatio = DEFAULT_MINIMUM_RISK_REWARD_RATIO,
) {
  if (!value?.targets?.length) return value;
  const requestedRatio = Number(minimumRequiredRatio);
  const minimumTargetRiskRewardRatio = Number.isFinite(requestedRatio) && requestedRatio > 0
    ? requestedRatio
    : DEFAULT_MINIMUM_RISK_REWARD_RATIO;
  const finalTarget = value.targets.reduce((selected, target) => {
    if (!selected) return target;
    if (value.side === "long") return target.price > selected.price ? target : selected;
    return target.price < selected.price ? target : selected;
  }, null);
  const entryPrice = finite(value.trigger?.price);
  const finalTargetPrice = finite(finalTarget?.price);
  const finalRatio = rawRiskReward(
    value.trigger,
    value.stop,
    finalTarget,
    value.side,
    estimatedRoundTripCostRate,
  );
  if (
    entryPrice === null
    || finalTargetPrice === null
    || finalRatio === null
    || finalRatio + Number.EPSILON < minimumTargetRiskRewardRatio
  ) return null;

  // Wave action levels are already measured from the approved candidate. Keep
  // at most three measured levels (nearest, middle, farthest) so existing
  // plan consumers receive a compact ladder. A complete measured ladder stays
  // authoritative; when one or two measured levels are missing, fill the
  // available space before the final target with the shared preferred first
  // and second ratios, even if the final strategy ratio is outside the
  // preferred third band.
  const measuredTargets = value.targets.some((target) => Boolean(waveBasisLabel(target)))
    ? (() => {
      const ordered = [...value.targets].sort((left, right) => value.side === "long"
        ? left.price - right.price
        : right.price - left.price);
      if (ordered.length <= 3) return ordered;
      return [ordered[0], ordered[Math.floor((ordered.length - 1) / 2)], ordered.at(-1)]
        .filter((target, index, items) => items.findIndex((item) => item.price === target.price) === index);
    })()
    : null;
  if (measuredTargets?.length) {
    let waveTargets = measuredTargets;
    const preferredPrice = targetPriceForPercent(
      entryPrice,
      value.side,
      preferredTakeProfitPercent,
      tickSize,
    );
    const preferredInsideWaveRange = preferredPrice !== null && (
      value.side === "long"
        ? entryPrice < preferredPrice && preferredPrice < finalTargetPrice
        : finalTargetPrice < preferredPrice && preferredPrice < entryPrice
    );
    if (preferredInsideWaveRange && !waveTargets.some((target) => target.price === preferredPrice)) {
      const sideLabel = value.side === "long" ? "多头" : "空头";
      const preferredTarget = {
        ...finalTarget,
        price: preferredPrice,
        label: `${sideLabel}常规止盈目标（用户偏好 ${preferredTakeProfitPercent}%）`,
      };
      const preferredRatio = rawRiskReward(
        value.trigger,
        value.stop,
        preferredTarget,
        value.side,
        estimatedRoundTripCostRate,
      );
      if (preferredRatio !== null && preferredRatio + Number.EPSILON >= minimumTargetRiskRewardRatio) {
        const ordered = [...waveTargets, preferredTarget].sort((left, right) => value.side === "long"
          ? left.price - right.price
          : right.price - left.price);
        waveTargets = [ordered[0], preferredTarget, ordered.at(-1)]
          .filter((target, index, items) => items.findIndex((item) => item.price === target.price) === index);
      }
    }
    const validWaveTargets = waveTargets.filter((target) => {
      const ratio = rawRiskReward(value.trigger, value.stop, target, value.side, estimatedRoundTripCostRate);
      return ratio !== null && ratio + Number.EPSILON >= minimumTargetRiskRewardRatio;
    });
    const finalRatioInPreferredThirdBand = finalRatio + Number.EPSILON >= PREFERRED_THIRD_TARGET_RATIO_MIN
      && finalRatio - Number.EPSILON <= PREFERRED_THIRD_TARGET_RATIO_MAX;
    // A complete measured ladder (three valid structural levels) is already
    // the strategy's best evidence when its final ratio sits outside the soft
    // third-target band. For one or two measured levels, continue below and
    // synthesize missing preferred exits whenever the final target leaves room.
    if ((validWaveTargets.length >= 3 && !finalRatioInPreferredThirdBand) || validWaveTargets.length < 1) {
      return { ...value, targets: validWaveTargets };
    }

    const orderedWaveTargets = [...validWaveTargets].sort((left, right) => value.side === "long"
      ? left.price - right.price
      : right.price - left.price);
    const finalWaveTarget = orderedWaveTargets.at(-1) || finalTarget;
    const ratioFor = (target) => rawRiskReward(
      value.trigger,
      value.stop,
      target,
      value.side,
      estimatedRoundTripCostRate,
    );
    const pickMeasuredInRange = (minimum, maximum, excluded = new Set()) => orderedWaveTargets
      .filter((target) => !excluded.has(target.price) && target.price !== finalWaveTarget.price)
      .map((target) => ({ target, ratio: ratioFor(target) }))
      .filter(({ ratio }) => ratio !== null && ratio + Number.EPSILON >= minimum && ratio - Number.EPSILON <= maximum)
      .sort((left, right) => Math.abs(left.ratio - (minimum + maximum) / 2) - Math.abs(right.ratio - (minimum + maximum) / 2))[0]?.target
      || null;
    const costRate = Number.isFinite(estimatedRoundTripCostRate) && estimatedRoundTripCostRate >= 0
      ? estimatedRoundTripCostRate
      : 0;
    const netRiskRate = Math.abs(value.trigger.price - value.stop.price) / entryPrice + costRate;
    const priceForRatio = (ratio) => {
      if (!Number.isFinite(netRiskRate) || netRiskRate <= Number.EPSILON) return null;
      const favorableMove = entryPrice * (ratio * netRiskRate + costRate);
      const rawPrice = value.side === "long"
        ? entryPrice + favorableMove
        : entryPrice - favorableMove;
      const rounded = roundedIntermediateTargetPrice(rawPrice, value.side, tickSize);
      return rounded === null
        ? null
        : ensureMinimumRiskRewardPrice(
          value,
          roundedMinimumTargetPrice(rawPrice, value.side, tickSize),
          value.side,
          estimatedRoundTripCostRate,
          ratio,
          tickSize,
        );
    };
    const makePreferredTarget = (ratio, label) => {
      const price = priceForRatio(ratio);
      if (price === null) return null;
      const target = {
        ...finalWaveTarget,
        price,
        label,
      };
      const actualRatio = ratioFor(target);
      const ordered = value.side === "long"
        ? entryPrice < price && price < finalTargetPrice
        : finalTargetPrice < price && price < entryPrice;
      return actualRatio !== null
        && actualRatio + Number.EPSILON >= minimumTargetRiskRewardRatio
        && ordered
        ? target
        : null;
    };
    const sideLabel = value.side === "long" ? "多头" : "空头";
    const firstMeasured = pickMeasuredInRange(
      PREFERRED_FIRST_TARGET_RATIO_MIN,
      PREFERRED_FIRST_TARGET_RATIO_MAX,
    );
    const firstTarget = firstMeasured || makePreferredTarget(
      (PREFERRED_FIRST_TARGET_RATIO_MIN + PREFERRED_FIRST_TARGET_RATIO_MAX) / 2,
      `${sideLabel}第 1 目标（结构风险倍数兜底目标 R0.5；优先净盈亏比 1:0.4–1:0.6）`,
    );
    const firstPrices = new Set(firstTarget ? [firstTarget.price] : []);
    const secondMeasured = pickMeasuredInRange(
      PREFERRED_SECOND_TARGET_RATIO_MIN,
      PREFERRED_SECOND_TARGET_RATIO_MAX,
      firstPrices,
    );
    const secondTarget = secondMeasured || makePreferredTarget(
      (PREFERRED_SECOND_TARGET_RATIO_MIN + PREFERRED_SECOND_TARGET_RATIO_MAX) / 2,
      `${sideLabel}第 2 目标（结构风险倍数兜底目标 R0.9；优先净盈亏比 1:0.8–1:1）`,
    );
    const preferredTargets = [firstTarget, secondTarget, finalWaveTarget]
      .filter(Boolean)
      .sort((left, right) => value.side === "long" ? left.price - right.price : right.price - left.price)
      .filter((target, index, items) => items.findIndex((item) => item.price === target.price) === index)
      .filter((target) => {
        const ratio = ratioFor(target);
        return ratio !== null && ratio + Number.EPSILON >= minimumTargetRiskRewardRatio;
      });
    // Tick-size rounding or a very compressed structure can make one of the
    // preferred prices collide with the final target. Keep every valid
    // preferred level that still fits; fall back to measured levels only when
    // even a single intermediate exit cannot be retained.
    if (preferredTargets.length < Math.min(2, validWaveTargets.length + 1)) {
      return { ...value, targets: validWaveTargets };
    }
    const renumberedTargets = preferredTargets.slice(0, 3).map((target, index) => {
      const basis = waveBasisLabel(target);
      const originalLabel = String(target.label || "");
      const preferredText = originalLabel.match(/优先净盈亏比 [^）;；]+/)?.[0] || "";
      const suffix = preferredText ? `；${preferredText}` : "";
      return {
        ...target,
        label: basis
          ? `${sideLabel}第 ${index + 1} 目标（${basis}${suffix}）`
          : originalLabel.replace(/第\s*\d+\s*目标/, `第 ${index + 1} 目标`),
      };
    });
    return { ...value, targets: renumberedTargets };
  }

  const costRate = Number.isFinite(estimatedRoundTripCostRate) && estimatedRoundTripCostRate >= 0
    ? estimatedRoundTripCostRate
    : 0;
  const netRiskRate = Math.abs(value.trigger.price - value.stop.price) / entryPrice + costRate;
  const secondTargetRatio = Math.min(PREFERRED_SECOND_TARGET_RATIO_MIN, finalRatio * (2 / 3));
  const firstTargetRatio = Math.min(
    (PREFERRED_FIRST_TARGET_RATIO_MIN + PREFERRED_FIRST_TARGET_RATIO_MAX) / 2,
    Math.max(PREFERRED_FIRST_TARGET_RATIO_MIN, secondTargetRatio * (5 / 8)),
  );
  const priceForRatio = (ratio, fallbackProgress, minimumFloor = false) => {
    const favorableMove = finalRatio > Number.EPSILON
      ? entryPrice * (ratio * netRiskRate + costRate)
      : Math.abs(finalTargetPrice - entryPrice) * fallbackProgress;
    const rawPrice = value.side === "long"
      ? entryPrice + favorableMove
      : entryPrice - favorableMove;
    const rounded = roundedIntermediateTargetPrice(rawPrice, value.side, tickSize);
    if (!minimumFloor || rounded === null) return rounded;
    const roundedRatio = rawRiskReward(
      value.trigger,
      value.stop,
      { price: rounded },
      value.side,
      estimatedRoundTripCostRate,
    );
    return roundedRatio !== null && roundedRatio + Number.EPSILON >= minimumTargetRiskRewardRatio
      ? rounded
      : ensureMinimumRiskRewardPrice(
        value,
        roundedMinimumTargetPrice(rawPrice, value.side, tickSize),
        value.side,
        estimatedRoundTripCostRate,
        minimumTargetRiskRewardRatio,
        tickSize,
      );
  };
  const sideLabel = value.side === "long" ? "多头" : "空头";
  let intermediateTargets = [];
  const candidateTargets = [
    {
      price: priceForRatio(firstTargetRatio, 1 / 3, true),
      ratio: firstTargetRatio,
      label: `${sideLabel}第 1 目标（优先净盈亏比 1:0.4–1:0.6；最低按用户设定 1:${minimumTargetRiskRewardRatio}）`,
    },
    {
      price: priceForRatio(secondTargetRatio, 2 / 3),
      ratio: secondTargetRatio,
      label: `${sideLabel}第 2 目标（优先净盈亏比 1:0.8–1:1）`,
    },
  ];
  for (const candidate of candidateTargets) {
    if (candidate.price === null) continue;
    const ratio = rawRiskReward(
      value.trigger,
      value.stop,
      { price: candidate.price },
      value.side,
      estimatedRoundTripCostRate,
    );
    if (ratio === null || ratio + Number.EPSILON < minimumTargetRiskRewardRatio) continue;
    const ordered = value.side === "long"
      ? entryPrice < candidate.price && candidate.price < finalTargetPrice
      : finalTargetPrice < candidate.price && candidate.price < entryPrice;
    if (!ordered || intermediateTargets.some((target) => target.price === candidate.price)) continue;
    intermediateTargets.push({ ...finalTarget, ...candidate });
  }
  intermediateTargets.sort((left, right) => value.side === "long"
    ? left.price - right.price
    : right.price - left.price);
  const preferredPrice = targetPriceForPercent(
    entryPrice,
    value.side,
    preferredTakeProfitPercent,
    tickSize,
  );
  const preferredInsideStrategyRange = preferredPrice !== null && (
    value.side === "long"
      ? entryPrice < preferredPrice && preferredPrice < finalTargetPrice
      : finalTargetPrice < preferredPrice && preferredPrice < entryPrice
  );
  if (preferredInsideStrategyRange && !intermediateTargets.some((target) => target.price === preferredPrice)) {
    const preferredTarget = {
      ...finalTarget,
      price: preferredPrice,
      label: `${sideLabel}常规止盈目标（用户偏好 ${preferredTakeProfitPercent}%）`,
    };
    const preferredRatio = rawRiskReward(
      value.trigger,
      value.stop,
      preferredTarget,
      value.side,
      estimatedRoundTripCostRate,
    );
    if (preferredRatio !== null && preferredRatio + Number.EPSILON >= minimumTargetRiskRewardRatio) {
      const orderedIntermediates = [...intermediateTargets, preferredTarget]
        .sort((left, right) => value.side === "long" ? left.price - right.price : right.price - left.price);
      const earliest = orderedIntermediates[0];
      intermediateTargets = [earliest, preferredTarget]
        .filter((target, index, items) => items.findIndex((item) => item.price === target.price) === index);
      if (intermediateTargets.length < 2) {
        const next = orderedIntermediates.find((target) => target.price !== earliest?.price);
        if (next) intermediateTargets.push(next);
      }
      intermediateTargets.sort((left, right) => value.side === "long"
        ? left.price - right.price
        : right.price - left.price);
    }
  }
  const targets = [...intermediateTargets, {
    ...finalTarget,
    label: /用户最大止盈距离|Fib |候选结构投影/.test(String(finalTarget.label || ""))
      ? finalTarget.label
      : `${sideLabel}第 ${intermediateTargets.length + 1} 目标（原策略止盈位${finalRatio + Number.EPSILON >= PREFERRED_THIRD_TARGET_RATIO_MIN && finalRatio - Number.EPSILON <= PREFERRED_THIRD_TARGET_RATIO_MAX ? "；优先净盈亏比 1:1.3–1:1.5" : "；优先区间不可用，保留当前比例"}）`,
  }].filter((target, index, items) => items.findIndex((item) => item.price === target.price) === index);
  if (!targets.length || targets.some((target) => {
    const ratio = rawRiskReward(value.trigger, value.stop, target, value.side, estimatedRoundTripCostRate);
    return ratio === null || ratio + Number.EPSILON < minimumTargetRiskRewardRatio;
  })) return null;
  return {
    ...value,
    targets,
  };
}

function scenarioWithValidRiskRewardTargets(
  value,
  estimatedRoundTripCostRate,
  tickSize = null,
  minimumRequiredRatio = MINIMUM_FIRST_TARGET_RISK_REWARD_RATIO,
) {
  if (!value) return value;
  const finalTarget = value.targets.reduce((selected, target) => {
    if (!selected) return target;
    return value.side === "long"
      ? target.price > selected.price ? target : selected
      : target.price < selected.price ? target : selected;
  }, null);
  const finalRatio = rawRiskReward(
    value.trigger,
    value.stop,
    finalTarget,
    value.side,
    estimatedRoundTripCostRate,
  );
  const requestedRatio = Number(minimumRequiredRatio);
  const requiredRatio = Number.isFinite(requestedRatio) && requestedRatio > 0
    ? requestedRatio
    : DEFAULT_MINIMUM_RISK_REWARD_RATIO;
  const fallbackTarget = finalRatio !== null && finalRatio + Number.EPSILON < requiredRatio
    ? minimumRiskRewardTarget(value, estimatedRoundTripCostRate, tickSize, requiredRatio)
    : null;
  const candidates = fallbackTarget ? [...value.targets, fallbackTarget] : value.targets;
  const targets = candidates.filter((target) => {
    const ratio = rawRiskReward(
      value.trigger,
      value.stop,
      target,
      value.side,
      estimatedRoundTripCostRate,
    );
    return ratio !== null && ratio + Number.EPSILON >= requiredRatio;
  });
  return targets.length ? { ...value, targets } : null;
}

function normalizedAccountContext(value, now) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.bound !== true) return { status: "unbound", snapshot: null };
  const snapshot = source.snapshot && typeof source.snapshot === "object" && !Array.isArray(source.snapshot)
    ? source.snapshot
    : null;
  const fetchedAt = snapshot ? Date.parse(String(snapshot.fetchedAt || "")) : Number.NaN;
  const snapshotAge = Number.isFinite(fetchedAt) ? now - fetchedAt : Number.POSITIVE_INFINITY;
  const stale = (Array.isArray(snapshot?.warnings) ? snapshot.warnings : [])
    .some((warning) => /上次成功读取的数据|stale/i.test(String(warning || "")));
  if (
    source.available !== true
    || !snapshot
    || stale
    || snapshotAge < -30_000
    || snapshotAge > ACCOUNT_SNAPSHOT_MAX_AGE_MS
  ) return { status: "unavailable", snapshot: null };
  const equity = finite(snapshot.marginBalance);
  const availableBalance = nonNegative(snapshot.availableBalance);
  if (equity === null || availableBalance === null) return { status: "unavailable", snapshot: null };
  const positions = (Array.isArray(snapshot.positions) ? snapshot.positions : []).flatMap((position) => {
    const symbol = String(position?.symbol || "").trim().toUpperCase();
    const direction = String(position?.direction || "").trim().toUpperCase();
    const notionalValue = finite(position?.notionalValue);
    const markPrice = finite(position?.markPrice);
    if (!symbol || !["LONG", "SHORT"].includes(direction) || notionalValue === null || markPrice === null) return [];
    return [{
      symbol,
      side: direction === "LONG" ? "long" : "short",
      notionalValue,
      markPrice,
      amount: nonNegative(position?.amount),
      entryPrice: finite(position?.entryPrice),
      unrealizedPnl: Number.isFinite(Number(position?.unrealizedPnl)) ? Number(position.unrealizedPnl) : null,
      leverage: Math.max(1, Math.floor(finite(position?.leverage) || 1)),
    }];
  });
  return {
    status: "available",
    snapshot: {
      fetchedAt,
      equity,
      availableBalance,
      positions,
    },
  };
}

function executionCostRate(params) {
  const configured = Number(params?.estimatedRoundTripCostRate);
  return Number.isFinite(configured) && configured >= 0 && configured <= 0.05
    ? configured
    : DEFAULT_ROUND_TRIP_COST_RATE;
}

function directionalMoveRate(side, entryPrice, exitPrice) {
  const entry = finite(entryPrice);
  const exit = finite(exitPrice);
  if (entry === null || exit === null) return null;
  const move = side === "long" ? (exit - entry) / entry : (entry - exit) / entry;
  return Number.isFinite(move) ? move : null;
}

function accountExecutionPlan({
  accountContext,
  market,
  scenario: preferredScenario,
  takeProfits,
  riskPolicy,
  estimatedRoundTripCostRate,
  sizingBlockedReason = null,
  now,
}) {
  const account = normalizedAccountContext(accountContext, now);
  if (sizingBlockedReason) {
    return { accountStatus: account.status, accountPlan: null, sizingBlockedReason };
  }
  if (account.status !== "available" || !preferredScenario || !takeProfits.length) {
    return { accountStatus: account.status, accountPlan: null };
  }
  const snapshot = account.snapshot;
  const sameMarketPositions = snapshot.positions.filter((position) => position.symbol === market.symbol.toUpperCase());
  const oppositePosition = sameMarketPositions.find((position) => position.side !== preferredScenario.side);
  if (oppositePosition) {
    return {
      accountStatus: "available",
      accountPlan: {
        mode: "close_opposite",
        snapshotAt: snapshot.fetchedAt,
        equity: snapshot.equity,
        availableBalance: snapshot.availableBalance,
        leverage: oppositePosition.leverage,
        entryPrice: oppositePosition.markPrice,
        notional: oppositePosition.notionalValue,
        quantity: roundedQuantity(oppositePosition.amount || oppositePosition.notionalValue / oppositePosition.markPrice),
        existingSide: oppositePosition.side,
        existingNotional: oppositePosition.notionalValue,
        existingQuantity: oppositePosition.amount || roundedQuantity(oppositePosition.notionalValue / oppositePosition.markPrice),
        existingEntryPrice: oppositePosition.entryPrice,
        existingUnrealizedPnl: oppositePosition.unrealizedPnl,
        estimatedStopLoss: null,
        estimatedTakeProfit: null,
        estimatedRoundTripCostRate,
        targetOrders: [],
      },
    };
  }
  const sameSidePosition = sameMarketPositions.find((position) => position.side === preferredScenario.side) || null;
  const costRate = estimatedRoundTripCostRate;
  const riskBudget = snapshot.equity * (riskPolicy.maxLossPerTradePercent / 100);
  const entryPrice = sameSidePosition?.markPrice || preferredScenario.trigger.price;
  const adverseMoveRate = -directionalMoveRate(preferredScenario.side, entryPrice, preferredScenario.stop.price);
  if (!Number.isFinite(adverseMoveRate) || adverseMoveRate <= 0) {
    return { accountStatus: "available", accountPlan: null };
  }
  const lossRate = adverseMoveRate + costRate;
  let mode = sameSidePosition ? "manage_existing" : "new_position";
  let leverage = sameSidePosition?.leverage
    || Math.max(1, Math.floor(Math.min(DEFAULT_EXECUTION_LEVERAGE, riskPolicy.maxLeverage || DEFAULT_EXECUTION_LEVERAGE)));
  let notional = sameSidePosition?.notionalValue || riskBudget / lossRate;
  if (!sameSidePosition) {
    notional = Math.min(notional, snapshot.availableBalance * leverage);
    if (riskPolicy.maxPositionPercent !== null) {
      notional = Math.min(notional, snapshot.equity * (riskPolicy.maxPositionPercent / 100));
    }
  } else if (notional * lossRate > riskBudget) {
    mode = "reduce_existing";
    notional = riskBudget / lossRate;
  }
  notional = roundedDown(notional, 2);
  if (notional === null || notional <= 0) {
    return { accountStatus: "available", accountPlan: null };
  }
  const targetOrders = [];
  let allocated = 0;
  for (const [index, takeProfit] of takeProfits.entries()) {
    const targetNotional = index === takeProfits.length - 1
      ? roundedDown(Math.max(0, notional - allocated), 2)
      : roundedDown(notional * (takeProfit.allocationPercent / 100), 2);
    allocated += targetNotional || 0;
    const favorableMoveRate = directionalMoveRate(preferredScenario.side, entryPrice, takeProfit.price.price);
    targetOrders.push({
      targetIndex: index,
      price: takeProfit.price.price,
      notional: targetNotional || 0,
      estimatedNetProfit: roundedDown(Math.max(0, (targetNotional || 0) * ((favorableMoveRate || 0) - costRate)), 2),
    });
  }
  return {
    accountStatus: "available",
    accountPlan: {
      mode,
      snapshotAt: snapshot.fetchedAt,
      equity: roundedDown(snapshot.equity, 2),
      availableBalance: roundedDown(snapshot.availableBalance, 2),
      leverage,
      entryPrice,
      notional,
      quantity: roundedQuantity(notional / entryPrice),
      existingSide: sameSidePosition?.side || null,
      existingNotional: roundedDown(sameSidePosition?.notionalValue || 0, 2),
      existingQuantity: sameSidePosition
        ? roundedQuantity(sameSidePosition.amount || sameSidePosition.notionalValue / sameSidePosition.markPrice)
        : 0,
      existingEntryPrice: sameSidePosition?.entryPrice || null,
      existingUnrealizedPnl: sameSidePosition?.unrealizedPnl ?? null,
      estimatedStopLoss: roundedDown(notional * lossRate, 2),
      estimatedTakeProfit: roundedDown(targetOrders.reduce((total, target) => total + target.estimatedNetProfit, 0), 2),
      estimatedRoundTripCostRate: costRate,
      targetOrders,
    },
  };
}

function planHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function buildExecutionPlanV1(manifest, legacyResult, params = {}) {
  const snapshot = legacyResult?.snapshot || {};
  const analysisPlan = legacyResult?.analysisPlan || {};
  const theoryResult = legacyResult?.theoryResult || {};
  const actionPlan = analysisPlan.actionPlan || {};
  const riskPolicy = normalizeUserRiskProfile(params.userRiskProfile);
  // Lower explicit user values may relax the product default. Higher values
  // remain a final execution gate so the original strategy levels stay
  // visible for review instead of being replaced by synthetic distant exits.
  const executionTargetMinimumRiskReward = Math.min(
    riskPolicy.minimumRiskRewardRatio,
    DEFAULT_MINIMUM_RISK_REWARD_RATIO,
  );
  const actionLevelEvidence = [
    ["long-trigger", actionPlan.longTrigger, "确定性结果给出的多头触发价"],
    ["long-invalidation", actionPlan.longInvalidation, "确定性结果给出的多头失效价"],
    ["long-target", actionPlan.longTarget, "确定性结果给出的多头目标价"],
    ["short-trigger", actionPlan.shortTrigger, "确定性结果给出的空头触发价"],
    ["short-invalidation", actionPlan.shortInvalidation, "确定性结果给出的空头失效价"],
    ["short-target", actionPlan.shortTarget, "确定性结果给出的空头目标价"],
  ].flatMap(([id, value, summary]) => finite(value) ? [{ id: `${manifest.id}-${id}`, summary }] : []);
  const stopBasisEvidence = Array.isArray(actionPlan.stopBasis?.evidenceIds)
    ? actionPlan.stopBasis.evidenceIds.slice(0, 8).map((id) => ({
      id: String(id),
      summary: `结构${actionPlan.stopBasis.kind === "support_zone" ? "支撑" : "阻力"}区确认触点（${actionPlan.stopBasis.sourceRoles?.join("/") || "确定性摆点"}）`,
    }))
    : [];
  const evidence = [...actionLevelEvidence, ...stopBasisEvidence, ...evidenceFromResult(legacyResult)];
  const evidenceIds = [...new Set(evidence.map((item) => item.id))].slice(0, 16);
  const tickSize = finite(params.tickSize);
  const estimatedRoundTripCostRate = executionCostRate(params);
  const preferredSide = inferredPreferredSide(actionPlan, theoryResult);
  const currentPrice = finite(params.currentPrice)
    || finite(params?.candles?.at?.(-1)?.close)
    || finite(actionPlan.currentPrice)
    || finite(snapshot?.candles?.at?.(-1)?.close)
    || null;
  const rawLongScenario = scenario(
    "long",
    actionPlan,
    preferredSide === "long" ? "preferred" : "conditional",
    evidenceIds,
    tickSize,
    currentPrice,
  );
  const rawShortScenario = scenario(
    "short",
    actionPlan,
    preferredSide === "short" ? "preferred" : "conditional",
    evidenceIds,
    tickSize,
    currentPrice,
  );
  const longScenario = scenarioWithThreeTakeProfitTargets(
    scenarioWithTakeProfitCap(
      scenarioWithValidRiskRewardTargets(
        scenarioWithTakeProfitCap(rawLongScenario, riskPolicy.maxTakeProfitPercent, tickSize),
        estimatedRoundTripCostRate,
        tickSize,
        executionTargetMinimumRiskReward,
      ),
      riskPolicy.maxTakeProfitPercent,
      tickSize,
    ),
    estimatedRoundTripCostRate,
    tickSize,
    riskPolicy.preferredTakeProfitPercent,
    executionTargetMinimumRiskReward,
  );
  const shortScenario = scenarioWithThreeTakeProfitTargets(
    scenarioWithTakeProfitCap(
      scenarioWithValidRiskRewardTargets(
        scenarioWithTakeProfitCap(rawShortScenario, riskPolicy.maxTakeProfitPercent, tickSize),
        estimatedRoundTripCostRate,
        tickSize,
        executionTargetMinimumRiskReward,
      ),
      riskPolicy.maxTakeProfitPercent,
      tickSize,
    ),
    estimatedRoundTripCostRate,
    tickSize,
    riskPolicy.preferredTakeProfitPercent,
    executionTargetMinimumRiskReward,
  );
  const scenarios = [longScenario, shortScenario].filter(Boolean);
  const preferredScenario = preferredSide === "long"
    ? longScenario
    : preferredSide === "short"
      ? shortScenario
      : null;
  const preferredTargetRiskRewards = preferredScenario
    ? preferredScenario.targets.map((target, targetIndex) => ({
        target,
        targetIndex,
        ratio: riskReward(
          preferredScenario.trigger,
          preferredScenario.stop,
          target,
          preferredScenario.side,
          estimatedRoundTripCostRate,
        ) || 0,
      }))
    : [];
  const preferredFinalTargetRawRatio = preferredScenario
    ? rawRiskReward(
      preferredScenario.trigger,
      preferredScenario.stop,
      preferredScenario.targets.at(-1),
      preferredScenario.side,
      estimatedRoundTripCostRate,
    )
    : null;
  const preferredThirdTargetUnavailable = Boolean(
    preferredScenario
    && (
      preferredTargetRiskRewards.length < 3
      || preferredFinalTargetRawRatio === null
      || preferredFinalTargetRawRatio + Number.EPSILON < PREFERRED_THIRD_TARGET_RATIO_MIN
      || preferredFinalTargetRawRatio - Number.EPSILON > PREFERRED_THIRD_TARGET_RATIO_MAX
    ),
  );
  const appendPreferredTargetNote = (text) => preferredThirdTargetUnavailable
    ? `${text} 最终目标未落在优先净盈亏比 1:${PREFERRED_THIRD_TARGET_RATIO_MIN}–1:${PREFERRED_THIRD_TARGET_RATIO_MAX} 区间，已保留当前策略可用比例。`
    : text;
  const minimumRiskRewardBlocked = Boolean(
    riskPolicy.minimumRiskRewardRatio !== null
    && preferredTargetRiskRewards.length > 0
    && preferredTargetRiskRewards.at(-1).ratio < riskPolicy.minimumRiskRewardRatio,
  );
  const preferredStopDistancePercent = preferredScenario
    ? Math.abs(preferredScenario.trigger.price - preferredScenario.stop.price) / preferredScenario.trigger.price * 100
    : null;
  const maxStopDistanceBlocked = Boolean(
    riskPolicy.maxStopDistancePercent !== null
    && preferredStopDistancePercent !== null
    && preferredStopDistancePercent > riskPolicy.maxStopDistancePercent + Number.EPSILON
  );
  const riskClarificationBlocked = riskPolicy.riskClarificationRequired;
  const personalRiskPreconditions = [
    condition(
      "user-max-loss-per-trade",
      `单笔计划止损后的实际亏损（含预估手续费和滑点）不得超过当前账户权益的 ${riskPolicy.maxLossPerTradePercent}%`,
      evidenceIds,
    ),
    ...(riskPolicy.maxPositionPercent === null ? [] : [condition(
      "user-max-position",
      `单次持仓名义价值不得超过账户权益的 ${riskPolicy.maxPositionPercent}%`,
      evidenceIds,
    )]),
    ...(riskPolicy.maxLeverage === null ? [] : [condition(
      "user-max-leverage",
      `实际杠杆不得超过 ${riskPolicy.maxLeverage} 倍`,
      evidenceIds,
    )]),
    ...(riskPolicy.minimumRiskRewardRatio === null ? [] : [condition(
      "user-minimum-risk-reward",
      `最终止盈目标扣除预估手续费和滑点后的净盈亏比必须不低于 1:${riskPolicy.minimumRiskRewardRatio}；前面的目标用于分批降低持仓风险`,
      evidenceIds,
    )]),
    condition(
      "minimum-first-target-risk-reward",
      `第一止盈目标扣除预估手续费和滑点后的净盈亏比必须不低于 1:${riskPolicy.minimumRiskRewardRatio}`,
      evidenceIds,
    ),
    ...(riskPolicy.riskPreference === null ? [] : [condition(
      "user-risk-preference",
      `用户定性风险偏好：${riskPolicy.riskPreference}；该偏好不得覆盖任何数值硬约束，也不得被表述为未经统计验证的胜率保证`,
      evidenceIds,
    )]),
    ...(riskPolicy.preferredStopDistancePercent === null ? [] : [condition(
      "user-preferred-stop-distance",
      `用户偏好的价格止损距离为入场价的 ${riskPolicy.preferredStopDistancePercent}%；只有策略有效失效位自然满足时才采用，不得人为缩窄止损`,
      evidenceIds,
    )]),
    ...(riskPolicy.maxStopDistancePercent === null ? [] : [condition(
      "user-maximum-stop-distance",
      `有效止损距离不得超过入场价的 ${riskPolicy.maxStopDistancePercent}%；超过时取消方案，不得通过缩窄止损放大仓位`,
      evidenceIds,
    )]),
    ...(riskPolicy.preferredTakeProfitPercent === null ? [] : [condition(
      "user-preferred-take-profit-distance",
      `策略有效目标范围内优先包含距入场价 ${riskPolicy.preferredTakeProfitPercent}% 的常规止盈目标`,
      evidenceIds,
    )]),
    ...(riskPolicy.maxTakeProfitPercent === null ? [] : [condition(
      "user-maximum-take-profit-distance",
      `任何止盈目标距入场价不得超过 ${riskPolicy.maxTakeProfitPercent}%`,
      evidenceIds,
    )]),
    ...(riskPolicy.moveStopToBreakEven ? [condition(
      "user-break-even-policy",
      `浮盈达到 ${riskPolicy.breakEvenTriggerR}R 后，把止损移动至覆盖双向手续费和预估滑点的实际保本位置`,
      evidenceIds,
    )] : []),
    ...riskPolicy.customHardConstraints.map((entry, index) => condition(
      `user-custom-risk-${index + 1}`,
      `用户硬性交易约束 ${entry.key}：${entry.value}`,
      evidenceIds,
    )),
  ];
  const waitZone = actionPlan?.waitZone;
  const entryZone = waitZone && finite(waitZone.lower) && finite(waitZone.upper)
    ? { lower: roundedPrice(Math.min(waitZone.lower, waitZone.upper), tickSize), upper: roundedPrice(Math.max(waitZone.lower, waitZone.upper), tickSize) }
    : null;
  const now = Date.now();
  const validityInterval = String(
    actionPlan.validityInterval || actionPlan.executionInterval || snapshot.interval || "",
  );
  const intervalMs = intervalMilliseconds(validityInterval);
  const requestedValidityBars = Number(actionPlan.validityBars);
  const validityBars = Number.isInteger(requestedValidityBars) && requestedValidityBars >= 1 && requestedValidityBars <= 64
    ? requestedValidityBars
    : 3;
  const observeTrigger = String(actionPlan.observeTrigger || "").trim().slice(0, 500)
    || "观察首选方向触发价是否被价格直接触达";
  const hasScenarios = scenarios.length > 0;
  const observationWait = !hasScenarios && actionPlan?.disposition === "wait";
  const coverage = theoryResult?.coverage || snapshot?.orderFlowCoverage || {};
  const preferredTriggerReached = Boolean(
    preferredScenario
    && currentPrice !== null
    && (preferredSide === "long"
      ? currentPrice >= preferredScenario.trigger.price
      : preferredSide === "short" && currentPrice <= preferredScenario.trigger.price),
  );
  const takeProfits = preferredTargetRiskRewards.length
    ? preferredTargetRiskRewards.map((item, index, targets) => ({
      price: item.target,
      allocationPercent: index === targets.length - 1
        ? 100 - Math.floor(100 / targets.length) * (targets.length - 1)
        : Math.floor(100 / targets.length),
      condition: index === 0
        ? riskPolicy.moveStopToBreakEven
          ? `到达第一目标后按计划分批退出；浮盈达到 ${riskPolicy.breakEvenTriggerR}R 后把剩余仓位止损移动至覆盖交易成本的保本位置`
          : "到达第一目标后按计划分批退出，并按用户偏好保留原止损管理方式"
        : index === 1
          ? "到达第二目标后继续分批退出；仅在结构仍有效时保留剩余仓位"
          : "最终目标保留原策略止盈位；不得把目标当作必达价格",
    }))
    : [];
  const takeProfitsWithBasis = takeProfits.map((item, index) => {
    const basis = waveBasisLabel(preferredTargetRiskRewards[index]?.target);
    return basis ? { ...item, condition: `${item.condition}；依据 ${basis}` } : item;
  });
  const market = {
    marketId: String(snapshot.marketId || params.marketId || "UNKNOWN:UNKNOWN"),
    symbol: marketSymbol(snapshot.marketId || params.marketId),
    interval: String(snapshot.interval || params.interval || "1D"),
  };
  const accountExecution = accountExecutionPlan({
    accountContext: params.binanceAccountContext,
    market,
    scenario: preferredScenario,
    takeProfits: takeProfitsWithBasis,
    riskPolicy,
    estimatedRoundTripCostRate,
    sizingBlockedReason: riskClarificationBlocked
      ? "止损百分比口径存在未澄清冲突，禁止生成账户仓位"
      : maxStopDistanceBlocked
        ? `策略有效止损距离 ${preferredStopDistancePercent.toFixed(2)}% 超过用户硬上限 ${riskPolicy.maxStopDistancePercent}%`
        : null,
    now,
  });
  const executionBlocked = minimumRiskRewardBlocked || maxStopDistanceBlocked || riskClarificationBlocked;
  // The action is the market-state signal, while executionBlocked describes
  // whether the user's hard risk policy still permits acting on that signal.
  // Keep those concepts separate: once a preferred trigger is reached the
  // card must say "做多/做空" even when the candidate is retained as a
  // non-executable risk-gated estimate. This prevents a reached short setup
  // from being misreported as if no directional condition existed.
  const reachedDirectionalAction = preferredTriggerReached
    && (preferredSide === "long" || preferredSide === "short")
    ? preferredSide
    : null;
  const source = {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    planId: "pending",
    analysisId: String(analysisPlan.analysisId || `analysis-${crypto.randomUUID()}`),
    strategy: { id: manifest.id, version: manifest.version },
    market,
    snapshot: {
      id: String(snapshot.snapshotId || `snapshot-${crypto.randomUUID()}`),
      inputHash: String(snapshot.inputHash || "unknown-input-hash"),
      lastClosedBarTime: Math.max(1, Number(params.lastClosedBarTime || snapshot.snapshotTime || now)),
    },
    createdAt: now,
    expiresAt: now + intervalMs * validityBars,
    action: reachedDirectionalAction
      || (executionBlocked
        ? "no_trade"
        : hasScenarios || observationWait
          ? "wait"
          : "insufficient_data"),
    executionBlocked,
    preferredSide,
    marketAssessment: riskClarificationBlocked
      ? `${reachedDirectionalAction ? `当前${reachedDirectionalAction === "short" ? "空头" : "多头"}条件已满足，但` : ""}已保存的旧版止损百分比缺少账户净值或入场价分母；本方案暂不可执行，必须先让用户澄清并移除旧版模糊字段。`
      : maxStopDistanceBlocked
        ? `${reachedDirectionalAction ? `当前${reachedDirectionalAction === "short" ? "空头" : "多头"}条件已满足，但` : ""}策略有效止损距离约 ${preferredStopDistancePercent.toFixed(2)}%，超过用户设定的价格止损距离硬上限 ${riskPolicy.maxStopDistancePercent}%；本方案暂不可执行，且不生成账户仓位。`
        : minimumRiskRewardBlocked
          ? `${reachedDirectionalAction ? `当前${reachedDirectionalAction === "short" ? "空头" : "多头"}条件已满足，但` : ""}当前候选场景最终止盈目标扣除预估手续费和滑点后的净盈亏比低于用户设定的最低 1:${riskPolicy.minimumRiskRewardRatio}；本方案暂不可执行，但保留完整候选测算供用户决策。`
      : hasScenarios
      ? preferredSide === "long"
        ? preferredTriggerReached
          ? appendPreferredTargetNote("当前结构偏多，现价已满足多头条件，可按计划直接执行。")
          : appendPreferredTargetNote("当前结构偏多，价格触达多头触发价即按计划执行。")
        : preferredSide === "short"
          ? preferredTriggerReached
            ? appendPreferredTargetNote("当前结构偏空，现价已满足空头条件，可按计划直接执行。")
            : appendPreferredTargetNote("当前结构偏空，价格触达空头触发价即按计划执行。")
          : appendPreferredTargetNote("当前方向未形成单边优势，暂不强行选择方向。")
      : observationWait
        ? "当前存在需要继续观察的结构，但尚未形成完整入场、失效和目标价位；保持等待，不交易。"
        : "当前结果缺少完整入场、失效或目标价位，暂不形成交易执行方案。",
    preconditions: [
      condition(
        "closed-candle-levels",
        actionPlan.executionInterval
          ? `触发、结构支撑/阻力区止损和近端目标来自 ${displayExecutionPlanInterval(actionPlan.executionInterval)} 已收盘 K 线结构；缓冲后的触发价被价格触达时才操作`
          : "触发、止损和目标只从当前周期已收盘 K 线结构产生；执行时价格触达即操作",
        evidenceIds,
      ),
      condition("data-coverage", "策略所需行情和数据覆盖必须保持可用，数据降级时取消执行", evidenceIds),
      ...personalRiskPreconditions,
    ],
    entry: {
      mode: hasScenarios ? "conditional" : "none",
      zone: entryZone,
      trigger: scenarios.map((item) => item.conditions[0]),
      confirmation: [condition(
        "confirmation",
        String(actionPlan.triggerConfirmation || "价格触达首选方向触发价即执行").slice(0, 500),
        evidenceIds,
      )],
    },
    invalidation: {
      stop: preferredScenario?.stop || null,
      reasons: preferredScenario
        ? [actionPlan.macroInvalidation
          ? `价格触及低周期结构支撑/阻力区外侧止损位时退出当前执行；主周期宏观失效位 ${actionPlan.macroInvalidation} 用于取消全部同向子浪方案`
          : "价格触及策略确定性失效位，主场景不再成立"]
        : ["方向触发前不持仓；任一假突破重新回到等待区都取消当次信号"],
    },
    takeProfits: takeProfitsWithBasis,
    positionSizing: {
      maxAccountRiskPercent: riskPolicy.maxLossPerTradePercent,
      maxPositionPercent: riskPolicy.maxPositionPercent,
      maxLeverage: riskPolicy.maxLeverage,
      minimumRiskRewardRatio: riskPolicy.minimumRiskRewardRatio,
      estimatedRoundTripCostRate,
      formula: `建议数量上限 = 账户权益 × ${riskPolicy.maxLossPerTradePercent}% ÷（|计划入场价 - 止损价| + 单位仓位预估手续费与滑点）${riskPolicy.maxPositionPercent === null ? "" : `；且持仓名义价值不得超过账户权益 × ${riskPolicy.maxPositionPercent}%`}${riskPolicy.maxLeverage === null ? "" : `；实际杠杆不得超过 ${riskPolicy.maxLeverage} 倍`}；最后按合约乘数和最小数量向下归一化`,
      suggestedQuantity: null,
      unavailableReason: accountExecution.accountPlan
        ? null
        : accountExecution.sizingBlockedReason
          ? accountExecution.sizingBlockedReason
        : accountExecution.accountStatus === "unbound"
          ? "Binance API 未绑定，未获得账户权益，因此不生成具体账户仓位"
          : accountExecution.accountStatus === "unavailable"
            ? "未获得可用于仓位计算的新鲜 Binance 只读账户快照，因此不生成具体账户仓位"
            : "当前场景或账户状态不支持新增具体仓位",
      accountStatus: accountExecution.accountStatus,
      accountPlan: accountExecution.accountPlan,
    },
    riskReward: preferredTargetRiskRewards.map(({ targetIndex, ratio }) => ({ targetIndex, ratio })),
    observe: [
      condition(
        "observe-trigger",
        observeTrigger,
        evidenceIds,
      ),
      condition("observe-structure", "观察主结构是否保持确认状态，暂定结构失效时重新分析", evidenceIds),
    ],
    cancelConditions: [
      condition("false-breakout", "触发后很快重新收回等待区，按假突破取消执行", evidenceIds),
      condition("expired", "超过方案有效期仍未触发，必须使用最新行情重新分析", evidenceIds),
      condition("coverage-loss", "策略所需数据变为 partial/unavailable 且不满足最低覆盖要求", evidenceIds),
      ...(riskPolicy.minimumRiskRewardRatio === null ? [] : [condition(
        "minimum-risk-reward-lost",
        `若执行前重新计算的最终止盈目标净盈亏比低于 1:${riskPolicy.minimumRiskRewardRatio}，取消执行`,
        evidenceIds,
      )]),
      condition(
        "minimum-first-target-risk-reward-lost",
        `若执行前重新计算的第一止盈目标净盈亏比低于 1:${riskPolicy.minimumRiskRewardRatio}，取消执行`,
        evidenceIds,
      ),
      ...(riskClarificationBlocked ? [condition(
        "ambiguous-stop-loss-memory",
        "止损百分比的分母尚未澄清；确认并更新长期记忆前不得执行",
        evidenceIds,
      )] : []),
      ...(maxStopDistanceBlocked ? [condition(
        "maximum-stop-distance-exceeded",
        `策略有效止损距离超过用户硬上限 ${riskPolicy.maxStopDistancePercent}%，取消执行`,
        evidenceIds,
      )] : []),
    ],
    scenarios,
    evidence,
    coverage,
    warnings: [
      "本方案是条件式分析计划，不是自动订单或收益承诺。",
      `所有策略的多空触发价距当前价限制在 ±${MAX_TRIGGER_DISTANCE_PERCENT}% 以内；超过范围的结构触发位按边界价生成执行条件，原结构证据仍保留在分析报告中。`,
      tickSize
        ? `所有执行价已按宿主提供的 tick size ${tickSize} 归一化；执行前仍须核对交易所最新合约规格。`
        : "未提供交易所 tick size 时价格只做有限小数归一化，下单前必须按真实合约规格复核。",
      "永续合约存在杠杆、滑点、资金费率和强平风险。",
      `用户单笔风险按当前账户权益的 ${riskPolicy.maxLossPerTradePercent}% 约束；不得在未获得用户明确授权时为了回本主动提高这一比例。`,
      ...(riskPolicy.maxTakeProfitPercent === null ? [] : [`所有止盈目标已限制在距入场价 ${riskPolicy.maxTakeProfitPercent}% 以内。`]),
      ...(preferredScenario?.targets.some((target) => /结构风险倍数兜底目标/.test(String(target.label || "")))
        ? ["原策略近端目标不足最低净盈亏比，已生成结构风险倍数兜底目标；执行前仍须复核该目标与当前结构是否有效。"]
        : []),
      ...(preferredThirdTargetUnavailable
        ? [`当前策略最终止盈目标未落在优先净盈亏比 1:${PREFERRED_THIRD_TARGET_RATIO_MIN}–1:${PREFERRED_THIRD_TARGET_RATIO_MAX} 区间；为保持可执行性，已保留当前策略可用比例。`]
        : []),
      ...(riskClarificationBlocked ? ["长期记忆中的止损百分比口径冲突尚未解决，本方案禁止执行且不提供账户仓位。"] : []),
    ],
  };
  source.planId = `plan-${planHash({ ...source, planId: undefined, createdAt: undefined })}`;
  return validateExecutionPlan(source);
}

function displayPrice(level) {
  return level ? String(level.price) : "未形成";
}

function waveBasisLabel(value) {
  const source = String(value?.label || value || "");
  const match = source.match(/(Fib\s+[^）;；]+|候选结构投影|结构风险倍数兜底目标\s*R[\d.]+)/);
  return match ? match[1].trim() : "";
}

function waveBasisLabelEnglish(value) {
  const source = String(value?.label || value || "");
  const fib = source.match(/Fib\s+[^）;；]+/);
  if (fib) return fib[0].trim();
  if (source.includes("候选结构投影")) return "candidate structure projection";
  const riskMultiple = source.match(/结构风险倍数兜底目标\s*R([\d.]+)/);
  return riskMultiple ? `structural risk-multiple fallback target R${riskMultiple[1]}` : "";
}

function displayTargets(scenario) {
  if (!scenario?.targets?.length) return "未形成";
  return scenario.targets.map((target, index) => {
    const basis = waveBasisLabel(target);
    return `第${index + 1}目标 ${displayPrice(target)}${basis ? `（依据 ${basis}）` : ""}`;
  }).join("，");
}

function scenarioRiskRewardText(scenario, costRate) {
  if (!scenario?.targets?.length) return "未形成";
  const ratios = scenario.targets.map((target, targetIndex) => ({
    targetIndex,
    ratio: riskReward(scenario.trigger, scenario.stop, target, scenario.side, costRate) || 0,
  }));
  return ratios.length
    ? ratios.map((item) => `目标${item.targetIndex + 1}为 1:${item.ratio}`).join("，")
    : "未形成";
}

function displayMoney(value) {
  const normalized = nonNegative(value);
  if (normalized === null) return "0";
  return normalized.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function displayQuantity(value) {
  const normalized = nonNegative(value);
  if (normalized === null) return "未形成";
  return normalized.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function displaySignedMoney(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return "暂无";
  return `${normalized >= 0 ? "+" : "-"}${displayMoney(Math.abs(normalized))} USDT`;
}

function executionPlanBaseAsset(plan) {
  const symbol = String(plan?.market?.symbol || "").trim().toUpperCase();
  return symbol.match(/^(.+?)(?:USDT|USDC|BUSD)$/)?.[1] || symbol || "标的";
}

function displayExecutionPlanInterval(value) {
  const calendar = /^(\d+)(M|[yY])$/.exec(String(value || "").trim());
  // Existing plan titles use M for minutes. Give calendar months a distinct
  // display token so a saved plan cannot turn a monthly alert into minutes.
  if (calendar) return `${calendar[1]}${calendar[2] === "M" ? "MO" : "Y"}`;
  const source = String(value || "").trim().toUpperCase();
  if (/^\d+[MHDW]$/.test(source)) return source;
  const minutes = Number(source);
  if (!Number.isFinite(minutes) || minutes <= 0) return source || "1H";
  if (minutes % 10_080 === 0) return `${minutes / 10_080}W`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
}

function executionPlanDisplayTitle(plan) {
  const symbol = String(plan?.market?.symbol || "").trim().toUpperCase();
  const match = symbol.match(/^(.+?)(USDT|USDC|BUSD)$/);
  const pair = match ? `${match[1]}/${match[2]}` : symbol || "交易对";
  return `${pair} 币安永续 ${displayExecutionPlanInterval(plan?.market?.interval)}`;
}

function formatExecutionPlanMarkdownEnglish(validated) {
  const price = (level) => level ? String(level.price) : "Not available";
  const quantity = (value) => {
    const normalized = nonNegative(value);
    if (normalized === null) return "Not available";
    return normalized.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") || "0";
  };
  const signedMoney = (value) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return "Not available";
    return `${normalized >= 0 ? "+" : "-"}${displayMoney(Math.abs(normalized))} USDT`;
  };
  const symbol = String(validated?.market?.symbol || "").trim().toUpperCase();
  const match = symbol.match(/^(.+?)(USDT|USDC|BUSD)$/);
  const pair = match ? `${match[1]}/${match[2]}` : symbol || "Trading pair";
  const title = `${pair} Binance Perpetual ${displayExecutionPlanInterval(validated?.market?.interval)}`;
  const baseAsset = match?.[1] || symbol || "Asset";
  const targetText = (scenario) => scenario?.targets?.length
    ? scenario.targets.map((target, index) => {
      const basis = waveBasisLabelEnglish(target);
      return `Target ${index + 1}: ${price(target)}${basis ? ` (basis ${basis})` : ""}`;
    }).join("; ")
    : "Not available";
  const scenarioRiskReward = (scenario) => {
    if (!scenario?.targets?.length) return "Not available";
    const ratios = scenario.targets.map((target, targetIndex) => ({
      targetIndex,
      ratio: riskReward(
        scenario.trigger,
        scenario.stop,
        target,
        scenario.side,
        validated.positionSizing?.estimatedRoundTripCostRate,
      ) || 0,
    }));
    return ratios.map((item) => `Target ${item.targetIndex + 1}: 1:${item.ratio}`).join("; ");
  };
  const bilateralScenarios = validated.preferredSide === "neutral"
    ? validated.scenarios.filter((item) => item.side === "long" || item.side === "short")
    : [];
  const formatOne = (selectedScenario, bilateral = false) => {
    const selectedSide = selectedScenario?.side || validated.preferredSide;
    const accountPlan = bilateral ? null : validated.positionSizing.accountPlan;
    const candidateOnly = validated.action === "no_trade" || validated.executionBlocked === true;
    const directionText = selectedSide === "long" ? "Bullish" : selectedSide === "short" ? "Bearish" : "Neutral";
    const directionOrder = selectedSide === "long" ? "long position" : "short position";
    let actionText = validated.action === "wait"
      ? "Wait for the trigger"
      : validated.action === "insufficient_data"
        ? "Insufficient data or price levels; do not trade"
        : validated.action === "long"
          ? "Open a long position at market"
          : validated.action === "short"
            ? "Open a short position at market"
            : candidateOnly
              ? "Do not trade"
              : "No directional action";
    let triggerText = selectedScenario ? price(selectedScenario.trigger) : "No clear one-sided setup";
    if (accountPlan?.mode === "new_position") {
      triggerText += candidateOnly
        ? `; non-executable candidate estimate: ${accountPlan.leverage}x leverage and ${displayMoney(accountPlan.notional)} USDT ${directionOrder}`
        : `; open a ${displayMoney(accountPlan.notional)} USDT ${directionOrder} with ${accountPlan.leverage}x leverage`;
    } else if (accountPlan?.mode === "manage_existing") {
      triggerText += `; manage the existing ${displayMoney(accountPlan.existingNotional)} USDT ${directionOrder} without adding`;
    } else if (accountPlan?.mode === "reduce_existing") {
      actionText = "Reduce the position first, then manage it under this plan";
      triggerText += `; reduce the existing ${displayMoney(accountPlan.existingNotional)} USDT ${directionOrder} to ${displayMoney(accountPlan.notional)} USDT`;
    } else if (accountPlan?.mode === "close_opposite") {
      const oppositeOrder = accountPlan.existingSide === "long" ? "long position" : "short position";
      actionText = "Close the opposite position first; do not open a new position yet";
      triggerText += `; close the existing ${displayMoney(accountPlan.existingNotional)} USDT ${oppositeOrder}`;
    }
    const riskRewardText = bilateral
      ? scenarioRiskReward(selectedScenario)
      : validated.riskReward.length
        ? validated.riskReward.map((item) => `Target ${item.targetIndex + 1}: 1:${item.ratio}`).join("; ")
        : "Not available";
    const accountOrdersAvailable = accountPlan && accountPlan.mode !== "close_opposite";
    const stopText = accountOrdersAvailable
      ? candidateOnly
        ? `Stop loss: ${price(selectedScenario?.stop)}`
        : `Conditional market stop at ${price(selectedScenario?.stop)}`
      : price(selectedScenario?.stop);
    const takeProfitText = accountOrdersAvailable
      ? accountPlan.targetOrders
        .filter((target) => target.notional > 0)
        .map((target) => {
          const basis = waveBasisLabelEnglish(validated.takeProfits?.[target.targetIndex]?.condition);
          const basisText = basis ? ` (basis ${basis})` : "";
          return candidateOnly
            ? `Take profit at ${target.price}${basisText}; non-executable candidate allocation ${displayMoney(target.notional)} USDT; estimated profit +${displayMoney(target.estimatedNetProfit)} USDT`
            : `Conditional market take profit at ${target.price}${basisText} for ${displayMoney(target.notional)} USDT; estimated profit +${displayMoney(target.estimatedNetProfit)} USDT`;
        })
        .join("; ") || "Not available"
      : targetText(selectedScenario);
    const outcomeText = accountOrdersAvailable
      ? `${riskRewardText}; estimated stop-loss outcome: -${displayMoney(accountPlan.estimatedStopLoss)} USDT; estimated all-target outcome: +${displayMoney(accountPlan.estimatedTakeProfit)} USDT`
      : riskRewardText;
    const accountBasisText = accountPlan
      ? `account equity ${displayMoney(accountPlan.equity)} USDT; available balance ${displayMoney(accountPlan.availableBalance)} USDT`
      : "";
    const accountSizingText = accountOrdersAvailable
      ? accountPlan.mode === "manage_existing"
        ? `Position size: current position approximately ${quantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset}; notional ${displayMoney(accountPlan.existingNotional)} USDT; do not add; ${accountBasisText}`
        : accountPlan.mode === "reduce_existing"
          ? `Position size: approximately ${quantity(accountPlan.quantity)} ${baseAsset} after reduction; notional ${displayMoney(accountPlan.notional)} USDT; ${accountBasisText}`
          : candidateOnly
            ? `Position size: candidate estimate ${quantity(accountPlan.quantity)} ${baseAsset} (do not place an order); notional ${displayMoney(accountPlan.notional)} USDT; ${accountPlan.leverage}x leverage; ${accountBasisText}`
            : `Position size: suggested order ${quantity(accountPlan.quantity)} ${baseAsset}; notional ${displayMoney(accountPlan.notional)} USDT; ${accountPlan.leverage}x leverage; ${accountBasisText}`
      : accountPlan?.mode === "close_opposite"
        ? `Position size: close the existing approximately ${quantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset} ${accountPlan.existingSide === "long" ? "long position" : "short position"}; no new order is suggested yet; ${accountBasisText}`
        : "";
    const accountPnlText = accountOrdersAvailable
      ? `Potential P&L: approximately -${displayMoney(accountPlan.estimatedStopLoss)} USDT at the stop and +${displayMoney(accountPlan.estimatedTakeProfit)} USDT if all targets fill; estimated fees and slippage are included`
      : "";
    const accountUnavailableText = !accountPlan && validated.positionSizing.accountStatus === "unavailable"
      ? "Position size: the live account snapshot is unavailable or stale. Refresh the account and run the analysis again"
      : !accountPlan && validated.positionSizing.accountStatus === "available" && validated.positionSizing.unavailableReason
        ? /口径|澄清/.test(validated.positionSizing.unavailableReason)
          ? "Position size: the stop-loss percentage denominator is unresolved; no account size may be generated"
          : "Position size: the valid structural stop exceeds the user's hard stop-distance cap; no account size may be generated"
        : "";
    const livePositionText = accountPlan?.existingSide
      ? `Live position: approximately ${quantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset} ${accountPlan.existingSide === "long" ? "long" : "short"}; average entry ${accountPlan.existingEntryPrice == null ? "Not available" : accountPlan.existingEntryPrice}; unrealized P&L ${signedMoney(accountPlan.existingUnrealizedPnl)}`
      : "";
    const triggerLabel = selectedSide === "long"
      ? "Long trigger"
      : selectedSide === "short"
        ? "Short trigger"
        : "Entry trigger";
    const titleSuffix = bilateral && selectedSide === "long"
      ? " · Long setup"
      : bilateral && selectedSide === "short"
        ? " · Short setup"
        : "";
    return [
      `## ${title}${titleSuffix}`,
      "",
      `Current action: ${actionText}`,
      `Direction: ${directionText}`,
      `${triggerLabel}: ${triggerText}`,
      `Stop-loss and invalidation: ${stopText}`,
      `Take-profit targets: ${takeProfitText}`,
      ...(accountSizingText ? [accountSizingText] : []),
      ...(livePositionText ? [livePositionText] : []),
      ...(accountPnlText ? [accountPnlText] : []),
      ...(accountUnavailableText ? [accountUnavailableText] : []),
      `Risk/reward: ${outcomeText}`,
    ].join("\n");
  };
  if (bilateralScenarios.length >= 2) {
    return bilateralScenarios
      .sort((left, right) => (left.side === "long" ? -1 : right.side === "long" ? 1 : 0))
      .map((scenarioItem) => formatOne(scenarioItem, true))
      .join("\n\n");
  }
  const selectedScenario = validated.preferredSide === "long" || validated.preferredSide === "short"
    ? validated.scenarios.find((item) => item.side === validated.preferredSide)
    : null;
  return formatOne(selectedScenario);
}

export function formatExecutionPlanMarkdown(plan, options = {}) {
  const validated = validateExecutionPlan(plan);
  if (options?.language === "en") return formatExecutionPlanMarkdownEnglish(validated);
  const bilateralScenarios = validated.preferredSide === "neutral"
    ? validated.scenarios.filter((item) => item.side === "long" || item.side === "short")
    : [];
  const formatOne = (selectedScenario, bilateral = false) => {
    const selectedSide = selectedScenario?.side || validated.preferredSide;
    const accountPlan = bilateral ? null : validated.positionSizing.accountPlan;
    const candidateOnly = validated.action === "no_trade" || validated.executionBlocked === true;
    const directionText = selectedSide === "long" ? "偏多" : selectedSide === "short" ? "偏空" : "中性";
    const directionOrder = selectedSide === "long" ? "多单" : "空单";
    let actionText = validated.action === "wait"
      ? "等待条件触发"
      : validated.action === "insufficient_data"
        ? "数据/价位不足，不交易"
        : validated.action === "long"
          ? "现价做多"
          : validated.action === "short"
            ? "现价做空"
            : candidateOnly
              ? "不交易"
              : "暂无方向动作";
    let triggerText = displayPrice(selectedScenario?.trigger);
    if (!selectedScenario) triggerText = "未形成明确单侧方案";
    if (accountPlan?.mode === "new_position") {
      triggerText += candidateOnly
        ? `，候选测算（不可执行）：${accountPlan.leverage} 倍杠杆、${displayMoney(accountPlan.notional)} USDT 的${directionOrder}`
        : `，用 ${accountPlan.leverage} 倍杠杆开仓 ${displayMoney(accountPlan.notional)} USDT 的${directionOrder}`;
    } else if (accountPlan?.mode === "manage_existing") {
      triggerText += `，已有 ${displayMoney(accountPlan.existingNotional)} USDT 的${directionOrder}，按现有仓位执行，不重复开仓`;
    } else if (accountPlan?.mode === "reduce_existing") {
      actionText = "先减仓，再按计划管理";
      triggerText += `，已有 ${displayMoney(accountPlan.existingNotional)} USDT 的${directionOrder}，先减至 ${displayMoney(accountPlan.notional)} USDT`;
    } else if (accountPlan?.mode === "close_opposite") {
      const oppositeOrder = accountPlan.existingSide === "long" ? "多单" : "空单";
      actionText = "先平反向仓位，暂不开新仓";
      triggerText += `，先平现有 ${displayMoney(accountPlan.existingNotional)} USDT 的${oppositeOrder}`;
    }
    const riskRewardText = bilateral
      ? scenarioRiskRewardText(selectedScenario, validated.positionSizing?.estimatedRoundTripCostRate)
      : validated.riskReward.length
        ? validated.riskReward.map((item) => `目标${item.targetIndex + 1}为 1:${item.ratio}`).join("，")
        : "未形成";
    const accountOrdersAvailable = accountPlan && accountPlan.mode !== "close_opposite";
    const stopText = accountOrdersAvailable
      ? candidateOnly
        ? `止损 ${displayPrice(selectedScenario?.stop)}`
        : `挂条件委托 ${displayPrice(selectedScenario?.stop)} 市价止损`
      : displayPrice(selectedScenario?.stop);
    const takeProfitText = accountOrdersAvailable
      ? accountPlan.targetOrders
        .filter((target) => target.notional > 0)
        .map((target) => {
          const basis = waveBasisLabel(validated.takeProfits?.[target.targetIndex]?.condition);
          const basisText = basis ? `（依据 ${basis}）` : "";
          return candidateOnly
            ? `止盈 ${target.price}${basisText}，候选分批测算（不可执行）${displayMoney(target.notional)} USDT；预计盈利 +${displayMoney(target.estimatedNetProfit)} USDT`
            : `挂条件委托 ${target.price}${basisText} 市价止盈 ${displayMoney(target.notional)} USDT；预计盈利 +${displayMoney(target.estimatedNetProfit)} USDT`;
        })
        .join("，") || "未形成"
      : displayTargets(selectedScenario);
    const outcomeText = accountOrdersAvailable
      ? `${riskRewardText}，如果止损：约 -${displayMoney(accountPlan.estimatedStopLoss)} USDT，如果全部止盈：约 +${displayMoney(accountPlan.estimatedTakeProfit)} USDT`
      : riskRewardText;
    const baseAsset = executionPlanBaseAsset(validated);
    const accountBasisText = accountPlan
      ? `账户权益 ${displayMoney(accountPlan.equity)} USDT；可用余额 ${displayMoney(accountPlan.availableBalance)} USDT`
      : "";
    const accountSizingText = accountOrdersAvailable
      ? accountPlan.mode === "manage_existing"
        ? `仓位大小：当前持仓约 ${displayQuantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset}；名义金额 ${displayMoney(accountPlan.existingNotional)} USDT；不重复开仓；${accountBasisText}`
        : accountPlan.mode === "reduce_existing"
          ? `仓位大小：调整后约 ${displayQuantity(accountPlan.quantity)} ${baseAsset}；名义金额 ${displayMoney(accountPlan.notional)} USDT；${accountBasisText}`
          : candidateOnly
            ? `仓位大小：候选测算 ${displayQuantity(accountPlan.quantity)} ${baseAsset}（不可下单）；名义金额 ${displayMoney(accountPlan.notional)} USDT；${accountPlan.leverage} 倍杠杆；${accountBasisText}`
            : `仓位大小：推荐下单 ${displayQuantity(accountPlan.quantity)} ${baseAsset}；名义金额 ${displayMoney(accountPlan.notional)} USDT；${accountPlan.leverage} 倍杠杆；${accountBasisText}`
      : accountPlan?.mode === "close_opposite"
        ? `仓位大小：当前已有约 ${displayQuantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset} 的${accountPlan.existingSide === "long" ? "多单" : "空单"}，先平仓，暂不推荐新下单；${accountBasisText}`
        : "";
    const accountPnlText = accountOrdersAvailable
      ? `可能盈亏：止损约 -${displayMoney(accountPlan.estimatedStopLoss)} USDT；全部止盈约 +${displayMoney(accountPlan.estimatedTakeProfit)} USDT；已计入预估手续费和滑点`
      : "";
    const accountUnavailableText = !accountPlan && validated.positionSizing.accountStatus === "unavailable"
      ? "仓位大小：实盘账户快照不可用或已过期，暂不生成推荐下单数量及盈亏金额；请刷新账户后重新分析"
      : !accountPlan && validated.positionSizing.accountStatus === "available" && validated.positionSizing.unavailableReason
        ? `仓位大小：${validated.positionSizing.unavailableReason}`
        : "";
    const livePositionText = accountPlan?.existingSide
      ? `实盘仓位：已有 ${displayQuantity(accountPlan.existingQuantity ?? accountPlan.quantity)} ${baseAsset} 的${accountPlan.existingSide === "long" ? "多单" : "空单"}；开仓均价 ${accountPlan.existingEntryPrice == null ? "暂无" : accountPlan.existingEntryPrice}；未实现盈亏 ${displaySignedMoney(accountPlan.existingUnrealizedPnl)}`
      : "";
    const triggerLabel = selectedSide === "long"
      ? "多头触发"
      : selectedSide === "short"
        ? "空头触发"
        : "方向触发";
    const titleSuffix = bilateral && selectedSide === "long"
      ? " · 多头条件方案"
      : bilateral && selectedSide === "short"
        ? " · 空头条件方案"
        : "";
    return [
      `## ${executionPlanDisplayTitle(validated)}${titleSuffix}`,
      "",
      `当前动作：${actionText}`,
      `方向判断：${directionText}`,
      `${triggerLabel}：${triggerText}`,
      `止损与失效：${stopText}`,
      `分批止盈：${takeProfitText}`,
      ...(accountSizingText ? [accountSizingText] : []),
      ...(livePositionText ? [livePositionText] : []),
      ...(accountPnlText ? [accountPnlText] : []),
      ...(accountUnavailableText ? [accountUnavailableText] : []),
      `风险收益比：${outcomeText}`,
    ].join("\n");
  };
  if (bilateralScenarios.length >= 2) {
    return bilateralScenarios
      .sort((left, right) => (left.side === "long" ? -1 : right.side === "long" ? 1 : 0))
      .map((scenarioItem) => formatOne(scenarioItem, true))
      .join("\n\n");
  }
  const selectedScenario = validated.preferredSide === "long" || validated.preferredSide === "short"
    ? validated.scenarios.find((item) => item.side === validated.preferredSide)
    : null;
  return formatOne(selectedScenario);
}
