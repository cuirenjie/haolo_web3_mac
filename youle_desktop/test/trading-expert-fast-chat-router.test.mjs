import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL,
  TRADING_EXPERT_FAST_CHAT_MODEL,
  buildTradingExpertFastChatRequest,
  classifyTradingExpertFastChatRoute,
  normalizeTradingExpertFastChatResult,
} from "../src/main/trading-analysis/fast-chat-router.mjs";

test("stable public questions use the low-latency direct route", () => {
  for (const text of [
    "你好，介绍一下你能做什么",
    "什么是 RSI 指标？",
    "支撑位和压力位有什么区别？",
    "解释一下资金费率的计算原理",
    "Translate this sentence into English: 风险来自未知。",
  ]) {
    assert.equal(
      classifyTradingExpertFastChatRoute({ text }, { enabled: true }).route,
      "direct",
      text,
    );
  }
});

test("chart and live-market requests stay on the chart-analysis router", () => {
  for (const text of [
    "帮我分析当前 ETH 走势并画出支撑线",
    "分析一下",
    "看看左边 K 线，现在适合做多吗？",
    "当前这根 K 线是什么意思？",
    "BTC 当前价格和入场点位怎么看",
    "分析SNDK 15min这个盘\r面并绘图",
    "那我现在做多可以吗",
    "我目前的仓位健康吗，该怎么操作",
    "Read the current chart and draw resistance lines",
  ]) {
    assert.equal(
      classifyTradingExpertFastChatRoute({ text }, { enabled: true }).route,
      "chart-router",
      text,
    );
  }

  assert.equal(
    classifyTradingExpertFastChatRoute({
      text: "分析附件里的当前行情并标注关键位",
      hasAttachments: true,
    }, { enabled: true }).route,
    "chart-router",
  );
});

test("private context, history, attachments, current web data, and actions require the root agent", () => {
  const cases = [
    [{ text: "查看我的仓位和账户余额" }, "private-context-required"],
    [{ text: "继续解释你刚才给出的止损方案" }, "conversation-history-required"],
    [{ text: "今天美联储最新利率消息是什么" }, "current-external-information-required"],
    [{ text: "打开本机文件并修改代码" }, "tool-or-local-resource-required"],
    [{ text: "总结这份资料", hasAttachments: true }, "attachment-required"],
    [{ text: "回答引用消息的问题", hasQuote: true }, "referenced-context-required"],
    [{ text: "比较这两个任务", hasThreadReferences: true }, "referenced-context-required"],
    [{ text: "帮我买入BTCUSDT" }, "execution-action-required"],
  ];
  for (const [params, reason] of cases) {
    const routed = classifyTradingExpertFastChatRoute(params, { enabled: true });
    assert.equal(routed.route, "agent", JSON.stringify(params));
    assert.equal(routed.reason, reason, JSON.stringify(params));
  }
});

test("feature flag can restore the all-agent route", () => {
  assert.deepEqual(
    classifyTradingExpertFastChatRoute(
      { text: "什么是均线？" },
      { enabled: false },
    ),
    {
      route: "agent",
      reason: "feature-disabled",
      model: TRADING_EXPERT_FAST_CHAT_MODEL,
    },
  );
});

test("direct request contains only fixed policy and the current question", () => {
  const request = buildTradingExpertFastChatRequest({
    text: "什么是移动平均线？",
    threadId: "thread-public",
    interactionId: "interaction-public",
  });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.reasoningEffort, "low");
  assert.equal(request.fixedReasoningEffort, "low");
  assert.equal(request.toolChoice, "auto");
  assert.equal(request.messages.length, 2);
  assert.deepEqual(request.messages.map((message) => message.role), ["developer", "user"]);
  assert.equal(request.messages[1].content, "什么是移动平均线？");
  assert.match(request.messages[0].content, /app interface language is English/);
  assert.match(request.messages[0].content, /Do not emit Chinese Han characters/);
  assert.equal(request.tools.length, 1);
  assert.equal(request.tools[0].function.name, TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL);
  assert.equal("attachments" in request, false);
  assert.equal("cwd" in request, false);
  assert.equal("threadReferences" in request, false);
  assert.equal("personalContext" in request, false);
});

test("model can answer directly or request a validated handoff", () => {
  assert.deepEqual(
    normalizeTradingExpertFastChatResult({ text: "RSI 是相对强弱指标。", toolCalls: [] }),
    { route: "direct", text: "RSI 是相对强弱指标。" },
  );
  assert.deepEqual(
    normalizeTradingExpertFastChatResult({
      text: "",
      toolCalls: [{
        function: {
          name: TRADING_EXPERT_FAST_CHAT_HANDOFF_TOOL,
          arguments: JSON.stringify({ reason: "Current chart data is required" }),
        },
      }],
    }),
    { route: "handoff", reason: "Current chart data is required" },
  );
  assert.deepEqual(
    normalizeTradingExpertFastChatResult({
      text: "",
      toolCalls: [{ function: { name: "read_positions", arguments: "{}" } }],
    }),
    { route: "handoff", reason: "unexpected-tool-protocol" },
  );
  assert.deepEqual(
    normalizeTradingExpertFastChatResult({ text: "", toolCalls: [] }),
    { route: "handoff", reason: "empty-direct-response" },
  );
});

test("desktop integration uses a narrow IPC and bypasses the file-context provider loop", () => {
  const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
  const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const handler = main.slice(
    main.indexOf('ipcMain.handle("tradingAnalysis:sendFastChat"'),
    main.indexOf('ipcMain.handle("youle:sendProviderChat"'),
  );
  assert.match(handler, /assertExternalModelsIpcSender\(event\)/);
  assert.match(handler, /classifyTradingExpertFastChatRoute\(params\)/);
  assert.match(handler, /getYouleApiClient\(\)\.sendProviderChat/);
  assert.doesNotMatch(handler, /prepareQuestionAnswerFileContext/);
  assert.doesNotMatch(handler, /resolvedThreadReferenceContext/);
  assert.match(preload, /routeTradingExpertFastChat/);
  assert.match(preload, /sendTradingExpertFastChat/);
  assert.match(renderer, /persistTradingExpertTranscriptItems/);
  assert.match(renderer, /activeProviderInteractionByThreadId\.set\(params\.threadId, interactionId\)/);
  assert.match(renderer, /if \(isProviderThreadBusy\(threadId\)\) return true/);
  assert.match(renderer, /deterministicTradingGeneralFallback\(params\.text\)\.mode === "chart-analysis"/);
  assert.match(renderer, /if \(deterministicChart\) \{\s*return \{ route: "chart-router"/s);
});
