import assert from "node:assert/strict";
import test from "node:test";

import {
  ClusterWorkflowRuntime,
  WORKFLOW_ROOT_ACCEPTANCE_CONTEXT_MAX_CHARS,
} from "../src/main/workflow/runtime.mjs";

function persistedActiveRun(overrides = {}) {
  return {
    protocolVersion: 1,
    id: "workflow_persisted",
    threadId: "thread_persisted",
    status: "accepting",
    sequence: 7,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:01:00.000Z",
    completedAt: null,
    error: null,
    nodes: [
      { id: "completed", status: "succeeded", completedAt: "2026-07-30T00:00:30.000Z" },
      { id: "root-acceptance", status: "running", retrying: true, completedAt: null },
    ],
    ...overrides,
  };
}

test("runtime startup safely terminalizes persisted runs that no longer have an execution owner", () => {
  let storedRun = persistedActiveRun();
  const savedEvents = [];
  const store = {
    nonTerminalRuns() {
      return [structuredClone(storedRun)];
    },
    save(run, event) {
      storedRun = structuredClone(run);
      savedEvents.push(structuredClone(event));
    },
    get() {
      return structuredClone(storedRun);
    },
    latestForThread() {
      return structuredClone(storedRun);
    },
  };

  const runtime = new ClusterWorkflowRuntime({ store });
  const recovered = runtime.latestForThread(storedRun.threadId);

  assert.equal(recovered.status, "failed");
  assert.equal(recovered.error.code, "WORKFLOW_PROCESS_INTERRUPTED");
  assert.equal(recovered.nodes[0].status, "succeeded");
  assert.equal(recovered.nodes[1].status, "cancelled");
  assert.equal(recovered.nodes[1].retrying, false);
  assert.ok(recovered.completedAt);
  assert.equal(savedEvents.at(-1).type, "run.interrupted");
  assert.equal(savedEvents.at(-1).sequence, 8);
});

test("cancel terminalizes a persisted-only active run instead of returning it unchanged", () => {
  let storedRun = persistedActiveRun({
    id: "workflow_persisted_cancel",
    threadId: "thread_persisted_cancel",
  });
  const savedEvents = [];
  const store = {
    nonTerminalRuns() {
      return [];
    },
    save(run, event) {
      storedRun = structuredClone(run);
      savedEvents.push(structuredClone(event));
    },
    get(runId) {
      return runId === storedRun.id ? structuredClone(storedRun) : null;
    },
    latestForThread() {
      return structuredClone(storedRun);
    },
  };

  const runtime = new ClusterWorkflowRuntime({ store });
  const cancelled = runtime.cancel(storedRun.id);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.nodes[0].status, "succeeded");
  assert.equal(cancelled.nodes[1].status, "cancelled");
  assert.ok(cancelled.completedAt);
  assert.equal(savedEvents.at(-1).type, "run.cancelled");
  assert.equal(store.get(storedRun.id).status, "cancelled");
});

test("a revision draft requires an existing historical run", () => {
  const store = {
    nonTerminalRuns() {
      return [];
    },
    get() {
      return null;
    },
    latestForThread() {
      return null;
    },
    latestDraftForThread() {
      return null;
    },
  };
  const runtime = new ClusterWorkflowRuntime({ store });
  assert.throws(
    () => runtime.createRevisionDraft({ runId: "missing-run", threadId: "thread-missing" }),
    /找不到可修改的历史工作流/,
  );
});

test("a late root-final completion cannot overwrite a cancelled workflow", async () => {
  let resolveFinal;
  let markFinalStarted;
  const finalStarted = new Promise((resolve) => {
    markFinalStarted = resolve;
  });
  const eventTypes = [];
  const runtime = new ClusterWorkflowRuntime({
    store: {
      save() {},
      get() { return null; },
      latestForThread() { return null; },
    },
    contextBroker: {
      async buildPackage() {
        return { id: "context_cancel_race", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "cancel race" },
          nodes: [{ id: "worker", provider: "claude", prompt: "work" }],
        }),
      };
    },
    async executeProvider() {
      return { text: "worker result" };
    },
    async executeRootFinal() {
      markFinalStarted();
      return new Promise((resolve) => {
        resolveFinal = resolve;
      });
    },
  });
  runtime.on("event", (event) => eventTypes.push(event.type));

  const initial = runtime.start({
    threadId: "thread_cancel_race",
    cwd: "D:/workspace",
    prompt: "cancel race",
  });
  await finalStarted;
  const cancelled = runtime.cancel(initial.id);
  resolveFinal({ text: "late success", turnId: "turn_late_success" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(cancelled.status, "cancelled");
  assert.equal(runtime.getRun(initial.id).status, "cancelled");
  assert.equal(eventTypes.includes("run.cancelled"), true);
  assert.equal(eventTypes.includes("run.succeeded"), false);
});

