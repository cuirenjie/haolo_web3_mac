import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexBusinessTools } from "../src/main/codex-business-tools.mjs";
import { CodexTradingArtifacts } from "../src/main/codex-trading-artifacts.mjs";
import { tradingCapabilityArguments } from "../src/main/codex-trading-capabilities.mjs";
import { explicitNoDrawingRequested } from "../src/main/trading-analysis/user-constraints.mjs";

function harness(artifacts) {
  let owner = "account-a";
  let accountReads = 0;
  const calls = [], client = {}, sender = { id: 7, isDestroyed: () => false };
  const result = { result: { report: "verified", analysisJobId: "run-1", marketId: "BINANCE:FUTURES:BTCUSDT",
    drawingArtifacts: [{ drawingPatch: { price: 123 } }] }, presentationItems: [] };
  const broker = new CodexBusinessTools({ artifacts, owner: () => owner, accountRead: async () => { accountReads++; return { available: false }; },
    dispatch: (sender, payload) => { calls.push(payload); if (!payload.release && !payload.cancel) {
      queueMicrotask(() => broker.resolve(sender, { requestId: payload.requestId, result: payload.arguments.action === "analyze_only" ? result
        : { result: { analysisJobId: "run-1" }, presentationItems: [{ id: "card", type: "agentMessage", text: "verified" }] } }));
    } } });
  let context;
  const bind = (thread = "root", visible = "visible") => context = broker.bind(thread, {client, sender, visibleThreadId: visible, contextId: "captured", userText: "analyze BTC"});
  bind();
  return { calls, broker, result, bind, get accountReads() { return accountReads; }, owner: value => { owner = value; },
    call: (tool, args = {}) => broker.invokeBound({ tool, arguments: { ...args, context_id: context.token } }) };
}

test("separate account -> analysis -> drawings -> plan uses one verified result and deduplicates effects", async () => {
  const h = harness();
  const automatic = await h.call("haolo_analysis", {strategyId:"price-action"});
  assert.equal(h.accountReads, 1, "missing account context is refreshed before analysis");
  assert.equal((await h.call("haolo_account_read")).available, false);
  const {analysisRef} = await h.call("haolo_analysis", {strategyId:"price-action"});
  assert.equal(analysisRef, automatic.analysisRef);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].arguments.deferPresentation, undefined);
  await h.call("haolo_chart_draw", {analysisRef});
  await h.call("haolo_plan_present", {analysisRef});
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[1].arguments.artifact.result.drawingArtifacts[0].drawingPatch.price, 123);
  h.broker.cancel("root"); h.bind();
  await h.call("haolo_plan_present", {analysisRef});
  assert.equal(h.calls.filter(c=>c.arguments?.action==="present").length, 1);
});

test("artifact references survive restart, preserve values, and reject foreign accounts/conversations", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-trading-artifacts-"));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  let h = harness(new CodexTradingArtifacts({directory}));
  await h.call("haolo_account_read");
  const {analysisRef} = await h.call("haolo_analysis", {analysisKind:"strategy",drawingRequested:false});
  h = harness(new CodexTradingArtifacts({directory}));
  await assert.rejects(h.call("haolo_chart_draw",{analysisRef}), /disabled drawing/);
  await h.call("haolo_plan_present",{analysisRef});
  h.bind("other-root", "other-visible");
  await assert.rejects(h.call("haolo_plan_present",{analysisRef}), /unavailable/);
  h.owner("account-b");h.bind();
  await assert.rejects(h.call("haolo_plan_present",{analysisRef}), /unavailable/);
});

test("models cannot supply replacement artifacts, account IDs, arbitrary operations or malformed references", async () => {
  const h=harness();
  for(const args of [{analysisRef:"../../secret"},{analysisRef:"abc",artifact:{}},{analysisRef:"abc",owner:"account-b"}]) {
    await assert.rejects(h.call("haolo_plan_present",args), /Invalid|Unexpected/);
  }
  assert.throws(()=>tradingCapabilityArguments("haolo_market",{operation:"execute"}),/Invalid/);
  assert.throws(()=>tradingCapabilityArguments("haolo_account_read",{sections:["credentials"]}),/Invalid/);
  assert.throws(()=>tradingCapabilityArguments("haolo_analysis",{lookbackMs:NaN}),/Invalid/);
  assert.equal(h.calls.length,0);
});

