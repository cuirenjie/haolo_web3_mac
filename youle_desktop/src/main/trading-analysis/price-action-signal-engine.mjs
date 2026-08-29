import {
  priceActionBuffer,
  priceActionClamp,
  priceActionId,
  priceActionMedian,
  priceActionRound,
} from "./price-action-structure-engine.mjs";

function candleMetrics(candles, index, rangeUnit) {
  const candle = candles[index];
  const previous = index > 0 ? candles[index - 1] : null;
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bullish = candle.close > candle.open;
  const bearish = candle.close < candle.open;
  const bodyRatio = body / range;
  const closeLocation = (candle.close - candle.low) / range;
  const priorRanges = candles.slice(Math.max(0, index - 20), index).map((item) => item.high - item.low);
  const localRange = Math.max(priceActionMedian(priorRanges), rangeUnit, Number.EPSILON);
  const facts = [];
  if (bodyRatio <= 0.15) facts.push("doji");
  if (lowerWick >= Math.max(body * 2, range * 0.5) && closeLocation >= 0.62) facts.push("bullish-rejection");
  if (upperWick >= Math.max(body * 2, range * 0.5) && closeLocation <= 0.38) facts.push("bearish-rejection");
  if (bullish && bodyRatio >= 0.62 && closeLocation >= 0.78 && range >= localRange * 0.9) facts.push("strong-bull");
  if (bearish && bodyRatio >= 0.62 && closeLocation <= 0.22 && range >= localRange * 0.9) facts.push("strong-bear");
  if (previous) {
    const previousBullish = previous.close > previous.open;
    const previousBearish = previous.close < previous.open;
    const bodyHigh = Math.max(candle.open, candle.close);
    const bodyLow = Math.min(candle.open, candle.close);
    const previousBodyHigh = Math.max(previous.open, previous.close);
    const previousBodyLow = Math.min(previous.open, previous.close);
    if (bullish && previousBearish && bodyLow <= previousBodyLow && bodyHigh >= previousBodyHigh && bodyRatio >= 0.48) facts.push("bullish-engulfing");
    if (bearish && previousBullish && bodyLow <= previousBodyLow && bodyHigh >= previousBodyHigh && bodyRatio >= 0.48) facts.push("bearish-engulfing");
    if (candle.high <= previous.high && candle.low >= previous.low) facts.push("inside-bar");
    if (candle.high >= previous.high && candle.low <= previous.low) {
      if (bullish && closeLocation >= 0.65) facts.push("bullish-outside");
      else if (bearish && closeLocation <= 0.35) facts.push("bearish-outside");
      else facts.push("outside-bar");
    }
  }
  return Object.freeze({
    id: priceActionId("pa-candle", candle.time, index),
    index,
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    range: priceActionRound(range),
    body: priceActionRound(body),
    upperWick: priceActionRound(upperWick),
    lowerWick: priceActionRound(lowerWick),
    bodyRatio: priceActionRound(bodyRatio),
    closeLocation: priceActionRound(closeLocation),
    direction: bullish ? "bullish" : bearish ? "bearish" : "neutral",
    facts: Object.freeze(facts),
  });
}

function directionalFact(signal, direction) {
  const allowed = direction === "bullish"
    ? ["bullish-rejection", "bullish-engulfing", "bullish-outside", "strong-bull"]
    : ["bearish-rejection", "bearish-engulfing", "bearish-outside", "strong-bear"];
  return allowed.find((fact) => signal.facts.includes(fact)) || null;
}

function nearestTarget(zones, direction, entry, minimumDistance, fallbackDistance) {
  const prices = zones.flatMap((zone) => [zone.lower, zone.upper, zone.center]);
  const candidate = direction === "bullish"
    ? prices.filter((price) => price >= entry + minimumDistance).sort((a, b) => a - b)[0]
    : prices.filter((price) => price <= entry - minimumDistance).sort((a, b) => b - a)[0];
  return candidate ?? (direction === "bullish" ? entry + fallbackDistance : entry - fallbackDistance);
}

