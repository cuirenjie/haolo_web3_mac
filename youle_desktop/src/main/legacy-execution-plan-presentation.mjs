// Public presentation only, frozen from Windows b79ec878. No strategy code.
const MAX_PLAN_CONTENT_LENGTH = 20_000;
const CORE_PLAN_LABEL = /(?:当前动作|方向判断|(?:多头|空头|首选方向)?触发|止损(?:与失效)?|分批止盈|风险收益比|候选(?:测算|止损|止盈)|current action|direction|(?:long|short|entry) trigger|stop-loss(?: and invalidation)?|take-profit targets?|risk\/reward)/i;
const PLAN_HEADING = /^(?:(?:标准|推荐|首选|备选|候选|可选)\s*)?(?:(?:执行|行动|实施|操作|落地)\s*)?(?:方案|计划)(?:\s*[A-C一二三123])?(?:\s*[:：-].*)?$|^(?:(?:standard|recommended|preferred|alternative|candidate)\s+)?(?:execution\s+)?plan(?:\s*[A-C123])?(?:\s*[:\-].*)?$/i;
const BINANCE_SYMBOL = /^[A-Z0-9_\p{Script=Han}]{2,40}$/u;
const TRADING_PLAN_HEADING = /^[A-Z0-9_\p{Script=Han}]{1,32}\/(?:USDT|USDC|BUSD)\s+(?:币安永续|BINANCE PERPETUAL)\s+\d+(?:M|H|D|W)(?:\s+·\s+(?:(?:多头|空头)条件方案|(?:LONG|SHORT) SETUP))?$/iu;
const OPTION_LINE = /^(?:(?:方案|候选|选项|路径)\s*(?:[A-C]|[一二三四五六]|\d+)|[A-C]\s*方案|[A-C])\s*[:：、.)-]/i;
const ORDERED_OR_BULLET_LINE = /^(?:[-*+•▪◦]\s+|(?:\d+|[A-C一二三四五六])[.)、]\s*)/i;
function cleanExecutionPlanDisplayText(value) {
    let text = String(value || "");
    for (let depth = 0; depth < 6; depth += 1) {
        const next = text.replace(/（[^（）]*）|\([^()]*\)/g, "");
        if (next === text)
            break;
        text = next;
    }
    return text
        .replace(/[（）()]/g, "")
        .replace(/候选/g, "")
        .replace(/测算/g, "推荐")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([，。；、])/g, "$1")
        .trim();
}
function normalizedBinanceSymbol(value) {
    const symbol = String(value || "")
        .trim()
        .toUpperCase();
    return BINANCE_SYMBOL.test(symbol) ? symbol : "";
}
function normalizedTradeDirection(value) {
    const text = String(value || "");
    if (/(?:偏|看)?空|空头|bearish|short/i.test(text))
        return "SHORT";
    if (/(?:偏|看)?多|多头|bullish|long/i.test(text))
        return "LONG";
    return null;
}
/**
 * Extracts the Binance USDⓈ-M symbol and intended direction from a saved plan.
 * The title is preferred for the market because it is normalized when a plan
 * is created; content remains a fallback for legacy plans.
 */
