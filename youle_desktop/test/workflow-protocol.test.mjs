import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeExecutionResult,
  normalizeWorkflowPlan,
  requestedParallelModelCount,
} from "../src/main/workflow/protocol.mjs";
import {
  CLUSTER_MODEL_REGISTRY,
  clusterRegistryForOnlineProviders,
  clusterRegistryFromBusinessModelPools,
  normalizeClusterProviderId,
  workflowExecutorRegistry,
} from "../src/main/workflow/model-registry.mjs";
import { normalizeBusinessModelPools } from "../src/main/youle-api-client.mjs";

test("cluster registry keeps only online external models and preserves the local Haolo worker", () => {
  const registry = clusterRegistryForOnlineProviders(
    workflowExecutorRegistry(CLUSTER_MODEL_REGISTRY),
    ["anthropic", "openai", "moonshot"],
  );

  assert.equal(normalizeClusterProviderId("anthropic"), "claude");
  assert.equal(normalizeClusterProviderId("openai"), "codex");
  assert.equal(normalizeClusterProviderId("moonshot"), "kimi");
  assert.deepEqual(
    registry
      .filter((entry) => entry.executorType === "external_model")
      .map((entry) => entry.provider),
    ["claude", "codex", "kimi"],
  );
  assert.equal(
    registry.filter((entry) => entry.executorType === "codex_subagent").length,
    1,
  );
  assert.equal(
    registry.some((entry) => entry.provider === "gemini"),
    false,
  );
});

test("configured execution and media models remain selectable for Haolo subagents", () => {
  const pools = normalizeBusinessModelPools({
    configured: true,
    pools: [{
      id: "execution",
      enabled: true,
      capabilities: ["root_execution"],
      models: [
        { id: "gpt-5.6-sol", display_name: "gpt-5.6-sol", provider: "codex" },
        { id: "gpt-5.6-terra", display_name: "gpt-5.6-terra", provider: "codex" },
        { id: "image2", display_name: "image2", provider: "codex", capabilities: ["image_generation"] },
      ],
    }, {
      id: "media_creation",
      enabled: true,
      capabilities: ["image_generation", "video_generation"],
      models: [
        { id: "image2", display_name: "image2", provider: "gpt", capabilities: ["image_generation"] },
        { id: "omni-fast", display_name: "omni-fast", provider: "gemini", capabilities: ["video_generation"] },
      ],
    }],
  });
  const registry = workflowExecutorRegistry([], pools);
  const agentExecutors = registry.filter(
    (entry) => entry.executorType === "codex_subagent",
  );
  const plan = normalizeWorkflowPlan({
    nodes: [{
      id: "implementation",
      kind: "agent",
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
      prompt: "完成实现并验证",
    }],
  }, registry);

  assert.deepEqual(
    agentExecutors.map((entry) => [entry.provider, entry.model]),
    [
      ["haolo-codex-agent", "gpt-5.6-sol"],
      ["haolo-codex-agent", "gpt-5.6-terra"],
      ["haolo-image-agent", "image2"],
      ["haolo-video-agent", "omni-fast"],
    ],
  );
  assert.equal(plan.nodes[0].provider, "haolo-codex-agent");
  assert.equal(plan.nodes[0].model, "gpt-5.6-sol");
  assert.deepEqual(plan.nodes[0].executorCandidates, [{
    provider: "haolo-codex-agent",
    model: "gpt-5.6-sol",
    executorType: "codex_subagent",
  }]);

  const mediaPlan = normalizeWorkflowPlan({
    nodes: [{
      id: "image-output",
      kind: "agent",
      executorType: "codex_subagent",
      provider: "haolo-image-agent",
      model: "image2",
      prompt: "生成配图",
    }, {
      id: "video-output",
      kind: "agent",
      executorType: "codex_subagent",
      provider: "haolo-video-agent",
      model: "omni-fast",
      prompt: "生成视频",
    }],
  }, registry);
  assert.deepEqual(
    mediaPlan.nodes.map((node) => [node.provider, node.model]),
    [["haolo-image-agent", "image2"], ["haolo-video-agent", "omni-fast"]],
  );
});

