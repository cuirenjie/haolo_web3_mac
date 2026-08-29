import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("gateway retry notifications stay out of the chat transcript", () => {
  const notifications = sourceBlock(renderer, "function handleNotification", "function formatTurnFailureMessage");
  const errorCase = sourceBlock(notifications, 'case "error":', "default:");

  assert.match(errorCase, /willRetry === true/);
  assert.match(errorCase, /will_retry === true/);
  assert.doesNotMatch(errorCase, /addSystemItem/);
});

test("terminal gateway failures distinguish network rejection, proxy failure, timeout, and generic failure", () => {
  const formatter = sourceBlock(renderer, "function formatTurnFailureMessage", "function isInternalSubagentThreadRecordForRenderer");
  const completedTurn = sourceBlock(renderer, 'case "turn\/completed":', 'case "turn\/failed":');
  const hydration = sourceBlock(renderer, "async function hydrateCompletedTurn", "function hasAgentReplyForTurn");

  assert.match(formatter, /网络连接被拒绝。请检查代理或网络后重试。/);
  assert.match(formatter, /代理连接失败。请启动代理或清除无效代理后重试。/);
  assert.match(formatter, /等待模型响应超时，本轮已停止。请重试。/);
  assert.match(formatter, /本轮执行失败，请重试。/);
  assert.match(completedTurn, /failureMessage: completedTurnFailureMessage/);
  assert.match(hydration, /options\.failureMessage \|\|/);
});

test("a proven full context is latched and automatically recovers the same turn", () => {
  const formatter = sourceBlock(renderer, "function markThreadContextWindowExhausted", "function isInternalSubagentThreadRecordForRenderer");
  const completedTurn = sourceBlock(renderer, 'case "turn\/completed":', 'case "turn\/failed":');
  const failedTurn = sourceBlock(renderer, 'case "turn\/failed":', 'case "item\/started":');
  const hydration = sourceBlock(renderer, "async function hydrateCompletedTurn", "function hasAgentReplyForTurn");

  assert.match(formatter, /context\.contextWindowExhausted = true/);
  assert.match(formatter, /context\.usedTokens = Math\.max\(context\.usedTokens \?\? 0, modelContextWindow\)/);
  assert.match(completedTurn, /markThreadContextWindowExhausted\(threadId, completedTurnId\)/);
  assert.match(completedTurn, /queueContextWindowRecovery\(threadId, completedTurnId, completedTurnFailureReason\)/);
  assert.match(completedTurn, /!contextRecoveryQueued/);
  assert.match(completedTurn, /contextWindowExhausted: completedTurnContextWindowExhausted/);
  assert.match(failedTurn, /markThreadContextWindowExhausted\(threadId, failedTurnId\)/);
  assert.match(failedTurn, /queueContextWindowRecovery\(threadId, failedTurnId, reason\)/);
  assert.match(hydration, /options\.contextWindowExhausted/);
  assert.match(hydration, /markThreadContextWindowExhausted\(threadId, turnId\)/);
});
