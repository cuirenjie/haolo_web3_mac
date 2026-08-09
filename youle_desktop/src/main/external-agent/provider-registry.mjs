const READ_ONLY_ROLES = Object.freeze(["research", "summarize", "review", "advise"]);

const PROVIDERS = Object.freeze([
  provider({
    id: "openai",
    displayName: "ChatGPT / OpenAI",
    vendor: "OpenAI",
    aliases: ["chatgpt", "gpt", "codex"],
    protocol: "openai-responses",
    defaultModel: "gpt-5.6",
    apiKeyEnvironmentVariable: "OPENAI_API_KEY",
    keyConsoleUrl: "https://platform.openai.com/api-keys",
    documentationUrl: "https://platform.openai.com/docs/quickstart",
    baseUrlOptions: [baseUrl("default", "OpenAI 官方 API", "https://api.openai.com/v1")],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "anthropic",
    displayName: "Claude",
    vendor: "Anthropic",
    aliases: ["claude"],
    protocol: "anthropic-messages",
    defaultModel: "claude-sonnet-5",
    apiKeyEnvironmentVariable: "ANTHROPIC_API_KEY",
    keyConsoleUrl: "https://platform.claude.com/settings/keys",
    documentationUrl: "https://platform.claude.com/docs/en/get-started",
    baseUrlOptions: [baseUrl("default", "Anthropic 官方 API", "https://api.anthropic.com/v1")],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "moonshot",
    displayName: "Kimi",
    vendor: "Moonshot AI",
    aliases: ["kimi", "moonshot-ai"],
    protocol: "openai-chat-completions",
    defaultModel: "kimi-k2.6",
    apiKeyEnvironmentVariable: "MOONSHOT_API_KEY",
    keyConsoleUrl: "https://platform.kimi.com/console/api-keys",
    documentationUrl: "https://platform.kimi.com/docs/api/overview",
    baseUrlOptions: [
      baseUrl("china", "中国站", "https://api.moonshot.cn/v1", {
        keyConsoleUrl: "https://platform.kimi.com/console/api-keys",
        documentationUrl: "https://platform.kimi.com/docs/api/overview",
      }),
      baseUrl("global", "国际站", "https://api.moonshot.ai/v1", {
        keyConsoleUrl: "https://platform.kimi.ai/console/api-keys",
        documentationUrl: "https://platform.kimi.ai/docs/api/overview",
      }),
    ],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "deepseek",
    displayName: "DeepSeek",
    vendor: "DeepSeek",
    aliases: ["deepseek-chat"],
    protocol: "openai-chat-completions",
    defaultModel: "deepseek-v4-flash",
    apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
    keyConsoleUrl: "https://platform.deepseek.com/api_keys",
    documentationUrl: "https://api-docs.deepseek.com/",
    baseUrlOptions: [baseUrl("default", "DeepSeek 官方 API", "https://api.deepseek.com")],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "google",
    displayName: "Gemini",
    vendor: "Google",
    aliases: ["gemini", "google-ai"],
    protocol: "google-openai-compat",
    defaultModel: "gemini-3.5-flash",
    apiKeyEnvironmentVariable: "GEMINI_API_KEY",
    keyConsoleUrl: "https://aistudio.google.com/api-keys",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/openai",
    baseUrlOptions: [
      baseUrl("default", "Google OpenAI 兼容 API", "https://generativelanguage.googleapis.com/v1beta/openai"),
    ],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "perplexity",
    displayName: "Perplexity",
    vendor: "Perplexity AI",
    aliases: ["pplx"],
    protocol: "perplexity-sonar",
    defaultModel: "sonar",
    apiKeyEnvironmentVariable: "PERPLEXITY_API_KEY",
    keyConsoleUrl: "https://console.perplexity.ai/",
    documentationUrl: "https://docs.perplexity.ai/docs/getting-started/quickstart",
    baseUrlOptions: [baseUrl("default", "Perplexity 官方 API", "https://api.perplexity.ai")],
    connectionTest: { method: "POST", path: "/v1/sonar", billable: true },
  }),
  provider({
    id: "xai",
    displayName: "Grok",
    vendor: "xAI",
    aliases: ["grok", "x-ai"],
    protocol: "openai-responses",
    defaultModel: "grok-4.5",
    apiKeyEnvironmentVariable: "XAI_API_KEY",
    keyConsoleUrl: "https://console.x.ai/team/default/api-keys",
    documentationUrl: "https://docs.x.ai/developers/quickstart",
    baseUrlOptions: [baseUrl("default", "xAI 官方 API", "https://api.x.ai/v1")],
    connectionTest: { method: "GET", path: "/models" },
  }),
  provider({
    id: "xiaomi",
    displayName: "MiMo",
    vendor: "Xiaomi MiMo",
    aliases: ["mimo", "xiaomi-mimo"],
    protocol: "openai-responses",
    defaultModel: "mimo-v2.5",
    apiKeyEnvironmentVariable: "MIMO_API_KEY",
    keyConsoleUrl: "https://platform.xiaomimimo.com/",
    documentationUrl: "https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call",
    baseUrlOptions: [
      baseUrl("payg", "按量付费", "https://api.xiaomimimo.com/v1"),
      baseUrl("token-plan-cn", "中国区 Token Plan", "https://token-plan-cn.xiaomimimo.com/v1"),
      baseUrl("token-plan-sgp", "新加坡区 Token Plan", "https://token-plan-sgp.xiaomimimo.com/v1"),
      baseUrl("token-plan-ams", "欧洲区 Token Plan", "https://token-plan-ams.xiaomimimo.com/v1"),
    ],
    connectionTest: { method: "GET", path: "/models" },
  }),
]);

