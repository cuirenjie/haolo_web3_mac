import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { buildPositionReview, positionAccountFresh } from "../src/main/position-review-evidence.mjs";
import { analysisEvidence } from "../src/main/codex-analysis-evidence.mjs";
import { CodexBusinessTools } from "../src/main/codex-business-tools.mjs";

const now = Date.now();
const marketId = "BINANCE:FUTURES:SUIUSDT";
function fixture(side = "short") {
  const account = {
    available: true, fetchedAt: new Date(now).toISOString(),
    sources: { futures: "server", openOrders: "unavailable", positionHistory: "unavailable" },
    summary: { marginBalance: 1000, walletBalance: 2000, availableBalance: 900 },
    positions: [{ symbol: "SUIUSDT", direction: side.toUpperCase(), positionSide: "BOTH", amount: 200,
      entryPrice: 1, markPrice: side === "short" ? 1.01 : 0.99, notionalValue: 202,
      leverage: 20, marginType: "cross", liquidationPrice: 0 }],
    openOrders: [],
  };
  const profile = { maxLossPerTradePercent: 0.5, maxLeverage: 10 };
  const analysis = { marketId, symbol: "SUIUSDT", interval: "60",
    report: "扫描完成，等待条件触发。",
    cloudReports: [{ marketId, interval: "60", runId: "cloud-1", strategyId: "price-action",
      report: "市场完整报告：支撑与阻力、趋势、确认条件、失效条件。此为市场证据。",
      executionPlan: {
        market: { marketId, interval: "60" }, planId: "plan-1", expiresAt: now + 60_000, action: "wait",
        positionSizing: { estimatedRoundTripCostRate: 0.002 },
        scenarios: [{ id: "scenario-1", side, trigger: { price: 0.9 },
          stop: { price: side === "short" ? 1.04 : 0.96 }, targets: [{ price: side === "short" ? 0.8 : 1.2 }] }],
      },
    }],
  };
  return { account, profile, analysis, now };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

for (const side of ["short", "long"]) test(`${side} risk uses actual entry/size and equity, including loss realized by reduction`, () => {
  const input = fixture(side);
  const result = buildPositionReview(input), p = result.positions[0], risk = p.referenceRisk[0];
  assert.equal(p.entryPrice, 1); assert.equal(risk.trigger, 0.9);
  near(risk.grossPnlAtReference, -8);
  near(risk.estimatedNetLossAtReference, 8.4);
  near(risk.estimatedNetLossPercentOfEquity, 0.84);
  near(risk.riskBudget, 5); assert.equal(risk.exceedsRiskBudget, true);
  assert.equal(risk.action, "wait");
  assert.equal(p.protectiveOrders.status, "unavailable");
  assert.equal(p.liquidationPrice, null);
  assert.ok(p.findings.includes("leverage-exceeds-preference"));
  const retained = risk.reduction.maximumRemainingQuantityEstimate;
  near(retained, 86.6666666667);
  near(risk.reduction.minimumReductionQuantityEstimate, 113.3333333333);
  near((200 - retained) * 0.01 + retained * 0.04 + 0.4, 5);
  assert.equal(risk.reduction.quantityIsOrder, false);
  assert.equal(result.portfolioAssessmentComplete, false);
});

test("reducing now cannot erase a loss that already exceeds the account limit", () => {
  const input = fixture(); input.account.positions[0].markPrice = 1.03;
  const risk = buildPositionReview(input).positions[0].referenceRisk[0];
  near(risk.estimatedNetLossIfExitAtMark, 6.4);
  assert.equal(risk.reduction.budgetAchievableAtMark, false);
  assert.equal(risk.reduction.realizedLossCannotBeUndone, true);
  assert.equal(risk.reduction.maximumRemainingQuantityEstimate, 0);
});

test("entry-v2 receipt retains its own condition, scenario costs and stricter limit without borrowing another market", () => {
  const receipt = JSON.parse(fs.readFileSync(new URL("./fixtures/left-conditional-receipts.json", import.meta.url), "utf8"))["price-action-zh-CN"];
  const plan = receipt.executionPlan, scenario = plan.scenarios[0];
  const input = fixture("long");
  input.now = plan.createdAt;
  input.account.fetchedAt = new Date(input.now).toISOString();
  Object.assign(input.account.positions[0], { symbol: "BTCUSDT", entryPrice: 91000, markPrice: 91200, amount: 0.01 });
  input.analysis = { marketId: receipt.snapshot.marketId, interval: receipt.snapshot.interval,
    cloudReports: [{ marketId: receipt.snapshot.marketId, interval: receipt.snapshot.interval, executionPlan: structuredClone(plan) }] };
  const reviewed = buildPositionReview(input).positions[0], risk = reviewed.referenceRisk[0];
  assert.equal(reviewed.entryPrice, 91000);
  assert.equal(risk.stop, scenario.stop);
  assert.equal(risk.trigger, scenario.entry);
  assert.equal(risk.entryCondition.trigger.operator, "in_zone");
  assert.equal(risk.estimatedRoundTripCostRate, scenario.positionSizing.estimatedRoundTripCostRate);
  assert.equal(risk.riskLimitPercentApplied, scenario.positionSizing.maxLossPerTradePercent);
  assert.equal(risk.expired, false);
  near(risk.estimatedNetLossAtReference, 0.01 * (91000 - scenario.stop) + 910 * scenario.positionSizing.estimatedRoundTripCostRate);
  input.analysis.cloudReports[0].executionPlan.entryCondition.marketKey = "binance:spot:BTCUSDT";
  input.analysis.cloudReports[0].executionPlan.scenarios[0].entryCondition.marketKey = "binance:spot:BTCUSDT";
  assert.deepEqual(buildPositionReview(input).positions[0].referenceRisk, []);
});

test("missing costs, preferences or true equity cannot produce a claimed compliant quantity", () => {
  for (const missing of ["costs", "equity", "preferences", "ambiguous"]) {
    const input = fixture();
    if (missing === "costs") delete input.analysis.cloudReports[0].executionPlan.positionSizing;
    if (missing === "equity") input.account.summary.marginBalance = null;
    if (missing === "preferences") input.profile = null;
    if (missing === "ambiguous") input.profile.riskClarificationRequired = true;
    const result = buildPositionReview(input);
    const risk = result.positions[0].referenceRisk[0];
    assert.equal(risk.reduction, null, missing);
    assert.equal(risk.exceedsRiskBudget, null, missing);
    if (missing === "equity") assert.equal(result.equity, null, "wallet balance must not substitute for equity");
  }
});

test("stale, unavailable, incomplete and missing timestamps are explicit, never empty or healthy", () => {
  for (const modify of [
    a => { a.available = false; },
    a => { a.fetchedAt = new Date(now - 121000).toISOString(); },
    a => { a.fetchedAt = null; },
    a => { a.warnings = ["使用上次成功读取的数据"]; },
    a => { a.sources.futures = "unavailable"; },
    a => { delete a.positions; },
  ]) {
    const input = fixture(); modify(input.account);
    const result = buildPositionReview(input);
    assert.notEqual(result.accountStatus, "available");
    assert.equal(result.noMatchingPosition, false);
    assert.deepEqual(result.positions, []);
  }
  assert.equal(positionAccountFresh({ ...fixture().account, fetchedAt: new Date(now + 60000).toISOString() }, now), false);
  const input = fixture(); input.account.positions = [];
  assert.equal(buildPositionReview(input).noMatchingPosition, true);
});

test("hedged sides and other holdings stay distinct, and incompatible markets never borrow positions", () => {
  const input = fixture();
  input.account.positions.push({ ...input.account.positions[0], direction: "LONG", positionSide: "LONG" },
    { ...input.account.positions[0], symbol: "BTCUSDT" });
  const result = buildPositionReview(input);
  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0].referenceRisk.length, 1);
  assert.equal(result.positions[1].referenceRisk.length, 0, "short stop cannot be used for long position");
  assert.equal(result.otherPositionsRequiringSeparateMarketEvidence[0].symbol, "BTCUSDT");
  input.analysis.marketId = "BINANCE:SPOT:SUIUSDT";
  assert.equal(buildPositionReview(input).positions.length, 0);
  assert.equal(buildPositionReview(input).marketMatchesAccountProduct, false);
});

