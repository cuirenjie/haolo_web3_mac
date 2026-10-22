import {
  harmonicCandidateScore,
  harmonicConfirmation,
  harmonicDevelopingScore,
  harmonicId,
  harmonicLegsIntact,
  harmonicPointRecords,
  harmonicProjectedProgress,
  harmonicRangeMatches,
  harmonicRangeScore,
  harmonicRecency,
  harmonicRound,
  harmonicSubengineResult,
} from "./harmonic-subengine-common.mjs";

export const HARMONIC_SHARK_SUBENGINE_ID = "harmonic-shark-0xabc";
export const HARMONIC_SHARK_SUBENGINE_VERSION = "2.0.0";

const LABELS = Object.freeze(["0", "X", "A", "B", "C"]);
// Carney's 0-X-A-B-C convention measures the completion from B toward 0.
// Intersect the two hard completion bands; no tolerance or ATR may exceed them.
export function sharkCompletionZone(points) {
  const [origin, , a, b] = points;
  const ob = Math.abs(b.price-origin.price), ab = Math.abs(b.price-a.price);
  if (!(ob > 0 && ab > 0)) return null;
  const sign = Math.sign(origin.price-b.price);
  const minimum = Math.max(.886*ob, 1.618*ab);
  const maximum = Math.min(1.13*ob, 2.24*ab);
  if (minimum > maximum) return null;
  const near = b.price+sign*minimum, far = b.price+sign*maximum;
  return Object.freeze({low:harmonicRound(Math.min(near,far)),high:harmonicRound(Math.max(near,far)),
    convergenceWidthXa:harmonicRound((maximum-minimum)/ob),
    levels:Object.freeze({obMinimum:harmonicRound(b.price+sign*.886*ob),
      obLimit:harmonicRound(b.price+sign*1.13*ob),
      bcMinimum:harmonicRound(b.price+sign*1.618*ab),bcLimit:harmonicRound(b.price+sign*2.24*ab)}),
    components:Object.freeze(["BC/0B 0.886–1.13", "BC/AB 1.618–2.24"])});
}

function geometryMatches(points, direction) {
  if (!Array.isArray(points) || points.length !== 5) return false;
  const expected = direction === "bullish"
    ? ["low", "high", "low", "high", "low"]
    : ["high", "low", "high", "low", "high"];
  if (points.some((point, index) => point.type !== expected[index])) return false;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return false;
  const [origin, x, a, b, c] = points;
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(a.price, origin.price, x.price)) return false;
  if (direction === "bullish") return b.price > x.price && c.price < a.price && c.price < x.price;
  return b.price < x.price && c.price > a.price && c.price > x.price;
}

function ratiosFor(points) {
  const [origin, x, a, b, c] = points;
  const ob = Math.abs(b.price - origin.price);
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  if ([ob, xa, ab, bc].some((value) => value <= Number.EPSILON)) return null;
  return Object.freeze({
    abXa: harmonicRound(ab / xa),
    bcAb: harmonicRound(bc / ab),
    cOb: harmonicRound(bc / ob),
  });
}

