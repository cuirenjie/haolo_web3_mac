import assert from "node:assert/strict";
import test from "node:test";

import {
  createTradingModelBudget,
  TRADING_BACKUP_MODEL_BUDGET_MS,
  TRADING_PRIMARY_MODEL_BUDGET_MS,
} from "../src/main/trading-analysis/model-budget.mjs";
import {
  clearTradingModelReviewCache,
  runValidatedTradingModelReview,
} from "../src/main/trading-analysis/model-review.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";

const reviewRequest = {
  schemaVersion: 1, requestId: "incident-20261012", snapshotId: "frozen-btc-1h",
  task: "wyckoff-theory-review-and-drawing-plan", theoryId: "wyckoff",
  prompt: "Frozen Wyckoff candidates and market evidence", responseFormat: "json",
};

test("incident replay: a valid 63-second ambiguous review completes without wasting another 102 seconds", async () => {
  let clock = 0;
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    modelId: "deepseek-flash",
    invoke: async (args) => {
      calls.push({ model: args.modelId, effort: args.reasoningEffort, remaining: args.remainingModelTime() });
      if (calls.length === 1) {
        clock += 63_018;
        return { status: "success", text: '{"valid":true}' };
      }
      // This was the production failure: high exhausted the remaining 57s,
      // then the backup exhausted 45s, after a valid response already existed.
      clock += args.remainingModelTime() + 1;
      args.remainingModelTime();
    },
    waitForRecovery: async () => {},
  });
  const primary = { id: "accumulation", score: 0.8, direction: "bullish" };
  const result = await runValidatedTradingModelReview({
    modelRegistry: createTradingAnalysisModelProviderRegistry([provider]), providerId: provider.providerId,
    request: reviewRequest, modelBudget: createTradingModelBudget({ now: () => clock }),
    theoryResult: { structures: { primaryCandidate: primary, candidates: [primary, { id: "distribution", score: 0.79, direction: "bearish" }] } },
    validateResponse: JSON.parse,
  });
  assert.equal(result.review.valid, true);
  assert.deepEqual(calls, [{ model: "deepseek-flash", effort: "high", remaining: 90_000 }]);
  assert.equal(clock, 63_018);
  assert.equal(result.attempts.length, 1);
});

test("exhausted fallback budget retains its actual model and terminal recovery through the registry", async () => {
  let clock = 0;
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({
    invoke: async (args) => {
      calls.push(args.modelId);
      clock += args.remainingModelTime() + 1;
      args.remainingModelTime();
    },
    waitForRecovery: async () => {},
  });
  await assert.rejects(runValidatedTradingModelReview({
    modelRegistry: createTradingAnalysisModelProviderRegistry([provider]), providerId: provider.providerId,
    request: reviewRequest, modelBudget: createTradingModelBudget({ now: () => clock }), validateResponse: JSON.parse,
  }), (error) => {
    assert.equal(error.code, "TRADING_ANALYSIS_MODEL_TIMEOUT");
    assert.equal(error.modelId, "gpt-5.6-sol");
    assert.equal(error.reasoningEffort, "high");
    assert.equal(error.recovery.exhausted, true);
    assert.equal(error.attempts.at(-1).modelId, "gpt-5.6-sol");
    assert.equal(error.attempts.at(-1).effort, "high");
    return true;
  });
  assert.deepEqual(calls, ["deepseek-flash", "gpt-5.6-sol"]);
});

test("model budgets are monotonic and shared across validation passes", () => {
  let clock = 0;
  const budget = createTradingModelBudget({ now: () => clock });
  const remainingPrimary = budget.begin("gpt-6-astra");
  clock = TRADING_PRIMARY_MODEL_BUDGET_MS - 1;
  assert.equal(remainingPrimary(), 1);
  clock += 2;
  assert.throws(remainingPrimary, (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");

  const remainingBackup = budget.begin("gpt-5.6-sol");
  clock += TRADING_BACKUP_MODEL_BUDGET_MS - 1;
  assert.equal(remainingBackup(), 1);
  clock += 2;
  assert.throws(remainingBackup, (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");
  assert.throws(() => budget.begin("gpt-5.6-sol"), (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");
});

test("identical validated reviews share one in-flight and short-lived result", async () => {
  clearTradingModelReviewCache();
  let calls = 0;
  const modelRegistry = {
    async analyze() {
      calls += 1;
      await Promise.resolve();
      return { providerId: "stub", modelId: "gpt-6-astra", text: "{}", latencyMs: 5 };
    },
  };
  const request = (requestId) => ({
    requestId,
    task: "wyckoff-theory-review-and-drawing-plan",
    theoryId: "wyckoff",
    snapshotId: "snapshot-1",
    prompt: "same deterministic snapshot",
    responseFormat: "json",
  });
  const args = (requestId) => ({
    modelRegistry,
    providerId: "stub",
    request: request(requestId),
    theoryResult: null,
    validateResponse: () => ({ ok: true }),
  });
  const [first, second] = await Promise.all([
    runValidatedTradingModelReview(args("request-1")),
    runValidatedTradingModelReview(args("request-2")),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.modelResponse.requestId, "request-1");
  assert.equal(second.modelResponse.requestId, "request-2");
  assert.equal(second.cacheHit, true);
  clearTradingModelReviewCache();
});

test("one cancelled cache subscriber does not cancel a shared review still needed by another caller", async () => {
  clearTradingModelReviewCache();
  let calls = 0;
  let release;
  const modelRegistry = {
    async analyze() {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return { providerId: "stub", modelId: "gpt-6-astra", text: "{}", latencyMs: 5 };
    },
  };
  const request = {
    requestId: "shared-request",
    task: "wyckoff-theory-review-and-drawing-plan",
    theoryId: "wyckoff",
    snapshotId: "snapshot-shared",
    prompt: "shared deterministic snapshot",
    responseFormat: "json",
  };
  const firstController = new AbortController();
  const secondController = new AbortController();
  const args = (signal) => ({
    modelRegistry,
    providerId: "stub",
    request,
    signal,
    theoryResult: null,
    validateResponse: () => ({ ok: true }),
  });
  const first = runValidatedTradingModelReview(args(firstController.signal));
  const second = runValidatedTradingModelReview(args(secondController.signal));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  release();
  await second;
  assert.equal(calls, 1);
  clearTradingModelReviewCache();
});
