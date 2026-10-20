import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/renderer/codex-trading-tools.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const released = [], resolved = [], calls = [];
  let live = { marketId: "BINANCE:FUTURES:BTCUSDT", symbol: "BTCUSDT", interval: "60" };
  let chart = { marketId: live.marketId, candles: [{ time: 1, close: 100 }] };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto, structuredClone, AbortController, require: () => ({
    captureTradingExpertAnalysisTarget: () => live,
    tradingExpertAlertContextSnapshot: () => chart,
    releaseTradingExpertAnalysisTarget: target => released.push(target),
    rebindTradingExpertAnalysisTargetStorageSession: (target, storageSessionId) => target ? { ...target, storageSessionId } : null,
  }) });
  const deps = {
    api: { resolveBusinessTool: value => resolved.push(value) },
    catalog: async () => [{ id: "chan", display: { name: "缠论" } }, { id: "personal-example", display: { name: "个人规则" } }],
    pending: () => ({ alert: { stage: "confirmation" } }),
    analyze: async (...args) => { calls.push(["analyze", ...args]); return { analysisJobId: "job-1" }; },
    alert: async (...args) => { calls.push(["alert", ...args]); },
    personalStrategy: async (...args) => { calls.push(["personal", ...args]); },
    preferences: async (...args) => { calls.push(["preferences", ...args]); },
    cancel: async (...args) => { calls.push(["cancel", ...args]); },
  };
  const tools = new exports.CodexTradingTools(deps);
  return { tools, deps, released, resolved, calls, switchChart() {
    live = { marketId: "BINANCE:FUTURES:ETHUSDT", symbol: "ETHUSDT", interval: "240" };
    chart.candles[0].close = 999;
    chart = { marketId: live.marketId, candles: [] };
  } };
}

const call = (contextId, action, extra = {}) => ({
  requestId: crypto.randomUUID(), contextId, threadId: "origin",
  userText: "按刚才确认的规则创建", arguments: { action, ...extra },
});

test("chart, simulation candles, attachments and actual confirmation stay with the originating message", async () => {
  const h = harness(), id = h.tools.capture([{ path: "uploading.pdf" }]);
  h.switchChart();
  h.tools.updateAttachments(id, [{ path: "ready.pdf" }]);
  await h.tools.handle(call(id, "context"));
  assert.equal(h.resolved.at(-1).result.chart.symbol, "BTCUSDT");
  assert.equal(h.resolved.at(-1).result.pending.alert.stage, "confirmation");
  await h.tools.handle(call(id, "analyze", { positionManagementRequested: true, drawingRequested: false }));
  assert.equal(h.calls.at(-1)[2].positionManagementRequested, true);
  assert.equal(h.calls.at(-1)[3].storageSessionId, "origin");
  assert.equal(h.calls.at(-1)[3].symbol, "BTCUSDT");
  await h.tools.handle(call(id, "personal_strategy", { instruction: "模型伪造的确认" }));
  assert.equal(h.calls.at(-1)[2], "按刚才确认的规则创建");
  assert.equal(h.calls.at(-1)[3][0].path, "ready.pdf");
  assert.equal(h.calls.at(-1)[4].chart.candles[0].close, 100);
  await h.tools.handle(call(id, "alert"));
  assert.equal(h.calls.at(-1)[3].chart.marketId, "BINANCE:FUTURES:BTCUSDT");
});

test("automatic retry retains the captured target until recovery and root turn both finish", async () => {
  const h = harness(), id = h.tools.capture();
  h.tools.hold(id);
  await h.tools.handle({ release: true, contextId: id });
  h.switchChart();
  await h.tools.handle(call(id, "context"));
  assert.equal(h.resolved.at(-1).result.chart.symbol, "BTCUSDT");
  assert.equal(h.released.length, 0);
  h.tools.unhold(id);
  assert.equal(h.released.length, 1);
  h.tools.release(id);
  assert.equal(h.released.length, 1);
});

test("workflow presentation acknowledges only after the existing transcript persistence completes", async () => {
  const h = harness();
  let persist;
  h.deps.completed = async (threadId, item, durable) => {
    assert.equal(threadId, "original");
    assert.equal(item.id, "tool-result");
    assert.equal(durable, true);
    await new Promise(resolve => { persist = resolve; });
  };
  const pending = h.tools.handle({ presentation: true, requestId: "receipt", threadId: "original", item: { id: "tool-result" }, persist: true });
  assert.equal(h.resolved.length, 0);
  persist();
  await pending;
  assert.equal(h.resolved[0].requestId, "receipt");
  assert.equal(h.resolved[0].result, true);
});