test("invalidated or expired reference cannot yield an actionable reduction estimate", () => {
  for (const kind of ["expired", "breached", "wrong-market", "wrong-period"]) {
    const input = fixture(), plan = input.analysis.cloudReports[0].executionPlan;
    if (kind === "expired") plan.expiresAt = now - 1;
    if (kind === "breached") input.account.positions[0].markPrice = 1.05;
    if (kind === "wrong-market") plan.market.marketId = "BINANCE:FUTURES:BTCUSDT";
    if (kind === "wrong-period") plan.market.interval = "240";
    const references = buildPositionReview(input).positions[0].referenceRisk;
    assert.ok(!references.length || references.every(r => r.reduction === null), kind);
  }
});

test("actual protective order matching excludes opening orders, opposite hedge, take profit and inactive orders", () => {
  const input = fixture();
  input.account.sources.openOrders = "server";
  const good = { symbol: "SUIUSDT", side: "BUY", positionSide: "BOTH", orderType: "STOP_MARKET",
    status: "NEW", reduceOnly: true, triggerPrice: 1.03 };
  input.account.openOrders = [good, { ...good, reduceOnly: false }, { ...good, positionSide: "LONG" },
    { ...good, orderType: "TAKE_PROFIT_MARKET" }, { ...good, status: "CANCELED" }];
  const protective = buildPositionReview(input).positions[0].protectiveOrders;
  assert.equal(protective.status, "observed"); assert.equal(protective.orders.length, 1);
  assert.equal(protective.coverageVerified, false);
  assert.equal(protective.orders[0].triggerPrice, 1.03);
});

