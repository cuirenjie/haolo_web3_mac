import { canonicalDeepSeekModel } from "../main/deepseek-model-policy.mjs";
import { modelDisplayName } from "./model-display-name.ts";
import { DEFAULT_EXECUTION_MODEL, isRetiredExecutionModel } from "../main/retired-model-policy.mjs";

export const CHAT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ChatModelReasoningEffort = (typeof CHAT_REASONING_EFFORTS)[number];

export type ChatModelReasoningOption = {
  value: ChatModelReasoningEffort;
  description: string;
};

export type ChatModelServiceTier = {
  id: string;
  name: string;
  description: string;
};

export type ChatModelOption = {
  value: string;
  providerId?: string;
  providerLabel?: string;
  routeGroupId?: number | null;
  credentialAvailable?: boolean;
  label: string;
  description: string;
  reasoningEfforts: ChatModelReasoningOption[];
  defaultReasoningEffort?: ChatModelReasoningEffort;
  serviceTiers: ChatModelServiceTier[];
  defaultServiceTier?: string;
  inputModalities: string[];
  isDefault?: boolean;
  priceLabel?: string;
};

export const DEFAULT_CHAT_MODEL_VALUE = DEFAULT_EXECUTION_MODEL;
export const LEGACY_DEFAULT_CHAT_MODEL_VALUE = "gpt-5.6-terra";
export const DEEPSEEK_EXECUTION_MODEL_VALUE = "deepseek-flash";
export const DEEPSEEK_EXECUTION_PROVIDER_ID = "deepseek";

const PRIORITY_TIER: ChatModelServiceTier = {
  id: "priority",
  name: "Fast",
  description: "Faster responses with increased usage.",
};

function reasoningOptions(values: readonly ChatModelReasoningEffort[]): ChatModelReasoningOption[] {
  return values.map((value) => ({ value, description: "" }));
}

export const FIXED_CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
    description: "",
    reasoningEfforts: reasoningOptions(["low", "medium", "high", "xhigh", "max", "ultra"]),
    defaultReasoningEffort: "max",
    isDefault: true,
    serviceTiers: [PRIORITY_TIER],
    inputModalities: ["text", "image"],
  },
  {
    value: "gpt-6-sol",
    label: "GPT-6-Sol",
    description: "",
    reasoningEfforts: reasoningOptions(["low", "medium", "high", "xhigh", "max", "ultra"]),
    defaultReasoningEffort: "max",
    serviceTiers: [PRIORITY_TIER],
    inputModalities: ["text", "image"],
  },
  {
    value: "gpt-6-astra",
    label: "GPT-6-Astra",
    description: "",
    reasoningEfforts: reasoningOptions(["low", "medium", "high", "xhigh", "max", "ultra"]),
    defaultReasoningEffort: "max",
    serviceTiers: [PRIORITY_TIER],
    inputModalities: ["text", "image"],
  },
];

export const DEEPSEEK_EXECUTION_CHAT_MODEL_OPTION: Readonly<ChatModelOption> = {
  value: DEEPSEEK_EXECUTION_MODEL_VALUE,
  providerId: DEEPSEEK_EXECUTION_PROVIDER_ID,
  providerLabel: "DeepSeek",
  label: "GPT-6 Astra",
  description: "Latest frontier agentic coding model.",
  reasoningEfforts: reasoningOptions(["low", "high", "max"]),
  defaultReasoningEffort: "max",
  serviceTiers: [],
  inputModalities: ["text"],
};

export function normalizeFixedChatModel(value: unknown): string {
  const selected = String(value ?? "").trim().toLowerCase();
  return (
    FIXED_CHAT_MODEL_OPTIONS.find((option) => option.value.toLowerCase() === selected)?.value ||
    FIXED_CHAT_MODEL_OPTIONS.find((option) => option.isDefault)?.value ||
    DEFAULT_CHAT_MODEL_VALUE
  );
}

export function normalizeReasoningEffort(value: unknown): ChatModelReasoningEffort | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (CHAT_REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as ChatModelReasoningEffort)
    : undefined;
}

