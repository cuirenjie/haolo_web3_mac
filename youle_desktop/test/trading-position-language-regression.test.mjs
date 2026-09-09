import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { runTradingPriceActionAnalysisPipeline } from "../src/main/trading-analysis/price-action-pipeline.mjs";

const source = readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "combineTradingAnalysisReports");
const js = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const combine = runInNewContext(`${js}\ncombineTradingAnalysisReports`, { activeTradingAnalysisLanguage: () => "en", HAN_TEXT_PATTERN: /\p{Script=Han}/u });
const answer = "Manage the existing short around resistance; the current structure is bullish.";
function candles() {
  let previous = 62_000;
  return Array.from({ length: 120 }, (_, index) => {
    const open = previous;
    const close = previous + (index < 50 ? 32 : index < 84 ? -20 : 24) + Math.sin(index / 3.2) * 17;
    previous = close;
    return { time: 1_785_000_000 + index * 3600, open, high: Math.max(open, close) + 100, low: Math.min(open, close) - 100, close, volume: 900 + index % 11 * 45 };
  });
}
async function run({ instruction = "Where should I close my BTC short position?", account, modelAnswer = answer } = {}) {
  let prompt;
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", language: "en", snapshotTime: Date.now(),
    instruction, positionManagementRequested: true, responseMode: "direct", candles: candles(),
    ...(account ? { binanceAccountContext: account } : {}),
  }, {
    providerId: "fixture-provider",
    modelRegistry: { async analyze(providerId, request) {
      prompt = request.prompt;
      return { providerId, modelId: "fixture", requestId: request.requestId, text: JSON.stringify({ schemaVersion: 1, verdict: "approve", summary: "The current structure is bullish.", answer: modelAnswer, marketBias: "bullish", rationale: "Support held and the latest swing advanced.", confidence: 0.8 }) };
    } },
  });
  return { result, prompt };
}

for (const [name, account] of [
  ["unbound", null],
  ["unavailable", { bound: true, available: false, snapshot: null }],
  ["no matching position", { bound: true, available: true, snapshot: { fetchedAt: new Date().toISOString(), marginBalance: 20_000, availableBalance: 10_000, positions: [], warnings: [] } }],
  ["existing position", { bound: true, available: true, snapshot: { fetchedAt: new Date().toISOString(), marginBalance: 20_000, availableBalance: 10_000, positions: [{ symbol: "BTCUSDT", direction: "SHORT", leverage: 3, amount: 0.1, notionalValue: 6_000, markPrice: 60_000, entryPrice: 61_000, unrealizedPnl: 100 }], warnings: [] } }],
]) {
  test(`English position answer survives pipeline and renderer with ${name} account`, async () => {
    const { result, prompt } = await run({ account });
    assert.match(prompt, /Write all user-facing answer, summary and rationale fields in English/);
    assert.doesNotMatch(result.analysisPlan.report, /\p{Script=Han}/u);
    assert.doesNotMatch(result.analysisPlan.narrative, /\p{Script=Han}/u);
    const report = combine("BTC/USDT", result.analysisPlan.report, { reports: [], failures: [] }, true);
    assert.ok(report.includes(answer));
    assert.match(report, /Market evidence/);
    assert.doesNotMatch(report, /The market analysis is complete/);
    if (account) assert.match(report, /Account check:/);
    // Private account fields are merged locally after model review.
    assert.doesNotMatch(prompt, /notionalValue|unrealizedPnl|marginBalance/);
  });
}

test("English position fallback is still specific when the model omits an answer", async () => {
  const { result } = await run({ modelAnswer: "" });
  assert.match(result.analysisPlan.report, /existing short/);
  assert.match(result.analysisPlan.report, /resistance near/);
  assert.doesNotMatch(result.analysisPlan.report, /\p{Script=Han}/u);
});

test("a quoted Chinese user question cannot erase the English position answer", async () => {
  const { result } = await run({ instruction: "BTC 空单在哪里平仓？" });
  const report = combine("BTC/USDT", result.analysisPlan.report, { reports: [], failures: [] }, true);
  assert.ok(report.includes(answer));
  assert.ok(report.includes("BTC 空单在哪里平仓？"));
});

test("position reports in auxiliary panes also retain market symbols and quoted text", () => {
  const primary = `Your question: 如何减仓？\n${answer}`;
  const report = combine("BTC", primary, { reports: [{ paneIndex: 1, heading: "Auxiliary", report: "币安人生USDT: support held." }], failures: [] }, true);
  assert.ok(report.includes(answer));
  assert.ok(report.includes("币安人生USDT: support held."));
});
