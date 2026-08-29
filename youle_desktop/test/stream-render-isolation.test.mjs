import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Codex deltas are coalesced before state, Markdown, and dashboard work", async () => {
  const source = await rendererSource;
  const notification = sourceBlock(
    source,
    "function handleNotification",
    "function confirmTaskCompletionRenderedAfterPaint",
  );
  const deltaBuffer = sourceBlock(
    source,
    "function codexStreamDeltaKey",
    "function appendDelta",
  );
  const scheduler = sourceBlock(
    source,
    "function armQuestionAnswerStreamUiPatch",
    "function resumeQuestionAnswerStreamUiPatchAfterPointer",
  );

  assert.match(notification, /case "item\/agentMessage\/delta"[\s\S]*queueCodexStreamDelta/);
  assert.match(notification, /case "item\/reasoning\/summaryTextDelta"[\s\S]*queueCodexStreamDelta/);
  assert.match(notification, /case "item\/commandExecution\/outputDelta"[\s\S]*queueCodexStreamDelta/);
  assert.match(notification, /message\.method !== "thread\/started" && !isStreamDelta/);
  assert.match(notification, /if \(isStreamDelta && threadId\) \{[\s\S]*scheduleCodexStreamUiPatch\(threadId\);[\s\S]*return;/);
  assert.match(deltaBuffer, /pending\.delta \+= String\(delta \|\| ""\)/);
  assert.match(deltaBuffer, /scheduleCodexStreamUiPatch\(resolvedThreadId\)/);
  assert.match(scheduler, /flushPendingCodexStreamDeltas\(threadId\)[\s\S]*rebuildTaskFromItems\(threadId\)/);
  assert.match(scheduler, /isComposerFocused\(\) \|\| composerComposing[\s\S]*QUESTION_ANSWER_STREAM_UI_INPUT_INTERVAL_MS/);
});

test("the ordinary system dashboard patches keyed cards without remounting its scroll surfaces", async () => {
  const source = await rendererSource;
  const timelineRenderer = sourceBlock(
    source,
    "function renderTaskTimeline",
    "function timelineStatusMeta",
  );
  const cardPatch = sourceBlock(
    source,
    "function patchAgentStepDetailBody",
    "function patchActiveAgentPanel",
  );
  const panelPatch = sourceBlock(
    source,
    "function patchActiveAgentPanel",
    "function blankNewThreadMembers",
  );

  assert.match(timelineRenderer, /data-agent-task-board=/);
  assert.match(timelineRenderer, /data-agent-step-row=/);
  assert.match(timelineRenderer, /data-agent-step-signature=/);
  assert.match(timelineRenderer, /data-agent-step-detail="output"/);
  assert.match(cardPatch, /currentPre\.textContent = nextPre\.textContent/);
  assert.match(cardPatch, /list\.insertBefore\(row, rowAtIndex\)/);
  assert.doesNotMatch(cardPatch, /panel\.replaceWith|root\.innerHTML/);
  assert.match(panelPatch, /patchActiveTaskTimelineInPlace\(panel, threadId, task\)/);
  assert.ok(
    panelPatch.indexOf("patchActiveTaskTimelineInPlace(panel, threadId, task)")
      < panelPatch.indexOf("panel.replaceWith(nextPanel)"),
    "the keyed timeline patch must run before the whole-panel fallback",
  );
});

test("streaming assistant text patches only the live bubble body", async () => {
  const source = await rendererSource;
  const bubblePatch = sourceBlock(
    source,
    "function patchStreamingAssistantMessageRow",
    "function appendNewMessageRowsBeforeThinkingRow",
  );

  assert.match(bubblePatch, /\.message-bubble\.agent-bubble/);
  assert.match(bubblePatch, /textElement\.innerHTML = nextMarkup/);
  assert.doesNotMatch(bubblePatch, /row\.replaceWith|scroller\.innerHTML|root\.innerHTML|render\(\)/);
});
