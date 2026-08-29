import crypto from "node:crypto";

export const WYCKOFF_ENGINE_ID = "wyckoff";
export const WYCKOFF_ENGINE_VERSION = "0.1.0";

const MIN_CANDLES = 60;
const RULES = Object.freeze({
  range: "wyckoff.v1.trading-range",
  effortResult: "wyckoff.v1.effort-result",
  accumulation: "wyckoff.v1.accumulation",
  distribution: "wyckoff.v1.distribution",
  spring: "wyckoff.v1.spring-test",
  utad: "wyckoff.v1.utad-test",
  sos: "wyckoff.v1.sos-lps",
  sow: "wyckoff.v1.sow-lpsy",
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function idFor(prefix, ...parts) {
  return `${prefix}-${crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 18)}`;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = clamp(ratio) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0;
}

function trueRange(candle, previous) {
  if (!previous) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close),
  );
}

function enrichCandles(candles) {
  const ranges = candles.map((candle, index) => trueRange(candle, candles[index - 1]));
  return candles.map((candle, index) => {
    const atrWindow = ranges.slice(Math.max(0, index - 13), index + 1);
    const volumeWindow = candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume);
    const atr = Math.max(median(atrWindow), candle.close * 0.0001, Number.EPSILON);
    const baselineVolume = Math.max(median(volumeWindow), Number.EPSILON);
    const spread = Math.max(candle.high - candle.low, Number.EPSILON);
    const body = Math.abs(candle.close - candle.open);
    return Object.freeze({
      ...candle,
      index,
      atr,
      spread,
      relativeVolume: candle.volume / baselineVolume,
      spreadRatio: spread / atr,
      closeLocation: clamp((candle.close - candle.low) / spread),
      bodyRatio: body / spread,
      lowerWickRatio: (Math.min(candle.open, candle.close) - candle.low) / spread,
      upperWickRatio: (candle.high - Math.max(candle.open, candle.close)) / spread,
    });
  });
}

function touchClusters(candles, predicate, minimumGap) {
  const clusters = [];
  for (const candle of candles) {
    if (!predicate(candle)) continue;
    const previous = clusters.at(-1);
    if (!previous || candle.index - previous.at(-1).index >= minimumGap) clusters.push([candle]);
    else previous.push(candle);
  }
  return clusters;
}

function directionChanges(candles) {
  let previous = 0;
  let changes = 0;
  let comparable = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].close - candles[index - 1].close;
    const direction = Math.sign(delta);
    if (!direction) continue;
    if (previous) {
      comparable += 1;
      if (direction !== previous) changes += 1;
    }
    previous = direction;
  }
  return comparable ? changes / comparable : 0;
}

function trendBeforeRange(candles, startIndex, rangeHeight) {
  const prior = candles.slice(Math.max(0, startIndex - 36), startIndex + 1);
  const sample = prior.length >= 12 ? prior : candles.slice(startIndex, Math.min(candles.length, startIndex + 18));
  if (sample.length < 2) return 0;
  const first = average(sample.slice(0, Math.max(2, Math.floor(sample.length / 4))).map((item) => item.close));
  const last = average(sample.slice(-Math.max(2, Math.floor(sample.length / 4))).map((item) => item.close));
  return clamp((last - first) / Math.max(rangeHeight, Number.EPSILON), -2, 2);
}

function candidateWindowLengths(count) {
  return [...new Set([
    Math.min(180, count),
    Math.min(144, count),
    Math.min(120, count),
    Math.min(96, count),
    Math.min(72, count),
    Math.min(60, count),
  ].filter((value) => value >= MIN_CANDLES))];
}