test("live media catalogs extend workflow agents when business pools are unavailable", () => {
  const registry = workflowExecutorRegistry(
    [],
    { configured: false, pools: [] },
    {
      imageCatalog: {
        models: [{ id: "image2-2k", display_name: "image2-2k" }],
      },
      videoCatalog: {
        models: [{ id: "omni-fast-v2v", display_name: "omni-fast-v2v" }],
      },
    },
  );

  assert.ok(registry.some((entry) => (
    entry.provider === "haolo-image-agent" && entry.model === "image2-2k"
  )));
  assert.ok(registry.some((entry) => (
    entry.provider === "haolo-video-agent" && entry.model === "omni-fast-v2v"
  )));
});

test("normalizes model plans to registered executors and removes dependency cycles", () => {
  const plan = normalizeWorkflowPlan({
    goalContract: { deliverable: "交付架构评审", successCriteria: ["可执行"] },
    nodes: [
      {
        id: "Research",
        provider: "perplexity",
        prompt: "查资料",
        dependsOn: ["review"],
        executorCandidates: [
          { provider: "perplexity", model: "sonar-pro" },
          { provider: "claude", model: "claude-sonnet-5" },
          { provider: "claude", model: "claude-sonnet-5" },
          { provider: "not-installed", model: "unknown" },
        ],
      },
      { id: "review", provider: "deepseek", prompt: "评审", dependsOn: ["research"] },
      { id: "unknown", provider: "not-installed", prompt: "ignore" },
    ],
  }, CLUSTER_MODEL_REGISTRY);

  assert.equal(plan.nodes.length, 2);
  assert.deepEqual(plan.nodes.map((node) => node.provider), ["perplexity", "deepseek"]);
  assert.equal(plan.nodes[0].id, "research");
  assert.ok(plan.nodes.some((node) => node.dependsOn.length === 0));
  assert.deepEqual(plan.nodes[0].executorCandidates, [
    { provider: "perplexity", model: "sonar-pro" },
    { provider: "claude", model: "claude-sonnet-5" },
    { provider: "codex", model: "gpt-5.6-terra" },
  ]);
  assert.equal(plan.nodes[1].executorCandidates.length, 3);
  assert.deepEqual(plan.nodes[1].executorCandidates[0], {
    provider: "deepseek",
    model: "deepseek-v4-flash",
  });
  assert.ok(plan.nodes.every((node) => node.needsLocalContext === false));
});

test("legacy node output requirements migrate into the single node prompt source", () => {
  const plan = normalizeWorkflowPlan({
    nodes: [{
      id: "research",
      provider: "perplexity",
      prompt: "调研并形成结论。",
      acceptance: ["列出关键证据", "说明不确定性"],
      outputContract: { requirements: ["结果可供下游直接使用"] },
    }],
  }, CLUSTER_MODEL_REGISTRY);

  assert.equal(plan.nodes.length, 1);
  assert.match(
    plan.nodes[0].prompt,
    /调研并形成结论。[\s\S]*输出要求：[\s\S]*结果可供下游直接使用[\s\S]*列出关键证据[\s\S]*说明不确定性/,
  );
  assert.deepEqual(plan.nodes[0].acceptance, []);
});

test("local context is opt-in during plan normalization", () => {
  const plan = normalizeWorkflowPlan({
    nodes: [
      { id: "default", provider: "kimi", prompt: "普通问答" },
      { id: "explicit", provider: "claude", prompt: "读取材料", needsLocalContext: true },
    ],
  }, CLUSTER_MODEL_REGISTRY);

  assert.equal(plan.nodes.find((node) => node.id === "default").needsLocalContext, false);
  assert.equal(plan.nodes.find((node) => node.id === "explicit").needsLocalContext, true);
});

