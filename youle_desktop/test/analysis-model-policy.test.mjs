import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { AnalysisModelRecoveryStore } from "../src/main/analysis-model-recovery-store.mjs";
import { ANALYSIS_RECOVERY_WINDOW_MS as DAY, analysisModelPolicySelection, normalizeAnalysisModelRecoveryState, withAnalysisModelRecoveryPolicy } from "../src/main/analysis-model-policy.mjs";
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

test("new tasks use fallback for exactly 24 hours, then restore Sol including stale saved fallback selections", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.store.select("gpt-5.6-sol"), { modelId: "gpt-5.6-sol", fallback: false });
  assert.equal(f.store.activate("gpt-5.6-sol"), true);
  assert.equal(f.store.select("gpt-5.6-sol").modelId, "gpt-5.5");
  f.advance(DAY - 1);
  assert.equal(f.store.select("gpt-5.6-sol").fallback, true);
  f.advance(1);
  assert.deepEqual(f.store.select("gpt-5.5"), { modelId: "gpt-5.6-sol", fallback: false });
  assert.equal(f.store.select("gpt-5.6-sol").fallback, false);
});

test("ordinary traffic and backup failures do not slide the deadline; a failed primary retry opens another day", (t) => {
  const f = fixture(t);
  f.store.activate("gpt-5.6-sol");
  const first = f.store.snapshot();
  f.advance(DAY / 2);
  for (let i = 0; i < 10; i++) f.store.select("gpt-5.6-sol");
  assert.equal(f.store.activate("gpt-5.5"), false);
  assert.equal(f.store.activate("gpt-5.6-sol"), false);
  assert.deepEqual(f.store.snapshot(), first);
  f.advance(DAY / 2);
  assert.equal(f.store.activate("gpt-5.5"), false);
  assert.equal(f.store.activate("gpt-5.6-sol"), true);
  assert.equal(f.store.snapshot().fallbackUntil, first.fallbackUntil + DAY);
});

test("restart preserves both the remaining window and expiry without rewriting account/model preferences", (t) => {
  const f = fixture(t);
  f.store.activate("gpt-5.6-sol");
  const persisted = fs.readFileSync(f.filePath, "utf8");
  assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), ["activatedAt", "fallbackUntil", "version"]);
  f.advance(DAY / 3);
  let restarted = new AnalysisModelRecoveryStore(f.options);
  assert.equal(restarted.select("gpt-5.6-sol").fallback, true);
  assert.deepEqual(restarted.snapshot(), f.store.snapshot());
  f.advance(DAY);
  restarted = new AnalysisModelRecoveryStore(f.options);
  assert.equal(restarted.select("gpt-5.5").modelId, "gpt-5.6-sol");
  assert.equal(fs.readFileSync(f.filePath, "utf8"), persisted);
});

test("malformed persisted state does not create an indefinite fallback window", (t) => {
  const f = fixture(t);
  for (const value of [null, {}, { version: 2 }, { version: 1, activatedAt: f.now, fallbackUntil: f.now + 10 * DAY }]) {
    assert.equal(normalizeAnalysisModelRecoveryState(value), null);
  }
  fs.writeFileSync(f.filePath, "broken JSON");
  const errors = [];
  const store = new AnalysisModelRecoveryStore({ ...f.options, onError: (error) => errors.push(error) });
  assert.equal(store.select("gpt-5.6-sol").fallback, false);
  assert.equal(errors.length, 1);
  assert.doesNotThrow(() => store.activate("gpt-5.6-sol"));
});

test("host policy forces xhigh over stale picker effort/support and restores normal reasoning after expiry", (t) => {
  const f = fixture(t);
  f.store.activate("gpt-5.6-sol");
  const params = { model: "gpt-5.6-sol", reasoningEffort: "low", supportedReasoningEfforts: ["low", "medium"] };
  const selected = withAnalysisModelRecoveryPolicy(params, f.store.snapshot(), f.now);
  assert.equal(selected.model, "gpt-5.5");
  assert.equal(selected.reasoningEffort, "xhigh");
  const wire = withAdaptiveTurnReasoning("turn/start", { ...selected, effort: selected.reasoningEffort, [HAOLO_REASONING_FIXED_EFFORT_FIELD]: selected.reasoningEffort, input: [{ type: "text", text: "你好" }] });
  assert.equal(wire.effort, "xhigh");
  assert.equal(params.model, "gpt-5.6-sol");
  f.advance(DAY);
  const restored = withAnalysisModelRecoveryPolicy(selected, f.store.snapshot(), f.now);
  assert.equal(restored.model, "gpt-5.6-sol");
  assert.equal(restored.reasoningEffortPolicy, undefined);
  assert.equal(restored.supportedReasoningEfforts, undefined);
});

test("third-party and separately selected models keep their explicit selection", (t) => {
  const f = fixture(t);
  assert.equal(f.store.activate("deepseek-v4-flash"), false);
  f.store.activate("gpt-5.6-sol");
  for (const model of ["deepseek-v4-flash", "custom-model"]) {
    const params = { model, reasoningEffort: "max" };
    assert.equal(withAnalysisModelRecoveryPolicy(params, f.store.snapshot(), f.now), params);
  }
});

