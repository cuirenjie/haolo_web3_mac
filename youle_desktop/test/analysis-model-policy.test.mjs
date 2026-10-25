import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { AnalysisModelRecoveryStore } from "../src/main/analysis-model-recovery-store.mjs";
import { ANALYSIS_RECOVERY_WINDOW_MS as HOUR, analysisModelPolicySelection, normalizeAnalysisModelRecoveryState, withAnalysisModelRecoveryPolicy } from "../src/main/analysis-model-policy.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";
import { HAOLO_REASONING_FIXED_EFFORT_FIELD, withAdaptiveTurnReasoning } from "../src/main/gpt-reasoning-effort.mjs";
import { TurnAutoRecoveryCoordinator } from "../src/main/turn-auto-recovery.mjs";
import { failureDiagnosticsFromNotification } from "../src/main/turn-diagnostics.mjs";
import { isTradingExpertModelValue, tradingExpertReasoningEffort } from "../src/renderer/trading-expert-models.ts";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-model-policy-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^haolo-model-policy-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let now = 1_800_000_000_000;
  const filePath = path.join(directory, "model-state.json");
  const options = { filePath, now: () => now };
  const store = new AnalysisModelRecoveryStore(options);
  return { store, options, filePath, get now() { return now; }, advance(ms) { now += ms; } };
}


for (const version of [1, 2]) {
  test('persisted v' + version + ' cooldown is ignored before and after expiry, including restart', t => {
    const f=fixture(t);
    const state={version,activatedAt:f.now,fallbackUntil:f.now+HOUR};
    fs.writeFileSync(f.filePath,JSON.stringify(state));
    for (const advance of [0,HOUR/2,HOUR]) {
      f.advance(advance);
      const store=new AnalysisModelRecoveryStore(f.options);
      for (const model of [undefined,'deepseek-flash','deepseek-v4-flash','gpt-5.6-sol','gpt-6-sol','gpt-6-astra']) {
        assert.deepEqual(store.select(model),{modelId:'deepseek-flash',fallback:false});
        assert.equal(store.activate(model),false);
      }
      assert.equal(store.snapshot(),null);
      assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath,'utf8')),state);
    }
  });
}
test('old GPT settings are normalized before dispatch and stale effort is cleared',t=>{
  const f=fixture(t);
  const result=withAnalysisModelRecoveryPolicy({model:'gpt-5.6-sol',modelProvider:'haolo_ai',effort:'high'},null);
  assert.equal(result.model,'deepseek-flash');
  assert.equal(result.modelProvider,'deepseek');
  assert.equal(result.effort,undefined);
  const ds=withAnalysisModelRecoveryPolicy({model:'deepseek-flash',modelProvider:'deepseek',effort:'low'},null);
  assert.equal(ds.effort,'low');
  assert.equal(f.store.activate('deepseek-flash'),false);
});
test('explicit dedicated models and media modes preserve their capability selection',()=>{
  for(const params of [{model:'custom-model'},{model:'image-model',conversationMode:'image-generation'}]) {
    assert.deepEqual(withAnalysisModelRecoveryPolicy(params,{version:2}),params);
  }
});
test('malformed state is reported without enabling fallback',t=>{
  const f=fixture(t), errors=[];
  fs.writeFileSync(f.filePath,'broken JSON');
  const store=new AnalysisModelRecoveryStore({...f.options,onError:e=>errors.push(e)});
  assert.equal(errors.length,1);
  assert.equal(store.select().modelId,'deepseek-flash');
  assert.equal(store.activate('deepseek-flash'),false);
});
test('failed calls and later requests all remain on DeepSeek',async t=>{
  const f=fixture(t),calls=[];
  let fails=true;
  const provider=createAppServerTradingAnalysisProvider({selectModel:m=>f.store.select(m),onRecovery:()=>assert.fail('fallback forbidden'),invoke:async args=>{
    calls.push(args); return fails?{status:'failed',error:'server_is_overloaded',retryable:true}:{status:'success',text:'verified'};
  }});
  for(let i=0;i<2;i++) await assert.rejects(provider.analyze({task:'wave-review'}));
  fails=false;
  assert.equal((await provider.analyze({task:'wave-review'})).modelId,'deepseek-flash');
  assert.ok(calls.every(c=>c.modelId==='deepseek-flash'&&c.modelProvider==='deepseek'));
  assert.equal(f.store.snapshot(),null);
});

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const block = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from) + from.length));

test("production host new-thread handler overrides stale client settings with DeepSeek", async (t) => {
  const f = fixture(t); f.store.activate("deepseek-flash");
  const source = block(main, 'ipcMain.handle("codex:startThread"', 'ipcMain.handle("codex:persistTradingTranscript"');
  let handler, sent;
  const deps = {
    firstString: (...values) => values.find(v => typeof v === "string" && v.trim()) || "",
    ipcMain: { handle(_method, callback) { handler = callback; } },
    withAnalysisModelRecoveryPolicy: (params, state) => withAnalysisModelRecoveryPolicy(params, state, f.now), getAnalysisModelRecoveryStore: () => f.store,
    desktopWorkspace: () => "workspace", getClientForCwd: () => ({}), ensureThreadGroupWorkspaceDirectory() {},
    refreshSkillsDeveloperInstructions: async () => "instructions", videoGenerationInstructionOptions: () => ({}),
    threadConfigurationParams: (params) => params, withThreadRuntimeSettings: (value) => value,
    requestThreadStart: async (_client, params) => { sent = params; return { thread: { id: "new-task" } }; }, rememberThreadClient() {},
  };
  new Function(...Object.keys(deps), source)(...Object.values(deps));
  await handler({}, { model: "deepseek-flash", reasoningEffort: "low", activate: false });
  assert.equal(sent.model, "deepseek-flash");
  assert.equal(sent.reasoningEffort, "low");
  f.advance(HOUR);
  await handler({}, { model: "gpt-5.6-sol", reasoningEffort: "high", activate: false });
  assert.equal(sent.model, "deepseek-flash");
});

