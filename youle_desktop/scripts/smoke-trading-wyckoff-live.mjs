import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runTradingWyckoffAnalysisPipeline } from "../src/main/trading-analysis/wyckoff-pipeline.mjs";

const execFileAsync = promisify(execFile);
const BINANCE_FUTURES_URL = "https://fapi.binance.com";
const requestedSymbol = String(process.argv[2] || "BTCUSDT").trim().toUpperCase();
const requestedBinanceInterval = String(process.argv[3] || "1h").trim();
const requestedLimit = Math.min(1_000, Math.max(120, Number(process.argv[4]) || 500));
if (!/^[A-Z0-9]{5,20}$/.test(requestedSymbol)) throw new TypeError("Invalid smoke-test symbol");
if (!/^(?:[1-9]\d*[mhdw]|1M)$/.test(requestedBinanceInterval)) throw new TypeError("Invalid smoke-test interval");

function analysisInterval(interval) {
  const unit = interval.at(-1);
  const value = Number(interval.slice(0, -1));
  if (unit === "m") return String(value);
  if (unit === "h") return String(value * 60);
  if (unit === "d") return value === 1 ? "1D" : `${value}D`;
  if (unit === "w") return value === 1 ? "1W" : `${value}W`;
  return interval;
}

async function fetchJson(path) {
  const url = new URL(path, BINANCE_FUTURES_URL).toString();
  const { stdout } = await execFileAsync("curl.exe", [
    "--connect-timeout",
    "10",
    "--max-time",
    "30",
    "--silent",
    "--show-error",
    "--fail",
    "--location",
    url,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const klines = await fetchJson(`/fapi/v1/klines?symbol=${requestedSymbol}&interval=${requestedBinanceInterval}&limit=${requestedLimit}`);
const modelRegistry = createTradingAnalysisModelProviderRegistry([{
  providerId: "live-smoke-provider",
  modelId: "contract-check-model",
  capabilities: { json: true, theoryReview: true },
  async analyze() {
    return {
      text: JSON.stringify({
        schemaVersion: 1,
        verdict: "approve",
        summary: "实时 K 线已形成可复核的威科夫交易区间，等待边界确认。",
        report: "烟测复核器只验证模型中立协议，不创建候选之外的事件和价格。",
        marketBias: "neutral",
        strategyRationale: "以本地引擎确认的区间、量价事件和收盘突破条件为准。",
        primaryCandidateId: "use-deterministic-primary",
        alternateCandidateIds: [],
        selectedEventIds: [],
        showProjectionZone: true,
        confidence: 0.5,
      }),
    };
  },
}]);

const result = await runTradingWyckoffAnalysisPipeline({
  marketId: `BINANCE:FUTURES:${requestedSymbol}`,
  interval: analysisInterval(requestedBinanceInterval),
  snapshotTime: Date.now(),
  instruction: "真实 K 线威科夫纵向链路烟测",
  candles: klines.map((bar) => ({
    time: Number(bar[0]) / 1_000,
    open: Number(bar[1]),
    high: Number(bar[2]),
    low: Number(bar[3]),
    close: Number(bar[4]),
    volume: Number(bar[5]),
  })),
}, {
  modelRegistry,
  providerId: "live-smoke-provider",
});

const primary = result.theoryResult.structures.primaryCandidate;
console.log(JSON.stringify({
  marketId: result.snapshot.marketId,
  candleCount: klines.length,
  rangeCount: result.theoryResult.statistics.rangeCount,
  candidateCount: result.theoryResult.statistics.candidateCount,
  eventCount: result.theoryResult.statistics.eventCount,
  primaryPattern: primary?.pattern,
  primaryPhase: result.theoryResult.statistics.primaryPhase,
  primaryStatus: primary?.status,
  support: primary?.range.support,
  resistance: primary?.range.resistance,
  eventCodes: primary?.events.map((event) => event.code),
  drawingOperations: result.analysisPlan.drawingPatch.operations.length,
  actionPlan: result.analysisPlan.actionPlan,
  drawingLayer: result.analysisPlan.drawingPatch.operations[0]?.drawing.layer,
  colorTokens: [...new Set(result.analysisPlan.drawingPatch.operations.map(({ drawing }) => drawing.colorToken))],
}, null, 2));
