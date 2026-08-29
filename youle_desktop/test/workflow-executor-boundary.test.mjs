import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKFLOW_EXECUTOR_TYPES,
  WorkflowExecutorGateway,
  callbackExecutorAdapter,
  issueWorkflowNodeCapabilityGrant,
  sandboxPolicyForCapabilityGrant,
} from "../src/main/workflow/executor-boundary.mjs";
import {
  CLUSTER_MODEL_REGISTRY,
  workflowExecutorRegistry,
} from "../src/main/workflow/model-registry.mjs";
import { normalizeWorkflowPlan } from "../src/main/workflow/protocol.mjs";
import { ClusterWorkflowRuntime } from "../src/main/workflow/runtime.mjs";

test("planner nodes explicitly normalize to external models or Codex subAgents", () => {
  const registry = workflowExecutorRegistry(CLUSTER_MODEL_REGISTRY);
  const executableAgent = registry.find((entry) => entry.executorType === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT);
  const plan = normalizeWorkflowPlan({
    nodes: [
      {
        id: "analyze",
        executorType: "external_model",
        provider: "claude",
        prompt: "分析修改方案",
      },
      {
        id: "implement",
        executorType: "codex_subagent",
        prompt: "修改代码并运行测试",
        dependsOn: ["analyze"],
        capabilityRequest: {
          permissionProfile: "workspace_write",
          capabilities: ["filesystem.read", "filesystem.update", "command.execute"],
          actions: ["read", "update", "execute"],
          sideEffectPolicy: "reversible",
          delegation: true,
          rationale: "需要在当前项目内实现并验证",
        },
      },
    ],
  }, registry);

  const external = plan.nodes.find((node) => node.id === "analyze");
  const agent = plan.nodes.find((node) => node.id === "implement");
  assert.equal(external.kind, "model");
  assert.equal(external.executorType, WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL);
  assert.equal(agent.kind, "agent");
  assert.equal(agent.executorType, WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT);
  assert.equal(agent.provider, "haolo-codex-agent");
  assert.equal(executableAgent.name, "Haolo 子 Agent");
  assert.doesNotMatch(executableAgent.name, /Codex/i);
  assert.equal(agent.executorCandidates.length, 1);
  assert.equal(agent.capabilityRequest.permissionProfile, "workspace_write");
  assert.equal(agent.capabilityRequest.delegation, false, "a worker cannot grant itself delegation");
  assert.deepEqual(agent.coordination, {
    mode: "solo",
    parallelGroup: null,
    reviewTargets: [],
  });
});

test("ExecutorGateway dispatches only with a matching root-issued CapabilityGrant", async () => {
  const calls = [];
  const gateway = new WorkflowExecutorGateway([
    callbackExecutorAdapter(WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT, async (task) => {
      calls.push(task);
      return { status: "succeeded", text: "done" };
    }),
  ]);
  const run = { id: "workflow-1", cwd: "D:/workspace" };
  const node = {
    id: "implement",
    executorType: WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT,
    capabilityRequest: {
      permissionProfile: "workspace_write",
      capabilities: ["filesystem.update", "command.execute"],
      actions: ["update", "execute"],
      sideEffectPolicy: "reversible",
    },
  };
  const grant = issueWorkflowNodeCapabilityGrant({
    run,
    node,
    taskId: "task-1",
    attemptId: "attempt-1",
  });

  assert.equal(grant.issuedBy, "root-codex");
  assert.equal(grant.resources.allowImplicitGlobalContext, false);
  assert.equal(grant.delegation.allowed, false);
  assert.equal(sandboxPolicyForCapabilityGrant(grant), "workspace-write");

  await gateway.invoke({
    runId: run.id,
    nodeId: node.id,
    taskId: "task-1",
    executorType: node.executorType,
    capabilityGrant: grant,
  });
  assert.equal(calls.length, 1);

  await assert.rejects(
    gateway.invoke({
      runId: run.id,
      nodeId: "another-node",
      taskId: "task-1",
      executorType: node.executorType,
      capabilityGrant: grant,
    }),
    (error) => error?.code === "CAPABILITY_GRANT_INVALID",
  );
});

