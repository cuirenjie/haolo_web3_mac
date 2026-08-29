import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  canonicalChromeOperationHash,
  chromeToolEffectLevel,
  chromeToolNames,
  chromeToolRequiresTwoPhase,
  validateChromeToolCall,
} from "./contract.mjs";
import {
  ChromeEffectStore,
  ChromeGrantStore,
  ChromeSitePolicyStore,
  authorizeChromeToolCall,
  normalizeChromeOrigin,
  sanitizePageSnapshot,
} from "./policy.mjs";

const READ_ONLY_TOOLS = new Set([
  "chrome_status", "cancel_task", "list_tabs", "read_page", "read_selection", "capture_view", "wait_for",
]);
const ENABLED_TOOLS = new Set(chromeToolNames());
const UI_APPROVAL_SENTINEL = "haolo_ui_approved";

export class ChromeToolRuntime extends EventEmitter {
  constructor({ broker, logger = console, grantStore, sitePolicyStore, effectStore } = {}) {
    super();
    if (!broker || typeof broker.call !== "function" || typeof broker.status !== "function") {
      throw new TypeError("ChromeToolRuntime requires a Chrome Native Broker");
    }
    this.broker = broker;
    this.logger = logger;
    this.grants = grantStore || new ChromeGrantStore();
    this.sites = sitePolicyStore || new ChromeSitePolicyStore();
    this.effects = effectStore || new ChromeEffectStore();
    this.sessionOrigins = new Map();
    this.tasks = new Map();
    this.artifacts = new Map();
    this.operationExecutions = new Map();
    this.historyApprovals = new Map();
    this.approvedOperationTokens = new Map();
    this.approvalWaiters = new Map();
    this.onBrokerMessage = (message) => this.handleExtensionMessage(message);
    this.broker.on?.("message", this.onBrokerMessage);
  }

