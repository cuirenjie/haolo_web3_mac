import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const settingsSource = readFile(new URL("../src/renderer/external-model-settings.ts", import.meta.url), "utf8");

test("external model credential IPC is narrow and does not expose a secret reader", async () => {
  const [main, preload] = await Promise.all([mainSource, preloadSource]);
  for (const channel of [
    "externalModels:listProviders",
    "externalModels:saveProvider",
    "externalModels:removeProvider",
    "externalModels:testConnection",
  ]) {
    assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(preload, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(preload, /getExternalModel(?:ApiKey|Credential|Secret)/);
  assert.doesNotMatch(main, /ipcMain\.handle\("externalModels:(?:getSecret|readKey)/);
  assert.match(main, /LOCAL_ARTIFACT_IGNORED_FILES[\s\S]*"external-model-credentials\.json"/);
  assert.match(main, /function assertExternalModelsIpcSender\(event\)/);
  assert.match(main, /event\.sender !== webContents/);
  assert.match(main, /event\.senderFrame !== webContents\.mainFrame/);
  assert.match(main, /webContents\.on\("will-navigate"/);
});

test("model settings keeps keys in an ephemeral password input", async () => {
  const source = await settingsSource;
  assert.match(source, /type="password"/);
  assert.match(source, /autocomplete="new-password"/);
  assert.match(source, /value=""/);
  assert.match(source, /系统安全存储加密/);
  assert.match(source, /Haolo 配置/);
  assert.doesNotMatch(source, /Codex/i);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.(?:setItem|getItem)|encryptedApiKey/);
});

test("model settings uses the shared HaoLo option box instead of a native visible select", async () => {
  const [settings, renderer] = await Promise.all([settingsSource, rendererSource]);
  assert.match(settings, /renderHaoloSelect\(\{/);
  assert.match(settings, /className: "external-model-base-url-select"/);
  assert.match(settings, /"data-external-model-base-url": provider\.id/);
  assert.doesNotMatch(settings, /<select\b/);
  assert.match(renderer, /bindHaoloSelects\(settingsDialog\)/);
  assert.match(renderer, /querySelector<HTMLInputElement>\("\[data-external-model-base-url\]"\)/);
});

test("first-stage model configuration does not replace the existing provider chat route", async () => {
  const main = await mainSource;
  const renderer = await rendererSource;
  assert.match(
    renderer,
    /const ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS\s*=\s*import\.meta\.env\.VITE_ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS === "true";/,
  );
  assert.match(
    renderer,
    /ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS[\s\S]*data-settings-tab="models"/,
  );
  assert.match(
    renderer,
    /tab === "models" && !ENABLE_LOCAL_EXTERNAL_MODEL_SETTINGS/,
  );
  assert.match(
    main,
    /ipcMain\.handle\("youle:sendProviderChat", async \(_event, params = \{\}\) => \{[\s\S]*?resolvedThreadReferenceContext\(params, threadId, cwd\)[\s\S]*?prepareQuestionAnswerFileContext\([\s\S]*?params,[\s\S]*?cwd,[\s\S]*?emitQuestionAnswerProgress[\s\S]*?providerMessagesWithReferencedThreadContext[\s\S]*?providerMessagesWithQuestionAnswerFileContext[\s\S]*?invokeQuestionAnswerProvider\(\{[\s\S]*?workspaceTools:\s*questionAnswerFileContext\?\.workspaceTools/,
  );
  assert.match(main, /QuestionAnswerContextIntentResolver/);
  assert.doesNotMatch(
    main,
    /prepareQuestionAnswerFileContext[\s\S]{0,2500}workflowNeedsLocalContext/,
  );
  assert.match(main, /rootCodexGrantRequired:\s*false|publicQuestionAnswerFileAccess/);
  assert.match(renderer, /modelPool:\s*"question_answer"[\s\S]*modelCapability:\s*"question_answer"/);
  assert.match(renderer, /<span>模型服务<\/span>/);
  assert.match(renderer, /renderExternalModelSettingsPanel\(state\.settings\.externalModels\)/);
  assert.match(renderer, /if \(state\.settings\.tab === "models"\) return;/);
});
