export interface CloudTradingReport {
  schemaVersion: 1;
  runId: string;
  resultHash: string;
  locale: 'zh-CN'|'en'|'zh-Hant';
  marketId: string;
  interval: string;
  strategyId: string;
  report: string;
  executionPlan: Record<string, any>;
  planRecords: Array<Record<string, any>>;
  origin: {sourceThreadId: string; storageSessionId: string; analysisJobId: string} | null;
  drawingPatch: Record<string, any> | null;
  indicatorDrawingPatch: Record<string, any> | null;
}
export function normalizeCloudReports(value: unknown): CloudTradingReport[];
export function cloudReportFromResponse(value: unknown): CloudTradingReport[];
export function cloudPlanCard(report: CloudTradingReport): {title:string;content:string;html:string} | null;
