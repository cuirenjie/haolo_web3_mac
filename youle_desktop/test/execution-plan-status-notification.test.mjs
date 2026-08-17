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

test("execution plan lifecycle changes use the shared desktop notification path", () => {
  assert.match(
    preloadSource,
    /notifyExecutionPlanStatusChanged:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("app:notifyExecutionPlanStatusChanged", params\)/u,
  );
  assert.match(
    mainSource,
    /ipcMain\.handle\("app:notifyExecutionPlanStatusChanged"[\s\S]*notifyExecutionPlanStatusChanged\(params\)/u,
  );
  const notification = sourceBlock(mainSource, "function notifyExecutionPlanStatusChanged", "async function getTradingAlertService");
  assert.match(notification, /taskCompletionPopupEnabled\(\)/u);
  assert.match(notification, /showDesktopNotificationWindow\(\{ title, body, \.\.\.openContext \}\)/u);
  assert.match(notification, /title = `计划状态已更新 · \$\{planTitle\}`/u);

  const lifecycle = sourceBlock(rendererSource, "async function updateExecutionPlanLifecycle", "async function deleteExecutionPlan");
  assert.match(lifecycle, /notifyExecutionPlanStatusChanged\?\./u);
  assert.match(lifecycle, /statusLabel: executionPlanStatusMeta\(updated\)\.label/u);
  assert.match(lifecycle, /body: statusText/u);
  assert.match(lifecycle, /catch\(\(\) => \{\}\)/u);
});
