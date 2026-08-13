import { normalizeDataRequirement } from "./protocol.mjs";

function text(value, field) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 160) throw new TypeError(`${field} is invalid`);
  return result;
}

export function normalizeCapabilityManifest(value = {}) {
  const capabilityId = text(value.capabilityId, "capabilityId");
  const fields = [...new Set((Array.isArray(value.fields) ? value.fields : []).map((entry) => text(entry, "field")))];
  if (!fields.length) throw new TypeError("capability fields are required");
  return Object.freeze({
    capabilityId,
    providerId: text(value.providerId, "providerId").toLowerCase(),
    displayName: text(value.displayName || value.providerId, "displayName"),
    fields: Object.freeze(fields),
    markets: Object.freeze((Array.isArray(value.markets) ? value.markets : ["*"]).map((entry) => text(entry, "market").toUpperCase())),
    minFrequencyMs: Math.max(1, Math.floor(Number(value.minFrequencyMs) || 1_000)),
    typicalLatencyMs: Math.max(0, Math.floor(Number(value.typicalLatencyMs) || 0)),
    maxHistoryWindow: Math.max(0, Math.floor(Number(value.maxHistoryWindow) || 0)),
    permission: ["public", "read_only_account", "wallet_signature"].includes(value.permission) ? value.permission : "public",
    connectionState: ["connected", "disconnected", "degraded"].includes(value.connectionState) ? value.connectionState : "disconnected",
    secureSetupRoute: String(value.secureSetupRoute || "settings/data-providers").slice(0, 240),
    docsUrl: String(value.docsUrl || "").slice(0, 1_000),
    priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : 100,
  });
}

export class TradingAlertCapabilityRegistry {
  constructor(manifests = []) {
    this.manifests = new Map();
    for (const manifest of manifests) this.register(manifest);
  }

  register(value) {
    const manifest = normalizeCapabilityManifest(value);
    const key = `${manifest.capabilityId}:${manifest.providerId}`;
    if (this.manifests.has(key)) throw new TypeError(`Duplicate capability provider: ${key}`);
    this.manifests.set(key, manifest);
    return manifest;
  }

  list(capabilityId) {
    return [...this.manifests.values()]
      .filter((entry) => !capabilityId || entry.capabilityId === capabilityId)
      .sort((a, b) => a.priority - b.priority || a.typicalLatencyMs - b.typicalLatencyMs);
  }

  setConnection(providerId, connectionState) {
    const state = ["connected", "disconnected", "degraded"].includes(connectionState) ? connectionState : "disconnected";
    let updated = 0;
    for (const [key, manifest] of this.manifests) if (manifest.providerId === String(providerId).toLowerCase()) {
      this.manifests.set(key, Object.freeze({ ...manifest, connectionState: state }));
      updated += 1;
    }
    return updated;
  }

  resolve(requirementValue) {
    const requirement = normalizeDataRequirement(requirementValue);
    const candidates = this.list(requirement.capability).map((provider) => {
      const missingFields = requirement.fields.filter((field) => !provider.fields.includes(field));
      const missingMarkets = (requirement.markets || []).filter((market) => !provider.markets.includes("*") && !provider.markets.includes(market));
      const blockers = [];
      if (missingFields.length) blockers.push(`缺少字段：${missingFields.join("、")}`);
      if (missingMarkets.length) blockers.push(`不覆盖市场：${missingMarkets.join("、")}`);
      if (requirement.minFrequencyMs && provider.minFrequencyMs > requirement.minFrequencyMs) blockers.push("更新频率不足");
      if (requirement.maxLatencyMs !== undefined && provider.typicalLatencyMs > requirement.maxLatencyMs) blockers.push("典型延迟过高");
      if (requirement.historyWindow && provider.maxHistoryWindow < requirement.historyWindow) blockers.push("历史窗口不足");
      if (provider.permission !== requirement.permission && requirement.permission !== "public") blockers.push("权限类型不匹配");
      return Object.freeze({ provider, blockers: Object.freeze(blockers), compatible: blockers.length === 0 });
    });
    const compatible = candidates.filter((entry) => entry.compatible);
    const connected = compatible.find((entry) => entry.provider.connectionState === "connected");
    const selected = connected || compatible[0] || null;
    const status = connected ? "available" : selected ? "awaiting_user" : "missing";
    return Object.freeze({
      requirement: normalizeDataRequirement({
        ...requirement,
        status,
        candidateProviders: compatible.map((entry) => entry.provider.providerId),
        ...(connected ? { selectedProvider: connected.provider.providerId } : {}),
      }),
      selected,
      candidates: Object.freeze(candidates),
      action: status === "available" ? "continue" : selected ? "connect_provider" : "request_adapter_or_data",
    });
  }
}

