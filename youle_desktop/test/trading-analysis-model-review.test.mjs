import assert from "node:assert/strict";
import test from "node:test";
import {
  runValidatedTradingModelReview,
  tradingReviewAmbiguity,
} from "../src/main/trading-analysis/model-review.mjs";

const baseRequest = Object.freeze({
  schemaVersion: 1,
  requestId: "review-request",
  task: "wave-theory-review-and-drawing-plan",
  theoryId: "elliott_wave",
  snapshotId: "snapshot-1",
  prompt: "Review the deterministic result and return JSON.",
  responseFormat: "json",
});

function theory(primaryScore = 0.82, competingScore = 0.63) {
  const primaryCandidate = Object.freeze({
    id: "primary",
    score: primaryScore,
    direction: "bullish",
    pattern: "impulse",
  });
  const competingCandidate = Object.freeze({
    id: "competitor",
    score: competingScore,
    direction: "bearish",
    pattern: "correction",
  });
  return Object.freeze({
    structures: Object.freeze({
      primaryCandidate,
      candidates: Object.freeze([primaryCandidate, competingCandidate]),
    }),
  });
}

function registryFor(responses, calls) {
  return {
    async analyze(_providerId, request, options) {
      calls.push({ request, options });
      const text = responses[calls.length - 1];
      return {
        requestId: request.requestId,
        providerId: "stub",
        modelId: "gpt-5.6-sol",
        text,
        latencyMs: calls.length * 10,
        usage: null,
        finishReason: "completed",
      };
    },
  };
}

function validateResponse(text) {
  const parsed = JSON.parse(text);
  if (parsed.valid !== true) throw new TypeError("valid must be true");
  return parsed;
}

test("ordinary valid reviews use exactly one fixed medium attempt", async () => {
  const calls = [];
  const result = await runValidatedTradingModelReview({
    modelRegistry: registryFor(['{"valid":true,"selection":"medium"}'], calls),
    providerId: "stub",
    request: baseRequest,
    theoryResult: theory(),
    validateResponse,
  });

  assert.deepEqual(calls.map((call) => call.options.reasoningEffort), ["medium"]);
  assert.equal(result.reasoningEffort, "medium");
  assert.equal(result.review.selection, "medium");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.escalationReason, null);
});

test("close competing deterministic candidates trigger one high review", async () => {
  const calls = [];
  const result = await runValidatedTradingModelReview({
    modelRegistry: registryFor([
      '{"valid":true,"selection":"medium"}',
      '{"valid":true,"selection":"high"}',
    ], calls),
    providerId: "stub",
    request: baseRequest,
    theoryResult: theory(0.82, 0.79),
    validateResponse,
  });

  assert.deepEqual(calls.map((call) => call.options.reasoningEffort), ["medium", "high"]);
  assert.equal(result.reasoningEffort, "high");
  assert.equal(result.review.selection, "high");
  assert.match(result.escalationReason, /deterministic_candidates_close/);
  assert.match(calls[1].request.prompt, /Previous untrusted response/);
});

test("invalid medium output retries at high, and max is only used if high is also invalid", async () => {
  const highCalls = [];
  const highResult = await runValidatedTradingModelReview({
    modelRegistry: registryFor(["not-json", '{"valid":true,"selection":"high"}'], highCalls),
    providerId: "stub",
    request: baseRequest,
    theoryResult: theory(),
    validateResponse,
  });
  assert.deepEqual(highCalls.map((call) => call.options.reasoningEffort), ["medium", "high"]);
  assert.equal(highResult.review.selection, "high");

  const maxCalls = [];
  const maxResult = await runValidatedTradingModelReview({
    modelRegistry: registryFor(["not-json", '{"valid":false}', '{"valid":true,"selection":"max"}'], maxCalls),
    providerId: "stub",
    request: baseRequest,
    theoryResult: theory(),
    validateResponse,
  });
  assert.deepEqual(maxCalls.map((call) => call.options.reasoningEffort), ["medium", "high", "max"]);
  assert.equal(maxResult.reasoningEffort, "max");
  assert.equal(maxResult.review.selection, "max");
  assert.equal(maxResult.modelResponse.latencyMs, 60);
});

test("all three invalid reviews fail closed with bounded attempt diagnostics", async () => {
  const calls = [];
  await assert.rejects(
    runValidatedTradingModelReview({
      modelRegistry: registryFor(["bad", "bad", "bad"], calls),
      providerId: "stub",
      request: { ...baseRequest, requestId: "x".repeat(120) },
      theoryResult: theory(),
      validateResponse,
    }),
    (error) => {
      assert.equal(error.code, "TRADING_ANALYSIS_MODEL_REVIEW_INVALID");
      assert.equal(error.attempts.length, 3);
      return true;
    },
  );
  assert.ok(calls.every((call) => call.request.requestId.length <= 120));
});

test("ambiguity requires close scores and different candidate semantics", () => {
  assert.equal(tradingReviewAmbiguity(theory(0.82, 0.79)).ambiguous, true);
  assert.equal(tradingReviewAmbiguity(theory(0.82, 0.63)).ambiguous, false);
  const primaryCandidate = { id: "primary", score: 0.82, direction: "bullish", pattern: "impulse" };
  const sameSemantics = {
    structures: {
      primaryCandidate,
      candidates: [
        primaryCandidate,
        { id: "competitor", score: 0.79, direction: "bullish", pattern: "impulse" },
      ],
    },
  };
  assert.equal(tradingReviewAmbiguity(sameSemantics).ambiguous, false);
});
