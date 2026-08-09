import crypto from "node:crypto";
import {
  isoNow,
  nodePromptWithOutputRequirements,
  normalizeGoalContract,
  publicWorkflowRun,
  workflowId,
} from "./protocol.mjs";
import {
  WORKFLOW_EXECUTOR_TYPES,
  normalizeWorkflowExecutorType,
} from "./executor-boundary.mjs";
import {
  hydrateNestedWorkflowNodeContracts,
  nestedWorkflowConnectionIssues,
  normalizeWorkflowNodeContract,
  reconcileWorkflowNodeContracts,
  workflowDisplayCode,
  workflowNestedBoundaryContract,
} from "./node-contract.mjs";

export const WORKFLOW_SPEC_SCHEMA_VERSION = 1;
export const WORKFLOW_DRAFT_SCHEMA_VERSION = 1;
export const WORKFLOW_NESTED_EXECUTOR_TYPE = "nested_workflow";

export const WORKFLOW_JOIN_MODES = Object.freeze([
  "all_required",
]);

const EXECUTION_NODE_KINDS = new Set(["model", "agent", "workflow", "tool"]);
const TERMINAL_SYSTEM_NODE_IDS = new Set(["root-plan", "local-context", "root-acceptance"]);

export class WorkflowDraftValidationError extends Error {
  constructor(validation) {
    super("Workflow draft failed validation.");
    this.name = "WorkflowDraftValidationError";
    this.code = "WORKFLOW_DRAFT_INVALID";
    this.validation = validation;
  }
}

