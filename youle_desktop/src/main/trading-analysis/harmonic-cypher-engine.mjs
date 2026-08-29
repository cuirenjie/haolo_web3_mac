import {
  harmonicCandidateScore,
  harmonicConfirmation,
  harmonicDevelopingScore,
  harmonicExactScore,
  harmonicId,
  harmonicPointRecords,
  harmonicPrz,
  harmonicProjectedProgress,
  harmonicRangeMatches,
  harmonicRangeScore,
  harmonicRecency,
  harmonicRound,
  harmonicSubengineResult,
} from "./harmonic-subengine-common.mjs";

export const HARMONIC_CYPHER_SUBENGINE_ID = "harmonic-cypher-xabcd";
export const HARMONIC_CYPHER_SUBENGINE_VERSION = "1.1.0";

const LABELS = Object.freeze(["X", "A", "B", "C", "D"]);

function geometryMatches(points, direction) {
  if (!Array.isArray(points) || points.length !== 5) return false;
  const expected = direction === "bullish"
    ? ["low", "high", "low", "high", "low"]
    : ["high", "low", "high", "low", "high"];
  if (points.some((point, index) => point.type !== expected[index])) return false;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return false;
  const [x, a, b, c, d] = points;
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(b.price, x.price, a.price) || !between(d.price, x.price, c.price)) return false;
  if (direction === "bullish") return c.price > a.price && d.price < b.price;
  return c.price < a.price && d.price > b.price;
}

function ratiosFor(points) {
  const [x, a, b, c, d] = points;
  const xa = Math.abs(a.price - x.price);
  const xc = Math.abs(c.price - x.price);
  if (xa <= Number.EPSILON || xc <= Number.EPSILON) return null;
  return Object.freeze({
    bXa: harmonicRound(Math.abs(b.price - a.price) / xa),
    cXa: harmonicRound(xc / xa),
    dXc: harmonicRound(Math.abs(d.price - c.price) / xc),
  });
}

