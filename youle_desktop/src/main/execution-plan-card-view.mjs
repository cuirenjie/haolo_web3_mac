// Presentation only: keep the stored report and all plan/alert inputs untouched.
const copy = {
  "zh-CN": { entry: "入场触发价", stop: "止损价", long: "做多", short: "做空", target: (n) => `第${n}止盈`, ratio: "盈亏比", new: "建议开仓", existing: "现有仓位", reduce: "建议减仓至", amount: "止盈仓位", profit: "预计盈利", loss: "预计止损" },
  "zh-TW": { entry: "入場觸發價", stop: "止損價", long: "做多", short: "做空", target: (n) => `第${n}止盈`, ratio: "盈虧比", new: "建議開倉", existing: "現有倉位", reduce: "建議減倉至", amount: "止盈倉位", profit: "預計盈利", loss: "預計止損" },
  en: { entry: "Entry trigger", stop: "Stop loss", long: "Long", short: "Short", target: (n) => `Take profit ${n}`, ratio: "R/R", new: "Suggested position", existing: "Existing position", reduce: "Reduce position to", amount: "Target position", profit: "Est. profit", loss: "Est. loss" },
};
const number = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const labelOf = (line) => String(line.label || "").replace(/[：:]\s*$/, "").trim();
const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const matches = (line, pattern) => pattern.test(labelOf(line));
const fixed = (value) => Number(String(value).replace(/,/g, "")).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: String(value).includes(",") });

// Format decimal tokens only in freeform text: indices, dates, periods and
// leverage counts are not prices. Structured price/money fields also pad integers.
function displayText(value) {
  return String(value || "").replace(/\d+(?:,\d{3})*\.\d+/g, (token, offset, source) => {
    if (/[\w./]/.test(source[offset - 1] || "") || /[\w./]/.test(source[offset + token.length] || "")) return token;
    return fixed(token);
  }).replace(/(\d+(?:,\d{3})*(?:\.\d+)?)\s+(USDT|USDC|BUSD)\b/gi, (_, value, unit) => `${fixed(value)}${unit.toUpperCase() === "USDT" ? "" : ` ${unit}`}`);
}

function waitingAction(line) {
  return matches(line, /^(?:当前动作|當前動作|current action)$/i)
    && /^(?:等待条件触发|等待條件觸發|wait for the trigger)[。.!！]?$/i.test(String(line.text).trim());
}

function direction(lines) {
  const line = lines.find((line) => matches(line, /^(?:方向判断|方向判斷|direction)$/i));
  if (/^(?:偏多|做多|多头|bullish|long)$/i.test(String(line?.text || "").trim())) return "bullish";
  if (/^(?:偏空|做空|空头|bearish|short)$/i.test(String(line?.text || "").trim())) return "bearish";
  return "";
}

