import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION,
  DEEPSEEK_EXECUTION_MODEL_VALUE,
  DEEPSEEK_EXECUTION_PROVIDER_ID,
  DEFAULT_CHAT_MODEL_VALUE,
  FIXED_CHAT_MODEL_OPTIONS,
  chatModelOptionsFromList,
  fastServiceTier,
  normalizeFixedChatModel,
  selectedReasoningEffort,
} from "../src/renderer/chat-model-catalog.ts";
import {
  codexToolExecutionModelOption,
  defaultExecutionChatModelOption,
  executionChatModelOptionIdentity,
  executionChatModelOptions,
  mediaCreationExecutionModelOption,
  normalizeBusinessModelPoolsState,
  shouldAdoptExecutionPoolDefault,
  supportsCodexToolExecutionModel,
} from "../src/renderer/business-model-pools.ts";
import {
  DEFAULT_EXECUTION_MODEL_PROVIDER_ID,
  canonicalExecutionModelProvider,
} from "../src/main/execution-model-provider.mjs";
import { normalizeRuntimeThreadModelSettings } from "../src/renderer/thread-model-settings.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const providerCatalogSource = readFile(
  new URL("../src/renderer/provider-model-catalog.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const appServerClientSource = readFile(new URL("../src/main/app-server-client.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("media creation uses a GPT root without overwriting a DeepSeek execution preference", () => {
  const deepSeek = {
    value: "deepseek-v4-flash",
    providerId: "deepseek",
    label: "DeepSeek V4 Flash",
    description: "",
    reasoningEfforts: [],
    serviceTiers: [],
    inputModalities: ["text"],
  };
  const gpt = {
    value: "gpt-5.6-sol",
    providerId: "haolo_ai",
    label: "GPT-5.6 Sol",
    description: "",
    reasoningEfforts: [],
    serviceTiers: [],
    inputModalities: ["text", "image"],
    isDefault: true,
  };

  assert.equal(supportsCodexToolExecutionModel(deepSeek), false);
  assert.equal(supportsCodexToolExecutionModel(gpt), true);
  assert.equal(codexToolExecutionModelOption(deepSeek, [deepSeek, gpt]), gpt);
  assert.equal(codexToolExecutionModelOption(deepSeek, [deepSeek]), null);
  assert.equal(
    mediaCreationExecutionModelOption("image-generation", deepSeek, [deepSeek, gpt]),
    gpt,
  );
  assert.equal(
    mediaCreationExecutionModelOption("video-generation", deepSeek, [deepSeek, gpt]),
    gpt,
  );
  assert.equal(
    mediaCreationExecutionModelOption("execution", deepSeek, [deepSeek, gpt]),
    deepSeek,
  );
  assert.equal(
    mediaCreationExecutionModelOption("image-generation", deepSeek, [deepSeek]),
    null,
  );
});

test("model/list metadata drives model, effort, tier, and modality options", () => {
  const options = chatModelOptionsFromList({
    data: [
      {
        id: "gpt-5.6-terra",
        displayName: "Terra",
        description: "Balanced",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced reasoning" },
          { reasoningEffort: "max", description: "Deep reasoning" },
          { reasoningEffort: "ultra", description: "Deepest reasoning" },
          { reasoningEffort: "future-unknown", description: "Ignored safely" },
        ],
        defaultReasoningEffort: "max",
        serviceTiers: [{ id: "priority", name: "Fast", description: "Faster responses" }],
        defaultServiceTier: "priority",
        inputModalities: ["text", "image"],
        isDefault: true,
      },
      { id: "hidden-model", displayName: "Hidden", hidden: true },
    ],
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].value, "gpt-5.6-terra");
  assert.equal(options[0].label, "Terra");
  assert.deepEqual(options[0].reasoningEfforts.map((item) => item.value), ["medium", "max", "ultra"]);
  assert.equal(options[0].defaultReasoningEffort, "max");
  assert.equal(options[0].defaultServiceTier, "priority");
  assert.deepEqual(options[0].inputModalities, ["text", "image"]);
  assert.equal(fastServiceTier(options[0])?.id, "priority");
  assert.equal(fastServiceTier({ ...options[0], serviceTiers: [{ id: "standard", name: "Standard", description: "" }] }), undefined);
  assert.equal(selectedReasoningEffort(options[0], "ultra"), "ultra");
  assert.equal(selectedReasoningEffort(options[0], "future-unknown"), "max");
});

