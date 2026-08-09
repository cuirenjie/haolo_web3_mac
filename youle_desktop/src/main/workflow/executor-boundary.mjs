import crypto from "node:crypto";

export const WORKFLOW_EXECUTOR_TYPES = Object.freeze({
  EXTERNAL_MODEL: "external_model",
  CODEX_SUBAGENT: "codex_subagent",
  CLI_AGENT: "cli_agent",
  REMOTE_AGENT: "remote_agent",
  TOOL: "tool",
});

export const WORKFLOW_PERMISSION_PROFILES = Object.freeze([
  "read_only",
  "workspace_write",
  "full_access",
]);

const PERMISSION_PROFILE_SET = new Set(WORKFLOW_PERMISSION_PROFILES);
const SIDE_EFFECT_POLICIES = new Set(["none", "reversible", "two_phase_commit"]);

const PROFILE_CAPABILITIES = Object.freeze({
  read_only: Object.freeze([
    "filesystem.read",
    "command.execute.read_only",
  ]),
  workspace_write: Object.freeze([
    "filesystem.read",
    "filesystem.create",
    "filesystem.update",
    "filesystem.delete",
    "command.execute",
  ]),
  full_access: Object.freeze([
    "filesystem.read",
    "filesystem.create",
    "filesystem.update",
    "filesystem.delete",
    "command.execute",
    "network.access",
    "application.operate",
    "publish.execute",
  ]),
});

export function normalizeWorkflowExecutorType(value, fallback = WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT || normalized === "agent" || normalized === "codex-agent") {
    return WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT;
  }
  if (normalized === WORKFLOW_EXECUTOR_TYPES.CLI_AGENT) return WORKFLOW_EXECUTOR_TYPES.CLI_AGENT;
  if (normalized === WORKFLOW_EXECUTOR_TYPES.REMOTE_AGENT) return WORKFLOW_EXECUTOR_TYPES.REMOTE_AGENT;
  if (normalized === WORKFLOW_EXECUTOR_TYPES.TOOL) return WORKFLOW_EXECUTOR_TYPES.TOOL;
  if (normalized === WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL || normalized === "model") {
    return WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL;
  }
  return fallback;
}

export function isWorkflowAgentExecutorType(value) {
  const normalized = normalizeWorkflowExecutorType(value);
  return normalized === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
    || normalized === WORKFLOW_EXECUTOR_TYPES.CLI_AGENT
    || normalized === WORKFLOW_EXECUTOR_TYPES.REMOTE_AGENT;
}

export function normalizeNodeCapabilityRequest(value, executorType) {
  const normalizedExecutorType = normalizeWorkflowExecutorType(executorType);
  const source = value && typeof value === "object" ? value : {};
  if (normalizedExecutorType === WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL) {
    return {
      permissionProfile: "read_only",
      capabilities: ["context.consume", "analysis.generate"],
      resourceScope: {
        workspace: "none",
        paths: [],
        uploads: [],
        network: [],
        applications: [],
      },
      actions: ["analyze", "respond"],
      sideEffectPolicy: "none",
      delegation: false,
      rationale: firstText(source.rationale, source.justification, "外部模型节点仅处理显式传入的上下文"),
    };
  }

  const requestedProfile = firstText(
    source.permissionProfile,
    source.permission_profile,
    source.profile,
  ).toLowerCase();
  const permissionProfile = PERMISSION_PROFILE_SET.has(requestedProfile)
    ? requestedProfile
    : "read_only";
  const requestedSideEffectPolicy = firstText(
    source.sideEffectPolicy,
    source.side_effect_policy,
  ).toLowerCase();
  const sideEffectPolicy = SIDE_EFFECT_POLICIES.has(requestedSideEffectPolicy)
    ? requestedSideEffectPolicy
    : permissionProfile === "read_only" ? "none" : "reversible";
  const resourceScope = source.resourceScope && typeof source.resourceScope === "object"
    ? source.resourceScope
    : source.resource_scope && typeof source.resource_scope === "object"
      ? source.resource_scope
      : {};
  const requestedCapabilities = uniqueText(source.capabilities);
  const allowedCapabilities = new Set(PROFILE_CAPABILITIES[permissionProfile]);
  const capabilities = requestedCapabilities.filter((capability) => allowedCapabilities.has(capability));
  const allowedActions = new Set(defaultActions(permissionProfile));
  const requestedActions = uniqueText(source.actions).filter((action) => allowedActions.has(action));
  const actions = requestedActions.length
    ? requestedActions
    : defaultActions(permissionProfile);
  const requiresTwoPhaseCommit = capabilities.includes("publish.execute")
    || actions.includes("publish");
  return {
    permissionProfile,
    capabilities: capabilities.length
      ? capabilities
      : [...PROFILE_CAPABILITIES[permissionProfile]],
    resourceScope: {
      workspace: firstText(resourceScope.workspace, source.workspace, "current_group"),
      paths: uniqueText(resourceScope.paths || source.paths),
      uploads: uniqueText(resourceScope.uploads || source.uploads),
      network: permissionProfile === "full_access"
        ? uniqueText(resourceScope.network || source.network)
        : [],
      applications: permissionProfile === "full_access"
        ? uniqueText(resourceScope.applications || resourceScope.apps || source.applications)
        : [],
    },
    actions,
    sideEffectPolicy: permissionProfile === "read_only"
      ? "none"
      : requiresTwoPhaseCommit ? "two_phase_commit" : sideEffectPolicy,
    delegation: false,
    rationale: firstText(
      source.rationale,
      source.justification,
      permissionProfile === "read_only"
        ? "该子 Agent 只需读取和分析"
        : "该子 Agent 需要在当前节点范围内执行操作",
    ),
  };
}

