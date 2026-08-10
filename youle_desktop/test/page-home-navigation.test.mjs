import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("every standalone top-level page renders the shared return button", async () => {
  const renderer = await rendererSource;
  const viewIds = sourceBlock(renderer, "type ViewId =", "type SkillCategoryId");
  const standaloneViews = [
    "contacts",
    "results",
    "materials",
    "autoTasks",
    "skillsPlaza",
    "recharge",
    "consumption",
  ];
  for (const view of standaloneViews) assert.match(viewIds, new RegExp(`\\| "${view}"`));

  const topLevelRenderers = [
    ["contacts", "function renderContactsPage", "function groupChatSelectableProfiles"],
    ["results", "function renderResultsNavigation", "function renderResultsSkillsPane"],
    ["materials", "function renderMaterialsPage", "function renderAutoTasksPage"],
    ["auto tasks", "function renderAutoTasksPage", "function renderAutoTaskItem"],
    ["skills and plugins", "function renderSkillsPlazaHeader", "function renderPluginMarketplacePage"],
    ["recharge", "function renderRechargePage", "function consumptionPayload"],
    ["consumption", "function renderConsumptionPage", "function renderConsumptionCalendar"],
  ];
  for (const [name, start, end] of topLevelRenderers) {
    const block = sourceBlock(renderer, start, end);
    assert.match(block, /renderPageHomeButton\(\)/, `${name} is missing the shared return button`);
  }

  const button = sourceBlock(renderer, "function renderPageHomeButton", "function renderContactsPage");
  assert.match(button, /data-action="return-home"/);
  assert.match(button, /aria-label="返回主页"/);
  assert.match(button, /<span>返回<\/span>/);
  assert.doesNotMatch(button, /<span>返回主页<\/span>/);
  assert.doesNotMatch(renderer, /back-auto-tasks-to-chat/);
});

test("the shared return button restores the chat home and has complete theme states", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const navigation = sourceBlock(renderer, "function returnToHomePage", "function threadGroupById");
  assert.match(navigation, /state\.activeView = "chat"/);
  assert.match(navigation, /restoreRememberedChatThreadSelection\(\)/);
  assert.match(navigation, /ensureTopLevelBlankThreadForList\(\{ activateIfMissingSelection: true \}\)/);
  assert.match(navigation, /render\(\)/);
  assert.match(
    renderer,
    /querySelectorAll<HTMLButtonElement>\('\[data-action="return-home"\]'\)[\s\S]*?addEventListener\("click", returnToHomePage\)/,
  );

  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  for (const token of [
    "--page-home-button-bg",
    "--page-home-button-bg-hover",
    "--page-home-button-bg-active",
    "--page-home-button-border",
    "--page-home-button-text",
    "--page-home-button-focus",
    "--page-home-button-shadow",
  ]) {
    assert.match(lightTokens, new RegExp(`${token}:`), `light theme is missing ${token}`);
    assert.match(darkTokens, new RegExp(`${token}:`), `dark theme is missing ${token}`);
  }
  assert.match(styles, /\.page-home-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.page-home-button:active:not\(:disabled\)/);
  assert.match(styles, /\.page-home-button:focus-visible/);
  assert.match(styles, /\.page-home-button:disabled/);
});
