export type TradingAnalysisTheory =
  | "chan"
  | "order-flow"
  | "wave"
  | "wyckoff"
  | "price-action"
  | (string & {});

export type TradingAnalysisJobStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TradingAnalysisJobContext {
  analysisId: string;
  theory: TradingAnalysisTheory;
  storageSessionId: string;
  marketId: string;
  symbol: string;
  interval: string;
  market: object | null;
  startedAt: number;
  status: TradingAnalysisJobStatus;
  completedAt: number | null;
  error: string | null;
}

function normalizedAnalysisId(value: string | null | undefined) {
  const supplied = String(value || "").trim().slice(0, 160);
  if (supplied) return supplied;
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `trading-analysis-${randomId}`;
}

export class TradingAnalysisJobController {
  private readonly jobs = new Map<string, TradingAnalysisJobContext>();

  start(options: {
    analysisId?: string | null;
    theory: TradingAnalysisTheory;
    storageSessionId: string;
    marketId: string;
    symbol: string;
    interval: string;
    market?: object | null;
  }) {
    const analysisId = normalizedAnalysisId(options.analysisId);
    const existing = this.jobs.get(analysisId);
    if (existing?.status === "running") {
      throw new Error(`交易分析任务 ${analysisId} 已在运行`);
    }
    const job: TradingAnalysisJobContext = {
      analysisId,
      theory: options.theory,
      storageSessionId: String(options.storageSessionId || "").trim(),
      marketId: String(options.marketId || "").trim().toUpperCase(),
      symbol: String(options.symbol || "").trim().toUpperCase(),
      interval: String(options.interval || "").trim().toUpperCase(),
      market: options.market ? { ...options.market } : null,
      startedAt: Date.now(),
      status: "running",
      completedAt: null,
      error: null,
    };
    this.jobs.set(analysisId, job);
    this.prune();
    return job;
  }

  get(analysisId: string | null | undefined) {
    return this.jobs.get(String(analysisId || "")) || null;
  }

  isActive(analysisId: string | null | undefined) {
    return this.get(analysisId)?.status === "running";
  }

  activeForStorageSession(storageSessionId: string) {
    return [...this.jobs.values()].filter((job) => (
      job.status === "running" && job.storageSessionId === storageSessionId
    ));
  }

  migrateStorageSession(previousStorageSessionId: string, nextStorageSessionId: string) {
    if (!previousStorageSessionId || previousStorageSessionId === nextStorageSessionId) return;
    this.jobs.forEach((job) => {
      if (job.storageSessionId === previousStorageSessionId) {
        job.storageSessionId = nextStorageSessionId;
      }
    });
  }

  complete(analysisId: string) {
    return this.finish(analysisId, "completed", null);
  }

  fail(analysisId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "交易分析失败");
    return this.finish(analysisId, "failed", message.slice(0, 300));
  }

  cancel(analysisId: string) {
    return this.finish(analysisId, "cancelled", "用户已停止交易分析");
  }

  private finish(
    analysisId: string,
    status: Exclude<TradingAnalysisJobStatus, "running">,
    error: string | null,
  ) {
    const job = this.jobs.get(analysisId);
    if (!job || job.status !== "running") return job || null;
    job.status = status;
    job.error = error;
    job.completedAt = Date.now();
    return job;
  }

  private prune() {
    if (this.jobs.size <= 120) return;
    const terminal = [...this.jobs.values()]
      .filter((job) => job.status !== "running")
      .sort((first, second) => Number(first.completedAt || 0) - Number(second.completedAt || 0));
    terminal.slice(0, Math.max(0, this.jobs.size - 100)).forEach((job) => {
      this.jobs.delete(job.analysisId);
    });
  }
}

export const tradingAnalysisJobs = new TradingAnalysisJobController();