function buildTradingRangeCandidates(candles, snapshotId) {
  const candidates = [];
  const endOffsets = [...new Set([0, candles.length >= 96 ? 6 : 0, candles.length >= 120 ? 12 : 0])];
  for (const endOffset of endOffsets) {
    const endIndex = candles.length - 1 - endOffset;
    for (const length of candidateWindowLengths(endIndex + 1)) {
      const startIndex = endIndex - length + 1;
      if (startIndex < 0) continue;
      const window = candles.slice(startIndex, endIndex + 1);
      const support = quantile(window.map((item) => item.low), 0.08);
      const resistance = quantile(window.map((item) => item.high), 0.92);
      const height = resistance - support;
      const atr = Math.max(median(window.map((item) => item.atr)), Number.EPSILON);
      const widthInAtr = height / atr;
      if (!Number.isFinite(widthInAtr) || widthInAtr < 3 || widthInAtr > 24) continue;
      const tolerance = Math.max(atr * 0.72, height * 0.045);
      const minimumGap = Math.max(3, Math.floor(length / 12));
      const supportClusters = touchClusters(window, (item) => item.low <= support + tolerance, minimumGap);
      const resistanceClusters = touchClusters(window, (item) => item.high >= resistance - tolerance, minimumGap);
      if (supportClusters.length < 2 || resistanceClusters.length < 2) continue;
      const containment = window.filter((item) => (
        item.low >= support - tolerance * 1.7 && item.high <= resistance + tolerance * 1.7
      )).length / window.length;
      const rotation = directionChanges(window);
      if (containment < 0.72 || rotation < 0.27) continue;
      const subsequent = candles.slice(endIndex + 1);
      const distantAfterRange = subsequent.some((item) => (
        item.close > resistance + height * 1.15 || item.close < support - height * 1.15
      ));
      if (distantAfterRange) continue;
      const recency = 1 - endOffset / Math.max(1, candles.length);
      const score = clamp(
        0.24 * clamp((supportClusters.length + resistanceClusters.length) / 8)
        + 0.26 * clamp((containment - 0.65) / 0.3)
        + 0.24 * clamp((rotation - 0.2) / 0.45)
        + 0.16 * clamp(1 - Math.abs(widthInAtr - 8) / 14)
        + 0.1 * recency,
      );
      candidates.push({
        id: idFor("wyckoff-range", snapshotId, startIndex, endIndex, support, resistance),
        startIndex,
        baseEndIndex: endIndex,
        endIndex: candles.length - 1,
        startTime: candles[startIndex].time,
        baseEndTime: candles[endIndex].time,
        endTime: candles.at(-1).time,
        support,
        resistance,
        height,
        atr,
        tolerance,
        containment,
        rotation,
        supportTouches: supportClusters.length,
        resistanceTouches: resistanceClusters.length,
        score,
        priorTrend: trendBeforeRange(candles, startIndex, height),
        evidenceId: idFor("wyckoff-range-evidence", snapshotId, startIndex, endIndex),
      });
    }
  }
  const deduplicated = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const duplicate = deduplicated.some((existing) => (
      Math.abs(existing.support - candidate.support) <= Math.max(existing.tolerance, candidate.tolerance)
      && Math.abs(existing.resistance - candidate.resistance) <= Math.max(existing.tolerance, candidate.tolerance)
      && Math.abs(existing.startIndex - candidate.startIndex) <= 12
    ));
    if (!duplicate) deduplicated.push(candidate);
    if (deduplicated.length >= 4) break;
  }
  return deduplicated;
}

function eventEvidence(candle, range, extra = {}) {
  return Object.freeze({
    candleIndex: candle.index,
    relativeVolume: candle.relativeVolume,
    spreadInAtr: candle.spreadRatio,
    closeLocation: candle.closeLocation,
    distanceFromSupportInAtr: (candle.low - range.support) / range.atr,
    distanceFromResistanceInAtr: (range.resistance - candle.high) / range.atr,
    ...extra,
  });
}

function makeEvent(snapshotId, pattern, code, candle, price, range, options = {}) {
  return Object.freeze({
    id: idFor("wyckoff-event", snapshotId, pattern, code, candle.index, price),
    code,
    label: options.label || code,
    pattern,
    time: candle.time,
    price,
    candleIndex: candle.index,
    phase: options.phase || "B",
    direction: options.direction || "neutral",
    status: options.status === "tentative" ? "tentative" : "confirmed",
    strength: clamp(Number(options.strength) || 0),
    ruleId: options.ruleId || RULES.effortResult,
    evidence: eventEvidence(candle, range, options.evidence),
  });
}

