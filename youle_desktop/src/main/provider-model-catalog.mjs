const NON_CHAT_MODEL_ID_PATTERN =
  /(?:^|[-_.:/])(?:embedding|embeddings|moderation|rerank|reranker|whisper|transcribe|transcription|tts|speech|sora|video|veo|seedance|kling|grok-imagine)(?:$|[-_.:/\d])/i;
const IMAGE_MODEL_ID_PATTERN =
  /(?:^|[-_.:/])(?:(?:gpt-)?image|imagen|dall-e|stable-diffusion|flux|recraft|seedream|ideogram|midjourney|kolors|hidream|sdxl|grok-imagine)(?:$|[-_.:/\d])/i;
const GEMINI_IMAGE_MODEL_ID_PATTERN =
  /(?:^|[-_.:/])gemini(?:$|[-_.:/\d]).*(?:^|[-_.:/])image(?:$|[-_.:/\d])/i;
const VIDEO_MODEL_ID_PATTERN =
  /(?:^|[-_.:/])(?:video|sora|veo|seedance|kling)(?:$|[-_.:/\d])/i;
const NON_CHAT_TYPE_PATTERN = /(?:embedding|moderation|rerank|image|video|audio|speech|transcription)/i;
const POSITIVE_CHAT_CAPABILITIES = new Set([
  "chat",
  "chat_completion",
  "chat-completion",
  "messages",
  "reasoning",
  "responses",
  "text",
  "text_generation",
  "text-generation",
]);
const NON_CHAT_CAPABILITIES = new Set([
  "audio",
  "embedding",
  "embeddings",
  "image",
  "moderation",
  "rerank",
  "speech",
  "transcription",
  "video",
]);
const IMAGE_GENERATION_CAPABILITIES = new Set([
  "image_generation",
  "image-generation",
  "image_edit",
  "image-edit",
  "images.generations",
  "images.edits",
]);

export function normalizeRelayProviderModels(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rows = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : [];
  const models = [];
  const seen = new Set();

  for (const rowValue of rows) {
    const row =
      typeof rowValue === "string"
        ? { id: rowValue }
        : rowValue && typeof rowValue === "object" && !Array.isArray(rowValue)
          ? rowValue
          : null;
    if (!row || row.hidden === true || !isChatCompatibleRelayModel(row)) continue;
    const id = safeCatalogText(firstValue(row.id, row.model, row.slug, row.name), 200);
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    models.push({
      id,
      displayName:
        safeCatalogText(
          firstValue(row.display_name, row.displayName, row.label, row.name),
          160,
        ) || id,
      isDefault: row.is_default === true || row.isDefault === true,
    });
  }
  return models;
}

export function normalizeRelayImageModels(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rows = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : [];
  const models = [];
  const seen = new Set();

  for (const rowValue of rows) {
    const row =
      typeof rowValue === "string"
        ? { id: rowValue }
        : rowValue && typeof rowValue === "object" && !Array.isArray(rowValue)
          ? rowValue
          : null;
    if (!row || row.hidden === true || !isImageGenerationRelayModel(row)) continue;
    const id = safeCatalogText(firstValue(row.id, row.model, row.slug, row.name), 200);
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    models.push({
      id,
      displayName:
        safeCatalogText(
          firstValue(row.display_name, row.displayName, row.label, row.name),
          160,
        ) || id,
      isDefault: row.is_default === true || row.isDefault === true,
      unitPoints: positiveCatalogNumber(
        firstValue(row.unit_points, row.unitPoints),
      ),
      billingUnit: safeCatalogText(
        firstValue(row.billing_unit, row.billingUnit),
        32,
      ),
    });
  }
  return models;
}

function positiveCatalogNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function isChatCompatibleRelayModel(row) {
  const explicit = firstValue(row.chat_compatible, row.chatCompatible);
  if (explicit === true) return true;
  if (explicit === false) return false;

  const capabilities = normalizeCatalogStringArray(
    firstArray(row.capabilities, row.supported_capabilities, row.supportedCapabilities),
  );
  if (capabilities.some((value) => POSITIVE_CHAT_CAPABILITIES.has(value))) return true;
  if (
    capabilities.length > 0 &&
    capabilities.every((value) => NON_CHAT_CAPABILITIES.has(value))
  ) {
    return false;
  }

  const outputModalities = normalizeCatalogStringArray(
    firstArray(row.output_modalities, row.outputModalities),
  );
  if (outputModalities.includes("text")) return true;
  if (
    outputModalities.length > 0 &&
    outputModalities.every((value) => value !== "text")
  ) {
    return false;
  }

  const typeText = safeCatalogText(
    firstValue(row.type, row.model_type, row.modelType),
    80,
  );
  if (typeText && typeText !== "model" && NON_CHAT_TYPE_PATTERN.test(typeText)) {
    return false;
  }

  const id = safeCatalogText(firstValue(row.id, row.model, row.slug, row.name), 200);
  if (!id) return false;
  return (
    !NON_CHAT_MODEL_ID_PATTERN.test(id) &&
    !IMAGE_MODEL_ID_PATTERN.test(id) &&
    !GEMINI_IMAGE_MODEL_ID_PATTERN.test(id)
  );
}

export function isImageGenerationRelayModel(row) {
  const explicit = firstValue(
    row.image_generation_compatible,
    row.imageGenerationCompatible,
  );
  if (explicit === true) return true;
  if (explicit === false) return false;

  const capabilities = normalizeCatalogStringArray(
    firstArray(row.capabilities, row.supported_capabilities, row.supportedCapabilities),
  );
  if (capabilities.some((value) => IMAGE_GENERATION_CAPABILITIES.has(value))) {
    return true;
  }
  if (
    capabilities.some((value) => value === "image" || value === "images") &&
    !capabilities.some((value) => POSITIVE_CHAT_CAPABILITIES.has(value))
  ) {
    return true;
  }

  const outputModalities = normalizeCatalogStringArray(
    firstArray(row.output_modalities, row.outputModalities),
  );
  if (
    outputModalities.includes("image") &&
    !outputModalities.includes("video")
  ) {
    return true;
  }

  const typeText = safeCatalogText(
    firstValue(row.type, row.model_type, row.modelType),
    80,
  ).toLowerCase();
  if (typeText.includes("video")) return false;
  if (typeText.includes("image")) return true;

  const id = safeCatalogText(firstValue(row.id, row.model, row.slug, row.name), 200);
  if (!id || VIDEO_MODEL_ID_PATTERN.test(id)) return false;
  return IMAGE_MODEL_ID_PATTERN.test(id) || GEMINI_IMAGE_MODEL_ID_PATTERN.test(id);
}

export function providerModelCatalogErrorMessage(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return "模型目录鉴权失败";
  if (status === 429) return "模型目录请求过于频繁";
  if (error?.code === "REQUEST_TIMEOUT" || error?.name === "AbortError") {
    return "模型目录请求超时";
  }
  return "模型目录暂时不可用";
}

function normalizeCatalogStringArray(values) {
  return values
    .map((value) => safeCatalogText(value, 80).toLowerCase())
    .filter(Boolean);
}

function safeCatalogText(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    return "";
  }
  return text;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}