test("cluster runtime plans, executes model nodes, and requires root final acceptance", async () => {
  const saved = [];
  const providerCalls = [];
  const plannerCalls = [];
  const invitedProviders = [];
  let committedRun = null;
  let finalCalls = 0;
  const runtime = new ClusterWorkflowRuntime({
    store: { save(run, event) { saved.push({ run: structuredClone(run), event }); }, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_test", items: [{ path: "D:/workspace/brief.md", excerpt: "目标材料", sha256: "abc" }], manifest: [{ path: "D:/workspace/brief.md" }], totalChars: 4 };
      },
    },
    async planWithCodex(call) {
      plannerCalls.push(call);
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完成调研报告", successCriteria: ["有结论"] },
          rationale: "让两个模型独立分析",
          nodes: [
            { id: "research", title: "检索", provider: "perplexity", prompt: "核验事实", needsLocalContext: false },
            { id: "review", title: "评审", provider: "claude", prompt: "阅读材料", needsLocalContext: true },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call);
      assert.match(call.prompt, /<haolo_chat_summary>/);
      assert.match(call.prompt, /第一人称/);
      return {
        text: `${call.provider} result`,
        chatSummary: `我这边已经把 ${call.provider} 的关键结论梳理好了。`,
        provider: call.provider,
        model: call.model,
        confidence: 0.8,
      };
    },
    async executeRootFinal(call) {
      finalCalls += 1;
      assert.match(call.additionalContext, /perplexity result/);
      assert.match(call.additionalContext, /claude result/);
      assert.match(call.additionalContext, /我这边已经把 perplexity 的关键结论梳理好了/);
      assert.doesNotMatch(call.additionalContext, /executorHistory|capabilityGrant|childWorkflow/);
      return { text: "最终交付", turnId: "turn_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.invited") invitedProviders.push(event.payload.provider);
      if (event.type === "plan.committed") committedRun = event.run;
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  const initial = runtime.start({ threadId: "thread_1", cwd: "D:/workspace", prompt: "请做调研报告" });
  const run = await terminal;

  assert.equal(initial.status, "planning");
  assert.doesNotMatch(initial.nodes.map((node) => `${node.title} ${node.purpose}`).join(" "), /codex/i);
  assert.equal(initial.nodes[0].title, "Haolo 编排");
  assert.equal(run.status, "succeeded");
  assert.equal(run.finalTurnId, "turn_final");
  assert.deepEqual(plannerCalls[0].consumption, {
    phase: "canvas_create_plan",
    runId: run.id,
    rootThreadId: "thread_1",
  });
  assert.equal(providerCalls.length, 2);
  assert.match(
    run.nodes.find((node) => node.id === "research").result.output.summary,
    /^我这边已经把 perplexity/,
  );
  assert.deepEqual(invitedProviders, ["perplexity", "claude"]);
  assert.ok(committedRun?.planCommittedAt);
  assert.equal(committedRun.nodes.filter((node) => node.kind === "model").length, 2);
  assert.equal(finalCalls, 1);
  assert.ok(run.nodes.every((node) => node.status === "succeeded"));
  assert.ok(saved.length >= 5);
});

test("automatic workflows keep their existing non-fail-fast scheduling", async () => {
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "自动工作流结果" },
          complexityAssessment: { maxParallelModels: 2 },
          nodes: [
            { id: "failed-branch", provider: "claude", prompt: "fail" },
            { id: "healthy-branch", provider: "deepseek", prompt: "continue" },
            {
              id: "automatic-sink",
              provider: "claude",
              prompt: "finish",
              dependsOn: ["failed-branch", "healthy-branch"],
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call.nodeId);
      if (call.nodeId === "failed-branch") {
        return {
          status: "failed",
          error: { code: "AUTO_BRANCH_FAILED", message: "automatic branch failed", retryable: false },
        };
      }
      return { text: `${call.nodeId} result` };
    },
    async executeRootFinal() {
      return { text: "自动工作流由根节点完成最终处理。" };
    },
  });
  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });

  runtime.start({
    threadId: "thread_automatic_non_fail_fast",
    cwd: "D:/workspace",
    prompt: "运行自动工作流",
  });
  const run = await terminal;

  assert.equal(run.specId, null);
  assert.equal(run.metadata.workflowFailFast, undefined);
  assert.ok(providerCalls.includes("healthy-branch"));
  assert.ok(providerCalls.includes("automatic-sink"));
  assert.equal(run.nodes.find((node) => node.id === "automatic-sink").status, "succeeded");
});

