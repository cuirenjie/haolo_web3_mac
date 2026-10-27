import assert from "node:assert/strict";
import test from "node:test";
import { createRechargeProfileRefresh } from "../src/renderer/recharge-profile-refresh.ts";

function fixture(refresh) {
  const timers = new Map();
  let scope = "server::customer", nextId = 0, calls = 0, renders = 0;
  const controller = createRechargeProfileRefresh({
    refresh: () => { calls++; return refresh(calls); },
    isCurrentScope: (expected) => scope === expected,
    onRefreshed: () => { renders++; },
    schedule: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    cancel: (id) => timers.delete(id),
  });
  return { controller, timers,
    get calls() { return calls; }, get renders() { return renders; },
    setScope(value) { scope = value; },
    async nextRetry() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      await new Promise(setImmediate);
      return timer.delay;
    },
  };
}

test("paid order retries a failed profile read without another order poll or restart", async () => {
  const f = fixture(async (attempt) => attempt > 1);
  assert.equal(await f.controller.refresh("paid-order", "server::customer"), false);
  assert.equal(f.renders, 0);
  assert.equal(await f.nextRetry(), 2000);
  assert.equal(f.calls, 2);
  assert.equal(f.renders, 1);
  assert.equal(f.timers.size, 0);
  // Already reconciled orders do not repeatedly hit the account API.
  assert.equal(await f.controller.refresh("paid-order", "server::customer"), true);
  assert.equal(f.calls, 2);
});

test("thrown network failures back off and remain retryable", async () => {
  const f = fixture(async () => { throw new Error("account endpoint unavailable"); });
  await f.controller.refresh("paid-order", "server::customer");
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    // Re-renders or repeated paid-order delivery cannot bypass the backoff.
    await f.controller.refresh("paid-order", "server::customer");
    assert.equal(await f.nextRetry(), delay);
  }
  assert.equal(f.calls, 7);
  f.controller.reset();
  assert.equal(f.timers.size, 0);
});

test("overlapping paid-order deliveries share the same in-flight read", async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const first = f.controller.refresh("paid-order", "server::customer");
  const second = f.controller.refresh("paid-order", "server::customer");
  assert.equal(f.calls, 1);
  finish(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.renders, 1);
});

test("separate paid orders each reconcile, while success is remembered per order", async () => {
  const f = fixture(async () => true);
  for (const order of ["order-1", "order-2", "order-1", "order-2"]) {
    await f.controller.refresh(order, "server::customer");
  }
  assert.equal(f.calls, 2);
  assert.equal(f.renders, 2);
});

test("logout cancels scheduled retries and stale in-flight completion", async () => {
  const f = fixture(async () => false);
  await f.controller.refresh("paid-order", "server::customer");
  f.setScope("");
  f.controller.reset();
  assert.equal(f.timers.size, 0);
  assert.equal(await f.controller.refresh("paid-order", "server::customer"), false);
  assert.equal(f.calls, 1);

  let finish;
  const pending = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const request = pending.controller.refresh("paid-order", "server::customer");
  pending.controller.reset();
  finish(true);
  assert.equal(await request, false);
  assert.equal(pending.renders, 0);
});

test("a scope change also stops retrying without requiring a reset callback", async () => {
  const f = fixture(async () => false);
  await f.controller.refresh("paid-order", "server::customer");
  f.setScope("server::another-customer");
  await f.nextRetry();
  assert.equal(f.calls, 1);
  assert.equal(f.timers.size, 0);
});
