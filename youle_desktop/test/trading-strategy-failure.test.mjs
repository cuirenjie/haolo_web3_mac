import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildTradingStrategyFailureReport, describeTradingAnalysisFailure } from "../src/main/trading-analysis/failure.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = ["runTradingStrategyChartRequest", "isTradingAnalysisCancellation", "isTradingAnalysisQuotaFailure"];
const javascript = ts.transpileModule(names.map((name) => {
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// Execute the production send orchestration, with only app I/O replaced.
function harness(error, result, language = "zh-CN") {
  const state = { strategyCalls: [], generalCalls: 0, reports: [], persisted: [], progress: [], finished: 0, quotas: 0 };
  const deps = {
    tradingStrategyAnalysisTargetByRequest: new WeakMap(),
    beginTradingExpertAnalysisJob: (_thread, strategy) => `analysis-${strategy}`,
    resolveTradingExpertAnalysisThreadId: (id) => id,
    updateTradingExpertThinkingState() {}, clearTradingExpertThinkingState() {},
    refreshTradingExpertConversationSurface() {}, ensureTradingExpertChartIndicatorVisible() {},
    appendTradingExpertProgress: (_thread, id, phase, message) => {
      const item = { id, phase, message }; state.progress.push(item); return item;
    },
    runTradingExpertStrategyConversation: async (id) => {
      state.strategyCalls.push(id);
      if (error) throw error;
      return result;
    },
    runTradingExpertGeneralConversation: async () => {
      state.generalCalls++;
      return { report: "WRONG PRICE ACTION PLAN", symbol: "BTCUSDT", candleCount: 120, modelName: "fixture" };
    },
    selectedChatModelValue: () => "fixture-model", threadModelSelection: () => null,
    appendTradingExpertReport: (threadId, report, _id, _unused, presentation) => {
      const item = { threadId, report, presentation }; state.reports.push(item); return item;
    },
    persistCompletedTradingExpertTranscript: async (_thread, items) => { state.persisted.push(items); },
    recordTradingRendererFailure() {}, describeTradingAnalysisFailure, buildTradingStrategyFailureReport,
    appLanguageLocale: () => language === "en" ? "en-US" : "zh-CN",
    appendInsufficientQuotaAgentMessage: () => { state.quotas++; return { quota: true }; },
    finishTradingExpertAnalysisJob: () => { state.finished++; },
  };
  const run = new Function(...Object.keys(deps), `${javascript}; return runTradingStrategyChartRequest;`)(...Object.values(deps));
  return {
    state,
    run: (id = "wyckoff", name = "威科夫") => run("thread-one", {
      id, display: { name }, dataRequirements: { candles: { minCount: 60 } }, capabilities: ["execution-plan"],
      ui: { preparingMessage: `${name}分析`, completionPhase: "complete", completionMetric: () => `${name}分析` },
    }, { instruction: "", drawingRequested: true }),
  };
}

test("Wyckoff range exhaustion persists an explicit no-plan result without running another strategy", async () => {
  const error = Object.assign(new Error("untrusted upstream detail"), { code: "TRADING_WYCKOFF_INSUFFICIENT_DATA", candleCount: 600 });
  const { state, run } = harness(error);
  await run();
  assert.deepEqual(state.strategyCalls, ["wyckoff"]);
  assert.equal(state.generalCalls, 0);
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].presentation, "plain");
  assert.match(state.reports[0].report, /^威科夫：已检查 600 根 K 线/);
  assert.match(state.reports[0].report, /本次不生成入场、止损、止盈计划/);
  assert.doesNotMatch(state.reports[0].report, /untrusted|裸K|WRONG/);
  assert.equal(state.persisted[0].at(-1), state.reports[0]);
  assert.equal(state.finished, 1);
});

test("explicit strategy errors never silently change engines or create executable cards", async () => {
  for (const id of ["wyckoff", "chan", "wave", "order-flow", "harmonic", "personal:fixture"]) {
    for (const code of ["TRADING_ANALYSIS_MODEL_TIMEOUT", "TRADING_ANALYSIS_MODEL_REVIEW_INVALID", "TRADING_ENTITLEMENT_UNAVAILABLE", "TRADING_STRATEGY_IMPLEMENTATION_UNAVAILABLE"]) {
      const { state, run } = harness(Object.assign(new Error("private upstream detail"), { code }));
      await run(id, id);
      assert.equal(state.generalCalls, 0, `${id}/${code}`);
      assert.equal(state.reports[0].presentation, "plain");
      assert.ok(state.reports[0].report.startsWith(`${id}：`));
      assert.notEqual(state.progress.at(-1).message, state.reports[0].report);
      assert.equal(state.progress.at(-1).message, describeTradingAnalysisFailure({ code }).summary);
      assert.doesNotMatch(state.reports[0].report, /private upstream/);
      assert.equal(state.finished, 1);
    }
  }
});

test("cancellation and membership errors keep their existing UI and never generate plans", async () => {
  for (const code of ["TRADING_ANALYSIS_CANCELLED", "INSUFFICIENT_BALANCE"]) {
    const { state, run } = harness(Object.assign(new Error("fixture"), { code }));
    await run();
    assert.equal(state.generalCalls, 0);
    assert.equal(state.reports.length, 0);
    assert.equal(state.quotas, code === "INSUFFICIENT_BALANCE" ? 1 : 0);
    assert.equal(state.finished, 1);
  }
});

test("validated strategy reports and deferred drawings keep the original plan and strategy", async () => {
  const report = "## BTC/USDT 币安永续 1H\n策略：威科夫\n方向判断：偏多";
  for (const drawingDeferred of [false, true]) {
    const { state, run } = harness(null, { report, drawingDeferred, modelName: "fixture", symbol: "BTCUSDT" });
    await run();
    assert.equal(state.generalCalls, 0);
    assert.equal(state.reports[0].report, report);
    assert.equal(state.reports[0].presentation, "execution-plan");
    assert.equal(state.finished, 1);
  }
});

test("English no-range reports use fixed copy and reject invalid candle counts", () => {
  for (const candleCount of [undefined, -1, Infinity, "<script>"]) {
    const report = buildTradingStrategyFailureReport({ id: "wyckoff", display: { name: "Wyckoff" } }, {
      code: "TRADING_WYCKOFF_INSUFFICIENT_DATA", candleCount, message: "secret",
    }, { language: "en" });
    assert.match(report, /^Wyckoff: No trading range/);
    assert.doesNotMatch(report, /secret|NaN|Infinity|script|\p{Script=Han}/u);
  }
});
