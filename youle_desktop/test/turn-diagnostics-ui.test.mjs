// HAOLO-TURN-DIAGNOSTICS-TEST
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const diagnosticsModule = fs.readFileSync(new URL("../src/main/turn-diagnostics.mjs", import.meta.url), "utf8");
const removalGuide = fs.readFileSync(new URL("../docs/turn-diagnostics-removal.md", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function stripRemovableDiagnosticBlocks(source) {
  return source.replace(
    /[^\n]*HAOLO-TURN-DIAGNOSTICS-BEGIN[^\n]*\n[\s\S]*?[^\n]*HAOLO-TURN-DIAGNOSTICS-END[^\n]*(?:\n|$)/g,
    "",
  );
}

test("normal chat sends a diagnostic id and terminal notifications return it to the renderer", () => {
  const send = sourceBlock(main, 'ipcMain.handle("codex:sendMessage"', 'ipcMain.handle("codex:interruptTurn"');
  const notifications = sourceBlock(main, "function handleClientNotification", "function recordArtifactAgentMessageNotification");
  const rendererSend = sourceBlock(renderer, "async function sendAgentText", "async function flushQueuedSend");

  assert.match(send, /beginTurnDiagnostic/);
  assert.match(send, /diagnosticId: turnDiagnostic\.diagnosticId/);
  assert.match(send, /failTurnDiagnostic\(turnDiagnostic, error\)/);
  assert.doesNotMatch(send, /diagnosticError/);
  assert.match(notifications, /recordCodexNotificationDiagnostic/);
  assert.match(notifications, /withTurnDiagnosticId/);
  assert.match(rendererSend, /clientRequestId: diagnosticId/);
  assert.match(rendererSend, /withDiagnosticId/);
});

test("all diagnostic integration surfaces carry balanced removable tags", () => {
  for (const [name, source] of Object.entries({ main, preload, renderer, styles })) {
    const beginCount = source.match(/HAOLO-TURN-DIAGNOSTICS-BEGIN/g)?.length || 0;
    const endCount = source.match(/HAOLO-TURN-DIAGNOSTICS-END/g)?.length || 0;
    assert.ok(beginCount > 0, `${name} is missing removable diagnostic tags`);
    assert.equal(beginCount, endCount, `${name} has unbalanced removable diagnostic tags`);
  }
  assert.match(diagnosticsModule, /HAOLO-TURN-DIAGNOSTICS-MODULE/);
  assert.match(removalGuide, /完整删除步骤/);
  assert.match(removalGuide, /rg -n "HAOLO-TURN-DIAGNOSTICS"/);
});

test("removing tagged blocks leaves no diagnostic feature references", () => {
  const strippedMain = stripRemovableDiagnosticBlocks(main);
  const strippedPreload = stripRemovableDiagnosticBlocks(preload);
  const strippedRenderer = stripRemovableDiagnosticBlocks(renderer);
  const strippedStyles = stripRemovableDiagnosticBlocks(styles);

  assert.doesNotMatch(
    strippedMain,
    /TurnDiagnosticRecorder|turnDiagnosticHash|pendingTurnDiagnosticsByThreadId|turnDiagnosticsByTurnId|recordTurnDiagnostic|beginTurnDiagnostic|movePendingTurnDiagnostic|bindTurnDiagnostic|recordCodexNotificationDiagnostic|withTurnDiagnosticId|failTurnDiagnostic|turnDiagnosticsRuntimeSnapshot|app:exportDiagnostics/,
  );
  assert.doesNotMatch(strippedPreload, /exportDiagnostics|app:exportDiagnostics/);
  assert.doesNotMatch(
    strippedRenderer,
    /exportDiagnostics|diagnosticsExporting|turnDiagnosticIds|latestThreadDiagnosticIds|normalizeTurnDiagnosticId|createTurnDiagnosticId|notificationDiagnosticId|rememberTurnDiagnosticId|diagnosticIdForTurn|withDiagnosticId|clientRequestId: diagnosticId|renderSettingsDiagnosticsButton|data-action="export-diagnostics"/,
  );
  assert.doesNotMatch(strippedStyles, /settings-diagnostics-button/);
});

test("settings exposes privacy-safe diagnostic export through preload", () => {
  assert.match(preload, /exportDiagnostics: \(\) => ipcRenderer\.invoke\("app:exportDiagnostics"\)/);
  assert.match(main, /ipcMain\.handle\("app:exportDiagnostics"/);
  assert.match(renderer, /data-action="export-diagnostics"/);
  assert.doesNotMatch(renderer, /<span>故障诊断<\/span>/);
  assert.doesNotMatch(renderer, /仅包含脱敏运行状态、时延、错误分类和诊断编号，不包含对话正文或密钥/);
  assert.match(renderer, /诊断报告已导出/);
});

test("general settings places diagnostic export at the right of the final install path row", () => {
  const settings = sourceBlock(renderer, "function renderSettingsDialog", "function renderSettingsDiagnosticsButton");
  const userDataIndex = settings.indexOf("renderSettingsUserDataRow()");
  const installPathIndex = settings.indexOf('class="settings-storage-row"');
  const diagnosticsIndex = settings.indexOf("renderSettingsDiagnosticsButton()");

  assert.ok(userDataIndex < installPathIndex);
  assert.ok(installPathIndex < diagnosticsIndex);
  assert.match(
    settings,
    /renderSettingsUserDataRow\(\)[\s\S]*class="settings-storage-row"[\s\S]*用户安装目录地址[\s\S]*renderSettingsDiagnosticsButton\(\)[\s\S]*<\/div>\s*<\/div>/,
  );
  assert.match(styles, /\.settings-storage-row\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/);
});

test("diagnostic export button covers light and dark interaction states", () => {
  assert.match(styles, /\.settings-data-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.settings-data-button:active:not\(:disabled\)/);
  assert.match(styles, /\.settings-data-button:focus-visible/);
  assert.match(styles, /\.settings-data-button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.settings-data-button:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.settings-data-button:active:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.settings-data-button:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.settings-data-button:disabled/);
});

test("terminal error formatting recognizes nested operational failure families", () => {
  const formatter = sourceBlock(renderer, "function formatTurnFailureMessage", "function armContextWindowRecoveryReplay");
  assert.match(renderer, /notificationFailureReason/);
  assert.match(formatter, /模型服务当前并发已满/);
  assert.match(formatter, /模型服务请求过于频繁/);
  assert.match(formatter, /模型响应流意外中断，请稍后重试。/);
  assert.match(formatter, /模型服务暂时不可用/);
  assert.match(formatter, /模型服务身份验证失败/);
});

test("model recovery notices share the light and dark message surface without hard-coded colours", () => {
  const notices = sourceBlock(renderer, "function announceAutomaticTurnRecovery", "function armContextWindowRecoveryReplay");
  assert.match(notices, /GPT-5.5 最高推理模式/);
  assert.match(notices, /appendAgentNotice/);
  assert.match(notices, /exhausted/);
  assert.doesNotMatch(notices, /#[0-9a-f]{3,8}\b|(?:background|color)\s*:/iu);
  const surface = sourceBlock(renderer, "function appendAgentNotice", "function refreshTradingExpertConversationSurface");
  assert.match(surface, /type: "agentMessage"/);
  assert.match(surface, /__youleLocalStatus: true/);
});
