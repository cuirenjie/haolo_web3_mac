import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("results library exposes installed skills and plugins as counted categories", async () => {
  const source = await rendererSource;
  const results = sourceBlock(
    source,
    "function currentInstalledPluginItems",
    "function renderMaterialsPage",
  );

  assert.match(source, /type ResultLibraryCategory = LibraryCategory \| "skill" \| "plugin";/);
  assert.match(
    results,
    /renderCategoryButton\("skill", "技能", mySkillsPlazaCards\(\)\.length, "result"\)/,
  );
  assert.match(
    results,
    /renderCategoryButton\("plugin", "插件", currentInstalledPluginItems\(\)\.length, "result"\)/,
  );
  assert.match(results, /state\.plugins\.items\.filter\(\(item\) => item\.installed\)/);
  assert.match(results, /state\.resultsCategory === "skill" \? renderResultsSkillsPane\(\) : renderResultsPluginsPane\(\)/);
});

test("the results search field filters both embedded original interfaces without a second search box", async () => {
  const source = await rendererSource;
  const results = sourceBlock(
    source,
    "function currentInstalledPluginItems",
    "function renderMaterialsPage",
  );

  assert.equal(
    (results.match(/const query = state\.resultsSearch\.trim\(\)\.toLowerCase\(\);/g) || []).length,
    2,
  );
  assert.match(results, /cards\.map\(renderMySkillPlazaCard\)/);
  assert.match(results, /items\.map\(renderPluginMarketplaceRow\)/);
  assert.match(results, /id="resultsSearch"/);
  assert.doesNotMatch(results, /id="skillsSearch"|class="skills-plaza-search"/);
});

test("installed-tool categories refresh their counts and content without the removed vertical nav", async () => {
  const source = await rendererSource;
  const bindings = sourceBlock(source, "function bindEvents", "function openChannelDialog");

  assert.doesNotMatch(bindings, /button\.dataset\.nav|if \(view === "results"\)/);
  assert.match(
    bindings,
    /category === "skill"[\s\S]*?refreshSkills\(\{ forceReload: true, reason: "results-library" \}\);[\s\S]*?category === "plugin"[\s\S]*?loadLocalPlugins\(\{ force: true \}\);/,
  );
});

test("embedded skill and plugin panes share the library layout in both themes", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.library-integrated-scroll\s*\{[^}]*height:\s*calc\(100% - 46px\);[^}]*overflow-y:\s*auto;[^}]*background:\s*var\(--surface-primary\);[^}]*padding:\s*20px 24px 32px;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.library-nav-pane,[\s\S]*?html\[data-theme="dark"\] \.library-integrated-scroll,[\s\S]*?\{[^}]*background:\s*#151618;/s,
  );
});