test("root final acceptance treats partial and blocked envelopes as terminal failures", async () => {
  for (const status of ["partial", "blocked"]) {
    const runtime = new ClusterWorkflowRuntime({
      store: { save() {}, get() { return null; }, latestForThread() { return null; } },
      contextBroker: {
        async buildPackage() {
          return { id: `context_root_${status}`, items: [], manifest: [], totalChars: 0 };
        },
      },
      async planWithCodex() {
        return {
          text: JSON.stringify({
            goalContract: { deliverable: `root ${status}` },
            nodes: [{ id: "worker", provider: "claude", prompt: "work" }],
          }),
        };
      },
      async executeProvider() {
        return { text: "worker result" };
      },
      async executeRootFinal() {
        return { status, text: `${status} final result` };
      },
    });

    const terminal = new Promise((resolve) => {
      runtime.on("event", (event) => {
        if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
      });
    });
    runtime.start({
      threadId: `thread_root_${status}`,
      cwd: "D:/workspace",
      prompt: `root ${status}`,
    });
    const run = await terminal;

    assert.equal(run.status, "failed");
    assert.equal(run.finalResult.status, status);
    assert.equal(run.nodes.find((node) => node.id === "root-acceptance").status, "failed");
    assert.equal(Boolean(run.error?.code), true);
  }
});

test("root final acceptance retries a transient stream disconnect without rerunning completed nodes", async () => {
  let providerCalls = 0;
  const finalCalls = [];
  const retryEvents = [];
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_final_retry", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完成并交付任务" },
          nodes: [{ id: "builder", provider: "claude", prompt: "完成任务" }],
        }),
      };
    },
    async executeProvider() {
      providerCalls += 1;
      return { text: "已经完成的节点结果" };
    },
    async executeRootFinal(call) {
      finalCalls.push(call);
      if (finalCalls.length === 1) {
        return {
          status: "failed",
          error: "stream disconnected before completion: error sending request for url (https://aiapi.youleai.top/v1/responses)",
          effects: [],
          turnId: "turn_final_disconnected",
        };
      }
      assert.equal(call.attempt, 2);
      assert.equal(call.maxAttempts, 3);
      assert.match(call.previousAttemptError.message, /stream disconnected before completion/);
      return { text: "最终交付", turnId: "turn_final_recovered" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.retry.scheduled" && event.payload.nodeId === "root-acceptance") {
        retryEvents.push(event.payload);
      }
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread_final_stream_retry",
    cwd: "D:/workspace",
    prompt: "完成并交付任务",
  });
  const run = await terminal;
  const finalNode = run.nodes.find((node) => node.id === "root-acceptance");

  assert.equal(run.status, "succeeded");
  assert.equal(run.finalTurnId, "turn_final_recovered");
  assert.equal(providerCalls, 1);
  assert.equal(finalCalls.length, 2);
  assert.equal(retryEvents.length, 1);
  assert.deepEqual(
    [retryEvents[0].failedAttempt, retryEvents[0].nextAttempt, retryEvents[0].maxAttempts],
    [1, 2, 3],
  );
  assert.equal(finalNode.status, "succeeded");
  assert.equal(finalNode.totalAttempts, 2);
  assert.equal(finalNode.retrying, false);
  assert.equal(run.finalResult.diagnostics.attempts, 2);
});

test("root final acceptance does not blindly retry after a completed effect", async () => {
  let finalCalls = 0;
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_final_effect_guard", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完成并交付任务" },
          nodes: [{ id: "builder", provider: "claude", prompt: "完成任务" }],
        }),
      };
    },
    async executeProvider() {
      return { text: "已经完成的节点结果" };
    },
    async executeRootFinal() {
      finalCalls += 1;
      return {
        status: "failed",
        error: "stream disconnected before completion: connection reset",
        effects: [{
          id: "effect_file_change",
          type: "fileChange",
          status: "succeeded",
          summary: "已修改交付文件",
        }],
        turnId: "turn_final_effect_then_disconnect",
      };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread_final_effect_guard",
    cwd: "D:/workspace",
    prompt: "完成并交付任务",
  });
  const run = await terminal;

  assert.equal(run.status, "failed");
  assert.equal(finalCalls, 1);
  assert.equal(run.nodes.find((node) => node.id === "root-acceptance").totalAttempts, 1);
  assert.equal(run.finalResult.effects.length, 1);
});

test("cluster runtime rejects a second active workflow for the same thread", async () => {
  let releasePlan;
  const planGate = new Promise((resolve) => {
    releasePlan = resolve;
  });
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_overlap", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return planGate;
    },
    async executeProvider() {
      return { text: "节点完成" };
    },
    async executeRootFinal() {
      return { text: "最终交付" };
    },
  });
  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });

  runtime.start({ threadId: "thread-no-overlap", prompt: "执行第一项任务" });
  assert.throws(
    () => runtime.start({ threadId: "thread-no-overlap", prompt: "好了吗" }),
    /当前集群任务仍在执行/,
  );

  releasePlan({
    text: JSON.stringify({
      goalContract: { deliverable: "完成第一项任务" },
      nodes: [{ id: "work", provider: "claude", prompt: "完成任务" }],
    }),
  });
  const run = await terminal;
  assert.equal(run.status, "succeeded");
});