const request = { schemaVersion: 1, requestId: "task", snapshotId: "snapshot", task: "wave-review", theoryId: "wave", prompt: "frozen question and candles", responseFormat: "json" };
const success = { status: "success", text: '{"valid":true}' };
const failure = { status: "failed", error: "Selected model is at capacity", retryable: false };

test("provider integration spans original failure, new tasks, restart, successful retry and a later failed retry", async (t) => {
  const f = fixture(t), calls = [];
  let failPrimary = true, store = f.store;
  const provider = createAppServerTradingAnalysisProvider({
    selectModel: (model) => store.select(model),
    onRecovery: (event) => store.activate(event.failedModelId),
    waitForRecovery: async () => {},
    invoke: async (args) => { calls.push(args); return failPrimary && args.modelId === "gpt-5.6-sol" ? failure : success; },
  });
  await provider.analyze(request, { reasoningEffort: "medium" });
  assert.deepEqual(calls.map((c) => c.modelId), ["gpt-5.6-sol", "gpt-5.5"]);
  const deadline = store.snapshot().fallbackUntil;
  store = new AnalysisModelRecoveryStore(f.options);
  f.advance(DAY / 2);
  await provider.analyze({ ...request, requestId: "new-task" }, { reasoningEffort: "medium" });
  assert.equal(calls.at(-1).modelId, "gpt-5.5");
  assert.equal(calls.at(-1).reasoningEffort, "xhigh");
  assert.equal(store.snapshot().fallbackUntil, deadline);
  f.advance(DAY / 2);
  failPrimary = false;
  await provider.analyze(request, { reasoningEffort: "medium" });
  assert.equal(calls.at(-1).modelId, "gpt-5.6-sol");
  assert.equal(calls.at(-1).reasoningEffort, "medium");
  assert.equal(store.select("gpt-5.6-sol").fallback, false);
  failPrimary = true;
  await provider.analyze(request, { reasoningEffort: "medium" });
  assert.deepEqual(calls.slice(-2).map((c) => c.modelId), ["gpt-5.6-sol", "gpt-5.5"]);
  assert.equal(store.snapshot().fallbackUntil, f.now + DAY);
  await provider.analyze(request, { reasoningEffort: "medium" });
  assert.equal(calls.at(-1).modelId, "gpt-5.5");
});

test("expiry cannot switch an in-flight fallback review or its validation repair to another model", async (t) => {
  const f = fixture(t);
  f.store.activate("gpt-5.6-sol");
  const calls = [];
  let release;
  const provider = createAppServerTradingAnalysisProvider({
    selectModel: (model) => f.store.select(model),
    invoke: async (args) => { calls.push(args); if (calls.length === 1) return new Promise((resolve) => { release = resolve; }); return success; },
  });
  const pending = provider.analyze(request, { reasoningEffort: "medium" });
  f.advance(DAY);
  release(success);
  const result = await pending;
  assert.equal(result.modelId, "gpt-5.5");
  await provider.analyze(request, { reasoningEffort: "high", recoveryModel: result.recovery.modelId });
  assert.equal(calls.at(-1).modelId, "gpt-5.5");
  assert.equal(calls.at(-1).reasoningEffort, "xhigh");
});

test("routing and alert compilation are not silently upgraded by the daily model window", async (t) => {
  const f = fixture(t); f.store.activate("gpt-5.6-sol");
  const calls = [];
  const provider = createAppServerTradingAnalysisProvider({ selectModel: (model) => f.store.select(model), invoke: async (args) => { calls.push(args); return success; } });
  await provider.analyze({ ...request, task: "chan-request-routing" }, { reasoningEffort: "low" });
  await provider.analyze({ ...request, task: "trading_alert_intent_compile" }, { reasoningEffort: "medium" });
  assert.deepEqual(calls.map((c) => [c.modelId, c.reasoningEffort]), [["gpt-5.6-sol", "low"], ["gpt-5.6-sol", "medium"]]);
});

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const block = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from) + from.length));

test("production host new-thread handler overrides stale client settings with durable fallback", async (t) => {
  const f = fixture(t); f.store.activate("gpt-5.6-sol");
  const source = block(main, 'ipcMain.handle("codex:startThread"', 'ipcMain.handle("codex:persistTradingTranscript"');
  let handler, sent;
  const deps = {
    ipcMain: { handle(_method, callback) { handler = callback; } },
    withAnalysisModelRecoveryPolicy: (params, state) => withAnalysisModelRecoveryPolicy(params, state, f.now), getAnalysisModelRecoveryStore: () => f.store,
    desktopWorkspace: () => "workspace", getClientForCwd: () => ({}), ensureThreadGroupWorkspaceDirectory() {},
    refreshSkillsDeveloperInstructions: async () => "instructions", videoGenerationInstructionOptions: () => ({}),
    threadConfigurationParams: (params) => params, withThreadRuntimeSettings: (value) => value,
    requestThreadStart: async (_client, params) => { sent = params; return { thread: { id: "new-task" } }; }, rememberThreadClient() {},
  };
  new Function(...Object.keys(deps), source)(...Object.values(deps));
  await handler({}, { model: "gpt-5.6-sol", reasoningEffort: "low", activate: false });
  assert.equal(sent.model, "gpt-5.5");
  assert.equal(sent.reasoningEffort, "xhigh");
  f.advance(DAY);
  await handler({}, { model: "gpt-5.5", reasoningEffort: "xhigh", activate: false });
  assert.equal(sent.model, "gpt-5.6-sol");
});

