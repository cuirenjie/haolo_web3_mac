import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { deterministicStrategyRequestRouting } from "../src/main/trading-analysis/request-routing-policy.mjs";
import { resolveExplicitTradingStrategyId } from "../src/main/trading-analysis/strategy-selection.mjs";

async function bundledAnalysisCatalog() {
  const root = new URL("../resources/trading-strategies/builtins/", import.meta.url);
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => JSON.parse(await readFile(new URL(`${entry.name}/strategy.json`, root), "utf8"))));
}

test("free-form desktop requests select the explicitly named strategy without an @ mention", async () => {
  const catalog = await bundledAnalysisCatalog();
  assert.equal(resolveExplicitTradingStrategyId("帮我用缠论分析下黄金", catalog), "chan");
  assert.equal(resolveExplicitTradingStrategyId("帮我用裸K看下黄金", catalog), "price-action");
  assert.equal(resolveExplicitTradingStrategyId("按波浪理论分析 BTC 4小时", catalog), "wave");
  assert.equal(resolveExplicitTradingStrategyId("基于ICT研判ETH一小时盘面", catalog), "ict-smc");

  for (const [strategyId, instruction] of [
    ["chan", "帮我用缠论分析下黄金"],
    ["price-action", "帮我用裸K看下黄金"],
  ]) {
    const route = deterministicStrategyRequestRouting(
      instruction,
      catalog.find((strategy) => strategy.id === strategyId),
    );
    assert.equal(route.mode, "chart-analysis", strategyId);
    assert.equal(route.symbol, "XAUUSDT", strategyId);
    assert.equal(route.interval, null, strategyId);
    assert.equal(route.drawingRequested, true, strategyId);
  }
});

test("every enabled bundled strategy and indicator can be selected by canonical natural language", async () => {
  const catalog = await bundledAnalysisCatalog();
  for (const strategy of catalog.filter((item) => item.enabled !== false)) {
    assert.equal(
      resolveExplicitTradingStrategyId(`请使用${strategy.mentions.canonical}分析当前盘面`, catalog),
      strategy.id,
      strategy.id,
    );
  }
});

test("natural-language aliases resolve to the same catalog strategy", async () => {
  const catalog = await bundledAnalysisCatalog();
  for (const strategy of catalog.filter((item) => item.enabled !== false)) {
    for (const alias of strategy.mentions.aliases || []) {
      assert.equal(
        resolveExplicitTradingStrategyId(`用 ${alias} 看下当前行情`, catalog),
        strategy.id,
        `${strategy.id}: ${alias}`,
      );
    }
  }
});

test("negation, replacement, ambiguity, disabled entries, and Latin boundaries fail closed", async () => {
  const catalog = await bundledAnalysisCatalog();
  assert.equal(resolveExplicitTradingStrategyId("不要用缠论，直接分析黄金", catalog), null);
  assert.equal(resolveExplicitTradingStrategyId("不用缠论，改用裸K分析黄金", catalog), "price-action");
  assert.equal(resolveExplicitTradingStrategyId("用缠论而不是裸K分析黄金", catalog), "chan");
  assert.equal(resolveExplicitTradingStrategyId("缠论和裸K有什么区别", catalog), null);
  assert.equal(resolveExplicitTradingStrategyId("@策略:缠论，顺便解释裸K", catalog), "chan");
  assert.equal(resolveExplicitTradingStrategyId("分析 COSMCOIN 当前走势", catalog), null);
  assert.equal(resolveExplicitTradingStrategyId("使用停用策略分析", [
    { id: "disabled", enabled: false, display: { name: "停用策略" }, mentions: { canonical: "停用策略", aliases: [] } },
  ]), null);
});