test("root final acceptance prefers summaries and bounds huge node output without losing its head and tail", async () => {
  let finalContext = "";
  const hugeOutput = `结果开头-${"中".repeat(320_000)}-结果结尾`;
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_bounded_final", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "输出有界终验结果" },
          nodes: [{ id: "large-result", provider: "claude", prompt: "生成大量研究结果" }],
        }),
      };
    },
    async executeProvider() {
      return {
        text: hugeOutput,
        chatSummary: "关键摘要：结论已经核验。",
        confidence: 0.9,
      };
    },
    async executeRootFinal(call) {
      finalContext = call.additionalContext;
      return { text: "最终交付", turnId: "turn_bounded_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread_bounded_final",
    cwd: "D:/workspace",
    prompt: "请完成终验",
  });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.ok(finalContext.length <= WORKFLOW_ROOT_ACCEPTANCE_CONTEXT_MAX_CHARS);
  assert.match(finalContext, /关键摘要：结论已经核验/);
  assert.match(finalContext, /结果开头-/);
  assert.match(finalContext, /-结果结尾/);
  assert.match(finalContext, /节点完整结果过长，已保留首尾/);
  assert.doesNotMatch(finalContext, /executorHistory|capabilityGrant|childWorkflow/);
});

test("cluster runtime freezes the original deliverable and executes after a contaminated planner response", async () => {
  const prompt = "请直接写出一篇完整短篇小说，拉 Doubao、Claude、Qwen 加入";
  let finalContext = "";
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_story", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: {
            deliverable: "一套多模型短篇小说工作流计划",
            successCriteria: ["最终成品适合扩写为完整短篇小说"],
            constraints: ["只做规划，不直接创作小说正文"],
            prohibitions: ["不得执行实际写作任务"],
          },
          nodes: [
            { id: "blueprint", title: "故事蓝图", provider: "claude", prompt: "只输出故事蓝图" },
          ],
          finalAcceptancePrompt: "检查整个计划只做规划、不执行小说正文创作。",
        }),
      };
    },
    async executeProvider() {
      return { text: "故事蓝图：人类最终借助善意 AI 获胜。" };
    },
    async executeRootFinal(call) {
      finalContext = call.additionalContext;
      return { text: "《最后的问题》\n\n城市在零点醒来，所有屏幕同时亮起。完整小说正文。", turnId: "turn_story_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_story_delivery", cwd: "D:/workspace", prompt });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(run.goalContract.deliverable, prompt);
  assert.doesNotMatch(JSON.stringify(run.goalContract), /只做规划|不得执行实际写作|适合扩写/);
  assert.match(finalContext, /原始用户请求（不可被规划器改写）/);
  assert.match(finalContext, /立即完成并交付最终成果/);
  assert.match(run.finalResult.output.text, /完整小说正文/);
});

test("cluster runtime never marks an unrequested plan-only final answer as succeeded", async () => {
  const runtime = new ClusterWorkflowRuntime({
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_final_guard", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "完整短篇小说" },
          nodes: [{ id: "writer", provider: "claude", prompt: "写小说" }],
        }),
      };
    },
    async executeProvider() {
      return { text: "可供成文的故事素材" };
    },
    async executeRootFinal() {
      return { text: "可以。我按“只做规划，不直接写正文”给你一份故事蓝图。", turnId: "turn_bad_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread_final_delivery_guard",
    cwd: "D:/workspace",
    prompt: "请直接写出完整短篇小说",
  });
  const run = await terminal;

  assert.equal(run.status, "failed");
  assert.equal(run.finalResult.error.code, "FINAL_DELIVERABLE_NOT_EXECUTED");
  assert.equal(run.finalResult.error.category, "validation");
  assert.equal(run.nodes.find((node) => node.id === "root-acceptance").status, "failed");
});

