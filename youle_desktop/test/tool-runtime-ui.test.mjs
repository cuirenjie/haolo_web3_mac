import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("Haolo owns the tool runtime lifecycle in the background and retries failures", async () => {
  const [main, preload] = await Promise.all([mainSource, preloadSource]);

  assert.match(main, /new ToolRuntimeManager\(/);
  assert.match(main, /await initializeToolRuntimeManager\(\)/);
  assert.match(main, /void prewarmToolRuntime\(\)/);
  assert.match(main, /catch \(error\) \{[\s\S]{0,400}scheduleToolRuntimeRetry\(\)/);
  assert.match(main, /TOOL_RUNTIME_RETRY_BASE_DELAY_MS = 30_000/);
  assert.match(main, /TOOL_RUNTIME_RETRY_MAX_DELAY_MS = 15 \* 60_000/);
  assert.match(main, /TOOL_RUNTIME_RETRY_BASE_DELAY_MS \* \(2 \*\* Math\.min\(toolRuntimeRetryAttempt, 10\)\)/);
  assert.match(main, /TOOL_RUNTIME_RETRY_MAX_DELAY_MS/);
  assert.match(main, /toolRuntimeRetryTimer\.unref\?\.\(\)/);
  assert.match(main, /clearToolRuntimeRetry\(\)/);
  assert.match(main, /__youleToolRuntimeSignature/);
  assert.doesNotMatch(main, /ipcMain\.handle\("app:(?:get|repair|open)ToolRuntime/);
  assert.doesNotMatch(preload, /ToolRuntime/);
});

test("tool runtime is not exposed as a settings page in either theme", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);

  assert.doesNotMatch(renderer, /data-settings-tab="runtime"/);
  assert.doesNotMatch(renderer, /renderToolRuntimeSettingsPanel/);
  assert.doesNotMatch(renderer, /settings-runtime-/);
  assert.doesNotMatch(styles, /\.settings-runtime-/);
});
