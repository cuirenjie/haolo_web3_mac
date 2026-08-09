import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

test("a completed custom window resize schedules one final repaint", () => {
  const handlerStart = mainSource.indexOf('ipcMain.handle("window:resize"');
  const handlerEnd = mainSource.indexOf('ipcMain.handle("window:move"', handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);

  const handler = mainSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /const result = applyWindowResize\(window, params, \{ live: false \}\);/);
  assert.match(handler, /finishWindowLiveResize\(window\);/);
  assert.match(
    handler,
    /if \(result\?\.ok && !window\.webContents\.isDestroyed\(\)\) \{\s*window\.webContents\.invalidate\(\);\s*\}/,
  );
});
