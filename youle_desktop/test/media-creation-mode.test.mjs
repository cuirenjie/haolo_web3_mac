import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { longestVideoModelDuration } from "../src/renderer/video-model-duration.ts";

const source = await readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const mediaModelGroups = await readFile(
  new URL("../src/renderer/media-model-groups.ts", import.meta.url),
  "utf8",
);

function sourceBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("image and video models live in the execution model picker without a media mode hierarchy", () => {
  const hero = sourceBlock("function renderBlankThreadHero", "function renderMessage");
  const picker = sourceBlock(
    "function renderComposerModePicker",
    "function activeComposerDraftSnapshot",
  );
  const modelMenu = sourceBlock(
    "function renderUnifiedExecutionModelMenu",
    "function renderComposerModelPicker",
  );
  const availableGroups = sourceBlock(
    "function unifiedExecutionAvailableModelGroups",
    "function workflowCanvasExecutionAgentExecutorOptions",
  );

  assert.doesNotMatch(hero, /data-new-thread-mode|媒体创作/);
  assert.doesNotMatch(picker, /data-composer-mode-cascade="media"/);
  assert.doesNotMatch(picker, /data-new-thread-mode="media-creation"/);
  assert.doesNotMatch(picker, /data-media-creation-mode/);
  assert.doesNotMatch(picker, /媒体创作/);
  assert.match(
    availableGroups,
    /executionModelGroups\(executionOptions\)[\s\S]*label:\s*group\.label[\s\S]*label:\s*`图片模型 · \$\{group\.label\}`[\s\S]*label:\s*`视频模型 · \$\{group\.label\}`/,
  );
  assert.match(modelMenu, /executionGroups[\s\S]*aria-label="\$\{escapeAttr\(group\.label\)\}"/);
  assert.match(modelMenu, /"execution",[\s\S]*selectedKind/);
  assert.match(modelMenu, /"image",[\s\S]*selectedKind/);
  assert.match(modelMenu, /"video",[\s\S]*selectedKind/);
});

test("media type controls choose the matching composer and model picker", () => {
  const composer = sourceBlock(
    "function renderComposer(thread",
    "function renderVideoExpertComposer",
  );
  const videoComposer = sourceBlock(
    "function renderVideoExpertComposer",
    "function renderVideoExpertAspectRatioPicker",
  );
  const picker = sourceBlock(
    "function renderComposerModelPicker",
    "type ComposerModelBrand",
  );

  assert.match(composer, /imageGenerationMode/);
  assert.match(composer, /class="composer\$\{imageGenerationMode \? " media-creation-composer" : ""\}"/);
  assert.match(composer, /renderComposerModePicker\(thread\.id\)/);
  assert.match(composer, /mediaInputAccept\("image"\)/);
  assert.match(composer, /renderComposerModelPicker\(thread\.id\)/);
  assert.match(videoComposer, /renderComposerModePicker\(thread\.id\)/);
  assert.match(videoComposer, /class="composer video-expert-composer media-creation-composer"/);
  assert.match(videoComposer, /renderComposerModelPicker\(thread\.id\)/);
  assert.doesNotMatch(videoComposer, /renderVideoExpertModelPicker\(\)/);
  assert.match(picker, /renderUnifiedExecutionModelMenu\(threadId, selected, disabled\)/);
  assert.match(picker, /renderImageGenerationModelMenu\(modelOptions, selected, disabled\)/);
  assert.match(picker, /renderVideoGenerationModelMenu\(selected, disabled\)/);
  assert.match(source, /imageGenerationModelGroups\(catalog\)/);
  assert.match(source, /composer-model-menu grouped/);
  assert.match(source, /composer-model-group-title/);
  assert.match(styles, /\.media-creation-composer\s*\{[^}]*padding-top:\s*8px;[^}]*padding-right:\s*15px;[^}]*padding-bottom:\s*8px;[^}]*padding-left:\s*15px;/);
  assert.match(styles, /\.media-creation-composer \.composer-input-wrap\s*\{[^}]*margin-bottom:\s*38px;/);
  assert.match(styles, /\.pending-attachments\s*\{[^}]*height:\s*56px;/);
  assert.match(styles, /\.media-creation-composer \.pending-attachments\s*\{[^}]*height:\s*62px;[^}]*align-items:\s*center;/);
});

test("media attachment controls do not move the blank-thread hero", () => {
  assert.match(
    styles,
    /\.chat-panel:has\(> \.composer > \.pending-attachments-wrap\)[\s\S]*?> \.new-thread-hero\s*\{[^}]*transform:\s*translateY\(32px\);/s,
  );
});

