export interface CloudTradingReport {
  schemaVersion: 1;
  executionPolicy?: 'entry-v2'|'right-legacy-v1';
  selectedCardIndex?: number;
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
export function cloudPlanCard(report: CloudTradingReport, options?: {hideExpiry?:boolean;separateAction?:boolean;language?:string}): {title:string;content:string;html:string;actionHtml?:string;readOnly?:boolean} | null;
export function selectCloudPlan(report: CloudTradingReport,remote:Record<string,any>): CloudTradingReport;
export function legacyReportCandidates(report:string): Array<{title:string;content:string}>;
export function bindLegacyCloudCandidate<T extends {title:string;content:string}>(reports: CloudTradingReport[],candidate:T,usedPlanIds?:Set<string>): T & {cloudReport:CloudTradingReport};