function bestBy(items, score) {
  return items.reduce((best, item) => (!best || score(item) > score(best) ? item : best), null);
}

function findAfter(candles, startIndex, predicate, maximumIndex = Number.POSITIVE_INFINITY) {
  return candles.find((item) => item.index > startIndex && item.index <= maximumIndex && predicate(item)) || null;
}

function lastAfter(candles, startIndex, predicate) {
  return candles.filter((item) => item.index > startIndex && predicate(item)).at(-1) || null;
}

function accumulationEvents(candles, range, snapshotId) {
  const window = candles.slice(range.startIndex, range.endIndex + 1);
  const earlyEnd = range.startIndex + Math.floor((range.baseEndIndex - range.startIndex + 1) * 0.62);
  const lowerEdge = window.filter((item) => item.index <= earlyEnd && item.low <= range.support + range.tolerance * 1.4);
  const sc = bestBy(lowerEdge, (item) => (
    item.relativeVolume * 0.42 + item.spreadRatio * 0.28 + item.closeLocation * 0.18 + item.lowerWickRatio * 0.12
  ));
  if (!sc) return [];
  const events = [];
  const psWindow = window.filter((item) => (
    item.index < sc.index
    && item.index >= sc.index - 18
    && item.close < item.open
    && item.relativeVolume >= 1.05
    && item.low <= range.support + range.tolerance * 3
  ));
  const ps = bestBy(psWindow, (item) => item.relativeVolume + item.spreadRatio * 0.4);
  if (ps) events.push(makeEvent(snapshotId, "accumulation", "PS", ps, ps.low, range, {
    label: "PS 初步支撑",
    phase: "A",
    direction: "bullish",
    strength: clamp((ps.relativeVolume - 0.8) / 1.4),
  }));
  events.push(makeEvent(snapshotId, "accumulation", "SC", sc, sc.low, range, {
    label: "SC 恐慌抛售",
    phase: "A",
    direction: "bullish",
    strength: clamp((sc.relativeVolume + sc.spreadRatio - 1.5) / 2.5),
    ruleId: RULES.accumulation,
  }));
  const ar = findAfter(window, sc.index, (item) => item.high >= range.resistance - range.tolerance * 1.25, sc.index + Math.max(12, Math.floor(window.length * 0.45)))
    || bestBy(window.filter((item) => item.index > sc.index && item.index <= sc.index + 30), (item) => item.high);
  if (!ar) return events;
  events.push(makeEvent(snapshotId, "accumulation", "AR", ar, ar.high, range, {
    label: "AR 自动反弹",
    phase: "A",
    direction: "bullish",
    strength: clamp((ar.high - sc.low) / Math.max(range.height, Number.EPSILON)),
    ruleId: RULES.accumulation,
  }));
  const stCandidates = window.filter((item) => (
    item.index >= ar.index + 3
    && item.low <= range.support + range.tolerance * 1.45
    && item.close >= range.support - range.tolerance * 0.75
  ));
  const st = bestBy(stCandidates, (item) => (
    1.4 - Math.min(1.4, item.relativeVolume) + item.closeLocation * 0.5 - Math.abs(item.low - range.support) / Math.max(range.tolerance, Number.EPSILON) * 0.15
  ));
  if (st) events.push(makeEvent(snapshotId, "accumulation", "ST", st, st.low, range, {
    label: "ST 二次测试",
    phase: "B",
    direction: "bullish",
    status: st.relativeVolume <= sc.relativeVolume * 1.1 ? "confirmed" : "tentative",
    strength: clamp(1 - st.relativeVolume / Math.max(sc.relativeVolume * 1.3, Number.EPSILON)),
    evidence: { comparedEvent: "SC", volumeContracted: st.relativeVolume < sc.relativeVolume },
    ruleId: RULES.accumulation,
  }));
  const terminalStart = st?.index ?? ar.index;
  const spring = lastAfter(window, terminalStart, (item) => (
    item.low < range.support - range.tolerance * 0.08
    && item.low > range.support - range.height * 0.22
    && item.close > range.support
    && item.lowerWickRatio >= 0.24
  ));
  if (spring) events.push(makeEvent(snapshotId, "accumulation", "Spring", spring, spring.low, range, {
    label: "Spring 假跌破",
    phase: "C",
    direction: "bullish",
    strength: clamp(spring.lowerWickRatio * 0.9 + spring.closeLocation * 0.45),
    evidence: { reclaimedSupport: true },
    ruleId: RULES.spring,
  }));
  const test = spring ? findAfter(window, spring.index, (item) => (
    item.low <= range.support + range.tolerance * 1.35
    && item.close >= range.support
    && item.relativeVolume <= spring.relativeVolume * 0.9
    && item.spreadRatio <= spring.spreadRatio * 1.05
  ), spring.index + 24) : null;
  if (test) events.push(makeEvent(snapshotId, "accumulation", "Test", test, test.low, range, {
    label: "Test 缩量确认",
    phase: "C",
    direction: "bullish",
    strength: clamp(1 - test.relativeVolume / Math.max(spring.relativeVolume, Number.EPSILON)),
    evidence: { comparedEvent: "Spring", volumeContracted: true, spreadContracted: test.spreadRatio < spring.spreadRatio },
    ruleId: RULES.spring,
  }));
  const sosStart = test?.index ?? spring?.index ?? terminalStart;
  const sos = findAfter(window, sosStart, (item) => (
    item.close > range.resistance + range.tolerance * 0.08
    && item.closeLocation >= 0.62
    && (item.relativeVolume >= 1.05 || item.spreadRatio >= 1.2)
  ));
  if (sos) events.push(makeEvent(snapshotId, "accumulation", "SOS", sos, sos.high, range, {
    label: "SOS 放量上破",
    phase: "D",
    direction: "bullish",
    strength: clamp((sos.relativeVolume + sos.spreadRatio - 1.6) / 2.2),
    evidence: { closedBeyondResistance: true },
    ruleId: RULES.sos,
  }));
  const lps = sos ? findAfter(window, sos.index, (item) => (
    item.low <= range.resistance + range.tolerance * 1.5
    && item.low >= range.resistance - range.tolerance * 1.7
    && item.close >= range.resistance - range.tolerance * 0.7
    && item.relativeVolume <= Math.max(1.15, sos.relativeVolume)
  )) : null;
  if (lps) events.push(makeEvent(snapshotId, "accumulation", "LPS", lps, lps.low, range, {
    label: "LPS 回踩支撑",
    phase: "D",
    direction: "bullish",
    strength: clamp(1 - lps.relativeVolume / Math.max(sos.relativeVolume * 1.2, Number.EPSILON)),
    evidence: { comparedEvent: "SOS", heldFormerResistance: true },
    ruleId: RULES.sos,
  }));
  return events.sort((a, b) => a.candleIndex - b.candleIndex);
}

