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

test('legacy expiry rows are omitted from compact and freeform cards without changing saved text', () => {
  for (const label of ['有效至（UTC）:', '有效期：', '有效時間：', '到期時間：', 'Valid until (UTC):', 'Expires at:']) {
    const source = [...lines, { label, text: '2026-10-20T06:43:00+08:00' }], original = structuredClone(source);
    assert.doesNotMatch(executionPlanCardBody(source), /06:43|有效至|有效期|有效時間|到期時間|Valid until|Expires at/);
    assert.doesNotMatch(executionPlanCardBody(source.slice(-1)), /06:43/);
    assert.doesNotMatch(executionPlanStickyHtml({ lines: source }), /06:43/);
    assert.deepEqual(source, original);
  }
});

test("chat, saved and sticky card prices use seven digits without changing source values", () => {
  const before = JSON.stringify(lines);
  const body = executionPlanCardBody(lines);
  assert.match(body, /execution-plan-price bullish">2566\.400</);
  assert.match(body, /execution-plan-price bearish">2403\.330</);
  assert.equal((body.match(/class="execution-plan-target"/g) || []).length, 3);
  for (const [price, ratio] of [["2655.634", "1:0.50"], ["2706.095", "1:0.80"], ["2811.005", "1:1.42"]]) {
    assert.ok(body.includes(`<strong>${price}</strong></span><span class="execution-plan-ratio">盈亏比 ${ratio}</span>`));
  }
  assert.ok(executionPlanStickyHtml({ lines }).includes(executionPlanCardBody(lines, 'zh-CN', { hideAction: true })));
  assert.match(body, /当前动作：[\s\S]*等待条件触发/);
  assert.equal(JSON.stringify(lines), before);
});

test("short prices reverse colors and full original market heading remains available", () => {
  const short = lines.map((line) => line.label === "方向判断：" ? { ...line, text: "偏空" } : line);
  assert.match(executionPlanCardBody(short), /execution-plan-price bearish">2566\.400</);
  assert.match(executionPlanCardBody(short), /execution-plan-price bullish">2403\.330</);
  const title = "ETH/USDT 币安永续 1D · 空头条件方案";
  const header = executionPlanCardHeading(title, short);
  assert.ok(header.includes(`title="${title}">ETH · 1D</h2>`));
  assert.match(header, /execution-plan-badge bearish">做空</);
});

test("USDT headings are shortened for Chinese symbols and localized market names", () => {
  for (const market of ["币安永续", "幣安永續", "Binance Perpetual"]) {
    const title = `龙虾/USDT ${market} 1H · 空头条件方案`;
    const heading = executionPlanCardHeading(title, lines);
    assert.ok(heading.includes(`title="${title}">龙虾 · 1H</h2>`));
    assert.ok(executionPlanStickyHtml({ title, lines }).includes(heading));
  }
  assert.match(executionPlanCardHeading("BTC/usdt Binance Perpetual 4H"), />BTC · 4H<\/h2>/);
  assert.match(executionPlanCardHeading("ETH/USDC 币安永续 1H"), />ETH\/USDC · 1H<\/h2>/);
  assert.match(executionPlanCardHeading("自定义计划"), />自定义计划<\/h2>/);
});

test("seven-digit prices count leading zeros, pad integers and handle rounding across powers of ten", () => {
  for (const [input, expected] of [
    ["0.045657", "0.045657"], ["0.0456574", "0.045657"], ["0.0456575", "0.045658"],
    ["0.04", "0.040000"], ["0.000001", "0.000001"], ["0", "0.000000"],
    ["1", "1.000000"], ["12.345678", "12.34568"], ["123.45678", "123.4568"],
    ["2693.24", "2693.240"], ["85264.40", "85264.40"], ["123456.78", "123456.8"],
    ["1234567.8", "1234568"], ["12345678.9", "12345679"],
    ["0.9999999", "1.000000"], ["9.9999995", "10.00000"], ["99.999995", "100.0000"],
    ["999999.95", "1000000"], ["9999999.5", "10000000"], ["2,480.5466", "2,480.547"],
  ]) {
    const sample = [
      { label: "方向判断：", text: "偏空" },
      { label: "入场触发价：", text: input },
      { label: "止损价：", text: `挂条件委托 ${input} 市价止损` },
      { label: "分批止盈：", text: `第1目标 ${input}，第2目标 ${input}，第3目标 ${input}` },
    ];
    const body = executionPlanCardBody(sample);
    const prices = [...body.matchAll(/(?:class="execution-plan-price (?:bullish|bearish)"|<strong)>?([^<>]+)</g)].map((match) => match[1]);
    assert.deepEqual(prices, Array(5).fill(expected), input);
  }
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
  for (const text of ["Entry trigger", "Stop loss", "Take profit 1", "R/R 1:0.50", "2,480.547"]) assert.ok(html.includes(text));
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
  for (const price of ["2655.634", "2706.095", "2811.005"]) assert.ok(body.includes(`<strong>${price}</strong>`), price);
  for (const text of ["建议开仓", "100.00", "预计止损", "-5.00", "止盈仓位", "33.00", "+1.11", "+3.33", "+6.66", "1:0.50", "1:0.80", "1:1.42"]) assert.ok(body.includes(text), text);
  assert.doesNotMatch(body, /USDT|隐藏的账户汇总|仓位大小|可能盈亏/);
  assert.match(body, /execution-plan-card-number-bearish">-5\.00</);
  for (const profit of ["+1.11", "+3.33", "+6.66"]) {
    assert.ok(body.includes(`execution-plan-card-number-bullish">${profit}</span>`));
  }
  assert.equal((body.match(/class="execution-plan-target"/g) || []).length, 3);
  assert.equal(JSON.stringify(rich), before);
  // Color follows cumulative P&L, even when a long/short target starts at a loss.
  const mixed = rich.map((line) => ({ ...line }));
  mixed[4].text = mixed[4].text.replace("+1.11", "-2.22");
  mixed[5].text = mixed[5].text.replace("-5.00", "5.00");
  for (const direction of ["偏多", "偏空"]) {
    mixed[1].text = direction;
    const mixedBody = executionPlanCardBody(mixed);
    assert.match(mixedBody, /execution-plan-card-number-bullish">\+5\.00</);
    assert.match(mixedBody, /execution-plan-card-number-bearish">-2\.22</);
    assert.match(mixedBody, /execution-plan-estimate">预计盈利 <span>0\.00</);
    assert.match(mixedBody, /execution-plan-card-number-bullish">\+3\.33</);
  }
  // A legacy report that omitted an exit must not attach the next exit to its ratio.
  rich[4].text = rich[4].text.split("，").slice(1).join("，");
  assert.doesNotMatch(executionPlanCardBody(rich), /class="execution-plan-target"/);
});

test("current actions and risk restrictions stay visible, with no invented account amounts", () => {
  for (const action of ["不交易", "先平反向仓位，暂不开新仓", "先减仓，再按计划管理"]) {
    const body = executionPlanCardBody([{ label: "当前动作：", text: action }, ...lines.slice(1)]);
    assert.ok(body.includes(action));
    assert.doesNotMatch(body, /建议开仓|止盈仓位|预计盈利/);
  }
  assert.match(executionPlanCardBody([{ label: "Current action:", text: "Wait for the trigger" }]), /Wait for the trigger/);
  assert.match(executionPlanCardBody([{ label: "當前動作：", text: "等待條件觸發" }]), /等待條件觸發/);
});
