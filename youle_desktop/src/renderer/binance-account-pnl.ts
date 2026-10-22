import type { BinanceAccountSnapshot } from './binance-account-ui';
import { BINANCE_REBIND_MESSAGE, isBinanceCredentialError } from '../shared/binance-account-errors.mjs';

export type AccountPnlUpdate = {
  connectionId: string;
  pnlScopeId: string;
  pnlSequence: number;
  bindingVersion?: number | null;
  realizedPnlToday: number | null;
  pnlStatus: string;
  pnlAsOf?: number | null;
  pnlTimeZone?: string | null;
  pnlDayStart?: number | null;
  pnlReason?: string | null;
  pnlRetryAfterMs?: number | null;
  pnlExpiresAfterMs?: number | null;
  pnlError?: {code: string};
};

// Retain a completion that raced the initial IPC response, without allowing
// an old binding, old sequence or old full snapshot to overwrite the page.
export function createAccountPnlUpdates(now = Date.now) {
  const updates = new Map<string, {value: AccountPnlUpdate; receivedAt: number}>();
  function remember(value: AccountPnlUpdate) {
    if (!value?.pnlScopeId || !Number.isFinite(value.pnlSequence)) return;
    if ((updates.get(value.pnlScopeId)?.value.pnlSequence ?? -1) >= value.pnlSequence) return;
    updates.set(value.pnlScopeId, {value, receivedAt:now()});
    while (updates.size > 16) updates.delete(updates.keys().next().value!);
  }
  function apply(snapshot: BinanceAccountSnapshot | null): BinanceAccountSnapshot | null {
    if (!snapshot?.pnlScopeId) return snapshot;
    const entry = updates.get(snapshot.pnlScopeId);
    if (!entry || entry.value.pnlSequence < (snapshot.pnlSequence ?? 0)
      || (entry.value.bindingVersion ?? null) !== (snapshot.bindingVersion ?? null)) return snapshot;
    const value = entry.value;
    // The event can arrive before the first snapshot. Route that retained
    // credential failure through the page's existing rebind error handling.
    if (isBinanceCredentialError(value.pnlError)) {
      throw Object.assign(new Error(BINANCE_REBIND_MESSAGE), {code:value.pnlError!.code});
    }
    const age = now() - entry.receivedAt;
    const available = value.pnlStatus === 'available' && Number.isFinite(value.realizedPnlToday)
      && age >= 0 && age < (value.pnlExpiresAfterMs ?? 0);
    const realized = available ? value.realizedPnlToday! : null;
    const today = realized == null ? null : realized + snapshot.unrealizedPnl;
    const base = today == null ? null : snapshot.marginBalance - today;
    return {...snapshot, realizedPnlToday:realized, todayPnl:today,
      todayPnlPercent:base != null && Math.abs(base)>1e-12 ? today! / Math.abs(base)*100 : null,
      pnlScopeId:value.pnlScopeId, pnlSequence:value.pnlSequence,
      pnlStatus:available ? 'available' : value.pnlStatus === 'available' ? 'waiting' : value.pnlStatus,
      pnlAsOf:available ? value.pnlAsOf : null, pnlDayStart:value.pnlDayStart, pnlTimeZone:value.pnlTimeZone,
      pnlReason:value.pnlReason, pnlRetryAfterMs:Math.max(0,(value.pnlRetryAfterMs ?? 0)-age),
      pnlExpiresAfterMs:available ? Math.max(0,(value.pnlExpiresAfterMs ?? 0)-age) : 0,
      sources:{...snapshot.sources,realizedPnl:available ? 'USD_M_INCOME' : 'unavailable'},
    };
  }
  return {remember,apply};
}
