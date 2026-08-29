import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  tradingAnalysisDrawingFocusRange,
  waitForTradingAnalysisViewportPaint,
} from "../src/renderer/trading-analysis-viewport.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
