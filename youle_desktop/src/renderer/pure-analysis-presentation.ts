import { OFFICIAL_TRADING_CATALOG } from "../shared/official-trading-catalog.mjs";

type Item = {
  id?: string; type?: string; text?: string; phase?: string;
  attachments?: unknown[]; actions?: unknown[];
  __youleCloudReports?: unknown[]; __youleNativeResponseComplete?: boolean;
};
export type PureAnalysisPresentationGroup = {
  key: string; reportIndex: number; outputIndexes: number[]; processIndexes: number[];
};
const normalize = (text: string) => text.normalize("NFKC").trim().toLowerCase().replace(/\s*:\s*/gu, ":");
const tokens = new Map(OFFICIAL_TRADING_CATALOG.flatMap(strategy =>
  [...new Set([strategy.mentions.canonical, ...(strategy.mentions.aliases || []), strategy.display.name])]
    .map(name => [normalize(`@${strategy.display.group === "indicator" ? "指标" : "策略"}:${name}`), strategy.id] as const)));
const legacyComplete = (text: string) => /云端报告和条件校验已完成|雲端報告和條件校驗已完成|分析与绘图已完成|分析與繪圖已完成|cloud report and condition validation are complete|analysis and chart drawing are complete/i.test(text);

// Match only locally generated, request-correlated messages. Never fold an
// ordinary agent answer, tool result, warning or another analysis into a report.
export function pureAnalysisPresentationGroups(items: Array<Item | undefined>): PureAnalysisPresentationGroup[] {
  const groups: PureAnalysisPresentationGroup[] = [];
  for (let reportIndex = 0; reportIndex < items.length; reportIndex++) {
    const report = items[reportIndex];
    if (!report?.__youleCloudReports?.length || report.__youleNativeResponseComplete === false) continue;
    let start = reportIndex, end = reportIndex + 1;
    while (start > 0 && items[start - 1]?.type !== "userMessage") start--;
    while (end < items.length && items[end]?.type !== "userMessage") end++;
    const explicit = /^pure-(trading-.+-progress-\d+-[a-f0-9]+)-report$/.exec(report.id || "");
    let prefix = explicit?.[1];
    if (!prefix) {
      // Repair the previous client's persisted rows without editing history.
      // Require an exact official mention, one local cloud report, and the same
      // generated progress batch on both sides of that early report.
      const user = items[start - 1];
      const strategyId = user && !user.attachments?.length ? tokens.get(normalize(user.text || "")) : null;
      if (!strategyId || !report.id?.startsWith("trading-expert-report-")) continue;
      if (items.slice(start,end).filter(item => item?.__youleCloudReports?.length).length !== 1) continue;
      const before = items.slice(start,reportIndex).map(item => /^(trading-.+-progress-\d+-[a-f0-9]+)-\d+$/.exec(item?.id || "")?.[1]).filter(Boolean);
      prefix = before.find(candidate => candidate!.startsWith(`trading-${strategyId}-progress-`)
        && items.slice(reportIndex+1,end).some(item => item?.id?.startsWith(`${candidate}-`)));
      if (!prefix) continue;
    }
    const outputIndexes = [reportIndex], processIndexes: number[] = [];
    for (let index = start; index < end; index++) {
      const item = items[index];
      if (index === reportIndex || item?.type !== "agentMessage" || !item.id?.startsWith(`${prefix}-`)) continue;
      const suffix = item.id.slice(prefix.length+1);
      if (!/^\d+$/.test(suffix) && !/^notice-\d+$/.test(suffix)) continue;
      outputIndexes.push(index);
      if (!suffix.startsWith("notice-") && !item.attachments?.length && !item.actions?.length
        && (item.phase === "commentary" || legacyComplete(item.text || ""))) processIndexes.push(index);
    }
    groups.push({key:prefix,reportIndex,outputIndexes:outputIndexes.sort((a,b)=>a-b),processIndexes});
  }
  return groups;
}

// Presentation of an already validated report, not a second model request.
// The canonical item is kept complete for persistence; only its visible text
// is revealed. A stop ends pacing immediately and preserves that full result.
export async function revealPureAnalysisReport(text: string, options: {
  isActive: () => boolean; onText: (text: string) => void;
  wait?: (ms: number) => Promise<void>;
}) {
  const characters = Array.from(text);
  const chunk = Math.max(6, Math.ceil(characters.length / 100));
  const wait = options.wait || (ms => new Promise(resolve => window.setTimeout(resolve,ms)));
  for (let end = chunk; end < characters.length; end += chunk) {
    if (!options.isActive()) return;
    options.onText(characters.slice(0,end).join(""));
    await wait(100);
  }
}
