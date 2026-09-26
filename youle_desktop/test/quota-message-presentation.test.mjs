import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set([
  "isInsufficientQuotaError", "insufficientQuotaSignalText",
  "localSendStatusFromRecord", "renderLocalSendStatus", "withLocalSendStatus",
  "pendingComposerSendForThread", "setPendingComposerSendStatus", "upsertPendingComposerSendItem",
  "clearPendingComposerSend", "failPendingComposerSend", "failLatestOptimisticUserItem",
  "appendInsufficientQuotaAgentMessage", "hasInsufficientQuotaAgentMessage",
  "rechargeTokenMessageAction", "isRechargeTokenAction", "renderMessageActionButton",
  "renderMessageActions", "openRechargePage",
]);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const constants = ast.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((declaration) => [
    "INSUFFICIENT_QUOTA_MESSAGE", "RECHARGE_TOKEN_ACTION_ID", "RECHARGE_TOKEN_ACTION_KIND",
  ].includes(declaration.name.getText(ast))));
const binding = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "bindMessageContentEvents");
const actionBinding = binding.body.statements.find((node) => node.getText(ast).startsWith("container.querySelectorAll<HTMLButtonElement>(\"[data-message-action]\")"));
assert.ok(actionBinding);
const javascript = ts.transpileModule([
  ...constants.map((node) => node.getText(ast)),
  ...functions.map((node) => node.getText(ast)),
  `function bindRechargeAction(container) { ${actionBinding.getText(ast)} }`,
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const NOTICE = "您的积分不足，请充值或开通会员";
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function harness() {
  const state = {
    items: { chat: {} }, itemOrder: { chat: [] }, pendingComposerSends: {},
    activeView: "chat", profileMenuOpen: true, error: null,
  };
  const context = {
    state, Date, Math, Error,
    firstString: (...parts) => parts.find((part) => typeof part === "string" && part.trim()) || null,
    errorMessage: (value) => typeof value === "string" ? value : value?.message || "",
    threadsAwaitingAgentReply: new Set(), localHistoryAheadThreadIds: new Set(),
    triggerLowBalanceProfileRefresh() {}, providerFromThreadId: () => null,
    itemText: (item) => item.text || "", itemTurnId: (item) => item.turnId || null,
    isOptimisticUserItemId: (id) => id.startsWith("local-"),
    isUserSideThreadItem: (item) => item.type === "userMessage",
    cloneLocalAttachments: (items) => structuredClone(items), messageAttachmentFromLocal: (item) => item,
    composerQuoteContextRecord: (quote) => quote, cloneComposerThreadReferences: (refs) => structuredClone(refs),
    conversationSupplementMetaFromRecord: () => null,
    escapeHtml: escape, escapeAttr: escape,
    rememberCurrentChatThreadSelection() {}, render() {}, refreshProfileFromApi: async () => {},
    upsertItem(threadId, item) {
      if (!state.items[threadId][item.id]) state.itemOrder[threadId].push(item.id);
      state.items[threadId][item.id] = { ...state.items[threadId][item.id], ...item };
    },
  };
  runInNewContext(javascript, context);
  return context;
}

function beginSend(context, text) {
  const pending = {
    threadId: "chat", itemId: `local-pending-send-${context.state.itemOrder.chat.length}`,
    text, attachments: [], threadReferences: [], quote: null,
    status: "sending", createdAt: "2026-09-26T00:00:00Z", error: null,
  };
  context.state.pendingComposerSends.chat = pending;
  context.upsertPendingComposerSendItem(pending);
  return pending.itemId;
}

const errors = [
  NOTICE,
  "当前未开通有效体验版或其他套餐，请先开通后再使用盘面分析",
  "当前没有可用积分，请开通体验版或其他套餐后再提问",
  "会员到期", "会员已过期", "积分不足", "会员等级不足",
  "TRIAL_REQUIRED", "MEMBERSHIP_EXPIRED", "INSUFFICIENT_BALANCE",
  "insufficient_quota", "Payment required (402)",
];

test("all quota or membership failures settle the user send and create a separate recharge bubble", () => {
  for (const text of ["@策略:订单流", "@策略:缠论", "@策略:波浪理论", "@指标:MACD", "帮我分析这个文件"]) {
    for (const error of errors) {
      const context = harness();
      const id = beginSend(context, text);
      context.failPendingComposerSend("chat", id, error);
      const user = context.state.items.chat[id];
      assert.equal(user.text, text);
      assert.equal(user.content[0].text, text);
      assert.equal(context.localSendStatusFromRecord(user), null, `${text}: ${error}`);
      assert.equal(context.renderLocalSendStatus(context.withLocalSendStatus({ text }, user)), "");
      assert.equal(context.state.pendingComposerSends.chat, undefined);
      const replies = Object.values(context.state.items.chat).filter((item) => item.type === "agentMessage");
      assert.equal(replies.length, 1, `${text}: ${error}`);
      assert.equal(replies[0].text, NOTICE);
      assert.equal(replies[0].actions[0].label, "充值");
      assert.match(context.renderMessageActions(replies[0]), /message-recharge-button/);
    }
  }
});

test("historical failure metadata is hidden without editing user text or attachments", () => {
  const context = harness();
  for (const legacy of [false, true]) {
    for (const error of errors) {
      const item = {
        type: "userMessage", text: "@策略:缠论",
        attachments: [{ id: "chart.png" }],
        [legacy ? "localSendStatus" : "__youleLocalSendStatus"]: "failed",
        [legacy ? "localSendError" : "__youleLocalSendError"]: error,
      };
      const before = JSON.stringify(item);
      assert.equal(context.renderLocalSendStatus(item), "", error);
      assert.equal(context.localSendStatusFromRecord(context.withLocalSendStatus({ text: item.text }, item)), null);
      assert.equal(JSON.stringify(item), before);
    }
  }
});

test("ordinary failures still show their red send status and user-authored quota text is preserved", () => {
  const context = harness();
  const text = `请解释“${NOTICE}”`;
  const id = beginSend(context, text);
  context.failPendingComposerSend("chat", id, "网络连接失败");
  const item = context.state.items.chat[id];
  assert.equal(item.text, text);
  assert.equal(context.localSendStatusFromRecord(item), "failed");
  assert.match(context.renderLocalSendStatus(item), /message-local-send-status failed.*网络连接失败/);
  assert.equal(context.state.itemOrder.chat.length, 1);
  assert.equal(context.isInsufficientQuotaError("暂时无法验证会员权益，请稍后重试"), false);
});

test("optimistic-send failure uses the same quota presentation", () => {
  const context = harness();
  const id = beginSend(context, "普通聊天");
  assert.equal(context.failLatestOptimisticUserItem("chat", NOTICE), true);
  assert.equal(context.localSendStatusFromRecord(context.state.items.chat[id]), null);
  assert.equal(context.state.itemOrder.chat.length, 2);
});

test("the actual recharge action listener opens the recharge page", () => {
  const context = harness();
  const action = context.rechargeTokenMessageAction();
  let click;
  const button = {
    dataset: { messageAction: action.id, messageActionKind: action.kind },
    addEventListener(event, callback) { if (event === "click") click = callback; },
  };
  context.bindRechargeAction({ querySelectorAll: () => [button] });
  assert.equal(typeof click, "function");
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(context.state.activeView, "recharge");
  assert.equal(context.state.profileMenuOpen, false);
  assert.equal(context.state.error, null);
});
