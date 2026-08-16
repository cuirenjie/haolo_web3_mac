import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const taskAnchorSource = readFile(new URL("../src/renderer/task-anchor.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("website task anchors retain the pre-WebGuide classification and color", async () => {
  const [source, anchors] = await Promise.all([rendererSource, taskAnchorSource]);
  const hints = sourceBlock(anchors, "TASK_ANCHOR_DELIVERABLE_HINTS", "TASK_ANCHOR_TOPIC_HINTS");
  const hintMatch = hints.match(/\[\/([^/]+)\/u,\s*"网站"\]/);
  assert.ok(hintMatch, "missing explicit website task anchor rule");
  assert.equal(new RegExp(hintMatch[1], "u").test("帮我做一个网站"), true);

  const colors = sourceBlock(source, "const TASK_ANCHOR_AVATAR_COLOR_RULES", "function taskAnchorAvatarBg");
  const colorMatch = colors.match(/\[\/([^/]+)\/u,\s*"#a68cff"\]/);
  assert.ok(colorMatch, "missing website task anchor color rule");
  assert.equal(new RegExp(colorMatch[1], "u").test("网站"), true);
});

test("provider previews stay local and never enter Codex history hydration", async () => {
  const source = await rendererSource;
  const eligibility = sourceBlock(
    source,
    "function shouldHydrateAssistantPreview",
    "function shouldHydrateAttachmentOnlyTitle",
  );
  assert.match(
    eligibility,
    /function shouldHydrateAssistantPreview\(thread: ConversationSummary\) \{\s*if \(isProviderThread\(thread\)\) return false;/,
  );

  const previewPolicy = sourceBlock(
    source,
    "function usesAssistantThreadPreview",
    "function isAssistantPreviewThreadId",
  );
  assert.match(previewPolicy, /thread\.kind === "main_session" \|\| isProviderThread\(thread\)/);
});

test("new-thread welcome stays focused and WebGuide scaffolding remains removed", async () => {
  const source = await rendererSource;
  assert.equal(
    source.match(/shouldRenderBlankThreadHero\(thread(?:\.id|Id)\)/g)?.length,
    3,
  );
  assert.equal(source.match(/renderBlankThreadHero\(thread(?:\.id|Id)\)/g)?.length, 3);
  assert.doesNotMatch(source, /shouldShowPromptSuggestions|promptCategoriesForThread|promptCategoryForThread/);

  const blankThreadHero = sourceBlock(source, "function renderBlankThreadHero", "function renderMessage");
  assert.match(blankThreadHero, /我们要做些什么？/);
  assert.match(blankThreadHero, /我们要在&nbsp;/);
  assert.match(blankThreadHero, /class="new-thread-hero-group"/);
  assert.match(blankThreadHero, /&nbsp;做些什么？/);
  assert.doesNotMatch(blankThreadHero, /data-new-thread-mode|模式选项|媒体创作/);
  assert.equal(blankThreadHero.match(/data-action=/g)?.length, 1);
  assert.match(blankThreadHero, /data-action="toggle-new-thread-group-picker"/);

  const composerModePicker = sourceBlock(source, "function renderComposerModePicker", "function activeComposerDraftSnapshot");
  assert.match(composerModePicker, /class="composer-mode-trigger serial-only"/);
  assert.match(composerModePicker, /role="status"/);
  assert.match(composerModePicker, /<span>执行模式<\/span>/);
  assert.doesNotMatch(composerModePicker, /<span>问答模式<\/span>/);
  assert.doesNotMatch(composerModePicker, /<span>计划模式<\/span>/);
  assert.doesNotMatch(composerModePicker, /<span>集群模式<\/span>/);
  assert.doesNotMatch(composerModePicker, /<span>媒体创作<\/span>/);
  assert.doesNotMatch(composerModePicker, /data-new-thread-mode|data-composer-cluster-mode/);
  assert.doesNotMatch(
    composerModePicker,
    /data-composer-mode-cascade|composer-mode-submenu|composer-mode-menu-chevron/,
  );

  const composerModeIcon = sourceBlock(source, "function renderComposerModeIcon", "function composerModeLabel");
  assert.match(composerModeIcon, /<rect x="4\.5" y="3\.5" width="15" height="17" rx="2\.5" \/>/);
  assert.match(composerModeIcon, /m7\.5 9\.5 1\.4 1\.4 2\.4-2\.6/);
  assert.doesNotMatch(composerModeIcon, /M5\.2 18\.1 3\.6 21/);
  assert.match(composerModeIcon, /<rect x="3\.5" y="3\.5" width="17" height="17" rx="4" \/>/);
  assert.match(composerModeIcon, /<path d="m10 8 6 4-6 4Z" fill="currentColor" stroke="none" \/>/);
  assert.doesNotMatch(composerModeIcon, /M5 19 19 5/);
  assert.doesNotMatch(composerModeIcon, /M4 9h16v9/);
  assert.doesNotMatch(composerModeIcon, /<rect x="4" y="6" width="16" height="14" rx="3" \/>/);
  assert.doesNotMatch(composerModeIcon, /<circle cx="9" cy="9\.5" r="1\.5" \/>/);

  const scrollState = sourceBlock(source, "type AgentPanelScrollState", "type FormFieldFocusSnapshot");
  assert.doesNotMatch(scrollState, /kind:/);
  const workflowScroll = sourceBlock(source, "function currentWorkflowScrollState", "function restoreWorkflowScrollTop");
  assert.doesNotMatch(workflowScroll, /kind:/);

  const transientUi = sourceBlock(source, "function hasOpenTransientUi", "function isPointerOverStreamSensitiveUi");
  assert.doesNotMatch(transientUi, /\|\|\s*false/);
});

test("WebGuide implementation identifiers remain absent across desktop layers", async () => {
  const sources = await Promise.all([
    rendererSource,
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/youle-api-client.mjs", import.meta.url), "utf8"),
  ]);
  const combined = sources.join("\n");
  const removedIdentifiers = [
    "网页指引",
    "DECLARATION_EXPERT",
    "declarationWorkflow",
    "declaration-expert",
    "declaration-browser",
    "declaration-guide",
    "haolo_declaration",
    "profileMenuOverlay",
    "side-conversation",
    "surface-browser",
  ];
  for (const identifier of removedIdentifiers) {
    assert.equal(combined.includes(identifier), false, `unexpected WebGuide residue: ${identifier}`);
  }
});
