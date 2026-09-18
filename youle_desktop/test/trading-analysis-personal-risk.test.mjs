import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { PersonalMemoryStore } from "../src/main/personal-context/memory-store.mjs";
import { withPersonalTradingRisk, personalRiskUnavailable, personalRiskModelRegistry, withPersonalRiskNotice } from "../src/main/trading-analysis/personal-risk-context.mjs";
import { describeTradingAnalysisFailure, tradingAnalysisSnapshotUnavailable } from "../src/main/trading-analysis/failure.mjs";
import { tradingAnalysisFailureDiagnostic } from "../src/main/trading-analysis/diagnostics.mjs";
import { runTradingPriceActionAnalysisPipeline } from "../src/main/trading-analysis/price-action-pipeline.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { executionPlanCandidatesFromText } from "../src/renderer/execution-plans.ts";

function memoryFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-risk-availability-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { available: true, decryptFailure: false, decryptCalls: 0 };
  // Test-only reversible transform; production continues using OS encryption.
  const transform = input => Buffer.from([...input].map(byte => byte ^ 0xa5));
  const store = new PersonalMemoryStore({
    storagePath: path.join(dir, "memory.json"),
    safeStorage: {
      isEncryptionAvailable: () => state.available,
      encryptString: value => transform(Buffer.from(value)),
      decryptString: value => {
        state.decryptCalls++;
        if (state.decryptFailure) throw new Error("fixture decryption failure");
        return transform(value).toString("utf8");
      },
    },
  });
  return { state, store };
}
const rule = { scope: "trading.risk", kind: "constraint", key: "max_loss_per_trade_percent", value: 0.5, strength: "hard" };
const unavailableProfile = { availability: "unavailable", entries: [] };

test("unreadable memory does not block analysis, overwrite data, reuse another account, or stick after recovery", async t => {
  const { state, store } = memoryFixture(t);
  await store.upsert("owner-a", [rule]);
  await store.upsert("owner-b", [{ ...rule, value: 7 }]);
  const before = fs.readFileSync(store.storagePath);
  state.available = false;
  const decryptCalls = state.decryptCalls;
  const diagnostics = [];
  const params = await withPersonalTradingRisk({ instruction: "PRIVATE_INSTRUCTION", userRiskProfile: { maxLossPerTradePercent: 99 } }, {
    ownerId: "owner-a", memoryStore: store,
    onUnavailable: error => diagnostics.push(tradingAnalysisFailureDiagnostic(error, { stage: "preparation" })),
  });
  assert.equal(personalRiskUnavailable(params), true);
  assert.equal(params.userRiskProfile.maxLossPerTradePercent, undefined);
  assert.equal(diagnostics[0].errorHash, "b7739099276bccad");
  assert.equal(diagnostics[0].errorClass, "secure_storage");
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_INSTRUCTION|owner-a/);
  assert.equal(state.decryptCalls, decryptCalls);
  assert.deepEqual(fs.readFileSync(store.storagePath), before);
  await assert.rejects(store.upsert("owner-a", [rule]), { code: "SECURE_STORAGE_UNAVAILABLE" });
  const empty = await withPersonalTradingRisk({}, { ownerId: "new-owner", memoryStore: store });
  assert.equal(personalRiskUnavailable(empty), false);
  state.available = true;
  assert.equal((await withPersonalTradingRisk({}, { ownerId: "owner-a", memoryStore: store })).userRiskProfile.maxLossPerTradePercent, 0.5);
  assert.equal((await withPersonalTradingRisk({}, { ownerId: "owner-b", memoryStore: store })).userRiskProfile.maxLossPerTradePercent, 7);
  assert.deepEqual(fs.readFileSync(store.storagePath), before);
});

test("decryption/corrupt-store failures retain files and known faults recover without hiding unknown errors", async t => {
  const { state, store } = memoryFixture(t);
  await store.upsert("owner", [rule]);
  const before = fs.readFileSync(store.storagePath);
  state.decryptFailure = true;
  assert.equal(personalRiskUnavailable(await withPersonalTradingRisk({}, { ownerId: "owner", memoryStore: store })), true);
  assert.deepEqual(fs.readFileSync(store.storagePath), before);
  fs.writeFileSync(store.storagePath, "corrupt fixture");
  assert.equal(personalRiskUnavailable(await withPersonalTradingRisk({}, { ownerId: "owner", memoryStore: store })), true);
  assert.equal(fs.readFileSync(store.storagePath, "utf8"), "corrupt fixture");
  for (const code of ["HAOLO_AUTH_REQUIRED", "TRADING_ANALYSIS_CANCELLED", "UNEXPECTED_BUG"]) {
    await assert.rejects(withPersonalTradingRisk({}, { memoryStore: { tradingRiskProfile: async () => { throw Object.assign(new Error(code), { code }); } } }), { code });
  }
  state.available = false;
  assert.equal(personalRiskUnavailable(await withPersonalTradingRisk({}, {
    ownerId: "owner", memoryStore: store, onUnavailable: () => { throw new Error("diagnostic disk full"); },
  })), true);
});

