import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { CodexBusinessTools } from "../src/main/codex-business-tools.mjs";
import { CodexTradingArtifacts } from "../src/main/codex-trading-artifacts.mjs";

const source = fs.readFileSync(new URL("../src/renderer/codex-trading-workflows.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });

function harness(artifacts = new CodexTradingArtifacts()) {
  const calls = [], messages = [], pending = new Map(), client = {};
  let visible = true, approve = true, owner = "a", thread = "visible", serial = 0, context;
  const plan = { id: "plan", runId: "run", version: 3, confirmationHash: "frozen", scenario: { conditionHash: "condition" } };
  const deps = {
    api: {
      tradingAlertsSimulate: async input => { calls.push(["simulate-alert", input]); return { simulation: { simulationId: "sim", confirmation: { confirmationId: "consent" } }, question: "Check this simulation" }; },
      simulatePersonalStrategy: async input => { calls.push(["simulate-personal", input]); return { ok: true, simulation: { simulationId: "psim", report: "Verified" } }; },
      tradingAlertsSnapshot: async () => ({ alerts: [{ alertId: "owned" }] }),
      tradingAlertsPause: async input => { calls.push(["pause", input]); return { paused: true }; },
      tradingAlertsResume: async input => { calls.push(["resume", input]); return { resumed: true }; },
      tradingAlertsDelete: async input => { calls.push(["delete", input]); return { deleted: true }; },
      listPersonalStrategies: async () => ({ ok: true, strategies: [{ id: "mine" }] }),
      tradingCloudPlans: async (action, input) => {
        calls.push([`plan-${action}`, input]);
        if (action === "list") return { ok: true, items: [plan] };
        if (action === "read") return { ok: true, plan: { ...plan } };
        assert.equal(input.version, plan.version);
        assert.equal(input.confirmationHash, "frozen");
        assert.equal(input.conditionHash, "condition");
        plan.version++;
        return { ok: true, plan: { ...plan, saved: true, ...(action === "activate" ? { linkedAlertId: "alert" } : {}) } };
      },
    },
    alertData: response => { if (response.ok === false) throw new Error(response.error.message); return response.ok ? response.data : response; },
    isForeground: () => visible,
    showSimulation: (...args) => calls.push(["draw", ...args]),
    clearSimulation: () => calls.push(["clear"]),
    setPending: (thread, kind, state) => pending.set(`${thread}:${kind}`, state),
    append: async (thread, text) => messages.push({thread,text}),
    prepare: async (thread, kind, text) => {
      calls.push(["prepare", kind, text]);
      return { kind, prepared: true, summary: "Ready", rule: { evaluationPolicy: { anchorContextId: "primary" } },
        pending: { draftId: `draft-${++serial}`, conversation: [{ role: "user", text }] },
        simulationInput: { draftId: `draft-${serial}`, candles: [{ close: 100 }] } };
    },
    confirm: async (thread, kind, text) => {
      calls.push(["confirm", kind, text, pending.get(`${thread}:${kind}`)]);
      return { confirmed: text === "确认" };
    },
    confirmDelete: async () => approve,
    refreshAlerts: async () => calls.push(["refresh-alerts"]),
    refreshPlans: async () => calls.push(["refresh-plans"]),
  };
  const steps = new exports.CodexTradingWorkflowSteps(deps);
  const broker = new CodexBusinessTools({ owner: () => owner, artifacts });
  const bind = (text = "Create a rule", visibleThread = thread) => {
    thread = visibleThread;
    context = broker.bind("root", { client, visibleThreadId: thread, userText: text,
      executeTrading: async args => ({ result: await steps.run(thread, args, text, {}, new AbortController().signal), presentationItems: [] }) });
  };
  bind();
  return { calls, messages, pending, deps, steps, broker, bind, artifacts,
    setVisible: v => {visible=v;}, setApprove: v => {approve=v;}, setOwner: v => {owner=v;},
    call: (tool, args) => broker.invokeBound({tool, arguments:{...args,context_id:context.token}}),
  };
}

test("failed channel simulation capture cannot authorize confirmation", async () => {
  const h = harness();
  h.deps.presentSimulation = async () => false;
  const { draftRef } = await h.call("haolo_alerts", { operation: "prepare" });
  await h.call("haolo_simulation", { draftRef });
  assert.equal((await h.call("haolo_chart_draw", { draftRef })).result.previewed, false);
  h.bind("Please create it");
  await assert.rejects(h.call("haolo_alerts", { operation: "confirm", draftRef }), /Simulate and show/);
  assert.equal(h.calls.some(call => call[0] === "confirm"), false);
});

for (const rejection of [{ cancelled: true }, { needsRevision: true }]) {
  test(`semantic ${Object.keys(rejection)[0]} invalidates the Host draft reference`, async () => {
    const h = harness();
    const { draftRef } = await h.call("haolo_alerts", { operation: "prepare" });
    await h.call("haolo_simulation", { draftRef });
    await h.call("haolo_chart_draw", { draftRef });
    h.deps.confirm = async () => ({ confirmed: false, ...rejection });
    h.bind("Not these conditions");
    assert.equal((await h.call("haolo_alerts", { operation: "confirm", draftRef })).result.confirmed, false);
    h.bind("Go ahead");
    await assert.rejects(h.call("haolo_alerts", { operation: "confirm", draftRef }), /replaced or cancelled/);
  });
}

for (const [tool, kind] of [["haolo_alerts","alert"], ["haolo_personal_strategy","personal"]]) {
  test(`${kind}: prepare -> simulation -> preview -> NEW real reply -> confirmed exactly once`, async () => {
    const h = harness();
    const { draftRef } = await h.call(tool,{operation:"prepare"});
    assert.deepEqual(h.calls.map(c=>c[0]),["prepare"]);
    await assert.rejects(h.call(tool,{operation:"confirm",draftRef}),/Simulate and show/);
    await assert.rejects(h.call("haolo_chart_draw",{draftRef}),/Run haolo_simulation/);
    await h.call("haolo_simulation",{draftRef});
    assert.equal(h.pending.get(`visible:${kind}`),undefined);
    await assert.rejects(h.call(tool,{operation:"confirm",draftRef}),/Simulate and show/);
    await h.call("haolo_chart_draw",{draftRef});
    assert.ok(h.messages[0].text.includes("明确表示接受当前模拟"));
    await assert.rejects(h.call(tool,{operation:"confirm",draftRef}),/new user reply/);
    await assert.rejects(h.call("haolo_trading",{action:kind==="alert"?"alert":"personal_strategy"}),/independent Skill draft/);
    h.bind("改变条件"); // A model calling confirm cannot change the actual reply.
    assert.equal((await h.call(tool,{operation:"confirm",draftRef})).result.confirmed,false);
    h.bind("确认");
    await h.call("haolo_chart_draw",{draftRef}); // redisplay must not consume valid prior consent
    assert.equal((await h.call(tool,{operation:"confirm",draftRef})).result.confirmed,true);
    // Crash after storing the receipt but before clearing the active head.
    await h.artifacts.currentDraft("a","visible",kind,draftRef);
    h.bind("确认");
    assert.equal((await h.call(tool,{operation:"confirm",draftRef})).result.confirmed,true);
    assert.equal(h.calls.filter(c=>c[0]==="confirm"&&c[2]==="确认").length,1);
  });
}

test("revisions, cancellations and failed preparations invalidate old references", async () => {
  const h=harness();
  const {draftRef}=await h.call("haolo_alerts",{operation:"prepare"});
  await h.call("haolo_simulation",{draftRef});await h.call("haolo_chart_draw",{draftRef});
  h.bind("Change threshold");
  const revised=await h.call("haolo_alerts",{operation:"prepare"});
  assert.notEqual(revised.draftRef,draftRef);
  await assert.rejects(h.call("haolo_alerts",{operation:"confirm",draftRef}),/replaced or cancelled/);
  await h.call("haolo_alerts",{operation:"cancel",draftRef:revised.draftRef});
  await assert.rejects(h.call("haolo_simulation",{draftRef:revised.draftRef}),/replaced or cancelled/);
  h.bind("New rule");
  const next=await h.call("haolo_alerts",{operation:"prepare"});
  h.bind("Invalid revision");h.deps.prepare=async()=>{throw new Error("compile failure");};
  await assert.rejects(h.call("haolo_alerts",{operation:"prepare"}),/compile failure/);
  await assert.rejects(h.call("haolo_simulation",{draftRef:next.draftRef}),/replaced or cancelled/);
  assert.equal((await h.call("haolo_alerts",{operation:"cancel"})).result.cancelled,true);
  assert.equal(h.pending.get("visible:alert"),null);
});

test("draft persistence is scoped to account and visible conversation; background preview never authorizes confirmation", async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"haolo-draft-tests-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let h=harness(new CodexTradingArtifacts({directory}));
  const {draftRef}=await h.call("haolo_alerts",{operation:"prepare"});
  await h.call("haolo_simulation",{draftRef});
  h.setVisible(false);
  assert.equal((await h.call("haolo_chart_draw",{draftRef})).result.previewed,false);
  h.bind("确认");
  await assert.rejects(h.call("haolo_alerts",{operation:"confirm",draftRef}),/Simulate and show/);
  h=harness(new CodexTradingArtifacts({directory}));
  h.bind("Show preview");await h.call("haolo_chart_draw",{draftRef});
  h.bind("确认");
  assert.equal((await h.call("haolo_alerts",{operation:"confirm",draftRef})).result.confirmed,true);
  h.bind("确认","other");
  await assert.rejects(h.call("haolo_alerts",{operation:"confirm",draftRef}),/unavailable/);
  h.setOwner("other-account");h.bind("确认","visible");
  await assert.rejects(h.call("haolo_alerts",{operation:"confirm",draftRef}),/unavailable/);
});

test("simulator failure/cancellation and preview failure cannot create pending approval", async () => {
  const h=harness();const {draftRef}=await h.call("haolo_alerts",{operation:"prepare"});
  h.deps.api.tradingAlertsSimulate=async()=>{throw new Error("no legal path");};
  await assert.rejects(h.call("haolo_simulation",{draftRef}),/no legal path/);
  await assert.rejects(h.call("haolo_chart_draw",{draftRef}),/Run haolo_simulation/);
  const abort=new AbortController();let finish;
  h.deps.api.tradingAlertsSimulate=()=>new Promise(r=>{finish=r;});
  const preparing=h.steps.run("visible",{action:"simulate",kind:"alert",artifact:{prepared:true,kind:"alert",simulationInput:{}}},"",{},abort.signal);
  abort.abort();finish({simulation:{simulationId:"s"}});
  await assert.rejects(preparing,/cancelled/);
  assert.equal(h.pending.size,0);
});

test("plan operations use server-owned versions and hashes; add preserves save then activate and stops on failure", async () => {
  const h=harness();
  await h.call("haolo_plans",{operation:"add",planId:"plan"});
  assert.deepEqual(h.calls.map(c=>c[0]),["plan-read","plan-save","plan-activate","refresh-plans"]);
  h.bind("end");
  h.calls.length=0;
  await h.call("haolo_plans",{operation:"end",planId:"plan",endReason:"stop_loss"});
  assert.deepEqual(h.calls.map(c=>c[0]),["plan-read","plan-lifecycle","refresh-plans"]);
  assert.equal(h.calls[1][1].endReason,"stop_loss");
  await assert.rejects(h.call("haolo_plans",{operation:"save",planId:"plan"}),/Invalid/);
  h.bind("delete");h.setApprove(false);h.calls.length=0;
  assert.equal((await h.call("haolo_plans",{operation:"delete",planId:"plan"})).result.cancelled,true);
  assert.deepEqual(h.calls.map(c=>c[0]),["plan-read"]);
  h.bind("add again");h.calls.length=0;
  const original=h.deps.api.tradingCloudPlans;
  h.deps.api.tradingCloudPlans=async(action,input)=>action==="save"?{ok:false,error:{message:"version conflict"}}:original(action,input);
  await assert.rejects(h.call("haolo_plans",{operation:"add",planId:"plan"}),/version conflict/);
  assert.ok(!h.calls.some(c=>c[0]==="plan-activate"));
  await assert.rejects(h.call("haolo_plans",{operation:"activate",planId:"plan",version:99}),/Unexpected/);
});

test("alert mutations reject foreign IDs and preserve the in-app delete decision", async () => {
  const h=harness();
  await assert.rejects(h.call("haolo_alerts",{operation:"pause",alertId:"foreign"}),/unavailable/);
  await h.call("haolo_alerts",{operation:"pause",alertId:"owned"});
  assert.ok(h.calls.some(c=>c[0]==="pause"));
  h.setApprove(false);
  assert.equal((await h.call("haolo_alerts",{operation:"delete",alertId:"owned"})).result.cancelled,true);
  assert.ok(!h.calls.some(c=>c[0]==="delete"));
});

const mainSource=fs.readFileSync(new URL("../src/renderer/main.ts",import.meta.url),"utf8");
function mainFunction(name,globals) {
  const ast=ts.createSourceFile("main.ts",mainSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const js=ts.transpileModule(`${node.getText(ast)}\nexports.run=${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,...globals});
  return exports.run;
}

test("actual alert runner prepare cannot simulate/create; confirm cannot interpret a revision as approval",async()=>{
  const calls=[],states=new Map(),runs=new Map();
  states.set("t",{stage:"confirmation",draftId:"old",simulationId:"old-sim",confirmationId:"old-confirm",sourceText:"old rule",conversation:[]});
  const globals={
    state:{tradingAlerts:{loaded:true},currentThreadId:"t"},
    api:{
      tradingAlertsCompile:async()=>{calls.push("compile");return {draft:{draftId:"new",status:"ready_to_simulate",rule:{title:"test"}}};},
      tradingAlertsSimulate:async()=>{throw new Error("unexpected simulate");},
      tradingAlertsConfirm:async()=>{throw new Error("unexpected confirm");},
      tradingAlertsSnapshot:async()=>({}),
    },
    tradingAlertConversationByThreadId:states,tradingAlertConversationRunByThreadId:runs,
    tradingAlertConversationStateForThread:id=>states.get(id),
    stripTradingAlertMention:t=>t,
    updateTradingExpertThinkingState:()=>{},refreshTradingExpertConversationSurface:()=>{},clearTradingExpertThinkingState:()=>false,
    resolveTradingAlertSourceText:(prev,text)=>text,tradingAlertResponseData:r=>r,
    tradingExpertAlertSimulationFrames:async()=>[{close:100}],
    persistTradingAlertAssistantItem:async(t,text)=>calls.push(text),
  };
  const run=mainFunction("runTradingAlertConversation",globals);
  const prepared=await run("t","Change rule",{chart:null,analysisTarget:null,skillOperation:"prepare"});
  assert.equal(prepared.prepared,true);
  assert.deepEqual(calls,["compile"]);
  assert.equal(states.get("t").stage,"clarification");
  const rejected=await run("t","Change again",{chart:null,analysisTarget:null,skillOperation:"confirm"});
  assert.equal(rejected.confirmed,false);
  assert.equal(calls.filter(c=>c==="compile").length,1);
});

test("actual personal runner confirm-only rejects revised or unclear conditions before compilation",async()=>{
  const previous={stage:"confirmation",draftId:"d",simulationId:"s",conversation:[]};
  const run=mainFunction("runPersonalStrategyConversation",{
    state:{currentThreadId:"t",personalStrategies:{}},
    api:{createPersonalStrategyDraft:()=>{},simulatePersonalStrategy:()=>{},confirmPersonalStrategy:()=>{throw new Error("unexpected commit");}},
    personalStrategyConversationStateForThread:()=>previous,
    isPersonalStrategyCreationCommand:()=>false,
    personalStrategyCreationDescription:t=>t,
    classifyTradingConfirmationIntent:async()=>({ok:true,intent:"revise"}),
    clearTradingExpertThinkingState:()=>false,
    persistPersonalStrategyAssistantItem:async()=>{},
  });
  assert.equal((await run("t","Change threshold",[],{chart:null,analysisTarget:null,skillOperation:"confirm"})).confirmed,false);
});

test("position-management report renders separately and never exposes an entry-plan action",()=>{
  const report="持仓调整：保持现有止损，等待确认。<script>unsafe</script>";
  for(const language of ["zh-CN","zh-TW","en"]){
    const escape=s=>String(s).replaceAll("<","&lt;").replaceAll(">","&gt;");
    const render=mainFunction("renderMessageExecutionPlan",{state:{settings:{language}},escapeHtml:escape,formatMessageText:escape});
    const action=mainFunction("renderAddToPlanAction",{});
    const message={executionPlanPresentation:"position-plan",cloudReports:[{shouldNotBecomeEntry:true}]};
    const result=render(message,report);
    assert.ok(result.cards.includes('data-trading-result-kind="position-management"'));
    assert.ok(result.cards.includes("&lt;script&gt;"));
    assert.equal(action(message,report),"");
  }
});
