import {
  captureTradingExpertAnalysisTarget, releaseTradingExpertAnalysisTarget,
  rebindTradingExpertAnalysisTargetStorageSession,
  tradingExpertAlertContextSnapshot,
  type TradingAnalysisTaskTarget,
} from "./trading-expert-market";
import { resolveCodexChartTarget, type CodexChartTarget } from "./codex-chart-target.mjs";

type Context = { target: TradingAnalysisTaskTarget | null; attachments: any[]; alertContext: any; chartOpened?: boolean; chartOpenFailed?: boolean; held?: boolean; releaseRequested?: boolean };
type Dependencies = {
  api: any;
  responseId?: (threadId: string) => string | null;
  catalog: () => any[] | Promise<any[]>;
  pending: (threadId: string) => unknown;
  openChart?: (threadId: string, requested: CodexChartTarget, target: TradingAnalysisTaskTarget | null, signal: AbortSignal) => Promise<TradingAnalysisTaskTarget>;
  analyze: (threadId: string, args: any, target: TradingAnalysisTaskTarget | null) => Promise<unknown>;
  draw?: (threadId: string, artifact: any) => Promise<unknown>;
  present?: (threadId: string, artifact: any, metadata: any) => Promise<unknown>;
  workflow?: (threadId: string, args: any, text: string, context: any, signal: AbortSignal) => Promise<unknown>;
  alert: (threadId: string, text: string, context: { analysisTarget: TradingAnalysisTaskTarget | null; chart: any }) => Promise<unknown>;
  personalStrategy: (threadId: string, text: string, attachments: any[], context: { analysisTarget: TradingAnalysisTaskTarget | null; chart: any }) => Promise<unknown>;
  preferences: (threadId: string, text: string) => Promise<unknown>;
  cancel: (threadId: string) => Promise<unknown>;
  completed?: (threadId: string, item: any, persist: boolean) => void | Promise<unknown>;
};

// The only mutable UI references stay inside the renderer. Host/model see an
// opaque context ID and a small summary, never live chart state or credentials.
export class CodexTradingTools {
  private contexts = new Map<string, Context>();
  private collectors = new Map<string, any[]>();
  private presentationResponseIds = new Map<string, string>();
  private presentationCompletion = new Map<string, boolean>();
  private calls = new Map<string, string>();
  private controllers = new Map<string, AbortController>();
  constructor(private deps: Dependencies) {}

  capture(attachments: any[] = [], target = captureTradingExpertAnalysisTarget()) {
    const id = crypto.randomUUID();
    this.contexts.set(id, {
      target, attachments: [...attachments],
      alertContext: target ? structuredClone(tradingExpertAlertContextSnapshot()) : null,
    });
    return id;
  }

  collect(threadId: string, items: any[]) {
    const collector = this.collectors.get(threadId);
    if (!collector) return false;
    collector.push(...items.map(item => this.bindPresentation(threadId, item)));
    return true;
  }

  bindPresentation(threadId: string, item: any) {
    const turnId = this.presentationResponseIds.get(threadId);
    if (item?.type !== "agentMessage") return item;
    const completed = this.presentationCompletion.get(threadId);
    return {
      ...item,
      ...(turnId && !item.turnId && !item.turn_id ? { turnId } : {}),
      ...(completed !== undefined && ["execution-plan", "position-plan"].includes(item.__youleExecutionPlanPresentation)
        ? { __youleNativeResponseComplete: completed } : {}),
    };
  }

  updateAttachments(id: string, attachments: any[]) {
    const context = this.contexts.get(id);
    if (context) context.attachments = [...attachments];
  }

  isToolTurn(threadId: string) { return this.collectors.has(threadId); }

  hold(id: string) {
    const context = this.contexts.get(id);
    if (context) context.held = true;
  }

  unhold(id: string) {
    const context = this.contexts.get(id);
    if (!context) return;
    context.held = false;
    if (context.releaseRequested) this.release(id);
  }

  release(id: string) {
    const context = this.contexts.get(id);
    if (!context) return;
    if (context.held) { context.releaseRequested = true; return; }
    releaseTradingExpertAnalysisTarget(context.target);
    this.contexts.delete(id);
  }

