import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const alertDir = new URL("../src/main/trading-alerts/", import.meta.url);

test("trading-alert runtime contains no dynamic code, shell, screenshot, DOM or model hot path", async () => {
  const files = (await readdir(alertDir)).filter((name) => name.endsWith(".mjs"));
  const sources = await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, alertDir), "utf8")]));
  const runtime = sources.filter(([name]) => !["intent-provider.mjs", "intent-workflow.mjs", "service.mjs"].includes(name)).map(([, source]) => source).join("\n");
  assert.doesNotMatch(runtime, /\beval\s*\(|new Function|child_process|exec_command|screenshot|BrowserWindow|document\.|globalThis\.window|window\.document/);
  const engine = sources.find(([name]) => name === "engine.mjs")[1];
  assert.doesNotMatch(engine, /intent|prompt|modelId|invoke/iu);
  assert.match(engine, /TradingAlertEvaluator/);
});

test("IPC handlers authenticate the sender and renderer cannot invoke raw rule evaluation", async () => {
  const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
  assert.match(main, /async function tradingAlertIpcCall[\s\S]*assertExternalModelsIpcSender\(event\)/);
  assert.match(main, /ipcMain\.handle\("tradingAlerts:getSimulation"[\s\S]*tradingAlertIpcCall\(event, "getSimulation", params\)/);
  assert.match(main, /tradingAlerts:marketSubscribe[\s\S]*assertExternalModelsIpcSender\(event\)/);
  assert.match(main, /const openContext = \{[^}]*evidenceId:[^}]*\}[\s\S]*sendToRenderer\("tradingAlerts:triggered"[\s\S]*\.\.\.openContext/);
  assert.doesNotMatch(preload, /tradingAlertsEvaluate|evaluateRule|appendEvidence/);
  assert.doesNotMatch(preload, /apiKey.*tradingAlerts|privateKey.*tradingAlerts/iu);
  assert.match(preload, /tradingAlertsGetSimulation: \(params\) => ipcRenderer\.invoke\("tradingAlerts:getSimulation", params\)/);
  assert.match(preload, /onTradingAlertTriggered/);
});