test("a node uses its second model choice after three failed connections and only then releases downstream", async () => {
  const providerCalls = [];
  const retryEvents = [];
  const switchEvents = [];
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_retry", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "retry workflow" },
          nodes: [
            { id: "recovers", title: "recovers", provider: "claude", prompt: "first" },
            {
              id: "fallback-recovers",
              title: "fallback recovers",
              provider: "qwen",
              model: "qwen3.7-max",
              executorCandidates: [
                { provider: "qwen", model: "qwen3.7-max" },
                { provider: "claude", model: "claude-sonnet-5" },
                { provider: "grok", model: "grok-4.5" },
              ],
              prompt: "second",
              dependsOn: ["recovers"],
            },
            { id: "downstream", title: "downstream", provider: "deepseek", prompt: "third", dependsOn: ["fallback-recovers"] },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(`${call.node.id}:${call.provider}:${call.attempt}`);
      if (call.node.id === "recovers" && call.attempt < 3) {
        if (call.attempt === 1) throw new Error("模型响应超时，请稍后重试");
        throw Object.assign(new Error("Upstream service temporarily unavailable"), { retryable: true });
      }
      if (call.node.id === "fallback-recovers" && call.provider === "qwen") {
        throw Object.assign(new Error("request timed out"), { code: "INVOCATION_TIMEOUT", retryable: true });
      }
      return { text: `${call.node.id} result` };
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_retry_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.retry.scheduled") retryEvents.push(event.payload);
      if (event.type === "node.executor.switched") switchEvents.push(event);
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_retry", cwd: "D:/workspace", prompt: "retry test" });
  const run = await terminal;

  assert.deepEqual(providerCalls, [
    "recovers:claude:1",
    "recovers:claude:2",
    "recovers:claude:3",
    "fallback-recovers:qwen:1",
    "fallback-recovers:qwen:2",
    "fallback-recovers:qwen:3",
    "fallback-recovers:claude:1",
    "downstream:deepseek:1",
  ]);
  assert.equal(retryEvents.length, 4);
  assert.deepEqual(retryEvents.map((event) => [event.failedAttempt, event.nextAttempt]), [[1, 2], [2, 3], [1, 2], [2, 3]]);
  assert.equal(run.nodes.find((node) => node.id === "recovers").status, "succeeded");
  assert.equal(run.nodes.find((node) => node.id === "recovers").result.diagnostics.attempts, 3);
  const fallbackNode = run.nodes.find((node) => node.id === "fallback-recovers");
  assert.equal(fallbackNode.status, "succeeded");
  assert.equal(fallbackNode.provider, "claude");
  assert.equal(fallbackNode.model, "claude-sonnet-5");
  assert.equal(fallbackNode.executorChoice, 2);
  assert.equal(fallbackNode.result.diagnostics.attempts, 4);
  assert.deepEqual(fallbackNode.executorHistory.map((entry) => [entry.provider, entry.status, entry.attempts]), [
    ["qwen", "failed", 3],
    ["claude", "succeeded", 1],
  ]);
  assert.equal(switchEvents.length, 1);
  assert.equal(switchEvents[0].payload.from.provider, "qwen");
  assert.equal(switchEvents[0].payload.to.provider, "claude");
  assert.equal(switchEvents[0].run.nodes.find((node) => node.id === "fallback-recovers").provider, "claude");
  assert.equal(switchEvents[0].run.nodes.find((node) => node.id === "downstream").status, "pending");
  assert.equal(run.nodes.find((node) => node.id === "downstream").status, "succeeded");
});

test("structured retry guidance controls backoff and remains visible in workflow events", async () => {
  const retryEvents = [];
  const progressEvents = [];
  let attempts = 0;
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_structured_retry", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "structured retry workflow" },
          nodes: [{ id: "writer", title: "writer", provider: "claude", prompt: "write" }],
        }),
      };
    },
    async executeProvider(call) {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("temporary routed failure"), {
          code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
          category: "remote",
          status: 502,
          retryable: true,
          retryAfterMs: 15,
          requestId: "cluster-request-retry",
          upstreamStatus: 503,
          routeExhausted: true,
        });
      }
      call.onProgress?.({ phase: "streaming", receivedChars: 9 });
      return { text: "recovered" };
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_structured_retry_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.retry.scheduled") retryEvents.push(event.payload);
      if (event.type === "node.progress") progressEvents.push(event.payload);
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_structured_retry", cwd: "D:/workspace", prompt: "structured retry test" });
  const run = await terminal;

  assert.equal(attempts, 2);
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].delayMs, 15);
  assert.equal(retryEvents[0].error.requestId, "cluster-request-retry");
  assert.equal(retryEvents[0].error.upstreamStatus, 503);
  assert.equal(retryEvents[0].error.routeExhausted, true);
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].receivedChars, 9);
  assert.equal(run.nodes.find((node) => node.id === "writer").result.diagnostics.attempts, 2);
});

