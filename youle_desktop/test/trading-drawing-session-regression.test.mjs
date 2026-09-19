import assert from "node:assert/strict";
import test from "node:test";
import { TradingDrawingController, tradingDrawingSessionStorageKey } from "../src/renderer/trading-expert-drawing.ts";

const line = (id, drawingScope = "main") => ({ id, drawingScope, tool: "trend-line", symbol: "BTCUSDT", interval: "60", points: [{ time: 100, price: 10 }, { time: 200, price: 20 }] });
const noop = () => {};
function setup(t, records = []) {
  const oldWindow = globalThis.window;
  const values = new Map();
  const session = `drawing-regression-${Math.random()}`;
  const key = tradingDrawingSessionStorageKey("manual", session);
  values.set(key, JSON.stringify(records));
  globalThis.window = { localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } };
  const live = new Set();
  function create(scope, sessionId = session) {
    // Run production session/persistence/undo/clear methods. Only DOM painting
    // and input boundaries are replaced; the shared store is not mocked.
    const instance = Object.assign(Object.create(TradingDrawingController.prototype), {
      storageSessionId: sessionId, drawingScope: scope, pendingTextDrawingId: null,
      aiDrawings: [], redoStack: [], selectedDrawingId: null,
      aiPlayback: { cancel: noop }, overlay: { classList: { remove: noop } },
      redraw: noop, updateToolbarState: noop, releasePointer: noop,
      finishSelectionToolbarDrag: noop, cancelDragRedraw: noop,
      closeSelectionMenus: noop, hideAiTextSizeToolbar: noop,
      onAiDrawingContextsChanged: noop, setStatus: noop,
      getSymbol: () => "BTCUSDT", getInterval: () => "60",
    });
    instance.joinManualDrawingSession();
    live.add(instance);
    return instance;
  }
  function leave(instance) { instance.leaveManualDrawingSession(); live.delete(instance); }
  t.after(() => { live.forEach(leave); globalThis.window = oldWindow; });
  return { create, leave, values, key, session, stored: () => JSON.parse(values.get(key) || "[]") };
}

test("interleaved main/RSI writes, undo and redo retain both scopes after a cold reload", t => {
  const h = setup(t);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  main.drawings.push(line("main")); main.persistDrawings();
  rsi.drawings.push(line("rsi", "indicator:rsi")); rsi.persistDrawings();
  assert.deepEqual(h.stored().map(d => d.id), ["main", "rsi"]);
  main.undo();
  assert.deepEqual(h.stored().map(d => d.id), ["rsi"]);
  rsi.drawings[0].points[0].price = 12; rsi.persistDrawings();
  main.redo();
  assert.deepEqual(h.stored().map(d => d.id), ["rsi", "main"]);
  h.leave(main); h.leave(rsi);
  assert.deepEqual(h.create("main").drawings.map(d => d.id), ["rsi", "main"]);
});

test("legacy records and closed indicator scopes survive opening and rebuilding a pane", t => {
  const legacy = line("legacy"); delete legacy.drawingScope;
  const h = setup(t, [legacy, line("hidden", "indicator:macd")]);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  main.drawings.push(line("new")); main.persistDrawings();
  h.leave(rsi);
  const rebuilt = h.create("indicator:rsi");
  rebuilt.drawings.push(line("rsi", "indicator:rsi")); rebuilt.persistDrawings();
  assert.deepEqual(h.stored().map(d => d.id), ["legacy", "hidden", "new", "rsi"]);
});

test("scope clear preserves main drawings; session clear clears peers and their redo histories", t => {
  const h = setup(t, [line("main"), line("rsi", "indicator:rsi")]);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  rsi.clearAllDrawings();
  assert.deepEqual(h.stored().map(d => d.id), ["main"]);
  rsi.drawings.push(line("rsi2", "indicator:rsi")); rsi.persistDrawings(); rsi.undo();
  assert.equal(rsi.redoStack.length, 1);
  main.clearAllDrawings();
  assert.deepEqual(rsi.drawings, []);
  assert.deepEqual(rsi.redoStack, []);
  rsi.redo(); rsi.persistDrawings();
  assert.deepEqual(h.stored(), []);
});

