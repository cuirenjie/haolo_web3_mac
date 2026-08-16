import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { stripConversationTitleMentionTokens } from "../src/renderer/conversation-title.ts";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

const tokens = [
  "@策略:缠论",
  "@策略：缠论",
  "@策略:订单流",
  "@策略：订单流",
  "@策略:波浪理论",
  "@策略：波浪理论",
  "@策略:威科夫",
  "@策略：威科夫",
  "@预警",
  "@知识库",
  "@指标:趋势带",
  "@指标：趋势带",
  "@自定义指标:趋势带",
  "@自定义指标：趋势带",
];

test("conversation titles remove trading-expert call tokens and keep only user wording", () => {
  assert.equal(stripConversationTitleMentionTokens("@策略:订单流 帮我分析", tokens), "帮我分析");
  assert.equal(stripConversationTitleMentionTokens("@策略：缠论  看一下 BTC", tokens), "看一下 BTC");
  assert.equal(
    stripConversationTitleMentionTokens("@指标:趋势带 @策略:波浪理论 帮我数浪", tokens),
    "帮我数浪",
  );
  assert.equal(stripConversationTitleMentionTokens("@自定义指标:趋势带 看趋势", tokens), "看趋势");
  assert.equal(stripConversationTitleMentionTokens("@知识库 查历史资料", tokens), "查历史资料");
  assert.equal(stripConversationTitleMentionTokens("@策略:威科夫", tokens), "");
  assert.equal(stripConversationTitleMentionTokens("@预警 BTC 跌破 60000 时通知我", tokens), "BTC 跌破 60000 时通知我");
  assert.equal(stripConversationTitleMentionTokens("联系 foo@example.com 帮我分析", tokens), "联系 foo@example.com 帮我分析");
});

test("new and historical thread title surfaces share the same mention sanitizer", async () => {
  const source = await mainSource;
  assert.match(source, /const TRADING_EXPERT_TITLE_MENTION_TOKENS = \[[\s\S]*TRADING_EXPERT_MENTION_CATALOG\.flatMap/);
  assert.match(source, /"@自定义指标:趋势带",[\s\S]*"@自定义指标：趋势带"/);
  assert.match(source, /function conversationTitleFromText\(text: string\) \{[\s\S]*?stripConversationTitleMentionTokens\(/);
  assert.match(source, /function cleanThreadDisplayTitle\([\s\S]*?stripConversationTitleMentionTokens\(/);
  assert.match(source, /function threadListDisplayName\([\s\S]*?cleanThreadDisplayTitle\(/);
  assert.match(source, /function chatHeaderTitle\([\s\S]*?cleanThreadDisplayTitle\(/);
});

test("trading-expert task sends refresh the sidebar title immediately", async () => {
  const source = await mainSource;
  assert.match(
    source,
    /function refreshTradingExpertConversationSurface\(threadId: string\) \{\s*if \(patchActiveChatSurfaces\(threadId, \{ patchThreadRow: true \}\)\) return;/,
  );
});