  async handle(payload: any) {
    if (payload.presentation) {
      try {
        await this.deps.completed?.(payload.threadId, payload.item, payload.persist === true);
        await this.deps.api.resolveBusinessTool({ requestId: payload.requestId, result: true });
      } catch (error) {
        await this.deps.api.resolveBusinessTool({ requestId: payload.requestId, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (payload.release) { this.release(payload.contextId); return; }
    if (payload.cancel) {
      this.controllers.get(payload.requestId)?.abort();
      if (this.calls.has(payload.requestId)) await this.deps.cancel(payload.threadId);
      return;
    }
    const { requestId, threadId, arguments: args } = payload;
    const context = this.contexts.get(payload.contextId);
    let target = rebindTradingExpertAnalysisTargetStorageSession(context?.target, threadId);
    let result: unknown;
    try {
      if (this.collectors.has(threadId)) throw new Error("Another trading tool is already running in this conversation.");
      if (args.action === "context") {
        result = {
          chart: target ? { marketId: target.marketId, symbol: target.symbol, interval: target.interval, capturedAt: target.capturedAt } : null,
          pending: this.deps.pending(threadId),
        };
      } else if (args.action === "catalog") {
        result = { strategies: (await this.deps.catalog()).map(({ id, display, capabilities, enabled, version, mentions }) => ({ id, display, capabilities, enabled, version, mentions })) };
      } else if (args.action === "market_data") {
        result = { chart: target ? { marketId: target.marketId, symbol: target.symbol, interval: target.interval,
          capturedAt: target.capturedAt, candles: target.visibleCandles } : null,
          source: context?.chartOpened ? "opened-chart" : "send-time-chart", authoritativeAnalysisSource: "cloud" };
      } else {
        if (!context && ["chart_open", "alert", "personal_strategy", "preferences", "draft_prepare"].includes(args.action)) throw new Error("The original user input context is unavailable; resend the message.");
        if (["analyze", "analyze_only"].includes(args.action) && !target && !args.symbol && !args.marketId) {
          throw new Error("No chart was captured for this message. Ask the user for a symbol/market and interval.");
        }
        const items: any[] = [];
        this.collectors.set(threadId, items);
        // Capture before awaiting: switching conversations or starting another
        // response must not attach a late report to whichever turn is active.
        const responseId = this.deps.responseId?.(threadId) || payload.turnId;
        if (responseId) this.presentationResponseIds.set(threadId, responseId);
        if (args.action === "present") this.presentationCompletion.set(threadId, false);
        this.calls.set(requestId, threadId);
        const controller = new AbortController();
        this.controllers.set(requestId, controller);
        try {
          const openChart = async (reuseOpenedInterval = false) => {
            if (!context || !this.deps.openChart) throw new Error("Chart opening capability is unavailable.");
            context.chartOpenFailed = true;
            const requested = resolveCodexChartTarget(args, target, { reuseOpenedInterval });
            const next = await this.deps.openChart(threadId, requested, target, controller.signal);
            if (controller.signal.aborted || this.contexts.get(payload.contextId) !== context) {
              releaseTradingExpertAnalysisTarget(next);
              throw new Error("Chart opening was cancelled or its context expired.");
            }
            if (next.marketId !== requested.marketId || next.interval !== requested.interval
                || next.symbol !== requested.symbol || next.candles.length < 2) {
              releaseTradingExpertAnalysisTarget(next);
              throw new Error("The requested chart candles are not ready.");
            }
            releaseTradingExpertAnalysisTarget(context.target);
            context.target = next;
            context.chartOpened = true;
            context.chartOpenFailed = false;
            context.alertContext = structuredClone(tradingExpertAlertContextSnapshot());
            target = rebindTradingExpertAnalysisTargetStorageSession(next, threadId);
            return { ready: true, chart: { marketId: next.marketId, symbol: next.symbol, interval: next.interval, capturedAt: next.capturedAt } };
          };
          if (args.action === "chart_open") result = await openChart();
          else if (["analyze", "analyze_only"].includes(args.action)) {
            if (context?.chartOpenFailed) throw new Error("The requested chart did not open. Retry haolo_chart_open successfully before analysis.");
            // Desktop analysis must not outrun a pair/interval change, even if
            // the orchestrator omitted the explicit chart-open step.
            if (target && this.deps.openChart) await openChart(context?.chartOpened === true);
            result = await this.deps.analyze(threadId, {
              ...args, instruction: args.instruction || payload.userText,
              ...(context?.chartOpened && target ? { marketId: target.marketId, symbol: undefined, interval: target.interval } : {}),
              deferPresentation: args.action === "analyze_only",
            }, target);
          }
          else if (args.action === "draw") {
            if (!this.deps.draw) throw new Error("Drawing capability is unavailable.");
            result = await this.deps.draw(threadId, args.artifact);
          } else if (args.action === "present") {
            if (!this.deps.present) throw new Error("Plan presentation capability is unavailable.");
            result = await this.deps.present(threadId, args.artifact, args.metadata);
          }
          // Actual user wording is supplied by Host, never by the model's args.
          else if (args.action === "alert") result = await this.deps.alert(threadId, payload.userText, { analysisTarget: target, chart: context?.alertContext || null });
          else if (args.action === "personal_strategy") {
            result = await this.deps.personalStrategy(threadId, payload.userText, context?.attachments || [], { analysisTarget: target, chart: context?.alertContext || null });
          } else if (args.action === "preferences") result = await this.deps.preferences(threadId, payload.userText);
          else if (["draft_prepare", "draft_confirm", "draft_cancel", "simulate", "simulation_draw", "alert_step", "personal_step", "plan_manage"].includes(args.action)) {
            if (!this.deps.workflow) throw new Error("Independent workflow capability is unavailable.");
            result = await this.deps.workflow(threadId, args, payload.userText, {
              analysisTarget: target, chart: context?.alertContext || null, attachments: context?.attachments || [],
            }, controller.signal);
          }
          else throw new Error("Unsupported trading workflow.");
          if (args.action !== "chart_open") result = { result: result ?? null, presentationItems: items, pending: this.deps.pending(threadId) };
        } finally {
          this.collectors.delete(threadId);
          this.presentationResponseIds.delete(threadId);
          this.presentationCompletion.delete(threadId);
          this.calls.delete(requestId);
          this.controllers.delete(requestId);
        }
      }
      await this.deps.api.resolveBusinessTool({ requestId, result });
    } catch (error) {
      await this.deps.api.resolveBusinessTool({ requestId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