test("a node advances only after all three model choices each exhaust three retryable attempts", async () => {
  const providerCalls = [];
  const switchEvents = [];
  const attemptIds = [];
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_exhaust", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "exhaust fallback workflow" },
          nodes: [
            {
              id: "exhausts",
              title: "exhausts",
              provider: "qwen",
              model: "qwen3.7-max",
              executorCandidates: [
                { provider: "qwen", model: "qwen3.7-max" },
                { provider: "claude", model: "claude-sonnet-5" },
                { provider: "grok", model: "grok-4.5" },
              ],
              prompt: "first",
            },
            { id: "downstream", title: "downstream", provider: "deepseek", prompt: "second", dependsOn: ["exhausts"] },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(`${call.node.id}:${call.provider}:${call.attempt}`);
      attemptIds.push(call.attemptId);
      if (call.node.id === "exhausts") {
        throw Object.assign(new Error("request timed out"), { code: "INVOCATION_TIMEOUT", retryable: true });
      }
      return { text: `${call.node.id} result` };
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_exhaust_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.executor.switched") switchEvents.push(event);
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_exhaust", cwd: "D:/workspace", prompt: "exhaust test" });
  const run = await terminal;

  assert.deepEqual(providerCalls, [
    "exhausts:qwen:1",
    "exhausts:qwen:2",
    "exhausts:qwen:3",
    "exhausts:claude:1",
    "exhausts:claude:2",
    "exhausts:claude:3",
    "exhausts:grok:1",
    "exhausts:grok:2",
    "exhausts:grok:3",
    "downstream:deepseek:1",
  ]);
  assert.equal(new Set(attemptIds).size, attemptIds.length);
  assert.equal(switchEvents.length, 2);
  const exhaustedNode = run.nodes.find((node) => node.id === "exhausts");
  assert.equal(exhaustedNode.status, "failed");
  assert.equal(exhaustedNode.provider, "grok");
  assert.equal(exhaustedNode.executorChoice, 3);
  assert.equal(exhaustedNode.result.diagnostics.attempts, 9);
  assert.deepEqual(exhaustedNode.executorHistory.map((entry) => [entry.provider, entry.status, entry.attempts]), [
    ["qwen", "failed", 3],
    ["claude", "failed", 3],
    ["grok", "failed", 3],
  ]);
  assert.equal(run.nodes.find((node) => node.id === "downstream").status, "succeeded");
});

test("critical nodes run at most two models in parallel and continue only after independent review", async () => {
  const callOrder = [];
  let activeCalls = 0;
  let maxActiveCalls = 0;
  let reviewCompleted = false;
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_parallel_review", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "robust workflow" },
          complexityAssessment: {
            level: "complex",
            score: 5,
            rationale: "关键结论需要两个独立视角",
            factors: ["高不确定性"],
          },
          nodes: [
            {
              id: "candidate-a",
              title: "candidate a",
              provider: "claude",
              prompt: "independent a",
              coordination: { mode: "parallel_candidate", parallelGroup: "critical" },
            },
            {
              id: "candidate-b",
              title: "candidate b",
              provider: "qwen",
              prompt: "independent b",
              coordination: { mode: "parallel_candidate", parallelGroup: "critical" },
            },
            {
              id: "review",
              title: "independent review",
              provider: "deepseek",
              prompt: "compare both",
              dependsOn: ["candidate-a", "candidate-b"],
              coordination: {
                mode: "review_gate",
                parallelGroup: "critical",
                reviewTargets: ["candidate-a", "candidate-b"],
              },
            },
            {
              id: "continue",
              title: "continue",
              provider: "kimi",
              prompt: "continue after review",
              dependsOn: ["candidate-a"],
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      callOrder.push(`start:${call.node.id}`);
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      try {
        if (call.node.id.startsWith("candidate-")) {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        if (call.node.id === "review") {
          assert.match(call.prompt, /candidate-a result/);
          assert.match(call.prompt, /candidate-b result/);
          assert.match(call.prompt, /独立审核门/);
        }
        if (call.node.id === "continue") {
          assert.equal(reviewCompleted, true);
          assert.match(call.prompt, /review result/);
        }
        return {
          text: `${call.node.id} result`,
          provider: call.provider,
          model: call.model,
        };
      } finally {
        activeCalls -= 1;
        if (call.node.id === "review") reviewCompleted = true;
        callOrder.push(`finish:${call.node.id}`);
      }
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_parallel_review_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_parallel_review", cwd: "D:/workspace", prompt: "parallel review test" });
  const run = await terminal;

  assert.equal(run.status, "succeeded");
  assert.equal(maxActiveCalls, 2);
  assert.equal(run.complexityAssessment.strategy, "parallel_review");
  assert.ok(callOrder.indexOf("start:candidate-a") < callOrder.indexOf("finish:candidate-b"));
  assert.ok(callOrder.indexOf("start:candidate-b") < callOrder.indexOf("finish:candidate-a"));
  assert.ok(callOrder.indexOf("start:review") > callOrder.indexOf("finish:candidate-a"));
  assert.ok(callOrder.indexOf("start:review") > callOrder.indexOf("finish:candidate-b"));
  assert.ok(callOrder.indexOf("start:continue") > callOrder.indexOf("finish:review"));
  assert.deepEqual(run.nodes.find((node) => node.id === "continue").dependsOn.slice(-1), ["review"]);
  assert.equal(run.nodes.some((node) => node.coordination?.mode === "parallel_rescue"), false);
  assert.equal(run.metadata.parallelRescueGroups.critical.dispatched, false);
});

test("an explicit request runs three model candidates in parallel even when the planner returns two", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  let capturedPlannerPrompt = "";
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_explicit_three", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex(call) {
      capturedPlannerPrompt = call.prompt;
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "three-way research" },
          nodes: [
            {
              id: "candidate-a",
              provider: "claude",
              prompt: "independent a",
              coordination: { mode: "parallel_candidate", parallelGroup: "research" },
            },
            {
              id: "candidate-b",
              provider: "qwen",
              prompt: "independent b",
              coordination: { mode: "parallel_candidate", parallelGroup: "research" },
            },
            {
              id: "review",
              provider: "deepseek",
              prompt: "review all candidates",
              coordination: {
                mode: "review_gate",
                parallelGroup: "research",
                reviewTargets: ["candidate-a", "candidate-b"],
              },
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      try {
        if (call.node.coordination?.mode === "parallel_candidate") {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        if (call.node.coordination?.mode === "review_gate") {
          assert.equal(call.node.coordination.reviewTargets.length, 3);
          assert.equal(call.node.dependsOn.length, 3);
        }
        return { text: `${call.node.id} result`, provider: call.provider, model: call.model };
      } finally {
        activeCalls -= 1;
      }
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_explicit_three_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({
    threadId: "thread_explicit_three",
    cwd: "D:/workspace",
    prompt: "帮我派出3个并行的模型完成调研",
  });
  const run = await terminal;
  const candidates = run.nodes.filter((node) => node.coordination?.mode === "parallel_candidate");

  assert.equal(run.status, "succeeded");
  assert.match(capturedPlannerPrompt, /用户已明确要求 3 个并行模型/);
  assert.equal(candidates.length, 3);
  assert.equal(run.complexityAssessment.maxParallelModels, 3);
  assert.equal(maxActiveCalls, 3);
  assert.equal(run.nodes.some((node) => node.coordination?.mode === "parallel_rescue"), false);
});

test("one timed-out parallel node does not dispatch a third model", async () => {
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_one_timeout", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "one timeout workflow" },
          nodes: [
            {
              id: "left",
              provider: "claude",
              prompt: "left",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "right",
              provider: "qwen",
              prompt: "right",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "review",
              provider: "deepseek",
              prompt: "review",
              coordination: {
                mode: "review_gate",
                parallelGroup: "gate",
                reviewTargets: ["left", "right"],
              },
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(`${call.node.id}:${call.provider}:${call.attempt}`);
      if (call.node.id === "left") {
        throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT", retryable: true });
      }
      return { text: `${call.node.id} result`, provider: call.provider, model: call.model };
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_one_timeout_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_one_timeout", cwd: "D:/workspace", prompt: "one timeout test" });
  const run = await terminal;

  assert.deepEqual(providerCalls.filter((call) => call.startsWith("left:")), [
    "left:claude:1",
    "left:claude:2",
    "left:claude:3",
  ]);
  assert.equal(providerCalls.filter((call) => call.startsWith("right:")).length, 1);
  assert.equal(providerCalls.some((call) => call.includes("timeout-rescue")), false);
  assert.equal(run.nodes.some((node) => node.coordination?.mode === "parallel_rescue"), false);
  assert.equal(run.metadata.parallelRescueGroups.gate.dispatched, false);
  assert.equal(run.nodes.find((node) => node.id === "left").parallelTimeoutExhausted, true);
  assert.equal(run.nodes.find((node) => node.id === "review").status, "succeeded");
});

test("only two parallel nodes each exhausting three connection timeouts dispatch one third model", async () => {
  const providerCalls = [];
  const invitedRescues = [];
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_double_timeout", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "double timeout workflow" },
          nodes: [
            {
              id: "left",
              provider: "claude",
              prompt: "left",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "right",
              provider: "qwen",
              prompt: "right",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "review",
              provider: "deepseek",
              prompt: "review",
              coordination: {
                mode: "review_gate",
                parallelGroup: "gate",
                reviewTargets: ["left", "right"],
              },
            },
            { id: "downstream", provider: "doubao", prompt: "continue", dependsOn: ["review"] },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(`${call.node.id}:${call.provider}:${call.attempt}`);
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      try {
        if (call.node.id === "left" || call.node.id === "right") {
          await new Promise((resolve) => setTimeout(resolve, 1));
          throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT", retryable: true });
        }
        if (call.node.coordination?.mode === "parallel_rescue") {
          assert.match(call.prompt, /两路主节点都已各自耗尽 3 次连接超时/);
        }
        if (call.node.id === "review") {
          assert.equal(call.node.coordination.reviewTargets.length, 3);
          assert.match(call.prompt, /timeout-rescue result/);
        }
        return { text: `${call.node.id} result`, provider: call.provider, model: call.model };
      } finally {
        activeCalls -= 1;
      }
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_double_timeout_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "node.invited" && event.payload.reason === "parallel_group_timeout_rescue") {
        invitedRescues.push(event.payload);
      }
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_double_timeout", cwd: "D:/workspace", prompt: "double timeout test" });
  const run = await terminal;

  assert.equal(providerCalls.filter((call) => call.startsWith("left:claude:")).length, 3);
  assert.equal(providerCalls.filter((call) => call.startsWith("right:qwen:")).length, 3);
  const rescue = run.nodes.find((node) => node.coordination?.mode === "parallel_rescue");
  assert.ok(rescue);
  assert.equal(providerCalls.filter((call) => call.startsWith(`${rescue.id}:`)).length, 1);
  assert.equal(invitedRescues.length, 1);
  assert.equal(run.metadata.parallelRescueGroups.gate.dispatched, true);
  assert.equal(run.metadata.parallelRescueGroups.gate.nodeId, rescue.id);
  assert.equal(run.nodes.find((node) => node.id === "review").coordination.reviewTargets.includes(rescue.id), true);
  assert.equal(run.nodes.find((node) => node.id === "review").dependsOn.includes(rescue.id), true);
  assert.equal(maxActiveCalls, 2);
});

test("three retryable failures do not trigger the third model unless every failure was a connection timeout", async () => {
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_mixed_failures", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "mixed failure workflow" },
          nodes: [
            {
              id: "left",
              provider: "claude",
              prompt: "left",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "right",
              provider: "qwen",
              prompt: "right",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "review",
              provider: "deepseek",
              prompt: "review",
              coordination: {
                mode: "review_gate",
                parallelGroup: "gate",
                reviewTargets: ["left", "right"],
              },
            },
          ],
        }),
      };
    },
    async executeProvider(call) {
      if (call.node.id === "right" && call.attempt === 1) {
        throw Object.assign(new Error("rate limit"), { status: 429, retryable: true });
      }
      if (call.node.id === "left" || call.node.id === "right") {
        throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT", retryable: true });
      }
      return { text: `${call.node.id} result`, provider: call.provider, model: call.model };
    },
    async executeRootFinal() {
      return { text: "final", turnId: "turn_mixed_failures_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_mixed_failures", cwd: "D:/workspace", prompt: "mixed failures test" });
  const run = await terminal;

  assert.equal(run.nodes.find((node) => node.id === "left").parallelTimeoutFailures, 3);
  assert.equal(run.nodes.find((node) => node.id === "right").parallelTimeoutFailures, 2);
  assert.equal(run.nodes.find((node) => node.id === "right").parallelTimeoutExhausted, false);
  assert.equal(run.nodes.some((node) => node.coordination?.mode === "parallel_rescue"), false);
  assert.equal(run.metadata.parallelRescueGroups.gate.dispatched, false);
});

test("a failed independent review gate blocks its downstream branch", async () => {
  const providerCalls = [];
  const runtime = new ClusterWorkflowRuntime({
    retryDelayMs: 0,
    store: { save() {}, get() { return null; }, latestForThread() { return null; } },
    contextBroker: {
      async buildPackage() {
        return { id: "context_review_failure", items: [], manifest: [], totalChars: 0 };
      },
    },
    async planWithCodex() {
      return {
        text: JSON.stringify({
          goalContract: { deliverable: "review failure workflow" },
          nodes: [
            {
              id: "left",
              provider: "claude",
              prompt: "left",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "right",
              provider: "qwen",
              prompt: "right",
              coordination: { mode: "parallel_candidate", parallelGroup: "gate" },
            },
            {
              id: "review",
              provider: "deepseek",
              prompt: "review",
              coordination: {
                mode: "review_gate",
                parallelGroup: "gate",
                reviewTargets: ["left", "right"],
              },
            },
            { id: "downstream", provider: "kimi", prompt: "must not run", dependsOn: ["review"] },
          ],
        }),
      };
    },
    async executeProvider(call) {
      providerCalls.push(call.node.id);
      if (call.node.id === "review") throw Object.assign(new Error("invalid reviewer response"), { retryable: false });
      return { text: `${call.node.id} result`, provider: call.provider, model: call.model };
    },
    async executeRootFinal() {
      return { text: "partial final", turnId: "turn_review_failure_final" };
    },
  });

  const terminal = new Promise((resolve) => {
    runtime.on("event", (event) => {
      if (event.type === "run.succeeded" || event.type === "run.failed") resolve(event.run);
    });
  });
  runtime.start({ threadId: "thread_review_failure", cwd: "D:/workspace", prompt: "review failure test" });
  const run = await terminal;

  assert.equal(providerCalls.filter((nodeId) => nodeId === "review").length, 3);
  assert.equal(providerCalls.includes("downstream"), false);
  const downstream = run.nodes.find((node) => node.id === "downstream");
  assert.equal(downstream.status, "skipped");
  assert.equal(downstream.blockedByReviewGate, true);
  assert.equal(downstream.result.error.code, "REVIEW_GATE_FAILED");
});
