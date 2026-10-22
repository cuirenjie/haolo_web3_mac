import { average, averageTrueRange, chartPatternRound, linePrice, patternFormationAtr, priorTrend } from "./chart-pattern-common.mjs";

const current = candidate => ["active", "awaiting-breakout", "awaiting-confirmation"].includes(candidate.tradeState);
const validVolume = bars => bars.length > 0 && bars.every(b => Number.isFinite(b?.volume) && b.volume > 0);

function climaxRetestEvidence(bars, points, direction, atr) {
  const side = direction === "bearish" ? "high" : direction === "bullish" ? "low" : null;
  const extrema = points.filter(p => p.type === side), first = extrema[0], last = extrema.at(-1);
  if (!side || !(atr > 0) || extrema.length < 2 || last.index - first.index < 5) return Object.freeze({ state: "unavailable" });
  const baseline = bars.slice(Math.max(0, first.index - 20), first.index);
  // Only the known pivot bars are compared: no volume from a future confirmation window.
  const samples = [bars[first.index], bars[last.index]];
  if (baseline.length < 10 || !validVolume(baseline) || !validVolume(samples)) return Object.freeze({ state: "unavailable" });
  const firstVolumeRatio = samples[0].volume / average(baseline.map(b => b.volume));
  const retestVolumeRatio = samples[1].volume / samples[0].volume;
  const priceProgressAtr = (last.price - first.price) * (side === "high" ? 1 : -1) / atr;
  return Object.freeze({ state: firstVolumeRatio >= 2 && retestVolumeRatio <= 0.7 && Math.abs(priceProgressAtr) <= 1
    ? "observed" : "not-observed", firstIndex: first.index, retestIndex: last.index,
    firstVolumeRatio: chartPatternRound(firstVolumeRatio), retestVolumeRatio: chartPatternRound(retestVolumeRatio),
    priceProgressAtr: chartPatternRound(priceProgressAtr) });
}

function parentRoom(snapshot, candidate, parent, atr) {
  const levels = candidate.actionLevels;
  if (!parent || !levels || candidate.direction === "neutral" || !current(candidate)) return null;
  const index = snapshot.candles.length - 1, up = candidate.direction === "bullish";
  const boundary = linePrice(up ? parent.boundaries.upper : parent.boundaries.lower, index);
  const close = snapshot.candles[index].close;
  const sign = up ? 1 : -1;
  // A parent already broken in the same direction is no longer an obstacle.
  if ((boundary - close) * sign < -atr * 0.35) return null;
  const distance = (boundary - levels.trigger) * sign, risk = Math.abs(levels.trigger - levels.stop);
  if (!(risk > 0) || !Number.isFinite(distance)) return null;
  const rewardRisk = Math.max(0, distance) / risk;
  return Object.freeze({ parentId: parent.id, evaluatedAtIndex: index, boundary: chartPatternRound(boundary),
    distance: chartPatternRound(distance), rewardRisk: chartPatternRound(rewardRisk),
    state: rewardRisk < 1 ? "limited" : "available" });
}

