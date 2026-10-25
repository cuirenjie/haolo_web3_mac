// One bounded, authenticated advisory stream per API session. The REST path
// remains authoritative whenever a stream is unavailable, buffered or expired.
export function createResourceChangeFeed(fetchImpl, scope, { now = Date.now } = {}) {
  let controller, owner, topics, received = 0, checkedAt = 0, serverAt = 0;
  let lastUse = 0, retryAt = 0, serial = 0, running = false;
  const reset = () => { topics = null; checkedAt = received = serverAt = 0; serial++; };
  const close = () => { controller?.abort(); controller = null; running = false; reset(); };
  const topicFor = path => path.endsWith('/client-settings') ? 'settings'
    : path.endsWith('/manual-sync') ? 'drawings'
    : /^\/api\/mobile\/v1\/tasks\/[^/]+$/.test(path) ? 'history' : null;
  // Run execution, deadline reconciliation and market data are intentionally
  // never served by this notification lease; their existing cadence remains.
  function state() {
    return { healthy: !!topics && !!checkedAt && now() >= checkedAt && now() - checkedAt < 1800 && owner === scope(), topics, serverAt, serial };
  }
  function accept(event, value) {
    if (event === 'reset') { reset(); return; }
    if (!['state', 'check'].includes(event) || !Number.isSafeInteger(value?.at) || value.at <= 0) throw Error('Invalid change event');
    const time = now();
    if (serverAt && value.at < serverAt) throw Error('Change clock moved backwards');
    // Buffered bursts cannot create a fresh lease. Require two server samples
    // arriving with a real time gap, instead of trusting wall-clock alignment.
    if (received && time - received >= 250 && time - received < 1800 && value.at > serverAt && value.at - serverAt < 1800) checkedAt = time;
    received = time; serverAt = value.at;
    if (event === 'state') {
      if (value.version !== 1 || !value.topics || ['settings','drawings','history','plans'].some(k => !/^[a-f0-9]{32}$/.test(value.topics[k]))) throw Error('Invalid change state');
      if (JSON.stringify(topics) !== JSON.stringify(value.topics)) serial++;
      topics = value.topics;
    }
  }
  async function consume(url, headers, selected, abort) {
    let timeout;
    try {
      timeout = setTimeout(() => abort.abort(), 52_000); timeout.unref?.();
      const response = await fetchImpl(new URL('/api/mobile/v1/sync/changes', url).href, {
        method: 'GET', headers: { ...headers, Accept: 'text/event-stream' }, signal: abort.signal, redirect: 'error',
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel(); throw Error('Change stream unavailable');
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller !== abort || abort.signal.aborted || selected !== scope() || now() - lastUse > 30_000) { abort.abort(); break; }
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffer.length > 32_768) throw Error('Oversized change event');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (event && data) accept(event, JSON.parse(data));
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { if (controller === abort) retryAt = now() + 30_000; }
    finally {
      clearTimeout(timeout);
      if (controller === abort) { controller = null; running = false; reset(); }
    }
  }
  return {
    topicFor, state, close,
    touch(url, init) {
      const selected = scope();
      if (selected !== owner) { close(); owner = selected; running = false; retryAt = 0; received = serverAt = 0; }
      lastUse = now();
      const headers = init.headers instanceof Headers || Array.isArray(init.headers)
        ? Object.fromEntries(new Headers(init.headers)) : { ...init.headers };
      const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
      if (!authorization || running || now() < retryAt) return;
      // Do not forward route-specific validators, idempotency or retry hooks.
      controller = new AbortController(); running = true;
      void consume(url, { Authorization: authorization }, selected, controller);
    },
  };
}