test("renderer bootstrap and policy notifications preserve the newest state; both themes use existing model controls", (t) => {
  const f = fixture(t); f.store.activate("gpt-5.6-sol");
  const source = block(renderer, "function acceptAnalysisModelRecoveryState", "\n}") + "\n}";
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const apply = new Function("normalizeAnalysisModelRecoveryState", `let analysisModelRecoveryState = null; ${js}; return (value) => { acceptAnalysisModelRecoveryState(value); return analysisModelRecoveryState; };`)(normalizeAnalysisModelRecoveryState);
  const current = f.store.snapshot();
  assert.deepEqual(apply(current), current);
  assert.deepEqual(apply({ ...current, activatedAt: current.activatedAt - DAY, fallbackUntil: current.fallbackUntil - DAY }), current);
  assert.deepEqual(apply(null), current);
  assert.match(renderer, /acceptAnalysisModelRecoveryState\(defaults.analysisModelRecovery\)/);
  assert.match(renderer, /message.method === "haolo\/modelRecoveryState"/);
  const picker = block(renderer, "function selectedChatModelOption", "function chatModelOptionsForThread");
  assert.match(picker, /analysisModelPolicySelection/);
  assert.doesNotMatch(picker, /#[0-9a-f]{3,8}\b|background\s*:/i);
});

test("actual renderer new-task initialization follows the window and restores Sol reasoning after expiry", (t) => {
  const f = fixture(t); f.store.activate("gpt-5.6-sol");
  const source = block(renderer, "function initializeTradingExpertTaskThread", "function providerFromThreadId");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let selected;
  const deps = {
    tradingExpertThreadIds: new Set(), newThreadModeByThreadId: new Map(), isMediaCreationMode: () => false,
    threadModelSelection: () => null, threadModelSettings: () => null, isTradingExpertModelValue,
    analysisModelPolicySelection: (state, model) => analysisModelPolicySelection(state, model, f.now),
    analysisModelRecoveryState: f.store.snapshot(), TRADING_EXPERT_DEFAULT_MODEL_VALUE: "gpt-5.6-sol",
    DEFAULT_EXECUTION_MODEL_PROVIDER_ID: "haolo_ai", tradingExpertReasoningEffort,
    rememberThreadModelSelection: (_id, value) => { selected = value; },
  };
  const initialize = new Function(...Object.keys(deps), `${js}; return initializeTradingExpertTaskThread;`)(...Object.values(deps));
  initialize("new-1");
  assert.equal(selected.model, "gpt-5.5");
  assert.equal(selected.reasoningEffort, "xhigh");
  f.advance(DAY);
  initialize("new-2");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.reasoningEffort, "ultra");
});

test("production root terminal recovery activates the daily policy once and respects cancellation", (t) => {
  const f = fixture(t);
  const coordinator = new TurnAutoRecoveryCoordinator({ startRecovery: async () => ({}), setTimer: () => ({}), clearTimer() {} });
  const source = block(main, "function automaticTurnRecoveryDecision", "function isMeaningfulAutomaticTurnRecoveryProgress");
  const interruptedCodexThreadIds = new Set();
  const rootRecoveryModelsByThread = new Map([["root", "gpt-5.6-sol"]]);
  const deps = {
    automaticTurnRecoveryTerminalStatus: (message) => message.params.turn.status,
    workflowManagedVisibleTurnIds: new Set(), interruptedCodexTurnIds: new Set(), interruptedCodexThreadIds,
    failureDiagnosticsFromNotification, turnAutoRecoveryCoordinator: coordinator, getAnalysisModelRecoveryStore: () => f.store,
    rootRecoveryModelsByThread, ANALYSIS_PRIMARY_MODEL: "gpt-5.6-sol",
  };
  const decide = new Function(...Object.keys(deps), `${source}; return automaticTurnRecoveryDecision;`)(...Object.values(deps));
  const message = { method: "turn/completed", params: { turn: { status: "failed", error: { code: "server_is_overloaded" } } } };
  interruptedCodexThreadIds.add("root");
  assert.equal(decide(message, { threadId: "root", turnId: "first" }), null);
  assert.equal(f.store.snapshot(), null);
  interruptedCodexThreadIds.clear();
  assert.equal(decide(message, { threadId: "root", turnId: "first" }).status, "scheduled");
  const first = f.store.snapshot();
  f.advance(1_000);
  assert.equal(decide(message, { threadId: "root", turnId: "first" }).duplicate, true);
  rootRecoveryModelsByThread.set("root", "gpt-5.5");
  decide(message, { threadId: "root", turnId: "backup" });
  assert.deepEqual(f.store.snapshot(), first);
});
