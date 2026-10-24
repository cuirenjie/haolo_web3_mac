import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { errorSignals, isQuotaFailure } from "../src/main/error-signals.mjs";
import { insufficientCreditsNotice, isInsufficientCreditsNotice, INSUFFICIENT_CREDITS_NOTICE, ACTIVE_MEMBERSHIP_CREDITS_NOTICE } from "../src/renderer/quota-balance.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";

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
  "shouldLocalizeAppOwnedMessage",
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

const NOTICE = INSUFFICIENT_CREDITS_NOTICE;
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function harness() {
  const state = {
    items: { chat: {} }, itemOrder: { chat: [] }, pendingComposerSends: {},
    activeView: "chat", profileMenuOpen: true, error: null,
    auth: { profile: null },
  };
  const context = {
    state, Date, Math, Error, errorSignals, isQuotaFailure,
    insufficientCreditsNotice, isInsufficientCreditsNotice, INSUFFICIENT_CREDITS_NOTICE,
    openConsumptionPage() { state.activeView = "consumption"; },
    isBlankThreadWelcomeMessage: () => false,
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
  "当前没有可用积分，请开通体验版或其他套餐后再提问",
  "积分不足",
  "INSUFFICIENT_BALANCE",
  "insufficient_quota", "Payment required (402)",
  "HTTP 402", "unexpected status code: 402",
  JSON.stringify({ error: { statusCode: 402 } }),
  "ANALYSIS_CREDITS_REQUIRED",
];

test("all quota failures settle the user send and create a separate recharge bubble", () => {
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
      assert.equal(replies[0].actions[0].label, "查看消耗明细");
      assert.equal(replies[0].actions[1].label, "充值");
      assert.match(context.renderMessageActions(replies[0]), /message-recharge-button/);
    }
  }
});


test("membership denials preserve the actual failure without claiming an empty wallet", () => {
  for (const error of ["当前未开通有效体验版或其他套餐，请先开通后再使用盘面分析",
    "会员到期", "会员已过期", "会员等级不足", "TRIAL_REQUIRED", "MEMBERSHIP_EXPIRED", "MODEL_MEMBERSHIP_REQUIRED"]) {
    const context = harness();
    const id = beginSend(context, "@策略:订单流");
    context.failPendingComposerSend("chat", id, error);
    const user = context.state.items.chat[id];
    assert.equal(context.localSendStatusFromRecord(user), "failed", error);
    assert.ok(context.renderLocalSendStatus(user).includes(error));
    assert.equal(context.state.itemOrder.chat.length, 1, "no misleading recharge bubble");
    for (const legacy of [false, true]) {
      const historical = { type: "userMessage", text: user.text,
        [legacy ? "localSendStatus" : "__youleLocalSendStatus"]: "failed",
        [legacy ? "localSendError" : "__youleLocalSendError"]: error };
      assert.equal(context.localSendStatusFromRecord(historical), "failed");
      const restored = context.withLocalSendStatus({ text: historical.text }, historical);
      assert.ok(context.renderLocalSendStatus(restored).includes(error));
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

test("an active member with exhausted credits sees an explanation and a working usage link", () => {
  const context = harness();
  context.state.auth.profile = {
    real_balance: 0, subscription_balance: 0, total_balance: 0,
    active_membership: { plan_id: "basic", status: "active", expires_at: "2099-11-24T02:25:31+08:00" },
  };
  const item = context.appendInsufficientQuotaAgentMessage("chat", { turnId: "exhausted" });
  assert.equal(item.text, ACTIVE_MEMBERSHIP_CREDITS_NOTICE);
  assert.equal(context.hasInsufficientQuotaAgentMessage("chat", "exhausted"), true);
  const action = item.actions[0];
  let click;
  context.bindRechargeAction({ querySelectorAll: () => [{
    dataset: { messageAction: action.id, messageActionKind: action.kind, messageActionDestination: action.destination },
    addEventListener(event, callback) { if (event === "click") click = callback; },
  }] });
  click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(context.state.activeView, "consumption");
});

test("quota text and actions have three locales and reuse the tested light/dark button styles", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.message-recharge-button/);
  for (const theme of ["light", "dark"]) {
    for (const locale of ["zh-CN", "en", "zh-TW"]) {
      for (const text of [NOTICE, ACTIVE_MEMBERSHIP_CREDITS_NOTICE, "查看消耗明细"]) {
        const localized = translateAppText(text, locale);
        assert.ok(localized.length > 0, `${theme}/${locale}`);
        if (locale === "en") assert.doesNotMatch(localized, /[\u3400-\u9fff]/u);
        if (locale === "zh-TW") assert.notEqual(localized, text);
      }
      const context = harness();
      const item = context.appendInsufficientQuotaAgentMessage("chat");
      assert.equal(context.shouldLocalizeAppOwnedMessage(item, false), true);
      assert.equal(context.shouldLocalizeAppOwnedMessage(item, true), false);
      assert.equal(context.shouldLocalizeAppOwnedMessage({ id: "model-reply", text: item.text }, false), false);
      assert.match(context.renderMessageActionButton(item.actions[0]), /message-recharge-button/);
    }
  }
});
