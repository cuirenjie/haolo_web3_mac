const MINIMUM_INTERVAL_SECONDS = 300;

export function createDraftAutomationManifest(text, { workspacePath, timezone = "UTC" } = {}) {
  const normalized = String(text || "").trim();
  const wantsEdit = /修复|修改|生成|更新|fix|change|edit|write/i.test(normalized);
  const hour = extractHour(normalized) ?? 9;
  return {
    name: draftName(normalized),
    schedule: {
      type: "cron",
      expr: `0 ${hour} * * *`,
      timezone,
      misfirePolicy: "run_once",
    },
    workspacePath,
    workspaceMode: wantsEdit ? "worktree" : "local",
    sandboxMode: wantsEdit ? "workspace-write" : "read-only",
    approvalPolicy: "never",
    prompt: normalized,
    riskLevel: wantsEdit ? "medium" : "low",
    requiresConfirmation: true,
    createdBy: "agent_draft",
  };
}

export function createFanoutAutomationDrafts({ text, workspacePaths = [], timezone = "UTC" } = {}) {
  return workspacePaths
    .map((workspacePath) => String(workspacePath || "").trim())
    .filter(Boolean)
    .map((workspacePath, index) => ({
      ...createDraftAutomationManifest(text, { workspacePath, timezone }),
      name: `${draftName(text)} ${index + 1}`,
      workspacePath,
      enabled: false,
      requiresConfirmation: true,
      createdBy: "agent_draft",
    }));
}

export function enforceAutomationPolicy(jobLike, policy = {}) {
  const minimumIntervalSeconds = policy.minimumIntervalSeconds ?? MINIMUM_INTERVAL_SECONDS;
  const forbidFullAccess = policy.forbidFullAccess ?? !policy.trustedAutoTaskUi;
  if (forbidFullAccess && jobLike.sandboxMode === "danger-full-access") {
    throw new Error("Enterprise policy forbids danger-full-access automation.");
  }
  if (jobLike.scheduleType === "interval") {
    const seconds = parseIsoDurationSeconds(jobLike.scheduleExpr);
    if (seconds < minimumIntervalSeconds) {
      throw new Error(`Enterprise policy minimum interval is ${minimumIntervalSeconds} seconds.`);
    }
  }
  if (jobLike.approvalPolicy !== "never" && jobLike.scheduleType !== "manual" && jobLike.scheduleType !== "idle") {
    throw new Error("Unattended scheduled jobs must use approval policy never.");
  }
  return true;
}

export function validateAutomationPrompt(prompt, { workspacePath } = {}) {
  const text = String(prompt || "").trim();
  if (text.length < 12) {
    return { ok: false, error: "Prompt is too vague for unattended automation." };
  }
  if (!String(workspacePath || "").trim()) {
    return { ok: false, error: "Automation prompt must be tied to a project workspace path." };
  }
  if (/(持续运行|一直运行|不要停止|永不停止|forever|never stop|until complete)/i.test(text)) {
    return { ok: false, error: "Prompt may cause an infinite unattended run; remove 持续运行 / never stop wording." };
  }
  if (/(delete everything|format disk|outside (the )?(project|workspace)|全盘|删除所有|项目外|工作区外)/i.test(text)) {
    return { ok: false, error: "Prompt requests work outside the sandbox 范围." };
  }
  if (/(提醒|通知|告知|消息|当前余额|余额不足|余额正常|notify|notification|message|alert)/i.test(text)) {
    return { ok: true };
  }
  if (!/(每次运行|每次|定时|不定时|查看|生成|写作|创作|输出|总结|检查|返回|daily|weekly|every run|when run|return|review|summari[sz]e|if there are no|NO_FINDINGS)/i.test(text)) {
    return { ok: false, error: "Prompt should include clear per-run output rules." };
  }
  return { ok: true };
}

export function validateAutomationPromptForDesktop(prompt, { workspacePath } = {}) {
  const text = String(prompt || "").trim();
  if (!text) {
    return { ok: false, error: "Prompt is required." };
  }
  if (!String(workspacePath || "").trim()) {
    return { ok: false, error: "Automation prompt must be tied to a project workspace path." };
  }
  if (/(持续运行|一直运行|不要停止|永不停止|forever|never stop|until complete)/i.test(text)) {
    return { ok: false, error: "Prompt may cause an infinite unattended run; remove 持续运行 / never stop wording." };
  }
  if (/(delete everything|format disk|outside (the )?(project|workspace)|全盘|删除所有|项目外|工作区外)/i.test(text)) {
    return { ok: false, error: "Prompt requests work outside the sandbox range." };
  }
  if (/(提醒|通知|告知|消息|当前余额|余额不足|余额正常|打卡|notify|notification|message|alert)/i.test(text)) {
    return { ok: true };
  }
  return { ok: true };
}

function extractHour(text) {
  const match = text.match(/(\d{1,2})\s*[点:]/);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 0 && value <= 23 ? value : null;
}

function draftName(text) {
  const trimmed = text.replace(/\s+/g, " ").slice(0, 32);
  return trimmed || "Draft automation";
}

function parseIsoDurationSeconds(expr) {
  const match = String(expr || "").trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
}
