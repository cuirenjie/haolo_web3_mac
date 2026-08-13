import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOUR = 3_600_000;
const MIB = 1024 * 1024;
const MINIMUM_WALL_CLOCK_MS = 24 * HOUR;

export const DEFAULT_SOAK_THRESHOLDS = Object.freeze({
  minimumWallClockMs: MINIMUM_WALL_CLOCK_MS,
  minimumSampleCoverage: 0.95,
  minimumHealthySampleRatio: 0.95,
  maximumLateEventRatio: 0.1,
  maximumCpuPercentOfOneCore: 50,
  maximumHeapMiB: 256,
  maximumRssMiB: 512,
  maximumSteadyHeapSlopeMiBPerHour: 1,
  maximumSteadyRssSlopeMiBPerHour: 4,
  warmupMs: 30 * 60_000,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value, digits = 4) {
  return Number(finite(value).toFixed(digits));
}

function regressionSlopeMiBPerHour(samples, field) {
  if (samples.length < 2) return null;
  const origin = finite(samples[0].elapsedMs);
  const xs = samples.map((sample) => (finite(sample.elapsedMs) - origin) / HOUR);
  const ys = samples.map((sample) => finite(sample[field]) / MIB);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (!denominator) return null;
  return rounded(xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator);
}

function check(id, label, passed, actual, expected) {
  return Object.freeze({ id, label, passed: Boolean(passed), actual, expected });
}

export function assessSoakReport(report, overrides = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("长稳报告必须是对象");
  const thresholds = Object.freeze({ ...DEFAULT_SOAK_THRESHOLDS, ...overrides });
  const samples = Array.isArray(report.samples)
    ? report.samples.filter((sample) => sample && typeof sample === "object").sort((left, right) => finite(left.elapsedMs) - finite(right.elapsedMs))
    : [];
  const elapsedMs = finite(report.elapsedMs);
  const configuredDurationMs = finite(report.options?.durationMs);
  const sampleMs = Math.max(1, finite(report.options?.sampleMs, 60_000));
  const warmupBoundaryMs = Math.min(thresholds.warmupMs, Math.max(0, elapsedMs * 0.1));
  const steadySamples = samples.filter((sample) => finite(sample.elapsedMs) >= warmupBoundaryMs);
  const steadyWindow = steadySamples.length >= 2 ? steadySamples : samples.slice(Math.max(0, Math.floor(samples.length / 2)));
  const lastSample = samples.at(-1) || {};
  const cpuMicros = finite(lastSample.cpuUserMicros) + finite(lastSample.cpuSystemMicros);
  const expectedSamples = Math.max(1, Math.floor(elapsedMs / sampleMs) + 1);
  const sampleCoverage = samples.length / expectedSamples;
  const healthySteadySamples = steadyWindow.filter((sample) => finite(sample.hub?.healthySubscriptions) >= 1).length;
  const healthySampleRatio = steadyWindow.length ? healthySteadySamples / steadyWindow.length : 0;
  const peakSubscriptions = samples.reduce((maximum, sample) => Math.max(maximum, finite(sample.hub?.subscriptions)), 0);
  const received = finite(report.hub?.received);
  const emitted = finite(report.hub?.emitted);
  const late = finite(report.hub?.late);
  const heapValues = samples.map((sample) => finite(sample.heapUsed));
  const rssValues = samples.map((sample) => finite(sample.rss));
  const metrics = Object.freeze({
    elapsedHours: rounded(elapsedMs / HOUR),
    configuredHours: rounded(configuredDurationMs / HOUR),
    sampleCount: samples.length,
    expectedSamples,
    sampleCoverage: rounded(sampleCoverage),
    warmupMinutes: rounded(warmupBoundaryMs / 60_000, 2),
    steadySampleCount: steadyWindow.length,
    healthySampleRatio: rounded(healthySampleRatio),
    peakSubscriptions,
    received,
    emitted,
    late,
    lateEventRatio: rounded(received ? late / received : 1),
    duplicateEvents: finite(report.hub?.duplicates),
    gaps: finite(report.hub?.gaps),
    evidence: finite(report.evidence),
    duplicateEvidence: finite(report.duplicateEvidence),
    notifications: finite(report.notifications),
    monitoringGaps: finite(report.monitoringGaps),
    cpuPercentOfOneCore: rounded(elapsedMs ? cpuMicros / (elapsedMs * 1_000) * 100 : 0),
    heapMaxMiB: rounded(heapValues.length ? Math.max(...heapValues) / MIB : 0, 2),
    rssMaxMiB: rounded(rssValues.length ? Math.max(...rssValues) / MIB : 0, 2),
    steadyHeapSlopeMiBPerHour: regressionSlopeMiBPerHour(steadyWindow, "heapUsed"),
    steadyRssSlopeMiBPerHour: regressionSlopeMiBPerHour(steadyWindow, "rss"),
  });
  const checks = Object.freeze([
    check("status", "运行状态完成", report.status === "passed", report.status, "passed"),
    check("error", "无运行错误", report.error === null || report.error === undefined || report.error === "", report.error ?? null, null),
    check("wall-clock", "真实墙钟不少于 24 小时且达到配置时长", elapsedMs >= thresholds.minimumWallClockMs && elapsedMs >= configuredDurationMs, metrics.elapsedHours, `>= ${Math.max(thresholds.minimumWallClockMs, configuredDurationMs) / HOUR}h`),
    check("sample-coverage", "逐分钟采样覆盖率", sampleCoverage >= thresholds.minimumSampleCoverage, metrics.sampleCoverage, `>= ${thresholds.minimumSampleCoverage}`),
    check("subscription-sharing", "100 张卡片只共享一个物理订阅", finite(report.options?.alerts) === 100 && peakSubscriptions === 1, { alerts: finite(report.options?.alerts), peakSubscriptions }, { alerts: 100, peakSubscriptions: 1 }),
    check("subscription-health", "稳态订阅健康率", healthySampleRatio >= thresholds.minimumHealthySampleRatio, metrics.healthySampleRatio, `>= ${thresholds.minimumHealthySampleRatio}`),
    check("market-flow", "真实行情持续流入且无静默丢弃", received > 0 && emitted === received, { received, emitted }, "received > 0 and emitted = received"),
    check("market-duplicates", "无重复行情", metrics.duplicateEvents === 0, metrics.duplicateEvents, 0),
    check("market-gaps", "无未闭合行情缺口", metrics.gaps === 0, metrics.gaps, 0),
    check("late-ratio", "迟到事件比例在容许范围内", metrics.lateEventRatio <= thresholds.maximumLateEventRatio, metrics.lateEventRatio, `<= ${thresholds.maximumLateEventRatio}`),
    check("evidence-idempotency", "无重复 Evidence", metrics.duplicateEvidence === 0, metrics.duplicateEvidence, 0),
    check("never-trigger-rule", "长稳专用永不触发规则未误报", metrics.evidence === 0 && metrics.notifications === 0, { evidence: metrics.evidence, notifications: metrics.notifications }, { evidence: 0, notifications: 0 }),
    check("monitoring-gap", "运行期无监控空档", metrics.monitoringGaps === 0, metrics.monitoringGaps, 0),
    check("cpu", "平均 CPU 不超过单核预算", metrics.cpuPercentOfOneCore <= thresholds.maximumCpuPercentOfOneCore, metrics.cpuPercentOfOneCore, `<= ${thresholds.maximumCpuPercentOfOneCore}%`),
    check("heap-cap", "Heap 峰值不超过资源上限", metrics.heapMaxMiB <= thresholds.maximumHeapMiB, metrics.heapMaxMiB, `<= ${thresholds.maximumHeapMiB} MiB`),
    check("rss-cap", "RSS 峰值不超过资源上限", metrics.rssMaxMiB <= thresholds.maximumRssMiB, metrics.rssMaxMiB, `<= ${thresholds.maximumRssMiB} MiB`),
    check("heap-slope", "预热后 Heap 无持续增长", metrics.steadyHeapSlopeMiBPerHour !== null && metrics.steadyHeapSlopeMiBPerHour <= thresholds.maximumSteadyHeapSlopeMiBPerHour, metrics.steadyHeapSlopeMiBPerHour, `<= ${thresholds.maximumSteadyHeapSlopeMiBPerHour} MiB/h`),
    check("rss-slope", "预热后 RSS 无持续增长", metrics.steadyRssSlopeMiBPerHour !== null && metrics.steadyRssSlopeMiBPerHour <= thresholds.maximumSteadyRssSlopeMiBPerHour, metrics.steadyRssSlopeMiBPerHour, `<= ${thresholds.maximumSteadyRssSlopeMiBPerHour} MiB/h`),
  ]);
  return Object.freeze({
    schemaVersion: 1,
    runId: String(report.runId || "unknown"),
    assessedAt: new Date().toISOString(),
    passed: checks.every((entry) => entry.passed),
    thresholds,
    metrics,
    checks,
    failedCheckIds: checks.filter((entry) => !entry.passed).map((entry) => entry.id),
  });
}

export function renderSoakAssessmentMarkdown(assessment) {
  const rows = assessment.checks.map((entry) => `| ${entry.passed ? "通过" : "失败"} | ${entry.label} | \`${JSON.stringify(entry.actual)}\` | \`${JSON.stringify(entry.expected)}\` |`).join("\n");
  return `# Trading Alert 24 小时长稳验收\n\n- Run ID：${assessment.runId}\n- 验收时间：${assessment.assessedAt}\n- 结论：${assessment.passed ? "通过" : "未通过"}\n- 失败检查：${assessment.failedCheckIds.length ? assessment.failedCheckIds.join(", ") : "无"}\n\n| 状态 | 检查 | 实际 | 目标 |\n|---|---|---|---|\n${rows}\n`;
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const reportPath = path.resolve(argv[0] || path.join(root, ".tmp", "trading-alert-soak-24h", "current.json"));
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const assessment = assessSoakReport(report);
  const base = report.status === "running" ? "assessment-current" : `${report.runId}.assessment`;
  const jsonPath = path.join(path.dirname(reportPath), `${base}.json`);
  const markdownPath = path.join(path.dirname(reportPath), `${base}.md`);
  await atomicWrite(jsonPath, `${JSON.stringify(assessment, null, 2)}\n`);
  await atomicWrite(markdownPath, renderSoakAssessmentMarkdown(assessment));
  process.stdout.write(`${JSON.stringify({ passed: assessment.passed, failedCheckIds: assessment.failedCheckIds, jsonPath, markdownPath }, null, 2)}\n`);
  process.exitCode = assessment.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
