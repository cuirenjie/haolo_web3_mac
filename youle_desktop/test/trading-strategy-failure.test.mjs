import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { tradingAnalysisCompletionText } from "../src/renderer/cloud-analysis-text.ts";
import { isQuotaFailure } from "../src/main/error-signals.mjs";
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
    tradingAnalysisCompletionText,
    state: { currentThreadId: "thread-one" },
    codexTradingTools: { isToolTurn: () => false },
    isQuotaFailure,
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
    appLanguageLocale: () => language === "en" ? "en-US" : language === "zh-Hant" ? "zh-TW" : language,
    appendInsufficientQuotaAgentMessage: () => { state.quotas++; return { quota: true }; },
    finishTradingExpertAnalysisJob: () => { state.finished++; },
  };
  const run = new Function(...Object.keys(deps), `${javascript}; return runTradingStrategyChartRequest;`)(...Object.values(deps));
  return {
    state,
    run: (id = "wyckoff", name = "威科夫", request = {}) => run("thread-one", {
      id, display: { name }, dataRequirements: { candles: { minCount: 60 } }, capabilities: ["execution-plan"],
      ui: { preparingMessage: `${name}分析`, completionPhase: "complete", completionMetric: () => `${name}分析` },
    }, { instruction: "", drawingRequested: true, ...request }),
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

test("unconfirmed results are persisted as pending, not a failed analysis or a new plan", async () => {
  for (const language of ["zh-CN", "en", "zh-Hant"]) {
    const { state, run } = harness(Object.assign(new Error("query still rate limited"), { code: "CLOUD_RUN_PENDING" }), undefined, language);
    await run("chan", "Chan");
    assert.equal(state.progress.at(-1).phase, "pending");
    assert.equal(state.reports.length, 1);
    assert.equal(state.reports[0].presentation, "plain");
    assert.doesNotMatch(state.reports[0].report, /未完成|未生成|未產生|did not complete|no new execution plan/);
    assert.equal(state.persisted.at(-1).at(-1), state.reports[0]);
    assert.equal(state.generalCalls, 0);
    assert.equal(state.finished, 1);
  }
});

test("cancellation and insufficient credit keep their existing UI and never generate plans", async () => {
  for (const code of ["TRADING_ANALYSIS_CANCELLED", "INSUFFICIENT_BALANCE"]) {
    const { state, run } = harness(Object.assign(new Error("fixture"), { code }));
    await run();
    assert.equal(state.generalCalls, 0);
    assert.equal(state.reports.length, 0);
    assert.equal(state.quotas, code === "INSUFFICIENT_BALANCE" ? 1 : 0);
    assert.equal(state.finished, 1);
  }
});

test("model membership failures render in all three locales without a false insufficient-credit prompt", async () => {
  for (const language of ["zh-CN", "en", "zh-Hant"]) {
    const error = Object.assign(new Error("private detail"), { code: "MODEL_MEMBERSHIP_REQUIRED", status: 403 });
    const { state, run } = harness(error, null, language);
    await run("wave", "Wave");
    assert.equal(state.quotas, 0);
    assert.equal(state.generalCalls, 0);
    assert.equal(state.reports[0].presentation, "plain");
    assert.ok(state.reports[0].report.includes(describeTradingAnalysisFailure(error, { language }).summary));
    assert.doesNotMatch(state.reports[0].report, /private detail|积分不足|點數不足|credits are insufficient/);
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

test("cloud strategy completion never exposes engine IDs, missing candle counts or premature drawing success", async () => {
  for (const language of ["zh-CN", "zh-Hant", "en"]) {
    for (const deferPresentation of [false, true]) {
      const h = harness(null, { report: "verified plan", symbol: "ETHUSDT",
        candleCount: 0, modelName: "price-action-ohlc-engine-v1" }, language);
      await h.run("price-action", "裸K分析", { deferPresentation });
      const message = h.state.progress.at(-1).message;
      assert.ok(message.includes("ETHUSDT"));
      assert.doesNotMatch(message, /engine-v1|0 根|分析分析|0 candles/);
      if (deferPresentation) {
        assert.doesNotMatch(message, /绘图已完成|繪圖已完成|chart drawing are complete/);
        assert.match(message, /等待展示|ready to present/);
        assert.equal(h.state.reports.length, 0);
      }
      if (language === "en") assert.doesNotMatch(message, /\p{Script=Han}/u);
      if (language === "zh-Hant") assert.doesNotMatch(message, /结果|绘图/);
    }
  }
});
