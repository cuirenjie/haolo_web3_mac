// Events are shared by all subscribers and never retained after delivery.
// A WeakMap avoids growing a stream/history cache as symbols change.
import { compactMarketPayload, MARKET_WIRE_CODECS } from "./market-wire-codec.mjs";
import { compressMarketFrame } from "./market-binary-codec.mjs";

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
      const innerCodec = codec === "hmz1" ? "hmc2" : codec;
      const compact = MARKET_WIRE_CODECS.includes(innerCodec) ? compactMarketPayload(event, combined, innerCodec) : null;
      const text = compact ? stringify(compact) : original.text;
      const bytes = Buffer.byteLength(text);
      const selected = bytes < original.bytes ? { text, bytes, codec: innerCodec, stream: event.stream } : original;
      // Compress ONCE per shared public event/mode, never once per subscriber.
      // No compression context mixes users; tiny/growing frames remain text.
      const zipped = codec === "hmz1" ? compressMarketFrame(selected.text) : null;
      entry.set(mode, Object.freeze({ ...(zipped ? { text: zipped, bytes: zipped.length, binary: true,
        codec: "hmz1", stream: event.stream } : selected), jsonBytes: original.bytes }));
    }
    return entry.get(mode);
  };
}
