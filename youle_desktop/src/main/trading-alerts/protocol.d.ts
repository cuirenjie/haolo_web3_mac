export type CoverageStatus = "available" | "delayed" | "partial" | "unavailable";
export type ConfirmationMode = "intrabar" | "bar_close";
export type TriggerResult = true | false | "unknown";

export interface WindowSpec {
  value: number;
  unit: "events" | "bars" | "milliseconds";
}

export interface ToleranceSpec {
  mode: "absolute" | "percent" | "ticks" | "atr";
  value: number;
}

export type ValueExpr =
  | { type: "constant"; value: number }
  | { type: "field"; field: "open" | "high" | "low" | "close" | "volume" | "last" | "mark" | "index" }
  | { type: "lag"; expr: ValueExpr; bars: number }
  | { type: "rolling"; op: "min" | "max" | "avg" | "sum"; expr: ValueExpr; period: number; offset?: number }
  | { type: "indicator"; name: string; params: Record<string, string | number | boolean>; output?: string; version?: string }
  | { type: "drawing"; drawingId: string; output: "price_at_time" | "upper" | "lower" }
  | { type: "external"; capability: string; field: string; params: Record<string, string | number | boolean>; version?: string }
  | { type: "math"; op: "add" | "sub" | "mul" | "div" | "abs" | "min" | "max" | "percent_change"; args: ValueExpr[] };

export interface ConditionNode {
  conditionId: string;
  contextId: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "inside" | "outside" | "touch"
    | "break_above" | "break_below" | "cross_over" | "cross_under" | "rises_by" | "falls_by";
  left: ValueExpr;
  right: ValueExpr;
  tolerance?: ToleranceSpec;
  confirmation?: ConfirmationMode;
}

export type BooleanNode =
  | { type: "all" | "any"; children: BooleanNode[] }
  | { type: "not"; child: BooleanNode }
  | { type: "condition"; condition: ConditionNode }
  | { type: "sequence"; steps: BooleanNode[]; within?: WindowSpec }
  | { type: "within"; child: BooleanNode; window: WindowSpec }
  | { type: "sustain"; child: BooleanNode; count: number; unit: "events" | "bars" }
  | { type: "count"; child: BooleanNode; atLeast: number; window: WindowSpec };

export interface DrawingBinding {
  drawingId: string;
  drawingRevision: number;
  marketId: string;
  interval: string;
  geometryMode: "segment" | "ray" | "extended";
}

export interface MarketContext {
  contextId: string;
  marketSelector:
    | { kind: "fixed"; marketIds: string[] }
    | { kind: "current" }
    | { kind: "universe"; provider: string; venue: string; marketType: string; quoteAsset?: string; frozenMarketIds?: string[] };
  intervals: string[];
  drawingBinding?: DrawingBinding;
}

export interface DataRequirement {
  requirementId: string;
  capability: string;
  fields: string[];
  markets?: string[];
  minFrequencyMs?: number;
  maxLatencyMs?: number;
  historyWindow?: number;
  permission: "public" | "read_only_account" | "wallet_signature";
  status: "missing" | "awaiting_user" | "validating" | "available" | "degraded";
  candidateProviders: string[];
  selectedProvider?: string;
}

export interface EvaluationPolicy {
  clock: "tick" | "trade" | "bar_update" | "bar_close" | "mixed";
  anchorContextId: string;
  joinMode: "latest_closed" | "same_close_time" | "explicit_window";
  maxDataAgeMs: number;
  unknownPolicy: "do_not_trigger";
}

export interface TriggerPolicy {
  mode: "once" | "repeat";
  edge: "false_to_true";
  rearm: "must_become_false" | "next_bar" | "after_cooldown";
  cooldownMs?: number;
  maxTriggersTotal?: number;
  maxTriggersPerDay?: number;
  resumePolicy: "baseline_only_no_catch_up";
}

export interface AlertRule {
  schemaVersion: 1;
  ruleId: string;
  revision: number;
  title: string;
  root: BooleanNode;
  contexts: MarketContext[];
  evaluationPolicy: EvaluationPolicy;
  triggerPolicy: TriggerPolicy;
  dataRequirements: DataRequirement[];
  sourceText: string;
  normalizedSummary: string;
  createdAt: number;
  ruleHash?: string;
}

export interface AlertDraft {
  schemaVersion: 1;
  draftId: string;
  sourceText: string;
  status: "interpreting" | "awaiting_clarification" | "awaiting_data" | "awaiting_tool"
    | "awaiting_authorization" | "validating_dependency" | "ready_to_simulate" | "simulating"
    | "awaiting_confirmation" | "cancelled" | "confirmed";
  rule: AlertRule | null;
  missingFields: string[];
  ambiguities: string[];
  questions: string[];
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  dataRequirements: DataRequirement[];
  createdAt: number;
  updatedAt: number;
  originThreadId?: string;
  error?: string;
}

export function normalizeAlertRule(value: unknown): Readonly<AlertRule & { ruleHash: string }>;
export function normalizeAlertDraft(value: unknown): Readonly<AlertDraft>;
export function alertRuleHash(rule: AlertRule): string;
export function createAlertRuleRevision(previousRule: AlertRule, nextValue: AlertRule): Readonly<AlertRule & { ruleHash: string }>;
