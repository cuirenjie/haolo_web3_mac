// HAOLO-TURN-DIAGNOSTICS-TEST
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectDiagnosticSupportEvidence, redactSupportText, transcriptDiagnosticPayload, TRANSCRIPT_DIAGNOSTIC_LOG,
} from "../src/main/diagnostic-support-evidence.mjs";
import { TurnDiagnosticRecorder, diagnosticHash } from "../src/main/turn-diagnostics.mjs";
import { indexedTradingTranscriptThreads, resolveTradingTranscriptIndexThreadAlias, tradingTranscriptInjectionItems, withTradingTranscriptHistory } from "../src/main/trading-expert-transcript.mjs";

const now = new Date("2026-10-14T07:00:00Z");
const threadId = "a1111111-1111-4111-8111-111111111111";
const otherId = "b2222222-2222-4222-8222-222222222222";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haolo-support-evidence-"));
  const home = path.join(root, "home");
  const logs = path.join(root, "logs");
  await fs.mkdir(home); await fs.mkdir(logs);
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^haolo-support-evidence-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  const logPath = path.join(logs, TRANSCRIPT_DIAGNOSTIC_LOG);
  const indexPath = path.join(home, "trading-transcript-index.json");
  const writeRollout = async (id = threadId, { text = "裸K分析完成，等待确认。", ordinary = false, extra = [] } = {}) => {
    const file = path.join(home, "sessions", "2026", "10", "14", `rollout-2026-10-14T06-10-00-${id}.jsonl`);
    const items = [
      { id: "local-user-probe", role: "user", text: "@策略:裸K分析 分析", createdAt: now.toISOString() },
      { id: "trading-progress-probe", role: "assistant", phase: "commentary", text: "已完成绘图", createdAt: now.toISOString() },
      { id: "trading-report-probe", role: "assistant", phase: "final_answer", text, createdAt: now.toISOString() },
    ];
    const rows = [
      { type: "session_meta", payload: { id, cwd: "C:\\Users\\Private\\workspace", timestamp: now.toISOString() } },
      ...(ordinary ? [{ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } }]
        : tradingTranscriptInjectionItems(items).map((payload) => ({ type: "response_item", timestamp: now.toISOString(), payload }))),
      ...extra,
    ];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await fs.utimes(file, now, now);
    return file;
  };
  const writeIndex = async (file, id = threadId, extras = {}) => {
    await fs.writeFile(indexPath, JSON.stringify({ version: 1, threads: {
      [id]: { threadId: id, cwd: home, rolloutPath: file, title: "BTC 裸K分析", preview: "已完成", createdAt: now.toISOString(), updatedAt: now.toISOString() },
      ...extras,
    }, aliases: {} }));
  };
  const collect = (extra = {}) => collectDiagnosticSupportEvidence({ homes: [home], logPath, now, ...extra });
  return { root, home, logPath, indexPath, writeRollout, writeIndex, collect };
}

test("one report contains related index, complete projected JSONL and persisted error events", async (t) => {
  const f = await fixture(t);
  const file = await f.writeRollout();
  await f.writeIndex(file);
  const recorder = new TurnDiagnosticRecorder({ logPath: f.logPath, now: () => now });
  recorder.record("trading.transcript.persist.failed", transcriptDiagnosticPayload("persist.failed", {
    threadId, cwd: f.home, error: { message: "Permission denied C:\\Users\\Private\\history.json", code: "EACCES" }, itemCount: 3,
  }));
  const original = await fs.readFile(file);
  const indexOriginal = await fs.readFile(f.indexPath);
  const evidence = await f.collect({ selectedThreadId: threadId });
  assert.equal(evidence.indexes[0].status, "ok");
  assert.equal(evidence.rollouts.length, 1);
  assert.equal(evidence.rollouts[0].indexEntryPresent, true);
  const rows = evidence.rollouts[0].jsonl.trim().split("\n").map(JSON.parse);
  assert.equal(rows[3].payload.content[0].transcript.phase, "final_answer");
  assert.equal(rows[3].payload.content[0].transcript.text, "裸K分析完成，等待确认。");
  assert.equal(evidence.persistenceLog.events[0].threadHash, diagnosticHash(threadId));
  assert.equal(evidence.persistenceLog.events[0].code, "EACCES");
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await fs.readFile(f.indexPath), indexOriginal);
  const reportPath = path.join(f.root, "diagnostics.json");
  recorder.exportReport(reportPath, {}, { supportEvidence: evidence });
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.reportType, "haolo_turn_diagnostics");
  assert.equal(report.privacy.includesResponseText, true);
  assert.equal(report.supportEvidence.rollouts[0].jsonl, evidence.rollouts[0].jsonl);
  assert.doesNotMatch(JSON.stringify(report), /Private|C:\\\\Users/);
});

