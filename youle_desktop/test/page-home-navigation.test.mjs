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

test("standalone top-level pages that replace the sidebar render the shared return button", async () => {
  const renderer = await rendererSource;
  const viewIds = sourceBlock(renderer, "type ViewId =", "type SkillCategoryId");
  const standaloneViews = [
    "contacts",
    "results",
    "materials",
    "recharge",
    "consumption",
  ];
  for (const view of standaloneViews) assert.match(viewIds, new RegExp(`\\| "${view}"`));

  const topLevelRenderers = [
    ["contacts", "function renderContactsPage", "function groupChatSelectableProfiles"],
    ["results", "function renderResultsNavigation", "function renderResultsSkillsPane"],
    ["materials", "function renderMaterialsPage", "function renderAutoTasksPage"],
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

test("the skills and plugins page stays beside the conversation sidebar without a return button", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const renderBlock = sourceBlock(renderer, "function render()", "function scheduleRender");
  const tabsBlock = sourceBlock(
    renderer,
    "function renderSkillsPlazaTabs",
    "function renderPluginMarketplacePage",
  );
  const pluginPage = sourceBlock(
    renderer,
    "function renderPluginMarketplacePage",
    "function renderPluginMarketplaceRow",
  );
  const skillsPage = sourceBlock(
    renderer,
    "function renderSkillsPlazaPage",
    "function mySkillsPlazaCards",
  );
  const actionsBlock = sourceBlock(
    renderer,
    "function renderConversationListActions",
    "function renderConversationListFooter",
  );

  assert.match(
    renderBlock,
    /state\.activeView === "skillsPlaza"[\s\S]*renderChatList\(\)[\s\S]*renderSkillsPlazaPage\(\)/,
  );
  assert.doesNotMatch(tabsBlock, /renderPageHomeButton\(\)|data-action="return-home"|>返回/);
  assert.doesNotMatch(renderer, /function renderSkillsPlazaHeader/);
  assert.doesNotMatch(pluginPage, /skills-plaza-header|skills-plaza-search|id="skillsSearch"/);
  assert.doesNotMatch(skillsPage, /skills-plaza-header|skills-plaza-search|id="skillsSearch"/);
  assert.match(
    actionsBlock,
    /const skillsActive = state\.activeView === "skillsPlaza";[\s\S]*data-conversation-static-action="skills"[\s\S]*aria-current="page"/,
  );
  assert.match(
    styles,
    /\.conversation-list-action\.active,[\s\S]*background:\s*var\(--conversation-action-hover\);/,
  );
  assert.match(styles, /--conversation-action-hover:\s*rgba\(17, 24, 39, 0\.035\);/);
  assert.match(
    styles,
    /html\[data-theme="dark"\][\s\S]*--conversation-action-hover:\s*rgba\(255, 255, 255, 0\.045\);/,
  );
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

test("the skills and plugins page aligns its content group to the account page's 34px gutter", async () => {
  const styles = await stylesSource;
  const skillsPage = sourceBlock(styles, ".skills-plaza-page {", ".desktop-body > .skills-plaza-page");

  assert.match(skillsPage, /--skills-plaza-content-shift-x:\s*26px;/);
  assert.match(
    skillsPage,
    /padding:\s*0 8px 32px calc\(8px \+ var\(--skills-plaza-content-shift-x\)\);/,
  );
  assert.match(styles, /\.binance-account-toolbar\s*\{[^}]*width:\s*min\(1180px, calc\(100% - 68px\)\);/s);
  assert.doesNotMatch(skillsPage, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test("skills and plugins use the same top and bottom toolbar spacing as the account page", async () => {
  const styles = await stylesSource;
  const tabs = sourceBlock(styles, ".skills-plaza-tabs {", ".plugin-top-toast {");

  assert.match(tabs, /padding:\s*30px 0 8px;/);
  assert.match(styles, /\.binance-account-bound-view\s*\{[^}]*padding:\s*30px 0 0;/s);
  assert.match(styles, /\.binance-account-toolbar\s*\{[^}]*padding:\s*0 0 8px;/s);
  assert.doesNotMatch(tabs, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test("skills keeps a 16px top-left workspace corner when the window is maximized", async () => {
  const styles = await stylesSource;
  assert.match(
    styles,
    /\.window-maximized \.desktop-body > :is\([\s\S]*?\.trading-alerts-page,[\s\S]*?\.skills-plaza-page[\s\S]*?\)\s*\{\s*border-top-left-radius:\s*16px;/s,
  );
  assert.match(
    styles,
    /html\[data-theme\] \.desktop-body:has\(> :is\([\s\S]*?\.trading-alerts-page,[\s\S]*?\.skills-plaza-page[\s\S]*?\)\)\s*\{\s*background:\s*var\(--app-chrome-background\);/s,
  );
});

test("my skills prefers three shorter card columns with responsive fallbacks", async () => {
  const styles = await stylesSource;
  const grid = sourceBlock(styles, ".my-skills-grid {", ".my-skill-card {");

  assert.match(grid, /grid-template-columns:\s*repeat\(3, minmax\(0, 320px\)\);/);
  assert.match(grid, /gap:\s*20px;/);
  assert.match(grid, /padding:\s*16px 0 24px;/);
  assert.match(
    styles,
    /@media \(max-width: 980px\)\s*\{[\s\S]*?\.my-skills-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 320px\)\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 660px\)\s*\{[\s\S]*?\.my-skills-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.doesNotMatch(grid, /#[0-9a-f]{3,8}|rgba?\(/i);
});
