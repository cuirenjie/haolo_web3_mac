import { LEGACY_DEEPSEEK_FLASH_MODEL } from "../main/deepseek-model-policy.mjs";
import { isRetiredExecutionModel } from "../main/retired-model-policy.mjs";
import { modelDisplayName } from "./model-display-name.ts";
import {
  DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION,
  DEEPSEEK_EXECUTION_MODEL_VALUE,
  DEEPSEEK_EXECUTION_PROVIDER_ID,
  DEFAULT_CHAT_MODEL_VALUE,
  FIXED_CHAT_MODEL_OPTIONS,
  type ChatModelOption,
} from "./chat-model-catalog.ts";
import {
  DEFAULT_EXECUTION_MODEL_PROVIDER_ID,
  canonicalExecutionModelProvider,
} from "../main/execution-model-provider.mjs";

export type BusinessModelPoolModel = {
  id: string;
  displayName: string;
  provider: string;
  routeGroupId: number | null;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  capabilities: string[];
  credentialAvailable?: boolean;
};

export type BusinessModelPool = {
  id: "execution" | "question_answer" | "media_creation";
  name: string;
  enabled: boolean;
  capabilities: string[];
  models: BusinessModelPoolModel[];
};

export type BusinessModelPoolsState = {
  configured: boolean;
  catalogVersion: number;
  updatedAt: string | null;
  pools: BusinessModelPool[];
  stale: boolean;
  error: string | null;
};

export function createBusinessModelPoolsState(): BusinessModelPoolsState {
  return {
    configured: false,
    catalogVersion: 0,
    updatedAt: null,
    pools: [],
    stale: false,
    error: null,
  };
}

export function normalizeBusinessModelPoolsState(
  payload: unknown,
): BusinessModelPoolsState {
  const source =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const poolRows = Array.isArray(source.pools) ? source.pools : [];
  const pools: BusinessModelPool[] = [];
  for (const poolValue of poolRows) {
    if (!poolValue || typeof poolValue !== "object" || Array.isArray(poolValue)) {
      continue;
    }
    const pool = poolValue as Record<string, unknown>;
    const id = safeText(pool.id);
    if (!["execution", "question_answer", "media_creation"].includes(id)) {
      continue;
    }
    const capabilities = stringArray(pool.capabilities);
    const models = (Array.isArray(pool.models) ? pool.models : [])
      .map((modelValue) =>
        normalizePoolModel(modelValue, capabilities),
      )
      .filter((model): model is BusinessModelPoolModel => model !== null)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
      );
    pools.push({
      id: id as BusinessModelPool["id"],
      name: safeText(pool.name) || id,
      enabled: pool.enabled !== false,
      capabilities,
      models,
    });
  }
  return {
    configured: source.configured === true,
    catalogVersion:
      finiteNumber(source.catalogVersion ?? source.catalog_version) || 0,
    updatedAt: safeText(source.updatedAt ?? source.updated_at) || null,
    pools,
    stale: source.stale === true,
    error: safeText(source.error) || null,
  };
}

export function businessPoolModels(
  state: BusinessModelPoolsState,
  poolID: BusinessModelPool["id"],
  capability: string,
) {
  const pool = state.pools.find(
    (candidate) => candidate.id === poolID && candidate.enabled,
  );
  if (!pool) return [];
  return pool.models.filter(
    (model) =>
      model.enabled && !isRetiredExecutionModel(model.id) && model.id.toLowerCase() !== LEGACY_DEEPSEEK_FLASH_MODEL &&
      (!capability || model.capabilities.includes(capability)),
  );
}

export function businessModelDisplayName(
  state: BusinessModelPoolsState,
  modelID: unknown,
): string {
  const id = safeText(modelID);
  if (!id) return "";
  const normalizedID = id.toLowerCase();
  let matchedDisplayName = "";
  for (const pool of state.pools) {
    for (const model of pool.models) {
      if (model.id.toLowerCase() !== normalizedID) continue;
      const displayName = safeText(model.displayName);
      if (displayName && displayName.toLowerCase() !== normalizedID) {
        return modelDisplayName(id, displayName);
      }
      matchedDisplayName ||= displayName;
    }
  }
  return modelDisplayName(id, matchedDisplayName || id);
}

