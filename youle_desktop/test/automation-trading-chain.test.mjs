import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationStore } from "../src/main/automation/store.mjs";
import { buildDurablePrompt } from "../src/main/automation/worker.mjs";
import {
  TRADING_AUTOMATION_EXECUTION_PROFILE,
  TRADING_AUTOMATION_MODEL,
  TRADING_AUTOMATION_REASONING_EFFORT,
  buildTradingAutomationDeveloperInstructions,
  isTradingAutomationJob,
  normalizeTradingAutomationContext,
  resolveTradingAutomationRoute,
  tradingAutomationBinanceInterval,
} from "../src/main/automation/trading-profile.mjs";

const strategies = [
  { id: "chan", enabled: true, display: { name: "缠论" }, mentions: { canonical: "缠论", aliases: [] } },
  { id: "wave", enabled: true, display: { name: "波浪理论" }, mentions: { canonical: "波浪理论", aliases: ["波浪"] } },
];

function tradingJob(overrides = {}) {
  return {
    id: "auto-task-ui-trading-test",
    createdBy: "auto_task_ui",
    executionProfile: TRADING_AUTOMATION_EXECUTION_PROFILE,
    tradingContext: {
      provider: "binance",
      venue: "Binance",
      marketType: "perpetual",
      marketId: "BINANCE:FUTURES:ETHUSDT",
      symbol: "ETHUSDT",
      interval: "240",
      resolution: "240",
    },
    ...overrides,
  };
}

test("automatic trading context is normalized and maps to Binance intervals", () => {
  assert.deepEqual(normalizeTradingAutomationContext({
    provider: "BINANCE",
    marketType: "spot",
    marketId: "binance:spot:ethusdt",
    interval: "1h",
  }), {
    provider: "binance",
    venue: "Binance",
    marketType: "spot",
    marketId: "BINANCE:SPOT:ETHUSDT",
    symbol: "ETHUSDT",
    interval: "60",
    resolution: "60",
  });
  assert.equal(tradingAutomationBinanceInterval("240"), "4h");
  assert.equal(tradingAutomationBinanceInterval("1D"), "1d");
  const hyperliquid = normalizeTradingAutomationContext({
    provider: "hyperliquid",
    marketId: "HYPERLIQUID:PERP:BTC",
    symbol: "BTC",
    interval: "4h",
  });
  assert.equal(hyperliquid.symbol, "BTC");
  assert.equal(hyperliquid.venue, "hyperliquid");
});

test("explicit automatic analysis overrides the captured chart while current-chart analysis reuses it", () => {
  const explicit = resolveTradingAutomationRoute({
    prompt: "每小时用缠论分析 BTC 1h 的盘面",
    context: tradingJob().tradingContext,
    strategies,
  });
  assert.equal(explicit.mode, "analysis");
  assert.equal(explicit.strategyId, "chan");
  assert.equal(explicit.symbol, "BTCUSDT");
  assert.equal(explicit.interval, "60");
  assert.equal(explicit.marketId, "BINANCE:FUTURES:BTCUSDT");
  assert.equal(explicit.drawingRequested, true);
  assert.equal(explicit.executionPlanRequested, true);

  const currentChart = resolveTradingAutomationRoute({
    prompt: "分析当前盘面并给出交易计划",
    context: tradingJob().tradingContext,
    strategies,
  });
  assert.equal(currentChart.mode, "analysis");
  assert.equal(currentChart.strategyId, null);
  assert.equal(currentChart.symbol, "ETHUSDT");
  assert.equal(currentChart.interval, "240");

  const priceCheck = resolveTradingAutomationRoute({
    prompt: "检查 ETH 当前价格和成交量",
    context: tradingJob().tradingContext,
    strategies,
  });
  assert.equal(priceCheck.mode, "analysis");
  assert.equal(priceCheck.symbol, "ETHUSDT");
});

test("trading knowledge stays conversational instead of fabricating a live-market analysis", () => {
  assert.deepEqual(resolveTradingAutomationRoute({
    prompt: "什么是缠论",
    context: tradingJob().tradingContext,
    strategies,
  }), { mode: "conversation", reason: "knowledge-only" });
});

