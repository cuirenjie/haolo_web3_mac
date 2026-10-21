import { OFFICIAL_TRADING_CATALOG } from '../../shared/official-trading-catalog.mjs';
import type { TradingQuestionKind } from "../../main/trading-analysis/request-routing-policy.mjs";

export interface TradingStrategyRequest {
  /** Frozen only by the pure desktop composer shortcut; ordinary tools use the existing selection. */
  executionModel?: { model: string; explicitModelSelection: boolean };
  drawingTurnId?: string;
  marketId?: string;
  mode: "conversation" | "chart-analysis";
  instruction: string;
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  forecastHorizonMs?: number | null;
  questionKinds?: readonly TradingQuestionKind[];
  /** Semantic router classified this turn as position management. */
  positionManagementRequested?: boolean;
  drawingRequested: boolean;
  deferPresentation?: boolean;
}

export interface TradingStrategyPublicManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  display: { name: string; group: "strategy" | "indicator"; sortOrder: number };
  mentions: { canonical: string; aliases?: string[] };
  implementation: { kind: "builtin-adapter" | "declarative-v1" | "cloud-v1"; adapterId?: string };
  capabilities: string[];
  dataRequirements?: Record<string, {
    required?: boolean;
    minCount?: number | null;
    preferredCount?: number | null;
    minimumCoverage?: string | null;
  }>;
  chartIndicator?: { id: string; scope: "main" | "sub"; parameters: number[] } | null;
  personalContext?: {
    direction?: string;
    rules?: string[];
    risk?: { stopLoss?: number | null; takeProfit?: number | null; riskReward?: number | null };
    exceptions?: string[];
  } | null;
  enabled?: boolean;
  diagnostic?: string | null;
  disabledReason?: string | null;
}

export interface TradingStrategySkillMetadata {
  displayName: string;
  shortDescription: string;
  defaultPrompt: string;
}

interface StrategyUiAdapter {
  preparingMessage: string;
  completionPhase: string;
  completionMetric(result: TradingStrategyConversationResult): string;
}

export interface TradingStrategyConversationResult {
  report: string;
  narrative: string;
  marketId: string;
  symbol: string;
  interval: string;
  candleCount: number;
  tradeCount?: number;
  modelName: string;
}

export const MAX_TRADING_STRATEGY_MENTIONS = 3;

export interface TradingStrategyCatalogItem extends TradingStrategyPublicManifest {
  mentionTokens: readonly string[];
  skill: TradingStrategySkillMetadata;
  ui: StrategyUiAdapter;
}

const BUILTIN_UI_ADAPTERS: Readonly<Record<string, StrategyUiAdapter>> = Object.freeze({
  chan: {
    preparingMessage: "正在理解你的缠论看盘指令并读取当前画布。",
    completionPhase: "complete",
    completionMetric: (result) => `${result.candleCount} 根 K 线的缠论分析`,
  },
  "order-flow": {
    preparingMessage: "正在理解你的订单流看盘指令并读取当前画布与真实微观结构数据。",
    completionPhase: "order-flow-complete",
    completionMetric: (result) => `${result.tradeCount ?? 0} 笔真实成交的订单流分析`,
  },
  wave: {
    preparingMessage: "正在理解你的波浪理论看盘指令并读取当前画布。",
    completionPhase: "wave-complete",
    completionMetric: (result) => `${result.candleCount} 根 K 线的波浪理论分析`,
  },
  wyckoff: {
    preparingMessage: "正在理解你的威科夫看盘指令并读取当前画布。",
    completionPhase: "wyckoff-complete",
    completionMetric: (result) => `${result.candleCount} 根 K 线的威科夫分析`,
  },
  harmonic: {
    preparingMessage: "正在理解你的谐波形态看盘指令并读取当前画布。",
    completionPhase: "harmonic-complete",
    completionMetric: (result) => `${result.candleCount} 根 K 线的谐波形态分析`,
  },
});

function mentionTokens(manifest: TradingStrategyPublicManifest) {
  const names = [...new Set([
    manifest.mentions.canonical,
    ...(manifest.mentions.aliases || []),
    manifest.display.name,
  ].map((name) => String(name || "").trim()).filter(Boolean))];
  const group = manifest.display.group === "indicator" ? "指标" : "策略";
  return names.flatMap((name) => [`@${group}:${name}`, `@${group}：${name}`]);
}

function declarativeUiAdapter(manifest: TradingStrategyPublicManifest): StrategyUiAdapter {
  return {
    preparingMessage: `正在理解你的${manifest.display.name}看盘指令并读取当前画布。`,
    completionPhase: "complete",
    completionMetric: (result) => `${result.candleCount} 根 K 线的${manifest.display.name}分析`,
  };
}

function buildCatalogItem(manifest: TradingStrategyPublicManifest): TradingStrategyCatalogItem {
  const builtinUi = BUILTIN_UI_ADAPTERS[manifest.implementation.adapterId || manifest.id];
  return Object.freeze({
    ...manifest,
    enabled: manifest.enabled !== false,
    disabledReason: manifest.disabledReason || manifest.diagnostic || null,
    mentionTokens: Object.freeze(mentionTokens(manifest)),
    skill: Object.freeze({
      displayName: manifest.display.name,
      shortDescription: `${manifest.display.name}交易策略 Skill`,
      defaultPrompt: `Use the ${manifest.display.name} strategy skill to analyze the current chart.`,
    }),
    ui: builtinUi || declarativeUiAdapter(manifest),
  });
}

const bundledManifests = (OFFICIAL_TRADING_CATALOG as TradingStrategyPublicManifest[])
  .filter((manifest) => manifest?.schemaVersion === 1 && ["strategy", "indicator"].includes(manifest.display?.group))
  .sort((left, right) => left.display.sortOrder - right.display.sortOrder || left.id.localeCompare(right.id));

let analysisCatalog: readonly TradingStrategyCatalogItem[] = Object.freeze(
  bundledManifests.map(buildCatalogItem),
);

export function tradingStrategyCatalog() {
  return analysisCatalog.filter((item) => item.display.group === "strategy");
}

export function tradingIndicatorCatalog() {
  return analysisCatalog.filter((item) => item.display.group === "indicator");
}

export function reconcileTradingStrategyCatalog(manifests: readonly TradingStrategyPublicManifest[]) {
  if (!Array.isArray(manifests) || !manifests.length) return tradingStrategyCatalog();
  const reconciled = manifests
    .filter((manifest) => manifest?.schemaVersion === 1 && ["strategy", "indicator"].includes(manifest.display?.group))
    .sort((left, right) => left.display.sortOrder - right.display.sortOrder || left.id.localeCompare(right.id))
    .map(buildCatalogItem);
  if (reconciled.length) analysisCatalog = Object.freeze(reconciled);
  return tradingStrategyCatalog();
}

export function tradingStrategyById(strategyId: string) {
  return analysisCatalog.find((strategy) => strategy.id === strategyId) || null;
}

export function tradingStrategyByDisplayName(displayName: string) {
  return analysisCatalog.find((strategy) => strategy.display.group === "strategy" && strategy.display.name === displayName) || null;
}

export function tradingStrategyMentionOptions() {
  return tradingStrategyCatalog().map((strategy) => strategy.display.name);
}

export function tradingIndicatorMentionOptions() {
  return tradingIndicatorCatalog().map((indicator) => indicator.display.name);
}
