import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = readFileSync(new URL("../deploy/single-node/gateway-watchdog.sh", import.meta.url), "utf8");
const shellOptions = { skip: process.platform === "win32" ? "watchdog runs on Bash deployment hosts" : false };
const validState = "PUBLIC_PORT=18787\nPRIVATE_PORT=18788\nCONTAINER=active-release\n";

function runWatchdog(t, state, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "haolo-watchdog-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const log = path.join(root, "commands.log");
  mkdirSync(bin);
  writeFileSync(log, "");
  if (state !== null) writeFileSync(path.join(root, "active.env"), state);
  const executable = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  executable("flock", 'test "$HAOLO_TEST_LOCKED" != 1');
  executable("sleep", "exit 0");
  executable("curl", `printf '%s\n' "curl $*" >> "$HAOLO_TEST_LOG"
test "$HAOLO_TEST_READY" = 1 || test -f "$HAOLO_TEST_RECOVERED"`);
  executable("docker", `printf '%s\n' "docker $*" >> "$HAOLO_TEST_LOG"
case "$1" in
  inspect)
    if [ "$2" = --format ]; then printf '%s\n' "$HAOLO_TEST_REDIS_HEALTH"; exit 0; fi
    test "$HAOLO_TEST_MISSING" != 1;;
  restart)
    test "$2" = active-release || exit 99
    touch "$HAOLO_TEST_RECOVERED";;
  compose)
    case "$*" in
      *'ps -q redis') echo redis-test;;
      *'restart gateway') exit 99;;
      *'restart redis') exit 0;;
    esac;;
esac`);
  const copy = script
    .replace('readonly COMPOSE_DIR="/opt/haolo/services/haolo-binance-gateway"', `readonly COMPOSE_DIR="${root}"`)
    .replace('readonly DEPLOY_LOCK="/run/lock/haolo-gateway-deploy.lock"', `readonly DEPLOY_LOCK="${root}/deploy.lock"`)
    .replace('readonly ACTIVE_STATE="/var/lib/haolo/gateway-active.env"', `readonly ACTIVE_STATE="${root}/active.env"`);
  const filename = path.join(root, "watchdog.sh");
  writeFileSync(filename, copy);
  const result = spawnSync("bash", [filename], {
    encoding: "utf8", timeout: 10_000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      HAOLO_TEST_LOG: log, HAOLO_TEST_RECOVERED: path.join(root, "recovered"),
      HAOLO_TEST_LOCKED: options.locked ? "1" : "0",
      HAOLO_TEST_READY: options.ready ? "1" : "0",
      HAOLO_TEST_MISSING: options.missing ? "1" : "0",
      HAOLO_TEST_REDIS_HEALTH: options.redisHealth || "healthy",
    },
  });
  assert.ifError(result.error);
  return { ...result, commands: readFileSync(log, "utf8") };
}

test("watchdog rejects missing, partial, duplicate and invalid state before side effects", shellOptions, async (t) => {
  for (const [name, state] of [
    ["missing file", null], ["empty file", ""],
    ["missing container", "PUBLIC_PORT=18787\nPRIVATE_PORT=18788\n"],
    ["missing port", "PUBLIC_PORT=18787\nCONTAINER=active-release\n"],
    ["duplicate port", `${validState}PUBLIC_PORT=8787\n`],
    ["duplicate container", `${validState}CONTAINER=legacy\n`],
    ["invalid container", validState.replace("active-release", "$(touch should-not-run)")],
    ["option-shaped container", validState.replace("active-release", "--help")],
    ["port above range", validState.replace("18787", "65536")],
    ["zero port", validState.replace("18787", "0")],
    ["identical ports", validState.replace("18787", "18788")],
  ]) {
    await t.test(name, (t) => {
      const result = runWatchdog(t, state);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /refusing legacy fallback/);
      assert.equal(result.commands, "", "invalid state must not inspect, probe, restart Redis or restart a gateway");
    });
  }
});

test("watchdog checks both active ports and leaves a healthy deployment running", shellOptions, (t) => {
  const result = runWatchdog(t, validState, { ready: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /127\.0\.0\.1:18787\/ready/);
  assert.match(result.commands, /127\.0\.0\.1:18788\/ready/);
  assert.doesNotMatch(result.commands, /restart|127\.0\.0\.1:878[78]/);
});

test("watchdog restarts only the registered active container when Redis is healthy", shellOptions, (t) => {
  const result = runWatchdog(t, validState);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /docker restart active-release/);
  assert.doesNotMatch(result.commands, /restart gateway|restart redis/);
  assert.match(result.stdout, /readiness recovered/);
});

test("watchdog still recovers Redis before restarting the registered active container", shellOptions, (t) => {
  const result = runWatchdog(t, validState, { redisHealth: "unhealthy" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /restart redis[\s\S]*docker restart active-release/);
  assert.doesNotMatch(result.commands, /restart gateway/);
});

test("a missing active container prevents probes and every restart", shellOptions, (t) => {
  const result = runWatchdog(t, validState, { missing: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /container active-release is missing/);
  assert.doesNotMatch(result.commands, /curl|restart/);
});

test("the deployment lock still skips the entire watchdog tick", shellOptions, (t) => {
  const result = runWatchdog(t, null, { locked: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deployment lock is held/);
  assert.equal(result.commands, "");
});
