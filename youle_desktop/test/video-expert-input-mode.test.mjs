import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const videoSkillSource = readFile(
  new URL("../resources/default-haolo-ai/skills/.system/videogen/scripts/generate_seedance_video.py", import.meta.url),
  "utf8",
);
const videoSkillContract = readFile(
  new URL("../resources/default-haolo-ai/skills/.system/videogen/SKILL.md", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("video expert derives all composer policies from the selected model input mode", async () => {
  const source = await rendererSource;
  const policyBlock = sourceBlock(
    source,
    "function videoExpertInputPolicy",
    "function selectedVideoExpertInputPolicy",
  );
  const placeholderBlock = sourceBlock(
    source,
    "function composerPlaceholderForThread",
    "function normalizeThreadModelSettings",
  );

  assert.match(source, /const VIDEO_EXPERT_COMPOSER_PLACEHOLDER = "上传首帧图，按照你的提示生成视频"/);
  assert.match(source, /const VIDEO_EXPERT_TEXT_TO_VIDEO_PLACEHOLDER = "输入提示词生成视频"/);
  assert.match(source, /const VIDEO_EXPERT_TEXT_OR_IMAGE_PLACEHOLDER = "输入提示词，可上传参考图片生成视频"/);
  assert.match(source, /const VIDEO_EXPERT_FIRST_LAST_FRAME_PLACEHOLDER = "上传首帧和尾帧图，按照你的提示生成视频"/);
  assert.match(source, /const VIDEO_EXPERT_VIDEO_TO_VIDEO_PLACEHOLDER = "上传参考视频，按照你的提示转换视频"/);
  assert.match(policyBlock, /normalizedMode === "text-to-video"[\s\S]*?mediaType: "none"[\s\S]*?requiredImageCount: 0[\s\S]*?maxImageCount: 0/);
  assert.match(policyBlock, /normalizedMode === "text-or-image-to-video"[\s\S]*?mediaType: "image"[\s\S]*?requiredImageCount: 0/);
  assert.match(policyBlock, /normalizedMode === "first-last-frame-to-video"[\s\S]*?requiredImageCount: 2[\s\S]*?maxImageCount: 2/);
  assert.match(policyBlock, /normalizedMode === "video-to-video"[\s\S]*?mediaType: "video"[\s\S]*?requiredVideoCount/);
  assert.match(policyBlock, /normalizedMode === "multimodal-to-video"[\s\S]*?mediaType: "mixed"[\s\S]*?maxAudioCount/);
  assert.match(policyBlock, /requiredImageCount: 1[\s\S]*?maxImageCount: 1/);
  assert.match(placeholderBlock, /selectedVideoExpertInputPolicy\(\)\.placeholder/);
});

test("video expert upload paths enforce image type and the selected model limit", async () => {
  const source = await rendererSource;
  const queueBlock = sourceBlock(
    source,
    "async function queueVideoExpertFiles",
    "function isVideoExpertImageFile",
  );
  const folderBlock = sourceBlock(
    source,
    "function queueComposerFolders",
    "function queueFolders",
  );
  const reconcileBlock = sourceBlock(
    source,
    "function reconcileVideoExpertAttachmentsForModel",
    "function normalizeVideoExpertAspectRatio",
  );

  assert.match(queueBlock, /inputPolicy\.mediaType === "none"/);
  assert.match(queueBlock, /videoExpertFileKindAllowed/);
  assert.match(queueBlock, /videoExpertFileValidationError/);
  assert.match(queueBlock, /maximumAttachmentCount === 1/);
  assert.match(queueBlock, /dedupeQueuedFiles\(validatedFiles, existingMedia\)/);
  assert.match(queueBlock, /inputPolicy\.maxAudioCount/);
  assert.match(folderBlock, /videoExpertUploadRestrictionMessage\(\)/);
  assert.match(reconcileBlock, /inputPolicy\.mediaType === "none"/);
  assert.match(reconcileBlock, /videoExpertInputAttachments\(attachments, inputPolicy\)/);
  assert.match(reconcileBlock, /await confirmInApp\(\{/);
});

test("video expert blocks send with the requested missing-frame messages", async () => {
  const source = await rendererSource;
  const sendEntryBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  const validationBlock = sourceBlock(
    source,
    "function videoExpertComposerValidationError",
    "function videoExpertFirstFrameMessageAttachment",
  );
  const videoSendBlock = sourceBlock(
    source,
    "async function sendCurrentVideoExpertMessage",
    "function videoAttachmentFromGenerationResult",
  );

  assert.match(sendEntryBlock, /videoExpertComposerValidationError\([\s\S]*?state\.attachments/);
  assert.match(sendEntryBlock, /showToast\(validationError, 3200\)/);
  assert.match(source, /missingFramesMessage: "请上传一张首帧图"/);
  assert.match(validationBlock, /return inputPolicy\.missingFramesMessage/);
  assert.match(source, /missingFramesMessage: "请上传首帧图和尾帧图"/);
  assert.match(videoSendBlock, /requireUploadedUrls: true/);
  assert.match(videoSendBlock, /\.\.\.\(lastFrameUrl \? \{ lastFrameUrl \} : \{\}\)/);
  assert.match(videoSendBlock, /\.\.\.\(imageUrls\.length \? \{ imageUrls \} : \{\}\)/);
  assert.match(videoSendBlock, /\.\.\.\(videoUrls\.length \? \{ videoUrls \} : \{\}\)/);
  assert.match(videoSendBlock, /\.\.\.\(audioUrls\.length \? \{ audioUrls \} : \{\}\)/);
  assert.match(videoSendBlock, /inputMode: inputPolicy\.mode/);
});

test("interrupted media-creation video tasks allow a text-only continuation through the normal execution chain", async () => {
  const source = await rendererSource;
  const main = await mainSource;
  const sendEntryBlock = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  const videoSendBlock = sourceBlock(
    source,
    "async function sendCurrentVideoExpertMessage",
    "function videoAttachmentFromGenerationResult",
  );
  const continuationBlock = sourceBlock(
    source,
    "function isVideoExpertContinuationRequest",
    "function removePendingVideoGenerationItems",
  );
  const canSendBlock = sourceBlock(
    source,
    "function canSendVideoExpertComposer",
    "function canSendComposer",
  );
  const placeholderBlock = sourceBlock(
    source,
    "function composerPlaceholderForThread",
    "function normalizeThreadModelSettings",
  );
  const mediaRoutingBlock = sourceBlock(
    main,
    "function buildTurnMediaRoutingReminder",
    "function detectMediaGenerationKinds",
  );

  assert.match(continuationBlock, /function hasResumableVideoExpertTask/);
  assert.match(continuationBlock, /isThreadBusy\(normalizedThreadId\)/);
  assert.match(continuationBlock, /item\.kind === "media_generation" && item\.generationType === "video"/);
  assert.match(continuationBlock, /item\.__youleVideoGenerationInteractionId/);
  assert.match(continuationBlock, /item\.type === "userMessage"[\s\S]*isImageAttachment\(attachment\)/);
  assert.match(continuationBlock, /itemAttachments\(item\)\.some\(isVideoAttachment\)/);
  assert.match(continuationBlock, /"completed"[\s\S]*"failed"[\s\S]*"interrupted"[\s\S]*"stopped"/);
  assert.match(continuationBlock, /视频已生成\|视频生成失败/);
  assert.match(continuationBlock, /function isVideoExpertContinuationAllowed/);
  assert.match(continuationBlock, /isVideoExpertThreadId\(threadId\)/);
  assert.match(continuationBlock, /attachments\.length === 0/);
  const continuationAllowedBlock = sourceBlock(
    source,
    "function isVideoExpertContinuationAllowed",
    "function removePendingVideoGenerationItems",
  );
  assert.doesNotMatch(continuationAllowedBlock, /hasResumableVideoExpertTask/);
  assert.match(sendEntryBlock, /continuationAllowed[\s\S]*\?\s*null[\s\S]*videoExpertComposerValidationError/);
  assert.match(sendEntryBlock, /promoteLocalBlankThreadForSend\(threadId\)/);
  assert.match(sendEntryBlock, /await sendAgentText\(/);
  assert.match(videoSendBlock, /const recoveryRequested = isVideoExpertContinuationAllowed/);
  assert.match(videoSendBlock, /recoveryRequested[\s\S]*await api\.resumeVideo/);
  assert.doesNotMatch(videoSendBlock, /不需要重新上传首帧/);
  assert.match(canSendBlock, /continuationAllowed \|\|[\s\S]*videoExpertComposerValidationError/);
  assert.match(canSendBlock, /!isThreadBusy\(normalizedThreadId\)/);
  assert.match(placeholderBlock, /输入“继续”可恢复上一次视频任务，无需重新上传首帧/);
  assert.match(mediaRoutingBlock, /forcedVideo \|\| hasRecentVideoMediaJob/);
  assert.match(mediaRoutingBlock, /--resume-latest/);
  assert.match(mediaRoutingBlock, /This is reconciliation, not a new generation request/);
  assert.match(mediaRoutingBlock, /do not POST a replacement task/);
});

test("video recovery stays silent and does not create system dashboard orchestration", async () => {
  const source = await rendererSource;
  const main = await mainSource;
  const skill = await videoSkillSource;
  const videoSendBlock = sourceBlock(
    source,
    "async function sendCurrentVideoExpertMessage",
    "function videoAttachmentFromGenerationResult",
  );
  const resumeBlock = sourceBlock(
    main,
    "async function resumeLatestVideoGeneration",
    "function normalizeVideoGenerationCatalog",
  );
  const resumeIpcBlock = sourceBlock(
    main,
    'ipcMain.handle("youle:resumeVideo"',
    'ipcMain.handle("youle:readClipboardForComposer"',
  );

  assert.match(videoSendBlock, /interactionId,/);
  assert.match(videoSendBlock, /recoveryRequested[\s\S]*await api\.resumeVideo/);
  assert.doesNotMatch(videoSendBlock, /video-generation-progress-|setVideoGenerationDashboardTask/);
  assert.doesNotMatch(source, /videoGenerationDashboardStep|ensureVideoGenerationDashboardTask/);
  assert.doesNotMatch(resumeBlock, /onProgress|HAOLO_VIDEO_PROGRESS|onStderrLine/);
  assert.doesNotMatch(skill, /HAOLO_VIDEO_PROGRESS|emit_video_progress/);
  assert.doesNotMatch(resumeIpcBlock, /youle:videoGenerationProgress|sendProgress|onProgress/);
  assert.match(
    resumeIpcBlock,
    /return runCancellableVideoGeneration\(params, resumeLatestVideoGeneration\)/,
  );
});

test("video prompt rewriting preserves detailed requests and only improves brief requests", async () => {
  const skill = await videoSkillContract;
  assert.match(
    skill,
    /If it already contains a concrete subject and action plus at least two useful production dimensions/,
  );
  assert.match(skill, /pass it to the script exactly unchanged/);
  assert.match(skill, /Only improve a very brief or underspecified request/);
  assert.doesNotMatch(
    skill,
    /Translate Chinese prompts into polished English/,
  );
});

test("main process revalidates frame URLs against the authoritative catalog mode", async () => {
  const source = await mainSource;
  const apiClientProxyBlock = sourceBlock(
    source,
    "function wrapYouleApiClient",
    "function getAutomationStore",
  );
  const selectionBlock = sourceBlock(
    source,
    "async function resolveVideoGenerationSelection",
    "function normalizeVideoGenerationCatalog",
  );
  const validationBlock = sourceBlock(
    source,
    "function validateVideoGenerationFrameUrls",
    "function safeVideoGenerationBasename",
  );
  const skillBlock = sourceBlock(
    source,
    "function runVideoGenerationSkill",
    "function videoGenerationSkillEnv",
  );
  const skillEnvBlock = sourceBlock(
    source,
    "function videoGenerationSkillEnv",
    "function normalizeVideoGenerationSkillResult",
  );

  assert.match(selectionBlock, /inputMode: model\.inputMode/);
  assert.match(
    selectionBlock,
    /resolution:\s*firstString\(screenSize\.resolution,\s*model\.defaultResolution,\s*"720p"\)/,
  );
  assert.match(validationBlock, /mode === "text-to-video"/);
  assert.match(validationBlock, /mode === "text-or-image-to-video"|requiredImageCount/);
  assert.match(validationBlock, /mode === "first-last-frame-to-video"/);
  assert.match(validationBlock, /mode === "video-to-video"/);
  assert.match(validationBlock, /mode === "multimodal-to-video"/);
  assert.match(validationBlock, /audioUrls/);
  assert.match(validationBlock, /\(videos\.length \|\| audios\.length\) && !images\.length/);
  assert.match(validationBlock, /请上传一张首帧图/);
  assert.match(validationBlock, /请上传首帧图和尾帧图/);
  assert.match(skillBlock, /"--input-mode"/);
  assert.match(skillBlock, /"--image-url"/);
  assert.match(skillBlock, /"--video-url"/);
  assert.match(skillBlock, /"--audio-url"/);
  assert.match(apiClientProxyBlock, /prop === "businessModelCredential"/);
  assert.match(skillEnvBlock, /if \(!mediaCredential\?\.apiKey\)/);
  assert.match(skillEnvBlock, /视频模型路由凭证不可用，请重新登录后重试/);
  assert.doesNotMatch(skillEnvBlock, /loadDefaultCodexAuthEnv/);
});
