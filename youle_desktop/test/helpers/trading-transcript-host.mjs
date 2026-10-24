import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as transcript from "../../src/main/trading-expert-transcript.mjs";

const source = fs.readFileSync(new URL("../../src/main/main.mjs", import.meta.url), "utf8");
const start = source.indexOf('ipcMain.handle("codex:persistTradingTranscript"');
const end = source.indexOf('ipcMain.handle("codex:stageContinuationPrompt"', start);
assert.ok(start >= 0 && end > start);

export function longTradingTranscript(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `history-${index}`,
    role: index % 2 ? "assistant" : "user",
    text: index % 2 ? `分析结果 ${index}` : `分析请求 ${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 20) + index * 1_000).toISOString(),
    ...(index % 2 ? { phase: "final_answer", executionPlanPresentation: "plain", nativeResponseComplete: true } : {}),
  }));
}

// Execute the real IPC handler and transcript/index/rollout code. Only the
// app-server transport and Electron/workspace services are replaced.
export function createTradingTranscriptHost(t, initialItems, threadId = "origin", {missingSourceId} = {}) {
  const tempDirectory = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempDirectory, "haolo-long-transcript-"));
  t.after(() => {
    assert.equal(path.dirname(root), tempDirectory);
    assert.ok(path.basename(root).startsWith("haolo-long-transcript-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const rolloutPath = path.join(root, "rollout.jsonl");
  const calls = [], events = [];
  const append = messages => fs.appendFileSync(rolloutPath, messages.map(payload => (
    JSON.stringify({ type: "response_item", payload }) + "\n"
  )).join(""));
  fs.writeFileSync(rolloutPath, "");
  for (let offset = 0; offset < initialItems.length; offset += 32) {
    append(transcript.tradingTranscriptInjectionItems(initialItems.slice(offset, offset + 32)));
  }
  if (initialItems.length) transcript.updateTradingTranscriptIndex(root, {
    threadId, cwd: root, rolloutPath, title: "旧交易聊天",
    createdAt: initialItems[0].createdAt, updatedAt: initialItems.at(-1).createdAt,
  });
  // No in-memory transcript: history must be recovered from the persisted file.
  const readThread = () => ({ thread: { id: threadId, path: rolloutPath, turns: [] } });
  let handler;
  const restart = () => {
    const context = {
      ...transcript,
      ipcMain: { handle(name, callback) {
        assert.equal(name, "codex:persistTradingTranscript");
        handler = callback;
      } },
      recordTradingTranscriptDiagnostic: (stage, details) => events.push({ stage, ...details }),
      runSerializedThreadSettingsOperation: async (id, callback) => {
        assert.equal(id, missingSourceId || threadId);
        return callback();
      },
      currentSkillsCwd: root, desktopWorkspace: () => root,
      getClientForThread: id => { assert.ok([threadId,missingSourceId].includes(id)); return { __youleWorkspaceCwd: root }; },
      ensureThreadGroupWorkspaceDirectory: () => {}, workspaceCodexHome: () => root,
      requestAppServer: async (_client, method, params) => {
        if (missingSourceId && params.threadId === missingSourceId) {
          throw new Error(method === 'thread/read' ? 'no rollout found for thread id' : `thread not loaded: ${missingSourceId}`);
        }
        assert.equal(params.threadId, threadId);
        calls.push({ method, itemCount: params.items?.length });
        if (method === "thread/read") return readThread();
        if (method === "thread/inject_items") { append(params.items); return {}; }
        if (method === "thread/name/set") return {};
        throw new Error(`Unexpected app-server method: ${method}`);
      },
      rememberThreadClient: () => {}, isMissingRolloutErrorMessage: value => missingSourceId && value.includes('no rollout found'),
      isThreadNotFoundError: () => false, delay: async () => {}, console,
      firstString: (...values) => values.find(v => typeof v === 'string' && v) || '',
      refreshSkillsDeveloperInstructions: async () => '', threadConfigurationParams: params => params,
      videoGenerationInstructionOptions: () => ({}),
      requestThreadStart: async () => {calls.push({method:'thread/start'});return readThread();},
      withThreadRuntimeSettings: value => value, injectLatestSkillsInstructions: async () => {},
      snapshotThreadArtifacts: async () => {}, appServerClientByThreadId:new Map(),
    };
    vm.runInNewContext(source.slice(start, end), context);
  };
  restart();
  return {
    root, threadId, calls, events, restart,
    persist: params => handler(null, { threadId:missingSourceId || threadId, cwd: root, ...params }),
    readItems: () => transcript.readTradingTranscriptItemsFromRollout(rolloutPath),
    restore: () => transcript.withTradingTranscriptHistory(readThread(), { codexHome: root }),
  };
}
