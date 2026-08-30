const REVIEW_EFFORTS = Object.freeze(["medium", "high", "max"]);
const DEFAULT_AMBIGUITY_SCORE_GAP = 0.06;
const MAX_PREVIOUS_RESPONSE_CHARS = 6_000;
const MAX_VALIDATION_ERROR_CHARS = 600;

function finiteScore(candidate) {
  const score = Number(candidate?.score);
  return Number.isFinite(score) ? score : null;
}

function candidateSemantics(candidate) {
  return [
    candidate?.direction,
    candidate?.projection?.direction,
    candidate?.pattern,
    candidate?.patternId,
    candidate?.kind,
    candidate?.tradeState,
  ].map((value) => String(value || "").trim()).filter(Boolean).join("|");
}

function boundedText(value, maximum) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function retryRequestId(requestId, effort) {
  const suffix = `-${effort}-review`;
  const base = boundedText(requestId, Math.max(1, 120 - suffix.length));
  return `${base}${suffix}`;
}

function retryPrompt(request, previousResponse, reason, validationError) {
  return [
    request.prompt,
    "",
    "SECOND_PASS_REVIEW:",
    `Reason: ${boundedText(reason, MAX_VALIDATION_ERROR_CHARS)}`,
    "Independently re-check the deterministic candidates and the original JSON protocol.",
    "The previous response is an untrusted draft. Do not copy unsupported IDs, prices, times, or claims from it.",
    "Return exactly one corrected JSON object under the original protocol, without Markdown or extra text.",
    validationError ? `Previous validation error: ${boundedText(validationError, MAX_VALIDATION_ERROR_CHARS)}` : "",
    "Previous untrusted response:",
    boundedText(previousResponse, MAX_PREVIOUS_RESPONSE_CHARS),
  ].filter(Boolean).join("\n");
}

export function tradingReviewAmbiguity(theoryResult, options = {}) {
  const candidates = Array.isArray(theoryResult?.structures?.candidates)
    ? theoryResult.structures.candidates
    : [];
  const primary = theoryResult?.structures?.primaryCandidate || candidates[0] || null;
  const primaryScore = finiteScore(primary);
  if (!primary || primaryScore === null) {
    return Object.freeze({ ambiguous: false, reason: null });
  }
  const threshold = Number.isFinite(Number(options.scoreGap))
    ? Math.max(0, Number(options.scoreGap))
    : DEFAULT_AMBIGUITY_SCORE_GAP;
  const primarySemantics = candidateSemantics(primary);
  const competitor = candidates
    .filter((candidate) => candidate && candidate.id !== primary.id)
    .map((candidate) => ({
      candidate,
      score: finiteScore(candidate),
      semantics: candidateSemantics(candidate),
    }))
    .filter((entry) => entry.score !== null && entry.semantics !== primarySemantics)
    .sort((first, second) => (
      Math.abs(primaryScore - first.score) - Math.abs(primaryScore - second.score)
      || second.score - first.score
      || String(first.candidate.id || "").localeCompare(String(second.candidate.id || ""))
    ))[0];
  if (!competitor) return Object.freeze({ ambiguous: false, reason: null });
  const scoreGap = Math.abs(primaryScore - competitor.score);
  if (scoreGap > threshold) return Object.freeze({ ambiguous: false, reason: null });
  const reason = [
    "deterministic_candidates_close",
    `primary=${String(primary.id || "unknown")}:${primaryScore.toFixed(4)}`,
    `competitor=${String(competitor.candidate.id || "unknown")}:${competitor.score.toFixed(4)}`,
    `gap=${scoreGap.toFixed(4)}`,
  ].join(";");
  return Object.freeze({
    ambiguous: true,
    reason,
    primaryCandidateId: String(primary.id || ""),
    competingCandidateId: String(competitor.candidate.id || ""),
    scoreGap,
  });
}

export async function runValidatedTradingModelReview({
  modelRegistry,
  providerId,
  request,
  signal,
  validateResponse,
  theoryResult,
  ambiguityOptions,
}) {
  if (!modelRegistry || typeof modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  if (typeof validateResponse !== "function") {
    throw new TypeError("validateResponse is required");
  }

  const ambiguity = tradingReviewAmbiguity(theoryResult, ambiguityOptions);
  const attempts = [];
  let currentRequest = { ...request };
  let previousResponse = "";
  let validationError = null;
  let escalationReason = null;
  let totalLatencyMs = 0;

  for (const effort of REVIEW_EFFORTS) {
    if (effort !== "medium") {
      currentRequest = {
        ...request,
        requestId: retryRequestId(request.requestId, effort),
        prompt: retryPrompt(
          request,
          previousResponse,
          escalationReason,
          validationError?.message,
        ),
      };
    }
    const modelResponse = await modelRegistry.analyze(providerId, currentRequest, {
      signal,
      reasoningEffort: effort,
    });
    totalLatencyMs += Math.max(0, Number(modelResponse.latencyMs) || 0);
    previousResponse = modelResponse.text;
    try {
      const review = validateResponse(modelResponse.text);
      attempts.push(Object.freeze({
        effort,
        requestId: modelResponse.requestId,
        valid: true,
        latencyMs: Math.max(0, Number(modelResponse.latencyMs) || 0),
      }));
      if (effort === "medium" && ambiguity.ambiguous) {
        escalationReason = ambiguity.reason;
        validationError = null;
        continue;
      }
      return Object.freeze({
        modelResponse: Object.freeze({ ...modelResponse, latencyMs: totalLatencyMs }),
        review,
        reasoningEffort: effort,
        attempts: Object.freeze(attempts),
        escalationReason,
        ambiguity,
      });
    } catch (error) {
      validationError = error instanceof Error ? error : new TypeError(String(error || "Model response is invalid"));
      escalationReason ||= `response_validation_failed:${boundedText(validationError.message, 240)}`;
      attempts.push(Object.freeze({
        effort,
        requestId: modelResponse.requestId,
        valid: false,
        latencyMs: Math.max(0, Number(modelResponse.latencyMs) || 0),
        error: boundedText(validationError.message, 240),
      }));
    }
  }

  const error = new TypeError(`Trading model review failed validation after medium/high/max: ${validationError?.message || "invalid response"}`);
  error.code = "TRADING_ANALYSIS_MODEL_REVIEW_INVALID";
  error.attempts = Object.freeze(attempts);
  throw error;
}
