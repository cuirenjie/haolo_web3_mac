import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createMarketFrameEncoder } from "../src/market-frame.mjs";
import { decodeMarketPayload } from "../src/market-wire-codec.mjs";

export const fixtures = [
  { e: "aggTrade", E: 1790908800001, s: "BTCUSDT", a: 987654321, p: "65123.12345678", q: "0.00000100", f: 123, l: 124, T: 1790908800000, m: false, M: true },
  { e: "kline", E: 1790908800001, s: "BTCUSDT", k: { t: 1790908800000, T: 1790908859999, s: "BTCUSDT", i: "1m", f: 1, L: 9, o: "65123.10", c: "65124.10000000", h: "65125.00", l: "65000.00000000", v: "1.00200", n: 7, x: false, q: "65300.10000", V: "0.10200", Q: "6642.55", B: "0" } },
  { e: "24hrTicker", E: 1790908800001, s: "BTCUSDT", p: "100.00", P: "0.150", w: "65000.20", x: "65000.00", c: "65100.00", Q: "0.0100", b: "65099.00", B: "1.220", a: "65100.00", A: "0.77", o: "65000.00", h: "66000.00", l: "64000.00", v: "10345.2300", q: "675332323.11", O: 1790822400000, C: 1790908800000, F: 1, L: 2345, n: 2344 },
  { e: "24hrMiniTicker", E: 1790908800001, s: "BTCUSDT", c: "65100.00", o: "65000.00", h: "66000.00", l: "64000.00", v: "10345.2300", q: "675332323.11" },
  { u: 123456789, s: "BTCUSDT", b: "65100.00", B: "1.00000", a: "65101.00", A: "0.0010" },
  { e: "bookTicker", u: 123456789, s: "BTCUSDT", b: "65100.00", B: "1.00000", a: "65101.00", A: "0.0010", T: 1790908800000, E: 1790908800001 },
  { e: "markPriceUpdate", E: 1790908800001, s: "BTCUSDT", p: "65100.12340000", i: "65110.45000000", P: "65100.77000000", r: "0.00001234", T: 1790910000000 },
];

test("immutable wire protocol matches the shipped desktop decoder", () => {
  // Git/archive materialization may use CRLF or LF. Protocol source must be
  // identical apart from line endings; wire precision remains exact below.
  assert.equal(fs.readFileSync(new URL("../src/market-wire-codec.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
    fs.readFileSync(new URL("../../../youle_desktop/src/main/market-wire-codec.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
});

test("every supported event round trips exact decimal strings, presence and values", () => {
  const encode = createMarketFrameEncoder();
  for (const data of fixtures) for (const combined of [false, true]) {
    const event = { stream: "btcusdt@fixture", data };
    const frame = encode(event, combined, "hmc1");
    assert.equal(frame.codec, "hmc1");
    assert.ok(frame.bytes < frame.jsonBytes);
    assert.deepEqual(decodeMarketPayload(JSON.parse(frame.text)), combined ? event : data);
    assert.strictEqual(encode(event, combined, "hmc1"), frame, "fanout reuses encoding");
    assert.deepEqual(JSON.parse(encode(event, combined).text), combined ? event : data);
  }
});

test("optional fields, nulls, zero and unknown extensions are never lost", () => {
  const encode = createMarketFrameEncoder();
  for (const source of fixtures) {
    for (const key of Object.keys(source).filter((key) => !["e", "k"].includes(key))) {
      for (const value of [undefined, null, false, 0, "0.000000000000000001"]) {
        const data = { ...source, [key]: value };
        if (value === undefined) delete data[key];
        const event = { stream: "btcusdt@test", data };
        assert.deepEqual(decodeMarketPayload(JSON.parse(encode(event, true, "hmc1").text)), event);
      }
    }
    const extended = { stream: "btcusdt@test", data: { ...source, futureField: { a: [null, 0, "001"] } } };
    assert.equal(encode(extended, true, "hmc1").codec, "json");
    assert.deepEqual(decodeMarketPayload(JSON.parse(encode(extended, true, "hmc1").text)), extended);
  }
  const nested = { stream: "btcusdt@kline_1m", data: { ...fixtures[1], k: { ...fixtures[1].k, future: 1 } } };
  assert.equal(encode(nested, true, "hmc1").codec, "json");
  for (const e of ["futureEvent", "constructor", "toString", "__proto__"]) {
    const event = { stream: "btcusdt@test", data: { e, futureField: "001" } };
    assert.deepEqual(decodeMarketPayload(JSON.parse(encode(event, true, "hmc1").text)), event);
  }
  for (const invalid of [["hmc1", "s", 9, 0], ["hmc1", "s", 0, -1], ["hmc1", "s", 0, 1], ["hmc1", "s", 0, 0, 1]]) {
    assert.throws(() => decodeMarketPayload(invalid));
  }
});
