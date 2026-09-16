import type { ChatModelOption } from "./chat-model-catalog";
import { providerModelInputCapabilities } from "../main/provider-input-capabilities.mjs";
import { isRetiredExecutionModel } from "../main/retired-model-policy.mjs";
import { modelDisplayName } from "./model-display-name.ts";

export const PROVIDER_MODEL_PROVIDERS = [
  "claude",
  "codex",
  "kimi",
  "deepseek",
  "gemini",
  "grok",
  "mimo",
  "perplexity",
  "doubao",
  "qwen",
] as const;

export type ProviderModelProvider = (typeof PROVIDER_MODEL_PROVIDERS)[number];
export type ProviderModelCatalogStatus = "online" | "standby" | "error";

export type ProviderModelCatalogModel = {
  id: string;
  displayName: string;
  isDefault: boolean;
};

export type ProviderModelCatalogEntry = {
  provider: ProviderModelProvider;
  status: ProviderModelCatalogStatus;
  models: ProviderModelCatalogModel[];
  stale: boolean;
  fetchedAt: string | null;
  error: string | null;
};

export type ProviderModelCatalogState = {
  loading: boolean;
  loaded: boolean;
  configured: boolean;
  refreshedAt: string | null;
  providerOrder: ProviderModelProvider[];
  providers: Partial<Record<ProviderModelProvider, ProviderModelCatalogEntry>>;
};

export type ProviderModelGroup = {
  provider: ProviderModelProvider;
  label: string;
  options: ChatModelOption[];
  stale: boolean;
};

const PROVIDER_LABELS: Record<ProviderModelProvider, string> = {
  claude: "Claude",
  codex: "GPT",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  grok: "Grok",
  mimo: "MiMo",
  perplexity: "Perplexity",
  doubao: "Doubao",
  qwen: "Qwen",
};

export function providerModelLabel(provider: ProviderModelProvider) {
  return PROVIDER_LABELS[provider];
}

const CLIENT_HIDDEN_MODEL_IDS = new Set(["gpt-5.4"]);

const CURATED_MODEL_META: Partial<
  Record<
    ProviderModelProvider,
    readonly { id: string; label: string; preferredDefault?: boolean }[]
  >
> = {
  claude: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", preferredDefault: true },
    { id: "claude-fable-5", label: "Claude Fable 5" },
  ],
  codex: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", preferredDefault: true },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
  kimi: [
    { id: "kimi-k3", label: "Kimi K3", preferredDefault: true },
    { id: "moonshot-v1-128k", label: "Moonshot 128K" },
  ],
  deepseek: [
    { id: "deepseek-flash", label: "GPT-6 Astra", preferredDefault: true },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  ],
  gemini: [
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", preferredDefault: true },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  ],
  grok: [
    { id: "grok-4.5", label: "Grok 4.5", preferredDefault: true },
    { id: "grok-4.3", label: "Grok 4.3" },
  ],
  mimo: [
    { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", preferredDefault: true },
    { id: "mimo-v2.5", label: "MiMo V2.5" },
  ],
  perplexity: [{ id: "sonar-pro", label: "Sonar Pro", preferredDefault: true }],
  doubao: [
    {
      id: "doubao-seed-2-1-pro-260628",
      label: "Doubao Seed 2.1 Pro",
      preferredDefault: true,
    },
    {
      id: "doubao-seed-2-1-turbo-260628",
      label: "Doubao Seed 2.1 Turbo",
    },
  ],
  qwen: [
    { id: "qwen3.7-max", label: "Qwen 3.7 Max", preferredDefault: true },
    { id: "qwen3.7-plus", label: "Qwen 3.7 Plus" },
  ],
};

export function createProviderModelCatalogState(): ProviderModelCatalogState {
  return {
    loading: false,
    loaded: false,
    configured: false,
    refreshedAt: null,
    providerOrder: [],
    providers: {},
  };
}

export function normalizeProviderModelCatalog(
  payload: unknown,
): Pick<
  ProviderModelCatalogState,
  "loaded" | "configured" | "refreshedAt" | "providerOrder" | "providers"
> {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(source.providers) ? source.providers : [];
  const providers: ProviderModelCatalogState["providers"] = {};
  const providerOrder: ProviderModelProvider[] = [];

  for (const rowValue of rows) {
    if (!rowValue || typeof rowValue !== "object" || Array.isArray(rowValue)) continue;
    const row = rowValue as Record<string, unknown>;
    const provider = normalizeProviderModelProvider(row.provider);
    if (!provider) continue;
    if (!providerOrder.includes(provider)) providerOrder.push(provider);
    const models = normalizeProviderModels(row.models);
    const status: ProviderModelCatalogStatus =
      row.status === "error" ? "error" : models.length > 0 ? "online" : "standby";
    providers[provider] = {
      provider,
      status,
      models,
      stale: row.stale === true,
      fetchedAt: safeText(row.fetchedAt ?? row.fetched_at, 80) || null,
      error: status === "error" ? safeText(row.error, 160) || "模型目录暂时不可用" : null,
    };
  }

  return {
    loaded: true,
    configured: source.configured === true,
    refreshedAt:
      safeText(source.fetchedAt ?? source.fetched_at, 80) || new Date().toISOString(),
    providerOrder,
    providers,
  };
}

export function providerModelOptions(
  catalog: ProviderModelCatalogState,
  provider: ProviderModelProvider | null | undefined,
): ChatModelOption[] {
  if (!provider) return [];
  const models = (catalog.providers[provider]?.models || []).filter(
    (model) =>
      !isRetiredExecutionModel(model.id) &&
      (catalog.configured || !CLIENT_HIDDEN_MODEL_IDS.has(model.id.toLowerCase())),
  );
  if (!models.length) return [];
  const curated = CURATED_MODEL_META[provider] || [];
  const curatedById = new Map(curated.map((item) => [item.id.toLowerCase(), item]));
  const serverDefault = models.find((model) => model.isDefault)?.id;
  const preferredDefault = catalog.configured
    ? null
    : curated.find(
        (item) =>
          item.preferredDefault &&
          models.some((model) => model.id.toLowerCase() === item.id.toLowerCase()),
      )?.id;
  const defaultModelId =
    serverDefault ||
    (catalog.configured ? null : preferredDefault || models[0].id);

  return models.map((model) => {
    const curatedModel = curatedById.get(model.id.toLowerCase());
    const displayName = catalog.configured
      ? model.displayName || model.id
      : model.displayName &&
          model.displayName.toLowerCase() !== model.id.toLowerCase()
        ? model.displayName
        : curatedModel?.label || model.id;
    return {
      value: model.id,
      label: modelDisplayName(model.id, displayName),
      description: modelDisplayName(model.id, displayName),
      reasoningEfforts: [],
      serviceTiers: [],
      inputModalities: [...providerModelInputCapabilities(provider, model.id).modalities],
      isDefault:
        Boolean(defaultModelId) &&
        model.id.toLowerCase() === defaultModelId?.toLowerCase(),
    };
  });
}

export function providerModelGroups(
  catalog: ProviderModelCatalogState,
): ProviderModelGroup[] {
  return orderedCatalogProviders(catalog).map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    options: providerModelOptions(catalog, provider),
    stale: catalog.providers[provider]?.stale === true,
  }));
}