function signedText(text) {
  const value = displayText(text);
  let html = "", cursor = 0;
  for (const match of value.matchAll(/[+＋\-−－]\s*\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    if (match.index > 0 && /[\d.]/.test(value[match.index - 1])) continue;
    html += escape(value.slice(cursor, match.index));
    const tone = /^[+＋]/.test(match[0]) ? "bullish" : "bearish";
    html += `<span class="execution-plan-card-number-${tone}">${escape(match[0])}</span>`;
    cursor = match.index + match[0].length;
  }
  return html + escape(value.slice(cursor));
}

function lineHtml(line) {
  return `<p class="execution-plan-card-line"><span class="execution-plan-card-label">${escape(line.label)}</span><span class="execution-plan-card-value">${signedText(line.text)}</span></p>`;
}

// Same names as mobile execution_plan_display.dart; never guess a strategy
// from direction, prices or the currently selected strategy in the app.
function strategyLabel(value, language) {
  const raw = String(value || "").trim().replace(/^@(?:策略|strategy)\s*[:：]\s*/i, "").split(/[\r\n]/)[0];
  const names = [
    ["price-action|price_action|Price Action|裸K分析", "裸K分析", "裸K分析", "Price Action"],
    ["order-flow|order_flow|Order Flow|订单流|訂單流", "订单流", "訂單流", "Order Flow"],
    ["chan|Chan Theory|缠论|纏論", "缠论", "纏論", "Chan Theory"],
    ["wyckoff|Wyckoff Method|威科夫", "威科夫", "威科夫", "Wyckoff"],
    ["wave|elliott_wave|Elliott Wave|Elliott Wave Theory|波浪理论|波浪理論", "波浪理论", "波浪理論", "Elliott Wave"],
    ["chart-patterns|Chart Patterns|图表形态学|圖表形態學|传统图表形态|图表形态", "图表形态学", "圖表形態學", "Chart Patterns"],
    ["harmonic|Harmonic Patterns|谐波形态|諧波形態|谐波", "谐波形态", "諧波形態", "Harmonic"],
    ["dow-theory|Dow Theory|道氏理论|道氏理論", "道氏理论", "道氏理論", "Dow Theory"],
    ["gann-theory|gann|Gann Theory|江恩理论|江恩理論", "江恩理论", "江恩理論", "Gann Theory"],
    ["smt-divergence|SMT Divergence|SMT 背离|SMT 背離|SMT", "SMT 背离", "SMT 背離", "SMT Divergence"],
    ["ict-smc|ict_smc|ICT/SMC|ICT / SMC", "ICT / SMC", "ICT / SMC", "ICT / SMC"],
  ];
  const match = names.find(([aliases]) => aliases.split("|").some((alias) => alias.toLowerCase() === raw.toLowerCase()));
  return match ? match[language === "en" ? 3 : language === "zh-TW" ? 2 : 1] : raw;
}

export function executionPlanCardHeading(title, lines = [], language = "zh-CN") {
  const labels = copy[language] || copy["zh-CN"];
  const tone = direction(lines);
  const market = String(title).match(/^(.+?\/(?:USDT|USDC|BUSD))\s+(?:币安永续|幣安永續|Binance Perpetual)\s+(\d+[MHDW])(?:\s|$)/i);
  const heading = market ? `${market[1]} · ${market[2]}` : title;
  const strategy = lines.find((line) => matches(line, /^(?:策略|策略来源|策略來源|strategy)$/i));
  const name = strategyLabel(strategy?.text, language);
  const badges = `${tone ? `<span class="execution-plan-badge ${tone}">${labels[tone === "bullish" ? "long" : "short"]}</span>` : ""}${name ? `<span class="execution-plan-badge strategy" title="${escape(name)}">${escape(name)}</span>` : ""}`;
  return `<div class="execution-plan-heading"><h2 title="${escape(title)}">${escape(heading)}</h2>${badges ? `<span class="execution-plan-badges">${badges}</span>` : ""}</div>`;
}

function metricHtml(line, label, tone, detail = "") {
  // Only recognize the report formatter's exact price prefixes. Other wording
  // remains verbatim; never turn a condition, range or amount into a new price.
  const match = String(line.text).match(new RegExp(`^(?:(?:挂条件委托|掛條件委託|止损|止損|Conditional market stop at|Stop loss:)\\s*)?(${number})(?![\\d.])([\\s\\S]*)$`, "i"));
  if (!match || /^\s*(?:[-~～–/%]|至|到|to\b|e[+-]?\d)/i.test(match[2])) {
    return `<div class="execution-plan-metric"><div class="execution-plan-card-label">${escape(line.label)}</div><div class="execution-plan-metric-description">${signedText(line.text)}</div></div>`;
  }
  const suffix = match[2].trim().replace(/^[，,;；]\s*/, "");
  return `<div class="execution-plan-metric"><div class="execution-plan-card-label">${label}</div><div class="execution-plan-price ${tone}">${escape(fixed(match[1]))}</div>${detail || (suffix ? `<div class="execution-plan-metric-description">${signedText(suffix)}</div>` : "")}</div>`;
}

function moneyDetail(label, value, className = "", signed = false) {
  const amount = Number(String(value).replace(/,/g, ""));
  const text = `${signed && amount > 0 ? "+" : ""}${fixed(value)}`;
  return `<div class="execution-plan-account-detail ${className}">${escape(label)} <span>${escape(text)}</span></div>`;
}

function entryAmount(text) {
  const patterns = [
    ["new", new RegExp(`^${number}，用 ${number} 倍杠杆开仓 (${number}) USDT 的(?:多|空)单$`)],
    ["existing", new RegExp(`^${number}，已有 (${number}) USDT 的(?:多|空)单，按现有仓位执行，不重复开仓$`)],
    ["reduce", new RegExp(`^${number}，已有 ${number} USDT 的(?:多|空)单，先减至 (${number}) USDT$`)],
    ["new", new RegExp(`^${number}; open a (${number}) USDT (?:long|short) position with ${number}x leverage$`, "i")],
    ["existing", new RegExp(`^${number}; manage the existing (${number}) USDT (?:long|short) position without adding$`, "i")],
    ["reduce", new RegExp(`^${number}; reduce the existing ${number} USDT (?:long|short) position to (${number}) USDT$`, "i")],
  ];
  for (const [mode, pattern] of patterns) {
    const match = String(text).match(pattern);
    if (match) return { mode, value: match[1] };
  }
  return null;
}

function accountTargets(text) {
  // Only the deterministic formatter's complete order records are accepted.
  // No amount may be inferred from a price, ratio or a different card.
  const pattern = new RegExp(`(?:挂条件委托 (${number}) 市价止盈 (${number}) USDT[；;]预计盈利 ([+-]?${number}) USDT|Conditional market take profit at (${number}) for (${number}) USDT; estimated profit ([+-]?${number}) USDT)`, "gi");
  const targets = [];
  let cursor = 0, cumulative = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (!/^[，,;；\s]*$/.test(text.slice(cursor, match.index))) return null;
    cumulative += Number((match[3] || match[6]).replace(/,/g, ""));
    targets.push({ index: targets.length + 1, price: match[1] || match[4], amount: match[2] || match[5], profit: cumulative });
    cursor = match.index + match[0].length;
  }
  return targets.length && /^[，,;；\s]*$/.test(text.slice(cursor)) ? targets : null;
}

