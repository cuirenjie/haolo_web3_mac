export type SubagentStage = "starting" | "working" | "completed" | "failed" | "interrupted";

export type SubagentStatusEntry = {
  threadId: string;
  task: string;
  stage: SubagentStage;
  statusLabel: string;
  progressSegments: number;
  output: string | null;
};

type ThreadProcessItem = Record<string, unknown> & {
  type?: string;
};

export type SubagentProcessPresentation = {
  kind: "reasoning" | "activity";
  label: string;
  text: string;
  phase: "running" | "completed" | "failed";
};

export function subagentOutputFingerprint(value: unknown) {
  let text = String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
  if (/^Message Type:\s*FINAL_ANSWER\b/i.test(text)) {
    const payloadMatch = text.match(/(?:^|\n)Payload:\s*\n/i);
    if (payloadMatch?.index != null) text = text.slice(payloadMatch.index + payloadMatch[0].length);
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectSubagentOwnedSnapshotTurns(
  turns: unknown,
  context: { parentTurnId?: string | null; startedAtMs?: number | null } = {},
) {
  const records = Array.isArray(turns)
    ? turns.filter((turn): turn is Record<string, unknown> => Boolean(turn && typeof turn === "object"))
    : [];
  if (!records.length) return [];
  const parentTurnId = String(context.parentTurnId || "").trim();
  const candidates = records.filter((turn) => !parentTurnId || snapshotTurnId(turn) !== parentTurnId);
  if (!candidates.length) return [];

  const startedAtMs = Number(context.startedAtMs);
  if (Number.isFinite(startedAtMs) && startedAtMs > 0) {
    const owned = candidates.filter((turn) => {
      const turnStartedAtMs = snapshotTurnStartedAtMs(turn);
      return turnStartedAtMs != null && turnStartedAtMs >= startedAtMs - 2_000;
    });
    if (owned.length) return owned;
  }

  // Before the child turn starts, a forked snapshot can contain only the
  // parent's inherited history. A known parent turn is therefore not enough
  // evidence to attribute the latest inherited message to the child.
  if (parentTurnId && !(Number.isFinite(startedAtMs) && startedAtMs > 0)) {
    const latest = records.at(-1)!;
    return snapshotTurnId(latest) === parentTurnId ? [] : [latest];
  }
  return [candidates.at(-1)!];
}

function snapshotTurnId(turn: Record<string, unknown>) {
  return firstText(turn.id, turn.turnId, turn.turn_id) || "";
}

function snapshotTurnStartedAtMs(turn: Record<string, unknown>) {
  for (const value of [turn.startedAt, turn.started_at, turn.createdAt, turn.created_at]) {
    if (value == null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type MutableSubagentEntry = {
  threadId: string;
  task: string;
  stage: SubagentStage;
  output: string | null;
};

const DEFAULT_SUBAGENT_TASK = "协同推进关联任务";
const TOTAL_PROGRESS_SEGMENTS = 12;
const FALLBACK_SUBAGENT_PROFESSIONS = ["项目顾问", "业务分析师", "解决方案顾问", "项目协调员"] as const;
const SUBAGENT_PROFESSION_RULES = [
  { pattern: /(?:frontend|front-end|client|renderer|ui|ux|interface|react|vue|css|html|前端|客户端|界面|交互|样式)/i, profession: "前端工程师" },
  { pattern: /(?:test|testing|tests|qa|quality|coverage|spec|risk|测试|质检|质量|覆盖|验证|风险)/i, profession: "测试工程师" },
  { pattern: /(?:ipc|main process|preload|bridge|protocol|architecture|architect|主进程|通信|协议|架构)/i, profession: "系统架构师" },
  { pattern: /(?:security|secure|vulnerab|threat|permission|auth|安全|漏洞|威胁|权限|认证)/i, profession: "安全工程师" },
  { pattern: /(?:data|analytics|analysis|metric|statistics|sql|database|数据|分析|指标|统计|数据库)/i, profession: "数据分析师" },
  { pattern: /(?:backend|back-end|server|api|service|后端|服务端|接口)/i, profession: "后端工程师" },
  { pattern: /(?:design|visual|prototype|layout|brand|设计|视觉|原型|布局|品牌)/i, profession: "产品设计师" },
  { pattern: /(?:research|search|investigat|benchmark|调研|研究|检索|竞品)/i, profession: "研究分析师" },
  { pattern: /(?:document|docs|copy|content|writing|文档|内容|文案|写作)/i, profession: "内容编辑" },
  { pattern: /(?:product|requirement|planning|roadmap|产品|需求|规划)/i, profession: "产品经理" },
] as const;

export function isSubagentProcessItem(item: unknown) {
  if (!item || typeof item !== "object") return false;
  const type = normalizedToken((item as ThreadProcessItem).type);
  return type === "collabagenttoolcall" || type === "subagentactivity";
}

export function shouldShowSubagentStatusEntry({
  parentThreadId,
  childThreadId,
  confirmedParentThreadId = null,
  isKnownInternal = false,
  isListedTopLevel = false,
}: {
  parentThreadId: string;
  childThreadId: string;
  confirmedParentThreadId?: string | null;
  isKnownInternal?: boolean;
  isListedTopLevel?: boolean;
}) {
  if (!parentThreadId || !childThreadId || parentThreadId === childThreadId) return false;
  if (confirmedParentThreadId) return confirmedParentThreadId === parentThreadId;
  if (isKnownInternal) return true;
  return !isListedTopLevel;
}

export function subagentThreadIdsFromItem(item: unknown) {
  if (!item || typeof item !== "object") return [];
  const record = item as ThreadProcessItem;
  const type = normalizedToken(record.type);
  if (type === "subagentactivity") {
    const threadId = firstText(record.agentThreadId, record.agent_thread_id);
    return threadId ? [threadId] : [];
  }
  if (type !== "collabagenttoolcall") return [];
  const states = recordValue(record.agentsStates) || recordValue(record.agents_states) || {};
  return uniqueTexts([
    ...arrayTexts(record.receiverThreadIds),
    ...arrayTexts(record.receiver_thread_ids),
    ...Object.keys(states),
  ]);
}

export function directSubagentThreadIdsFromItem(item: unknown) {
  if (!item || typeof item !== "object") return [];
  const record = item as ThreadProcessItem;
  const type = normalizedToken(record.type);
  if (type === "subagentactivity") {
    const threadId = firstText(record.agentThreadId, record.agent_thread_id);
    return threadId ? [threadId] : [];
  }
  if (type !== "collabagenttoolcall" || normalizedToken(firstText(record.tool, record.name)) !== "spawnagent") return [];
  return uniqueTexts([
    ...arrayTexts(record.receiverThreadIds),
    ...arrayTexts(record.receiver_thread_ids),
  ]);
}

export function buildSubagentStatusEntries(items: unknown[]): SubagentStatusEntry[] {
  const agents = new Map<string, MutableSubagentEntry>();

  for (const value of items) {
    if (!value || typeof value !== "object") continue;
    const item = value as ThreadProcessItem;
    const type = normalizedToken(item.type);
    if (type === "collabagenttoolcall") {
      applyCollabToolCall(agents, item);
    } else if (type === "subagentactivity") {
      applySubagentActivity(agents, item);
    }
  }

  return [...agents.values()].map((agent) => ({
    ...agent,
    statusLabel: stageLabel(agent.stage),
    progressSegments: stageProgressSegments(agent.stage),
  }));
}

export function applySubagentActivityLifecycle(
  entry: SubagentStatusEntry,
  activity: { busy?: boolean; failed?: boolean; completedAtMs?: number | null } | null | undefined,
) {
  let stage = entry.stage;
  if (activity?.failed) stage = "failed";
  else if (activity?.completedAtMs && activity.busy !== true) stage = "completed";
  else if (activity?.busy) stage = "working";
  if (stage === entry.stage) return entry;
  return {
    ...entry,
    stage,
    statusLabel: stageLabel(stage),
    progressSegments: stageProgressSegments(stage),
  };
}

export function subagentProcessPresentation(item: unknown): SubagentProcessPresentation | null {
  if (!item || typeof item !== "object") return null;
  const record = item as ThreadProcessItem;
  const type = normalizedToken(record.type);
  const phase = subagentProcessPhase(record);

  if (type === "subagentprocessupdate") {
    const text = boundedPublicProcessText(firstText(record.text));
    if (!text) return null;
    const kind = normalizedToken(firstText(record.processKind, record.process_kind)) === "reasoning"
      ? "reasoning"
      : "activity";
    return {
      kind,
      label: firstText(record.processLabel, record.process_label) || (kind === "reasoning" ? "思考摘要" : "执行动态"),
      text,
      phase,
    };
  }

  if (type === "reasoning") {
    const summary = boundedPublicProcessText(
      Array.isArray(record.summary)
        ? record.summary.map((part) => String(part || "")).filter(Boolean).join("\n")
        : "",
      3_000,
    );
    return {
      kind: "reasoning",
      label: summary ? "思考摘要" : "思考中",
      text: summary || (phase === "failed" ? "分析过程遇到问题，正在等待协调处理。" : "正在分析任务并确定下一步。"),
      phase,
    };
  }

  if (type === "plan") {
    return {
      kind: "activity",
      label: "任务规划",
      text: phase === "failed" ? "任务规划未能完成。" : phase === "completed" ? "已整理并确认执行计划。" : "正在规划并推进任务步骤。",
      phase,
    };
  }

  if (type === "commandexecution") {
    return {
      kind: "activity",
      label: "本地执行",
      text: phase === "failed" ? "本地任务步骤执行失败。" : phase === "completed" ? "已完成一个本地任务步骤。" : "正在执行本地任务步骤。",
      phase,
    };
  }

  if (type === "websearch") {
    const action = recordValue(record.action);
    const query = compactPublicProcessDetail(firstText(record.query, action?.query));
    const verb = phase === "failed" ? "联网检索失败" : phase === "completed" ? "已完成联网检索" : "正在联网检索";
    return {
      kind: "activity",
      label: "资料检索",
      text: query ? `${verb}：${query}` : `${verb}任务所需资料。`,
      phase,
    };
  }

  if (type === "filechange") {
    return {
      kind: "activity",
      label: "文件处理",
      text: phase === "failed" ? "任务文件更新失败。" : phase === "completed" ? "已更新任务文件。" : "正在更新任务文件。",
      phase,
    };
  }

  if (type === "imageview") {
    return {
      kind: "activity",
      label: "图片分析",
      text: phase === "failed" ? "图片读取失败。" : phase === "completed" ? "已完成图片分析。" : "正在查看并分析任务图片。",
      phase,
    };
  }

  if (type === "collabagenttoolcall") {
    return {
      kind: "activity",
      label: "协同处理",
      text: phase === "failed" ? "子 Agent 协同步骤未能完成。" : phase === "completed" ? "已完成一次子 Agent 协同。" : "正在协同其他子 Agent 推进任务。",
      phase,
    };
  }

  if (type === "mcptoolcall" || type === "dynamictoolcall" || type === "toolcall") {
    const toolName = compactPublicProcessDetail(firstText(record.tool, record.name, record.server));
    const toolToken = normalizedToken(toolName);
    const isSearch = /search|browse|web|fetch|openurl/.test(toolToken);
    const isRead = /read|open|view|inspect|list|find/.test(toolToken);
    const isVisual = /image|video|slide|presentation|render/.test(toolToken);
    const label = isSearch ? "资料检索" : isRead ? "读取资料" : isVisual ? "视觉处理" : "工具调用";
    const action = isSearch ? "检索任务资料" : isRead ? "读取并整理资料" : isVisual ? "处理视觉素材" : "调用任务工具";
    return {
      kind: "activity",
      label,
      text: phase === "failed" ? `${action}失败。` : phase === "completed" ? `已完成${action}。` : `正在${action}。`,
      phase,
    };
  }

  return null;
}

function subagentProcessPhase(record: ThreadProcessItem): SubagentProcessPresentation["phase"] {
  const status = normalizedToken(firstText(record.status, record.phase));
  if (["failed", "errored", "error", "cancelled", "interrupted"].includes(status) || record.error) return "failed";
  if (["completed", "complete", "succeeded", "success", "done"].includes(status)) return "completed";
  return "running";
}

function compactPublicProcessDetail(value: string | null) {
  return boundedPublicProcessText(value, 180).replace(/\s+/g, " ").trim();
}

function boundedPublicProcessText(value: unknown, limit = 1_200) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function persistedSubagentStatusEntry({
  threadId,
  task,
  output = null,
  busy = false,
  failed = false,
}: {
  threadId: string;
  task?: string | null;
  output?: string | null;
  busy?: boolean;
  failed?: boolean;
}): SubagentStatusEntry {
  const stage: SubagentStage = failed ? "failed" : busy ? "working" : "completed";
  return {
    threadId,
    task: String(task || "").trim() || DEFAULT_SUBAGENT_TASK,
    stage,
    statusLabel: stageLabel(stage),
    progressSegments: stageProgressSegments(stage),
    output,
  };
}

export function selectPersistedSubagentThreadIds(
  activities: ReadonlyArray<{
    threadId: string;
    parentTurnId?: string | null;
    startedAtMs?: number | null;
    completedAtMs?: number | null;
  }>,
  preferredTurnId: string | null | undefined,
  allowLegacyFallback: boolean,
) {
  let selected = preferredTurnId
    ? activities.filter((activity) => activity.parentTurnId === preferredTurnId)
    : [];
  if (selected.length || !allowLegacyFallback || !activities.length) {
    return selected.map((activity) => activity.threadId);
  }

  const timestamp = (activity: (typeof activities)[number]) =>
    activity.startedAtMs ?? activity.completedAtMs ?? 0;
  const latestWithTurn = [...activities]
    .filter((activity) => Boolean(activity.parentTurnId))
    .sort((left, right) => timestamp(right) - timestamp(left))[0];
  if (latestWithTurn?.parentTurnId) {
    selected = activities.filter(
      (activity) => activity.parentTurnId === latestWithTurn.parentTurnId,
    );
  } else {
    const latestTimestamp = Math.max(...activities.map(timestamp));
    selected = activities.filter((activity) => {
      const activityTimestamp = timestamp(activity);
      return !latestTimestamp || !activityTimestamp || latestTimestamp - activityTimestamp <= 5 * 60_000;
    });
  }
  return selected.map((activity) => activity.threadId);
}

export function subagentProfessionForTask(task: string, index = 0) {
  const normalizedTask = String(task || "").trim();
  const matched = SUBAGENT_PROFESSION_RULES.find((rule) => rule.pattern.test(normalizedTask));
  if (matched) return matched.profession;
  return FALLBACK_SUBAGENT_PROFESSIONS[Math.abs(index) % FALLBACK_SUBAGENT_PROFESSIONS.length];
}

export function resolveSubagentPanelThreadId(
  savedThreadId: string | null | undefined,
  currentThreadIds: readonly string[],
) {
  return savedThreadId && currentThreadIds.includes(savedThreadId)
    ? savedThreadId
    : currentThreadIds[0] || null;
}

export function pruneSubagentActivityItems(
  itemOrder: string[],
  items: Record<string, { type?: string }>,
  maxItems: number,
) {
  while (itemOrder.length > maxItems) {
    const removableIndex = itemOrder.findIndex((id) => items[id]?.type !== "agentMessage");
    if (removableIndex < 0) return;
    const [removedId] = itemOrder.splice(removableIndex, 1);
    if (removedId) delete items[removedId];
  }
}

function applyCollabToolCall(agents: Map<string, MutableSubagentEntry>, item: ThreadProcessItem) {
  const tool = normalizedToken(firstText(item.tool, item.name));
  const callStatus = normalizedToken(firstText(item.status));
  const prompt = compactSubagentTask(firstText(item.prompt, item.message, item.task));
  const states = recordValue(item.agentsStates) || recordValue(item.agents_states) || {};
  const receiverIds = subagentThreadIdsFromItem(item);

  for (const threadId of receiverIds) {
    const existing = agents.get(threadId);
    const entry = existing || {
      threadId,
      task: prompt || DEFAULT_SUBAGENT_TASK,
      stage: tool === "spawnagent" && callStatus === "inprogress" ? "starting" : "working",
      output: null,
    };
    const state = recordValue(states[threadId]);
    const nextStage = stageFromAgentState(firstText(state?.status));
    const nextOutput = subagentOutputFromState(state);

    if (prompt && (tool === "spawnagent" || tool === "sendinput" || tool === "resumeagent" || !entry.task)) {
      entry.task = prompt;
    }
    if (nextStage) {
      entry.stage = nextStage;
    } else if (callStatus === "failed") {
      entry.stage = "failed";
    } else if (tool === "closeagent" && callStatus === "completed") {
      entry.stage = "completed";
    } else if (tool === "spawnagent") {
      entry.stage = callStatus === "inprogress" ? "starting" : "working";
    } else if (tool === "sendinput" || tool === "resumeagent") {
      entry.stage = "working";
    }
    if (nextOutput) {
      entry.output = nextOutput;
    } else if (callStatus === "failed" && !entry.output) {
      entry.output = firstText(item.error, item.message);
    }

    agents.set(threadId, entry);
  }
}

function applySubagentActivity(agents: Map<string, MutableSubagentEntry>, item: ThreadProcessItem) {
  const threadId = firstText(item.agentThreadId, item.agent_thread_id);
  if (!threadId) return;
  const kind = normalizedToken(firstText(item.kind));
  const existing = agents.get(threadId);
  const task = existing?.task || taskFromAgentPath(firstText(item.agentPath, item.agent_path));
  agents.set(threadId, {
    threadId,
    task,
    stage: kind === "interrupted" ? "interrupted" : existing?.stage === "completed" ? "completed" : "working",
    output: subagentOutputFromState(item) || existing?.output || null,
  });
}

function subagentOutputFromState(value: Record<string, unknown> | null) {
  if (!value) return null;
  const direct = firstText(value.message, value.output, value.result, value.finalOutput, value.final_output);
  if (direct) return direct;
  const message = recordValue(value.message);
  return firstText(message?.text, message?.content, message?.output, message?.result);
}

function stageFromAgentState(value: string | null): SubagentStage | null {
  switch (normalizedToken(value)) {
    case "pendinginit":
      return "starting";
    case "running":
      return "working";
    case "completed":
    case "shutdown":
      return "completed";
    case "errored":
    case "notfound":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return null;
  }
}

function stageLabel(stage: SubagentStage) {
  switch (stage) {
    case "starting":
      return "准备中";
    case "working":
      return "推进中";
    case "completed":
      return "已完成";
    case "failed":
      return "遇到问题";
    case "interrupted":
      return "已暂停";
  }
}

function stageProgressSegments(stage: SubagentStage) {
  switch (stage) {
    case "starting":
      return 2;
    case "working":
      return 7;
    case "interrupted":
      return 9;
    case "completed":
    case "failed":
      return TOTAL_PROGRESS_SEGMENTS;
  }
}

function compactSubagentTask(value: string | null) {
  if (!value) return "";
  const text = value
    .replace(/<haolo_[^>]*>[\s\S]*?<\/haolo_[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^gAAAA[A-Za-z0-9_-]{40,}$/.test(text)) return "";
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

function taskFromAgentPath(value: string | null) {
  const segment = value?.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[_-]+/g, " ").trim();
  if (!segment || segment.toLowerCase() === "root") return DEFAULT_SUBAGENT_TASK;
  return `协同处理 ${segment}`;
}

function normalizedToken(value: unknown) {
  return String(value || "").replace(/[_\s-]/g, "").toLowerCase();
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}

function arrayTexts(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => firstText(entry)).filter((entry): entry is string => Boolean(entry)) : [];
}

function uniqueTexts(values: string[]) {
  return [...new Set(values)];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
