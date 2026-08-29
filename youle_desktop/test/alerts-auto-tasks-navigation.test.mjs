import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const domainSource = readFile(new URL("../src/renderer/domain.ts", import.meta.url), "utf8");
const autoTaskChatIconSource = readFile(new URL("../src/renderer/assets/home/icon-auto-task-chat.svg", import.meta.url), "utf8");
const autoTaskCardIconSource = readFile(new URL("../src/renderer/assets/home/icon-auto-task-card.svg", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the plan entry opens the saved-plan workspace without coupling it to automatic tasks", async () => {
  const source = await rendererSource;
  const renderBlock = sourceBlock(source, "function render()", "function scheduleRender");
  const actionsBlock = sourceBlock(
    source,
    "function renderConversationListActions",
    "function renderConversationListFooter",
  );
  const eventBlock = sourceBlock(source, "function bindEvents()", "function bindLoginEvents()");
  const openPlansBlock = sourceBlock(source, "function openExecutionPlansPage", "function openTradingAlertsPage");
  const autoTasksBlock = sourceBlock(source, "function renderAutoTasksPage", "function renderAutoTaskItem");

  assert.match(
    renderBlock,
    /state\.activeView === "plans"[\s\S]*renderChatList\(\)[\s\S]*renderExecutionPlansPage\(\)/,
  );
  assert.match(
    actionsBlock,
    /const planningActive = state\.activeView === "plans" \|\| state\.activeView === "alerts";[\s\S]*data-conversation-static-action="plans"[\s\S]*aria-current="page"/,
  );
  assert.match(
    eventBlock,
    /\[data-conversation-static-action="plans"\][\s\S]*openExecutionPlansPage\(\)/,
  );
  assert.match(openPlansBlock, /state\.activeView = "plans";/);
  assert.doesNotMatch(openPlansBlock, /refreshAutoTasks/);
  assert.match(source, /function renderExecutionPlansPage\(\)[\s\S]*renderPlanningNavigation\("plans"\)/);
  assert.doesNotMatch(autoTasksBlock, /renderPlanningNavigation|execution-plan|当前没有计划/);
});

test("the alerts selection and sidebar controls share light and dark theme states", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const workspaceRender = sourceBlock(
    source,
    "function render()",
    "const renderedThreadId =",
  );
  const toggleBlock = sourceBlock(
    source,
    "function toggleLeftPanelCollapsed",
    "function renderMaximizeIcon",
  );

  assert.match(workspaceRender, /state\.activeView === "chat" \|\|\s*state\.activeView === "account" \|\|\s*state\.activeView === "plans" \|\|\s*state\.activeView === "autoTasks" \|\|\s*state\.activeView === "alerts" \|\|\s*state\.activeView === "skillsPlaza"/);
  assert.match(toggleBlock, /state\.activeView !== "chat" && state\.activeView !== "account" && state\.activeView !== "plans" && state\.activeView !== "autoTasks" && state\.activeView !== "alerts" && state\.activeView !== "skillsPlaza"/);
  assert.match(styles, /--conversation-action-hover:\s*rgba\(17, 24, 39, 0\.035\);/);
  assert.match(
    styles,
    /html\[data-theme="dark"\][\s\S]*--conversation-action-hover:\s*rgba\(255, 255, 255, 0\.045\);/,
  );
  assert.match(
    styles,
    /\.conversation-list-action\.active,[\s\S]*\.conversation-list-action:active\s*\{[^}]*background:\s*var\(--conversation-action-hover\);/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.auto-task-page[\s\S]*background:\s*#131416;/,
  );
});

