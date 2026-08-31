import assert from "node:assert/strict";
import test from "node:test";

import {
  canRetainRechargePaymentOrder,
  isReusableRechargePaymentOrder,
  normalizeRechargePaymentAmount,
  rechargePaymentOrderSelectionKey,
  rechargePaymentOrderVisualFingerprint,
  rechargePaymentSelectionKey,
  shouldAutoRetryRechargePaymentOrderRequest,
  shouldReplaceRechargePaymentOrderAfterFinalCheck,
} from "../src/renderer/recharge-payment-selection.ts";

test("payment amounts are rendered as exact three-decimal USDT values", () => {
  assert.equal(normalizeRechargePaymentAmount("98.931"), "98.931");
  assert.equal(normalizeRechargePaymentAmount("98.9"), "98.900");
  assert.equal(normalizeRechargePaymentAmount(99), "99.000");
  assert.throws(() => normalizeRechargePaymentAmount("98.9314"), /三位小数/);
  assert.throws(() => normalizeRechargePaymentAmount("USDT 98.931"), /三位小数/);
});

test("Web3 payment selection keys isolate product and network combinations", () => {
  const basicBsc = rechargePaymentSelectionKey("subscription_basic", "bsc");

  assert.equal(basicBsc, "subscription_basic:bsc:web3");
  assert.equal(
    rechargePaymentOrderSelectionKey({
      product_id: "subscription_basic",
      network: "BSC",
      status: "pending",
      expires_at: "2026-08-21T00:30:00.000Z",
    }),
    basicBsc,
  );
  assert.notEqual(rechargePaymentSelectionKey("subscription_pro", "bsc"), basicBsc);
  assert.notEqual(rechargePaymentSelectionKey("subscription_basic", "tron"), basicBsc);
  assert.notEqual(rechargePaymentSelectionKey("subscription_basic", "binance_internal"), basicBsc);
  assert.notEqual(
    rechargePaymentSelectionKey("subscription_basic", "binance_internal"),
    rechargePaymentSelectionKey("subscription_basic", "okx_internal"),
  );
});

test("unchanged payment polls keep one visual fingerprint while visible changes invalidate it", () => {
  const order = {
    order_no: "W3202608210604491F6116",
    product_id: "subscription_basic",
    network: "arbitrum",
    status: "pending",
    expires_at: "2026-08-21T06:34:49.000Z",
    payable_amount: "98.969",
    recipient_address: "0xd69a98907565b8ACb49E84644842535c86A78457",
  };
  const fingerprint = rechargePaymentOrderVisualFingerprint(order);

  assert.equal(rechargePaymentOrderVisualFingerprint({ ...order }), fingerprint);
  assert.equal(rechargePaymentOrderVisualFingerprint({ ...order, fulfillment_status: "succeeded" }), fingerprint);
  assert.equal(rechargePaymentOrderVisualFingerprint({ ...order, expires_at: "2026-08-21T14:34:49.000+08:00" }), fingerprint);
  assert.notEqual(rechargePaymentOrderVisualFingerprint({ ...order, status: "confirming" }), fingerprint);
  assert.notEqual(rechargePaymentOrderVisualFingerprint({ ...order, payable_amount: "98.970" }), fingerprint);
  assert.notEqual(rechargePaymentOrderVisualFingerprint({ ...order, network: "bsc" }), fingerprint);
  assert.notEqual(rechargePaymentOrderVisualFingerprint({ ...order, order_no: "W3202608210604491F6117" }), fingerprint);
});

test("expired underpaid unique-address orders stop accepting top-ups", () => {
  const order = {
    product_id: "subscription_basic",
    network: "bsc",
    status: "expired",
    expires_at: "2026-08-31T00:00:00Z",
    address_type: "unique_temporary",
    payment_state: "underpaid",
  };
  assert.equal(isReusableRechargePaymentOrder(order, Date.parse("2026-09-01T00:00:00Z")), false);
  assert.equal(
    shouldReplaceRechargePaymentOrderAfterFinalCheck(
      order,
      Date.parse("2026-09-01T00:00:00Z"),
    ),
    true,
  );
  assert.equal(
    canRetainRechargePaymentOrder(
      { ...order, status: "manual_review", payment_state: "expired_underpaid_review" },
      Date.parse("2026-09-01T00:00:00Z"),
    ),
    true,
  );
});