const PROVIDER_BY_ID = new Map(PROVIDERS.map((item) => [item.id, item]));
const PROVIDER_ALIAS_TO_ID = new Map();
for (const item of PROVIDERS) {
  PROVIDER_ALIAS_TO_ID.set(item.id, item.id);
  for (const alias of item.aliases) PROVIDER_ALIAS_TO_ID.set(alias, item.id);
}

export const EXTERNAL_MODEL_PROVIDER_IDS = Object.freeze(PROVIDERS.map((item) => item.id));

export function listExternalModelProviders() {
  return PROVIDERS.map(cloneProvider);
}

export function getExternalModelProvider(value) {
  const id = normalizeExternalModelProviderId(value);
  const item = PROVIDER_BY_ID.get(id);
  return item ? cloneProvider(item) : null;
}

export function normalizeExternalModelProviderId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PROVIDER_ALIAS_TO_ID.get(normalized) || "";
}

export function getExternalModelBaseUrl(provider, profileId) {
  const options = Array.isArray(provider?.baseUrlOptions) ? provider.baseUrlOptions : [];
  return options.find((item) => item.id === profileId) || options[0] || null;
}

function provider(input) {
  return Object.freeze({
    ...input,
    aliases: Object.freeze([...input.aliases]),
    baseUrlOptions: Object.freeze(input.baseUrlOptions.map((item) => Object.freeze({ ...item }))),
    connectionTest: Object.freeze({ ...input.connectionTest }),
    capabilities: Object.freeze({
      roles: READ_ONLY_ROLES,
      toolsEnabled: false,
      localFileAccess: false,
      shellAccess: false,
      writeAccess: false,
    }),
  });
}

function baseUrl(id, label, value, extra = {}) {
  return { id, label, baseUrl: value, ...extra };
}

function cloneProvider(item) {
  return {
    ...item,
    aliases: [...item.aliases],
    baseUrlOptions: item.baseUrlOptions.map((option) => ({ ...option })),
    connectionTest: { ...item.connectionTest },
    capabilities: { ...item.capabilities, roles: [...item.capabilities.roles] },
  };
}