test("catalog includes personal strategies and missing chart never borrows the active conversation", async () => {
  const h = harness(), id = h.tools.capture([], null);
  await h.tools.handle(call(id, "catalog"));
  assert.deepEqual(Array.from(h.resolved.at(-1).result.strategies, s => s.id), ["chan", "personal-example"]);
  await h.tools.handle(call(id, "analyze"));
  assert.match(h.resolved.at(-1).error, /No chart/);
  await h.tools.handle(call(id, "analyze", { marketId: "BINANCE:SPOT:ETHUSDT", symbol: "ETHUSDT" }));
  assert.equal(h.calls.at(-1)[3], null);
  assert.equal(h.calls.at(-1)[2].marketId, "BINANCE:SPOT:ETHUSDT");
});

test("native cards return inside the MCP result; failures and cancellation reach the existing runner", async () => {
  const h = harness(), id = h.tools.capture();
  let finish;
  h.deps.analyze = async () => {
    h.tools.collect("origin", [{ id: "report", type: "agentMessage", text: "report" }]);
    await new Promise(resolve => { finish = resolve; });
    return { analysisJobId: "job" };
  };
  const request = call(id, "analyze"), pending = h.tools.handle(request);
  await h.tools.handle({ cancel: true, requestId: request.requestId, threadId: "origin" });
  assert.equal(h.calls.at(-1)[0], "cancel");
  finish();
  await pending;
  assert.equal(h.resolved.at(-1).result.presentationItems[0].id, "report");
  assert.equal(h.tools.isToolTurn("origin"), false);
  h.deps.analyze = async () => { throw new Error("cloud unavailable"); };
  await h.tools.handle(call(id, "analyze"));
  assert.match(h.resolved.at(-1).error, /cloud unavailable/);
  assert.equal(h.tools.isToolTurn("origin"), false);
});

function functionText(file, name) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
}