test("only unexpired pending and confirming Web3 orders are reusable", () => {
  const now = Date.parse("2026-08-21T00:00:00.000Z");
  const order = {
    product_id: "subscription_basic",
    network: "bsc",
    status: "pending",
    expires_at: "2026-08-21T00:30:00.000Z",
  };

  assert.equal(isReusableRechargePaymentOrder(order, now), true);
  assert.equal(isReusableRechargePaymentOrder({ ...order, expires_at: "2026-08-20T23:59:59.000Z" }, now), false);
  assert.equal(isReusableRechargePaymentOrder({ ...order, status: "confirming", expires_at: "2026-08-20T23:00:00.000Z" }, now), true);
  assert.equal(isReusableRechargePaymentOrder({ ...order, status: "paid" }, now), false);
  assert.equal(isReusableRechargePaymentOrder({ ...order, status: "manual_review" }, now), false);
});

test("a valid cached order remains visible while its selection is confirmed by the server", () => {
  const now = Date.parse("2026-08-21T00:00:00.000Z");
  const order = {
    product_id: "subscription_basic",
    network: "bsc",
    status: "pending",
    expires_at: "2026-08-21T00:30:00.000Z",
  };

  assert.equal(canRetainRechargePaymentOrder(order, now), true);
  assert.equal(canRetainRechargePaymentOrder({ ...order, status: "confirming" }, now), true);
  assert.equal(canRetainRechargePaymentOrder({ ...order, status: "paid" }, now), true);
  assert.equal(canRetainRechargePaymentOrder({ ...order, status: "manual_review" }, now), true);
  assert.equal(canRetainRechargePaymentOrder({ ...order, status: "expired" }, now), false);
});

test("only the current selection gets one automatic non-auth retry", () => {
  const base = {
    authExpired: false,
    retryAttempt: 0,
    retryLimit: 1,
    requestedSelectionKey: "subscription_pro:bsc:web3",
    currentSelectionKey: "subscription_pro:bsc:web3",
  };

  assert.equal(shouldAutoRetryRechargePaymentOrderRequest(base), true);
  assert.equal(shouldAutoRetryRechargePaymentOrderRequest({ ...base, authExpired: true }), false);
  assert.equal(shouldAutoRetryRechargePaymentOrderRequest({ ...base, retryAttempt: 1 }), false);
  assert.equal(
    shouldAutoRetryRechargePaymentOrderRequest({ ...base, currentSelectionKey: "subscription_basic:bsc:web3" }),
    false,
  );
});

test("a final server check never replaces an order that just became paid", () => {
  const now = Date.parse("2026-08-21T00:30:00.000Z");
  const expiredPending = {
    product_id: "subscription_basic",
    network: "binance_internal",
    status: "pending",
    expires_at: "2026-08-21T00:30:00.000Z",
  };

  assert.equal(shouldReplaceRechargePaymentOrderAfterFinalCheck(expiredPending, now), true);
  assert.equal(
    shouldReplaceRechargePaymentOrderAfterFinalCheck({ ...expiredPending, status: "expired" }, now),
    true,
  );
  assert.equal(
    shouldReplaceRechargePaymentOrderAfterFinalCheck({ ...expiredPending, status: "paid" }, now),
    false,
  );
  assert.equal(
    shouldReplaceRechargePaymentOrderAfterFinalCheck({ ...expiredPending, status: "confirming" }, now),
    false,
  );
  assert.equal(
    shouldReplaceRechargePaymentOrderAfterFinalCheck({ ...expiredPending, status: "manual_review" }, now),
    false,
  );
});
