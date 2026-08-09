import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_TURN_RECOVERY_MARKER,
  TurnAutoRecoveryCoordinator,
  buildAutomaticTurnRecoveryPrompt,
  isRecoverableAutomaticTurnFailure,
} from "../src/main/turn-auto-recovery.mjs";

test("automatic recovery only claims terminal transient failures", () => {
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "stream_disconnected", status: "failed" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "timeout", status: "failed" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "unknown", httpStatus: 503, status: "failed" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "stream_disconnected", status: "interrupted" }), false);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "stream_disconnected", status: "failed", willRetry: true }), false);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "authentication", status: "failed" }), false);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "context_window", status: "failed" }), false);
});

test("recovery prompt reconciles three parallel child agents without replaying the user prompt", () => {
  const prompt = buildAutomaticTurnRecoveryPrompt({
    failedTurnId: "root-turn-1",
    attempt: 2,
    childSummary: { total: 3, running: 1, completed: 1, failed: 1, unknown: 0 },
  });

  assert.match(prompt, new RegExp(AUTOMATIC_TURN_RECOVERY_MARKER));
  assert.match(prompt, /logical continuation, not a replay/i);
  assert.match(prompt, /do not spawn replacements for work that already completed/i);
  assert.match(prompt, /Never repeat an irreversible or externally visible action whose outcome is unknown/i);
  assert.match(prompt, /3 total, 1 running, 1 completed, 1 failed, 0 unknown/);
  assert.doesNotMatch(prompt, /original secret user task/i);
});

test("three-agent disconnect recovery starts one deduplicated continuation with live child state", async () => {
  const timers = fakeTimers();
  const starts = [];
  const events = [];
  const coordinator = new TurnAutoRecoveryCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    startRecovery: async (request) => {
      starts.push(request);
      return { turn: { id: "recovery-turn-1" } };
    },
    onEvent: (event) => events.push(event),
  });

  coordinator.registerChild("root-thread", "child-a");
  coordinator.registerChild("root-thread", "child-b");
  coordinator.registerChild("root-thread", "child-c");
  coordinator.noteChildStatus("child-a", "completed");
  coordinator.noteChildStatus("child-b", "running");
  coordinator.noteChildStatus("child-c", "failed");

  const decision = coordinator.handleTerminalFailure({
    threadId: "root-thread",
    failedTurnId: "root-turn-1",
    errorClass: "stream_disconnected",
    detail: "ResponseStreamDisconnected after websocket closed",
  });
  const duplicate = coordinator.handleTerminalFailure({
    threadId: "root-thread",
    failedTurnId: "root-turn-1",
    errorClass: "stream_disconnected",
    detail: "ResponseStreamDisconnected after websocket closed",
  });

  assert.equal(decision.status, "scheduled");
  assert.equal(decision.delayMs, 1_500);
  assert.equal(duplicate.duplicate, true);
  assert.equal(timers.pending().length, 1);
  timers.runNext();
  await drainMicrotasks();

  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].childSummary, {
    total: 3,
    running: 1,
    completed: 1,
    failed: 1,
    unknown: 0,
  });
  assert.match(starts[0].prompt, /reconcile live state before acting/i);
  assert.equal(events.some((event) => event.event === "started" && event.turnId === "recovery-turn-1"), true);
});

test("repeated no-progress disconnects enter low-frequency recovery instead of abandoning the task", async () => {
  const timers = fakeTimers();
  let startCount = 0;
  const coordinator = new TurnAutoRecoveryCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    recoveryDelaysMs: [10, 20, 30],
    noProgressFailureLimit: 3,
    startRecovery: async () => ({ turn: { id: `recovery-${++startCount}` } }),
  });

  const first = coordinator.handleTerminalFailure(disconnect("turn-1"));
  assert.equal(first.status, "scheduled");
  assert.equal(first.delayMs, 10);
  timers.runNext();
  await drainMicrotasks();

  const second = coordinator.handleTerminalFailure(disconnect("turn-2"));
  assert.equal(second.status, "scheduled");
  assert.equal(second.delayMs, 20);
  timers.runNext();
  await drainMicrotasks();

  const third = coordinator.handleTerminalFailure(disconnect("turn-3"));
  assert.equal(third.status, "cooling_down");
  assert.equal(third.delayMs, 60_000);
  assert.equal(timers.pending().length, 1);
  timers.runNext();
  await drainMicrotasks();

  const fourth = coordinator.handleTerminalFailure(disconnect("turn-4"));
  assert.equal(fourth.status, "cooling_down");
  assert.equal(timers.pending().length, 1);
  assert.equal(startCount, 3);
});

test("durable progress resets the no-progress backoff and a user turn cancels pending recovery", () => {
  const timers = fakeTimers();
  const coordinator = new TurnAutoRecoveryCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    recoveryDelaysMs: [10, 20, 30],
    startRecovery: async () => ({ turn: { id: "unused" } }),
  });

  coordinator.handleTerminalFailure(disconnect("turn-1"));
  coordinator.noteProgress("root-thread");
  const afterProgress = coordinator.handleTerminalFailure(disconnect("turn-2"));
  assert.equal(afterProgress.noProgressFailures, 1);
  assert.equal(afterProgress.delayMs, 10);
  coordinator.noteUserTurn("root-thread");
  assert.equal(timers.pending().length, 0);
});

function disconnect(failedTurnId) {
  return {
    threadId: "root-thread",
    failedTurnId,
    errorClass: "stream_disconnected",
    detail: "ResponseStreamDisconnected while reading response",
    status: "failed",
  };
}

function fakeTimers() {
  let sequence = 0;
  const tasks = [];
  return {
    setTimer(callback, delayMs) {
      const task = { id: ++sequence, callback, delayMs, cancelled: false };
      tasks.push(task);
      return task;
    },
    clearTimer(task) {
      if (task) task.cancelled = true;
    },
    pending() {
      return tasks.filter((task) => !task.cancelled);
    },
    runNext() {
      const task = tasks.find((candidate) => !candidate.cancelled);
      assert.ok(task, "expected a scheduled recovery timer");
      task.cancelled = true;
      task.callback();
    },
  };
}

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}
