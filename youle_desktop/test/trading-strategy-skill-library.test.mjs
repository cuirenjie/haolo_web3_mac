import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const catalogSource = readFile(
  new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

const expectedStrategies = [
  ["chan", "缠论"],
  ["order-flow", "订单流"],
  ["wave", "波浪理论"],
  ["wyckoff", "威科夫"],
  ["harmonic", "谐波形态"],
  ["chart-patterns", "图表形态学"],
  ["price-action", "裸K分析"],
  ["dow-theory", "道氏理论"],
  ["gann-theory", "江恩理论"],
];

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the bundled trading strategies expose real Skill metadata", async () => {
  for (const [id, displayName] of expectedStrategies) {
    const root = new URL(`../resources/trading-strategies/builtins/${id}/`, import.meta.url);
    const [manifestSource, skillSource, metadataSource] = await Promise.all([
      readFile(new URL("strategy.json", root), "utf8"),
      readFile(new URL("SKILL.md", root), "utf8"),
      readFile(new URL("agents/openai.yaml", root), "utf8"),
    ]);
    const manifest = JSON.parse(manifestSource);
    assert.equal(manifest.id, id);
    assert.equal(manifest.display.name, displayName);
    assert.equal(manifest.assets.skill, "SKILL.md");
    assert.match(skillSource, new RegExp(`^name:\\s*["']?${id.replace("-", "\\-")}["']?$`, "m"));
    assert.match(skillSource, /^description:\s*\S/m);
    assert.match(metadataSource, new RegExp(`display_name:\\s*["']${displayName}["']`));
    assert.match(metadataSource, /^\s*short_description:\s*["']\S/m);
  }
});

test("My Skills derives installed cards from the trading strategy catalog", async () => {
  const [renderer, catalog] = await Promise.all([rendererSource, catalogSource]);
  const cards = sourceBlock(renderer, "function mySkillsPlazaCards", "function renderMySkillsPage");

  assert.match(catalog, /builtins\/\*\/agents\/openai\.yaml/);
  assert.match(catalog, /query:\s*"\?raw"/);
  assert.match(catalog, /displayName:\s*yamlString\(source, "display_name"\)/);
  assert.match(catalog, /shortDescription:\s*yamlString\(source, "short_description"\)/);
  assert.match(cards, /tradingStrategyCatalog\(\)/);
  assert.match(cards, /strategy\.enabled !== false/);
  assert.match(cards, /id:\s*`\$\{TRADING_STRATEGY_SKILL_CARD_PREFIX\}\$\{strategy\.id\}`/);
  assert.match(cards, /translateAppText\(strategy\.skill\.displayName, state\.settings\.language\)/);
  assert.match(cards, /translateAppText\(strategy\.skill\.shortDescription, state\.settings\.language\)/);
  assert.match(cards, /installStatus:\s*"installed"/);
  assert.match(cards, /return \[\.\.\.localCards, \.\.\.tradingCards\]/);
  assert.match(renderer, /renderCategoryButton\("skill", "技能", mySkillsPlazaCards\(\)\.length, "result"\)/);
});

test("the Strategy tab renders only catalog-backed trading strategy cards", async () => {
  const renderer = await rendererSource;
  const tabs = sourceBlock(renderer, "function renderSkillsPlazaTabs", "function renderPluginMarketplacePage");
  const page = sourceBlock(renderer, "function renderSkillsPlazaPage", "function mySkillsPlazaCards");
  const visibleCards = sourceBlock(renderer, "function strategySkillPlazaCards", "function renderMySkillsPage");

  assert.match(tabs, /\{ id: "mySkills", label: "策略" \}/);
  assert.doesNotMatch(tabs, /label: "我的技能"/);
  assert.match(page, /collectionTab === "mySkills"\s*\? strategySkillPlazaCards\(\)/);
  assert.match(page, /collectionTab === "mySkills"[\s\S]*?\? "暂无策略"/);
  assert.match(visibleCards, /mySkillsPlazaCards\(\)\.filter/);
  assert.match(visibleCards, /card\.id\.startsWith\(TRADING_STRATEGY_SKILL_CARD_PREFIX\)/);
});

test("the Strategy page exposes indicator and quantitative categories while keeping Plugins hidden", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const tabs = sourceBlock(renderer, "function renderSkillsPlazaTabs", "function renderPluginMarketplacePage");
  const page = sourceBlock(renderer, "function renderSkillsPlazaPage", "function mySkillsPlazaCards");
  const bindings = sourceBlock(renderer, 'root.querySelectorAll<HTMLButtonElement>("[data-skills-plaza-tab]")', 'root.querySelectorAll<HTMLButtonElement>("[data-plugin-toggle]")');

  assert.match(renderer, /type SkillsPlazaTab = "plugins" \| "skills" \| "mySkills" \| "indicators" \| "quant"/);
  assert.match(tabs, /\{ id: "mySkills", label: "策略" \}/);
  assert.match(tabs, /\{ id: "indicators", label: "指标" \}/);
  assert.match(tabs, /\{ id: "quant", label: "量化" \}/);
  assert.match(tabs, /\{ id: "plugins", label: "插件", hidden: true \}/);
  assert.match(tabs, /\.filter\(\(tab\) => !tab\.hidden\)/);
  assert.match(page, /collectionTab === "indicators"/);
  assert.match(page, /collectionTab === "indicators"\s*\? indicatorSkillPlazaCards\(\)/);
  assert.match(page, /collectionTab === "quant"/);
  assert.match(page, /"暂无指标"/);
  assert.match(page, /"暂无量化"/);
  assert.match(page, /my-skills-grid.*skills-empty-state/s);
  assert.match(bindings, /tab !== "indicators"/);
  assert.match(bindings, /tab !== "quant"/);
  assert.match(renderer, /function renderPluginMarketplacePage\(\)/);
  assert.match(styles, /\.skills-plaza-tabs button:hover/);
  assert.match(styles, /\.skills-plaza-tabs button:active:not\(:disabled\)/);
  assert.match(styles, /\.skills-plaza-tabs button:focus-visible/);
  assert.match(styles, /\.skills-plaza-tabs button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.skills-plaza-tabs button:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.skills-plaza-tabs button:active:not\(:disabled\)/);
  assert.match(styles, /\.my-skills-grid\.skills-empty-state\s*\{[^}]*align-content:\s*center;[^}]*justify-content:\s*center;[^}]*padding:\s*0 0 10vh;/s);
  assert.match(styles, /\.my-skills-grid\.skills-empty-state \.skills-empty\s*\{[^}]*margin:\s*0;/s);
});