test("planner-only policy cannot replace an execution deliverable", () => {
  const userPrompt = "请直接写出一篇完整短篇小说，拉 Doubao、Claude、Qwen 加入";
  const plan = normalizeWorkflowPlan({
    goalContract: {
      deliverable: "一套用于创作短篇小说的多模型工作流计划",
      successCriteria: ["故事结构完整", "最终成品适合扩写为完整短篇小说"],
      constraints: ["只做规划，不直接创作小说正文", "主图必须无环"],
      prohibitions: ["不得执行实际写作任务"],
    },
    nodes: [
      { id: "blueprint", provider: "claude", prompt: "只输出故事蓝图" },
    ],
    finalAcceptancePrompt: "检查整个计划只做规划、不执行小说正文创作。",
  }, CLUSTER_MODEL_REGISTRY, { userPrompt });

  assert.equal(plan.goalContract.deliverable, userPrompt);
  assert.deepEqual(plan.goalContract.constraints, ["主图必须无环"]);
  assert.deepEqual(plan.goalContract.prohibitions, []);
  assert.ok(plan.goalContract.successCriteria.includes("故事结构完整"));
  assert.ok(plan.goalContract.successCriteria.some((item) => item.includes("直接完成用户请求")));
  assert.doesNotMatch(JSON.stringify(plan.goalContract), /只做规划|不得执行实际写作|适合扩写/);
  assert.match(plan.finalAcceptancePrompt, /立即完成并交付最终成果/);
});

test("an explicit user request for planning only remains authoritative", () => {
  const userPrompt = "只做规划，不要写小说正文，给我一份创作蓝图";
  const plan = normalizeWorkflowPlan({
    goalContract: {
      deliverable: "短篇小说创作蓝图",
      constraints: ["只做规划，不直接创作小说正文"],
    },
    nodes: [{ id: "blueprint", provider: "claude", prompt: "输出蓝图" }],
    finalAcceptancePrompt: "只交付创作蓝图。",
  }, CLUSTER_MODEL_REGISTRY, { userPrompt });

  assert.equal(plan.goalContract.deliverable, userPrompt);
  assert.deepEqual(plan.goalContract.constraints, ["只做规划，不直接创作小说正文"]);
  assert.equal(plan.finalAcceptancePrompt, "只交付创作蓝图。");
});

test("planner model names and unknown ids resolve to registered execution-pool ids", () => {
  const registry = [
    {
      provider: "doubao",
      name: "seed-2-1-pro",
      model: "doubao-seed-2-1-pro-260628",
      capabilities: ["中文创作"],
    },
    {
      provider: "doubao",
      name: "seed-2-1-turbo",
      model: "doubao-seed-2-1-turbo-260628",
      capabilities: ["中文创作"],
    },
    {
      provider: "qwen",
      name: "qwen-max",
      model: "qwen3.7-max",
      capabilities: ["审核"],
    },
  ];
  const plan = normalizeWorkflowPlan({
    nodes: [
      {
        id: "writer",
        provider: "doubao",
        model: "seed-2-1-pro",
        executorCandidates: [
          { provider: "doubao", model: "seed-2-1-pro" },
          { provider: "qwen", model: "invented-qwen-id" },
        ],
        prompt: "写正文",
      },
    ],
  }, registry);

  assert.equal(plan.nodes[0].provider, "doubao");
  assert.equal(plan.nodes[0].model, "doubao-seed-2-1-pro-260628");
  assert.deepEqual(plan.nodes[0].executorCandidates, [
    { provider: "doubao", model: "doubao-seed-2-1-pro-260628" },
    { provider: "qwen", model: "qwen3.7-max" },
    { provider: "doubao", model: "doubao-seed-2-1-turbo-260628" },
  ]);
});

