import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const MEMORY_SCHEMA_VERSION = 1;
const MAX_OWNER_ID_LENGTH = 2_048;
const MAX_ENTRIES = 256;
const MAX_MUTATION_ENTRIES = 16;
const MAX_KEY_LENGTH = 96;
const MAX_VALUE_LENGTH = 2_000;
const VALID_KINDS = new Set(["preference", "constraint", "fact", "goal"]);
const VALID_STRENGTHS = new Set(["normal", "hard"]);
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;

export const TRADING_RISK_MEMORY_KEYS = Object.freeze({
  maxLossPerTradePercent: "max_loss_per_trade_percent",
  // Retained only so profiles written by older clients can be recognized and
  // ignored instead of being reinterpreted as a custom hard constraint.
  absoluteMaxLossPerTradePercent: "absolute_max_loss_per_trade_percent",
  maxPositionPercent: "max_position_percent",
  maxLeverage: "max_leverage",
  minimumRiskRewardRatio: "minimum_risk_reward_ratio",
  riskPreference: "risk_preference",
  preferredStopDistancePercent: "preferred_stop_distance_percent",
  maxStopDistancePercent: "max_stop_distance_percent",
  preferredTakeProfitPercent: "preferred_take_profit_percent",
  maxTakeProfitPercent: "max_take_profit_percent",
  // These two names were emitted by an older free-form memory flow. They are
  // read only for conflict detection/migration and must never be written again.
  legacyAmbiguousStopLossPercent: "preferred_stop_loss_percent",
  legacyRiskRewardPreference: "risk_reward_preference",
  moveStopToBreakEven: "move_stop_to_break_even",
  breakEvenTriggerR: "break_even_trigger_r",
  analysisStyle: "trading_analysis_style",
  requiredAnalysisSections: "required_analysis_sections",
  conflictHandling: "risk_conflict_handling",
  onboardingCompleted: "onboarding_completed",
});

export class PersonalMemoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PersonalMemoryError";
    this.code = code;
  }
}

export class PersonalMemoryStore {
  constructor({ storagePath, safeStorage, now = () => new Date() } = {}) {
    if (!storagePath) throw new TypeError("storagePath is required");
    this.storagePath = path.resolve(storagePath);
    this.safeStorage = safeStorage;
    this.now = now;
    this.mutationQueue = Promise.resolve();
  }

  encryptionAvailable() {
    return safeStorageAvailable(this.safeStorage);
  }

  async status(ownerId) {
    const state = await this.readState();
    const saved = state.memories[ownerHash(ownerId)] || null;
    return {
      available: this.encryptionAvailable(),
      entryCount: Number(saved?.entryCount) || 0,
      updatedAt: saved?.updatedAt || null,
    };
  }

  async list(ownerId, filters = {}) {
    const profile = await this.resolveProfile(ownerId);
    const scopes = normalizeFilterValues(filters.scopes, normalizeScope);
    const keys = normalizeFilterValues(filters.keys, normalizeKey);
    const entries = profile.entries.filter((entry) => (
      (!scopes.size || scopes.has(entry.scope))
      && (!keys.size || keys.has(entry.key))
    ));
    return publicProfile(profile, entries);
  }

