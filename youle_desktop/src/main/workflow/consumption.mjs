const PHASES = Object.freeze({
  canvas_create_plan: {
    sourceType: "multi_model_cluster_planning",
    title: "创建画布 · 智能体语义规划",
  },
  canvas_node_semantic_compile: {
    sourceType: "multi_model_cluster_planning",
    title: "编辑画布 · 节点语义编译",
  },
  node_capability_compile: {
    sourceType: "multi_model_cluster_validation",
    title: "运行画布 · 节点能力契约补全",
  },
  node_context_read: {
    sourceType: "multi_model_cluster_context",
    title: "运行画布 · 本地上下文读取",
  },
  node_output_validate: {
    sourceType: "multi_model_cluster_validation",
    title: "运行画布 · 节点输出语义验收",
  },
  node_agent_execute: {
    sourceType: "multi_model_cluster_node",
    title: "运行画布 · 智能体执行",
  },
  node_external_execute: {
    sourceType: "multi_model_cluster_node",
    title: "运行画布 · 外部模型执行",
  },
  node_media_execute: {
    sourceType: "multi_model_cluster_media",
    title: "运行画布 · 媒体生成",
  },
});

function firstString(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function normalizeWorkflowConsumptionContext(value = {}) {
  const phase = firstString(value.phase, value.stage) || "node_agent_execute";
  const metadata = PHASES[phase] || PHASES.node_agent_execute;
  const runId = firstString(value.runId, value.run_id);
  const draftId = firstString(value.draftId, value.draft_id);
  const rootThreadId = firstString(
    value.rootThreadId,
    value.root_thread_id,
    value.threadId,
    value.thread_id,
  );
  const scopeId = firstString(value.scopeId, value.scope_id, runId, draftId, rootThreadId);
  return {
    phase,
    sourceType: firstString(value.sourceType, value.source_type, metadata.sourceType),
    title: firstString(value.title, metadata.title),
    runId,
    draftId,
    rootThreadId,
    scopeId,
    nodeId: firstString(value.nodeId, value.node_id),
    nodeTitle: firstString(value.nodeTitle, value.node_title),
    attemptId: firstString(value.attemptId, value.attempt_id),
  };
}

export function workflowConsumptionQuestion(value = {}) {
  const context = normalizeWorkflowConsumptionContext(value);
  const nodeLabel = context.nodeTitle || context.nodeId;
  return nodeLabel
    ? `${context.title} · 节点「${nodeLabel}」`
    : context.title;
}

export function buildWorkflowConsumptionRecord(value = {}, lifecycle = {}) {
  const context = normalizeWorkflowConsumptionContext(value);
  const interactionId = firstString(lifecycle.interactionId, lifecycle.interaction_id);
  if (!interactionId) return null;
  const conversationId = firstString(
    lifecycle.conversationId,
    lifecycle.conversation_id,
    context.scopeId,
    context.rootThreadId,
  );
  const childConversationId = firstString(
    lifecycle.childConversationId,
    lifecycle.child_conversation_id,
  );
  return {
    interactionId,
    conversationId: conversationId || undefined,
    childConversationId: childConversationId || undefined,
    sourceType: context.sourceType,
    question: workflowConsumptionQuestion(context),
    status: firstString(lifecycle.status) || "running",
    startedAt: lifecycle.startedAt || lifecycle.started_at,
    endedAt: lifecycle.endedAt || lifecycle.ended_at,
    answer: lifecycle.answer,
  };
}

export function workflowMediaCorrelationInstructions(value = {}, interactionId, options = {}) {
  const context = normalizeWorkflowConsumptionContext(value);
  const normalizedInteractionId = firstString(interactionId);
  if (!normalizedInteractionId || !context.scopeId) return "";
  const mediaMode = firstString(options.mediaMode, options.media_mode);
  const commandArguments = mediaMode === "video-generation"
    ? [
        `--request-id ${JSON.stringify(normalizedInteractionId)}`,
        `--conversation-id ${JSON.stringify(context.scopeId)}`,
        `PowerShell 启动命令前设置 $env:HAOLO_SOURCE_TYPE=${JSON.stringify(context.sourceType)}`,
      ]
    : [
        `--interaction-id ${JSON.stringify(normalizedInteractionId)}`,
        `--conversation-id ${JSON.stringify(context.scopeId)}`,
        `--source-type ${JSON.stringify(context.sourceType)}`,
      ];
  return [
    "消费归因要求：本节点内每一次图片或视频生成命令都必须携带以下参数，不能省略、替换或生成新的归因 ID：",
    ...commandArguments,
    "如果所调用脚本暂不支持其中某个参数，必须先报告该脚本不满足计费归因契约，不得静默发起无法归因的付费媒体调用。",
  ].join("\n");
}

export const WORKFLOW_CONSUMPTION_PHASES = Object.freeze({ ...PHASES });