export class WorkflowDraftConflictError extends Error {
  constructor(expectedRevision, actualRevision) {
    super(`Workflow draft revision conflict: expected ${expectedRevision}, current ${actualRevision}.`);
    this.name = "WorkflowDraftConflictError";
    this.code = "WORKFLOW_DRAFT_REVISION_CONFLICT";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function workflowDraftFromRun(run, options = {}) {
  if (!run?.id || !run?.threadId) throw new Error("Workflow run identity is required.");
  const now = options.now || isoNow();
  const nodes = normalizeWorkflowDefinitionNodes(
    (run.nodes || []).filter((node) => isWorkflowDefinitionNode(node)),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const configuredEntries = normalizeEntryBindings(
    options.entryBindings
    || run.entryBindings
    || run.metadata?.entryBindings,
    nodeIds,
  );
  const entryBindings = configuredEntries.length
    ? configuredEntries
    : defaultWorkflowEntryBindings(nodes);
  return normalizeWorkflowDraft({
    schemaVersion: WORKFLOW_DRAFT_SCHEMA_VERSION,
    id: options.id || workflowId("draft"),
    workflowKey: options.workflowKey
      || run.workflowKey
      || run.specWorkflowKey
      || `thread_${run.threadId}`,
    threadId: run.threadId,
    baseSpecId: options.baseSpecId || run.specId || null,
    baseSpecVersion: options.baseSpecVersion ?? run.specVersion ?? null,
    sourceRunId: run.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    goalContract: run.goalContract || null,
    rationale: run.rationale || "",
    finalAcceptancePrompt: findFinalAcceptancePrompt(run),
    resources: {
      attachments: cloneSerializable(run.metadata?.attachments || []),
      uploadManifest: cloneSerializable(run.metadata?.uploadManifest || []),
    },
    nodes,
    entryBindings,
    appliedCommandIds: [],
    metadata: {
      source: "run_revision",
      sourceRunStatus: run.status || null,
    },
  });
}

export function normalizeWorkflowDraft(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const metadata = serializableObject(source.metadata);
  const nodes = assignStableDisplayCodes(
    normalizeWorkflowDefinitionNodes(source.nodes || []),
    metadata,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    schemaVersion: WORKFLOW_DRAFT_SCHEMA_VERSION,
    id: String(source.id || workflowId("draft")),
    workflowKey: String(source.workflowKey || source.workflow_key || source.threadId || "workflow"),
    threadId: String(source.threadId || source.thread_id || ""),
    baseSpecId: optionalText(source.baseSpecId || source.base_spec_id),
    baseSpecVersion: optionalPositiveInteger(source.baseSpecVersion ?? source.base_spec_version),
    sourceRunId: optionalText(source.sourceRunId || source.source_run_id),
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    createdAt: source.createdAt || source.created_at || isoNow(),
    updatedAt: source.updatedAt || source.updated_at || isoNow(),
    goalContract: cloneSerializable(source.goalContract || source.goal_contract || null),
    rationale: String(source.rationale || ""),
    finalAcceptancePrompt: String(
      source.finalAcceptancePrompt || source.final_acceptance_prompt || "",
    ),
    resources: normalizeWorkflowResources(source.resources),
    nodes,
    entryBindings: normalizeEntryBindings(
      source.entryBindings || source.entry_bindings,
      nodeIds,
    ),
    appliedCommandIds: uniqueStrings(source.appliedCommandIds || source.applied_command_ids).slice(-256),
    metadata,
  };
}

export function applyWorkflowDraftCommand(value, command = {}, options = {}) {
  const draft = normalizeWorkflowDraft(value);
  const requestedRevision = command.baseRevision ?? command.base_revision;
  if (
    requestedRevision !== undefined
    && requestedRevision !== null
    && Number(requestedRevision) !== draft.revision
  ) {
    throw new WorkflowDraftConflictError(Number(requestedRevision), draft.revision);
  }
  const commandId = String(command.commandId || command.command_id || "").trim();
  if (commandId && draft.appliedCommandIds.includes(commandId)) return draft;
  const type = String(command.type || "").trim().toLowerCase();
  const payload = command.payload && typeof command.payload === "object"
    ? command.payload
    : command;
  const next = cloneSerializable(draft);

  if (type === "add_node" || type === "add_nested_workflow") {
    const node = normalizeWorkflowDefinitionNode(payload.node || payload);
    if (!node?.id) throw commandError("WORKFLOW_NODE_ID_REQUIRED", "A node id is required.");
    if (next.nodes.some((candidate) => candidate.id === node.id)) {
      throw commandError("WORKFLOW_NODE_ALREADY_EXISTS", `Node ${node.id} already exists.`);
    }
    const nextIndex = nextNodeDisplayIndex(next.nodes, next.metadata);
    next.nodes.push({ ...node, displayCode: node.displayCode || workflowDisplayCode(nextIndex) });
    next.metadata.nextNodeDisplayIndex = nextIndex + 1;
  } else if (type === "update_node") {
    const nodeId = String(payload.nodeId || payload.node_id || payload.id || "").trim();
    const index = next.nodes.findIndex((node) => node.id === nodeId);
    if (index < 0) throw commandError("WORKFLOW_NODE_NOT_FOUND", `Node ${nodeId} does not exist.`);
    next.nodes[index] = normalizeWorkflowDefinitionNode({
      ...next.nodes[index],
      ...(payload.patch || payload.node || {}),
      id: nodeId,
    });
  } else if (type === "delete_node") {
    const nodeId = String(payload.nodeId || payload.node_id || payload.id || "").trim();
    const deleted = next.nodes.find((node) => node.id === nodeId);
    if (!deleted) throw commandError("WORKFLOW_NODE_NOT_FOUND", `Node ${nodeId} does not exist.`);
    const reconnect = payload.reconnect === true;
    const upstreamIds = [...deleted.dependsOn];
    next.nodes = next.nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => ({
        ...node,
        dependsOn: uniqueStrings(node.dependsOn.flatMap((dependencyId) => (
          dependencyId === nodeId ? (reconnect ? upstreamIds : []) : [dependencyId]
        ))).filter((dependencyId) => dependencyId !== node.id),
      }));
    next.entryBindings = next.entryBindings.filter((binding) => binding.targetNodeId !== nodeId);
  } else if (type === "connect_edge" || type === "disconnect_edge") {
    const sourceNodeId = String(payload.sourceNodeId || payload.source_node_id || "").trim();
    const targetNodeId = String(payload.targetNodeId || payload.target_node_id || "").trim();
    const sourceExists = next.nodes.some((node) => node.id === sourceNodeId);
    const targetIndex = next.nodes.findIndex((node) => node.id === targetNodeId);
    if (!sourceExists || targetIndex < 0) {
      throw commandError("WORKFLOW_EDGE_ENDPOINT_NOT_FOUND", "Workflow edge endpoint does not exist.");
    }
    if (sourceNodeId === targetNodeId) {
      throw commandError("WORKFLOW_SELF_EDGE", "A node cannot depend on itself.");
    }
    const target = next.nodes[targetIndex];
    target.dependsOn = type === "connect_edge"
      ? uniqueStrings([...target.dependsOn, sourceNodeId])
      : target.dependsOn.filter((dependencyId) => dependencyId !== sourceNodeId);
  } else if (type === "set_entry_bindings") {
    const nodeIds = new Set(next.nodes.map((node) => node.id));
    next.entryBindings = normalizeEntryBindings(
      payload.entryBindings || payload.entry_bindings || payload.nodeIds || payload.node_ids,
      nodeIds,
    );
  } else if (type === "update_resources") {
    next.resources = normalizeWorkflowResources(payload.resources || payload);
  } else if (type === "replace_definition") {
    next.resources = normalizeWorkflowResources(payload.resources || next.resources);
    next.nodes = assignStableDisplayCodes(
      normalizeWorkflowDefinitionNodes(payload.nodes || []),
      next.metadata,
    );
    next.entryBindings = normalizeEntryBindings(
      payload.entryBindings || payload.entry_bindings || [],
      new Set(next.nodes.map((node) => node.id)),
    );
  } else {
    throw commandError("WORKFLOW_DRAFT_COMMAND_UNSUPPORTED", `Unsupported workflow draft command: ${type}`);
  }

  next.nodes = assignStableDisplayCodes(normalizeWorkflowDefinitionNodes(next.nodes), next.metadata);
  const cycle = findWorkflowCycle(next.nodes);
  if (cycle.length) {
    throw commandError("WORKFLOW_GRAPH_CYCLE", "工作流不能形成循环连接");
  }
  next.nodes = hydrateNestedWorkflowNodeContracts(next.nodes, options);
  const nestedConnectionError = nestedWorkflowConnectionIssues(next.nodes)[0];
  if (nestedConnectionError) {
    throw commandError(nestedConnectionError.code, nestedConnectionError.message);
  }
  next.nodes = reconcileWorkflowNodeContracts(next.nodes, next.resources);
  if (commandId) next.appliedCommandIds = [...next.appliedCommandIds, commandId].slice(-256);
  next.revision += 1;
  next.updatedAt = command.updatedAt || command.updated_at || isoNow();
  return normalizeWorkflowDraft(next);
}

export function validateWorkflowDraft(value, options = {}) {
  const draft = normalizeWorkflowDraft(value);
  return validateWorkflowDefinition(draft, options);
}

export function validateWorkflowSpec(value, options = {}) {
  const spec = normalizeWorkflowSpec(value);
  return validateWorkflowDefinition(spec, options);
}

export function freezeWorkflowDraft(value, options = {}) {
  const draft = normalizeWorkflowDraft(value);
  draft.nodes = hydrateNestedWorkflowNodeContracts(draft.nodes, options);
  const nestedConnectionError = nestedWorkflowConnectionIssues(draft.nodes)[0];
  if (nestedConnectionError) {
    throw commandError(nestedConnectionError.code, nestedConnectionError.message);
  }
  const validation = validateWorkflowDraft(draft, options);
  if (!validation.valid) throw new WorkflowDraftValidationError(validation);
  const now = options.now || isoNow();
  const spec = normalizeWorkflowSpec({
    schemaVersion: WORKFLOW_SPEC_SCHEMA_VERSION,
    id: options.id || workflowId("spec"),
    workflowKey: options.workflowKey || draft.workflowKey,
    version: options.version || 1,
    threadId: draft.threadId,
    sourceDraftId: draft.id,
    sourceDraftRevision: draft.revision,
    sourceRunId: draft.sourceRunId,
    parentSpecId: draft.baseSpecId,
    parentSpecVersion: draft.baseSpecVersion,
    createdAt: now,
    frozenAt: now,
    goalContract: draft.goalContract,
    rationale: draft.rationale,
    finalAcceptancePrompt: draft.finalAcceptancePrompt,
    resources: draft.resources,
    nodes: draft.nodes,
    entryBindings: draft.entryBindings,
    metadata: {
      ...draft.metadata,
      source: "workflow_draft",
    },
  });
  const fullScope = workflowExecutionScope(spec);
  spec.goalContract = workflowInvocationGoalContract(spec, fullScope);
  spec.finalAcceptancePrompt = workflowInvocationFinalAcceptancePrompt(spec, fullScope);
  spec.graphHash = workflowDefinitionHash(spec);
  const frozenValidation = validateWorkflowSpec(spec, options);
  if (!frozenValidation.valid) throw new WorkflowDraftValidationError(frozenValidation);
  return spec;
}

export function normalizeWorkflowSpec(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const metadata = serializableObject(source.metadata);
  const nodes = assignStableDisplayCodes(
    normalizeWorkflowDefinitionNodes(source.nodes || []),
    metadata,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const spec = {
    schemaVersion: WORKFLOW_SPEC_SCHEMA_VERSION,
    id: String(source.id || workflowId("spec")),
    workflowKey: String(source.workflowKey || source.workflow_key || source.threadId || "workflow"),
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    threadId: String(source.threadId || source.thread_id || ""),
    sourceDraftId: optionalText(source.sourceDraftId || source.source_draft_id),
    sourceDraftRevision: optionalNonNegativeInteger(
      source.sourceDraftRevision ?? source.source_draft_revision,
    ),
    sourceRunId: optionalText(source.sourceRunId || source.source_run_id),
    parentSpecId: optionalText(source.parentSpecId || source.parent_spec_id),
    parentSpecVersion: optionalPositiveInteger(source.parentSpecVersion ?? source.parent_spec_version),
    createdAt: source.createdAt || source.created_at || isoNow(),
    frozenAt: source.frozenAt || source.frozen_at || source.createdAt || isoNow(),
    goalContract: cloneSerializable(source.goalContract || source.goal_contract || null),
    rationale: String(source.rationale || ""),
    finalAcceptancePrompt: String(
      source.finalAcceptancePrompt || source.final_acceptance_prompt || "",
    ),
    resources: normalizeWorkflowResources(source.resources),
    nodes,
    entryBindings: normalizeEntryBindings(
      source.entryBindings || source.entry_bindings,
      nodeIds,
    ),
    metadata,
  };
  return {
    ...spec,
    graphHash: String(source.graphHash || source.graph_hash || workflowDefinitionHash(spec)),
  };
}

export function workflowSpecFromRun(run, options = {}) {
  const draft = workflowDraftFromRun(run, options);
  return freezeWorkflowDraft(draft, {
    ...options,
    id: options.id || `spec_legacy_${run.id}`,
    workflowKey: options.workflowKey || draft.workflowKey,
    version: options.version || 1,
  });
}

export function workflowDefinitionHash(value) {
  const normalized = {
    schemaVersion: WORKFLOW_SPEC_SCHEMA_VERSION,
    workflowKey: String(value?.workflowKey || ""),
    goalContract: value?.goalContract || null,
    finalAcceptancePrompt: String(value?.finalAcceptancePrompt || ""),
    resources: normalizeWorkflowResources(value?.resources),
    entryBindings: normalizeEntryBindings(
      value?.entryBindings,
      new Set((value?.nodes || []).map((node) => String(node?.id || ""))),
    ),
    nodes: normalizeWorkflowDefinitionNodes(value?.nodes || []),
  };
  return crypto.createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function workflowExecutionScope(value, requestedEntryNodeIds = null) {
  const definition = value?.nodes ? value : normalizeWorkflowSpec(value);
  const nodes = normalizeWorkflowDefinitionNodes(definition.nodes || []);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const configuredEntries = requestedEntryNodeIds == null
    ? normalizeEntryBindings(definition.entryBindings, new Set(byId.keys()))
      .map((binding) => binding.targetNodeId)
    : uniqueStrings(requestedEntryNodeIds);
  const entryNodeIds = configuredEntries.filter((nodeId) => byId.has(nodeId));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) outgoing.get(dependencyId)?.push(node.id);
  }
  const scope = new Set();
  const queue = [...entryNodeIds];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || scope.has(nodeId)) continue;
    scope.add(nodeId);
    for (const downstreamId of outgoing.get(nodeId) || []) queue.push(downstreamId);
  }
  const entrySet = new Set(entryNodeIds);
  const boundaryInputs = [];
  for (const nodeId of scope) {
    if (entrySet.has(nodeId)) continue;
    const node = byId.get(nodeId);
    for (const sourceNodeId of node.dependsOn) {
      if (!scope.has(sourceNodeId)) boundaryInputs.push({ sourceNodeId, targetNodeId: nodeId });
    }
  }
  const sinkNodeIds = [...scope].filter((nodeId) => (
    !(outgoing.get(nodeId) || []).some((targetNodeId) => scope.has(targetNodeId))
  ));
  return {
    entryNodeIds,
    scopeNodeIds: [...scope],
    sinkNodeIds,
    boundaryInputs,
  };
}