export function executionChatModelOptions(
  state: BusinessModelPoolsState,
): ChatModelOption[] {
  if (!state.configured) return [...FIXED_CHAT_MODEL_OPTIONS];
  return businessPoolModels(state, "execution", "root_execution")
    .filter((model) => model.credentialAvailable !== false)
    .map(
    (model) => {
      const fixed = FIXED_CHAT_MODEL_OPTIONS.find(
        (candidate) =>
          candidate.value.toLowerCase() === model.id.toLowerCase(),
      );
      const providerId =
        model.id.toLowerCase() === DEEPSEEK_EXECUTION_MODEL_VALUE &&
        model.provider === DEEPSEEK_EXECUTION_PROVIDER_ID
          ? DEEPSEEK_EXECUTION_PROVIDER_ID
          : canonicalExecutionModelProvider(
              model.provider,
              DEFAULT_EXECUTION_MODEL_PROVIDER_ID,
            );
      const catalogOption =
        providerId === DEEPSEEK_EXECUTION_PROVIDER_ID
          ? DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION
          : fixed;
      return {
        ...(catalogOption || {
          value: model.id,
          label: model.displayName || model.id,
          description: "",
          reasoningEfforts: [],
          serviceTiers: [],
          inputModalities: ["text"],
        }),
        providerId,
        providerLabel:
          providerId === DEEPSEEK_EXECUTION_PROVIDER_ID
            ? "DeepSeek"
            : "Haolo · GPT",
        routeGroupId: model.routeGroupId,
        credentialAvailable: model.credentialAvailable,
        value: model.id,
        label: modelDisplayName(model.id, model.displayName || catalogOption?.label || model.id),
        isDefault: model.isDefault,
      };
    },
  );
}

export function defaultExecutionChatModelOption(
  options: readonly ChatModelOption[],
): ChatModelOption | null {
  return (
    options.find((option) => option.isDefault) ||
    options.find((option) => option.value === DEFAULT_CHAT_MODEL_VALUE) ||
    options[0] ||
    null
  );
}

export function supportsCodexToolExecutionModel(
  option: ChatModelOption | null | undefined,
): boolean {
  const model = safeText(option?.value).toLowerCase();
  if (!model) return false;
  const provider = canonicalExecutionModelProvider(
    option?.providerId,
    DEFAULT_EXECUTION_MODEL_PROVIDER_ID,
  );
  const slug = model.split("/").at(-1) || model;
  return (
    provider !== DEEPSEEK_EXECUTION_PROVIDER_ID &&
    model !== DEEPSEEK_EXECUTION_MODEL_VALUE &&
    slug.startsWith("gpt-")
  );
}

export function codexToolExecutionModelOption(
  selected: ChatModelOption | null | undefined,
  options: readonly ChatModelOption[],
): ChatModelOption | null {
  if (supportsCodexToolExecutionModel(selected)) return selected || null;
  return defaultExecutionChatModelOption(
    options.filter(supportsCodexToolExecutionModel),
  );
}

export function mediaCreationExecutionModelOption(
  mode: unknown,
  selected: ChatModelOption | null | undefined,
  options: readonly ChatModelOption[],
): ChatModelOption | null {
  if (mode !== "image-generation" && mode !== "video-generation") {
    return selected || null;
  }
  return codexToolExecutionModelOption(selected, options);
}

export function executionChatModelOptionIdentity(
  option: ChatModelOption | null | undefined,
): string {
  const model = safeText(option?.value).toLowerCase();
  if (!model) return "";
  const provider = safeText(option?.providerId).toLowerCase() || "haolo_ai";
  return JSON.stringify([provider, model]);
}

export function shouldAdoptExecutionPoolDefault(
  currentOption: ChatModelOption | null | undefined,
  rememberedDefaultIdentity: unknown,
  defaultOption: ChatModelOption | null | undefined,
): boolean {
  const nextIdentity = executionChatModelOptionIdentity(defaultOption);
  if (!nextIdentity) return false;
  return (
    !currentOption ||
    safeText(rememberedDefaultIdentity) !== nextIdentity
  );
}

function normalizePoolModel(
  value: unknown,
  fallbackCapabilities: string[],
): BusinessModelPoolModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = value as Record<string, unknown>;
  const id = safeText(model.id ?? model.model);
  if (!id) return null;
  return {
    id,
    displayName: modelDisplayName(
      id,
      safeText(model.displayName ?? model.display_name ?? model.name) || id,
    ),
    provider: safeText(model.provider).toLowerCase(),
    routeGroupId: positiveIntegerOrNull(
      model.routeGroupId ?? model.route_group_id,
    ),
    enabled: model.enabled !== false,
    isDefault: model.isDefault === true || model.is_default === true,
    sortOrder:
      finiteNumber(model.sortOrder ?? model.sort_order) || 0,
    capabilities:
      stringArray(model.capabilities).length > 0
        ? stringArray(model.capabilities)
        : [...fallbackCapabilities],
    credentialAvailable:
      model.credentialAvailable === false ||
      model.credential_available === false
        ? false
        : undefined,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => safeText(item)).filter(Boolean))]
    : [];
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveIntegerOrNull(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
