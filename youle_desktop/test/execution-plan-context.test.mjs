import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as plans from "../src/renderer/execution-plans.ts";
import {
  tradingTranscriptInjectionItems,
  parseTradingTranscriptMarkerText,
  withTradingTranscriptItems,
} from "../src/main/trading-expert-transcript.mjs";

const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", renderer, ts.ScriptTarget.Latest, true);
const functionNames = [
  "renderMessageExecutionPlan", "renderExecutionPlanCardContent", "renderAddToPlanAction",
  "executionPlanCandidateKey", "createExecutionPlanStickyFromMessageCard", "messageExecutionPlanCardKey",
  "renderExecutionPlanCard", "executionPlanStatusMeta", "executionPlanCreatedLabel",
  "syncExecutionPlanLinkedAlert", "executionPlanBinanceIdentity", "addExecutionPlanFromMessageAction",
  "updateExecutionPlanLifecycle",
];
const functions = functionNames.map((name) => {
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join("\n");
const javascript = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function report(interval, symbol = "ETH") {
  return ["多空条件方案", ...["多头", "空头"].map((side) => `
## ${symbol}/USDT 币安永续 ${interval} · ${side}条件方案
当前动作：等待条件触发
方向判断：偏${side === "多头" ? "多" : "空"}
${side}触发：2663.5765
止损与失效：2621.5635
分批止盈：2692.5737295
仓位大小：等待账户快照
风险收益比：1:1.5`)].join("\n");
}

// Run production renderer functions, replacing only app/DOM I/O. A mutable
// latest-analysis label deliberately models the exact 1H -> 4H incident.
function harness(theme = "light", language = "zh-CN") {
  const runtime = { latest: "ETH1H", sticky: [], alerts: [], notifications: [], errors: [] };
  const storage = new Map();
  const store = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const state = { threads: [{ id: "thread", name: "ETH1H 分析" }], settings: { language }, executionPlans: [], executionPlansScope: "qa" };
  const candidates = new Map();
  const deps = {
    ...plans, state, executionPlanCandidatesBySource: candidates,
    executionPlanDeleteBusyIds: new Set(), executionPlanAlertSyncBusyIds: new Set(),
    escapeHtml, escapeAttr: escapeHtml, formatMessageText: escapeHtml,
    tradingLastAnalysisLabelForThread: () => runtime.latest,
    syncExecutionPlansForCurrentAccount() {}, render() {}, renderExecutionPlanActions: () => "",
    threadListDisplayName: (thread) => thread.name, showToast() {}, openExecutionPlansPage() {},
    errorMessage: (error) => { runtime.errors.push(String(error)); return String(error); },
    tradingAlertResponseData: (value) => value, document: { documentElement: { dataset: { theme } } },
    saveExecutionPlans: (scope, values) => plans.saveExecutionPlans(scope, values, store),
    api: {
      createExecutionPlanSticky: async (payload) => { runtime.sticky.push(payload); return { created: true }; },
      tradingAlertsSyncExecutionPlan: async (payload) => { runtime.alerts.push(payload); return { alert: { alertId: "qa-alert" } }; },
      notifyExecutionPlanStatusChanged: async (payload) => { runtime.notifications.push(payload); },
    },
  };
  const api = new Function(...Object.keys(deps), `${javascript}\nreturn {${functionNames.join(",")}};`)(...Object.values(deps));
  const message = (id, text) => ({ id, conversation_id: "thread", executionPlanPresentation: "execution-plan", text });
  const card = (id, index = 0) => ({ dataset: { executionPlanThreadId: "thread", executionPlanMessageId: id, executionPlanIndex: String(index) } });
  const button = (id, index = 0) => ({ ...card(id, index), setAttribute() {}, removeAttribute() {} });
  return { ...api, state, runtime, store, candidates, message, card, button };
}

test("a historical plan heading wins over newer compact labels and conflicting report intervals", () => {
  for (const interval of ["1H", "4H", "15M", "1D", "1W"]) {
    for (const side of ["多头", "空头"]) {
      const title = `ETH/USDT 币安永续 ${interval} · ${side}条件方案`;
      assert.equal(plans.executionPlanCardTitle({
        fallbackTitle: title, analysisLabel: "BTC4H", sourceTitle: "BTC1D 分析",
        sourceText: "BINANCE:FUTURES:SOLUSDT · 15分钟结构，基于当前 4小时分析",
      }), title);
    }
  }
});

test("market and period come from one source, and legacy report context precedes thread context", () => {
  assert.equal(plans.executionPlanCardTitle({
    fallbackTitle: "标准执行方案", sourceText: "BINANCE:FUTURES:ETHUSDT · 1小时缠论分析",
    analysisLabel: "BTC4H", sourceTitle: "SOL1D",
  }), "ETH/USDT 币安永续 1H");
  assert.equal(plans.executionPlanCardTitle({
    fallbackTitle: "ETH/USDT", analysisLabel: "BTC4H",
  }), "BTC/USDT 币安永续 4H");
  assert.deepEqual(plans.executionPlanBinanceMarketDetails({
    title: "ETH/USDT 币安永续 1H", content: "方向判断：偏多",
    sourceTitle: "BINANCE:FUTURES:BTCUSDT · 4H",
  }), { symbol: "ETHUSDT", direction: "LONG" });
});

test("mixed-market reports and late results retain each individual card heading", () => {
  const h = harness();
  h.runtime.latest = "BTC4H";
  h.state.threads[0].name = "BTC4H";
  const text = [report("1H"), report("15M", "币安人生"), report("1D", "1INCH")].join("\n\n---\n\n");
  const msg = h.message("late", text);
  const cards = h.renderMessageExecutionPlan(msg, text).cards;
  const titles = [...cards.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
  assert.equal(titles.length, 6);
  for (const [index, context] of ["ETH/USDT 币安永续 1H", "币安人生/USDT 币安永续 15M", "1INCH/USDT 币安永续 1D"].entries()) {
    assert.equal(titles[index * 2], context + " · 多头条件方案");
    assert.equal(titles[index * 2 + 1], context + " · 空头条件方案");
  }
  assert.equal(plans.executionPlanCardTitle({
    fallbackTitle: "ETH/USDC Binance Perpetual 1H · Short setup",
    sourceText: "BINANCE:FUTURES:BTCUSDT · 4小时分析", language: "en",
  }), "ETH/USDC Binance Perpetual 1H · Short setup");
});

for (const theme of ["light", "dark"]) {
  for (const language of ["zh-CN", "zh-TW", "en"]) {
    test(`${theme}/${language}: 1H -> 4H -> revisit, save, sticky, alert and reload preserve each result`, async () => {
      const h = harness(theme, language);
      const one = h.message("one", report("1H"));
      const four = h.message("four", report("4H"));
      const initial = h.renderMessageExecutionPlan(one, one.text);
      h.runtime.latest = "ETH4H";
      h.state.threads[0].name = "基于当前 4小时 已收盘 K 线";
      const newer = h.renderMessageExecutionPlan(four, four.text);
      assert.match(newer.cards, /4H/);
      assert.equal(h.renderMessageExecutionPlan(one, one.text).cards, initial.cards);

      // Add-to-plan also refreshes the shared candidate cache during rendering.
      h.renderAddToPlanAction(one, one.text);
      h.runtime.latest = "BTC1D";
      h.state.threads[0].name = "BINANCE:FUTURES:BTCUSDT · 1日分析";
      assert.equal(h.renderMessageExecutionPlan(one, one.text).cards, initial.cards);
      h.renderAddToPlanAction(one, one.text);
      await h.createExecutionPlanStickyFromMessageCard(h.card("one"));
      assert.match(h.runtime.sticky[0].title, /ETH\/USDT .*1H/);
      assert.equal(h.runtime.sticky[0].theme, theme);
      await h.addExecutionPlanFromMessageAction(h.button("one"));
      assert.deepEqual(h.runtime.errors, []);
      const [saved] = h.state.executionPlans;
      assert.ok(saved);
      assert.match(saved.title, /ETH\/USDT .*1H/);
      assert.match(h.runtime.alerts[0].title, /ETH\/USDT .*1H/);
      assert.equal(h.executionPlanBinanceIdentity(saved).symbol, "ETHUSDT");
      assert.match(h.renderExecutionPlanCard(saved), /ETH\/USDT .*1H/);
      const [loaded] = plans.loadExecutionPlans("qa", h.store);
      assert.equal(plans.executionPlanCardTitle({ fallbackTitle: loaded.title, language }), saved.title);
      assert.equal(loaded.content, saved.content);
      await h.updateExecutionPlanLifecycle(saved.id, "ended", "cancelled");
      assert.equal(h.runtime.notifications[0].title, saved.title);
      assert.equal(h.runtime.alerts[1].title, saved.title);

      // A fresh renderer rebuilds cards from the actual transcript marker,
      // without relying on an in-memory title cache or the last chart period.
      const [injected] = tradingTranscriptInjectionItems([{ id: one.id, role: "assistant", text: one.text, createdAt: "2026-09-19T10:00:00Z", executionPlanPresentation: "execution-plan" }]);
      const restored = parseTradingTranscriptMarkerText(injected.content[0].text);
      const hydrated = withTradingTranscriptItems({ thread: { id: "thread", turns: [] } }, [restored]);
      const item = hydrated.thread.turns[0].items[0];
      const fresh = harness(theme, language);
      fresh.runtime.latest = "BTC4H";
      assert.equal(fresh.renderMessageExecutionPlan(fresh.message(item.id, item.text), item.text).cards, initial.cards);
    });
  }
}

test("generic legacy cards derive stable context from their own report for every action", async () => {
  const h = harness();
  h.runtime.latest = "BTC4H";
  h.state.threads[0].name = "BTC4H";
  const text = report("1H").split("## ETH/USDT 币安永续 1H · 空头条件方案")[0]
    .replace("ETH/USDT 币安永续 1H · 多头条件方案", "标准执行方案")
    + "\n\n---\nBINANCE:FUTURES:ETHUSDT · 1小时缠论分析";
  const msg = h.message("legacy", text);
  assert.match(h.renderMessageExecutionPlan(msg, text).cards, /ETH\/USDT 币安永续 1H/);
  h.renderAddToPlanAction(msg, text);
  await h.createExecutionPlanStickyFromMessageCard(h.card("legacy"));
  await h.addExecutionPlanFromMessageAction(h.button("legacy"));
  assert.match(h.runtime.sticky[0].title, /ETH\/USDT 币安永续 1H/);
  assert.match(h.runtime.alerts[0].title, /ETH\/USDT 币安永续 1H/);
});

test("a plan without original market context stays generic after another market is analyzed", async () => {
  const h = harness();
  const text = report("1H").split("## ETH/USDT 币安永续 1H · 空头条件方案")[0]
    .replace("ETH/USDT 币安永续 1H · 多头条件方案", "标准执行方案");
  const msg = h.message("generic", text);
  h.runtime.latest = "BTC4H";
  h.state.threads[0].name = "BTC4H";
  assert.doesNotMatch(h.renderMessageExecutionPlan(msg, text).cards, /BTC|4H/);
  h.renderAddToPlanAction(msg, text);
  await h.createExecutionPlanStickyFromMessageCard(h.card("generic"));
  assert.equal(h.runtime.sticky[0].title, "标准执行方案");
  await h.addExecutionPlanFromMessageAction(h.button("generic"));
  const [loaded] = plans.loadExecutionPlans("qa", h.store);
  assert.equal(loaded.title, "标准执行方案");
});