test("fixed catalog contains exactly the four curated models and labels", () => {
  assert.deepEqual(
    FIXED_CHAT_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
    [
      { value: "gpt-5.6-sol", label: "\u590d\u6742\u63a8\u7406(5.6 Sol)" },
      { value: "gpt-5.6-terra", label: "\u5747\u8861\u4e3b\u529b(5.6 Terra)" },
      { value: "gpt-5.6-luna", label: "\u65e5\u5e38\u9ad8\u901f(5.6 Luna)" },
      { value: "gpt-5.5", label: "\u7ecf\u5178\u7a33\u5b9a(5.5 High)" },
    ],
  );

  const classic = FIXED_CHAT_MODEL_OPTIONS.find((option) => option.value === "gpt-5.5");
  assert.ok(classic);
  assert.equal(DEFAULT_CHAT_MODEL_VALUE, "gpt-5.5");
  assert.equal(classic.isDefault, true);
  assert.equal(selectedReasoningEffort(classic, undefined), "high");
  assert.equal(fastServiceTier(classic)?.id, "priority");
  assert.equal(normalizeFixedChatModel("gpt-5.4"), "gpt-5.5");
  assert.equal(normalizeFixedChatModel("GPT-5.6-SOL"), "gpt-5.6-sol");

  assert.deepEqual(chatModelOptionsFromList(null), []);
});

test("runtime thread settings preserve old and private model names", () => {
  assert.deepEqual(
    normalizeRuntimeThreadModelSettings({
      model: "gpt-5.4-private-alias",
      reasoningEffort: "high",
      serviceTier: null,
    }),
    {
      modelProvider: "haolo_ai",
      model: "gpt-5.4-private-alias",
      reasoningEffort: "high",
      serviceTier: null,
    },
  );
  assert.equal(
    normalizeRuntimeThreadModelSettings({ model: "GPT-5.6-TERRA" })?.model,
    "gpt-5.6-terra",
  );
});

test("configured execution default overrides the legacy GPT fallback for new tasks", () => {
  const options = [
    {
      ...FIXED_CHAT_MODEL_OPTIONS.find((option) => option.value === "gpt-5.5"),
      providerId: "haolo_ai",
      isDefault: false,
    },
    {
      ...DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION,
      isDefault: true,
    },
  ];
  const selected = defaultExecutionChatModelOption(options);
  assert.equal(selected?.value, DEEPSEEK_EXECUTION_MODEL_VALUE);
  assert.equal(
    executionChatModelOptionIdentity(selected),
    JSON.stringify([DEEPSEEK_EXECUTION_PROVIDER_ID, DEEPSEEK_EXECUTION_MODEL_VALUE]),
  );
  assert.equal(
    shouldAdoptExecutionPoolDefault(
      options[0],
      "",
      selected,
    ),
    true,
    "the first upgraded client run must replace the old implicit GPT default",
  );
  assert.equal(
    shouldAdoptExecutionPoolDefault(
      options[0],
      executionChatModelOptionIdentity(selected),
      selected,
    ),
    false,
    "a later manual choice remains stable while the administrator default is unchanged",
  );
});

test("switching from DeepSeek to a GPT pool model uses the registered Haolo runtime provider", () => {
  const state = normalizeBusinessModelPoolsState({
    configured: true,
    pools: [
      {
        id: "execution",
        enabled: true,
        capabilities: ["root_execution"],
        models: [
          {
            id: DEEPSEEK_EXECUTION_MODEL_VALUE,
            displayName: "DeepSeek V4 Flash",
            provider: DEEPSEEK_EXECUTION_PROVIDER_ID,
            enabled: true,
          },
          {
            id: "gpt-5.6-sol",
            displayName: "gpt-5.6-sol",
            provider: "codex",
            enabled: true,
          },
        ],
      },
    ],
  });
  const options = executionChatModelOptions(state);
  const deepSeek = options.find(
    (option) => option.value === DEEPSEEK_EXECUTION_MODEL_VALUE,
  );
  const gpt = options.find((option) => option.value === "gpt-5.6-sol");

  assert.equal(deepSeek?.providerId, DEEPSEEK_EXECUTION_PROVIDER_ID);
  assert.equal(gpt?.providerId, DEFAULT_EXECUTION_MODEL_PROVIDER_ID);
  assert.equal(
    executionChatModelOptionIdentity(gpt),
    JSON.stringify([DEFAULT_EXECUTION_MODEL_PROVIDER_ID, "gpt-5.6-sol"]),
  );
  assert.equal(canonicalExecutionModelProvider(" CODEX "), "haolo_ai");
  assert.equal(canonicalExecutionModelProvider("deepseek"), "deepseek");
  assert.equal(
    normalizeRuntimeThreadModelSettings({
      model: "gpt-5.6-sol",
      modelProvider: "codex",
    })?.modelProvider,
    DEFAULT_EXECUTION_MODEL_PROVIDER_ID,
  );
});

