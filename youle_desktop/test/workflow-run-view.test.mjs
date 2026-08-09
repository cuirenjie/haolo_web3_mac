import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadWorkflowRunViewModule() {
  const source = await readFile(new URL("../src/renderer/workflow-run-view.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const workflowRunViewModule = loadWorkflowRunViewModule();

function node(overrides = {}) {
  return {
    id: "node",
    kind: "model",
    title: "节点",
    purpose: "完成当前任务",
    provider: "qwen",
    model: "qwen3.7-max",
    prompt: "请给出高质量结果",
    dependsOn: [],
    status: "pending",
    startedAt: null,
    completedAt: null,
    result: null,
    ...overrides,
  };
}

test("workflow relay turns real node snapshots into simple group-chat messages", async () => {
  const { workflowRelayEntries, renderWorkflowRelayBubble } = await workflowRunViewModule;
  const run = {
    id: "workflow-relay",
    threadId: "thread-relay",
    status: "running",
    planCommittedAt: "2026-07-23T08:00:03.000Z",
    nodes: [
      node({
        id: "root-plan",
        kind: "root",
        title: "Haolo 编排",
        provider: "codex",
        model: null,
        status: "succeeded",
        completedAt: "2026-07-23T08:00:01.000Z",
        result: { output: { text: "已建立故事创作与技术审校的执行图。" } },
      }),
      node({
        id: "local-context",
        kind: "context",
        title: "本地材料",
        provider: null,
        model: null,
        dependsOn: ["root-plan"],
        status: "succeeded",
        completedAt: "2026-07-23T08:00:02.000Z",
        result: { output: { text: "已读取 8 份相关材料。" } },
      }),
      node({
        id: "story",
        title: "故事架构与伏笔设计",
        provider: "qwen",
        model: "qwen3.7-max",
        dependsOn: ["root-plan", "local-context"],
        status: "succeeded",
        completedAt: "2026-07-23T08:00:05.000Z",
        result: {
          output: {
            text: "## 故事蓝图\n这里保存完整的世界观、人物弧线与伏笔正文，供下游节点继续使用。",
            summary: "我这边先把世界观和人物弧线理顺了，三处关键伏笔也已经埋好，可以接着做逻辑审校。",
          },
        },
      }),
      node({
        id: "logic-review",
        title: "技术逻辑与剧情审校",
        purpose: "挑战故事架构中的漏洞并提出修正方案",
        prompt: "检查 AI 对抗机制、人物动机和结局闭环。",
        provider: "grok",
        model: "grok-4.5",
        dependsOn: ["root-plan", "local-context", "story"],
        status: "running",
        startedAt: "2026-07-23T08:00:06.000Z",
      }),
      node({
        id: "root-acceptance",
        kind: "root",
        title: "终验与交付",
        provider: "codex",
        model: null,
        dependsOn: ["logic-review"],
      }),
    ],
  };

  const entries = workflowRelayEntries(run);
  const story = entries.find((entry) => entry.nodeId === "story");
  const review = entries.find((entry) => entry.nodeId === "logic-review");

  assert.ok(story);
  assert.equal(story.statusLabel, "已完成");
  assert.match(story.summary, /^我这边/);
  assert.match(story.summary, /三处关键伏笔/);
  assert.doesNotMatch(story.summary, /## 故事蓝图|完整的世界观/);
  assert.deepEqual(story.handoffTargets.map((target) => target.mention), ["Grok"]);
  assert.match(story.handoffTargets[0].instruction, /挑战故事架构/);
  assert.ok(review);
  assert.equal(review.active, true);
  assert.equal(review.statusLabel, "执行中");
  assert.match(review.task, /挑战故事架构/);
  assert.match(review.promptPreview, /AI 对抗机制/);

  const markup = renderWorkflowRelayBubble(story);
  assert.match(markup, /workflow-relay-chat-bubble succeeded settled/);
  assert.match(markup, /我这边先把世界观和人物弧线理顺了/);
  assert.match(markup, /@Grok/);
  assert.match(markup, /接下来麻烦你挑战故事架构中的漏洞并提出修正方案/);
  assert.doesNotMatch(markup, /workflow-relay-header|workflow-relay-detail|data-action=/);
  const activeMarkup = renderWorkflowRelayBubble(review);
  assert.match(activeMarkup, /收到，这部分我来/);
  assert.match(activeMarkup, /整理好就跟大家同步/);
});

test("Haolo inserts restrained coordinator progress reports while more model nodes remain", async () => {
  const { workflowRelayEntries, renderWorkflowRelayBubble } = await workflowRunViewModule;
  const commonDependencies = ["root-plan", "local-context"];
  const run = {
    id: "workflow-coordinator",
    threadId: "thread-coordinator",
    status: "running",
    planCommittedAt: "2026-07-23T08:00:03.000Z",
    nodes: [
      node({ id: "root-plan", kind: "root", title: "Haolo 编排", status: "succeeded", completedAt: "2026-07-23T08:00:01.000Z" }),
      node({ id: "local-context", kind: "context", title: "本地材料", status: "succeeded", completedAt: "2026-07-23T08:00:02.000Z" }),
      node({ id: "model-1", title: "世界观设计", dependsOn: commonDependencies, status: "succeeded", completedAt: "2026-07-23T08:00:04.000Z" }),
      node({ id: "model-2", title: "人物弧线", provider: "claude", model: "claude-sonnet-5", dependsOn: commonDependencies, status: "succeeded", completedAt: "2026-07-23T08:00:05.000Z" }),
      node({ id: "model-3", title: "逻辑审校", provider: "grok", model: "grok-4.5", dependsOn: commonDependencies, status: "running", startedAt: "2026-07-23T08:00:03.500Z" }),
      node({ id: "model-4", title: "完整创作", provider: "qwen", model: "qwen3.7-max", dependsOn: ["model-3"], status: "pending" }),
      node({ id: "root-acceptance", kind: "root", title: "终验与交付", dependsOn: ["model-1", "model-2", "model-4"] }),
    ],
  };

  const entries = workflowRelayEntries(run);
  const coordinatorUpdates = entries.filter((entry) => entry.coordinatorUpdate);

  assert.equal(coordinatorUpdates.length, 1);
  assert.equal(coordinatorUpdates[0].nodeTitle, "Haolo 主编排");
  assert.equal(coordinatorUpdates[0].statusLabel, "进展同步");
  assert.match(coordinatorUpdates[0].summary, /2\/4 位伙伴/);
  assert.match(coordinatorUpdates[0].summary, /我已经把关键结论放进统一上下文/);
  assert.deepEqual(coordinatorUpdates[0].handoffTargets.map((target) => target.mention), ["Grok", "Qwen"]);
  assert.match(renderWorkflowRelayBubble(coordinatorUpdates[0]), /workflow-relay-chat-bubble succeeded settled coordinator/);
  assert.doesNotMatch(renderWorkflowRelayBubble(coordinatorUpdates[0]), /查看编排依据|workflow-relay-status/);
});

test("a failed model candidate speaks for itself before another partner takes over", async () => {
  const { workflowRelayEntries, renderWorkflowRelayBubble } = await workflowRunViewModule;
  const run = {
    id: "workflow-failed-candidate",
    threadId: "thread-failed-candidate",
    status: "running",
    nodes: [
      node({
        id: "root-plan",
        kind: "root",
        title: "Haolo 编排",
        status: "succeeded",
        completedAt: "2026-07-23T08:00:01.000Z",
      }),
      node({
        id: "draft",
        title: "完成中文科幻短篇",
        purpose: "把故事架构转化为完整小说",
        provider: "gemini",
        model: "gemini-3.5-flash",
        status: "running",
        startedAt: "2026-07-23T08:00:02.000Z",
        executorChoice: 2,
        maxExecutorChoices: 3,
        executorHistory: [
          {
            executorChoice: 1,
            provider: "qwen",
            model: "qwen3.7-max",
            status: "failed",
            attempts: 3,
            error: { message: "模型响应超时", retryable: true },
            completedAt: "2026-07-23T08:00:05.000Z",
          },
        ],
      }),
    ],
  };

  const entries = workflowRelayEntries(run);
  const failed = entries.find((entry) => entry.nodeId === "draft::executor-failed:1");
  const replacement = entries.find((entry) => entry.nodeId === "draft");

  assert.ok(failed);
  assert.equal(failed.provider, "qwen");
  assert.equal(failed.model, "qwen3.7-max");
  assert.equal(failed.status, "failed");
  assert.equal(failed.statusLabel, "暂时无法协作");
  assert.equal(failed.active, false);
  assert.equal(failed.coordinatorUpdate, false);
  assert.ok(replacement);
  assert.equal(replacement.provider, "gemini");
  assert.equal(replacement.active, true);

  const markup = renderWorkflowRelayBubble(failed);
  assert.match(markup, /workflow-relay-chat-bubble failed settled/);
  assert.match(markup, /不好意思，我现在有事……可以找另一位伙伴协作。/);
  assert.doesNotMatch(markup, /模型响应超时|完成中文科幻短篇.*没能完成/);
});

test("only the final dependency gate hands the collected results back to Haolo", async () => {
  const { workflowRelayEntries } = await workflowRunViewModule;
  const run = {
    id: "workflow-final-gate",
    threadId: "thread-final-gate",
    status: "accepting",
    nodes: [
      node({
        id: "draft",
        title: "初稿",
        status: "succeeded",
        completedAt: "2026-07-23T08:00:04.000Z",
        result: { output: { text: "初稿完成" } },
      }),
      node({
        id: "review",
        title: "审校",
        provider: "grok",
        model: "grok-4.5",
        status: "succeeded",
        completedAt: "2026-07-23T08:00:05.000Z",
        result: { output: { text: "审校完成" } },
      }),
      node({
        id: "root-acceptance",
        kind: "root",
        title: "终验与交付",
        purpose: "统一核验所有节点结果",
        provider: "codex",
        model: null,
        dependsOn: ["draft", "review"],
        status: "running",
        startedAt: "2026-07-23T08:00:06.000Z",
      }),
    ],
  };

  const entries = workflowRelayEntries(run);
  const draft = entries.find((entry) => entry.nodeId === "draft");
  const review = entries.find((entry) => entry.nodeId === "review");
  const acceptance = entries.find((entry) => entry.nodeId === "root-acceptance");

  assert.equal(draft.handoffTargets.length, 0);
  assert.match(draft.handoffNote, /@Haolo 我先把结论交回来/);
  assert.deepEqual(review.handoffTargets.map((target) => target.mention), ["Haolo"]);
  assert.equal(acceptance.active, true);
  assert.equal(acceptance.statusLabel, "终验中");
});

test("workflow relay markup escapes model output and prompt content", async () => {
  const { renderWorkflowRelayBubble } = await workflowRunViewModule;
  const markup = renderWorkflowRelayBubble({
    id: "relay-safe",
    threadId: "thread-safe",
    runId: "run-safe",
    nodeId: "node-safe",
    nodeKind: "model",
    nodeTitle: "<img src=x onerror=alert(1)>",
    provider: "qwen",
    model: "qwen<script>",
    status: "succeeded",
    statusLabel: "已完成",
    summary: "<script>alert(1)</script>",
    task: "",
    promptPreview: "",
    handoffTargets: [],
    handoffNote: "结果已回传 @Haolo",
    time: "",
    active: false,
    coordinatorUpdate: false,
    hasFollowingEntry: false,
  });

  assert.doesNotMatch(markup, /<script>|<img src=x/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /onerror=alert/);
});

test("legacy model results never expose their original body in the group-chat bubble", async () => {
  const { workflowRelayEntries, renderWorkflowRelayBubble } = await workflowRunViewModule;
  const original = "## 技术审校原文\n漏洞一：这里是一整段只应留在节点详情和下游上下文里的原文。".repeat(12);
  const run = {
    id: "workflow-legacy-summary",
    threadId: "thread-legacy-summary",
    status: "running",
    nodes: [
      node({
        id: "review",
        title: "技术逻辑审校",
        purpose: "检查故事中的技术漏洞",
        status: "succeeded",
        completedAt: "2026-07-23T08:00:05.000Z",
        result: { output: { text: original } },
      }),
    ],
  };

  const review = workflowRelayEntries(run).find((entry) => entry.nodeId === "review");
  assert.ok(review);
  assert.match(review.summary, /^我这边/);
  assert.match(review.summary, /检查故事中的技术漏洞/);
  assert.doesNotMatch(review.summary, /技术审校原文|漏洞一/);
  const markup = renderWorkflowRelayBubble(review);
  assert.doesNotMatch(markup, /技术审校原文|漏洞一/);
});

test("a terminal failed node also uses the friendly collaboration apology", async () => {
  const { workflowRelayEntries, renderWorkflowRelayBubble } = await workflowRunViewModule;
  const run = {
    id: "workflow-terminal-failure",
    threadId: "thread-terminal-failure",
    status: "failed",
    nodes: [
      node({
        id: "failed-draft",
        title: "完成中文科幻短篇",
        provider: "gemini",
        model: "gemini-3.5-flash",
        status: "failed",
        completedAt: "2026-07-23T08:00:05.000Z",
        executorChoice: 2,
        executorHistory: [
          {
            executorChoice: 1,
            provider: "qwen",
            model: "qwen3.7-max",
            status: "failed",
            attempts: 3,
            error: { message: "第一个模型响应超时", retryable: true },
            completedAt: "2026-07-23T08:00:04.000Z",
          },
          {
            executorChoice: 2,
            provider: "gemini",
            model: "gemini-3.5-flash",
            status: "failed",
            attempts: 3,
            error: { message: "第二个模型响应超时", retryable: true },
            completedAt: "2026-07-23T08:00:05.000Z",
          },
        ],
        result: {
          status: "failed",
          error: { message: "模型响应超时", retryable: true },
        },
      }),
    ],
  };

  const entries = workflowRelayEntries(run);
  const failed = entries.find((entry) => entry.nodeId === "failed-draft");
  assert.ok(failed);
  assert.equal(entries.filter((entry) => entry.status === "failed" && !entry.coordinatorUpdate).length, 2);
  assert.ok(entries.some((entry) => entry.nodeId === "failed-draft::executor-failed:1"));
  assert.ok(!entries.some((entry) => entry.nodeId === "failed-draft::executor-failed:2"));
  const markup = renderWorkflowRelayBubble(failed);
  assert.match(markup, /不好意思，我现在有事……可以找另一位伙伴协作。/);
  assert.doesNotMatch(markup, /模型响应超时/);
});
