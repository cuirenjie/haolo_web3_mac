import type { BinanceAccountUiState, BinanceAccountOpenOrder, BinanceAccountPositionHistory } from "./binance-account-ui";

export type AccountDetailSection = "openOrders" | "positionHistory";
export type AccountDetailResult = {
  section: AccountDetailSection;
  items: Array<BinanceAccountOpenOrder | BinanceAccountPositionHistory>;
  status: "ready" | "partial" | "stale" | "syncing" | "unavailable";
  nextCursor: string | null;
  asOf: number | null;
  reason?: string | null;
};
export type AccountDetailState = {
  result: AccountDetailResult | null;
  loading: boolean;
  error: string | null;
  connectionId: string | null;
  loadedAt: number;
  retryAfter: number;
  nextAttemptAt: number;
  failures: number;
};
export const createAccountDetailState = (): AccountDetailState => ({
  result: null, loading: false, error: null, connectionId: null, loadedAt: 0, retryAfter: 0, nextAttemptAt: 0, failures: 0,
});

export async function loadSharedAccountDetails(
  state: BinanceAccountUiState,
  read: ((params: { section: AccountDetailSection; cursor?: string }) => Promise<AccountDetailResult>) | undefined,
  options: { force?: boolean; more?: boolean; isCurrent: () => boolean; changed: () => void; credentialError: (error: unknown) => boolean },
) {
  const section = state.activeSection === "open-orders" ? "openOrders"
    : state.activeSection === "history" ? "positionHistory" : null;
  const connectionId = state.status?.serverConnectionId || state.status?.connectionId;
  if (!section || !state.status?.serverCredentialsBound || !connectionId || state.rebindRequired) return;
  let detail = state.details[section];
  if (detail.connectionId !== connectionId) {
    detail = state.details[section] = { ...createAccountDetailState(), connectionId };
  }
  if (detail.loading || Date.now() < detail.retryAfter
    || (!options.force && (Date.now() < detail.nextAttemptAt || (!options.more && Date.now() - detail.loadedAt < 15_000)))) return;
  const cursor = options.more ? detail.result?.nextCursor : undefined;
  if (options.more && !cursor) return;
  const current = () => options.isCurrent() && state.details[section] === detail
    && (state.status?.serverConnectionId || state.status?.connectionId) === connectionId;
  detail.loading = true;
  detail.error = null;
  options.changed();
  try {
    if (!read) throw new Error("当前客户端无法读取账户明细，请更新客户端。");
    const result = await read({ section, ...(cursor ? { cursor } : {}) });
    if (!current()) return;
    if (result.section !== section || !Array.isArray(result.items)) throw new Error("账户明细返回格式无效，请重试。");
    const items = cursor
      ? [...new Map([...(detail.result?.items || []), ...result.items].map(item => [item.id, item])).values()]
      : result.items;
    // A pending refresh cannot erase previously verified records.
    if (items.length || !["syncing", "unavailable"].includes(result.status) || !detail.result) {
      detail.result = { ...result, items };
    } else {
      detail.result = { ...detail.result!, status: result.status };
    }
    detail.loadedAt = Date.now();
    detail.failures = 0;
    detail.retryAfter = 0;
    detail.nextAttemptAt = 0;
  } catch (error) {
    if (!current() || options.credentialError(error)) return;
    detail.error = error instanceof Error ? error.message : String(error);
    detail.failures += 1;
    const retryAfterMs = Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0;
    detail.retryAfter = retryAfterMs > 0 ? Date.now() + retryAfterMs : 0;
    detail.nextAttemptAt = Date.now() + Math.max(
      Math.min(60_000, 5_000 * 2 ** Math.min(4, detail.failures - 1)),
      retryAfterMs,
    );
    // A changed server collection requires a new first page, not a broken cursor.
    if (/ACCOUNT_HISTORY_CHANGED/.test(String((error as { code?: string })?.code || "") + detail.error)) {
      if (detail.result) detail.result.nextCursor = null;
      detail.error = "历史记录已更新，请刷新后继续查看。";
    }
  } finally {
    if (current()) {
      detail.loading = false;
      options.changed();
    }
  }
}