export function evaluateCypherCandidate(snapshot, inputPoints, {
  atr = 0,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  const points = inputPoints.map((point) => ({ ...point }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  if (!geometryMatches(points, direction)) return null;
  const ratios = ratiosFor(points);
  if (!ratios
    || !harmonicRangeMatches(ratios.bXa, 0.382, 0.618)
    || !harmonicRangeMatches(ratios.cXa, 1.272, 1.414)
    || !harmonicExactScore(ratios.dXc, 0.786)) return null;
  const [x, , , c, d] = points;
  const xc = Math.abs(c.price - x.price);
  const dLevel = c.price + Math.sign(x.price - c.price) * xc * 0.786;
  const basePrz = harmonicPrz([dLevel], { atr, scale: xc, maxWidthScale: 0.04 });
  if (!basePrz || d.price < basePrz.low - xc * 0.03 || d.price > basePrz.high + xc * 0.03) return null;
  const prz = Object.freeze({
    ...basePrz,
    levels: Object.freeze({ xc: harmonicRound(dLevel), xcRatio: 0.786 }),
    components: Object.freeze(["XC 0.786"]),
  });
  const targets = [
    d.price + (c.price - d.price) * 0.382,
    d.price + (c.price - d.price) * 0.618,
  ];
  const confirmation = harmonicConfirmation(snapshot, d, prz, {
    atr,
    scale: xc,
    direction,
    stopBoundary: x.price,
    targets,
  });
  if (confirmation.invalidated) return null;
  const labelledPoints = harmonicPointRecords(points, LABELS);
  const ruleIds = Object.freeze(["HARMONIC-CYPHER-B", "HARMONIC-CYPHER-C-EXTENSION", "HARMONIC-CYPHER-XC-PRZ"]);
  const evidenceIds = Object.freeze([...ruleIds, ...labelledPoints.map((point) => point.id)]);
  const score = harmonicCandidateScore([
    harmonicRangeScore(ratios.bXa, 0.382, 0.618, 0.5),
    harmonicRangeScore(ratios.cXa, 1.272, 1.414, 1.35),
    harmonicExactScore(ratios.dXc, 0.786),
  ], prz.convergenceWidthXa, 0.04, harmonicRecency(snapshot, d.index));
  return Object.freeze({
    id: harmonicId("harmonic", snapshot.snapshotId, "cypher", direction, ...points.map((point) => point.index)),
    patternId: "cypher",
    patternName: "Cypher",
    topologyId: "cypher-xabcd",
    stage: "completed-pattern",
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    terminalLabel: "D",
    direction,
    status: confirmation.status,
    tradeState: confirmation.tradeState,
    score,
    points: labelledPoints,
    ratios,
    measurements: Object.freeze([
      Object.freeze({ label: "B/XA", value: ratios.bXa }),
      Object.freeze({ label: "C/XA", value: ratios.cXa }),
      Object.freeze({ label: "D/XC", value: ratios.dXc }),
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
      targetBasis: "D→C 38.2%/61.8% retracement",
    }),
    ruleIds,
    evidenceIds,
  });
}

export function evaluateCypherDevelopingCandidate(snapshot, inputPoints, {
  atr = 0,
  scanProfileId = "direct",
  selectionMode = "direct",
} = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length !== 4) return null;
  const points = inputPoints.map((point) => ({ ...point }));
  const direction = points[0]?.type === "low" ? "bullish" : "bearish";
  const expected = direction === "bullish"
    ? ["low", "high", "low", "high"]
    : ["high", "low", "high", "low"];
  if (points.some((point, index) => point.type !== expected[index])) return null;
  if (points.some((point, index) => index > 0 && point.index <= points[index - 1].index)) return null;
  const [x, a, b, c] = points;
  const between = (value, first, second) => value > Math.min(first, second) && value < Math.max(first, second);
  if (!between(b.price, x.price, a.price)) return null;
  if (direction === "bullish" ? c.price <= a.price : c.price >= a.price) return null;
  const xa = Math.abs(a.price - x.price);
  const xc = Math.abs(c.price - x.price);
  if ([xa, xc].some((value) => value <= Number.EPSILON)) return null;
  const ratios = Object.freeze({
    bXa: harmonicRound(Math.abs(b.price - a.price) / xa),
    cXa: harmonicRound(xc / xa),
  });
  if (!harmonicRangeMatches(ratios.bXa, 0.382, 0.618)
    || !harmonicRangeMatches(ratios.cXa, 1.272, 1.414)) return null;
  const dLevel = c.price + Math.sign(x.price - c.price) * xc * 0.786;
  const prz = harmonicPrz([dLevel], { atr, scale: xc, maxWidthScale: 0.04 });
  if (!prz) return null;
  const projectedPrice = (prz.low + prz.high) / 2;
  const progress = harmonicProjectedProgress(snapshot, c, projectedPrice);
  if (!progress) return null;
  const labelledPoints = harmonicPointRecords(points, ["X", "A", "B", "C"]);
  const ruleIds = Object.freeze([
    "HARMONIC-CYPHER-B",
    "HARMONIC-CYPHER-C-EXTENSION",
    "HARMONIC-CYPHER-XC-PRZ",
    "HARMONIC-DEVELOPING-PROJECTION",
  ]);
  const evidenceIds = Object.freeze([...ruleIds, ...labelledPoints.map((point) => point.id)]);
  return Object.freeze({
    id: harmonicId("harmonic-developing", snapshot.snapshotId, "cypher", direction, ...points.map((point) => point.index)),
    patternId: "cypher",
    patternName: "Cypher",
    topologyId: "cypher-xabcd",
    terminalLabel: "D",
    stage: "developing",
    status: "projected",
    tradeState: "developing",
    direction,
    score: harmonicDevelopingScore([
      harmonicRangeScore(ratios.bXa, 0.382, 0.618, 0.5),
      harmonicRangeScore(ratios.cXa, 1.272, 1.414, 1.35),
    ], prz.convergenceWidthXa, 0.04, progress.ratio),
    scan: Object.freeze({ profileId: scanProfileId, selectionMode }),
    points: labelledPoints,
    ratios,
    measurements: Object.freeze([
      Object.freeze({ label: "B/XA", value: ratios.bXa }),
      Object.freeze({ label: "C/XA", value: ratios.cXa }),
    ]),
    prz: Object.freeze({
      ...prz,
      levels: Object.freeze({ xc: harmonicRound(dLevel), xcRatio: 0.786 }),
      components: Object.freeze(["XC 0.786"]),
    }),
    projectedTerminal: Object.freeze({ label: "D", price: harmonicRound(projectedPrice) }),
    progress,
    ruleIds,
    evidenceIds,
  });
}

export function runCypherPatternSubengine(snapshot, { swings = [], sequences = [], atr = 0 } = {}) {
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
    const candidate = evaluateCypherCandidate(snapshot, points, {
      atr,
      scanProfileId: input.profileId,
      selectionMode: input.selectionMode,
    });
    if (candidate) candidates.push(candidate);
  }
  return harmonicSubengineResult(HARMONIC_CYPHER_SUBENGINE_ID, HARMONIC_CYPHER_SUBENGINE_VERSION, candidates);
}