export function requirementsFromRule(rule) {
  const requirements = new Map((rule.dataRequirements || []).map((entry) => [entry.requirementId, entry]));
  const contexts = new Map(rule.contexts.map((context) => [context.contextId, context]));
  const add = (key, value) => {
    const previous = requirements.get(key);
    if (!previous) {
      requirements.set(key, normalizeDataRequirement(value));
      return;
    }
    requirements.set(key, normalizeDataRequirement({
      ...previous,
      fields: [...new Set([...previous.fields, ...(value.fields || [])])],
      historyWindow: Math.max(previous.historyWindow || 0, value.historyWindow || 0),
    }));
  };
  const walkExpr = (expr, context, lookback = 0) => {
    if (expr.type === "field" || expr.type === "indicator") {
      const fields = expr.type === "field" ? [expr.field] : ["open", "high", "low", "close", "volume"];
      const historyWindow = expr.type === "indicator"
        ? Math.max(100, Number(expr.params?.period) || Number(expr.params?.slow) || 100) * 3 + lookback
        : Math.max(2, lookback + 2);
      add(`market-${context.contextId}`, {
        requirementId: `market-${context.contextId}`,
        capability: "market.ohlcv",
        fields,
        markets: context.marketSelector.kind === "fixed" ? context.marketSelector.marketIds : undefined,
        minFrequencyMs: 1_000,
        maxLatencyMs: 5_000,
        historyWindow,
        permission: "public",
        status: "missing",
        candidateProviders: [],
      });
    }
    if (expr.type === "external") add(`external-${expr.capability.replace(/[^A-Za-z0-9_.-]/g, "-")}`, {
      requirementId: `external-${expr.capability.replace(/[^A-Za-z0-9_.-]/g, "-")}`,
      capability: expr.capability,
      fields: [expr.field],
      permission: "public",
      status: "missing",
      candidateProviders: [],
    });
    if (expr.type === "lag") walkExpr(expr.expr, context, lookback + expr.bars);
    if (expr.type === "rolling") walkExpr(expr.expr, context, lookback + expr.offset + expr.period - 1);
    for (const child of expr.args || []) walkExpr(child, context, lookback);
  };
  const walk = (node) => {
    if (node.type === "condition") {
      const context = contexts.get(node.condition.contextId);
      walkExpr(node.condition.left, context);
      walkExpr(node.condition.right, context);
    }
    if (node.child) walk(node.child);
    for (const child of node.children || node.steps || []) walk(child);
  };
  walk(rule.root);
  return Object.freeze([...requirements.values()]);
}

export function resolveRuleCapabilities(rule, registry) {
  const resolutions = requirementsFromRule(rule).map((requirement) => registry.resolve(requirement));
  return Object.freeze({
    requirements: Object.freeze(resolutions.map((entry) => entry.requirement)),
    resolutions: Object.freeze(resolutions),
    ready: resolutions.every((entry) => entry.action === "continue"),
    status: resolutions.every((entry) => entry.action === "continue")
      ? "ready_to_simulate"
      : resolutions.some((entry) => entry.action === "connect_provider") ? "awaiting_authorization" : "awaiting_data",
  });
}

export function capabilityResolutionGuide(resolution) {
  if (resolution.action === "continue") return "数据能力已连接并验证，可继续模拟。";
  if (resolution.action === "connect_provider") {
    const provider = resolution.selected.provider;
    return `需要连接 ${provider.displayName}。请在“设置 → 数据提供方”完成只读授权；不要在聊天中发送 API Key。授权后会继续处理当前条件。`;
  }
  return `当前没有提供“${resolution.requirement.capability}”所需字段的适配器。请提供匹配的数据接口、插件、MCP、Webhook、数据库或文件样例；Haolo 验证 Schema、覆盖范围、时效和权限后会继续处理当前条件。`;
}

export function createBuiltinCapabilityRegistry({ marketConnected = true } = {}) {
  return new TradingAlertCapabilityRegistry([
    {
      capabilityId: "market.ohlcv",
      providerId: "binance-public",
      displayName: "Binance 公共行情",
      fields: ["open", "high", "low", "close", "volume", "last", "mark", "index"],
      markets: ["*"],
      minFrequencyMs: 250,
      typicalLatencyMs: 500,
      maxHistoryWindow: 1_500,
      permission: "public",
      connectionState: marketConnected ? "connected" : "disconnected",
      priority: 10,
    },
    {
      capabilityId: "market.ohlcv",
      providerId: "hyperliquid-public",
      displayName: "Hyperliquid 公共行情",
      fields: ["open", "high", "low", "close", "volume", "last", "mark", "index"],
      markets: ["*"],
      minFrequencyMs: 500,
      typicalLatencyMs: 1_000,
      maxHistoryWindow: 5_000,
      permission: "public",
      connectionState: marketConnected ? "connected" : "disconnected",
      secureSetupRoute: "settings/data-providers/hyperliquid",
      docsUrl: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api",
      priority: 20,
    },
  ]);
}
