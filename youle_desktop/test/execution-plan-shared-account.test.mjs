import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { sharedSnapshotPosition, sharedSnapshotTime } from "../src/main/binance-account/shared-snapshot.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { executionPlanDisplayLines, executionPlanCandidateFromText, executionPlanCandidatesFromText } from "../src/renderer/execution-plans.ts";
import { executionPlanCardBody, executionPlanCardHeading } from "../src/main/execution-plan-card-view.mjs";
import { validateExecutionPlan } from "../src/main/trading-strategy-runtime/contracts.mjs";

// Exercise the actual main-process wiring with in-memory account I/O only.
const source = ts.createSourceFile("main.mjs", readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functions = ["normalizeSharedBinanceSnapshot", "loadTradingStrategyReadOnlyBinanceAccountContext"].map((name) =>
  source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source),
).join("\n");

function loader({ status = { bound: true, serverCredentialsBound: true, serverConnectionId: "mobile" }, remote, local, changed = false, failed = false } = {}) {
  const calls = [];
  let ownerReads = 0;
  const deps = {
    sharedSnapshotPosition, sharedSnapshotTime,
    requireHaoloAccountOwner: async () => ({ ownerId: changed && ownerReads++ ? "other" : "owner" }),
    readBinanceAccountStatusWithSharedBinding: async (owner) => { calls.push(["status", owner.ownerId]); return status; },
    getBinanceAccountService: () => ({
      status() { throw new Error("must not use local-only binding status"); },
      snapshot: async (owner, options) => { calls.push(["local", owner, options]); return local; },
    }),
    getYouleApiClient: () => ({ getAccountConnectionSnapshot: async (id) => {
      calls.push(["remote", id]);
      if (failed) throw new Error("offline");
      return remote;
    } }),
  };
  return { calls, run: new Function(...Object.keys(deps), `${functions}\nreturn loadTradingStrategyReadOnlyBinanceAccountContext;`)(...Object.values(deps)) };
}

const snapshot = (positions = [], fetchedAt = Date.now()) => ({ fetchedAt, equity: 1000, available: 900, positions });
const result = () => ({
  snapshot: { snapshotId: "test", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "60", snapshotTime: Date.now() },
  theoryResult: { status: "succeeded", evidence: [{ id: "e-1" }], coverage: { candles: "available" }, signals: [{ direction: "bullish", strength: 0.8 }] },
  analysisPlan: { analysisId: "test", actionPlan: { currentPrice: 100, longTrigger: 102, longInvalidation: 98, longTarget: 108, shortTrigger: 96, shortInvalidation: 101, shortTarget: 90, waitZone: { lower: 96, upper: 102 } } },
});
const planFor = (context) => buildExecutionPlanV1({ id: "price-action", version: "1.1.0" }, result(), { binanceAccountContext: context });

