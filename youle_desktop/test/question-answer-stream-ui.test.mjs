import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);
const preloadSource = readFile(
  new URL("../src/main/preload.mjs", import.meta.url),
  "utf8",
);
const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("plan-mode text deltas cross the main/preload boundary", async () => {
  const main = await mainSource;
  const preload = await preloadSource;
  const handler = sourceBlock(
    main,
    'ipcMain.handle("youle:sendProviderChat"',
    "function assertExternalModelsIpcSender",
  );

  assert.match(handler, /createQuestionAnswerStreamEmitter/);
  assert.match(handler, /QUESTION_ANSWER_STREAM_CHANNEL/);
  assert.match(handler, /emitTextDeltas:\s*Boolean\(questionAnswerStream\)/);
  assert.match(handler, /onEvent:\s*questionAnswerStream\?\.onEvent/);
  assert.match(handler, /questionAnswerStream\?\.complete\(finalMessage\)/);
  assert.match(handler, /questionAnswerStream\?\.fail\(\)/);
  assert.match(
    preload,
    /onQuestionAnswerStream:\s*\(callback\)\s*=>\s*on\("questionAnswer:stream",\s*callback\)/,
  );
});

test("renderer appends deltas into one deterministic answer bubble", async () => {
  const renderer = await rendererSource;
  const streamBlock = sourceBlock(
    renderer,
    "function questionAnswerStreamItemId",
    "function questionAnswerProgressItemId",
  );
  const providerSendBlock = sourceBlock(
    renderer,
    "async function sendCurrentProviderMessage",
    "function applyVideoGenerationBillingSession",
  );
  const finalizeBlock = sourceBlock(
    renderer,
    "function finalizeQuestionAnswerStreamAgentMessage",
    "function failQuestionAnswerStreamAgentMessage",
  );

  assert.match(
    renderer,
    /api\.onQuestionAnswerStream\?\.\(\(payload\)\s*=>\s*\{\s*applyQuestionAnswerStreamEvent\(payload\)/,
  );
  assert.match(
    streamBlock,
    /`provider-agent-stream-\$\{interactionId\}`/,
  );
  assert.match(
    streamBlock,
    /phase === "delta"[\s\S]*itemText\(current\)[\s\S]*payload\.delta/,
  );
  assert.match(
    streamBlock,
    /phase === "completed"[\s\S]*payload\.text/,
  );
  assert.match(streamBlock, /type:\s*"agentMessage"/);
  assert.doesNotMatch(streamBlock, /style\s*=|#[0-9a-f]{3,8}/i);
  assert.match(
    providerSendBlock,
    /finalizeQuestionAnswerStreamAgentMessage\(\{[\s\S]*text:\s*providerReply[\s\S]*attachments:/,
  );
  assert.match(finalizeBlock, /status:\s*"completed"[\s\S]*phase:\s*"final_answer"/);
  assert.doesNotMatch(
    providerSendBlock,
    /appendProviderAgentMessage\([\s\S]*?providerReply/,
  );
});

test("running partial answers are not persisted as completed history", async () => {
  const renderer = await rendererSource;
  const recordsBlock = sourceBlock(
    renderer,
    "function providerChatRecordsFromState",
    "function saveProviderChatThreads",
  );
  assert.match(
    recordsBlock,
    /!isRunningQuestionAnswerStreamItem\(item\)/,
  );
});

test("plan-mode streaming patches one message row and yields to native scrollbar drags", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const streamEventBlock = sourceBlock(
    renderer,
    "function applyQuestionAnswerStreamEvent",
    "function finalizeQuestionAnswerStreamAgentMessage",
  );
  const streamUiScheduler = sourceBlock(
    renderer,
    "function armQuestionAnswerStreamUiPatch",
    "function upsertQuestionAnswerStreamAgentMessage",
  );
  const streamRowPatch = sourceBlock(
    renderer,
    "function patchStreamingAssistantMessageRow",
    "function appendNewMessageRowsBeforeThinkingRow",
  );
  const scrollFollow = sourceBlock(
    renderer,
    "function scheduleScrollMessagesToBottom",
    "function currentMessageScrollState",
  );
  const progressHandler = sourceBlock(
    renderer,
    "function applyQuestionAnswerProgressEvent",
    "function settleQuestionAnswerProgress",
  );
  const renderableMessage = sourceBlock(
    renderer,
    "function hasRenderableMessageContent",
    "function inferActiveThinkingRole",
  );
  const optimizedPlanPath = streamEventBlock.slice(
    streamEventBlock.lastIndexOf("scheduleQuestionAnswerStreamUiPatch(threadId)"),
  );

  assert.match(streamEventBlock, /scheduleQuestionAnswerStreamUiPatch\(threadId\)/);
  assert.match(
    streamEventBlock,
    /if \(localGroupChatRecord\(threadId\)\)[\s\S]*setMessageStreamFollow\(threadId, true\)[\s\S]*scheduleQuestionAnswerStreamUiPatch\(threadId\)[\s\S]*return;[\s\S]*scheduleQuestionAnswerStreamUiPatch\(threadId\)/,
    "group chat must share the message-only stream patch path",
  );
  assert.doesNotMatch(
    streamEventBlock.slice(streamEventBlock.indexOf("if (localGroupChatRecord(threadId))")),
    /scheduleRender\(/,
    "group chat deltas must not schedule a page render",
  );
  assert.doesNotMatch(optimizedPlanPath, /scheduleRender\(|setMessageStreamFollow\(/);
  assert.match(
    streamUiScheduler,
    /messagePointerActive[\s\S]*pendingQuestionAnswerStreamUiThreadIds[\s\S]*QUESTION_ANSWER_STREAM_UI_PATCH_INTERVAL_MS/,
  );
  assert.match(
    streamRowPatch,
    /!streaming[\s\S]*\.message-bubble\.agent-bubble[\s\S]*\.message-text[\s\S]*textElement\.innerHTML = nextMarkup/,
  );
  assert.doesNotMatch(streamRowPatch, /row\.replaceWith|scroller\.innerHTML|root\.innerHTML/);
  assert.match(
    scrollFollow,
    /messagePointerActive && hasRunningQuestionAnswerStream\(threadId\)/,
  );
  assert.match(
    scrollFollow,
    /messagePointerActive && planModeStreaming && !atBottom[\s\S]*setMessageStreamFollow\(state\.currentThreadId, false\)[\s\S]*performance\.now\(\) < suppressScrollDetectionUntil/,
  );
  assert.match(scrollFollow, /resumeQuestionAnswerStreamUiPatchAfterPointer\(\)/);
  assert.doesNotMatch(progressHandler, /setMessageStreamFollow\(/);
  assert.match(progressHandler, /patchActiveAgentPanel\(threadId\)/);
  assert.match(
    renderableMessage,
    /questionAnswerStreamItemId\(progress\.interactionId\)[\s\S]*!itemText\(streamItem\)\.trim\(\)/,
  );
  assert.match(styles, /--bubble-agent:\s*#f2f4f8;/);
  assert.match(styles, /--bubble-agent:\s*#20242b;/);
  assert.match(styles, /\.agent-bubble\s*\{[^}]*background:\s*var\(--bubble-agent\)/);
});

test("only GPT plan mode renders public process segments and auto-folds them after the final answer", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const streamBlock = sourceBlock(
    renderer,
    "function questionAnswerStreamItemId",
    "function questionAnswerProgressItemId",
  );
  const foldingBlock = sourceBlock(
    renderer,
    "function withCollapsedTurnResults",
    "function turnResultGroups",
  );
  const historyBlock = sourceBlock(
    renderer,
    "function providerMessagesForThread",
    "async function sendCurrentChannelMessage",
  );
  const thinkingBlock = sourceBlock(
    renderer,
    "function withThinkingMessage",
    "function hasActiveVideoGenerationState",
  );
  const progressBlock = sourceBlock(
    renderer,
    "function shouldRenderQuestionAnswerProgressMessage",
    "function inferActiveThinkingRole",
  );

  assert.match(
    streamBlock,
    /provider-agent-plan-process-\$\{interactionId\}-\$\{segmentIndex\}/,
  );
  assert.match(
    streamBlock,
    /provider === "codex"[\s\S]*\/\^gpt\(\?:-\|\$\)\/i/,
  );
  assert.match(
    streamBlock,
    /phase === "plan_process_delta"[\s\S]*!gptPlanStream \|\| localGroupChatRecord\(threadId\)[\s\S]*return/,
    "process segments must be rejected for non-GPT and group-chat requests",
  );
  assert.match(
    streamBlock,
    /type:\s*"agentMessage"[\s\S]*phase:\s*"commentary"[\s\S]*__youleGptPlanProcess:\s*true/,
  );
  assert.match(
    streamBlock,
    /phase:\s*gptPlanStream \? "final_answer" : undefined/,
  );
  assert.match(
    streamBlock,
    /completeGptPlanProcessMessages\(threadId,\s*interactionId,\s*sequence\)/,
  );
  assert.match(
    foldingBlock,
    /hasGptPlanProcessForInteraction\(threadId,\s*turnId\)[\s\S]*agentMessagePhase\(item\) === "final_answer"[\s\S]*questionAnswerStreamState\(finalItem\)\?\.status === "completed"/,
    "the old turn-result fold must wait for a completed final answer",
  );
  assert.match(
    historyBlock,
    /if \(isGptPlanProcessItem\(item\)\) continue/,
    "presentation summaries must not consume the next request's history window",
  );
  assert.match(
    progressBlock,
    /isGptPlanQuestionAnswerProgress\(progress\)\) return false/,
    "the duplicated center progress board stays hidden for GPT plan mode",
  );
  assert.match(
    thinkingBlock,
    /isGptPlanQuestionAnswerProgress\(questionAnswerProgress\)[\s\S]*hasGptPlanVisibleOutputForInteraction/,
    "the ordinary thinking row yields once GPT emits a visible segment",
  );

  assert.match(styles, /\.agent-bubble\s*\{[^}]*background:\s*var\(--bubble-agent\)/);
  assert.match(
    styles,
    /\.turn-result-toggle\s*\{[^}]*color:\s*var\(--text-tertiary\)/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\][\s\S]*\.turn-result-toggle[\s\S]*color:\s*var\(--text-primary-soft\)/,
  );
  assert.match(
    styles,
    /\.turn-result-toggle:hover,[\s\S]*\.turn-result-toggle:focus-visible[\s\S]*color:\s*var\(--text-secondary\)/,
  );
});
