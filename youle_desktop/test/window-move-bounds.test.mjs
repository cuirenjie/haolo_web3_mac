import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { constrainWindowMoveBoundsToWorkArea } from "../src/main/window-bounds.mjs";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

test("window movement remains unchanged while the full window is visible", () => {
  assert.deepEqual(
    constrainWindowMoveBoundsToWorkArea({ x: 200, y: 100, width: 1280, height: 860 }, workArea),
    { x: 200, y: 100, width: 1280, height: 860 },
  );
});

test("window movement stops once only one fifth remains visible at every edge", () => {
  assert.deepEqual(
    constrainWindowMoveBoundsToWorkArea({ x: -5000, y: -4000, width: 1280, height: 860 }, workArea),
    { x: -1024, y: -688, width: 1280, height: 860 },
  );
  assert.deepEqual(
    constrainWindowMoveBoundsToWorkArea({ x: 5000, y: 4000, width: 1280, height: 860 }, workArea),
    { x: 1664, y: 868, width: 1280, height: 860 },
  );
});

test("window movement supports displays with negative virtual-screen coordinates", () => {
  assert.deepEqual(
    constrainWindowMoveBoundsToWorkArea(
      { x: -5000, y: -2000, width: 1200, height: 800 },
      { x: -1920, y: 0, width: 1920, height: 1040 },
    ),
    { x: -2880, y: -640, width: 1200, height: 800 },
  );
});

test("an oversized window also keeps one fifth visible when possible", () => {
  assert.deepEqual(
    constrainWindowMoveBoundsToWorkArea(
      { x: 9000, y: 9000, width: 2200, height: 1200 },
      workArea,
    ),
    { x: 1480, y: 800, width: 2200, height: 1200 },
  );
});

test("both custom and native titlebar dragging use the work-area constraint", () => {
  assert.match(
    mainSource,
    /mainWindow\.on\("will-move",[\s\S]*?constrainWindowMoveBounds\(window, nextBounds, screen\.getCursorScreenPoint\(\)\)/,
  );

  const moveHandlerStart = mainSource.indexOf("function applyWindowMove");
  const moveHandlerEnd = mainSource.indexOf("function normalizeResizePoint", moveHandlerStart);
  assert.notEqual(moveHandlerStart, -1);
  assert.notEqual(moveHandlerEnd, -1);
  assert.match(
    mainSource.slice(moveHandlerStart, moveHandlerEnd),
    /const nextBounds = constrainWindowMoveBounds\(window, requestedBounds, point\);/,
  );
});
