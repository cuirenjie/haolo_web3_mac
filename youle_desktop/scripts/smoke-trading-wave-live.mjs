import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runTradingWaveAnalysisPipeline } from "../src/main/trading-analysis/wave-pipeline.mjs";

const execFileAsync = promisify(execFile);
const BINANCE_FUTURES_URL = "https://fapi.binance.com";
const requestedSymbol = String(process.argv[2] || "BTCUSDT").trim().toUpperCase();
const requestedBinanceInterval = String(process.argv[3] || "15m").trim();
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
        summary: "实时 K 线已形成可复核的主计数，末端仍按暂定结构跟踪。",
        report: "烟测复核器只验证模型中立协议，不创建确定性候选之外的浪点。",
        marketBias: "neutral",
        strategyRationale: "以主计数确认位、失效位和后续已收盘 K 线作为条件。",
        primaryCandidateId: "use-deterministic-primary",
        alternateCandidateIds: [],
        showProjectionZone: true,
        confidence: 0.5,
      }),
    };
  },
}]);

const result = await runTradingWaveAnalysisPipeline({
  marketId: `BINANCE:FUTURES:${requestedSymbol}`,
  interval: analysisInterval(requestedBinanceInterval),
  snapshotTime: Date.now(),
  instruction: "真实 K 线波浪理论纵向链路烟测",
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
  candleCount: result.theoryResult.statistics.candleCount,
  swingCount: result.theoryResult.statistics.swingCount,
  candidateCount: result.theoryResult.statistics.candidateCount,
  completeCycleCount: result.theoryResult.statistics.completeCycleCount,
  motiveCount: result.theoryResult.statistics.motiveCount,
  abcCorrectionCount: result.theoryResult.statistics.abcCorrectionCount,
  doubleThreeCount: result.theoryResult.statistics.doubleThreeCount,
  primaryKind: primary?.kind,
  primaryPattern: primary?.pattern,
  primaryDegree: primary?.degree,
  primaryLabels: primary?.labels,
  primaryPoints: primary?.points.map((point) => ({ label: point.label, time: point.time, price: point.price })),
  primaryDirection: primary?.direction,
  primaryStatus: primary?.status,
  primaryRules: primary?.rules,
  drawingOperations: result.analysisPlan.drawingPatch.operations.length,
  actionPlan: result.analysisPlan.actionPlan,
  pathColorTokens: result.analysisPlan.drawingPatch.operations
    .filter(({ drawing }) => drawing.tool === "path")
    .map(({ drawing }) => drawing.colorToken),
  noteLabels: result.analysisPlan.drawingPatch.operations
    .filter(({ drawing }) => drawing.tool === "note")
    .map(({ drawing }) => drawing.text),
  drawingLayer: result.analysisPlan.drawingPatch.operations[0]?.drawing.layer,
}, null, 2));
