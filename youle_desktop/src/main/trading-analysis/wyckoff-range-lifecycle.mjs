import crypto from "node:crypto";

// Formation is evaluated on prefixes only. Breakout/retest candles never feed
// back into the frozen range's prices, volume baseline, tolerance or identity.
const MIN_BARS = 60;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const id = (...parts) => crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 18);
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function quantile(values, q) {
  const xs = [...values].sort((a, b) => a - b), p = (xs.length - 1) * q, i = Math.floor(p);
  return xs[i] + (xs[Math.ceil(p)] - xs[i]) * (p - i);
}
function clusters(rows, predicate, gap) {
  const result = [];
  for (const row of rows) if (predicate(row)) {
    const last = result.at(-1);
    if (!last || row.index - last.at(-1).index >= gap) result.push([row]);
    else last.push(row);
  }
  return result;
}
export function wyckoffBarClosed(snapshot, candle, index) {
  if (candle.closed === false) return false;
  const now = Number(snapshot.snapshotTime ?? snapshot.fetchedAt);
  if (!Number.isFinite(now)) return candle.closed !== false;
  const interval = String(snapshot.interval || "60");
  const seconds = interval === "1D" ? 86400 : interval === "1W" ? 604800 : Number(interval) * 60;
  const close = snapshot.sessionCloseTimes?.[index]
    ?? ((Number(candle.closeTime) > 1e12 ? Number(candle.closeTime) / 1000 : Number(candle.closeTime))
    || candle.time + seconds);
  return Number.isFinite(close) && close * 1000 <= now;
}

function formation(candles, end, length, snapshot) {
  const start = end - length + 1, rows = candles.slice(start, end + 1);
  const support = quantile(rows.map(c => c.low), .08), resistance = quantile(rows.map(c => c.high), .92);
  const height = resistance - support, atr = quantile(rows.map(c => c.atr), .5), width = height / atr;
  if (!Number.isFinite(width) || width < 3 || width > 24) return null;
  const tolerance = Math.max(atr * .72, height * .045), gap = Math.max(3, Math.floor(length / 12));
  const lower = clusters(rows, c => c.low <= support + tolerance, gap);
  const upper = clusters(rows, c => c.high >= resistance - tolerance, gap);
  if (lower.length < 2 || upper.length < 2) return null;
  const containment = rows.filter(c => c.low >= support - tolerance * 1.7 && c.high <= resistance + tolerance * 1.7).length / length;
  let lastDirection = 0, changes = 0, comparable = 0, lastEdge = 0, rotations = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i) {
      const direction = Math.sign(rows[i].close - rows[i - 1].close);
      if (direction && lastDirection) { comparable++; if (direction !== lastDirection) changes++; }
      if (direction) lastDirection = direction;
    }
    const low = rows[i].low <= support + tolerance, high = rows[i].high >= resistance - tolerance;
    const edge = low === high ? 0 : low ? -1 : 1;
    if (edge) { if (lastEdge && edge !== lastEdge) rotations++; lastEdge = edge; }
  }
  const rotation = comparable ? changes / comparable : 0;
  // Require actual visits to both boundaries. Counting changes between every
  // pair of closes rejects smooth, slower rotations while rewarding tiny
  // alternating ticks in a trend. Keep that statistic for scoring only.
  if (containment < .72 || rotations < 2) return null;
  const prior = candles.slice(Math.max(0, start - 36), start + 1);
  const sample = prior.length >= 12 ? prior : rows.slice(0, 18), quarter = Math.max(2, Math.floor(sample.length / 4));
  const priorTrend = clamp((mean(sample.slice(-quarter).map(c => c.close)) - mean(sample.slice(0, quarter).map(c => c.close))) / height, -2, 2);
  const identity = id(snapshot.marketId, snapshot.interval, rows[0].time, rows.at(-1).time, support, resistance);
  return {
    id: `wyckoff-range-${identity}`, evidenceId: `wyckoff-range-evidence-${identity}`,
    startIndex: start, baseEndIndex: end, endIndex: candles.length - 1,
    startTime: rows[0].time, baseEndTime: rows.at(-1).time, endTime: candles.at(-1).time,
    support, resistance, height, atr, tolerance, containment, rotation, edgeRotations: rotations,
    supportTouches: lower.length, resistanceTouches: upper.length, priorTrend,
    score: clamp(.24 * clamp((lower.length + upper.length) / 8) + .26 * clamp((containment - .65) / .3)
      + .24 * clamp((rotation - .2) / .45) + .16 * clamp(1 - Math.abs(width - 8) / 14) + .1),
  };
}

