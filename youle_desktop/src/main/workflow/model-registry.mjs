import {
  providerInputCapabilityLabels,
} from "../provider-input-capabilities.mjs";
import {
  WORKFLOW_EXECUTOR_TYPES,
  normalizeWorkflowExecutorType,
} from "./executor-boundary.mjs";

export const LOCAL_CODEX_SUBAGENT_EXECUTOR = Object.freeze({
  executorType: WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT,
  provider: "haolo-codex-agent",
  name: "Haolo 子 Agent",
  model: "gpt-5.6-terra",
  aliases: Object.freeze([
    "codex-subagent",
    "haolo-subagent",
    "local-codex-agent",
  ]),
  capabilities: Object.freeze([
    "读取本地文件",
    "创建、修改与删除文件",
    "运行命令与测试",
    "操作已授权应用",
    "执行已授权联网与发布操作",
  ]),
});

export const HAOLO_IMAGE_SUBAGENT_PROVIDER = "haolo-image-agent";
export const HAOLO_VIDEO_SUBAGENT_PROVIDER = "haolo-video-agent";

export const CLUSTER_MODEL_REGISTRY = Object.freeze([
  model("claude", "Claude", "claude-sonnet-5", ["长文阅读", "严谨分析", "结构化写作", "方案审查"]),
  model("codex", "GPT", "gpt-5.6-terra", ["综合推理", "代码与工程", "任务拆解", "跨领域综合"]),
  model("kimi", "Kimi", "kimi-k3", ["长上下文", "本地资料归纳", "中文文档", "信息提取"]),
  model("deepseek", "DeepSeek", "deepseek-flash", ["代码分析", "数学逻辑", "技术方案", "交叉验证"]),
  model("gemini", "Gemini", "gemini-3.5-flash", ["多模态理解", "跨资料综合", "创意生成", "信息整理"]),
  model("grok", "Grok", "grok-4.5", ["开放问题", "趋势分析", "技术复核", "观点挑战"]),
  model("mimo", "MiMo", "mimo-v2.5-pro", ["代码与 Agent", "复杂推理", "技术审查", "方案评估"]),
  model("perplexity", "Perplexity", "sonar-pro", ["联网调研", "时效信息", "事实核验", "来源引用"]),
  model("doubao", "Doubao", "doubao-seed-2-1-pro-260628", ["中文理解", "内容创作", "方案整理", "表达润色"]),
  model("qwen", "Qwen", "qwen3.7-max", ["中英知识", "代码分析", "复杂推理", "文档审查"]),
]);

export function clusterRegistryFromBusinessModelPools(config) {
  const executionPool = Array.isArray(config?.pools)
    ? config.pools.find(
        (pool) => pool?.id === "execution" && pool?.enabled !== false,
      )
    : null;
  if (!executionPool || !Array.isArray(executionPool.models)) return [];
  return executionPool.models
    .filter(
      (entry) =>
        entry?.enabled !== false &&
        Array.isArray(entry.capabilities) &&
        entry.capabilities.includes("cluster_node") &&
        text(entry.provider) &&
        text(entry.id),
    )
    .map((entry) => {
      const provider = text(entry.provider).toLowerCase();
      const technicalID = text(entry.id);
      const displayName = text(
        entry.displayName,
        entry.display_name,
        entry.name,
        technicalID,
      );
      const aliases = uniqueText([
        displayName,
        ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ]).filter((alias) => alias.toLowerCase() !== technicalID.toLowerCase());
      const semanticCapabilities = uniqueText([
        ...(Array.isArray(entry.tags) ? entry.tags : []),
        ...(Array.isArray(entry.capabilityTags) ? entry.capabilityTags : []),
        ...providerInputCapabilityLabels(provider, technicalID).map((label) => `${label}输入`),
      ]);
      return {
        executorType: WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
        provider,
        name: displayName,
        model: technicalID,
        aliases,
        capabilities: semanticCapabilities.length
          ? semanticCapabilities
          : [displayName],
      };
    });
}

export function codexSubagentRegistryFromBusinessModelPools(config) {
  if (config?.configured !== true) {
    return [{ ...LOCAL_CODEX_SUBAGENT_EXECUTOR }];
  }
  const executionPool = Array.isArray(config?.pools)
    ? config.pools.find(
        (pool) => pool?.id === "execution" && pool?.enabled !== false,
      )
    : null;
  if (!executionPool || !Array.isArray(executionPool.models)) return [];
  return executionPool.models
    .filter((entry) => (
      entry?.enabled !== false
      && Array.isArray(entry.capabilities)
      && entry.capabilities.includes("root_execution")
      && text(entry.id)
    ))
    .map((entry) => {
      const model = text(entry.id);
      const displayName = text(
        entry.displayName,
        entry.display_name,
        entry.name,
        model,
      );
      return {
        ...LOCAL_CODEX_SUBAGENT_EXECUTOR,
        model,
        name: displayName || LOCAL_CODEX_SUBAGENT_EXECUTOR.name,
        aliases: uniqueText([
          displayName,
          ...(Array.isArray(entry.aliases) ? entry.aliases : []),
        ]),
      };
    });
}