test("DeepSeek execution pool exposes the official text-only adaptive reasoning contract", () => {
  const state = normalizeBusinessModelPoolsState({
    configured: true,
    pools: [
      {
        id: "execution",
        enabled: true,
        capabilities: ["root_execution"],
        models: [
          {
            id: DEEPSEEK_EXECUTION_MODEL_VALUE,
            displayName: "DeepSeek V4 Flash",
            provider: DEEPSEEK_EXECUTION_PROVIDER_ID,
            routeGroupId: 17,
            enabled: true,
            isDefault: false,
            credentialAvailable: true,
          },
        ],
      },
    ],
  });
  const [option] = executionChatModelOptions(state);

  assert.equal(option.value, DEEPSEEK_EXECUTION_MODEL_VALUE);
  assert.equal(option.providerId, DEEPSEEK_EXECUTION_PROVIDER_ID);
  assert.equal(option.routeGroupId, 17);
  assert.deepEqual(option.inputModalities, ["text"]);
  assert.deepEqual(option.reasoningEfforts.map((effort) => effort.value), ["low", "high", "max"]);
  assert.equal(option.defaultReasoningEffort, "high");
  assert.equal(DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION.serviceTiers.length, 0);
  assert.equal(
    normalizeRuntimeThreadModelSettings({
      model: DEEPSEEK_EXECUTION_MODEL_VALUE,
      reasoningEffort: "low",
    })?.reasoningEffort,
    "low",
  );
});

test("DeepSeek execution option stays hidden until its relay credential is available", () => {
  const state = normalizeBusinessModelPoolsState({
    configured: true,
    pools: [
      {
        id: "execution",
        enabled: true,
        capabilities: ["root_execution"],
        models: [
          {
            id: DEEPSEEK_EXECUTION_MODEL_VALUE,
            provider: DEEPSEEK_EXECUTION_PROVIDER_ID,
            enabled: true,
            credentialAvailable: false,
          },
        ],
      },
    ],
  });
  assert.deepEqual(executionChatModelOptions(state), []);
});

