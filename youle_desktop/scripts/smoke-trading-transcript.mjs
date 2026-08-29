import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppServerClient, resolveCodexCommand } from "../src/main/app-server-client.mjs";
import {
  indexedTradingTranscriptThreads,
  mergeIndexedTradingTranscriptThreads,
  tradingTranscriptInjectionItems,
  tradingTranscriptItemsFromThreadResult,
  updateTradingTranscriptIndex,
} from "../src/main/trading-expert-transcript.mjs";

const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-trading-transcript-smoke-"));
const workspace = path.join(probeRoot, "workspace");
const codexHome = path.join(probeRoot, "codex-home");
fs.mkdirSync(workspace, { recursive: true });

const createClient = () => new AppServerClient({
  cwd: workspace,
  codexCommand: resolveCodexCommand(workspace),
  codexHome,
});
let client = createClient();
let threadId = "";
let failure = null;

try {
  await client.start();
  const started = await client.request("thread/start", {
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    personality: "friendly",
    ephemeral: false,
  });
  threadId = String(started?.thread?.id || "").trim();
  if (!threadId) throw new Error("thread/start returned no id");

  const transcript = [
    {
      id: "runtime-user",
      role: "user",
      text: "runtime persistence probe",
      createdAt: new Date().toISOString(),
    },
    {
      id: "runtime-answer",
      role: "assistant",
      phase: "final_answer",
      text: "runtime persistence confirmed",
      createdAt: new Date(Date.now() + 1).toISOString(),
    },
  ];
  await client.request("thread/inject_items", {
    threadId,
    items: tradingTranscriptInjectionItems(transcript),
  });
  await client.request("thread/name/set", {
    threadId,
    name: "runtime persistence probe",
  });

  let listed = await client.request("thread/list", {
    cwd: workspace,
    limit: 20,
    sortKey: "updated_at",
  });
  let read = await client.request("thread/read", { threadId, includeTurns: true });
  updateTradingTranscriptIndex(codexHome, {
    threadId,
    cwd: workspace,
    rolloutPath: read?.thread?.path,
    title: "runtime persistence probe",
    preview: transcript.at(-1).text,
    createdAt: transcript[0].createdAt,
    updatedAt: transcript.at(-1).createdAt,
  });
  await client.stop();
  await new Promise((resolve) => setTimeout(resolve, 250));
  client = createClient();
  await client.start();
  listed = await client.request("thread/list", {
    cwd: workspace,
    limit: 20,
    sortKey: "updated_at",
  });
  read = await client.request("thread/read", { threadId, includeTurns: true });
  const restored = await tradingTranscriptItemsFromThreadResult(read);
  const listedThreads = Array.isArray(listed?.data) ? listed.data : [];
  const merged = mergeIndexedTradingTranscriptThreads(
    listed,
    indexedTradingTranscriptThreads(codexHome, workspace),
  );
  const visible = merged.data.some((item) =>
    String(item?.id || item?.threadId || item?.thread_id || "") === threadId
  );
  process.stdout.write(`${JSON.stringify({
    probe: true,
    threadId,
    rawListCount: listedThreads.length,
    mergedListCount: merged.data.length,
    readPath: String(read?.thread?.path || ""),
    restored: restored.map((item) => item.id),
    ordinaryTurnCount: Array.isArray(read?.thread?.turns) ? read.thread.turns.length : 0,
  })}\n`);
  if (!visible) throw new Error("materialized thread missing from merged thread list");
  if (restored.length !== transcript.length) {
    throw new Error(`expected ${transcript.length} restored items, got ${restored.length}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    listed: visible,
    restored: restored.map((item) => item.id),
    ordinaryTurnCount: Array.isArray(read?.thread?.turns) ? read.thread.turns.length : 0,
  })}\n`);
} catch (error) {
  failure = error;
} finally {
  if (threadId) await client.request("thread/delete", { threadId }).catch(() => {});
  await client.stop().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    fs.rmSync(probeRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (cleanupError) {
    process.stderr.write(`temporary smoke directory cleanup failed: ${cleanupError?.message || cleanupError}\n`);
  }
}

if (failure) throw failure;
