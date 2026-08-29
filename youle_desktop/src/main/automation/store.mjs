import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { computeNextRunAtUtc, validateSchedule } from "./scheduler.mjs";
import { enforceAutomationPolicy, validateAutomationPromptForDesktop } from "./policy.mjs";

const STORE_FILE = "automation-store.json";

export class AutomationStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, STORE_FILE);
    this.lockPath = `${this.filePath}.lock`;
    this.loaded = false;
    this.data = emptyData();
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await this.reload();
  }

  async reload() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      this.data = { ...emptyData(), ...JSON.parse(await readFile(this.filePath, "utf8")) };
    } catch {
      this.data = emptyData();
    }
    this.data.jobs = this.data.jobs.map(normalizePersistedJob);
    this.loaded = true;
  }

  async createJob(input) {
    return await this.writeLocked(() => {
      const now = new Date().toISOString();
      const trustedAutoTaskUi = input.trustedAutoTaskUi === true;
      const schedule = normalizeSchedule(input.schedule || input);
      const validation = validateSchedule(schedule);
      if (!validation.ok) throw new Error(validation.error);
      if (!String(input.name || "").trim()) throw new Error("Job name is required.");
      if (!String(input.workspacePath || "").trim()) throw new Error("Workspace path is required.");
      if (!String(input.prompt || input.promptTemplate || "").trim()) throw new Error("Prompt is required.");
      const promptValidation = validateAutomationPromptForDesktop(input.prompt || input.promptTemplate, { workspacePath: input.workspacePath });
      if (!promptValidation.ok) throw new Error(promptValidation.error);
      const execution = input.execution || {};
      const scheduleType = normalizeIdleScheduleType(schedule.type, input);
      const job = {
        id: input.id || randomUUID(),
        projectId: input.projectId || null,
        name: String(input.name).trim(),
        description: input.description || "",
        enabled: input.enabled !== false,
        workspacePath: String(input.workspacePath),
        projectName: input.projectName || path.basename(String(input.workspacePath)) || "Project",
        groupId: stringOrNull(input.groupId || input.group_id),
        groupName: stringOrNull(input.groupName || input.group_name),
        workspaceSlug: stringOrNull(input.workspaceSlug || input.workspace_slug),
        scheduleType,
        scheduleExpr: schedule.expr || null,
        timezone: schedule.timezone || "UTC",
        nextRunAtUtc:
          input.nextRunAtUtc !== undefined
            ? input.nextRunAtUtc
            : computeNextRunAtUtc({ type: scheduleType, expr: schedule.expr, timezone: schedule.timezone }),
        lastRunAtUtc: input.lastRunAtUtc || null,
        lastIdleCheckAtUtc: input.lastIdleCheckAtUtc || null,
        lastIdleStatus: input.lastIdleStatus || null,
        lastIdleReason: input.lastIdleReason || null,
        idleCooldownUntilUtc: input.idleCooldownUntilUtc || null,
        idlePolicy: normalizeIdlePolicy(input.idlePolicy || execution.idlePolicy || input.idle || {}),
        agentThreadId: normalizeAgentThreadId(input.agentThreadId || input.youleAiThreadId),
        misfirePolicy: schedule.misfirePolicy || "run_once",
        promptTemplate: String(input.prompt || input.promptTemplate),
        promptVarsJson: input.promptVarsJson || null,
        workspaceMode: execution.workspaceMode || input.workspaceMode || "local",
        allowLocalWrite: Boolean(execution.allowLocalWrite ?? input.allowLocalWrite),
        baseRef: execution.baseRef || input.baseRef || null,
        includeDirtyState: Boolean(execution.includeDirtyState ?? input.includeDirtyState),
        youleAiProfile: execution.youleAiProfile || input.youleAiProfile || null,
        model: execution.model || input.model || null,
        reasoningEffort: execution.reasoningEffort || input.reasoningEffort || null,
        sandboxMode: execution.sandboxMode || input.sandboxMode || "read-only",
        approvalPolicy: execution.approvalPolicy || input.approvalPolicy || "never",
        networkPolicy: execution.networkPolicy || input.networkPolicy || "disabled",
        concurrencyPolicy: execution.concurrencyPolicy || input.concurrencyPolicy || "skip",
        maxDurationSeconds: Number(execution.maxDurationSeconds ?? input.maxDurationSeconds ?? 1800),
        startupTimeoutSeconds: Number(execution.startupTimeoutSeconds ?? input.startupTimeoutSeconds ?? 120),
        noOutputTimeoutSeconds: Number(execution.noOutputTimeoutSeconds ?? input.noOutputTimeoutSeconds ?? 600),
        cleanupGraceSeconds: Number(execution.cleanupGraceSeconds ?? input.cleanupGraceSeconds ?? 30),
        maxRetries: Number(execution.maxRetries ?? input.maxRetries ?? 0),
        retryBackoffSeconds: Number(execution.retryBackoffSeconds ?? input.retryBackoffSeconds ?? 300),
        deliveryMode: input.delivery?.mode || input.deliveryMode || "inbox",
        deliveryProvider: input.delivery?.provider || input.deliveryProvider || null,
        deliveryUrl: input.delivery?.url || input.deliveryUrl || null,
        autoArchiveNoFindings: input.delivery?.autoArchiveNoFindings ?? input.autoArchiveNoFindings ?? true,
        createdBy: input.createdBy || "user",
        createdAt: input.createdAt || now,
        updatedAt: now,
      };
      enforceSafety(job, { trustedAutoTaskUi });
      enforceAutomationPolicy(job, { trustedAutoTaskUi });
      this.data.jobs.push(job);
      return job;
    });
  }

  async updateJob(id, patch) {
    return await this.writeLocked(() => {
      const job = this.data.jobs.find((entry) => entry.id === id);
      if (!job) throw new Error(`Job not found: ${id}`);
      const trustedAutoTaskUi = patch.trustedAutoTaskUi === true || !patchRequestsFullAccess(patch);
      const candidate = { ...job, ...flattenJobPatch(patch), updatedAt: new Date().toISOString() };
      if (patch.prompt !== undefined) {
        candidate.promptTemplate = String(patch.prompt);
      }
      if (patch.schedule || patch.scheduleType || patch.scheduleExpr) {
        const previousSchedule = normalizeSchedule(job);
        const schedule = normalizeSchedule({ ...previousSchedule, ...schedulePatchFields(patch, candidate), ...(patch.schedule || {}) });
        schedule.type = normalizeIdleScheduleType(schedule.type, candidate);
        const validation = validateSchedule(schedule);
        if (!validation.ok) throw new Error(validation.error);
        candidate.scheduleType = schedule.type;
        candidate.scheduleExpr = schedule.expr || null;
        candidate.timezone = schedule.timezone || candidate.timezone || "UTC";
        candidate.misfirePolicy = schedule.misfirePolicy || candidate.misfirePolicy || "run_once";
        if (scheduleTimingChanged(previousSchedule, schedule)) {
          candidate.nextRunAtUtc = computeNextRunAtUtc({ type: candidate.scheduleType, expr: candidate.scheduleExpr, timezone: candidate.timezone });
        }
      }
      if (patch.idlePolicy || patch.execution?.idlePolicy || patch.idle) {
        candidate.idlePolicy = normalizeIdlePolicy(patch.idlePolicy || patch.execution?.idlePolicy || patch.idle || candidate.idlePolicy || {});
      }
      delete candidate.schedule;
      delete candidate.execution;
      delete candidate.delivery;
      delete candidate.trustedAutoTaskUi;
      enforceSafety(candidate, { trustedAutoTaskUi });
      enforceAutomationPolicy(candidate, { trustedAutoTaskUi });
      const promptValidation = validateAutomationPromptForDesktop(candidate.promptTemplate, { workspacePath: candidate.workspacePath });
      if (!promptValidation.ok) throw new Error(promptValidation.error);
      Object.assign(job, candidate);
      return job;
    });
  }

  async deleteJob(id) {
    return await this.writeLocked(async () => {
      const { deletedRuns, runDirs } = removeRunsForJobIds(this.data, new Set([id]));
      this.data.jobs = this.data.jobs.filter((job) => job.id !== id);
      await removeRunDirs(runDirs);
      return { ok: true, deletedRuns };
    });
  }

  async deleteRunsForJobsNotIn(keepJobIds = [], { jobIdPrefix = "" } = {}) {
    return await this.writeLocked(async () => {
      const keep = new Set(keepJobIds.map((id) => String(id)));
      const staleJobIds = new Set(
        this.data.runs
          .map((run) => String(run.jobId || ""))
          .filter((jobId) => jobId && (!jobIdPrefix || jobId.startsWith(jobIdPrefix)) && !keep.has(jobId)),
      );
      const { deletedRuns, runDirs } = removeRunsForJobIds(this.data, staleJobIds);
      await removeRunDirs(runDirs);
      return { ok: true, deletedRuns };
    });
  }

  async listJobs() {
    await this.reload();
    return [...this.data.jobs].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async getJob(id) {
    await this.reload();
    return this.data.jobs.find((job) => job.id === id) || null;
  }

  async dueJobs(nowUtc) {
    await this.reload();
    const now = new Date(nowUtc || Date.now()).toISOString();
    return this.data.jobs.filter((job) => job.enabled && job.nextRunAtUtc && job.nextRunAtUtc <= now);
  }

  async createRun({ jobId, triggerType, scheduledForUtc, status = "queued" }) {
    return await this.writeLocked(() => {
      const job = this.data.jobs.find((entry) => entry.id === jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      const now = new Date().toISOString();
      const runDir = path.join(this.dataDir, "runs", `${now.slice(0, 10)}-${randomUUID()}`);
      const run = {
        id: randomUUID(),
        jobId,
        projectId: job.projectId,
        status,
        attempt: 1,
        triggerType,
        scheduledForUtc,
        pid: null,
        youleAiThreadId: null,
        agentThreadId: normalizeAgentThreadId(job.agentThreadId),
        youleAiSessionId: null,
        workspacePath: job.workspacePath,
        groupId: job.groupId || null,
        groupName: job.groupName || null,
        workspaceSlug: job.workspaceSlug || null,
        worktreePath: null,
        runDir,
        startedAt: status === "running" ? now : null,
        completedAt: null,
        durationMs: null,
        exitCode: null,
        finalMessagePath: null,
        summary: "",
        hasFindings: false,
        hasPatch: false,
        patchPath: null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
        errorClass: null,
        errorMessage: null,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      this.data.runs.push(run);
      return run;
    });
  }

  async markRunRunning(runId, patch = {}) {
    return await this.writeLocked(() => {
      const run = this.requireRun(runId);
      Object.assign(run, patch, { status: "running", startedAt: patch.startedAt || run.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
      return run;
    });
  }

  async updateRun(runId, patch = {}) {
    return await this.writeLocked(() => {
      const run = this.requireRun(runId);
      Object.assign(run, patch, { updatedAt: new Date().toISOString() });
      return run;
    });
  }

  async completeRun(runId, result) {
    return await this.writeLocked(() => {
      const run = this.requireRun(runId);
      const now = new Date().toISOString();
      Object.assign(run, {
        status: result.status,
        completedAt: now,
        durationMs: run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : null,
        exitCode: result.exitCode ?? null,
        finalMessagePath: result.finalMessagePath || run.finalMessagePath,
        summary: result.summary || "",
        hasFindings: Boolean(result.hasFindings ?? (result.status !== "no_findings" && result.summary)),
        hasPatch: Boolean(result.hasPatch),
        patchPath: result.patchPath || null,
        inputTokens: result.inputTokens ?? run.inputTokens,
        cachedInputTokens: result.cachedInputTokens ?? run.cachedInputTokens,
        outputTokens: result.outputTokens ?? run.outputTokens,
        reasoningOutputTokens: result.reasoningOutputTokens ?? run.reasoningOutputTokens,
        agentThreadId: normalizeAgentThreadId(result.agentThreadId || result.youleAiThreadId || run.agentThreadId),
        youleAiThreadId: normalizeAgentThreadId(result.youleAiThreadId || result.agentThreadId || run.youleAiThreadId),
        errorClass: result.errorClass || null,
        errorMessage: result.errorMessage || null,
        archived: result.status === "no_findings",
        updatedAt: now,
      });
      return run;
    });
  }

  async appendRunEvent(runId, { source, eventType, payload }) {
    return await this.writeLocked(() => {
      const event = {
        id: this.data.events.length + 1,
        runId,
        ts: new Date().toISOString(),
        seq: this.data.events.filter((entry) => entry.runId === runId).length + 1,
        source,
        eventType: eventType || payload?.type || null,
        payload,
      };
      this.data.events.push(event);
      return event;
    });
  }

  async addArtifact(runId, artifact) {
    return await this.writeLocked(() => {
      const entry = {
        id: randomUUID(),
        runId,
        type: artifact.type,
        path: artifact.path,
        sizeBytes: artifact.sizeBytes ?? null,
        sha256: artifact.sha256 || null,
        createdAt: new Date().toISOString(),
      };
      this.data.artifacts.push(entry);
      return entry;
    });
  }

  async listRuns(filter = {}) {
    await this.reload();
    let runs = this.data.runs;
    if (filter.jobId) runs = runs.filter((run) => run.jobId === filter.jobId);
    if (filter.triage) {
      runs = runs.filter((run) => ["failed", "timed_out", "needs_attention"].includes(run.status) || (run.status === "success" && (run.hasFindings || run.hasPatch)));
    }
    return [...runs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getRun(runId) {
    await this.reload();
    const run = this.data.runs.find((entry) => entry.id === runId);
    if (!run) return null;
    const artifacts = await Promise.all(
      this.data.artifacts.filter((artifact) => artifact.runId === runId).map(async (artifact) => ({
        ...artifact,
        preview: await readArtifactPreview(artifact.path),
      })),
    );
    return {
      ...run,
      job: this.data.jobs.find((job) => job.id === run.jobId) || null,
      events: this.data.events.filter((event) => event.runId === runId),
      artifacts,
    };
  }

  async runningRunsForJob(jobId) {
    await this.reload();
    return this.data.runs.filter((run) => run.jobId === jobId && ["queued", "running"].includes(run.status));
  }

  async listActiveRuns() {
    await this.reload();
    return this.data.runs.filter((run) => ["queued", "running"].includes(run.status));
  }

  async writeHeartbeat({ workerId, pid, appVersion = "dev" }) {
    await this.writeLocked(() => {
      const now = new Date().toISOString();
      this.data.heartbeats = this.data.heartbeats.filter((heartbeat) => heartbeat.workerId === workerId || isProcessAlive(heartbeat.pid));
      const existing = this.data.heartbeats.find((heartbeat) => heartbeat.workerId === workerId);
      if (existing) {
        Object.assign(existing, { pid, lastSeenAt: now, appVersion });
      } else {
        this.data.heartbeats.push({ workerId, pid, startedAt: now, lastSeenAt: now, appVersion });
      }
    });
  }

  async getHeartbeat(workerId) {
    await this.reload();
    return this.data.heartbeats.find((heartbeat) => heartbeat.workerId === workerId) || null;
  }

  async cleanupWorktrees({ nowUtc = new Date().toISOString(), retainDays = 14 } = {}) {
    return await this.writeLocked(async () => {
      const cutoff = new Date(nowUtc).getTime() - retainDays * 24 * 60 * 60 * 1000;
      const removed = [];
      for (const run of this.data.runs) {
        if (!run.worktreePath) continue;
        if (["queued", "running"].includes(run.status)) continue;
        if (run.hasPatch || !run.archived) continue;
        const completed = run.completedAt ? new Date(run.completedAt).getTime() : new Date(run.updatedAt || run.createdAt).getTime();
        if (!Number.isFinite(completed) || completed > cutoff) continue;
        await rm(run.worktreePath, { recursive: true, force: true });
        removed.push(run.worktreePath);
        run.worktreePath = null;
        run.updatedAt = new Date().toISOString();
      }
      return removed;
    });
  }

  async writeLocked(mutator) {
    return await this.enqueue(async () => {
      await this.acquireStoreLock();
      try {
        await this.reload();
        const result = await mutator();
        await this.writeSnapshot();
        return result;
      } finally {
        await this.releaseStoreLock();
      }
    });
  }

  async writeSnapshot() {
    await mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(this.data, null, 2));
      await retryFileOperation(() => rename(tempPath, this.filePath));
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async enqueue(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return await run;
  }

  async acquireStoreLock({ timeoutMs = 10_000 } = {}) {
    await mkdir(this.dataDir, { recursive: true });
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        await mkdir(this.lockPath, { recursive: false });
        await writeFile(path.join(this.lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (await this.removeStaleStoreLock()) continue;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for automation store lock.");
        await delay(25);
      }
    }
  }

  async releaseStoreLock() {
    await rm(this.lockPath, { recursive: true, force: true });
  }

  async removeStaleStoreLock() {
    try {
      const owner = JSON.parse(await readFile(path.join(this.lockPath, "owner.json"), "utf8"));
      if (owner?.pid && isProcessAlive(owner.pid)) return false;
    } catch {}
    await rm(this.lockPath, { recursive: true, force: true });
    return true;
  }

  requireRun(runId) {
    const run = this.data.runs.find((entry) => entry.id === runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function emptyData() {
  return { version: 1, jobs: [], runs: [], events: [], artifacts: [], heartbeats: [] };
}

function removeRunsForJobIds(data, jobIds) {
  if (!jobIds?.size) return { deletedRuns: 0, runDirs: [] };
  const removedRunIds = new Set();
  const runDirs = [];
  for (const run of data.runs) {
    if (!jobIds.has(String(run.jobId || ""))) continue;
    removedRunIds.add(run.id);
    if (run.runDir) runDirs.push(run.runDir);
  }
  if (!removedRunIds.size) return { deletedRuns: 0, runDirs: [] };
  data.runs = data.runs.filter((run) => !removedRunIds.has(run.id));
  data.events = data.events.filter((event) => !removedRunIds.has(event.runId));
  data.artifacts = data.artifacts.filter((artifact) => !removedRunIds.has(artifact.runId));
  return { deletedRuns: removedRunIds.size, runDirs };
}

async function removeRunDirs(runDirs) {
  await Promise.allSettled([...new Set(runDirs)].filter(Boolean).map((runDir) => rm(runDir, { recursive: true, force: true })));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryFileOperation(operation, { attempts = 8, initialDelayMs = 25 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error) || attempt === attempts - 1) break;
      await delay(initialDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

function isTransientFileError(error) {
  return error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES";
}

function normalizePersistedJob(job) {
  const scheduleType = normalizeIdleScheduleType(job.scheduleType, job);
  const agentThreadId = normalizeAgentThreadId(job.agentThreadId);
  const youleAiThreadId = normalizeAgentThreadId(job.youleAiThreadId);
  const threadId = agentThreadId || youleAiThreadId;
  return {
    ...job,
    scheduleType,
    scheduleExpr: scheduleType === "idle" ? null : job.scheduleExpr ?? null,
    nextRunAtUtc: scheduleType === "idle" ? null : job.nextRunAtUtc ?? null,
    idlePolicy: normalizeIdlePolicy(job.idlePolicy || {}),
    lastIdleCheckAtUtc: job.lastIdleCheckAtUtc || null,
    lastIdleStatus: job.lastIdleStatus || null,
    lastIdleReason: job.lastIdleReason || null,
    idleCooldownUntilUtc: job.idleCooldownUntilUtc || null,
    groupId: stringOrNull(job.groupId || job.group_id),
    groupName: stringOrNull(job.groupName || job.group_name),
    workspaceSlug: stringOrNull(job.workspaceSlug || job.workspace_slug),
    agentThreadId: threadId,
    youleAiThreadId: threadId,
  };
}

function stringOrNull(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeSchedule(schedule) {
  return {
    type: schedule.type || schedule.scheduleType || "manual",
    expr: schedule.expr ?? schedule.scheduleExpr ?? null,
    timezone: schedule.timezone || "UTC",
    misfirePolicy: schedule.misfirePolicy || "run_once",
  };
}

function normalizeIdleScheduleType(type, input = {}) {
  if (type === "idle") return "idle";
  const text = `${input.name || ""}\n${input.description || ""}\n${input.prompt || input.promptTemplate || ""}`;
  return type === "manual" && /不定时/.test(text) ? "idle" : type;
}

function normalizeIdlePolicy(value = {}) {
  return {
    minIntervalMinutes: clampNumber(value.minIntervalMinutes, 1, 24 * 60, 60),
    idleSeconds: clampNumber(value.idleSeconds, 0, 24 * 60 * 60, 300),
    cpuThresholdPercent: clampNumber(value.cpuThresholdPercent, 1, 100, 25),
    memoryAvailableMb: clampNumber(value.memoryAvailableMb, 0, 1024 * 1024, 1024),
    failedRetryMinutes: clampNumber(value.failedRetryMinutes, 1, 24 * 60, 15),
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function schedulePatchFields(patch, candidate) {
  return {
    type: patch.scheduleType ?? candidate.scheduleType,
    expr: patch.scheduleExpr ?? candidate.scheduleExpr,
    timezone: patch.timezone ?? candidate.timezone,
    misfirePolicy: patch.misfirePolicy ?? candidate.misfirePolicy,
  };
}

function scheduleTimingChanged(previous, next) {
  return previous.type !== next.type || (previous.expr || null) !== (next.expr || null) || previous.timezone !== next.timezone;
}

function flattenJobPatch(patch = {}) {
  const output = { ...patch };
  delete output.schedule;
  delete output.execution;
  delete output.delivery;
  if (patch.execution) {
    Object.assign(output, {
      workspaceMode: patch.execution.workspaceMode,
      allowLocalWrite: patch.execution.allowLocalWrite,
      sandboxMode: patch.execution.sandboxMode,
      approvalPolicy: patch.execution.approvalPolicy,
      model: patch.execution.model,
      youleAiProfile: patch.execution.youleAiProfile,
      maxDurationSeconds: patch.execution.maxDurationSeconds,
      startupTimeoutSeconds: patch.execution.startupTimeoutSeconds,
      noOutputTimeoutSeconds: patch.execution.noOutputTimeoutSeconds,
      cleanupGraceSeconds: patch.execution.cleanupGraceSeconds,
      maxRetries: patch.execution.maxRetries,
      retryBackoffSeconds: patch.execution.retryBackoffSeconds,
      includeDirtyState: patch.execution.includeDirtyState,
      concurrencyPolicy: patch.execution.concurrencyPolicy,
      idlePolicy: patch.execution.idlePolicy,
    });
  }
  if (patch.delivery) {
    output.deliveryMode = patch.delivery.mode;
    output.deliveryProvider = patch.delivery.provider;
    output.deliveryUrl = patch.delivery.url;
    output.autoArchiveNoFindings = patch.delivery.autoArchiveNoFindings;
  }
  if ("agentThreadId" in output) output.agentThreadId = normalizeAgentThreadId(output.agentThreadId);
  if ("youleAiThreadId" in output) output.youleAiThreadId = normalizeAgentThreadId(output.youleAiThreadId);
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined));
}

function patchRequestsFullAccess(patch = {}) {
  return (patch.execution && patch.execution.sandboxMode === "danger-full-access") || patch.sandboxMode === "danger-full-access";
}

function normalizeAgentThreadId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return /^(?:urn:uuid:)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text)
    ? text
    : null;
}

function enforceSafety(job, { trustedAutoTaskUi = false } = {}) {
  if (job.approvalPolicy !== "never" && job.scheduleType !== "manual" && job.scheduleType !== "idle") {
    throw new Error("Scheduled unattended jobs must use approval policy never.");
  }
  if (job.sandboxMode === "danger-full-access" && !trustedAutoTaskUi) {
    throw new Error("Automation jobs cannot default to danger-full-access.");
  }
  if (job.sandboxMode === "workspace-write" && job.workspaceMode !== "worktree" && !job.allowLocalWrite) {
    job.workspaceMode = "worktree";
  }
}

async function readArtifactPreview(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.length > 120_000 ? `${content.slice(0, 120_000)}\n[truncated]` : content;
  } catch {
    return null;
  }
}
