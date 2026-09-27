import crypto from "node:crypto";
import { createTradingModelBudget } from "./model-budget.mjs";

const REVIEW_EFFORTS = Object.freeze(["medium", "high", "max"]);
const DEFAULT_AMBIGUITY_SCORE_GAP = 0.06;
const MAX_PREVIOUS_RESPONSE_CHARS = 6_000;
const MAX_VALIDATION_ERROR_CHARS = 600;
const REVIEW_CACHE_TTL_MS = 30_000;
const REVIEW_CACHE_MAX_ENTRIES = 64;
const REVIEW_CACHE = new Map();
const MODEL_REGISTRY_IDS = new WeakMap();
let nextModelRegistryId = 1;

function modelRegistryId(modelRegistry) {
  let id = MODEL_REGISTRY_IDS.get(modelRegistry);
  if (!id) {
    id = String(nextModelRegistryId++);
    MODEL_REGISTRY_IDS.set(modelRegistry, id);
  }
  return id;
}

function reviewCacheKey({ modelRegistry, providerId, request, ambiguityOptions, theoryResult }) {
  return crypto.createHash("sha256").update(JSON.stringify({
    registry: modelRegistryId(modelRegistry),
    providerId: String(providerId || ""),
    models: typeof modelRegistry?.list === "function"
      ? modelRegistry.list().map((entry) => ({ providerId: entry?.providerId, modelId: entry?.modelId }))
      : null,
    task: String(request?.task || ""),
    theoryId: String(request?.theoryId || ""),
    snapshotId: String(request?.snapshotId || ""),
    responseMode: String(request?.responseMode || ""),
    reasoningEffort: String(request?.reasoningEffort || ""),
    ambiguityOptions,
    theoryResult,
    prompt: String(request?.prompt || ""),
  })).digest("hex");
}

function hydrateReview(result, request, validateResponse, cacheHit = false) {
  return Object.freeze({
    ...result,
    ...(cacheHit ? { cacheHit: true } : {}),
    // Validate cached text against this caller's current deterministic facts.
    review: cacheHit ? validateResponse(result.modelResponse.text) : result.review,
    modelResponse: Object.freeze({
      ...result.modelResponse,
      requestId: request?.requestId || result.modelResponse?.requestId,
      latencyMs: cacheHit ? 0 : result.modelResponse.latencyMs,
    }),
  });
}

function pruneReviewCache() {
  const completed = [...REVIEW_CACHE.entries()].filter(([, entry]) => entry.settled);
  for (const [key, entry] of completed) {
    if (Date.now() - entry.completedAt > REVIEW_CACHE_TTL_MS || REVIEW_CACHE.size > REVIEW_CACHE_MAX_ENTRIES) {
      REVIEW_CACHE.delete(key);
    }
  }
}

function reviewAbortError(signal) {
  return signal?.reason || new DOMException("Analysis cancelled", "AbortError");
}

function subscribeReview(key, entry, signal) {
  entry.subscribers += 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      entry.subscribers -= 1;
      if (!entry.settled && entry.subscribers === 0) {
        if (REVIEW_CACHE.get(key) === entry) REVIEW_CACHE.delete(key);
        entry.controller.abort(reviewAbortError(signal));
      }
      callback(value);
    };
    const abort = () => finish(reject, reviewAbortError(signal));
    signal?.addEventListener("abort", abort, { once: true });
    entry.promise.then((result) => finish(resolve, result), (error) => finish(reject, error));
    if (signal?.aborted) abort();
  });
}

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

