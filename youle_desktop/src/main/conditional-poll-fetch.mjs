// Application-owned snapshots only. Every poll still reaches authentication and
// the current server state; errors never return stale data. No disk cache.
export function createConditionalPollFetch(fetchImpl, scope) {
  const cache = new Map();
  let owner, generation = 0, bytes = 0;
  const clear = () => { cache.clear(); bytes = 0; generation++; };
  const remove = key => { bytes -= cache.get(key)?.size || 0; cache.delete(key); };
  return async (url, init = {}) => {
    const current = scope();
    if (current !== owner) { clear(); owner = current; }
    const path = new URL(url).pathname;
    const eligible = path === '/api/mobile/v1/client-settings'
      || path === '/api/contact-requests'
      || path === '/api/mobile/v1/new-task/manual-sync'
      || /^\/api\/mobile\/v1\/charts\/[^/]+\/manual-sync$/.test(path);
    if (!eligible && !path.startsWith('/api/contact-requests/')) return fetchImpl(url, init);
    if (String(init.method || 'GET').toUpperCase() !== 'GET') {
      clear();
      try { return await fetchImpl(url, init); } finally { clear(); }
    }
    if (!eligible) return fetchImpl(url, init);
    const key = String(url), revision = generation;
    const prior = cache.get(key);
    // Existing injected transports accept plain header records; preserve their
    // Authorization casing rather than changing that transport contract.
    const headers = init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers)) : { ...init.headers };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'if-none-match') delete headers[name];
    if (prior) headers['If-None-Match'] = prior.etag;
    let response = await fetchImpl(url, { ...init, headers });
    if (response.status === 304) {
      if (prior && revision === generation && current === scope()
          && (!response.headers.get('etag') || response.headers.get('etag') === prior.etag)) {
        const data = JSON.parse(prior.text);
        const clock = Number(response.headers.get('x-haolo-server-time'));
        if (data && Object.hasOwn(data, 'serverTime') && Number.isSafeInteger(clock) && clock > 0) data.serverTime = clock;
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Eviction, a concurrent write or a bad intermediary must not synthesize
      // an empty successful receipt. Retry once without a validator.
      delete headers['If-None-Match'];
      response = await fetchImpl(url, { ...init, headers });
    }
    const etag = response.headers?.get('etag');
    if (revision === generation && current === scope()) {
      remove(key);
      if (response.status === 200 && etag) {
        const text = await response.clone().text();
        const size = Buffer.byteLength(text);
        if (revision === generation && current === scope() && size <= 2 * 1024 * 1024) {
          // Another read may have filled this key while clone().text() awaited.
          remove(key);
          cache.set(key, { etag, text, size }); bytes += size;
          while (cache.size && (cache.size > 32 || bytes > 8 * 1024 * 1024)) remove(cache.keys().next().value);
        }
      }
    }
    return response;
  };
}