export function issueWorkflowNodeCapabilityGrant({
  run,
  node,
  taskId,
  attemptId,
  explicitPaths = [],
  selectedUploadIds = [],
  now = new Date(),
} = {}) {
  if (!run?.id || !node?.id || !taskId) {
    throw new Error("CapabilityGrant requires workflow, node, and task identities.");
  }
  const executorType = normalizeWorkflowExecutorType(node.executorType);
  const request = normalizeNodeCapabilityRequest(node.capabilityRequest, executorType);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
  const workspaceRoot = String(run.cwd || "").trim();
  const requestPaths = request.resourceScope.paths;
  const directAgentAccess = isWorkflowAgentExecutorType(executorType);
  const boundedPaths = directAgentAccess
    ? uniqueText([
        ...(workspaceRoot ? [workspaceRoot] : []),
        ...explicitPaths,
        ...requestPaths,
      ])
    : [];
  return {
    protocolVersion: 1,
    id: `grant_${crypto.randomUUID()}`,
    version: 1,
    status: "active",
    issuedBy: "root-codex",
    workflowId: run.id,
    nodeId: node.id,
    taskId,
    attemptId: String(attemptId || ""),
    executorType,
    permissionProfile: request.permissionProfile,
    capabilities: [...request.capabilities],
    resources: {
      workspaceRoot: directAgentAccess && request.resourceScope.workspace !== "none"
        ? workspaceRoot || null
        : null,
      paths: boundedPaths,
      uploadIds: uniqueText([
        ...selectedUploadIds,
        ...request.resourceScope.uploads,
      ]),
      network: [...request.resourceScope.network],
      applications: [...request.resourceScope.applications],
      allowImplicitGlobalContext: false,
    },
    actions: [...request.actions],
    sideEffectPolicy: request.sideEffectPolicy,
    delegation: {
      allowed: false,
      maxDepth: 0,
    },
    rationale: request.rationale,
    lease: {
      issuedAt,
      expiresAt,
    },
  };
}

export function sandboxPolicyForCapabilityGrant(grant) {
  const profile = String(grant?.permissionProfile || "").trim();
  if (profile === "full_access") return "danger-full-access";
  if (profile === "workspace_write") return "workspace-write";
  return "read-only";
}

export function validateWorkflowCapabilityGrant(grant, task = {}) {
  if (!grant || typeof grant !== "object") throw capabilityError("CapabilityGrant is required.");
  if (grant.status !== "active") throw capabilityError("CapabilityGrant is not active.");
  if (String(grant.workflowId || "") !== String(task.runId || "")) {
    throw capabilityError("CapabilityGrant workflow identity does not match the execution task.");
  }
  if (String(grant.nodeId || "") !== String(task.nodeId || "")) {
    throw capabilityError("CapabilityGrant node identity does not match the execution task.");
  }
  if (String(grant.taskId || "") !== String(task.taskId || "")) {
    throw capabilityError("CapabilityGrant task identity does not match the execution task.");
  }
  const grantExecutorType = normalizeWorkflowExecutorType(grant.executorType);
  const taskExecutorType = normalizeWorkflowExecutorType(task.executorType);
  if (grantExecutorType !== taskExecutorType) {
    throw capabilityError("CapabilityGrant executor type does not match the execution task.");
  }
  const expiresAt = Date.parse(String(grant.lease?.expiresAt || ""));
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw capabilityError("CapabilityGrant has expired.");
  }
  return grant;
}

export class WorkflowExecutorGateway {
  constructor(adapters = []) {
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    const type = normalizeWorkflowExecutorType(adapter?.type, "");
    if (!type || typeof adapter?.invoke !== "function") {
      throw new Error("ExecutorAdapter requires a supported type and invoke(task) function.");
    }
    this.adapters.set(type, adapter);
    return this;
  }

  describe() {
    return [...this.adapters.values()].map((adapter) => (
      typeof adapter.describe === "function"
        ? adapter.describe()
        : { type: adapter.type }
    ));
  }

  async invoke(task) {
    const executorType = normalizeWorkflowExecutorType(task?.executorType);
    const adapter = this.adapters.get(executorType);
    if (!adapter) {
      const error = new Error(`No ExecutorAdapter is registered for ${executorType}.`);
      error.code = "EXECUTOR_ADAPTER_NOT_FOUND";
      throw error;
    }
    validateWorkflowCapabilityGrant(task.capabilityGrant, {
      runId: task.runId,
      nodeId: task.nodeId,
      taskId: task.taskId,
      executorType,
    });
    return adapter.invoke({ ...task, executorType });
  }
}

export function callbackExecutorAdapter(type, invoke, manifest = {}) {
  const executorType = normalizeWorkflowExecutorType(type);
  return {
    type: executorType,
    describe() {
      return {
        protocolVersion: 1,
        type: executorType,
        ...manifest,
      };
    },
    invoke,
  };
}

function defaultActions(permissionProfile) {
  if (permissionProfile === "full_access") {
    return ["read", "create", "update", "delete", "execute", "operate_application", "publish"];
  }
  if (permissionProfile === "workspace_write") {
    return ["read", "create", "update", "delete", "execute"];
  }
  return ["read", "inspect", "analyze"];
}

function uniqueText(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 100);
}

function firstText(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function capabilityError(message) {
  const error = new Error(message);
  error.code = "CAPABILITY_GRANT_INVALID";
  return error;
}
