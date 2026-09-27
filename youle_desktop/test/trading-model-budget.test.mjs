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

test("model budgets are monotonic and shared across validation passes", () => {
  let clock = 0;
  const budget = createTradingModelBudget({ now: () => clock });
  const remainingPrimary = budget.begin("gpt-6-astra");
  clock = TRADING_PRIMARY_MODEL_BUDGET_MS - 1;
  assert.equal(remainingPrimary(), 1);
  clock += 2;
  assert.throws(remainingPrimary, (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");

  const remainingBackup = budget.begin("deepseek-flash");
  clock += TRADING_BACKUP_MODEL_BUDGET_MS - 1;
  assert.equal(remainingBackup(), 1);
  clock += 2;
  assert.throws(remainingBackup, (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");
  assert.throws(() => budget.begin("deepseek-flash"), (error) => error.code === "TRADING_ANALYSIS_MODEL_TIMEOUT");
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
