import assert from "node:assert/strict";
import test from "node:test";
import { TradingPublicIndices } from "../src/renderer/trading-public-indices.ts";

function fixture(api) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = new EventTarget();
  document.hidden = false;
  const intervals = new Map();
  let sequence = 0;
  globalThis.document = document;
  globalThis.window = { codexDesktop: { getPublicMarketIndices: api }, setInterval: (fn, ms) => { intervals.set(++sequence, { fn, ms }); return sequence; }, clearInterval: id => intervals.delete(id) };
  let paints = 0;
  const indices = new TradingPublicIndices(() => paints++);
  return { indices, document, intervals, paints: () => paints, cleanup() {
    indices.destroy();
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  } };
}
const snapshot = { fetchedAt: 1, indices: [{ id: "alternative:fng", value: 0, status: "ready", series: [] }] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("indices preload silently before selecting the category, reuse data on switching and stay warm in the background", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return snapshot; });
  try {
    assert.equal(calls, 0);
    f.indices.start();
    f.indices.start();
    await flush();
    assert.equal(calls, 1);
    assert.equal(f.intervals.size, 1);
    assert.equal(f.paints(), 0, "background preloading must not rebuild the current list");
    assert.equal(f.intervals.values().next().value.ms, 300_000);
    assert.equal(f.indices.indices[0].value, 0);
    f.indices.setActive(true);
    await flush();
    assert.equal(calls, 1, "switching tabs uses the already loaded data");
    assert.equal(f.intervals.values().next().value.ms, 60_000);
    f.document.hidden = true;
    for (const { fn } of f.intervals.values()) fn();
    await flush();
    assert.equal(calls, 1);
    f.document.hidden = false;
    f.document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    assert.equal(calls, 2);
    assert.equal(f.paints(), 1);
    f.indices.setActive(false);
    assert.equal(f.intervals.size, 1);
    assert.equal(f.intervals.values().next().value.ms, 300_000);
    for (const { fn } of f.intervals.values()) fn();
    await flush();
    assert.equal(calls, 3);
    assert.equal(f.paints(), 1);
    f.indices.destroy();
    assert.equal(f.intervals.size, 0);
    f.document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    assert.equal(calls, 3);
  } finally { f.cleanup(); }
});

test("UI does not stack requests or repaint a destroyed panel when an in-flight request completes", async () => {
  let resolve;
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise(done => { resolve = done; }); });
  try {
    const request = f.indices.refresh();
    await f.indices.refresh();
    assert.equal(calls, 1);
    assert.equal(f.paints(), 0, "no loading repaint");
    f.indices.destroy();
    const paints = f.paints();
    resolve(snapshot);
    await request;
    assert.equal(f.paints(), paints);
    assert.equal(f.indices.indices.length, 0);
  } finally { f.cleanup(); }
});

test("UI retains valid zero as stale on transport failure, and recovers on retry", async () => {
  let fail = false;
  const f = fixture(async () => { if (fail) throw Error("offline"); return snapshot; });
  try {
    await f.indices.refresh();
    fail = true;
    await f.indices.refresh();
    assert.equal(f.indices.indices[0].value, 0);
    assert.equal(f.indices.indices[0].status, "stale");
    assert.equal(f.indices.failed, true);
    fail = false;
    await f.indices.refresh();
    assert.equal(f.indices.indices[0].status, "ready");
    assert.equal(f.indices.failed, false);
  } finally { f.cleanup(); }
});

test("an older development preload without the new IPC reports unavailable, with no invented rows", async () => {
  const f = fixture(undefined);
  try {
    await f.indices.refresh();
    assert.equal(f.indices.failed, true);
    assert.equal(f.indices.loading, false);
    assert.deepEqual(f.indices.indices, []);
  } finally { f.cleanup(); }
});