function distributionEvents(candles, range, snapshotId) {
  const window = candles.slice(range.startIndex, range.endIndex + 1);
  const earlyEnd = range.startIndex + Math.floor((range.baseEndIndex - range.startIndex + 1) * 0.62);
  const upperEdge = window.filter((item) => item.index <= earlyEnd && item.high >= range.resistance - range.tolerance * 1.4);
  const bc = bestBy(upperEdge, (item) => (
    item.relativeVolume * 0.42 + item.spreadRatio * 0.28 + (1 - item.closeLocation) * 0.18 + item.upperWickRatio * 0.12
  ));
  if (!bc) return [];
  const events = [];
  const psyWindow = window.filter((item) => (
    item.index < bc.index
    && item.index >= bc.index - 18
    && item.close > item.open
    && item.relativeVolume >= 1.05
    && item.high >= range.resistance - range.tolerance * 3
  ));
  const psy = bestBy(psyWindow, (item) => item.relativeVolume + item.spreadRatio * 0.4);
  if (psy) events.push(makeEvent(snapshotId, "distribution", "PSY", psy, psy.high, range, {
    label: "PSY 初步供应",
    phase: "A",
    direction: "bearish",
    strength: clamp((psy.relativeVolume - 0.8) / 1.4),
  }));
  events.push(makeEvent(snapshotId, "distribution", "BC", bc, bc.high, range, {
    label: "BC 抢购高潮",
    phase: "A",
    direction: "bearish",
    strength: clamp((bc.relativeVolume + bc.spreadRatio - 1.5) / 2.5),
    ruleId: RULES.distribution,
  }));
  const ar = findAfter(window, bc.index, (item) => item.low <= range.support + range.tolerance * 1.25, bc.index + Math.max(12, Math.floor(window.length * 0.45)))
    || bestBy(window.filter((item) => item.index > bc.index && item.index <= bc.index + 30), (item) => -item.low);
  if (!ar) return events;
  events.push(makeEvent(snapshotId, "distribution", "AR", ar, ar.low, range, {
    label: "AR 自动回落",
    phase: "A",
    direction: "bearish",
    strength: clamp((bc.high - ar.low) / Math.max(range.height, Number.EPSILON)),
    ruleId: RULES.distribution,
  }));
  const stCandidates = window.filter((item) => (
    item.index >= ar.index + 3
    && item.high >= range.resistance - range.tolerance * 1.45
    && item.close <= range.resistance + range.tolerance * 0.75
  ));
  const st = bestBy(stCandidates, (item) => (
    1.4 - Math.min(1.4, item.relativeVolume) + (1 - item.closeLocation) * 0.5 - Math.abs(item.high - range.resistance) / Math.max(range.tolerance, Number.EPSILON) * 0.15
  ));
  if (st) events.push(makeEvent(snapshotId, "distribution", "ST", st, st.high, range, {
    label: "ST 二次测试",
    phase: "B",
    direction: "bearish",
    status: st.relativeVolume <= bc.relativeVolume * 1.1 ? "confirmed" : "tentative",
    strength: clamp(1 - st.relativeVolume / Math.max(bc.relativeVolume * 1.3, Number.EPSILON)),
    evidence: { comparedEvent: "BC", volumeContracted: st.relativeVolume < bc.relativeVolume },
    ruleId: RULES.distribution,
  }));
  const terminalStart = st?.index ?? ar.index;
  const utad = lastAfter(window, terminalStart, (item) => (
    item.high > range.resistance + range.tolerance * 0.08
    && item.high < range.resistance + range.height * 0.22
    && item.close < range.resistance
    && item.upperWickRatio >= 0.24
  ));
  if (utad) events.push(makeEvent(snapshotId, "distribution", "UTAD", utad, utad.high, range, {
    label: "UTAD 假上破",
    phase: "C",
    direction: "bearish",
    strength: clamp(utad.upperWickRatio * 0.9 + (1 - utad.closeLocation) * 0.45),
    evidence: { rejectedResistance: true },
    ruleId: RULES.utad,
  }));
  const test = utad ? findAfter(window, utad.index, (item) => (
    item.high >= range.resistance - range.tolerance * 1.35
    && item.close <= range.resistance
    && item.relativeVolume <= utad.relativeVolume * 0.9
    && item.spreadRatio <= utad.spreadRatio * 1.05
  ), utad.index + 24) : null;
  if (test) events.push(makeEvent(snapshotId, "distribution", "Test", test, test.high, range, {
    label: "Test 缩量确认",
    phase: "C",
    direction: "bearish",
    strength: clamp(1 - test.relativeVolume / Math.max(utad.relativeVolume, Number.EPSILON)),
    evidence: { comparedEvent: "UTAD", volumeContracted: true, spreadContracted: test.spreadRatio < utad.spreadRatio },
    ruleId: RULES.utad,
  }));
  const sowStart = test?.index ?? utad?.index ?? terminalStart;
  const sow = findAfter(window, sowStart, (item) => (
    item.close < range.support - range.tolerance * 0.08
    && item.closeLocation <= 0.38
    && (item.relativeVolume >= 1.05 || item.spreadRatio >= 1.2)
  ));
  if (sow) events.push(makeEvent(snapshotId, "distribution", "SOW", sow, sow.low, range, {
    label: "SOW 放量下破",
    phase: "D",
    direction: "bearish",
    strength: clamp((sow.relativeVolume + sow.spreadRatio - 1.6) / 2.2),
    evidence: { closedBeyondSupport: true },
    ruleId: RULES.sow,
  }));
  const lpsy = sow ? findAfter(window, sow.index, (item) => (
    item.high >= range.support - range.tolerance * 1.5
    && item.high <= range.support + range.tolerance * 1.7
    && item.close <= range.support + range.tolerance * 0.7
    && item.relativeVolume <= Math.max(1.15, sow.relativeVolume)
  )) : null;
  if (lpsy) events.push(makeEvent(snapshotId, "distribution", "LPSY", lpsy, lpsy.high, range, {
    label: "LPSY 反抽受压",
    phase: "D",
    direction: "bearish",
    strength: clamp(1 - lpsy.relativeVolume / Math.max(sow.relativeVolume * 1.2, Number.EPSILON)),
    evidence: { comparedEvent: "SOW", rejectedFormerSupport: true },
    ruleId: RULES.sow,
  }));
  return events.sort((a, b) => a.candleIndex - b.candleIndex);
}

