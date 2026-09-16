import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compactThreadWithSettings,
  ensureThreadSettingsAndWait,
  oversizedThreadCompactionItem,
  startThreadCompactionAndWait,
} from "../src/main/thread-compaction.mjs";

const mainSource = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

function notification(method, params) {
  return { method, params };
}

for (const state of ["failed", "stopped"]) {
  test(`manual compaction rejects immediately when the app server is ${state}`, async () => {
    const serverClient = new EventEmitter();
    const pending = startThreadCompactionAndWait({
      serverClient, threadId: "thread", startCompaction: async () => ({}), timeoutMs: 10_000,
    });
    serverClient.emit("status", { state });
    await assert.rejects(pending, /app server stopped/);
    assert.equal(serverClient.listenerCount("notification"), 0);
    assert.equal(serverClient.listenerCount("status"), 0);
  });
}

test("a failed item/completed notification rejects compaction without waiting for a turn event", async () => {
  const serverClient = new EventEmitter();
  const pending = startThreadCompactionAndWait({
    serverClient, threadId: "thread", startCompaction: async () => ({}), timeoutMs: 10_000,
  });
  serverClient.emit("notification", notification("item/completed", {
    threadId: "thread", turnId: "turn", item: { id: "compact", type: "contextCompaction", status: "failed" },
  }));
  await assert.rejects(pending);
  assert.equal(serverClient.listenerCount("notification"), 0);
  assert.equal(serverClient.listenerCount("status"), 0);
});