export function mediaSubagentRegistryFromCatalogs(
  businessModelPools,
  catalogs = {},
) {
  const entries = [];
  const seen = new Set();
  const add = (provider, item, capability) => {
    const model = text(item?.id, item?.model);
    if (!model) return;
    const key = `${provider}\u0000${model.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const displayName = text(
      item?.displayName,
      item?.display_name,
      item?.name,
      model,
    );
    entries.push({
      ...LOCAL_CODEX_SUBAGENT_EXECUTOR,
      provider,
      model,
      name: displayName,
      aliases: uniqueText([
        displayName,
        ...(Array.isArray(item?.aliases) ? item.aliases : []),
      ]),
      capabilities: Object.freeze([
        capability,
        ...(LOCAL_CODEX_SUBAGENT_EXECUTOR.capabilities || []),
      ]),
    });
  };
  for (const item of catalogModels(catalogs.imageCatalog)) {
    add(HAOLO_IMAGE_SUBAGENT_PROVIDER, item, "图片生成与编辑");
  }
  for (const item of catalogModels(catalogs.videoCatalog)) {
    add(HAOLO_VIDEO_SUBAGENT_PROVIDER, item, "视频生成与编辑");
  }
  const mediaPool = Array.isArray(businessModelPools?.pools)
    ? businessModelPools.pools.find((pool) => (
        pool?.id === "media_creation" && pool?.enabled !== false
      ))
    : null;
  for (const item of Array.isArray(mediaPool?.models) ? mediaPool.models : []) {
    if (item?.enabled === false) continue;
    const capabilities = Array.isArray(item?.capabilities)
      ? item.capabilities
      : Array.isArray(mediaPool?.capabilities) ? mediaPool.capabilities : [];
    if (capabilities.includes("image_generation")) {
      add(HAOLO_IMAGE_SUBAGENT_PROVIDER, item, "图片生成与编辑");
    }
    if (capabilities.includes("video_generation")) {
      add(HAOLO_VIDEO_SUBAGENT_PROVIDER, item, "视频生成与编辑");
    }
  }
  return entries;
}

export function workflowExecutorRegistry(
  modelRegistry = CLUSTER_MODEL_REGISTRY,
  businessModelPools = null,
  mediaCatalogs = {},
) {
  const externalModels = (Array.isArray(modelRegistry) ? modelRegistry : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      executorType: WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    }));
  return [
    ...externalModels,
    ...codexSubagentRegistryFromBusinessModelPools(businessModelPools),
    ...mediaSubagentRegistryFromCatalogs(businessModelPools, mediaCatalogs),
  ];
}

export function normalizeClusterProviderId(value) {
  const provider = String(value || "").trim().toLowerCase();
  switch (provider) {
    case "anthropic":
      return "claude";
    case "gpt":
    case "openai":
    case "chatgpt":
      return "codex";
    case "moonshot":
    case "moonshot-ai":
    case "moonshot-v1-128k":
      return "kimi";
    case "deepseek-chat":
      return "deepseek";
    case "google":
    case "google-ai":
      return "gemini";
    case "xai":
    case "x-ai":
      return "grok";
    case "xiaomi":
    case "xiaomi-mimo":
      return "mimo";
    case "pplx":
    case "sonar":
      return "perplexity";
    case "bytedance":
    case "volcengine":
    case "ark":
      return "doubao";
    case "tongyi":
    case "dashscope":
    case "alibaba":
      return "qwen";
    default:
      return provider;
  }
}

export function clusterRegistryForOnlineProviders(registry, onlineProviders) {
  const online = new Set(
    (Array.isArray(onlineProviders) ? onlineProviders : [])
      .map(normalizeClusterProviderId)
      .filter(Boolean),
  );
  return (Array.isArray(registry) ? registry : []).filter((entry) => (
    normalizeWorkflowExecutorType(entry?.executorType) ===
      WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT ||
    online.has(normalizeClusterProviderId(entry?.provider))
  ));
}

export function clusterModel(provider) {
  return CLUSTER_MODEL_REGISTRY.find((entry) => entry.provider === String(provider || "").trim().toLowerCase()) || null;
}

export function modelRegistryPrompt(registry = CLUSTER_MODEL_REGISTRY) {
  return registry
    .map((entry) => {
      const executorLabel = entry.executorType === WORKFLOW_EXECUTOR_TYPES.CODEX_SUBAGENT
        ? "codex_subagent（可执行）"
        : "external_model（只读分析）";
      return `- ${entry.provider} / ${entry.name} / ${entry.model} / ${executorLabel}: ${(entry.capabilities || []).join("、")}`;
    })
    .join("\n");
}

function model(provider, name, defaultModel, capabilities) {
  return Object.freeze({
    executorType: WORKFLOW_EXECUTOR_TYPES.EXTERNAL_MODEL,
    provider,
    name,
    model: defaultModel,
    capabilities: Object.freeze(uniqueText([
      ...capabilities,
      ...providerInputCapabilityLabels(provider, defaultModel).map((label) => `${label}输入`),
    ])),
  });
}

function text(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function uniqueText(values) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function catalogModels(value) {
  const roots = [value, value?.data, value?.result].filter(
    (candidate) => candidate && typeof candidate === "object",
  );
  const root = roots.find((candidate) => Array.isArray(candidate.models));
  return Array.isArray(root?.models) ? root.models : [];
}
