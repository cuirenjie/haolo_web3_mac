import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS,
  CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
  COMPOSER_QUOTE_CONTEXT_MAX_TOKENS,
  DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS,
  DEEPSEEK_V4_FLASH_NATIVE_CONTEXT_WINDOW_TOKENS,
  GPT_5_5_DOWNGRADE_SWITCH_THRESHOLD_TOKENS,
  GPT_5_6_AUTO_COMPACT_THRESHOLD_TOKENS,
  GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS,
  NATIVE_MODEL_CONTEXT_WINDOW_TOKENS,
  SINGLE_INPUT_HARD_LIMIT_TOKENS,
  autoCompactThresholdForWindow,
  boundedComposerQuoteText,
  contextWindowForModel,
  decideContextBudget,
  decideModelSwitchContext,
  effectiveContextWindowForModel,
  estimateAgentTextTokens,
  isContextWindowExhaustedError,
  isDuplicateContextCompactionEvent,
} from "../src/renderer/context-budget.ts";

test("estimates CJK near one token per character and other text near four characters per token", () => {
  assert.equal(estimateAgentTextTokens("你好世界"), 4);
  assert.equal(estimateAgentTextTokens("abcdefgh"), 2);
  assert.equal(estimateAgentTextTokens("你好abcdefgh"), 4);
});

test("keeps short quote context intact and bounds long quotes with useful head and tail excerpts", () => {
  assert.equal(boundedComposerQuoteText("短引用"), "短引用");

  const longQuote = `开头标记-${"中".repeat(30_000)}-结尾标记`;
  const bounded = boundedComposerQuoteText(longQuote);

  assert.ok(estimateAgentTextTokens(bounded) <= COMPOSER_QUOTE_CONTEXT_MAX_TOKENS);
  assert.match(bounded, /^开头标记-/);
  assert.match(bounded, /结尾标记$/);
  assert.match(bounded, /已保留首尾并省略中间部分/);
});

test("composer quote injection includes a stable message id and bounds the whole quote body", async () => {
  const source = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(source, /`引用消息ID：\$\{quote\.messageId \|\| "未知"\}`/);
  assert.match(
    source,
    /return boundedComposerQuoteText\(parts\.filter\(Boolean\)\.join\("\\n"\)\);/,
  );
});

test("uses the managed OAuth GPT-5.5/5.6 window and an early compaction threshold", () => {
  assert.equal(NATIVE_MODEL_CONTEXT_WINDOW_TOKENS, 400_000);
  assert.equal(CURRENT_MODEL_CONTEXT_WINDOW_TOKENS, 380_000);
  assert.equal(CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS, 300_000);
  assert.equal(effectiveContextWindowForModel("gpt-5.5"), CURRENT_MODEL_CONTEXT_WINDOW_TOKENS);
  assert.equal(effectiveContextWindowForModel("GPT-5.6-TERRA"), GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS);
  assert.equal(GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS, CURRENT_MODEL_CONTEXT_WINDOW_TOKENS);
  assert.equal(DEEPSEEK_V4_FLASH_NATIVE_CONTEXT_WINDOW_TOKENS, 1_048_576);
  assert.equal(DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS, 996_147);
  assert.equal(
    effectiveContextWindowForModel("deepseek-flash"),
    DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS,
  );
  assert.deepEqual(
    autoCompactThresholdForWindow(DEEPSEEK_V4_FLASH_MODEL_CONTEXT_WINDOW_TOKENS),
    { tokens: 943_718, estimated: true },
  );
  assert.equal(effectiveContextWindowForModel("private-model"), null);
  assert.deepEqual(autoCompactThresholdForWindow(CURRENT_MODEL_CONTEXT_WINDOW_TOKENS), {
    tokens: CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS,
    estimated: false,
  });
  assert.deepEqual(autoCompactThresholdForWindow(95_000), { tokens: 90_000, estimated: true });
  assert.deepEqual(autoCompactThresholdForWindow(GPT_5_6_MODEL_CONTEXT_WINDOW_TOKENS), {
    tokens: GPT_5_6_AUTO_COMPACT_THRESHOLD_TOKENS,
    estimated: false,
  });
  assert.equal(contextWindowForModel("gpt-5.6-sol", 997_500), CURRENT_MODEL_CONTEXT_WINDOW_TOKENS);
  assert.equal(contextWindowForModel("gpt-5.6-sol", 353_400), 353_400);
  assert.equal(contextWindowForModel("private-model", 1_200_000), 1_200_000);
});