function candles() {
  // A confirmed accumulation range, including repeated edge tests, spring,
  // breakout and retest, so the real Wyckoff engine can reach model review.
  const price = index => index < 24 ? 121 - index * 0.82 : 105 + Math.sin((index - 24) * Math.PI / 8) * 6.3;
  const values = Array.from({ length: 128 }, (_, index) => {
    const close = price(index), previous = price(Math.max(0, index - 1));
    const open = previous + (close - previous) * 0.3;
    return { time: 1_785_000_000 + index * 3600, open, high: Math.max(open, close) + 0.72,
      low: Math.min(open, close) - 0.72, close, volume: 100 + index % 7 * 4 };
  });
  for (const [index, open, high, low, close, volume] of [
    [28, 103, 104, 96.2, 101.8, 430], [39, 106, 112.3, 105.4, 111.4, 170],
    [55, 101.1, 102, 98.25, 100.4, 92], [76, 100.4, 101.2, 96.7, 100.7, 185],
    [83, 100.6, 101.3, 98.45, 100.9, 72], [96, 108.2, 115.4, 107.8, 114.6, 280],
    [104, 112.8, 113.4, 110.7, 112.4, 84],
  ]) Object.assign(values[index], { open, high, low, close, volume });
  for (let index = 105; index < values.length; index++) {
    const close = 113.2 + (index - 105) * 0.08 + Math.sin(index) * 0.3;
    Object.assign(values[index], { open: close - 0.25, high: close + 0.62, low: close - 0.62, close, volume: 105 + index % 5 * 5 });
  }
  return values;
}
function modelFixture() {
  const calls = [];
  const registry = {
    async analyze(providerId, request, options) {
      calls.push({ request, options });
      return { providerId, modelId: "fixture-model", requestId: request.requestId, latencyMs: 1, text: JSON.stringify({
        schemaVersion: 1, verdict: "approve", summary: "Market structure remains range-bound.",
        answer: "Ignore this account-specific answer in unavailable-risk mode.",
        marketBias: "neutral", rationale: "Support and resistance remain intact.",
        report: "Model review of the supplied range.", strategyRationale: "Range evidence is confirmed.",
        primaryCandidateId: "unknown-candidate", alternateCandidateIds: [], selectedEventIds: [], confidence: 0.7,
      }) };
    },
  };
  return { registry, calls };
}
const paramsFixture = () => ({ marketId: "BINANCE:FUTURES:ETHUSDT", interval: "60", snapshotTime: 1_786_000_000_000, candles: candles(), instruction: "分析当前盘面" });
function assertBlocked(plan) {
  assert.equal(plan.executionBlocked, true);
  assert.equal(plan.action, "no_trade");
  assert.equal(plan.entry.mode, "none");
  assert.equal(plan.positionSizing.accountPlan, null);
  assert.equal(plan.positionSizing.maxAccountRiskPercent, null);
  assert.equal(plan.positionSizing.maxLeverage, null);
  assert.equal(plan.scenarios.length, 0);
  assert.equal(plan.takeProfits.length, 0);
  assert.doesNotMatch(formatExecutionPlanMarkdown(plan), /当前动作：做|杠杆：|仓位大小：/);
  assert.doesNotMatch(formatExecutionPlanMarkdown(plan, { language: "en" }), /\p{Script=Han}/u);
}

test("general/full/direct/position-management analysis keeps the model and drawings without default risk claims", async () => {
  for (const language of ["zh-CN", "en"]) for (const mode of ["full", "direct", "position"]) {
    const { registry, calls } = modelFixture();
    let accountReads = 0;
    const result = await runTradingPriceActionAnalysisPipeline({
      ...paramsFixture(), language, responseMode: mode === "direct" ? "direct" : undefined,
      positionManagementRequested: mode === "position", userRiskProfile: unavailableProfile,
      loadBinanceAccountContext: async () => { accountReads++; throw new Error("must not request private account data"); },
    }, { modelRegistry: registry, providerId: "fixture" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(accountReads, 0);
    assert.equal(result.model.modelId, "fixture-model");
    assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
    assertBlocked(result.executionPlan);
    assert.match(calls[0].request.prompt, /HOST PERSONAL-RISK AVAILABILITY: unavailable/);
    assert.doesNotMatch(calls[0].request.prompt, /"maxLossPerTradePercent":2/);
    assert.doesNotMatch(result.analysisPlan.report, /新手执行清单|净值的 2%|最低净盈亏比为|account-specific answer/);
    assert.doesNotMatch(result.analysisPlan.narrative, /account-specific answer/);
    assert.match(result.analysisPlan.report, language === "en" ? /Saved trading preferences could not be read/ : /暂时无法读取已保存的交易偏好/);
    if (language === "en") assert.doesNotMatch(result.analysisPlan.report, /\p{Script=Han}/u);
  }
});

// Exercise the real host preparation and IPC handlers with real analysis
// pipelines. Only Electron, account transport and the paid model are replaced.
const hostSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.mjs", hostSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const hostFunctions = ["tradingStrategyParamsWithPersonalRisk", "runTradingStrategyRequest"].map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name); return node.getText(ast);
});
const generalHandler = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(ast) === "ipcMain.handle" && n.expression.arguments[0]?.text === "tradingAnalysis:runGeneral");