  async upsert(ownerId, values = []) {
    const entries = normalizeMutationEntries(values);
    if (!entries.length) {
      throw new PersonalMemoryError("MEMORY_ENTRY_REQUIRED", "至少需要提供一条要记住的用户信息。");
    }
    return this.enqueueMutation(async () => {
      const state = await this.readState();
      const owner = ownerHash(ownerId);
      const profile = await this.decryptProfile(state.memories[owner] || null);
      const byIdentity = new Map(profile.entries.map((entry) => [memoryIdentity(entry.scope, entry.key), entry]));
      const timestamp = this.timestamp();
      for (const entry of entries) {
        const identity = memoryIdentity(entry.scope, entry.key);
        const previous = byIdentity.get(identity);
        byIdentity.set(identity, {
          id: previous?.id || `memory-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
          scope: entry.scope,
          kind: entry.kind,
          key: entry.key,
          value: entry.value,
          strength: entry.strength,
          source: "user_explicit",
          createdAt: previous?.createdAt || timestamp,
          updatedAt: timestamp,
        });
      }
      const nextEntries = [...byIdentity.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      if (nextEntries.length > MAX_ENTRIES) {
        throw new PersonalMemoryError(
          "MEMORY_LIMIT_EXCEEDED",
          `长期记忆最多保存 ${MAX_ENTRIES} 条；请先明确删除不再需要的记忆。`,
        );
      }
      const nextProfile = {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        revision: profile.revision + 1,
        entries: nextEntries,
        updatedAt: timestamp,
      };
      state.memories[owner] = this.encryptProfile(nextProfile);
      await this.writeState(state);
      return publicProfile(nextProfile, entries.map((entry) => (
        nextEntries.find((saved) => saved.scope === entry.scope && saved.key === entry.key)
      )).filter(Boolean));
    });
  }

  async remove(ownerId, filters = {}) {
    const ids = normalizeFilterValues(filters.ids, normalizeId);
    const scopes = normalizeFilterValues(filters.scopes, normalizeScope);
    const keys = normalizeFilterValues(filters.keys, normalizeKey);
    if (!ids.size && !scopes.size && !keys.size) {
      throw new PersonalMemoryError(
        "MEMORY_FILTER_REQUIRED",
        "删除长期记忆时必须明确提供 id、scope 或 key，不能隐式清空全部记忆。",
      );
    }
    return this.enqueueMutation(async () => {
      const state = await this.readState();
      const owner = ownerHash(ownerId);
      const profile = await this.decryptProfile(state.memories[owner] || null);
      const removed = [];
      const retained = profile.entries.filter((entry) => {
        const matches = (
          (!ids.size || ids.has(entry.id))
          && (!scopes.size || scopes.has(entry.scope))
          && (!keys.size || keys.has(entry.key))
        );
        if (matches) removed.push(entry);
        return !matches;
      });
      if (!removed.length) {
        return {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          revision: profile.revision,
          updatedAt: profile.updatedAt,
          remainingEntryCount: profile.entries.length,
          removed: [],
        };
      }
      const nextProfile = {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        revision: profile.revision + 1,
        entries: retained,
        updatedAt: this.timestamp(),
      };
      if (retained.length) state.memories[owner] = this.encryptProfile(nextProfile);
      else delete state.memories[owner];
      await this.writeState(state);
      return {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        revision: nextProfile.revision,
        updatedAt: nextProfile.updatedAt,
        remainingEntryCount: retained.length,
        removed: removed.map(publicEntry),
      };
    });
  }

  async tradingRiskProfile(ownerId) {
    const profile = await this.resolveProfile(ownerId);
    return tradingRiskProfileFromEntries(profile.entries);
  }

  async resolveProfile(ownerId) {
    const state = await this.readState();
    return this.decryptProfile(state.memories[ownerHash(ownerId)] || null);
  }

  async decryptProfile(saved) {
    if (!saved?.encryptedProfile) return emptyProfile();
    if (!this.encryptionAvailable()) {
      throw new PersonalMemoryError(
        "SECURE_STORAGE_UNAVAILABLE",
        "系统安全存储当前不可用，无法读取用户长期记忆。",
      );
    }
    try {
      const plaintext = this.safeStorage.decryptString(Buffer.from(saved.encryptedProfile, "base64"));
      return sanitizeProfile(JSON.parse(plaintext));
    } catch (error) {
      if (error instanceof PersonalMemoryError) throw error;
      throw new PersonalMemoryError(
        "MEMORY_DECRYPT_FAILED",
        "用户长期记忆无法解密。Haolo 已停止读取和覆盖该数据。",
      );
    }
  }

  encryptProfile(profile) {
    if (!this.encryptionAvailable()) {
      throw new PersonalMemoryError(
        "SECURE_STORAGE_UNAVAILABLE",
        "系统安全存储当前不可用，Haolo 已拒绝用明文保存用户长期记忆。",
      );
    }
    try {
      return {
        encryptedProfile: this.safeStorage.encryptString(JSON.stringify(profile)).toString("base64"),
        entryCount: profile.entries.length,
        updatedAt: profile.updatedAt,
      };
    } catch {
      throw new PersonalMemoryError(
        "MEMORY_ENCRYPT_FAILED",
        "系统安全存储加密失败，用户长期记忆未保存。",
      );
    }
  }

  enqueueMutation(task) {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.catch(() => {});
    return result;
  }

  timestamp() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }

  async readState() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.storagePath, "utf8"));
      if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.memories)) {
        throw new Error("unsupported memory store format");
      }
      return { version: STORE_VERSION, memories: sanitizeSavedMemories(parsed.memories) };
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      if (error instanceof PersonalMemoryError) throw error;
      throw new PersonalMemoryError(
        "MEMORY_STORE_INVALID",
        "用户长期记忆库无法读取。为避免覆盖数据，Haolo 已停止写入。",
      );
    }
  }

  async writeState(state) {
    await fs.promises.mkdir(path.dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.promises.rename(temporaryPath, this.storagePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
}

export function tradingRiskProfileFromEntries(values) {
  const entries = Array.isArray(values) ? values : [];
  const tradingEntries = entries.filter((entry) => (
    entry.scope === "trading"
    || entry.scope.startsWith("trading.")
    || (entry.scope === "communication" && entry.key === TRADING_RISK_MEMORY_KEYS.analysisStyle)
  ));
  const latestByIdentity = new Map(tradingEntries.map((entry) => [`${entry.scope}\u0000${entry.key}`, entry]));
  const scopedEntry = (scopes, key) => {
    for (const scope of scopes) {
      const candidate = latestByIdentity.get(`${scope}\u0000${key}`);
      if (candidate) return candidate;
    }
    return null;
  };
  const numeric = (scopes, key, min, max) => {
    const value = Number(scopedEntry(scopes, key)?.value);
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  };
  const boolean = (scopes, key) => {
    const value = scopedEntry(scopes, key)?.value;
    return typeof value === "boolean" ? value : null;
  };
  const text = (scopes, key) => {
    const value = scopedEntry(scopes, key)?.value;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const activeEntries = [...latestByIdentity.values()].map(publicEntry);
  const configuredMaxLossPerTradePercent = numeric(
    ["trading.risk", "trading"],
    TRADING_RISK_MEMORY_KEYS.maxLossPerTradePercent,
    0.01,
    100,
  );
  const legacyAmbiguousStopLossPercent = numeric(
    ["trading.exit"],
    TRADING_RISK_MEMORY_KEYS.legacyAmbiguousStopLossPercent,
    0.01,
    100,
  );
  const preferredStopDistancePercent = numeric(
    ["trading.exit"],
    TRADING_RISK_MEMORY_KEYS.preferredStopDistancePercent,
    0.01,
    100,
  );
  // A legacy entry never recorded its denominator. Even when its number happens
  // to equal the account-risk cap, it may still have meant entry-price distance,
  // so execution must fail closed until that legacy entry is explicitly removed.
  const riskClarificationRequired = legacyAmbiguousStopLossPercent !== null;
  return Object.freeze({
    schemaVersion: 1,
    maxLossPerTradePercent: configuredMaxLossPerTradePercent,
    maxPositionPercent: numeric(["trading.risk", "trading"], TRADING_RISK_MEMORY_KEYS.maxPositionPercent, 0.01, 100),
    maxLeverage: numeric(["trading.risk", "trading"], TRADING_RISK_MEMORY_KEYS.maxLeverage, 1, 1_000),
    minimumRiskRewardRatio: numeric(["trading.risk", "trading"], TRADING_RISK_MEMORY_KEYS.minimumRiskRewardRatio, 0.01, 100),
    riskPreference: text(["trading.risk", "trading"], TRADING_RISK_MEMORY_KEYS.riskPreference)
      || text(["trading.risk", "trading"], TRADING_RISK_MEMORY_KEYS.legacyRiskRewardPreference),
    preferredStopDistancePercent,
    maxStopDistancePercent: numeric(["trading.exit"], TRADING_RISK_MEMORY_KEYS.maxStopDistancePercent, 0.01, 100),
    preferredTakeProfitPercent: numeric(["trading.exit"], TRADING_RISK_MEMORY_KEYS.preferredTakeProfitPercent, 0.01, 100),
    maxTakeProfitPercent: numeric(["trading.exit"], TRADING_RISK_MEMORY_KEYS.maxTakeProfitPercent, 0.01, 100),
    legacyAmbiguousStopLossPercent,
    riskClarificationRequired,
    moveStopToBreakEven: boolean(["trading.exit", "trading"], TRADING_RISK_MEMORY_KEYS.moveStopToBreakEven),
    breakEvenTriggerR: numeric(["trading.exit", "trading"], TRADING_RISK_MEMORY_KEYS.breakEvenTriggerR, 0.01, 100),
    analysisStyle: text(["communication", "trading"], TRADING_RISK_MEMORY_KEYS.analysisStyle),
    requiredAnalysisSections: text(["trading.analysis", "trading"], TRADING_RISK_MEMORY_KEYS.requiredAnalysisSections),
    conflictHandling: text(["trading.behavior", "trading"], TRADING_RISK_MEMORY_KEYS.conflictHandling),
    onboardingCompleted: boolean(["trading.profile", "trading"], TRADING_RISK_MEMORY_KEYS.onboardingCompleted) === true,
    entries: Object.freeze(activeEntries),
  });
}

function emptyState() {
  return { version: STORE_VERSION, memories: {} };
}

function emptyProfile() {
  return { schemaVersion: MEMORY_SCHEMA_VERSION, revision: 0, entries: [], updatedAt: null };
}

function sanitizeSavedMemories(value) {
  const result = {};
  for (const [owner, entry] of Object.entries(value)) {
    if (!/^[a-f0-9]{64}$/.test(owner) || !isRecord(entry)) {
      throw new PersonalMemoryError("MEMORY_STORE_INVALID", "用户长期记忆库包含无效账号记录。");
    }
    const encryptedProfile = stringValue(entry.encryptedProfile);
    if (!encryptedProfile) {
      throw new PersonalMemoryError("MEMORY_STORE_INVALID", "用户长期记忆库包含无效密文记录。");
    }
    result[owner] = {
      encryptedProfile,
      entryCount: Math.max(0, Math.min(MAX_ENTRIES, Math.trunc(Number(entry.entryCount) || 0))),
      updatedAt: isoString(entry.updatedAt),
    };
  }
  return result;
}

function sanitizeProfile(value) {
  if (!isRecord(value) || Number(value.schemaVersion) !== MEMORY_SCHEMA_VERSION || !Array.isArray(value.entries)) {
    throw new PersonalMemoryError("MEMORY_PROFILE_INVALID", "用户长期记忆的数据格式无效。");
  }
  if (value.entries.length > MAX_ENTRIES) {
    throw new PersonalMemoryError("MEMORY_PROFILE_INVALID", "用户长期记忆条目超过安全上限。");
  }
  const entries = value.entries.map(sanitizeStoredEntry);
  if (entries.some((entry) => !entry)) {
    throw new PersonalMemoryError("MEMORY_PROFILE_INVALID", "用户长期记忆包含无效条目。");
  }
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(value.revision) || 0)),
    entries,
    updatedAt: isoString(value.updatedAt),
  };
}

function sanitizeStoredEntry(value) {
  if (!isRecord(value)) return null;
  try {
    return {
      id: normalizeId(value.id),
      scope: normalizeScope(value.scope),
      kind: normalizeKind(value.kind),
      key: normalizeKey(value.key),
      value: normalizeValue(value.value),
      strength: normalizeStrength(value.strength),
      source: "user_explicit",
      createdAt: isoString(value.createdAt) || new Date(0).toISOString(),
      updatedAt: isoString(value.updatedAt) || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizeMutationEntries(values) {
  if (!Array.isArray(values) || values.length > MAX_MUTATION_ENTRIES) {
    throw new PersonalMemoryError(
      "MEMORY_ENTRIES_INVALID",
      `entries 必须是最多 ${MAX_MUTATION_ENTRIES} 项的数组。`,
    );
  }
  const seen = new Set();
  return values.map((value) => {
    if (!isRecord(value)) throw new PersonalMemoryError("MEMORY_ENTRY_INVALID", "长期记忆条目必须是对象。");
    const entry = {
      scope: normalizeScope(value.scope),
      kind: normalizeKind(value.kind),
      key: normalizeKey(value.key),
      value: normalizeValue(value.value),
      strength: normalizeStrength(value.strength),
    };
    const identity = memoryIdentity(entry.scope, entry.key);
    if (seen.has(identity)) throw new PersonalMemoryError("MEMORY_ENTRY_DUPLICATE", `重复的长期记忆：${identity}`);
    seen.add(identity);
    validateKnownRiskEntry(entry);
    return entry;
  });
}

function validateKnownRiskEntry(entry) {
  if (entry.key === TRADING_RISK_MEMORY_KEYS.legacyAmbiguousStopLossPercent) {
    throw new PersonalMemoryError(
      "AMBIGUOUS_STOP_LOSS_MEMORY_KEY",
      "preferred_stop_loss_percent 口径不明确；账户净值风险请使用 trading.risk.max_loss_per_trade_percent，价格止损距离请使用 trading.exit.preferred_stop_distance_percent。",
    );
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.legacyRiskRewardPreference) {
    throw new PersonalMemoryError(
      "LEGACY_RISK_REWARD_MEMORY_KEY",
      "risk_reward_preference 不是可执行字段；风险风格请使用 risk_preference，最低盈亏比请使用 minimum_risk_reward_ratio。",
    );
  }
  const riskScope = entry.scope === "trading.risk" || entry.scope === "trading";
  const exitScope = entry.scope === "trading.exit";
  const riskOnlyKeys = new Set([
    TRADING_RISK_MEMORY_KEYS.maxLossPerTradePercent,
    TRADING_RISK_MEMORY_KEYS.absoluteMaxLossPerTradePercent,
    TRADING_RISK_MEMORY_KEYS.maxPositionPercent,
    TRADING_RISK_MEMORY_KEYS.maxLeverage,
    TRADING_RISK_MEMORY_KEYS.minimumRiskRewardRatio,
  ]);
  const exitOnlyKeys = new Set([
    TRADING_RISK_MEMORY_KEYS.preferredStopDistancePercent,
    TRADING_RISK_MEMORY_KEYS.maxStopDistancePercent,
    TRADING_RISK_MEMORY_KEYS.preferredTakeProfitPercent,
    TRADING_RISK_MEMORY_KEYS.maxTakeProfitPercent,
    TRADING_RISK_MEMORY_KEYS.breakEvenTriggerR,
  ]);
  if (riskOnlyKeys.has(entry.key) && entry.scope !== "trading.risk") {
    throw new PersonalMemoryError("MEMORY_TRADING_SCOPE_INVALID", `${entry.key} 必须保存在 trading.risk。`);
  }
  if (exitOnlyKeys.has(entry.key) && !exitScope) {
    throw new PersonalMemoryError("MEMORY_TRADING_SCOPE_INVALID", `${entry.key} 必须保存在 trading.exit。`);
  }
  if (!riskScope && !exitScope) return;
  if (entry.key === TRADING_RISK_MEMORY_KEYS.maxLossPerTradePercent) {
    if (entry.scope !== "trading.risk" || entry.kind !== "constraint" || entry.strength !== "hard") {
      throw new PersonalMemoryError(
        "MEMORY_ACCOUNT_RISK_SHAPE_INVALID",
        "max_loss_per_trade_percent 必须保存为 trading.risk 下的 hard constraint。",
      );
    }
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.maxTakeProfitPercent) {
    if (!exitScope || entry.kind !== "constraint" || entry.strength !== "hard") {
      throw new PersonalMemoryError(
        "MEMORY_TAKE_PROFIT_CAP_SHAPE_INVALID",
        "max_take_profit_percent 必须保存为 trading.exit 下的 hard constraint。",
      );
    }
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.maxStopDistancePercent) {
    if (!exitScope || entry.kind !== "constraint" || entry.strength !== "hard") {
      throw new PersonalMemoryError(
        "MEMORY_STOP_DISTANCE_CAP_SHAPE_INVALID",
        "max_stop_distance_percent 必须保存为 trading.exit 下的 hard constraint。",
      );
    }
  }
  const hardLimitKeys = new Set([
    TRADING_RISK_MEMORY_KEYS.maxLossPerTradePercent,
    TRADING_RISK_MEMORY_KEYS.maxPositionPercent,
    TRADING_RISK_MEMORY_KEYS.maxLeverage,
    TRADING_RISK_MEMORY_KEYS.minimumRiskRewardRatio,
    TRADING_RISK_MEMORY_KEYS.maxStopDistancePercent,
    TRADING_RISK_MEMORY_KEYS.maxTakeProfitPercent,
  ]);
  if (hardLimitKeys.has(entry.key) && (entry.kind !== "constraint" || entry.strength !== "hard")) {
    throw new PersonalMemoryError(
      "MEMORY_TRADING_LIMIT_SHAPE_INVALID",
      `${entry.key} 是确定性计划必须执行的上限，必须保存为 hard constraint。`,
    );
  }
  const percentageKeys = new Set([
    TRADING_RISK_MEMORY_KEYS.maxLossPerTradePercent,
    TRADING_RISK_MEMORY_KEYS.absoluteMaxLossPerTradePercent,
    TRADING_RISK_MEMORY_KEYS.maxPositionPercent,
    TRADING_RISK_MEMORY_KEYS.preferredStopDistancePercent,
    TRADING_RISK_MEMORY_KEYS.maxStopDistancePercent,
    TRADING_RISK_MEMORY_KEYS.preferredTakeProfitPercent,
    TRADING_RISK_MEMORY_KEYS.maxTakeProfitPercent,
  ]);
  const numericKeys = new Set([
    ...percentageKeys,
    TRADING_RISK_MEMORY_KEYS.maxLeverage,
    TRADING_RISK_MEMORY_KEYS.minimumRiskRewardRatio,
    TRADING_RISK_MEMORY_KEYS.breakEvenTriggerR,
  ]);
  if (!numericKeys.has(entry.key)) return;
  if (typeof entry.value !== "number") {
    throw new PersonalMemoryError("MEMORY_RISK_VALUE_INVALID", `${entry.key} 必须使用数值。`);
  }
  if (percentageKeys.has(entry.key) && (entry.value < 0.01 || entry.value > 100)) {
    throw new PersonalMemoryError("MEMORY_RISK_VALUE_INVALID", `${entry.key} 必须介于 0.01 和 100 之间。`);
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.maxLeverage && (entry.value < 1 || entry.value > 1_000)) {
    throw new PersonalMemoryError("MEMORY_RISK_VALUE_INVALID", "max_leverage 必须介于 1 和 1000 之间。");
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.minimumRiskRewardRatio && (entry.value < 0.01 || entry.value > 100)) {
    throw new PersonalMemoryError("MEMORY_RISK_VALUE_INVALID", "minimum_risk_reward_ratio 必须介于 0.01 和 100 之间。");
  }
  if (entry.key === TRADING_RISK_MEMORY_KEYS.breakEvenTriggerR && (entry.value < 0.01 || entry.value > 100)) {
    throw new PersonalMemoryError("MEMORY_RISK_VALUE_INVALID", "break_even_trigger_r 必须介于 0.01 和 100 之间。");
  }
}

function publicProfile(profile, entries) {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    revision: profile.revision,
    updatedAt: profile.updatedAt,
    entries: entries.map(publicEntry),
  };
}

function publicEntry(entry) {
  return Object.freeze({
    id: entry.id,
    scope: entry.scope,
    kind: entry.kind,
    key: entry.key,
    value: entry.value,
    strength: entry.strength,
    source: "user_explicit",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
}

function ownerHash(value) {
  if (typeof value !== "string") throw new PersonalMemoryError("INVALID_OWNER", "当前 Haolo 账号身份无效。");
  const ownerId = value.trim();
  if (!ownerId || ownerId.length > MAX_OWNER_ID_LENGTH || /[\r\n\0]/.test(ownerId)) {
    throw new PersonalMemoryError("INVALID_OWNER", "当前 Haolo 账号身份无效。");
  }
  return crypto.createHash("sha256").update(ownerId, "utf8").digest("hex");
}

function normalizeScope(value) {
  const result = stringValue(value).toLowerCase();
  if (!SCOPE_PATTERN.test(result)) throw new PersonalMemoryError("MEMORY_SCOPE_INVALID", "长期记忆 scope 无效。");
  return result;
}

function normalizeKey(value) {
  const result = stringValue(value).toLowerCase();
  if (!KEY_PATTERN.test(result) || result.length > MAX_KEY_LENGTH) {
    throw new PersonalMemoryError("MEMORY_KEY_INVALID", "长期记忆 key 无效。");
  }
  return result;
}

function normalizeId(value) {
  const result = stringValue(value);
  if (!/^memory-[a-f0-9]{24}$/.test(result)) throw new PersonalMemoryError("MEMORY_ID_INVALID", "长期记忆 id 无效。");
  return result;
}

function normalizeKind(value) {
  const result = stringValue(value).toLowerCase();
  if (!VALID_KINDS.has(result)) throw new PersonalMemoryError("MEMORY_KIND_INVALID", "长期记忆 kind 无效。");
  return result;
}

function normalizeStrength(value) {
  const result = stringValue(value || "normal").toLowerCase();
  if (!VALID_STRENGTHS.has(result)) throw new PersonalMemoryError("MEMORY_STRENGTH_INVALID", "长期记忆 strength 无效。");
  return result;
}

function normalizeValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const result = value.replace(/\u0000/g, "").trim();
    if (!result || result.length > MAX_VALUE_LENGTH) {
      throw new PersonalMemoryError("MEMORY_VALUE_INVALID", `长期记忆文本必须为 1–${MAX_VALUE_LENGTH} 个字符。`);
    }
    return result;
  }
  throw new PersonalMemoryError("MEMORY_VALUE_INVALID", "长期记忆 value 只能是文本、有限数值或布尔值。");
}

function normalizeFilterValues(values, normalize) {
  const source = values == null ? [] : Array.isArray(values) ? values : [values];
  if (source.length > MAX_ENTRIES) throw new PersonalMemoryError("MEMORY_FILTER_INVALID", "长期记忆过滤条件过多。");
  return new Set(source.map(normalize));
}

function memoryIdentity(scope, key) {
  return `${scope}\0${key}`;
}

function safeStorageAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") return false;
  try {
    return typeof safeStorage.isEncryptionAvailable !== "function" || safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function isoString(value) {
  const result = stringValue(value);
  return result && Number.isFinite(Date.parse(result)) ? new Date(result).toISOString() : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
