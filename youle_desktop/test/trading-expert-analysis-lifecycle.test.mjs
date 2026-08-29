import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TradingAnalysisJobController } from "../src/renderer/trading-expert-analysis-jobs.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("trading analysis jobs retain their submitted market context across view changes", () => {
  const jobs = new TradingAnalysisJobController();
  const original = jobs.start({
    analysisId: "analysis-a",
    theory: "order-flow",
    storageSessionId: "temporary-thread",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    symbol: "BTCUSDT",
    interval: "240",
    market: { id: "BINANCE:FUTURES:BTCUSDT", symbol: "BTCUSDT" },
  });

  assert.equal(jobs.isActive(original.analysisId), true);
  jobs.migrateStorageSession("temporary-thread", "real-thread");
  assert.equal(original.storageSessionId, "real-thread");
  assert.equal(original.marketId, "BINANCE:FUTURES:BTCUSDT");
  assert.equal(original.interval, "240");
  jobs.complete(original.analysisId);
  assert.equal(original.status, "completed");
});

test("stopping one trading analysis does not cancel another job", () => {
  const jobs = new TradingAnalysisJobController();
  jobs.start({
    analysisId: "analysis-a",
    theory: "chan",
    storageSessionId: "thread-a",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    symbol: "BTCUSDT",
    interval: "60",
  });
  jobs.start({
    analysisId: "analysis-b",
    theory: "wave",
    storageSessionId: "thread-a",
    marketId: "BINANCE:FUTURES:ETHUSDT",
    symbol: "ETHUSDT",
    interval: "240",
  });

  jobs.cancel("analysis-a");
  assert.equal(jobs.get("analysis-a")?.status, "cancelled");
  assert.equal(jobs.isActive("analysis-b"), true);
});

test("chart navigation is detached from analysis cancellation and IPC cancellation is job-scoped", () => {
  const market = fs.readFileSync(path.join(root, "src/renderer/trading-expert-market.ts"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/main.ts"), "utf8");
  const main = fs.readFileSync(path.join(root, "src/main/main.mjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "src/main/preload.mjs"), "utf8");
  const restartBlock = market.slice(
    market.indexOf("private async restartMarketData"),
    market.indexOf("private async refreshSnapshot"),
  );
  const destroyBlock = market.slice(
    market.indexOf("destroy() {"),
    market.indexOf("function formatMarketPrice"),
  );

  assert.doesNotMatch(restartBlock, /cancelTradingAnalysis|cancelChanAnalysis/);
  assert.doesNotMatch(destroyBlock, /cancelTradingAnalysis|cancelChanAnalysis/);
  assert.equal((market.match(/const job = tradingAnalysisJobs\.start\(\{/g) || []).length, 5);
  const activeRunnerSection = renderer.slice(
    renderer.indexOf("async function runTradingGeneralChartRequest"),
    renderer.indexOf("async function runTradingChanChartRequest"),
  );
  assert.equal((activeRunnerSection.match(/const analysisId = beginTradingExpertAnalysisJob\(/g) || []).length, 2);
  assert.match(market, /persistTradingAiDrawingPatch\(storageSessionId, patch\)/);
  assert.match(market, /const latestJob = tradingAnalysisJobs\.get\(job\.analysisId\)[\s\S]*?persistTradingAiDrawingPatch\(storageSessionId, patch\)[\s\S]*?storeAnalysisDrawingPatch\(patch, paneIndex\)/);
  assert.match(renderer, /migrateTradingExpertMarketWorkspaceStorageSession\(previousThreadId, nextThreadId\)/);
  assert.match(renderer, /TRADING_EXPERT_WORKSPACE_SESSION_ALIASES_KEY = "haolo\.trading-market\.workspace-session-aliases\.v1"/);
  assert.match(renderer, /rememberTradingExpertWorkspaceSessionAlias\(previousThreadId, nextThreadId\)[\s\S]*?migrateTradingExpertMarketWorkspaceStorageSession\(previousThreadId, nextThreadId\)/);
  assert.match(renderer, /tradingExpertWorkspaceSessionMigrationSource\([\s\S]*?pendingStorageMigrationSource[\s\S]*?syncTradingExpertMarketWorkspace\([\s\S]*?pendingStorageMigrationSource/);
  assert.match(renderer, /const storageSessionId = tradingExpertMarketWorkspaceStorageSessionId\(\) \|\| threadId/);
  assert.match(renderer, /sourceStorageSessionId && sourceStorageSessionId !== targetStorageSessionId[\s\S]*?sourceStorageSessionId/);
  const activePatchBlock = renderer.slice(
    renderer.indexOf("function patchActiveChatSurfaces"),
    renderer.indexOf("function canBufferCollapsedTradingExpertConversation"),
  );
  assert.doesNotMatch(activePatchBlock, /tradingExpertWorkspaceThreadReplacements\.delete/);
  assert.match(main, /tradingAnalysisControllerKey[\s\S]*?analysisJobId/);
  assert.match(main, /candidateJobId === analysisJobId \|\| candidateJobId\.startsWith\(`\$\{analysisJobId\}:pane:`\)/);
  assert.match(preload, /cancelTradingAnalysis: \(params = \{\}\) => ipcRenderer\.invoke\("tradingAnalysis:cancel", params\)/);
  assert.match(preload, /cancelTradingStrategyAnalysis: \(params = \{\}\) => ipcRenderer\.invoke\("tradingStrategy:cancel", params\)/);
  assert.match(main, /ipcMain\.handle\("tradingStrategy:cancel"/);
});
