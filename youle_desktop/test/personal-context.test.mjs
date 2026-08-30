import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncDefaultCodexResources } from "../src/main/app-server-client.mjs";
import { parseExplicitMarketAliasMemory } from "../src/main/personal-context/alias-memory.mjs";
import { PersonalContextMcpBridge } from "../src/main/personal-context/mcp-bridge.mjs";
import {
  PersonalMemoryStore,
  tradingRiskProfileFromEntries,
} from "../src/main/personal-context/memory-store.mjs";
import { PersonalContextService } from "../src/main/personal-context/service.mjs";
import { migrateLegacyStopPreferenceToAccountRisk } from "../src/main/personal-context/risk-memory-migration.mjs";
import { createUserDataSnapshot, restoreUserDataSnapshot } from "../src/main/user-data-transfer.mjs";

const personalContextSkillRoot = new URL("../resources/default-haolo-ai/skills/personal-context/", import.meta.url);
const personalContextMcpServer = new URL("../resources/mcp/personal-context-server/index.mjs", import.meta.url);

function safeStorageFixture() {
  const transform = (buffer) => Buffer.from([...buffer].map((byte) => byte ^ 0xa5));
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => transform(Buffer.from(value, "utf8")),
    decryptString: (value) => transform(value).toString("utf8"),
  };
}

test("explicit market alias requests persist as semantic mappings without implying chart analysis", () => {
  const parsed = parseExplicitMarketAliasMemory("闪迪 特指 SNDK，能长期记住吗");
  assert.ok(parsed);
  assert.deepEqual(
    parsed && {
      label: parsed.label,
      symbol: parsed.symbol,
      scope: parsed.scope,
      kind: parsed.kind,
      key: parsed.key,
      strength: parsed.strength,
    },
    {
      label: "闪迪",
      symbol: "SNDK",
      scope: "trading.aliases",
      kind: "fact",
      key: "market_alias_sndk",
      strength: "normal",
    },
  );
  assert.match(parsed.value, /名称映射，不代表用户要求 K 线/);
  assert.equal(parseExplicitMarketAliasMemory("如果闪迪特指 SNDK，能记住吗"), null);
  assert.equal(parseExplicitMarketAliasMemory("我今天看了 SNDK 的价格"), null);
  assert.equal(parseExplicitMarketAliasMemory("闪迪特指 SNDK，但先别记住"), null);
});

