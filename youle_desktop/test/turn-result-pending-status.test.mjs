import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("interrupted turn result headers reuse the pending consumption status and hide elapsed time", async () => {
  const renderer = await rendererSource;
  const decorator = sourceBlock(renderer, "function withCollapsedTurnResults", "function isTurnResultGroupComplete");
  const status = sourceBlock(renderer, "function cachedConsumptionStatusForTurn", "function turnResultElapsedLabel");
  const elapsed = sourceBlock(renderer, "function turnResultElapsedLabel", "function activeThinkingElapsedLabel");
  const formatter = sourceBlock(renderer, "function formatElapsedDuration", "function formatClockMinute");
  const toggle = sourceBlock(renderer, "function renderTurnResultToggle", "function renderConversationSupplementHeader");

  assert.match(decorator, /status: turnResultDisplayStatus\(threadId, group\.turnKey, group\.outputIndexes, messages\)/);
  assert.match(status, /firstString\(record\?\.status\)/);
  assert.match(status, /consumptionStatus === "pending" \? "pending" : "handled"/);
  assert.match(status, /interruptedCodexTurnIds\.has\(turnId\)/);
  assert.match(status, /item\.__youleTurnStatus/);
  assert.match(status, /if \(phases\.length && !phases\.includes\("final_answer"\)\) return "pending"/);
  assert.ok(
    status.indexOf('!phases.includes("final_answer")') <
      status.indexOf('["completed", "complete", "success", "succeeded"]'),
    "commentary-only output must stay pending even when the transport reports completed",
  );
  assert.match(toggle, /meta\.status === "pending"/);
  assert.match(toggle, /state\.settings\.language === "en" \? "Pending" : "待完成"/);
  assert.match(toggle, /: `\$\{handledStatusLabel\(\)\} \$\{meta\.elapsedLabel\}`/);
  assert.match(toggle, /Collapse processing details/);
  assert.match(toggle, /<span>\$\{escapeHtml\(statusLabel\)\}<\/span>/);
  assert.match(elapsed, /turnResultProcessIndexes\(messages, finalIndex\)/);
  assert.match(elapsed, /previousTurnResultUserStartMs\(threadId, messages, finalIndex\)/);
  assert.match(formatter, /safeMilliseconds < 1000\) return "<1s"/);
});

test("thread snapshots retain turn status for pending-result recovery after restart", async () => {
  const renderer = await rendererSource;
  const flatten = sourceBlock(renderer, "function flattenThreadItemRows", "function compareThreadItemRows");
  const completion = sourceBlock(renderer, 'case "turn/completed":', 'case "turn/failed":');
  const failure = sourceBlock(renderer, 'case "turn/failed":', 'case "item/started":');
  const localInterrupt = sourceBlock(renderer, "function finishInterruptedTurnLocally", "function isMissingActiveTurnInterruptError");

  assert.match(flatten, /const turnStatus = firstString\(turn\?\.status\)/);
  assert.match(flatten, /item as any\)\.__youleTurnStatus = turnStatus/);
  assert.match(completion, /rememberTurnResultStatus/);
  assert.match(completion, /wasInterrupted\s*\? "interrupted"/);
  assert.match(failure, /rememberTurnResultStatus\(threadId, failedTurnId, "failed"\)/);
  assert.match(localInterrupt, /rememberTurnResultStatus\(threadId, turnId, "interrupted"\)/);
});
