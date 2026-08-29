import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assessSoakReport, renderSoakAssessmentMarkdown } from "../scripts/trading-alert-soak-assess.mjs";
import { parseSoakOptions, runSoak, summarizeSoakSamples } from "../scripts/trading-alert-soak.mjs";

function stableReport(overrides = {}) {
  const samples = Array.from({ length: 25 }, (_, index) => ({
    elapsedMs: index * 3_600_000,
    heapUsed: (32 + index * 0.05) * 1024 * 1024,
    rss: (180 + index * 0.1) * 1024 * 1024,
    cpuUserMicros: index * 3_600_000 * 1_000 * 0.08,
    cpuSystemMicros: index * 3_600_000 * 1_000 * 0.02,
    hub: { subscriptions: 1, healthySubscriptions: 1 },
  }));
  return {
    runId: "stable-24h",
    status: "passed",
    error: null,
    elapsedMs: 86_400_000,
    options: { durationMs: 86_400_000, sampleMs: 3_600_000, alerts: 100 },
    hub: { received: 10_000, emitted: 10_000, duplicates: 0, late: 25, gaps: 0 },
    evidence: 0,
    duplicateEvidence: 0,
    notifications: 0,
    monitoringGaps: 0,
    samples,
    ...overrides,
  };
}

test("soak runner defaults to a real 24h Hyperliquid run and validates its limits", () => {
  const options = parseSoakOptions([]);
  assert.equal(options.provider, "hyperliquid");
  assert.equal(options.durationMs, 86_400_000);
  assert.equal(options.alerts, 100);
  assert.throws(() => parseSoakOptions(["--duration-ms", "20"]), /1 秒到 7 天/);
  assert.throws(() => parseSoakOptions(["--provider", "unknown"]), /provider/);
});

test("scheduled soak launcher prevents idle sleep and preserves a stale run before restarting", async () => {
  const launcher = await readFile(new URL("../scripts/run-trading-alert-soak-task.ps1", import.meta.url), "utf8");
  assert.match(launcher, /SetThreadExecutionState\(\$ES_CONTINUOUS -bor \$ES_SYSTEM_REQUIRED\)/);
  assert.match(launcher, /SetThreadExecutionState\(\$ES_CONTINUOUS\)/);
  assert.match(launcher, /Test-SoakProcessOwner[\s\S]*trading-alert-soak\.mjs/);
  assert.match(launcher, /\.interrupted\.json/);
  assert.match(launcher, /resumePolicy = "restart_full_24h"/);
  assert.match(launcher, /Test-CompletedSoakRun[\s\S]*status -eq "passed"/);
  assert.match(launcher, /elapsedMs -ge \$requiredDurationMs/);
  assert.match(launcher, /existing completed 24-hour report preserved for assessment/);
});

test("resource summary reports deterministic heap and RSS slopes", () => {
  const summary = summarizeSoakSamples([
    { elapsedMs: 0, heapUsed: 10 * 1024 * 1024, rss: 100 * 1024 * 1024 },
    { elapsedMs: 3_600_000, heapUsed: 11 * 1024 * 1024, rss: 102 * 1024 * 1024 },
  ], 3_600_000);
  assert.equal(summary.heapSlopeMiBPerHour, 1);
  assert.equal(summary.rssSlopeMiBPerHour, 2);
});

test("synthetic soak exercises 100 shared alerts and writes machine-readable evidence", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-soak-test-"));
  const result = await runSoak(parseSoakOptions(["--provider", "synthetic", "--duration-ms", "1200", "--sample-ms", "250", "--alerts", "100", "--output", output]));
  assert.equal(result.report.status, "passed");
  assert.equal(result.report.hub.subscriptions, 0);
  assert.equal(result.report.hub.received > 0, true);
  assert.equal(Math.max(...result.report.samples.map((sample) => sample.hub.subscriptions)), 1);
  assert.equal(result.report.duplicateEvidence, 0);
  assert.equal(result.report.resources.sampleCount >= 3, true);
  assert.equal(result.report.processId, process.pid);
  assert.equal(Number.isFinite(Date.parse(result.report.checkpointedAt)), true);
  assert.equal(JSON.parse(await readFile(result.reportPath, "utf8")).runId, result.report.runId);
  assert.match(await readFile(result.markdownPath, "utf8"), /真实长稳报告/);
});

test("24h assessment passes a stable shared-subscription report with deterministic gates", () => {
  const assessment = assessSoakReport(stableReport());
  assert.equal(assessment.passed, true);
  assert.deepEqual(assessment.failedCheckIds, []);
  assert.equal(assessment.metrics.cpuPercentOfOneCore, 10);
  assert.match(renderSoakAssessmentMarkdown(assessment), /结论：通过/);
});

test("24h assessment ignores bounded warmup but rejects a sustained heap leak", () => {
  const warmup = stableReport();
  warmup.samples[0].rss = 90 * 1024 * 1024;
  assert.equal(assessSoakReport(warmup).passed, true);

  const leaking = stableReport();
  leaking.samples = leaking.samples.map((sample, index) => ({ ...sample, heapUsed: (32 + index * 2) * 1024 * 1024 }));
  const assessment = assessSoakReport(leaking);
  assert.equal(assessment.passed, false);
  assert.ok(assessment.failedCheckIds.includes("heap-slope"));
});

test("24h assessment fails closed for running, undersampled, unhealthy, or duplicated input", () => {
  const report = stableReport({ status: "running", elapsedMs: 3_600_000 });
  report.samples = report.samples.slice(0, 1);
  report.hub = { ...report.hub, duplicates: 1, gaps: 1 };
  const assessment = assessSoakReport(report);
  assert.equal(assessment.passed, false);
  for (const id of ["status", "wall-clock", "sample-coverage", "market-duplicates", "market-gaps", "heap-slope", "rss-slope"]) {
    assert.ok(assessment.failedCheckIds.includes(id), id);
  }
});