test("missing or corrupt indexes do not prevent finding trading transcripts and are never repaired by export", async (t) => {
  const f = await fixture(t);
  await f.writeRollout();
  const missing = await f.collect();
  assert.equal(missing.indexes[0].status, "missing");
  assert.equal(missing.rollouts.length, 1);
  assert.equal(missing.rollouts[0].indexEntryPresent, false);
  await assert.rejects(fs.stat(f.indexPath), { code: "ENOENT" });
  await fs.writeFile(f.indexPath, '{"password":"private-index-secret",');
  const corrupted = await f.collect();
  assert.equal(corrupted.indexes[0].status, "corrupt");
  assert.equal(corrupted.rollouts.length, 1);
  assert.equal(await fs.readFile(f.indexPath, "utf8"), '{"password":"private-index-secret",');
  assert.doesNotMatch(JSON.stringify(corrupted), /private-index-secret/);
});

test("evidence omits credential files, tool/system output, URLs and secrets in conversation text", async (t) => {
  const f = await fixture(t);
  const secrets = 'alice@example.com Bearer privateBearerToken sk-exampleSecret123 password="private-password" api_key=private-api-key https://example.com/?token=url-secret';
  await f.writeRollout(threadId, { text: secrets, extra: [
    { type: "response_item", payload: { type: "function_call_output", output: "tool-secret" } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "developer-secret" }] } },
  ] });
  await fs.writeFile(path.join(f.home, "auth.json"), "auth-file-secret");
  await fs.writeFile(path.join(f.home, "config.toml"), "config-file-secret");
  const evidence = await f.collect();
  const serialized = JSON.stringify(evidence);
  for (const secret of ["alice@example.com", "privateBearerToken", "exampleSecret123", "private-password", "private-api-key", "url-secret", "tool-secret", "developer-secret", "auth-file-secret", "config-file-secret"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.match(serialized, /REDACTED_SECRET/);
  assert.match(serialized, /final_answer/);
});

test("ordinary recent sessions are excluded unless explicitly selected; old related files can still be selected", async (t) => {
  const f = await fixture(t);
  const older = await f.writeRollout();
  await fs.utimes(older, new Date("2026-10-01"), new Date("2026-10-01"));
  await f.writeRollout(otherId, { ordinary: true, text: "unrelated private conversation" });
  const recorder = new TurnDiagnosticRecorder({ logPath: f.logPath, now: () => now });
  for (const stage of ["index.missing", "history.skipped_unindexed", "history.loaded"]) {
    recorder.record(`trading.transcript.${stage}`, transcriptDiagnosticPayload(stage, { threadId: otherId, restoredCount: 0 }));
  }
  assert.equal((await f.collect()).rollouts.length, 0);
  const selected = await f.collect({ selectedThreadId: threadId });
  assert.equal(selected.rollouts.length, 1);
  assert.equal(selected.rollouts[0].threadId, threadId);
  assert.doesNotMatch(JSON.stringify(selected), /unrelated private conversation/);
});

test("index paths cannot escape the home or cause arbitrary credential files to be read", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "credential.jsonl");
  await fs.writeFile(outside, "outside-secret");
  await f.writeIndex(outside);
  const result = await f.collect({ selectedThreadId: threadId });
  assert.equal(result.indexes[0].threads[threadId].pathStatus, "outside_root");
  assert.equal(result.rollouts.length, 0);
  assert.ok(result.omissions.some((item) => item.reason === "selected_rollout_not_collected"));
  assert.doesNotMatch(JSON.stringify(result), /outside-secret|credential\.jsonl/);
});

