import {setTimeout as delay} from 'node:timers/promises';

// MOBILE_BUSY is emitted before the API handler runs. It is safe to repeat a
// frozen admission with the same ID/key. Unknown network outcomes, model quotas
// and other 429 responses must never acquire that permission implicitly.
export function isAnalysisAdmissionBusy(error) {
  const detail = error?.payload?.detail || error?.detail;
  return Number(error?.status ?? error?.httpStatus) === 429
    && (detail?.code || error?.code) === 'MOBILE_BUSY'
    && error?.retryable !== false && detail?.retryable !== false;
}

export async function waitForAnalysisAdmission({request, assertOwner, signal, onProgress,
  wait=delay, now=Date.now, random=Math.random, timeoutMs=120000, isBusy=isAnalysisAdmissionBusy}) {
  const deadline = now() + timeoutMs;
  let attempts = 0;
  const check = async () => { signal?.throwIfAborted(); await assertOwner(); signal?.throwIfAborted(); };
  while (true) {
    await check();
    try {
      const result = await request();
      await check();
      if (attempts) onProgress?.({stage:'service_ready',status:'running'});
      return result;
    } catch (error) {
      await check();
      if (!isBusy(error)) throw error;
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      const retryAfter = Number(error.retryAfterMs ?? error.payload?.detail?.retryAfterMs ?? error.detail?.retryAfterMs);
      const backoff = Math.min(15000, 1000 * 2 ** Math.min(attempts++, 4));
      const pause = Math.max(backoff, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0)
        + Math.ceil(backoff * random() * .25);
      onProgress?.({stage:'service_waiting',status:'running',retryAfterMs:pause});
      for (let pending=Math.min(pause,remaining); pending>0;) {
        const slice = Math.min(1000,pending);
        await wait(slice,undefined,{signal});
        await check();
        pending -= slice;
      }
      if (now() >= deadline) throw error;
    }
  }
}
