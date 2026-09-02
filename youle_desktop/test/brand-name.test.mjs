import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.dirname(packageRoot);
const legacyChineseBrand = String.fromCodePoint(0x597d, 0x54af);
const visibleTextExtensions = new Set([".cjs", ".html", ".js", ".json", ".mjs", ".nsh", ".svg", ".ts"]);

async function collectVisibleTextFiles(target) {
  const entries = await readdir(target, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectVisibleTextFiles(entryPath));
    } else if (visibleTextExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

test("general and Windows branding uses HaoLo while macOS keeps its localized package name", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const mainSource = await readFile(path.join(packageRoot, "src", "main", "main.mjs"), "utf8");
  const files = [
    path.join(repositoryRoot, "haolo-ai-recharge.html"),
    ...await collectVisibleTextFiles(path.join(packageRoot, "src")),
    ...await collectVisibleTextFiles(path.join(packageRoot, "extensions")),
    path.join(packageRoot, "resources", "installer.nsh"),
  ];

  assert.equal(packageJson.build.nsis.shortcutName, "HaoLo");
  assert.equal(packageJson.build.mac.extendInfo.CFBundleDisplayName, legacyChineseBrand);
  assert.match(packageJson.build.mac.artifactName, new RegExp(`^${legacyChineseBrand}-`));
  assert.match(mainSource, /const YOULE_DISPLAY_NAME = "HaoLo";/);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(source.includes(legacyChineseBrand), false, `legacy brand remains in ${file}`);
  }
});

test("packaged startup migrates legacy Windows shortcut names", async () => {
  const mainSource = await readFile(path.join(packageRoot, "src", "main", "main.mjs"), "utf8");
  assert.match(mainSource, /function legacyShortcutBaseName\(\)/);
  assert.match(mainSource, /async function migrateLegacyPackagedWindowsShortcuts\(\)/);
  assert.match(mainSource, /await writeAppShortcut\(currentPath\);[\s\S]*fs\.promises\.rm\(legacyPath, \{ force: true \}\)/);
  assert.match(mainSource, /await migrateLegacyPackagedWindowsShortcuts\(\)/);
});