test("renderer uses the execution pool with a fixed fallback and builds question-answer choices from the relay catalog", async () => {
  const renderer = await rendererSource;
  const providerCatalog = await providerCatalogSource;
  const hydration = sourceBlock(renderer, "function hydrateFixedChatModel", "async function loadThreads");
  assert.doesNotMatch(hydration, /api\.modelList\(\)/);
  assert.doesNotMatch(hydration, /chatModelOptionsFromList/);
  assert.match(renderer, /let chatModelOptions: readonly ChatModelOption\[\] = \[\.\.\.FIXED_CHAT_MODEL_OPTIONS\]/);
  assert.match(renderer, /chatModelOptions = executionChatModelOptions\(businessModelPoolsState\)/);
  assert.match(renderer, /api\.listBusinessModelPools/);
  assert.match(renderer, /defaultExecutionChatModelOption\(chatModelOptions\)/);
  assert.match(renderer, /shouldAdoptExecutionPoolDefault\(/);
  assert.match(renderer, /applyExecutionPoolDefaultToNewThreads\(poolDefault\)/);

  const picker = sourceBlock(renderer, "function renderComposerModelPicker", "function renderComposer(");
  assert.match(picker, /const modelOptions = composerModelOptionsForThread\(threadId\)/);
  assert.match(picker, /modelOptions\s*\.map/);
  assert.match(picker, /escapeHtml\(selectedLabel\)/);
  assert.match(
    picker,
    /awaitingEffectiveModel[\s\S]*awaitingProviderCatalog[\s\S]*awaitingImageGenerationCatalog[\s\S]*awaitingVideoGenerationCatalog[\s\S]*selected\.label/,
  );
  assert.match(picker, /isLocalCodexThread\(threadId\)[\s\S]*!threadModelSettings\(threadId\)/);
  assert.match(picker, /isQuestionAnswerThreadId\(threadId\)/);
  assert.match(picker, /renderUnifiedExecutionModelMenu\(threadId, selected, disabled\)/);
  assert.match(picker, /renderQuestionAnswerModelMenu\(selected, disabled\)/);
  assert.doesNotMatch(picker, /reasoningEfforts/);
  assert.doesNotMatch(picker, /inputModalities/);
  assert.doesNotMatch(picker, /role="note"/);
  assert.doesNotMatch(picker, /reasoning.*max|max.*reasoning/i);

  const executionMenu = sourceBlock(renderer, "function executionModelGroups", "function renderQuestionAnswerModelMenu");
  assert.match(executionMenu, /providerId === DEEPSEEK_EXECUTION_PROVIDER_ID/);
  assert.match(executionMenu, /"DeepSeek"/);
  const renderedExecutionMenu = sourceBlock(renderer, "function renderUnifiedExecutionModelMenu", "function renderComposerModelPicker");
  assert.match(renderedExecutionMenu, /renderComposerModelOptionButton/);

  const groupedMenu = sourceBlock(renderer, "function availableQuestionAnswerModelGroups", "function renderComposerModelPicker");
  assert.match(
    groupedMenu,
    /questionAnswerModelGroups\(\)\.filter\([\s\S]*group\.options\.length > 0[\s\S]*authenticatedProviderAvailable\(group\.provider\)/,
  );
  assert.match(groupedMenu, /const groups = availableQuestionAnswerModelGroups\(\)/);
  assert.match(groupedMenu, /groups[\s\S]*\.map/);
  assert.match(groupedMenu, /class="composer-model-group" role="group"/);
  assert.match(groupedMenu, /class="composer-model-group-title"/);
  assert.doesNotMatch(groupedMenu, /showIcon/);
  assert.match(groupedMenu, /composer-model-menu-empty/);

  assert.match(renderer, /providerModelGroups\(state\.providerModelCatalog\)/);
  assert.match(renderer, /providerForCatalogModel\(state\.providerModelCatalog, model\)/);
  assert.match(renderer, /async function preloadAuthenticatedModelCatalogs/);
  assert.match(
    renderer,
    /preloadAuthenticatedModelCatalogs\([\s\S]*refreshProviderModelCatalog\(\{[\s\S]*renderAfter: false/,
  );
  assert.match(renderer, /api\.listProviderModelCatalog/);
  assert.doesNotMatch(renderer, /const PROVIDER_CHAT_MODEL_OPTIONS/);
  assert.doesNotMatch(renderer, /const QUESTION_ANSWER_MODEL_GROUPS/);
  assert.match(
    providerCatalog,
    /const models = \(catalog\.providers\[provider\]\?\.models \|\| \[\]\)\.filter/,
  );
  assert.match(providerCatalog, /CLIENT_HIDDEN_MODEL_IDS = new Set\(\["gpt-5\.4"\]\)/);
  assert.match(providerCatalog, /return models\.map\(\(model\) =>/);
  assert.match(providerCatalog, /curatedModel\?\.label \|\| model\.id/);
  assert.match(providerCatalog, /claude-sonnet-5/);
  assert.match(providerCatalog, /claude-fable-5/);
  for (const provider of ["claude", "codex", "kimi", "deepseek", "gemini", "grok", "mimo", "perplexity", "doubao", "qwen"]) {
    assert.match(providerCatalog, new RegExp(`"${provider}"`));
  }

  const requestOptions = sourceBlock(
    renderer,
    "function selectedChatModelRequestOptions",
    "function selectedChatModelReasoningEffortsForRequest",
  );
  assert.doesNotMatch(requestOptions, /reasoningEffort/);
  assert.match(requestOptions, /const deepSeek =/);
  assert.match(requestOptions, /modelProvider: deepSeek \? DEEPSEEK_EXECUTION_PROVIDER_ID : modelProvider/);
  assert.match(requestOptions, /const selectedSettings = fallback \? null : threadModelSelection\(threadId\)/);
  assert.match(requestOptions, /const knownSettings = fallback \? null : threadModelSettings\(threadId\)/);
  assert.match(requestOptions, /const selected = fallback \|\| configuredSelected/);
  assert.match(requestOptions, /effort is selected per turn by Haolo's task/);
  assert.match(
    requestOptions,
    /model: isQuestionAnswerThreadId\(threadId\)[\s\S]*\? selected\.value[\s\S]*selectedSettings\?\.model \|\| knownSettings\?\.model \|\| selected\.value/,
  );
  assert.match(requestOptions, /serviceTier: null/);
  assert.doesNotMatch(renderer, /data-composer-reasoning-effort/);
  assert.doesNotMatch(renderer, /toggle-composer-fast-tier/);
  assert.doesNotMatch(renderer, /CHAT_MODEL_REASONING_STORAGE_KEY/);
  assert.doesNotMatch(renderer, /CHAT_MODEL_FAST_STORAGE_KEY/);
});

test("composer aurora follows the selected model brand with a restrained logo glow", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const auroraRenderer = sourceBlock(renderer, "type ComposerModelBrand", "function renderComposer(thread");
  const composerRenderer = sourceBlock(renderer, "function renderComposer(thread", "function renderVideoExpertComposer");

  assert.match(auroraRenderer, /questionAnswerProviderForModel\(selectedChatModelValue\(threadId\)\)/);
  assert.match(auroraRenderer, /effectiveProviderForThread\(threadId\)/);
  assert.match(auroraRenderer, /PROVIDER_CHAT_META\[brand\]\.avatarUrl/);
  assert.match(auroraRenderer, /class="composer-model-aurora" data-model-brand=/);
  assert.match(auroraRenderer, /if \(isMultiModelClusterThread\(threadId\)\) return "";/);
  assert.match(auroraRenderer, /dismissedComposerModelAuroraThreadIds\.has\(threadId\)\) return ""/);
  assert.match(composerRenderer, /renderComposerModelAurora\(thread\.id\)/);

  const modelSelection = sourceBlock(
    renderer,
    "function selectChatModelForThread",
    "function isThreadModelSelectionLocked",
  );
  assert.match(
    modelSelection,
    /isQuestionAnswerThreadId\(id\)[\s\S]*!authenticatedProviderAvailable\(selectedProvider\)[\s\S]*return false/,
  );
  assert.match(modelSelection, /const modelChanged =\s*selectedChatModelValue\(id\)/);
  assert.match(modelSelection, /if \(modelChanged\) dismissedComposerModelAuroraThreadIds\.delete\(id\)/);

  const scrollBinding = sourceBlock(
    renderer,
    "function bindMessageScrollerEvents",
    "function currentMessageScrollState",
  );
  assert.match(
    scrollBinding,
    /if \(performance\.now\(\) < suppressScrollDetectionUntil\) return;[\s\S]*dismissComposerModelAuroraAfterScroll\(scroller\.dataset\.threadId \|\| state\.currentThreadId\)/,
  );

  for (const provider of ["claude", "codex", "kimi", "deepseek", "gemini", "grok", "mimo", "perplexity", "doubao", "qwen"]) {
    assert.match(styles, new RegExp(`\\.composer-model-aurora\\[data-model-brand="${provider}"\\]`));
  }
  assert.match(
    styles,
    /\.composer-model-aurora\[data-model-brand="gemini"\][\s\S]*?--model-glow-a: 66 133 244;[\s\S]*?--model-glow-b: 155 114 203;[\s\S]*?--model-glow-c: 217 101 112;[\s\S]*?--model-glow-d: 246 194 92;/,
  );
  assert.match(
    styles,
    /\.composer-model-aurora img\s*\{[^}]*opacity: 0\.33;[^}]*drop-shadow[^}]*mask-image: radial-gradient/s,
  );
  assert.match(
    styles,
    /\.composer-model-aurora::before\s*\{[^}]*right: 15%;[^}]*bottom: -19px;[^}]*left: 15%;[^}]*height: 38px;[^}]*rgb\(var\(--model-glow-c\) \/ 0\.36\) 50%[^}]*rgb\(var\(--model-glow-b\) \/ 0\.28\) 60%[^}]*clip-path: inset\(0 0 50% 0\);[^}]*mask-image: radial-gradient\(circle 34px at 50% 0, transparent 0 21px,[^}]*opacity: 0\.56;/s,
  );
  assert.doesNotMatch(styles, /\.composer-model-aurora::after\s*\{/);
  assert.match(styles, /\.composer-model-aurora\s*\{[^}]*opacity: 0\.208;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-model-aurora\s*\{[^}]*opacity: 0\.272;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-model-aurora img\s*\{[^}]*opacity: 0\.45;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.composer-model-aurora,/s);
});