test("media creation leaves extra space below the first-frame attachment rail", () => {
  assert.match(
    styles,
    /\.media-creation-composer \.pending-attachments-wrap\s*\{[^}]*margin-bottom:\s*7\.5px;/,
  );
});

test("the image size control occupies the marked slot and follows the selected model", () => {
  const composer = sourceBlock(
    "function renderComposer(thread",
    "function renderVideoExpertComposer",
  );
  const controls = sourceBlock(
    "function renderImageGenerationParameterPickers",
    "type ComposerModelBrand",
  );
  const requestParams = sourceBlock(
    "function imageGenerationModelRequestParams",
    "function selectImageGenerationModelForThread",
  );

  assert.match(
    composer,
    /\$\{composerModePicker\}[\s\S]*renderImageGenerationParameterPickers\(thread\.id\)[\s\S]*\$\{composerTrailingPicker\}/,
  );
  assert.match(controls, /data-video-expert-menu="image-size"/);
  assert.match(controls, /aria-label="图片尺寸"/);
  assert.match(controls, /capability\.sizeOptions/);
  assert.match(requestParams, /imageGenerationSize:/);
  assert.match(requestParams, /imageGenerationSizeField:/);
  assert.doesNotMatch(
    source,
    /imageGenerationCount|threadImageCounts|data-image-generation-count|image-generation-count-select/,
  );
  assert.match(
    styles,
    /\.image-generation-size-select\s*\{[^}]*width:\s*90px;[^}]*min-width:\s*90px;[^}]*max-width:\s*90px;[^}]*flex:\s*0 0 90px;/s,
  );
  assert.match(
    styles,
    /\.image-generation-size-select \.video-expert-select-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;[^}]*max-width:\s*100%;/s,
  );
});