test("directory junctions/symlinks are not traversed", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, `rollout-2026-10-14T06-10-00-${threadId}.jsonl`), "outside-secret");
  await fs.symlink(outside, path.join(f.home, "sessions"), process.platform === "win32" ? "junction" : "dir");
  const result = await f.collect({ selectedThreadId: threadId });
  assert.equal(result.rollouts.length, 0);
});

test("bounded tail sampling retains final evidence and explicitly reports malformed/truncated files", async (t) => {
  const f = await fixture(t);
  const file = await f.writeRollout();
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, "x".repeat(3 * 1024 * 1024) + "\n" + text + "{partial");
  const result = await f.collect({ selectedThreadId: threadId });
  assert.equal(result.rollouts[0].truncated, true);
  assert.equal(result.rollouts[0].hashScope, "sample");
  assert.equal(result.rollouts[0].malformedLines, 1);
  assert.match(result.rollouts[0].jsonl, /final_answer/);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < result.limits.outputBytes);
});

test("file cap prefers the selected thread and flags omitted evidence", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 14; index++) {
    await f.writeRollout(`a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`);
  }
  await f.writeRollout();
  const result = await f.collect({ selectedThreadId: threadId });
  assert.equal(result.rollouts.length, 12);
  assert.equal(result.rollouts[0].threadId, threadId);
  assert.ok(result.omissions.some((item) => item.reason === "file_limit"));
});

test("partial logs and unsupported payload fields cannot break export or leak content", async (t) => {
  const f = await fixture(t);
  const payload = transcriptDiagnosticPayload("renderer.retry_failed", { threadId, attempt: 2, prompt: "never-logged", error: { message: "token=hidden-value" } });
  assert.equal(payload.prompt, undefined);
  assert.equal(transcriptDiagnosticPayload("arbitrary", {}), null);
  await fs.writeFile(f.logPath, JSON.stringify({ ...payload, timestamp: now.toISOString(), unexpected: "never-exported" }) + '\n{"broken');
  const result = await f.collect();
  assert.equal(result.persistenceLog.events.length, 1);
  assert.equal(result.persistenceLog.events[0].attempt, 2);
  assert.doesNotMatch(JSON.stringify(result), /never-logged|never-exported|hidden-value/);
});

test("hydration emits index-missing/skipped evidence and ignores observer failures", async (t) => {
  const f = await fixture(t);
  const file = await f.writeRollout();
  const result = { thread: { id: threadId, path: file, turns: [] } };
  const events = [];
  const hydrated = await withTradingTranscriptHistory(result, { codexHome: f.home, onDiagnostic: (stage, detail) => events.push({ stage, ...detail }) });
  assert.equal(hydrated.thread.turns.length, 0);
  assert.ok(events.some((event) => event.stage === "index.missing"));
  assert.ok(events.some((event) => event.stage === "history.skipped_unindexed"));
  assert.equal(events.at(-1).restoredCount, 0);
  await f.writeIndex(file);
  const restored = await withTradingTranscriptHistory(result, { codexHome: f.home, onDiagnostic() { throw new Error("observer broken"); } });
  assert.equal(restored.thread.turns[0].status, "completed");
});

test("redaction handles forward-slash paths, UNC paths and private key blocks", () => {
  const text = redactSupportText('C:/Users/Private/file\n\\\\host\\private\\file\n-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----');
  assert.doesNotMatch(text, /Private|host|private-key-body/);
});

test("startup listing and persistence alias lookup report index faults before existing recovery handles them", async (t) => {
  const f = await fixture(t);
  const events = [];
  const observer = { onDiagnostic: (stage) => events.push(stage) };
  await fs.writeFile(f.indexPath, '{"partial');
  assert.deepEqual(indexedTradingTranscriptThreads(f.home, f.home, observer), []);
  assert.deepEqual(events, ["index.corrupt"]);
  await fs.writeFile(f.indexPath, '{"version":99,"threads":{}}');
  assert.equal(resolveTradingTranscriptIndexThreadAlias(f.home, threadId, observer), threadId);
  assert.equal(events.at(-1), "index.invalid");
});
