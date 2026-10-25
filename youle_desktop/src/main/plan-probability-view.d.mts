import type { CloudTradingReport } from './cloud-plan-contract.mjs';
export function normalizePlanProbability(value: unknown, report: Pick<CloudTradingReport,'planRecords'>): Record<string,any> | null;
export function renderPlanProbabilityReply(report?: CloudTradingReport | null, language?: string): string;
