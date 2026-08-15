export interface ExecutionPlanViewModel {
  action: "long" | "short" | "wait" | "no_trade";
  summary: string;
  marketCondition: string;
  entry: string;
  confirmation: string;
  stopLoss: string;
  takeProfit: string;
  positionSizing: string;
  riskReward: string;
  observation: string;
  expiresAt: string;
  cancellation: string;
}

export function executionPlanAriaLabel(plan: Pick<ExecutionPlanViewModel, "action" | "summary">) {
  const actionLabels = {
    long: "偏多执行方案",
    short: "偏空执行方案",
    wait: "等待执行方案",
    no_trade: "不交易方案",
  } as const;
  return `${actionLabels[plan.action]}：${plan.summary}`;
}

export function executionPlanStatus(plan: Pick<ExecutionPlanViewModel, "expiresAt">, now = Date.now()) {
  const expiresAt = Date.parse(plan.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now ? "expired" : "active";
}
