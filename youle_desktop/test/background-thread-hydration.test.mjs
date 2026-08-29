import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compactActiveThreadNotification,
  compactActiveThreadReadResult,
  compactBackgroundThreadReadResult,
  readLatestThreadContextUsage,
} from "../src/main/background-thread-hydration.mjs";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("background thread reads keep conversation messages and discard process-heavy items", () => {
  const command = { id: "command", type: "commandExecution", aggregatedOutput: "x".repeat(500_000) };
  const source = {
    model: "test-model",
    thread: {
      id: "thread-1",
      name: "Example",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            { id: "user", type: "userMessage", text: "question" },
            command,
            { id: "reasoning", type: "reasoning", text: "private process" },
            { id: "tool", type: "mcpToolCall", result: "large tool result" },
            { id: "change", type: "fileChange", changes: ["large patch"] },
            { id: "compaction", type: "contextCompaction" },
            { id: "assistant", type: "agentMessage", text: "answer" },
          ],
        },
      ],
    },
  };

  const compacted = compactBackgroundThreadReadResult(source);

  assert.deepEqual(compacted.thread.turns[0].items.map((item) => item.type), ["userMessage", "agentMessage"]);
  assert.equal(compacted.model, source.model);
  assert.equal(compacted.thread.name, source.thread.name);
  assert.equal(compacted.thread.turns[0].status, source.thread.turns[0].status);
  assert.equal(source.thread.turns[0].items.includes(command), true, "the app-server response must not be mutated");
});

test("active thread hydration preserves conversation text but bounds nested process output", () => {
  const hugeOutput = `${"head".repeat(2_000)}${"x".repeat(2_600_000)}${"tail".repeat(2_000)}`;
  const user = { id: "user", type: "userMessage", text: "exact question" };
  const assistant = { id: "assistant", type: "agentMessage", text: "exact answer" };
  const tool = {
    id: "tool",
    type: "dynamicToolCall",
    result: { content: [{ type: "text", text: hugeOutput }] },
  };
  const source = {
    thread: {
      id: "thread-1",
      turns: [{ id: "turn-1", items: [user, tool, assistant] }],
    },
  };

  const compacted = compactActiveThreadReadResult(source);
  const compactedItems = compacted.thread.turns[0].items;
  const compactedOutput = compactedItems[1].result.content[0].text;

  assert.equal(compactedItems[0], user);
  assert.equal(compactedItems[2], assistant);
  assert.equal(compactedOutput.length < 17_000, true);
  assert.match(compactedOutput, /process output truncated for renderer/);
  assert.equal(compactedOutput.startsWith("head"), true);
  assert.equal(compactedOutput.endsWith("tail"), true);
  assert.equal(tool.result.content[0].text, hugeOutput, "the canonical app-server snapshot must stay untouched");
});

test("active hydration replaces oversized historical tool data images with a valid text block", () => {
  const imageUrl = `data:image/png;base64,${"A".repeat(2_600_000)}`;
  const imageBlock = { type: "input_image", image_url: imageUrl, detail: "original" };
  const source = {
    thread: {
      id: "thread-with-tool-image",
      turns: [{
        items: [{
          id: "tool",
          type: "dynamicToolCall",
          output: [
            { type: "input_text", text: "Script completed" },
            imageBlock,
          ],
        }],
      }],
    },
  };

  const compacted = compactActiveThreadReadResult(source);
  const compactedBlock = compacted.thread.turns[0].items[0].output[1];

  assert.deepEqual(compactedBlock, {
    type: "input_text",
    text: `[historical tool image omitted from renderer: ${imageUrl.length} chars]`,
  });
  assert.equal(imageBlock.image_url, imageUrl, "the canonical historical image must stay untouched");
});