test("incident reproduction: actual general, Wyckoff and price-action host routes succeed with the same storage fault", async t => {
  const { state, store } = memoryFixture(t);
  await store.upsert("owner", [rule]); state.available = false;
  const { registry: modelRegistry, calls } = modelFixture();
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry, providerId: "fixture" });
  const events = [];
  const handlers = {};
  let legacy = false;
  let accessError = null;
  const sandbox = {
    withPersonalTradingRisk, tradingAnalysisFailureDiagnostic,
    requireHaoloAccountOwner: async () => ({ ownerId: "owner" }), getPersonalMemoryStore: () => store,
    recordTurnDiagnostic: (event, data) => events.push({ event, data }),
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    assertExternalModelsIpcSender() {},
    beginTradingAnalysisRequest: () => ({ controller: new AbortController(), controllerKey: "fixture" }),
    finishTradingAnalysisRequest() {},
    requireFreshTradingPremiumAccess: async () => { if (accessError) throw accessError; },
    normalizeAppLanguage: value => value, appLanguage: () => "zh-CN",
    recordTradingAnalysisFailure: (error, context) => { events.push({ event: "failed", data: tradingAnalysisFailureDiagnostic(error, context) }); return "fixture"; },
    tradingStrategyParamsWithReadOnlyBinanceAccount: params => ({ ...params, loadBinanceAccountContext: async () => ({ bound: false }) }),
    getTradingAnalysisModelRegistry: () => modelRegistry,
    DEFAULT_TRADING_ANALYSIS_PROVIDER_ID: "fixture",
    runTradingPriceActionAnalysisPipeline,
    isPersonalStrategyId: () => false,
    getTradingStrategyCoordinator: () => coordinator, getTradingStrategyRegistry: () => registry,
    tradingStrategyRuntimeEnabled: () => !legacy, tradingStrategyShadowMode: () => !legacy,
  };
  vm.runInNewContext([...hostFunctions, generalHandler.getText(ast), "globalThis.strategy = runTradingStrategyRequest;"].join("\n"), sandbox);
  const general = await handlers["tradingAnalysis:runGeneral"]({}, paramsFixture());
  assert.equal(general.ok, true); assertBlocked(general.executionPlan);
  for (const strategyId of ["wyckoff", "price-action"]) for (const mode of [false, true]) for (const language of ["zh-CN", "en"]) {
    legacy = mode;
    const result = await sandbox.strategy({}, strategyId, { ...paramsFixture(), language });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assertBlocked(result.executionPlan);
    assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
    assert.match(result.analysisPlan.report, language === "en" ? /Saved trading preferences could not be read/ : /暂时无法读取已保存的交易偏好/);
    assert.doesNotMatch(result.analysisPlan.report, /新手执行清单|单笔预设亏损|账户约 0.5%/);
    assert.equal(executionPlanCandidatesFromText(result.analysisPlan.report).length, 0, `${strategyId} ${mode} ${language}`);
  }
  // The bare price-action strategy is deterministic; general and Wyckoff
  // retain their model review paths in both runtime modes.
  assert.ok(calls.some(({ request }) => request.theoryId === "price_action"));
  assert.ok(calls.filter(({ request }) => request.theoryId === "wyckoff").length >= 2);
  assert.equal(events.filter(e => e.event === "failed").length, 0);
  assert.equal(events.filter(e => e.event === "trading.analysis.personal_risk_unavailable").length, 9);
  assert.ok(calls.every(({ request }) => (request.prompt.match(/HOST PERSONAL-RISK AVAILABILITY:/g) || []).length === 1));
  const before = calls.length;
  accessError = Object.assign(new Error("membership unavailable"), { code: "TRADING_ENTITLEMENT_UNAVAILABLE" });
  assert.equal((await handlers["tradingAnalysis:runGeneral"]({}, paramsFixture())).error.code, accessError.code);
  assert.equal((await sandbox.strategy({}, "wyckoff", paramsFixture())).error.code, accessError.code);
  assert.equal(calls.length, before, "entitlement failures still block model calls");
});