export function executionPlanBinanceMarketDetails(input) {
    const title = String(input.title || "").trim().toUpperCase();
    const sources = [title, input.content, input.sourceTitle, input.sourceText]
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean);
    const combined = sources.join("\n");
    let symbol = null;
    for (const source of sources) {
        const marketIdMatch = source.match(/BINANCE\s*:\s*FUTURES\s*:\s*([A-Z0-9_\p{Script=Han}]{2,40})(?![A-Z0-9_\p{Script=Han}])/u);
        const slashMatch = source.match(/([A-Z0-9_\p{Script=Han}]{1,32})\s*\/\s*(USDT|USDC|BUSD)(?![A-Z0-9_\p{Script=Han}])/u);
        const compactMatch = source.match(/([A-Z0-9_\p{Script=Han}]{2,40})(?:(?:\s+币安)?(?:永续|合约)|\s+BINANCE\s+PERPETUAL)(?![A-Z0-9_\p{Script=Han}])/u);
        symbol = normalizedBinanceSymbol(marketIdMatch?.[1]
            || (slashMatch ? `${slashMatch[1]}${slashMatch[2]}` : "")
            || compactMatch?.[1]);
        if (symbol && /(?:USDT|USDC|BUSD)$/.test(symbol))
            break;
    }
    const directionLine = String(input.content || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/, "").trim())
        .find((line) => /^(?:方向判断|direction)\s*[：:]/iu.test(line));
    const direction = normalizedTradeDirection(directionLine || combined);
    return {
        symbol: symbol && /(?:USDT|USDC|BUSD)$/.test(symbol) ? symbol : null,
        direction,
    };
}
export function executionPlanDirectionTone(label, text) {
    if (!/(?:方向判断|direction)/iu.test(String(label || "")))
        return "";
    const direction = String(text || "");
    if (/空|bearish|short/iu.test(direction))
        return "bearish";
    if (/多|bullish|long/iu.test(direction))
        return "bullish";
    return "";
}
export function executionPlanSignedNumberSegments(value) {
    const text = String(value || "");
    const pattern = /[+＋\-−－]\s*\d+(?:,\d{3})*(?:\.\d+)?/g;
    const segments = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const matchedText = match[0];
        if (start > 0 && /[\d.]/.test(text[start - 1] || ""))
            continue;
        if (start > cursor)
            segments.push({ text: text.slice(cursor, start), tone: "" });
        segments.push({
            text: matchedText,
            tone: /^[+＋]/.test(matchedText) ? "bullish" : "bearish",
        });
        cursor = start + matchedText.length;
    }
    if (cursor < text.length)
        segments.push({ text: text.slice(cursor), tone: "" });
    return segments.length ? segments : [{ text, tone: "" }];
}
function executionPlanMarketContext(value) {
    const source = String(value || "").trim().toUpperCase();
    if (!source)
        return null;
    let baseAsset = "";
    let quoteAsset = "USDT";
    let interval = "";
    // A complete card heading is authoritative, including when the surrounding
    // report discusses other markets, execution timeframes or holding periods.
    const headingMatch = source.match(/([A-Z0-9_\p{Script=Han}]{1,32})\/(USDT|USDC|BUSD)\s+(?:币安永续|BINANCE PERPETUAL)\s+(\d+)([MHDW])\b/u);
    if (headingMatch)
        return { baseAsset: headingMatch[1], quoteAsset: headingMatch[2], interval: `${Number(headingMatch[3])}${headingMatch[4]}` };
    const marketIdMatch = source.match(/BINANCE:FUTURES:([A-Z0-9_\p{Script=Han}]+?)(USDT|USDC|BUSD)(?![A-Z0-9_\p{Script=Han}])/u);
    const slashMatch = source.match(/([A-Z0-9_\p{Script=Han}]{1,32})\/(USDT|USDC|BUSD)(?![A-Z0-9_\p{Script=Han}])/u);
    if (marketIdMatch) {
        baseAsset = marketIdMatch[1];
        quoteAsset = marketIdMatch[2];
    }
    else if (slashMatch) {
        baseAsset = slashMatch[1];
        quoteAsset = slashMatch[2];
    }
    const compactMatch = source.match(/(?:^|[^A-Z0-9_\p{Script=Han}])([A-Z0-9_\p{Script=Han}]{1,32}?)(\d+)([MHDW])(?:[^A-Z0-9_\p{Script=Han}]|$)/u);
    if (compactMatch && /[A-Z\p{Script=Han}]/u.test(compactMatch[1]) && !baseAsset) {
        const compactBase = compactMatch[1];
        const compactQuoteMatch = compactBase.match(/^(.*?)(USDT|USDC|BUSD)$/);
        baseAsset = compactQuoteMatch?.[1] || compactBase;
        if (compactQuoteMatch)
            quoteAsset = compactQuoteMatch[2];
        interval = `${Number(compactMatch[2])}${compactMatch[3]}`;
    }
    if (!interval) {
        const chineseInterval = source.match(/(?:^|[^0-9])(\d+)\s*(分钟|小时|日|天|周)/u);
        const standardInterval = source.match(/(?:^|[^A-Z0-9])(\d+)\s*([MHDW])(?:[^A-Z0-9]|$)/);
        if (chineseInterval) {
            const unit = chineseInterval[2] === "分钟"
                ? "M"
                : chineseInterval[2] === "小时"
                    ? "H"
                    : chineseInterval[2] === "周"
                        ? "W"
                        : "D";
            interval = `${Number(chineseInterval[1])}${unit}`;
        }
        else if (standardInterval) {
            interval = `${Number(standardInterval[1])}${standardInterval[2]}`;
        }
    }
    return baseAsset && interval ? { baseAsset, quoteAsset, interval } : null;
}
export function executionPlanCardTitle(input) {
    // Resolve each source independently. Joining them lets a later compact label
    // replace the period of an earlier heading (or even pair two different markets).
    let context = null;
    for (const source of [input.fallbackTitle, input.sourceText, input.analysisLabel, input.sourceTitle]) {
        context = executionPlanMarketContext(source);
        if (context)
            break;
    }
    const english = input.language === "en";
    const cleanedFallbackTitle = cleanExecutionPlanDisplayText(input.fallbackTitle).slice(0, 120);
    const safeFallbackTitle = english && /[\u3400-\u9fff]/u.test(cleanedFallbackTitle)
        ? "Execution plan"
        : cleanedFallbackTitle;
    const baseTitle = context
        ? `${context.baseAsset}/${context.quoteAsset} ${english ? "Binance Perpetual" : "币安永续"} ${context.interval}`
        : safeFallbackTitle || (english ? "Execution plan" : "执行计划");
    const fallback = String(input.fallbackTitle || "");
    const sideSuffix = fallback.match(/(?:·|-)\s*(多头|空头)条件方案/u)?.[1]
        || fallback.match(/(?:·|-)\s*(LONG|SHORT) SETUP/iu)?.[1]?.toLowerCase();
    const localizedSideSuffix = sideSuffix
        ? english
            ? `${sideSuffix === "多头" || sideSuffix === "long" ? "Long" : "Short"} setup`
            : `${sideSuffix === "多头" || sideSuffix === "long" ? "多头" : "空头"}条件方案`
        : "";
    if (localizedSideSuffix && !baseTitle.toLowerCase().includes(localizedSideSuffix.toLowerCase())) {
        return `${baseTitle} · ${localizedSideSuffix}`;
    }
    return baseTitle;
}
/** Bind all card actions to this message's original report, never the live thread. */
export function executionPlanCandidateWithSourceText(candidate, sourceText) {
    const hasStrategy = executionPlanDisplayLines(candidate.content)
        .some((line) => /^(?:策略|策略来源|策略來源|strategy)[:：]$/i.test(line.label));
    const strategy = hasStrategy ? "" : executionPlanOriginalReportStrategy(candidate, sourceText);
    return {
        ...candidate,
        title: executionPlanCardTitle({ fallbackTitle: candidate.title, sourceText }),
        ...(strategy ? { content: `${candidate.content}\nStrategy: ${strategy}` } : {}),
    };
}
function executionPlanOriginalReportStrategy(candidate, sourceText) {
    // Older reports predate the per-plan Strategy field. Only use the closest
    // report heading in this original message; a prose mention is not ownership.
    const source = String(sourceText).replace(/\r\n?/g, "\n");
    const start = source.indexOf(candidate.content);
    if (start < 0 || source.lastIndexOf(candidate.content) !== start)
        return "";
    const headings = Array.from(source.slice(0, start).matchAll(/^##[ \t]+([^\n]+)$/gm), (match) => searchableLine(match[1]))
        .filter((heading) => !isExecutionPlanHeading(heading));
    const heading = headings.at(-1) || "";
    const strategies = [
        [/^裸K\s*\/\s*Price Action 分析结论$/i, "price-action"],
        [/^(?:BINANCE:FUTURES:[^\s]+\s*·\s*)?(?:订单流交易计划|Order-flow trading plan)$/i, "order-flow"],
        [/^BINANCE:FUTURES:[^\s]+\s*·\s*\S+缠论分析$/i, "chan"],
        [/^(?:BINANCE:FUTURES:[^\s]+\s*·\s*)?威科夫条件交易计划$/i, "wyckoff"],
        [/^(?:BINANCE:FUTURES:[^\s]+\s*·\s*)?波浪理论交易计划$/i, "wave"],
        [/^图表形态(?:扫描)?结论$/, "chart-patterns"],
        [/^谐波(?:形态|扫描)结论$/, "harmonic"],
        [/^道氏理论结论$/, "dow-theory"],
        [/^江恩理论结论$/, "gann-theory"],
        [/^ICT\s*\/\s*SMC (?:分析|analysis)$/i, "ict-smc"],
    ];
    return strategies.find(([pattern]) => pattern.test(heading))?.[1] || "";
}
export function executionPlanDisplayLines(value) {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((rawLine) => rawLine
        .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, "")
        .replace(/^\s*(?:[-*+•▪◦]\s+|(?:\d+|[A-C一二三四五六])[.)、]\s*)/i, "")
        .replace(/[*_`~]/g, ""))
        .map(cleanExecutionPlanDisplayText)
        .filter(Boolean)
        .map((line) => {
        const labelMatch = line.match(/^(.{1,32}?)([：:])\s*(.*)$/u);
        if (!labelMatch)
            return { label: "", text: line };
        return {
            label: `${labelMatch[1].trim()}${labelMatch[2]}`,
            text: labelMatch[3].trim(),
        };
    });
}
/**
 * A trading analysis can contain the six familiar labels while still being a
 * non-plan placeholder (for example, a neutral direction with every price
 * marked as "未形成"). Keep the generic step-plan parser permissive, but only
 * expose the Add to Plan action when a trading candidate has a concrete
 * direction, trigger, stop and take-profit price.
 */
export function executionPlanHasConcreteTradingPlan(candidate) {
    if (!candidate)
        return false;
    const lines = executionPlanDisplayLines(candidate.content);
    const tradingLabels = lines.filter((line) => /方向判断|触发|止损|止盈|风险收益比|direction|trigger|stop-loss|take-profit|risk\/reward/iu.test(line.label));
    // A market-context heading can be present in an ordinary educational
    // answer (for example, “BTC/USDT 币安永续 4H”).  Do not treat that heading
    // plus prose mentioning stop-loss/take-profit as an actionable plan; a real
    // trading plan must contain at least one of its structured trading fields.
    const candidateTitle = String(candidate.title || "").trim();
    const educationalLabels = lines.some((line) => /交易基础|趋势与结构|支撑与阻力|风险管理|策略执行/u.test(line.label));
    if (!tradingLabels.length
        && (candidateTitle === "执行计划"
            || TRADING_PLAN_HEADING.test(candidateTitle)
            || educationalLabels)) {
        return false;
    }
    if (!tradingLabels.length)
        return true;
    const direction = lines.find((line) => /方向判断|direction/iu.test(line.label))?.text || "";
    if (!/(?:多|空|bullish|bearish|long|short)/iu.test(direction)
        || /中性|未形成|未明确|观望|等待|neutral|not available|unclear|wait/iu.test(direction))
        return false;
    const hasConcretePrice = (pattern) => lines.some((line) => (pattern.test(line.label)
        && !/未形成|未明确|待定|暂无|无|not available|unclear|pending|none/iu.test(line.text)
        && /(?:^|[^\d])\d+(?:,\d{3})*(?:\.\d+)?/u.test(line.text)));
    return hasConcretePrice(/触发|trigger/iu)
        && hasConcretePrice(/止损|stop-loss/iu)
        && hasConcretePrice(/止盈|take-profit/iu);
}
/**
 * Return whether a candidate has the structured fields that identify a
 * trading proposal, independent of whether its values are actionable yet.
 *
 * This is deliberately separate from `executionPlanHasConcreteTradingPlan`:
 * the latter remains permissive for legacy generic plan parsing, while the
 * renderer must not turn arbitrary prose (or a generic project checklist)
 * into a collapsible trading card merely because it contains words such as
 * “止损” or “策略”.
 */
export function executionPlanHasStructuredTradingFields(candidate) {
    if (!candidate)
        return false;
    const lines = executionPlanDisplayLines(candidate.content);
    const hasDirection = lines.some((line) => /方向判断|direction/iu.test(line.label));
    const hasTrigger = lines.some((line) => /触发|trigger/iu.test(line.label));
    const hasStop = lines.some((line) => /止损|stop-loss/iu.test(line.label));
    const hasTakeProfit = lines.some((line) => /止盈|take-profit/iu.test(line.label));
    return hasDirection && hasTrigger && hasStop && hasTakeProfit;
}
function searchableLine(line) {
    return line
        .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, "")
        .replace(/^\s*(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/, "")
        .replace(/[*_`~]/g, "")
        .trim();
}
function isExecutionPlanHeading(value) {
    return PLAN_HEADING.test(value) || TRADING_PLAN_HEADING.test(value);
}
function planHeading(lines, startIndex) {
    for (let index = startIndex; index >= Math.max(0, startIndex - 3); index -= 1) {
        const line = searchableLine(lines[index] || "");
        if (!line)
            continue;
        if (isExecutionPlanHeading(line))
            return line.replace(/[：:]\s*$/, "").slice(0, 120);
    }
    return "执行计划";
}
function planBlock(lines, startIndex, endIndex) {
    const content = lines.slice(startIndex, endIndex + 1).join("\n").trim().slice(0, MAX_PLAN_CONTENT_LENGTH);
    if (content.length < 32)
        return null;
    return {
        title: planHeading(lines, startIndex - 1),
        content,
    };
}
function explicitHeadingCandidates(lines) {
    const candidates = [];
    for (let headingIndex = 0; headingIndex < lines.length; headingIndex += 1) {
        const heading = searchableLine(lines[headingIndex] || "");
        if (!isExecutionPlanHeading(heading))
            continue;
        let endIndex = headingIndex;
        let structuredLineCount = 0;
        let coreLabelCount = 0;
        for (let index = headingIndex + 1; index < Math.min(lines.length, headingIndex + 42); index += 1) {
            const raw = lines[index] || "";
            const searchable = searchableLine(raw);
            if (index > headingIndex + 1 && (/^\s*#{1,6}\s+/.test(raw) || /^\s*(?:---+|___+)\s*$/.test(raw)))
                break;
            if (ORDERED_OR_BULLET_LINE.test(raw.trim()))
                structuredLineCount += 1;
            if (CORE_PLAN_LABEL.test(searchable))
                coreLabelCount += 1;
            if (searchable)
                endIndex = index;
            if (/风险收益比|risk\/reward/i.test(searchable) && coreLabelCount >= 3)
                break;
        }
        if (structuredLineCount < 2 && coreLabelCount < 2)
            continue;
        const candidate = planBlock(lines, headingIndex + 1, endIndex);
        if (candidate)
            candidates.push({
                ...candidate,
                title: heading.slice(0, 120),
                headingIndex,
                endIndex,
            });
    }
    return candidates;
}
function explicitHeadingCandidate(lines) {
    return explicitHeadingCandidates(lines)[0] || null;
}
function boundedCorePlanCandidate(lines) {
    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
        if (!CORE_PLAN_LABEL.test(searchableLine(lines[startIndex] || "")))
            continue;
        let coreLabelCount = 0;
        let endIndex = startIndex;
        for (let index = startIndex; index < Math.min(lines.length, startIndex + 36); index += 1) {
            const raw = lines[index] || "";
            if (index > startIndex && (/^\s*#{1,6}\s+/.test(raw) || /^\s*(?:---+|___+)\s*$/.test(raw)))
                break;
            const searchable = searchableLine(raw);
            if (!CORE_PLAN_LABEL.test(searchable))
                continue;
            coreLabelCount += 1;
            endIndex = index;
            if (/风险收益比|risk\/reward/i.test(searchable) && coreLabelCount >= 3)
                break;
        }
        if (coreLabelCount >= 3)
            return planBlock(lines, startIndex, endIndex);
    }
    return null;
}
export function executionPlanCandidateFromText(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!text)
        return null;
    const lines = text.split("\n");
    const headingCandidate = explicitHeadingCandidate(lines);
    if (headingCandidate)
        return headingCandidate;
    const coreCandidate = boundedCorePlanCandidate(lines);
    if (coreCandidate)
        return coreCandidate;
    const optionIndexes = lines
        .map((line, index) => (OPTION_LINE.test(searchableLine(line)) ? index : -1))
        .filter((index) => index >= 0);
    if (optionIndexes.length < 2)
        return null;
    return planBlock(lines, optionIndexes[0], optionIndexes[optionIndexes.length - 1]);
}
export function executionPlanCandidatesFromText(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!text)
        return [];
    const lines = text.split("\n");
    const explicitCandidates = explicitHeadingCandidates(lines);
    if (explicitCandidates.length)
        return explicitCandidates.map(({ headingIndex, endIndex, ...candidate }) => candidate);
    const candidate = executionPlanCandidateFromText(text);
    return candidate ? [candidate] : [];
}
export function executionPlanTextPartitions(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!text)
        return null;
    const lines = text.split("\n");
    const explicitCandidates = explicitHeadingCandidates(lines);
    if (!explicitCandidates.length) {
        const partition = executionPlanTextPartition(text);
        return partition ? {
            before: partition.before,
            candidates: [partition.candidate],
            after: partition.after,
        } : null;
    }
    const first = explicitCandidates[0];
    const last = explicitCandidates[explicitCandidates.length - 1];
    if (!first || !last)
        return null;
    const candidates = explicitCandidates.map(({ headingIndex, endIndex, ...candidate }) => candidate);
    const trailingContext = [];
    let contextStart = first.endIndex + 1;
    for (const candidate of explicitCandidates.slice(1)) {
        const context = lines.slice(contextStart, candidate.headingIndex).join("\n").trim();
        if (context)
            trailingContext.push(context);
        contextStart = candidate.endIndex + 1;
    }
    const finalContext = lines.slice(contextStart).join("\n").trim();
    if (finalContext)
        trailingContext.push(finalContext);
    return {
        before: lines.slice(0, first.headingIndex).join("\n").trim(),
        candidates,
        after: trailingContext.join("\n\n"),
    };
}
export function executionPlanTextPartition(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    const candidate = executionPlanCandidateFromText(text);
    if (!candidate)
        return null;
    const contentIndex = text.indexOf(candidate.content);
    if (contentIndex < 0)
        return null;
    let before = text.slice(0, contentIndex);
    const beforeLines = before.split("\n");
    let headingIndex = beforeLines.length - 1;
    while (headingIndex >= 0 && !searchableLine(beforeLines[headingIndex] || ""))
        headingIndex -= 1;
    if (headingIndex >= 0 && isExecutionPlanHeading(searchableLine(beforeLines[headingIndex] || ""))) {
        before = beforeLines.slice(0, headingIndex).join("\n");
    }
    return {
        before: before.trim(),
        candidate,
        after: text.slice(contentIndex + candidate.content.length).trim(),
    };
}
