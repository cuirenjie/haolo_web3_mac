import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationStore } from "../src/main/automation/store.mjs";
import { AutomationWorker } from "../src/main/automation/worker.mjs";
import { shouldNotifyRun } from "../src/main/automation/notifications.mjs";
import { buildExecArgs, probeYouleAiEnvironment, runYouleAiExec } from "../src/main/automation/runner.mjs";
import { buildLoginTaskCommand, computeNextRunAtUtc, validateSchedule } from "../src/main/automation/scheduler.mjs";
import { classifyWorkspacePath, prepareRunWorkspace } from "../src/main/automation/workspace.mjs";
import { WorkerLock } from "../src/main/automation/lock.mjs";
import { createDraftAutomationManifest, createFanoutAutomationDrafts, enforceAutomationPolicy, validateAutomationPrompt } from "../src/main/automation/policy.mjs";
import { buildDeliveryPayload, deliverWebhook } from "../src/main/automation/delivery.mjs";

async function tempDir(name) {
  const dir = path.join(os.tmpdir(), `youle-automation-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test("scheduler computes once, interval, and cron next run times in UTC", () => {
  assert.equal(
    computeNextRunAtUtc({
      type: "once",
      expr: "2026-06-01T09:00:00+08:00",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T00:00:00.000Z",
    }),
    "2026-06-01T01:00:00.000Z",
  );

  assert.equal(
    computeNextRunAtUtc({
      type: "interval",
      expr: "PT30M",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T00:00:00.000Z",
      lastRunAtUtc: "2026-05-29T00:05:00.000Z",
    }),
    "2026-05-29T00:35:00.000Z",
  );

  assert.equal(
    computeNextRunAtUtc({
      type: "cron",
      expr: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T02:00:00.000Z",
    }),
    "2026-06-01T01:00:00.000Z",
  );

  assert.equal(validateSchedule({ type: "interval", expr: "PT2M", timezone: "Asia/Shanghai" }).ok, false);
  assert.equal(validateSchedule({ type: "interval", expr: "PT5M", timezone: "Asia/Shanghai" }).ok, true);
  assert.equal(validateSchedule({ type: "interval", expr: "PT1H", timezone: "Asia/Shanghai" }).ok, true);
  assert.equal(validateSchedule({ type: "interval", expr: "P1D", timezone: "Asia/Shanghai" }).ok, true);
  assert.equal(validateSchedule({ type: "idle", expr: null, timezone: "Asia/Shanghai" }).ok, true);
  assert.equal(computeNextRunAtUtc({ type: "idle", expr: null, timezone: "Asia/Shanghai" }), null);
});

test("scheduler computes daily and weekly next run times in UTC", () => {
  assert.equal(
    computeNextRunAtUtc({
      type: "daily",
      expr: "09:30",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T00:00:00.000Z",
    }),
    "2026-05-29T01:30:00.000Z",
  );
  assert.equal(
    computeNextRunAtUtc({
      type: "daily",
      expr: "09:30",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T02:00:00.000Z",
    }),
    "2026-05-30T01:30:00.000Z",
  );
  assert.equal(
    computeNextRunAtUtc({
      type: "weekly",
      expr: "1 09:30",
      timezone: "Asia/Shanghai",
      nowUtc: "2026-05-29T00:00:00.000Z",
    }),
    "2026-06-01T01:30:00.000Z",
  );
  assert.equal(validateSchedule({ type: "daily", expr: "24:00", timezone: "Asia/Shanghai" }).ok, false);
  assert.equal(validateSchedule({ type: "weekly", expr: "8 09:30", timezone: "Asia/Shanghai" }).ok, false);
});

test("manual schedules are not due automatically but can run on demand", async () => {
  const dir = await tempDir("manual-schedule");
  const fakeBin = path.join(dir, "fake-manual.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'manual ok');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Manual only task",
    workspacePath: dir,
    prompt: "Every run, execute this manual task and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
  });
  assert.equal(job.nextRunAtUtc, null);
  assert.equal((await store.dueJobs("2026-05-30T00:00:00.000Z")).length, 0);

  const worker = new AutomationWorker({ store, youleAiBin: fakeBin });
  await worker.scanDueJobs();
  assert.equal((await store.listRuns({ jobId: job.id })).length, 0);

  const run = await worker.runNow(job.id);
  assert.equal(run.status, "success");
  assert.equal(run.triggerType, "manual");
  assert.equal(run.summary, "manual ok");
  await rm(dir, { recursive: true, force: true });
});

test("idle schedules run automatically when machine is idle", async () => {
  const dir = await tempDir("idle-schedule");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Idle Feishu check",
    workspacePath: dir,
    prompt: "不定时查看飞书有没有新消息",
    schedule: { type: "idle", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    idlePolicy: { minIntervalMinutes: 60, idleSeconds: 300, cpuThresholdPercent: 25, memoryAvailableMb: 1024 },
  });
  assert.equal(job.nextRunAtUtc, null);

  const worker = new AutomationWorker({
    store,
    youleAiBin: process.execPath,
    now: () => new Date("2026-06-02T10:00:00.000Z"),
    executor: async () => ({ status: "success", summary: "idle ok" }),
    idleProbe: async () => ({ idleSeconds: 600, cpuPercent: 5, memoryAvailableMb: 4096, source: "test" }),
  });
  await worker.scanDueJobs();
  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].triggerType, "idle");
  assert.equal(runs[0].summary, "idle ok");
  const updated = await store.getJob(job.id);
  assert.equal(updated.lastIdleStatus, "ready");
  assert.equal(updated.idleCooldownUntilUtc, "2026-06-02T11:00:00.000Z");
  await rm(dir, { recursive: true, force: true });
});

test("legacy manual 不定时 jobs are migrated to idle schedules", async () => {
  const dir = await tempDir("idle-migration");
  const store = new AutomationStore({ dataDir: dir });
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "automation-store.json"),
    JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "legacy-idle",
          name: "不定时任务",
          enabled: true,
          workspacePath: dir,
          scheduleType: "manual",
          scheduleExpr: null,
          timezone: "UTC",
          nextRunAtUtc: null,
          promptTemplate: "不定时查看 飞书有没有新消息",
        },
      ],
      runs: [],
      events: [],
      artifacts: [],
      heartbeats: [],
    }),
  );
  const job = await store.getJob("legacy-idle");
  assert.equal(job.scheduleType, "idle");
  assert.equal(job.nextRunAtUtc, null);
  assert.equal(job.idlePolicy.minIntervalMinutes, 60);
  await rm(dir, { recursive: true, force: true });
});

test("store persists jobs, runs, events, artifacts, and triage filtering", async () => {
  const dir = await tempDir("store");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Daily repo report",
    workspacePath: dir,
    prompt: "Summarize changes. If there are no findings, return NO_FINDINGS.",
    schedule: { type: "cron", expr: "0 9 * * 1-5", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
  });
  assert.equal(job.sandboxMode, "read-only");
  assert.equal(job.approvalPolicy, "never");
  assert.match(job.nextRunAtUtc, /^\d{4}-/);

  const run = await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null });
  await writeFile(path.join(dir, "final.md"), "final content");
  await store.appendRunEvent(run.id, { source: "youle_ai_jsonl", eventType: "turn.completed", payload: { type: "turn.completed" } });
  await store.addArtifact(run.id, { type: "final_message", path: path.join(dir, "final.md"), sizeBytes: 12 });
  await store.completeRun(run.id, {
    status: "failed",
    exitCode: 1,
    summary: "auth expired",
    errorClass: "youle_ai_auth_expired",
    errorMessage: "auth expired",
  });

  const loaded = await store.getRun(run.id);
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.artifacts.length, 1);
  assert.equal(loaded.artifacts[0].preview, "final content");
  assert.equal((await store.listRuns({ triage: true })).length, 1);

  const reopened = new AutomationStore({ dataDir: dir });
  assert.equal((await reopened.listJobs()).length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("store serializes stale foreground and background writes without losing data", async () => {
  const dir = await tempDir("store-cross-process");
  const foreground = new AutomationStore({ dataDir: dir });
  const background = new AutomationStore({ dataDir: dir });
  const job = await foreground.createJob({
    name: "Concurrent job",
    workspacePath: dir,
    prompt: "Every run, preserve concurrent automation state and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
  });

  await foreground.getJob(job.id);
  const run = await background.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null });
  await background.appendRunEvent(run.id, { source: "worker", eventType: "run.completed", payload: { ok: true } });
  await foreground.updateJob(job.id, { description: "edited from foreground" });

  const verify = new AutomationStore({ dataDir: dir });
  assert.equal((await verify.getJob(job.id)).description, "edited from foreground");
  assert.equal((await verify.listRuns({ jobId: job.id })).length, 1);
  assert.equal((await verify.getRun(run.id)).events.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("store keeps next run stable when job updates do not change schedule timing", async () => {
  const dir = await tempDir("stable-next-run");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Interval check",
    workspacePath: dir,
    prompt: "Check the workspace and return NO_FINDINGS if there is nothing important.",
    schedule: { type: "interval", expr: "PT2H", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
    nextRunAtUtc: "2026-06-02T08:17:46.324Z",
  });

  await store.updateJob(job.id, { prompt: "Check again and return NO_FINDINGS if there is nothing important." });
  const promptUpdated = await store.getJob(job.id);
  assert.equal(promptUpdated.promptTemplate, "Check again and return NO_FINDINGS if there is nothing important.");
  assert.equal(promptUpdated.nextRunAtUtc, "2026-06-02T08:17:46.324Z");

  await store.updateJob(job.id, { schedule: { type: "interval", expr: "PT2H", timezone: "Asia/Shanghai", misfirePolicy: "skip" } });
  const unchangedTiming = await store.getJob(job.id);
  assert.equal(unchangedTiming.nextRunAtUtc, "2026-06-02T08:17:46.324Z");
  assert.equal(unchangedTiming.misfirePolicy, "skip");

  await store.updateJob(job.id, { schedule: { type: "interval", expr: "PT3H", timezone: "Asia/Shanghai", misfirePolicy: "skip" } });
  assert.notEqual((await store.getJob(job.id)).nextRunAtUtc, "2026-06-02T08:17:46.324Z");
  await rm(dir, { recursive: true, force: true });
});

test("store lists newest automation jobs first", async () => {
  const dir = await tempDir("job-list-order");
  const store = new AutomationStore({ dataDir: dir });
  await store.createJob({
    name: "Older job",
    workspacePath: dir,
    prompt: "Every run, report the older job status and return NO_FINDINGS if there is nothing important.",
    schedule: { type: "daily", expr: "23:00", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  await store.createJob({
    name: "Newer job",
    workspacePath: dir,
    prompt: "Every run, report the newer job status and return NO_FINDINGS if there is nothing important.",
    schedule: { type: "daily", expr: "09:00", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
    createdAt: "2026-06-03T00:00:00.000Z",
  });

  const jobs = await store.listJobs();
  assert.deepEqual(jobs.map((job) => job.name), ["Newer job", "Older job"]);
  await rm(dir, { recursive: true, force: true });
});

test("runner sends prompt through stdin, writes artifacts, parses JSONL, and avoids approval exec flag", async () => {
  const dir = await tempDir("runner");
  const fakeBin = path.join(dir, "fake-youle-ai.mjs");
  const workspace = path.join(dir, "workspace with spaces");
  const runDir = path.join(dir, "run");
  await mkdir(workspace, { recursive: true });
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const prompt = readFileSync(0, 'utf8');",
      "writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, prompt }));",
      "const final = args[args.indexOf('--output-last-message') + 1];",
      "writeFileSync(final, prompt.includes('NO_FINDINGS') ? 'NO_FINDINGS' : 'Changed files');",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_123' }));",
      "console.log('{malformed');",
      "console.error('stderr token sk-test-secret');",
      "process.exit(0);",
    ].join("\n"),
    { mode: 0o755 },
  );

  const args = buildExecArgs({
    workspacePath: workspace,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    finalMessagePath: path.join(runDir, "final.md"),
  });
  assert(!args.includes("--ask-for-approval"));
  assert.deepEqual(args.slice(0, 3), ["exec", "--json", "--skip-git-repo-check"]);
  assert(args.includes("-c"));
  assert(args.includes('approval_policy="never"'));
  assert.equal(args.at(-1), "-");

  const events = [];
  const result = await runYouleAiExec({
    youleAiBin: fakeBin,
    workspacePath: workspace,
    prompt: "Return NO_FINDINGS without editing.",
    runDir,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    timeoutMs: 5000,
    env: { FAKE_CAPTURE: path.join(dir, "capture.json") },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "no_findings");
  assert.equal(result.summary, "NO_FINDINGS");
  assert.equal((await readFile(path.join(runDir, "final.md"), "utf8")).trim(), "NO_FINDINGS");
  assert.match(await readFile(path.join(runDir, "events.jsonl"), "utf8"), /thread\.started/);
  assert.doesNotMatch(await readFile(path.join(runDir, "stderr.log"), "utf8"), /sk-test-secret/);
  assert.equal(events[0].type, "thread.started");
  assert.equal(events[1].type, "unparsed_stdout");
  const captured = JSON.parse(await readFile(path.join(dir, "capture.json"), "utf8"));
  assert.equal(captured.prompt, "Return NO_FINDINGS without editing.");
  assert(!captured.args.includes("Return NO_FINDINGS without editing."));
  await rm(dir, { recursive: true, force: true });
});

test("runner only treats standalone NO_FINDINGS final messages as no findings", async () => {
  const dir = await tempDir("runner-no-findings-classification");
  const fakeBin = path.join(dir, "fake-echo-no-findings-rule.mjs");
  const runDir = path.join(dir, "run");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const prompt = readFileSync(0, 'utf8');",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], `Finding found. Prompt mentioned ${prompt.includes('NO_FINDINGS') ? 'NO_FINDINGS' : 'nothing'}.`);",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = await runYouleAiExec({
    youleAiBin: fakeBin,
    workspacePath: dir,
    prompt: "Every run, review and return NO_FINDINGS if there is no result.",
    runDir,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(result.status, "success");
  assert.equal(result.hasFindings, true);
  await rm(dir, { recursive: true, force: true });
});

test("runner enforces startup and no-output timeouts", async () => {
  const dir = await tempDir("runner-watchdog");
  const silentBin = path.join(dir, "fake-silent.mjs");
  const quietAfterOutputBin = path.join(dir, "fake-quiet-after-output.mjs");
  await writeFile(
    silentBin,
    [
      "#!/usr/bin/env node",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    { mode: 0o755 },
  );
  await writeFile(
    quietAfterOutputBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'started');",
      "console.log(JSON.stringify({ type: 'thread.started' }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    { mode: 0o755 },
  );

  const startup = await runYouleAiExec({
    youleAiBin: silentBin,
    workspacePath: dir,
    prompt: "Watch startup",
    runDir: path.join(dir, "startup"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
    startupTimeoutMs: 80,
  });
  assert.equal(startup.status, "timed_out");
  assert.equal(startup.errorClass, "startup_timeout");

  const noOutput = await runYouleAiExec({
    youleAiBin: quietAfterOutputBin,
    workspacePath: dir,
    prompt: "Watch quiet output",
    runDir: path.join(dir, "no-output"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
    startupTimeoutMs: 500,
    noOutputTimeoutMs: 80,
  });
  assert.equal(noOutput.status, "timed_out");
  assert.equal(noOutput.errorClass, "no_output_timeout");
  await rm(dir, { recursive: true, force: true });
});

test("runner gives timed-out processes cleanup grace before force killing", async () => {
  const dir = await tempDir("runner-cleanup-grace");
  const gracefulBin = path.join(dir, "fake-graceful.mjs");
  await writeFile(
    gracefulBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const final = args[args.indexOf('--output-last-message') + 1];",
      "process.on('SIGTERM', () => { writeFileSync(final, 'cleanup complete'); process.exit(0); });",
      "console.log(JSON.stringify({ type: 'fixture.ready' }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = await runYouleAiExec({
    youleAiBin: gracefulBin,
    workspacePath: dir,
    prompt: "Watch cleanup grace",
    runDir: path.join(dir, "run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
    startupTimeoutMs: 500,
    noOutputTimeoutMs: 250,
    cleanupGraceMs: 500,
  });
  assert.equal(result.status, "timed_out");
  if (process.platform === "win32") {
    assert.equal(result.summary, "");
  } else {
    assert.equal(result.summary, "cleanup complete");
  }
  await rm(dir, { recursive: true, force: true });
});

test("runner extracts token usage from JSONL events", async () => {
  const dir = await tempDir("runner-usage");
  const fakeBin = path.join(dir, "fake-usage.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'usage ok');",
      "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 7, reasoning_output_tokens: 2 } }));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const result = await runYouleAiExec({
    youleAiBin: fakeBin,
    workspacePath: dir,
    prompt: "Capture usage",
    runDir: path.join(dir, "run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(result.inputTokens, 11);
  assert.equal(result.cachedInputTokens, 3);
  assert.equal(result.outputTokens, 7);
  assert.equal(result.reasoningOutputTokens, 2);

  const store = new AutomationStore({ dataDir: path.join(dir, "store") });
  const job = await store.createJob({
    name: "Usage job",
    workspacePath: dir,
    prompt: "Every run, capture usage and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
  });
  const run = await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null });
  const completed = await store.completeRun(run.id, result);
  assert.equal(completed.inputTokens, 11);
  assert.equal(completed.outputTokens, 7);
  await rm(dir, { recursive: true, force: true });
});

test("environment probe reports exec json capability and missing git clearly", async () => {
  const dir = await tempDir("probe");
  const fakeBin = path.join(dir, "fake-probe.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('youel_ai 1.2.3'); process.exit(0); }",
      "if (args[0] === 'exec' && args.includes('--help')) { console.log('--json\\n--output-last-message\\n--sandbox\\n--cd\\n-c'); process.exit(0); }",
      "process.exit(0);",
    ].join("\n"),
    { mode: 0o755 },
  );
  const probe = await probeYouleAiEnvironment({ youleAiBin: fakeBin, gitCommand: "definitely-missing-git-for-test" });
  assert.equal(probe.youleAi.ok, true);
  assert.equal(probe.youleAi.version, "youel_ai 1.2.3");
  assert.equal(probe.capabilities.supportsExecJson, true);
  assert.equal(probe.capabilities.supportsOutputLastMessage, true);
  assert.equal(probe.capabilities.supportsApprovalPolicyConfig, true);
  assert.equal(probe.git.ok, false);
  await rm(dir, { recursive: true, force: true });
});

test("runner classifies auth expiry and missing CLI with actionable errors", async () => {
  const dir = await tempDir("runner-errors");
  const authBin = path.join(dir, "fake-auth-expired.mjs");
  await writeFile(
    authBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Authentication expired. Please login again.');",
      "console.error('HTTP 401 Unauthorized: auth expired');",
      "process.exit(1);",
    ].join("\n"),
    { mode: 0o755 },
  );

  const authResult = await runYouleAiExec({
    youleAiBin: authBin,
    workspacePath: dir,
    prompt: "Check auth",
    runDir: path.join(dir, "auth-run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(authResult.status, "needs_attention");
  assert.equal(authResult.errorClass, "youle_ai_auth_expired");

  const missingResult = await runYouleAiExec({
    youleAiBin: path.join(dir, "missing-youle-ai"),
    workspacePath: dir,
    prompt: "Check missing binary",
    runDir: path.join(dir, "missing-run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(missingResult.status, "needs_attention");
  assert.equal(missingResult.errorClass, "youle_ai_cli_missing");
  await rm(dir, { recursive: true, force: true });
});

test("runner keeps successful final messages successful despite remote plugin auth warnings", async () => {
  const dir = await tempDir("runner-plugin-auth-warning");
  const warningBin = path.join(dir, "fake-plugin-warning.mjs");
  await writeFile(
    warningBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], '执行结果：真实 agent 已运行。');",
      "console.error('WARN remote plugin sync failed with status 401 Unauthorized');",
      "console.log(JSON.stringify({ type: 'turn.completed' }));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const result = await runYouleAiExec({
    youleAiBin: warningBin,
    workspacePath: dir,
    prompt: "Run despite plugin warning",
    runDir: path.join(dir, "run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(result.status, "success");
  assert.equal(result.errorClass, null);
  await rm(dir, { recursive: true, force: true });
});

test("runner ignores retryable stream disconnect events when a final message succeeds", async () => {
  const dir = await tempDir("runner-retryable-stream-disconnect");
  const retryBin = path.join(dir, "fake-retryable-disconnect.mjs");
  await writeFile(
    retryBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const final = args[args.indexOf('--output-last-message') + 1];",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'Reconnecting... 1/5', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null }, additionalDetails: 'stream disconnected before completion: Concurrency limit exceeded for account, please retry later' }, willRetry: true } }));",
      "writeFileSync(final, '重连后成功返回的最终结果。');",
      "console.log(JSON.stringify({ type: 'turn.completed' }));",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = await runYouleAiExec({
    youleAiBin: retryBin,
    workspacePath: dir,
    prompt: "Run after retry",
    runDir: path.join(dir, "run"),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    timeoutMs: 5000,
  });
  assert.equal(result.status, "success");
  assert.equal(result.errorClass, null);
  assert.equal(result.errorMessage, null);
  assert.equal(result.summary, "重连后成功返回的最终结果。");
  await rm(dir, { recursive: true, force: true });
});

test("worker pauses a job after Youle AI auth expires", async () => {
  const dir = await tempDir("auth-pause");
  const fakeBin = path.join(dir, "fake-auth-pause.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Authentication expired. Please login again.');",
      "process.exit(1);",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Auth pause",
    workspacePath: dir,
    prompt: "Every run, check auth-sensitive work and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin });
  const run = await worker.runNow(job.id);
  assert.equal(run.status, "needs_attention");
  assert.equal(run.errorClass, "youle_ai_auth_expired");
  assert.equal((await store.getJob(job.id)).enabled, false);
  assert.equal((await store.getRun(run.id)).events.some((event) => event.eventType === "job.paused"), true);
  await rm(dir, { recursive: true, force: true });
});

test("worker passes per-job no-output watchdog settings to the runner", async () => {
  const dir = await tempDir("worker-no-output");
  const fakeBin = path.join(dir, "fake-worker-no-output.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'started');",
      "console.log(JSON.stringify({ type: 'thread.started' }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "No output watchdog",
    workspacePath: dir,
    prompt: "Every run, watch output and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, startupTimeoutSeconds: 1, noOutputTimeoutSeconds: 1, cleanupGraceSeconds: 1 },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin });
  const run = await worker.runNow(job.id);
  assert.equal(run.status, "timed_out");
  assert.equal(run.errorClass, "no_output_timeout");
  await rm(dir, { recursive: true, force: true });
});

test("worker creates due runs, applies concurrency skip, and records CLI failures in triage", async () => {
  const dir = await tempDir("worker");
  const fakeBin = path.join(dir, "fake-fail.mjs");
  await writeFile(
    fakeBin,
    "#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: 'turn.failed', error: 'boom' })); process.exit(2);\n",
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Failing job",
    workspacePath: dir,
    prompt: "Every run, run the failing task and return NO_FINDINGS only if nothing failed.",
    schedule: { type: "interval", expr: "PT5M", timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    nextRunAtUtc: "2026-05-29T00:00:00.000Z",
  });

  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    now: () => new Date("2026-05-29T00:10:00.000Z"),
    pollIntervalMs: 10,
  });
  await worker.scanDueJobs();
  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "failed");
  assert.equal((await store.listRuns({ triage: true })).length, 1);
  assert.match((await store.getJob(job.id)).nextRunAtUtc, /^2026-05-29T00:15:00/);

  await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null, status: "running" });
  const skipped = await worker.runNow(job.id);
  assert.equal(skipped.status, "skipped");
  await rm(dir, { recursive: true, force: true });
});

test("worker does not create duplicate skipped chat runs while the same schedule fire is still running", async () => {
  const dir = await tempDir("schedule-active-dedupe");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Daily news",
    workspacePath: dir,
    prompt: "Every run, summarize today's news.",
    schedule: { type: "daily", expr: "09:00", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "skip" },
    nextRunAtUtc: "2026-06-03T01:00:00.000Z",
  });
  await store.createRun({
    jobId: job.id,
    triggerType: "schedule",
    scheduledForUtc: "2026-06-03T01:00:00.000Z",
    status: "running",
  });
  const worker = new AutomationWorker({
    store,
    youleAiBin: path.join(dir, "missing-agent.mjs"),
    now: () => new Date("2026-06-03T01:00:47.000Z"),
  });

  await worker.scanDueJobs();

  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "running");
  assert.equal((await store.getJob(job.id)).nextRunAtUtc, "2026-06-03T01:00:00.000Z");
  await rm(dir, { recursive: true, force: true });
});

test("worker does not rerun the same schedule fire after it already completed", async () => {
  const dir = await tempDir("schedule-completed-dedupe");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Daily news completed",
    workspacePath: dir,
    prompt: "Every run, summarize today's news.",
    schedule: { type: "daily", expr: "09:00", timezone: "Asia/Shanghai", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "skip" },
    nextRunAtUtc: "2026-06-03T01:00:00.000Z",
  });
  const completed = await store.createRun({
    jobId: job.id,
    triggerType: "schedule",
    scheduledForUtc: "2026-06-03T01:00:00.000Z",
    status: "running",
  });
  await store.completeRun(completed.id, { status: "success", summary: "news ok" });
  const worker = new AutomationWorker({
    store,
    youleAiBin: path.join(dir, "missing-agent.mjs"),
    now: () => new Date("2026-06-03T01:00:47.000Z"),
  });

  await worker.scanDueJobs();

  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "success");
  assert.equal((await store.getJob(job.id)).nextRunAtUtc, "2026-06-03T01:00:00.000Z");
  await rm(dir, { recursive: true, force: true });
});

test("worker applies misfire skip and reschedule policies without running the agent", async () => {
  const dir = await tempDir("misfire-skip");
  const fakeBin = path.join(dir, "fake-should-not-run.mjs");
  const markerPath = path.join(dir, "called.txt");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_MARKER, 'called\\n');",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'unexpected');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const base = {
    workspacePath: dir,
    prompt: "Every run, check due state and return NO_FINDINGS if there is no result.",
    schedule: { type: "interval", expr: "PT5M", timezone: "UTC" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    nextRunAtUtc: "2026-05-29T00:00:00.000Z",
  };
  const skipJob = await store.createJob({ ...base, name: "Skip misfire", schedule: { ...base.schedule, misfirePolicy: "skip" } });
  const rescheduleJob = await store.createJob({ ...base, name: "Reschedule misfire", schedule: { ...base.schedule, misfirePolicy: "reschedule_next" } });
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    now: () => new Date("2026-05-29T00:16:00.000Z"),
    runnerEnv: { FAKE_MARKER: markerPath },
  });

  await worker.scanDueJobs();

  const skipRuns = await store.listRuns({ jobId: skipJob.id });
  const rescheduleRuns = await store.listRuns({ jobId: rescheduleJob.id });
  assert.equal(skipRuns.length, 1);
  assert.equal(skipRuns[0].status, "skipped");
  assert.equal(rescheduleRuns.length, 0);
  assert.equal((await store.getJob(skipJob.id)).nextRunAtUtc, "2026-05-29T00:20:00.000Z");
  assert.equal((await store.getJob(rescheduleJob.id)).nextRunAtUtc, "2026-05-29T00:20:00.000Z");
  await assert.rejects(readFile(markerPath, "utf8"));
  await rm(dir, { recursive: true, force: true });
});

test("worker applies run_all misfire policy for each missed interval", async () => {
  const dir = await tempDir("misfire-run-all");
  const fakeBin = path.join(dir, "fake-run-all.mjs");
  const markerPath = path.join(dir, "runs.txt");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_MARKER, 'run\\n');",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'ok');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Run all misfires",
    workspacePath: dir,
    prompt: "Every run, process the missed interval and return NO_FINDINGS if there is no result.",
    schedule: { type: "interval", expr: "PT5M", timezone: "UTC", misfirePolicy: "run_all" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "queue" },
    nextRunAtUtc: "2026-05-29T00:00:00.000Z",
  });
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    now: () => new Date("2026-05-29T00:16:00.000Z"),
    runnerEnv: { FAKE_MARKER: markerPath },
  });

  await worker.scanDueJobs();

  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 4);
  assert.deepEqual(
    runs.map((run) => run.scheduledForUtc).sort(),
    ["2026-05-29T00:00:00.000Z", "2026-05-29T00:05:00.000Z", "2026-05-29T00:10:00.000Z", "2026-05-29T00:15:00.000Z"],
  );
  assert.equal((await store.getJob(job.id)).nextRunAtUtc, "2026-05-29T00:20:00.000Z");
  assert.equal((await readFile(markerPath, "utf8")).trim().split(/\n/).length, 4);
  await rm(dir, { recursive: true, force: true });
});

test("worker enforces a global max concurrent run limit across jobs", async () => {
  const dir = await tempDir("global-concurrency");
  const fakeBin = path.join(dir, "fake-global-limit.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_STARTS, `${Date.now()}\\n`);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'ok');",
      "await new Promise((resolve) => setTimeout(resolve, 120));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const base = {
    workspacePath: dir,
    prompt: "Every run, execute this limited task and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "allow_parallel" },
  };
  const firstJob = await store.createJob({ ...base, name: "Limited 1" });
  const secondJob = await store.createJob({ ...base, name: "Limited 2" });
  const startsPath = path.join(dir, "starts.txt");
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    runnerEnv: { FAKE_STARTS: startsPath },
    maxConcurrentRuns: 1,
  });
  const first = worker.runNow(firstJob.id);
  await waitFor(async () => (await store.listRuns({ jobId: firstJob.id })).some((run) => run.status === "running"));
  const second = worker.runNow(secondJob.id);
  await Promise.all([first, second]);
  const starts = (await readFile(startsPath, "utf8")).trim().split(/\n/).map(Number);
  assert.equal(starts.length, 2);
  assert(starts[1] - starts[0] >= 100);
  await rm(dir, { recursive: true, force: true });
});

test("worker serializes local workspace write jobs even when global concurrency allows more", async () => {
  const dir = await tempDir("local-write-lock");
  const fakeBin = path.join(dir, "fake-local-write.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_STARTS, `${Date.now()}\\n`);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'ok');",
      "await new Promise((resolve) => setTimeout(resolve, 120));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const base = {
    workspacePath: dir,
    prompt: "Every run, edit this workspace and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "workspace-write", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "allow_parallel", allowLocalWrite: true },
  };
  const firstJob = await store.createJob({ ...base, name: "Local write 1" });
  const secondJob = await store.createJob({ ...base, name: "Local write 2" });
  const startsPath = path.join(dir, "starts.txt");
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    runnerEnv: { FAKE_STARTS: startsPath },
    maxConcurrentRuns: 2,
  });
  const first = worker.runNow(firstJob.id);
  await waitFor(async () => (await store.listRuns({ jobId: firstJob.id })).some((run) => run.status === "running"));
  const second = worker.runNow(secondJob.id);
  await Promise.all([first, second]);
  const starts = (await readFile(startsPath, "utf8")).trim().split(/\n/).map(Number);
  assert.equal(starts.length, 2);
  assert(starts[1] - starts[0] >= 100);
  await rm(dir, { recursive: true, force: true });
});

test("worker delivers configured webhook payload after actionable runs", async () => {
  const dir = await tempDir("worker-delivery");
  const fakeBin = path.join(dir, "fake-delivery.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'found issue');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Delivery job",
    workspacePath: dir,
    prompt: "Every run, review the project and return NO_FINDINGS if there is no important result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    delivery: { mode: "webhook", provider: "slack", url: "https://hooks.example.com/youle", autoArchiveNoFindings: true },
  });
  const deliveries = [];
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    deliverySecret: "",
    deliveryAllowlist: [],
    deliveryFn: async (delivery) => {
      deliveries.push(delivery);
      return { ok: true, status: 200 };
    },
  });
  const run = await worker.runNow(job.id);
  assert.equal(run.status, "success");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].url, "https://hooks.example.com/youle");
  assert.equal(deliveries[0].secret, "");
  assert.deepEqual(deliveries[0].allowlist, []);
  assert.equal(deliveries[0].payload.text.includes("Delivery job"), true);
  assert.equal(deliveries[0].payload.text.includes("found issue"), true);
  const detail = await store.getRun(run.id);
  const event = detail.events.find((entry) => entry.eventType === "delivery.completed");
  assert.equal(event.payload.status, 200);
  await rm(dir, { recursive: true, force: true });
});

test("worker run delivery applies webhook allowlist and secret", async () => {
  const dir = await tempDir("worker-delivery-policy");
  const fakeBin = path.join(dir, "fake-delivery-policy.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'needs delivery');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Delivery policy job",
    workspacePath: dir,
    prompt: "Every run, deliver findings and return NO_FINDINGS if there is no important result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    delivery: { mode: "webhook", provider: "webhook", url: "https://hooks.example.com/youle", autoArchiveNoFindings: true },
  });
  const deliveries = [];
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    deliverySecret: "install-secret",
    deliveryAllowlist: " hooks.example.com , alerts.example.com ",
    deliveryFn: async (delivery) => {
      deliveries.push(delivery);
      return { ok: true, status: 200 };
    },
  });
  const run = await worker.runNow(job.id);
  assert.equal(run.status, "success");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].secret, "install-secret");
  assert.deepEqual(deliveries[0].allowlist, ["hooks.example.com", "alerts.example.com"]);
  await rm(dir, { recursive: true, force: true });
});

test("worker records rejected webhook responses as delivery failures", async () => {
  const dir = await tempDir("worker-delivery-rejected");
  const fakeBin = path.join(dir, "fake-delivery-rejected.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'needs delivery');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Rejected delivery job",
    workspacePath: dir,
    prompt: "Every run, deliver findings and return NO_FINDINGS if there is no important result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
    delivery: { mode: "webhook", provider: "webhook", url: "https://hooks.example.com/youle", autoArchiveNoFindings: true },
  });
  const worker = new AutomationWorker({
    store,
    youleAiBin: fakeBin,
    deliveryFn: async () => ({ ok: false, status: 500, body: "server error" }),
  });
  const run = await worker.runNow(job.id);
  const detail = await store.getRun(run.id);

  assert.equal(run.status, "success");
  assert.equal(detail.events.some((entry) => entry.eventType === "delivery.completed"), false);
  const failed = detail.events.find((entry) => entry.eventType === "delivery.failed");
  assert(failed);
  assert.match(failed.payload.error, /HTTP 500/);
  await rm(dir, { recursive: true, force: true });
});

test("worker records patch artifacts from app-server automation executors", async () => {
  const dir = await tempDir("worker-app-server-patch");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  await run("git", ["-C", repo, "init"]);
  await run("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(path.join(repo, "README.md"), "before\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "commit", "-m", "initial"]);
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "App server patch job",
    workspacePath: repo,
    prompt: "Every run, update README and return a summary.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "worktree", sandboxMode: "workspace-write", approvalPolicy: "never", maxDurationSeconds: 5 },
  });
  const worker = new AutomationWorker({
    store,
    executor: async ({ workspacePath }) => {
      await writeFile(path.join(workspacePath, "README.md"), "after\n");
      return { status: "success", summary: "changed README", artifacts: [] };
    },
  });

  const completed = await worker.runNow(job.id);
  const detail = await store.getRun(completed.id);

  assert.equal(completed.hasPatch, true);
  assert.match(await readFile(completed.patchPath, "utf8"), /after/);
  assert.equal(detail.artifacts.some((artifact) => artifact.type === "patch"), true);
  await rm(dir, { recursive: true, force: true });
});

test("worker does not treat pre-existing read-only local diffs as run patches", async () => {
  const dir = await tempDir("worker-readonly-dirty-baseline");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  await run("git", ["-C", repo, "init"]);
  await run("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(path.join(repo, "README.md"), "clean\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "commit", "-m", "initial"]);
  await writeFile(path.join(repo, "README.md"), "pre-existing dirty change\n");
  await writeFile(path.join(repo, "local-note.txt"), "pre-existing untracked file\n");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Read-only dirty baseline",
    workspacePath: repo,
    prompt: "Every run, inspect the repo and return NO_FINDINGS if there is no important result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
  });
  const worker = new AutomationWorker({
    store,
    executor: async () => ({ status: "no_findings", summary: "NO_FINDINGS", artifacts: [] }),
  });

  const completed = await worker.runNow(job.id);
  const detail = await store.getRun(completed.id);

  assert.equal(completed.hasPatch, false);
  assert.equal(completed.patchPath, null);
  assert.equal(detail.artifacts.some((artifact) => artifact.type === "patch"), false);
  await rm(dir, { recursive: true, force: true });
});

test("worker records run metadata artifact for completed runs", async () => {
  const dir = await tempDir("worker-run-metadata");
  const fakeBin = path.join(dir, "fake-metadata.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'metadata ok');",
      "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } }));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Metadata job",
    workspacePath: dir,
    prompt: "Every run, capture metadata and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5 },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin });

  const run = await worker.runNow(job.id);
  const loaded = await store.getRun(run.id);
  const artifact = loaded.artifacts.find((entry) => entry.type === "run_metadata");
  assert(artifact);
  const metadata = JSON.parse(await readFile(artifact.path, "utf8"));
  assert.equal(metadata.run.id, run.id);
  assert.equal(metadata.run.status, "success");
  assert.equal(metadata.run.inputTokens, 5);
  assert.equal(metadata.job.id, job.id);
  assert.equal(metadata.job.name, "Metadata job");
  await rm(dir, { recursive: true, force: true });
});

test("worker custom executor receives raw prompt and persists the same agent thread", async () => {
  const dir = await tempDir("worker-agent-thread");
  const store = new AutomationStore({ dataDir: dir });
  const prompt = "每次运行时，打开电脑上的记事本，记录当前时间，然后告诉我结果；如果没有有效结果，请返回 NO_FINDINGS。";
  const job = await store.createJob({
    name: "Agent session job",
    workspacePath: dir,
    prompt,
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "queue" },
  });
  const calls = [];
  const agentThreadId = "019eb4a8-94e6-78e1-a258-ff5c7323244f";
  const worker = new AutomationWorker({
    store,
    executor: async ({ job: executingJob, prompt: receivedPrompt }) => {
      const threadId = executingJob.agentThreadId || agentThreadId;
      calls.push({ prompt: receivedPrompt, threadId: executingJob.agentThreadId || null });
      return {
        status: "success",
        summary: `sent to ${threadId}`,
        agentThreadId: threadId,
      };
    },
  });

  const first = await worker.runNow(job.id);
  const second = await worker.runNow(job.id);
  const savedJob = await store.getJob(job.id);

  assert.equal(first.agentThreadId, agentThreadId);
  assert.equal(second.agentThreadId, agentThreadId);
  assert.equal(savedJob.agentThreadId, agentThreadId);
  assert.deepEqual(calls, [
    { prompt, threadId: null },
    { prompt, threadId: agentThreadId },
  ]);
  await rm(dir, { recursive: true, force: true });
});

test("worker cancellation terminates an active run and records cancelled status", async () => {
  const dir = await tempDir("cancel");
  const fakeBin = path.join(dir, "fake-hang.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'started');",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Cancelable job",
    workspacePath: dir,
    prompt: "Every run, execute the task and return NO_FINDINGS if it is cancelled without findings.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin });
  const runPromise = worker.runNow(job.id);
  await waitFor(async () => (await store.listRuns({ jobId: job.id })).find((run) => run.status === "running"));
  const running = (await store.listRuns({ jobId: job.id })).find((run) => run.status === "running");
  await worker.cancelRun(running.id);
  const run = await runPromise;
  assert.equal(run.status, "cancelled");
  assert.equal((await store.getRun(run.id)).status, "cancelled");
  await rm(dir, { recursive: true, force: true });
});

test("queue concurrency waits for active run before starting the next run", async () => {
  const dir = await tempDir("queue");
  const fakeBin = path.join(dir, "fake-queue.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_ORDER, `${Date.now()}\\n`);",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'ok');",
      "await new Promise((resolve) => setTimeout(resolve, 120));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Queued job",
    workspacePath: dir,
    prompt: "Every run, execute the queued task and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "queue" },
  });
  const orderPath = path.join(dir, "order.txt");
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin, runnerEnv: { FAKE_ORDER: orderPath } });
  const first = worker.runNow(job.id);
  await waitFor(async () => (await store.listRuns({ jobId: job.id })).some((run) => run.status === "running"));
  const second = worker.runNow(job.id);
  const [firstRun, secondRun] = await Promise.all([first, second]);
  assert.equal(firstRun.status, "success");
  assert.equal(secondRun.status, "success");
  const starts = (await readFile(orderPath, "utf8")).trim().split(/\n/).map(Number);
  assert.equal(starts.length, 2);
  assert(starts[1] - starts[0] >= 100);
  await rm(dir, { recursive: true, force: true });
});

test("cancel_previous concurrency cancels the active run and starts the replacement", async () => {
  const dir = await tempDir("cancel-previous");
  const fakeBin = path.join(dir, "fake-cancel-previous.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "appendFileSync(process.env.FAKE_ORDER, 'start\\n');",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'ok');",
      "await new Promise((resolve) => setTimeout(resolve, 400));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Replace job",
    workspacePath: dir,
    prompt: "Every run, replace active task state and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, concurrencyPolicy: "cancel_previous" },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin, runnerEnv: { FAKE_ORDER: path.join(dir, "order.txt") } });
  const first = worker.runNow(job.id);
  await waitFor(async () => (await store.listRuns({ jobId: job.id })).some((run) => run.status === "running"));
  const second = await worker.runNow(job.id);
  const firstRun = await first;
  assert.equal(firstRun.status, "cancelled");
  assert.equal(second.status, "success");
  await rm(dir, { recursive: true, force: true });
});

test("failed runs retry up to maxRetries with retry trigger and incremented attempt", async () => {
  const dir = await tempDir("retry");
  const fakeBin = path.join(dir, "fake-retry.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { existsSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const marker = process.env.FAKE_MARKER;",
      "const final = args[args.indexOf('--output-last-message') + 1];",
      "if (!existsSync(marker)) { writeFileSync(marker, 'failed'); writeFileSync(final, 'failed once'); process.exit(2); }",
      "writeFileSync(final, 'retry ok');",
    ].join("\n"),
    { mode: 0o755 },
  );
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Retry job",
    workspacePath: dir,
    prompt: "Every run, retry once when needed and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 5, maxRetries: 1, retryBackoffSeconds: 0 },
  });
  const worker = new AutomationWorker({ store, youleAiBin: fakeBin, runnerEnv: { FAKE_MARKER: path.join(dir, "marker") } });
  const finalRun = await worker.runNow(job.id);
  const runs = await store.listRuns({ jobId: job.id });
  assert.equal(runs.length, 2);
  assert.equal(runs.find((run) => run.attempt === 1).status, "failed");
  assert.equal(runs.find((run) => run.attempt === 2).triggerType, "retry");
  assert.equal(finalRun.status, "success");
  assert.equal(finalRun.attempt, 2);
  await rm(dir, { recursive: true, force: true });
});

test("worker startup recovers stale running runs as lost and writes heartbeat", async () => {
  const dir = await tempDir("recover");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Recover job",
    workspacePath: dir,
    prompt: "Every run, recover stale state and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
  });
  const run = await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null, status: "running" });
  const worker = new AutomationWorker({ store, youleAiBin: process.execPath });
  await worker.start();
  await worker.stop();
  assert.equal((await store.getRun(run.id)).status, "lost");
  assert.equal((await store.getHeartbeat(worker.workerId)).pid, process.pid);
  await rm(dir, { recursive: true, force: true });
});

test("store heartbeat drops dead worker pids when current worker writes", async () => {
  const dir = await tempDir("heartbeat-current-pid");
  const store = new AutomationStore({ dataDir: dir });
  await store.writeHeartbeat({ workerId: "worker-old", pid: 999999, appVersion: "old" });
  await store.writeHeartbeat({ workerId: `worker-${process.pid}`, pid: process.pid, appVersion: "test" });
  await store.load();
  assert.deepEqual(store.data.heartbeats.map((heartbeat) => ({ workerId: heartbeat.workerId, pid: heartbeat.pid })), [
    { workerId: `worker-${process.pid}`, pid: process.pid },
  ]);
  await rm(dir, { recursive: true, force: true });
});

test("worker lock prevents a second worker from taking the same user lock", async () => {
  const dir = await tempDir("lock");
  const first = new WorkerLock({ lockDir: dir, userKey: "test-user" });
  const second = new WorkerLock({ lockDir: dir, userKey: "test-user" });
  assert.equal(await first.acquire(), true);
  assert.equal(await second.acquire(), false);
  await first.release();
  assert.equal(await second.acquire(), true);
  await second.release();
  await rm(dir, { recursive: true, force: true });
});

test("worker lock removes stale owner locks", async () => {
  const dir = await tempDir("stale-lock");
  const stale = new WorkerLock({ lockDir: dir, userKey: "test-user" });
  await mkdir(stale.lockPath, { recursive: true });
  await writeFile(path.join(stale.lockPath, "owner.json"), JSON.stringify({ pid: 999999, startedAt: "2026-01-01T00:00:00.000Z" }));
  assert.equal(await stale.acquire(), true);
  await stale.release();
  await rm(dir, { recursive: true, force: true });
});

test("worker stop keeps the singleton lock until active runs finish", async () => {
  const dir = await tempDir("stop-active-lock");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Stop active job",
    workspacePath: dir,
    prompt: "Every run, wait until cancellation and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
  });
  let releaseExecutor;
  const executorReleased = new Promise((resolve) => {
    releaseExecutor = resolve;
  });
  const worker = new AutomationWorker({
    store,
    youleAiBin: process.execPath,
    executor: async ({ abortController }) => {
      await new Promise((resolve) => abortController.signal.addEventListener("abort", resolve, { once: true }));
      await executorReleased;
      return { status: "cancelled", summary: "Stopped by worker shutdown." };
    },
  });

  assert.equal((await worker.start()).running, true);
  const runPromise = worker.runNow(job.id);
  await waitFor(() => worker.activeRunPromises.size === 1);
  const stopPromise = worker.stop();
  await waitFor(() => worker.activeRuns.size === 1 && [...worker.activeRuns.values()][0].abortController.signal.aborted);

  const competing = new WorkerLock({ lockDir: path.join(dir, "locks"), userKey: "automation-worker" });
  assert.equal(await competing.acquire(), false);
  releaseExecutor();
  const run = await runPromise;
  await stopPromise;
  assert.equal(run.status, "cancelled");
  assert.equal(await competing.acquire(), true);
  await competing.release();
  await rm(dir, { recursive: true, force: true });
});

test("workspace-write jobs run in a git worktree and collect patch artifacts", async () => {
  const dir = await tempDir("worktree");
  const repo = path.join(dir, "repo");
  const worktreesRoot = path.join(dir, "worktrees");
  await mkdir(repo, { recursive: true });
  await run("git", ["-C", repo, "init"]);
  await run("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(path.join(repo, "README.md"), "before\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "commit", "-m", "initial"]);

  const workspace = await prepareRunWorkspace({
    job: { id: "job-1", workspacePath: repo, workspaceMode: "worktree", baseRef: "HEAD" },
    runId: "run-1",
    worktreesRoot,
  });
  assert.notEqual(workspace.workspacePath, repo);
  await writeFile(path.join(workspace.workspacePath, "README.md"), "after\n");
  const fakeBin = path.join(dir, "fake-success.mjs");
  await writeFile(
    fakeBin,
    "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'; const args=process.argv.slice(2); writeFileSync(args[args.indexOf('--output-last-message')+1], 'changed');\n",
    { mode: 0o755 },
  );
  const result = await runYouleAiExec({
    youleAiBin: fakeBin,
    workspacePath: workspace.workspacePath,
    prompt: "",
    runDir: path.join(dir, "run"),
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    timeoutMs: 5000,
    env: {},
    onEvent: () => {},
  });
  assert.equal(result.hasPatch, true);
  assert.match(await readFile(result.patchPath, "utf8"), /after/);
  await rm(dir, { recursive: true, force: true });
});

test("CLI patch collection includes untracked files", async () => {
  const dir = await tempDir("untracked-patch");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  await run("git", ["-C", repo, "init"]);
  await run("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(path.join(repo, "README.md"), "before\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "commit", "-m", "initial"]);
  const fakeBin = path.join(dir, "fake-untracked.mjs");
  await writeFile(
    fakeBin,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const args = process.argv.slice(2);",
      "const workspace = args[args.indexOf('--cd') + 1];",
      "writeFileSync(join(workspace, 'new-file.txt'), 'new content\\n');",
      "writeFileSync(args[args.indexOf('--output-last-message') + 1], 'created file');",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = await runYouleAiExec({
    youleAiBin: fakeBin,
    workspacePath: repo,
    prompt: "",
    runDir: path.join(dir, "run"),
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    timeoutMs: 5000,
    env: {},
  });

  assert.equal(result.hasPatch, true);
  const patch = await readFile(result.patchPath, "utf8");
  assert.match(patch, /new-file\.txt/);
  assert.match(patch, /new content/);
  await rm(dir, { recursive: true, force: true });
});

test("worktree preparation can include current dirty state when explicitly enabled", async () => {
  const dir = await tempDir("dirty-worktree");
  const repo = path.join(dir, "repo");
  await mkdir(repo, { recursive: true });
  await run("git", ["-C", repo, "init"]);
  await run("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(path.join(repo, "README.md"), "clean\n");
  await run("git", ["-C", repo, "add", "README.md"]);
  await run("git", ["-C", repo, "commit", "-m", "initial"]);
  await writeFile(path.join(repo, "README.md"), "dirty\n");
  const workspace = await prepareRunWorkspace({
    job: { id: "dirty-job", workspacePath: repo, workspaceMode: "worktree", baseRef: "HEAD", includeDirtyState: true },
    runId: "dirty-run",
    worktreesRoot: path.join(dir, "worktrees"),
  });
  assert.equal((await readFile(path.join(workspace.workspacePath, "README.md"), "utf8")).replace(/\r\n/g, "\n"), "dirty\n");
  await assert.rejects(readFile(path.join(workspace.workspacePath, ".youle-automation-dirty.patch"), "utf8"));
  await rm(dir, { recursive: true, force: true });
});

test("workspace classifier identifies local, WSL, UNC, and remote paths", () => {
  assert.equal(classifyWorkspacePath("C:\\repo\\app").kind, "local");
  assert.equal(classifyWorkspacePath("/home/user/repo").kind, "local");
  assert.equal(classifyWorkspacePath("\\\\wsl$\\Ubuntu\\home\\user\\repo").kind, "wsl");
  assert.equal(classifyWorkspacePath("\\\\server\\share\\repo").kind, "unc");
  assert.equal(classifyWorkspacePath("ssh://git@example.com/repo.git").kind, "remote");
});

test("worktree cleanup removes old reviewed worktrees but keeps patch runs", async () => {
  const dir = await tempDir("cleanup");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Cleanup job",
    workspacePath: dir,
    prompt: "Every run, cleanup reviewed worktrees and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", expr: null, timezone: "UTC", misfirePolicy: "run_once" },
    execution: { workspaceMode: "local", sandboxMode: "read-only", approvalPolicy: "never", maxDurationSeconds: 60 },
  });
  const removablePath = path.join(dir, "worktrees", "remove-me");
  const keptPath = path.join(dir, "worktrees", "keep-me");
  await mkdir(removablePath, { recursive: true });
  await mkdir(keptPath, { recursive: true });
  const removable = await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null });
  await store.updateRun(removable.id, { status: "success", worktreePath: removablePath, hasPatch: false, archived: true, completedAt: "2026-01-01T00:00:00.000Z" });
  const kept = await store.createRun({ jobId: job.id, triggerType: "manual", scheduledForUtc: null });
  await store.updateRun(kept.id, { status: "success", worktreePath: keptPath, hasPatch: true, archived: false, completedAt: "2026-01-01T00:00:00.000Z" });
  const removed = await store.cleanupWorktrees({ nowUtc: "2026-05-29T00:00:00.000Z", retainDays: 14 });
  assert.deepEqual(removed, [removablePath]);
  await assert.rejects(stat(removablePath));
  assert.equal((await stat(keptPath)).isDirectory(), true);
  await rm(dir, { recursive: true, force: true });
});

test("windows login task command is one app task with limited privileges", () => {
  const command = buildLoginTaskCommand({
    taskName: "\\youle_desktop\\AutomationWorker",
    workerPath: "C:\\Program Files\\youle_desktop\\automation-worker.exe",
  });
  assert.match(command.join(" "), /\/SC ONLOGON/);
  assert.match(command.join(" "), /\/RL LIMITED/);
  assert.match(command.join(" "), /AutomationWorker/);
  assert(!command.join(" ").includes("/RU SYSTEM"));
});

test("notification policy alerts only actionable automation runs", () => {
  assert.equal(shouldNotifyRun({ status: "failed" }, { deliveryMode: "notification" }), true);
  assert.equal(shouldNotifyRun({ status: "timed_out" }, { deliveryMode: "notification" }), true);
  assert.equal(shouldNotifyRun({ status: "success", hasPatch: true }, { deliveryMode: "notification" }), true);
  assert.equal(shouldNotifyRun({ status: "success", hasFindings: true }, { deliveryMode: "inbox" }), false);
  assert.equal(shouldNotifyRun({ status: "no_findings" }, { deliveryMode: "notification" }), false);
});

test("natural language draft manifest requires confirmation and chooses safe defaults", () => {
  const draft = createDraftAutomationManifest("每天早上 9 点检查这个项目 CI 失败，有的话尝试修复", {
    workspacePath: "C:/repo",
    timezone: "Asia/Shanghai",
  });
  assert.equal(draft.requiresConfirmation, true);
  assert.equal(draft.schedule.type, "cron");
  assert.equal(draft.schedule.expr, "0 9 * * *");
  assert.equal(draft.workspaceMode, "worktree");
  assert.equal(draft.sandboxMode, "workspace-write");
  assert.equal(draft.riskLevel, "medium");
});

test("fan-out draft creation builds one disabled confirmed job per workspace", () => {
  const drafts = createFanoutAutomationDrafts({
    text: "Every run, review the project and return NO_FINDINGS if there is no important result.",
    workspacePaths: ["C:/repo-a", "C:/repo-b"],
    timezone: "Asia/Shanghai",
  });
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].enabled, false);
  assert.equal(drafts[0].requiresConfirmation, true);
  assert.equal(drafts[0].workspacePath, "C:/repo-a");
  assert.equal(drafts[1].workspacePath, "C:/repo-b");
});

test("enterprise policy blocks full access and too-frequent schedules", () => {
  assert.throws(
    () =>
      enforceAutomationPolicy({
        scheduleType: "interval",
        scheduleExpr: "PT1M",
        sandboxMode: "read-only",
        approvalPolicy: "never",
      }),
    /minimum interval/i,
  );
  assert.throws(
    () =>
      enforceAutomationPolicy({
        scheduleType: "manual",
        scheduleExpr: null,
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
      }),
    /danger-full-access/i,
  );
  assert.throws(
    () =>
      enforceAutomationPolicy({
        scheduleType: "manual",
        scheduleExpr: null,
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        createdBy: "auto_task_ui",
      }),
    /danger-full-access/i,
  );
  assert.equal(
    enforceAutomationPolicy(
      {
        scheduleType: "manual",
        scheduleExpr: null,
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        createdBy: "auto_task_ui",
      },
      { trustedAutoTaskUi: true },
    ),
    true,
  );
});

test("prompt validation rejects vague or unsafe unattended tasks", () => {
  assert.deepEqual(validateAutomationPrompt("Review this repository every run and return NO_FINDINGS if there is nothing important.", { workspacePath: "C:/repo" }).ok, true);
  assert.equal(validateAutomationPrompt("帮我查询余额，少于5元就提醒我，给我发一条通知消息，告知我当前余额有多少", { workspacePath: "C:/repo" }).ok, true);
  assert.equal(validateAutomationPrompt("帮我看看", { workspacePath: "C:/repo" }).ok, false);
  assert.match(validateAutomationPrompt("持续运行直到完成，不要停止。", { workspacePath: "C:/repo" }).error, /持续运行|infinite/i);
  assert.match(validateAutomationPrompt("Delete everything outside the project path.", { workspacePath: "C:/repo" }).error, /sandbox|范围/i);
});

test("store policy rejects unsafe job updates", async () => {
  const dir = await tempDir("store-policy-update");
  const store = new AutomationStore({ dataDir: dir });
  const job = await store.createJob({
    name: "Policy update",
    workspacePath: dir,
    prompt: "Every run, inspect only and return NO_FINDINGS if there is no result.",
    schedule: { type: "manual", timezone: "UTC" },
  });

  await assert.rejects(
    store.updateJob(job.id, {
      execution: { sandboxMode: "danger-full-access", approvalPolicy: "never" },
    }),
    /danger-full-access/i,
  );
  await assert.rejects(
    store.updateJob(job.id, {
      createdBy: "auto_task_ui",
      execution: { sandboxMode: "danger-full-access", approvalPolicy: "never" },
    }),
    /danger-full-access/i,
  );
  const trusted = await store.updateJob(job.id, {
    trustedAutoTaskUi: true,
    createdBy: "auto_task_ui",
    execution: { sandboxMode: "danger-full-access", approvalPolicy: "never" },
  });
  assert.equal(trusted.sandboxMode, "danger-full-access");
  assert.equal(Object.hasOwn(trusted, "trustedAutoTaskUi"), false);
  const resumed = await store.updateJob(job.id, { enabled: true });
  assert.equal(resumed.sandboxMode, "danger-full-access");
  const threadUpdated = await store.updateJob(job.id, { agentThreadId: "019eb4a8-94e6-78e1-a258-ff5c7323244f" });
  assert.equal(threadUpdated.agentThreadId, "019eb4a8-94e6-78e1-a258-ff5c7323244f");
});

test("webhook delivery signs payloads and rejects non-allowlisted URLs", async () => {
  const slackPayload = buildDeliveryPayload({
    provider: "slack",
    run: { status: "failed", summary: "failed summary", hasPatch: true },
    job: { name: "Nightly check" },
  });
  assert.match(slackPayload.text, /Nightly check/);
  assert.match(slackPayload.text, /failed summary/);

  await assert.rejects(
    deliverWebhook({
      url: "https://evil.example/hook",
      payload: { status: "failed" },
      secret: "secret",
      allowlist: ["hooks.example.com"],
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "ok" }),
    }),
    /not allowlisted/i,
  );
  const requests = [];
  const result = await deliverWebhook({
    url: "https://hooks.example.com/youle",
    payload: { status: "failed" },
    secret: "secret",
    allowlist: ["hooks.example.com"],
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, text: async () => "ok" };
    },
  });
  assert.equal(result.ok, true);
  assert.match(requests[0].init.headers["x-youle-signature"], /^sha256=/);
  assert.equal(requests[0].init.headers["content-type"], "application/json");
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}: ${stderr}`));
    });
  });
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}
