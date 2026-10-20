export interface ExecutionPlanCardLine { label: string; text: string }
export function executionPlanPriceText(value: number | string): string;
export function executionPlanCardHeading(title: string, lines?: ExecutionPlanCardLine[], language?: string): string;
export function executionPlanCardFooter(content: string, trailing: string, action?: string): string;
export function executionPlanCardAction(input?: ExecutionPlanCardLine[] | 'wait' | 'blocked' | 'long' | 'short', language?: string): string;
export function executionPlanCardBody(lines?: ExecutionPlanCardLine[], language?: string, options?: {expiresAt?:number;hideAction?:boolean}): string;
export function executionPlanStructuredCardBody(input: {
  entry: { lower: number; upper?: number };
  entryMode?: 'left' | 'right';
  entryBasisMismatch?: boolean;
  stop: number;
  targets: number[];
  direction: 'long' | 'short';
  expiresAt?: number;
  action?: 'wait' | 'blocked' | 'long' | 'short';
  hideAction?: boolean;
  riskReward?: Array<number | null>;
  account?: {
    mode: string; notional?: number; allocationNotional?: number; estimatedStopLoss?: number;
    targetOrders?: Array<{targetIndex: number; price: number; notional: number; estimatedNetProfit?: number}>;
    targetEstimates?: Array<{targetIndex: number; price: number; notional: number; estimatedNetProfit?: number}>;
  };
}, language?: string): string;
