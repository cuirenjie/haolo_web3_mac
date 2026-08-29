import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, preloadSource, rendererSource] = await Promise.all([
  readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
]);

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("completion popup waits for the renderer to confirm the final reply was painted", () => {
  const queue = sourceBlock(
    mainSource,
    "function notifyTaskTurnCompleted",
    "async function confirmTaskCompletionRendered",
  );
  assert.match(queue, /pendingRenderedTaskCompletionNotifications\.set\(key,/);
  assert.doesNotMatch(queue, /showTaskCompletedSystemNotification/);

  const confirmation = sourceBlock(
    mainSource,
    "async function confirmTaskCompletionRendered",
    "function isFailedTurnCompletionNotification",
  );
  assert.match(confirmation, /pendingRenderedTaskCompletionNotifications\.get\(key\)/);
  assert.match(confirmation, /pendingRenderedTaskCompletionNotifications\.delete\(key\)/);
  assert.match(confirmation, /await showTaskCompletedSystemNotification\(notification\)/);
  assert.match(mainSource, /ipcMain\.handle\("app:confirmTaskCompletionRendered"/);
  assert.match(preloadSource, /confirmTaskCompletionRendered: \(params\) => ipcRenderer\.invoke\("app:confirmTaskCompletionRendered", params\)/);

  const rendererNotifications = sourceBlock(
    rendererSource,
    "function handleNotification",
    "function handleAutomationThreadNotification",
  );
  assert.match(
    rendererNotifications,
    /scheduleBackgroundNotificationRender\(threadId\);\s*if \(message\.method === "turn\/completed"\) confirmTaskCompletionRenderedAfterPaint\(message\);/,
  );
  const paintConfirmation = sourceBlock(
    rendererSource,
    "function confirmTaskCompletionRenderedAfterPaint",
    "function handleAutomationThreadNotification",
  );
  assert.match(paintConfirmation, /document\.visibilityState !== "visible"/);
  assert.match(
    paintConfirmation,
    /window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(confirm\);/,
  );
});