test("manual compaction waits for its compaction turn to complete", async () => {
  const serverClient = new EventEmitter();
  const appServerResult = { accepted: true };
  let settled = false;
  const pending = startThreadCompactionAndWait({
    serverClient,
    threadId: "thread-1",
    startCompaction: async () => appServerResult,
    timeoutMs: 1_000,
  });
  pending.then(() => { settled = true; }, () => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  serverClient.emit("notification", notification("turn/started", {
    threadId: "thread-1",
    turn: { id: "compact-turn" },
  }));
  serverClient.emit("notification", notification("item/completed", {
    threadId: "thread-1",
    turnId: "compact-turn",
    item: { id: "compact-item", type: "contextCompaction" },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the contextCompaction item is not the end of the turn");

  serverClient.emit("notification", notification("turn/completed", {
    threadId: "thread-1",
    turn: { id: "compact-turn", status: "completed" },
  }));
  assert.equal(await pending, appServerResult);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("manual compaction ignores an unrelated turn on the same thread", async () => {
  const serverClient = new EventEmitter();
  let settled = false;
  const pending = startThreadCompactionAndWait({
    serverClient,
    threadId: "thread-race",
    startCompaction: async () => ({ accepted: true }),
    timeoutMs: 1_000,
  });
  pending.then(() => { settled = true; }, () => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  serverClient.emit("notification", notification("turn/started", {
    threadId: "thread-race",
    turn: { id: "ordinary-turn" },
  }));
  serverClient.emit("notification", notification("turn/completed", {
    threadId: "thread-race",
    turn: { id: "ordinary-turn", status: "completed" },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "a plain same-thread turn must not complete compaction");

  serverClient.emit("notification", notification("item/completed", {
    threadId: "thread-race",
    item: { id: "compact-item", type: "contextCompaction" },
  }));
  serverClient.emit("notification", notification("turn/completed", {
    threadId: "thread-race",
    turn: { id: "compact-turn", status: "completed" },
  }));
  assert.deepEqual(await pending, { accepted: true });
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("manual compaction rejects a failed compaction turn and removes its listener", async () => {
  const serverClient = new EventEmitter();
  const pending = startThreadCompactionAndWait({
    serverClient,
    threadId: "thread-2",
    startCompaction: async () => ({}),
    timeoutMs: 1_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  serverClient.emit("notification", notification("item/started", {
    thread_id: "thread-2",
    turn_id: "compact-turn-2",
    item: { id: "compact-item-2", type: "context_compaction" },
  }));
  serverClient.emit("notification", notification("turn/completed", {
    threadId: "thread-2",
    turn: {
      id: "compact-turn-2",
      status: "failed",
      error: { message: "summary generation failed" },
    },
  }));

  await assert.rejects(pending, /Thread compaction failed: summary generation failed/);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("manual compaction accepts the legacy thread/compacted completion notification", async () => {
  const serverClient = new EventEmitter();
  const pending = startThreadCompactionAndWait({
    serverClient,
    threadId: "thread-3",
    startCompaction: async () => ({ ok: true }),
    timeoutMs: 1_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  serverClient.emit("notification", notification("thread/compacted", { threadId: "thread-3" }));
  assert.deepEqual(await pending, { ok: true });
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("manual compaction cleans up after request failure and timeout", async (t) => {
  await t.test("request failure", async () => {
    const serverClient = new EventEmitter();
    await assert.rejects(
      startThreadCompactionAndWait({
        serverClient,
        threadId: "thread-4",
        startCompaction: async () => { throw new Error("compact request rejected"); },
        timeoutMs: 1_000,
      }),
      /compact request rejected/,
    );
    assert.equal(serverClient.listenerCount("notification"), 0);
  });

  await t.test("completion timeout", async () => {
    const serverClient = new EventEmitter();
    await assert.rejects(
      startThreadCompactionAndWait({
        serverClient,
        threadId: "thread-5",
        startCompaction: async () => ({}),
        timeoutMs: 20,
      }),
      /Thread compaction timed out after 20ms/,
    );
    assert.equal(serverClient.listenerCount("notification"), 0);
  });

  await t.test("completion timeout interrupts the background compaction turn", async () => {
    const serverClient = new EventEmitter();
    const interruptions = [];
    const pending = startThreadCompactionAndWait({
      serverClient,
      threadId: "thread-timeout-interrupt",
      startCompaction: async () => {
        queueMicrotask(() => {
          serverClient.emit("notification", notification("turn/started", {
            threadId: "thread-timeout-interrupt",
            turn: { id: "compact-timeout-turn" },
          }));
        });
        return {};
      },
      interruptCompaction: async (params) => {
        interruptions.push(params);
      },
      timeoutMs: 20,
    });

    await assert.rejects(pending, /Thread compaction timed out after 20ms/);
    assert.deepEqual(interruptions, [{
      threadId: "thread-timeout-interrupt",
      turnId: "compact-timeout-turn",
    }]);
    assert.equal(serverClient.listenerCount("notification"), 0);
  });
});

test("automatic compaction retries one websocket reset", async () => {
  const serverClient = new EventEmitter();
  let compactCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-retry-websocket-reset",
    targetSettings: { model: "gpt-5.5", effort: "medium", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-retry-websocket-reset" },
      model: "gpt-5.5",
      reasoningEffort: "medium",
      serviceTier: "default",
    }),
    updateSettings: async () => ({}),
    startCompaction: async () => {
      compactCalls += 1;
      const attempt = compactCalls;
      queueMicrotask(() => {
        const threadId = "thread-retry-websocket-reset";
        const turnId = `compact-attempt-${attempt}`;
        serverClient.emit("notification", notification("turn/started", {
          threadId,
          turn: { id: turnId, status: "inProgress" },
        }));
        serverClient.emit("notification", notification("item/started", {
          threadId,
          turnId,
          item: { id: `compact-item-${attempt}`, type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId,
          turn: attempt === 1
            ? {
                id: turnId,
                status: "failed",
                error: { message: "stream disconnected before completion: WebSocket protocol error: Connection reset without closing handshake" },
              }
            : { id: turnId, status: "completed" },
        }));
      });
      return { attempt };
    },
    compactionRetryDelayMs: 0,
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(await pending, { attempt: 2 });
  assert.equal(compactCalls, 2);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("automatic compaction never retries a provider output ceiling", async () => {
  const serverClient = new EventEmitter();
  let compactCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-output-ceiling",
    targetSettings: { model: "gpt-5.5", effort: "medium", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-output-ceiling" },
      model: "gpt-5.5",
      reasoningEffort: "medium",
      serviceTier: null,
    }),
    updateSettings: async () => ({}),
    startCompaction: async () => {
      compactCalls += 1;
      queueMicrotask(() => {
        serverClient.emit("notification", notification("item/started", {
          threadId: "thread-output-ceiling",
          turnId: "compact-output-ceiling",
          item: { id: "compact-output-ceiling-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-output-ceiling",
          turn: {
            id: "compact-output-ceiling",
            status: "failed",
            error: { message: "stream disconnected before completion: Incomplete response returned, reason: max_output_tokens" },
          },
        }));
      });
      return {};
    },
    compactionRetryDelayMs: 0,
    compactionTimeoutMs: 1_000,
  });

  await assert.rejects(pending, /max_output_tokens/);
  assert.equal(compactCalls, 1);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("automatic compaction does not retry a deterministic summary failure", async () => {
  const serverClient = new EventEmitter();
  let compactCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-no-retry",
    targetSettings: { model: "gpt-5.5", effort: "medium", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-no-retry" },
      model: "gpt-5.5",
      reasoningEffort: "medium",
      serviceTier: null,
    }),
    updateSettings: async () => ({}),
    startCompaction: async () => {
      compactCalls += 1;
      queueMicrotask(() => {
        serverClient.emit("notification", notification("item/started", {
          threadId: "thread-no-retry",
          turnId: "compact-no-retry",
          item: { id: "compact-no-retry-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-no-retry",
          turn: {
            id: "compact-no-retry",
            status: "failed",
            error: { message: "summary generation failed" },
          },
        }));
      });
      return {};
    },
    compactionRetryDelayMs: 0,
    compactionTimeoutMs: 1_000,
  });

  await assert.rejects(pending, /summary generation failed/);
  assert.equal(compactCalls, 1);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("high-effort threads compact at low effort and restore the user's setting", async () => {
  const serverClient = new EventEmitter();
  const settingsUpdates = [];
  let effortDuringCompaction = null;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-high-effort",
    targetSettings: { model: "gpt-5.5", effort: "high", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-high-effort" },
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: null,
    }),
    updateSettings: async (settings) => {
      settingsUpdates.push(settings);
      return {
        model: settings.model,
        reasoningEffort: settings.effort,
        serviceTier: settings.serviceTier,
      };
    },
    startCompaction: async () => {
      effortDuringCompaction = settingsUpdates.at(-1)?.effort || "high";
      queueMicrotask(() => {
        serverClient.emit("notification", notification("item/started", {
          threadId: "thread-high-effort",
          turnId: "compact-low-effort",
          item: { id: "compact-low-effort-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-high-effort",
          turn: { id: "compact-low-effort", status: "completed" },
        }));
      });
      return { accepted: true };
    },
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(await pending, { accepted: true });
  assert.equal(effortDuringCompaction, "low");
  assert.deepEqual(settingsUpdates.map((settings) => settings.effort), ["low", "high"]);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("DeepSeek V4 Flash compaction keeps the forced Max effort", async () => {
  const serverClient = new EventEmitter();
  const settingsUpdates = [];
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-deepseek-max",
    targetSettings: {
      model: "deepseek-flash",
      effort: "max",
      serviceTier: null,
    },
    resumeThread: async () => ({
      thread: { id: "thread-deepseek-max" },
      model: "deepseek-flash",
      reasoningEffort: "high",
      serviceTier: null,
    }),
    updateSettings: async (settings) => {
      settingsUpdates.push(settings);
      return {
        model: settings.model,
        reasoningEffort: settings.effort,
        serviceTier: settings.serviceTier,
      };
    },
    startCompaction: async () => {
      queueMicrotask(() => {
        serverClient.emit("notification", notification("item/started", {
          threadId: "thread-deepseek-max",
          turnId: "compact-deepseek-max",
          item: { id: "compact-deepseek-max-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-deepseek-max",
          turn: { id: "compact-deepseek-max", status: "completed" },
        }));
      });
      return { accepted: true };
    },
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(await pending, { accepted: true });
  assert.deepEqual(settingsUpdates.map((settings) => settings.effort), ["max"]);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("a settings restore failure does not turn completed compaction into a failure", async () => {
  const serverClient = new EventEmitter();
  const restoreErrors = [];
  let settingsUpdateCount = 0;
  const result = await compactThreadWithSettings({
    serverClient,
    threadId: "thread-restore-failure",
    targetSettings: { model: "gpt-5.5", effort: "high", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-restore-failure" },
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: null,
    }),
    updateSettings: async (settings) => {
      settingsUpdateCount += 1;
      if (settingsUpdateCount === 2) throw new Error("restore unavailable");
      return {
        model: settings.model,
        reasoningEffort: settings.effort,
        serviceTier: settings.serviceTier,
      };
    },
    startCompaction: async () => {
      queueMicrotask(() => {
        serverClient.emit("notification", notification("item/started", {
          threadId: "thread-restore-failure",
          turnId: "compact-before-restore-failure",
          item: { id: "compact-before-restore-failure-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-restore-failure",
          turn: { id: "compact-before-restore-failure", status: "completed" },
        }));
      });
      return { accepted: true };
    },
    onSettingsRestoreError: (error) => restoreErrors.push(error),
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(result, { accepted: true });
  assert.equal(settingsUpdateCount, 2);
  assert.equal(restoreErrors.length, 1);
  assert.match(restoreErrors[0].message, /restore unavailable/);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("oversized compaction preflight checks individual items instead of aggregate history", () => {
  const result = {
    thread: {
      turns: [
        { id: "turn-small", items: [{ id: "small-a", type: "message", text: "a".repeat(32) }] },
        { id: "turn-large", items: [{ id: "large", type: "commandExecution", aggregatedOutput: "大".repeat(40) }] },
      ],
    },
  };

  assert.deepEqual(oversizedThreadCompactionItem(result, 30), {
    estimatedTokens: 30,
    itemId: "large",
    itemType: "commandExecution",
    turnId: "turn-large",
  });
  assert.equal(oversizedThreadCompactionItem({
    thread: {
      turns: [
        { items: [{ text: "a".repeat(32) }] },
        { items: [{ text: "b".repeat(32) }] },
      ],
    },
  }, 30), null, "multiple small removable items must not be treated as one oversized item");
});

test("old Luna thread waits for Terra settings before automatic compaction", async () => {
  const serverClient = new EventEmitter();
  const calls = [];
  const targetSettings = {
    model: "gpt-5.6-terra",
    effort: "medium",
    serviceTier: null,
  };
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-old-luna",
    targetSettings,
    resumeThread: async () => {
      calls.push({ method: "thread/resume", params: { threadId: "thread-old-luna" } });
      return {
        thread: { id: "thread-old-luna" },
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        serviceTier: null,
      };
    },
    updateSettings: async (params) => {
      calls.push({ method: "thread/settings/update", params });
      return { queued: true };
    },
    startCompaction: async () => {
      calls.push({ method: "thread/compact/start", params: { threadId: "thread-old-luna" } });
      queueMicrotask(() => {
        serverClient.emit("notification", notification("turn/started", {
          threadId: "thread-old-luna",
          turn: { id: "compact-terra-turn" },
        }));
        serverClient.emit("notification", notification("item/completed", {
          threadId: "thread-old-luna",
          turnId: "compact-terra-turn",
          item: { id: "compact-terra-item", type: "contextCompaction" },
        }));
        serverClient.emit("notification", notification("turn/completed", {
          threadId: "thread-old-luna",
          turn: { id: "compact-terra-turn", status: "completed" },
        }));
      });
      return { accepted: true };
    },
    settingsTimeoutMs: 1_000,
    compactionTimeoutMs: 1_000,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((call) => call.method), ["thread/resume", "thread/settings/update"]);
  assert.deepEqual(calls[1].params, { threadId: "thread-old-luna", ...targetSettings });

  serverClient.emit("notification", notification("thread/settings/updated", {
    threadId: "other-thread",
    threadSettings: targetSettings,
  }));
  serverClient.emit("notification", notification("thread/settings/updated", {
    threadId: "thread-old-luna",
    threadSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
  }));
  serverClient.emit("notification", notification("thread/settings/updated", {
    threadId: "thread-old-luna",
    threadSettings: { model: "gpt-5.6-terra", effort: "high", serviceTier: null },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.method === "thread/compact/start"), false);

  serverClient.emit("notification", notification("thread/settings/updated", {
    threadId: "thread-old-luna",
    threadSettings: targetSettings,
  }));

  assert.deepEqual(await pending, { accepted: true });
  assert.deepEqual(calls.map((call) => call.method), [
    "thread/resume",
    "thread/settings/update",
    "thread/compact/start",
  ]);
  assert.equal(JSON.stringify(calls.slice(1)).includes("gpt-5.6-luna"), false);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings update accepts an applied JSON-RPC response without a notification", async () => {
  const serverClient = new EventEmitter();
  const targetSettings = {
    model: "gpt-5.6-terra",
    effort: "medium",
    serviceTier: null,
  };
  const result = await ensureThreadSettingsAndWait({
    serverClient,
    threadId: "thread-response-settings",
    currentSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
    targetSettings,
    updateSettings: async () => ({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTier: null,
    }),
    timeoutMs: 20,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.threadSettings, targetSettings);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings update accepts root-level settings notifications", async () => {
  const serverClient = new EventEmitter();
  const targetSettings = {
    model: "gpt-5.6-sol",
    effort: "max",
    serviceTier: null,
  };
  const pending = ensureThreadSettingsAndWait({
    serverClient,
    threadId: "thread-root-settings",
    currentSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
    targetSettings,
    updateSettings: async () => ({ queued: true }),
    timeoutMs: 1_000,
  });

  await new Promise((resolve) => setImmediate(resolve));
  serverClient.emit("notification", notification("thread/settings/updated", {
    thread_id: "thread-root-settings",
    model: "gpt-5.6-sol",
    reasoning_effort: "max",
    service_tier: null,
  }));

  const result = await pending;
  assert.equal(result.changed, true);
  assert.deepEqual(result.threadSettings, targetSettings);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings update verifies effective state after an acknowledgement-only response", async () => {
  const serverClient = new EventEmitter();
  const targetSettings = {
    model: "gpt-5.6-terra",
    effort: "medium",
    serviceTier: null,
  };
  let verificationCalls = 0;
  const result = await ensureThreadSettingsAndWait({
    serverClient,
    threadId: "thread-ack-only",
    currentSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
    targetSettings,
    updateSettings: async () => ({ queued: true }),
    verifySettings: async () => {
      verificationCalls += 1;
      return {
        thread: { id: "thread-ack-only" },
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        serviceTier: null,
      };
    },
    timeoutMs: 1_000,
  });

  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(verificationCalls, 1);
  assert.deepEqual(result.threadSettings, targetSettings);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings update rechecks at timeout when the first effective-state read is stale", async () => {
  const serverClient = new EventEmitter();
  let verificationCalls = 0;
  const result = await ensureThreadSettingsAndWait({
    serverClient,
    threadId: "thread-delayed-apply",
    currentSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
    targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
    updateSettings: async () => ({ queued: true }),
    verifySettings: async () => {
      verificationCalls += 1;
      return {
        thread: { id: "thread-delayed-apply" },
        model: verificationCalls === 1 ? "gpt-5.6-luna" : "gpt-5.6-terra",
        reasoningEffort: "medium",
        serviceTier: null,
      };
    },
    timeoutMs: 20,
  });

  assert.equal(result.verified, true);
  assert.equal(verificationCalls, 2);
  assert.equal(result.threadSettings.model, "gpt-5.6-terra");
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings update keeps failing when timeout verification does not match", async () => {
  const serverClient = new EventEmitter();
  await assert.rejects(
    ensureThreadSettingsAndWait({
      serverClient,
      threadId: "thread-ack-mismatch",
      currentSettings: { model: "gpt-5.6-luna", effort: "medium", serviceTier: null },
      targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
      updateSettings: async () => ({ queued: true }),
      verifySettings: async () => ({
        thread: { id: "thread-ack-mismatch" },
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        serviceTier: null,
      }),
      timeoutMs: 20,
    }),
    /Thread settings update timed out after 20ms/,
  );
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("compaction treats the runtime default tier as the requested default", async () => {
  const serverClient = new EventEmitter();
  let updateCalls = 0;
  let compactCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-terra",
    targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-terra" },
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      serviceTier: "default",
    }),
    updateSettings: async () => {
      updateCalls += 1;
      return {};
    },
    startCompaction: async () => {
      compactCalls += 1;
      queueMicrotask(() => {
        serverClient.emit("notification", notification("thread/compacted", { threadId: "thread-terra" }));
      });
      return { ok: true };
    },
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(await pending, { ok: true });
  assert.equal(updateCalls, 0, "identical settings do not emit an update notification");
  assert.equal(compactCalls, 1);
});

test("an old private model without reasoning effort can still compact", async () => {
  const serverClient = new EventEmitter();
  let updateCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-private-model",
    targetSettings: { model: "gpt-5.4-private-alias", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-private-model" },
      model: "gpt-5.4-private-alias",
      reasoningEffort: null,
      serviceTier: null,
    }),
    updateSettings: async () => {
      updateCalls += 1;
      return {};
    },
    startCompaction: async () => {
      queueMicrotask(() => {
        serverClient.emit("notification", notification("thread/compacted", { threadId: "thread-private-model" }));
      });
      return { ok: true };
    },
    compactionTimeoutMs: 1_000,
  });

  assert.deepEqual(await pending, { ok: true });
  assert.equal(updateCalls, 0);
});

test("matching model with stale effort still updates before compaction", async () => {
  const serverClient = new EventEmitter();
  let updateParams = null;
  let compactCalls = 0;
  const pending = compactThreadWithSettings({
    serverClient,
    threadId: "thread-terra-high",
    targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
    resumeThread: async () => ({
      thread: { id: "thread-terra-high" },
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      serviceTier: null,
    }),
    updateSettings: async (params) => {
      updateParams = params;
      return { queued: true };
    },
    startCompaction: async () => {
      compactCalls += 1;
      queueMicrotask(() => {
        serverClient.emit("notification", notification("thread/compacted", { threadId: "thread-terra-high" }));
      });
      return { ok: true };
    },
    settingsTimeoutMs: 1_000,
    compactionTimeoutMs: 1_000,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updateParams, {
    threadId: "thread-terra-high",
    model: "gpt-5.6-terra",
    effort: "medium",
    serviceTier: null,
  });
  assert.equal(compactCalls, 0);
  serverClient.emit("notification", notification("thread/settings/updated", {
    threadId: "thread-terra-high",
    threadSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
  }));
  assert.deepEqual(await pending, { ok: true });
  assert.equal(compactCalls, 1);
});

test("settings timeout fails closed before compact/start", async () => {
  const serverClient = new EventEmitter();
  let compactCalls = 0;
  await assert.rejects(
    compactThreadWithSettings({
      serverClient,
      threadId: "thread-timeout",
      targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
      resumeThread: async () => ({
        thread: { id: "thread-timeout" },
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        serviceTier: null,
      }),
      updateSettings: async () => ({ queued: true }),
      startCompaction: async () => {
        compactCalls += 1;
        return {};
      },
      settingsTimeoutMs: 20,
      compactionTimeoutMs: 1_000,
    }),
    /Thread settings update timed out after 20ms/,
  );
  assert.equal(compactCalls, 0);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("settings request failure fails closed before compact/start", async () => {
  const serverClient = new EventEmitter();
  let compactCalls = 0;
  await assert.rejects(
    compactThreadWithSettings({
      serverClient,
      threadId: "thread-update-failure",
      targetSettings: { model: "gpt-5.6-terra", effort: "medium", serviceTier: null },
      resumeThread: async () => ({
        thread: { id: "thread-update-failure" },
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        serviceTier: null,
      }),
      updateSettings: async () => {
        throw new Error("settings rejected");
      },
      startCompaction: async () => {
        compactCalls += 1;
        return {};
      },
      settingsTimeoutMs: 1_000,
      compactionTimeoutMs: 1_000,
    }),
    /settings rejected/,
  );
  assert.equal(compactCalls, 0);
  assert.equal(serverClient.listenerCount("notification"), 0);
});

test("main and preload expose the notification-driven compactThread IPC contract", () => {
  assert.match(mainSource, /ipcMain\.handle\("codex:compactThread"/);
  assert.match(mainSource, /ipcMain\.handle\("codex:updateThreadSettings"/);
  assert.match(mainSource, /const threadId = String\(params\.threadId \|\| ""\)\.trim\(\)/);
  assert.match(mainSource, /getClientForThread\(threadId, fallbackCwd\)/);
  assert.match(mainSource, /requestAppServer\(serverClient, "thread\/resume"/);
  assert.match(mainSource, /excludeTurns:\s*true/);
  assert.match(mainSource, /compactThreadWithSettings\(\{/);
  assert.match(mainSource, /runSerializedThreadSettingsOperation\(threadId, async \(\) =>/);
  assert.match(mainSource, /acquireSerializedThreadSettingsOperation\(originalThreadId\)/);
  assert.match(mainSource, /"thread\/settings\/update"/);
  assert.match(mainSource, /verifySettings:\s*resumeThreadSettings/);
  assert.match(mainSource, /"thread\/read"[\s\S]*includeTurns:\s*true/);
  assert.match(mainSource, /oversizedThreadCompactionItem\(threadResult\)/);
  assert.match(mainSource, /THREAD_COMPACTION_OVERSIZED_ITEM/);
  assert.match(mainSource, /"thread\/compact\/start"/);
  assert.match(mainSource, /interruptCompaction:[\s\S]*interruptCodexTurn/);
  assert.match(mainSource, /THREAD_COMPACTION_TIMEOUT_MS/);
  assert.match(mainSource, /rememberThreadClient\(threadId, serverClient\)/);
  assert.match(preloadSource, /compactThread:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:compactThread", params\)/);
  assert.match(preloadSource, /updateThreadSettings:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\("codex:updateThreadSettings", params\)/);
});
