import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as plans from "../../src/renderer/execution-plans.ts";
import * as view from "../../src/main/execution-plan-card-view.mjs";
import * as cloud from "../../src/main/cloud-plan-contract.mjs";
import { tradingAnalysisDeliveryItems } from "../../src/renderer/trading-analysis-completion.ts";
import { turnResultFoldTargets } from "../../src/renderer/turn-result-fold.ts";
import { pureAnalysisPresentationGroups } from "../../src/renderer/pure-analysis-presentation.ts";

const source = fs.readFileSync(new URL("../../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = [
  "withCollapsedTurnResults", "turnResultGroups", "turnResultProcessIndexes", "turnResultStateKey",
  "renderTextBubble", "renderTurnResultHeader", "renderTurnResultToggle",
  "renderMessageExecutionPlan", "renderExecutionPlanCardContent", "renderAddToPlanAction", "executionPlanCandidateKey",
];
const compiled = ts.transpileModule(names.map(name => {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return fn.getText(ast);
}).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

// Run production projection, grouping, bubble and card renderers together.
// Only unrelated edit/copy/attachment services and Markdown are fixture adapters.
export function renderTradingAnswer(items, { expanded = false, language = "zh-CN", complete = true } = {}) {
  const state = { items: { fixture: Object.fromEntries(items.map(item => [item.id, item])) },
    resultProcessExpanded: {}, settings: { language }, executionPlans: [] };
  const deps = {
    ...plans, ...view, ...cloud, state, turnResultFoldTargets, pureAnalysisPresentationGroups,
    itemTurnId: item => item?.turnId || item?.turn_id,
    agentMessagePhase: item => item?.phase || item?.message_phase || item?.messagePhase,
    isRenderedUserSideMessage: message => message.kind === "user_text",
    isTurnResultOutputMessage: (_, message) => message.kind === "agent_text",
    isTurnResultGroupComplete: () => complete,
    turnResultElapsedLabel: () => "1m 34s", turnResultDisplayStatus: () => "handled",
    shouldLocalizeAppOwnedMessage: () => false,
    messageDisplayContent: (message, text) => ({ text, attachments: message.attachments || [] }),
    localSendStatusFromRecord: () => null, editableMessagePayload: () => null,
    isBlankThreadWelcomeMessage: () => false, isThinkingMessage: () => false,
    normalizeCopyText: text => text, textCopyPayload: text => text || null, imageCopyPayload: () => null,
    renderConversationSupplementHeader: () => "", renderLocalSendStatus: () => "",
    renderAttachmentGrid: () => '<div class="fixture-attachment">Requested file</div>',
    renderMessageActions: message => message.actions?.length ? '<button>Retry</button>' : "",
    formatMessageText: text => escape(text).replace(/\n/g, "<br>"),
    escapeHtml: escape, escapeAttr: escape,
    handledStatusLabel: () => language === "en" ? "Processed" : language === "zh-TW" ? "已處理" : "已处理",
    executionPlanCandidatesBySource: new Map(), executionPlanAlertSyncBusyIds: new Set(),
    syncExecutionPlansForCurrentAccount: () => {},
    loadMessageExecutionPlanFontSize: () => 14, MESSAGE_EXECUTION_PLAN_FONT_SIZES: [11, 12, 13, 14, 16, 18, 20],
  };
  const runtime = Function(...Object.keys(deps), `${compiled}\nreturn { withCollapsedTurnResults, renderTextBubble };`)(...Object.values(deps));
  const projected = tradingAnalysisDeliveryItems(items).map(item => ({
    id: item.id, conversation_id: "fixture", kind: item.type === "userMessage" ? "user_text" : "agent_text",
    text: item.text, attachments: item.attachments, actions: item.actions,
    executionPlanPresentation: item.__youleExecutionPlanPresentation, cloudReports: item.__youleCloudReports,
  }));
  for (const message of runtime.withCollapsedTurnResults("fixture", projected)) {
    if (message.turnResult) state.resultProcessExpanded[message.turnResult.key] = expanded;
  }
  const messages = runtime.withCollapsedTurnResults("fixture", projected);
  const html = messages.map(message => `<article class="message-row from-agent" data-message-id="${escape(message.id)}"><div class="message-stack"><div class="message-meta">HaoLo</div>${
    runtime.renderTextBubble(message, message.text || "", false, { allowPlanAction: true })
  }</div></article>`).join("");
  return { messages, html, bindings: [...deps.executionPlanCandidatesBySource.keys()] };
}
