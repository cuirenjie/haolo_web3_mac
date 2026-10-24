import { applyJsonDelta } from './json-delta.mjs';
import { createResourceChangeFeed } from './resource-change-feed.mjs';

// Application-owned, account-scoped snapshots only; never a public/disk cache.
export function createConditionalPollFetch(fetchImpl, scope, { changes = false, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  const feed = changes ? createResourceChangeFeed(fetchImpl, scope, { now }) : null;
  let owner, generation = 0, bytes = 0, sequence = 0;
  const clear = () => { cache.clear(); bytes = 0; generation++; };
  const remove = key => { bytes -= cache.get(key)?.size || 0; cache.delete(key); };
  const weak = tag => String(tag || '').replace(/^W\//, '');
  const full = (data, etag) => new Response(JSON.stringify(data), { status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } });
  const read = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const current = scope();
    if (current !== owner) { clear(); feed?.close(); owner = current; }
    const path = new URL(url).pathname;
    const delta = path === '/api/market-data/indices'
      || ['/api/mobile/v1/plans', '/api/mobile/v1/trading-plans'].includes(path)
      || /^\/api\/mobile\/v1\/(?:tasks\/[^/]+|agent-runs\/[^/]+(?:\/events)?)$/.test(path);
    const eligible = delta || path === '/api/mobile/v1/client-settings' || path === '/api/contact-requests'
      || path === '/api/mobile/v1/new-task/manual-sync' || /^\/api\/mobile\/v1\/charts\/[^/]+\/manual-sync$/.test(path);
    const writing = String(init.method || 'GET').toUpperCase() !== 'GET';
    if (writing && (path.startsWith('/api/mobile/v1/') || path.startsWith('/api/contact-requests'))) {
      clear();
      try { return await fetchImpl(url, init); } finally { clear(); }
    }
    if (!eligible || writing) return fetchImpl(url, init);
    const topic = feed?.topicFor(path);
    if (topic) feed.touch(url, init);
    const key = String(url), revision = generation, prior = cache.get(key), before = feed?.state();
    if (prior && topic && before.healthy && prior.topicStamp === before.topics[topic]
        && now() - prior.savedAt < 30_000 && init.cache !== 'reload' && init.cache !== 'no-cache') {
      const data = JSON.parse(prior.text);
      if (Number.isSafeInteger(data?.serverTime)) data.serverTime = Math.max(data.serverTime, before.serverAt);
      return full(data, prior.etag);
    }
    const requestId = ++sequence;
    pending.set(key, requestId);
    const valid = () => revision === generation && current === scope() && pending.get(key) === requestId;
    const headers = init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers)) : { ...init.headers };
    for (const name of Object.keys(headers)) if (['if-none-match','x-haolo-json-delta'].includes(name.toLowerCase())) delete headers[name];
    if (prior?.etag) headers['If-None-Match'] = prior.etag;
    if (delta) headers['X-Haolo-JSON-Delta'] = '1';
    try {
      let response = await fetchImpl(url, { ...init, headers });
      let data, reconstructed = false;
      if (response.status === 304 || response.headers.get('x-haolo-json-delta') === '1') {
        try {
          if (!prior || !valid()) throw Error('Expired baseline');
          const etag = response.headers.get('etag');
          if (response.status === 304) {
            if (etag && weak(etag) !== weak(prior.etag)) throw Error('Mismatched validator');
            data = JSON.parse(prior.text);
            const clock = Number(response.headers.get('x-haolo-server-time'));
            if (data && Object.hasOwn(data, 'serverTime') && Number.isSafeInteger(clock) && clock > 0) data.serverTime = clock;
          } else {
            if (response.status !== 200 || !etag || !delta) throw Error('Invalid delta response');
            const envelope = await response.json();
            if (envelope.base !== prior.etag) throw Error('Mismatched delta base');
            data = applyJsonDelta(JSON.parse(prior.text), envelope.patch);
          }
          response = full(data, etag || prior.etag); reconstructed = true;
        } catch {
          if (valid()) remove(key);
          await response.body?.cancel().catch(() => {});
          delete headers['If-None-Match']; delete headers['X-Haolo-JSON-Delta'];
          response = await fetchImpl(url, { ...init, headers });
        }
      }
      const etag = response.headers?.get('etag');
      if (valid()) {
        remove(key);
        if (response.status === 200 && (etag || topic)) {
          const text = reconstructed ? JSON.stringify(data) : await response.clone().text();
          const size = Buffer.byteLength(text), after = feed?.state();
          if (valid() && size <= 4 * 1024 * 1024) {
            JSON.parse(text);
            remove(key);
            cache.set(key, { etag, text, size, savedAt: now(),
              topicStamp: topic && before?.healthy && after?.healthy && before.topics[topic] === after.topics[topic] ? before.topics[topic] : null });
            bytes += size;
            while (cache.size > 64 || bytes > 16 * 1024 * 1024) remove(cache.keys().next().value);
          }
        }
      }
      return response;
    } catch (error) {
      if (valid()) remove(key);
      throw error;
    } finally { if (pending.get(key) === requestId) pending.delete(key); }
  };
  read.close = () => { clear(); feed?.close(); };
  return read;
}
