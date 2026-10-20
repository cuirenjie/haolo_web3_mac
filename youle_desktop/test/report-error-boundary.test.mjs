import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { errorSignals, isQuotaFailure } from "../src/main/error-signals.mjs";
import { loadTradingStrategyManifestFiles } from "../src/main/trading-strategy-runtime/manifest-loader.mjs";
import { withTradingTranscriptItems } from "../src/main/trading-expert-transcript.mjs";
import { isCompletedTradingAnalysisReport } from "../src/renderer/trading-analysis-completion.ts";

const source = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set([
  "isInsufficientQuotaError", "isInsufficientQuotaSignalFields", "isInsufficientQuotaTurnSignal",
  "shouldHideChatItem", "appendTradingExpertReport", "turnResultDisplayStatus",
  "turnIdFromResultKey", "normalizedTurnResultStatus", "agentMessagePhase", "formatTurnFailureMessage",
  "cleanIpcError", "loginOtpErrorMessage",
]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const renderer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "renderMessage");
// Exercise the actual early-return visibility guards without stubbing the entire
// unrelated HTML renderer. Report insertion and history visibility run in full.
const renderPrefix = renderer.body.statements.slice(0, renderer.body.statements.findIndex(node => node.getText(ast).startsWith("const alignRight")));
const code = ts.transpileModule([
  ...functions.map(node => node.getText(ast)),
  `function renderVisibility(message) { ${renderPrefix.map(node => node.getText(ast)).join("\n")} return "visible"; }`,
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const c = {
    errorSignals, isQuotaFailure, isCompletedTradingAnalysisReport,
    errorMessage: value => typeof value === "string" ? value : value?.message || "",
    state: { items: { chat: {} } },
    firstString: (...parts) => parts.find(p => typeof p === "string" && p.trim()) || null,
    itemText: item => item.text || "", itemAttachments: () => [], itemHasDisplayAttachments: () => false,
    isThreadContinuationInternalText: () => false, isHiddenRoleItem: () => false,
    isAttachmentMetadataOnlyUserMessage: () => false, isSubagentProcessItem: () => false,
    isInternalProcessItem: () => false, isUserSideThreadItem: item => item.type === "userMessage",
    isNoisyReconnectError: () => false, isMissingRolloutError: () => false,
    AUTOMATIC_TURN_RECOVERY_MARKER: "<haolo_automatic_turn_recovery>",
    localHistoryAheadThreadIds: new Set(), interruptedCodexTurnIds: new Set(),
    localGroupChatMemberEventFromMessage: () => null,
    cachedConsumptionStatusForTurn: () => null, isContextWindowExhaustedError: () => false,
    setMessageStreamFollow() {}, patchConversationRow() {}, refreshTradingExpertConversationSurface() {}, recordRendererTranscriptDiagnostic() {},
    // Real failures use their own tested recharge path; successful reports must
    // never reach it, including prose that quotes a billing error message.
    appendInsufficientQuotaAgentMessage() { throw Error("Report became a recharge notice"); },
    isTradingAnalysisQuotaFailure: isQuotaFailure,
    messageActionsFromItem: item => item.actions, isRechargeTokenAction: () => false,
  };
  c.upsertItem = (threadId, item) => { c.state.items[threadId][item.id] = item; };
  vm.runInNewContext(code, c);
  return c;
}

for (const { manifest } of loadTradingStrategyManifestFiles()) {
  test(`${manifest.id}: live, renderer and restored final reports preserve every numeric status price`, () => {
    const c = harness();
    for (let code = 400; code < 600; code++) {
      const text = `${manifest.display.name} SNDKUSDT：HH 1,${code}.66，支撑 ${code}，目标 ${code}.12。`;
      const report = c.appendTradingExpertReport("chat", text, "final");
      assert.equal(report.text, text);
      assert.equal(c.shouldHideChatItem(report), false);
      assert.equal(c.renderVisibility({ role: "assistant", text }), "visible");
      const hydrated = withTradingTranscriptItems({ thread: { id: "chat", turns: [] } }, [{ ...report, role: "assistant" }]);
      const restored = hydrated.thread.turns.flatMap(turn => turn.items).find(item => item.id === report.id);
      assert.ok(restored);
      assert.equal(restored.text, text);
      assert.equal(c.shouldHideChatItem(restored), false);
      c.state.items.chat[restored.id] = restored;
      assert.equal(c.turnResultDisplayStatus("chat", "after-user:1", [0], [restored]), "handled");
    }
    const quotedError = '报告说明：此处的“积分不足”、HTTP 402 和 insufficient_quota 是引用文本。';
    const report = c.appendTradingExpertReport("chat", quotedError);
    assert.equal(report.text, quotedError);
    assert.equal(c.shouldHideChatItem(report), false);
    assert.equal(c.renderVisibility({ role: "assistant", text: quotedError }), "visible");
  });
}

test("turn failures use explicit error metadata, never successful summaries or final text", () => {
  const c = harness();
  for (const params of [{ error: { status: 402 } }, { turn: { status: "failed", error: { message: "insufficient_quota" } } }, { turn: { status: "failed", message: "积分不足" } }]) {
    assert.equal(c.isInsufficientQuotaTurnSignal({ method: "turn/completed", params }), true);
  }
  assert.equal(c.isInsufficientQuotaTurnSignal({ method: "turn/completed", params: { turn: { status: "completed", summary: "HTTP 402 积分不足", message: "会员到期", text: "1,402.66" } } }), false);
});

test("failure descriptions distinguish HTTP status from price fragments for all error families", () => {
  const c = harness();
  for (const code of [401, 403, 429, 500, 502, 503, 504, 529]) {
    assert.equal(c.formatTurnFailureMessage(`Validation failed near price 1,${code}.66`), "本轮执行失败，请重试。");
    assert.notEqual(c.formatTurnFailureMessage(`HTTP ${code}: rejected`), "本轮执行失败，请重试。");
  }
  assert.equal(c.cleanIpcError("HTTP 429.12 is a quoted price"), "HTTP 429.12 is a quoted price");
  assert.equal(c.cleanIpcError("HTTP 429: rejected"), "模型上游当前限流，请稍后重试");
  assert.equal(c.loginOtpErrorMessage("HTTP 401.12"), "HTTP 401.12");
  assert.equal(c.loginOtpErrorMessage({ status: 401 }), "验证码不正确");
});
