import crypto from "node:crypto";
import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";

export const ICT_SMC_ENGINE_ID = "ict_smc";
export const ICT_SMC_ENGINE_VERSION = "0.1.0";

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(parts.join(":"), "utf8").digest("hex").slice(0, 16)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function averageTrueRange(candles, period = 14) {
  const ranges = candles.map((candle, index) => trueRange(
    candle,
    index ? candles[index - 1].close : candle.close,
  ));
  return average(ranges.slice(-Math.min(period, ranges.length)));
}

function intervalLabel(interval) {
  if (interval === "1D") return "1D";
  if (interval === "1W") return "1W";
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return String(interval);
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}m`;
}

function rawPivots(snapshotId, interval, candles, radius) {
  const pivots = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const neighbours = candles.slice(index - radius, index + radius + 1);
    const otherHighs = neighbours.filter((_, offset) => offset !== radius).map((item) => item.high);
    const otherLows = neighbours.filter((_, offset) => offset !== radius).map((item) => item.low);
    const isHigh = candle.high > Math.max(...otherHighs);
    const isLow = candle.low < Math.min(...otherLows);
    if (!isHigh && !isLow) continue;
    const type = isHigh && isLow
      ? candle.high - Math.max(...otherHighs) >= Math.min(...otherLows) - candle.low ? "high" : "low"
      : isHigh ? "high" : "low";
    const price = type === "high" ? candle.high : candle.low;
    pivots.push({
      id: idFor("smc-pivot", snapshotId, interval, index, type, price),
      interval,
      index,
      time: candle.time,
      price,
      type,
      status: "confirmed",
    });
  }
  return pivots;
}

function compactAlternatingPivots(pivots, atr) {
  const threshold = Math.max(atr * 0.35, Number.EPSILON);
  const compacted = [];
  for (const pivot of pivots) {
    const previous = compacted.at(-1);
    if (!previous) {
      compacted.push(pivot);
      continue;
    }
    if (previous.type === pivot.type) {
      const moreExtreme = pivot.type === "high"
        ? pivot.price >= previous.price
        : pivot.price <= previous.price;
      if (moreExtreme) compacted[compacted.length - 1] = pivot;
      continue;
    }
    if (Math.abs(pivot.price - previous.price) < threshold) continue;
    compacted.push(pivot);
  }
  return compacted;
}

function trendBefore(pivots, index) {
  const prior = pivots.filter((pivot) => pivot.index <= index);
  const highs = prior.filter((pivot) => pivot.type === "high").slice(-2);
  const lows = prior.filter((pivot) => pivot.type === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return "neutral";
  if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) return "bullish";
  if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) return "bearish";
  return "neutral";
}

function displacementDetails(candle, atr, medianVolume) {
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const body = Math.abs(candle.close - candle.open);
  const bodyAtr = atr ? body / atr : 0;
  const bodyShare = body / range;
  const volumeRatio = medianVolume ? candle.volume / medianVolume : 0;
  const confirmed = bodyAtr >= 1.05 && bodyShare >= 0.55 && (volumeRatio >= 1.05 || bodyAtr >= 1.5);
  return { bodyAtr, bodyShare, volumeRatio, confirmed };
}

function buildStructureEvents(snapshotId, interval, candles, pivots, atr, medianVolume) {
  const breakBuffer = Math.max(atr * 0.04, candles.at(-1).close * 0.00008);
  const byBreak = new Map();
  for (const pivot of pivots) {
    let breakIndex = -1;
    for (let index = pivot.index + 1; index < candles.length; index += 1) {
      const close = candles[index].close;
      if (
        (pivot.type === "high" && close > pivot.price + breakBuffer)
        || (pivot.type === "low" && close < pivot.price - breakBuffer)
      ) {
        breakIndex = index;
        break;
      }
    }
    if (breakIndex < 0) continue;
    const direction = pivot.type === "high" ? "bullish" : "bearish";
    const priorTrend = trendBefore(pivots, pivot.index);
    const counterTrend = (direction === "bullish" && priorTrend === "bearish")
      || (direction === "bearish" && priorTrend === "bullish");
    const displacement = displacementDetails(candles[breakIndex], atr, medianVolume);
    const kind = counterTrend ? displacement.confirmed ? "MSS" : "CHoCH" : "BOS";
    const event = {
      id: idFor("smc-structure", snapshotId, interval, kind, pivot.id, breakIndex),
      interval,
      kind,
      direction,
      priorTrend,
      pivotId: pivot.id,
      pivotTime: pivot.time,
      pivotPrice: pivot.price,
      breakIndex,
      breakTime: candles[breakIndex].time,
      breakPrice: candles[breakIndex].close,
      displacement,
      status: "confirmed",
    };
    const key = `${breakIndex}:${direction}`;
    const previous = byBreak.get(key);
    if (!previous || pivot.index > previous.pivotIndex) {
      byBreak.set(key, { ...event, pivotIndex: pivot.index });
    }
  }
  return [...byBreak.values()]
    .sort((first, second) => first.breakIndex - second.breakIndex)
    .slice(-10)
    .map(({ pivotIndex: _pivotIndex, ...event }) => event);
}

function buildFairValueGaps(snapshotId, interval, candles, atr) {
  const candidates = [];
  const minimumGap = Math.max(atr * 0.04, candles.at(-1).close * 0.00005);
  for (let index = 1; index < candles.length - 1; index += 1) {
    const first = candles[index - 1];
    const impulse = candles[index];
    const third = candles[index + 1];
    const displacement = displacementDetails(impulse, atr, median(candles.slice(Math.max(0, index - 20), index + 1).map((item) => item.volume)));
    const bullishGap = third.low - first.high;
    const bearishGap = first.low - third.high;
    const side = bullishGap >= minimumGap ? "bullish" : bearishGap >= minimumGap ? "bearish" : null;
    if (!side || (!displacement.confirmed && Math.max(bullishGap, bearishGap) < atr * 0.12)) continue;
    const lower = side === "bullish" ? first.high : third.high;
    const upper = side === "bullish" ? third.low : first.low;
    let state = "open";
    let mitigationTime = null;
    let fillRatio = 0;
    for (let futureIndex = index + 2; futureIndex < candles.length; futureIndex += 1) {
      const future = candles[futureIndex];
      if (side === "bullish") {
        if (future.low <= lower) {
          state = future.close < lower ? "invalidated" : "filled";
          mitigationTime = future.time;
          fillRatio = 1;
          break;
        }
        if (future.low < upper) {
          state = "partial";
          mitigationTime = future.time;
          fillRatio = Math.max(fillRatio, clamp((upper - future.low) / (upper - lower), 0, 1));
        }
      } else {
        if (future.high >= upper) {
          state = future.close > upper ? "invalidated" : "filled";
          mitigationTime = future.time;
          fillRatio = 1;
          break;
        }
        if (future.high > lower) {
          state = "partial";
          mitigationTime = future.time;
          fillRatio = Math.max(fillRatio, clamp((future.high - lower) / (upper - lower), 0, 1));
        }
      }
    }
    candidates.push({
      id: idFor("smc-fvg", snapshotId, interval, index, side, lower, upper),
      interval,
      kind: "FVG",
      side,
      originIndex: index,
      startTime: first.time,
      createdTime: third.time,
      endTime: candles.at(-1).time,
      lower,
      upper,
      state,
      mitigationTime,
      fillRatio,
      displacement,
      status: index + 1 < candles.length - 1 ? "confirmed" : "tentative",
    });
  }
  return candidates
    .sort((first, second) => {
      const firstActive = first.state === "open" || first.state === "partial" ? 1 : 0;
      const secondActive = second.state === "open" || second.state === "partial" ? 1 : 0;
      return secondActive - firstActive || second.originIndex - first.originIndex;
    })
    .slice(0, 8);
}

function buildOrderBlocks(snapshotId, interval, candles, structureEvents) {
  const blocksByOrigin = new Map();
  for (const event of structureEvents) {
    let originIndex = -1;
    for (let index = event.breakIndex - 1; index >= Math.max(0, event.breakIndex - 12); index -= 1) {
      const candle = candles[index];
      const opposite = event.direction === "bullish"
        ? candle.close < candle.open
        : candle.close > candle.open;
      if (opposite) {
        originIndex = index;
        break;
      }
    }
    if (originIndex < 0) continue;
    const origin = candles[originIndex];
    const side = event.direction;
    const lower = side === "bullish" ? origin.low : Math.min(origin.open, origin.close);
    const upper = side === "bullish" ? Math.max(origin.open, origin.close) : origin.high;
    let state = "active";
    let mitigationTime = null;
    let invalidationIndex = -1;
    for (let index = event.breakIndex + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      const overlaps = candle.low <= upper && candle.high >= lower;
      if (overlaps && !mitigationTime) {
        mitigationTime = candle.time;
        state = "mitigated";
      }
      const invalidated = side === "bullish" ? candle.close < lower : candle.close > upper;
      if (invalidated) {
        state = "invalidated";
        invalidationIndex = index;
        break;
      }
    }
    const block = {
      id: idFor("smc-ob", snapshotId, interval, side, originIndex, event.id),
      interval,
      kind: "OB",
      side,
      originIndex,
      originTime: origin.time,
      endTime: candles.at(-1).time,
      lower,
      upper,
      state,
      mitigationTime,
      invalidationIndex,
      breakEventId: event.id,
      definition: "wick_to_open",
      status: "confirmed",
    };
    const key = `${side}:${originIndex}`;
    const previous = blocksByOrigin.get(key);
    if (!previous || event.breakIndex > previous.breakIndex) {
      blocksByOrigin.set(key, { ...block, breakIndex: event.breakIndex });
    }
  }
  const orderBlocks = [...blocksByOrigin.values()]
    .sort((first, second) => {
      const firstActive = first.state === "active" || first.state === "mitigated" ? 1 : 0;
      const secondActive = second.state === "active" || second.state === "mitigated" ? 1 : 0;
      return secondActive - firstActive || second.originIndex - first.originIndex;
    })
    .slice(0, 7)
    .map(({ breakIndex: _breakIndex, ...block }) => block);
  const breakers = orderBlocks.flatMap((block) => {
    if (block.invalidationIndex < 0) return [];
    const retestIndex = candles.findIndex((candle, index) => (
      index > block.invalidationIndex
      && candle.low <= block.upper
      && candle.high >= block.lower
    ));
    if (retestIndex < 0) return [];
    return [{
      id: idFor("smc-breaker", snapshotId, interval, block.id, retestIndex),
      interval,
      kind: "Breaker",
      side: block.side === "bullish" ? "bearish" : "bullish",
      sourceOrderBlockId: block.id,
      originTime: block.originTime,
      retestTime: candles[retestIndex].time,
      endTime: candles.at(-1).time,
      lower: block.lower,
      upper: block.upper,
      state: "confirmed",
      status: "confirmed",
    }];
  }).slice(-3);
  return { orderBlocks, breakers };
}

function buildLiquidity(snapshotId, interval, candles, pivots, atr) {
  const tolerance = Math.max(atr * 0.18, candles.at(-1).close * 0.00035);
  const groups = [];
  for (const pivot of pivots) {
    let group = groups.find((candidate) => (
      candidate.type === pivot.type
      && Math.abs(candidate.price - pivot.price) <= tolerance
      && pivot.index - candidate.lastIndex <= 120
    ));
    if (!group) {
      group = { type: pivot.type, price: pivot.price, pivots: [], lastIndex: pivot.index };
      groups.push(group);
    }
    group.pivots.push(pivot);
    group.price = average(group.pivots.map((item) => item.price));
    group.lastIndex = pivot.index;
  }
  const sweeps = [];
  const liquidityPools = groups.flatMap((group) => {
    if (group.pivots.length < 2) return [];
    const side = group.type === "high" ? "BSL" : "SSL";
    let state = "open";
    let sweep = null;
    for (let index = group.lastIndex + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (side === "BSL" && candle.high > group.price + tolerance * 0.15) {
        const reclaimed = candle.close < group.price;
        state = reclaimed ? "swept" : "consumed";
        if (reclaimed) sweep = { index, time: candle.time, price: candle.high, direction: "bearish" };
        break;
      }
      if (side === "SSL" && candle.low < group.price - tolerance * 0.15) {
        const reclaimed = candle.close > group.price;
        state = reclaimed ? "swept" : "consumed";
        if (reclaimed) sweep = { index, time: candle.time, price: candle.low, direction: "bullish" };
        break;
      }
    }
    const pool = {
      id: idFor("smc-liquidity", snapshotId, interval, side, ...group.pivots.map((pivot) => pivot.id)),
      interval,
      kind: side,
      side,
      price: group.price,
      startTime: group.pivots[0].time,
      endTime: sweep?.time || candles.at(-1).time,
      pivotIds: group.pivots.map((pivot) => pivot.id),
      touchCount: group.pivots.length,
      state,
      status: "confirmed",
    };
    if (sweep) {
      sweeps.push({
        id: idFor("smc-sweep", snapshotId, interval, pool.id, sweep.index),
        interval,
        kind: "Sweep",
        liquidityPoolId: pool.id,
        liquiditySide: side,
        direction: sweep.direction,
        time: sweep.time,
        price: sweep.price,
        referencePrice: group.price,
        status: "confirmed",
      });
    }
    return [pool];
  }).sort((first, second) => {
    const stateWeight = (state) => state === "open" ? 2 : state === "swept" ? 1 : 0;
    return stateWeight(second.state) - stateWeight(first.state) || second.endTime - first.endTime;
  }).slice(0, 8);
  const poolIds = new Set(liquidityPools.map((pool) => pool.id));
  return {
    liquidityPools,
    sweeps: sweeps.filter((sweep) => poolIds.has(sweep.liquidityPoolId)).slice(-4),
  };
}

function buildDealingRange(snapshotId, interval, candles, pivots, structureEvents) {
  const latestEvent = structureEvents.at(-1);
  let startPivot = null;
  let endPrice = null;
  let direction = null;
  let endTime = null;
  if (latestEvent) {
    direction = latestEvent.direction;
    startPivot = pivots
      .filter((pivot) => (
        pivot.index < latestEvent.breakIndex
        && pivot.type === (direction === "bullish" ? "low" : "high")
      ))
      .at(-1) || null;
    const breakCandle = candles[latestEvent.breakIndex];
    endPrice = direction === "bullish" ? breakCandle.high : breakCandle.low;
    endTime = breakCandle.time;
  }
  if (!startPivot) {
    const lastTwo = pivots.slice(-2);
    if (lastTwo.length < 2) return null;
    startPivot = lastTwo[0];
    endPrice = lastTwo[1].price;
    endTime = lastTwo[1].time;
    direction = endPrice >= startPivot.price ? "bullish" : "bearish";
  }
  const low = Math.min(startPivot.price, endPrice);
  const high = Math.max(startPivot.price, endPrice);
  const span = high - low;
  if (!(span > 0)) return null;
  const equilibrium = low + span * 0.5;
  const otePrices = direction === "bullish"
    ? [high - span * 0.786, high - span * 0.618]
    : [low + span * 0.618, low + span * 0.786];
  return {
    id: idFor("smc-range", snapshotId, interval, startPivot.id, endTime, direction),
    interval,
    kind: "DealingRange",
    direction,
    startTime: startPivot.time,
    endTime: candles.at(-1).time,
    impulseEndTime: endTime,
    low,
    high,
    equilibrium,
    discount: { lower: low, upper: equilibrium },
    premium: { lower: equilibrium, upper: high },
    ote: {
      lower: Math.min(...otePrices),
      upper: Math.max(...otePrices),
      ratios: [0.618, 0.786],
    },
    status: "confirmed",
  };
}

function analyzeTimeframe(snapshotId, interval, candles, role) {
  const atr = averageTrueRange(candles);
  const pivotRadius = candles.length >= 160 ? 3 : 2;
  const raw = rawPivots(snapshotId, interval, candles, pivotRadius);
  const pivots = compactAlternatingPivots(raw, atr);
  const medianVolume = median(candles.slice(-Math.min(60, candles.length)).map((candle) => candle.volume));
  const structureEvents = buildStructureEvents(snapshotId, interval, candles, pivots, atr, medianVolume);
  const fairValueGaps = buildFairValueGaps(snapshotId, interval, candles, atr);
  const { orderBlocks, breakers } = buildOrderBlocks(snapshotId, interval, candles, structureEvents);
  const { liquidityPools, sweeps } = buildLiquidity(snapshotId, interval, candles, raw, atr);
  const dealingRange = buildDealingRange(snapshotId, interval, candles, pivots, structureEvents);
  const currentBias = structureEvents.at(-1)?.direction || dealingRange?.direction || "neutral";
  return {
    interval,
    label: intervalLabel(interval),
    role,
    candleCount: candles.length,
    statistics: {
      atr,
      pivotRadius,
      rawPivotCount: raw.length,
      pivotCount: pivots.length,
      structureEventCount: structureEvents.length,
      fairValueGapCount: fairValueGaps.length,
      orderBlockCount: orderBlocks.length,
      breakerCount: breakers.length,
      liquidityPoolCount: liquidityPools.length,
      sweepCount: sweeps.length,
    },
    currentBias,
    structures: {
      pivots,
      structureEvents,
      fairValueGaps,
      orderBlocks,
      breakers,
      liquidityPools,
      sweeps,
      dealingRange,
    },
  };
}

function recommendedCandidates(timeframe) {
  const structures = timeframe.structures;
  const active = (items, states) => items.filter((item) => states.includes(item.state));
  if (timeframe.role === "execution") {
    return [
      ...structures.structureEvents.slice(-4).reverse(),
      ...active(structures.orderBlocks, ["active", "mitigated"]).slice(0, 2),
      ...active(structures.fairValueGaps, ["open", "partial"]).slice(0, 2),
      ...structures.breakers.slice(-1),
      ...structures.liquidityPools.slice(0, 3),
      ...structures.sweeps.slice(-1),
      structures.dealingRange,
    ].filter(Boolean);
  }
  return [
    structures.structureEvents.at(-1),
    active(structures.orderBlocks, ["active", "mitigated"])[0],
    active(structures.fairValueGaps, ["open", "partial"])[0],
    structures.liquidityPools[0],
    structures.dealingRange,
  ].filter(Boolean);
}

function flattenStructures(timeframes) {
  const merged = {
    pivots: [],
    structureEvents: [],
    fairValueGaps: [],
    orderBlocks: [],
    breakers: [],
    liquidityPools: [],
    sweeps: [],
    dealingRanges: [],
  };
  for (const timeframe of timeframes) {
    merged.pivots.push(...timeframe.structures.pivots);
    merged.structureEvents.push(...timeframe.structures.structureEvents);
    merged.fairValueGaps.push(...timeframe.structures.fairValueGaps);
    merged.orderBlocks.push(...timeframe.structures.orderBlocks);
    merged.breakers.push(...timeframe.structures.breakers);
    merged.liquidityPools.push(...timeframe.structures.liquidityPools);
    merged.sweeps.push(...timeframe.structures.sweeps);
    if (timeframe.structures.dealingRange) merged.dealingRanges.push(timeframe.structures.dealingRange);
  }
  return merged;
}

export function runIctSmcTheoryEngine(snapshot) {
  const timeframes = [
    analyzeTimeframe(snapshot.snapshotId, snapshot.interval, snapshot.candles, "execution"),
    ...(snapshot.contextCandles || []).map((context) => (
      analyzeTimeframe(snapshot.snapshotId, context.interval, context.candles, "context")
    )),
  ];
  const structures = flattenStructures(timeframes);
  const recommended = [];
  const seen = new Set();
  for (const candidate of timeframes.flatMap(recommendedCandidates)) {
    if (!candidate?.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    recommended.push(candidate.id);
    if (recommended.length >= 22) break;
  }
  const status = structures.structureEvents.length
    || structures.fairValueGaps.length
    || structures.orderBlocks.length
    || structures.liquidityPools.length
    ? "succeeded"
    : "insufficient_data";
  const latestEvent = timeframes[0].structures.structureEvents.at(-1) || null;
  const evidence = [
    ...structures.structureEvents.map((event) => ({ evidenceId: event.id, kind: event.kind.toLowerCase(), source: "ohlcv" })),
    ...structures.fairValueGaps.map((gap) => ({ evidenceId: gap.id, kind: "fair_value_gap", source: "ohlcv" })),
    ...structures.orderBlocks.map((block) => ({ evidenceId: block.id, kind: "order_block", source: "ohlcv" })),
    ...structures.breakers.map((breaker) => ({ evidenceId: breaker.id, kind: "breaker", source: "ohlcv" })),
    ...structures.liquidityPools.map((pool) => ({ evidenceId: pool.id, kind: pool.side.toLowerCase(), source: "ohlcv" })),
    ...structures.sweeps.map((sweep) => ({ evidenceId: sweep.id, kind: "liquidity_sweep", source: "ohlcv" })),
  ];
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    resultId: idFor("smc-result", snapshot.snapshotId, ICT_SMC_ENGINE_VERSION),
    engineId: ICT_SMC_ENGINE_ID,
    engineVersion: ICT_SMC_ENGINE_VERSION,
    snapshotId: snapshot.snapshotId,
    status,
    confidence: {
      structure: clamp(structures.structureEvents.length / 6, 0, 1),
      coverage: clamp(snapshot.candles.length / 160, 0, 1),
    },
    statistics: {
      timeframeCount: timeframes.length,
      structureEventCount: structures.structureEvents.length,
      fairValueGapCount: structures.fairValueGaps.length,
      orderBlockCount: structures.orderBlocks.length,
      breakerCount: structures.breakers.length,
      liquidityPoolCount: structures.liquidityPools.length,
      sweepCount: structures.sweeps.length,
    },
    currentBias: latestEvent?.direction || timeframes[0].currentBias,
    timeframes,
    structures,
    drawingCandidateIds: recommended,
    signals: latestEvent ? [{
      signalId: idFor("smc-signal", snapshot.snapshotId, latestEvent.id),
      kind: latestEvent.direction === "bullish" ? "bullish_structure" : "bearish_structure",
      strength: latestEvent.displacement.confirmed ? 0.8 : 0.6,
      status: "confirmed",
      evidenceIds: [latestEvent.id],
    }] : [],
    evidence,
  };
}

export function fuseIctSmcWithOrderFlow(marketStructure, orderFlowResult, snapshot) {
  const flowDirection = orderFlowResult.statistics.direction;
  const structureDirection = marketStructure.currentBias;
  const aligned = (structureDirection === "bullish" && flowDirection === "buying_pressure")
    || (structureDirection === "bearish" && flowDirection === "selling_pressure");
  const divergent = (structureDirection === "bullish" && flowDirection === "selling_pressure")
    || (structureDirection === "bearish" && flowDirection === "buying_pressure");
  const intervalSeconds = Math.max(1, snapshot.candles.at(-1).time - snapshot.candles.at(-2).time);
  const windowStart = Number(orderFlowResult.statistics.windowStart || 0);
  const windowEnd = Number(orderFlowResult.statistics.windowEnd || 0);
  const structureEvents = marketStructure.structures.structureEvents.map((event) => {
    const covered = event.interval === snapshot.interval
      && event.breakTime + intervalSeconds >= windowStart
      && event.breakTime <= windowEnd;
    const eventAligned = (event.direction === "bullish" && flowDirection === "buying_pressure")
      || (event.direction === "bearish" && flowDirection === "selling_pressure");
    const eventDivergent = (event.direction === "bullish" && flowDirection === "selling_pressure")
      || (event.direction === "bearish" && flowDirection === "buying_pressure");
    return {
      ...event,
      orderFlowConfirmation: covered
        ? eventAligned ? "aligned" : eventDivergent ? "divergent" : "neutral"
        : "not_covered",
    };
  });
  return {
    ...marketStructure,
    structures: { ...marketStructure.structures, structureEvents },
    orderFlowConfirmation: {
      structureDirection,
      flowDirection,
      state: aligned ? "aligned" : divergent ? "divergent" : "neutral",
      windowStart,
      windowEnd,
      note: "真实订单流只确认其数据窗口覆盖的结构事件；历史 ICT/SMC 标注仍是 OHLCV 市场结构，不冒充逐笔证据。",
    },
  };
}