test("account switch rejects the old read and a new context requires its own account refresh", async () => {
  const h=harness();let resolve;
  h.broker.accountRead=()=>new Promise(r=>{resolve=r;});
  const reading=h.call("haolo_account_read");h.owner("account-b");resolve({});
  await assert.rejects(reading,/expired/);
  assert.equal(h.calls.length, 0, "the old account must not dispatch analysis");
  h.bind();
  let refreshed = false;
  h.broker.accountRead = async () => { refreshed = true; return {available:false}; };
  await h.call("haolo_analysis");
  assert.equal(refreshed, true);
  assert.equal(h.calls.filter(c => c.arguments?.action === "analyze_only").length, 1);
});

test("explicit strategy and no-drawing choices cannot be replaced by model arguments; positions default to price action",async()=>{
  const h=harness();
  let context=h.bind();
  context.userText="@策略:缠论 分析BTC，不要画线";
  await h.call("haolo_account_read");
  await assert.rejects(h.call("haolo_analysis",{strategyId:"wave"}),/explicitly selected/);
  const {analysisRef}=await h.call("haolo_analysis",{drawingRequested:true});
  const request=h.calls.find(c=>c.arguments?.action==="analyze_only").arguments;
  assert.equal(request.strategyId,"chan");
  assert.equal(request.drawingRequested,false);
  await assert.rejects(h.call("haolo_chart_draw",{analysisRef}),/disabled drawing/);
  context=h.bind();context.userText="分析如何调整我的仓位";
  await h.call("haolo_account_read");
  await h.call("haolo_analysis",{positionManagementRequested:true});
  assert.equal(h.calls.filter(c=>c.arguments?.action==="analyze_only").at(-1).arguments.strategyId,"price-action");
});

test("failed cloud analysis does not produce a drawable or presentable reference",async()=>{
  const h=harness();
  h.result.result=null;
  h.result.presentationItems=[{id:"failed",text:"Missing market data"}];
  await h.call("haolo_account_read");
  const failed=await h.call("haolo_analysis");
  assert.equal(failed.status,"analysis-unavailable");
  assert.equal(failed.analysisRef,undefined);
  assert.equal(failed.presentationItems[0].text,"Missing market data");
});

test("分别画线 and 特别标注 are affirmative instructions, while explicit prohibitions remain enforced", async () => {
  for (const text of ["分别画线和展示计划", "分别绘图", "特别标注关键支撑", "识别画线中的形态"]) {
    assert.equal(explicitNoDrawingRequested(text), false, text);
  }
  for (const text of ["别画线", "分析BTC，别画线", "请别标注", "你别画线", "先别画图", "不要画线", "不用绘图", "do not draw"]) {
    assert.equal(explicitNoDrawingRequested(text), true, text);
  }
  const h = harness();
  h.bind().userText = "@裸K @MACD 分别分析 BTCUSDT 永续 1 小时，分别画线和展示计划，再比较结论。";
  await h.call("haolo_account_read");
  for (const strategyId of ["price-action", "macd-analysis"]) {
    const { analysisRef } = await h.call("haolo_analysis", { strategyId, drawingRequested: true });
    await h.call("haolo_chart_draw", { analysisRef });
  }
  assert.equal(h.calls.filter(c => c.arguments?.action === "draw").length, 2);
});

test("fresh Codex roots discover only the same visible conversation's last business result", async () => {
  const h = harness();
  h.bind("first-root", "channel");
  await h.call("haolo_account_read");
  const { analysisRef } = await h.call("haolo_analysis", { strategyId: "price-action" });
  h.broker.cancel("first-root");
  h.bind("fresh-root", "channel");
  const context = await h.call("haolo_market", { operation: "context" });
  assert.equal(context.latestAnalysis.analysisRef, analysisRef);
  assert.equal(context.latestAnalysis.strategyId, "price-action");
  await h.call("haolo_plan_present", { analysisRef });
  h.bind("other-root", "other-channel");
  assert.equal((await h.call("haolo_market", { operation: "context" })).latestAnalysis, null);
  await assert.rejects(h.call("haolo_plan_present", { analysisRef }), /unavailable/);
});

