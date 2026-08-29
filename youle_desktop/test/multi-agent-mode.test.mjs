import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildConversationModeTurnOverrides,
  buildConversationModeDeveloperInstructions,
  MULTI_AGENT_REASONING_EFFORT,
  multiAgentReasoningEffortForModel,
  normalizeConversationMode,
  normalizeVideoGenerationOptions,
} from "../src/main/conversation-mode.mjs";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("legacy multi-agent mode fails closed to ordinary serial execution", () => {
  const instructions = buildConversationModeDeveloperInstructions("multi-agent");

  assert.equal(normalizeConversationMode("multi_agent"), "execution");
  assert.match(instructions, /locked to ordinary serial execution/);
  assert.match(instructions, /Do not call `spawn_agent`/);
  assert.match(instructions, /do not use collaboration or delegation tools/);
  assert.match(instructions, /at most one substantive task or tool operation at a time/);
  assert.match(instructions, /does not override this client policy/);
  assert.match(instructions, /Answer the user's current question or requested deliverable directly/);
  assert.match(instructions, /Do not turn an ordinary question into an execution plan/);
  assert.match(instructions, /Do not expose internal planning or status narration/);
  assert.doesNotMatch(instructions, /must call `spawn_agent`|no fewer than 2/);
});

test("execution mode always carries the serial policy, including omitted mode values", () => {
  const instructions = buildConversationModeDeveloperInstructions("execution");

  assert.match(instructions, /Do not call `spawn_agent`/);
  assert.match(instructions, /single root agent/);
  assert.match(instructions, /Answer the user's current question or requested deliverable directly/);
  assert.match(instructions, /Only provide a plan when the user explicitly asks/);
  assert.doesNotMatch(instructions, /no fewer than 2/);
  assert.match(buildConversationModeDeveloperInstructions(null), /haolo_serial_execution_policy/);
});

test("image generation mode routes plain prompts through the bundled image skill", () => {
  const instructions = buildConversationModeDeveloperInstructions(
    "image_generation",
    {
      imageGenerationModel: "aihubcc/gpt-image-2",
      imageGenerationSize: "1536x1024",
      imageGenerationSizeField: "size",
    },
  );

  assert.equal(normalizeConversationMode("image_generation"), "image-generation");
  assert.match(instructions, /Do not call `spawn_agent`/);
  assert.match(instructions, /Image Generation mode is active/);
  assert.match(instructions, /bundled Haolo image skill/);
  assert.match(instructions, /generated bitmap result/);
  assert.match(instructions, /selected `aihubcc\/gpt-image-2`/);
  assert.match(
    instructions,
    /--model "aihubcc\/gpt-image-2" --exact-model --provider-fallback-only/,
  );
  assert.match(instructions, /fallback_model=gpt-image-2-1k/);
  assert.match(instructions, /Do not switch to 2K, 3\.5K/);
  assert.match(instructions, /--size "1536x1024"/);
  const legacyBaseInstructions = buildConversationModeDeveloperInstructions(
    "image_generation",
    { imageGenerationModel: "buming/gpt-image-2" },
  );
  assert.match(
    legacyBaseInstructions,
    /--model "aihubcc\/gpt-image-2" --exact-model --provider-fallback-only/,
  );
  assert.doesNotMatch(legacyBaseInstructions, /--model "buming\/gpt-image-2"/);
  const lockedTierInstructions = buildConversationModeDeveloperInstructions(
    "image_generation",
    { imageGenerationModel: "gpt-image-2-2k" },
  );
  assert.match(lockedTierInstructions, /--model "gpt-image-2-2k" --exact-model/);
  assert.doesNotMatch(lockedTierInstructions, /provider-fallback-only/);
  assert.match(lockedTierInstructions, /do not silently replace it or switch/);
  const lockedOneKInstructions = buildConversationModeDeveloperInstructions(
    "image_generation",
    { imageGenerationModel: "aihubcc/gpt-image-2-1k-async" },
  );
  assert.match(lockedOneKInstructions, /--model "gpt-image-2-1k" --exact-model/);
  assert.match(lockedOneKInstructions, /asynchronous only/);
  assert.match(lockedOneKInstructions, /poll until `status=completed`/);
  assert.match(lockedOneKInstructions, /Do not reject it locally or switch models/);
  assert.match(
    buildConversationModeDeveloperInstructions("image_generation", {
      imageGenerationSize: "auto",
      imageGenerationSizeField: "aspect_ratio",
    }),
    /--aspect-ratio "auto"[\s\S]*adaptive composition/,
  );
  assert.doesNotMatch(
    buildConversationModeDeveloperInstructions("image_generation", {
      imageGenerationModel: "unsafe\ninstruction",
      imageGenerationSize: "unsafe\nsize",
      imageGenerationSizeField: "unsafe",
    }),
    /unsafe|--size|--aspect-ratio/,
  );
});

test("multi-agent mode cannot activate the runtime native collaboration contract", () => {
  const developerInstructions = buildConversationModeDeveloperInstructions("multi-agent");
  const overrides = buildConversationModeTurnOverrides("multi-agent", {
    model: "gpt-5.6-sol",
    developerInstructions,
  });

  assert.equal(MULTI_AGENT_REASONING_EFFORT, "ultra");
  assert.deepEqual(overrides, {});
  assert.deepEqual(buildConversationModeTurnOverrides("execution", {
    model: "gpt-5.6-sol",
    developerInstructions,
  }), {});
  assert.deepEqual(buildConversationModeTurnOverrides("multi-agent", {
    model: "unsafe\nmodel",
    developerInstructions,
  }), {});
});

test("main process rejects DeepSeek media orchestration as a defense in depth", async () => {
  const main = await mainSource;
  const send = sourceBlock(
    main,
    'ipcMain.handle("codex:sendMessage"',
    'ipcMain.handle("codex:steerTurn"',
  );
  assert.match(
    send,
    /conversationMode === IMAGE_GENERATION_CONVERSATION_MODE[\s\S]*conversationMode === VIDEO_GENERATION_CONVERSATION_MODE[\s\S]*executionSelection\.isDeepSeek/,
  );
  assert.match(send, /图片和视频创作需要使用支持工具调用的 GPT 执行模型/);
});

test("main process disables cluster workflows before any model dispatch", async () => {
  const main = await mainSource;
  const send = sourceBlock(
    main,
    'ipcMain.handle("codex:sendMessage"',
    'ipcMain.handle("codex:steerTurn"',
  );
  const workflowGuard = sourceBlock(
    main,
    "function assertCodexWorkflowRootModel",
    'ipcMain.handle("workflow:applyRevisionCommand"',
  );

  assert.doesNotMatch(send, /MULTI_AGENT_CONVERSATION_MODE|MULTI_MODEL_CLUSTER_CONVERSATION_MODE/);
  assert.match(workflowGuard, /function assertWorkflowExecutionEnabled\(\)/);
  assert.match(workflowGuard, /if \(SERIAL_EXECUTION_ONLY\)/);
  assert.match(workflowGuard, /普通串行执行模式/);
  assert.match(workflowGuard, /slug\.startsWith\("gpt-"\)/);
  assert.equal(
    (workflowGuard.match(/assertCodexWorkflowRootModel\(params\.model\)/g) || []).length,
    2,
  );
  assert.equal(
    (workflowGuard.match(/assertWorkflowExecutionEnabled\(\)/g) || []).length,
    4,
  );
  assert.match(
    workflowGuard,
    /ipcMain\.handle\("workflow:compileRevisionNode"[\s\S]*assertWorkflowExecutionEnabled\(\)/,
  );
});

test("legacy multi-agent effort helpers remain bounded but are never activated", () => {
  assert.equal(multiAgentReasoningEffortForModel("gpt-5.5"), "xhigh");
  assert.equal(
    multiAgentReasoningEffortForModel("gpt-5.5-codex-1p-codexswic-ev3"),
    "xhigh",
  );
  assert.equal(multiAgentReasoningEffortForModel("gpt-5.6-luna"), "max");
  assert.equal(multiAgentReasoningEffortForModel("gpt-5.6-sol"), "ultra");
  assert.equal(
    multiAgentReasoningEffortForModel("future-gpt", ["none", "medium", "high"]),
    "high",
  );

  const overrides = buildConversationModeTurnOverrides("multi-agent", {
    model: "gpt-5.5",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    developerInstructions: "cluster contract",
  });
  assert.deepEqual(overrides, {});
});

test("video generation mode uses the ordinary execution lifecycle with locked client parameters", () => {
  const instructions = buildConversationModeDeveloperInstructions(
    "video_generation",
    {
      videoGenerationModel: "grok-imagine-video-1.5",
      videoGenerationInputMode: "text-or-image-to-video",
      videoGenerationAspectRatio: "9:16",
      videoGenerationDuration: "15",
      videoGenerationResolution: "720p",
      videoGenerationSize: "720x1280",
    },
  );

  assert.equal(normalizeConversationMode("video_generation"), "video-generation");
  assert.match(instructions, /Do not call `spawn_agent`/);
  assert.match(instructions, /same Codex execution turn/);
  assert.match(instructions, /live thinking status/);
  assert.match(instructions, /interruption behavior/);
  assert.match(instructions, /Do not bypass the execution turn/);
  assert.match(
    instructions,
    /--model "grok-imagine-video-1\.5" --exact-model --provider-fallback-only/,
  );
  assert.match(instructions, /--input-mode "text-or-image-to-video"/);
  assert.match(instructions, /--aspect-ratio "9:16"/);
  assert.match(instructions, /--resolution "720p"/);
  assert.match(instructions, /--size "720x1280"/);
  assert.match(instructions, /--duration "15"/);
  assert.match(instructions, /pass that literal prompt to the Director unchanged/);
  assert.match(instructions, /Only when the literal request is very brief or underspecified/);
  assert.match(instructions, /--resume-latest/);
  assert.match(instructions, /never issue a new generation POST/);

  assert.deepEqual(
    normalizeVideoGenerationOptions({
      videoGenerationModel: "unsafe\nmodel",
      videoGenerationInputMode: "unsafe",
      videoGenerationAspectRatio: "9:16",
      videoGenerationDuration: "0",
      videoGenerationResolution: "720p",
      videoGenerationSize: "720x1280",
    }),
    {
      model: "",
      inputMode: "",
      aspectRatio: "9:16",
      duration: "",
      resolution: "720p",
      size: "720x1280",
    },
  );
});

test("multi-model cluster also fails closed to the ordinary serial root", () => {
  const instructions = buildConversationModeDeveloperInstructions("multi_model_cluster");

  assert.equal(normalizeConversationMode("multi_model_cluster"), "execution");
  assert.match(instructions, /Do not call `spawn_agent`/);
  assert.match(instructions, /ordinary serial execution/);
});

test("login preload caches both media catalogs before mode switching", async () => {
  const renderer = await rendererSource;
  const main = await mainSource;
  const preload = await preloadSource;
  const modeSwitch = sourceBlock(renderer, "async function switchNewThreadMode", "function renderBlankThreadHero");
  const mediaPreload = sourceBlock(
    renderer,
    "async function preloadMediaCreationModelCatalogs",
    "function applyImageGenerationModelCatalogFailure",
  );
  const loginPreload = sourceBlock(
    renderer,
    "async function preloadAuthenticatedModelCatalogs",
    "function applyImageGenerationModelCatalogFailure",
  );
  const refresh = sourceBlock(
    renderer,
    "async function refreshImageGenerationModelCatalog",
    "async function preloadMediaCreationModelCatalogs",
  );
  const picker = sourceBlock(
    renderer,
    "function renderImageGenerationModelMenu",
    "type ComposerModelBrand",
  );

  assert.doesNotMatch(modeSwitch, /preloadMediaCreationModelCatalogs/);
  assert.match(loginPreload, /preloadMediaCreationModelCatalogs\(\{/);
  assert.match(loginPreload, /renderAfter: false/);
  assert.match(mediaPreload, /refreshImageGenerationModelCatalog\(/);
  assert.match(mediaPreload, /loadVideoExpertModels\(/);
  assert.match(mediaPreload, /Promise\.all\(requests\)/);
  assert.match(
    renderer,
    /MEDIA_CREATION_MODEL_CATALOG_CACHE_TTL_MS\s*=\s*4 \* 60 \* 60_000/,
  );
  assert.match(refresh, /MEDIA_CREATION_MODEL_CATALOG_CACHE_TTL_MS/);
  assert.match(refresh, /api\.listImageGenerationModels/);
  assert.match(refresh, /normalizeImageGenerationModelCatalog\(payload\)/);
  assert.match(picker, /renderImageGenerationModelMenu\(modelOptions, selected, disabled\)/);
  assert.match(picker, /正在从中转获取可用生图模型/);
  assert.match(
    main,
    /ipcMain\.handle\("youle:listImageGenerationModels"[\s\S]*assertExternalModelsIpcSender\(event\)[\s\S]*listImageGenerationModels\(params\)/,
  );
  assert.match(
    preload,
    /listImageGenerationModels: \(params\) =>[\s\S]*ipcRenderer\.invoke\("youle:listImageGenerationModels", params\)/,
  );
});

test("renderer preserves the selected mode across thread creation, sends, continuations, and restarts", async () => {
  const source = await rendererSource;
  const threadParams = sourceBlock(source, "function threadParams", "async function refreshSkills");
  const replacement = sourceBlock(source, "function adoptReplacementCodexThread", "async function sendAgentText");
  const send = sourceBlock(source, "async function sendAgentText", "async function flushQueuedSend");
  const preferences = sourceBlock(source, "function loadThreadPreferences", "function shouldPersistThreadPreferenceId");

  assert.match(threadParams, /conversationMode: codexConversationModeForThread\(threadId\)/);
  assert.match(threadParams, /imageGenerationModelRequestParams\(threadId\)/);
  assert.match(threadParams, /videoGenerationModelRequestParams\(threadId\)/);
  assert.match(replacement, /previousConversationMode = newThreadModeByThreadId\.get\(previousThreadId\)/);
  assert.match(replacement, /newThreadModeByThreadId\.set\(nextThreadId, previousConversationMode\)/);
  assert.match(send, /conversationMode: codexConversationModeForThread\(activeThreadId\)/);
  assert.match(send, /supportedReasoningEfforts:[\s\S]*selectedChatModelReasoningEffortsForRequest\(activeThreadId\)/);
  assert.match(send, /imageGenerationModelRequestParams\(activeThreadId\)/);
  assert.match(send, /videoGenerationModelRequestParams\(activeThreadId\)/);
  assert.match(send, /sourceType:[\s\S]*"video"/);
  assert.match(source, /conversationMode: codexConversationModeForThread\(sourceThreadId\)/);
  assert.match(source, /videoGenerationModelRequestParams\(sourceThreadId\)/);
  assert.match(preferences, /normalizePersistedThreadModes\(parsed\.threadModes\)/);
  assert.match(preferences, /threadModes: normalizedThreadModes/);
  assert.match(preferences, /threadImageModels: normalizePersistedThreadImageModels\(parsed\.threadImageModels\)/);
  assert.match(preferences, /threadImageSizes: normalizePersistedThreadImageSizes\(parsed\.threadImageSizes\)/);
  assert.match(preferences, /threadModes: Object\.fromEntries/);
  assert.match(preferences, /mode === "video-generation"/);
  assert.match(preferences, /threadImageModels: Object\.fromEntries/);
  assert.match(preferences, /threadImageSizes: Object\.fromEntries/);
});

test("renderer migrates legacy cluster preferences to execution and stops persisting cluster state", async () => {
  const source = await rendererSource;
  const normalizers = sourceBlock(
    source,
    "function normalizePersistedThreadModes",
    "function normalizePersistedThreadContinuations",
  );
  const preferences = sourceBlock(
    source,
    "function saveThreadPreferences",
    "function shouldPersistThreadPreferenceId",
  );

  assert.match(normalizers, /mode === "multi-agent" \? "execution" : mode/);
  assert.match(normalizers, /function normalizePersistedClusterModes[\s\S]*return \{\};/);
  assert.doesNotMatch(preferences, /mode === "multi-agent"/);
  assert.match(preferences, /clusterModes: \{\}/);
});

test("main process injects the selected conversation-mode contract before every turn", async () => {
  const source = await mainSource;
  const refresh = sourceBlock(source, "async function refreshSkillsDeveloperInstructions", "function buildThreadGroupMemoryInstructions");
  const desktopInstructions = sourceBlock(source, "function buildDesktopDeveloperInstructions", "function buildHaoloMediaDeveloperInstructions");
  const send = sourceBlock(source, 'ipcMain.handle("codex:sendMessage"', 'ipcMain.handle("codex:interruptTurn"');

  assert.match(refresh, /buildDesktopDeveloperInstructions\([\s\S]*imageGenerationModel/);
  assert.match(refresh, /videoGenerationOptions/);
  assert.match(
    desktopInstructions,
    /buildConversationModeDeveloperInstructions\([\s\S]*imageGenerationModel[\s\S]*videoGenerationOptions/,
  );
  assert.match(desktopInstructions, /conversationModeInstructions/);
  assert.match(desktopInstructions, /haolo_direct_answer_policy/);
  assert.match(desktopInstructions, /do not substitute a generic execution plan for the requested answer/);
  assert.match(send, /params\.conversationMode \|\| params\.conversation_mode/);
  assert.match(send, /params\.imageGenerationModel \|\| params\.image_generation_model/);
  assert.match(send, /params\.imageGenerationSize \|\| params\.image_generation_size/);
  assert.match(send, /params\.imageGenerationSizeField \|\| params\.image_generation_size_field/);
  assert.match(send, /videoGenerationInstructionOptions\(params\)/);
  assert.match(send, /buildConversationModeTurnOverrides\(/);
  assert.match(send, /\.\.\.conversationModeTurnOverrides/);
  assert.doesNotMatch(send, /multiAgentReasoningEffortForModel|MULTI_AGENT_CONVERSATION_MODE/);
  assert.match(send, /params\.supportedReasoningEfforts/);
  assert.match(
    send,
    /buildTurnInputWithGroupMemory\(text, cwd,[\s\S]*videoGenerationOptions/,
  );
  assert.doesNotMatch(send, /imageGenerationCount|image_generation_count/);
});