function brokerFixture(input = fixture()) {
  const calls = [], client = {};
  const broker = new CodexBusinessTools({
    owner: () => "owner", accountRead: async () => structuredClone(input.account), preferencesRead: async () => input.profile,
  });
  const context = broker.bind("root", { client, userText: "持仓健康吗，要不要加减仓",
    executeTrading: async args => { calls.push(args); return { result: structuredClone(input.analysis), presentationItems: [] }; },
  });
  const call = (tool, args = {}) => broker.invokeBound({ tool, arguments: { context_id: context.token, ...args } });
  return { broker, context, calls, call };
}

test("incident regression: real account + full report + risk evidence reach root; summary cannot be presented as advice", async () => {
  const input = fixture(), h = brokerFixture(input);
  await h.call("haolo_account_read");
  const result = await h.call("haolo_analysis", { positionManagementRequested: true });
  assert.equal(result.result.report, input.analysis.cloudReports[0].report);
  assert.equal(result.positionReview.positions[0].entryPrice, 1);
  assert.equal(result.positionReview.positions[0].referenceRisk[0].exceedsRiskBudget, true);
  assert.equal(result.answerRequired, true);
  assert.deepEqual(result.next, ["haolo_chart_draw"]);
  await assert.rejects(h.call("haolo_plan_present", { analysisRef: result.analysisRef, hasRemainingWork: false }), /not a completed position plan/);
  assert.equal(h.calls.filter(c => c.action === "present").length, 0);
  assert.equal(input.analysis.report, "扫描完成，等待条件触发。", "receipt remains immutable");
});

test("a missing notification does not hide full cloud evidence; no evidence requires an honest final answer", async () => {
  const input = fixture();
  input.analysis.report = "";
  const h = brokerFixture(input);
  await h.call("haolo_account_read");
  const result = await h.call("haolo_analysis", { positionManagementRequested: true });
  assert.equal(result.result.report, input.analysis.cloudReports[0].report);
  assert.equal(result.positionReview.accountStatus, "available");
  h.context.executeTrading = async () => ({ result: null });
  const absent = await h.call("haolo_analysis", { instruction: "missing result" });
  assert.equal(absent.status, "analysis-unavailable");
  assert.equal(absent.answerRequired, true);
});

test("cached account is cloned, after-analysis refresh failures stay unavailable, and legacy analysis cannot bypass delivery contract", async () => {
  const input = fixture(), h = brokerFixture(input);
  const account = await h.call("haolo_account_read");
  account.positions[0].amount = 9999;
  const first = await h.call("haolo_analysis", { positionManagementRequested: true, instruction: "first" });
  assert.equal(first.positionReview.positions[0].quantity, 200);
  h.context.accountSnapshot.fetchedAt = new Date(now - 180000).toISOString();
  h.broker.accountRead = async () => { throw new Error("429"); };
  const second = await h.call("haolo_analysis", { positionManagementRequested: true, instruction: "second" });
  assert.equal(second.positionReview.accountStatus, "unavailable");
  assert.deepEqual(second.positionReview.positions, []);
  const legacy = brokerFixture();
  const result = await legacy.call("haolo_trading", { action: "analyze", positionManagementRequested: true });
  assert.equal(result.answerRequired, true);
  assert.equal(result.positionReview.positions.length, 1);
  assert.equal(legacy.calls[0].action, "analyze_only");
});

test("full reports for multiple markets are preserved as evidence; no card can complete mixed work", async () => {
  const input = fixture();
  input.analysis.cloudReports.push({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "240", report: "BTC full evidence" });
  assert.match(analysisEvidence(input.analysis).report, /SUIUSDT[\s\S]*BTC full evidence/);
  const h = brokerFixture(input);
  await h.call("haolo_account_read");
  const { analysisRef } = await h.call("haolo_analysis", { strategyId: "price-action" });
  h.context.executeTrading = async () => ({ presentationItems: [
    { id: "native", type: "agentMessage", text: "scan", __youleNativeResponseComplete: true },
  ] });
  for (const hasRemainingWork of [false, true]) {
    const shown = await h.call("haolo_plan_present", { analysisRef, hasRemainingWork });
    assert.equal(shown.presentationItems[0].__youleNativeResponseComplete, false);
    assert.equal(shown.answerRequired, true);
  }
});