test("the populated auto-task list starts directly with its cards", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const pageBlock = sourceBlock(source, "function renderAutoTasksPage", "function renderAutoTaskItem");

  assert.doesNotMatch(pageBlock, /simple-page-header|renderPageHomeButton|simple-page-fold/);
  assert.doesNotMatch(pageBlock, /auto-task-search-button|auto-task-filter-button|全部项/);
  assert.doesNotMatch(pageBlock, /请保持电脑开机|auto-task-toolbar-actions/);
  assert.match(pageBlock, /tasks\.length[\s\S]*class="auto-task-list"/);
  assert.doesNotMatch(pageBlock, /auto-task-list-toolbar|class="auto-task-primary"[\s\S]*新建自动任务[\s\S]*class="auto-task-list"/);
  assert.doesNotMatch(styles, /\.auto-task-search-button|\.auto-task-filter-button/);
  assert.doesNotMatch(styles, /\.auto-task-toolbar-actions|\.auto-task-list-toolbar p|\.auto-task-hero p/);
  assert.doesNotMatch(styles, /\.auto-task-list-toolbar/);
  assert.match(styles, /\.auto-task-list-page\s*\{[^}]*padding:\s*4px 34px 40px;/s);
  assert.match(
    styles,
    /\.planning-primary-tabs,[\s\S]*?\{[^}]*width:\s*min\(1180px, calc\(100% - 68px\)\);/s,
  );
});

test("auto-task cards omit their divider and schedule time while retaining right-side actions", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const itemBlock = sourceBlock(source, "function renderAutoTaskItem", "function renderAutoTaskDetailPage");

  assert.doesNotMatch(itemBlock, /auto-task-card-time|autoTaskCardTime/);
  assert.match(itemBlock, /<footer>\s*<div class="auto-task-item-actions/);
  assert.doesNotMatch(source, /function autoTaskCardTime/);
  assert.doesNotMatch(styles, /\.auto-task-card-time/);
  assert.match(
    styles,
    /\.auto-task-item footer\s*\{[^}]*justify-content:\s*flex-end;[^}]*margin-top:\s*auto;[^}]*padding:\s*12px 0;/s,
  );
  const footerRule = styles.match(/\.auto-task-item footer\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(footerRule, /border-top/);
  assert.match(styles, /\.auto-task-item\s*\{[^}]*border:\s*1px solid var\(--card-border-subtle\);[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/s);
});

test("all automatic-task alarm marks use the simplified themed line icon instead of the blue bitmap", async () => {
  const [source, styles, domain, chatIcon, cardIcon] = await Promise.all([
    rendererSource,
    stylesSource,
    domainSource,
    autoTaskChatIconSource,
    autoTaskCardIconSource,
  ]);
  const itemBlock = sourceBlock(source, "function renderAutoTaskItem", "function renderAutoTaskDetailPage");
  const detailBlock = sourceBlock(source, "function renderAutoTaskDetailPage", "function renderAutoTaskDetailMessages");
  const chatCardBlock = sourceBlock(source, "function renderAutoTaskChatCard", "function renderAutoTaskGroupPill");

  assert.match(source, /function renderAutoTaskAlarmIcon\(\)[\s\S]*class="auto-task-card-icon"[\s\S]*<circle cx="12" cy="13" r="6\.5" \/>/);
  assert.match(itemBlock, /renderAutoTaskAlarmIcon\(\)/);
  assert.match(detailBlock, /renderAutoTaskAlarmIcon\(\)/);
  assert.match(chatCardBlock, /renderAutoTaskAlarmIcon\(\)/);
  assert.doesNotMatch(source, /HOME_ICON_URL\.autoTaskCard/);
  assert.doesNotMatch(domain, /autoTask(?:Chat|Card):[^\n]*auto-task-zidong\.png/);
  assert.match(domain, /autoTaskChat:[^\n]*icon-auto-task-chat\.svg/);
  assert.match(domain, /autoTaskCard:[^\n]*icon-auto-task-card\.svg/);
  assert.match(styles, /\.auto-task-card-icon\s*\{[^}]*color:\s*var\(--text-primary\);[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.auto-task-thread-avatar img\s*\{[^}]*filter:\s*invert\(1\);/s);
  for (const icon of [chatIcon, cardIcon]) {
    assert.match(icon, /fill="none"/);
    assert.match(icon, /<circle cx="12" cy="13" r="6\.5" stroke="#111827"/);
    assert.match(icon, /stroke-linecap="round" stroke-linejoin="round"/);
    assert.doesNotMatch(icon, /fill="black"|fill="#(?:0088ff|0af|00aaff)"/i);
  }
});
