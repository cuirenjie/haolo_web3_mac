import { TRADING_ALERT_LIMITS, TRADING_ALERT_SCHEMA_VERSION } from "./protocol.mjs";

const ID = Object.freeze({ type: "string", minLength: 1, maxLength: 160, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$" });
const FINITE_NUMBER = Object.freeze({ type: "number" });

export const ALERT_VALUE_EXPR_JSON_SCHEMA = Object.freeze({
  $id: "haolo://trading-alerts/value-expr.v1.schema.json",
  oneOf: [
    { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "constant" }, value: FINITE_NUMBER } },
    { type: "object", additionalProperties: false, required: ["type", "field"], properties: { type: { const: "field" }, field: { enum: ["open", "high", "low", "close", "volume", "last", "mark", "index"] } } },
    { type: "object", additionalProperties: false, required: ["type", "expr", "bars"], properties: { type: { const: "lag" }, expr: { type: "object" }, bars: { type: "integer", minimum: 1, maximum: 5_000 } } },
    { type: "object", additionalProperties: false, required: ["type", "op", "expr", "period"], properties: { type: { const: "rolling" }, op: { enum: ["min", "max", "avg", "sum"] }, expr: { type: "object" }, period: { type: "integer", minimum: 1, maximum: 5_000 }, offset: { type: "integer", minimum: 0, maximum: 5_000 } } },
    { type: "object", additionalProperties: false, required: ["type", "name", "params"], properties: { type: { const: "indicator" }, name: ID, params: { type: "object", maxProperties: 32 }, output: ID, version: { type: "string", maxLength: 80 } } },
    { type: "object", additionalProperties: false, required: ["type", "drawingId", "output"], properties: { type: { const: "drawing" }, drawingId: ID, output: { enum: ["price_at_time", "upper", "lower"] } } },
    { type: "object", additionalProperties: false, required: ["type", "capability", "field", "params"], properties: { type: { const: "external" }, capability: ID, field: ID, params: { type: "object", maxProperties: 32 }, version: { type: "string", maxLength: 80 } } },
    { type: "object", additionalProperties: false, required: ["type", "op", "args"], properties: { type: { const: "math" }, op: { enum: ["add", "sub", "mul", "div", "abs", "min", "max", "percent_change"] }, args: { type: "array", minItems: 1, maxItems: 16 } } },
  ],
});

export const ALERT_RULE_JSON_SCHEMA = Object.freeze({
  $id: "haolo://trading-alerts/alert-rule.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "ruleId", "revision", "title", "root", "contexts", "evaluationPolicy",
    "triggerPolicy", "dataRequirements", "sourceText", "normalizedSummary", "createdAt",
  ],
  properties: {
    schemaVersion: { const: TRADING_ALERT_SCHEMA_VERSION },
    ruleId: ID,
    revision: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 200 },
    root: { type: "object" },
    contexts: { type: "array", minItems: 1, maxItems: TRADING_ALERT_LIMITS.maxContexts },
    evaluationPolicy: { type: "object" },
    triggerPolicy: { type: "object" },
    dataRequirements: { type: "array", maxItems: TRADING_ALERT_LIMITS.maxDataRequirements },
    sourceText: { type: "string", minLength: 1, maxLength: TRADING_ALERT_LIMITS.maxStringLength },
    normalizedSummary: { type: "string", minLength: 1, maxLength: TRADING_ALERT_LIMITS.maxStringLength },
    createdAt: { type: "integer", minimum: 1 },
    ruleHash: { type: "string", minLength: 64, maxLength: 64 },
  },
});

export const ALERT_DRAFT_JSON_SCHEMA = Object.freeze({
  $id: "haolo://trading-alerts/alert-draft.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "draftId", "sourceText", "status", "rule", "missingFields", "ambiguities",
    "questions", "dataRequirements", "createdAt", "updatedAt",
  ],
  properties: {
    schemaVersion: { const: TRADING_ALERT_SCHEMA_VERSION },
    draftId: ID,
    sourceText: { type: "string", minLength: 1, maxLength: TRADING_ALERT_LIMITS.maxStringLength },
    status: { enum: [
      "interpreting", "awaiting_clarification", "awaiting_data", "awaiting_tool", "awaiting_authorization",
      "validating_dependency", "ready_to_simulate", "simulating", "awaiting_confirmation", "cancelled", "confirmed",
    ] },
    rule: { anyOf: [{ type: "null" }, { $ref: ALERT_RULE_JSON_SCHEMA.$id }] },
    missingFields: { type: "array", maxItems: 64, items: { type: "string" } },
    ambiguities: { type: "array", maxItems: 64, items: { type: "string" } },
    questions: { type: "array", maxItems: 32, items: { type: "string" } },
    conversation: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "text"],
        properties: {
          role: { enum: ["user", "assistant"] },
          text: { type: "string", minLength: 1, maxLength: 8_000 },
        },
      },
    },
    dataRequirements: { type: "array", maxItems: TRADING_ALERT_LIMITS.maxDataRequirements },
    createdAt: { type: "integer", minimum: 1 },
    updatedAt: { type: "integer", minimum: 1 },
    originThreadId: ID,
    error: { type: "string", maxLength: 1_000 },
  },
});

export const TRADING_ALERT_JSON_SCHEMAS = Object.freeze([
  ALERT_VALUE_EXPR_JSON_SCHEMA,
  ALERT_RULE_JSON_SCHEMA,
  ALERT_DRAFT_JSON_SCHEMA,
]);