function levelsFor(snapshot, structure, direction, signal, zone, { trigger = null, stop = null } = {}) {
  const buffer = priceActionBuffer(snapshot.candles, structure.rangeUnit, 0.1);
  const bullish = direction === "bullish";
  const resolvedTrigger = priceActionRound(trigger ?? (bullish ? signal.high + buffer : signal.low - buffer));
  const structuralStop = bullish
    ? Math.min(signal.low, zone?.lower ?? signal.low) - buffer
    : Math.max(signal.high, zone?.upper ?? signal.high) + buffer;
  const resolvedStop = priceActionRound(stop ?? structuralStop);
  const risk = Math.max(Math.abs(resolvedTrigger - resolvedStop), structure.rangeUnit * 0.65);
  const structuralTarget = nearestTarget(structure.zones, direction, resolvedTrigger, risk * 0.75, risk * 2);
  const signed = bullish ? 1 : -1;
  const target1 = bullish
    ? Math.max(resolvedTrigger + risk, Math.min(structuralTarget, resolvedTrigger + risk * 1.5))
    : Math.min(resolvedTrigger - risk, Math.max(structuralTarget, resolvedTrigger - risk * 1.5));
  const target2 = bullish
    ? Math.max(structuralTarget, resolvedTrigger + risk * 2)
    : Math.min(structuralTarget, resolvedTrigger - risk * 2);
  return Object.freeze({
    trigger: resolvedTrigger,
    stop: resolvedStop,
    targets: Object.freeze([priceActionRound(Math.max(Number.EPSILON, target1)), priceActionRound(Math.max(Number.EPSILON, target2))]),
  });
}

function resolveLifecycle(snapshot, candidate) {
  const latestIndex = snapshot.candles.length - 1;
  if (candidate.direction === "neutral") {
    const ageBars = latestIndex - candidate.signalIndex;
    return Object.freeze({
      lifecycle: ageBars <= 3 ? "developing" : "expired",
      tradeState: ageBars <= 3 ? "awaiting-breakout" : "expired",
      ageBars,
      terminalReason: ageBars <= 3 ? null : "compression-stale",
    });
  }
  const bullish = candidate.direction === "bullish";
  const levels = candidate.actionLevels;
  const after = snapshot.candles.slice(candidate.signalIndex + 1);
  const triggerOffset = after.findIndex((candle) => bullish ? candle.close > levels.trigger : candle.close < levels.trigger);
  const signalAge = latestIndex - candidate.signalIndex;
  if (triggerOffset < 0) {
    const invalidated = after.some((candle) => bullish ? candle.close <= levels.stop : candle.close >= levels.stop);
    return Object.freeze({
      lifecycle: invalidated ? "invalidated" : signalAge <= 4 ? "developing" : "expired",
      tradeState: invalidated ? "invalidated" : signalAge <= 4 ? "awaiting-confirmation" : "expired",
      ageBars: signalAge,
      terminalReason: invalidated ? "signal-invalidated-before-trigger" : signalAge <= 4 ? null : "signal-stale-before-trigger",
    });
  }
  const triggerIndex = candidate.signalIndex + 1 + triggerOffset;
  const follow = snapshot.candles.slice(triggerIndex + 1);
  const stopOffset = follow.findIndex((candle) => bullish ? candle.close <= levels.stop : candle.close >= levels.stop);
  const target1Offset = follow.findIndex((candle) => bullish ? candle.high >= levels.targets[0] : candle.low <= levels.targets[0]);
  const target2Offset = follow.findIndex((candle) => bullish ? candle.high >= levels.targets[1] : candle.low <= levels.targets[1]);
  const target2First = target2Offset >= 0 && (stopOffset < 0 || target2Offset < stopOffset);
  const target1First = target1Offset >= 0 && (stopOffset < 0 || target1Offset < stopOffset);
  if (target2First) return Object.freeze({ lifecycle: "completed", tradeState: "completed", ageBars: latestIndex - triggerIndex, triggerIndex, terminalReason: "second-target-reached" });
  if (stopOffset >= 0) return Object.freeze({ lifecycle: "invalidated", tradeState: "invalidated", ageBars: latestIndex - triggerIndex, triggerIndex, terminalReason: "structural-stop-crossed" });
  if (target1First) return Object.freeze({ lifecycle: "partial-target-reached", tradeState: "partial-target-reached", ageBars: latestIndex - triggerIndex, triggerIndex, terminalReason: "first-target-reached" });
  const ageBars = latestIndex - triggerIndex;
  return Object.freeze({
    lifecycle: ageBars <= 4 ? "confirmed" : "expired",
    tradeState: ageBars <= 4 ? "active" : "expired",
    ageBars,
    triggerIndex,
    terminalReason: ageBars <= 4 ? null : "trigger-stale",
  });
}