test("thread started notifications use the same active snapshot compaction", () => {
  const message = {
    method: "thread/started",
    params: {
      thread: {
        id: "thread-1",
        turns: [{ items: [{ id: "tool", type: "mcpToolCall", result: "x".repeat(500_000) }] }],
      },
    },
  };

  const compacted = compactActiveThreadNotification(message);

  assert.equal(compacted.params.thread.turns[0].items[0].result.length < 17_000, true);
  assert.equal(message.params.thread.turns[0].items[0].result.length, 500_000);
  assert.equal(compactActiveThreadNotification({ method: "turn/started", params: {} }).method, "turn/started");
});

test("latest context usage is recovered from the rollout tail without loading conversation payloads", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "haolo-rollout-usage-"));
  const rolloutPath = path.join(tempDir, "rollout.jsonl");
  try {
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({ type: "response_item", payload: { type: "message", content: "x".repeat(12_000) } }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: { total_tokens: 142_058 },
              model_context_window: 353_400,
            },
          },
        }),
        JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await readLatestThreadContextUsage({ path: rolloutPath }), {
      usedTokens: 142_058,
      modelContextWindow: 353_400,
    });
    assert.equal(await readLatestThreadContextUsage({ path: path.join(tempDir, "missing.jsonl") }), null);
    assert.equal(await readLatestThreadContextUsage({ path: path.join(tempDir, "not-a-rollout.txt") }), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("a trailing zero after near-full usage is recovered before the first old-thread send", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "haolo-rollout-zero-usage-"));
  const nearFullPath = path.join(tempDir, "near-full.jsonl");
  const lowUsagePath = path.join(tempDir, "low-usage.jsonl");
  const tokenCount = (usedTokens) =>
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { total_tokens: usedTokens },
          model_context_window: 997_500,
        },
      },
    });
  try {
    await writeFile(nearFullPath, [tokenCount(900_000), tokenCount(0), tokenCount(0), ""].join("\n"), "utf8");
    await writeFile(lowUsagePath, [tokenCount(120_000), tokenCount(0), tokenCount(0), ""].join("\n"), "utf8");

    assert.deepEqual(await readLatestThreadContextUsage({ path: nearFullPath }), {
      usedTokens: 997_500,
      modelContextWindow: 997_500,
    });
    assert.deepEqual(await readLatestThreadContextUsage({ path: lowUsagePath }), {
      usedTokens: 0,
      modelContextWindow: 997_500,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("background hydration is wired through read-only thread/read IPC", async () => {
  const main = await mainSource;
  const preload = await preloadSource;
  const renderer = await rendererSource;
  const handler = sourceBlock(main, 'ipcMain.handle("codex:readThreadForBackgroundHydration"', 'ipcMain.handle("codex:resumeThread"');
  const broker = sourceBlock(renderer, "function resumeThreadForBackgroundHydration", "function recentThreadDetailPrefetchCandidates");
  const prefetch = sourceBlock(renderer, "async function prefetchThreadDetail", "function resetRecentThreadDetailPrefetch");

  assert.match(handler, /"thread\/read"/);
  assert.match(handler, /\{ threadId, includeTurns: true \}/);
  assert.match(handler, /params\.displayCache === true[\s\S]*compactActiveThreadReadResultWithContextUsage\(result, cwd\)[\s\S]*withTradingTranscriptHistory\(result, \{[\s\S]*compactBackgroundThreadReadResult\(hydrated\)/);
  assert.match(handler, /readLatestThreadContextUsage\(hydrated\?\.thread\)[\s\S]*contextUsage/);
  assert.doesNotMatch(handler, /thread\/resume|refreshSkillsDeveloperInstructions|snapshotThreadArtifacts/);
  assert.match(preload, /readThreadForBackgroundHydration: \(params\) => ipcRenderer\.invoke\("codex:readThreadForBackgroundHydration", params\)/);
  assert.match(broker, /api\.readThreadForBackgroundHydration\(\{[\s\S]*threadId,[\s\S]*cwd: threadWorkspaceCwd\(threadId\)[\s\S]*displayCache: true/);
  assert.match(broker, /applyThreadContextUsageSnapshot\(threadId, result\?\.contextUsage\)/);
  assert.doesNotMatch(broker, /resumeThreadWithModelLock|api\.resumeThread|activate:\s*false/);
  assert.match(prefetch, /resumeThreadForBackgroundHydration\(threadId, hydrationSession, \{ displayCache: true \}\)/);
  assert.match(prefetch, /if \(threadSwitchTransition \|\| switchingThreadId\)[\s\S]*retryAfterForegroundWork = true/);
  assert.match(prefetch, /pendingThreadDetailPrefetches\.add\(threadId\)/);
  assert.match(prefetch, /loadThreadInBackground\(result\?\.thread, \{ preserveListOrder: true \}\)/);
  assert.doesNotMatch(prefetch, /resumeThreadWithModelLock|api\.resumeThread/);
});

test("recent detail prefetch is bounded, serialized, and never blocks startup", async () => {
  const renderer = await rendererSource;
  const scheduling = sourceBlock(renderer, "function recentThreadDetailPrefetchCandidates", "function assistantPreviewHydrationActiveKey");
  const loadThreads = sourceBlock(renderer, "async function loadThreads", "async function reconcilePersistedThreadContinuations");

  assert.match(renderer, /THREAD_DETAIL_PREFETCH_LIMIT = 5/);
  assert.match(renderer, /THREAD_DETAIL_PREFETCH_CONCURRENCY = 1/);
  assert.match(renderer, /THREAD_DETAIL_PREFETCH_DELAY_MS = 600/);
  assert.match(scheduling, /slice\(0, THREAD_DETAIL_PREFETCH_LIMIT\)/);
  assert.match(scheduling, /activeThreadDetailPrefetches\.size < THREAD_DETAIL_PREFETCH_CONCURRENCY/);
  assert.match(loadThreads, /scheduleRecentThreadDetailPrefetch\(\)/);
  assert.doesNotMatch(loadThreads, /await scheduleRecentThreadDetailPrefetch/);
});

test("background hydration keeps the conversation list DOM stable and deduplicates current detail reads", async () => {
  const renderer = await rendererSource;
  const selectBlock = sourceBlock(renderer, "async function selectThread", "function selectAutoTaskThread");
  const cacheBlock = sourceBlock(renderer, "function hasFullyLoadedThreadDetailCache", "function threadDetailSnapshotSignature");
  const cachedRefreshBlock = sourceBlock(renderer, "async function refreshCachedThreadAfterSelection", "async function selectThread");
  const backgroundBroker = sourceBlock(renderer, "function resumeThreadForBackgroundHydration", "function recentThreadDetailPrefetchCandidates");
  const previewPolicy = sourceBlock(renderer, "function shouldHydrateAssistantPreview", "function shouldHydrateAttachmentOnlyTitle");
  const previewHydration = sourceBlock(renderer, "async function hydrateAssistantPreviewForThread", "function applyAssistantPreviewHydration");
  const previewApply = sourceBlock(renderer, "function applyAssistantPreviewHydration", "function threadFromLoaded");
  const skillsRefresh = sourceBlock(renderer, "function refreshSkillsForThreadIfNeeded", "function applySkillsPayload");

  assert.match(renderer, /const THREAD_DETAIL_REFRESH_TTL_MS = 30_000/);
  assert.match(cacheBlock, /loadedThreadDetailRefreshTimes\.set\(threadId, Date\.now\(\)\)/);
  assert.match(cacheBlock, /Date\.now\(\) - refreshedAt < THREAD_DETAIL_REFRESH_TTL_MS/);
  assert.match(cachedRefreshBlock, /hasFreshThreadDetailCache\(threadId\)[\s\S]*return;/);
  assert.match(cachedRefreshBlock, /rememberThreadDetailRefresh\(threadId\)[\s\S]*incomingSignature/);
  assert.match(selectBlock, /pendingAssistantPreviewHydrations\.delete\(threadId\)/);
  assert.match(selectBlock, /pendingThreadDetailPrefetches\.delete\(threadId\)/);
  assert.match(previewPolicy, /thread\.id === state\.currentThreadId[\s\S]*return false/);
  assert.match(previewHydration, /threadId === state\.currentThreadId[\s\S]*completedAssistantPreviewHydrations\.add\(threadId\)[\s\S]*return;/);
  assert.match(previewHydration, /state\.currentThreadId !== threadId[\s\S]*applyAssistantPreviewHydration/);
  assert.match(previewApply, /patchConversationRow\(threadId\)/);
  assert.doesNotMatch(previewApply, /\brender\(\)/);
  assert.match(backgroundBroker, /!options\.displayCache[\s\S]*displayCache: true[\s\S]*if \(displayRequest\) return displayRequest/);
  assert.doesNotMatch(skillsRefresh, /\.finally\(render\)/);
  assert.match(skillsRefresh, /composerSkillMention\.open[\s\S]*refreshComposerSkillMentionPopoverList\(\)/);
});

test("foreground resume consumes one captured start notification and uses it only as an error fallback", async () => {
  const main = await mainSource;
  const renderer = await rendererSource;
  const handler = sourceBlock(main, 'ipcMain.handle("codex:resumeThread"', 'ipcMain.handle("codex:updateThreadSettings"');
  const compactWithUsage = sourceBlock(main, "async function compactActiveThreadReadResultWithContextUsage", 'ipcMain.handle("codex:readThreadForBackgroundHydration"');
  const rendererResume = sourceBlock(renderer, "async function resumeThreadWithModelLock", "function threadParams");
  const notificationHandler = sourceBlock(main, "function handleClientNotification", "function recordArtifactAgentMessageNotification");
  const suppressionHelpers = sourceBlock(main, "function beginRendererThreadResumeNotificationSuppression", "function handleClientNotification");

  assert.match(handler, /beginRendererThreadResumeNotificationSuppression\(threadId\)/);
  assert.match(handler, /compactActiveThreadReadResultWithContextUsage\(result, cwd\)/);
  assert.match(compactWithUsage, /withTradingTranscriptHistory\(result, \{[\s\S]*compactActiveThreadReadResult\(hydrated\)[\s\S]*readLatestThreadContextUsage\(hydrated\?\.thread\)[\s\S]*contextUsage/);
  assert.match(rendererResume, /api\.resumeThread\(params\)[\s\S]*applyThreadContextUsageSnapshot\(resumedThreadId, result\?\.contextUsage\)/);
  assert.match(handler, /finally[\s\S]*finishRendererThreadResumeNotificationSuppression\(threadId, suppressionToken\)/);
  assert.match(handler, /catch \(error\)[\s\S]*capturedStart[\s\S]*fallbackThread[\s\S]*if \(!fallbackThread\) throw error;[\s\S]*compactActiveThreadReadResultWithContextUsage\([\s\S]*withThreadRuntimeSettings\(\{ thread: fallbackThread \}\),[\s\S]*cwd/);
  assert.match(notificationHandler, /captureRendererThreadStarted\(message, threadId\)\) return;[\s\S]*sendToRenderer\("codex:notification"/);
  assert.match(main, /function captureRendererThreadStarted[\s\S]*if \(!suppression\.notification\) suppression\.notification = message;/);
  assert.doesNotMatch(suppressionHelpers, /GRACE_MS|expiresAt|setTimeout/);
  assert.match(main, /if \(message\.method === "thread\/started"\)[\s\S]*compactActiveThreadNotification\(message\)/);
});

test("task panel state retains only the same bounded output that it renders", async () => {
  const renderer = await rendererSource;
  const rebuild = sourceBlock(renderer, "function rebuildTaskFromItems", "function taskProcessItems");

  assert.match(rebuild, /const rawOutput =/);
  assert.match(rebuild, /const output = limitAgentDetailText\(rawOutput\)/);
  assert.match(rebuild, /streaming_chunks: output/);
  assert.match(rebuild, /artifact: \{[\s\S]*output,/);
});