export function chatModelOptionsFromList(payload: unknown): ChatModelOption[] {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(source.data) ? source.data : Array.isArray(source.models) ? source.models : [];
  const options: ChatModelOption[] = [];
  const seen = new Set<string>();

  for (const rowValue of rows) {
    if (!rowValue || typeof rowValue !== "object") continue;
    const row = rowValue as Record<string, unknown>;
    if (row.hidden === true) continue;
    const value = canonicalDeepSeekModel(firstString(row.id, row.model, row.slug));
    if (!value || isRetiredExecutionModel(value) || seen.has(value)) continue;

    const reasoningRows = firstArray(row.supportedReasoningEfforts, row.supported_reasoning_efforts);
    const reasoningEfforts: ChatModelReasoningOption[] = [];
    const seenEfforts = new Set<string>();
    for (const effortValue of reasoningRows) {
      const effortRow = effortValue && typeof effortValue === "object" ? (effortValue as Record<string, unknown>) : null;
      const effort = normalizeReasoningEffort(
        effortRow ? firstValue(effortRow.reasoningEffort, effortRow.reasoning_effort, effortRow.effort, effortRow.value) : effortValue,
      );
      if (!effort || seenEfforts.has(effort)) continue;
      seenEfforts.add(effort);
      reasoningEfforts.push({
        value: effort,
        description: effortRow ? firstString(effortRow.description) : "",
      });
    }
    const defaultReasoningEffort = normalizeReasoningEffort(
      firstValue(row.defaultReasoningEffort, row.default_reasoning_effort),
    );
    if (defaultReasoningEffort && !seenEfforts.has(defaultReasoningEffort)) {
      reasoningEfforts.push({ value: defaultReasoningEffort, description: "" });
    }

    const serviceTiers = normalizeServiceTiers(
      firstArray(row.serviceTiers, row.service_tiers),
      firstArray(row.additionalSpeedTiers, row.additional_speed_tiers),
    );
    const requestedDefaultTier = firstString(row.defaultServiceTier, row.default_service_tier);
    const defaultServiceTier = serviceTiers.some((tier) => tier.id === requestedDefaultTier)
      ? requestedDefaultTier
      : undefined;

    options.push({
      value,
      providerId: firstString(row.modelProvider, row.model_provider) || undefined,
      label: modelDisplayName(value, firstString(row.displayName, row.display_name, row.name) || value),
      description: firstString(row.description),
      reasoningEfforts,
      defaultReasoningEffort:
        defaultReasoningEffort && reasoningEfforts.some((option) => option.value === defaultReasoningEffort)
          ? defaultReasoningEffort
          : reasoningEfforts[0]?.value,
      serviceTiers,
      defaultServiceTier,
      inputModalities: normalizeStringArray(firstArray(row.inputModalities, row.input_modalities)),
      isDefault: row.isDefault === true || row.is_default === true,
    });
    seen.add(value);
  }
  return options;
}

export function selectedReasoningEffort(
  option: ChatModelOption,
  preferred: unknown,
): ChatModelReasoningEffort | undefined {
  const normalized = normalizeReasoningEffort(preferred);
  if (normalized && option.reasoningEfforts.some((item) => item.value === normalized)) return normalized;
  if (
    option.defaultReasoningEffort &&
    option.reasoningEfforts.some((item) => item.value === option.defaultReasoningEffort)
  ) {
    return option.defaultReasoningEffort;
  }
  return option.reasoningEfforts[0]?.value;
}

export function fastServiceTier(option: ChatModelOption): ChatModelServiceTier | undefined {
  return (
    option.serviceTiers.find((tier) => tier.id.toLowerCase() === "priority") ||
    option.serviceTiers.find((tier) => /fast|priority/i.test(`${tier.id} ${tier.name}`))
  );
}

function normalizeServiceTiers(serviceRows: unknown[], additionalRows: unknown[]): ChatModelServiceTier[] {
  const tiers: ChatModelServiceTier[] = [];
  const seen = new Set<string>();
  for (const tierValue of [...serviceRows, ...additionalRows]) {
    const tierRow = tierValue && typeof tierValue === "object" ? (tierValue as Record<string, unknown>) : null;
    const id = firstString(tierRow?.id, tierRow?.value, tierValue);
    if (!id || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    tiers.push({
      id,
      name: firstString(tierRow?.name, tierRow?.label) || (id === "priority" ? "Fast" : id),
      description: firstString(tierRow?.description),
    });
  }
  return tiers;
}

function normalizeStringArray(values: unknown[]) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized && normalized.length <= 32) seen.add(normalized);
  }
  return [...seen];
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
