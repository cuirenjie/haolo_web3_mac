import type { WorkflowCanvasNode, WorkflowCanvasRun, WorkflowNodeStatus } from "./workflow-canvas";

export type WorkflowRelayTarget = {
  nodeId: string;
  title: string;
  mention: string;
  instruction: string;
};

export type WorkflowRelayEntry = {
  id: string;
  threadId: string;
  runId: string;
  nodeId: string;
  nodeKind: string;
  nodeTitle: string;
  provider: string | null;
  model: string | null;
  status: WorkflowNodeStatus;
  statusLabel: string;
  summary: string;
  task: string;
  promptPreview: string;
  handoffTargets: WorkflowRelayTarget[];
  handoffNote: string;
  time: string;
  active: boolean;
  coordinatorUpdate: boolean;
  hasFollowingEntry: boolean;
};

const TERMINAL_NODE_STATUSES = new Set<WorkflowNodeStatus>([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

const FAILED_NODE_APOLOGY = "不好意思，我现在有事……可以找另一位伙伴协作。";

const PROVIDER_MENTION_LABELS: Record<string, string> = {
  anthropic: "Claude",
  claude: "Claude",
  codex: "Haolo",
  deepseek: "DeepSeek",
  doubao: "豆包",
  gemini: "Gemini",
  google: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  mimo: "MiMo",
  moonshot: "Kimi",
  openai: "GPT",
  perplexity: "Perplexity",
  qwen: "Qwen",
  xai: "Grok",
  xiaomi: "MiMo",
};

export function workflowRelayEntries(run: WorkflowCanvasRun): WorkflowRelayEntry[] {
  if (!run?.id || !run?.threadId || !Array.isArray(run.nodes)) return [];

  const nodeOrder = new Map(run.nodes.map((node, index) => [node.id, index]));
  const byId = new Map(run.nodes.map((node) => [node.id, node]));
  const completed = completedRelaySources(run.nodes, nodeOrder);
  const running = run.nodes
    .filter((node) => node.status === "running")
    .sort((left, right) => compareNodeTime(left, right, "startedAt", nodeOrder));

  const completedEntries: WorkflowRelayEntry[] = [];
  let completedModelCount = 0;
  const totalModelCount = run.nodes.filter(isExecutionNode).length;
  for (const source of completed) {
    const node = source.node;
    if (source.executorFailure) {
      completedEntries.push(failedExecutorRelayEntry(run, node, source.executorFailure));
      continue;
    }
    completedEntries.push(completedRelayEntry(run, node, byId, nodeOrder));
    if (!isExecutionNode(node)) continue;
    completedModelCount += 1;
    const laterModelNodes = modelNodesAfterCheckpoint(run.nodes, node, nodeOrder);
    if (
      node.status === "failed" ||
      (completedModelCount % 2 === 0 && laterModelNodes.length > 0)
    ) {
      completedEntries.push(coordinatorRelayEntry(
        run,
        node,
        completedModelCount,
        totalModelCount,
        laterModelNodes,
      ));
    }
  }
  const entries = [
    ...completedEntries,
    ...running.map((node) => runningRelayEntry(run, node)),
  ];
  return entries.map((entry, index) => ({
    ...entry,
    hasFollowingEntry: index < entries.length - 1,
  }));
}

type FailedExecutorRelaySource = {
  executorChoice: number;
  provider: string | null;
  model: string | null;
  attempts: number;
  error: { code?: string; message?: string; retryable?: boolean } | null;
  completedAt: string;
};

type CompletedRelaySource = {
  node: WorkflowCanvasNode;
  executorFailure: FailedExecutorRelaySource | null;
  completedAt: string;
  order: number;
};

function completedRelaySources(
  nodes: WorkflowCanvasNode[],
  nodeOrder: Map<string, number>,
): CompletedRelaySource[] {
  const sources: CompletedRelaySource[] = [];
  for (const node of nodes) {
    if (node.id !== "root-acceptance" && TERMINAL_NODE_STATUSES.has(node.status)) {
      sources.push({
        node,
        executorFailure: null,
        completedAt: normalizedText(node.completedAt),
        order: 1_000,
      });
    }
    if (!isExecutionNode(node)) continue;
    const currentExecutorChoice = Math.max(1, Number(node.executorChoice) || 1);
    for (const [historyIndex, history] of (node.executorHistory || []).entries()) {
      if (history.status !== "failed") continue;
      const executorChoice = Math.max(1, Number(history.executorChoice) || historyIndex + 1);
      if (executorChoice >= currentExecutorChoice) continue;
      sources.push({
        node,
        executorFailure: {
          executorChoice,
          provider: normalizedText(history.provider) || null,
          model: normalizedText(history.model) || null,
          attempts: Math.max(1, Number(history.attempts) || 1),
          error: history.error || null,
          completedAt: normalizedText(history.completedAt || node.startedAt || node.completedAt),
        },
        completedAt: normalizedText(history.completedAt || node.startedAt || node.completedAt),
        order: historyIndex,
      });
    }
  }
  return sources.sort((left, right) => {
    const timeDifference = timestampValue(left.completedAt) - timestampValue(right.completedAt);
    if (timeDifference) return timeDifference;
    const nodeDifference = (nodeOrder.get(left.node.id) || 0) - (nodeOrder.get(right.node.id) || 0);
    return nodeDifference || left.order - right.order;
  });
}

function failedExecutorRelayEntry(
  run: WorkflowCanvasRun,
  node: WorkflowCanvasNode,
  failure: FailedExecutorRelaySource,
): WorkflowRelayEntry {
  const choice = failure.executorChoice;
  return {
    id: `workflow-relay-${run.id}-${node.id}-executor-failed-${choice}`,
    threadId: run.threadId,
    runId: run.id,
    nodeId: `${node.id}::executor-failed:${choice}`,
    nodeKind: node.kind,
    nodeTitle: node.title,
    provider: failure.provider,
    model: failure.model,
    status: "failed",
    statusLabel: "暂时无法协作",
    summary: FAILED_NODE_APOLOGY,
    task: compactText(node.purpose, 180),
    promptPreview: compactText(node.prompt, 140),
    handoffTargets: [],
    handoffNote: "",
    time: failure.completedAt,
    active: false,
    coordinatorUpdate: false,
    hasFollowingEntry: false,
  };
}

export function renderWorkflowRelayBubble(entry: WorkflowRelayEntry) {
  const active = entry.active;
  const handoff = entry.handoffTargets.length
    ? `
      <p class="workflow-relay-chat-handoff">
        <span class="workflow-relay-chat-mentions">${entry.handoffTargets.map((target) => (
          `<span class="workflow-relay-chat-mention">@${html(target.mention)}</span>`
        )).join(" ")}</span>
        <span>${html(handoffInstruction(entry.handoffTargets))}</span>
      </p>
    `
    : entry.handoffNote
      ? `<p class="workflow-relay-chat-note">${inlineMentionText(entry.handoffNote)}</p>`
      : "";
  const speech = workflowRelaySpeech(entry);
  const focus = active && entry.promptPreview && entry.promptPreview !== entry.task
    ? `<p class="workflow-relay-chat-focus">我会重点检查：${html(entry.promptPreview)}</p>`
    : "";

  return `
    <div class="workflow-relay-chat-bubble ${attr(entry.status)} ${active ? "active" : "settled"} ${entry.coordinatorUpdate ? "coordinator" : ""}"
      data-workflow-relay-node-id="${attr(entry.nodeId)}" role="status" ${active ? 'aria-live="polite"' : ""}>
      <p class="workflow-relay-chat-message">${html(speech)}${active ? '<span class="workflow-relay-chat-dots" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}</p>
      ${focus}
      ${handoff}
    </div>
  `;
}

function completedRelayEntry(
  run: WorkflowCanvasRun,
  node: WorkflowCanvasNode,
  byId: Map<string, WorkflowCanvasNode>,
  nodeOrder: Map<string, number>,
): WorkflowRelayEntry {
  const handoffTargets = run.nodes
    .filter((target) => (target.dependsOn || []).includes(node.id))
    .filter((target) => target.status !== "pending" || dependenciesSettled(target, byId))
    .filter((target) => handoffOwner(target, byId, nodeOrder)?.id === node.id)
    .map(relayTarget);
  return {
    id: `workflow-relay-${run.id}-${node.id}`,
    threadId: run.threadId,
    runId: run.id,
    nodeId: node.id,
    nodeKind: node.kind,
    nodeTitle: node.title,
    provider: normalizedText(node.provider) || null,
    model: normalizedText(node.model) || null,
    status: node.status,
    statusLabel: completedStatusLabel(node.status),
    summary: completedNodeSummary(node),
    task: compactText(node.purpose, 180),
    promptPreview: compactText(node.prompt, 140),
    handoffTargets,
    handoffNote: handoffTargets.length ? "" : completedHandoffNote(node),
    time: normalizedText(node.completedAt),
    active: false,
    coordinatorUpdate: false,
    hasFollowingEntry: false,
  };
}

function coordinatorRelayEntry(
  run: WorkflowCanvasRun,
  checkpointNode: WorkflowCanvasNode,
  completedModelCount: number,
  totalModelCount: number,
  laterModelNodes: WorkflowCanvasNode[],
): WorkflowRelayEntry {
  const failed = checkpointNode.status === "failed";
  const nextNodes = laterModelNodes.slice(0, 2);
  const completedLabel = `${completedModelCount}/${Math.max(completedModelCount, totalModelCount)}`;
  const summary = failed
    ? `“${checkpointNode.title}”这边暂时没接上，我已经记下原因了。其他可用结果先保留，我再协调后面的伙伴继续。`
    : `目前收到了 ${completedLabel} 位伙伴的结果，我已经把关键结论放进统一上下文，正在互相对照；后面的伙伴可以继续接上。`;
  return {
    id: `workflow-relay-${run.id}-haolo-progress-${completedModelCount}-${checkpointNode.id}`,
    threadId: run.threadId,
    runId: run.id,
    nodeId: "root-plan",
    nodeKind: "root",
    nodeTitle: "Haolo 主编排",
    provider: null,
    model: "orchestrator",
    status: "succeeded",
    statusLabel: failed ? "已调整路径" : "进展同步",
    summary,
    task: "",
    promptPreview: "",
    handoffTargets: nextNodes.map(relayTarget),
    handoffNote: nextNodes.length ? "" : "我先同步到这里，等在途伙伴回来",
    time: normalizedText(checkpointNode.completedAt),
    active: false,
    coordinatorUpdate: true,
    hasFollowingEntry: false,
  };
}

function runningRelayEntry(run: WorkflowCanvasRun, node: WorkflowCanvasNode): WorkflowRelayEntry {
  return {
    id: `workflow-relay-${run.id}-${node.id}`,
    threadId: run.threadId,
    runId: run.id,
    nodeId: node.id,
    nodeKind: node.kind,
    nodeTitle: node.title,
    provider: normalizedText(node.provider) || null,
    model: normalizedText(node.model) || null,
    status: node.status,
    statusLabel: runningStatusLabel(node),
    summary: "",
    task: compactText(node.purpose || node.prompt, 180),
    promptPreview: compactText(node.prompt, 150),
    handoffTargets: [],
    handoffNote: "",
    time: normalizedText(node.startedAt),
    active: true,
    coordinatorUpdate: false,
    hasFollowingEntry: false,
  };
}

function modelNodesAfterCheckpoint(
  nodes: WorkflowCanvasNode[],
  checkpointNode: WorkflowCanvasNode,
  nodeOrder: Map<string, number>,
) {
  return nodes
    .filter((node) => isExecutionNode(node) && node.id !== checkpointNode.id)
    .filter((node) => {
      if (!TERMINAL_NODE_STATUSES.has(node.status)) return true;
      return compareNodeTime(node, checkpointNode, "completedAt", nodeOrder) > 0;
    })
    .sort((left, right) => compareNodeTime(left, right, "completedAt", nodeOrder));
}

function relayTarget(node: WorkflowCanvasNode): WorkflowRelayTarget {
  return {
    nodeId: node.id,
    title: node.title,
    mention: nodeMention(node),
    instruction: compactText(node.purpose || node.prompt, 140),
  };
}

function handoffOwner(
  target: WorkflowCanvasNode,
  byId: Map<string, WorkflowCanvasNode>,
  nodeOrder: Map<string, number>,
) {
  return (target.dependsOn || [])
    .map((id) => byId.get(id))
    .filter((node): node is WorkflowCanvasNode => Boolean(node && TERMINAL_NODE_STATUSES.has(node.status)))
    .sort((left, right) => compareNodeTime(right, left, "completedAt", nodeOrder))[0] || null;
}

function dependenciesSettled(node: WorkflowCanvasNode, byId: Map<string, WorkflowCanvasNode>) {
  return (node.dependsOn || []).every((id) => {
    const dependency = byId.get(id);
    return Boolean(dependency && TERMINAL_NODE_STATUSES.has(dependency.status));
  });
}

function compareNodeTime(
  left: WorkflowCanvasNode,
  right: WorkflowCanvasNode,
  field: "startedAt" | "completedAt",
  nodeOrder: Map<string, number>,
) {
  const timeDifference = timestampValue(left[field]) - timestampValue(right[field]);
  if (timeDifference) return timeDifference;
  return (nodeOrder.get(left.id) || 0) - (nodeOrder.get(right.id) || 0);
}

function timestampValue(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function completedNodeSummary(node: WorkflowCanvasNode) {
  const output = compactText(node.result?.output?.text, 220);
  const chatSummary = compactText(node.result?.output?.summary, 140);
  const error = compactText(node.result?.error?.message, 180);
  if (node.status === "succeeded" && (node.kind === "model" || node.kind === "agent")) {
    return chatSummary || fallbackModelChatSummary(node);
  }
  if (node.status === "succeeded") return output || `已完成“${node.purpose || node.title}”，结果已进入工作流。`;
  if (node.status === "failed") return error || "本节点未能完成，失败信息已保留并回传给 Haolo。";
  if (node.status === "cancelled") return "本节点已取消，当前执行状态已保留。";
  return output || "本节点已跳过，工作流将依据现有结果继续。";
}

function completedHandoffNote(node: WorkflowCanvasNode) {
  if (node.kind === "model") return "@Haolo 我先把结论交回来，后面你来汇总";
  if (node.kind === "agent") return "@Haolo 我先把执行结果交回来，后面你来验收";
  if (node.status === "failed") return "@Haolo 这边没接上，原因我已经同步了";
  return "我已经把结果放进当前工作流了";
}

function isExecutionNode(node: WorkflowCanvasNode) {
  return node.kind === "model" || node.kind === "agent";
}

function completedStatusLabel(status: WorkflowNodeStatus) {
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "未通过";
  if (status === "cancelled") return "已取消";
  return "已跳过";
}

function runningStatusLabel(node: WorkflowCanvasNode) {
  if (node.retrying) {
    return `重连 ${Math.max(2, Number(node.attempt) || 2)}/${Math.max(3, Number(node.maxAttempts) || 3)}`;
  }
  if (Number(node.executorChoice) > 1) {
    return `替补 ${Number(node.executorChoice)}/${Math.max(Number(node.executorChoice), Number(node.maxExecutorChoices) || 3)}`;
  }
  return node.id === "root-acceptance" ? "终验中" : "执行中";
}

function nodeMention(node: WorkflowCanvasNode) {
  if (node.id === "root-acceptance" || node.kind === "root") return "Haolo";
  if (node.kind === "context") return "本地材料";
  const provider = normalizedText(node.provider).toLowerCase();
  return PROVIDER_MENTION_LABELS[provider] || compactText(node.model || node.title, 30);
}

function handoffInstruction(targets: WorkflowRelayTarget[]) {
  if (targets.length === 1) {
    return `接下来麻烦你${targets[0].instruction || targets[0].title}。`;
  }
  return `接下来麻烦大家分别接一下：${targets
    .map((target) => `${target.mention} 负责${target.instruction || target.title}`)
    .join("；")}。`;
}

function workflowRelaySpeech(entry: WorkflowRelayEntry) {
  if (entry.active) {
    if (entry.nodeId === "root-acceptance") return "大家的结果都收到了，我正在做最后核验和整理。";
    if (entry.nodeKind === "model" || entry.nodeKind === "agent") {
      return `收到，这部分我来。我会${chatTaskText(entry.task || entry.nodeTitle)}，整理好就跟大家同步。`;
    }
    return `收到，我正在处理“${entry.nodeTitle}”。`;
  }
  if (entry.coordinatorUpdate) return entry.summary;
  if (entry.status === "failed") {
    return entry.nodeKind === "model" || entry.nodeKind === "agent"
      ? FAILED_NODE_APOLOGY
      : `“${entry.nodeTitle}”这一步没能完成：${entry.summary}`;
  }
  if (entry.status === "cancelled") return "这部分先停一下，我把当前状态留好了。";
  if (entry.status === "skipped") return "这部分先跳过，现有结果我已经接着往下传了。";
  if (entry.nodeKind === "root") return `我把分工理好了：${entry.summary}`;
  if (entry.nodeKind === "context") return `材料我整理好了：${entry.summary}`;
  if (entry.nodeKind === "model" || entry.nodeKind === "agent") return entry.summary;
  return `我这边处理好了：${entry.summary}`;
}

function fallbackModelChatSummary(node: WorkflowCanvasNode) {
  const task = compactText(node.purpose || node.title, 52);
  return task
    ? `我这边已经把“${task}”梳理好了，关键判断和建议都交回 Haolo 了。`
    : "我这边已经梳理好了，关键判断和建议都交回 Haolo 了。";
}

function chatTaskText(value: unknown) {
  return normalizedText(value)
    .replace(/^[“"]|[”"]$/g, "")
    .replace(/[。！？；，、:：]+$/u, "")
    .replace(/^我(?:会|来|正在)?/u, "")
    || "把当前任务推进完";
}

function compactText(value: unknown, limit: number) {
  const normalized = normalizedText(value).replace(/\s+/g, " ");
  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()}…` : normalized;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function html(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}

function inlineMentionText(value: unknown) {
  return String(value ?? "")
    .split(/(@[\p{L}\p{N}._-]+)/u)
    .map((part) => part.startsWith("@")
      ? `<span class="workflow-relay-chat-mention">${html(part)}</span>`
      : html(part))
    .join("");
}

function attr(value: unknown) {
  return html(value).replace(/`/g, "&#96;");
}