test("the Indicator tab renders Trend Band with the same installed card contract as strategies", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const cards = sourceBlock(renderer, "function indicatorSkillPlazaCards", "function renderMySkillsPage");
  const indicatorIcon = sourceBlock(renderer, "function renderTradingIndicatorSkillIcon", "function renderMySkillPlazaCard");
  const renderCard = sourceBlock(renderer, "function renderMySkillPlazaCard", "function renderSkillPosterMark");

  assert.match(renderer, /const TRADING_TREND_BAND_SKILL_CARD_ID = `\$\{TRADING_INDICATOR_SKILL_CARD_PREFIX\}trend-band`/);
  assert.match(cards, /title:\s*translateAppText\("趋势带", state\.settings\.language\)/);
  assert.match(cards, /detail:\s*translateAppText\([\s\S]*"通过趋势蜡烛与均线带识别行情方向，辅助观察趋势延续与转折"[\s\S]*state\.settings\.language/);
  assert.match(cards, /author:\s*"本地"/);
  assert.match(cards, /installStatus:\s*"installed"/);
  assert.match(indicatorIcon, /data-trading-indicator-icon="trend-band"/);
  assert.match(renderCard, /const libraryIcon = strategyIcon \|\| indicatorIcon/);
  assert.match(renderCard, /libraryIcon \? " trading-strategy-skill-card"/);
  assert.match(renderCard, /libraryIcon \|\|/);
  assert.match(styles, /\.trading-indicator-icon-trend-band\s*\{[^}]*--strategy-icon-background:[^}]*--strategy-icon-foreground:[^}]*--strategy-icon-ring:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-indicator-icon-trend-band\s*\{[^}]*--strategy-icon-background:[^}]*--strategy-icon-foreground:[^}]*--strategy-icon-ring:/s);
});