test("personal memory is encrypted, account-isolated, replaceable, and removable", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-personal-memory-"));
  try {
    const storagePath = path.join(tempRoot, "personal-memory.json");
    const store = new PersonalMemoryStore({
      storagePath,
      safeStorage: safeStorageFixture(),
      now: () => new Date("2026-08-16T08:00:00.000Z"),
    });
    const first = await store.upsert("owner-a", [
      {
        scope: "trading.risk",
        kind: "constraint",
        key: "max_loss_per_trade_percent",
        value: 10,
        strength: "hard",
      },
      {
        scope: "trading.risk",
        kind: "constraint",
        key: "max_position_percent",
        value: 50,
        strength: "hard",
      },
    ]);

    assert.equal(first.revision, 1);
    assert.equal(first.entries.length, 2);
    assert.equal((await store.list("owner-b")).entries.length, 0);
    const ownerA = await store.list("owner-a", { scopes: ["trading.risk"] });
    assert.equal(ownerA.entries.length, 2);
    assert.equal(ownerA.entries[0].source, "user_explicit");
    const persisted = fs.readFileSync(storagePath, "utf8");
    assert.doesNotMatch(persisted, /max_loss_per_trade_percent|trading\.risk|"value": 10/);

    const riskProfile = await store.tradingRiskProfile("owner-a");
    assert.equal(riskProfile.maxLossPerTradePercent, 10);
    assert.equal(riskProfile.maxPositionPercent, 50);

    const previousId = ownerA.entries.find((entry) => entry.key === "max_loss_per_trade_percent").id;
    await store.upsert("owner-a", [{
      scope: "trading.risk",
      kind: "constraint",
      key: "max_loss_per_trade_percent",
      value: 2,
      strength: "hard",
    }]);
    const replaced = await store.list("owner-a");
    assert.equal(replaced.entries.length, 2);
    assert.equal(replaced.entries.find((entry) => entry.key === "max_loss_per_trade_percent").id, previousId);
    assert.equal((await store.tradingRiskProfile("owner-a")).maxLossPerTradePercent, 2);

    await assert.rejects(
      store.upsert("owner-a", [{
        scope: "trading.risk",
        kind: "constraint",
        key: "max_loss_per_trade_percent",
        value: 100.1,
        strength: "hard",
      }]),
      (error) => error.code === "MEMORY_RISK_VALUE_INVALID",
    );
    await assert.rejects(
      store.upsert("owner-a", [{
        scope: "trading.exit",
        kind: "preference",
        key: "preferred_stop_loss_percent",
        value: 5,
        strength: "normal",
      }]),
      (error) => error.code === "AMBIGUOUS_STOP_LOSS_MEMORY_KEY",
    );
    await assert.rejects(
      store.upsert("owner-a", [{
        scope: "trading.risk",
        kind: "preference",
        key: "max_loss_per_trade_percent",
        value: 5,
        strength: "normal",
      }]),
      (error) => error.code === "MEMORY_ACCOUNT_RISK_SHAPE_INVALID",
    );

    const removed = await store.remove("owner-a", { keys: ["max_position_percent"] });
    assert.equal(removed.removed.length, 1);
    assert.equal((await store.tradingRiskProfile("owner-a")).maxPositionPercent, null);

    const malformed = '{"version":1,"memories":{"invalid-owner":{"encryptedProfile":"broken"}}}\n';
    fs.writeFileSync(storagePath, malformed, "utf8");
    await assert.rejects(
      store.upsert("owner-a", [{
        scope: "communication",
        kind: "preference",
        key: "answer_style",
        value: "concise",
      }]),
      (error) => error.code === "MEMORY_STORE_INVALID",
    );
    assert.equal(fs.readFileSync(storagePath, "utf8"), malformed);

    const unavailablePath = path.join(tempRoot, "unavailable-memory.json");
    const unavailable = new PersonalMemoryStore({
      storagePath: unavailablePath,
      safeStorage: { isEncryptionAvailable: () => false },
    });
    await assert.rejects(
      unavailable.upsert("owner-a", [{
        scope: "communication",
        kind: "preference",
        key: "answer_style",
        value: "concise",
      }]),
      (error) => error.code === "SECURE_STORAGE_UNAVAILABLE",
    );
    assert.equal(fs.existsSync(unavailablePath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("trading preference profile covers risk, break-even, answer style, and custom discipline", () => {
  const entry = (scope, key, value, kind = "preference", strength = "normal") => ({
    id: `memory-${String(key).padEnd(24, "0").slice(0, 24).replace(/[^a-f0-9]/g, "a")}`,
    scope,
    key,
    value,
    kind,
    strength,
    source: "user_explicit",
    createdAt: "2026-08-16T08:00:00.000Z",
    updatedAt: "2026-08-16T08:00:00.000Z",
  });
  const profile = tradingRiskProfileFromEntries([
    entry("trading.risk", "max_loss_per_trade_percent", 10, "constraint", "hard"),
    entry("trading.risk", "absolute_max_loss_per_trade_percent", 3, "constraint", "hard"),
    entry("trading.risk", "minimum_risk_reward_ratio", 2, "constraint", "hard"),
    entry("trading.exit", "move_stop_to_break_even", true),
    entry("trading.exit", "break_even_trigger_r", 1),
    entry("communication", "trading_analysis_style", "concise"),
    entry("trading.analysis", "required_analysis_sections", "仓位健康度、风险校验、关键价位"),
    entry("trading.behavior", "risk_conflict_handling", "提示风险并提供合规备选"),
    entry("trading.profile", "onboarding_completed", true, "fact"),
    entry("trading.discipline", "user_custom_rules", "不允许亏损加仓", "constraint", "hard"),
  ]);

  assert.equal(profile.maxLossPerTradePercent, 10);
  assert.equal("absoluteMaxLossPerTradePercent" in profile, false);
  assert.equal(profile.minimumRiskRewardRatio, 2);
  assert.equal(profile.moveStopToBreakEven, true);
  assert.equal(profile.breakEvenTriggerR, 1);
  assert.equal(profile.analysisStyle, "concise");
  assert.equal(profile.onboardingCompleted, true);
  assert.equal(profile.entries.some((saved) => saved.key === "user_custom_rules"), true);
});

test("trading preference profile separates account risk, price distance, and legacy ambiguity", () => {
  const entry = (scope, key, value, kind = "preference", strength = "normal") => ({
    id: `memory-${String(key).padEnd(24, "0").slice(0, 24).replace(/[^a-f0-9]/g, "a")}`,
    scope,
    key,
    value,
    kind,
    strength,
    source: "user_explicit",
    createdAt: "2026-08-30T12:40:56.452Z",
    updatedAt: "2026-08-30T12:40:56.452Z",
  });
  const conflicting = tradingRiskProfileFromEntries([
    entry("trading.risk", "max_loss_per_trade_percent", 10, "constraint", "hard"),
    entry("trading.exit", "preferred_stop_loss_percent", 5),
    entry("trading.exit", "preferred_take_profit_percent", 2),
    entry("trading.exit", "max_take_profit_percent", 10, "constraint", "hard"),
    entry("trading.risk", "risk_reward_preference", "优先高胜率"),
  ]);
  assert.equal(conflicting.maxLossPerTradePercent, 10);
  assert.equal(conflicting.legacyAmbiguousStopLossPercent, 5);
  assert.equal(conflicting.riskClarificationRequired, true);
  assert.equal(conflicting.preferredTakeProfitPercent, 2);
  assert.equal(conflicting.maxTakeProfitPercent, 10);
  assert.equal(conflicting.riskPreference, "优先高胜率");

  const numericallyEqualButStillAmbiguous = tradingRiskProfileFromEntries([
    entry("trading.risk", "max_loss_per_trade_percent", 5, "constraint", "hard"),
    entry("trading.exit", "preferred_stop_loss_percent", 5),
  ]);
  assert.equal(numericallyEqualButStillAmbiguous.riskClarificationRequired, true);

  const clarified = tradingRiskProfileFromEntries([
    entry("trading.risk", "max_loss_per_trade_percent", 5, "constraint", "hard"),
    entry("trading.exit", "preferred_stop_distance_percent", 3),
    entry("trading.exit", "preferred_take_profit_percent", 2),
    entry("trading.exit", "max_take_profit_percent", 10, "constraint", "hard"),
  ]);
  assert.equal(clarified.maxLossPerTradePercent, 5);
  assert.equal(clarified.preferredStopDistancePercent, 3);
  assert.equal(clarified.riskClarificationRequired, false);
});

test("authorized legacy preference migration replaces account risk and removes ambiguous keys", () => {
  const profile = {
    schemaVersion: 1,
    revision: 2,
    updatedAt: "2026-08-30T12:40:56.452Z",
    entries: [
      {
        id: "memory-account-risk",
        scope: "trading.risk",
        key: "max_loss_per_trade_percent",
        kind: "constraint",
        value: 10,
        strength: "hard",
        source: "user_explicit",
        createdAt: "2026-08-30T08:55:30.587Z",
        updatedAt: "2026-08-30T08:55:30.587Z",
      },
      {
        id: "memory-legacy-stop",
        scope: "trading.exit",
        key: "preferred_stop_loss_percent",
        kind: "preference",
        value: 5,
        strength: "normal",
        source: "user_explicit",
        createdAt: "2026-08-30T12:40:56.452Z",
        updatedAt: "2026-08-30T12:40:56.452Z",
      },
      {
        id: "memory-legacy-risk-style",
        scope: "trading.risk",
        key: "risk_reward_preference",
        kind: "preference",
        value: "不追求很高的盈亏比，但优先高胜率",
        strength: "normal",
        source: "user_explicit",
        createdAt: "2026-08-30T12:40:56.452Z",
        updatedAt: "2026-08-30T12:40:56.452Z",
      },
    ],
  };
  const migrated = migrateLegacyStopPreferenceToAccountRisk(profile, {
    accountRiskPercent: 5,
    expectedLegacyPercent: 5,
    updatedAt: "2026-08-30T15:00:00.000Z",
  });
  assert.equal(migrated.revision, 3);
  assert.equal(migrated.entries.find((entry) => entry.key === "max_loss_per_trade_percent").value, 5);
  assert.equal(migrated.entries.some((entry) => entry.key === "preferred_stop_loss_percent"), false);
  assert.equal(migrated.entries.some((entry) => entry.key === "risk_reward_preference"), false);
  assert.equal(migrated.entries.find((entry) => entry.key === "risk_preference").value, "不追求很高的盈亏比，但优先高胜率");
  assert.throws(
    () => migrateLegacyStopPreferenceToAccountRisk(profile, {
      accountRiskPercent: 5,
      expectedLegacyPercent: 3,
    }),
    /does not match/,
  );
});

test("personal context service requires explicit memory authorization and returns minimal account sections", async () => {
  const memoryCalls = [];
  const accountCalls = [];
  const service = new PersonalContextService({
    memoryStore: {
      async status() { return { available: true, entryCount: 1, updatedAt: "2026-08-16T08:00:00.000Z" }; },
      async list(ownerId, args) { return { ownerId, args, entries: [] }; },
      async upsert(ownerId, entries) { memoryCalls.push({ ownerId, entries }); return { entries }; },
      async remove(ownerId, args) { memoryCalls.push({ ownerId, args }); return { removed: [] }; },
    },
    accountService: {
      async status() { return { bound: true, updatedAt: "2026-08-16T08:00:00.000Z" }; },
      async snapshot(ownerId, options) {
        accountCalls.push({ ownerId, options });
        return {
          fetchedAt: "2026-08-16T08:00:00.000Z",
          currency: "USDT",
          estimatedTotalAssets: 10_000,
          positions: [{ symbol: "BTCUSDT", positionAmt: "0.1" }],
          openOrders: [{ symbol: "BTCUSDT", orderId: 1 }],
          positionHistory: [{ symbol: "BTCUSDT", realizedPnl: 12 }],
          walletBreakdown: [{ asset: "USDT", walletBalance: 10_000 }],
          warnings: [],
          sources: { account: "live" },
        };
      },
    },
    resolveOwner: async () => ({ ownerId: "owner-a" }),
  });

  await assert.rejects(
    service.invoke({ tool: "remember_user_memory", arguments: { entries: [] } }),
    (error) => error.code === "EXPLICIT_USER_INSTRUCTION_REQUIRED",
  );
  const remembered = await service.invoke({
    tool: "remember_user_memory",
    arguments: {
      explicit_user_instruction: true,
      user_statement: "请记住我偏好简洁回答",
      entries: [{ scope: "communication", kind: "preference", key: "answer_style", value: "concise" }],
    },
  });
  assert.equal(remembered.entries[0].key, "answer_style");
  assert.equal(memoryCalls[0].ownerId, "owner-a");

  await assert.rejects(
    service.invoke({
      tool: "remember_user_memory",
      arguments: {
        explicit_user_instruction: true,
        user_statement: "我愿意每次止损5%，帮我记住",
        entries: [{
          scope: "trading.risk",
          kind: "constraint",
          key: "max_loss_per_trade_percent",
          value: 5,
          strength: "hard",
        }],
      },
    }),
    (error) => error.code === "TRADING_STOP_LOSS_BASIS_REQUIRED",
  );
  await assert.rejects(
    service.invoke({
      tool: "remember_user_memory",
      arguments: {
        explicit_user_instruction: true,
        user_statement: "我希望盈亏比不要很高，优先高胜率，帮我记住",
        entries: [{
          scope: "trading.risk",
          kind: "preference",
          key: "risk_preference",
          value: "优先高胜率",
          strength: "normal",
        }],
      },
    }),
    (error) => error.code === "TRADING_MINIMUM_RISK_REWARD_REQUIRED",
  );
  const clarifiedRisk = await service.invoke({
    tool: "remember_user_memory",
    arguments: {
      explicit_user_instruction: true,
      user_statement: "每笔触发止损后，账户净值最多实际亏损5%，帮我记住",
      entries: [{
        scope: "trading.risk",
        kind: "constraint",
        key: "max_loss_per_trade_percent",
        value: 5,
        strength: "hard",
      }],
    },
  });
  assert.equal(clarifiedRisk.entries[0].key, "max_loss_per_trade_percent");
  assert.equal(memoryCalls.at(-1).entries[0].value, 5);
  await service.invoke({
    tool: "remember_user_memory",
    arguments: {
      explicit_user_instruction: true,
      user_statement: "我的固定止损价格是2441.5，帮我记住",
      entries: [{
        scope: "trading.exit",
        kind: "preference",
        key: "fixed_stop_price_note",
        value: 2441.5,
        strength: "normal",
      }],
    },
  });
  assert.equal(memoryCalls.at(-1).entries[0].value, 2441.5);

  const account = await service.invoke({
    tool: "read_binance_account_context",
    arguments: { sections: ["summary", "positions", "position_history"], max_history_items: 1, force: true },
  });
  assert.equal(account.summary.estimatedTotalAssets, 10_000);
  assert.equal(account.positions.length, 1);
  assert.equal(account.positionHistory.length, 1);
  assert.equal(Object.hasOwn(account, "openOrders"), false);
  assert.equal(Object.hasOwn(account, "walletBreakdown"), false);
  assert.deepEqual(accountCalls, [{ ownerId: "owner-a", options: { force: true, live: false } }]);

  const sources = await service.invoke({ tool: "list_user_context_sources", arguments: {} });
  assert.deepEqual(sources.sources.map((source) => source.id), ["user.memory", "binance.account"]);
});

test("personal context service follows Binance account service replacements after auth and API rebinds", async () => {
  const calls = [];
  const accountService = (name, assets) => ({
    async status(ownerId) {
      calls.push({ name, operation: "status", ownerId });
      return { bound: true, updatedAt: "2026-08-30T08:00:00.000Z" };
    },
    async snapshot(ownerId, options) {
      calls.push({ name, operation: "snapshot", ownerId, options });
      return {
        fetchedAt: "2026-08-30T08:00:00.000Z",
        currency: "USDT",
        estimatedTotalAssets: assets,
        positions: [{ symbol: "BTCUSDT", notionalValue: assets }],
        warnings: [],
        sources: { account: "live" },
      };
    },
  });
  let currentAccountService = accountService("initial", 10_000);
  const service = new PersonalContextService({
    memoryStore: {
      async status() { return { available: true, entryCount: 0, updatedAt: null }; },
      async list() { return { entries: [] }; },
      async upsert() { return { entries: [] }; },
      async remove() { return { removed: [] }; },
    },
    getAccountService: () => currentAccountService,
    resolveOwner: async () => ({ ownerId: "owner-a" }),
  });

  const initial = await service.invoke({
    tool: "read_binance_account_context",
    arguments: { sections: ["summary", "positions"], force: true },
  });
  assert.equal(initial.summary.estimatedTotalAssets, 10_000);

  currentAccountService = accountService("first-rebind", 20_000);
  const firstRebind = await service.invoke({
    tool: "read_binance_account_context",
    arguments: { sections: ["summary", "positions"], force: true },
  });
  assert.equal(firstRebind.summary.estimatedTotalAssets, 20_000);
  assert.equal(firstRebind.positions[0].notionalValue, 20_000);

  currentAccountService = accountService("second-rebind", 30_000);
  const sources = await service.invoke({ tool: "list_user_context_sources", arguments: {} });
  const secondRebind = await service.invoke({
    tool: "read_binance_account_context",
    arguments: { sections: ["summary"], force: true },
  });
  assert.equal(sources.sources.find((source) => source.id === "binance.account").available, true);
  assert.equal(secondRebind.summary.estimatedTotalAssets, 30_000);
  assert.deepEqual(
    calls.map(({ name, operation }) => `${name}:${operation}`),
    [
      "initial:status",
      "initial:snapshot",
      "first-rebind:status",
      "first-rebind:snapshot",
      "second-rebind:status",
      "second-rebind:status",
      "second-rebind:snapshot",
    ],
  );
});

test("personal context is globally registered and its skill defines memory safety and web fallback", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-personal-context-config-"));
  try {
    const codexHome = path.join(tempRoot, "codex-home");
    const first = syncDefaultCodexResources(codexHome, {
      includeRuntimeDotCodex: false,
      skipPlugins: true,
    });
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.equal(first.errors.length, 0);
    assert.equal(first.personalContextMcpConfig.action, "updated");
    assert.match(config, /^\[mcp_servers\.personal_context\]$/m);
    assert.match(config, /^env_vars = \["HAOLO_PERSONAL_CONTEXT_BROKER_URL", "HAOLO_PERSONAL_CONTEXT_BROKER_TOKEN"\]$/m);
    assert.match(config, /personal-context-server(?:\\\\|\/)index\.mjs/);
    assert.doesNotMatch(config, /HAOLO_PERSONAL_CONTEXT_BROKER_TOKEN\s*=/);
    assert.equal(fs.existsSync(path.join(codexHome, "skills", "personal-context", "SKILL.md")), true);
    const second = syncDefaultCodexResources(codexHome, { includeRuntimeDotCodex: false, skipPlugins: true });
    assert.equal(second.personalContextMcpConfig.action, "unchanged");

    const skill = fs.readFileSync(new URL("SKILL.md", personalContextSkillRoot), "utf8");
    const metadata = fs.readFileSync(new URL("agents/openai.yaml", personalContextSkillRoot), "utf8");
    assert.match(skill, /normal web capability/);
    assert.match(skill, /current user explicitly asks/);
    assert.match(skill, /max_loss_per_trade_percent/);
    assert.match(skill, /preferred_stop_distance_percent/);
    assert.match(skill, /“每次止损5%” does not identify a denominator/);
    assert.match(skill, /Do not save one interpretation and ask afterward/);
    assert.match(skill, /Preserve an explicit value above 3/);
    assert.match(skill, /闪迪特指 SNDK/);
    assert.match(skill, /trading\.aliases/);
    assert.match(skill, /never implies a K-line/);
    assert.doesNotMatch(skill, /product ceiling is 3/);
    assert.match(metadata, /value: "personal_context"/);
    const server = fs.readFileSync(personalContextMcpServer, "utf8");
    assert.match(server, /Ask before writing when phrases such as 止损5% omit that denominator/);
    assert.match(server, /Never invent preferred_stop_loss_percent or risk_reward_preference/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main process owns the bridge, injects risk memory, and keeps encrypted memory local-only", () => {
  const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
  const transfer = fs.readFileSync(new URL("../src/main/user-data-transfer.mjs", import.meta.url), "utf8");
  assert.match(main, /new PersonalContextMcpBridge/);
  assert.match(main, /getPersonalMemoryStore\(\)\.tradingRiskProfile/);
  assert.match(main, /personalContext:getTradingPreferences/);
  assert.match(main, /personalContext:saveTradingPreferences/);
  assert.match(main, /buildPersonalTradingPreferenceDeveloperInstructions/);
  assert.match(main, /Apply these preferences to every trading-related answer, position review, trading plan, trading Skill, and strategy result/);
  assert.match(main, /persistExplicitMarketAliasMemory/);
  assert.match(main, /Resolve any saved market\/entity alias only when the current user mentions that alias/);
  assert.match(main, /An alias is a name mapping/);
  assert.match(main, /Response policy: answer the current question first and adapt the format to it/);
  assert.match(main, /lead with a direct safe\/unsafe\/uncertain judgment/);
  assert.match(main, /explicit value may be higher than 3%; preserve it exactly/);
  assert.match(main, /BLOCKING RISK-PREFERENCE CONFLICT/);
  assert.match(main, /Preferred ordinary take-profit distance/);
  assert.match(main, /tradingStrategyParamsWithReadOnlyBinanceAccount\(personalizedParams\)/);
  assert.match(main, /getAccountService: getBinanceAccountService/);
  assert.match(main, /binanceAccountService = null;[\s\S]*personalContextService = null;/);
  assert.match(main, /loadBinanceAccountContext: loadTradingStrategyReadOnlyBinanceAccountContext/);
  assert.match(main, /snapshot\(owner\.ownerId, \{ force: true, live: true \}\)/);
  assert.match(main, /coordinator\.run\(strategyId, executionParams/);
  assert.match(main, /runTradingPriceActionAnalysisPipeline\([\s\S]*tradingStrategyParamsWithReadOnlyBinanceAccount\(personalizedParams\)/);
  assert.match(preload, /getTradingPreferenceProfile: \(\) => ipcRenderer\.invoke\("personalContext:getTradingPreferences"\)/);
  assert.match(preload, /saveTradingPreferenceProfile: \(params\) => ipcRenderer\.invoke\("personalContext:saveTradingPreferences", params\)/);
  assert.match(main, /withShutdownTimeout\("Personal context MCP bridge", personalContextMcpBridge\.stop\(\)\)/);
  assert.match(main, /LOCAL_ARTIFACT_IGNORED_FILES[\s\S]*"personal-memory\.json"/);
  assert.match(transfer, /"personal-memory\.json"/);
});

test("personal memory is excluded from export and preserved across import", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-personal-memory-export-"));
  try {
    const userDataPath = path.join(tempRoot, "user-data");
    const destinationRoot = path.join(tempRoot, "snapshot");
    const memoryPath = path.join(userDataPath, "personal-memory.json");
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(memoryPath, "local-encrypted-memory", "utf8");
    fs.writeFileSync(path.join(userDataPath, "haolo-session.json"), "{}", "utf8");

    await createUserDataSnapshot({ userDataPath, destinationRoot, externalWorkspaces: [] });
    const importedMemoryPath = path.join(destinationRoot, "data", "userData", "personal-memory.json");
    assert.equal(fs.existsSync(importedMemoryPath), false);
    fs.mkdirSync(path.dirname(importedMemoryPath), { recursive: true });
    fs.writeFileSync(importedMemoryPath, "malicious-imported-memory", "utf8");
    await restoreUserDataSnapshot({ snapshotRoot: destinationRoot, userDataPath, externalWorkspaces: [] });
    assert.equal(fs.readFileSync(memoryPath, "utf8"), "local-encrypted-memory");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("personal context loopback bridge authenticates requests and standalone MCP exposes read and memory tools", async () => {
  const received = [];
  const bridge = new PersonalContextMcpBridge({
    invoke: async (payload) => {
      received.push(payload);
      return { ok: true, tool: payload.tool };
    },
  });
  const env = await bridge.start();
  const child = spawn(process.execPath, [fileURLToPath(personalContextMcpServer)], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc = jsonLineRpc(child);
  try {
    const unauthorized = await fetch(`${env.HAOLO_PERSONAL_CONTEXT_BROKER_URL}/v1/tools/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "list_user_context_sources", arguments: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const initialized = await rpc.call("initialize", { protocolVersion: "2025-03-26" });
    assert.equal(initialized.serverInfo.name, "haolo-personal-context-mcp");
    const listed = await rpc.call("tools/list", {});
    assert.deepEqual(
      listed.tools.map((item) => item.name),
      [
        "list_user_context_sources",
        "read_user_memory",
        "remember_user_memory",
        "forget_user_memory",
        "read_binance_account_context",
      ],
    );
    assert.equal(listed.tools.find((item) => item.name === "read_user_memory").annotations.readOnlyHint, true);
    assert.equal(listed.tools.find((item) => item.name === "read_user_memory").annotations.openWorldHint, false);
    assert.equal(listed.tools.find((item) => item.name === "remember_user_memory").annotations.readOnlyHint, false);
    assert.equal(listed.tools.find((item) => item.name === "forget_user_memory").annotations.destructiveHint, true);
    assert.equal(listed.tools.find((item) => item.name === "read_binance_account_context").annotations.openWorldHint, true);

    const result = await rpc.call("tools/call", { name: "list_user_context_sources", arguments: {} });
    assert.equal(result.structuredContent.ok, true);
    assert.deepEqual(received, [{ tool: "list_user_context_sources", arguments: {} }]);
  } finally {
    child.kill();
    await bridge.stop();
  }
});

function jsonLineRpc(child) {
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const operation = pending.get(message.id);
      if (!operation) continue;
      pending.delete(message.id);
      if (message.error) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result);
    }
  });
  child.on("exit", (code) => {
    for (const operation of pending.values()) {
      operation.reject(new Error(`Personal context MCP exited with code ${code}`));
    }
    pending.clear();
  });
  return {
    call(method, params) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return promise;
    },
  };
}
