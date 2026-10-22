// Events only wake the canonical result reader. Never turn streamed text into
// a report, drawing patch, plan, or a successful run.
export async function waitForRunEvent({open, assertOwner, signal, after = 0, timeoutMs = 15000}) {
  const controller = new AbortController();
  const started = Date.now();
  let reader, timer, expired = false, opened = false, cursor = after;
  const stop = () => {
    controller.abort(signal?.reason);
    void reader?.cancel().catch(() => {});
  };
  const arm = ms => {
    clearTimeout(timer);
    timer = setTimeout(() => { expired = true; stop(); }, ms);
  };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', stop, {once:true});
  arm(Math.min(5000, timeoutMs));
  try {
    assertOwner();
    const response = await open(controller.signal);
    controller.signal.throwIfAborted();
    assertOwner();
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
      || !response.body?.getReader) {
      void response.body?.cancel().catch(() => {});
      throw Object.assign(new Error('CLOUD_EVENT_STREAM_UNAVAILABLE'), {status:response.status});
    }
    reader = response.body.getReader();
    opened = true;
    arm(Math.max(1, timeoutMs - (Date.now() - started)));
    const decoder = new TextDecoder();
    let buffer = '', received = 0;
    while (true) {
      const {value,done} = await reader.read();
      controller.signal.throwIfAborted();
      assertOwner();
      if (done) return {cursor, completed:false, expired:false};
      received += value.byteLength;
      buffer += decoder.decode(value, {stream:true});
      if (received > 2 * 1024 * 1024 || buffer.length > 256 * 1024) throw new Error('CLOUD_EVENT_STREAM_LIMIT');
      // The service emits LF; tolerate CRLF, including split chunks.
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let event = 'message', data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (event === 'complete') return {cursor, completed:true, expired:false};
        if (event !== 'message' || !data.length) continue;
        const item = JSON.parse(data.join('\n'));
        if (Number.isSafeInteger(item?.sequence) && item.sequence > cursor) cursor = item.sequence;
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    assertOwner();
    if (expired && opened) return {cursor, completed:false, expired:true};
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    controller.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
