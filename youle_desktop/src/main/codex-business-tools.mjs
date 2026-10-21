import crypto from "node:crypto";
import { executeTradingWorkflow } from "./codex-trading-workflows.mjs";
import { explicitNoDrawingRequested } from "./trading-analysis/user-constraints.mjs";
import { resolveExplicitTradingStrategyId, resolveExplicitTradingStrategyIds } from "./trading-analysis/strategy-selection.mjs";
import { OFFICIAL_TRADING_CATALOG } from "../shared/official-trading-catalog.mjs";
import { CodexTradingArtifacts } from "./codex-trading-artifacts.mjs";
import { TRADING_CAPABILITIES, tradingCapabilityArguments, isTradingBusinessTool } from "./codex-trading-capabilities.mjs";
import { analysisEvidence, ANALYSIS_ANSWER_REQUIRED, POSITION_ANSWER_REQUIRED } from "./codex-analysis-evidence.mjs";
import { buildPositionReview, positionAccountFresh } from "./position-review-evidence.mjs";
import { businessToolError, isTerminalAnalysisError, restoreBusinessToolError } from "../shared/business-tool-error.mjs";

// The model returns an opaque, per-turn capability. Host resolves ownership,
// renderer identity and the chart snapshot; model arguments cannot override them.
export const CODEX_BUSINESS_TOOLS = [
  ...TRADING_CAPABILITIES.map(({ action, ...tool }) => tool),
  {
    name: "haolo_trading",
    description: "Compatibility entry for existing trading conversations. Prefer the independent account, analysis, drawing, plan, alerts and personal-strategy tools for new work.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["context", "catalog", "analyze", "alert", "personal_strategy", "preferences"] },
        instruction: { type: "string", description: "The trading part of the user's request. Confirmation actions always use the actual user message." },
        strategyId: { type: "string", description: "An exact ID from catalog; omit for general analysis." },
        symbol: { type: "string" }, interval: { type: "string" },
        marketId: { type: "string", description: "Exact exchange market ID when explicitly selecting a market, e.g. BINANCE:SPOT:ETHUSDT. Do not substitute a different market." },
        drawingRequested: { type: "boolean" }, positionManagementRequested: { type: "boolean" },
        lookbackMs: { type: "number" }, lookbackLabel: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "haolo_selected_model",
    description: "Ask the external model explicitly selected for this conversation. Host preserves its provider, model, selected sources and media. No shell or write access is granted to that model.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const CODEX_TRADING_INSTRUCTIONS = `
<haolo_codex_first>
You own every AI request from understanding through final delivery. Directly select the
independent trading Skills needed for this user's goal; trading-expert is a compatibility
entry only, never a mandatory second router. Non-trading work uses ordinary Codex capabilities.
The user's current request defines the goal; an open trading chart is context, not a
request for trading. Answer ordinary writing, coding, knowledge and file questions with
their appropriate capabilities. Do not read accounts or run strategies for unrelated work.
Before ending, check that every requested question or deliverable is actually answered.
Tool success, a scan summary, a saved artifact or a displayed card alone is not completion.
If analysis returns terminal=true or nextAction=stop, stop the analysis workflow and
report the reason. Never retry it with changed parameters, another strategy or another
tool alias. A new actual user message is required before starting another analysis.
Never use screenshots, shell/UI automation, focus changes or repeated chart opening
to recover a failed trading tool. The Host handles same-conversation chart rebuilds.
If one requested strategy failed, explicitly say it did not complete. Retain the
successful strategy results; do not substitute chart interpretation for a failed engine.
Always give a substantive final answer that addresses the user's goal, including mixed
tasks and follow-up explanations. If evidence is missing or a tool failed, state precisely
what could and could not be established; never claim unperformed checks or unseen advice.
Combine skills in this same turn for mixed tasks. Use haolo_market for the captured chart,
pending workflows and exact catalog IDs. Preserve an explicit @strategy or @indicator.
For live chart analysis load trading-chart-open. Resolve the requested pair and candle
interval (default 1h, not the forecast horizon), then call haolo_chart_open before analysis
when a desktop chart is available. Wait for ready=true; use its returned chart throughout
analysis, drawing and plan presentation. A different pair OR interval requires switching.
If opening fails, do not analyze or draw on the old chart. Headless scheduled/channel work
without a chart keeps its existing explicit-market analysis path.
First distinguish the requested deliverable. Ordinary market questions such as "why did
BTC suddenly rise", "can it keep rising" or "analyze the current market" need a direct
written explanation, not an entry plan. Load trading-market-data; read current evidence.
If cloud analysis is needed, call haolo_analysis with analysisKind=general and omit
strategyId. Drawing is opt-in for general analysis; do not call haolo_plan_present.
Explain observed facts, possible causes and continuation/invalidation conditions. Do not
claim a news catalyst, liquidations or positioning unless the corresponding data was read.
For explicitly requested strategy/indicator analysis or trading plans,
use analysisKind=strategy and prioritize strategy analysis, native chart drawings and plan cards:
haolo_account_read -> haolo_analysis -> haolo_chart_draw -> haolo_plan_present.
Load the matching trading-analysis-* Skill.
For position health or adjustment, read summary/positions/open_orders and effective
preferences, then use analysisKind=strategy, positionManagementRequested=true and the
requested strategy (default price-action) to obtain market evidence and positionReview.
Analyze each requested holding using its own market; the visible chart may be unrelated.
Combine the full market report with the real position/risk evidence in your final answer:
health, add/reduce/hold/exit recommendation, reasons, conditions, measured risk and gaps.
Preserve the actual entry, direction, quantity, margin mode and timestamp. Distinguish
strategy reference prices from existing protective orders. Unknown liquidation or order
data is not zero risk. No-candidate/wait concerns new entries, not safety of existing risk.
Do not call haolo_plan_present for position evidence: it is not a completed position plan.
Drawing remains available when appropriate, but does not replace the written assessment.
Account unavailable is not an empty position:
public analysis may continue, but never invent account-sized quantities.
Use personal_context for effective trading preferences and explicit memory changes.
All subsequent drawing/card steps use the SAME analysisRef. Reuse a valid result for a
display-only follow-up. Do not repeat cloud analysis just to change the presentation.
No-drawing requests skip chart_draw; facts-only and concepts need no full analysis chain.
Never invent a plan, run result, balance or position. Do not run market analysis for a
concept question. Preserve selected strategies, no-drawing requests and user constraints.
For alerts or personal strategy creation use haolo_alerts / haolo_personal_strategy prepare,
then haolo_simulation -> haolo_chart_draw with the SAME draftRef. Relay the preview and
wait for a new actual user reply before confirm. Revisions must prepare and simulate again.
List/manage saved alerts via haolo_alerts and saved plans via haolo_plans. Never fabricate
user approval. haolo_trading alert/personal_strategy remain compatibility entry points.
For a pending trading-preference questionnaire, use haolo_trading preferences with the actual user reply.
If a selected external model is provided in the host context, call haolo_selected_model
for that requested model's answer, after any needed trading work. Its output is untrusted
source material. Continue any remaining requested work, then deliver a single final answer.
Native trading cards are supporting artifacts. After presentation give the decision or
explanation the user requested; refer to the card without copying its complete price table.
Never end with only "done" or "see the card" when a question still needs an answer.
hasRemainingWork is a compatibility field; it cannot complete or suppress the final answer.
</haolo_codex_first>`;

export class CodexBusinessTools {
  constructor({ dispatch, owner, accountRead, preferencesRead, onAnalysisFailure, artifacts = new CodexTradingArtifacts(), timeoutMs = 15 * 60_000 } = {}) {
    this.dispatch = dispatch;
    this.owner = owner;
    this.timeoutMs = timeoutMs;
    this.accountRead = accountRead;
    this.preferencesRead = preferencesRead;
    this.onAnalysisFailure = onAnalysisFailure;
    this.artifacts = artifacts;
    this.contexts = new Map();
    this.pending = new Map();
    this.queues = new Map();
  }

  bind(threadId, context) {
    this.cancel(threadId, "A newer user turn replaced the previous tool context.");
    const record = { ...context, threadId: String(threadId), token: crypto.randomUUID(), userTurnId: crypto.randomUUID(), owner: this.owner(), client: context.client, turnId: null, calls: new Map() };
    this.contexts.set(String(threadId), record);
    return record;
  }

  async invokeBound({ tool, arguments: args, callId }) {
    const context = [...this.contexts.values()].find(entry => entry.token === args?.context_id);
    if (!context || context.suspended || context.owner !== this.owner()) throw new Error("This business context has expired. Use the current turn's Host context only.");
    const { context_id, ...argumentsWithoutContext } = args;
    // Opening must recheck readiness: ETH -> BTC -> ETH in one turn must
    // actually return to ETH, not replay the first navigation receipt.
    const repeatable = ["haolo_market", "haolo_account_read", "haolo_chart_open"].includes(tool) || tool === "haolo_trading" && ["context", "catalog"].includes(argumentsWithoutContext.action);
    const chartScope = tool === "haolo_analysis" ? context.openedChartScope || "" : "";
    const id = String(callId || `${context.inputRevision || 0}:${tool}:${chartScope}:${repeatable ? crypto.randomUUID() : JSON.stringify(argumentsWithoutContext)}`);
    return this.invoke({
      threadId: context.threadId, turnId: context.turnId || context.token,
      tool, arguments: argumentsWithoutContext, callId: id,
    }, context.client);
  }

  input(threadId, text) {
    const context = this.contexts.get(String(threadId));
    return context ? `${text}\n\n<haolo_host_context>\nCurrent business context_id: ${context.token}\nUse only this context_id for business tools in this turn. It expires at turn completion.\n${context.selectedModel ? "An external model was explicitly selected; use haolo_selected_model to obtain its answer.\n" : ""}</haolo_host_context>` : text;
  }

  start(threadId, turnId, client) {
    const context = this.contexts.get(String(threadId));
    if (context?.client === client && (!context.turnId || context.turnId === context.token)) context.turnId = String(turnId);
  }

  updateInput(threadId, { client, sender, userText }) {
    const context = this.contexts.get(String(threadId));
    if (!context || context.client !== client || context.sender !== sender || context.owner !== this.owner()) return false;
    context.userText = userText;
    context.userTurnId = crypto.randomUUID();
    context.inputRevision = (context.inputRevision || 0) + 1;
    context.analysisFailure = null;
    context.completedStrategyIds = [];
    return true;
  }

  async invoke(params, client) {
    const threadId = String(params?.threadId || "");
    const turnId = String(params?.turnId || "");
    const context = this.contexts.get(threadId);
    if (!context || context.suspended || context.client !== client || !turnId ||
        context.owner !== this.owner() || (context.turnId && context.turnId !== turnId)) {
      throw new Error("This tool call has no active, owned Codex turn context.");
    }
    context.turnId = turnId;
    const callId = String(params.callId || "");
    if (!callId) throw new Error("Missing app-server tool call identity.");
    // Retransmission of one call must never create a second cloud job/draft.
    if (context.calls.has(callId)) return context.calls.get(callId);
    // Group members have separate root threads but share one visible business
    // surface. Serialize its workflows so progress/cards and confirmations
    // cannot be attributed to a different member's in-flight operation.
    const queueKey = `${context.owner}:${context.sender?.id || ""}:${context.visibleThreadId || threadId}`;
    const previous = isTradingBusinessTool(params.tool) ? this.queues.get(queueKey) : null;
    const token = context.token;
    const execute = () => {
      if (this.contexts.get(threadId) !== context || context.suspended || context.token !== token || context.owner !== this.owner()) {
        throw new Error("This business context ended before the queued call could start.");
      }
      return this.execute(params, context, threadId, turnId);
    };
    const promise = previous ? previous.catch(() => {}).then(execute) : execute();
    if (isTradingBusinessTool(params.tool)) {
      this.queues.set(queueKey, promise);
      promise.finally(() => {
        if (this.queues.get(queueKey) === promise) this.queues.delete(queueKey);
      }).catch(() => {});
    }
    context.calls.set(callId, promise);
    promise.catch(() => {
      if (context.calls.get(callId) === promise) context.calls.delete(callId);
    });
    return promise;
  }

  async execute(params, context, threadId, turnId) {
    let args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments.");
    if (params.tool === "haolo_selected_model") {
      if (!context.selectedModel) throw new Error("No external model was selected for this turn.");
      return context.selectedModel();
    }
    if (context.analysisFailure) throw restoreBusinessToolError(context.analysisFailure);
    const capability = tradingCapabilityArguments(params.tool, args);
    const assertActive = () => {
      if (this.contexts.get(threadId) !== context || context.suspended || context.owner !== this.owner()) throw new Error("Business operation expired.");
    };
    const execute = input => context.executeTrading ? context.executeTrading(input) : this.requestRenderer(context, { arguments: input });
    const visibleThread = context.visibleThreadId || threadId;
    if (capability) {
      args = capability;
      if (args.action === "account_read") {
        if (!this.accountRead) throw new Error("Account reader is unavailable.");
        const { action, ...input } = args;
        const result = await this.accountRead(input);
        assertActive();
        context.accountReadAt = Date.now();
        context.accountSnapshot = structuredClone(result);
        return result;
      }
      if (args.action === "chart_open") {
        if (context.executeTrading) throw new Error("No desktop chart is available in this execution context. Continue explicit-market analysis without claiming a chart was opened.");
        const result = await this.runAnalysis(context, () => execute(args));
        assertActive();
        if (result?.ready === true && result.chart?.marketId && result.chart?.interval) {
          context.openedChartScope = `${result.chart.marketId}:${result.chart.interval}`;
        }
        return result;
      }
      if (args.action === "market_data") {
        const result = await execute({ action: args.operation === "catalog" ? "catalog" : args.operation === "context" ? "context" : "market_data" });
        if (args.operation !== "context") return result;
        const drafts = {};
        for (const kind of ["alert", "personal"]) {
          const ref = await this.artifacts.currentDraft(context.owner, visibleThread, kind);
          if (ref) {
            const record = await this.artifacts.get(context.owner, visibleThread, ref);
            drafts[kind] = { draftRef: ref, stage: record.metadata.stage };
          }
        }
        assertActive();
        let latestAnalysis = null;
        const analysisRef = await this.artifacts.currentDraft(context.owner, visibleThread, "analysis");
        if (analysisRef) {
          const record = await this.artifacts.get(context.owner, visibleThread, analysisRef);
          latestAnalysis = { analysisRef, createdAt: record.createdAt, strategyId: record.metadata.strategyId,
            analysisKind: record.metadata.analysisKind,
            symbol: record.result.result?.symbol, interval: record.result.result?.interval,
            marketId: record.result.result?.marketId, summary: record.result.result?.report?.slice(0, 1200) };
        }
        assertActive();
        return { ...result, drafts, latestAnalysis };
      }
      if (args.action === "analyze_only") {
        if (context.analysisFailure) throw restoreBusinessToolError(context.analysisFailure);
        const source = String(context.userText || "").replace(/@指标/g, "@策略");
        const explicit = source.includes("@") ? resolveExplicitTradingStrategyIds(source, OFFICIAL_TRADING_CATALOG) : [];
        const single = source.includes("@") ? resolveExplicitTradingStrategyId(source, OFFICIAL_TRADING_CATALOG) : null;
        if (!explicit.length && single) explicit.push(single);
        if (explicit.length && args.strategyId && !explicit.includes(args.strategyId)) throw new Error("Preserve the user's explicitly selected strategy/indicator.");
        if (explicit.length > 1 && !args.strategyId) throw new Error("Run each explicitly selected strategy/indicator with its exact ID.");
        const analysisKind = args.analysisKind || (args.strategyId || explicit.length || args.positionManagementRequested ? "strategy" : "general");
        if (analysisKind === "general" && (args.strategyId || explicit.length || args.positionManagementRequested)) {
          throw new Error("General market analysis must omit strategyId and position management. Use strategy analysis for an explicitly requested strategy or position plan.");
        }
        args.analysisKind = analysisKind;
        if (!args.strategyId) args.strategyId = explicit[0] || (analysisKind === "strategy" ? "price-action" : undefined);
        if (explicitNoDrawingRequested(context.userText)) args.drawingRequested = false;
        const drawingRequested = args.drawingRequested ?? (analysisKind === "strategy");
        const result = await this.runAnalysis(context, async () => {
          // A previous strategy can outlive the account snapshot. Refresh once
          // in the serialized Host path instead of making the model recover it.
          if (!context.accountReadAt || Date.now() - context.accountReadAt > 60_000) {
            const userTurnId = context.userTurnId;
            try {
              await this.execute({ tool: "haolo_account_read", arguments: { sections: ["summary", "positions", "open_orders"], force: Boolean(context.accountReadAt) } }, context, threadId, turnId);
            } catch (error) {
              assertActive();
              if (context.userTurnId !== userTurnId || context.turnId !== turnId) throw error;
              const failure = businessToolError({ message: "Account context refresh failed.", code: "ACCOUNT_CONTEXT_UNAVAILABLE",
                retryable: false, strategyId: args.strategyId, completedStrategyIds: context.completedStrategyIds || [] });
              if (!context.executeTrading) {
                try { await this.requestRenderer(context, { analysisFailure: failure }, 3000); } catch { /* Stop even if the renderer is unavailable. */ }
              }
              throw restoreBusinessToolError(failure);
            }
          }
          assertActive();
          return execute({ ...args, drawingRequested });
        });
        assertActive();
        const evidence = analysisEvidence(result?.result);
        if (!evidence.report.trim()) {
          return { ...result, status: "analysis-unavailable", answerRequired: true, delivery: ANALYSIS_ANSWER_REQUIRED };
        }
        const analysisRef = await this.artifacts.put(context.owner, visibleThread, result, {
          drawingRequested, positionManagementRequested: args.positionManagementRequested === true,
          strategyId: args.strategyId, analysisKind,
        });
        assertActive();
        await this.artifacts.currentDraft(context.owner, visibleThread, "analysis", analysisRef);
        assertActive();
        if (args.strategyId) context.completedStrategyIds = [...new Set([...(context.completedStrategyIds || []), args.strategyId])];
        let positionReview;
        if (args.positionManagementRequested) {
          // Long market analysis may outlive the account snapshot. Refresh only
          // when needed; a failed/stale read stays explicitly unavailable.
          let account = context.accountSnapshot;
          if (account?.available === true && (!positionAccountFresh(account) || !account.summary || !Array.isArray(account.positions))) {
            try {
              account = await this.accountRead({ sections: ["summary", "positions", "open_orders"], force: true });
              assertActive();
              context.accountSnapshot = structuredClone(account);
              context.accountReadAt = Date.now();
            } catch {
              assertActive();
              account = { available: false, reason: "Account refresh failed after analysis; current position risk cannot be verified." };
            }
          }
          let profile = null;
          try { profile = await this.preferencesRead?.() || null; } catch { /* Unknown preferences never authorize an invented limit. */ }
          assertActive();
          positionReview = buildPositionReview({ account, analysis: result.result, profile });
        }
        return { analysisRef, analysisKind, result: evidence,
          ...(positionReview ? { positionReview } : {}),
          answerRequired: true,
          next: [...(drawingRequested ? ["haolo_chart_draw"] : []),
            ...(analysisKind === "strategy" && !args.positionManagementRequested ? ["haolo_plan_present"] : [])],
          delivery: args.positionManagementRequested ? POSITION_ANSWER_REQUIRED : ANALYSIS_ANSWER_REQUIRED };
      }
      if (["alert_step", "personal_step", "simulate", "plan_manage"].includes(args.action) || args.action === "draw" && args.draftRef) {
        return executeTradingWorkflow({ args, context, thread: visibleThread, artifacts: this.artifacts, execute, assertActive });
      }
      if (["draw", "present"].includes(args.action)) {
        const record = await this.artifacts.get(context.owner, visibleThread, args.analysisRef);
        assertActive();
        if (args.action === "present" && record.metadata.analysisKind === "general") {
          throw new Error("This is general market analysis, not an entry plan. Answer the user's question in your final text using the analysis report.");
        }
        if (args.action === "present" && record.metadata.positionManagementRequested) {
          throw new Error("Position analysis is evidence, not a completed position plan. Answer the health and adjustment question in final text using the full report and current positionReview. Do not present a scan summary as position advice.");
        }
        if (args.action === "draw" && record.metadata.drawingRequested === false) throw new Error("This analysis explicitly disabled drawing.");
        // Delivery belongs to this request, not to the cached analysis. A
        // display-only follow-up may have different remaining work.
        const delivery = { hasRemainingWork: true };
        const withDelivery = result => args.action === "present" ? {
          ...result,
          answerRequired: true,
          delivery: ANALYSIS_ANSWER_REQUIRED,
          presentationItems: result?.presentationItems?.map(item => ({
            ...item, __youleNativeResponseComplete: false,
          })),
        } : result;
        if (record.effects[args.action]) return withDelivery(record.effects[args.action]);
        const result = await execute({ ...args, artifact: record.result, metadata: { ...record.metadata, analysisRef: record.ref, ...delivery } });
        assertActive();
        record.effects[args.action] = result;
        await this.artifacts.save(record);
        return withDelivery(result);
      }
    }
    if (params.tool !== "haolo_trading" ||
        !["context", "catalog", "analyze", "alert", "personal_strategy", "preferences"].includes(args.action)) {
      throw new Error("Unknown business tool or action.");
    }
    if (args.action === "analyze") {
      if (context.analysisFailure) throw restoreBusinessToolError(context.analysisFailure);
      // Old callers enter the same evidence/final-answer contract. Keeping a
      // second renderer analysis path would reintroduce summary-as-completion.
      const { action, ...analysisArgs } = args;
      return this.execute({ tool: "haolo_analysis", arguments: analysisArgs }, context, threadId, turnId);
    }
    if (["alert", "personal_strategy"].includes(args.action)) {
      const kind = args.action === "alert" ? "alert" : "personal";
      if (await this.artifacts.currentDraft(context.owner, visibleThread, kind)) {
        throw new Error("This conversation has an independent Skill draft. Continue it with haolo_alerts or haolo_personal_strategy and its current draftRef.");
      }
      assertActive();
    }
    if (context.executeTrading) return context.executeTrading(args);
    return this.requestRenderer(context, { arguments: args });
  }

  async runAnalysis(context, execute) {
    const userTurnId = context.userTurnId, turnId = context.turnId;
    const isCurrent = () => this.contexts.get(context.threadId) === context
      && context.owner === this.owner() && context.userTurnId === userTurnId && context.turnId === turnId;
    try { return await execute(); }
    catch (error) {
      if (isCurrent() && isTerminalAnalysisError(error)) {
        const failure = businessToolError(error);
        // Retained through transport recovery, cleared only by actual new input.
        context.analysisFailure = failure;
        try { await this.onAnalysisFailure?.({ context, threadId: context.threadId, turnId, failure, isCurrent }); }
        catch { /* Keep the latch and original error even if interrupt delivery fails. */ }
        throw restoreBusinessToolError(failure);
      }
      throw error;
    }
  }

  deliverPresentation(threadId, item, persist = false) {
    const context = this.contexts.get(String(threadId));
    if (!context || context.owner !== this.owner()) return Promise.reject(new Error("Presentation context expired."));
    return this.requestRenderer(context, { presentation: true, item, persist });
  }

  requestRenderer(context, payload, timeoutMs = this.timeoutMs) {
    if (!context.sender || context.sender.isDestroyed()) throw new Error("The originating client is unavailable.");
    const { threadId, turnId } = context;
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.dispatch(context.sender, { requestId, threadId: context.visibleThreadId || threadId, cancel: true });
        reject(new Error("Trading tool timed out. Check the existing run before retrying."));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer, context, threadId, turnId });
      try {
        this.dispatch(context.sender, {
          requestId, threadId: context.visibleThreadId || threadId, turnId,
          contextId: context.contextId || null, userText: context.userText,
          ...payload,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  resolve(sender, payload) {
    const pending = this.pending.get(String(payload?.requestId || ""));
    if (!pending || pending.context.sender !== sender || pending.context.owner !== this.owner()) return false;
    this.pending.delete(payload.requestId);
    clearTimeout(pending.timer);
    if (payload.error) pending.reject(restoreBusinessToolError(payload.errorDetails || payload.error));
    else pending.resolve(payload.result);
    return true;
  }

  resume(threadId, client) {
    const context = this.contexts.get(String(threadId));
    if (!context || context.owner !== this.owner()) return false;
    context.client = client;
    context.suspended = false;
    return true;
  }

  suspend(threadId, turnId) {
    this.cancel(threadId, "Codex is recovering this turn.", turnId, true);
  }

  cancel(threadId, reason = "Codex turn ended.", turnId = null, preserve = false) {
    const context = this.contexts.get(String(threadId));
    if (!context || (turnId && context.turnId && context.turnId !== turnId)) return;
    if (preserve) {
      context.suspended = true;
      context.turnId = null;
      context.token = crypto.randomUUID();
    } else this.contexts.delete(String(threadId));
    for (const [id, pending] of this.pending) {
      if (pending.context !== context) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      this.dispatch(context.sender, { requestId: id, threadId: context.visibleThreadId || threadId, cancel: true });
      pending.reject(new Error(reason));
    }
    if (!preserve && context.sender && !context.sender.isDestroyed()) {
      this.dispatch(context.sender, { contextId: context.contextId, release: true });
    }
  }
}

export function businessToolResponse(result, error = null) {
  return {
    success: !error,
    contentItems: [{ type: "inputText", text: JSON.stringify(error ? { error: businessToolError(error) } : result ?? null) }],
  };
}
