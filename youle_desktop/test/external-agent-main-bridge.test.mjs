import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

test("external agent IPC is an independent, default-off main-frame bridge", async () => {
  const [main, preload] = await Promise.all([mainSource, preloadSource]);
  for (const channel of [
    "externalAgents:getCapabilities",
    "externalAgents:startRun",
    "externalAgents:getRun",
    "externalAgents:waitRun",
    "externalAgents:cancelRun",
    "externalAgents:event",
  ]) {
    const pattern = new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(main, pattern);
    assert.match(preload, pattern);
  }

  assert.match(main, /process\.env\.HAOLO_EXTERNAL_AGENT_RUNTIME \|\| ""/);
  assert.match(main, /process\.env\.HAOLO_EXTERNAL_AGENT_PROVIDER_ALLOWLIST \|\| ""/);
  assert.match(main, /function assertExternalModelsIpcSender\(event\)/);
  assert.match(main, /externalAgentOwnerIdForEvent\(event\)/);
  assert.match(main, /event\.ownerId !== currentOwnerId/);
  assert.match(main, /webContents\.send\("externalAgents:event", externalAgentPublicEvent\(event\)\)/);
  assert.doesNotMatch(main, /sendToRenderer\("externalAgents:event"/);
  assert.match(main, /\{ \.\.\.params, dataClassification: "internal" \}/);
  assert.match(main, /\{ ownerId, userDirected: true \}/);
});

test("runtime shares the credential store and is cancelled on credential removal and renderer loss", async () => {
  const main = await mainSource;
  assert.match(main, /function getExternalModelCredentialStore\(\)/);
  assert.match(main, /credentialStore: getExternalModelCredentialStore\(\)/);
  assert.match(main, /await externalAgentRuntime\.cancelProvider\(provider\)/);
  assert.match(main, /did-start-navigation[\s\S]{0,240}cancelExternalAgentOwnersForWebContents/);
  assert.match(main, /render-process-gone[\s\S]{0,240}cancelExternalAgentOwnersForWebContents/);
  assert.match(main, /withShutdownTimeout\("external agent runtime", externalAgentRuntime\.shutdown\(\)\)/);
});

test("preload exposes run controls but never provider credentials or raw requests", async () => {
  const preload = await preloadSource;
  assert.doesNotMatch(preload, /getExternalAgent(?:ApiKey|Credential|Secret)|externalAgents:(?:raw|credential|key)/i);
  assert.doesNotMatch(preload, /externalAgents:[^"']*(?:tool|shell|write|file)/i);
});
