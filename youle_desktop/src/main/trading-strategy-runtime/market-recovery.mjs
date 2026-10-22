import {isMembershipFailure, isQuotaFailure} from '../error-signals.mjs';
import {isRecoverableNetworkError} from '../system-proxy-fetch.mjs';

const terminalCodes = /AUTH|PERMISSION|MEMBERSHIP|CREDENTIAL|PREFERENCE|CONTEXT_INVALID|MARKET_INVALID|MARKET_UNSUPPORTED|MARKET_STALE|HISTORY_INSUFFICIENT|WINDOW_INSUFFICIENT|CANCEL|ABORT/;

// Used only for snapshot and existing-run status reads. Never replay admission,
// a model request, plan activation or trade through this recovery policy.
export function marketRecoveryPolicy(error) {
  const detail = error?.payload?.detail || error?.detail;
  const code = String(detail?.code || error?.code || '').toUpperCase();
  const status = Number(error?.status ?? error?.httpStatus);
  const marketQuota = ['BINANCE_BUDGET_DEFERRED','BINANCE_RATE_LIMITED','MARKET_BUDGET_DEFERRED','MARKET_RATE_LIMITED'].includes(code)
    || (code === 'MARKET_UNAVAILABLE' && [418,429].includes(status));
  if (error?.name === 'AbortError' || terminalCodes.test(code)
    || isMembershipFailure(error) || (!marketQuota && isQuotaFailure(error))
    || [401,402,403].includes(status) || error?.retryable === false || detail?.retryable === false) return null;
  // A structured market quota code is not an analysis-credit balance, even
  // when its localized message contains the generic phrase "额度不足".
  const quota = [418,429].includes(status) || marketQuota;
  const transient = [408,425,500,502,503,504].includes(status)
    || (!status && (isRecoverableNetworkError(error) || code === 'REQUEST_TIMEOUT' || error?.name === 'TimeoutError'));
  if (!quota && !transient) return null;
  const raw = Number(error?.retryAfterMs ?? detail?.retryAfterMs);
  return {stage:quota ? 'market_quota_wait' : 'market_connection_wait',
    retryAfterMs:Number.isSafeInteger(raw) && raw > 0 ? raw : 0};
}

export async function readMarketWhenAvailable({read, assertOwner, signal, wait, random=Math.random, onProgress}) {
  let attempts = 0;
  let deferred = false;
  const check = async () => { signal?.throwIfAborted(); await assertOwner(); signal?.throwIfAborted(); };
  while (true) {
    await check();
    try {
      const snapshot = await read();
      await check();
      onProgress?.({stage:'market_ready',status:'running'});
      return {snapshot,deferred};
    } catch (error) {
      await check();
      const policy = marketRecoveryPolicy(error);
      if (!policy) throw error;
      deferred = true;
      const backoff = Math.min(30000, 1000 * 2 ** Math.min(attempts++,5));
      // Server cooldown is a lower bound. Jitter prevents simultaneous clients
      // from competing for the first slot after a minute boundary.
      const pause = Math.max(backoff,policy.retryAfterMs) + Math.ceil(backoff * random() * 0.25);
      onProgress?.({stage:policy.stage,status:'running',retryAfterMs:pause});
      // No cumulative timeout: this time is not model/analysis execution time.
      // Short interruptible sleeps also observe logout and avoid timer overflow.
      for (let remaining = pause; remaining > 0;) {
        const slice = Math.min(5000,remaining);
        await wait(slice,undefined,{signal});
        await check();
        remaining -= slice;
      }
    }
  }
}
