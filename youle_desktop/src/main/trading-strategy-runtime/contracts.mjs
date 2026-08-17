const STRATEGY_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_CAPABILITIES = new Set([
  "conversation",
  "chart-analysis",
  "drawing",
  "execution-plan",
]);
const ALLOWED_IMPLEMENTATION_KINDS = new Set(["builtin-adapter", "declarative-v1"]);
const ALLOWED_PLAN_ACTIONS = new Set(["long", "short", "wait", "no_trade", "insufficient_data"]);
const ALLOWED_ENTRY_MODES = new Set(["limit", "breakout", "close_confirmation", "conditional", "none"]);
const ALLOWED_COVERAGE = new Set(["available", "delayed", "partial", "unavailable"]);

export const STRATEGY_MANIFEST_SCHEMA_VERSION = 1;
export const STRATEGY_RESULT_SCHEMA_VERSION = 1;
export const EXECUTION_PLAN_SCHEMA_VERSION = 1;

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${field} must be a plain object`);
  return value;
}

function knownKeys(value, field, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key} is not supported`);
  }
}

function boundedString(value, field, { min = 1, max = 160, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < min || normalized.length > max) fail(`${field} has an invalid length`);
  if (pattern && !pattern.test(normalized)) fail(`${field} has an invalid format`);
  return normalized;
}

function safeRelativeAsset(value, field) {
  const normalized = boundedString(value, field, { max: 180 });
  if (
    normalized.startsWith("/")
    || normalized.startsWith("\\")
    || normalized.includes("\\")
    || normalized.includes(":")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || !/^[0-9A-Za-z._/-]+$/.test(normalized)
  ) fail(`${field} must be a safe package-relative path`);
  return normalized;
}

function finiteNumber(value, field, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) fail(`${field} must be finite`);
  return normalized;
}

function frozenArray(value) {
  return Object.freeze(value.map((item) => Object.freeze(item)));
}