function makeCandidate(snapshot, structure, source) {
  const actionLevels = source.direction === "neutral" ? null : levelsFor(snapshot, structure, source.direction, source.signal, source.zone, source.levelOverrides);
  const base = {
    id: priceActionId("pa-setup", snapshot.snapshotId, source.setupId, source.signalIndex, source.zone?.id || "none", source.direction),
    setupId: source.setupId,
    setupName: source.setupName,
    category: source.category,
    direction: source.direction,
    signalIndex: source.signalIndex,
    signalTime: source.signal.time,
    signal: source.signal,
    zone: source.zone || null,
    context: source.context,
    score: priceActionRound(priceActionClamp(source.score, 0, 1)),
    evidenceIds: Object.freeze([source.signal.id, ...(source.zone?.evidenceIds || []), ...(source.extraEvidenceIds || [])]),
    actionLevels,
    ...(source.longLevels ? { longLevels: source.longLevels } : {}),
    ...(source.shortLevels ? { shortLevels: source.shortLevels } : {}),
  };
  return Object.freeze({ ...base, ...resolveLifecycle(snapshot, base) });
}

function zonesNearSignal(structure, signal) {
  const tolerance = structure.rangeUnit * 0.8;
  return structure.zones.filter((zone) => signal.high >= zone.lower - tolerance && signal.low <= zone.upper + tolerance);
}

function patternAt(candlestickPatterns, index, direction, zone = null) {
  return (candlestickPatterns?.recentPatterns || [])
    .filter((pattern) => pattern.endIndex === index && pattern.direction === direction)
    .filter((pattern) => pattern.complete !== false && pattern.formationStatus !== "forming")
    .filter((pattern) => !zone || !pattern.zone || pattern.zone.id === zone.id)
    .sort((first, second) => second.quality - first.quality)[0] || null;
}

function scanZoneSetups(snapshot, structure, metrics, candlestickPatterns) {
  const candidates = [];
  const start = Math.max(1, snapshot.candles.length - 8);
  for (let index = start; index < snapshot.candles.length; index += 1) {
    const signal = metrics[index];
    for (const zone of zonesNearSignal(structure, signal)) {
      if (zone.touches < 2) continue;
      const sweepBuffer = priceActionBuffer(snapshot.candles, structure.rangeUnit, 0.1);
      const bullishSweep = signal.low < zone.lower - sweepBuffer && signal.close > zone.upper;
      const bearishSweep = signal.high > zone.upper + sweepBuffer && signal.close < zone.lower;
      const bullishFact = directionalFact(signal, "bullish");
      const bearishFact = directionalFact(signal, "bearish");
      const bullishPattern = patternAt(candlestickPatterns, index, "bullish", zone);
      const bearishPattern = patternAt(candlestickPatterns, index, "bearish", zone);
      const bullishEvidence = bullishPattern?.name || bullishFact;
      const bearishEvidence = bearishPattern?.name || bearishFact;
      const roleSupport = zone.role === "support" || zone.role === "decision" || zone.lowTouches >= zone.highTouches;
      const roleResistance = zone.role === "resistance" || zone.role === "decision" || zone.highTouches >= zone.lowTouches;
      if (bullishSweep && bullishEvidence) {
        candidates.push(makeCandidate(snapshot, structure, {
          setupId: "failed-breakdown-reclaim",
          setupName: "向下假突破后收回",
          category: "failed-breakout",
          direction: "bullish",
          signalIndex: index,
          signal,
          zone,
          context: `价格刺破支撑区后由已收盘 K 线收回，${bullishEvidence}`,
          score: 0.72 + zone.score * 0.18 + signal.bodyRatio * 0.1 + (bullishPattern ? 0.05 : 0),
          extraEvidenceIds: bullishPattern ? [bullishPattern.id] : [],
        }));
      } else if (bearishSweep && bearishEvidence) {
        candidates.push(makeCandidate(snapshot, structure, {
          setupId: "failed-breakout-reject",
          setupName: "向上假突破后跌回",
          category: "failed-breakout",
          direction: "bearish",
          signalIndex: index,
          signal,
          zone,
          context: `价格刺破阻力区后由已收盘 K 线跌回，${bearishEvidence}`,
          score: 0.72 + zone.score * 0.18 + signal.bodyRatio * 0.1 + (bearishPattern ? 0.05 : 0),
          extraEvidenceIds: bearishPattern ? [bearishPattern.id] : [],
        }));
      } else if (roleSupport && bullishEvidence && signal.close >= zone.center) {
        const trendAligned = structure.market.direction === "bullish";
        candidates.push(makeCandidate(snapshot, structure, {
          setupId: trendAligned ? "trend-pullback-long" : "support-rejection-long",
          setupName: trendAligned ? "上升结构回调做多" : "支撑区拒绝做多",
          category: trendAligned ? "trend-pullback" : "range-rejection",
          direction: "bullish",
          signalIndex: index,
          signal,
          zone,
          context: `${trendAligned ? "HH/HL 上升结构" : "区间/过渡结构"}在支撑区出现 ${bullishEvidence}`,
          score: 0.52 + zone.score * 0.22 + (trendAligned ? 0.12 : 0) + signal.bodyRatio * 0.08 + (bullishPattern ? 0.05 : 0),
          extraEvidenceIds: bullishPattern ? [bullishPattern.id] : [],
        }));
      } else if (roleResistance && bearishEvidence && signal.close <= zone.center) {
        const trendAligned = structure.market.direction === "bearish";
        candidates.push(makeCandidate(snapshot, structure, {
          setupId: trendAligned ? "trend-pullback-short" : "resistance-rejection-short",
          setupName: trendAligned ? "下降结构反弹做空" : "阻力区拒绝做空",
          category: trendAligned ? "trend-pullback" : "range-rejection",
          direction: "bearish",
          signalIndex: index,
          signal,
          zone,
          context: `${trendAligned ? "LH/LL 下降结构" : "区间/过渡结构"}在阻力区出现 ${bearishEvidence}`,
          score: 0.52 + zone.score * 0.22 + (trendAligned ? 0.12 : 0) + signal.bodyRatio * 0.08 + (bearishPattern ? 0.05 : 0),
          extraEvidenceIds: bearishPattern ? [bearishPattern.id] : [],
        }));
      }
    }
  }
  return candidates;
}

