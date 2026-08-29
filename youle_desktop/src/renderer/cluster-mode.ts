export const CLUSTER_MODE_VARIANTS = ["subagent", "multi-model"] as const;

export type ClusterModeVariant = (typeof CLUSTER_MODE_VARIANTS)[number];

export const DEFAULT_CLUSTER_MODE_VARIANT: ClusterModeVariant = "subagent";
export const MULTI_MODEL_CLUSTER_AVATAR_MAX_MEMBERS = 9;
export const MULTI_MODEL_CLUSTER_CONVERSATION_DEDUPE_WINDOW_MS = 10 * 60 * 1_000;

export function normalizeClusterModeVariant(value: unknown): ClusterModeVariant {
  return value === "multi-model" ? "multi-model" : DEFAULT_CLUSTER_MODE_VARIANT;
}

export function clusterModeVariantLabel(value: unknown) {
  return normalizeClusterModeVariant(value) === "multi-model" ? "画布" : "并行";
}

export function multiModelClusterMemberStatus(names: readonly string[]) {
  const normalizedNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  return normalizedNames.length
    ? `${normalizedNames.join("、")} 加入画布`
    : "正在邀请模型加入画布";
}

export function multiModelClusterAvatarRowSizes(value: unknown) {
  const count = Math.min(
    MULTI_MODEL_CLUSTER_AVATAR_MAX_MEMBERS,
    Math.max(0, Math.floor(Number(value) || 0)),
  );
  if (count <= 2) return count ? [count] : [];
  if (count === 3) return [1, 2];
  if (count === 4) return [2, 2];
  if (count <= 6) return [count - 3, 3];
  return [count - 6, 3, 3];
}

export function dedupeMultiModelClusterAvatarMembers<T extends { key: unknown }>(members: readonly T[]) {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = String(member.key || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MULTI_MODEL_CLUSTER_AVATAR_MAX_MEMBERS);
}

type MultiModelClusterConversationDedupeOptions<T extends { id: string }> = {
  activeThreadId?: string | null;
  groupIdForThread: (thread: T) => unknown;
  isMultiModelClusterThread: (thread: T) => boolean;
  titleForThread: (thread: T) => unknown;
  duplicateWindowMs?: number;
};

export function dedupeMultiModelClusterConversationThreads<T extends { id: string }>(
  threads: readonly T[],
  options: MultiModelClusterConversationDedupeOptions<T>,
) {
  const visible: T[] = [];
  const representativeByIdentity = new Map<
    string,
    { createdAtMs: number; visibleIndex: number }
  >();
  const configuredWindowMs = Number(options.duplicateWindowMs);
  const duplicateWindowMs = Number.isFinite(configuredWindowMs)
    ? Math.max(0, configuredWindowMs)
    : MULTI_MODEL_CLUSTER_CONVERSATION_DEDUPE_WINDOW_MS;

  for (const thread of threads) {
    if (!options.isMultiModelClusterThread(thread)) {
      visible.push(thread);
      continue;
    }
    const createdAtMs = uuidV7Timestamp(thread.id);
    const title = normalizeMultiModelClusterConversationIdentity(
      options.titleForThread(thread),
    );
    const groupId = normalizeMultiModelClusterConversationIdentity(
      options.groupIdForThread(thread),
    );
    if (createdAtMs == null || !title || !groupId) {
      visible.push(thread);
      continue;
    }

    const identity = `${groupId}\u0000${title}`;
    const representative = representativeByIdentity.get(identity);
    if (
      !representative ||
      Math.abs(createdAtMs - representative.createdAtMs) > duplicateWindowMs
    ) {
      representativeByIdentity.set(identity, {
        createdAtMs,
        visibleIndex: visible.length,
      });
      visible.push(thread);
      continue;
    }

    if (
      thread.id === options.activeThreadId &&
      visible[representative.visibleIndex]?.id !== options.activeThreadId
    ) {
      visible[representative.visibleIndex] = thread;
    }
    representative.createdAtMs = Math.min(
      representative.createdAtMs,
      createdAtMs,
    );
  }

  return visible;
}

