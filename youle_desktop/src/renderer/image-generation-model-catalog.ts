import type { ChatModelOption } from "./chat-model-catalog";
import {
  groupMediaModelsByProvider,
  normalizeMediaModelProvider,
} from "./media-model-groups.ts";
import {
  mediaModelPriceLabel,
  normalizeMediaModelBillingUnit,
  normalizeMediaModelUnitPoints,
  type MediaModelBillingUnit,
} from "./media-model-pricing.ts";

export type ImageGenerationCatalogModel = {
  id: string;
  displayName: string;
  isDefault: boolean;
  provider: string;
  requiredImageCount: number | null;
  maxImageCount: number | null;
  maxImageTotalBytes: number | null;
  maxImageLongEdge: number | null;
  unitPoints: number | null;
  billingUnit: MediaModelBillingUnit;
};

export type ImageGenerationModelGroup = {
  provider: string;
  label: string;
  options: ChatModelOption[];
};

export type ImageGenerationModelCatalogState = {
  loading: boolean;
  loaded: boolean;
  status: "online" | "standby" | "error";
  models: ImageGenerationCatalogModel[];
  stale: boolean;
  fetchedAt: string | null;
  error: string | null;
};

export function createImageGenerationModelCatalogState(): ImageGenerationModelCatalogState {
  return {
    loading: false,
    loaded: false,
    status: "standby",
    models: [],
    stale: false,
    fetchedAt: null,
    error: null,
  };
}

export function normalizeImageGenerationModelCatalog(
  payload: unknown,
): Omit<ImageGenerationModelCatalogState, "loading"> {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const models = normalizeModels(source.models ?? source.data);
  const status =
    source.status === "error" ? "error" : models.length > 0 ? "online" : "standby";
  return {
    loaded: true,
    status,
    models,
    stale: source.stale === true,
    fetchedAt:
      safeText(source.fetchedAt ?? source.fetched_at, 80) ||
      new Date().toISOString(),
    error:
      status === "error"
        ? safeText(source.error, 160) || "生图模型目录暂时不可用"
        : null,
  };
}

export function imageGenerationModelOptions(
  catalog: ImageGenerationModelCatalogState,
): ChatModelOption[] {
  if (!catalog.models.length) return [];
  const defaultModel =
    catalog.models.find((model) => model.isDefault)?.id ||
    catalog.models[0].id;
  return catalog.models.map((model) => ({
    value: model.id,
    label: model.displayName || model.id,
    description: model.id,
    reasoningEfforts: [],
    serviceTiers: [],
    inputModalities: ["text", "image"],
    isDefault: model.id.toLowerCase() === defaultModel.toLowerCase(),
    priceLabel: mediaModelPriceLabel(model.unitPoints, model.billingUnit),
  }));
}

export function imageGenerationModelGroups(
  catalog: ImageGenerationModelCatalogState,
): ImageGenerationModelGroup[] {
  const optionsByID = new Map(
    imageGenerationModelOptions(catalog).map((option) => [
      option.value.toLowerCase(),
      option,
    ]),
  );
  return groupMediaModelsByProvider(catalog.models)
    .map((group) => ({
      provider: group.provider,
      label: group.label,
      options: group.items
        .map((model) => optionsByID.get(model.id.toLowerCase()))
        .filter((option): option is ChatModelOption => Boolean(option)),
    }))
    .filter((group) => group.options.length > 0);
}

function normalizeModels(value: unknown): ImageGenerationCatalogModel[] {
  if (!Array.isArray(value)) return [];
  const models: ImageGenerationCatalogModel[] = [];
  const seen = new Set<string>();
  for (const itemValue of value) {
    const item =
      typeof itemValue === "string"
        ? { id: itemValue }
        : itemValue && typeof itemValue === "object" && !Array.isArray(itemValue)
          ? (itemValue as Record<string, unknown>)
          : null;
    if (!item) continue;
    const id = safeText(item.id ?? item.model ?? item.slug ?? item.name, 200);
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    models.push({
      id,
      displayName:
        safeText(
          item.displayName ?? item.display_name ?? item.label ?? item.name,
          160,
        ) || id,
      isDefault: item.isDefault === true || item.is_default === true,
      provider: normalizeMediaModelProvider(item.provider),
      requiredImageCount: safeNonNegativeInteger(
        item.requiredImageCount ?? item.required_image_count,
      ),
      maxImageCount: safeNonNegativeInteger(
        item.maxImageCount ?? item.max_image_count,
      ),
      maxImageTotalBytes: safeNonNegativeInteger(
        item.maxImageTotalBytes ?? item.max_image_total_bytes,
      ),
      maxImageLongEdge: safeNonNegativeInteger(
        item.maxImageLongEdge ?? item.max_image_long_edge,
      ),
      unitPoints: normalizeMediaModelUnitPoints(
        item.unitPoints ?? item.unit_points,
      ),
      billingUnit: normalizeMediaModelBillingUnit(
        item.billingUnit ?? item.billing_unit,
      ),
    });
  }
  return models;
}

function safeNonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    return "";
  }
  return text;
}
