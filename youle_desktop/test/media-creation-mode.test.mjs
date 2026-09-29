import { withAnalysisModelRecoveryPolicy } from "../src/main/analysis-model-policy.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { mediaCreationExecutionModelOption } from "../src/renderer/business-model-pools.ts";
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

function expandedComposerHarness({ recoveryState = null } = {}) {
  const names = [
    "newThreadModeForThread", "isMediaCreationMode", "isExpandedTradingExpertConversation",
    "isTradingExpertExecutionThreadId", "usesUnifiedExecutionModelPicker", "composerModelKindForThread",
    "switchNewThreadMode", "selectComposerModelForThread", "selectedChatModelRequestOptions",
    "tradingExpertAgentTextForSend",
  ];
  const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length);
  const code = ts.transpileModule(functions.map((node) => node.getText(parsed)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const gpt = { value: "gpt-5.6-sol", providerId: "haolo_ai", reasoningEfforts: [], serviceTiers: [] };
  const deepSeek = { value: "deepseek-flash", providerId: "deepseek", reasoningEfforts: [], serviceTiers: [] };
  const fixture = {
    currentId: "trading-existing", busy: false, locked: false, allowSelection: true,
    selected: deepSeek, selectedImage: null, selectedVideo: null, persisted: [],
    state: { auth: { profile: null }, tradingExpertChartCollapsed: true, rightCollapsed: false, composerText: "保留这份草稿", attachments: [], composerQuote: { text: "原会话引用" }, composerThreadReferences: [{ threadId: "reference" }] },
    modes: new Map([["trading-existing", "execution"]]),
    tradingIds: new Set(["trading-existing"]),
  };
  const context = {
    state: fixture.state, newThreadModeByThreadId: fixture.modes, tradingExpertThreadIds: fixture.tradingIds,
    providerDraftThreadIds: new Set(), chatModelOptions: [gpt, deepSeek],
    isTradingExpertThreadId: (id) => fixture.tradingIds.has(id),
    providerFromThreadId: (id) => id === "provider-thread" ? "codex" : null,
    currentComposerThreadId: () => fixture.currentId,
    isBlankNewThread: (id) => id === "blank",
    isThreadModelSelectionLocked: () => fixture.locked,
    isComposerThreadBusy: () => fixture.busy,
    modelMembershipAccess: () => ({ allowed: true, requiredLabel: "" }),
    firstString: (...values) => values.find((value) => typeof value === "string" && value) || "",
    mediaCreationExecutionModelOption,
    selectedChatModelOption: () => fixture.selected,
    selectChatModelForThread: (_id, model) => {
      if (!fixture.allowSelection) return false;
      fixture.selected = model;
      return true;
    },
    selectImageGenerationModelForThread: async (_id, model) => {
      if (!fixture.allowSelection) return false;
      fixture.selectedImage = model.value;
      return true;
    },
    selectVideoExpertModel: async (model) => {
      if (!fixture.allowSelection) return false;
      fixture.selectedVideo = model;
      return true;
    },
    dismissComposerSkillMentionPopover() {}, render() {}, focusFormFieldAfterRender() {}, showToast() {},
    clusterModeForThread: () => "native", groupIdForThreadContext: () => "recent",
    isImageAttachment: (attachment) => attachment.mime === "image/png",
    selectedVideoExpertInputPolicy: () => ({}), videoExpertInputAttachments: (attachments) => attachments,
    revokeQueuedAttachmentUrls() {}, setComposerDraft() {},
    activeComposerDraftSnapshot: () => ({ text: fixture.state.composerText, attachments: fixture.state.attachments, quote: fixture.state.composerQuote, threadReferences: fixture.state.composerThreadReferences }),
    saveThreadPreferences: () => fixture.persisted.push({ mode: fixture.modes.get(fixture.currentId), tradingIds: [...fixture.tradingIds] }),
    threadModelSelection: () => ({ model: fixture.selected.value, modelProvider: fixture.selected.providerId }),
    threadModelSettings: () => null,
    executionModelProviderId: (...values) => values.find(Boolean) || "haolo_ai",
    isQuestionAnswerThreadId: () => false,
    withAnalysisModelRecoveryPolicy, analysisModelRecoveryState: recoveryState,
    DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek", DEEPSEEK_EXECUTION_MODEL_VALUE: "deepseek-flash",
    tradingExpertSelectedModelRequestOptions: () => ({ model: fixture.selected.value, modelProvider: fixture.selected.providerId, reasoningEffortPolicy: "fixed" }),
    tradingStrategyMentionedByText: () => ({ ui: { buildExpertPrompt: (text) => `strategy:${text}` } }),
    canonicalizeTradingExpertMentionText: (text) => text,
  };
  return Object.assign(fixture, { gpt, deepSeek }, new Function(...Object.keys(context), `${code}\nreturn { ${names.join(",")} };`)(...Object.values(context)));
}

test("media creation retains GPT execution throughout an active recovery window", async () => {
  const now = Date.now();
  const fixture = expandedComposerHarness({ recoveryState: { version: 1, activatedAt: now, fallbackUntil: now + 3_600_000 } });
  for (const [kind, model] of [["image", "gpt-image-1"], ["video", "grok-imagine-video-1.5"]]) {
    assert.equal(await fixture.selectComposerModelForThread(fixture.currentId, { value: model }, kind), true);
    const settings = fixture.selectedChatModelRequestOptions(fixture.currentId);
    assert.equal(settings.model, fixture.gpt.value);
    assert.equal(settings.modelProvider, "haolo_ai");
    assert.notEqual(settings.reasoningEffort, "max");
  }
  await fixture.switchNewThreadMode("execution", fixture.currentId);
  assert.equal(fixture.selectedChatModelRequestOptions(fixture.currentId).model, fixture.deepSeek.value);
});

test("expanded trading conversations expose media models without enabling other established tasks or providers", () => {
  const fixture = expandedComposerHarness();
  assert.equal(fixture.usesUnifiedExecutionModelPicker("trading-existing"), true);
  assert.equal(fixture.usesUnifiedExecutionModelPicker("ordinary-existing"), false);
  assert.equal(fixture.usesUnifiedExecutionModelPicker("provider-thread"), false);
  assert.equal(fixture.usesUnifiedExecutionModelPicker("blank"), true);
  fixture.state.rightCollapsed = true;
  assert.equal(fixture.usesUnifiedExecutionModelPicker("trading-existing"), false);
  fixture.state.rightCollapsed = false;
  fixture.state.tradingExpertChartCollapsed = false;
  assert.equal(fixture.usesUnifiedExecutionModelPicker("trading-existing"), false);
  fixture.modes.set("trading-existing", "image-generation");
  assert.equal(fixture.usesUnifiedExecutionModelPicker("trading-existing"), true, "media tasks must retain a way to return to execution after restoring the chart");
  fixture.modes.set("trading-existing", "multi-agent");
  assert.equal(fixture.newThreadModeForThread("trading-existing"), "execution");
});

test("an established trading conversation switches image/video/execution in place and keeps its draft and GPT media routing", async () => {
  const fixture = expandedComposerHarness();
  const draft = structuredClone(fixture.state);
  for (const [kind, model, mode] of [["image", "gpt-image-1", "image-generation"], ["video", "grok-imagine-video-1.5", "video-generation"]]) {
    assert.equal(await fixture.selectComposerModelForThread("trading-existing", { value: model }, kind), true);
    assert.equal(fixture.newThreadModeForThread("trading-existing"), mode);
    assert.equal(fixture.currentId, "trading-existing");
    assert.equal(fixture.tradingIds.has("trading-existing"), true);
    assert.equal(fixture.state.composerText, draft.composerText);
    assert.deepEqual(fixture.state.composerQuote, draft.composerQuote);
    assert.deepEqual(fixture.state.composerThreadReferences, draft.composerThreadReferences);
    assert.equal(fixture.isTradingExpertExecutionThreadId("trading-existing"), false);
    assert.equal(fixture.tradingExpertAgentTextForSend("trading-existing", "@缠论", "media prompt"), "media prompt");
    assert.deepEqual(fixture.selectedChatModelRequestOptions("trading-existing"), { model: fixture.gpt.value, modelProvider: "haolo_ai", serviceTier: null });
    assert.equal(fixture.selected, fixture.deepSeek, "media fallback must not overwrite the execution preference");
    assert.equal(fixture.persisted.at(-1).mode, mode);
  }
  assert.equal(await fixture.selectComposerModelForThread("trading-existing", fixture.gpt, "execution"), true);
  assert.equal(fixture.newThreadModeForThread("trading-existing"), "execution");
  assert.equal(fixture.isTradingExpertExecutionThreadId("trading-existing"), true);
  assert.equal(fixture.selectedChatModelRequestOptions("trading-existing").reasoningEffortPolicy, "fixed");
});

test("media switching does not change running, loading, cancelled, or newly selected conversations", async () => {
  const fixture = expandedComposerHarness();
  for (const key of ["busy", "locked"]) {
    fixture[key] = true;
    assert.equal(await fixture.selectComposerModelForThread("trading-existing", { value: "gpt-image-1" }, "image"), false);
    assert.equal(fixture.newThreadModeForThread("trading-existing"), "execution");
    fixture[key] = false;
  }
  fixture.allowSelection = false;
  assert.equal(await fixture.selectComposerModelForThread("trading-existing", { value: "gpt-image-1" }, "image"), false);
  fixture.allowSelection = true;
  fixture.currentId = "another-task";
  await fixture.switchNewThreadMode("video-generation", "trading-existing");
  assert.equal(fixture.newThreadModeForThread("trading-existing"), "execution");
  assert.equal(fixture.modes.has("another-task"), false);
});

test("trading media sends bypass every chart/onboarding/alert router and retain workspace identity on reload", () => {
  const send = sourceBlock("async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  assert.doesNotMatch(send, /isTradingExpertThreadId\(threadId\)/);
  for (const candidate of ["tradingStrategyAtSend", "personalStrategyConversationAtSend", "personalStrategyCandidateAtSend", "tradingAlertCandidateAtSend", "tradingGeneralCandidateAtSend"]) {
    assert.match(send, new RegExp(`const ${candidate} = isTradingExpertExecutionThreadId\\(threadId\\)`));
  }
  assert.match(source, /new Set<string>\(threadPreferences\.tradingExpertThreads\)/);
  assert.match(source, /tradingExpertThreads: \[\.\.\.tradingExpertThreadIds\]\.filter/);
  assert.match(source, /tradingExpertThreads: Array\.isArray\(parsed\.tradingExpertThreads\)/);
});

test("streamed completion re-enables the model picker without remounting the composer", () => {
  const code = ts.transpileModule(sourceBlock("function patchComposerDynamicState", "function renderTradingExpertMentionMenu"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let busy = true;
  const trigger = { disabled: false };
  const option = { disabled: false };
  const input = { value: "pending draft", placeholder: "prompt" };
  const form = { dataset: { threadId: "trading" }, querySelectorAll: () => [trigger, option], querySelector: () => input };
  const context = {
    state: { currentThreadId: "trading", activeView: "chat" },
    root: { querySelector: () => form }, currentThread: () => ({ id: "trading" }),
    patchComposerSubmitButton: () => false, patchComposerPendingAttachments: () => false,
    isComposerModelSelectionDisabled: () => busy, composerPlaceholderForThread: () => "prompt",
  };
  const patch = new Function(...Object.keys(context), `${code}\nreturn patchComposerDynamicState;`)(...Object.values(context));
  assert.equal(patch("trading"), true);
  assert.equal(trigger.disabled, true);
  assert.equal(option.disabled, true);
  busy = false;
  assert.equal(patch("trading"), true);
  assert.equal(trigger.disabled, false);
  assert.equal(option.disabled, false);
  assert.equal(input.value, "pending draft");
  assert.equal(patch("background-thread"), false);
});

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
  assert.match(styles, /\.trading-expert-panel\s*> \.composer\.media-creation-composer\s*\{[^}]*position: relative;[^}]*inset: auto;[^}]*flex: 0 0 auto;/);
  assert.match(styles, /\.trading-expert-panel:has\(> \.composer\.media-creation-composer\)\s*> \.agent-panel-inner\s*\{[^}]*min-height: 0;[^}]*flex: 1 1 0;/);
  assert.match(styles, /\.trading-expert-panel:has\(> \.composer\.media-creation-composer\)\s*\.trading-expert-dashboard\.chat\s*\{[^}]*padding-bottom: 0;/);
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

  assert.match(selection, /kind === "image"[\s\S]*switchNewThreadMode\("image-generation", id\)/);
  assert.match(selection, /kind === "video"[\s\S]*selectVideoExpertModel\(selected\.value\)[\s\S]*switchNewThreadMode\("video-generation", id\)/);
  assert.match(selection, /switchNewThreadMode\("execution", id\)[\s\S]*selectChatModelForThread/);
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
    /html\[data-theme="dark"\] \.composer-model-menu\.grouped \.composer-model-option-name\s*\{[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.composer-model-menu button:focus-visible\s*\{[^}]*outline-color:\s*rgba\(113, 190, 255, 0\.72\);/s,
  );
});
