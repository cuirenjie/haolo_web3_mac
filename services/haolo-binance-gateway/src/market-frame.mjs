// Events are shared by all subscribers and never retained after delivery.
// A WeakMap avoids growing a stream/history cache as symbols change.
import { compactMarketPayload, MARKET_WIRE_CODEC } from "./market-wire-codec.mjs";

export function createMarketFrameEncoder(stringify = JSON.stringify) {
  const frames = new WeakMap();
  return (event, combined, codec = "json") => {
    let entry = frames.get(event);
    if (!entry) { entry = new Map(); frames.set(event, entry); }
    const mode = `${combined ? "combined" : "raw"}:${codec}`;
    if (!entry.has(mode)) {
      const jsonMode = `${combined ? "combined" : "raw"}:json`;
      let original = entry.get(jsonMode);
      if (!original) {
        const text = stringify(combined ? { stream: event.stream, data: event.data } : event.data);
        original = Object.freeze({ text, bytes: Buffer.byteLength(text), codec: "json", stream: event.stream });
        entry.set(jsonMode, original);
      }
      const compact = codec === MARKET_WIRE_CODEC ? compactMarketPayload(event, combined) : null;
      const text = compact ? stringify(compact) : original.text;
      const bytes = Buffer.byteLength(text);
      entry.set(mode, Object.freeze({ ...(bytes < original.bytes ? { text, bytes, codec: MARKET_WIRE_CODEC, stream: event.stream } : original), jsonBytes: original.bytes }));
    }
    return entry.get(mode);
  };
}