test("the Trend Band indicator card opens Trading Expert and pre-fills its indicator mention", async () => {
  const renderer = await rendererSource;
  const openIndicator = sourceBlock(renderer, "async function openTradingIndicatorSkillFromLibrary", "function skillForUse");
  const bindings = sourceBlock(renderer, 'root.querySelectorAll<HTMLElement>("[data-skill-id]")', 'root.querySelectorAll<HTMLElement>("[data-skill-tool]")');

  assert.match(openIndicator, /await openTradingExpertWorkspace\(\)/);
  assert.match(openIndicator, /localizedTradingExpertMentionToken\("指标", "趋势带"\)/);
  assert.match(openIndicator, /setComposerDraft\(threadId/);
  assert.match(openIndicator, /applyTradingExpertCustomIndicatorMentions\(composerText\)/);
  assert.match(bindings, /openTradingIndicatorSkillFromLibrary\(skillId\)/);
});

test("trading Skill cards are keyboard accessible and open the matching Trading Expert mention", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const renderCard = sourceBlock(renderer, "function renderMySkillPlazaCard", "function renderSkillPosterMark");
  const openSkill = sourceBlock(renderer, "async function openTradingStrategySkillFromLibrary", "function skillForUse");
  const bindings = sourceBlock(renderer, 'root.querySelectorAll<HTMLElement>("[data-skill-id]")', 'root.querySelectorAll<HTMLElement>("[data-skill-tool]")');

  assert.match(renderCard, /role="button" tabindex="0"/);
  assert.match(openSkill, /await openTradingExpertWorkspace\(\)/);
  assert.match(openSkill, /localizedTradingCatalogMentionToken\(strategy\)/);
  assert.match(openSkill, /setComposerDraft\(threadId/);
  assert.match(bindings, /openTradingStrategySkillFromLibrary\(skillId\)/);
  assert.match(bindings, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(styles, /\.my-skill-card:active\s*\{/);
  assert.match(styles, /\.my-skill-card:focus-visible\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.my-skill-card:focus-visible\s*\{/);
});

test("trading strategy cards render concise strategy icons and clamp descriptions to two lines", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const iconRenderer = sourceBlock(renderer, "function renderTradingStrategySkillIcon", "function renderMySkillPlazaCard");
  const renderCard = sourceBlock(renderer, "function renderMySkillPlazaCard", "function renderSkillPosterMark");

  for (const [strategyId] of expectedStrategies) {
    assert.match(iconRenderer, new RegExp(`(?:["']?${strategyId.replace("-", "\\-")}["']?):\\s*`));
  }
  assert.match(iconRenderer, /data-trading-strategy-icon=/);
  assert.match(iconRenderer, /<svg viewBox="0 0 32 32"/);
  assert.match(renderCard, /trading-strategy-skill-card/);
  assert.match(renderCard, /libraryIcon \|\|/);
  assert.doesNotMatch(renderCard, /my-skill-installed|skillInstallStatusLabel|HOME_ICON_URL\.skillLocal|<small>|card\.author/);
  assert.match(styles, /\.my-skill-card\s*\{[^}]*border:\s*1px solid var\(--card-border-subtle\);/s);
  assert.match(styles, /\.trading-strategy-skill-card \.my-skill-copy p\s*\{[^}]*display:\s*-webkit-box;[^}]*min-height:\s*36px;[^}]*white-space:\s*normal;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;/s);
});

test("trading strategy icon states remain explicit in light and dark themes", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.trading-strategy-icon\s*\{[^}]*--strategy-icon-background:[^}]*--strategy-icon-foreground:[^}]*--strategy-icon-ring:[^}]*--strategy-icon-stroke-width:\s*1\.8;/s);
  assert.match(styles, /\.trading-strategy-icon svg\s*\{[^}]*stroke-width:\s*var\(--strategy-icon-stroke-width\);/s);
  assert.match(styles, /\.my-skill-card:hover \.trading-strategy-icon,[\s\S]*?\.my-skill-card:focus-visible \.trading-strategy-icon\s*\{/);
  assert.match(styles, /\.my-skill-card:active \.trading-strategy-icon\s*\{[^}]*transform:\s*scale\(0\.97\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-strategy-icon\s*\{[^}]*--strategy-icon-background:[^}]*--strategy-icon-foreground:\s*#c4ccff;[^}]*--strategy-icon-ring:[^}]*--strategy-icon-stroke-width:\s*2\.05;/s);
  for (const strategyId of ["order-flow", "wave", "wyckoff", "harmonic", "chart-patterns", "price-action", "dow-theory", "gann-theory"]) {
    assert.match(styles, new RegExp(`html\\[data-theme="dark"\\] \\.trading-strategy-icon-${strategyId}\\s*\\{`));
  }
});

test("dark strategy and indicator cards use the brighter icon foreground palette", async () => {
  const styles = await stylesSource;
  const expectedDarkForegrounds = new Map([
    ["trading-strategy-icon-order-flow", "#91e6d6"],
    ["trading-strategy-icon-ict-smc", "#d8c9ff"],
    ["trading-strategy-icon-smt-divergence", "#a8edfb"],
    ["trading-strategy-icon-wave", "#9bd1ff"],
    ["trading-strategy-icon-wyckoff", "#f7d28d"],
    ["trading-strategy-icon-harmonic", "#e0bdff"],
    ["trading-strategy-icon-chart-patterns", "#a8e2ff"],
    ["trading-strategy-icon-price-action", "#a9e8bb"],
    ["trading-strategy-icon-dow-theory", "#d5c9ff"],
    ["trading-strategy-icon-gann-theory", "#ffd0ad"],
    ["trading-indicator-icon-trend-band", "#91e6d6"],
    ["trading-indicator-icon-moving-average", "#f8da8c"],
    ["trading-indicator-icon-macd", "#d8caff"],
    ["trading-indicator-icon-bollinger-bands", "#bed2ff"],
    ["trading-indicator-icon-rsi", "#dfc4ff"],
    ["trading-indicator-icon-kdj", "#b8e5ff"],
    ["trading-indicator-icon-vpvr", "#bbdcff"],
  ]);

  for (const [className, foreground] of expectedDarkForegrounds) {
    const block = sourceBlock(
      styles,
      `html[data-theme="dark"] .${className} {`,
      "}\n",
    );
    assert.match(block, new RegExp(`--strategy-icon-foreground:\\s*${foreground};`));
  }
});
