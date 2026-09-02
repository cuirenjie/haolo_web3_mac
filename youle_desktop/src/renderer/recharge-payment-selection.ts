export type RechargePaymentOrderSelection = {
  product_id: string;
  network: string;
  status: string;
  expires_at: string;
  payment_state?: string;
  address_type?: string;
};

export type RechargePaymentOrderVisualState = RechargePaymentOrderSelection & {
  order_no: string;
  payable_amount: string;
  recipient_address: string;
  amount_received?: string;
  remaining_amount?: string;
  overpayment_amount?: string;
};

export function rechargePaymentSelectionKey(productId: string, network: string) {
  return `${String(productId || "").trim()}:${String(network || "").trim().toLowerCase()}:web3`;
}

export function rechargePaymentOrderSelectionKey(order: RechargePaymentOrderSelection) {
  return rechargePaymentSelectionKey(order.product_id, order.network);
}

export function rechargePaymentOrderVisualFingerprint(order: RechargePaymentOrderVisualState) {
  return JSON.stringify([
    order.order_no,
    order.product_id,
    order.network,
    order.status,
    Date.parse(order.expires_at),
    order.payable_amount,
    order.recipient_address,
    order.payment_state,
    order.address_type,
    order.amount_received,
    order.remaining_amount,
    order.overpayment_amount,
  ].map((value) => String(value ?? "").trim()));
}

export function normalizeRechargePaymentAmount(value: unknown) {
  const normalized = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(normalized);
  if (!match) throw new Error("支付接口返回的金额不是有效的三位小数");
  return `${match[1]}.${String(match[2] || "").padEnd(3, "0")}`;
}

export function isReusableRechargePaymentOrder(
  order: RechargePaymentOrderSelection | null | undefined,
  now = Date.now(),
) {
  if (!order) return false;
  if (order.address_type === "unique_temporary" && order.payment_state === "underpaid") {
    return order.status === "pending" && Date.parse(order.expires_at) > now;
  }
  if (order.status === "confirming") return true;
  return order.status === "pending" && Date.parse(order.expires_at) > now;
}

export function canRetainRechargePaymentOrder(
  order: RechargePaymentOrderSelection | null | undefined,
  now = Date.now(),
) {
  return Boolean(
    order
    && (isReusableRechargePaymentOrder(order, now)
      || order.status === "paid"
      || order.status === "manual_review"),
  );
}

export function shouldReplaceRechargePaymentOrderAfterFinalCheck(
  order: RechargePaymentOrderSelection,
  now = Date.now(),
) {
  if (order.address_type === "unique_temporary" && order.payment_state === "underpaid") {
    return order.status === "expired"
      || (order.status === "pending" && Date.parse(order.expires_at) <= now);
  }
  return order.status === "expired"
    || (order.status === "pending" && Date.parse(order.expires_at) <= now);
}