test("every configured provider resolves display names and explicit aliases to execution ids", () => {
  const configuredModels = [
    ["claude", "claude-sonnet-5-202607", "claude-sonnet-5", "claude-latest"],
    ["codex", "gpt-5.6-terra-202607", "gpt-5.6-terra", "terra-current"],
    ["kimi", "kimi-k3-202607", "kimi-k3", "kimi-current"],
    ["deepseek", "deepseek-v4-flash-202607", "deepseek-v4-flash", "deepseek-current"],
    ["gemini", "gemini-3.1-pro-preview", "gemini-3.1-pro", "gemini-pro-current"],
    ["grok", "grok-4.5-202607", "grok-4.5", "grok-current"],
    ["mimo", "mimo-v2.5-pro-202607", "mimo-v2.5-pro", "mimo-current"],
    ["perplexity", "sonar-pro-202607", "sonar-pro", "sonar-current"],
    ["doubao", "doubao-seed-2-1-pro-260628", "seed-2-1-pro", "doubao-pro-current"],
    ["qwen", "qwen3.7-max-202607", "qwen3.7-max", "qwen-max"],
  ].map(([provider, id, displayName, alias], index) => ({
    id,
    display_name: displayName,
    aliases: [alias],
    provider,
    route_group_id: index + 1,
    capabilities: ["cluster_node"],
    enabled: true,
  }));
  const pools = normalizeBusinessModelPools({
    configured: true,
    pools: [{
      id: "execution",
      enabled: true,
      capabilities: ["cluster_node"],
      models: configuredModels,
    }],
  });
  const registry = clusterRegistryFromBusinessModelPools(pools);
  const plan = normalizeWorkflowPlan({
    nodes: configuredModels.map((model, index) => ({
      id: `provider-${index}`,
      provider: model.provider,
      model: index % 2 === 0 ? model.display_name : model.aliases[0],
      prompt: `execute ${model.provider}`,
    })),
  }, registry);

  assert.equal(registry.length, configuredModels.length);
  for (const [index, configured] of configuredModels.entries()) {
    const registryEntry = registry.find((entry) => entry.provider === configured.provider);
    const node = plan.nodes.find((entry) => entry.id === `provider-${index}`);
    assert.equal(registryEntry.model, configured.id);
    assert.equal(registryEntry.name, configured.display_name);
    assert.ok(registryEntry.aliases.includes(configured.aliases[0]));
    assert.equal(node.model, configured.id);
    assert.deepEqual(node.executorCandidates[0], {
      provider: configured.provider,
      model: configured.id,
    });
  }
});

test("wraps every adapter response in one execution result envelope", () => {
  const result = normalizeExecutionResult({
    text: "节点结论",
    chatSummary: "我这边梳理好了，结论可以继续往下用了。",
    provider: "claude",
    model: "claude-sonnet-5",
    citations: ["source"],
    confidence: 1.7,
  });

  assert.equal(result.protocolVersion, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.text, "节点结论");
  assert.equal(result.output.summary, "我这边梳理好了，结论可以继续往下用了。");
  assert.equal(result.diagnostics.provider, "claude");
  assert.equal(result.confidence, 1);
  assert.equal(result.error, null);
});

test("preserves structured transport diagnostics in failed execution envelopes", () => {
  const result = normalizeExecutionResult({
    status: "failed",
    error: {
      code: "UPSTREAM_TEMPORARILY_UNAVAILABLE",
      message: "temporary failure",
      category: "remote",
      retryable: true,
      status: 502,
      retryAfterMs: 3500,
      requestId: "cluster-request-789",
      upstreamStatus: 503,
      routeExhausted: true,
    },
  });

  assert.equal(result.error.code, "UPSTREAM_TEMPORARILY_UNAVAILABLE");
  assert.equal(result.error.category, "remote");
  assert.equal(result.error.retryable, true);
  assert.equal(result.error.status, 502);
  assert.equal(result.error.retryAfterMs, 3500);
  assert.equal(result.error.requestId, "cluster-request-789");
  assert.equal(result.error.upstreamStatus, 503);
  assert.equal(result.error.routeExhausted, true);
});

test("normalizes critical work into a two-model branch with an independent review gate", () => {
  const plan = normalizeWorkflowPlan({
    complexityAssessment: {
      level: "complex",
      score: 5,
      rationale: "关键判断需要交叉验证",
      factors: ["高不确定性", "失败代价高"],
    },
    nodes: [
      {
        id: "option-a",
        provider: "claude",
        prompt: "独立方案 A",
        coordination: { mode: "parallel_candidate", parallelGroup: "critical-design" },
      },
      {
        id: "option-b",
        provider: "qwen",
        prompt: "独立方案 B",
        coordination: { mode: "parallel_candidate", parallelGroup: "critical-design" },
      },
      {
        id: "review",
        provider: "claude",
        prompt: "审核两路方案",
        dependsOn: ["option-a"],
        coordination: {
          mode: "review_gate",
          parallelGroup: "critical-design",
          reviewTargets: ["option-a", "option-b"],
        },
      },
      {
        id: "continue",
        provider: "kimi",
        prompt: "依据审核意见继续",
        dependsOn: ["option-a", "option-b"],
      },
    ],
  }, CLUSTER_MODEL_REGISTRY);

  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  assert.equal(plan.complexityAssessment.strategy, "parallel_review");
  assert.equal(plan.complexityAssessment.parallelReviewGroupCount, 1);
  assert.equal(plan.complexityAssessment.maxParallelModels, 2);
  assert.deepEqual(byId.get("option-a").dependsOn, []);
  assert.deepEqual(byId.get("option-b").dependsOn, []);
  assert.deepEqual(byId.get("review").dependsOn, ["option-a", "option-b"]);
  assert.deepEqual(byId.get("continue").dependsOn, ["review"]);
  assert.equal(byId.get("review").provider, "codex", "reviewer must differ from both candidate providers");
  assert.ok(byId.get("review").executorCandidates.every((candidate) => (
    candidate.provider !== "claude" && candidate.provider !== "qwen"
  )));
});