test("mixed workflows hand reviewed model output to one authorized Codex subAgent", async () => {
  const externalCalls = [];
  const agentCalls = [];
  let finalContext = "";
  const runtime = new ClusterWorkflowRuntime({
    registry: workflowExecutorRegistry(CLUSTER_MODEL_REGISTRY),
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        throw new Error("Codex subAgent should use its direct grant rather than a ContextPackage.");
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: {
            deliverable: "修改项目并验证",
            successCriteria: ["测试通过"],
          },
          nodes: [
            {
              id: "analysis",
              executorType: "external_model",
              provider: "claude",
              prompt: "给出修改方案",
            },
            {
              id: "implementation",
              executorType: "codex_subagent",
              prompt: "根据上游方案修改项目并运行测试",
              dependsOn: ["analysis"],
              contextSelection: {
                needsLocalFiles: true,
                scope: ["current_group"],
                rationale: "需要直接修改当前项目",
              },
              capabilityRequest: {
                permissionProfile: "workspace_write",
                capabilities: ["filesystem.read", "filesystem.update", "command.execute"],
                actions: ["read", "update", "execute"],
                sideEffectPolicy: "reversible",
              },
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      externalCalls.push(call);
      return { text: "建议修改 runtime 并增加测试", provider: call.provider, model: call.model };
    },
    async executeSubAgent(call) {
      agentCalls.push(call);
      assert.match(call.prompt, /CapabilityGrant/);
      assert.match(call.prompt, /建议修改 runtime 并增加测试/);
      assert.equal(call.capabilityGrant.issuedBy, "root-codex");
      assert.equal(call.capabilityGrant.permissionProfile, "workspace_write");
      call.onProgress({
        stepId: "change-1",
        stage: "fileChange",
        title: "修改文件",
        detail: "src/runtime.mjs",
        status: "succeeded",
        phase: "completed",
      });
      return {
        text: "已修改并验证",
        executorType: "codex_subagent",
        effects: [{ type: "fileChange", paths: ["D:/workspace/src/runtime.mjs"] }],
      };
    },
    async executeRootFinal(call) {
      finalContext = call.additionalContext;
      return { text: "修改与验证已完成", turnId: "turn-final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread-mixed",
    cwd: "D:/workspace",
    prompt: "修改项目并验证",
  });
  const run = await terminal;
  const agent = run.nodes.find((node) => node.id === "implementation");

  assert.equal(run.status, "succeeded");
  assert.equal(externalCalls.length, 1);
  assert.equal(agentCalls.length, 1);
  assert.equal(agent.kind, "agent");
  assert.equal(agent.maxAttempts, 1);
  assert.equal(agent.capabilityGrant.issuedBy, "root-codex");
  assert.equal(agent.childWorkflow.status, "succeeded");
  assert.equal(agent.childWorkflow.steps[0].title, "修改文件");
  assert.match(finalContext, /codex_subagent/);
  assert.match(finalContext, /fileChange/);
});

test("desktop Codex subAgent uses an ephemeral isolated session without implicit group memory", async () => {
  const source = await readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function executeClusterCodexSubAgentNode");
  const end = source.indexOf("async function runWorkflowCodexNodeTurnWithRecovery", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  const recoveryEnd = source.indexOf("function scheduleWorkflowInternalCodexCleanup", end);
  const recoveryBlock = source.slice(end, recoveryEnd);

  assert.match(block, /sandboxPolicyForCapabilityGrant\(capabilityGrant\)/);
  assert.match(block, /ephemeral:\s*true/);
  assert.match(block, /approvalPolicy:\s*"never"/);
  assert.match(block, /let executionPrompt = String\(prompt \|\| ""\)/);
  assert.match(block, /publishWorkflowMediaReferences\(attachments/);
  assert.match(block, /appendWorkflowMediaReferencesToPrompt\(executionPrompt, mediaReferences\)/);
  assert.match(block, /initialPrompt:\s*executionPrompt/);
  assert.match(recoveryBlock, /input:\s*\[\{ type: "text", text: nextPrompt/);
  assert.match(recoveryBlock, /buildAutomaticTurnRecoveryPrompt/);
  assert.match(recoveryBlock, /same isolated workflow worker in the same internal thread/);
  assert.doesNotMatch(block, /buildTurnInputWithGroupMemory/);
  assert.doesNotMatch(recoveryBlock, /buildTurnInputWithGroupMemory/);
  assert.match(block, /Do not use conversation memory or implicit global context/);
  assert.match(block, /title:\s*"启动 Haolo 子 Agent"/);
  assert.match(recoveryBlock, /"Haolo 子 Agent 已接管节点"/);
  assert.match(block, /workflowEffectFailureEnvelope\(effects\)/);
  assert.match(block, /status:\s*"failed"/);
  assert.doesNotMatch(block, /title:\s*"[^"]*Codex/i);
});