function signOfBreak(candle, range, sign) {
  const edge = sign > 0 ? range.resistance : range.support;
  return sign * (candle.close - edge) > range.tolerance * .08
    && (sign > 0 ? candle.closeLocation : 1 - candle.closeLocation) >= .62
    && (candle.relativeVolume >= 1.05 || candle.spreadRatio >= 1.2);
}

function track(candles, range, sign) {
  const edge = sign > 0 ? range.resistance : range.support, episodes = [];
  let active = null, armed = true;
  for (const c of candles.slice(range.baseEndIndex + 1)) {
    const extreme = sign > 0 ? c.low : c.high;
    if (active && c.closed && (sign * (c.close - edge) < -.7 * range.tolerance
      || sign * (extreme - edge) <= -2.05 * range.tolerance)) {
      active.invalidatedAt = c.index;
      active = null;
      armed = sign * (c.close - edge) <= range.tolerance * .08;
      continue; // A failed candle cannot also confirm a fresh breakout/retest.
    }
    if (!active) {
      if (sign * (c.close - edge) <= range.tolerance * .08) armed = true;
      if (armed && signOfBreak(c, range, sign)) {
        const episode = {breakout: c.index, confirmed: c.closed, retests: [], invalidatedAt: null};
        episodes.push(episode);
        if (c.closed) { active = episode; armed = false; }
      }
      continue;
    }
    const distance = sign * (extreme - edge);
    if (distance < -1.7 * range.tolerance || distance > 1.5 * range.tolerance
      || sign * (c.close - edge) < -.7 * range.tolerance) continue;
    const breakout = candles[active.breakout];
    // Record an observable test even before volume/close confirms LPS/LPSY.
    // Keep the first test in each visit and a later confirmed test, not one
    // label per candle during an extended visit at the boundary.
    const confirmed = c.closed && c.relativeVolume <= Math.max(1.15, breakout.relativeVolume);
    const previous = active.retests.at(-1);
    if (!previous || c.index - previous.index >= 3 || (!previous.confirmed && confirmed) || !c.closed)
      active.retests.push({index: c.index, confirmed});
  }
  return episodes;
}

function relevance(range, candles) {
  const latest = candles.at(-1), count = candles.length;
  let best = range.frozen ? 0 : .25;
  for (const sign of [1, -1]) {
    const episode = range.lifecycle[sign > 0 ? "bullish" : "bearish"].at(-1);
    if (!episode) continue;
    const last = episode.retests.at(-1)?.index ?? episode.breakout;
    const recency = 1 - (count - 1 - last) / count;
    const edge = sign > 0 ? range.resistance : range.support;
    const proximity = clamp(1 - Math.abs(latest.close - edge) / Math.max(range.height, range.tolerance));
    const departure = Math.abs(latest.close - edge) / Math.max(range.height, range.tolerance);
    // Keep old evidence, but don't let a distant completed move outrank a
    // currently relevant box. This affects display ranking, never confirmation.
    best = Math.max(best, (episode.invalidatedAt === null ? 2 : .1)
      + recency * .2 + proximity * .4 - Math.max(0, departure - 1));
  }
  return best + range.score * .4 + Math.min(180, range.baseEndIndex - range.startIndex + 1) / 180 * .12;
}

