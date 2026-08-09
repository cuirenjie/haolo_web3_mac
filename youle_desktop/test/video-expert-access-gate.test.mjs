import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const apiClientSource = readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("video expert access check is exposed through IPC and preload", async () => {
  const [main, preload, apiClient] = await Promise.all([mainSource, preloadSource, apiClientSource]);

  assert.match(main, /ipcMain\.handle\("youle:validateVideoExpertAccess"/);
  assert.match(main, /getYouleApiClient\(\)\.validateVideoExpertAccess\(params\)/);
  assert.match(preload, /validateVideoExpertAccess:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("youle:validateVideoExpertAccess",\s*params\)/);

  const methodBlock = sourceBlock(apiClient, "async validateVideoExpertAccess", "async logout");
  assert.match(methodBlock, /this\.requireAuth\(\)/);
  assert.match(methodBlock, /email/);
  assert.match(methodBlock, /source:\s*"video_expert"/);
  assert.match(methodBlock, /videoExpertAccessAllowedFromPayload\(payload\)/);

  const helperBlock = sourceBlock(apiClient, "function videoExpertAccessAllowedFromPayload", "function normalizeSurface");
  assert.match(helperBlock, /source\.allowed/);
  assert.doesNotMatch(helperBlock, /source\.ok/);
  assert.match(helperBlock, /\["allowed",\s*"valid",\s*"passed",\s*"authorized",\s*"access_granted",\s*"granted"\]\.includes\(status\)/);
  assert.match(helperBlock, /\["denied",\s*"invalid",\s*"failed",\s*"forbidden",\s*"unauthorized"\]\.includes\(status\)/);
  assert.match(helperBlock, /return false;\s*\}/);
});

test("video expert sends the user bubble before generation without local access gating", async () => {
  const source = await rendererSource;
  const sendBlock = sourceBlock(source, "async function sendCurrentVideoExpertMessage", "function appendVideoExpertAgentMessage");
  const renderBlock = sourceBlock(source, "function renderMessage(message", "function messageRenderSignature");
  const thinkingBlock = sourceBlock(source, "function renderThinkingBubble", "function renderMessageAvatar");

  const userMessageIndex = sendBlock.indexOf("upsertItem(params.threadId");
  const pendingItemIndex = sendBlock.indexOf("const pendingItemId");
  const generateIndex = sendBlock.indexOf("await api.generateVideo");
  assert.ok(userMessageIndex >= 0, "user message should be written before access validation");
  assert.equal(sendBlock.indexOf("ensureVideoExpertAccess"), -1, "renderer should not run a local access gate");
  assert.equal(sendBlock.indexOf("validateVideoExpertAccess"), -1, "renderer should not call access validation before generation");
  assert.ok(pendingItemIndex > userMessageIndex, "generation placeholder should be created after the user bubble");
  assert.ok(generateIndex > pendingItemIndex, "video generation should only run after the pending item is created");
  assert.match(sendBlock, /kind:\s*"media_generation"[\s\S]*generationType:\s*"video"/);
  assert.doesNotMatch(sendBlock, /__youleHiddenVideoGenerationState/);
  assert.match(renderBlock, /mediaGeneration[\s\S]*renderThinkingBubble/);
  assert.match(thinkingBlock, /正在思考/);
  assert.equal(
    sendBlock.match(/removeThreadItem\(params\.threadId, pendingItemId\)/g)?.length,
    2,
    "success and failure should both clear the thinking placeholder",
  );
});

test("video expert gateway denial is not misreported as an invite-only restriction", async () => {
  const source = await rendererSource;
  const sendBlock = sourceBlock(source, "async function sendCurrentVideoExpertMessage", "function appendVideoExpertAgentMessage");

  assert.doesNotMatch(source, /内测期间仅对定向受邀用户开放/);
  assert.doesNotMatch(source, /isVideoExpertInviteOnlyError/);
  assert.match(sendBlock, /const failureText = `视频生成失败：\$\{errorMessage\(error\)\}`/);
});

test("video generation does not call the missing video expert access preflight", async () => {
  const main = await mainSource;
  const generateBlock = sourceBlock(main, "async function generateVideoFromFirstFrame", "async function settleVideoGenerationBilling");
  assert.doesNotMatch(generateBlock, /validateVideoExpertAccess/);
  assert.doesNotMatch(generateBlock, /assertVideoExpertAccessBeforeGeneration/);
  assert.match(generateBlock, /runVideoGenerationSkill/);
  assert.doesNotMatch(main, /function isLocallyAllowlistedVideoExpertEmail/);
  assert.doesNotMatch(main, /DEFAULT_VIDEO_EXPERT_ACCESS_ALLOWLIST/);
});

test("video generation validates an API-selected gateway model without desktop double settlement", async () => {
  const main = await mainSource;
  const generateBlock = sourceBlock(main, "async function generateVideoFromFirstFrame", "async function settleVideoGenerationBilling");

  assert.match(generateBlock, /await resolveVideoGenerationSelection\(params\)/);
  assert.match(main, /async function resolveVideoGenerationSelection/);
  assert.match(main, /getYouleApiClient\(\)\.listVideoExpertModels\(\)/);
  assert.doesNotMatch(main, /const VIDEO_GENERATION_MODEL\s*=/);
  assert.match(generateBlock, /isGatewayBilledVideoGenerationModel\(normalized\.model\)/);
  assert.match(generateBlock, /refreshGatewayVideoGenerationBillingSession/);
  assert.match(main, /function isGatewayBilledVideoGenerationModel/);
});

