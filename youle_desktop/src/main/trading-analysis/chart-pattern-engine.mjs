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

export const CHART_PATTERN_ENGINE_ID = "traditional-chart-patterns";
export const CHART_PATTERN_ENGINE_VERSION = "1.1.0";
export const CHART_PATTERN_SUPPORTED_IDS = Object.freeze([
  ...CHART_PATTERN_REVERSAL_IDS,
  ...CHART_PATTERN_CONTINUATION_IDS,
  ...CHART_PATTERN_BILATERAL_IDS,
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
  const candidates = [...rankAndDeduplicateCandidates([
    ...reversal.candidates,
    ...continuation.candidates,
    ...bilateral.candidates,
  ], 24)].sort(compareCandidates);
  const activeCandidates = Object.freeze(candidates.filter(isCurrentCandidate));
  const historicalCandidates = Object.freeze(candidates.filter((candidate) => !isCurrentCandidate(candidate)));
  const failedCandidates = Object.freeze(candidates.filter((candidate) => candidate.lifecycle === "failed"));
  const primaryActiveCandidate = activeCandidates[0] || null;
  const primaryCandidate = primaryActiveCandidate || historicalCandidates[0] || null;
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
          status: reversal.status,
          supportedPatternIds: reversal.supportedPatternIds,
        }),
        Object.freeze({
          id: continuation.id,
          version: continuation.version,
          status: continuation.status,
          supportedPatternIds: continuation.supportedPatternIds,
        }),
        Object.freeze({
          id: bilateral.id,
          version: bilateral.version,
          status: bilateral.status,
          supportedPatternIds: bilateral.supportedPatternIds,
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
    }),
    evidence: Object.freeze(candidates.flatMap(candidateEvidence)),
    coverage: Object.freeze({ candles: "available" }),
  });
}
