import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("fresh login waits for every thread group before revealing the interactive workspace", () => {
  const boot = sourceBlock(renderer, "async function bootLocalWorkspace(", "function applyAuthSession");
  const serverReady = boot.indexOf('state.serverReady = true');
  const localThreadReady = boot.indexOf('await ensureActiveNewChatThread({ forceLocal: true })', serverReady);
  const groupedThreads = boot.indexOf('await loadThreads()', localThreadReady);
  const finalReconciliation = boot.indexOf('await reconcilePersistedThreadContinuations()', groupedThreads);
  const reveal = boot.indexOf('options.onInteractiveReady?.()', finalReconciliation);
  const optionalHydration = boot.indexOf('await loadExternalChannels', reveal);

  assert.ok(serverReady >= 0);
  assert.ok(localThreadReady > serverReady);
  assert.ok(groupedThreads > localThreadReady);
  assert.ok(finalReconciliation > groupedThreads);
  assert.ok(reveal > finalReconciliation);
  assert.ok(optionalHydration > reveal);
});

test("login stays visible until core hydration and the model cache are both ready", () => {
  const loading = sourceBlock(renderer, "function isAuthenticatedWorkspaceLoading()", "function loginWindowMode()");
  const enter = sourceBlock(renderer, "async function enterAuthenticatedApp()", "async function logoutFromYoule()");
  const startup = sourceBlock(
    renderer,
    "async function bootAuthenticatedWorkspaceWithModelPreload",
    "async function ensureActiveNewChatThread",
  );

  assert.match(loading, /state\.loading && !authenticatedWorkspaceInteractive/);
  assert.match(enter, /authenticatedWorkspaceInteractive = false/);
  assert.match(enter, /authenticatedWorkspaceInteractive = true/);
  assert.match(
    enter,
    /bootAuthenticatedWorkspaceWithModelPreload\(seq, \{[\s\S]*onInteractiveReady/,
  );
  assert.match(startup, /preloadAuthenticatedModelCatalogs/);
  assert.match(startup, /!workspaceInteractiveReady \|\|\s*!modelCatalogsSettled/);
  assert.match(
    startup,
    /await Promise\.all\(\[\s*modelCatalogsPromise,\s*workspacePromise/,
  );
});

test("authenticated startup repairs a stale login-sized app window before revealing the workspace", () => {
  assert.match(main, /const bounds = window && !window\.isDestroyed\(\) \? window\.getBounds\(\) : null;/);
  assert.match(main, /appMinimumSize,/);
  assert.match(renderer, /function appWindowBoundsNeedRepair\(payload: WindowState \| null \| undefined\)/);
  assert.match(
    renderer,
    /if \(payload\?\.mode === "app" && appWindowBoundsNeedRepair\(payload\)\) \{[\s\S]*?api\.setWindowMode\?\.\("app", \{ center: true \}\)/,
  );
  assert.match(renderer, /const requestSeq = \+\+windowModeRequestSeq;/);
  assert.match(renderer, /if \(requestSeq !== windowModeRequestSeq \|\| currentWindowMode !== mode\) return;/);
  assert.match(renderer, /if \(payload\.mode && currentWindowMode && payload\.mode !== currentWindowMode\) \{/);
});
