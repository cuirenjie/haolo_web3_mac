import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("plan mode switches from the login-cached provider catalog", async () => {
  const source = await rendererSource;
  const switchBlock = sourceBlock(
    source,
    "async function switchNewThreadMode",
    "async function switchComposerClusterMode",
  );

  assert.doesNotMatch(
    switchBlock,
    /refreshProviderModelCatalog|preloadAuthenticatedModelCatalogs/,
    "mode switching must only read the model cache prepared during login",
  );
  assert.match(
    switchBlock,
    /defaultProviderModelSelection\(state\.providerModelCatalog\)[\s\S]*openProviderQuestionDraft\([\s\S]*?\{ renderAfter: false \},[\s\S]*?\)[\s\S]*?applyCachedQuestionAnswerDefaultToDraft\(targetThreadId\)/,
  );
  assert.match(switchBlock, /const nextUsesProviderDraft = mode === "question-answer"/);
  assert.doesNotMatch(
    switchBlock,
    /nextUsesProviderDraft[\s\S]*selectedChatModelRequestOptions\(sourceThreadId\)/,
    "plan mode must open its own provider draft instead of copying the DeepSeek execution selection",
  );
});

test("the cached plan-mode default is applied only to an untouched draft", async () => {
  const source = await rendererSource;
  const helperBlock = sourceBlock(
    source,
    "function applyQuestionAnswerDefaultModelToDraft",
    "async function switchNewThreadMode",
  );

  assert.match(helperBlock, /providerDraftThreadIds\.has\(threadId\)/);
  assert.match(helperBlock, /threadModelSelection\(threadId\)/);
  assert.match(helperBlock, /defaultProviderModelSelection\(state\.providerModelCatalog\)/);
  assert.match(helperBlock, /function applyCachedQuestionAnswerDefaultToDraft/);
  assert.doesNotMatch(helperBlock, /refreshProviderModelCatalog/);
  assert.match(helperBlock, /scheduleProtectedRender\(\)/);
  assert.doesNotMatch(helperBlock, /\brender\(\)/);
});

test("background model discovery never performs an immediate full render", async () => {
  const source = await rendererSource;
  const blocks = [
    sourceBlock(
      source,
      "async function refreshBusinessModelPools",
      "function resetImageGenerationModelCatalogState",
    ),
    sourceBlock(
      source,
      "async function refreshImageGenerationModelCatalog",
      "async function preloadMediaCreationModelCatalogs",
    ),
    sourceBlock(
      source,
      "async function refreshProviderModelCatalog",
      "function applyProviderModelCatalogFailure",
    ),
    sourceBlock(
      source,
      "async function loadVideoExpertModels",
      "function openCachedVideoExpertMenu",
    ),
  ];

  for (const block of blocks) {
    assert.match(block, /scheduleProtectedRender\(\)/);
    assert.doesNotMatch(block, /\brender\(\)/);
  }
});

test("full renders are deferred while a mode-menu pointer target is pressed", async () => {
  const source = await rendererSource;
  const pointerBlock = sourceBlock(
    source,
    "function wirePointerTracking",
    "function wireComposerFileDrop",
  );
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const bindingBlock = sourceBlock(
    source,
    ".querySelector<HTMLButtonElement>('[data-action=\"toggle-composer-mode-menu\"]')",
    "bindComposerSkillMentionSearchEvents(root)",
  );

  assert.match(pointerBlock, /event\.target\.closest\("\.composer-mode-picker"\)/);
  assert.match(pointerBlock, /composerModePointerActive = true/);
  assert.match(pointerBlock, /finishComposerModePointerInteraction/);
  assert.match(
    renderBlock,
    /if \(composerModePointerActive\) \{\s*composerModePointerRenderPending = true;\s*return;/,
  );
  assert.ok(
    bindingBlock.match(/finishComposerModePointerInteraction\(false\)/g)?.length >= 3,
    "every mode-menu click path must release the pointer guard before its own render",
  );
});