export function defaultProviderModelSelection(
  catalog: ProviderModelCatalogState,
): { provider: ProviderModelProvider; option: ChatModelOption } | null {
  for (const provider of orderedCatalogProviders(catalog)) {
    const serverDefault = catalog.providers[provider]?.models.find(
      (model) => model.isDefault,
    );
    if (!serverDefault) continue;
    const option = providerModelOptions(catalog, provider).find(
      (candidate) =>
        candidate.value.toLowerCase() === serverDefault.id.toLowerCase(),
    );
    if (option) return { provider, option };
  }

  for (const provider of orderedCatalogProviders(catalog)) {
    const option = providerModelOptions(catalog, provider)[0];
    if (option) return { provider, option };
  }

  return null;
}

export function providerForCatalogModel(
  catalog: ProviderModelCatalogState,
  model: unknown,
): ProviderModelProvider | null {
  const normalized = safeText(model, 200).toLowerCase();
  if (!normalized) return null;
  return (
    orderedCatalogProviders(catalog).find((provider) =>
      catalog.providers[provider]?.models.some(
        (item) => item.id.toLowerCase() === normalized,
      ),
    ) || null
  );
}

function orderedCatalogProviders(catalog: ProviderModelCatalogState) {
  if (catalog.configured) return catalog.providerOrder;
  return PROVIDER_MODEL_PROVIDERS;
}

export function normalizeProviderModelProvider(
  value: unknown,
): ProviderModelProvider | null {
  const normalized = safeText(value, 80).toLowerCase();
  const aliases: Record<string, ProviderModelProvider> = {
    anthropic: "claude",
    openai: "codex",
    gpt: "codex",
    chatgpt: "codex",
    moonshot: "kimi",
    "deepseek-chat": "deepseek",
    google: "gemini",
    "google-ai": "gemini",
    xai: "grok",
    "x-ai": "grok",
    xiaomi: "mimo",
    "xiaomi-mimo": "mimo",
    pplx: "perplexity",
    sonar: "perplexity",
    bytedance: "doubao",
    volcengine: "doubao",
    ark: "doubao",
    tongyi: "qwen",
    dashscope: "qwen",
    alibaba: "qwen",
  };
  const candidate = aliases[normalized] || normalized;
  return (PROVIDER_MODEL_PROVIDERS as readonly string[]).includes(candidate)
    ? (candidate as ProviderModelProvider)
    : null;
}

function normalizeProviderModels(value: unknown): ProviderModelCatalogModel[] {
  if (!Array.isArray(value)) return [];
  const models: ProviderModelCatalogModel[] = [];
  const seen = new Set<string>();
  for (const itemValue of value) {
    if (!itemValue || typeof itemValue !== "object" || Array.isArray(itemValue)) continue;
    const item = itemValue as Record<string, unknown>;
    const id = safeText(item.id ?? item.model ?? item.slug, 200);
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    models.push({
      id,
      displayName: modelDisplayName(
        id,
        safeText(item.displayName ?? item.display_name ?? item.label ?? item.name, 160) ||
          id,
      ),
      isDefault: item.isDefault === true || item.is_default === true,
    });
  }
  return models;
}

function safeText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    return "";
  }
  return text;
}