  dispose() {
    this.broker.off?.("message", this.onBrokerMessage);
    this.removeAllListeners();
    this.tasks.clear();
    this.sessionOrigins.clear();
    this.artifacts.clear();
    this.operationExecutions.clear();
    this.historyApprovals.clear();
    this.approvedOperationTokens.clear();
    for (const waiters of this.approvalWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(runtimeError("CHROME_RUNTIME_STOPPED", "The Chrome runtime stopped while waiting for approval.", "cancelled", true, 503));
      }
    }
    this.approvalWaiters.clear();
  }

  status() {
    return {
      protocolVersion: 1,
      broker: this.broker.status(),
      activeTasks: this.tasks.size,
      pendingApprovals: this.pendingApprovals().length,
      registeredArtifacts: this.artifacts.size,
      sitePolicy: this.sites.snapshot(),
      availableTools: chromeToolNames(),
    };
  }

  handleExtensionMessage(message = {}) {
    const profileId = String(message.profileId || "").trim();
    const envelope = message.envelope || {};
    if (!profileId || !envelope.type) return;
    if (envelope.type === "extension.site.permission") {
      this.#recordSitePermission(profileId, envelope.payload || {});
      return;
    }
    if (envelope.type === "extension.task.start") {
      const task = this.#recordTask(profileId, envelope);
      this.emit("task", task);
      return;
    }
    this.emit("extensionMessage", message);
  }

  async invoke({ tool, arguments: args = {}, context = {} } = {}) {
    const name = String(tool || "").trim();
    const validated = validateChromeToolCall(name, args || {});
    if (!ENABLED_TOOLS.has(name)) throw runtimeError("CHROME_TOOL_NOT_ENABLED", `${name} is not enabled.`, "policy", false, 409);
    if (name === "chrome_status") return this.status();
    if (name === "cancel_task") return this.cancelTask(validated.arguments.task_id);

    const executionContext = this.#context(context);
    if (name === "commit_external_action") return this.#commitExternalAction(validated.arguments, executionContext);
    const profileId = await this.#selectProfile(name, validated.arguments, context);
    if (name === "list_tabs") {
      return this.broker.call(profileId, "tool.call", { tool: name, arguments: validated.arguments }, executionContext);
    }
    if (name === "read_history") return this.#readHistory(profileId, validated.arguments, executionContext);

    let executionArguments = validated.arguments;
    let tabId = Number(executionArguments.tab_id);
    let tab = await this.#findTab(profileId, tabId, executionContext);
    let origin = normalizeChromeOrigin(tab.url);
    const siteDecision = this.sites.decide(origin, this.#sessionOriginList(profileId));
    if (siteDecision.decision !== "allow") {
      throw runtimeError(
        siteDecision.decision === "block" ? "CHROME_SITE_BLOCKED" : "CHROME_SITE_PERMISSION_REQUIRED",
        siteDecision.decision === "block"
          ? `Chrome access is blocked for ${origin}.`
          : `Authorize ${origin} in the Haolo Chrome side panel before using this tool.`,
        "policy",
        false,
        403,
      );
    }

    let task = this.#taskFor(profileId, tabId, executionContext.taskId);
    let taskSurface = null;
    if (!READ_ONLY_TOOLS.has(name) && task && task.tabId !== tabId) {
      tabId = task.tabId;
      tab = await this.#findTab(profileId, tabId, executionContext);
      const taskOrigin = normalizeChromeOrigin(tab.url);
      if (taskOrigin !== task.origin) throw runtimeError("CHROME_TASK_TAB_ORIGIN_MISMATCH", "The isolated task tab has left its granted origin.", "policy", false, 409);
      origin = taskOrigin;
      executionArguments = { ...executionArguments, tab_id: tabId };
    }
    if (!READ_ONLY_TOOLS.has(name) && !task) {
      taskSurface = await this.broker.call(
        profileId,
        "task.tab.create",
        { tabId, taskId: executionContext.taskId },
        executionContext,
      );
      const taskTab = taskSurface?.tab;
      if (!Number.isInteger(Number(taskTab?.tab_id)) || !taskTab?.url) {
        throw runtimeError("CHROME_TASK_TAB_CREATE_FAILED", "Chrome did not return a valid isolated task tab.", "execution", true, 502);
      }
      const nextOrigin = normalizeChromeOrigin(taskTab.url);
      if (nextOrigin !== origin) throw runtimeError("CHROME_TASK_TAB_ORIGIN_MISMATCH", "The isolated task tab changed origin before the action.", "policy", false, 409);
      tabId = Number(taskTab.tab_id);
      tab = taskTab;
      origin = nextOrigin;
      executionArguments = { ...executionArguments, tab_id: tabId };
      task = Object.freeze({
        taskId: String(taskSurface.task_id || executionContext.taskId),
        profileId,
        tabId,
        sourceTabId: Number(taskTab.source_tab_id),
        origin,
        threadId: executionContext.threadId,
        turnId: executionContext.turnId,
        createdAt: new Date().toISOString(),
      });
      this.tasks.set(task.taskId, task);
      this.emit("task", task);
    }
    const artifact = name === "upload_file"
      ? this.#artifactFor(executionArguments.artifact_id, executionContext, task, { required: false })
      : null;
    const grant = this.grants.issue({
      threadId: executionContext.threadId,
      turnId: executionContext.turnId,
      taskId: task?.taskId || executionContext.taskId,
      profileId,
      tabIds: [tabId],
      origins: [origin],
      tools: [name],
      artifactIds: name === "upload_file" ? [executionArguments.artifact_id] : [],
    });
    let keepGrant = false;
    try {
      authorizeChromeToolCall({
        grantStore: this.grants,
        grantId: grant.id,
        tool: name,
        arguments: executionArguments,
        context: {
          threadId: grant.threadId,
          turnId: grant.turnId,
          taskId: grant.taskId,
          profileId,
          url: tab.url,
        },
      });
      const result = await this.broker.call(
        profileId,
        "tool.call",
        { tool: name, arguments: executionArguments, effectLevel: chromeToolEffectLevel(name) },
        { ...executionContext, taskId: grant.taskId, grantId: grant.id },
      );
      if (chromeToolRequiresTwoPhase(name)) {
        const operation = this.effects.prepare({
          grantId: grant.id,
          tool: name,
          arguments: executionArguments,
          summary: executionArguments.summary || effectSummary(name, executionArguments, artifact),
          tabId,
          origin,
        });
        keepGrant = true;
        this.operationExecutions.set(operation.id, {
          operationId: operation.id,
          grantId: grant.id,
          tool: name,
          arguments: executionArguments,
          preview: result,
          profileId,
          context: { ...executionContext, taskId: grant.taskId, grantId: grant.id },
          tabId,
          origin,
          artifactId: artifact?.id || null,
        });
        const pending = {
          approval_required: true,
          operation,
          preview: result,
          commit_after_approval: { operation_id: operation.id, approval_token: UI_APPROVAL_SENTINEL },
          ...(name === "upload_file" ? { artifact_required: !artifact, artifact_id: executionArguments.artifact_id } : {}),
          ...(taskSurface ? { task_surface: taskSurface } : {}),
        };
        this.emit("approval", pending);
        return pending;
      }
      if (name === "read_page") return sanitizePageSnapshot(result, { maxChars: executionArguments.max_chars });
      return taskSurface ? { ...result, task_surface: taskSurface } : result;
    } finally {
      if (!keepGrant) this.grants.revoke(grant.id);
    }
  }

  registerArtifact({ artifactId, filePath, context = {} } = {}) {
    const id = String(artifactId || `chrome_artifact_${crypto.randomUUID()}`).trim();
    if (!/^chrome_artifact_[a-zA-Z0-9_-]{8,160}$/.test(id)) {
      throw runtimeError("CHROME_ARTIFACT_ID_INVALID", "Chrome artifact id is invalid.", "validation", false, 400);
    }
    const resolvedPath = path.resolve(String(filePath || ""));
    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      throw runtimeError("CHROME_ARTIFACT_MISSING", "The selected upload file no longer exists.", "routing", true, 404);
    }
    if (!stat.isFile()) throw runtimeError("CHROME_ARTIFACT_INVALID", "The selected upload artifact is not a file.", "validation", false, 400);
    if (stat.size > 2 * 1024 * 1024 * 1024) throw runtimeError("CHROME_ARTIFACT_TOO_LARGE", "Chrome upload files are limited to 2 GiB.", "validation", false, 413);
    const artifact = Object.freeze({
      id,
      filePath: resolvedPath,
      name: path.basename(resolvedPath),
      size: stat.size,
      threadId: context.threadId ? String(context.threadId) : null,
      taskId: context.taskId ? String(context.taskId) : null,
      registeredAt: new Date().toISOString(),
    });
    this.artifacts.set(id, artifact);
    return publicArtifact(artifact);
  }

  removeArtifact(artifactId) {
    return this.artifacts.delete(String(artifactId || ""));
  }

  registerArtifactForOperation(operationId, filePath) {
    const execution = this.operationExecutions.get(String(operationId || ""));
    if (!execution || execution.tool !== "upload_file") {
      throw runtimeError("CHROME_UPLOAD_OPERATION_INVALID", "The upload approval request is missing or expired.", "routing", false, 404);
    }
    return this.registerArtifact({
      artifactId: execution.arguments.artifact_id,
      filePath,
      context: { threadId: execution.context.threadId, taskId: execution.context.taskId },
    });
  }

  approveOperation(operationId) {
    const execution = this.operationExecutions.get(String(operationId || ""));
    if (execution?.tool === "upload_file" && !this.artifacts.has(execution.artifactId)) {
      throw runtimeError("CHROME_ARTIFACT_REQUIRED", "Select the upload file in Haolo before approving this operation.", "policy", false, 409);
    }
    const approved = this.effects.approve(operationId);
    this.approvedOperationTokens.set(approved.operation.id, approved.approvalToken);
    this.#settleApprovalWaiters(approved.operation.id, null, approved.approvalToken);
    this.emit("approvalUpdated", { type: "external", operation: approved.operation });
    return approved;
  }

  approveHistoryRequest(requestId) {
    const request = this.historyApprovals.get(String(requestId || ""));
    if (!request || request.status !== "prepared" || Date.parse(request.expiresAt) <= Date.now()) {
      throw runtimeError("CHROME_HISTORY_APPROVAL_INVALID", "The history approval request is missing or expired.", "policy", false, 404);
    }
    request.status = "approved";
    request.approvedAt = new Date().toISOString();
    this.#settleApprovalWaiters(request.id, null, "history-approved");
    this.emit("approvalUpdated", { type: "history", request: publicHistoryApproval(request) });
    return publicHistoryApproval(request);
  }

  rejectApproval(requestId, reason = "User declined the Chrome operation.") {
    const id = String(requestId || "");
    const history = this.historyApprovals.get(id);
    if (history) {
      history.status = "rejected";
      this.historyApprovals.delete(id);
      this.#settleApprovalWaiters(id, runtimeError("CHROME_APPROVAL_DECLINED", String(reason || "User declined the Chrome history request."), "cancelled", false, 409));
      this.emit("approvalUpdated", { type: "history", request: publicHistoryApproval(history) });
      return { rejected: true, type: "history", id };
    }
    const execution = this.operationExecutions.get(id);
    if (!execution) return { rejected: false, id };
    const operation = this.effects.fail(id, runtimeError("CHROME_APPROVAL_DECLINED", String(reason || "User declined the Chrome operation."), "cancelled", false, 409));
    this.grants.revoke(execution.grantId);
    this.operationExecutions.delete(id);
    this.approvedOperationTokens.delete(id);
    this.#settleApprovalWaiters(id, runtimeError("CHROME_APPROVAL_DECLINED", String(reason || "User declined the Chrome operation."), "cancelled", false, 409));
    this.emit("approvalUpdated", { type: "external", operation });
    return { rejected: true, type: "external", id };
  }

  pendingApprovals() {
    const external = this.effects.list({ statuses: ["prepared", "approved"] }).map((operation) => {
      const execution = this.operationExecutions.get(operation.id);
      const artifactRequired = execution?.tool === "upload_file" && !this.artifacts.has(execution.artifactId);
      return {
        type: "external",
        operation,
        preview: execution?.preview || null,
        artifact_required: artifactRequired,
        artifact_id: execution?.artifactId || null,
      };
    });
    const history = [...this.historyApprovals.values()]
      .filter((request) => ["prepared", "approved"].includes(request.status) && Date.parse(request.expiresAt) > Date.now())
      .map((request) => ({ type: "history", request: publicHistoryApproval(request) }));
    return [...external, ...history];
  }

  cancelTask(taskIdValue) {
    const taskId = String(taskIdValue || "").trim();
    const task = this.tasks.get(taskId);
    if (!task) return { task_id: taskId, cancelled: false };
    this.tasks.delete(taskId);
    this.grants.revokeForTurn(task.turnId);
    for (const [operationId, execution] of this.operationExecutions) {
      if (execution.context.taskId !== taskId) continue;
      this.effects.fail(operationId, runtimeError("CHROME_TASK_CANCELLED", "The Chrome task was cancelled.", "cancelled", false, 409));
      this.grants.revoke(execution.grantId);
      this.operationExecutions.delete(operationId);
    }
    this.emit("taskCancelled", task);
    void this.broker.call(task.profileId, "tool.call", { tool: "cancel_task", arguments: { task_id: taskId } }, task).catch(() => {});
    return { task_id: taskId, cancelled: true };
  }

  async #commitExternalAction(args, _context) {
    const operation = this.effects.get(args.operation_id);
    const suppliedToken = args.approval_token === UI_APPROVAL_SENTINEL
      ? (this.approvedOperationTokens.get(operation.id) || await this.#waitForOperationApproval(operation.id, operation.expiresAt))
      : args.approval_token;
    if (!suppliedToken) {
      throw runtimeError("CHROME_APPROVAL_REQUIRED", "Approve this operation in Haolo before committing it.", "policy", false, 403);
    }
    const committing = this.effects.commit(args.operation_id, suppliedToken);
    if (committing.replayed) {
      return { replayed: true, operation: committing, result: operation.result };
    }
    const execution = this.operationExecutions.get(operation.id);
    if (!execution) {
      this.effects.fail(operation.id, runtimeError("CHROME_OPERATION_CONTEXT_MISSING", "The prepared operation context is no longer available.", "routing", false, 410));
      throw runtimeError("CHROME_OPERATION_CONTEXT_MISSING", "The prepared operation context is no longer available.", "routing", false, 410);
    }
    const artifact = execution.artifactId ? this.artifacts.get(execution.artifactId) : null;
    try {
      authorizeChromeToolCall({
        grantStore: this.grants,
        grantId: execution.grantId,
        tool: execution.tool,
        arguments: execution.arguments,
        context: {
          threadId: execution.context.threadId,
          turnId: execution.context.turnId,
          taskId: execution.context.taskId,
          profileId: execution.profileId,
          url: execution.tool === "download" ? execution.arguments.url : execution.origin,
        },
      });
      if (execution.artifactId && !artifact) {
        throw runtimeError("CHROME_ARTIFACT_MISSING", "The approved upload file is no longer registered.", "routing", true, 404);
      }
      const result = await this.broker.call(
        execution.profileId,
        "tool.call",
        {
          tool: "commit_external_action",
          arguments: args,
          effectLevel: chromeToolEffectLevel(execution.tool),
          prepared_tool: execution.tool,
          original_arguments: execution.arguments,
          prepared_preview: execution.preview,
          authorized_artifact: artifact ? { artifact_id: artifact.id, path: artifact.filePath } : null,
        },
        execution.context,
      );
      const completed = this.effects.complete(operation.id, result);
      this.emit("approvalUpdated", { type: "external", operation: completed });
      return { replayed: false, operation: completed, result };
    } catch (error) {
      this.effects.fail(operation.id, error);
      throw error;
    } finally {
      this.grants.revoke(execution.grantId);
      this.operationExecutions.delete(operation.id);
      if (this.effects.get(operation.id).status !== "committed") this.approvedOperationTokens.delete(operation.id);
    }
  }

  async #readHistory(profileId, args, context) {
    const approvalKey = canonicalChromeOperationHash({
      profileId,
      threadId: context.threadId,
      taskId: context.taskId,
      tool: "read_history",
      arguments: args,
    });
    let request = [...this.historyApprovals.values()].find((entry) => entry.approvalKey === approvalKey && ["prepared", "approved"].includes(entry.status));
    if (!request || Date.parse(request.expiresAt) <= Date.now()) {
      const createdAt = Date.now();
      request = {
        id: `chrome_history_${crypto.randomUUID()}`,
        status: "prepared",
        approvalKey,
        profileId,
        context: structuredClone(context),
        arguments: structuredClone(args),
        createdAt: new Date(createdAt).toISOString(),
        expiresAt: new Date(createdAt + 5 * 60_000).toISOString(),
        approvedAt: null,
      };
      this.historyApprovals.set(request.id, request);
      this.emit("approval", { type: "history", approval_required: true, approval: publicHistoryApproval(request) });
    }
    if (request.status !== "approved") await this.#waitForOperationApproval(request.id, request.expiresAt);

    const grant = this.grants.issue({
      threadId: context.threadId,
      turnId: context.turnId,
      taskId: context.taskId,
      profileId,
      tools: ["read_history"],
    });
    try {
      authorizeChromeToolCall({
        grantStore: this.grants,
        grantId: grant.id,
        tool: "read_history",
        arguments: args,
        context: { threadId: context.threadId, turnId: context.turnId, taskId: context.taskId, profileId },
        ephemeralApproval: true,
      });
      const result = await this.broker.call(
        profileId,
        "tool.call",
        { tool: "read_history", arguments: args, effectLevel: chromeToolEffectLevel("read_history") },
        { ...context, grantId: grant.id },
      );
      request.status = "consumed";
      this.historyApprovals.delete(request.id);
      return result;
    } catch (error) {
      if (error?.code !== "CHROME_HISTORY_PERMISSION_REQUIRED") {
        request.status = "consumed";
        this.historyApprovals.delete(request.id);
      }
      throw error;
    } finally {
      this.grants.revoke(grant.id);
    }
  }

  #artifactFor(artifactId, context, task, { required = true } = {}) {
    const artifact = this.artifacts.get(String(artifactId || ""));
    if (!artifact) {
      if (!required) return null;
      throw runtimeError("CHROME_ARTIFACT_NOT_GRANTED", "Select and authorize the upload file in Haolo before preparing the upload.", "policy", false, 403);
    }
    if (artifact.threadId && artifact.threadId !== context.threadId) {
      throw runtimeError("CHROME_ARTIFACT_NOT_GRANTED", "The upload file belongs to another Haolo task.", "policy", false, 403);
    }
    if (artifact.taskId && artifact.taskId !== (task?.taskId || context.taskId)) {
      throw runtimeError("CHROME_ARTIFACT_NOT_GRANTED", "The upload file belongs to another Haolo task.", "policy", false, 403);
    }
    if (!fs.existsSync(artifact.filePath)) throw runtimeError("CHROME_ARTIFACT_MISSING", "The selected upload file no longer exists.", "routing", true, 404);
    return artifact;
  }

  #waitForOperationApproval(operationId, expiresAt) {
    const current = this.approvedOperationTokens.get(operationId);
    if (current) return Promise.resolve(current);
    const remaining = Math.max(1, Math.min(5 * 60_000, Date.parse(expiresAt) - Date.now()));
    return new Promise((resolve, reject) => {
      const waiters = this.approvalWaiters.get(operationId) || new Set();
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        if (!waiters.size) this.approvalWaiters.delete(operationId);
        reject(runtimeError("CHROME_OPERATION_EXPIRED", "The Chrome approval request expired.", "policy", false, 408));
      }, remaining);
      waiter.timer.unref?.();
      waiters.add(waiter);
      this.approvalWaiters.set(operationId, waiters);
    });
  }

  #settleApprovalWaiters(operationId, error, token = null) {
    const waiters = this.approvalWaiters.get(operationId);
    if (!waiters) return;
    this.approvalWaiters.delete(operationId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve(token);
    }
  }

  #recordSitePermission(profileId, payload) {
    const origin = normalizeChromeOrigin(payload.origin || payload.url);
    const mode = String(payload.mode || "none");
    const decision = String(payload.decision || "allow");
    if (decision === "block") {
      this.sites.set(origin, "block");
      this.#sessionOrigins(profileId).delete(origin);
    } else if (mode === "site") {
      this.sites.set(origin, "allow");
      this.#sessionOrigins(profileId).delete(origin);
    } else if (mode === "once") {
      this.#sessionOrigins(profileId).add(origin);
    } else {
      this.#sessionOrigins(profileId).delete(origin);
    }
    this.emit("sitePolicy", { profileId, origin, mode, decision, policy: this.sites.snapshot() });
  }

  #recordTask(profileId, envelope) {
    const payload = envelope.payload || {};
    const tab = payload.tab || {};
    const taskId = String(payload.taskId || envelope.taskId || `chrome_task_${crypto.randomUUID()}`);
    const origin = normalizeChromeOrigin(tab.origin || tab.url || payload.snapshot?.url);
    const mode = payload.permissionMode === "site" ? "site" : "once";
    this.#recordSitePermission(profileId, { origin, mode, decision: "allow" });
    const task = Object.freeze({
      taskId,
      profileId,
      tabId: Number(tab.tabId),
      sourceTabId: Number(tab.sourceTabId),
      origin,
      prompt: String(payload.prompt || "").slice(0, 20_000),
      snapshot: sanitizePageSnapshot(payload.snapshot || {}),
      threadId: String(envelope.threadId || `chrome_extension_${profileId}`),
      turnId: String(envelope.turnId || `chrome_turn_${crypto.randomUUID()}`),
      createdAt: new Date().toISOString(),
    });
    this.tasks.set(taskId, task);
    return task;
  }

  async #selectProfile(tool, args, context) {
    const explicit = String(args.profile_id || context.profileId || "").trim();
    const profiles = this.broker.status().profiles || [];
    if (explicit) {
      if (!profiles.some((profile) => profile.profileId === explicit)) {
        throw runtimeError("CHROME_PROFILE_DISCONNECTED", "The requested Chrome profile is not connected.", "routing", true, 409);
      }
      return explicit;
    }
    if (profiles.length === 1) return profiles[0].profileId;
    if (!profiles.length) throw runtimeError("CHROME_PROFILE_DISCONNECTED", "No Haolo Chrome profile is connected.", "transport", true, 503);
    if (tool !== "list_tabs") throw runtimeError("CHROME_PROFILE_REQUIRED", "Multiple Chrome profiles are connected; choose a profile first.", "routing", false, 409);
    throw runtimeError("CHROME_PROFILE_REQUIRED", "Pass profile_id when multiple Chrome profiles are connected.", "routing", false, 409);
  }

  async #findTab(profileId, tabId, context) {
    if (!Number.isInteger(tabId)) throw runtimeError("CHROME_TAB_INVALID", "A valid Chrome tab id is required.", "validation", false, 400);
    const result = await this.broker.call(profileId, "tool.call", { tool: "list_tabs", arguments: {} }, this.#context(context));
    const tab = Array.isArray(result?.tabs) ? result.tabs.find((entry) => Number(entry.tab_id) === tabId) : null;
    if (!tab?.url) throw runtimeError("CHROME_TAB_MISSING", "The requested Chrome tab no longer exists.", "routing", true, 404);
    return tab;
  }

  #taskFor(profileId, tabId, taskId) {
    if (taskId) {
      const exact = this.tasks.get(taskId);
      if (exact?.profileId === profileId && (exact.tabId === tabId || exact.sourceTabId === tabId)) return exact;
    }
    for (const task of this.tasks.values()) {
      if (task.profileId === profileId && (task.tabId === tabId || task.sourceTabId === tabId)) return task;
    }
    return null;
  }

  #context(context = {}) {
    return {
      threadId: String(context.threadId || `chrome_mcp_${crypto.randomUUID()}`),
      turnId: String(context.turnId || `chrome_call_${crypto.randomUUID()}`),
      taskId: String(context.taskId || `chrome_task_${crypto.randomUUID()}`),
      profileId: context.profileId ? String(context.profileId) : undefined,
    };
  }

  #sessionOrigins(profileId) {
    const key = String(profileId || "");
    let origins = this.sessionOrigins.get(key);
    if (!origins) {
      origins = new Set();
      this.sessionOrigins.set(key, origins);
    }
    return origins;
  }

  #sessionOriginList(profileId) {
    return [...this.#sessionOrigins(profileId)];
  }
}

function effectSummary(tool, args, artifact) {
  if (tool === "upload_file") return `Upload ${artifact?.name || "selected file"} to the approved file input.`;
  if (tool === "download") return `Download ${args.filename || args.url}.`;
  return String(args.summary || `Commit ${tool}.`).slice(0, 2_000);
}

function publicArtifact(artifact) {
  return {
    id: artifact.id,
    name: artifact.name,
    size: artifact.size,
    threadId: artifact.threadId,
    taskId: artifact.taskId,
    registeredAt: artifact.registeredAt,
  };
}

function publicHistoryApproval(request) {
  return {
    id: request.id,
    status: request.status,
    profileId: request.profileId,
    query: request.arguments.query,
    maxResults: request.arguments.max_results || 20,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    approvedAt: request.approvedAt,
  };
}

function runtimeError(code, message, category, retryable, status) {
  const error = new Error(message);
  error.code = code;
  error.category = category;
  error.retryable = retryable;
  error.status = status;
  return error;
}