export function evaluateSharkCandidate(snapshot, inputPoints, {
  atr = 0,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  const points = inputPoints.map((point) => ({ ...point }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  if (!geometryMatches(points, direction) || !harmonicLegsIntact(snapshot, points)) return null;
  const ratios = ratiosFor(points);
  if (!ratios
    || !harmonicRangeMatches(ratios.abXa, 1.13, 1.618)
    || !harmonicRangeMatches(ratios.bcAb, 1.618, 2.24)) return null;
  if (!harmonicRangeMatches(ratios.cOb, .886, 1.13)) return null;
  const [origin, , , b, c] = points;
  const ob = Math.abs(b.price-origin.price);
  const prz = sharkCompletionZone(points);
  if (!prz || c.price < prz.low || c.price > prz.high) return null;
  const targets = [
    c.price + (b.price - c.price) * 0.5,
    c.price + (b.price - c.price) * 0.618,
  ];
  const confirmation = harmonicConfirmation(snapshot, c, prz, {
    atr,
    scale: ob,
    direction,
    stopBoundary: c.price,
    stopLimit: direction === "bullish" ? prz.low : prz.high,
    targets,
  });
  if (confirmation.invalidated) return null;
  const labelledPoints = harmonicPointRecords(points, LABELS);
  const ruleIds = Object.freeze(["HARMONIC-SHARK-IMPULSE", "HARMONIC-SHARK-PRZ", "HARMONIC-SHARK-ACTIVE-MANAGEMENT"]);
  const evidenceIds = Object.freeze([...ruleIds, ...labelledPoints.map((point) => point.id)]);
  const score = harmonicCandidateScore([
    harmonicRangeScore(ratios.abXa, 1.13, 1.618, 1.27),
    harmonicRangeScore(ratios.bcAb, 1.618, 2.24, 2),
    harmonicRangeScore(ratios.cOb, .886, 1.13, .886),
  ], prz.convergenceWidthXa, 0.1, harmonicRecency(snapshot, c.index));
  return Object.freeze({
    id: harmonicId("harmonic", snapshot.snapshotId, "shark", direction, ...points.map((point) => point.index)),
    patternId: "shark",
    patternName: "Shark",
    topologyId: "shark-0xabc",
    stage: "completed-pattern",
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    terminalLabel: "C",
    direction,
    status: confirmation.status,
    tradeState: confirmation.tradeState,
    score,
    points: labelledPoints,
    ratios,
    measurements: Object.freeze([
      Object.freeze({ label: "AB/XA", value: ratios.abXa }),
      Object.freeze({ label: "BC/AB", value: ratios.bcAb }),
      Object.freeze({ label: "BC/0B", value: ratios.cOb }),
    ]),
    prz,
    terminalBar: confirmation.terminalBar,
    confirmation: confirmation.confirmation,
    actionLevels: Object.freeze({
      trigger: confirmation.confirmation?.trigger ?? harmonicRound(direction === "bullish"
        ? confirmation.terminalBar.high
        : confirmation.terminalBar.low),
      stop: confirmation.stop,
      targets: confirmation.targets,
      targetBasis: "C→B 50%/61.8% active-management retracement",
    }),
    ruleIds,
    evidenceIds,
  });
}

export function evaluateSharkDevelopingCandidate(snapshot, inputPoints, {
  atr = 0,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length !== 4 || !harmonicLegsIntact(snapshot, inputPoints)) return null;
  const points = inputPoints.map((point) => ({ ...point }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  const expected = direction === "bullish"
    ? ["low", "high", "low", "high"]
    : ["high", "low", "high", "low"];
  if (points.some((point, index) => point.type !== expected[index])) return null;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return null;
  const [origin, x, a, b] = points;
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(a.price, origin.price, x.price)) return null;
  if (direction === "bullish" ? b.price <= x.price : b.price >= x.price) return null;
  const ob = Math.abs(b.price - origin.price);
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  if ([ob, xa, ab].some((value) => value <= Number.EPSILON)) return null;
  const abXa = harmonicRound(ab / xa);
  if (!harmonicRangeMatches(abXa, 1.13, 1.618)) return null;
  const prz = sharkCompletionZone(points);
  if (!prz) return null;
  const projectedPrice = (prz.low+prz.high)/2;
  const progress = harmonicProjectedProgress(snapshot, b, projectedPrice, prz);
  if (!progress) return null;
  const labelledPoints = harmonicPointRecords(points, ["0", "X", "A", "B"]);
  const ruleIds = Object.freeze([
    "HARMONIC-SHARK-IMPULSE",
    "HARMONIC-SHARK-PRZ",
    "HARMONIC-DEVELOPING-PROJECTION",
  ]);
  const evidenceIds = Object.freeze([...ruleIds, ...labelledPoints.map((point) => point.id)]);
  return Object.freeze({
    id: harmonicId("harmonic-developing", snapshot.snapshotId, "shark", direction, ...points.map((point) => point.index)),
    patternId: "shark",
    patternName: "Shark",
    topologyId: "shark-0xabc",
    terminalLabel: "C",
    stage: "developing",
    status: "projected",
    tradeState: "developing",
    direction,
    score: harmonicDevelopingScore([
      harmonicRangeScore(abXa, 1.13, 1.618, 1.27),
    ], prz.convergenceWidthXa, 0.1, progress.ratio),
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    points: labelledPoints,
    ratios: Object.freeze({ abXa }),
    measurements: Object.freeze([Object.freeze({ label: "AB/XA", value: abXa })]),
    prz,
    projectedTerminal: Object.freeze({ label: "C", price: harmonicRound(projectedPrice) }),
    progress,
    ruleIds,
    evidenceIds,
  });
}

export function runSharkPatternSubengine(snapshot, { swings = [], sequences = [], atr = 0 } = {}) {
  const candidates = [];
  const recentLimit = Math.max(20, Math.min(60, Math.floor(snapshot.candles.length * 0.25)));
  const inputs = sequences.length
    ? sequences
    : Array.from({ length: Math.max(0, swings.length - 4) }, (_, index) => ({
      points: swings.slice(index, index + 5),
      profileId: "legacy",
      selectionMode: "consecutive",
    }));
  for (const input of inputs) {
    const points = input.points;
    if (snapshot.candles.length - 1 - points[4].index > recentLimit) continue;
    const candidate = evaluateSharkCandidate(snapshot, points, {
      atr,
      scanProfileId: input.profileId,
      selectionMode: input.selectionMode,
    });
    if (candidate) candidates.push(candidate);
  }
  return harmonicSubengineResult(HARMONIC_SHARK_SUBENGINE_ID, HARMONIC_SHARK_SUBENGINE_VERSION, candidates);
}
