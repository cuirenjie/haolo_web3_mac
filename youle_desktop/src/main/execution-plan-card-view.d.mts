export interface ExecutionPlanCardLine { label: string; text: string }
export function executionPlanCardHeading(title: string, lines?: ExecutionPlanCardLine[], language?: string): string;
export function executionPlanCardBody(lines?: ExecutionPlanCardLine[], language?: string): string;