test("existing execution threads allow GPT-family switches and lock DeepSeek", async () => {
  const renderer = await rendererSource;
  const styles = await stylesSource;
  const modelState = sourceBlock(
    renderer,
    "function normalizeThreadModelSettings",
    "function renderComposerModelPicker",
  );
  assert.match(modelState, /threadModelSettingsByThreadId\[id\]/);
  assert.match(modelState, /threadModelSelectionsByThreadId\[id\]/);
  assert.match(modelState, /function selectedChatModelOption\(threadId:/);
  assert.match(modelState, /const selectedSettings = threadModelSelection\(threadId\)/);
  assert.match(modelState, /const effectiveModel = selectedSettings\?\.model \|\| knownSettings\?\.model/);
  assert.match(modelState, /label: effectiveModel/);
  assert.match(modelState, /function rememberThreadModelSettings/);
  assert.match(modelState, /function rememberThreadModelSelection/);
  assert.match(modelState, /function lockedExecutionModelForThread/);
  assert.match(modelState, /function executionModelFamily/);
  assert.match(modelState, /lockedFamily === "gpt"/);
  assert.match(modelState, /executionModelFamily\(candidate\) === "gpt"/);
  assert.match(modelState, /executionModelOptionAllowedForLockedThread\(threadId, option\)/);
  assert.match(modelState, /!executionModelAllowedForLockedThread\(lockedModel, selection\)/);
  assert.match(modelState, /candidateModel\?\.toLowerCase\(\) === lockedModel\.model\.toLowerCase\(\)/);
  assert.match(modelState, /executionModelProviderId\(candidate\.modelProvider, candidate\.providerId\)/);
  assert.match(modelState, /model: settings\.model/);
  assert.match(modelState, /function isThreadModelSelectionLocked/);
  assert.match(modelState, /submittingComposerThreadIds\.has\(id\)/);
  assert.match(modelState, /isThreadResumeInFlight\(id\)/);
  assert.doesNotMatch(modelState, /pendingThreadModelUpdates/);
  assert.doesNotMatch(modelState, /hasThreadCodexWork\(id\)/);
  assert.match(modelState, /function shouldRememberThreadModelSettingsNotification/);
  assert.match(modelState, /hiddenThreadIds\.has\(id\)/);
  assert.match(modelState, /decideModelSwitchContext/);
  assert.match(modelState, /target-budget-exceeded/);
  assert.match(modelState, /上下文超出 \$\{targetLabel\} 的 \$\{thresholdLabel\} 安全切换线，切换失败/);
  const localSelection = modelState.slice(modelState.indexOf("const currentSettings"));
  assert.ok(
    localSelection.indexOf("decideModelSwitchContext") < localSelection.indexOf("rememberThreadModelSelection(id, desiredSettings)"),
    "downgrade context must be checked before changing the local thread selection",
  );
  const selection = sourceBlock(renderer, "function selectChatModelForThread", "function isThreadModelSelectionLocked");
  assert.match(selection, /rememberThreadModelSelection\(id, desiredSettings\)/);
  assert.match(selection, /if \(id && providerFromThreadId\(id\)\)/);
  assert.match(selection, /!executionModelAllowedForLockedThread\(lockedModel, selected\)/);
  assert.match(selection, /当前任务只能使用 GPT 系列模型；如需使用 DeepSeek，请新建任务/);
  assert.match(selection, /当前任务已锁定 \$\{lockedModel\.model\}；如需使用 GPT，请新建任务/);
  assert.doesNotMatch(selection, /api\./);
  assert.doesNotMatch(selection, /updateThreadSettings/);

  const picker = sourceBlock(renderer, "function renderComposerModelPicker", "function renderImageGenerationParameterPickers");
  assert.match(picker, /executionModelFamily\(lockedExecutionModel\) === "deepseek"/);
  assert.match(picker, /composer-model-picker \$\{deepSeekModelLocked \? "locked" : ""\}/);
  assert.match(picker, /当前任务模型已锁定为 \$\{selectedLabel\}/);
  assert.match(picker, /选择 GPT 系列模型/);
  assert.match(picker, /state\.composerModelMenuOpen && !deepSeekModelLocked/);
  assert.match(styles, /\.composer-model-picker\.locked \.chat-title-group-button:disabled\s*\{[^}]*cursor: default;[^}]*opacity: 1;[^}]*color: var\(--text-muted\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-model-picker\.locked \.chat-title-group-button:disabled\s*\{[^}]*background: transparent;[^}]*color: var\(--text-tertiary\);/s);

  const preferences = sourceBlock(renderer, "function loadThreadPreferences", "function loadContactPreferences");
  assert.match(preferences, /threadModels: normalizePersistedThreadModels\(parsed\.threadModels\)/);
  assert.match(preferences, /threadModelSelections: normalizePersistedThreadModels\(parsed\.threadModelSelections\)/);
  assert.match(preferences, /Object\.entries\(threadModelSettingsByThreadId\)/);
  assert.match(preferences, /Object\.entries\(threadModelSelectionsByThreadId\)/);

  const notificationHandler = sourceBlock(renderer, "function handleNotification", "function handleAutomationThreadNotification");
  assert.match(notificationHandler, /case "thread\/settings\/updated"/);
  assert.match(notificationHandler, /shouldRememberThreadModelSettingsNotification\(threadId\)/);
  assert.match(notificationHandler, /message\.params\?\.threadSettings \|\| message\.params\?\.thread_settings/);

  const selectThread = sourceBlock(renderer, "async function selectThread", "function selectAutoTaskThread");
  assert.match(selectThread, /shouldRetryCurrentThreadModelResume/);
  assert.match(selectThread, /!threadModelSettings\(threadId\)/);
  assert.match(selectThread, /&& !shouldRetryCurrentThreadModelResume/);

  const threadParams = sourceBlock(renderer, "function isThreadResumeInFlight", "async function refreshSkills");
  assert.match(threadParams, /resumeThreadWithModelLock/);
  assert.match(threadParams, /!existingThread \? selectedChatModelRequestOptions\(threadId\) : \{\}/);
  assert.doesNotMatch(threadParams, /knownThreadChatModelRequestOptions/);

  const autoTaskReplacement = sourceBlock(renderer, "function replaceAutoTaskThreadId", "function taskFromAutomationNotification");
  assert.match(autoTaskReplacement, /replaceThreadModelSettings\(previousId, nextThreadId\)/);

  const autoTaskDeletion = sourceBlock(renderer, "async function deleteAutoTask", "async function deleteThread");
  assert.match(autoTaskDeletion, /forgetThreadModelSettings\(threadId\)/);

  const pickerBinding = sourceBlock(renderer, 'data-action="toggle-composer-model-menu"', "bindComposerSkillMentionSearchEvents");
  assert.match(pickerBinding, /const threadId = currentComposerThreadId\(\)/);
  assert.match(pickerBinding, /selectComposerModelForThread\(threadId, selected, kind\)/);

  const automaticCompaction = sourceBlock(
    renderer,
    "function requestAutomaticThreadContextCompaction",
    "async function prepareContextBudgetForSend",
  );
  const normalSend = sourceBlock(renderer, "async function sendAgentText", "async function flushQueuedSend");
  assert.match(automaticCompaction, /selectedChatModelRequestOptions\(threadId\)/);
  assert.match(normalSend, /selectedChatModelRequestOptions\(activeThreadId\)/);

  const providerSend = sourceBlock(renderer, "async function sendCurrentProviderMessage", "function applyVideoGenerationBillingSession");
  assert.match(providerSend, /const selectedModel = selectedChatModelValue\(params\.threadId\)/);
  assert.match(providerSend, /const selectedProvider = questionAnswerProviderForModel\(selectedModel\) \|\| params\.provider/);
  assert.match(providerSend, /provider: meta\.apiProvider \|\| selectedProvider/);
  assert.match(providerSend, /model: selectedModel/);
  assert.match(providerSend, /providerMessagesForThread\(params\.threadId, params\.pendingLocalItemId\)/);
  assert.match(
    providerSend,
    /failQuestionAnswerStreamAgentMessage\(\{[\s\S]*?provider:\s*selectedProvider,[\s\S]*?message:\s*errorMessage\(error\)/,
  );
  assert.doesNotMatch(providerSend, /addSystemItem\(params\.threadId, `发送失败/);
});

test("main process automatically selects GPT and DeepSeek effort and fixes the service tier", async () => {
  const main = await mainSource;
  const providerRuntime = sourceBlock(
    main,
    "async function resolveDeepSeekExecutionProviderRuntime",
    "function getExternalModelCredentialStore",
  );
  assert.match(providerRuntime, /await apiClient\.listBusinessModelPools\(\)/);
  assert.match(providerRuntime, /businessModelCredential\([\s\S]*"execution"[\s\S]*"root_execution"[\s\S]*DEEPSEEK_EXECUTION_MODEL[\s\S]*DEEPSEEK_EXECUTION_PROVIDER_ID/);
  assert.match(providerRuntime, /credentialAvailable: Boolean\(credential\?\.apiKey\)/);
  assert.match(main, /providerRuntimeResolver: resolveDeepSeekExecutionProviderRuntime/);
  const threadConfig = sourceBlock(main, "function requestedReasoningEffort", "function isMissingRolloutErrorMessage");
  assert.match(threadConfig, /"max", "ultra"/);
  assert.match(threadConfig, /serviceTier: null/);
  assert.match(
    threadConfig,
    /const requestedProvider = canonicalExecutionModelProvider\(firstString\(/,
  );
  assert.doesNotMatch(threadConfig, /reasoningEffort is required/);
  assert.doesNotMatch(threadConfig, /function requestedServiceTier/);

  const sendMessage = sourceBlock(main, 'ipcMain.handle("codex:sendMessage"', 'ipcMain.handle("codex:steerTurn"');
  assert.match(sendMessage, /const executionSelection = executionProviderSelection\(params\)/);
  assert.match(sendMessage, /adaptiveReasoningEffortForTask\(\{/);
  assert.match(sendMessage, /model: executionSelection\.model \|\| params\.model/);
  assert.doesNotMatch(sendMessage, /requestedEffort:/);
  assert.match(sendMessage, /supportedReasoningEfforts:/);
  assert.match(sendMessage, /effort: turnReasoningEffort/);
  assert.match(sendMessage, /\[HAOLO_REASONING_SUPPORT_FIELD\]:/);
  assert.match(sendMessage, /model: executionSelection\.model \|\| undefined/);
  assert.match(sendMessage, /only accepts text input/);
  assert.match(sendMessage, /ensureDeepSeekThreadHistoryIsTextOnly\(serverClient, threadId\)/);
  assert.match(sendMessage, /serviceTier: null/);
  assert.match(sendMessage, /acquireSerializedThreadSettingsOperation\(originalThreadId\)/);
  assert.doesNotMatch(sendMessage, /thread\/fork|resumeOrForkThreadForExecutionProvider/);
  assert.match(main, /withAdaptiveTurnReasoning\(method, params\)/);
  assert.match(main, /withFixedDefaultServiceTier\(method, adaptiveParams\)/);
  assert.match(main, /function withThreadRuntimeSettings\(result, settings = threadSettingsFromResumeResult\(result\)\)/);
  assert.match(main, /withThreadRuntimeSettings\(await requestThreadStart\(serverClient/);
  assert.match(main, /withThreadRuntimeSettings\(await requestAppServer\(serverClient, "thread\/resume"/);
  const providerSwitch = sourceBlock(
    main,
    "async function resumeThreadForRequestedProvider",
    "function withThreadRuntimeSettings",
  );
  const deepSeekHistoryGate = sourceBlock(
    main,
    "async function ensureDeepSeekThreadHistoryIsTextOnly",
    "async function resumeThreadForRequestedProvider",
  );
  assert.match(providerSwitch, /threadModelProviderFromResumeResult\(result\) === targetProvider/);
  assert.match(providerSwitch, /targetProvider === DEEPSEEK_EXECUTION_PROVIDER_ID/);
  assert.match(providerSwitch, /ensureDeepSeekThreadHistoryIsTextOnly\(serverClient, threadId\)/);
  assert.match(deepSeekHistoryGate, /threadHistoryContainsImageContent\(threadResult\?\.thread\)/);
  assert.match(deepSeekHistoryGate, /history contains images/);
  const missingRolloutGate = sourceBlock(
    main,
    "function isMissingRolloutErrorMessage",
    "function windowState",
  );
  assert.match(missingRolloutGate, /no rollout found for thread id/);
  assert.match(missingRolloutGate, /not materialized yet/);
  assert.match(
    missingRolloutGate,
    /includeturns is unavailable before first user message/,
  );
  const isMissingRolloutErrorMessage = Function(
    `${missingRolloutGate}\nreturn isMissingRolloutErrorMessage;`,
  )();
  assert.equal(
    isMissingRolloutErrorMessage(
      "thread 019fd138-6093-7810-83f5-aca08b6add05 is not materialized yet; includeTurns is unavailable before first user message",
    ),
    true,
  );
  assert.equal(
    isMissingRolloutErrorMessage(
      "thread 019fd138-6093-7810-83f5-aca08b6add05 is not materialized yet for another reason",
    ),
    false,
  );
  assert.match(providerSwitch, /"thread\/resume"/);
  assert.match(providerSwitch, /modelProvider: targetProvider/);
  assert.match(providerSwitch, /Thread provider switch was not applied/);
  const resumeThread = sourceBlock(main, 'ipcMain.handle("codex:resumeThread"', 'ipcMain.handle("codex:updateThreadSettings"');
  assert.match(resumeThread, /runSerializedThreadSettingsOperation\(threadId, async \(\) =>/);
  assert.match(resumeThread, /delete resumeConfiguration\.model/);
  assert.match(resumeThread, /delete resumeConfiguration\.effort/);
  const archiveThread = sourceBlock(main, 'ipcMain.handle("codex:archiveThread"', 'ipcMain.handle("codex:sendMessage"');
  assert.match(archiveThread, /runSerializedThreadSettingsOperation\(threadId, async \(\) =>/);
});

test("renderer migrates legacy persisted codex execution preferences", async () => {
  const renderer = await rendererSource;
  const providerNormalizer = sourceBlock(
    renderer,
    "function executionModelProviderId",
    "function storedExecutionPoolDefaultIdentity",
  );
  const hydration = sourceBlock(
    renderer,
    "function hydrateSelectedChatModel",
    "function normalizeSavedChatModelPreference",
  );

  assert.match(providerNormalizer, /canonicalExecutionModelProvider\(/);
  assert.match(
    hydration,
    /state\.settings\.modelProvider = executionModelProviderId\([\s\S]*rawProviderPreference/,
  );
  assert.match(
    hydration,
    /localStorage\.setItem\([\s\S]*CHAT_MODEL_PROVIDER_STORAGE_KEY,[\s\S]*state\.settings\.modelProvider/,
  );
});

test("provider errors hide IPC implementation names and localize upstream rate limits", async () => {
  const renderer = await rendererSource;
  const formatterStart = renderer.indexOf("function cleanIpcError");
  assert.notEqual(formatterStart, -1);
  const formatter = renderer.slice(formatterStart);

  assert.match(formatter, /replace\(\/\^YouleHttpError:/);
  assert.match(formatter, /Upstream rate limit exceeded/);
  assert.match(formatter, /模型上游当前限流，请稍后重试/);
});

test("GPT-5.5 High is the runtime fallback default", async () => {
  const appServerClient = await appServerClientSource;
  assert.match(appServerClient, /const DEFAULT_MODEL = "gpt-5\.5"/);
  assert.doesNotMatch(appServerClient, /const DEFAULT_MODEL = "gpt-5\.6"/);
});
