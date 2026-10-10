import assert from "node:assert/strict";
import test from "node:test";
import { executionPlanCardBody, executionPlanCardHeading } from "../src/main/execution-plan-card-view.mjs";
import { executionPlanStickyHtml } from "../src/main/execution-plan-sticky-view.mjs";

const lines = [
  { label: "当前动作：", text: "等待条件触发" },
  { label: "方向判断：", text: "偏多" },
  { label: "多头触发：", text: "2566.4" },
  { label: "止损与失效：", text: "2403.33" },
  { label: "分批止盈：", text: "第1目标 2655.6342，第2目标 2706.09504，第3目标 2811.005" },
  { label: "风险收益比：", text: "目标1为 1:0.5，目标2为 1:0.8，目标3为 1:1.42" },
];

test("chat and sticky cards round display to two decimals without changing source values", () => {
  const before = JSON.stringify(lines);
  const body = executionPlanCardBody(lines);
  assert.match(body, /execution-plan-price bullish">2566\.40</);
  assert.match(body, /execution-plan-price bearish">2403\.33</);
  assert.equal((body.match(/class="execution-plan-target"/g) || []).length, 3);
  for (const [price, ratio] of [["2655.63", "1:0.50"], ["2706.10", "1:0.80"], ["2811.01", "1:1.42"]]) {
    assert.ok(body.includes(`<strong>${price}</strong></span><span class="execution-plan-ratio">盈亏比 ${ratio}</span>`));
  }
  assert.ok(executionPlanStickyHtml({ lines }).includes(body));
  assert.doesNotMatch(body, /当前动作|等待条件触发/);
  assert.equal(JSON.stringify(lines), before);
});

test("short prices reverse colors and full original market heading remains available", () => {
  const short = lines.map((line) => line.label === "方向判断：" ? { ...line, text: "偏空" } : line);
  assert.match(executionPlanCardBody(short), /execution-plan-price bearish">2566\.40</);
  assert.match(executionPlanCardBody(short), /execution-plan-price bullish">2403\.33</);
  const title = "ETH/USDT 币安永续 1D · 空头条件方案";
  const header = executionPlanCardHeading(title, short);
  assert.ok(header.includes(`title="${title}">ETH/USDT · 1D</h2>`));
  assert.match(header, /execution-plan-badge bearish">做空</);
});

test("conditional prices, account details and complex target descriptions remain intact", () => {
  const rich = lines.map((line) => ({ ...line }));
  rich[2].text = "2566.4，用 3 倍杠杆开仓 100 USDT 的多单";
  rich[3].text = "挂条件委托 2403.33 市价止损";
  rich[4].text = "挂条件委托 2655.6342 市价止盈 50 USDT；预计盈利 +2.51 USDT";
  rich[5].text += "，如果止损：约 -5.00 USDT";
  const body = executionPlanCardBody(rich);
  for (const text of ["建议开仓", "100.00", "市价止损", "市价止盈 50.00", "+2.51", "-5.00", "目标3为 1:1.42"]) assert.ok(body.includes(text), text);
  assert.doesNotMatch(body, /USDT/);
  assert.doesNotMatch(body, /class="execution-plan-target"/);
  rich[2].text = "2566.4–2570 收盘确认后入场";
  assert.ok(executionPlanCardBody(rich).includes("2566.40–2570 收盘确认后入场"));
  assert.doesNotMatch(executionPlanCardBody(rich), /execution-plan-price bullish">2566/);
});

test("unmatched ratios and legacy content are retained without guessing", () => {
  const unusual = lines.map((line) => ({ ...line }));
  unusual[5].text = "目标4为 1:2";
  assert.match(executionPlanCardBody(unusual), /目标4为 1:2/);
  const legacy = [{ label: "说明：", text: "<img src=x onerror=alert(1)>" }];
  assert.match(executionPlanCardBody(legacy), /&lt;img/);
  assert.doesNotMatch(executionPlanCardBody(legacy), /<img|execution-plan-metrics/);
  assert.match(executionPlanCardHeading('<script>bad</script>'), /&lt;script&gt;/);
});

test("English and Traditional Chinese labels also reach sticky windows", () => {
  const en = [
    { label: "Direction:", text: "Short" }, { label: "Short trigger:", text: "2,480.5466" },
    { label: "Stop-loss and invalidation:", text: "2566.4" },
    { label: "Take-profit targets:", text: "Target 1: 2430.17826021; Target 2: 2402.9339125" },
    { label: "Risk/reward:", text: "Target 1: 1:0.5; Target 2: 1:0.8" },
  ];
  const html = executionPlanStickyHtml({ language: "en", lines: en });
  for (const text of ["Entry trigger", "Stop loss", "Take profit 1", "R/R 1:0.50", "2,480.55"]) assert.ok(html.includes(text));
  assert.match(executionPlanCardBody(lines, "zh-TW"), /入場觸發價/);
});

test("same-report account amounts and cumulative target profit are displayed together", () => {
  const rich = lines.map((line) => ({ ...line }));
  rich[2].text = "2566.4，用 3 倍杠杆开仓 100 USDT 的多单";
  rich[3].text = "挂条件委托 2403.33 市价止损";
  rich[4].text = "挂条件委托 2655.6342 市价止盈 33 USDT；预计盈利 +1.11 USDT，挂条件委托 2706.09504 市价止盈 33 USDT；预计盈利 +2.22 USDT，挂条件委托 2811.005 市价止盈 34 USDT；预计盈利 +3.33 USDT";
  rich[5].text += "，如果止损：约 -5.00 USDT，如果全部止盈：约 +6.66 USDT";
  for (const label of ["仓位大小：", "可能盈亏：", "倉位大小：", "可能盈虧：", "Position size:", "Potential P&L:"]) {
    rich.push({ label, text: "隐藏的账户汇总 50.51 USDT" });
  }
  const before = JSON.stringify(rich);
  const body = executionPlanCardBody(rich);
  for (const text of ["建议开仓", "100.00", "预计止损", "-5.00", "止盈仓位", "33.00", "+1.11", "+3.33", "+6.66", "1:0.50", "1:0.80", "1:1.42"]) assert.ok(body.includes(text), text);
  assert.doesNotMatch(body, /USDT|隐藏的账户汇总|仓位大小|可能盈亏|execution-plan-card-number/);
  assert.equal((body.match(/class="execution-plan-target"/g) || []).length, 3);
  assert.equal(JSON.stringify(rich), before);
  // A legacy report that omitted an exit must not attach the next exit to its ratio.
  rich[4].text = rich[4].text.split("，").slice(1).join("，");
  assert.doesNotMatch(executionPlanCardBody(rich), /class="execution-plan-target"/);
});

test("non-wait actions and risk restrictions stay visible, with no invented account amounts", () => {
  for (const action of ["不交易", "先平反向仓位，暂不开新仓", "先减仓，再按计划管理"]) {
    const body = executionPlanCardBody([{ label: "当前动作：", text: action }, ...lines.slice(1)]);
    assert.ok(body.includes(action));
    assert.doesNotMatch(body, /建议开仓|止盈仓位|预计盈利/);
  }
  assert.doesNotMatch(executionPlanCardBody([{ label: "Current action:", text: "Wait for the trigger" }]), /Wait for the trigger/);
  assert.doesNotMatch(executionPlanCardBody([{ label: "當前動作：", text: "等待條件觸發" }]), /等待條件觸發/);
});
