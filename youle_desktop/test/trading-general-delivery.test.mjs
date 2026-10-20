import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { tradingAnalysisCompletionText } from "../src/renderer/cloud-analysis-text.ts";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const runner = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runTradingGeneralChartRequest");
const javascript = ts.transpileModule(runner.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ failure = false } = {}) {
  const reports = [], persisted = [], requests = [];
  const noop = () => {};
  const deps = {
    tradingAnalysisCompletionText,
    beginTradingExpertAnalysisJob: () => "analysis-1",
    resolveTradingExpertAnalysisThreadId: id => id,
    clearTradingExpertThinkingState: () => false,
    updateTradingExpertThinkingState: noop,
    appendTradingExpertProgress: (thread, id, phase, text) => ({ id, phase, text }),
    runTradingExpertGeneralConversation: async request => {
      requests.push(request);
      if (failure) throw new Error("unavailable");
      return { report: "The rally requires a confirmed close above resistance.", symbol: "BTCUSDT",
        modelName: "fixture", candleCount: 100, cloudReports: [{ planRecords: [{ id: "unrequested-plan" }] }] };
    },
    selectedChatModelValue: () => "fixture",
    threadModelSelection: () => null,
    describeTradingAnalysisFailure: () => ({ summary: "unavailable" }),
    appLanguageLocale: () => "zh-CN",
    persistCompletedTradingExpertTranscript: async (_, items) => { persisted.push(items); return true; },
    appendTradingExpertReport: (thread, text, id, actions, presentation, cloudReports) => {
      const report = { text, presentation, cloudReports };
      reports.push(report);
      return report;
    },
    api: { tradingCloudRecovery: async () => {} },
    codexTradingTools: { isToolTurn: () => false },
    recordTradingRendererFailure: noop,
    isTradingAnalysisCancellation: () => false,
    isTradingAnalysisQuotaFailure: () => false,
    buildTradingAnalysisAvailabilityReport: () => "Data unavailable; cannot explain the rally.",
    appendInsufficientQuotaAgentMessage: noop,
    finishTradingExpertAnalysisJob: noop,
    refreshTradingExpertConversationSurface: noop,
  };
  const run = new Function(...Object.keys(deps), `${javascript}\nreturn runTradingGeneralChartRequest;`)(...Object.values(deps));
  return { run, reports, persisted, requests };
}

test("legacy general success and failure remain plain answers without attached plan records", async () => {
  for (const failure of [false, true]) {
    const h = harness({ failure });
    await h.run("thread", { instruction: "Why did BTC rise?", drawingRequested: false });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].presentation, "plain");
    assert.equal(h.reports[0].cloudReports, undefined);
    assert.ok(h.persisted.flat().includes(h.reports[0]));
  }
});

test("independent general analysis defers delivery to the root's written answer", async () => {
  const h = harness();
  const result = await h.run("thread", { instruction: "Can the rally continue?", drawingRequested: false, deferPresentation: true });
  assert.equal(h.reports.length, 0);
  assert.equal(result.analysisJobId, "analysis-1");
  assert.match(result.report, /confirmed close/);
  assert.equal(h.requests[0].deferPresentation, true);
  assert.match(h.persisted[0].at(-1).text, /等待展示结果/);
  assert.doesNotMatch(h.persisted[0].at(-1).text, /fixture|根 K 线|绘图已完成/);
});