function normalizeMultiModelClusterConversationIdentity(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function uuidV7Timestamp(value: unknown) {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-[7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(
    String(value || "").trim(),
  );
  if (!match) return null;
  const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

type MultiModelClusterWorkflowState = {
  id?: unknown;
  sequence?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  planCommittedAt?: unknown;
  completedAt?: unknown;
  status?: unknown;
  complexityAssessment?: {
    strategy?: unknown;
  } | null;
  nodes?: Array<{ kind?: unknown; status?: unknown }>;
};

export type MultiModelClusterPlanningUpdate = {
  id: string;
  text: string;
  completed?: boolean;
};

const MULTI_MODEL_CLUSTER_PLANNING_STAGES = [
  {
    id: "goal",
    text: "我先梳理任务目标和最终交付，确认不能遗漏的重点。",
  },
  {
    id: "models",
    text: "接着判断每一步需要只读模型还是可执行子 Agent，不为凑数量增加节点。",
  },
  {
    id: "dependencies",
    text: "我正在安排并行与依赖关系：能同时推进的部分并行，有前后依赖的部分按顺序衔接。",
  },
  {
    id: "acceptance",
    text: "最后补齐节点权限、交接和终验标准，确保所有执行结果能汇总成完整交付。",
  },
] as const;
const MULTI_MODEL_CLUSTER_PLANNING_MIN_REPLY_DELAY_MS = 5_000;
const MULTI_MODEL_CLUSTER_PLANNING_MAX_REPLY_DELAY_MS = 7_000;

function multiModelClusterWorkflowState(value: unknown): MultiModelClusterWorkflowState | null {
  if (!value || typeof value !== "object") return null;
  return value as MultiModelClusterWorkflowState;
}

export function shouldApplyWorkflowRunSnapshot(currentValue: unknown, incomingValue: unknown) {
  const incoming = multiModelClusterWorkflowState(incomingValue);
  if (!incoming) return false;
  const current = multiModelClusterWorkflowState(currentValue);
  if (!current) return true;

  const currentId = String(current.id || "").trim();
  const incomingId = String(incoming.id || "").trim();
  if (currentId && incomingId && currentId === incomingId) {
    return Number(incoming.sequence || 0) >= Number(current.sequence || 0);
  }

  const currentCreatedAt = validTimestamp(current.createdAt);
  const incomingCreatedAt = validTimestamp(incoming.createdAt);
  if (currentCreatedAt != null && incomingCreatedAt != null) {
    return incomingCreatedAt >= currentCreatedAt;
  }
  return true;
}

function multiModelClusterModelNodes(run: MultiModelClusterWorkflowState) {
  return Array.isArray(run.nodes)
    ? run.nodes.filter((node) => node?.kind === "model" || node?.kind === "agent")
    : [];
}

function validTimestamp(value: unknown) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function stablePlanningReplyDelay(seed: string, index: number) {
  let hash = 2_166_136_261;
  const input = `${seed}:${index}`;
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    hash ^= input.charCodeAt(cursor);
    hash = Math.imul(hash, 16_777_619);
  }
  const delayRange =
    MULTI_MODEL_CLUSTER_PLANNING_MAX_REPLY_DELAY_MS -
    MULTI_MODEL_CLUSTER_PLANNING_MIN_REPLY_DELAY_MS +
    1;
  return MULTI_MODEL_CLUSTER_PLANNING_MIN_REPLY_DELAY_MS + ((hash >>> 0) % delayRange);
}

function multiModelClusterPlanningSchedule(run: MultiModelClusterWorkflowState | null) {
  const seed = String(run?.id || run?.createdAt || "multi-model-cluster");
  let revealAfterMs = 0;
  return MULTI_MODEL_CLUSTER_PLANNING_STAGES.map((stage, index) => {
    revealAfterMs += stablePlanningReplyDelay(seed, index);
    return { ...stage, revealAfterMs };
  });
}

export function multiModelClusterPlanningCompleted(value: unknown) {
  const run = multiModelClusterWorkflowState(value);
  if (!run) return false;
  const modelNodes = multiModelClusterModelNodes(run);
  if (!modelNodes.length) return false;
  if (typeof run.planCommittedAt === "string" && run.planCommittedAt.trim()) return true;
  if (["accepting", "succeeded", "failed", "cancelled"].includes(String(run.status || ""))) return true;
  return modelNodes.some((node) => node?.status !== "pending");
}

export function multiModelClusterPlanningActive(value: unknown) {
  const run = multiModelClusterWorkflowState(value);
  if (!run || multiModelClusterPlanningCompleted(run)) return false;
  return !["failed", "cancelled", "succeeded"].includes(String(run.status || ""));
}

export function multiModelClusterPlanningProgress(
  value: unknown,
  nowMs = Date.now(),
): MultiModelClusterPlanningUpdate[] {
  const run = multiModelClusterWorkflowState(value);
  const completed = multiModelClusterPlanningCompleted(run);
  const createdAtMs = validTimestamp(run?.createdAt) ?? nowMs;
  const planCommittedAtMs = completed
    ? (validTimestamp(run?.planCommittedAt)
      ?? validTimestamp(run?.completedAt)
      ?? validTimestamp(run?.updatedAt)
      ?? nowMs)
    : null;
  const elapsedMs = Math.max(0, Math.min(nowMs, planCommittedAtMs ?? nowMs) - createdAtMs);
  const schedule = multiModelClusterPlanningSchedule(run);
  const revealedStages = schedule.filter((stage) => stage.revealAfterMs <= elapsedMs);
  const updates: MultiModelClusterPlanningUpdate[] = revealedStages
    .map(({ id, text }) => ({ id, text }));

  if (completed && run && planCommittedAtMs != null) {
    const lastReplyAtMs = revealedStages.length
      ? createdAtMs + (revealedStages.at(-1)?.revealAfterMs || 0)
      : planCommittedAtMs;
    const completionRevealAtMs =
      Math.max(planCommittedAtMs, lastReplyAtMs) +
      stablePlanningReplyDelay(String(run.id || run.createdAt || "multi-model-cluster"), schedule.length);
    if (nowMs < completionRevealAtMs) return updates;
    const modelNodeCount = multiModelClusterModelNodes(run).length;
    const parallel = run.complexityAssessment?.strategy === "parallel_review";
    updates.push({
      id: "completed",
      text: `编排完成：已安排 ${modelNodeCount} 个执行节点，${parallel
        ? "关键步骤会并行推进并经过独立审核"
        : "各节点会按依赖关系有序推进"}。现在开始执行。`,
      completed: true,
    });
  }
  return updates;
}

export function multiModelClusterMembersJoined(value: unknown) {
  const run = multiModelClusterWorkflowState(value);
  if (!run) return false;
  const modelNodes = multiModelClusterModelNodes(run);
  return Boolean(modelNodes.length && multiModelClusterPlanningCompleted(run));
}