export function workflowInvocationGoalContract(value, scopeValue = null) {
  const definition = value?.nodes ? value : normalizeWorkflowSpec(value);
  const scope = scopeValue || workflowExecutionScope(definition);
  const nodesById = new Map((definition.nodes || []).map((node) => [node.id, node]));
  const sinks = (scope.sinkNodeIds || []).map((nodeId) => nodesById.get(nodeId)).filter(Boolean);
  const outputSlots = sinks.flatMap((node) => (
    node.nodeContract?.compiled === true
      ? (node.nodeContract.outputContract?.slots || []).map((slot) => ({ node, slot }))
      : []
  ));
  if (!outputSlots.length) return normalizeGoalContract(definition.goalContract || {});

  const names = [...new Set(outputSlots
    .map(({ slot }) => String(slot.semanticName || workflowOutputTypeLabel(slot.type)).trim())
    .filter(Boolean))];
  const deliverable = names.length === 1
    ? names[0]
    : `最终汇点输出：${names.join("、")}`;
  const sinkCriteria = sinks.map((node) => `${workflowSinkDisplayName(node)} 成功完成`);
  const slotCriteria = outputSlots.map(({ node, slot }) => (
    `${workflowSinkDisplayName(node)} 输出${workflowOutputSlotSuccessCriterion(slot)}`
  ));
  return normalizeGoalContract({
    deliverable,
    successCriteria: [...new Set([...sinkCriteria, ...slotCriteria])],
    constraints: [],
    prohibitions: [],
  });
}