test("treats GPT-5.5 and GPT-5.6 as equal-window switches while retaining a safe real-downgrade guard", () => {
  assert.equal(
    decideModelSwitchContext({
      currentModel: "gpt-5.6-terra",
      targetModel: "gpt-5.5",
      currentContextTokens: 900_000,
      usageStale: true,
    }).reason,
    "not-downgrade",
  );
  assert.deepEqual(
    decideModelSwitchContext({
      currentModel: "private-1.2m-model",
      targetModel: "gpt-5.5",
      currentContextTokens: GPT_5_5_DOWNGRADE_SWITCH_THRESHOLD_TOKENS,
      currentModelContextWindow: 1_200_000,
    }),
    {
      action: "block",
      downgrade: true,
      reason: "target-budget-exceeded",
      currentModelContextWindow: 1_200_000,
      targetModelContextWindow: CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
      targetSwitchThreshold: GPT_5_5_DOWNGRADE_SWITCH_THRESHOLD_TOKENS,
    },
  );
  assert.equal(
    decideModelSwitchContext({
      currentModel: "gpt-5.5",
      targetModel: "gpt-5.6-terra",
      currentContextTokens: 900_000,
      usageStale: true,
    }).reason,
    "not-downgrade",
  );
});

test("allows ordinary input without a usage sample but still blocks a near-window single message", () => {
  assert.equal(
    decideContextBudget({ currentContextTokens: null, modelContextWindow: CURRENT_MODEL_CONTEXT_WINDOW_TOKENS, agentText: "正常消息" }).action,
    "allow",
  );
  assert.equal(
    decideContextBudget({
      currentContextTokens: null,
      modelContextWindow: CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
      agentText: "中".repeat(SINGLE_INPUT_HARD_LIMIT_TOKENS - 2_000),
    }).action,
    "block",
  );
});

test("requests pre-compaction when active context plus estimated input crosses the threshold", () => {
  const compact = decideContextBudget({
    currentContextTokens: 299_000,
    modelContextWindow: CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
    agentText: "继续处理这些内容",
  });
  assert.equal(compact.action, "compact");
  assert.equal(compact.autoCompactThreshold, CURRENT_AUTO_COMPACT_THRESHOLD_TOKENS);

  const allow = decideContextBudget({
    currentContextTokens: 250_000,
    modelContextWindow: CURRENT_MODEL_CONTEXT_WINDOW_TOKENS,
    agentText: "继续",
  });
  assert.equal(allow.action, "allow");
});

test("recognizes only explicit context-window exhaustion failures", () => {
  assert.equal(
    isContextWindowExhaustedError(
      "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
    ),
    true,
  );
  assert.equal(isContextWindowExhaustedError("Context window exceeded while compacting"), true);
  assert.equal(isContextWindowExhaustedError("context_length_exceeded"), true);
  assert.equal(isContextWindowExhaustedError("The prompt is too long for the model context"), true);
  assert.equal(isContextWindowExhaustedError("too many input tokens"), true);
  assert.equal(isContextWindowExhaustedError("maximum context length is 128000 tokens"), true);
  assert.equal(isContextWindowExhaustedError("等待模型响应超时"), false);
  assert.equal(isContextWindowExhaustedError("gateway connection reset"), false);
  assert.equal(isContextWindowExhaustedError(null), false);
});