test("video model capabilities are exposed through authenticated IPC", async () => {
  const [main, preload, apiClient] = await Promise.all([mainSource, preloadSource, apiClientSource]);

  assert.match(main, /ipcMain\.handle\("youle:listVideoExpertModels"/);
  assert.match(main, /getYouleApiClient\(\)\.listVideoExpertModels\(params\)/);
  assert.match(
    preload,
    /listVideoExpertModels:\s*\(params\)\s*=>\s*[\s\S]*?ipcRenderer\.invoke\("youle:listVideoExpertModels",\s*params\)/,
  );

  const methodBlock = sourceBlock(apiClient, "async listVideoExpertModels", "async listProviderModelCatalog");
  assert.match(methodBlock, /this\.requireAuth\(\)/);
  assert.match(methodBlock, /this\.videoExpertModelsPath/);
  assert.match(methodBlock, /method:\s*"GET"/);
  assert.match(methodBlock, /this\.videoExpertModelCatalogCache/);
  assert.match(methodBlock, /params\.force !== true && cached/);
  assert.match(methodBlock, /source:\s*"cache"/);
  assert.match(
    apiClient,
    /MEDIA_CREATION_MODEL_CATALOG_TTL_MS\s*=\s*4 \* 60 \* 60_000/,
  );
  assert.match(
    methodBlock,
    /filterVideoModelCatalog\([\s\S]*?catalogResult\.payload[\s\S]*?configuredModels/,
  );
  assert.match(methodBlock, /\(error\)\s*=>\s*\(\{\s*payload:\s*null,\s*error\s*\}\)/);

  const filterBlock = sourceBlock(
    apiClient,
    "function filterVideoModelCatalog",
    "function positiveIntegerOrNull",
  );
  assert.match(
    filterBlock,
    /provider: configured\.provider \|\| capability\.provider/,
  );
  assert.match(filterBlock, /documentedVideoModelCapability\(configuredID\)/);
  assert.match(filterBlock, /videoModelCatalogMatchID\(configuredID\)/);
  assert.match(
    filterBlock,
    /\.\.\.\(documented \|\| \{\}\)[\s\S]*?\.\.\.\(compatibleCatalog \|\| \{\}\)[\s\S]*?\.\.\.\(exactCatalog \|\| \{\}\)/,
  );
});

test("video expert composer renders API-driven model, screen-size, and duration controls", async () => {
  const source = await rendererSource;
  const composerBlock = sourceBlock(source, "function renderVideoExpertComposer", "function renderVideoExpertAspectRatioPicker");
  const sendBlock = sourceBlock(source, "async function sendCurrentVideoExpertMessage", "function appendVideoExpertAgentMessage");

  assert.match(composerBlock, /renderVideoExpertAspectRatioPicker\(\)/);
  assert.match(composerBlock, /renderVideoExpertDurationPicker\(\)/);
  assert.match(composerBlock, /renderComposerModelPicker\(thread\.id\)/);
  assert.doesNotMatch(composerBlock, /video-expert-model-control/);
  assert.doesNotMatch(composerBlock, /renderVideoExpertModelPicker\(\)/);
  assert.match(source, /await listVideoExpertModels\(\{\s*force:/);
  assert.match(source, /selectedVideoExpertModelCapability\(\)/);
  assert.match(sendBlock, /const model = selectedModel\.id/);
  assert.match(sendBlock, /await api\.generateVideo!?\(\{[\s\S]*?\bmodel,/);
  assert.match(sendBlock, /size:\s*selectedScreenSize\.size/);
  assert.match(sendBlock, /resolution:\s*selectedScreenSize\.resolution/);
});

test("opening video capability menus only reads login-cached route-specific options", async () => {
  const source = await rendererSource;
  const refreshBlock = sourceBlock(
    source,
    "function openCachedVideoExpertMenu",
    "function resetVideoExpertModelCatalogState",
  );
  const bindingBlock = sourceBlock(
    source,
    "function bindEvents",
    "function dismissAutoTaskPicker",
  );

  assert.doesNotMatch(refreshBlock, /loadVideoExpertModels|listVideoExpertModels/);
  assert.match(refreshBlock, /threadId !== currentComposerThreadId\(\)/);
  assert.match(refreshBlock, /state\.videoExpertModelsError/);
  assert.match(refreshBlock, /state\.videoExpertMenuOpen = menu/);
  assert.match(bindingBlock, /menu !== "image-size"/);
  assert.match(bindingBlock, /openCachedVideoExpertMenu\(menu\)/);
});

test("video generation settlement fallback uses main-process error text helper", async () => {
  const main = await mainSource;
  const settlementBlock = sourceBlock(main, "async function settleVideoGenerationBilling", "function isVideoGenerationSettlementUnavailableError");
  assert.match(settlementBlock, /settlement_error:\s*errorMessageText\(error\)/);
  assert.doesNotMatch(settlementBlock, /settlement_error:\s*errorMessage\(error\)/);
});
