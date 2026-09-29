import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { withTradingTranscriptItems } from "../src/main/trading-expert-transcript.mjs";
import { executionPlanCandidatesFromText } from "../src/renderer/execution-plans.ts";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = [
  "orderedThreadItems", "flattenThreadItemRows", "incomingTurnIndexById",
  "preservedExistingThreadItemRow", "preservedSameTurnItemIndex", "compareThreadItemRows",
  "shouldPreserveExistingThreadItem", "shouldPreserveLocalHistoryAheadItem", "latestSortTime",
  "itemStableId", "itemTurnId", "withCollapsedTurnResults", "turnResultGroups",
  "turnResultProcessIndexes", "turnResultStateKey", "turnIdFromResultKey",
  "turnResultDisplayStatus", "normalizedTurnResultStatus",
];
const javascript = ts.transpileModule(names.map((name) => {
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const report = `## BTC/USDT 币安永续 1H
当前动作：等待条件触发
方向判断：偏空
空头触发：83331.111
止损与失效：84936.109
分批止盈：81935.12
风险收益比：1:0.69

## 威科夫分析
价格仍处于交易区间；等待跌破后确认。`;
const records = [
  { id: "user", role: "user", text: "@策略:威科夫", createdAt: "2026-09-27T08:00:00Z" },
  { id: "progress", role: "assistant", phase: "commentary", text: "正在绘图", createdAt: "2026-09-27T08:00:01Z" },
  { id: "report", role: "assistant", phase: "final_answer", text: report, executionPlanPresentation: "execution-plan", createdAt: "2026-09-27T08:00:03Z" },
];
const stage = { id: "trading-stage-job-1", type: "agentMessage", phase: "commentary", text: "正在整理结果.", createdAt: "2026-09-27T08:00:02Z" };

function harness() {
  const state = { items: { thread: {} }, resultProcessExpanded: {} };
  const firstString = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  const deps = {
    state, firstString, localHistoryAheadThreadIds: new Set(["thread"]),
    liveConversationSupplementIds: new Set(), interruptedCodexTurnIds: new Set(),
    agentMessagePhase: (item) => item?.phase || "",
    itemSortTime: (item) => Date.parse(item?.createdAt) || null,
    itemSequence: () => null,
    sortTimeFromValues: (...values) => values.map(Date.parse).find(Number.isFinite) ?? null,
    firstFiniteNumber: (values) => values.find(Number.isFinite) ?? null,
    preserveLiveConversationSupplementOrder() {},
    isContextCompactionItem: () => false, isExternalChannelBridgeUserMessageId: () => false,
    isExternalChannelAgentThreadId: () => false, isLocalStatusThreadItem: () => false,
    isSubagentProcessItem: () => false, isOptimisticUserItemId: () => false,
    isUserSideThreadItem: (item) => item.type === "userMessage",
    isMatchingAgentMessage: (left, right) => left.id === right.id,
    isPreservableLocalHistoryItem: () => true,
    matchingIncomingThreadItem: (item, incoming) => incoming.find((candidate) => candidate.id === item.id),
    localHistoryContentScore: (item) => item.text?.length || 0,
    isThreadBusy: () => false, isInFlightSnapshotItem: () => false,
    activeTradingExpertAnalysisJobIds: () => [],
    compareUnmatchedExternalChannelBridgeRowsByTime: () => 0,
    conversationSupplementIdFromItem: () => null,
    isRenderedUserSideMessage: (message) => message.kind === "user_text",
    isTurnResultOutputMessage: (_, message) => message.kind === "agent_text",
    isTurnResultGroupComplete: () => true, turnResultElapsedLabel: () => "3s",
    cachedConsumptionStatusForTurn: () => null,
  };
  return { state, ...new Function(...Object.keys(deps), `${javascript}\nreturn { orderedThreadItems, withCollapsedTurnResults };`)(...Object.values(deps)) };
}

function render(h, items) {
  h.state.items.thread = Object.fromEntries(items.map((item) => [item.id, item]));
  return h.withCollapsedTurnResults("thread", items.map((item) => ({
    id: item.id, kind: item.type === "userMessage" ? "user_text" : "agent_text",
    text: item.text, executionPlanPresentation: item.__youleExecutionPlanPresentation,
  })));
}

test("reopening a completed analysis drops orphan local stage events and retains the full report/card", () => {
  const h = harness();
  const { thread } = withTradingTranscriptItems({ thread: { id: "thread", turns: [] } }, records);
  const localItems = [...thread.turns[0].items.slice(0, 2), stage, thread.turns[0].items[2]];
  const restored = h.orderedThreadItems(thread, localItems, { threadId: "thread", preserveUnmatched: true });
  const visible = render(h, restored);
  assert.equal(visible.find((message) => message.id === "report")?.text, report);
  assert.equal(visible.find((message) => message.id === "report")?.executionPlanPresentation, "execution-plan");
  assert.equal(executionPlanCandidatesFromText(visible.find((message) => message.id === "report").text).length, 1);
  assert.equal(visible.some((message) => message.id === stage.id), false);
  assert.equal(visible.at(-1).turnResult.status, "handled");
});

test("a separate late commentary group cannot collapse an earlier final analysis", () => {
  const h = harness();
  const { thread } = withTradingTranscriptItems({ thread: { id: "thread", turns: [] } }, records);
  const lateProgress = { ...stage, id: "trading-stage-job-2", turnId: "different-turn" };
  const restored = h.orderedThreadItems(thread, [...thread.turns[0].items, lateProgress], { threadId: "thread", preserveUnmatched: true });
  const visible = render(h, restored);
  assert.equal(visible.find((message) => message.id === "report")?.text, report);
  assert.equal(visible.some((message) => message.id === "trading-stage-job-2"), false);
});

test("sequential strategy reports keep independent processing folds and execution cards", () => {
  const h = harness();
  const secondProgress = {
    ...stage,
    id: "trading-stage-wyckoff",
    role: "assistant",
    text: "威科夫正在绘图",
    createdAt: "2026-09-27T08:00:04Z",
  };
  const secondReport = {
    ...records[2],
    id: "report-wyckoff",
    text: `${report}\n\n## 追加策略\n威科夫等待确认。`,
    createdAt: "2026-09-27T08:00:06Z",
  };
  const { thread } = withTradingTranscriptItems(
    { thread: { id: "thread", turns: [] } },
    [...records, secondProgress, secondReport],
  );
  const items = thread.turns[0].items;
  const visible = render(h, items);
  const first = visible.find((message) => message.id === "report");
  const second = visible.find((message) => message.id === secondReport.id);

  assert.ok(first?.turnResult);
  assert.ok(second?.turnResult);
  assert.notEqual(first.turnResult.key, second.turnResult.key);
  assert.equal(
    visible.filter((message) => message.executionPlanPresentation === "execution-plan").length,
    2,
  );
  assert.equal(visible.some((message) => message.id === "progress"), false);
  assert.equal(visible.some((message) => message.id === secondProgress.id), false);

  h.state.resultProcessExpanded[first.turnResult.key] = true;
  const firstExpanded = render(h, items);
  assert.equal(firstExpanded.some((message) => message.id === "progress"), true);
  assert.equal(firstExpanded.some((message) => message.id === secondProgress.id), false);

  h.state.resultProcessExpanded[second.turnResult.key] = true;
  const bothExpanded = render(h, items);
  assert.equal(bothExpanded.some((message) => message.id === "progress"), true);
  assert.equal(bothExpanded.some((message) => message.id === secondProgress.id), true);
});