test("renderer bootstrap and policy notifications preserve the newest state; both themes use existing model controls", (t) => {
  const f = fixture(t); f.store.activate("deepseek-flash");
  const source = block(renderer, "function acceptAnalysisModelRecoveryState", "\n}") + "\n}";
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const apply = new Function("normalizeAnalysisModelRecoveryState", `let analysisModelRecoveryState = null; ${js}; return (value) => { acceptAnalysisModelRecoveryState(value); return analysisModelRecoveryState; };`)(normalizeAnalysisModelRecoveryState);
  const current = { version:2, activatedAt:f.now, fallbackUntil:f.now+HOUR };
  assert.equal(apply(current), null);
  assert.equal(apply({ ...current, activatedAt: current.activatedAt - HOUR, fallbackUntil: current.fallbackUntil - HOUR }), null);
  assert.equal(apply(null), null);
  assert.match(renderer, /acceptAnalysisModelRecoveryState\(defaults.analysisModelRecovery\)/);
  assert.match(renderer, /message.method === "haolo\/modelRecoveryState"/);
  const picker = block(renderer, "function selectedChatModelOption", "function chatModelOptionsForThread");
  assert.match(picker, /DEEPSEEK_EXECUTION_PROVIDER_ID/);
  assert.doesNotMatch(picker, /#[0-9a-f]{3,8}\b|background\s*:/i);
});

test("actual renderer new tasks use low before and after obsolete policy expiry", (t) => {
  const f = fixture(t); f.store.activate("deepseek-flash");
  const source = block(renderer, "function initializeTradingExpertTaskThread", "function providerFromThreadId");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let selected;
  const deps = {
    tradingExpertThreadIds: new Set(), newThreadModeByThreadId: new Map(), isMediaCreationMode: () => false,
    threadModelSelection: () => null, threadModelSettings: () => null, isTradingExpertModelValue,
    analysisModelPolicySelection: (state, model) => analysisModelPolicySelection(state, model, f.now),
    analysisModelRecoveryState: f.store.snapshot(), TRADING_EXPERT_DEFAULT_MODEL_VALUE: "deepseek-flash",
    DEFAULT_EXECUTION_MODEL_PROVIDER_ID: "haolo_ai", tradingExpertReasoningEffort,
    DEEPSEEK_EXECUTION_MODEL_VALUE: "deepseek-flash", DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek",
    rememberThreadModelSelection: (_id, value) => { selected = value; },
  };
  const initialize = new Function(...Object.keys(deps), `${js}; return initializeTradingExpertTaskThread;`)(...Object.values(deps));
  initialize("new-1");
  assert.equal(selected.model, "deepseek-flash");
  assert.equal(selected.reasoningEffort, "low");
  assert.equal(selected.modelProvider, "deepseek");
  f.advance(HOUR);
  initialize("new-2");
  assert.equal(selected.model, "deepseek-flash");
  assert.equal(selected.reasoningEffort, "low");
  assert.equal(selected.modelProvider, "deepseek");
});

test("production root terminal recovery stays disabled and respects cancellation", (t) => {
  const f = fixture(t);
  const coordinator = new TurnAutoRecoveryCoordinator({ startRecovery: async () => ({}), setTimer: () => ({}), clearTimer() {} });
  const source = block(main, "function automaticTurnRecoveryDecision", "function isMeaningfulAutomaticTurnRecoveryProgress");
  const interruptedCodexThreadIds = new Set();
  const rootRecoveryModelsByThread = new Map([["root", "deepseek-flash"]]);
  const deps = {
    automaticTurnRecoveryTerminalStatus: (message) => message.params.turn.status,
    workflowManagedVisibleTurnIds: new Set(), interruptedCodexTurnIds: new Set(), interruptedCodexThreadIds,
    failureDiagnosticsFromNotification, turnAutoRecoveryCoordinator: coordinator, getAnalysisModelRecoveryStore: () => f.store,
    rootRecoveryModelsByThread, ANALYSIS_PRIMARY_MODEL: "deepseek-flash",
  };
  const decide = new Function(...Object.keys(deps), `${source}; return automaticTurnRecoveryDecision;`)(...Object.values(deps));
  const message = { method: "turn/completed", params: { turn: { status: "failed", error: { code: "server_is_overloaded" } } } };
  interruptedCodexThreadIds.add("root");
  assert.equal(decide(message, { threadId: "root", turnId: "first" }), null);
  assert.equal(f.store.snapshot(), null);
  interruptedCodexThreadIds.clear();
  assert.equal(decide(message, { threadId: "root", turnId: "first" }).status, "ignored");
  const first = f.store.snapshot();
  f.advance(1_000);
  assert.equal(decide(message, { threadId: "root", turnId: "first" }).status, "ignored");
  rootRecoveryModelsByThread.set("root", "gpt-5.6-sol");
  decide(message, { threadId: "root", turnId: "backup" });
  assert.deepEqual(f.store.snapshot(), first);
});


test("every managed product tier, including explicit flagship selection, uses DeepSeek low", () => {
  for (const model of ["gpt-5.6-sol", "gpt-6-sol", "gpt-6-astra", "deepseek-flash"]) {
    const selected = withAnalysisModelRecoveryPolicy({model, explicitModelSelection:true, reasoningEffort:"max"}, null);
    assert.equal(selected.model,"deepseek-flash");
    assert.equal(selected.modelProvider,"deepseek");
    assert.equal(selected.reasoningEffort,"low");
  }
});