test("explicit image ratios are reconciled before a new task is created", () => {
  const routing = sourceBlock(
    "function reconcileImageGenerationSelectionForPrompt",
    "function videoGenerationModelRequestParams",
  );
  const send = sourceBlock(
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(routing, /requestedImageGenerationAspectRatio\(prompt\)/);
  assert.match(routing, /state\.imageGenerationModelCatalog\.models/);
  assert.match(routing, /imageGenerationSizeForAspectRatio/);
  assert.match(routing, /imageGenerationModelByThreadId\.set\(threadId, targetModel\)/);
  assert.match(routing, /imageGenerationSizeByThreadId\.set\(threadId, targetSize\)/);
  assert.ok(
    send.indexOf("reconcileImageGenerationSelectionForPrompt") <
      send.indexOf("promoteLocalBlankThreadForSend"),
  );
});

test("media type changes also change reference image upload rules", () => {
  const queue = sourceBlock("function queueFiles", "function localAttachmentFromFile");
  const folders = sourceBlock(
    "function queueComposerFolders",
    "function queueFolders",
  );
  const paste = sourceBlock(
    "function canQueuePastedTextAttachment",
    "function queueLargePastedTextAsAttachment",
  );
  const switchMode = sourceBlock(
    "async function switchNewThreadMode",
    "function renderBlankThreadHero",
  );

  assert.match(queue, /isVideoExpertThreadId\(threadId\)[\s\S]*queueVideoExpertFiles/);
  assert.match(queue, /isImageGenerationThreadMode\(threadId\)[\s\S]*queueImageGenerationFiles/);
  assert.match(queue, /files\.filter\(isGptImageReferenceFile\)/);
  assert.match(folders, /isImageGenerationThreadMode\(threadId\)/);
  assert.match(paste, /!isImageGenerationThreadMode\(threadId\)/);
  assert.match(
    switchMode,
    /mode === "image-generation"[\s\S]*draft\.attachments\.filter\(isImageAttachment\)/,
  );
  assert.match(
    switchMode,
    /mode === "video-generation"[\s\S]*selectedVideoExpertInputPolicy\(\)/,
  );
});

test("video creation controls keep compact tools and use the unified model picker", () => {
  const unifiedModelPicker = sourceBlock(
    "function renderUnifiedExecutionModelMenu",
    "function renderComposerModelPicker",
  );
  const availableGroups = sourceBlock(
    "function unifiedExecutionAvailableModelGroups",
    "function workflowCanvasExecutionAgentExecutorOptions",
  );

  assert.match(
    styles,
    /\.video-expert-select-button\s*\{[^}]*width:\s*92px;[^}]*height:\s*26px;[^}]*justify-content:\s*center;[^}]*gap:\s*3\.2px;[^}]*border:\s*0;[^}]*border-radius:\s*8px;[^}]*background:\s*#f6f6f6;[^}]*color:\s*var\(--text-primary\);[^}]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\);[^}]*padding:\s*0 8px;/s,
  );
  assert.match(
    styles,
    /\.video-expert-select-button:hover,\s*\.video-expert-select\.open \.video-expert-select-button\s*\{[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.match(
    styles,
    /\.video-expert-select-duration \.video-expert-select-button\s*\{\s*width:\s*64px;\s*\}/s,
  );
  assert.match(
    unifiedModelPicker,
    /class="chat-title-group-menu composer-model-menu grouped unified-execution-model-menu"/,
  );
  assert.match(
    availableGroups,
    /groupMediaModelsByProvider\(state\.videoExpertModels\)/,
  );
  assert.match(unifiedModelPicker, /composer-model-group-title/);
  assert.match(
    styles,
    /\.composer-model-picker \.chat-title-group-button,\s*\.video-expert-select-model \.chat-title-group-button\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*184px;[^}]*height:\s*28px;[^}]*gap:\s*3px;[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-primary\);[^}]*padding:\s*0 6px;/s,
  );
  assert.match(
    styles,
    /\.composer-group-picker \.chat-title-group-button\s*\{[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.match(
    styles,
    /\.video-expert-select-model \.chat-title-group-button span\s*\{\s*transform:\s*translateY\(1px\);\s*\}/s,
  );
  assert.doesNotMatch(
    styles,
    /\.video-expert-select-model \.video-expert-select-button\s*\{[^}]*width:/s,
  );
  assert.match(
    styles,
    /\.video-expert-tool-right\s*\{[^}]*gap:\s*6px;/s,
  );
});

test("video models preserve the server-documented default duration", () => {
  assert.equal(
    longestVideoModelDuration([
      { value: "6" },
      { value: "20" },
      { value: "12" },
      { value: "16" },
    ]),
    "20",
  );
  assert.equal(
    longestVideoModelDuration([
      { value: "4" },
      { value: "15" },
      { value: "10" },
    ]),
    "15",
  );
  assert.equal(longestVideoModelDuration([{ value: "10" }]), "10");

  const selection = sourceBlock(
    "function selectVideoExpertModel",
    "function reconcileVideoExpertAttachmentsForModel",
  );
  const normalization = sourceBlock(
    "function normalizeVideoExpertModelCapability",
    "function normalizeVideoExpertMediaCount",
  );
  assert.match(selection, /const modelChanged = state\.videoExpertModel !== model\.id/);
  assert.match(
    selection,
    /state\.videoExpertDuration = modelChanged\s*\?\s*model\.defaultDuration/,
  );
  assert.match(
    normalization,
    /defaultDuration:\s*firstString\(\s*value\?\.default_duration,\s*value\?\.defaultDuration/,
  );
});

test("media creation locks the selected video model, input mode, ratio, resolution, size, and duration", () => {
  const requestParams = sourceBlock(
    "function videoGenerationModelRequestParams",
    "function reconcileImageGenerationAttachmentsForModel",
  );

  assert.match(requestParams, /newThreadModeForThread\(threadId\) !== "video-generation"/);
  assert.match(requestParams, /videoGenerationModel: model\.id/);
  assert.match(requestParams, /videoGenerationInputMode: inputPolicy\.mode/);
  assert.match(requestParams, /videoGenerationAspectRatio: screenSize\.value/);
  assert.match(requestParams, /videoGenerationDuration: normalizeVideoExpertDuration/);
  assert.match(requestParams, /videoGenerationResolution:/);
  assert.match(requestParams, /videoGenerationSize: screenSize\.size/);
});

test("media model menus place server-provided prices at the far right", () => {
  const sharedOption = sourceBlock(
    "function renderComposerModelOptionButton",
    "function availableQuestionAnswerModelGroups",
  );
  const videoOptions = sourceBlock(
    "function videoExpertComposerModelOptions",
    "function unavailableVideoGenerationModelOption",
  );

  assert.match(sharedOption, /option\.priceLabel/);
  assert.match(sharedOption, /composer-model-option-price/);
  assert.match(videoOptions, /priceLabel:\s*mediaModelPriceLabel/);
  assert.match(
    styles,
    /\.composer-model-menu\.grouped button\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*8px;/s,
  );
  assert.match(
    styles,
    /\.composer-model-menu\.grouped \.composer-model-option-price\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin-left:\s*auto;[^}]*font-variant-numeric:\s*tabular-nums;/s,
  );
});

test("Seedance keeps its branded capitalization in media provider groups", () => {
  assert.match(
    mediaModelGroups,
    /MEDIA_PROVIDER_LABELS[\s\S]*seedance:\s*"Seedance"/,
  );
  assert.match(
    mediaModelGroups,
    /label:\s*mediaModelProviderLabel\(provider\)/,
  );
});

test("selected media models keep the fixed serial execution label", () => {
  const picker = sourceBlock(
    "function renderComposerModePicker",
    "function activeComposerDraftSnapshot",
  );
  assert.match(picker, /class="composer-mode-trigger serial-only"/);
  assert.match(picker, /role="status"/);
  assert.match(picker, /<span>执行模式<\/span>/);
  assert.doesNotMatch(
    picker,
    /data-new-thread-mode|data-composer-cluster-mode|data-composer-mode-cascade|媒体创作|计划模式|集群模式/,
  );
  assert.doesNotMatch(styles, /data-composer-mode-cascade="media"/);
});

test("selecting a unified model switches the internal composer capability", () => {
  const selection = sourceBlock(
    "async function selectComposerModelForThread",
    "function unavailableProviderChatModelOption",
  );
  const binding = sourceBlock(
    '.querySelectorAll<HTMLButtonElement>("[data-composer-model]")',
    "bindComposerSkillMentionSearchEvents",
  );

  assert.match(selection, /kind === "image"[\s\S]*switchNewThreadMode\("image-generation"\)/);
  assert.match(selection, /kind === "video"[\s\S]*selectVideoExpertModel\(selected\.value\)[\s\S]*switchNewThreadMode\("video-generation"\)/);
  assert.match(selection, /switchNewThreadMode\("execution"\)[\s\S]*selectChatModelForThread/);
  assert.match(binding, /button\.dataset\.composerModelKind/);
  assert.match(binding, /composerModelOptionsForKind\(threadId, kind\)/);
  assert.match(binding, /selectComposerModelForThread\(threadId, selected, kind\)/);
});

test("DeepSeek execution state cannot leak into image or video generation", () => {
  const requestOptions = sourceBlock(
    "function selectedChatModelRequestOptions",
    "function hydrateSelectedChatModel",
  );
  const sendGate = sourceBlock(
    "function deepSeekMediaComposerValidationError",
    "async function sendCurrentMessage",
  );
  const send = sourceBlock(
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );
  const selection = sourceBlock(
    "async function selectComposerModelForThread",
    "function unavailableProviderChatModelOption",
  );

  assert.match(
    requestOptions,
    /mediaCreationExecutionModelOption\([\s\S]*conversationMode,[\s\S]*configuredSelected,[\s\S]*chatModelOptions/,
  );
  assert.match(
    requestOptions,
    /isMediaCreationMode\(conversationMode\)[\s\S]*mediaExecutionModel !== configuredSelected/,
  );
  assert.match(
    sendGate,
    /isMediaCreationMode\(newThreadModeForThread\(threadId\)\)[\s\S]*DEEPSEEK_EXECUTION_PROVIDER_ID/,
  );
  assert.match(send, /deepSeekMediaComposerValidationError\(threadId\)/);
  assert.match(
    selection,
    /kind === "image" \|\| kind === "video"[\s\S]*mediaCreationExecutionModelOption/,
  );
});

test("the unified model menu covers light and dark interaction states", () => {
  assert.match(
    styles,
    /\.chat-title-group-menu\s*\{[^}]*background:\s*var\(--surface-primary\);/s,
  );
  assert.match(
    styles,
    /\.composer-model-menu button:hover,\s*\.composer-model-menu button:focus-visible\s*\{[^}]*background:\s*var\(--surface-soft\);/s,
  );
  assert.match(
    styles,
    /\.composer-model-menu button\.active,[\s\S]*background:\s*var\(--selection-strong\);/s,
  );
  assert.match(
    styles,
    /\.composer-model-menu button:disabled\s*\{[^}]*opacity:\s*0\.55;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.composer-model-menu\.grouped \.composer-model-option-name\s*\{[^}]*color:\s*#e2e7ef;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.composer-model-menu button:focus-visible\s*\{[^}]*outline-color:\s*rgba\(113, 190, 255, 0\.72\);/s,
  );
});
