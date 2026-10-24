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







test("overload and generic failed turns recover but hard failures override transient labels", () => {
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "overloaded", status: "failed", detail: "Selected model is at capacity" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "unknown", status: "failed" }), true);
  assert.equal(isRecoverableAutomaticTurnFailure({ errorClass: "stream_disconnected", detail: "INVALID_API_KEY", status: "failed" }), false);
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



test('automatic GPT recovery is disabled across lifecycle and error states',async()=>{
 const timers=fakeTimers();let starts=0;const c=new TurnAutoRecoveryCoordinator({setTimer:timers.setTimer,clearTimer:timers.clearTimer,startRecovery:async()=>{starts++}});
 c.registerChild('root','child');c.noteTurnStarted('root','turn');
 for(const errorClass of ['timeout','stream_disconnected','rate_limit','unknown','auth'])for(const threadId of ['root','child']){
  for(let i=0;i<3;i++)assert.deepEqual(c.handleTerminalFailure({threadId,failedTurnId:'turn',status:'failed',errorClass}),{status:'ignored'});
 }
 c.noteProgress('root');c.noteUserTurn('root');c.cancel('root');c.shutdown();
 await drainMicrotasks();assert.equal(starts,0);assert.equal(timers.pending().length,0);
});
