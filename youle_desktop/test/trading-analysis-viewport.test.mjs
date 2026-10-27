import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  tradingAnalysisDrawingFocusRange,
  tradingAnalysisPlanFocusRange,
  waitForTradingAnalysisViewportPaint,
} from "../src/renderer/trading-analysis-viewport.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test('plan focus excludes old line endpoints and unrelated left context while keeping the recent structure', () => {
  const source = candles();
  const shapes = patchAtIndexes([[528, 549, 566, 580, 599]], source).operations.map(op => op.drawing);
  const levels = [80266.49, 79320.52, 80890.50, 81190.70, 81639.60].map((price, i) => ({
    colorToken: i === 0 ? 'strategy-entry' : i === 1 ? 'strategy-stop' : 'strategy-target',
    points: [{ time: source[20].time, price }, { time: source[599].time, price }],
  }));
  const inputs = structuredClone({ shapes, levels, source });
  const range = tradingAnalysisPlanFocusRange([...shapes, ...levels], source, 1000);
  assert.ok(range.from >= 525 && range.from < 528, JSON.stringify(range));
  assert.ok(range.to > 608, 'reserve space beside the newest candles');
  assert.ok(range.to - range.from < 100, 'roughly 10px+ per candle on this plot');
  assert.deepEqual({ shapes, levels, source }, inputs);
  const narrow = tradingAnalysisPlanFocusRange([...shapes, ...levels], source, 420);
  assert.ok(narrow.to > 599 && narrow.from < 575);
  assert.ok(narrow.to - narrow.from <= 53, 'narrow panes retain readable recent candles');
});

test('historical plans stay historical, while distant projections cannot hide all real candles', () => {
  const source = candles();
  const level = { colorToken: 'strategy-entry', points: [{time:source[200].time,price:100}] };
  const history = tradingAnalysisPlanFocusRange([level, ...patchAtIndexes([[130, 170, 200]],source).operations.map(op=>op.drawing)], source, 1000);
  assert.ok(history.to < 250);
  const future = tradingAnalysisPlanFocusRange([level,{points:[{time:source[580].time,price:100},{time:source[599].time+3600*1000,price:110}]}],source,1000);
  assert.ok(future.from < 599);
  assert.ok(future.to - future.from <= 125);
  const single = tradingAnalysisPlanFocusRange([{...level,points:[{time:source[599].time,price:100}]}],source,1000);
  assert.ok(single.from < 550 && single.to > 599, 'a one-anchor plan still includes enough actual candles');
});

function candles(count = 600) {
  return Array.from({ length: count }, (_, index) => ({ time: 1_800_000_000 + index * 3_600 }));
}

function patchAtIndexes(items, sourceCandles = candles()) {
  return {
    operations: items.map((indexes, operationIndex) => ({
      op: "upsert",
      drawing: {
        id: `drawing-${operationIndex}`,
        tool: indexes.length > 1 ? "path" : "text",
        points: indexes.map((index) => ({ time: sourceCandles[index].time, price: 100 + index })),
      },
    })),
  };
}

test("pre-drawing focus zooms a 600-candle canvas into the recent annotation area", () => {
  const sourceCandles = candles();
  const range = tradingAnalysisDrawingFocusRange(
    patchAtIndexes([[520, 548, 566, 590], [552], [586]], sourceCandles),
    sourceCandles,
    1_040,
  );
  assert.ok(range);
  assert.ok(range.from < 520, "left-side price context should remain visible");
  assert.ok(range.to > 590, "labels need whitespace on the right");
  assert.ok(range.to - range.from <= 112, "candles must remain large enough to read");
  assert.ok(range.from > 450, "irrelevant early history must no longer compress annotations");
});

test("a very long drawing patch favours the newest readable annotation cluster", () => {
  const sourceCandles = candles();
  const range = tradingAnalysisDrawingFocusRange(
    patchAtIndexes([[20, 180, 360, 525, 575], [548, 572], [590]], sourceCandles),
    sourceCandles,
    1_000,
  );
  assert.ok(range);
  assert.ok(range.from > 400);
  assert.ok(range.to >= 599, "a recent analysis keeps the live candle in view");
  assert.ok(range.to - range.from <= 182);
});

test("focus is responsive, reserves context in a narrow split pane, and ignores invalid patches", () => {
  const sourceCandles = candles(160);
  const sourcePatch = patchAtIndexes([[118, 132, 148], [150]], sourceCandles);
  const narrow = tradingAnalysisDrawingFocusRange(sourcePatch, sourceCandles, 420);
  const wide = tradingAnalysisDrawingFocusRange(sourcePatch, sourceCandles, 1_200);
  assert.ok(narrow);
  assert.ok(wide);
  assert.ok(narrow.to - narrow.from >= 48);
  assert.ok(wide.to - wide.from > narrow.to - narrow.from);
  assert.deepEqual(
    tradingAnalysisDrawingFocusRange({ operations: [] }, sourceCandles, 1_000),
    null,
  );
});

test("drawing playback waits for the responsive viewport before painting primary and split charts", () => {
  const market = fs.readFileSync(path.join(root, "src/renderer/trading-expert-market.ts"), "utf8");
  const splitPane = fs.readFileSync(path.join(root, "src/renderer/trading-expert-split-pane.ts"), "utf8");
  const drawing = fs.readFileSync(path.join(root, "src/renderer/trading-expert-drawing.ts"), "utf8");
  assert.match(
    market,
    /playAiDrawingPatch\(patch, \{[\s\S]*?beforePlayback: \(\) => this\.focusAnalysisDrawingPatch\(patch\)/,
  );
  assert.match(
    splitPane,
    /playAiDrawingPatch\(patch, \{[\s\S]*?beforePlayback: \(\) => this\.focusAnalysisDrawingPatch\(patch\)/,
  );
  assert.match(drawing, /await options\.beforePlayback\?\.\(\);[\s\S]*?await this\.aiPlayback\.play\(drawings, options\)/);
  assert.match(market, /focusAnalysisDrawingPatch[\s\S]*?setVisibleLogicalRange\(logicalRange\)/);
  assert.match(splitPane, /focusAnalysisDrawingPatch[\s\S]*?setVisibleLogicalRange\(logicalRange\)/);
});

test("viewport preparation waits for two paint frames before drawing", async () => {
  const frames = [];
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  let completed = false;
  const waiting = waitForTradingAnalysisViewportPaint(scheduler).then(() => {
    completed = true;
  });
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(completed, false);
  assert.equal(frames.length, 1);
  frames.shift()();
  await waiting;
  assert.equal(completed, true);
});