export function workflowInvocationFinalAcceptancePrompt(value, scopeValue = null) {
  const definition = value?.nodes ? value : normalizeWorkflowSpec(value);
  const scope = scopeValue || workflowExecutionScope(definition);
  const goalContract = workflowInvocationGoalContract(definition, scope);
  const nodesById = new Map((definition.nodes || []).map((node) => [node.id, node]));
  const sinkNames = (scope.sinkNodeIds || [])
    .map((nodeId) => nodesById.get(nodeId))
    .filter(Boolean)
    .map(workflowSinkDisplayName);
  const hasCompiledSinkOutput = (scope.sinkNodeIds || []).some((nodeId) => {
    const contract = nodesById.get(nodeId)?.nodeContract;
    return contract?.compiled === true && (contract.outputContract?.slots || []).length > 0;
  });
  if (!hasCompiledSinkOutput) return String(definition.finalAcceptancePrompt || "");
  return [
    `验收并交付冻结画布最终汇点 ${sinkNames.join("、") || "节点"} 的既有输出。`,
    `最终交付物：${goalContract.deliverable}。`,
    "入口消息仅用于填充画布入口输入，不是本次冻结画布的最终交付目标。",
    "汇点节点及其输出契约已成功校验时，直接报告成功并交付汇点产物；不得重新按入口消息另行创作或否定汇点结果。",
  ].join("\n");
}

