import { TRADING_ANALYSIS_SCHEMA_VERSION } from "./protocol.mjs";
import {
  buildChartPatternScanProfiles,
  candidateEvidence,
  rankAndDeduplicateCandidates,
} from "./chart-pattern-common.mjs";
import {
  CHART_PATTERN_REVERSAL_IDS,
  runReversalPatternSubengine,
} from "./chart-pattern-reversal-engine.mjs";
import {
  CHART_PATTERN_CONTINUATION_IDS,
  runContinuationPatternSubengine,
} from "./chart-pattern-continuation-engine.mjs";
import {
  CHART_PATTERN_BILATERAL_IDS,
  runBilateralPatternSubengine,
} from "./chart-pattern-bilateral-engine.mjs";
import { EXTENDED_PATTERN_IDS, runExtendedPatterns } from "./chart-pattern-extended-engine.mjs";
import { chartPatternContext } from "./chart-pattern-context.mjs";

export const CHART_PATTERN_ENGINE_ID = "traditional-chart-patterns";
export const CHART_PATTERN_ENGINE_VERSION = "2.1.0";
export const CHART_PATTERN_SUPPORTED_IDS = Object.freeze([
  ...CHART_PATTERN_REVERSAL_IDS,
  ...CHART_PATTERN_CONTINUATION_IDS,
  ...CHART_PATTERN_BILATERAL_IDS,
  ...EXTENDED_PATTERN_IDS,
]);

function lifecycleRank(candidate) {
  return candidate.lifecycle === "confirmed" ? 3 : candidate.lifecycle === "developing" ? 2 : 0;
}

function isCurrentCandidate(candidate) {
  return candidate?.tradeState === "active"
    || candidate?.tradeState === "awaiting-breakout"
    || candidate?.tradeState === "awaiting-confirmation";
}

function compareCandidates(first, second) {
  return lifecycleRank(second) - lifecycleRank(first)
    || Number(second.score || 0) - Number(first.score || 0)
    || second.points.at(-1).index - first.points.at(-1).index;
}

export function runChartPatternEngine(snapshot) {
  const scanContext = buildChartPatternScanProfiles(snapshot);
  const reversal = runReversalPatternSubengine(snapshot, scanContext);
  const continuation = runContinuationPatternSubengine(snapshot, scanContext);
  const bilateral = runBilateralPatternSubengine(snapshot, scanContext);
  const extended = runExtendedPatterns(snapshot, scanContext);
  const ranked = [...rankAndDeduplicateCandidates([
    ...reversal.candidates,
    ...continuation.candidates,
    ...bilateral.candidates,
    ...extended,
  ], 48)].sort(compareCandidates);
  const candidates = ranked.map(candidate => Object.freeze({ ...candidate,
    context: chartPatternContext(snapshot, candidate, ranked) }))
    .sort((a, b) => Number(Boolean(a.context.entryBlockedReason)) - Number(Boolean(b.context.entryBlockedReason))
      || compareCandidates(a, b));
  const activeCandidates = Object.freeze(candidates.filter(isCurrentCandidate));
  const historicalCandidates = Object.freeze(candidates.filter((candidate) => !isCurrentCandidate(candidate)));
  const failedCandidates = Object.freeze(candidates.filter((candidate) => candidate.lifecycle === "failed"));
  const primaryActiveCandidate = activeCandidates[0] || null;
  const primaryCandidate = primaryActiveCandidate || historicalCandidates[0] || null;
  // Keep recent structure evidence visible even when its entry window has ended.
  // This list never feeds candidateActionPlan or execution-plan construction.
  const displayCandidates = [];
  const displayPool = [...activeCandidates, ...historicalCandidates.slice().sort((a, b) => b.points.at(-1).index - a.points.at(-1).index)];
  for (const candidate of displayPool) {
    const start = candidate.points[0].index, end = candidate.points.at(-1).index;
    if (snapshot.candles.length - 1 - end > Math.max(24, Math.min(120, (end - start) * 2))) continue;
    if (displayCandidates.some(other => {
      const overlap = Math.max(0, Math.min(end, other.points.at(-1).index) - Math.max(start, other.points[0].index));
      const longest = Math.max(end - start, other.points.at(-1).index - other.points[0].index, 1);
      return overlap / longest > 0.7;
    })) continue;
    displayCandidates.push(candidate);
    if (displayCandidates.length === 3) break;
  }
  const status = primaryActiveCandidate
    ? primaryActiveCandidate.lifecycle === "confirmed" ? "succeeded" : "developing"
    : historicalCandidates.length ? "historical-only" : "insufficient_data";
  const observationProfile = scanContext.profiles.find((profile) => profile.id === "standard")
    || scanContext.profiles[0]
    || Object.freeze({ id: "none", swings: Object.freeze([]), rawCount: 0 });
  return Object.freeze({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    engine: Object.freeze({
      id: CHART_PATTERN_ENGINE_ID,
      version: CHART_PATTERN_ENGINE_VERSION,
      subengines: Object.freeze([
        Object.freeze({
          id: reversal.id,
          version: reversal.version,
          status: candidates.some(c => c.category === "reversal") ? "succeeded" : "insufficient_data",
          supportedPatternIds: [...reversal.supportedPatternIds, "rounding-bottom", "rounding-top", "diamond-top", "diamond-bottom"],
        }),
        Object.freeze({
          id: continuation.id,
          version: continuation.version,
          status: candidates.some(c => c.category === "continuation") ? "succeeded" : "insufficient_data",
          supportedPatternIds: [...continuation.supportedPatternIds, "inverse-cup-and-handle", "old-duck-head"],
        }),
        Object.freeze({
          id: bilateral.id,
          version: bilateral.version,
          status: candidates.some(c => c.category === "bilateral") ? "succeeded" : "insufficient_data",
          supportedPatternIds: [...bilateral.supportedPatternIds, "ascending-channel", "descending-channel", "broadening-formation", "ascending-broadening-wedge", "descending-broadening-wedge"],
        }),
      ]),
    }),
    status,
    direction: primaryActiveCandidate?.direction || "neutral",
    bias: primaryActiveCandidate?.direction || "neutral",
    pivots: Object.freeze({
      atr: scanContext.atr,
      profiles: Object.freeze(scanContext.profiles.map((profile) => Object.freeze({
        id: profile.id,
        radius: profile.radius,
        rawCount: profile.rawCount,
        compactCount: profile.swings.length,
      }))),
      observationProfileId: observationProfile.id,
      swings: observationProfile.swings,
    }),
    structures: Object.freeze({
      candidates: Object.freeze(candidates),
      activeCandidates,
      historicalCandidates,
      failedCandidates,
      primaryCandidate,
      primaryActiveCandidate,
      displayCandidates: Object.freeze(displayCandidates),
    }),
    evidence: Object.freeze(candidates.flatMap(candidateEvidence)),
    coverage: Object.freeze({ candles: "available" }),
  });
}
