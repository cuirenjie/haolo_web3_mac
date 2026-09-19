// Events are shared by all subscribers and never retained after delivery.
// A WeakMap avoids growing a stream/history cache as symbols change.
export function createMarketFrameEncoder(stringify = JSON.stringify) {
  const frames = new WeakMap();
  return (event, combined) => {
    let entry = frames.get(event);
    if (!entry) { entry = new Map(); frames.set(event, entry); }
    const mode = combined ? "combined" : "raw";
    if (!entry.has(mode)) {
      const text = stringify(combined ? { stream: event.stream, data: event.data } : event.data);
      entry.set(mode, Object.freeze({ text, bytes: Buffer.byteLength(text) }));
    }
    return entry.get(mode);
  };
}