function workflowSinkDisplayName(node) {
  const code = String(node?.displayCode || "").trim();
  const title = String(node?.title || node?.id || "最终汇点").trim();
  return code ? `${code} / ${title}` : title;
}

function workflowOutputSlotSuccessCriterion(slot) {
  const name = String(slot?.semanticName || workflowOutputTypeLabel(slot?.type)).trim();
  const minCount = Math.max(0, Math.floor(Number(slot?.minCount) || 0));
  const maxCount = Math.max(minCount, Math.floor(Number(slot?.maxCount) || minCount));
  if (minCount === maxCount) return `${minCount || 1} 个${name}`;
  return `${minCount}-${maxCount} 个${name}`;
}

function workflowOutputTypeLabel(type) {
  return ({ text: "文字", image: "图片", video: "视频", file: "文件" })[type] || "文件";
}

export function validateWorkflowInvocation(value, options = {}) {
  const spec = normalizeWorkflowSpec(value);
  const validation = validateWorkflowSpec(spec, options);
  const scope = workflowExecutionScope(spec, options.entryNodeIds || null);
  const errors = [...validation.errors];
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  if (!scope.entryNodeIds.length) {
    errors.push(issue("WORKFLOW_ENTRY_REQUIRED", "请先将输入框连接到至少一个可执行节点。"));
  }
  if (!scope.scopeNodeIds.length) {
    errors.push(issue("WORKFLOW_SCOPE_EMPTY", "当前输入入口没有可执行的下游节点。"));
  }
  // Historical results are never allowed to satisfy excluded dependencies.
  // A partial run must start at a point whose complete dependency closure is
  // inside the selected scope. Otherwise preflight fails before any node runs.
  for (const boundary of scope.boundaryInputs) {
    const sourceNode = byId.get(boundary.sourceNodeId);
    errors.push(issue(
      "WORKFLOW_BOUNDARY_INPUT_REQUIRED",
      `当前运行链路缺少节点 ${sourceNode?.displayCode || sourceNode?.title || boundary.sourceNodeId} 的输出`,
      { nodeId: boundary.targetNodeId, sourceNodeId: boundary.sourceNodeId },
    ));
  }
  if (scope.sinkNodeIds.length !== 1) {
    errors.push(issue("WORKFLOW_SINGLE_RESULT_REQUIRED", "运行链路只能输出一个结果", {
      path: scope.sinkNodeIds,
    }));
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: validation.warnings,
    scope,
  };
}

export function defaultWorkflowEntryBindings(nodes = []) {
  const executionNodes = normalizeWorkflowDefinitionNodes(nodes);
  const nodeIds = new Set(executionNodes.map((node) => node.id));
  return executionNodes
    .filter((node) => !node.dependsOn.some((dependencyId) => nodeIds.has(dependencyId)))
    .map((node) => ({ source: "workflow_input", targetNodeId: node.id }));
}