test("auto-task jobs receive trading-first unattended instructions and live-order safety", () => {
  const job = tradingJob();
  assert.equal(isTradingAutomationJob(job), true);
  assert.equal(isTradingAutomationJob({ id: "generic", createdBy: "settings" }), false);
  const instructions = buildTradingAutomationDeveloperInstructions(job);
  assert.match(instructions, /Trading routing and trading safety take precedence/);
  assert.match(instructions, /fresh market snapshot/);
  assert.match(instructions, /ExecutionPlanV1/);
  assert.match(instructions, /Do not place, cancel, or modify a live order merely because analysis produced an execution plan/);

  const prompt = buildDurablePrompt({
    ...job,
    name: "交易自动任务",
    promptTemplate: "分析当前盘面",
    workspacePath: process.cwd(),
    scheduleType: "daily",
    scheduleExpr: "09:00",
    timezone: "Asia/Shanghai",
  }, { id: "run-1", triggerType: "scheduled", scheduledForUtc: "2026-08-30T01:00:00.000Z" });
  assert.match(prompt, /haolo_trading_automation/);
  assert.match(prompt, /User automation task:\s*分析当前盘面/);
});

test("automation store preserves the trading execution profile across reloads and updates", async () => {
  const dataDir = path.join(os.tmpdir(), `haolo-trading-automation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  try {
    const store = new AutomationStore({ dataDir });
    const created = await store.createJob({
      id: "auto-task-ui-persisted",
      name: "交易任务",
      workspacePath: dataDir,
      prompt: "分析当前盘面",
      schedule: { type: "manual", expr: null, timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
      createdBy: "auto_task_ui",
      executionProfile: TRADING_AUTOMATION_EXECUTION_PROFILE,
      tradingContext: tradingJob().tradingContext,
      model: TRADING_AUTOMATION_MODEL,
      reasoningEffort: TRADING_AUTOMATION_REASONING_EFFORT,
      execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never" },
    });
    assert.equal(created.executionProfile, TRADING_AUTOMATION_EXECUTION_PROFILE);
    assert.equal(created.tradingContext.marketId, "BINANCE:FUTURES:ETHUSDT");
    assert.equal(created.model, TRADING_AUTOMATION_MODEL);
    assert.equal(created.reasoningEffort, TRADING_AUTOMATION_REASONING_EFFORT);

    const reloaded = new AutomationStore({ dataDir });
    const persisted = await reloaded.getJob(created.id);
    assert.equal(persisted.executionProfile, TRADING_AUTOMATION_EXECUTION_PROFILE);
    assert.equal(persisted.tradingContext.symbol, "ETHUSDT");
    await reloaded.updateJob(created.id, { execution: { tradingContext: { ...persisted.tradingContext, interval: "1D" } } });
    const updated = await reloaded.getJob(created.id);
    assert.equal(updated.tradingContext.interval, "1D");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("scheduled and immediate auto-task triggers converge on the trading worker", async () => {
  const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /for \(const task of dueTasks\) \{\s*void runAutoTask\(task\.id\);/);
  assert.match(mainSource, /async function runAutoTask\(taskId\)[\s\S]*?getAutomationWorker\(\)\.runNow\(autoTaskJobId\(syncedTask\)\)/);
  assert.match(mainSource, /async function executeAutomationTurn[\s\S]*?executeTradingAutomationAnalysis[\s\S]*?if \(tradingAnalysisResult\) return tradingAnalysisResult;[\s\S]*?ensureAutomationThread/);
  assert.match(mainSource, /executionProfile: TRADING_AUTOMATION_EXECUTION_PROFILE/);
  assert.match(mainSource, /model: TRADING_AUTOMATION_MODEL/);
  assert.match(mainSource, /reasoningEffort: TRADING_AUTOMATION_REASONING_EFFORT/);
  assert.match(mainSource, /getBinancePublicMarketService\(\)\.request/);
  assert.match(mainSource, /tradingStrategyParamsWithPersonalRisk/);
  assert.match(mainSource, /tradingStrategyParamsWithReadOnlyBinanceAccount/);
  assert.match(mainSource, /tradingAutomationContextCandles/);
  assert.match(mainSource, /tradingAutomationComparisonMarkets/);
  assert.match(mainSource, /coordinator\.run\([\s\S]*?tradingStrategyParamsWithReadOnlyBinanceAccount/);
  assert.match(mainSource, /runTradingPriceActionAnalysisPipeline/);
  assert.match(mainSource, /trading-analysis\.json/);

  assert.match(rendererSource, /tradingContext: currentAutoTaskTradingContext\(\) \|\| existing\?\.tradingContext \|\| null/);
  assert.match(rendererSource, /function selectAutoTaskThread[\s\S]*?initializeTradingExpertTaskThread\(normalizedThreadId, \{ expandPanel: true \}\)/);
  assert.match(rendererSource, /function handleAutomationThreadNotification[\s\S]*?initializeTradingExpertTaskThread\(normalizedThreadId\)/);
});
