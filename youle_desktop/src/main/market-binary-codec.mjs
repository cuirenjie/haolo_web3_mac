// hmz1 is a stateless, individually compressed hmc2-or-JSON frame. Every event
// is immediately recoverable without dictionaries, previous frames or batching.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { MARKET_WIRE_CODECS, decodeMarketPayload, negotiateMarketCodec } from './market-wire-codec.mjs';

export const MARKET_TRANSPORT_CODECS = Object.freeze(['hmz1', ...MARKET_WIRE_CODECS]);
const MAGIC = Buffer.from([0x48, 0x5a, 1]);
const MAX_FRAME = 256 * 1024;

export function negotiateMarketTransport(offered, enabled = false) {
  return enabled && Array.isArray(offered) && offered.includes('hmz1') ? 'hmz1' : negotiateMarketCodec(offered);
}

export function compressMarketFrame(text) {
  const raw = Buffer.from(text);
  if (raw.length < 128 || raw.length > MAX_FRAME) return null;
  let zipped;
  try { zipped = deflateRawSync(raw, { level: 1, windowBits: 12, memLevel: 7 }); }
  catch { return null; } // Compression failure preserves the ordinary text frame.
  if (zipped.length + 7 >= raw.length) return null;
  const header = Buffer.allocUnsafe(7);
  MAGIC.copy(header); header.writeUInt32BE(raw.length, 3);
  return Buffer.concat([header, zipped]);
}

export function decodeMarketWireFrame(payload, binary = false) {
  if (!binary) return decodeMarketPayload(JSON.parse(String(payload)));
  const frame = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (frame.length < 8 || !frame.subarray(0, 3).equals(MAGIC)) throw Error('Invalid market frame');
  const length = frame.readUInt32BE(3);
  if (!length || length > MAX_FRAME || frame.length > MAX_FRAME + 7) throw Error('Invalid market frame size');
  const raw = inflateRawSync(frame.subarray(7), { maxOutputLength: length });
  if (raw.length !== length) throw Error('Truncated market frame');
  return decodeMarketPayload(JSON.parse(raw.toString('utf8')));
}