test("saving in another pane excludes pending text until it is confirmed", t => {
  const h = setup(t);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  rsi.drawings.push({ ...line("pending", "indicator:rsi"), tool: "text", text: "" });
  rsi.pendingTextDrawingId = "pending";
  main.drawings.push(line("main")); main.persistDrawings();
  assert.deepEqual(h.stored().map(d => d.id), ["main"]);
  rsi.drawings[0].text = "RSI level"; rsi.pendingTextDrawingId = null; rsi.persistDrawings();
  assert.deepEqual(h.stored().map(d => d.id), ["pending", "main"]);
});

test("session promotion retains all scopes and destination records without overwriting main AI data", t => {
  const h = setup(t, [line("main"), line("hidden", "indicator:macd")]);
  const destination = `${h.session}-promoted`;
  const destKey = tradingDrawingSessionStorageKey("manual", destination);
  h.values.set(destKey, JSON.stringify([line("destination")]));
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  rsi.drawings.push(line("rsi", "indicator:rsi")); rsi.persistDrawings();
  main.aiDrawings = [line("ai")];
  main.switchStorageSession(destination, { migrateFromSessionId: h.session });
  rsi.switchStorageSession(destination, { migrateFromSessionId: h.session });
  assert.deepEqual(JSON.parse(h.values.get(destKey)).map(d => d.id), ["main", "hidden", "rsi", "destination"]);
  assert.equal(h.values.has(h.key), false);
  assert.deepEqual(JSON.parse(h.values.get(tradingDrawingSessionStorageKey("ai", destination))).map(d => d.id), ["ai"]);
  rsi.drawings.push(line("after", "indicator:rsi")); rsi.persistDrawings();
  assert.equal(main.drawings.at(-1).id, "after");
});

test("switching without migration isolates sessions and restores the original drawings", t => {
  const h = setup(t, [line("original")]);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  main.switchStorageSession(`${h.session}-other`);
  main.drawings.push(line("other")); main.persistDrawings();
  assert.deepEqual(rsi.drawings.map(d => d.id), ["original"]);
  main.switchStorageSession(h.session);
  assert.deepEqual(main.drawings.map(d => d.id), ["original"]);
});

test("promotion never persists unconfirmed text from a peer controller", t => {
  const h = setup(t, [line("main")]);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  rsi.drawings.push({ ...line("pending", "indicator:rsi"), tool: "text" });
  rsi.pendingTextDrawingId = "pending";
  const destination = `${h.session}-promoted`;
  main.switchStorageSession(destination, { migrateFromSessionId: h.session });
  rsi.switchStorageSession(destination, { migrateFromSessionId: h.session });
  const persisted = JSON.parse(h.values.get(tradingDrawingSessionStorageKey("manual", destination)));
  assert.deepEqual(persisted.map(d => d.id), ["main"]);
});

test("storage failure leaves drawings in memory and keeps the original migration backup", t => {
  const h = setup(t, [line("main")]);
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  globalThis.window.localStorage.setItem = () => { throw new Error("quota exceeded"); };
  rsi.drawings.push(line("rsi", "indicator:rsi"));
  assert.equal(rsi.persistDrawings(), false);
  assert.equal(main.drawings.at(-1).id, "rsi");
  main.switchStorageSession(`${h.session}-promoted`, { migrateFromSessionId: h.session });
  assert.equal(h.values.has(h.key), true);
  assert.deepEqual(main.drawings.map(d => d.id), ["main", "rsi"]);
});

test("main plot follows its pane height while indicators use their own plot wrappers", t => {
  const h = setup(t);
  let paneHeight = 360;
  const main = h.create("main"), rsi = h.create("indicator:rsi");
  const element = height => ({ clientWidth: 1000, clientHeight: height, getBoundingClientRect: () => ({ height }) });
  main.chartElement = element(600); main.paneIndex = 0;
  main.getChart = () => ({ options: () => ({ height: 600 }), timeScale: () => ({ width: () => 940 }), panes: () => [{ getHeight: () => paneHeight }, { getHeight: () => 180 }] });
  rsi.chartElement = element(180); rsi.getChart = main.getChart; rsi.paneIndex = 1;
  assert.deepEqual(main.plotBounds(), { width: 940, height: 360 });
  assert.deepEqual(rsi.plotBounds(), { width: 940, height: 180 });
  paneHeight = 240;
  assert.equal(main.plotBounds().height, 240);
  main.getChart = () => null;
  assert.equal(main.plotBounds().height, 600);
});