export function buildWyckoffRanges(candles, snapshot) {
  const closedEnd = candles.findLastIndex(c => c.closed), frozen = [], current = [];
  const lengths = count => [...new Set([180,144,120,96,72,60].map(n => Math.min(n,count)).filter(n => n >= MIN_BARS))];
  for (let end = MIN_BARS - 1; end <= closedEnd; end++) {
    const next = candles[end + 1];
    for (const length of lengths(end + 1)) {
      const range = formation(candles, end, length, snapshot);
      if (!range) continue;
      if (end === closedEnd) current.push({...range, frozen:false});
      if (!next || ![1,-1].some(sign => signOfBreak(next, range, sign)
        && sign * (candles[end].close - (sign > 0 ? range.resistance : range.support)) <= range.tolerance * .08)) continue;
      // De-duplicate chronologically: the earliest proven boundary wins;
      // later prices cannot replace it with a range inflated by the breakout.
      if (frozen.some(r => Math.abs(r.support-range.support)<=Math.min(r.tolerance,range.tolerance)
        && Math.abs(r.resistance-range.resistance)<=Math.min(r.tolerance,range.tolerance)
        && Math.max(r.startIndex,range.startIndex)<=Math.min(r.baseEndIndex,range.baseEndIndex))) continue;
      frozen.push({...range, frozen:true});
    }
  }
  const candidates = [...frozen, ...current].map(range => {
    range.lifecycle = {bullish:track(candles,range,1),bearish:track(candles,range,-1)};
    range.relevance = relevance(range,candles);
    return range;
  }).sort((a,b) => b.relevance-a.relevance || a.baseEndIndex-b.baseEndIndex || b.score-a.score);
  const chosen=[];
  for(const range of candidates) {
    if(chosen.some(r=>Math.abs(r.support-range.support)<=Math.max(r.tolerance,range.tolerance)
      && Math.abs(r.resistance-range.resistance)<=Math.max(r.tolerance,range.tolerance)))continue;
    chosen.push(range);
    if(chosen.length===4)break;
  }
  return chosen;
}

export function wyckoffLifecycleEvents(candles, range, pattern, makeEvent, snapshotId) {
  const long = pattern === "accumulation", episodes = range.lifecycle[long ? "bullish" : "bearish"];
  const signCode=long?"SOS":"SOW",testCode=long?"LPS":"LPSY",events=[];
  // Bound history, but keep the latest episode and its exact invalidation.
  for(const episode of episodes.slice(-3)) {
    const status=episode.invalidatedAt!==null?"invalidated":episode.confirmed?"confirmed":"tentative";
    const c=candles[episode.breakout];
    const breakout=makeEvent(snapshotId,pattern,signCode,c,long?c.high:c.low,range,{
      phase:"D",direction:long?"bullish":"bearish",status,strength:clamp((c.relativeVolume+c.spreadRatio-1.6)/2.2),
      ruleId:long?"wyckoff.v2.sos-lps":"wyckoff.v2.sow-lpsy",
      evidence:{[long?"closedBeyondResistance":"closedBeyondSupport"]:episode.confirmed,baseEndTime:range.baseEndTime,
        invalidatedAt:episode.invalidatedAt===null?null:candles[episode.invalidatedAt].time},
    });
    events.push({...breakout,id:`wyckoff-event-${id(range.id,signCode,c.time)}`});
    for(const retest of episode.retests.slice(-2)) {
      const row=candles[retest.index];
      const excursion=candles.slice(episode.breakout,retest.index+1).reduce((best,item)=>
        (long?item.high>best.high:item.low<best.low)?item:best,c);
      const event=makeEvent(snapshotId,pattern,testCode,row,long?row.low:row.high,range,{
        phase:"D",direction:long?"bullish":"bearish",
        status:status==="invalidated"?"invalidated":retest.confirmed?"confirmed":"tentative",
        strength:clamp(1-row.relativeVolume/Math.max(c.relativeVolume*1.2,Number.EPSILON)),
        ruleId:long?"wyckoff.v2.sos-lps":"wyckoff.v2.sow-lpsy",
        evidence:{comparedEvent:signCode,breakoutTime:c.time,excursionTime:excursion.time,
          excursionPrice:long?excursion.high:excursion.low,closed:row.closed,volumeContracted:row.relativeVolume<=Math.max(1.15,c.relativeVolume),
          [long?"heldFormerResistance":"rejectedFormerSupport"]:retest.confirmed,baseEndTime:range.baseEndTime},
      });
      events.push({...event,id:`wyckoff-event-${id(range.id,testCode,row.time,c.time)}`});
    }
  }
  return events;
}