test("deduplicates contextCompaction item completion and an unkeyed legacy completion", () => {
  const now = 10_000;
  const firstKeys = ["turn:turn-1", "item:compact-1"];
  assert.equal(
    isDuplicateContextCompactionEvent({ keys: firstKeys, seenKeys: [], status: "compacting", lastCompactedAt: null, now }),
    false,
  );
  assert.equal(
    isDuplicateContextCompactionEvent({
      keys: [],
      seenKeys: firstKeys,
      status: "completed",
      lastCompactedAt: now,
      now: now + 25,
    }),
    true,
  );
  assert.equal(
    isDuplicateContextCompactionEvent({
      keys: ["turn:turn-1"],
      seenKeys: firstKeys,
      status: "completed",
      lastCompactedAt: now,
      now: now + 25,
    }),
    true,
  );
  assert.equal(
    isDuplicateContextCompactionEvent({
      keys: ["turn:turn-2", "item:compact-2"],
      seenKeys: [],
      status: "completed",
      lastCompactedAt: now,
      now: now + 25,
    }),
    true,
    "a keyed item completion must not recount a recent unkeyed completion",
  );
});

test("renderer consumes last.totalTokens, marks compacted usage stale, and rechecks queued sends", async () => {
  const source = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const tokenHandler = source.slice(
    source.indexOf("function handleThreadTokenUsageNotification"),
    source.indexOf("function isContextCompactionItem"),
  );
  assert.match(tokenHandler, /tokenUsage\.last/);
  assert.match(tokenHandler, /last\.totalTokens/);
  assert.match(
    tokenHandler,
    /contextWindowForModel\([\s\S]*selectedChatModelValue\(threadId\)[\s\S]*reportedModelContextWindow/,
  );
  assert.match(tokenHandler, /notificationTurnId\(message\) \|\| activeTurnIdForThread\(threadId\)/);
  assert.doesNotMatch(tokenHandler, /tokenUsage\.total(?:\W|$)/);

  const compactHandler = source.slice(
    source.indexOf("function markContextCompactionSucceeded"),
    source.indexOf("function failContextCompaction"),
  );
  assert.match(compactHandler, /context\.usageStale = true/);
  assert.match(compactHandler, /context\.awaitingPostRecoveryUsage = true/);

  const queueFlush = source.slice(source.indexOf("async function flushQueuedSend"), source.indexOf("function beginCodexSend"));
  assert.match(queueFlush, /queuedSendFlushInFlight/);
  assert.match(queueFlush, /await prepareContextBudgetForSend\(next\.threadId, next\.agentText\)/);
});

test("temporary header context progress is removed while thinking usage remains", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);
  const headerRenderer = renderer.slice(
    renderer.indexOf("function renderChatHeader"),
    renderer.indexOf("function formatContextTokens"),
  );
  assert.doesNotMatch(headerRenderer, /contextUsage|上下文|测试/);
  assert.doesNotMatch(renderer, /SHOW_TEMP_CONTEXT_USAGE_PROGRESS/);
  assert.doesNotMatch(renderer, /renderTemporaryContextUsageProgress/);
  assert.doesNotMatch(renderer, /patchTemporaryContextUsageProgress/);
  assert.doesNotMatch(renderer, /data-temporary-context-usage/);
  assert.doesNotMatch(styles, /temporary-context-usage/);

  const thinkingUsage = renderer.slice(
    renderer.indexOf("function contextUsageProgressState"),
    renderer.indexOf("function renderSubagentCluster"),
  );
  assert.match(
    thinkingUsage,
    /contextWindowForModel\([\s\S]*threadModelSettings\(threadId\)\?\.model[\s\S]*context\?\.modelContextWindow/,
  );
  assert.match(thinkingUsage, /activeTurnIdForThread\(threadId\)/);
  assert.match(thinkingUsage, /context\?\.usageTurnId !== activeTurnId/);
  assert.match(
    thinkingUsage,
    /const usedTokens =\s*waitingForCurrentTurn \? null : \(\s*context\?\.usedTokens \?\? \(\s*isBlankNewThread\(threadId\) \? 0 : null\s*\)\s*\)/,
  );
  assert.match(thinkingUsage, /contextUsageProgressState\(id\)/);
  assert.match(thinkingUsage, /waitingForCurrentTurn/);
  assert.match(thinkingUsage, /if \(usage\.waitingForCurrentTurn\) return null/);
  assert.doesNotMatch(thinkingUsage, /上下文等待数据/);
});