function simpleTargets(text) {
  const parts = String(text).split(/[，；;]|,(?!\d{3}(?:\D|$))/).map((part) => part.trim()).filter(Boolean);
  const pattern = new RegExp(`^(?:(?:第\\s*(\\d+)\\s*(?:目标|目標|止盈)|(?:Target|TP)\\s*(\\d+))\\s*[:：]?\\s*)?(${number})$`, "i");
  const targets = parts.map((part, index) => {
    const match = part.match(pattern);
    return match ? { index: Number(match[1] || match[2] || index + 1), price: match[3] } : null;
  });
  return targets.length && targets.every(Boolean) && new Set(targets.map((item) => item.index)).size === targets.length ? targets : null;
}

function simpleRatios(text, targets) {
  const outcome = String(text).match(/^(.*?)(?:，如果止损：约 (-?[\d,.]+) USDT，如果全部止盈：约 ([+-]?[\d,.]+) USDT|; estimated stop-loss outcome: (-?[\d,.]+) USDT; estimated all-target outcome: ([+-]?[\d,.]+) USDT)$/i);
  const parts = String(outcome?.[1] ?? text).split(/[，,；;]/).map((part) => part.trim()).filter(Boolean);
  const pattern = /^(?:(?:目标|目標|Target)\s*(\d+)\s*(?:为|為|[:：])?\s*)?(1\s*[:：]\s*\d+(?:\.\d+)?)$/i;
  const ratios = parts.map((part) => part.match(pattern));
  if (!ratios.length || !ratios.every(Boolean)) return null;
  const indexed = ratios.map((match) => ({ index: match[1] ? Number(match[1]) : targets.length === 1 ? targets[0].index : 0, value: match[2] }));
  if (indexed.some((item) => !targets.some((target) => target.index === item.index)) || new Set(indexed.map((item) => item.index)).size !== indexed.length) return null;
  return { values: new Map(indexed.map((item) => [item.index, `1:${fixed(item.value.split(/[:：]/)[1].trim())}`])), loss: outcome?.[2] ?? outcome?.[4] };
}

