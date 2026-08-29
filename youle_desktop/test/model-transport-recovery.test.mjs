import assert from "node:assert/strict";
import test from "node:test";

import {
  isRetryableModelTransportError,
  runReadOnlyModelOperationWithRecovery,
} from "../src/main/model-transport-recovery.mjs";

test("model transport recovery distinguishes transient failures from unsafe request failures", () => {
  assert.equal(isRetryableModelTransportError({ code: "STREAM_DISCONNECTED" }), true);
  assert.equal(isRetryableModelTransportError({
    codexErrorInfo: { responseStreamDisconnected: {} },
  }), true);
  assert.equal(isRetryableModelTransportError({ status: 503 }), true);
  assert.equal(isRetryableModelTransportError({ status: 429 }), true);
  assert.equal(isRetryableModelTransportError({
    code: "WORKFLOW_TURN_TIMEOUT",
    category: "timeout",
    message: "Haolo 工作流连续 180000 毫秒未收到模型进展，已超时。",
  }), true);
  assert.equal(isRetryableModelTransportError({
    message: "Haolo 工作流执行在 180000 毫秒后超时。",
  }), true);
  assert.equal(isRetryableModelTransportError({ status: 401 }), false);
  assert.equal(isRetryableModelTransportError({ status: 401, retryable: true }), false);
  assert.equal(isRetryableModelTransportError({ code: "CONTEXT_LENGTH_EXCEEDED" }), false);
  assert.equal(isRetryableModelTransportError({ retryable: false, status: 503 }), false);
  assert.equal(isRetryableModelTransportError({
    retryable: false,
    category: "timeout",
    message: "请求超时",
  }), false);
  assert.equal(isRetryableModelTransportError(new DOMException("cancelled", "AbortError")), false);
});

test("read-only model recovery keeps trying at low frequency until the operation succeeds", async () => {
  let attempts = 0;
  const retries = [];
  const result = await runReadOnlyModelOperationWithRecovery({
    operation: async () => {
      attempts += 1;
      if (attempts <= 4) {
        throw Object.assign(new Error("temporary upstream disconnect"), {
          code: "STREAM_DISCONNECTED",
          retryable: true,
        });
      }
      return "completed";
    },
    waitForRetry: async () => {},
    onRetry: (event) => retries.push(event),
  });

  assert.equal(result, "completed");
  assert.equal(attempts, 5);
  assert.deepEqual(retries.map((event) => event.delayMs), [1_500, 4_000, 60_000, 60_000]);
  assert.deepEqual(retries.map((event) => event.lowFrequency), [false, false, true, true]);
});

test("received stream progress resets the no-progress backoff", async () => {
  let attempts = 0;
  const retries = [];
  await runReadOnlyModelOperationWithRecovery({
    operation: async () => {
      attempts += 1;
      if (attempts === 1 || attempts === 2) {
        throw Object.assign(new Error("stream disconnected after output"), {
          code: "STREAM_DISCONNECTED",
          retryable: true,
          streamReceivedBytes: 32,
        });
      }
      return true;
    },
    waitForRetry: async () => {},
    onRetry: (event) => retries.push(event),
  });

  assert.deepEqual(retries.map((event) => event.delayMs), [1_500, 1_500]);
  assert.deepEqual(retries.map((event) => event.noProgressFailures), [1, 1]);
});

test("read-only model recovery can cap attempts for bounded interactive flows", async () => {
  let attempts = 0;
  await assert.rejects(
    runReadOnlyModelOperationWithRecovery({
      operation: async () => {
        attempts += 1;
        throw Object.assign(new Error("temporary upstream disconnect"), {
          code: "STREAM_DISCONNECTED",
          retryable: true,
        });
      },
      maxAttempts: 3,
      waitForRetry: async () => {},
    }),
    (error) => error.recoveryExhausted === true && error.recoveryAttempts === 3,
  );
  assert.equal(attempts, 3);
});
