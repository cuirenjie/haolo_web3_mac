import { applyJsonDelta } from './json-delta.mjs';
import { createHash } from 'node:crypto';
import { createResourceChangeFeed } from './resource-change-feed.mjs';
import { createPollRequestCoordinator } from './poll-request-coordinator.mjs';

// Application-owned, account-scoped snapshots only; never a public/disk cache.
export function createConditionalPollFetch(fetchImpl, scope, { changes = false, background = false, now = Date.now, random = Math.random } = {}) {
  const cache = new Map(), pending = new Map();
  const feed = changes ? createResourceChangeFeed(fetchImpl, scope, { now }) : null;
  let owner, generation = 0, bytes = 0, sequence = 0;
  const revisions = new Map();
  const clear = (account = false) => { cache.clear(); bytes = 0; generation++; revisions.clear(); if (account) coordinator.clear(); };
  const topicFor = path => path.endsWith('/client-settings') ? 'settings'
    : path.endsWith('/manual-sync') ? 'drawings'
    : /\/(trading-plans|plans)$/.test(path) ? 'plans'
    : /\/(trading-alert-feed|alerts)$/.test(path) ? 'alerts' : null;
  const remove = key => { bytes -= cache.get(key)?.size || 0; cache.delete(key); };
  const weak = tag => String(tag || '').replace(/^W\//, '');
  const full = (data, etag) => new Response(JSON.stringify(data), { status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) } });
  const read = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const current = scope();
    if (current !== owner) { clear(true); feed?.close(); owner = current; }
    const path = new URL(url).pathname;
    const delta = path === '/api/market-data/indices'
      || ['/api/mobile/v1/plans', '/api/mobile/v1/trading-plans'].includes(path)
      || /^\/api\/mobile\/v1\/(?:tasks\/[^/]+|agent-runs\/[^/]+(?:\/events)?)$/.test(path);
    const eligible = delta || path === '/api/mobile/v1/client-settings' || path === '/api/contact-requests' || path === '/api/mobile/v1/alerts'
      || path === '/api/mobile/v1/new-task/manual-sync' || /^\/api\/mobile\/v1\/charts\/[^/]+\/manual-sync$/.test(path);
    const writing = String(init.method || 'GET').toUpperCase() !== 'GET';
    if (writing && (path.startsWith('/api/mobile/v1/') || path.startsWith('/api/contact-requests'))) {
      clear();
      try { return await fetchImpl(url, init); } finally { clear(); }
    }
    if (!eligible || writing) return fetchImpl(url, init);
    const topic = feed?.topicFor(path);
    if (topic) feed.touch(url, init);
    const key = JSON.stringify([String(url), [...new Headers(init.headers)].sort(([a], [b]) => a.localeCompare(b))]);
    const revision = generation, prior = cache.get(key), before = feed?.state();
    const hintTopic = topicFor(path), hintRevision = revisions.get(hintTopic) || 0;
    const relaxed = background && (path === '/api/contact-requests' || path.endsWith('/client-settings') || path.endsWith('/manual-sync'));
    const force = ['reload', 'no-cache', 'no-store'].includes(init.cache);
    const freshLease = topic && before.healthy && prior?.topicStamp === before.topics[topic];
    // A changed/expired notification lease forces a REST check. When there is
    // no live feed, unchanged background data backs off within a bounded delay.
    const quiet = relaxed && prior && !before?.healthy && prior.topicStamp == null && now() >= prior.savedAt
      && now() - prior.savedAt < prior.quietMs;
    if (prior && !force && (quiet || freshLease)
        && now() - prior.savedAt < 30_000 && init.cache !== 'reload' && init.cache !== 'no-cache') {
      const data = JSON.parse(prior.text);
      if (Number.isSafeInteger(data?.serverTime)) data.serverTime = Math.max(data.serverTime,
        freshLease ? before.serverAt : data.serverTime + Math.max(0, now() - prior.savedAt));
      return full(data, prior.etag);
    }
    const requestId = ++sequence;
    pending.set(key, requestId);
    const valid = () => revision === generation && current === scope() && pending.get(key) === requestId;
    const cacheable = () => valid() && hintRevision === (revisions.get(hintTopic) || 0);
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
      if (cacheable()) {
        remove(key);
        if (response.status === 200 && (etag || topic || relaxed)) {
          const text = reconstructed ? JSON.stringify(data) : await response.clone().text();
          const size = Buffer.byteLength(text), after = feed?.state();
          if (cacheable() && size <= 4 * 1024 * 1024) {
            const parsed = JSON.parse(text);
            const fingerprint = createHash('sha256').update(JSON.stringify(parsed && !Array.isArray(parsed) && typeof parsed === 'object'
              ? { ...parsed, serverTime: undefined } : parsed)).digest('hex');
            const unchanged = prior?.fingerprint === fingerprint;
            remove(key);
            cache.set(key, { etag, text, size, savedAt: now(), fingerprint,
              quietMs: unchanged ? Math.min(path.endsWith('/manual-sync') ? 15000 : 30000, (prior.quietMs || 2500) * 2) : 2500,
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
  const coordinator = createPollRequestCoordinator(read, { now, random });
  const coordinated = (url, init = {}) => {
    if (scope() !== owner) { clear(true); feed?.close(); owner = scope(); }
    const path = new URL(url).pathname;
    const allowed = path === '/api/contact-requests' || path === '/api/mobile/v1/client-settings'
      || path.endsWith('/manual-sync') && path.startsWith('/api/mobile/v1/')
      || ['/api/mobile/v1/plans', '/api/mobile/v1/trading-plans', '/api/mobile/v1/trading-alert-feed', '/api/mobile/v1/alerts'].includes(path);
    if (String(init.method || 'GET').toUpperCase() !== 'GET' || !allowed) return read(url, init);
    const headers = [...new Headers(init.headers)].sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([owner, generation, String(url), headers, init.cache || 'default']);
    return coordinator.request(url, init, key, background ? JSON.stringify([owner, path, headers]) : null);
  };
  // Hints invalidate snapshots, never account-level retry budgets or active
  // shared reads. A hint during a read fences its cache; the subscriber's
  // coalesced follow-up will read the newer version after that read completes.
  coordinated.invalidateTopics = topics => {
    const selected = new Set(topics);
    for (const topic of selected) revisions.set(topic, (revisions.get(topic) || 0) + 1);
    for (const key of cache.keys()) if (selected.has(topicFor(new URL(JSON.parse(key)[0]).pathname))) remove(key);
  };
  coordinated.close = () => { clear(true); feed?.close(); };
  return coordinated;
}
