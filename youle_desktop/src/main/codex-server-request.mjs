const ACCEPTED_DECISIONS = new Set(["accept", "acceptForSession", "acceptAlways"]);
const FIXED_DEFAULT_SERVICE_TIER_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/settings/update",
  "turn/start",
]);

export function withFixedDefaultServiceTier(method, params = {}) {
  if (!FIXED_DEFAULT_SERVICE_TIER_METHODS.has(method)) return params;
  const normalized = params && typeof params === "object" && !Array.isArray(params)
    ? { ...params }
    : {};
  // The app-server protocol uses camelCase. Drop a legacy alias as well so a
  // renderer, channel, or automation path cannot accidentally request Fast.
  delete normalized.service_tier;
  normalized.serviceTier = null;
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