function phaseBoundaries(pattern, events, range, candles) {
  const event = (code) => events.find((item) => item.code === code);
  const st = event("ST");
  const terminal = pattern === "accumulation" ? event("Spring") : event("UTAD");
  const test = event("Test");
  const sign = pattern === "accumulation" ? event("SOS") : event("SOW");
  const lastPoint = pattern === "accumulation" ? event("LPS") : event("LPSY");
  const startA = events[0]?.candleIndex ?? range.startIndex;
  const endA = Math.max(startA, st?.candleIndex ?? Math.min(range.endIndex, startA + Math.floor((range.endIndex - startA) * 0.28)));
  const endB = Math.max(endA, terminal?.candleIndex ?? Math.min(range.endIndex, endA + Math.floor((range.endIndex - endA) * 0.42)));
  const endC = Math.max(endB, test?.candleIndex ?? terminal?.candleIndex ?? endB);
  const endD = Math.max(endC, lastPoint?.candleIndex ?? sign?.candleIndex ?? endC);
  const accepted = pattern === "accumulation"
    ? candles.slice(-3).filter((item) => item.close > range.resistance + range.tolerance * 0.2).length >= 2
    : candles.slice(-3).filter((item) => item.close < range.support - range.tolerance * 0.2).length >= 2;
  const definitions = [
    ["A", startA, endA, true],
    ["B", endA, endB, Boolean(st)],
    ["C", endB, endC, Boolean(terminal)],
    ["D", endC, endD, Boolean(sign)],
    ["E", endD, range.endIndex, accepted],
  ];
  return definitions
    .filter(([, start, end], index) => index < 2 || end > start || index === 4)
    .map(([code, start, end, confirmed]) => Object.freeze({
      id: idFor("wyckoff-phase", range.id, pattern, code, start, end),
      code,
      startIndex: Number(start),
      endIndex: Number(end),
      startTime: candles[Number(start)]?.time ?? range.startTime,
      endTime: candles[Number(end)]?.time ?? range.endTime,
      status: confirmed ? "confirmed" : "tentative",
    }));
}