export function executionPlanCardBody(lines = [], language = "zh-CN") {
  // Presentation only: hide the verbose account summaries, keeping the report
  // and saved/alert inputs intact. Per-level amounts remain beside their prices.
  lines = lines.filter((line) => !waitingAction(line)
    && !matches(line, /^(?:仓位大小|倉位大小|可能盈亏|可能盈虧|position size|potential P&L)$/i));
  const labels = copy[language] || copy["zh-CN"];
  const entry = lines.find((line) => matches(line, /^(?:(?:多头|空头|首选方向|方向)?触发|入场触发价|(?:long|short|entry) trigger)$/i));
  const stop = lines.find((line) => matches(line, /^(?:止损(?:与失效)?|止损价|stop-loss(?: and invalidation)?)$/i));
  const tone = direction(lines);
  // Legacy freeform plans keep all their text and do not invent metrics.
  if (!entry || !stop || !tone) return lines.map(lineHtml).join("");
  const consumed = new Set([entry, stop]);
  const targetLine = lines.find((line) => matches(line, /^(?:分批止盈|take-profit targets?)$/i));
  const ratioLine = lines.find((line) => matches(line, /^(?:风险收益比|風險收益比|risk\/reward)$/i));
  const amount = entryAmount(entry.text);
  const account = targetLine && amount && accountTargets(targetLine.text);
  let targets = targetLine && (simpleTargets(targetLine.text) || account);
  const ratios = targets && ratioLine && simpleRatios(ratioLine.text, targets);
  // Older reports could omit zero-sized target orders. Never shift their ratios.
  if (account && (!ratios || ratios.values.size !== account.length)) targets = null;
  let html = `<div class="execution-plan-metrics">${metricHtml(entry, labels.entry, tone, amount ? moneyDetail(labels[amount.mode], amount.value) : "")}${metricHtml(stop, labels.stop, tone === "bullish" ? "bearish" : "bullish", ratios?.loss ? moneyDetail(labels.loss, ratios.loss, "execution-plan-estimate", true) : "")}</div>`;
  if (targets) {
    consumed.add(targetLine);
    if (ratios) consumed.add(ratioLine);
    html += `<div class="execution-plan-targets">${targets.map((target) => `<div class="execution-plan-target"><span class="execution-plan-target-main"><span class="execution-plan-card-label">${labels.target(target.index)}:</span> <strong>${escape(fixed(target.price))}</strong></span>${ratios?.values.has(target.index) ? `<span class="execution-plan-ratio">${labels.ratio} ${escape(ratios.values.get(target.index))}</span>` : ""}${target.amount != null ? moneyDetail(labels.amount, target.amount, "execution-plan-target-amount") + moneyDetail(labels.profit, target.profit, "execution-plan-target-profit execution-plan-estimate", true) : ""}</div>`).join("")}</div>`;
  }
  // The heading carries the direction/strategy; retain conditions and
  // unrecognized target formats after the presentation-only omissions above.
  const remainder = lines.filter((line) => !consumed.has(line) && !matches(line, /^(?:方向判断|方向判斷|direction|策略|策略来源|策略來源|strategy)$/i));
  if (remainder.length) html += `<div class="execution-plan-details">${remainder.map(lineHtml).join("")}</div>`;
  return html;
}
