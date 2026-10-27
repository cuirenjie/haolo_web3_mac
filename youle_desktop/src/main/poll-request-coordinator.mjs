// Share only read requests. Each caller keeps its own cancellation, and a
// cancelled last subscriber aborts the transport instead of leaving an orphan.
export function createPollRequestCoordinator(read, { now = Date.now, random = Math.random } = {}) {
  const pending = new Map(), failures = new Map();
  let generation = 0;
  function clear() { generation++; failures.clear(); pending.clear(); }
  async function request(url, init, key, cooldownKey) {
    init.signal?.throwIfAborted();
    const failure = failures.get(cooldownKey);
    if (failure?.until > now()) return new Response(failure.body, {
      status: failure.status, headers: { 'content-type': 'application/json',
        'retry-after': String(Math.ceil((failure.until - now()) / 1000)) },
    });
    let work = pending.get(key);
    if (!work) {
      const controller = new AbortController(), revision = generation;
      work = { controller, users: 0, done: false };
      const selected = work;
      work.promise = (async () => {
        const response = await read(url, { ...init, signal: controller.signal });
        // Consume once while the transport cancellation is still active. Return
        // independent bodies so a caller cannot consume another caller's data.
        const body = await response.arrayBuffer();
        if (revision === generation && cooldownKey) {
          if ([429, 503].includes(response.status) && body.byteLength <= 65536) {
            const count = Math.min(6, (failures.get(cooldownKey)?.count || 0) + 1);
            const retry = response.headers.get('retry-after');
            const seconds = Number(retry);
            const advised = retry == null ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now();
            const delay = Math.min(300000, Math.max(Number.isFinite(advised) ? advised : 0,
              Math.min(60000, 2000 * 2 ** (count - 1)) * (1 + .2 * random())));
            failures.set(cooldownKey, { count, until: now() + delay, status: response.status, body });
            while (failures.size > 64) failures.delete(failures.keys().next().value);
          } else if (response.ok) failures.delete(cooldownKey);
        }
        return { body, status: response.status, headers: response.headers };
      })().finally(() => {
        selected.done = true;
        if (pending.get(key) === selected) pending.delete(key);
      });
      // Keys include scope, headers, read mode and the invalidation generation.
      // Bound bookkeeping; excess unique reads still run without being joined.
      if (pending.size < 64) pending.set(key, work);
    }
    work.users++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        init.signal?.removeEventListener('abort', aborted);
        work.users--;
        if (!work.users && !work.done) {
          if (pending.get(key) === work) pending.delete(key);
          work.controller.abort();
        }
        fn(value);
      };
      const aborted = () => finish(reject, init.signal.reason);
      init.signal?.addEventListener('abort', aborted, { once: true });
      if (init.signal?.aborted) aborted();
      work.promise.then(value => finish(resolve, new Response(
        [204, 205, 304].includes(value.status) ? null : value.body, value)), error => finish(reject, error));
    });
  }
  return { request, clear };
}