function buildStructure(snapshot, candles, range, pattern) {
  const events = pattern === "accumulation"
    ? accumulationEvents(candles, range, snapshot.snapshotId)
    : distributionEvents(candles, range, snapshot.snapshotId);
  const eventCodes = new Set(events.map((item) => item.code));
  const terminalCode = pattern === "accumulation" ? "Spring" : "UTAD";
  const signCode = pattern === "accumulation" ? "SOS" : "SOW";
  const lastPointCode = pattern === "accumulation" ? "LPS" : "LPSY";
  const phaseScore = (
    Number(eventCodes.has("ST")) * 0.16
    + Number(eventCodes.has(terminalCode)) * 0.19
    + Number(eventCodes.has("Test")) * 0.11
    + Number(eventCodes.has(signCode)) * 0.23
    + Number(eventCodes.has(lastPointCode)) * 0.1
  );
  const priorFit = pattern === "accumulation"
    ? clamp((-range.priorTrend + 0.35) / 1.7)
    : clamp((range.priorTrend + 0.35) / 1.7);
  const directionalEvents = events.filter((item) => item.direction === (pattern === "accumulation" ? "bullish" : "bearish"));
  const effortScore = average(directionalEvents.map((item) => item.strength));
  const score = clamp(range.score * 0.47 + priorFit * 0.18 + phaseScore + effortScore * 0.12);
  const status = eventCodes.has(signCode) && eventCodes.has("ST") ? "confirmed" : "tentative";
  const phases = phaseBoundaries(pattern, events, range, candles);
  return Object.freeze({
    id: idFor("wyckoff-structure", snapshot.snapshotId, range.id, pattern, ...events.map((item) => item.id)),
    pattern,
    label: pattern === "accumulation" ? "吸筹候选" : "派发候选",
    direction: pattern === "accumulation" ? "bullish" : "bearish",
    status,
    score,
    range: Object.freeze({
      id: range.id,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      startTime: range.startTime,
      endTime: range.endTime,
      support: range.support,
      resistance: range.resistance,
      height: range.height,
      atr: range.atr,
      tolerance: range.tolerance,
      containment: range.containment,
      rotation: range.rotation,
      supportTouches: range.supportTouches,
      resistanceTouches: range.resistanceTouches,
      priorTrend: range.priorTrend,
      evidenceId: range.evidenceId,
    }),
    phases: Object.freeze(phases),
    events: Object.freeze(events),
    confirmationPrice: pattern === "accumulation"
      ? range.resistance + range.tolerance * 0.15
      : range.support - range.tolerance * 0.15,
    invalidationPrice: pattern === "accumulation"
      ? range.support - range.tolerance * 1.35
      : range.resistance + range.tolerance * 1.35,
    targetPrice: pattern === "accumulation"
      ? range.resistance + range.height
      : Math.max(Number.EPSILON, range.support - range.height),
    rules: Object.freeze({
      rangeRuleId: RULES.range,
      patternRuleId: pattern === "accumulation" ? RULES.accumulation : RULES.distribution,
      rangeConfirmed: range.supportTouches >= 2 && range.resistanceTouches >= 2 && range.containment >= 0.72,
      stoppingActionObserved: eventCodes.has(pattern === "accumulation" ? "SC" : "BC"),
      secondaryTestObserved: eventCodes.has("ST"),
      terminalTestObserved: eventCodes.has(terminalCode) && eventCodes.has("Test"),
      signOfStrengthOrWeaknessObserved: eventCodes.has(signCode),
      lastPointObserved: eventCodes.has(lastPointCode),
    }),
    evidenceIds: Object.freeze([range.evidenceId, ...events.map((item) => item.id)]),
  });
}