test("native delivery never suppresses the root answer, including cached and selected-model replies", async () => {
  const h = harness();
  await h.call("haolo_account_read");
  const { analysisRef } = await h.call("haolo_analysis", { analysisKind: "strategy" });
  const mixed = await h.call("haolo_plan_present", { analysisRef, hasRemainingWork: true });
  assert.equal(h.calls.at(-1).arguments.metadata.hasRemainingWork, true);
  assert.equal(mixed.presentationItems[0].__youleNativeResponseComplete, false);
  h.broker.cancel("root"); h.bind();
  const complete = await h.call("haolo_plan_present", { analysisRef });
  assert.equal(complete.presentationItems[0].__youleNativeResponseComplete, false);
  assert.equal(complete.answerRequired, true);
  assert.equal(mixed.presentationItems[0].__youleNativeResponseComplete, false, "cached response adaptation must not mutate earlier delivery");
  assert.equal(h.calls.filter(c => c.arguments?.action === "present").length, 1, "never repeat the cloud analysis or card effect");
  h.broker.cancel("root");
  h.bind().selectedModel = async () => ({ text: "external model answer" });
  const external = await h.call("haolo_plan_present", { analysisRef });
  assert.equal(external.presentationItems[0].__youleNativeResponseComplete, false, "explicit external-model answer still needs delivery");
  assert.throws(() => tradingCapabilityArguments("haolo_plan_present", { analysisRef, hasRemainingWork: "true" }), /Invalid/);
});

test("ordinary market analysis defaults to an answer, not automatic drawings or a plan", async () => {
  const h = harness();
  h.bind().userText = "现在比特币怎么突然涨了，还能继续涨吗";
  await h.call("haolo_account_read");
  const analysis = await h.call("haolo_analysis");
  const request = h.calls.at(-1).arguments;
  assert.equal(request.analysisKind, "general");
  assert.equal(request.strategyId, undefined);
  assert.equal(request.drawingRequested, false);
  assert.equal(analysis.result.report, "verified");
  assert.deepEqual(analysis.next, []);
  assert.match(analysis.delivery, /final text/);
  await assert.rejects(h.call("haolo_plan_present", { analysisRef: analysis.analysisRef }), /general market analysis/);
  await assert.rejects(h.call("haolo_chart_draw", { analysisRef: analysis.analysisRef }), /disabled drawing/);
  assert.equal(h.calls.filter(c => c.arguments?.action === "present").length, 0);
  const context = await h.call("haolo_market", { operation: "context" });
  assert.equal(context.latestAnalysis.analysisKind, "general");
});

test("general explanation may request a drawing without becoming a plan, including after restart", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-market-explanation-"));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  let h = harness(new CodexTradingArtifacts({directory}));
  h.bind().userText = "解释这次上涨，并标出关键位置";
  await h.call("haolo_account_read");
  const analysis = await h.call("haolo_analysis", { analysisKind: "general", drawingRequested: true });
  assert.deepEqual(analysis.next, ["haolo_chart_draw"]);
  await h.call("haolo_chart_draw", { analysisRef: analysis.analysisRef });
  h = harness(new CodexTradingArtifacts({directory}));
  await assert.rejects(h.call("haolo_plan_present", { analysisRef: analysis.analysisRef }), /general market analysis/);
  assert.equal(h.calls.length, 0);
});

test("explicit plans retain native presentation while positions require a written assessment", async () => {
  for (const args of [{ analysisKind: "strategy" }, { positionManagementRequested: true }]) {
    const h = harness();
    h.bind().userText = args.positionManagementRequested ? "分析我的仓位怎么调整" : "给我一个交易计划";
    await h.call("haolo_account_read");
    const analysis = await h.call("haolo_analysis", args);
    assert.equal(analysis.analysisKind, "strategy");
    assert.equal(h.calls.at(-1).arguments.strategyId, "price-action");
    assert.deepEqual(analysis.next, args.positionManagementRequested ? ["haolo_chart_draw"] : ["haolo_chart_draw", "haolo_plan_present"]);
    if (args.positionManagementRequested) {
      assert.equal(analysis.positionReview.accountStatus, "unavailable");
      await assert.rejects(h.call("haolo_plan_present", { analysisRef: analysis.analysisRef }), /not a completed position plan/);
    } else {
      const result = await h.call("haolo_plan_present", { analysisRef: analysis.analysisRef });
      assert.equal(result.presentationItems.length, 1);
      assert.equal(result.presentationItems[0].__youleNativeResponseComplete, false);
    }
  }
});

test("general and strategy modes cannot silently override explicit strategies or positions", async () => {
  const h = harness();
  await h.call("haolo_account_read");
  for (const args of [
    { analysisKind: "general", strategyId: "price-action" },
    { analysisKind: "general", positionManagementRequested: true },
  ]) await assert.rejects(h.call("haolo_analysis", args), /General market analysis must omit/);
  h.bind().userText = "@策略:缠论 分析BTC";
  await h.call("haolo_account_read");
  await assert.rejects(h.call("haolo_analysis", { analysisKind: "general" }), /explicitly requested strategy/);
  assert.equal(h.calls.filter(c => c.arguments?.action === "analyze_only").length, 0);
  assert.throws(() => tradingCapabilityArguments("haolo_analysis", { analysisKind: "guess" }), /Invalid/);
});
