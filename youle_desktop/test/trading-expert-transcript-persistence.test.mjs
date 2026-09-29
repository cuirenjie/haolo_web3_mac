import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  indexedTradingTranscriptThreads,
  loadTradingTranscriptIndex,
  mergeIndexedTradingTranscriptThreads,
  parseTradingTranscriptMarkerText,
  readTradingTranscriptItemsFromRollout,
  removeTradingTranscriptIndexThread,
  replaceTradingTranscriptIndexThread,
  resolveTradingTranscriptIndexThreadAlias,
  tradingTranscriptInjectionItems,
  tradingTranscriptItemsFromThreadResult,
  updateTradingTranscriptIndex,
  withTradingTranscriptHistory,
  withTradingTranscriptItems,
} from "../src/main/trading-expert-transcript.mjs";

const mainSource = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function transcriptItems() {
  return [
    {
      id: "local-user-persist-1",
      role: "user",
      text: "分析当前 BTC 1H 盘面",
      createdAt: "2026-08-11T08:00:00.000Z",
    },
    {
      id: "trading-report-persist-1",
      role: "assistant",
      phase: "final_answer",
      text: "当前结构保持震荡。",
      createdAt: "2026-08-11T08:00:02.000Z",
    },
  ];
}

test("trading transcript messages use explicit user and assistant injection items", () => {
  const injected = tradingTranscriptInjectionItems(transcriptItems());
  assert.equal(injected.length, 2);
  assert.deepEqual(injected.map((item) => item.role), ["user", "assistant"]);
  assert.deepEqual(injected.map((item) => item.content[0].type), ["input_text", "output_text"]);
  assert.equal(parseTradingTranscriptMarkerText(injected[0].content[0].text)?.id, "local-user-persist-1");
  assert.equal(parseTradingTranscriptMarkerText(injected[1].content[0].text)?.text, "当前结构保持震荡。");
});

test("execution-plan presentation survives transcript persistence and hydration", () => {
  const assistant = {
    ...transcriptItems()[1],
    id: "trading-report-presentation-1",
    text: "方向判断：偏多\n多头触发：100\n止损与失效：95\n分批止盈：110",
    executionPlanPresentation: "execution-plan",
  };
  const [injected] = tradingTranscriptInjectionItems([assistant]);
  const parsed = parseTradingTranscriptMarkerText(injected.content[0].text);
  assert.equal(parsed?.executionPlanPresentation, "execution-plan");

  const hydrated = withTradingTranscriptItems({ thread: { id: "thread-presentation", turns: [] } }, [assistant]);
  assert.equal(hydrated.thread.turns[0].items[0].__youleExecutionPlanPresentation, "execution-plan");
});

test("trading alert success navigation survives transcript persistence and hydration", () => {
  const action = {
    id: "open-trading-alerts",
    kind: "navigate",
    label: "查看我的预警",
    destination: "trading-alerts",
    alert_id: "alert-persisted-action",
  };
  const assistant = {
    ...transcriptItems()[1],
    id: "trading-alert-success-action",
    text: "预警已创建：趋势线触碰预警",
    actions: [action],
  };
  const [injected] = tradingTranscriptInjectionItems([assistant]);
  assert.deepEqual(parseTradingTranscriptMarkerText(injected.content[0].text)?.actions, [action]);

  const hydrated = withTradingTranscriptItems({ thread: { id: "thread-alert-action", turns: [] } }, [assistant]);
  assert.deepEqual(hydrated.thread.turns[0].items[0].actions, [action]);
});

test("Binance account navigation survives transcript persistence and hydration", () => {
  const action = {
    id: "connect-binance-account",
    kind: "navigate",
    label: "连接币安",
    destination: "binance-account",
  };
  const assistant = {
    ...transcriptItems()[1],
    id: "trading-preference-binance-action",
    text: "是否愿意连接币安账户的只读权限？",
    actions: [action],
  };
  const [injected] = tradingTranscriptInjectionItems([assistant]);
  assert.deepEqual(parseTradingTranscriptMarkerText(injected.content[0].text)?.actions, [action]);

  const hydrated = withTradingTranscriptItems({ thread: { id: "thread-binance-action", turns: [] } }, [assistant]);
  assert.deepEqual(hydrated.thread.turns[0].items[0].actions, [action]);
});

