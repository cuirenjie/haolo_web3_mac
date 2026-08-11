import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  indexedTradingTranscriptThreads,
  mergeIndexedTradingTranscriptThreads,
  parseTradingTranscriptMarkerText,
  readTradingTranscriptItemsFromRollout,
  removeTradingTranscriptIndexThread,
  tradingTranscriptInjectionItems,
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
      data: [{ id: "thread-indexed-1", name: "runtime-visible" }],
    }, updated);
    assert.equal(deduplicated.data.length, 1);
    assert.equal(deduplicated.data[0].name, "runtime-visible");
    assert.equal(removeTradingTranscriptIndexThread(tempRoot, "thread-indexed-1"), true);
    assert.equal(indexedTradingTranscriptThreads(tempRoot, workspace).length, 0);
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
  assert.match(handler, /runSerializedThreadSettingsOperation\(threadId/);
  assert.match(handler, /"thread\/inject_items"/);
  assert.match(handler, /tradingTranscriptInjectionItems\(missingItems\)/);
  assert.match(handler, /tradingTranscriptItemsFromThreadResult\(threadResult\)/);
  assert.match(handler, /missingVerifiedIds/);
  assert.match(handler, /"thread\/name\/set"/);
  assert.match(handler, /updateTradingTranscriptIndex\(workspaceCodexHome\(cwd\)/);
  assert.match(preloadSource, /persistTradingTranscript:.*codex:persistTradingTranscript/);
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

test("all five chart-analysis branches persist the parent user message before returning", () => {
  const dispatch = sourceBlock(
    rendererSource,
    "const isTradingChartAnalysisSend = Boolean(",
    "if (isMultiModelClusterThread(threadId))",
  );
  const persistIndex = dispatch.indexOf("await persistTradingExpertTranscriptItems");
  assert.ok(persistIndex >= 0);
  for (const runner of [
    "runTradingChanChartRequest",
    "runTradingOrderFlowChartRequest",
    "runTradingWaveChartRequest",
    "runTradingWyckoffChartRequest",
    "runTradingGeneralChartRequest",
  ]) {
    assert.ok(dispatch.indexOf(`await ${runner}`) > persistIndex, `${runner} must run after parent persistence`);
  }
  assert.match(dispatch, /任务未执行：顶层会话保存失败/);
  assert.match(rendererSource, /payload\.slice\(index \* 32, index \* 32 \+ 32\)/);
});

test("all five chart-analysis runners persist progress and terminal messages", () => {
  const runnerSection = sourceBlock(
    rendererSource,
    "async function runTradingGeneralChartRequest",
    "function hasUploadingAttachments",
  );
  assert.equal((runnerSection.match(/const transcriptItems: CodexItem\[\] = \[\];/g) || []).length, 5);
  assert.equal((runnerSection.match(/await persistCompletedTradingExpertTranscript/g) || []).length, 10);
  assert.equal((runnerSection.match(/const reportItem = appendTradingExpertReport/g) || []).length, 5);
});