test("desktop alert service uses the governed dynamic router and shared market hub", async () => {
  const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const start = main.indexOf("async function getTradingAlertService");
  const end = main.indexOf("async function tradingAlertIpcCall", start);
  const factory = main.slice(start, end);
  assert.match(factory, /const router = getBinanceNetworkRouter\(\)/);
  assert.match(factory, /getBinanceRequestGovernor\(\)\.fetch\([\s\S]*router\.publicFetch\.bind\(router\)[\s\S]*source: "alert"[\s\S]*BINANCE_REQUEST_PRIORITIES\.alert/);
  assert.match(factory, /subscribeMode: "websocket"/);
  assert.match(factory, /streamHub: getTradingMarketDataHub\(\)/);
});

test("account traffic remains governed before its authenticated private tunnel", async () => {
  const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  assert.match(main, /new BinanceRequestGovernor\([\s\S]*binance-request-governor\.json/);
  assert.match(main, /const privateTransport = getBinancePrivateProxyTransport\(\)/);
  assert.match(main, /getBinanceRequestGovernor\(\)\.fetch\([\s\S]*router\.privateFetch\.bind\(router\)[\s\S]*source: "account"[\s\S]*BINANCE_REQUEST_PRIORITIES\.account/);
  assert.match(main, /permitProvider: \(url, options\) => gatewayClient\.privateRequestPermit\(url, options\)/);
  assert.match(main, /usageReporter: \(report\) => gatewayClient\.reportPrivateUsage\(report\)/);
  assert.match(main, /restartClientAfterAuthChange\(\)[\s\S]*resetBinanceNetworkRuntimeAfterAuthChange\(\)/);
  assert.match(main, /resetBinanceNetworkRuntimeAfterAuthChange[\s\S]*binancePrivateProxyTransport\.close\(\)/);
});

test("alert intent uses retryable idle timeout policy while request routing stays hard-bounded", async () => {
  const [main, policy] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis-turn-policy.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /const turnPolicy = tradingAnalysisTurnPolicy\(request\.task, \{ requestedReasoningEffort \}\)/);
  assert.match(main, /fixedEffort: reasoningEffort/);
  assert.match(main, /resetTimeoutOnActivity,/);
  assert.match(main, /timeoutRetryable,/);
  assert.match(main, /maxAttempts,/);
  assert.match(main, /Continue the same read-only trading alert intent compilation/);
  assert.match(policy, /task === "trading_alert_intent_compile"[\s\S]*timeoutMs: ALERT_INTENT_IDLE_TIMEOUT_MS[\s\S]*resetTimeoutOnActivity: true[\s\S]*timeoutRetryable: true[\s\S]*maxAttempts: 2/);
  assert.match(policy, /task\.endsWith\("-request-routing"\)[\s\S]*timeoutMs: ROUTING_TIMEOUT_MS[\s\S]*resetTimeoutOnActivity: false[\s\S]*timeoutRetryable: false[\s\S]*maxAttempts: 1/);
});

test("a newer alert instruction cancels the older compiler and forwards its signal", async () => {
  const [main, service] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-alerts/service.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /activeTradingAlertIntentControllers\.get\(controllerKey\)\?\.abort/);
  assert.match(main, /signal: controller\.signal/);
  assert.match(main, /activeTradingAlertIntentControllers\.delete\(controllerKey\)/);
  assert.match(main, /cancelTradingAnalysisRequestsForWebContents\(mainWebContentsId\)/);
  assert.match(service, /signal: params\.signal/);
});

test("stale or cancelled alert runs cannot overwrite a newer conversation", async () => {
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const start = renderer.indexOf("async function runTradingAlertConversation");
  const end = renderer.indexOf("function tradingTranscriptPayloadFromItem", start);
  const run = renderer.slice(start, end);
  assert.match(run, /tradingAlertConversationRunByThreadId\.set\(threadId, runToken\)/);
  assert.match(run, /if \(!isCurrentRun\(\)\) return;/);
  assert.match(run, /code === "TRADING_ANALYSIS_CANCELLED"/);
  assert.match(run, /if \(isCurrentRun\(\)\)[\s\S]*clearTradingExpertThinkingState/);
});

test("alert intent streams only model reasoning summaries to its authenticated renderer thread", async () => {
  const main = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const captureStart = main.indexOf("function captureWorkflowCodexTurn");
  const captureEnd = main.indexOf("function workflowCodexTerminalFailure", captureStart);
  const capture = main.slice(captureStart, captureEnd);
  const ipcStart = main.indexOf("async function tradingAlertIpcCall");
  const ipcEnd = main.indexOf("function getTradingAnalysisModelRegistry", ipcStart);
  const ipc = main.slice(ipcStart, ipcEnd);

  assert.match(capture, /message\.method === "item\/reasoning\/summaryTextDelta"[\s\S]*options\.onReasoningSummaryDelta/);
  assert.doesNotMatch(capture, /item\/reasoning\/textDelta/);
  assert.match(ipc, /assertExternalModelsIpcSender\(event\)[\s\S]*event\.sender\.send\("tradingAlerts:intentProgress"/);
  assert.match(ipc, /threadId,[\s\S]*kind: "reasoning_summary_delta"[\s\S]*delta: summaryDelta/);
  assert.match(preload, /onTradingAlertIntentProgress:[\s\S]*tradingAlerts:intentProgress/);
  assert.match(renderer, /onTradingAlertIntentProgress[\s\S]*appendTradingAlertReasoningSummary/);
  assert.match(renderer, /reasoningSummary[\s\S]*tradingExpertThinkingStage/);
});

test("alert UI keeps provider safety while the settings provider page stays removed", async () => {
  const ui = await readFile(new URL("../src/renderer/trading-alerts-ui.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  assert.match(renderer, /请不要在聊天里发送 API Key 或私钥/);
  assert.doesNotMatch(renderer, /data-settings-tab="dataProviders"|renderTradingAlertDataProviderSettingsPanel|settings-data-providers/);
  assert.match(renderer, /handleTradingAlertTriggered[\s\S]*证据编号：[\$\{]*evidenceId/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-alerts-page/);
  assert.match(styles, /\.thinking-status-meta \.thinking-stage-detail[\s\S]*color: var\(--text-subtle\)/);
  assert.doesNotMatch(styles, /\.settings-data-providers/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
