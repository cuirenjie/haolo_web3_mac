import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("plugin list hides stale workspace data before requesting the next workspace", async () => {
  const source = await rendererSource;
  const loadBlock = sourceBlock(source, "async function loadLocalPlugins", "function samePluginWorkspace");

  assert.match(loadBlock, /const workspaceChanged =/);
  assert.match(loadBlock, /pluginListRequestSeq \+= 1;/);
  assert.match(loadBlock, /state\.plugins\.items = \[\];/);
  assert.match(loadBlock, /state\.plugins\.cwd = "";/);
  assert.match(loadBlock, /state\.plugins\.deleteDialog = null;/);
  assert.ok(
    loadBlock.indexOf("state.plugins.items = [];") < loadBlock.indexOf("const requestSeq = ++pluginListRequestSeq;"),
    "stale items must be cleared before the replacement request starts",
  );

  const renderBlock = sourceBlock(source, "function renderPluginMarketplacePage", "function renderPluginMarketplaceRow");
  assert.match(renderBlock, /const currentPluginCwd = threadWorkspaceCwd\(state\.currentThreadId\);/);
  assert.match(renderBlock, /samePluginWorkspace\(state\.plugins\.cwd, currentPluginCwd\)/);
  assert.match(renderBlock, /samePluginWorkspace\(state\.plugins\.requestCwd, currentPluginCwd\)/);
  assert.match(renderBlock, /currentWorkspaceLoaded \? state\.plugins\.items : \[\]/);
  assert.match(renderBlock, /currentWorkspaceLoaded && state\.plugins\.loaded/);
  assert.match(renderBlock, /currentWorkspaceRequested && state\.plugins\.loading && !items\.length/);
});

test("plugin mutations commit or roll back only inside their captured workspace request", async () => {
  const source = await rendererSource;
  const helpers = sourceBlock(source, "function samePluginWorkspace", "function extractPluginMarketplaceItems");
  assert.match(helpers, /requestSeq === pluginListRequestSeq/);
  assert.match(helpers, /samePluginWorkspace\(state\.plugins\.cwd, cwd\)/);
  assert.match(helpers, /samePluginWorkspace\(state\.plugins\.requestCwd, cwd\)/);
  assert.match(helpers, /samePluginWorkspace\(threadWorkspaceCwd\(state\.currentThreadId\), cwd\)/);

  const toggleBlock = sourceBlock(source, "async function toggleLocalPlugin", "function showPluginToast");
  assert.match(toggleBlock, /const operationRequestSeq = pluginListRequestSeq;/);
  assert.equal((toggleBlock.match(/isCurrentPluginOperationContext\(pluginCwd, operationRequestSeq\)/g) || []).length, 3);
  assert.ok(
    toggleBlock.indexOf("if (!isCurrentPluginOperationContext(pluginCwd, operationRequestSeq)) return;", toggleBlock.indexOf("await api.setPluginEnabled")) <
      toggleBlock.indexOf("await loadLocalPlugins"),
    "toggle completion must be revalidated before refreshing UI state",
  );

  const deleteBlock = sourceBlock(source, "async function confirmPluginDelete", "async function loadMarketplaceSkills");
  assert.match(deleteBlock, /const pluginCwd = dialog\.cwd;/);
  assert.equal((deleteBlock.match(/isCurrentPluginOperationContext\([^)]*dialog\.requestSeq\)/g) || []).length, 3);
  assert.ok(
    deleteBlock.indexOf("if (!isCurrentPluginOperationContext(pluginCwd, dialog.requestSeq)) return;", deleteBlock.indexOf("await api.deletePlugin")) <
      deleteBlock.indexOf("state.plugins.items = state.plugins.items.filter"),
    "delete completion must be revalidated before removing a row",
  );

  const clickBlock = sourceBlock(source, 'root.querySelectorAll<HTMLButtonElement>("[data-plugin-delete]")', "root.querySelectorAll<HTMLElement>");
  assert.match(clickBlock, /cwd: state\.plugins\.cwd,/);
  assert.match(clickBlock, /requestSeq: pluginListRequestSeq,/);
});
