import {
  normalizeProviderModelProvider,
  providerModelLabel,
} from "./provider-model-catalog.ts";

export type MediaModelProviderGroup<T> = {
  provider: string;
  label: string;
  items: T[];
};

const MEDIA_PROVIDER_LABELS: Record<string, string> = {
  seedance: "Seedance",
};

export function normalizeMediaModelProvider(value: unknown) {
  const raw = safeText(value, 80);
  return normalizeProviderModelProvider(raw) || raw.toLowerCase();
}

export function mediaModelProviderLabel(value: unknown) {
  const provider = normalizeMediaModelProvider(value);
  const knownProvider = normalizeProviderModelProvider(provider);
  return knownProvider
    ? providerModelLabel(knownProvider)
    : MEDIA_PROVIDER_LABELS[provider] || provider || "其他";
}

export function groupMediaModelsByProvider<T extends { provider?: string | null }>(
  models: readonly T[],
): MediaModelProviderGroup<T>[] {
  const groups = new Map<string, MediaModelProviderGroup<T>>();
  for (const model of models) {
    const provider = normalizeMediaModelProvider(model.provider);
    const key = provider || "__unassigned__";
    let group = groups.get(key);
    if (!group) {
      group = {
        provider,
        label: mediaModelProviderLabel(provider),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(model);
  }
  return [...groups.values()];
}

function safeText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    return "";
  }
  return text;
}