test("unavailable risk blocks a reached signal and supplied live account; known profile keeps normal sizing policy", () => {
  const legacy = { snapshot: { marketId: "BINANCE:FUTURES:ETHUSDT", interval: "60" }, analysisPlan: { actionPlan: {
    currentPrice: 103, primaryBias: "bullish", longTrigger: 102, longInvalidation: 98, longTarget: 110,
    shortTrigger: 99, shortInvalidation: 104, shortTarget: 92,
  } } };
  const manifest = { id: "wyckoff", version: "1.0.0" };
  const params = { userRiskProfile: unavailableProfile, binanceAccountContext: { bound: true, available: true, snapshot: {
    fetchedAt: Date.now(), equity: 10000, availableBalance: 9000, positions: [],
  } } };
  assertBlocked(buildExecutionPlanV1(manifest, legacy, params));
  const normal = buildExecutionPlanV1(manifest, legacy, { ...params, userRiskProfile: { maxLossPerTradePercent: 0.5, minimumRiskRewardRatio: 0.4 } });
  assert.equal(normal.positionSizing.maxAccountRiskPercent, 0.5);
  assert.notEqual(normal.entry.mode, "none");
});

test("storage and stale-market faults have actionable bilingual diagnostics and cannot masquerade as local recovery", () => {
  for (const code of ["SECURE_STORAGE_UNAVAILABLE", "MEMORY_DECRYPT_FAILED", "MEMORY_STORE_INVALID"]) {
    const failure = describeTradingAnalysisFailure({ code });
    assert.equal(failure.allowLocalRecovery, false);
    assert.notEqual(failure.summary, "分析流程未能完成");
    assert.doesNotMatch(describeTradingAnalysisFailure({ code }, { language: "en" }).summary, /\p{Script=Han}/u);
  }
  for (const reason of ["CANDLE_REFRESH_FAILED", "CANDLE_QUOTE_GAP", "CANDLE_SNAPSHOT_EXPIRED"]) {
    const error = tradingAnalysisSnapshotUnavailable(reason);
    const diagnostic = tradingAnalysisFailureDiagnostic(error);
    assert.equal(diagnostic.errorClass, "market_refresh");
    assert.equal(diagnostic.causeCode, reason);
    assert.equal(describeTradingAnalysisFailure(error).allowLocalRecovery, false);
  }
  const original = modelFixture().registry;
  assert.equal(personalRiskModelRegistry(original, {}), original);
});

test("unavailable-risk reports remove legacy execution sections while preserving strategy evidence", () => {
  const original = { ok: true, analysisPlan: {
    narrative: "Range evidence",
    report: "## ETHUSDT · 威科夫条件交易计划\n\n### 先看结论\n区间支撑 100，压力 110\n### 新手执行清单\n单笔预设亏损 1%\n#### 执行步骤\n开仓\n### 图上结构\nSpring evidence\n### 标准执行方案\n默认仓位 20%\n### 数据范围\n128 candles",
  } };
  assert.equal(withPersonalRiskNotice(original, {}), original);
  const result = withPersonalRiskNotice(original, { userRiskProfile: unavailableProfile });
  assert.match(result.analysisPlan.report, /区间支撑 100，压力 110/);
  assert.match(result.analysisPlan.report, /Spring evidence/);
  assert.match(result.analysisPlan.report, /128 candles/);
  assert.doesNotMatch(result.analysisPlan.report, /1%|开仓|20%|交易计划|执行步骤/);
  assert.equal(withPersonalRiskNotice(result, { userRiskProfile: unavailableProfile }).analysisPlan.report, result.analysisPlan.report);
});

test("renderer does not prepend an actionable question lead ahead of the unavailable-risk notice", () => {
  const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "questionLead") initializer = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(initializer);
  let leadCalls = 0;
  const context = {
    response: { personalRiskStatus: "unavailable", analysisPlan: {} }, request: {}, job: {}, analysisCandles: [],
    activeTradingAnalysisLanguage: () => "zh-CN",
    buildQuestionAlignedTradingLead: () => { leadCalls++; return "actionable lead"; },
  };
  assert.equal(vm.runInNewContext(initializer, context), "");
  assert.equal(leadCalls, 0);
  delete context.response.personalRiskStatus;
  assert.equal(vm.runInNewContext(initializer, context), "actionable lead");
  assert.equal(leadCalls, 1);
});