function validateWorkflowDefinition(value, options = {}) {
  const nodes = normalizeWorkflowDefinitionNodes(value.nodes || []);
  const errors = [];
  const warnings = [];
  if (value.graphHash && String(value.graphHash) !== workflowDefinitionHash(value)) {
    errors.push(issue(
      "WORKFLOW_GRAPH_HASH_MISMATCH",
      "画布定义与冻结版本哈希不一致。",
    ));
  }
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node.id) {
      errors.push(issue("WORKFLOW_NODE_ID_REQUIRED", "工作流节点缺少标识。"));
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(issue("WORKFLOW_NODE_ID_DUPLICATE", `节点标识 ${node.id} 重复。`, { nodeId: node.id }));
    }
    nodeIds.add(node.id);
  }
  if (!nodes.length) errors.push(issue("WORKFLOW_NODE_REQUIRED", "工作流至少需要一个可执行节点。"));

  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!nodeIds.has(dependencyId)) {
        errors.push(issue(
          "WORKFLOW_EDGE_ENDPOINT_NOT_FOUND",
          `节点 ${node.id} 的上游节点 ${dependencyId} 不存在。`,
          { nodeId: node.id, sourceNodeId: dependencyId },
        ));
      } else if (dependencyId === node.id) {
        errors.push(issue("WORKFLOW_SELF_EDGE", `节点 ${node.id} 不能连接自身。`, { nodeId: node.id }));
      }
    }
    if ((node.kind === "model" || node.kind === "agent") && !node.prompt.trim()) {
      errors.push(issue("WORKFLOW_NODE_PROMPT_REQUIRED", `节点 ${node.id} 的提示词不能为空。`, { nodeId: node.id }));
    }
    if (
      node.skillBindings.length
      && node.executorType !== WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
    ) {
      errors.push(issue(
        "WORKFLOW_SKILL_REQUIRES_AGENT",
        `节点 ${node.id} 使用了 Skill，执行者必须选择 Haolo 子 Agent。`,
        { nodeId: node.id },
      ));
    }
    if (node.kind === "workflow") {
      if (!node.workflowRef?.specId || !node.workflowRef?.version || !node.workflowRef?.graphHash) {
        errors.push(issue(
          "WORKFLOW_NESTED_REFERENCE_REQUIRED",
          `嵌套工作流节点 ${node.id} 缺少冻结版本引用。`,
          { nodeId: node.id },
        ));
      } else if (typeof options.resolveSpec === "function") {
        const nestedSpec = options.resolveSpec(node.workflowRef.specId, node.workflowRef.version);
        if (!nestedSpec) {
          errors.push(issue(
            "WORKFLOW_NESTED_REFERENCE_NOT_FOUND",
            `嵌套工作流节点 ${node.id} 引用的版本不存在。`,
            { nodeId: node.id },
          ));
        } else if (String(nestedSpec.graphHash || "") !== node.workflowRef.graphHash) {
          errors.push(issue(
            "WORKFLOW_NESTED_REFERENCE_HASH_MISMATCH",
            `嵌套工作流节点 ${node.id} 引用的画布哈希不一致。`,
            { nodeId: node.id },
          ));
        } else {
          const boundary = workflowNestedBoundaryContract(nestedSpec, { nodeId: node.id });
          if (!boundary.valid || !boundary.nodeContract) {
            errors.push(issue(
              "WORKFLOW_NESTED_BOUNDARY_UNDEFINED",
              boundary.message || `嵌套工作流节点 ${node.id} 的输入输出边界未定义。`,
              { nodeId: node.id },
            ));
          } else if (!sameWorkflowBoundaryContract(node.nodeContract, boundary.nodeContract)) {
            errors.push(issue(
              "WORKFLOW_NESTED_BOUNDARY_MISMATCH",
              `嵌套工作流节点 ${node.id} 的输入输出必须与引用的冻结画布保持一致。`,
              { nodeId: node.id },
            ));
          }
        }
      }
    }
  }

  const cycle = findWorkflowCycle(nodes);
  if (cycle.length) {
    errors.push(issue(
      "WORKFLOW_GRAPH_CYCLE",
      "工作流不能形成循环连接",
      { nodeId: cycle[0], path: cycle },
    ));
  }

  const entryBindings = normalizeEntryBindings(value.entryBindings, nodeIds);
  if (nodes.length && !entryBindings.length) {
    errors.push(issue("WORKFLOW_ENTRY_REQUIRED", "请将输入框连接到至少一个节点。"));
  }
  for (const binding of entryBindings) {
    if (!nodeIds.has(binding.targetNodeId)) {
      errors.push(issue(
        "WORKFLOW_ENTRY_TARGET_NOT_FOUND",
        `输入框连接的节点 ${binding.targetNodeId} 不存在。`,
        { nodeId: binding.targetNodeId },
      ));
    }
  }

  const scope = workflowExecutionScope({ nodes, entryBindings });
  for (const node of nodes) {
    if (!scope.scopeNodeIds.includes(node.id)) {
      warnings.push(issue(
        "WORKFLOW_NODE_UNREACHABLE",
        `节点 ${node.id} 不在当前输入入口的下游，本次完整运行不会执行。`,
        { nodeId: node.id, severity: "warning" },
      ));
    }
  }

  const nestedCycle = findNestedWorkflowReferenceCycle(value, options);
  if (nestedCycle.length) {
    errors.push(issue(
      "WORKFLOW_NESTED_REFERENCE_CYCLE",
      `嵌套工作流引用形成循环：${nestedCycle.join(" → ")}。`,
      { path: nestedCycle },
    ));
  }
  for (const nestedIssue of nestedWorkflowConnectionIssues(nodes)) {
    errors.push(issue(nestedIssue.code, nestedIssue.message, nestedIssue));
  }
  return { valid: errors.length === 0, errors, warnings };
}

function sameWorkflowBoundaryContract(leftValue, rightValue) {
  const signature = (value) => {
    const contract = normalizeWorkflowNodeContract(value);
    const slots = (items) => items.map((slot) => ({
      type: slot.type,
      semanticName: slot.semanticName,
      minCount: slot.minCount,
      maxCount: slot.maxCount,
      required: slot.required,
      accept: [...(slot.accept || [])].map((item) => String(item).toLowerCase()).sort(),
    }));
    return stableStringify({
      input: slots(contract.inputContract.slots),
      output: slots(contract.outputContract.slots),
    });
  };
  return signature(leftValue) === signature(rightValue);
}

function normalizeWorkflowDefinitionNodes(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeWorkflowDefinitionNode).filter(Boolean);
}