async function runValidatedTradingModelReviewInternal({
  modelRegistry,
  providerId,
  request,
  signal,
  validateResponse,
  theoryResult,
  ambiguityOptions,
  modelBudget = createTradingModelBudget(),
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
  let lastModelId = null;
  let recoveryModel;

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
    let modelResponse;
    const attemptStartedAt = Date.now();
    try {
      modelResponse = await modelRegistry.analyze(providerId, currentRequest, {
        signal,
        reasoningEffort: effort,
        recoveryModel,
        modelBudget,
      });
    } catch (error) {
      // An empty successful turn is invalid model output, just like malformed
      // JSON. The provider rejects it before validateResponse can see it.
      // Transport/auth/cancellation errors retain their own recovery policy.
      if (signal?.aborted || error?.recovery?.exhausted || error?.code !== "TRADING_ANALYSIS_MODEL_EMPTY_RESPONSE") {
        if (error && typeof error === "object" && Object.isExtensible(error)) {
          error.attempts = Object.freeze([...attempts, Object.freeze({
            effort: error.reasoningEffort || effort, modelId: error.modelId,
            requestId: currentRequest.requestId, valid: false,
            code: error.code || "TRADING_ANALYSIS_MODEL_FAILED",
          })]);
        }
        throw error;
      }
      validationError = error;
      lastModelId = error.modelId || lastModelId;
      const latencyMs = Math.max(0, Date.now() - attemptStartedAt);
      totalLatencyMs += latencyMs;
      previousResponse = "";
      escalationReason ||= "response_validation_failed:empty_response";
      attempts.push(Object.freeze({
        effort, requestId: currentRequest.requestId, valid: false,
        latencyMs, code: error.code, error: "Model response was empty",
      }));
      continue;
    }
    totalLatencyMs += Math.max(0, Number(modelResponse.latencyMs) || 0);
    lastModelId = modelResponse.modelId || lastModelId;
    recoveryModel = modelResponse.recovery?.modelId || recoveryModel;
    previousResponse = modelResponse.text;
    try {
      const review = validateResponse(modelResponse.text);
      attempts.push(Object.freeze({
        effort: modelResponse.reasoningEffort || effort,
        modelId: modelResponse.modelId,
        requestId: modelResponse.requestId,
        valid: true,
        latencyMs: Math.max(0, Number(modelResponse.latencyMs) || 0),
      }));
      if (effort === "medium" && ambiguity.ambiguous && !modelResponse.recovery) {
        escalationReason = ambiguity.reason;
        validationError = null;
        continue;
      }
      return Object.freeze({
        modelResponse: Object.freeze({ ...modelResponse, latencyMs: totalLatencyMs }),
        review,
        reasoningEffort: modelResponse.reasoningEffort || effort,
        attempts: Object.freeze(attempts),
        escalationReason,
        ambiguity,
      });
    } catch (error) {
      validationError = error instanceof Error ? error : new TypeError(String(error || "Model response is invalid"));
      escalationReason ||= `response_validation_failed:${boundedText(validationError.message, 240)}`;
      attempts.push(Object.freeze({
        effort: modelResponse.reasoningEffort || effort,
        modelId: modelResponse.modelId,
        requestId: modelResponse.requestId,
        valid: false,
        latencyMs: Math.max(0, Number(modelResponse.latencyMs) || 0),
        error: boundedText(validationError.message, 240),
      }));
    }
  }

  const error = new TypeError(`Trading model review failed validation after ${attempts.map((attempt) => attempt.effort).join("/")}: ${validationError?.message || "invalid response"}`);
  error.code = "TRADING_ANALYSIS_MODEL_REVIEW_INVALID";
  error.providerId = providerId;
  error.modelId = lastModelId;
  error.requestId = currentRequest.requestId;
  error.attempts = Object.freeze(attempts);
  throw error;
}

export async function runValidatedTradingModelReview(args = {}) {
  const { modelRegistry, request, signal, validateResponse } = args;
  if (!modelRegistry || typeof modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  if (typeof validateResponse !== "function") throw new TypeError("validateResponse is required");
  if (signal?.aborted) throw reviewAbortError(signal);
  pruneReviewCache();
  const key = reviewCacheKey(args);
  const existing = REVIEW_CACHE.get(key);
  if (existing && !existing.controller.signal.aborted) {
    return hydrateReview(await subscribeReview(key, existing, signal), request, validateResponse, true);
  }
  const entry = { controller: new AbortController(), subscribers: 0, settled: false, completedAt: 0, promise: null };
  entry.promise = Promise.resolve().then(() => runValidatedTradingModelReviewInternal({
    ...args, signal: entry.controller.signal,
    modelBudget: args.modelBudget || createTradingModelBudget(),
  })).then((result) => {
    entry.settled = true;
    entry.completedAt = Date.now();
    pruneReviewCache();
    return result;
  }, (error) => {
    entry.settled = true;
    if (REVIEW_CACHE.get(key) === entry) REVIEW_CACHE.delete(key);
    throw error;
  });
  REVIEW_CACHE.set(key, entry);
  return hydrateReview(await subscribeReview(key, entry, signal), request, validateResponse);
}

export function clearTradingModelReviewCache() {
  REVIEW_CACHE.clear();
}