// Evidence from this snapshot only. Swing scales are not separate timeframes.
export function chartPatternContext(snapshot, candidate, candidates = []) {
  const bars = snapshot.candles, points = candidate.points;
  const start = points[0].index, end = points.at(-1).index;
  const atr = patternFormationAtr(snapshot, points);
  const trend = priorTrend(snapshot, start, "up", atr);
  const formation = bars.slice(start, end + 1), middle = Math.floor(formation.length / 2);
  const formationRatio = validVolume(formation) ? average(formation.slice(middle).map(b => b.volume))
    / average(formation.slice(0, middle).map(b => b.volume)) : null;
  const breakout = candidate.breakout;
  const before = Number.isInteger(breakout?.index) ? bars.slice(Math.max(0, breakout.index - 20), breakout.index) : [];
  const breakoutRatio = before.length >= 5 && validVolume(before) && validVolume([bars[breakout.index]])
    ? bars[breakout.index].volume / average(before.map(b => b.volume)) : null;
  let retest = { state: "not-broken", index: null };
  let firstHeldAtIndex = null;
  if (Number.isInteger(breakout?.index)) {
    retest = { state: "not-seen", index: null };
    const up = breakout.direction === "up", tolerance = Math.max(atr * 0.35, breakout.buffer);
    const limit = Math.min(bars.length - 1, candidate.lifecycleState?.terminalIndex ?? bars.length - 1);
    for (let i = breakout.index + 1; i <= limit; i++) {
      const boundary = breakout.boundary + (breakout.boundarySlope || 0) * (i - breakout.index), bar = bars[i];
      if (up ? bar.close < boundary - breakout.buffer : bar.close > boundary + breakout.buffer) {
        retest = { state: "failed", index: i }; break;
      }
      if (up ? bar.low <= boundary + tolerance && bar.close >= boundary
        : bar.high >= boundary - tolerance && bar.close <= boundary) {
        firstHeldAtIndex ??= i;
        retest = { state: "held", index: i };
      }
    }
  }
  const parents = candidates.filter(other => {
    if (other.id === candidate.id || !current(other) || !other.boundaries?.upper || !other.boundaries?.lower) return false;
    const os = other.points[0].index, oe = other.points.at(-1).index;
    if (oe - os < (end - start) * 1.6 || start < os
      || (Number.isFinite(other.metrics?.apexIndex) && other.metrics.apexIndex < bars.length - 1)) return false;
    return points.every(p => p.price <= linePrice(other.boundaries.upper, p.index) + atr
      && p.price >= linePrice(other.boundaries.lower, p.index) - atr);
  }).sort((a, b) => (a.points.at(-1).index - a.points[0].index) - (b.points.at(-1).index - b.points[0].index));
  const parent = parents[0];
  const room = parentRoom(snapshot, candidate, parent, atr);
  const directionalRooms = candidate.direction === "neutral" && candidate.longLevels && candidate.shortLevels
    ? { bullish: parentRoom(snapshot, { ...candidate, direction: "bullish", actionLevels: candidate.longLevels }, parent, atr),
      bearish: parentRoom(snapshot, { ...candidate, direction: "bearish", actionLevels: candidate.shortLevels }, parent, atr) }
    : { [candidate.direction]: room };
  const blockedDirections = Object.freeze(Object.entries(directionalRooms).filter(([, value]) => value?.state === "limited").map(([direction]) => direction));
  const compressionBars = firstHeldAtIndex === null ? [] : bars.slice(Math.max(firstHeldAtIndex, bars.length - 3));
  const compressionRatio = retest.state === "held" && current(candidate) && compressionBars.length >= 3 && atr > 0
    ? averageTrueRange(bars.slice(-4), 3) / atr : null;
  const compression = Object.freeze({ state: compressionRatio === null ? "unavailable"
    : compressionRatio <= 0.75 ? "contracted" : "not-contracted",
    rangeAtrRatio: compressionRatio === null ? null : chartPatternRound(compressionRatio), firstHeldAtIndex });
  const opposing = candidates.filter(other => other.id !== candidate.id
    && ["active", "awaiting-breakout"].includes(other.tradeState)
    && other.direction !== "neutral" && candidate.direction !== "neutral" && other.direction !== candidate.direction
    && Math.min(end, other.points.at(-1).index) >= Math.max(start, other.points[0].index));
  return Object.freeze({ timeframe: snapshot.interval, scope: "same-timeframe-multiple-scales", priorTrend: trend,
    volume: Object.freeze({ formationRatio: formationRatio === null ? null : chartPatternRound(formationRatio),
      breakoutRatio: breakoutRatio === null ? null : chartPatternRound(breakoutRatio) }),
    retest: Object.freeze(retest), retestCompression: compression,
    climaxRetest: climaxRetestEvidence(bars, points, candidate.direction, atr),
    parentId: parent?.id ?? null, parentPatternName: parent?.patternName ?? null, parentRoom: room,
    directionalParentRooms: Object.freeze(directionalRooms), blockedDirections,
    entryBlockedReason: room?.state === "limited" || blockedDirections.length === 2 ? "parent-boundary-within-one-risk" : null,
    conflictingCandidateIds: Object.freeze(opposing.map(o => o.id)),
    recognizedAtIndex: Math.max(...points.map(p => p.confirmedAtIndex ?? p.index), breakout?.index ?? 0),
  });
}