test("rollout recovery restores transcript items once after restart", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-transcript-"));
  const rolloutPath = path.join(tempRoot, "rollout.jsonl");
  try {
    const injected = tradingTranscriptInjectionItems(transcriptItems());
    const lines = [
      JSON.stringify({ timestamp: "2026-08-11T08:00:00.000Z", type: "response_item", payload: injected[0] }),
      JSON.stringify({ timestamp: "2026-08-11T08:00:00.100Z", type: "event_msg", payload: injected[0] }),
      JSON.stringify({ timestamp: "2026-08-11T08:00:02.000Z", type: "response_item", payload: injected[1] }),
      "{incomplete",
    ];
    fs.writeFileSync(rolloutPath, `${lines.join("\n")}\n`, "utf8");
    const restored = await readTradingTranscriptItemsFromRollout(rolloutPath);
    assert.deepEqual(restored.map((item) => item.id), [
      "local-user-persist-1",
      "trading-report-persist-1",
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("explicit persistence verification scans a new unindexed thread rollout", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-unindexed-"));
  const rolloutPath = path.join(
    tempRoot,
    "sessions",
    "2026",
    "08",
    "11",
    "rollout-2026-08-11T08-00-00-new-unindexed-thread.jsonl",
  );
  try {
    const [injected] = tradingTranscriptInjectionItems(transcriptItems());
    fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
    fs.writeFileSync(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-08-11T08:00:00.000Z", type: "response_item", payload: injected })}\n`,
      "utf8",
    );
    const guarded = await tradingTranscriptItemsFromThreadResult({
      thread: { id: "new-unindexed-thread", path: rolloutPath, turns: [] },
    }, { codexHome: tempRoot });
    assert.deepEqual(guarded, []);

    const verified = await tradingTranscriptItemsFromThreadResult({
      thread: { id: "new-unindexed-thread", turns: [] },
    }, { codexHome: tempRoot, scanUnindexed: true });
    assert.deepEqual(verified.map((item) => item.id), ["local-user-persist-1"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("hydration merges injected transcript with later ordinary turns in timestamp order", () => {
  const hydrated = withTradingTranscriptItems({
    thread: {
      id: "thread-persist-1",
      turns: [{
        id: "ordinary-turn",
        startedAt: "2026-08-11T08:01:00.000Z",
        items: [{ id: "ordinary-user", type: "userMessage", text: "继续" }],
      }],
    },
  }, transcriptItems());
  assert.deepEqual(hydrated.thread.turns.map((turn) => turn.id), [
    "haolo-trading-transcript-turn-local-user-persist-1",
    "ordinary-turn",
  ]);
  assert.deepEqual(hydrated.thread.turns[0].items.map((item) => item.type), [
    "userMessage",
    "agentMessage",
  ]);
  assert.equal(hydrated.thread.turns[0].items[1].phase, "final_answer");
  assert.equal(hydrated.thread.turns[0].status, "completed");
  assert.equal(hydrated.thread.turns[0].items[1].__youleTurnStatus, "completed");
  assert.equal(hydrated.thread.turns[0].items[1].__haoloTradingTranscript, true);
  assert.equal(hydrated.thread.turns[0].startedAt, "2026-08-11T08:00:00.000Z");
  assert.equal(hydrated.thread.turns[0].completedAt, "2026-08-11T08:00:02.000Z");
});

test("hydration preserves explicit analysis timing across progress and final messages", () => {
  const items = [
    {
      id: "local-user-timed-1",
      role: "user",
      text: "分析 BTC",
      createdAt: "2026-08-11T08:00:00.000Z",
    },
    {
      id: "trading-progress-timed-1",
      role: "assistant",
      phase: "commentary",
      text: "正在读取行情",
      createdAt: "2026-08-11T08:00:01.000Z",
      startedAt: "2026-08-11T08:00:00.500Z",
      completedAt: "2026-08-11T08:00:06.250Z",
    },
    {
      id: "trading-report-timed-1",
      role: "assistant",
      phase: "final_answer",
      text: "分析完成",
      createdAt: "2026-08-11T08:00:06.000Z",
      startedAt: "2026-08-11T08:00:00.500Z",
      completedAt: "2026-08-11T08:00:06.250Z",
    },
  ];
  const [injectedProgress] = tradingTranscriptInjectionItems([items[1]]);
  assert.equal(
    parseTradingTranscriptMarkerText(injectedProgress.content[0].text)?.completedAt,
    "2026-08-11T08:00:06.250Z",
  );

  const hydrated = withTradingTranscriptItems({ thread: { id: "thread-timed", turns: [] } }, items);
  assert.equal(hydrated.thread.turns.length, 1);
  assert.equal(hydrated.thread.turns[0].startedAt, "2026-08-11T08:00:00.500Z");
  assert.equal(hydrated.thread.turns[0].completedAt, "2026-08-11T08:00:06.250Z");
  assert.deepEqual(
    hydrated.thread.turns[0].items.map((item) => item.__youleTurnStartedAt || null),
    [null, "2026-08-11T08:00:00.500Z", "2026-08-11T08:00:00.500Z"],
  );
});

test("hydration unwraps app-server surfaced injection items without duplicating them", () => {
  const [injectedUser] = tradingTranscriptInjectionItems(transcriptItems());
  const hydrated = withTradingTranscriptItems({
    thread: {
      id: "thread-persist-2",
      turns: [{
        id: "surfaced-turn",
        startedAt: "2026-08-11T08:00:00.000Z",
        items: [{ id: "server-item", type: "message", ...injectedUser }],
      }],
    },
  }, [transcriptItems()[0]]);
  assert.equal(hydrated.thread.turns.length, 1);
  assert.equal(hydrated.thread.turns[0].items[0].id, "local-user-persist-1");
  assert.equal(hydrated.thread.turns[0].items[0].text, "分析当前 BTC 1H 盘面");
});

test("non-trading thread hydration skips rollout scanning when no discovery record exists", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-scan-guard-"));
  const missingRolloutPath = path.join(tempRoot, "must-not-be-opened.jsonl");
  try {
    const original = {
      thread: {
        id: "ordinary-thread",
        path: missingRolloutPath,
        turns: [],
      },
    };
    const hydrated = await withTradingTranscriptHistory(original, { codexHome: tempRoot });
    assert.equal(hydrated, original);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the discovery index stores bounded metadata while the transcript stays in the rollout", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-index-"));
  const workspace = path.join(tempRoot, "workspace");
  const rolloutPath = path.join(tempRoot, "rollout.jsonl");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(rolloutPath, "{}\n", "utf8");
  try {
    updateTradingTranscriptIndex(tempRoot, {
      threadId: "thread-indexed-1",
      cwd: workspace,
      rolloutPath,
      title: "BTC 盘面分析",
      preview: `震荡结构${"长".repeat(600)}`,
      createdAt: "2026-08-11T08:00:00.000Z",
      updatedAt: "2026-08-11T08:00:02.000Z",
    });
    const indexed = indexedTradingTranscriptThreads(tempRoot, workspace);
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].hasUserEvent, true);
    const merged = mergeIndexedTradingTranscriptThreads({ data: [] }, indexed);
    assert.equal(merged.data[0].id, "thread-indexed-1");
    const rawIndex = fs.readFileSync(path.join(tempRoot, "trading-transcript-index.json"), "utf8");
    assert.doesNotMatch(rawIndex, /haolo_trading_transcript_item|trading-report-persist-1/);
    assert.equal(JSON.parse(rawIndex).threads["thread-indexed-1"].preview.length, 500);

    updateTradingTranscriptIndex(tempRoot, {
      threadId: "thread-indexed-1",
      cwd: workspace,
      rolloutPath,
      title: "",
      preview: "最终结论",
      createdAt: "2026-08-11T08:00:03.000Z",
      updatedAt: "2026-08-11T08:00:03.000Z",
    });
    const updated = indexedTradingTranscriptThreads(tempRoot, workspace);
    assert.equal(updated[0].name, "BTC 盘面分析");
    assert.equal(updated[0].preview, "最终结论");
    assert.equal(updated[0].createdAt, "2026-08-11T08:00:00.000Z");

    const deduplicated = mergeIndexedTradingTranscriptThreads({
      data: [{ id: "thread-indexed-1", name: "runtime-visible", preview: "正在整理结果" }],
    }, updated);
    assert.equal(deduplicated.data.length, 1);
    assert.equal(deduplicated.data[0].name, "runtime-visible");
    assert.equal(deduplicated.data[0].preview, "最终结论");
    assert.equal(deduplicated.data[0].updatedAt, "2026-08-11T08:00:03.000Z");
    const newerActiveServerThread = mergeIndexedTradingTranscriptThreads({
      data: [{
        id: "thread-indexed-1",
        name: "runtime-visible",
        preview: "用户正在输入新的分析问题",
        updatedAt: "2026-08-11T08:00:04.000Z",
      }],
    }, updated);
    assert.equal(newerActiveServerThread.data[0].preview, "用户正在输入新的分析问题");
    assert.equal(newerActiveServerThread.data[0].updatedAt, "2026-08-11T08:00:04.000Z");
    const recoveredDefaultTitle = mergeIndexedTradingTranscriptThreads({
      data: [{ id: "thread-indexed-1", name: "新任务" }],
    }, updated);
    assert.equal(recoveredDefaultTitle.data[0].name, "BTC 盘面分析");
    assert.equal(removeTradingTranscriptIndexThread(tempRoot, "thread-indexed-1"), true);
    assert.equal(indexedTradingTranscriptThreads(tempRoot, workspace).length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("thread replacement atomically preserves transcript metadata and durable aliases", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-replacement-"));
  const workspace = path.join(tempRoot, "workspace");
  const firstRollout = path.join(tempRoot, "first.jsonl");
  const secondRollout = path.join(tempRoot, "second.jsonl");
  const thirdRollout = path.join(tempRoot, "third.jsonl");
  fs.mkdirSync(workspace, { recursive: true });
  [firstRollout, secondRollout, thirdRollout].forEach((filePath) => fs.writeFileSync(filePath, "{}\n", "utf8"));
  try {
    updateTradingTranscriptIndex(tempRoot, {
      threadId: "thread-before-relogin",
      cwd: workspace,
      rolloutPath: firstRollout,
      title: "BTC trend alert",
      preview: "confirm",
      createdAt: "2026-08-11T08:00:00.000Z",
      updatedAt: "2026-08-11T08:01:00.000Z",
    });
    replaceTradingTranscriptIndexThread(tempRoot, "thread-before-relogin", {
      threadId: "thread-after-relogin",
      cwd: workspace,
      rolloutPath: secondRollout,
      title: "",
      preview: "continue",
      createdAt: "2026-08-11T08:02:00.000Z",
      updatedAt: "2026-08-11T08:02:00.000Z",
    });
    let index = loadTradingTranscriptIndex(tempRoot);
    assert.equal(index.threads["thread-before-relogin"], undefined);
    assert.equal(index.threads["thread-after-relogin"].title, "BTC trend alert");
    assert.equal(index.threads["thread-after-relogin"].createdAt, "2026-08-11T08:00:00.000Z");
    assert.equal(
      resolveTradingTranscriptIndexThreadAlias(tempRoot, "thread-before-relogin"),
      "thread-after-relogin",
    );

    replaceTradingTranscriptIndexThread(tempRoot, "thread-after-relogin", {
      threadId: "thread-after-second-relogin",
      cwd: workspace,
      rolloutPath: thirdRollout,
      title: "",
      preview: "continue again",
      createdAt: "2026-08-11T08:03:00.000Z",
      updatedAt: "2026-08-11T08:03:00.000Z",
    });
    index = loadTradingTranscriptIndex(tempRoot);
    assert.equal(Object.keys(index.threads).length, 1);
    assert.equal(
      resolveTradingTranscriptIndexThreadAlias(tempRoot, "thread-before-relogin"),
      "thread-after-second-relogin",
    );
    assert.equal(removeTradingTranscriptIndexThread(tempRoot, "thread-after-second-relogin"), true);
    index = loadTradingTranscriptIndex(tempRoot);
    assert.deepEqual(index.threads, {});
    assert.deepEqual(index.aliases, {});
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("thread replacement derives alert titles from the trigger preview", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-title-repair-"));
  const workspace = path.join(tempRoot, "workspace");
  const rolloutPath = path.join(tempRoot, "replacement.jsonl");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(rolloutPath, "{}\n", "utf8");
  try {
    const replaced = replaceTradingTranscriptIndexThread(tempRoot, "thread-missing", {
      threadId: "thread-replacement",
      cwd: workspace,
      rolloutPath,
      title: "",
      preview: "预警真实触发：BTC/USDT 币安永续 1H 预警",
      createdAt: "2026-09-04T12:37:04.000Z",
      updatedAt: "2026-09-04T12:37:04.000Z",
    });
    assert.equal(replaced.title, "BTC/USDT 币安永续 1H 预警");
    assert.doesNotMatch(replaced.title, /[æåä][^\s]*/u);
    assert.equal(
      loadTradingTranscriptIndex(tempRoot).threads["thread-replacement"].title,
      "BTC/USDT 币安永续 1H 预警",
    );
    const fallback = replaceTradingTranscriptIndexThread(tempRoot, "another-missing-thread", {
      threadId: "generic-replacement",
      cwd: workspace,
      rolloutPath,
      title: "",
      preview: "普通会话消息",
      createdAt: "2026-09-04T12:38:04.000Z",
      updatedAt: "2026-09-04T12:38:04.000Z",
    });
    assert.equal(fallback.title, "新任务");
    assert.doesNotMatch(fallback.title, /[æåä][^\s]*/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("legacy mojibake transcript titles are normalized during index loading", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-title-migration-"));
  const workspace = path.join(tempRoot, "workspace");
  const rolloutPath = path.join(tempRoot, "legacy.jsonl");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(rolloutPath, "{}\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "trading-transcript-index.json"), JSON.stringify({
    version: 1,
    threads: {
      "legacy-thread": {
        threadId: "legacy-thread",
        cwd: workspace,
        rolloutPath,
        title: "\u00e6\u2013\u00b0\u00e4\u00bb\u00bb\u00e5\u0160\u00a1",
        preview: "预警真实触发：BTC/USDT 币安永续 1H 预警  BTC 价格达到 79617.228 时触发开多预警",
        createdAt: "2026-09-04T12:37:04.000Z",
        updatedAt: "2026-09-04T12:37:04.000Z",
      },
    },
    aliases: {},
  }), "utf8");
  try {
    const loaded = loadTradingTranscriptIndex(tempRoot);
    assert.equal(loaded.threads["legacy-thread"].title, "BTC/USDT 币安永续 1H 预警");
    assert.equal(indexedTradingTranscriptThreads(tempRoot, workspace)[0].name, "BTC/USDT 币安永续 1H 预警");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main process persists and verifies the top-level transcript under the thread lock", () => {
  const handler = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:persistTradingTranscript"',
    'ipcMain.handle("codex:stageContinuationPrompt"',
  );
  assert.match(handler, /runSerializedThreadSettingsOperation\(requestedThreadId/);
  assert.match(handler, /"thread\/inject_items"/);
  assert.match(handler, /tradingTranscriptInjectionItems\(missingItems\.slice\(index, index \+ 32\)\)/);
  assert.match(handler, /tradingTranscriptItemsFromThreadResult\(threadResult, \{/);
  assert.match(handler, /scanUnindexed: true/);
  assert.match(handler, /verificationDelaysMs = \[0, 40, 120, 250, 500\]/);
  assert.match(handler, /missingVerifiedIds/);
  assert.match(handler, /"thread\/name\/set"/);
  assert.match(handler, /resolveTradingTranscriptIndexThreadAlias/);
  assert.match(handler, /readTradingTranscriptItemsFromRollout/);
  assert.match(handler, /isThreadNotFoundError/);
  assert.match(handler, /requestThreadStart/);
  assert.match(handler, /replaceTradingTranscriptIndexThread/);
  assert.match(handler, /replacementThread/);
  assert.match(handler, /const effectiveTitle = title \|\| recoveryRecord\?\.title \|\| ""/);
  assert.match(handler, /if \(effectiveTitle && \(title \|\| requestedItems\.some\(\(item\) => item\.role === "user"\)\)\)/);
  assert.match(handler, /replacedThreadId: requestedThreadId/);
  assert.match(preloadSource, /persistTradingTranscript:.*codex:persistTradingTranscript/);
  assert.match(
    rendererSource,
    /handleTradingAlertTriggered[\s\S]*persistCompletedTradingExpertTranscript\(threadId, \[item\], \{[\s\S]*title: firstString\(payload\?\.title\)/,
  );
});

test("thread listing merges indexed top-level trading transcripts", () => {
  const handler = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:listThreads"',
    'ipcMain.handle("codex:modelList"',
  );
  assert.match(handler, /indexedTradingTranscriptThreads\(workspaceCodexHome\(cwd\), cwd\)/);
  assert.match(handler, /mergeIndexedTradingTranscriptThreads/);
  assert.match(handler, /return mergedResult/);
});

test("archiving a top-level thread removes its discovery index record", () => {
  const handler = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:archiveThread"',
    'ipcMain.handle("codex:sendMessage"',
  );
  assert.match(handler, /await requestAppServer\(serverClient, "thread\/archive"/);
  assert.match(handler, /removeTradingTranscriptIndexThread\(workspaceCodexHome\(archiveCwd\), threadId\)/);
});

test("foreground and background reads hydrate the persisted trading transcript", () => {
  const compact = sourceBlock(
    mainSource,
    "async function compactActiveThreadReadResultWithContextUsage",
    'ipcMain.handle("codex:readThreadForBackgroundHydration"',
  );
  const background = sourceBlock(
    mainSource,
    'ipcMain.handle("codex:readThreadForBackgroundHydration"',
    'ipcMain.handle("codex:resumeThread"',
  );
  assert.match(compact, /withTradingTranscriptHistory\(result, \{/);
  assert.match(background, /withTradingTranscriptHistory\(result, \{/);
});

test("reselecting a trading history always refreshes the durable transcript surface", () => {
  const refresh = sourceBlock(
    rendererSource,
    "async function refreshCachedThreadAfterSelection",
    "function activateLocalGroupChatThread",
  );
  assert.match(refresh, /isTradingExpertSurfaceThreadId\(threadId\)/);
  assert.match(refresh, /hasFreshThreadDetailCache\(threadId\) && !forceTradingExpertTranscriptRefresh/);
  assert.match(rendererSource, /payload\?\.status === "completed" && \(stage === "model" \|\| stage === "analysis_pipeline"\)\) return/);
});

test("generic strategy and general chart-analysis start after persistence or a non-blocking retry handoff", () => {
  const dispatch = sourceBlock(
    rendererSource,
    "const isTradingChartAnalysisSend = Boolean(",
    "if (isMultiModelClusterThread(threadId))",
  );
  const persistIndex = dispatch.indexOf("await persistTradingExpertTranscriptItems");
  assert.ok(persistIndex >= 0);
  for (const runner of [
    "runTradingStrategyChartRequest",
    "runTradingGeneralChartRequest",
  ]) {
    assert.ok(dispatch.indexOf(`await ${runner}`) > persistIndex, `${runner} must run after parent persistence`);
  }
  assert.doesNotMatch(dispatch, /任务未执行：顶层会话保存失败/);
  assert.match(dispatch, /queueTradingExpertTranscriptPersistenceRetry/);
  assert.doesNotMatch(dispatch, /会话记录将在后台自动重试保存，盘面分析继续/);
  assert.doesNotMatch(rendererSource, /会话记录将在后台自动重试保存，不影响本次回答/);
  assert.match(rendererSource, /payload\.slice\(index \* 32, index \* 32 \+ 32\)/);
  assert.match(dispatch, /threadId = persistedThreadId/);
  assert.match(rendererSource, /adoptReplacementCodexThread\(previousThreadId, result\.replacementThread, 0\)/);
  assert.match(rendererSource, /movePendingComposerSend\(previousThreadId, activeThreadId, pending\.itemId\)/);
});

test("generic strategy and general chart-analysis runners persist every completed or degraded terminal answer", () => {
  const runnerSection = sourceBlock(
    rendererSource,
    "async function runTradingGeneralChartRequest",
    "function hasUploadingAttachments",
  );
  assert.equal((runnerSection.match(/const transcriptItems: CodexItem\[\] = \[\];/g) || []).length, 2);
  assert.ok((runnerSection.match(/await persistCompletedTradingExpertTranscript/g) || []).length >= 6);
  assert.ok((runnerSection.match(/const reportItem = appendTradingExpertReport/g) || []).length >= 4);
  assert.match(runnerSection, /自动切换到通用价格结构链路继续回答/);
  assert.doesNotMatch(runnerSection, /盘面分析未完成/);
});