test("an explicit user request raises one parallel group to three models but never above three", () => {
  assert.equal(requestedParallelModelCount("帮我派出3个并行的模型完成调研"), 3);
  assert.equal(requestedParallelModelCount("请让三个智能体并行处理"), 3);
  assert.equal(requestedParallelModelCount("use 4 parallel agents for this task"), 3);
  assert.equal(requestedParallelModelCount("请认真调研并复核"), null);

  const plan = normalizeWorkflowPlan({
    nodes: [
      {
        id: "candidate-a",
        provider: "claude",
        prompt: "独立调研 A",
        coordination: { mode: "parallel_candidate", parallelGroup: "research" },
      },
      {
        id: "candidate-b",
        provider: "qwen",
        prompt: "独立调研 B",
        coordination: { mode: "parallel_candidate", parallelGroup: "research" },
      },
      {
        id: "review",
        provider: "deepseek",
        prompt: "审核全部候选",
        coordination: {
          mode: "review_gate",
          parallelGroup: "research",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      {
        id: "delivery",
        provider: "doubao",
        prompt: "整理交付",
        dependsOn: ["candidate-a", "candidate-b"],
      },
    ],
  }, CLUSTER_MODEL_REGISTRY, {
    userPrompt: "帮我派出3个并行的模型完成调研",
  });

  const parallelCandidates = plan.nodes.filter(
    (node) => node.coordination.mode === "parallel_candidate",
  );
  const reviewer = plan.nodes.find((node) => node.coordination.mode === "review_gate");
  assert.equal(parallelCandidates.length, 3);
  assert.equal(new Set(parallelCandidates.map((node) => node.provider)).size, 3);
  assert.equal(plan.complexityAssessment.maxParallelModels, 3);
  assert.deepEqual(reviewer.coordination.reviewTargets, parallelCandidates.map((node) => node.id));
  assert.deepEqual(reviewer.dependsOn, parallelCandidates.map((node) => node.id));
  assert.deepEqual(plan.nodes.find((node) => node.id === "delivery").dependsOn, [reviewer.id]);
});

test("synthesizes a review gate when a valid two-model group omits one", () => {
  const plan = normalizeWorkflowPlan({
    nodes: [
      {
        id: "left",
        provider: "deepseek",
        prompt: "left",
        coordination: { mode: "parallel_candidate", parallelGroup: "verify" },
      },
      {
        id: "right",
        provider: "mimo",
        prompt: "right",
        coordination: { mode: "parallel_candidate", parallelGroup: "verify" },
      },
      { id: "delivery", provider: "doubao", prompt: "delivery", dependsOn: ["left", "right"] },
    ],
  }, CLUSTER_MODEL_REGISTRY);

  const reviewer = plan.nodes.find((node) => node.coordination.mode === "review_gate");
  assert.ok(reviewer);
  assert.deepEqual(reviewer.coordination.reviewTargets, ["left", "right"]);
  assert.deepEqual(reviewer.dependsOn, ["left", "right"]);
  assert.deepEqual(plan.nodes.find((node) => node.id === "delivery").dependsOn, [reviewer.id]);
  assert.notEqual(reviewer.provider, "deepseek");
  assert.notEqual(reviewer.provider, "mimo");
});
