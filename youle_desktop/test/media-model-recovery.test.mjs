import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { withAnalysisModelRecoveryPolicy, ANALYSIS_RECOVERY_WINDOW_MS } from "../src/main/analysis-model-policy.mjs";
import { migrateDeepSeekModelSelection } from "../src/main/deepseek-model-policy.mjs";
import { migrateRetiredModelSelection } from "../src/main/retired-model-policy.mjs";
import { normalizeConversationMode, IMAGE_GENERATION_CONVERSATION_MODE, VIDEO_GENERATION_CONVERSATION_MODE } from "../src/main/conversation-mode.mjs";
import { TurnAutoRecoveryCoordinator } from "../src/main/turn-auto-recovery.mjs";
import { translateAppText } from "../src/renderer/app-language.mjs";

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const now = Date.now();
const recovery = { version: 1, activatedAt: now, fallbackUntil: now + ANALYSIS_RECOVERY_WINDOW_MS };
const modes = [IMAGE_GENERATION_CONVERSATION_MODE, VIDEO_GENERATION_CONVERSATION_MODE];
const firstString = (...values) => values.find(value => typeof value === "string" && value.trim()) || "";
function functions(source, names) {
  const parsed = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length);
  return ts.transpileModule(selected.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function block(source, from, to, offset = 0) {
  const start = source.indexOf(from, offset), end = source.indexOf(to, start + from.length);
  assert.ok(start >= offset && end > start);
  return source.slice(start, end);
}

test("media policy repairs stale fallback settings, retaining valid GPT choices across window expiry", () => {
  for (const mode of modes) for (const state of [null, recovery]) for (const time of [now, recovery.fallbackUntil]) {
    const chosen = { model: "gpt-5.6-sol", modelProvider: "haolo_ai", reasoningEffort: "high", conversationMode: mode };
    assert.deepEqual(withAnalysisModelRecoveryPolicy(chosen, state, time), chosen);
    assert.deepEqual(withAnalysisModelRecoveryPolicy({ ...chosen, model: "gpt-5.6-terra" }, state, time), { ...chosen, model: "gpt-5.6-terra" });
    for (const model of [undefined, "deepseek-flash", "deepseek-v4-flash"]) {
      const stale = { model, model_provider: "deepseek", effort: "max", reasoning_effort: "max", reasoningEffort: "max",
        reasoningEffortPolicy: "fixed", supportedReasoningEfforts: ["max"], __haoloFixedReasoningEffort: "max", __haoloSupportedReasoningEfforts: ["max"],
        conversation_mode: mode.replaceAll("-", "_"), imageGenerationModel: "media-model", threadId: "same-thread" };
      assert.deepEqual(withAnalysisModelRecoveryPolicy(stale, state, time), {
        model: "gpt-5.6-sol", modelProvider: "haolo_ai", conversation_mode: stale.conversation_mode,
        imageGenerationModel: "media-model", threadId: "same-thread",
      });
      assert.equal(stale.effort, "max", "does not mutate remembered settings");
    }
  }
  assert.equal(withAnalysisModelRecoveryPolicy({ model: "gpt-5.6-sol", conversationMode: "execution" }, recovery, now).model, "deepseek-flash");
});

test("production host startThread keeps media on GPT during the fallback window", async () => {
  let handler, sent;
  const deps = {
    ipcMain: { handle(_method, callback) { handler = callback; } },
    withAnalysisModelRecoveryPolicy, getAnalysisModelRecoveryStore: () => ({ snapshot: () => recovery }),
    desktopWorkspace: () => "workspace", getClientForCwd: () => ({}), ensureThreadGroupWorkspaceDirectory() {},
    refreshSkillsDeveloperInstructions: async () => "instructions", videoGenerationInstructionOptions: () => ({}),
    threadConfigurationParams: params => params, withThreadRuntimeSettings: value => value,
    requestThreadStart: async (_client, params) => { sent = params; return { thread: { id: "new-task" } }; }, rememberThreadClient() {},
  };
  new Function(...Object.keys(deps), block(main, 'ipcMain.handle("codex:startThread"', 'ipcMain.handle("codex:persistTradingTranscript"'))(...Object.values(deps));
  for (const mode of modes) for (const model of ["gpt-5.6-sol", "deepseek-flash"]) {
    await handler({}, { model, modelProvider: model.startsWith("gpt-") ? "haolo_ai" : "deepseek", conversationMode: mode, activate: false });
    assert.equal(sent.model, "gpt-5.6-sol");
    assert.equal(sent.modelProvider, "haolo_ai");
    assert.equal(sent.conversationMode, mode);
    assert.notEqual(sent.reasoningEffort, "max");
  }
});

test("production host send policy and media guard agree, including legacy mode aliases", () => {
  const selectionDeps = { migrateDeepSeekModelSelection, migrateRetiredModelSelection, firstString,
    canonicalExecutionModelProvider: value => value, DEEPSEEK_EXECUTION_PROVIDER_ID: "deepseek", DEEPSEEK_EXECUTION_MODEL: "deepseek-flash" };
  const executionProviderSelection = new Function(...Object.keys(selectionDeps), `${functions(main, ["executionProviderSelection"])}; return executionProviderSelection;`)(...Object.values(selectionDeps));
  const deps = { firstString, ANALYSIS_PRIMARY_MODEL: "gpt-5.6-sol", withAnalysisModelRecoveryPolicy, getAnalysisModelRecoveryStore: () => ({ snapshot: () => recovery }),
    executionProviderSelection, normalizeConversationMode, IMAGE_GENERATION_CONVERSATION_MODE, VIDEO_GENERATION_CONVERSATION_MODE };
  const send = block(main, "  params = withAnalysisModelRecoveryPolicy", "  if (!executionSelection.isDeepSeek)", main.indexOf('ipcMain.handle("codex:sendMessage"'));
  const select = new Function(...Object.keys(deps), `return params => { ${send}; return executionSelection; };`)(...Object.values(deps));
  for (const mode of modes) for (const model of ["gpt-5.6-sol", "deepseek-v4-flash"]) {
    const selection = select({ model, conversation_mode: mode.replaceAll("-", "_") });
    assert.equal(selection.model, "gpt-5.6-sol");
    assert.equal(selection.isDeepSeek, false);
  }
  assert.equal(select({ model: "gpt-5.6-sol", conversationMode: "execution" }).isDeepSeek, true);
});

test("production turn start registers media recovery selection on the actual target thread", () => {
  const coordinator = new TurnAutoRecoveryCoordinator({ startRecovery: async () => ({}), setTimer: () => ({}), clearTimer() {} });
  const source = block(main, "      rootRecoveryModelsByThread.set", "      try {", main.indexOf("    const startTurn = async () =>"));
  const deps = { rootRecoveryModelsByThread: new Map(), turnAutoRecoveryCoordinator: coordinator, ANALYSIS_PRIMARY_MODEL: "gpt-5.6-sol", IMAGE_GENERATION_CONVERSATION_MODE, VIDEO_GENERATION_CONVERSATION_MODE };
  const register = new Function(...Object.keys(deps), `return (threadId, conversationMode, executionSelection, turnReasoningEffort) => { ${source} };`)(...Object.values(deps));
  for (const [index, mode] of [...modes, "execution"].entries()) {
    const threadId = `replacement-${index}`;
    register(threadId, mode, { model: "gpt-5.6-sol", modelProvider: "haolo_ai" }, "high");
    const decision = coordinator.handleTerminalFailure({ threadId, failedTurnId: "original", status: "failed", errorClass: "stream_disconnected" });
    assert.equal(decision.modelId, mode === "execution" ? "deepseek-flash" : "gpt-5.6-sol");
    assert.equal(decision.reasoningEffort, mode === "execution" ? "max" : "high");
    coordinator.cancel(threadId, "user_cancel");
    register(threadId, mode, { model: "gpt-5.6-sol", modelProvider: "haolo_ai" }, "high");
    assert.equal(coordinator.handleTerminalFailure({ threadId, failedTurnId: "late", status: "failed", errorClass: "stream_disconnected" }).status, "ignored");
  }
});

test("actual media recovery notices describe the GPT continuation and translate without fallback claims", () => {
  const notices = [];
  const deps = { firstString, automaticTurnRecoveryNoticeKeys: new Set(), appendAgentNotice: (_id, text) => notices.push(text), isContextWindowExhaustedError: () => false };
  const announce = new Function(...Object.keys(deps), `${functions(renderer, ["formatTurnFailureMessage", "announceAutomaticTurnRecovery"])}; return announceAutomaticTurnRecovery;`)(...Object.values(deps));
  for (const status of ["scheduled", "starting", "cooling_down", "exhausted"]) announce("media", { chainId: "media", status, modelId: "gpt-5.6-sol" });
  assert.equal(notices.length, 3, "deduplicates scheduled/starting for the same recovery");
  for (const text of notices) {
    assert.match(text, /媒体任务/);
    assert.doesNotMatch(text, /Astra|DeepSeek|1 小时/);
    assert.doesNotMatch(translateAppText(text, "en"), /\p{Script=Han}/u);
    assert.notEqual(translateAppText(text, "zh-TW"), text);
  }
  announce("text", { chainId: "text", status: "scheduled", modelId: "deepseek-flash" });
  assert.match(notices.at(-1), /Astra.*1 小时/);
});
