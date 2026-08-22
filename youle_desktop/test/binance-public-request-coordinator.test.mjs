import assert from "node:assert/strict";
import test from "node:test";
import { BinancePublicRequestCoordinator } from "../src/main/binance-public-request-coordinator.mjs";

test("renderer cancellation aborts the real main-process market request", () => {
  const coordinator = new BinancePublicRequestCoordinator();
  const operation = coordinator.begin(7, "renderer-market-rest-request-0001");
  assert.equal(operation.signal.aborted, false);
  assert.equal(coordinator.snapshot().pending, 1);
  assert.equal(coordinator.cancel(7, "renderer-market-rest-request-0001"), true);
  assert.equal(operation.signal.aborted, true);
  assert.equal(operation.signal.reason.name, "AbortError");
  assert.equal(coordinator.snapshot().pending, 0);
  operation.finish();
});

test("renderer request ids are owner-isolated and duplicate ids replace stale work", () => {
  const coordinator = new BinancePublicRequestCoordinator();
  const stale = coordinator.begin(10, "renderer-market-rest-request-0002");
  const current = coordinator.begin(10, "renderer-market-rest-request-0002");
  const otherOwner = coordinator.begin(11, "renderer-market-rest-request-0002");
  assert.equal(stale.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  assert.equal(otherOwner.signal.aborted, false);
  assert.equal(coordinator.cancelOwner(10), 1);
  assert.equal(current.signal.aborted, true);
  assert.equal(otherOwner.signal.aborted, false);
  assert.equal(coordinator.cancelAll(), 1);
  assert.equal(otherOwner.signal.aborted, true);
});

test("renderer request ids are validated before entering the coordinator", () => {
  const coordinator = new BinancePublicRequestCoordinator();
  assert.throws(() => coordinator.begin(1, "../../not-allowed"), /request id/);
  assert.throws(() => coordinator.cancel(0, "renderer-market-rest-request-0003"), /owner/);
});
