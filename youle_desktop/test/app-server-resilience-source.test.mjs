import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const appServerClientSource = readFile(new URL("../src/main/app-server-client.mjs", import.meta.url), "utf8");

test("main process bounds command output notifications before renderer IPC", async () => {
  const source = await mainSource;

  assert.match(source, /const COMMAND_OUTPUT_DELTA_MAX_CHARS = 80_000;/);
  assert.match(source, /function boundedCodexNotificationForRenderer\(message\)/);
  assert.match(source, /message\.method === "item\/commandExecution\/outputDelta"/);
  assert.match(source, /function boundedCommandOutputDeltaParams\(params\)/);
  assert.match(source, /if \(bounded === decoded\) return params;/);
  assert.match(source, /delete|const \{ data: _data, \.\.\.rest \} = params;/);
  assert.match(source, /sendToRenderer\("codex:notification", boundedCodexNotificationForRenderer\(message\)\);/);
  assert.match(source, /sendToRenderer\("automation:threadNotification", withAutomationNotificationMeta\(boundedCodexNotificationForRenderer\(message\),/);
});

test("app server clients use single-flight start and stop helpers", async () => {
  const source = await mainSource;

  assert.match(source, /async function startAppServerClient\(serverClient\)/);
  assert.match(source, /serverClient\.__youleStartPromise = serverClient\.start\(\)\.finally/);
  assert.match(source, /async function stopAppServerClient\(serverClient\)/);
  assert.match(source, /serverClient\.__youleStopPromise = serverClient\.stop\(\)\.finally/);
  assert.match(source, /existing\.__youleIdleStopReuseRequested = true;/);
  assert.match(source, /await withShutdownTimeout\("idle app-server client", stopAppServerClient\(serverClient\)\);/);
  assert.doesNotMatch(source, /await withShutdownTimeout\("idle app-server client", serverClient\.stop\(\)\);/);
});

test("app server client limits child log fan-out and configures ripgrep guardrails", async () => {
  const source = await appServerClientSource;

  assert.match(source, /const APP_SERVER_LOG_MAX_LINES_PER_CHUNK = 200;/);
  assert.match(source, /function boundedAppServerLogLine\(line\)/);
  assert.match(source, /const RIPGREP_EXCLUDED_GLOBS = \[/);
  assert.match(source, /"node_modules\/\*\*"/);
  assert.match(source, /"dist\/\*\*"/);
  assert.match(source, /"target\/\*\*"/);
  assert.match(source, /RIPGREP_CONFIG_PATH/);
  assert.match(source, /function resolveRipgrepCommand\(baseEnv = \{\}\)/);
});
