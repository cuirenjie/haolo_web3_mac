// hmc1 is immutable: append a NEW version for schema changes. Mirrored in the
// desktop shared module (byte equality is covered by the protocol tests).
export const MARKET_WIRE_CODEC = "hmc1";
export const MARKET_WIRE_CODECS = Object.freeze(["hmc2", "hmc1"]);
const schemas = Object.freeze([
  ["e", "E", "s", "a", "p", "q", "f", "l", "T", "m", "M"], // aggTrade
  ["e", "E", "s", "k"], // kline
  ["e", "E", "s", "p", "P", "w", "x", "c", "Q", "b", "B", "a", "A", "o", "h", "l", "v", "q", "O", "C", "F", "L", "n"], // ticker
  ["e", "E", "s", "c", "o", "h", "l", "v", "q"], // miniTicker
  ["e", "u", "s", "b", "B", "a", "A", "T", "E"], // bookTicker
  ["e", "E", "s", "p", "i", "P", "r", "T"], // markPrice
  ["t", "T", "s", "i", "f", "L", "o", "c", "h", "l", "v", "n", "x", "q", "V", "Q", "B"], // nested candle
]);
const schemaIds = { aggTrade: 0, kline: 1, "24hrTicker": 2, "24hrMiniTicker": 3, bookTicker: 4, markPriceUpdate: 5 };
const fields = schemas.map((keys) => new Set(keys));
// hmc2 adds an extension object after the mask. Future upstream fields remain
// lossless without disabling packing for the entire event. hmc1 stays frozen.
const additions = [["nq", "st"], ["st"], ["ps", "st"], ["ps", "st"], ["ps", "st"], ["ap", "st"], ["st"]];
const schemas2 = schemas.map((keys, id) => [...keys, ...additions[id]]);
const fields2 = schemas2.map(keys => new Set(keys));

export function negotiateMarketCodec(offered) {
  return Array.isArray(offered) ? MARKET_WIRE_CODECS.find(codec => offered.includes(codec)) || "json" : "json";
}

function packObject(value, schemaId, codec) {
  const extended = codec === "hmc2";
  const keys = (extended ? schemas2 : schemas)[schemaId];
  const known = (extended ? fields2 : fields)[schemaId];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (!extended && Object.keys(value).some((key) => !known.has(key)))) return null;
  let mask = 0;
  const values = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (!Object.hasOwn(value, key)) continue;
    let item = value[key];
    if (schemaId === 1 && key === "k") {
      item = packObject(item, 6, codec);
      if (!item) return null;
    }
    mask |= 1 << index;
    values.push(item);
  }
  const extra = extended ? Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key))) : null;
  return extended ? [mask, Object.keys(extra).length ? extra : null, ...values] : [mask, ...values];
}

export function compactMarketPayload(event, combined, codec = MARKET_WIRE_CODEC) {
  if (!MARKET_WIRE_CODECS.includes(codec)) return null;
  const type = event.data?.e;
  const schemaId = Object.hasOwn(schemaIds, type) ? schemaIds[type]
    : (event.data?.u != null && event.data?.b != null && event.data?.a != null ? 4 : undefined);
  if (schemaId === undefined) return null;
  const packed = packObject(event.data, schemaId, codec);
  return packed ? [codec, combined ? event.stream : null, schemaId, ...packed] : null;
}

function unpackObject(packed, schemaId, codec) {
  if (!Array.isArray(packed)) throw new TypeError("Invalid market object");
  const extended = codec === "hmc2";
  const keys = (extended ? schemas2 : schemas)[schemaId];
  const mask = packed[0];
  if (!keys || !Number.isSafeInteger(mask) || mask < 0 || mask >= 2 ** keys.length) throw new TypeError("Invalid market frame mask");
  const value = {};
  let cursor = extended ? 2 : 1;
  if (extended) {
    const extra = packed[1];
    if (extra !== null && (!extra || typeof extra !== "object" || Array.isArray(extra))) throw new TypeError("Invalid market extensions");
    for (const [key, item] of Object.entries(extra || {})) {
      if (keys.includes(key)) throw new TypeError("Duplicate market field");
      Object.defineProperty(value, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
  }
  for (let index = 0; index < keys.length; index++) {
    if (!(mask & (1 << index))) continue;
    if (cursor >= packed.length) throw new TypeError("Truncated market frame");
    const item = packed[cursor++];
    value[keys[index]] = schemaId === 1 && keys[index] === "k" ? unpackObject(item, 6, codec) : item;
  }
  if (cursor !== packed.length) throw new TypeError("Extra market frame values");
  return value;
}

export function decodeMarketPayload(payload) {
  if (!Array.isArray(payload) || !MARKET_WIRE_CODECS.includes(payload[0])) return payload;
  if (payload.length < 4 || !(payload[1] === null || typeof payload[1] === "string") ||
      !Number.isInteger(payload[2]) || payload[2] < 0 || payload[2] > 5) throw new TypeError("Invalid market frame");
  const data = unpackObject(payload.slice(3), payload[2], payload[0]);
  return payload[1] === null ? data : { stream: payload[1], data };
}