function normalizeWorkflowDefinitionNode(value = {}) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const requestedKind = String(value.kind || "model").trim().toLowerCase();
  const workflowRef = normalizeWorkflowRef(value.workflowRef || value.workflow_ref);
  const kind = workflowRef || requestedKind === "workflow" ? "workflow"
    : requestedKind === "agent" ? "agent"
      : requestedKind === "tool" ? "tool" : "model";
  const executorType = kind === "workflow"
    ? WORKFLOW_NESTED_EXECUTOR_TYPE
    : normalizeWorkflowExecutorType(
        value.executorType || value.executor_type,
        kind === "agent"
          ? WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
          : kind === "tool"
            ? WORKFLOW_EXECUTOR_TYPES.TOOL
            : WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
      );
  const dependsOn = uniqueStrings(value.dependsOn || value.depends_on).filter((dependencyId) => (
    dependencyId !== id && !TERMINAL_SYSTEM_NODE_IDS.has(dependencyId)
  ));
  const legacyOutputRequirements = uniqueStrings([
    ...uniqueStrings((value.outputContract || value.output_contract)?.requirements),
    ...uniqueStrings(value.acceptance),
  ]);
  const outputContract = normalizeOutputContract(value.outputContract || value.output_contract);
  const joinPolicy = normalizeJoinPolicy(value.joinPolicy || value.join_policy, dependsOn.length);
  return {
    id,
    displayCode: optionalText(value.displayCode || value.display_code),
    kind,
    executorType,
    title: String(value.title || id || "未命名节点"),
    purpose: String(value.purpose || ""),
    provider: optionalText(value.provider),
    model: optionalText(value.model),
    executorCandidates: Array.isArray(value.executorCandidates || value.executor_candidates)
      ? cloneSerializable(value.executorCandidates || value.executor_candidates)
      : [],
    prompt: nodePromptWithOutputRequirements(value.prompt, legacyOutputRequirements),
    nodeContract: normalizeWorkflowNodeContract(
      value.nodeContract || value.node_contract || {
        compiled: false,
        taskDefinition: { text: String(value.purpose || value.prompt || "").trim() },
        outputContract: { slots: [] },
      },
      { nodeId: id },
    ),
    dependsOn,
    inputBindings: dependsOn.map((sourceNodeId) => {
      const existing = (value.inputBindings || value.input_bindings || []).find((binding) => (
        String(binding?.sourceNodeId || binding?.source_node_id || "") === sourceNodeId
      ));
      return {
        sourceNodeId,
        outputPath: optionalText(existing?.outputPath || existing?.output_path),
        required: true,
        acceptedStatuses: ["succeeded"],
      };
    }),
    joinPolicy,
    outputContract,
    skillBindings: normalizeSkillBindings(value.skillBindings || value.skill_bindings),
    contextSelection: cloneSerializable(value.contextSelection || value.context_selection || null),
    capabilityRequest: cloneSerializable(value.capabilityRequest || value.capability_request || null),
    risk: ["low", "medium", "high"].includes(String(value.risk || "low"))
      ? String(value.risk || "low")
      : "low",
    acceptance: [],
    coordination: cloneSerializable(value.coordination || {
      mode: "solo",
      parallelGroup: null,
      reviewTargets: [],
    }),
    workflowRef,
    attachmentRefs: cloneSerializable(value.attachmentRefs || value.attachment_refs || []),
  };
}

function normalizeJoinPolicy(value, dependencyCount) {
  void value;
  void dependencyCount;
  return {
    mode: "all_required",
  };
}

function normalizeOutputContract(value) {
  const source = value && typeof value === "object" ? value : {};
  const requestedFormat = String(source.format || "").trim().toLowerCase();
  const format = ["text", "structured_data", "artifact", "mixed"].includes(requestedFormat)
    ? requestedFormat
    : "auto";
  return {
    format,
    requirements: [],
    requiredArtifactTypes: uniqueStrings(
      source.requiredArtifactTypes || source.required_artifact_types,
    ),
  };
}

function normalizeSkillBindings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((binding) => {
    if (typeof binding === "string") return { name: binding, version: null, source: "prompt_mention" };
    if (!binding || typeof binding !== "object") return null;
    const name = String(binding.name || binding.id || "").trim();
    if (!name) return null;
    return {
      name,
      version: optionalText(binding.version),
      source: String(binding.source || "prompt_mention"),
    };
  }).filter(Boolean);
}

function normalizeWorkflowRef(value) {
  if (!value || typeof value !== "object") return null;
  const specId = String(value.specId || value.spec_id || "").trim();
  const version = optionalPositiveInteger(value.version);
  const graphHash = String(value.graphHash || value.graph_hash || "").trim();
  if (!specId && !version && !graphHash) return null;
  return { specId, version, graphHash };
}

function normalizeWorkflowResources(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    attachments: Array.isArray(source.attachments)
      ? cloneSerializable(source.attachments)
      : [],
    uploadManifest: Array.isArray(source.uploadManifest || source.upload_manifest)
      ? cloneSerializable(source.uploadManifest || source.upload_manifest)
      : [],
  };
}

