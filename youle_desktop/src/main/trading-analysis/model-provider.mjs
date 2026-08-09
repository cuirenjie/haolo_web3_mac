export const TRADING_ANALYSIS_MODEL_REQUEST_SCHEMA_VERSION = 1;
export const TRADING_ANALYSIS_MODEL_RESPONSE_SCHEMA_VERSION = 1;

export class TradingAnalysisModelProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "TradingAnalysisModelProviderError";
    this.code = String(options.code || "TRADING_ANALYSIS_MODEL_FAILED");
    this.providerId = String(options.providerId || "");
    this.modelId = String(options.modelId || "");
    this.retryable = options.retryable === true;
  }
}
function requiredText(value, field, maximum = 120) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

export function normalizeTradingAnalysisModelRequest(value = {}) {
  if (Number(value?.schemaVersion) !== TRADING_ANALYSIS_MODEL_REQUEST_SCHEMA_VERSION) {
    throw new TypeError("Unsupported trading analysis model request schemaVersion");
  }
  const prompt = String(value?.prompt || "").trim();
  if (!prompt || prompt.length > 120_000) throw new TypeError("prompt is invalid");
  return {
    schemaVersion: TRADING_ANALYSIS_MODEL_REQUEST_SCHEMA_VERSION,
    requestId: requiredText(value.requestId, "requestId"),
    task: requiredText(value.task, "task", 80),
    theoryId: requiredText(value.theoryId, "theoryId", 40),
    snapshotId: requiredText(value.snapshotId, "snapshotId"),
    prompt,
    responseFormat: value.responseFormat === "json" ? "json" : "text",
  };
}

export function createTradingAnalysisModelProviderRegistry(providers = []) {
  const providersById = new Map();
  for (const provider of providers) {
    const providerId = requiredText(provider?.providerId, "providerId", 80);
    if (typeof provider?.analyze !== "function") {
      throw new TypeError(`Trading analysis provider ${providerId} must implement analyze()`);
    }
    if (providersById.has(providerId)) {
      throw new TypeError(`Duplicate trading analysis provider: ${providerId}`);
    }
    providersById.set(providerId, provider);
  }

  return Object.freeze({
    list() {
      return [...providersById.values()].map((provider) => ({
        providerId: provider.providerId,
        modelId: provider.modelId,
        capabilities: { ...(provider.capabilities || {}) },
      }));
    },
    has(providerId) {
      return providersById.has(String(providerId || ""));
    },
    async analyze(providerId, request, options = {}) {
      const provider = providersById.get(String(providerId || ""));
      if (!provider) {
        throw new TradingAnalysisModelProviderError(
          `Trading analysis provider is unavailable: ${providerId}`,
          { code: "TRADING_ANALYSIS_PROVIDER_UNAVAILABLE", providerId },
        );
      }
      const normalizedRequest = normalizeTradingAnalysisModelRequest(request);
      const startedAt = Date.now();
      try {
        const result = await provider.analyze(normalizedRequest, options);
        const text = String(result?.text || "").trim();
        if (!text) {
          throw new TradingAnalysisModelProviderError("Trading analysis model returned an empty response", {
            code: "TRADING_ANALYSIS_MODEL_EMPTY_RESPONSE",
            providerId: provider.providerId,
            modelId: provider.modelId,
          });
        }
        return {
          schemaVersion: TRADING_ANALYSIS_MODEL_RESPONSE_SCHEMA_VERSION,
          requestId: normalizedRequest.requestId,
          providerId: String(result?.providerId || provider.providerId),
          modelId: String(result?.modelId || provider.modelId),
          text,
          latencyMs: Math.max(0, Number(result?.latencyMs) || Date.now() - startedAt),
          usage: result?.usage && typeof result.usage === "object" ? { ...result.usage } : null,
          finishReason: String(result?.finishReason || "completed"),
        };
      } catch (error) {
        if (error instanceof TradingAnalysisModelProviderError) throw error;
        throw new TradingAnalysisModelProviderError(
          String(error?.message || error || "Trading analysis model failed"),
          {
            cause: error,
            code: String(error?.code || "TRADING_ANALYSIS_MODEL_FAILED"),
            providerId: provider.providerId,
            modelId: provider.modelId,
            retryable: error?.retryable === true,
          },
        );
      }
    },
  });
}
