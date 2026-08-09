const IMAGE_INPUT_MODELS = new Set([
  "codex/gpt-5.6-sol",
  "codex/gpt-5.6-terra",
  "codex/gpt-5.6-luna",
  "codex/gpt-5.5",
  "claude/claude-fable-5",
  "kimi/kimi-k3",
  "kimi/kimi-k2.6",
  "grok/grok-4.5",
  "grok/grok-4.3",
  "gemini/gemini-3.5-flash",
  "gemini/gemini-3.1-pro-preview",
  "doubao/doubao-seed-2-1-pro-260628",
  "doubao/doubao-seed-2-1-turbo-260628",
  "mimo/mimo-v2.5",
  "perplexity/sonar-pro",
  "qwen/qwen3.7-plus",
]);

const VIDEO_INPUT_MODELS = new Set([
  "gemini/gemini-3.5-flash",
  "gemini/gemini-3.1-pro-preview",
  "doubao/doubao-seed-2-1-pro-260628",
  "doubao/doubao-seed-2-1-turbo-260628",
]);

const PROVIDER_ALIASES = Object.freeze({
  openai: "codex",
  gpt: "codex",
  anthropic: "claude",
  google: "gemini",
  "google-ai": "gemini",
  bytedance: "doubao",
  volcengine: "doubao",
  ark: "doubao",
});

export function normalizeInputCapabilityProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return PROVIDER_ALIASES[provider] || provider;
}

export function providerModelInputCapabilities(providerValue, modelValue) {
  const provider = normalizeInputCapabilityProvider(providerValue);
  const model = String(modelValue || "").trim().toLowerCase();
  const key = `${provider}/${model}`;
  const image = IMAGE_INPUT_MODELS.has(key);
  const video = VIDEO_INPUT_MODELS.has(key);
  return Object.freeze({
    provider,
    model,
    text: true,
    files: true,
    image,
    video,
    modalities: Object.freeze([
      "text",
      "file",
      ...(image ? ["image"] : []),
      ...(video ? ["video"] : []),
    ]),
  });
}

export function providerModelSupportsInput(provider, model, modality) {
  const capabilities = providerModelInputCapabilities(provider, model);
  const normalized = String(modality || "").trim().toLowerCase();
  if (normalized === "file" || normalized === "files") return capabilities.files;
  if (normalized === "image" || normalized === "images") return capabilities.image;
  if (normalized === "video" || normalized === "videos") return capabilities.video;
  return normalized === "text" ? capabilities.text : false;
}

export function providerInputCapabilityPrompt(provider, model) {
  const capabilities = providerModelInputCapabilities(provider, model);
  const media = [
    capabilities.image ? "图片" : "",
    capabilities.video ? "视频" : "",
  ].filter(Boolean);
  if (!media.length) {
    return "可读取当前分组文件和上传文档，输入问题或上传资料";
  }
  return `可读取当前分组文件、上传文档、${media.join("和")}，输入问题或上传资料`;
}

export function providerInputCapabilityLabels(provider, model) {
  const capabilities = providerModelInputCapabilities(provider, model);
  return [
    "文本",
    "文件",
    ...(capabilities.image ? ["图片"] : []),
    ...(capabilities.video ? ["视频"] : []),
  ];
}
