import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildLocalProxyRecoveryReplayText,
  canReplayLocalProxyFailure,
  isLocalProxyConnectionRefusedError,
  isLocalProxyRecoveryReplayText,
} from "../src/renderer/local-proxy-recovery.ts";

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("only connection-refused failures qualify for local proxy recovery", () => {
  assert.equal(isLocalProxyConnectionRefusedError("IO error: os error 10061"), true);
  assert.equal(isLocalProxyConnectionRefusedError("connect ECONNREFUSED 127.0.0.1:7897"), true);
  assert.equal(isLocalProxyConnectionRefusedError("failed to connect to websocket"), true);
  assert.equal(isLocalProxyConnectionRefusedError("request timed out"), false);
  assert.equal(isLocalProxyConnectionRefusedError("HTTP 401 unauthorized"), false);
});

test("local proxy recovery replays exactly once and hides its transport wrapper", () => {
  const request = "请继续完成原来的任务";
  const replay = buildLocalProxyRecoveryReplayText(request);

  assert.equal(replay.includes(request), true);
  assert.equal(isLocalProxyRecoveryReplayText(replay), true);
  assert.equal(isLocalProxyRecoveryReplayText(request), false);
  assert.equal(canReplayLocalProxyFailure(0), true);
  assert.equal(canReplayLocalProxyFailure(1), false);
  assert.equal(canReplayLocalProxyFailure(2), false);
});

test("main process verifies the proxy, protects concurrent turns, and serializes runtime restart", () => {
  const handler = sourceBlock(
    main,
    'ipcMain.handle("codex:recoverUnavailableLocalProxy"',
    'ipcMain.handle("codex:getStatus"',
  );

  assert.match(preload, /recoverUnavailableLocalProxy/);
  assert.match(handler, /sanitizeAppServerProxyEnv\(process\.env\)/);
  assert.match(handler, /otherActiveThreadIds/);
  assert.match(handler, /pendingRequestCount/);
  assert.match(handler, /other-turns-active/);
  assert.match(handler, /__youleLocalProxyRecoveryPromise/);
  assert.ok(handler.indexOf("stopAppServerClient") < handler.indexOf("startAppServerClient"));
});

test("renderer suppresses the failed terminal only while one verified recovery is queued", () => {
  const completed = sourceBlock(renderer, 'case "turn/completed":', 'case "turn/failed":');
  const failed = sourceBlock(renderer, 'case "turn/failed":', 'case "item/started":');
  const recovery = sourceBlock(
    renderer,
    "function queueLocalProxyRecovery",
    "// HAOLO-CONTEXT-RECOVERY-PATCH-END",
  );
  const sanitizer = sourceBlock(
    renderer,
    "function sanitizeIncomingThreadItem",
    "function sanitizeProcessItemText",
  );

  assert.match(completed, /queueLocalProxyRecovery\(threadId, completedTurnId, completedTurnFailureReason\)/);
  assert.match(completed, /!localProxyRecoveryQueued/);
  assert.match(failed, /queueLocalProxyRecovery\(threadId, failedTurnId, reason\)/);
  assert.match(recovery, /canReplayLocalProxyFailure\(replay\.localProxyRecoveryReplayCount\)/);
  assert.match(recovery, /api\.recoverUnavailableLocalProxy/);
  assert.match(recovery, /localProxyRecoveryReplayCount:\s*replay\.localProxyRecoveryReplayCount \+ 1/);
  assert.match(sanitizer, /isLocalProxyRecoveryReplayText/);
  assert.match(sanitizer, /__youleLocalProxyRecoveryReplay/);
});