function uniqueStrings(value, field, { maxItems = 32, maxLength = 120 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${field} must be a bounded array`);
  const normalized = value.map((item, index) => boundedString(item, `${field}[${index}]`, { max: maxLength }));
  if (new Set(normalized.map((item) => item.toLowerCase())).size !== normalized.length) {
    fail(`${field} contains duplicate values`);
  }
  return Object.freeze(normalized);
}

function normalizeDataRequirement(value, field) {
  const source = plainObject(value, field);
  knownKeys(source, field, new Set(["required", "minCount", "preferredCount", "minimumCoverage"]));
  const required = source.required === true;
  const minCount = source.minCount === undefined
    ? null
    : finiteNumber(source.minCount, `${field}.minCount`, { min: 0, max: 100_000 });
  const preferredCount = source.preferredCount === undefined || source.preferredCount === null
    ? null
    : finiteNumber(source.preferredCount, `${field}.preferredCount`, { min: 0, max: 100_000 });
  if (minCount !== null && preferredCount !== null && preferredCount < minCount) {
    fail(`${field}.preferredCount cannot be smaller than minCount`);
  }
  const coverage = source.minimumCoverage === undefined
    ? null
    : boundedString(source.minimumCoverage, `${field}.minimumCoverage`, { max: 32 });
  if (coverage && !ALLOWED_COVERAGE.has(coverage)) fail(`${field}.minimumCoverage is invalid`);
  return Object.freeze({ required, minCount, preferredCount, minimumCoverage: coverage });
}

export function validateStrategyManifest(value) {
  const source = plainObject(value, "manifest");
  knownKeys(source, "manifest", new Set([
    "schemaVersion",
    "id",
    "version",
    "minimumHostVersion",
    "publisher",
    "display",
    "mentions",
    "implementation",
    "capabilities",
    "dataRequirements",
    "drawingPolicyId",
    "executionPlanPolicyId",
    "chartIndicator",
    "assets",
  ]));
  if (Number(source.schemaVersion) !== STRATEGY_MANIFEST_SCHEMA_VERSION) {
    fail("manifest.schemaVersion is unsupported");
  }
  const id = boundedString(source.id, "manifest.id", { max: 64, pattern: STRATEGY_ID_PATTERN });
  const version = boundedString(source.version, "manifest.version", { max: 80, pattern: SEMVER_PATTERN });
  const publisherSource = plainObject(source.publisher, "manifest.publisher");
  knownKeys(publisherSource, "manifest.publisher", new Set(["id", "type"]));
  const publisherType = boundedString(publisherSource.type, "manifest.publisher.type", { max: 40 });
  if (publisherType !== "official" && publisherType !== "community") fail("manifest.publisher.type is invalid");
  const publisher = Object.freeze({
    id: boundedString(publisherSource.id, "manifest.publisher.id", { max: 80, pattern: STRATEGY_ID_PATTERN }),
    type: publisherType,
  });
  const displaySource = plainObject(source.display, "manifest.display");
  knownKeys(displaySource, "manifest.display", new Set(["name", "group", "sortOrder"]));
  const display = Object.freeze({
    name: boundedString(displaySource.name, "manifest.display.name", { max: 40 }),
    group: boundedString(displaySource.group || "strategy", "manifest.display.group", { max: 40 }),
    sortOrder: finiteNumber(displaySource.sortOrder, "manifest.display.sortOrder", { min: 0, max: 100_000 }),
  });
  if (display.group !== "strategy" && display.group !== "indicator") fail("manifest.display.group is invalid");
  const mentionsSource = plainObject(source.mentions, "manifest.mentions");
  knownKeys(mentionsSource, "manifest.mentions", new Set(["canonical", "aliases"]));
  const canonical = boundedString(mentionsSource.canonical, "manifest.mentions.canonical", { max: 80 });
  const aliases = uniqueStrings(mentionsSource.aliases || [], "manifest.mentions.aliases", { maxItems: 16, maxLength: 80 });
  if (aliases.some((item) => item.toLowerCase() === canonical.toLowerCase())) {
    fail("manifest.mentions.aliases duplicates the canonical mention");
  }
  const implementationSource = plainObject(source.implementation, "manifest.implementation");
  knownKeys(implementationSource, "manifest.implementation", new Set(["kind", "adapterId", "rulesAsset"]));
  const kind = boundedString(implementationSource.kind, "manifest.implementation.kind", { max: 40 });
  if (!ALLOWED_IMPLEMENTATION_KINDS.has(kind)) fail("manifest.implementation.kind is unsupported");
  const implementation = Object.freeze({
    kind,
    adapterId: kind === "builtin-adapter"
      ? boundedString(implementationSource.adapterId, "manifest.implementation.adapterId", {
        max: 64,
        pattern: STRATEGY_ID_PATTERN,
      })
      : null,
    rulesAsset: kind === "declarative-v1"
      ? safeRelativeAsset(implementationSource.rulesAsset, "manifest.implementation.rulesAsset")
      : null,
  });
  const capabilities = uniqueStrings(source.capabilities, "manifest.capabilities", { maxItems: 16, maxLength: 40 });
  for (const capability of capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) fail(`manifest capability ${capability} is unsupported`);
  }
  const dataSource = plainObject(source.dataRequirements, "manifest.dataRequirements");
  const dataRequirements = Object.freeze(Object.fromEntries(
    Object.entries(dataSource).map(([key, requirement]) => [
      boundedString(key, "manifest.dataRequirements key", { max: 64, pattern: STRATEGY_ID_PATTERN }),
      normalizeDataRequirement(requirement, `manifest.dataRequirements.${key}`),
    ]),
  ));
  const assetsSource = plainObject(source.assets || {}, "manifest.assets");
  const assets = Object.freeze(Object.fromEntries(Object.entries(assetsSource).map(([key, asset]) => [
    boundedString(key, "manifest.assets key", { max: 64, pattern: STRATEGY_ID_PATTERN }),
    safeRelativeAsset(asset, `manifest.assets.${key}`),
  ])));
  let chartIndicator = null;
  if (source.chartIndicator !== undefined && source.chartIndicator !== null) {
    const indicatorSource = plainObject(source.chartIndicator, "manifest.chartIndicator");
    knownKeys(indicatorSource, "manifest.chartIndicator", new Set(["id", "scope", "parameters"]));
    if (display.group !== "indicator") fail("manifest.chartIndicator requires indicator group");
    const scope = boundedString(indicatorSource.scope, "manifest.chartIndicator.scope", { max: 16 });
    if (scope !== "main" && scope !== "sub") fail("manifest.chartIndicator.scope is invalid");
    const parameters = (indicatorSource.parameters || []).map((item, index) => (
      finiteNumber(item, `manifest.chartIndicator.parameters[${index}]`, { min: 0.000001, max: 100_000 })
    ));
    if (parameters.length > 16) fail("manifest.chartIndicator.parameters is too large");
    chartIndicator = Object.freeze({
      id: boundedString(indicatorSource.id, "manifest.chartIndicator.id", { max: 64, pattern: STRATEGY_ID_PATTERN }),
      scope,
      parameters: Object.freeze(parameters),
    });
  }
  return Object.freeze({
    schemaVersion: STRATEGY_MANIFEST_SCHEMA_VERSION,
    id,
    version,
    minimumHostVersion: boundedString(source.minimumHostVersion || "0.1.0", "manifest.minimumHostVersion", {
      max: 80,
      pattern: SEMVER_PATTERN,
    }),
    publisher,
    display,
    mentions: Object.freeze({ canonical, aliases }),
    implementation,
    capabilities,
    dataRequirements,
    drawingPolicyId: boundedString(source.drawingPolicyId, "manifest.drawingPolicyId", { max: 80, pattern: STRATEGY_ID_PATTERN }),
    executionPlanPolicyId: boundedString(source.executionPlanPolicyId, "manifest.executionPlanPolicyId", { max: 80, pattern: STRATEGY_ID_PATTERN }),
    chartIndicator,
    assets,
  });
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const items = [];
  const seen = new Set();
  for (const raw of value.slice(0, 128)) {
    const id = String(raw?.id ?? raw ?? "").trim().slice(0, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push(Object.freeze({ id, summary: String(raw?.summary || raw?.label || "").trim().slice(0, 300) }));
  }
  return Object.freeze(items);
}

function normalizeCoverage(value) {
  if (!value || typeof value !== "object") return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, raw]) => {
    const status = typeof raw === "string" ? raw : raw?.status;
    return [String(key).slice(0, 64), ALLOWED_COVERAGE.has(status) ? status : "unavailable"];
  })));
}

export function createStrategyResultEnvelope(manifest, legacyResult, executionPlan) {
  const normalizedManifest = validateStrategyManifest(manifest);
  const source = plainObject(legacyResult, "legacyResult");
  const snapshotSource = plainObject(source.snapshot, "legacyResult.snapshot");
  const analysisPlan = plainObject(source.analysisPlan, "legacyResult.analysisPlan");
  const theoryResult = source.theoryResult && typeof source.theoryResult === "object" ? source.theoryResult : {};
  return Object.freeze({
    ...source,
    strategyResult: Object.freeze({
      schemaVersion: STRATEGY_RESULT_SCHEMA_VERSION,
      analysisId: boundedString(analysisPlan.analysisId, "analysisPlan.analysisId", { max: 160 }),
      strategy: Object.freeze({ id: normalizedManifest.id, version: normalizedManifest.version }),
      snapshot: Object.freeze({
        id: boundedString(snapshotSource.snapshotId, "snapshot.snapshotId", { max: 160 }),
        inputHash: boundedString(snapshotSource.inputHash, "snapshot.inputHash", { max: 160 }),
        marketId: boundedString(snapshotSource.marketId, "snapshot.marketId", { max: 120 }),
        interval: boundedString(snapshotSource.interval, "snapshot.interval", { max: 24 }),
      }),
      status: "completed",
      evidence: normalizeEvidence(theoryResult.evidence),
      coverage: normalizeCoverage(theoryResult.coverage || snapshotSource.orderFlowCoverage),
      executionPlan,
    }),
    executionPlan,
  });
}

function validateCondition(value, field) {
  const source = plainObject(value, field);
  return Object.freeze({
    id: boundedString(source.id, `${field}.id`, { max: 160 }),
    text: boundedString(source.text, `${field}.text`, { max: 600 }),
    evidenceIds: uniqueStrings(source.evidenceIds || [], `${field}.evidenceIds`, { maxItems: 32, maxLength: 160 }),
  });
}

function validatePriceLevel(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  const source = plainObject(value, field);
  return Object.freeze({
    price: finiteNumber(source.price, `${field}.price`, { min: Number.EPSILON }),
    label: boundedString(source.label, `${field}.label`, { max: 120 }),
    evidenceIds: uniqueStrings(source.evidenceIds || [], `${field}.evidenceIds`, { maxItems: 32, maxLength: 160 }),
  });
}

function validateScenario(value, field) {
  const source = plainObject(value, field);
  const side = source.side === "long" || source.side === "short" ? source.side : fail(`${field}.side is invalid`);
  return Object.freeze({
    id: boundedString(source.id, `${field}.id`, { max: 160 }),
    side,
    status: ["preferred", "alternative", "conditional"].includes(source.status) ? source.status : "conditional",
    trigger: validatePriceLevel(source.trigger, `${field}.trigger`),
    stop: validatePriceLevel(source.stop, `${field}.stop`),
    targets: frozenArray((source.targets || []).slice(0, 8).map((item, index) => (
      validatePriceLevel(item, `${field}.targets[${index}]`)
    ))),
    conditions: frozenArray((source.conditions || []).slice(0, 16).map((item, index) => (
      validateCondition(item, `${field}.conditions[${index}]`)
    ))),
  });
}

function validateAccountPlan(value, field) {
  if (value === null || value === undefined) return null;
  const source = plainObject(value, field);
  const mode = boundedString(source.mode, `${field}.mode`, { max: 40 });
  if (!["new_position", "manage_existing", "reduce_existing", "close_opposite"].includes(mode)) {
    fail(`${field}.mode is invalid`);
  }
  const existingSide = source.existingSide === null || source.existingSide === undefined
    ? null
    : source.existingSide === "long" || source.existingSide === "short"
      ? source.existingSide
      : fail(`${field}.existingSide is invalid`);
  return Object.freeze({
    mode,
    snapshotAt: finiteNumber(source.snapshotAt, `${field}.snapshotAt`, { min: 1 }),
    equity: finiteNumber(source.equity, `${field}.equity`, { min: 0 }),
    availableBalance: finiteNumber(source.availableBalance, `${field}.availableBalance`, { min: 0 }),
    leverage: finiteNumber(source.leverage, `${field}.leverage`, { min: 1, max: 1_000 }),
    entryPrice: finiteNumber(source.entryPrice, `${field}.entryPrice`, { min: Number.EPSILON, nullable: true }),
    notional: finiteNumber(source.notional, `${field}.notional`, { min: 0 }),
    quantity: finiteNumber(source.quantity, `${field}.quantity`, { min: 0, nullable: true }),
    existingSide,
    existingNotional: finiteNumber(source.existingNotional, `${field}.existingNotional`, { min: 0 }),
    existingQuantity: finiteNumber(source.existingQuantity, `${field}.existingQuantity`, { min: 0, nullable: true }),
    existingEntryPrice: finiteNumber(source.existingEntryPrice, `${field}.existingEntryPrice`, { min: Number.EPSILON, nullable: true }),
    existingUnrealizedPnl: finiteNumber(source.existingUnrealizedPnl, `${field}.existingUnrealizedPnl`, { nullable: true }),
    estimatedStopLoss: finiteNumber(source.estimatedStopLoss, `${field}.estimatedStopLoss`, {
      min: 0,
      nullable: true,
    }),
    estimatedTakeProfit: finiteNumber(source.estimatedTakeProfit, `${field}.estimatedTakeProfit`, {
      min: 0,
      nullable: true,
    }),
    estimatedRoundTripCostRate: finiteNumber(
      source.estimatedRoundTripCostRate,
      `${field}.estimatedRoundTripCostRate`,
      { min: 0, max: 0.05 },
    ),
    targetOrders: frozenArray((source.targetOrders || []).slice(0, 8).map((item, index) => ({
      targetIndex: finiteNumber(item?.targetIndex, `${field}.targetOrders[${index}].targetIndex`, { min: 0, max: 7 }),
      price: finiteNumber(item?.price, `${field}.targetOrders[${index}].price`, { min: Number.EPSILON }),
      notional: finiteNumber(item?.notional, `${field}.targetOrders[${index}].notional`, { min: 0 }),
      estimatedNetProfit: finiteNumber(
        item?.estimatedNetProfit,
        `${field}.targetOrders[${index}].estimatedNetProfit`,
        { min: 0 },
      ),
    }))),
  });
}

export function validateExecutionPlan(value) {
  const source = plainObject(value, "executionPlan");
  if (Number(source.schemaVersion) !== EXECUTION_PLAN_SCHEMA_VERSION) fail("executionPlan.schemaVersion is unsupported");
  const action = boundedString(source.action, "executionPlan.action", { max: 32 });
  if (!ALLOWED_PLAN_ACTIONS.has(action)) fail("executionPlan.action is invalid");
  const entrySource = plainObject(source.entry, "executionPlan.entry");
  const entryMode = boundedString(entrySource.mode, "executionPlan.entry.mode", { max: 40 });
  if (!ALLOWED_ENTRY_MODES.has(entryMode)) fail("executionPlan.entry.mode is invalid");
  const sizingSource = plainObject(source.positionSizing, "executionPlan.positionSizing");
  const accountStatus = ["unbound", "unavailable", "available"].includes(sizingSource.accountStatus)
    ? sizingSource.accountStatus
    : "unbound";
  const accountPlan = validateAccountPlan(sizingSource.accountPlan, "executionPlan.positionSizing.accountPlan");
  if (accountPlan && accountStatus !== "available") {
    fail("executionPlan.positionSizing.accountPlan requires an available account");
  }
  const plan = {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    planId: boundedString(source.planId, "executionPlan.planId", { max: 160 }),
    analysisId: boundedString(source.analysisId, "executionPlan.analysisId", { max: 160 }),
    strategy: Object.freeze({
      id: boundedString(source.strategy?.id, "executionPlan.strategy.id", { max: 64, pattern: STRATEGY_ID_PATTERN }),
      version: boundedString(source.strategy?.version, "executionPlan.strategy.version", { max: 80, pattern: SEMVER_PATTERN }),
    }),
    market: Object.freeze({
      marketId: boundedString(source.market?.marketId, "executionPlan.market.marketId", { max: 120 }),
      symbol: boundedString(source.market?.symbol, "executionPlan.market.symbol", { max: 80 }),
      interval: boundedString(source.market?.interval, "executionPlan.market.interval", { max: 24 }),
    }),
    snapshot: Object.freeze({
      id: boundedString(source.snapshot?.id, "executionPlan.snapshot.id", { max: 160 }),
      inputHash: boundedString(source.snapshot?.inputHash, "executionPlan.snapshot.inputHash", { max: 160 }),
      lastClosedBarTime: finiteNumber(source.snapshot?.lastClosedBarTime, "executionPlan.snapshot.lastClosedBarTime", { min: 1 }),
    }),
    createdAt: finiteNumber(source.createdAt, "executionPlan.createdAt", { min: 1 }),
    expiresAt: finiteNumber(source.expiresAt, "executionPlan.expiresAt", { min: 1, nullable: true }),
    action,
    preferredSide: ["long", "short", "neutral"].includes(source.preferredSide) ? source.preferredSide : "neutral",
    marketAssessment: boundedString(source.marketAssessment, "executionPlan.marketAssessment", { max: 2_000 }),
    preconditions: frozenArray((source.preconditions || []).slice(0, 32).map((item, index) => (
      validateCondition(item, `executionPlan.preconditions[${index}]`)
    ))),
    entry: Object.freeze({
      mode: entryMode,
      zone: entrySource.zone ? Object.freeze({
        lower: finiteNumber(entrySource.zone.lower, "executionPlan.entry.zone.lower", { min: Number.EPSILON }),
        upper: finiteNumber(entrySource.zone.upper, "executionPlan.entry.zone.upper", { min: Number.EPSILON }),
      }) : null,
      trigger: frozenArray((entrySource.trigger || []).slice(0, 32).map((item, index) => (
        validateCondition(item, `executionPlan.entry.trigger[${index}]`)
      ))),
      confirmation: frozenArray((entrySource.confirmation || []).slice(0, 32).map((item, index) => (
        validateCondition(item, `executionPlan.entry.confirmation[${index}]`)
      ))),
    }),
    invalidation: Object.freeze({
      stop: validatePriceLevel(source.invalidation?.stop, "executionPlan.invalidation.stop", { nullable: true }),
      reasons: uniqueStrings(source.invalidation?.reasons || [], "executionPlan.invalidation.reasons", { maxItems: 16, maxLength: 400 }),
    }),
    takeProfits: frozenArray((source.takeProfits || []).slice(0, 8).map((item, index) => {
      const target = plainObject(item, `executionPlan.takeProfits[${index}]`);
      return {
        price: validatePriceLevel(target.price, `executionPlan.takeProfits[${index}].price`),
        allocationPercent: finiteNumber(target.allocationPercent, `executionPlan.takeProfits[${index}].allocationPercent`, {
          min: 0,
          max: 100,
        }),
        condition: String(target.condition || "").trim().slice(0, 400),
      };
    })),
    positionSizing: Object.freeze({
      maxAccountRiskPercent: finiteNumber(sizingSource.maxAccountRiskPercent, "executionPlan.positionSizing.maxAccountRiskPercent", {
        min: 0,
        max: 100,
        nullable: true,
      }),
      maxPositionPercent: finiteNumber(sizingSource.maxPositionPercent, "executionPlan.positionSizing.maxPositionPercent", {
        min: 0,
        max: 100,
        nullable: true,
      }),
      maxLeverage: finiteNumber(sizingSource.maxLeverage, "executionPlan.positionSizing.maxLeverage", {
        min: 1,
        max: 1_000,
        nullable: true,
      }),
      minimumRiskRewardRatio: finiteNumber(
        sizingSource.minimumRiskRewardRatio,
        "executionPlan.positionSizing.minimumRiskRewardRatio",
        { min: 0, max: 100, nullable: true },
      ),
      estimatedRoundTripCostRate: finiteNumber(
        sizingSource.estimatedRoundTripCostRate,
        "executionPlan.positionSizing.estimatedRoundTripCostRate",
        { min: 0, max: 0.05 },
      ),
      formula: boundedString(sizingSource.formula, "executionPlan.positionSizing.formula", { max: 500 }),
      suggestedQuantity: finiteNumber(sizingSource.suggestedQuantity, "executionPlan.positionSizing.suggestedQuantity", {
        min: 0,
        nullable: true,
      }),
      unavailableReason: sizingSource.unavailableReason === null
        ? null
        : boundedString(sizingSource.unavailableReason, "executionPlan.positionSizing.unavailableReason", { max: 500 }),
      accountStatus,
      accountPlan,
    }),
    riskReward: frozenArray((source.riskReward || []).slice(0, 8).map((item, index) => ({
      targetIndex: finiteNumber(item?.targetIndex, `executionPlan.riskReward[${index}].targetIndex`, { min: 0, max: 7 }),
      ratio: finiteNumber(item?.ratio, `executionPlan.riskReward[${index}].ratio`, { min: 0, max: 100 }),
    }))),
    observe: frozenArray((source.observe || []).slice(0, 32).map((item, index) => (
      validateCondition(item, `executionPlan.observe[${index}]`)
    ))),
    cancelConditions: frozenArray((source.cancelConditions || []).slice(0, 32).map((item, index) => (
      validateCondition(item, `executionPlan.cancelConditions[${index}]`)
    ))),
    scenarios: frozenArray((source.scenarios || []).slice(0, 8).map((item, index) => (
      validateScenario(item, `executionPlan.scenarios[${index}]`)
    ))),
    evidence: normalizeEvidence(source.evidence),
    coverage: normalizeCoverage(source.coverage),
    warnings: uniqueStrings(source.warnings || [], "executionPlan.warnings", { maxItems: 32, maxLength: 600 }),
  };
  if (plan.entry.zone && plan.entry.zone.lower > plan.entry.zone.upper) fail("executionPlan.entry.zone is reversed");
  if (["long", "short"].includes(plan.action)) {
    if (plan.entry.mode === "none" || !plan.entry.trigger.length) fail("actionable execution plans require an entry trigger");
    if (!plan.invalidation.stop) fail("actionable execution plans require a stop");
    if (!plan.takeProfits.length) fail("actionable execution plans require at least one target");
    if (!plan.expiresAt) fail("actionable execution plans require an expiry");
  }
  if (plan.takeProfits.length) {
    const allocation = plan.takeProfits.reduce((total, target) => total + target.allocationPercent, 0);
    if (Math.abs(allocation - 100) > 0.001) fail("executionPlan take-profit allocations must total 100");
  }
  return Object.freeze(plan);
}

export function publicStrategyManifest(manifest, { enabled = true, diagnostic = null } = {}) {
  const value = validateStrategyManifest(manifest);
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    publisher: value.publisher,
    display: value.display,
    mentions: value.mentions,
    implementation: value.implementation,
    capabilities: value.capabilities,
    dataRequirements: value.dataRequirements,
    chartIndicator: value.chartIndicator,
    enabled,
    diagnostic: diagnostic ? String(diagnostic).slice(0, 300) : null,
  });
}