function candidateDiversity(candidates) {
  const selected = [];
  for (const candidate of candidates) {
    if (!selected.some((item) => item.pattern === candidate.pattern && item.range.id === candidate.range.id)) {
      selected.push(candidate);
    }
    if (selected.length >= 6) break;
  }
  return selected;
}

export function runWyckoffTheoryEngine(snapshot) {
  const rawCandles = Array.isArray(snapshot?.candles) ? snapshot.candles : [];
  if (rawCandles.length < MIN_CANDLES) {
    return Object.freeze({
      schemaVersion: 1,
      resultId: idFor("wyckoff-result", snapshot?.snapshotId, WYCKOFF_ENGINE_VERSION, "insufficient"),
      engineId: WYCKOFF_ENGINE_ID,
      engineVersion: WYCKOFF_ENGINE_VERSION,
      snapshotId: String(snapshot?.snapshotId || ""),
      status: "insufficient_data",
      missingData: Object.freeze([`至少需要 ${MIN_CANDLES} 根 OHLCV K 线`]),
      structures: Object.freeze({ candidates: Object.freeze([]), primaryCandidate: null }),
      signals: Object.freeze([]),
      evidence: Object.freeze([]),
      invalidations: Object.freeze([]),
      confidence: Object.freeze({ score: 0, basis: "insufficient_data" }),
      statistics: Object.freeze({ rangeCount: 0, candidateCount: 0, eventCount: 0 }),
    });
  }
  const candles = enrichCandles(rawCandles);
  const ranges = buildTradingRangeCandidates(candles, snapshot.snapshotId);
  const structures = candidateDiversity(ranges.flatMap((range) => [
    buildStructure(snapshot, candles, range, "accumulation"),
    buildStructure(snapshot, candles, range, "distribution"),
  ]).sort((a, b) => b.score - a.score));
  const primaryCandidate = structures[0] || null;
  if (!primaryCandidate) {
    return Object.freeze({
      schemaVersion: 1,
      resultId: idFor("wyckoff-result", snapshot.snapshotId, WYCKOFF_ENGINE_VERSION, "no-range"),
      engineId: WYCKOFF_ENGINE_ID,
      engineVersion: WYCKOFF_ENGINE_VERSION,
      snapshotId: snapshot.snapshotId,
      status: "insufficient_data",
      missingData: Object.freeze(["当前窗口未形成至少两次上下沿测试且价格旋转充分的交易区间"]),
      structures: Object.freeze({ candidates: Object.freeze([]), primaryCandidate: null }),
      signals: Object.freeze([]),
      evidence: Object.freeze([]),
      invalidations: Object.freeze([]),
      confidence: Object.freeze({ score: 0, basis: "no_confirmed_trading_range" }),
      statistics: Object.freeze({ rangeCount: 0, candidateCount: 0, eventCount: 0 }),
    });
  }
  const evidence = structures.flatMap((structure) => [
    Object.freeze({
      id: structure.range.evidenceId,
      type: "trading_range",
      ruleId: RULES.range,
      startTime: structure.range.startTime,
      endTime: structure.range.endTime,
      support: structure.range.support,
      resistance: structure.range.resistance,
      containment: structure.range.containment,
      rotation: structure.range.rotation,
    }),
    ...structure.events.map((event) => Object.freeze({
      id: event.id,
      type: "wyckoff_event",
      ruleId: event.ruleId,
      code: event.code,
      time: event.time,
      price: event.price,
      evidence: event.evidence,
    })),
  ]);
  return Object.freeze({
    schemaVersion: 1,
    resultId: idFor("wyckoff-result", snapshot.snapshotId, WYCKOFF_ENGINE_VERSION, ...structures.map((item) => item.id)),
    engineId: WYCKOFF_ENGINE_ID,
    engineVersion: WYCKOFF_ENGINE_VERSION,
    snapshotId: snapshot.snapshotId,
    status: "succeeded",
    missingData: Object.freeze([]),
    structures: Object.freeze({
      candidates: Object.freeze(structures),
      primaryCandidate,
    }),
    signals: Object.freeze(structures.map((structure) => Object.freeze({
      signalId: idFor("wyckoff-signal", snapshot.snapshotId, structure.id),
      structureId: structure.id,
      direction: structure.direction,
      status: structure.status,
      strength: structure.score,
      confirmationPrice: structure.confirmationPrice,
      invalidationPrice: structure.invalidationPrice,
      evidenceIds: structure.evidenceIds,
    }))),
    evidence: Object.freeze(evidence),
    invalidations: Object.freeze(structures.map((structure) => Object.freeze({
      structureId: structure.id,
      price: structure.invalidationPrice,
      condition: structure.pattern === "accumulation"
        ? "当前周期收盘有效跌破区间下沿与容差"
        : "当前周期收盘有效站上区间上沿与容差",
    }))),
    confidence: Object.freeze({
      score: primaryCandidate.score,
      basis: "range_rotation_volume_price_events",
    }),
    statistics: Object.freeze({
      rangeCount: ranges.length,
      candidateCount: structures.length,
      eventCount: structures.reduce((total, item) => total + item.events.length, 0),
      primaryPattern: primaryCandidate.pattern,
      primaryPhase: primaryCandidate.phases.filter((phase) => phase.status === "confirmed").at(-1)?.code || "B",
    }),
  });
}
