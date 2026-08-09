import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererPath = new URL("../src/renderer/main.ts", import.meta.url);
const stylesPath = new URL("../src/renderer/styles.css", import.meta.url);
const preloadPath = new URL("../src/main/preload.mjs", import.meta.url);
const mainPath = new URL("../src/main/main.mjs", import.meta.url);
const apiClientPath = new URL("../src/main/youle-api-client.mjs", import.meta.url);

test("prompt favorites are wired through authenticated desktop APIs", async () => {
  const [preload, main, client] = await Promise.all([
    readFile(preloadPath, "utf8"),
    readFile(mainPath, "utf8"),
    readFile(apiClientPath, "utf8"),
  ]);

  for (const operation of ["listPromptFavorites", "createPromptFavorite", "updatePromptFavorite", "deletePromptFavorite"]) {
    assert.match(preload, new RegExp(operation));
    assert.match(main, new RegExp(operation));
    assert.match(client, new RegExp(`async ${operation}`));
  }
  assert.match(client, /DEFAULT_PROMPT_FAVORITES_PATH = "\/api\/prompt-favorites"/);
});

test("all three prompt favorite entry points and the @ submenu are rendered", async () => {
  const renderer = await readFile(rendererPath, "utf8");

  assert.match(renderer, /data-action="favorite-message"/);
  assert.match(renderer, /data-context-action="favorite"/);
  assert.match(renderer, /\["favorite", "cut", "copy", "paste", "delete"\]/);
  assert.match(renderer, /\{ id: "favorites", label: "已收藏提示词" \}/);
  assert.match(renderer, /composer-prompt-favorite-root-add" data-add-prompt-favorite>添加<\/span>/);
  const favoritesSubmenu = renderer.slice(
    renderer.indexOf("function renderComposerPromptFavoritesSubmenu"),
    renderer.indexOf("function promptFavoritePreview"),
  );
  assert.doesNotMatch(favoritesSubmenu, /composer-prompt-favorite-add|添加提示词/);
  assert.match(renderer, /data-edit-prompt-favorite/);
  assert.match(favoritesSubmenu, /aria-label="编辑提示词"><span>编辑<\/span><\/button>/);
  assert.doesNotMatch(favoritesSubmenu, /编辑(?:&nbsp;)?&gt;/);
  assert.match(renderer, /confirm-prompt-favorite-delete/);
});

test("saved prompt edit action has no chevron and matches the add action color", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(rendererPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);
  const favoritesSubmenu = renderer.slice(
    renderer.indexOf("function renderComposerPromptFavoritesSubmenu"),
    renderer.indexOf("function promptFavoritePreview"),
  );

  assert.match(favoritesSubmenu, /aria-label="编辑提示词"><span>编辑<\/span><\/button>/);
  assert.doesNotMatch(favoritesSubmenu, /编辑(?:&nbsp;)?&gt;/);
  assert.match(
    styles,
    /\.composer-skill-popover \.composer-prompt-favorite-edit\s*\{[\s\S]*?color: var\(--brand-blue\);/,
  );
  assert.match(
    styles,
    /\.composer-skill-popover \.composer-prompt-favorite-edit:hover\s*\{[\s\S]*?color: var\(--brand-blue\);/,
  );
  assert.match(
    styles,
    /\.composer-skill-popover \.composer-prompt-favorite-edit > span\s*\{[\s\S]*?color: var\(--brand-blue\);[\s\S]*?font-weight: 500;/,
  );
});

test("saved prompt insertion replaces only the active @ trigger", async () => {
  const renderer = await readFile(rendererPath, "utf8");

  assert.match(
    renderer,
    /const nextValue = `\$\{input\.value\.slice\(0, match\.start\)\}\$\{favorite\.content\}\$\{input\.value\.slice\(match\.end\)\}`/,
  );
  assert.match(renderer, /const nextCursor = match\.start \+ favorite\.content\.length/);
});

test("a saved prompt selected from the @ menu remains normal composer text", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(rendererPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);
  const applyFavorite = renderer.slice(
    renderer.indexOf("function applyComposerPromptFavorite("),
    renderer.indexOf("function applyComposerThreadReference("),
  );
  const renderHighlights = renderer.slice(
    renderer.indexOf("function renderComposerMentionHighlights("),
    renderer.indexOf("function composerMentionHighlightTokens("),
  );

  assert.match(applyFavorite, /favorite\.content/);
  assert.doesNotMatch(renderer, /composerPromptFavoriteHighlights|promptFavoriteHighlights/);
  assert.doesNotMatch(renderHighlights, /composerPromptFavoriteHighlightRanges|isFavorite|<strong>/);
  assert.doesNotMatch(styles, /\.composer-highlight strong/);
});

test("a single saved prompt aligns with its root menu row", async () => {
  const [renderer, styles] = await Promise.all([readFile(rendererPath, "utf8"), readFile(stylesPath, "utf8")]);

  assert.match(renderer, /favorites\.items\.length === 1 \? "is-single" : ""/);
  assert.match(renderer, /composer-prompt-favorite-submenu \$\{alignmentClass\}/);
  assert.match(
    styles,
    /\.composer-prompt-favorite-submenu\.is-single\s*\{[\s\S]*?left:\s*calc\(100% \+ 3px\);[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*auto;/,
  );
  assert.match(styles, /\.composer-prompt-favorite-submenu\s*\{[\s\S]*?width:\s*min\(270px, calc\(75vw - 195px\)\)/);
});

test("saved prompt submenu opens without a default active option", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const initialState = renderer.slice(
    renderer.indexOf("composerSkillMention: {"),
    renderer.indexOf("composerThreadReferences: []"),
  );
  const rootBindings = renderer.slice(
    renderer.indexOf('container.querySelectorAll<HTMLButtonElement>("[data-composer-mention-root]")'),
    renderer.indexOf('const detailSearch = container.querySelector<HTMLInputElement>("[data-thread-reference-detail-search]")'),
  );

  assert.match(initialState, /favoriteActiveIndex:\s*-1/);
  assert.match(renderer, /function clampPromptFavoriteActiveIndex[\s\S]*?if \(index < 0 \|\| itemCount <= 0\) return -1;/);
  assert.match(rootBindings, /if \(submenu === "favorites"\) state\.composerSkillMention\.favoriteActiveIndex = -1;/);
  assert.match(renderer, /if \(state\.composerSkillMention\.submenu === "favorites"\) \{\s*state\.composerSkillMention\.favoriteActiveIndex = -1;/);
});

test("saved prompt row hover uses one shared light-blue surface", async () => {
  const [renderer, styles] = await Promise.all([readFile(rendererPath, "utf8"), readFile(stylesPath, "utf8")]);
  const favoriteBindings = renderer.slice(
    renderer.indexOf('container.querySelectorAll<HTMLButtonElement>("[data-prompt-favorite-index]")'),
    renderer.indexOf('container.querySelectorAll<HTMLButtonElement>("[data-edit-prompt-favorite]")'),
  );
  const favoriteStateSync = renderer.slice(
    renderer.indexOf('popover.querySelectorAll<HTMLButtonElement>("[data-prompt-favorite-index]")'),
    renderer.indexOf('popover.querySelector<HTMLButtonElement>("[data-skill-mention-index].active")'),
  );

  assert.match(
    styles,
    /\.composer-prompt-favorite-row\[role="option"\]:is\(:hover, \.active\)\s*\{\s*background: var\(--selection-soft\);/,
  );
  assert.match(
    styles,
    /\.composer-prompt-favorite-row\[role="option"\][\s\S]*?> :is\(\.composer-prompt-favorite-main, \.composer-prompt-favorite-edit\)\s*\{\s*background: transparent;/,
  );
  assert.match(
    styles,
    /\.composer-skill-popover \.composer-prompt-favorite-edit\s*\{[\s\S]*?color: var\(--brand-blue\);/,
  );
  assert.match(
    styles,
    /\.composer-skill-popover \.composer-prompt-favorite-edit:hover\s*\{[\s\S]*?color: var\(--brand-blue\);/,
  );
  assert.doesNotMatch(favoriteBindings, /mouseenter/);
  assert.match(favoriteStateSync, /button\.closest<HTMLElement>\("\.composer-prompt-favorite-row"\)/);
  assert.match(favoriteStateSync, /option\?\.classList\.toggle\("active", active\)/);
});

test("saved prompts preload when the @ menu opens without rendering a loading panel", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const syncMention = renderer.slice(
    renderer.indexOf("function syncComposerSkillMentionPopover"),
    renderer.indexOf("function updateComposerSkillMentionPopover"),
  );
  const rootBindings = renderer.slice(
    renderer.indexOf('container.querySelectorAll<HTMLButtonElement>("[data-composer-mention-root]")'),
    renderer.indexOf('const detailSearch = container.querySelector<HTMLInputElement>("[data-thread-reference-detail-search]")'),
  );
  const favoritesSubmenu = renderer.slice(
    renderer.indexOf("function renderComposerPromptFavoritesSubmenu"),
    renderer.indexOf("function promptFavoritePreview"),
  );

  assert.match(syncMention, /if \(shouldOpen && !wasOpen\) void loadPromptFavorites\(\{ force: true \}\);/);
  assert.match(rootBindings, /if \(submenu === "favorites"\) void loadPromptFavorites\(\);/);
  assert.doesNotMatch(rootBindings, /loadPromptFavorites\(\{ force: true \}\)/);
  assert.match(renderer, /showPromptFavoritesSubmenu[\s\S]*?state\.promptFavorites\.items\.length > 0/);
  assert.doesNotMatch(favoritesSubmenu, /正在加载/);
});

test("adding or editing a saved prompt preserves and refreshes the @ cascade", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const outsideDismissal = renderer.slice(
    renderer.indexOf("function wireComposerSkillMentionPopoverDismissal"),
    renderer.indexOf("function wireThreadHistoryPopoverDismissal"),
  );
  const submit = renderer.slice(
    renderer.indexOf("async function submitPromptFavoriteDialog"),
    renderer.indexOf("async function confirmPromptFavoriteDelete"),
  );

  assert.match(outsideDismissal, /\.prompt-favorite-dialog/);
  assert.match(outsideDismissal, /\.prompt-favorite-delete-dialog/);
  assert.match(outsideDismissal, /\.prompt-favorite-backdrop/);
  assert.match(submit, /if \(item\) upsertPromptFavorite\(item\)/);
  assert.match(submit, /state\.composerSkillMention\.favoriteQuery = ""/);
  assert.match(submit, /else await loadPromptFavorites\(\{ force: true \}\)/);
  assert.doesNotMatch(submit, /dismissComposerSkillMentionPopover\(\)/);
});

test("prompt favorite dialogs stack above workflow node editors", async () => {
  const styles = await readFile(stylesPath, "utf8");
  const workflowDialogZIndex = Number(
    styles.match(/\.workflow-node-dialog\s*\{[\s\S]*?z-index:\s*(\d+);/)?.[1],
  );
  const promptBackdropZIndex = Number(
    styles.match(/\.prompt-favorite-backdrop\s*\{[\s\S]*?z-index:\s*(\d+);/)?.[1],
  );
  const promptDialogZIndex = Number(
    styles.match(/\.prompt-favorite-dialog\s*\{[\s\S]*?z-index:\s*(\d+);/)?.[1],
  );
  const deleteBackdropZIndex = Number(
    styles.match(/\.prompt-favorite-delete-backdrop\s*\{[\s\S]*?z-index:\s*(\d+);/)?.[1],
  );
  const deleteDialogZIndex = Number(
    styles.match(/\.prompt-favorite-delete-dialog\s*\{[\s\S]*?z-index:\s*(\d+);/)?.[1],
  );

  assert.ok(promptBackdropZIndex > workflowDialogZIndex);
  assert.ok(promptDialogZIndex > promptBackdropZIndex);
  assert.ok(deleteBackdropZIndex > promptDialogZIndex);
  assert.ok(deleteDialogZIndex > deleteBackdropZIndex);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.prompt-favorite-dialog textarea:hover/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.prompt-favorite-dialog textarea:focus/,
  );
});
