import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);
const preloadSource = fs.readFileSync(
  new URL("../src/main/preload.mjs", import.meta.url),
  "utf8",
);
const rendererSource = fs.readFileSync(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const rendererStyles = fs.readFileSync(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("legacy Video Expert IPC submits its original prompt directly to the video API", () => {
  const generate = sourceBlock(
    mainSource,
    "async function generateVideoFromFirstFrame",
    "function isSafeMediaCreationGrokProviderFallback",
  );

  assert.match(generate, /const prompt = firstString\(params\.prompt\)/);
  assert.match(generate, /selection\.maxPromptChars > 0 && prompt\.length > selection\.maxPromptChars/);
  assert.match(generate, /const initialAttempt = \{[\s\S]*prompt,[\s\S]*model,[\s\S]*aspectRatio,[\s\S]*duration,/);
  assert.match(generate, /result = await runVideoGenerationSkill\(scriptPath, initialAttempt\)/);
  assert.match(generate, /settleVideoGenerationBilling\(\{[\s\S]*prompt,/);
  assert.doesNotMatch(generate, /optimizeVideoPromptWithHaolo|optimizedPrompt|promptOptimization|prompt_optimization/);
});

test("video generation contains no separate Haolo optimizer module or hidden optimization turn", () => {
  assert.equal(
    fs.existsSync(
      new URL("../src/main/media/video-prompt-optimizer.mjs", import.meta.url),
    ),
    false,
  );
  assert.doesNotMatch(
    mainSource,
    /video-prompt-optimizer|optimizeVideoPromptWithHaolo|VIDEO_PROMPT_OPTIMIZER|optimized_prompt/,
  );
});

test("legacy Video Expert direct API mode emits no detailed progress messages or system dashboard orchestration", () => {
  const send = sourceBlock(
    rendererSource,
    "async function sendCurrentVideoExpertMessage",
    "function videoAttachmentFromGenerationResult",
  );
  const generateIpc = sourceBlock(
    mainSource,
    'ipcMain.handle("youle:generateVideo"',
    'ipcMain.handle("youle:readClipboardForComposer"',
  );
  const hideItems = sourceBlock(
    rendererSource,
    "function shouldHideChatItem",
    "function isHiddenRoleItem",
  );

  assert.match(send, /await api\.generateVideo!\(\{/);
  assert.match(send, /await api\.resumeVideo!\(\{/);
  assert.doesNotMatch(
    send,
    /appendVideoGenerationProgressMessages|setVideoGenerationDashboardTask|completeVideoGenerationDashboardTask|failVideoGenerationDashboardTask/,
  );
  assert.doesNotMatch(
    rendererSource,
    /onVideoGenerationProgress|applyVideoGenerationProgress|video-generation-task-|videoPromptOptimization|VideoPromptOptimization/,
  );
  assert.doesNotMatch(
    generateIpc,
    /youle:videoGenerationProgress|sendProgress|onProgress/,
  );
  assert.doesNotMatch(preloadSource, /onVideoGenerationProgress|youle:videoGenerationProgress/);
  assert.doesNotMatch(rendererStyles, /video-prompt-optimization/);
  assert.match(hideItems, /__youleVideoGenerationActor/);
  assert.match(hideItems, /__youleVideoGenerationInteractionId/);
});

test("media creation video stays on the ordinary Codex execution send path", () => {
  const switchMode = sourceBlock(
    rendererSource,
    "async function switchNewThreadMode",
    "function renderBlankThreadHero",
  );
  const send = sourceBlock(
    rendererSource,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(switchMode, /const nextUsesProviderDraft = mode === "question-answer"/);
  assert.match(switchMode, /newThreadModeByThreadId\.set\(sourceThreadId, mode\)/);
  assert.doesNotMatch(switchMode, /mode === "video-generation"[\s\S]*VIDEO_EXPERT_PROVIDER/);
  assert.match(send, /const provider = providerFromThreadId\(threadId\)/);
  assert.match(send, /await sendAgentText\(/);
});

test("Video Expert can stop its process tree and suppress a late video result", () => {
  const generateIpc = sourceBlock(
    mainSource,
    'async function runCancellableVideoGeneration',
    'ipcMain.handle("youle:readClipboardForComposer"',
  );
  const processRunner = sourceBlock(
    mainSource,
    "function runJsonProcess",
    "function parseJsonProcessOutput",
  );
  const processTermination = sourceBlock(
    mainSource,
    "function terminateSpawnedProcess",
    "function parseJsonProcessOutput",
  );
  const videoSend = sourceBlock(
    rendererSource,
    "async function sendCurrentVideoExpertMessage",
    "function appendVideoExpertAgentMessage",
  );
  const interrupt = sourceBlock(
    rendererSource,
    "async function interruptCurrentTurn",
    "function finishInterruptedTurnLocally",
  );

  assert.match(preloadSource, /interruptVideoGeneration:[\s\S]*youle:interruptVideoGeneration/);
  assert.match(generateIpc, /activeVideoGenerationsByInteractionId\.set/);
  assert.match(generateIpc, /active\.controller\.abort\(\)/);
  assert.match(processRunner, /signal\?\.addEventListener\?\.\("abort"/);
  assert.match(processRunner, /terminateSpawnedProcess\(child\)/);
  assert.match(processTermination, /taskkill\.exe/);
  assert.match(videoSend, /activeVideoInteractionByThreadId\.set\(params\.threadId, interactionId\)/);
  assert.match(videoSend, /interruptedVideoInteractionIds\.has\(interactionId\)/);
  assert.match(interrupt, /api\.interruptVideoGeneration\?\.\(\{/);
  assert.match(interrupt, /settleInterruptedVideoGeneration\(threadId, videoInteractionId\)/);
});
