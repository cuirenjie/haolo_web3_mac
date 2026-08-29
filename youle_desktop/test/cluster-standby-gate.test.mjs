import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const mainSource = readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("cluster mode reports only online contacts before starting a workflow", async () => {
  const source = await rendererSource;
  const availability = sourceBlock(
    source,
    "function onlineMultiModelClusterProviders",
    "function providerSessionKeyAvailable",
  );
  const sendFlow = sourceBlock(
    source,
    "async function sendCurrentMessage",
    "async function sendCurrentProviderMessage",
  );

  assert.match(
    availability,
    /effectiveContactStatus\(contactForProvider\(provider\)\) === "在线"/,
  );
  assert.match(
    sendFlow,
    /if \(isMultiModelClusterThread\(threadId\)\)[\s\S]*onlineClusterProviders = onlineMultiModelClusterProviders\(\)/,
  );
  assert.doesNotMatch(sendFlow, /refreshProviderModelCatalog/);
  assert.match(
    sendFlow,
    /onlineClusterProviders = onlineMultiModelClusterProviders\(\)/,
  );
  assert.match(
    sendFlow,
    /onlineProviders: onlineClusterProviders \|\| \[\]/,
  );
});

test("main process intersects reported online providers with authenticated providers", async () => {
  const source = await mainSource;
  const handler = sourceBlock(
    source,
    'ipcMain.handle("workflow:startRun"',
    'ipcMain.handle("workflow:getRun"',
  );
  const executor = sourceBlock(
    source,
    "async function executeClusterProviderNode",
    "async function executeClusterCodexSubAgentNode",
  );

  assert.match(handler, /const authenticatedProviders = new Set/);
  assert.match(handler, /Array\.isArray\(params\.onlineProviders\)/);
  assert.match(
    handler,
    /reportedOnlineProviders\.filter\(\(provider\) =>\s*authenticatedProviders\.has\(provider\)/,
  );
  assert.match(handler, /clusterRegistryForOnlineProviders/);
  assert.match(
    handler,
    /runtime\.registry\.some\(\(entry\) => entry\.executorType === "external_model"\)/,
  );
  assert.match(executor, /sessionSummary\(\)[\s\S]*modelProviders/);
  assert.match(executor, /CLUSTER_PROVIDER_STANDBY/);
  assert.match(executor, /throw error/);
});