function normalizeEntryBindings(value, nodeIds = new Set()) {
  const list = Array.isArray(value) ? value : [];
  const bindings = list.map((binding) => {
    if (typeof binding === "string") {
      return { source: "workflow_input", targetNodeId: binding };
    }
    if (!binding || typeof binding !== "object") return null;
    const targetNodeId = String(
      binding.targetNodeId || binding.target_node_id || binding.nodeId || binding.node_id || "",
    ).trim();
    if (!targetNodeId) return null;
    return { source: "workflow_input", targetNodeId };
  }).filter(Boolean);
  const seen = new Set();
  return bindings.filter((binding) => {
    if (seen.has(binding.targetNodeId)) return false;
    seen.add(binding.targetNodeId);
    // Do not silently discard dangling bindings. They must remain visible to
    // validation so a broken entry connection cannot be frozen or executed.
    return true;
  });
}

function assignStableDisplayCodes(nodes, metadata = {}) {
  const used = new Set();
  let nextIndex = nextNodeDisplayIndex(nodes, metadata);
  for (const node of nodes) {
    if (node.displayCode && !used.has(node.displayCode)) {
      used.add(node.displayCode);
      continue;
    }
    let candidate = workflowDisplayCode(nextIndex);
    while (used.has(candidate)) {
      nextIndex += 1;
      candidate = workflowDisplayCode(nextIndex);
    }
    node.displayCode = candidate;
    used.add(candidate);
    nextIndex += 1;
  }
  metadata.nextNodeDisplayIndex = Math.max(
    Math.floor(Number(metadata.nextNodeDisplayIndex) || 0),
    nextIndex,
  );
  return nodes;
}

function nextNodeDisplayIndex(nodes, metadata = {}) {
  let next = Math.max(0, Math.floor(Number(metadata.nextNodeDisplayIndex) || 0));
  for (const node of nodes || []) {
    const parsed = displayCodeIndex(node?.displayCode);
    if (parsed !== null) next = Math.max(next, parsed + 1);
  }
  return next;
}

function displayCodeIndex(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || [...text].some((character) => character < "A" || character > "Z")) return null;
  let result = 0;
  for (const character of text) result = (result * 26) + character.charCodeAt(0) - 64;
  return result - 1;
}

function findWorkflowCycle(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set();
  const active = new Set();
  const path = [];
  let cycle = [];
  const visit = (nodeId) => {
    if (cycle.length || visited.has(nodeId)) return;
    if (active.has(nodeId)) {
      const start = path.indexOf(nodeId);
      cycle = [...path.slice(Math.max(0, start)), nodeId];
      return;
    }
    active.add(nodeId);
    path.push(nodeId);
    const node = byId.get(nodeId);
    for (const dependencyId of node?.dependsOn || []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    path.pop();
    active.delete(nodeId);
    visited.add(nodeId);
  };
  nodes.forEach((node) => visit(node.id));
  return cycle;
}

function findNestedWorkflowReferenceCycle(value, options = {}) {
  if (typeof options.resolveSpec !== "function") return [];
  const rootIdentity = specIdentity(value);
  if (!rootIdentity) return [];
  const active = [];
  const visited = new Set();
  let cycle = [];
  const visit = (spec) => {
    if (cycle.length) return;
    const identity = specIdentity(spec);
    if (!identity) return;
    const activeIndex = active.indexOf(identity);
    if (activeIndex >= 0) {
      cycle = [...active.slice(activeIndex), identity];
      return;
    }
    if (visited.has(identity)) return;
    active.push(identity);
    for (const node of spec.nodes || []) {
      if (!node.workflowRef?.specId || !node.workflowRef?.version) continue;
      const child = options.resolveSpec(node.workflowRef.specId, node.workflowRef.version);
      if (child) visit(child);
    }
    active.pop();
    visited.add(identity);
  };
  visit(value);
  return cycle;
}

function specIdentity(value) {
  const id = String(value?.id || "").trim();
  const version = optionalPositiveInteger(value?.version);
  return id && version ? `${id}@${version}` : "";
}

function findFinalAcceptancePrompt(run) {
  return String(
    (run.nodes || []).find((node) => node.id === "root-acceptance")?.prompt
    || run.finalAcceptancePrompt
    || "核验所有节点结果，以用户目标为准交付最终成果。",
  );
}

function isWorkflowDefinitionNode(node) {
  if (!node?.id || TERMINAL_SYSTEM_NODE_IDS.has(node.id)) return false;
  return EXECUTION_NODE_KINDS.has(String(node.kind || ""))
    || Boolean(node.workflowRef || node.workflow_ref);
}

function issue(code, message, details = {}) {
  return {
    code,
    message,
    severity: details.severity || "error",
    nodeId: details.nodeId || null,
    sourceNodeId: details.sourceNodeId || null,
    path: details.path || null,
  };
}

function commandError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableStringify(value) {
  return JSON.stringify(sortSerializable(value));
}

function sortSerializable(value) {
  if (Array.isArray(value)) return value.map(sortSerializable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortSerializable(value[key])]),
  );
}

function uniqueStrings(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function optionalPositiveInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalNonNegativeInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function serializableObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneSerializable(value)
    : {};
}

function cloneSerializable(value) {
  if (value === undefined) return undefined;
  return publicWorkflowRun(value);
}
