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

test("repeated failures cool down and stop after three model recovery attempts", async () => {
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
  assert.equal(fourth.status, "exhausted");
  assert.equal(timers.pending().length, 0);
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

test("overload and generic failed turns recover but hard failures override transient labels", () => {
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "overloaded", status: "failed", detail: "Selected model is at capacity" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "unknown", status: "failed" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "stream_disconnected", detail: "INVALID_API_KEY", status: "failed" }), false);
});

test("late terminals, child activity, cancellation and a new user turn cannot revive old recovery", async () => {
  const timers = fakeTimers();
  const events = [];
  let finishStart, activeCheck;
  const coordinator = new TurnAutoRecoveryCoordinator({
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    startRecovery: ({ isCurrent }) => { activeCheck = isCurrent; return new Promise((resolve) => { finishStart = resolve; }); },
    onEvent: (event) => events.push(event),
  });
  coordinator.noteUserTurn("root-thread");
  assert.equal(coordinator.handleTerminalFailure(disconnect("old-turn")).status, "ignored");
  coordinator.noteTurnStarted("root-thread", "current-turn");
  coordinator.registerChild("root-thread", "child");
  coordinator.noteTurnStarted("child", "child-turn");
  coordinator.noteSuccessfulTurn("child", "child-turn");
  assert.equal(coordinator.handleTerminalFailure(disconnect("old-turn")).status, "ignored");
  const decision = coordinator.handleTerminalFailure(disconnect("current-turn"));
  assert.equal(decision.status, "scheduled");
  assert.equal(decision.modelId, "gpt-5.5");
  assert.equal(decision.reasoningEffort, "xhigh");
  timers.runNext();
  await drainMicrotasks();
  assert.equal(activeCheck(), true);
  coordinator.cancel("root-thread");
  assert.equal(activeCheck(), false);
  finishStart({ turn: { id: "late-recovery" } });
  await drainMicrotasks();
  assert.equal(events.some((event) => event.event === "started"), false);
  assert.equal(coordinator.handleTerminalFailure(disconnect("late-recovery")).status, "ignored");
  coordinator.noteUserTurn("root-thread");
  coordinator.noteTurnStarted("root-thread", "new-turn");
  coordinator.noteSuccessfulTurn("root-thread", "current-turn");
  assert.equal(coordinator.handleTerminalFailure(disconnect("new-turn")).status, "scheduled");
  coordinator.noteSuccessfulTurn("root-thread", "new-turn");
  assert.equal(coordinator.handleTerminalFailure(disconnect("new-turn")).status, "ignored");
  assert.equal(timers.pending().length, 0);
});

test("a hard recovery start failure ends the chain and publishes an honest terminal notice", async () => {
  const timers = fakeTimers(), events = [];
  const coordinator = new TurnAutoRecoveryCoordinator({
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    startRecovery: async () => { throw Object.assign(new Error("request failed"), { code: "INVALID_API_KEY" }); },
    onEvent: (event) => events.push(event),
  });
  coordinator.handleTerminalFailure(disconnect("first-turn"));
  timers.runNext();
  await drainMicrotasks();
  assert.equal(timers.pending().length, 0);
  assert.equal(events.at(-1).status, "exhausted");
  assert.equal(events.at(-1).failedToStart, true);
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