test("plan strategy identity survives validation, markdown and localized card display", () => {
  for (const [id, name, english] of [["price-action", "裸K分析", "Price Action"], ["order-flow", "订单流", "Order Flow"], ["chan", "缠论", "Chan Theory"], ["custom-plan", "我的策略", "我的策略"]]) {
    const plan = buildExecutionPlanV1({ id, version: "1.0.0", display: { name } }, result());
    assert.equal(validateExecutionPlan(plan).strategy.name, name);
    for (const language of ["zh-CN", "en"]) {
      const [candidate] = executionPlanCandidatesFromText(formatExecutionPlanMarkdown(plan, { language }));
      const lines = executionPlanDisplayLines(candidate.content);
      assert.ok(executionPlanCardHeading(candidate.title, lines, language).includes(`>${language === "en" ? english : name}</span>`));
      assert.doesNotMatch(executionPlanCardBody(lines, language), /execution-plan-card-label">(?:Strategy|策略)/);
    }
  }
  const legacy = planFor();
  assert.equal(legacy.strategy.name, undefined);
  assert.match(executionPlanCardHeading("BTC/USDT 币安永续 1H", executionPlanDisplayLines(executionPlanCandidateFromText(formatExecutionPlanMarkdown(legacy)).content)), />裸K分析<\/span>/);
});

test("a mobile-only binding reaches desktop sizing, markdown, saved card and sticky data", async () => {
  const h = loader({ remote: snapshot() });
  const context = await h.run();
  assert.equal(context.available, true);
  assert.deepEqual(h.calls, [["status", "owner"], ["remote", "mobile"]]);
  const plan = planFor(context);
  assert.equal(plan.positionSizing.accountStatus, "available");
  assert.equal(plan.positionSizing.accountPlan.mode, "new_position");
  for (const language of ["zh-CN", "en"]) {
    const markdown = formatExecutionPlanMarkdown(plan, { language });
    const candidate = executionPlanCandidateFromText(markdown);
    const body = executionPlanCardBody(executionPlanDisplayLines(candidate.content), language);
    assert.ok(body.includes(language === "en" ? "Suggested position" : "建议开仓"));
    assert.equal((body.match(/class="execution-plan-target"/g) || []).length, plan.positionSizing.accountPlan.targetOrders.length);
    assert.ok(body.includes(language === "en" ? "Target position" : "止盈仓位"));
    assert.ok(body.includes(language === "en" ? "Est. loss" : "预计止损"));
    assert.equal(body.split(language === 'en' ? 'Wait for the trigger' : '等待条件触发').length - 1, 1);
  }
});

test("server positions preserve long/short sizing and opposite-position restrictions", async () => {
  for (const quantity of [1, -1]) {
    const context = await loader({ remote: snapshot([{ symbol: "BTCUSDT", quantity, entryPrice: 99, unrealizedPnl: quantity, leverage: 3 }]) }).run();
    const position = context.snapshot.positions[0];
    assert.equal(position.markPrice, 100);
    assert.equal(position.notionalValue, 100);
    assert.equal(position.amount, 1);
    assert.equal(position.direction, quantity > 0 ? "LONG" : "SHORT");
    const account = planFor(context).positionSizing.accountPlan;
    assert.equal(account.mode, quantity > 0 ? "manage_existing" : "close_opposite");
  }
});

test("unbound, offline, incomplete, stale and switched-account data never produces new sizing", async () => {
  assert.equal((await loader({ status: { bound: false } }).run()).bound, false);
  for (const config of [
    { failed: true },
    { changed: true, remote: snapshot() },
    { remote: snapshot([{ symbol: "BTCUSDT", quantity: 1, entryPrice: 99 }]) },
    { remote: snapshot([], Date.now() - 180_000) },
    { remote: snapshot([], "invalid") },
  ]) {
    const plan = planFor(await loader(config).run());
    assert.equal(plan.positionSizing.accountPlan, null);
    assert.equal(plan.positionSizing.accountStatus, "unavailable");
  }
});

test("local fallback still requests a fresh live snapshot", async () => {
  const h = loader({ status: { bound: true, localBound: true }, local: { fetchedAt: new Date().toISOString(), marginBalance: 1000, availableBalance: 900, positions: [] } });
  assert.equal((await h.run()).available, true);
  assert.deepEqual(h.calls, [["status", "owner"], ["local", "owner", { force: true, live: true }]]);
  assert.equal(sharedSnapshotTime("invalid"), "");
  assert.equal(sharedSnapshotTime(null), "");
  assert.equal(sharedSnapshotTime("1791604800000"), sharedSnapshotTime(1791604800000));
  assert.equal(sharedSnapshotPosition({ quantity: -2, entryPrice: 100, unrealizedPnl: -10 }).markPrice, 105);
});

test("bilateral cards bind separate amounts to their own levels and risk limits", async () => {
  const context = await loader({ remote: snapshot() }).run();
  const neutral = result();
  neutral.theoryResult.signals = [{ direction: "neutral", strength: 0.9 }];
  neutral.analysisPlan.actionPlan.primaryBias = "neutral";
  const build = (extras = {}) => buildExecutionPlanV1({ id: "price-action", version: "1.1.0" }, neutral, { binanceAccountContext: context, ...extras });
  const plan = build();
  assert.equal(plan.preferredSide, "neutral");
  assert.equal(plan.positionSizing.accountPlan, null);
  const [long, short] = plan.scenarios;
  for (const scenario of plan.scenarios) {
    const sizing = scenario.positionSizing;
    assert.equal(sizing.side, scenario.side);
    assert.equal(sizing.entry, scenario.trigger.price);
    assert.equal(sizing.stop, scenario.stop.price);
    assert.equal(sizing.accountPlan.mode, "new_position");
    assert.deepEqual(sizing.accountPlan.targetOrders.map((order) => order.price), scenario.targets.map((target) => target.price));
  }
  assert.notEqual(long.positionSizing.accountPlan.notional, short.positionSizing.accountPlan.notional);
  for (const language of ["zh-CN", "en"]) {
    const cards = executionPlanCandidatesFromText(formatExecutionPlanMarkdown(plan, { language }));
    assert.equal(cards.length, 2);
    for (const [index, card] of cards.entries()) {
      const body = executionPlanCardBody(executionPlanDisplayLines(card.content), language);
      assert.ok(body.includes(plan.scenarios[index].positionSizing.accountPlan.notional.toFixed(2)));
      assert.doesNotMatch(body, /USDT/);
      assert.ok(body.includes(language === "en" ? "Target position" : "止盈仓位"));
    }
  }
  const invalid = JSON.parse(JSON.stringify(plan));
  invalid.scenarios[0].positionSizing = invalid.scenarios[1].positionSizing;
  assert.throws(() => validateExecutionPlan(invalid), /must match its scenario/);
  const blocked = build({ userRiskProfile: { maxStopDistancePercent: 1 } });
  assert.ok(blocked.scenarios.every((scenario) => scenario.positionSizing.executionBlocked && !scenario.positionSizing.accountPlan));
  assert.doesNotMatch(formatExecutionPlanMarkdown(blocked), /用 .*倍杠杆开仓/);
  // Legacy plans without the additive field do not borrow today's balance.
  const legacy = JSON.parse(JSON.stringify(plan));
  legacy.scenarios.forEach((scenario) => { delete scenario.positionSizing; });
  assert.doesNotMatch(formatExecutionPlanMarkdown(legacy), /用 .*倍杠杆开仓/);
});