function scanBreakoutRetests(snapshot, structure, metrics, candlestickPatterns) {
  const candidates = [];
  const latestIndex = snapshot.candles.length - 1;
  const buffer = priceActionBuffer(snapshot.candles, structure.rangeUnit, 0.14);
  for (const zone of structure.zones.filter((item) => item.touches >= 2)) {
    const start = Math.max(1, latestIndex - 10);
    for (let breakoutIndex = start; breakoutIndex < latestIndex; breakoutIndex += 1) {
      const breakout = snapshot.candles[breakoutIndex];
      const direction = breakout.close > zone.upper + buffer ? "bullish" : breakout.close < zone.lower - buffer ? "bearish" : null;
      if (!direction) continue;
      for (let retestIndex = breakoutIndex + 1; retestIndex <= Math.min(latestIndex, breakoutIndex + 5); retestIndex += 1) {
        const signal = metrics[retestIndex];
        const fact = directionalFact(signal, direction);
        const pattern = patternAt(candlestickPatterns, retestIndex, direction, zone);
        const evidence = pattern?.name || fact;
        const touched = direction === "bullish"
          ? signal.low <= zone.upper + buffer && signal.close >= zone.upper
          : signal.high >= zone.lower - buffer && signal.close <= zone.lower;
        if (!evidence || !touched) continue;
        candidates.push(makeCandidate(snapshot, structure, {
          setupId: direction === "bullish" ? "breakout-retest-long" : "breakdown-retest-short",
          setupName: direction === "bullish" ? "阻力突破回踩做多" : "支撑跌破反抽做空",
          category: "breakout-retest",
          direction,
          signalIndex: retestIndex,
          signal,
          zone,
          context: `第 ${breakoutIndex + 1} 根输入 K 线收盘突破，随后回测原边界并出现 ${evidence}`,
          score: 0.68 + zone.score * 0.2 + signal.bodyRatio * 0.08 + (pattern ? 0.05 : 0),
          extraEvidenceIds: pattern ? [pattern.id] : [],
        }));
      }
    }
  }
  return candidates;
}

