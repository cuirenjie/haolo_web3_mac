import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

test("plugin payloads resolve both canonical and runtime-derived Codex homes", async () => {
  const source = await mainSource;
  assert.match(source, /function installedCodexPluginRootCandidates\(codexHome, plugin\)/);
  assert.match(source, /path\.join\(canonicalHome, "runtime-home", "\.codex"\)/);
  assert.match(source, /installedCodexPluginRootCandidates\(codexHome, plugin\)\.find/);
});

test("plugin toggles roll back every config target when one write fails", async () => {
  const source = await mainSource;
  assert.match(source, /setPluginEnabledInConfigsTransactional\(pluginConfigPaths\(context\.codexHome\), pluginId, enabled\)/);
  assert.match(source, /const snapshots = uniquePaths\(configPaths\)\.map/);
  assert.match(source, /for \(const snapshot of \[\.\.\.snapshots\]\.reverse\(\)\)/);
  assert.match(source, /writeTextFileAtomicSync\(snapshot\.configPath, snapshot\.content\)/);
  assert.match(source, /else fs\.rmSync\(snapshot\.configPath, \{ force: true \}\)/);
});

test("successful plugin deletion invalidates and refreshes workspace skills", async () => {
  const source = await mainSource;
  const start = source.indexOf("async function deleteLocalPlugin");
  const end = source.indexOf("function pluginConfigPaths", start);
  const handler = source.slice(start, end);
  assert.match(handler, /const result = await removeInstalledCodexPlugin/);
  assert.match(handler, /invalidateSkillsCache\(context\.cwd\)/);
  assert.match(handler, /scheduleSkillsRefresh\("plugin-delete", context\.cwd\)/);
  assert.match(handler, /return result/);
});
