const ACCEPTED_DECISIONS = new Set(["accept", "acceptForSession", "acceptAlways"]);
const FIXED_DEFAULT_SERVICE_TIER_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/settings/update",
  "turn/start",
]);

export const GPT_5_6_SOL_FAST_SERVICE_TIER = "priority";

export function fastestServiceTierForModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const slug = normalized.split("/").at(-1) || normalized;
  return slug === "gpt-5.6-sol" || slug.startsWith("gpt-5.6-sol-")
    ? GPT_5_6_SOL_FAST_SERVICE_TIER
    : null;
}

export function withFixedDefaultServiceTier(method, params = {}) {
  if (!FIXED_DEFAULT_SERVICE_TIER_METHODS.has(method)) return params;
  const normalized = params && typeof params === "object" && !Array.isArray(params)
    ? { ...params }
    : {};
  // The app-server protocol uses camelCase. GPT-5.6 Sol always opts in to
  // OpenAI Fast mode; other explicitly selected models stay on the standard
  // tier. Requests without a model inherit the thread's existing tier.
  const legacyServiceTier = normalized.service_tier;
  delete normalized.service_tier;
  if (String(normalized.model || "").trim()) {
    normalized.serviceTier = fastestServiceTierForModel(normalized.model);
  } else {
    const requestedTier = normalized.serviceTier ?? legacyServiceTier;
    if (requestedTier == null || String(requestedTier).trim().toLowerCase() === "default") {
      delete normalized.serviceTier;
    } else {
      normalized.serviceTier = String(requestedTier).trim();
    }
  }
  return normalized;
}

export function isToolRequestUserInputMethod(method) {
  return method === "item/tool/requestUserInput" || method === "tool/requestUserInput";
}

export function buildServerRequestResult(method, params = {}, requestParams = {}) {
  if (method === "currentTime/read") {
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    return { currentTimeAt: Math.floor(nowMs / 1000) };
  }

  if (method === "item/fileChange/requestApproval" || method === "item/commandExecution/requestApproval") {
    return { decision: params.decision || "decline" };
  }

  if (method === "item/permissions/requestApproval") {
    const decision = params.decision || "decline";
    const permissions = ACCEPTED_DECISIONS.has(decision)
      ? params.permissions || requestParams.permissions || {}
      : {};
    const result = {
      permissions,
      scope: decision === "acceptForSession" || decision === "acceptAlways" || params.scope === "session"
        ? "session"
        : "turn",
    };
    if (typeof params.strictAutoReview === "boolean") {
      result.strictAutoReview = params.strictAutoReview;
    }
    return result;
  }

  if (isToolRequestUserInputMethod(method)) {
    return { answers: params.answers || {} };
  }

  if (method === "mcpServer/elicitation/request") {
    return { action: mcpElicitationActionFromDecision(params.decision), content: params.content || {} };
  }

  return {};
}

function mcpElicitationActionFromDecision(decision) {
  switch (decision) {
    case "accept":
    case "acceptForSession":
    case "acceptAlways":
      return "accept";
    case "cancel":
      return "cancel";
    case "decline":
    default:
      return "decline";
  }
}
