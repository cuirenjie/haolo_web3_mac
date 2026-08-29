import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererPath = new URL("../src/renderer/main.ts", import.meta.url);
const stylesPath = new URL("../src/renderer/styles.css", import.meta.url);

test("all second-level mention menus show the shared search field from two options", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(rendererPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(renderer, /const COMPOSER_MENTION_SEARCH_MIN_ITEMS = 2;/);
  assert.match(
    renderer,
    /return itemCount >= COMPOSER_MENTION_SEARCH_MIN_ITEMS;/,
  );
  assert.match(
    renderer,
    /shouldShowComposerMentionSearch\(composerSkillMentionCandidates\(""\)\.length\)/,
  );
  assert.match(
    renderer,
    /shouldShowComposerMentionSearch\(composerThreadMentionCandidates\(""\)\.length\)/,
  );
  assert.match(
    renderer,
    /shouldShowComposerMentionSearch\(state\.promptFavorites\.items\.length\)/,
  );

  for (const selector of [
    "data-skill-mention-search",
    "data-thread-mention-search",
    "data-prompt-favorite-mention-search",
  ]) {
    assert.match(renderer, new RegExp(selector));
  }
  assert.match(styles, /\.composer-skill-search\s*\{/);
});

test("session and saved-prompt search fields filter the options used by selection", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const favoriteCandidates = renderer.slice(
    renderer.indexOf("function composerPromptFavoriteMentionCandidates"),
    renderer.indexOf("function composerThreadMentionCandidates"),
  );
  const threadCandidates = renderer.slice(
    renderer.indexOf("function composerThreadMentionCandidates"),
    renderer.indexOf("function composerThreadReferenceHistoryEntriesFromSnapshot"),
  );
  const favoriteSelection = renderer.slice(
    renderer.indexOf("function applyComposerPromptFavorite"),
    renderer.indexOf("function applyComposerThreadReference"),
  );
  const threadSelection = renderer.slice(
    renderer.indexOf("function applyComposerThreadReference"),
    renderer.indexOf("function applyComposerThreadReferenceSelection"),
  );

  assert.match(favoriteCandidates, /query: string/);
  assert.match(
    favoriteCandidates,
    /normalizeSkillMentionText\(favorite\.content\)\.includes\(normalizedQuery\)/,
  );
  assert.match(threadCandidates, /query = ""/);
  assert.match(
    threadCandidates,
    /\$\{candidate\.name\} \$\{candidate\.groupName\}/,
  );
  assert.match(threadCandidates, /\.includes\(normalizedQuery\)/);
  assert.match(
    renderer,
    /state\.composerSkillMention\.threadQuery = threadSearchInput\.value;/,
  );
  assert.match(
    renderer,
    /state\.composerSkillMention\.favoriteQuery = favoriteSearchInput\.value;/,
  );
  assert.match(threadSelection, /composerThreadMentionCandidates/);
  assert.match(threadSelection, /state\.composerSkillMention\.threadQuery/);
  assert.match(favoriteSelection, /composerPromptFavoriteMentionCandidates/);
  assert.match(favoriteSelection, /state\.composerSkillMention\.favoriteQuery/);
});