test("detached chart analysis preserves explicit spot market, position mode and Drawing Gateway ownership", async () => {
  const params = [], patches = [];
  const jobs = { start: x => ({ ...x, analysisId: "analysis" }), isActive: () => true, complete() {}, fail() {} };
  const fn = functionText("../src/renderer/trading-expert-market.ts", "runTradingExpertDetachedConversation");
  const code = ts.transpileModule(fn.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const response = { ok: true, analysisPlan: { report: "position answer", drawingPatch: { marketId: "BINANCE:SPOT:ETHUSDT", interval: "15" } }, snapshot: { candles: [] } };
  const ctx = {
    window: { codexDesktop: { runTradingGeneralAnalysis: async p => { params.push(p); return response; } } },
    selectTradingAnalysisInterval: p => p.interval || "60", tradingViewResolutionDurationMs: () => 900000,
    tradingAnalysisJobs: jobs, activeTradingAnalysisLanguage: () => "en-US",
    cloudAnalysisText: () => "submit", cloudAnalysisWindow: () => ({ analysisWindowCount: 100 }),
    cloudReportFromResponse: () => [], tradingAnalysisModelDisplayName: () => "model",
    settleTradingAnalysisDrawing: async p => { await p.commit(); return { drawingDeferred: false }; },
    commitTradingAnalysisDrawingPatch: async (job, patch) => patches.push({ job, patch }),
    commitTradingIndicatorAnalysisDrawingPatch: async () => {},
    rememberTradingAnalysisJobContext() {}, recordTradingRendererFailure() {},
  };
  vm.runInNewContext(`${code}\nthis.run = runTradingExpertDetachedConversation;`, ctx);
  const result = await ctx.run({
    marketId: "BINANCE:SPOT:ETHUSDT", interval: "15", sourceThreadId: "original",
    positionManagementRequested: true, drawingRequested: true, instruction: "减仓并画线",
  });
  assert.equal(params[0].marketId, "BINANCE:SPOT:ETHUSDT");
  assert.equal(params[0].storageSessionId, "original");
  assert.equal(params[0].responseMode, "direct");
  assert.equal(patches[0].job.storageSessionId, "original");
  assert.equal(result.report, "position answer");
  const deferred = await ctx.run({
    marketId: "BINANCE:SPOT:ETHUSDT", interval: "15", sourceThreadId: "original",
    drawingRequested: true, deferPresentation: true, instruction: "analyze",
  });
  assert.equal(patches.length, 1, "analysis-only must not commit a patch");
  assert.equal(deferred.drawingArtifacts[0].drawingPatch, response.analysisPlan.drawingPatch);
  assert.equal(deferred.drawingArtifacts[0].job.storageSessionId, "original");
  await assert.rejects(ctx.run({ sourceThreadId: "original", symbol: "unknown" }), /Specify/);
});

test("separate drawing reuses frozen pane patches, rejects foreign conversation and honors cancellation", async () => {
  const fn=functionText("../src/renderer/trading-expert-market.ts","applyDeferredTradingDrawings");
  const code=ts.transpileModule(fn.replace("export ",""),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const calls=[]; let active=true, completed=false;
  const ctx={tradingAnalysisJobs:{start:x=>x,isActive:()=>active,complete:()=>{completed=true;},fail:()=>{}},
    commitTradingAnalysisDrawingPatch:async(job,patch,pane)=>calls.push({job,patch,pane}),
    commitTradingIndicatorAnalysisDrawingPatch:async(job,patch,pane)=>calls.push({job,patch,pane}),
    rememberTradingAnalysisJobContext(){}};
  vm.runInNewContext(`${code}\nthis.run=applyDeferredTradingDrawings;`,ctx);
  const artifacts=[{job:{storageSessionId:"origin",marketId:"BTC"},paneIndex:0,drawingPatch:{price:123}},
    {job:{storageSessionId:"origin",marketId:"BTC"},paneIndex:2,indicatorDrawingPatch:{price:456}}];
  await ctx.run(artifacts,"origin","draw-1");
  assert.equal(calls[1].pane,2);assert.equal(calls[0].patch.price,123);assert.equal(completed,true);
  await assert.rejects(ctx.run(artifacts,"foreign","draw-2"),/another conversation/);
  active=false;completed=false;
  await assert.rejects(ctx.run(artifacts,"origin","draw-3"),/cancelled/);
  assert.equal(calls.length,2);assert.equal(completed,false);
});

test("analysis-only returns artifacts without presenting cards; present consumes host result with original position mode", async () => {
  const h=harness(),id=h.tools.capture();let count=0;
  h.deps.analyze=async (_thread,args)=>{assert.equal(args.deferPresentation,true);return {report:"hold",drawingArtifacts:[]};};
  h.deps.present=async(thread,artifact,metadata)=>{count++;assert.equal(artifact.result.report,"hold");assert.equal(metadata.positionManagementRequested,true);
    h.tools.collect(thread,[{id:"position",type:"agentMessage",text:"hold",__youleExecutionPlanPresentation:"position-plan"}]);};
  await h.tools.handle(call(id,"analyze_only"));
  const artifact=h.resolved.at(-1).result;
  assert.equal(artifact.presentationItems.length,0);assert.equal(count,0);
  await h.tools.handle(call(id,"present",{artifact,metadata:{positionManagementRequested:true}}));
  assert.equal(count,1);assert.equal(h.resolved.at(-1).result.presentationItems[0].__youleExecutionPlanPresentation,"position-plan");
});

test("personal strategy uses real captured candles or fetches the explicit market, never empty synthetic prices", async () => {
  const fn = functionText("../src/main/main.mjs", "runPersonalStrategyRequest"), evaluations = [], fetched = [];
  const ctx = {
    personalStrategyOwner: async () => "owner", personalStrategyRecord: async () => ({ spec: {}, version: 1 }),
    tradingAutomationFetchCandles: async (...args) => { fetched.push(args); return [{ close: 101 }, { close: 102 }]; },
    evaluatePersonalStrategy: (_spec, candles) => { evaluations.push(candles); return { snapshot: {}, ok: true }; },
    tradingAnalysisAbortError: message => new Error(message), crypto,
  };
  vm.runInNewContext(`${fn}\nthis.run = runPersonalStrategyRequest;`, ctx);
  await ctx.run("personal-demo", { marketId: "BINANCE:SPOT:ETHUSDT", interval: "15" });
  assert.equal(fetched[0][0].marketType, "spot");
  assert.equal(fetched[0][0].symbol, "ETHUSDT");
  assert.equal(evaluations[0][0].close, 101);
  await ctx.run("personal-demo", { marketId: "OTHER:MARKET", candles: [{ close: 7 }, { close: 8 }] });
  assert.equal(evaluations[1][0].close, 7);
  assert.equal(fetched.length, 1);
  await assert.rejects(ctx.run("personal-demo", { marketId: "OTHER:MARKET" }), /captured market/);
});
