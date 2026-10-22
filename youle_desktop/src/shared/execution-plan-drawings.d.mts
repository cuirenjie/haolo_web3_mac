export interface PlanLevel {
  planId: string;
  scenarioId: string;
  role: 'entry' | 'stop' | 'target';
  targetIndex?: number;
}
export function isExecutionPlanLevel(drawing: any): boolean;
export function normalizePlanLevel(value: unknown): PlanLevel | undefined;
export function projectExecutionPlanDrawings<T>(patch: T, plan: any, language?: string): T;
export function cloudPlanDrawingPatch<T extends {drawingPatch: any}>(report: T): T['drawingPatch'];
export function cloudAnalysisDrawingPlan<T extends {analysisPlan?: any}>(response: T): NonNullable<T['analysisPlan']>;
