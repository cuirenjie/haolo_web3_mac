import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));
const apiClientSource = readFile(
  new URL("../src/main/youle-api-client.mjs", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("authenticated startup waits for every model catalog before becoming interactive", async () => {
  const source = await rendererSource;
  const startup = sourceBlock(
    source,
    "async function bootAuthenticatedWorkspaceWithModelPreload",
    "async function ensureActiveNewChatThread",
  );
  const preload = sourceBlock(
    source,
    "async function preloadAuthenticatedModelCatalogs",
    "function applyImageGenerationModelCatalogFailure",
  );

  assert.match(startup, /preloadAuthenticatedModelCatalogs\(\{\s*renderAfter: false/);
  assert.ok(
    startup.indexOf("await refreshProfileFromApi") <
      startup.indexOf("preloadAuthenticatedModelCatalogs"),
    "account model credentials must refresh before model catalog preload",
  );
  assert.match(startup, /showRefreshing: false/);
  assert.match(startup, /bootLocalWorkspaceWithLoginFallback/);
  assert.match(startup, /await Promise\.all\(\[\s*modelCatalogsPromise,\s*workspacePromise/);
  assert.match(startup, /!workspaceInteractiveReady \|\|\s*!modelCatalogsSettled/);
  assert.match(preload, /refreshBusinessModelPools\(\{/);
  assert.match(preload, /refreshProviderModelCatalog\(\{/);
  assert.match(preload, /preloadMediaCreationModelCatalogs\(\{/);
  assert.match(preload, /renderAfter: false/g);
  assert.match(preload, /authenticatedModelCatalogCachedIdentity === identity/);
});

test("restored sessions and fresh logins share the same model-cache startup gate", async () => {
  const source = await rendererSource;
  const boot = sourceBlock(source, "async function boot()", "function isCurrentAuthenticatedStartup");
  const login = sourceBlock(
    source,
    "async function enterAuthenticatedApp",
    "async function logoutFromYoule",
  );

  assert.match(boot, /bootAuthenticatedWorkspaceWithModelPreload\(seq\)/);
  assert.match(login, /bootAuthenticatedWorkspaceWithModelPreload\(seq,/);
  assert.doesNotMatch(boot, /refreshProfileFromApi/);
  assert.doesNotMatch(login, /refreshProfileFromApi/);
});

test("post-login model interactions never trigger catalog network loading", async () => {
  const source = await rendererSource;
  const modeSwitch = sourceBlock(
    source,
    "async function switchNewThreadMode",
    "async function switchComposerClusterMode",
  );
  const composer = sourceBlock(
    source,
    "function renderVideoExpertComposer",
    "function renderVideoExpertAspectRatioPicker",
  );
  const bindings = sourceBlock(
    source,
    ".querySelector<HTMLButtonElement>(\n      '[data-action=\"toggle-composer-model-menu\"]'",
    ".querySelectorAll<HTMLButtonElement>(\"[data-composer-model]\")",
  );
  const send = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  for (const block of [modeSwitch, composer, bindings, send]) {
    assert.doesNotMatch(
      block,
      /refreshBusinessModelPools|refreshProviderModelCatalog|refreshImageGenerationModelCatalog|preloadMediaCreationModelCatalogs|loadVideoExpertModels/,
    );
  }
});

test("main-process catalogs remain session caches until an explicit force refresh", async () => {
  const source = await apiClientSource;
  const blocks = [
    sourceBlock(source, "async listVideoExpertModels", "async listBusinessModelPools"),
    sourceBlock(source, "async listBusinessModelPools", "businessModelCredential"),
    sourceBlock(source, "async listImageGenerationModels", "async listProviderModelCatalog"),
    sourceBlock(source, "async fetchProviderModelCatalog", "async sendProviderChat"),
  ];

  for (const block of blocks) {
    assert.match(block, /params\.force !== true &&/);
    assert.match(block, /source:\s*"cache"/);
    assert.doesNotMatch(block, /now - cached\.cachedAt/);
  }
});
