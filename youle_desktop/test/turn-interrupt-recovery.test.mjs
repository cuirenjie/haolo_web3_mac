import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  activeTurnMismatchFromError,
  interruptTurnWithActiveMismatchRetry,
} from "../src/main/turn-interrupt-recovery.mjs";

const REQUESTED_TURN_ID = "019f6a35-d23e-76e0-9d20-28ce72a3f8a7";
const ACTIVE_TURN_ID = "019f6a05-9e31-7652-a5d4-aada5bd74a51";

test("active turn mismatch parser only accepts the requested turn", () => {
  const error = new Error(`expected active turn id ${REQUESTED_TURN_ID} but found ${ACTIVE_TURN_ID}`);
  assert.deepEqual(activeTurnMismatchFromError(error, REQUESTED_TURN_ID), {
    expectedTurnId: REQUESTED_TURN_ID,
    activeTurnId: ACTIVE_TURN_ID,
  });
  assert.equal(activeTurnMismatchFromError(error, ACTIVE_TURN_ID), null);
  assert.equal(activeTurnMismatchFromError(new Error("no active turn to interrupt"), REQUESTED_TURN_ID), null);
});

test("interrupt retries exactly once with the backend-reported active turn", async () => {
  const calls = [];
  const mismatches = [];
  const outcome = await interruptTurnWithActiveMismatchRetry({
    turnId: REQUESTED_TURN_ID,
    requestInterrupt: async (turnId) => {
      calls.push(turnId);
      if (calls.length === 1) {
        throw new Error(`expected active turn id \`${REQUESTED_TURN_ID}\` but found \`${ACTIVE_TURN_ID}\``);
      }
      return { ok: true };
    },
    onMismatch: (mismatch) => mismatches.push(mismatch),
  });

  assert.deepEqual(calls, [REQUESTED_TURN_ID, ACTIVE_TURN_ID]);
  assert.deepEqual(mismatches, [{ expectedTurnId: REQUESTED_TURN_ID, activeTurnId: ACTIVE_TURN_ID }]);
  assert.deepEqual(outcome, {
    result: { ok: true },
    interruptedTurnId: ACTIVE_TURN_ID,
    recoveredMismatch: true,
  });
});

test("unrelated interrupt failures are not retried", async () => {
  const expected = new Error("transport disconnected");
  let calls = 0;
  await assert.rejects(
    interruptTurnWithActiveMismatchRetry({
      turnId: REQUESTED_TURN_ID,
      requestInterrupt: async () => {
        calls += 1;
        throw expected;
      },
    }),
    (error) => error === expected,
  );
  assert.equal(calls, 1);
});

test("main and renderer reconcile to the retried turn id", () => {
  const mainSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const mainStart = mainSource.indexOf("async function interruptCodexTurn");
  const mainEnd = mainSource.indexOf("function notificationThreadId", mainStart);
  const rendererStart = rendererSource.indexOf("async function interruptCurrentTurn");
  const rendererEnd = rendererSource.indexOf("function finishInterruptedTurnLocally", rendererStart);
  const completedStart = rendererSource.indexOf('case "turn/completed"');
  const completedEnd = rendererSource.indexOf('case "turn/failed"', completedStart);
  const mainBlock = mainSource.slice(mainStart, mainEnd);
  const rendererBlock = rendererSource.slice(rendererStart, rendererEnd);
  const completedBlock = rendererSource.slice(completedStart, completedEnd);

  assert.match(mainBlock, /interruptTurnWithActiveMismatchRetry/);
  assert.match(mainBlock, /rememberActiveCodexTurn\(threadId, activeTurnId\)/);
  assert.match(mainBlock, /interruptedTurnId: effectiveTurnId/);
  assert.match(mainBlock, /if \(!isTurnInterruptAcknowledgementTimeout\(error\)\)/);
  assert.match(rendererBlock, /result\?\.interruptedTurnId/);
  assert.match(rendererBlock, /finishInterruptedTurnLocally\(threadId, interruptedTurnId, source\)/);
  assert.match(
    rendererBlock,
    /if \(isTurnInterruptAcknowledgementTimeout\(error\)\)[\s\S]*threadsAwaitingAgentReply\.add\(threadId\)[\s\S]*停止请求已发送，后台仍在确认，请稍候。/,
  );
  assert.ok(
    rendererBlock.indexOf("isTurnInterruptAcknowledgementTimeout(error)") <
      rendererBlock.indexOf("interruptedCodexTurnIds.delete(turnId)", rendererBlock.lastIndexOf("catch (error)")),
    "timeout acknowledgement handling must run before generic interrupt rollback",
  );
  assert.match(
    completedBlock,
    /completedTurnStatus === "interrupted"[\s\S]*\(!completedTurnStatus && interruptionWasRequested\)/,
  );
});