function scanInsideBars(snapshot, structure, metrics) {
  const candidates = [];
  const latestIndex = snapshot.candles.length - 1;
  const buffer = priceActionBuffer(snapshot.candles, structure.rangeUnit, 0.1);
  for (let index = Math.max(1, latestIndex - 4); index <= latestIndex; index += 1) {
    const signal = metrics[index];
    if (!signal.facts.includes("inside-bar")) continue;
    const mother = snapshot.candles[index - 1];
    const motherSignal = metrics[index - 1];
    const zone = zonesNearSignal(structure, signal).sort((a, b) => b.score - a.score)[0] || null;
    if (!zone && structure.market.direction === "neutral") continue;
    const longLevels = levelsFor(snapshot, structure, "bullish", signal, zone, {
      trigger: mother.high + buffer,
      stop: mother.low - buffer,
    });
    const shortLevels = levelsFor(snapshot, structure, "bearish", signal, zone, {
      trigger: mother.low - buffer,
      stop: mother.high + buffer,
    });
    const breakoutIndex = snapshot.candles.slice(index + 1).findIndex((candle) => (
      candle.close > mother.high + buffer || candle.close < mother.low - buffer
    ));
    const absoluteBreakoutIndex = breakoutIndex < 0 ? null : index + 1 + breakoutIndex;
    const direction = absoluteBreakoutIndex === null
      ? "neutral"
      : snapshot.candles[absoluteBreakoutIndex].close > mother.high + buffer ? "bullish" : "bearish";
    candidates.push(makeCandidate(snapshot, structure, {
      setupId: "inside-bar-breakout",
      setupName: direction === "neutral" ? "Inside Bar 压缩待突破" : `Inside Bar ${direction === "bullish" ? "向上" : "向下"}突破`,
      category: "compression-breakout",
      direction,
      signalIndex: index,
      signal,
      zone,
      context: direction === "neutral"
        ? `当前 K 线完整包含在母 K ${motherSignal.time} 的高低范围内，突破前不预判方向`
        : `Inside Bar 后第 ${absoluteBreakoutIndex + 1} 根输入 K 线由收盘选择${direction === "bullish" ? "向上" : "向下"}方向`,
      score: 0.5 + (zone?.score || 0) * 0.18 + (structure.market.direction === "neutral" ? 0.08 : 0.04),
      ...(direction === "neutral" ? { longLevels, shortLevels } : {
        levelOverrides: direction === "bullish"
          ? { trigger: longLevels.trigger, stop: longLevels.stop }
          : { trigger: shortLevels.trigger, stop: shortLevels.stop },
      }),
    }));
  }
  return candidates;
}

function candidateRank(candidate, latestIndex) {
  const lifecycleWeight = candidate.lifecycle === "confirmed" ? 0.14 : candidate.lifecycle === "developing" ? 0.1 : 0;
  const setupQuality = {
    "failed-breakout": 0.2,
    "breakout-retest": 0.16,
    "trend-pullback": 0.12,
    "range-rejection": 0.1,
    "compression-breakout": 0.02,
  }[candidate.category] || 0;
  const recency = priceActionClamp(1 - (latestIndex - candidate.signalIndex) / 8, 0, 1);
  const directional = candidate.direction === "neutral" ? 0 : 0.04;
  return candidate.score * 0.55 + recency * 0.25 + setupQuality + lifecycleWeight + directional;
}

export function runPriceActionSignalEngine(snapshot, structure, candlestickPatterns = null) {
  const metrics = snapshot.candles.map((_, index) => candleMetrics(snapshot.candles, index, structure.rangeUnit));
  const all = [
    ...scanZoneSetups(snapshot, structure, metrics, candlestickPatterns),
    ...scanBreakoutRetests(snapshot, structure, metrics, candlestickPatterns),
    ...scanInsideBars(snapshot, structure, metrics),
  ];
  const deduplicated = [...new Map(all.map((candidate) => [
    `${candidate.setupId}:${candidate.signalIndex}:${candidate.zone?.id || "none"}:${candidate.direction}`,
    candidate,
  ])).values()];
  const active = deduplicated.filter((candidate) => ["active", "awaiting-breakout", "awaiting-confirmation"].includes(candidate.tradeState));
  const historical = deduplicated.filter((candidate) => !active.includes(candidate));
  const latestIndex = snapshot.candles.length - 1;
  active.sort((a, b) => candidateRank(b, latestIndex) - candidateRank(a, latestIndex));
  historical.sort((a, b) => b.signalIndex - a.signalIndex || b.score - a.score);
  return Object.freeze({
    engineId: "price-action-signal",
    engineVersion: "1.0.0",
    latest: metrics.at(-1),
    recent: Object.freeze(metrics.slice(-12)),
    activeCandidates: Object.freeze(active.slice(0, 12)),
    historicalCandidates: Object.freeze(historical.slice(0, 24)),
    primaryActiveCandidate: active[0] || null,
  });
}
